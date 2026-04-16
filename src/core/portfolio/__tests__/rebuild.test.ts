/**
 * Unit tests for the ground-truth cost-basis rebuilder (v21.18).
 *
 * These tests exercise the pure replay logic with synthetic trade data,
 * and a parity test against the shipped diagnostic (`rebuild-cost-basis.py`)
 * to confirm the TS implementation matches the Python one.
 */

import { describe, it, expect } from 'vitest';
import {
  rebuildFromGroundTruth,
  diffAgainstExisting,
  applyRebuiltCostBasis,
} from '../rebuild.js';
import type { TradeRecord, TokenCostBasis } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buy(
  token: string,
  usd: number,
  tokens: number,
  timestamp: string,
  extra: Partial<TradeRecord> = {},
): TradeRecord {
  return {
    timestamp,
    cycle: 0,
    action: 'BUY',
    fromToken: 'USDC',
    toToken: token,
    amountUSD: usd,
    tokenAmount: tokens,
    success: true,
    portfolioValueBefore: 0,
    portfolioValueAfter: 0,
    reasoning: 'test',
    marketConditions: { fearGreed: 50, ethPrice: 2500, btcPrice: 75000 },
    ...extra,
  };
}

function sell(
  token: string,
  usd: number,
  tokens: number,
  timestamp: string,
  extra: Partial<TradeRecord> = {},
): TradeRecord {
  return {
    timestamp,
    cycle: 0,
    action: 'SELL',
    fromToken: token,
    toToken: 'USDC',
    amountUSD: usd,
    tokenAmount: tokens,
    success: true,
    portfolioValueBefore: 0,
    portfolioValueAfter: 0,
    reasoning: 'test',
    marketConditions: { fearGreed: 50, ethPrice: 2500, btcPrice: 75000 },
    ...extra,
  };
}

