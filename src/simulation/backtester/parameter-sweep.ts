/**
 * NVR Capital — Parameter Sweep Engine
 *
 * Grid search over parameter space to find optimal thresholds.
 * Tests ranges of values for confluence buy/sell, stop loss, trailing stop, etc.
 */

import { runReplay } from '../engine/replay-engine.js';
import type {
  HistoricalDataset,
  StrategyParams,
  SweepRange,
  SweepResult,
  ReplayConfig,
  PerformanceMetrics,
} from '../types.js';

// ============================================================================
// PARAMETER SWEEP
// ============================================================================

/**
 * Run a grid search over parameter ranges.
 * Tests all combinations and returns ranked results.
 *
 * @param datasets - Historical data to test against
 * @param baseParams - Base strategy parameters (non-swept params)
 * @param ranges - Parameter ranges to sweep
 * @param replayConfig - Optional replay config overrides
 * @returns Sweep results with best combinations
 */
export function runParameterSweep(
  datasets: HistoricalDataset[],
  baseParams: StrategyParams,
  ranges: SweepRange[],
  replayConfig?: Partial<Omit<ReplayConfig, 'strategy'>>
): SweepResult {
  const startMs = Date.now();

  // Generate all combinations
  const combinations = generateCombinations(ranges);
  const results: Array<{
    params: Partial<StrategyParams>;
    metrics: PerformanceMetrics;
  }> = [];

  for (const combo of combinations) {
    const params: StrategyParams = { ...baseParams, ...combo };

    const config: ReplayConfig = {
      strategy: params,
      startTime: replayConfig?.startTime,
      endTime: replayConfig?.endTime,
      stepSize: replayConfig?.stepSize,
      warmupCandles: replayConfig?.warmupCandles,
    };

    const result = runReplay(datasets, config);
    results.push({ params: combo, metrics: result.metrics });
  }

  // Find best by different criteria
  const bestByReturn = [...results].sort(
    (a, b) => b.metrics.totalReturnPct - a.metrics.totalReturnPct
  )[0];

  const bestBySharpe = [...results].sort(
    (a, b) => b.metrics.sharpeRatio - a.metrics.sharpeRatio
  )[0];

  const bestByWinRate = [...results].sort(
    (a, b) => b.metrics.winRate - a.metrics.winRate
  )[0];

  return {
    results,
    bestByReturn: bestByReturn || { params: {}, metrics: emptyMetrics() },
    bestBySharpe: bestBySharpe || { params: {}, metrics: emptyMetrics() },
    bestByWinRate: bestByWinRate || { params: {}, metrics: emptyMetrics() },
    totalCombinations: combinations.length,
    durationMs: Date.now() - startMs,
  };
}

// ============================================================================
// COMBINATION GENERATOR
// ============================================================================

/**
 * Generate all parameter combinations from sweep ranges.
 * Uses cartesian product of all ranges.
 */
function generateCombinations(ranges: SweepRange[]): Array<Partial<StrategyParams>> {
  if (ranges.length === 0) return [{}];

  // Generate values for each range
  const rangeValues: Array<{ param: keyof StrategyParams; values: number[] }> = ranges.map(r => {
    const values: number[] = [];
    for (let v = r.min; v <= r.max + r.step * 0.001; v += r.step) {
      values.push(Math.round(v * 1000) / 1000); // avoid floating point issues
    }
    return { param: r.param, values };
  });

  // Cartesian product
  function cartesian(
    rangeIdx: number,
    current: Partial<StrategyParams>
  ): Array<Partial<StrategyParams>> {
    if (rangeIdx >= rangeValues.length) return [{ ...current }];

    const { param, values } = rangeValues[rangeIdx];
    const results: Array<Partial<StrategyParams>> = [];

    for (const val of values) {
      const next = { ...current, [param]: val };
      results.push(...cartesian(rangeIdx + 1, next));
    }

    return results;
  }

  return cartesian(0, {});
}

// ============================================================================
// PRESET SWEEP CONFIGS
// ============================================================================

/**
 * Common parameter sweep ranges for quick optimization.
 */
export const PRESET_SWEEPS = {
  /** Sweep confluence thresholds */
  confluence: [
    { param: 'confluenceBuyThreshold' as const, min: 5, max: 35, step: 5 },
    { param: 'confluenceSellThreshold' as const, min: -50, max: -15, step: 5 },
  ],
  /** Sweep risk management */
  riskManagement: [
    { param: 'stopLossPercent' as const, min: 8, max: 25, step: 3 },
    { param: 'profitTakePercent' as const, min: 10, max: 30, step: 5 },
  ],
  /** Sweep position sizing */
  positionSizing: [
    { param: 'kellyFraction' as const, min: 0.2, max: 0.8, step: 0.1 },
    { param: 'maxPositionPercent' as const, min: 10, max: 30, step: 5 },
  ],
  /** Full sweep (warning: many combinations) */
  full: [
    { param: 'confluenceBuyThreshold' as const, min: 10, max: 30, step: 10 },
    { param: 'confluenceSellThreshold' as const, min: -40, max: -20, step: 10 },
    { param: 'stopLossPercent' as const, min: 10, max: 20, step: 5 },
    { param: 'profitTakePercent' as const, min: 15, max: 25, step: 5 },
  ],
  /** Confidence-optimized sweep for gate scoring */
  confidenceOptimized: [
    { param: 'confluenceBuyThreshold' as const, min: 8, max: 15, step: 3 },
    { param: 'stopLossPercent' as const, min: 8, max: 12, step: 2 },
    { param: 'profitTakePercent' as const, min: 6, max: 10, step: 2 },
    { param: 'cashDeployThreshold' as const, min: 10, max: 20, step: 5 },
  ],
} satisfies Record<string, SweepRange[]>;

// ============================================================================
// HELPERS
// ============================================================================

function emptyMetrics(): PerformanceMetrics {
  return {
    totalReturn: 0, totalReturnPct: 0, maxDrawdown: 0, maxDrawdownPct: 0,
    winRate: 0, totalTrades: 0, winningTrades: 0, losingTrades: 0,
    profitFactor: 0, avgWin: 0, avgLoss: 0, sharpeRatio: 0,
    sortinoRatio: 0, calmarRatio: 0, holdBaseline: 0, holdBaselinePct: 0,
    avgTradesPerMonth: 0,
  };
}
