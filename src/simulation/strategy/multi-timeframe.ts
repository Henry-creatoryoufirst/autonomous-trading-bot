/**
 * NVR Capital — Level 1: Multi-Timeframe Confluence
 *
 * Derives 4h and 1d candles from 1h base data, calculates indicators
 * on each timeframe, and produces a weighted composite score with
 * alignment bonuses when timeframes agree.
 *
 * Pure functions. No side effects.
 */

import { calculateRSI, calculateMACD, calculateBollingerBands, calculateSMA, calculateATR, calculateADX } from '../../algorithm/indicators.js';
import type { OHLCVCandle, MultiTimeframeData, TimeframeScore, TimeframeAlignment } from '../types.js';

// ============================================================================
// CANDLE AGGREGATION
// ============================================================================

/**
 * Aggregate hourly candles into higher-timeframe candles.
 * @param hourly - Base 1h candle array
 * @param factor - Aggregation factor (4 for 4h, 24 for 1d)
 */
export function aggregateCandles(hourly: OHLCVCandle[], factor: number): OHLCVCandle[] {
  const result: OHLCVCandle[] = [];
  for (let i = 0; i + factor <= hourly.length; i += factor) {
    const chunk = hourly.slice(i, i + factor);
    result.push({
      timestamp: chunk[0].timestamp,
      open: chunk[0].open,
      high: Math.max(...chunk.map(c => c.high)),
      low: Math.min(...chunk.map(c => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((s, c) => s + c.volume, 0),
    });
  }
  return result;
}

/**
 * Build multi-timeframe data from hourly candles up to a given index.
 * Returns candle arrays for 1h, 4h, and 1d timeframes.
 */
export function buildMultiTimeframeData(
  hourlyCandles: OHLCVCandle[],
  currentIndex: number,
): MultiTimeframeData {
  const tf1h = hourlyCandles.slice(0, currentIndex + 1);
  const tf4h = aggregateCandles(tf1h, 4);
  const tf1d = aggregateCandles(tf1h, 24);
  return { tf1h, tf4h, tf1d };
}

// ============================================================================
// SINGLE-TIMEFRAME CONFLUENCE (with optional weight overrides)
// ============================================================================

const DEFAULT_WEIGHTS: Record<string, number> = {
  RSI: 25, MACD: 25, BB: 20, SMA: 15, ADX: 10, MOMENTUM: 8,
};

/**
 * Calculate confluence score for a single timeframe.
 * Mirrors replay-engine's calculateSimConfluence but accepts weight overrides
 * and returns individual indicator signals for dynamic weight tracking.
 */
export function calculateTimeframeConfluence(
  closePrices: number[],
  indicatorWeights?: Record<string, number>,
): TimeframeScore & { timeframe: '1h' } {
  const w = { ...DEFAULT_WEIGHTS, ...indicatorWeights };
  let score = 0;
  const signals: Record<string, number> = {};

  // RSI
  const rsi = calculateRSI(closePrices);
  if (rsi !== null) {
    if (rsi < 30) signals.RSI = w.RSI;
    else if (rsi < 40) signals.RSI = w.RSI * 0.48;
    else if (rsi > 70) signals.RSI = -w.RSI;
    else if (rsi > 60) signals.RSI = -w.RSI * 0.48;
    else signals.RSI = 0;
  } else {
    signals.RSI = 0;
  }
  score += signals.RSI;

  // MACD
  const macd = calculateMACD(closePrices);
  if (macd) {
    signals.MACD = macd.signal === 'BULLISH' ? w.MACD : macd.signal === 'BEARISH' ? -w.MACD : 0;
  } else {
    signals.MACD = 0;
  }
  score += signals.MACD;

  // Bollinger Bands
  const bb = calculateBollingerBands(closePrices);
  if (bb) {
    signals.BB = bb.signal === 'OVERSOLD' ? w.BB : bb.signal === 'OVERBOUGHT' ? -w.BB : 0;
    if (bb.bandwidth !== undefined && bb.bandwidth < 2) signals.BB += 5;
  } else {
    signals.BB = 0;
  }
  score += signals.BB;

  // SMA
  const sma20 = calculateSMA(closePrices, 20);
  const sma50 = calculateSMA(closePrices, 50);
  const currentPrice = closePrices[closePrices.length - 1];
  let smaSignal = 0;
  if (sma20 !== null) smaSignal += currentPrice > sma20 ? 8 : -8;
  if (sma50 !== null) smaSignal += currentPrice > sma50 ? 7 : -7;
  signals.SMA = smaSignal;
  score += signals.SMA;

  // ADX
  const adx = calculateADX(closePrices);
  if (adx) {
    if (adx.adx >= 30) {
      signals.ADX = adx.plusDI > adx.minusDI ? w.ADX : -w.ADX;
    } else if (adx.adx < 15) {
      signals.ADX = 0;
      score = Math.round(score * 0.8);
    } else {
      signals.ADX = 0;
    }
  } else {
    signals.ADX = 0;
  }
  score += signals.ADX;

  // Momentum
  if (closePrices.length >= 24) {
    const mom = (currentPrice - closePrices[closePrices.length - 24]) / closePrices[closePrices.length - 24] * 100;
    if (mom > 5) signals.MOMENTUM = w.MOMENTUM;
    else if (mom > 2) signals.MOMENTUM = w.MOMENTUM * 0.5;
    else if (mom < -5) signals.MOMENTUM = -w.MOMENTUM;
    else if (mom < -2) signals.MOMENTUM = -w.MOMENTUM * 0.5;
    else signals.MOMENTUM = 0;
  } else {
    signals.MOMENTUM = 0;
  }
  score += signals.MOMENTUM;

  // ATR dampening
  const atr = calculateATR(closePrices);
  if (atr && atr.atrPercent > 5) {
    score = Math.round(score * 0.85);
  }

  score = Math.max(-100, Math.min(100, score));

  const direction = score > 10 ? 'BULLISH' as const : score < -10 ? 'BEARISH' as const : 'NEUTRAL' as const;

  return { timeframe: '1h', score, weight: 1, direction, indicatorSignals: signals };
}

// ============================================================================
// MULTI-TIMEFRAME COMPOSITE
// ============================================================================

const ALIGNMENT_BONUS = 12;
const CONFLICT_4H_PENALTY = 8;
const CONFLICT_1D_PENALTY = 5;

/**
 * Calculate composite confluence with 1h as PRIMARY signal.
 *
 * Instead of weighted average (which dilutes the 1h signal), this uses
 * 1h as the base and applies MTF alignment as a filter:
 *   - All timeframes agree → +12 bonus (strong conviction)
 *   - 4h conflicts with 1h → -8 penalty (reduce conviction)
 *   - 1d conflicts with 1h → -5 penalty (mild caution)
 *
 * 1h dominates. Higher timeframes only filter/confirm.
 */
export function calculateMultiTimeframeConfluence(
  mtfData: MultiTimeframeData,
  indicatorWeights?: Record<string, number>,
): TimeframeAlignment {
  const closePrices1h = mtfData.tf1h.map(c => c.close);
  const closePrices4h = mtfData.tf4h.map(c => c.close);
  const closePrices1d = mtfData.tf1d.map(c => c.close);

  const scores: TimeframeScore[] = [];

  // 1h is always the primary signal
  const score1h = calculateTimeframeConfluence(closePrices1h, indicatorWeights);
  score1h.weight = 1.0;
  scores.push(score1h);

  // 4h filter (200+ hourly candles needed)
  if (closePrices4h.length >= 50) {
    const raw4h = calculateTimeframeConfluence(closePrices4h, indicatorWeights);
    scores.push({ ...raw4h, timeframe: '4h', weight: 0 });
  }

  // 1d filter (1200+ hourly candles needed)
  if (closePrices1d.length >= 50) {
    const raw1d = calculateTimeframeConfluence(closePrices1d, indicatorWeights);
    scores.push({ ...raw1d, timeframe: '1d', weight: 0 });
  }

  // Start with the 1h score as base
  let composite = score1h.score;

  // Apply MTF filter bonuses/penalties
  const dir1h = score1h.direction;
  let aligned = true;
  let bonus = 0;

  for (const sc of scores.slice(1)) {
    if (sc.direction === dir1h && dir1h !== 'NEUTRAL') {
      // Higher TF confirms 1h direction — bonus
      bonus += sc.timeframe === '4h' ? 6 : 4;
    } else if (sc.direction !== 'NEUTRAL' && dir1h !== 'NEUTRAL' && sc.direction !== dir1h) {
      // Higher TF conflicts — penalty
      aligned = false;
      bonus -= sc.timeframe === '4h' ? CONFLICT_4H_PENALTY : CONFLICT_1D_PENALTY;
    }
  }

  // Full alignment bonus when all agree
  if (aligned && scores.length >= 2 && dir1h !== 'NEUTRAL') {
    bonus += ALIGNMENT_BONUS - 10; // net bonus beyond individual confirmations
  }

  composite = Math.max(-100, Math.min(100, composite + bonus));

  return { aligned, bonus, scores, compositeScore: composite };
}
