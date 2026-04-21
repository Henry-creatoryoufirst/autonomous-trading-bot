/**
 * NVR Capital — Capital Sleeves: Shared stats helper.
 *
 * v21.15 Phase 1.2a: every sleeve other than Core reads its stats out of
 * its SleeveOwnership record. This helper centralizes that computation so
 * all sleeves report uniformly. Core keeps its legacy path (reading from
 * global costBasis + tradeHistory) for now; it migrates onto this helper
 * in Phase 1.2b once per-sleeve write-back is live.
 */

import type { SleeveOwnership } from './state-types.js';
import type { SleeveStats } from './types.js';
import { computeRollingSharpe7d } from './core-sleeve.js';

const ZERO_STATS: SleeveStats = {
  realizedPnLUSD: 0,
  unrealizedPnLUSD: 0,
  trades: 0,
  winRate: 0,
  rollingSharpe7d: null,
  lastDecisionAt: null,
};

/**
 * Compute SleeveStats from a SleeveOwnership record.
 *
 * When ownership is undefined (sleeve registered but not yet migrated),
 * returns zeroed stats — matches the CoreSleeve Phase 1 "no state provider"
 * behavior for consistency.
 *
 * Unrealized P&L is computed from positions' valueUSD (set by the
 * mark-to-market pass each cycle) minus costBasisUSD. If valueUSD is
 * zero (fresh migration, no mark yet), unrealized reports zero — the
 * dashboard should prefer realized + portfolio-value as ground truth until
 * the first mark-to-market lands.
 */
export function statsFromOwnership(
  ownership: SleeveOwnership | undefined,
  portfolioValue: number,
): SleeveStats {
  if (!ownership) return ZERO_STATS;

  const unrealizedPnLUSD = Object.values(ownership.positions).reduce(
    (sum, p) => sum + ((p.valueUSD ?? 0) - (p.costBasisUSD ?? 0)),
    0,
  );

  const winRate = ownership.trades > 0
    ? (ownership.wins / ownership.trades) * 100
    : 0;

  return {
    realizedPnLUSD: ownership.realizedPnLUSD,
    unrealizedPnLUSD,
    trades: ownership.trades,
    winRate,
    rollingSharpe7d: computeRollingSharpe7d(ownership.dailyPayouts, portfolioValue),
    lastDecisionAt: ownership.lastDecisionAt,
  };
}
