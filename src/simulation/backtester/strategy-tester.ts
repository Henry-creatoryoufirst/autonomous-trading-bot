/**
 * NVR Capital — Strategy Tester
 *
 * Run multiple algorithm variants against the same historical data simultaneously.
 * Compare returns, drawdowns, win rates, Sharpe ratios side by side.
 */

import { runReplay } from '../engine/replay-engine.js';
import type {
  HistoricalDataset,
  StrategyVariant,
  ComparisonResult,
  ReplayConfig,
  StrategyParams,
  DEFAULT_STRATEGY_PARAMS,
} from '../types.js';

// ============================================================================
// MULTI-STRATEGY COMPARISON
// ============================================================================

/**
 * Run multiple strategy variants against the same historical data.
 * Returns ranked results for easy comparison.
 *
 * @param datasets - Historical data to test against
 * @param variants - Strategy variants to compare
 * @param baseConfig - Base replay config (time range, warmup, etc.)
 * @returns Comparison results with ranking
 */
export function compareStrategies(
  datasets: HistoricalDataset[],
  variants: StrategyVariant[],
  baseConfig?: Partial<Omit<ReplayConfig, 'strategy'>>
): ComparisonResult {
  const results = variants.map(variant => {
    const config: ReplayConfig = {
      strategy: variant.params,
      startTime: baseConfig?.startTime,
      endTime: baseConfig?.endTime,
      stepSize: baseConfig?.stepSize,
      warmupCandles: baseConfig?.warmupCandles,
    };

    const result = runReplay(datasets, config);

    return {
      name: variant.name,
      params: variant.params,
      result,
    };
  });

  // Sort by total return descending for ranking
  const sorted = [...results].sort(
    (a, b) => b.result.metrics.totalReturnPct - a.result.metrics.totalReturnPct
  );

  const ranking = sorted.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    totalReturnPct: r.result.metrics.totalReturnPct,
    sharpeRatio: r.result.metrics.sharpeRatio,
    maxDrawdownPct: r.result.metrics.maxDrawdownPct,
    winRate: r.result.metrics.winRate,
  }));

  // Dataset info
  const allCandles = datasets.reduce((sum, ds) => sum + ds.candles.length, 0);
  const datasetInfo = {
    symbols: datasets.map(ds => ds.symbol),
    startTime: Math.min(...datasets.map(ds => ds.startTime)),
    endTime: Math.max(...datasets.map(ds => ds.endTime)),
    totalCandles: allCandles,
  };

  return { variants: results, ranking, datasetInfo };
}

// ============================================================================
// PRESET STRATEGY VARIANTS
// ============================================================================

/**
 * Generate common strategy variants for quick comparison.
 * These represent different trading styles:
 * - Conservative: wider stops, higher buy threshold
 * - Aggressive: tighter stops, lower buy threshold
 * - Trend Following: high confluence thresholds, ride trends
 * - Mean Reversion: trade against extremes
 */
export function getPresetVariants(baseParams: StrategyParams): StrategyVariant[] {
  return [
    {
      name: 'Baseline',
      params: { ...baseParams },
    },
    {
      name: 'Conservative',
      params: {
        ...baseParams,
        confluenceBuyThreshold: 25,
        confluenceSellThreshold: -20,
        stopLossPercent: 20,
        profitTakePercent: 15,
        maxPositionPercent: 12,
        kellyFraction: 0.3,
      },
    },
    {
      name: 'Aggressive',
      params: {
        ...baseParams,
        confluenceBuyThreshold: 10,
        confluenceSellThreshold: -40,
        stopLossPercent: 10,
        profitTakePercent: 25,
        maxPositionPercent: 25,
        kellyFraction: 0.7,
      },
    },
    {
      name: 'Trend Following',
      params: {
        ...baseParams,
        confluenceBuyThreshold: 30,
        confluenceSellThreshold: -15,
        stopLossPercent: 12,
        profitTakePercent: 30,
        trailingStopPercent: 15,
        kellyFraction: 0.5,
      },
    },
    {
      name: 'Mean Reversion',
      params: {
        ...baseParams,
        confluenceBuyThreshold: 5,
        confluenceSellThreshold: -45,
        stopLossPercent: 18,
        profitTakePercent: 12,
        maxPositionPercent: 15,
        kellyFraction: 0.4,
      },
    },
  ];
}
