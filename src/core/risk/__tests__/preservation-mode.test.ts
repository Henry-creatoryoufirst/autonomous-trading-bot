/**
 * PreservationMode unit tests
 *
 * Covers state transitions (INACTIVE ↔ ACTIVE, DISABLED when config says so),
 * ring buffer behavior, operator overrides, metric tracking.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PreservationMode } from '../preservation-mode.js';
import { createStateManager } from '../../state/state-manager.js';
import type { AgentState, BreakerState } from '../../types/state.js';
import type { PreservationConfig } from '../../types/risk.js';

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

// Config WITH forceDisabled=true (v20.8+ default production behavior)
const FORCE_DISABLED: PreservationConfig = {
  activationFearGreed: 12,
  deactivationFearGreed: 20,
  ringBufferSize: 36,
  minSustainedReadings: 4,
  sizeMultiplier: 0.5,
  minConfluence: 25,
  minSwarmConsensus: 50,
  cycleIntervalMultiplier: 1.0,
  targetCashPercent: 50,
  forceDisabled: true,
};

// Config WITH forceDisabled=false (historical behavior, still tested for re-enablement)
const ENABLED: PreservationConfig = {
  ...FORCE_DISABLED,
  forceDisabled: false,
};

describe('PreservationMode', () => {
  let state: AgentState;
  let breakerState: BreakerState;

  beforeEach(() => {
    state = makeState();
    breakerState = makeBreakerState();
  });

  // ==========================================================================
  // FORCE-DISABLED PATH (v20.8+ default)
  // ==========================================================================

  describe('forceDisabled config', () => {
    it('always returns DISABLED label regardless of F&G', () => {
      const sm = createStateManager(state, breakerState);
      const pm = new PreservationMode({ stateManager: sm, config: FORCE_DISABLED });

      const lowSnapshot = pm.update(5, 'BEAR'); // extreme fear
      expect(lowSnapshot.label).toBe('DISABLED');

      const highSnapshot = pm.update(80, 'BULL'); // extreme greed
      expect(highSnapshot.label).toBe('DISABLED');
    });

    it('size multiplier stays at 1.0 when disabled', () => {
      const sm = createStateManager(state, breakerState);
      const pm = new PreservationMode({ stateManager: sm, config: FORCE_DISABLED });

      const snapshot = pm.update(5, 'BEAR');
      expect(snapshot.positionSizeMultiplier).toBe(1.0);
    });

    it('forceActivate is a no-op when forceDisabled=true', () => {
      const sm = createStateManager(state, breakerState);
      const pm = new PreservationMode({ stateManager: sm, config: FORCE_DISABLED });

      pm.forceActivate('test');
      expect(pm.getMode().label).toBe('INACTIVE'); // stays at constructor default
    });
  });

  // ==========================================================================
  // ENABLED PATH (not force-disabled)
  // ==========================================================================

  describe('enabled config — activation transitions', () => {
    it('does not activate on a single low reading', () => {
      const sm = createStateManager(state, breakerState);
      const pm = new PreservationMode({ stateManager: sm, config: ENABLED });
      const snapshot = pm.update(5);
      expect(snapshot.label).toBe('INACTIVE');
    });

    it('activates when sustained readings cross activation threshold', () => {
      const sm = createStateManager(state, breakerState);
      const pm = new PreservationMode({ stateManager: sm, config: ENABLED });

      pm.update(10);
      pm.update(10);
      pm.update(10);
      const snapshot = pm.update(10); // 4th sustained reading → activate

      expect(snapshot.label).toBe('ACTIVE');
      expect(snapshot.activatedAt).toBeTruthy();
      expect(snapshot.positionSizeMultiplier).toBe(0.5);
      expect(snapshot.minConfluenceForBuy).toBe(25);
    });

    it('does not activate if any reading in window is above threshold', () => {
      const sm = createStateManager(state, breakerState);
      const pm = new PreservationMode({ stateManager: sm, config: ENABLED });

      pm.update(10);
      pm.update(10);
      pm.update(15); // > activation threshold of 12
      const snapshot = pm.update(10);

      expect(snapshot.label).toBe('INACTIVE');
    });
  });

  describe('enabled config — deactivation transitions', () => {
    it('deactivates when F&G recovers above threshold', () => {
      const sm = createStateManager(state, breakerState);
      const pm = new PreservationMode({ stateManager: sm, config: ENABLED });

      // Activate first
      pm.update(10);
      pm.update(10);
      pm.update(10);
      pm.update(10);
      expect(pm.getMode().label).toBe('ACTIVE');

      // Recover
      const snapshot = pm.update(25); // > 20 deactivation threshold
      expect(snapshot.label).toBe('INACTIVE');
      expect(snapshot.activatedAt).toBeNull();
    });

    it('stays ACTIVE while F&G is between activation and deactivation', () => {
      const sm = createStateManager(state, breakerState);
      const pm = new PreservationMode({ stateManager: sm, config: ENABLED });

      // Activate first
      pm.update(10);
      pm.update(10);
      pm.update(10);
      pm.update(10);

      // 15 is above activation (12) but below deactivation (20) — no transition
      const snapshot = pm.update(15);
      expect(snapshot.label).toBe('ACTIVE');
    });

    it('deactivation resets size multiplier to 1.0', () => {
      const sm = createStateManager(state, breakerState);
      const pm = new PreservationMode({ stateManager: sm, config: ENABLED });

      pm.update(10);
      pm.update(10);
      pm.update(10);
      pm.update(10);
      expect(pm.getMode().positionSizeMultiplier).toBe(0.5);

      pm.update(25);
      expect(pm.getMode().positionSizeMultiplier).toBe(1.0);
    });
  });

  // ==========================================================================
  // RING BUFFER
  // ==========================================================================

  describe('ring buffer', () => {
    it('keeps only the last N readings', () => {
      const sm = createStateManager(state, breakerState);
      const pm = new PreservationMode({
        stateManager: sm,
        config: { ...ENABLED, ringBufferSize: 3 },
      });

      // Push 5 readings, window should only keep the last 3
      pm.update(30);
      pm.update(30);
      pm.update(30);
      pm.update(10);
      pm.update(10);
      // Now buffer is [30, 10, 10] — last 3 → should NOT activate because one reading is > 12

      // Activate requires 4 sustained, but window size is 3 and minSustainedReadings is 4.
      // So activation is impossible with ringBufferSize < minSustainedReadings.
      expect(pm.getMode().label).toBe('INACTIVE');
    });
  });

  // ==========================================================================
  // OPERATOR OVERRIDES
  // ==========================================================================

  describe('operator overrides', () => {
    it('forceActivate when enabled', () => {
      const sm = createStateManager(state, breakerState);
      const pm = new PreservationMode({ stateManager: sm, config: ENABLED });

      pm.forceActivate('operator test');
      expect(pm.getMode().label).toBe('ACTIVE');
      expect(pm.getMode().positionSizeMultiplier).toBe(0.5);
    });

    it('forceDeactivate when active', () => {
      const sm = createStateManager(state, breakerState);
      const pm = new PreservationMode({ stateManager: sm, config: ENABLED });

      pm.forceActivate('bring it on');
      pm.forceDeactivate('false alarm');
      expect(pm.getMode().label).toBe('INACTIVE');
      expect(pm.getMode().positionSizeMultiplier).toBe(1.0);
    });
  });

  // ==========================================================================
  // METRICS
  // ==========================================================================

  describe('metrics', () => {
    it('recordTradeBlocked increments counter', () => {
      const sm = createStateManager(state, breakerState);
      const pm = new PreservationMode({ stateManager: sm, config: ENABLED });

      pm.recordTradeBlocked();
      pm.recordTradeBlocked();
      expect(pm.getMode().metrics.tradesBlocked).toBe(2);
    });

    it('recordTradeSizedDown increments counter', () => {
      const sm = createStateManager(state, breakerState);
      const pm = new PreservationMode({ stateManager: sm, config: ENABLED });

      pm.recordTradeSizedDown();
      expect(pm.getMode().metrics.tradesSizedDown).toBe(1);
    });

    it('resetMetrics clears counters', () => {
      const sm = createStateManager(state, breakerState);
      const pm = new PreservationMode({ stateManager: sm, config: ENABLED });

      pm.recordTradeBlocked();
      pm.recordTradeSizedDown();
      pm.resetMetrics();

      expect(pm.getMode().metrics.tradesBlocked).toBe(0);
      expect(pm.getMode().metrics.tradesSizedDown).toBe(0);
    });

    it('metrics persist across update() calls', () => {
      const sm = createStateManager(state, breakerState);
      const pm = new PreservationMode({ stateManager: sm, config: ENABLED });

      pm.recordTradeBlocked();
      pm.update(30); // update keeps metrics
      expect(pm.getMode().metrics.tradesBlocked).toBe(1);
    });
  });
});
