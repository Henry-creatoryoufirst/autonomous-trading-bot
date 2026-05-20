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

function makeCtx(
  cycle: number,
  previousReport: AuditReport | null,
  auditorCyclesRun = 0,
): InvariantContext {
  return {
    balances: [],
    totalPortfolioValue: 3000,
    costBasis: {},
    lastKnownPrices: {},
    capturedPrompt: null,
    cycle,
    previousReport,
    auditorCyclesRun,
    liveOnChainSnapshot: null,
  };
}

describe('INV-9 auditor self-test', () => {
  it('returns null on the auditor\'s genuinely-first run (auditorCyclesRun=0, no prev)', () => {
    // Bot may be at any cycle (totalCycles persists across restarts); what
    // matters is that the AUDITOR itself hasn\'t completed a cycle yet.
    expect(auditorSelfTest(makeCtx(1, null, 0))).toBeNull();
    expect(auditorSelfTest(makeCtx(5000, null, 0))).toBeNull(); // high bot-cycle on fresh deploy
  });

  it('fires SEVERE if previousReport is null but the auditor has run before (state corruption)', () => {
    const v = auditorSelfTest(makeCtx(5, null, 3)); // ran 3 times but no prev report
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('SEVERE');
    expect(v!.invariantId).toBe('INV-9');
    expect(v!.pauseScope).toBe('none');
    expect((v!.observed as any).auditorCyclesRun).toBe(3);
  });

  it('returns null when previous report matches expected cycle and ran successfully', () => {
    expect(auditorSelfTest(makeCtx(11, report(10, 7), 1))).toBeNull();
  });

  it('fires SEVERE if previous report was from a skipped cycle', () => {
    const v = auditorSelfTest(makeCtx(15, report(10), 1)); // skipped 4 cycles
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('SEVERE');
    expect((v!.observed as any).previousReportCycle).toBe(10);
  });

  it('fires SEVERE if previous report ran in 0ms (auditor did not actually execute)', () => {
    const v = auditorSelfTest(makeCtx(11, report(10, 0), 1));
    expect(v).not.toBeNull();
    expect((v!.observed as any).previousReportDurationMs).toBe(0);
  });
});
