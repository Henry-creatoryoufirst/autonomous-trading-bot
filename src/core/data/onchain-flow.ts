/**
 * NVR Capital — On-Chain Swap Event Flow Engine (Stream S)
 *
 * Phase 2 of the architectural pivot started by Stream R (on-chain prices).
 * Reads the alpha-watcher's flow data (h1/h24 buys/sells/volume, m5/h1/h24
 * price change) directly from Base via Swap event logs. After this lands,
 * the cohort's GeckoTerminal calls become OPTIONAL fallback — the bot reads
 * Base directly for everything it tracks in the cohort.
 *
 * Why on-chain:
 *   - GT's free tier is rate-limited + CDN-cached; flow numbers can be
 *     90+ seconds stale by the time we read them.
 *   - Stream R already reads pool prices in ~100ms per token. The Swap
 *     events backing those pools tell us the WHOLE story (buys, sells,
 *     volume, who's pressing) at the same resolution.
 *   - Free Base public RPC handles this comfortably with caching.
 *
 * RPC budget per alpha-watcher tick (15 cohort tokens, post-Stream-R):
 *   - Stream R prices: ~16 calls
 *   - This stream's h1+m5 (derived from one h1 logs fetch per pool):
 *     ~15 calls
 *   - This stream's h24 (cached 5min, ~9 chunks per pool when refreshing):
 *     ~135 calls amortized over 5 min = ~27 calls/min average
 *   Total: ~30–50 calls per tick. Well within Base public RPC limits, and
 *   the bot has fallback RPCs configured in chain-config.
 *
 * Behind ALPHA_WATCHER_ONCHAIN_FLOW env flag (default OFF). Flip on after
 * staging soak verifies on-chain flow tracks GeckoTerminal flow within
 * tolerance.
 */

import { rpcCall } from '../execution/rpc.js';
import { decodeSqrtPriceX96 } from '../../algorithm/indicators.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Uniswap V3 / Aerodrome Slipstream Swap event topic */
export const V3_SWAP_TOPIC =
  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';

/** Uniswap V2 / Aerodrome V1 Swap event topic */
export const V2_SWAP_TOPIC =
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';

/** Base L2 block time (seconds) */
export const BASE_BLOCK_TIME_SEC = 2;

/** Block-window sizes at Base's 2-second cadence */
export const BLOCKS_PER_M5 = 150;
export const BLOCKS_PER_H1 = 1800;
export const BLOCKS_PER_H24 = 43200;

/** Safe per-call block range for eth_getLogs on public RPCs */
export const ETH_GETLOGS_MAX_RANGE = 5000;

/** Refresh cadences */
const H1_REFRESH_MS = 25_000; // shorter than the 30s alpha-watcher tick
const H24_REFRESH_MS = 5 * 60_000; // 5 min — h24 is expensive

/** Cap on absolute USD value of a single swap to filter decoding glitches */
const MAX_SANE_SWAP_USD = 10_000_000;

// ============================================================================
// TYPES
// ============================================================================

export type PoolType = 'uniswapV3' | 'aerodromeV3' | 'aerodrome';
export type QuoteToken = 'WETH' | 'USDC' | 'cbBTC' | 'VIRTUAL';

export interface PoolDescriptor {
  poolAddress: string;
  poolType: PoolType;
  token0IsBase: boolean;
  token0Decimals: number;
  token1Decimals: number;
  quoteToken: QuoteToken;
}

export interface RawSwapLog {
  blockNumber: string; // hex
  transactionHash: string;
  logIndex: string; // hex
  data: string; // hex, 0x-prefixed
  topics: string[];
}

/** Pool-shaped raw swap event (decoded but not yet classified/priced) */
export interface DecodedSwap {
  blockNumber: number;
  txHash: string;
  logIndex: number;
  // V3 fields
  amount0?: bigint;
  amount1?: bigint;
  sqrtPriceX96?: bigint;
  // V2 fields
  amount0In?: bigint;
  amount1In?: bigint;
  amount0Out?: bigint;
  amount1Out?: bigint;
}

