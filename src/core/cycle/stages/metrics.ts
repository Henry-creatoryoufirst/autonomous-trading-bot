/**
 * Never Rest Capital — Cycle Stage: METRICS
 *
 * Phase 5d extraction. Mirrors agent-v3.2.ts lines ~6630–6685:
 * the pure-display block between RISK_CONTROLS (circuit breaker check) and
 * the preservation / dust-cleanup / dry-powder blocks that call executeTrade.
 *
 * Responsibilities (DISPLAY ONLY, no trade execution):
 *   - Portfolio value + today's P&L + peak + drawdown + market regime
 *   - Technical indicators summary (RSI / MACD / BB / confluence per token)
 *   - Sector allocations with drift over/under warnings
 *   - Trending tokens one-liner
 *   - updateUnrealizedPnL(balances) — writes per-holding unrealized P&L to state
 *   - Cost-basis realized + unrealized P&L roll-up per holding
 *   - Risk-reward metrics (avg win, avg loss, ratio, expectancy, profit factor)
 *
 * Intentionally OUT of scope for this stage (belong to later stages):
 *   - Dust cleanup (L6691+), stale cull (L6724+), dry powder (L6757+) — all
 *     call executeTrade and mutate balances. Those will land in a dedicated
 *     PRE_EXECUTION / maintenance stage.
 *   - Emergency exit (L6790+) — same reason.
 *
 * Contract:
 *   - Pushes 'METRICS' to ctx.stagesCompleted on success AND error paths.
 *   - NEVER sets ctx.halted — display failures are non-fatal.
 *   - NEVER mutates ctx.balances or any financial field on ctx.
 *   - updateUnrealizedPnL writes to state.costBasis (global singleton) —
 *     that's a state-layer write, not a ctx mutation, and matches the
 *     monolith's behavior exactly.
 *
 * All runtime behavior is injected via MetricsDeps so the stage is unit-
 * testable without importing the monolith.
 */

import type { CycleContext } from '../../types/cycle.js';
import type { AgentState, BreakerState } from '../../types/state.js';
import type { SectorAllocation } from '../../types/index.js';

// ============================================================================
// DEPS
// ============================================================================

/** Injected shape of one balance entry — matches what other stages already see. */
type BalanceEntry = {
  symbol: string;
  balance: number;
  usdValue: number;
  price?: number;
  sector?: string;
};

/** Risk-reward stats returned from deps.calculateRiskRewardMetrics(). */
export interface RiskRewardStats {
  avgWinUSD: number;
  avgLossUSD: number;
  riskRewardRatio: number;
  largestWin: number;
  largestLoss: number;
  expectancy: number;
  profitFactor: number;
}

export interface MetricsDeps {
  /** Current agent state (monolith passes its module-level `state`). */
  getState: () => AgentState;

  /** Current breaker state (monolith passes module-level `breakerState`). */
  getBreakerState: () => BreakerState;

  /** Compute sector allocations snapshot — mirrors agent-v3.2.ts L3699. */
  calculateSectorAllocations: (
    balances: ReadonlyArray<BalanceEntry>,
    totalValue: number,
  ) => SectorAllocation[];

  /**
   * Update unrealized P&L for all holdings — mirrors
   * src/core/portfolio/cost-basis.ts. Writes into state.costBasis.
   */
  updateUnrealizedPnL: (
    balances: BalanceEntry[],
  ) => void;

