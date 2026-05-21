/**
 * NVR-SPEC-035 INV-5 — Cohort coverage (Phase B, WARN tier).
 *
 * Asserts that every symbol in the Option B cohort is held in a
 * non-dust position. Fires WARN every cycle until all 7 are present.
 * The forcing function: the bot can ignore a single missed buy, but it
 * cannot ignore an invariant that names the missing symbols on every
 * heavy-cycle log line.
 *
 * Why WARN, not SEVERE:
 *   - Missing cohort coverage is not a safety failure — the bot's accounting
 *     of what it holds is correct (INV-1/INV-10 cover that). The issue is
 *     STRATEGIC: capital is parked elsewhere when the strategy claims to be
 *     running the 7-quality cohort. Punishing trading with all-buys pause
 *     would prevent the bot from BUYING the missing positions — the opposite
 *     of what we want.
 *
 * Coverage threshold:
 *   - A position is "covered" when usdValue ≥ MIN_POSITION_USD ($50).
 *   - Below that (and above 0) → "dust" (held, but not a real allocation).
 *   - Zero balance → "missing".
 *
 * Why $50:
 *   - The dust-prune floor in the cost-basis registry is $5. A real
 *     allocation must be at least 10× the dust floor — anything smaller
 *     is residue from past trades, not strategic exposure.
 *   - A 7-token cohort × $50 = $350 floor, comfortably under the $500
 *     skip-portfolio threshold; the math is reachable for any non-tiny bot.
 *
 * Skip condition: portfolio < $500 (or unreadable). Small bots can't
 * meaningfully diversify across 7 names; fire-on-warmup would just be noise.
 */

import type { Invariant, Violation } from '../types.js';
import { COHORT_QUALITY_7_SYMBOLS } from '../../config/token-registry.js';

const MIN_POSITION_USD = 50;
const MIN_PORTFOLIO_USD = 500;

export const cohortCoverage: Invariant = (ctx) => {
  if (ctx.totalPortfolioValue < MIN_PORTFOLIO_USD) return null;

  const bySymbol = new Map<string, number>();
  for (const b of ctx.balances) {
    bySymbol.set(b.symbol, (bySymbol.get(b.symbol) ?? 0) + (b.usdValue ?? 0));
  }

  const covered: string[] = [];
  const dust: Array<{ symbol: string; usdValue: number }> = [];
  const missing: string[] = [];

  for (const symbol of COHORT_QUALITY_7_SYMBOLS) {
    const usd = bySymbol.get(symbol) ?? 0;
    if (usd >= MIN_POSITION_USD) {
      covered.push(symbol);
    } else if (usd > 0) {
      dust.push({ symbol, usdValue: usd });
    } else {
      missing.push(symbol);
    }
  }

  if (covered.length === COHORT_QUALITY_7_SYMBOLS.length) return null;

  const uncoveredCount = dust.length + missing.length;
  const violation: Violation = {
    invariantId: 'INV-5',
    invariantName: 'cohort-coverage',
    severity: 'WARN',
    message: `${uncoveredCount}/${COHORT_QUALITY_7_SYMBOLS.length} cohort symbols are uncovered (missing: [${missing.join(', ') || 'none'}], dust: [${dust.map(d => d.symbol).join(', ') || 'none'}]). Cohort strategy is not actually running.`,
    observed: {
      cohort: [...COHORT_QUALITY_7_SYMBOLS],
      covered,
      dust,
      missing,
      coveredCount: covered.length,
      cohortSize: COHORT_QUALITY_7_SYMBOLS.length,
      minPositionUsd: MIN_POSITION_USD,
      portfolioValue: ctx.totalPortfolioValue,
    },
    expected: {
      rule: `every cohort symbol held with usdValue ≥ $${MIN_POSITION_USD}`,
    },
    pauseScope: 'none',
    detectedAt: new Date().toISOString(),
  };

  return violation;
};
