/**
 * NVR-SPEC-022 — Pattern P-LPDrainage retrospective
 *
 * Hypothesis: Large LP withdrawals from a token's main pool indicate
 * INFORMED actors removing liquidity ahead of expected volatility.
 * Different signal axis from everything killed so far:
 *   - Not BUY-side flow (P-IntermediarySurge — KILL)
 *   - Not post-event price action (P-FadeMove + P-MomentumContinuation — KILL)
 *   - Liquidity-side leading indicator
 *
 * Trigger: a single LP Burn event >= USD threshold (default $25k).
 * Forward measurement: ±3% target/stop within 3h, same as event-reaction.
 * Volume null: high-activity windows that did NOT contain a burn ≥ threshold.
 *
 * Burn event ABIs (3 pool types in our universe):
 *   Aerodrome v2 (AERO/USDC main):
 *     event Burn(address indexed sender, address indexed to, uint amount0, uint amount1)
 *
 *   Aerodrome Slipstream (BRETT/WETH main, Uniswap-V3 fork):
 *   Uniswap V3 (DEGEN/WETH main):
 *     event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper,
 *                uint128 amount, uint amount0, uint amount1)
 *
 * Run:
 *   npx tsx scripts/observation-lp-drainage.ts
 *
 * Environment:
 *   LP_LOOKBACK_HOURS         default 720 (30d)
 *   LP_BURN_USD_THRESHOLD     default 25000  ($25k)
 *   LP_FORWARD_HOURS          default 3.0
 *   LP_TARGET_PCT             default 0.03
 *   LP_STOP_PCT               default 0.03
 *   LP_NULL_SAMPLES           default 50
 *   LP_TOKENS                 default AERO,BRETT,DEGEN
 */

import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createPublicClient, http, parseAbiItem } from "viem";

import { GeckoTerminalHistoricalFeed } from "../src/simulation/data/price-feed.js";
import { activeChain } from "../src/core/config/chain-config.js";

// ----------------------------------------------------------------------------
// Pool config (with DEX type for ABI selection)
// ----------------------------------------------------------------------------

type PoolType = "aerodrome-v2" | "uniswap-v3";

interface PoolConfig {
  symbol: string;
  pool: string; // lowercased pool address
  type: PoolType;
  // token0/token1 decimals (for converting raw burn amounts to human units)
  decimals0: number;
  decimals1: number;
  // Which side is our watched token (token0 or token1)?
  watchedIsToken0: boolean;
  // Identifier of the OTHER side for USD valuation
  otherSymbol: string; // "USDC" or "WETH" — used only for logging
}

// Confirmed via GeckoTerminal /pools/<addr> 2026-05-04
const POOLS: PoolConfig[] = [
  {
    symbol: "AERO",
    pool: "0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d", // AERO/USDC, aerodrome v2
    type: "aerodrome-v2",
    decimals0: 6, // USDC
    decimals1: 18, // AERO
    watchedIsToken0: false,
    otherSymbol: "USDC",
  },
  {
    symbol: "BRETT",
    pool: "0x4e829f8a5213c42535ab84aa40bd4adcce9cba02", // BRETT/WETH, aerodrome slipstream
    type: "uniswap-v3",
    decimals0: 18, // BRETT
    decimals1: 18, // WETH
    watchedIsToken0: true,
    otherSymbol: "WETH",
  },
  {
    symbol: "DEGEN",
    pool: "0xc9034c3e7f58003e6ae0c8438e7c8f4598d5acaa", // DEGEN/WETH, uniswap v3
    type: "uniswap-v3",
    decimals0: 18, // DEGEN
    decimals1: 18, // WETH
    watchedIsToken0: true,
    otherSymbol: "WETH",
  },
];

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

