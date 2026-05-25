/**
 * INV-11 tests — chain-deposit reconciliation (Phase A.1).
 *
 * The case-study test is the May-20 Zack scenario: bot reports
 * totalDeposited = $846 but chain shows the original $1,000 deposit
 * went to a previous wallet, then $846 was forwarded to the current
 * wallet on the April 17 rotation. INV-11 must catch this.
 */

import { describe, it, expect } from 'vitest';
import { chainDepositReconciliation } from '../invariants/chain-deposit-reconciliation.js';
import type { InvariantContext } from '../types.js';
import type { ChainDepositHistory, DepositRecord } from '../sources/chain-deposit-history.js';

function deposit(opts: { block: number; usd: number; from?: string }): DepositRecord {
  return {
    blockNumber: opts.block,
    txHash: '0x' + opts.block.toString(16).padStart(64, '0'),
    fromAddress: (opts.from ?? '0x20fe51a9229e').toLowerCase(),
    usdValue: opts.usd,
    classification: 'counted-as-deposit',
  };
}

function history(opts: Partial<ChainDepositHistory> & { totalDepositedUsd: number }): ChainDepositHistory {
  return {
    walletAddress: '0x56cd187C8FD50c685376e57ab1836C4e1cde4D26',
    capturedAt: new Date().toISOString(),
    totalDepositedUsd: opts.totalDepositedUsd,
    deposits: opts.deposits ?? [],
    lastScannedBlock: opts.lastScannedBlock ?? 46300000,
    complete: opts.complete ?? true,
    errors: opts.errors ?? [],
    classificationCounts: opts.classificationCounts ?? {
      counted: opts.deposits?.length ?? 0,
      excludedBotTrade: 0,
      excludedKnownRouter: 0,
      excludedDust: 0,
    },
  };
}

function makeCtx(overrides: Partial<InvariantContext> = {}): InvariantContext {
  return {
    balances: [],
    totalPortfolioValue: 700,
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

describe('INV-11 chain-deposit reconciliation — gating', () => {
  it('returns null when no history was captured', () => {
    expect(chainDepositReconciliation(makeCtx({ chainDepositHistory: null }))).toBeNull();
  });

  it('returns null when history scan was incomplete (RPC errors)', () => {
    const h = history({ totalDepositedUsd: 5000, complete: false, errors: ['chunk 1000-2000: timeout'] });
    expect(chainDepositReconciliation(makeCtx({ chainDepositHistory: h, botTotalDeposited: 800 }))).toBeNull();
  });

  it('returns null when botTotalDeposited is missing', () => {
    const h = history({ totalDepositedUsd: 1000 });
    expect(chainDepositReconciliation(makeCtx({ chainDepositHistory: h, botTotalDeposited: null }))).toBeNull();
  });
});

describe('INV-11 — the Zack scenario (the case-study)', () => {
  it('catches wallet-rotation amnesia: bot reports $846 deposited but chain shows $1,000', () => {
    const h = history({
      totalDepositedUsd: 1000.00,
      deposits: [deposit({ block: 12345678, usd: 1000.00, from: '0x20fe51a9229e' })],
    });
    const ctx = makeCtx({
      chainDepositHistory: h,
      botTotalDeposited: 845.86,
      totalPortfolioValue: 699.91,
    });
    const v = chainDepositReconciliation(ctx);
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('SEVERE');
    expect(v!.invariantId).toBe('INV-11');
    expect(v!.pauseScope).toBe('all-displays'); // 2026-05-25: promoted from 'none' — gates dashboard PnL display, leaves trading running
    const observed = v!.observed as any;
    expect(observed.direction).toBe('UNDER-COUNTED');
    expect(observed.unaccountedUsd).toBeCloseTo(154.14, 1);
    expect(observed.chainTotalDepositedUsd).toBe(1000);
    expect(observed.botTotalDepositedUsd).toBeCloseTo(845.86);
    expect(observed.topChainDeposits[0].usdValue).toBe(1000);
  });

  it('catches the inverse: bot reports more deposited than chain shows', () => {
    // Hypothetical: bot's deposit tracking double-counted somehow
    const h = history({
      totalDepositedUsd: 500,
      deposits: [deposit({ block: 12345678, usd: 500 })],
    });
    const ctx = makeCtx({
      chainDepositHistory: h,
      botTotalDeposited: 700, // bot claims more than chain shows
      totalPortfolioValue: 600,
    });
    const v = chainDepositReconciliation(ctx);
    expect(v).not.toBeNull();
    const observed = v!.observed as any;
    expect(observed.direction).toBe('OVER-COUNTED');
    expect(observed.unaccountedUsd).toBe(-200);
  });
});

describe('INV-11 — tolerance bands', () => {
  it('returns null when divergence is small in absolute terms (< $5)', () => {
    const h = history({ totalDepositedUsd: 1000, deposits: [deposit({ block: 1, usd: 1000 })] });
    const ctx = makeCtx({ chainDepositHistory: h, botTotalDeposited: 998, totalPortfolioValue: 1000 });
    expect(chainDepositReconciliation(ctx)).toBeNull();
  });

  it('returns null when divergence is small in portfolio terms (< 2%)', () => {
    // $20 gap on $10K portfolio = 0.2% — under tolerance even though abs > $5
    const h = history({ totalDepositedUsd: 10000, deposits: [deposit({ block: 1, usd: 10000 })] });
    const ctx = makeCtx({ chainDepositHistory: h, botTotalDeposited: 9980, totalPortfolioValue: 10000 });
    expect(chainDepositReconciliation(ctx)).toBeNull();
  });

  it('fires when both abs > $5 AND ratio > 2%', () => {
    // $50 gap on $1000 portfolio = 5% — over both thresholds
    const h = history({ totalDepositedUsd: 1050, deposits: [deposit({ block: 1, usd: 1050 })] });
    const ctx = makeCtx({ chainDepositHistory: h, botTotalDeposited: 1000, totalPortfolioValue: 1000 });
    const v = chainDepositReconciliation(ctx);
    expect(v).not.toBeNull();
  });
});

describe('INV-11 — observed payload', () => {
  it('surfaces the top-5 largest chain deposits for operator visibility', () => {
    const h = history({
      totalDepositedUsd: 2500,
      deposits: [
        deposit({ block: 100, usd: 1000 }),
        deposit({ block: 200, usd: 500 }),
        deposit({ block: 300, usd: 300 }),
        deposit({ block: 400, usd: 200 }),
        deposit({ block: 500, usd: 200 }),
        deposit({ block: 600, usd: 200 }),
        deposit({ block: 700, usd: 50 }),
        deposit({ block: 800, usd: 50 }),
        deposit({ block: 900, usd: 5 }),  // under the $10 threshold for top-list
      ],
    });
    const ctx = makeCtx({ chainDepositHistory: h, botTotalDeposited: 2000, totalPortfolioValue: 2000 });
    const v = chainDepositReconciliation(ctx);
    expect(v).not.toBeNull();
    const observed = v!.observed as any;
    expect(observed.topChainDeposits).toHaveLength(5); // capped at 5
    expect(observed.topChainDeposits[0].usdValue).toBe(1000);
    // Dust (< $10) excluded from top-list
    expect(observed.topChainDeposits.find((d: any) => d.usdValue === 5)).toBeUndefined();
  });
});
