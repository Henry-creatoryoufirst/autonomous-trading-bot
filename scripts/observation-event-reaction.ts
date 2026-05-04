/**
 * NVR-SPEC-022 — Event-reaction retrospective: P-FadeMove + P-MomentumContinuation
 *
 * Two pattern hypotheses tested in one pass against the same 14-day OHLCV
 * data. Both fire on detected ≥5% moves in 1h windows; they differ in
 * directional bet:
 *
 *   P-MomentumContinuation: trigger on UP move ≥5% → target +3% MORE within 3h
 *   P-FadeMove:             trigger on DOWN move ≥5% → target +3% bounce within 3h
 *
 * Both are long-only spot strategies (buy-and-exit, no shorting).
 * Same trigger detection, same forward measurement window, opposite
 * predictions. Running them together is the cleanest A/B test of
 * "does momentum or mean-reversion dominate at this horizon for these
 * tokens?"
 *
 * Volume-null comparison (Lesson 1, FINDING_2026-05-04):
 *   For each token, sample N high-activity windows that did NOT contain
 *   a ≥5% move. Measure forward 3h. The pattern only has edge if
 *   trigger-hit-rate exceeds null-hit-rate by a meaningful margin.
 *
 * Distribution stats (Lesson 2):
 *   Report μ, σ, skew of forward returns. Tight Gaussian = no signal,
 *   right-skew = continuation edge, fat tails = volatility regime
 *   (which fade can exploit).
 *
 * Run:
 *   npx tsx scripts/observation-event-reaction.ts
 *
 * Environment:
 *   EVENT_LOOKBACK_HOURS    default 336 (14d)
 *   EVENT_MOVE_THRESHOLD    default 0.05 (5% trigger)
 *   EVENT_FORWARD_HOURS     default 3.0
 *   EVENT_TARGET_PCT        default 0.03 (+3% hit)
 *   EVENT_STOP_PCT          default 0.03 (-3% stop, symmetric)
 *   EVENT_TOKENS            default AERO,BRETT,DEGEN
 *   EVENT_NULL_SAMPLES      default 50 (high-activity-no-move per token)
 */

import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { GeckoTerminalHistoricalFeed } from "../src/simulation/data/price-feed.js";

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

const LOOKBACK_HOURS = parseInt(
  process.env["EVENT_LOOKBACK_HOURS"] ?? "336",
  10,
);
const MOVE_THRESHOLD = parseFloat(
  process.env["EVENT_MOVE_THRESHOLD"] ?? "0.05",
);
const FORWARD_HOURS = parseFloat(process.env["EVENT_FORWARD_HOURS"] ?? "3.0");
const TARGET_PCT = parseFloat(process.env["EVENT_TARGET_PCT"] ?? "0.03");
const STOP_PCT = parseFloat(process.env["EVENT_STOP_PCT"] ?? "0.03");
const NULL_SAMPLES = parseInt(process.env["EVENT_NULL_SAMPLES"] ?? "50", 10);
const TOKEN_FILTER = (process.env["EVENT_TOKENS"] ?? "AERO,BRETT,DEGEN")
  .split(",")
  .map((t) => t.trim().toUpperCase())
  .filter(Boolean);

// Anti-stack guard (don't double-fire on the same token within window)
// 1h matches the move-detection window used by the original 04-29 observation
// pass (which found 32 events across AERO/BRETT/DEGEN at this threshold).
const ANTI_STACK_HOURS = 1.0;

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface CandlePoint {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
}

interface DetectedEvent {
  symbol: string;
  triggerTs: number;
  direction: "up" | "down";
  triggerPrice: number; // close at trigger time
  rolling1hMovePct: number;
  rolling1hVolumeUsd: number;
}

interface MeasuredOutcome extends DetectedEvent {
  // Continuation = same direction (up→target=+target, down→target=-target)
  continuationHit: boolean; // hit the target in the same direction first
  continuationStop: boolean; // hit the stop in the opposite direction first
  continuationFwdPct: number; // signed forward return at end-of-window or first exit
  continuationExitMin: number | null; // minutes to exit
  // Fade = opposite direction (up→target=-target, down→target=+target)
  fadeHit: boolean;
  fadeStop: boolean;
  fadeFwdPct: number;
  fadeExitMin: number | null;
  // Diagnostic: max excursion in either direction during the forward window
  maxFwdHigh: number; // highest pct change reached
  maxFwdLow: number; // lowest pct change reached
}

