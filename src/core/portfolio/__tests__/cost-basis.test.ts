import { describe, it, expect, beforeEach } from 'vitest';
import { setState, getState } from '../../state/index.js';
import {
  getOrCreateCostBasis,
  updateCostBasisAfterBuy,
  updateCostBasisAfterSell,
  updateUnrealizedPnL,
  identifyDustCostBasisEntries,
  runDustPruneMigrationOnce,
  identifyDustV2CostBasisEntries,
  runDustPruneV2MigrationOnce,
  DUST_PRUNE_V2_THRESHOLD_USD,
} from '../cost-basis.js';

import type { TokenCostBasis } from '../../types/index.js';
import type { AgentState } from '../../types/state.js';

type CostBasisMap = Record<string, TokenCostBasis>;
type PriceMap = Record<string, { price: number; [key: string]: any }>;

/** Create a minimal AgentState with a fresh costBasis map for testing. */
function initTestState(): CostBasisMap {
  const costBasis: CostBasisMap = {};
  // Provide a minimal AgentState stub with costBasis populated.
  // Only the fields used by portfolio functions need to be present.
  setState({
    costBasis,
    errorLog: [],
    tradeFailures: {},
  } as unknown as AgentState);
  return costBasis;
}

// ===========================================================================
// getOrCreateCostBasis
// ===========================================================================
describe('getOrCreateCostBasis', () => {
  beforeEach(() => { initTestState(); });

  it('creates a new zero-valued entry for an unknown symbol', () => {
    const cb = getOrCreateCostBasis('ETH');
    expect(cb.symbol).toBe('ETH');
    expect(cb.totalInvestedUSD).toBe(0);
    expect(cb.totalTokensAcquired).toBe(0);
    expect(cb.averageCostBasis).toBe(0);
    expect(cb.realizedPnL).toBe(0);
  });

  it('returns the existing entry when called twice', () => {
    const first = getOrCreateCostBasis('ETH');
    first.totalInvestedUSD = 500;
    const second = getOrCreateCostBasis('ETH');
    expect(second.totalInvestedUSD).toBe(500);
    expect(second).toBe(first); // same reference
  });
});

// ===========================================================================
// updateCostBasisAfterBuy — new position
// ===========================================================================
describe('updateCostBasisAfterBuy', () => {
  beforeEach(() => { initTestState(); });

  it('records a new position correctly', () => {
    const map = initTestState();
    const prices: PriceMap = { ETH: { price: 2500 } };
    updateCostBasisAfterBuy('ETH', 500, 0.2, prices);

    const cb = map['ETH'];
    expect(cb.totalInvestedUSD).toBe(500);
    expect(cb.totalTokensAcquired).toBe(0.2);
    expect(cb.averageCostBasis).toBe(2500); // 500 / 0.2
  });

  it('averages into an existing position at a different price', () => {
    const map = initTestState();
    const prices: PriceMap = { ETH: { price: 2500 } };

    // First buy: $500 for 0.2 ETH  -> avg = $2500
    updateCostBasisAfterBuy('ETH', 500, 0.2, prices);
    // Second buy: $600 for 0.2 ETH -> avg = (500+600)/0.4 = $2750
    updateCostBasisAfterBuy('ETH', 600, 0.2, prices);

    const cb = map['ETH'];
    expect(cb.totalInvestedUSD).toBe(1100);
    expect(cb.totalTokensAcquired).toBeCloseTo(0.4);
    expect(cb.averageCostBasis).toBeCloseTo(2750);
  });

  it('handles zero tokensReceived by estimating from price map', () => {
    const map = initTestState();
    const prices: PriceMap = { ETH: { price: 2000 } };
    updateCostBasisAfterBuy('ETH', 1000, 0, prices);

    const cb = map['ETH'];
    // Should estimate 1000/2000 = 0.5 tokens
    expect(cb.totalTokensAcquired).toBeCloseTo(0.5);
    expect(cb.averageCostBasis).toBeCloseTo(2000);
  });

  it('bails out when tokensReceived=0 and no known price', () => {
    const map = initTestState();
    const prices: PriceMap = {};
    updateCostBasisAfterBuy('ETH', 1000, 0, prices);

    const cb = map['ETH'];
    expect(cb.totalInvestedUSD).toBe(0); // should not have been updated
    expect(cb.totalTokensAcquired).toBe(0);
  });

  it('resets peakPrice on re-entry after a full exit', () => {
    const map = initTestState();
    const prices: PriceMap = { ETH: { price: 3000 } };

    // First buy sets peakPrice
    updateCostBasisAfterBuy('ETH', 600, 0.2, prices);
    const cb = map['ETH'];
    expect(cb.peakPrice).toBe(3000); // 600/0.2

    // Simulate full exit
    cb.currentHolding = 0;
    cb.totalTokensAcquired = 0;

    // Re-entry at lower price
    updateCostBasisAfterBuy('ETH', 400, 0.2, prices);
    expect(cb.peakPrice).toBe(2000); // 400/0.2 — reset, not the old 3000
  });
});

