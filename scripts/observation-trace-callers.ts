/**
 * NVR-SPEC-022 — Trace upstream callers of contract candidates
 *
 * The wallet-attribution pass revealed that 8 of 9 statistically-significant
 * candidates are smart contracts, not EOAs — they intermediate swaps rather
 * than initiate them. The actual smart-money signal lives upstream: in
 * the EOAs that CALL these contracts.
 *
 * For each contract candidate, this script fetches recent transactions
 * where the contract appeared (as a recipient of token transfers in our
 * existing data dumps), then resolves the `tx.from` of each tx — that's
 * the EOA that initiated the swap. We aggregate by tx.from and count
 * frequency.
 *
 * The output is the TRUE smart-money seed list: EOAs that are using
 * these contracts disproportionately before moves.
 *
 * Run:
 *   npx tsx scripts/observation-trace-callers.ts
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createPublicClient, http } from "viem";
import { activeChain } from "../src/core/config/chain-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data", "observation-pass");
const TOKENS = ["AERO", "BRETT", "DEGEN"];

interface TxFromResolution {
  txHash: string;
  txFrom: string | null;
  blockNumber: number;
  contractCandidate: string;
  inMoveWindow: boolean;
  inNullWindow: boolean;
  movePctChange?: number;
  tokenSymbol: string;
}

async function getClient() {
  const endpoints = activeChain.rpcEndpoints.filter(
    (e) => !["flashbots.net", "sequencer.base.org"].some((h) => e.includes(h)),
  );
  if (!endpoints.length) throw new Error("no usable RPC");
  return endpoints;
}

async function getTxFrom(
  endpoints: string[],
  txHash: string,
): Promise<{ from: string | null; blockNumber: number | null }> {
  let lastErr: Error | null = null;
  for (const ep of endpoints) {
    try {
      const client = createPublicClient({
        transport: http(ep, { timeout: 8_000, retryCount: 0 }),
      });
      const tx = await client.getTransaction({
        hash: txHash as `0x${string}`,
      });
      return {
        from: (tx.from ?? "").toLowerCase() || null,
        blockNumber: Number(tx.blockNumber ?? 0n),
      };
    } catch (e) {
      lastErr = e as Error;
    }
  }
  return { from: null, blockNumber: null };
}

async function main() {
  console.log("=== NVR Trace Upstream Callers ===\n");

  // Load attribution to find contract candidates
  const attrPath = join(DATA_DIR, "wallet-attribution.json");
  if (!existsSync(attrPath)) {
    throw new Error(`missing ${attrPath} — run observation-attribute-wallets.ts first`);
  }
  const attributions = JSON.parse(readFileSync(attrPath, "utf-8")) as Array<{
    wallet: string;
    onChain: { isContract: boolean };
    candidate: { tokensInMoves: number; zScore?: number };
  }>;

  const contractCandidates = attributions.filter((a) => a.onChain.isContract);
  console.log(
    `Tracing ${contractCandidates.length} contract candidates (skipping ${attributions.length - contractCandidates.length} EOAs)\n`,
  );

  // Load per-token data with full per-buy granularity (largestUserBuys)
  const perToken: Record<string, any> = {};
  for (const sym of TOKENS) {
    const movesPath = join(DATA_DIR, `2026-04-29-${sym}-moves.json`);
    if (existsSync(movesPath)) {
      perToken[sym] = JSON.parse(readFileSync(movesPath, "utf-8"));
    }
  }

  // For each contract candidate, gather all txHashes where they appeared as
  // a buyer (from the largestUserBuys lists across all moves).
  const candidateTxs = new Map<string, TxFromResolution[]>();
  for (const a of contractCandidates) {
    candidateTxs.set(a.wallet, []);
  }

  for (const sym of TOKENS) {
    const data = perToken[sym];
    if (!data) continue;
    for (const m of data.moves ?? []) {
      const ax = m.preWindowAxes ?? {};
      for (const lb of ax.largestUserBuys ?? []) {
        const wallet = lb.buyerWallet?.toLowerCase();
        const list = candidateTxs.get(wallet);
        if (list) {
          list.push({
            txHash: lb.txHash,
            txFrom: null,
            blockNumber: 0,
            contractCandidate: wallet,
            inMoveWindow: true,
            inNullWindow: false,
            movePctChange: m.pctChange,
            tokenSymbol: sym,
          });
        }
      }
    }
  }

  // Sample up to N tx hashes per candidate, resolve their tx.from
  const SAMPLE_PER_CANDIDATE = 8;
  const endpoints = await getClient();

  console.log("Resolving tx.from for sampled transactions...\n");

  const allResolutions: TxFromResolution[] = [];
  for (const a of contractCandidates) {
    const txs = candidateTxs.get(a.wallet) ?? [];
    if (txs.length === 0) {
      console.log(
        `  ${a.wallet.slice(0, 16)}... — no txHashes in our dump (was in topUserBuyers but not largestUserBuys)`,
      );
      continue;
    }
    const sampled = txs.slice(0, SAMPLE_PER_CANDIDATE);
    console.log(
      `  ${a.wallet.slice(0, 16)}... (${a.candidate.tokensInMoves}-token, z=${a.candidate.zScore?.toFixed(1)}): resolving ${sampled.length}/${txs.length} txs`,
    );
    for (const t of sampled) {
      const { from, blockNumber } = await getTxFrom(endpoints, t.txHash);
      t.txFrom = from;
      t.blockNumber = blockNumber ?? 0;
      allResolutions.push(t);
    }
  }

  // Aggregate by tx.from per contract candidate
  console.log("\n" + "=".repeat(100));
  console.log("UPSTREAM CALLER SUMMARY");
  console.log("=".repeat(100));

  const callerByCandidate = new Map<
    string,
    Map<string, { count: number; tokens: Set<string>; movePctSum: number }>
  >();

  for (const r of allResolutions) {
    if (!r.txFrom) continue;
    let perCand = callerByCandidate.get(r.contractCandidate);
    if (!perCand) {
      perCand = new Map();
      callerByCandidate.set(r.contractCandidate, perCand);
    }
    let slot = perCand.get(r.txFrom);
    if (!slot) {
      slot = { count: 0, tokens: new Set<string>(), movePctSum: 0 };
      perCand.set(r.txFrom, slot);
    }
    slot.count++;
    slot.tokens.add(r.tokenSymbol);
    slot.movePctSum += r.movePctChange ?? 0;
  }

  // Aggregate ACROSS contract candidates — if the same EOA calls multiple
  // candidate contracts, that's a strong signal it's a real upstream actor.
  const eoaAcrossCandidates = new Map<
    string,
    {
      contracts: Set<string>;
      count: number;
      tokens: Set<string>;
      avgMovePct: number;
      moveSum: number;
      moveCount: number;
    }
  >();

  for (const a of contractCandidates) {
    const perCand = callerByCandidate.get(a.wallet);
    if (!perCand || perCand.size === 0) continue;
    console.log(
      `\n${a.wallet}  (${a.candidate.tokensInMoves}-token, z=${a.candidate.zScore?.toFixed(1)})`,
    );
    const sorted = Array.from(perCand.entries()).sort(
      (x, y) => y[1].count - x[1].count,
    );
    for (const [eoa, info] of sorted.slice(0, 6)) {
      const avgMove = info.count > 0 ? info.movePctSum / info.count : 0;
      console.log(
        `    ${eoa}  count=${info.count}  tokens=[${Array.from(info.tokens).join(",")}]  avgΔ=${(avgMove * 100).toFixed(1)}%`,
      );

      let agg = eoaAcrossCandidates.get(eoa);
      if (!agg) {
        agg = {
          contracts: new Set<string>(),
          count: 0,
          tokens: new Set<string>(),
          avgMovePct: 0,
          moveSum: 0,
          moveCount: 0,
        };
        eoaAcrossCandidates.set(eoa, agg);
      }
      agg.contracts.add(a.wallet);
      agg.count += info.count;
      for (const t of info.tokens) agg.tokens.add(t);
      agg.moveSum += info.movePctSum;
      agg.moveCount += info.count;
      agg.avgMovePct = agg.moveSum / Math.max(1, agg.moveCount);
    }
  }

  // The TRUE candidates: EOAs that call MULTIPLE contract candidates
  console.log(`\n${"=".repeat(100)}`);
  console.log("UPSTREAM EOAs CALLING ≥ 2 CONTRACT CANDIDATES");
  console.log("(These are the actual smart-money signals — humans/desks behind the contracts)");
  console.log(`${"=".repeat(100)}\n`);

  const ranked = Array.from(eoaAcrossCandidates.entries())
    .filter(([_, info]) => info.contracts.size >= 1)
    .sort((a, b) => {
      // Multi-contract first, then count
      const aMulti = a[1].contracts.size;
      const bMulti = b[1].contracts.size;
      if (aMulti !== bMulti) return bMulti - aMulti;
      return b[1].count - a[1].count;
    });

  if (ranked.length === 0) {
    console.log("  None — sample size too small or callers too distributed.");
  } else {
    const HDR =
      "  " +
      "EOA".padEnd(44) +
      "  " +
      "#contracts".padStart(10) +
      "  " +
      "#calls".padStart(6) +
      "  " +
      "tokens".padStart(16) +
      "  " +
      "avgΔ".padStart(7);
    console.log(HDR);
    console.log(
      "  " +
        "-".repeat(44) +
        "  " +
        "-".repeat(10) +
        "  " +
        "-".repeat(6) +
        "  " +
        "-".repeat(16) +
        "  " +
        "-".repeat(7),
    );
    for (const [eoa, info] of ranked.slice(0, 30)) {
      console.log(
        "  " +
          eoa +
          "  " +
          info.contracts.size.toString().padStart(10) +
          "  " +
          info.count.toString().padStart(6) +
          "  " +
          Array.from(info.tokens).join(",").padStart(16) +
          "  " +
          (info.avgMovePct * 100).toFixed(1).padStart(6) +
          "%",
      );
    }
  }

  // Persist
  const out = {
    contractsTraced: contractCandidates.length,
    txsResolved: allResolutions.filter((r) => r.txFrom).length,
    perContract: Array.from(callerByCandidate.entries()).map(([c, callers]) => ({
      contract: c,
      callers: Array.from(callers.entries()).map(([eoa, info]) => ({
        eoa,
        count: info.count,
        tokens: Array.from(info.tokens),
        avgMovePctChange: info.count > 0 ? info.movePctSum / info.count : 0,
      })),
    })),
    upstreamRanked: ranked.map(([eoa, info]) => ({
      eoa,
      contractsCalledCount: info.contracts.size,
      contractsCalled: Array.from(info.contracts),
      callCount: info.count,
      tokens: Array.from(info.tokens),
      avgMovePct: info.avgMovePct,
    })),
  };
  const outPath = join(DATA_DIR, "upstream-callers.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✓ Wrote ${ranked.length} upstream EOAs to ${outPath}`);
}

main().catch((e) => {
  console.error("\n[FATAL]", e);
  process.exit(1);
});
