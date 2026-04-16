/**
 * NVR Capital — On-Chain Event Indexer
 *
 * Pulls every ERC-20 `Transfer` event touching a given wallet on Base mainnet
 * and produces a normalized `OnChainTransfer[]` ledger.
 *
 * Powers the cost-basis rebuild from ground truth. The bot's internal trade log
 * misses airdrops, unlogged swaps, direct transfers, and dust sweeps — this
 * indexer captures ALL token movements so we can reconstruct real cost basis.
 *
 * Uses viem `createPublicClient` + `getLogs` with the ERC-20 Transfer topic
 * filter, chunked to stay under RPC range limits, with in-memory metadata +
 * block-timestamp caching.
 */

import {
  createPublicClient,
  http,
  fallback,
  parseAbiItem,
  erc20Abi,
  getAddress,
  type Address,
  type PublicClient,
  type Log,
} from 'viem';
import { base } from 'viem/chains';
import { BASE_RPC_ENDPOINTS } from '../config/constants.js';

// ============================================================================
// TYPES
// ============================================================================

export interface OnChainTransfer {
  /** ISO-8601 timestamp of the block */
  timestamp: string;
  /** Block this transfer landed in */
  blockNumber: bigint;
  /** Log index within the block (used for stable ordering within a block) */
  logIndex: number;
  /** Transaction hash */
  txHash: string;
  /** Token that moved */
  token: {
    address: string;
    symbol: string;
    decimals: number;
  };
  /** IN = tokens entered the wallet, OUT = tokens left the wallet */
  direction: 'IN' | 'OUT';
  /** Counterparty sender */
  from: Address;
  /** Counterparty recipient */
  to: Address;
  /** Human-readable amount (post-decimals) */
  tokenAmount: number;
  /** Raw on-chain amount (wei-scale) */
  rawAmount: bigint;
}

export interface IndexerProgress {
  scannedBlocks: bigint;
  totalBlocks: bigint;
  transfersFound: number;
}

export interface IndexBotWalletTransfersParams {
  /** Wallet to index (bot wallet) */
  wallet: Address;
  /** First block to scan (inclusive) */
  fromBlock: bigint;
  /** Last block to scan (inclusive). Defaults to `latest` */
  toBlock?: bigint;
  /** Optional allow-list of token addresses (lowercased). Empty = all ERC-20s */
  tokenAllowlist?: string[];
  /** Blocks per `getLogs` call. Default 10_000 (public-RPC safe on Base) */
  chunkSize?: number;
  /** Parallel chunk fetches. Default 4 */
  concurrency?: number;
  /** Optional pre-built viem client (dependency injection for tests) */
  client?: PublicClient;
  /** Optional progress callback (fires after each chunk) */
  onProgress?: (p: IndexerProgress) => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_EVENT_ABI = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);

/** Default chunk size for `getLogs` — 10k blocks = ~5.5h on Base (2s blocks). */
export const DEFAULT_CHUNK_SIZE = 10_000n;

/** Parallel chunk fetches. Keep modest to avoid public-RPC rate limits. */
export const DEFAULT_CONCURRENCY = 4;

// ============================================================================
// CLIENT FACTORY
// ============================================================================

/**
 * RPC endpoints that are unsuitable for archival reads — they're tx-submission
 * relays (Flashbots Protect, sequencer-direct) that can return stale / partial
 * state for `eth_blockNumber` and `eth_getLogs`. The indexer filters these out
 * so historical queries go to archival-capable RPCs only.
 */
const SUBMIT_ONLY_RPC_HOSTS = [
  'rpc.flashbots.net',
  'mainnet-sequencer.base.org',
];

function isArchivalRpc(url: string): boolean {
  return !SUBMIT_ONLY_RPC_HOSTS.some((host) => url.includes(host));
}

/**
 * Build a viem public client for Base with fallback RPCs from the bot's config.
 * Mirrors the multi-endpoint pattern used by `rpcCall`, but filters out
 * submit-only relays which don't serve archival `eth_getLogs` queries.
 */
