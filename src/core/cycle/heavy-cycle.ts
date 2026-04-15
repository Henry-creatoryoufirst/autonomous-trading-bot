/**
 * Never Rest Capital — HeavyCycle
 *
 * Phase 5a stub. Will become the orchestrator for the 2,350-line heavy
 * trading cycle, decomposed into 8 typed stages.
 *
 * Current state: skeleton only. The heavy cycle path is still executed
 * entirely inline in agent-v3.2.ts. Phase 5b will extract stages one at
 * a time (one stage per PR, ≥ 4h staging soak between each).
 *
 * Phase 5c (SEPARATE PR, 48h soak): execution.ts stage only.
 * Never refactor execution alongside anything else.
 *
 * Target stage pipeline (each is CycleStageFn = (ctx) => Promise<ctx>):
 *
 *   Stage            Monolith lines   Phase
 *   ─────────────────────────────────────────
 *   setup            L6102–6175       5b
 *   intelligence     L6176–6357       5b
 *   metrics          L6626–6684       5b
 *   decision         L6950–7010       5b
 *   filters          L7020–7350       5b
 *   execution        L7350–8000       5c  ← dedicated PR, 48h soak
 *   reporting        L8000–8200       5b
 *   scheduling       L8200–8413       5b
 */

import type { CycleContext } from '../types/cycle.js';
import type { SetupDeps } from './stages/setup.js';
import {
  setupStage,
  intelligenceStage,
  metricsStage,
  decisionStage,
  filtersStage,
  executionStage,
  reportingStage,
  schedulingStage,
} from './stages/index.js';

// ============================================================================
// HEAVY CYCLE ORCHESTRATOR
// ============================================================================

export interface HeavyCycleDeps {
  setup: SetupDeps;
}

/**
 * Orchestrate the full heavy-cycle stage pipeline.
 *
 * Phase 5a: STUB — all stage functions throw "not yet extracted".
 * Phase 5b: stages extracted one at a time, each its own commit.
 * Phase 5c: executionStage extracted in its own dedicated PR.
 */
export async function runHeavyCycle(ctx: CycleContext, deps: HeavyCycleDeps): Promise<CycleContext> {
  ctx = await setupStage(ctx, deps.setup);
  if (ctx.halted) return ctx;

  ctx = await intelligenceStage(ctx);
  if (ctx.halted) return ctx;

  ctx = await metricsStage(ctx);
  if (ctx.halted) return ctx;

  ctx = await decisionStage(ctx);
  if (ctx.halted) return ctx;

  ctx = await filtersStage(ctx);
  if (ctx.halted) return ctx;

  ctx = await executionStage(ctx);
  if (ctx.halted) return ctx;

  ctx = await reportingStage(ctx);
  if (ctx.halted) return ctx;

  ctx = await schedulingStage(ctx);

  return ctx;
}
