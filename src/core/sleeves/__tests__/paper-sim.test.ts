import { describe, it, expect } from 'vitest';
import {
  simulatePaperBuy,
  simulatePaperSell,
  markToMarketSleeve,
  availablePaperUSDC,
  simulatePaperDecision,
} from '../paper-sim.js';
import type { SleeveOwnership } from '../state-types.js';
import type { TradeDecision } from '../../types/market-data.js';

/** Empty ownership scaffold for tests. */
function mkOwnership(partial: Partial<SleeveOwnership> = {}): SleeveOwnership {
  return {
    positions: {},
    realizedPnLUSD: 0,
    trades: 0,
    wins: 0,
    dailyPayouts: [],
    regimeReturns: {},
    decisions: [],
    lastDecisionAt: null,
    createdAt: '2026-04-21T00:00:00.000Z',
    ...partial,
  };
}

function mkBuy(symbol: string, amountUSD: number): TradeDecision {
  return {
    action: 'BUY',
    fromToken: 'USDC',
    toToken: symbol,
    amountUSD,
    reasoning: 'test',
  };
}

function mkSell(symbol: string, amountUSD: number, percent?: number): TradeDecision {
  return {
    action: 'SELL',
    fromToken: symbol,
    toToken: 'USDC',
    amountUSD,
    percent,
    reasoning: 'test',
  };
}

describe('simulatePaperBuy', () => {
  it('creates a new position with correct cost basis and token balance', () => {
    const own = mkOwnership();
    const result = simulatePaperBuy(own, mkBuy('VIRTUAL', 100), 2.0, 5, '2026-04-21T00:00:00.000Z');

    expect(result.action).toBe('BUY');
    expect(result.tokensDelta).toBe(50); // 100 / 2.0
    expect(own.positions['VIRTUAL']).toMatchObject({
      symbol: 'VIRTUAL',
      balance: 50,
      costBasisUSD: 100,
      valueUSD: 100,
      openedInCycle: 5,
    });
  });

  it('compounds an existing position using weighted-average cost', () => {
    const own = mkOwnership();
    simulatePaperBuy(own, mkBuy('VIRTUAL', 100), 2.0, 1); // 50 tokens @ $2 → $100
    simulatePaperBuy(own, mkBuy('VIRTUAL', 150), 3.0, 2); // +50 tokens @ $3 → +$150

    const p = own.positions['VIRTUAL'];
    expect(p.balance).toBe(100); // 50 + 50
    expect(p.costBasisUSD).toBe(250); // $100 + $150
    expect(p.valueUSD).toBe(300); // 100 * $3 (current price)
  });

  it('skips when amountUSD ≤ 0 or price ≤ 0', () => {
    const own = mkOwnership();
    expect(simulatePaperBuy(own, mkBuy('X', 0), 1).action).toBe('SKIP');
    expect(simulatePaperBuy(own, mkBuy('X', 100), 0).action).toBe('SKIP');
    expect(Object.keys(own.positions)).toHaveLength(0);
  });
});

describe('simulatePaperSell', () => {
  it('fully exits a position and records realized P&L correctly', () => {
    const own = mkOwnership();
    simulatePaperBuy(own, mkBuy('VIRTUAL', 100), 1.0, 1); // 100 tokens @ $1
    const result = simulatePaperSell(own, mkSell('VIRTUAL', 150), 1.5, 2); // full close at $1.5

    expect(result.action).toBe('SELL');
    expect(result.amountUSD).toBe(150);
    expect(result.realizedPnLUSD).toBe(50); // 150 - 100 cost
    expect(own.positions['VIRTUAL']).toBeUndefined(); // position removed
    expect(own.realizedPnLUSD).toBe(50);
    expect(own.wins).toBe(1);
    expect(own.trades).toBe(1);
  });

  it('partial-exits via percent and preserves proportional cost basis', () => {
    const own = mkOwnership();
    simulatePaperBuy(own, mkBuy('VIRTUAL', 100), 1.0, 1); // 100 tokens @ $1
    // Sell 50% at $1.2 → 50 tokens × $1.2 = $60 proceeds, cost basis sold = $50, realized = $10
    const sellDecision = { ...mkSell('VIRTUAL', 0), percent: 50 };
    const result = simulatePaperSell(own, sellDecision, 1.2, 2);

    expect(result.realizedPnLUSD).toBeCloseTo(10, 4);
    expect(own.positions['VIRTUAL'].balance).toBeCloseTo(50, 4);
    expect(own.positions['VIRTUAL'].costBasisUSD).toBeCloseTo(50, 4);
    expect(own.wins).toBe(1);
  });

  it('records a loss correctly (no win counter increment)', () => {
    const own = mkOwnership();
    simulatePaperBuy(own, mkBuy('VIRTUAL', 100), 1.0, 1);
    const result = simulatePaperSell(own, mkSell('VIRTUAL', 80), 0.8, 2); // close at $0.8

    expect(result.realizedPnLUSD).toBe(-20);
    expect(own.realizedPnLUSD).toBe(-20);
    expect(own.wins).toBe(0);
    expect(own.trades).toBe(1);
  });

  it('skips when no position exists', () => {
    const own = mkOwnership();
    const result = simulatePaperSell(own, mkSell('NOPE', 100), 1.0, 1);
    expect(result.action).toBe('SKIP');
    expect(own.trades).toBe(0);
  });
});

