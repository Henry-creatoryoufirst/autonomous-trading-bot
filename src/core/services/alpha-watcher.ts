/**
 * NVR-SPEC-028 Phase 1: Always-On Alpha Watcher
 *
 * The Watcher's job is to recognize physics-level setups in real time on a
 * narrow set of tokens, without burning LLM tokens on the scan loop. Pure
 * deterministic scoring — the LLM only enters at the Reviewer gate (Phase 2).
 *
 * Architecture:
 *   - Polls GeckoTerminal pool data on an adaptive interval (30s for
 *     cohorts ≤8, 60s otherwise) for the watched cohort. Per-pool data
 *     includes 5m/1h price changes, 1h/24h volume, buy/sell counts,
 *     liquidity, buyers/sellers.
 *   - For each poll, computes 5 trigger scores (momentum break, liquidity
 *     vacuum, whale arrival, volume spike, buy pressure).
 *   - When ANY score crosses its threshold, emits a Trigger to the in-memory
 *     ring buffer + log file. No execution, no LLM, no decision — just
 *     "interesting, write it down."
 *
 * Phase 1 success criterion: Henry can read the trigger log and form an
 * opinion on whether the patterns look real or noisy. Zero capital touched.
 *
 * Phase 2 (next): Reviewer wakes on each trigger, packages the context for
 *                 a Haiku call, gets a BUY/WAIT/PASS verdict.
 * Phase 3:        Reflex execution on greenlit triggers, hard stops/timers.
 * Phase 4:        Outcome learning — retunes thresholds from observed hits.
 */

import { geckoTerminalService } from './gecko-terminal.js';
import type { DexPoolData } from './gecko-terminal.js';
import { TOKEN_REGISTRY } from '../config/token-registry.js';
import { alphaReviewer, type TriggerReview } from './alpha-reviewer.js';
import { alphaReflex } from './alpha-reflex.js';
// v21.40 (Stream R): on-chain prices as PRIMARY source for cohort tokens.
// The bot is trading on Base; pool reserves are right there, readable in
// <100ms via eth_call. GeckoTerminal's free-tier rate limit + CDN caching
// means stale prices that have caused panic-sell incidents (multiple
// sessions of pain). The bot already has fetchOnChainTokenPrice +
// fetchChainlinkPrices + poolRegistry — we just weren't using them here.
//
// New flow: alpha-watcher still calls getTokenPools for FLOW data (buy/
// sell counts, volume), but OVERRIDES the price with the on-chain read
// when poolRegistry has an entry for the symbol. GeckoTerminal price
// becomes the fallback for tokens without on-chain pools.
//
// Behind ALPHA_WATCHER_ONCHAIN_PRICES env flag (default OFF). Flip on
// after staging soak verifies on-chain prices track GeckoTerminal prices
// within tolerance.
import {
  fetchOnChainTokenPrice,
  fetchChainlinkPrices,
  getPoolRegistry,
} from '../data/on-chain-prices.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Default watched cohort. Tokens with high enough volume that 5-15% intraday
 * moves happen daily, distinct enough character that they don't move as one
 * correlated bloc, and stable enough contracts not to rug. Excludes WETH/cbBTC —
 * Core handles those; AlphaHunter focuses on the volatile mid-cap layer.
 *
 * 2026-05-10 expansion (4 → 15): per Henry's call, pure-meme breadth dialed
 * down in favor of "real alts with macro narratives" — wrapped majors
 * (cbXRP/cbLTC/cbADA/cbSOL/cbDOGE) are alpha plays in this frame, not blue
 * chip. Memory: feedback_specialist_depth_beats_breadth (10-20 sweet spot).
 *
 * Override via env: ALPHA_WATCHER_COHORT="AERO,VIRTUAL,AIXBT,CLANKER"
 */
const DEFAULT_COHORT = [
  // Wrapped-major alpha (macro narrative + volatility)
  'cbXRP', 'cbLTC', 'cbADA', 'cbSOL', 'cbDOGE',
  // Existing watched (working)
  'AERO', 'VIRTUAL', 'AIXBT', 'CLANKER',
  // AI / narrative
  'HIGHER', 'KAITO',
  // DeFi mid-cap
  'MORPHO', 'PENDLE',
  // Memes (dialed down from full breadth)
  'BRETT', 'DEGEN',
];

/**
 * Adaptive polling: 30s for tight cohorts, 60s when cohort > 8. Keeps us
 * under GeckoTerminal's ~30 calls/min public rate limit (we're hitting
 * getTokenPools once per cohort symbol per tick + outcome-tracker calls
 * elsewhere). Live override via ALPHA_WATCHER_POLL_SEC env still wins.
 */
const COHORT_LARGE_THRESHOLD = 8;
const POLL_INTERVAL_SMALL_SEC = 30;
const POLL_INTERVAL_LARGE_SEC = 60;

function resolvePollIntervalSec(cohortSize: number): number {
  const envOverride = process.env.ALPHA_WATCHER_POLL_SEC;
  if (envOverride) {
    const parsed = parseInt(envOverride, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.max(20, parsed);
    }
    console.warn(
      `[AlphaWatcher] ignoring invalid ALPHA_WATCHER_POLL_SEC=${envOverride} — falling back to adaptive default`,
    );
  }
  return cohortSize > COHORT_LARGE_THRESHOLD
    ? POLL_INTERVAL_LARGE_SEC
    : POLL_INTERVAL_SMALL_SEC;
}

const TRIGGER_RING_BUFFER_SIZE = 500;

// ============================================================================
// TRIGGER THRESHOLDS — tuneable, will be retuned by Phase 4 outcome learning.
// ============================================================================

const THRESHOLDS = {
  // Momentum break: 5-min price change exceeds this absolute pct
  MOMENTUM_BREAK_PCT_5M: 1.5,
  // Volume spike: h1 volume × 24 (annualized rate) divided by h24 volume.
  // 2026-05-07: replay showed 203/203 = 0% hit rate at 2.0× threshold. The
  // bar fires too easily on minor volume bumps. Raised to 3.0× to filter
  // for genuine spike events. Will be retuned by Phase 4 outcome learning.
  VOLUME_SPIKE_RATIO: 3.0,
  // Buy pressure: buys / (buys + sells) over h1
  STRONG_BUY_PRESSURE_RATIO: 0.65,
  // Whale BUY: high avg trade size + heavy buy ratio
  WHALE_AVG_TRADE_USD: 500,
  WHALE_BUY_RATIO: 0.6,
  WHALE_SELL_RATIO: 0.4,
  // Liquidity vacuum: pool liquidity drops > N% from prior poll
  LIQUIDITY_DROP_PCT: 5,
};

