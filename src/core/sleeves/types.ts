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
 * Phase 1 (shipped v21.12.0): registry + stats, read-only, no decision wiring.
 * Phase 2 (in progress): sleeve.decide() becomes capable of producing the
 *   bot's primary trade decisions; orchestrator routes via a feature flag.
 */

import type { TradeDecision } from '../types/index.js';

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
 *
 * Aligned with `TradeDecision` so sleeve outputs flow directly into the
 * existing execution pipeline (adjustments + executeTrade) with no mapper.
 * Future allocator-weighting logic can read `signalContext.confluenceScore`
 * (already carried by TradeDecision) instead of a separate `confidence` field.
 */
export type SleeveDecision = TradeDecision;

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
  /**
   * v21.16 Phase 2: Discovery engine output. Ranked token candidates with
   * conviction scores that Alpha Hunter consumes to decide which meme/alt
   * swings are worth striking. Populated by the orchestrator from the
   * bot's existing token-discovery service.
   */
  discovery?: {
    candidates: DiscoveryCandidate[];
    /** ISO timestamp of the discovery scan. Stale scans → sleeves should hold. */
    scannedAt?: string;
  };
  /** Anything the orchestrator wants to expose without typing it yet. */
  extras?: Record<string, unknown>;
}

/**
 * A single token candidate surfaced by the discovery engine.
 * Shape is intentionally narrow — sleeves should depend on the minimum
 * fields necessary for their decision, not the full internal representation.
 */
export interface DiscoveryCandidate {
  symbol: string;
  /** 0-100 composite conviction score. */
  convictionScore: number;
  /** Sector tag (e.g. 'MEME', 'AI'). */
  sector?: string;
  /** Last observed USD price. Used by sleeves for sizing. */
  price?: number;
  /** 24h USD volume, if known. */
  volume24h?: number;
  /** 24h % price change, if known. */
  priceChange24h?: number;
  /** True when the discovery engine flagged this as an exceptional "runner". */
  isRunner?: boolean;
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
  /**
   * Escape hatch for the bot's heavy-cycle payload (balances, marketData,
   * sectorAllocations, cashDeployment, heavyCycleReason) passed through
   * without narrowing the type. Read by CoreSleeve's decideFn wrapper
   * around the legacy makeTradeDecision() path. Alpha sleeves should NOT
   * depend on this — they consume market.discovery and market.prices.
   */
  extras?: Record<string, unknown>;
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