export function createBaseIndexerClient(
  endpoints: readonly string[] = BASE_RPC_ENDPOINTS,
): PublicClient {
  const archival = endpoints.filter(isArchivalRpc);
  if (archival.length === 0) {
    throw new Error(
      'createBaseIndexerClient: no archival-capable RPC endpoints (all are submit-only relays)',
    );
  }
  const transport = archival.length === 1
    ? http(archival[0], { timeout: 30_000 })
    : fallback(
        archival.map((url) => http(url, { timeout: 30_000 })),
        { rank: false, retryCount: 2 },
      );

  return createPublicClient({ chain: base, transport }) as PublicClient;
}

// ============================================================================
// METADATA CACHE
// ============================================================================

type TokenMeta = { address: string; symbol: string; decimals: number };
type TokenMetaCache = Map<string, TokenMeta>;

/**
 * Fetch `symbol` and `decimals` for every token address referenced in `logs`,
 * caching results. Gracefully handles tokens with non-standard metadata
 * (returns `UNKNOWN` / `18` fallbacks rather than throwing).
 */
export async function resolveTokenMetadata(
  client: PublicClient,
  tokenAddresses: string[],
  cache: TokenMetaCache = new Map(),
  concurrency = 8,
): Promise<TokenMetaCache> {
  const toFetch = [...new Set(tokenAddresses.map((a) => a.toLowerCase()))]
    .filter((a) => !cache.has(a));

  for (let i = 0; i < toFetch.length; i += concurrency) {
    const batch = toFetch.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (addr) => {
        const address = getAddress(addr);
        const [symbolResult, decimalsResult] = await Promise.allSettled([
          // viem's readContract has a strict parameter type that trips tsc here
          // due to generic narrowing. Cast is safe: return values are guarded
          // by typeof checks immediately after.
          (client as any).readContract({ address, abi: erc20Abi, functionName: 'symbol' }),
          (client as any).readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
        ]);
        const symbol =
          symbolResult.status === 'fulfilled' && typeof symbolResult.value === 'string'
            ? symbolResult.value
            : 'UNKNOWN';
        const decimals =
          decimalsResult.status === 'fulfilled' && typeof decimalsResult.value === 'number'
            ? decimalsResult.value
            : 18;
        return { address: addr, meta: { address: addr, symbol, decimals } };
      }),
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled') {
        cache.set(r.value.address, r.value.meta);
      } else {
        cache.set(batch[j], { address: batch[j], symbol: 'UNKNOWN', decimals: 18 });
      }
    }
  }

  return cache;
}

// ============================================================================
// BLOCK TIMESTAMP CACHE
// ============================================================================

type BlockTimestampCache = Map<bigint, number>;

/**
 * Fetch block timestamps (unix seconds) for every block number referenced,
 * caching results. Uses concurrent `getBlock` calls in batches.
 */
export async function resolveBlockTimestamps(
  client: PublicClient,
  blockNumbers: bigint[],
  cache: BlockTimestampCache = new Map(),
  concurrency = 20,
): Promise<BlockTimestampCache> {
  const toFetch = [...new Set(blockNumbers.map((b) => b.toString()))]
    .map((s) => BigInt(s))
    .filter((b) => !cache.has(b));

  for (let i = 0; i < toFetch.length; i += concurrency) {
    const batch = toFetch.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((bn) =>
        client.getBlock({ blockNumber: bn, includeTransactions: false }),
      ),
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled') {
        cache.set(batch[j], Number(r.value.timestamp));
      }
    }
  }

  return cache;
}

// ============================================================================
// CHUNKED LOG FETCH
// ============================================================================

interface ChunkRange {
  from: bigint;
  to: bigint;
}

/** Break [fromBlock, toBlock] into ≤chunkSize-block windows. */
export function buildChunks(
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize: bigint,
): ChunkRange[] {
  if (toBlock < fromBlock) return [];
  const chunks: ChunkRange[] = [];
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const end = cursor + chunkSize - 1n;
    chunks.push({ from: cursor, to: end > toBlock ? toBlock : end });
    cursor = end + 1n;
  }
  return chunks;
}

type RawTransferLog = Log<bigint, number, false, typeof TRANSFER_EVENT_ABI, true>;

