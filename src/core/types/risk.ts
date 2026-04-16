/**
 * Never Rest Capital — Risk Management Types
 *
 * Phase 1 of the monolith refactor. Defines the contract for the
 * `src/core/risk/` modules built in Phase 3:
 *   - CircuitBreaker (centralizes the 70 scattered breakerState mutations)
 *   - PreservationMode (state machine for high-fear capital preservation)
 *
 * Like harvest, risk modules return decisions + pending mutations rather
 * than mutating state inline. This keeps them pure-ish and testable.
 */
import type { BreakerState } from './state.js';

// ============================================================================
// CIRCUIT BREAKER — trigger reasons + decision output
// ============================================================================

/** Why the circuit breaker fired (for telemetry + Telegram + SHI diagnosis). */
export type BreakerTriggerReason =
  | 'CONSECUTIVE_LOSSES'       // N losing trades in a row
  | 'ROLLING_LOSS_RATE'        // Rolling window loss % exceeded
  | 'DAILY_DRAWDOWN'           // Daily baseline drop > threshold
  | 'WEEKLY_DRAWDOWN'          // Weekly baseline drop > threshold
  | 'CAPITAL_FLOOR_BREACH'     // Portfolio fell below absolute $ floor
  | 'EMERGENCY_EXIT'           // Hard exit — position down > 50% or 10+ failures
  | 'MANUAL_HALT'              // Operator-initiated halt
  | 'HEALING_ESCALATION';      // SHI escalated a recurring incident

/** What level of risk intervention this cycle needs. */
export type BreakerSeverity =
  | 'NONE'                     // Normal operation, full position sizing
  | 'CAUTION'                  // Reduce size (e.g., 50%), keep trading
  | 'PAUSED'                   // No new trades for N hours
  | 'HARD_HALT';               // Emergency exits only, no new entries

/**
 * Output of a single breaker evaluation. Cycle stage reads this to decide
 * whether to proceed with trade decisions.
 */
export interface BreakerDecision {
  severity: BreakerSeverity;
  active: boolean;                         // true if severity != NONE
  triggerReason?: BreakerTriggerReason;    // Why we're not at NONE
  message: string;                         // Human-readable; surfaces in logs/Telegram

  /** Position size multiplier to apply this cycle (0–1). */
  sizeMultiplier: number;

  /** If paused: when the pause expires (ISO). */
  pauseUntil?: string;

  /** If in caution mode: when size reduction expires (ISO). */
  sizeReductionUntil?: string;

  /** Mutations the caller applies via StateManager. */
  mutations: BreakerMutations;
}

/**
 * Breaker-related state mutations. Applied by the caller via StateManager.
 */
export interface BreakerMutations {
  /** Full breaker-state replacement (used when triggering or resetting). */
  breakerStateReplace?: Partial<BreakerState>;
  /** Append-only rolling trade result (true = win, false = loss). */
  rollingResultAppend?: boolean;
  /** Consecutive loss counter delta (positive = loss, negative reset = 0). */
  consecutiveLossDelta?: number;
}

// ============================================================================
// CAPITAL PRESERVATION MODE — Fear & Greed-gated state machine
// ============================================================================

/**
 * Modes the capital-preservation state machine can be in.
 * Historically activated during extreme fear; v20.8+ keeps it info-only
 * unless SHI or operator flips it on explicitly.
 */
export type PreservationModeLabel =
  | 'INACTIVE'                 // Normal trading, no preservation overlay
  | 'CAUTION'                  // Sustained low F&G, sizing down but trading
  | 'ACTIVE'                   // Extreme fear, 50% size reduction + block weak buys
  | 'DISABLED';                // Operator-forced off (v20.8+ default)

export interface PreservationMode {
  label: PreservationModeLabel;
  activatedAt: string | null;  // ISO, when current mode took effect
  fearGreedValue: number;      // F&G that drove the current mode

  /** Position-size multiplier to apply this cycle (1.0 = normal). */
  positionSizeMultiplier: number;

  /** Minimum confluence score required for BUY decisions (higher = stricter). */
  minConfluenceForBuy: number;

  /** Minimum swarm consensus % for BUY decisions. */
  minSwarmConsensusForBuy: number;

  /** Cycle interval multiplier (>1 slows cycles during fear). */
  cycleIntervalMultiplier: number;

  /** Metrics for telemetry / Telegram. */
  metrics: {
    tradesBlocked: number;
    tradesSizedDown: number;
    enteredFromRegime: string;  // e.g., "RANGING", "BEAR"
  };
}

// ============================================================================
// RISK CONTEXT — snapshot of risk state passed into cycle stages
// ============================================================================

/**
 * The risk read-only view that cycle stages consume. Produced by the
 * CircuitBreaker + PreservationMode modules at the start of each cycle
 * and passed through `CycleContext` so downstream stages don't need to
 * re-evaluate.
 */
export interface RiskContext {
  breaker: BreakerDecision;
  preservation: PreservationMode;

  /** True if either breaker OR preservation is telling us to back off. */
  isDerisked: boolean;

  /** Effective size multiplier = min(breaker.sizeMultiplier, preservation.positionSizeMultiplier). */
  effectiveSizeMultiplier: number;

  /** Effective minimum confluence = max of any active floor. */
  effectiveMinConfluence: number;
}

// ============================================================================
// BREAKER THRESHOLDS CONFIG — tunables pulled from constants
// ============================================================================

export interface BreakerConfig {
  consecutiveLossLimit: number;           // e.g., 3
  rollingWindowSize: number;              // e.g., 8
  rollingLossThreshold: number;           // e.g., 5 (out of rollingWindowSize)
  pauseHours: number;                     // How long to pause after trigger
  sizeReductionPercent: number;           // e.g., 0.5 (50% size reduction)
  sizeReductionHours: number;             // Duration of reduction after pause
  dailyDrawdownPercent: number;           // Trigger at this daily drop
  weeklyDrawdownPercent: number;          // Trigger at this weekly drop
  capitalFloorUSD: number;                // Absolute USD minimum
  capitalFloorPercentOfPeak: number;      // e.g., 0.6 (60% of peak)
  emergencyExitLossPercent: number;       // e.g., -0.5 (-50% from cost)
  emergencyExitFailureCount: number;      // e.g., 10 execution failures
}

export interface PreservationConfig {
  activationFearGreed: number;            // e.g., 12 (extreme fear)
  deactivationFearGreed: number;          // e.g., 20
  ringBufferSize: number;                 // e.g., 36 (6h at 10min cycles)
  minSustainedReadings: number;           // Readings below threshold before activating
  sizeMultiplier: number;                 // e.g., 0.5
  minConfluence: number;                  // e.g., 25
  minSwarmConsensus: number;              // e.g., 50
  cycleIntervalMultiplier: number;        // e.g., 1.0 (v19.3.2+: no slowdown)
  targetCashPercent: number;              // e.g., 50
  forceDisabled: boolean;                 // v20.8+: true (operator-forced off)
}

export interface RiskConfig {
  breaker: BreakerConfig;
  preservation: PreservationConfig;
}
