/**
 * Never Rest Capital — StateManager
 *
 * Phase 2 of the monolith refactor. Centralizes the 321 scattered `state.*`
 * and 70 scattered `breakerState.*` mutations behind typed, named methods.
 *
 * CRITICAL DESIGN CONSTRAINT: StateManager wraps AgentState + BreakerState
 * BY REFERENCE. It does NOT clone. Direct accesses to `state.foo` from the
 * monolith AND `stateManager.getState().foo` return the same object — their
 * mutations are observed by each other. This coexistence is what lets us
 * migrate 321 call sites incrementally in P3/P4/P5 without a big-bang
 * rewrite.
 *
 * First unit test asserts: `stateManager.getState() === state` (identity).
 * A clone bug would cause mutations to vanish into a detached object.
 *
 * Every mutation method auto-calls markStateDirty() so the persistence
 * layer picks it up on the next flush. Pass `{ critical: true }` for
 * mutations that should flush immediately (e.g., post-trade).
 */

import type { AgentState, BreakerState } from '../types/state.js';
import type { TokenCostBasis, SectorAllocation, TradeRecord } from '../types/index.js';
import { markStateDirty as _markStateDirtyStore } from './store.js';

// ============================================================================
// StateManager
// ============================================================================

export class StateManager {
  /**
   * Construct with references to the live AgentState and BreakerState.
   * The monolith passes its own module-level `state` and `breakerState`
   * variables; StateManager stores those references (NO clone).
   */
  constructor(
    private readonly state: AgentState,
    private readonly breakerState: BreakerState,
  ) {}

  // ==========================================================================
  // READ-ONLY: direct references (for migration coexistence)
  // ==========================================================================

  /** Return the live AgentState reference. Mutations are observed everywhere. */
  getState(): AgentState {
    return this.state;
  }

  /** Return the live BreakerState reference. */
  getBreakerState(): BreakerState {
    return this.breakerState;
  }

  // ==========================================================================
  // READ-ONLY: derived views (for IBot compliance + stage consumers)
  // ==========================================================================

  getCycleNumber(): number {
    return this.state.totalCycles;
  }

  getLastCycleTime(): number | null {
    return this.state.lastCycleTime;
  }

  getUptimeSec(): number {
    return Math.floor((Date.now() - this.state.startTime.getTime()) / 1000);
  }

  getPortfolioValue(): number {
    return this.state.trading.totalPortfolioValue;
  }

  getPeakValue(): number {
    return this.state.trading.peakValue;
  }

  getBalances(): AgentState['trading']['balances'] {
    return this.state.trading.balances;
  }

  getMarketRegime(): string {
    return this.state.trading.marketRegime ?? 'UNKNOWN';
  }

  /** Positions excluding USDC and dust (< $1). */
  getActivePositions(): Array<{ symbol: string; usdValue: number; unrealizedPct: number }> {
    return this.state.trading.balances
      .filter((b) => b.symbol !== 'USDC' && (b.usdValue || 0) > 1)
      .map((b) => {
        const cb = this.state.costBasis[b.symbol];
        const unrealizedPct =
          cb?.averageCostBasis && b.price && cb.averageCostBasis > 0
            ? ((b.price - cb.averageCostBasis) / cb.averageCostBasis) * 100
            : 0;
        return { symbol: b.symbol, usdValue: b.usdValue || 0, unrealizedPct };
      });
  }

  getRecentTrades(limit: number): Array<{
    token: string;
    action: string;
    success: boolean;
    pnlUSD?: number;
    timestamp: string;
  }> {
    return this.state.tradeHistory.slice(-limit).map((t) => ({
      token: (t as unknown as { toToken?: string; fromToken?: string }).toToken
        || (t as unknown as { toToken?: string; fromToken?: string }).fromToken
        || 'UNKNOWN',
      action: t.action,
      success: t.success,
      pnlUSD: (t as unknown as { realizedPnlUSD?: number }).realizedPnlUSD,
      timestamp: t.timestamp,
    }));
  }

  getRecentErrors(limit: number): Array<{ type: string; message: string; timestamp: string }> {
    const log = (this.state.errorLog || []) as Array<{
      type: string;
      message: string;
      timestamp: string;
    }>;
    return log.slice(-limit).map((e) => ({
      type: e.type,
      message: e.message,
      timestamp: e.timestamp,
    }));
  }

  /**
   * Returns the simple { active, reason, triggeredAt } view of the circuit
   * breaker. `pauseHours` is the tunable BREAKER_PAUSE_HOURS constant — the
   * caller passes it in rather than StateManager importing constants.
   */
  getCircuitBreakerInfo(pauseHours: number): {
    active: boolean;
    reason: string | null;
    triggeredAt: string | null;
  } {
    const triggered = this.breakerState.lastBreakerTriggered;
    const active =
      !!triggered && Date.now() < new Date(triggered).getTime() + pauseHours * 3600000;
    return {
      active,
      reason: this.breakerState.lastBreakerReason,
      triggeredAt: triggered,
    };
  }