const LOOKBACK_HOURS = parseInt(process.env["LP_LOOKBACK_HOURS"] ?? "720", 10);
const BURN_USD_THRESHOLD = parseFloat(
  process.env["LP_BURN_USD_THRESHOLD"] ?? "25000",
);
const FORWARD_HOURS = parseFloat(process.env["LP_FORWARD_HOURS"] ?? "3.0");
const TARGET_PCT = parseFloat(process.env["LP_TARGET_PCT"] ?? "0.03");
const STOP_PCT = parseFloat(process.env["LP_STOP_PCT"] ?? "0.03");
const NULL_SAMPLES = parseInt(process.env["LP_NULL_SAMPLES"] ?? "50", 10);
const TOKEN_FILTER = (process.env["LP_TOKENS"] ?? "AERO,BRETT,DEGEN")
  .split(",")
  .map((t) => t.trim().toUpperCase())
  .filter(Boolean);

const BASE_BLOCK_TIME_SEC = 2;
const BLOCK_CHUNK_SIZE = 10_000n;
const INTER_CHUNK_DELAY_MS = 250;
const MAX_CHUNK_RETRIES = 3;

// ----------------------------------------------------------------------------
// Burn event ABIs
// ----------------------------------------------------------------------------

const V2_BURN_EVENT = parseAbiItem(
  "event Burn(address indexed sender, address indexed to, uint256 amount0, uint256 amount1)",
);
const V3_BURN_EVENT = parseAbiItem(
  "event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
);

// ----------------------------------------------------------------------------
// Block ↔ time helpers
// ----------------------------------------------------------------------------

interface BlockAnchor {
  blockNumber: bigint;
  unixSec: number;
}

async function getBlockAnchor(): Promise<BlockAnchor> {
  const endpoints = activeChain.rpcEndpoints.filter(
    (e) => !["flashbots.net", "sequencer.base.org"].some((h) => e.includes(h)),
  );
  for (const ep of endpoints) {
    try {
      const c = createPublicClient({ transport: http(ep, { timeout: 10_000, retryCount: 0 }) });
      const block = await c.getBlock();
      return { blockNumber: block.number ?? 0n, unixSec: Number(block.timestamp ?? 0) };
    } catch {
      // try next
    }
  }
  throw new Error("no usable Base RPC");
}

function blockAtTime(anchor: BlockAnchor, unixSec: number): bigint {
  const deltaSec = unixSec - anchor.unixSec;
  const deltaBlocks = BigInt(Math.round(deltaSec / BASE_BLOCK_TIME_SEC));
  const block = anchor.blockNumber + deltaBlocks;
  return block < 0n ? 0n : block;
}

function timeAtBlock(anchor: BlockAnchor, blockNumber: bigint): number {
  const deltaBlocks = Number(blockNumber - anchor.blockNumber);
  return anchor.unixSec + deltaBlocks * BASE_BLOCK_TIME_SEC;
}

// ----------------------------------------------------------------------------
// Burn fetcher (handles both V2 and V3 ABIs)
// ----------------------------------------------------------------------------

interface RawBurn {
  symbol: string;
  pool: string;
  blockNumber: bigint;
  txHash: string;
  logIndex: number;
  amount0Raw: bigint; // raw token0 amount
  amount1Raw: bigint; // raw token1 amount
}

