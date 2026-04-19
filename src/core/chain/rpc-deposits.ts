/**
 * Never Rest Capital — RPC-based on-chain capital flows (deposits + withdrawals)
 *
 * Queries Transfer event logs directly via RPC to identify true deposits and
 * withdrawals — i.e. USDC flows that are NOT the return leg of a swap the
 * wallet itself initiated. Works for Coinbase Smart Wallets (ERC-4337) where
 * Blockscout's wallet-centric tokentx endpoint misses ERC-4337 UserOps.
 *
 * Two USDC-only scans over the same block range:
 *   - Inbound USDC Transfers (to = wallet)
 *   - Outbound USDC Transfers (from = wallet)
 *
 * Classification via per-tx receipt inspection (economic truth, not heuristic):
 *   - Inbound USDC, tx receipt shows wallet sent any other Transfer → swap return
 *   - Inbound USDC, receipt shows NO outbound Transfer from wallet → DEPOSIT
 *   - Outbound USDC, tx receipt shows wallet received any other Transfer → buy
 *   - Outbound USDC, receipt shows NO inbound Transfer to wallet → WITHDRAWAL
 *
 * Why receipts and not any-token getLogs? Public RPCs reject getLogs without
 * an `address` filter at wide block ranges (too much internal scan cost). By
 * scanning USDC-only (narrow + fast) and inspecting each candidate tx's
 * receipt individually, we get the same correctness as broader scans at
 * O(wallet activity) cost instead of O(block range × chain activity).
 *
 * Strictly more correct than router-allowlist heuristics (no maintenance) and
 * more robust than contract-code heuristics (which would misclassify Privy
 * smart wallet deposits as routers).
 */
import {
  createPublicClient,
  http,
  parseAbiItem,
  formatUnits,
  keccak256,
  toBytes,
  pad,
} from 'viem';
import { activeChain } from '../config/chain-config.js';
import type { OnChainCapitalFlows } from '../types/services.js';

/** keccak256 hash of "Transfer(address,address,uint256)" — event signature topic. */
const TRANSFER_TOPIC = keccak256(toBytes('Transfer(address,address,uint256)'));

function padWalletForTopic(wallet: `0x${string}`): string {
  return pad(wallet, { size: 32 }).toLowerCase();
}

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);

/** ~4 months on Base (2s block time). Covers every fleet bot's entire funding
 *  history at the time of writing. Tunable via RPC_DEPOSIT_SCAN_LOOKBACK_BLOCKS
 *  env var for older wallets. */
const DEFAULT_LOOKBACK_BLOCKS = (() => {
  const envVal = process.env.RPC_DEPOSIT_SCAN_LOOKBACK_BLOCKS;
  if (envVal) {
    try {
      return BigInt(envVal);
    } catch {
      /* fall through to default */
    }
  }
  return 5_000_000n;
})();

/** Most public Base RPCs cap getLogs at 10k blocks per call. */
const BLOCK_CHUNK_SIZE = 10_000n;

/** Sleep between chunks to avoid 429s on free public RPCs. */
const INTER_CHUNK_DELAY_MS = 200;

/** How many times to retry a single chunk, rotating across endpoints, before giving up. */
const MAX_CHUNK_RETRIES = 3;

/** Dust threshold — transfers below this USD value are ignored (airdrops,
 *  approval artifacts, rounding dust). Matches the existing Blockscout code. */
const MIN_DEPOSIT_USD = 1;

export interface RpcDeposit {
  blockNumber: bigint;
  amountUSD: number;
  from: string;
  txHash: string;
  logIndex: number;
}

