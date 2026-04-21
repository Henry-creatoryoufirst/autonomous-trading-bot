/**
 * NVR Capital — Capital Sleeves: State types for per-sleeve accounting.
 *
 * v21.15 Phase 1.2a: the balance-sheet shape for each sleeve. Every sleeve
 * tracks its own positions, realized P&L, decision log, and regime-conditioned
 * returns — so graduation (paper → live) is grounded in evidence, not opinion.
 *
 * Paired with Phase 1.2b which wires these into the orchestrator + execution
 * path. This file is intentionally pure types — no runtime behavior, no
 * imports from agent-v3.2.ts — so it can be consumed by state persistence,
 * tests, and the sleeves module without circular dependencies.
 *
 * See NVR-SPEC-010 (sleeve architecture), NVR-SPEC-016 (graduation criteria),
 * and the 2026-04-21 session note (vision-vs-code alignment). Operationalizes
 * the principles:
 *   - "Pulling profits is the edge, not picking winners"
 *   - "Dashboards must not lie"
 */

import type { SleevePosition } from './types.js';

/**
 * How a decision was generated and whether it touched capital.
 *   - 'live':   sleeve mode='live', decision executed against real capital
 *   - 'paper':  sleeve mode='paper', decision recorded but not executed
 *   - 'shadow': sleeve has 0% allocation this cycle (or is kill-switched);
 *               we still record its would-have-done decision for track-record
 *               purposes, so graduation reads evidence not opinion
 */
export type SleeveDecisionMode = 'live' | 'paper' | 'shadow';

/**
 * A single decision log entry. Every registered sleeve emits one per heavy
 * cycle — HOLD counts as a decision so we see the full series. Capped per
 * sleeve (MAX_DECISIONS_PER_SLEEVE) to bound state-file size.
 */
export interface SleeveDecisionLog {
  cycle: number;
  timestamp: string;
  action: 'BUY' | 'SELL' | 'HOLD' | 'REBALANCE';
  symbol: string;
  amountUSD?: number;
  mode: SleeveDecisionMode;
  /** True iff the decision resulted in an on-chain trade. Paper/shadow/HOLD stay false. */
  executed: boolean;
  /** Truncated to 200 chars to bound log size. Full reasoning lives in TradeRecord. */
  reasoning?: string;
  /**
   * Signal source tag — "confluence-score", "hunter-conviction",
   * "rotation-detector", "stale-exit", "drawdown-override", etc. Enables
   * post-mortem of which signals actually earn their keep, per sleeve.
   */
  attribution?: string;
  /** Regime tag at decision time, for regime-conditional performance tracking. */
  regime?: string;
  /** On-chain tx hash for live executed trades. */
  txHash?: string;
  /** Only populated for live SELLs with a scored P&L. */
  realizedPnL?: number;
}

/**
 * Rolling per-regime daily returns. Feeds the dashboard's regime-conditional
 * view ("Alpha Hunter +12% in chop, -4% in trend") and the eventual dynamic
 * allocator that tilts weight by regime.
 *
 * Bucketed by regime tag active on each day. Length bounded by
 * MAX_REGIME_SAMPLES to keep state files tractable.
 */
export interface SleeveRegimeReturns {
  [regime: string]: {
    dailyReturnsUSD: number[];
    totalReturnUSD: number;
    /** Number of daily samples in this regime bucket. */
    samples: number;
  };
}

/**
 * Per-sleeve balance sheet. One entry per registered sleeve in AgentState.
 *
 * For sleeves at 0% allocation (paper or kill-switched), `positions` stays
 * empty — the sleeve only accumulates `decisions` as a shadow track record
 * until it graduates.
 */
