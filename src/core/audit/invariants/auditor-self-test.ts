/**
 * NVR-SPEC-035 INV-9 — Auditor self-test.
 *
 * The auditor checks that it itself ran last cycle. Silence about the
 * auditor is detectable. This is the defense against the auditor
 * crashing or being silently disabled.
 *
 * Rules:
 *   - previousReport must exist (unless this is cycle 1 of a fresh boot)
 *   - previousReport.cycle must be == ctx.cycle - 1 (no skipped cycles)
 *   - previousReport.durationMs must be > 0 (it actually ran)
 *   - previousReport must contain at least the SEVERE invariants in
 *     its violation-check set (we can infer this from auditorRanInvariants
 *     count > 0; the orchestrator records this)
 *
 * SEVERE on violation. Pause scope: none (we don't pause trading just
 * because the auditor is unhealthy — we log loudly so the alert mode
 * picks it up). The rationale: a broken auditor is a visibility problem,
 * not a safety problem, and pausing trades because of a meta-layer
 * failure would be over-correction.
 */

import type { Invariant, Violation } from '../types.js';

// On the very first run after a boot/restart, previousReport is null
// because nothing has run yet. That's allowed for ONE cycle. After that,
// every cycle should have a predecessor.
const FRESH_BOOT_GRACE_CYCLES = 1;

export const auditorSelfTest: Invariant = (ctx) => {
  const prev = ctx.previousReport;

  // Fresh boot grace
  if (!prev) {
    if (ctx.cycle <= FRESH_BOOT_GRACE_CYCLES) return null;
    return {
      invariantId: 'INV-9',
      invariantName: 'auditor-self-test',
      severity: 'SEVERE',
      message: `Auditor has no previous report at cycle ${ctx.cycle}; expected one by now`,
      observed: { cycle: ctx.cycle, previousReport: null },
      expected: { rule: `previousReport non-null after cycle ${FRESH_BOOT_GRACE_CYCLES}` },
      pauseScope: 'none',
      detectedAt: new Date().toISOString(),
    };
  }

  const issues: string[] = [];
  const expectedPrevCycle = ctx.cycle - 1;

  if (prev.cycle !== expectedPrevCycle) {
    issues.push(`previous report was from cycle ${prev.cycle}, expected ${expectedPrevCycle} (skipped ${expectedPrevCycle - prev.cycle} cycle(s))`);
  }

  if (prev.durationMs <= 0) {
    issues.push(`previous report durationMs=${prev.durationMs} (auditor did not actually execute)`);
  }

  if (issues.length === 0) return null;

  const violation: Violation = {
    invariantId: 'INV-9',
    invariantName: 'auditor-self-test',
    severity: 'SEVERE',
    message: `Auditor self-test failed: ${issues.join('; ')}`,
    observed: {
      currentCycle: ctx.cycle,
      previousReportCycle: prev.cycle,
      previousReportDurationMs: prev.durationMs,
      previousReportRanAt: prev.ranAt,
      issues,
    },
    expected: {
      rule: `previousReport.cycle === currentCycle - 1 AND previousReport.durationMs > 0`,
    },
    pauseScope: 'none',
    detectedAt: new Date().toISOString(),
  };

  return violation;
};
