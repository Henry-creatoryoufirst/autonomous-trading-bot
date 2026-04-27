/**
 * NVR-SPEC-022 — Pattern Registry
 *
 * Holds the set of registered patterns + their lifecycle status. The
 * runtime asks the registry which patterns to tick this cycle (filters by
 * status), and the registry enforces uniqueness of names + version
 * compatibility. It does NOT call patterns — the runtime does. Registry
 * is just the catalog.
 */

import type { Pattern, PatternRecord, PatternStatus } from "./types.js";

export class PatternRegistry {
  private readonly records = new Map<string, PatternRecord>();

  /**
   * Register a pattern. Throws on duplicate name (same name, different
   * version is still a duplicate — patterns version themselves through
   * forks like `stablecoin_depeg_v2`, not by upgrading the same name).
   */
  register(pattern: Pattern, status: PatternStatus = "disabled"): PatternRecord {
    if (this.records.has(pattern.name)) {
      throw new Error(
        `Pattern "${pattern.name}" already registered. To replace it, deregister first or use a new name (e.g., "${pattern.name}_v2").`,
      );
    }
    if (pattern.maxAllocationPct < 0 || pattern.maxAllocationPct > 100) {
      throw new Error(
        `Pattern "${pattern.name}" has invalid maxAllocationPct=${pattern.maxAllocationPct} (must be 0–100).`,
      );
    }
    if (pattern.maxConcurrentPositions < 0 || !Number.isInteger(pattern.maxConcurrentPositions)) {
      throw new Error(
        `Pattern "${pattern.name}" has invalid maxConcurrentPositions=${pattern.maxConcurrentPositions} (must be a non-negative integer).`,
      );
    }
    if (pattern.tickIntervalMs < 250) {
      throw new Error(
        `Pattern "${pattern.name}" has tickIntervalMs=${pattern.tickIntervalMs} which is too aggressive (min 250ms). The runtime will reject sub-block reactions on Base; if you need that, you're competing with MEV and this isn't the framework.`,
      );
    }
    const record: PatternRecord = {
      pattern,
      status,
      enabledAt: new Date().toISOString(),
      attributionTag: `${pattern.name}@${pattern.version}`,
    };
    this.records.set(pattern.name, record);
    return record;
  }

  /** Remove a pattern. Returns true if it was registered, false otherwise. */
  deregister(patternName: string): boolean {
    return this.records.delete(patternName);
  }

  /** Update a pattern's lifecycle status (disabled / paper / live). */
  setStatus(patternName: string, status: PatternStatus): void {
    const r = this.records.get(patternName);
    if (!r) throw new Error(`Pattern "${patternName}" is not registered.`);
    this.records.set(patternName, { ...r, status });
  }

  /** Get all patterns with a given status. The runtime uses this to
   *  decide which patterns to tick (typically status === 'live' or
   *  'paper' depending on the runtime mode). */
  byStatus(status: PatternStatus): readonly PatternRecord[] {
    const out: PatternRecord[] = [];
    for (const r of this.records.values()) {
      if (r.status === status) out.push(r);
    }
    return out;
  }

  /** All registered patterns regardless of status — for the cockpit
   *  to show the full catalog. */
  all(): readonly PatternRecord[] {
    return [...this.records.values()];
  }

  /** Look up a single record by pattern name. */
  get(patternName: string): PatternRecord | undefined {
    return this.records.get(patternName);
  }

  /** The minimum tickIntervalMs across all currently active (non-disabled)
   *  patterns. The runtime uses this as its tick frequency. Returns
   *  Number.POSITIVE_INFINITY when nothing is active (runtime should idle). */
  minActiveTickIntervalMs(): number {
    let min = Number.POSITIVE_INFINITY;
    for (const r of this.records.values()) {
      if (r.status === "disabled") continue;
      if (r.pattern.tickIntervalMs < min) min = r.pattern.tickIntervalMs;
    }
    return min;
  }
}
