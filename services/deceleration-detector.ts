/**
 * v14.1: Momentum Deceleration Detector (Smart Trim)
 * Detects when buy-side momentum is decelerating on a winning position
 * and signals graduated trims before a full momentum exit triggers.
 *
 * Operates ABOVE the 45% momentum-exit threshold — trims gradually
 * as momentum fades rather than waiting for a full collapse.
 */

import {
  DECEL_HISTORY_LENGTH,
  DECEL_MIN_DROP_FROM_PEAK,
  DECEL_MIN_CYCLES,
  DECEL_BASE_TRIM_PCT,
  DECEL_MODERATE_THRESHOLD,
  DECEL_SEVERE_THRESHOLD,
  DECEL_MAX_TRIM_PCT,
  DECEL_MIN_POSITION_USD,
  DECEL_TRIM_COOLDOWN_SEC,
  DECEL_MIN_PROFIT_PCT,
} from '../config/constants.js';

export interface DecelState {
  buyRatioHistory: number[];
  peakBuyRatio: number;
  decelCycles: number;
  lastTrimTime: number;
}

export interface TrimSignal {
  shouldTrim: boolean;
  trimPercent: number;
  reason: string;
  acceleration: number;
  velocity: number;
}

/** Create a fresh decel state for a new token */
export function createDecelState(): DecelState {
  return {
    buyRatioHistory: [],
    peakBuyRatio: 0,
    decelCycles: 0,
    lastTrimTime: 0,
  };
}

/**
 * Push a new buy ratio reading, maintain history length, update peak.
 */
export function updateBuyRatioHistory(state: DecelState, currentBuyRatio: number): void {
  state.buyRatioHistory.push(currentBuyRatio);
  if (state.buyRatioHistory.length > DECEL_HISTORY_LENGTH) {
    state.buyRatioHistory = state.buyRatioHistory.slice(-DECEL_HISTORY_LENGTH);
  }
  if (currentBuyRatio > state.peakBuyRatio) {
    state.peakBuyRatio = currentBuyRatio;
  }
}

/**
 * Core deceleration detection algorithm.
 * Returns a trim signal with sizing based on severity.
 */
export function detectDeceleration(
  state: DecelState,
  positionGainPct: number,
  positionValueUSD: number,
): TrimSignal {
  const noTrim: TrimSignal = { shouldTrim: false, trimPercent: 0, reason: '', acceleration: 0, velocity: 0 };
  const h = state.buyRatioHistory;

  // Need at least 3 readings for velocity + acceleration
  if (h.length < 3) return noTrim;

  // Calculate velocity (difference between last two readings)
  const velocity = h[h.length - 1] - h[h.length - 2];

  // Calculate acceleration (difference between last two velocities)
  const prevVelocity = h[h.length - 2] - h[h.length - 3];
  const acceleration = velocity - prevVelocity;

  // Current buy ratio
  const current = h[h.length - 1];

  // --- Gate checks (ALL must pass) ---

  // 1. Buy ratio still above momentum-exit threshold (>45%)
  if (current <= 45) return noTrim;

  // 2. Acceleration must be negative (momentum decelerating)
  if (acceleration >= 0) {
    state.decelCycles = 0; // reset consecutive count
    return noTrim;
  }

  // 3. Drop from peak must be significant
  const dropFromPeak = state.peakBuyRatio - current;
  if (dropFromPeak < DECEL_MIN_DROP_FROM_PEAK) return noTrim;

  // 4. Position must be profitable enough
  if (positionGainPct < DECEL_MIN_PROFIT_PCT) return noTrim;

  // 5. Position must be worth trimming
  if (positionValueUSD < DECEL_MIN_POSITION_USD) return noTrim;

  // 6. Cooldown check
  const secSinceLastTrim = (Date.now() - state.lastTrimTime) / 1000;
  if (state.lastTrimTime > 0 && secSinceLastTrim < DECEL_TRIM_COOLDOWN_SEC) return noTrim;

  // Increment consecutive deceleration cycles
  state.decelCycles++;

  // 7. Need enough consecutive decel cycles
  if (state.decelCycles < DECEL_MIN_CYCLES) return noTrim;

  // --- Trim sizing based on severity ---
  let trimPct = DECEL_BASE_TRIM_PCT; // 10% base
  let severity = 'mild';

  if (acceleration < -DECEL_SEVERE_THRESHOLD) {
    trimPct = 25;
    severity = 'severe';
  } else if (acceleration < -DECEL_MODERATE_THRESHOLD) {
    trimPct = 15;
    severity = 'moderate';
  }

  // Escalation multiplier for extended deceleration (4+ cycles)
  if (state.decelCycles >= 4) {
    trimPct = Math.round(trimPct * 1.5);
    severity += '+escalated';
  }

  // Cap at max
  trimPct = Math.min(trimPct, DECEL_MAX_TRIM_PCT);

  const reason = `${severity} decel (accel=${acceleration.toFixed(1)}, vel=${velocity.toFixed(1)}, peak=${state.peakBuyRatio.toFixed(0)}→${current.toFixed(0)}, drop=${dropFromPeak.toFixed(0)}pts, cycles=${state.decelCycles})`;

  return {
    shouldTrim: true,
    trimPercent: trimPct,
    reason,
    acceleration,
    velocity,
  };
}
