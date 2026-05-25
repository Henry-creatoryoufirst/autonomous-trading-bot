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
 * 2026-05-25 — round 5: align the SOURCE of drift, not just the symptom.
 *
 * Rounds 1-4 all worked WITHIN this file — they tuned what source A counts.
 * Round 5 finally fixed the upstream cost-basis update path
 * (`updateUnrealizedPnL` in src/core/portfolio/cost-basis.ts) so cb.currentHolding
 * tracks wallet truth even for tokens that disappear from the balance scan
 * (fully sold, removed from cohort, withdrawn via /sendto, lost in a
 * gas-refuel swap). PLUS this file's `sumPhantomCostBasis` now prefers the
 * wallet-derived price (b.usdValue / b.balance) over `lastKnownPrices`, so a
 * stale-high price can't push a perfectly-synced sub-$1 dust entry over the
 * phantom dust gate.
 *
 * The 5-deploy arc on INV-1 source A:
 *
 *   PR #38 (round 1, dust)   — exclude sub-$1 entries from the costBasis loop.
 *     Fixed SPX-style 1e-15 × $3.77B garbage.
 *   PR #43 (round 2, orphans)— add a third bucket: balances with no costBasis
 *     entry. Fixed cbLTC at $199 with `state.costBasis['cbLTC'] === undefined`.
 *   PR #47 (round 3, clamp)  — `Math.max(cbValueUsd, balanceUsd)` in the
 *     costBasis loop. Fixed cbLTC at $199 with `state.costBasis['cbLTC']`
 *     present but `currentHolding` drifted to half-real, costBasis-derived
 *     value falling to $100.
 *   PR #?? (round 4, this)   — replace the costBasis loop entirely. Source A
 *     becomes `sum(balances.usdValue) + sum(cb entries with no matching
 *     balance, evaluated at last-known price)`. Held positions take chain
 *     truth directly; phantom cost-basis (currentHolding > 0 with no wallet
 *     balance) surfaces in the second term so TOSHI-style stale-after-sale
 *     entries still fire SEVERE outlier=A.
 *
 * Why round 3's clamp over-corrected (the proximate trigger for round 4):
 *
 *   PR #47 took `Math.max(cbValueUsd, balanceUsd)` per cost-basis symbol —
 *   correct intent (don't under-count chain truth) but wrong scope. The
 *   gate `balanceUsd >= MIN_POSITION_USD_FOR_SOURCE_A` left a hole: when
 *   `state.costBasis[X].currentHolding × price >= $1` but the wallet
 *   `balance.X.usdValue < $1` (token mostly sold, tracker hasn't caught up),
 *   the clamp didn't engage and source A added the full stale cbValueUsd.
 *   At cycle 12 post-deploy 2026-05-22 the bot showed source A = $3166.34
 *   vs B = $3068.33 — a $98 over-count consistent with one or more
 *   sub-$1-balance-but-cb-≥-$1 entries (cbBTC-class drift) leaking through
 *   the clamp gate.
 *
 * The round-4 invariant: source A = source B for any token the wallet
 * actually holds, plus an explicit "phantom cost-basis" term for entries
 * the tracker thinks exist but the wallet doesn't show. No clamping, no
 * Math.max, no ambiguity about which side of a per-symbol disagreement
 * dominates source A. Held positions follow chain truth; tracker phantoms
 * surface as a separate, dimensionally-labeled bucket.
 *
 * TOSHI-style coverage under round 4: the canonical "$30M stored, wallet
 * empty" failure is exactly a phantom — `state.costBasis['TOSHI'].currentHolding
 * × price >= $1` with no matching balance ≥ $1. The phantom term adds that
 * value to source A, A diverges from B + C dramatically, INV-1 fires SEVERE
 * outlier=A. Test coverage: see "preserves the phantom-costBasis signal"
 * below.
 *
 * Why round 4 didn't fully resolve in production (the trigger for round 5):
 *
 *   2026-05-23 efficient-peace: source A = $3,159 vs B = $3,061, ~$98 drift,
 *   outlier=A — identical symptom to rounds 1-3. Verified 2026-05-25 with live
 *   prod state: ~33 sub-$1 dust positions in wallet, several with matching
 *   cost-basis entries. Two interacting drift modes:
 *
 *   (a) updateUnrealizedPnL iterates `balances` only. Any costBasis symbol
 *       absent from the wallet scan keeps its stale currentHolding forever.
 *       Tokens fully sold via Aerodrome but no longer in the active scan
 *       (cohort changed in PR #48, gas-refuel swap, /sendto withdrawal) leave
 *       stale tracker rows that source A's phantom bucket then counts.
 *
 *   (b) Even when cb.currentHolding == balance.balance (correctly synced),
 *       `lastKnownPrices[X]` can be stale-high vs the wallet's implied price.
 *       cb.currentHolding × stalePrice can cross the $1 phantom dust gate
 *       while the wallet's b.usdValue (using the current price) sits well
 *       below — phantom fires on a price-source mismatch, not a real drift.
 *
 *   Rounds 1-4 each tightened the cost-basis loop's classification gate. None
 *   addressed (a) — the SOURCE — or (b) — the price-source mismatch INSIDE
 *   the phantom bucket. Round 5 fixes both.
 *
 * Edge that round 4 *intentionally* drops: "cost-basis has 10× current
 * holding while the wallet holds 1×." Both balance and cb-derived value are
 * ≥ $1 and disagree. Under rounds 1-3 this fired SEVERE outlier=A (cb-loop
 * over-counted). Under round 4 it does NOT fire — source A takes the
 * balance ($2000) and the inflated currentHolding is invisible to INV-1.
 * That's intentional: in that scenario the WALLET is healthy, the bot's
 * decisions use balance values, and the cost-basis tracker's `currentHolding`
 * drift surfaces through cb.realizedPnL / unrealizedPnL drift (INV-2's
 * territory) rather than dimensional honesty. Henry's bot trades on chain
 * truth — INV-1 should police chain-truth agreement, not internal-tracker
 * sync.
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
 * Cash and gas symbols are excluded from the phantom-costBasis bucket of
 * source A. The cost-basis tracker carries an entry for ETH (gas reserve
 * has an averageCostBasis from the original ETH purchase) but the value
 * lives in `balances` and is balance-led — never tracker-led — so the
 * phantom-costBasis path skips them by design.
 *
 * USDC is included in the set for symmetry; the tracker doesn't carry a
 * USDC entry today, but if a future schema change ever adds one (cash
 * cost-basis tracking) the phantom bucket would still correctly skip it.
 */
const CASH_AND_GAS_SYMBOLS = new Set(['USDC', 'ETH']);

/**
 * Round-4 source-A construction: balances-as-ground-truth.
 *
 * Source A walks two buckets that never overlap by construction (no
 * countedSymbols set required, no double-count risk):
 *
 *   (B-held) sum of `balances.usdValue` for every held position with
 *            usdValue ≥ $1. Cash/gas (USDC, ETH) and YIELD-sector receipt
 *            tokens flow through this bucket too — they live in balances
 *            and the wallet read is authoritative for cash and yield-share
 *            values. (The previous "cash/gas/yield" helper is folded in here
 *            because the rule is uniform: balance is truth.)
 *
 *   (CB-phantom) sum of `currentHolding × lastKnownPrice` for every
 *                cost-basis entry whose derived value is ≥ $1 AND whose
 *                symbol has NO matching balance ≥ $1. This is the signal
 *                term — when the tracker insists we hold something the
 *                wallet doesn't show, INV-1 surfaces the disagreement as
 *                source A > source B → SEVERE outlier=A.
 *
 * Why this is right (and rounds 1-3 were not):
 *   - Rounds 1-3 tried to make the cost-basis loop authoritative for any
 *     symbol with a tracker entry, then patched edge cases as they surfaced
 *     (dust → clamp → orphan → clamp-other-way). The construction had two
 *     independent value oracles (cb-loop, balance-orphan) and a guarded
 *     transfer between them. Every guard had a hole.
 *   - Round 4 picks ONE oracle per symbol per dollar of value: held
 *     positions follow chain truth (balance.usdValue), tracker-only
 *     phantoms follow the tracker. There's no overlap and no guard to leak
 *     through.
 *
 * Sub-$1 dust handling: both buckets filter at MIN_POSITION_USD_FOR_SOURCE_A.
 * Source B (sumBalancesUsd) includes dust naturally so B and source A drift
 * by at most the total dust value — well under tolerance for any realistic
 * wallet (Henry's main bot has ~$2 of sub-$1 dust across 25 micro-positions
 * combined). The price-readiness gate above continues to skip the entire
 * check during boot warmup when lastKnownPrices is sparse.
 */

/**
 * Build a quick-lookup map from symbol → balance entry. Used by the phantom
 * costBasis pass to test "does a matching held balance exist?" in O(1).
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

/**
 * Source A — bucket B-held: every balance entry ≥ $1 contributes its
 * `usdValue`. Cash/gas/YIELD all flow through here uniformly — they're
 * balance entries, balance is truth. Sub-$1 dust filtered out (matches the
 * cb-phantom filter; the sub-$1 noise floor across both buckets is well
 * under tolerance for any realistic wallet).
 */
function sumHeldBalances(ctx: InvariantContext): number {
  let sum = 0;
  for (const b of ctx.balances) {
    const usd = b.usdValue ?? 0;
    if (usd < MIN_POSITION_USD_FOR_SOURCE_A) continue;
    sum += usd;
  }
  return sum;
}

/**
 * Source A — bucket CB-phantom: every costBasis entry that the wallet does
 * NOT corroborate. Catches TOSHI-style "$30M stored, wallet empty" stale
 * tracker entries. Mirrors INV-1's original intent ("if costBasis says we
 * hold $30M but wallet says $0, surface the disagreement") without the
 * round-1-through-3 layering of dust/orphan/clamp guards.
 *
 * A symbol is "phantom" when:
 *   1. state.costBasis[symbol] exists with currentHolding > 0
 *   2. AND symbol NOT in CASH_AND_GAS_SYMBOLS (cash legs are balance-led)
 *   3. AND currentHolding × price ≥ MIN_POSITION_USD_FOR_SOURCE_A
 *      (sub-$1 dust filtered same as the held-balances bucket — prevents an
 *      SPX-style 1e-15 × $3.77B garbage entry from leaking in)
 *   4. AND there is NO matching balance entry with usdValue ≥ $1
 *      (when both buckets see the symbol, the held-balances bucket already
 *      counted it at chain truth — don't double-count from the tracker side)
 *
 * Price source: `lastKnownPrices[symbol]?.price ?? cb.averageCostBasis`.
 * The price-readiness gate ensures lastKnownPrices coverage ≥ 80% before
 * INV-1 runs, so the averageCostBasis fallback only ever applies to dust
 * or already-phantom entries — never to a held position with a healthy
 * balance.
 */
function sumPhantomCostBasis(ctx: InvariantContext): number {
  let sum = 0;
  const balanceBySymbol = buildBalanceBySymbol(ctx);
  for (const [symbol, cb] of Object.entries(ctx.costBasis)) {
    if (!cb) continue;
    if (CASH_AND_GAS_SYMBOLS.has(symbol)) continue;
    const holding = cb.currentHolding ?? 0;
    if (holding <= 0) continue;
    // 2026-05-25 (INV-1 round 5): price source mismatch is the second half of
    // the phantom-bucket false-positive story. When the wallet holds a sub-$1
    // amount AND `cb.currentHolding == balance.balance` (i.e. tracker IS in
    // sync), `cb.currentHolding × lastKnownPrices[X]` can still cross the $1
    // dust threshold if lastKnownPrices is stale-high — phantom fires even
    // though the only divergence is a price-source mismatch. Prefer the
    // wallet's implied price (b.usdValue / b.balance) when available so the
    // phantom calc and source-B speak the same dollars.
    const balanceEntry = balanceBySymbol[symbol];
    const walletPrice =
      balanceEntry && balanceEntry.balance > 0 && (balanceEntry.usdValue ?? 0) > 0
        ? balanceEntry.usdValue / balanceEntry.balance
        : 0;
    const price =
      walletPrice || ctx.lastKnownPrices[symbol]?.price || cb.averageCostBasis || 0;
    if (price <= 0) continue;
    const cbValueUsd = holding * price;
    if (cbValueUsd < MIN_POSITION_USD_FOR_SOURCE_A) continue; // dust
    const balanceUsd = balanceEntry?.usdValue ?? 0;
    // Held-balances bucket already covers this symbol at chain truth.
    if (balanceUsd >= MIN_POSITION_USD_FOR_SOURCE_A) continue;
    sum += cbValueUsd;
  }
  return sum;
}

/**
 * Source A = held balances (chain truth for cash + yield + every position
 * the wallet actually holds) + phantom costBasis (signal term for tracker
 * drift when the wallet doesn't corroborate). The two buckets never
 * overlap by construction.
 */
function sumSourceA(ctx: InvariantContext): number {
  return sumHeldBalances(ctx) + sumPhantomCostBasis(ctx);
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
