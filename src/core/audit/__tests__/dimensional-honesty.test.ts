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
      lastKnownPrices: {},
    });
    const v = dimensionalHonesty(ctx);
    expect(v).not.toBeNull();
    expect(v!.observed.sourceB_balancesUsdSum).toBe(1500);
    expect(v!.observed.sourceC_totalPortfolioValue).toBe(3000);
    expect(typeof v!.observed.worstDeltaPct).toBe('string');
  });
});
