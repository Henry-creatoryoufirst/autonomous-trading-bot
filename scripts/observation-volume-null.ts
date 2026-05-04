/**
 * NVR-SPEC-022 — VOLUME-WEIGHTED null distribution
 *
 * Lesson 1 from FINDING_2026-05-04 (P-IntermediarySurge KILL):
 *   The original `observation-null-distribution.ts` samples N random
 *   non-overlapping windows and compares actor appearance there to
 *   appearance in move pre-windows. This catches signal where actors
 *   are uncorrelated with activity bursts — but it MISSES the much
 *   more common artifact where actors are correlated with high
 *   activity but NOT with directional moves.
 *
 *   P-IntermediarySurge's z=3.8 retrospective edge was exactly that
 *   artifact. MEV/arb actors fire whenever there's volume; volume
 *   bursts include moves. The random-window null had on average lower
 *   activity than move pre-windows, so any active actor scored "edge."
 *   Forward validation killed it: 0/54 hits at 100% FP.
 *
 * The fix:
 *   Sample a SECOND null distribution drawn specifically from
 *   high-activity windows that did NOT contain a ≥5% move in the
 *   following 1h. Per-actor edge then becomes:
 *
 *     edge = move_rate − max(random_null_rate, volume_null_rate)
 *
 *   An actor only shows true predictive edge if they appear MORE in
 *   pre-move windows than in equally-active non-move windows. This
 *   filters out the "always active during volume" class of artifact.
 *
 * This script outputs `*-volume-null-windows.json` files alongside
 * the existing `*-null-windows.json`. The downstream edge calculator
 * (`observation-edge.py`, post-update) reads both and uses the
 * tighter baseline.
 *
 * Run:
 *   npx tsx scripts/observation-volume-null.ts
 *
 * Environment:
 *   VOLUME_NULL_WINDOWS              default 30 — how many to sample per token
 *   VOLUME_NULL_QUARTILE_THRESHOLD   default 0.75 (top-25% by volume)
 *   VOLUME_NULL_NO_MOVE_THRESHOLD    default 0.05 (window must NOT precede a 5%+ move)
 *   OBSERVATION_PRE_WINDOW_HOURS     default 2.0 (matches observation-pass)
 *   OBSERVATION_LOOKBACK_HOURS       default 336 (matches observation-pass)
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createPublicClient, http } from "viem";

import { fetchPoolBuys } from "../src/simulation/data/pool-buys.js";
import { GeckoTerminalHistoricalFeed } from "../src/simulation/data/price-feed.js";
import { activeChain } from "../src/core/config/chain-config.js";

// ----------------------------------------------------------------------------
// Token watches (must match observation-pass-base.ts)
// ----------------------------------------------------------------------------

interface TokenWatch {
  symbol: string;
  address: string;
  pools: string[];
  decimals: number;
}

const TOKEN_WATCHES: TokenWatch[] = [
  {
    symbol: "AERO",
    address: "0x940181a94a35a4569e4529a3cdfb74e38fd98631",
    pools: [
      "0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d",
      "0x82321f3beb69f503380d6b233857d5c43562e2d0",
    ],
    decimals: 18,
  },
  {
    symbol: "BRETT",
    address: "0x532f27101965dd16442e59d40670faf5ebb142e4",
    pools: [
      "0x4e829f8a5213c42535ab84aa40bd4adcce9cba02",
      "0xba3f945812a83471d709bce9c3ca699a19fb46f7",
    ],
    decimals: 18,
  },
  {
    symbol: "DEGEN",
    address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed",
    pools: ["0xc9034c3e7f58003e6ae0c8438e7c8f4598d5acaa"],
    decimals: 18,
  },
];

const KNOWN_ROUTERS_LOWER: ReadonlySet<string> = new Set([
  "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24",
  "0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43",
  "0x2626664c2603336e57b271c5c0b26f421741e481",
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad",
  "0x000000000022d473030f116ddee9f6b43ac78ba3",
  "0x6ff5693b99212da76ad316178a184ab56d299b43",
  "0x6cb442acf35158d5eda88fe602221b67b400be3e",
  "0x827922686190790b37229fd06084350e74485b72",
  "0x111111125421ca6dc452d289314280a0f8842a65",
  "0x1111111254eeb25477b68fb85ed929f73a960582",
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff",
]);

const BOT_BUY_COUNT_THRESHOLD = 25;
const BASE_BLOCK_TIME_SEC = 2;

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

const N_VOLUME_NULL = parseInt(process.env["VOLUME_NULL_WINDOWS"] ?? "30", 10);
const VOLUME_QUARTILE = parseFloat(
  process.env["VOLUME_NULL_QUARTILE_THRESHOLD"] ?? "0.75",
);
const NO_MOVE_THRESHOLD = parseFloat(
  process.env["VOLUME_NULL_NO_MOVE_THRESHOLD"] ?? "0.05",
);
const PRE_WINDOW_HOURS = parseFloat(
  process.env["OBSERVATION_PRE_WINDOW_HOURS"] ?? "2.0",
);
const LOOKBACK_HOURS = parseInt(
  process.env["OBSERVATION_LOOKBACK_HOURS"] ?? "336",
  10,
);

// ----------------------------------------------------------------------------
// Block ↔ time helpers (same as observation-null-distribution.ts)
// ----------------------------------------------------------------------------

interface BlockAnchor {
  blockNumber: bigint;
  unixSec: number;
}

async function getBlockAnchor(): Promise<BlockAnchor> {
  const endpoints = activeChain.rpcEndpoints.filter(
    (e) => !["flashbots.net", "sequencer.base.org"].some((h) => e.includes(h)),
  );
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
    } catch {
      // try next
    }
  }
  throw new Error("no usable Base RPC endpoint");
}

function blockAtTime(anchor: BlockAnchor, unixSec: number): bigint {
  const deltaSec = unixSec - anchor.unixSec;
  const deltaBlocks = BigInt(Math.round(deltaSec / BASE_BLOCK_TIME_SEC));
  const block = anchor.blockNumber + deltaBlocks;
  return block < 0n ? 0n : block;
}

// ----------------------------------------------------------------------------
// Volume-weighted window selection
// ----------------------------------------------------------------------------

interface CandlePoint {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
}

/**
 * For a token, identify candidate "high-activity, no-move" anchor times:
 *   - rolling 1h volume in the top `quartile` of the lookback window
 *   - the next 1h does NOT contain a move ≥ noMoveThreshold (either direction)
 * Returns one candidate per qualifying anchor; downstream sampler
 * takes a non-overlapping subset.
 */
