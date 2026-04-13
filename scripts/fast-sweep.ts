/**
 * NVR Capital — Fast Parallel Parameter Sweep
 *
 * Improvements over confidence-sweep.ts:
 *   1. All combos run in parallel child processes (true CPU parallelism)
 *   2. Batched by CPU core count — no thrashing
 *   3. Progress bar updates in real-time as workers complete
 *
 * Usage:
 *   npx tsx scripts/fast-sweep.ts
 *   CONFIDENCE_MIN=65 npx tsx scripts/fast-sweep.ts
 *
 * Phase 1 (48 combos): stop × profit × maxPos         — found optimal: stop=6, profit=5, maxPos=6
 * Phase 2 (42 combos): confluence × stop × profit     — maxPos fixed at 6 (optimal)
 *
 * ~90 min sequential → ~10-12 min parallel on M-series Mac
 */

import { spawn } from 'child_process';
import { cpus } from 'os';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = resolve(__dirname, 'sweep-worker.ts');
const CONFIDENCE_MIN = parseInt(process.env.CONFIDENCE_MIN || '60', 10);
const CORES = Math.max(1, cpus().length - 1);

// Phase 2: sweep confluenceBuyThreshold — the live bot uses 25, sim default is 18
// maxPos fixed at 6 (proven optimal in Phase 1)
const confluenceThresholds = [14, 16, 18, 20, 22, 25, 28];
const stopLosses           = [5, 6, 7];
const profitTakes          = [5, 6];
const maxPos               = 6; // fixed

const combos: Array<{ confluence: number; stopLoss: number; profitTake: number; maxPos: number }> = [];
for (const confluence of confluenceThresholds)
  for (const stop of stopLosses)
    for (const profit of profitTakes)
      combos.push({ confluence, stopLoss: stop, profitTake: profit, maxPos });

const total = combos.length;

console.log('⚡ Fast Sweep — NVR Capital Parameter Optimizer');
console.log(`   Cores available: ${CORES + 1} (using ${CORES} in parallel)`);
console.log(`   Combos to test:  ${total}`);
console.log(`   Threshold:       ${CONFIDENCE_MIN}/100\n`);

const startMs = Date.now();
let completed = 0;
const results: any[] = [];

function runCombo(combo: typeof combos[0]): Promise<any> {
  return new Promise((resolve_p, reject) => {
    const child = spawn('npx', ['tsx', WORKER_SCRIPT], {
      env: {
        ...process.env,
        SWEEP_CONFLUENCE: String(combo.confluence),
        SWEEP_STOP:       String(combo.stopLoss),
        SWEEP_PROFIT:     String(combo.profitTake),
        SWEEP_MAXPOS:     String(combo.maxPos),
        SWEEP_THRESHOLD:  String(CONFIDENCE_MIN),
      },
      cwd: dirname(__dirname),
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code) => {
      completed++;
      const pct = Math.round((completed / total) * 100);
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
      const rate = completed / ((Date.now() - startMs) / 1000);
      const remaining = rate > 0 ? ((total - completed) / rate).toFixed(0) : '?';
      const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
      process.stdout.write(`  [${bar}] ${pct}% | ${completed}/${total} | ${elapsed}s elapsed | ~${remaining}s left   \r`);

      if (code !== 0 || !stdout.trim()) {
        reject(new Error(`Worker failed (code ${code}): ${stderr.slice(0, 200)}`));
        return;
      }
      try {
        resolve_p(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error(`Bad JSON from worker: ${stdout.slice(0, 100)}`));
      }
    });
  });
}

// Run in batches of CORES
for (let i = 0; i < combos.length; i += CORES) {
  const batch = combos.slice(i, i + CORES);
  const batchResults = await Promise.allSettled(batch.map(runCombo));
  for (const r of batchResults) {
    if (r.status === 'fulfilled') results.push(r.value);
    else console.error(`\n  ⚠️  Worker error: ${r.reason?.message}`);
  }
}

// Sort and report
results.sort((a, b) => b.score - a.score);
const elapsed = ((Date.now() - startMs) / 1000 / 60).toFixed(1);

console.log(`\n\n${'═'.repeat(60)}`);
console.log(`  TOP 10 PARAMETER COMBINATIONS  (${elapsed} min total)`);
console.log('═'.repeat(60));

for (let i = 0; i < Math.min(10, results.length); i++) {
  const r = results[i];
  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
  const pass  = r.passed ? '✅ PASS' : '❌ FAIL';
  console.log(`\n${medal}  Score: ${r.score.toFixed(0)}/100  ${pass}`);
  console.log(`    confluence=${r.params.confluence}  stop=${r.params.stopLoss}%  profit=${r.params.profitTake}%  maxPos=${r.params.maxPos}%`);
  console.log(`    BULL:${r.bull.toFixed(0)}  BEAR:${r.bear.toFixed(0)}  RANGING:${r.ranging.toFixed(0)}  VOLATILE:${r.volatile.toFixed(0)}`);
  console.log(`    Per-condition: ${r.individual.map((s: number) => s.toFixed(0)).join(' / ')}`);
}

const passing = results.filter((r) => r.passed);
console.log(`\n${'─'.repeat(60)}`);
console.log(`${passing.length}/${results.length} combinations passed threshold ${CONFIDENCE_MIN}/100`);
console.log(`Total time: ${elapsed} minutes`);

if (results[0]?.passed) {
  const best = results[0];
  console.log(`\n💡 Recommended update for live bot (constants.ts + confidence-gate.ts):`);
  console.log(`   confluenceBuyThreshold: ${best.params.confluence}`);
  console.log(`   stopLossPercent:        ${best.params.stopLoss}%`);
  console.log(`   profitTakePercent:      ${best.params.profitTake}%`);
  console.log(`   maxPositionPercent:     ${best.params.maxPos}%`);
  console.log(`   Score improvement:      ${results[results.length - 1]?.score.toFixed(0)} → ${best.score.toFixed(0)}`);
}
