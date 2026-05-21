/**
 * NVR-SPEC-036 Phase 1 — `formatMirrorThoughtBlock` tests.
 *
 * Coverage:
 *   1. null / undefined input → empty string (no prompt weight).
 *   2. Missing or whitespace-only observation → empty string.
 *   3. Valid fresh mirror-mode thought → block contains header, mirror name,
 *      observation text, all three list rubrics (anomalies / questions /
 *      posture), and a freshness line tagged with the master age + scale.
 *   4. Stale master snapshot → freshness line says "stale master snapshot".
 *   5. State-only mode → freshness line says "state-only mode".
 *   6. Empty list fields don't get rendered as empty rubrics (clean prompt).
 *   7. List fields are clamped to the documented caps (anomalies 4,
 *      questions 3, posture 4) so a runaway Haiku response can't bloat
 *      the prompt.
 *
 * Pure-function tests — no MirrorAgent / network mocks needed.
 */

import { describe, it, expect } from 'vitest';
import { formatMirrorThoughtBlock } from '../mirror-prompt-block.js';
import type { MirrorThought } from '../mirror-agent.js';

function thought(overrides: Partial<MirrorThought> = {}): MirrorThought {
  return {
    ts: '2026-05-21T18:00:00.000Z',
    botName: 'kathy-howard',
    observation:
      'K&H at 25% USDC reserve, mirrors master fleet caution; AERO position is small relative to master flag.',
    relevantAnomalies: ['AERO weakness flagged by Operator may affect K&H holding'],
    questions: ['Does the smaller AERO position warrant the same trim risk?'],
    proposedPosture: [
      'Hold positions; monitor AERO for confirmation of master flag.',
      'Reserve already at target — no deploy in this window.',
    ],
    master: {
      fetchedAt: '2026-05-21T17:55:00.000Z',
      operatorTs: '2026-05-21T17:55:00.000Z',
      capitalManagerTs: '2026-05-21T17:55:00.000Z',
      coreSleeveTs: '2026-05-21T17:55:00.000Z',
      alphaSleeveTs: '2026-05-21T17:55:00.000Z',
      maxAgeMin: 5,
      stale: false,
    },
    botContext: {
      portfolioValueUSD: 500,
      usdcBalanceUSD: 125,
      usdcReservePct: 0.25,
      positionsCount: 2,
      positionsSymbols: ['ETH', 'AERO'],
      recentTradesCount24h: 4,
      hwm: 540,
    },
    mode: 'mirror',
    modelUsed: 'claude-haiku-4-5-20251001',
    ...overrides,
  };
}

describe('formatMirrorThoughtBlock', () => {
  it('returns empty string when input is null', () => {
    expect(formatMirrorThoughtBlock(null)).toBe('');
  });

  it('returns empty string when input is undefined', () => {
    expect(formatMirrorThoughtBlock(undefined)).toBe('');
  });

  it('returns empty string when observation is missing or whitespace-only', () => {
    const blank = thought({ observation: '   ' });
    expect(formatMirrorThoughtBlock(blank)).toBe('');
    const empty = thought({ observation: '' });
    expect(formatMirrorThoughtBlock(empty)).toBe('');
  });

  it('produces the expected block shape for a fresh mirror-mode thought', () => {
    const block = formatMirrorThoughtBlock(thought());

    expect(block).toContain('═══ MASTER MIRROR THOUGHT ═══');
    expect(block).toContain('Mirror (kathy-howard):');
    expect(block).toContain('K&H at 25% USDC reserve');
    expect(block).toContain('Relevant anomalies: AERO weakness flagged by Operator');
    expect(block).toContain('Questions: Does the smaller AERO position');
    expect(block).toContain('Proposed posture: Hold positions');
    expect(block).toContain('Freshness: master snapshot 5m old');
    expect(block).toContain('scale: $500.00 portfolio @ 25.0% USDC reserve');
    expect(block).toContain('advisory context');
    expect(block).toContain('NOT authoritative');
    // Block must start with leading newline (matches sibling block convention)
    expect(block.startsWith('\n')).toBe(true);
  });

  it('annotates stale master snapshots explicitly', () => {
    const stale = thought({
      master: {
        fetchedAt: '2026-05-21T17:30:00.000Z',
        operatorTs: '2026-05-21T17:15:00.000Z',
        capitalManagerTs: '2026-05-21T17:15:00.000Z',
        coreSleeveTs: '2026-05-21T17:15:00.000Z',
        alphaSleeveTs: '2026-05-21T17:15:00.000Z',
        maxAgeMin: 45,
        stale: true,
      },
    });

    const block = formatMirrorThoughtBlock(stale);

    expect(block).toContain('Freshness: stale master snapshot (45m old)');
  });

  it('flags state-only mode in the freshness line', () => {
    const stateOnly = thought({
      mode: 'stateOnly',
      master: {
        fetchedAt: '2026-05-21T18:00:00.000Z',
        operatorTs: null,
        capitalManagerTs: null,
        coreSleeveTs: null,
        alphaSleeveTs: null,
        maxAgeMin: -1,
        stale: true,
      },
    });

    const block = formatMirrorThoughtBlock(stateOnly);

    expect(block).toContain('state-only mode');
    expect(block).toContain('master fleet unavailable or stale');
  });

  it('does not render rubrics for empty list fields', () => {
    const minimal = thought({
      relevantAnomalies: [],
      questions: [],
      proposedPosture: [],
    });

    const block = formatMirrorThoughtBlock(minimal);

    expect(block).not.toContain('Relevant anomalies:');
    expect(block).not.toContain('Questions:');
    expect(block).not.toContain('Proposed posture:');
    // But observation and freshness must still appear
    expect(block).toContain('Mirror (kathy-howard):');
    expect(block).toContain('Freshness:');
  });

  it('clamps list rubrics so a runaway Haiku response cannot bloat the prompt', () => {
    const noisy = thought({
      relevantAnomalies: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'],
      questions: ['q1', 'q2', 'q3', 'q4', 'q5'],
      proposedPosture: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
    });

    const block = formatMirrorThoughtBlock(noisy);

    // Anomalies clamp at 4
    expect(block).toContain('Relevant anomalies: a1 | a2 | a3 | a4');
    expect(block).not.toContain('a5');
    // Questions clamp at 3
    expect(block).toContain('Questions: q1 | q2 | q3');
    expect(block).not.toContain('q4');
    // Posture clamps at 4
    expect(block).toContain('Proposed posture: p1 | p2 | p3 | p4');
    expect(block).not.toContain('p5');
  });

  it('handles zero portfolio gracefully in the scale annotation', () => {
    const zero = thought({
      botContext: {
        portfolioValueUSD: 0,
        usdcBalanceUSD: 0,
        usdcReservePct: 0,
        positionsCount: 0,
        positionsSymbols: [],
        recentTradesCount24h: 0,
        hwm: 0,
      },
    });

    const block = formatMirrorThoughtBlock(zero);

    expect(block).toContain('scale: $0.00 portfolio @ 0.0% USDC reserve');
  });
});
