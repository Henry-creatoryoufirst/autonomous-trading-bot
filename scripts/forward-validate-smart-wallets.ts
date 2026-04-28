/**
 * NVR-SPEC-022 — Forward-validate the existing 20 SMART_WALLETS seed list
 *
 * Purpose: before rebuilding wallet discovery from scratch, test if any of
 * the existing seed wallets actually have measurable forward edge on
 * tokens we trade. The seed list was discovered via survivorship bias
 * ("wallets early on tokens that already mooned") and contains known
 * DEX aggregators (LI.FI, 1inch). Honest test: does any of it survive
 * forward validation?
 *
 * Method:
 *   1. Define a SPECIALIST UNIVERSE — 5 high-volume Base tokens we
 *      actively trade (per `feedback_specialist_depth_beats_breadth`)
 *   2. For each seed wallet, fetch every router-routed BUY in our
 *      universe over a 90d window
 *   3. For each BUY, look up the token's price at +24h, +72h, +7d via
 *      GeckoTerminalHistoricalFeed (this morning's price-feed work)
 *   4. Score each wallet:
 *        - n trades on universe
 *        - avg forward return at each horizon
 *        - win rate at each horizon (% of trades where price went up)
 *        - volume-weighted return
 *   5. Rank + verdict
 *
 * If any wallet has consistent positive edge at any horizon (and isn't a
 * known aggregator), it's salvageable. Otherwise: rebuild discovery
 * from scratch with proper forward validation as the discovery criterion,
 * not survivorship bias.
 *
 * Run:
 *   npx tsx scripts/forward-validate-smart-wallets.ts
 *
 * Environment:
 *   FV_LOOKBACK_DAYS  default 90
 *   FV_VERBOSE        '1' to log every BUY found
 */

import {
  fetchBuysForWallets,
  type WalletBuy,
} from "../src/simulation/data/wallet-buys.js";
import { GeckoTerminalHistoricalFeed } from "../src/simulation/data/price-feed.js";
import { TOKEN_REGISTRY } from "../src/core/config/token-registry.js";

// ----------------------------------------------------------------------------
// Universe — the tokens we care about edge-prediction on
// ----------------------------------------------------------------------------

const UNIVERSE_SYMBOLS = ["WETH", "cbBTC", "AERO", "cbETH", "wstETH"] as const;

// ----------------------------------------------------------------------------
// The existing 20 SMART_WALLETS — copied from src/core/services/smart-wallet-tracker.ts
// (which was bootstrapped 2026-04-14 via survivorship-bias discovery)
// ----------------------------------------------------------------------------

const SEED_WALLETS: Record<string, string> = {
  "base-smart-01": "0x00c600b30fb0400701010f4b080409018b9006e0",
  "base-smart-02": "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae", // LI.FI bridge — known aggregator
  "base-smart-03": "0x139b578ee197afde49f41fc05657562c4264c84c",
  "base-smart-04": "0x2aa7d880b7ad5964c02b919074fb27a71a7ddd07",
  "base-smart-05": "0x4409921ae43a39a11d90f7b7f96cfd0b8093d9fc",
  "base-smart-06": "0x5aafc1f252d544f744d17a4e734afd6efc47ede4",
  "base-smart-07": "0x63242a4ea82847b20e506b63b0e2e2eff0cc6cb0",
  "base-smart-08": "0x7747f8d2a76bd6345cc29622a946a929647f2359",
  "base-smart-09": "0xc10ee9031f2a0b84766a86b55a8d90f357910fb4",
  "base-smart-10": "0x000010036c0190e009a000d0fc3541100a07380a",
  "base-smart-11": "0x0a2854fbbd9b3ef66f17d47284e7f899b9509330",
  "base-smart-12": "0x0b804138fdbd4263a94e81521aa65b384819e309",
  "base-smart-13": "0x111111125421ca6dc452d289314280a0f8842a65", // 1inch router — known aggregator
  "base-smart-14": "0x19dd96094f3204fa76f65c7b109624cfb62fb17b",
  "base-smart-15": "0x278d858f05b94576c1e6f73285886876ff6ef8d2",
  "base-smart-16": "0x411d2c093e4c2e69bf0d8e94be1bf13dadd879c6",
  "base-smart-17": "0x43f9a7aec2a683c4cd6016f92ff76d5f3e7b44d3",
  "base-smart-18": "0x498581ff718922c3f8e6a244956af099b2652b2b",
  "base-smart-19": "0x4c3ccc98c01103be72bcfd29e1d2454c98d1a6e3",
  "base-smart-20": "0x4e48d4885871b4dd2ea91a2aed9390b8908fe525",
};

