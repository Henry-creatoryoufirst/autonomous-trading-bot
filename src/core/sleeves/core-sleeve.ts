/**
 * NVR Capital — Capital Sleeves: Core Sleeve
 *
 * The Core sleeve represents the bot's existing confluence/adaptive/capital-
 * liberation strategy. It exists so that the sleeve architecture can be
 * introduced without changing bot behavior: the pre-sleeve bot ≡ "one sleeve
 * named 'core' at 100% allocation".
 *
 * In v1 of the sleeve scaffolding, `decide()` is a placeholder — it returns
 * an empty array. The actual wrapping of the existing decision stage will
 * land in a subsequent change, behind a feature flag, with no behavioral
 * differences relative to today.
 *
 * See NVR-SPEC-010 §"Migration path" for the full rollout plan.
 */

import type {
  Sleeve,
  SleeveContext,
  SleeveDecision,
  SleeveStats,
  SleeveMode,
} from './types.js';

export interface CoreSleeveOptions {
  /** Typically 'paper' during initial rollout, then 'live'. */
  mode?: SleeveMode;
  /** Override the default name shown on the dashboard. */
  displayName?: string;
}

export class CoreSleeve implements Sleeve {
  readonly id = 'core';
  readonly displayName: string;
  readonly mode: SleeveMode;
  /**
   * The Core sleeve is the bot's primary strategy and must never be starved
   * nor over-allocated. These bounds reflect that: it always has meaningful
   * capital, and it can also run the whole book if no other sleeve exists.
   */
  readonly minCapitalPct = 0.5;
  readonly maxCapitalPct = 1.0;

  constructor(opts: CoreSleeveOptions = {}) {
    this.mode = opts.mode ?? 'live';
    this.displayName = opts.displayName ?? 'Core Strategy';
  }

  /**
   * SCAFFOLDING: returns no decisions. The real implementation will wrap the
   * existing heavy-cycle decision stage. Kept empty in v1 so scaffolding can
   * land without touching the trading path.
   */
  async decide(_ctx: SleeveContext): Promise<SleeveDecision[]> {
    return [];
  }

  /**
   * SCAFFOLDING: returns zeroed stats. Real values come from wiring into
   * state.tradeHistory + state.costBasis once the sleeve takes ownership.
   */
  getStats(): SleeveStats {
    return {
      realizedPnLUSD: 0,
      unrealizedPnLUSD: 0,
      trades: 0,
      winRate: 0,
      rollingSharpe7d: null,
      lastDecisionAt: null,
    };
  }
}
