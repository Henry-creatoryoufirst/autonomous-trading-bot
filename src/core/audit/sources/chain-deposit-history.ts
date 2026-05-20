/**
 * NVR-SPEC-035 Phase A.1 — chain-deposit history fetcher.
 *
 * Pulls USDC Transfer events INTO the wallet across all of chain history,
 * filters out swap-router proceeds + dust, sums what remains. That sum is
 * the actual on-chain deposit total — independent of whatever the bot
 * thinks `state.totalDeposited` is.
 *
 * INV-11 (chain-deposit-reconciliation) consumes this. The case-study
 * scenario: Zack funded $1,000 to the OLD wallet on March 18, the bot
 * rotated wallets on April 17, only $846 forwarded to the new wallet,
 * the bot's `totalDeposited` reset to $846 at the new wallet. Real
 * lifetime loss was $300 (-30%) but bot reported $128 (-15%). INV-11
 * with this source catches that class of drift.
 *
 * Implementation:
 *   - eth_getLogs against USDC contract for Transfer events where to=wallet
 *   - Chunked block ranges to avoid RPC limits (~10K blocks per chunk on Base)
 *   - Filters out known swap routers (Aerodrome) + dust < $1
 *   - Returns sum + per-deposit detail so INV-11 can name the missing ones
 *
 * Cost: ~50-100 RPC calls for a full historical scan (Base has been alive
 * for ~600 days, ~30M blocks). Cache the result and re-scan only
 * incrementally on subsequent calls.
 */

import { rpcCall } from '../../execution/rpc.js';

const USDC_BASE_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Known swap-router / non-deposit sources to exclude from the "deposit" tally.
// Inflows from these are swap proceeds, not capital deposits.
const SWAP_ROUTERS_LOWERCASE: ReadonlyArray<string> = [
  '0x7747f8d2a76bd6345cc29622a946a929647f2359', // Aerodrome Universal Router
];

const DEPOSIT_DUST_THRESHOLD_USD = 1.0;
const BLOCKS_PER_CHUNK = 10_000;

export interface DepositRecord {
  blockNumber: number;
  txHash: string;
  fromAddress: string;
  usdValue: number;
}

export interface ChainDepositHistory {
  walletAddress: string;
  capturedAt: string;
  /** Sum of all non-router, > $1 USDC inflows since the wallet's first block. */
  totalDepositedUsd: number;
  /** Per-deposit list, most recent first, capped at 50 for memory. */
  deposits: DepositRecord[];
  /** Highest block number we scanned to. Used for incremental updates. */
  lastScannedBlock: number;
  /** True iff the full historical scan completed without RPC errors. */
  complete: boolean;
  errors: string[];
}

function padTopic(addr: string): string {
  return '0x000000000000000000000000' + addr.toLowerCase().replace(/^0x/, '');
}

function blockToHex(b: number): string {
  return '0x' + b.toString(16);
}

/**
 * Pull all USDC inflows to the wallet across chain history. Chunks the
 * scan to stay under Base RPC's per-query log limits.
 *
 * @param walletAddress  The wallet to scan (typically CONFIG.walletAddress)
 * @param fromBlock      Starting block. Pass 0 for "from genesis" or
 *                       lastScannedBlock + 1 for incremental updates.
 */
export async function fetchChainDepositHistory(args: {
  walletAddress: string;
  fromBlock?: number;
  /** Optional cap on history depth — useful for tests. Default: full history. */
  maxBlocksBack?: number;
}): Promise<ChainDepositHistory> {
  const { walletAddress, fromBlock = 0, maxBlocksBack } = args;
  const errors: string[] = [];
  const deposits: DepositRecord[] = [];
  const walletTopic = padTopic(walletAddress);

  let latestBlock: number;
  try {
    const latestHex = await rpcCall('eth_blockNumber', []);
    latestBlock = parseInt(latestHex, 16);
  } catch (err: unknown) {
    return {
      walletAddress,
      capturedAt: new Date().toISOString(),
      totalDepositedUsd: 0,
      deposits: [],
      lastScannedBlock: fromBlock,
      complete: false,
      errors: [`eth_blockNumber: ${(err as Error).message?.slice(0, 100)}`],
    };
  }

  const startBlock = maxBlocksBack
    ? Math.max(fromBlock, latestBlock - maxBlocksBack)
    : fromBlock;
  let cursor = startBlock;

  while (cursor <= latestBlock) {
    const chunkEnd = Math.min(cursor + BLOCKS_PER_CHUNK - 1, latestBlock);
    try {
      const logs = await rpcCall('eth_getLogs', [{
        address: USDC_BASE_CONTRACT,
        fromBlock: blockToHex(cursor),
        toBlock: blockToHex(chunkEnd),
        topics: [TRANSFER_TOPIC, null, walletTopic], // null = any sender, walletTopic = to=wallet
      }]);
      if (Array.isArray(logs)) {
        for (const log of logs) {
          const valHex = log.data || '0x0';
          const rawValue = BigInt(valHex);
          const usdValue = Number(rawValue) / 10 ** 6;
          const fromAddr = '0x' + (log.topics?.[1] ?? '').slice(-40).toLowerCase();
          if (SWAP_ROUTERS_LOWERCASE.includes(fromAddr)) continue;
          if (usdValue < DEPOSIT_DUST_THRESHOLD_USD) continue;
          deposits.push({
            blockNumber: parseInt(log.blockNumber, 16),
            txHash: log.transactionHash,
            fromAddress: fromAddr,
            usdValue,
          });
        }
      }
    } catch (err: unknown) {
      errors.push(`chunk ${cursor}-${chunkEnd}: ${(err as Error).message?.slice(0, 80)}`);
      // Don't break — keep scanning; partial coverage is better than none.
    }
    cursor = chunkEnd + 1;
  }

  // Sort deposits most-recent first; cap list at 50 to avoid bloating
  // persisted state on long-history wallets.
  deposits.sort((a, b) => b.blockNumber - a.blockNumber);
  const cappedDeposits = deposits.slice(0, 50);
  const totalDepositedUsd = deposits.reduce((sum, d) => sum + d.usdValue, 0);

  return {
    walletAddress,
    capturedAt: new Date().toISOString(),
    totalDepositedUsd,
    deposits: cappedDeposits,
    lastScannedBlock: latestBlock,
    complete: errors.length === 0,
    errors,
  };
}
