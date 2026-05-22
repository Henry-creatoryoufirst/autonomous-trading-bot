/**
 * INV-1 tests — pure-function invariant. Synthetic state, no network.
 */

import { describe, it, expect } from 'vitest';
import { dimensionalHonesty } from '../invariants/dimensional-honesty.js';
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

describe('INV-1 dimensional honesty', () => {
  it('returns null when portfolio is below the minimum threshold', () => {
    const v = dimensionalHonesty(makeCtx({ totalPortfolioValue: 10 }));
    expect(v).toBeNull();
  });

  it('returns null when all three sources agree exactly', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
      },
      lastKnownPrices: { WETH: { price: 2000 } },
    });
    expect(dimensionalHonesty(ctx)).toBeNull();
  });

  it('returns null when sources agree within tolerance (1% drift)', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2020 }, // 1% above
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
      },
      lastKnownPrices: { WETH: { price: 2000 } },
    });
    expect(dimensionalHonesty(ctx)).toBeNull();
  });

  it('fires SEVERE when balances.usdValue sum diverges from totalPortfolioValue by >2%', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 1500 }, // way below
        { symbol: 'USDC', balance: 100, usdValue: 100 },
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 1500, totalTokensAcquired: 1, averageCostBasis: 1500, currentHolding: 1 },
      },
      lastKnownPrices: { WETH: { price: 1500 } },
    });
    const v = dimensionalHonesty(ctx);
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('SEVERE');
    expect(v!.invariantId).toBe('INV-1');
    expect(v!.pauseScope).toBe('all-buys');
    expect(v!.observed.outlier).toBe('C'); // totalPortfolioValue is the odd one out
  });

  it('identifies the costBasis-position-sum as the outlier when it disagrees with both other sources', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
      ],
      costBasis: {
        // The costBasis insists we hold 10× the WETH we actually own
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 20000, totalTokensAcquired: 10, averageCostBasis: 2000, currentHolding: 10 },
      },
      lastKnownPrices: { WETH: { price: 2000 } },
    });
    const v = dimensionalHonesty(ctx);
    expect(v).not.toBeNull();
    expect(v!.observed.outlier).toBe('A');
  });

  it('emits the three source values + pairwise deltas in observed', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 1500 },
      ],
      costBasis: {},
      lastKnownPrices: { WETH: { price: 1500 } },
    });
    const v = dimensionalHonesty(ctx);
    expect(v).not.toBeNull();
    expect(v!.observed.sourceB_balancesUsdSum).toBe(1500);
    expect(v!.observed.sourceC_totalPortfolioValue).toBe(3000);
    expect(typeof v!.observed.worstDeltaPct).toBe('string');
  });

  // ==========================================================================
  // 2026-05-19 polish: startup data-readiness — INV-1 must stay quiet during
  // price-stream warmup so the post-redeploy false-positive we saw on cycle 2
  // (26% spurious disagreement) doesn't fire.
  // ==========================================================================

  it('skips the check when too many positions are missing live prices (warmup)', () => {
    // Three real positions, only one has a price → coverage 33% < 80%
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'cbLTC', balance: 4, usdValue: 200 },
        { symbol: 'cbXRP', balance: 100, usdValue: 100 },
        { symbol: 'USDC', balance: 700, usdValue: 700 }, // USDC always excluded from readiness check
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
        cbLTC: { symbol: 'cbLTC', realizedPnL: 0, totalInvestedUSD: 200, totalTokensAcquired: 4, averageCostBasis: 50, currentHolding: 4 },
        cbXRP: { symbol: 'cbXRP', realizedPnL: 0, totalInvestedUSD: 100, totalTokensAcquired: 100, averageCostBasis: 1, currentHolding: 100 },
      },
      lastKnownPrices: { WETH: { price: 2000 } }, // only WETH has a price → 1/3 = 33%
    });
    expect(dimensionalHonesty(ctx)).toBeNull();
  });

  it('runs the check when coverage is above the 80% threshold', () => {
    // 4 real positions, 4 have prices → coverage 100%
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'cbLTC', balance: 4, usdValue: 200 },
        { symbol: 'cbXRP', balance: 100, usdValue: 100 },
        { symbol: 'USDC', balance: 700, usdValue: 700 },
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
        cbLTC: { symbol: 'cbLTC', realizedPnL: 0, totalInvestedUSD: 200, totalTokensAcquired: 4, averageCostBasis: 50, currentHolding: 4 },
        cbXRP: { symbol: 'cbXRP', realizedPnL: 0, totalInvestedUSD: 100, totalTokensAcquired: 100, averageCostBasis: 1, currentHolding: 100 },
      },
      lastKnownPrices: {
        WETH: { price: 2000 },
        cbLTC: { price: 50 },
        cbXRP: { price: 1 },
      },
    });
    expect(dimensionalHonesty(ctx)).toBeNull(); // all sources agree
  });

  // ==========================================================================
  // 2026-05-20 regression: YIELD-sector receipt tokens (aUSDC, Morpho shares)
  // live in balances but not in costBasis. INV-1 must include them when
  // building source A or it will fire SEVERE every cycle when the bot has
  // ANY active yield deposit. This case caught the $430 silent under-
  // reporting that prompted PR #32.
  // ==========================================================================
  it('correctly accounts for YIELD-sector tokens (aUSDC, Morpho shares) in source A', () => {
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'USDC', balance: 500, usdValue: 500 },
        // Yield receipt tokens — pre-priced in getBalances() at chain truth
        { symbol: 'aBasUSDC', balance: 300, usdValue: 300, price: 1, sector: 'YIELD' },
        { symbol: 'mUSDC', balance: 150, usdValue: 200, price: 1.33, sector: 'YIELD' },
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
        // Critical: aUSDC + mUSDC are NOT in costBasis — yield is not a tracked position
      },
      lastKnownPrices: { WETH: { price: 2000 } },
    });
    // Source A = sum(costBasis × prices) + cash + yield
    //         = (1 × 2000) + 500 USDC + 300 aUSDC + 200 mUSDC = 3000
    // Source B = sum(balances.usdValue) = 2000 + 500 + 300 + 200 = 3000
    // Source C = totalPortfolioValue = 3000
    // All three agree → null
    expect(dimensionalHonesty(ctx)).toBeNull();
  });

  it('fires SEVERE when YIELD-token usdValue is missing (the bug we just fixed)', () => {
    // Simulates the pre-PR-32 broken state: yield deposit exists on-chain
    // but isn't in balances. Sources A + B + C all "agree" on the wrong
    // (low) number, so this is actually the failure mode INV-1 alone
    // CAN'T catch from in-state sources — it's the case that justifies
    // Phase A.1's live-RPC source. For the test, we model "wrong balances"
    // vs "right totalPortfolioValue" to confirm INV-1 still fires when
    // the disagreement is visible.
    const ctx = makeCtx({
      totalPortfolioValue: 3000, // truth (would include yield)
      balances: [
        // YIELD position deliberately omitted — pre-fix state
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'USDC', balance: 500, usdValue: 500 },
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
      },
      lastKnownPrices: { WETH: { price: 2000 } },
    });
    // Source A + B = 2500, Source C = 3000 → 16.7% disagreement → SEVERE
    const v = dimensionalHonesty(ctx);
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('SEVERE');
    expect(v!.observed.outlier).toBe('C'); // totalPortfolioValue is the odd one out
  });

  it('does not consider sub-$1 dust positions in the readiness check', () => {
    // 1 real position priced + 50 dust positions unpriced → check still runs.
    // Real positions are 100% covered (1/1) so we don't defer for warmup;
    // the unpriced dust doesn't drag coverage down. Sources agree → null.
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 3000 },
        ...Array.from({ length: 50 }, (_, i) => ({
          symbol: `DUST${i}`,
          balance: 1,
          usdValue: 0.01,
        })),
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 3000, totalTokensAcquired: 1, averageCostBasis: 3000, currentHolding: 1 },
      },
      lastKnownPrices: { WETH: { price: 3000 } },
    });
    expect(dimensionalHonesty(ctx)).toBeNull();
  });
});

