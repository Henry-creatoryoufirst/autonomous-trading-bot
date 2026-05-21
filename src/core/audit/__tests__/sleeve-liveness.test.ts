/**
 * INV-7 tests — sleeve liveness (Phase B, WARN tier).
 *
 * Would have caught the May-19 Alpha Hunter 40h silence pre-PR #30.
 * Threshold = 12 hours; skips paper sleeves and never-decided sleeves.
 */

import { describe, it, expect } from 'vitest';
import { sleeveLiveness } from '../invariants/sleeve-liveness.js';
import type { InvariantContext } from '../types.js';

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

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

describe('INV-7 — gating', () => {
  it('returns null when sleeveLiveness is undefined (caller did not populate)', () => {
    expect(sleeveLiveness(makeCtx())).toBeNull();
  });

  it('returns null when sleeveLiveness is empty', () => {
    expect(sleeveLiveness(makeCtx({ sleeveLiveness: [] }))).toBeNull();
  });
});

describe('INV-7 — skip conditions', () => {
  it('skips paper-mode sleeves (legitimately dormant by design)', () => {
    const ctx = makeCtx({
      sleeveLiveness: [
        { id: 'alpha-rotation', mode: 'paper', lastDecisionAt: hoursAgo(48), decisionsCount: 0 },
      ],
    });
    expect(sleeveLiveness(ctx)).toBeNull();
  });

  it('skips sleeves that have never decided (lastDecisionAt = null, warmup)', () => {
    const ctx = makeCtx({
      sleeveLiveness: [
        { id: 'fresh-sleeve', mode: 'live', lastDecisionAt: null, decisionsCount: 0 },
      ],
    });
    expect(sleeveLiveness(ctx)).toBeNull();
  });

  it('skips sleeves with malformed lastDecisionAt', () => {
    const ctx = makeCtx({
      sleeveLiveness: [
        { id: 'bad-sleeve', mode: 'live', lastDecisionAt: 'not-a-date', decisionsCount: 5 },
      ],
    });
    expect(sleeveLiveness(ctx)).toBeNull();
  });
});

describe('INV-7 — happy path (live sleeve fresh)', () => {
  it("returns null when every live sleeve decided in the last cycle (today's healthy state)", () => {
    const ctx = makeCtx({
      sleeveLiveness: [
        { id: 'core',          mode: 'live',  lastDecisionAt: hoursAgo(7.6), decisionsCount: 171 }, // Henry's bot today
        { id: 'alpha-hunter',  mode: 'live',  lastDecisionAt: hoursAgo(0.1), decisionsCount: 102 },
        { id: 'alpha-rotation', mode: 'paper', lastDecisionAt: hoursAgo(0.1), decisionsCount: 102 },
      ],
    });
    expect(sleeveLiveness(ctx)).toBeNull();
  });

  it('returns null exactly at the 12h boundary', () => {
    const ctx = makeCtx({
      sleeveLiveness: [
        { id: 'core', mode: 'live', lastDecisionAt: hoursAgo(12), decisionsCount: 10 },
      ],
    });
    expect(sleeveLiveness(ctx)).toBeNull();
  });
});

describe('INV-7 — fires WARN on silent live sleeves', () => {
  it("fires on the May-19 case study (Alpha Hunter 40h silent)", () => {
    const ctx = makeCtx({
      sleeveLiveness: [
        { id: 'core',         mode: 'live', lastDecisionAt: hoursAgo(2),  decisionsCount: 100 },
        { id: 'alpha-hunter', mode: 'live', lastDecisionAt: hoursAgo(40), decisionsCount: 60 }, // dark for 40h
      ],
    });
    const v = sleeveLiveness(ctx);
    expect(v).not.toBeNull();
    expect(v!.invariantId).toBe('INV-7');
    expect(v!.severity).toBe('WARN');
    expect(v!.pauseScope).toBe('none');
    const obs = v!.observed as any;
    expect(obs.silent).toHaveLength(1);
    expect(obs.silent[0].id).toBe('alpha-hunter');
    expect(obs.silent[0].hoursSinceDecision).toBeCloseTo(40, 0);
    expect(v!.message).toMatch(/alpha-hunter/);
    expect(v!.message).toMatch(/silent >12h/);
  });

  it('names all silent sleeves when multiple are dark', () => {
    const ctx = makeCtx({
      sleeveLiveness: [
        { id: 'core',         mode: 'live', lastDecisionAt: hoursAgo(15), decisionsCount: 50 },
        { id: 'alpha-hunter', mode: 'live', lastDecisionAt: hoursAgo(20), decisionsCount: 30 },
        { id: 'alpha-rot',    mode: 'live', lastDecisionAt: hoursAgo(0.1), decisionsCount: 100 }, // fine
      ],
    });
    const v = sleeveLiveness(ctx);
    expect(v).not.toBeNull();
    const obs = v!.observed as any;
    expect(obs.silent).toHaveLength(2);
    // Sorted by staleness — oldest first
    expect(obs.silent[0].id).toBe('alpha-hunter');
    expect(obs.silent[1].id).toBe('core');
  });

  it('counts only LIVE sleeves toward totalLiveSleeves (not paper)', () => {
    const ctx = makeCtx({
      sleeveLiveness: [
        { id: 'core',         mode: 'live',  lastDecisionAt: hoursAgo(20), decisionsCount: 5 },
        { id: 'alpha-paper',  mode: 'paper', lastDecisionAt: hoursAgo(20), decisionsCount: 5 },
      ],
    });
    const v = sleeveLiveness(ctx);
    expect(v).not.toBeNull();
    const obs = v!.observed as any;
    expect(obs.totalLiveSleeves).toBe(1);
    expect(obs.silent).toHaveLength(1);
  });
});

describe('INV-7 — observed payload shape', () => {
  it('emits fields the prompt-block formatter consumes', () => {
    const ctx = makeCtx({
      sleeveLiveness: [
        { id: 'alpha-hunter', mode: 'live', lastDecisionAt: hoursAgo(20), decisionsCount: 10 },
      ],
    });
    const v = sleeveLiveness(ctx);
    expect(v).not.toBeNull();
    const obs = v!.observed as any;
    expect(obs.silent[0]).toMatchObject({
      id: expect.any(String),
      lastDecisionAt: expect.any(String),
      hoursSinceDecision: expect.any(Number),
      decisionsCount: expect.any(Number),
    });
    expect(obs.stalenessThresholdHours).toBe(12);
  });
});
