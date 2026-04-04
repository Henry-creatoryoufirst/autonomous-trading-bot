import { describe, it, expect } from 'vitest';
import { calculateConfidence, calculateAggregateConfidence } from '../scoring/confidence-scorer.js';
import { runReplay } from '../engine/replay-engine.js';
import { generateSyntheticData } from '../data/historical-data.js';
import type { ReplayResult, ConfidenceScorerConfig, ConditionBreakdown, PerformanceMetrics } from '../types.js';
import { DEFAULT_STRATEGY_PARAMS, DEFAULT_CONFIDENCE_CONFIG } from '../types.js';

// ===========================================================================
// Helpers
// ===========================================================================

function makeReplayResult(overrides?: Partial<PerformanceMetrics>): ReplayResult {
  return {
    metrics: {
      totalReturn: 100,
      totalReturnPct: 20,
      maxDrawdown: 50,
      maxDrawdownPct: 10,
      winRate: 0.55,
      totalTrades: 60,
      winningTrades: 33,
      losingTrades: 27,
      profitFactor: 1.8,
      avgWin: 15,
      avgLoss: 10,
      sharpeRatio: 1.5,
      sortinoRatio: 2.0,
      calmarRatio: 1.2,
      holdBaseline: 550,
      holdBaselinePct: 10,
      avgTradesPerMonth: 5,
      ...overrides,
    },
    trades: [],
    equityCurve: [500, 520, 510, 540, 600],
    equityTimestamps: [1, 2, 3, 4, 5],
    conditionBreakdown: [
      makeConditionBreakdown('BULL', 15, 0.6, 200),
      makeConditionBreakdown('BEAR', -2, 0.4, 200),
      makeConditionBreakdown('RANGING', 5, 0.5, 200),
      makeConditionBreakdown('VOLATILE', 8, 0.45, 200),
    ],
    replayDurationMs: 100,
    candlesProcessed: 800,
  };
}

