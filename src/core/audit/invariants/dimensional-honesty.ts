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
 * The bot's quote-currency holdings (USDC, ETH-as-gas) live in
 * `state.trading.balances` but never in `state.costBasis` — they're cash,
 * not positions. To compare the cost-basis-derived total against the
 * balances total apples-to-apples, the cost-basis sum must add back the
 * cash legs from the balances array.
 *
 * ETH (native gas) is also excluded from costBasis but is treated as
 * inventory by some paths. We include both.
 */
const CASH_AND_GAS_SYMBOLS = new Set(['USDC', 'ETH']);

function sumCashAndGasFromBalances(ctx: InvariantContext): number {
  let sum = 0;
  for (const b of ctx.balances) {
    if (CASH_AND_GAS_SYMBOLS.has(b.symbol)) sum += b.usdValue ?? 0;
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
  // Add cash + gas from balances so source A spans the same scope as B + C
  return sum + sumCashAndGasFromBalances(ctx);
}

function sumBalancesUsd(ctx: InvariantContext): number {
  return ctx.balances.reduce((acc, b) => acc + (b.usdValue ?? 0), 0);
}

export const dimensionalHonesty: Invariant = (ctx) => {
  // Below the minimum portfolio threshold, all sources can legitimately read
  // near-zero (fresh wallet, mid-recovery, etc). Don't fire false alarms.
  if (ctx.totalPortfolioValue < MIN_PORTFOLIO_USD) return null;

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