export interface RpcDepositsResult {
  totalDeposited: number;
  totalWithdrawn: number;
  deposits: RpcDeposit[];
  withdrawals: RpcDeposit[];
  firstDepositUSD: number;
  firstDepositBlock: bigint | null;
  scanFromBlock: bigint;
  scanToBlock: bigint;
  rpcEndpoint: string;
  chunkCount: number;
  /** Inbound USDC Transfers excluded because the tx also had an outbound
   *  Transfer (i.e. swap returns). */
  swapReturnsFiltered: number;
  swapReturnsUsdValue: number;
  /** Outbound USDC Transfers excluded because the tx also had an inbound
   *  Transfer (i.e. buys — token-in paired with USDC-out). */
  buysFiltered: number;
  buysUsdValue: number;
}

function makeClient(endpoint: string) {
  return createPublicClient({
    transport: http(endpoint, { timeout: 15_000, retryCount: 0 }),
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type RawLog = {
  args: { from?: string; to?: string; value?: bigint };
  blockNumber: bigint | null;
  transactionHash: string | null;
  logIndex: number | null;
};

/**
 * Scan USDC Transfer event logs for the given wallet direction, rotating
 * across RPC endpoints per-chunk to tolerate rate-limits / transient 5xx.
 */
async function scanTransfersDirection(
  direction: 'inbound' | 'outbound',
  walletAddress: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
  endpoints: string[],
  verbose: boolean
): Promise<{ logs: RawLog[]; chunkCount: number; endpointUses: Map<string, number> }> {
  const usdcAddress = activeChain.usdc.address as `0x${string}`;
  const baseFilter: Record<string, unknown> =
    direction === 'inbound'
      ? { address: usdcAddress, args: { to: walletAddress } }
      : { address: usdcAddress, args: { from: walletAddress } };
  const logs: RawLog[] = [];
  const endpointUses = new Map<string, number>();
  let chunkCount = 0;
  let endpointCursor = 0;

  for (let start = fromBlock; start <= toBlock; start += BLOCK_CHUNK_SIZE) {
    const chunkEnd =
      start + BLOCK_CHUNK_SIZE - 1n > toBlock ? toBlock : start + BLOCK_CHUNK_SIZE - 1n;

    let chunkLogs: RawLog[] | null = null;
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
      const endpoint = endpoints[endpointCursor % endpoints.length];
      try {
        if (verbose) {
          console.log(
            `  [rpc-deposits:${direction}] ${endpoint} — blocks ${start}..${chunkEnd}` +
              (attempt > 0 ? ` (retry ${attempt})` : '')
          );
        }
        const result = await makeClient(endpoint).getLogs({
          ...baseFilter,
          event: TRANSFER_EVENT,
          fromBlock: start,
          toBlock: chunkEnd,
        } as any);
        chunkLogs = result as unknown as RawLog[];
        endpointUses.set(endpoint, (endpointUses.get(endpoint) ?? 0) + 1);
        break;
      } catch (err: any) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (verbose) {
          console.log(
            `  [rpc-deposits:${direction}] ${endpoint} chunk ${start}..${chunkEnd} failed: ${lastErr.message.slice(0, 80)}`
          );
        }
        endpointCursor++;
        await sleep(INTER_CHUNK_DELAY_MS * (attempt + 1));
      }
    }
    if (chunkLogs === null) {
      throw new Error(
        `Chunk ${start}..${chunkEnd} (${direction}) failed on all ${endpoints.length} endpoints after ${MAX_CHUNK_RETRIES} retries. Last error: ${lastErr?.message ?? 'unknown'}`
      );
    }
    logs.push(...chunkLogs);
    chunkCount++;
    await sleep(INTER_CHUNK_DELAY_MS);
  }

  return { logs, chunkCount, endpointUses };
}

/** Concurrency limit for per-tx receipt fetches. */
const RECEIPT_CONCURRENCY = 8;

interface ReceiptLite {
  logs: Array<{ topics: readonly string[]; address: string }>;
}

/**
 * Fetch `eth_getTransactionReceipt` for each tx, in parallel batches, with
 * RPC endpoint rotation. Failures are swallowed (receipt absent → the caller
 * treats the tx conservatively as a pure deposit/withdrawal rather than a
 * swap, which is the safe-leaning default).
 */
async function fetchReceiptsParallel(
  txHashes: string[],
  endpoints: string[],
  verbose: boolean
): Promise<Map<string, ReceiptLite>> {
  const results = new Map<string, ReceiptLite>();
  if (txHashes.length === 0) return results;

  let endpointCursor = 0;
  const fetchOne = async (txHash: string): Promise<void> => {
    for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
      const endpoint = endpoints[endpointCursor % endpoints.length];
      try {
        const receipt = await makeClient(endpoint).getTransactionReceipt({
          hash: txHash as `0x${string}`,
        });
        results.set(txHash, {
          logs: receipt.logs.map((l: any) => ({
            topics: (l.topics ?? []) as readonly string[],
            address: l.address as string,
          })),
        });
        return;
      } catch (err: any) {
        endpointCursor++;
        if (attempt === MAX_CHUNK_RETRIES - 1 && verbose) {
          console.log(
            `  [rpc-deposits] receipt fetch failed for ${txHash.slice(0, 12)}: ${err?.message?.slice(0, 60) ?? 'unknown'}`
          );
        }
      }
    }
  };

  for (let i = 0; i < txHashes.length; i += RECEIPT_CONCURRENCY) {
    const batch = txHashes.slice(i, i + RECEIPT_CONCURRENCY);
    await Promise.all(batch.map(fetchOne));
    if (verbose && (i / RECEIPT_CONCURRENCY) % 10 === 0) {
      console.log(`  [rpc-deposits] receipts: ${Math.min(i + RECEIPT_CONCURRENCY, txHashes.length)}/${txHashes.length}`);
    }
  }

  return results;
}

