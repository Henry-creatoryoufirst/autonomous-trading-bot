/**
 * Never Rest Capital — Cycle Stage: REPORTING
 *
 * Phase 5e: ReportingDeps interface + non-throwing stub.
 * Real implementation: state persistence flush + Telegram hourly report.
 *
 * Responsibilities (when fully extracted):
 *   - State persistence flush (write JSON to disk / Railway volume)
 *   - Telegram hourly report (if hourly window has elapsed)
 *   - Trade result summaries sent to Telegram
 *   - SHI outcome logging
 *
 * Inputs:
 *   - ctx.tradeResults  (from executionStage)
 *   - ctx.halted        (skip reporting if cycle was hard-halted)
 *
 * Outputs on ctx:
 *   - ctx.stagesCompleted gets 'REPORTING' appended
 *
 * Source: agent-v3.2.ts L8000–8200
 */

import type { CycleContext } from '../../types/cycle.js';

// ============================================================================
// REPORTING DEPS
// ============================================================================

/**
 * Dependencies injected into reportingStage.
 *
 * Phase 5 will wire these from the live monolith services.
 * Tests pass mocks. The stub only calls flushState().
 */
export interface ReportingDeps {
  /**
   * Persist agent state to disk / Railway volume.
   * Called every cycle — failure is non-fatal (logged, never thrown).
   */
  flushState(): Promise<void>;

  /**
   * Send the hourly Telegram portfolio report.
   * Only called when the hourly window has elapsed.
   * Optional — if not provided, hourly reporting is skipped silently.
   */
  sendHourlyReport?(portfolioValue: number): Promise<void>;
}

// ============================================================================
// STAGE — Phase 5e non-throwing stub
// ============================================================================

/**
 * REPORTING stage stub.
 *
 * Calls flushState() with a try/catch — a failed state flush must never
 * crash the cycle. The hourly report call is deferred to the real
 * implementation (Phase 5 extraction from L8000–8200).
 *
 * Real implementation will:
 *   - Check if the hourly Telegram window has elapsed
 *   - Build the full portfolio HTML report and send it
 *   - Log all trade results from ctx.tradeResults
 *   - Record SHI outcomes
 */
export async function reportingStage(
  ctx: CycleContext,
  deps?: ReportingDeps,
): Promise<CycleContext> {
  if (ctx.halted) return ctx;

  if (deps?.flushState) {
    try {
      await deps.flushState();
    } catch (err: any) {
      console.warn('[REPORTING] flushState failed (non-fatal):', err?.message ?? String(err));
    }
  }

  ctx.stagesCompleted.push('REPORTING');
  return ctx;
}