const KNOWN_AGGREGATORS = new Set([
  "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae", // LI.FI
  "0x111111125421ca6dc452d289314280a0f8842a65", // 1inch
]);

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

const LOOKBACK_DAYS = parseInt(process.env.FV_LOOKBACK_DAYS ?? "90", 10);
const VERBOSE = process.env.FV_VERBOSE === "1";

// ----------------------------------------------------------------------------
// Analysis types
// ----------------------------------------------------------------------------

interface BuyWithReturns extends WalletBuy {
  entryPrice?: number;
  return24h?: number; // pct
  return72h?: number;
  return7d?: number;
}

interface WalletScore {
  walletId: string;
  walletAddress: string;
  isKnownAggregator: boolean;
  totalBuys: number;
  buysWithFullData: number;
  distinctTokens: number;
  avgReturn24h: number | null;
  avgReturn72h: number | null;
  avgReturn7d: number | null;
  winRate24h: number | null;
  winRate72h: number | null;
  winRate7d: number | null;
  /** Composite score: avg of horizons weighted by win-rate sanity. */
  compositeScore: number | null;
}

// ----------------------------------------------------------------------------
// Forward-return computation
// ----------------------------------------------------------------------------

const HORIZON_24H_MS = 24 * 3600 * 1000;
const HORIZON_72H_MS = 72 * 3600 * 1000;
const HORIZON_7D_MS = 7 * 24 * 3600 * 1000;

async function attachForwardReturns(
  buys: WalletBuy[],
  feed: GeckoTerminalHistoricalFeed,
): Promise<BuyWithReturns[]> {
  const out: BuyWithReturns[] = [];
  for (const b of buys) {
    if (!b.timestamp || !b.tokenSymbol) {
      out.push({ ...b });
      continue;
    }
    const entryTs = Date.parse(b.timestamp);
    const entryPrice = await feed.getPriceAt(b.tokenSymbol, b.timestamp);
    if (entryPrice === null || entryPrice <= 0) {
      out.push({ ...b });
      continue;
    }
    const px24 = await feed.getPriceAt(
      b.tokenSymbol,
      new Date(entryTs + HORIZON_24H_MS).toISOString(),
    );
    const px72 = await feed.getPriceAt(
      b.tokenSymbol,
      new Date(entryTs + HORIZON_72H_MS).toISOString(),
    );
    const px7d = await feed.getPriceAt(
      b.tokenSymbol,
      new Date(entryTs + HORIZON_7D_MS).toISOString(),
    );

    out.push({
      ...b,
      entryPrice,
      return24h:
        px24 !== null ? ((px24 - entryPrice) / entryPrice) * 100 : undefined,
      return72h:
        px72 !== null ? ((px72 - entryPrice) / entryPrice) * 100 : undefined,
      return7d:
        px7d !== null ? ((px7d - entryPrice) / entryPrice) * 100 : undefined,
    });
  }
  return out;
}

function avg(xs: readonly number[]): number | null {
  const valid = xs.filter((x) => Number.isFinite(x));
  if (valid.length === 0) return null;
  return valid.reduce((s, x) => s + x, 0) / valid.length;
}

function winRate(xs: readonly number[]): number | null {
  const valid = xs.filter((x) => Number.isFinite(x));
  if (valid.length === 0) return null;
  return valid.filter((x) => x > 0).length / valid.length;
}