/** A swap that has been classified (buy/sell) and valued in USD */
export interface ClassifiedSwap {
  blockNumber: number;
  isBuy: boolean;
  /** USD value of the base-token side of the swap at current spot */
  swapValueUSD: number;
  /** Execution price of the base token in USD at the time of this swap */
  executionPriceUSD: number;
}

/** Aggregated flow over a time window */
export interface AggregatedFlow {
  buys: number;
  sells: number;
  buyVolumeUSD: number;
  sellVolumeUSD: number;
  volumeUSD: number;
  avgTradeUSD: number;
  firstPriceUSD: number | null;
  lastPriceUSD: number | null;
}

/** Public result shape — alpha-watcher overlays these onto the GT pool object */
export interface OnChainFlowResult {
  transactions: {
    h1: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h1: number;
    h24: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h24: number;
  };
  /** Diagnostics */
  diagnostics: {
    swapsH1: number;
    swapsH24: number;
    h1FetchedAt: number;
    h24FetchedAt: number;
    /** True iff h1 logs covered the full BLOCKS_PER_H1 range (no RPC error) */
    h1Complete: boolean;
    /** True iff h24 logs covered the full BLOCKS_PER_H24 range */
    h24Complete: boolean;
  };
}

// ============================================================================
// SHARED HELPERS
// ============================================================================

function parseSigned256(hex: string): bigint {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const val = BigInt('0x' + clean);
  return val > BigInt('0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')
    ? val -
        BigInt(
          '0x10000000000000000000000000000000000000000000000000000000000000000',
        )
    : val;
}

function parseUnsigned256(hex: string): bigint {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return BigInt('0x' + clean);
}

function toBlockHex(n: number): string {
  return '0x' + Math.max(0, Math.floor(n)).toString(16);
}

// ============================================================================
// DECODERS
// ============================================================================

/**
 * Decode a V3 Swap event log.
 *   event Swap(
 *     address indexed sender,
 *     address indexed recipient,
 *     int256 amount0,
 *     int256 amount1,
 *     uint160 sqrtPriceX96,
 *     uint128 liquidity,
 *     int24 tick
 *   )
 * data = amount0 ‖ amount1 ‖ sqrtPriceX96 ‖ liquidity ‖ tick (5 × 32 bytes)
 */
export function decodeV3SwapLog(log: RawSwapLog): DecodedSwap | null {
  try {
    if (!log.data || log.data.length < 2 + 320) return null;
    const data = log.data.slice(2);
    const amount0 = parseSigned256(data.slice(0, 64));
    const amount1 = parseSigned256(data.slice(64, 128));
    const sqrtPriceX96 = parseUnsigned256(data.slice(128, 192));
    return {
      blockNumber: parseInt(log.blockNumber, 16),
      txHash: log.transactionHash,
      logIndex: parseInt(log.logIndex, 16),
      amount0,
      amount1,
      sqrtPriceX96,
    };
  } catch {
    return null;
  }
}

/**
 * Decode a V2 Swap event log.
 *   event Swap(
 *     address indexed sender,
 *     uint256 amount0In,
 *     uint256 amount1In,
 *     uint256 amount0Out,
 *     uint256 amount1Out,
 *     address indexed to
 *   )
 * data = amount0In ‖ amount1In ‖ amount0Out ‖ amount1Out (4 × 32 bytes)
 */
export function decodeV2SwapLog(log: RawSwapLog): DecodedSwap | null {
  try {
    if (!log.data || log.data.length < 2 + 256) return null;
    const data = log.data.slice(2);
    return {
      blockNumber: parseInt(log.blockNumber, 16),
      txHash: log.transactionHash,
      logIndex: parseInt(log.logIndex, 16),
      amount0In: parseUnsigned256(data.slice(0, 64)),
      amount1In: parseUnsigned256(data.slice(64, 128)),
      amount0Out: parseUnsigned256(data.slice(128, 192)),
      amount1Out: parseUnsigned256(data.slice(192, 256)),
    };
  } catch {
    return null;
  }
}

