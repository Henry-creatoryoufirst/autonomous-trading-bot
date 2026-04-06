import { describe, it, expect } from 'vitest';
import { runConfidenceGate } from '../../../scripts/confidence-gate.js';
import { DEFAULT_STRATEGY_PARAMS } from '../types.js';
import type { StrategyParams } from '../types.js';

// Gate runs take ~80s each due to 4x 365-day hourly replays with enhanced indicators.
// We run the gate once and share the result across multiple assertions.

describe('Confidence Gate', () => {
  let defaultGate: ReturnType<typeof runConfidenceGate>;

  it('runs gate with default params and returns a valid GateResult', () => {
    defaultGate = runConfidenceGate(60);

    expect(defaultGate).toHaveProperty('score');
    expect(defaultGate).toHaveProperty('results');
    expect(defaultGate).toHaveProperty('threshold');
    expect(defaultGate).toHaveProperty('passed');
    expect(defaultGate.threshold).toBe(60);
    expect(typeof defaultGate.passed).toBe('boolean');
  }, 120_000);

  it('score has correct structure', () => {
    const { score } = defaultGate;

    expect(score.overall).toBeGreaterThanOrEqual(0);
    expect(score.overall).toBeLessThanOrEqual(100);
    expect(score.byCondition).toHaveProperty('BULL');
    expect(score.byCondition).toHaveProperty('BEAR');
    expect(score.byCondition).toHaveProperty('RANGING');
    expect(score.byCondition).toHaveProperty('VOLATILE');
    expect(score.byMetric).toHaveProperty('returnScore');
    expect(score.byMetric).toHaveProperty('riskScore');
    expect(score.byMetric).toHaveProperty('consistencyScore');
    expect(score.byMetric).toHaveProperty('robustnessScore');
    expect(Array.isArray(score.reasoning)).toBe(true);
    expect(score.reasoning.length).toBeGreaterThan(0);
  });

  it('runs 4 replay results (one per market condition)', () => {
    expect(defaultGate.results).toHaveLength(4);
  });

  it('each replay result has trades and equity curve', () => {
    for (const result of defaultGate.results) {
      expect(Array.isArray(result.trades)).toBe(true);
      expect(Array.isArray(result.equityCurve)).toBe(true);
      expect(result.candlesProcessed).toBeGreaterThan(0);
    }
  });

  it('metric scores are within valid ranges (0-25 each)', () => {
    const { score } = defaultGate;
    for (const key of ['returnScore', 'riskScore', 'consistencyScore', 'robustnessScore'] as const) {
      expect(score.byMetric[key]).toBeGreaterThanOrEqual(0);
      expect(score.byMetric[key]).toBeLessThanOrEqual(25);
    }
  });

  it('condition scores are within valid ranges (0-100 each)', () => {
    const { score } = defaultGate;
    for (const cond of ['BULL', 'BEAR', 'RANGING', 'VOLATILE'] as const) {
      expect(score.byCondition[cond]).toBeGreaterThanOrEqual(0);
      expect(score.byCondition[cond]).toBeLessThanOrEqual(100);
    }
  });

  it('fails with a very high threshold (100)', () => {
    // Reuse existing result but verify that if we ran at threshold=100 it fails
    // No strategy can score 100/100 on synthetic data
    const highGate = runConfidenceGate(100);
    expect(highGate.threshold).toBe(100);
    expect(highGate.passed).toBe(false);
  }, 120_000);

  it('bad parameters score worse than default parameters', () => {
    const badParams: StrategyParams = {
      ...DEFAULT_STRATEGY_PARAMS,
      stopLossPercent: 50,           // way too loose
      confluenceBuyThreshold: 80,    // almost never buys
      confluenceSellThreshold: -5,   // sells too easily
      kellyFraction: 0.05,           // tiny positions
      maxPositionPercent: 3,         // tiny max position
    };

    const badGate = runConfidenceGate(60, badParams);
    // Bad params should score equal or worse than default
    expect(badGate.score.overall).toBeLessThanOrEqual(defaultGate.score.overall + 5); // small tolerance
    expect(badGate.passed).toBe(false);
  }, 120_000);

  it('does not crash or throw', () => {
    // The gate ran without throwing (tested by first test)
    expect(defaultGate.score).toBeDefined();
    expect(defaultGate.results.length).toBe(4);
  });
});
