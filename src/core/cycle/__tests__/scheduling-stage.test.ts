/**
 * Unit tests for the SCHEDULING stage extraction (Phase 5g).
 *
 * Tests runSchedulingStage() — verifies it produces identical observable
 * side-effects to agent-v3.2.ts lines 8395–8418.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSchedulingStage, type SchedulingInput, type SchedulingAdaptiveCycle } from '../stages/scheduling.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAdaptiveCycle(overrides: Partial<SchedulingAdaptiveCycle> = {}): SchedulingAdaptiveCycle {
  return {
    currentIntervalSec:     90,
    volatilityLevel:        'NORMAL',
    consecutiveLightCycles: 7,
    lastPriceCheck:         new Map([['ETH', 2900]]),
    emergencyMode:          false,
    emergencyUntil:         0,
    wsConnected:            true,
    dynamicPriceThreshold:  0.015,
    portfolioTier:          'STARTER',
    ...overrides,
  };
}

function makeInput(overrides: Partial<SchedulingInput> = {}): SchedulingInput {
  return {
    currentPrices: new Map([['ETH', 3000], ['BTC', 65000]]),
    adaptiveCycle: makeAdaptiveCycle(),
    deps: {
      computeNextInterval: vi.fn().mockReturnValue({
        intervalSec: 60,
        volatilityLevel: 'LOW',
        reason: 'LOW volatility | STARTER tier',
      }),
      updateOpportunityCosts: vi.fn(),
    },
    ...overrides,
  };
}

// ─── adaptiveCycle mutations ──────────────────────────────────────────────────

describe('adaptiveCycle mutations', () => {
  it('sets currentIntervalSec from computeNextInterval result', () => {
    const input = makeInput();
    runSchedulingStage(input);
    expect(input.adaptiveCycle.currentIntervalSec).toBe(60);
  });

  it('sets volatilityLevel from computeNextInterval result', () => {
    const input = makeInput();
    runSchedulingStage(input);
    expect(input.adaptiveCycle.volatilityLevel).toBe('LOW');
  });

  it('resets consecutiveLightCycles to 0', () => {
    const input = makeInput();
    input.adaptiveCycle.consecutiveLightCycles = 12;
    runSchedulingStage(input);
    expect(input.adaptiveCycle.consecutiveLightCycles).toBe(0);
  });

  it('replaces lastPriceCheck with a copy of currentPrices', () => {
    const input = makeInput();
    runSchedulingStage(input);
    expect(input.adaptiveCycle.lastPriceCheck.get('ETH')).toBe(3000);
    expect(input.adaptiveCycle.lastPriceCheck.get('BTC')).toBe(65000);
  });

  it('lastPriceCheck is a new Map (not the same reference as currentPrices)', () => {
    const input = makeInput();
    runSchedulingStage(input);
    expect(input.adaptiveCycle.lastPriceCheck).not.toBe(input.currentPrices);
  });
});

// ─── Emergency mode ───────────────────────────────────────────────────────────

describe('emergency mode', () => {
  it('clears emergencyMode when emergencyUntil is in the past', () => {
    const input = makeInput({
      adaptiveCycle: makeAdaptiveCycle({
        emergencyMode:  true,
        emergencyUntil: Date.now() - 10_000, // expired
      }),
    });
    runSchedulingStage(input);
    expect(input.adaptiveCycle.emergencyMode).toBe(false);
  });

  it('does NOT clear emergencyMode when emergencyUntil is in the future', () => {
    const input = makeInput({
      adaptiveCycle: makeAdaptiveCycle({
        emergencyMode:  true,
        emergencyUntil: Date.now() + 60_000, // still active
      }),
    });
    runSchedulingStage(input);
    expect(input.adaptiveCycle.emergencyMode).toBe(true);
  });

  it('does not touch emergencyMode when it is already false', () => {
    const input = makeInput({ adaptiveCycle: makeAdaptiveCycle({ emergencyMode: false }) });
    runSchedulingStage(input);
    expect(input.adaptiveCycle.emergencyMode).toBe(false);
  });
});

// ─── deps calls ──────────────────────────────────────────────────────────────

describe('deps.computeNextInterval', () => {
  it('is called with currentPrices Map', () => {
    const input = makeInput();
    runSchedulingStage(input);
    expect(input.deps.computeNextInterval).toHaveBeenCalledWith(input.currentPrices);
  });

  it('is called exactly once', () => {
    const input = makeInput();
    runSchedulingStage(input);
    expect(input.deps.computeNextInterval).toHaveBeenCalledTimes(1);
  });
});

describe('deps.updateOpportunityCosts', () => {
  it('is called with a Record built from currentPrices', () => {
    const input = makeInput();
    runSchedulingStage(input);
    expect(input.deps.updateOpportunityCosts).toHaveBeenCalledWith({
      ETH: 3000,
      BTC: 65000,
    });
  });

  it('is called exactly once', () => {
    const input = makeInput();
    runSchedulingStage(input);
    expect(input.deps.updateOpportunityCosts).toHaveBeenCalledTimes(1);
  });
});

// ─── console.log output ──────────────────────────────────────────────────────

describe('console.log output', () => {
  it('logs adaptive interval and reason', () => {
    const input = makeInput();
    runSchedulingStage(input);
    const calls = (console.log as ReturnType<typeof vi.spyOn>).mock.calls;
    const adaptive = calls.find(([m]) => typeof m === 'string' && m.includes('Adaptive'));
    expect(adaptive).toBeDefined();
    expect(adaptive![0]).toContain('60s');
    expect(adaptive![0]).toContain('LOW volatility');
  });

  it('logs price stream status', () => {
    const input = makeInput();
    runSchedulingStage(input);
    const calls = (console.log as ReturnType<typeof vi.spyOn>).mock.calls;
    const stream = calls.find(([m]) => typeof m === 'string' && m.includes('Price stream'));
    expect(stream).toBeDefined();
    expect(stream![0]).toContain('LIVE');  // wsConnected = true
    expect(stream![0]).toContain('STARTER');
  });
});
