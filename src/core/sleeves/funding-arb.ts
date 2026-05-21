/**
 * NVR Capital — Funding-Arb Sleeve v1 (NVR-SPEC-034 Phase 1a, PAPER ONLY).
 *
 * Phase 1a scaffolding only. This sleeve simulates a delta-neutral funding
 * arbitrage strategy on a single quality-cohort asset (cbBTC by default).
 * The strategic frame:
 *
 *   - Long cbBTC spot + short equivalent BTC-PERP notional = delta-neutral.
 *   - Holder receives funding payments whenever funding rate is positive on
 *     the chosen perp venue.
 *   - P&L driver is the FUNDING RATE only — directional BTC moves cancel
 *     between the two legs (up to slippage/basis residual).
 *
 * Phase 1a scope (THIS PR):
 *   - Sleeve exists, registered (opt-in), records paper decisions via the
 *     existing paper-sim plumbing.
 *   - Funding-rate input is STUBBED — the real Vertex/Nado/aggregator
 *     integration lands in 1a's monitor service (separate PR). Phase 1a
 *     here proves the sleeve plumbing, NOT the rate quality.
 *   - When the stubbed rate exceeds entry threshold and no position is
 *     open, the sleeve emits a paper BUY on cbBTC sized to the paper
 *     budget. The "short perp" leg is virtual — accounted as a credit
 *     against entry notional via reasoning string only. The spot leg is
 *     what flows through paper-sim because that's the side that consumes
 *     virtual USDC.
 *   - When funding drops below the exit threshold OR a max-hold elapses,
 *     the sleeve emits a paper SELL.
 *   - Decisions are tagged `ALPHA_FUNDING_ARB_V1` so the audit log can
 *     filter the simulated stream.
 *
 * What this sleeve does NOT do (Phase 1a hard guarantee):
 *   - It does NOT submit real perp orders. There is no venue integration.
 *   - It does NOT consume the bot's live USDC reserve. Allocation is 0%
 *     in `defaultStaticAllocator`; this sleeve trades against the paper
 *     budget only.
 *   - It does NOT promote itself to mode='live'. Promotion is a separate
 *     explicit env flag (`FUNDING_ARB_LIVE`) that this PR DOES NOT WIRE
 *     into the registry — only `FUNDING_ARB_PAPER_ENABLED` controls
 *     whether the sleeve is even installed. Live promotion is gated on
 *     a Henry-greenlit 30-day review per NVR-SPEC-034 §8 Phase 2.
 *
 * Kill switch:
 *   `FUNDING_ARB_PAPER_ENABLED=true` is required for the sleeve to appear
 *   in the default registry at all. Default is OFF on every deploy. The
 *   registry's roster check is the single point that decides whether
 *   this sleeve even exists this cycle — flipping the flag to false (or
 *   leaving it unset) restores the pre-SPEC-034 behavior exactly.
 *
 * See NVR-SPEC-034 (this sleeve), NVR-SPEC-010 (sleeve architecture),
 * NVR-SPEC-016 (graduation criteria — paper → live gates).
 */

import type {
  Sleeve,
  SleeveContext,
  SleeveDecision,
  SleeveStats,
  SleeveMode,
} from './types.js';
import type { SleeveOwnership } from './state-types.js';
import { statsFromOwnership } from './sleeve-stats.js';

// ============================================================================
// STRATEGY CONSTANTS — Phase 1a scaffolding values
// ============================================================================

