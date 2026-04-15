/**
 * Never Rest Capital — Cycle Stage: FILTERS
 *
 * Phase 5b target. Extracts agent-v3.2.ts lines 7020–7350.
 *
 * Responsibilities:
 *   - Capital preservation filter (fear & greed gate)
 *   - User directive enforcement (sells from admin instructions)
 *   - Per-cycle trade cap guard (regime-aware max buys)
 *   - Risk/reward filter on BUY decisions
 *   - De-duplication of in-flight orders
 *
 * Inputs:
 *   - ctx.decisions  (from decisionStage)
 *
 * Outputs on ctx:
 *   - ctx.decisions  filtered (some decisions removed, reasons logged)
 *   - ctx.halted     set to true if circuit breaker hard-halted
 *
 * NOTE: The circuit breaker check occurs in this stage. Setting ctx.halted
 * causes the orchestrator to skip execution entirely.
 *
 * DO NOT EXTRACT until Phase 5b session.
 */

import type { CycleContext } from '../../types/cycle.js';

export async function filtersStage(ctx: CycleContext): Promise<CycleContext> {
  throw new Error('[Phase 5b] filtersStage not yet extracted — monolith handles FILTERS inline (L7020–7350)');
  return ctx;
}