async function fetchPoolBurns(opts: {
  pool: PoolConfig;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<RawBurn[]> {
  const endpoints = activeChain.rpcEndpoints.filter(
    (e) => !["flashbots.net", "sequencer.base.org"].some((h) => e.includes(h)),
  );
  if (!endpoints.length) throw new Error("no usable RPC");

  const event = opts.pool.type === "aerodrome-v2" ? V2_BURN_EVENT : V3_BURN_EVENT;
  const out: RawBurn[] = [];
  let endpointCursor = 0;

  for (let start = opts.fromBlock; start <= opts.toBlock; start += BLOCK_CHUNK_SIZE) {
    const chunkEnd =
      start + BLOCK_CHUNK_SIZE - 1n > opts.toBlock
        ? opts.toBlock
        : start + BLOCK_CHUNK_SIZE - 1n;

    let logs: unknown[] | null = null;
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
      const ep = endpoints[endpointCursor % endpoints.length]!;
      try {
        const client = createPublicClient({ transport: http(ep, { timeout: 15_000, retryCount: 0 }) });
        const r = await client.getLogs({
          address: opts.pool.pool as `0x${string}`,
          event,
          fromBlock: start,
          toBlock: chunkEnd,
        });
        logs = r;
        break;
      } catch (e) {
        lastErr = e as Error;
        endpointCursor++;
      }
    }
    if (logs === null) {
      console.warn(
        `[lp-burns] ${opts.pool.symbol} chunk ${start}..${chunkEnd}: ${lastErr?.message?.slice(0, 80)}`,
      );
      await new Promise((r) => setTimeout(r, INTER_CHUNK_DELAY_MS));
      continue;
    }

    for (const log of logs as Array<{
      args?: { amount0?: bigint; amount1?: bigint };
      blockNumber: bigint | null;
      transactionHash: string | null;
      logIndex: number | null;
    }>) {
      if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) continue;
      const a0 = log.args?.amount0 ?? 0n;
      const a1 = log.args?.amount1 ?? 0n;
      if (a0 === 0n && a1 === 0n) continue;
      out.push({
        symbol: opts.pool.symbol,
        pool: opts.pool.pool,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        amount0Raw: a0,
        amount1Raw: a1,
      });
    }
    await new Promise((r) => setTimeout(r, INTER_CHUNK_DELAY_MS));
  }

  return out;
}

// ----------------------------------------------------------------------------
// USD valuation of a burn
// ----------------------------------------------------------------------------

/**
 * Convert raw token amounts to USD using:
 *   - watched-token side: priced from GeckoTerminal feed
 *   - other side: WETH priced ~$3000 fallback / USDC = $1
 *
 * Sums both sides (since LP always involves both tokens).
 */
async function valueBurnInUsd(
  burn: RawBurn,
  pool: PoolConfig,
  ts: number,
  feed: GeckoTerminalHistoricalFeed,
): Promise<number> {
  const watchedDecimals = pool.watchedIsToken0 ? pool.decimals0 : pool.decimals1;
  const otherDecimals = pool.watchedIsToken0 ? pool.decimals1 : pool.decimals0;
  const watchedRaw = pool.watchedIsToken0 ? burn.amount0Raw : burn.amount1Raw;
  const otherRaw = pool.watchedIsToken0 ? burn.amount1Raw : burn.amount0Raw;

  const watchedTokens = Number(watchedRaw) / 10 ** watchedDecimals;
  const otherTokens = Number(otherRaw) / 10 ** otherDecimals;

  const watchedPrice = await feed.getPriceAt(pool.symbol, new Date(ts * 1000).toISOString());
  const watchedUsd = watchedPrice ? watchedTokens * watchedPrice : 0;

  let otherPrice = 0;
  if (pool.otherSymbol === "USDC") {
    otherPrice = 1;
  } else if (pool.otherSymbol === "WETH") {
    // Try to use the WETH price from feed (may not be loaded; fallback ~$3000 — Henry's portfolio shows ETH ~$3000 today)
    otherPrice = (await feed.getPriceAt("WETH", new Date(ts * 1000).toISOString())) ?? 3000;
  }
  const otherUsd = otherTokens * otherPrice;

  return watchedUsd + otherUsd;
}

// ----------------------------------------------------------------------------
// Forward outcome measurement (parallel to event-reaction.ts)
// ----------------------------------------------------------------------------

interface CandlePoint {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
}

interface BurnTrigger {
  symbol: string;
  burnTs: number;
  burnUsd: number;
  burnTxHash: string;
  burnPrice: number; // price at burn time
}