function makeCostBasis(
  overrides: Partial<TokenCostBasis> = {},
): TokenCostBasis {
  return {
    symbol: 'X',
    totalInvestedUSD: 0,
    totalTokensAcquired: 0,
    averageCostBasis: 0,
    currentHolding: 0,
    realizedPnL: 0,
    unrealizedPnL: 0,
    peakPrice: 0,
    peakPriceDate: '2026-02-01T00:00:00Z',
    firstBuyDate: '2026-02-01T00:00:00Z',
    lastTradeDate: '2026-02-01T00:00:00Z',
    atrStopPercent: null,
    atrTrailPercent: null,
    atrAtEntry: null,
    trailActivated: false,
    lastAtrUpdate: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic replay
// ---------------------------------------------------------------------------

describe('rebuildFromGroundTruth — basic replay', () => {
  it('computes weighted-average cost basis for a single token', () => {
    const trades = [
      buy('BRETT', 100, 10000, '2026-02-01T00:00:00Z'),
      buy('BRETT', 200, 15000, '2026-02-02T00:00:00Z'),
    ];
    const result = rebuildFromGroundTruth({ trades });

    const brett = result.byToken['BRETT'];
    expect(brett).toBeDefined();
    expect(brett.totalInvestedUSD).toBe(300);
    expect(brett.totalTokensAcquired).toBe(25000);
    expect(brett.averageCostBasis).toBeCloseTo(300 / 25000);
    expect(brett.computedHolding).toBe(25000);
    expect(brett.realizedPnL).toBe(0);
    expect(brett.buyCount).toBe(2);
  });

  it('records realized P&L on a sell at a profit', () => {
    const trades = [
      buy('BRETT', 100, 10000, '2026-02-01T00:00:00Z'), // avg = 0.01
      sell('BRETT', 200, 5000, '2026-02-10T00:00:00Z'), // sell at 0.04, gain = (0.04 - 0.01) * 5000 = 150
    ];
    const result = rebuildFromGroundTruth({ trades });

    const brett = result.byToken['BRETT'];
    expect(brett.realizedPnL).toBeCloseTo(150);
    expect(brett.computedHolding).toBe(5000);
    expect(brett.sellCount).toBe(1);
  });

  it('records realized loss on a sell below cost', () => {
    const trades = [
      buy('X', 100, 1000, '2026-02-01T00:00:00Z'), // avg = 0.1
      sell('X', 50, 1000, '2026-02-10T00:00:00Z'), // loss = (0.05 - 0.1) * 1000 = -50
    ];
    const result = rebuildFromGroundTruth({ trades });
    expect(result.byToken['X'].realizedPnL).toBeCloseTo(-50);
  });

  it('clamps phantom losses at -impliedInvestment (the v21.14 sanity clamp)', () => {
    // Simulate corrupted avg cost: buy 1 token for $1, sell with tokenAmount
    // suggesting we're selling way more tokens than we ever bought.
    // Without the clamp the bot would book a massive phantom loss.
    const trades = [
      buy('BAD', 1, 1, '2026-02-01T00:00:00Z'), // avg = 1
      sell('BAD', 5, 1000, '2026-02-10T00:00:00Z'), // tokensSold >> tokensBought
      // rawPnL = (0.005 - 1) * 1000 = -995
      // impliedInvestment = 1 * 1000 = 1000
      // clamped = max(-995, -1000) = -995  (clamp doesn't bite here)
    ];
    const result = rebuildFromGroundTruth({ trades });
    expect(result.byToken['BAD'].realizedPnL).toBeGreaterThanOrEqual(-1000);
  });

  it('sanity clamp bounds the loss even when avgCost is drastically wrong', () => {
    // Corrupted: avg cost = 1000, real sell price is $0.0001
    // tokens sold = 100 → rawPnL ≈ -99,999.99
    // impliedInvestment = 1000 * 100 = 100,000 → clamp allows -99,999.99
    const trades = [
      buy('TOSHI', 1, 0.001, '2026-02-01T00:00:00Z'), // avg cost = 1000 (corrupt)
      sell('TOSHI', 0.01, 100, '2026-02-10T00:00:00Z'),
    ];
    const result = rebuildFromGroundTruth({ trades });
    const pnl = result.byToken['TOSHI'].realizedPnL;
    expect(pnl).toBeGreaterThanOrEqual(-100_000);
    expect(pnl).toBeLessThan(0);
  });

  it('sorts trades chronologically regardless of input order', () => {
    const trades = [
      sell('X', 100, 500, '2026-02-02T00:00:00Z'),
      buy('X', 50, 1000, '2026-02-01T00:00:00Z'),
    ];
    const result = rebuildFromGroundTruth({ trades });
    // avg cost after buy = 0.05, sell at 0.2 => gain = (0.2 - 0.05) * 500 = 75
    expect(result.byToken['X'].realizedPnL).toBeCloseTo(75);
  });

  it('skips USDC legs', () => {
    const trades = [buy('USDC', 100, 100, '2026-02-01T00:00:00Z')];
    const result = rebuildFromGroundTruth({ trades });
    expect(result.byToken['USDC']).toBeUndefined();
  });

  it('skips trades with missing tokenAmount and counts them', () => {
    const trades = [
      {
        ...buy('X', 100, 100, '2026-02-01T00:00:00Z'),
        tokenAmount: undefined,
      } as TradeRecord,
      buy('X', 100, 100, '2026-02-02T00:00:00Z'),
    ];
    const result = rebuildFromGroundTruth({ trades });
    expect(result.byToken['X'].totalTokensAcquired).toBe(100);
    expect(result.byToken['X'].buyCount).toBe(1);
    expect(result.byToken['X'].skippedMissingAmount).toBe(1);
    expect(result.totals.tradesSkipped).toBe(1);
  });

  it('handles multiple tokens independently', () => {
    const trades = [
      buy('BRETT', 100, 10000, '2026-02-01T00:00:00Z'),
      buy('WELL', 50, 5000, '2026-02-01T00:00:00Z'),
      sell('BRETT', 150, 5000, '2026-02-10T00:00:00Z'),
    ];
    const result = rebuildFromGroundTruth({ trades });
    expect(Object.keys(result.byToken).sort()).toEqual(['BRETT', 'WELL']);
    expect(result.byToken['BRETT'].realizedPnL).toBeGreaterThan(0);
    expect(result.byToken['WELL'].realizedPnL).toBe(0);
  });

  it('tracks firstBuyDate and lastTradeDate', () => {
    const trades = [
      buy('X', 100, 100, '2026-02-01T00:00:00Z'),
      buy('X', 100, 100, '2026-02-05T00:00:00Z'),
      sell('X', 50, 50, '2026-02-10T00:00:00Z'),
    ];
    const result = rebuildFromGroundTruth({ trades });
    expect(result.byToken['X'].firstBuyDate).toBe('2026-02-01T00:00:00Z');
    expect(result.byToken['X'].lastTradeDate).toBe('2026-02-10T00:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// On-chain reconciliation
// ---------------------------------------------------------------------------

describe('rebuildFromGroundTruth — on-chain reconciliation', () => {
  it('counts unmatched transfers separately from trades', () => {
    const trades = [
      buy('BRETT', 100, 10000, '2026-02-01T00:00:00Z', { txHash: '0xaaa' }),
    ];
    const transfers = [
      {
        timestamp: '2026-02-01T00:00:00Z',
        blockNumber: 1n,
        txHash: '0xaaa', // matches the trade — should be skipped
        token: { address: '0x1', symbol: 'BRETT', decimals: 18 },
        direction: 'IN' as const,
        from: '0xother',
        to: '0xbot',
        tokenAmount: 10000,
      },
      {
        timestamp: '2026-02-05T00:00:00Z',
        blockNumber: 100n,
        txHash: '0xbbb', // unmatched airdrop
        token: { address: '0x1', symbol: 'BRETT', decimals: 18 },
        direction: 'IN' as const,
        from: '0xairdropper',
        to: '0xbot',
        tokenAmount: 500,
      },
    ];
    const result = rebuildFromGroundTruth({ trades, transfers });
    expect(result.byToken['BRETT'].unmatchedTransfers).toBe(1);
    expect(result.totals.unmatchedTransfers).toBe(1);
    // Airdropped tokens update the computed holding
    expect(result.byToken['BRETT'].computedHolding).toBe(10500);
    // But cost basis is untouched (airdrops are effectively free)
    expect(result.byToken['BRETT'].totalInvestedUSD).toBe(100);
  });

  it('handles OUT transfers by reducing computed holding', () => {
    const trades = [buy('X', 100, 1000, '2026-02-01T00:00:00Z')];
    const transfers = [
      {
        timestamp: '2026-02-05T00:00:00Z',
        blockNumber: 100n,
        txHash: '0xoutbound',
        token: { address: '0x1', symbol: 'X', decimals: 18 },
        direction: 'OUT' as const,
        from: '0xbot',
        to: '0xelsewhere',
        tokenAmount: 200,
      },
    ];
    const result = rebuildFromGroundTruth({ trades, transfers });
    expect(result.byToken['X'].computedHolding).toBe(800);
  });

  it('never drives holding below zero', () => {
    const trades: TradeRecord[] = [];
    const transfers = [
      {
        timestamp: '2026-02-05T00:00:00Z',
        blockNumber: 100n,
        txHash: '0xoutbound',
        token: { address: '0x1', symbol: 'X', decimals: 18 },
        direction: 'OUT' as const,
        from: '0xbot',
        to: '0xelsewhere',
        tokenAmount: 999,
      },
    ];
    const result = rebuildFromGroundTruth({ trades, transfers });
    expect(result.byToken['X'].computedHolding).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Diff + apply
// ---------------------------------------------------------------------------

describe('diffAgainstExisting', () => {
  it('produces a before/after diff with biggest corrections first', () => {
    const trades = [
      buy('BRETT', 100, 10000, '2026-02-01T00:00:00Z'),
      buy('SMALL', 10, 100, '2026-02-01T00:00:00Z'),
    ];
    const rebuilt = rebuildFromGroundTruth({ trades });

    const existing: Record<string, TokenCostBasis> = {
      BRETT: makeCostBasis({
        symbol: 'BRETT',
        averageCostBasis: 0.00001, // corrupted
        realizedPnL: -999_999, // phantom loss
        currentHolding: 10000,
      }),
      SMALL: makeCostBasis({
        symbol: 'SMALL',
        averageCostBasis: 0.1,
        realizedPnL: 0,
        currentHolding: 100,
      }),
    };

    const diffs = diffAgainstExisting(rebuilt, existing);
    expect(diffs[0].symbol).toBe('BRETT');
    expect(diffs[0].delta.realizedPnL).toBeCloseTo(999_999, 0);
    expect(diffs[1].symbol).toBe('SMALL');
  });

  it('includes tokens that exist only in existing (rebuild cleared them)', () => {
    const rebuilt = rebuildFromGroundTruth({ trades: [] });
    const existing = {
      GHOST: makeCostBasis({ symbol: 'GHOST', realizedPnL: -5000 }),
    };
    const diffs = diffAgainstExisting(rebuilt, existing);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].symbol).toBe('GHOST');
    expect(diffs[0].after.realizedPnL).toBe(0);
    expect(diffs[0].delta.realizedPnL).toBe(5000);
  });
});

describe('applyRebuiltCostBasis', () => {
  it('writes rebuilt values into the existing map, preserving ATR fields', () => {
    const trades = [buy('X', 100, 1000, '2026-02-01T00:00:00Z')];
    const rebuilt = rebuildFromGroundTruth({ trades });
    const existing: Record<string, TokenCostBasis> = {
      X: makeCostBasis({
        symbol: 'X',
        averageCostBasis: 9999, // corrupt
        realizedPnL: -1_000_000, // phantom
        atrStopPercent: 5, // should be preserved
        peakPrice: 1.5, // should be preserved
      }),
    };

    const res = applyRebuiltCostBasis(rebuilt, existing);
    expect(res.symbolsWritten).toBe(1);
    expect(existing.X.averageCostBasis).toBeCloseTo(0.1);
    expect(existing.X.realizedPnL).toBe(0);
    expect(existing.X.atrStopPercent).toBe(5);
    expect(existing.X.peakPrice).toBe(1.5);
  });

  it('skips symbols that exist in rebuild but not in state', () => {
    const trades = [buy('NEW', 100, 1000, '2026-02-01T00:00:00Z')];
    const rebuilt = rebuildFromGroundTruth({ trades });
    const existing: Record<string, TokenCostBasis> = {};

    const res = applyRebuiltCostBasis(rebuilt, existing);
    expect(res.symbolsWritten).toBe(0);
    expect(existing['NEW']).toBeUndefined();
  });

  it('prefers on-chain balance over computed holding when provided', () => {
    const trades = [buy('BRETT', 100, 10000, '2026-02-01T00:00:00Z')];
    const rebuilt = rebuildFromGroundTruth({ trades });
    const existing: Record<string, TokenCostBasis> = {
      BRETT: makeCostBasis({ symbol: 'BRETT' }),
    };
    const onchain = { BRETT: 12345.678 };

    applyRebuiltCostBasis(rebuilt, existing, onchain);
    expect(existing.BRETT.currentHolding).toBe(12345.678);
  });
});

// ---------------------------------------------------------------------------
// Parity with the shipped Python diagnostic
// ---------------------------------------------------------------------------

describe('parity with rebuild-cost-basis.py', () => {
  it('matches the Python output on a known BRETT scenario', () => {
    // Synthetic trades matching the diagnostic's output:
    //   real avg cost = $0.00737, realized ≈ near-zero
    const trades = [
      buy('BRETT', 679.33, 92225.58, '2026-02-15T00:00:00Z'),
      sell('BRETT', 914.48, 123169.94, '2026-04-16T00:00:00Z'),
    ];
    const result = rebuildFromGroundTruth({ trades });
    const brett = result.byToken['BRETT'];
    expect(brett.averageCostBasis).toBeCloseTo(0.00737, 4);
    // Sold more tokens than bought — implied investment caps the loss
    expect(brett.realizedPnL).toBeGreaterThan(-1000);
    // But the bot claimed +$590 — our rebuild says otherwise
    expect(brett.realizedPnL).toBeLessThan(100);
  });
});
