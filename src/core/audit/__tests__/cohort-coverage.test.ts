/**
 * INV-5 tests — cohort coverage (Phase B, WARN tier).
 *
 * The forcing function: WARN every cycle until the Option B 7-quality
 * cohort is actually held in non-dust size.
 *
 * Case study is Henry's main bot on 2026-05-21: holds WETH ($1,186) +
 * cbLTC ($199) of the 7, dust positions in cbBTC / cbXRP / LINK, and
 * cbADA + cbSOL completely missing — six days after the Option B pivot.
 */

import { describe, it, expect } from 'vitest';
import { cohortCoverage } from '../invariants/cohort-coverage.js';
import { COHORT_QUALITY_7_SYMBOLS } from '../../config/token-registry.js';
import type { InvariantContext } from '../types.js';

function makeCtx(overrides: Partial<InvariantContext> = {}): InvariantContext {
  return {
    balances: [],
    totalPortfolioValue: 3000,
    costBasis: {},
    lastKnownPrices: {},
    capturedPrompt: null,
    cycle: 100,
    previousReport: null,
    auditorCyclesRun: 5,
    liveOnChainSnapshot: null,
    chainDepositHistory: null,
    botTotalDeposited: null,
    ...overrides,
  };
}

function fullCohortBalances(usdPerToken = 200) {
  return COHORT_QUALITY_7_SYMBOLS.map(symbol => ({
    symbol,
    balance: 1,
    usdValue: usdPerToken,
  }));
}

describe('INV-5 cohort coverage — gating', () => {
  it('returns null when portfolio is below the $500 skip threshold', () => {
    // Small bot — fire-on-warmup would just be noise
    const ctx = makeCtx({ totalPortfolioValue: 400, balances: [] });
    expect(cohortCoverage(ctx)).toBeNull();
  });
});

describe('INV-5 — happy path (fully covered)', () => {
  it('returns null when every cohort symbol is held in non-dust size', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 1400,
      balances: fullCohortBalances(200),
    });
    expect(cohortCoverage(ctx)).toBeNull();
  });

  it('returns null when each position is exactly at the $50 floor', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 1000,
      balances: COHORT_QUALITY_7_SYMBOLS.map(symbol => ({
        symbol,
        balance: 1,
        usdValue: 50,
      })),
    });
    expect(cohortCoverage(ctx)).toBeNull();
  });
});

describe("INV-5 — the 2026-05-21 case-study (Henry's main bot)", () => {
  it('fires WARN with the actual Henry-bot snapshot (2 covered, 3 dust, 2 missing)', () => {
    // Mirrors what /api/balances returned for Henry's bot at session start.
    const ctx = makeCtx({
      totalPortfolioValue: 3066,
      balances: [
        { symbol: 'USDC',  balance: 1098.5, usdValue: 1098.5 },
        { symbol: 'WETH',  balance: 0.56,   usdValue: 1186.18 },  // covered
        { symbol: 'cbLTC', balance: 3.70,   usdValue: 198.89 },   // covered
        { symbol: 'cbBTC', balance: 0.0000091, usdValue: 0.70 },  // dust
        { symbol: 'cbXRP', balance: 0.17,   usdValue: 0.23 },     // dust
        { symbol: 'LINK',  balance: 0.028,  usdValue: 0.27 },     // dust
        { symbol: 'aBasUSDC', balance: 545, usdValue: 545.57 },
        // cbADA + cbSOL completely absent
      ],
    });

    const v = cohortCoverage(ctx);
    expect(v).not.toBeNull();
    expect(v!.invariantId).toBe('INV-5');
    expect(v!.severity).toBe('WARN');
    expect(v!.pauseScope).toBe('none');
    const obs = v!.observed as any;
    expect(obs.covered).toEqual(['WETH', 'cbLTC']);
    expect(obs.missing).toEqual(['cbADA', 'cbSOL']);
    expect(obs.dust.map((d: any) => d.symbol)).toEqual(['cbBTC', 'cbXRP', 'LINK']);
    expect(obs.coveredCount).toBe(2);
    expect(obs.cohortSize).toBe(7);
    expect(v!.message).toMatch(/5\/7 cohort symbols are uncovered/);
    expect(v!.message).toMatch(/cbADA, cbSOL/);
    expect(v!.message).toMatch(/cbBTC, cbXRP, LINK/);
  });
});

describe('INV-5 — partial coverage shapes', () => {
  it('treats $0 balance as missing, not dust', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 2000,
      balances: COHORT_QUALITY_7_SYMBOLS.slice(0, 5).map(symbol => ({
        symbol, balance: 1, usdValue: 100,
      })),
    });
    const v = cohortCoverage(ctx);
    expect(v).not.toBeNull();
    const obs = v!.observed as any;
    expect(obs.missing).toEqual(['cbADA', 'cbSOL']);
    expect(obs.dust).toEqual([]);
    expect(obs.coveredCount).toBe(5);
  });

  it('treats sub-$50 balance as dust, not missing', () => {
    const balances = COHORT_QUALITY_7_SYMBOLS.map((symbol, idx) => ({
      symbol,
      balance: 1,
      usdValue: idx < 6 ? 100 : 25,  // last one is dust
    }));
    const ctx = makeCtx({ totalPortfolioValue: 625, balances });
    const v = cohortCoverage(ctx);
    expect(v).not.toBeNull();
    const obs = v!.observed as any;
    expect(obs.missing).toEqual([]);
    expect(obs.dust).toEqual([{ symbol: 'cbSOL', usdValue: 25 }]);
    expect(obs.coveredCount).toBe(6);
  });

  it('aggregates multiple balance entries for the same symbol', () => {
    // Defensive: if balances accidentally has two WETH entries, sum them.
    const ctx = makeCtx({
      totalPortfolioValue: 2000,
      balances: [
        ...COHORT_QUALITY_7_SYMBOLS.map(symbol => ({ symbol, balance: 1, usdValue: 100 })),
        { symbol: 'WETH', balance: 0.01, usdValue: 25 }, // duplicate, sums to 125
      ],
    });
    expect(cohortCoverage(ctx)).toBeNull();
  });
});

describe('INV-5 — emits a useful observed payload', () => {
  it('includes cohort, threshold, and portfolio value', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 1200,
      balances: [{ symbol: 'WETH', balance: 1, usdValue: 1100 }],
    });
    const v = cohortCoverage(ctx);
    expect(v).not.toBeNull();
    const obs = v!.observed as any;
    expect(obs.cohort).toEqual([...COHORT_QUALITY_7_SYMBOLS]);
    expect(obs.minPositionUsd).toBe(50);
    expect(obs.portfolioValue).toBe(1200);
    expect(obs.cohortSize).toBe(7);
  });
});
