/**
 * NVR-SPEC-035 Phase B — prompt block formatter.
 *
 * Pure function that turns the auditor's last report into a terse block of
 * text the heavy-cycle prompt can ingest. SEVERE violations already gate
 * execution via canExecuteAction; this block is specifically for WARN-tier
 * signal that's INFORMATIONAL pressure (INV-5 cohort coverage being the
 * canonical example).
 *
 * Returns empty string when the report is null or has no WARN violations —
 * so the prompt doesn't carry dead weight.
 *
 * Closes the INV-5 forcing-function loop: the bot can't reason about gaps
 * it never sees, but with this block, every heavy cycle puts the missing
 * cohort symbols directly in front of the model's attention.
 *
 * Separated from `system-auditor.ts` to keep the orchestrator side-effect-
 * free and from `agent-v3.2.ts` so it's testable without booting the agent.
 */

import type { AuditReport } from './types.js';

export function formatSystemAuditPromptBlock(report: AuditReport | null): string {
  if (!report) return '';
  const warns = report.violations.filter(v => v.severity === 'WARN');
  if (warns.length === 0) return '';

  const lines: string[] = [];
  for (const v of warns) {
    if (v.invariantId === 'INV-5') {
      const obs = v.observed as {
        covered?: string[];
        dust?: Array<{ symbol: string; usdValue: number }>;
        missing?: string[];
        coveredCount?: number;
        cohortSize?: number;
        minPositionUsd?: number;
      };
      const covered = obs.covered ?? [];
      const dust = obs.dust ?? [];
      const missing = obs.missing ?? [];
      const parts: string[] = [
        `${obs.coveredCount ?? covered.length}/${obs.cohortSize ?? 7} cohort symbols covered (≥$${obs.minPositionUsd ?? 50})`,
      ];
      if (missing.length > 0) parts.push(`MISSING: ${missing.join(', ')}`);
      if (dust.length > 0) {
        parts.push(`dust: ${dust.map(d => `${d.symbol} $${d.usdValue.toFixed(2)}`).join(', ')}`);
      }
      lines.push(`INV-5 cohort coverage — ${parts.join(' | ')}`);
    } else if (v.invariantId === 'INV-6') {
      const obs = v.observed as {
        usdcPct?: number;
        targetPct?: number;
        warnFloorPct?: number;
        usdcBalance?: number;
        targetUsd?: number;
        gapToTargetUsd?: number;
      };
      const usdcPct = obs.usdcPct ?? 0;
      const targetPct = obs.targetPct ?? 25;
      const gap = obs.gapToTargetUsd ?? 0;
      const usdc = obs.usdcBalance ?? 0;
      lines.push(`INV-6 reserve floor — USDC at ${usdcPct.toFixed(1)}% ($${usdc.toFixed(0)}), target ${targetPct.toFixed(0)}%. Gap $${gap.toFixed(0)} to restore the alpha-strike reserve. The 25% USDC reserve is the ONE hardcoded strategy invariant — selling into reserve from an overweight position is the canonical restore move.`);
    } else if (v.invariantId === 'INV-7') {
      const obs = v.observed as {
        silent?: Array<{ id: string; hoursSinceDecision: number; lastDecisionAt: string }>;
        stalenessThresholdHours?: number;
      };
      const silent = obs.silent ?? [];
      const threshold = obs.stalenessThresholdHours ?? 12;
      const names = silent.map(s => `${s.id} ${s.hoursSinceDecision.toFixed(1)}h`).join(', ');
      lines.push(`INV-7 sleeve liveness — ${silent.length} live sleeve(s) silent >${threshold}h: ${names}. A silent live sleeve has stranded its slice of capital behind dead code or a routing bug.`);
    } else {
      // Generic fallback for any other future WARN-tier invariant
      lines.push(`${v.invariantId} ${v.invariantName} — ${v.message}`);
    }
  }

  return `\n═══ SYSTEM AUDIT (WARN) ═══\n${lines.join('\n')}\nThese are strategy-alignment gaps surfaced by NVR-SPEC-035 Phase B. They do not gate execution, but they describe drift between the strategy your config claims and the positions you actually hold. Closing them — by actually buying the named symbols on a real signal — is how the strategy proves it runs.\n`;
}
