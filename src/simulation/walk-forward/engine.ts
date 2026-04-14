/**
 * NVR Capital — Walk-Forward Validation Engine
 *
 * Implements anchored walk-forward validation per Pardo (2008) and
 * the methodology outlined in arXiv 2602.10785.
 *
 * Core idea:
 *   1. Divide historical data into overlapping IS/OOS windows.
 *   2. For each window: run replay on IS, then test IS-optimal (or fixed) params on OOS.
 *   3. Aggregate OOS-only metrics — these represent realistic out-of-sample performance.
 *   4. Compute Walk-Forward Efficiency (WFE) = mean(OOS return / IS return).
 *      WFE > 0.5 = generalizes well. WFE < 0.2 = overfit to historical data.
 *
 * This guards against curve-fitting by ensuring the strategy works on data
 * it has never "seen" during parameter selection.
 */

import { runReplay } from '../engine/replay-engine.js';
import { runParameterSweep } from '../backtester/parameter-sweep.js';
import {
  DEFAULT_STRATEGY_PARAMS,
} from '../types.js';
import type {
  HistoricalDataset,
  StrategyParams,
  PerformanceMetrics,
  WalkForwardConfig,
  WalkForwardWindow,
  WalkForwardResult,
  SweepRange,
} from '../types.js';

// ============================================================================
// HELPERS
// ============================================================================

/** Slice a dataset to a specific candle range [startIdx, endIdx) */
function sliceDataset(ds: HistoricalDataset, startIdx: number, endIdx: number): HistoricalDataset {
  const candles = ds.candles.slice(startIdx, endIdx);
  return {
    ...ds,
    candles,
    startTime: candles[0]?.timestamp ?? ds.startTime,
    endTime: candles[candles.length - 1]?.timestamp ?? ds.endTime,
  };
}

/** Empty/zero metrics for windows with insufficient data */
function zeroMetrics(): PerformanceMetrics {
  return {
    totalReturn: 0, totalReturnPct: 0,
    maxDrawdown: 0, maxDrawdownPct: 0,
    winRate: 0, totalTrades: 0, winningTrades: 0, losingTrades: 0,
    profitFactor: 0, avgWin: 0, avgLoss: 0,
    sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0,
    holdBaseline: 0, holdBaselinePct: 0, avgTradesPerMonth: 0,
    yieldEarned: 0, bearCandles: 0,
  };
}

/**
 * Quick IS optimization: sweep a narrow grid of confluence thresholds and
 * stop/profit levels. Returns the params with highest Sharpe on the IS window.
 */
function optimizeOnIS(
  isDataset: HistoricalDataset,
  baseParams: StrategyParams,
): StrategyParams {
  const sweepRanges: SweepRange[] = [
    { param: 'confluenceBuyThreshold', min: 12, max: 28, step: 4 },
    { param: 'stopLossPercent',        min: 5,  max: 12, step: 3 },
    { param: 'profitTakePercent',      min: 4,  max: 10, step: 3 },
  ];

  try {
    const sweep = runParameterSweep([isDataset], baseParams, sweepRanges);
    // Pick best by Sharpe (most robust metric) — not raw return (avoids overfitting)
    return { ...baseParams, ...sweep.bestBySharpe.params };
  } catch {
    // Sweep failed (e.g. too few candles) — use base params
    return baseParams;
  }
}

// ============================================================================
// CORE WALK-FORWARD ENGINE
// ============================================================================

/**
 * Run walk-forward validation on one or more historical datasets.
 *
 * @param datasets - Historical OHLCV data (BTC, ETH, etc.)
 * @param config   - Window sizing and strategy configuration
 */
