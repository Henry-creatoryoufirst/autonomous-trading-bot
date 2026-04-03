import { describe, it, expect, beforeEach } from 'vitest';
import { setState } from '../../state/index.js';
import {
  getOrCreateCostBasis,
  updateCostBasisAfterBuy,
  updateCostBasisAfterSell,
  updateUnrealizedPnL,
} from '../cost-basis.js';

import type { TokenCostBasis } from '../../../types/index.js';
import type { AgentState } from '../../../types/state.js';

type CostBasisMap = Record<string, TokenCostBasis>;
type PriceMap = Record<string, { price: number; [key: string]: any }>;

/** Create a minimal AgentState with a fresh costBasis map for testing. */
function initTestState(): CostBasisMap {
  const costBasis: CostBasisMap = {};
  // Provide a minimal AgentState stub with costBasis populated.
  // Only the fields used by portfolio functions need to be present.
  setState({
    costBasis,
    errorLog: [],
    tradeFailures: {},
  } as unknown as AgentState);
  return costBasis;
}

// ===========================================================================
// getOrCreateCostBasis
// ===========================================================================
describe('getOrCreateCostBasis', () => {
  beforeEach(() => { initTestState(); });

  it('creates a new zero-valued entry for an unknown symbol', () => {
    const cb = getOrCreateCostBasis('ETH');
    expect(cb.symbol).toBe('ETH');
    expect(cb.totalInvestedUSD).toBe(0);
    expect(cb.totalTokensAcquired).toBe(0);
    expect(cb.averageCostBasis).toBe(0);
    expect(cb.realizedPnL).toBe(0);
  });

  it('returns the existing entry when called twice', () => {
    const first = getOrCreateCostBasis('ETH');
    first.totalInvestedUSD = 500;
    const second = getOrCreateCostBasis('ETH');
    expect(second.totalInvestedUSD).toBe(500);
    expect(second).toBe(first); // same reference
  });
});

// ===========================================================================
// updateCostBasisAfterBuy — new position
// ===========================================================================
describe('updateCostBasisAfterBuy', () => {
  beforeEach(() => { initTestState(); });

  it('records a new position correctly', () => {
    const map = initTestState();
    const prices: PriceMap = { ETH: { price: 2500 } };
    updateCostBasisAfterBuy('ETH', 500, 0.2, prices);

    const cb = map['ETH'];
    expect(cb.totalInvestedUSD).toBe(500);
    expect(cb.totalTokensAcquired).toBe(0.2);
    expect(cb.averageCostBasis).toBe(2500); // 500 / 0.2
  });

  it('averages into an existing position at a different price', () => {
    const map = initTestState();
    const prices: PriceMap = { ETH: { price: 2500 } };

    // First buy: $500 for 0.2 ETH  -> avg = $2500
    updateCostBasisAfterBuy('ETH', 500, 0.2, prices);
    // Second buy: $600 for 0.2 ETH -> avg = (500+600)/0.4 = $2750
    updateCostBasisAfterBuy('ETH', 600, 0.2, prices);

    const cb = map['ETH'];
    expect(cb.totalInvestedUSD).toBe(1100);
    expect(cb.totalTokensAcquired).toBeCloseTo(0.4);
    expect(cb.averageCostBasis).toBeCloseTo(2750);
  });

  it('handles zero tokensReceived by estimating from price map', () => {
    const map = initTestState();
    const prices: PriceMap = { ETH: { price: 2000 } };
    updateCostBasisAfterBuy('ETH', 1000, 0, prices);

    const cb = map['ETH'];
    // Should estimate 1000/2000 = 0.5 tokens
    expect(cb.totalTokensAcquired).toBeCloseTo(0.5);
    expect(cb.averageCostBasis).toBeCloseTo(2000);
  });

  it('bails out when tokensReceived=0 and no known price', () => {
    const map = initTestState();
    const prices: PriceMap = {};
    updateCostBasisAfterBuy('ETH', 1000, 0, prices);

    const cb = map['ETH'];
    expect(cb.totalInvestedUSD).toBe(0); // should not have been updated
    expect(cb.totalTokensAcquired).toBe(0);
  });

  it('resets peakPrice on re-entry after a full exit', () => {
    const map = initTestState();
    const prices: PriceMap = { ETH: { price: 3000 } };

    // First buy sets peakPrice
    updateCostBasisAfterBuy('ETH', 600, 0.2, prices);
    const cb = map['ETH'];
    expect(cb.peakPrice).toBe(3000); // 600/0.2

    // Simulate full exit
    cb.currentHolding = 0;
    cb.totalTokensAcquired = 0;

    // Re-entry at lower price
    updateCostBasisAfterBuy('ETH', 400, 0.2, prices);
    expect(cb.peakPrice).toBe(2000); // 400/0.2 — reset, not the old 3000
  });
});

