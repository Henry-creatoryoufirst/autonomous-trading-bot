// NVR-SPEC-030 Goal-State Reasoner — v0.1
//
// The GoalState interface. One file per agent. 14 fields, every one
// consumed by the reasoner loop in reasoner.ts. No speculative shape.
//
// Persistence: Vercel KV. Key shape: `goal-state:<agentId>` for current,
// `goal-state:<agentId>:history` for append-only audit trail.
//
// See NVR-SPEC-030 §3 for the field-by-field rationale.

export type GoalSetBy = "henry" | "master" | "self";
export type NextStepOutcome = "pending" | "done" | "abandoned";

export interface GoalEvidence {
  /** ISO-8601 timestamp when this evidence was observed. */
  at: string;
  /** Plain-English observation (e.g. "Path-D deployed dry powder into $TOKEN"). */
  observation: string;
  /** Did this advance the goal, or was it noise? */
  moveCloser: boolean;
}

export interface GoalBlocker {
  /** Stable identifier — used for pruning + dedup. */
  id: string;
  /** Plain-English description (e.g. "need confluence score for $X above threshold"). */
  description: string;
  /** Machine-checkable resolution criterion when possible (e.g. "usdcBalance > 100"). */
  resolutionCriterion: string;
  /** ISO-8601 timestamp when added. */
  addedAt: string;
}

/**
 * Budget tracking. Reset on each goal change (goalSetAt advances).
 * Defined here on GoalState so dreaming + cockpit can read it without
 * an extra KV roundtrip. See budget.ts for the helpers.
 */
export interface GoalBudgetUsage {
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  cumulativeUsd: number;
  lastChargedAt: string;
}

export interface GoalState {
  // Identity
  agentId: string;
  /** Single sentence. e.g. "First confirmed Path-D round-trip-for-profit." */
  goal: string;
  goalSetAt: string;
  goalSetBy: GoalSetBy;

  // Progress (ring buffer, cap at 20 in store.ts)
  evidenceOfProgress: GoalEvidence[];

  // Blockers
  blockers: GoalBlocker[];

  // Continuity — the replay substrate
  lastNextStep: string;
  lastNextStepAt: string;
  lastNextStepOutcome: NextStepOutcome;

  // v0.2 — evaluator + budget
  /** Most recent evaluator output. Optional — populated once v0.2 evaluator runs. */
  lastEvaluation?: {
    moveCloser: boolean;
    reason: string;
    evaluatedAt: string;
  };
  /** Cumulative spend since goalSetAt. Optional for back-compat with v0.1 state files. */
  budgetUsage?: GoalBudgetUsage;

  // Bookkeeping
  lastUpdatedAt: string;
  /** SHA-256 of the JSON-serialised previous state. Used as optimistic-concurrency precondition on write. Empty string on first seed. */
  contentSha256: string;
}

/** Maximum number of evidence entries kept per goal-state. Older entries drop off the ring buffer. */
export const EVIDENCE_RING_BUFFER_SIZE = 20;