// ============================================================================
// PRICE EXTRACTION
// ============================================================================

/**
 * V3 swap event includes sqrtPriceX96 — the pool price AFTER the swap.
 * Convert to base-token USD price using quoteTokenPriceUSD.
 */
export function v3SwapPriceUSD(
  swap: DecodedSwap,
  pool: Pick<
    PoolDescriptor,
    'token0IsBase' | 'token0Decimals' | 'token1Decimals'
  >,
  quoteTokenPriceUSD: number,
): number {
  if (swap.sqrtPriceX96 === undefined || swap.sqrtPriceX96 === 0n) return 0;
  const sqrtHex = swap.sqrtPriceX96.toString(16).padStart(64, '0');
  const token1PerToken0 = decodeSqrtPriceX96(
    sqrtHex,
    pool.token0Decimals,
    pool.token1Decimals,
  );
  if (token1PerToken0 <= 0 || !isFinite(token1PerToken0)) return 0;
  const basePriceInQuote = pool.token0IsBase
    ? token1PerToken0
    : 1 / token1PerToken0;
  const priceUSD = basePriceInQuote * quoteTokenPriceUSD;
  return isFinite(priceUSD) && priceUSD > 0 ? priceUSD : 0;
}

/**
 * V2 swap doesn't carry sqrtPriceX96 — derive the trade-execution price from
 * the actual amounts swapped. Only one side has nonzero In, the other Out.
 */
export function v2SwapPriceUSD(
  swap: DecodedSwap,
  pool: Pick<
    PoolDescriptor,
    'token0IsBase' | 'token0Decimals' | 'token1Decimals'
  >,
  quoteTokenPriceUSD: number,
): number {
  const a0In = swap.amount0In ?? 0n;
  const a1In = swap.amount1In ?? 0n;
  const a0Out = swap.amount0Out ?? 0n;
  const a1Out = swap.amount1Out ?? 0n;

  let token0Amt = 0;
  let token1Amt = 0;
  if (a0In > 0n && a1Out > 0n) {
    token0Amt = Number(a0In) / 10 ** pool.token0Decimals;
    token1Amt = Number(a1Out) / 10 ** pool.token1Decimals;
  } else if (a1In > 0n && a0Out > 0n) {
    token0Amt = Number(a0Out) / 10 ** pool.token0Decimals;
    token1Amt = Number(a1In) / 10 ** pool.token1Decimals;
  } else {
    return 0;
  }
  if (token0Amt <= 0 || token1Amt <= 0) return 0;

  const token1PerToken0 = token1Amt / token0Amt;
  const basePriceInQuote = pool.token0IsBase
    ? token1PerToken0
    : 1 / token1PerToken0;
  const priceUSD = basePriceInQuote * quoteTokenPriceUSD;
  return isFinite(priceUSD) && priceUSD > 0 ? priceUSD : 0;
}

// ============================================================================
// CLASSIFICATION
// ============================================================================

/**
 * Classify a decoded swap into BUY/SELL of the base token and value it in
 * USD using the current spot price. Returns null if the swap is malformed or
 * the computed value is implausibly large (decode-glitch sentinel).
 */
