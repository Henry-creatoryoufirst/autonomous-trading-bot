/**
 * NVR-SPEC-022 — Specialist Observation Pass on Base
 *
 * Inverts the v22 loop: instead of "theorize a pattern, then test it
 * against history" (which has produced 3 KILLs in 3 days with 0
 * positives), this script *observes the data first* and lets pattern
 * hypotheses fall out of empirical recurrence.
 *
 * Procedure:
 *   1. Pick 3 high-volume Base tokens (AERO, BRETT, DEGEN by default)
 *   2. Pull 14 days of minute-resolution OHLCV via GeckoTerminal
 *   3. Detect every 1-hour move >= 5% (up or down) — the "events of interest"
 *   4. For each move, fetch pool-side BUY events in the 2-hour PRE-window
 *      (windowed RPC fetch — keeps load tractable vs. fetching all 14 days)
 *   5. Dump structured per-move records to disk for signature analysis
 *
 * The output is NOT a pattern. It's a research dataset:
 *
 *   data/observation-pass/
 *     2026-04-29-AERO-moves.json    - {moves: [{ts, magnitude, direction, prewindow_buys}]}
 *     2026-04-29-BRETT-moves.json
 *     2026-04-29-DEGEN-moves.json
 *     2026-04-29-summary.json       - cross-token aggregates
 *
 * Run:
 *   npx tsx scripts/observation-pass-base.ts
 *
 * Environment:
 *   OBSERVATION_LOOKBACK_HOURS    default 336 (14 days)
 *   OBSERVATION_MOVE_THRESHOLD    default 0.05 (5%)
 *   OBSERVATION_PRE_WINDOW_HOURS  default 2.0
 *   OBSERVATION_MOVE_WINDOW_HOURS default 1.0 (sliding window for move detection)
 *   OBSERVATION_TOKENS            default 'AERO,BRETT,DEGEN'
 *
 * Why this script exists:
 *   See `feedback_specialist_depth_beats_breadth` and
 *   `feedback_ai_does_what_humans_cant`. The hunt for v22's first
 *   *positive* verdict has been blocked by inputs (theory-first patterns)
 *   not by the framework. Observation produces grounded inputs.
 */

import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createPublicClient, http } from "viem";

import { GeckoTerminalHistoricalFeed } from "../src/simulation/data/price-feed.js";
import { fetchPoolBuys } from "../src/simulation/data/pool-buys.js";
import { activeChain } from "../src/core/config/chain-config.js";

// ----------------------------------------------------------------------------
// Router / aggregator blacklist
// ----------------------------------------------------------------------------

/**
 * Addresses that intermediate swaps (the "buyer" in a pool→X Transfer is
 * actually one of these contracts which then forwards to the real user).
 * Including them inflates buy counts and USD volume because a single
 * user swap can cross 2-4 of these contracts.
 *
 * For the observation pass we want signal from REAL users — accumulation,
 * new wallet waves, whale entries. Routers are noise. We segregate them
 * into a separate stats bucket rather than dropping them, so we can see
 * the routed-volume separately.
 */
const KNOWN_ROUTERS_LOWER: ReadonlySet<string> = new Set([
  "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24", // Aerodrome router
  "0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43", // Aerodrome universal router
  "0x2626664c2603336e57b271c5c0b26f421741e481", // Uniswap V3 SwapRouter02
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad", // Uniswap universal router
  "0x000000000022d473030f116ddee9f6b43ac78ba3", // Permit2
  "0x6ff5693b99212da76ad316178a184ab56d299b43", // Universal router v2 on Base
  "0x6cb442acf35158d5eda88fe602221b67b400be3e", // Aerodrome Slipstream universal router
  "0x827922686190790b37229fd06084350e74485b72", // Aerodrome additional router
  "0x111111125421ca6dc452d289314280a0f8842a65", // 1inch v6
  "0x1111111254eeb25477b68fb85ed929f73a960582", // 1inch v5
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff", // 0x exchange proxy
]);