describe('markToMarketSleeve', () => {
  it('updates valueUSD on all positions from the price map', () => {
    const own = mkOwnership();
    simulatePaperBuy(own, mkBuy('A', 100), 1.0, 1);
    simulatePaperBuy(own, mkBuy('B', 100), 2.0, 1);

    markToMarketSleeve(own, { A: 1.5, B: 1.0 });

    expect(own.positions['A'].valueUSD).toBe(150); // 100 tokens × $1.5
    expect(own.positions['B'].valueUSD).toBe(50);  // 50 tokens × $1.0
  });

  it('ignores symbols without a price', () => {
    const own = mkOwnership();
    simulatePaperBuy(own, mkBuy('A', 100), 1.0, 1);
    const initialValue = own.positions['A'].valueUSD;

    markToMarketSleeve(own, {}); // no prices

    expect(own.positions['A'].valueUSD).toBe(initialValue);
  });

  it('is a no-op on undefined ownership', () => {
    expect(() => markToMarketSleeve(undefined, { A: 1 })).not.toThrow();
  });
});

describe('availablePaperUSDC', () => {
  it('returns full budget when no positions', () => {
    expect(availablePaperUSDC(undefined, 1000)).toBe(1000);
    expect(availablePaperUSDC(mkOwnership(), 1000)).toBe(1000);
  });

  it('subtracts deployed cost basis from budget', () => {
    const own = mkOwnership();
    simulatePaperBuy(own, mkBuy('X', 300), 1.0, 1);
    expect(availablePaperUSDC(own, 1000)).toBe(700);
  });

  it('floors at 0 when over-deployed', () => {
    const own = mkOwnership();
    simulatePaperBuy(own, mkBuy('X', 2000), 1.0, 1);
    expect(availablePaperUSDC(own, 1000)).toBe(0);
  });
});

describe('simulatePaperDecision dispatch', () => {
  it('dispatches BUY to simulatePaperBuy using toToken price', () => {
    const own = mkOwnership();
    const result = simulatePaperDecision('alpha-hunter', own, mkBuy('VIRTUAL', 100), { VIRTUAL: 2 }, 1);
    expect(result?.action).toBe('BUY');
    expect(result?.sleeveId).toBe('alpha-hunter');
    expect(own.positions['VIRTUAL'].balance).toBe(50);
  });

  it('dispatches SELL to simulatePaperSell using fromToken price', () => {
    const own = mkOwnership();
    simulatePaperBuy(own, mkBuy('VIRTUAL', 100), 1.0, 1);
    const result = simulatePaperDecision(
      'alpha-hunter',
      own,
      mkSell('VIRTUAL', 150),
      { VIRTUAL: 1.5 },
      2,
    );
    expect(result?.action).toBe('SELL');
    expect(result?.realizedPnLUSD).toBe(50);
  });

  it('returns null for non-BUY/SELL actions', () => {
    const own = mkOwnership();
    const hold: TradeDecision = {
      action: 'HOLD',
      fromToken: 'USDC',
      toToken: 'USDC',
      amountUSD: 0,
      reasoning: 'hold',
    };
    expect(simulatePaperDecision('alpha-hunter', own, hold, {}, 1)).toBeNull();
  });
});
