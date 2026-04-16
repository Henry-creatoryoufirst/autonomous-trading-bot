/**
 * Never Rest Capital — CycleEngine
 *
 * Phase 5a skeleton. The CycleEngine will become the orchestrator that
 * replaces the 2,350-line `runTradingCycle()` in agent-v3.2.ts. Currently
 * it exists as a typed scaffold — the stage implementations are stubs that
 * will be populated in Phase 5b (stages 1-4) and Phase 5c (execution stage).
 *
 * Architecture:
 *   runTradingCycle()  ──►  CycleEngine.run(ctx)
 *                              ├── runLightCycle(input)   [extracted in 5a]
 *                              └── HeavyCycle.run(ctx)    [stub, 5b/5c]
 *                                    ├── setupStage(ctx)
 *                                    ├── intelligenceStage(ctx)
 *                                    ├── metricsStage(ctx)
 *                                    ├── decisionStage(ctx)
 *                                    ├── filtersStage(ctx)
 *                                    ├── executionStage(ctx)  ← 48h soak
 *                                    ├── reportingStage(ctx)
 *                                    └── schedulingStage(ctx)
 *
 * Pattern matches src/core/services/self-healing/orchestrator.ts:
 *   - Constructor DI (no singletons)
 *   - Static factory (createCycleEngine)
 *   - Typed inputs/outputs
 *   - No direct state.foo mutations — all via ctx.services.stateManager
 */

import type { CycleContext, CycleResult } from '../types/cycle.js';

// ============================================================================
// DEPS (injected at construction — populated by agent-v3.2.ts in Phase 5b)
// ============================================================================

export interface CycleEngineDeps {
  /**
   * Phase 5b will inject stage implementations here.
   * Phase 5a keeps this empty — the engine is not yet called for heavy cycles.
   */
  _placeholder?: never;
}

// ============================================================================
// CYCLE ENGINE
// ============================================================================

export class CycleEngine {
  constructor(_deps: CycleEngineDeps = {}) {}

  static create(deps: CycleEngineDeps = {}): CycleEngine {
    return new CycleEngine(deps);
  }

  /**
   * Run one full trading cycle (light or heavy path).
   *
   * Phase 5a: NOT YET WIRED for the heavy path. The light cycle delegates
   * to runLightCycle() directly in agent-v3.2.ts (the caller). This method
   * will be called by the monolith in Phase 5b once the first stage is
   * extracted.
   *
   * @throws Error — called before Phase 5b wiring is complete
   */
  async run(_ctx: CycleContext): Promise<CycleResult> {
    // Phase 5b will implement this. Guard to catch accidental early calls.
    throw new Error(
      '[CycleEngine] Phase 5b not yet wired — runTradingCycle() still uses monolith path for heavy cycles.',
    );
  }
}

export function createCycleEngine(deps: CycleEngineDeps = {}): CycleEngine {
  return CycleEngine.create(deps);
}
