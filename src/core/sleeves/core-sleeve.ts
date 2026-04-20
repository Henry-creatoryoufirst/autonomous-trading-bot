/**
 * NVR Capital — Capital Sleeves: Core Sleeve
 *
 * The Core sleeve represents the bot's existing confluence/adaptive/capital-
 * liberation strategy. It exists so that the sleeve architecture can be
 * introduced without changing bot behavior: the pre-sleeve bot ≡ "one sleeve
 * named 'core' at 100% allocation".
 *
 * Phase 1 (SPEC-010 §"Migration path" step 1): this sleeve is read-only. It
 * reports real stats computed from the bot's existing state, so the dashboard
 * can show "Core Strategy 100%  +$X  +Y%" — but `decide()` still returns an
 * empty array because the orchestrator doesn't route decisions through the
 * sleeve yet. That wrapping lands in Phase 2.
 *
 * See NVR-SPEC-010 for the full architecture.
 */

import type {
  Sleeve,
  SleeveContext,
  SleeveDecision,
  SleeveStats,
  SleeveMode,
} from './types.js';
import type { TokenCostBasis, TradeRecord, TradeDecision } from '../types/index.js';

/**
 * Signature of the function a Core sleeve delegates its `decide()` to.
 * Receives the sleeve context (whose `extras` carries per-cycle bot state
 * like balances, marketData, sectorAllocations during Phase 2) and returns
 * trade decisions. Kept as a standalone type so the orchestrator in
 * agent-v3.2.ts can reference it without circular imports.
 */
export type CoreDecideFn = (ctx: SleeveContext) => Promise<TradeDecision[]>;

/**
 * Minimal state view the Core sleeve needs to compute its stats. Kept as a
 * narrow interface so the sleeve is easy to test with mock data and isn't
 * coupled to the full bot state shape.
 */
export interface CoreSleeveStateView {
  costBasis: Record<string, TokenCostBasis>;
  tradeHistory: TradeRecord[];
}

export interface CoreSleeveOptions {
  /** Typically 'paper' during initial rollout, then 'live'. */
  mode?: SleeveMode;
  /** Override the default name shown on the dashboard. */
  displayName?: string;
  /**
   * Provider that returns a live view of the bot's cost basis + trade history.
   * Called each time `getStats()` runs. Keep cheap: no I/O, just a reference.
   *
   * When omitted, `getStats()` returns zeroed stats — useful for tests and
   * for safety during early boot before state is loaded.
   */
  getState?: () => CoreSleeveStateView;
  /**
   * Delegate that actually produces trade decisions. In Phase 2 this wraps
   * the bot's existing `makeTradeDecision()` pipeline; the sleeve is a
   * pass-through. When omitted, `decide()` returns `[]` — matches the Phase 1
   * behavior so early-boot and tests stay deterministic.
   */
  decideFn?: CoreDecideFn;
}

const ZERO_STATS: SleeveStats = {
  realizedPnLUSD: 0,
  unrealizedPnLUSD: 0,
  trades: 0,
  winRate: 0,
  rollingSharpe7d: null,
  lastDecisionAt: null,
};

export class CoreSleeve implements Sleeve {
  readonly id = 'core';
  readonly displayName: string;
  readonly mode: SleeveMode;
  /**
   * The Core sleeve is the bot's primary strategy and must never be starved
   * nor over-allocated. These bounds reflect that: it always has meaningful
   * capital, and it can also run the whole book if no other sleeve exists.
   */
  readonly minCapitalPct = 0.5;
  readonly maxCapitalPct = 1.0;

  private readonly getState?: () => CoreSleeveStateView;
  private readonly decideFn?: CoreDecideFn;

  constructor(opts: CoreSleeveOptions = {}) {
    this.mode = opts.mode ?? 'live';
    this.displayName = opts.displayName ?? 'Core Strategy';
    this.getState = opts.getState;
    this.decideFn = opts.decideFn;
  }

  /**
   * Produce this cycle's intended trades. When `decideFn` is injected, the
   * sleeve delegates to it (the Phase 2 wrap of the existing heavy-cycle
   * decision pipeline). When no `decideFn` is provided, returns `[]` — the
   * same safe default the Phase 1 scaffolding shipped with.
   *
   * The orchestrator in agent-v3.2.ts decides when/whether to route decisions
   * through this method based on the `SLEEVES_DRIVE_DECISIONS` feature flag.
   * Callers should NOT assume decisions returned here will be executed — the
   * orchestrator may be in shadow-log mode (off flag + still calling decide()
   * to compare output against the direct path for equivalence verification).
   */
  async decide(ctx: SleeveContext): Promise<SleeveDecision[]> {
    if (!this.decideFn) return [];
    return await this.decideFn(ctx);
  }

  /**
   * Snapshot of sleeve performance, computed from the bot's live state.
   * Returns zeroed stats if no state provider was configured.
   */
  getStats(): SleeveStats {
    const state = this.getState?.();
    if (!state) {
      return ZERO_STATS;
    }

    // Realized P&L: already accumulated on each cost basis entry (maintained
    // by the cost-basis engine elsewhere). Summed across all positions.
    const costBasisEntries = Object.values(state.costBasis);
    const realizedPnLUSD = costBasisEntries.reduce(
      (sum, cb) => sum + (cb.realizedPnL || 0),
      0,
    );

    // Unrealized P&L: already computed per position by the cost-basis engine.
    const unrealizedPnLUSD = costBasisEntries.reduce(
      (sum, cb) => sum + (cb.unrealizedPnL || 0),
      0,
    );

    // Trade count: only successful, actionable trades (exclude HOLD / failed).
    const actionableTrades = state.tradeHistory.filter(
      (t) => t.success && (t.action === 'BUY' || t.action === 'SELL'),
    );
    const trades = actionableTrades.length;

    // Win rate: derived from closed positions (SELLs with a recorded realized
    // P&L). A sell with realizedPnL > 0 is a winner. Trades without a stored
    // realizedPnL are excluded — they can't be scored.
    const scoredSells = state.tradeHistory.filter(
      (t) => t.success && t.action === 'SELL' && t.realizedPnL !== undefined,
    );
    const wins = scoredSells.filter((t) => (t.realizedPnL ?? 0) > 0).length;
    const winRate =
      scoredSells.length > 0 ? (wins / scoredSells.length) * 100 : 0;

    // Rolling 7-day Sharpe: requires a daily-returns timeseries that isn't
    // plumbed into the sleeves layer yet. Phase 2 will wire it from the
    // dailyPayouts state slice. For v1, report null so the dashboard shows
    // "—" rather than a misleading zero.
    const rollingSharpe7d = null;

    const lastDecisionAt =
      actionableTrades.length > 0
        ? actionableTrades[actionableTrades.length - 1].timestamp
        : null;

    return {
      realizedPnLUSD,
      unrealizedPnLUSD,
      trades,
      winRate,
      rollingSharpe7d,
      lastDecisionAt,
    };
  }
}