function makeConditionBreakdown(
  condition: 'BULL' | 'BEAR' | 'RANGING' | 'VOLATILE',
  returnPct: number,
  winRate: number,
  totalCandles: number,
): ConditionBreakdown {
  return {
    condition,
    metrics: {
      totalReturn: returnPct * 5,
      totalReturnPct: returnPct,
      maxDrawdown: 20,
      maxDrawdownPct: 5,
      winRate,
      totalTrades: 15,
      winningTrades: Math.round(15 * winRate),
      losingTrades: Math.round(15 * (1 - winRate)),
      profitFactor: winRate > 0.5 ? 1.5 : 0.8,
      avgWin: 10,
      avgLoss: 8,
      sharpeRatio: 1,
      sortinoRatio: 1,
      calmarRatio: 1,
      holdBaseline: 500,
      holdBaselinePct: 0,
      avgTradesPerMonth: 5,
    },
    periodCount: 2,
    totalCandles,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Confidence Scorer', () => {
  describe('calculateConfidence', () => {
    it('produces a score between 0 and 100', () => {
      const result = makeReplayResult();
      const confidence = calculateConfidence(result);

      expect(confidence.overall).toBeGreaterThanOrEqual(0);
      expect(confidence.overall).toBeLessThanOrEqual(100);
    });

    it('passes threshold for good performance', () => {
      const result = makeReplayResult({
        totalReturnPct: 25,
        holdBaselinePct: 10,
        sharpeRatio: 2.0,
        maxDrawdownPct: 8,
        winRate: 0.6,
        totalTrades: 60,
        profitFactor: 2.0,
        calmarRatio: 2.0,
      });
      // Ensure all conditions are profitable so per-condition minimums pass
      result.conditionBreakdown = [
        makeConditionBreakdown('BULL', 20, 0.65, 200),
        makeConditionBreakdown('BEAR', 5, 0.5, 200),
        makeConditionBreakdown('RANGING', 8, 0.55, 200),
        makeConditionBreakdown('VOLATILE', 10, 0.5, 200),
      ];

      const confidence = calculateConfidence(result);
      expect(confidence.passesThreshold).toBe(true);
      expect(confidence.overall).toBeGreaterThan(DEFAULT_CONFIDENCE_CONFIG.minimumConfidence);
    });

    it('fails threshold for poor performance', () => {
      const result = makeReplayResult({
        totalReturnPct: -20,
        holdBaselinePct: 10,
        sharpeRatio: -0.5,
        maxDrawdownPct: 40,
        winRate: 0.3,
        totalTrades: 5,
        profitFactor: 0.5,
        calmarRatio: -1,
      });

      // Override condition breakdowns to be poor
      result.conditionBreakdown = [
        makeConditionBreakdown('BULL', -10, 0.2, 200),
        makeConditionBreakdown('BEAR', -20, 0.2, 200),
        makeConditionBreakdown('RANGING', -5, 0.3, 200),
        makeConditionBreakdown('VOLATILE', -15, 0.25, 200),
      ];

      const confidence = calculateConfidence(result);
      expect(confidence.passesThreshold).toBe(false);
    });

    it('provides reasoning strings', () => {
      const result = makeReplayResult();
      const confidence = calculateConfidence(result);

      expect(confidence.reasoning.length).toBeGreaterThan(0);
      expect(confidence.reasoning.some(r => typeof r === 'string')).toBe(true);
    });

    it('scores all four metric categories', () => {
      const result = makeReplayResult();
      const confidence = calculateConfidence(result);

      expect(confidence.byMetric.returnScore).toBeGreaterThanOrEqual(0);
      expect(confidence.byMetric.returnScore).toBeLessThanOrEqual(25);
      expect(confidence.byMetric.riskScore).toBeGreaterThanOrEqual(0);
      expect(confidence.byMetric.riskScore).toBeLessThanOrEqual(25);
      expect(confidence.byMetric.consistencyScore).toBeGreaterThanOrEqual(0);
      expect(confidence.byMetric.consistencyScore).toBeLessThanOrEqual(25);
      expect(confidence.byMetric.robustnessScore).toBeGreaterThanOrEqual(0);
      expect(confidence.byMetric.robustnessScore).toBeLessThanOrEqual(25);
    });

    it('scores all four market conditions', () => {
      const result = makeReplayResult();
      const confidence = calculateConfidence(result);

      for (const cond of ['BULL', 'BEAR', 'RANGING', 'VOLATILE'] as const) {
        expect(confidence.byCondition[cond]).toBeGreaterThanOrEqual(0);
        expect(confidence.byCondition[cond]).toBeLessThanOrEqual(100);
      }
    });

    it('respects custom config thresholds', () => {
      const result = makeReplayResult({ totalReturnPct: 5 });
      const strictConfig: ConfidenceScorerConfig = {
        ...DEFAULT_CONFIDENCE_CONFIG,
        minimumConfidence: 95,
      };

      const confidence = calculateConfidence(result, strictConfig);
      expect(confidence.passesThreshold).toBe(false);
      expect(confidence.threshold).toBe(95);
    });

    it('handles empty condition breakdown', () => {
      const result = makeReplayResult();
      result.conditionBreakdown = [];

      const confidence = calculateConfidence(result);
      expect(confidence.overall).toBeGreaterThanOrEqual(0);
      expect(confidence.byMetric.robustnessScore).toBe(5); // minimal score
    });
  });

  describe('calculateAggregateConfidence', () => {
    it('handles empty results array', () => {
      const confidence = calculateAggregateConfidence([]);
      expect(confidence.overall).toBe(0);
      expect(confidence.passesThreshold).toBe(false);
    });

    it('averages scores from multiple results', () => {
      const result1 = makeReplayResult({ totalReturnPct: 30 });
      const result2 = makeReplayResult({ totalReturnPct: 10 });

      const confidence = calculateAggregateConfidence([result1, result2]);
      expect(confidence.overall).toBeGreaterThan(0);
      expect(confidence.reasoning.some(r => r.includes('Aggregated from 2'))).toBe(true);
    });

    it('fails if any individual result fails', () => {
      const good = makeReplayResult({ totalReturnPct: 30, sharpeRatio: 2 });
      const bad = makeReplayResult({
        totalReturnPct: -30, sharpeRatio: -1, winRate: 0.2, totalTrades: 3,
        maxDrawdownPct: 50, profitFactor: 0.3, calmarRatio: -2,
      });
      bad.conditionBreakdown = [
        makeConditionBreakdown('BULL', -20, 0.2, 200),
        makeConditionBreakdown('BEAR', -30, 0.1, 200),
        makeConditionBreakdown('RANGING', -10, 0.2, 200),
        makeConditionBreakdown('VOLATILE', -25, 0.15, 200),
      ];

      const confidence = calculateAggregateConfidence([good, bad]);
      expect(confidence.passesThreshold).toBe(false);
    });
  });

  describe('integration with replay engine', () => {
    it('scores a real replay result', () => {
      const ds = generateSyntheticData({
        symbol: 'ETH', startPrice: 2000, candles: 500,
        drift: 0.5, volatility: 0.3, seed: 42,
      });

      const result = runReplay([ds], { strategy: DEFAULT_STRATEGY_PARAMS });
      const confidence = calculateConfidence(result);

      expect(confidence.overall).toBeGreaterThanOrEqual(0);
      expect(confidence.overall).toBeLessThanOrEqual(100);
      expect(typeof confidence.passesThreshold).toBe('boolean');
    });
  });
});
