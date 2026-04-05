/**
 * NVR Capital — Confidence Gate
 *
 * Automated safety layer that blocks algorithm changes from reaching production
 * unless they pass backtest confidence scoring across all market conditions.
 *
 * Usage:
 *   npx tsx scripts/confidence-gate.ts
 *   CONFIDENCE_MIN=70 npx tsx scripts/confidence-gate.ts
 *
 * Exit codes:
 *   0 = PASS (safe to deploy)
 *   1 = FAIL (algorithm change blocked)
 */

import { generateSyntheticData } from '../src/simulation/data/historical-data.js';
import { runReplay } from '../src/simulation/engine/replay-engine.js';
import { calculateAggregateConfidence } from '../src/simulation/scoring/confidence-scorer.js';
import { DEFAULT_STRATEGY_PARAMS, DEFAULT_CONFIDENCE_CONFIG } from '../src/simulation/types.js';
import type { HistoricalDataset, ReplayResult, ConfidenceScore, MarketCondition } from '../src/simulation/types.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIDENCE_MIN = parseInt(process.env.CONFIDENCE_MIN || '60', 10);

// Market condition presets for synthetic data generation
const MARKET_SCENARIOS: Array<{
  label: MarketCondition;
  days: number;
  startPrice: number;
  drift: number;
  volatility: number;
  seed: number;
}> = [
  { label: 'BULL',     days: 365, startPrice: 40000, drift: 1.0,  volatility: 0.4,  seed: 101 },
  { label: 'BEAR',     days: 365, startPrice: 60000, drift: -0.6, volatility: 0.5,  seed: 202 },
  { label: 'RANGING',  days: 365, startPrice: 45000, drift: 0.0,  volatility: 0.25, seed: 303 },
  { label: 'VOLATILE', days: 365, startPrice: 50000, drift: 0.1,  volatility: 0.9,  seed: 404 },
];

// ============================================================================
// CORE GATE LOGIC (exported for API + test reuse)
// ============================================================================

export interface GateResult {
  score: ConfidenceScore;
  results: ReplayResult[];
  threshold: number;
  passed: boolean;
}

export function runConfidenceGate(
  threshold: number = CONFIDENCE_MIN,
  strategyParams = DEFAULT_STRATEGY_PARAMS,
): GateResult {
  // 1. Generate synthetic datasets for each market condition
  const datasets: HistoricalDataset[] = MARKET_SCENARIOS.map(scenario =>
    generateSyntheticData({
      symbol: `BTC-${scenario.label}`,
      startPrice: scenario.startPrice,
      candles: scenario.days * 24, // hourly candles
      drift: scenario.drift,
      volatility: scenario.volatility,
      seed: scenario.seed,
    })
  );

  // 2. Run replay against each dataset independently
  const results: ReplayResult[] = datasets.map(ds =>
    runReplay([ds], { strategy: strategyParams })
  );

  // 3. Calculate aggregate confidence
  const config = {
    ...DEFAULT_CONFIDENCE_CONFIG,
    minimumConfidence: threshold,
  };
  const score = calculateAggregateConfidence(results, config);

  return {
    score,
    results,
    threshold,
    passed: score.passesThreshold,
  };
}

// ============================================================================
// REPORT FORMATTING
// ============================================================================

function pad(str: string, width: number): string {
  return str + ' '.repeat(Math.max(0, width - str.length));
}

