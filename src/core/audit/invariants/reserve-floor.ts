/**
 * NVR-SPEC-035 INV-6 — Reserve floor (Phase B, WARN tier).
 *
 * Asserts that the USDC reserve stays at or above the 25% portfolio target
 * with a 5pp tolerance band (warns when reserve drops below 20%). This is
 * the structural counterpart to the "USDC-reserve is the only hard rule"
 * line in the strategy spec — until now that rule lived as documentation
 * and a soft `MIN_DRY_POWDER_PCT = 0.25` constant the bot was expected to
 * respect. Now drift surfaces every cycle.
 *
 * Why WARN, not SEVERE:
 *   - There are legitimate moments to be below 25% briefly (mid-deployment,
 *     just after a high-conviction buy). Gating execution would punish the
 *     bot for normal capital flow.
 *   - The cure for under-reserve is to SELL into reserve, which a buy-pause
 *     wouldn't enable. Informational pressure (via the prompt-injection
 *     loop) is the right shape — the bot reads the gap and decides.
 *
 * Why 20% warning band (not exactly 25%):
 *   - Cycle-by-cycle price drift can push the ratio 1-2pp around the
 *     target without any trading. A tight band would fire on noise.
 *   - 5pp gives a real margin for normal trading without surrendering the
 *     "alpha-strike reserve" intent of the rule.
 *
 * Skip portfolio < $500 — same threshold as INV-5; tiny bots can't be
 * usefully measured against a 25% rule that depends on having enough
 * dollars to allocate meaningfully.
 *
 * Memory: project_nvr_strategy_shape — "~25% hardcoded USDC alpha-strike
 * reserve. USDC-reserve is the only hard rule; sector composition stays
 * bot-driven."
 */

import type { Invariant, Violation } from '../types.js';

const RESERVE_TARGET_PCT = 0.25;
const WARN_FLOOR_PCT = 0.20;
const MIN_PORTFOLIO_USD = 500;

export const reserveFloor: Invariant = (ctx) => {
  if (ctx.totalPortfolioValue < MIN_PORTFOLIO_USD) return null;

  let usdcBalance = 0;
  for (const b of ctx.balances) {
    if (b.symbol === 'USDC') usdcBalance += b.usdValue ?? 0;
  }

  const usdcPct = usdcBalance / ctx.totalPortfolioValue;
  if (usdcPct >= WARN_FLOOR_PCT) return null;

  const targetUsd = ctx.totalPortfolioValue * RESERVE_TARGET_PCT;
  const floorUsd = ctx.totalPortfolioValue * WARN_FLOOR_PCT;
  const gapToTargetUsd = targetUsd - usdcBalance;
  const gapToFloorUsd = floorUsd - usdcBalance;

  const violation: Violation = {
    invariantId: 'INV-6',
    invariantName: 'reserve-floor',
    severity: 'WARN',
    message: `USDC reserve at ${(usdcPct * 100).toFixed(1)}% — below the ${(WARN_FLOOR_PCT * 100).toFixed(0)}% warning floor (target ${(RESERVE_TARGET_PCT * 100).toFixed(0)}%). Gap $${gapToTargetUsd.toFixed(0)} to target / $${gapToFloorUsd.toFixed(0)} to floor.`,
    observed: {
      usdcBalance: parseFloat(usdcBalance.toFixed(2)),
      usdcPct: parseFloat((usdcPct * 100).toFixed(2)),
      targetPct: RESERVE_TARGET_PCT * 100,
      warnFloorPct: WARN_FLOOR_PCT * 100,
      targetUsd: parseFloat(targetUsd.toFixed(2)),
      gapToTargetUsd: parseFloat(gapToTargetUsd.toFixed(2)),
      gapToFloorUsd: parseFloat(gapToFloorUsd.toFixed(2)),
      portfolioValue: ctx.totalPortfolioValue,
    },
    expected: {
      rule: `USDC reserve ≥ ${(WARN_FLOOR_PCT * 100).toFixed(0)}% of portfolio (target ${(RESERVE_TARGET_PCT * 100).toFixed(0)}%, ${((RESERVE_TARGET_PCT - WARN_FLOOR_PCT) * 100).toFixed(0)}pp tolerance)`,
    },
    pauseScope: 'none',
    detectedAt: new Date().toISOString(),
  };

  return violation;
};
