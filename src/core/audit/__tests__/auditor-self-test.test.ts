/**
 * INV-9 tests — auditor self-test.
 */

import { describe, it, expect } from 'vitest';
import { auditorSelfTest } from '../invariants/auditor-self-test.js';
import type { AuditReport, InvariantContext } from '../types.js';

function report(cycle: number, durationMs = 5): AuditReport {
  return {
    cycle,
    ranAt: new Date().toISOString(),
    durationMs,
    violations: [],
    blockerActive: false,
    alertMode: 'log-only',
  };
}

function makeCtx(cycle: number, previousReport: AuditReport | null): InvariantContext {
  return {
    balances: [],
    totalPortfolioValue: 3000,
    costBasis: {},
    lastKnownPrices: {},
    capturedPrompt: null,
    cycle,
    previousReport,
  };
}

describe('INV-9 auditor self-test', () => {
  it('returns null on first run (no prior report yet, within grace)', () => {
    expect(auditorSelfTest(makeCtx(1, null))).toBeNull();
  });

  it('fires SEVERE if no previous report after grace cycles', () => {
    const v = auditorSelfTest(makeCtx(5, null));
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('SEVERE');
    expect(v!.invariantId).toBe('INV-9');
    expect(v!.pauseScope).toBe('none');
  });

  it('returns null when previous report matches expected cycle and ran successfully', () => {
    expect(auditorSelfTest(makeCtx(11, report(10, 7)))).toBeNull();
  });

  it('fires SEVERE if previous report was from a skipped cycle', () => {
    const v = auditorSelfTest(makeCtx(15, report(10))); // skipped 4 cycles
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('SEVERE');
    expect((v!.observed as any).previousReportCycle).toBe(10);
  });

  it('fires SEVERE if previous report ran in 0ms (auditor did not actually execute)', () => {
    const v = auditorSelfTest(makeCtx(11, report(10, 0)));
    expect(v).not.toBeNull();
    expect((v!.observed as any).previousReportDurationMs).toBe(0);
  });
});
