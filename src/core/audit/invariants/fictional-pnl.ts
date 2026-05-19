/**
 * NVR-SPEC-035 INV-2 — No fictional per-token P&L.
 *
 * For each token T:
 *   |cb.realizedPnL| < max($100, 10 × cb.totalInvestedUSD)
 *   AND |cb.realizedPnL| < state.trading.totalPortfolioValue
 *
 * A single token cannot have realized losses larger than the entire
 * portfolio. Mathematically impossible without leverage (which the bot
 * does not use). This is what catches TOSHI's stored -$2,307,308 on a
 * $3K portfolio.
 *
 * SEVERE on violation. Pause scope: per-token-buys (we don't trust new
 * entries on the affected tokens until their cost-basis is repaired, but
 * the rest of the portfolio keeps trading).
 *
 * The `$100` floor in the first check exists so tokens that legitimately
 * had small investments don't trigger on a $50 realized loss — only
 * tokens whose realized P&L is wildly out of proportion to their
 * historical capital usage trip.
 */

import type { Invariant, Violation } from '../types.js';

const ABSOLUTE_FLOOR_USD = 100; // tokens below this floor are too small to trip the 10x check meaningfully
const INVESTMENT_RATIO_MAX = 10; // |realizedPnL| cannot exceed 10× capital ever invested in this name

export const fictionalPnl: Invariant = (ctx) => {
  if (ctx.totalPortfolioValue <= 0) return null; // can't sanity-check ratios against zero

  const offenders: Array<{
    symbol: string;
    realizedPnL: number;
    totalInvestedUSD: number;
    ratioToInvested: number;
    ratioToPortfolio: number;
    reason: 'exceeds-portfolio' | 'exceeds-invested-ratio' | 'both';
  }> = [];

  for (const [symbol, cb] of Object.entries(ctx.costBasis)) {
    if (!cb) continue;
    const realized = cb.realizedPnL ?? 0;
    const absRealized = Math.abs(realized);
    const invested = cb.totalInvestedUSD ?? 0;

    // Check 1: realized cannot exceed entire portfolio value
    const exceedsPortfolio = absRealized > ctx.totalPortfolioValue;

    // Check 2: realized cannot exceed 10× capital ever invested in this token.
    // The investment ratio cap only fires if realized is also above the
    // absolute floor — otherwise tokens with $5 invested and $60 realized
    // P&L (12× ratio, but $60 is rounding error) generate false positives.
    const ratioCap = INVESTMENT_RATIO_MAX * Math.max(invested, ABSOLUTE_FLOOR_USD / INVESTMENT_RATIO_MAX);
    const exceedsRatio = absRealized > ratioCap && absRealized > ABSOLUTE_FLOOR_USD;

    if (!exceedsPortfolio && !exceedsRatio) continue;

    offenders.push({
      symbol,
      realizedPnL: realized,
      totalInvestedUSD: invested,
      ratioToInvested: invested > 0 ? absRealized / invested : Infinity,
      ratioToPortfolio: absRealized / ctx.totalPortfolioValue,
      reason: exceedsPortfolio && exceedsRatio ? 'both'
        : exceedsPortfolio ? 'exceeds-portfolio'
        : 'exceeds-invested-ratio',
    });
  }

  if (offenders.length === 0) return null;

  // Sort worst-first so logs name the most egregious offender prominently
  offenders.sort((a, b) => Math.abs(b.realizedPnL) - Math.abs(a.realizedPnL));

  const violation: Violation = {
    invariantId: 'INV-2',
    invariantName: 'fictional-per-token-pnl',
    severity: 'SEVERE',
    message: `${offenders.length} token(s) report realizedPnL larger than physically possible; worst: ${offenders[0].symbol} at $${offenders[0].realizedPnL.toFixed(2)} (${offenders[0].ratioToPortfolio.toFixed(1)}× portfolio)`,
    observed: {
      offenderCount: offenders.length,
      worstOffender: offenders[0],
      allOffenders: offenders,
      portfolioValue: ctx.totalPortfolioValue,
    },
    expected: {
      rule: `for each token T: |cb.realizedPnL| < max($${ABSOLUTE_FLOOR_USD}, ${INVESTMENT_RATIO_MAX} × cb.totalInvestedUSD) AND < totalPortfolioValue`,
    },
    pauseScope: 'per-token-buys',
    affectedTokens: offenders.map(o => o.symbol),
    detectedAt: new Date().toISOString(),
  };

  return violation;
};
