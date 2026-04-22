/**
 * payout-accrual — unit tests for the fix shipped on branch
 * fix/payout-accrual-2026-04-22.
 *
 * Root bug: the v21.15 harvest-on-sell accrual block lived inside
 * executeDirectDexSwap() only, so only sells of the 3 tokens in
 * DEX_SWAP_TOKENS contributed to state.pendingFeeUSDC. Every other sell
 * (ETH, cbBTC, and ~20 others routed through the CDP SDK) silently
 * bypassed the accrual, which is why prod showed +$910 realized today and
 * pendingFeeUSDC=0.
 *
 * These tests cover the extracted accrual function that both sell paths
 * now delegate to — so any future divergence between the two paths will
 * be caught at the function-call boundary, not in hand-grepped inlined
 * blocks.
 */

import { describe, it, expect } from 'vitest';
import {
  accruePayoutFee,
  expectedPendingFee,
} from '../src/core/services/testable/payout-accrual.js';

const HARRISON = { label: 'Harrison', wallet: '0xabc', percent: 15 };
const HENRY = { label: 'Henry', wallet: '0xdef', percent: 15 };
const GAS = { label: 'NVRGasFaucet', wallet: '0x123', percent: 5 };

// Matches the prod config on 2026-04-22 when the bug was discovered.
// 15% + 15% + 5% = 35% distribution, 65% reinvest.
const PROD_CONFIG = {
  enabled: true,
  recipients: [HENRY, HARRISON, GAS],
};

describe('accruePayoutFee — the regression that caused prod pendingFeeUSDC=0', () => {
  it('realize +$100 profit → pendingFeeUSDC increases by 35% of $100 = $35.00', () => {
    const state = { pendingFeeUSDC: 0 };
    const result = accruePayoutFee(state, 100, PROD_CONFIG);
    expect(result.accrued).toBeCloseTo(35, 6);
    expect(state.pendingFeeUSDC).toBeCloseTo(35, 6);
    expect(result.newPending).toBeCloseTo(35, 6);
    expect(result.totalPct).toBe(35);
  });

  it('accumulates across many sells in a day (the case the bug broke)', () => {
    const state = { pendingFeeUSDC: 0 };
    // Simulate today's prod evidence: 23 profitable sells summing to
    // +$910.53 realized. Under the 35% rule pendingFeeUSDC should land
    // within rounding of $318.69.
    const pnls = [
      12.3, 45.8, 8.1, 120.0, 3.4, 67.2, 18.9, 22.5, 14.6,
      88.0, 9.8, 55.4, 31.1, 7.6, 142.0, 28.3, 19.5, 4.2,
      61.7, 13.0, 40.5, 51.2, 45.43,
    ];
    expect(pnls.reduce((s, p) => s + p, 0)).toBeCloseTo(910.53, 2);
    for (const pnl of pnls) accruePayoutFee(state, pnl, PROD_CONFIG);
    expect(state.pendingFeeUSDC).toBeCloseTo(910.53 * 0.35, 2); // ~$318.69
  });

  it('losses do not accrue — no fee on a $50 loss', () => {
    const state = { pendingFeeUSDC: 10 };
    const result = accruePayoutFee(state, -50, PROD_CONFIG);
    expect(result.accrued).toBe(0);
    expect(state.pendingFeeUSDC).toBe(10); // unchanged
    expect(result.newPending).toBe(10);
  });

  it('zero realized P&L is a no-op (break-even sell)', () => {
    const state = { pendingFeeUSDC: 7.5 };
    const result = accruePayoutFee(state, 0, PROD_CONFIG);
    expect(result.accrued).toBe(0);
    expect(state.pendingFeeUSDC).toBe(7.5);
  });

  it('autoHarvest disabled → no accrual even on profitable sell', () => {
    const state = { pendingFeeUSDC: 0 };
    const result = accruePayoutFee(state, 100, {
      enabled: false,
      recipients: PROD_CONFIG.recipients,
    });
    expect(result.accrued).toBe(0);
    expect(state.pendingFeeUSDC).toBe(0);
  });

  it('empty recipient list → no accrual', () => {
    const state = { pendingFeeUSDC: 0 };
    const result = accruePayoutFee(state, 100, {
      enabled: true,
      recipients: [],
    });
    expect(result.accrued).toBe(0);
    expect(state.pendingFeeUSDC).toBe(0);
  });

  it('100% distribution (edge case) — accrues full realizedPnL', () => {
    const state = { pendingFeeUSDC: 0 };
    const config = {
      enabled: true,
      recipients: [{ label: 'Sole', wallet: '0x', percent: 100 }],
    };
    const result = accruePayoutFee(state, 250, config);
    expect(result.accrued).toBe(250);
    expect(state.pendingFeeUSDC).toBe(250);
  });

  it('starts from existing pending balance — does not clobber', () => {
    const state = { pendingFeeUSDC: 200 };
    const result = accruePayoutFee(state, 100, PROD_CONFIG); // +35
    expect(result.accrued).toBeCloseTo(35, 6);
    expect(result.newPending).toBeCloseTo(235, 6);
    expect(state.pendingFeeUSDC).toBeCloseTo(235, 6);
  });
});

describe('expectedPendingFee — used by /api/diagnostics/payout-accrual', () => {
  it('returns realizedPnL * totalPct/100 for the prod config', () => {
    expect(expectedPendingFee(910.53, PROD_CONFIG)).toBeCloseTo(318.69, 2);
  });

  it('returns 0 for losses', () => {
    expect(expectedPendingFee(-50, PROD_CONFIG)).toBe(0);
  });

  it('returns 0 when autoHarvest disabled', () => {
    expect(
      expectedPendingFee(100, { enabled: false, recipients: PROD_CONFIG.recipients }),
    ).toBe(0);
  });
});
