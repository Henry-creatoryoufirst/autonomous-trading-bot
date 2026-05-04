/**
 * NVR-SPEC-024 — Forward-Harness Adapter for the v22 PatternRuntime
 *
 * Glue between `scripts/observation-forward-harness.ts` (the Railway-
 * deployed P-IntermediarySurge harness) and the v22 PatternRuntime
 * stack from Steps 1-4.
 *
 * Why this exists: the forward-harness already runs on Railway with a
 * polling loop, an HTTP server, and the GeckoTerminalHistoricalFeed for
 * AERO/BRETT/DEGEN. Standing up a separate Railway service for v22
 * paper-mode would duplicate that infra. Instead, we plug v22 into the
 * existing loop behind a feature flag (V22_RUNTIME_ENABLED=true) so the
 * patterns start ticking on production data with no new deploy.
 *
 * Design constraints:
 *   - Existing IntermediarySurge logic is load-bearing (data collection
 *     for forward-validation). v22 must be an ADDITION, never a
 *     modification of that path.
 *   - v22 errors must not take down the existing loop. Every v22 call
 *     wraps its own try/catch.
 *   - v22 only ticks when its 60s cadence has elapsed; the forward-
 *     harness polls every 30s but v22 patterns expect 1-min intervals.
 *
 * Two-call API:
 *   initV22Integration(opts)  — at harness startup, AFTER price-feed
 *                                preload. Returns null if the env flag
 *                                is off (caller should treat as "v22 not
 *                                running"); otherwise returns the bundle
 *                                + tick fn + status accessor.
 *
 *   integration.tick(priceFeed) — call from inside the polling loop.
 *                                  Internal cadence guard ensures the
 *                                  runtime ticks at most once every
 *                                  v22TickIntervalSec seconds.
 */

import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";

import { PatternRuntime } from "./runtime.js";
import { PatternRegistry } from "./registry.js";
import { CacheManager } from "../services/cache-manager.js";
import {
  createDefaultRuntimeDeps,
  registerPostVolatilityLong,
} from "./runtime-deps.js";
import { computeMacroRegime } from "../../algorithm/macro-regime.js";
import type { TokenState } from "./cross-asset-state.js";
import type { MarketSnapshot } from "./types.js";
import type { GeckoTerminalHistoricalFeed } from "../../simulation/data/price-feed.js";

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

const V22_TOKENS = ["AERO", "BRETT", "DEGEN"] as const;
const RING_SIZE = 65; // matches post-volatility-long ROLLING_WINDOW_MIN+1

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface V22IntegrationOptions {
  /** Forward-harness's price feed. Must already be preloaded for the v22
   *  tokens before this is called. */
  priceFeed: GeckoTerminalHistoricalFeed;
  /** Persistence directory for v22 telemetry. The forward-harness's
   *  OUT_DIR makes a clean parent; we add a v22/ subdirectory.
   *  Pass `undefined` to disable disk telemetry (in-memory only). */
  persistDir?: string;
  /** Tick cadence in seconds. Defaults to 60 (matches pattern.tickIntervalMs). */
  tickIntervalSec?: number;
  /** Override the env-var gate for tests. Defaults to reading
   *  V22_RUNTIME_ENABLED. */
  enabledOverride?: boolean;
  /** Override the alpha sleeve USD. Defaults to NVR_ALPHA_SLEEVE_USD env
   *  or 1000. */
  sleeveUsdOverride?: number;
  /** Logger. Defaults to console.log with [v22] prefix. */
  log?: (msg: string) => void;
}

export interface V22Integration {
  /** Run a single tick if the cadence guard allows. Returns true if a
   *  tick actually fired, false if it was skipped (cadence guard). */
  tick(): Promise<boolean>;

  /** Status accessor for the harness's /health and /api/v22-summary
   *  endpoints. */
  status(): V22Status;
}

export interface V22Status {
  enabled: boolean;
  lastTickAt: number | null;
  lastTickAgeSec: number | null;
  totalTicks: number;
  totalTriggers: number;
  totalEntered: number;
  totalExited: number;
  openPositions: number;
  closedPositions: number;
  lastError: string | null;
  patternStatuses: Record<string, "disabled" | "paper" | "live">;
  /** Per-pattern rolling-edge metrics. Powers the Pattern Aging Watchdog
   *  routine (Loop B). Null fields = insufficient samples in window. */
  patterns: Record<string, PatternMetrics>;
}

