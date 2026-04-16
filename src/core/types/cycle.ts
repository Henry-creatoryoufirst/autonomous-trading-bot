/**
 * Never Rest Capital — Trading Cycle Types
 *
 * Phase 1 of the monolith refactor. These types define the boundary between
 * the cycle orchestrator and each cycle stage. The `CycleContext` is the
 * single parameter object that flows through every stage of the heavy cycle,
 * replacing the module-level closures that the monolith currently relies on.
 *
 * Every extracted cycle stage (src/core/cycle/stages/*) will have the signature:
 *   (ctx: CycleContext) => Promise<CycleContext>
 *
 * This is the foundation that Phase 5 (cycle engine extraction) consumes.
 */
import type { AgentState, BreakerState, CashDeploymentResult } from './state.js';
import type { MarketData, TradeDecision } from './market-data.js';
import type { TradeRecord, SectorAllocation } from './index.js';

// ============================================================================
// CYCLE STAGE ENUM — identifies each step in the heavy cycle pipeline
// ============================================================================

/**
 * Named stages of the heavy trading cycle, in execution order.
 * Mirrors the 20 sections documented in the monolith audit.
 */
export type CycleStage =
  | 'SETUP'              // Fetch balances, market data, signal intel, macro regime
  | 'INTELLIGENCE'       // Volume spikes, DEX intelligence, flow recording
  | 'PERF_REVIEW'        // Performance review + pattern analysis + threshold adapt
  | 'VALUATION'          // Portfolio valuation + phantom detection + capital flows
  | 'RISK_CONTROLS'      // Peak/drawdown tracking + circuit breaker check
  | 'METRICS'            // Dashboard metrics computation (sectors, PnL, R/R)
  | 'DUST_CLEANUP'       // Auto-sell micro positions
  | 'STALE_CULLING'      // Cull stale research positions
  | 'DRY_POWDER'         // Maintain USDC reserve ≥ 10% of portfolio
  | 'EMERGENCY_EXIT'     // Hard circuit breaker — force liquidate worst positions
  | 'DEPLOYMENT_CTX'     // Compute cash deployment context for AI
  | 'AI_DECISION'        // Call Claude / cheap model for trade decisions
  | 'PRESERVATION'       // Capital preservation filter during high fear
  | 'DIRECTIVES'         // User directive enforcement (sells from instructions)
  | 'TRADE_CAP'          // Per-cycle trade cap guard (regime-aware)
  | 'RISK_REWARD'        // R:R filter on BUY decisions
  | 'EXECUTION'          // Trade execution loop (heaviest mutation zone)
  | 'REPORTING'          // State persistence + Telegram reports
  | 'SCHEDULING';        // Cycle summary + next-cycle scheduling

/** Light-cycle stages (early-return path). Much shorter than heavy cycle. */
export type LightCycleStage = 'LIGHT_SETUP' | 'LIGHT_INTERVAL_UPDATE' | 'LIGHT_RETURN';

// ============================================================================
// CYCLE TRIGGER / RESULT — outcomes and why we're running this cycle
// ============================================================================

/** How this cycle was triggered (for telemetry and stage branching). */
export type CycleTrigger =
  | 'SCHEDULED'          // Normal adaptive timer fired
  | 'HOT_MOVER_URGENT'   // Breakout detected, compressed to 90s
  | 'FORCED_HEAVY'       // Explicit heavy-cycle request
  | 'STARTUP'            // First cycle after boot
  | 'MANUAL';            // Triggered via admin API

export type CycleOutcome = 'COMPLETED' | 'HALTED' | 'TIMED_OUT' | 'ERRORED';

export interface CycleResult {
  cycleNumber: number;
  isHeavy: boolean;
  startedAt: string;         // ISO
  completedAt: string;       // ISO
  durationMs: number;
  outcome: CycleOutcome;
  lastStageCompleted: CycleStage | LightCycleStage;
  decisionsGenerated: number;
  tradesExecuted: number;
  tradesSucceeded: number;
  errorMessage?: string;
}

// ============================================================================
// CYCLE CONTEXT — the single parameter threaded through every stage
// ============================================================================

/**
 * Service handles injected into every cycle — replaces module-level singletons.
 * Phase 6 (multi-tenant factory) populates these per-bot; Phase 2 (StateManager)
 * shims them from the current singletons.
 */