function findHighActivityNoMoveAnchors(
  candles: CandlePoint[],
  quartile: number,
  noMoveThreshold: number,
): number[] {
  if (candles.length < 4) return [];

  // candles are 15-min — rolling 1h window = 4 candles
  const ROLLING = 4;

  // Step 1: compute rolling-1h volume per anchor candle
  const rollingVol: { ts: number; vol: number; idx: number }[] = [];
  for (let i = ROLLING - 1; i < candles.length; i++) {
    let v = 0;
    for (let j = i - ROLLING + 1; j <= i; j++) v += candles[j]!.volumeUsd;
    rollingVol.push({ ts: candles[i]!.ts, vol: v, idx: i });
  }
  if (rollingVol.length === 0) return [];

  // Step 2: threshold = volume at the `quartile` percentile
  const sortedVol = [...rollingVol].sort((a, b) => a.vol - b.vol);
  const threshIdx = Math.floor(quartile * sortedVol.length);
  const volThresh = sortedVol[Math.min(threshIdx, sortedVol.length - 1)]!.vol;

  // Step 3: for each high-volume anchor, check the FOLLOWING 1h for a move
  // (we use the same 1h window that observation-pass-base.ts uses for moves)
  const anchors: number[] = [];
  for (const rv of rollingVol) {
    if (rv.vol < volThresh) continue;

    // Look at next 4 candles (next 1h) for the largest move
    const startIdx = rv.idx + 1;
    if (startIdx + ROLLING > candles.length) continue;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = startIdx; j < startIdx + ROLLING; j++) {
      if (candles[j]!.high > hi) hi = candles[j]!.high;
      if (candles[j]!.low < lo) lo = candles[j]!.low;
    }
    if (lo === Infinity || hi === -Infinity || lo <= 0) continue;
    const move = (hi - lo) / lo;
    if (move >= noMoveThreshold) continue; // discard — this preceded a move

    anchors.push(rv.ts);
  }
  return anchors;
}

/**
 * From a candidate anchor list, pick N non-overlapping pre-windows
 * (looking BACKWARD from each anchor by PRE_WINDOW_HOURS), avoiding
 * any overlap with movePreWindowsSec.
 */