export interface PatternMetrics {
  status: "disabled" | "paper" | "live";
  openPositions: number;
  closedPositions: number;
  /** Rolling hit rate over closed positions in the last 7 days (0–1).
   *  Null if <5 closed positions in window. */
  rollingHitRate7d: number | null;
  /** Rolling hit rate over closed positions in the last 30 days (0–1).
   *  Null if <5 closed positions in window. */
  rollingHitRate30d: number | null;
  /** Realized edge over null: (hitRate30d − validatedNullHitRate). Null
   *  if either side is missing. */
  realizedEdge30d: number | null;
  /** Validated edge baseline from config/pattern-baselines.json (0–1).
   *  Null if no baseline configured for this pattern. */
  validatedEdgeBaseline: number | null;
  /** Decay ratio = realizedEdge30d / validatedEdgeBaseline. The Pattern
   *  Aging Watchdog demotes when this drops below 0.5. Null if either
   *  numerator or denominator is missing. */
  decayRatio: number | null;
}

interface PatternBaseline {
  validatedEdgePp: number;       // 17.7
  validatedHitRate: number;      // 0.364
  validatedNullHitRate: number;  // 0.187
  validatedAt: string;
  source: string;
  nMin: number;
  notes?: string;
}

interface PatternBaselinesConfig {
  patterns: Record<string, PatternBaseline>;
}

// ----------------------------------------------------------------------------
// Init — called once at harness startup
// ----------------------------------------------------------------------------

