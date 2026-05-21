/**
 * NVR-SPEC-035 INV-7 — Sleeve liveness (Phase B, WARN tier).
 *
 * Fires when any LIVE sleeve has gone too long without rendering a decision.
 * Would have caught the 2026-05-19 Alpha Hunter silence (40+ hours dark
 * before PR #30 fixed the scope-aware breaker), and is the standing
 * forcing-function against silent-sleeve regressions in general.
 *
 * Why WARN, not SEVERE:
 *   - A silent sleeve isn't a SAFETY issue — the other sleeves keep
 *     trading; the bot's substrate-honesty layer keeps reading from chain.
 *     The harm is OPPORTUNITY COST: the sleeve's slice of capital is
 *     stranded behind dead code, not the bookkeeping going wrong.
 *   - Gating execution would punish the bot for a sleeve regression that
 *     might have nothing to do with the sleeve trying to act. Surfacing
 *     it in the prompt lets the bot (or the operator on Telegram) notice
 *     and force a redeploy or env-var change.
 *
 * Staleness threshold = 12 hours:
 *   - Heavy-cycle cadence varies. In RANGING markets (the norm) heavy
 *     cycles can be hours apart, and Core sleeve's `lastDecisionAt` is
 *     trade-driven (so quiet days legitimately push it back).
 *   - 12h is generous enough to absorb that legitimate variance, tight
 *     enough to catch a real death (40h was the May Alpha Hunter case).
 *   - If the threshold proves noisy on Core, a per-sleeve metadata-driven
 *     threshold is a clean follow-up (Phase C).
 *
 * Skip conditions:
 *   - `mode !== 'live'` — paper/shadow sleeves can legitimately be
 *     dormant (Alpha Rotation runs at 0% target capacity by design).
 *   - `lastDecisionAt === null` — sleeve has never decided; warmup, not
 *     regression.
 *
 * Pause scope: 'none'.
 */

import type { Invariant, Violation } from '../types.js';

const STALENESS_THRESHOLD_HOURS = 12;
const STALENESS_THRESHOLD_MS = STALENESS_THRESHOLD_HOURS * 60 * 60 * 1000;

export const sleeveLiveness: Invariant = (ctx) => {
  const sleeves = ctx.sleeveLiveness;
  if (!sleeves || sleeves.length === 0) return null;

  const now = Date.now();
  const silent: Array<{
    id: string;
    lastDecisionAt: string;
    hoursSinceDecision: number;
    decisionsCount: number;
  }> = [];

  for (const s of sleeves) {
    if (s.mode !== 'live') continue;
    if (s.lastDecisionAt === null) continue;

    const lastMs = new Date(s.lastDecisionAt).getTime();
    if (!Number.isFinite(lastMs)) continue;

    const ageMs = now - lastMs;
    if (ageMs <= STALENESS_THRESHOLD_MS) continue;

    silent.push({
      id: s.id,
      lastDecisionAt: s.lastDecisionAt,
      hoursSinceDecision: parseFloat((ageMs / 3600000).toFixed(2)),
      decisionsCount: s.decisionsCount,
    });
  }

  if (silent.length === 0) return null;

  silent.sort((a, b) => b.hoursSinceDecision - a.hoursSinceDecision);

  const namesAndAges = silent
    .map(s => `${s.id} ${s.hoursSinceDecision.toFixed(1)}h`)
    .join(', ');

  const violation: Violation = {
    invariantId: 'INV-7',
    invariantName: 'sleeve-liveness',
    severity: 'WARN',
    message: `${silent.length} live sleeve${silent.length === 1 ? '' : 's'} silent >${STALENESS_THRESHOLD_HOURS}h: ${namesAndAges}. A live sleeve that stops rendering decisions has stranded its slice of capital.`,
    observed: {
      silent,
      stalenessThresholdHours: STALENESS_THRESHOLD_HOURS,
      totalLiveSleeves: sleeves.filter(s => s.mode === 'live').length,
    },
    expected: {
      rule: `every live sleeve renders a decision within ${STALENESS_THRESHOLD_HOURS}h`,
    },
    pauseScope: 'none',
    detectedAt: new Date().toISOString(),
  };

  return violation;
};
