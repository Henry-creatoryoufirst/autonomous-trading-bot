// NVR-SPEC-030 v0.2 — Goal-State Budget Tracker
//
// Hard ceiling on how much the bot spends pursuing one goal. Without this,
// every credible long-running-agent post warns about runaway loops. We track
// cumulative input + output tokens AND cumulative USD cost across cycles
// since the current goal was set. If either crosses a threshold, the
// reasoner shifts to "ask_human" mode — next-step becomes
// "BLOCKED: budget exceeded — Henry confirms continued spend or revises goal".
//
// Budget resets when the goal changes (goalSetAt advances).

export interface BudgetUsage {
  /** Total Anthropic input tokens across all evaluator + heavy-cycle calls since goalSetAt. */
  cumulativeInputTokens: number;
  /** Total Anthropic output tokens since goalSetAt. */
  cumulativeOutputTokens: number;
  /** Best-effort USD estimate using model price-per-MTok. */
  cumulativeUsd: number;
  /** ISO timestamp of the most recent token recording. */
  lastChargedAt: string;
}

export interface BudgetLimits {
  /** Max cumulative USD before reasoner escalates. */
  maxUsd: number;
  /** Max cumulative input tokens before reasoner escalates. */
  maxInputTokens: number;
  /** Max cumulative output tokens before reasoner escalates. */
  maxOutputTokens: number;
}

export const DEFAULT_BUDGET: BudgetLimits = {
  maxUsd: parseFloat(process.env.GOAL_STATE_BUDGET_USD ?? '5.00'),
  maxInputTokens: parseInt(process.env.GOAL_STATE_BUDGET_INPUT_TOKENS ?? '5000000', 10),
  maxOutputTokens: parseInt(process.env.GOAL_STATE_BUDGET_OUTPUT_TOKENS ?? '500000', 10),
};

/** Approximate per-MTok prices in USD. Conservative — actuals tend to be a bit lower. */
const MODEL_PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-7': { input: 15.0, output: 75.0 },
  // fallback / unknown models — treat as Sonnet to be safe
  'unknown': { input: 3.0, output: 15.0 },
};

export function estimateUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING_USD_PER_MTOK[model] ?? MODEL_PRICING_USD_PER_MTOK['unknown'];
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

export function emptyBudgetUsage(now: Date = new Date()): BudgetUsage {
  return {
    cumulativeInputTokens: 0,
    cumulativeOutputTokens: 0,
    cumulativeUsd: 0,
    lastChargedAt: now.toISOString(),
  };
}

export function chargeBudget(
  usage: BudgetUsage,
  model: string,
  inputTokens: number,
  outputTokens: number,
  now: Date = new Date(),
): BudgetUsage {
  return {
    cumulativeInputTokens: usage.cumulativeInputTokens + inputTokens,
    cumulativeOutputTokens: usage.cumulativeOutputTokens + outputTokens,
    cumulativeUsd: usage.cumulativeUsd + estimateUsd(model, inputTokens, outputTokens),
    lastChargedAt: now.toISOString(),
  };
}

export interface BudgetCheckResult {
  exceeded: boolean;
  reason?: string;
  /** Fraction of the most-saturated limit (0..1+). Useful for cockpit progress bars. */
  saturation: number;
}

export function checkBudget(usage: BudgetUsage, limits: BudgetLimits = DEFAULT_BUDGET): BudgetCheckResult {
  const sUsd = usage.cumulativeUsd / limits.maxUsd;
  const sIn = usage.cumulativeInputTokens / limits.maxInputTokens;
  const sOut = usage.cumulativeOutputTokens / limits.maxOutputTokens;
  const saturation = Math.max(sUsd, sIn, sOut);

  if (sUsd >= 1) {
    return {
      exceeded: true,
      reason: `USD spend $${usage.cumulativeUsd.toFixed(2)} >= cap $${limits.maxUsd.toFixed(2)}`,
      saturation,
    };
  }
  if (sIn >= 1) {
    return {
      exceeded: true,
      reason: `Input tokens ${usage.cumulativeInputTokens.toLocaleString()} >= cap ${limits.maxInputTokens.toLocaleString()}`,
      saturation,
    };
  }
  if (sOut >= 1) {
    return {
      exceeded: true,
      reason: `Output tokens ${usage.cumulativeOutputTokens.toLocaleString()} >= cap ${limits.maxOutputTokens.toLocaleString()}`,
      saturation,
    };
  }
  return { exceeded: false, saturation };
}
