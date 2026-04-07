/**
 * NVR Capital — Unified Simulation CLI
 *
 * Single entry point for all simulation operations.
 * Keeps code clean by composing existing engine modules.
 *
 * Usage:
 *   npx tsx scripts/run-simulation.ts benchmark          # Current confidence score
 *   npx tsx scripts/run-simulation.ts optimize            # Parameter sweep → best params
 *   npx tsx scripts/run-simulation.ts validate [params]   # Walk-forward validation
 *   npx tsx scripts/run-simulation.ts stress              # Stress test (flash crash, etc.)
 *   npx tsx scripts/run-simulation.ts compare             # Compare strategy presets
 *   npx tsx scripts/run-simulation.ts report              # Full report (all of the above)
 */

import { generateSyntheticData } from '../src/simulation/data/historical-data.js';
import { runReplay } from '../src/simulation/engine/replay-engine.js';
import { walkForwardSplit } from '../src/simulation/engine/market-simulator.js';
import { calculateAggregateConfidence } from '../src/simulation/scoring/confidence-scorer.js';
import { runParameterSweep, runTournamentSweep, PRESET_SWEEPS } from '../src/simulation/backtester/parameter-sweep.js';
import { compareStrategies, getPresetVariants } from '../src/simulation/backtester/strategy-tester.js';
import { runImprovementLoop } from '../src/simulation/self-improvement/loop.js';
import { DEFAULT_STRATEGY_PARAMS, DEFAULT_CONFIDENCE_CONFIG } from '../src/simulation/types.js';
import type { HistoricalDataset, StrategyParams, MarketCondition, ReplayResult, ConfidenceScore } from '../src/simulation/types.js';
import { runConfidenceGate } from './confidence-gate.js';

// ============================================================================
// MARKET SCENARIOS (shared across all modes)
// ============================================================================

