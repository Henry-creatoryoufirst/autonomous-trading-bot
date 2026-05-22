/**
 * NVR-SPEC-035 Phase A.1 — INV-10 wired-end-to-end smoke test.
 *
 * This is the "ship-it-wired" proof for INV-10. The unit test in
 * `chain-truth-reconciliation.test.ts` covers the invariant function in
 * isolation, but a green unit test means nothing if the call site at
 * `agent-v3.2.ts` line ~2287 hands `liveOnChainSnapshot: null` into the
 * orchestrator every cycle (which it did for the four-day window before
 * this PR landed — dormant code).
 *
 * This test exercises the orchestrator the way the agent does:
 *   1. Build a mock LiveOnChainSnapshot returned from
 *      `captureLiveOnChainSnapshot()`-shaped data.
 *   2. Hand it to `runSystemAuditor({ ..., liveOnChainSnapshot: snap, ... })`
 *      exactly like agent-v3.2.ts does after this PR.
 *   3. Assert INV-10 is in the report's violations when the snapshot
 *      disagrees with in-state, and absent when sources agree.
 *
 * If the orchestrator ever loses the `liveOnChainSnapshot` plumbing, or
 * if INV-10 is removed from the registry, these tests fail loudly. They
 * are the contract that the wiring is alive end-to-end, not just at the
 * unit level.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  runSystemAuditor,
  _internals,
  type AuditorDeps,
} from '../system-auditor.js';
import type { LiveOnChainSnapshot } from '../sources/live-onchain.js';

// ============================================================================
// FIXTURES
// ============================================================================

/**
 * Build a clean baseline `AuditorDeps`. Mirrors the honestDeps() shape used
 * in system-auditor.test.ts so the Phase A + Phase B invariants outside
 * INV-10 don't fire and pollute the report — we want the test to be a
 * focused "INV-10 wiring is alive" assertion, not a noise filter.
 */
function honestDeps(overrides: Partial<AuditorDeps> = {}): AuditorDeps {
  const cohortTail = [
    { symbol: 'cbBTC', balance: 0.001, usdValue: 50, price: 50000 },
    { symbol: 'cbXRP', balance: 50,    usdValue: 50, price: 1 },
    { symbol: 'cbLTC', balance: 1,     usdValue: 50, price: 50 },
    { symbol: 'LINK',  balance: 5,     usdValue: 50, price: 10 },
    { symbol: 'cbADA', balance: 100,   usdValue: 50, price: 0.5 },
    { symbol: 'cbSOL', balance: 0.3,   usdValue: 50, price: 166.67 },
  ];
  const cohortCostBasis: AuditorDeps['costBasis'] = {};
  const cohortPrices: AuditorDeps['lastKnownPrices'] = {};
  for (const { symbol, balance, price } of cohortTail) {
    cohortCostBasis[symbol] = {
      symbol,
      realizedPnL: 0,
      totalInvestedUSD: balance * price,
      totalTokensAcquired: balance,
      averageCostBasis: price,
      currentHolding: balance,
    };
    cohortPrices[symbol] = { price };
  }
  const baselineCostBasis = {
    WETH: {
      symbol: 'WETH', realizedPnL: 87, totalInvestedUSD: 1705,
      totalTokensAcquired: 0.81, averageCostBasis: 2105, currentHolding: 0.81,
    },
    ...cohortCostBasis,
  };
  const baselinePrices = { WETH: { price: 2105 }, ...cohortPrices };
  const { costBasis: cbOverride, lastKnownPrices: lkpOverride, ...rest } = overrides;
  return {
    balances: [
      { symbol: 'WETH', balance: 0.81, usdValue: 1700 },
      { symbol: 'USDC', balance: 1000, usdValue: 1000 },
      ...cohortTail.map(({ symbol, balance, usdValue }) => ({ symbol, balance, usdValue })),
    ],
    totalPortfolioValue: 3000,
    costBasis: { ...baselineCostBasis, ...(cbOverride ?? {}) },
    lastKnownPrices: { ...baselinePrices, ...(lkpOverride ?? {}) },
    cycle: 1,
    ...rest,
  };
}

/**
 * Build a synthetic `LiveOnChainSnapshot` for the mock. Shape mirrors what
 * `captureLiveOnChainSnapshot()` returns; the auditor never knows the
 * snapshot came from a mock vs a real eth_call sweep.
 */
