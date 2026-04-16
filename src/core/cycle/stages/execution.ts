/**
 * Never Rest Capital — Cycle Stage: EXECUTION
 *
 * ⚠️  DEDICATED PR. 48-HOUR PAPER-TRADE SOAK BEFORE PRODUCTION. ⚠️
 * ⚠️  NEVER extract this stage alongside anything else.
 * ⚠️  Requires diff of tradeHistory JSON across 24h staging window (zero drift).
 *
 * Phase 5c: deps-aware wrapper. Real execution logic stays in agent-v3.2.ts
 * for now — wrapped by a `run` callback closure so it retains access to all
 * cycle-local variables (marketData, currentPrices, deploymentCheck, account,
 * walletAddr, etc.). Subsequent phases will progressively externalize the
 * loop body into pure functions.
 *
 * Responsibilities (now delegated to deps.run):
 *   - Per-decision executeTrade() calls with sizing, slippage, gas checks
 *   - TWAP execution for large orders
 *   - Sell-before-buy ordering
 *   - Post-trade cost basis + state mutations via StateManager
 *   - Trade circuit breaker (3 consecutive swap failures)
 *   - Hot Movers urgent re-evaluation
 *   - Yield optimizer rebalancing
 *
 * Outputs on ctx:
 *   - ctx.tradeResults  populated by deps.run if it chooses to
 *
 * Source: agent-v3.2.ts L6868–L7839 (973 lines)
 */

import type { CycleContext } from '../../types/cycle.js';

// ============================================================================
// EXECUTION DEPS
// ============================================================================

/**
 * The execution stage delegates its full body to `deps.run`. This keeps the
 * stage file thin and lets the monolith hand in a closure that still has
 * access to cycle-local variables. When deps is omitted, the stage is a
 * non-throwing no-op (for tests and the simulation harness).
 */
export interface ExecutionDeps {
  run(ctx: CycleContext): Promise<CycleContext>;
}

// ============================================================================
// STAGE
// ============================================================================

/**
 * EXECUTION stage.
 *
 * Behavior:
 *   - When ctx.halted, return immediately with no logging or stage push.
 *   - When deps is provided, invoke deps.run(ctx). Any thrown error is caught
 *     and recorded as ctx.halted = true with the error message as haltReason.
 *   - Always push 'EXECUTION' to stagesCompleted on the non-halted entry path
 *     (even when deps.run threw — the stage *did* run, it just halted).
 *   - When deps is omitted, log a single stub marker and push the stage name.
 *     The 48h paper-trade soak gate governs when a real deps is wired in.
 */
export async function executionStage(
  ctx: CycleContext,
  deps?: ExecutionDeps,
): Promise<CycleContext> {
  if (ctx.halted) return ctx;

  if (deps) {
    try {
      ctx = await deps.run(ctx);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[EXECUTION] fatal: ${msg}`);
      ctx.halted = true;
      ctx.haltReason = msg;
    }
  } else {
    console.log('[EXECUTION] stub — Phase 5c gated (48h soak required)');
  }

  ctx.stagesCompleted.push('EXECUTION');
  return ctx;
}