// ===========================================================================
// updateCostBasisAfterSell — realized P&L
// ===========================================================================
describe('updateCostBasisAfterSell', () => {
  beforeEach(() => { initTestState(); });

  it('calculates positive realized P&L on a profitable partial sell', () => {
    const map = initTestState();
    const prices: PriceMap = { ETH: { price: 2500 } };

    // Buy 1 ETH at $2500
    updateCostBasisAfterBuy('ETH', 2500, 1, prices);

    // Sell 0.5 ETH at $3000 each = $1500 received
    const pnl = updateCostBasisAfterSell('ETH', 1500, 0.5);

    // P&L = (3000 - 2500) * 0.5 = $250
    expect(pnl).toBeCloseTo(250);
    expect(map['ETH'].realizedPnL).toBeCloseTo(250);
    expect(map['ETH'].totalTokensAcquired).toBeCloseTo(0.5);
  });

  it('calculates negative realized P&L on a losing sell', () => {
    const map = initTestState();
    const prices: PriceMap = { ETH: { price: 2500 } };

    // Buy 1 ETH at $2500
    updateCostBasisAfterBuy('ETH', 2500, 1, prices);

    // Sell 1 ETH at $2000 each = $2000 received
    const pnl = updateCostBasisAfterSell('ETH', 2000, 1);

    // P&L = (2000 - 2500) * 1 = -$500
    expect(pnl).toBeCloseTo(-500);
    expect(map['ETH'].realizedPnL).toBeCloseTo(-500);
    expect(map['ETH'].totalTokensAcquired).toBeCloseTo(0);
  });

  it('returns 0 when there is no cost basis (treats as revenue-neutral)', () => {
    initTestState();
    // Sell without ever buying — no cost basis
    const pnl = updateCostBasisAfterSell('ETH', 500, 0.1);
    expect(pnl).toBe(0);
  });

  it('reduces totalInvestedUSD proportionally on partial sell', () => {
    const map = initTestState();
    const prices: PriceMap = { ETH: { price: 2000 } };

    updateCostBasisAfterBuy('ETH', 2000, 1, prices);
    // Sell half
    updateCostBasisAfterSell('ETH', 1200, 0.5);

    // Invested should drop by 50%
    expect(map['ETH'].totalInvestedUSD).toBeCloseTo(1000);
  });
});

// ===========================================================================
// updateUnrealizedPnL
// ===========================================================================
describe('updateUnrealizedPnL', () => {
  beforeEach(() => { initTestState(); });

  it('computes unrealized P&L from current price vs avg cost', () => {
    const map = initTestState();
    const prices: PriceMap = { ETH: { price: 2000 } };
    updateCostBasisAfterBuy('ETH', 2000, 1, prices);

    const balances = [
      { symbol: 'ETH', balance: 1, usdValue: 2500, price: 2500 },
    ];
    updateUnrealizedPnL(balances);

    // Unrealized = (2500 - 2000) * 1 = $500
    expect(map['ETH'].unrealizedPnL).toBeCloseTo(500);
    expect(map['ETH'].currentHolding).toBe(1);
  });

  it('skips USDC entries', () => {
    const map = initTestState();
    const balances = [
      { symbol: 'USDC', balance: 1000, usdValue: 1000, price: 1 },
    ];
    updateUnrealizedPnL(balances);
    expect(map['USDC']).toBeUndefined();
  });
});
