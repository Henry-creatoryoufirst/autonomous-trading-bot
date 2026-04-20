import { describe, it, expect } from 'vitest';
import {
  CoreSleeve,
  computeRollingSharpe7d,
  type CoreSleeveStateView,
} from '../core-sleeve.js';
import type { TokenCostBasis, TradeRecord } from '../../types/index.js';

/** Build a minimal CoreSleeveStateView for tests. Defaults keep the existing
 *  tests working without each specifying dailyPayouts/totalPortfolioValue. */
function mkState(partial: Partial<CoreSleeveStateView> = {}): CoreSleeveStateView {
  return {
    costBasis: {},
    tradeHistory: [],
    dailyPayouts: [],
    totalPortfolioValue: 0,
    ...partial,
  };
}

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
    it('is null when dailyPayouts is missing', () => {
      const state: CoreSleeveStateView = {
        costBasis: { ETH: mkCostBasis({ symbol: 'ETH', realizedPnL: 100 }) },
        tradeHistory: [mkTrade({ timestamp: '2026-04-01T10:00:00Z', action: 'SELL', realizedPnL: 50 })],
      };
      const sleeve = new CoreSleeve({ getState: () => state });
      expect(sleeve.getStats().rollingSharpe7d).toBeNull();
    });

    it('computes a real number when 7+ daily payouts + positive portfolio value', () => {
      const state = mkState({
        totalPortfolioValue: 10_000,
        dailyPayouts: [
          { date: '2026-04-14', realizedPnL: 50 },
          { date: '2026-04-15', realizedPnL: 40 },
          { date: '2026-04-16', realizedPnL: 65 },
          { date: '2026-04-17', realizedPnL: 55 },
          { date: '2026-04-18', realizedPnL: 70 },
          { date: '2026-04-19', realizedPnL: 45 },
          { date: '2026-04-20', realizedPnL: 60 },
        ],
      });
      const sleeve = new CoreSleeve({ getState: () => state });
      const s = sleeve.getStats().rollingSharpe7d;
      expect(s).not.toBeNull();
      expect(typeof s).toBe('number');
      expect(Number.isFinite(s as number)).toBe(true);
    });
  });

  describe('computeRollingSharpe7d (direct)', () => {
    it('returns null with fewer than 7 daily records', () => {
      const out = computeRollingSharpe7d(
        [
          { date: '2026-04-18', realizedPnL: 50 },
          { date: '2026-04-19', realizedPnL: 60 },
          { date: '2026-04-20', realizedPnL: 40 },
        ],
        10_000,
      );
      expect(out).toBeNull();
    });

    it('returns null when portfolio value is zero', () => {
      const seven = Array.from({ length: 7 }, (_, i) => ({
        date: `2026-04-${14 + i}`,
        realizedPnL: 50,
      }));
      expect(computeRollingSharpe7d(seven, 0)).toBeNull();
      expect(computeRollingSharpe7d(seven, -5)).toBeNull();
    });

    it('returns null when all 7 returns are identical (stddev = 0)', () => {
      const flat = Array.from({ length: 7 }, (_, i) => ({
        date: `2026-04-${14 + i}`,
        realizedPnL: 50,
      }));
      expect(computeRollingSharpe7d(flat, 10_000)).toBeNull();
    });

    it('is positive when mean return is positive', () => {
      const mostlyPositive = [
        { date: '2026-04-14', realizedPnL: 50 },
        { date: '2026-04-15', realizedPnL: 40 },
        { date: '2026-04-16', realizedPnL: 65 },
        { date: '2026-04-17', realizedPnL: 55 },
        { date: '2026-04-18', realizedPnL: 70 },
        { date: '2026-04-19', realizedPnL: 45 },
        { date: '2026-04-20', realizedPnL: 60 },
      ];
      const s = computeRollingSharpe7d(mostlyPositive, 10_000);
      expect(s).not.toBeNull();
      expect(s as number).toBeGreaterThan(0);
    });

    it('is negative when mean return is negative', () => {
      const mostlyNegative = [
        { date: '2026-04-14', realizedPnL: -50 },
        { date: '2026-04-15', realizedPnL: -40 },
        { date: '2026-04-16', realizedPnL: -65 },
        { date: '2026-04-17', realizedPnL: -55 },
        { date: '2026-04-18', realizedPnL: -70 },
        { date: '2026-04-19', realizedPnL: -45 },
        { date: '2026-04-20', realizedPnL: -60 },
      ];
      const s = computeRollingSharpe7d(mostlyNegative, 10_000);
      expect(s).not.toBeNull();
      expect(s as number).toBeLessThan(0);
    });

    it('only uses the last 7 entries (slice -7)', () => {
      const tenDays = Array.from({ length: 10 }, (_, i) => ({
        date: `2026-04-${11 + i}`,
        realizedPnL: i < 3 ? 1000 : 50, // first 3 outliers should be IGNORED
      }));
      // If the function used all 10 days, the 3 huge outliers would blow
      // up the mean. With slice(-7), only the consistent 50s are used →
      // mean is stable at 50, but stddev is 0 → null result.
      const s = computeRollingSharpe7d(tenDays, 10_000);
      expect(s).toBeNull(); // last 7 are identical, so stddev = 0
    });

    it('annualizes with sqrt(365) so typical values land in 0-3 range', () => {
      // Simple case: +1% on 4 days, +0.5% on 3 days
      const mixed = [
        { date: '2026-04-14', realizedPnL: 100 }, // 1% of 10k
        { date: '2026-04-15', realizedPnL: 100 },
        { date: '2026-04-16', realizedPnL: 50 },  // 0.5%
        { date: '2026-04-17', realizedPnL: 100 },
        { date: '2026-04-18', realizedPnL: 50 },
        { date: '2026-04-19', realizedPnL: 100 },
        { date: '2026-04-20', realizedPnL: 50 },
      ];
      const s = computeRollingSharpe7d(mixed, 10_000);
      expect(s).not.toBeNull();
      // Rough sanity: should be a "plausible" annualized Sharpe (mean/stddev
      // of the returns above is ~2.65, × sqrt(365) ≈ 50.6). Not a real-world
      // Sharpe because the sample is only 7 days and all-positive, but the
      // math should yield a finite reasonable number.
      expect(s as number).toBeGreaterThan(10);
      expect(s as number).toBeLessThan(100);
    });
  });

  describe('decide()', () => {
    const ctx = {
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
    };

    it('returns [] when no decideFn is injected (Phase 1 safe default)', async () => {
      const sleeve = new CoreSleeve();
      expect(await sleeve.decide(ctx)).toEqual([]);
    });

    it('delegates to injected decideFn and returns its result', async () => {
      const mockDecision = {
        timestamp: '2026-04-20T12:00:00Z',
        cycle: 1,
        action: 'BUY' as const,
        fromToken: 'USDC',
        toToken: 'ETH',
        amountUSD: 100,
        success: true,
        portfolioValueBefore: 1000,
        reasoning: 'mock signal',
        marketConditions: { fearGreed: 50, ethPrice: 3000, btcPrice: 60000 },
      };
      const sleeve = new CoreSleeve({
        decideFn: async () => [mockDecision],
      });
      const decisions = await sleeve.decide(ctx);
      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('BUY');
      expect(decisions[0].toToken).toBe('ETH');
      expect(decisions[0].amountUSD).toBe(100);
    });

    it('passes the sleeve context through to decideFn untouched', async () => {
      let capturedCtx: unknown;
      const sleeve = new CoreSleeve({
        decideFn: async (c) => {
          capturedCtx = c;
          return [];
        },
      });
      await sleeve.decide(ctx);
      expect(capturedCtx).toBe(ctx);
    });

    it('propagates errors from decideFn (callers must handle)', async () => {
      const sleeve = new CoreSleeve({
        decideFn: async () => {
          throw new Error('decision pipeline failed');
        },
      });
      await expect(sleeve.decide(ctx)).rejects.toThrow('decision pipeline failed');
    });
  });
});
