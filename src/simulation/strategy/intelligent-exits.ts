/**
 * NVR Capital — Level 4: Intelligent Exits
 *
 * Replaces fixed profit tiers with momentum-aware, ATR-based exit logic.
 * Holds when momentum confirms, cuts when momentum diverges,
 * adapts trailing stops to current momentum strength.
 *
 * Pure functions. No side effects.
 */

import { calculateRSI, calculateMACD, calculateATR } from '../../algorithm/indicators.js';
import type { ExitSignal, DynamicProfitTargets, AdaptivePosition, StrategyParams } from '../types.js';

// ============================================================================
// MOMENTUM-BASED EXIT
// ============================================================================

/**
 * Evaluate whether momentum supports holding a long position.
 */
export function evaluateMomentumExit(
  closePrices: number[],
  position: AdaptivePosition,
  currentPrice: number,
): ExitSignal {
  const rsi = calculateRSI(closePrices);
  const macd = calculateMACD(closePrices);
  const gainPct = ((currentPrice - position.costBasis) / position.costBasis) * 100;

  // Only applies to profitable positions
  if (gainPct < 2) {
    return { type: 'HOLD', reason: 'MOMENTUM_NA', urgency: 0, suggestedSellFraction: 0 };
  }

  const rsiBearish = rsi !== null && rsi < 40;
  const macdBearish = macd?.signal === 'BEARISH';

  if (rsiBearish && macdBearish) {
    return { type: 'EXIT', reason: 'MOMENTUM_DIVERGE', urgency: 0.8, suggestedSellFraction: 1.0 };
  }

  if (rsiBearish || macdBearish) {
    return { type: 'REDUCE', reason: 'MOMENTUM_WEAKENING', urgency: 0.4, suggestedSellFraction: 0.3 };
  }

  return { type: 'HOLD', reason: 'MOMENTUM_CONFIRMS', urgency: 0, suggestedSellFraction: 0 };
}

// ============================================================================
// TIME DECAY
// ============================================================================

/**
 * Reduce stale positions that haven't moved significantly.
 */
export function evaluateTimeDecay(
  position: AdaptivePosition,
  currentPrice: number,
  atrPercent: number,
  maxStaleCandles: number = 72,
): ExitSignal {
  if (position.candlesHeld < maxStaleCandles) {
    return { type: 'HOLD', reason: 'NOT_STALE', urgency: 0, suggestedSellFraction: 0 };
  }

  const movePct = Math.abs((currentPrice - position.costBasis) / position.costBasis) * 100;

  // Position hasn't moved by even 1 ATR — it's dead weight
  if (movePct < atrPercent) {
    return { type: 'REDUCE', reason: 'TIME_DECAY', urgency: 0.3, suggestedSellFraction: 0.25 };
  }

  return { type: 'HOLD', reason: 'MOVING_OK', urgency: 0, suggestedSellFraction: 0 };
}

// ============================================================================
// ADAPTIVE TRAILING STOP
// ============================================================================

/**
 * Adjust trailing stop percentage based on current momentum.
 * Strong momentum → wider trail (let winners run).
 * Weak momentum → tighter trail (protect gains).
 */
export function adaptiveTrailingStop(
  baseTrailingPct: number,
  closePrices: number[],
): number {
  const rsi = calculateRSI(closePrices);
  if (rsi === null) return baseTrailingPct;

  if (rsi > 60) {
    // Strong momentum — widen trail
    const strength = Math.min(1, (rsi - 60) / 20); // 0 at RSI=60, 1 at RSI=80
    return baseTrailingPct * (1 + 0.3 * strength); // up to 1.3x
  }

  if (rsi < 40) {
    // Weak momentum — tighten trail
    const weakness = Math.min(1, (40 - rsi) / 20); // 0 at RSI=40, 1 at RSI=20
    return baseTrailingPct * (1 - 0.3 * weakness); // down to 0.7x
  }

  return baseTrailingPct;
}

// ============================================================================
// DYNAMIC PROFIT TARGETS
// ============================================================================

/**
 * Calculate ATR-based profit targets instead of fixed percentages.
 */
