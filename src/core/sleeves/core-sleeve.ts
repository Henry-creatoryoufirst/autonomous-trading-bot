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
  /**
   * Daily realized P&L history. Feeds the rolling 7-day Sharpe computation.
   * Only `date` + `realizedPnL` are read — a narrow shape so the provider
   * can pass `state.dailyPayouts` directly. Optional: when absent, Sharpe
   * reports null (matches the "insufficient data" UX on the dashboard).
   */
  dailyPayouts?: Array<{ date: string; realizedPnL: number }>;
  /**
   * Current total portfolio USD value, used as the denominator for daily
   * return %. Snapshot, not live — the provider refreshes it each cycle.
   * Optional: when absent or 0, Sharpe reports null.
   */
  totalPortfolioValue?: number;
}

/**
 * Rolling 7-day Sharpe ratio (annualized) from daily realized P&L.
 *
 * Formula:
 *   dailyReturn[i] = dailyPayouts[i].realizedPnL / totalPortfolioValue
 *   Sharpe = (mean / stddev) × sqrt(365)
 *
 * Returns null when:
 *   - fewer than 7 daily records (need a full window)
 *   - portfolio value is zero/negative (can't normalize)
 *   - stddev is zero (all same value — undefined Sharpe)
 *
 * Uses the current portfolio value as a constant denominator rather than
 * per-day historical values (which we don't track). This slightly biases
 * the %-return scale but keeps the relative shape of the signal honest —
 * the Sharpe is driven by variance vs. mean, and both move with the
 * denominator equally. Annualized with sqrt(365) so typical values land
 * in the familiar 0-3 range seen elsewhere in the codebase.
 */
export function computeRollingSharpe7d(
  dailyPayouts: Array<{ date: string; realizedPnL: number }>,
  totalPortfolioValue: number,
): number | null {
  const recent = dailyPayouts.slice(-7);
  if (recent.length < 7 || totalPortfolioValue <= 0) return null;
  const returns = recent.map((d) => (d.realizedPnL ?? 0) / totalPortfolioValue);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return null;
  return (mean / stddev) * Math.sqrt(365);
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

    // Rolling 7-day Sharpe from daily payout records, normalized by current
    // portfolio value and annualized. Returns null until there are 7 full
    // daily records to work with — the dashboard renders that as "—".
    const rollingSharpe7d = computeRollingSharpe7d(
      state.dailyPayouts ?? [],
      state.totalPortfolioValue ?? 0,
    );

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
