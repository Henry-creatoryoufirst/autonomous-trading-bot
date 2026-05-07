/**
 * NVR-SPEC-028 Phase 1: Always-On Alpha Watcher
 *
 * The Watcher's job is to recognize physics-level setups in real time on a
 * narrow set of tokens, without burning LLM tokens on the scan loop. Pure
 * deterministic scoring — the LLM only enters at the Reviewer gate (Phase 2).
 *
 * Architecture:
 *   - Polls GeckoTerminal pool data every WATCHER_POLL_INTERVAL_SEC for the
 *     watched cohort. Per-pool data includes 5m/1h price changes, 1h/24h
 *     volume, buy/sell counts, liquidity, buyers/sellers.
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

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Default watched cohort. Tokens with high enough volume that 5-15% intraday
 * moves happen daily, distinct enough character that they don't move as one
 * correlated bloc, and stable enough contracts not to rug. Excludes WETH —
 * Core handles WETH; AlphaHunter focuses on the volatile mid/small-caps.
 *
 * Override via env: ALPHA_WATCHER_COHORT="AERO,VIRTUAL,AIXBT,CLANKER"
 */
const DEFAULT_COHORT = ['AERO', 'VIRTUAL', 'AIXBT', 'CLANKER'];

const WATCHER_POLL_INTERVAL_SEC = Math.max(
  20,
  parseInt(process.env.ALPHA_WATCHER_POLL_SEC ?? '30', 10),
);

const TRIGGER_RING_BUFFER_SIZE = 500;

// ============================================================================
// TRIGGER THRESHOLDS — tuneable, will be retuned by Phase 4 outcome learning.
// ============================================================================

const THRESHOLDS = {
  // Momentum break: 5-min price change exceeds this absolute pct
  MOMENTUM_BREAK_PCT_5M: 1.5,
  // Volume spike: h1 volume × 24 (annualized rate) divided by h24 volume
  VOLUME_SPIKE_RATIO: 2.0,
  // Buy pressure: buys / (buys + sells) over h1
  STRONG_BUY_PRESSURE_RATIO: 0.65,
  // Whale arrival: avg trade size in h1, USD
  WHALE_AVG_TRADE_USD: 500,
  // Liquidity vacuum: pool liquidity drops > N% from prior poll
  LIQUIDITY_DROP_PCT: 5,
};

// ============================================================================
// TYPES
// ============================================================================

export type TriggerType =
  | 'MOMENTUM_BREAK'
  | 'VOLUME_SPIKE'
  | 'BUY_PRESSURE'
  | 'WHALE_ARRIVAL'
  | 'LIQUIDITY_VACUUM';

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
}

export interface WatcherStatus {
  enabled: boolean;
  cohort: string[];
  lastPollAt: string | null;
  pollErrors: number;
  totalPollsCompleted: number;
  triggersFired24h: number;
  triggersByType24h: Record<TriggerType, number>;
}

// ============================================================================
// WATCHER CLASS
// ============================================================================

