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
    } else {
      // Generic fallback for any other future WARN-tier invariant
      lines.push(`${v.invariantId} ${v.invariantName} — ${v.message}`);
    }
  }

  return `\n═══ SYSTEM AUDIT (WARN) ═══\n${lines.join('\n')}\nThese are strategy-alignment gaps surfaced by NVR-SPEC-035 Phase B. They do not gate execution, but they describe drift between the strategy your config claims and the positions you actually hold. Closing them — by actually buying the named symbols on a real signal — is how the strategy proves it runs.\n`;
}
