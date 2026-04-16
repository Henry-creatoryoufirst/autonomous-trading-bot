/**
 * Never Rest Capital — Portfolio Module
 *
 * Barrel export for cost basis, harvest manager, and valuation utilities.
 */

export { getOrCreateCostBasis, updateCostBasisAfterBuy, updateCostBasisAfterSell, updateUnrealizedPnL, rebuildCostBasisFromTrades } from './cost-basis.js';

// Phase 4: harvest manager + pure valuation utilities
export { HarvestManager } from './harvest-manager.js';
export type { HarvestManagerDeps } from './harvest-manager.js';
export { detectPhantomMoves, isRealLargeDrawdown } from './valuation.js';
export type { BalanceEntry, PhantomDetectionInput, PhantomDetectionResult } from './valuation.js';

// Phase 5f: position sizing pure helpers
export {
  computeVolatilityMultiplier,
  computeConfidenceMultiplier,
  combinePositionMultipliers,
  computeCatchingFireMultiplier,
  computeDeploymentFloor,
} from './position-sizing.js';
