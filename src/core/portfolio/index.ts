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

// v21.18 — ground-truth cost basis rebuild + migration
export {
  rebuildFromGroundTruth,
  diffAgainstExisting,
  applyRebuiltCostBasis,
  type RebuildInputs,
  type RebuildResult,
  type RebuildDiff,
  type OnChainTransfer,
} from './rebuild.js';
export {
  runMigrationV2118,
  runMigrationV2118InMonolith,
  MIGRATION_FLAG_KEY,
  MIGRATION_VERSION,
} from './migration-v21-18.js';
