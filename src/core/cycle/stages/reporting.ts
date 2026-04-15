/**
 * Never Rest Capital — Cycle Stage: REPORTING
 *
 * Phase 5b target. Extracts agent-v3.2.ts lines 8000–8200.
 *
 * Responsibilities:
 *   - State persistence flush (write JSON to disk)
 *   - Telegram hourly report (if hourly window elapsed)
 *   - Trade result summaries
 *   - SHI outcome logging
 *
 * Inputs:
 *   - ctx.tradeResults  (from executionStage)
 *
 * DO NOT EXTRACT until Phase 5b session.
 */

import type { CycleContext } from '../../types/cycle.js';

export async function reportingStage(ctx: CycleContext): Promise<CycleContext> {
  throw new Error('[Phase 5b] reportingStage not yet extracted — monolith handles REPORTING inline (L8000–8200)');
  return ctx;
}
