/**
 * INV-1 tests — pure-function invariant. Synthetic state, no network.
 */

import { describe, it, expect } from 'vitest';
import { dimensionalHonesty } from '../invariants/dimensional-honesty.js';
import type { InvariantContext } from '../types.js';

function makeCtx(overrides: Partial<InvariantContext> = {}): InvariantContext {
  return {
    balances: [],
    totalPortfolioValue: 3000,
    costBasis: {},
    lastKnownPrices: {},
    capturedPrompt: null,
    cycle: 100,
    previousReport: null,
    auditorCyclesRun: 5,
    ...overrides,
  };
}

describe('INV-1 dimensional honesty', () => {
  it('returns null when portfolio is below the minimum threshold', () => {
    const v = dimensionalHonesty(makeCtx({ totalPortfolioValue: 10 }));
    expect(v).toBeNull();
  });

  it('returns null when all three sources agree exactly', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
      },
      lastKnownPrices: { WETH: { price: 2000 } },
    });
    expect(dimensionalHonesty(ctx)).toBeNull();
  });

  it('returns null when sources agree within tolerance (1% drift)', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2020 }, // 1% above
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
      },
      lastKnownPrices: { WETH: { price: 2000 } },
    });
    expect(dimensionalHonesty(ctx)).toBeNull();
  });

  it('fires SEVERE when balances.usdValue sum diverges from totalPortfolioValue by >2%', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 1500 }, // way below
        { symbol: 'USDC', balance: 100, usdValue: 100 },
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 1500, totalTokensAcquired: 1, averageCostBasis: 1500, currentHolding: 1 },
      },
      lastKnownPrices: { WETH: { price: 1500 } },
    });
    const v = dimensionalHonesty(ctx);
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('SEVERE');
    expect(v!.invariantId).toBe('INV-1');
    expect(v!.pauseScope).toBe('all-buys');
    expect(v!.observed.outlier).toBe('C'); // totalPortfolioValue is the odd one out
  });

  it('identifies the costBasis-position-sum as the outlier when it disagrees with both other sources', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
      ],
      costBasis: {
        // The costBasis insists we hold 10× the WETH we actually own
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 20000, totalTokensAcquired: 10, averageCostBasis: 2000, currentHolding: 10 },
      },
      lastKnownPrices: { WETH: { price: 2000 } },
    });
    const v = dimensionalHonesty(ctx);
    expect(v).not.toBeNull();
    expect(v!.observed.outlier).toBe('A');
  });

  it('emits the three source values + pairwise deltas in observed', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 1500 },
      ],
      costBasis: {},
      lastKnownPrices: { WETH: { price: 1500 } },
    });
    const v = dimensionalHonesty(ctx);
    expect(v).not.toBeNull();
    expect(v!.observed.sourceB_balancesUsdSum).toBe(1500);
    expect(v!.observed.sourceC_totalPortfolioValue).toBe(3000);
    expect(typeof v!.observed.worstDeltaPct).toBe('string');
  });

  // ==========================================================================
  // 2026-05-19 polish: startup data-readiness — INV-1 must stay quiet during
  // price-stream warmup so the post-redeploy false-positive we saw on cycle 2
  // (26% spurious disagreement) doesn't fire.
  // ==========================================================================

  it('skips the check when too many positions are missing live prices (warmup)', () => {
    // Three real positions, only one has a price → coverage 33% < 80%
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'cbLTC', balance: 4, usdValue: 200 },
        { symbol: 'cbXRP', balance: 100, usdValue: 100 },
        { symbol: 'USDC', balance: 700, usdValue: 700 }, // USDC always excluded from readiness check
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
        cbLTC: { symbol: 'cbLTC', realizedPnL: 0, totalInvestedUSD: 200, totalTokensAcquired: 4, averageCostBasis: 50, currentHolding: 4 },
        cbXRP: { symbol: 'cbXRP', realizedPnL: 0, totalInvestedUSD: 100, totalTokensAcquired: 100, averageCostBasis: 1, currentHolding: 100 },
      },
      lastKnownPrices: { WETH: { price: 2000 } }, // only WETH has a price → 1/3 = 33%
    });
    expect(dimensionalHonesty(ctx)).toBeNull();
  });

  it('runs the check when coverage is above the 80% threshold', () => {
    // 4 real positions, 4 have prices → coverage 100%
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'cbLTC', balance: 4, usdValue: 200 },
        { symbol: 'cbXRP', balance: 100, usdValue: 100 },
        { symbol: 'USDC', balance: 700, usdValue: 700 },
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
        cbLTC: { symbol: 'cbLTC', realizedPnL: 0, totalInvestedUSD: 200, totalTokensAcquired: 4, averageCostBasis: 50, currentHolding: 4 },
        cbXRP: { symbol: 'cbXRP', realizedPnL: 0, totalInvestedUSD: 100, totalTokensAcquired: 100, averageCostBasis: 1, currentHolding: 100 },
      },
      lastKnownPrices: {
        WETH: { price: 2000 },
        cbLTC: { price: 50 },
        cbXRP: { price: 1 },
      },
    });
    expect(dimensionalHonesty(ctx)).toBeNull(); // all sources agree
  });

  it('does not consider sub-$1 dust positions in the readiness check', () => {
    // 1 real position priced + 50 dust positions unpriced → check still runs.
    // Real positions are 100% covered (1/1) so we don't defer for warmup;
    // the unpriced dust doesn't drag coverage down. Sources agree → null.
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 3000 },
        ...Array.from({ length: 50 }, (_, i) => ({
          symbol: `DUST${i}`,
          balance: 1,
          usdValue: 0.01,
        })),
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 3000, totalTokensAcquired: 1, averageCostBasis: 3000, currentHolding: 1 },
      },
      lastKnownPrices: { WETH: { price: 3000 } },
    });
    expect(dimensionalHonesty(ctx)).toBeNull();
  });
});
