/**
 * Funding-rate monitor — slippage math tests (NVR-SPEC-034 Phase 1a).
 *
 * Coverage focuses on computeSlippageFromBook, the pure-function deliverable
 * the spec gates Phase 1a completion on. Network adapters (OKX, Hyperliquid,
 * Bitfinex) are exercised by the manual verification script
 * (scripts/sample-funding-rate.ts), not unit tests — they require network
 * and would be flaky in CI.
 */

import { describe, it, expect } from 'vitest';
import {
  computeSlippageFromBook,
  computeSlippageCurve,
  type DepthLevel,
  type DepthSnapshot,
} from '../funding-rate-monitor.js';

// ----------------------------------------------------------------------------
// Synthetic books — tuned so the expected slippage numbers are easy to read.
// ----------------------------------------------------------------------------

/** Deep book around $100k mid. $50, $100, $300, $500 all fill on level 1. */
const DEEP_BOOK: { asks: DepthLevel[]; bids: DepthLevel[]; mid: number } = {
  asks: [
    { price: 100_010, size: 5 }, // $500k notional at level 1
    { price: 100_020, size: 5 },
    { price: 100_050, size: 10 },
  ],
  bids: [
    { price: 99_990, size: 5 },
    { price: 99_980, size: 5 },
    { price: 99_950, size: 10 },
  ],
  mid: 100_000,
};

/** Thin book — small first level, larger second. Forces level-walking. */
const THIN_BOOK: { asks: DepthLevel[]; bids: DepthLevel[]; mid: number } = {
  asks: [
    { price: 100_010, size: 0.001 }, // ~$100 of liquidity at L1
    { price: 100_100, size: 0.01 },  // ~$1k at L2
    { price: 101_000, size: 0.05 },  // ~$5k at L3
  ],
  bids: [
    { price: 99_990, size: 0.001 },
    { price: 99_900, size: 0.01 },
    { price: 99_000, size: 0.05 },
  ],
  mid: 100_000,
};

/** Pathologically thin book — $500 cannot be filled. */
const EXHAUSTED_BOOK: { asks: DepthLevel[]; bids: DepthLevel[]; mid: number } = {
  asks: [
    { price: 100_010, size: 0.001 }, // ~$100 of notional, nothing else
  ],
  bids: [
    { price: 99_990, size: 0.001 },
  ],
  mid: 100_000,
};

// ----------------------------------------------------------------------------
// Pure slippage math
// ----------------------------------------------------------------------------

describe('computeSlippageFromBook — deep book', () => {
  it('fills $300 buy entirely on level 1 with minimal slippage', () => {
    const { fillPrice, slippageBps, exhausted } = computeSlippageFromBook(
      DEEP_BOOK,
      300,
      'buy',
      DEEP_BOOK.mid,
    );
    expect(exhausted).toBe(false);
    expect(fillPrice).toBeCloseTo(100_010, 0);
    // $300 at level 1 only → fill = $100_010, mid = $100_000 → +1 bp
    expect(slippageBps).toBeCloseTo(1, 1);
  });

  it('fills $500 sell entirely on level 1 with minimal slippage', () => {
    const { fillPrice, slippageBps, exhausted } = computeSlippageFromBook(
      DEEP_BOOK,
      500,
      'sell',
      DEEP_BOOK.mid,
    );
    expect(exhausted).toBe(false);
    expect(fillPrice).toBeCloseTo(99_990, 0);
    expect(slippageBps).toBeCloseTo(1, 1);
  });

  it('returns positive slippage in bps for both sides', () => {
    const buy = computeSlippageFromBook(DEEP_BOOK, 100, 'buy', DEEP_BOOK.mid);
    const sell = computeSlippageFromBook(DEEP_BOOK, 100, 'sell', DEEP_BOOK.mid);
    expect(buy.slippageBps).toBeGreaterThan(0);
    expect(sell.slippageBps).toBeGreaterThan(0);
  });
});