const SCENARIOS: Array<{
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

function generateDatasets(): HistoricalDataset[] {
  return SCENARIOS.map(s =>
    generateSyntheticData({
      symbol: `BTC-${s.label}`,
      startPrice: s.startPrice,
      candles: s.days * 24,
      drift: s.drift,
      volatility: s.volatility,
      seed: s.seed,
    })
  );
}

// Stress scenarios — extreme conditions
const STRESS_SCENARIOS = [
  { label: 'FLASH_CRASH',      days: 90, startPrice: 50000, drift: -3.0,  volatility: 1.5, seed: 501 },
  { label: 'LIQUIDITY_CRISIS', days: 90, startPrice: 40000, drift: -1.5,  volatility: 2.0, seed: 502 },
  { label: 'PARABOLIC_PUMP',   days: 90, startPrice: 30000, drift: 4.0,   volatility: 1.2, seed: 503 },
  { label: 'WHIPSAW',          days: 90, startPrice: 45000, drift: 0.0,   volatility: 3.0, seed: 504 },
];

// ============================================================================
// FORMATTING
// ============================================================================

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function hr(char = '-', width = 60): string {
  return DIM + char.repeat(width) + RESET;
}

function scoreColor(score: number, max: number): string {
  const pct = score / max;
  if (pct >= 0.7) return GREEN;
  if (pct >= 0.4) return YELLOW;
  return RED;
}

function formatPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function formatUSD(n: number): string {
  return `$${n.toFixed(2)}`;
}

// ============================================================================
// MODES
// ============================================================================

async function benchmark(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}NVR CAPITAL — CONFIDENCE BENCHMARK${RESET}\n`);
  console.log(`Strategy: ${DIM}${JSON.stringify(DEFAULT_STRATEGY_PARAMS)}${RESET}\n`);

  const startMs = Date.now();
  const gate = runConfidenceGate(60);
  const dur = ((Date.now() - startMs) / 1000).toFixed(1);

  const { score } = gate;
  const status = gate.passed ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;

  console.log(hr('='));
  console.log(`${BOLD}Overall: ${scoreColor(score.overall, 100)}${Math.round(score.overall)}/100${RESET}  [${status}]`);
  console.log(hr());
  console.log(`  Returns:     ${scoreColor(score.byMetric.returnScore, 25)}${Math.round(score.byMetric.returnScore)}/25${RESET}`);
  console.log(`  Risk:        ${scoreColor(score.byMetric.riskScore, 25)}${Math.round(score.byMetric.riskScore)}/25${RESET}`);
  console.log(`  Consistency: ${scoreColor(score.byMetric.consistencyScore, 25)}${Math.round(score.byMetric.consistencyScore)}/25${RESET}`);
  console.log(`  Robustness:  ${scoreColor(score.byMetric.robustnessScore, 25)}${Math.round(score.byMetric.robustnessScore)}/25${RESET}`);
  console.log(hr());

  const conditions: MarketCondition[] = ['BULL', 'BEAR', 'RANGING', 'VOLATILE'];
  for (const cond of conditions) {
    const s = Math.round(score.byCondition[cond]);
    console.log(`  ${cond.padEnd(10)} ${scoreColor(s, 100)}${s}/100${RESET}`);
  }

  console.log(hr());
  for (const r of score.reasoning) {
    console.log(`  ${DIM}${r}${RESET}`);
  }
  console.log(`\n${DIM}Completed in ${dur}s${RESET}\n`);
}

async function optimize(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}NVR CAPITAL — PARAMETER OPTIMIZATION${RESET}\n`);

  const datasets = generateDatasets();

  // Run confidence-optimized sweep
  console.log(`Running confidence-optimized parameter sweep...`);
  console.log(`Ranges: ${JSON.stringify(PRESET_SWEEPS.confidenceOptimized, null, 2)}\n`);

  const startMs = Date.now();
  const sweep = runParameterSweep(datasets, DEFAULT_STRATEGY_PARAMS, PRESET_SWEEPS.confidenceOptimized);
  const dur = ((Date.now() - startMs) / 1000).toFixed(1);

  console.log(hr('='));
  console.log(`${BOLD}Sweep Complete${RESET} — ${sweep.totalCombinations} combinations tested in ${dur}s\n`);

  // Show best by return
  console.log(`${BOLD}Best by Return:${RESET}`);
  const bestReturn = sweep.bestByReturn;
  console.log(`  Params: ${JSON.stringify(bestReturn.params)}`);
  console.log(`  Return: ${GREEN}${formatPct(bestReturn.metrics.totalReturnPct)}${RESET} | Sharpe: ${bestReturn.metrics.sharpeRatio.toFixed(2)} | Win Rate: ${(bestReturn.metrics.winRate * 100).toFixed(0)}% | Trades: ${bestReturn.metrics.totalTrades}`);
  console.log(`  Max DD: ${RED}${formatPct(bestReturn.metrics.maxDrawdownPct)}${RESET}`);

  // Show best by Sharpe
  console.log(`\n${BOLD}Best by Sharpe Ratio:${RESET}`);
  const bestSharpe = sweep.bestBySharpe;
  console.log(`  Params: ${JSON.stringify(bestSharpe.params)}`);
  console.log(`  Return: ${formatPct(bestSharpe.metrics.totalReturnPct)} | Sharpe: ${GREEN}${bestSharpe.metrics.sharpeRatio.toFixed(2)}${RESET} | Win Rate: ${(bestSharpe.metrics.winRate * 100).toFixed(0)}%`);

  // Now score the best params through confidence gate
  console.log(`\n${hr()}`);
  console.log(`${BOLD}Confidence scoring best-by-return params...${RESET}\n`);

  const proposedParams = { ...DEFAULT_STRATEGY_PARAMS, ...bestReturn.params };
  const proposedGate = runConfidenceGate(60, proposedParams);
  const currentGate = runConfidenceGate(60);

  console.log(`  Current confidence:  ${scoreColor(currentGate.score.overall, 100)}${Math.round(currentGate.score.overall)}/100${RESET}`);
  console.log(`  Proposed confidence: ${scoreColor(proposedGate.score.overall, 100)}${Math.round(proposedGate.score.overall)}/100${RESET}`);

  const delta = proposedGate.score.overall - currentGate.score.overall;
  const deltaColor = delta > 0 ? GREEN : delta < 0 ? RED : YELLOW;
  console.log(`  Delta:               ${deltaColor}${delta > 0 ? '+' : ''}${delta.toFixed(1)}${RESET}`);

  if (delta > 0 && proposedGate.passed) {
    console.log(`\n${GREEN}${BOLD}IMPROVEMENT FOUND${RESET} — proposed params score higher and pass gate`);
    console.log(`${DIM}Proposed params:${RESET} ${JSON.stringify(proposedParams, null, 2)}`);
  } else if (delta <= 0) {
    console.log(`\n${YELLOW}No improvement${RESET} — current params already optimal for this sweep range`);
  } else {
    console.log(`\n${RED}Proposed params fail confidence gate${RESET}`);
  }
  console.log('');
}

