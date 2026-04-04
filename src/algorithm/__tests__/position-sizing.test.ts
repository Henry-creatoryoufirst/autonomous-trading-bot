import { describe, it, expect } from 'vitest';
import {
  getEffectiveKellyCeiling,
  calculateKellyPositionSize,
  calculateVolatilityMultiplier,
  calculateInstitutionalPositionSize,
  type KellyConstants,
  type VolatilityConstants,
  type PositionSizingState,
} from '../position-sizing.js';

// ---------------------------------------------------------------------------
// Shared test constants
// ---------------------------------------------------------------------------
const kc: KellyConstants = {
  KELLY_FRACTION: 0.25,
  KELLY_MIN_TRADES: 5,
  KELLY_ROLLING_WINDOW: 50,
  KELLY_POSITION_FLOOR_USD: 50,
  KELLY_POSITION_CEILING_PCT: 15,
  KELLY_SMALL_PORTFOLIO_CEILING_PCT: 25,
  KELLY_SMALL_PORTFOLIO_THRESHOLD: 500,
};

const vc: VolatilityConstants = {
  VOL_TARGET_DAILY_PCT: 2,
  VOL_HIGH_THRESHOLD: 5,
  VOL_HIGH_REDUCTION: 0.6,
  VOL_LOW_THRESHOLD: 0.5,
  VOL_LOW_BOOST: 1.3,
};

function emptyState(): PositionSizingState {
  return { tradeHistory: [], costBasis: {} };
}

// ===========================================================================
// getEffectiveKellyCeiling
// ===========================================================================
describe('getEffectiveKellyCeiling', () => {
  it('returns small ceiling for small portfolios', () => {
    expect(getEffectiveKellyCeiling(200, 500, 25, 15)).toBe(25);
  });

  it('returns normal ceiling for large portfolios', () => {
    expect(getEffectiveKellyCeiling(1000, 500, 25, 15)).toBe(15);
  });

  it('returns normal ceiling at exact threshold', () => {
    expect(getEffectiveKellyCeiling(500, 500, 25, 15)).toBe(15);
  });
});

// ===========================================================================
// calculateKellyPositionSize
// ===========================================================================
describe('calculateKellyPositionSize', () => {
  it('returns fallback size when no trade history', () => {
    const result = calculateKellyPositionSize(1000, emptyState(), kc);
    expect(result.rawKelly).toBe(0);
    expect(result.winRate).toBe(0);
    expect(result.kellyUSD).toBeGreaterThan(0);
    expect(result.kellyUSD).toBeLessThanOrEqual(1000 * (kc.KELLY_POSITION_CEILING_PCT / 100));
  });

  it('respects ceiling even when it is below floor (ceiling wins)', () => {
    // portfolioValue=100, ceiling=25% => max $25, which is below $50 floor.
    // The ceiling takes priority (you can't bet more than ceiling% of portfolio).
    const result = calculateKellyPositionSize(100, emptyState(), kc);
    expect(result.kellyUSD).toBeLessThanOrEqual(100 * (kc.KELLY_SMALL_PORTFOLIO_CEILING_PCT / 100));
  });

  it('respects position floor for adequate portfolios', () => {
    const result = calculateKellyPositionSize(2000, emptyState(), kc);
    expect(result.kellyUSD).toBeGreaterThanOrEqual(kc.KELLY_POSITION_FLOOR_USD);
  });

  it('uses small portfolio ceiling for small portfolios', () => {
    const result = calculateKellyPositionSize(300, emptyState(), kc);
    // Max = 300 * 25% = 75
    expect(result.kellyUSD).toBeLessThanOrEqual(300 * (kc.KELLY_SMALL_PORTFOLIO_CEILING_PCT / 100));
  });

  it('computes Kelly from trade history with wins and losses', () => {
    const makeTrade = (pnlPct: number, idx: number) => ({
      timestamp: new Date().toISOString(),
      cycle: idx,
      action: 'SELL' as const,
      fromToken: 'ETH',
      toToken: 'USDC',
      amountUSD: 100,
      tokenAmount: 1,
      success: true,
      portfolioValueBefore: 1000,
      reasoning: 'test',
      marketConditions: { btcPrice: 60000, ethPrice: 3000, fearGreedIndex: 50 },
    });

    const trades = Array.from({ length: 10 }, (_, i) => makeTrade(i < 7 ? 0.1 : -0.05, i));

    const costBasis = {
      ETH: {
        symbol: 'ETH',
        totalInvestedUSD: 100,
        totalTokensAcquired: 1,
        averageCostBasis: 95, // wins: sellPrice = 100/1 = 100 > 95
        currentHolding: 1,
        realizedPnL: 0,
        unrealizedPnL: 0,
        peakPrice: 100,
        peakPriceDate: '',
        firstBuyDate: '',
        lastTradeDate: '',
        atrStopPercent: null,
        atrTrailPercent: null,
        atrAtEntry: null,
      },
    };

    const state = { tradeHistory: trades, costBasis } as unknown as PositionSizingState;
    const result = calculateKellyPositionSize(1000, state, kc);
    expect(result.winRate).toBeGreaterThan(0);
    expect(result.kellyUSD).toBeGreaterThan(0);
  });
});

