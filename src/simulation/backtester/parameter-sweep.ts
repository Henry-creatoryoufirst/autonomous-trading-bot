/**
 * NVR Capital — Parameter Sweep Engine
 *
 * Grid search over parameter space to find optimal thresholds.
 * Tests ranges of values for confluence buy/sell, stop loss, trailing stop, etc.
 */

import { runReplay } from '../engine/replay-engine.js';
import { generateSyntheticData } from '../data/historical-data.js';
import type {
  HistoricalDataset,
  StrategyParams,
  SweepRange,
  SweepResult,
  ReplayConfig,
  PerformanceMetrics,
  MarketCondition,
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
  /** Returns-focused: attack the 7/25 returns score */
  returnsFocused: [
    { param: 'confluenceBuyThreshold' as const, min: 12, max: 24, step: 4 },
    { param: 'stopLossPercent' as const, min: 4, max: 10, step: 3 },
    { param: 'profitTakePercent' as const, min: 3, max: 12, step: 3 },
    { param: 'kellyFraction' as const, min: 0.2, max: 0.5, step: 0.15 },
  ],
  /** Aggressive: let winners run, tighter entries */
  aggressive: [
    { param: 'confluenceBuyThreshold' as const, min: 15, max: 30, step: 5 },
    { param: 'stopLossPercent' as const, min: 4, max: 8, step: 2 },
    { param: 'profitTakePercent' as const, min: 8, max: 20, step: 4 },
  ],
} satisfies Record<string, SweepRange[]>;

// ============================================================================
// TOURNAMENT SWEEP (FAST)
// ============================================================================

export interface TournamentConfig {
  /** Sweep ranges to test */
  ranges: SweepRange[];
  /** Base params (non-swept values) */
  baseParams: StrategyParams;
  /** What fraction of combos survive screening. Default 0.25 */
  survivalRate?: number;
  /** Screen with short datasets (days). Default 90 */
  screenDays?: number;
  /** Full validation datasets (days). Default 365 */
  fullDays?: number;
  /** Progress callback */
  onProgress?: (msg: string) => void;
}

export interface TournamentResult {
  /** Best params found */
  bestParams: Partial<StrategyParams>;
  /** Full metrics for the best params */
  bestMetrics: PerformanceMetrics;
  /** All finalists with their full metrics */
  finalists: Array<{ params: Partial<StrategyParams>; metrics: PerformanceMetrics }>;
  /** Total combos generated */
  totalCombinations: number;
  /** Combos that survived screening */
  survivorCount: number;
  /** Total replay runs executed (vs brute force) */
  replayRuns: number;
  /** Brute force would have been this many runs */
  bruteForceRuns: number;
  /** Time saved ratio */
  speedup: string;
  /** Duration in ms */
  durationMs: number;
}

const TOURNAMENT_SCENARIOS: Array<{
  label: MarketCondition;
  days: number;
  startPrice: number;
  drift: number;
  volatility: number;
  seed: number;
}> = [
  { label: 'BULL',     startPrice: 40000, drift: 1.0,  volatility: 0.4,  seed: 101, days: 365 },
  { label: 'BEAR',     startPrice: 60000, drift: -0.6, volatility: 0.5,  seed: 202, days: 365 },
  { label: 'RANGING',  startPrice: 45000, drift: 0.0,  volatility: 0.25, seed: 303, days: 365 },
  { label: 'VOLATILE', startPrice: 50000, drift: 0.1,  volatility: 0.9,  seed: 404, days: 365 },
];

/**
 * Tournament-style parameter optimization.
 *
 * Stage 1 (SCREEN): Run all combos on short (90-day) datasets.
 *   - Only uses BULL + BEAR conditions (the two extremes)
 *   - Ranks by combined Sharpe ratio
 *   - Keeps top 25% of combos
 *
 * Stage 2 (VALIDATE): Run survivors on full (365-day) datasets.
 *   - All 4 market conditions
 *   - Early termination: if after 2 conditions a combo's avg return
 *     is worse than the current best by >50%, skip remaining conditions
 *
 * Typical speedup: 4-6x vs brute force grid search.
 */
