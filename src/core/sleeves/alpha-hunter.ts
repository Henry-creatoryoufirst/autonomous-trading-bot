/**
 * NVR Capital — Alpha Hunter Sleeve v1.
 *
 * v21.16 Phase 2: first real strategy. Runs in paper mode at 0% allocation,
 * striking meme/alt candidates surfaced by the token-discovery engine.
 *
 * Thesis (from founding_spirit + alpha_hunt_obsession memories):
 *   Alpha lives in meme/alt swings, not blue chips. Catch them early with
 *   tight exits. Pulling profits is the edge, not picking winners.
 *
 * Strategy shape:
 *   ENTRIES
 *     - Candidate has conviction ≥ ALPHA_MIN_CONVICTION from discovery engine
 *     - Prioritize runners (exceptional momentum) over baseline candidates
 *     - Not already held (no averaging down on Alpha)
 *     - Max one new entry per cycle (avoid stampedes on shared signals)
 *     - Max ALPHA_MAX_POSITIONS concurrent positions
 *     - Size = min(ceiling, max(floor, budget × ALPHA_POSITION_SIZE_PCT))
 *
 *   EXITS (every cycle, against every held position)
 *     - Drawdown override: P&L ≤ ALPHA_DRAWDOWN_OVERRIDE_PCT (-5%) →
 *       IMMEDIATE exit, regardless of momentum. Tighter than Core's -8%.
 *     - Take-profit: P&L ≥ ALPHA_PROFIT_TAKE_PCT (+15%) → exit; capture
 *       the swing before mean reversion eats it.
 *     - Stale: age ≥ ALPHA_MAX_HOLD_HOURS (48h) AND P&L < +2% → exit;
 *       thesis played out.
 *   All exits mark 100% close — Alpha doesn't trim; it cycles.
 *
 * Why these specific numbers:
 *   - -5% drawdown: 1% below Core's -8% (SPEC-015) so Alpha cuts earlier,
 *     as befits a higher-turnover hypothesis. Below the stop-loss buffer
 *     so rules don't collide.
 *   - +15% profit-take: meme/alt swings commonly 10-30%; taking +15%
 *     captures the bulk of typical moves without waiting for peaks.
 *   - 48h max-hold: half of Core's 48h+ stale threshold window. Alpha is
 *     meant to be fast; if a thesis hasn't played in 2 days, it won't.
 *   - Conviction ≥ 65: discovery engine's composite score (0-100) floor.
 *     Runners auto-prioritize; this keeps non-runner entries above noise.
 *   - 5% of virtual budget per strike: tight enough that one loss doesn't
 *     blow up the sleeve, wide enough that a winner matters.
 *   - Max 3 open positions: concentration in highest-conviction; avoids
 *     spray-and-pray dilution.
 *
 * See NVR-SPEC-010 (sleeve architecture), NVR-SPEC-016 (graduation criteria),
 * NVR-SPEC-017 (Alpha Hunter v1 strategy spec — in draft).
 */

import type {
  Sleeve,
  SleeveContext,
  SleeveDecision,
  SleeveStats,
  SleeveMode,
  WatcherDirectCandidate,
} from './types.js';
import type { SleeveOwnership, SleeveExitOverride } from './state-types.js';
import { statsFromOwnership } from './sleeve-stats.js';
import { outcomeTracker } from '../services/outcome-tracker.js';

// ============================================================================
// STRATEGY CONSTANTS
// ============================================================================

/** Discovery composite score floor. Below this, don't strike. */
const ALPHA_MIN_CONVICTION = 65;

/** Max concurrent Alpha positions. Concentrate in highest conviction. */
const ALPHA_MAX_POSITIONS = 3;

/** Max new entries per cycle. One-shot per cycle even if 5 runners flash. */
const ALPHA_MAX_NEW_ENTRIES_PER_CYCLE = 1;

/** Fraction of the sleeve's capital budget for each new entry. */
const ALPHA_POSITION_SIZE_PCT = 0.05;

/** Dollar floor — won't enter if sizing drops below this. */
const ALPHA_POSITION_SIZE_FLOOR_USD = 10;

/** Dollar ceiling — caps over-sizing when budget is large. */
const ALPHA_POSITION_SIZE_CEILING_USD = 100;

// v21.36: Specialist sizing — scale position size by per-token wallet
// hit-rate data from the outcome tracker. When wallets that historically
// predict 4h moves on THIS specific token have high hit rates, AlphaHunter
// sizes UP (riding the specialist signal). When no specialist data exists
// (cold start, or thin data), the multiplier is exactly 1.0 — same
// behavior as before. Flag-gated for safe rollout.
//
// Formula: linear map of avg(top 3 specialists' hit_rate_4h) ∈ [0, 1] to
// multiplier ∈ [MIN, MAX]. Hit rate 0.5 (random) ≈ 1.05x; 0.65 ≈ 1.19x;
// 0.8 ≈ 1.32x; 1.0 ≈ 1.5x. Bounded by floor/ceiling in clamp step.
const ALPHA_SPECIALIST_MULTIPLIER_MIN = 0.6;
const ALPHA_SPECIALIST_MULTIPLIER_MAX = 1.5;
const ALPHA_SPECIALIST_TOP_N = 3;

