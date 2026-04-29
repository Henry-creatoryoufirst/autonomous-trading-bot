/**
 * NVR-SPEC-022 — Pool-side BUY fetcher (Base, multi-DEX agnostic)
 *
 * For a token T and one or more pools P[], fetch every ERC-20 Transfer
 * event where the *source* is one of the pools. Each such transfer
 * represents tokens leaving the pool — almost entirely BUY swaps, with
 * a small minority of LP-burn / liquidity-removal transfers.
 *
 * Why this filter (vs. `wallet-buys.ts` which filters from = router):
 *   - Pool-side captures ALL BUY paths regardless of routing flavor
 *     (Aerodrome direct, Uniswap V3, universal-router, Permit2, custom
 *     forwarders). A v2-style direct swap emits Transfer.from = pool,
 *     to = user — the existing router-side filter misses these entirely.
 *   - Pool-side is also stable across DEX upgrades. New router contracts
 *     ship constantly; pool addresses are immutable per token-pair.
 *
 * Tradeoff: a small amount of LP-burn noise in the result. For the
 * observation-pass use case (short pre-windows around clustered moves),
 * this is acceptable — LP burns themselves are useful signal and
 * a typical 2-hour window has 0-1 of them. Disambiguation deferred
 * until a pattern needs it.
 */

import { createPublicClient, http, parseAbiItem } from "viem";
import { activeChain } from "../../core/config/chain-config.js";

// ----------------------------------------------------------------------------
// Constants (shared shape with wallet-buys.ts)
// ----------------------------------------------------------------------------

/**
 * ERC-20 Transfer as a typed-event ABI item. Used by viem's getLogs in
 * `event` mode — properly filters topic[1] / topic[2] via `args:`.
 *
 * The raw `topics: [...]` array form silently fails to filter on
 * non-zero positions on some Base RPC endpoints (verified empirically
 * 2026-04-29 — 108k events came back instead of the expected ~5k when
 * filtering topic[1]). The typed-event form has the args translated
 * into a properly-encoded topics filter that the RPC honors.
 */
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const BLOCK_CHUNK_SIZE = 10_000n;
const INTER_CHUNK_DELAY_MS = 250;
const MAX_CHUNK_RETRIES = 3;

const TX_ONLY_HOSTS = ["flashbots.net", "sequencer.base.org"];

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface PoolBuy {
  /** The token that was bought. */
  tokenAddress: string;
  /** The pool the buy came out of. */
  poolAddress: string;
  /** Recipient wallet (topic[2] of the Transfer). */
  buyerWallet: string;
  /** Raw token amount (token-decimals — caller divides). */
  amountTokensRaw: bigint;
  blockNumber: bigint;
  txHash: string;
  logIndex: number;
  /** ISO 8601, resolved post-fetch. */
  timestamp?: string;
}

export interface FetchPoolBuysOptions {
  tokenAddress: string;
  /** One or more pool addresses on Base for this token. Top-by-reserve preferred. */
  poolAddresses: readonly string[];
  fromBlock: bigint;
  toBlock: bigint;
  endpoints?: string[];
  verbose?: boolean;
}

export interface FetchPoolBuysResult {
  tokenAddress: string;
  buys: PoolBuy[];
  fromBlock: bigint;
  toBlock: bigint;
  chunkCount: number;
  fetchMs: number;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeClient(endpoint: string) {
  return createPublicClient({
    transport: http(endpoint, { timeout: 15_000, retryCount: 0 }),
  });
}

function topicForAddress(addr: string): `0x${string}` {
  const clean = addr.toLowerCase().replace(/^0x/, "");
  return ("0x" + clean.padStart(64, "0")) as `0x${string}`;
}

function addressFromTopic(topic: string): string {
  return ("0x" + topic.slice(-40)).toLowerCase();
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export async function fetchPoolBuys(
  opts: FetchPoolBuysOptions,
): Promise<FetchPoolBuysResult> {
  const endpoints = (opts.endpoints ?? activeChain.rpcEndpoints).filter(
    (ep) => !TX_ONLY_HOSTS.some((h) => ep.includes(h)),
  );
  if (!endpoints.length) {
    throw new Error("fetchPoolBuys: no RPC endpoints configured");
  }
  const verbose = opts.verbose !== false;
  const token = opts.tokenAddress.toLowerCase();
  const pools = opts.poolAddresses.map((p) => p.toLowerCase());

  const wallStart = Date.now();
  const buys: PoolBuy[] = [];
  let chunkCount = 0;
  let endpointCursor = 0;

  // Use viem's typed-event filter with args:{ from: pool } — this gets
  // translated into a properly-encoded topics filter that Base RPCs
  // actually honor. (Raw topics arrays at non-zero positions silently
  // disable filtering on some Base endpoints — verified 2026-04-29.)
  for (const pool of pools) {
    for (
      let start = opts.fromBlock;
      start <= opts.toBlock;
      start += BLOCK_CHUNK_SIZE
    ) {
      const chunkEnd =
        start + BLOCK_CHUNK_SIZE - 1n > opts.toBlock
          ? opts.toBlock
          : start + BLOCK_CHUNK_SIZE - 1n;

      let chunkLogs: unknown[] | null = null;
      let lastErr: Error | null = null;
      for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
        const endpoint = endpoints[endpointCursor % endpoints.length]!;
        try {
          const client = makeClient(endpoint);
          const result = await client.getLogs({
            address: token as `0x${string}`,
            event: TRANSFER_EVENT,
            args: { from: pool as `0x${string}` },
            fromBlock: start,
            toBlock: chunkEnd,
          });
          chunkLogs = result;
          break;
        } catch (e) {
          lastErr = e as Error;
          endpointCursor++;
        }
      }
      chunkCount++;
      if (chunkLogs === null) {
        if (verbose) {
          console.warn(
            `[pool-buys] chunk ${start}..${chunkEnd} pool=${pool.slice(0, 10)} failed: ${lastErr?.message?.slice(0, 100)}`,
          );
        }
        await sleep(INTER_CHUNK_DELAY_MS);
        continue;
      }

      for (const log of chunkLogs as Array<{
        args?: { from?: string; to?: string; value?: bigint };
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
        const toAddr = (a.to ?? "0x0").toLowerCase();
        const amount = a.value ?? 0n;
        if (amount <= 0n) continue;

        buys.push({
          tokenAddress: token,
          poolAddress: pool,
          buyerWallet: toAddr,
          amountTokensRaw: amount,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
        });
      }
      await sleep(INTER_CHUNK_DELAY_MS);
    }
  }

  // Sort chronologically. Timestamps are NOT populated here — that's an
  // O(n) per-block RPC call which dominates wall time for short windows.
  // Callers that need timestamps should derive them from a block↔time
  // anchor (BASE_BLOCK_TIME_SEC × deltaBlocks) — accurate to ±a few
  // seconds on Base, which is fine for clustering / bucket analysis.
  buys.sort((a, b) => {
    if (a.blockNumber === b.blockNumber) return a.logIndex - b.logIndex;
    return a.blockNumber < b.blockNumber ? -1 : 1;
  });

  if (verbose) {
    console.log(
      `[pool-buys] ${token.slice(0, 10)}... done: ${buys.length} BUYs across ${pools.length} pool(s) ` +
        `in ${((Date.now() - wallStart) / 1000).toFixed(1)}s (${chunkCount} chunks)`,
    );
  }

  return {
    tokenAddress: token,
    buys,
    fromBlock: opts.fromBlock,
    toBlock: opts.toBlock,
    chunkCount,
    fetchMs: Date.now() - wallStart,
  };
}