interface BurnOutcome extends BurnTrigger {
  // Both directional bets measured (we don't know if burns predict up or down a priori)
  upHit: boolean; // bounce ≥ +3% within window
  downHit: boolean; // drop ≤ −3% within window
  upFirst: boolean; // up hit BEFORE down
  downFirst: boolean; // down hit BEFORE up
  fwdReturnPct: number; // close-to-close return at end of window (or first exit)
  maxFwdHigh: number;
  maxFwdLow: number;
  exitReason: "up_target" | "down_target" | "time_stop" | "no_data";
}

function measureBurnOutcome(
  trigger: BurnTrigger,
  candles: CandlePoint[],
): BurnOutcome {
  const fwdSec = FORWARD_HOURS * 3600;
  const startTs = trigger.burnTs;
  const endTs = startTs + fwdSec;
  const startIdx = candles.findIndex((c) => c.ts >= startTs);
  if (startIdx === -1) {
    return {
      ...trigger,
      upHit: false,
      downHit: false,
      upFirst: false,
      downFirst: false,
      fwdReturnPct: 0,
      maxFwdHigh: 0,
      maxFwdLow: 0,
      exitReason: "no_data",
    };
  }

  const px = trigger.burnPrice;
  let upHit = false;
  let downHit = false;
  let upFirst = false;
  let downFirst = false;
  let maxFwdHigh = 0;
  let maxFwdLow = 0;
  let exitReason: BurnOutcome["exitReason"] = "time_stop";
  let fwdReturnPct = 0;

  for (let i = startIdx; i < candles.length && candles[i]!.ts <= endTs; i++) {
    const c = candles[i]!;
    const maxPct = (c.high - px) / px;
    const minPct = (c.low - px) / px;
    const closePct = (c.close - px) / px;
    if (maxPct > maxFwdHigh) maxFwdHigh = maxPct;
    if (minPct < maxFwdLow) maxFwdLow = minPct;

    // Determine which target hit first within this candle (approximation —
    // ambiguous if both hit; default to whichever's magnitude is closer to open)
    const upHitNow = maxPct >= TARGET_PCT && !upHit;
    const downHitNow = minPct <= -STOP_PCT && !downHit;
    if (upHitNow) {
      upHit = true;
      if (!downHit) upFirst = true;
    }
    if (downHitNow) {
      downHit = true;
      if (!upHit) downFirst = true;
    }
    if (upHit && downHit) break; // both resolved, time-stop math doesn't matter

    fwdReturnPct = closePct;
  }

  if (upFirst) {
    fwdReturnPct = TARGET_PCT;
    exitReason = "up_target";
  } else if (downFirst) {
    fwdReturnPct = -STOP_PCT;
    exitReason = "down_target";
  } else if (upHit && !downHit) {
    fwdReturnPct = TARGET_PCT;
    exitReason = "up_target";
  } else if (downHit && !upHit) {
    fwdReturnPct = -STOP_PCT;
    exitReason = "down_target";
  } else {
    // time stop — use last close pct
    exitReason = "time_stop";
  }

  return {
    ...trigger,
    upHit,
    downHit,
    upFirst,
    downFirst,
    fwdReturnPct,
    maxFwdHigh,
    maxFwdLow,
    exitReason,
  };
}

// ----------------------------------------------------------------------------
// Volume-null sampling (high-activity windows that did NOT contain a burn ≥ threshold)
// ----------------------------------------------------------------------------

interface NullOutcome {
  symbol: string;
  anchorTs: number;
  anchorPrice: number;
  upHit: boolean;
  downHit: boolean;
  maxFwdHigh: number;
  maxFwdLow: number;
}

