/**
 * NVR-SPEC-022 — Wallet BUY fetcher (Base, DEX-routed only)
 *
 * For a single wallet + token-universe, returns every "BUY" transfer in
 * a window — defined as: an ERC-20 Transfer event TO the wallet whose
 * `from` address is a known DEX router (Aerodrome / Uniswap V3 /
 * universal routers / Permit2).
 *
 * Why this definition:
 *   - Raw Transfer-IN events conflate real DEX BUYs with airdrops,
 *     wallet-to-wallet transfers, and wrapping. The router-whitelist
 *     filter narrows to actual on-DEX buys we want to score for forward
 *     edge.
 *   - Selling out of a wallet is a Transfer-OUT FROM the wallet TO a
 *     router; covered by `fetchWalletSells` (parallel function for
 *     completeness).
 *
 * Why scoped to a token universe:
 *   - Per `feedback_specialist_depth_beats_breadth`: we only care about
 *     a wallet's predictive edge on tokens WE TRADE. A wallet buying
 *     1000 random meme coins doesn't help us if we don't trade those
 *     coins; a wallet that consistently bought WETH/cbBTC dips at the
 *     right time is gold.
 */

import { createPublicClient, http } from "viem";
import { activeChain } from "../../core/config/chain-config.js";

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/**
 * ERC-20 Transfer event signature topic.
 *   keccak256("Transfer(address,address,uint256)")
 */
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

/** Known DEX router / aggregator addresses on Base (lowercased). */
export const DEX_ROUTERS_BASE: ReadonlySet<string> = new Set([
  "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24", // Aerodrome router
  "0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43", // Aerodrome universal router
  "0x2626664c2603336e57b271c5c0b26f421741e481", // Uniswap V3 SwapRouter02
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad", // Uniswap universal router
  "0x000000000022d473030f116ddee9f6b43ac78ba3", // Permit2
  "0x6ff5693b99212da76ad316178a184ab56d299b43", // Universal router v2 on Base
]);

const BLOCK_CHUNK_SIZE = 10_000n;
const INTER_CHUNK_DELAY_MS = 250;
const MAX_CHUNK_RETRIES = 3;
const BASE_BLOCK_TIME_SEC = 2;

const TX_ONLY_HOSTS = ["flashbots.net", "sequencer.base.org"];

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface WalletBuy {
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol?: string;
  amountTokensRaw: bigint;
  blockNumber: bigint;
  /** ISO 8601 of the block. Resolved post-fetch via getBlock. */
  timestamp?: string;
  txHash: string;
  logIndex: number;
  /** The router that originated the transfer. */
  routerAddress: string;
}

export interface FetchWalletBuysResult {
  walletAddress: string;
  buys: WalletBuy[];
  fromBlock: bigint;
  toBlock: bigint;
  chunkCount: number;
  fetchMs: number;
  /** Per-token raw Transfer event count (unfiltered). Useful for diagnostics. */
  rawTransferCounts: Record<string, number>;
  /** How many transfers were rejected for not coming from a router. */
  rejectedNonRouter: number;
}

