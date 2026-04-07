/**
 * NVR Capital — Level 2: Regime Detection
 *
 * Classifies current market structure from price data into one of four regimes:
 * TRENDING, RANGING, VOLATILE, BREAKOUT. Uses ADX, ATR%, BB bandwidth,
 * and SMA direction. Includes smoothing to prevent whipsaw transitions.
 *
 * Pure functions. No side effects.
 */

import { calculateADX, calculateATR, calculateBollingerBands, calculateSMA } from '../../algorithm/indicators.js';
import type { RegimeState, SimRegime } from '../types.js';

// ============================================================================
// REGIME DETECTION
// ============================================================================

/**
 * Detect the current market regime from close prices.
 *
 * Priority:
 * 1. VOLATILE — ATR% > 4 or BB bandwidth > 12
 * 2. BREAKOUT — Recent BB squeeze (width < 3) followed by expansion (> 5)
 * 3. TRENDING — ADX >= 25 with clear SMA direction
 * 4. RANGING — Everything else
 */
export function detectRegime(closePrices: number[]): RegimeState {
  const adxData = calculateADX(closePrices);
  const atrData = calculateATR(closePrices);
  const bbData = calculateBollingerBands(closePrices);
  const sma20 = calculateSMA(closePrices, 20);
  const sma50 = calculateSMA(closePrices, 50);
  const currentPrice = closePrices[closePrices.length - 1];

  const adx = adxData?.adx ?? 15;
  const atrPercent = atrData?.atrPercent ?? 2;
  const bbBandwidth = bbData?.bandwidth ?? 5;

  // Determine trend direction from SMA alignment
  let trendDirection: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
  if (sma20 !== null && sma50 !== null) {
    if (currentPrice > sma20 && sma20 > sma50) trendDirection = 'UP';
    else if (currentPrice < sma20 && sma20 < sma50) trendDirection = 'DOWN';
  } else if (sma20 !== null) {
    trendDirection = currentPrice > sma20 ? 'UP' : 'DOWN';
  }

  // 1. VOLATILE
  if (atrPercent > 4 || bbBandwidth > 12) {
    const confidence = Math.min(1, Math.max(0.5, (atrPercent - 3) / 4));
    return { regime: 'VOLATILE', confidence, adx, atrPercent, bbBandwidth, trendDirection };
  }

  // 2. BREAKOUT — check for recent BB squeeze then expansion
  if (closePrices.length >= 60) {
    const isBreakout = detectBreakout(closePrices, bbBandwidth);
    if (isBreakout) {
      const confidence = Math.min(1, Math.max(0.5, (bbBandwidth - 4) / 6));
      return { regime: 'BREAKOUT', confidence, adx, atrPercent, bbBandwidth, trendDirection };
    }
  }

  // 3. TRENDING — ADX >= 20 with clear direction (lowered from 25 for synthetic data)
  if (adx >= 20 && trendDirection !== 'FLAT') {
    const confidence = Math.min(1, Math.max(0.4, (adx - 15) / 25));
    return { regime: 'TRENDING', confidence, adx, atrPercent, bbBandwidth, trendDirection };
  }

  // Also catch strong directional movement even with moderate ADX
  if (adx >= 15 && atrPercent > 2 && trendDirection !== 'FLAT') {
    const confidence = Math.min(0.7, Math.max(0.3, (adx - 10) / 20));
    return { regime: 'TRENDING', confidence, adx, atrPercent, bbBandwidth, trendDirection };
  }

  // 4. RANGING
  const confidence = Math.min(1, Math.max(0.5, (20 - adx) / 10));
  return { regime: 'RANGING', confidence, adx, atrPercent, bbBandwidth, trendDirection };
}

/**
 * Detect breakout: BB bandwidth was < 3 within the last 10 periods,
 * and current bandwidth > 5 (squeeze-then-expansion pattern).
 */
function detectBreakout(closePrices: number[], currentBandwidth: number): boolean {
  if (currentBandwidth < 5) return false;

  // Check if there was a squeeze in the recent past
  const lookback = Math.min(10, closePrices.length - 20);
  for (let i = 1; i <= lookback; i++) {
    const slice = closePrices.slice(0, closePrices.length - i);
    if (slice.length < 20) break;
    const bb = calculateBollingerBands(slice);
    if (bb && bb.bandwidth !== undefined && bb.bandwidth < 3) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// REGIME SMOOTHING
// ============================================================================

/**
 * Smooth regime transitions to prevent whipsaw.
 * Requires `minConsecutive` candles in a new regime before switching.
 *
 * Returns the smoothed regime and updated history (pure function).
 */
export function smoothedRegime(
  current: RegimeState,
  history: RegimeState[],
  minConsecutive: number = 3,
): { regime: SimRegime; confidence: number; history: RegimeState[] } {
  const updated = [...history, current].slice(-20);

  if (updated.length < minConsecutive) {
    return { regime: current.regime, confidence: current.confidence, history: updated };
  }

  // Check if the last N entries all agree on a regime
  const recent = updated.slice(-minConsecutive);
  const allSame = recent.every(r => r.regime === current.regime);

  if (allSame) {
    return { regime: current.regime, confidence: current.confidence, history: updated };
  }

  // Keep the previous stable regime
  const prevStable = findLastStableRegime(updated, minConsecutive);
  return {
    regime: prevStable?.regime ?? current.regime,
    confidence: prevStable?.confidence ?? current.confidence * 0.7,
    history: updated,
  };
}

function findLastStableRegime(
  history: RegimeState[],
  minConsecutive: number,
): RegimeState | null {
  for (let i = history.length - minConsecutive; i >= 0; i--) {
    const slice = history.slice(i, i + minConsecutive);
    if (slice.every(r => r.regime === slice[0].regime)) {
      return slice[slice.length - 1];
    }
  }
  return null;
}
