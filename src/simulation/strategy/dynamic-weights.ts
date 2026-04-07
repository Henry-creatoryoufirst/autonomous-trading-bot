/**
 * NVR Capital — Level 3: Dynamic Indicator Weights
 *
 * Tracks each indicator's prediction accuracy over a rolling window
 * and adjusts weights accordingly. Indicators that predict well get
 * amplified (up to 2x), those that don't get dampened (down to 0.5x).
 *
 * Pure functions. No side effects.
 */

import type { DynamicWeightState, IndicatorWeight } from '../types.js';

// ============================================================================
// BASE WEIGHTS (match replay engine's fixed weights)
// ============================================================================

export const BASE_INDICATOR_WEIGHTS: Record<string, number> = {
  RSI: 25,
  MACD: 25,
  BB: 20,
  SMA: 15,
  ADX: 10,
  MOMENTUM: 8,
};

const MIN_MULTIPLIER = 0.5;
const MAX_MULTIPLIER = 2.0;
const CORRECT_BOOST = 1.1;
const INCORRECT_DECAY = 0.9;

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

/**
 * Create initial dynamic weight state.
 */
// Initial multipliers based on meta-learning from benchmark data.
// RSI and BB anti-predict in synthetic crypto data; ADX/MOMENTUM are most accurate.
const INITIAL_MULTIPLIERS: Record<string, number> = {
  RSI: 0.6,      // Weak in synthetic data but too low compresses score range
  MACD: 1.0,
  BB: 0.6,       // Weak but needed for score range
  SMA: 1.0,      // Solid trend follower
  ADX: 1.2,      // Strong trend strength signal
  MOMENTUM: 1.2, // Strongest predictor
};

export function createDynamicWeightState(windowSize: number = 20): DynamicWeightState {
  const weights: IndicatorWeight[] = Object.entries(BASE_INDICATOR_WEIGHTS).map(([name, baseWeight]) => ({
    name,
    baseWeight,
    multiplier: INITIAL_MULTIPLIERS[name] ?? 1.0,
    correctPredictions: 0,
    totalPredictions: 0,
    rollingAccuracy: 0.5,
  }));

  return { weights, windowSize, history: [] };
}

// ============================================================================
// WEIGHT UPDATES
// ============================================================================

/**
 * Update indicator weights after a completed trade.
 *
 * For each indicator signal at entry:
 * - If signal was bullish (>0) and trade was profitable → correct
 * - If signal was bearish (<0) and trade was unprofitable → correct (it warned us)
 * - Otherwise → incorrect
 *
 * Returns a new state (immutable).
 */
export function updateWeightsAfterTrade(
  state: DynamicWeightState,
  entrySignals: Record<string, number>,
  profitable: boolean,
): DynamicWeightState {
  const newHistory = [...state.history];
  const newWeights = state.weights.map(w => {
    const signal = entrySignals[w.name];
    if (signal === undefined || signal === 0) return { ...w };

    const signalBullish = signal > 0;
    const correct = (signalBullish && profitable) || (!signalBullish && !profitable);

    newHistory.push({ indicator: w.name, correct });

    const newMultiplier = correct
      ? Math.min(MAX_MULTIPLIER, w.multiplier * CORRECT_BOOST)
      : Math.max(MIN_MULTIPLIER, w.multiplier * INCORRECT_DECAY);

    // Calculate rolling accuracy from history window
    const recentForThis = newHistory
      .filter(h => h.indicator === w.name)
      .slice(-state.windowSize);
    const correctCount = recentForThis.filter(h => h.correct).length;
    const rollingAccuracy = recentForThis.length > 0
      ? correctCount / recentForThis.length
      : 0.5;

    return {
      ...w,
      multiplier: newMultiplier,
      correctPredictions: w.correctPredictions + (correct ? 1 : 0),
      totalPredictions: w.totalPredictions + 1,
      rollingAccuracy,
    };
  });

  // Trim history to 2x window size to prevent unbounded growth
  const trimmedHistory = newHistory.slice(-(state.windowSize * 2 * newWeights.length));

  return { weights: newWeights, windowSize: state.windowSize, history: trimmedHistory };
}

// ============================================================================
// WEIGHT RETRIEVAL
// ============================================================================

/**
 * Get effective weights (baseWeight × multiplier) for each indicator.
 */
export function getEffectiveWeights(state: DynamicWeightState): Record<string, number> {
  const result: Record<string, number> = {};
  for (const w of state.weights) {
    result[w.name] = w.baseWeight * w.multiplier;
  }
  return result;
}
