/**
 * NVR Capital — Capital Sleeves: State migration helpers.
 *
 * Phase 1.2 introduces per-sleeve state on AgentState. Existing bots have
 * state files that predate these fields. These helpers bring an older state
 * into the new shape without losing history:
 *   - All existing positions → assigned to the 'core' sleeve
 *   - Empty ownership records created for any other registered sleeves
 *   - Default allocation {core: 1.0} applied if none set
 *   - Default config seeded if missing
 *
 * Called once at startup AFTER state is loaded but BEFORE the first cycle.
 * Idempotent — safe to run on already-migrated state.
 *
 * See NVR-SPEC-010 §"Migration path".
 */

import type {
  SleeveConfig,
  SleeveOwnership,
} from './state-types.js';
import type { SleevePosition, Sleeve } from './types.js';
import type { TokenCostBasis, TradeRecord } from '../types/index.js';

/**
 * Subset of AgentState the migration touches. Kept narrow so the helper is
 * trivial to test with mock data and isn't coupled to the full state shape.
 */
export interface MigratableState {
  costBasis: Record<string, TokenCostBasis>;
  tradeHistory: TradeRecord[];
  totalCycles: number;
  sleeveOwnership?: Record<string, SleeveOwnership>;
  sleeveAllocation?: Record<string, number>;
  sleeveConfig?: SleeveConfig;
}

/**
 * Empty ownership record. Used when a sleeve is newly registered on an
 * existing bot — no positions, no history yet. Accumulates shadow decisions
 * from day 1 so by the time the sleeve might graduate there's evidence.
 */
export function emptySleeveOwnership(nowIso: string = new Date().toISOString()): SleeveOwnership {
  return {
    positions: {},
    realizedPnLUSD: 0,
    trades: 0,
    wins: 0,
    dailyPayouts: [],
    regimeReturns: {},
    decisions: [],
    lastDecisionAt: null,
    createdAt: nowIso,
  };
}

/**
 * Convert the bot's global cost basis into sleeve positions owned by Core.
 * Called on first migration only; subsequent runs see ownership already
 * populated and skip this.
 *
 * Realized P&L is summed from the global cost-basis entries — this gives
 * Core credit for all history since the bot was born (the pre-sleeve world
 * ≡ Core at 100%).
 */
export function coreOwnershipFromGlobalState(
  costBasis: Record<string, TokenCostBasis>,
  nowIso: string = new Date().toISOString(),
): SleeveOwnership {
  const positions: Record<string, SleevePosition> = {};
  for (const [symbol, cb] of Object.entries(costBasis)) {
    if (!cb || !cb.currentHolding || cb.currentHolding <= 0) continue;
    positions[symbol] = {
      symbol,
      balance: cb.currentHolding,
      costBasisUSD: (cb.averageCostBasis || 0) * cb.currentHolding,
      valueUSD: 0, // filled on first mark-to-market; exact value unknown here
      openedAt: cb.firstBuyDate || nowIso,
      openedInCycle: 0,
    };
  }
  return {
    positions,
    realizedPnLUSD: sumRealizedPnL(costBasis),
    trades: 0, // populated on first write-back post-migration, not backfilled
    wins: 0,
    dailyPayouts: [],
    regimeReturns: {},
    decisions: [],
    lastDecisionAt: null,
    createdAt: nowIso,
  };
}

function sumRealizedPnL(costBasis: Record<string, TokenCostBasis>): number {
  return Object.values(costBasis).reduce((sum, cb) => sum + (cb?.realizedPnL || 0), 0);
}

/**
 * Bring a state object up to the Phase 1.2 sleeve schema. Idempotent.
 *
 * Steps:
 *   1. Create ownership records for every registered sleeve (Core inherits
 *      existing positions; Alpha sleeves start empty)
 *   2. Seed default allocation {core: 1.0} if none present
 *   3. Seed default config if missing
 *
 * @param state      bot state (mutated in place)
 * @param sleeves    currently-registered sleeves (from sleeveRegistry.sleeves())
 * @returns          the same state, now with sleeve fields populated
 */
export function migrateStateToSleeves<S extends MigratableState>(
  state: S,
  sleeves: ReadonlyArray<Sleeve>,
): S {
  const now = new Date().toISOString();

  // 1. Ensure sleeveOwnership exists with an entry per registered sleeve
  if (!state.sleeveOwnership) state.sleeveOwnership = {};
  for (const sleeve of sleeves) {
    if (state.sleeveOwnership[sleeve.id]) continue;
    // New sleeve on existing bot — create ownership
    if (sleeve.id === 'core' && Object.keys(state.costBasis || {}).length > 0) {
      state.sleeveOwnership[sleeve.id] = coreOwnershipFromGlobalState(state.costBasis, now);
    } else {
      state.sleeveOwnership[sleeve.id] = emptySleeveOwnership(now);
    }
  }

  // 2. Ensure sleeveAllocation has an entry per registered sleeve; default
  //    to core: 1.0, others: 0 (paper sleeves graduate via SPEC-016)
  if (!state.sleeveAllocation) state.sleeveAllocation = {};
  for (const sleeve of sleeves) {
    if (state.sleeveAllocation[sleeve.id] !== undefined) continue;
    state.sleeveAllocation[sleeve.id] = sleeve.id === 'core' ? 1.0 : 0.0;
  }

  // 3. Seed default config if missing
  if (!state.sleeveConfig) {
    state.sleeveConfig = {
      allocations: { ...state.sleeveAllocation },
      enabled: Object.fromEntries(sleeves.map((s) => [s.id, true])),
      modeOverrides: {},
      updatedAt: now,
    };
  } else {
    // Fill in any missing sleeve entries in config (new sleeve registered on
    // an already-migrated bot)
    for (const sleeve of sleeves) {
      if (state.sleeveConfig.enabled[sleeve.id] === undefined) {
        state.sleeveConfig.enabled[sleeve.id] = true;
      }
      if (state.sleeveConfig.allocations[sleeve.id] === undefined) {
        state.sleeveConfig.allocations[sleeve.id] = state.sleeveAllocation[sleeve.id] ?? 0;
      }
    }
  }

  return state;
}
