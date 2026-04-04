/**
 * Death loop tests: peakPrice reset on re-entry + FORCED_DEPLOY trailing stop cooldown.
 *
 * Root cause of the $759 disaster: buying cbBTC at $68K with a stale peakPrice of $69.9K
 * caused the trailing stop to fire instantly (-2.7% from "peak"), locking in a loss on
 * a position that was actually flat from its true entry price.
 */

import { describe, it, expect } from 'vitest';
import {
  resetPeakPriceOnReEntry,
  isForcedDeployCooldownActive,
  computeTrailingLoss,
  checkStopTrigger,
} from '../services/testable/stop-loss.js';
import { mockCostBasis, mockTradeRecord, mockStopLossConfig, hoursAgo } from './setup.js';

describe('peakPrice reset on re-entry', () => {
  it('should reset peakPrice to buyPrice when re-entering after full exit', () => {
    // Scenario: sold all cbBTC, peakPrice is stale at $69.9K.
    // Now buying back at $68K. peakPrice MUST reset to $68K.
    const cb = mockCostBasis({
      currentHolding: 0,
      totalTokensAcquired: 0,
      peakPrice: 69900,
    });

    resetPeakPriceOnReEntry(cb, 68000);

    expect(cb.peakPrice).toBe(68000);
    expect(cb.trailActivated).toBe(false);
  });

  it('should NOT reset peakPrice if position already held (not a re-entry)', () => {
    const cb = mockCostBasis({
      currentHolding: 0.015,
      totalTokensAcquired: 0.015,
      peakPrice: 69900,
    });

    resetPeakPriceOnReEntry(cb, 68000);

    // peakPrice must remain unchanged — this is an add-on, not a re-entry
    expect(cb.peakPrice).toBe(69900);
  });

  it('should update peakPriceDate on reset', () => {
    const cb = mockCostBasis({
      currentHolding: 0,
      totalTokensAcquired: 0,
      peakPrice: 69900,
      peakPriceDate: '2026-03-25T00:00:00Z',
    });

    const before = Date.now();
    resetPeakPriceOnReEntry(cb, 68000);
    const after = Date.now();

    const resetTime = new Date(cb.peakPriceDate).getTime();
    expect(resetTime).toBeGreaterThanOrEqual(before);
    expect(resetTime).toBeLessThanOrEqual(after);
  });

  it('should not reset if buyPrice is 0 or negative', () => {
    const cb = mockCostBasis({
      currentHolding: 0,
      totalTokensAcquired: 0,
      peakPrice: 69900,
    });

    resetPeakPriceOnReEntry(cb, 0);
    expect(cb.peakPrice).toBe(69900);

    resetPeakPriceOnReEntry(cb, -100);
    expect(cb.peakPrice).toBe(69900);
  });
});

describe('FORCED_DEPLOY trailing stop cooldown', () => {
  it('should BLOCK trailing stop within 2 hours of a FORCED_DEPLOY buy', () => {
    const now = Date.now();
    const tradeHistory: ReturnType<typeof mockTradeRecord>[] = [
      mockTradeRecord({
        action: 'BUY',
        toToken: 'cbBTC',
        reasoning: 'FORCED_DEPLOY: High cash, deploying into cbBTC',
        timestamp: hoursAgo(1, now), // 1 hour ago
        success: true,
      }),
    ];

    const blocked = isForcedDeployCooldownActive(tradeHistory, 'cbBTC', now);
    expect(blocked).toBe(true);
  });

  it('should ALLOW trailing stop after 2+ hours of a FORCED_DEPLOY buy', () => {
    const now = Date.now();
    const tradeHistory = [
      mockTradeRecord({
        action: 'BUY',
        toToken: 'cbBTC',
        reasoning: 'FORCED_DEPLOY: High cash, deploying into cbBTC',
        timestamp: hoursAgo(3, now), // 3 hours ago
        success: true,
      }),
    ];

    const blocked = isForcedDeployCooldownActive(tradeHistory, 'cbBTC', now);
    expect(blocked).toBe(false);
  });

  it('should ALLOW trailing stop for normal (non-FORCED_DEPLOY) buys immediately', () => {
    const now = Date.now();
    const tradeHistory = [
      mockTradeRecord({
        action: 'BUY',
        toToken: 'cbBTC',
        reasoning: 'AI: Technical confluence buy signal',
        timestamp: hoursAgo(0.5, now), // 30 min ago
        success: true,
      }),
    ];

    const blocked = isForcedDeployCooldownActive(tradeHistory, 'cbBTC', now);
    expect(blocked).toBe(false);
  });

  it('should also block for SCOUT tier within 2 hours', () => {
    const now = Date.now();
    const tradeHistory = [
      mockTradeRecord({
        action: 'BUY',
        toToken: 'AERO',
        reasoning: 'SCOUT: Exploring new position in AERO',
        timestamp: hoursAgo(1.5, now),
        success: true,
      }),
    ];

    const blocked = isForcedDeployCooldownActive(tradeHistory, 'AERO', now);
    expect(blocked).toBe(true);
  });

  it('should not block for a different symbol', () => {
    const now = Date.now();
    const tradeHistory = [
      mockTradeRecord({
        action: 'BUY',
        toToken: 'cbBTC',
        reasoning: 'FORCED_DEPLOY: deploying',
        timestamp: hoursAgo(0.5, now),
        success: true,
      }),
    ];

    // Asking about AERO, not cbBTC
    const blocked = isForcedDeployCooldownActive(tradeHistory, 'AERO', now);
    expect(blocked).toBe(false);
  });
});

describe('trailing stop trigger math', () => {
  it('should compute correct trailing loss from peak', () => {
    // Price dropped from 69900 to 68000 => -2.72%
    const loss = computeTrailingLoss(68000, 69900);
    expect(loss).toBeCloseTo(-2.72, 1);
  });

  it('should return 0 if peakPrice is 0', () => {
    expect(computeTrailingLoss(68000, 0)).toBe(0);
  });

  it('should trigger TRAILING_STOP when loss exceeds threshold', () => {
    const cb = mockCostBasis({
      averageCostBasis: 68000,
      peakPrice: 69900,
    });
    const cfg = mockStopLossConfig();

    // Current price $66K => trailing loss from peak = (66000-69900)/69900 = -5.58%
    // With effectiveTrailing = -5, this should trigger
    const result = checkStopTrigger(66000, cb, -25, -5, cfg);
    expect(result).toBe('TRAILING_STOP');
  });

  it('should NOT trigger trailing stop when loss is within threshold', () => {
    const cb = mockCostBasis({
      averageCostBasis: 68000,
      peakPrice: 69900,
    });
    const cfg = mockStopLossConfig();

    // Current price $69000 => trailing loss = (69000-69900)/69900 = -1.29%
    // With effectiveTrailing = -5, this should NOT trigger
    const result = checkStopTrigger(69000, cb, -25, -5, cfg);
    expect(result).toBeNull();
  });

  it('should trigger STOP_LOSS from cost basis before trailing stop', () => {
    const cb = mockCostBasis({
      averageCostBasis: 68000,
      peakPrice: 69900,
    });
    const cfg = mockStopLossConfig();

    // Current price $50K => loss from cost = -26.5%, trailing = -28.5%
    // effectiveSL = -15 => cost basis triggers first
    const result = checkStopTrigger(50000, cb, -15, -12, cfg);
    expect(result).toBe('STOP_LOSS');
  });
});
