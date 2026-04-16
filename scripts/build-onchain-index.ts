/**
 * build-onchain-index.ts — NVR Capital
 *
 * CLI that runs the on-chain indexer for the bot wallet and writes a
 * normalized ground-truth ledger of every ERC-20 Transfer touching the wallet
 * since the first deposit.
 *
 * Outputs:
 *   /tmp/onchain-transfers.json — full chronological ledger
 *   /tmp/phantom-transfers.json — on-chain transfers with no matching trade
 *
 * Usage:
 *   npx tsx scripts/build-onchain-index.ts
 *
 * Optional env vars:
 *   BASE_RPC_URL        — private RPC (Alchemy/QuickNode) for faster runs
 *   INDEX_FROM_BLOCK    — override start block (default: auto-find 2026-02-15)
 *   INDEX_TO_BLOCK      — override end block (default: latest)
 *   INDEX_CHUNK_SIZE    — blocks per getLogs call (default: 10000)
 *   INDEX_CONCURRENCY   — parallel chunk fetches (default: 4)
 *   INDEX_WALLET        — override bot wallet
 *   TRADES_PATH         — bot trade log (default: /tmp/all-trades.json)
 */

import * as fs from 'fs';
import { getAddress, type Address } from 'viem';
import {
  indexBotWalletTransfers,
  createBaseIndexerClient,
  findBlockAtOrAfterTimestamp,
  type OnChainTransfer,
} from '../src/core/data/onchain-indexer.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BOT_WALLET: Address = getAddress(
  process.env.INDEX_WALLET ?? '0xB7c51b1A8F967eF6BF906Fe4B484817Fe784a7C1',
);

/** Unix seconds for 2026-02-15T00:00:00Z — the first-deposit target date */
const FIRST_DEPOSIT_UNIX = Math.floor(
  new Date('2026-02-15T00:00:00Z').getTime() / 1000,
);

const OUTPUT_PATH = '/tmp/onchain-transfers.json';
const PHANTOMS_PATH = '/tmp/phantom-transfers.json';
const TRADES_PATH = process.env.TRADES_PATH ?? '/tmp/all-trades.json';

// ---------------------------------------------------------------------------
// Cross-reference helpers
// ---------------------------------------------------------------------------

interface BotTrade {
  timestamp: string;
  action: string;
  fromToken: string;
  toToken: string;
  txHash?: string;
  tokenAmount?: number;
  amountUSD?: number;
}

function loadTradeLog(): BotTrade[] {
  if (!fs.existsSync(TRADES_PATH)) {
    console.warn(`  ⚠️  ${TRADES_PATH} not found — skipping phantom cross-reference`);
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(TRADES_PATH, 'utf-8'));
    const trades: BotTrade[] = Array.isArray(raw) ? raw : raw.trades ?? [];
    return trades.filter((t) => !!t.txHash);
  } catch (e: any) {
    console.warn(`  ⚠️  Failed to parse ${TRADES_PATH}: ${e.message}`);
    return [];
  }
}

function buildLoggedTxSet(trades: BotTrade[]): Set<string> {
  const set = new Set<string>();
  for (const t of trades) {
    if (t.txHash) set.add(t.txHash.toLowerCase());
  }
  return set;
}

/**
 * A "phantom" transfer is an on-chain movement with no matching entry in the
 * bot's trade log. We match by txHash (exact) — the bot logs every swap it
 * executes with its hash, so anything else is an airdrop, direct transfer,
 * dust sweep, or unlogged swap.
 */