async function fastOptimize(): Promise<void> {
  // Allow selecting sweep preset via CLI arg: fast-optimize [preset]
  const presetName = (process.argv[3] || 'returnsFocused') as keyof typeof PRESET_SWEEPS;
  const ranges = PRESET_SWEEPS[presetName] || PRESET_SWEEPS.returnsFocused;

  console.log(`\n${BOLD}${CYAN}NVR CAPITAL — FAST TOURNAMENT OPTIMIZER${RESET}\n`);
  console.log(`${DIM}Preset: ${presetName}${RESET}`);
  console.log(`${DIM}2-stage tournament: screen with short data → validate survivors with full data${RESET}`);
  console.log(`${DIM}Early termination kills weak combos mid-run${RESET}\n`);

  const result = runTournamentSweep({
    ranges,
    baseParams: DEFAULT_STRATEGY_PARAMS,
    survivalRate: 0.25,
    screenDays: 90,
    fullDays: 365,
    onProgress: (msg) => console.log(msg),
  });

  console.log(`\n${hr('=')}`);
  console.log(`${BOLD}TOURNAMENT RESULTS${RESET}\n`);
  console.log(`  Total combos:    ${result.totalCombinations}`);
  console.log(`  Survivors:       ${result.survivorCount}`);
  console.log(`  Replay runs:     ${result.replayRuns} ${DIM}(vs ${result.bruteForceRuns} brute force)${RESET}`);
  console.log(`  Speedup:         ${GREEN}${result.speedup}x faster${RESET}`);
  console.log(`  Duration:        ${(result.durationMs / 1000).toFixed(1)}s`);

  // Show top 5 finalists
  console.log(`\n${BOLD}Top 5 Finalists:${RESET}`);
  console.log(`${'Rank'.padEnd(6)} ${'Return'.padStart(10)} ${'Sharpe'.padStart(8)} ${'Win%'.padStart(6)} ${'MaxDD'.padStart(8)} ${'Params'}`);
  console.log(hr());

  for (let i = 0; i < Math.min(5, result.finalists.length); i++) {
    const f = result.finalists[i];
    const returnColor = f.metrics.totalReturnPct >= 0 ? GREEN : RED;
    console.log(
      `${('#' + (i + 1)).padEnd(6)} ` +
      `${returnColor}${formatPct(f.metrics.totalReturnPct).padStart(10)}${RESET} ` +
      `${f.metrics.sharpeRatio.toFixed(2).padStart(8)} ` +
      `${(f.metrics.winRate * 100).toFixed(0).padStart(5)}% ` +
      `${RED}${formatPct(f.metrics.maxDrawdownPct).padStart(8)}${RESET} ` +
      `${DIM}${JSON.stringify(f.params)}${RESET}`
    );
  }

  // Score best through confidence gate
  console.log(`\n${hr()}`);
  console.log(`${BOLD}Confidence Gate Comparison${RESET}\n`);

  const proposedParams = { ...DEFAULT_STRATEGY_PARAMS, ...result.bestParams };
  const proposedGate = runConfidenceGate(60, proposedParams);
  const currentGate = runConfidenceGate(60);

  console.log(`  Current:   ${scoreColor(currentGate.score.overall, 100)}${Math.round(currentGate.score.overall)}/100${RESET}`);
  console.log(`  Proposed:  ${scoreColor(proposedGate.score.overall, 100)}${Math.round(proposedGate.score.overall)}/100${RESET}`);

  const delta = proposedGate.score.overall - currentGate.score.overall;
  const deltaColor = delta > 0 ? GREEN : delta < 0 ? RED : YELLOW;
  console.log(`  Delta:     ${deltaColor}${delta > 0 ? '+' : ''}${delta.toFixed(1)}${RESET}`);

  // Show metric breakdown
  console.log(`\n  ${BOLD}Metric breakdown (current → proposed):${RESET}`);
  console.log(`    Returns:     ${Math.round(currentGate.score.byMetric.returnScore)}/25 → ${scoreColor(proposedGate.score.byMetric.returnScore, 25)}${Math.round(proposedGate.score.byMetric.returnScore)}/25${RESET}`);
  console.log(`    Risk:        ${Math.round(currentGate.score.byMetric.riskScore)}/25 → ${scoreColor(proposedGate.score.byMetric.riskScore, 25)}${Math.round(proposedGate.score.byMetric.riskScore)}/25${RESET}`);
  console.log(`    Consistency: ${Math.round(currentGate.score.byMetric.consistencyScore)}/25 → ${scoreColor(proposedGate.score.byMetric.consistencyScore, 25)}${Math.round(proposedGate.score.byMetric.consistencyScore)}/25${RESET}`);
  console.log(`    Robustness:  ${Math.round(currentGate.score.byMetric.robustnessScore)}/25 → ${scoreColor(proposedGate.score.byMetric.robustnessScore, 25)}${Math.round(proposedGate.score.byMetric.robustnessScore)}/25${RESET}`);

  // Condition breakdown
  console.log(`\n  ${BOLD}Condition breakdown (current → proposed):${RESET}`);
  const conditions: MarketCondition[] = ['BULL', 'BEAR', 'RANGING', 'VOLATILE'];
  for (const cond of conditions) {
    const cur = Math.round(currentGate.score.byCondition[cond]);
    const prop = Math.round(proposedGate.score.byCondition[cond]);
    const condDelta = prop - cur;
    const condColor = condDelta > 0 ? GREEN : condDelta < 0 ? RED : YELLOW;
    console.log(`    ${cond.padEnd(10)} ${cur}/100 → ${condColor}${prop}/100 (${condDelta > 0 ? '+' : ''}${condDelta})${RESET}`);
  }

  if (delta > 0 && proposedGate.passed) {
    console.log(`\n${GREEN}${BOLD}IMPROVEMENT FOUND${RESET} — +${delta.toFixed(1)} confidence points`);
    console.log(`${DIM}Best params:${RESET} ${JSON.stringify(result.bestParams)}`);
    console.log(`${DIM}Full proposed:${RESET} ${JSON.stringify(proposedParams, null, 2)}`);
  } else if (delta <= 0) {
    console.log(`\n${YELLOW}No improvement${RESET} — current params already optimal for this sweep range`);
  } else {
    console.log(`\n${RED}Proposed params fail confidence gate${RESET}`);
  }
  console.log('');
}