/**
 * Cooldown — don't re-fire the same {symbol, type} pair more than once per
 * window UNLESS the new strength is materially higher (1.5x). Prevents
 * spammy re-firing on the same setup while letting genuine escalations
 * through.
 */
const TRIGGER_COOLDOWN_MIN = 5;
const STRENGTH_ESCALATION_MULTIPLIER = 1.5;

/**
 * Outcome window — every fired trigger gets followed for this many minutes.
 * Long enough to catch typical 5-15% moves; short enough that 96-cycles/day
 * give us 30+ outcomes within a half-day soak.
 */
const OUTCOME_FOLLOW_MINUTES = 30;
const OUTCOME_TARGET_PCT = 5;
const OUTCOME_STOP_PCT = 3;

// ============================================================================
// TYPES
// ============================================================================

export type TriggerType =
  | 'MOMENTUM_BREAK'
  | 'VOLUME_SPIKE'
  | 'BUY_PRESSURE'
  | 'WHALE_BUY'
  | 'WHALE_SELL'
  | 'LIQUIDITY_VACUUM';

/**
 * Outcome of a fired trigger after the 30-min follow-forward window.
 * Phase 1.5 paper-trade simulator — answers "did this trigger predict
 * a real move?" without touching capital.
 */
export type TriggerOutcomeStatus =
  | 'OPEN'        // Still being followed (window not elapsed yet)
  | 'TARGET_HIT'  // Price reached +5% from entry — the win
  | 'STOP_HIT'    // Price reached -3% from entry first — the loss
  | 'DECAYED';    // 30 min elapsed without hitting either band — neutral

export interface TriggerOutcome {
  status: TriggerOutcomeStatus;
  entryPriceUSD: number;
  peakPriceUSD: number;
  troughPriceUSD: number;
  finalPriceUSD: number;
  /** % change from entry to whichever endpoint was hit (or to final if DECAYED) */
  finalPctChange: number;
  /** ISO timestamp when this outcome was finalized (or last updated if OPEN) */
  resolvedAt: string;
  /** Number of price observations recorded across the follow window */
  observationCount: number;
}

export interface AlphaTrigger {
  /** ISO timestamp of when the Watcher fired this trigger */
  raisedAt: string;
  /** Token symbol from the watched cohort */
  symbol: string;
  /** Trigger pattern that fired */
  type: TriggerType;
  /** 0-1 score; higher = stronger pattern. Used by Phase 2 Reviewer to weight. */
  strength: number;
  /** Human-readable one-liner. Phase 2 packages this into the LLM prompt. */
  reason: string;
  /** Microstructure snapshot at trigger moment — full context for the Reviewer */
  snapshot: {
    priceUSD: number;
    priceChange5m: number;
    priceChange1h: number;
    volume1hUSD: number;
    volume24hUSD: number;
    volumeSpikeRatio: number;
    buys1h: number;
    sells1h: number;
    buyRatio1h: number;
    avgTradeSize1hUSD: number;
    liquidityUSD: number;
    poolAddress: string;
  };
  /**
   * Phase 1.5 paper-trade outcome. Populated by the follow-forward loop.
   * Starts as { status: 'OPEN', ... } and resolves to TARGET_HIT/STOP_HIT/DECAYED
   * within 30 min. Used as the truth signal for "does this trigger type
   * actually predict moves?" before any capital is touched (Phase 3+).
   */
  outcome?: TriggerOutcome;
  /**
   * Phase 2 Reviewer verdict. Populated asynchronously after the trigger
   * fires — Haiku takes ~2-5s, so we don't block the tick. May be null if
   * the Reviewer is disabled or the call errored.
   */
  review?: TriggerReview | null;
}

export interface WatcherStatus {
  enabled: boolean;
  cohort: string[];
  lastPollAt: string | null;
  pollErrors: number;
  totalPollsCompleted: number;
  triggersFired24h: number;
  triggersByType24h: Record<TriggerType, number>;
  /** Phase 1.5: rolling outcome stats for the last 24h of resolved triggers */
  outcomes24h: {
    resolved: number;
    open: number;
    targetHit: number;
    stopHit: number;
    decayed: number;
    /** Hit rate = targetHit / (resolved with definitive outcome) — the precision number */
    hitRate: number | null;
    /** Per-type breakdown so we can see which patterns actually predict */
    byType: Record<TriggerType, { resolved: number; targetHit: number; stopHit: number; decayed: number; hitRate: number | null }>;
  };
  /** Phase 2: rolling Reviewer verdict stats */
  reviews24h: {
    reviewed: number;
    pending: number;
    buy: number;
    wait: number;
    pass: number;
    /** Reviewer's BUY-call hit rate when paired with resolved outcomes */
    buyHitRate: number | null;
    /** Cost telemetry */
    cumulativeInputTokens: number;
    cumulativeOutputTokens: number;
  };
}

// ============================================================================
// WATCHER CLASS
// ============================================================================

function emptyTypeRecord<T>(zero: T): Record<TriggerType, T> {
  return {
    MOMENTUM_BREAK: zero,
    VOLUME_SPIKE: zero,
    BUY_PRESSURE: zero,
    WHALE_BUY: zero,
    WHALE_SELL: zero,
    LIQUIDITY_VACUUM: zero,
  };
}

export class AlphaWatcher {
  private cohort: string[];
  private interval: ReturnType<typeof setInterval> | null = null;
  private triggers: AlphaTrigger[] = [];
  // Per-token rolling state for delta calculations (e.g., liquidity drop)
  private prevSnapshot: Map<string, { liquidityUSD: number; observedAt: string }> = new Map();
  // Per-token pool address + h24 volume cache. Stable for hours; populated
  // by live ticks and used by replay to avoid burning GT rate limit on
  // redundant getTokenPools calls AND to provide a real 24h baseline
  // (replay's candle window is too short to compute its own).
  private poolAddressCache: Map<string, string> = new Map();
  private poolMetaCache: Map<string, { volume24hUSD: number; updatedAt: number }> = new Map();
  // Most-recent polled prices per symbol — used by Reflex for stop/target
  // monitoring without making redundant API calls.
  private latestPrices: Map<string, number> = new Map();
  // Phase 1.5: cooldown tracking per {symbol, type} — prevents same pattern
  // re-firing every poll while the underlying h1 window barely shifts.
  private lastFired: Map<string, { ts: number; strength: number }> = new Map();
  private status: WatcherStatus = {
    enabled: false,
    cohort: [],
    lastPollAt: null,
    pollErrors: 0,
    totalPollsCompleted: 0,
    triggersFired24h: 0,
    triggersByType24h: emptyTypeRecord(0),
    outcomes24h: {
      resolved: 0,
      open: 0,
      targetHit: 0,
      stopHit: 0,
      decayed: 0,
      hitRate: null,
      byType: emptyTypeRecord({ resolved: 0, targetHit: 0, stopHit: 0, decayed: 0, hitRate: null as number | null }),
    },
    reviews24h: {
      reviewed: 0,
      pending: 0,
      buy: 0,
      wait: 0,
      pass: 0,
      buyHitRate: null,
      cumulativeInputTokens: 0,
      cumulativeOutputTokens: 0,
    },
  };