export function initV22Integration(
  opts: V22IntegrationOptions,
): V22Integration | null {
  const enabled =
    opts.enabledOverride ?? process.env["V22_RUNTIME_ENABLED"] === "true";
  if (!enabled) return null;

  const log = opts.log ?? ((m: string) => console.log(`[v22] ${m}`));
  const tickIntervalMs = (opts.tickIntervalSec ?? 60) * 1000;

  // Make sure detect() can fire (the pattern's env-var gate).
  process.env["POST_VOL_LONG_PATTERN_ENABLED"] = "true";

  // Load pattern baselines from the bundled config. Used by status() to
  // compute decay-ratio per pattern. Resolves relative to this module so
  // it works in both `tsx scripts/...` and Railway-deployed contexts.
  // The Aging Watchdog routine (Loop B) reads these computed fields.
  const baselines = loadPatternBaselines(log);

  const cache = new CacheManager();
  const anthropic = process.env["ANTHROPIC_API_KEY"]
    ? new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] })
    : undefined;
  if (!anthropic) {
    log("ANTHROPIC_API_KEY not set — heavy-tier disabled. Cheap-tier (Groq) will be tried first; if also unavailable, confirm() vetoes (returns null).");
  }

  const sleeveUsd =
    opts.sleeveUsdOverride ??
    Number(process.env["NVR_ALPHA_SLEEVE_USD"] ?? "1000");

  const bundle = createDefaultRuntimeDeps({
    cache,
    anthropic,
    sleeveUsd,
    log: (m: string) => log(m),
  });

  const registry = new PatternRegistry();
  // Status default is "disabled" until the Quota-Reset routine flips it
  // to "paper" via a commit on the feat branch (per SPEC-024 routine).
  // Until then, registering them at "paper" here lets us paper-mode soak
  // without waiting for the routine. Toggle via env var.
  const initialStatus = process.env["V22_PATTERN_STATUS"] === "live"
    ? "live"
    : process.env["V22_PATTERN_STATUS"] === "disabled"
      ? "disabled"
      : "paper";
  registerPostVolatilityLong(registry, initialStatus);

  const runtime = new PatternRuntime(registry, bundle.deps, "paper");

  // Telemetry
  let logPath: string | null = null;
  let statePath: string | null = null;
  if (opts.persistDir) {
    const dir = join(opts.persistDir, "v22");
    try {
      mkdirSync(dir, { recursive: true });
      logPath = join(dir, "ticks.jsonl");
      statePath = join(dir, "state.json");
    } catch (e) {
      log(`telemetry dir setup failed: ${(e as Error).message}`);
    }
  }

  // Cadence + status state
  let lastTickAt = 0;
  let totalTicks = 0;
  let totalTriggers = 0;
  let totalEntered = 0;
  let totalExited = 0;
  let lastError: string | null = null;
  let lastSnapshotTs = 0;
  const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

  log(
    `v22 runtime initialized: ${V22_TOKENS.length} patterns at status=${initialStatus}, ` +
      `sleeveUsd=$${sleeveUsd}, tickInterval=${tickIntervalMs / 1000}s, telemetry=${logPath ?? "off"}`,
  );

  async function buildSnapshotAsync(nowMs: number): Promise<MarketSnapshot | null> {
    const tokens: Record<string, TokenState> = {};
    const prices = new Map<string, number>();

    for (const symbol of V22_TOKENS) {
      const candles: number[] = [];
      for (let m = RING_SIZE; m >= 0; m--) {
        const t = new Date(nowMs - m * 60_000).toISOString();
        const px = await opts.priceFeed.getPriceAt(symbol, t);
        if (px === null || !Number.isFinite(px) || px <= 0) continue;
        candles.push(px);
      }
      if (candles.length < RING_SIZE) continue; // skip if feed has gaps
      const latest = candles[candles.length - 1]!;
      tokens[symbol] = {
        symbol,
        candles,
        recentDirectionalEdge: { fadeHit: 0.36, continueHit: 0.37 },
        realizedVol24h: estimateRealizedVol(candles),
      };
      prices.set(symbol, latest);
    }

    if (Object.keys(tokens).length === 0) return null; // nothing to do

    // Macro regime: use whichever blue-chip is in the price feed. Most
    // forward-harness deploys preload all the watched tokens; if WETH
    // cache is available, use it; else BTC ratio fallback inside
    // computeMacroRegime via RSI proxy.
    let regimeInput: number[] = [];
    for (let m = 200; m >= 0; m -= 5) {
      const t = new Date(nowMs - m * 60_000).toISOString();
      const px = await opts.priceFeed.getPriceAt("WETH", t);
      if (px !== null && Number.isFinite(px) && px > 0) regimeInput.push(px);
    }
    if (regimeInput.length < 50) {
      // Fall back to AERO if WETH not in feed — better than no regime
      regimeInput = tokens["AERO"]?.candles ? Array.from(tokens["AERO"].candles) : [];
    }
    const macroRegime = regimeInput.length >= 50
      ? computeMacroRegime(regimeInput)
      : computeMacroRegime([3000, 3010, 3020]); // degenerate fallback

    const cas = await bundle.buildState({
      tokens,
      macroRegime,
      recentEdge: { count: 0, hitRate: 0, meanReturn: 0, stdReturn: 0 },
      signalServiceUrl: process.env["SIGNAL_SERVICE_URL"],
    });

    return {
      timestamp: new Date(nowMs).toISOString(),
      prices,
      extras: { crossAsset: cas },
    };
  }

  async function tick(): Promise<boolean> {
    const now = Date.now();
    if (now - lastTickAt < tickIntervalMs) return false; // cadence guard

    try {
      const snapshot = await buildSnapshotAsync(now);
      if (!snapshot) {
        log(`tick skipped: no token state could be built from price feed`);
        lastTickAt = now;
        return false;
      }

      const report = await runtime.tick(snapshot);
      lastTickAt = now;
      totalTicks++;
      totalTriggers += report.triggersDetected;
      totalEntered += report.entered;
      totalExited += report.exited;
      lastError = null;

      // JSONL append
      if (logPath) {
        try {
          const cas = (snapshot.extras as { crossAsset?: { macroRegime: { regime: string; score: number } } } | undefined)?.crossAsset;
          const record = {
            timestamp: snapshot.timestamp,
            triggersDetected: report.triggersDetected,
            convictionsAccepted: report.convictionsAccepted,
            entered: report.entered,
            exited: report.exited,
            openCount: runtime.tracker.openPositions().length,
            closedCount: runtime.tracker.closedPositions().length,
            macroRegime: cas
              ? { regime: cas.macroRegime.regime, score: cas.macroRegime.score }
              : null,
            perTokenLatest: Object.fromEntries(snapshot.prices.entries()),
          };
          appendFileSync(logPath, JSON.stringify(record) + "\n");
        } catch (e) {
          log(`telemetry append failed: ${(e as Error).message}`);
        }
      }

      // Periodic state snapshot
      if (statePath && now - lastSnapshotTs >= SNAPSHOT_INTERVAL_MS) {
        try {
          const payload = {
            snapshotAt: new Date(now).toISOString(),
            patternStates: Object.fromEntries(bundle.patternStates().entries()),
            openPositions: runtime.tracker.openPositions(),
            counters: { totalTicks, totalTriggers, totalEntered, totalExited },
          };
          writeFileSync(statePath, JSON.stringify(payload, null, 2));
          lastSnapshotTs = now;
        } catch (e) {
          log(`state snapshot failed: ${(e as Error).message}`);
        }
      }

      if (report.triggersDetected > 0) {
        log(
          `tick: triggers=${report.triggersDetected} judged=${report.convictionsAccepted} ` +
            `entered=${report.entered} exited=${report.exited}`,
        );
      }
      return true;
    } catch (e) {
      lastError = (e as Error).message;
      log(`tick error: ${lastError}`);
      lastTickAt = now; // rate-limit retries
      return false;
    }
  }

  function status(): V22Status {
    const now = Date.now();
    const patternStatuses: Record<string, "disabled" | "paper" | "live"> = {};
    for (const r of registry.byStatus("paper")) patternStatuses[r.pattern.name] = "paper";
    for (const r of registry.byStatus("live")) patternStatuses[r.pattern.name] = "live";
    for (const r of registry.byStatus("disabled")) patternStatuses[r.pattern.name] = "disabled";

    // Per-pattern rolling-edge metrics. Powers the Pattern Aging Watchdog
    // routine (Loop B). For each pattern, compute hit rates over 7d/30d
    // windows from runtime.tracker.closedPositions(name), apply baseline
    // from config/pattern-baselines.json, and surface decay ratio.
    const patterns: Record<string, PatternMetrics> = {};
    const cutoff7d = now - 7 * 24 * 60 * 60 * 1000;
    const cutoff30d = now - 30 * 24 * 60 * 60 * 1000;
    const allPatternNames = new Set<string>(Object.keys(patternStatuses));
    for (const name of allPatternNames) {
      const opens = runtime.tracker.openPositions(name);
      const allClosed = runtime.tracker.closedPositions(name);
      const closed7d = allClosed.filter(
        (c) => Date.parse(c.closedAt) >= cutoff7d,
      );
      const closed30d = allClosed.filter(
        (c) => Date.parse(c.closedAt) >= cutoff30d,
      );

      const rollingHitRate7d = hitRateFromClosed(closed7d);
      const rollingHitRate30d = hitRateFromClosed(closed30d);

      const baseline = baselines[name];
      const validatedEdgeBaseline = baseline
        ? baseline.validatedEdgePp / 100
        : null;
      const realizedEdge30d =
        rollingHitRate30d !== null && baseline
          ? rollingHitRate30d - baseline.validatedNullHitRate
          : null;
      const decayRatio =
        realizedEdge30d !== null && validatedEdgeBaseline !== null && validatedEdgeBaseline !== 0
          ? realizedEdge30d / validatedEdgeBaseline
          : null;

      patterns[name] = {
        status: patternStatuses[name] ?? "disabled",
        openPositions: opens.length,
        closedPositions: allClosed.length,
        rollingHitRate7d,
        rollingHitRate30d,
        realizedEdge30d,
        validatedEdgeBaseline,
        decayRatio,
      };
    }

    return {
      enabled: true,
      lastTickAt: lastTickAt > 0 ? lastTickAt : null,
      lastTickAgeSec: lastTickAt > 0 ? Math.floor((now - lastTickAt) / 1000) : null,
      totalTicks,
      totalTriggers,
      totalEntered,
      totalExited,
      openPositions: runtime.tracker.openPositions().length,
      closedPositions: runtime.tracker.closedPositions().length,
      lastError,
      patternStatuses,
      patterns,
    };
  }

  return { tick, status };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Load pattern baselines from `config/pattern-baselines.json`. Returns an
 * empty record on missing file or parse error — the runtime continues, just
 * without decay-ratio computation for patterns lacking a baseline. Logged.
 */
