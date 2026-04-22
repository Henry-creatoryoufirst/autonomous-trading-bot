/**
 * Payout fee accrual — extracted from agent-v3.2.ts for unit testing and
 * to guarantee ALL sell execution paths accrue identically.
 *
 * --- History / why this exists ---
 * v21.15 introduced "harvest-on-sell": on every profitable sell, reserve a
 * slice of USDC into state.pendingFeeUSDC so it cannot be re-deployed before
 * the 8 AM UTC daily payout runs.
 *
 * The v21.15 implementation was accidentally scoped to the DEX-direct sell
 * path (`executeDirectDexSwap`), which only fires for the 3 tokens in
 * DEX_SWAP_TOKENS (MORPHO, cbLTC, deSPXA). The CDP SDK path used by every
 * other token (ETH, cbBTC, ENA, DEGEN, PEPE, ...) never called the accrual
 * block, so `pendingFeeUSDC` stayed at $0 despite profitable sells.
 *
 * Symptom on prod 2026-04-22: +$910.53 realized across 30 trades / 23 sells
 * today, but `pendingFeeUSDC` = 0 and the dashboard's Morning Payout widget
 * said "+$0.00 expected tomorrow".
 *
 * Fix: funnel both sell paths through this single function so there is
 * exactly one accrual rule, covered by a unit test, lifted out of the
 * execution-layer try/catch surface.
 */

export interface HarvestRecipient {
  label: string;
  wallet: string;
  percent: number;
}

export interface AutoHarvestConfigSlim {
  enabled: boolean;
  recipients: HarvestRecipient[];
}

export interface PayoutAccrualState {
  pendingFeeUSDC: number;
}

export interface AccrualResult {
  accrued: number;      // USD added to pendingFeeUSDC this call (0 if no-op)
  newPending: number;   // state.pendingFeeUSDC after this call
  totalPct: number;     // sum of recipient percents (0-100)
}

/**
 * Reserve a portion of realized profit into state.pendingFeeUSDC.
 *
 * No-op when:
 *   - autoHarvest is disabled
 *   - no recipients are configured
 *   - realizedPnL <= 0 (losses don't accrue)
 *   - totalPct <= 0
 *
 * Otherwise: pendingFeeUSDC += realizedPnL * (totalPct / 100)
 *
 * @param state        mutable state slice with pendingFeeUSDC
 * @param realizedPnL  USD profit from the sell that just completed
 * @param config       autoHarvest config (enabled + recipients)
 * @returns diagnostic object — caller decides whether to log it.
 */
export function accruePayoutFee(
  state: PayoutAccrualState,
  realizedPnL: number,
  config: AutoHarvestConfigSlim,
): AccrualResult {
  const totalPct = (config.recipients || []).reduce(
    (sum: number, r: HarvestRecipient) => sum + (r.percent || 0),
    0,
  );

  // Guard clauses — each of these is a legitimate no-op, not an error.
  if (!config.enabled) {
    return { accrued: 0, newPending: state.pendingFeeUSDC || 0, totalPct };
  }
  if (!Array.isArray(config.recipients) || config.recipients.length === 0) {
    return { accrued: 0, newPending: state.pendingFeeUSDC || 0, totalPct };
  }
  if (!(realizedPnL > 0)) {
    // Losses don't accrue — payout fees are collected only on up trades.
    return { accrued: 0, newPending: state.pendingFeeUSDC || 0, totalPct };
  }
  if (!(totalPct > 0)) {
    return { accrued: 0, newPending: state.pendingFeeUSDC || 0, totalPct };
  }

  const accrued = realizedPnL * (totalPct / 100);
  const newPending = (state.pendingFeeUSDC || 0) + accrued;
  state.pendingFeeUSDC = newPending;
  return { accrued, newPending, totalPct };
}

/**
 * Expected pendingFeeUSDC given today's realized P&L and the current
 * recipient-percent split. Used by /api/diagnostics/payout-accrual to
 * compute drift vs. the actual pendingFeeUSDC on state.
 */
export function expectedPendingFee(
  realizedPnLToday: number,
  config: AutoHarvestConfigSlim,
): number {
  if (!config.enabled) return 0;
  if (!(realizedPnLToday > 0)) return 0;
  const totalPct = (config.recipients || []).reduce(
    (sum: number, r: HarvestRecipient) => sum + (r.percent || 0),
    0,
  );
  if (!(totalPct > 0)) return 0;
  return realizedPnLToday * (totalPct / 100);
}
