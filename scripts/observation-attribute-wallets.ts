/**
 * NVR-SPEC-022 — Wallet attribution for smart-money candidates
 *
 * Takes the validated candidates from `smart-money-validated.json` and
 * inspects each on Base via eth_getCode / eth_getTransactionCount /
 * eth_getBalance, plus computes behavioral fingerprints from the
 * existing pre-window dumps:
 *   - Contract or EOA?
 *   - First-seen / last-seen tx in our dataset
 *   - Cross-token presence ratio
 *   - Buy-size distribution (single-shot whale vs systematic vs micro)
 *   - Time-of-day / day-of-week distribution (US-time human vs always-on bot)
 *   - Pool diversity (one pool only = focused; many pools = aggregator)
 *
 * Output: `data/observation-pass/wallet-attribution.json` plus a
 * human-readable summary printed to stdout. Each wallet gets a tier
 * classification and a confidence-weighted attribution guess.
 *
 * Run:
 *   npx tsx scripts/observation-attribute-wallets.ts
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createPublicClient, http } from "viem";
import { activeChain } from "../src/core/config/chain-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data", "observation-pass");
const TOKENS = ["AERO", "BRETT", "DEGEN"];

// Known address labels — public/inferred mapping for Base. Not exhaustive.
const KNOWN_LABELS: Record<string, string> = {
  // Aggregators / routers
  "0x111111125421ca6dc452d289314280a0f8842a65": "1inch v6 router",
  "0x1111111254eeb25477b68fb85ed929f73a960582": "1inch v5 router",
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff": "0x exchange proxy",
  // CEX hot wallets (Base)
  "0x3304e22ddaa22bcdc5fca2269b418046ae7b566a": "Coinbase deposit",
  "0xeae7380dd4cef6fbd1144f49e4d1e6964258a4f4": "Coinbase 4",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance hot",
  // Common LP / yield protocols
  "0xb9c9bef34d31fa1b6b5e1e84b4f9bcd5b3bce6c2": "Aerodrome staking",
};

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface ValidatedCandidate {
  wallet: string;
  moveHits: number;
  moveCount: number;
  moveRate: number;
  nullHits: number;
  nullCount: number;
  nullRate: number;
  edge: number;
  ups: number;
  downs: number;
  winRate: number;
  tokensInMoves: number;
  tokensActive: number;
  zScore?: number;
  sigTier?: string;
}

interface OnChainInspection {
  isContract: boolean;
  bytecodeSize: number;
  txCount: number; // for EOAs this is nonce; for contracts it's increment
  ethBalanceWei: bigint;
  ethBalanceFormatted: string;
}

interface BehavioralFingerprint {
  tokensWithActivity: string[];
  totalBuysAcrossWindows: number;
  totalUsdAcrossWindows: number;
  avgBuyCountPerHit: number;
  avgUsdPerHit: number;
  poolDiversity: number; // # distinct pools across all hits
  hourOfDayHistogram: number[]; // 0..23 — buy counts by UTC hour
  dayOfWeekHistogram: number[]; // 0=Sun..6=Sat
  largestSingleBuyUsd: number;
}

interface WalletAttribution {
  wallet: string;
  knownLabel?: string;
  candidate: ValidatedCandidate;
  onChain: OnChainInspection;
  behavior: BehavioralFingerprint;
  attributionGuess: string;
  attributionConfidence: "high" | "medium" | "low";
  reasoningPoints: string[];
  tier: "1" | "2" | "3";
}

// ----------------------------------------------------------------------------
// On-chain inspection
// ----------------------------------------------------------------------------

async function inspectOnChain(wallet: string): Promise<OnChainInspection> {
  const endpoints = activeChain.rpcEndpoints.filter(
    (e) => !["flashbots.net", "sequencer.base.org"].some((h) => e.includes(h)),
  );

  let lastErr: Error | null = null;
  for (const endpoint of endpoints) {
    try {
      const client = createPublicClient({
        transport: http(endpoint, { timeout: 10_000, retryCount: 0 }),
      });
      const [code, txCount, balance] = await Promise.all([
        client.getBytecode({ address: wallet as `0x${string}` }),
        client.getTransactionCount({ address: wallet as `0x${string}` }),
        client.getBalance({ address: wallet as `0x${string}` }),
      ]);
      const isContract = !!(code && code !== "0x" && code.length > 2);
      const bytecodeSize = isContract ? (code!.length - 2) / 2 : 0;
      const ethBalanceWei = balance;
      const ethBalanceFormatted = (Number(balance) / 1e18).toFixed(4) + " ETH";
      return {
        isContract,
        bytecodeSize,
        txCount,
        ethBalanceWei,
        ethBalanceFormatted,
      };
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw new Error(`inspectOnChain failed for ${wallet}: ${lastErr?.message}`);
}

// ----------------------------------------------------------------------------
// Behavioral fingerprint from pre-window dumps + null windows
// ----------------------------------------------------------------------------

function buildFingerprint(
  wallet: string,
  perToken: Record<string, { moves: any; null: any }>,
): BehavioralFingerprint {
  const fp: BehavioralFingerprint = {
    tokensWithActivity: [],
    totalBuysAcrossWindows: 0,
    totalUsdAcrossWindows: 0,
    avgBuyCountPerHit: 0,
    avgUsdPerHit: 0,
    poolDiversity: 0,
    hourOfDayHistogram: new Array(24).fill(0),
    dayOfWeekHistogram: new Array(7).fill(0),
    largestSingleBuyUsd: 0,
  };

  let totalHits = 0;
  const poolSet = new Set<string>();

  for (const sym of TOKENS) {
    const data = perToken[sym];
    if (!data) continue;

    let symHits = 0;

    // From move pre-windows (topUserBuyers + largestUserBuys)
    for (const m of data.moves.moves ?? []) {
      const ax = m.preWindowAxes ?? {};
      for (const tb of ax.topUserBuyers ?? []) {
        if (tb.wallet === wallet) {
          symHits++;
          fp.totalBuysAcrossWindows += tb.buyCount;
          fp.totalUsdAcrossWindows += tb.totalUsd;
        }
      }
      for (const lb of ax.largestUserBuys ?? []) {
        if (lb.buyerWallet === wallet) {
          poolSet.add(lb.poolAddress);
          if ((lb.amountUsd ?? 0) > fp.largestSingleBuyUsd) {
            fp.largestSingleBuyUsd = lb.amountUsd ?? 0;
          }
          // hour-of-day + day-of-week
          const ts = Date.parse(lb.timestamp);
          if (Number.isFinite(ts)) {
            const d = new Date(ts);
            fp.hourOfDayHistogram[d.getUTCHours()]++;
            fp.dayOfWeekHistogram[d.getUTCDay()]++;
          }
        }
      }
    }

    // From null windows (topUserBuyers only — null windows don't have largestUserBuys)
    for (const nw of data.null.windows ?? []) {
      for (const tb of nw.topUserBuyers ?? []) {
        if (tb.wallet === wallet) {
          symHits++;
          fp.totalBuysAcrossWindows += tb.buyCount;
          fp.totalUsdAcrossWindows += tb.totalUsd;
        }
      }
    }

    if (symHits > 0) {
      fp.tokensWithActivity.push(sym);
      totalHits += symHits;
    }
  }

  fp.poolDiversity = poolSet.size;
  fp.avgBuyCountPerHit = totalHits > 0 ? fp.totalBuysAcrossWindows / totalHits : 0;
  fp.avgUsdPerHit = totalHits > 0 ? fp.totalUsdAcrossWindows / totalHits : 0;

  return fp;
}

// ----------------------------------------------------------------------------
// Attribution heuristic
// ----------------------------------------------------------------------------

function attributeWallet(
  candidate: ValidatedCandidate,
  onChain: OnChainInspection,
  behavior: BehavioralFingerprint,
  knownLabel?: string,
): { guess: string; confidence: "high" | "medium" | "low"; reasons: string[] } {
  const reasons: string[] = [];

  if (knownLabel) {
    reasons.push(`Known label: ${knownLabel}`);
    return { guess: knownLabel, confidence: "high", reasons };
  }

  // Contract vs EOA
  if (onChain.isContract) {
    reasons.push(
      `Address has bytecode (${onChain.bytecodeSize}b) — this is a CONTRACT, not an EOA`,
    );
    // High tx count contracts are usually routers / MEV / batchers
    if (onChain.txCount > 1000) {
      reasons.push(
        `Contract has high tx count (${onChain.txCount.toLocaleString()}) — likely a router, batcher, or MEV bot`,
      );
      return {
        guess: "CONTRACT — likely router/aggregator/MEV bot",
        confidence: "high",
        reasons,
      };
    }
    return {
      guess: "CONTRACT — purpose unclear (low tx count for a contract)",
      confidence: "medium",
      reasons,
    };
  }

  reasons.push(`EOA (no bytecode)`);
  reasons.push(`Tx count (nonce): ${onChain.txCount.toLocaleString()}`);
  reasons.push(`ETH balance: ${onChain.ethBalanceFormatted}`);

  // Active hours histogram — does it cluster around US business hours (12:00-22:00 UTC)?
  const usBizHours = behavior.hourOfDayHistogram
    .slice(12, 23)
    .reduce((s, x) => s + x, 0);
  const totalHourHits = behavior.hourOfDayHistogram.reduce((s, x) => s + x, 0);
  const usBizRatio = totalHourHits > 0 ? usBizHours / totalHourHits : 0;

  // Day-of-week — does it cluster around weekdays?
  const weekdayHits = behavior.dayOfWeekHistogram
    .slice(1, 6)
    .reduce((s, x) => s + x, 0);
  const totalDayHits = behavior.dayOfWeekHistogram.reduce((s, x) => s + x, 0);
  const weekdayRatio = totalDayHits > 0 ? weekdayHits / totalDayHits : 0;

  reasons.push(
    `Activity: US biz hours ratio=${(usBizRatio * 100).toFixed(0)}%, ` +
      `weekday ratio=${(weekdayRatio * 100).toFixed(0)}%`,
  );

  // Pattern recognition for EOAs
  const isMultiToken = behavior.tokensWithActivity.length >= 2;
  const isHighFrequency = behavior.avgBuyCountPerHit > 10;
  const isWhaleSize = behavior.largestSingleBuyUsd > 50_000;
  const isMicroSize = behavior.avgUsdPerHit < 1_000;
  const txCountSuggestsBot = onChain.txCount > 10_000;

  if (txCountSuggestsBot && isHighFrequency) {
    reasons.push(
      `Very high tx count (${onChain.txCount.toLocaleString()}) + high buys/hit avg ` +
        `(${behavior.avgBuyCountPerHit.toFixed(1)}) → likely systematic / arb bot`,
    );
    return {
      guess: "EOA — systematic / arb bot",
      confidence: "medium",
      reasons,
    };
  }

  if (isMultiToken && isWhaleSize) {
    reasons.push(
      `Multi-token (${behavior.tokensWithActivity.length}) + whale size ($${behavior.largestSingleBuyUsd.toLocaleString()}) — informed trader or institutional desk`,
    );
    return {
      guess: "EOA — multi-token whale (informed trader or institutional)",
      confidence: "medium",
      reasons,
    };
  }

  if (isMultiToken && !isHighFrequency) {
    reasons.push(
      `Multi-token (${behavior.tokensWithActivity.length}) + low frequency (avg ${behavior.avgBuyCountPerHit.toFixed(1)} buys/hit) — selective trader pattern`,
    );
    return {
      guess: "EOA — multi-token selective trader (likely smart-money)",
      confidence: "medium",
      reasons,
    };
  }

  if (isMicroSize && isHighFrequency) {
    reasons.push(
      `Micro-size (avg $${behavior.avgUsdPerHit.toFixed(0)}/hit) + high frequency — ` +
        `retail trader or low-cap MEV`,
    );
    return {
      guess: "EOA — high-frequency retail or low-cap arb",
      confidence: "low",
      reasons,
    };
  }

  if (isWhaleSize) {
    reasons.push(
      `Whale single-buy ($${behavior.largestSingleBuyUsd.toLocaleString()}) — could be institutional or one-off whale`,
    );
    return {
      guess: "EOA — whale (single-token, could be institutional)",
      confidence: "low",
      reasons,
    };
  }

  return {
    guess: "EOA — unclassified (more data needed)",
    confidence: "low",
    reasons,
  };
}

function tierize(c: ValidatedCandidate): "1" | "2" | "3" {
  if (c.tokensInMoves >= 2) return "1";
  if (c.nullRate < 0.05) return "2";
  return "3";
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log("=== NVR Wallet Attribution ===\n");

  // Load validated candidates
  const validatedPath = join(DATA_DIR, "smart-money-validated.json");
  if (!existsSync(validatedPath)) {
    throw new Error(`missing ${validatedPath} — run observation-edge.py first`);
  }
  const validated = JSON.parse(readFileSync(validatedPath, "utf-8")) as {
    significant: ValidatedCandidate[];
  };
  const candidates = validated.significant.filter(
    (r) => (r.zScore ?? 0) >= 2.0,
  );
  console.log(`Loading ${candidates.length} candidates with z >= 2.0\n`);

  // Load per-token data
  const perToken: Record<string, { moves: any; null: any }> = {};
  for (const sym of TOKENS) {
    const movesPath = join(DATA_DIR, `2026-04-29-${sym}-moves.json`);
    const nullPath = join(DATA_DIR, `2026-04-29-${sym}-null-windows.json`);
    if (!existsSync(movesPath) || !existsSync(nullPath)) {
      console.warn(`  ⚠ missing data for ${sym}`);
      continue;
    }
    perToken[sym] = {
      moves: JSON.parse(readFileSync(movesPath, "utf-8")),
      null: JSON.parse(readFileSync(nullPath, "utf-8")),
    };
  }

  // Inspect each
  const attributions: WalletAttribution[] = [];
  let i = 0;
  for (const c of candidates) {
    i++;
    process.stdout.write(
      `[${i}/${candidates.length}] inspecting ${c.wallet.slice(0, 16)}...\r`,
    );
    const onChain = await inspectOnChain(c.wallet);
    const behavior = buildFingerprint(c.wallet, perToken);
    const knownLabel = KNOWN_LABELS[c.wallet.toLowerCase()];
    const { guess, confidence, reasons } = attributeWallet(
      c,
      onChain,
      behavior,
      knownLabel,
    );
    attributions.push({
      wallet: c.wallet,
      knownLabel,
      candidate: c,
      onChain,
      behavior,
      attributionGuess: guess,
      attributionConfidence: confidence,
      reasoningPoints: reasons,
      tier: tierize(c),
    });
  }
  console.log(); // newline after progress

  // Persist (need to convert bigints to strings for JSON)
  const outPath = join(DATA_DIR, "wallet-attribution.json");
  const serializable = attributions.map((a) => ({
    ...a,
    onChain: {
      ...a.onChain,
      ethBalanceWei: a.onChain.ethBalanceWei.toString(),
    },
  }));
  writeFileSync(outPath, JSON.stringify(serializable, null, 2));
  console.log(`\nWrote ${attributions.length} attributions to ${outPath}\n`);

  // Print human-readable summary
  console.log("=" .repeat(100));
  console.log("ATTRIBUTION SUMMARY");
  console.log("=" .repeat(100));
  for (const a of attributions) {
    console.log(`\n${"─".repeat(100)}`);
    console.log(
      `Tier ${a.tier} | z=${a.candidate.zScore?.toFixed(1) ?? "?"} | edge=+${(a.candidate.edge * 100).toFixed(1)}% | win=${(a.candidate.winRate * 100).toFixed(0)}% | ${a.wallet}`,
    );
    console.log(`  ATTRIBUTION: ${a.attributionGuess}  (${a.attributionConfidence} confidence)`);
    console.log(`  ON-CHAIN: ${a.onChain.isContract ? "CONTRACT" : "EOA"}, txCount=${a.onChain.txCount.toLocaleString()}, balance=${a.onChain.ethBalanceFormatted}, bytecodeSize=${a.onChain.bytecodeSize}b`);
    console.log(
      `  BEHAVIOR: tokens=[${a.behavior.tokensWithActivity.join(",")}], ` +
        `avg ${a.behavior.avgBuyCountPerHit.toFixed(1)} buys/hit, ` +
        `avg $${a.behavior.avgUsdPerHit.toLocaleString(undefined, { maximumFractionDigits: 0 })}/hit, ` +
        `largest=$${a.behavior.largestSingleBuyUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}, ` +
        `${a.behavior.poolDiversity} pools`,
    );
    console.log(`  REASONING:`);
    for (const r of a.reasoningPoints) console.log(`    - ${r}`);
  }
  console.log(`\n${"=" .repeat(100)}`);
  console.log(`Done. ${attributions.length} wallets inspected.`);
}

main().catch((e) => {
  console.error("\n[FATAL]", e);
  process.exit(1);
});
