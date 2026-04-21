/**
 * NVR Capital — Alpha Hunter Sleeve v1.
 *
 * v21.16 Phase 2: first real strategy. Runs in paper mode at 0% allocation,
 * striking meme/alt candidates surfaced by the token-discovery engine.
 *
 * Thesis (from founding_spirit + alpha_hunt_obsession memories):
 *   Alpha lives in meme/alt swings, not blue chips. Catch them early with
 *   tight exits. Pulling profits is the edge, not picking winners.
 *
 * Strategy shape:
 *   ENTRIES
 *     - Candidate has conviction ≥ ALPHA_MIN_CONVICTION from discovery engine
 *     - Prioritize runners (exceptional momentum) over baseline candidates
 *     - Not already held (no averaging down on Alpha)
 *     - Max one new entry per cycle (avoid stampedes on shared signals)
 *     - Max ALPHA_MAX_POSITIONS concurrent positions
 *     - Size = min(ceiling, max(floor, budget × ALPHA_POSITION_SIZE_PCT))
 *
 *   EXITS (every cycle, against every held position)
 *     - Drawdown override: P&L ≤ ALPHA_DRAWDOWN_OVERRIDE_PCT (-5%) →
 *       IMMEDIATE exit, regardless of momentum. Tighter than Core's -8%.
 *     - Take-profit: P&L ≥ ALPHA_PROFIT_TAKE_PCT (+15%) → exit; capture
 *       the swing before mean reversion eats it.
 *     - Stale: age ≥ ALPHA_MAX_HOLD_HOURS (48h) AND P&L < +2% → exit;
 *       thesis played out.
 *   All exits mark 100% close — Alpha doesn't trim; it cycles.
 *
 * Why these specific numbers:
 *   - -5% drawdown: 1% below Core's -8% (SPEC-015) so Alpha cuts earlier,
 *     as befits a higher-turnover hypothesis. Below the stop-loss buffer
 *     so rules don't collide.
 *   - +15% profit-take: meme/alt swings commonly 10-30%; taking +15%
 *     captures the bulk of typical moves without waiting for peaks.
 *   - 48h max-hold: half of Core's 48h+ stale threshold window. Alpha is
 *     meant to be fast; if a thesis hasn't played in 2 days, it won't.
 *   - Conviction ≥ 65: discovery engine's composite score (0-100) floor.
 *     Runners auto-prioritize; this keeps non-runner entries above noise.
 *   - 5% of virtual budget per strike: tight enough that one loss doesn't
 *     blow up the sleeve, wide enough that a winner matters.
 *   - Max 3 open positions: concentration in highest-conviction; avoids
 *     spray-and-pray dilution.
 *
 * See NVR-SPEC-010 (sleeve architecture), NVR-SPEC-016 (graduation criteria),
 * NVR-SPEC-017 (Alpha Hunter v1 strategy spec — in draft).
 */

import type { Sleeve, SleeveContext, SleeveDecision, SleeveStats, SleeveMode } from './types.js';
import type { SleeveOwnership, SleeveExitOverride } from './state-types.js';
import { statsFromOwnership } from './sleeve-stats.js';

// ============================================================================
// STRATEGY CONSTANTS
// ============================================================================

/** Discovery composite score floor. Below this, don't strike. */
const ALPHA_MIN_CONVICTION = 65;

/** Max concurrent Alpha positions. Concentrate in highest conviction. */
const ALPHA_MAX_POSITIONS = 3;

/** Max new entries per cycle. One-shot per cycle even if 5 runners flash. */
const ALPHA_MAX_NEW_ENTRIES_PER_CYCLE = 1;

/** Fraction of the sleeve's capital budget for each new entry. */
const ALPHA_POSITION_SIZE_PCT = 0.05;

/** Dollar floor — won't enter if sizing drops below this. */
const ALPHA_POSITION_SIZE_FLOOR_USD = 10;

/** Dollar ceiling — caps over-sizing when budget is large. */
const ALPHA_POSITION_SIZE_CEILING_USD = 100;

/** Take-profit threshold. At +X% unrealized, book the win. */
const ALPHA_PROFIT_TAKE_PCT = 15;

/** Drawdown override — exit at -X% regardless of momentum (default). */
const ALPHA_DRAWDOWN_OVERRIDE_PCT_DEFAULT = -5;

/** Stale-exit: after this long, require meaningful gain or exit. */
const ALPHA_MAX_HOLD_HOURS_DEFAULT = 48;

/** Gain threshold for the stale-exit "played out" check. */
const ALPHA_STALE_MAX_GAIN_PCT_DEFAULT = 2;