export function classifySwap(
  swap: DecodedSwap,
  pool: PoolDescriptor,
  currentTokenPriceUSD: number,
  quoteTokenPriceUSD: number,
): ClassifiedSwap | null {
  if (currentTokenPriceUSD <= 0) return null;

  let isBuy: boolean;
  let baseAmountRaw: bigint;

  const isV3 = pool.poolType === 'uniswapV3' || pool.poolType === 'aerodromeV3';

  if (isV3) {
    if (swap.amount0 === undefined || swap.amount1 === undefined) return null;
    if (pool.token0IsBase) {
      // amount0 < 0 means token0 left the pool → buyer received base → BUY
      isBuy = swap.amount0 < 0n;
      baseAmountRaw = swap.amount0 < 0n ? -swap.amount0 : swap.amount0;
    } else {
      isBuy = swap.amount1 < 0n;
      baseAmountRaw = swap.amount1 < 0n ? -swap.amount1 : swap.amount1;
    }
  } else {
    const a0In = swap.amount0In ?? 0n;
    const a1In = swap.amount1In ?? 0n;
    const a0Out = swap.amount0Out ?? 0n;
    const a1Out = swap.amount1Out ?? 0n;
    if (pool.token0IsBase) {
      // base = token0. Out > 0 → base left pool → BUY; In > 0 → base entered → SELL
      if (a0Out > 0n) {
        isBuy = true;
        baseAmountRaw = a0Out;
      } else if (a0In > 0n) {
        isBuy = false;
        baseAmountRaw = a0In;
      } else {
        return null;
      }
    } else {
      if (a1Out > 0n) {
        isBuy = true;
        baseAmountRaw = a1Out;
      } else if (a1In > 0n) {
        isBuy = false;
        baseAmountRaw = a1In;
      } else {
        return null;
      }
    }
  }

  const baseDecimals = pool.token0IsBase
    ? pool.token0Decimals
    : pool.token1Decimals;
  const baseAmount = Number(baseAmountRaw) / 10 ** baseDecimals;
  const swapValueUSD = baseAmount * currentTokenPriceUSD;
  if (!isFinite(swapValueUSD) || swapValueUSD <= 0) return null;
  if (swapValueUSD > MAX_SANE_SWAP_USD) return null;

  const executionPriceUSD = isV3
    ? v3SwapPriceUSD(swap, pool, quoteTokenPriceUSD)
    : v2SwapPriceUSD(swap, pool, quoteTokenPriceUSD);

  return {
    blockNumber: swap.blockNumber,
    isBuy,
    swapValueUSD,
    executionPriceUSD,
  };
}

// ============================================================================
// AGGREGATION
// ============================================================================

/**
 * Aggregate a sorted-by-block list of classified swaps over a window. The
 * caller is responsible for pre-filtering to the desired block range — this
 * function just sums.
 *
 * `firstPriceUSD` / `lastPriceUSD` are pulled from the earliest / latest
 * swap that produced a positive execution price. They may be null if the
 * window is empty or no swap yielded a valid price.
 */
export function aggregateSwaps(swaps: ClassifiedSwap[]): AggregatedFlow {
  let buys = 0;
  let sells = 0;
  let buyVolumeUSD = 0;
  let sellVolumeUSD = 0;
  let firstPriceUSD: number | null = null;
  let lastPriceUSD: number | null = null;
  let firstBlock = Infinity;
  let lastBlock = -Infinity;

  for (const s of swaps) {
    if (s.isBuy) {
      buys++;
      buyVolumeUSD += s.swapValueUSD;
    } else {
      sells++;
      sellVolumeUSD += s.swapValueUSD;
    }
    if (s.executionPriceUSD > 0) {
      if (s.blockNumber < firstBlock) {
        firstBlock = s.blockNumber;
        firstPriceUSD = s.executionPriceUSD;
      }
      if (s.blockNumber > lastBlock) {
        lastBlock = s.blockNumber;
        lastPriceUSD = s.executionPriceUSD;
      }
    }
  }

  const tradeCount = buys + sells;
  const volumeUSD = buyVolumeUSD + sellVolumeUSD;
  const avgTradeUSD = tradeCount > 0 ? volumeUSD / tradeCount : 0;
  return {
    buys,
    sells,
    buyVolumeUSD,
    sellVolumeUSD,
    volumeUSD,
    avgTradeUSD,
    firstPriceUSD,
    lastPriceUSD,
  };
}

/**
 * Filter classified swaps to those at or after a minimum block number.
 * Used to derive m5 from a h1 log fetch (or h1 from a h24 fetch).
 */
export function filterSwapsByMinBlock(
  swaps: ClassifiedSwap[],
  minBlock: number,
): ClassifiedSwap[] {
  return swaps.filter((s) => s.blockNumber >= minBlock);
}

// ============================================================================
// RPC: SWAP EVENT LOG FETCH
// ============================================================================