export class AlphaWatcher {
  private cohort: string[];
  private interval: ReturnType<typeof setInterval> | null = null;
  private triggers: AlphaTrigger[] = [];
  // Per-token rolling state for delta calculations (e.g., liquidity drop)
  private prevSnapshot: Map<string, { liquidityUSD: number; observedAt: string }> = new Map();
  private status: WatcherStatus = {
    enabled: false,
    cohort: [],
    lastPollAt: null,
    pollErrors: 0,
    totalPollsCompleted: 0,
    triggersFired24h: 0,
    triggersByType24h: {
      MOMENTUM_BREAK: 0,
      VOLUME_SPIKE: 0,
      BUY_PRESSURE: 0,
      WHALE_ARRIVAL: 0,
      LIQUIDITY_VACUUM: 0,
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
    console.log(
      `[AlphaWatcher] starting — cohort=${this.cohort.join(',')} pollInterval=${WATCHER_POLL_INTERVAL_SEC}s`,
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
    }, WATCHER_POLL_INTERVAL_SEC * 1000);
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
        const triggers = this.scoreTriggers(symbol, pool);
        for (const t of triggers) {
          this.recordTrigger(t);
          firedThisTick.push(t);
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
   * Score every trigger pattern against the pool's current state. Pure
   * deterministic — no LLM. Returns array of triggers that crossed threshold.
   */
  private scoreTriggers(symbol: string, pool: DexPoolData): AlphaTrigger[] {
    const fired: AlphaTrigger[] = [];
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

    // ── Trigger 1: Momentum break (5-min price change exceeds threshold) ──
    if (Math.abs(pool.priceChange.m5) >= THRESHOLDS.MOMENTUM_BREAK_PCT_5M) {
      const direction = pool.priceChange.m5 > 0 ? 'UP' : 'DOWN';
      const strength = Math.min(1, Math.abs(pool.priceChange.m5) / 5); // 5% = max strength
      fired.push({
        raisedAt: now,
        symbol,
        type: 'MOMENTUM_BREAK',
        strength,
        reason: `5-min price ${direction} ${pool.priceChange.m5.toFixed(2)}% (threshold ${THRESHOLDS.MOMENTUM_BREAK_PCT_5M}%)`,
        snapshot,
      });
    }

    // ── Trigger 2: Volume spike (current rate × 24 vs 24h baseline) ──
    if (volumeSpikeRatio >= THRESHOLDS.VOLUME_SPIKE_RATIO) {
      const strength = Math.min(1, (volumeSpikeRatio - 1) / 4); // ratio 5 = max strength
      fired.push({
        raisedAt: now,
        symbol,
        type: 'VOLUME_SPIKE',
        strength,
        reason: `Volume rate ${volumeSpikeRatio.toFixed(1)}× normal (h1 $${pool.volume.h1.toFixed(0)} vs h24 $${pool.volume.h24.toFixed(0)})`,
        snapshot,
      });
    }

    // ── Trigger 3: Buy pressure (lopsided buyer/seller ratio) ──
    if (totalTx1h >= 20 && buyRatio1h >= THRESHOLDS.STRONG_BUY_PRESSURE_RATIO) {
      const strength = Math.min(1, (buyRatio1h - 0.5) * 2); // 1.0 ratio = max strength
      fired.push({
        raisedAt: now,
        symbol,
        type: 'BUY_PRESSURE',
        strength,
        reason: `${(buyRatio1h * 100).toFixed(0)}% buys (${buys1h} buys / ${sells1h} sells over 1h)`,
        snapshot,
      });
    }

    // ── Trigger 4: Whale arrival (high avg trade size in h1) ──
    if (totalTx1h >= 5 && avgTradeSize1hUSD >= THRESHOLDS.WHALE_AVG_TRADE_USD) {
      const strength = Math.min(1, avgTradeSize1hUSD / 5000); // $5K avg = max strength
      fired.push({
        raisedAt: now,
        symbol,
        type: 'WHALE_ARRIVAL',
        strength,
        reason: `Avg trade size $${avgTradeSize1hUSD.toFixed(0)} (${totalTx1h} txs over 1h)`,
        snapshot,
      });
    }

    // ── Trigger 5: Liquidity vacuum (LP withdrawal between polls) ──
    const prev = this.prevSnapshot.get(symbol);
    if (prev && prev.liquidityUSD > 0 && pool.liquidity > 0) {
      const liquidityDropPct = ((prev.liquidityUSD - pool.liquidity) / prev.liquidityUSD) * 100;
      if (liquidityDropPct >= THRESHOLDS.LIQUIDITY_DROP_PCT) {
        const strength = Math.min(1, liquidityDropPct / 20); // 20% drop = max strength
        fired.push({
          raisedAt: now,
          symbol,
          type: 'LIQUIDITY_VACUUM',
          strength,
          reason: `Liquidity dropped ${liquidityDropPct.toFixed(1)}% since last poll ($${prev.liquidityUSD.toFixed(0)} → $${pool.liquidity.toFixed(0)})`,
          snapshot,
        });
      }
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
    const byType: Record<TriggerType, number> = {
      MOMENTUM_BREAK: 0,
      VOLUME_SPIKE: 0,
      BUY_PRESSURE: 0,
      WHALE_ARRIVAL: 0,
      LIQUIDITY_VACUUM: 0,
    };
    for (const t of recent) byType[t.type]++;
    this.status.triggersByType24h = byType;
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
}

// ============================================================================
// SINGLETON
// ============================================================================

export const alphaWatcher = new AlphaWatcher();
