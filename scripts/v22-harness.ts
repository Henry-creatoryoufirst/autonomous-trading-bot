/**
 * NVR-SPEC-024 — v22 Pattern Runtime Harness (Step 3, proof-of-wiring)
 *
 * Drives the v22 PatternRuntime with a single tick (or N ticks) so we can
 * verify the full stack — runtime + registry + post-volatility-long pattern
 * + cross-asset state + askAI conviction layer + paper executeFn — operates
 * end-to-end. This is the bridge between Steps 1-4 (modules) and a
 * Railway-deployed continuous daemon (next session).
 *
 * Modes:
 *   default        — Single tick. Builds a snapshot from cached candles,
 *                    calls runtime.tick() once, prints the TickReport,
 *                    exits 0. Should print "0 triggers" because real
 *                    cached candles are at 15-min granularity (cache
 *                    cadence ≠ pattern cadence; 60 candles ≈ 15 hours,
 *                    no 5% move expected at that flat window).
 *
 *   --stimulate    — Same setup, but synthesize a 5%+ move into the
 *                    candle ring before ticking. PROVES the detect()
 *                    fires + confirm() reaches askAI + enter() + paper
 *                    executeFn round-trip. Without ANTHROPIC_API_KEY +
 *                    GROQ_API_KEY, confirm() will veto (null) — so
 *                    `triggersDetected ≥ 1` but `entered = 0`. With keys
 *                    set, expect entered ≥ 0 depending on conviction.
 *
 *   --iterations N — Loop N ticks (1s sleep between each). Mostly useful
 *                    with --stimulate to test exit logic.
 *
 * Usage:
 *   npx tsx scripts/v22-harness.ts                       # one tick, no stimulus
 *   npx tsx scripts/v22-harness.ts --stimulate           # one tick, force a trigger
 *   npx tsx scripts/v22-harness.ts --stimulate --iterations 5
 *
 * Status: PROOF-OF-WIRING. NOT a Railway daemon. Doesn't poll prices in
 * real time. Doesn't persist pattern state across runs. Those are next-
 * session deliverables.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";

import { PatternRuntime } from "../src/core/patterns/runtime.js";
import { PatternRegistry } from "../src/core/patterns/registry.js";
import {
  createDefaultRuntimeDeps,
  registerPostVolatilityLong,
} from "../src/core/patterns/runtime-deps.js";
import { computeMacroRegime } from "../src/algorithm/macro-regime.js";
import type { TokenState } from "../src/core/patterns/cross-asset-state.js";
import type { MarketSnapshot } from "../src/core/patterns/types.js";

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

const TOKENS = ["AERO", "BRETT", "DEGEN"] as const;
const PRICE_CACHE_DIR = "data/observation-pass/.price-cache";

// ROLLING_WINDOW_MIN constant from post-volatility-long.ts. We need
// 60 + 1 candles in the ring for detect() to even consider firing.
const RING_SIZE = 65;

// ----------------------------------------------------------------------------
// Args
// ----------------------------------------------------------------------------

interface HarnessArgs {
  stimulate: boolean;
  iterations: number;
  daemon: boolean;
  /** Daemon-mode tick cadence in seconds. Default 60 (matches the
   *  pattern's tickIntervalMs). */
  tickSec: number;
}

function parseArgs(argv: readonly string[]): HarnessArgs {
  let stimulate = false;
  let iterations = 1;
  let daemon = false;
  let tickSec = 60;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stimulate") stimulate = true;
    else if (a === "--daemon") daemon = true;
    else if (a === "--iterations") {
      const next = argv[i + 1];
      if (next) {
        const n = parseInt(next, 10);
        if (Number.isFinite(n) && n > 0) iterations = n;
      }
      i++;
    } else if (a === "--tick-sec") {
      const next = argv[i + 1];
      if (next) {
        const n = parseInt(next, 10);
        if (Number.isFinite(n) && n > 0) tickSec = n;
      }
      i++;
    }
  }
  // Daemon mode runs indefinitely; iterations only used in non-daemon.
  return { stimulate, iterations, daemon, tickSec };
}

