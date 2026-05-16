/**
 * Extracted adaptive threshold logic from agent-v3.2.ts for unit testing.
 * THRESHOLD_BOUNDS + DEFAULT_ADAPTIVE_THRESHOLDS imported from the canonical
 * source in src/core/config/constants.ts. Local re-declarations were collapsed
 * 2026-05-15 — see constants.ts for rationale.
 */

import {
  THRESHOLD_BOUNDS as CANONICAL_THRESHOLD_BOUNDS,
  BASE_THRESHOLD_VALUES,
} from '../../config/constants.js';

export interface ThresholdBound {
  min: number;
  max: number;
  maxStep: number;
}

export const THRESHOLD_BOUNDS: Record<string, ThresholdBound> = CANONICAL_THRESHOLD_BOUNDS;

export interface AdaptiveThresholds {
  rsiOversold: number;
  rsiOverbought: number;
  confluenceBuy: number;
  confluenceSell: number;
  confluenceStrongBuy: number;
  confluenceStrongSell: number;
  profitTakeTarget: number;
  profitTakeSellPercent: number;
  stopLossPercent: number;
  trailingStopPercent: number;
  atrStopMultiplier: number;
  atrTrailMultiplier: number;
  [key: string]: number;
}

// Canonical values come from constants.BASE_THRESHOLD_VALUES — single source.
export const DEFAULT_ADAPTIVE_THRESHOLDS: AdaptiveThresholds = {
  rsiOversold: BASE_THRESHOLD_VALUES.rsiOversold,
  rsiOverbought: BASE_THRESHOLD_VALUES.rsiOverbought,
  confluenceBuy: BASE_THRESHOLD_VALUES.confluenceBuy,
  confluenceSell: BASE_THRESHOLD_VALUES.confluenceSell,
  confluenceStrongBuy: BASE_THRESHOLD_VALUES.confluenceStrongBuy,
  confluenceStrongSell: BASE_THRESHOLD_VALUES.confluenceStrongSell,
  profitTakeTarget: BASE_THRESHOLD_VALUES.profitTakeTarget,
  profitTakeSellPercent: BASE_THRESHOLD_VALUES.profitTakeSellPercent,
  stopLossPercent: BASE_THRESHOLD_VALUES.stopLossPercent,
  trailingStopPercent: BASE_THRESHOLD_VALUES.trailingStopPercent,
  atrStopMultiplier: BASE_THRESHOLD_VALUES.atrStopMultiplier,
  atrTrailMultiplier: BASE_THRESHOLD_VALUES.atrTrailMultiplier,
};

/**
 * Clamp a value to [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Clamp all threshold fields to their THRESHOLD_BOUNDS.
 * Replicates the v21.2 restore-time clamping from the monolith.
 */
export function clampAllThresholds(t: AdaptiveThresholds): void {
  for (const [field, bounds] of Object.entries(THRESHOLD_BOUNDS)) {
    const val = t[field];
    if (val !== undefined && typeof val === 'number') {
      t[field] = clamp(val, bounds.min, bounds.max);
    }
  }
}

/**
 * Decay each threshold 5% toward its default value each cycle.
 * Replicates the v21.3 decay logic from agent-v3.2.ts lines 3740-3756.
 *
 * Example: confluenceBuy=20, default=8 -> 20 - (20-8)*0.05 = 19.4
 */
export function decayThresholdsTowardDefaults(
  t: AdaptiveThresholds,
  defaults: AdaptiveThresholds = DEFAULT_ADAPTIVE_THRESHOLDS,
  decayRate: number = 0.05,
): void {
  for (const field of Object.keys(THRESHOLD_BOUNDS)) {
    const currentVal = t[field];
    const defaultVal = defaults[field];
    if (
      currentVal !== undefined &&
      defaultVal !== undefined &&
      typeof currentVal === 'number' &&
      typeof defaultVal === 'number'
    ) {
      const decayed = currentVal - (currentVal - defaultVal) * decayRate;
      const bounds = THRESHOLD_BOUNDS[field];
      t[field] = clamp(decayed, bounds.min, bounds.max);
    }
  }
}

/**
 * Circuit breaker reset: if idle for 2+ hours with high cash, reset thresholds
 * to defaults. This breaks the death spiral where high thresholds block all
 * trades, causing no trades, causing further stagnation.
 */
export function shouldCircuitBreakerReset(
  lastTradeTimestampMs: number | null,
  cashPercent: number,
  nowMs: number = Date.now(),
  idleHoursThreshold: number = 2,
  cashPercentThreshold: number = 40,
): boolean {
  if (lastTradeTimestampMs === null) return false;
  const hoursSinceLastTrade = (nowMs - lastTradeTimestampMs) / (1000 * 60 * 60);
  return hoursSinceLastTrade >= idleHoursThreshold && cashPercent >= cashPercentThreshold;
}

/**
 * Perform a circuit breaker reset: snap all thresholds back to defaults.
 */
export function resetThresholdsToDefaults(
  t: AdaptiveThresholds,
  defaults: AdaptiveThresholds = DEFAULT_ADAPTIVE_THRESHOLDS,
): void {
  for (const field of Object.keys(THRESHOLD_BOUNDS)) {
    if (defaults[field] !== undefined) {
      t[field] = defaults[field];
    }
  }
}
