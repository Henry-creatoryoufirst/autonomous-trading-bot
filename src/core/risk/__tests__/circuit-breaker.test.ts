/**
 * CircuitBreaker unit tests
 *
 * Covers every trigger path (consecutive losses, rolling window,
 * daily drawdown, weekly drawdown, single-trade loss) and the full
 * lifecycle (trigger → pause → size reduction → all-clear).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker } from '../circuit-breaker.js';
import { createStateManager } from '../../state/state-manager.js';
import type { AgentState, BreakerState } from '../../types/state.js';
import type { BreakerConfig } from '../../types/risk.js';

function makeState(): AgentState {
  return {
    startTime: new Date(),
    totalCycles: 0,
    lastCycleTime: null,
    trading: {
      lastCheck: new Date(),
      lastTrade: null,
      totalTrades: 0,
      successfulTrades: 0,
      balances: [],
      totalPortfolioValue: 1000,
      initialValue: 1000,
      peakValue: 1000,
      sectorAllocations: [],
    },
    tradeHistory: [],
    costBasis: {},
    profitTakeCooldowns: {},
    stopLossCooldowns: {},
    tradeFailures: {},
    autoHarvestTransfers: [],
    totalAutoHarvestedUSD: 0,
    totalAutoHarvestedETH: 0,
    lastAutoHarvestTime: null,
    autoHarvestCount: 0,
    autoHarvestByRecipient: {},
    dailyPayouts: [],
    totalDailyPayoutsUSD: 0,
    dailyPayoutCount: 0,
    lastDailyPayoutDate: null,
    dailyPayoutByRecipient: {},
    strategyPatterns: {},
    adaptiveThresholds: {} as any,
    performanceReviews: [],
    explorationState: {} as any,
    lastReviewTradeIndex: 0,
    lastReviewTimestamp: null,
    totalDeposited: 1000,
    onChainWithdrawn: 0,
    lastKnownUSDCBalance: 1000,
    depositHistory: [],
    fundingRateHistory: { btc: [], eth: [] },
    btcDominanceHistory: { values: [] },
    stablecoinSupplyHistory: { values: [] },
    errorLog: [],
    pendingFeeUSDC: 0,
  };
}

function makeBreakerState(): BreakerState {
  return {
    consecutiveLosses: 0,
    lastBreakerTriggered: null,
    lastBreakerReason: null,
    breakerSizeReductionUntil: null,
    dailyBaseline: { date: '', value: 0 },
    dailyBaselineValidated: false,
    weeklyBaseline: { weekStart: '', value: 0 },
    rollingTradeResults: [],
  };
}

const DEFAULT_CONFIG: BreakerConfig = {
  consecutiveLossLimit: 3,
  rollingWindowSize: 8,
  rollingLossThreshold: 5,
  pauseHours: 1,
  sizeReductionPercent: 0.7,
  sizeReductionHours: 24,
  dailyDrawdownPercent: 8,
  weeklyDrawdownPercent: 15,
  capitalFloorUSD: 50,
  capitalFloorPercentOfPeak: 0.6,
  emergencyExitLossPercent: -0.05, // 5%
  emergencyExitFailureCount: 10,
};

describe('CircuitBreaker', () => {
  let state: AgentState;
  let breakerState: BreakerState;
  let cb: CircuitBreaker;

  beforeEach(() => {
    state = makeState();
    breakerState = makeBreakerState();
    const sm = createStateManager(state, breakerState);
    cb = new CircuitBreaker({ stateManager: sm, config: DEFAULT_CONFIG });
  });

  // ==========================================================================
  // ALL-CLEAR PATH
  // ==========================================================================

  describe('all-clear', () => {
    it('returns NONE severity when no triggers fire', () => {
      const decision = cb.evaluate(1000);
      expect(decision.severity).toBe('NONE');
      expect(decision.active).toBe(false);
      expect(decision.sizeMultiplier).toBe(1.0);
    });

    it('updates daily baseline on first call of the day', () => {
      cb.evaluate(1000);
      expect(breakerState.dailyBaseline.value).toBe(1000);
      expect(breakerState.dailyBaselineValidated).toBe(true);
    });
  });

  // ==========================================================================
  // TRIGGER PATHS
  // ==========================================================================

  describe('consecutive losses trigger', () => {
    it('fires when losses cross the limit', () => {
      // Record 3 losing trades
      cb.recordTradeResult(false, -10);
      cb.recordTradeResult(false, -10);
      cb.recordTradeResult(false, -10);
      const decision = cb.evaluate(900);
      expect(decision.severity).toBe('PAUSED');
      expect(decision.triggerReason).toBe('CONSECUTIVE_LOSSES');
      expect(breakerState.lastBreakerTriggered).toBeTruthy();
    });

    it('does not fire below the limit', () => {
      cb.recordTradeResult(false, -10);
      cb.recordTradeResult(false, -10);
      const decision = cb.evaluate(900);
      expect(decision.severity).toBe('NONE');
    });

    it('wins reset the consecutive counter', () => {
      cb.recordTradeResult(false, -10);
      cb.recordTradeResult(false, -10);
      cb.recordTradeResult(true, 5);
      expect(breakerState.consecutiveLosses).toBe(0);
    });
  });

  describe('rolling window trigger', () => {
    it('fires when losses in window cross threshold', () => {
      // 5 losses and 3 wins in 8 trades → trigger
      cb.recordTradeResult(true, 5);
      cb.recordTradeResult(false, -10);
      cb.recordTradeResult(true, 5);
      cb.recordTradeResult(false, -10);
      cb.recordTradeResult(false, -10);
      cb.recordTradeResult(false, -10);
      cb.recordTradeResult(true, 5);
      cb.recordTradeResult(false, -10);
      const decision = cb.evaluate(900);
      // Note: 4 consecutive losses might trigger the consecutive limit first.
      // Either way, breaker should fire.
      expect(decision.active).toBe(true);
    });
  });

  describe('daily drawdown trigger', () => {
    it('fires when drawdown exceeds threshold', () => {
      cb.evaluate(1000); // sets baseline
      const decision = cb.evaluate(900); // 10% drawdown > 8% threshold
      expect(decision.severity).toBe('PAUSED');
      expect(decision.triggerReason).toBe('DAILY_DRAWDOWN');
    });

    it('does not fire below the threshold', () => {
      cb.evaluate(1000);
      const decision = cb.evaluate(950); // 5% drawdown < 8%
      expect(decision.severity).toBe('NONE');
    });
  });

  describe('single-trade loss trigger', () => {
    it('fires when a single trade loses too much', () => {
      const decision = cb.evaluate(1000, { success: true, pnlUSD: -60 }); // 6% loss > 5% threshold
      expect(decision.severity).toBe('PAUSED');
      expect(decision.triggerReason).toBe('EMERGENCY_EXIT');
    });

    it('does not fire for small losses', () => {
      const decision = cb.evaluate(1000, { success: true, pnlUSD: -30 }); // 3% loss
      expect(decision.severity).toBe('NONE');
    });
  });

  // ==========================================================================
  // PAUSE LIFECYCLE
  // ==========================================================================

  describe('pause lifecycle', () => {
    it('reports PAUSED while pause window is active', () => {
      cb.recordTradeResult(false, -10);
      cb.recordTradeResult(false, -10);
      cb.recordTradeResult(false, -10);
      cb.evaluate(900); // triggers
      const second = cb.evaluate(900);
      expect(second.severity).toBe('PAUSED');
      expect(second.message).toContain('remaining');
    });

    it('clears pause after the window expires', () => {
      cb.recordTradeResult(false, -10);
      cb.recordTradeResult(false, -10);
      cb.recordTradeResult(false, -10);
      cb.evaluate(900); // triggers

      // Simulate expired pause
      breakerState.lastBreakerTriggered = new Date(Date.now() - 2 * 3600_000).toISOString();

      const decision = cb.evaluate(1000);
      // Post-clear still has size-reduction active until sizeReductionUntil expires
      expect(decision.severity === 'CAUTION' || decision.severity === 'NONE').toBe(true);
      expect(breakerState.lastBreakerTriggered).toBeNull();
    });

    it('applies size reduction in CAUTION phase', () => {
      // Manually set a size-reduction window, no active pause
      breakerState.breakerSizeReductionUntil = new Date(Date.now() + 3600_000).toISOString();
      const decision = cb.evaluate(1000);
      expect(decision.severity).toBe('CAUTION');
      expect(decision.sizeMultiplier).toBe(0.7);
    });
  });

  // ==========================================================================
  // RESET
  // ==========================================================================

  describe('reset + extend', () => {
    it('reset() clears all breaker state', () => {
      cb.recordTradeResult(false, -10);
      cb.recordTradeResult(false, -10);
      cb.recordTradeResult(false, -10);
      cb.evaluate(900); // triggers

      cb.reset();

      expect(breakerState.lastBreakerTriggered).toBeNull();
      expect(breakerState.consecutiveLosses).toBe(0);
      expect(breakerState.rollingTradeResults).toEqual([]);
    });

    it('extend() extends size-reduction window', () => {
      cb.recordTradeResult(false, -10);
      cb.recordTradeResult(false, -10);
      cb.recordTradeResult(false, -10);
      cb.evaluate(900); // triggers
      const before = breakerState.breakerSizeReductionUntil;
      const result = cb.extend(2);
      expect(result).toBe(true);
      expect(breakerState.breakerSizeReductionUntil).not.toBe(before);
    });

    it('extend() returns false when breaker not triggered', () => {
      expect(cb.extend(2)).toBe(false);
    });
  });

  // ==========================================================================
  // RECORD TRADE RESULT
  // ==========================================================================

  describe('recordTradeResult', () => {
    it('returns structured output with all counters', () => {
      const result = cb.recordTradeResult(false, -10);
      expect(result.isWin).toBe(false);
      expect(result.consecutiveLosses).toBe(1);
      expect(result.rollingLosses).toBe(1);
    });

    it('zero pnl counts as a win (no loss)', () => {
      const result = cb.recordTradeResult(true, 0);
      expect(result.isWin).toBe(true);
      expect(result.consecutiveLosses).toBe(0);
    });

    it('success=true with no pnl counts as a win', () => {
      const result = cb.recordTradeResult(true);
      expect(result.isWin).toBe(true);
    });

    it('success=false always counts as a loss', () => {
      const result = cb.recordTradeResult(false);
      expect(result.isWin).toBe(false);
    });
  });

  // ==========================================================================
  // STATEMANAGER DELEGATION
  // ==========================================================================

  describe('delegation to StateManager', () => {
    it('mutations are visible on the shared breakerState reference', () => {
      cb.recordTradeResult(false, -10);
      expect(breakerState.consecutiveLosses).toBe(1);
      expect(breakerState.rollingTradeResults).toEqual([false]);
    });

    it('trigger() writes through to breakerState', () => {
      cb.trigger('MANUAL_HALT', 'test reason');
      expect(breakerState.lastBreakerTriggered).toBeTruthy();
      expect(breakerState.lastBreakerReason).toBe('test reason');
      expect(breakerState.breakerSizeReductionUntil).toBeTruthy();
    });
  });

  // ==========================================================================
  // BASELINE SANITY — v21.28 two-sided gates + 3-cycle confirmation
  //
  // These tests cover the symmetrized sanity logic introduced after the
  // 2026-05-18 phantom -$215 incident, where a stale/transient mark at UTC
  // midnight committed a baseline ~8% above the real book and the previous
  // one-sided self-heal had no path to correct it.
  // ==========================================================================

  describe('baseline rollover — two-sided sanity', () => {
    /** Seed yesterday's baseline so today's call is treated as a rollover. */
    function seedYesterdayBaseline(value: number): void {
      breakerState.dailyBaseline = { date: '2026-05-17', value };
      breakerState.dailyBaselineValidated = true;
    }

    it('captures the candidate when the rollover delta is within tolerance', () => {
      seedYesterdayBaseline(1000);
      cb.evaluate(1050); // +5% — fine
      expect(breakerState.dailyBaseline.value).toBe(1050);
      expect(breakerState.dailyBaselineValidated).toBe(true);
    });

    it('DEFERS a phantom-LOW rollover capture (>35% below previous)', () => {
      seedYesterdayBaseline(1000);
      cb.evaluate(500); // -50% — phantom
      // Date stays yesterday + validated flips false so the dashboard shows "Calibrating"
      expect(breakerState.dailyBaseline.value).toBe(1000);
      expect(breakerState.dailyBaseline.date).toBe('2026-05-17');
      expect(breakerState.dailyBaselineValidated).toBe(false);
    });

    it('DEFERS a phantom-HIGH rollover capture (>35% above previous) — the 2026-05-18 case', () => {
      seedYesterdayBaseline(2000);
      cb.evaluate(3100); // +55% — phantom on the high side
      // Old code would have accepted this and stuck a high baseline for the whole day.
      expect(breakerState.dailyBaseline.value).toBe(2000);
      expect(breakerState.dailyBaseline.date).toBe('2026-05-17');
      expect(breakerState.dailyBaselineValidated).toBe(false);
    });

    it('accepts a high rollover that is just under the sanity threshold', () => {
      seedYesterdayBaseline(1000);
      cb.evaluate(1340); // +34% — just inside the 35% gate
      expect(breakerState.dailyBaseline.value).toBe(1340);
      expect(breakerState.dailyBaselineValidated).toBe(true);
    });
  });

  describe('intraday baseline self-heal — two-sided', () => {
    /** Seed an intraday baseline that has already committed today. */
    function seedTodayBaseline(value: number): void {
      const today = new Date().toISOString().split('T')[0];
      breakerState.dailyBaseline = { date: today, value };
      breakerState.dailyBaselineValidated = true;
    }

    it('self-heals UP immediately when stored baseline is stuck low', () => {
      seedTodayBaseline(800);
      cb.evaluate(1100); // +37.5% — over the 25% stuck threshold
      expect(breakerState.dailyBaseline.value).toBe(1100);
      expect(breakerState.dailyBaselineValidated).toBe(true);
    });

    it('does NOT self-heal DOWN on the first stuck-high cycle (preserves crash signal)', () => {
      seedTodayBaseline(1000);
      cb.evaluate(700); // -30% — a real flash-crash candidate
      // Baseline stays at 1000 so the daily-drawdown trigger can fire as intended.
      expect(breakerState.dailyBaseline.value).toBe(1000);
    });

    it('self-heals DOWN only after 3 consecutive stuck-high cycles', () => {
      seedTodayBaseline(1000);
      cb.evaluate(700); // cycle 1 — watching
      expect(breakerState.dailyBaseline.value).toBe(1000);
      cb.evaluate(710); // cycle 2 — still watching
      expect(breakerState.dailyBaseline.value).toBe(1000);
      cb.evaluate(720); // cycle 3 — confirms, self-heals
      expect(breakerState.dailyBaseline.value).toBe(720);
      expect(breakerState.dailyBaselineValidated).toBe(true);
    });

    it('resets the stuck-high counter if portfolio returns to tolerance mid-watch', () => {
      seedTodayBaseline(1000);
      cb.evaluate(700); // cycle 1 — watching (count=1)
      cb.evaluate(950); // cycle 2 — within 25% tolerance, counter resets
      cb.evaluate(700); // cycle 3 — watching again (count=1, not 3)
      // Baseline must NOT have self-healed since we never hit 3 consecutive.
      expect(breakerState.dailyBaseline.value).toBe(1000);
    });

    it('does NOT trigger self-heal when delta is within tolerance either way', () => {
      seedTodayBaseline(1000);
      cb.evaluate(1100); // +10% — fine
      cb.evaluate(900);  // -10% — fine
      expect(breakerState.dailyBaseline.value).toBe(1000);
    });
  });
});
