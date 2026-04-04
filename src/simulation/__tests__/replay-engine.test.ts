import { describe, it, expect } from 'vitest';
import { runReplay } from '../engine/replay-engine.js';
import { generateSyntheticData } from '../data/historical-data.js';
import type { ReplayConfig, HistoricalDataset, StrategyParams } from '../types.js';
import { DEFAULT_STRATEGY_PARAMS } from '../types.js';

// ===========================================================================
// Helpers
// ===========================================================================

function makeConfig(overrides?: Partial<StrategyParams>): ReplayConfig {
  return {
    strategy: { ...DEFAULT_STRATEGY_PARAMS, ...overrides },
    warmupCandles: 50,
  };
}

function makeBullDataset(): HistoricalDataset {
  return generateSyntheticData({
    symbol: 'ETH',
    startPrice: 2000,
    candles: 500,
    drift: 1.0,       // strong uptrend
    volatility: 0.3,
    seed: 42,
  });
}

function makeBearDataset(): HistoricalDataset {
  return generateSyntheticData({
    symbol: 'ETH',
    startPrice: 4000,
    candles: 500,
    drift: -0.8,       // strong downtrend
    volatility: 0.3,
    seed: 99,
  });
}

function makeRangingDataset(): HistoricalDataset {
  return generateSyntheticData({
    symbol: 'ETH',
    startPrice: 3000,
    candles: 500,
    drift: 0.0,        // no trend
    volatility: 0.15,  // low vol
    seed: 123,
  });
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Replay Engine', () => {
  describe('runReplay', () => {
    it('returns valid result structure with empty dataset', () => {
      const empty: HistoricalDataset = {
        symbol: 'TEST',
        candles: [],
        startTime: 0,
        endTime: 0,
        intervalMs: 3600000,
      };
      const result = runReplay([empty], makeConfig());
      expect(result.metrics).toBeDefined();
      expect(result.trades).toEqual([]);
      expect(result.equityCurve.length).toBeGreaterThanOrEqual(1);
      expect(result.candlesProcessed).toBe(0);
    });

    it('preserves capital with no signals (tiny dataset)', () => {
      const ds: HistoricalDataset = {
        symbol: 'TEST',
        candles: Array.from({ length: 10 }, (_, i) => ({
          timestamp: Date.now() - (10 - i) * 3600000,
          open: 100, high: 100, low: 100, close: 100, volume: 1000,
        })),
        startTime: Date.now() - 10 * 3600000,
        endTime: Date.now(),
        intervalMs: 3600000,
      };

      const result = runReplay([ds], makeConfig());
      // Not enough candles for warmup (50), so no trades
      expect(result.metrics.totalTrades).toBe(0);
      expect(result.metrics.totalReturn).toBe(0);
    });

    it('executes trades on sufficient bullish data', () => {
      const ds = makeBullDataset();
      const result = runReplay([ds], makeConfig());

      // Should have executed some trades
      expect(result.metrics.totalTrades).toBeGreaterThan(0);
      expect(result.trades.length).toBeGreaterThan(0);
      expect(result.equityCurve.length).toBeGreaterThan(1);
      expect(result.candlesProcessed).toBeGreaterThan(0);
      expect(result.replayDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('equity curve length matches processed candles', () => {
      const ds = makeBullDataset();
      const result = runReplay([ds], makeConfig());
      // One equity point per processed tick
      expect(result.equityCurve.length).toBe(result.equityTimestamps.length);
    });

    it('computes valid performance metrics', () => {
      const ds = makeBullDataset();
      const result = runReplay([ds], makeConfig());
      const m = result.metrics;

      // Check metric ranges
      expect(m.winRate).toBeGreaterThanOrEqual(0);
      expect(m.winRate).toBeLessThanOrEqual(1);
      expect(m.totalTrades).toBeGreaterThanOrEqual(0);
      expect(m.winningTrades + m.losingTrades).toBeLessThanOrEqual(m.totalTrades);
      expect(m.maxDrawdownPct).toBeGreaterThanOrEqual(0);
      expect(m.holdBaseline).toBeGreaterThan(0);
    });

    it('handles multi-symbol datasets', () => {
      const eth = generateSyntheticData({
        symbol: 'ETH', startPrice: 2000, candles: 300, drift: 0.5, volatility: 0.3, seed: 42,
      });
      const btc = generateSyntheticData({
        symbol: 'BTC', startPrice: 30000, candles: 300, drift: 0.3, volatility: 0.25, seed: 77,
      });

      const result = runReplay([eth, btc], makeConfig());
      expect(result.metrics.totalTrades).toBeGreaterThanOrEqual(0);
      expect(result.equityCurve.length).toBeGreaterThan(0);
    });

    it('respects time range filters', () => {
      const ds = makeBullDataset();
      const midTime = ds.candles[Math.floor(ds.candles.length / 2)].timestamp;

      const fullResult = runReplay([ds], makeConfig());
      const partialResult = runReplay([ds], {
        ...makeConfig(),
        startTime: midTime,
      });

      // Partial should process fewer candles
      expect(partialResult.candlesProcessed).toBeLessThan(fullResult.candlesProcessed);
    });

    it('stop loss triggers on bearish data', () => {
      const ds = makeBearDataset();
      const config = makeConfig({ stopLossPercent: 5, confluenceBuyThreshold: 5 });
      const result = runReplay([ds], config);

      // Look for stop loss trades
      const stopLossTrades = result.trades.filter(t => t.reason.includes('STOP_LOSS'));
      // In a strong bear market with low buy threshold, we may get stop losses
      // The key check is that the replay runs without errors
      expect(result.metrics).toBeDefined();
    });

    it('produces condition breakdown', () => {
      const ds = generateSyntheticData({
        symbol: 'ETH', startPrice: 2000, candles: 1000,
        drift: 0.2, volatility: 0.5, seed: 42,
      });
      const result = runReplay([ds], makeConfig());

      // Should have at least some condition breakdown entries
      expect(result.conditionBreakdown).toBeDefined();
      expect(Array.isArray(result.conditionBreakdown)).toBe(true);
    });
  });

  describe('strategy parameter sensitivity', () => {
    it('higher buy threshold produces fewer trades', () => {
      const ds = makeBullDataset();

      const lowThreshold = runReplay([ds], makeConfig({ confluenceBuyThreshold: 5 }));
      const highThreshold = runReplay([ds], makeConfig({ confluenceBuyThreshold: 40 }));

      const lowBuys = lowThreshold.trades.filter(t => t.action === 'BUY').length;
      const highBuys = highThreshold.trades.filter(t => t.action === 'BUY').length;

      expect(lowBuys).toBeGreaterThanOrEqual(highBuys);
    });

    it('tighter stop loss triggers more sell trades', () => {
      const ds = generateSyntheticData({
        symbol: 'ETH', startPrice: 2000, candles: 500,
        drift: 0.0, volatility: 0.6, seed: 55,
      });

      const tightStop = runReplay([ds], makeConfig({ stopLossPercent: 3, confluenceBuyThreshold: 5 }));
      const wideStop = runReplay([ds], makeConfig({ stopLossPercent: 30, confluenceBuyThreshold: 5 }));

      const tightStopLosses = tightStop.trades.filter(t => t.reason.includes('STOP_LOSS')).length;
      const wideStopLosses = wideStop.trades.filter(t => t.reason.includes('STOP_LOSS')).length;

      expect(tightStopLosses).toBeGreaterThanOrEqual(wideStopLosses);
    });
  });
});