function formatReport(gate: GateResult): string {
  const { score, threshold, passed } = gate;
  const status = passed ? '\x1b[32m\u2705 PASS\x1b[0m' : '\x1b[31m\u274C FAIL\x1b[0m';
  const W = 44; // inner width

  const lines: string[] = [];

  lines.push('\u2554' + '\u2550'.repeat(W) + '\u2557');
  lines.push('\u2551' + pad('     NVR CAPITAL \u2014 CONFIDENCE GATE', W) + '\u2551');
  lines.push('\u2560' + '\u2550'.repeat(W) + '\u2563');
  lines.push('\u2551' + pad(`  Overall Score:  ${Math.round(score.overall)}/100    ${status}`, W + 9) + '\u2551'); // +9 for ANSI codes
  lines.push('\u2551' + pad(`  Threshold:      ${threshold}/100`, W) + '\u2551');
  lines.push('\u2560' + '\u2550'.repeat(W) + '\u2563');
  lines.push('\u2551' + pad(`  Returns:        ${Math.round(score.byMetric.returnScore)}/25`, W) + '\u2551');
  lines.push('\u2551' + pad(`  Risk:           ${Math.round(score.byMetric.riskScore)}/25`, W) + '\u2551');
  lines.push('\u2551' + pad(`  Consistency:    ${Math.round(score.byMetric.consistencyScore)}/25`, W) + '\u2551');
  lines.push('\u2551' + pad(`  Robustness:     ${Math.round(score.byMetric.robustnessScore)}/25`, W) + '\u2551');
  lines.push('\u2560' + '\u2550'.repeat(W) + '\u2563');

  const conditions: MarketCondition[] = ['BULL', 'BEAR', 'RANGING', 'VOLATILE'];
  for (const cond of conditions) {
    const condScore = Math.round(score.byCondition[cond]);
    const condStatus = condScore >= DEFAULT_CONFIDENCE_CONFIG.minimumConditionConfidence ? '\x1b[32m\u2705\x1b[0m' : '\x1b[31m\u274C\x1b[0m';
    const label = pad(cond + ':', 11);
    lines.push('\u2551' + pad(`  ${label} ${condScore}/100  ${condStatus}`, W + 9) + '\u2551'); // +9 for ANSI codes
  }

  lines.push('\u2560' + '\u2550'.repeat(W) + '\u2563');
  lines.push('\u2551' + pad('  Reasoning:', W) + '\u2551');
  for (const reason of score.reasoning) {
    lines.push('\u2551' + pad(`  \u2022 ${reason}`, W) + '\u2551');
  }
  lines.push('\u255A' + '\u2550'.repeat(W) + '\u255D');

  return lines.join('\n');
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

function main(): void {
  console.log('\nRunning confidence gate with threshold:', CONFIDENCE_MIN);
  console.log('Strategy:', JSON.stringify(DEFAULT_STRATEGY_PARAMS, null, 2));
  console.log('');

  const startMs = Date.now();
  const gate = runConfidenceGate(CONFIDENCE_MIN);
  const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);

  console.log(formatReport(gate));
  console.log(`\nCompleted in ${durationSec}s\n`);

  if (!gate.passed) {
    console.error('\x1b[31m');
    console.error('==================================================');
    console.error(' CONFIDENCE GATE FAILED — DEPLOYMENT BLOCKED');
    console.error('==================================================');
    console.error(`Score: ${Math.round(gate.score.overall)}/100 (need ${gate.threshold})`);
    console.error('');
    console.error('Issues found:');
    for (const reason of gate.score.reasoning) {
      console.error(`  -> ${reason}`);
    }
    // Show per-condition scores for debugging
    const conditions: MarketCondition[] = ['BULL', 'BEAR', 'RANGING', 'VOLATILE'];
    console.error('');
    console.error('Per-condition scores:');
    for (const cond of conditions) {
      const condScore = Math.round(gate.score.byCondition[cond]);
      console.error(`  ${cond}: ${condScore}/100`);
    }
    console.error('\x1b[0m');
    process.exit(1);
  }

  console.log('\x1b[32mConfidence gate passed. Safe to deploy.\x1b[0m\n');
  process.exit(0);
}

// Only run main when executed directly (not imported)
const isMainModule = process.argv[1]?.endsWith('confidence-gate.ts') || process.argv[1]?.endsWith('confidence-gate.js');
if (isMainModule) {
  main();
}