function pickWindowsFromAnchors(
  anchors: number[],
  movePreWindowsSec: Array<{ from: number; to: number }>,
  n: number,
): Array<{ from: number; to: number }> {
  const windowSec = PRE_WINDOW_HOURS * 3600;
  // Shuffle for randomness within the qualifying set
  const shuffled = [...anchors].sort(() => Math.random() - 0.5);
  const picked: Array<{ from: number; to: number }> = [];
  for (const anchorTs of shuffled) {
    if (picked.length >= n) break;
    const fromSec = anchorTs - windowSec;
    const toSec = anchorTs;
    // Reject overlap with move pre-windows
    if (movePreWindowsSec.some((mw) => fromSec < mw.to && toSec > mw.from)) continue;
    // Reject overlap with already-picked
    if (picked.some((p) => fromSec < p.to && toSec > p.from)) continue;
    picked.push({ from: fromSec, to: toSec });
  }
  return picked;
}

// ----------------------------------------------------------------------------
// Per-window classification (same as observation-null-distribution.ts)
// ----------------------------------------------------------------------------

interface ClassifiedTopBuyer {
  wallet: string;
  totalUsd: number;
  buyCount: number;
}

interface VolumeNullWindowResult {
  fromTs: number;
  toTs: number;
  volumeUsd: number; // rolling 1h vol at the anchor
  totalBuys: number;
  userBuys: number;
  routerBuys: number;
  botBuys: number;
  uniqueUserBuyers: number;
  topUserBuyers: ClassifiedTopBuyer[];
  distinctTxs: number;
}