  constructor(cohortOverride?: string[]) {
    const envCohort = process.env.ALPHA_WATCHER_COHORT
      ?.split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    this.cohort = cohortOverride ?? envCohort ?? DEFAULT_COHORT;
    this.status.cohort = this.cohort;
  }

  start(): void {
    if (this.interval) {
      console.log('[AlphaWatcher] start() called but already running');
      return;
    }
    const pollSec = resolvePollIntervalSec(this.cohort.length);
    console.log(
      `[AlphaWatcher] starting — cohort=${this.cohort.join(',')} (${this.cohort.length}) pollInterval=${pollSec}s`,
    );
    this.status.enabled = true;
    // Fire one immediately so the log gets a first reading without waiting
    this.tick().catch((e) => {
      console.warn(`[AlphaWatcher] initial tick failed: ${e?.message ?? e}`);
    });
    this.interval = setInterval(() => {
      this.tick().catch((e) => {
        console.warn(`[AlphaWatcher] tick failed: ${e?.message ?? e}`);
      });
    }, pollSec * 1000);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.status.enabled = false;
    console.log('[AlphaWatcher] stopped');
  }

  /** Single poll iteration. Public so admin endpoints can force a tick. */
  async tick(): Promise<{ triggers: AlphaTrigger[]; pollsAttempted: number; errors: number }> {
    const firedThisTick: AlphaTrigger[] = [];
    let pollsAttempted = 0;
    let errors = 0;
    // Cache pool data per-symbol for the outcome tracker — avoids a second
    // round-trip when we already have current prices from this poll.
    const polledPrices: Map<string, number> = new Map();

    // v21.40 (Stream R): fetch on-chain prices for the cohort ONCE per tick,
    // before iterating. Only fetches Chainlink ETH (1 RPC call) and the
    // per-cohort-token pool reads (1 RPC call per token in poolRegistry).
    // Total: ~16 RPC calls per tick to free Base RPC. Eliminates the
    // dependency on GeckoTerminal for price freshness on cohort tokens.
    const useOnChainPrices = process.env.ALPHA_WATCHER_ONCHAIN_PRICES === 'true';
    const onChainPrices = new Map<string, number>();
    if (useOnChainPrices) {
      try {
        const chainlinkMap = await fetchChainlinkPrices();
        const ethPrice = chainlinkMap.get('ETH') || chainlinkMap.get('WETH') || 0;
        const btcPrice = chainlinkMap.get('BTC') || chainlinkMap.get('cbBTC') || 0;
        const registry = getPoolRegistry();
        if (ethPrice > 0) {
          await Promise.allSettled(
            this.cohort.map(async (sym) => {
              if (!registry[sym]) return; // no pool entry → GT fallback
              try {
                const p = await fetchOnChainTokenPrice(sym, ethPrice, btcPrice);
                if (p !== null && p > 0 && isFinite(p)) {
                  onChainPrices.set(sym, p);
                }
              } catch { /* per-token failure non-fatal */ }
            }),
          );
        }
      } catch (e: any) {
        console.warn(`[AlphaWatcher] on-chain price prefetch failed: ${e?.message ?? e}`);
      }
    }

    for (const symbol of this.cohort) {
      pollsAttempted++;
      const tokenInfo = TOKEN_REGISTRY[symbol];
      if (!tokenInfo) {
        console.warn(`[AlphaWatcher] no token registry entry for ${symbol} — skipping`);
        errors++;
        continue;
      }
      try {
        const pools = await geckoTerminalService.getTokenPools(tokenInfo.address, 1);
        if (pools.length === 0) continue;
        const pool = pools[0];
        // v21.40 (Stream R): override GeckoTerminal's (possibly stale) price
        // with the on-chain real-time read when available. Only override if
        // the on-chain price is within ±25% of GT's — wider gap means the
        // pool registry's pool differs from the one GT picked, and the
        // safer move is to trust GT for trigger detection consistency.
        const onChainPrice = onChainPrices.get(symbol);
        if (onChainPrice !== undefined && pool.priceUSD > 0) {
          const ratio = onChainPrice / pool.priceUSD;
          if (ratio >= 0.75 && ratio <= 1.25) {
            const before = pool.priceUSD;
            pool.priceUSD = onChainPrice;
            // Quiet log — fires ~15x per tick when active, would flood logs.
            // Console.debug doesn't show in Railway by default; useful in dev.
            if (Math.random() < 0.05) {
              console.log(
                `[AlphaWatcher] ${symbol} price source: on-chain $${onChainPrice.toFixed(6)} (GT was $${before.toFixed(6)}, ratio ${ratio.toFixed(3)})`,
              );
            }
          } else {
            console.warn(
              `[AlphaWatcher] ${symbol} on-chain price $${onChainPrice.toFixed(6)} diverges >25% from GT $${pool.priceUSD.toFixed(6)} — keeping GT (pool mismatch?)`,
            );
          }
        }
        // Cache pool address + h24 volume for replay reuse (avoids redundant
        // GT calls AND gives replay a real 24h baseline for VOLUME_SPIKE).
        this.poolAddressCache.set(symbol, pool.poolAddress);
        this.poolMetaCache.set(symbol, { volume24hUSD: pool.volume.h24, updatedAt: Date.now() });
        polledPrices.set(symbol, pool.priceUSD);
        this.latestPrices.set(symbol, pool.priceUSD);
        const triggers = this.scoreTriggers(symbol, pool);
        for (const t of triggers) {
          this.recordTrigger(t);
          firedThisTick.push(t);
          // Phase 2: kick off Reviewer asynchronously. Don't block the tick
          // — Haiku takes ~2-5s. The trigger is already in the ring buffer;
          // Reviewer mutates the same object reference once it returns.
          if (alphaReviewer.isEnabled()) {
            alphaReviewer
              .review(t)
              .then((review) => {
                if (review) {
                  t.review = review;
                  console.log(
                    `[AlphaReviewer] ${t.symbol}/${t.type} → ${review.verdict} (conf ${review.confidence.toFixed(2)}, ${review.latencyMs}ms): ${review.reasoning.slice(0, 80)}`,
                  );
                  // Phase 3: hand off to Reflex if Reviewer says BUY.
                  // Reflex enforces budget cap, one-per-token, hard stops/timers.
                  // In dry-run mode it just logs would-be entries.
                  if (review.verdict === 'BUY' && alphaReflex.isEnabled()) {
                    alphaReflex.onApprovedBuy(t).catch((e) => {
                      console.warn(`[AlphaReflex] onApprovedBuy threw: ${e?.message ?? e}`);
                    });
                  }
                }
              })
              .catch((e) => {
                console.warn(`[AlphaReviewer] dispatch failed for ${t.symbol}/${t.type}: ${e?.message ?? e}`);
              });
          }
        }
        // Update rolling state for next-tick delta calculations
        this.prevSnapshot.set(symbol, {
          liquidityUSD: pool.liquidity,
          observedAt: new Date().toISOString(),
        });
      } catch (e: any) {
        console.warn(`[AlphaWatcher] ${symbol} poll failed: ${e?.message ?? e}`);
        errors++;
      }
    }

    // Phase 1.5: update outcomes for any open triggers using the prices we
    // already polled this tick. No additional API calls — the price feed
    // we collected for trigger scoring is the same feed the outcomes need.
    this.updateOutcomes(polledPrices);

    // Phase 3: monitor any open Reflex positions for stop/target/timeout.
    // Reflex pulls prices from the same polledPrices map (no extra API).
    if (alphaReflex.isEnabled()) {
      try {
        await alphaReflex.monitorPositions();
      } catch (e: any) {
        console.warn(`[AlphaReflex] monitor threw: ${e?.message ?? e}`);
      }
    }

    this.status.lastPollAt = new Date().toISOString();
    this.status.totalPollsCompleted++;
    this.status.pollErrors += errors;
    this.refreshRollingTriggerCounts();

    if (firedThisTick.length > 0) {
      console.log(
        `[AlphaWatcher] tick: ${firedThisTick.length} trigger(s) fired — ${firedThisTick
          .map((t) => `${t.symbol}/${t.type}@${t.strength.toFixed(2)}`)
          .join(', ')}`,
      );
    }
    return { triggers: firedThisTick, pollsAttempted, errors };
  }

