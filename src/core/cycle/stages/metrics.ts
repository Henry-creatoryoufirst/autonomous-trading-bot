/**
 * Never Rest Capital — Cycle Stage: METRICS
 *
 * Phase 5b target. Extracts agent-v3.2.ts lines 6626–6684.
 *
 * Responsibilities:
 *   - Dashboard metrics computation (sector allocations, unrealized P&L)
 *   - Risk/reward ratio calculations
 *   - Portfolio snapshot for Telegram hourly report
 *
 * Outputs on ctx:
 *   - (metrics written to state via stateManager)
 *
 * DO NOT EXTRACT until Phase 5b session.
 */

import type { CycleContext } from '../../types/cycle.js';

export async function metricsStage(ctx: CycleContext): Promise<CycleContext> {
  throw new Error('[Phase 5b] metricsStage not yet extracted — monolith handles METRICS inline (L6626–6684)');
  return ctx;
}