async function fetchAndClassifyWindow(opts: {
  watch: TokenWatch;
  fromSec: number;
  toSec: number;
  anchor: BlockAnchor;
  volumeUsd: number;
}): Promise<VolumeNullWindowResult> {
  const { watch, fromSec, toSec, anchor, volumeUsd } = opts;
  const fromBlock = blockAtTime(anchor, fromSec);
  const toBlock = blockAtTime(anchor, toSec);

  const result = await fetchPoolBuys({
    tokenAddress: watch.address,
    poolAddresses: watch.pools,
    fromBlock,
    toBlock,
    verbose: false,
  });

  const decimalsDiv = 10 ** watch.decimals;

  const walletBuyCount = new Map<string, number>();
  for (const b of result.buys) {
    walletBuyCount.set(
      b.buyerWallet,
      (walletBuyCount.get(b.buyerWallet) ?? 0) + 1,
    );
  }

  const userBuyerAgg = new Map<
    string,
    { wallet: string; totalUsd: number; buyCount: number }
  >();
  let userBuys = 0;
  let routerBuys = 0;
  let botBuys = 0;
  const distinctTxSet = new Set<string>();

  for (const b of result.buys) {
    distinctTxSet.add(b.txHash);
    const tokens = Number(b.amountTokensRaw) / decimalsDiv;
    let classification: "user" | "router" | "bot";
    if (KNOWN_ROUTERS_LOWER.has(b.buyerWallet)) {
      classification = "router";
    } else if ((walletBuyCount.get(b.buyerWallet) ?? 0) > BOT_BUY_COUNT_THRESHOLD) {
      classification = "bot";
    } else {
      classification = "user";
    }
    if (classification === "user") {
      userBuys++;
      const slot = userBuyerAgg.get(b.buyerWallet) ?? {
        wallet: b.buyerWallet,
        totalUsd: 0,
        buyCount: 0,
      };
      slot.totalUsd += tokens; // pseudo-USD; identity is what matters here
      slot.buyCount++;
      userBuyerAgg.set(b.buyerWallet, slot);
    } else if (classification === "router") {
      routerBuys++;
    } else {
      botBuys++;
    }
  }
  const topUserBuyers = Array.from(userBuyerAgg.values())
    .sort((a, b) => b.totalUsd - a.totalUsd)
    .slice(0, 10);

  return {
    fromTs: fromSec,
    toTs: toSec,
    volumeUsd,
    totalBuys: result.buys.length,
    userBuys,
    routerBuys,
    botBuys,
    uniqueUserBuyers: userBuyerAgg.size,
    topUserBuyers,
    distinctTxs: distinctTxSet.size,
  };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log("=== NVR Volume-Weighted Null Distribution ===");
  console.log(
    `Sampling ${N_VOLUME_NULL} high-activity (top ${(VOLUME_QUARTILE * 100).toFixed(0)}% by 1h volume), ` +
      `no-move (next 1h move < ${(NO_MOVE_THRESHOLD * 100).toFixed(0)}%) windows per token`,
  );
  console.log("");

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outDir = join(__dirname, "..", "data", "observation-pass");
  mkdirSync(outDir, { recursive: true });

  const anchor = await getBlockAnchor();
  console.log(
    `Anchor: block ${anchor.blockNumber} @ ${new Date(anchor.unixSec * 1000).toISOString()}`,
  );

  // Preload OHLCV (15m candles) so we can identify high-volume windows
  const feed = new GeckoTerminalHistoricalFeed({
    timeframe: "minute",
    aggregate: 15,
    log: () => {},
  });
  const toISO = new Date(anchor.unixSec * 1000).toISOString();
  const fromISO = new Date(
    (anchor.unixSec - LOOKBACK_HOURS * 3600) * 1000,
  ).toISOString();
  console.log(`Preloading OHLCV for ${LOOKBACK_HOURS}h...`);
  const preloadResult = await feed.preload(
    TOKEN_WATCHES.map((w) => w.symbol),
    fromISO,
    toISO,
  );
  console.log(
    `  loaded: ${preloadResult.loaded}, failed: ${preloadResult.failed.join(",") || "none"}`,
  );

  for (const watch of TOKEN_WATCHES) {
    if (preloadResult.failed.includes(watch.symbol)) {
      console.warn(`  ${watch.symbol}: skipped (OHLCV preload failed)`);
      continue;
    }

    // Load existing moves to know which pre-windows to exclude
    const movesPath = join(outDir, `2026-04-29-${watch.symbol}-moves.json`);
    let movesJson;
    try {
      movesJson = JSON.parse(readFileSync(movesPath, "utf-8"));
    } catch (e) {
      console.warn(
        `  ${watch.symbol}: cannot read ${movesPath} — ${(e as Error).message}`,
      );
      continue;
    }
    const moves = movesJson.moves ?? [];
    const moveWindows = moves
      .map((m: { preWindowAxes?: { fromTs?: number; toTs?: number } }) => ({
        from: m.preWindowAxes?.fromTs ?? 0,
        to: m.preWindowAxes?.toTs ?? 0,
      }))
      .filter((w: { from: number; to: number }) => w.from > 0 && w.to > w.from);

    const candles = feed.getCandlesInWindow(watch.symbol, fromISO, toISO);
    const cps: CandlePoint[] = candles.map((c) => ({
      ts: c.ts,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volumeUsd: c.volumeUsd,
    }));

    const anchors = findHighActivityNoMoveAnchors(
      cps,
      VOLUME_QUARTILE,
      NO_MOVE_THRESHOLD,
    );
    const picked = pickWindowsFromAnchors(anchors, moveWindows, N_VOLUME_NULL);
    console.log(
      `  ${watch.symbol}: ${anchors.length} qualifying anchors → ${picked.length} sampled windows`,
    );

    const results: VolumeNullWindowResult[] = [];
    let i = 0;
    for (const w of picked) {
      i++;
      // For each window, look up its rolling-1h volume from the candle data
      const anchorCandle = cps.find((c) => c.ts === w.to);
      const idxAtAnchor = anchorCandle ? cps.indexOf(anchorCandle) : -1;
      let rollingVol = 0;
      if (idxAtAnchor >= 3) {
        for (let k = idxAtAnchor - 3; k <= idxAtAnchor; k++)
          rollingVol += cps[k]!.volumeUsd;
      }

      try {
        const r = await fetchAndClassifyWindow({
          watch,
          fromSec: w.from,
          toSec: w.to,
          anchor,
          volumeUsd: rollingVol,
        });
        results.push(r);
        if (i % 5 === 0 || i === picked.length) {
          process.stdout.write(
            `    [${i}/${picked.length}] ${new Date(w.from * 1000).toISOString().slice(0, 16)} — vol=$${rollingVol.toFixed(0)}, ${r.distinctTxs} txs, ${r.userBuys} user buys, ${r.uniqueUserBuyers} user buyers\n`,
          );
        }
      } catch (e) {
        console.warn(
          `    [${i}/${picked.length}] FAILED: ${(e as Error).message?.slice(0, 80)}`,
        );
      }
    }

    const outPath = join(outDir, `2026-05-04-${watch.symbol}-volume-null-windows.json`);
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          symbol: watch.symbol,
          methodology: "high-activity-no-move",
          quartileThreshold: VOLUME_QUARTILE,
          noMoveThreshold: NO_MOVE_THRESHOLD,
          windows: results,
        },
        null,
        2,
      ),
    );
    console.log(`  → ${outPath}`);
  }

  console.log("\n=== Done ===");
  console.log(
    "Next: re-run `python3 scripts/observation-edge.py` (after update) to compute edge against the tighter baseline.",
  );
}

main().catch((e) => {
  console.error("\n[FATAL]", e);
  process.exit(1);
});
