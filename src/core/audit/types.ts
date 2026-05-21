/**
 * NVR-SPEC-035 System Auditor — shared types
 *
 * The audit-of-audits layer. Runs at the end of every heavy cycle, asserts
 * a set of pure-function invariants over the bot's materialized state +
 * the LLM prompt that was about to be sent, and surfaces disagreements
 * between independent sources of truth.
 *
 * Phase A ships four SEVERE invariants:
 *   INV-1 dimensional honesty   — sum of positions ≈ totalPortfolioValue
 *   INV-2 no fictional per-token PnL — caps |realizedPnL| per token
 *   INV-3 prompt coherence       — the prompt's stated numbers agree with state
 *   INV-9 auditor self-test      — the auditor itself ran last cycle
 *
 * Phase B adds the WARN tier (INV-4 through INV-8). Phase C adds opt-in
 * auto-correction. Phase D adds the admin cockpit surface.
 *
 * Severity routing per Henry's 2026-05-19 ratification: path-specific
 * pause on SEVERE (INV-1 → pause new buys, INV-2 → pause new buys for
 * affected tokens only, INV-3 → pause next LLM-driven decision only).
 */

// ============================================================================
// SEVERITY + SCOPE
// ============================================================================

export type Severity = 'INFO' | 'WARN' | 'SEVERE';

/**
 * The granularity of a pause when a SEVERE invariant trips.
 *
 * - `none`        — no pause; for INFO/WARN
 * - `all-buys`    — every BUY decision pauses; rebalances + sells allowed
 * - `per-token-buys` — BUYs of `affectedTokens` pause; everything else allowed
 * - `next-llm`    — the next LLM-driven decision is short-circuited to HOLD;
 *                    deterministic gates (force-sells, breaker exits) keep working
 */
export type PauseScope = 'none' | 'all-buys' | 'per-token-buys' | 'next-llm';

// ============================================================================
// THE LLM PROMPT CAPTURE
//
// Stashed by callers right before they hit the Anthropic API; consumed by
// INV-3 the next time the auditor runs. Living on `state.audit.lastPrompt`
// keeps it queryable + persistable without growing the trade-history blob.
// ============================================================================

export interface CapturedPrompt {
  /** ISO timestamp of when the prompt was captured (pre-send). */
  capturedAt: string;
  /** Cycle the capture happened in. */
  cycle: number;
  /** The full prompt text the model was about to receive. */
  text: string;
  /** Portfolio value the caller believed at capture time. INV-3 checks this against state. */
  portfolioValueClaimed: number;
  /** Model that was about to be called (haiku|sonnet|gemma|...). */
  modelLabel: string;
  /** Approximate token count of the captured text. */
  approxTokens: number;
}

// ============================================================================
// VIOLATION + REPORT
// ============================================================================

export interface Violation {
  /** Stable invariant identifier — e.g. "INV-1". */
  invariantId: string;
  /** Short human-readable invariant name. */
  invariantName: string;
  severity: Severity;
  /** One-sentence description of what failed. */
  message: string;
  /** What the auditor observed, as a structured payload. */
  observed: Record<string, unknown>;
  /** What the auditor expected, as a structured payload. */
  expected: Record<string, unknown>;
  /** The pause scope this violation should trigger if severity is SEVERE. */
  pauseScope: PauseScope;
  /** For per-token pauses: which tokens are affected. */
  affectedTokens?: string[];
  /** ISO timestamp of when the violation was detected. */
  detectedAt: string;
}

export interface AuditReport {
  cycle: number;
  ranAt: string;
  durationMs: number;
  violations: Violation[];
  /** True if this report or its predecessor flipped systemHealthBlocker active. */
  blockerActive: boolean;
  /** The auditor's current alert mode at this run. */
  alertMode: AuditorMode;
}

// ============================================================================
// SYSTEM HEALTH BLOCKER
//
// Persisted on AgentState. Read by the trade-execution gate to refuse
// affected decisions. Cleared by either:
//   (a) a subsequent clean auditor cycle on the same invariant, OR
//   (b) explicit human/operator action (admin endpoint).
//
// Per Henry's ratification (2026-05-19): pause is PATH-SPECIFIC — the
// blocker carries `pauseScope` + `affectedTokens` so deterministic gates
// and rebalances stay alive even while LLM-driven new entries pause.
// ============================================================================

export interface SystemHealthBlocker {
  /** True when at least one SEVERE violation is active and unresolved. */
  active: boolean;
  /** The invariant that set the most recent active blocker. */
  invariantId: string;
  /** The scope of the pause. */
  pauseScope: PauseScope;
  /** For per-token-buys scope: which tokens are blocked. */
  affectedTokens?: string[];
  /** Short reason for surfacing to logs + Telegram. */
  reason: string;
  /** When the blocker was first set. */
  setAt: string;
  /** When the blocker was last refreshed (most recent SEVERE detection). */
  lastObservedAt: string;
  /** How many consecutive cycles the blocker has been active. */
  consecutiveCycles: number;
  /** ISO timestamp the auditor's alert mode will flip from log-only → alert. */
  alertModeFlipAt?: string;
}

