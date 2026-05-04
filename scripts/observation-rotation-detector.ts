/**
 * NVR-SPEC-022 — Pattern P-RotationDetector retrospective
 *
 * Pair-trade relative-momentum mean reversion. Fundamentally different
 * action class from everything killed today:
 *   - Not directional bet on absolute price
 *   - Not event-triggered single-asset trade
 *   - Pair trade: when token A outperforms token B by ≥X% over a lookback,
 *     bet on the spread mean-reverting by Y% over a forward window
 *
 * Long-only spot expression: rotate a position FROM the over-performer
 * INTO the under-performer. (Sell AERO, buy WETH if AERO/WETH ratio is
 * unusually high.)
 *
 * Why this could work where the others didn't:
 *   - Relative price reverts more reliably than absolute price (well-known
 *     equity anomaly; tested for crypto pair).
 *   - Inherently market-neutral — doesn't depend on direction of either
 *     token, just their RELATIVE motion.
 *   - Timeframe is days, not hours — sidesteps the noise floor that killed
 *     1-3h directional bets.
 *
 * Run:
 *   npx tsx scripts/observation-rotation-detector.ts
 *
 * Environment:
 *   ROT_LOOKBACK_HOURS         default 720 (30d)
 *   ROT_SPREAD_LOOKBACK_DAYS   default 7
 *   ROT_SPREAD_THRESHOLD       default 0.15 (15% relative outperformance)
 *   ROT_FORWARD_DAYS           default 5
 *   ROT_TARGET_REVERSION       default 0.05 (5% mean reversion of spread)
 *   ROT_PAIRS                  default AERO/WETH,DEGEN/WETH,BRETT/WETH
 *   ROT_NULL_SAMPLES           default 50 per pair
 */

import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { GeckoTerminalHistoricalFeed } from "../src/simulation/data/price-feed.js";

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

const LOOKBACK_HOURS = parseInt(process.env["ROT_LOOKBACK_HOURS"] ?? "720", 10);
const SPREAD_LOOKBACK_DAYS = parseFloat(
  process.env["ROT_SPREAD_LOOKBACK_DAYS"] ?? "7",
);
const SPREAD_THRESHOLD = parseFloat(process.env["ROT_SPREAD_THRESHOLD"] ?? "0.15");
const FORWARD_DAYS = parseFloat(process.env["ROT_FORWARD_DAYS"] ?? "5");
const TARGET_REVERSION = parseFloat(
  process.env["ROT_TARGET_REVERSION"] ?? "0.05",
);
const PAIRS_INPUT = process.env["ROT_PAIRS"] ?? "AERO/WETH,DEGEN/WETH,BRETT/WETH";
const NULL_SAMPLES = parseInt(process.env["ROT_NULL_SAMPLES"] ?? "50", 10);

// Anti-stack: don't double-fire on same pair within this window
const ANTI_STACK_DAYS = 2.0;

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface CandlePoint {
  ts: number;
  close: number;
}

interface SpreadEvent {
  pair: string; // "AERO/WETH"
  triggerTs: number;
  spreadPct: number; // log-return spread over lookback at trigger
  direction: "A_over_B" | "B_over_A"; // which side was outperforming
  priceA: number; // close of A at trigger
  priceB: number; // close of B at trigger
}

interface SpreadOutcome extends SpreadEvent {
  // Forward spread reversion: did spread close back by TARGET_REVERSION?
  reverted: boolean;
  spreadAtForward: number; // spread at end of forward window
  reversionPct: number; // how much of the trigger spread reverted
  exitDay: number | null; // days to TARGET_REVERSION hit
}

interface NullOutcome {
  pair: string;
  anchorTs: number;
  anchorSpread: number;
  forwardSpread: number;
  reverted: boolean; // did any |reversion| ≥ TARGET_REVERSION happen in fwd window
}

// ----------------------------------------------------------------------------
// Spread series construction
// ----------------------------------------------------------------------------

/**
 * Compute log-return spread between A and B over a rolling SPREAD_LOOKBACK_DAYS:
 *   spread(t) = log(priceA(t) / priceA(t - lookback)) − log(priceB(t) / priceB(t - lookback))
 * Positive = A outperformed B.
 */
