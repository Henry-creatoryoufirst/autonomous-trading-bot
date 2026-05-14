// NVR-SPEC-032 — Position Attribution
//
// THE CONTRACT. Every position the bot holds carries this shape. Without it
// the goal-state reasoner can't distinguish "balance-sheet drift" from
// "milestone-relevant Alpha-WD entry that's still pending its exit."
//
// Loaded by:
//   - Phase 1: backfill synthesis (this commit's owner) — reads existing
//     state.costBasis + state.sleeveOwnership + state.tradeHistory, emits
//     this shape.
//   - Phase 2: executeTrade entry capture — populates entryContext at the
//     moment of trade, so future cycles inherit attribution.
//   - Phase 3: goal-state reasoner — consumes the per-cohort summary so
//     the evaluator anchors on "3 of 15 are AlphaHunter-WD" not "15
//     unattributed positions."
//   - Phase 4: stc-website cockpit card — renders attribution per position
//     with role pill + entry context + exit countdown.
//
// This file is the load-bearing contract. Do not change the shape without
// updating all four consumers in lockstep.

/**
 * Which decision path put this position on the bot's books.
 *
 * - core: Core sleeve's normal 24h-conviction decision path
 * - alpha-hunter-wd: Watcher-Direct (NVR-SPEC-029) — the path being pursued
 *   for the first Path-D round-trip-for-profit milestone
 * - alpha-rotation: Alpha rotation sleeve (NVR-SPEC-011)
 * - fast-strike-liberation: USDC fast-strike that sold a Core position
 *   to free capital for a WD candidate (NVR-SPEC-029 follow-on)
 * - weth-rebalance: WETH-escape-hatch rebalance into USDC headroom
 * - manual: Operator override / test trade
 * - legacy-unknown: Position pre-dates sleeve attribution OR no matching
 *   trade history row was found within the lookback window
 */
export type PositionEnteredBy =
  | "core"
  | "alpha-hunter-wd"
  | "alpha-rotation"
  | "fast-strike-liberation"
  | "weth-rebalance"
  | "manual"
  | "legacy-unknown";

/**
 * Strategic role this position plays in the portfolio. Mirrors the
 * dashboard's role pill from `feedback_dashboard_communicates_intelligence`.
 *
 * - core: asset base (WETH, cbBTC, blue chips by sector definition)
 * - dry-powder: USDC reserve. Not a "position" in the trading sense but
 *   appears in the same balance list — surface for consistency.
 * - alpha: meme / AI-agent / cohort tokens being held for thesis-driven
 *   profit. Where Path-D milestones live.
 */
export type PositionRole = "core" | "dry-powder" | "alpha";

/**
 * Entry-time context. Populated by Phase 2 at executeTrade time and
 * persisted with the position. Phase 1 backfill synthesizes this from
 * trade history when it can; falls back to undefined when the trade
 * predates Phase 2 instrumentation.
 */
export interface PositionEntryContext {
  /** Watcher trigger ID if Alpha-WD path. Undefined for Core / manual. */
  triggerId?: string;
  /** Trigger type that fired (WHALE_BUY, VOLUME_SPIKE, etc.). */
  triggerType?: string;
  /** Reviewer's verdict at entry (BUY / WAIT / PASS — only BUY entries proceed, kept for audit). */
  reviewerVerdict?: "BUY" | "WAIT" | "PASS";
  /** Reviewer's confidence in its verdict at entry (0-1). */
  reviewerConfidence?: number;
  /** Macro regime at the moment of entry (signal-service classification). */
  regimeAtEntry?: "BULL" | "RANGING" | "BEAR";
  /** Short reasoning snippet (max 200 chars) the decision LLM produced. */
  reasoning?: string;
}

/**
 * Exit criterion currently in force for this position. Mirrors what the
 * WD-tight-exits / Core-stale-exits / alpha-rotation logic enforces.
 * Populated when the entry path implies a known exit policy; undefined
 * when the bot is holding without a structured exit (e.g. legacy).
 */