// ----------------------------------------------------------------------------
// Telemetry — append-only JSONL log + periodic state snapshot
//
// JSONL log: one JSON object per tick at data/v22-harness/ticks.jsonl.
// Every line is self-describing: timestamp, triggers, judged, entered,
// exited, openCount, closedCount, errors. Designed to be tail-able by
// the cockpit's /admin Discovery tab and by any "Pattern Pulse"
// follow-up routine.
//
// State snapshot: every SNAPSHOT_INTERVAL_SEC, the harness writes the
// in-memory pattern state map + open-position list to data/v22-harness/
// state.json. This is the durability boundary — if the harness crashes
// and restarts within the snapshot interval, recent state survives.
// ----------------------------------------------------------------------------

const TELEMETRY_DIR = "data/v22-harness";
const TICKS_LOG = "ticks.jsonl";
const STATE_SNAPSHOT = "state.json";
const SNAPSHOT_INTERVAL_SEC = 5 * 60;

interface TickRecord {
  timestamp: string;
  triggersDetected: number;
  convictionsAccepted: number;
  entered: number;
  exited: number;
  openCount: number;
  closedCount: number;
  detectErrors: { patternName: string; error: string }[];
  perTokenLatest: Record<string, number>;
  macroRegime: { regime: string; score: number } | null;
}

class HarnessTelemetry {
  private readonly logPath: string;
  private readonly statePath: string;
  private lastSnapshotTs = 0;

  constructor(repoRoot: string) {
    const dir = join(repoRoot, TELEMETRY_DIR);
    mkdirSync(dir, { recursive: true });
    this.logPath = join(dir, TICKS_LOG);
    this.statePath = join(dir, STATE_SNAPSHOT);
  }

  appendTick(record: TickRecord): void {
    appendFileSync(this.logPath, JSON.stringify(record) + "\n");
  }

  /** Periodic state snapshot. Caller passes the patternStates map +
   *  open-position list. Atomic-write via temp file is overkill here —
   *  worst case a crash mid-write loses the latest snapshot, and the
   *  ticks.jsonl is the source of truth for outcome tracking. */
  maybeSnapshotState(opts: {
    patternStates: ReadonlyMap<string, unknown>;
    openPositions: readonly unknown[];
    now: number;
  }): boolean {
    if (opts.now - this.lastSnapshotTs < SNAPSHOT_INTERVAL_SEC * 1000) {
      return false;
    }
    const payload = {
      snapshotAt: new Date(opts.now).toISOString(),
      patternStates: Object.fromEntries(opts.patternStates.entries()),
      openPositions: opts.openPositions,
    };
    writeFileSync(this.statePath, JSON.stringify(payload, null, 2));
    this.lastSnapshotTs = opts.now;
    return true;
  }
}

// ----------------------------------------------------------------------------
// Read cached candles for a token. Returns the most-recent close + a ring
// of pseudo-1-min closes synthesized by carrying the value forward.
// Real 1-min granularity is a follow-up; for proof-of-wiring this is fine.
// ----------------------------------------------------------------------------

interface CachedCandle {
  ts: number;
  close: number;
}

function loadCachedCandles(symbol: string, repoRoot: string): readonly CachedCandle[] | null {
  const path = join(
    repoRoot,
    PRICE_CACHE_DIR,
    `candles-base-minute-15-${symbol}.json`,
  );
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as {
      cachedAt: number;
      candles: Array<{ ts: number; close: number }>;
    };
    if (!Array.isArray(raw.candles)) return null;
    return raw.candles.map((c) => ({ ts: c.ts, close: c.close }));
  } catch {
    return null;
  }
}

