// NVR-SPEC-030 Goal-State Reasoner — v0.2
//
// The loop. Runs at the start of every heavy cycle, before any new reasoning.
// Six steps per NVR-SPEC-030 §4:
//
//   1. LOAD     — read the goal-state from KV (or seed on first run)
//   2. REPLAY   — return a system-prompt block the caller appends
//   3. PRUNE    — drop blockers whose resolution criterion is satisfied [stubbed]
//   4. EVALUATE — separate-model Haiku evaluator judges last cycle's outcome
//                 (v0.2 — matches Anthropic's `/goal` independent-evaluator pattern)
//   5. DECIDE   — record the cycle's chosen next step (caller passes it in)
//                 OR escalate to ask_human when budget exceeded
//   6. SAVE     — write back with content_sha256 optimistic concurrency
//
// v0.2 ADDITIONS over v0.1:
//   - Separate Haiku evaluator (evaluator.ts) called when caller provides
//     a cycleSummary. Returns moveCloser + reason, appended to evidence and
//     saved to lastEvaluation. Token cost charged to budget.
//   - Budget tracking (budget.ts). Cumulative since goalSetAt. When budget
//     is exceeded, the reasoner overrides proposedNextStep with an
//     ask_human escalation message so the caller knows to surface it.
//
// IMPORTANT v0.2 vs v0.1 semantic — still WRITE-ONLY:
//   The reasoner WRITES to goal-state, runs the evaluator, tracks budget —
//   but it does NOT drive trade execution. The existing decision path
//   remains source of truth for trades. Stage 3 (flipping
//   GOAL_STATE_DRIVES_DECISIONS) promotes the reasoner to driving.

import {
  GoalState,
  GoalEvidence,
} from './types.js';
import {
  loadGoalState,
  saveGoalState,
  isGoalStateConfigured,
} from './store.js';
import { seedMasterGoalState, MASTER_AGENT_ID } from './seed.js';
import {
  evaluateCycleAgainstGoal,
  evaluationToEvidence,
  type EvaluationContext,
  type EvaluationSnapshot,
  type EvaluationResult,
} from './evaluator.js';
import {
  chargeBudget,
  checkBudget,
  emptyBudgetUsage,
  DEFAULT_BUDGET,
  type BudgetUsage,
} from './budget.js';

export interface ReasonerInput {
  /** Which agent's goal-state to advance. v0.1 = MASTER_AGENT_ID only. */
  agentId: string;
  /** Human-readable description of the next step the bot is about to take this cycle. e.g. "HOLD — no WD candidate above threshold this cycle". */
  proposedNextStep: string;
  /** Optional fresh evidence the heavy cycle wants to record (e.g. "Watcher fired VOLUME_SPIKE on $VVV at conf 0.73"). */
  newEvidence?: GoalEvidence;
  /**
   * v0.2.1 — structured snapshot for the evaluator. When provided, the
   * evaluator runs against named fields (PORTFOLIO_VALUE_USD,
   * USDC_BALANCE_USD, etc.) instead of a prose summary. Eliminates the
   * field-confusion failure mode from v0.2.0 cycle #2 where the evaluator
   * read "Portfolio: $3230" as "USDC pool $3230". Replaces the older
   * `cycleSummary` string field.
   */
  snapshot?: EvaluationSnapshot;
  /** Optional one-line concrete observation. */
  cycleObservation?: string;
  /** v0.2 — main heavy-cycle token usage to fold into the goal's budget. */
  mainCycleTokens?: { model: string; inputTokens: number; outputTokens: number };
}

export interface ReasonerOutput {
  systemPromptBlock: string;
  loadedState: GoalState;
  savedState: GoalState | null;
  /** v0.2 — evaluation result, present when cycleSummary was provided and evaluator succeeded. */
  evaluation?: EvaluationResult;
  /** v0.2 — true when the goal's cumulative budget is exhausted after this cycle. Caller may want to surface to Telegram. */
  budgetExceeded: boolean;
}