  // ==========================================================================
  // WRITE: cycle metadata
  // ==========================================================================

  incrementCycleCount(): number {
    this.state.totalCycles++;
    this.markDirty();
    return this.state.totalCycles;
  }

  setLastCycleTime(timestamp: number): void {
    this.state.lastCycleTime = timestamp;
    // Deliberately not dirty — fires every cycle, would flood persistence
  }

  // ==========================================================================
  // WRITE: trade history
  // ==========================================================================

  recordTrade(record: TradeRecord): void {
    this.state.tradeHistory.push(record);
    this.markDirty(true); // critical — financial event
  }

  incrementTotalTrades(): void {
    this.state.trading.totalTrades++;
    this.markDirty();
  }

  incrementSuccessfulTrades(): void {
    this.state.trading.successfulTrades++;
    this.markDirty();
  }

  setLastTradeTime(date: Date): void {
    this.state.trading.lastTrade = date;
    this.markDirty();
  }

  // ==========================================================================
  // WRITE: cost basis
  // ==========================================================================

  /** Merge updates into existing cost-basis entry, or create new. */
  updateCostBasis(symbol: string, update: Partial<TokenCostBasis>): void {
    const existing = this.state.costBasis[symbol];
    if (existing) {
      Object.assign(existing, update);
    } else {
      this.state.costBasis[symbol] = { ...update } as TokenCostBasis;
    }
    this.markDirty(true);
  }

  setCostBasis(symbol: string, cb: TokenCostBasis): void {
    this.state.costBasis[symbol] = cb;
    this.markDirty(true);
  }

  clearCostBasis(symbol: string): void {
    delete this.state.costBasis[symbol];
    this.markDirty(true);
  }

  // ==========================================================================
  // WRITE: portfolio valuation
  // ==========================================================================

  setPortfolioValue(v: number): void {
    this.state.trading.totalPortfolioValue = v;
    this.markDirty();
  }

  setPeakValue(v: number): void {
    this.state.trading.peakValue = v;
    this.markDirty();
  }

  setBalances(balances: AgentState['trading']['balances']): void {
    this.state.trading.balances = balances;
    this.markDirty();
  }

  setSectorAllocations(allocations: SectorAllocation[]): void {
    this.state.trading.sectorAllocations = allocations;
    // Not dirty — recomputed every cycle
  }

  setMarketRegime(regime: string): void {
    this.state.trading.marketRegime = regime;
    // Not dirty — recomputed every cycle
  }

  // ==========================================================================
  // WRITE: trade failures + cooldowns
  // ==========================================================================

  recordTradeFailure(symbol: string): number {
    const existing = this.state.tradeFailures[symbol];
    if (existing) {
      existing.count++;
      existing.lastFailure = new Date().toISOString();
    } else {
      this.state.tradeFailures[symbol] = {
        count: 1,
        lastFailure: new Date().toISOString(),
      };
    }
    this.markDirty();
    return this.state.tradeFailures[symbol].count;
  }

  clearTradeFailures(symbol: string): void {
    delete this.state.tradeFailures[symbol];
    this.markDirty();
  }

  setProfitTakeCooldown(key: string, timestamp: string): void {
    this.state.profitTakeCooldowns[key] = timestamp;
    this.markDirty();
  }

  setStopLossCooldown(symbol: string, timestamp: string): void {
    this.state.stopLossCooldowns[symbol] = timestamp;
    this.markDirty();
  }

  // ==========================================================================
  // WRITE: circuit breaker state
  // ==========================================================================

  incrementConsecutiveLosses(): number {
    this.breakerState.consecutiveLosses++;
    this.markDirty();
    return this.breakerState.consecutiveLosses;
  }

  resetConsecutiveLosses(): void {
    this.breakerState.consecutiveLosses = 0;
    this.markDirty();
  }

  /**
   * Append one trade result to the rolling window. If the window would exceed
   * `maxSize`, the oldest result is dropped.
   */
  appendRollingResult(isWin: boolean, maxSize: number): void {
    this.breakerState.rollingTradeResults.push(isWin);
    if (this.breakerState.rollingTradeResults.length > maxSize) {
      this.breakerState.rollingTradeResults =
        this.breakerState.rollingTradeResults.slice(-maxSize);
    }
    this.markDirty();
  }