// ===========================================================================
// updateCostBasisAfterSell — realized P&L
// ===========================================================================
describe('updateCostBasisAfterSell', () => {
  beforeEach(() => { initTestState(); });

  it('calculates positive realized P&L on a profitable partial sell', () => {
    const map = initTestState();
    const prices: PriceMap = { ETH: { price: 2500 } };

    // Buy 1 ETH at $2500
    updateCostBasisAfterBuy('ETH', 2500, 1, prices);

    // Sell 0.5 ETH at $3000 each = $1500 received
    const pnl = updateCostBasisAfterSell('ETH', 1500, 0.5);

    // P&L = (3000 - 2500) * 0.5 = $250
    expect(pnl).toBeCloseTo(250);
    expect(map['ETH'].realizedPnL).toBeCloseTo(250);
    expect(map['ETH'].totalTokensAcquired).toBeCloseTo(0.5);
  });

  it('calculates negative realized P&L on a losing sell', () => {
    const map = initTestState();
    const prices: PriceMap = { ETH: { price: 2500 } };

    // Buy 1 ETH at $2500
    updateCostBasisAfterBuy('ETH', 2500, 1, prices);

    // Sell 1 ETH at $2000 each = $2000 received
    const pnl = updateCostBasisAfterSell('ETH', 2000, 1);

    // P&L = (2000 - 2500) * 1 = -$500
    expect(pnl).toBeCloseTo(-500);
    expect(map['ETH'].realizedPnL).toBeCloseTo(-500);
    expect(map['ETH'].totalTokensAcquired).toBeCloseTo(0);
  });

  it('returns 0 when there is no cost basis (treats as revenue-neutral)', () => {
    initTestState();
    // Sell without ever buying — no cost basis
    const pnl = updateCostBasisAfterSell('ETH', 500, 0.1);
    expect(pnl).toBe(0);
  });

  it('reduces totalInvestedUSD proportionally on partial sell', () => {
    const map = initTestState();
    const prices: PriceMap = { ETH: { price: 2000 } };

    updateCostBasisAfterBuy('ETH', 2000, 1, prices);
    // Sell half
    updateCostBasisAfterSell('ETH', 1200, 0.5);

    // Invested should drop by 50%
    expect(map['ETH'].totalInvestedUSD).toBeCloseTo(1000);
  });
});

// ===========================================================================
// updateUnrealizedPnL
// ===========================================================================
describe('updateUnrealizedPnL', () => {
  beforeEach(() => { initTestState(); });

  it('computes unrealized P&L from current price vs avg cost', () => {
    const map = initTestState();
    const prices: PriceMap = { ETH: { price: 2000 } };
    updateCostBasisAfterBuy('ETH', 2000, 1, prices);

    const balances = [
      { symbol: 'ETH', balance: 1, usdValue: 2500, price: 2500 },
    ];
    updateUnrealizedPnL(balances);

    // Unrealized = (2500 - 2000) * 1 = $500
    expect(map['ETH'].unrealizedPnL).toBeCloseTo(500);
    expect(map['ETH'].currentHolding).toBe(1);
  });

  it('skips USDC entries', () => {
    const map = initTestState();
    const balances = [
      { symbol: 'USDC', balance: 1000, usdValue: 1000, price: 1 },
    ];
    updateUnrealizedPnL(balances);
    expect(map['USDC']).toBeUndefined();
  });
});

// ===========================================================================
// identifyDustCostBasisEntries — pure function (v21.28 dust prune)
// ===========================================================================

/**
 * Helper — build a TokenCostBasis with the minimum fields the dust
 * classifier reads (totalTokensAcquired, averageCostBasis).
 */
function cb(totalTokensAcquired: number, averageCostBasis: number): TokenCostBasis {
  return {
    symbol: 'TEST',
    totalInvestedUSD: totalTokensAcquired * averageCostBasis,
    totalTokensAcquired,
    averageCostBasis,
    realizedPnL: 0,
    unrealizedPnL: 0,
    currentHolding: totalTokensAcquired,
    firstBuyDate: '2026-01-01T00:00:00Z',
    lastTradeDate: '2026-01-01T00:00:00Z',
    peakPrice: averageCostBasis,
    peakPriceDate: '2026-01-01T00:00:00Z',
    atrStopPercent: null,
    atrTrailPercent: null,
    atrAtEntry: null,
    trailActivated: false,
    lastAtrUpdate: null,
  } as TokenCostBasis;
}