  /**
   * Phase 1.5 paper-trade outcome tracker. Iterates open triggers and
   * updates each based on the current poll's price. A trigger resolves
   * when:
   *   - price hits +OUTCOME_TARGET_PCT (TARGET_HIT — the win)
   *   - price hits -OUTCOME_STOP_PCT first (STOP_HIT — the loss)
   *   - OUTCOME_FOLLOW_MINUTES elapsed without hitting either (DECAYED)
   *
   * Once resolved, status changes from 'OPEN' and we stop updating it.
   */
  private updateOutcomes(currentPrices: Map<string, number>): void {
    const now = Date.now();
    for (const trigger of this.triggers) {
      const out = trigger.outcome;
      if (!out || out.status !== 'OPEN') continue;

      const currentPrice = currentPrices.get(trigger.symbol);
      if (!currentPrice) continue;

      out.observationCount++;
      out.peakPriceUSD = Math.max(out.peakPriceUSD, currentPrice);
      out.troughPriceUSD = Math.min(out.troughPriceUSD, currentPrice);
      out.finalPriceUSD = currentPrice;
      out.finalPctChange = ((currentPrice - out.entryPriceUSD) / out.entryPriceUSD) * 100;
      out.resolvedAt = new Date(now).toISOString();

      // Hit target?
      if (out.finalPctChange >= OUTCOME_TARGET_PCT) {
        out.status = 'TARGET_HIT';
        console.log(
          `[AlphaWatcher] outcome: ${trigger.symbol}/${trigger.type} TARGET_HIT (+${out.finalPctChange.toFixed(2)}%) on trigger from ${trigger.raisedAt}`,
        );
        continue;
      }
      // Hit stop?
      if (out.finalPctChange <= -OUTCOME_STOP_PCT) {
        out.status = 'STOP_HIT';
        console.log(
          `[AlphaWatcher] outcome: ${trigger.symbol}/${trigger.type} STOP_HIT (${out.finalPctChange.toFixed(2)}%) on trigger from ${trigger.raisedAt}`,
        );
        continue;
      }
      // Window expired?
      const triggerAt = new Date(trigger.raisedAt).getTime();
      const minutesElapsed = (now - triggerAt) / 60_000;
      if (minutesElapsed >= OUTCOME_FOLLOW_MINUTES) {
        out.status = 'DECAYED';
        console.log(
          `[AlphaWatcher] outcome: ${trigger.symbol}/${trigger.type} DECAYED (${out.finalPctChange.toFixed(2)}%) after ${minutesElapsed.toFixed(0)}min`,
        );
      }
    }
  }