/**
 * Fetch raw Swap event logs for a pool over the specified block range. Chunks
 * the request to stay under ETH_GETLOGS_MAX_RANGE. Returns concatenated logs
 * in ascending block order, plus a `complete` flag — false iff any chunk
 * errored (so the caller knows the aggregation is partial).
 */
export async function fetchSwapEventsForPool(
  poolAddress: string,
  fromBlock: number,
  toBlock: number,
  poolType: PoolType,
): Promise<{ logs: RawSwapLog[]; complete: boolean }> {
  const topic =
    poolType === 'uniswapV3' || poolType === 'aerodromeV3'
      ? V3_SWAP_TOPIC
      : V2_SWAP_TOPIC;

  const span = Math.max(0, toBlock - fromBlock);
  const chunkCount = Math.ceil((span + 1) / ETH_GETLOGS_MAX_RANGE);
  const out: RawSwapLog[] = [];
  let complete = true;

  for (let i = 0; i < chunkCount; i++) {
    const chunkFrom = fromBlock + i * ETH_GETLOGS_MAX_RANGE;
    const chunkTo = Math.min(
      toBlock,
      chunkFrom + ETH_GETLOGS_MAX_RANGE - 1,
    );
    try {
      const logs = await rpcCall('eth_getLogs', [
        {
          address: poolAddress,
          topics: [topic],
          fromBlock: toBlockHex(chunkFrom),
          toBlock: toBlockHex(chunkTo),
        },
      ]);
      if (Array.isArray(logs)) {
        for (const l of logs) out.push(l as RawSwapLog);
      }
    } catch {
      complete = false;
      // Continue — the other chunks may still succeed.
    }
  }
  return { logs: out, complete };
}

// ============================================================================
// PER-POOL CACHE
// ============================================================================

interface PoolFlowCacheEntry {
  /** Classified swaps over the last h1 window (ascending block order) */
  h1Swaps: ClassifiedSwap[];
  /** Classified swaps over the last h24 window (ascending block order) */
  h24Swaps: ClassifiedSwap[];
  h1FetchedAt: number;
  h24FetchedAt: number;
  h1Complete: boolean;
  h24Complete: boolean;
  /** Block at fetch time — for windowing math */
  h1RefBlock: number;
  h24RefBlock: number;
}

const poolFlowCache = new Map<string, PoolFlowCacheEntry>();