describe('INV-1 — 2026-05-21 case study: sub-$1 dust in source A', () => {
  // Henry's main bot had INV-1 firing SEVERE for ~33h on 3.15% drift,
  // outlier=A. Cause: stale costBasis entries with bizarre per-unit math
  // (SPX-style averageCostBasis = $3.77B × tiny currentHolding) contributed
  // garbage to source A's position sum without showing up in balances.
  //
  // The fix: source A excludes entries where holding × price < $1.

  it('pre-fix scenario: stale SPX-style entry inflates source A by 3%+', () => {
    // Pre-fix (without the MIN_POSITION_USD_FOR_SOURCE_A gate), this would
    // fire SEVERE with outlier=A. After the fix, it returns null.
    //
    // Real positions: WETH $2000 (priced) + USDC $1000 cash = $3000 honest.
    // Stale costBasis entry: SPX with currentHolding=1e-9 × averageCostBasis=$1e11
    // → contributes ~$100 of phantom value to source A position sum.
    // Source A becomes ~$3100 + cash ($1000) = $4100, but B = $3000 and
    // C = $3000. A/B drift = 27% → SEVERE.
    //
    // With the fix: per-unit value = 1e-9 × 1e11 = $100. Above $1 floor. Hmm.
    // Let me use truly dust numbers: 1e-15 × 1e11 = $1e-4. Below floor.
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
        // The SPX-style poison: holding × cost = 1e-15 × 3.77e9 = 3.77e-6,
        // well below the $1 source-A floor → correctly excluded
        SPX: { symbol: 'SPX', realizedPnL: 32, totalInvestedUSD: 789, totalTokensAcquired: 2, averageCostBasis: 3_770_000_000, currentHolding: 1e-15 },
      },
      lastKnownPrices: { WETH: { price: 2000 }, SPX: { price: 0.38 } },
    });
    expect(dimensionalHonesty(ctx)).toBeNull();
  });

  it('reproduces the May-21 outlier=A drift when 0.0001 WETH × $1M phantom price exists', () => {
    // A subtler version: holding 0.0001 (tiny) × averageCostBasis $1_000_000
    // (way off real WETH price ~$2k) = $100 in source A. Real WETH balance
    // shows the same 0.0001 but at real $2k price = $0.20 (sub-$1 → excluded
    // from balances by other accounting). Source A contributes phantom $100;
    // sources B + C = real $3000.
    //
    // PRE-FIX: source A = $3000 + $100 = $3100. A vs B = 3.2% drift → SEVERE outlier=A.
    // POST-FIX: $100 is above the $1 floor — STILL counted in source A. So the
    // fix only catches sub-$1 phantoms. Larger phantoms ($100+) still surface
    // legitimately; they're symptoms of real bugs that need separate fixing.
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
        // Sub-cent per-unit value (1e-7 × 1) → way below $1 floor → excluded
        DUST_TOKEN: { symbol: 'DUST_TOKEN', realizedPnL: 0, totalInvestedUSD: 100, totalTokensAcquired: 1, averageCostBasis: 1, currentHolding: 1e-7 },
      },
      lastKnownPrices: { WETH: { price: 2000 }, DUST_TOKEN: { price: 1 } },
    });
    // After the source-A fix, this passes cleanly
    expect(dimensionalHonesty(ctx)).toBeNull();
  });

  it('still fires on REAL drift even after the sub-$1 gate is applied', () => {
    // Confirm the fix doesn't accidentally silence legitimate drift. Here
    // a healthy WETH position with REAL >$1 per-unit value is mismatched
    // against totalPortfolioValue → SEVERE outlier=C.
    const ctx = makeCtx({
      totalPortfolioValue: 6000, // 2x the real value — invented
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
      },
      lastKnownPrices: { WETH: { price: 2000 } },
    });
    const v = dimensionalHonesty(ctx);
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('SEVERE');
    expect(v!.observed.outlier).toBe('C');
  });
});

