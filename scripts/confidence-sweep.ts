/**
 * NVR Capital — Confidence-Optimized Parameter Sweep (Fast)
 * Tests key parameter combinations against ALL 4 market conditions.
 */
import { runConfidenceGate } from './confidence-gate.js';
import { calculateConfidence } from '../src/simulation/scoring/confidence-scorer.js';
import { DEFAULT_STRATEGY_PARAMS } from '../src/simulation/types.js';
import type { StrategyParams } from '../src/simulation/types.js';

interface SweepEntry {
  params: Partial<StrategyParams>;
  score: number;
  bull: number;
  bear: number;
  ranging: number;
  volatile: number;
  allPass: boolean;
  individual: number[];
}

const results: SweepEntry[] = [];
let tested = 0;

// Targeted sweep on the 3 most impactful params
const stopLosses = [5, 6, 7, 8];
const profitTakes = [5, 6, 8];
const maxPositions = [6, 8, 10, 12];

const total = stopLosses.length * profitTakes.length * maxPositions.length;
console.log(`Testing ${total} parameter combinations (~${(total * 80 / 60).toFixed(0)} minutes)...`);
const startMs = Date.now();

for (const stop of stopLosses) {
  for (const profit of profitTakes) {
    for (const maxPos of maxPositions) {
      const params: StrategyParams = {
        ...DEFAULT_STRATEGY_PARAMS,
        stopLossPercent: stop,
        profitTakePercent: profit,
        maxPositionPercent: maxPos,
      };

      const gate = runConfidenceGate(60, params);
      const individual = gate.results.map(r => calculateConfidence(r).overall);
      const entry: SweepEntry = {
        params: { stopLossPercent: stop, profitTakePercent: profit, maxPositionPercent: maxPos },
        score: gate.score.overall,
        bull: gate.score.byCondition.BULL,
        bear: gate.score.byCondition.BEAR,
        ranging: gate.score.byCondition.RANGING,
        volatile: gate.score.byCondition.VOLATILE,
        allPass: gate.passed,
        individual,
      };
      results.push(entry);
      tested++;

      const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
      const perCombo = (Date.now() - startMs) / tested / 1000;
      const remaining = ((total - tested) * perCombo / 60).toFixed(1);
      process.stdout.write(`  ${tested}/${total} (${elapsed}s elapsed, ~${remaining}min remaining)   \r`);
    }
  }
}

// Sort by score
results.sort((a, b) => b.score - a.score);

console.log(`\n\n=== TOP 10 PARAMETER COMBINATIONS ===\n`);
for (let i = 0; i < Math.min(10, results.length); i++) {
  const r = results[i];
  const pass = r.allPass ? 'PASS' : 'FAIL';
  console.log(`#${i + 1}: Score ${r.score.toFixed(0)}/100 ${pass}`);
  console.log(`  stop=${(r.params as any).stopLossPercent}% profit=${(r.params as any).profitTakePercent}% maxPos=${(r.params as any).maxPositionPercent}%`);
  console.log(`  BULL:${r.bull.toFixed(0)} BEAR:${r.bear.toFixed(0)} RANGING:${r.ranging.toFixed(0)} VOLATILE:${r.volatile.toFixed(0)}`);
  console.log(`  Individual: ${r.individual.map(s => s.toFixed(0)).join(', ')}`);
  console.log('');
}

const passing = results.filter(r => r.allPass);
console.log(`${passing.length}/${results.length} combinations passed the gate.`);
console.log(`Total time: ${((Date.now() - startMs) / 1000 / 60).toFixed(1)} minutes`);
