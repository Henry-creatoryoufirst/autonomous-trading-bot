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

/**
 * Structured snapshot for the evaluator. Replaces the v0.2.0 prose
 * `cycleSummary` field — the prose form caused field-confusion in
 * Cycle #2 (evaluator read "Portfolio: $3230" as "USDC pool $3230"
 * because the blocker mentioned "USDC pool thin"). Structured fields,
 * rendered into clearly-named sections, eliminate that ambiguity.
 */
export interface EvaluationSnapshot {
  /** Total portfolio value in USD across all assets. */
  portfolioValueUsd: number;
  /** USDC-only balance (the dry-powder reserve specifically). */
  usdcBalanceUsd: number;
  /** Number of non-USDC positions currently held. */
  openPositionCount: number;
  /** Number of cohort tokens currently in route-circuit-breaker blocklist. */
  blockedTokenCount: number;
  /** Hours since the last successful live trade execution; null if never. */
  hoursSinceLastLiveExecution: number | null;
  /** Why this heavy cycle is firing (price move, forced interval, emergency, etc.). */
  heavyCycleReason: string;
  /** Cycle counter for orientation. */
  cycleNumber: number;
}

export interface EvaluationContext {
  /** Structured snapshot of the bot's current state. The evaluator sees this rendered into named sections — no prose ambiguity. */
  snapshot: EvaluationSnapshot;
  /** Optional concrete one-line observation worth recording (price move, trade fired, blocker cleared). */
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
 * the goal, the blockers, the last decision, and a STRUCTURED snapshot of
 * the bot's current state. Fields are named (PORTFOLIO_VALUE_USD,
 * USDC_BALANCE_USD, etc.) to prevent field-confusion — the prose form in
 * v0.2.0 caused the evaluator to read "Portfolio: $3230" as "USDC pool
 * $3230" because the blocker mentioned "USDC pool thin." Named fields fix
 * that.
 *
 * The evaluator answers exactly one question: did this cycle move us
 * closer to the goal, given the snapshot and the active blockers.
 */
function buildEvaluatorPrompt(state: GoalState, ctx: EvaluationContext): string {
  const s = ctx.snapshot;
  const lines = [
    `### GOAL`,
    state.goal,
    ``,
    `### LAST CYCLE'S DECISION`,
    state.lastNextStep,
    ``,
  ];

  if (state.blockers.length > 0) {
    lines.push(`### ACTIVE BLOCKERS`);
    for (const b of state.blockers.slice(0, 5)) {
      lines.push(`- ${b.description}`);
      lines.push(`  resolves when: ${b.resolutionCriterion}`);
    }
    lines.push(``);
  }

  lines.push(`### CURRENT BOT STATE (this is the structured snapshot — do not invent fields not listed here)`);
  lines.push(`- CYCLE_NUMBER: ${s.cycleNumber}`);
  lines.push(`- HEAVY_CYCLE_REASON: ${s.heavyCycleReason}`);
  lines.push(`- PORTFOLIO_VALUE_USD: $${s.portfolioValueUsd.toFixed(2)}  // total value across ALL assets`);
  lines.push(`- USDC_BALANCE_USD: $${s.usdcBalanceUsd.toFixed(2)}  // USDC-only — the dry-powder reserve`);
  lines.push(`- OPEN_POSITION_COUNT: ${s.openPositionCount}  // non-USDC positions held`);
  lines.push(`- ROUTE_BLOCKLIST_TOKEN_COUNT: ${s.blockedTokenCount}  // cohort tokens the Watcher cannot fire on`);
  lines.push(
    `- HOURS_SINCE_LAST_LIVE_EXECUTION: ${
      s.hoursSinceLastLiveExecution === null
        ? 'never (no live trade since boot)'
        : `${s.hoursSinceLastLiveExecution.toFixed(1)}h`
    }`,
  );

  if (ctx.cycleObservation) {
    lines.push('');
    lines.push(`### CONCRETE OBSERVATION FROM THIS CYCLE`);
    lines.push(ctx.cycleObservation);
  }

  lines.push('');
  lines.push(`### QUESTION`);
  lines.push(
    `Did this cycle move closer to the GOAL, or was it noise? Anchor your reasoning in the structured fields above. When citing numbers, USE THE EXACT FIELD NAME (e.g. "USDC_BALANCE_USD" not "the USDC pool") so there's no ambiguity about which value you're referring to.`,
  );
  lines.push(``);
  lines.push(`Respond with a single JSON object only:`);
  lines.push(`  { "moveCloser": true|false, "reason": "one sentence, anchored in field names" }`);
  lines.push(`Nothing else. No code fences. No prose before or after.`);

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