function findHighActivityNoBurnAnchors(
  candles: CandlePoint[],
  burnTimes: Set<number>,
  quartileThreshold: number = 0.75,
): number[] {
  if (candles.length < 8) return [];
  const ROLLING = 4;

  const rollingVol: { ts: number; vol: number; idx: number }[] = [];
  for (let i = ROLLING - 1; i < candles.length; i++) {
    let v = 0;
    for (let j = i - ROLLING + 1; j <= i; j++) v += candles[j]!.volumeUsd;
    rollingVol.push({ ts: candles[i]!.ts, vol: v, idx: i });
  }
  if (rollingVol.length === 0) return [];

  const sortedVol = [...rollingVol].sort((a, b) => a.vol - b.vol);
  const threshIdx = Math.floor(quartileThreshold * sortedVol.length);
  const volThresh = sortedVol[Math.min(threshIdx, sortedVol.length - 1)]!.vol;

  // Reject anchors within FORWARD_HOURS of any large-burn timestamp
  const fwdSec = FORWARD_HOURS * 3600;
  const burnArr = Array.from(burnTimes).sort((a, b) => a - b);
  const anchors: number[] = [];
  for (const rv of rollingVol) {
    if (rv.vol < volThresh) continue;
    const tooClose = burnArr.some((b) => Math.abs(b - rv.ts) < fwdSec);
    if (tooClose) continue;
    anchors.push(rv.ts);
  }
  return anchors;
}

function sampleN<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return [...arr];
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

function measureNullOutcome(
  symbol: string,
  anchorTs: number,
  candles: CandlePoint[],
): NullOutcome | null {
  const idx = candles.findIndex((c) => c.ts === anchorTs);
  if (idx === -1) return null;
  const px = candles[idx]!.close;
  if (px <= 0) return null;
  const fwdSec = FORWARD_HOURS * 3600;
  const endTs = anchorTs + fwdSec;
  let upHit = false;
  let downHit = false;
  let maxFwdHigh = 0;
  let maxFwdLow = 0;
  for (let i = idx + 1; i < candles.length && candles[i]!.ts <= endTs; i++) {
    const c = candles[i]!;
    const maxPct = (c.high - px) / px;
    const minPct = (c.low - px) / px;
    if (maxPct > maxFwdHigh) maxFwdHigh = maxPct;
    if (minPct < maxFwdLow) maxFwdLow = minPct;
    if (maxPct >= TARGET_PCT) upHit = true;
    if (minPct <= -STOP_PCT) downHit = true;
  }
  return { symbol, anchorTs, anchorPrice: px, upHit, downHit, maxFwdHigh, maxFwdLow };
}

