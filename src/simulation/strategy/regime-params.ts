/**
 * NVR Capital — Level 2: Regime-Adaptive Strategy Parameters
 *
 * Defines per-regime strategy overlays and the interpolation function
 * that blends base params with regime-specific adjustments.
 *
 * Pure functions. No side effects.
 */

import type { StrategyParams, SimRegime, RegimeOverlay } from '../types.js';

// ============================================================================
// REGIME OVERLAYS
// ============================================================================

/**
 * Per-regime strategy parameter targets.
 *
 * TRENDING:  Ride the trend — lower entry bar, wider stops, bigger targets
 * RANGING:   Mean-revert — high entry bar, tight stops, quick profits
 * VOLATILE:  Survive — highest bar, widest stops, smallest size
 * BREAKOUT:  Catch expansion — moderate entry, aggressive trailing
 */
/**
 * Per-regime strategy targets.
 * Calibrated through benchmark iteration:
 * - More aggressive TRENDING overlay works best (catch the trend)
 * - Moderate RANGING overlay (don't over-restrict)
 * - VOLATILE/BREAKOUT are less common, kept conservative
 */
export const REGIME_OVERLAYS: Record<SimRegime, RegimeOverlay> = {
  TRENDING: {
    confluenceBuyThreshold: 12,
    stopLossPercent: 8,
    profitTakePercent: 8,
    trailingStopPercent: 12,
    maxPositionPercent: 8,
    kellyFraction: 0.35,
  },
  RANGING: {
    confluenceBuyThreshold: 20,
    stopLossPercent: 5,
    profitTakePercent: 4,
    trailingStopPercent: 8,
    maxPositionPercent: 5,
    kellyFraction: 0.25,
  },
  VOLATILE: {
    confluenceBuyThreshold: 25,
    stopLossPercent: 9,
    profitTakePercent: 6,
    trailingStopPercent: 13,
    maxPositionPercent: 4,
    kellyFraction: 0.2,
  },
  BREAKOUT: {
    confluenceBuyThreshold: 15,
    stopLossPercent: 5,
    profitTakePercent: 6,
    trailingStopPercent: 8,
    maxPositionPercent: 6,
    kellyFraction: 0.3,
  },
};

// ============================================================================
// PARAMETER INTERPOLATION
// ============================================================================

/**
 * Blend base strategy params with regime-specific overlay.
 * Interpolation factor is the regime detection confidence (0-1).
 *
 * effective = base * (1 - confidence) + overlay * confidence
 */
export function applyRegimeOverlay(
  baseParams: StrategyParams,
  regime: SimRegime,
  confidence: number,
): StrategyParams {
  const overlay = REGIME_OVERLAYS[regime];
  const c = Math.max(0, Math.min(1, confidence));

  return {
    ...baseParams,
    confluenceBuyThreshold: lerp(baseParams.confluenceBuyThreshold, overlay.confluenceBuyThreshold, c),
    stopLossPercent: lerp(baseParams.stopLossPercent, overlay.stopLossPercent, c),
    profitTakePercent: lerp(baseParams.profitTakePercent, overlay.profitTakePercent, c),
    trailingStopPercent: lerp(baseParams.trailingStopPercent ?? 10, overlay.trailingStopPercent, c),
    maxPositionPercent: lerp(baseParams.maxPositionPercent, overlay.maxPositionPercent, c),
    kellyFraction: lerp(baseParams.kellyFraction, overlay.kellyFraction, c),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