function computeSpreadSeries(
  candlesA: CandlePoint[],
  candlesB: CandlePoint[],
  lookbackHours: number,
): { ts: number; spread: number; pa: number; pb: number }[] {
  const out: { ts: number; spread: number; pa: number; pb: number }[] = [];
  const lookbackSec = lookbackHours * 3600;
  // Index B by ts for fast lookup
  const bMap = new Map(candlesB.map((c) => [c.ts, c.close]));

  for (let i = 0; i < candlesA.length; i++) {
    const aNow = candlesA[i]!;
    const bNow = bMap.get(aNow.ts);
    if (!bNow) continue;
    const targetTs = aNow.ts - lookbackSec;
    // Find A and B at lookback time
    const aThen = candlesA
      .slice(0, i + 1)
      .reverse()
      .find((c) => c.ts <= targetTs);
    if (!aThen) continue;
    const bThen = bMap.get(aThen.ts);
    if (!bThen || aThen.close <= 0 || bNow <= 0 || aNow.close <= 0 || bThen <= 0) continue;
    const lnA = Math.log(aNow.close / aThen.close);
    const lnB = Math.log(bNow / bThen);
    const spread = lnA - lnB;
    out.push({ ts: aNow.ts, spread, pa: aNow.close, pb: bNow });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Event detection
// ----------------------------------------------------------------------------

function detectSpreadEvents(
  pair: string,
  spreadSeries: { ts: number; spread: number; pa: number; pb: number }[],
): SpreadEvent[] {
  const out: SpreadEvent[] = [];
  const antiStackSec = ANTI_STACK_DAYS * 86400;
  let lastTriggerTs = -Infinity;
  for (const s of spreadSeries) {
    if (Math.abs(s.spread) < SPREAD_THRESHOLD) continue;
    if (s.ts - lastTriggerTs < antiStackSec) continue;
    out.push({
      pair,
      triggerTs: s.ts,
      spreadPct: s.spread,
      direction: s.spread > 0 ? "A_over_B" : "B_over_A",
      priceA: s.pa,
      priceB: s.pb,
    });
    lastTriggerTs = s.ts;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Forward measurement
// ----------------------------------------------------------------------------

function measureSpreadOutcome(
  event: SpreadEvent,
  spreadSeries: { ts: number; spread: number }[],
): SpreadOutcome {
  const fwdSec = FORWARD_DAYS * 86400;
  const endTs = event.triggerTs + fwdSec;
  const startIdx = spreadSeries.findIndex((s) => s.ts >= event.triggerTs);
  if (startIdx === -1) {
    return {
      ...event,
      reverted: false,
      spreadAtForward: event.spreadPct,
      reversionPct: 0,
      exitDay: null,
    };
  }

  // We want the spread to MOVE TOWARD ZERO by TARGET_REVERSION
  const triggerSpread = event.spreadPct;
  let exitDay: number | null = null;
  let bestSpread = triggerSpread;

  for (let i = startIdx; i < spreadSeries.length && spreadSeries[i]!.ts <= endTs; i++) {
    const s = spreadSeries[i]!.spread;
    // "Move toward zero by TARGET_REVERSION" means:
    //   if triggerSpread > 0: spread fell by ≥ TARGET_REVERSION (s ≤ triggerSpread − TARGET_REVERSION)
    //   if triggerSpread < 0: spread rose by ≥ TARGET_REVERSION (s ≥ triggerSpread + TARGET_REVERSION)
    if (triggerSpread > 0 && s <= triggerSpread - TARGET_REVERSION) {
      exitDay = (spreadSeries[i]!.ts - event.triggerTs) / 86400;
      break;
    }
    if (triggerSpread < 0 && s >= triggerSpread + TARGET_REVERSION) {
      exitDay = (spreadSeries[i]!.ts - event.triggerTs) / 86400;
      break;
    }
    bestSpread = s;
  }

  const lastSpread = spreadSeries.find((s) => s.ts >= endTs)?.spread ?? bestSpread;
  const reversionPct =
    triggerSpread > 0
      ? Math.max(0, triggerSpread - lastSpread)
      : Math.max(0, lastSpread - triggerSpread);

  return {
    ...event,
    reverted: exitDay !== null,
    spreadAtForward: lastSpread,
    reversionPct,
    exitDay,
  };
}

// ----------------------------------------------------------------------------
// Null sampling — random non-trigger windows in same series
// ----------------------------------------------------------------------------

function sampleNullWindows(
  spreadSeries: { ts: number; spread: number }[],
  triggerTimes: Set<number>,
  n: number,
): { ts: number; spread: number }[] {
  if (spreadSeries.length === 0) return [];
  const fwdSec = FORWARD_DAYS * 86400;
  const antiStackSec = ANTI_STACK_DAYS * 86400;
  const candidates = spreadSeries.filter((s) => {
    if (Math.abs(s.spread) >= SPREAD_THRESHOLD) return false;
    if ([...triggerTimes].some((t) => Math.abs(s.ts - t) < antiStackSec)) return false;
    return true;
  });
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function measureNullOutcome(
  pair: string,
  anchor: { ts: number; spread: number },
  spreadSeries: { ts: number; spread: number }[],
): NullOutcome {
  const fwdSec = FORWARD_DAYS * 86400;
  const endTs = anchor.ts + fwdSec;
  let reverted = false;
  for (const s of spreadSeries) {
    if (s.ts < anchor.ts || s.ts > endTs) continue;
    if (Math.abs(s.spread - anchor.spread) >= TARGET_REVERSION) {
      reverted = true;
      break;
    }
  }
  const lastSpread =
    spreadSeries.find((s) => s.ts >= endTs)?.spread ?? anchor.spread;
  return {
    pair,
    anchorTs: anchor.ts,
    anchorSpread: anchor.spread,
    forwardSpread: lastSpread,
    reverted,
  };
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

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log("=== NVR Pattern P-RotationDetector Retrospective ===");
  console.log(
    `Lookback ${LOOKBACK_HOURS}h, spread-lookback ${SPREAD_LOOKBACK_DAYS}d, ` +
      `threshold ${(SPREAD_THRESHOLD * 100).toFixed(0)}%, forward ${FORWARD_DAYS}d, ` +
      `target reversion ${(TARGET_REVERSION * 100).toFixed(0)}%`,
  );
  console.log(`Pairs: ${PAIRS_INPUT}, null samples ${NULL_SAMPLES}/pair\n`);

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const cacheDir = join(__dirname, "..", "data", "observation-pass", ".price-cache");
  const feed = new GeckoTerminalHistoricalFeed({
    timeframe: "minute",
    aggregate: 15,
    cacheDir,
    cacheMaxAgeSec: 7 * 24 * 3600,
    log: (m) => console.log(`  ${m}`),
  });

  const pairs = PAIRS_INPUT.split(",").map((p) => p.trim().toUpperCase()).filter(Boolean);
  const symbols = Array.from(new Set(pairs.flatMap((p) => p.split("/"))));

  const nowMs = Date.now();
  const toISO = new Date(nowMs).toISOString();
  const fromISO = new Date(nowMs - LOOKBACK_HOURS * 3600 * 1000).toISOString();
  const preload = await feed.preload(symbols, fromISO, toISO);
  console.log(`Preload: ${preload.loaded} loaded, ${preload.failed.length} failed: ${preload.failed.join(",") || "none"}\n`);

  const allEvents: SpreadOutcome[] = [];
  const allNulls: NullOutcome[] = [];

  for (const pair of pairs) {
    const [a, b] = pair.split("/");
    if (!a || !b) continue;
    if (preload.failed.includes(a) || preload.failed.includes(b)) {
      console.log(`  ${pair}: SKIPPED (preload failed for one side)`);
      continue;
    }
    const candA = feed.getCandlesInWindow(a, fromISO, toISO);
    const candB = feed.getCandlesInWindow(b, fromISO, toISO);
    if (candA.length < 100 || candB.length < 100) {
      console.log(`  ${pair}: SKIPPED (insufficient candles A=${candA.length} B=${candB.length})`);
      continue;
    }
    const cpA: CandlePoint[] = candA.map((c) => ({ ts: c.ts, close: c.close }));
    const cpB: CandlePoint[] = candB.map((c) => ({ ts: c.ts, close: c.close }));
    const spreadSeries = computeSpreadSeries(cpA, cpB, SPREAD_LOOKBACK_DAYS * 24);
    if (spreadSeries.length === 0) {
      console.log(`  ${pair}: no spread series (likely time misalignment)`);
      continue;
    }
    const events = detectSpreadEvents(pair, spreadSeries);
    console.log(
      `  ${pair}: ${spreadSeries.length} spread points, ` +
        `${events.length} triggers (|spread| ≥ ${(SPREAD_THRESHOLD * 100).toFixed(0)}%, anti-stack ${ANTI_STACK_DAYS}d)`,
    );

    for (const e of events) {
      allEvents.push(measureSpreadOutcome(e, spreadSeries));
    }

    const triggerTimes = new Set(events.map((e) => e.triggerTs));
    const nullAnchors = sampleNullWindows(spreadSeries, triggerTimes, NULL_SAMPLES);
    for (const a of nullAnchors) {
      allNulls.push(measureNullOutcome(pair, a, spreadSeries));
    }
    console.log(`    null sample: ${nullAnchors.length} non-trigger anchors`);
  }

  // ─── Verdict ─────────────────────────────────────────────────────────────
  const n = allEvents.length;
  const nNull = allNulls.length;
  if (n === 0) {
    console.log("\n[P-RotationDetector] no triggers across all pairs — no signal to evaluate");
    return;
  }
  const reverts = allEvents.filter((e) => e.reverted).length;
  const nullReverts = allNulls.filter((n) => n.reverted).length;
  const hitRate = reverts / n;
  const nullRate = nNull > 0 ? nullReverts / nNull : 0;
  const edge = hitRate - nullRate;

  const reversionPcts = allEvents.map((e) => e.reversionPct);
  const μ = mean(reversionPcts);
  const med = median(reversionPcts);

  const exitDays = allEvents.filter((e) => e.exitDay !== null).map((e) => e.exitDay!);
  const medExitDay = exitDays.length > 0 ? median(exitDays) : null;

  console.log(`\n[P-RotationDetector overall]  n=${n}  (${nNull} nulls)`);
  console.log(
    `  Reversion HIT (≥${(TARGET_REVERSION * 100).toFixed(0)}% spread closure within ${FORWARD_DAYS}d): ${(hitRate * 100).toFixed(1)}%   [target ≥ 40%]`,
  );
  console.log(`  Null reversion rate: ${(nullRate * 100).toFixed(1)}%`);
  console.log(`  EDGE: ${(edge * 100).toFixed(1)}pp   [target ≥ 15pp]`);
  console.log(
    `  Reversion magnitude: μ=${(μ * 100).toFixed(2)}%, median=${(med * 100).toFixed(2)}%`,
  );
  console.log(`  Median time-to-revert: ${medExitDay !== null ? `${medExitDay.toFixed(1)}d` : "—"}`);
  console.log("");

  // Per-pair breakdown
  console.log("Per-pair:");
  for (const pair of pairs) {
    const evs = allEvents.filter((e) => e.pair === pair);
    if (evs.length === 0) {
      console.log(`  ${pair}: n=0`);
      continue;
    }
    const rev = evs.filter((e) => e.reverted).length;
    console.log(
      `  ${pair}: n=${evs.length}  hit=${rev}/${evs.length}=${((rev / evs.length) * 100).toFixed(0)}%  med-revert=${(median(evs.map((e) => e.reversionPct)) * 100).toFixed(2)}%`,
    );
  }

  // Persist
  const outDir = join(__dirname, "..", "data", "observation-pass");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  writeFileSync(
    join(outDir, `${stamp}-rotation-detector-retro.json`),
    JSON.stringify(
      {
        runDate: new Date().toISOString(),
        config: {
          lookbackHours: LOOKBACK_HOURS,
          spreadLookbackDays: SPREAD_LOOKBACK_DAYS,
          spreadThreshold: SPREAD_THRESHOLD,
          forwardDays: FORWARD_DAYS,
          targetReversion: TARGET_REVERSION,
          pairs,
        },
        verdict: { n, hitRate, nullRate, edge },
        events: allEvents,
        nulls: allNulls,
      },
      null,
      2,
    ),
  );
  console.log(`\n✓ Written: ${join(outDir, `${stamp}-rotation-detector-retro.json`)}`);
}

main().catch((e) => {
  console.error("\n[FATAL]", e);
  process.exit(1);
});
