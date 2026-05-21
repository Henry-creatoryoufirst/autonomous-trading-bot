/**
 * NVR-SPEC-036 Phase 1 — MirrorAgent prompt block formatter.
 *
 * Pure function that converts a `MirrorThought` (produced by
 * `MirrorAgent.runMirrorTick()`) into a terse text block that the heavy-
 * cycle prompt of a SUBSCRIBER family bot can ingest.
 *
 * Design parity with the sibling blocks (`formatOutcomePromptBlock`,
 * `formatSystemAuditPromptBlock`):
 *   - Returns the empty string when the input is null, when the mirror is
 *     disabled, or when the thought is missing its `observation`. Heavy-
 *     cycle prompt should never carry dead weight.
 *   - Annotates stale master fleet thoughts explicitly so the model can
 *     down-weight the translation rather than treating it as fresh signal.
 *   - Surfaces THIS bot's scale (portfolio value + USDC reserve %) so the
 *     model can read the mirror as "what the master said, sized for me"
 *     rather than blindly mirroring master trades.
 *
 * Kept out of `mirror-agent.ts` so the agent stays a thin runtime adapter
 * and out of `agent-v3.2.ts` so the formatting is unit-testable without
 * booting the bot. This matches the pattern used for SPEC-035 Phase B
 * (`src/core/audit/prompt-block.ts`).
 */

import type { MirrorThought } from './mirror-agent.js';

/**
 * Build the `═══ MASTER MIRROR THOUGHT ═══` prompt block.
 *
 * Returns the empty string when:
 *   - The input thought is null / undefined.
 *   - The thought has no `observation` field (or it's whitespace-only).
 *
 * For non-empty input, the block follows the visual grammar of the
 * ALPHA LEDGER and SYSTEM AUDIT (WARN) blocks: a one-line header, the
 * mirror's local interpretation, optional anomalies / questions /
 * posture lines, and a closing line that names the master freshness +
 * the subscriber bot's scale + the read-only contract.
 */
export function formatMirrorThoughtBlock(thought: MirrorThought | null | undefined): string {
  if (!thought) return '';
  const observation = (thought.observation ?? '').trim();
  if (!observation) return '';

  const lines: string[] = [];

  // First line — the mirror's translated observation, prefixed with the bot
  // name so multi-bot log dumps stay legible if this block ever gets logged.
  lines.push(`Mirror (${thought.botName}): ${observation}`);

  // Anomalies the master flagged that DO touch THIS bot's holdings — the
  // mirror's own filter, not the master's raw list.
  if (Array.isArray(thought.relevantAnomalies) && thought.relevantAnomalies.length > 0) {
    lines.push(`Relevant anomalies: ${thought.relevantAnomalies.slice(0, 4).join(' | ')}`);
  }
  if (Array.isArray(thought.questions) && thought.questions.length > 0) {
    lines.push(`Questions: ${thought.questions.slice(0, 3).join(' | ')}`);
  }
  if (Array.isArray(thought.proposedPosture) && thought.proposedPosture.length > 0) {
    lines.push(`Proposed posture: ${thought.proposedPosture.slice(0, 4).join(' | ')}`);
  }

  // Master fleet freshness — the model needs to know whether the
  // translation rests on a fresh master read or a stale snapshot. When the
  // mirror ran in `stateOnly` mode (master unavailable or stale) we say so
  // explicitly; the model should down-weight the posture in that case.
  const masterMeta = thought.master;
  const ageMin = masterMeta?.maxAgeMin;
  const stale = masterMeta?.stale === true;
  let freshness: string;
  if (thought.mode === 'stateOnly') {
    freshness = 'state-only mode (master fleet unavailable or stale)';
  } else if (stale) {
    freshness = `stale master snapshot (${ageMin}m old)`;
  } else if (typeof ageMin === 'number' && Number.isFinite(ageMin) && ageMin >= 0) {
    freshness = `master snapshot ${ageMin}m old`;
  } else {
    freshness = 'master snapshot age unknown';
  }

  // Subscriber-bot scale — what portfolio this mirror is sized for. The
  // master fleet reasons about the main bot; the mirror translates to this
  // bot. Surfacing the scale here keeps the model from blindly mirroring
  // master trades.
  const ctx = thought.botContext;
  const portfolioValue = typeof ctx?.portfolioValueUSD === 'number' ? ctx.portfolioValueUSD : 0;
  const reservePct = typeof ctx?.usdcReservePct === 'number' ? ctx.usdcReservePct : 0;
  const scale = `scale: $${portfolioValue.toFixed(2)} portfolio @ ${(reservePct * 100).toFixed(1)}% USDC reserve`;

  lines.push(`Freshness: ${freshness} · ${scale}`);

  return `\n═══ MASTER MIRROR THOUGHT ═══\n${lines.join('\n')}\nThis is advisory context translated from the master fleet's reasoning to this bot's scale. It is NOT authoritative — your own decision pipeline still owns the call. Down-weight stale or state-only translations.\n`;
}
