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
 *   - previousReport.cycle should be == ctx.cycle - 1 (consecutive cycles)
 *   - A single-cycle skip (cycle - prev.cycle === 2) is TOLERATED — the
 *     persistence write may race, or the bot may have done a routine
 *     non-auditor cycle. Below the SEVERE/WARN noise threshold.
 *   - >1 skipped cycle is suspicious enough to surface as WARN
 *   - previousReport.durationMs must be > 0 (it actually ran)
 *
 * Severity: WARN (downgraded from SEVERE 2026-05-22). The auditor
 * self-test detecting a missed cycle is INFORMATIONAL — a broken auditor
 * is a visibility problem, not a safety problem. Previously the SEVERE
 * tier polluted blocker state (master fleet logged 156/213 cycles with
 * INV-9 as currentBlocker — 73% false-positive rate). WARN-tier means
 * pauseScope='none' and the violation surfaces via the prompt-block
 * formatter's generic fallback instead of gating execution.
 *
 * 2026-05-19 polish: fresh-boot grace uses the auditor's own
 * `auditorCyclesRun` counter instead of the bot's `state.totalCycles`.
 * On a fresh Railway deploy the bot's totalCycles is whatever was
 * persisted (high), but the auditor's own counter is 0 — that's the
 * only reliable signal that the auditor itself is on its first ever
 * cycle. Previous logic produced spurious SEVERE on first cycle after
 * every redeploy.
 *
 * 2026-05-22 polish A: ±1 cycle-skip tolerance. Persistence races and
 * routine non-auditor cycles both produce a one-cycle skip — neither is
 * a real failure. Only skips of MORE than 1 cycle surface as WARN.
 *
 * 2026-05-22 polish B: SEVERE → WARN tier downgrade for all non-warmup
 * INV-9 firings. The previously SEVERE-with-pauseScope='next-llm' state
 * corruption case stays at WARN. Restart suppression (ctx.cycle <
 * prev.cycle from PR #43) is unchanged.
 */

import type { Invariant, Violation } from '../types.js';

export const auditorSelfTest: Invariant = (ctx) => {
  const prev = ctx.previousReport;

  if (!prev) {
    // Genuine first run? Grace.
    if (ctx.auditorCyclesRun === 0) return null;
    // No previous report but the auditor claims to have run before — that
    // means the report file got corrupted or wiped mid-run. Real signal,
    // but downgraded to WARN per the 2026-05-22 noise-reduction pass — a
    // missing-prev-report is a visibility problem, not a safety one.
    return {
      invariantId: 'INV-9',
      invariantName: 'auditor-self-test',
      severity: 'WARN',
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

  // 2026-05-22 polish: ±1 cycle-skip tolerance. The previous strict
  // `prev.cycle === ctx.cycle - 1` check fired SEVERE on every persistence
  // race and every routine non-auditor cycle — master logged 156 INV-9
  // firings across 213 cycles (73% false-positive rate). Production
  // workloads naturally produce single-cycle skips; only multi-cycle
  // skips are signal.
  const cycleDelta = ctx.cycle - prev.cycle;
  const issues: string[] = [];

  // delta === 1 → consecutive cycles, all good
  // delta === 2 → ONE cycle skipped, tolerable noise
  // delta  >= 3 → MORE than one skipped, suspicious — surface as WARN
  if (cycleDelta > 2) {
    const skipped = cycleDelta - 1;
    issues.push(`previous report was from bot-cycle ${prev.cycle}, expected ${ctx.cycle - 1} (skipped ${skipped} cycle(s))`);
  }

  if (prev.durationMs <= 0) {
    issues.push(`previous report durationMs=${prev.durationMs} (auditor did not actually execute)`);
  }

  if (issues.length === 0) return null;

  const violation: Violation = {
    invariantId: 'INV-9',
    invariantName: 'auditor-self-test',
    severity: 'WARN',
    message: `Auditor self-test: ${issues.join('; ')}`,
    observed: {
      currentBotCycle: ctx.cycle,
      auditorCyclesRun: ctx.auditorCyclesRun,
      previousReportCycle: prev.cycle,
      previousReportDurationMs: prev.durationMs,
      previousReportRanAt: prev.ranAt,
      cycleDelta,
      issues,
    },
    expected: {
      rule: `previousReport.cycle within 1 of (currentCycle - 1) AND previousReport.durationMs > 0`,
    },
    pauseScope: 'none',
    detectedAt: new Date().toISOString(),
  };

  return violation;
};
