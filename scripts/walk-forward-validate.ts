/**
 * Walk-Forward Validation — Real BTC + ETH Data
 *
 * Fetches 6 months of hourly OHLCV data from CoinGecko (free tier),
 * then runs walk-forward validation using the current strategy params.
 *
 * Usage:
 *   npx tsx scripts/walk-forward-validate.ts
 *   npx tsx scripts/walk-forward-validate.ts --optimize   # IS optimization per window
 *
 * Window sizing (per arXiv 2602.10785 rolling WFV approach):
 *   - Training (IS): 720 candles = 30 days of hourly data
 *   - Test (OOS):    168 candles = 7 days of hourly data
 *   - Step:          168 candles (non-overlapping OOS windows, overlapping IS)
 *
 * This gives ~17 OOS windows over 6 months — enough for statistical significance.
 */

import { fetchHistoricalData } from '../src/simulation/data/historical-data.js';
import { runWalkForward } from '../src/simulation/walk-forward/engine.js';
import { DEFAULT_STRATEGY_PARAMS } from '../src/simulation/types.js';
import type { WalkForwardWindow } from '../src/simulation/types.js';

// ── Config ──────────────────────────────────────────────────────────────────
const COINS = [
  { id: 'bitcoin',  symbol: 'BTC' },
  { id: 'ethereum', symbol: 'ETH' },
];
const DAYS = 180;          // 6 months of data
const TRAIN_CANDLES = 720; // 30 days @ 1h
const TEST_CANDLES  = 168; // 7 days  @ 1h
const STEP_CANDLES  = 168; // non-overlapping OOS windows
const DO_OPTIMIZE   = process.argv.includes('--optimize');

// ── Formatting helpers ───────────────────────────────────────────────────────

