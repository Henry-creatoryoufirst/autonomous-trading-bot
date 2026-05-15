// NVR-SPEC-030 Goal-State Reasoner — seed (v2 post-Option-B-pivot)
//
// One-time seeder. Called by the reasoner when loadGoalState() returns null
// for the master agent. Produces the initial GoalState document with Henry's
// canonical goal and the current known-gaps list as blockers.
//
// === 2026-05-15 OPTION B PIVOT UPDATE ===
// The v0.1 seed targeted "First confirmed Path-D round-trip-for-profit" — a
// metric that never fired in months of operation. After the 2026-05-15 pivot,
// the master goal is now benchmark-anchored: outperform a passive BTC/ETH
// 60/40 hold by 5%+ annualized over rolling 30-day windows. Live KV state
// was migrated directly (KV write w/ proper sha) but this seed function was
// left stale — meaning if KV ever resets (cold start, restore from backup,
// manual purge), the bot would re-seed the OLD goal. This edit fixes that
// edge case so the seed-of-record matches the migrated live state.
//
// See project_nvr_option_b_pivot.md memory entry for full context. The
// blocker IDs and resolution criteria mirror what's currently in live KV
// (sha 7927cb6a...). Future blocker schema changes should update both the
// live KV (via store.ts) and this seed in lockstep.

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
    goal: 'Achieve >=5% annualized alpha over a passive cbBTC/WETH 60/40 benchmark, measured over a rolling 30-day window of daily UTC portfolio snapshots.',
    goalSetAt: iso,
    goalSetBy: 'henry',
    evidenceOfProgress: [],
    blockers: [
      // 2026-05-15 Option B pivot: replaced 4 legacy Path-D blockers with 3
      // benchmark-anchored ones. Resolution criteria are machine-checkable
      // (benchmark snapshot count, alpha number, cohort membership).
      {
        id: 'benchmark-cold-start',
        description: 'Fewer than 30 daily benchmark snapshots accumulated; cannot yet compute rolling-30d alpha vs cbBTC/WETH 60/40. Resolves naturally as the 00:00 UTC snapshot cron runs.',
        resolutionCriterion: 'state.trading.benchmarkSnapshots.length >= 30',
        addedAt: iso,
      },
      {
        id: 'benchmark-underperforming',
        description: 'Rolling-30d annualized alpha is below the +5% target vs cbBTC/WETH 60/40 benchmark. Live blocker — re-evaluated each cycle once cold-start resolves; auto-clears when /api/benchmark trackingState is "outperforming".',
        resolutionCriterion: 'alpha30dAnnualized >= 0.05',
        addedAt: iso,
      },
      {
        id: 'quality-universe-enforced',
        description: 'Active cohort narrowed to 7-quality universe (cbBTC/WETH/cbXRP/cbLTC/LINK/cbADA/cbSOL); old speculative cohort retired (no remaining positions in CLANKER/MIGGLES/MORPHO/TIBBIR/ENA/cbDOGE/GAME/DOGINME/WELL/VADER/LUNA/FAI beyond dust).',
        resolutionCriterion: 'no positions remain in speculative cohort (CLANKER/MIGGLES/MORPHO/TIBBIR/ENA/cbDOGE/GAME/DOGINME/WELL/VADER/LUNA/FAI)',
        addedAt: iso,
      },
    ],
    lastNextStep: 'Observe — accumulate daily benchmark snapshots (00:00 UTC cron). LLM cycles read this goal in their system prompt and reason against it. First meaningful alpha verdict at day 30.',
    lastNextStepAt: iso,
    lastNextStepOutcome: 'pending',
    lastUpdatedAt: iso,
    contentSha256: '',
  };
  seed.contentSha256 = computeContentSha(seed);
  return seed;
}
