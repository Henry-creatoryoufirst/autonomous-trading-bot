/**
 * INV-4 tests — observation-consumer contract (Phase B, WARN tier).
 *
 * The forcing function: WARN whenever the external observation feed
 * drifts off-shape so the producer (stc-website auto-investigation,
 * alpha-watcher, etc.) can't ship a regression and have it go unnoticed.
 */

import { describe, it, expect } from 'vitest';
import { observationConsumer } from '../invariants/observation-consumer.js';
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

describe('INV-4 — gating (silent when no observations to grade)', () => {
  it('returns null when observations is undefined (caller did not populate)', () => {
    expect(observationConsumer(makeCtx())).toBeNull();
  });

  it('returns null when observations is empty', () => {
    expect(observationConsumer(makeCtx({ observations: [] }))).toBeNull();
  });
});

describe('INV-4 — happy path (well-formed observations)', () => {
  it('returns null when every record is valid and non-empty', () => {
    const ctx = makeCtx({
      observations: [
        { source: 'stc-website', observation: 'BTC dominance hit 58%', receivedAt: new Date().toISOString(), schemaValid: true },
        { source: 'alpha-watcher', observation: 'cbBTC volume spike +2.5x', receivedAt: new Date().toISOString(), schemaValid: true },
      ],
    });
    expect(observationConsumer(ctx)).toBeNull();
  });

  it('returns null when minority (≤50%) have empty content but all are schema-valid', () => {
    const ctx = makeCtx({
      observations: [
        { source: 'stc-website', observation: 'good finding', receivedAt: new Date().toISOString(), schemaValid: true },
        { source: 'stc-website', observation: '', receivedAt: new Date().toISOString(), schemaValid: true },
      ],
    });
    // exactly 50% empty — does NOT trip the strict >50% threshold
    expect(observationConsumer(ctx)).toBeNull();
  });
});

describe('INV-4 — fires WARN on schema-invalid records', () => {
  it('fires when any record has schemaValid=false (single offender)', () => {
    const ctx = makeCtx({
      observations: [
        { source: 'stc-website', observation: 'good', receivedAt: 't1', schemaValid: true },
        { source: 'stc-website', observation: 'broken payload', receivedAt: 't2', schemaValid: false },
      ],
    });
    const v = observationConsumer(ctx);
    expect(v).not.toBeNull();
    expect(v!.invariantId).toBe('INV-4');
    expect(v!.severity).toBe('WARN');
    expect(v!.pauseScope).toBe('none');
    const obs = v!.observed as any;
    expect(obs.invalidCount).toBe(1);
    expect(obs.totalObservations).toBe(2);
    const perSource = obs.perSource as any[];
    expect(perSource[0].source).toBe('stc-website');
    expect(perSource[0].invalid).toBe(1);
  });

  it('names every offending source in the per-source breakdown', () => {
    const ctx = makeCtx({
      observations: [
        { source: 'stc-website', observation: 'good', receivedAt: 't1', schemaValid: true },
        { source: 'alpha-watcher', observation: 'malformed', receivedAt: 't2', schemaValid: false },
        { source: 'research-lab', observation: 'also malformed', receivedAt: 't3', schemaValid: false },
      ],
    });
    const v = observationConsumer(ctx);
    expect(v).not.toBeNull();
    const obs = v!.observed as any;
    expect(obs.invalidCount).toBe(2);
    const sources = (obs.perSource as any[]).map(s => s.source);
    expect(sources).toContain('alpha-watcher');
    expect(sources).toContain('research-lab');
  });
});

describe('INV-4 — fires WARN on >50% empty content', () => {
  it('fires when 2 of 3 records have empty observation strings', () => {
    const ctx = makeCtx({
      observations: [
        { source: 'stc-website', observation: 'good', receivedAt: 't1', schemaValid: true },
        { source: 'stc-website', observation: '', receivedAt: 't2', schemaValid: true },
        { source: 'stc-website', observation: '   ', receivedAt: 't3', schemaValid: true }, // whitespace-only treated as empty
      ],
    });
    const v = observationConsumer(ctx);
    expect(v).not.toBeNull();
    const obs = v!.observed as any;
    expect(obs.emptyCount).toBe(2);
    expect(obs.emptyRatio).toBeCloseTo(66.67, 1);
  });

  it('fires when null content is the majority', () => {
    const ctx = makeCtx({
      observations: [
        { source: 'stc-website', observation: null, receivedAt: 't1', schemaValid: true },
        { source: 'stc-website', observation: null, receivedAt: 't2', schemaValid: true },
        { source: 'stc-website', observation: 'one good finding', receivedAt: 't3', schemaValid: true },
      ],
    });
    const v = observationConsumer(ctx);
    expect(v).not.toBeNull();
    const obs = v!.observed as any;
    expect(obs.emptyCount).toBe(2);
  });

  it('does not fire when 50% empty (strict >50% threshold)', () => {
    const ctx = makeCtx({
      observations: [
        { source: 's', observation: 'good', receivedAt: 't1', schemaValid: true },
        { source: 's', observation: '', receivedAt: 't2', schemaValid: true },
      ],
    });
    expect(observationConsumer(ctx)).toBeNull();
  });
});

describe('INV-4 — combined failure modes', () => {
  it('counts a record both invalid AND empty separately in observed payload', () => {
    const ctx = makeCtx({
      observations: [
        { source: 'stc-website', observation: null, receivedAt: 't1', schemaValid: false },
        { source: 'stc-website', observation: null, receivedAt: 't2', schemaValid: true },
        { source: 'stc-website', observation: 'real', receivedAt: 't3', schemaValid: true },
      ],
    });
    const v = observationConsumer(ctx);
    expect(v).not.toBeNull();
    const obs = v!.observed as any;
    expect(obs.invalidCount).toBe(1);
    expect(obs.emptyCount).toBe(2);
    const perSource = obs.perSource as any[];
    expect(perSource[0]).toMatchObject({ source: 'stc-website', total: 3, invalid: 1, empty: 2 });
  });
});

describe('INV-4 — observed payload shape', () => {
  it('emits the fields the prompt-block formatter consumes', () => {
    const ctx = makeCtx({
      observations: [
        { source: 'stc-website', observation: null, receivedAt: 't1', schemaValid: false },
      ],
    });
    const v = observationConsumer(ctx);
    expect(v).not.toBeNull();
    const obs = v!.observed as any;
    expect(typeof obs.totalObservations).toBe('number');
    expect(typeof obs.invalidCount).toBe('number');
    expect(typeof obs.emptyCount).toBe('number');
    expect(typeof obs.emptyRatio).toBe('number');
    expect(Array.isArray(obs.perSource)).toBe(true);
  });
});
