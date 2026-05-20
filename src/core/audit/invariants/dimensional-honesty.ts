/**
 * NVR-SPEC-035 INV-1 — Dimensional honesty.
 *
 * Three independent expressions describe the same thing — the bot's current
 * portfolio value. They must agree within tolerance:
 *
 *   A. sum(state.costBasis[*].currentHolding × lastKnownPrice[*])
 *   B. sum(state.trading.balances[*].usdValue)
 *   C. state.trading.totalPortfolioValue (the scalar dashboards show)
 *
 * Phase A scope: cross-check A, B, C. (Phase A.1 will add D: live RPC poll
 * of the smart-wallet balances + Chainlink prices, the only truly
 * independent source. For now A/B/C agreement is the achievable bar.)
 *
 * SEVERE on disagreement > 2%. Pause scope: all-buys.
 *
 * This is the invariant that would have caught yesterday's phantom -$215.
 * If TOSHI's costBasis says we hold $30M of TOSHI but the wallet says $0
 * (impossible — total portfolio is $3K), A diverges from B and C
 * dramatically.
 */

import type { Invariant, Violation, InvariantContext } from '../types.js';

const TOLERANCE_PCT = 0.02; // 2% — accommodates price-tick drift between sources
const MIN_PORTFOLIO_USD = 50; // below this, all three sources can legitimately be 0/noisy
const POSITION_MIN_USD = 1; // sub-$1 dust positions don't count toward the price-readiness check
const PRICE_READINESS_MIN_COVERAGE = 0.80; // ≥80% of non-trivial positions must have live prices for INV-1 to run

