/**
 * NVR-SPEC-024 — Runtime dependency wiring (Step 3 prep + Step 6)
 *
 * Two helpers that compose the pieces from Steps 1, 2, and 4 into the
 * shape the v22 PatternRuntime expects:
 *
 *   createDefaultRuntimeDeps()   — builds RuntimeDeps + CrossAssetFetchers
 *                                  + in-memory pattern-state map + a paper-
 *                                  mode executeFn. The future harness loop
 *                                  reuses this; tests use it for end-to-end
 *                                  fixture builds.
 *
 *   registerPostVolatilityLong() — registers AERO/BRETT/DEGEN post-vol-long
 *                                  pattern instances on the registry. Status
 *                                  defaults to 'disabled' so they don't fire
 *                                  until explicitly promoted.
 *
 * What's missing for live operation (next session):
 *   - The harness loop that builds MarketSnapshot per tick and calls
 *     runtime.tick(snapshot). Tonight covers everything except the loop.
 *   - JSONL/KV persistence of the in-memory pattern state — currently the
 *     state map is process-local and lost on restart. Acceptable for paper
 *     soak; required before live promotion.
 *   - Wiring executeFn to agent-v3.2.ts's real execute path (currently a
 *     paper logger).
 */

import type Anthropic from "@anthropic-ai/sdk";
import { CacheManager } from "../services/cache-manager.js";
import type { TradeDecision } from "./trade-decision-shim.js";
import type { PatternState, PatternStatus } from "./types.js";
import type { RuntimeDeps } from "./runtime.js";
import { PatternRegistry } from "./registry.js";

import { createAskAI } from "./ask-ai.js";
import {
  CrossAssetFetchers,
  buildCrossAssetState,
  type BuildCrossAssetStateOptions,
} from "./cross-asset-fetchers.js";
import {
  aeroPostVolatilityLong,
  brettPostVolatilityLong,
  degenPostVolatilityLong,
} from "./post-volatility-long.js";

// ----------------------------------------------------------------------------
// Default runtime deps — builds the standard v22 dependency bundle.
// ----------------------------------------------------------------------------

export interface CreateRuntimeDepsOptions {
  /** Anthropic SDK client. Required for askAI heavy-tier and as cheap-tier
   *  fallback when Groq is unavailable. Pass undefined only in tests/paper-
   *  mode that don't exercise the AI path. */
  anthropic?: Anthropic;

  /** Shared CacheManager. Reuse the bot's singleton if you have one;
   *  otherwise the factory creates a fresh instance. */
  cache?: CacheManager;

  /** Total alpha sleeve USD the runtime can deploy across patterns. The
   *  runtime divides this proportional to each pattern's maxAllocationPct.
   *  Defaults to env NVR_ALPHA_SLEEVE_USD, then $1,000 (paper). */
  sleeveUsd?: number;

  /** Override executeFn. Defaults to a paper-mode executor that logs the
   *  decision and returns synthetic fill info. Live operation must replace
   *  this with a real wire to agent-v3.2.ts's execution layer. */
  executeFn?: RuntimeDeps["executeFn"];

  /** Logger. Defaults to console.log with a [v22-runtime] prefix. */
  log?: (msg: string) => void;
}

export interface RuntimeDepsBundle {
  /** The RuntimeDeps the PatternRuntime constructor takes. */
  readonly deps: RuntimeDeps;

  /** The fetchers used internally by the deps. Exposed so the harness can
   *  call them on its own cadence (e.g. warm the cache at boot) and so
   *  buildState can reuse them. */
  readonly fetchers: CrossAssetFetchers;

  /** Convenience to build a CrossAssetState for the next tick using the
   *  bundle's fetchers. The harness owns per-token / macro-regime /
   *  recent-edge inputs and supplies them to this call. */
  buildState(
    opts: Omit<BuildCrossAssetStateOptions, "fetchers">,
  ): Promise<import("./cross-asset-state.js").CrossAssetState>;

  /** Read-only view of the in-memory pattern-state map. Useful for the
   *  harness's periodic persistence snapshot and for tests. */
  patternStates(): ReadonlyMap<string, PatternState>;
}

export function createDefaultRuntimeDeps(
  opts: CreateRuntimeDepsOptions = {},
): RuntimeDepsBundle {
  const log = opts.log ?? ((m: string) => console.log(`[v22-runtime] ${m}`));
  const cache = opts.cache ?? new CacheManager();
  const fetchers = new CrossAssetFetchers({ cache, log });
  const askAI = createAskAI({
    anthropic: opts.anthropic,
    log,
  });

  const sleeveUsd =
    opts.sleeveUsd ?? Number(process.env["NVR_ALPHA_SLEEVE_USD"] ?? "1000");

  const executeFn = opts.executeFn ?? createPaperExecuteFn(log);

  // In-memory pattern state map. The runtime mutates the returned object
  // in place across ticks; here we just ensure each pattern gets its own
  // bucket on first access. Persistence is the harness's job.
  const stateByPattern = new Map<string, PatternState>();

  const deps: RuntimeDeps = {
    alphaSleeveUsd: () => sleeveUsd,
    executeFn,
    askAI,
    loadPatternState: (name: string) => {
      let state = stateByPattern.get(name);
      if (!state) {
        state = {};
        stateByPattern.set(name, state);
      }
      return state;
    },
  };

  return {
    deps,
    fetchers,
    buildState: (buildOpts) => buildCrossAssetState({ ...buildOpts, fetchers }),
    patternStates: () => stateByPattern,
  };
}

/**
 * Default paper-mode executeFn. Logs the decision and returns synthetic
 * fill info. Use createDefaultRuntimeDeps({ executeFn: ... }) to override
 * for live mode.
 */
export function createPaperExecuteFn(
  log: (msg: string) => void,
): RuntimeDeps["executeFn"] {
  return async (decision: TradeDecision) => {
    log(
      `[paper] ${decision.action} ${decision.fromToken}→${decision.toToken} ` +
        `$${decision.amountUSD.toFixed(2)} · ${(decision.reasoning ?? "").slice(0, 100)}`,
    );
    return {
      // Paper fills at requested size. Live mode's executeFn returns the
      // actual on-chain fill — usually slightly less due to slippage.
      filledUsd: decision.amountUSD,
      // No price observation in pure paper mode; the harness can override
      // executeFn with one that reads market.prices to set this.
      filledPrice: 0,
      txHash: undefined,
    };
  };
}

// ----------------------------------------------------------------------------
// Registry helper — wires post-volatility-long instances into a registry.
//
// Default status is 'disabled' so the patterns don't fire until explicitly
// promoted. Promotion path (per SPEC-024):
//
//   disabled  → after Steps 2-4 + 90d retest passes gates
//   paper     → after 14d paper soak with hit≥40% and edge≥15pp held
//   live      → after small-sleeve live test on $200 cap, scaling by
//               realized edge, capped at maxAllocationPct
// ----------------------------------------------------------------------------

export function registerPostVolatilityLong(
  registry: PatternRegistry,
  status: PatternStatus = "disabled",
): void {
  registry.register(aeroPostVolatilityLong, status);
  registry.register(brettPostVolatilityLong, status);
  registry.register(degenPostVolatilityLong, status);
}
