/**
 * NVR-SPEC-022 — Morpho Blue Liquidate event fetcher (Base)
 *
 * Companion to `aave-liquidations.ts`. Pulls historical `Liquidate` events
 * from the Morpho Blue singleton on Base via the same chunked
 * `eth_getLogs` infrastructure. Emits HistoricalEvents the EventReplayer
 * can drive through the existing Pattern P1 (liquidation_counter_trade)
 * with NO pattern-side changes besides accepting the new `kind` value.
 *
 * Why this exists: the FINDING_2026-04-27 conclusion was that Aave V3
 * Base alone has too thin a liquidation flow to support Pattern P1
 * (0 events ≥ $50k in 7 days). The FINDING explicitly named multi-venue
 * aggregation as the path to make P1 viable. Morpho Blue is the second
 * non-trivial money-market on Base, so this fetcher is the logical next
 * data source.
 *
 * Differences from Aave V3:
 *   - Morpho Blue is a singleton contract that hosts many isolated
 *     markets. The `Liquidate` event identifies the market by `bytes32 id`
 *     rather than including collateralAsset/debtAsset directly.
 *   - To recover the collateral asset for a given event, we call
 *     `idToMarketParams(id)` on the singleton once per unique market,
 *     and cache the result.
 *   - "seizedAssets" (Morpho) ≡ "liquidatedCollateralAmount" (Aave V3)
 *     for downstream pattern consumption.
 *
 * What it doesn't do (deferred):
 *   - USD pricing of seized collateral. Same story as Aave: pattern reads
 *     raw token amount + collateral address and applies its own USD
 *     heuristic. The new GeckoTerminal price feed handles fill-time
 *     pricing through the executor layer.
 *   - MorphoCompound / MorphoAave optimizers (older, deprecated; not the
 *     target of this aggregation).
 */

import { createPublicClient, http, parseAbiItem, parseAbi } from "viem";
import { activeChain } from "../../core/config/chain-config.js";
import type { HistoricalEvent } from "../event-replayer.js";

// ----------------------------------------------------------------------------
// Morpho Blue contract — Base mainnet
// ----------------------------------------------------------------------------

/** Morpho Blue singleton on Base. Confirmed at
 *  src/core/services/morpho-yield.ts:14 (used in production for vault yield). */
const MORPHO_BLUE_BASE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as `0x${string}`;

const LIQUIDATE_EVENT = parseAbiItem(
  "event Liquidate(bytes32 indexed id, address indexed caller, address indexed borrower, uint256 repaidAssets, uint256 repaidShares, uint256 seizedAssets, uint256 badDebtAssets, uint256 badDebtShares)",
);

/**
 * `idToMarketParams(bytes32) → (loanToken, collateralToken, oracle, irm, lltv)`.
 * Morpho Blue's view to map a market id back to its parameters. We call this
 * once per unique market id seen in liquidations to recover the collateral
 * token address downstream patterns expect.
 */
const MARKET_PARAMS_ABI = parseAbi([
  "function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
]);

// ----------------------------------------------------------------------------
// Same RPC chunking config as aave-liquidations
// ----------------------------------------------------------------------------

const BLOCK_CHUNK_SIZE = 10_000n;
const INTER_CHUNK_DELAY_MS = 250;
const MAX_CHUNK_RETRIES = 3;
const BASE_BLOCK_TIME_SEC = 2;

// Same RPC blocklist Aave uses — these endpoints don't serve eth_getLogs
const TX_ONLY_HOSTS = ["flashbots.net", "sequencer.base.org"];

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface MorphoLiquidation {
  blockNumber: bigint;
  txHash: string;
  logIndex: number;
  /** Market id (bytes32 hex). */
  id: string;
  /** Liquidator address (the `caller` in the event). */
  liquidator: string;
  /** Address of the position being liquidated. */
  borrower: string;
  /** Loan token repaid (raw amount, in `repaidAssetsToken` decimals). */
  repaidAssets: bigint;
  repaidShares: bigint;
  /** Collateral seized (raw amount, in `collateralToken` decimals). */
  seizedAssets: bigint;
  badDebtAssets: bigint;
  badDebtShares: bigint;
  /** Resolved (post-fetch) market params. May be undefined if resolution failed. */
  collateralAsset?: string;
  loanToken?: string;
  oracle?: string;
  irm?: string;
  lltv?: bigint;
}

