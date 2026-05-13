// NVR-SPEC-030 v0.2 — Goal-State Evaluator
//
// Separate fast-model evaluator that judges whether the most recent cycle
// moved the agent closer to its goal. Mirrors Anthropic's `/goal` pattern
// (Claude Code 2.1.139, May 2026): the model doing the work is NOT the
// model that decides whether the work is done. Independence is the load-
// bearing property — a self-judging reasoner has incentive to declare
// itself successful.
//
// Returns { moveCloser, reason } that the reasoner appends to
// evidenceOfProgress[]. Cheap by design — Haiku, ~150 input tokens, ~80
// output tokens. Budget tracked alongside.

import Anthropic from '@anthropic-ai/sdk';
import { GoalEvidence, GoalState } from './types.js';

const EVALUATOR_MODEL = process.env.GOAL_STATE_EVALUATOR_MODEL ?? 'claude-haiku-4-5-20251001';
const EVALUATOR_MAX_TOKENS = 250;

export interface EvaluationContext {
  /** What just happened this cycle, in 1-3 sentences. */
  cycleSummary: string;
  /** Optional concrete observation worth recording (price move, trade fired, blocker cleared). */
  cycleObservation?: string;
  /** Tokens spent in main heavy-cycle reasoning this cycle (added to evaluator cost for total). */
  mainCycleTokens?: { input: number; output: number };
}

export interface EvaluationResult {
  /** Whether the cycle moved closer to the goal. */
  moveCloser: boolean;
  /** Short reason from the evaluator's perspective. */
  reason: string;
  /** Token usage from this evaluator call alone. */
  evaluatorTokens: { input: number; output: number };
  /** ISO timestamp the evaluation ran. */
  evaluatedAt: string;
}

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

function isTextBlock(b: unknown): b is AnthropicTextBlock {
  return typeof b === 'object' && b !== null
    && (b as { type?: unknown }).type === 'text'
    && typeof (b as { text?: unknown }).text === 'string';
}

/**
 * Build the evaluator prompt. Deliberately spare — the evaluator only sees
 * the goal, the blockers, the last decision, and the latest cycle summary.
 * It does NOT see the full market state — that's the reasoner's job. The
 * evaluator answers exactly one question: did the cycle move us closer.
 */
function buildEvaluatorPrompt(state: GoalState, ctx: EvaluationContext): string {
  const lines = [
    `Goal: ${state.goal}`,
    `Last decided: ${state.lastNextStep}`,
  ];
  if (state.blockers.length > 0) {
    lines.push(`Active blockers:`);
    for (const b of state.blockers.slice(0, 5)) {
      lines.push(`  - ${b.description} (resolves when: ${b.resolutionCriterion})`);
    }
  }
  lines.push('', `Cycle just ran. Summary:`, ctx.cycleSummary);
  if (ctx.cycleObservation) {
    lines.push('', `Concrete observation from the cycle:`, ctx.cycleObservation);
  }
  lines.push(
    '',
    `Question: did this cycle move closer to the goal, or was it noise?`,
    `Respond with a single JSON object:`,
    `  { "moveCloser": true|false, "reason": "one sentence" }`,
    `Nothing else. No code fences. No prose before or after.`,
  );
  return lines.join('\n');
}

/**
 * Call the evaluator. Returns null on any failure — caller treats null as
 * "no evaluation this cycle" and proceeds without an evidence entry. Never
 * throws into the heavy-cycle path.
 */
export async function evaluateCycleAgainstGoal(
  state: GoalState,
  ctx: EvaluationContext,
  apiKey: string | undefined = process.env.ANTHROPIC_API_KEY,
): Promise<EvaluationResult | null> {
  if (!apiKey) return null;

  try {
    const client = new Anthropic({ apiKey });
    const userPrompt = buildEvaluatorPrompt(state, ctx);
    const res = await client.messages.create({
      model: EVALUATOR_MODEL,
      max_tokens: EVALUATOR_MAX_TOKENS,
      system:
        'You are the goal-state evaluator. Your job is to judge whether the latest cycle moved the agent closer to its stated goal, given the cycle summary and the active blockers. Answer only with the requested JSON. Be honest — pessimism beats hopeful self-congratulation.',
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = res.content.find(isTextBlock)?.text ?? '';
    const evaluation = parseJsonResponse(text);
    if (!evaluation) return null;

    return {
      moveCloser: evaluation.moveCloser,
      reason: evaluation.reason,
      evaluatorTokens: {
        input: res.usage?.input_tokens ?? 0,
        output: res.usage?.output_tokens ?? 0,
      },
      evaluatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(`[GoalState/Evaluator] error (non-fatal): ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

function parseJsonResponse(text: string): { moveCloser: boolean; reason: string } | null {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as { moveCloser?: unknown; reason?: unknown };
    if (typeof parsed.moveCloser !== 'boolean') return null;
    if (typeof parsed.reason !== 'string') return null;
    return { moveCloser: parsed.moveCloser, reason: parsed.reason.slice(0, 240) };
  } catch {
    return null;
  }
}

/** Turn an EvaluationResult into a GoalEvidence entry the reasoner can append. */
export function evaluationToEvidence(ev: EvaluationResult): GoalEvidence {
  return {
    at: ev.evaluatedAt,
    observation: ev.reason,
    moveCloser: ev.moveCloser,
  };
}
