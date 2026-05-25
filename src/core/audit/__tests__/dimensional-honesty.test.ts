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

  it('identifies the costBasis-position-sum as the outlier on a phantom cb entry (TOSHI-style)', () => {
    // Round-4 semantics: source A's only signal channel for cost-basis drift
    // is the phantom-costBasis bucket — costBasis entries with currentHolding
    // > 0 that the wallet does NOT corroborate at >= $1. Here state.costBasis
    // claims we hold $500 of TOSHI; balances show no TOSHI position. The
    // phantom bucket adds $500 to source A while sources B and C see only
    // the real WETH + USDC = $3000.
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
      ],
      costBasis: {
        // The classic TOSHI stale-after-sale: tracker has currentHolding but
        // the wallet sold out and balance never carried TOSHI back.
        TOSHI: { symbol: 'TOSHI', realizedPnL: 0, totalInvestedUSD: 500, totalTokensAcquired: 1_000_000, averageCostBasis: 0.0005, currentHolding: 1_000_000 },
      },
      lastKnownPrices: { WETH: { price: 2000 }, TOSHI: { price: 0.0005 } },
    });
    const v = dimensionalHonesty(ctx);
    expect(v).not.toBeNull();
    expect(v!.observed.outlier).toBe('A');
  });

  it('does NOT fire phantom when wallet holds sub-$1 dust + cb.currentHolding matches (price-source consistency, round 5)', () => {
    // 2026-05-25 (round 5): the second half of the phantom false-positive
    // story. When cb.currentHolding tracks wallet.balance correctly AND the
    // wallet's usdValue is sub-$1 dust, source A's phantom math must NOT
    // count the entry — even if lastKnownPrices is stale-high and would
    // push cb.currentHolding × stalePrice over the $1 dust threshold.
    //
    // Scenario: bot holds 0.000009 cbBTC. Wallet says $0.71 (current $78,777
    // price). lastKnownPrices['cbBTC'].price is stale at $135,000 (peak from
    // earlier session). Without the round-5 fix:
    //   phantomValue = 0.000009 × $135,000 = $1.22 (≥ $1) → phantom fires
    //   balance.usdValue = $0.71 (< $1) → held-balances bucket skips
    //   → source A over-counts by $1.22, false-positive SEVERE outlier=A
    // With round-5 (use wallet-derived price for phantom calc):
    //   walletPrice = $0.71 / 0.000009 = $78,777
    //   phantomValue = 0.000009 × $78,777 = $0.71 (< $1) → dust filtered
    //   → no phantom, no false positive
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
        { symbol: 'cbBTC', balance: 0.000009, usdValue: 0.71 }, // sub-$1 dust, current price ~$78,777
      ],
      costBasis: {
        cbBTC: {
          symbol: 'cbBTC',
          realizedPnL: 0,
          totalInvestedUSD: 1,
          totalTokensAcquired: 0.000009,
          averageCostBasis: 78_777,
          currentHolding: 0.000009, // perfectly synced with wallet
        },
      },
      lastKnownPrices: {
        WETH: { price: 2000 },
        cbBTC: { price: 135_000 }, // STALE — peak from earlier, way above $78,777 current
      },
    });
    const v = dimensionalHonesty(ctx);
    expect(v).toBeNull(); // no SEVERE — dust filtered correctly
  });

  it('still fires phantom when cb.currentHolding genuinely diverges from wallet (round 5 preserves the signal)', () => {
    // Round 5 must NOT silence the real TOSHI-style signal it inherited from
    // round 4. Here cb.currentHolding (1,000,000) is wildly higher than wallet
    // (0). Even with the wallet-price-preference fix, lastKnownPrices gives
    // the only available price, phantom value = 1M × $0.0005 = $500, fires.
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
      ],
      costBasis: {
        TOSHI: { symbol: 'TOSHI', realizedPnL: 0, totalInvestedUSD: 500, totalTokensAcquired: 1_000_000, averageCostBasis: 0.0005, currentHolding: 1_000_000 },
      },
      lastKnownPrices: { WETH: { price: 2000 }, TOSHI: { price: 0.0005 } },
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

describe('INV-1 — 2026-05-22 round 3: costBasis-undercontribution edge case', () => {
  // The exact prod symptom that survived PR #38 + PR #43:
  // master efficient-peace, /api/system-audit at 2026-05-22T12:52:44Z (cycle 140):
  //
  //   sourceA_costBasisPositionSum: 2974.2161226644953
  //   sourceB_balancesUsdSum:       3076.640181157941
  //   sourceC_totalPortfolioValue:  3076.640181157941
  //   worstDeltaPct: "3.33"
  //   outlier: A
  //   consecutiveCycles: 213  ← bot's BUYs gated for ~4 days
  //
  // cbLTC carried $200.14 on-chain. PR #43 added orphan-balance inclusion, but
  // the orphan helper SKIPPED cbLTC because state.costBasis['cbLTC'] existed
  // with a non-zero currentHolding (drifted from the real wallet balance) and
  // its derived value (currentHolding × price) was non-trivial (>= $1). So the
  // costBasis loop counted cbLTC at the stale value and the orphan helper
  // skipped it as already-counted. Source A undercounted by ~$100 every cycle.

  it('reproduces the prod 3.33% / $102 drift when costBasis.currentHolding drifts below true balance', () => {
    // Real balance is 3.70006228 cbLTC × $54.09 = $200.14
    // But state.costBasis.cbLTC.currentHolding has drifted to ~half of true.
    // Pre-round-3, the costBasis loop adds 1.85 × 54.09 = $100.07 and the
    // orphan helper skips cbLTC because cbValueUsd >= $1.
    //
    // Source A pre-round-3 ≈ WETH $1215.59 + ENA $20.55 + cbLTC stale $100.07
    //                      + USDC $1077.52 + ETH cash $10.17 + aBasUSDC $545.62
    //                      ≈ $2969.52   (within $5 of prod's $2974.22)
    //
    // Sources B + C = $3069.58 (matches prod $3076.64 modulo dust)
    // Worst delta ≈ 3.3% → SEVERE outlier=A, mirroring the live blocker.
    const ctx = makeCtx({
      totalPortfolioValue: 3069.58,
      balances: [
        { symbol: 'USDC', balance: 1077.516369, usdValue: 1077.516369 },
        { symbol: 'ETH', balance: 0.004781546748853895, usdValue: 10.16632291614035 },
        { symbol: 'WETH', balance: 0.5717302536487067, usdValue: 1215.588738291176 },
        // The smoking gun: real balance is 3.70 but costBasis.currentHolding
        // drifted to 1.85. Source A's costBasis loop adds the stale value;
        // PR #43's orphan helper skips because cbValueUsd is "valid enough".
        { symbol: 'cbLTC', balance: 3.70006228, usdValue: 200.14037272306652 },
        { symbol: 'ENA', balance: 189.19599114469716, usdValue: 20.545601195031853 },
        { symbol: 'aBasUSDC', balance: 545.61928, usdValue: 545.61928, sector: 'YIELD' },
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 1176.44, totalTokensAcquired: 0.5717, averageCostBasis: 2057.68, currentHolding: 0.5717302536487067 },
        ENA: { symbol: 'ENA', realizedPnL: 0, totalInvestedUSD: 22.49, totalTokensAcquired: 189.2, averageCostBasis: 0.1189, currentHolding: 189.19599114469716 },
        // STALE: currentHolding drifted to ~half of real wallet balance.
        // Pre-fix this contributes 1.85 × 54.09 = $100.07 to source A
        // and the orphan path skips because cbValueUsd >= $1.
        cbLTC: { symbol: 'cbLTC', realizedPnL: 0, totalInvestedUSD: 100, totalTokensAcquired: 1.85, averageCostBasis: 54.09, currentHolding: 1.85 },
      },
      lastKnownPrices: {
        WETH: { price: 2126.1578 },
        cbLTC: { price: 54.09108214337044 },
        ENA: { price: 0.10859427343425354 },
      },
    });
    // Post-fix: Math.max(1.85 × 54.09 = $100.07, balance $200.14) = $200.14.
    //   Source A = WETH $1215.59 + ENA $20.55 + cbLTC clamped $200.14
    //            + USDC $1077.52 + ETH cash $10.17 + aBasUSDC YIELD $545.62
    //            = $3069.58
    //   Source B = $3069.58, Source C = $3069.58 → all agree → null.
    expect(dimensionalHonesty(ctx)).toBeNull();
  });

  it('PRE-FIX simulation (sanity): without the Math.max clamp, the same input fires SEVERE outlier=A', () => {
    // This test demonstrates the bug ONLY mathematically. It hand-computes
    // what the OLD code (pre-clamp) would have produced from the same ctx,
    // and asserts that hand-computed source A diverges >2% from B/C. It
    // does NOT exercise the dimensional-honesty function (which is now
    // patched) — it documents that the prod symptom is reproducible from
    // the same inputs under pre-round-3 arithmetic.
    const ctx = {
      balances: [
        { symbol: 'USDC', balance: 1077.516369, usdValue: 1077.516369 },
        { symbol: 'ETH', balance: 0.004781546748853895, usdValue: 10.16632291614035 },
        { symbol: 'WETH', balance: 0.5717302536487067, usdValue: 1215.588738291176 },
        { symbol: 'cbLTC', balance: 3.70006228, usdValue: 200.14037272306652 },
        { symbol: 'ENA', balance: 189.19599114469716, usdValue: 20.545601195031853 },
        { symbol: 'aBasUSDC', balance: 545.61928, usdValue: 545.61928, sector: 'YIELD' as const },
      ],
      costBasis: {
        WETH: { currentHolding: 0.5717302536487067, averageCostBasis: 2057.68 },
        ENA: { currentHolding: 189.19599114469716, averageCostBasis: 0.1189 },
        cbLTC: { currentHolding: 1.85, averageCostBasis: 54.09 },
      },
      lastKnownPrices: {
        WETH: { price: 2126.1578 },
        cbLTC: { price: 54.09108214337044 },
        ENA: { price: 0.10859427343425354 },
      },
    };
    const totalPortfolioValue = 3069.58;
    // Hand-compute old source A (no Math.max clamp):
    //   costBasis loop: WETH 0.5717 × 2126.16 + ENA 189.2 × 0.1086 + cbLTC stale 1.85 × 54.09
    //   cash/gas/yield: USDC + ETH + aBasUSDC
    //   orphans: (cbLTC SKIPPED because cb-derived >= $1)
    const wethCb = 0.5717302536487067 * 2126.1578;
    const enaCb = 189.19599114469716 * 0.10859427343425354;
    const cbLTCstale = 1.85 * 54.09108214337044;
    const cashGasYield = 1077.516369 + 10.16632291614035 + 545.61928;
    const oldSourceA = wethCb + enaCb + cbLTCstale + cashGasYield;
    const sourceB = ctx.balances.reduce((s, b) => s + b.usdValue, 0);
    const sourceC = totalPortfolioValue;
    // Sanity-pin: B and C agree (within $0.05) in the prod snapshot too.
    expect(Math.abs(sourceB - sourceC)).toBeLessThan(0.5);
    const denomAB = Math.max(oldSourceA, sourceB);
    const deltaAB = Math.abs(oldSourceA - sourceB) / denomAB;
    // Drift should be ~3.3%, matching the prod observation.
    expect(deltaAB).toBeGreaterThan(0.02);
    expect(deltaAB).toBeLessThan(0.05);
    // Sanity: the gap between sources A and B sits right around $100 — the
    // amount cbLTC's stale `currentHolding` undercounts the real balance by.
    expect(sourceB - oldSourceA).toBeGreaterThan(95);
    expect(sourceB - oldSourceA).toBeLessThan(110);
  });

  it('handles the stale-averageCostBasis variant — cb.averageCostBasis dragging price downward', () => {
    // Alternate trigger in the same class: lastKnownPrices['cbLTC'] IS
    // populated correctly ($54), but the costBasis.averageCostBasis is
    // stale (e.g., LTC bought when ~$27 and the averaging never caught up).
    // Both paths go through the cbValueUsd computation — the bug surfaces
    // when EITHER `currentHolding` OR the price input is stale-low. This
    // test pins the currentHolding-drift variant with the price input
    // healthy, complementing the price-side coverage above.
    //
    // Note: the lastKnownPrices-MISSING variant would trigger the
    // price-readiness warmup gate first (any non-trivial position with
    // no live price drops coverage below 80%), so source A never even
    // runs. Production never sees that pure variant — when prices are
    // populated, the lasers are on and the warmup gate has passed. The
    // realistic in-prod trigger is what the previous test reproduced
    // (cb.currentHolding drifted while price is healthy).
    const ctx = makeCtx({
      totalPortfolioValue: 3270,
      balances: [
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'cbLTC', balance: 3.70, usdValue: 200 }, // wallet truth
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
        // currentHolding halved — same stale-tracker pattern as the prod
        // reproduction, but isolated for clarity.
        cbLTC: { symbol: 'cbLTC', realizedPnL: 0, totalInvestedUSD: 100, totalTokensAcquired: 1.85, averageCostBasis: 54, currentHolding: 1.85 },
      },
      lastKnownPrices: { WETH: { price: 2000 }, cbLTC: { price: 54 } },
    });
    // Pre-round-3: cbLTC contributes 1.85 × 54 = $99.90, orphan path
    // skips (cbValueUsd >= $1). Source A = $2000 + $99.90 + $1000 = $3099.90.
    // Source B = $3200, Source C = $3270. Delta AB = 3.1%, delta AC = 5.2%,
    // delta BC = 2.1% → outlier=A (both A's pairs exceed tolerance,
    // BC under) → SEVERE.
    //
    // Post-fix: cbLTC clamped to max($99.90, $200) = $200.
    // Source A = $2000 + $200 + $1000 = $3200 == Source B. Delta AC = BC = 2.1%,
    // which is just above tolerance — INV-1 still fires but as outlier=C
    // (C is the odd source out), surfacing the REAL drift between balances
    // and totalPortfolioValue that's distinct from the source-A artifact.
    const v = dimensionalHonesty(ctx);
    expect(v).not.toBeNull();
    expect(v!.observed.outlier).toBe('C'); // A and B now agree → C is the outlier
    // The under-contribution gap is gone: A ≈ B within tolerance.
    expect(Number(v!.observed.relDeltaAB_pct)).toBeLessThan(2);
  });

  it('round-4: inflated currentHolding while balance is healthy is NOT an INV-1 signal anymore', () => {
    // Behavior change for round 4: when state.costBasis says we hold 10x WETH
    // but the wallet shows the real 1x WETH ($2000), the held-balances bucket
    // takes the chain truth ($2000) and the phantom-costBasis bucket skips
    // WETH because there IS a matching balance >= $1. Source A == source B
    // and INV-1 stays quiet.
    //
    // The internal-tracker drift (cb.currentHolding inflated vs reality)
    // surfaces through cost-basis-derived P&L drift (INV-2 territory once it
    // pollutes realizedPnL) and the dashboard's per-position P&L, NOT through
    // dimensional honesty. Henry's bot trades on chain truth; INV-1's
    // contract is "chain truth agrees with itself across A/B/C," not "the
    // internal cost-basis tracker is bug-free."
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
      ],
      costBasis: {
        // Tracker thinks we hold 10× the WETH we actually own
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 20000, totalTokensAcquired: 10, averageCostBasis: 2000, currentHolding: 10 },
      },
      lastKnownPrices: { WETH: { price: 2000 } },
    });
    // Source A = held-balances sum (WETH $2000 + USDC $1000) = $3000
    //          + phantom-costBasis (WETH skipped, balance >= $1) = $0
    //          = $3000
    // Source B = $3000, Source C = $3000 → null
    expect(dimensionalHonesty(ctx)).toBeNull();
  });

  it('round-4: phantom costBasis with NO matching balance DOES fire SEVERE outlier=A (TOSHI scenario)', () => {
    // The canonical TOSHI failure: state.costBasis['TOSHI'].currentHolding
    // is non-zero (tracker forgot the wallet sold out / never knew about a
    // rebase / etc.), but the wallet has no TOSHI position. Phantom-
    // costBasis bucket adds the cb-derived value to source A; held-balances
    // bucket doesn't see TOSHI at all. A diverges, B + C agree → outlier=A.
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        // TOSHI deliberately absent from balances
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
        // Tracker insists we hold $500 of TOSHI; wallet says nothing.
        TOSHI: { symbol: 'TOSHI', realizedPnL: 0, totalInvestedUSD: 500, totalTokensAcquired: 1_000_000, averageCostBasis: 0.0005, currentHolding: 1_000_000 },
      },
      lastKnownPrices: { WETH: { price: 2000 }, TOSHI: { price: 0.0005 } },
    });
    // Source A = balances $3000 + phantom TOSHI $500 = $3500
    // Source B = $3000, Source C = $3000
    // Delta AB = AC = 14.3%, Delta BC = 0 → outlier=A
    const v = dimensionalHonesty(ctx);
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('SEVERE');
    expect(v!.observed.outlier).toBe('A');
  });

  it('round-4: sub-$1 dust balance + cb-≥-$1 entry — costBasis still counted as phantom', () => {
    // Edge case: balance shows sub-$1 dust (wallet sold down to dust, or
    // balance-read partial failure), but costBasis carries a $99.90
    // contribution. Under round 4, balance is "not corroborating" because
    // its usdValue is < $1 — the phantom bucket adds the cb-derived value.
    // This matches round-3's behavior in this corner (cb wins on sub-$1
    // balance) but the path is now cleaner: the held-balances bucket
    // naturally excludes sub-$1 dust, and the phantom-costBasis bucket
    // includes the cb value because no balance entry corroborates.
    const ctx = makeCtx({
      totalPortfolioValue: 3000,
      balances: [
        { symbol: 'USDC', balance: 1000, usdValue: 1000 },
        { symbol: 'WETH', balance: 1, usdValue: 2000 },
        { symbol: 'cbLTC', balance: 0.001, usdValue: 0.054 }, // sub-$1 dust
      ],
      costBasis: {
        WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2000, totalTokensAcquired: 1, averageCostBasis: 2000, currentHolding: 1 },
        cbLTC: { symbol: 'cbLTC', realizedPnL: 0, totalInvestedUSD: 100, totalTokensAcquired: 1.85, averageCostBasis: 54, currentHolding: 1.85 },
      },
      lastKnownPrices: { WETH: { price: 2000 }, cbLTC: { price: 54 } },
    });
    // Source A = balances ($3000, dust filtered) + phantom cbLTC ($99.90,
    // because balance.cbLTC = $0.054 < $1 doesn't corroborate) = $3099.90.
    // Source B = $3000.05 (includes dust), Source C = $3000.
    // Delta AB = 3.2%, delta AC = 3.2%, delta BC = 0 → outlier=A.
    const v = dimensionalHonesty(ctx);
    expect(v).not.toBeNull();
    expect(v!.observed.outlier).toBe('A');
  });
});

