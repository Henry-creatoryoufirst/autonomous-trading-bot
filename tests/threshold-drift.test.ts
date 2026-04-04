/**
 * Threshold drift tests: bounds clamping, decay toward defaults, circuit breaker reset.
 *
 * The death spiral: confluenceBuy drifts to 28+ -> only the worst signals pass ->
 * those signals lose -> threshold raised further -> bot paralyzed.
 * v21.3 caps at 20 and decays 5% per cycle.
 */

import { describe, it, expect } from 'vitest';
import {
  THRESHOLD_BOUNDS,
  DEFAULT_ADAPTIVE_THRESHOLDS,
  clampAllThresholds,
  decayThresholdsTowardDefaults,
  shouldCircuitBreakerReset,
  resetThresholdsToDefaults,
} from '../src/core/services/testable/adaptive-thresholds.js';
import { mockThresholds } from './setup.js';

describe('confluenceBuy max bound', () => {
  it('should cap confluenceBuy at 20 (max bound)', () => {
    const t = mockThresholds({ confluenceBuy: 28 });
    clampAllThresholds(t);
    expect(t.confluenceBuy).toBe(20);
  });

  it('should not lower confluenceBuy if already within bounds', () => {
    const t = mockThresholds({ confluenceBuy: 15 });
    clampAllThresholds(t);
    expect(t.confluenceBuy).toBe(15);
  });

  it('should enforce min bound of 5 for confluenceBuy', () => {
    const t = mockThresholds({ confluenceBuy: 2 });
    clampAllThresholds(t);
    expect(t.confluenceBuy).toBe(5);
  });

  it('should cap confluenceStrongBuy at 38', () => {
    const t = mockThresholds({ confluenceStrongBuy: 60 });
    clampAllThresholds(t);
    expect(t.confluenceStrongBuy).toBe(38);
  });

  it('should clamp all fields simultaneously', () => {
    const t = mockThresholds({
      confluenceBuy: 50,
      confluenceStrongBuy: 100,
      stopLossPercent: -5,      // above max of -12
      trailingStopPercent: -3,  // above max of -10
    });
    clampAllThresholds(t);
    expect(t.confluenceBuy).toBe(20);
    expect(t.confluenceStrongBuy).toBe(38);
    expect(t.stopLossPercent).toBe(-12);
    expect(t.trailingStopPercent).toBe(-10);
  });
});

describe('threshold decay toward defaults', () => {
  it('should decay confluenceBuy=20 toward default=8 by 5%', () => {
    // 20 - (20-8)*0.05 = 20 - 0.6 = 19.4
    const t = mockThresholds({ confluenceBuy: 20 });
    decayThresholdsTowardDefaults(t);
    expect(t.confluenceBuy).toBeCloseTo(19.4, 2);
  });

  it('should decay values below default back up toward default', () => {
    // confluenceBuy=5 (min), default=8 => 5 - (5-8)*0.05 = 5 + 0.15 = 5.15
    const t = mockThresholds({ confluenceBuy: 5 });
    decayThresholdsTowardDefaults(t);
    expect(t.confluenceBuy).toBeCloseTo(5.15, 2);
  });

  it('should not move values already at default', () => {
    const t = mockThresholds(); // all defaults
    const before = { ...t };
    decayThresholdsTowardDefaults(t);
    for (const field of Object.keys(THRESHOLD_BOUNDS)) {
      expect(t[field]).toBeCloseTo(before[field], 5);
    }
  });

  it('should respect bounds even after decay', () => {
    // If a value decays below min, it gets clamped
    const t = mockThresholds({ confluenceBuy: 5.01 });
    // 5.01 - (5.01-8)*0.05 = 5.01 + 0.1495 = 5.1595 — still above min 5, fine
    decayThresholdsTowardDefaults(t);
    expect(t.confluenceBuy).toBeGreaterThanOrEqual(THRESHOLD_BOUNDS.confluenceBuy.min);
    expect(t.confluenceBuy).toBeLessThanOrEqual(THRESHOLD_BOUNDS.confluenceBuy.max);
  });

  it('should converge to defaults after many iterations', () => {
    const t = mockThresholds({ confluenceBuy: 20, confluenceStrongBuy: 38 });
    for (let i = 0; i < 200; i++) {
      decayThresholdsTowardDefaults(t);
    }
    // After 200 cycles of 5% decay, should be very close to defaults
    expect(t.confluenceBuy).toBeCloseTo(DEFAULT_ADAPTIVE_THRESHOLDS.confluenceBuy, 0);
    expect(t.confluenceStrongBuy).toBeCloseTo(DEFAULT_ADAPTIVE_THRESHOLDS.confluenceStrongBuy, 0);
  });
});

describe('circuit breaker reset after idle period', () => {
  it('should trigger reset after 2+ hours idle with high cash (>=40%)', () => {
    const now = Date.now();
    const lastTrade = now - 3 * 60 * 60 * 1000; // 3 hours ago
    expect(shouldCircuitBreakerReset(lastTrade, 50, now)).toBe(true);
  });

  it('should NOT trigger reset if idle < 2 hours', () => {
    const now = Date.now();
    const lastTrade = now - 1 * 60 * 60 * 1000; // 1 hour ago
    expect(shouldCircuitBreakerReset(lastTrade, 50, now)).toBe(false);
  });

  it('should NOT trigger reset if cash is low even if idle', () => {
    const now = Date.now();
    const lastTrade = now - 5 * 60 * 60 * 1000; // 5 hours ago
    expect(shouldCircuitBreakerReset(lastTrade, 20, now)).toBe(false);
  });

  it('should NOT trigger if no trade ever recorded (null)', () => {
    expect(shouldCircuitBreakerReset(null, 80)).toBe(false);
  });

  it('should reset thresholds to defaults when circuit breaker fires', () => {
    const t = mockThresholds({
      confluenceBuy: 20,
      confluenceStrongBuy: 38,
      stopLossPercent: -25,
    });

    resetThresholdsToDefaults(t);

    expect(t.confluenceBuy).toBe(DEFAULT_ADAPTIVE_THRESHOLDS.confluenceBuy);
    expect(t.confluenceStrongBuy).toBe(DEFAULT_ADAPTIVE_THRESHOLDS.confluenceStrongBuy);
    expect(t.stopLossPercent).toBe(DEFAULT_ADAPTIVE_THRESHOLDS.stopLossPercent);
  });
});
