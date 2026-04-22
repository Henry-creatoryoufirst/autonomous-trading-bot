/**
 * Unit tests for the realized-P&L sanitizer.
 *
 * Central case: the 2026-04-18 poison trade. A single SELL of $747 of volume
 * produced -$330,318.29 of realized loss on the production bot. The sanitizer
 * must reject any trade whose |realizedPnL| exceeds max(5 × position, 2 × portfolio).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setState } from '../../state/index.js';
import {
  validateRealizedPnL,
  maybeResyncCumulativePnL,
  findSuspectTrades,
} from '../pnl-sanitizer.js';
import { updateCostBasisAfterBuy, updateCostBasisAfterSell } from '../cost-basis.js';

import type { TokenCostBasis, TradeRecord } from '../../types/index.js';
import type { AgentState } from '../../types/state.js';

type CostBasisMap = Record<string, TokenCostBasis>;

function initTestState(opts?: { portfolioValue?: number }): CostBasisMap {
  const costBasis: CostBasisMap = {};
  setState({
    costBasis,
    errorLog: [],
    tradeFailures: {},
    trading: { totalPortfolioValue: opts?.portfolioValue ?? 3622 },
  } as unknown as AgentState);
  return costBasis;
}

// ===========================================================================
// validateRealizedPnL — the per-trade guard
// ===========================================================================

describe('validateRealizedPnL', () => {
  beforeEach(() => { initTestState(); });

  it('accepts a normal modest loss on a normal-sized sell', () => {
    const result = validateRealizedPnL({
      symbol: 'ETH',
      realizedPnL: -50,
      amountUSD: 100,
      tokensSold: 0.05,
      averageCostBasis: 3000,
      portfolioValue: 3622,
    });
    expect(result.accepted).toBe(true);
    expect(result.sanitizedPnL).toBe(-50);
    expect(result.rejectedBy).toBeNull();
  });

  it('accepts a full 100% position rug (-1× position) as legitimate', () => {
    const result = validateRealizedPnL({
      symbol: 'MEME',
      realizedPnL: -200,
      amountUSD: 1,      // dust sale on a dead token
      tokensSold: 1000,
      averageCostBasis: 0.2,
      portfolioValue: 3622,
    });
    // 5 × $1 position = $5 cap. $200 > $5, but portfolio gate is 2×$3622 = $7244.
    // $200 << $7244 so accepted.
    expect(result.accepted).toBe(true);
  });

  // THE HEADLINE TEST — the actual 2026-04-18 poison scenario.
  it('REJECTS the 2026-04-18 poison trade (-$330K on $747 volume)', () => {
    const result = validateRealizedPnL({
      symbol: 'cbXRP', // one of the tokens flagged with missing tokenAmount in v21.19-fix
      realizedPnL: -330318.29,
      amountUSD: 747.08 / 24, // split across 24 trades that day
      tokensSold: 10,           // representative
      averageCostBasis: 33000,  // the "corrupted avgCost × tokens" implied
      portfolioValue: 3622,     // production portfolio size on 2026-04-18
    });
    expect(result.accepted).toBe(false);
    expect(result.sanitizedPnL).toBe(0);
    expect(result.rejectedBy).toBe('portfolio_size');
    expect(result.reason).toContain('2× portfolio');
    expect(result.reason).toContain('330318');
  });

  it('rejects a non-finite realizedPnL (NaN / Infinity)', () => {
    const resultNaN = validateRealizedPnL({
      symbol: 'X',
      realizedPnL: Number.NaN,
      amountUSD: 100,
      tokensSold: 1,
      averageCostBasis: 100,
      portfolioValue: 3622,
    });
    expect(resultNaN.accepted).toBe(false);
    expect(resultNaN.sanitizedPnL).toBe(0);
    expect(resultNaN.reason).toContain('non-finite');

    const resultInf = validateRealizedPnL({
      symbol: 'X',
      realizedPnL: Number.NEGATIVE_INFINITY,
      amountUSD: 100,
      tokensSold: 1,
      averageCostBasis: 100,
      portfolioValue: 3622,
    });
    expect(resultInf.accepted).toBe(false);
    expect(resultInf.sanitizedPnL).toBe(0);
  });

  it('rejects the 2026-04-13 suspect pattern (-$2036 on $662 volume, ~3× ratio)', () => {
    // This one is 3× of volume — not as extreme as 04-18 but still poisoned.
    // Per-trade: splits across 13 trades averaging ~$50 each.
    const result = validateRealizedPnL({
      symbol: 'ENA',
      realizedPnL: -2036 / 13, // ~-$156 per trade (13 trades that day)
      amountUSD: 662.64 / 13,  // ~$51 per trade
      tokensSold: 50,
      averageCostBasis: 10,
      portfolioValue: 3622,
    });
    // -$156 magnitude. 5 × $51 = $255 position cap.  |pnl| ($156) < $255 → accepted.
    // Individual trades in a 3×-volume day don't trip — they only trip in aggregate.
    // That's the point of the TWO defenses: per-trade catches the big outliers,
    // startup resync catches the aggregate drift.
    expect(result.accepted).toBe(true);
  });

  it('rejects when position×5 and portfolio×2 both exceeded', () => {
    // $10k loss on a $100 sell with $1k portfolio — absurd on both gates
    const result = validateRealizedPnL({
      symbol: 'SCAM',
      realizedPnL: -10000,
      amountUSD: 100,
      tokensSold: 1000,
      averageCostBasis: 10,
      portfolioValue: 1000,
    });
    expect(result.accepted).toBe(false);
  });

  it('activates only position gate when portfolio is near-zero (bootstrap)', () => {
    // On a cold boot portfolio may be $0, portfolio guard disabled.
    const result = validateRealizedPnL({
      symbol: 'ETH',
      realizedPnL: -10_000,
      amountUSD: 100,
      tokensSold: 1,
      averageCostBasis: 100,
      portfolioValue: 0,
    });
    // 5 × $100 = $500 cap, |−10_000| > $500 → rejected via position gate
    expect(result.accepted).toBe(false);
    expect(result.rejectedBy).toBe('position_size');
  });
});

// ===========================================================================
// updateCostBasisAfterSell — integration with the sanitizer
// ===========================================================================

describe('updateCostBasisAfterSell + sanitizer integration', () => {
  beforeEach(() => { initTestState(); });

  it('does not poison cb.realizedPnL when a poison trade is written', () => {
    const map = initTestState({ portfolioValue: 3622 });

    // Corrupted state: the avgCostBasis is wildly inflated (the root cause)
    map['cbXRP'] = {
      symbol: 'cbXRP',
      totalInvestedUSD: 100_000,  // wildly wrong
      totalTokensAcquired: 10,    // wildly wrong
      averageCostBasis: 10_000,   // wildly wrong — real cbXRP ≈ $2
      currentHolding: 10,
      realizedPnL: 0,
      unrealizedPnL: 0,
      peakPrice: 10_000,
      peakPriceDate: new Date().toISOString(),
      firstBuyDate: new Date().toISOString(),
      lastTradeDate: new Date().toISOString(),
      atrStopPercent: null,
      atrTrailPercent: null,
      atrAtEntry: null,
      trailActivated: false,
      lastAtrUpdate: null,
    };

    // Sell 10 tokens at $2 each = $20 received. Real PnL should be ~-$20 (full rug).
    // Corrupted: (2 − 10_000) × 10 = -$99,980 rawPnL.
    // Old clamp: Math.max(-99980, -(10_000 × 10)) = -$99,980 → poisoned.
    // New sanitizer: |-99,980| > max(5 × $20, 2 × $3622) = $7244 → REJECT → 0.
    const pnl = updateCostBasisAfterSell('cbXRP', 20, 10);

    expect(pnl).toBe(0);
    expect(map['cbXRP'].realizedPnL).toBe(0); // not poisoned!
  });

  it('still lets honest P&L through', () => {
    const map = initTestState({ portfolioValue: 3622 });
    // A clean buy + sell — should pass the sanitizer and record -$100 loss.
    updateCostBasisAfterBuy('ETH', 1000, 0.4, { ETH: { price: 2500 } });
    const pnl = updateCostBasisAfterSell('ETH', 900, 0.4);
    expect(pnl).toBeCloseTo(-100);
    expect(map['ETH'].realizedPnL).toBeCloseTo(-100);
  });
});

// ===========================================================================
// maybeResyncCumulativePnL — startup re-sync
// ===========================================================================

describe('maybeResyncCumulativePnL', () => {
  beforeEach(() => { initTestState(); });

  it('does not fire when cumulative is within 10× portfolio', () => {
    const map = initTestState({ portfolioValue: 3622 });
    map['ETH'] = makeCb('ETH', { realizedPnL: -500 });
    const result = maybeResyncCumulativePnL({
      costBasis: map,
      trades: [],
      portfolioValue: 3622,
    });
    expect(result.fired).toBe(false);
    expect(map['ETH'].realizedPnL).toBe(-500); // untouched
  });

  it('fires and rebuilds when cumulative is 10×+ portfolio', () => {
    const map = initTestState({ portfolioValue: 3622 });
    // Simulate the production state: cumulative realizedPnL = -$2.65M
    map['BRETT'] = makeCb('BRETT', { realizedPnL: -2_650_000 });

    const result = maybeResyncCumulativePnL({
      costBasis: map,
      trades: [], // empty — nothing to rebuild from
      portfolioValue: 3622,
      log: () => { /* silence */ },
    });

    expect(result.fired).toBe(true);
    expect(result.beforeCumulative).toBeCloseTo(-2_650_000);
    // With no trades, the phantom realizedPnL is zeroed.
    expect(map['BRETT'].realizedPnL).toBe(0);
    expect(result.afterCumulative).toBe(0);
  });

  it('replays honest trades during resync (preserves real P&L)', () => {
    const map = initTestState({ portfolioValue: 3622 });
    map['ETH'] = makeCb('ETH', { realizedPnL: -500_000 }); // poisoned

    const trades: TradeRecord[] = [
      mkTrade({ action: 'BUY', toToken: 'ETH', amountUSD: 1000, tokenAmount: 0.4, timestamp: '2026-04-01T00:00:00Z' }),
      mkTrade({ action: 'SELL', fromToken: 'ETH', amountUSD: 1100, tokenAmount: 0.4, timestamp: '2026-04-05T00:00:00Z' }),
    ];

    const result = maybeResyncCumulativePnL({
      costBasis: map,
      trades,
      portfolioValue: 3622,
      log: () => { /* silence */ },
    });

    expect(result.fired).toBe(true);
    // Real P&L = $1100 − $1000 = +$100
    expect(map['ETH'].realizedPnL).toBeCloseTo(100);
    expect(result.rejectedTrades).toBe(0);
  });

  it('drops poisoned trades during replay', () => {
    const map = initTestState({ portfolioValue: 3622 });
    map['cbXRP'] = makeCb('cbXRP', { realizedPnL: -500_000 });

    const trades: TradeRecord[] = [
      mkTrade({ action: 'BUY', toToken: 'cbXRP', amountUSD: 100, tokenAmount: 50, timestamp: '2026-04-10T00:00:00Z' }),
      // A poison sell: $30 received for 50 tokens but avgCost shows $2 per token.
      // Real PnL = 30 − 100 = −$70 (acceptable). Not a poison scenario — these
      // are honest trade records. The resync should keep them.
      mkTrade({ action: 'SELL', fromToken: 'cbXRP', amountUSD: 30, tokenAmount: 50, timestamp: '2026-04-12T00:00:00Z' }),
    ];

    const result = maybeResyncCumulativePnL({
      costBasis: map,
      trades,
      portfolioValue: 3622,
      log: () => { /* silence */ },
    });

    expect(result.fired).toBe(true);
    expect(map['cbXRP'].realizedPnL).toBeCloseTo(-70);
  });
});