export interface FetchOptions {
  walletAddress: string;
  /**
   * Token-universe scope. Each token gets its own chunked log query.
   * Lowercased internally; pass mixed-case fine.
   */
  tokenAddresses: readonly string[];
  /** Mapping address (lowercase) → symbol; used to label results. */
  symbolByAddress?: ReadonlyMap<string, string>;
  /** Window. */
  lookbackHours?: number;
  fromBlock?: bigint;
  toBlock?: bigint;
  endpoints?: string[];
  /**
   * Override the router whitelist. Default = DEX_ROUTERS_BASE. Useful for
   * tests with mock router addresses.
   */
  routers?: ReadonlySet<string>;
  verbose?: boolean;
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

/** Pad a 20-byte address to a 32-byte hex topic. Lowercased. */
function topicForAddress(addr: string): `0x${string}` {
  const clean = addr.toLowerCase().replace(/^0x/, "");
  return ("0x" + clean.padStart(64, "0")) as `0x${string}`;
}

/** Decode a 32-byte address topic back to a 20-byte 0x-prefixed lowercased address. */
function addressFromTopic(topic: string): string {
  // Last 40 hex chars = 20 bytes
  return ("0x" + topic.slice(-40)).toLowerCase();
}

/**
 * Resolve block timestamps in a small batch with caching. We hit getBlock
 * once per unique block and cache.
 */
async function resolveBlockTimestamps(
  client: ReturnType<typeof makeClient>,
  blockNumbers: readonly bigint[],
  cache: Map<bigint, number>,
): Promise<Map<bigint, number>> {
  const unique = Array.from(new Set(blockNumbers.filter((b) => !cache.has(b))));
  for (const bn of unique) {
    try {
      const block = await client.getBlock({ blockNumber: bn });
      cache.set(bn, Number(block.timestamp));
    } catch {
      // Skip — caller treats missing timestamp as undefined
    }
    await sleep(50);
  }
  return cache;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Fetch every "BUY" (router-originated incoming Transfer) for a wallet
 * across a token universe within a block window.
 */
export async function fetchWalletBuys(
  opts: FetchOptions,
): Promise<FetchWalletBuysResult> {
  const endpoints = (opts.endpoints ?? activeChain.rpcEndpoints).filter(
    (ep) => !TX_ONLY_HOSTS.some((h) => ep.includes(h)),
  );
  if (!endpoints.length) {
    throw new Error("fetchWalletBuys: no RPC endpoints configured");
  }
  const verbose = opts.verbose !== false;
  const routers = opts.routers ?? DEX_ROUTERS_BASE;
  const wallet = opts.walletAddress.toLowerCase();
  const tokens = opts.tokenAddresses.map((a) => a.toLowerCase());

  const wallStart = Date.now();
  const headClient = makeClient(endpoints[0]!);
  const head = await headClient.getBlockNumber();

  const toBlock = opts.toBlock ?? head;
  let fromBlock: bigint;
  if (opts.fromBlock !== undefined) {
    fromBlock = opts.fromBlock;
  } else {
    const lookbackHours = opts.lookbackHours ?? 24 * 90; // default 90d
    const lookbackBlocks = BigInt(
      Math.floor((lookbackHours * 3600) / BASE_BLOCK_TIME_SEC),
    );
    fromBlock = toBlock > lookbackBlocks ? toBlock - lookbackBlocks : 0n;
  }

  if (verbose) {
    console.log(
      `[wallet-buys] ${wallet.slice(0, 10)}... scanning ${tokens.length} tokens, ` +
        `blocks ${fromBlock}..${toBlock}`,
    );
  }

  const buys: WalletBuy[] = [];
  const rawTransferCounts: Record<string, number> = {};
  let rejectedNonRouter = 0;
  let chunkCount = 0;
  let endpointCursor = 0;

  // Topic[2] is the recipient — pre-compute padded wallet address as a topic
  const walletTopic = topicForAddress(wallet);

  for (const token of tokens) {
    rawTransferCounts[token] = 0;
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
          const client = makeClient(endpoint);
          const result = await client.getLogs({
            address: token as `0x${string}`,
            fromBlock: start,
            toBlock: chunkEnd,
            topics: [
              TRANSFER_TOPIC,
              null, // from: any
              walletTopic, // to: this wallet
            ],
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
            `[wallet-buys] chunk ${start}..${chunkEnd} on ${token.slice(0, 10)}... failed: ${lastErr?.message?.slice(0, 100)}`,
          );
        }
        await sleep(INTER_CHUNK_DELAY_MS);
        continue;
      }

      for (const log of chunkLogs as Array<{
        topics: string[];
        data: string;
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
        rawTransferCounts[token]!++;
        // Parse `from` address from topic[1]
        const fromAddr = addressFromTopic(log.topics[1] ?? "0x" + "0".repeat(64));
        if (!routers.has(fromAddr)) {
          rejectedNonRouter++;
          continue;
        }
        // Parse amount from data (uint256 in last 32 bytes)
        let amount: bigint;
        try {
          amount = BigInt(log.data);
        } catch {
          continue;
        }
        if (amount <= 0n) continue;

        buys.push({
          walletAddress: wallet,
          tokenAddress: token,
          tokenSymbol: opts.symbolByAddress?.get(token),
          amountTokensRaw: amount,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          routerAddress: fromAddr,
        });
      }
      await sleep(INTER_CHUNK_DELAY_MS);
    }
  }

  // Sort chronologically + resolve timestamps for each block
  buys.sort((a, b) => {
    if (a.blockNumber === b.blockNumber) return a.logIndex - b.logIndex;
    return a.blockNumber < b.blockNumber ? -1 : 1;
  });

  const tsCache = new Map<bigint, number>();
  await resolveBlockTimestamps(
    headClient,
    buys.map((b) => b.blockNumber),
    tsCache,
  );
  for (const b of buys) {
    const ts = tsCache.get(b.blockNumber);
    if (ts !== undefined) {
      b.timestamp = new Date(ts * 1000).toISOString();
    }
  }

  if (verbose) {
    console.log(
      `[wallet-buys] ${wallet.slice(0, 10)}... done: ${buys.length} BUYs ` +
        `(${rejectedNonRouter} non-router transfers rejected) in ${((Date.now() - wallStart) / 1000).toFixed(1)}s`,
    );
  }

  return {
    walletAddress: wallet,
    buys,
    fromBlock,
    toBlock,
    chunkCount,
    fetchMs: Date.now() - wallStart,
    rawTransferCounts,
    rejectedNonRouter,
  };
}

// ----------------------------------------------------------------------------
// Batched: fetch BUYs for MANY wallets in one pass (fast)
// ----------------------------------------------------------------------------

export interface BatchFetchOptions {
  walletAddresses: readonly string[];
  tokenAddresses: readonly string[];
  symbolByAddress?: ReadonlyMap<string, string>;
  lookbackHours?: number;
  fromBlock?: bigint;
  toBlock?: bigint;
  endpoints?: string[];
  routers?: ReadonlySet<string>;
  verbose?: boolean;
}

export interface BatchFetchResult {
  buysByWallet: Map<string, WalletBuy[]>;
  fromBlock: bigint;
  toBlock: bigint;
  chunkCount: number;
  fetchMs: number;
  rejectedNonRouter: number;
}

/**
 * Single-pass fetcher for a SET of wallets across a token universe.
 * Uses eth_getLogs with `topics[2] = [walletTopic1, walletTopic2, ...]`
 * (OR semantics on indexed topics) to retrieve every Transfer to any
 * watched wallet in one call per token+chunk. Massive speedup vs.
 * per-wallet sequential fetch — for N wallets, this is N× faster.
 *
 * Returns a `Map<walletAddress, WalletBuy[]>` where keys are lowercased.
 */
export async function fetchBuysForWallets(
  opts: BatchFetchOptions,
): Promise<BatchFetchResult> {
  const endpoints = (opts.endpoints ?? activeChain.rpcEndpoints).filter(
    (ep) => !TX_ONLY_HOSTS.some((h) => ep.includes(h)),
  );
  if (!endpoints.length) {
    throw new Error("fetchBuysForWallets: no RPC endpoints configured");
  }
  const verbose = opts.verbose !== false;
  const routers = opts.routers ?? DEX_ROUTERS_BASE;
  const wallets = opts.walletAddresses.map((a) => a.toLowerCase());
  const tokens = opts.tokenAddresses.map((a) => a.toLowerCase());

  // Pre-compute padded topic forms of each wallet, plus a reverse map
  // so we can route incoming logs back to the wallet that received them.
  const walletTopics: `0x${string}`[] = wallets.map(topicForAddress);
  const walletByTopic = new Map<string, string>();
  for (let i = 0; i < wallets.length; i++) {
    walletByTopic.set(walletTopics[i]!.toLowerCase(), wallets[i]!);
  }

  const wallStart = Date.now();
  const headClient = makeClient(endpoints[0]!);
  const head = await headClient.getBlockNumber();

  const toBlock = opts.toBlock ?? head;
  let fromBlock: bigint;
  if (opts.fromBlock !== undefined) {
    fromBlock = opts.fromBlock;
  } else {
    const lookbackHours = opts.lookbackHours ?? 24 * 90;
    const lookbackBlocks = BigInt(
      Math.floor((lookbackHours * 3600) / BASE_BLOCK_TIME_SEC),
    );
    fromBlock = toBlock > lookbackBlocks ? toBlock - lookbackBlocks : 0n;
  }

  if (verbose) {
    console.log(
      `[wallet-buys-batch] ${wallets.length} wallets × ${tokens.length} tokens, ` +
        `blocks ${fromBlock}..${toBlock}`,
    );
  }

  const buysByWallet = new Map<string, WalletBuy[]>();
  for (const w of wallets) buysByWallet.set(w, []);
  let rejectedNonRouter = 0;
  let chunkCount = 0;
  let endpointCursor = 0;
  const allBuyBlockNumbers: bigint[] = [];

  for (const token of tokens) {
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
          const client = makeClient(endpoint);
          const result = await client.getLogs({
            address: token as `0x${string}`,
            fromBlock: start,
            toBlock: chunkEnd,
            topics: [
              TRANSFER_TOPIC,
              null, // from: any
              walletTopics, // to: ANY of these wallets (OR)
            ],
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
            `[wallet-buys-batch] chunk ${start}..${chunkEnd} on ${token.slice(0, 10)}... failed: ${lastErr?.message?.slice(0, 100)}`,
          );
        }
        await sleep(INTER_CHUNK_DELAY_MS);
        continue;
      }

      for (const log of chunkLogs as Array<{
        topics: string[];
        data: string;
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
        const fromAddr = addressFromTopic(log.topics[1] ?? "0x" + "0".repeat(64));
        if (!routers.has(fromAddr)) {
          rejectedNonRouter++;
          continue;
        }
        const toTopic = (log.topics[2] ?? "").toLowerCase();
        const recipient = walletByTopic.get(toTopic);
        if (!recipient) continue; // shouldn't happen with the filter, but defensive

        let amount: bigint;
        try {
          amount = BigInt(log.data);
        } catch {
          continue;
        }
        if (amount <= 0n) continue;

        const buy: WalletBuy = {
          walletAddress: recipient,
          tokenAddress: token,
          tokenSymbol: opts.symbolByAddress?.get(token),
          amountTokensRaw: amount,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          routerAddress: fromAddr,
        };
        const list = buysByWallet.get(recipient);
        if (list) list.push(buy);
        allBuyBlockNumbers.push(log.blockNumber);
      }
      await sleep(INTER_CHUNK_DELAY_MS);
    }
    if (verbose) {
      const tokenTotal = Array.from(buysByWallet.values())
        .flat()
        .filter((b) => b.tokenAddress === token).length;
      console.log(
        `[wallet-buys-batch] ${token.slice(0, 10)}... done, ${tokenTotal} BUYs across all wallets`,
      );
    }
  }

  // Sort each wallet's buys + resolve timestamps (batched once, shared cache)
  const tsCache = new Map<bigint, number>();
  await resolveBlockTimestamps(headClient, allBuyBlockNumbers, tsCache);
  for (const buys of buysByWallet.values()) {
    buys.sort((a, b) => {
      if (a.blockNumber === b.blockNumber) return a.logIndex - b.logIndex;
      return a.blockNumber < b.blockNumber ? -1 : 1;
    });
    for (const b of buys) {
      const ts = tsCache.get(b.blockNumber);
      if (ts !== undefined) b.timestamp = new Date(ts * 1000).toISOString();
    }
  }

  if (verbose) {
    const total = Array.from(buysByWallet.values()).reduce(
      (s, b) => s + b.length,
      0,
    );
    console.log(
      `[wallet-buys-batch] done: ${total} BUYs (${rejectedNonRouter} rejected) ` +
        `across ${wallets.length} wallets in ${((Date.now() - wallStart) / 1000).toFixed(1)}s`,
    );
  }

  return {
    buysByWallet,
    fromBlock,
    toBlock,
    chunkCount,
    fetchMs: Date.now() - wallStart,
    rejectedNonRouter,
  };
}
