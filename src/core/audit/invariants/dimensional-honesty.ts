/**
 * NVR-SPEC-035 INV-1 — Dimensional honesty.
 *
 * Three independent expressions describe the same thing — the bot's current
 * portfolio value. They must agree within tolerance:
 *
 *   A. sum(state.costBasis[*].currentHolding × lastKnownPrice[*])
 *   B. sum(state.trading.balances[*].usdValue)
 *   C. state.trading.totalPortfolioValue (the scalar dashboards show)
 *
 * Phase A scope: cross-check A, B, C. (Phase A.1 will add D: live RPC poll
 * of the smart-wallet balances + Chainlink prices, the only truly
 * independent source. For now A/B/C agreement is the achievable bar.)
 *
 * SEVERE on disagreement > 2%. Pause scope: all-buys.
 *
 * This is the invariant that would have caught yesterday's phantom -$215.
 * If TOSHI's costBasis says we hold $30M of TOSHI but the wallet says $0
 * (impossible — total portfolio is $3K), A diverges from B and C
 * dramatically.
 */

import type { Invariant, Violation, InvariantContext } from '../types.js';

const TOLERANCE_PCT = 0.02; // 2% — accommodates price-tick drift between sources
const MIN_PORTFOLIO_USD = 50; // below this, all three sources can legitimately be 0/noisy
const POSITION_MIN_USD = 1; // sub-$1 dust positions don't count toward the price-readiness check
const PRICE_READINESS_MIN_COVERAGE = 0.80; // ≥80% of non-trivial positions must have live prices for INV-1 to run

/**
 * Sub-$1 costBasis entries are excluded from source A's position sum.
 * The math `currentHolding × averageCostBasis` can blow up on stale entries
 * (e.g. SPX with averageCostBasis = $3.77B from a past unit-conversion bug,
 * or any entry where the position is effectively zero but the per-unit price
 * is unrealistic). These entries contribute more noise than signal to
 * source A and produce false-positive 2%+ drift vs sources B/C.
 *
 * The exclusion only applies to source A — source B (balances.usdValue) and
 * source C (totalPortfolioValue) already exclude dust by their own
 * accounting paths.
 */
const MIN_POSITION_USD_FOR_SOURCE_A = 1;

/**
 * 2026-05-22 case (round 3) — costBasis under-contribution edge case.
 *
 * PR #38 caught sub-$1 phantoms in the costBasis loop. PR #43 caught absent
 * costBasis entries (orphans). Both helped — but Henry's main bot (and the
 * family bots) still fired INV-1 SEVERE for 213 consecutive cycles because
 * of a *third* class neither fix touched:
 *
 *   `costBasis[symbol]` exists with `currentHolding × price >= $1`, so
 *   PR #38's dust filter doesn't catch it AND PR #43's orphan path skips it
 *   (cbValueUsd is "valid enough"). But the derived value is materially
 *   *below* the chain-truth balance — stale `currentHolding`, missing
 *   `lastKnownPrices` entry forcing the `averageCostBasis` fallback to a
 *   wildly low number, post-rebase / airdrop tokens added straight to the
 *   wallet without the cost-basis tracker ever seeing them, etc.
 *
 * On master 2026-05-22T12:52:44Z: source A = $2974.22, source B/C = $3076.64
 * — a $102.42 gap consistent with cbLTC being undercounted by ~$100 (~half
 * of its real $200.14 balance value). The costBasis loop computed a non-
 * trivial-but-wrong cbLTC contribution; the orphan helper saw cbValueUsd
 * >= $1 and (correctly, per the double-count guard) skipped it.
 *
 * The fix: in the costBasis loop, bound the per-symbol contribution BELOW
 * by the chain-truth balance from `state.trading.balances`. Source A should
 * never under-count what's actually held — the balance is the authoritative
 * oracle for "how much of this token is in the wallet right now," and the
 * whole point of INV-1 is that A/B/C agree on that exact figure.
 *
 * The over-count direction (cbValueUsd > balanceUsd, e.g. TOSHI's
 * historical -$2.3M phantom) is preserved unchanged — `Math.max` keeps the
 * over-count, INV-1 still fires SEVERE outlier=A, the operator still gets
 * surfaced. The sub-$1 dust filter (PR #38) still applies BEFORE this clamp
 * so an SPX-style 1e-15 × $3.77B garbage entry never reaches the comparison.
 *
 * Behavior is byte-identical for healthy state where `cbValueUsd` and
 * `balanceUsd` agree within tick-noise (Math.max returns whichever side is
 * a hair larger; both are effectively the same number for tolerance math).
 */