  /**
   * Score every trigger pattern against the pool's current state. Pure
   * deterministic — no LLM. Returns array of triggers that crossed threshold,
   * filtered through cooldown gate.
   */
  private scoreTriggers(symbol: string, pool: DexPoolData): AlphaTrigger[] {
    const candidates: AlphaTrigger[] = [];
    const now = new Date().toISOString();
    const buys1h = pool.transactions.h1.buys ?? 0;
    const sells1h = pool.transactions.h1.sells ?? 0;
    const totalTx1h = buys1h + sells1h;
    const buyRatio1h = totalTx1h > 0 ? buys1h / totalTx1h : 0.5;
    const avgTradeSize1hUSD = totalTx1h > 0 ? pool.volume.h1 / totalTx1h : 0;
    const volumeSpikeRatio =
      pool.volume.h24 > 0 ? (pool.volume.h1 * 24) / pool.volume.h24 : 0;

    const snapshot: AlphaTrigger['snapshot'] = {
      priceUSD: pool.priceUSD,
      priceChange5m: pool.priceChange.m5,
      priceChange1h: pool.priceChange.h1,
      volume1hUSD: pool.volume.h1,
      volume24hUSD: pool.volume.h24,
      volumeSpikeRatio,
      buys1h,
      sells1h,
      buyRatio1h,
      avgTradeSize1hUSD,
      liquidityUSD: pool.liquidity,
      poolAddress: pool.poolAddress,
    };

    const mkTrigger = (type: TriggerType, strength: number, reason: string): AlphaTrigger => ({
      raisedAt: now,
      symbol,
      type,
      strength,
      reason,
      snapshot,
      outcome: {
        status: 'OPEN',
        entryPriceUSD: pool.priceUSD,
        peakPriceUSD: pool.priceUSD,
        troughPriceUSD: pool.priceUSD,
        finalPriceUSD: pool.priceUSD,
        finalPctChange: 0,
        resolvedAt: now,
        observationCount: 0,
      },
    });

    // ── Trigger 1: Momentum break (5-min price change exceeds threshold) ──
    if (Math.abs(pool.priceChange.m5) >= THRESHOLDS.MOMENTUM_BREAK_PCT_5M) {
      const direction = pool.priceChange.m5 > 0 ? 'UP' : 'DOWN';
      const strength = Math.min(1, Math.abs(pool.priceChange.m5) / 5); // 5% = max strength
      candidates.push(
        mkTrigger(
          'MOMENTUM_BREAK',
          strength,
          `5-min price ${direction} ${pool.priceChange.m5.toFixed(2)}% (threshold ${THRESHOLDS.MOMENTUM_BREAK_PCT_5M}%)`,
        ),
      );
    }

    // ── Trigger 2: Volume spike (current rate × 24 vs 24h baseline) ──
    if (volumeSpikeRatio >= THRESHOLDS.VOLUME_SPIKE_RATIO) {
      const strength = Math.min(1, (volumeSpikeRatio - 1) / 4); // ratio 5 = max strength
      candidates.push(
        mkTrigger(
          'VOLUME_SPIKE',
          strength,
          `Volume rate ${volumeSpikeRatio.toFixed(1)}× normal (h1 $${pool.volume.h1.toFixed(0)} vs h24 $${pool.volume.h24.toFixed(0)})`,
        ),
      );
    }

    // ── Trigger 3: Buy pressure (lopsided buyer/seller ratio) ──
    if (totalTx1h >= 20 && buyRatio1h >= THRESHOLDS.STRONG_BUY_PRESSURE_RATIO) {
      const strength = Math.min(1, (buyRatio1h - 0.5) * 2); // 1.0 ratio = max strength
      candidates.push(
        mkTrigger(
          'BUY_PRESSURE',
          strength,
          `${(buyRatio1h * 100).toFixed(0)}% buys (${buys1h} buys / ${sells1h} sells over 1h)`,
        ),
      );
    }

    // ── Trigger 4: Whale BUY (high avg size + heavy buy ratio) ──
    if (
      totalTx1h >= 5 &&
      avgTradeSize1hUSD >= THRESHOLDS.WHALE_AVG_TRADE_USD &&
      buyRatio1h >= THRESHOLDS.WHALE_BUY_RATIO
    ) {
      const strength = Math.min(1, avgTradeSize1hUSD / 5000);
      candidates.push(
        mkTrigger(
          'WHALE_BUY',
          strength,
          `${buys1h} large buys avg $${avgTradeSize1hUSD.toFixed(0)} (${(buyRatio1h * 100).toFixed(0)}% buy ratio)`,
        ),
      );
    }

    // ── Trigger 5: Whale SELL (high avg size + heavy sell ratio) ──
    if (
      totalTx1h >= 5 &&
      avgTradeSize1hUSD >= THRESHOLDS.WHALE_AVG_TRADE_USD &&
      buyRatio1h <= THRESHOLDS.WHALE_SELL_RATIO
    ) {
      const strength = Math.min(1, avgTradeSize1hUSD / 5000);
      candidates.push(
        mkTrigger(
          'WHALE_SELL',
          strength,
          `${sells1h} large sells avg $${avgTradeSize1hUSD.toFixed(0)} (${((1 - buyRatio1h) * 100).toFixed(0)}% sell ratio)`,
        ),
      );
    }

    // ── Trigger 6: Liquidity vacuum (LP withdrawal between polls) ──
    const prev = this.prevSnapshot.get(symbol);
    if (prev && prev.liquidityUSD > 0 && pool.liquidity > 0) {
      const liquidityDropPct = ((prev.liquidityUSD - pool.liquidity) / prev.liquidityUSD) * 100;
      if (liquidityDropPct >= THRESHOLDS.LIQUIDITY_DROP_PCT) {
        const strength = Math.min(1, liquidityDropPct / 20); // 20% drop = max strength
        candidates.push(
          mkTrigger(
            'LIQUIDITY_VACUUM',
            strength,
            `Liquidity dropped ${liquidityDropPct.toFixed(1)}% since last poll ($${prev.liquidityUSD.toFixed(0)} → $${pool.liquidity.toFixed(0)})`,
          ),
        );
      }
    }

    // ── Cooldown gate ──
    // For each candidate, only emit if either:
    //   (a) no prior fire in TRIGGER_COOLDOWN_MIN, OR
    //   (b) new strength is materially higher (escalation past 1.5x)
    const fired: AlphaTrigger[] = [];
    const nowMs = Date.now();
    for (const c of candidates) {
      const key = `${c.symbol}:${c.type}`;
      const prev = this.lastFired.get(key);
      if (prev) {
        const minutesSince = (nowMs - prev.ts) / 60_000;
        if (
          minutesSince < TRIGGER_COOLDOWN_MIN &&
          c.strength < prev.strength * STRENGTH_ESCALATION_MULTIPLIER
        ) {
          continue; // suppress — within cooldown and not a meaningful escalation
        }
      }
      this.lastFired.set(key, { ts: nowMs, strength: c.strength });
      fired.push(c);
    }

    return fired;
  }

  private recordTrigger(t: AlphaTrigger): void {
    this.triggers.push(t);
    if (this.triggers.length > TRIGGER_RING_BUFFER_SIZE) {
      this.triggers = this.triggers.slice(-TRIGGER_RING_BUFFER_SIZE);
    }
  }

