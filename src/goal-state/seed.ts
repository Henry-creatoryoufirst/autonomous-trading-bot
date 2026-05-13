// NVR-SPEC-030 Goal-State Reasoner — v0.1
//
// One-time seeder. Called by the reasoner when loadGoalState() returns null
// for the master agent. Produces the initial GoalState document with Henry's
// canonical goal and the current known-gaps list as blockers.
//
// Open-ended phrasing per DECISIONS_2026-05-13 Q1: "First confirmed Path-D
// round-trip-for-profit" — no date. We re-evaluate cadence once we observe
// the first round-trip and know what realistic timing looks like.

import { GoalState } from './types.js';
import { computeContentSha } from './store.js';

export const MASTER_AGENT_ID = 'the-nvr-bot';

/**
 * Seed the master agent's goal-state. Used the first time the reasoner runs
 * (loadGoalState returns null). The reasoner is responsible for persisting
 * the result via saveGoalState with expectedSha = ''.
 */
export function seedMasterGoalState(now: Date = new Date()): GoalState {
  const iso = now.toISOString();
  const seed: GoalState = {
    agentId: MASTER_AGENT_ID,
    goal: 'First confirmed Path-D round-trip-for-profit',
    goalSetAt: iso,
    goalSetBy: 'henry',
    evidenceOfProgress: [],
    blockers: [
      {
        id: 'usdc-pool-thin',
        description: 'USDC pool too thin for Watcher-Direct entries to size meaningfully',
        resolutionCriterion: 'usdcBalance >= 100',
        addedAt: iso,
      },
      {
        id: 'specialist-data-cold-start',
        description: 'Specialist wallet data for new cohort tokens still cold — universe scan needs cycles to populate',
        resolutionCriterion: 'sum(specialistCounts) >= 5 across cohort',
        addedAt: iso,
      },
      {
        id: 'no-wd-candidate-above-threshold',
        description: 'No Watcher-Direct candidate has crossed Reviewer confidence >= 0.75 yet',
        resolutionCriterion: 'mostRecentWdCandidate.reviewerConfidence >= 0.75',
        addedAt: iso,
      },
    ],
    lastNextStep: 'Observe — watch for the first WD candidate at conf >= 0.75; FAST_STRIKE will auto-liberate USDC if pool is starved',
    lastNextStepAt: iso,
    lastNextStepOutcome: 'pending',
    lastUpdatedAt: iso,
    contentSha256: '',
  };
  seed.contentSha256 = computeContentSha(seed);
  return seed;
}