describe('identifyDustCostBasisEntries', () => {
  it('flags a non-cohort position with sub-$1 invested AND market value as dust', () => {
    const costBasis = { TOSHI: cb(38, 0.00017) }; // residual ~$0.0065, market ~$0.0064
    const valueMap = { TOSHI: 0.0065 };
    const prunable = identifyDustCostBasisEntries(costBasis, valueMap, 1.0);
    expect(prunable).toEqual(['TOSHI']);
  });

  it('PRESERVES a cohort token even when its current value is dust', () => {
    // The CLAUDE.md Option B Rule 1: cohort is locked. LINK at $0.27 in
    // yesterday's balances should NEVER get pruned.
    const costBasis = { LINK: cb(0.028, 9.17) }; // residual ~$0.26
    const valueMap = { LINK: 0.27 };
    const prunable = identifyDustCostBasisEntries(costBasis, valueMap, 1.0);
    expect(prunable).toEqual([]);
  });

  it('PRESERVES a mooner: tiny invested residual but large current market value', () => {
    // The safety belt: BOTH checks must trip. A pre-acquired tiny stake
    // whose price 1000x'd should keep its cost-basis entry.
    const costBasis = { MOONER: cb(0.001, 0.10) }; // invested residual = $0.0001
    const valueMap = { MOONER: 250 }; // but the position is worth $250 now
    const prunable = identifyDustCostBasisEntries(costBasis, valueMap, 1.0);
    expect(prunable).toEqual([]);
  });

  it('PRESERVES a position whose invested residual is dust but market value is above threshold', () => {
    const costBasis = { X: cb(100, 0.005) }; // residual $0.50
    const valueMap = { X: 5.0 };              // current $5.00 — keep
    expect(identifyDustCostBasisEntries(costBasis, valueMap, 1.0)).toEqual([]);
  });

  it('PRESERVES a position whose market value is dust but invested residual is above threshold', () => {
    // This is the truly painful case — a real $500 loser. We do NOT
    // want to silently drop it from the registry: the cost-basis entry
    // is the only memory we have of that capital outflow. The user can
    // explicitly clean these up in a separate operation.
    const costBasis = { LOSER: cb(100, 5.0) }; // residual $500
    const valueMap = { LOSER: 0.10 };
    expect(identifyDustCostBasisEntries(costBasis, valueMap, 1.0)).toEqual([]);
  });

  it('handles a missing valueMap entry as 0', () => {
    const costBasis = { GHOST: cb(0.0001, 0.001) }; // residual ~$0
    const valueMap = {}; // no entry — treat as 0
    expect(identifyDustCostBasisEntries(costBasis, valueMap, 1.0)).toEqual(['GHOST']);
  });

  it('returns the prunable list sorted alphabetically', () => {
    const costBasis = {
      ZZZ: cb(0.001, 0.001),
      AAA: cb(0.001, 0.001),
      MMM: cb(0.001, 0.001),
    };
    const valueMap = { ZZZ: 0.01, AAA: 0.01, MMM: 0.01 };
    expect(identifyDustCostBasisEntries(costBasis, valueMap, 1.0)).toEqual(['AAA', 'MMM', 'ZZZ']);
  });

  it('respects a custom threshold', () => {
    const costBasis = { X: cb(10, 0.3) }; // residual $3
    const valueMap = { X: 2.8 };
    expect(identifyDustCostBasisEntries(costBasis, valueMap, 1.0)).toEqual([]); // not dust at $1
    expect(identifyDustCostBasisEntries(costBasis, valueMap, 5.0)).toEqual(['X']); // dust at $5
  });

  it('respects a custom protected-symbols list', () => {
    const costBasis = { FOO: cb(0.001, 0.001) };
    const valueMap = { FOO: 0 };
    expect(identifyDustCostBasisEntries(costBasis, valueMap, 1.0, ['FOO'])).toEqual([]);
    expect(identifyDustCostBasisEntries(costBasis, valueMap, 1.0, [])).toEqual(['FOO']);
  });
});

// ===========================================================================
// runDustPruneMigrationOnce — orchestrator (flag-gated, mutates state)
// ===========================================================================