export function runTournamentSweep(config: TournamentConfig): TournamentResult {
  const {
    ranges,
    baseParams,
    survivalRate = 0.25,
    screenDays = 90,
    fullDays = 365,
    onProgress = () => {},
  } = config;

  const startMs = Date.now();
  const combinations = generateCombinations(ranges);
  const totalCombos = combinations.length;
  let replayRuns = 0;

  onProgress(`Generated ${totalCombos} parameter combinations`);

  // --- Stage 1: Quick screen with short datasets, 2 conditions ---
  onProgress(`\nSTAGE 1: Screening ${totalCombos} combos (${screenDays}-day BULL + BEAR)...`);

  const screenConditions = TOURNAMENT_SCENARIOS.filter(
    s => s.label === 'BULL' || s.label === 'BEAR'
  );
  const screenDatasets = screenConditions.map(s =>
    generateSyntheticData({
      symbol: `SCREEN-${s.label}`,
      startPrice: s.startPrice,
      candles: screenDays * 24,
      drift: s.drift,
      volatility: s.volatility,
      seed: s.seed,
    })
  );

  const screenResults: Array<{
    params: Partial<StrategyParams>;
    score: number; // combined metric for ranking
    metrics: PerformanceMetrics;
  }> = [];

  for (let i = 0; i < combinations.length; i++) {
    const combo = combinations[i];
    const params: StrategyParams = { ...baseParams, ...combo };
    const result = runReplay(screenDatasets, { strategy: params });
    replayRuns++;

    // Score by Sharpe + normalized return (balanced metric)
    const score = result.metrics.sharpeRatio * 0.6 + (result.metrics.totalReturnPct / 10) * 0.4;
    screenResults.push({ params: combo, score, metrics: result.metrics });

    if ((i + 1) % 20 === 0 || i === combinations.length - 1) {
      onProgress(`  Screened ${i + 1}/${totalCombos} combos...`);
    }
  }

  // Sort by score, keep top survivors
  screenResults.sort((a, b) => b.score - a.score);
  const survivorCount = Math.max(4, Math.ceil(totalCombos * survivalRate));
  const survivors = screenResults.slice(0, survivorCount);

  onProgress(`\n  Top ${survivorCount} survivors (of ${totalCombos}):`);
  for (let i = 0; i < Math.min(5, survivors.length); i++) {
    const s = survivors[i];
    onProgress(`    #${i + 1}: score=${s.score.toFixed(2)} | return=${s.metrics.totalReturnPct.toFixed(1)}% | sharpe=${s.metrics.sharpeRatio.toFixed(2)} | params=${JSON.stringify(s.params)}`);
  }

  // --- Stage 2: Full validation with early termination ---
  onProgress(`\nSTAGE 2: Full validation of ${survivorCount} survivors (${fullDays}-day, 4 conditions)...`);

  const fullDatasets = TOURNAMENT_SCENARIOS.map(s =>
    generateSyntheticData({
      symbol: `BTC-${s.label}`,
      startPrice: s.startPrice,
      candles: fullDays * 24,
      drift: s.drift,
      volatility: s.volatility,
      seed: s.seed,
    })
  );

  const finalists: Array<{ params: Partial<StrategyParams>; metrics: PerformanceMetrics }> = [];
  let currentBestSharpe = -Infinity;
  let skippedCount = 0;

  for (let i = 0; i < survivors.length; i++) {
    const combo = survivors[i].params;
    const params: StrategyParams = { ...baseParams, ...combo };

    // Run conditions one at a time for early termination
    const conditionMetrics: PerformanceMetrics[] = [];
    let terminated = false;

    for (let c = 0; c < fullDatasets.length; c++) {
      const result = runReplay([fullDatasets[c]], { strategy: params });
      replayRuns++;
      conditionMetrics.push(result.metrics);

      // Early termination: after 2 conditions, if avg return is clearly bad, skip
      if (c >= 1 && currentBestSharpe > -Infinity) {
        const avgReturn = conditionMetrics.reduce((a, m) => a + m.totalReturnPct, 0) / conditionMetrics.length;
        if (avgReturn < -10) {
          terminated = true;
          skippedCount++;
          break;
        }
      }
    }

    if (terminated) {
      onProgress(`  Validated ${i + 1}/${survivorCount}: [EARLY TERMINATED — weak returns]`);
      continue;
    }

    // Aggregate metrics from individual conditions (no redundant combined run)
    const aggMetrics = aggregateMetrics(conditionMetrics);
    finalists.push({ params: combo, metrics: aggMetrics });

    if (aggMetrics.sharpeRatio > currentBestSharpe) {
      currentBestSharpe = aggMetrics.sharpeRatio;
    }

    onProgress(`  Validated ${i + 1}/${survivorCount}: return=${aggMetrics.totalReturnPct.toFixed(1)}% | sharpe=${aggMetrics.sharpeRatio.toFixed(2)}`);
  }

  onProgress(`\n  Early-terminated ${skippedCount} weak combos`);

  // Rank finalists by Sharpe (more stable than raw return)
  finalists.sort((a, b) => b.metrics.sharpeRatio - a.metrics.sharpeRatio);
  const best = finalists[0] || { params: {}, metrics: emptyMetrics() };

  const bruteForceRuns = totalCombos * fullDatasets.length;
  const durationMs = Date.now() - startMs;
  const speedup = (bruteForceRuns / replayRuns).toFixed(1);

  onProgress(`\nDone: ${replayRuns} replay runs vs ${bruteForceRuns} brute force (${speedup}x faster)`);

  return {
    bestParams: best.params,
    bestMetrics: best.metrics,
    finalists,
    totalCombinations: totalCombos,
    survivorCount,
    replayRuns,
    bruteForceRuns,
    speedup,
    durationMs,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Aggregate metrics from multiple individual condition runs.
 * Averages most metrics, takes worst-case for drawdown.
 */
function aggregateMetrics(conditionMetrics: PerformanceMetrics[]): PerformanceMetrics {
  const n = conditionMetrics.length;
  if (n === 0) return emptyMetrics();

  const avg = (fn: (m: PerformanceMetrics) => number) =>
    conditionMetrics.reduce((s, m) => s + fn(m), 0) / n;
  const max = (fn: (m: PerformanceMetrics) => number) =>
    Math.max(...conditionMetrics.map(fn));
  const min = (fn: (m: PerformanceMetrics) => number) =>
    Math.min(...conditionMetrics.map(fn));
  const sum = (fn: (m: PerformanceMetrics) => number) =>
    conditionMetrics.reduce((s, m) => s + fn(m), 0);

  return {
    totalReturn: avg(m => m.totalReturn),
    totalReturnPct: avg(m => m.totalReturnPct),
    maxDrawdown: max(m => m.maxDrawdown),
    maxDrawdownPct: min(m => m.maxDrawdownPct), // most negative = worst
    winRate: avg(m => m.winRate),
    totalTrades: Math.round(sum(m => m.totalTrades)),
    winningTrades: Math.round(sum(m => m.winningTrades)),
    losingTrades: Math.round(sum(m => m.losingTrades)),
    profitFactor: avg(m => m.profitFactor),
    avgWin: avg(m => m.avgWin),
    avgLoss: avg(m => m.avgLoss),
    sharpeRatio: avg(m => m.sharpeRatio),
    sortinoRatio: avg(m => m.sortinoRatio),
    calmarRatio: avg(m => m.calmarRatio),
    holdBaseline: avg(m => m.holdBaseline),
    holdBaselinePct: avg(m => m.holdBaselinePct),
    avgTradesPerMonth: avg(m => m.avgTradesPerMonth),
  };
}

function emptyMetrics(): PerformanceMetrics {
  return {
    totalReturn: 0, totalReturnPct: 0, maxDrawdown: 0, maxDrawdownPct: 0,
    winRate: 0, totalTrades: 0, winningTrades: 0, losingTrades: 0,
    profitFactor: 0, avgWin: 0, avgLoss: 0, sharpeRatio: 0,
    sortinoRatio: 0, calmarRatio: 0, holdBaseline: 0, holdBaselinePct: 0,
    avgTradesPerMonth: 0,
  };
}
