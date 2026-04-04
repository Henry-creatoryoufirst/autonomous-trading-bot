import { describe, it, expect } from 'vitest';
import { compareStrategies, getPresetVariants } from '../backtester/strategy-tester.js';
import { runParameterSweep, PRESET_SWEEPS } from '../backtester/parameter-sweep.js';
import { generateSyntheticData } from '../data/historical-data.js';
import { classifyWindow, classifyMarketPeriods, getConditionDistribution } from '../data/market-conditions.js';
import { fromPriceHistory } from '../data/historical-data.js';
import { createEnhancedPaper, processTick, updateLiveComparison, getPaperSummary } from '../paper-trading/enhanced-paper.js';
import { DEFAULT_STRATEGY_PARAMS } from '../types.js';
import type { OHLCVCandle, StrategyVariant } from '../types.js';

// ===========================================================================
// Strategy Comparison Tests
// ===========================================================================

describe('Strategy Tester', () => {
  describe('compareStrategies', () => {
    it('compares multiple strategy variants', () => {
      const ds = generateSyntheticData({
        symbol: 'ETH', startPrice: 2000, candles: 300,
        drift: 0.3, volatility: 0.3, seed: 42,
      });

      const variants: StrategyVariant[] = [
        { name: 'Default', params: DEFAULT_STRATEGY_PARAMS },
        { name: 'Aggressive', params: { ...DEFAULT_STRATEGY_PARAMS, confluenceBuyThreshold: 5, kellyFraction: 0.8 } },
      ];

      const result = compareStrategies([ds], variants);

      expect(result.variants).toHaveLength(2);
      expect(result.ranking).toHaveLength(2);
      expect(result.ranking[0].rank).toBe(1);
      expect(result.ranking[1].rank).toBe(2);
      // First should have higher or equal return
      expect(result.ranking[0].totalReturnPct).toBeGreaterThanOrEqual(result.ranking[1].totalReturnPct);
    });

    it('includes dataset info', () => {
      const ds = generateSyntheticData({
        symbol: 'ETH', startPrice: 2000, candles: 200, seed: 42,
      });

      const variants: StrategyVariant[] = [
        { name: 'Test', params: DEFAULT_STRATEGY_PARAMS },
      ];

      const result = compareStrategies([ds], variants);
      expect(result.datasetInfo.symbols).toEqual(['ETH']);
      expect(result.datasetInfo.totalCandles).toBe(200);
    });

    it('handles empty variants list', () => {
      const ds = generateSyntheticData({
        symbol: 'ETH', startPrice: 2000, candles: 200, seed: 42,
      });

      const result = compareStrategies([ds], []);
      expect(result.variants).toHaveLength(0);
      expect(result.ranking).toHaveLength(0);
    });
  });

  describe('getPresetVariants', () => {
    it('generates five preset variants', () => {
      const presets = getPresetVariants(DEFAULT_STRATEGY_PARAMS);
      expect(presets).toHaveLength(5);
      expect(presets.map(v => v.name)).toContain('Baseline');
      expect(presets.map(v => v.name)).toContain('Conservative');
      expect(presets.map(v => v.name)).toContain('Aggressive');
    });

    it('preset variants have different parameters', () => {
      const presets = getPresetVariants(DEFAULT_STRATEGY_PARAMS);
      const buyThresholds = presets.map(v => v.params.confluenceBuyThreshold);
      const uniqueThresholds = new Set(buyThresholds);
      expect(uniqueThresholds.size).toBeGreaterThan(1);
    });
  });
});

// ===========================================================================
// Parameter Sweep Tests
// ===========================================================================