async function validate(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}NVR CAPITAL — WALK-FORWARD VALIDATION${RESET}\n`);

  const datasets = generateDatasets();
  const conditions: MarketCondition[] = ['BULL', 'BEAR', 'RANGING', 'VOLATILE'];

  console.log(`Testing ${DEFAULT_STRATEGY_PARAMS.confluenceBuyThreshold} buy threshold across 4 market conditions...`);
  console.log(`Split: 70% train / 30% test (out-of-sample)\n`);

  for (let i = 0; i < datasets.length; i++) {
    const ds = datasets[i];
    const cond = conditions[i];
    const { train, test } = walkForwardSplit(ds, 0.7);

    const trainResult = runReplay([train], { strategy: DEFAULT_STRATEGY_PARAMS });
    const testResult = runReplay([test], { strategy: DEFAULT_STRATEGY_PARAMS });

    const trainReturn = trainResult.metrics.totalReturnPct;
    const testReturn = testResult.metrics.totalReturnPct;
    const overfit = trainReturn > 0 && testReturn < 0;

    console.log(`${BOLD}${cond}:${RESET}`);
    console.log(`  Train: ${formatPct(trainReturn)} return | ${(trainResult.metrics.winRate * 100).toFixed(0)}% win | ${trainResult.metrics.totalTrades} trades`);
    console.log(`  Test:  ${formatPct(testReturn)} return | ${(testResult.metrics.winRate * 100).toFixed(0)}% win | ${testResult.metrics.totalTrades} trades`);

    if (overfit) {
      console.log(`  ${RED}WARNING: Possible overfitting — train profitable, test negative${RESET}`);
    } else if (testReturn >= trainReturn * 0.5) {
      console.log(`  ${GREEN}Robust — test performance holds${RESET}`);
    } else {
      console.log(`  ${YELLOW}Moderate degradation on out-of-sample${RESET}`);
    }
    console.log('');
  }
}

async function stress(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}NVR CAPITAL — STRESS TEST${RESET}\n`);
  console.log(`Testing algorithm against extreme market conditions...\n`);

  for (const scenario of STRESS_SCENARIOS) {
    const ds = generateSyntheticData({
      symbol: `STRESS-${scenario.label}`,
      startPrice: scenario.startPrice,
      candles: scenario.days * 24,
      drift: scenario.drift,
      volatility: scenario.volatility,
      seed: scenario.seed,
    });

    const result = runReplay([ds], { strategy: DEFAULT_STRATEGY_PARAMS });
    const m = result.metrics;

    const survived = m.maxDrawdownPct > -95; // Didn't blow up
    const statusIcon = survived ? `${GREEN}SURVIVED${RESET}` : `${RED}BLOWN UP${RESET}`;

    console.log(`${BOLD}${scenario.label}:${RESET} [${statusIcon}]`);
    console.log(`  Return: ${formatPct(m.totalReturnPct)} | Max DD: ${RED}${formatPct(m.maxDrawdownPct)}${RESET} | Trades: ${m.totalTrades}`);
    console.log(`  Win Rate: ${(m.winRate * 100).toFixed(0)}% | Sharpe: ${m.sharpeRatio.toFixed(2)} | Final: ${formatUSD(DEFAULT_STRATEGY_PARAMS.startingCapital + m.totalReturn)}`);
    console.log('');
  }
}