describe('computeSlippageFromBook — thin book (level walking)', () => {
  it('walks past level 1 when notional exceeds level-1 depth', () => {
    // L1 ask: $100_010 × 0.001 = ~$100 of liquidity. $300 has to walk to L2.
    const { fillPrice, slippageBps, exhausted } = computeSlippageFromBook(
      THIN_BOOK,
      300,
      'buy',
      THIN_BOOK.mid,
    );
    expect(exhausted).toBe(false);
    // Fill should be a volume-weighted blend, between L1 ($100_010) and L2 ($100_100).
    expect(fillPrice).toBeGreaterThan(100_010);
    expect(fillPrice).toBeLessThan(100_100);
    // Slippage materially worse than the deep-book equivalent (~1 bp).
    expect(slippageBps).toBeGreaterThan(5);
  });

  it('walks past level 2 when notional exceeds combined L1+L2 depth', () => {
    // L1+L2 ≈ $100 + $1_001 = $1_101. $500 fits inside L1+L2.
    const { fillPrice, exhausted } = computeSlippageFromBook(
      THIN_BOOK,
      500,
      'buy',
      THIN_BOOK.mid,
    );
    expect(exhausted).toBe(false);
    expect(fillPrice).toBeGreaterThan(100_010);
    expect(fillPrice).toBeLessThanOrEqual(100_100);
  });

  it('sells walk down the bid ladder with positive slippage', () => {
    const { fillPrice, slippageBps, exhausted } = computeSlippageFromBook(
      THIN_BOOK,
      300,
      'sell',
      THIN_BOOK.mid,
    );
    expect(exhausted).toBe(false);
    expect(fillPrice).toBeLessThan(99_990);
    expect(fillPrice).toBeGreaterThan(99_900);
    expect(slippageBps).toBeGreaterThan(5);
  });
});

describe('computeSlippageFromBook — exhausted book', () => {
  it('flags exhausted=true when notional exceeds total ask depth', () => {
    const { exhausted, fillPrice } = computeSlippageFromBook(
      EXHAUSTED_BOOK,
      500,
      'buy',
      EXHAUSTED_BOOK.mid,
    );
    expect(exhausted).toBe(true);
    // Partial fill still reports a price (L1 fill), not zero.
    expect(fillPrice).toBeGreaterThan(0);
  });

  it('flags exhausted=true on the sell side when bids run out', () => {
    const { exhausted } = computeSlippageFromBook(
      EXHAUSTED_BOOK,
      500,
      'sell',
      EXHAUSTED_BOOK.mid,
    );
    expect(exhausted).toBe(true);
  });

  it('handles a totally empty book without throwing', () => {
    const { exhausted, fillPrice, slippageBps } = computeSlippageFromBook(
      { asks: [], bids: [] },
      100,
      'buy',
      100_000,
    );
    expect(exhausted).toBe(true);
    expect(fillPrice).toBe(0);
    expect(slippageBps).toBe(Infinity);
  });

  it('throws on non-positive notional', () => {
    expect(() => computeSlippageFromBook(DEEP_BOOK, 0, 'buy', DEEP_BOOK.mid)).toThrow();
    expect(() => computeSlippageFromBook(DEEP_BOOK, -50, 'buy', DEEP_BOOK.mid)).toThrow();
  });
});

describe('computeSlippageCurve', () => {
  it('returns one point per notional rung in NOTIONAL_LADDER, both sides', () => {
    const snapshot: DepthSnapshot = {
      ts: 1_700_000_000_000,
      venue: 'okx',
      asset: 'BTC',
      bids: DEEP_BOOK.bids,
      asks: DEEP_BOOK.asks,
      midPrice: DEEP_BOOK.mid,
    };
    const buyCurve = computeSlippageCurve(snapshot, 'buy');
    const sellCurve = computeSlippageCurve(snapshot, 'sell');

    expect(buyCurve.points).toHaveLength(4);
    expect(sellCurve.points).toHaveLength(4);
    expect(buyCurve.points.map(p => p.notionalUsd)).toEqual([50, 100, 300, 500]);
    expect(buyCurve.side).toBe('buy');
    expect(sellCurve.side).toBe('sell');
    expect(buyCurve.midPrice).toBe(DEEP_BOOK.mid);
  });

  it('reports exhaustion at higher rungs on a thin book', () => {
    const snapshot: DepthSnapshot = {
      ts: 1_700_000_000_000,
      venue: 'okx',
      asset: 'BTC',
      bids: EXHAUSTED_BOOK.bids,
      asks: EXHAUSTED_BOOK.asks,
      midPrice: EXHAUSTED_BOOK.mid,
    };
    const buyCurve = computeSlippageCurve(snapshot, 'buy');
    const $50 = buyCurve.points.find(p => p.notionalUsd === 50)!;
    const $500 = buyCurve.points.find(p => p.notionalUsd === 500)!;
    expect($50.exhausted).toBe(false);
    expect($500.exhausted).toBe(true);
  });
});
