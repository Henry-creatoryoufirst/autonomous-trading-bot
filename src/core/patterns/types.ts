/**
 * NVR-SPEC-022 — Pattern Runtime Types
 *
 * The contract for v22's "Bot On Watch" architecture. Each pattern is a
 * self-contained module that watches a specific signal stream and, when
 * triggered, drives a focused trade decision through three layers:
 *
 *   Layer 1 (Mechanical Attention): pattern.detect()  — does my signal fire?
 *   Layer 2 (AI Judgment):          pattern.confirm() — is this real? size it.
 *   Layer 3 (Mechanical Execution): pattern.enter() + pattern.monitor()
 *
 * Patterns are independent. Adding one = writing one module. The runtime
 * does not assume what a pattern looks for or how it trades — only that
 * it implements this contract.
 */

import type { TradeDecision } from "./trade-decision-shim.js";

// ----------------------------------------------------------------------------
// Inputs the runtime provides to patterns
// ----------------------------------------------------------------------------

/**
 * A single point-in-time market read. The runtime calls each pattern's
 * `detect()` with this snapshot. Keeping it minimal at the top level —
 * patterns that need richer data declare the dependency in their factory
 * options and the runtime injects it.
 */
export interface MarketSnapshot {
  /** ISO timestamp of the snapshot. */
  readonly timestamp: string;
  /** Block height (Base mainnet) at snapshot time, if known. */
  readonly blockNumber?: number;
  /** Per-token spot price, in USD. */
  readonly prices: ReadonlyMap<string, number>;
  /** Optional per-token 24h volume USD. */
  readonly volume24h?: ReadonlyMap<string, number>;
  /** Whatever else the runtime can cheaply provide; patterns should not
   *  rely on every field — they declare their own data needs in the
   *  factory and the runtime extends this snapshot. */
  readonly extras?: Readonly<Record<string, unknown>>;
}

/**
 * Persistent state per pattern. Patterns may store anything here between
 * ticks (e.g., last-seen depeg timestamp, trigger debounce). The runtime
 * persists this to disk so it survives bot restarts.
 */
export type PatternState = Record<string, unknown>;

// ----------------------------------------------------------------------------
// Outputs the pattern returns to the runtime
// ----------------------------------------------------------------------------

/**
 * A pattern's signal that something real has happened and the runtime
 * should consider acting. The runtime then routes this to `confirm()`
 * (if defined) and `enter()`.
 */
export interface Trigger {
  /** Pattern that fired the trigger. Set by the runtime. */
  patternName: string;
  /** Symbol the trigger applies to (e.g. 'USDC', 'AERO'). */
  symbol: string;
  /** ISO timestamp the trigger fired. */
  detectedAt: string;
  /** Free-form context the pattern wants to surface to confirm() and to
   *  the cockpit. Should be JSON-serializable for logging. */
  context: Readonly<Record<string, unknown>>;
  /** A human-readable one-line summary. Goes into trade reasoning + logs. */
  summary: string;
}

/**
 * AI's confidence that the trigger is real and worth acting on.
 * 0 = veto (do not enter); 100 = maximum conviction.
 *
 * If a pattern omits `confirm()`, the runtime treats it as conviction=100.
 */
export type Conviction = number;

/**
 * Pattern-specific exit decision, returned per tick from `monitor()`.
 *
 *  - 'hold'  : keep the position, no action
 *  - object  : exit per the rules. The runtime executes the SELL.
 */
export type ExitDecision =
  | "hold"
  | {
      action: "exit";
      reason: string; // e.g. 'velocity_decay', 'profit_target', 'stop_loss', 'time_stop'
      /** 0–100. Default 100 (full close). Used for partial exits. */
      pctClose?: number;
    };

// ----------------------------------------------------------------------------
// Open-position record the runtime tracks per pattern
// ----------------------------------------------------------------------------

export interface Position {
  readonly patternName: string;
  readonly symbol: string;
  readonly entryAt: string;
  readonly entryPrice: number;
  readonly entryUsd: number;
  /** Whatever the pattern wants to remember about this position
   *  (e.g., trigger context, peak price for trailing logic). */
  readonly meta: Readonly<Record<string, unknown>>;
}

// ----------------------------------------------------------------------------
// Inputs to confirm() — limited so patterns can't reach into bot internals
// ----------------------------------------------------------------------------

export interface ConfirmContext {
  readonly trigger: Trigger;
  readonly market: MarketSnapshot;
  /** A function the pattern can call to ask AI a focused question. The
   *  runtime owns model selection (cheap vs. heavy tier), caching, and
   *  cost telemetry. Patterns just describe the question. */
  askAI?: (prompt: string, opts?: AskAIOptions) => Promise<string>;
}

export interface AskAIOptions {
  /** Max tokens the response should be. Defaults to 200. */
  maxTokens?: number;
  /** 'cheap' (Groq/Cerebras/Haiku) or 'heavy' (Sonnet). Default 'cheap'. */
  tier?: "cheap" | "heavy";
}

// ----------------------------------------------------------------------------
// The Pattern contract itself
// ----------------------------------------------------------------------------

export interface Pattern {
  // --- Identity ---
  readonly name: string;
  readonly version: string;
  readonly description: string;

  // --- Allocation ---
  /** Maximum % of the alpha sleeve this pattern can deploy. Hard ceiling. */
  readonly maxAllocationPct: number;
  /** Maximum number of concurrent open positions this pattern manages. */
  readonly maxConcurrentPositions: number;

  // --- Hint to the runtime ---
  /** How often this pattern wants `detect()` called. The runtime takes
   *  the minimum across enabled patterns as its tick interval. Express
   *  in milliseconds. */
  readonly tickIntervalMs: number;

  // --- Layer 1: Mechanical attention ---
  /**
   * Returns a Trigger if the pattern's signal fired this tick, otherwise null.
   * Pure function of (market, state). No I/O, no AI call, no side effects.
   */
  detect(market: MarketSnapshot, state: PatternState): Trigger | null;

  // --- Layer 2: AI judgment (optional) ---
  /**
   * Optional. When present, called once per Trigger to size conviction.
   * Returning null vetoes the trigger (no entry).
   * Returning 0 also vetoes. Otherwise the conviction sizes the position.
   */
  confirm?(ctx: ConfirmContext): Promise<Conviction | null>;

  // --- Layer 3: Mechanical execution ---
  /**
   * Build the SELL or BUY decision the runtime will execute. Pattern
   * decides token, target, size based on its allocation budget and the
   * conviction returned from confirm().
   */
  enter(trigger: Trigger, conviction: Conviction, allocationUsd: number): TradeDecision;

  /**
   * Called once per tick on each open position the pattern owns.
   * Pure rule logic. No AI. Returns 'hold' to keep, or an exit decision.
   */
  monitor(position: Position, market: MarketSnapshot, state: PatternState): ExitDecision;
}

// ----------------------------------------------------------------------------
// Lifecycle status visible to the runtime + cockpit
// ----------------------------------------------------------------------------

export type PatternStatus = "disabled" | "paper" | "live";

export interface PatternRecord {
  readonly pattern: Pattern;
  readonly status: PatternStatus;
  readonly enabledAt: string;
  /** Per-pattern attribution — every trade tagged so we can answer
   *  "which patterns make money" without ambiguity. */
  readonly attributionTag: string;
}
