/**
 * INV-10 tests — chain-truth reconciliation (Phase A.1).
 *
 * The case-study test is the May-20 aUSDC scenario: in-state says $2,650
 * portfolio, chain truth says $3,080 because aUSDC is in the wallet but
 * not in `state.trading.balances`. INV-10 must fire SEVERE.
 */

import { describe, it, expect } from 'vitest';
import { chainTruthReconciliation } from '../invariants/chain-truth-reconciliation.js';
import type { InvariantContext } from '../types.js';
import type { LiveOnChainSnapshot } from '../sources/live-onchain.js';

function snapshot(opts: Partial<LiveOnChainSnapshot> & { totalUsd: number; capturedAt?: string }): LiveOnChainSnapshot {
  return {
    walletAddress: '0xB7c51b1A8F967eF6BF906Fe4B484817Fe784a7C1',
    capturedAt: opts.capturedAt ?? new Date().toISOString(),
    balances: opts.balances ?? [],
    totalUsd: opts.totalUsd,
    fullyPriced: opts.fullyPriced ?? true,
    complete: opts.complete ?? true,
    errors: opts.errors ?? [],
  };
}

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
    ...overrides,
  };
}

describe('INV-10 chain-truth reconciliation — gating', () => {
  it('returns null when no snapshot was captured this cycle', () => {
    expect(chainTruthReconciliation(makeCtx({ liveOnChainSnapshot: null }))).toBeNull();
  });

  it('returns null when snapshot is stale (> 30 min old)', () => {
    const oldCapture = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const snap = snapshot({ totalUsd: 5000, capturedAt: oldCapture });
    expect(chainTruthReconciliation(makeCtx({ liveOnChainSnapshot: snap, totalPortfolioValue: 3000 }))).toBeNull();
  });

  it('returns null when snapshot is incomplete (RPC errors)', () => {
    const snap = snapshot({ totalUsd: 5000, complete: false, errors: ['cbBTC: timeout'] });
    expect(chainTruthReconciliation(makeCtx({ liveOnChainSnapshot: snap, totalPortfolioValue: 3000 }))).toBeNull();
  });

  it('returns null when snapshot is not fully priced (warmup)', () => {
    const snap = snapshot({ totalUsd: 3000, fullyPriced: false });
    expect(chainTruthReconciliation(makeCtx({ liveOnChainSnapshot: snap, totalPortfolioValue: 3000 }))).toBeNull();
  });

  it('returns null when portfolio is below the min threshold', () => {
    const snap = snapshot({ totalUsd: 30 });
    expect(chainTruthReconciliation(makeCtx({ liveOnChainSnapshot: snap, totalPortfolioValue: 30 }))).toBeNull();
  });
});

describe('INV-10 — agreement case (clean)', () => {
  it('returns null when sources B/C/D all agree exactly', () => {
    const snap = snapshot({
      totalUsd: 3000,
      balances: [
        { symbol: 'WETH', contractAddress: '0x4200000000000000000000000000000000000006', balance: 1, decimals: 18, usdValueChainTruth: 2000, priceResolved: true },
        { symbol: 'USDC', contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', balance: 1000, decimals: 6, usdValueChainTruth: 1000, priceResolved: true },
      ],
    });
    const ctx = makeCtx({
      liveOnChainSnapshot: snap,
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
      ],
    });
    expect(chainTruthReconciliation(ctx)).toBeNull();
  });

  it('returns null when delta is below the 5% tolerance band', () => {
    const snap = snapshot({
      totalUsd: 3050, // 1.67% above in-state
      balances: [
        { symbol: 'WETH', contractAddress: '0x4200', balance: 1, decimals: 18, usdValueChainTruth: 2050, priceResolved: true },
        { symbol: 'USDC', contractAddress: '0x8335', balance: 1000, decimals: 6, usdValueChainTruth: 1000, priceResolved: true },
      ],
    });
    const ctx = makeCtx({
      liveOnChainSnapshot: snap,
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
      ],
    });
    expect(chainTruthReconciliation(ctx)).toBeNull();
  });
});

