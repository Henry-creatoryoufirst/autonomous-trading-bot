/**
 * NVR-SPEC-035 INV-9 — Auditor self-test.
 *
 * The auditor checks that it itself ran last cycle. Silence about the
 * auditor is detectable. This is the defense against the auditor
 * crashing or being silently disabled.
 *
 * Rules:
 *   - previousReport must exist (unless this is the auditor's own first
 *     ever cycle on this process — `auditorCyclesRun === 0`)
 *   - previousReport.cycle must be == ctx.cycle - 1 (no skipped cycles)
 *   - previousReport.durationMs must be > 0 (it actually ran)
 *
 * SEVERE on violation. Pause scope: none (we don't pause trading just
 * because the auditor is unhealthy — we log loudly so the alert mode
 * picks it up). The rationale: a broken auditor is a visibility problem,
 * not a safety problem, and pausing trades because of a meta-layer
 * failure would be over-correction.
 *
 * 2026-05-19 polish: fresh-boot grace now uses the auditor's own
 * `auditorCyclesRun` counter instead of the bot's `state.totalCycles`.
 * On a fresh Railway deploy the bot's totalCycles is whatever was
 * persisted (high), but the auditor's own counter is 0 — that's the
 * only reliable signal that the auditor itself is on its first ever
 * cycle. Previous logic produced spurious SEVERE on first cycle after
 * every redeploy.
 */

import type { Invariant, Violation } from '../types.js';

export const auditorSelfTest: Invariant = (ctx) => {
  const prev = ctx.previousReport;

  if (!prev) {
    // Genuine first run? Grace.
    if (ctx.auditorCyclesRun === 0) return null;
    // No previous report but the auditor claims to have run before — that
    // means the report file got corrupted or wiped mid-run. Real signal.
    return {
      invariantId: 'INV-9',
      invariantName: 'auditor-self-test',
      severity: 'SEVERE',
      message: `Auditor has run ${ctx.auditorCyclesRun} cycle(s) before but previousReport is null — persisted state may have been wiped or corrupted`,
      observed: { auditorCyclesRun: ctx.auditorCyclesRun, botCycle: ctx.cycle, previousReport: null },
      expected: { rule: 'previousReport non-null when auditorCyclesRun > 0' },
      pauseScope: 'none',
      detectedAt: new Date().toISOString(),
    };
  }

  // 2026-05-22 polish: cycle-counter-reset suppression. When the bot
  // restarts, `state.totalCycles` resets to a low number (1, 2, ...) — but
  // the auditor's persisted `previousReport.cycle` carries forward the high
  // pre-restart value. Pre-fix, INV-9 would read "previous was 120, current
  // is 11 → skipped -109 cycles" and fire SEVERE. False positive.
  //
  // Interpret `ctx.cycle < prev.cycle` as a bot restart (cycle counter
  // went BACKWARD, which is otherwise impossible). Return null — don't
  // fire on what is really a deploy-time baseline reset. We do NOT reset
  // the auditor's own `auditorCyclesRun` counter here (that's tracked
  // separately by the orchestrator); we only suppress the negative-delta
  // case so a restart doesn't produce a spurious SEVERE that gates buys.
  if (ctx.cycle < prev.cycle) return null;

  const issues: string[] = [];

  // The bot's cycle counter (state.totalCycles) is what we expect to
  // advance by exactly 1 between auditor runs. The auditor's own counter
  // tracks its own runs, but the bot may cycle without the auditor running
  // (e.g., auditor disabled mid-day) — so we compare bot-cycles instead.
  const expectedPrevCycle = ctx.cycle - 1;
  if (prev.cycle !== expectedPrevCycle) {
    issues.push(`previous report was from bot-cycle ${prev.cycle}, expected ${expectedPrevCycle} (skipped ${expectedPrevCycle - prev.cycle} cycle(s))`);
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
      currentBotCycle: ctx.cycle,
      auditorCyclesRun: ctx.auditorCyclesRun,
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