function findPhantomTransfers(
  transfers: OnChainTransfer[],
  loggedTxs: Set<string>,
): OnChainTransfer[] {
  return transfers.filter((t) => !loggedTxs.has(t.txHash.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function formatTokenAmount(n: number): string {
  if (n === 0) return '0';
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (Math.abs(n) >= 1) return n.toFixed(4);
  return n.toPrecision(4);
}

function printSummary(
  transfers: OnChainTransfer[],
  trades: BotTrade[],
  loggedTxs: Set<string>,
  phantoms: OnChainTransfer[],
) {
  const byToken = new Map<string, { in: number; out: number; count: number }>();
  for (const t of transfers) {
    const key = `${t.token.symbol} (${t.token.address.slice(0, 10)}…)`;
    let row = byToken.get(key);
    if (!row) { row = { in: 0, out: 0, count: 0 }; byToken.set(key, row); }
    row.count++;
    if (t.direction === 'IN') row.in += t.tokenAmount;
    else row.out += t.tokenAmount;
  }

  const inCount = transfers.filter((t) => t.direction === 'IN').length;
  const outCount = transfers.filter((t) => t.direction === 'OUT').length;

  const matched = transfers.filter((t) => loggedTxs.has(t.txHash.toLowerCase())).length;
  const uniqueTxs = new Set(transfers.map((t) => t.txHash.toLowerCase())).size;

  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  ON-CHAIN TRANSFER INDEX — SUMMARY');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`  Wallet:                      ${BOT_WALLET}`);
  console.log(`  Total transfers:             ${transfers.length.toLocaleString()}`);
  console.log(`    Inbound (IN):              ${inCount.toLocaleString()}`);
  console.log(`    Outbound (OUT):            ${outCount.toLocaleString()}`);
  console.log(`  Unique txHashes:             ${uniqueTxs.toLocaleString()}`);
  console.log(`  Unique tokens:               ${byToken.size.toLocaleString()}`);
  console.log('');
  console.log('  CROSS-REFERENCE vs BOT TRADE LOG');
  console.log('  ─────────────────────────────────');
  console.log(`  Bot trades in log:           ${trades.length.toLocaleString()}`);
  console.log(`  Logged unique txHashes:      ${loggedTxs.size.toLocaleString()}`);
  console.log(`  On-chain transfers matched:  ${matched.toLocaleString()}`);
  console.log(`  PHANTOM transfers:           ${phantoms.length.toLocaleString()}`);
  console.log(`    (on-chain with no bot trade entry — cost-basis corruption source)`);
  console.log('');
  console.log('  TOP 15 TOKENS BY TRANSFER COUNT');
  console.log('  ─────────────────────────────────');
  const sorted = [...byToken.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 15);
  for (const [token, row] of sorted) {
    console.log(
      `  ${token.padEnd(35)} ${String(row.count).padStart(5)} transfers  ` +
      `+${formatTokenAmount(row.in).padStart(14)} in / ` +
      `-${formatTokenAmount(row.out).padStart(14)} out`,
    );
  }
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`  Ledger written:   ${OUTPUT_PATH}`);
  console.log(`  Phantoms written: ${PHANTOMS_PATH}`);
  console.log('════════════════════════════════════════════════════════════════');
}

// ---------------------------------------------------------------------------
// JSON serialization (bigint-safe)
// ---------------------------------------------------------------------------

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const started = Date.now();

  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  NVR Capital — On-Chain Event Indexer');
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`  Wallet:    ${BOT_WALLET}`);
  console.log(`  Network:   Base mainnet (chainId 8453)`);
  console.log('');

  const client = createBaseIndexerClient();
  const latest = await client.getBlockNumber();
  console.log(`  Latest block: ${latest.toString()}`);

  let fromBlock: bigint;
  if (process.env.INDEX_FROM_BLOCK) {
    fromBlock = BigInt(process.env.INDEX_FROM_BLOCK);
    console.log(`  Start block:  ${fromBlock.toString()} (from INDEX_FROM_BLOCK)`);
  } else {
    process.stdout.write(`  Resolving start block for 2026-02-15 ... `);
    fromBlock = await findBlockAtOrAfterTimestamp(client, FIRST_DEPOSIT_UNIX, latest);
    console.log(`${fromBlock.toString()} ✓`);
  }

  const toBlock = process.env.INDEX_TO_BLOCK ? BigInt(process.env.INDEX_TO_BLOCK) : latest;
  const chunkSize = process.env.INDEX_CHUNK_SIZE ? Number(process.env.INDEX_CHUNK_SIZE) : 10_000;
  const concurrency = process.env.INDEX_CONCURRENCY ? Number(process.env.INDEX_CONCURRENCY) : 4;

  console.log(`  Range:     ${fromBlock.toString()} → ${toBlock.toString()}  (${(toBlock - fromBlock).toLocaleString()} blocks)`);
  console.log(`  Chunk:     ${chunkSize.toLocaleString()} blocks × concurrency ${concurrency}`);
  console.log('');
  console.log('  Scanning...');

  let lastProgress = 0;
  const transfers = await indexBotWalletTransfers({
    wallet: BOT_WALLET,
    fromBlock,
    toBlock,
    chunkSize,
    concurrency,
    client,
    onProgress: (p) => {
      const pct = Number((p.scannedBlocks * 100n) / (p.totalBlocks || 1n));
      if (pct - lastProgress >= 5 || pct === 100) {
        lastProgress = pct;
        process.stdout.write(
          `\r  ${String(pct).padStart(3)}%  ${p.scannedBlocks.toLocaleString()} / ${p.totalBlocks.toLocaleString()} blocks  ·  ${p.transfersFound.toLocaleString()} transfers found         `,
        );
      }
    },
  });
  process.stdout.write('\n\n');

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(transfers, replacer, 2));

  const trades = loadTradeLog();
  const loggedTxs = buildLoggedTxSet(trades);
  const phantoms = findPhantomTransfers(transfers, loggedTxs);
  fs.writeFileSync(PHANTOMS_PATH, JSON.stringify(phantoms, replacer, 2));

  printSummary(transfers, trades, loggedTxs, phantoms);

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`  Completed in ${elapsed}s`);
  console.log('');
}

main().catch((e) => {
  console.error('');
  console.error('❌ Indexer failed:', e?.message ?? e);
  if (e?.stack) console.error(e.stack);
  process.exit(1);
});