export function runWalkForward(
  datasets: HistoricalDataset[],
  config: WalkForwardConfig,
): WalkForwardResult {
  const startMs = Date.now();
  const {
    trainPeriodCandles,
    testPeriodCandles,
    stepCandles,
    strategy = DEFAULT_STRATEGY_PARAMS,
    optimizeOnIS: doISOptimization = false,
  } = config;

  if (datasets.length === 0) {
    throw new Error('[WalkForward] No datasets provided');
  }

  // Use the primary dataset (first symbol) to define window boundaries
  // Multi-asset: all datasets are sliced to the same index range
  const primary = datasets[0];
  const totalCandles = primary.candles.length;
  const minRequired = trainPeriodCandles + testPeriodCandles;

  if (totalCandles < minRequired) {
    throw new Error(
      `[WalkForward] Insufficient data: need ${minRequired} candles, got ${totalCandles}`
    );
  }

  const windows: WalkForwardWindow[] = [];
  let windowIndex = 0;

  // Slide the window
  for (let isStart = 0; isStart + minRequired <= totalCandles; isStart += stepCandles) {
    const isEnd = isStart + trainPeriodCandles;
    const oosEnd = Math.min(isEnd + testPeriodCandles, totalCandles);

    if (oosEnd - isEnd < testPeriodCandles * 0.5) {
      // OOS window too small — stop
      break;
    }

    // Slice IS dataset
    const isDatasets = datasets.map(ds => sliceDataset(ds, isStart, isEnd));

    // OOS dataset: prepend trailing IS candles as indicator warmup so MACD/SMA50
    // buffers are filled before the first OOS trade decision fires.
    const INDICATOR_WARMUP = 50;
    const oosPadStart = Math.max(isStart, isEnd - INDICATOR_WARMUP);
    const oosDatasets  = datasets.map(ds => sliceDataset(ds, oosPadStart, oosEnd));
    const oosWarmup    = isEnd - oosPadStart; // candles to skip before trading

    // Determine params: fixed or IS-optimized
    const params: StrategyParams = doISOptimization
      ? optimizeOnIS(isDatasets[0], strategy)
      : strategy;

    // Run IS replay
    let isMetrics: PerformanceMetrics;
    try {
      const isResult = runReplay(isDatasets, { strategy: params });
      isMetrics = isResult.metrics;
    } catch {
      isMetrics = zeroMetrics();
    }

    // Run OOS replay with the same params (this is the real test).
    // warmupCandles tells the replay engine to ignore the prepended IS candles
    // for trade decisions — they are only used to warm up indicators.
    let oosMetrics: PerformanceMetrics;
    try {
      const oosResult = runReplay(oosDatasets, { strategy: params, warmupCandles: oosWarmup });
      oosMetrics = oosResult.metrics;
    } catch {
      oosMetrics = zeroMetrics();
    }

    // Walk-Forward Efficiency for this window
    // Avoid division by zero — if IS return = 0, treat efficiency as OOS profit/loss indicator
    let efficiency: number;
    if (Math.abs(isMetrics.totalReturnPct) < 0.01) {
      efficiency = oosMetrics.totalReturnPct >= 0 ? 0.5 : 0;
    } else {
      efficiency = oosMetrics.totalReturnPct / isMetrics.totalReturnPct;
    }

    windows.push({
      windowIndex,
      isStartTime: isDatasets[0].startTime,
      isEndTime: isDatasets[0].endTime,
      oosStartTime: oosDatasets[0].startTime,
      oosEndTime: oosDatasets[0].endTime,
      isCandles: isEnd - isStart,
      oosCandles: oosEnd - isEnd,
      isMetrics,
      oosMetrics,
      params,
      efficiency,
    });

    windowIndex++;
  }

  if (windows.length === 0) {
    throw new Error('[WalkForward] No valid windows could be computed');
  }

  // ── Aggregate OOS metrics ──
  const oosReturns = windows.map(w => w.oosMetrics.totalReturnPct);
  const oosSharpes = windows.map(w => w.oosMetrics.sharpeRatio);
  const oosWinRates = windows.map(w => w.oosMetrics.winRate);
  const oosDrawdowns = windows.map(w => w.oosMetrics.maxDrawdownPct);
  const efficiencies = windows.map(w => w.efficiency);
  const isProfitable = windows.filter(w => w.oosMetrics.totalReturnPct > 0).length;

  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const max = (arr: number[]) => Math.max(...arr);

  const avgOOSReturn = mean(oosReturns);
  const avgOOSSharpe = mean(oosSharpes);
  const avgOOSWinRate = mean(oosWinRates);
  const maxOOSDrawdown = max(oosDrawdowns);
  const consistencyScore = (isProfitable / windows.length) * 100;
  const wfe = mean(efficiencies);

  // Overfitting penalty: average IS Sharpe minus average OOS Sharpe
  const isSharp = mean(windows.map(w => w.isMetrics.sharpeRatio));
  const overfittingPenalty = Math.max(0, isSharp - avgOOSSharpe);

  // Aggregate profit factor across all OOS trades
  const totalOOSWins = windows.reduce((s, w) => s + w.oosMetrics.winningTrades * w.oosMetrics.avgWin, 0);
  const totalOOSLoss = windows.reduce((s, w) => s + w.oosMetrics.losingTrades * Math.abs(w.oosMetrics.avgLoss), 0);
  const aggProfitFactor = totalOOSLoss > 0 ? totalOOSWins / totalOOSLoss : totalOOSWins > 0 ? 999 : 0;

  // Validation criteria
  const passesValidation =
    avgOOSSharpe >= 0.3 &&        // Acceptable risk-adjusted return
    consistencyScore >= 55 &&      // >55% of windows profitable OOS
    maxOOSDrawdown <= 30 &&        // Max drawdown under 30%
    wfe >= 0.3 &&                  // Efficiency above 30%
    overfittingPenalty <= 1.0;     // Not severely overfit

  // Summary
  const summary: string[] = [
    `Walk-Forward Validation — ${windows.length} windows (IS: ${trainPeriodCandles}c / OOS: ${testPeriodCandles}c)`,
    `OOS Return: ${avgOOSReturn.toFixed(1)}% avg | Sharpe: ${avgOOSSharpe.toFixed(2)} avg | WinRate: ${(avgOOSWinRate * 100).toFixed(0)}%`,
    `Max OOS Drawdown: ${maxOOSDrawdown.toFixed(1)}% | Consistency: ${consistencyScore.toFixed(0)}% windows profitable`,
    `Walk-Forward Efficiency: ${(wfe * 100).toFixed(0)}% | Overfitting Penalty: ${overfittingPenalty.toFixed(2)}`,
    passesValidation
      ? '✅ PASSES validation — strategy generalizes well to out-of-sample data'
      : `❌ FAILS validation — ${[
          avgOOSSharpe < 0.3 && `Sharpe ${avgOOSSharpe.toFixed(2)} < 0.3`,
          consistencyScore < 55 && `Consistency ${consistencyScore.toFixed(0)}% < 55%`,
          maxOOSDrawdown > 30 && `Drawdown ${maxOOSDrawdown.toFixed(1)}% > 30%`,
          wfe < 0.3 && `WFE ${(wfe * 100).toFixed(0)}% < 30%`,
          overfittingPenalty > 1.0 && `Overfit penalty ${overfittingPenalty.toFixed(2)} > 1.0`,
        ].filter(Boolean).join(', ')}`,
  ];

  return {
    windows,
    aggregateOOS: {
      totalReturnPct: avgOOSReturn,
      avgSharpe: avgOOSSharpe,
      avgWinRate: avgOOSWinRate,
      maxDrawdownPct: maxOOSDrawdown,
      consistencyScore,
      profitFactor: aggProfitFactor,
    },
    walkForwardEfficiency: wfe,
    overfittingPenalty,
    passesValidation,
    summary,
    meta: {
      symbol: datasets.map(d => d.symbol).join('+'),
      totalCandles,
      windowCount: windows.length,
      trainPeriodCandles,
      testPeriodCandles,
      durationMs: Date.now() - startMs,
    },
  };
}
