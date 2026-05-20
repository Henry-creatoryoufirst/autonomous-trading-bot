/**
 * NVR-SPEC-035 INV-10 — Chain-truth reconciliation (Phase A.1).
 *
 * The fourth source. Cross-checks Source A (in-state cost-basis + cash +
 * yield) and Source B (in-state balances) against Source D (live on-chain
 * eth_call of the same wallet). When D disagrees with A or B by more than
 * tolerance, **the in-state cache is wrong** — by definition, the chain is
 * ground truth.
 *
 * This is the invariant that would have caught the May-20 aUSDC drift the
 * moment it appeared. Phase A's three in-state sources (A, B, C) all
 * read from the same truncated state.trading.balances, so they
 * confidently agreed on the wrong number. Source D reads from the chain
 * directly — no shared blind spot.
 *
 * SEVERE on divergence > 5%. Pause scope: all-buys.
 *
 * Why 5% (vs 2% for INV-1):
 *   - In-state sources A/B/C are computed at the same instant, so they
 *     should agree very tightly.
 *   - Source D is a separate RPC poll that may be a few minutes stale
 *     vs A/B/C. Price-tick drift on a volatile position over a few
 *     minutes can produce 1-3% movement legitimately. 5% gives margin
 *     for that without giving away signal.
 *
 * Pause scope rationale:
 *   - INV-10 firing means the bot doesn't know its real portfolio. Trading
 *     decisions made on the wrong inventory are by definition unsafe.
 *     Block new buys until the divergence resolves (typically by the next
 *     cycle once balances re-poll, OR by a real cost-basis reconciliation).
 */

import type { Invariant, Violation } from '../types.js';

const TOLERANCE_PCT = 0.05; // 5%
const MIN_PORTFOLIO_USD = 50;
const MAX_SNAPSHOT_AGE_MS = 30 * 60 * 1000; // skip if snapshot older than 30 min

export const chainTruthReconciliation: Invariant = (ctx) => {
  const snapshot = ctx.liveOnChainSnapshot;
  if (!snapshot) {
    // No snapshot this cycle. Don't fire — emit nothing. The orchestrator
    // logs the auditor's run-line every cycle so its silence is detectable
    // via a different mechanism (INV-9 self-test).
    return null;
  }

  // Stale snapshot (caller didn't refresh)? Skip.
  const ageMs = Date.now() - new Date(snapshot.capturedAt).getTime();
  if (ageMs > MAX_SNAPSHOT_AGE_MS) return null;

  // Snapshot incomplete? Skip — we'd get false positives from missing data.
  if (!snapshot.complete) {
    console.log(`[SystemAudit:warmup] INV-10 skipped — chain snapshot had ${snapshot.errors.length} RPC error(s), partial data`);
    return null;
  }

  // Below the floor, all sources can legitimately read near-zero.
  if (ctx.totalPortfolioValue < MIN_PORTFOLIO_USD) return null;

  if (!snapshot.fullyPriced) {
    console.log(`[SystemAudit:warmup] INV-10 skipped — snapshot not fully priced (lastKnownPrices missing entries)`);
    return null;
  }

  // Source D = live on-chain total
  const sourceD = snapshot.totalUsd;
  // Source B = bot's in-state balance valuation
  const sourceB = ctx.balances.reduce((sum, b) => sum + (b.usdValue ?? 0), 0);
  // Source C = bot's rolled-up scalar
  const sourceC = ctx.totalPortfolioValue;

  // Compute disagreements vs Source D specifically — D is the truth-anchor
  function relDelta(x: number, y: number): number {
    const denom = Math.max(Math.abs(x), Math.abs(y));
    if (denom < 1) return 0;
    return Math.abs(x - y) / denom;
  }

  const deltaBD = relDelta(sourceB, sourceD);
  const deltaCD = relDelta(sourceC, sourceD);
  const worstDelta = Math.max(deltaBD, deltaCD);

  if (worstDelta <= TOLERANCE_PCT) return null;

  // Identify which in-state positions the snapshot has that balances doesn't
  // (or vice-versa) — surfaces what's actually missing.
  const balanceSymbolsInState = new Set(
    ctx.balances.filter(b => (b.usdValue ?? 0) >= 1).map(b => b.symbol),
  );
  const balanceSymbolsOnChain = new Set(
    snapshot.balances.filter(b => b.usdValueChainTruth >= 1).map(b => b.symbol),
  );
  const inStateMissingOnChain: string[] = [];   // bot says it has, chain says it doesn't
  const onChainMissingInState: string[] = [];   // chain says it has, bot doesn't know
  for (const sym of balanceSymbolsInState) {
    if (!balanceSymbolsOnChain.has(sym)) inStateMissingOnChain.push(sym);
  }
  for (const sym of balanceSymbolsOnChain) {
    if (!balanceSymbolsInState.has(sym)) onChainMissingInState.push(sym);
  }

  const violation: Violation = {
    invariantId: 'INV-10',
    invariantName: 'chain-truth-reconciliation',
    severity: 'SEVERE',
    message: `In-state balances disagree with on-chain truth by ${(worstDelta * 100).toFixed(2)}% (>${(TOLERANCE_PCT * 100).toFixed(0)}% tolerance). Chain is ground truth; in-state is stale or missing positions.`,
    observed: {
      sourceD_liveOnChainTotal: sourceD,
      sourceB_balancesUsdSum: sourceB,
      sourceC_totalPortfolioValue: sourceC,
      relDeltaBD_pct: (deltaBD * 100).toFixed(2),
      relDeltaCD_pct: (deltaCD * 100).toFixed(2),
      worstDeltaPct: (worstDelta * 100).toFixed(2),
      onChainMissingInState,
      inStateMissingOnChain,
      snapshotAgeSec: Math.round(ageMs / 1000),
      snapshotPositionCount: snapshot.balances.filter(b => b.balance > 0).length,
    },
    expected: {
      rule: `live-RPC chain total ≈ sum(balances.usdValue) ≈ totalPortfolioValue, within ${(TOLERANCE_PCT * 100).toFixed(0)}%`,
    },
    pauseScope: 'all-buys',
    detectedAt: new Date().toISOString(),
  };

  return violation;
};
