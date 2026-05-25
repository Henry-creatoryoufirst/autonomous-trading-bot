/**
 * NVR-SPEC-035 INV-11 — Chain-deposit reconciliation (Phase A.1).
 *
 * Compares the bot's in-state `state.totalDeposited` field against the
 * SUM of actual USDC inflows the wallet has received from non-router
 * sources across all of chain history (per ChainDepositHistory source).
 *
 * The Zack case-study: bot says totalDeposited = $846. Chain shows
 * $1,000 was originally sent from Zack's user wallet to a PRIOR wallet
 * the bot used (since rotated). The bot's accounting reset at rotation
 * and lost the $154 of pre-rotation losses. INV-11 catches this class:
 * any time the chain says "more was deposited than the bot remembers."
 *
 * SEVERE on divergence > $5 AND > 2% of portfolio. Pause scope: all-displays.
 *
 * Why pause-scope all-displays (2026-05-25 promotion from 'none'):
 *   - Unlike INV-10 (where in-state is wrong about CURRENT inventory),
 *     INV-11 is about HISTORICAL deposit-tracking. Today's trading
 *     decisions don't depend on yesterday's deposit history. The bug
 *     is one of REPORTING (PnL is wrong relative to true capital), not
 *     of operational safety. So `all-buys` would over-react.
 *   - But `none` lets the customer dashboard render hallucinated PnL
 *     while the substrate knows the math is wrong. The 2026-05-23/24
 *     incident — bot showed +78% on $1,891 deposits while real
 *     deposits were ~$3,277 (true performance ~-7%) — is exactly the
 *     trust failure this scope prevents. `all-displays` keeps trading
 *     running and forces the dashboard to refuse PnL until the
 *     reconciliation is resolved.
 *
 * The output's `unaccountedUsd` field is what users care about — it's
 * the "missing deposit" Henry was hunting for the Zack case.
 */

import type { Invariant, Violation } from '../types.js';

const ABS_TOLERANCE_USD = 5;
const PORTFOLIO_RATIO_TOLERANCE = 0.02; // 2% — divergence must exceed both thresholds

export const chainDepositReconciliation: Invariant = (ctx) => {
  const history = ctx.chainDepositHistory;
  if (!history) return null;
  if (!history.complete) {
    console.log(`[SystemAudit:warmup] INV-11 skipped — chain deposit history scan had ${history.errors.length} error(s), partial data`);
    return null;
  }
  if (ctx.botTotalDeposited === null || ctx.botTotalDeposited === undefined) return null;

  const chainTotal = history.totalDepositedUsd;
  const botTotal = ctx.botTotalDeposited;
  const unaccountedUsd = chainTotal - botTotal;

  // Both checks must trip — small absolute deltas on big portfolios are noise;
  // small ratio deltas on tiny portfolios are noise too.
  const absExceeds = Math.abs(unaccountedUsd) > ABS_TOLERANCE_USD;
  const portfolioRatio = ctx.totalPortfolioValue > 0
    ? Math.abs(unaccountedUsd) / ctx.totalPortfolioValue
    : 0;
  const ratioExceeds = portfolioRatio > PORTFOLIO_RATIO_TOLERANCE;

  if (!absExceeds || !ratioExceeds) return null;

  // Identify the most likely-missed deposits — large ones the bot didn't
  // capture in its in-state recentDeposits list. We can't perfectly diff
  // here without the bot's per-deposit history, but we surface the largest
  // chain deposits so the operator can see which one(s) drifted.
  const topMissing = history.deposits
    .filter(d => d.usdValue >= 10)
    .slice(0, 5)
    .map(d => ({
      block: d.blockNumber,
      tx: d.txHash.slice(0, 14) + '..',
      from: d.fromAddress.slice(0, 14) + '..',
      usdValue: d.usdValue,
    }));

  const direction = unaccountedUsd > 0 ? 'UNDER-COUNTED' : 'OVER-COUNTED';
  const violation: Violation = {
    invariantId: 'INV-11',
    invariantName: 'chain-deposit-reconciliation',
    severity: 'SEVERE',
    message: `Bot's totalDeposited ${direction} by $${Math.abs(unaccountedUsd).toFixed(2)} vs chain-truth ($${botTotal.toFixed(2)} bot vs $${chainTotal.toFixed(2)} chain). Lifetime PnL math is wrong by this amount.`,
    observed: {
      chainTotalDepositedUsd: chainTotal,
      botTotalDepositedUsd: botTotal,
      unaccountedUsd,
      portfolioRatioPct: (portfolioRatio * 100).toFixed(2),
      direction,
      topChainDeposits: topMissing,
      historyScannedAt: history.capturedAt,
      historyDepositCount: history.deposits.length,
    },
    expected: {
      rule: `bot.totalDeposited must equal sum(chain USDC inflows from non-router senders > $${ABS_TOLERANCE_USD})`,
    },
    pauseScope: 'all-displays',
    detectedAt: new Date().toISOString(),
  };

  return violation;
};