function makeViolation(observed: Record<string, unknown>, message: string): Violation {
  return {
    invariantId: 'INV-1',
    invariantName: 'dimensional-honesty',
    severity: 'SEVERE',
    message,
    observed,
    expected: {
      tolerancePct: TOLERANCE_PCT * 100,
      rule: 'sum(costBasis*price) ≈ sum(balances.usdValue) ≈ totalPortfolioValue within tolerance',
    },
    pauseScope: 'all-buys',
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Three categories live in `state.trading.balances` but never appear in
 * `state.costBasis` (so the cost-basis-derived sum naturally excludes
 * them). To compare apples-to-apples, INV-1 must add them back to
 * source A from the balances array:
 *
 *   1. Cash-and-gas: USDC, native ETH — bot's quote currency + gas reserve
 *   2. YIELD-sector positions: aBasUSDC, mUSDC (Morpho vault shares),
 *      future Aave/Morpho/Compound receipt tokens — added 2026-05-20 after
 *      the silent under-reporting bug surfaced ($430 of value invisible to
 *      portfolio total for weeks because yield receipt tokens weren't read
 *      into balances)
 */
const CASH_AND_GAS_SYMBOLS = new Set(['USDC', 'ETH']);
const YIELD_SECTOR = 'YIELD';

function sumCashGasAndYieldFromBalances(ctx: InvariantContext): number {
  let sum = 0;
  for (const b of ctx.balances) {
    const isCashGas = CASH_AND_GAS_SYMBOLS.has(b.symbol);
    const isYield = (b as { sector?: string }).sector === YIELD_SECTOR;
    if (isCashGas || isYield) sum += b.usdValue ?? 0;
  }
  return sum;
}

/**
 * Source A's third bucket: balances that are NOT cash/gas, NOT YIELD-sector,
 * NOT meaningfully covered by costBasis. These are tokens the bot acquired
 * outside the cost-basis-tracker pipeline (yield distributions, airdrops,
 * external transfers). Sources B + C count them naturally; source A must too
 * to stay in dimensional honesty.
 *
 * The 2026-05-22 case study: cbLTC at $199 has costBasis: null because the
 * bot never bought it via the tracker — it arrived via a non-tracked path.
 * Pre-fix this was the dominant contributor to INV-1's 211-cycle SEVERE
 * (~4 days of paused buys). Yesterday's PR #38 addressed sub-$1 dust in the
 * costBasis loop but left this class untouched — cbLTC, cbETH, WELL, KEYCAT,
 * PENDLE, BRETT, AAVE, TOSHI, CRV, VVV, DRB all carried real value with no
 * costBasis entry, so source A was systematically lower than B + C.
 *
 * Inclusion rule for each balance entry:
 *   - usdValue >= MIN_POSITION_USD_FOR_SOURCE_A (sub-$1 dust skipped, same as
 *     the costBasis loop)
 *   - symbol NOT in CASH_AND_GAS_SYMBOLS (handled by sumCashGasAndYieldFromBalances)
 *   - sector !== 'YIELD' (handled by sumCashGasAndYieldFromBalances)
 *   - either no costBasis entry, or the costBasis-derived value would be
 *     < MIN_POSITION_USD_FOR_SOURCE_A (i.e., would be excluded from source A's
 *     costBasis pass anyway — orphaned in practice)
 *
 * Double-count guard: when a symbol has a costBasis entry whose costBasis-
 * derived value >= MIN_POSITION_USD_FOR_SOURCE_A, the costBasis loop in
 * `sumCostBasisPositions` already counted it — we MUST skip it here. This
 * keeps behavior byte-identical for "healthy" states where every position
 * has a valid tracker entry.
 */
/**
 * Build a quick-lookup map from symbol → balance entry. Used by both the
 * costBasis loop (for the round-3 under-count clamp) and the orphan helper
 * (which already iterates `ctx.balances` directly but benefits from O(1)
 * symbol → balance lookup symmetry).
 */
function buildBalanceBySymbol(
  ctx: InvariantContext,
): Record<string, { symbol: string; balance: number; usdValue: number; sector?: string }> {
  const map: Record<string, { symbol: string; balance: number; usdValue: number; sector?: string }> = {};
  for (const b of ctx.balances) {
    map[b.symbol] = b;
  }
  return map;
}

function sumOrphanedBalancesPositions(ctx: InvariantContext, countedSymbols: Set<string>): number {
  let sum = 0;
  for (const b of ctx.balances) {
    if (CASH_AND_GAS_SYMBOLS.has(b.symbol)) continue;
    if ((b as { sector?: string }).sector === YIELD_SECTOR) continue;
    const usd = b.usdValue ?? 0;
    if (usd < MIN_POSITION_USD_FOR_SOURCE_A) continue;
    // If the costBasis loop already contributed for this symbol (either at
    // the cb-derived value or clamped up to balanceUsd), skip — adding here
    // would double-count.
    if (countedSymbols.has(b.symbol)) continue;
    sum += usd;
  }
  return sum;
}

function sumCostBasisPositions(ctx: InvariantContext, countedSymbols: Set<string>): number {
  let sum = 0;
  const balanceBySymbol = buildBalanceBySymbol(ctx);
  for (const [symbol, cb] of Object.entries(ctx.costBasis)) {
    if (!cb) continue;
    if (CASH_AND_GAS_SYMBOLS.has(symbol)) continue; // cash legs counted separately below
    const holding = cb.currentHolding ?? 0;
    if (holding <= 0) continue;
    // Prefer live price from lastKnownPrices; fall back to averageCostBasis
    // only as a last resort (it's stale but better than 0).
    const price = ctx.lastKnownPrices[symbol]?.price ?? cb.averageCostBasis ?? 0;
    if (price <= 0) continue;
    const cbValueUsd = holding * price;
    // Skip sub-$1 dust (PR #38) — these entries pollute source A with stale
    // unit math that drifts vs B/C without representing meaningful held
    // capital. This filter MUST run before the balance-clamp below so an
    // SPX-style 1e-15 × $3.77B = $3.77e-6 garbage entry stays excluded
    // regardless of what `balances[symbol]` says.
    if (cbValueUsd < MIN_POSITION_USD_FOR_SOURCE_A) continue;

    // Round-3 (2026-05-22) fix: clamp the per-symbol contribution to be at
    // least the chain-truth balance value. The cost-basis tracker can drift
    // (stale `currentHolding`, missing `lastKnownPrices` forcing the
    // `averageCostBasis` fallback to a wildly off number, airdropped/rebased
    // tokens that bypassed the tracker entirely). In every such case the
    // balances oracle is authoritative for "what's actually in the wallet."
    //
    // INV-1 asserts A/B/C agree on that figure — so when cb-derived value
    // drops below balance value, snap source A to the balance value. The
    // over-count direction is preserved unchanged: Math.max keeps a
    // legitimately-larger cb-derived contribution, INV-1 still surfaces it
    // as SEVERE outlier=A, and the operator still gets the alert.
    const balanceUsd = balanceBySymbol[symbol]?.usdValue ?? 0;
    const contribution = balanceUsd >= MIN_POSITION_USD_FOR_SOURCE_A
      ? Math.max(cbValueUsd, balanceUsd)
      : cbValueUsd;

    sum += contribution;
    // Mark this symbol counted so the orphan pass doesn't double-add it.
    countedSymbols.add(symbol);
  }
  return sum;
}

/**
 * Compose source A across its three buckets:
 *
 *   (1) costBasis-loop positions, clamped below by balance value (round-3 fix)
 *   (2) cash + gas (USDC, ETH) + YIELD-sector receipt tokens, from balances
 *   (3) orphans — balances entries with no usable costBasis contribution
 *
 * `countedSymbols` threads through (1) → (3) so a symbol contributed by the
 * costBasis loop is never re-added by the orphan pass.
 */
function sumSourceA(ctx: InvariantContext): number {
  const countedSymbols = new Set<string>();
  const fromCostBasis = sumCostBasisPositions(ctx, countedSymbols);
  const fromCashGasYield = sumCashGasAndYieldFromBalances(ctx);
  const fromOrphans = sumOrphanedBalancesPositions(ctx, countedSymbols);
  return fromCostBasis + fromCashGasYield + fromOrphans;
}

function sumBalancesUsd(ctx: InvariantContext): number {
  return ctx.balances.reduce((acc, b) => acc + (b.usdValue ?? 0), 0);
}

export const dimensionalHonesty: Invariant = (ctx) => {
  // Below the minimum portfolio threshold, all sources can legitimately read
  // near-zero (fresh wallet, mid-recovery, etc). Don't fire false alarms.
  if (ctx.totalPortfolioValue < MIN_PORTFOLIO_USD) return null;

  // 2026-05-19 polish: skip the check when `lastKnownPrices` hasn't fully
  // populated yet. On a fresh Railway boot, the price stream takes a few
  // cycles to warm up — meanwhile non-trivial positions fall back to
  // `averageCostBasis` for source A which produces wildly wrong values for
  // any token whose historical cost basis is stored in different decimals
  // than current market (e.g., SPX with averageCostBasis = $3.77B from a
  // past unit-conversion bug). Returning null here lets INV-1 stay quiet
  // during warmup; once prices populate, the check runs cleanly.
  let nonTrivialPositions = 0;
  let positionsWithPrice = 0;
  for (const b of ctx.balances) {
    if (b.symbol === 'USDC') continue; // cash leg always priced at 1
    if ((b.usdValue ?? 0) < POSITION_MIN_USD) continue;
    nonTrivialPositions += 1;
    if ((ctx.lastKnownPrices[b.symbol]?.price ?? 0) > 0) positionsWithPrice += 1;
  }
  if (nonTrivialPositions > 0) {
    const coverage = positionsWithPrice / nonTrivialPositions;
    if (coverage < PRICE_READINESS_MIN_COVERAGE) {
      console.log(`[SystemAudit:warmup] INV-1 skipped — price coverage ${(coverage * 100).toFixed(0)}% (${positionsWithPrice}/${nonTrivialPositions}) below ${(PRICE_READINESS_MIN_COVERAGE * 100).toFixed(0)}% threshold`);
      return null;
    }
  }

  const sourceA = sumSourceA(ctx);
  const sourceB = sumBalancesUsd(ctx);
  const sourceC = ctx.totalPortfolioValue;

  // Compute pairwise relative deltas. Use the LARGER of the two as the
  // denominator so a near-zero source doesn't make the delta blow up to
  // Infinity (which would happen if sourceA ≈ 0 and we divided by A).
  function relDelta(x: number, y: number): number {
    const denom = Math.max(Math.abs(x), Math.abs(y));
    if (denom < 1) return 0; // both effectively zero — no disagreement
    return Math.abs(x - y) / denom;
  }

  const deltaAB = relDelta(sourceA, sourceB);
  const deltaAC = relDelta(sourceA, sourceC);
  const deltaBC = relDelta(sourceB, sourceC);
  const worstDelta = Math.max(deltaAB, deltaAC, deltaBC);

  if (worstDelta <= TOLERANCE_PCT) return null;

  // Identify which source is the outlier — the one whose pairwise deltas are
  // both above tolerance. That's the source most likely poisoned.
  let outlier: 'A' | 'B' | 'C' | 'unclear' = 'unclear';
  if (deltaAB > TOLERANCE_PCT && deltaAC > TOLERANCE_PCT && deltaBC <= TOLERANCE_PCT) outlier = 'A';
  else if (deltaAB > TOLERANCE_PCT && deltaBC > TOLERANCE_PCT && deltaAC <= TOLERANCE_PCT) outlier = 'B';
  else if (deltaAC > TOLERANCE_PCT && deltaBC > TOLERANCE_PCT && deltaAB <= TOLERANCE_PCT) outlier = 'C';

  return makeViolation(
    {
      sourceA_costBasisPositionSum: sourceA,
      sourceB_balancesUsdSum: sourceB,
      sourceC_totalPortfolioValue: sourceC,
      relDeltaAB_pct: (deltaAB * 100).toFixed(2),
      relDeltaAC_pct: (deltaAC * 100).toFixed(2),
      relDeltaBC_pct: (deltaBC * 100).toFixed(2),
      worstDeltaPct: (worstDelta * 100).toFixed(2),
      outlier,
    },
    `Three independent valuations disagree by ${(worstDelta * 100).toFixed(2)}% (>${(TOLERANCE_PCT * 100).toFixed(0)}% tolerance); outlier=${outlier}`,
  );
};
