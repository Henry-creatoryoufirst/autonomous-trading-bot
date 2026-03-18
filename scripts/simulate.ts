#!/usr/bin/env npx tsx
/**
 * NVR-SPEC-001: CLI Backtesting Runner
 *
 * Usage:
 *   npx tsx scripts/simulate.ts
 *   npx tsx scripts/simulate.ts --capital=1000 --stopLoss=10 --profitTake=25
 *   npx tsx scripts/simulate.ts --compare --stopLoss=10  (A/B vs default)
 */

import { runSimulation, compareStrategies, loadPriceHistory, DEFAULT_SIM_CONFIG, type SimConfig } from '../services/simulator.js';

function parseArgs(): { config: SimConfig; compare: boolean } {
  const config: SimConfig = { ...DEFAULT_SIM_CONFIG };
  let compare = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === '--compare') { compare = true; continue; }
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (m) {
      const [, key, val] = m;
      const map: Record<string, keyof SimConfig> = {
        capital: 'startingCapital', profitTake: 'profitTakePercent', stopLoss: 'stopLossPercent',
        kelly: 'kellyFraction', maxPosition: 'maxPositionPercent', minPosition: 'minPositionUSD',
        cashDeploy: 'cashDeployThreshold',
      };
      const configKey = map[key] || key as keyof SimConfig;
      if (configKey in config) (config as any)[configKey] = parseFloat(val);
    }
  }
  return { config, compare };
}

function fmt(n: number, decimals = 2): string { return n.toFixed(decimals); }
function fmtPct(n: number): string { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`; }
function fmtUSD(n: number): string { return `$${n.toFixed(2)}`; }

function printResult(label: string, r: ReturnType<typeof runSimulation>, config: SimConfig) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Starting Capital:   ${fmtUSD(config.startingCapital)}`);
  console.log(`  Final Value:        ${fmtUSD(config.startingCapital + r.totalReturn)}`);
  console.log(`  Total Return:       ${fmtUSD(r.totalReturn)} (${fmtPct(r.totalReturnPct)})`);
  console.log(`  Hold Baseline:      ${fmtUSD(r.holdBaseline)} (${fmtPct(((r.holdBaseline - config.startingCapital) / config.startingCapital) * 100)})`);
  console.log(`  vs Hold:            ${fmtPct(r.totalReturnPct - ((r.holdBaseline - config.startingCapital) / config.startingCapital) * 100)}`);
  console.log(`  ---`);
  console.log(`  Max Drawdown:       ${fmtUSD(r.maxDrawdown)} (${fmt(r.maxDrawdownPct)}%)`);
  console.log(`  Sharpe Ratio:       ${fmt(r.sharpeRatio)}`);
  console.log(`  ---`);
  console.log(`  Total Trades:       ${r.totalTrades}`);
  console.log(`  Win Rate:           ${fmt(r.winRate * 100)}% (${r.winningTrades}W / ${r.losingTrades}L)`);
  console.log(`  Profit Factor:      ${r.profitFactor === Infinity ? 'INF' : fmt(r.profitFactor)}`);
  console.log(`  Avg Win:            ${fmtUSD(r.avgWin)}`);
  console.log(`  Avg Loss:           ${fmtUSD(r.avgLoss)}`);
  console.log(`  ---`);
  console.log(`  Config: PT=${config.profitTakePercent}% SL=${config.stopLossPercent}% Kelly=${config.kellyFraction} MaxPos=${config.maxPositionPercent}% CashDeploy=${config.cashDeployThreshold}%`);

  if (r.trades.length > 0) {
    console.log(`\n  Last 10 trades:`);
    for (const t of r.trades.slice(-10)) {
      console.log(`    ${t.timestamp.slice(0, 16)} ${t.action.padEnd(4)} ${t.token.padEnd(8)} ${fmtUSD(t.amountUSD).padStart(10)} @ ${fmtUSD(t.price).padStart(12)}  ${t.reason}`);
    }
  }
}

// === MAIN ===
try {
  const { config, compare } = parseArgs();
  const t0 = Date.now();
  const history = loadPriceHistory();
  const loadMs = Date.now() - t0;

  const tokens = [...history.keys()];
  const totalPoints = tokens.reduce((s, t) => s + (history.get(t)?.prices.length || 0), 0);
  console.log(`Loaded ${tokens.length} tokens, ${totalPoints} data points in ${loadMs}ms`);

  if (compare) {
    const t1 = Date.now();
    const result = compareStrategies(DEFAULT_SIM_CONFIG, config, history);
    const simMs = Date.now() - t1;
    printResult('Strategy A (Default)', result.a, DEFAULT_SIM_CONFIG);
    printResult('Strategy B (Modified)', result.b, config);
    console.log(`\n${'='.repeat(60)}`);
    console.log('  DELTA (B - A)');
    console.log(`${'='.repeat(60)}`);
    for (const [k, v] of Object.entries(result.delta)) {
      console.log(`  ${k.padEnd(20)} ${v >= 0 ? '+' : ''}${fmt(v as number)}`);
    }
    console.log(`\n  Simulation time: ${simMs}ms`);
  } else {
    const t1 = Date.now();
    const result = runSimulation(config, history);
    const simMs = Date.now() - t1;
    printResult('Simulation Result', result, config);
    console.log(`\n  Simulation time: ${simMs}ms`);
  }
} catch (err: any) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
