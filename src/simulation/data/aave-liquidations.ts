/**
 * NVR-SPEC-022 — Aave V3 LiquidationCall historical event fetcher (Base)
 *
 * Pulls historical `LiquidationCall` events from the Aave V3 Pool on Base
 * via chunked `eth_getLogs` calls across the bot's existing rotating
 * Base RPC endpoint pool. Returns a chronologically-sorted list of
 * HistoricalEvents that the EventReplayer can drive through the
 * PatternRuntime for backtest validation.
 *
 * Why direct RPC and not a subgraph: The Graph's hosted service was
 * deprecated and the Aave V3 Base subgraph on the decentralized network
 * needs an API key. Public Base RPCs work fine for ~7-day windows
 * (~300k blocks ≈ 30 chunked requests). Private RPC (Alchemy/QuickNode
 * via BASE_RPC_URL env) makes it instant but isn't required.
 *
 * What it doesn't do (deferred):
 *   - USD pricing of the liquidated collateral. The event gives raw
 *     amounts; a pattern that wants $-thresholds either has to convert
 *     using historical price data or use the collateral's address as
 *     a heuristic (e.g., WETH/USDC liquidations are obviously meaningful).
 *   - Morpho LiquidationCall events. Same shape; add a parallel fetcher
 *     when Pattern P1 graduates.
 */

import { createPublicClient, http, parseAbiItem } from "viem";
import { activeChain } from "../../core/config/chain-config.js";
import type { HistoricalEvent } from "../event-replayer.js";

// ----------------------------------------------------------------------------
// Aave V3 LiquidationCall event ABI
// ----------------------------------------------------------------------------

const LIQUIDATION_CALL_EVENT = parseAbiItem(
  "event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)",
);

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

/** Public Base RPCs typically cap getLogs at 10k blocks per call. */
const BLOCK_CHUNK_SIZE = 10_000n;

/** Sleep between chunks to respect rate limits on free RPCs. */
const INTER_CHUNK_DELAY_MS = 250;

/** Per-chunk retry budget across endpoints. */
const MAX_CHUNK_RETRIES = 3;

/** Approximate Base block time (seconds). Used to translate "last N hours"
 *  into a block range without hitting the chain for every call. */
const BASE_BLOCK_TIME_SEC = 2;

// ----------------------------------------------------------------------------
// Result shape
// ----------------------------------------------------------------------------

export interface AaveLiquidation {
  blockNumber: bigint;
  txHash: string;
  logIndex: number;
  collateralAsset: string;
  debtAsset: string;
  user: string;
  liquidator: string;
  debtToCover: bigint;
  liquidatedCollateralAmount: bigint;
  receiveAToken: boolean;
}

export interface FetchLiquidationsResult {
  /** All liquidation events in the window, oldest first. */
  liquidations: AaveLiquidation[];
  /** Pre-converted HistoricalEvents ready for EventReplayer. */
  events: HistoricalEvent[];
  fromBlock: bigint;
  toBlock: bigint;
  chunkCount: number;
  rpcUses: Record<string, number>;
  fetchMs: number;
}

// ----------------------------------------------------------------------------
// Internals
// ----------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeClient(endpoint: string) {
  return createPublicClient({
    transport: http(endpoint, { timeout: 15_000, retryCount: 0 }),
  });
}

