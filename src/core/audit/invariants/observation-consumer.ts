/**
 * NVR-SPEC-035 INV-4 — Observation-consumer contract (Phase B, WARN tier).
 *
 * The bot ingests observations from external sources (stc-website auto-
 * investigation pipeline, alpha-watcher feeds, research-lab emissions).
 * Those sources have repeatedly written malformed entries that the bot
 * then mixed into its prompt — the stc-website auto-investigation pipe
 * notoriously polluted the observation feed with empty / partial findings
 * before the consumer-side validator was added.
 *
 * INV-4 is that validator, surfaced as a per-cycle invariant: if the
 * observation feed ever drifts off-contract, the bot SEES it instead of
 * silently inheriting garbage.
 *
 * Fires WARN when:
 *   - Any observation record has `schemaValid: false`, OR
 *   - More than 50% of records have empty/null `observation` content.
 *
 * Why WARN, not SEVERE:
 *   - A malformed observation is OPPORTUNITY-COST damage (the bot reasons
 *     against junk), not bookkeeping damage. INV-1/INV-2/INV-10 cover the
 *     bookkeeping. Punishing trade execution would compound the problem —
 *     the cure is to fix the producer, not freeze the consumer.
 *   - The forcing-function shape is right for Phase B: the bot's prompt
 *     names the bad-source counts every cycle, so the producer can't ship
 *     a regression and have it go unnoticed.
 *
 * Skip condition: ctx.observations undefined or empty. The agent call
 * site doesn't populate this in Phase B; Phase C wires the real
 * observation pipeline. Until then the invariant stays silent (returns
 * null) so it doesn't fire-on-noise on every cycle.
 *
 * Pause scope: 'none'.
 */

import type { Invariant, Violation } from '../types.js';

const EMPTY_RATIO_THRESHOLD = 0.5;

function isEmptyContent(value: string | null): boolean {
  if (value === null) return true;
  if (typeof value !== 'string') return true;
  return value.trim().length === 0;
}

export const observationConsumer: Invariant = (ctx) => {
  const observations = ctx.observations;
  if (!observations || observations.length === 0) return null;

  // Per-source aggregation: how many records each source emitted, how many
  // were schema-invalid, and how many were empty/null. Naming sources in
  // the violation message lets the operator route the fix to the right
  // producer immediately.
  const perSource = new Map<string, { total: number; invalid: number; empty: number }>();
  for (const obs of observations) {
    const src = obs.source || '<unknown>';
    const entry = perSource.get(src) ?? { total: 0, invalid: 0, empty: 0 };
    entry.total += 1;
    if (!obs.schemaValid) entry.invalid += 1;
    if (isEmptyContent(obs.observation)) entry.empty += 1;
    perSource.set(src, entry);
  }

  const invalidCount = observations.filter(o => !o.schemaValid).length;
  const emptyCount = observations.filter(o => isEmptyContent(o.observation)).length;
  const emptyRatio = emptyCount / observations.length;

  const invalidFired = invalidCount > 0;
  const emptyMajorityFired = emptyRatio > EMPTY_RATIO_THRESHOLD;
  if (!invalidFired && !emptyMajorityFired) return null;

  // Build a stable, human-readable per-source breakdown — sorted by total
  // desc so the noisiest source surfaces first.
  const breakdown = Array.from(perSource.entries())
    .map(([source, c]) => ({ source, ...c }))
    .sort((a, b) => b.total - a.total);

  const reasons: string[] = [];
  if (invalidFired) {
    const offenders = breakdown
      .filter(b => b.invalid > 0)
      .map(b => `${b.source} ${b.invalid}/${b.total}`)
      .join(', ');
    reasons.push(`${invalidCount} schema-invalid (${offenders})`);
  }
  if (emptyMajorityFired) {
    reasons.push(`${emptyCount}/${observations.length} empty content (${(emptyRatio * 100).toFixed(0)}%)`);
  }

  const violation: Violation = {
    invariantId: 'INV-4',
    invariantName: 'observation-consumer',
    severity: 'WARN',
    message: `Observation feed off-contract: ${reasons.join(' | ')}. The bot is reading malformed observations from upstream producers; fix the source before the prompt inherits garbage.`,
    observed: {
      totalObservations: observations.length,
      invalidCount,
      emptyCount,
      emptyRatio: parseFloat((emptyRatio * 100).toFixed(2)),
      emptyRatioThreshold: EMPTY_RATIO_THRESHOLD * 100,
      perSource: breakdown,
    },
    expected: {
      rule: `every observation record schemaValid=true and ≤${(EMPTY_RATIO_THRESHOLD * 100).toFixed(0)}% empty content`,
    },
    pauseScope: 'none',
    detectedAt: new Date().toISOString(),
  };

  return violation;
};
