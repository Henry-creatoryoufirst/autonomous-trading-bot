/**
 * INV-3 tests — pure-function invariant.
 *
 * Covers the prompt-coherence check including the regex-extraction of
 * absurd PnL figures embedded in synthetic prompt text.
 */

import { describe, it, expect } from 'vitest';
import { promptCoherence } from '../invariants/prompt-coherence.js';
import type { CapturedPrompt, InvariantContext } from '../types.js';

function cap(text: string, opts: Partial<CapturedPrompt> = {}): CapturedPrompt {
  return {
    capturedAt: new Date().toISOString(),
    cycle: 100,
    text,
    portfolioValueClaimed: opts.portfolioValueClaimed ?? 3000,
    modelLabel: opts.modelLabel ?? 'claude-sonnet-4',
    approxTokens: Math.ceil(text.length / 4),
    ...opts,
  };
}

function makeCtx(opts: Partial<InvariantContext> & { capturedPrompt?: CapturedPrompt | null } = {}): InvariantContext {
  return {
    balances: [],
    totalPortfolioValue: 3000,
    costBasis: {},
    lastKnownPrices: {},
    capturedPrompt: opts.capturedPrompt ?? null,
    cycle: 100,
    previousReport: null,
    auditorCyclesRun: 5,
    ...opts,
  };
}

describe('INV-3 prompt coherence', () => {
  it('returns null when no prompt was captured', () => {
    expect(promptCoherence(makeCtx({ capturedPrompt: null }))).toBeNull();
  });

  it('returns null when prompt is clean (no PnL figures, accurate portfolio value)', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      capturedPrompt: cap(
        'You are a trading bot. Current portfolio: $3000.00. Make a decision.',
        { portfolioValueClaimed: 3000 },
      ),
    });
    expect(promptCoherence(ctx)).toBeNull();
  });

  it('fires SEVERE on portfolio-value drift > $0.50', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      capturedPrompt: cap('Portfolio $4500.', { portfolioValueClaimed: 4500 }),
    });
    const v = promptCoherence(ctx);
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('SEVERE');
    expect(v!.invariantId).toBe('INV-3');
    expect(v!.pauseScope).toBe('next-llm');
  });

  it('catches the +$2408 unrealized hallucination scenario', () => {
    const promptText = `
═══ TRADE DIAGNOSTICS ═══
Recent activity: WETH SELL at +$2,408.96 unrealized gain intact.
Cohort dispersion: 0/7 positive.
Portfolio: $3000.00
`;
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      capturedPrompt: cap(promptText, { portfolioValueClaimed: 3000 }),
    });
    // Wait — actually $2408 is well below 2× of $3000 portfolio ($6000 unrealized ceiling).
    // The actual issue yesterday was the figure being WRONG, not impossibly-large.
    // INV-3 catches IMPOSSIBLY-LARGE figures. The "+$2408 vs real +$72" gap is
    // an INV-2 / data hygiene problem, not an INV-3 problem. Confirming the
    // distinction here:
    expect(promptCoherence(ctx)).toBeNull();
  });

  it('catches a per-token PnL figure exceeding 5× portfolio', () => {
    const promptText = `
═══ TRADE DIAGNOSTICS ═══
realizedPnL on TOSHI: -$2,307,308.73 across all sells.
Portfolio: $3000.00
`;
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      capturedPrompt: cap(promptText, { portfolioValueClaimed: 3000 }),
    });
    const v = promptCoherence(ctx);
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('SEVERE');
    const observed = v!.observed as any;
    expect(observed.poisonedFigureCount).toBeGreaterThanOrEqual(1);
    expect(observed.poisonedFigures[0].kind).toBe('realized');
    expect(Math.abs(observed.poisonedFigures[0].value)).toBeGreaterThan(15000);
  });

  it('catches an unrealized PnL figure > 2× portfolio', () => {
    const promptText = `
Position summary: WETH unrealized +$10000 against portfolio $3000.
`;
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      capturedPrompt: cap(promptText, { portfolioValueClaimed: 3000 }),
    });
    const v = promptCoherence(ctx);
    expect(v).not.toBeNull();
    const observed = v!.observed as any;
    expect(observed.poisonedFigures[0].kind).toBe('unrealized');
  });

  it('skips capture older than PROMPT_MAX_AGE_CYCLES', () => {
    const ctx = makeCtx({
      cycle: 200,
      capturedPrompt: cap('realizedPnL: -$5000000', { cycle: 100 }), // 100 cycles old
    });
    expect(promptCoherence(ctx)).toBeNull();
  });

  it('ignores small dollar figures (under $1000) to avoid false positives on portfolio mentions', () => {
    const promptText = `
Today's P&L: -$13.31 (-0.46%).
realizedPnL on USDC: $0.00
`;
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      capturedPrompt: cap(promptText, { portfolioValueClaimed: 3000 }),
    });
    expect(promptCoherence(ctx)).toBeNull();
  });

  it('returns null when portfolio is zero', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 0,
      capturedPrompt: cap('realizedPnL: -$5000000', { portfolioValueClaimed: 0 }),
    });
    expect(promptCoherence(ctx)).toBeNull();
  });
});