/** Best-effort timestamp lookup for a block. Cached to avoid re-fetching. */
async function getBlockTimestamp(
  client: ReturnType<typeof makeClient>,
  blockNumber: bigint,
  cache: Map<bigint, number>,
): Promise<number> {
  const cached = cache.get(blockNumber);
  if (cached !== undefined) return cached;
  const block = await client.getBlock({ blockNumber });
  const ts = Number(block.timestamp); // seconds since epoch
  cache.set(blockNumber, ts);
  return ts;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export interface FetchOptions {
  /** Lookback window in hours. Default 168 (7 days). */
  lookbackHours?: number;
  /** Optional explicit fromBlock. Overrides lookbackHours. */
  fromBlock?: bigint;
  /** Optional explicit toBlock. Defaults to current head. */
  toBlock?: bigint;
  /** Optional list of RPC endpoints. Defaults to the chain config's. */
  endpoints?: string[];
  /** Print per-chunk progress logs. Default true. */
  verbose?: boolean;
}

export async function fetchAaveLiquidations(
  opts: FetchOptions = {},
): Promise<FetchLiquidationsResult> {
  const aaveV3Pool = activeChain.yieldProtocols?.aaveV3?.pool as
    | `0x${string}`
    | undefined;
  if (!aaveV3Pool) {
    throw new Error(
      "fetchAaveLiquidations: activeChain has no aaveV3.pool configured",
    );
  }

  // Filter the RPC endpoint list down to those known to actually return
  // logs reliably. Two classes of Base RPCs are tx-submission-only and
  // do NOT support eth_getLogs / eth_blockNumber:
  //   - rpc.flashbots.net  (silently returns empty results for getLogs)
  //   - mainnet-sequencer.base.org  (returns "rpc method not allowed" 403)
  // Both are excluded from log-fetch paths. The remaining mainnet.base.org,
  // 1rpc.io, base.meowrpc.com, base.drpc.org all serve eth_getLogs.
  // Confirmed empirically 2026-04-27.
  const TX_ONLY_HOSTS = ["flashbots.net", "sequencer.base.org"];
  const endpoints = (opts.endpoints ?? activeChain.rpcEndpoints).filter(
    (ep) => !TX_ONLY_HOSTS.some((h) => ep.includes(h)),
  );
  if (!endpoints.length) {
    throw new Error("fetchAaveLiquidations: no RPC endpoints configured");
  }
  const verbose = opts.verbose !== false;

  const wallStart = Date.now();
  const headClient = makeClient(endpoints[0]!);
  const head = await headClient.getBlockNumber();

  const toBlock = opts.toBlock ?? head;
  let fromBlock: bigint;
  if (opts.fromBlock !== undefined) {
    fromBlock = opts.fromBlock;
  } else {
    const lookbackHours = opts.lookbackHours ?? 168; // 7 days
    const lookbackBlocks = BigInt(
      Math.floor((lookbackHours * 3600) / BASE_BLOCK_TIME_SEC),
    );
    fromBlock = toBlock > lookbackBlocks ? toBlock - lookbackBlocks : 0n;
  }

  if (verbose) {
    console.log(
      `[aave-liquidations] scan blocks ${fromBlock}..${toBlock} (${Number(toBlock - fromBlock)} blocks ≈ ${((Number(toBlock - fromBlock) * BASE_BLOCK_TIME_SEC) / 3600).toFixed(1)}h)`,
    );
  }

  const liquidations: AaveLiquidation[] = [];
  const rpcUses: Record<string, number> = {};
  let chunkCount = 0;
  let endpointCursor = 0;
  const tsCache = new Map<bigint, number>();

  for (let start = fromBlock; start <= toBlock; start += BLOCK_CHUNK_SIZE) {
    const chunkEnd =
      start + BLOCK_CHUNK_SIZE - 1n > toBlock
        ? toBlock
        : start + BLOCK_CHUNK_SIZE - 1n;

    let chunkLogs: unknown[] | null = null;
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
      const endpoint = endpoints[endpointCursor % endpoints.length]!;
      try {
        if (verbose) {
          process.stdout.write(
            `  chunk ${chunkCount + 1}: ${endpoint.replace("https://", "")} blocks ${start}..${chunkEnd}${attempt > 0 ? ` (retry ${attempt})` : ""}\r`,
          );
        }
        const client = makeClient(endpoint);
        const result = await client.getLogs({
          address: aaveV3Pool,
          event: LIQUIDATION_CALL_EVENT,
          fromBlock: start,
          toBlock: chunkEnd,
        });
        chunkLogs = result;
        rpcUses[endpoint] = (rpcUses[endpoint] ?? 0) + 1;
        break;
      } catch (e) {
        lastErr = e as Error;
        endpointCursor++;
      }
    }
    chunkCount++;
    if (chunkLogs === null) {
      console.warn(
        `\n[aave-liquidations] chunk ${start}..${chunkEnd} failed after ${MAX_CHUNK_RETRIES} retries: ${lastErr?.message?.slice(0, 200) ?? "unknown"}`,
      );
      await sleep(INTER_CHUNK_DELAY_MS);
      continue;
    }

    for (const log of chunkLogs as Array<{
      args?: {
        collateralAsset?: string;
        debtAsset?: string;
        user?: string;
        liquidator?: string;
        debtToCover?: bigint;
        liquidatedCollateralAmount?: bigint;
        receiveAToken?: boolean;
      };
      blockNumber: bigint | null;
      transactionHash: string | null;
      logIndex: number | null;
    }>) {
      if (
        log.blockNumber === null ||
        log.transactionHash === null ||
        log.logIndex === null
      ) {
        continue;
      }
      const a = log.args ?? {};
      liquidations.push({
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        collateralAsset: (a.collateralAsset ?? "0x0").toLowerCase(),
        debtAsset: (a.debtAsset ?? "0x0").toLowerCase(),
        user: (a.user ?? "0x0").toLowerCase(),
        liquidator: (a.liquidator ?? "0x0").toLowerCase(),
        debtToCover: a.debtToCover ?? 0n,
        liquidatedCollateralAmount: a.liquidatedCollateralAmount ?? 0n,
        receiveAToken: a.receiveAToken ?? false,
      });
    }

    await sleep(INTER_CHUNK_DELAY_MS);
  }
  if (verbose) process.stdout.write("\n");

  // Sort chronologically (defensive — getLogs should already return ordered
  // but multi-chunk + endpoint rotation can shuffle)
  liquidations.sort((a, b) => {
    if (a.blockNumber === b.blockNumber) return a.logIndex - b.logIndex;
    return a.blockNumber < b.blockNumber ? -1 : 1;
  });

  // Convert to HistoricalEvent[]. Each liquidation gets a timestamp from
  // its block (we look up unique blocks lazily; cap on lookups to keep
  // this fast — if we have too many we just batch by block number).
  const events: HistoricalEvent[] = [];
  for (const liq of liquidations) {
    let ts: number;
    try {
      ts = await getBlockTimestamp(headClient, liq.blockNumber, tsCache);
    } catch {
      // If we can't resolve a timestamp, skip this event rather than
      // pollute the replayer with bad chronology.
      continue;
    }
    events.push({
      timestamp: new Date(ts * 1000).toISOString(),
      symbol: liq.collateralAsset, // address of collateral; pattern may map to symbol
      price: 0, // unknown — pattern can compute from liquidatedCollateralAmount + symbol
      kind: "aave_liquidation",
      payload: {
        protocol: "aave-v3",
        chain: "base",
        txHash: liq.txHash,
        blockNumber: Number(liq.blockNumber),
        logIndex: liq.logIndex,
        collateralAsset: liq.collateralAsset,
        debtAsset: liq.debtAsset,
        user: liq.user,
        liquidator: liq.liquidator,
        debtToCover: liq.debtToCover.toString(),
        liquidatedCollateralAmount: liq.liquidatedCollateralAmount.toString(),
        receiveAToken: liq.receiveAToken,
      },
    });
  }

  return {
    liquidations,
    events,
    fromBlock,
    toBlock,
    chunkCount,
    rpcUses,
    fetchMs: Date.now() - wallStart,
  };
}
