/**
 * NVR Capital — Capital Sleeves: Registry
 *
 * The registry is the single source of truth for which sleeves are installed
 * on a running bot. It is populated at startup and consumed by the heavy-
 * cycle orchestrator + dashboard API.
 *
 * SCAFFOLDING v1: the registry is callable but nothing consumes it yet.
 * Introducing it lets subsequent changes reference a stable place for
 * sleeves to live without another round of infrastructure work.
 *
 * See NVR-SPEC-010 §"Migration path".
 */

import type { CapitalAllocator, Sleeve } from './types.js';
import {
  CoreSleeve,
  type CoreSleeveStateView,
  type CoreDecideFn,
} from './core-sleeve.js';
import { defaultStaticAllocator } from './allocator.js';

export interface DefaultRegistryOptions {
  /**
   * Provider for the Core sleeve's stats. Called on each `getStats()`.
   * Typically `() => ({ costBasis: state.costBasis, tradeHistory: state.tradeHistory })`.
   * Omit in tests or during early boot.
   */
  getCoreState?: () => CoreSleeveStateView;
  /**
   * Delegate invoked when the orchestrator calls `coreSleeve.decide()`.
   * Typically wraps the bot's existing `makeTradeDecision()` pipeline.
   * Omit to leave the Core sleeve as a no-op (Phase 1 behavior).
   */
  coreDecideFn?: CoreDecideFn;
}

export interface SleeveRegistry {
  sleeves(): ReadonlyArray<Sleeve>;
  allocator(): CapitalAllocator;
  /** Look up a sleeve by id. Returns `undefined` if not installed. */
  get(id: string): Sleeve | undefined;
}

class InMemorySleeveRegistry implements SleeveRegistry {
  private readonly _sleeves: ReadonlyArray<Sleeve>;
  private readonly _allocator: CapitalAllocator;

  constructor(sleeves: ReadonlyArray<Sleeve>, allocator: CapitalAllocator) {
    const ids = new Set<string>();
    for (const s of sleeves) {
      if (ids.has(s.id)) {
        throw new Error(`SleeveRegistry: duplicate sleeve id '${s.id}'.`);
      }
      ids.add(s.id);
    }
    this._sleeves = sleeves;
    this._allocator = allocator;
  }

  sleeves(): ReadonlyArray<Sleeve> {
    return this._sleeves;
  }

  allocator(): CapitalAllocator {
    return this._allocator;
  }

  get(id: string): Sleeve | undefined {
    return this._sleeves.find((s) => s.id === id);
  }
}

/**
 * Returns the default v1 registry: a single CoreSleeve at 100%. This is
 * what the bot ships with until alpha sleeves are introduced.
 *
 * The registry is intentionally NOT a singleton module-level export — the
 * orchestrator constructs it during startup so it can be replaced in tests
 * and swapped per-bot (e.g., family bots may disable alpha sleeves).
 *
 * Pass `getCoreState` so the Core sleeve can compute real stats from the
 * bot's live cost basis + trade history. Omit in tests or when you want
 * zeroed stats.
 */
export function buildDefaultRegistry(opts: DefaultRegistryOptions = {}): SleeveRegistry {
  return new InMemorySleeveRegistry(
    [new CoreSleeve({
      getState: opts.getCoreState,
      decideFn: opts.coreDecideFn,
    })],
    defaultStaticAllocator(),
  );
}

/**
 * Build a custom registry. Primary use: tests, and per-bot profiles that
 * install different sleeve rosters.
 */
export function buildRegistry(
  sleeves: ReadonlyArray<Sleeve>,
  allocator: CapitalAllocator,
): SleeveRegistry {
  return new InMemorySleeveRegistry(sleeves, allocator);
}