/** For tests / diagnostics */
export function _clearOnchainFlowCache() {
  poolFlowCache.clear();
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Compute on-chain flow metrics for a single pool. Uses cached results when
 * fresh (h1 every 25s, h24 every 5min). Returns null only if every RPC path
 * failed and there is nothing usable to return.
 *
 * Caller passes:
 *   - the pool descriptor (from getPoolRegistry()[symbol])
 *   - current base-token spot price in USD (from Stream R's on-chain price)
 *   - current quote-token price in USD (e.g. ETH price for WETH-quoted pools)
 *   - the latest block number (one eth_blockNumber per tick, shared by caller)
 *
 * Returns the buys/sells/volume/price-change shape the alpha-watcher needs.
 */
export async function getOnChainFlow(
  symbol: string,
  pool: PoolDescriptor,
  currentTokenPriceUSD: number,
  quoteTokenPriceUSD: number,
  currentBlock: number,
): Promise<OnChainFlowResult | null> {
  if (currentTokenPriceUSD <= 0 || currentBlock <= 0) return null;

  const key = pool.poolAddress.toLowerCase();
  const now = Date.now();
  let entry = poolFlowCache.get(key);

  // Refresh h1 if stale
  if (!entry || now - entry.h1FetchedAt >= H1_REFRESH_MS) {
    const fromBlock = Math.max(0, currentBlock - BLOCKS_PER_H1);
    const { logs, complete } = await fetchSwapEventsForPool(
      pool.poolAddress,
      fromBlock,
      currentBlock,
      pool.poolType,
    );
    const decoded = decodeAndClassify(
      logs,
      pool,
      currentTokenPriceUSD,
      quoteTokenPriceUSD,
    );
    // Ascending block order — eth_getLogs returns chronological per chunk
    decoded.sort((a, b) => a.blockNumber - b.blockNumber);

    if (!entry) {
      entry = {
        h1Swaps: decoded,
        h24Swaps: [],
        h1FetchedAt: now,
        h24FetchedAt: 0,
        h1Complete: complete,
        h24Complete: false,
        h1RefBlock: currentBlock,
        h24RefBlock: 0,
      };
      poolFlowCache.set(key, entry);
    } else {
      entry.h1Swaps = decoded;
      entry.h1FetchedAt = now;
      entry.h1Complete = complete;
      entry.h1RefBlock = currentBlock;
    }
  }

  // Refresh h24 if stale
  if (!entry.h24FetchedAt || now - entry.h24FetchedAt >= H24_REFRESH_MS) {
    const fromBlock = Math.max(0, currentBlock - BLOCKS_PER_H24);
    const { logs, complete } = await fetchSwapEventsForPool(
      pool.poolAddress,
      fromBlock,
      currentBlock,
      pool.poolType,
    );
    const decoded = decodeAndClassify(
      logs,
      pool,
      currentTokenPriceUSD,
      quoteTokenPriceUSD,
    );
    decoded.sort((a, b) => a.blockNumber - b.blockNumber);
    entry.h24Swaps = decoded;
    entry.h24FetchedAt = now;
    entry.h24Complete = complete;
    entry.h24RefBlock = currentBlock;
  }

  // Derive windows from cached swaps
  const m5MinBlock = currentBlock - BLOCKS_PER_M5;
  const h1MinBlock = currentBlock - BLOCKS_PER_H1;
  const h24MinBlock = currentBlock - BLOCKS_PER_H24;

  const m5Agg = aggregateSwaps(filterSwapsByMinBlock(entry.h1Swaps, m5MinBlock));
  const h1Agg = aggregateSwaps(filterSwapsByMinBlock(entry.h1Swaps, h1MinBlock));
  const h24Agg = aggregateSwaps(
    filterSwapsByMinBlock(entry.h24Swaps, h24MinBlock),
  );

  // priceChange.X = (lastPrice - firstPrice) / firstPrice * 100
  // Fall back to current price as `last` when only one swap is in the window.
  const pctChange = (
    a: AggregatedFlow,
  ): number => {
    const first = a.firstPriceUSD;
    const last = a.lastPriceUSD ?? currentTokenPriceUSD;
    if (!first || first <= 0) return 0;
    const pct = ((last - first) / first) * 100;
    return isFinite(pct) ? pct : 0;
  };

  return {
    transactions: {
      h1: { buys: h1Agg.buys, sells: h1Agg.sells },
      h24: { buys: h24Agg.buys, sells: h24Agg.sells },
    },
    volume: { h1: h1Agg.volumeUSD, h24: h24Agg.volumeUSD },
    priceChange: {
      m5: pctChange(m5Agg),
      h1: pctChange(h1Agg),
      h24: pctChange(h24Agg),
    },
    diagnostics: {
      swapsH1: entry.h1Swaps.length,
      swapsH24: entry.h24Swaps.length,
      h1FetchedAt: entry.h1FetchedAt,
      h24FetchedAt: entry.h24FetchedAt,
      h1Complete: entry.h1Complete,
      h24Complete: entry.h24Complete,
    },
  };
}

function decodeAndClassify(
  logs: RawSwapLog[],
  pool: PoolDescriptor,
  currentTokenPriceUSD: number,
  quoteTokenPriceUSD: number,
): ClassifiedSwap[] {
  const out: ClassifiedSwap[] = [];
  const isV3 = pool.poolType === 'uniswapV3' || pool.poolType === 'aerodromeV3';
  for (const log of logs) {
    const decoded = isV3 ? decodeV3SwapLog(log) : decodeV2SwapLog(log);
    if (!decoded) continue;
    const classified = classifySwap(
      decoded,
      pool,
      currentTokenPriceUSD,
      quoteTokenPriceUSD,
    );
    if (classified) out.push(classified);
  }
  return out;
}
