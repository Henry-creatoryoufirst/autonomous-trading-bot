import { describe, it, expect } from 'vitest';
import { calculateConfluence, type ConfluenceContext } from '../confluence.js';

// ---------------------------------------------------------------------------
// Default context for tests
// ---------------------------------------------------------------------------
function defaultCtx(overrides: Partial<ConfluenceContext['adaptiveThresholds']> = {}): ConfluenceContext {
  return {
    adaptiveThresholds: {
      rsiOversold: 30,
      rsiOverbought: 70,
      confluenceBuy: 20,
      confluenceSell: -20,
      confluenceStrongBuy: 45,
      confluenceStrongSell: -45,
      profitTakeTarget: 15,
      profitTakeSellPercent: 50,
      stopLossPercent: 8,
      trailingStopPercent: 5,
      atrStopMultiplier: 2.5,
      atrTrailMultiplier: 2.0,
      regimeMultipliers: {} as any,
      history: [] as any,
      lastAdapted: null,
      adaptationCount: 0,
      ...overrides,
    } as any,
    btcChange24h: 0,
    ethChange24h: 0,
  };
}

describe('calculateConfluence', () => {
  it('returns NEUTRAL with all-neutral inputs', () => {
    const result = calculateConfluence(
      50, // RSI right in the middle
      { macdLine: 0, signalLine: 0, histogram: 0, signal: 'NEUTRAL' as const },
      { upper: 110, middle: 100, lower: 90, percentB: 0.5, bandwidth: 10, signal: 'NORMAL' as const },
      'SIDEWAYS',
      0, // priceChange24h
      0, // priceChange7d
      null, null, null, null, null,
      defaultCtx(),
      1.5, 0.75,
    );
    expect(result.signal).toBe('NEUTRAL');
    expect(result.score).toBe(0);
  });

  it('returns positive score for bullish indicators', () => {
    const result = calculateConfluence(
      25, // oversold RSI
      { macdLine: 1, signalLine: 0.5, histogram: 0.5, signal: 'BULLISH' as const },
      { upper: 110, middle: 100, lower: 90, percentB: -0.1, bandwidth: 10, signal: 'OVERSOLD' as const },
      'STRONG_UP',
      6, // 24h up
      12, // 7d up
      null, null, null, null, null,
      defaultCtx(),
      1.5, 0.75,
    );
    expect(result.score).toBeGreaterThan(45);
    expect(result.signal).toBe('STRONG_BUY');
  });

  it('returns negative score for bearish indicators', () => {
    const result = calculateConfluence(
      80, // overbought RSI
      { macdLine: -1, signalLine: -0.5, histogram: -0.5, signal: 'BEARISH' as const },
      { upper: 110, middle: 100, lower: 90, percentB: 1.2, bandwidth: 10, signal: 'OVERBOUGHT' as const },
      'STRONG_DOWN',
      -6,
      -12,
      null, null, null, null, null,
      defaultCtx(),
      1.5, 0.75,
    );
    expect(result.score).toBeLessThan(-45);
    expect(result.signal).toBe('STRONG_SELL');
  });

  it('ADX low dampens the score by 20%', () => {
    // Get a baseline score without ADX
    const base = calculateConfluence(
      25, null, null, 'STRONG_UP', 6, 12,
      null, null, null, null, null,
      defaultCtx(), 1.5, 0.75,
    );

    // Same inputs but with low ADX (dampens by 20%)
    const dampened = calculateConfluence(
      25, null, null, 'STRONG_UP', 6, 12,
      { adx: 10, plusDI: 20, minusDI: 15, trend: 'NO_TREND' as const },
      null, null, null, null,
      defaultCtx(), 1.5, 0.75,
    );

    expect(dampened.score).toBeLessThan(base.score);
  });

  it('high ATR volatility dampens score', () => {
    const base = calculateConfluence(
      25, null, null, 'STRONG_UP', 6, 12,
      null, null, null, null, null,
      defaultCtx(), 1.5, 0.75,
    );

    const highVol = calculateConfluence(
      25, null, null, 'STRONG_UP', 6, 12,
      null, { atr: 200, atrPercent: 8 }, null, null, null,
      defaultCtx(), 1.5, 0.75,
    );

    expect(highVol.score).toBeLessThan(base.score);
  });

  it('BTC momentum boost adds to score', () => {
    const noMomentum = calculateConfluence(
      50, null, null, 'SIDEWAYS', 0, 0,
      null, null, null, null, null,
      defaultCtx(), 1.5, 0.75,
    );

    const withBtcMomentum = calculateConfluence(
      50, null, null, 'SIDEWAYS', 0, 0,
      null, null, null, null, null,
      { ...defaultCtx(), btcChange24h: 5 },
      1.5, 0.75,
    );

    expect(withBtcMomentum.score).toBe(noMomentum.score + 5);
  });

  it('score is clamped to [-100, 100]', () => {
    const result = calculateConfluence(
      10, // deep oversold
      { macdLine: 5, signalLine: 1, histogram: 4, signal: 'BULLISH' as const },
      { upper: 110, middle: 100, lower: 90, percentB: -0.5, bandwidth: 10, signal: 'OVERSOLD' as const },
      'STRONG_UP',
      10, 20,
      { adx: 50, plusDI: 60, minusDI: 10, trend: 'STRONG_TREND' as const },
      { atr: 1, atrPercent: 0.5 },
      { twapPrice: 95, spotPrice: 100, divergencePct: -2, signal: 'OVERSOLD' as const },
      { netBuyVolumeUSD: 1e6, buyVolumeUSD: 8e5, sellVolumeUSD: 2e5, tradeCount: 100, largeBuyPct: 60, signal: 'STRONG_BUY' as const },
      { bidDepthUSD: 1e6, askDepthUSD: 1e5, depthRatio: 10, inRangeLiquidity: 1e7, signal: 'STRONG_SUPPORT' as const },
      { ...defaultCtx(), btcChange24h: 5, ethChange24h: 5 },
      1.5, 0.75,
    );
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(-100);
  });
});
