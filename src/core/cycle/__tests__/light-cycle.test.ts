/**
 * Unit tests for the light cycle extraction (Phase 5a).
 *
 * These tests verify that runLightCycle() produces identical observable
 * side-effects to the original inline code in agent-v3.2.ts lines 6036-6057.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runLightCycle,
  type LightCycleInput,
  type LightCycleCycleStats,
  type LightCycleAdaptiveState,
} from '../light-cycle.js';

// Silence console.log during tests and reset between each test
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

function makeInput(overrides: Partial<LightCycleInput> = {}): LightCycleInput {
  const cycleStats: LightCycleCycleStats = {
    totalLight: 0,
    totalHeavy: 2,
    lastHeavyReason: 'Forced interval',
  };
  const adaptiveCycle: LightCycleAdaptiveState = {
    currentIntervalSec: 90,
    volatilityLevel: 'NORMAL',
    consecutiveLightCycles: 3,
    lastPriceCheck: new Map([['ETH', 2900]]),
  };
  return {
    cycleNumber: 42,
    cycleStart: Date.now() - 150,
    portfolioValue: 5000,
    cooldownCount: 2,
    cacheStats: {
      entries: 30,
      totalHits: 200,
      totalMisses: 50,
      hitRate: '80.0%',
      oldestEntryAge: '4m',
    },
    lightInterval: {
      intervalSec: 60,
      reason: 'LOW volatility | STARTER tier',
      volatilityLevel: 'LOW',
    },
    currentPrices: new Map([['ETH', 3000], ['BTC', 65000]]),
    costBasis: {
      ETH: { currentPrice: 2900, averageCostBasis: 2800 },
      BTC: { currentPrice: 64000 },
    },
    cycleStats,
    adaptiveCycle,
    ...overrides,
  };
}

// ============================================================================
// cycleStats mutations
// ============================================================================

describe('cycleStats mutations', () => {
  it('increments totalLight by 1', () => {
    const input = makeInput();
    input.cycleStats.totalLight = 5;
    runLightCycle(input);
    expect(input.cycleStats.totalLight).toBe(6);
  });

  it('does not touch totalHeavy', () => {
    const input = makeInput();
    runLightCycle(input);
    expect(input.cycleStats.totalHeavy).toBe(2);
  });
});

// ============================================================================
// adaptiveCycle mutations
// ============================================================================

describe('adaptiveCycle mutations', () => {
  it('increments consecutiveLightCycles by 1', () => {
    const input = makeInput();
    input.adaptiveCycle.consecutiveLightCycles = 7;
    runLightCycle(input);
    expect(input.adaptiveCycle.consecutiveLightCycles).toBe(8);
  });

  it('sets currentIntervalSec from lightInterval', () => {
    const input = makeInput();
    runLightCycle(input);
    expect(input.adaptiveCycle.currentIntervalSec).toBe(60);
  });

  it('sets volatilityLevel from lightInterval', () => {
    const input = makeInput();
    runLightCycle(input);
    expect(input.adaptiveCycle.volatilityLevel).toBe('LOW');
  });

  it('replaces lastPriceCheck with a copy of currentPrices', () => {
    const input = makeInput();
    runLightCycle(input);
    expect(input.adaptiveCycle.lastPriceCheck.get('ETH')).toBe(3000);
    expect(input.adaptiveCycle.lastPriceCheck.get('BTC')).toBe(65000);
  });

  it('lastPriceCheck is a new Map (not same reference as currentPrices)', () => {
    const input = makeInput();
    runLightCycle(input);
    expect(input.adaptiveCycle.lastPriceCheck).not.toBe(input.currentPrices);
  });
});

// ============================================================================
// costBasis.currentPrice sync
// ============================================================================

describe('costBasis.currentPrice sync', () => {
  it('updates currentPrice for tracked symbols', () => {
    const input = makeInput();
    runLightCycle(input);
    expect(input.costBasis['ETH']?.currentPrice).toBe(3000);
    expect(input.costBasis['BTC']?.currentPrice).toBe(65000);
  });

  it('does not create a costBasis entry for unknown symbols', () => {
    const input = makeInput();
    input.currentPrices.set('UNKNOWN', 1.23);
    runLightCycle(input);
    expect(input.costBasis['UNKNOWN']).toBeUndefined();
  });

  it('skips symbols where price is 0', () => {
    const input = makeInput();
    input.currentPrices.set('ETH', 0);
    input.costBasis['ETH'] = { currentPrice: 2900 };
    runLightCycle(input);
    // price === 0 → skipped, old value preserved
    expect(input.costBasis['ETH']?.currentPrice).toBe(2900);
  });
});

// ============================================================================
// console.log output
// ============================================================================

describe('console.log output', () => {
  it('logs a line containing the cycle number', () => {
    const input = makeInput({ cycleNumber: 99 });
    runLightCycle(input);
    const [msg] = (console.log as ReturnType<typeof vi.spyOn>).mock.calls[0];
    expect(msg).toContain('[CYCLE #99] LIGHT');
  });

  it('logs portfolio value formatted to 2dp', () => {
    const input = makeInput({ portfolioValue: 1234.5 });
    runLightCycle(input);
    const [msg] = (console.log as ReturnType<typeof vi.spyOn>).mock.calls[0];
    expect(msg).toContain('$1234.50');
  });

  it('logs next interval from lightInterval', () => {
    const input = makeInput();
    runLightCycle(input);
    const [msg] = (console.log as ReturnType<typeof vi.spyOn>).mock.calls[0];
    expect(msg).toContain('60s (LOW)');
  });
});