/**
 * Identify true USDC deposits to `walletAddress` over the given block range
 * (default: last ~12 days). Filters out swap returns by pairing on tx hash
 * with outbound Transfers (any token) from the same wallet.
 *
 * Throws only if a single chunk fails on every configured RPC endpoint.
 */
export async function detectDepositsViaRpc(
  walletAddress: `0x${string}`,
  opts: { fromBlock?: bigint; verbose?: boolean } = {}
): Promise<RpcDepositsResult> {
  const usdcAddress = (activeChain.usdc.address as `0x${string}`).toLowerCase();
  const decimals = activeChain.usdc.decimals;
  const verbose = opts.verbose ?? false;

  const endpoints = [...activeChain.rpcEndpoints];
  if (endpoints.length === 0) throw new Error('No RPC endpoints configured');

  // Resolve latestBlock by querying several endpoints and taking the MAX.
  // Some endpoints (notably Flashbots RPC, which is a bundler) return badly
  // stale head blocks — "first to answer" would silently scan wrong ranges
  // and return $0 against an active wallet.
  const headResults = await Promise.allSettled(
    endpoints.slice(0, 4).map((ep) => makeClient(ep).getBlockNumber())
  );
  const heads = headResults
    .filter((r): r is PromiseFulfilledResult<bigint> => r.status === 'fulfilled')
    .map((r) => r.value);
  if (heads.length === 0) throw new Error('All RPC endpoints failed on getBlockNumber()');
  const latestBlock = heads.reduce((a, b) => (a > b ? a : b));
  const maxHeadIdx = headResults.findIndex(
    (r) => r.status === 'fulfilled' && r.value === latestBlock
  );
  const headEndpoint = endpoints[maxHeadIdx] ?? endpoints[0];
  if (verbose && heads.length > 1) {
    const min = heads.reduce((a, b) => (a < b ? a : b));
    if (latestBlock - min > 1000n) {
      console.log(
        `  [rpc-deposits] head lag detected: ${min}..${latestBlock} across endpoints (using ${latestBlock})`
      );
    }
  }

  const fromBlock =
    opts.fromBlock ??
    (latestBlock > DEFAULT_LOOKBACK_BLOCKS ? latestBlock - DEFAULT_LOOKBACK_BLOCKS : 0n);

  // Scan inbound + outbound concurrently — symmetric getLogs calls, each with
  // its own per-chunk endpoint rotation. Combining them via tx hash set gives
  // us the deposit/swap-return classification.
  const [inboundResult, outboundResult] = await Promise.all([
    scanTransfersDirection('inbound', walletAddress, fromBlock, latestBlock, endpoints, verbose),
    scanTransfersDirection('outbound', walletAddress, fromBlock, latestBlock, endpoints, verbose),
  ]);

  const isValid = (log: RawLog) =>
    typeof log.args.value === 'bigint' &&
    log.args.value > 0n &&
    !!log.args.from &&
    log.blockNumber !== null &&
    log.transactionHash !== null &&
    log.logIndex !== null;

  // Build the candidate set: every unique tx that moved USDC in either
  // direction. These are the txs we'll fetch receipts for.
  const candidateTxs = new Set<string>();
  for (const log of inboundResult.logs) {
    if (isValid(log)) candidateTxs.add(log.transactionHash!);
  }
  for (const log of outboundResult.logs) {
    if (isValid(log)) candidateTxs.add(log.transactionHash!);
  }

  if (verbose) {
    console.log(
      `  [rpc-deposits] inbound: ${inboundResult.logs.length} logs · outbound: ${outboundResult.logs.length} logs · unique candidate txs: ${candidateTxs.size}`
    );
  }

  // Per-tx receipt inspection. For each candidate tx, look at ALL Transfer
  // logs in the receipt and determine whether the wallet sent or received
  // any other token in the same tx. That tells us if it's a swap or a
  // pure deposit/withdrawal.
  const receiptCache = await fetchReceiptsParallel(
    Array.from(candidateTxs),
    endpoints,
    verbose
  );

  const paddedWallet = padWalletForTopic(walletAddress);

  const walletSentInTx = (txHash: string): boolean => {
    const receipt = receiptCache.get(txHash);
    if (!receipt) return false; // receipt fetch failed — conservative: treat as pure deposit
    return receipt.logs.some(
      (l) =>
        l.topics[0] === TRANSFER_TOPIC &&
        l.topics[1]?.toLowerCase() === paddedWallet
    );
  };
  const walletReceivedInTx = (txHash: string): boolean => {
    const receipt = receiptCache.get(txHash);
    if (!receipt) return false;
    return receipt.logs.some(
      (l) =>
        l.topics[0] === TRANSFER_TOPIC &&
        l.topics[2]?.toLowerCase() === paddedWallet
    );
  };

  // Deposits: inbound USDC where wallet did NOT also send anything in the tx.
  const deposits: RpcDeposit[] = [];
  let swapReturnsFiltered = 0;
  let swapReturnsUsdValue = 0;

  for (const log of inboundResult.logs) {
    if (!isValid(log)) continue;
    const amountUSD = Number(formatUnits(log.args.value!, decimals));
    if (amountUSD < MIN_DEPOSIT_USD) continue;
    if (walletSentInTx(log.transactionHash!)) {
      swapReturnsFiltered++;
      swapReturnsUsdValue += amountUSD;
      continue;
    }
    deposits.push({
      blockNumber: log.blockNumber!,
      amountUSD,
      from: log.args.from!.toLowerCase(),
      txHash: log.transactionHash!,
      logIndex: log.logIndex!,
    });
  }

  // Withdrawals: outbound USDC where wallet did NOT also receive anything in the tx.
  const withdrawals: RpcDeposit[] = [];
  let buysFiltered = 0;
  let buysUsdValue = 0;

  for (const log of outboundResult.logs) {
    if (!isValid(log)) continue;
    const amountUSD = Number(formatUnits(log.args.value!, decimals));
    if (amountUSD < MIN_DEPOSIT_USD) continue;
    if (walletReceivedInTx(log.transactionHash!)) {
      buysFiltered++;
      buysUsdValue += amountUSD;
      continue;
    }
    withdrawals.push({
      blockNumber: log.blockNumber!,
      amountUSD,
      from: (log.args as any).to?.toLowerCase() ?? '', // for withdrawals, this field stores the destination
      txHash: log.transactionHash!,
      logIndex: log.logIndex!,
    });
  }

  const sortByBlock = (a: RpcDeposit, b: RpcDeposit) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
    return a.logIndex - b.logIndex;
  };
  deposits.sort(sortByBlock);
  withdrawals.sort(sortByBlock);

  const totalDeposited = deposits.reduce((s, d) => s + d.amountUSD, 0);
  const totalWithdrawn = withdrawals.reduce((s, w) => s + w.amountUSD, 0);
  const firstDeposit = deposits[0];

  // Combine endpoint-usage tallies from both scans for reporting.
  const combinedUses = new Map<string, number>();
  for (const [ep, n] of inboundResult.endpointUses)
    combinedUses.set(ep, (combinedUses.get(ep) ?? 0) + n);
  for (const [ep, n] of outboundResult.endpointUses)
    combinedUses.set(ep, (combinedUses.get(ep) ?? 0) + n);
  const primaryEndpoint =
    [...combinedUses.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? headEndpoint;

  if (verbose) {
    console.log(
      `  [rpc-deposits] classified: ${deposits.length} deposits ($${totalDeposited.toFixed(2)}) · ${withdrawals.length} withdrawals ($${totalWithdrawn.toFixed(2)}) · filtered ${swapReturnsFiltered} swap-ins + ${buysFiltered} buys`
    );
  }

  return {
    totalDeposited: Math.round(totalDeposited * 100) / 100,
    deposits,
    withdrawals,
    totalWithdrawn: Math.round(totalWithdrawn * 100) / 100,
    firstDepositUSD: firstDeposit?.amountUSD ?? 0,
    firstDepositBlock: firstDeposit?.blockNumber ?? null,
    scanFromBlock: fromBlock,
    scanToBlock: latestBlock,
    rpcEndpoint: primaryEndpoint,
    chunkCount: inboundResult.chunkCount + outboundResult.chunkCount,
    swapReturnsFiltered,
    swapReturnsUsdValue: Math.round(swapReturnsUsdValue * 100) / 100,
    buysFiltered,
    buysUsdValue: Math.round(buysUsdValue * 100) / 100,
  };
}