function buildPseudoMinuteRing(latestClose: number, count: number): number[] {
  // Repeat the latest close `count` times. Real 1-min stream is a TODO —
  // for proof-of-wiring this gives detect() a non-empty ring without
  // accidentally tripping the 5% threshold (all values equal → 0% move).
  return new Array(count).fill(latestClose);
}

function applyStimulus(ring: readonly number[]): number[] {
  // Inject a +6% move at the END of the ring. detect() reads the
  // most-recent close vs the 60th-back close — making the most recent
  // 6% above the rest forces a trigger.
  if (ring.length === 0) return [];
  const out = [...ring];
  const base = out[0]!;
  out[out.length - 1] = base * 1.06;
  return out;
}

// ----------------------------------------------------------------------------
// Build a CrossAssetState-bearing MarketSnapshot
// ----------------------------------------------------------------------------

interface SnapshotBuildResult {
  snapshot: MarketSnapshot;
  perTokenLatest: Record<string, number>;
  notes: string[];
}

async function buildSnapshot(
  bundle: ReturnType<typeof createDefaultRuntimeDeps>,
  args: HarnessArgs,
  repoRoot: string,
): Promise<SnapshotBuildResult> {
  const tokens: Record<string, TokenState> = {};
  const perTokenLatest: Record<string, number> = {};
  const notes: string[] = [];

  for (const symbol of TOKENS) {
    const candles = loadCachedCandles(symbol, repoRoot);
    if (!candles || candles.length === 0) {
      notes.push(`${symbol}: no cached candles — skipped`);
      continue;
    }
    const latest = candles[candles.length - 1]!;
    let ring = buildPseudoMinuteRing(latest.close, RING_SIZE);
    if (args.stimulate) ring = applyStimulus(ring);

    tokens[symbol] = {
      symbol,
      candles: ring,
      recentDirectionalEdge: { fadeHit: 0.36, continueHit: 0.37 },
      // Realized vol from the cache: rough 24h window using the last 96
      // 15-min closes. Annualize with sqrt(365 * 24 * 4).
      realizedVol24h: estimateRealizedVol24h(candles),
    };
    perTokenLatest[symbol] = latest.close;
    notes.push(
      `${symbol}: latest close ${latest.close.toFixed(6)}` +
        (args.stimulate ? " (stimulus +6% applied to ring tail)" : ""),
    );
  }

  // Compute macro regime from the BTC candle series if available; else
  // fall back to a neutral RANGING regime. computeMacroRegime needs 50+
  // closes minimum, ideally 140 for SMA140.
  const btcSeries = loadCachedCandles("WETH", repoRoot)?.map((c) => c.close);
  // ^ NOTE: post-EVE-fix, "WETH" cache is real WETH/USDC. Using WETH as
  // a stand-in for BTC for the regime check — both blue chips, regime
  // reads similarly. Real BTC integration is a follow-up.
  const macroRegime = btcSeries
    ? computeMacroRegime(btcSeries)
    : computeMacroRegime([3000, 3010, 3020]); // degenerate fallback

  // Recent edge stats from the runtime tracker — empty on first tick.
  const closed: ReturnType<
    typeof bundle.deps.alphaSleeveUsd
  > extends never
    ? never[]
    : never[] = [];
  void closed; // tracker is on the runtime, not the bundle; stats default to zeros
  const recentEdge = { count: 0, hitRate: 0, meanReturn: 0, stdReturn: 0 };

  const cas = await bundle.buildState({
    tokens,
    macroRegime,
    recentEdge,
    signalServiceUrl: process.env["SIGNAL_SERVICE_URL"],
  });

  const snapshot: MarketSnapshot = {
    timestamp: new Date().toISOString(),
    prices: new Map(Object.entries(perTokenLatest)),
    extras: { crossAsset: cas },
  };

  return { snapshot, perTokenLatest, notes };
}