export function calculateDynamicProfitTargets(
  closePrices: number[],
  entryPrice: number,
): DynamicProfitTargets {
  const atrData = calculateATR(closePrices);
  const atrValue = atrData ? atrData.atr : entryPrice * 0.03;
  const atrPercent = atrData ? atrData.atrPercent : 3;

  return {
    target1: entryPrice + atrValue * 1.5,
    target2: entryPrice + atrValue * 3.0,
    target3: entryPrice + atrValue * 5.0,
    atrValue,
    atrPercent,
  };
}

// ============================================================================
// MASTER EXIT EVALUATOR
// ============================================================================

/**
 * Evaluate all exit signals and return the highest-urgency one.
 * Checks in priority order: stop loss → trailing stop → time decay →
 * momentum exit → dynamic profit targets → confluence sell.
 */
export function evaluateExit(
  closePrices: number[],
  position: AdaptivePosition,
  currentPrice: number,
  effectiveParams: StrategyParams,
  confluenceScore: number,
): ExitSignal {
  const gainPct = ((currentPrice - position.costBasis) / position.costBasis) * 100;

  // 1. Hard stop loss (ATR-adaptive)
  const atrData = calculateATR(closePrices);
  const atrPct = atrData?.atrPercent ?? 0;
  const adaptiveStopLoss = atrPct > 3
    ? Math.min(effectiveParams.stopLossPercent * 2, effectiveParams.stopLossPercent + atrPct)
    : effectiveParams.stopLossPercent;

  if (gainPct <= -adaptiveStopLoss) {
    return { type: 'EXIT', reason: `STOP_LOSS (${gainPct.toFixed(1)}%)`, urgency: 1.0, suggestedSellFraction: 1.0 };
  }

  // 2. Adaptive trailing stop
  if (gainPct >= 3 && position.peakPrice > position.costBasis) {
    const trailPct = adaptiveTrailingStop(effectiveParams.trailingStopPercent ?? 10, closePrices);
    const dropFromPeak = ((position.peakPrice - currentPrice) / position.peakPrice) * 100;
    if (dropFromPeak >= trailPct) {
      return { type: 'EXIT', reason: `TRAILING_STOP (drop=${dropFromPeak.toFixed(1)}%)`, urgency: 0.9, suggestedSellFraction: 1.0 };
    }
  }

  // 3. Time decay
  const timeDecay = evaluateTimeDecay(position, currentPrice, atrPct);
  if (timeDecay.type !== 'HOLD') return timeDecay;

  // 4. Momentum exit
  const momentum = evaluateMomentumExit(closePrices, position, currentPrice);
  if (momentum.type === 'EXIT') return momentum;

  // 5. Dynamic profit targets (ATR-based tiers)
  const targets = calculateDynamicProfitTargets(closePrices, position.costBasis);
  if (currentPrice >= targets.target3 && position.lastHarvestTier < 3) {
    return { type: 'REDUCE', reason: `PROFIT_T3 (${gainPct.toFixed(1)}%)`, urgency: 0.7, suggestedSellFraction: 0.5 };
  }
  if (currentPrice >= targets.target2 && position.lastHarvestTier < 2) {
    return { type: 'REDUCE', reason: `PROFIT_T2 (${gainPct.toFixed(1)}%)`, urgency: 0.6, suggestedSellFraction: 0.4 };
  }
  if (currentPrice >= targets.target1 && position.lastHarvestTier < 1) {
    return { type: 'REDUCE', reason: `PROFIT_T1 (${gainPct.toFixed(1)}%)`, urgency: 0.5, suggestedSellFraction: 0.3 };
  }

  // 6. Momentum reduce (weaker signal)
  if (momentum.type === 'REDUCE') return momentum;

  // 7. Confluence sell signal
  if (confluenceScore <= effectiveParams.confluenceSellThreshold) {
    return { type: 'REDUCE', reason: `SIGNAL_SELL (conf=${confluenceScore})`, urgency: 0.4, suggestedSellFraction: 0.5 };
  }

  return { type: 'HOLD', reason: 'NO_EXIT_SIGNAL', urgency: 0, suggestedSellFraction: 0 };
}
