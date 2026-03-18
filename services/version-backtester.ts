/**
 * Multi-Version Backtester
 *
 * Runs ALL strategy versions from the registry against the same price history.
 * Returns a ranked comparison so we can see which version performed best.
 */

import { STRATEGY_VERSIONS, toSimConfig, type StrategyVersion } from "./strategy-versions.js";
import { runSimulation, loadPriceHistory, type SimResult } from "./simulator.js";

// ============================================================================
// TYPES
// ============================================================================

export interface VersionBacktestResult {
  version: string;
  name: string;
  description: string;
  result: SimResult;
}

// ============================================================================
// CORE: Run all versions against the same history
// ============================================================================

export function runAllVersionBacktests(
  priceHistory: Map<string, { timestamps: number[]; prices: number[] }>,
  startingCapital: number = 500
): VersionBacktestResult[] {
  const results: VersionBacktestResult[] = [];

  for (const sv of STRATEGY_VERSIONS) {
    try {
      const simConfig = toSimConfig(sv.config, startingCapital);
      const result = runSimulation(simConfig, priceHistory);

      results.push({
        version: sv.version,
        name: sv.name,
        description: sv.description,
        result,
      });
    } catch (err: any) {
      console.error(`[VersionBacktest] ${sv.version} failed: ${err.message?.substring(0, 200)}`);
    }
  }

  // Sort by total return descending
  results.sort((a, b) => b.result.totalReturnPct - a.result.totalReturnPct);

  return results;
}

// ============================================================================
// CONVENIENCE: Load history from disk and run all versions
// ============================================================================

export function runAllVersionBacktestsFromDisk(
  startingCapital: number = 500,
  persistDir?: string
): VersionBacktestResult[] {
  const history = loadPriceHistory(persistDir);
  return runAllVersionBacktests(history, startingCapital);
}

// ============================================================================
// SUMMARY: Condensed comparison table for API responses
// ============================================================================

export function summarizeBacktestResults(results: VersionBacktestResult[]) {
  return results.map((r) => ({
    version: r.version,
    name: r.name,
    description: r.description,
    returnPct: r.result.totalReturnPct,
    returnUSD: r.result.totalReturn,
    maxDrawdownPct: r.result.maxDrawdownPct,
    winRate: r.result.winRate,
    profitFactor: r.result.profitFactor,
    sharpeRatio: r.result.sharpeRatio,
    totalTrades: r.result.totalTrades,
    holdBaseline: r.result.holdBaseline,
    vsHold: r.result.totalReturnPct - (r.result.holdBaseline || 0),
    equityCurve: r.result.equityCurve.length > 300
      ? downsampleArray(r.result.equityCurve, 300)
      : r.result.equityCurve,
  }));
}

// ============================================================================
// HELPERS
// ============================================================================

function downsampleArray(arr: number[], n: number): number[] {
  if (arr.length <= n) return arr;
  const result: number[] = [];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) result.push(arr[Math.round(i * step)]);
  return result;
}