/**
 * Heuristic: any wallet making more than this many pool→X transfers in
 * a 2-hour pre-window is treated as a router/MEV bot, not a real buyer.
 * Real users rarely make >10 swaps in 2 hours.
 */
const BOT_BUY_COUNT_THRESHOLD = 25;

interface ClassifiedBuy {
  buyerWallet: string;
  poolAddress: string;
  amountTokensRaw: bigint;
  amountUsd: number | null;
  ts: string;
  txHash: string;
  classification: "user" | "router" | "bot";
}

// ----------------------------------------------------------------------------
// Token + pool config (top-by-reserve as of 2026-04-29 via GeckoTerminal)
// ----------------------------------------------------------------------------

interface TokenWatch {
  symbol: string;
  address: string;
  /** Top liquidity pool(s) on Base. Lowercased. Order = priority. */
  pools: string[];
  /** Token decimals (for amount → human-readable). */
  decimals: number;
}

const TOKEN_WATCHES: TokenWatch[] = [
  {
    symbol: "AERO",
    address: "0x940181a94a35a4569e4529a3cdfb74e38fd98631",
    pools: [
      "0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d", // AERO/USDC top pool
      "0x82321f3beb69f503380d6b233857d5c43562e2d0", // AERO/WETH
    ],
    decimals: 18,
  },
  {
    symbol: "BRETT",
    address: "0x532f27101965dd16442e59d40670faf5ebb142e4",
    pools: [
      "0x4e829f8a5213c42535ab84aa40bd4adcce9cba02", // BRETT main
      "0xba3f945812a83471d709bce9c3ca699a19fb46f7",
    ],
    decimals: 18,
  },
  {
    symbol: "DEGEN",
    address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed",
    pools: [
      "0xc9034c3e7f58003e6ae0c8438e7c8f4598d5acaa", // DEGEN main
    ],
    decimals: 18,
  },
];

// ----------------------------------------------------------------------------
// Config (env-overridable)
// ----------------------------------------------------------------------------

const LOOKBACK_HOURS = parseInt(
  process.env.OBSERVATION_LOOKBACK_HOURS ?? "336",
  10,
);
const MOVE_THRESHOLD = parseFloat(
  process.env.OBSERVATION_MOVE_THRESHOLD ?? "0.05",
);
const PRE_WINDOW_HOURS = parseFloat(
  process.env.OBSERVATION_PRE_WINDOW_HOURS ?? "2.0",
);
const MOVE_WINDOW_HOURS = parseFloat(
  process.env.OBSERVATION_MOVE_WINDOW_HOURS ?? "1.0",
);
const TOKEN_FILTER = (process.env.OBSERVATION_TOKENS ?? "AERO,BRETT,DEGEN")
  .split(",")
  .map((t) => t.trim().toUpperCase())
  .filter(Boolean);

const BASE_BLOCK_TIME_SEC = 2;

// ----------------------------------------------------------------------------
// Block ↔ timestamp helper
// ----------------------------------------------------------------------------

interface BlockAnchor {
  blockNumber: bigint;
  unixSec: number;
}

async function getBlockAnchor(): Promise<BlockAnchor> {
  const endpoints = activeChain.rpcEndpoints.filter(
    (e) => !["flashbots.net", "sequencer.base.org"].some((h) => e.includes(h)),
  );
  if (!endpoints.length) throw new Error("no usable Base RPC endpoint");
  let lastErr: Error | null = null;
  for (const endpoint of endpoints) {
    try {
      const client = createPublicClient({
        transport: http(endpoint, { timeout: 10_000, retryCount: 0 }),
      });
      const block = await client.getBlock();
      return {
        blockNumber: block.number ?? 0n,
        unixSec: Number(block.timestamp ?? 0),
      };
    } catch (e) {
      lastErr = e as Error;
      console.warn(
        `  [anchor] ${endpoint}: ${(e as Error).message?.slice(0, 80)}, trying next...`,
      );
    }
  }
  throw new Error(
    `getBlockAnchor: all ${endpoints.length} endpoints failed; last: ${lastErr?.message}`,
  );
}