  /**
   * Compute aggregate risk-reward stats — mirrors
   * src/dashboard/api.ts calculateRiskRewardMetrics().
   */
  calculateRiskRewardMetrics: () => RiskRewardStats;
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * METRICS stage — portfolio display + unrealized P&L update.
 *
 * Every subsection is wrapped in its own try/catch. One broken display
 * block never halts the cycle or skips the next block. Worst case: the
 * stage logs a warning and downstream stages run normally.
 */
export async function metricsStage(
  ctx: CycleContext,
  deps: MetricsDeps,
): Promise<CycleContext> {
  // ── Derive the numbers the monolith computes at L6546–6562 ──────────────
  // These are recomputed (not read from ctx) so the stage is self-contained
  // and doesn't depend on upstream stages writing them.
  let state: AgentState;
  let breakerState: BreakerState;
  try {
    state = deps.getState();
    breakerState = deps.getBreakerState();
  } catch (err) {
    console.warn(`[METRICS] deps.getState/getBreakerState failed: ${safeErr(err)}`);
    ctx.stagesCompleted.push('METRICS');
    return ctx;
  }

  const totalPortfolioValue = state.trading.totalPortfolioValue;
  const peakValue = state.trading.peakValue;
  const dailyBase = breakerState.dailyBaseline.value;
  const pnl = dailyBase > 0 ? totalPortfolioValue - dailyBase : 0;
  const pnlPercent = dailyBase > 0 ? (pnl / dailyBase) * 100 : 0;
  const drawdown =
    peakValue > 0
      ? Math.max(0, ((peakValue - totalPortfolioValue) / peakValue) * 100)
      : 0;

  // ── Portfolio summary (L6630–6633) ──────────────────────────────────────
  try {
    console.log(`\n💰 Portfolio: $${totalPortfolioValue.toFixed(2)}`);
    console.log(
      `   Today: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%) from $${dailyBase.toFixed(2)} start-of-day`,
    );
    console.log(
      `   Peak: $${peakValue.toFixed(2)} | Drawdown: ${drawdown.toFixed(1)}%`,
    );
    if (ctx.marketData) {
      console.log(`   Regime: ${ctx.marketData.marketRegime}`);
    }
  } catch (err) {
    console.warn(`[METRICS] portfolio summary display failed: ${safeErr(err)}`);
  }

  // ── Technical indicators summary (L6636–6650) ───────────────────────────
  try {
    const indicators = ctx.marketData?.indicators;
    if (indicators && Object.keys(indicators).length > 0) {
      console.log(`\n📐 Technical Indicators:`);
      const buySignals: string[] = [];
      const sellSignals: string[] = [];
      for (const [symbol, ind] of Object.entries(indicators)) {
        const rsiStr = ind.rsi14 !== null ? `RSI=${ind.rsi14.toFixed(0)}` : '';
        const macdStr = ind.macd ? `MACD=${ind.macd.signal}` : '';
        const bbStr = ind.bollingerBands ? `BB=${ind.bollingerBands.signal}` : '';
        const scoreStr = `Score=${ind.confluenceScore > 0 ? '+' : ''}${ind.confluenceScore}`;
        const parts = [rsiStr, macdStr, bbStr, `Trend=${ind.trendDirection}`, scoreStr].filter(Boolean);
        console.log(`   ${symbol}: ${parts.join(' | ')} → ${ind.overallSignal}`);
        if (ind.confluenceScore >= 30) buySignals.push(`${symbol}(+${ind.confluenceScore})`);
        if (ind.confluenceScore <= -30) sellSignals.push(`${symbol}(${ind.confluenceScore})`);
      }
      if (buySignals.length > 0) console.log(`   🟢 Buy signals: ${buySignals.join(', ')}`);
      if (sellSignals.length > 0) console.log(`   🔴 Sell signals: ${sellSignals.join(', ')}`);
    }
  } catch (err) {
    console.warn(`[METRICS] indicators display failed: ${safeErr(err)}`);
  }

  // ── Sector allocations (L6652–6658) ─────────────────────────────────────
  try {
    const sectorAllocations = deps.calculateSectorAllocations(
      ctx.balances as ReadonlyArray<BalanceEntry>,
      totalPortfolioValue,
    );
    console.log(`\n📊 Sector Allocations:`);
    for (const sector of sectorAllocations) {
      const status =
        Math.abs(sector.drift) > 5
          ? sector.drift > 0
            ? '⚠️ OVER'
            : '⚠️ UNDER'
          : '✅';
      console.log(
        `   ${status} ${sector.name}: ${sector.currentPercent.toFixed(1)}% (target: ${sector.targetPercent}%)`,
      );
    }
  } catch (err) {
    console.warn(`[METRICS] sector allocations display failed: ${safeErr(err)}`);
  }

  // ── Trending tokens (L6660–6662) ────────────────────────────────────────
  try {
    if (ctx.marketData && ctx.marketData.trendingTokens.length > 0) {
      console.log(`\n🔥 Trending: ${ctx.marketData.trendingTokens.join(', ')}`);
    }
  } catch (err) {
    console.warn(`[METRICS] trending tokens display failed: ${safeErr(err)}`);
  }

  // ── updateUnrealizedPnL (L6665) — writes into state.costBasis ───────────
  try {
    deps.updateUnrealizedPnL(ctx.balances as BalanceEntry[]);
  } catch (err) {
    console.warn(`[METRICS] updateUnrealizedPnL failed: ${safeErr(err)}`);
  }

  // ── Cost basis P&L roll-up (L6668–6676) ─────────────────────────────────
  try {
    const costBasis = state.costBasis;
    const activeCB = Object.values(costBasis).filter(
      (cb) => cb.currentHolding > 0 && cb.averageCostBasis > 0,
    );
    if (activeCB.length > 0) {
      const totalRealized = Object.values(costBasis).reduce(
        (s, cb) => s + cb.realizedPnL,
        0,
      );
      const totalUnrealized = activeCB.reduce(
        (s, cb) => s + cb.unrealizedPnL,
        0,
      );
      console.log(
        `\n💹 Cost Basis P&L: Realized ${totalRealized >= 0 ? '+' : ''}$${totalRealized.toFixed(2)} | Unrealized ${totalUnrealized >= 0 ? '+' : ''}$${totalUnrealized.toFixed(2)}`,
      );
      for (const cb of activeCB) {
        const pct =
          cb.averageCostBasis > 0
            ? ((cb.unrealizedPnL / (cb.averageCostBasis * cb.currentHolding)) * 100)
            : 0;
        console.log(
          `   ${cb.unrealizedPnL >= 0 ? '🟢' : '🔴'} ${cb.symbol}: avg $${cb.averageCostBasis.toFixed(4)} | P&L ${cb.unrealizedPnL >= 0 ? '+' : ''}$${cb.unrealizedPnL.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`,
        );
      }
    }
  } catch (err) {
    console.warn(`[METRICS] cost-basis P&L display failed: ${safeErr(err)}`);
  }

  // ── Risk-reward metrics (L6679–6685) ────────────────────────────────────
  try {
    const rr = deps.calculateRiskRewardMetrics();
    if (rr.avgWinUSD > 0 || rr.avgLossUSD > 0) {
      console.log(`\n📊 Risk-Reward Profile:`);
      console.log(
        `   Avg Win: +$${rr.avgWinUSD.toFixed(2)} | Avg Loss: -$${rr.avgLossUSD.toFixed(2)} | Ratio: ${rr.riskRewardRatio.toFixed(2)}x`,
      );
      console.log(
        `   Largest Win: +$${rr.largestWin.toFixed(2)} | Largest Loss: -$${rr.largestLoss.toFixed(2)}`,
      );
      console.log(
        `   Expectancy: $${rr.expectancy.toFixed(2)}/trade | Profit Factor: ${rr.profitFactor.toFixed(2)}`,
      );
    }
  } catch (err) {
    console.warn(`[METRICS] risk-reward display failed: ${safeErr(err)}`);
  }

  ctx.stagesCompleted.push('METRICS');
  return ctx;
}

// ============================================================================
// HELPERS
// ============================================================================

function safeErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
