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
 * Phase 5h: populated from the live monolith helpers via buildDecisionDeps().
 * Tests pass mocks.
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

  /**
   * Max buy size in USD — caps per-trade sizing for central signal decisions.
   * Mirrors CONFIG.trading.maxBuySize.
   */
  maxBuySize: number;

  /**
   * Why this heavy cycle was triggered — passed to makeTradeDecision for
   * tiered model routing (Haiku vs Sonnet).  Optional: missing → Sonnet default.
   */
  heavyCycleReason?: string;
}

// ============================================================================
// STAGE — Phase 5h real implementation
// ============================================================================

/**
 * DECISION stage.
 *
 * Routes to the appropriate decision source based on deps.signalMode:
 *   - 'central'  → fetchCentralSignals() + local position sizing
 *   - 'local' / 'producer' → makeTradeDecision() (Claude / Haiku)
 *
 * When deps is omitted (e.g., heavy-cycle.ts orchestrator before full wiring),
 * falls back to the Phase 5e stub: returns an empty decisions array.
 *
 * Contract: NEVER sets ctx.halted — errors from AI calls propagate as thrown
 * exceptions; the cycle engine's outer try/catch handles them.
 */
export async function decisionStage(
  ctx: CycleContext,
  deps?: DecisionDeps,
): Promise<CycleContext> {
  if (ctx.halted) return ctx;

  // Stub fallback — deps not wired (heavy-cycle.ts orchestrator path, tests)
  if (!deps) {
    if (!Array.isArray(ctx.decisions)) ctx.decisions = [];
    ctx.stagesCompleted.push('AI_DECISION');
    return ctx;
  }

  const totalPortfolioValue =
    ctx.services.stateManager.getState().trading.totalPortfolioValue;
  const balances       = ctx.balances as unknown as DecisionBalance[];
  const marketData     = ctx.marketData!;
  const sectorAllocations = ctx.sectorAllocations ?? [];
  const deploymentCheck   = ctx.deploymentCheck;

  let decisions: TradeDecision[];

  if (deps.signalMode === 'central') {
    console.log('\n📡 Fetching signals from NVR central service...');
    decisions = await deps.fetchCentralSignals({
      balances,
      marketData,
      portfolioValue: totalPortfolioValue,
    });

    // Apply local position sizing to central signal decisions that have no amount set
    const availableUSDC =
      ctx.balances.find(b => b.symbol === 'USDC')?.balance ?? 0;
    for (const decision of decisions) {
      if (decision.amountUSD === 0 && decision.action === 'BUY') {
        // 4% of portfolio per trade, capped by available USDC and max buy size
        decision.amountUSD = Math.min(
          deps.maxBuySize,
          totalPortfolioValue * 0.04,
          availableUSDC * 0.9, // Leave 10% USDC buffer
        );
      }
      if (decision.amountUSD === 0 && decision.action === 'SELL') {
        // Sell 50% of position by default for central signals
        const holding = ctx.balances.find(b => b.symbol === decision.fromToken);
        if (holding) decision.amountUSD = (holding.usdValue ?? 0) * 0.5;
      }
    }
    console.log(
      `  📡 Central decisions: ${decisions.length} ` +
      `(${decisions.filter(d => d.action === 'BUY').length} buys, ` +
      `${decisions.filter(d => d.action === 'SELL').length} sells)`,
    );
  } else {
    // local or producer mode: call Claude AI (v20.5 tiered model routing)
    console.log('\n🧠 AI analyzing portfolio & market...');
    decisions = await deps.makeTradeDecision(
      balances,
      marketData,
      totalPortfolioValue,
      sectorAllocations,
      deploymentCheck?.active ? deploymentCheck : undefined,
      deps.heavyCycleReason,
    );
  }

  ctx.decisions = decisions;
  ctx.stagesCompleted.push('AI_DECISION');
  return ctx;
}
