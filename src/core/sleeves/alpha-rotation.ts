/**
 * NVR Capital — Alpha Rotation Sleeve (Phase 1.2a stub).
 *
 * Registered at 0% paper allocation. Returns [] from decide() — the actual
 * rotation-detector-driven strategy lands in Phase 2.x, paired with
 * NVR-SPEC-011.
 *
 * Rationale for existing as a stub today (vs. waiting until Phase 2 to
 * register): shadow-decision logs start from day 1. When the strategy code
 * lands, we already have baseline HOLD-cadence data to show the sleeve is
 * plumbed correctly, and SPEC-016 graduation timing starts clicking from
 * the first cycle after registration.
 *
 * See NVR-SPEC-010 (sleeves), NVR-SPEC-011 (rotation detector),
 * NVR-SPEC-016 (graduation — to be drafted).
 */

import type { Sleeve, SleeveContext, SleeveDecision, SleeveStats, SleeveMode } from './types.js';
import type { SleeveOwnership } from './state-types.js';
import { statsFromOwnership } from './sleeve-stats.js';

export interface AlphaRotationSleeveOptions {
  /** Defaults to 'paper'. Graduate via NVR-SPEC-016 criteria. */
  mode?: SleeveMode;
  getOwnership?: () => SleeveOwnership | undefined;
  getPortfolioValue?: () => number;
}

export class AlphaRotationSleeve implements Sleeve {
  readonly id = 'alpha-rotation';
  readonly displayName = 'Alpha Rotation';
  readonly mode: SleeveMode;
  readonly minCapitalPct = 0;
  readonly maxCapitalPct = 0.10;

  private readonly getOwnership?: () => SleeveOwnership | undefined;
  private readonly getPortfolioValue?: () => number;

  constructor(opts: AlphaRotationSleeveOptions = {}) {
    this.mode = opts.mode ?? 'paper';
    this.getOwnership = opts.getOwnership;
    this.getPortfolioValue = opts.getPortfolioValue;
  }

  /**
   * Phase 1.2 stub. Real rotation-driven rebalancing ships in Phase 2.x
   * per NVR-SPEC-011. Returns [] here so the sleeve still emits a HOLD
   * shadow entry each cycle.
   */
  async decide(_ctx: SleeveContext): Promise<SleeveDecision[]> {
    return [];
  }

  getStats(): SleeveStats {
    return statsFromOwnership(
      this.getOwnership?.(),
      this.getPortfolioValue?.() ?? 0,
    );
  }
}
