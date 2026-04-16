/**
 * Never Rest Capital — Cycle Stage: SCHEDULING
 *
 * Phase 5g extraction. Covers agent-v3.2.ts lines 8395–8418:
 * opportunity-cost scoring, adaptive interval computation, and
 * adaptiveCycle state updates at the end of every heavy cycle.
 *
 * Like runLightCycle(), this stage does NOT use CycleContext — it operates
 * on the adaptive-cycle state and the current-prices Map that live outside
 * the context. Called after the heavy cycle body completes.
 *
 * SchedulingInput is passed by reference; mutations to adaptiveCycle are
 * visible to the caller immediately (same as LightCycleAdaptiveState).
 *
 * Caller pattern (agent-v3.2.ts after extraction):
 *   runSchedulingStage({
 *     currentPrices,
 *     adaptiveCycle,
 *     deps: { computeNextInterval, updateOpportunityCosts },
 *   });
 */

// ============================================================================
// TYPES
// ============================================================================

export interface SchedulingInterval {
  intervalSec: number;
  volatilityLevel: string;
  reason: string;
}

/**
 * The subset of the adaptiveCycle object that the scheduling stage reads
 * and writes. Passed by reference — mutations are reflected in the caller.
 */
export interface SchedulingAdaptiveCycle {
  currentIntervalSec: number;
  volatilityLevel: string;
  consecutiveLightCycles: number;
  lastPriceCheck: Map<string, number>;
  emergencyMode: boolean;
  emergencyUntil: number;
  wsConnected: boolean;
  dynamicPriceThreshold: number;
  portfolioTier: string;
}

export interface SchedulingDeps {
  /**
   * Pure function: assess volatility + portfolio tier → recommended interval.
   * Mirrors agent-v3.2.ts computeNextInterval().
   */
  computeNextInterval(currentPrices: Map<string, number>): SchedulingInterval;
  /**
   * Side-effectful: update opportunity-cost tracking for missed token moves.
   * Mirrors agent-v3.2.ts updateOpportunityCosts().
   */
  updateOpportunityCosts(priceRecord: Record<string, number>): void;
}

export interface SchedulingInput {
  /** Current token prices as a Map — used for opportunity cost + interval calc. */
  currentPrices: Map<string, number>;
  /**
   * Adaptive cycle state object — mutated BY REFERENCE.
   * Changes are visible to the caller after runSchedulingStage() returns.
   */
  adaptiveCycle: SchedulingAdaptiveCycle;
  deps: SchedulingDeps;
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * SCHEDULING stage — end-of-heavy-cycle adaptive bookkeeping.
 *
 * Mirrors agent-v3.2.ts lines 8395–8418:
 * 1. Scores missed opportunities from previous cycles.
 * 2. Computes the next adaptive cycle interval.
 * 3. Applies interval + volatility updates to adaptiveCycle.
 * 4. Resets consecutiveLightCycles to 0 (heavy cycle just ran).
 * 5. Takes a fresh price snapshot for the next cycle's volatility comparison.
 * 6. Clears emergencyMode if the emergency window has expired.
 */
export function runSchedulingStage(input: SchedulingInput): void {
  const { currentPrices, adaptiveCycle, deps } = input;

  // v20.2: Score missed opportunities from previous cycles (mirrors L8395–8398)
  const priceRecord: Record<string, number> = {};
  for (const [symbol, price] of currentPrices) {
    priceRecord[symbol] = price;
  }
  deps.updateOpportunityCosts(priceRecord);

  // v6.2: Compute and apply adaptive interval (mirrors L8400–8407)
  const nextInterval = deps.computeNextInterval(currentPrices);
  adaptiveCycle.currentIntervalSec     = nextInterval.intervalSec;
  adaptiveCycle.volatilityLevel        = nextInterval.volatilityLevel;
  adaptiveCycle.consecutiveLightCycles = 0; // reset on heavy cycle
  adaptiveCycle.lastPriceCheck         = new Map(currentPrices);

  // Clear emergency mode if window expired (mirrors L8409–8413)
  if (adaptiveCycle.emergencyMode && Date.now() > adaptiveCycle.emergencyUntil) {
    adaptiveCycle.emergencyMode = false;
    console.log(`   ✅ Emergency mode ended — returning to adaptive tempo`);
  }

  console.log(`   ⚡ Adaptive: ${nextInterval.intervalSec}s next cycle | ${nextInterval.reason}`);
  console.log(
    `   📡 Price stream: ${adaptiveCycle.wsConnected ? 'LIVE' : 'offline'} | ` +
    `Threshold: ${(adaptiveCycle.dynamicPriceThreshold * 100).toFixed(1)}% (${adaptiveCycle.portfolioTier})`,
  );
  console.log('═'.repeat(70));
}

// ============================================================================
// CycleContext wrapper (for heavy-cycle orchestrator compatibility)
// ============================================================================

import type { CycleContext } from '../../types/cycle.js';

/**
 * CycleStageFn-compatible wrapper.
 *
 * The scheduling stage operates on adaptiveCycle (not CycleContext). This
 * wrapper is a no-op stub — the orchestrator calls runSchedulingStage()
 * directly. Exists so the heavy-cycle pipeline can type-check the pipeline
 * without breaking the CycleStageFn contract.
 */
export async function schedulingStage(ctx: CycleContext): Promise<CycleContext> {
  // Phase 5g: scheduling runs after the heavy cycle — wired in agent-v3.2.ts
  // directly via runSchedulingStage(). This CycleContext wrapper is intentionally
  // a no-op so the orchestrator skeleton type-checks cleanly.
  ctx.stagesCompleted.push('SCHEDULING');
  return ctx;
}
