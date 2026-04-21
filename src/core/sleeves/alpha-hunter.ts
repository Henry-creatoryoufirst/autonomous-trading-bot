/**
 * NVR Capital — Alpha Hunter Sleeve (Phase 1.2a stub).
 *
 * Registered at 0% paper allocation. Returns [] from decide() — the actual
 * Hunter-driven strategy lands in Phase 2.x once the Alpha infrastructure
 * has soaked.
 *
 * Exists now so:
 *   1. SleeveOwnership['alpha-hunter'] starts accumulating shadow decision
 *      entries on day 1 (HOLD for every cycle). Weeks of baseline before
 *      Phase 2 ships a real strategy to compare against.
 *   2. The dashboard can render Alpha Hunter as a visible sleeve (PAPER
 *      label clearly shown per "Dashboards must not lie") so Henry sees
 *      the shape of the future.
 *   3. NVR-SPEC-016 graduation criteria have a data surface to evaluate
 *      against the moment it's defined.
 *
 * Phase 2.x will replace `decide()` with conviction-based strikes driven
 * by the token-discovery engine + signal-service Alpha endpoint. The
 * surrounding infrastructure (ownership, P&L, regime attribution) needs
 * zero changes at that point — only the strategy body moves.
 *
 * See NVR-SPEC-010, NVR-SPEC-016 (to be drafted), and the 2026-04-21
 * session note (vision-vs-code alignment).
 */

import type { Sleeve, SleeveContext, SleeveDecision, SleeveStats, SleeveMode } from './types.js';
import type { SleeveOwnership } from './state-types.js';
import { statsFromOwnership } from './sleeve-stats.js';

export interface AlphaHunterSleeveOptions {
  /** Defaults to 'paper'. Graduate via NVR-SPEC-016 criteria. */
  mode?: SleeveMode;
  /**
   * Provider that returns this sleeve's ownership record from AgentState.
   * Called each time `getStats()` runs. Keep cheap: no I/O, just a reference.
   * When omitted, `getStats()` returns zeroed stats.
   */
  getOwnership?: () => SleeveOwnership | undefined;
  /**
   * Current total portfolio USD value (denominator for rolling Sharpe).
   * When omitted or 0, Sharpe reports null.
   */
  getPortfolioValue?: () => number;
}

export class AlphaHunterSleeve implements Sleeve {
  readonly id = 'alpha-hunter';
  readonly displayName = 'Alpha Hunter';
  readonly mode: SleeveMode;
  /** Alpha sleeves start with zero floor — they haven't graduated. */
  readonly minCapitalPct = 0;
  /** Ceiling set low during paper phase; SPEC-016 raises on graduation. */
  readonly maxCapitalPct = 0.15;

  private readonly getOwnership?: () => SleeveOwnership | undefined;
  private readonly getPortfolioValue?: () => number;

  constructor(opts: AlphaHunterSleeveOptions = {}) {
    this.mode = opts.mode ?? 'paper';
    this.getOwnership = opts.getOwnership;
    this.getPortfolioValue = opts.getPortfolioValue;
  }

  /**
   * Phase 1.2 stub. Returns []; real conviction-based strategy ships in
   * Phase 2.x. The orchestrator still calls this each heavy cycle so a HOLD
   * shadow-decision gets logged — preserving the daily cadence that later
   * performance comparisons depend on.
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