export interface CycleServices {
  /** State mutation surface (Phase 2). */
  stateManager: StateManagerHandle;
  /** Telegram alerts — currently a singleton; wrapped in tenant router in Phase 6. */
  telegram: TelegramHandle;
  /** Cache manager — per-bot after Phase 6. */
  cache: CacheHandle;
  /** Per-token cooldown manager — per-bot after Phase 6. */
  cooldown: CooldownHandle;
  /** Optional: Self-Healing Intelligence for incident reporting. */
  shi?: SelfHealingHandle;
}

/**
 * Minimal state-manager interface (Phase 2 implements this).
 * Stage files import this, not the concrete `StateManager` class, to avoid
 * circular deps during the extraction.
 */
export interface StateManagerHandle {
  getState(): AgentState;
  getBreakerState(): BreakerState;
  markDirty(force?: boolean): void;
}

/** Telegram handle — just the surface stages need. */
export interface TelegramHandle {
  sendAlert(alert: {
    severity: 'CRITICAL' | 'HIGH' | 'INFO';
    title: string;
    message: string;
    data?: Record<string, string | number | boolean>;
  }): Promise<boolean>;
  onCircuitBreakerTriggered(reason: string, portfolioValue: number): Promise<void>;
  onTradeResult(success: boolean, details?: { token?: string; error?: string; action?: string }): Promise<void>;
}

/** Cache handle — just the surface stages need. */
export interface CacheHandle {
  invalidate(key: string): void;
  getStats(): { hits: number; misses: number; hitRate: number };
}

/** Cooldown handle — just the surface stages need. */
export interface CooldownHandle {
  getActiveCount(): number;
  setRawCooldown(symbol: string, durationMs: number): void;
}

/** SHI handle — minimal surface for cycle stages to report incidents. */
export interface SelfHealingHandle {
  processIncident(type: string, context: Record<string, unknown>): Promise<void>;
}

/**
 * The single parameter passed through every cycle stage.
 *
 * Stages MUST NOT close over module-level variables — everything they need
 * is reachable from `ctx`. This enables per-bot isolation (Phase 6) and
 * testable stages (Phase 7).
 *
 * Stages MAY mutate fields on `ctx` (e.g., append to `decisions`, update
 * `balances` after a trade) — downstream stages see those mutations. But
 * state mutations MUST go through `ctx.services.stateManager` methods, not
 * direct `state.foo = bar` writes.
 */
export interface CycleContext {
  // ---- Cycle identity ----
  cycleNumber: number;
  isHeavy: boolean;
  trigger: CycleTrigger;
  startedAt: number;         // epoch ms (not ISO — cycle duration math)

  // ---- Market snapshot (populated by SETUP stage) ----
  marketData?: MarketData;
  balances: AgentState['trading']['balances'];
  currentPrices: Record<string, number>;

  // ---- DEPLOYMENT_CTX stage outputs (consumed by AI_DECISION) ----
  /** Computed by DEPLOYMENT_CTX stage; optional until that stage runs. */
  sectorAllocations?: SectorAllocation[];
  /** Cash deployment context computed by DEPLOYMENT_CTX; optional until that stage runs. */
  deploymentCheck?: CashDeploymentResult;

  // ---- Decisions pipeline (populated by AI_DECISION, mutated by filters) ----
  decisions: TradeDecision[];

  // ---- Execution outcomes (populated by EXECUTION stage) ----
  tradeResults: Array<{
    decision: TradeDecision;
    success: boolean;
    record?: TradeRecord;
    error?: string;
  }>;

  // ---- Flow control ----
  /** When true, subsequent stages skip execution (e.g., circuit breaker hard-halted). */
  halted: boolean;
  haltReason?: string;

  // ---- Services (dependency-injected) ----
  services: CycleServices;

  // ---- Stage completion tracking (for partial-cycle diagnostics) ----
  stagesCompleted: (CycleStage | LightCycleStage)[];
}

// ============================================================================
// STAGE SIGNATURE — every extracted stage implements this
// ============================================================================

/**
 * A cycle stage is a pure-ish async function. It receives a context,
 * mutates it through StateManager methods (never direct state writes),
 * and returns the (possibly augmented) context for the next stage.
 *
 * Stages should throw on unrecoverable errors — the cycle engine catches
 * and sets `ctx.halted = true` with `ctx.haltReason`.
 */
export type CycleStageFn = (ctx: CycleContext) => Promise<CycleContext>;
