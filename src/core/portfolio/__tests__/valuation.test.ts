/**
 * Valuation unit tests — phantom detection + large drawdown gating.
 *
 * These are pure functions, so tests exercise every branch directly.
 */

import { describe, it, expect } from 'vitest';
import {
  detectPhantomMoves,
  isRealLargeDrawdown,
  type BalanceEntry,
} from '../valuation.js';

function b(symbol: string, usdValue: number, price?: number): BalanceEntry {
  return {
    symbol,
    balance: price && price > 0 ? usdValue / price : usdValue,
    usdValue,
    price,
  };
}

describe('detectPhantomMoves', () => {
  // ==========================================================================
  // ALL-CLEAR PATH
  // ==========================================================================

  describe('normal portfolio changes (no phantom)', () => {
    it('small moves are not phantoms', () => {
      const result = detectPhantomMoves({
        prevPortfolioValue: 1000,
        newPortfolioValue: 1050, // +5%
        prevBalances: [b('WETH', 500), b('USDC', 500, 1)],
        newBalances: [b('WETH', 550), b('USDC', 500, 1)],
      });
      expect(result.isPhantomMove).toBe(false);
      expect(result.isPhantomSpike).toBe(false);
      expect(result.isPhantomDrop).toBe(false);
      expect(result.spikePercent).toBeCloseTo(5, 1);
    });

    it('moderate drops (under 10%) are not phantoms', () => {
      const result = detectPhantomMoves({
        prevPortfolioValue: 1000,
        newPortfolioValue: 920, // -8%
        prevBalances: [b('WETH', 500)],
        newBalances: [b('WETH', 420)],
      });
      expect(result.isPhantomDrop).toBe(false);
      expect(result.dropPercent).toBeCloseTo(8, 1);
    });
  });

  // ==========================================================================
  // PHANTOM DROP
  // ==========================================================================

  describe('phantom drop detection', () => {
    it('detects drops > 10% on large portfolios', () => {
      const result = detectPhantomMoves({
        prevPortfolioValue: 1000,
        newPortfolioValue: 850, // -15%
        prevBalances: [b('WETH', 500, 2000), b('USDC', 500, 1)],
        newBalances: [b('WETH', 350), b('USDC', 500, 1)], // WETH lost its price
      });
      expect(result.isPhantomDrop).toBe(true);
      expect(result.isPhantomMove).toBe(true);
      expect(result.dropPercent).toBeCloseTo(15, 1);
    });

    it('does NOT flag drops on small portfolios', () => {
      const result = detectPhantomMoves({
        prevPortfolioValue: 50, // below MIN_PORTFOLIO_FOR_PHANTOM_USD (100)
        newPortfolioValue: 40, // -20%, but portfolio too small
        prevBalances: [b('WETH', 50, 2000)],
        newBalances: [b('WETH', 40)],
      });
      expect(result.isPhantomDrop).toBe(false);
      expect(result.dropPercent).toBeCloseTo(20, 1);
    });

    it('surfaces tokens missing price data (likely feed failure)', () => {
      const result = detectPhantomMoves({
        prevPortfolioValue: 1000,
        newPortfolioValue: 850, // -15%
        prevBalances: [b('WETH', 500, 2000), b('USDC', 500, 1)],
        newBalances: [
          { symbol: 'WETH', balance: 0.175, usdValue: 350 }, // no price
          b('USDC', 500, 1),
        ],
      });
      expect(result.missingPriceTokens).toContain('WETH');
      expect(result.missingPriceTokens).not.toContain('USDC');
    });
  });

  // ==========================================================================
  // PHANTOM SPIKE
  // ==========================================================================

  describe('phantom spike detection', () => {
    it('detects spikes > 10% on large portfolios', () => {
      const result = detectPhantomMoves({
        prevPortfolioValue: 1000,
        newPortfolioValue: 1300, // +30%
        prevBalances: [b('WETH', 500, 2000), b('USDC', 500, 1)],
        newBalances: [b('WETH', 800, 3200), b('USDC', 500, 1)],
      });
      expect(result.isPhantomSpike).toBe(true);
      expect(result.spikePercent).toBeCloseTo(30, 1);
    });

    it('flags tokens jumping > 50% in one cycle', () => {
      const result = detectPhantomMoves({
        prevPortfolioValue: 1000,
        newPortfolioValue: 1500, // +50%
        prevBalances: [b('WETH', 500, 2000), b('USDC', 500, 1)],
        newBalances: [b('WETH', 1000, 4000), b('USDC', 500, 1)], // WETH doubled
      });
      expect(result.suspectTokens).toHaveLength(1);
      expect(result.suspectTokens[0].symbol).toBe('WETH');
      expect(result.suspectTokens[0].prevUSD).toBe(500);
      expect(result.suspectTokens[0].newUSD).toBe(1000);
    });

    it('flags new tokens appearing with value > $50', () => {
      const result = detectPhantomMoves({
        prevPortfolioValue: 1000,
        newPortfolioValue: 1200,
        prevBalances: [b('USDC', 1000, 1)],
        newBalances: [b('USDC', 1000, 1), b('NEW_TOKEN', 200, 2)],
      });
      expect(result.suspectTokens.some((s) => s.symbol === 'NEW_TOKEN')).toBe(true);
    });

    it('does not flag USDC as suspect', () => {
      const result = detectPhantomMoves({
        prevPortfolioValue: 500,
        newPortfolioValue: 1000, // +100%, would spike
        prevBalances: [b('USDC', 500, 1)],
        newBalances: [b('USDC', 1000, 1)],
      });
      // Even though this is a phantom spike, USDC shouldn't be in suspects
      expect(result.suspectTokens.every((s) => s.symbol !== 'USDC')).toBe(true);
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('zero previous value does not divide by zero', () => {
      const result = detectPhantomMoves({
        prevPortfolioValue: 0,
        newPortfolioValue: 100,
        prevBalances: [],
        newBalances: [b('USDC', 100, 1)],
      });
      expect(result.dropPercent).toBe(0);
      expect(result.spikePercent).toBe(0);
      expect(result.isPhantomMove).toBe(false);
    });

    it('no change returns both percents as 0', () => {
      const result = detectPhantomMoves({
        prevPortfolioValue: 1000,
        newPortfolioValue: 1000,
        prevBalances: [b('WETH', 500), b('USDC', 500, 1)],
        newBalances: [b('WETH', 500), b('USDC', 500, 1)],
      });
      expect(result.dropPercent).toBe(0);
      expect(result.spikePercent).toBe(0);
      expect(result.isPhantomMove).toBe(false);
    });
  });
});

describe('isRealLargeDrawdown', () => {
  it('returns true for real drops > 5% on large portfolios', () => {
    expect(isRealLargeDrawdown(7, 1000, false)).toBe(true);
  });

  it('returns false on phantom moves', () => {
    expect(isRealLargeDrawdown(15, 1000, true)).toBe(false);
  });

  it('returns false on small portfolios', () => {
    expect(isRealLargeDrawdown(20, 50, false)).toBe(false);
  });

  it('returns false for drops ≤ 5%', () => {
    expect(isRealLargeDrawdown(4.9, 1000, false)).toBe(false);
  });

  it('gates SHI incident reporting — only real drawdowns qualify', () => {
    // Real drawdown scenarios
    expect(isRealLargeDrawdown(6, 500, false)).toBe(true);
    expect(isRealLargeDrawdown(10, 200, false)).toBe(true);

    // Phantom (feed failure) — should NOT fire
    expect(isRealLargeDrawdown(20, 1000, true)).toBe(false);

    // Too small to matter
    expect(isRealLargeDrawdown(50, 80, false)).toBe(false);
  });
});