/**
 * Public entry point matching the existing `detectOnChainCapitalFlows` shape
 * (Blockscout-based, exported from ./capital-flows.js). Drop-in replacement
 * for CDP Smart Wallets where Blockscout's tokentx endpoint is blind.
 *
 * Timestamps are derived from block numbers using Base's 2s block time —
 * accurate to a few seconds, sufficient for P&L display.
 */
export async function detectCapitalFlowsViaRpc(
  walletAddress: `0x${string}`,
  opts: { fromBlock?: bigint; verbose?: boolean } = {}
): Promise<OnChainCapitalFlows> {
  const result = await detectDepositsViaRpc(walletAddress, opts);
  const nowMs = Date.now();
  const latestBlock = result.scanToBlock;

  const toTimestamp = (blockNumber: bigint): string => {
    const secondsAgo = Number(latestBlock - blockNumber) * 2; // Base block time
    return new Date(nowMs - secondsAgo * 1000).toISOString();
  };

  return {
    totalDeposited: result.totalDeposited,
    totalWithdrawn: result.totalWithdrawn,
    netCapitalIn: Math.round((result.totalDeposited - result.totalWithdrawn) * 100) / 100,
    deposits: result.deposits.map((d) => ({
      timestamp: toTimestamp(d.blockNumber),
      amountUSD: d.amountUSD,
      from: d.from,
      txHash: d.txHash,
    })),
    withdrawals: result.withdrawals.map((w) => ({
      timestamp: toTimestamp(w.blockNumber),
      amountUSD: w.amountUSD,
      to: w.from, // we stored destination in `from` field for withdrawals
      txHash: w.txHash,
    })),
    lastUpdated: new Date(nowMs).toISOString(),
  };
}