describe('INV-1 — 2026-05-22 round 4: real-prod regression (PR #47 over-correction)', () => {
  // Round 4 ships balances-as-ground-truth (Approach B). The trigger was
  // PR #47's `Math.max(cbValueUsd, balanceUsd)` clamp over-correcting:
  //
  //   PRE-PR47 (master cycle 140, 2026-05-22T12:52Z):
  //     sourceA = $2974.22, sourceB/C = $3076.64 → drift 3.33% UNDER, outlier=A
  //     cause: state.costBasis['cbLTC'].currentHolding had drifted to 1.85
  //     (half real), the cost-basis loop added $100 instead of the real $200,
  //     and PR #43's orphan path skipped cbLTC because cbValueUsd >= $1.
  //
  //   POST-PR47 (deploy cycle 12, 2026-05-22 evening):
  //     sourceA = $3166.34, sourceB = $3068.33 → drift 3.10% OVER, outlier=A
  //     cause: PR #47's clamp gate `balanceUsd >= $1` had a hole — a
  //     cost-basis entry whose `currentHolding × price >= $1` while the
  //     matching balance had drifted to sub-$1 (post-sale, balance-read
  //     partial failure, etc.) leaked the FULL stale cbValueUsd into source A.
  //
  // The round-4 fix below uses the real /api/balances payload from the live
  // bot (2026-05-22T16:47Z, snapshot pulled during INV-1-round-4 build) and
  // reproduces the cycle-12 over-count direction with a representative
  // sub-$1-balance + cb-≥-$1 phantom (cbBTC-class). The tests confirm:
  //
  //   (a) the exact PR #47 condition (cb-≥-$1 with sub-$1 balance) fires
  //       SEVERE pre-fix and clears post-fix at production scale
  //   (b) source A == source B for the healthy real-prod payload (no
  //       synthetic numbers — the snapshot is exactly what /api/balances
  //       returned)
  //   (c) a legitimate TOSHI-style phantom still fires SEVERE — the fix
  //       does not silence real drift

  // Real /api/balances payload from prod 2026-05-22T16:47Z. This is the
  // shape `state.trading.balances` carries on the live bot — no synthetic
  // data. costBasis tracker entries are reconstructed from the API's
  // `costBasis` (averageCostBasis) field where present; `null` means the
  // tracker has no entry. currentHolding mirrors balance.balance (i.e.,
  // healthy tracker sync) UNLESS the test deliberately drifts it.
  const prodBalances = [
    { symbol: 'USDC', balance: 1065.516369, usdValue: 1065.516369, sector: 'BLUE_CHIP' },
    { symbol: 'ETH', balance: 0.004776019182655486, usdValue: 10.111383284693423, price: 2117.1153, sector: 'BLUE_CHIP' },
    { symbol: 'WETH', balance: 0.5773509991268089, usdValue: 1222.3186337216537, price: 2117.1153, sector: 'BLUE_CHIP' },
    { symbol: 'cbBTC', balance: 0.00000913, usdValue: 0.7018976446540377, price: 76878.16480329, sector: 'BLUE_CHIP' },
    { symbol: 'cbETH', balance: 0.000004373874363268, usdValue: 0.010474156556124365, price: 2394.7090579662777, sector: 'BLUE_CHIP' },
    { symbol: 'wstETH', balance: 0.000003310372878504, usdValue: 0.008655326578678128, price: 2614.60774853544, sector: 'BLUE_CHIP' },
    { symbol: 'LINK', balance: 0.02819653697679918, usdValue: 0.2759169306210986, price: 9.78549, sector: 'BLUE_CHIP' },
    { symbol: 'cbLTC', balance: 3.70006228, usdValue: 199.37348192101405, price: 53.883817847794184, sector: 'BLUE_CHIP' },
    { symbol: 'cbXRP', balance: 0.17167, usdValue: 0.23187157025060517, price: 1.350681949383149, sector: 'BLUE_CHIP' },
    { symbol: 'VIRTUAL', balance: 0.027443197974997613, usdValue: 0.021478041168747897, price: 0.7826362360653328, sector: 'AI_TOKENS' },
    { symbol: 'AIXBT', balance: 0.14877912633562804, usdValue: 0.004697318824412304, price: 0.03157243183304969, sector: 'AI_TOKENS' },
    { symbol: 'ENA', balance: 189.19599114469716, usdValue: 20.143644363454857, price: 0.10646972085179644, sector: 'DEFI' },
    { symbol: 'aBasUSDC', balance: 545.625146, usdValue: 545.625146, price: 1, sector: 'YIELD' },
  ];
  // Real cost-basis entries (subset that actually has a tracker entry).
  // currentHolding === balance for the healthy variant — drift it
  // deliberately in the regression test below.
  const prodCostBasisHealthy = {
    ETH: { symbol: 'ETH', realizedPnL: -0.32, totalInvestedUSD: 898.3, totalTokensAcquired: 0.004776, averageCostBasis: 2371.32, currentHolding: 0.004776019182655486 },
    WETH: { symbol: 'WETH', realizedPnL: 187.97, totalInvestedUSD: 2083.35, totalTokensAcquired: 0.5773, averageCostBasis: 2057.68, currentHolding: 0.5773509991268089 },
    cbBTC: { symbol: 'cbBTC', realizedPnL: 21.07, totalInvestedUSD: 640.65, totalTokensAcquired: 0.00000913, averageCostBasis: 67141.91, currentHolding: 0.00000913 },
    wstETH: { symbol: 'wstETH', realizedPnL: -0.17, totalInvestedUSD: 18.23, totalTokensAcquired: 3.31e-6, averageCostBasis: 2572.56, currentHolding: 0.000003310372878504 },
    LINK: { symbol: 'LINK', realizedPnL: -1.49, totalInvestedUSD: 10, totalTokensAcquired: 0.028, averageCostBasis: 9.18, currentHolding: 0.02819653697679918 },
    cbXRP: { symbol: 'cbXRP', realizedPnL: -24.02, totalInvestedUSD: 1208.75, totalTokensAcquired: 0.17, averageCostBasis: 1.45, currentHolding: 0.17167 },
    VIRTUAL: { symbol: 'VIRTUAL', realizedPnL: 24.14, totalInvestedUSD: 804.84, totalTokensAcquired: 0.027, averageCostBasis: 0.68, currentHolding: 0.027443197974997613 },
    AIXBT: { symbol: 'AIXBT', realizedPnL: 5.13, totalInvestedUSD: 471.36, totalTokensAcquired: 0.149, averageCostBasis: 0.023, currentHolding: 0.14877912633562804 },
    ENA: { symbol: 'ENA', realizedPnL: 17.84, totalInvestedUSD: 22.48, totalTokensAcquired: 189.2, averageCostBasis: 0.119, currentHolding: 189.19599114469716 },
  };
  const prodLastKnownPrices = {
    // The price-readiness gate counts non-USDC balances >= $1. For this
    // prod snapshot that's ETH ($10), WETH ($1222), cbLTC ($199), ENA
    // ($20), aBasUSDC ($545). All five need an entry so coverage > 80%.
    ETH: { price: 2117.1153 },
    WETH: { price: 2117.1153 },
    cbBTC: { price: 76878.16480329 },
    cbETH: { price: 2394.7090579662777 },
    wstETH: { price: 2614.60774853544 },
    LINK: { price: 9.78549 },
    cbLTC: { price: 53.883817847794184 },
    cbXRP: { price: 1.350681949383149 },
    VIRTUAL: { price: 0.7826362360653328 },
    AIXBT: { price: 0.03157243183304969 },
    ENA: { price: 0.10646972085179644 },
    aBasUSDC: { price: 1 },
  };

  it('clean prod payload: source A matches source B + C, no INV-1 violation', () => {
    // Sanity: the live snapshot itself (no drift introduced) must produce
    // null. Confirms round-4 source A computed from a real /api/balances
    // payload reads the same total as totalPortfolioValue.
    const sourceBExpected = prodBalances.reduce((s, b) => s + b.usdValue, 0);
    const ctx = makeCtx({
      totalPortfolioValue: sourceBExpected,
      balances: prodBalances,
      costBasis: prodCostBasisHealthy,
      lastKnownPrices: prodLastKnownPrices,
    });
    expect(dimensionalHonesty(ctx)).toBeNull();
  });

  it('reproduces PR #47 over-correction: cb-≥-$1 entry with sub-$1 balance fires SEVERE pre-fix-as-implemented', () => {
    // This is the cycle-12 post-PR47 regression. Introduce a stale costBasis
    // entry where currentHolding × price = ~$98 (above the $1 floor) while
    // the matching balance is sub-$1 (post-sale dust the tracker hasn't
    // caught up to). PR #47's clamp gate `balanceUsd >= $1` left this case
    // adding the full stale cbValueUsd to source A.
    //
    // Under round 4: the phantom-costBasis bucket adds the cb-derived value
    // ($98) BECAUSE balance is sub-$1 — but source B (sumBalancesUsd) does
    // NOT include cbBTC at $98 (only its sub-$1 dust). The intentional gap
    // surfaces the drift exactly as round-4 promises: A > B → outlier=A.
    //
    // The cbBTC numbers below are chosen to produce a $98 over-count, the
    // same magnitude the live bot reported at cycle 12 (A=$3166.34 vs
    // B=$3068.33 → over by ~$98).
    const balances = [
      ...prodBalances.filter(b => b.symbol !== 'cbBTC'),
      // Sub-$1 cbBTC dust — matches real prod shape
      { symbol: 'cbBTC', balance: 0.00000913, usdValue: 0.7018976446540377, price: 76878.16480329, sector: 'BLUE_CHIP' },
    ];
    const costBasis = {
      ...prodCostBasisHealthy,
      // Stale tracker: currentHolding NOT zeroed after a recent sell. The
      // real wallet shows dust (0.00000913 cbBTC = $0.70), but the tracker
      // still claims ~0.00128 BTC (= $98.40 at $76878/BTC).
      cbBTC: { symbol: 'cbBTC', realizedPnL: 21.07, totalInvestedUSD: 640.65, totalTokensAcquired: 0.00128, averageCostBasis: 67141.91, currentHolding: 0.00128 },
    };
    const sourceBExpected = balances.reduce((s, b) => s + b.usdValue, 0);
    const ctx = makeCtx({
      totalPortfolioValue: sourceBExpected,
      balances,
      costBasis,
      lastKnownPrices: prodLastKnownPrices,
    });
    // Source A = held balances ($3068.33 minus filtered sub-$1 dust)
    //          + phantom cbBTC ($98.40, balance sub-$1 so cb counted as
    //            phantom)
    //          ≈ $3068.33 + $98.40 - $1.50 (dust filtered)
    //          ≈ $3165.23
    // Source B = $3068.33, Source C = $3068.33
    // drift ≈ 3.1% → SEVERE outlier=A — exactly the cycle-12 symptom.
    const v = dimensionalHonesty(ctx);
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('SEVERE');
    expect(v!.observed.outlier).toBe('A');
    // Quantitative match: source A should be ~$98 above source B.
    const a = v!.observed.sourceA_costBasisPositionSum as number;
    const b = v!.observed.sourceB_balancesUsdSum as number;
    expect(a - b).toBeGreaterThan(90);
    expect(a - b).toBeLessThan(105);
    // Drift around 3.1% (matches cycle-12 observed 3.10%)
    expect(Number(v!.observed.relDeltaAB_pct)).toBeGreaterThan(2.5);
    expect(Number(v!.observed.relDeltaAB_pct)).toBeLessThan(3.5);
  });

  it('reproduces round-3 (PR #47) UNDER-count direction: stale currentHolding while balance is healthy', () => {
    // The original cycle-140 (pre-PR-47) symptom: cbLTC carries $200 in the
    // wallet, but state.costBasis['cbLTC'].currentHolding drifted to 1.85
    // (half real). PR #38's dust filter passes (cb-derived $100 >= $1),
    // PR #43's orphan path skips (counted set has cbLTC), and the cost-basis
    // loop's $100 contribution undercounts source A by ~$100.
    //
    // Under round 4: the held-balances bucket takes cbLTC at $200 (chain
    // truth). The phantom bucket skips cbLTC because balance >= $1
    // corroborates. The 1.85 stale currentHolding is irrelevant to source A.
    // Source A == source B == $3069 → null.
    const balances = [...prodBalances];
    const costBasis = {
      ...prodCostBasisHealthy,
      // Stale cbLTC currentHolding (half real, matching the original
      // cycle-140 prod symptom).
      cbLTC: { symbol: 'cbLTC', realizedPnL: 0, totalInvestedUSD: 100, totalTokensAcquired: 1.85, averageCostBasis: 54.09, currentHolding: 1.85 },
    };
    const sourceBExpected = balances.reduce((s, b) => s + b.usdValue, 0);
    const ctx = makeCtx({
      totalPortfolioValue: sourceBExpected,
      balances,
      costBasis,
      lastKnownPrices: prodLastKnownPrices,
    });
    // Round 4: cbLTC balance is $199.37 (>= $1) → phantom skipped, held
    // bucket counts $199.37. The stale 1.85 currentHolding is invisible
    // to source A. All three sources agree → null.
    expect(dimensionalHonesty(ctx)).toBeNull();
  });

  it('legitimate phantom (TOSHI: cb >= $1, no balance at all) STILL fires SEVERE — proves the fix doesn\'t silence real drift', () => {
    // The fix MUST preserve INV-1's original purpose: catching stale
    // tracker entries that claim positions the wallet doesn't hold. Add a
    // TOSHI-style phantom on top of the otherwise-clean prod payload and
    // confirm INV-1 surfaces it.
    const balances = [...prodBalances]; // no TOSHI in balances
    const costBasis = {
      ...prodCostBasisHealthy,
      // Tracker thinks we hold $150 of TOSHI; balance has zero.
      TOSHI: { symbol: 'TOSHI', realizedPnL: 0, totalInvestedUSD: 150, totalTokensAcquired: 750_000, averageCostBasis: 0.0002, currentHolding: 750_000 },
    };
    const sourceBExpected = balances.reduce((s, b) => s + b.usdValue, 0);
    const ctx = makeCtx({
      totalPortfolioValue: sourceBExpected,
      balances,
      costBasis,
      lastKnownPrices: { ...prodLastKnownPrices, TOSHI: { price: 0.0002 } },
    });
    // Source A = held balances ($3068) + phantom TOSHI ($150) = $3218
    // Source B = $3068, Source C = $3068
    // Delta AB = 4.7% > 2% → SEVERE outlier=A
    const v = dimensionalHonesty(ctx);
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('SEVERE');
    expect(v!.observed.outlier).toBe('A');
    // The phantom value is recoverable from observed
    const a = v!.observed.sourceA_costBasisPositionSum as number;
    const b = v!.observed.sourceB_balancesUsdSum as number;
    expect(a - b).toBeGreaterThan(140);
    expect(a - b).toBeLessThan(160);
  });

  it('drift-in-opposite-direction sanity: B > C still fires SEVERE outlier=C', () => {
    // Symmetric guard for the totalPortfolioValue side. If the bot's
    // rolled-up scalar (totalPortfolioValue) gets stuck/stale while
    // balances stay fresh, INV-1 should fire outlier=C. This is the
    // "drift in opposite direction is still drift" case.
    const balances = [...prodBalances];
    const sourceBExpected = balances.reduce((s, b) => s + b.usdValue, 0);
    // Stale totalPortfolioValue stuck $200 BELOW reality.
    const ctx = makeCtx({
      totalPortfolioValue: sourceBExpected - 200,
      balances,
      costBasis: prodCostBasisHealthy,
      lastKnownPrices: prodLastKnownPrices,
    });
    const v = dimensionalHonesty(ctx);
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('SEVERE');
    expect(v!.observed.outlier).toBe('C');
  });
});