export interface SleeveOwnership {
  /**
   * Positions this sleeve owns, keyed by symbol. Cost basis is sleeve-local:
   * two sleeves may hold the same symbol with different cost bases. Phase 1.2
   * migration assigns all existing bot positions to the 'core' sleeve so the
   * sum matches the bot's global costBasis on day 1.
   */
  positions: Record<string, SleevePosition>;
  /** Cumulative realized P&L from this sleeve's closed trades. */
  realizedPnLUSD: number;
  /** Count of actionable (successful BUY/SELL) trades this sleeve has executed. */
  trades: number;
  /** Wins among scored SELLs (realizedPnL > 0). Used for win rate. */
  wins: number;
  /**
   * Daily realized P&L for this sleeve, feeding rolling-Sharpe computation.
   * Same shape as state.dailyPayouts but scoped per sleeve.
   */
  dailyPayouts: Array<{ date: string; realizedPnL: number }>;
  /** Regime-conditional performance — see SleeveRegimeReturns. */
  regimeReturns: SleeveRegimeReturns;
  /** Rolling window of decision-log entries. Capped by MAX_DECISIONS_PER_SLEEVE. */
  decisions: SleeveDecisionLog[];
  /** ISO timestamp of most recent decision (any action, including HOLD). */
  lastDecisionAt: string | null;
  /**
   * ISO timestamp when this ownership record was created. Used as the age
   * gate for graduation-eligibility calculations (SPEC-016 soak duration).
   */
  createdAt: string;
  /**
   * v21.17: high-water mark of the sleeve's total equity (cash + positions).
   * Updated on each mark-to-market pass. Feeds drawdownPct in the dashboard
   * compare surface so "Dashboards must not lie" holds: drawdown is a real
   * measured number, not a UI-side default.
   * Units: USD. Optional for backward compat with pre-v21.17 state files.
   */
  peakCapitalUSD?: number;
}

/**
 * Hot-reloadable sleeve configuration. Read each cycle by the orchestrator
 * so allocations, kill switches, and mode overrides can change without a
 * restart. Loaded from env var SLEEVE_CONFIG_JSON or, if absent, from the
 * last-known values persisted in AgentState.
 */
export interface SleeveConfig {
  /**
   * sleeveId -> target weight [0..1]. Sum must be ≤ 1.0; any shortfall is
   * held as USDC reserve (the 25% portfolio-wide floor still applies
   * regardless — that's the ONE hardcoded capital rule).
   */
  allocations: Record<string, number>;
  /**
   * sleeveId -> kill switch. When false, the sleeve's decide() is still
   * called so it keeps building a shadow track record, but all decisions
   * are coerced to mode='shadow' and never execute.
   */
  enabled: Record<string, boolean>;
  /**
   * sleeveId -> forced mode. 'paper' demotes a live sleeve back to paper
   * without redeploying; use for emergency demotion per SPEC-016.
   * When absent, the sleeve's declared mode wins.
   */
  modeOverrides: Record<string, 'paper' | 'live'>;
  /**
   * v21.16 Phase 2: virtual USD budget per paper sleeve.
   * Paper sleeves trade against this virtual pool (not their 0%
   * allocation) so they can build a real track record before graduating
   * to real capital. Default seed: $1000 per Alpha sleeve.
   * Only read when effectiveMode is 'paper' or 'shadow'; live sleeves
   * size against allocation × portfolio value instead.
   */
  paperBudgetsUSD: Record<string, number>;
  /**
   * v21.16 Phase 2: per-sleeve exit discipline overrides. Alpha sleeves
   * typically run tighter exits than Core (shorter max-hold, harder
   * drawdown cut). Undefined keeps the sleeve on Core's default rules.
   */
  exitOverrides?: Record<string, SleeveExitOverride>;
  /** ISO timestamp of the last config reload. */
  updatedAt: string;
}

/**
 * Per-sleeve exit discipline overrides. Each field is independent — leave
 * undefined to fall back to the sleeve's default (Core's rules).
 */
export interface SleeveExitOverride {
  /** Drawdown % that triggers forced exit (negative; e.g. -5 = -5%). */
  drawdownOverridePct?: number;
  /** Max hold duration in hours before forced stale-exit consideration. */
  maxHoldHours?: number;
  /** Min gain % under which a position is considered "played out" for stale-exit. */
  staleMaxGainPct?: number;
}

/** Bounded size of the per-sleeve decision log. Older entries are trimmed. */
export const MAX_DECISIONS_PER_SLEEVE = 500;

/** Bounded size of per-regime daily-returns history. */
export const MAX_REGIME_SAMPLES = 180;
