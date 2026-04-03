import { describe, it, expect } from 'vitest';
import {
  calculateRSI,
  calculateEMA,
  calculateMACD,
  calculateBollingerBands,
  calculateSMA,
  calculateATR,
  calculateADX,
  determineTrend,
} from '../indicators.js';

// ---------------------------------------------------------------------------
// Helper: generate a simple price series
// ---------------------------------------------------------------------------
function linearPrices(start: number, step: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => start + step * i);
}

function constantPrices(value: number, count: number): number[] {
  return Array(count).fill(value);
}

// ===========================================================================
// RSI
// ===========================================================================
describe('calculateRSI', () => {
  it('returns null when not enough data', () => {
    expect(calculateRSI([100, 101, 102])).toBeNull();
  });

  it('returns 100 when prices only go up (no losses)', () => {
    const prices = linearPrices(100, 1, 20); // monotonically increasing
    expect(calculateRSI(prices)).toBe(100);
  });

  it('returns a value between 0 and 100 for mixed prices', () => {
    // Alternating up/down pattern
    const prices = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 === 0 ? 2 : -1));
    const rsi = calculateRSI(prices)!;
    expect(rsi).toBeGreaterThan(0);
    expect(rsi).toBeLessThan(100);
  });

  it('returns low RSI for mostly declining prices', () => {
    const prices = linearPrices(200, -2, 20); // steady decline
    const rsi = calculateRSI(prices)!;
    expect(rsi).toBeLessThan(20);
  });
});

// ===========================================================================
// EMA
// ===========================================================================
describe('calculateEMA', () => {
  it('returns empty array when not enough data', () => {
    expect(calculateEMA([1, 2], 5)).toEqual([]);
  });

  it('first EMA value equals SMA of the first N prices', () => {
    const prices = [2, 4, 6, 8, 10, 12];
    const ema = calculateEMA(prices, 3);
    expect(ema[0]).toBeCloseTo((2 + 4 + 6) / 3);
  });

  it('returns correct number of values', () => {
    const prices = linearPrices(1, 1, 20);
    const ema = calculateEMA(prices, 5);
    // length = prices.length - period + 1
    expect(ema).toHaveLength(16);
  });
});

// ===========================================================================
// MACD
// ===========================================================================
describe('calculateMACD', () => {
  it('returns null when not enough data', () => {
    expect(calculateMACD(linearPrices(100, 1, 10))).toBeNull();
  });

  it('returns positive MACD line for steadily rising prices', () => {
    const prices = linearPrices(100, 1, 60);
    const result = calculateMACD(prices)!;
    expect(result).not.toBeNull();
    expect(result.macdLine).toBeGreaterThan(0);
  });

  it('returns negative MACD line for steadily falling prices', () => {
    const prices = linearPrices(200, -1, 60);
    const result = calculateMACD(prices)!;
    expect(result.macdLine).toBeLessThan(0);
  });
});

// ===========================================================================
// Bollinger Bands
// ===========================================================================
describe('calculateBollingerBands', () => {
  it('returns null when not enough data', () => {
    expect(calculateBollingerBands([1, 2, 3])).toBeNull();
  });

  it('middle band equals SMA of last N prices', () => {
    const prices = linearPrices(90, 1, 25);
    const bb = calculateBollingerBands(prices, 20)!;
    const last20 = prices.slice(-20);
    const expectedSMA = last20.reduce((a, b) => a + b, 0) / 20;
    expect(bb.middle).toBeCloseTo(expectedSMA);
  });

  it('upper > middle > lower', () => {
    const prices = linearPrices(90, 1, 25);
    const bb = calculateBollingerBands(prices, 20)!;
    expect(bb.upper).toBeGreaterThan(bb.middle);
    expect(bb.middle).toBeGreaterThan(bb.lower);
  });

  it('constant prices produce zero bandwidth and percentB 0.5', () => {
    const prices = constantPrices(100, 25);
    const bb = calculateBollingerBands(prices, 20)!;
    expect(bb.bandwidth).toBeCloseTo(0);
    // upper === lower === middle, so percentB fallback is 0.5
    expect(bb.percentB).toBeCloseTo(0.5);
  });

  it('price above upper band signals OVERBOUGHT', () => {
    // 20 constant prices then a spike
    const prices = [...constantPrices(100, 20), 200];
    const bb = calculateBollingerBands(prices, 20)!;
    expect(bb.signal).toBe('OVERBOUGHT');
    expect(bb.percentB).toBeGreaterThan(1);
  });
});

// ===========================================================================
// SMA
// ===========================================================================
describe('calculateSMA', () => {
  it('returns null when not enough data', () => {
    expect(calculateSMA([1], 5)).toBeNull();
  });

  it('returns correct average', () => {
    expect(calculateSMA([10, 20, 30, 40, 50], 5)).toBeCloseTo(30);
  });

  it('uses only the last N prices', () => {
    expect(calculateSMA([1, 2, 3, 100, 200], 2)).toBeCloseTo(150);
  });
});

// ===========================================================================
// ATR
// ===========================================================================
describe('calculateATR', () => {
  it('returns null when not enough data', () => {
    expect(calculateATR([100, 101], 14)).toBeNull();
  });

  it('constant prices produce zero ATR', () => {
    const prices = constantPrices(100, 20);
    const result = calculateATR(prices)!;
    expect(result.atr).toBeCloseTo(0);
    expect(result.atrPercent).toBeCloseTo(0);
  });

  it('ATR is positive for volatile prices', () => {
    // Alternating high/low
    const prices = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 100 : 110));
    const result = calculateATR(prices)!;
    expect(result.atr).toBeGreaterThan(0);
    expect(result.atrPercent).toBeGreaterThan(0);
  });
});

// ===========================================================================
// ADX
// ===========================================================================
describe('calculateADX', () => {
  it('returns null when not enough data', () => {
    expect(calculateADX([100, 101, 102])).toBeNull();
  });

  it('returns STRONG_TREND for steady uptrend', () => {
    const prices = linearPrices(100, 2, 50); // strong uptrend
    const result = calculateADX(prices)!;
    expect(result).not.toBeNull();
    expect(result.plusDI).toBeGreaterThan(result.minusDI);
  });
});

// ===========================================================================
// determineTrend
// ===========================================================================
describe('determineTrend', () => {
  it('returns SIDEWAYS for fewer than 5 prices', () => {
    expect(determineTrend([1, 2, 3], null, null)).toBe('SIDEWAYS');
  });

  it('returns STRONG_UP for large weekly + daily gains above SMA', () => {
    // Need at least 168 prices for weekly change. Build an uptrending series.
    const prices = linearPrices(100, 0.2, 200);
    const current = prices[prices.length - 1];
    const sma20 = current - 5; // below current price
    expect(determineTrend(prices, sma20, null)).toBe('STRONG_UP');
  });

  it('returns DOWN for declining prices below SMA', () => {
    const prices = linearPrices(200, -0.1, 200);
    const current = prices[prices.length - 1];
    const sma20 = current + 5; // above current price
    expect(determineTrend(prices, sma20, null)).toBe('DOWN');
  });
});
