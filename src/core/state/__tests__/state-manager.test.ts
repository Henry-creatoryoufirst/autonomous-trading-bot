/**
 * StateManager unit tests
 *
 * CRITICAL: The first test (`wraps by reference, never clones`) is the
 * load-bearing invariant of Phase 2. If this test regresses, the refactor
 * is broken — mutations made via StateManager would not be observed by
 * the monolith's direct `state.foo` accesses (and vice versa), causing
 * silent state desync.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StateManager, createStateManager } from '../state-manager.js';
import type { AgentState, BreakerState } from '../../types/state.js';

// Minimal state fixtures — covers every field StateManager reads
function makeState(): AgentState {
  return {
    startTime: new Date(Date.now() - 3600_000), // 1h ago
    totalCycles: 0,
    lastCycleTime: null,
    trading: {
      lastCheck: new Date(),
      lastTrade: null,
      totalTrades: 0,
      successfulTrades: 0,
      balances: [
        { symbol: 'USDC', balance: 500, usdValue: 500, price: 1 },
        { symbol: 'WETH', balance: 0.1, usdValue: 230, price: 2300, sector: 'Blue Chip' },
      ],
      totalPortfolioValue: 730,
      initialValue: 500,
      peakValue: 730,
      sectorAllocations: [],
      marketRegime: 'RANGING',
    },
    tradeHistory: [],
    costBasis: {
      WETH: {
        symbol: 'WETH',
        totalInvestedUSD: 200,
        totalUnitsPurchased: 0.1,
        currentHolding: 0.1,
        averageCostBasis: 2000,
        realizedPnL: 0,
        lastBuyTime: new Date().toISOString(),
        lastSellTime: null,
        peakPrice: 2300,
      } as any,
    },
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
    totalDeposited: 500,
    onChainWithdrawn: 0,
    lastKnownUSDCBalance: 500,
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

describe('StateManager', () => {
  let state: AgentState;
  let breakerState: BreakerState;
  let sm: StateManager;

  beforeEach(() => {
    state = makeState();
    breakerState = makeBreakerState();
    sm = createStateManager(state, breakerState);
  });

  // ==========================================================================
  // LOAD-BEARING INVARIANT — reference wrapping (do not regress)
  // ==========================================================================

  describe('reference wrapping (CRITICAL)', () => {
    it('wraps by reference, never clones', () => {
      // The single most important test in this file.
      // If this fails, mutations desync and the refactor is broken.
      expect(sm.getState()).toBe(state);
      expect(sm.getBreakerState()).toBe(breakerState);
    });

    it('external mutations are visible through StateManager', () => {
      state.totalCycles = 42;
      expect(sm.getCycleNumber()).toBe(42);
    });

    it('StateManager mutations are visible externally', () => {
      sm.incrementCycleCount();
      sm.incrementCycleCount();
      sm.incrementCycleCount();
      expect(state.totalCycles).toBe(3);
    });

    it('nested mutations propagate (trading.totalPortfolioValue)', () => {
      sm.setPortfolioValue(999);
      expect(state.trading.totalPortfolioValue).toBe(999);
    });

    it('nested mutations propagate (costBasis[symbol])', () => {
      sm.updateCostBasis('WETH', { averageCostBasis: 2100 });
      expect(state.costBasis.WETH.averageCostBasis).toBe(2100);
    });

    it('breaker mutations propagate to the shared breakerState object', () => {
      sm.incrementConsecutiveLosses();
      sm.incrementConsecutiveLosses();
      expect(breakerState.consecutiveLosses).toBe(2);
    });
  });

  // ==========================================================================
  // READS
  // ==========================================================================

  describe('reads', () => {
    it('getPortfolioValue returns totalPortfolioValue', () => {
      expect(sm.getPortfolioValue()).toBe(730);
    });

    it('getPeakValue returns peakValue', () => {
      expect(sm.getPeakValue()).toBe(730);
    });

    it('getMarketRegime returns marketRegime with UNKNOWN fallback', () => {
      expect(sm.getMarketRegime()).toBe('RANGING');
      state.trading.marketRegime = undefined;
      expect(sm.getMarketRegime()).toBe('UNKNOWN');
    });

    it('getActivePositions excludes USDC + dust', () => {
      const positions = sm.getActivePositions();
      expect(positions.map((p) => p.symbol)).toEqual(['WETH']);
      expect(positions[0].usdValue).toBe(230);
    });

    it('getActivePositions computes unrealizedPct from cost basis', () => {
      // WETH avg cost = 2000, current price = 2300 → +15.0%
      const [weth] = sm.getActivePositions();
      expect(weth.unrealizedPct).toBeCloseTo(15.0, 1);
    });

    it('getCircuitBreakerInfo returns inactive when breaker never triggered', () => {
      const info = sm.getCircuitBreakerInfo(2);
      expect(info.active).toBe(false);
      expect(info.reason).toBeNull();
      expect(info.triggeredAt).toBeNull();
    });

    it('getCircuitBreakerInfo returns active when within pause window', () => {
      sm.triggerBreaker('test', 48);
      const info = sm.getCircuitBreakerInfo(2);
      expect(info.active).toBe(true);
      expect(info.reason).toBe('test');
      expect(info.triggeredAt).toBeTruthy();
    });

    it('getRecentTrades returns last N trades', () => {
      sm.recordTrade({
        timestamp: '2026-04-15T10:00:00Z',
        action: 'BUY',
        success: true,
        toToken: 'WETH',
      } as any);
      sm.recordTrade({
        timestamp: '2026-04-15T11:00:00Z',
        action: 'SELL',
        success: false,
        fromToken: 'WETH',
      } as any);
      const trades = sm.getRecentTrades(10);
      expect(trades).toHaveLength(2);
      expect(trades[0].action).toBe('BUY');
      expect(trades[1].action).toBe('SELL');
    });
  });

  // ==========================================================================
  // TRADE HISTORY
  // ==========================================================================

  describe('trade history writes', () => {
    it('recordTrade pushes onto tradeHistory', () => {
      sm.recordTrade({ timestamp: 'x', action: 'BUY', success: true } as any);
      expect(state.tradeHistory).toHaveLength(1);
    });

    it('incrementTotalTrades / incrementSuccessfulTrades', () => {
      sm.incrementTotalTrades();
      sm.incrementSuccessfulTrades();
      expect(state.trading.totalTrades).toBe(1);
      expect(state.trading.successfulTrades).toBe(1);
    });
  });

  // ==========================================================================
  // COST BASIS
  // ==========================================================================

  describe('cost basis writes', () => {
    it('updateCostBasis merges into existing entry', () => {
      sm.updateCostBasis('WETH', { peakPrice: 2400 } as any);
      expect(state.costBasis.WETH.averageCostBasis).toBe(2000); // unchanged
      expect((state.costBasis.WETH as any).peakPrice).toBe(2400);
    });

    it('updateCostBasis creates new entry when missing', () => {
      sm.updateCostBasis('NEW_TOKEN', {
        symbol: 'NEW_TOKEN',
        averageCostBasis: 100,
      } as any);
      expect(state.costBasis.NEW_TOKEN).toBeTruthy();
    });

    it('clearCostBasis removes the entry', () => {
      sm.clearCostBasis('WETH');
      expect(state.costBasis.WETH).toBeUndefined();
    });
  });

  // ==========================================================================
  // CIRCUIT BREAKER
  // ==========================================================================

  describe('circuit breaker writes', () => {
    it('triggerBreaker sets trigger + resets counters', () => {
      breakerState.consecutiveLosses = 3;
      breakerState.rollingTradeResults = [false, false, false];

      sm.triggerBreaker('consecutive losses', 24);

      expect(breakerState.lastBreakerTriggered).toBeTruthy();
      expect(breakerState.lastBreakerReason).toBe('consecutive losses');
      expect(breakerState.breakerSizeReductionUntil).toBeTruthy();
      expect(breakerState.consecutiveLosses).toBe(0);
      expect(breakerState.rollingTradeResults).toEqual([]);
    });

    it('resetBreaker clears all breaker fields', () => {
      sm.triggerBreaker('test', 24);
      sm.resetBreaker();
      expect(breakerState.lastBreakerTriggered).toBeNull();
      expect(breakerState.lastBreakerReason).toBeNull();
      expect(breakerState.breakerSizeReductionUntil).toBeNull();
    });

    it('extendBreakerPause returns false when not triggered', () => {
      expect(sm.extendBreakerPause(2, 2)).toBe(false);
    });

    it('extendBreakerPause extends sizeReductionUntil when triggered', () => {
      sm.triggerBreaker('test', 24);
      const before = breakerState.breakerSizeReductionUntil;
      sm.extendBreakerPause(2, 2);
      const after = breakerState.breakerSizeReductionUntil;
      expect(after).not.toBe(before);
    });

    it('appendRollingResult maintains max window size', () => {
      for (let i = 0; i < 10; i++) sm.appendRollingResult(i % 2 === 0, 5);
      expect(breakerState.rollingTradeResults).toHaveLength(5);
    });

    it('incrementConsecutiveLosses / resetConsecutiveLosses', () => {
      expect(sm.incrementConsecutiveLosses()).toBe(1);
      expect(sm.incrementConsecutiveLosses()).toBe(2);
      sm.resetConsecutiveLosses();
      expect(breakerState.consecutiveLosses).toBe(0);
    });
  });

  // ==========================================================================
  // HARVEST TRACKING
  // ==========================================================================

  describe('harvest tracking', () => {
    it('recordHarvest initializes harvestedProfits if missing', () => {
      sm.recordHarvest({
        timestamp: 'x',
        symbol: 'WETH',
        tier: 'EARLY',
        gainPercent: 15,
        sellPercent: 12,
        amountUSD: 50,
        profitUSD: 7.5,
      });
      expect(state.harvestedProfits).toBeTruthy();
      expect(state.harvestedProfits?.harvests).toHaveLength(1);
      expect(state.harvestedProfits?.totalHarvested).toBe(7.5);
      expect(state.harvestedProfits?.harvestCount).toBe(1);
    });

    it('recordHarvest keeps at most 50 records', () => {
      for (let i = 0; i < 60; i++) {
        sm.recordHarvest({
          timestamp: String(i),
          symbol: 'WETH',
          tier: 'EARLY',
          gainPercent: 1,
          sellPercent: 1,
          amountUSD: 1,
          profitUSD: 1,
        });
      }
      expect(state.harvestedProfits?.harvests).toHaveLength(50);
      expect(state.harvestedProfits?.totalHarvested).toBe(60); // cumulative total preserved
    });
  });

  // ==========================================================================
  // ERROR LOG
  // ==========================================================================

  describe('error log', () => {
    it('logError appends entries with timestamp', () => {
      sm.logError('TEST', 'something broke');
      const log = state.errorLog!;
      expect(log).toHaveLength(1);
      expect(log[0].type).toBe('TEST');
      expect(log[0].message).toBe('something broke');
      expect(log[0].timestamp).toBeTruthy();
    });

    it('logError caps at 100 entries', () => {
      for (let i = 0; i < 150; i++) sm.logError('X', String(i));
      expect(state.errorLog).toHaveLength(100);
    });
  });

  // ==========================================================================
  // TRADE FAILURES
  // ==========================================================================

  describe('trade failures', () => {
    it('recordTradeFailure increments count', () => {
      expect(sm.recordTradeFailure('BAD')).toBe(1);
      expect(sm.recordTradeFailure('BAD')).toBe(2);
      expect(state.tradeFailures.BAD.count).toBe(2);
    });

    it('clearTradeFailures removes the entry', () => {
      sm.recordTradeFailure('BAD');
      sm.clearTradeFailures('BAD');
      expect(state.tradeFailures.BAD).toBeUndefined();
    });
  });
});
