/**
 * Never Rest Capital — Cycle Stage: DECISION
 *
 * Phase 5e: Types defined, non-throwing stub.
 * Phase 5h (gated behind 48h soak): real Claude / Haiku / central-signal call.
 *
 * Responsibilities (when fully extracted):
 *   - Cash deployment context computation
 *   - AI trade decision call (Claude / Haiku / Groq based on tier)
 *   - Adversarial risk review
 *   - Decision list assembly (BUY/SELL/HOLD per token)
 *
 * Outputs on ctx:
 *   - ctx.decisions  populated with raw AI decisions before filtering
 *
 * DO NOT implement the real AI call until Phase 5h is approved.
 */

import type { CycleContext } from '../../types/cycle.js';
import type { MarketData, TradeDecision } from '../../types/market-data.js';
import type { SectorAllocation } from '../../types/index.js';
import type { CashDeploymentResult } from '../../types/state.js';
import type { SwarmDecision } from '../../services/swarm/agent-framework.js';

// ============================================================================
// DECISION DEPS — injected functions the real implementation will call
// ============================================================================

/** Balance entry shape — mirrors AgentState['trading']['balances'] */
export type DecisionBalance = {
  symbol: string;
  balance: number;
  usdValue: number;
  price?: number;
  sector?: string;
};

/** Portfolio context passed to the central-signal endpoint */
export interface CentralSignalContext {
  balances: DecisionBalance[];
  marketData: MarketData;
  portfolioValue: number;
}

/**
 * Dependencies injected into decisionStage.
 *
 * Phase 5h will populate these from the live monolith helpers.
 * Tests pass mocks. The stub ignores them.
 */
export interface DecisionDeps {
  /** Routing mode — selects Claude AI vs. central signal service vs. producer mode. */
  signalMode: 'local' | 'central' | 'producer';

  /**
   * Fetch trade decisions from the NVR central signal service.
   * Used when signalMode === 'central'.
   */
  fetchCentralSignals(portfolioContext: CentralSignalContext): Promise<TradeDecision[]>;

  /**
   * Call Claude / Haiku to generate trade decisions locally.
   * Used when signalMode === 'local'.
   */
  makeTradeDecision(
    balances: DecisionBalance[],
    marketData: MarketData,
    totalPortfolioValue: number,
    sectorAllocations: SectorAllocation[],
    deploymentCheck?: CashDeploymentResult,
    heavyCycleReason?: string,
  ): Promise<TradeDecision[]>;

  /**
   * Read the most recent swarm micro-agent decisions (used for preservation
   * filtering in the PRESERVATION stage, but fetched here for completeness).
   */
  getLatestSwarmDecisions(): SwarmDecision[];
}

// ============================================================================
// STAGE — Phase 5e non-throwing stub
// ============================================================================

/**
 * DECISION stage stub.
 *
 * Phase 5e: Does not call Claude or any external service.
 * Returns ctx unmodified except for marking the stage complete and
 * ensuring ctx.decisions is an array.
 *
 * Real implementation (Phase 5h) will:
 *   - Use deps.signalMode to route to central signals or Claude AI
 *   - Apply capital preservation sizing via swarm consensus
 *   - Populate ctx.decisions with raw trade decisions
 */
export async function decisionStage(
  ctx: CycleContext,
  _deps?: DecisionDeps,
): Promise<CycleContext> {
  if (ctx.halted) return ctx;

  // Phase 5e: no AI call — real implementation gated behind Phase 5h (48h soak).
  // Downstream stages (PRESERVATION, DIRECTIVES, TRADE_CAP, RISK_REWARD) expect
  // ctx.decisions to be an array. Ensure it is initialised even if setup left it
  // undefined (defensive — CycleContext types it as TradeDecision[]).
  if (!Array.isArray(ctx.decisions)) {
    ctx.decisions = [];
  }

  ctx.stagesCompleted.push('AI_DECISION');
  return ctx;
}
