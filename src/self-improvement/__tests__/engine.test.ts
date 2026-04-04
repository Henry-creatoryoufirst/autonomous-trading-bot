import { describe, it, expect, beforeEach } from 'vitest';
import {
  initSelfImprovement,
  describePattern,
  classifyTradePattern,
  calculateWinRateTruth,
  adaptThresholds,
  THRESHOLD_BOUNDS,
  DEFAULT_ADAPTIVE_THRESHOLDS,
  setShadowProposals,
} from '../engine.js';

import type { TradeRecord } from '../../../types/index.js';
import type { AgentState } from '../../../types/state.js';

// ---------------------------------------------------------------------------
// Helper: build a minimal mock state that satisfies the module
// ---------------------------------------------------------------------------
function makeMockState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    tradeHistory: [],
    costBasis: {},
    strategyPatterns: {},
    adaptiveThresholds: { ...DEFAULT_ADAPTIVE_THRESHOLDS, history: [], adaptationCount: 0, lastAdapted: null },
    explorationState: {
      totalExplorationTrades: 0,
      totalExploitationTrades: 0,
      consecutiveHolds: 0,
      lastTradeTimestamp: null,
      stagnationAlerts: 0,
    },
    lastReviewTradeIndex: 0,
    trading: { lastTrade: null },
    ...overrides,
  } as unknown as AgentState;
}

function makeTrade(partial: Partial<TradeRecord>): TradeRecord {
  return {
    timestamp: new Date().toISOString(),
    cycle: 1,
    action: 'BUY',
    fromToken: 'USDC',
    toToken: 'ETH',
    amountUSD: 100,
    success: true,
    portfolioValueBefore: 1000,
    reasoning: 'test',
    marketConditions: { fearGreed: 50, ethPrice: 2500, btcPrice: 60000 },
    signalContext: {
      marketRegime: 'TRENDING_UP',
      confluenceScore: 10,
      rsi: 35,
      macdSignal: 'BULLISH',
      btcFundingRate: null,
      ethFundingRate: null,
      baseTVLChange24h: null,
      baseDEXVolume24h: null,
      triggeredBy: 'AI',
    },
    ...partial,
  } as unknown as TradeRecord;
}

// ===========================================================================
// describePattern (pure function, no state dependency)
// ===========================================================================
describe('describePattern', () => {
  it('formats a full pattern ID into human-readable description', () => {
    const desc = describePattern('BUY_OVERSOLD_TRENDING_UP_STRONG_BUY');
    expect(desc).toContain('BUY');
    expect(desc).toContain('RSI oversold');
    expect(desc).toContain('TRENDING');
  });

  it('returns the raw string for malformed pattern IDs', () => {
    expect(describePattern('FOO')).toBe('FOO');
  });
});

// ===========================================================================
// THRESHOLD_BOUNDS — sanity checks on safety rails
// ===========================================================================
describe('THRESHOLD_BOUNDS', () => {
  it('has sane bounds for confluenceBuy (capped to prevent self-shutdown)', () => {
    const b = THRESHOLD_BOUNDS['confluenceBuy'];
    expect(b.max).toBeLessThanOrEqual(28); // v21.2: capped at 28
    expect(b.min).toBeGreaterThanOrEqual(5);
    expect(b.maxStep).toBeGreaterThan(0);
  });

  it('stop loss bounds never allow positive values (always a loss threshold)', () => {
    const b = THRESHOLD_BOUNDS['stopLossPercent'];
    expect(b.max).toBeLessThan(0);
    expect(b.min).toBeLessThan(0);
  });
});

// ===========================================================================
// classifyTradePattern — requires state for adaptive thresholds
// ===========================================================================
describe('classifyTradePattern', () => {
  beforeEach(() => {
    const mockState = makeMockState();
    initSelfImprovement({ state: mockState, getActiveDirectives: () => [] });
  });

  it('classifies a BUY with oversold RSI in trending-up market', () => {
    const trade = makeTrade({
      action: 'BUY',
      signalContext: {
        marketRegime: 'TRENDING_UP',
        confluenceScore: 10,
        rsi: 25, // below default 30 oversold
        macdSignal: 'BULLISH',
        btcFundingRate: null, ethFundingRate: null,
        baseTVLChange24h: null, baseDEXVolume24h: null,
        triggeredBy: 'AI',
      },
    } as unknown as Partial<TradeRecord>);

    const pattern = classifyTradePattern(trade);
    expect(pattern).toBe('BUY_OVERSOLD_TRENDING_UP_BUY');
  });

  it('returns UNKNOWN buckets when signalContext is missing', () => {
    const trade = makeTrade({ signalContext: undefined } as unknown as Partial<TradeRecord>);
    expect(classifyTradePattern(trade)).toBe('UNKNOWN_UNKNOWN_UNKNOWN_UNKNOWN');
  });

  it('classifies neutral RSI and strong buy confluence correctly', () => {
    const trade = makeTrade({
      signalContext: {
        marketRegime: 'RANGING',
        confluenceScore: 35, // above default 30 strongBuy
        rsi: 50, // neutral
        macdSignal: null,
        btcFundingRate: null, ethFundingRate: null,
        baseTVLChange24h: null, baseDEXVolume24h: null,
        triggeredBy: 'AI',
      },
    } as unknown as Partial<TradeRecord>);

    const pattern = classifyTradePattern(trade);
    expect(pattern).toBe('BUY_NEUTRAL_RANGING_STRONG_BUY');
  });
});