/**
 * Estimate the Base block number for a Unix timestamp.
 * Linear from a known anchor; accurate to ~1 block on stable Base.
 */
function blockAtTime(anchor: BlockAnchor, unixSec: number): bigint {
  const deltaSec = unixSec - anchor.unixSec;
  const deltaBlocks = BigInt(Math.round(deltaSec / BASE_BLOCK_TIME_SEC));
  const block = anchor.blockNumber + deltaBlocks;
  return block < 0n ? 0n : block;
}

/** Inverse: estimate Unix timestamp for a block number, linear from anchor. */
function timeAtBlock(anchor: BlockAnchor, blockNumber: bigint): number {
  const deltaBlocks = Number(blockNumber - anchor.blockNumber);
  return anchor.unixSec + deltaBlocks * BASE_BLOCK_TIME_SEC;
}

// ----------------------------------------------------------------------------
// Move detection
// ----------------------------------------------------------------------------

interface DetectedMove {
  symbol: string;
  /** ISO of the move's anchor close (the candle that finished the >=5% swing). */
  anchorCloseISO: string;
  anchorCloseTs: number; // unix sec
  /** ISO of the start price (high or low against which we measured). */
  fromTs: number;
  /** Magnitude in [-1, 1]; sign = direction. */
  pctChange: number;
  fromPrice: number;
  toPrice: number;
  /** OHLCV in the move window for context. */
  windowVolumeUsd: number;
  windowCandleCount: number;
}

interface CandlePoint {
  ts: number; // unix sec, candle start
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
}

/**
 * For each candle, look back MOVE_WINDOW_HOURS and compute (max - min) /
 * baseline. Emit one move per direction-flip exceeding MOVE_THRESHOLD.
 *
 * To avoid duplicating one big move across many overlapping windows we
 * de-dup by greedy non-overlap: after emitting a move at time T, skip
 * any subsequent move whose anchor is within MOVE_WINDOW_HOURS of T.
 */