function makeViolation(observed: Record<string, unknown>, message: string): Violation {
  return {
    invariantId: 'INV-1',
    invariantName: 'dimensional-honesty',
    severity: 'SEVERE',
    message,
    observed,
    expected: {
      tolerancePct: TOLERANCE_PCT * 100,
      rule: 'sum(costBasis*price) ≈ sum(balances.usdValue) ≈ totalPortfolioValue within tolerance',
    },
    pauseScope: 'all-buys',
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Three categories live in `state.trading.balances` but never appear in
 * `state.costBasis` (so the cost-basis-derived sum naturally excludes
 * them). To compare apples-to-apples, INV-1 must add them back to
 * source A from the balances array:
 *
 *   1. Cash-and-gas: USDC, native ETH — bot's quote currency + gas reserve
 *   2. YIELD-sector positions: aBasUSDC, mUSDC (Morpho vault shares),
 *      future Aave/Morpho/Compound receipt tokens — added 2026-05-20 after
 *      the silent under-reporting bug surfaced ($430 of value invisible to
 *      portfolio total for weeks because yield receipt tokens weren't read
 *      into balances)
 */
const CASH_AND_GAS_SYMBOLS = new Set(['USDC', 'ETH']);
const YIELD_SECTOR = 'YIELD';

function sumCashGasAndYieldFromBalances(ctx: InvariantContext): number {
  let sum = 0;
  for (const b of ctx.balances) {
    const isCashGas = CASH_AND_GAS_SYMBOLS.has(b.symbol);
    const isYield = (b as { sector?: string }).sector === YIELD_SECTOR;
    if (isCashGas || isYield) sum += b.usdValue ?? 0;
  }
  return sum;
}

function sumCostBasisPositions(ctx: InvariantContext): number {
  let sum = 0;
  for (const [symbol, cb] of Object.entries(ctx.costBasis)) {
    if (!cb) continue;
    if (CASH_AND_GAS_SYMBOLS.has(symbol)) continue; // cash legs counted separately below
    const holding = cb.currentHolding ?? 0;
    if (holding <= 0) continue;
    // Prefer live price from lastKnownPrices; fall back to averageCostBasis
    // only as a last resort (it's stale but better than 0).
    const price = ctx.lastKnownPrices[symbol]?.price ?? cb.averageCostBasis ?? 0;
    if (price <= 0) continue;
    sum += holding * price;
  }
  // Add cash + gas + yield receipt tokens from balances so source A spans
  // the same scope as B + C (all three valuations represent the same total)
  return sum + sumCashGasAndYieldFromBalances(ctx);
}

function sumBalancesUsd(ctx: InvariantContext): number {
  return ctx.balances.reduce((acc, b) => acc + (b.usdValue ?? 0), 0);
}

export const dimensionalHonesty: Invariant = (ctx) => {
  // Below the minimum portfolio threshold, all sources can legitimately read
  // near-zero (fresh wallet, mid-recovery, etc). Don't fire false alarms.
  if (ctx.totalPortfolioValue < MIN_PORTFOLIO_USD) return null;

  // 2026-05-19 polish: skip the check when `lastKnownPrices` hasn't fully
  // populated yet. On a fresh Railway boot, the price stream takes a few
  // cycles to warm up — meanwhile non-trivial positions fall back to
  // `averageCostBasis` for source A which produces wildly wrong values for
  // any token whose historical cost basis is stored in different decimals
  // than current market (e.g., SPX with averageCostBasis = $3.77B from a
  // past unit-conversion bug). Returning null here lets INV-1 stay quiet
  // during warmup; once prices populate, the check runs cleanly.
  let nonTrivialPositions = 0;
  let positionsWithPrice = 0;
  for (const b of ctx.balances) {
    if (b.symbol === 'USDC') continue; // cash leg always priced at 1
    if ((b.usdValue ?? 0) < POSITION_MIN_USD) continue;
    nonTrivialPositions += 1;
    if ((ctx.lastKnownPrices[b.symbol]?.price ?? 0) > 0) positionsWithPrice += 1;
  }
  if (nonTrivialPositions > 0) {
    const coverage = positionsWithPrice / nonTrivialPositions;
    if (coverage < PRICE_READINESS_MIN_COVERAGE) {
      console.log(`[SystemAudit:warmup] INV-1 skipped — price coverage ${(coverage * 100).toFixed(0)}% (${positionsWithPrice}/${nonTrivialPositions}) below ${(PRICE_READINESS_MIN_COVERAGE * 100).toFixed(0)}% threshold`);
      return null;
    }
  }

  const sourceA = sumCostBasisPositions(ctx);
  const sourceB = sumBalancesUsd(ctx);
  const sourceC = ctx.totalPortfolioValue;

  // Compute pairwise relative deltas. Use the LARGER of the two as the
  // denominator so a near-zero source doesn't make the delta blow up to
  // Infinity (which would happen if sourceA ≈ 0 and we divided by A).
  function relDelta(x: number, y: number): number {
    const denom = Math.max(Math.abs(x), Math.abs(y));
    if (denom < 1) return 0; // both effectively zero — no disagreement
    return Math.abs(x - y) / denom;
  }

  const deltaAB = relDelta(sourceA, sourceB);
  const deltaAC = relDelta(sourceA, sourceC);
  const deltaBC = relDelta(sourceB, sourceC);
  const worstDelta = Math.max(deltaAB, deltaAC, deltaBC);

  if (worstDelta <= TOLERANCE_PCT) return null;

  // Identify which source is the outlier — the one whose pairwise deltas are
  // both above tolerance. That's the source most likely poisoned.
  let outlier: 'A' | 'B' | 'C' | 'unclear' = 'unclear';
  if (deltaAB > TOLERANCE_PCT && deltaAC > TOLERANCE_PCT && deltaBC <= TOLERANCE_PCT) outlier = 'A';
  else if (deltaAB > TOLERANCE_PCT && deltaBC > TOLERANCE_PCT && deltaAC <= TOLERANCE_PCT) outlier = 'B';
  else if (deltaAC > TOLERANCE_PCT && deltaBC > TOLERANCE_PCT && deltaAB <= TOLERANCE_PCT) outlier = 'C';

  return makeViolation(
    {
      sourceA_costBasisPositionSum: sourceA,
      sourceB_balancesUsdSum: sourceB,
      sourceC_totalPortfolioValue: sourceC,
      relDeltaAB_pct: (deltaAB * 100).toFixed(2),
      relDeltaAC_pct: (deltaAC * 100).toFixed(2),
      relDeltaBC_pct: (deltaBC * 100).toFixed(2),
      worstDeltaPct: (worstDelta * 100).toFixed(2),
      outlier,
    },
    `Three independent valuations disagree by ${(worstDelta * 100).toFixed(2)}% (>${(TOLERANCE_PCT * 100).toFixed(0)}% tolerance); outlier=${outlier}`,
  );
};