function envFloat(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const parsed = parseFloat(v);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Funding-rate entry threshold (in basis points, per 8h period).
 *
 * Default 3.4 bps per 8h ≈ +10% APR equivalent, per NVR-SPEC-034 §4
 * ("Threshold for 'worthwhile arb'"). Above this, the funding carry
 * comfortably exceeds round-trip friction. Below it, friction eats the
 * edge.
 */
const FUNDING_ARB_ENTRY_THRESHOLD_BPS = envFloat('FUNDING_ARB_ENTRY_BPS', 3.4);

/**
 * Funding-rate exit threshold (in basis points, per 8h period).
 *
 * Asymmetric on purpose: hysteresis prevents thrash on funding wobble.
 * Default 1.7 bps per 8h ≈ +5% APR, also per NVR-SPEC-034 §4.
 */
const FUNDING_ARB_EXIT_THRESHOLD_BPS = envFloat('FUNDING_ARB_EXIT_BPS', 1.7);

/**
 * Maximum hold duration before forced cycling (hours). 30 days per the
 * spec §2.4 "Exit (any of): Position has been open >30 days (cycle for
 * tax-lot hygiene)". Acts as a deterministic safety valve so a forgotten
 * paper position can't sit forever.
 */
const FUNDING_ARB_MAX_HOLD_HOURS = envFloat('FUNDING_ARB_MAX_HOLD_HOURS', 24 * 30);

/**
 * Notional size cap for a single paper arb position (USD).
 *
 * Phase 1a default: $300 per spec §5 ("Target sleeve: 12.5% = $400 ... At
 * $N = $300 notional"). Bounded so a single simulated trade can't consume
 * an entire $1000 paper budget — leaves room to model multi-position
 * scenarios later without re-scaffolding.
 */
const FUNDING_ARB_POSITION_SIZE_USD = envFloat('FUNDING_ARB_POSITION_SIZE_USD', 300);

/**
 * Primary asset for Phase 1a paper trades. Quality cohort, deep liquidity,
 * canonical funding-arb candidate per NVR-SPEC-034 §2.
 */
const FUNDING_ARB_BASE_ASSET = (process.env.FUNDING_ARB_BASE_ASSET ?? 'cbBTC').trim();

// ============================================================================
// FUNDING-RATE STUB
// ============================================================================

/**
 * Phase 1a stub. The real venue integration (OKX / Hyperliquid / Bitfinex
 * aggregator per the §0.1 venue pivot) lands as a separate service in a
 * follow-on PR. For now we emit a deterministic sine-wave funding rate so
 * the sleeve has a non-zero signal to react to in tests and on staging.
 *
 * Shape:
 *   - centered at 2.5 bps / 8h (between entry 3.4 and exit 1.7 thresholds)
 *   - amplitude 2.5 bps / 8h
 *   - period 72 cycles
 *
 * This produces a sequence that crosses the entry threshold roughly every
 * 18 cycles, then crosses back below exit roughly 18 cycles later. That
 * gives the test harness clean entry/exit dynamics without needing to
 * mock the rate. Override entirely via `getFundingRateStub` injection.
 */
function defaultFundingRateStub(cycleNumber: number): number {
  const center = 2.5;
  const amplitude = 2.5;
  const period = 72;
  return center + amplitude * Math.sin((2 * Math.PI * cycleNumber) / period);
}

export interface FundingArbSleeveOptions {
  /**
   * Defaults to 'paper'. Phase 1a NEVER promotes to live — see SPEC-034 §8.
   * The constructor still accepts the option so tests can construct in
   * isolation, but the registry only ever instantiates with mode='paper'.
   */
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
   * Optional override for the funding-rate input. Injected by tests so
   * we can drive deterministic entry/exit sequences without leaning on
   * the sine-wave. Returns funding rate in bps per 8h.
   */
  getFundingRateStub?: (cycleNumber: number) => number;
}

/**
 * Synthetic HOLD decision used to surface "no-entry"/"no-exit" reasoning
 * to the orchestrator's decision log. Mirrors the AlphaHunter pattern.
 */
function makeHold(reasoning: string): SleeveDecision {
  return {
    action: 'HOLD',
    fromToken: 'USDC',
    toToken: 'USDC',
    amountUSD: 0,
    reasoning,
  };
}

export class FundingArbSleeve implements Sleeve {
  readonly id = 'funding-arb';
  readonly displayName = 'Funding Arb (Paper)';
  readonly mode: SleeveMode;
  /**
   * Phase 1a: 0% live floor. Sleeve only ever spends paper budget.
   * Graduation to a live floor is a separate explicit promotion per
   * NVR-SPEC-034 §8 Phase 3+.
   */
  readonly minCapitalPct = 0;
  /**
   * Phase 1a: capped at 0% via the default allocator. The interface field
   * is set to the spec's eventual target (12.5%) so it's clear what the
   * sleeve is being scaffolded for, but the allocator never lets it
   * actually take real capital this PR.
   */
  readonly maxCapitalPct = 0.125;

  private readonly getOwnership?: () => SleeveOwnership | undefined;
  private readonly getPortfolioValue?: () => number;
  private readonly getFundingRateStub: (cycleNumber: number) => number;

  constructor(opts: FundingArbSleeveOptions = {}) {
    this.mode = opts.mode ?? 'paper';
    this.getOwnership = opts.getOwnership;
    this.getPortfolioValue = opts.getPortfolioValue;
    this.getFundingRateStub = opts.getFundingRateStub ?? defaultFundingRateStub;
  }

  /**
   * Phase 1a decide(). Pure scaffolding logic:
   *
   *   1. Read funding rate via the stub for this cycle.
   *   2. If a paper position on the base asset is open:
   *      - Exit if funding rate < FUNDING_ARB_EXIT_THRESHOLD_BPS (carry gone).
   *      - Exit if position age > FUNDING_ARB_MAX_HOLD_HOURS (max-hold cycle).
   *      - Else HOLD with reasoning.
   *   3. If no position is open:
   *      - Enter if funding rate ≥ FUNDING_ARB_ENTRY_THRESHOLD_BPS AND there
   *        is enough virtual USDC in the paper budget for a full notional.
   *      - Else HOLD with reasoning.
   *
   * The "short perp" leg is virtual — accounted in the reasoning string
   * only. paper-sim only sees the spot leg (cbBTC BUY / SELL) because that
   * is what consumes the paper USDC budget. This is faithful to the spec
   * §2.3 sizing model (~$N spot leg, ~$0.25N perp margin) at the level of
   * abstraction that Phase 1a's scaffolding aims to validate.
   */
  async decide(ctx: SleeveContext): Promise<SleeveDecision[]> {
    const decisions: SleeveDecision[] = [];
    const nowMs = Date.now();
    const fundingBps = this.getFundingRateStub(ctx.market.cycleNumber);
    const fundingApr = fundingBps * 3 * 365 / 100; // bps/8h → annualized %
    const regime = ctx.market.regime;

    const existing = ctx.positions.find((p) => p.symbol === FUNDING_ARB_BASE_ASSET);

    // ---------- POSITION OPEN: evaluate exit gates ----------
    if (existing) {
      const ageHours = (nowMs - new Date(existing.openedAt).getTime()) / (1000 * 60 * 60);
      if (fundingBps < FUNDING_ARB_EXIT_THRESHOLD_BPS) {
        decisions.push({
          action: 'SELL',
          fromToken: FUNDING_ARB_BASE_ASSET,
          toToken: 'USDC',
          amountUSD: 0,
          percent: 100,
          reasoning:
            `ALPHA_FUNDING_ARB_V1 EXIT (funding decay): funding ${fundingBps.toFixed(2)} bps/8h < ` +
            `${FUNDING_ARB_EXIT_THRESHOLD_BPS} bps exit floor (~${fundingApr.toFixed(1)}% APR). ` +
            `Closing simulated short perp leg alongside cbBTC sell. Regime: ${regime}.`,
        });
        return decisions;
      }
      if (ageHours >= FUNDING_ARB_MAX_HOLD_HOURS) {
        decisions.push({
          action: 'SELL',
          fromToken: FUNDING_ARB_BASE_ASSET,
          toToken: 'USDC',
          amountUSD: 0,
          percent: 100,
          reasoning:
            `ALPHA_FUNDING_ARB_V1 EXIT (max-hold): held ${ageHours.toFixed(0)}h ≥ ` +
            `${FUNDING_ARB_MAX_HOLD_HOURS}h cap. Cycling tax-lot per spec §2.4.`,
        });
        return decisions;
      }
      decisions.push(makeHold(
        `ALPHA_FUNDING_ARB_V1 HOLD: position open ${ageHours.toFixed(1)}h, funding ` +
        `${fundingBps.toFixed(2)} bps/8h (~${fundingApr.toFixed(1)}% APR) — accruing.`,
      ));
      return decisions;
    }

    // ---------- NO POSITION: evaluate entry gates ----------
    if (fundingBps < FUNDING_ARB_ENTRY_THRESHOLD_BPS) {
      decisions.push(makeHold(
        `ALPHA_FUNDING_ARB_V1 HOLD: funding ${fundingBps.toFixed(2)} bps/8h < ` +
        `${FUNDING_ARB_ENTRY_THRESHOLD_BPS} bps entry floor (~${fundingApr.toFixed(1)}% APR). ` +
        `Carry not above friction threshold.`,
      ));
      return decisions;
    }

    // Paper-budget enforcement: we must have a full notional's worth of
    // virtual USDC available. Partial sizing is intentionally NOT
    // supported in Phase 1a — a partial leg can't be delta-neutral by
    // construction, and the scaffold should make that constraint loud.
    if (ctx.availableUSDC < FUNDING_ARB_POSITION_SIZE_USD) {
      decisions.push(makeHold(
        `ALPHA_FUNDING_ARB_V1 HOLD: paper availableUSDC ` +
        `$${ctx.availableUSDC.toFixed(2)} < $${FUNDING_ARB_POSITION_SIZE_USD} notional ` +
        `required for a delta-neutral arb. Skipping entry.`,
      ));
      return decisions;
    }

    // Confirm we have a price for the base asset — paper-sim needs it to
    // convert the BUY amountUSD into a virtual token balance.
    const price = ctx.market.prices[FUNDING_ARB_BASE_ASSET];
    if (!price || price <= 0) {
      decisions.push(makeHold(
        `ALPHA_FUNDING_ARB_V1 HOLD: no price for ${FUNDING_ARB_BASE_ASSET} this cycle ` +
        `(prices map missing or zero). Cannot size paper entry safely.`,
      ));
      return decisions;
    }

    decisions.push({
      action: 'BUY',
      fromToken: 'USDC',
      toToken: FUNDING_ARB_BASE_ASSET,
      amountUSD: FUNDING_ARB_POSITION_SIZE_USD,
      reasoning:
        `ALPHA_FUNDING_ARB_V1 ENTRY: funding ${fundingBps.toFixed(2)} bps/8h ≥ ` +
        `${FUNDING_ARB_ENTRY_THRESHOLD_BPS} bps entry floor (~${fundingApr.toFixed(1)}% APR). ` +
        `Simulated long ${FUNDING_ARB_BASE_ASSET} spot $${FUNDING_ARB_POSITION_SIZE_USD} ` +
        `+ short BTC-PERP $${FUNDING_ARB_POSITION_SIZE_USD} (virtual). Regime: ${regime}. ` +
        `Phase 1a paper — no real perp order submitted.`,
      sector: 'BLUE_CHIP',
    });
    return decisions;
  }

  getStats(): SleeveStats {
    return statsFromOwnership(
      this.getOwnership?.(),
      this.getPortfolioValue?.() ?? 0,
    );
  }
}

/**
 * Default instance for convenience. The orchestrator constructs its own
 * via the registry; this export exists so tests and shadow tooling can
 * pull a configured sleeve without re-wiring providers each time.
 */
export const fundingArbSleeve = new FundingArbSleeve();