  private refreshRollingTriggerCounts(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = this.triggers.filter((t) => new Date(t.raisedAt).getTime() >= cutoff);
    this.status.triggersFired24h = recent.length;
    const byTypeCount: Record<TriggerType, number> = emptyTypeRecord(0);
    for (const t of recent) byTypeCount[t.type]++;
    this.status.triggersByType24h = byTypeCount;

    // Phase 1.5: outcome rollup. resolved = TARGET_HIT + STOP_HIT + DECAYED.
    // hitRate = TARGET_HIT / resolved (excluding DECAYED matters less than
    // including it — DECAYED means the trigger didn't predict either way,
    // which is information; but hit rate is best understood as "of fired
    // triggers, what fraction reached the +5% target"). We expose both: the
    // primary hitRate uses resolved-with-definitive-outcome (target + stop)
    // as the denominator since DECAYED muddles the precision question.
    const stats = {
      resolved: 0,
      open: 0,
      targetHit: 0,
      stopHit: 0,
      decayed: 0,
      hitRate: null as number | null,
      byType: emptyTypeRecord({ resolved: 0, targetHit: 0, stopHit: 0, decayed: 0, hitRate: null as number | null }),
    };
    // Deep-copy the per-type sub-records so emptyTypeRecord's shared zero
    // object isn't mutated across slots.
    for (const t of Object.keys(stats.byType) as TriggerType[]) {
      stats.byType[t] = { resolved: 0, targetHit: 0, stopHit: 0, decayed: 0, hitRate: null };
    }

    for (const t of recent) {
      const o = t.outcome;
      if (!o) continue;
      const slot = stats.byType[t.type];
      if (o.status === 'OPEN') {
        stats.open++;
      } else {
        stats.resolved++;
        slot.resolved++;
        if (o.status === 'TARGET_HIT') {
          stats.targetHit++;
          slot.targetHit++;
        } else if (o.status === 'STOP_HIT') {
          stats.stopHit++;
          slot.stopHit++;
        } else if (o.status === 'DECAYED') {
          stats.decayed++;
          slot.decayed++;
        }
      }
    }
    const definitive = stats.targetHit + stats.stopHit;
    stats.hitRate = definitive > 0 ? stats.targetHit / definitive : null;
    for (const t of Object.keys(stats.byType) as TriggerType[]) {
      const slot = stats.byType[t];
      const def = slot.targetHit + slot.stopHit;
      slot.hitRate = def > 0 ? slot.targetHit / def : null;
    }
    this.status.outcomes24h = stats;

    // Phase 2: review stats — accuracy of Haiku BUY calls when paired with
    // resolved outcomes. Tells us whether the Reviewer is improving on the
    // Watcher's raw signal or just adding cost.
    let reviewed = 0, pending = 0, buy = 0, wait = 0, pass = 0;
    let reviewerBuyResolved = 0, reviewerBuyTargetHit = 0;
    let cumIn = 0, cumOut = 0;
    for (const t of recent) {
      if (t.review === undefined) {
        pending++;
        continue;
      }
      if (t.review === null) continue; // Reviewer disabled or errored — not counted
      reviewed++;
      cumIn += t.review.inputTokens;
      cumOut += t.review.outputTokens;
      if (t.review.verdict === 'BUY') {
        buy++;
        if (t.outcome && t.outcome.status !== 'OPEN') {
          if (t.outcome.status === 'TARGET_HIT' || t.outcome.status === 'STOP_HIT') {
            reviewerBuyResolved++;
            if (t.outcome.status === 'TARGET_HIT') reviewerBuyTargetHit++;
          }
        }
      } else if (t.review.verdict === 'WAIT') wait++;
      else if (t.review.verdict === 'PASS') pass++;
    }
    this.status.reviews24h = {
      reviewed,
      pending,
      buy,
      wait,
      pass,
      buyHitRate: reviewerBuyResolved > 0 ? reviewerBuyTargetHit / reviewerBuyResolved : null,
      cumulativeInputTokens: cumIn,
      cumulativeOutputTokens: cumOut,
    };
  }

  // --------------------------------------------------------------------------
  // Phase 1.5: Hindsight replay
  // --------------------------------------------------------------------------

