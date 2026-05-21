/**
 * INV-8 tests — cycle-vs-trade ratio (Phase B, WARN tier).
 *
 * Catches the "bot is running but not trading" failure mode. Skips
 * during the boot grace window (cycle <= 8) and when tradesSinceRestart
 * is undefined (caller didn't populate this cycle).
 */

import { describe, it, expect } from 'vitest';
import { cycleTradeRatio } from '../invariants/cycle-trade-ratio.js';
import type { InvariantContext } from '../types.js';

function makeCtx(overrides: Partial<InvariantContext> = {}): InvariantContext {
  return {
    balances: [],
    totalPortfolioValue: 3000,
    costBasis: {},
    lastKnownPrices: {},
    capturedPrompt: null,
    cycle: 100,
    previousReport: null,
    auditorCyclesRun: 5,
    liveOnChainSnapshot: null,
    chainDepositHistory: null,
    botTotalDeposited: null,
    ...overrides,
  };
}

describe('INV-8 — gating', () => {
  it('returns null when tradesSinceRestart is undefined (caller did not populate)', () => {
    expect(cycleTradeRatio(makeCtx({ cycle: 100 }))).toBeNull();
  });

  it('returns null inside the boot grace window (cycle <= 8) even with zero trades', () => {
    expect(cycleTradeRatio(makeCtx({ cycle: 1, tradesSinceRestart: 0 }))).toBeNull();
    expect(cycleTradeRatio(makeCtx({ cycle: 8, tradesSinceRestart: 0 }))).toBeNull();
  });

  it('returns null when at least one trade has fired since restart', () => {
    expect(cycleTradeRatio(makeCtx({ cycle: 200, tradesSinceRestart: 1 }))).toBeNull();
    expect(cycleTradeRatio(makeCtx({ cycle: 200, tradesSinceRestart: 25 }))).toBeNull();
  });
});

describe('INV-8 — fires WARN on silent bots past the grace window', () => {
  it('fires at cycle 9 (just past the boot grace) with 0 trades', () => {
    const v = cycleTradeRatio(makeCtx({ cycle: 9, tradesSinceRestart: 0 }));
    expect(v).not.toBeNull();
    expect(v!.invariantId).toBe('INV-8');
    expect(v!.severity).toBe('WARN');
    expect(v!.pauseScope).toBe('none');
    const obs = v!.observed as any;
    expect(obs.cycle).toBe(9);
    expect(obs.tradesSinceRestart).toBe(0);
    expect(obs.bootGraceCycles).toBe(8);
  });

  it('fires with the case-study magnitude (4h+ silent, ~16 cycles)', () => {
    const v = cycleTradeRatio(makeCtx({ cycle: 16, tradesSinceRestart: 0 }));
    expect(v).not.toBeNull();
    const obs = v!.observed as any;
    // 16 cycles × 0.25h/cycle = 4h
    expect(obs.approxHoursSilent).toBeCloseTo(4, 1);
    expect(v!.message).toMatch(/16 heavy cycles/);
    expect(v!.message).toMatch(/zero trades executed/);
  });

  it('fires hard at 48h silent (~192 cycles)', () => {
    const v = cycleTradeRatio(makeCtx({ cycle: 192, tradesSinceRestart: 0 }));
    expect(v).not.toBeNull();
    const obs = v!.observed as any;
    expect(obs.approxHoursSilent).toBeCloseTo(48, 1);
  });
});

describe('INV-8 — observed payload shape', () => {
  it('emits the fields the prompt-block formatter consumes', () => {
    const v = cycleTradeRatio(makeCtx({ cycle: 50, tradesSinceRestart: 0 }));
    expect(v).not.toBeNull();
    const obs = v!.observed as any;
    expect(typeof obs.cycle).toBe('number');
    expect(typeof obs.tradesSinceRestart).toBe('number');
    expect(typeof obs.bootGraceCycles).toBe('number');
    expect(typeof obs.approxHoursSilent).toBe('number');
  });
});