function buildMockSnapshot(opts: {
  totalUsd: number;
  balances: LiveOnChainSnapshot['balances'];
  capturedAt?: string;
  complete?: boolean;
  fullyPriced?: boolean;
  errors?: string[];
}): LiveOnChainSnapshot {
  return {
    walletAddress: '0xB7c51b1A8F967eF6BF906Fe4B484817Fe784a7C1',
    capturedAt: opts.capturedAt ?? new Date().toISOString(),
    balances: opts.balances,
    totalUsd: opts.totalUsd,
    fullyPriced: opts.fullyPriced ?? true,
    complete: opts.complete ?? true,
    errors: opts.errors ?? [],
  };
}

beforeEach(() => {
  _internals.reset();
  process.env.SYSTEM_AUDITOR_ENABLED = 'true';
  delete process.env.SYSTEM_AUDITOR_ALERT_MODE;
});

// ============================================================================
// SMOKE TESTS — does the wiring actually consume the snapshot?
// ============================================================================

describe('INV-10 wired — orchestrator consumes liveOnChainSnapshot in deps', () => {
  it('fires SEVERE end-to-end when the snapshot disagrees with in-state', async () => {
    // Replicate the May-20 aUSDC drift: chain has $3,080 (includes $430 aUSDC
    // ghost), in-state only sees $2,650. This is exactly the case the
    // 4-week dormant-code window let slip past the auditor.
    const driftedSnapshot = buildMockSnapshot({
      totalUsd: 3080,
      balances: [
        { symbol: 'USDC',     contractAddress: '0x8335', balance: 933,   decimals: 6,  usdValueChainTruth: 933,  priceResolved: true },
        { symbol: 'WETH',     contractAddress: '0x4200', balance: 0.689, decimals: 18, usdValueChainTruth: 1473, priceResolved: true },
        { symbol: 'cbLTC',    contractAddress: '0xcb17', balance: 3.7,   decimals: 18, usdValueChainTruth: 200,  priceResolved: true },
        { symbol: 'aBasUSDC', contractAddress: '0x4e65', balance: 433,   decimals: 6,  usdValueChainTruth: 433,  priceResolved: true },
        // remaining positions priced into totalUsd but elided for brevity
        { symbol: 'cbBTC', contractAddress: '0xcbB7', balance: 0.0008, decimals: 8,  usdValueChainTruth: 41,  priceResolved: true },
      ],
    });

    const deps = honestDeps({
      // In-state is missing the ghost yield position
      liveOnChainSnapshot: driftedSnapshot,
      totalPortfolioValue: 2650,
      balances: [
        { symbol: 'USDC',  balance: 933,   usdValue: 933 },
        { symbol: 'WETH',  balance: 0.689, usdValue: 1473 },
        { symbol: 'cbLTC', balance: 3.7,   usdValue: 200 },
        // aBasUSDC deliberately omitted — pre-PR-#32 state
      ],
    });

    const report = await runSystemAuditor(deps);
    expect(report).not.toBeNull();
    const inv10 = report!.violations.find(v => v.invariantId === 'INV-10');
    expect(inv10, 'INV-10 should be in the violations list — wiring broken if undefined').toBeDefined();
    expect(inv10!.severity).toBe('SEVERE');
    expect(inv10!.pauseScope).toBe('all-buys');
    expect((inv10!.observed as any).onChainMissingInState).toContain('aBasUSDC');
  });

  it('stays quiet end-to-end when the snapshot agrees with in-state', async () => {
    // Same numbers across all three sources B, C, D — INV-10 should be silent.
    const cleanSnapshot = buildMockSnapshot({
      totalUsd: 3000,
      balances: [
        { symbol: 'WETH', contractAddress: '0x4200', balance: 0.81, decimals: 18, usdValueChainTruth: 1700, priceResolved: true },
        { symbol: 'USDC', contractAddress: '0x8335', balance: 1000, decimals: 6,  usdValueChainTruth: 1000, priceResolved: true },
        { symbol: 'cbBTC', contractAddress: '0xcbB7', balance: 0.001, decimals: 8,  usdValueChainTruth: 50,  priceResolved: true },
        { symbol: 'cbXRP', contractAddress: '0xcb58', balance: 50, decimals: 6,    usdValueChainTruth: 50,  priceResolved: true },
        { symbol: 'cbLTC', contractAddress: '0xcb17', balance: 1, decimals: 8,     usdValueChainTruth: 50,  priceResolved: true },
        { symbol: 'LINK',  contractAddress: '0x88Fb', balance: 5, decimals: 18,    usdValueChainTruth: 50,  priceResolved: true },
        { symbol: 'cbADA', contractAddress: '0xcbad', balance: 100, decimals: 6,   usdValueChainTruth: 50,  priceResolved: true },
        { symbol: 'cbSOL', contractAddress: '0x2f28', balance: 0.3, decimals: 18,  usdValueChainTruth: 50,  priceResolved: true },
      ],
    });

    const report = await runSystemAuditor(honestDeps({ liveOnChainSnapshot: cleanSnapshot }));
    expect(report).not.toBeNull();
    const inv10 = report!.violations.find(v => v.invariantId === 'INV-10');
    expect(inv10, 'INV-10 should not fire when all sources agree').toBeUndefined();
  });

  it('skips INV-10 (no violation) when deps omit liveOnChainSnapshot — proves dormant-code regression detection', async () => {
    // The exact bug we're guarding against. If a future refactor strips the
    // `liveOnChainSnapshot` field from the call site, the auditor will go
    // back to receiving null and INV-10 will silently never fire. This
    // test enforces that omission == null == silence (the absence
    // itself isn't a violation, but the snapshot-driven SEVERE in the
    // sibling test IS, which proves wiring works only when populated).
    const report = await runSystemAuditor(honestDeps({ liveOnChainSnapshot: null }));
    expect(report).not.toBeNull();
    const inv10 = report!.violations.find(v => v.invariantId === 'INV-10');
    expect(inv10).toBeUndefined();
  });

  it('respects the 30-min snapshot age cap (silent on stale snapshot)', async () => {
    // Caller responsibility: if the snapshot is older than 30 min, INV-10
    // gates itself off rather than firing on stale data. This protects
    // against the operational case where the chain-snapshot capture has
    // been failing silently for a while.
    const oldCapture = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const staleSnapshot = buildMockSnapshot({
      totalUsd: 5000, // would normally trigger SEVERE vs the $3,000 in-state
      balances: [
        { symbol: 'WETH', contractAddress: '0x4200', balance: 2.5, decimals: 18, usdValueChainTruth: 5000, priceResolved: true },
      ],
      capturedAt: oldCapture,
    });
    const report = await runSystemAuditor(honestDeps({ liveOnChainSnapshot: staleSnapshot }));
    expect(report).not.toBeNull();
    const inv10 = report!.violations.find(v => v.invariantId === 'INV-10');
    expect(inv10).toBeUndefined();
  });

  it('sets the all-buys blocker when INV-10 fires (verifies severity routing wiring)', async () => {
    // Beyond surfacing a violation, INV-10 must translate to a
    // SystemHealthBlocker with pauseScope='all-buys'. This is the bridge
    // between detection and trade-execution gating.
    const driftedSnapshot = buildMockSnapshot({
      totalUsd: 4500, // 50% above in-state
      balances: [
        { symbol: 'WETH', contractAddress: '0x4200', balance: 1.5, decimals: 18, usdValueChainTruth: 3000, priceResolved: true },
        { symbol: 'USDC', contractAddress: '0x8335', balance: 1500, decimals: 6, usdValueChainTruth: 1500, priceResolved: true },
      ],
    });
    const report = await runSystemAuditor(honestDeps({ liveOnChainSnapshot: driftedSnapshot }));
    expect(report).not.toBeNull();
    expect(report!.blockerActive).toBe(true);
    const inv10 = report!.violations.find(v => v.invariantId === 'INV-10');
    expect(inv10).toBeDefined();
    expect(inv10!.severity).toBe('SEVERE');
    expect(inv10!.pauseScope).toBe('all-buys');
  });

  it('keeps INV-10 in the orchestrator registry (regression guard)', () => {
    // If someone removes INV-10 from PHASE_A_INVARIANTS, every other test in
    // this file would pass-by-vacuum. This test fails the moment the
    // invariant is dropped from the registry — surfacing the deletion
    // immediately rather than letting it land silently.
    const ids = _internals.invariants.map(i => i.id);
    expect(ids).toContain('INV-10');
  });
});
