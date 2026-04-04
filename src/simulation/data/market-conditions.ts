/**
 * NVR Capital — Market Condition Classifier
 *
 * Classifies historical periods into market regimes:
 * BULL, BEAR, RANGING, VOLATILE
 *
 * Used by the confidence scorer to ensure strategies perform
 * well across all market conditions before deployment.
 */

import type { OHLCVCandle, MarketCondition, MarketPeriod } from '../types.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Minimum candles per classification window */
const MIN_WINDOW_SIZE = 20;

/** Default window size for classification (candles) */
const DEFAULT_WINDOW_SIZE = 168; // ~1 week of hourly candles

/** Thresholds for classification */
const BULL_RETURN_THRESHOLD = 0.05;     // +5% return = bull
const BEAR_RETURN_THRESHOLD = -0.05;    // -5% return = bear
const HIGH_VOLATILITY_THRESHOLD = 0.04; // 4% daily vol = volatile
const RANGING_VOLATILITY_THRESHOLD = 0.015; // <1.5% daily vol = ranging

// ============================================================================
// CORE CLASSIFIER
// ============================================================================

/**
 * Classify a single window of candles into a market condition.
 */
export function classifyWindow(candles: OHLCVCandle[]): MarketCondition {
  if (candles.length < 2) return 'RANGING';

  const firstPrice = candles[0].close;
  const lastPrice = candles[candles.length - 1].close;
  const returnPct = (lastPrice - firstPrice) / firstPrice;

  // Calculate volatility (annualized std dev of returns)
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i - 1].close > 0) {
      returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
    }
  }

  const avgReturn = returns.length > 0
    ? returns.reduce((s, r) => s + r, 0) / returns.length
    : 0;
  const variance = returns.length > 1
    ? returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1)
    : 0;
  const dailyVol = Math.sqrt(variance);

  // Classification logic:
  // 1. If volatility is extremely high, it's VOLATILE regardless of direction
  if (dailyVol > HIGH_VOLATILITY_THRESHOLD) return 'VOLATILE';

  // 2. If return is strongly positive, it's BULL
  if (returnPct > BULL_RETURN_THRESHOLD) return 'BULL';

  // 3. If return is strongly negative, it's BEAR
  if (returnPct < BEAR_RETURN_THRESHOLD) return 'BEAR';

  // 4. Low volatility + small return = RANGING
  if (dailyVol < RANGING_VOLATILITY_THRESHOLD) return 'RANGING';

  // 5. Moderate move but not extreme — classify by direction
  if (returnPct > 0.02) return 'BULL';
  if (returnPct < -0.02) return 'BEAR';

  return 'RANGING';
}

/**
 * Calculate metrics for a window of candles.
 */
export function calculateWindowMetrics(candles: OHLCVCandle[]): MarketPeriod['metrics'] {
  if (candles.length < 2) {
    return { returnPct: 0, volatility: 0, maxDrawdownPct: 0, avgVolume: 0 };
  }

  const firstPrice = candles[0].close;
  const lastPrice = candles[candles.length - 1].close;
  const returnPct = (lastPrice - firstPrice) / firstPrice;

  // Volatility
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i - 1].close > 0) {
      returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
    }
  }
  const avgRet = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / (returns.length - 1)
    : 0;
  const volatility = Math.sqrt(variance) * Math.sqrt(365 * 24); // annualize from hourly

  // Max drawdown
  let peak = candles[0].close;
  let maxDD = 0;
  for (const c of candles) {
    if (c.close > peak) peak = c.close;
    const dd = (peak - c.close) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  // Average volume
  const avgVolume = candles.reduce((s, c) => s + c.volume, 0) / candles.length;

  return {
    returnPct,
    volatility,
    maxDrawdownPct: maxDD * 100,
    avgVolume,
  };
}

// ============================================================================
// FULL DATASET CLASSIFICATION
// ============================================================================

/**
 * Classify an entire dataset into sequential market periods.
 *
 * @param candles - OHLCV candle data sorted by timestamp
 * @param windowSize - Number of candles per classification window
 * @returns Array of classified market periods
 */
export function classifyMarketPeriods(
  candles: OHLCVCandle[],
  windowSize = DEFAULT_WINDOW_SIZE
): MarketPeriod[] {
  if (candles.length < MIN_WINDOW_SIZE) return [];

  const effectiveWindow = Math.min(windowSize, candles.length);
  const periods: MarketPeriod[] = [];

  for (let start = 0; start + effectiveWindow <= candles.length; start += effectiveWindow) {
    const end = Math.min(start + effectiveWindow, candles.length);
    const window = candles.slice(start, end);

    const condition = classifyWindow(window);
    const metrics = calculateWindowMetrics(window);

    periods.push({
      condition,
      startIndex: start,
      endIndex: end - 1,
      startTime: window[0].timestamp,
      endTime: window[window.length - 1].timestamp,
      metrics,
    });
  }

  // Merge adjacent periods with the same condition
  return mergePeriods(periods);
}

/**
 * Merge adjacent periods with the same market condition.
 */
function mergePeriods(periods: MarketPeriod[]): MarketPeriod[] {
  if (periods.length <= 1) return periods;

  const merged: MarketPeriod[] = [periods[0]];

  for (let i = 1; i < periods.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = periods[i];

    if (curr.condition === prev.condition) {
      // Merge: extend the previous period
      prev.endIndex = curr.endIndex;
      prev.endTime = curr.endTime;
      // Recalculate metrics as weighted average
      const prevWeight = prev.endIndex - prev.startIndex + 1;
      const currWeight = curr.endIndex - curr.startIndex + 1;
      const totalWeight = prevWeight + currWeight;
      prev.metrics = {
        returnPct: (prev.metrics.returnPct * prevWeight + curr.metrics.returnPct * currWeight) / totalWeight,
        volatility: (prev.metrics.volatility * prevWeight + curr.metrics.volatility * currWeight) / totalWeight,
        maxDrawdownPct: Math.max(prev.metrics.maxDrawdownPct, curr.metrics.maxDrawdownPct),
        avgVolume: (prev.metrics.avgVolume * prevWeight + curr.metrics.avgVolume * currWeight) / totalWeight,
      };
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

/**
 * Get a distribution summary of market conditions in a dataset.
 */
export function getConditionDistribution(
  periods: MarketPeriod[]
): Record<MarketCondition, { count: number; totalCandles: number; pct: number }> {
  const dist: Record<MarketCondition, { count: number; totalCandles: number; pct: number }> = {
    BULL: { count: 0, totalCandles: 0, pct: 0 },
    BEAR: { count: 0, totalCandles: 0, pct: 0 },
    RANGING: { count: 0, totalCandles: 0, pct: 0 },
    VOLATILE: { count: 0, totalCandles: 0, pct: 0 },
  };

  let totalCandles = 0;
  for (const p of periods) {
    const candleCount = p.endIndex - p.startIndex + 1;
    dist[p.condition].count++;
    dist[p.condition].totalCandles += candleCount;
    totalCandles += candleCount;
  }

  if (totalCandles > 0) {
    for (const key of Object.keys(dist) as MarketCondition[]) {
      dist[key].pct = (dist[key].totalCandles / totalCandles) * 100;
    }
  }

  return dist;
}
