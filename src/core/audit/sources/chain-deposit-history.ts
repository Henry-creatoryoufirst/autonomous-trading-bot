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
 * Classification (the May-22 rebuild — fixes the $66K false-positive on
 * master). The previous logic only excluded ONE swap router (Aerodrome
 * Universal Router). Every USDC inflow from 1inch / Uniswap V3 /
 * KyberSwap / internal pools / etc. got misclassified as a user deposit,
 * which made INV-11 fire SEVERE for $66,463 "UNDER-COUNTED" on master.
 * The signal was real (deposit tracking IS drifting) but the bug poisoned
 * it. The rebuild is a hybrid classifier:
 *
 *   1) Primary — bot's own tx graph. If the inflow's txHash matches a
 *      txHash the bot recorded in state.tradeHistory, it's a swap proceed
 *      from the bot's own activity. NOT a deposit. This is the cleanest
 *      signal because it requires no router-list maintenance.
 *
 *   2) Fallback — known-router exclusion. For txes we can't cross-
 *      reference (partial state restore, manual swaps, pre-tracking),
 *      check the `from` address against a list of known DEX routers /
 *      aggregators on Base. NOT a deposit.
 *
 *   3) Safe-by-default — when neither matches, count it as a deposit.
 *      Per Henry's spec: a false-positive deposit is annoying; a
 *      false-negative would hide real drift.
 *
 * Implementation:
 *   - eth_getLogs against USDC contract for Transfer events where to=wallet
 *   - Chunked block ranges to avoid RPC limits (~10K blocks per chunk on Base)
 *   - Classify each inflow via the hybrid above
 *   - Returns sum + per-deposit detail so INV-11 can name the missing ones
 *
 * Cost: ~50-100 RPC calls for a full historical scan (Base has been alive
 * for ~600 days, ~30M blocks). Cache the result and re-scan only
 * incrementally on subsequent calls.
 */

import { rpcCall } from '../../execution/rpc.js';

