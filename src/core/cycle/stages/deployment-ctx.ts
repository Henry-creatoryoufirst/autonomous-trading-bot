/**
 * Never Rest Capital — Cycle Stage: DEPLOYMENT_CTX
 *
 * Phase 5e extraction. Mirrors agent-v3.2.ts lines 6400–6401 (sector
 * allocations) and 6763–6781 (cash deployment engine).
 *
 * Responsibilities:
 *   1. Compute per-sector allocations (how much % of portfolio is in each
 *      sector vs. target) — written to ctx.sectorAllocations.
 *   2. Check whether the portfolio is over-concentrated in USDC and needs
 *      active deployment — written to ctx.deploymentCheck.
 *
 * Both results are consumed downstream by AI_DECISION (decisionStage) to
 * give Claude the full capital-deployment context.
 *
 * Contract:
 *   - Halted guard: returns ctx immediately if ctx.halted is set.
 *   - Both dep calls are wrapped in try/catch — failures are non-fatal.
 *     The stage logs a warning and pushes 'DEPLOYMENT_CTX' regardless.
 *   - NEVER sets ctx.halted.
 *   - Pushes 'DEPLOYMENT_CTX' to ctx.stagesCompleted on every non-halted path.
 */

import type { CycleContext } from '../../types/cycle.js';
import type { SectorAllocation } from '../../types/index.js';
import type { CashDeploymentResult } from '../../types/state.js';

// ============================================================================
// DEPS
// ============================================================================

/** Balance entry shape — matches AgentState['trading']['balances'][number]. */
type BalanceEntry = {
  symbol: string;
  balance: number;
  usdValue: number;
  price?: number;
  sector?: string;
};

export interface DeploymentCtxDeps {
  /**
   * Compute per-sector allocations from the current balance snapshot.
   * Mirrors the `calculateSectorAllocations` call in agent-v3.2.ts L6400.
   */
  calculateSectorAllocations(
    balances: ReadonlyArray<BalanceEntry>,
    totalValue: number,
  ): SectorAllocation[];

  /**
   * Determine whether the portfolio is over-weighted in USDC and needs
   * active cash deployment this cycle.
   * Mirrors `checkCashDeploymentMode` in agent-v3.2.ts L6774.
   */
  checkCashDeploymentMode(
    usdcBalance: number,
    totalPortfolioValue: number,
    fearGreedValue: number,
  ): CashDeploymentResult;
}

// ============================================================================
// STAGE
// ============================================================================

/**
 * deploymentCtxStage — populate ctx.sectorAllocations and ctx.deploymentCheck.
 *
 * Deps are required (both fns are always available in production via the
 * capital module). Tests inject stubs.
 */
export async function deploymentCtxStage(
  ctx: CycleContext,
  deps: DeploymentCtxDeps,
): Promise<CycleContext> {
  if (ctx.halted) return ctx;

  const totalPortfolioValue =
    ctx.services.stateManager.getState().trading.totalPortfolioValue;

  // --- sector allocations ---------------------------------------------------
  try {
    ctx.sectorAllocations = deps.calculateSectorAllocations(
      ctx.balances,
      totalPortfolioValue,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[DEPLOYMENT_CTX] calculateSectorAllocations failed: ${msg}`);
  }

  // --- cash deployment check ------------------------------------------------
  try {
    const usdcBalance =
      ctx.balances.find(b => b.symbol === 'USDC')?.usdValue ?? 0;
    const fearGreedValue = ctx.marketData?.fearGreed?.value ?? 50;

    ctx.deploymentCheck = deps.checkCashDeploymentMode(
      usdcBalance,
      totalPortfolioValue,
      fearGreedValue,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[DEPLOYMENT_CTX] checkCashDeploymentMode failed: ${msg}`);
  }

  ctx.stagesCompleted.push('DEPLOYMENT_CTX');
  return ctx;
}
