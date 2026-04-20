import { describe, it, expect } from 'vitest';
import { CoreSleeve, type CoreSleeveStateView } from '../core-sleeve.js';
import type { TokenCostBasis, TradeRecord } from '../../types/index.js';

/** Build a minimal TokenCostBasis for tests — only fields the sleeve reads. */
function mkCostBasis(partial: Partial<TokenCostBasis> & { symbol: string }): TokenCostBasis {
  return {
    symbol: partial.symbol,
    totalInvestedUSD: 0,
    totalTokensAcquired: 0,
    averageCostBasis: 0,
    currentHolding: 0,
    realizedPnL: 0,
    unrealizedPnL: 0,
    peakPrice: 0,
    peakPriceDate: '',
    firstBuyDate: '',
    lastTradeDate: '',
    atrStopPercent: null,
    atrTrailPercent: null,
    atrAtEntry: null,
    trailActivated: false,
    lastAtrUpdate: null,
    ...partial,
  };
}

/** Build a minimal TradeRecord for tests — only fields the sleeve reads. */
function mkTrade(partial: Partial<TradeRecord> & { timestamp: string; action: TradeRecord['action'] }): TradeRecord {
  return {
    timestamp: partial.timestamp,
    cycle: 0,
    action: partial.action,
    fromToken: 'USDC',
    toToken: 'ETH',
    amountUSD: 100,
    success: true,
    portfolioValueBefore: 1000,
    reasoning: 'test',
    marketConditions: { fearGreed: 50, ethPrice: 3000, btcPrice: 60000 },
    ...partial,
  };
}

