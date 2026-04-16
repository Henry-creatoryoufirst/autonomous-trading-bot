/**
 * Dry-run script for the v21.18 migration against live production state.
 *
 * Pulls trades + balances from the production bot API, runs the migration
 * in dry-run mode, and prints a full diff. No writes.
 *
 * Usage:
 *   npx tsx scripts/dry-run-v2118.ts
 */

import * as fs from 'fs';
import { runMigrationV2118 } from '../src/core/portfolio/migration-v21-18.js';
import type { OnChainTransfer } from '../src/core/portfolio/rebuild.js';
import type { TokenCostBasis, TradeRecord } from '../src/core/types/index.js';

const PROD_API = 'https://autonomous-trading-bot-production.up.railway.app';
const TRANSFERS_PATH = '/tmp/onchain-transfers.json';

interface BalanceEntry {
  symbol: string;
  balance: number;
  usdValue: number;
  costBasis: number | null;
  unrealizedPnL: number;
  totalInvested: number;
  realizedPnL: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json() as Promise<T>;
}

function makeCostBasisFromBalances(
  balances: BalanceEntry[],
): Record<string, TokenCostBasis> {
  const map: Record<string, TokenCostBasis> = {};
  for (const b of balances) {
    if (b.symbol === 'USDC') continue;
    map[b.symbol] = {
      symbol: b.symbol,
      totalInvestedUSD: b.totalInvested ?? 0,
      totalTokensAcquired: 0,
      averageCostBasis: b.costBasis ?? 0,
      currentHolding: b.balance,
      realizedPnL: b.realizedPnL ?? 0,
      unrealizedPnL: b.unrealizedPnL ?? 0,
      peakPrice: 0,
      peakPriceDate: '2026-02-15T00:00:00Z',
      firstBuyDate: '2026-02-15T00:00:00Z',
      lastTradeDate: new Date().toISOString(),
      atrStopPercent: null,
      atrTrailPercent: null,
      atrAtEntry: null,
      trailActivated: false,
      lastAtrUpdate: null,
    };
  }
  return map;
}

async function main() {
  process.stdout.write('Fetching live state from production API...\n');

  const [balancesResp, tradesResp] = await Promise.all([
    fetchJson<{ balances: BalanceEntry[]; totalValue: number }>(
      `${PROD_API}/api/balances`,
    ),
    fetchJson<{ trades: TradeRecord[] }>(
      `${PROD_API}/api/trades?limit=10000`,
    ),
  ]);

  const costBasis = makeCostBasisFromBalances(balancesResp.balances);
  const state = { costBasis } as {
    costBasis: Record<string, TokenCostBasis>;
    [k: string]: unknown;
  };
  const onchainBalances: Record<string, number> = Object.fromEntries(
    balancesResp.balances
      .filter((b) => b.symbol !== 'USDC')
      .map((b) => [b.symbol, b.balance]),
  );

  // Optionally load the on-chain transfer feed from the indexer (Session 2).
  // If the file exists and is non-empty, we reconcile airdrops/phantoms too.
  let transfers: OnChainTransfer[] | undefined;
  if (fs.existsSync(TRANSFERS_PATH)) {
    try {
      const raw = fs.readFileSync(TRANSFERS_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as OnChainTransfer[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        transfers = parsed;
      }
    } catch {
      /* ignore — treat as no transfers file */
    }
  }

  process.stdout.write(
    `  Trades: ${tradesResp.trades.length}\n  Tokens in state: ${Object.keys(costBasis).length}\n  Portfolio on-chain: $${balancesResp.totalValue.toFixed(2)}\n  Indexer transfers: ${transfers?.length ?? '(none — run build-onchain-index.ts first)'}\n\n`,
  );

  const result = runMigrationV2118({
    state,
    trades: tradesResp.trades,
    transfers,
    onchainBalances,
    dryRun: true,
  });

  process.stdout.write('=== MIGRATION v21.18 — DRY RUN RESULT ===\n\n');
  process.stdout.write('Summary:\n');
  process.stdout.write(`  Trades replayed:          ${result.summary.tradesReplayed}\n`);
  process.stdout.write(`  Trades skipped:           ${result.summary.tradesSkipped}\n`);
  process.stdout.write(`  Transfers processed:      ${result.summary.transfersProcessed}\n`);
  process.stdout.write(`  Unmatched transfers:      ${result.summary.unmatchedTransfers}  (airdrops + unlogged swaps)\n`);
  process.stdout.write(`  Symbols touched:          ${result.summary.symbolsTouched}\n`);
  process.stdout.write(`  Realized P&L BEFORE:      $${result.summary.realizedPnLBefore.toFixed(2)}\n`);
  process.stdout.write(`  Realized P&L AFTER:       $${result.summary.realizedPnLAfter.toFixed(2)}\n`);
  process.stdout.write(`  Phantom P&L removed:      $${result.summary.phantomPnLRemoved.toFixed(2)}\n\n`);

  process.stdout.write('Per-token corrections (top 15 by |Δ realizedPnL|):\n');
  process.stdout.write(
    '  ' +
      'Token'.padEnd(10) +
      'AvgCost BEFORE'.padEnd(18) +
      'AvgCost AFTER'.padEnd(18) +
      'Realized BEFORE'.padEnd(18) +
      'Realized AFTER'.padEnd(18) +
      'Δ Realized\n',
  );
  process.stdout.write('  ' + '-'.repeat(100) + '\n');
  for (const d of result.diffs.slice(0, 15)) {
    process.stdout.write(
      '  ' +
        d.symbol.padEnd(10) +
        `$${d.before.averageCostBasis.toExponential(3)}`.padEnd(18) +
        `$${d.after.averageCostBasis.toExponential(3)}`.padEnd(18) +
        `$${d.before.realizedPnL.toFixed(2)}`.padEnd(18) +
        `$${d.after.realizedPnL.toFixed(2)}`.padEnd(18) +
        `$${d.delta.realizedPnL >= 0 ? '+' : ''}${d.delta.realizedPnL.toFixed(2)}\n`,
    );
  }

  process.stdout.write('\n');
  process.stdout.write(
    'This is a dry run — nothing was written to state.\n',
  );
  process.stdout.write(
    'To apply the migration, run without MIGRATION_V2118_DRY_RUN.\n',
  );
}

main().catch((err) => {
  console.error('Dry run failed:', err);
  process.exit(1);
});