// ===========================================================================
// calculateVolatilityMultiplier
// ===========================================================================
describe('calculateVolatilityMultiplier', () => {
  it('returns multiplier 1.0 with insufficient data', () => {
    const result = calculateVolatilityMultiplier(emptyState(), vc);
    expect(result.multiplier).toBe(1.0);
  });

  it('returns high reduction for high volatility', () => {
    const trades = Array.from({ length: 10 }, (_, i) => ({
      timestamp: new Date().toISOString(),
      cycle: i,
      action: 'BUY' as const,
      fromToken: 'USDC',
      toToken: 'ETH',
      amountUSD: 100,
      success: true,
      portfolioValueBefore: 1000,
      portfolioValueAfter: 1000 + (i % 2 === 0 ? 200 : -200), // wild swings
      reasoning: 'test',
      marketConditions: { btcPrice: 60000, ethPrice: 3000, fearGreedIndex: 50 },
    }));

    const state = { tradeHistory: trades, costBasis: {} } as unknown as PositionSizingState;
    const result = calculateVolatilityMultiplier(state, vc);
    expect(result.multiplier).toBeLessThanOrEqual(1.0);
  });

  it('returns boost for low volatility', () => {
    // Very small changes = low vol
    const trades = Array.from({ length: 10 }, (_, i) => ({
      timestamp: new Date().toISOString(),
      cycle: i,
      action: 'BUY' as const,
      fromToken: 'USDC',
      toToken: 'ETH',
      amountUSD: 100,
      success: true,
      portfolioValueBefore: 1000,
      portfolioValueAfter: 1000 + i * 0.01, // negligible change
      reasoning: 'test',
      marketConditions: { btcPrice: 60000, ethPrice: 3000, fearGreedIndex: 50 },
    }));

    const state = { tradeHistory: trades, costBasis: {} } as unknown as PositionSizingState;
    const result = calculateVolatilityMultiplier(state, vc);
    expect(result.multiplier).toBeGreaterThanOrEqual(1.0);
  });
});

// ===========================================================================
// calculateInstitutionalPositionSize
// ===========================================================================
describe('calculateInstitutionalPositionSize', () => {
  it('respects floor and ceiling', () => {
    const result = calculateInstitutionalPositionSize(
      1000,
      emptyState(),
      kc,
      vc,
      { score: 0, btcChange24h: 0, ethChange24h: 0, fearGreedValue: 50, positionMultiplier: 1.0, deploymentBias: 'NORMAL', dataAvailable: true },
      { breakerSizeReductionUntil: null },
      false,
      0.5,
    );
    expect(result.sizeUSD).toBeGreaterThanOrEqual(kc.KELLY_POSITION_FLOOR_USD);
    expect(result.sizeUSD).toBeLessThanOrEqual(1000 * (kc.KELLY_POSITION_CEILING_PCT / 100));
  });

  it('applies breaker reduction when active', () => {
    const futureDate = new Date(Date.now() + 3600_000).toISOString();

    const normal = calculateInstitutionalPositionSize(
      1000, emptyState(), kc, vc,
      { score: 0, btcChange24h: 0, ethChange24h: 0, fearGreedValue: 50, positionMultiplier: 1.0, deploymentBias: 'NORMAL', dataAvailable: true },
      { breakerSizeReductionUntil: null },
      false, 0.5,
    );

    const reduced = calculateInstitutionalPositionSize(
      1000, emptyState(), kc, vc,
      { score: 0, btcChange24h: 0, ethChange24h: 0, fearGreedValue: 50, positionMultiplier: 1.0, deploymentBias: 'NORMAL', dataAvailable: true },
      { breakerSizeReductionUntil: futureDate },
      false, 0.5,
    );

    expect(reduced.breakerReduction).toBe(true);
    expect(reduced.sizeUSD).toBeLessThanOrEqual(normal.sizeUSD);
  });

  it('bypasses breaker in cash deployment mode', () => {
    const futureDate = new Date(Date.now() + 3600_000).toISOString();

    const result = calculateInstitutionalPositionSize(
      1000, emptyState(), kc, vc,
      { score: 0, btcChange24h: 0, ethChange24h: 0, fearGreedValue: 50, positionMultiplier: 1.0, deploymentBias: 'NORMAL', dataAvailable: true },
      { breakerSizeReductionUntil: futureDate },
      true, // cash deployment mode
      0.5,
    );

    expect(result.breakerReduction).toBe(false);
  });
});