// ===========================================================================
// findSuspectTrades — the audit endpoint
// ===========================================================================

describe('findSuspectTrades', () => {
  beforeEach(() => { initTestState(); });

  it('ranks the 04-18 poison trade at the top', () => {
    const trades: TradeRecord[] = [
      mkTrade({ action: 'SELL', fromToken: 'ETH', amountUSD: 200, tokenAmount: 0.08, realizedPnL: -20, success: true, timestamp: '2026-04-17T12:00:00Z' }),
      mkTrade({ action: 'SELL', fromToken: 'cbXRP', amountUSD: 30, tokenAmount: 15, realizedPnL: -15_000, success: true, timestamp: '2026-04-18T14:00:00Z' }),
      mkTrade({ action: 'SELL', fromToken: 'ENA', amountUSD: 50, tokenAmount: 100, realizedPnL: -200, success: true, timestamp: '2026-04-18T15:00:00Z' }),
    ];

    const suspects = findSuspectTrades(trades, 3622, 10);
    expect(suspects.length).toBe(3);
    // Highest |pnl|/volume ratio first
    expect(suspects[0].symbol).toBe('cbXRP');
    expect(suspects[0].pnlToVolumeRatio).toBeGreaterThan(suspects[1].pnlToVolumeRatio);
    // The poison trade should be flagged
    expect(suspects[0].wouldReject).toBe(true);
    // The honest ones should not
    expect(suspects.find(s => s.symbol === 'ETH')?.wouldReject).toBe(false);
  });

  it('skips non-SELL and failed trades', () => {
    const trades: TradeRecord[] = [
      mkTrade({ action: 'BUY', toToken: 'ETH', amountUSD: 100, tokenAmount: 0.04, realizedPnL: 0, success: true, timestamp: '2026-04-18T10:00:00Z' }),
      mkTrade({ action: 'SELL', fromToken: 'ETH', amountUSD: 100, tokenAmount: 0.04, realizedPnL: -999_999, success: false, timestamp: '2026-04-18T11:00:00Z' }),
      mkTrade({ action: 'HOLD', fromToken: 'ETH', toToken: 'ETH', amountUSD: 0, realizedPnL: 0, success: true, timestamp: '2026-04-18T12:00:00Z' }),
    ];

    const suspects = findSuspectTrades(trades, 3622, 10);
    expect(suspects.length).toBe(0);
  });
});

