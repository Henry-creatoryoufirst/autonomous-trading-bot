/**
 * NVR-SPEC-035 INV-3 — Prompt coherence.
 *
 * The auditor reads the actual prompt string the model was about to
 * receive and asserts internal arithmetic consistency:
 *
 *   - portfolioValueClaimed in the capture matches state.trading.totalPortfolioValue
 *     within $0.50 (allows for cycle-tick drift between capture-time and
 *     end-of-cycle audit-time)
 *   - the prompt does NOT contain a per-token realizedPnL or unrealizedPnL
 *     figure greater than 5× totalPortfolioValue (catches "perfSummary"
 *     style aggregations of poisoned cost-basis)
 *   - the prompt does NOT contain an unrealized-PnL figure greater than
 *     2× totalPortfolioValue on any visible position (the bot can't have
 *     2× its portfolio in any single position's unrealized gain)
 *
 * SEVERE on violation. Pause scope: next-llm — the next LLM-driven
 * decision is short-circuited to HOLD until the next clean audit cycle.
 * Deterministic gates (force-sells, trailing stops, breaker exits) keep
 * working — the model was lied to, not the math.
 *
 * This is the direct defense against yesterday's "+$2408.96 unrealized"
 * hallucination on a position that was actually +$72. The model wasn't
 * wrong; the prompt context was poisoned.
 */

import type { Invariant, Violation } from '../types.js';

const PORTFOLIO_VALUE_TOLERANCE_USD = 0.50;
const PORTFOLIO_MULTIPLE_MAX = 5; // single per-token PnL figure cannot exceed 5× portfolio
const UNREALIZED_MULTIPLE_MAX = 2; // single unrealized figure cannot exceed 2× portfolio
const PROMPT_MAX_AGE_CYCLES = 5; // a capture older than this is stale; skip the check

/**
 * Extract every dollar figure from the prompt text that looks like a
 * P&L statement. We're looking for patterns like:
 *   "realizedPnL: -$2,307,308"
 *   "+$2408.96 unrealized"
 *   "P&L $-2651902.15"
 *   "perfSummary: realized $-X / unrealized $Y"
 *
 * Conservatively scoped: only matches numbers explicitly tagged with
 * pnl/realized/unrealized terms in the same window, so a portfolio-
 * value mention like "totalValue $2,853" doesn't trip the check.
 */
function extractPnlFigures(text: string): Array<{ kind: 'realized' | 'unrealized' | 'pnl'; value: number; context: string }> {
  const findings: Array<{ kind: 'realized' | 'unrealized' | 'pnl'; value: number; context: string }> = [];

  // Pattern: keyword within 32 chars of a dollar figure (signed, comma-separated, decimal OK)
  // Examples matched: "realizedPnL: -$2,307,308.73", "+$2408.96 unrealized", "P&L: $-1.2M"
  const dollarFigureRegex = /([+-]?\$?-?[\d,]+(?:\.\d+)?)/g;
  const lowerText = text.toLowerCase();

  for (const match of text.matchAll(dollarFigureRegex)) {
    const idx = match.index ?? 0;
    const raw = match[0];
    // Clean the number: strip $, commas
    const cleaned = raw.replace(/[$,]/g, '');
    const num = Number(cleaned);
    if (!Number.isFinite(num)) continue;
    if (Math.abs(num) < 1000) continue; // skip small figures — we only care about wildly large ones

    // Look at a window 32 chars before + after for context keywords
    const windowStart = Math.max(0, idx - 32);
    const windowEnd = Math.min(text.length, idx + raw.length + 32);
    const ctx = lowerText.slice(windowStart, windowEnd);

    let kind: 'realized' | 'unrealized' | 'pnl' | null = null;
    if (ctx.includes('unrealized')) kind = 'unrealized';
    else if (ctx.includes('realized')) kind = 'realized';
    else if (ctx.includes('pnl') || ctx.includes('p&l') || ctx.includes('p&l')) kind = 'pnl';

    if (kind) {
      findings.push({ kind, value: num, context: text.slice(windowStart, windowEnd) });
    }
  }

  return findings;
}

export const promptCoherence: Invariant = (ctx) => {
  const cap = ctx.capturedPrompt;
  if (!cap) return null; // no LLM call happened this cycle, nothing to audit
  if (ctx.totalPortfolioValue <= 0) return null; // can't compute multiples against zero

  // Stale capture? Skip — better than a false positive from drift.
  if (ctx.cycle - cap.cycle > PROMPT_MAX_AGE_CYCLES) return null;

  const issues: string[] = [];
  const observed: Record<string, unknown> = {
    promptCapturedAt: cap.capturedAt,
    captureCycle: cap.cycle,
    captureModel: cap.modelLabel,
    portfolioValueClaimed: cap.portfolioValueClaimed,
    portfolioValueActual: ctx.totalPortfolioValue,
    approxPromptTokens: cap.approxTokens,
  };

  // Check 1: portfolio value the prompt claimed vs the state's current value
  const valueDrift = Math.abs(cap.portfolioValueClaimed - ctx.totalPortfolioValue);
  if (valueDrift > PORTFOLIO_VALUE_TOLERANCE_USD) {
    issues.push(`portfolio-value drift: prompt claimed $${cap.portfolioValueClaimed.toFixed(2)}, state holds $${ctx.totalPortfolioValue.toFixed(2)} (Δ$${valueDrift.toFixed(2)} > $${PORTFOLIO_VALUE_TOLERANCE_USD})`);
  }

  // Check 2 + 3: scan the prompt for absurd PnL figures
  const figures = extractPnlFigures(cap.text);
  const portfolioCeiling = ctx.totalPortfolioValue * PORTFOLIO_MULTIPLE_MAX;
  const unrealizedCeiling = ctx.totalPortfolioValue * UNREALIZED_MULTIPLE_MAX;

  const poisonedFigures = figures.filter(f => {
    const ceiling = f.kind === 'unrealized' ? unrealizedCeiling : portfolioCeiling;
    return Math.abs(f.value) > ceiling;
  });

  if (poisonedFigures.length > 0) {
    // Worst-first for log readability
    poisonedFigures.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    observed.poisonedFigures = poisonedFigures.slice(0, 5); // cap log size
    observed.poisonedFigureCount = poisonedFigures.length;
    issues.push(`prompt contains ${poisonedFigures.length} PnL figure(s) exceeding portfolio multiples; worst: ${poisonedFigures[0].kind} = $${poisonedFigures[0].value.toLocaleString()}`);
  }

  if (issues.length === 0) return null;

  observed.issues = issues;

  const violation: Violation = {
    invariantId: 'INV-3',
    invariantName: 'prompt-coherence',
    severity: 'SEVERE',
    message: `LLM prompt failed coherence check: ${issues.join('; ')}`,
    observed,
    expected: {
      rule: `prompt's portfolioValueClaimed within $${PORTFOLIO_VALUE_TOLERANCE_USD} of state.totalPortfolioValue AND no per-token PnL figure > ${PORTFOLIO_MULTIPLE_MAX}× portfolio AND no unrealized figure > ${UNREALIZED_MULTIPLE_MAX}× portfolio`,
    },
    pauseScope: 'next-llm',
    detectedAt: new Date().toISOString(),
  };

  return violation;
};
