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

export { CoreSleeve } from './core-sleeve.js';
export type {
  CoreSleeveOptions,
  CoreSleeveStateView,
  CoreDecideFn,
} from './core-sleeve.js';

export { StaticAllocator, defaultStaticAllocator } from './allocator.js';

export { buildDefaultRegistry, buildRegistry } from './registry.js';
export type { SleeveRegistry, DefaultRegistryOptions } from './registry.js';
