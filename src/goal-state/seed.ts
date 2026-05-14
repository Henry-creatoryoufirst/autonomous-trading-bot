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
      // 2026-05-14: usdc-pool-thin DROPPED per the first Dream artifact's
      // proposal — USDC is now $169.62 > $100 threshold; keeping it was
      // training the evaluator to ignore its own conclusions ("stale-blocker
      // drift is corrosive"). See GOAL_STATE_DREAM_2026-05-14_the-nvr-bot.md.
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
      // 2026-05-14: ADDED per the first Dream's proposal — Open positions
      // (15-17) appeared after a cycle-counter reset with no Path-D attribution.
      // Their capital + risk profile is opaque inside this goal-state.
      {
        id: 'open-positions-unexplained',
        description: 'OPEN_POSITION_COUNT (15-17) without Path-D attribution — capital allocation + P&L of these positions are untracked, may be consuming the USDC headroom needed for Path-D entries',
        resolutionCriterion: 'each open position attributed to a decision path (Core / Alpha-WD / liberation) in evidenceOfProgress',
        addedAt: iso,
      },
      // 2026-05-14: ADDED per the first Dream's proposal — a cycle-counter
      // reset (#163 → #1) was observed with elapsed time ~1.78 billion sec,
      // suggesting state-persistence failure. Needs diagnostic before
      // trusting accumulated scan state.
      {
        id: 'cycle-counter-state-corruption',
        description: 'Cycle counter reset #163 → #1 with elapsed time of ~1.78 billion seconds (~56 years) — indicates restart or state-persistence failure that may have wiped specialist wallet data + reviewer confidence history',
        resolutionCriterion: 'restart event diagnosed + accumulated scan state verified intact OR explicitly re-seeded',
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