function fmt(n: number, dp = 1) { return n.toFixed(dp); }
function pct(n: number)         { return `${fmt(n)}%`; }
function fmtDate(ts: number)    { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

function bar(val: number, max = 1, width = 20): string {
  const filled = Math.round(Math.min(Math.max(val / max, 0), 1) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║         NVR Capital — Walk-Forward Validation                ║');
  console.log('║  Real BTC + ETH data | arXiv 2602.10785 rolling WFV method  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log(`Config: IS=${TRAIN_CANDLES}h (${TRAIN_CANDLES/24}d) / OOS=${TEST_CANDLES}h (${TEST_CANDLES/24}d) / Step=${STEP_CANDLES}h`);
  console.log(`Mode: ${DO_OPTIMIZE ? 'IS-optimized params per window' : 'Fixed strategy params (DEFAULT_STRATEGY_PARAMS)'}`);
  console.log(`Data: ${DAYS} days of hourly OHLCV via CoinGecko free tier\n`);

  // ── Fetch data ──
  console.log('Fetching historical data...');
  const datasets = await Promise.all(
    COINS.map(async ({ id, symbol }) => {
      process.stdout.write(`  ${symbol} (${id})...`);
      const ds = await fetchHistoricalData({ coinId: id, days: DAYS });
      console.log(` ${ds.candles.length} candles (${fmtDate(ds.startTime)} – ${fmtDate(ds.endTime)})`);
      return ds;
    })
  );

  console.log();

  // ── Run per-asset validation ──
  for (const ds of datasets) {
    console.log(`\n${'─'.repeat(64)}`);
    console.log(`  ${ds.symbol} Walk-Forward Validation`);
    console.log(`${'─'.repeat(64)}`);

    let result;
    try {
      result = runWalkForward([ds], {
        trainPeriodCandles: TRAIN_CANDLES,
        testPeriodCandles: TEST_CANDLES,
        stepCandles: STEP_CANDLES,
        strategy: DEFAULT_STRATEGY_PARAMS,
        optimizeOnIS: DO_OPTIMIZE,
      });
    } catch (e) {
      console.error(`  Error: ${(e as Error).message}`);
      continue;
    }

    // Print per-window results
    console.log('\n  Window Results:');
    console.log('  ' + '─'.repeat(62));
    console.log('  #   IS Period      OOS Period    IS Ret  OOS Ret  WFE    Sharpe');
    console.log('  ' + '─'.repeat(62));

    for (const w of result.windows) {
      const isPeriod = `${fmtDate(w.isStartTime)}–${fmtDate(w.isEndTime)}`;
      const oosPeriod = `${fmtDate(w.oosStartTime)}–${fmtDate(w.oosEndTime)}`;
      const isRet  = pct(w.isMetrics.totalReturnPct).padStart(6);
      const oosRet = pct(w.oosMetrics.totalReturnPct).padStart(7);
      const wfe    = pct(w.efficiency * 100).padStart(6);
      const sharpe = fmt(w.oosMetrics.sharpeRatio, 2).padStart(6);
      const flag   = w.oosMetrics.totalReturnPct >= 0 ? '✓' : '✗';
      console.log(`  ${String(w.windowIndex + 1).padStart(2)} ${isPeriod.padEnd(14)} ${oosPeriod.padEnd(14)} ${isRet}  ${oosRet}  ${wfe}  ${sharpe}  ${flag}`);
    }

    console.log('  ' + '─'.repeat(62));

    // Print aggregate OOS stats
    const oos = result.aggregateOOS;
    const wfe = result.walkForwardEfficiency;
    console.log('\n  Aggregate OOS Performance:');
    console.log(`    Return:      ${pct(oos.totalReturnPct)} avg  ${bar(oos.totalReturnPct, 20)}`);
    console.log(`    Sharpe:      ${fmt(oos.avgSharpe, 2)}       ${bar(oos.avgSharpe, 2)}`);
    console.log(`    Win Rate:    ${pct(oos.avgWinRate * 100)}     ${bar(oos.avgWinRate)}`);
    console.log(`    Max DD:      ${pct(oos.maxDrawdownPct)} (worst OOS window)`);
    console.log(`    Consistency: ${pct(oos.consistencyScore)} windows profitable`);
    console.log(`    PF:          ${fmt(oos.profitFactor, 2)}`);
    console.log();
    console.log('  Walk-Forward Diagnostics:');
    console.log(`    WFE:         ${pct(wfe * 100)}  ${wfe >= 0.5 ? '✅ Generalizes well' : wfe >= 0.3 ? '⚠️  Marginal generalization' : '❌ Likely overfit'}`);
    console.log(`    Overfit:     ${fmt(result.overfittingPenalty, 2)} Sharpe penalty  ${result.overfittingPenalty <= 0.3 ? '✅ Low' : result.overfittingPenalty <= 1.0 ? '⚠️  Moderate' : '❌ High'}`);
    console.log();
    console.log('  Verdict:');
    for (const line of result.summary) {
      console.log(`    ${line}`);
    }
  }

  // ── Combined BTC+ETH run ──
  console.log(`\n${'═'.repeat(64)}`);
  console.log('  Combined BTC + ETH Walk-Forward (multi-asset portfolio)');
  console.log(`${'═'.repeat(64)}`);

  let combinedResult;
  try {
    combinedResult = runWalkForward(datasets, {
      trainPeriodCandles: TRAIN_CANDLES,
      testPeriodCandles: TEST_CANDLES,
      stepCandles: STEP_CANDLES,
      strategy: DEFAULT_STRATEGY_PARAMS,
      optimizeOnIS: DO_OPTIMIZE,
    });

    const oos = combinedResult.aggregateOOS;
    console.log(`\n  Windows: ${combinedResult.meta.windowCount}`);
    console.log(`  OOS Avg Return: ${pct(oos.totalReturnPct)}`);
    console.log(`  OOS Avg Sharpe: ${fmt(oos.avgSharpe, 2)}`);
    console.log(`  Consistency:    ${pct(oos.consistencyScore)}`);
    console.log(`  WFE:            ${pct(combinedResult.walkForwardEfficiency * 100)}`);
    console.log(`\n  Verdict: ${combinedResult.summary[combinedResult.summary.length - 1]}`);
  } catch (e) {
    console.error(`  Error: ${(e as Error).message}`);
  }

  console.log('\n');
}

main().catch(e => {
  console.error('Walk-forward validation failed:', e);
  process.exit(1);
});
