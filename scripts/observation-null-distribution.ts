/**
 * NVR-SPEC-022 — Observation pass NULL-DISTRIBUTION validator
 *
 * The observation pass identified ~30 candidate "smart-money" wallets
 * by their appearance in pre-windows of >=5% moves. But without a
 * baseline, we can't tell signal from "wallets that are always active."
 *
 * This script computes the null distribution: for each token, sample N
 * random 2-hour windows from the same 14-day period (AVOIDING any
 * window that overlaps a detected move's pre-window), then run the
 * same fetcher + classifier. The output is per-wallet appearance rate
 * in non-move windows.
 *
 * Edge = (appearance rate before moves) - (appearance rate in null)
 *
 * Run:
 *   npx tsx scripts/observation-null-distribution.ts
 */

import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createPublicClient, http } from "viem";

import { fetchPoolBuys } from "../src/simulation/data/pool-buys.js";
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

const N_NULL_WINDOWS = parseInt(process.env.NULL_WINDOWS ?? "30", 10);
const PRE_WINDOW_HOURS = 2.0;
const LOOKBACK_HOURS = 336; // must match observation-pass

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
// Sample non-overlapping random 2h windows
// ----------------------------------------------------------------------------

function sampleNullWindows(
  movePreWindowsSec: Array<{ from: number; to: number }>,
  rangeStartSec: number,
  rangeEndSec: number,
  n: number,
): Array<{ from: number; to: number }> {
  const windowSec = PRE_WINDOW_HOURS * 3600;
  const out: Array<{ from: number; to: number }> = [];
  let attempts = 0;
  while (out.length < n && attempts < n * 100) {
    attempts++;
    const fromSec = Math.floor(
      rangeStartSec + Math.random() * (rangeEndSec - rangeStartSec - windowSec),
    );
    const toSec = fromSec + windowSec;
    // Reject if overlaps any move pre-window
    const overlaps = movePreWindowsSec.some(
      (mw) => fromSec < mw.to && toSec > mw.from,
    );
    if (overlaps) continue;
    // Also reject if overlaps another sampled null window (not strictly necessary
    // but keeps the null sample more independent).
    const dupOverlap = out.some((nw) => fromSec < nw.to && toSec > nw.from);
    if (dupOverlap) continue;
    out.push({ from: fromSec, to: toSec });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Per-window classification (same logic as orchestrator)
// ----------------------------------------------------------------------------

interface ClassifiedTopBuyer {
  wallet: string;
  totalUsd: number;
  buyCount: number;
}

interface NullWindowResult {
  fromTs: number;
  toTs: number;
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
}): Promise<NullWindowResult> {
  const { watch, fromSec, toSec, anchor } = opts;
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

  // Per-wallet buy count (for bot detection)
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

  // Note: we don't have a price feed here — use approx token-amount only
  // for top-buyer ordering. We'll use raw-amount decimal-normalized
  // (no USD), since this script is about wallet IDENTITY, not USD volume.
  for (const b of result.buys) {
    distinctTxSet.add(b.txHash);
    const tokens = Number(b.amountTokensRaw) / decimalsDiv;
    let classification: "user" | "router" | "bot";
    if (KNOWN_ROUTERS_LOWER.has(b.buyerWallet)) {
      classification = "router";
    } else if (
      (walletBuyCount.get(b.buyerWallet) ?? 0) > BOT_BUY_COUNT_THRESHOLD
    ) {
      classification = "bot";
    } else {
      classification = "user";
    }
    if (classification === "user") {
      userBuys++;
      const slot = userBuyerAgg.get(b.buyerWallet) ?? {
        wallet: b.buyerWallet,
        totalUsd: 0, // tokens-as-pseudo-usd
        buyCount: 0,
      };
      slot.totalUsd += tokens;
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
  console.log("=== NVR Null-Distribution Validator ===");
  console.log(`Sampling ${N_NULL_WINDOWS} random non-overlapping 2h windows per token`);
  console.log("");

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outDir = join(__dirname, "..", "data", "observation-pass");
  mkdirSync(outDir, { recursive: true });

  const anchor = await getBlockAnchor();
  console.log(
    `Anchor: block ${anchor.blockNumber} @ ${new Date(anchor.unixSec * 1000).toISOString()}`,
  );
  const rangeEndSec = anchor.unixSec;
  const rangeStartSec = anchor.unixSec - LOOKBACK_HOURS * 3600;

  const allWindowsByToken: Record<string, NullWindowResult[]> = {};

  for (const watch of TOKEN_WATCHES) {
    const detailPath = join(outDir, `2026-04-29-${watch.symbol}-moves.json`);
    let movesJson;
    try {
      movesJson = JSON.parse(readFileSync(detailPath, "utf-8"));
    } catch (e) {
      console.warn(
        `  ${watch.symbol}: cannot read ${detailPath} — ${(e as Error).message}`,
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

    const nullWindows = sampleNullWindows(
      moveWindows,
      rangeStartSec,
      rangeEndSec,
      N_NULL_WINDOWS,
    );
    console.log(
      `  ${watch.symbol}: sampled ${nullWindows.length} null windows (${moveWindows.length} move pre-windows excluded)`,
    );

    const results: NullWindowResult[] = [];
    let i = 0;
    for (const w of nullWindows) {
      i++;
      try {
        const r = await fetchAndClassifyWindow({
          watch,
          fromSec: w.from,
          toSec: w.to,
          anchor,
        });
        results.push(r);
        if (i % 5 === 0 || i === nullWindows.length) {
          process.stdout.write(
            `    [${i}/${nullWindows.length}] ${new Date(w.from * 1000).toISOString().slice(0, 16)} — ${r.distinctTxs} txs, ${r.userBuys} user buys, ${r.uniqueUserBuyers} user buyers\n`,
          );
        }
      } catch (e) {
        console.warn(
          `    [${i}/${nullWindows.length}] FAILED: ${(e as Error).message?.slice(0, 80)}`,
        );
      }
    }
    allWindowsByToken[watch.symbol] = results;

    const outPath = join(outDir, `2026-04-29-${watch.symbol}-null-windows.json`);
    writeFileSync(outPath, JSON.stringify({ symbol: watch.symbol, windows: results }, null, 2));
    console.log(`  → ${outPath}`);
  }

  console.log("\n=== Done ===");
  for (const sym of Object.keys(allWindowsByToken)) {
    const results = allWindowsByToken[sym]!;
    const totalUserBuyers = new Set<string>();
    for (const w of results) for (const tb of w.topUserBuyers) totalUserBuyers.add(tb.wallet);
    console.log(
      `  ${sym}: ${results.length} null windows, ${totalUserBuyers.size} distinct top-user-buyer wallets across all`,
    );
  }
}

main().catch((e) => {
  console.error("\n[FATAL]", e);
  process.exit(1);
});
