/**
 * Never Rest Capital — Light Cycle
 *
 * Phase 5a of the monolith refactor. Extracts the light-cycle early-return
 * path from agent-v3.2.ts lines 6036-6057 into a standalone, testable
 * function.
 *
 * The light cycle fires when `shouldRunHeavyCycle()` returns false — i.e.
 * no significant price movement and interval hasn't forced a heavy cycle.
 * It updates adaptive interval state and syncs `costBasis.currentPrice`
 * for dashboard freshness, then returns without full analysis.
 *
 * Caller pattern (agent-v3.2.ts):
 *   const lightInterval = computeNextInterval(currentPrices); // stays in monolith
 *   runLightCycle({ ..., lightInterval, currentPrices, cycleStats, adaptiveCycle });
 *   return; // early exit from runTradingCycle()
 */

// ============================================================================
// INPUT TYPES
// ============================================================================

export interface LightCycleInterval {
  intervalSec: number;
  reason: string;
  volatilityLevel: string;
}

/** Mutable subset of the module-level cycleStats object. Passed by reference. */
export interface LightCycleCycleStats {
  totalLight: number;
  totalHeavy: number;
  lastHeavyReason: string;
}

/**
 * Mutable subset of the module-level adaptiveCycle object. Passed by reference.
 * Mutations here ARE observed by agent-v3.2.ts (same object reference).
 */
export interface LightCycleAdaptiveState {
  currentIntervalSec: number;
  volatilityLevel: string;
  consecutiveLightCycles: number;
  lastPriceCheck: Map<string, number>;
}

/** Cache stats shape returned by CacheManager.getStats(). */
export interface LightCycleCacheStats {
  entries: number;
  totalHits: number;
  totalMisses: number;
  hitRate: string;
  oldestEntryAge: string;
}

export interface LightCycleInput {
  /** Monotonically increasing cycle counter (= state.totalCycles in monolith). */
  cycleNumber: number;
  /** epoch ms when runTradingCycle() started — for elapsed time log. */
  cycleStart: number;
  /** Current portfolio value in USD. */
  portfolioValue: number;
  /** Number of active per-token cooldowns. */
  cooldownCount: number;
  /** Cache stats snapshot. */
  cacheStats: LightCycleCacheStats;
  /** Pre-computed interval (computeNextInterval called by monolith before delegating). */
  lightInterval: LightCycleInterval;
  /** Latest quick-price snapshot from fetchQuickPrices(). */
  currentPrices: Map<string, number>;
  /**
   * Live costBasis map reference (state.costBasis).
   * Mutations here update costBasis.currentPrice for dashboard freshness.
   */
  costBasis: Record<string, { currentPrice?: number; [key: string]: unknown }>;
  /** Mutable cycle stats (passed by reference — mutations observed by monolith). */
  cycleStats: LightCycleCycleStats;
  /** Mutable adaptive cycle state (passed by reference). */
  adaptiveCycle: LightCycleAdaptiveState;
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Execute the light-cycle path.
 *
 * Mirrors agent-v3.2.ts lines 6036-6057 exactly. No async I/O, no trading.
 * Returns void — the `return;` in the monolith is at the call site.
 *
 * Mutations performed (all via reference — caller observes them):
 *   - cycleStats.totalLight++
 *   - adaptiveCycle.consecutiveLightCycles++
 *   - adaptiveCycle.currentIntervalSec, .volatilityLevel, .lastPriceCheck updated
 *   - costBasis[symbol].currentPrice synced for each tracked symbol with a price
 */
export function runLightCycle(input: LightCycleInput): void {
  const {
    cycleNumber,
    cycleStart,
    portfolioValue,
    cooldownCount,
    cacheStats,
    lightInterval,
    currentPrices,
    costBasis,
    cycleStats,
    adaptiveCycle,
  } = input;

  // === LIGHT CYCLE (mirrors lines 6037-6057) ===
  cycleStats.totalLight++;
  adaptiveCycle.consecutiveLightCycles++;

  // v6.2: Update adaptive interval even on light cycles
  adaptiveCycle.currentIntervalSec = lightInterval.intervalSec;
  adaptiveCycle.volatilityLevel    = lightInterval.volatilityLevel;
  adaptiveCycle.lastPriceCheck     = new Map(currentPrices);

  // v9.2: Sync costBasis.currentPrice on light cycles so dashboard stays fresh
  for (const [symbol, price] of currentPrices) {
    if (costBasis[symbol] && price > 0) {
      (costBasis[symbol] as Record<string, unknown>).currentPrice = price;
    }
  }

  console.log(
    `[CYCLE #${cycleNumber}] LIGHT | Portfolio: $${portfolioValue.toFixed(2)} | ` +
    `Cooldowns: ${cooldownCount} | Cache: ${cacheStats.entries} entries (${cacheStats.hitRate} hit rate) | ` +
    `${Date.now() - cycleStart}ms | ⚡ Next: ${lightInterval.intervalSec}s (${lightInterval.volatilityLevel})`,
  );
}