export interface FetchMorphoLiquidationsResult {
  liquidations: MorphoLiquidation[];
  events: HistoricalEvent[];
  fromBlock: bigint;
  toBlock: bigint;
  chunkCount: number;
  rpcUses: Record<string, number>;
  fetchMs: number;
  /** How many unique market ids we resolved params for. */
  marketsResolved: number;
}

export interface FetchOptions {
  lookbackHours?: number;
  fromBlock?: bigint;
  toBlock?: bigint;
  endpoints?: string[];
  verbose?: boolean;
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

async function getBlockTimestamp(
  client: ReturnType<typeof makeClient>,
  blockNumber: bigint,
  cache: Map<bigint, number>,
): Promise<number> {
  const cached = cache.get(blockNumber);
  if (cached !== undefined) return cached;
  const block = await client.getBlock({ blockNumber });
  const ts = Number(block.timestamp);
  cache.set(blockNumber, ts);
  return ts;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export async function fetchMorphoLiquidations(
  opts: FetchOptions = {},
): Promise<FetchMorphoLiquidationsResult> {
  const endpoints = (opts.endpoints ?? activeChain.rpcEndpoints).filter(
    (ep) => !TX_ONLY_HOSTS.some((h) => ep.includes(h)),
  );
  if (!endpoints.length) {
    throw new Error("fetchMorphoLiquidations: no RPC endpoints configured");
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
    const lookbackHours = opts.lookbackHours ?? 168;
    const lookbackBlocks = BigInt(
      Math.floor((lookbackHours * 3600) / BASE_BLOCK_TIME_SEC),
    );
    fromBlock = toBlock > lookbackBlocks ? toBlock - lookbackBlocks : 0n;
  }

  if (verbose) {
    console.log(
      `[morpho-liquidations] scan blocks ${fromBlock}..${toBlock} (${Number(toBlock - fromBlock)} blocks ≈ ${((Number(toBlock - fromBlock) * BASE_BLOCK_TIME_SEC) / 3600).toFixed(1)}h)`,
    );
  }

  const liquidations: MorphoLiquidation[] = [];
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
          address: MORPHO_BLUE_BASE,
          event: LIQUIDATE_EVENT,
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
        `\n[morpho-liquidations] chunk ${start}..${chunkEnd} failed after ${MAX_CHUNK_RETRIES} retries: ${lastErr?.message?.slice(0, 200) ?? "unknown"}`,
      );
      await sleep(INTER_CHUNK_DELAY_MS);
      continue;
    }

    for (const log of chunkLogs as Array<{
      args?: {
        id?: string;
        caller?: string;
        borrower?: string;
        repaidAssets?: bigint;
        repaidShares?: bigint;
        seizedAssets?: bigint;
        badDebtAssets?: bigint;
        badDebtShares?: bigint;
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
        id: (a.id ?? "0x0").toLowerCase(),
        liquidator: (a.caller ?? "0x0").toLowerCase(),
        borrower: (a.borrower ?? "0x0").toLowerCase(),
        repaidAssets: a.repaidAssets ?? 0n,
        repaidShares: a.repaidShares ?? 0n,
        seizedAssets: a.seizedAssets ?? 0n,
        badDebtAssets: a.badDebtAssets ?? 0n,
        badDebtShares: a.badDebtShares ?? 0n,
      });
    }