async function compare(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}NVR CAPITAL — STRATEGY COMPARISON${RESET}\n`);

  const datasets = generateDatasets();
  const variants = getPresetVariants();

  console.log(`Comparing ${variants.length} strategy presets across 4 market conditions...\n`);

  const startMs = Date.now();
  const comparison = compareStrategies(datasets, variants);
  const dur = ((Date.now() - startMs) / 1000).toFixed(1);

  console.log(hr('='));
  console.log(`${BOLD}Results${RESET} (${dur}s)\n`);

  // Table header
  console.log(`${'Strategy'.padEnd(20)} ${'Return'.padStart(10)} ${'Sharpe'.padStart(8)} ${'Win%'.padStart(6)} ${'Trades'.padStart(7)} ${'MaxDD'.padStart(8)}`);
  console.log(hr());

  for (const r of comparison.ranked) {
    const returnColor = r.metrics.totalReturnPct >= 0 ? GREEN : RED;
    console.log(
      `${r.name.padEnd(20)} ` +
      `${returnColor}${formatPct(r.metrics.totalReturnPct).padStart(10)}${RESET} ` +
      `${r.metrics.sharpeRatio.toFixed(2).padStart(8)} ` +
      `${(r.metrics.winRate * 100).toFixed(0).padStart(5)}% ` +
      `${String(r.metrics.totalTrades).padStart(7)} ` +
      `${RED}${formatPct(r.metrics.maxDrawdownPct).padStart(8)}${RESET}`
    );
  }

  console.log(hr());
  console.log(`\n${BOLD}Best by Return:${RESET} ${comparison.ranked[0]?.name || 'N/A'}`);
  console.log('');
}

async function improve(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}NVR CAPITAL — SELF-IMPROVEMENT LOOP${RESET}\n`);

  const report = runImprovementLoop({
    currentParams: DEFAULT_STRATEGY_PARAMS,
    minConfidence: 60,
    onProgress: (msg) => console.log(msg),
  });

  // Save report to file
  const reportPath = `reports/improvement-${new Date().toISOString().slice(0, 10)}.json`;
  const fs = await import('fs');
  const path = await import('path');
  const dir = path.dirname(reportPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`${DIM}Report saved to ${reportPath}${RESET}\n`);

  // Final summary
  console.log(`${BOLD}RECOMMENDATION: ${
    report.recommendation === 'APPLY' ? `${GREEN}APPLY${RESET}` :
    report.recommendation === 'REVIEW' ? `${YELLOW}REVIEW${RESET}` :
    `${RED}REJECT${RESET}`
  }${RESET}`);

  if (report.proposedParams) {
    console.log(`\n${DIM}Proposed params:${RESET}`);
    console.log(JSON.stringify(report.proposedParams, null, 2));
  }
}

async function report(): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${BOLD}${CYAN}NVR CAPITAL — FULL SIMULATION REPORT${RESET}`);
  console.log(`${DIM}${new Date().toISOString()}${RESET}`);
  console.log(`${'='.repeat(60)}\n`);

  await benchmark();
  await validate();
  await stress();
  await compare();
  await optimize();

  console.log(`\n${BOLD}${GREEN}Report complete.${RESET}\n`);
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

const MODES: Record<string, () => Promise<void>> = {
  benchmark,
  optimize,
  'fast-optimize': fastOptimize,
  improve,
  validate,
  stress,
  compare,
  report,
};

async function main(): Promise<void> {
  const mode = process.argv[2] || 'benchmark';

  if (mode === '--help' || mode === '-h') {
    console.log(`
NVR Capital — Simulation CLI

Usage: npx tsx scripts/run-simulation.ts <mode>

Modes:
  benchmark      Current confidence score (default)
  optimize       Brute-force parameter sweep (slow, exhaustive)
  fast-optimize  Tournament optimizer (4-6x faster, recommended)
  improve        Self-improvement loop (research → hypothesize → simulate → validate → report)
  validate       Walk-forward validation (train/test split)
  stress      Extreme market stress tests
  compare     Compare 5 strategy presets side-by-side
  report      Full report (all of the above)
`);
    return;
  }

  const handler = MODES[mode];
  if (!handler) {
    console.error(`Unknown mode: "${mode}". Use --help to see available modes.`);
    process.exit(1);
  }

  await handler();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
