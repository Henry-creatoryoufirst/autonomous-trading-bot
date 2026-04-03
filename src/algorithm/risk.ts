/**
 * Never Rest Capital — Risk Management Functions
 * Extracted from agent-v3.2.ts (Phase 1b refactor)
 *
 * ATR-based stop levels and risk computations.
 */

import type { TokenCostBasis, AdaptiveThresholds } from '../../types/index.js';

// ============================================================================
// ATR STOP LEVELS
// ============================================================================

/** Constants needed for ATR stop computation */
export interface AtrStopConstants {
  ATR_STOP_FLOOR_PERCENT: number;
  ATR_STOP_CEILING_PERCENT: number;
  ATR_TRAIL_ACTIVATION_MULTIPLIER: number;
  SECTOR_ATR_MULTIPLIERS: Record<string, number>;
}

/**
 * Compute ATR-based dynamic stop-loss and trailing-stop levels.
 * - Only tightens stops: Math.max(newStop, existingStop) — both negative, max = tighter
 * - Trail activates when unrealized gain >= ATR_TRAIL_ACTIVATION_MULTIPLIER × atrPercent
 * - Trail never moves down (ratchet up only)
 *
 * @param adaptiveThresholds  Current adaptive thresholds (for atrStopMultiplier, atrTrailMultiplier)
 */
export function computeAtrStopLevels(
  symbol: string,
  sector: string | undefined,
  atrPercent: number | null,
  currentPrice: number,
  costBasis: TokenCostBasis,
  adaptiveThresholds: Pick<AdaptiveThresholds, 'atrStopMultiplier' | 'atrTrailMultiplier'>,
  constants: AtrStopConstants,
): { stopPercent: number; trailPercent: number; trailActivated: boolean } | null {
  if (atrPercent === null || atrPercent <= 0) return null;

  const sectorKey = sector || "BLUE_CHIP";
  const sectorMult = constants.SECTOR_ATR_MULTIPLIERS[sectorKey] || 2.5;
  const adaptiveStopMult = adaptiveThresholds.atrStopMultiplier;
  const adaptiveTrailMult = adaptiveThresholds.atrTrailMultiplier;

  const computedStop = -(sectorMult * adaptiveStopMult * atrPercent);
  const clampedStop = Math.max(constants.ATR_STOP_FLOOR_PERCENT, Math.min(constants.ATR_STOP_CEILING_PERCENT, computedStop));

  let finalStop = clampedStop;
  if (costBasis.atrStopPercent !== null) {
    finalStop = Math.max(clampedStop, costBasis.atrStopPercent);
  }

  const computedTrail = -(adaptiveTrailMult * atrPercent);
  const clampedTrail = Math.max(constants.ATR_STOP_FLOOR_PERCENT, Math.min(constants.ATR_STOP_CEILING_PERCENT, computedTrail));

  let finalTrail = clampedTrail;
  if (costBasis.atrTrailPercent !== null) {
    finalTrail = Math.max(clampedTrail, costBasis.atrTrailPercent);
  }

  const gainPercent = costBasis.averageCostBasis > 0
    ? ((currentPrice - costBasis.averageCostBasis) / costBasis.averageCostBasis) * 100
    : 0;
  const activationThreshold = constants.ATR_TRAIL_ACTIVATION_MULTIPLIER * atrPercent;
  const trailActivated = costBasis.trailActivated || gainPercent >= activationThreshold;

  return {
    stopPercent: finalStop,
    trailPercent: finalTrail,
    trailActivated,
  };
}