interface SpecialistSizing {
  multiplier: number;
  reason: string;
}

function getTokenSpecialistMultiplier(symbol: string): SpecialistSizing {
  if (process.env.ALPHA_SPECIALIST_SIZING_ENABLED !== 'true') {
    return { multiplier: 1.0, reason: 'disabled' };
  }
  try {
    const byToken = outcomeTracker.getWalletHitRatesByToken();
    const specialists = byToken[symbol.toUpperCase()] || [];
    if (specialists.length === 0) {
      return { multiplier: 1.0, reason: `no specialist data for ${symbol} (neutral 1.0x)` };
    }
    const top = specialists.slice(0, ALPHA_SPECIALIST_TOP_N);
    const avgHitRate =
      top.reduce((s, w) => s + (w.hitRate4h ?? 0), 0) / top.length;
    const raw =
      ALPHA_SPECIALIST_MULTIPLIER_MIN +
      avgHitRate *
        (ALPHA_SPECIALIST_MULTIPLIER_MAX - ALPHA_SPECIALIST_MULTIPLIER_MIN);
    const clamped = Math.max(
      ALPHA_SPECIALIST_MULTIPLIER_MIN,
      Math.min(ALPHA_SPECIALIST_MULTIPLIER_MAX, raw),
    );
    return {
      multiplier: clamped,
      reason: `${top.length} specialists (n=${top
        .map((w) => w.totalSignals)
        .join(',')}); avg hit_rate_4h ${(avgHitRate * 100).toFixed(0)}% → ${clamped.toFixed(2)}x`,
    };
  } catch (err) {
    return {
      multiplier: 1.0,
      reason: `outcome-tracker error (safe fallback 1.0x): ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

/** Take-profit threshold. At +X% unrealized, book the win. */
const ALPHA_PROFIT_TAKE_PCT = 15;

/** Drawdown override — exit at -X% regardless of momentum (default). */
const ALPHA_DRAWDOWN_OVERRIDE_PCT_DEFAULT = -5;

/** Stale-exit: after this long, require meaningful gain or exit. */
const ALPHA_MAX_HOLD_HOURS_DEFAULT = 48;

/** Gain threshold for the stale-exit "played out" check. */
const ALPHA_STALE_MAX_GAIN_PCT_DEFAULT = 2;

/** Tokens we never touch with Alpha — they're Core's territory or liquidity. */
const ALPHA_NEVER_BUY = new Set(['USDC', 'ETH', 'WETH', 'cbBTC', 'cbETH', 'wstETH']);

// ============================================================================
// WD TIGHT EXITS (NVR-SPEC-029 follow-on)
// ============================================================================
//
// Watcher-Direct entries catch 1h microstructure setups (volume spike, whale
// buy, momentum break). The thesis is fast: a few percent up in the next
// hour or two, then back to noise. The bot's generic exit gates (48h stale,
// -8% drawdown cut, -5% sleeve drawdown override) don't fit that shape —
// they let WD entries round-trip to flat or worse while we wait for either
// the +15% sleeve take-profit or 48h timeout. Tight exits encode the WD
// thesis directly: lock the small win or get out fast.
//
// Read once at module init. Flipping requires redeploy — these are real-money
// behaviour and a per-cycle flag flap is a footgun.
const WD_TIGHT_EXITS_ENABLED = process.env.ALPHA_HUNTER_WD_TIGHT_EXITS === 'true';

function parsePositiveFloat(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Sell 100% at +X% above entry. */
const WD_TAKE_PROFIT_PCT = parsePositiveFloat(process.env.WD_TAKE_PROFIT_PCT, 8);
/** Once gain has crossed +5%, trail and sell on a -X% drop from peak. */
const WD_TRAILING_STOP_PCT = parsePositiveFloat(process.env.WD_TRAILING_STOP_PCT, 3);
/** Sell 100% if still held after X hours regardless of state. */
const WD_MAX_HOLD_HOURS = parsePositiveFloat(process.env.WD_MAX_HOLD_HOURS, 12);
/** Gain threshold that arms the trailing stop. Hardcoded — not worth a tunable. */
const WD_TRAIL_ARM_GAIN_PCT = 5;

/**
 * NVR-SPEC-029: Env flag gate for the Watcher-Direct candidate stream.
 * When false (default), AlphaHunter behaviour is unchanged from v21.31:
 * it only consumes `market.discovery.candidates` (24h conviction formula).
 * When true, it consumes `market.watcherDirect.candidates` FIRST and falls
 * through to discovery if no watcher-direct candidate passes risk gates.
 *
 * Read at decide() time (not import time) so the env flag is honored even
 * when changed via runtime config reload — and so unit tests can flip it
 * via `process.env` without re-importing the module.
 */
function isWatcherDirectEnabled(): boolean {
  return (process.env.ALPHA_HUNTER_WATCHER_DIRECT ?? 'false').toLowerCase() === 'true';
}

/**
 * NVR-SPEC-029: Telemetry counters for the Watcher-Direct candidate path.
 * Counters live on the sleeve instance so the dashboard /api/sleeves layer
 * can pick them up alongside getStats() in a follow-up wiring step. For
 * the soak window, these are also surfaced via console logs with the
 * [ALPHA_HUNTER_WD] prefix on every candidate evaluation.
 */
/**
 * NVR-SPEC-029 tight-exit follow-on: per-symbol bookkeeping for positions
 * that AlphaHunter opened via the Watcher-Direct path. Used by the WD
 * tight-exit gates (take-profit / trailing-stop / max-hold) so we don't
 * subject discovery-path positions to WD-shaped exits.
 *
 * Lives in-memory on the sleeve instance (not in AgentState). On bot
 * restart the WD tag is lost and a still-held WD position falls back to
 * the generic Alpha exits — safe degradation, not silent over-trading.
 */
export interface WdEntryRecord {
  /** Avg cost per token at entry; used as the basis for HWM/TP math. */
  entryPrice: number;
  /** ISO timestamp of the WD BUY decision. Drives the max-hold gate. */
  entryTime: string;
  /**
   * Highest observed price since entry. Updated every cycle the position
   * is still held. Drives the trailing-stop gate once gain crosses
   * WD_TRAIL_ARM_GAIN_PCT.
   */
  peakPrice: number;
}

export interface WatcherDirectStats {
  /** Cycles where ≥1 watcher-direct candidate was offered to the sleeve. */
  cyclesWithCandidates: number;
  /** Total watcher-direct candidates evaluated (sum across cycles). */
  candidatesEvaluated: number;
  /** Watcher-direct candidates that resulted in a BUY decision. */
  executions: number;
  /** Skip reasons keyed by structured tag (held/protected/budget/cap/etc). */
  skippedByReason: Record<string, number>;
  /** ISO timestamp of the most recent watcher-direct execution. */
  lastExecutionAt: string | null;
}

export interface AlphaHunterSleeveOptions {
  /** Defaults to 'paper'. Graduate via NVR-SPEC-016 criteria. */
  mode?: SleeveMode;
  /**
   * Provider that returns this sleeve's ownership record from AgentState.
   * Called each time `getStats()` runs. Keep cheap: no I/O, just a reference.
   * When omitted, `getStats()` returns zeroed stats.
   */
  getOwnership?: () => SleeveOwnership | undefined;
  /**
   * Current total portfolio USD value (denominator for rolling Sharpe).
   * When omitted or 0, Sharpe reports null.
   */
  getPortfolioValue?: () => number;
  /**
   * Per-sleeve exit discipline overrides from SleeveConfig. When absent,
   * the strategy's built-in defaults apply.
   */
  getExitOverride?: () => SleeveExitOverride | undefined;
}

/**
 * v21.31: synthetic HOLD decision used to surface "no-entry" reasoning to
 * the orchestrator's decision log. Strategy logic unchanged — these are
 * pure visibility records the cockpit can render so silent HOLDs become
 * informative.
 *
 * The orchestrator's logSleeveDecision (orchestrator.ts:159) already maps
 * non-BUY/SELL actions to 'HOLD' and reads the reasoning field, so the
 * existing record schema is enough — no new fields needed.
 */
function makeHold(reasoning: string): SleeveDecision {
  return {
    action: 'HOLD',
    fromToken: 'USDC',
    toToken: 'USDC',
    amountUSD: 0,
    reasoning,
  };
}

export class AlphaHunterSleeve implements Sleeve {
  readonly id = 'alpha-hunter';
  readonly displayName = 'Alpha Hunter';
  readonly mode: SleeveMode;
  /** Alpha sleeves start with zero floor — they haven't graduated. */
  readonly minCapitalPct = 0;
  /** Ceiling set low during paper phase; SPEC-016 raises on graduation. */
  readonly maxCapitalPct = 0.15;

  private readonly getOwnership?: () => SleeveOwnership | undefined;
  private readonly getPortfolioValue?: () => number;
  private readonly getExitOverride?: () => SleeveExitOverride | undefined;

  /**
   * NVR-SPEC-029: rolling counters for the watcher-direct candidate path.
   * Read by getWatcherDirectStats() for telemetry / soak observability.
   */
  private wdStats: WatcherDirectStats = {
    cyclesWithCandidates: 0,
    candidatesEvaluated: 0,
    executions: 0,
    skippedByReason: {},
    lastExecutionAt: null,
  };

  /**
   * NVR-SPEC-029 tight-exit follow-on: symbols this sleeve entered via the
   * Watcher-Direct path. Cleared per-symbol when the WD tight-exit fires
   * (or when the discovery exits sweep the symbol — gc'd next cycle when
   * the position no longer appears in ctx.positions).
   */
  private wdEntries = new Map<string, WdEntryRecord>();

  constructor(opts: AlphaHunterSleeveOptions = {}) {
    this.mode = opts.mode ?? 'paper';
    this.getOwnership = opts.getOwnership;
    this.getPortfolioValue = opts.getPortfolioValue;
    this.getExitOverride = opts.getExitOverride;
  }

  /**
   * Snapshot of the watcher-direct telemetry for this sleeve. Cheap; safe
   * to call from dashboard / API. Returns a clone so callers can't mutate.
   */
  getWatcherDirectStats(): WatcherDirectStats {
    return {
      cyclesWithCandidates: this.wdStats.cyclesWithCandidates,
      candidatesEvaluated: this.wdStats.candidatesEvaluated,
      executions: this.wdStats.executions,
      skippedByReason: { ...this.wdStats.skippedByReason },
      lastExecutionAt: this.wdStats.lastExecutionAt,
    };
  }

  private bumpWdSkip(reason: string): void {
    this.wdStats.skippedByReason[reason] =
      (this.wdStats.skippedByReason[reason] ?? 0) + 1;
  }

  /**
   * NVR-SPEC-029 tight-exit follow-on. Decides whether a WD-tagged position
   * should be sold this cycle. Returns a SELL TradeDecision if any gate
   * fires, otherwise null (the position keeps riding). Mutates `rec` to
   * keep peakPrice fresh and to patch a missing entryPrice on first
   * sighting.
   *
   * Gate order (first-match wins):
   *   1. WD_TAKE_PROFIT_PCT — price ≥ entry × (1 + tp%)
   *   2. WD trailing stop — once gain has crossed WD_TRAIL_ARM_GAIN_PCT,
   *      sell on price ≤ peak × (1 - trail%)
   *   3. WD_MAX_HOLD_HOURS — sell regardless of state
   *
   * Routes through normal executeTrade so risk-review / surge-cap / MEV
   * protection still apply — this just emits the decision intent.
   */
  private evaluateWdTightExit(
    symbol: string,
    price: number,
    currentValue: number,
    rec: WdEntryRecord,
    nowMs: number,
  ): SleeveDecision | null {
    // Repair an unset entry price on first sighting (BUY decision may have
    // landed without a price hint in the orchestrator snapshot).
    if (!rec.entryPrice || rec.entryPrice <= 0) {
      rec.entryPrice = price;
      rec.peakPrice = price;
    }
    // Track the new high.
    if (price > rec.peakPrice) rec.peakPrice = price;

    const gainPct = ((price - rec.entryPrice) / rec.entryPrice) * 100;
    const heldMs = nowMs - new Date(rec.entryTime).getTime();
    const heldMin = heldMs / 60_000;
    const heldHours = heldMs / 3_600_000;
    const heldLabel = heldMin < 90
      ? `${heldMin.toFixed(0)}min`
      : `${heldHours.toFixed(1)}h`;

    // 1. Take-profit
    if (gainPct >= WD_TAKE_PROFIT_PCT) {
      this.wdEntries.delete(symbol);
      return {
        action: 'SELL',
        fromToken: symbol,
        toToken: 'USDC',
        amountUSD: currentValue,
        percent: 100,
        reasoning:
          `WD_TAKE_PROFIT: +${gainPct.toFixed(1)}% ≥ +${WD_TAKE_PROFIT_PCT}% above entry $${rec.entryPrice.toPrecision(6)}, ` +
          `held ${heldLabel}. NVR-SPEC-029 tight exit — lock the win before mean reversion.`,
      };
    }

    // 2. Trailing stop (only after the position armed it by hitting +5%)
    const armingGainPct = ((rec.peakPrice - rec.entryPrice) / rec.entryPrice) * 100;
    if (armingGainPct >= WD_TRAIL_ARM_GAIN_PCT) {
      const stopPrice = rec.peakPrice * (1 - WD_TRAILING_STOP_PCT / 100);
      if (price <= stopPrice) {
        const dropPct = ((price - rec.peakPrice) / rec.peakPrice) * 100;
        this.wdEntries.delete(symbol);
        return {
          action: 'SELL',
          fromToken: symbol,
          toToken: 'USDC',
          amountUSD: currentValue,
          percent: 100,
          reasoning:
            `WD_TRAILING_STOP: peak +${armingGainPct.toFixed(1)}% from entry $${rec.entryPrice.toPrecision(6)} → ` +
            `now ${dropPct.toFixed(1)}% off peak (≤ -${WD_TRAILING_STOP_PCT}%), held ${heldLabel}. ` +
            `NVR-SPEC-029 tight exit — give back ${WD_TRAILING_STOP_PCT}% max once armed.`,
        };
      }
    }

    // 3. Max-hold
    if (heldHours >= WD_MAX_HOLD_HOURS) {
      this.wdEntries.delete(symbol);
      return {
        action: 'SELL',
        fromToken: symbol,
        toToken: 'USDC',
        amountUSD: currentValue,
        percent: 100,
        reasoning:
          `WD_MAX_HOLD: held ${heldHours.toFixed(1)}h ≥ ${WD_MAX_HOLD_HOURS}h at ${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%. ` +
          `NVR-SPEC-029 tight exit — 1h microstructure thesis times out.`,
      };
    }

    return null;
  }

  /**
   * v1 strategy. Produces exits for every held position that trips a rule,
   * plus up to ALPHA_MAX_NEW_ENTRIES_PER_CYCLE new strikes from the top of
   * the discovery candidate list.
   *
   * Runs every cycle. Safe to call with empty discovery (returns exits only).
   */
  async decide(ctx: SleeveContext): Promise<SleeveDecision[]> {
    const decisions: SleeveDecision[] = [];
    const nowMs = Date.now();
    const override = this.getExitOverride?.() ?? {};
    const drawdownCutPct = override.drawdownOverridePct ?? ALPHA_DRAWDOWN_OVERRIDE_PCT_DEFAULT;
    const maxHoldHours = override.maxHoldHours ?? ALPHA_MAX_HOLD_HOURS_DEFAULT;
    const staleMaxGainPct = override.staleMaxGainPct ?? ALPHA_STALE_MAX_GAIN_PCT_DEFAULT;

    // GC the WD entry tracker: drop any tag whose position is no longer
    // present in this sleeve's positions (closed/swept by prior cycle).
    if (this.wdEntries.size > 0) {
      const held = new Set(ctx.positions.map(p => p.symbol));
      for (const sym of Array.from(this.wdEntries.keys())) {
        if (!held.has(sym)) this.wdEntries.delete(sym);
      }
    }

    // ---------- EXITS FIRST ----------
    // A single position can only trip one exit per cycle. Drawdown wins over
    // profit-take (they can't overlap anyway) and profit-take wins over stale.
    //
    // Path-aware: Watcher-Direct entries (NVR-SPEC-029) use the WD tight-exit
    // gates (take-profit / trailing-stop / max-hold) instead — the WD thesis
    // is a fast 1h microstructure move, not a 48h-hold meme/alt swing.
    // Discovery-path positions stay on the original Alpha gates.
    for (const position of ctx.positions) {
      const price = ctx.market.prices[position.symbol];
      if (!price || price <= 0) continue;

      const currentValue = position.balance * price;
      const pnlPct = position.costBasisUSD > 0
        ? ((currentValue - position.costBasisUSD) / position.costBasisUSD) * 100
        : 0;
      const ageHours = (nowMs - new Date(position.openedAt).getTime()) / (1000 * 60 * 60);

      // WD-tagged position — run the tight-exit ladder and skip generic gates.
      const wdRec = this.wdEntries.get(position.symbol);
      if (WD_TIGHT_EXITS_ENABLED && wdRec) {
        const wdExit = this.evaluateWdTightExit(position.symbol, price, currentValue, wdRec, nowMs);
        if (wdExit) {
          decisions.push(wdExit);
        }
        continue;
      }

      let exitReason: string | null = null;
      if (pnlPct <= drawdownCutPct) {
        exitReason = `ALPHA_DRAWDOWN_CUT: ${pnlPct.toFixed(1)}% ≤ ${drawdownCutPct}% — tighter than Core, noise doesn't save bleeders`;
      } else if (pnlPct >= ALPHA_PROFIT_TAKE_PCT) {
        exitReason = `ALPHA_TAKE_PROFIT: +${pnlPct.toFixed(1)}% ≥ +${ALPHA_PROFIT_TAKE_PCT}% — pulling profits is the edge`;
      } else if (ageHours >= maxHoldHours && pnlPct < staleMaxGainPct) {
        exitReason = `ALPHA_STALE: held ${ageHours.toFixed(0)}h at ${pnlPct.toFixed(1)}% — thesis played out`;
      }

      if (exitReason) {
        decisions.push({
          action: 'SELL',
          fromToken: position.symbol,
          toToken: 'USDC',
          amountUSD: currentValue,
          percent: 100,
          reasoning: exitReason,
        });
      }
    }

    // ---------- SHARED GATE STATE ----------
    // Both the watcher-direct path (NVR-SPEC-029, when env-flag-on) and the
    // existing discovery-driven path consume the same slot/budget pool, so
    // we compute these once and feed both flows.
    const sellsThisCycle = new Set(
      decisions.filter(d => d.action === 'SELL').map(d => d.fromToken),
    );
    const heldAfterExits = ctx.positions.filter(p => !sellsThisCycle.has(p.symbol));
    const slotsOpen = ALPHA_MAX_POSITIONS - heldAfterExits.length;
    const heldSymbols = new Set(heldAfterExits.map(p => p.symbol));

    // ---------- WATCHER-DIRECT NEW ENTRIES (NVR-SPEC-029) ----------
    // When env flag ALPHA_HUNTER_WATCHER_DIRECT=true, AlphaHunter consumes
    // the Watcher → Reviewer signal stream FIRST. These are tokens with a
    // recent (≤30min) bullish trigger AND a Haiku BUY verdict at conf ≥0.7.
    // If any pass risk gates (held / protected / budget / cap), they enter
    // the position — bypassing the 24h conviction formula that structurally
    // excludes 1h microstructure setups (see
    // INVESTIGATION_2026-05-08_Conviction-Formula-Diagnosis.md).
    //
    // If no WD candidate passes (or none offered, or env flag off), fall
    // through to the existing discovery-driven path with no behavior change.
    //
    // Risk gates intact: this is a candidate-source change, not a
    // risk-management change. All existing dust guard, protected-symbol
    // list, position cap, USDC floor, sleeve allocation reservation
    // logic still applies — we just check it inline below for the WD path.
    const wdEnabled = isWatcherDirectEnabled();
    const wdCandidates = ctx.market.watcherDirect?.candidates ?? [];
    if (wdEnabled && wdCandidates.length > 0) {
      this.wdStats.cyclesWithCandidates++;
      const wdResult = this.tryWatcherDirectEntry(
        wdCandidates,
        heldSymbols,
        slotsOpen,
        ctx.availableUSDC,
        ctx.capitalBudgetUSD,
        ctx.market.prices,
      );
      if (wdResult.entry) {
        decisions.push(wdResult.entry);
        // One entry per cycle is the existing rule (ALPHA_MAX_NEW_ENTRIES_PER_CYCLE).
        // We took ours from the watcher-direct stream; do not also draw from
        // the discovery path this cycle.
        return decisions;
      }
      // Surface the WD evaluation in the structured log so the cockpit
      // shows we considered the watcher-direct stream and why we didn't act.
      decisions.push(makeHold(
        `[ALPHA_HUNTER_WD] ${wdResult.holdReason}`,
      ));
      // Fall through to discovery — WD didn't yield, but discovery might.
    }

    // ---------- DISCOVERY-DRIVEN NEW ENTRIES (existing v21.31 path) ----------
    // Respect MAX_POSITIONS counting EXITS as freeing slots (the sim will
    // apply them in-cycle). Budget gate is strict.
    //
    // v21.31: when no entries fire, emit a synthetic HOLD decision carrying
    // human-readable reasoning so the cockpit can see WHY the sleeve sat out.
    // Strategy logic unchanged — only adds visibility on the silent paths.
    const candidates = ctx.market.discovery?.candidates ?? [];
    if (candidates.length === 0) {
      decisions.push(makeHold(
        `AlphaHunter: 0 candidates from discovery engine — pipeline returned empty`,
      ));
      return decisions;
    }

    if (slotsOpen <= 0) {
      decisions.push(makeHold(
        `AlphaHunter: max positions reached (${ALPHA_MAX_POSITIONS} held, 0 slots open) — no entries until exit fires`,
      ));
      return decisions;
    }
    if (ctx.availableUSDC < ALPHA_POSITION_SIZE_FLOOR_USD) {
      decisions.push(makeHold(
        `AlphaHunter: availableUSDC=$${ctx.availableUSDC.toFixed(2)} below $${ALPHA_POSITION_SIZE_FLOOR_USD} floor — sleeve allocated $${ctx.capitalBudgetUSD.toFixed(0)} but bot's shared USDC pool is dry`,
      ));
      return decisions;
    }

    // Filter + rank: qualifying conviction, not already held, not in
    // excluded-symbols list. Runners rank above non-runners; within each,
    // rank by conviction descending.
    // (heldSymbols computed in shared gate state above — re-used here.)
    const eligible = candidates
      .filter(c => c.convictionScore >= ALPHA_MIN_CONVICTION)
      .filter(c => !heldSymbols.has(c.symbol))
      .filter(c => !ALPHA_NEVER_BUY.has(c.symbol))
      .sort((a, b) => {
        if ((a.isRunner ?? false) !== (b.isRunner ?? false)) return (a.isRunner ? -1 : 1);
        return b.convictionScore - a.convictionScore;
      });

    if (eligible.length === 0) {
      // Surface WHY no candidate qualified. Show the top 3 candidates with
      // their conviction scores so the operator can see if conviction is
      // legitimately weak market-wide vs. close-but-not-65.
      const topThree = candidates
        .slice(0, 3)
        .map(c => `${c.symbol}@${c.convictionScore}`)
        .join(', ');
      decisions.push(makeHold(
        `AlphaHunter: 0/${candidates.length} candidates passed filters (conviction≥${ALPHA_MIN_CONVICTION}, not held, not protected). Top: ${topThree || 'none'}`,
      ));
      return decisions;
    }

    const maxNewEntries = Math.min(ALPHA_MAX_NEW_ENTRIES_PER_CYCLE, slotsOpen);
    let entries = 0;
    let remainingBudget = ctx.availableUSDC;

    for (const candidate of eligible) {
      if (entries >= maxNewEntries) break;
      const baseSize = ctx.capitalBudgetUSD * ALPHA_POSITION_SIZE_PCT;
      const spec = getTokenSpecialistMultiplier(candidate.symbol);
      const adjustedSize = baseSize * spec.multiplier;
      const sizeUSD = Math.max(
        ALPHA_POSITION_SIZE_FLOOR_USD,
        Math.min(ALPHA_POSITION_SIZE_CEILING_USD, adjustedSize),
      );
      console.log(
        `[ALPHA_HUNTER] ${candidate.symbol} sizing: base=$${baseSize.toFixed(2)} × specMult ${spec.multiplier.toFixed(2)} → $${adjustedSize.toFixed(2)} → clamped $${sizeUSD.toFixed(2)} [${spec.reason}]`,
      );
      if (sizeUSD > remainingBudget) {
        decisions.push(makeHold(
          `AlphaHunter: sizing loop exhausted after ${entries} entries — sizeUSD=$${sizeUSD.toFixed(2)} > remainingBudget=$${remainingBudget.toFixed(2)}`,
        ));
        break;
      }

      const change24h = candidate.priceChange24h ?? 0;
      decisions.push({
        action: 'BUY',
        fromToken: 'USDC',
        toToken: candidate.symbol,
        amountUSD: sizeUSD,
        reasoning: `ALPHA_HUNTER_V1: ${candidate.isRunner ? '🚀 RUNNER ' : ''}conviction ${candidate.convictionScore}/100, sector ${candidate.sector ?? 'UNKNOWN'}, 24h ${change24h >= 0 ? '+' : ''}${change24h.toFixed(1)}%. SpecMult ${spec.multiplier.toFixed(2)}x (${spec.reason}). Meme/alt swing — tight-exit discipline applies.`,
        sector: candidate.sector,
      });
      remainingBudget -= sizeUSD;
      entries++;
    }

    return decisions;
  }

  /**
   * NVR-SPEC-029: Evaluate the watcher-direct candidate stream and try
   * to construct a single BUY decision from the best qualifier. Returns
   * `{ entry, holdReason: '' }` when an entry was made, or
   * `{ entry: null, holdReason }` with structured reason when nothing
   * passed the gates. Mutates `this.wdStats` for telemetry on every call.
   *
   * Risk gates applied (in order):
   *   1. Already-held → skip (no averaging on watcher-direct either).
   *   2. Protected symbol (USDC/ETH/WETH/cbBTC/...) → skip.
   *   3. Position cap (slotsOpen ≤ 0) → reject all candidates.
   *   4. USDC floor → reject all candidates.
   *   5. Per-candidate sizing (floor/ceiling/budget remaining) → skip.
   *
   * The first candidate that passes is taken. Stream is already sorted
   * by recency desc / confidence desc by getWatcherDirectCandidates.
   */
  private tryWatcherDirectEntry(
    wdCandidates: ReadonlyArray<WatcherDirectCandidate>,
    heldSymbols: Set<string>,
    slotsOpen: number,
    availableUSDC: number,
    capitalBudgetUSD: number,
    prices: Record<string, number>,
  ): { entry: SleeveDecision | null; holdReason: string } {
    // Cap-level rejections apply across all candidates.
    if (slotsOpen <= 0) {
      this.wdStats.skippedByReason.position_cap =
        (this.wdStats.skippedByReason.position_cap ?? 0) + wdCandidates.length;
      this.wdStats.candidatesEvaluated += wdCandidates.length;
      console.log(
        `[ALPHA_HUNTER_WD] ${wdCandidates.length} watcher-direct candidate(s) offered but max positions reached (${ALPHA_MAX_POSITIONS} held, 0 slots open) — fall through to discovery`,
      );
      return {
        entry: null,
        holdReason: `${wdCandidates.length} watcher-direct candidate(s) blocked: position cap (${ALPHA_MAX_POSITIONS} held, 0 slots open)`,
      };
    }
    if (availableUSDC < ALPHA_POSITION_SIZE_FLOOR_USD) {
      this.wdStats.skippedByReason.usdc_floor =
        (this.wdStats.skippedByReason.usdc_floor ?? 0) + wdCandidates.length;
      this.wdStats.candidatesEvaluated += wdCandidates.length;
      console.log(
        `[ALPHA_HUNTER_WD] ${wdCandidates.length} watcher-direct candidate(s) offered but availableUSDC=$${availableUSDC.toFixed(2)} < $${ALPHA_POSITION_SIZE_FLOOR_USD} floor — fall through to discovery`,
      );
      return {
        entry: null,
        holdReason: `${wdCandidates.length} watcher-direct candidate(s) blocked: USDC floor ($${availableUSDC.toFixed(2)} < $${ALPHA_POSITION_SIZE_FLOOR_USD})`,
      };
    }

    // Per-candidate evaluation.
    const evaluatedSummaries: string[] = [];
    for (const c of wdCandidates) {
      this.wdStats.candidatesEvaluated++;
      if (heldSymbols.has(c.symbol)) {
        this.bumpWdSkip('already_held');
        evaluatedSummaries.push(`${c.symbol}=already_held`);
        console.log(
          `[ALPHA_HUNTER_WD] skip ${c.symbol}/${c.triggerType} conf=${c.reviewerConfidence.toFixed(2)} — already held (no averaging on watcher-direct)`,
        );
        continue;
      }
      if (ALPHA_NEVER_BUY.has(c.symbol)) {
        this.bumpWdSkip('protected_symbol');
        evaluatedSummaries.push(`${c.symbol}=protected`);
        console.log(
          `[ALPHA_HUNTER_WD] skip ${c.symbol}/${c.triggerType} conf=${c.reviewerConfidence.toFixed(2)} — protected symbol (Core territory)`,
        );
        continue;
      }
      const baseSize = capitalBudgetUSD * ALPHA_POSITION_SIZE_PCT;
      const spec = getTokenSpecialistMultiplier(c.symbol);
      const adjustedSize = baseSize * spec.multiplier;
      const sizeUSD = Math.max(
        ALPHA_POSITION_SIZE_FLOOR_USD,
        Math.min(ALPHA_POSITION_SIZE_CEILING_USD, adjustedSize),
      );
      console.log(
        `[ALPHA_HUNTER_WD] ${c.symbol} sizing: base=$${baseSize.toFixed(2)} × specMult ${spec.multiplier.toFixed(2)} → $${adjustedSize.toFixed(2)} → clamped $${sizeUSD.toFixed(2)} [${spec.reason}]`,
      );
      if (sizeUSD > availableUSDC) {
        this.bumpWdSkip('budget_exhausted');
        evaluatedSummaries.push(`${c.symbol}=budget`);
        console.log(
          `[ALPHA_HUNTER_WD] skip ${c.symbol}/${c.triggerType} conf=${c.reviewerConfidence.toFixed(2)} — sizeUSD=$${sizeUSD.toFixed(2)} > availableUSDC=$${availableUSDC.toFixed(2)}`,
        );
        continue;
      }

      // PASS: this candidate clears every gate. Build the decision.
      this.wdStats.executions++;
      const nowIso = new Date().toISOString();
      this.wdStats.lastExecutionAt = nowIso;
      // Tag this symbol as WD-entered so the next cycle's exit pass routes
      // it through the WD tight-exit gates (NVR-SPEC-029 follow-on).
      // entryPriceHint comes from the orchestrator's price snapshot; if it's
      // 0/missing here, the first cycle the position lands with a valid
      // price will repair it (see evaluateWdTightExit).
      const entryPriceHint = prices[c.symbol] ?? 0;
      const entryPriceRef = entryPriceHint > 0 ? entryPriceHint : 0;
      this.wdEntries.set(c.symbol, {
        entryPrice: entryPriceRef,
        entryTime: nowIso,
        peakPrice: entryPriceRef,
      });
      const ageMin = (Date.now() - new Date(c.raisedAt).getTime()) / 60_000;
      const reasoning =
        `ALPHA_HUNTER_WD: ${c.triggerType} on ${c.symbol} fired ${ageMin.toFixed(0)}min ago ` +
        `(strength ${c.triggerStrength.toFixed(2)}: ${c.triggerReason}). ` +
        `Reviewer BUY conf ${c.reviewerConfidence.toFixed(2)}: ${c.reviewerReasoning}. ` +
        `Source: Watcher → Reviewer direct (NVR-SPEC-029, bypasses 24h conviction formula). ` +
        `Tight-exit discipline applies.`;
      console.log(
        `[ALPHA_HUNTER_WD] ENTRY ${c.symbol}/${c.triggerType} $${sizeUSD.toFixed(2)} ` +
        `conf=${c.reviewerConfidence.toFixed(2)} age=${ageMin.toFixed(0)}min — ${c.reviewerReasoning.slice(0, 60)}`,
      );
      return {
        entry: {
          action: 'BUY',
          fromToken: 'USDC',
          toToken: c.symbol,
          amountUSD: sizeUSD,
          reasoning,
        },
        holdReason: '',
      };
    }

    // No candidate passed.
    return {
      entry: null,
      holdReason: `0/${wdCandidates.length} watcher-direct candidate(s) passed gates (${evaluatedSummaries.join(', ')}) — fall through to discovery`,
    };
  }

  getStats(): SleeveStats {
    return statsFromOwnership(
      this.getOwnership?.(),
      this.getPortfolioValue?.() ?? 0,
    );
  }
}