describe('INV-10 — the May-20 aUSDC scenario (the case-study)', () => {
  it('fires SEVERE when chain has aBasUSDC that in-state balances is missing', () => {
    // Replicate exactly what we found on prod 2026-05-20 morning before PR #32:
    //   in-state: USDC + WETH + cbLTC etc = $2,650 (no aUSDC)
    //   on-chain: same + aBasUSDC $430 = $3,080
    const snap = snapshot({
      totalUsd: 3080,
      balances: [
        { symbol: 'USDC',     contractAddress: '0x8335', balance: 933, decimals: 6, usdValueChainTruth: 933,  priceResolved: true },
        { symbol: 'WETH',     contractAddress: '0x4200', balance: 0.689, decimals: 18, usdValueChainTruth: 1473, priceResolved: true },
        { symbol: 'cbLTC',    contractAddress: '0xcb17', balance: 3.7, decimals: 18, usdValueChainTruth: 200,  priceResolved: true },
        { symbol: 'ETH',      contractAddress: 'native', balance: 0.005, decimals: 18, usdValueChainTruth: 11,   priceResolved: true },
        { symbol: 'ENA',      contractAddress: '0x58d9', balance: 189, decimals: 18, usdValueChainTruth: 20,   priceResolved: true },
        // THE GHOST POSITION — present on chain, invisible to in-state
        { symbol: 'aBasUSDC', contractAddress: '0x4e65', balance: 433, decimals: 6, usdValueChainTruth: 433,  priceResolved: true },
        // … plus dust elided
      ],
    });
    const ctx = makeCtx({
      liveOnChainSnapshot: snap,
      totalPortfolioValue: 2650, // in-state, missing the $430 yield position
      balances: [
        { symbol: 'USDC',  balance: 933, usdValue: 933 },
        { symbol: 'WETH',  balance: 0.689, usdValue: 1473 },
        { symbol: 'cbLTC', balance: 3.7, usdValue: 200 },
        { symbol: 'ETH',   balance: 0.005, usdValue: 11 },
        { symbol: 'ENA',   balance: 189, usdValue: 20 },
        // aBasUSDC deliberately omitted — pre-PR-#32 state
      ],
    });

    const v = chainTruthReconciliation(ctx);
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('SEVERE');
    expect(v!.invariantId).toBe('INV-10');
    expect(v!.pauseScope).toBe('all-buys');
    const observed = v!.observed as any;
    expect(observed.onChainMissingInState).toContain('aBasUSDC');
    expect(observed.inStateMissingOnChain).toEqual([]);
    expect(parseFloat(observed.relDeltaCD_pct)).toBeGreaterThan(5);
  });

  it('identifies the inverse — bot claims a position that chain says it does not have', () => {
    const snap = snapshot({
      totalUsd: 1000,
      balances: [{ symbol: 'USDC', contractAddress: '0x8335', balance: 1000, decimals: 6, usdValueChainTruth: 1000, priceResolved: true }],
    });
    const ctx = makeCtx({
      liveOnChainSnapshot: snap,
      totalPortfolioValue: 2500, // ghost position inflates in-state
      balances: [
        { symbol: 'USDC',  balance: 1000, usdValue: 1000 },
        { symbol: 'cbBTC', balance: 0.02, usdValue: 1500 }, // chain doesn't see this
      ],
    });
    const v = chainTruthReconciliation(ctx);
    expect(v).not.toBeNull();
    const observed = v!.observed as any;
    expect(observed.inStateMissingOnChain).toContain('cbBTC');
  });
});

describe('INV-10 — emits useful observed payload', () => {
  it('includes all three pairwise deltas and snapshot age', () => {
    const snap = snapshot({
      totalUsd: 5000,
      balances: [{ symbol: 'WETH', contractAddress: '0x4200', balance: 2.5, decimals: 18, usdValueChainTruth: 5000, priceResolved: true }],
    });
    const ctx = makeCtx({
      liveOnChainSnapshot: snap,
      totalPortfolioValue: 3000,
      balances: [{ symbol: 'WETH', balance: 1.5, usdValue: 3000 }],
    });
    const v = chainTruthReconciliation(ctx);
    expect(v).not.toBeNull();
    const obs = v!.observed as any;
    expect(typeof obs.relDeltaBD_pct).toBe('string');
    expect(typeof obs.relDeltaCD_pct).toBe('string');
    expect(typeof obs.snapshotAgeSec).toBe('number');
    expect(obs.sourceD_liveOnChainTotal).toBe(5000);
    expect(obs.sourceC_totalPortfolioValue).toBe(3000);
  });
});
