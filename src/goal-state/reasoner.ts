// NVR-SPEC-030 Goal-State Reasoner — v0.1
//
// The loop. Runs at the start of every heavy cycle, before any new
// reasoning. Six steps, exactly as in NVR-SPEC-030 §4:
//
//   1. LOAD   — read the goal-state from KV (or seed on first run)
//   2. REPLAY — return a system-prompt block the caller appends
//   3. PRUNE  — drop blockers whose resolution criterion is satisfied
//   4. EVALUATE — did last cycle's nextStep produce evidence of progress?
//   5. DECIDE — record the cycle's chosen next step (caller passes it in)
//   6. SAVE   — write back with optimistic-concurrency
//
// v0.1 IMPORTANT: the reasoner WRITES the goal-state but does NOT DRIVE
// trade execution. The bot's existing decision path remains source-of-
// truth for trades. After 48h of coherent goal-state files we flip a
// second flag (proposed: GOAL_STATE_DRIVES_DECISIONS) to actually promote
// the reasoner's decision.action — that's v0.1.5 / v0.2, not this commit.
//
// Steps 3 (PRUNE) and 4 (EVALUATE) are scaffolded but stubbed in v0.1:
// resolution-criterion checking lands in v0.2 once we have one cycle of
// real goal-state files to anchor the criteria DSL against. The fields
// exist and write through; the auto-detection of resolution is what's
// stubbed.

import {
  GoalState,
  GoalEvidence,
  NextStepOutcome,
} from './types.js';
import {
  loadGoalState,
  saveGoalState,
  isGoalStateConfigured,
} from './store.js';
import { seedMasterGoalState, MASTER_AGENT_ID } from './seed.js';

export interface ReasonerInput {
  /** Which agent's goal-state to advance. v0.1 = MASTER_AGENT_ID only. */
  agentId: string;
  /** Human-readable description of the next step the bot is about to take this cycle. e.g. "HOLD — no WD candidate above threshold this cycle". */
  proposedNextStep: string;
  /** Optional fresh evidence the heavy cycle wants to record (e.g. "Watcher fired VOLUME_SPIKE on $VVV at conf 0.73"). */
  newEvidence?: GoalEvidence;
}

export interface ReasonerOutput {
  /** Always returned. The system-prompt block the caller appends BEFORE the new reasoning step. */
  systemPromptBlock: string;
  /** The state as it was at cycle start (post-load, pre-update). For dashboard / telemetry. */
  loadedState: GoalState;
  /** The state after this cycle's write. Null if KV unavailable / concurrency conflict (caller's existing decision path continues unaffected). */
  savedState: GoalState | null;
}

/**
 * The reasoner loop. Pure orchestration — no LLM calls, no trade execution.
 * Returns the system-prompt block to inject and the persisted state.
 * Failure modes (KV down, concurrency conflict): return savedState=null and
 * a system-prompt block built from the most recent observable state.
 */
export async function reasonAboutGoal(
  input: ReasonerInput,
  now: Date = new Date(),
): Promise<ReasonerOutput | null> {
  if (!isGoalStateConfigured()) return null;

  // 1. LOAD — current state or seed.
  let state = await loadGoalState(input.agentId);
  let expectedSha = state?.contentSha256 ?? '';
  if (!state) {
    if (input.agentId !== MASTER_AGENT_ID) {
      // v0.1 only seeds the master. Per-token specialists + mirrors come in v0.2.
      return null;
    }
    state = seedMasterGoalState(now);
    expectedSha = '';
  }

  // 2. REPLAY — build the system-prompt block from the loaded state.
  const systemPromptBlock = renderReplayBlock(state);

  // 3. PRUNE — stubbed in v0.1. Resolution-criterion DSL lands in v0.2 once
  //    we have one cycle of real goal-state files to anchor against. Today
  //    the criteria are human-prose; the reasoner reads them through but
  //    doesn't auto-drop. Henry / future Claude prunes manually for now.
  const survivingBlockers = state.blockers;

  // 4. EVALUATE — last cycle's lastNextStep. Stubbed: we mark its outcome
  //    'pending' if not already set. v0.2 wires in real progress detection.
  const lastOutcome: NextStepOutcome = state.lastNextStepOutcome === 'pending'
    ? 'pending'
    : state.lastNextStepOutcome;

  // 5. DECIDE — record the proposed next step from the caller. The caller
  //    is the existing decision path; the reasoner WRITES it through, it
  //    doesn't DRIVE. That promotion is gated separately (see file header).
  const nowIso = now.toISOString();
  const updated: GoalState = {
    ...state,
    blockers: survivingBlockers,
    evidenceOfProgress: input.newEvidence
      ? [...state.evidenceOfProgress, input.newEvidence]
      : state.evidenceOfProgress,
    lastNextStep: input.proposedNextStep,
    lastNextStepAt: nowIso,
    lastNextStepOutcome: 'pending',
    lastUpdatedAt: nowIso,
    contentSha256: state.contentSha256, // saveGoalState recomputes
  };

  // 6. SAVE — optimistic-concurrency write. On conflict (savedState null)
  //    we return the loaded state so the caller still has the replay block.
  const savedState = await saveGoalState(updated, expectedSha);

  return {
    systemPromptBlock,
    loadedState: state,
    savedState,
  };
}

/** Build the system-prompt block from the goal-state. Exported for tests + cockpit preview. */
export function renderReplayBlock(state: GoalState): string {
  const recentEvidence = state.evidenceOfProgress.slice(-3);
  const lines: string[] = [];
  lines.push(`## Goal-state (replay from last cycle)`);
  lines.push(`Your goal: ${state.goal}`);
  lines.push(`Last cycle you decided: ${state.lastNextStep}`);
  lines.push(`Outcome of last decision: ${state.lastNextStepOutcome}`);
  if (state.blockers.length > 0) {
    lines.push(`Active blockers:`);
    for (const b of state.blockers) {
      lines.push(`  - ${b.description} (resolves when: ${b.resolutionCriterion})`);
    }
  }
  if (recentEvidence.length > 0) {
    lines.push(`Recent progress:`);
    for (const e of recentEvidence) {
      lines.push(`  - ${e.at}: ${e.observation} (${e.moveCloser ? 'closer' : 'noise'})`);
    }
  }
  return lines.join('\n');
}

export { MASTER_AGENT_ID } from './seed.js';
