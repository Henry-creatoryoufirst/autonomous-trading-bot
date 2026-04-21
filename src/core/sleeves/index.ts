/**
 * NVR Capital — Capital Sleeves: barrel export.
 *
 * See NVR-SPEC-010 for the architecture.
 */

export type {
  Sleeve,
  SleeveMode,
  SleeveContext,
  SleeveDecision,
  SleeveAction,
  SleevePosition,
  SleeveStats,
  SharedMarketContext,
  CapitalAllocator,
} from './types.js';

export { CoreSleeve, computeRollingSharpe7d } from './core-sleeve.js';
export type {
  CoreSleeveOptions,
  CoreSleeveStateView,
  CoreDecideFn,
} from './core-sleeve.js';

export { AlphaHunterSleeve } from './alpha-hunter.js';
export type { AlphaHunterSleeveOptions } from './alpha-hunter.js';

export { AlphaRotationSleeve } from './alpha-rotation.js';
export type { AlphaRotationSleeveOptions } from './alpha-rotation.js';

export { StaticAllocator, defaultStaticAllocator } from './allocator.js';

export { buildDefaultRegistry, buildRegistry } from './registry.js';
export type { SleeveRegistry, DefaultRegistryOptions } from './registry.js';

// v21.15 Phase 1.2a: per-sleeve state schema
export { statsFromOwnership } from './sleeve-stats.js';
export {
  migrateStateToSleeves,
  emptySleeveOwnership,
  coreOwnershipFromGlobalState,
} from './migration.js';
export type { MigratableState } from './migration.js';
export type {
  SleeveOwnership,
  SleeveDecisionLog,
  SleeveDecisionMode,
  SleeveRegimeReturns,
  SleeveConfig,
} from './state-types.js';
export {
  MAX_DECISIONS_PER_SLEEVE,
  MAX_REGIME_SAMPLES,
} from './state-types.js';