  /**
   * Synthesize what the Watcher would have fired over the last N minutes
   * using GeckoTerminal 1-minute OHLCV candles. Then synthesize each
   * trigger's outcome from the subsequent candles.
   *
   * Limitation: only MOMENTUM_BREAK and VOLUME_SPIKE are derivable from
   * candle data. The microstructure-dependent triggers (BUY_PRESSURE,
   * WHALE_BUY/SELL, LIQUIDITY_VACUUM) require live transaction-level data
   * the OHLCV endpoint doesn't expose — those only show up via forward
   * tracking (which the Watcher does in the live tick loop).
   *
   * Returns a structured replay report: per-token candle count, synthetic
   * triggers fired, synthetic outcomes resolved, hit rate by trigger type.
   */
  async replay(minutesBack: number): Promise<{
    minutesBack: number;
    runAt: string;
    perToken: Record<string, {
      poolAddress: string;
      candlesAnalyzed: number;
      syntheticTriggers: Array<{
        type: TriggerType;
        firedAt: string;
        priceUSD: number;
        reason: string;
        outcome: { status: TriggerOutcomeStatus; finalPctChange: number; minutesToResolve: number };
      }>;
    }>;
    summary: {
      totalTriggers: number;
      byType: Record<TriggerType, { fired: number; targetHit: number; stopHit: number; decayed: number; hitRate: number | null }>;
    };
    notes: string[];
  }> {
    const runAt = new Date().toISOString();
    const minutes = Math.max(15, Math.min(720, minutesBack));
    const candleLimit = minutes + OUTCOME_FOLLOW_MINUTES + 5; // buffer for outcome lookahead
    const perToken: Record<string, any> = {};
    const summaryByType: Record<TriggerType, { fired: number; targetHit: number; stopHit: number; decayed: number; hitRate: number | null }> =
      emptyTypeRecord({ fired: 0, targetHit: 0, stopHit: 0, decayed: 0, hitRate: null as number | null });
    for (const t of Object.keys(summaryByType) as TriggerType[]) {
      summaryByType[t] = { fired: 0, targetHit: 0, stopHit: 0, decayed: 0, hitRate: null };
    }
    const notes: string[] = [
      'Replay covers MOMENTUM_BREAK + VOLUME_SPIKE only — these are derivable from candle data.',
      'Microstructure triggers (BUY_PRESSURE, WHALE_BUY/SELL, LIQUIDITY_VACUUM) only show up via forward tracking.',
    ];
    let totalTriggers = 0;

    for (const symbol of this.cohort) {
      const tokenInfo = TOKEN_REGISTRY[symbol];
      if (!tokenInfo) {
        notes.push(`${symbol}: not in TOKEN_REGISTRY`);
        continue;
      }
      try {
        // Prefer cached pool address — avoids burning GT rate limit on a
        // redundant getTokenPools call when the live tick has already
        // discovered the pool. Falls back to fresh fetch if cache empty.
        let poolAddress = this.poolAddressCache.get(symbol);
        if (!poolAddress) {
          const pools = await geckoTerminalService.getTokenPools(tokenInfo.address, 1);
          if (pools.length === 0) {
            notes.push(`${symbol}: getTokenPools returned 0 pools (token=${tokenInfo.address})`);
            perToken[symbol] = { poolAddress: '', candlesAnalyzed: 0, syntheticTriggers: [] };
            continue;
          }
          poolAddress = pools[0].poolAddress;
          this.poolAddressCache.set(symbol, poolAddress);
        }
        const candles = await geckoTerminalService.getOhlcv(poolAddress, 'minute', 1, candleLimit);
        if (candles.length < 6) {
          notes.push(`${symbol}: getOhlcv returned ${candles.length} candles (need ≥6)`);
          perToken[symbol] = { poolAddress, candlesAnalyzed: candles.length, syntheticTriggers: [] };
          continue;
        }
        // For volume-spike comparisons we need a real h24 baseline. Replay's
        // candle window is too short to derive its own (a 3h window would
        // make every minute look like a 2× spike). Use live-tick cached h24,
        // or skip volume-spike triggers entirely if cache is cold.
        const cachedMeta = this.poolMetaCache.get(symbol);
        const h24Volume = cachedMeta?.volume24hUSD ?? 0;
        if (h24Volume === 0) {
          notes.push(`${symbol}: no cached h24 volume — skipping VOLUME_SPIKE in replay (live tick will populate cache)`);
        }

        const syntheticTriggers: Array<{
          type: TriggerType;
          firedAt: string;
          priceUSD: number;
          reason: string;
          outcome: { status: TriggerOutcomeStatus; finalPctChange: number; minutesToResolve: number };
        }> = [];

        // Walk candles chronologically. Skip first 5 (need 5-min lookback for momentum/volume).
        for (let i = 5; i < candles.length; i++) {
          const c = candles[i];
          const fiveMinAgo = candles[i - 5];
          const priceChange5m = ((c.close - fiveMinAgo.close) / fiveMinAgo.close) * 100;

          // Compute synthetic h1 volume from last 60 candles (or whatever we have)
          const lookback = candles.slice(Math.max(0, i - 59), i + 1);
          const h1Volume = lookback.reduce((s, x) => s + x.volumeUSD, 0);
          // h24Volume computed once outside the loop (already in scope).
          const volumeSpikeRatio = h24Volume > 0 ? (h1Volume * 24) / h24Volume : 0;

          // ── Synthetic MOMENTUM_BREAK ──
          if (Math.abs(priceChange5m) >= THRESHOLDS.MOMENTUM_BREAK_PCT_5M) {
            const direction = priceChange5m > 0 ? 'UP' : 'DOWN';
            const outcome = this.synthesizeOutcome(candles, i, c.close);
            syntheticTriggers.push({
              type: 'MOMENTUM_BREAK',
              firedAt: new Date(c.ts * 1000).toISOString(),
              priceUSD: c.close,
              reason: `5-min ${direction} ${priceChange5m.toFixed(2)}%`,
              outcome,
            });
            summaryByType.MOMENTUM_BREAK.fired++;
            if (outcome.status === 'TARGET_HIT') summaryByType.MOMENTUM_BREAK.targetHit++;
            else if (outcome.status === 'STOP_HIT') summaryByType.MOMENTUM_BREAK.stopHit++;
            else if (outcome.status === 'DECAYED') summaryByType.MOMENTUM_BREAK.decayed++;
            totalTriggers++;
          }

          // ── Synthetic VOLUME_SPIKE ──
          if (volumeSpikeRatio >= THRESHOLDS.VOLUME_SPIKE_RATIO) {
            const outcome = this.synthesizeOutcome(candles, i, c.close);
            syntheticTriggers.push({
              type: 'VOLUME_SPIKE',
              firedAt: new Date(c.ts * 1000).toISOString(),
              priceUSD: c.close,
              reason: `Volume rate ${volumeSpikeRatio.toFixed(1)}× (h1 $${h1Volume.toFixed(0)})`,
              outcome,
            });
            summaryByType.VOLUME_SPIKE.fired++;
            if (outcome.status === 'TARGET_HIT') summaryByType.VOLUME_SPIKE.targetHit++;
            else if (outcome.status === 'STOP_HIT') summaryByType.VOLUME_SPIKE.stopHit++;
            else if (outcome.status === 'DECAYED') summaryByType.VOLUME_SPIKE.decayed++;
            totalTriggers++;
          }
        }

        perToken[symbol] = {
          poolAddress,
          candlesAnalyzed: candles.length,
          syntheticTriggers,
        };
      } catch (e: any) {
        notes.push(`${symbol}: ${e?.message ?? 'replay failed'}`);
      }
    }

    // Compute hitRate per type
    for (const t of Object.keys(summaryByType) as TriggerType[]) {
      const s = summaryByType[t];
      const def = s.targetHit + s.stopHit;
      s.hitRate = def > 0 ? s.targetHit / def : null;
    }

    return { minutesBack: minutes, runAt, perToken, summary: { totalTriggers, byType: summaryByType }, notes };
  }

  /**
   * Walk forward from candle index `i` for OUTCOME_FOLLOW_MINUTES looking
   * for whether high crossed +OUTCOME_TARGET_PCT or low crossed
   * -OUTCOME_STOP_PCT first. Returns a synthesized TriggerOutcome.
   */
  private synthesizeOutcome(
    candles: Array<{ ts: number; high: number; low: number; close: number }>,
    startIdx: number,
    entryPrice: number,
  ): { status: TriggerOutcomeStatus; finalPctChange: number; minutesToResolve: number } {
    const targetPrice = entryPrice * (1 + OUTCOME_TARGET_PCT / 100);
    const stopPrice = entryPrice * (1 - OUTCOME_STOP_PCT / 100);
    const lookahead = Math.min(candles.length - startIdx - 1, OUTCOME_FOLLOW_MINUTES);
    let lastPrice = entryPrice;
    for (let j = 1; j <= lookahead; j++) {
      const c = candles[startIdx + j];
      lastPrice = c.close;
      // Check stop and target — within a single 1-min candle, if both bands
      // were touched, treat the closer-to-open as having hit first. Without
      // intra-candle order data, use distance from prior close as the
      // tiebreaker. Conservative: stop wins ties (worse case for hit-rate).
      const hitTarget = c.high >= targetPrice;
      const hitStop = c.low <= stopPrice;
      if (hitTarget && hitStop) {
        const distTarget = targetPrice - candles[startIdx + j - 1].close;
        const distStop = candles[startIdx + j - 1].close - stopPrice;
        if (distTarget < distStop) {
          return { status: 'TARGET_HIT', finalPctChange: OUTCOME_TARGET_PCT, minutesToResolve: j };
        }
        return { status: 'STOP_HIT', finalPctChange: -OUTCOME_STOP_PCT, minutesToResolve: j };
      }
      if (hitTarget) return { status: 'TARGET_HIT', finalPctChange: OUTCOME_TARGET_PCT, minutesToResolve: j };
      if (hitStop) return { status: 'STOP_HIT', finalPctChange: -OUTCOME_STOP_PCT, minutesToResolve: j };
    }
    const finalPct = ((lastPrice - entryPrice) / entryPrice) * 100;
    return { status: 'DECAYED', finalPctChange: finalPct, minutesToResolve: lookahead };
  }