/**
 * Pull ERC-20 `Transfer` logs across [fromBlock, toBlock] where `wallet` is
 * either the sender (OUT) or receiver (IN). Chunked + parallelized.
 *
 * Filters to 3-topic logs only (ERC-20). 4-topic Transfer logs (ERC-721) are
 * dropped automatically because the event ABI requires a non-indexed `value`.
 */
export async function fetchTransferLogs(
  client: PublicClient,
  wallet: Address,
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize: bigint,
  concurrency: number,
  tokenAllowlist?: string[],
  onProgress?: (p: IndexerProgress) => void,
): Promise<RawTransferLog[]> {
  const chunks = buildChunks(fromBlock, toBlock, chunkSize);
  const allowSet = tokenAllowlist && tokenAllowlist.length > 0
    ? new Set(tokenAllowlist.map((a) => a.toLowerCase()))
    : null;

  const all: RawTransferLog[] = [];
  const totalBlocks = toBlock - fromBlock + 1n;
  let scanned = 0n;

  let nextIdx = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIdx++;
      if (idx >= chunks.length) return;
      const { from, to } = chunks[idx];
      const [inLogs, outLogs] = await Promise.all([
        client.getLogs({
          event: TRANSFER_EVENT_ABI,
          args: { to: wallet },
          fromBlock: from,
          toBlock: to,
          strict: true,
        }),
        client.getLogs({
          event: TRANSFER_EVENT_ABI,
          args: { from: wallet },
          fromBlock: from,
          toBlock: to,
          strict: true,
        }),
      ]);
      const chunkLogs = ([...inLogs, ...outLogs] as RawTransferLog[]).filter((log) => {
        if (!allowSet) return true;
        return allowSet.has(log.address.toLowerCase());
      });
      all.push(...chunkLogs);
      scanned += to - from + 1n;
      if (onProgress) {
        onProgress({ scannedBlocks: scanned, totalBlocks, transfersFound: all.length });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, chunks.length)) }, () => worker()),
  );

  return all;
}

// ============================================================================
// NORMALIZATION
// ============================================================================

/**
 * Convert raw viem logs → normalized `OnChainTransfer` records.
 * Requires pre-populated token metadata + block timestamp caches.
 */
export function normalizeTransferLogs(
  logs: RawTransferLog[],
  wallet: Address,
  tokenMeta: TokenMetaCache,
  blockTs: BlockTimestampCache,
): OnChainTransfer[] {
  const walletLower = wallet.toLowerCase();
  const out: OnChainTransfer[] = [];

  for (const log of logs) {
    const args = log.args as { from?: Address; to?: Address; value?: bigint } | undefined;
    if (!args || args.from === undefined || args.to === undefined || args.value === undefined) {
      continue;
    }
    if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) {
      continue;
    }

    const tokenAddr = log.address.toLowerCase();
    const meta = tokenMeta.get(tokenAddr) ?? {
      address: tokenAddr,
      symbol: 'UNKNOWN',
      decimals: 18,
    };

    const fromLower = args.from.toLowerCase();
    const toLower = args.to.toLowerCase();

    let direction: 'IN' | 'OUT';
    if (toLower === walletLower && fromLower !== walletLower) direction = 'IN';
    else if (fromLower === walletLower && toLower !== walletLower) direction = 'OUT';
    else continue; // self-transfer or unrelated

    const rawAmount = args.value;
    const tokenAmount = Number(rawAmount) / 10 ** meta.decimals;

    const tsSec = blockTs.get(log.blockNumber);
    const timestamp = tsSec !== undefined
      ? new Date(tsSec * 1000).toISOString()
      : new Date(0).toISOString();

    out.push({
      timestamp,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      txHash: log.transactionHash,
      token: meta,
      direction,
      from: args.from,
      to: args.to,
      tokenAmount,
      rawAmount,
    });
  }

  out.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
    return a.logIndex - b.logIndex;
  });

  return out;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * End-to-end: pull every ERC-20 `Transfer` event touching `wallet` between
 * `fromBlock` and `toBlock`, resolve token metadata + block timestamps, and
 * return a chronologically-sorted `OnChainTransfer[]` ledger.
 */