function scoreWallet(
  walletId: string,
  walletAddress: string,
  buys: BuyWithReturns[],
): WalletScore {
  const r24 = buys.map((b) => b.return24h).filter((x): x is number => x !== undefined);
  const r72 = buys.map((b) => b.return72h).filter((x): x is number => x !== undefined);
  const r7d = buys.map((b) => b.return7d).filter((x): x is number => x !== undefined);
  const fullData = buys.filter((b) => b.entryPrice !== undefined).length;
  const distinctTokens = new Set(buys.map((b) => b.tokenSymbol).filter(Boolean)).size;

  const avg24 = avg(r24);
  const avg72 = avg(r72);
  const avg7d = avg(r7d);
  const wr24 = winRate(r24);
  const wr72 = winRate(r72);
  const wr7d = winRate(r7d);

  // Composite: simple sum of avg returns across horizons, only if any horizon
  // has data. A wallet that's positive at multiple horizons gets credit.
  const presentReturns = [avg24, avg72, avg7d].filter(
    (x): x is number => x !== null,
  );
  const compositeScore =
    presentReturns.length > 0
      ? presentReturns.reduce((s, x) => s + x, 0) / presentReturns.length
      : null;

  return {
    walletId,
    walletAddress,
    isKnownAggregator: KNOWN_AGGREGATORS.has(walletAddress.toLowerCase()),
    totalBuys: buys.length,
    buysWithFullData: fullData,
    distinctTokens,
    avgReturn24h: avg24,
    avgReturn72h: avg72,
    avgReturn7d: avg7d,
    winRate24h: wr24,
    winRate72h: wr72,
    winRate7d: wr7d,
    compositeScore,
  };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log(`\n=== NVR Forward-Validate Smart Wallets ===`);
  console.log(`Universe: ${UNIVERSE_SYMBOLS.join(", ")}`);
  console.log(`Wallets: ${Object.keys(SEED_WALLETS).length}`);
  console.log(`Lookback: ${LOOKBACK_DAYS} days`);
  console.log("");

  // 1) Resolve token registry → addresses + symbols
  const tokenAddresses: string[] = [];
  const symbolByAddress = new Map<string, string>();
  for (const sym of UNIVERSE_SYMBOLS) {
    const reg = TOKEN_REGISTRY[sym];
    if (!reg || reg.address === "native") {
      console.warn(`  ⚠ no registry entry for ${sym} (or native) — skipping`);
      continue;
    }
    const addr = reg.address.toLowerCase();
    tokenAddresses.push(addr);
    symbolByAddress.set(addr, sym);
  }
  console.log(`[1/4] Resolved ${tokenAddresses.length} token addresses\n`);

  // 2) Preload price feed at hour resolution covering the lookback + 7d
  // forward horizon (to allow forward-return lookups for the latest buys)
  console.log(`[2/4] Preloading price feed...`);
  const feed = new GeckoTerminalHistoricalFeed({
    timeframe: "hour",
    aggregate: 4,
    preferredDex: "aerodrome",
    log: VERBOSE ? (m) => console.log(`    ${m}`) : undefined,
  });
  const fromIso = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000,
  ).toISOString();
  const toIso = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(); // future cushion
  const preload = await feed.preload([...UNIVERSE_SYMBOLS], fromIso, toIso);
  console.log(
    `  loaded=${preload.loaded}/${UNIVERSE_SYMBOLS.length} failed=${JSON.stringify(preload.failed)}`,
  );
  const usableSymbols = UNIVERSE_SYMBOLS.filter((s) => !preload.failed.includes(s));
  if (usableSymbols.length === 0) {
    console.error(`  ❌ no symbols preloaded — cannot run validation`);
    process.exit(1);
  }
  // Filter universe to usable
  const usableAddresses = tokenAddresses.filter((a) =>
    usableSymbols.includes(symbolByAddress.get(a) as (typeof UNIVERSE_SYMBOLS)[number]),
  );

  // 3) Batched fetch in groups of 5 wallets at a time. Public Base RPCs
  // reject topic-OR arrays with 20 entries ("Invalid parameters"), so we
  // chunk into smaller batches that the RPC layer accepts reliably.
  console.log(`\n[3/4] Batched fetch (5-wallet batches)...`);
  const walletAddresses = Object.values(SEED_WALLETS);
  const BATCH_SIZE = 5;
  const aggregateBuysByWallet = new Map<string, WalletBuy[]>();
  for (const w of walletAddresses) aggregateBuysByWallet.set(w.toLowerCase(), []);
  const fetchStart = Date.now();
  let totalChunks = 0;
  let totalRejected = 0;
  for (let i = 0; i < walletAddresses.length; i += BATCH_SIZE) {
    const batch = walletAddresses.slice(i, i + BATCH_SIZE);
    console.log(
      `  batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(walletAddresses.length / BATCH_SIZE)}: ${batch.length} wallets`,
    );
    const result = await fetchBuysForWallets({
      walletAddresses: batch,
      tokenAddresses: usableAddresses,
      symbolByAddress,
      lookbackHours: LOOKBACK_DAYS * 24,
      verbose: false,
    });
    for (const [wallet, buys] of result.buysByWallet.entries()) {
      const list = aggregateBuysByWallet.get(wallet);
      if (list) list.push(...buys);
    }
    totalChunks += result.chunkCount;
    totalRejected += result.rejectedNonRouter;
  }
  const totalBuys = Array.from(aggregateBuysByWallet.values()).reduce(
    (s, b) => s + b.length,
    0,
  );
  console.log(
    `  → ${totalBuys} total BUYs in ${((Date.now() - fetchStart) / 1000).toFixed(1)}s ` +
      `(${totalChunks} chunks across all batches, ${totalRejected} non-router rejected)`,
  );
  const batchResult = { buysByWallet: aggregateBuysByWallet };

  console.log(`\n  Computing forward returns (per-BUY price lookups)...`);
  const scores: WalletScore[] = [];
  for (const [walletId, walletAddress] of Object.entries(SEED_WALLETS)) {
    const buys = batchResult.buysByWallet.get(walletAddress.toLowerCase()) ?? [];
    const buysWithReturns = await attachForwardReturns(buys, feed);
    const score = scoreWallet(walletId, walletAddress, buysWithReturns);
    scores.push(score);
    if (VERBOSE) {
      const tag = score.isKnownAggregator ? " [AGG]" : "";
      console.log(
        `    ${walletId} ${walletAddress.slice(0, 10)}... → ${buys.length} BUYs${tag}`,
      );
    }
  }

  // 4) Report
  console.log(`\n[4/4] Reporting...\n`);
  console.log(`=== Per-wallet scores (sorted by composite forward return) ===`);
  console.log(
    `${"walletId".padEnd(15)} ${"agg".padEnd(5)} ${"buys".padStart(5)} ${"tok".padStart(4)} ${"+24h%".padStart(8)} ${"+72h%".padStart(8)} ${"+7d%".padStart(8)} ${"wr24h".padStart(6)} ${"wr72h".padStart(6)} ${"wr7d".padStart(6)} ${"composite".padStart(10)}`,
  );
  scores.sort((a, b) => (b.compositeScore ?? -999) - (a.compositeScore ?? -999));
  for (const s of scores) {
    const f = (n: number | null) => (n === null ? "n/a".padStart(8) : (n).toFixed(2).padStart(8));
    const fpct = (n: number | null) =>
      n === null ? "n/a".padStart(6) : (n * 100).toFixed(0).padStart(5) + "%";
    console.log(
      `${s.walletId.padEnd(15)} ${(s.isKnownAggregator ? "AGG" : "  -").padEnd(5)} ` +
        `${String(s.totalBuys).padStart(5)} ${String(s.distinctTokens).padStart(4)} ` +
        `${f(s.avgReturn24h)} ${f(s.avgReturn72h)} ${f(s.avgReturn7d)} ` +
        `${fpct(s.winRate24h)} ${fpct(s.winRate72h)} ${fpct(s.winRate7d)} ` +
        `${s.compositeScore === null ? "n/a".padStart(10) : (s.compositeScore.toFixed(2) + "%").padStart(10)}`,
    );
  }

  // Verdict
  console.log(`\n=== Verdict ===`);
  const eligible = scores.filter(
    (s) =>
      !s.isKnownAggregator &&
      s.totalBuys >= 5 &&
      s.compositeScore !== null,
  );
  const positiveEdge = eligible.filter((s) => (s.compositeScore ?? 0) > 0);
  console.log(
    `  Eligible wallets (non-aggregator, ≥5 BUYs, composite computable): ${eligible.length}`,
  );
  console.log(
    `  With positive composite forward edge: ${positiveEdge.length}`,
  );
  if (positiveEdge.length === 0) {
    console.log(`\n  ✗ NO WALLET HAS POSITIVE FORWARD EDGE on our universe.`);
    console.log(
      `    Existing seed list is fully invalidated by forward measurement.`,
    );
    console.log(
      `    Recommend rebuilding wallet discovery with FORWARD-VALIDATION as the`,
    );
    console.log(
      `    discovery criterion (not survivorship bias). Pull every wallet active on`,
    );
    console.log(
      `    Aerodrome/Uni V3 Base in past 90d, score by avg forward return on universe`,
    );
    console.log(
      `    BUYs, rank top 30-50, exclude aggregators by behavioral signature.`,
    );
  } else {
    console.log(`\n  ✓ ${positiveEdge.length} wallets show positive forward edge:`);
    for (const w of positiveEdge.slice(0, 10)) {
      console.log(
        `    ${w.walletId.padEnd(15)} composite=${w.compositeScore!.toFixed(2)}% over ${w.totalBuys} BUYs`,
      );
    }
    console.log(
      `\n    These could seed a v22 cluster pattern. Recommend extending to broader`,
    );
    console.log(
      `    candidate pool to find more such wallets, then build the cluster trigger.`,
    );
  }
}

main().catch((err) => {
  console.error("forward-validation error:", err);
  process.exit(1);
});