describe('INV-1 — 2026-05-22 case study: orphaned balances (no costBasis entry)', () => {
  // Henry's main bot had INV-1 firing SEVERE for 211 consecutive cycles
  // (~4 days, ~30 hours of paused buys). Yesterday's PR #38 addressed the
  // sub-$1 dust class in source A's costBasis loop, but the dominant
  // contributor turned out to be a different class: tokens in
  // state.trading.balances that have NO entry in state.costBasis.
  //
  // The bot acquired them via non-tracked paths (yield distributions,
  // airdrops, external transfers, cbLTC-style oddball holdings) so the
  // cost-basis tracker was never invoked. Source B (sumBalancesUsd) +
  // source C (totalPortfolioValue) count them naturally; source A's
  // costBasis loop has nothing to add. The gap exceeded the 2% tolerance
  // → SEVERE outlier=A, indefinitely.
  //
  // The fix: source A's third bucket, sumOrphanedBalancesPositions, adds
  // balances entries that are NOT cash/gas, NOT YIELD-sector, NOT covered
  // by costBasis (or covered only by a sub-$1 entry). Mirrors B + C's
  // natural inclusion.

  it('reproduces the 2026-05-22 prod case: balances-only cbLTC + dust causes INV-1 SEVERE', () => {
    // The actual prod cycle that fired SEVERE for 211 cycles:
    //   sourceA=$2977, sourceB=$3080, sourceC=$3080, drift=3.32%, outlier=A
    // Cause: cbLTC carried ~$199 in balances with no costBasis entry, so
    // source A's costBasis loop never touched it. With the orphan helper
    // it gets added to source A and all three sources agree.
    const ctx = makeCtx({
      totalPortfolioValue: 3028,
      balances: [
        { symbol: 'WETH', balance: 0.593, usdValue: 1186 },
        { symbol: 'USDC', balance: 1098, usdValue: 1098 },
        { symbol: 'aBasUSDC', balance: 545, usdValue: 545, sector: 'YIELD' },
        // The smoking gun: real $199 position with no costBasis entry.
        // Pre-fix, source A omits this entirely → 3.32% drift vs B + C.
        { symbol: 'cbLTC', balance: 2.65, usdValue: 199 },
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 1186, totalTokensAcquired: 0.593, averageCostBasis: 2000, currentHolding: 0.593 },
        // Critical: cbLTC is NOT in costBasis. This mirrors the prod state
        // where /api/balances showed cbLTC carrying real $199 of value but
        // /api/state-export showed costBasis[cbLTC] === undefined.
      },
      lastKnownPrices: {
        WETH: { price: 2000 },
        cbLTC: { price: 75 }, // ~$75/LTC, balance 2.65 → ~$199 sanity
      },
    });
    // POST-FIX:
    //   Source A = WETH costBasis ($1186) + USDC ($1098) + aBasUSDC YIELD ($545)
    //                                     + cbLTC orphan ($199) = $3028
    //   Source B = 1186 + 1098 + 545 + 199 = $3028
    //   Source C = $3028
    // All three match → null
    expect(dimensionalHonesty(ctx)).toBeNull();
  });

  it('also covers the broader orphan cohort observed in prod (cbETH, WELL, KEYCAT, PENDLE, BRETT, AAVE, TOSHI, CRV, VVV, DRB)', () => {
    // The morning of 2026-05-22, /api/balances confirmed the orphan cohort
    // extended well beyond cbLTC. Every entry below was in balances with a
    // real usdValue and a null costBasis. The aggregate gap was the actual
    // engine behind the 211-cycle SEVERE.
    const orphans = [
      { symbol: 'cbETH', balance: 0.05, usdValue: 120 },
      { symbol: 'WELL', balance: 1000, usdValue: 45 },
      { symbol: 'KEYCAT', balance: 5000, usdValue: 30 },
      { symbol: 'PENDLE', balance: 10, usdValue: 25 },
      { symbol: 'BRETT', balance: 200, usdValue: 22 },
      { symbol: 'AAVE', balance: 0.1, usdValue: 18 },
      { symbol: 'TOSHI', balance: 5000, usdValue: 15 },
      { symbol: 'CRV', balance: 25, usdValue: 12 },
      { symbol: 'VVV', balance: 10, usdValue: 10 },
      { symbol: 'DRB', balance: 100, usdValue: 8 },
    ];
    const orphanTotal = orphans.reduce((s, o) => s + o.usdValue, 0); // $305
    const portfolio = 2000 + 700 + orphanTotal; // $3005
    const ctx = makeCtx({
      totalPortfolioValue: portfolio,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'USDC', balance: 700, usdValue: 700 },
        ...orphans,
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
        // No costBasis entries for any orphan — same as prod state.
      },
      lastKnownPrices: {
        WETH: { price: 2000 },
        ...Object.fromEntries(orphans.map((o) => [o.symbol, { price: o.usdValue / o.balance }])),
      },
    });
    // Post-fix: source A = WETH ($2000) + USDC ($700) + orphans ($305) = $3005.
    // Sources B + C also $3005 → null.
    expect(dimensionalHonesty(ctx)).toBeNull();
  });

  it('does NOT double-count when a balance has a healthy costBasis entry above the dust floor', () => {
    // Byte-identical-behavior test for healthy state. WETH appears in BOTH
    // balances and costBasis with matching real value. The costBasis loop
    // adds $2000; the orphan helper must NOT also add $2000.
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
      },
      lastKnownPrices: { WETH: { price: 2000 } },
    });
    // If the orphan helper double-counted WETH, source A would be $5000
    // vs B + C at $3000 → SEVERE outlier=A. We expect null instead.
    expect(dimensionalHonesty(ctx)).toBeNull();
  });

  it('skips sub-$1 dust balances in the orphan helper (no spurious adds)', () => {
    // A 0.50¢ dust balance with no costBasis should NOT be added to
    // source A — it's noise, same floor as the costBasis loop applies.
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
        { symbol: 'TINYDUST', balance: 1, usdValue: 0.5 }, // sub-$1, orphan
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
      },
      lastKnownPrices: { WETH: { price: 2000 } },
    });
    // Source A = $2000 + $1000 = $3000. Source B = $3000.5 (dust included
    // by sumBalancesUsd). Source C = $3000. Worst delta is ~0.02% — well
    // under the 2% tolerance, so null. (Confirms the fix doesn't pull dust
    // back in via the orphan path.)
    expect(dimensionalHonesty(ctx)).toBeNull();
  });

  it('still fires SEVERE on real drift after the orphan fix is applied', () => {
    // Negative test: confirm the fix doesn't silence legitimate disagreement.
    // Here totalPortfolioValue is fabricated (2x reality) — source C is wrong.
    const ctx = makeCtx({
      totalPortfolioValue: 6000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
        { symbol: 'cbLTC', balance: 2.65, usdValue: 199 }, // orphan
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
      },
      lastKnownPrices: { WETH: { price: 2000 }, cbLTC: { price: 75 } },
    });
    const v = dimensionalHonesty(ctx);
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('SEVERE');
    expect(v!.observed.outlier).toBe('C'); // totalPortfolioValue is the outlier
  });
});