describe('Parameter Sweep', () => {
  it('tests all parameter combinations', () => {
    const ds = generateSyntheticData({
      symbol: 'ETH', startPrice: 2000, candles: 200,
      drift: 0.3, volatility: 0.3, seed: 42,
    });

    const sweep = runParameterSweep(
      [ds],
      DEFAULT_STRATEGY_PARAMS,
      [
        { param: 'confluenceBuyThreshold', min: 10, max: 20, step: 10 },
        { param: 'stopLossPercent', min: 10, max: 20, step: 10 },
      ]
    );

    // 2 values for confluenceBuy * 2 values for stopLoss = 4 combinations
    expect(sweep.totalCombinations).toBe(4);
    expect(sweep.results).toHaveLength(4);
  });

  it('identifies best by return, Sharpe, and win rate', () => {
    const ds = generateSyntheticData({
      symbol: 'ETH', startPrice: 2000, candles: 300,
      drift: 0.5, volatility: 0.3, seed: 42,
    });

    const sweep = runParameterSweep(
      [ds],
      DEFAULT_STRATEGY_PARAMS,
      PRESET_SWEEPS.confluence
    );

    expect(sweep.bestByReturn).toBeDefined();
    expect(sweep.bestByReturn.params).toBeDefined();
    expect(sweep.bestByReturn.metrics).toBeDefined();
    expect(sweep.bestBySharpe).toBeDefined();
    expect(sweep.bestByWinRate).toBeDefined();
    expect(sweep.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('handles single parameter sweep', () => {
    const ds = generateSyntheticData({
      symbol: 'ETH', startPrice: 2000, candles: 200, seed: 42,
    });

    const sweep = runParameterSweep(
      [ds],
      DEFAULT_STRATEGY_PARAMS,
      [{ param: 'kellyFraction', min: 0.3, max: 0.7, step: 0.2 }]
    );

    // 0.3, 0.5, 0.7 = 3 combinations
    expect(sweep.totalCombinations).toBe(3);
  });

  it('handles empty ranges', () => {
    const ds = generateSyntheticData({
      symbol: 'ETH', startPrice: 2000, candles: 200, seed: 42,
    });

    const sweep = runParameterSweep([ds], DEFAULT_STRATEGY_PARAMS, []);
    expect(sweep.totalCombinations).toBe(1); // just the base params
  });
});

// ===========================================================================
// Market Conditions Tests
// ===========================================================================

describe('Market Conditions', () => {
  describe('classifyWindow', () => {
    it('classifies bull market correctly', () => {
      const candles: OHLCVCandle[] = Array.from({ length: 50 }, (_, i) => ({
        timestamp: Date.now() - (50 - i) * 3600000,
        open: 100 + i * 2,
        high: 102 + i * 2,
        low: 99 + i * 2,
        close: 101 + i * 2,
        volume: 1000000,
      }));

      const condition = classifyWindow(candles);
      expect(condition).toBe('BULL');
    });

    it('classifies bear market correctly', () => {
      const candles: OHLCVCandle[] = Array.from({ length: 50 }, (_, i) => ({
        timestamp: Date.now() - (50 - i) * 3600000,
        open: 200 - i * 2,
        high: 201 - i * 2,
        low: 198 - i * 2,
        close: 199 - i * 2,
        volume: 1000000,
      }));

      const condition = classifyWindow(candles);
      expect(condition).toBe('BEAR');
    });

    it('classifies ranging market correctly', () => {
      const candles: OHLCVCandle[] = Array.from({ length: 50 }, (_, i) => ({
        timestamp: Date.now() - (50 - i) * 3600000,
        open: 100 + (i % 2 === 0 ? 0.1 : -0.1),
        high: 100.2,
        low: 99.8,
        close: 100 + (i % 2 === 0 ? 0.05 : -0.05),
        volume: 1000000,
      }));

      const condition = classifyWindow(candles);
      expect(condition).toBe('RANGING');
    });

    it('handles single candle', () => {
      const candles: OHLCVCandle[] = [{
        timestamp: Date.now(), open: 100, high: 100, low: 100, close: 100, volume: 0,
      }];
      const condition = classifyWindow(candles);
      expect(condition).toBe('RANGING');
    });
  });

  describe('classifyMarketPeriods', () => {
    it('returns periods for sufficient data', () => {
      const candles: OHLCVCandle[] = Array.from({ length: 500 }, (_, i) => ({
        timestamp: Date.now() - (500 - i) * 3600000,
        open: 100 + i * 0.5,
        high: 102 + i * 0.5,
        low: 99 + i * 0.5,
        close: 101 + i * 0.5,
        volume: 1000000,
      }));

      const periods = classifyMarketPeriods(candles, 100);
      expect(periods.length).toBeGreaterThan(0);
      for (const p of periods) {
        expect(['BULL', 'BEAR', 'RANGING', 'VOLATILE']).toContain(p.condition);
      }
    });

    it('returns empty for insufficient data', () => {
      const candles: OHLCVCandle[] = Array.from({ length: 5 }, (_, i) => ({
        timestamp: Date.now() - (5 - i) * 3600000,
        open: 100, high: 100, low: 100, close: 100, volume: 0,
      }));

      const periods = classifyMarketPeriods(candles, 168);
      expect(periods).toHaveLength(0);
    });
  });

  describe('getConditionDistribution', () => {
    it('sums to 100%', () => {
      const candles: OHLCVCandle[] = Array.from({ length: 400 }, (_, i) => ({
        timestamp: Date.now() - (400 - i) * 3600000,
        open: 100 + Math.sin(i * 0.1) * 10,
        high: 105 + Math.sin(i * 0.1) * 10,
        low: 95 + Math.sin(i * 0.1) * 10,
        close: 100 + Math.sin(i * 0.1) * 10,
        volume: 1000000,
      }));

      const periods = classifyMarketPeriods(candles, 100);
      const dist = getConditionDistribution(periods);

      const totalPct = dist.BULL.pct + dist.BEAR.pct + dist.RANGING.pct + dist.VOLATILE.pct;
      expect(totalPct).toBeCloseTo(100, 0);
    });
  });
});

// ===========================================================================
// Historical Data Converter Tests
// ===========================================================================

describe('Historical Data', () => {
  describe('fromPriceHistory', () => {
    it('converts existing format to HistoricalDataset', () => {
      const data = {
        timestamps: [1000, 2000, 3000, 4000, 5000],
        prices: [100, 101, 99, 102, 103],
      };

      const ds = fromPriceHistory('ETH', data);
      expect(ds.symbol).toBe('ETH');
      expect(ds.candles).toHaveLength(5);
      expect(ds.candles[0].close).toBe(100);
      expect(ds.candles[4].close).toBe(103);
      expect(ds.startTime).toBe(1000);
      expect(ds.endTime).toBe(5000);
    });

    it('handles empty data', () => {
      const ds = fromPriceHistory('ETH', { timestamps: [], prices: [] });
      expect(ds.candles).toHaveLength(0);
      expect(ds.startTime).toBe(0);
    });
  });

  describe('generateSyntheticData', () => {
    it('generates correct number of candles', () => {
      const ds = generateSyntheticData({
        startPrice: 100, candles: 200, seed: 42,
      });
      expect(ds.candles).toHaveLength(200);
    });

    it('is deterministic with same seed', () => {
      const ds1 = generateSyntheticData({ startPrice: 100, candles: 100, seed: 42 });
      const ds2 = generateSyntheticData({ startPrice: 100, candles: 100, seed: 42 });

      expect(ds1.candles[50].close).toBe(ds2.candles[50].close);
    });

    it('differs with different seeds', () => {
      const ds1 = generateSyntheticData({ startPrice: 100, candles: 100, seed: 42 });
      const ds2 = generateSyntheticData({ startPrice: 100, candles: 100, seed: 99 });

      expect(ds1.candles[50].close).not.toBe(ds2.candles[50].close);
    });

    it('bull drift produces upward trend', () => {
      const ds = generateSyntheticData({
        startPrice: 100, candles: 500, drift: 2.0, volatility: 0.1, seed: 42,
      });
      const first = ds.candles[0].close;
      const last = ds.candles[ds.candles.length - 1].close;
      expect(last).toBeGreaterThan(first);
    });

    it('bear drift produces downward trend', () => {
      const ds = generateSyntheticData({
        startPrice: 100, candles: 500, drift: -2.0, volatility: 0.1, seed: 42,
      });
      const first = ds.candles[0].close;
      const last = ds.candles[ds.candles.length - 1].close;
      expect(last).toBeLessThan(first);
    });

    it('all prices are positive', () => {
      const ds = generateSyntheticData({
        startPrice: 1, candles: 1000, drift: -3.0, volatility: 2.0, seed: 42,
      });
      for (const c of ds.candles) {
        expect(c.close).toBeGreaterThan(0);
        expect(c.open).toBeGreaterThan(0);
        expect(c.high).toBeGreaterThan(0);
        expect(c.low).toBeGreaterThan(0);
      }
    });
  });
});

// ===========================================================================
// Enhanced Paper Trading Tests
// ===========================================================================

describe('Enhanced Paper Trading', () => {
  it('creates a paper portfolio with correct initial state', () => {
    const paper = createEnhancedPaper('test-1', 'Default', 500);
    expect(paper.id).toBe('test-1');
    expect(paper.cash).toBe(500);
    expect(paper.capital).toBe(500);
    expect(Object.keys(paper.positions)).toHaveLength(0);
    expect(paper.trades).toHaveLength(0);
  });

  it('processes buy signals', () => {
    const paper = createEnhancedPaper('test-1', 'Default', 1000);

    // Build a price history that should trigger a buy signal
    // RSI < 30 = +25, MACD bullish = +25, BB oversold = +20 => score >= 15
    const prices: number[] = [];
    // Declining then reversing pattern
    for (let i = 0; i < 60; i++) {
      if (i < 40) prices.push(100 - i * 0.8);
      else prices.push(68 + (i - 40) * 0.3);
    }

    const { trade } = processTick(paper, DEFAULT_STRATEGY_PARAMS, 'ETH', prices[prices.length - 1], prices);
    // The trade depends on the confluence score of this specific series.
    // We just verify the function executes correctly.
    expect(paper.equityCurve.length).toBeGreaterThan(1);
  });

  it('tracks live comparison', () => {
    const paper = createEnhancedPaper('test-1', 'Default', 500);
    updateLiveComparison(paper, 5.0, {});

    expect(paper.liveComparison).toBeDefined();
    expect(paper.liveComparison!.liveReturnPct).toBe(5.0);
    expect(paper.liveComparison!.divergenceHistory.length).toBe(1);
  });

  it('generates paper summary', () => {
    const paper = createEnhancedPaper('test-1', 'Default', 500);
    const summary = getPaperSummary(paper, {});

    expect(summary.id).toBe('test-1');
    expect(summary.portfolioValue).toBe(500);
    expect(summary.returnPct).toBe(0);
    expect(summary.tradeCount).toBe(0);
  });

  it('does not trade with insufficient price history', () => {
    const paper = createEnhancedPaper('test-1', 'Default', 500);
    const shortPrices = [100, 101, 102];

    const { trade } = processTick(paper, DEFAULT_STRATEGY_PARAMS, 'ETH', 102, shortPrices);
    expect(trade).toBeNull();
    expect(paper.trades).toHaveLength(0);
  });
});