function estimateRealizedVol24h(
  candles: readonly { ts: number; close: number }[],
): number {
  if (candles.length < 4) return 0;
  // Last 96 closes for 24h on 15-min cadence; clamp to what's available.
  const window = candles.slice(-96);
  const returns: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const a = window[i - 1]!.close;
    const b = window[i]!.close;
    if (a > 0) returns.push(Math.log(b / a));
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
  const variance =
    returns.reduce((s, x) => s + (x - mean) ** 2, 0) / (returns.length - 1);
  const stdPerStep = Math.sqrt(variance);
  // Annualize: 365 days × 96 fifteen-min steps/day. As a percentage.
  const annualized = stdPerStep * Math.sqrt(365 * 96) * 100;
  return Number.isFinite(annualized) ? annualized : 0;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(__dirname, "..");

  // Pattern requires the env-var gate AND a status of "paper" or "live"
  // in the registry to fire. Set the gate here so the proof-of-wiring
  // run actually exercises detect().
  process.env["POST_VOL_LONG_PATTERN_ENABLED"] = "true";

  console.log("=== NVR v22 Harness ===");
  if (args.daemon) {
    console.log(
      `Mode: DAEMON (continuous, ${args.tickSec}s tick), ` +
        `${args.stimulate ? "STIMULATE forced triggers" : "passive"}`,
    );
  } else {
    console.log(
      `Mode: ${args.stimulate ? "STIMULATE (forced trigger)" : "passive (no stimulus)"}, ` +
        `iterations: ${args.iterations}`,
    );
  }

  // Wire deps + registry
  const anthropic = process.env["ANTHROPIC_API_KEY"]
    ? new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] })
    : undefined;
  if (!anthropic) {
    console.log(
      "  ANTHROPIC_API_KEY not set — askAI heavy-tier disabled. " +
        "Cheap-tier (Groq) will be tried first; if also unavailable, confirm() vetoes (returns null).",
    );
  }

  const bundle = createDefaultRuntimeDeps({
    anthropic,
    sleeveUsd: 1000,
    log: (m) => console.log(`  ${m}`),
  });

  const registry = new PatternRegistry();
  registerPostVolatilityLong(registry, "paper"); // runtime mode = "paper" → these fire

  const runtime = new PatternRuntime(registry, bundle.deps, "paper");

  console.log("");
  console.log(`Registered ${registry.byStatus("paper").length} patterns at status=paper`);
  console.log(`Sleeve USD: $${bundle.deps.alphaSleeveUsd()}`);

  const telemetry = new HarnessTelemetry(repoRoot);
  console.log(`Telemetry: ${join(repoRoot, TELEMETRY_DIR)}/{${TICKS_LOG},${STATE_SNAPSHOT}}`);

  // Graceful shutdown for daemon mode
  let stopped = false;
  if (args.daemon) {
    const shutdown = (signal: string) => {
      if (stopped) return;
      stopped = true;
      console.log(`\n[${signal}] daemon stopping; flushing final state snapshot…`);
      try {
        telemetry.maybeSnapshotState({
          patternStates: bundle.patternStates(),
          openPositions: runtime.tracker.openPositions(),
          now: Date.now() + SNAPSHOT_INTERVAL_SEC * 1000 + 1, // force write
        });
      } catch (e) {
        console.error("Final snapshot failed:", (e as Error).message);
      }
      process.exit(0);
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  }

  // Tick loop
  const totalIters = args.daemon ? Number.POSITIVE_INFINITY : args.iterations;
  for (let i = 1; i <= totalIters; i++) {
    if (stopped) break;
    await runOneTick({
      i,
      totalIters,
      args,
      bundle,
      runtime,
      repoRoot,
      telemetry,
    });

    if (args.daemon) {
      // Sleep until next tick. Don't block the process exit handler.
      await new Promise((r) => setTimeout(r, args.tickSec * 1000));
    } else if (args.iterations > 1 && i < args.iterations) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log("");
  console.log("=== End ===");
}

interface RunOneTickOpts {
  i: number;
  totalIters: number;
  args: HarnessArgs;
  bundle: ReturnType<typeof createDefaultRuntimeDeps>;
  runtime: PatternRuntime;
  repoRoot: string;
  telemetry: HarnessTelemetry;
}

async function runOneTick(opts: RunOneTickOpts): Promise<void> {
  const { i, totalIters, args, bundle, runtime, repoRoot, telemetry } = opts;
  const { snapshot, perTokenLatest, notes } = await buildSnapshot(
    bundle,
    args,
    repoRoot,
  );

  console.log("");
  const itrLabel = totalIters === Number.POSITIVE_INFINITY ? `${i}` : `${i}/${totalIters}`;
  console.log(`--- Tick ${itrLabel} (${snapshot.timestamp}) ---`);
  for (const n of notes) console.log(`  ${n}`);
  console.log(
    `  Tokens with prices: ${Array.from(snapshot.prices.keys()).join(", ")}`,
  );

  const cas = (snapshot.extras as { crossAsset?: { macroRegime: { regime: string; score: number } } } | undefined)?.crossAsset;
  if (cas) {
    console.log(
      `  Macro regime: ${cas.macroRegime.regime} (score ${cas.macroRegime.score})`,
    );
  }

  let report;
  try {
    report = await runtime.tick(snapshot);
  } catch (e) {
    console.error("  TICK FAILED:", (e as Error).message);
    // In daemon mode, log + continue. In one-shot mode, exit non-zero.
    if (!args.daemon) {
      process.exitCode = 1;
    }
    return;
  }

  console.log(
    `  → triggers=${report.triggersDetected} ` +
      `judged=${report.convictionsAccepted} ` +
      `entered=${report.entered} ` +
      `exited=${report.exited}`,
  );
  if (report.detectErrors.length > 0) {
    for (const err of report.detectErrors) {
      console.log(`  ⚠ detect() error in ${err.patternName}: ${(err.error as Error).message}`);
    }
  }

  // Tracker snapshot to console
  const opens = runtime.tracker.openPositions();
  const closes = runtime.tracker.closedPositions();
  if (opens.length > 0 || closes.length > 0) {
    console.log(
      `  positions: ${opens.length} open, ${closes.length} closed`,
    );
    for (const p of opens) {
      const cur = perTokenLatest[p.symbol] ?? p.entryPrice;
      const pct = p.entryPrice > 0 ? ((cur - p.entryPrice) / p.entryPrice) * 100 : 0;
      console.log(
        `    OPEN ${p.symbol} @ ${p.entryPrice.toFixed(6)} ` +
          `entryUsd $${p.entryUsd.toFixed(2)} pnl ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
      );
    }
    for (const c of closes) {
      console.log(
        `    CLOSED ${c.symbol} pnl $${c.realizedPnL.toFixed(2)} (${c.exitReason})`,
      );
    }
  }

  // Append to JSONL log
  try {
    const tickRecord: TickRecord = {
      timestamp: snapshot.timestamp,
      triggersDetected: report.triggersDetected,
      convictionsAccepted: report.convictionsAccepted,
      entered: report.entered,
      exited: report.exited,
      openCount: opens.length,
      closedCount: closes.length,
      detectErrors: report.detectErrors.map((e) => ({
        patternName: e.patternName,
        error: (e.error as Error).message ?? String(e.error),
      })),
      perTokenLatest,
      macroRegime: cas
        ? { regime: cas.macroRegime.regime, score: cas.macroRegime.score }
        : null,
    };
    telemetry.appendTick(tickRecord);
  } catch (e) {
    // Don't let telemetry failure crash the daemon.
    console.error("  ⚠ telemetry append failed:", (e as Error).message);
  }

  // Periodic state snapshot
  try {
    const wrote = telemetry.maybeSnapshotState({
      patternStates: bundle.patternStates(),
      openPositions: opens,
      now: Date.now(),
    });
    if (wrote) console.log(`  ✓ state snapshot written`);
  } catch (e) {
    console.error("  ⚠ state snapshot failed:", (e as Error).message);
  }
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