/** Tokens we never touch with Alpha — they're Core's territory or liquidity. */
const ALPHA_NEVER_BUY = new Set(['USDC', 'ETH', 'WETH', 'cbBTC', 'cbETH', 'wstETH']);

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
  /**
   * Per-sleeve exit discipline overrides from SleeveConfig. When absent,
   * the strategy's built-in defaults apply.
   */
  getExitOverride?: () => SleeveExitOverride | undefined;
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
  private readonly getExitOverride?: () => SleeveExitOverride | undefined;

  constructor(opts: AlphaHunterSleeveOptions = {}) {
    this.mode = opts.mode ?? 'paper';
    this.getOwnership = opts.getOwnership;
    this.getPortfolioValue = opts.getPortfolioValue;
    this.getExitOverride = opts.getExitOverride;
  }

  /**
   * v1 strategy. Produces exits for every held position that trips a rule,
   * plus up to ALPHA_MAX_NEW_ENTRIES_PER_CYCLE new strikes from the top of
   * the discovery candidate list.
   *
   * Runs every cycle. Safe to call with empty discovery (returns exits only).
   */
  async decide(ctx: SleeveContext): Promise<SleeveDecision[]> {
    const decisions: SleeveDecision[] = [];
    const nowMs = Date.now();
    const override = this.getExitOverride?.() ?? {};
    const drawdownCutPct = override.drawdownOverridePct ?? ALPHA_DRAWDOWN_OVERRIDE_PCT_DEFAULT;
    const maxHoldHours = override.maxHoldHours ?? ALPHA_MAX_HOLD_HOURS_DEFAULT;
    const staleMaxGainPct = override.staleMaxGainPct ?? ALPHA_STALE_MAX_GAIN_PCT_DEFAULT;

    // ---------- EXITS FIRST ----------
    // A single position can only trip one exit per cycle. Drawdown wins over
    // profit-take (they can't overlap anyway) and profit-take wins over stale.
    for (const position of ctx.positions) {
      const price = ctx.market.prices[position.symbol];
      if (!price || price <= 0) continue;

      const currentValue = position.balance * price;
      const pnlPct = position.costBasisUSD > 0
        ? ((currentValue - position.costBasisUSD) / position.costBasisUSD) * 100
        : 0;
      const ageHours = (nowMs - new Date(position.openedAt).getTime()) / (1000 * 60 * 60);

      let exitReason: string | null = null;
      if (pnlPct <= drawdownCutPct) {
        exitReason = `ALPHA_DRAWDOWN_CUT: ${pnlPct.toFixed(1)}% ≤ ${drawdownCutPct}% — tighter than Core, noise doesn't save bleeders`;
      } else if (pnlPct >= ALPHA_PROFIT_TAKE_PCT) {
        exitReason = `ALPHA_TAKE_PROFIT: +${pnlPct.toFixed(1)}% ≥ +${ALPHA_PROFIT_TAKE_PCT}% — pulling profits is the edge`;
      } else if (ageHours >= maxHoldHours && pnlPct < staleMaxGainPct) {
        exitReason = `ALPHA_STALE: held ${ageHours.toFixed(0)}h at ${pnlPct.toFixed(1)}% — thesis played out`;
      }

      if (exitReason) {
        decisions.push({
          action: 'SELL',
          fromToken: position.symbol,
          toToken: 'USDC',
          amountUSD: currentValue,
          percent: 100,
          reasoning: exitReason,
        });
      }
    }

    // ---------- NEW ENTRIES ----------
    // Respect MAX_POSITIONS counting EXITS as freeing slots (the sim will
    // apply them in-cycle). Budget gate is strict.
    const candidates = ctx.market.discovery?.candidates ?? [];
    if (candidates.length === 0) return decisions;

    const sellsThisCycle = new Set(
      decisions.filter(d => d.action === 'SELL').map(d => d.fromToken),
    );
    const heldAfterExits = ctx.positions.filter(p => !sellsThisCycle.has(p.symbol));
    const slotsOpen = ALPHA_MAX_POSITIONS - heldAfterExits.length;
    if (slotsOpen <= 0 || ctx.availableUSDC < ALPHA_POSITION_SIZE_FLOOR_USD) {
      return decisions;
    }

    // Filter + rank: qualifying conviction, not already held, not in
    // excluded-symbols list. Runners rank above non-runners; within each,
    // rank by conviction descending.
    const heldSymbols = new Set(heldAfterExits.map(p => p.symbol));
    const eligible = candidates
      .filter(c => c.convictionScore >= ALPHA_MIN_CONVICTION)
      .filter(c => !heldSymbols.has(c.symbol))
      .filter(c => !ALPHA_NEVER_BUY.has(c.symbol))
      .sort((a, b) => {
        if ((a.isRunner ?? false) !== (b.isRunner ?? false)) return (a.isRunner ? -1 : 1);
        return b.convictionScore - a.convictionScore;
      });

    const maxNewEntries = Math.min(ALPHA_MAX_NEW_ENTRIES_PER_CYCLE, slotsOpen);
    let entries = 0;
    let remainingBudget = ctx.availableUSDC;

    for (const candidate of eligible) {
      if (entries >= maxNewEntries) break;
      const baseSize = ctx.capitalBudgetUSD * ALPHA_POSITION_SIZE_PCT;
      const sizeUSD = Math.max(
        ALPHA_POSITION_SIZE_FLOOR_USD,
        Math.min(ALPHA_POSITION_SIZE_CEILING_USD, baseSize),
      );
      if (sizeUSD > remainingBudget) break;

      const change24h = candidate.priceChange24h ?? 0;
      decisions.push({
        action: 'BUY',
        fromToken: 'USDC',
        toToken: candidate.symbol,
        amountUSD: sizeUSD,
        reasoning: `ALPHA_HUNTER_V1: ${candidate.isRunner ? '🚀 RUNNER ' : ''}conviction ${candidate.convictionScore}/100, sector ${candidate.sector ?? 'UNKNOWN'}, 24h ${change24h >= 0 ? '+' : ''}${change24h.toFixed(1)}%. Meme/alt swing — tight-exit discipline applies.`,
        sector: candidate.sector,
      });
      remainingBudget -= sizeUSD;
      entries++;
    }

    return decisions;
  }

  getStats(): SleeveStats {
    return statsFromOwnership(
      this.getOwnership?.(),
      this.getPortfolioValue?.() ?? 0,
    );
  }
}