  /**
   * Fire the circuit breaker — sets trigger timestamp, reason, and size-reduction
   * window. Resets rolling window + consecutive losses per v10.4 behavior.
   */
  triggerBreaker(reason: string, sizeReductionHours: number): void {
    this.breakerState.lastBreakerTriggered = new Date().toISOString();
    this.breakerState.lastBreakerReason = reason;
    this.breakerState.breakerSizeReductionUntil = new Date(
      Date.now() + sizeReductionHours * 3600000,
    ).toISOString();
    this.breakerState.rollingTradeResults = [];
    this.breakerState.consecutiveLosses = 0;
    this.markDirty(true);
  }

  /** Clear all breaker state. Only call when recovery evidence is proven. */
  resetBreaker(): void {
    this.breakerState.lastBreakerTriggered = null;
    this.breakerState.lastBreakerReason = null;
    this.breakerState.breakerSizeReductionUntil = null;
    this.breakerState.consecutiveLosses = 0;
    this.breakerState.rollingTradeResults = [];
    this.markDirty(true);
  }

  /**
   * Extend the breaker pause by `additionalHours`. Returns false if the breaker
   * is not currently triggered. `pauseHours` is the base pause window constant.
   */
  extendBreakerPause(additionalHours: number, pauseHours: number): boolean {
    if (!this.breakerState.lastBreakerTriggered) return false;
    const currentPauseEnd =
      new Date(this.breakerState.lastBreakerTriggered).getTime() + pauseHours * 3600000;
    this.breakerState.breakerSizeReductionUntil = new Date(
      currentPauseEnd + additionalHours * 3600000,
    ).toISOString();
    this.markDirty(true);
    return true;
  }

  setDailyBaseline(date: string, value: number): void {
    this.breakerState.dailyBaseline = { date, value };
    this.markDirty();
  }

  setDailyBaselineValidated(validated: boolean): void {
    this.breakerState.dailyBaselineValidated = validated;
    this.markDirty();
  }

  setWeeklyBaseline(weekStart: string, value: number): void {
    this.breakerState.weeklyBaseline = { weekStart, value };
    this.markDirty();
  }

  // ==========================================================================
  // WRITE: harvest tracking
  // ==========================================================================

  recordHarvest(record: NonNullable<AgentState['harvestedProfits']>['harvests'][number]): void {
    if (!this.state.harvestedProfits) {
      this.state.harvestedProfits = { totalHarvested: 0, harvestCount: 0, harvests: [] };
    }
    this.state.harvestedProfits.harvests.push(record);
    // Keep last 50
    if (this.state.harvestedProfits.harvests.length > 50) {
      this.state.harvestedProfits.harvests =
        this.state.harvestedProfits.harvests.slice(-50);
    }
    this.state.harvestedProfits.totalHarvested += record.profitUSD;
    this.state.harvestedProfits.harvestCount++;
    this.markDirty(true);
  }

  // ==========================================================================
  // WRITE: error log + sanity alerts
  // ==========================================================================

  logError(type: string, message: string, details?: unknown): void {
    const errorLog = this.state.errorLog || [];
    errorLog.push({
      timestamp: new Date().toISOString(),
      type,
      message,
      details,
    });
    // Keep last 100
    if (errorLog.length > 100) errorLog.splice(0, errorLog.length - 100);
    this.state.errorLog = errorLog;
    this.markDirty();
  }

  appendSanityAlert(
    alert: NonNullable<AgentState['sanityAlerts']>[number],
  ): void {
    if (!this.state.sanityAlerts) this.state.sanityAlerts = [];
    this.state.sanityAlerts.push(alert);
    if (this.state.sanityAlerts.length > 50) {
      this.state.sanityAlerts = this.state.sanityAlerts.slice(-50);
    }
    this.markDirty();
  }

  // ==========================================================================
  // WRITE: on-chain deposit tracking
  // ==========================================================================

  setTotalDeposited(amount: number): void {
    this.state.totalDeposited = amount;
    this.markDirty();
  }

  setOnChainWithdrawn(amount: number): void {
    this.state.onChainWithdrawn = amount;
    this.markDirty();
  }

  setLastKnownUSDCBalance(amount: number): void {
    this.state.lastKnownUSDCBalance = amount;
    this.markDirty();
  }

  recordDeposit(timestamp: string, amountUSD: number, newTotal: number): void {
    this.state.depositHistory.push({ timestamp, amountUSD, newTotal });
    this.markDirty(true);
  }

  // ==========================================================================
  // PERSISTENCE
  // ==========================================================================

  /**
   * Mark state as needing persistence. Delegates to the existing store module
   * so the monolith's existing flush path picks it up.
   * `critical=true` = flush within seconds (post-trade), else batch.
   */
  markDirty(critical?: boolean): void {
    _markStateDirtyStore(critical);
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * One-liner for agent-v3.2.ts startup. Passes existing module-level
 * state + breakerState variables by reference.
 */
export function createStateManager(
  state: AgentState,
  breakerState: BreakerState,
): StateManager {
  return new StateManager(state, breakerState);
}