function loadPatternBaselines(
  log: (msg: string) => void,
): Record<string, PatternBaseline> {
  try {
    // Resolve relative to this module — works whether we're invoked via
    // tsx scripts/observation-forward-harness.ts (Railway) or via tests.
    const __dirnameLocal = dirname(fileURLToPath(import.meta.url));
    // module is at src/core/patterns/forward-harness-adapter.ts
    // → up 3 to repo root → config/pattern-baselines.json
    const path = join(__dirnameLocal, "..", "..", "..", "config", "pattern-baselines.json");
    if (!existsSync(path)) {
      log(`pattern-baselines.json not found at ${path}; decay-ratio fields will be null`);
      return {};
    }
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as PatternBaselinesConfig;
    return parsed.patterns ?? {};
  } catch (e) {
    log(`pattern-baselines load failed: ${(e as Error).message}; decay-ratio fields will be null`);
    return {};
  }
}

/**
 * Compute hit rate from a list of closed positions. "Hit" = closeReason
 * is "profit_target". Anything else (stop_loss, time_stop) is a miss.
 * Returns null if fewer than `minSamples` positions in the input — a
 * smaller sample is too noisy to publish a rolling number.
 */
function hitRateFromClosed(
  closed: readonly { closeReason: string }[],
  minSamples: number = 5,
): number | null {
  if (closed.length < minSamples) return null;
  const hits = closed.filter((c) => c.closeReason === "profit_target").length;
  return hits / closed.length;
}

function estimateRealizedVol(candles: readonly number[]): number {
  if (candles.length < 4) return 0;
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const a = candles[i - 1]!;
    const b = candles[i]!;
    if (a > 0) returns.push(Math.log(b / a));
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
  const variance =
    returns.reduce((s, x) => s + (x - mean) ** 2, 0) / (returns.length - 1);
  const stdPerStep = Math.sqrt(variance);
  // Annualize: 1-min intervals × 1440 min/day × 365 days. As percentage.
  const annualized = stdPerStep * Math.sqrt(1440 * 365) * 100;
  return Number.isFinite(annualized) ? annualized : 0;
}
