/**
 * NVR Capital — Market Simulator
 *
 * Simulates market conditions from historical data for use in the replay engine.
 * Provides utilities for time-range selection, market regime filtering,
 * and data preparation.
 */

import type { HistoricalDataset, OHLCVCandle, MarketCondition, MarketPeriod } from '../types.js';
import { classifyMarketPeriods } from '../data/market-conditions.js';

// ============================================================================
// TIME RANGE SLICING
// ============================================================================

/**
 * Slice a dataset to a specific time range.
 */
export function sliceDataset(
  dataset: HistoricalDataset,
  startTime?: number,
  endTime?: number
): HistoricalDataset {
  let candles = dataset.candles;

  if (startTime) {
    candles = candles.filter(c => c.timestamp >= startTime);
  }
  if (endTime) {
    candles = candles.filter(c => c.timestamp <= endTime);
  }

  return {
    ...dataset,
    candles,
    startTime: candles.length > 0 ? candles[0].timestamp : 0,
    endTime: candles.length > 0 ? candles[candles.length - 1].timestamp : 0,
  };
}

// ============================================================================
// MARKET CONDITION FILTERING
// ============================================================================

/**
 * Extract candles from a dataset that fall within periods of a specific market condition.
 * Useful for testing strategy performance in specific regimes.
 */
export function filterByCondition(
  dataset: HistoricalDataset,
  condition: MarketCondition,
  windowSize = 168
): HistoricalDataset {
  const periods = classifyMarketPeriods(dataset.candles, windowSize);
  const matchingPeriods = periods.filter(p => p.condition === condition);

  const candles: OHLCVCandle[] = [];
  for (const period of matchingPeriods) {
    candles.push(...dataset.candles.slice(period.startIndex, period.endIndex + 1));
  }

  return {
    ...dataset,
    candles,
    startTime: candles.length > 0 ? candles[0].timestamp : 0,
    endTime: candles.length > 0 ? candles[candles.length - 1].timestamp : 0,
  };
}

// ============================================================================
// DATASET MERGING
// ============================================================================

/**
 * Merge multiple datasets into a time-aligned collection.
 * All datasets will be trimmed to the overlapping time range.
 */
export function alignDatasets(datasets: HistoricalDataset[]): HistoricalDataset[] {
  if (datasets.length <= 1) return datasets;

  // Find the overlapping time range
  const latestStart = Math.max(...datasets.map(d => d.startTime));
  const earliestEnd = Math.min(...datasets.map(d => d.endTime));

  if (latestStart >= earliestEnd) {
    // No overlap — return datasets as-is
    return datasets;
  }

  return datasets.map(ds => sliceDataset(ds, latestStart, earliestEnd));
}

// ============================================================================
// DATASET STATISTICS
// ============================================================================

/**
 * Get summary statistics for a dataset.
 */
export function getDatasetStats(dataset: HistoricalDataset): {
  symbol: string;
  totalCandles: number;
  startTime: number;
  endTime: number;
  durationDays: number;
  priceRange: { min: number; max: number; start: number; end: number };
  totalReturnPct: number;
  avgDailyVolume: number;
  periods: MarketPeriod[];
} {
  const candles = dataset.candles;
  if (candles.length === 0) {
    return {
      symbol: dataset.symbol,
      totalCandles: 0,
      startTime: 0,
      endTime: 0,
      durationDays: 0,
      priceRange: { min: 0, max: 0, start: 0, end: 0 },
      totalReturnPct: 0,
      avgDailyVolume: 0,
      periods: [],
    };
  }

  const prices = candles.map(c => c.close);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const startPrice = prices[0];
  const endPrice = prices[prices.length - 1];
  const totalReturnPct = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0;

  const durationMs = candles[candles.length - 1].timestamp - candles[0].timestamp;
  const durationDays = durationMs / (24 * 3600 * 1000);

  const totalVolume = candles.reduce((s, c) => s + c.volume, 0);
  const avgDailyVolume = durationDays > 0 ? totalVolume / durationDays : totalVolume;

  const periods = classifyMarketPeriods(candles);

  return {
    symbol: dataset.symbol,
    totalCandles: candles.length,
    startTime: dataset.startTime,
    endTime: dataset.endTime,
    durationDays,
    priceRange: { min: minPrice, max: maxPrice, start: startPrice, end: endPrice },
    totalReturnPct,
    avgDailyVolume,
    periods,
  };
}

// ============================================================================
// WALK-FORWARD SPLIT
// ============================================================================

/**
 * Split a dataset into train/test segments for walk-forward validation.
 *
 * @param dataset - The full dataset
 * @param trainPct - Percentage of data for training (0-1). Default 0.7
 * @returns { train, test } datasets
 */
export function walkForwardSplit(
  dataset: HistoricalDataset,
  trainPct = 0.7
): { train: HistoricalDataset; test: HistoricalDataset } {
  const splitIdx = Math.floor(dataset.candles.length * trainPct);
  const trainCandles = dataset.candles.slice(0, splitIdx);
  const testCandles = dataset.candles.slice(splitIdx);

  return {
    train: {
      ...dataset,
      candles: trainCandles,
      startTime: trainCandles.length > 0 ? trainCandles[0].timestamp : 0,
      endTime: trainCandles.length > 0 ? trainCandles[trainCandles.length - 1].timestamp : 0,
    },
    test: {
      ...dataset,
      candles: testCandles,
      startTime: testCandles.length > 0 ? testCandles[0].timestamp : 0,
      endTime: testCandles.length > 0 ? testCandles[testCandles.length - 1].timestamp : 0,
    },
  };
}
