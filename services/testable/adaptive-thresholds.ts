/**
 * Extracted adaptive threshold logic from agent-v3.2.ts for unit testing.
 * Faithfully replicates the monolith's THRESHOLD_BOUNDS, defaults, decay, and clamping.
 */

export interface ThresholdBound {
  min: number;
  max: number;
  maxStep: number;
}

export const THRESHOLD_BOUNDS: Record<string, ThresholdBound> = {
  rsiOversold:           { min: 20, max: 40, maxStep: 2 },
  rsiOverbought:         { min: 60, max: 80, maxStep: 2 },
  confluenceBuy:         { min: 5,  max: 20, maxStep: 2 },
  confluenceSell:        { min: -30, max: -5, maxStep: 2 },
  confluenceStrongBuy:   { min: 25, max: 38, maxStep: 3 },
  confluenceStrongSell:  { min: -60, max: -25, maxStep: 3 },
  profitTakeTarget:      { min: 10, max: 40, maxStep: 2 },
  profitTakeSellPercent: { min: 15, max: 50, maxStep: 3 },
  stopLossPercent:       { min: -25, max: -12, maxStep: 2 },
  trailingStopPercent:   { min: -20, max: -10, maxStep: 2 },
  atrStopMultiplier:     { min: 1.5, max: 4.0, maxStep: 0.25 },
  atrTrailMultiplier:    { min: 1.5, max: 4.0, maxStep: 0.25 },
};

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

export const DEFAULT_ADAPTIVE_THRESHOLDS: AdaptiveThresholds = {
  rsiOversold: 30,
  rsiOverbought: 70,
  confluenceBuy: 8,
  confluenceSell: -8,
  confluenceStrongBuy: 30,
  confluenceStrongSell: -30,
  profitTakeTarget: 30,
  profitTakeSellPercent: 30,
  stopLossPercent: -15,
  trailingStopPercent: -12,
  atrStopMultiplier: 2.5,
  atrTrailMultiplier: 2.0,
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