describe('CoreSleeve', () => {
  describe('identity', () => {
    it('has stable id and sensible bounds', () => {
      const sleeve = new CoreSleeve();
      expect(sleeve.id).toBe('core');
      expect(sleeve.displayName).toBe('Core Strategy');
      expect(sleeve.mode).toBe('live');
      expect(sleeve.minCapitalPct).toBe(0.5);
      expect(sleeve.maxCapitalPct).toBe(1.0);
    });

    it('accepts mode + displayName overrides', () => {
      const sleeve = new CoreSleeve({ mode: 'paper', displayName: 'Core (Paper)' });
      expect(sleeve.mode).toBe('paper');
      expect(sleeve.displayName).toBe('Core (Paper)');
    });
  });

  describe('getStats() without state provider', () => {
    it('returns fully zeroed stats', () => {
      const sleeve = new CoreSleeve();
      const stats = sleeve.getStats();
      expect(stats.realizedPnLUSD).toBe(0);
      expect(stats.unrealizedPnLUSD).toBe(0);
      expect(stats.trades).toBe(0);
      expect(stats.winRate).toBe(0);
      expect(stats.rollingSharpe7d).toBeNull();
      expect(stats.lastDecisionAt).toBeNull();
    });
  });

  describe('getStats() with empty state', () => {
    it('returns zeros when costBasis and tradeHistory are empty', () => {
      const state: CoreSleeveStateView = { costBasis: {}, tradeHistory: [] };
      const sleeve = new CoreSleeve({ getState: () => state });
      const stats = sleeve.getStats();
      expect(stats.realizedPnLUSD).toBe(0);
      expect(stats.unrealizedPnLUSD).toBe(0);
      expect(stats.trades).toBe(0);
      expect(stats.winRate).toBe(0);
      expect(stats.lastDecisionAt).toBeNull();
    });
  });

  describe('getStats() P&L aggregation', () => {
    it('sums realized + unrealized P&L across all positions', () => {
      const state: CoreSleeveStateView = {
        costBasis: {
          ETH: mkCostBasis({ symbol: 'ETH', realizedPnL: 100, unrealizedPnL: 50 }),
          WBTC: mkCostBasis({ symbol: 'WBTC', realizedPnL: -20, unrealizedPnL: 30 }),
          DEGEN: mkCostBasis({ symbol: 'DEGEN', realizedPnL: 15, unrealizedPnL: -8 }),
        },
        tradeHistory: [],
      };
      const sleeve = new CoreSleeve({ getState: () => state });
      const stats = sleeve.getStats();
      expect(stats.realizedPnLUSD).toBe(100 - 20 + 15); // 95
      expect(stats.unrealizedPnLUSD).toBe(50 + 30 - 8); // 72
    });

    it('treats missing realizedPnL/unrealizedPnL as zero', () => {
      const state: CoreSleeveStateView = {
        costBasis: {
          ETH: mkCostBasis({ symbol: 'ETH' }), // all zeros
        },
        tradeHistory: [],
      };
      const sleeve = new CoreSleeve({ getState: () => state });
      const stats = sleeve.getStats();
      expect(stats.realizedPnLUSD).toBe(0);
      expect(stats.unrealizedPnLUSD).toBe(0);
    });
  });

  describe('getStats() trade counting', () => {
    it('counts only successful BUY/SELL trades', () => {
      const state: CoreSleeveStateView = {
        costBasis: {},
        tradeHistory: [
          mkTrade({ timestamp: '2026-04-01T10:00:00Z', action: 'BUY', success: true }),
          mkTrade({ timestamp: '2026-04-01T11:00:00Z', action: 'SELL', success: true }),
          mkTrade({ timestamp: '2026-04-01T12:00:00Z', action: 'BUY', success: false }), // excluded
          mkTrade({ timestamp: '2026-04-01T13:00:00Z', action: 'HOLD', success: true }), // excluded
        ],
      };
      const sleeve = new CoreSleeve({ getState: () => state });
      const stats = sleeve.getStats();
      expect(stats.trades).toBe(2);
    });
  });

  describe('getStats() win rate', () => {
    it('computes win rate from scored SELLs only', () => {
      const state: CoreSleeveStateView = {
        costBasis: {},
        tradeHistory: [
          mkTrade({ timestamp: '2026-04-01T10:00:00Z', action: 'SELL', realizedPnL: 50 }),   // win
          mkTrade({ timestamp: '2026-04-01T11:00:00Z', action: 'SELL', realizedPnL: -10 }),  // loss
          mkTrade({ timestamp: '2026-04-01T12:00:00Z', action: 'SELL', realizedPnL: 30 }),   // win
          mkTrade({ timestamp: '2026-04-01T13:00:00Z', action: 'SELL' }),                    // unscored, excluded
          mkTrade({ timestamp: '2026-04-01T14:00:00Z', action: 'BUY', realizedPnL: 5 }),     // not a sell, excluded
        ],
      };
      const sleeve = new CoreSleeve({ getState: () => state });
      const stats = sleeve.getStats();
      // 2 wins out of 3 scored sells = 66.67%
      expect(stats.winRate).toBeCloseTo(66.6667, 2);
    });

    it('returns 0 when no scored sells exist', () => {
      const state: CoreSleeveStateView = {
        costBasis: {},
        tradeHistory: [mkTrade({ timestamp: '2026-04-01T10:00:00Z', action: 'BUY' })],
      };
      const sleeve = new CoreSleeve({ getState: () => state });
      expect(sleeve.getStats().winRate).toBe(0);
    });

    it('treats realizedPnL === 0 as a loss (not a win)', () => {
      const state: CoreSleeveStateView = {
        costBasis: {},
        tradeHistory: [
          mkTrade({ timestamp: '2026-04-01T10:00:00Z', action: 'SELL', realizedPnL: 0 }),
        ],
      };
      const sleeve = new CoreSleeve({ getState: () => state });
      expect(sleeve.getStats().winRate).toBe(0); // 0 wins / 1 scored
    });
  });

  describe('getStats() lastDecisionAt', () => {
    it('returns the timestamp of the most recent actionable trade', () => {
      const state: CoreSleeveStateView = {
        costBasis: {},
        tradeHistory: [
          mkTrade({ timestamp: '2026-04-01T10:00:00Z', action: 'BUY' }),
          mkTrade({ timestamp: '2026-04-02T11:00:00Z', action: 'SELL' }),
          mkTrade({ timestamp: '2026-04-03T12:00:00Z', action: 'HOLD' }), // ignored for lastDecisionAt
        ],
      };
      const sleeve = new CoreSleeve({ getState: () => state });
      expect(sleeve.getStats().lastDecisionAt).toBe('2026-04-02T11:00:00Z');
    });

    it('returns null when there are no actionable trades', () => {
      const state: CoreSleeveStateView = {
        costBasis: {},
        tradeHistory: [mkTrade({ timestamp: '2026-04-01T10:00:00Z', action: 'HOLD' })],
      };
      const sleeve = new CoreSleeve({ getState: () => state });
      expect(sleeve.getStats().lastDecisionAt).toBeNull();
    });
  });

  describe('getStats() rollingSharpe7d', () => {
    it('is null in v1 (phase 2 wiring pending)', () => {
      const state: CoreSleeveStateView = {
        costBasis: { ETH: mkCostBasis({ symbol: 'ETH', realizedPnL: 100 }) },
        tradeHistory: [mkTrade({ timestamp: '2026-04-01T10:00:00Z', action: 'SELL', realizedPnL: 50 })],
      };
      const sleeve = new CoreSleeve({ getState: () => state });
      expect(sleeve.getStats().rollingSharpe7d).toBeNull();
    });
  });

  describe('decide() Phase 1', () => {
    it('returns no decisions (orchestrator still drives trading in Phase 1)', async () => {
      const sleeve = new CoreSleeve();
      const decisions = await sleeve.decide({
        capitalBudgetUSD: 1000,
        positions: [],
        availableUSDC: 1000,
        market: {
          cycleNumber: 1,
          builtAt: '2026-04-20T12:00:00Z',
          prices: {},
          regime: 'TRENDING_UP',
          fearGreed: 50,
        },
      });
      expect(decisions).toEqual([]);
    });
  });
});
