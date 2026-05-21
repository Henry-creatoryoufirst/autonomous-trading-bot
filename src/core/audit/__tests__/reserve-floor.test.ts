/**
 * INV-6 tests — reserve floor (Phase B, WARN tier).
 *
 * The 25% USDC reserve is the ONE hardcoded strategy invariant (per
 * project_nvr_strategy_shape). INV-6 turns that documented rule into a
 * structural cycle-by-cycle check, with a 5pp tolerance band so legit
 * mid-deployment dips don't fire on noise.
 */

import { describe, it, expect } from 'vitest';
import { reserveFloor } from '../invariants/reserve-floor.js';
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

describe('INV-6 — gating', () => {
  it('returns null when portfolio is below the $500 skip threshold', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 400,
      balances: [{ symbol: 'USDC', balance: 0, usdValue: 0 }],
    });
    expect(reserveFloor(ctx)).toBeNull();
  });
});

describe('INV-6 — happy path (reserve at or above floor)', () => {
  it('returns null when reserve is exactly at the 25% target', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 1000,
      balances: [{ symbol: 'USDC', balance: 250, usdValue: 250 }],
    });
    expect(reserveFloor(ctx)).toBeNull();
  });

  it('returns null when reserve is in the 20-25% tolerance band', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 1000,
      balances: [{ symbol: 'USDC', balance: 210, usdValue: 210 }], // 21%
    });
    expect(reserveFloor(ctx)).toBeNull();
  });

  it('returns null when reserve is well above target', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [{ symbol: 'USDC', balance: 1100, usdValue: 1100 }], // 36.7%, like Henry's bot today
    });
    expect(reserveFloor(ctx)).toBeNull();
  });
});

describe('INV-6 — fires WARN when reserve drops below 20% floor', () => {
  it('fires when reserve is at 18% (just below floor)', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 1000,
      balances: [{ symbol: 'USDC', balance: 180, usdValue: 180 }],
    });
    const v = reserveFloor(ctx);
    expect(v).not.toBeNull();
    expect(v!.invariantId).toBe('INV-6');
    expect(v!.severity).toBe('WARN');
    expect(v!.pauseScope).toBe('none');
    const obs = v!.observed as any;
    expect(obs.usdcBalance).toBe(180);
    expect(obs.usdcPct).toBeCloseTo(18, 1);
    expect(obs.targetPct).toBe(25);
    expect(obs.gapToTargetUsd).toBeCloseTo(70, 0);
  });

  it('fires hard when reserve is at 5% (capital severely deployed)', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'USDC', balance: 150, usdValue: 150 },
        { symbol: 'WETH', balance: 1, usdValue: 2850 },
      ],
    });
    const v = reserveFloor(ctx);
    expect(v).not.toBeNull();
    const obs = v!.observed as any;
    expect(obs.usdcPct).toBeCloseTo(5, 1);
    expect(obs.gapToTargetUsd).toBeCloseTo(600, 0);
    expect(v!.message).toMatch(/5\.0% .* below the 20% warning floor/);
  });

  it('fires when USDC is completely absent', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 2000,
      balances: [{ symbol: 'WETH', balance: 1, usdValue: 2000 }],
    });
    const v = reserveFloor(ctx);
    expect(v).not.toBeNull();
    const obs = v!.observed as any;
    expect(obs.usdcBalance).toBe(0);
    expect(obs.usdcPct).toBe(0);
  });
});

describe('INV-6 — defensive aggregation', () => {
  it('sums multiple USDC entries (defensive against accidental duplicates)', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 1000,
      balances: [
        { symbol: 'USDC', balance: 100, usdValue: 100 },
        { symbol: 'USDC', balance: 150, usdValue: 150 }, // accidental duplicate
        { symbol: 'WETH', balance: 1, usdValue: 750 },
      ],
    });
    // 250 / 1000 = 25% — exactly at target, above 20% floor → no fire
    expect(reserveFloor(ctx)).toBeNull();
  });
});

describe('INV-6 — observed payload shape', () => {
  it('emits all the fields the prompt-block formatter consumes', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 2000,
      balances: [{ symbol: 'USDC', balance: 100, usdValue: 100 }],
    });
    const v = reserveFloor(ctx);
    expect(v).not.toBeNull();
    const obs = v!.observed as any;
    expect(typeof obs.usdcBalance).toBe('number');
    expect(typeof obs.usdcPct).toBe('number');
    expect(typeof obs.targetPct).toBe('number');
    expect(typeof obs.warnFloorPct).toBe('number');
    expect(typeof obs.targetUsd).toBe('number');
    expect(typeof obs.gapToTargetUsd).toBe('number');
    expect(typeof obs.gapToFloorUsd).toBe('number');
    expect(typeof obs.portfolioValue).toBe('number');
  });
});