/**
 * The reasoner loop. Pure orchestration. Returns the system-prompt block to
 * inject + the persisted state + optional evaluator output. Never throws
 * into the heavy-cycle path.
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
      // v0.1 only seeds the master. Per-token specialists + mirrors come later.
      return null;
    }
    state = seedMasterGoalState(now);
    expectedSha = '';
  }

  // 2. REPLAY — build the system-prompt block from the loaded state.
  const systemPromptBlock = renderReplayBlock(state);

  // 3. PRUNE — stubbed. Resolution-criterion DSL is a v0.3 task; today the
  //    criteria are human-prose. Reasoner reads them through; manual prune.
  const survivingBlockers = state.blockers;

  // 4. EVALUATE — v0.2.1: separate Haiku evaluator running over a STRUCTURED
  //    snapshot (named fields, not prose). Only fires when caller provides
  //    `snapshot` so we don't spend tokens on an empty cycle.
  let evaluation: EvaluationResult | undefined;
  const newEvidence: GoalEvidence[] = input.newEvidence
    ? [input.newEvidence]
    : [];
  if (input.snapshot) {
    const ctx: EvaluationContext = {
      snapshot: input.snapshot,
      cycleObservation: input.cycleObservation,
    };
    const result = await evaluateCycleAgainstGoal(state, ctx);
    if (result) {
      evaluation = result;
      newEvidence.push(evaluationToEvidence(result));
    }
  }

  // 4b. BUDGET — charge evaluator + main-cycle tokens, then check ceiling.
  let budget: BudgetUsage = state.budgetUsage ?? emptyBudgetUsage(now);
  if (evaluation) {
    budget = chargeBudget(
      budget,
      process.env.GOAL_STATE_EVALUATOR_MODEL ?? 'claude-haiku-4-5-20251001',
      evaluation.evaluatorTokens.input,
      evaluation.evaluatorTokens.output,
      now,
    );
  }
  if (input.mainCycleTokens) {
    budget = chargeBudget(
      budget,
      input.mainCycleTokens.model,
      input.mainCycleTokens.inputTokens,
      input.mainCycleTokens.outputTokens,
      now,
    );
  }
  const budgetCheck = checkBudget(budget, DEFAULT_BUDGET);

  // 5. DECIDE — record the proposed next step. If budget is exceeded, override
  //    the next step with an ask_human escalation so the caller (and Henry
  //    via the cockpit) can see the goal is paused pending decision.
  const nowIso = now.toISOString();
  const effectiveNextStep = budgetCheck.exceeded
    ? `BLOCKED: budget exceeded (${budgetCheck.reason}). Awaiting human decision on whether to continue spending on this goal or revise it.`
    : input.proposedNextStep;

  const updated: GoalState = {
    ...state,
    blockers: survivingBlockers,
    evidenceOfProgress: [
      ...state.evidenceOfProgress,
      ...newEvidence,
    ],
    lastNextStep: effectiveNextStep,
    lastNextStepAt: nowIso,
    lastNextStepOutcome: 'pending',
    lastEvaluation: evaluation
      ? {
          moveCloser: evaluation.moveCloser,
          reason: evaluation.reason,
          evaluatedAt: evaluation.evaluatedAt,
        }
      : state.lastEvaluation,
    budgetUsage: budget,
    lastUpdatedAt: nowIso,
    contentSha256: state.contentSha256, // saveGoalState recomputes
  };

  // 6. SAVE — optimistic-concurrency write.
  const savedState = await saveGoalState(updated, expectedSha);

  return {
    systemPromptBlock,
    loadedState: state,
    savedState,
    evaluation,
    budgetExceeded: budgetCheck.exceeded,
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
  if (state.lastEvaluation) {
    const verdict = state.lastEvaluation.moveCloser ? 'CLOSER' : 'noise';
    lines.push(`Evaluator verdict on last cycle: ${verdict} — ${state.lastEvaluation.reason}`);
  }
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
  if (state.budgetUsage) {
    lines.push(
      `Budget so far: $${state.budgetUsage.cumulativeUsd.toFixed(2)} · ${state.budgetUsage.cumulativeInputTokens.toLocaleString()} in / ${state.budgetUsage.cumulativeOutputTokens.toLocaleString()} out tokens.`,
    );
  }
  return lines.join('\n');
}

export { MASTER_AGENT_ID } from './seed.js';
