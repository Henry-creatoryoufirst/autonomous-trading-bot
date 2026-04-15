/**
 * Never Rest Capital — Harvest / Profit-Taking / Stop-Loss Types
 *
 * Phase 1 of the monolith refactor. Defines the contract for
 * `src/core/portfolio/harvest-manager.ts` (Phase 4). The core principle:
 * harvest logic returns an **instruction list** (what to sell, at what tier,
 * with what state mutations pending) — the caller applies those instructions
 * via StateManager. This makes harvest pure-ish and testable in isolation.
 *
 * Replaces the current pattern where `checkProfitTaking()` and `checkStopLoss()`
 * in agent-v3.2.ts mutate `state.profitTakeCooldowns`, `state.costBasis`,
 * `state.harvestedProfits`, etc. inline.
 */
import type { TradeDecision } from './market-data.js';
import type { TokenCostBasis } from './index.js';

// ============================================================================
// HARVEST TIERS & TRIGGERS
// ============================================================================

/**
 * Named tiers the profit-harvester uses to decide when/how much to sell.
 * Tier labels are strings so the telemetry/Telegram reports stay readable.
 * Values come from CONFIG.trading.profitTaking.tiers in agent-v3.2.ts.
 */
export type HarvestTierLabel =
  | 'EARLY'            // 12% gain → sell 12%
  | 'MID'              // 30% gain → sell 18%
  | 'STRONG'           // 75% gain → sell 25%
  | 'MAJOR_HARVEST'    // 150% gain → sell 35%
  | 'TIME_REBALANCE';  // 72h held + 8% gain → sell 10%

/** What triggered this harvest decision. */
export type HarvestTrigger =
  | 'PROFIT_TIER'      // Position crossed a gain threshold
  | 'TIME_REBALANCE'   // Held long enough + has gain → trim
  | 'TRAILING_STOP'    // Peak-to-now drop exceeded trail %
  | 'COST_BASIS_STOP'  // Entry-to-now loss exceeded stop %
  | 'ATR_STOP'         // ATR-adjusted stop fired
  | 'SECTOR_STOP'      // Sector-specific tightened stop
  | 'ICU_STOP'         // ICU mode stricter stop
  | 'ICU_FORCE_EXIT';  // Any-loss ICU override

/** What bucket of logic produced this decision. */
export type HarvestKind = 'PROFIT_TAKE' | 'STOP_LOSS';

// ============================================================================
// HARVEST DECISION — one recommended sell per call
// ============================================================================

/**
 * A single recommended sell action. The caller converts this into a
 * TradeDecision and executes it, then applies the embedded mutations via
 * StateManager.
 */
export interface HarvestDecision {
  kind: HarvestKind;
  trigger: HarvestTrigger;
  tier?: HarvestTierLabel;       // Only set for PROFIT_TAKE kind

  // ---- What to sell ----
  symbol: string;
  sellPercent: number;           // 0–100, what fraction of holding to sell
  reasoning: string;             // Human-readable for logs / Telegram

  // ---- Decision context at time of firing ----
  currentPrice: number;
  averageCostBasis: number;
  gainPercent: number;           // Positive = profit, negative = loss
  holdingDurationMs: number;
  positionValueUSD: number;

  // ---- Mutations the caller must apply after executing the sell ----
  mutations: HarvestMutations;
}

/**
 * State mutations that accompany a harvest decision. These are NOT applied
 * inside harvest-manager — the caller (cycle execution stage) applies them
 * via StateManager after the sell actually executes. This separation lets
 * us diff "what harvest wanted to change" vs "what actually changed" for
 * debugging, and makes the harvest logic pure for testing.
 */
export interface HarvestMutations {
  /** Keys are "symbol:tierLabel"; values are ISO timestamps. */
  cooldownSet?: Record<string, string>;
  /** Partial updates to costBasis entries — merged into existing entries. */
  costBasisUpdates?: Record<string, Partial<TokenCostBasis>>;
  /** A single entry appended to state.harvestedProfits.harvests[]. */
  harvestRecord?: {
    timestamp: string;
    symbol: string;
    tier: string;
    gainPercent: number;
    sellPercent: number;
    amountUSD: number;
    profitUSD: number;
  };
  /** A single entry appended to state.sanityAlerts[] (stale cost-basis detection). */
  sanityAlert?: {
    timestamp: string;
    symbol: string;
    type: string;
    oldCostBasis: number;
    currentPrice: number;
    gainPercent: number;
    action: string;
  };
}

// ============================================================================
// HARVEST RESULT — what the manager returned for this cycle
// ============================================================================

/**
 * The full output of a harvest evaluation call. Contains zero or more
 * decisions ready to become TradeDecisions, plus any "no-action" reasons
 * useful for logging why nothing fired.
 */
export interface HarvestResult {
  decisions: HarvestDecision[];

  /** Symbols that were evaluated but blocked, and why. */
  blocked: Array<{
    symbol: string;
    reason:
      | 'COOLDOWN_ACTIVE'
      | 'BELOW_CAPITAL_FLOOR'
      | 'LET_WINNERS_RUN'        // Buy ratio high + MACD bullish
      | 'FORCED_BUY_GRACE'       // Recent FORCED_DEPLOY / SCOUT buy
      | 'NO_COST_BASIS'
      | 'INSUFFICIENT_GAIN'
      | 'INSUFFICIENT_LOSS';
    detail?: string;
  }>;

  /** Informational metrics for the current evaluation. */
  meta: {
    symbolsEvaluated: number;
    triggersFired: number;
    evaluatedAt: string;         // ISO
  };
}

// ============================================================================
// HARVEST CONFIG — tunable thresholds (passed in from CONFIG at cycle start)
// ============================================================================

export interface ProfitTakingConfig {
  tiers: Array<{
    gainPercent: number;
    sellPercent: number;
    label: HarvestTierLabel;
  }>;
  cooldownHoursPerTier: number;
  minTradingCapitalUSD: number;
  letWinnersRunBuyRatio: number;  // Block harvest if buy ratio > this (except MAJOR_HARVEST)
}

export interface StopLossConfig {
  baseStopPercent: number;         // Flat fallback when no ATR data
  trailingStopPercent: number;     // Peak-to-now tolerance
  cooldownHours: number;           // Block re-eval after stop fires
  forcedBuyGraceMinutes: number;   // Protect fresh forced-deploy/scout positions
  icuStopPercent: number;          // Stricter stop during ICU mode
  sectorOverrides: Record<string, number>;  // Sector → tighter stop %
}

export interface HarvestConfig {
  profitTaking: ProfitTakingConfig;
  stopLoss: StopLossConfig;
}