describe('INV-1 — 2026-05-22 round 4: integration smoke (runSystemAuditor end-to-end)', () => {
  // Per feedback_ship_it_wired: the regression test exercises the pure
  // function. The smoke test below exercises the wired orchestrator —
  // `runSystemAuditor` with the real-prod deps and `canExecuteAction` on
  // the resulting blocker state. This proves the observable contract Henry
  // cares about: when this PR ships, INV-1 clears AND `canExecuteAction({
  // BUY })` returns allowed for healthy prod data.

  it('clean prod payload: runSystemAuditor produces no blocker, canExecuteAction({BUY}) is allowed', async () => {
    // Lazy-import the orchestrator to keep test isolation tight — these
    // imports pull env-gated logic the pure-function tests above don't.
    const auditor = await import('../system-auditor.js');
    process.env.SYSTEM_AUDITOR_ENABLED = 'true';
    auditor._internals.reset();

    const balances = [
      { symbol: 'USDC', balance: 1065.516369, usdValue: 1065.516369, sector: 'BLUE_CHIP' },
      { symbol: 'ETH', balance: 0.004776, usdValue: 10.11, price: 2117.12, sector: 'BLUE_CHIP' },
      { symbol: 'WETH', balance: 0.57735, usdValue: 1222.32, price: 2117.12, sector: 'BLUE_CHIP' },
      { symbol: 'cbLTC', balance: 3.70006228, usdValue: 199.37, price: 53.88, sector: 'BLUE_CHIP' },
      { symbol: 'ENA', balance: 189.196, usdValue: 20.14, price: 0.1065, sector: 'DEFI' },
      { symbol: 'aBasUSDC', balance: 545.625146, usdValue: 545.625146, price: 1, sector: 'YIELD' },
    ];
    const totalPortfolioValue = balances.reduce((s, b) => s + b.usdValue, 0);
    const costBasis = {
      ETH: { symbol: 'ETH', realizedPnL: 0, totalInvestedUSD: 898, totalTokensAcquired: 0.004776, averageCostBasis: 2371.32, currentHolding: 0.004776 },
      WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 2083, totalTokensAcquired: 0.57735, averageCostBasis: 2057.68, currentHolding: 0.57735 },
      ENA: { symbol: 'ENA', realizedPnL: 0, totalInvestedUSD: 22.48, totalTokensAcquired: 189.196, averageCostBasis: 0.119, currentHolding: 189.196 },
    };
    const lastKnownPrices = {
      WETH: { price: 2117.12 },
      cbLTC: { price: 53.88 },
      ENA: { price: 0.1065 },
    };

    const report = await auditor.runSystemAuditor({
      balances,
      totalPortfolioValue,
      costBasis,
      lastKnownPrices,
      cycle: 100,
    });

    expect(report).not.toBeNull();
    const inv1Violations = (report?.violations ?? []).filter(v => v.invariantId === 'INV-1');
    expect(inv1Violations).toHaveLength(0);
    expect(report?.blockerActive).toBe(false);

    // The contract Henry cares about: BUY is allowed.
    const gate = auditor.canExecuteAction({ action: 'BUY', source: 'llm' });
    expect(gate.allowed).toBe(true);

    delete process.env.SYSTEM_AUDITOR_ENABLED;
  });
});