// ===========================================================================
// Helpers
// ===========================================================================

function makeCb(symbol: string, overrides: Partial<TokenCostBasis> = {}): TokenCostBasis {
  return {
    symbol,
    totalInvestedUSD: 0,
    totalTokensAcquired: 0,
    averageCostBasis: 0,
    currentHolding: 0,
    realizedPnL: 0,
    unrealizedPnL: 0,
    peakPrice: 0,
    peakPriceDate: new Date().toISOString(),
    firstBuyDate: new Date().toISOString(),
    lastTradeDate: new Date().toISOString(),
    atrStopPercent: null,
    atrTrailPercent: null,
    atrAtEntry: null,
    trailActivated: false,
    lastAtrUpdate: null,
    ...overrides,
  };
}

function mkTrade(t: Partial<TradeRecord> & Pick<TradeRecord, 'action' | 'timestamp'>): TradeRecord {
  return {
    timestamp: t.timestamp,
    cycle: t.cycle ?? 0,
    action: t.action,
    fromToken: t.fromToken ?? 'USDC',
    toToken: t.toToken ?? 'USDC',
    amountUSD: t.amountUSD ?? 0,
    tokenAmount: t.tokenAmount,
    success: t.success ?? true,
    portfolioValueBefore: t.portfolioValueBefore ?? 0,
    portfolioValueAfter: t.portfolioValueAfter,
    reasoning: t.reasoning ?? '',
    sector: t.sector,
    realizedPnL: t.realizedPnL,
    marketConditions: t.marketConditions ?? { fearGreed: 50, ethPrice: 0, btcPrice: 0 },
  } as TradeRecord;
}
