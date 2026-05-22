/**
 * System Auditor orchestrator tests.
 *
 * Covers: enable/disable gating, prompt capture, severity routing,
 * blocker derivation across multiple invariants, the trade-execution
 * gate semantics, log-only-mode behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  runSystemAuditor,
  captureLastPrompt,
  canExecuteAction,
  getCurrentBlocker,
  getMonitorStats,
  clearBlocker,
  _internals,
  type AuditorDeps,
} from '../system-auditor.js';

function poisonedCostBasis() {
  // Only TOSHI is poisoned. Tests that use this fixture rely on the merge
  // behavior in honestDeps() to keep the baseline WETH + cohort costBasis
  // entries — so INV-1 stays clean and only INV-2 (TOSHI realizedPnL
  // phantom) fires. (Prior versions of this fixture also overrode WETH; the
  // 2026-05-22 INV-1 orphan-balances fix exposed that the override pushed
  // source A out of agreement with sources B + C. Keeping baseline WETH
  // here is the simpler invariant.)
  return {
    TOSHI: {
      symbol: 'TOSHI',
      realizedPnL: -2_307_308,
      totalInvestedUSD: 1792,
      totalTokensAcquired: 38,
      averageCostBasis: 0.000183,
      currentHolding: 38,
    },
  };
}

function honestDeps(overrides: Partial<AuditorDeps> = {}): AuditorDeps {
  // Baseline must be honest across every invariant (Phase A + Phase B).
  // Cohort coverage (INV-5, Phase B) requires every COHORT_QUALITY_7
  // symbol held with usdValue ≥ $50 — six are added here at exactly the
  // floor so the "happy path" tests stay clean and INV-1's three-way
  // valuation cross-check still balances.
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
    WETH: { symbol: 'WETH', realizedPnL: 87, totalInvestedUSD: 1705, totalTokensAcquired: 0.81, averageCostBasis: 2105, currentHolding: 0.81 },
    ...cohortCostBasis,
  };
  const baselinePrices = { WETH: { price: 2105 }, ...cohortPrices };
  // Merge (not replace) overrides for costBasis + lastKnownPrices so that
  // tests overriding ONE entry (e.g. poisoning TOSHI) keep the rest of the
  // honest cohort intact. Without this merge, INV-1's orphan-balances check
  // (2026-05-22) trips because the cohort balances would have no costBasis
  // baseline to anchor against — masking the per-token-buys scope under
  // an INV-1 all-buys blocker.
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

beforeEach(() => {
  _internals.reset();
  // Default to enabled for these tests; individual tests can override
  process.env.SYSTEM_AUDITOR_ENABLED = 'true';
  delete process.env.SYSTEM_AUDITOR_ALERT_MODE;
});

describe('runSystemAuditor — gating', () => {
  it('is a no-op when SYSTEM_AUDITOR_ENABLED is unset', async () => {
    delete process.env.SYSTEM_AUDITOR_ENABLED;
    const report = await runSystemAuditor(honestDeps());
    expect(report).toBeNull();
    expect(getMonitorStats().cyclesRun).toBe(0);
    expect(getMonitorStats().cyclesSkipped).toBe(1);
  });

  it('runs when enabled and returns a report', async () => {
    const report = await runSystemAuditor(honestDeps());
    expect(report).not.toBeNull();
    expect(report!.cycle).toBe(1);
    expect(report!.violations.length).toBe(0);
    expect(report!.blockerActive).toBe(false);
  });
});

describe('runSystemAuditor — INV-2 catches TOSHI poison', () => {
  it('fires SEVERE and sets per-token-buys blocker for TOSHI', async () => {
    const report = await runSystemAuditor(honestDeps({ costBasis: poisonedCostBasis() }));
    expect(report).not.toBeNull();
    const inv2 = report!.violations.find(v => v.invariantId === 'INV-2');
    expect(inv2).toBeDefined();
    expect(inv2!.severity).toBe('SEVERE');
    expect(inv2!.affectedTokens).toContain('TOSHI');
    const blocker = getCurrentBlocker();
    expect(blocker?.active).toBe(true);
    expect(blocker?.pauseScope).toBe('per-token-buys');
    expect(blocker?.affectedTokens).toContain('TOSHI');
  });
});

describe('canExecuteAction — pause-scope routing', () => {
  it('always allows when auditor is disabled', () => {
    delete process.env.SYSTEM_AUDITOR_ENABLED;
    expect(canExecuteAction({ action: 'BUY', symbol: 'TOSHI', source: 'llm' }).allowed).toBe(true);
  });

  it('always allows SELLs and HOLDs regardless of blocker', async () => {
    await runSystemAuditor(honestDeps({ costBasis: poisonedCostBasis() }));
    expect(canExecuteAction({ action: 'SELL', symbol: 'TOSHI', source: 'llm' }).allowed).toBe(true);
    expect(canExecuteAction({ action: 'HOLD', source: 'llm' }).allowed).toBe(true);
  });

  it('blocks BUYs only for affected tokens under per-token-buys scope', async () => {
    await runSystemAuditor(honestDeps({ costBasis: poisonedCostBasis() }));
    expect(canExecuteAction({ action: 'BUY', symbol: 'TOSHI', source: 'llm' }).allowed).toBe(false);
    expect(canExecuteAction({ action: 'BUY', symbol: 'WETH', source: 'llm' }).allowed).toBe(true); // clean token
  });

  it('blocks all BUYs under all-buys scope (INV-1 dimensional honesty)', async () => {
    // INV-1 fires on disagreement: totalPortfolioValue says $3000, balances say $1500
    await runSystemAuditor(honestDeps({
      totalPortfolioValue: 3000,
      balances: [{ symbol: 'WETH', balance: 0.5, usdValue: 1000 }, { symbol: 'USDC', balance: 500, usdValue: 500 }],
      costBasis: { WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 1000, totalTokensAcquired: 0.5, averageCostBasis: 2000, currentHolding: 0.5 } },
      lastKnownPrices: { WETH: { price: 2000 } },
    }));
    const blocker = getCurrentBlocker();
    expect(blocker?.active).toBe(true);
    expect(blocker?.pauseScope).toBe('all-buys');
    expect(canExecuteAction({ action: 'BUY', symbol: 'WETH', source: 'llm' }).allowed).toBe(false);
    expect(canExecuteAction({ action: 'BUY', symbol: 'AERO', source: 'llm' }).allowed).toBe(false);
    expect(canExecuteAction({ action: 'SELL', symbol: 'WETH', source: 'llm' }).allowed).toBe(true);
  });

  it('blocks deterministic calls only when scope is all-buys or per-token-buys', async () => {
    await runSystemAuditor(honestDeps({ costBasis: poisonedCostBasis() }));
    // per-token scope blocks both llm and deterministic BUYs of affected tokens
    expect(canExecuteAction({ action: 'BUY', symbol: 'TOSHI', source: 'deterministic' }).allowed).toBe(false);
  });
});

describe('blocker lifecycle', () => {
  it('auto-clears the blocker on the next clean cycle', async () => {
    // First cycle: TOSHI poisoned → blocker set
    await runSystemAuditor(honestDeps({ costBasis: poisonedCostBasis(), cycle: 1 }));
    expect(getCurrentBlocker()?.active).toBe(true);

    // Second cycle: clean cost basis → blocker should clear
    await runSystemAuditor(honestDeps({ cycle: 2 }));
    expect(getCurrentBlocker()).toBeNull();
  });

  it('clearBlocker() escape hatch works', async () => {
    await runSystemAuditor(honestDeps({ costBasis: poisonedCostBasis() }));
    expect(getCurrentBlocker()?.active).toBe(true);
    clearBlocker('test escape hatch');
    expect(getCurrentBlocker()).toBeNull();
  });

  it('increments consecutiveCycles when same invariant trips multiple cycles', async () => {
    await runSystemAuditor(honestDeps({ costBasis: poisonedCostBasis(), cycle: 1 }));
    expect(getCurrentBlocker()?.consecutiveCycles).toBe(1);
    await runSystemAuditor(honestDeps({ costBasis: poisonedCostBasis(), cycle: 2 }));
    expect(getCurrentBlocker()?.consecutiveCycles).toBe(2);
  });
});

describe('captureLastPrompt', () => {
  it('is a no-op when disabled', () => {
    delete process.env.SYSTEM_AUDITOR_ENABLED;
    captureLastPrompt({ text: 'hello', portfolioValueClaimed: 3000, modelLabel: 'sonnet', cycle: 1 });
    expect(getMonitorStats().capturedPromptCount).toBe(0);
  });

  it('stashes the prompt for INV-3 to consume', async () => {
    captureLastPrompt({
      text: 'realizedPnL on TOSHI: -$2,307,308',
      portfolioValueClaimed: 3000,
      modelLabel: 'sonnet',
      cycle: 1,
    });
    expect(getMonitorStats().capturedPromptCount).toBe(1);
    const report = await runSystemAuditor(honestDeps({ cycle: 1 }));
    const inv3 = report!.violations.find(v => v.invariantId === 'INV-3');
    expect(inv3).toBeDefined();
    expect(inv3!.severity).toBe('SEVERE');
  });
});

describe('next-llm pause-scope consumption', () => {
  it('blocks exactly one llm-source call then auto-clears', async () => {
    // Force INV-3 by capturing a bad prompt
    captureLastPrompt({
      text: 'realizedPnL on TOSHI: -$5,000,000',
      portfolioValueClaimed: 3000,
      modelLabel: 'sonnet',
      cycle: 1,
    });
    await runSystemAuditor(honestDeps({ cycle: 1 }));

    // The first llm-source call gets blocked + the blocker clears
    const first = canExecuteAction({ action: 'BUY', symbol: 'WETH', source: 'llm' });
    expect(first.allowed).toBe(false);

    // Next llm-source call is allowed (blocker was consumed)
    const second = canExecuteAction({ action: 'BUY', symbol: 'WETH', source: 'llm' });
    expect(second.allowed).toBe(true);
  });

  it('does not consume the blocker on deterministic-source calls', async () => {
    captureLastPrompt({ text: 'realizedPnL on TOSHI: -$5,000,000', portfolioValueClaimed: 3000, modelLabel: 'sonnet', cycle: 1 });
    await runSystemAuditor(honestDeps({ cycle: 1 }));

    // Deterministic calls pass through without consuming
    expect(canExecuteAction({ action: 'BUY', symbol: 'WETH', source: 'deterministic' }).allowed).toBe(true);
    // The blocker is still there for the next llm call
    expect(canExecuteAction({ action: 'BUY', symbol: 'WETH', source: 'llm' }).allowed).toBe(false);
  });
});

describe('isolation against thrown invariants', () => {
  it('continues even if one invariant function throws', async () => {
    // Inject a throwing invariant alongside the real ones
    const original = [..._internals.invariants];
    _internals.invariants.length = 0;
    _internals.invariants.push(
      { id: 'INV-1', fn: () => { throw new Error('synthetic explosion'); } },
      ...original.filter(i => i.id !== 'INV-1'),
    );

    try {
      const report = await runSystemAuditor(honestDeps({ costBasis: poisonedCostBasis() }));
      const thrown = report!.violations.find(v => v.invariantId === 'INV-1');
      expect(thrown).toBeDefined();
      expect(thrown!.invariantName).toBe('INV-1-threw');
      // INV-2 still fired on TOSHI despite INV-1's bomb
      const inv2 = report!.violations.find(v => v.invariantId === 'INV-2');
      expect(inv2).toBeDefined();
    } finally {
      // Restore the registry for downstream tests
      _internals.invariants.length = 0;
      _internals.invariants.push(...original);
    }
  });
});

describe('alert mode auto-flip', () => {
  it('reports log-only mode by default', () => {
    const stats = getMonitorStats();
    expect(stats.alertMode).toBe('log-only');
  });

  it('respects SYSTEM_AUDITOR_ALERT_MODE env override', () => {
    process.env.SYSTEM_AUDITOR_ALERT_MODE = 'alert';
    expect(getMonitorStats().alertMode).toBe('alert');
    process.env.SYSTEM_AUDITOR_ALERT_MODE = 'disabled';
    expect(getMonitorStats().alertMode).toBe('disabled');
  });
});

// ============================================================================
// 2026-05-22 — INV-9 noise-reduction integration smoke test.
//
// Reproduces the master-fleet pattern that motivated this change: two
// consecutive auditor runs where the second is one cycle ahead of where
// the first cycle's persisted report says it should be (the canonical
// persistence-race / routine-non-auditor-cycle pattern). Pre-fix this
// produced a SEVERE INV-9 + a `next-llm` blocker that polluted
// currentBlocker.invariantId for one out of every ~1.5 cycles on
// master. Post-fix: no SEVERE, no blocker, auditor still functioning.
// ============================================================================

describe('INV-9 missed-cycle blocker false-positive (2026-05-22 noise-reduction)', () => {
  it('one-cycle skip between auditor runs produces NO SEVERE INV-9 + NO blocker', async () => {
    // First cycle: clean run. Establishes prev.cycle = 5.
    const firstReport = await runSystemAuditor(honestDeps({ cycle: 5 }));
    expect(firstReport).not.toBeNull();
    expect(firstReport!.violations.filter(v => v.invariantId === 'INV-9')).toEqual([]);
    expect(getCurrentBlocker()).toBeNull();

    // Second cycle: bot advanced by 2 (one skipped). Pre-fix this was the
    // canonical false-positive — SEVERE INV-9 + next-llm blocker that
    // dominated 73% of currentBlocker.invariantId firings on master fleet.
    const secondReport = await runSystemAuditor(honestDeps({ cycle: 7 }));
    expect(secondReport).not.toBeNull();

    // CONTRACT: the cycle-skip itself must NOT trigger SEVERE INV-9. The
    // delta=2 case is "one skipped cycle" — within ±1 tolerance.
    const inv9Skipped = secondReport!.violations.filter(
      v => v.invariantId === 'INV-9' && (v.observed as { issues?: string[] }).issues?.some(i => i.includes('skipped')),
    );
    expect(inv9Skipped).toEqual([]);

    // CONTRACT: no INV-9 ever appears at SEVERE (downgraded to WARN this PR).
    const inv9Severe = secondReport!.violations.filter(
      v => v.invariantId === 'INV-9' && v.severity === 'SEVERE',
    );
    expect(inv9Severe).toEqual([]);

    // CONTRACT: no blocker — the whole point of the fix. INV-9 firings at
    // WARN have pauseScope='none' so they never set currentBlocker.
    expect(getCurrentBlocker()).toBeNull();
    expect(secondReport!.blockerActive).toBe(false);

    // Auditor still rendered a full report for the right cycle (didn't crash)
    expect(secondReport!.cycle).toBe(7);
  });

  it('multi-cycle skip surfaces INV-9 as WARN with pauseScope=none (no blocker)', async () => {
    // First cycle establishes prev.cycle = 5
    await runSystemAuditor(honestDeps({ cycle: 5 }));
    // Big jump — 4 cycles skipped → above tolerance → WARN
    const report = await runSystemAuditor(honestDeps({ cycle: 10 }));
    const inv9Skipped = report!.violations.find(
      v => v.invariantId === 'INV-9' && (v.observed as { issues?: string[] }).issues?.some(i => i.includes('skipped')),
    );
    expect(inv9Skipped).toBeDefined();
    expect(inv9Skipped!.severity).toBe('WARN');
    expect(inv9Skipped!.pauseScope).toBe('none');
    // WARN-tier INV-9 must NEVER produce a blocker
    expect(getCurrentBlocker()).toBeNull();
  });
});
