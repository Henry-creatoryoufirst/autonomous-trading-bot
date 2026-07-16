#!/usr/bin/env tsx
/**
 * NVR-SPEC-034 Phase 1a — manual verification script.
 *
 * Fetches one funding-rate sample + one depth snapshot from each
 * configured venue and prints them in human-readable form. Confirms:
 *   1. The wire format we parse matches what the venues actually return.
 *   2. The per-venue funding cadence (8h for OKX/Bitfinex, 1h for Hyperliquid).
 *   3. Slippage at $50/$100/$300/$500 — the number Henry asked about
 *      in spec §9 Open Question 3.
 *
 * Forces FUNDING_ARB_MONITOR_ENABLED=true for this run only — the bot's
 * runtime default stays unset, so importing the module from agent-v3.2.ts
 * does not trigger any network activity.
 *
 * Usage:  npx tsx scripts/sample-funding-rate.ts
 */

process.env.FUNDING_ARB_MONITOR_ENABLED = 'true';

import {
  runMonitorCycle,
  getMonitorStats,
  _internals,
  type FundingRateSample,
  type SlippageCurve,
} from '../src/core/services/funding-rate-monitor.js';

function fmtFundingRow(s: FundingRateSample): string {
  const pctPerPeriod = (s.rate * 100).toFixed(4);
  const apr = s.annualizedPct.toFixed(2);
  const next = s.nextFundingTime ? new Date(s.nextFundingTime).toISOString() : '—';
  return `  ${s.venue.padEnd(12)} ${s.asset.padEnd(4)} ${pctPerPeriod.padStart(8)}%/period (${s.periodHours}h)   ${apr.padStart(7)}% APR   next: ${next}`;
}

function fmtSlippageCurve(c: SlippageCurve): string {
  const lines = [`  ${c.venue} ${c.asset}-PERP  ${c.side.toUpperCase()}  mid=$${c.midPrice.toFixed(2)}`];
  for (const p of c.points) {
    const tag = p.exhausted ? '  EXHAUSTED' : '';
    lines.push(
      `    $${String(p.notionalUsd).padStart(4)}  fill=$${p.fillPrice.toFixed(2).padStart(11)}  slip=${p.slippageBps.toFixed(2).padStart(6)} bps${tag}`,
    );
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  console.log('=== NVR-SPEC-034 Phase 1a — funding-rate-monitor sample ===\n');
  console.log(`Persist file: ${_internals.HISTORY_FILE}`);
  console.log(`Notional ladder: $${_internals.NOTIONAL_LADDER.join(' / $')}`);
  console.log(`Assets: ${_internals.PERP_ASSETS.join(', ')}\n`);

  const row = await runMonitorCycle();
  if (!row) {
    console.error('Monitor returned null — env flag not set (this should not happen given the override).');
    process.exit(1);
  }

  console.log('--- FUNDING RATES ---');
  if (row.fundingRates.length === 0) {
    console.log('  (none — every venue fetch failed; see stats below)');
  } else {
    for (const s of row.fundingRates) console.log(fmtFundingRow(s));
  }

  console.log('\n--- DEPTH SNAPSHOTS ---');
  if (row.depthSnapshots.length === 0) {
    console.log('  (none returned this cycle)');
  } else {
    for (const snap of row.depthSnapshots) {
      console.log(`  ${snap.venue} ${snap.asset}-PERP  mid=$${snap.midPrice.toFixed(2)}   asks=${snap.asks.length}lvl  bids=${snap.bids.length}lvl`);
    }
  }

  console.log('\n--- SLIPPAGE CURVES (answer to spec §9 Q3) ---');
  if (row.slippageCurves.length === 0) {
    console.log('  (none — depth snapshot unavailable)');
  } else {
    for (const c of row.slippageCurves) console.log(fmtSlippageCurve(c));
  }

  console.log('\n--- STATS ---');
  console.log(JSON.stringify(getMonitorStats(), null, 2));

  console.log(`\n✅ Sample written to ${_internals.HISTORY_FILE}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