export interface PositionExitCriterion {
  type:
    | "wd-tight-exit"
    | "core-thesis-driven"
    | "stale-exit"
    | "alpha-rotation"
    | "ad-hoc";
  /** Take-profit percent above entry (e.g. 8 = +8%). */
  takeProfitPct?: number;
  /** Trailing stop percent below peak (e.g. 3 = -3% off peak once armed). */
  trailingStopPct?: number;
  /** Max hold duration in hours. */
  maxHoldHours?: number;
}

/**
 * One position, fully attributed.
 *
 * Phase 1 emits an array of these via `synthesizePositionAttributions()`.
 * The shape is stable across phases — Phases 2-4 read this exact contract.
 */
export interface PositionAttribution {
  // Identity
  /** Token symbol (e.g. "VVV", "WETH"). Canonical case. */
  symbol: string;
  /** Token contract address on Base, lowercase. */
  address: string;

  // Value
  /** Current USD value at the time the attribution was synthesized. */
  currentValueUsd: number;
  /** Token balance (raw amount, not USD). */
  balance: number;
  /** Token price in USD at synthesis time. */
  currentPriceUsd: number;

  // Cost basis + P&L (when available)
  /** USD invested at entry; undefined when cost basis isn't tracked. */
  invested?: number;
  /** Average entry price; undefined for legacy without cost basis. */
  entryPriceUsd?: number;
  /** Unrealized P&L in USD (currentValueUsd - invested). */
  unrealizedPnLUsd?: number;
  /** Unrealized P&L as a percent of invested. */
  unrealizedPnLPct?: number;

  // Lifetime
  /** ISO timestamp of the entry; undefined for legacy without trade match. */
  enteredAt?: string;
  /** Hours since entry; undefined when enteredAt is absent. */
  ageHours?: number;

  // Attribution
  enteredBy: PositionEnteredBy;
  /** Strategic role tag for the role-pill rendering. */
  role: PositionRole;
  /** Sleeve that owns this position per state.sleeveOwnership, if any. */
  sleeve?: string;
  /** Entry context — populated by Phase 2 going forward; backfilled where possible. */
  entryContext?: PositionEntryContext;
  /** Exit criterion currently in force; undefined for ad-hoc legacy positions. */
  exitCriterion?: PositionExitCriterion;

  // Provenance
  /** ISO timestamp when this attribution row was synthesized. */
  synthesizedAt: string;
  /** True if the row was backfilled from trade history; false if captured at entry by Phase 2. */
  backfilled: boolean;
}

/**
 * Per-path summary the goal-state reasoner consumes. Phase 1 produces this
 * alongside the per-position array so the reasoner doesn't need to recount.
 */
export interface PositionAttributionSummary {
  /** Total non-USDC positions with usdValue > $1. */
  totalPositions: number;
  /** Total USD across all non-USDC positions. */
  totalNonUsdcValueUsd: number;
  /** USDC balance in USD. */
  usdcBalanceUsd: number;
  /** Breakdown by entry path — every key from PositionEnteredBy has a count + usdValue. */
  byEnteredBy: Record<PositionEnteredBy, { count: number; usdValue: number }>;
  /** Breakdown by strategic role. */
  byRole: Record<PositionRole, { count: number; usdValue: number }>;
  /** Number of positions with backfilled=false (true Phase-2 entries). */
  phase2AttributedCount: number;
  /** Number of positions with enteredBy='legacy-unknown'. The dream's open-positions-unexplained blocker resolves when this hits 0. */
  legacyUnknownCount: number;
}

/**
 * The full response envelope the synthesis function returns + the new
 * /api/positions/attribution endpoint serves.
 */
export interface PositionAttributionResponse {
  /** ISO timestamp of the synthesis run. */
  synthesizedAt: string;
  /** Per-position attribution rows, sorted by currentValueUsd descending. */
  positions: PositionAttribution[];
  /** Aggregate summary the reasoner consumes. */
  summary: PositionAttributionSummary;
}