export async function indexBotWalletTransfers(
  params: IndexBotWalletTransfersParams,
): Promise<OnChainTransfer[]> {
  const client = params.client ?? createBaseIndexerClient();
  const chunkSize = params.chunkSize !== undefined ? BigInt(params.chunkSize) : DEFAULT_CHUNK_SIZE;
  const concurrency = params.concurrency ?? DEFAULT_CONCURRENCY;

  const toBlock = params.toBlock ?? (await client.getBlockNumber());

  const logs = await fetchTransferLogs(
    client,
    params.wallet,
    params.fromBlock,
    toBlock,
    chunkSize,
    concurrency,
    params.tokenAllowlist,
    params.onProgress,
  );

  const tokenMeta = await resolveTokenMetadata(
    client,
    logs.map((l) => l.address),
  );

  const blockTs = await resolveBlockTimestamps(
    client,
    logs.map((l) => l.blockNumber).filter((b): b is bigint => b !== null),
  );

  return normalizeTransferLogs(logs, params.wallet, tokenMeta, blockTs);
}

// ============================================================================
// START-BLOCK HELPERS
// ============================================================================

/** Base mainnet produces one block every ~2 seconds. */
const BASE_AVG_BLOCK_SECONDS = 2;

/**
 * Ask Blockscout for the block number at or just after `targetUnixSec`.
 * Fast (single HTTP call) and reliable — Blockscout has a dedicated
 * `getblocknobytime` endpoint. Returns `null` if the API is unreachable or
 * returns an unexpected response, so callers can fall back.
 */
async function findBlockViaBlockscout(targetUnixSec: number): Promise<bigint | null> {
  try {
    const url = `https://base.blockscout.com/api?module=block&action=getblocknobytime&timestamp=${targetUnixSec}&closest=after`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const json = await res.json() as { status?: string; result?: string | { blockNumber?: string } };
    const raw = typeof json.result === 'string' ? json.result : json.result?.blockNumber;
    if (!raw) return null;
    const num = BigInt(raw);
    return num > 0n ? num : null;
  } catch {
    return null;
  }
}

/**
 * Find the first block with `timestamp >= targetUnixSec`.
 *
 * Strategy:
 *   1. Try Blockscout's `getblocknobytime` API (single HTTP call, reliable).
 *   2. If that fails, narrow the search range via 2s-block arithmetic, then
 *      binary-search within that narrow window. This avoids probing
 *      genesis-era blocks on public RPCs that don't serve deep archives.
 */
export async function findBlockAtOrAfterTimestamp(
  client: PublicClient,
  targetUnixSec: number,
  hintBlock?: bigint,
): Promise<bigint> {
  const blockscout = await findBlockViaBlockscout(targetUnixSec);
  if (blockscout !== null) return blockscout;

  const latestBlockNum = hintBlock ?? (await client.getBlockNumber());
  const latestBlock = await client.getBlock({ blockNumber: latestBlockNum });
  const latestTs = Number(latestBlock.timestamp);

  if (latestTs < targetUnixSec) return latestBlockNum;

  // Arithmetic estimate: latest - (latestTs - target)/2s. Widen by ±1 day
  // (43_200 blocks) to absorb block-time jitter, then binary-search that window.
  const secondsBack = latestTs - targetUnixSec;
  const approxBack = BigInt(Math.ceil(secondsBack / BASE_AVG_BLOCK_SECONDS));
  const oneDayBlocks = BigInt(Math.ceil((24 * 3600) / BASE_AVG_BLOCK_SECONDS));

  let lo = approxBack > latestBlockNum ? 0n : latestBlockNum - approxBack;
  lo = lo > oneDayBlocks ? lo - oneDayBlocks : 0n;
  let hi = latestBlockNum - approxBack + oneDayBlocks;
  if (hi > latestBlockNum) hi = latestBlockNum;

  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const block = await client.getBlock({ blockNumber: mid, includeTransactions: false });
    if (Number(block.timestamp) < targetUnixSec) lo = mid + 1n;
    else hi = mid;
  }
  return lo;
}