    await sleep(INTER_CHUNK_DELAY_MS);
  }
  if (verbose) process.stdout.write("\n");

  // Sort chronologically
  liquidations.sort((a, b) => {
    if (a.blockNumber === b.blockNumber) return a.logIndex - b.logIndex;
    return a.blockNumber < b.blockNumber ? -1 : 1;
  });

  // Resolve market params for each unique market id seen in this batch.
  // Cached to avoid duplicate calls for repeat markets (the common case
  // — a handful of markets account for most liquidations on Base).
  const marketCache = new Map<
    string,
    {
      loanToken: string;
      collateralToken: string;
      oracle: string;
      irm: string;
      lltv: bigint;
    }
  >();
  if (liquidations.length > 0) {
    const uniqueIds = Array.from(new Set(liquidations.map((l) => l.id)));
    if (verbose) {
      console.log(
        `[morpho-liquidations] resolving ${uniqueIds.length} unique market ids...`,
      );
    }
    for (const id of uniqueIds) {
      let resolved = false;
      for (let attempt = 0; attempt < MAX_CHUNK_RETRIES && !resolved; attempt++) {
        const endpoint = endpoints[endpointCursor % endpoints.length]!;
        try {
          const client = makeClient(endpoint);
          const result = (await client.readContract({
            address: MORPHO_BLUE_BASE,
            abi: MARKET_PARAMS_ABI,
            functionName: "idToMarketParams",
            args: [id as `0x${string}`],
          })) as readonly [string, string, string, string, bigint];
          marketCache.set(id, {
            loanToken: result[0].toLowerCase(),
            collateralToken: result[1].toLowerCase(),
            oracle: result[2].toLowerCase(),
            irm: result[3].toLowerCase(),
            lltv: result[4],
          });
          rpcUses[endpoint] = (rpcUses[endpoint] ?? 0) + 1;
          resolved = true;
        } catch {
          endpointCursor++;
        }
      }
      // If unresolved, this market's liquidations get null collateralAsset
      // and the pattern's filter will reject them naturally. Logged at the end.
      await sleep(INTER_CHUNK_DELAY_MS);
    }
  }

  // Backfill collateral/loan addresses on each liquidation record
  for (const liq of liquidations) {
    const params = marketCache.get(liq.id);
    if (params) {
      liq.collateralAsset = params.collateralToken;
      liq.loanToken = params.loanToken;
      liq.oracle = params.oracle;
      liq.irm = params.irm;
      liq.lltv = params.lltv;
    }
  }

  // Emit HistoricalEvents in the shape the existing pattern expects.
  // Field names mirror Aave's payload so the pattern can read either
  // kind transparently — `collateralAsset` + `liquidatedCollateralAmount`
  // are the two fields detect() reads, plus `txHash` for dedup.
  const events: HistoricalEvent[] = [];
  for (const liq of liquidations) {
    let ts: number;
    try {
      ts = await getBlockTimestamp(headClient, liq.blockNumber, tsCache);
    } catch {
      continue;
    }
    events.push({
      timestamp: new Date(ts * 1000).toISOString(),
      symbol: liq.collateralAsset ?? "0x0",
      price: 0,
      kind: "morpho_liquidation",
      payload: {
        protocol: "morpho-blue",
        chain: "base",
        txHash: liq.txHash,
        blockNumber: Number(liq.blockNumber),
        logIndex: liq.logIndex,
        marketId: liq.id,
        // Field names mirror aave_liquidation so the pattern can read them
        // identically. seizedAssets ≡ liquidatedCollateralAmount.
        collateralAsset: liq.collateralAsset ?? "0x0",
        liquidatedCollateralAmount: liq.seizedAssets.toString(),
        debtAsset: liq.loanToken ?? "0x0",
        user: liq.borrower,
        liquidator: liq.liquidator,
        debtToCover: liq.repaidAssets.toString(),
        // Morpho-specific extras (not used by the current pattern but
        // kept for telemetry / future patterns)
        oracle: liq.oracle,
        irm: liq.irm,
        lltv: liq.lltv?.toString(),
        badDebtAssets: liq.badDebtAssets.toString(),
        badDebtShares: liq.badDebtShares.toString(),
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
    marketsResolved: marketCache.size,
  };
}