interface NullOutcome {
  symbol: string;
  anchorTs: number;
  anchorPrice: number;
  rolling1hVolumeUsd: number;
  // Same continuation/fade math but anchored on a non-move (we just measure
  // forward returns relative to anchor close)
  fadeHit: boolean; // up-bounce ≥ +TARGET within window
  continuationHit: boolean; // down-drop ≥ -TARGET within window? (proxy null)
  maxFwdHigh: number;
  maxFwdLow: number;
}

// ----------------------------------------------------------------------------
// Move detection (matches observation-pass-base.ts)
// ----------------------------------------------------------------------------

function detectEvents(symbol: string, candles: CandlePoint[]): DetectedEvent[] {
  // Matches the 04-29 observation pass's methodology — high/low spread within
  // a rolling 1h window, with directional inference based on which extreme
  // came later. Catches both sharp spikes and sustained moves.
  if (candles.length < 4) return [];
  const ROLLING = 4; // 4 × 15min = 1h
  const out: DetectedEvent[] = [];
  const antiStackSec = ANTI_STACK_HOURS * 3600;
  let lastTriggerTs = -Infinity;

  for (let i = ROLLING - 1; i < candles.length; i++) {
    const ts = candles[i]!.ts;
    if (ts - lastTriggerTs < antiStackSec) continue;

    // Rolling 1h high/low spread
    let lo = Infinity;
    let hi = -Infinity;
    let loIdx = i;
    let hiIdx = i;
    let vol = 0;
    for (let j = i - ROLLING + 1; j <= i; j++) {
      const c = candles[j]!;
      if (c.low < lo) {
        lo = c.low;
        loIdx = j;
      }
      if (c.high > hi) {
        hi = c.high;
        hiIdx = j;
      }
      vol += c.volumeUsd;
    }
    if (lo === Infinity || hi === -Infinity || lo <= 0) continue;
    const spread = (hi - lo) / lo;
    if (spread < MOVE_THRESHOLD) continue;

    // Direction = whichever extreme came LATER
    const direction: "up" | "down" = hiIdx >= loIdx ? "up" : "down";
    const movePct = direction === "up" ? spread : -spread;

    out.push({
      symbol,
      triggerTs: ts,
      direction,
      triggerPrice: candles[i]!.close,
      rolling1hMovePct: movePct,
      rolling1hVolumeUsd: vol,
    });
    lastTriggerTs = ts;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Forward outcome measurement
// ----------------------------------------------------------------------------

function measureOutcome(
  event: DetectedEvent,
  candles: CandlePoint[],
): MeasuredOutcome {
  const fwdSec = FORWARD_HOURS * 3600;
  const startTs = event.triggerTs;
  const endTs = startTs + fwdSec;
  const startIdx = candles.findIndex((c) => c.ts >= startTs);
  if (startIdx === -1) {
    return {
      ...event,
      continuationHit: false,
      continuationStop: false,
      continuationFwdPct: 0,
      continuationExitMin: null,
      fadeHit: false,
      fadeStop: false,
      fadeFwdPct: 0,
      fadeExitMin: null,
      maxFwdHigh: 0,
      maxFwdLow: 0,
    };
  }

  const triggerPx = event.triggerPrice;
  // Determine targets:
  //   continuation = same direction
  //   fade = opposite direction
  const continuationTargetPct = event.direction === "up" ? TARGET_PCT : -TARGET_PCT;
  const continuationStopPct = event.direction === "up" ? -STOP_PCT : STOP_PCT;
  const fadeTargetPct = event.direction === "up" ? -TARGET_PCT : TARGET_PCT;
  const fadeStopPct = event.direction === "up" ? STOP_PCT : -STOP_PCT;

  let continuationHit = false;
  let continuationStop = false;
  let continuationFwdPct = 0;
  let continuationExitMin: number | null = null;
  let fadeHit = false;
  let fadeStop = false;
  let fadeFwdPct = 0;
  let fadeExitMin: number | null = null;

  let maxFwdHigh = 0;
  let maxFwdLow = 0;

  for (let i = startIdx; i < candles.length && candles[i]!.ts <= endTs; i++) {
    const c = candles[i]!;
    const minPct = (c.low - triggerPx) / triggerPx;
    const maxPct = (c.high - triggerPx) / triggerPx;
    const closePct = (c.close - triggerPx) / triggerPx;
    if (maxPct > maxFwdHigh) maxFwdHigh = maxPct;
    if (minPct < maxFwdLow) maxFwdLow = minPct;
    const elapsedMin = (c.ts - startTs) / 60;

    // Continuation pattern
    if (continuationExitMin === null) {
      if (event.direction === "up") {
        if (maxPct >= continuationTargetPct) {
          continuationHit = true;
          continuationFwdPct = continuationTargetPct;
          continuationExitMin = elapsedMin;
        } else if (minPct <= continuationStopPct) {
          continuationStop = true;
          continuationFwdPct = continuationStopPct;
          continuationExitMin = elapsedMin;
        }
      } else {
        if (minPct <= continuationTargetPct) {
          continuationHit = true;
          continuationFwdPct = continuationTargetPct;
          continuationExitMin = elapsedMin;
        } else if (maxPct >= continuationStopPct) {
          continuationStop = true;
          continuationFwdPct = continuationStopPct;
          continuationExitMin = elapsedMin;
        }
      }
    }

    // Fade pattern (opposite direction)
    if (fadeExitMin === null) {
      if (event.direction === "up") {
        // fade UP move = bet on -3% (sell into spike, conceptually)
        if (minPct <= fadeTargetPct) {
          fadeHit = true;
          fadeFwdPct = fadeTargetPct;
          fadeExitMin = elapsedMin;
        } else if (maxPct >= fadeStopPct) {
          fadeStop = true;
          fadeFwdPct = fadeStopPct;
          fadeExitMin = elapsedMin;
        }
      } else {
        // fade DOWN move = bet on +3% bounce
        if (maxPct >= fadeTargetPct) {
          fadeHit = true;
          fadeFwdPct = fadeTargetPct;
          fadeExitMin = elapsedMin;
        } else if (minPct <= fadeStopPct) {
          fadeStop = true;
          fadeFwdPct = fadeStopPct;
          fadeExitMin = elapsedMin;
        }
      }
    }

    if (continuationExitMin !== null && fadeExitMin !== null) {
      // both resolved; we still track max/min through end of window for diagnostics
    }

    // Update unresolved tally with closing pct (time-stop)
    if (continuationExitMin === null) continuationFwdPct = closePct;
    if (fadeExitMin === null) fadeFwdPct = closePct;
  }

  return {
    ...event,
    continuationHit,
    continuationStop,
    continuationFwdPct,
    continuationExitMin,
    fadeHit,
    fadeStop,
    fadeFwdPct,
    fadeExitMin,
    maxFwdHigh,
    maxFwdLow,
  };
}

// ----------------------------------------------------------------------------
// Volume-null sampling (high-activity, no-move windows)
// ----------------------------------------------------------------------------

function findHighActivityNoMoveAnchors(
  candles: CandlePoint[],
  quartileThreshold: number = 0.75,
): number[] {
  if (candles.length < 8) return [];
  const ROLLING = 4;

  // Compute rolling-1h volume per anchor candle
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

  // For each high-vol anchor, check the prior 1h had NO ≥MOVE_THRESHOLD move
  const anchors: number[] = [];
  for (const rv of rollingVol) {
    if (rv.vol < volThresh) continue;

    const closeNow = candles[rv.idx]!.close;
    const closeAgo = candles[rv.idx - ROLLING + 1]!.close;
    if (closeAgo <= 0) continue;
    const priorMove = Math.abs((closeNow - closeAgo) / closeAgo);
    if (priorMove >= MOVE_THRESHOLD) continue; // not a non-move window

    anchors.push(rv.ts);
  }
  return anchors;
}

function sampleN<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return [...arr];
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function measureNullOutcome(
  symbol: string,
  anchorTs: number,
  candles: CandlePoint[],
): NullOutcome | null {
  const anchorIdx = candles.findIndex((c) => c.ts === anchorTs);
  if (anchorIdx === -1) return null;
  const anchorPx = candles[anchorIdx]!.close;
  if (anchorPx <= 0) return null;

  const fwdSec = FORWARD_HOURS * 3600;
  const endTs = anchorTs + fwdSec;
  let maxFwdHigh = 0;
  let maxFwdLow = 0;
  let bounceTo3 = false; // ≥ +3%
  let dropTo3 = false; // ≤ −3%
  for (let i = anchorIdx + 1; i < candles.length && candles[i]!.ts <= endTs; i++) {
    const c = candles[i]!;
    const maxPct = (c.high - anchorPx) / anchorPx;
    const minPct = (c.low - anchorPx) / anchorPx;
    if (maxPct > maxFwdHigh) maxFwdHigh = maxPct;
    if (minPct < maxFwdLow) maxFwdLow = minPct;
    if (maxPct >= TARGET_PCT) bounceTo3 = true;
    if (minPct <= -TARGET_PCT) dropTo3 = true;
  }

  // Compute rolling 1h volume at anchor
  let rollingVol = 0;
  for (let j = Math.max(0, anchorIdx - 3); j <= anchorIdx; j++) {
    rollingVol += candles[j]!.volumeUsd;
  }

  return {
    symbol,
    anchorTs,
    anchorPrice: anchorPx,
    rolling1hVolumeUsd: rollingVol,
    fadeHit: bounceTo3, // proxy: did a +3% bounce occur within window
    continuationHit: dropTo3, // proxy: did a -3% drop occur within window
    maxFwdHigh,
    maxFwdLow,
  };
}

// ----------------------------------------------------------------------------
// Stats helpers
// ----------------------------------------------------------------------------

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}
function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log("=== NVR Event-Reaction Retrospective ===");
  console.log(
    `Lookback ${LOOKBACK_HOURS}h, move threshold ${(MOVE_THRESHOLD * 100).toFixed(0)}%, ` +
      `forward ${FORWARD_HOURS}h, target ±${(TARGET_PCT * 100).toFixed(0)}%, ` +
      `stop ±${(STOP_PCT * 100).toFixed(0)}%`,
  );
  console.log(
    `Tokens: ${TOKEN_FILTER.join(", ")}, anti-stack ${ANTI_STACK_HOURS}h, null samples ${NULL_SAMPLES}/token`,
  );
  console.log("");

  // Preload OHLCV (use 1-min so we get cleaner intra-window resolution)
  const feed = new GeckoTerminalHistoricalFeed({
    timeframe: "minute",
    aggregate: 15,
    log: (m) => console.log(`  ${m}`),
  });
  const nowMs = Date.now();
  const toISO = new Date(nowMs).toISOString();
  const fromISO = new Date(nowMs - LOOKBACK_HOURS * 3600 * 1000).toISOString();
  const preload = await feed.preload(TOKEN_FILTER, fromISO, toISO);
  console.log(`Preload: ${preload.loaded} loaded, ${preload.failed.length} failed: ${preload.failed.join(",") || "none"}\n`);

  const allEvents: MeasuredOutcome[] = [];
  const allNullOutcomes: NullOutcome[] = [];

  for (const sym of TOKEN_FILTER) {
    if (preload.failed.includes(sym)) {
      console.log(`  ${sym}: SKIPPED (preload failed)`);
      continue;
    }
    const candles = feed.getCandlesInWindow(sym, fromISO, toISO);
    const cps: CandlePoint[] = candles.map((c) => ({
      ts: c.ts,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volumeUsd: c.volumeUsd,
    }));
    if (cps.length < 8) {
      console.log(`  ${sym}: SKIPPED (only ${cps.length} candles)`);
      continue;
    }

    const events = detectEvents(sym, cps);
    const ups = events.filter((e) => e.direction === "up").length;
    const downs = events.length - ups;
    console.log(`  ${sym}: ${cps.length} candles → ${events.length} triggers (${ups} up, ${downs} down)`);

    for (const e of events) {
      allEvents.push(measureOutcome(e, cps));
    }

    const anchors = findHighActivityNoMoveAnchors(cps);
    const sampled = sampleN(anchors, NULL_SAMPLES);
    let nullCount = 0;
    for (const a of sampled) {
      const nu = measureNullOutcome(sym, a, cps);
      if (nu) {
        allNullOutcomes.push(nu);
        nullCount++;
      }
    }
    console.log(`    null sampling: ${anchors.length} qualifying anchors → ${nullCount} measured`);
  }

  console.log("");

  // ─── Pattern verdicts ───────────────────────────────────────────────────

  function verdictFor(
    label: string,
    triggers: MeasuredOutcome[],
    nulls: NullOutcome[],
    pickHit: (m: MeasuredOutcome) => boolean,
    pickStop: (m: MeasuredOutcome) => boolean,
    pickFwdPct: (m: MeasuredOutcome) => number,
    pickNullHit: (n: NullOutcome) => boolean,
  ) {
    const n = triggers.length;
    if (n === 0) {
      console.log(`\n[${label}] no triggers`);
      return;
    }
    const hits = triggers.filter(pickHit).length;
    const stops = triggers.filter(pickStop).length;
    const timeouts = n - hits - stops;
    const fwdPcts = triggers.map(pickFwdPct);
    const μ = mean(fwdPcts);
    const med = median(fwdPcts);
    const σ = stdev(fwdPcts);
    const skew = σ > 0 ? (μ - med) / σ : 0;

    const hitRate = hits / n;
    const stopRate = stops / n;

    const nullN = nulls.length;
    const nullHits = nulls.filter(pickNullHit).length;
    const nullHitRate = nullN > 0 ? nullHits / nullN : 0;
    const edge = hitRate - nullHitRate;

    console.log(`\n[${label}]  n=${n}`);
    console.log(`  HIT rate (target ≥ +${(TARGET_PCT * 100).toFixed(0)}% in ${FORWARD_HOURS}h): ${(hitRate * 100).toFixed(1)}%   [target ≥ 40%]`);
    console.log(`  STOP rate (-${(STOP_PCT * 100).toFixed(0)}% before target): ${(stopRate * 100).toFixed(1)}%`);
    console.log(`  Time-stop:  ${((timeouts / n) * 100).toFixed(1)}%`);
    console.log(`  Forward-return distribution:  μ=${(μ * 100).toFixed(2)}%  median=${(med * 100).toFixed(2)}%  σ=${(σ * 100).toFixed(2)}%  skew=${skew.toFixed(2)}`);
    console.log(`  Volume-null comparison:  null-hit-rate=${(nullHitRate * 100).toFixed(1)}% (n=${nullN})  →  EDGE = ${(edge * 100).toFixed(1)}pp`);

    // Verdict gates
    const gateHit = hitRate >= 0.4;
    const gateNull = edge >= 0.15;
    const gateShape = !(Math.abs(μ) < σ * 0.2 && σ < 0.015);
    const gateSample = n >= 30;
    const allPass = gateHit && gateNull && gateShape && gateSample;
    console.log(`  Gates: hit≥40%${gateHit?" ✓":" ✗"} | edge≥15pp${gateNull?" ✓":" ✗"} | not-tight-Gaussian${gateShape?" ✓":" ✗"} | n≥30${gateSample?" ✓":" ✗"}  →  ${allPass ? "PASS — deploy forward harness" : "FAIL — KILL or retest with adjusted thresholds"}`);

    return { label, n, hitRate, stopRate, μ, med, σ, skew, nullHitRate, edge, allPass };
  }

  const verdicts: any[] = [];

  // P-FadeMove on DOWN moves only (long-only buy after drop)
  const downEvents = allEvents.filter((e) => e.direction === "down");
  const fadeVerdict = verdictFor(
    "P-FadeMove (buy DOWN moves, target +3% bounce in 3h)",
    downEvents,
    allNullOutcomes,
    (m) => m.fadeHit,
    (m) => m.fadeStop,
    (m) => m.fadeFwdPct,
    (n) => n.fadeHit,
  );
  if (fadeVerdict) verdicts.push(fadeVerdict);

  // P-MomentumContinuation on UP moves only (long-only buy after up move)
  const upEvents = allEvents.filter((e) => e.direction === "up");
  const momVerdict = verdictFor(
    "P-MomentumContinuation (buy UP moves, target +3% more in 3h)",
    upEvents,
    allNullOutcomes,
    (m) => m.continuationHit,
    (m) => m.continuationStop,
    (m) => m.continuationFwdPct,
    (n) => n.fadeHit, // for UP-direction, "hit" means a +3% bounce, same as fadeHit on null
  );
  if (momVerdict) verdicts.push(momVerdict);

  // Persist
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outDir = join(__dirname, "..", "data", "observation-pass");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);

  writeFileSync(
    join(outDir, `${stamp}-event-reaction-retro.json`),
    JSON.stringify(
      {
        runDate: new Date().toISOString(),
        config: {
          lookbackHours: LOOKBACK_HOURS,
          moveThreshold: MOVE_THRESHOLD,
          forwardHours: FORWARD_HOURS,
          targetPct: TARGET_PCT,
          stopPct: STOP_PCT,
          antiStackHours: ANTI_STACK_HOURS,
          tokens: TOKEN_FILTER,
        },
        verdicts,
        allEvents,
        allNullOutcomes,
      },
      null,
      2,
    ),
  );
  console.log(`\n✓ Written: ${join(outDir, `${stamp}-event-reaction-retro.json`)}`);
}

main().catch((e) => {
  console.error("\n[FATAL]", e);
  process.exit(1);
});