function detectMoves(symbol: string, candles: CandlePoint[]): DetectedMove[] {
  if (candles.length < 4) return [];

  const out: DetectedMove[] = [];
  const windowSec = MOVE_WINDOW_HOURS * 3600;
  let lastEmitTs = -Infinity;

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const anchorTs = c.ts;
    if (anchorTs - lastEmitTs < windowSec) continue;

    const windowStart = anchorTs - windowSec;
    let lo = Infinity;
    let hi = -Infinity;
    let loTs = anchorTs;
    let hiTs = anchorTs;
    let volSum = 0;
    let count = 0;

    for (let j = i; j >= 0; j--) {
      const cc = candles[j]!;
      if (cc.ts < windowStart) break;
      if (cc.low < lo) {
        lo = cc.low;
        loTs = cc.ts;
      }
      if (cc.high > hi) {
        hi = cc.high;
        hiTs = cc.ts;
      }
      volSum += cc.volumeUsd;
      count++;
    }
    if (lo === Infinity || hi === -Infinity || lo <= 0) continue;

    // Direction = whichever of (hi appears AFTER lo) or (lo appears AFTER hi)
    // The "move" is from the earlier extreme to the later one.
    let fromPrice: number;
    let toPrice: number;
    let fromTs: number;
    if (hiTs >= loTs) {
      // Up-move: low first, high later (or coincident)
      fromPrice = lo;
      toPrice = hi;
      fromTs = loTs;
    } else {
      // Down-move: high first, low later
      fromPrice = hi;
      toPrice = lo;
      fromTs = hiTs;
    }
    const pct = (toPrice - fromPrice) / fromPrice;
    if (Math.abs(pct) < MOVE_THRESHOLD) continue;

    out.push({
      symbol,
      anchorCloseISO: new Date(anchorTs * 1000).toISOString(),
      anchorCloseTs: anchorTs,
      fromTs,
      pctChange: pct,
      fromPrice,
      toPrice,
      windowVolumeUsd: volSum,
      windowCandleCount: count,
    });
    lastEmitTs = anchorTs;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Per-move axis dump
// ----------------------------------------------------------------------------

interface PreWindowAxes {
  fromTs: number;
  toTs: number;
  /** Buys grouped by 5-min buckets, USER-classified only. */
  buyBuckets: Array<{
    bucketStartTs: number;
    userCount: number;
    userTotalAmountUsd: number;
    routerCount: number;
    routerTotalAmountUsd: number;
  }>;
  /** Top 20 individual USER buys by USD size in the pre-window. */
  largestUserBuys: Array<{
    timestamp: string;
    buyerWallet: string;
    poolAddress: string;
    amountTokensRaw: string;
    amountUsd: number | null;
    txHash: string;
  }>;
  /** Counts (raw event-level, not deduped by tx). */
  totalBuys: number;
  userBuys: number;
  routerBuys: number;
  botBuys: number;
  /** Distinct USER wallets only (excludes routers/bots). */
  uniqueUserBuyers: number;
  /** Top 10 USER buyer wallets by aggregated USD spent. */
  topUserBuyers: Array<{ wallet: string; totalUsd: number; buyCount: number }>;
  /** USD volume by classification. */
  userBuyVolumeUsd: number;
  routerBuyVolumeUsd: number;
  botBuyVolumeUsd: number;
  /** Distinct tx-hashes (deduped count) in the window — closer to real swap count. */
  distinctTxs: number;
}

async function buildPreWindowAxes(opts: {
  move: DetectedMove;
  watch: TokenWatch;
  feed: GeckoTerminalHistoricalFeed;
  anchor: BlockAnchor;
}): Promise<PreWindowAxes> {
  const { move, watch, feed, anchor } = opts;
  const toTs = move.fromTs; // pre-window ends when the move BEGAN
  const fromTs = toTs - PRE_WINDOW_HOURS * 3600;
  const fromBlock = blockAtTime(anchor, fromTs);
  const toBlock = blockAtTime(anchor, toTs);

  const result = await fetchPoolBuys({
    tokenAddress: watch.address,
    poolAddresses: watch.pools,
    fromBlock,
    toBlock,
    verbose: false,
  });

  const decimalsDiv = 10 ** watch.decimals;

  // Derive each buy's timestamp from anchor + block (linear approx — accurate
  // to a few seconds on Base). Then USD-convert via cached price feed.
  const buysWithUsd = await Promise.all(
    result.buys.map(async (b) => {
      const tokens = Number(b.amountTokensRaw) / decimalsDiv;
      const tsSec = timeAtBlock(anchor, b.blockNumber);
      const ts = new Date(tsSec * 1000).toISOString();
      const px = await feed.getPriceAt(watch.symbol, ts);
      const amountUsd = px && tokens > 0 ? tokens * px : null;
      return { ...b, tokens, amountUsd, ts };
    }),
  );

  // First pass — compute per-wallet buy count (used for bot detection)
  const walletBuyCount = new Map<string, number>();
  for (const b of buysWithUsd) {
    walletBuyCount.set(b.buyerWallet, (walletBuyCount.get(b.buyerWallet) ?? 0) + 1);
  }

  // Classify each buy
  const classified: ClassifiedBuy[] = buysWithUsd.map((b) => {
    let classification: "user" | "router" | "bot";
    if (KNOWN_ROUTERS_LOWER.has(b.buyerWallet)) {
      classification = "router";
    } else if ((walletBuyCount.get(b.buyerWallet) ?? 0) > BOT_BUY_COUNT_THRESHOLD) {
      classification = "bot";
    } else {
      classification = "user";
    }
    return {
      buyerWallet: b.buyerWallet,
      poolAddress: b.poolAddress,
      amountTokensRaw: b.amountTokensRaw,
      amountUsd: b.amountUsd,
      ts: b.ts,
      txHash: b.txHash,
      classification,
    };
  });

  // 5-min buckets — separate user vs router/bot stats
  const BUCKET_SEC = 300;
  const bucketMap = new Map<
    number,
    {
      bucketStartTs: number;
      userCount: number;
      userTotalAmountUsd: number;
      routerCount: number;
      routerTotalAmountUsd: number;
    }
  >();
  for (const b of classified) {
    const ts = Math.floor(Date.parse(b.ts) / 1000);
    const bucket = Math.floor(ts / BUCKET_SEC) * BUCKET_SEC;
    const slot = bucketMap.get(bucket) ?? {
      bucketStartTs: bucket,
      userCount: 0,
      userTotalAmountUsd: 0,
      routerCount: 0,
      routerTotalAmountUsd: 0,
    };
    if (b.classification === "user") {
      slot.userCount++;
      slot.userTotalAmountUsd += b.amountUsd ?? 0;
    } else {
      slot.routerCount++;
      slot.routerTotalAmountUsd += b.amountUsd ?? 0;
    }
    bucketMap.set(bucket, slot);
  }
  const buyBuckets = Array.from(bucketMap.values()).sort(
    (a, b) => a.bucketStartTs - b.bucketStartTs,
  );

  // Largest 20 USER buys by USD
  const largestUserBuys = classified
    .filter((b) => b.classification === "user")
    .filter((b) => b.amountUsd !== null && b.amountUsd > 0)
    .sort((a, b) => (b.amountUsd ?? 0) - (a.amountUsd ?? 0))
    .slice(0, 20)
    .map((b) => ({
      timestamp: b.ts,
      buyerWallet: b.buyerWallet,
      poolAddress: b.poolAddress,
      amountTokensRaw: b.amountTokensRaw.toString(),
      amountUsd: b.amountUsd,
      txHash: b.txHash,
    }));

  // Top USER buyers by aggregated USD
  const userBuyerAgg = new Map<
    string,
    { wallet: string; totalUsd: number; buyCount: number }
  >();
  for (const b of classified) {
    if (b.classification !== "user") continue;
    const slot = userBuyerAgg.get(b.buyerWallet) ?? {
      wallet: b.buyerWallet,
      totalUsd: 0,
      buyCount: 0,
    };
    slot.totalUsd += b.amountUsd ?? 0;
    slot.buyCount++;
    userBuyerAgg.set(b.buyerWallet, slot);
  }
  const topUserBuyers = Array.from(userBuyerAgg.values())
    .sort((a, b) => b.totalUsd - a.totalUsd)
    .slice(0, 10);

  // Aggregate counts and volumes by classification
  let userBuys = 0;
  let routerBuys = 0;
  let botBuys = 0;
  let userBuyVolumeUsd = 0;
  let routerBuyVolumeUsd = 0;
  let botBuyVolumeUsd = 0;
  const distinctTxSet = new Set<string>();
  for (const b of classified) {
    distinctTxSet.add(b.txHash);
    if (b.classification === "user") {
      userBuys++;
      userBuyVolumeUsd += b.amountUsd ?? 0;
    } else if (b.classification === "router") {
      routerBuys++;
      routerBuyVolumeUsd += b.amountUsd ?? 0;
    } else {
      botBuys++;
      botBuyVolumeUsd += b.amountUsd ?? 0;
    }
  }

  return {
    fromTs,
    toTs,
    buyBuckets,
    largestUserBuys,
    totalBuys: result.buys.length,
    userBuys,
    routerBuys,
    botBuys,
    uniqueUserBuyers: userBuyerAgg.size,
    topUserBuyers,
    userBuyVolumeUsd,
    routerBuyVolumeUsd,
    botBuyVolumeUsd,
    distinctTxs: distinctTxSet.size,
  };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log("=== NVR Specialist Observation Pass ===");
  console.log(
    `Lookback: ${LOOKBACK_HOURS}h | Move threshold: ${(MOVE_THRESHOLD * 100).toFixed(1)}% over ${MOVE_WINDOW_HOURS}h | Pre-window: ${PRE_WINDOW_HOURS}h`,
  );
  console.log(`Tokens: ${TOKEN_FILTER.join(", ")}`);
  console.log("");

  const watches = TOKEN_WATCHES.filter((w) =>
    TOKEN_FILTER.includes(w.symbol.toUpperCase()),
  );
  if (watches.length === 0) {
    throw new Error(`No watched tokens match filter: ${TOKEN_FILTER.join(",")}`);
  }

  // Step 1: Anchor block <-> time
  console.log("[1/5] Anchoring block ↔ time...");
  const anchor = await getBlockAnchor();
  console.log(
    `  anchor: block ${anchor.blockNumber} @ ${new Date(anchor.unixSec * 1000).toISOString()}`,
  );

  // Step 2: Preload OHLCV (minute resolution)
  console.log(`\n[2/5] Preloading OHLCV (15m candles, ${LOOKBACK_HOURS}h)...`);
  const feed = new GeckoTerminalHistoricalFeed({
    timeframe: "minute",
    aggregate: 15,
    log: (m) => console.log(`  ${m}`),
  });
  const toISO = new Date(anchor.unixSec * 1000).toISOString();
  const fromISO = new Date(
    (anchor.unixSec - LOOKBACK_HOURS * 3600) * 1000,
  ).toISOString();
  const preloadResult = await feed.preload(
    watches.map((w) => w.symbol),
    fromISO,
    toISO,
  );
  console.log(
    `  loaded: ${preloadResult.loaded}, failed: ${preloadResult.failed.join(",") || "none"}`,
  );
  if (preloadResult.failed.length > 0) {
    console.warn(
      `  ⚠ Some symbols failed preload — they will be skipped: ${preloadResult.failed.join(",")}`,
    );
  }

  // Step 3: Detect moves
  console.log(`\n[3/5] Detecting moves >= ${(MOVE_THRESHOLD * 100).toFixed(1)}%...`);
  const movesByToken = new Map<string, DetectedMove[]>();
  for (const w of watches) {
    if (preloadResult.failed.includes(w.symbol)) continue;
    const candles = feed.getCandlesInWindow(w.symbol, fromISO, toISO);
    const cps: CandlePoint[] = candles.map((c) => ({
      ts: c.ts,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volumeUsd: c.volumeUsd,
    }));
    const moves = detectMoves(w.symbol, cps);
    movesByToken.set(w.symbol, moves);
    const ups = moves.filter((m) => m.pctChange > 0).length;
    const downs = moves.length - ups;
    console.log(
      `  ${w.symbol}: ${candles.length} candles → ${moves.length} moves (${ups} up / ${downs} down)`,
    );
  }

  // Step 4: For each move, fetch pre-window axes
  console.log("\n[4/5] Fetching pre-window axes (this is the slow step)...");
  const t0 = Date.now();
  const axesByMove = new Map<string, PreWindowAxes[]>();
  for (const w of watches) {
    const moves = movesByToken.get(w.symbol) ?? [];
    if (moves.length === 0) {
      axesByMove.set(w.symbol, []);
      continue;
    }
    console.log(`  ${w.symbol}: pulling ${moves.length} pre-windows...`);
    const axes: PreWindowAxes[] = [];
    let i = 0;
    for (const m of moves) {
      i++;
      try {
        const a = await buildPreWindowAxes({ move: m, watch: w, feed, anchor });
        axes.push(a);
        if (i % 5 === 0 || i === moves.length) {
          process.stdout.write(
            `    [${i}/${moves.length}] ${m.anchorCloseISO} ${m.pctChange > 0 ? "+" : ""}${(m.pctChange * 100).toFixed(1)}% — ` +
              `${a.distinctTxs} txs (${a.userBuys}u/${a.routerBuys}r/${a.botBuys}b), ` +
              `${a.uniqueUserBuyers} user buyers, $${a.userBuyVolumeUsd.toFixed(0)} user-vol\n`,
          );
        }
      } catch (e) {
        console.warn(
          `    [${i}/${moves.length}] ${m.anchorCloseISO} FAILED: ${(e as Error).message?.slice(0, 100)}`,
        );
      }
    }
    axesByMove.set(w.symbol, axes);
  }
  console.log(`  axes pulls done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Step 5: Write outputs
  console.log("\n[5/5] Writing outputs...");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outDir = join(__dirname, "..", "data", "observation-pass");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);

  const summary = {
    runDate: new Date().toISOString(),
    config: {
      lookbackHours: LOOKBACK_HOURS,
      moveThreshold: MOVE_THRESHOLD,
      preWindowHours: PRE_WINDOW_HOURS,
      moveWindowHours: MOVE_WINDOW_HOURS,
    },
    anchor: {
      blockNumber: anchor.blockNumber.toString(),
      unixSec: anchor.unixSec,
      iso: new Date(anchor.unixSec * 1000).toISOString(),
    },
    perToken: [] as Array<{
      symbol: string;
      address: string;
      moveCount: number;
      upMoves: number;
      downMoves: number;
      medianAbsPctMove: number;
      medianUserBuysInPreWindow: number;
      medianUserBuyVolumeUsdInPreWindow: number;
      medianDistinctTxsInPreWindow: number;
    }>,
  };

  for (const w of watches) {
    const moves = movesByToken.get(w.symbol) ?? [];
    const axes = axesByMove.get(w.symbol) ?? [];
    // Per-token detail file
    const detail = {
      symbol: w.symbol,
      address: w.address,
      pools: w.pools,
      moves: moves.map((m, i) => ({
        ...m,
        preWindowAxes: axes[i] ?? null,
      })),
    };
    const detailPath = join(outDir, `${stamp}-${w.symbol}-moves.json`);
    writeFileSync(detailPath, JSON.stringify(detail, null, 2));
    console.log(`  ${detailPath} (${moves.length} moves)`);

    const ups = moves.filter((m) => m.pctChange > 0).length;
    const absPcts = moves.map((m) => Math.abs(m.pctChange)).sort((a, b) => a - b);
    const medAbsPct = absPcts.length > 0 ? absPcts[Math.floor(absPcts.length / 2)]! : 0;
    const userBuyCounts = axes.map((a) => a.userBuys).sort((a, b) => a - b);
    const medUserBuys = userBuyCounts.length > 0 ? userBuyCounts[Math.floor(userBuyCounts.length / 2)]! : 0;
    const userVols = axes.map((a) => a.userBuyVolumeUsd).sort((a, b) => a - b);
    const medUserVol = userVols.length > 0 ? userVols[Math.floor(userVols.length / 2)]! : 0;
    const distinctTxs = axes.map((a) => a.distinctTxs).sort((a, b) => a - b);
    const medDistinctTxs = distinctTxs.length > 0 ? distinctTxs[Math.floor(distinctTxs.length / 2)]! : 0;
    summary.perToken.push({
      symbol: w.symbol,
      address: w.address,
      moveCount: moves.length,
      upMoves: ups,
      downMoves: moves.length - ups,
      medianAbsPctMove: medAbsPct,
      medianUserBuysInPreWindow: medUserBuys,
      medianUserBuyVolumeUsdInPreWindow: medUserVol,
      medianDistinctTxsInPreWindow: medDistinctTxs,
    });
  }

  const summaryPath = join(outDir, `${stamp}-summary.json`);
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`  ${summaryPath}`);

  console.log("\n=== Done ===");
  for (const t of summary.perToken) {
    console.log(
      `  ${t.symbol}: ${t.moveCount} moves (${t.upMoves}↑ ${t.downMoves}↓), ` +
        `median |Δ|=${(t.medianAbsPctMove * 100).toFixed(1)}%, ` +
        `median pre-window USERS: ${t.medianUserBuysInPreWindow} buys / $${t.medianUserBuyVolumeUsdInPreWindow.toFixed(0)} ` +
        `(${t.medianDistinctTxsInPreWindow} distinct txs)`,
    );
  }
}

main().catch((e) => {
  console.error("\n[FATAL]", e);
  process.exit(1);
});