describe('runDustPruneMigrationOnce', () => {
  /** Seed a complete-enough AgentState for the orchestrator. */
  function seedState(opts: {
    costBasis: Record<string, TokenCostBasis>;
    balances: Array<{ symbol: string; balance: number; usdValue: number; price?: number }>;
    migrationFlagAlreadySet?: boolean;
  }): AgentState {
    const stateStub = {
      costBasis: opts.costBasis,
      errorLog: [],
      tradeFailures: {},
      trading: {
        balances: opts.balances,
      },
    } as unknown as AgentState;
    if (opts.migrationFlagAlreadySet) {
      (stateStub as any)._migrationDustPruneV21_28 = true;
    }
    setState(stateStub);
    return stateStub;
  }

  it('prunes the expected dust entries and leaves the rest', () => {
    const state = seedState({
      costBasis: {
        WETH: cb(0.948, 2057.67),
        cbLTC: cb(3.7, 54.13),
        TOSHI: cb(38, 0.00017),
        VADER: cb(143, 0.00316),
        LUNA: cb(53, 0.00771),
        LINK: cb(0.028, 9.17),
      },
      balances: [
        { symbol: 'USDC', balance: 600, usdValue: 600 },
        { symbol: 'WETH', balance: 0.948, usdValue: 2021 },
        { symbol: 'cbLTC', balance: 3.7, usdValue: 201 },
        { symbol: 'TOSHI', balance: 38, usdValue: 0.0065 },
        { symbol: 'VADER', balance: 143, usdValue: 0.37 },
        { symbol: 'LUNA', balance: 53, usdValue: 0.31 },
        { symbol: 'LINK', balance: 0.028, usdValue: 0.27 },
      ],
    });
    const pruned = runDustPruneMigrationOnce(1.0);
    expect(pruned).toEqual(['LUNA', 'TOSHI', 'VADER']);
    expect(state.costBasis.WETH).toBeDefined();
    expect(state.costBasis.cbLTC).toBeDefined();
    expect(state.costBasis.LINK).toBeDefined(); // cohort-protected
    expect(state.costBasis.TOSHI).toBeUndefined();
    expect(state.costBasis.VADER).toBeUndefined();
    expect(state.costBasis.LUNA).toBeUndefined();
    expect((state as any)._migrationDustPruneV21_28).toBe(true);
  });

  it('is idempotent — second call no-ops and returns null', () => {
    seedState({
      costBasis: { GHOST: cb(0.001, 0.001) },
      balances: [{ symbol: 'GHOST', balance: 0.001, usdValue: 0 }],
    });
    runDustPruneMigrationOnce(1.0);
    expect(getState().costBasis.GHOST).toBeUndefined();
    // Re-create a dust entry; second run should not touch it because flag is set.
    getState().costBasis.NEW_DUST = cb(0.001, 0.001);
    const second = runDustPruneMigrationOnce(1.0);
    expect(second).toBeNull();
    expect(getState().costBasis.NEW_DUST).toBeDefined();
  });

  it('defers (returns null) when balances are empty — flag NOT set', () => {
    const state = seedState({
      costBasis: { GHOST: cb(0.001, 0.001) },
      balances: [], // wallet not polled yet
    });
    const result = runDustPruneMigrationOnce(1.0);
    expect(result).toBeNull();
    expect(state.costBasis.GHOST).toBeDefined(); // unchanged
    expect((state as any)._migrationDustPruneV21_28).toBeFalsy(); // can retry next cycle
  });

  it('no-ops cleanly when nothing in the registry is dust', () => {
    const state = seedState({
      costBasis: { WETH: cb(0.948, 2057.67) },
      balances: [{ symbol: 'WETH', balance: 0.948, usdValue: 2021 }],
    });
    const pruned = runDustPruneMigrationOnce(1.0);
    expect(pruned).toEqual([]);
    expect(state.costBasis.WETH).toBeDefined();
    expect((state as any)._migrationDustPruneV21_28).toBe(true);
  });
});


// ===========================================================================
// identifyDustV2CostBasisEntries + runDustPruneV2MigrationOnce
// — single-factor stricter sweep targeting stale per-unit math.
// Catches the 2026-05-21 INV-1 SEVERE class: entries where
// currentHolding × averageCostBasis is below the $0.10 floor.
// ===========================================================================