// ----------------------------------------------------------------------------
// Stats
// ----------------------------------------------------------------------------

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  return [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
}
function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log("=== NVR Pattern P-LPDrainage Retrospective ===");
  console.log(
    `Lookback ${LOOKBACK_HOURS}h, burn threshold $${BURN_USD_THRESHOLD.toLocaleString()}, ` +
      `forward ${FORWARD_HOURS}h, target ±${(TARGET_PCT * 100).toFixed(0)}%/${(STOP_PCT * 100).toFixed(0)}%`,
  );
  console.log(`Tokens: ${TOKEN_FILTER.join(", ")}, null samples ${NULL_SAMPLES}/token`);
  console.log("");

  // Anchor block
  const anchor = await getBlockAnchor();
  console.log(`Anchor: block ${anchor.blockNumber} @ ${new Date(anchor.unixSec * 1000).toISOString()}`);

  // Preload OHLCV (cache-backed)
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const cacheDir = join(__dirname, "..", "data", "observation-pass", ".price-cache");
  const feed = new GeckoTerminalHistoricalFeed({
    timeframe: "minute",
    aggregate: 15,
    cacheDir,
    cacheMaxAgeSec: 7 * 24 * 3600,
    log: (m) => console.log(`  ${m}`),
  });
  const nowMs = Date.now();
  const toISO = new Date(nowMs).toISOString();
  const fromISO = new Date(nowMs - LOOKBACK_HOURS * 3600 * 1000).toISOString();

  // Also try to preload WETH for USD valuation of WETH-paired pools
  const symbolsToPreload = [...TOKEN_FILTER, "WETH"];
  const preload = await feed.preload(symbolsToPreload, fromISO, toISO);
  console.log(`Preload: ${preload.loaded} loaded, ${preload.failed.length} failed: ${preload.failed.join(",") || "none"}\n`);

  const pools = POOLS.filter((p) => TOKEN_FILTER.includes(p.symbol) && !preload.failed.includes(p.symbol));
  if (pools.length === 0) {
    console.log("No pools to process (all preload-failed). Aborting.");
    return;
  }

  const fromBlock = blockAtTime(anchor, anchor.unixSec - LOOKBACK_HOURS * 3600);
  const toBlock = anchor.blockNumber;

  const allTriggers: BurnOutcome[] = [];
  const allNulls: NullOutcome[] = [];

  for (const pool of pools) {
    console.log(`\n--- ${pool.symbol} (${pool.type}, pool=${pool.pool.slice(0, 10)}…) ---`);
    const t0 = Date.now();
    const burns = await fetchPoolBurns({ pool, fromBlock, toBlock });
    console.log(`  fetched ${burns.length} burns in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    const candles = feed.getCandlesInWindow(pool.symbol, fromISO, toISO);
    const cps: CandlePoint[] = candles.map((c) => ({
      ts: c.ts, open: c.open, high: c.high, low: c.low, close: c.close, volumeUsd: c.volumeUsd,
    }));

    const largeBurnTimes = new Set<number>();
    let largeCount = 0;
    let smallCount = 0;
    for (const b of burns) {
      const ts = timeAtBlock(anchor, b.blockNumber);
      const usd = await valueBurnInUsd(b, pool, ts, feed);
      if (usd < BURN_USD_THRESHOLD) {
        smallCount++;
        continue;
      }
      largeCount++;
      largeBurnTimes.add(ts);
      // Build trigger
      const candleAtBurn = cps.find((c) => c.ts >= ts);
      if (!candleAtBurn) continue;
      const trigger: BurnTrigger = {
        symbol: pool.symbol,
        burnTs: ts,
        burnUsd: usd,
        burnTxHash: b.txHash,
        burnPrice: candleAtBurn.close,
      };
      allTriggers.push(measureBurnOutcome(trigger, cps));
    }
    console.log(`  ${largeCount} burns ≥ $${BURN_USD_THRESHOLD.toLocaleString()} (${smallCount} smaller, ignored)`);

    // Null sampling: high-activity windows that did NOT contain a large burn
    const anchors = findHighActivityNoBurnAnchors(cps, largeBurnTimes);
    const sampled = sampleN(anchors, NULL_SAMPLES);
    let nullCount = 0;
    for (const a of sampled) {
      const nu = measureNullOutcome(pool.symbol, a, cps);
      if (nu) {
        allNulls.push(nu);
        nullCount++;
      }
    }
    console.log(`  null sampling: ${anchors.length} qualifying anchors → ${nullCount} measured`);
  }

  console.log("");

  // ─── Pattern verdicts ───────────────────────────────────────────────────

  function verdictFor(
    label: string,
    direction: "up" | "down",
    triggers: BurnOutcome[],
    nulls: NullOutcome[],
  ) {
    const n = triggers.length;
    if (n === 0) {
      console.log(`\n[${label}]  no triggers`);
      return null;
    }
    const hitFn = (o: BurnOutcome) => (direction === "up" ? o.upFirst : o.downFirst);
    const stopFn = (o: BurnOutcome) => (direction === "up" ? o.downFirst : o.upFirst);
    const fwdFn = (o: BurnOutcome) => (direction === "up" ? o.fwdReturnPct : -o.fwdReturnPct);
    const nullHitFn = (n: NullOutcome) => (direction === "up" ? n.upHit : n.downHit);

    const hits = triggers.filter(hitFn).length;
    const stops = triggers.filter(stopFn).length;
    const timeouts = n - hits - stops;
    const fwdPcts = triggers.map(fwdFn);
    const μ = mean(fwdPcts);
    const med = median(fwdPcts);
    const σ = stdev(fwdPcts);
    const skew = σ > 0 ? (μ - med) / σ : 0;
    const hitRate = hits / n;
    const stopRate = stops / n;
    const nullN = nulls.length;
    const nullHits = nulls.filter(nullHitFn).length;
    const nullHitRate = nullN > 0 ? nullHits / nullN : 0;
    const edge = hitRate - nullHitRate;

    console.log(`\n[${label}]  n=${n}`);
    console.log(`  HIT (${direction === "up" ? "+" : "−"}${(TARGET_PCT * 100).toFixed(0)}% target hit FIRST): ${(hitRate * 100).toFixed(1)}%   [target ≥ 40%]`);
    console.log(`  STOP (opposite hit first): ${(stopRate * 100).toFixed(1)}%`);
    console.log(`  Time-stop: ${((timeouts / n) * 100).toFixed(1)}%`);
    console.log(`  Forward dist (signed for direction): μ=${(μ * 100).toFixed(2)}%  med=${(med * 100).toFixed(2)}%  σ=${(σ * 100).toFixed(2)}%  skew=${skew.toFixed(2)}`);
    console.log(`  Volume-null comparison: null-hit-rate=${(nullHitRate * 100).toFixed(1)}% (n=${nullN})  →  EDGE = ${(edge * 100).toFixed(1)}pp`);

    const gateHit = hitRate >= 0.4;
    const gateNull = edge >= 0.15;
    const gateShape = !(Math.abs(μ) < σ * 0.2 && σ < 0.015);
    const gateSample = n >= 30;
    const allPass = gateHit && gateNull && gateShape && gateSample;
    console.log(`  Gates: hit≥40%${gateHit ? " ✓" : " ✗"} | edge≥15pp${gateNull ? " ✓" : " ✗"} | not-tight-Gaussian${gateShape ? " ✓" : " ✗"} | n≥30${gateSample ? " ✓" : " ✗"}  →  ${allPass ? "PASS" : "FAIL"}`);

    return { label, direction, n, hitRate, stopRate, μ, med, σ, skew, nullHitRate, edge, allPass };
  }

  const verdicts: any[] = [];
  // P-LPDrainage UP — bet on bounce after a large burn (inverse-thesis, less common)
  const v1 = verdictFor("P-LPDrainage-UP (large burn → +3% bounce)", "up", allTriggers, allNulls);
  if (v1) verdicts.push(v1);
  // P-LPDrainage DOWN — bet on drop after a large burn (informed-exit thesis)
  const v2 = verdictFor("P-LPDrainage-DOWN (large burn → −3% drop)", "down", allTriggers, allNulls);
  if (v2) verdicts.push(v2);

  // Persist
  const __dirname2 = dirname(fileURLToPath(import.meta.url));
  const outDir = join(__dirname2, "..", "data", "observation-pass");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  writeFileSync(
    join(outDir, `${stamp}-lp-drainage-retro.json`),
    JSON.stringify(
      {
        runDate: new Date().toISOString(),
        config: {
          lookbackHours: LOOKBACK_HOURS,
          burnUsdThreshold: BURN_USD_THRESHOLD,
          forwardHours: FORWARD_HOURS,
          targetPct: TARGET_PCT,
          stopPct: STOP_PCT,
          tokens: TOKEN_FILTER,
        },
        verdicts,
        triggers: allTriggers.map((t) => ({ ...t, burnTs: t.burnTs })),
        nulls: allNulls,
      },
      null,
      2,
    ),
  );
  console.log(`\n✓ Written: ${join(outDir, `${stamp}-lp-drainage-retro.json`)}`);
}

main().catch((e) => {
  console.error("\n[FATAL]", e);
  process.exit(1);
});