// ============================================================================
// AUDITOR MODE
//
// `log-only` is the first-run default per Henry's ratification: Phase A
// will fire SEVERE immediately on TOSHI's -$2.3M, and we want 24h of clean
// signal before Telegram starts firing.
// ============================================================================

export type AuditorMode = 'log-only' | 'alert' | 'disabled';

// ============================================================================
// INVARIANT INTERFACE
//
// Every invariant is a pure function: given the audit context, return
// either a violation or null. No side effects. No state mutations.
// The orchestrator collects results + routes severity.
// ============================================================================

export interface InvariantContext {
  /** The most recent populated balances (from state.trading.balances). */
  balances: Array<{
    symbol: string;
    balance: number;
    usdValue: number;
    price?: number;
    /** Sector tag from TOKEN_REGISTRY ('BLUE_CHIP'/'AI_TOKENS'/'YIELD'/etc.). */
    sector?: string;
  }>;
  /** The scalar totalPortfolioValue from state.trading.totalPortfolioValue. */
  totalPortfolioValue: number;
  /** The bot's in-state cost-basis registry. */
  costBasis: Record<string, {
    symbol: string;
    realizedPnL: number;
    totalInvestedUSD: number;
    totalTokensAcquired: number;
    averageCostBasis: number;
    currentHolding: number;
  }>;
  /** Last-known prices indexed by symbol (used for cross-source position-value sum). */
  lastKnownPrices: Record<string, { price: number }>;
  /** The most recent captured prompt (or null if none captured this cycle). */
  capturedPrompt: CapturedPrompt | null;
  /** The BOT's current cycle counter (state.totalCycles — persists across restarts). */
  cycle: number;
  /** Most recent auditor report (or null on first run); used by INV-9. */
  previousReport: AuditReport | null;
  /**
   * The AUDITOR's own cycle count — how many times runSystemAuditor() has
   * completed since this module was loaded. Critical for INV-9: a fresh
   * boot has auditorCyclesRun=0 but the bot's `cycle` may be any value
   * (totalCycles persists across restarts), so this is the only reliable
   * signal that the auditor itself is on its first run.
   */
  auditorCyclesRun: number;
  /**
   * Phase A.1 — Source D for INV-10. Direct on-chain wallet poll, fresh
   * within ~30 minutes. Null if the caller didn't refresh this cycle (the
   * poll is RPC-expensive so it's run every N cycles, not every cycle).
   * INV-10 returns null when this is null — the orchestrator's per-cycle
   * proof-of-life line still fires so silence is detectable via INV-9.
   */
  liveOnChainSnapshot: import('./sources/live-onchain.js').LiveOnChainSnapshot | null;
  /**
   * Phase A.1 — chain-deposit history for INV-11. Sum of all non-router
   * USDC inflows to the bot wallet across full chain history. Refreshed
   * once per day (deposit events are rare). Null when not yet captured
   * or when the caller deliberately skipped a refresh.
   */
  chainDepositHistory: import('./sources/chain-deposit-history.js').ChainDepositHistory | null;
  /**
   * Phase A.1 — INV-11 input. The bot's reported lifetime deposit total
   * (from state.totalDeposited). INV-11 compares this against
   * chainDepositHistory.totalDepositedUsd to catch wallet-rotation-amnesia
   * and other deposit-tracking drift.
   */
  botTotalDeposited: number | null;
  /**
   * Phase B — INV-7 input. Per-sleeve liveness snapshot, derived from
   * sleeveRegistry.sleeves() + their stats. INV-7 fires when a live sleeve
   * goes too long without rendering a decision (paper sleeves and
   * never-decided sleeves are skipped).
   *
   * Optional — when undefined, INV-7 returns null (caller didn't populate
   * this cycle). When set, every entry should be live data for the current
   * cycle.
   */
  sleeveLiveness?: Array<{
    id: string;
    mode: string;
    lastDecisionAt: string | null;
    decisionsCount: number;
  }>;
  /**
   * Phase B — INV-4 input. Per-observation records the agent ingests from
   * external sources (stc-website auto-investigation pipeline, alpha-watcher
   * feeds, future research-lab emissions, etc.). INV-4 fires WARN when any
   * record violates the consumer-shape contract (`schemaValid === false`)
   * OR when a majority of records have empty/null observation content.
   *
   * Optional — when undefined or empty, INV-4 returns null. The agent call
   * site doesn't have to populate this until Phase C wires the actual
   * observation pipeline.
   */
  observations?: Array<{
    source: string;
    observation: string | null;
    receivedAt: string;
    schemaValid: boolean;
  }>;
  /**
   * Phase B — INV-8 input. Count of trades the bot has successfully
   * executed since this process booted. Computed at the call site as
   * `state.trading.totalTrades - state._tradesAtBoot`, where
   * `_tradesAtBoot` is captured once at startup right after the persisted
   * trade history is loaded. Optional — when undefined, INV-8 stays silent.
   */
  tradesSinceRestart?: number;
}

export type Invariant = (ctx: InvariantContext) => Violation | null;