describe('identifyDustV2CostBasisEntries', () => {
  function entry(holding: number, avgCost: number, invested = 100): TokenCostBasis {
    return {
      symbol: 'X',
      totalInvestedUSD: invested,
      totalTokensAcquired: holding,
      averageCostBasis: avgCost,
      currentHolding: holding,
      realizedPnL: 0,
    } as TokenCostBasis;
  }

  it('returns empty when nothing is sub-threshold', () => {
    const result = identifyDustV2CostBasisEntries({
      WETH: entry(1, 2000),       // 1 × 2000 = $2000 → healthy
      cbLTC: entry(3.7, 54),      // = $200 → healthy
    });
    expect(result).toEqual([]);
  });

  it('catches stale per-unit math (the SPX case)', () => {
    // The class that poisoned Henry's main bot for 33h: a previous unit-
    // conversion bug stored averageCostBasis with the wrong decimals, so
    // currentHolding × averageCostBasis produces something like $3.77e-6.
    const result = identifyDustV2CostBasisEntries({
      WETH: entry(1, 2000),
      SPX: entry(1e-15, 3_770_000_000),   // 3.77e-6 — well below $0.10
    });
    expect(result).toEqual(['SPX']);
  });

  it('catches sub-cent per-unit values regardless of cause', () => {
    const result = identifyDustV2CostBasisEntries({
      WETH: entry(1, 2000),
      TINY_A: entry(0.0001, 100),  // = $0.01 → prune
      TINY_B: entry(1e-9, 1e6),    // = $0.001 → prune
      KEEP: entry(0.001, 200),     // = $0.20 → above floor → keep
    });
    expect(result).toEqual(['TINY_A', 'TINY_B']);
  });

  it('protects cohort symbols even if their per-unit math is dust', () => {
    // A cohort token (e.g. cbXRP) with sub-floor per-unit math is preserved
    // — we won't auto-prune positions the strategy is supposed to be running.
    const result = identifyDustV2CostBasisEntries({
      cbXRP: entry(0.0001, 1),     // = $0.0001 — dust, but cohort-protected
      RANDOM: entry(0.0001, 1),    // = $0.0001 — not cohort → prune
    });
    expect(result).toEqual(['RANDOM']);
  });

  it('respects custom thresholds', () => {
    // Lower threshold catches less, higher catches more
    const cb = { TINY: entry(0.001, 50) }; // = $0.05
    expect(identifyDustV2CostBasisEntries(cb, 0.01)).toEqual([]);     // below threshold
    expect(identifyDustV2CostBasisEntries(cb, 0.10)).toEqual(['TINY']); // at default
    expect(identifyDustV2CostBasisEntries(cb, 1.00)).toEqual(['TINY']); // catches it
  });
});

describe('runDustPruneV2MigrationOnce', () => {
  function seedV2State(costBasis: Record<string, TokenCostBasis>, flagSet = false): AgentState {
    const stateStub = {
      costBasis,
      errorLog: [],
      tradeFailures: {},
    } as unknown as AgentState;
    if (flagSet) {
      (stateStub as any)._migrationDustPruneV2 = true;
    }
    setState(stateStub);
    return stateStub;
  }

  function entry(holding: number, avgCost: number): TokenCostBasis {
    return {
      symbol: 'X', totalInvestedUSD: 100, totalTokensAcquired: holding,
      averageCostBasis: avgCost, currentHolding: holding, realizedPnL: 0,
    } as TokenCostBasis;
  }

  it('prunes the per-unit dust and leaves the rest', () => {
    const state = seedV2State({
      WETH: entry(1, 2000),
      SPX: entry(1e-15, 3_770_000_000),
      TINY: entry(0.0001, 100),
    });
    const pruned = runDustPruneV2MigrationOnce();
    expect(pruned).toEqual(['SPX', 'TINY']);
    expect(state.costBasis.WETH).toBeDefined();
    expect(state.costBasis.SPX).toBeUndefined();
    expect(state.costBasis.TINY).toBeUndefined();
    expect((state as any)._migrationDustPruneV2).toBe(true);
  });

  it('is idempotent — second call no-ops', () => {
    const state = seedV2State({
      SPX: entry(1e-15, 3_770_000_000),
    }, /* flagSet */ true);
    const pruned = runDustPruneV2MigrationOnce();
    expect(pruned).toBeNull();
    expect(state.costBasis.SPX).toBeDefined(); // not touched
  });

  it('uses the documented default threshold', () => {
    expect(DUST_PRUNE_V2_THRESHOLD_USD).toBe(0.10);
  });

  it('returns empty + sets flag when no dust to prune', () => {
    const state = seedV2State({
      WETH: entry(1, 2000),
    });
    const pruned = runDustPruneV2MigrationOnce();
    expect(pruned).toEqual([]);
    expect((state as any)._migrationDustPruneV2).toBe(true);
  });
});
