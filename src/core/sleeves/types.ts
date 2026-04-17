/**
 * NVR Capital — Capital Sleeves: Core Types
 *
 * A Sleeve is a self-contained capital pool with its own strategy, position
 * accounting, and P&L. The bot as a whole is modeled as a set of sleeves;
 * the top-level controller allocates capital between them instead of
 * hard-coding sector rules.
 *
 * See NVR-SPEC-010 for the full architecture.
 *
 * This file is SCAFFOLDING only — none of these types are wired into the
 * heavy cycle yet. Consumers import them from '@/core/sleeves'.
 */

// ============================================================================
// POSITION + DECISION
// ============================================================================

/**
 * A position owned by a specific sleeve. The same on-chain wallet may hold
 * positions belonging to multiple sleeves; virtual accounting tags each
 * holding with its owner sleeve.
 */
export interface SleevePosition {
  symbol: string;
  /** Token units (native decimals). */
  balance: number;
  /** Sum USD paid across entries into this position. */
  costBasisUSD: number;
  /** Current mark-to-market value in USD. Snapshot, not live. */
  valueUSD: number;
  /** ISO timestamp of the opening trade. */
  openedAt: string;
  /** Cycle number in which the position was opened. */
  openedInCycle: number;
}

export type SleeveAction = 'BUY' | 'SELL' | 'HOLD';

/**
 * A decision produced by a sleeve for this cycle. The bot's execution stage
 * is responsible for actually placing the trade; a decision is just intent.
 */
export interface SleeveDecision {
  action: SleeveAction;
  fromToken: string;
  toToken: string;
  /** Trade size in USD (not token units). */
  amountUSD: number;
  reasoning: string;
  /** 0-1. Used by the allocator to weight future capital. */
  confidence: number;
}

// ============================================================================
// CONTEXT
// ============================================================================

/**
 * Shared, read-only market context passed to every sleeve each cycle.
 * Populated once per heavy cycle by the orchestrator — sleeves should not
 * mutate this.
 *
 * v1 uses a loose shape; future revisions will narrow the types as the
 * sleeve integration stabilizes.
 */
export interface SharedMarketContext {
  /** Cycle number (monotonically increasing). */
  cycleNumber: number;
  /** ISO timestamp when the context was built. */
  builtAt: string;
  /** Symbol → current price in USD. */
  prices: Record<string, number>;
  /** Market regime tag (e.g. 'TRENDING_UP', 'RANGING'). */
  regime: string;
  /** Fear & greed index (0-100). */
  fearGreed: number;
  /** Anything the orchestrator wants to expose without typing it yet. */
  extras?: Record<string, unknown>;
}

/**
 * Per-cycle context handed to a single sleeve's `decide()` method. The
 * `positions` array is filtered to show ONLY the positions owned by this
 * sleeve — enforcing ownership at the call boundary.
 */
export interface SleeveContext {
  /** How much USD of capital this sleeve is entitled to deploy this cycle. */
  capitalBudgetUSD: number;
  /** Positions owned by this sleeve only. */
  positions: SleevePosition[];
  /** USDC available to this sleeve right now (budget minus already-deployed). */
  availableUSDC: number;
  /** Shared read-only market context. */
  market: SharedMarketContext;
}

// ============================================================================
// SLEEVE INTERFACE
// ============================================================================

/**
 * Where this sleeve is in its lifecycle.
 *   - 'paper': runs every cycle but decisions never execute. Tracked by
 *     Research Lab alongside the live sleeves.
 *   - 'live':  decisions execute against real capital.
 */
export type SleeveMode = 'paper' | 'live';

/**
 * A sleeve is a strategy encapsulated behind a minimal interface.
 *
 * Rules for implementors:
 *   1. `decide()` must be pure with respect to state — no I/O side effects
 *      that the orchestrator doesn't know about. Only return intent.
 *   2. Ownership is enforced by the context: never act on positions outside
 *      `ctx.positions`.
 *   3. Respect `ctx.capitalBudgetUSD` as a hard cap. Do not exceed it.
 *   4. `getStats()` must be cheap — the dashboard polls this frequently.
 */
export interface Sleeve {
  readonly id: string;                 // 'core', 'alpha-v1', etc.
  readonly displayName: string;        // 'Core Strategy', 'Alpha Engine'
  readonly mode: SleeveMode;
  /** Capital allocation floor. Prevents a sleeve from being fully starved. */
  readonly minCapitalPct: number;      // 0.01 = 1%
  /** Capital allocation ceiling. Prevents any single sleeve from dominating. */
  readonly maxCapitalPct: number;      // 0.20 = 20%

  /** Produce this cycle's intended trades. */
  decide(ctx: SleeveContext): Promise<SleeveDecision[]>;

  /** Snapshot of sleeve performance. Read-heavy; must stay O(1) vs. history. */
  getStats(): SleeveStats;
}

// ============================================================================
// STATS
// ============================================================================

/**
 * Performance snapshot for a sleeve. Produced by `getStats()` and surfaced
 * on the dashboard + used by the capital allocator.
 */
export interface SleeveStats {
  realizedPnLUSD: number;
  unrealizedPnLUSD: number;
  trades: number;
  /** 0-100. */
  winRate: number;
  /** Rolling 7-day Sharpe. null if the sleeve has <7d of history. */
  rollingSharpe7d: number | null;
  /** ISO timestamp of the most recent decision (any action, including HOLD). */
  lastDecisionAt: string | null;
}

// ============================================================================
// ALLOCATOR
// ============================================================================

/**
 * Computes a target capital allocation between sleeves. The allocator runs
 * every cycle but may choose to hold prior weights (see `rebalanceHours`).
 */
export interface CapitalAllocator {
  /**
   * Returns a weight map `{ sleeveId: pctOfCapital }`. The sum MAY be less
   * than 1.0 — the remainder is held as USDC reserve, not assigned to any
   * sleeve.
   */
  computeWeights(sleeves: Sleeve[]): Record<string, number>;
}