// ===========================================================================
// calculateWinRateTruth — round-trip matching from trade history
// ===========================================================================
describe('calculateWinRateTruth', () => {
  it('returns zeros for empty trade history', () => {
    initSelfImprovement({ state: makeMockState(), getActiveDirectives: () => [] });
    const truth = calculateWinRateTruth();
    expect(truth.totalRoundTrips).toBe(0);
    expect(truth.realizedWinRate).toBe(0);
    expect(truth.executionWinRate).toBe(0);
    expect(truth.profitFactor).toBe(0);
  });

  it('computes correct win rate from matched BUY-SELL round trips', () => {
    const trades: TradeRecord[] = [
      makeTrade({ action: 'BUY', toToken: 'ETH', amountUSD: 100, timestamp: '2025-01-01T00:00:00Z' }),
      makeTrade({ action: 'SELL', fromToken: 'ETH', toToken: 'USDC', amountUSD: 120, timestamp: '2025-01-01T01:00:00Z' }),
      makeTrade({ action: 'BUY', toToken: 'AERO', amountUSD: 100, timestamp: '2025-01-01T02:00:00Z' }),
      makeTrade({ action: 'SELL', fromToken: 'AERO', toToken: 'USDC', amountUSD: 80, timestamp: '2025-01-01T03:00:00Z' }),
    ];

    initSelfImprovement({ state: makeMockState({ tradeHistory: trades }), getActiveDirectives: () => [] });
    const truth = calculateWinRateTruth();

    expect(truth.totalRoundTrips).toBe(2);
    expect(truth.profitableRoundTrips).toBe(1); // ETH was profitable
    expect(truth.realizedWinRate).toBe(50); // 1/2 = 50%
    expect(truth.grossProfitUSD).toBe(20); // $120 - $100
    expect(truth.grossLossUSD).toBe(20);   // $100 - $80
    expect(truth.profitFactor).toBe(1);    // 20/20
  });

  it('computes Infinity-capped profit factor when no losses', () => {
    const trades: TradeRecord[] = [
      makeTrade({ action: 'BUY', toToken: 'ETH', amountUSD: 100, timestamp: '2025-01-01T00:00:00Z' }),
      makeTrade({ action: 'SELL', fromToken: 'ETH', toToken: 'USDC', amountUSD: 150, timestamp: '2025-01-01T01:00:00Z' }),
    ];

    initSelfImprovement({ state: makeMockState({ tradeHistory: trades }), getActiveDirectives: () => [] });
    const truth = calculateWinRateTruth();

    expect(truth.profitFactor).toBe(999); // Infinity capped to 999
    expect(truth.realizedWinRate).toBe(100);
  });

  it('ignores unmatched sells (pre-existing positions)', () => {
    const trades: TradeRecord[] = [
      makeTrade({ action: 'SELL', fromToken: 'ETH', toToken: 'USDC', amountUSD: 200, timestamp: '2025-01-01T00:00:00Z' }),
    ];

    initSelfImprovement({ state: makeMockState({ tradeHistory: trades }), getActiveDirectives: () => [] });
    const truth = calculateWinRateTruth();
    expect(truth.totalRoundTrips).toBe(0);
  });
});

// ===========================================================================
// adaptThresholds — shadow model validation
// ===========================================================================
describe('adaptThresholds', () => {
  it('does nothing when totalTrades < 3 (insufficient data)', () => {
    const mockState = makeMockState();
    initSelfImprovement({ state: mockState, getActiveDirectives: () => [] });
    setShadowProposals([]);

    const review = {
      timestamp: new Date().toISOString(),
      triggerReason: 'TRADE_COUNT' as const,
      tradesSinceLastReview: 2,
      insights: [],
      recommendations: [],
      periodStats: { winRate: 0.2, avgReturn: -5, totalTrades: 2, bestPattern: null, worstPattern: null, dominantRegime: null },
    };

    const oldConf = mockState.adaptiveThresholds.confluenceBuy;
    adaptThresholds(review);
    // Should not change anything — not enough data
    expect(mockState.adaptiveThresholds.confluenceBuy).toBe(oldConf);
  });

  it('proposes raising confluence thresholds when win rate is low', () => {
    const mockState = makeMockState();
    initSelfImprovement({ state: mockState, getActiveDirectives: () => [] });
    setShadowProposals([]);

    const review = {
      timestamp: new Date().toISOString(),
      triggerReason: 'TRADE_COUNT' as const,
      tradesSinceLastReview: 10,
      insights: [],
      recommendations: [],
      periodStats: { winRate: 0.2, avgReturn: -3, totalTrades: 10, bestPattern: null, worstPattern: null, dominantRegime: null },
    };

    adaptThresholds(review, 'TRENDING_UP');
    // Should have created shadow proposals, not immediately applied
    // The thresholds should NOT change after just one review
    expect(mockState.adaptiveThresholds.adaptationCount).toBe(1);
    // confluenceBuy should still be unchanged (shadow, not promoted)
    expect(mockState.adaptiveThresholds.confluenceBuy).toBe(DEFAULT_ADAPTIVE_THRESHOLDS.confluenceBuy);
  });

  it('increments adaptationCount on each call', () => {
    const mockState = makeMockState();
    initSelfImprovement({ state: mockState, getActiveDirectives: () => [] });
    setShadowProposals([]);

    const review = {
      timestamp: new Date().toISOString(),
      triggerReason: 'TIME_ELAPSED' as const,
      tradesSinceLastReview: 5,
      insights: [],
      recommendations: [],
      periodStats: { winRate: 0.5, avgReturn: 1, totalTrades: 5, bestPattern: null, worstPattern: null, dominantRegime: null },
    };

    adaptThresholds(review);
    adaptThresholds(review);
    expect(mockState.adaptiveThresholds.adaptationCount).toBe(2);
  });
});