  // --------------------------------------------------------------------------
  // Public read API for admin endpoints
  // --------------------------------------------------------------------------

  getStatus(): WatcherStatus {
    return { ...this.status, cohort: [...this.status.cohort] };
  }

  getTriggers(limit = 100): AlphaTrigger[] {
    return this.triggers.slice(-limit).reverse();
  }

  /**
   * Latest polled price for a cohort token, or undefined if the symbol
   * hasn't been polled yet (or the token isn't in the cohort). Reflex
   * uses this for stop/target monitoring — same data source as the
   * Watcher's tick loop, no additional API calls.
   */
  getLatestPrice(symbol: string): number | undefined {
    return this.latestPrices.get(symbol);
  }

  /**
   * NVR-SPEC-029 Watcher-Direct Alpha Execution.
   *
   * Returns the freshest BUY-reviewed bullish triggers for AlphaHunter to
   * consume directly — bypassing the 24h conviction formula in
   * token-discovery (which structurally excludes 1h microstructure setups,
   * see INVESTIGATION_2026-05-08_Conviction-Formula-Diagnosis.md).
   *
   * Selection rules:
   *   - Bullish trigger types ONLY (WHALE_BUY, BUY_PRESSURE, MOMENTUM_BREAK
   *     with positive 5m direction, VOLUME_SPIKE). Excludes WHALE_SELL and
   *     LIQUIDITY_VACUUM — those are exit signals, not entry signals.
   *   - Trigger raised within `windowMinutes` (default 30) — old triggers
   *     don't represent current microstructure.
   *   - Has a Reviewer verdict of 'BUY' with confidence ≥ `minConfidence`
   *     (default 0.7 — tighter than Reflex's 0.6 because sleeve sizing
   *     is larger and the position sits longer than Reflex's 30-min reflex).
   *   - Per symbol, dedupe to the freshest qualifying trigger so we don't
   *     return three entries for the same token in the same window.
   *
   * Sort: most-recent first, ties broken by confidence descending.
   *
   * Output capped at `limit` (default 3) — keep the candidate stream
   * narrow so the sleeve doesn't drown.
   *
   * Pure read — no mutation, no I/O. Safe to call from the hot path.
   *
   * Caller still applies all existing risk gates (held / protected /
   * USDC budget / position cap / sleeve allocation reservation). This is
   * a candidate-source change, not a risk-management change.
   */
  getWatcherDirectCandidates(opts: {
    windowMinutes?: number;
    minConfidence?: number;
    limit?: number;
  } = {}): Array<{
    symbol: string;
    /**
     * Bullish trigger types ONLY — selection guarantees this. Narrowed from
     * the full TriggerType union so the consuming SleeveContext can carry
     * a tight type without runtime checks at the boundary.
     */
    triggerType: 'WHALE_BUY' | 'BUY_PRESSURE' | 'MOMENTUM_BREAK' | 'VOLUME_SPIKE';
    raisedAt: string;
    reviewerConfidence: number;
    reviewerReasoning: string;
    triggerStrength: number;
    triggerReason: string;
  }> {
    const windowMinutes = opts.windowMinutes ?? 30;
    const minConfidence = opts.minConfidence ?? 0.7;
    const limit = Math.max(1, opts.limit ?? 3);
    const cutoffMs = Date.now() - windowMinutes * 60_000;

    const isBullishType = (t: TriggerType): boolean =>
      t === 'WHALE_BUY' ||
      t === 'BUY_PRESSURE' ||
      t === 'MOMENTUM_BREAK' ||
      t === 'VOLUME_SPIKE';

    // Pass 1: filter for bullish + recent + reviewed BUY + confident.
    // For MOMENTUM_BREAK we additionally require positive 5m direction
    // (the trigger fires on absolute |change| so a -2% move and a +2%
    // move both qualify; only the latter is a buy signal).
    const eligible = this.triggers.filter((t) => {
      if (!isBullishType(t.type)) return false;
      if (new Date(t.raisedAt).getTime() < cutoffMs) return false;
      if (t.type === 'MOMENTUM_BREAK' && t.snapshot.priceChange5m <= 0) return false;
      const r = t.review;
      if (!r || r.verdict !== 'BUY') return false;
      if (r.confidence < minConfidence) return false;
      return true;
    });

    // Pass 2: dedupe by symbol — keep the freshest qualifying trigger per
    // symbol (multiple distinct trigger types on the same token in the
    // same window are common; we want one candidate per symbol).
    const bySymbol = new Map<
      string,
      (typeof eligible)[number]
    >();
    for (const t of eligible) {
      const cur = bySymbol.get(t.symbol);
      if (!cur || new Date(t.raisedAt).getTime() > new Date(cur.raisedAt).getTime()) {
        bySymbol.set(t.symbol, t);
      }
    }

    // Pass 3: sort by recency desc, then confidence desc.
    const sorted = Array.from(bySymbol.values()).sort((a, b) => {
      const tDelta = new Date(b.raisedAt).getTime() - new Date(a.raisedAt).getTime();
      if (tDelta !== 0) return tDelta;
      const aC = a.review?.confidence ?? 0;
      const bC = b.review?.confidence ?? 0;
      return bC - aC;
    });

    return sorted.slice(0, limit).map((t) => ({
      symbol: t.symbol,
      // Cast: isBullishType filter above guarantees this narrowing at runtime.
      triggerType: t.type as 'WHALE_BUY' | 'BUY_PRESSURE' | 'MOMENTUM_BREAK' | 'VOLUME_SPIKE',
      raisedAt: t.raisedAt,
      reviewerConfidence: t.review?.confidence ?? 0,
      reviewerReasoning: (t.review?.reasoning ?? '').slice(0, 120),
      triggerStrength: t.strength,
      triggerReason: t.reason,
    }));
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

export const alphaWatcher = new AlphaWatcher();