const USDC_BASE_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * Known DEX router / aggregator / executor addresses on Base, lowercased.
 * Inflows whose `from` matches one of these are SWAP PROCEEDS, not capital
 * deposits.
 *
 * Maintenance philosophy: this list is a safety net for txes we can't
 * cross-reference against the bot's own tradeHistory (the primary path).
 * It does NOT need to be exhaustive — the cross-reference catches every
 * bot-initiated swap regardless of router. New routers only need to be
 * added if a bot operator notices a false-positive deposit from one.
 *
 * Sources (verified May 2026 on basescan + each project's official docs):
 *   - Aerodrome Universal Router — bot's primary execution venue
 *   - Aerodrome Slipstream Universal Router — concentrated-liquidity venue
 *   - 1inch Aggregation Router V5 — common aggregator
 *   - 1inch Aggregation Router V6 — common aggregator
 *   - Uniswap V3 SwapRouter02 — fallback DEX
 *   - Uniswap Universal Router — V2/V3/V4 unified router
 *   - KyberSwap Aggregation Router — aggregator
 *   - OpenOcean Router — aggregator
 *   - 0x Settler — 0x v2 settlement
 *   - 0x Exchange Proxy — 0x v1
 *   - Paraswap Augustus V5 / V6 — aggregator
 *   - CoW Protocol GPv2 Settlement — solver-based DEX
 *   - Odos Router V2 — aggregator
 *   - LiFi Diamond — bridge + DEX aggregator
 *   - Squid Router — cross-chain via Axelar
 *   - Across SpokePool — bridge (occasional swap output)
 */
const KNOWN_DEX_ROUTERS_LOWERCASE: ReadonlyArray<string> = [
  // Aerodrome (bot's primary venue on Base)
  '0x7747f8d2a76bd6345cc29622a946a929647f2359', // Aerodrome Universal Router
  '0x6cb442acf35158d5eda88fe602221b67b400be3e', // Aerodrome Slipstream UR
  // 1inch
  '0x1111111254eeb25477b68fb85ed929f73a960582', // 1inch V5
  '0x111111125421ca6dc452d289314280a0f8842a65', // 1inch V6
  // Uniswap
  '0x2626664c2603336e57b271c5c0b26f421741e481', // Uniswap V3 SwapRouter02 (Base)
  '0x6ff5693b99212da76ad316178a184ab56d299b43', // Uniswap Universal Router (Base)
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', // Uniswap Universal Router (older)
  // KyberSwap
  '0x6131b5fae19ea4f9d964eac0408e4408b66337b5', // KyberSwap Aggregation Router
  // OpenOcean
  '0x6352a56caadc4f1e25cd6c75970fa768a3304e64', // OpenOcean Exchange v2
  // 0x
  '0x0000000000001ff3684f28c67538d4d072c22734', // 0x Settler (Base)
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff', // 0x Exchange Proxy
  // Paraswap
  '0xdef171fe48cf0115b1d80b88dc8eab59176fee57', // Paraswap Augustus V5
  '0x6a000f20005980200259b80c5102003040001068', // Paraswap Augustus V6
  // CoW Protocol
  '0x9008d19f58aabd9ed0d60971565aa8510560ab41', // CoW GPv2 Settlement
  // Odos
  '0x19ceead7105607cd444f5ad10dd51356436095a1', // Odos Router V2 (Base)
  // LiFi / cross-chain
  '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae', // LiFi Diamond
  '0xce16f69375520ab01377ce7b88f5ba8c48f8d666', // Squid Router
];

const DEPOSIT_DUST_THRESHOLD_USD = 1.0;
const BLOCKS_PER_CHUNK = 10_000;

/**
 * Why an inflow was excluded (or included) — surfaced for operator
 * visibility and test assertions. Records that end up COUNTED have
 * classification === 'counted-as-deposit'; everything else is excluded.
 */
export type DepositClassification =
  | 'counted-as-deposit'      // safe-by-default — neither a known router nor a bot tx
  | 'excluded-bot-trade'      // primary path: txHash matched bot tradeHistory
  | 'excluded-known-router'   // fallback path: `from` matched the router list
  | 'excluded-dust';          // below the $1 threshold

export interface DepositRecord {
  blockNumber: number;
  txHash: string;
  fromAddress: string;
  usdValue: number;
  /**
   * Why this transfer landed where it did. Included on every record
   * (deposits AND excluded inflows when surfaced via diagnostics).
   * Records persisted in `ChainDepositHistory.deposits` are always
   * `counted-as-deposit` — excluded inflows are filtered out before
   * persistence, but the classification is preserved on the record for
   * tests / debug logs.
   */
  classification: DepositClassification;
}

export interface ChainDepositHistory {
  walletAddress: string;
  capturedAt: string;
  /** Sum of all non-router, non-bot-trade, > $1 USDC inflows since the wallet's first block. */
  totalDepositedUsd: number;
  /** Per-deposit list (counted only), most recent first, capped at 50 for memory. */
  deposits: DepositRecord[];
  /** Highest block number we scanned to. Used for incremental updates. */
  lastScannedBlock: number;
  /** True iff the full historical scan completed without RPC errors. */
  complete: boolean;
  errors: string[];
  /**
   * Diagnostic counters — how many inflows landed in each classification
   * bucket on this scan. Useful for "is the router list working?" sanity
   * checks; logged once per refresh, not persisted long-term.
   */
  classificationCounts: {
    counted: number;
    excludedBotTrade: number;
    excludedKnownRouter: number;
    excludedDust: number;
  };
}

function padTopic(addr: string): string {
  return '0x000000000000000000000000' + addr.toLowerCase().replace(/^0x/, '');
}

function blockToHex(b: number): string {
  return '0x' + b.toString(16);
}

/**
 * Normalize a tx hash to the lowercase form the JSON-RPC layer emits.
 * The bot stores hashes in this form too (Coinbase SDK + ethers both
 * lowercase by default), but be defensive — a single mixed-case hash
 * sneaking in would silently break the cross-reference and reopen the
 * false-positive.
 */
function normalizeHash(h: string | undefined | null): string {
  if (!h) return '';
  const s = h.toLowerCase();
  return s.startsWith('0x') ? s : '0x' + s;
}

/**
 * Classify a single inbound USDC transfer.
 *
 * Order matters:
 *   1. Dust check first — cheap, eliminates noise before any address work.
 *   2. Bot-tradeHistory cross-reference second — primary path, no list to maintain.
 *   3. Known-router list third — fallback for txes we can't cross-reference.
 *   4. Safe default last — count as deposit.
 *
 * Both the inflow tx-hash AND the set members are normalized to the
 * lowercase form before comparison. This is critical: if a single
 * mixed-case hash slipped in from either side, the cross-reference
 * would silently fail open and re-open the $66K false-positive that
 * motivated this rebuild.
 *
 * Exported for tests so the classifier can be exercised independently
 * of the RPC layer.
 */
export function classifyInflow(args: {
  fromAddress: string;
  txHash: string;
  usdValue: number;
  botTxHashes: ReadonlySet<string>;
}): DepositClassification {
  const { fromAddress, txHash, usdValue, botTxHashes } = args;
  if (usdValue < DEPOSIT_DUST_THRESHOLD_USD) return 'excluded-dust';
  const txKey = normalizeHash(txHash);
  if (txKey) {
    // Fast path: caller already normalized (fetchChainDepositHistory does).
    if (botTxHashes.has(txKey)) return 'excluded-bot-trade';
    // Defensive path: caller passed a Set with mixed-case entries. Scan
    // once with case-insensitive compare. Hits this path only when the
    // primary fast lookup misses, so the O(n) cost is paid only on cache
    // misses + only at most once per inflow.
    for (const h of botTxHashes) {
      if (normalizeHash(h) === txKey) return 'excluded-bot-trade';
    }
  }
  const fromKey = fromAddress.toLowerCase();
  if (KNOWN_DEX_ROUTERS_LOWERCASE.includes(fromKey)) return 'excluded-known-router';
  return 'counted-as-deposit';
}

/** Exported for tests + future telemetry. Lowercased addresses only. */
export function getKnownDexRouters(): ReadonlyArray<string> {
  return KNOWN_DEX_ROUTERS_LOWERCASE;
}

/**
 * Pull all USDC inflows to the wallet across chain history. Chunks the
 * scan to stay under Base RPC's per-query log limits.
 *
 * @param walletAddress  The wallet to scan (typically CONFIG.walletAddress)
 * @param fromBlock      Starting block. Pass 0 for "from genesis" or
 *                       lastScannedBlock + 1 for incremental updates.
 * @param botTxHashes    Optional. The bot's own trade tx hashes (from
 *                       state.tradeHistory[*].txHash). Used to cross-
 *                       reference inflows so swap proceeds don't get
 *                       counted as deposits. Can be a Set or an Iterable
 *                       (the function normalizes to a Set internally).
 *                       Missing/empty = router-list fallback handles
 *                       everything (still safer than the pre-rebuild
 *                       single-router exclusion).
 */
export async function fetchChainDepositHistory(args: {
  walletAddress: string;
  fromBlock?: number;
  /** Optional cap on history depth — useful for tests. Default: full history. */
  maxBlocksBack?: number;
  /** Optional bot-trade tx hashes for the primary classification path. */
  botTxHashes?: Iterable<string> | ReadonlySet<string>;
}): Promise<ChainDepositHistory> {
  const { walletAddress, fromBlock = 0, maxBlocksBack, botTxHashes } = args;
  const errors: string[] = [];
  const deposits: DepositRecord[] = [];
  const walletTopic = padTopic(walletAddress);

  // Normalize bot tx hashes once up front so the per-log classification
  // is O(1). A missing/empty iterable just collapses to an empty Set —
  // the classifier falls back to the router list.
  const botTxHashSet: ReadonlySet<string> = (() => {
    if (!botTxHashes) return new Set<string>();
    if (botTxHashes instanceof Set) {
      const norm = new Set<string>();
      for (const h of botTxHashes) norm.add(normalizeHash(h));
      return norm;
    }
    const norm = new Set<string>();
    for (const h of botTxHashes) norm.add(normalizeHash(h));
    return norm;
  })();

  const classificationCounts = {
    counted: 0,
    excludedBotTrade: 0,
    excludedKnownRouter: 0,
    excludedDust: 0,
  };

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
      classificationCounts,
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
          const txHash = normalizeHash(log.transactionHash);
          const classification = classifyInflow({
            fromAddress: fromAddr,
            txHash,
            usdValue,
            botTxHashes: botTxHashSet,
          });
          switch (classification) {
            case 'excluded-dust':
              classificationCounts.excludedDust += 1;
              continue;
            case 'excluded-bot-trade':
              classificationCounts.excludedBotTrade += 1;
              continue;
            case 'excluded-known-router':
              classificationCounts.excludedKnownRouter += 1;
              continue;
            case 'counted-as-deposit':
              classificationCounts.counted += 1;
              deposits.push({
                blockNumber: parseInt(log.blockNumber, 16),
                txHash,
                fromAddress: fromAddr,
                usdValue,
                classification: 'counted-as-deposit',
              });
              break;
          }
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
    classificationCounts,
  };
}
