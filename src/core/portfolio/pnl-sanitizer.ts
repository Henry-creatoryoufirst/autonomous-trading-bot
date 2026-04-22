/**
 * Never Rest Capital — Realized P&L Sanitizer (v21.20)
 *
 * Defends the cumulative realizedPnL accumulator from unit-error poisoning.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * On 2026-04-18 the bot booked -$330,318.29 of realized loss on just $747 of
 * SELL volume across 24 trades — a 442× volume unit error. A cascade of
 * corrupted averageCostBasis entries (classic wei-vs-dollars or wrong
 * on-chain decimals) produced rawPnL values in the hundreds of thousands of
 * dollars per sell, and the existing per-sell clamp was `-avgCost × tokens`
 * — which is ALSO huge when avgCost itself is the thing corrupted.
 *
 * End state: `GET /api/portfolio` returned realizedPnL = -$2,652,226.71 on
 * a $3,622 portfolio. Dashboard → trust → catastrophic. See
 * INCIDENT_2026-04-22_Realized-PnL-Poison.md.
 *
 * ── Two defenses ────────────────────────────────────────────────────────────
 * 1. Per-trade guard (`validateRealizedPnL`). Called at the write path before
 *    cb.realizedPnL is mutated. Rejects trades whose |realizedPnL| exceeds
 *    max(5 × positionSize, 2 × portfolioValue). Rejected trades log a hard
 *    error with token / amount / price / decimals for post-mortem, and the
 *    clamped value (or zero) is used instead so the accumulator never gets
 *    poisoned.
 *
 * 2. Startup re-sync (`maybeResyncCumulativePnL`). Called at boot after state
 *    is loaded. If |sum(cb.realizedPnL)| > 10 × portfolioValue, the bot is
 *    already poisoned — we rebuild the accumulator from the trade log with
 *    this same sanitizer filter applied, so phantom trades are dropped
 *    instead of replayed. A backup is written first so rollback is safe.
 *
 * Both defenses log to console with loud banners so operators notice.
 */

import type { TokenCostBasis, TradeRecord } from '../types/index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Reject per-trade realizedPnL if |pnl| exceeds
 *   max(PER_TRADE_POSITION_MULT × positionSize,
 *       PER_TRADE_PORTFOLIO_MULT × portfolioValue)
 *
 * 5× position = tolerates >400% loss/gain versus the position's own USD.
 *   Normal worst case: full rug = -1× position. 5× gives plenty of slack for
 *   slippage / reporting error without letting phantom losses through.
 *
 * 2× portfolio = a single trade losing more than twice the whole portfolio is
 *   always nonsense. Catches corrupted avgCost on tiny positions where 5×
 *   position is itself trivially small.
 */
export const PER_TRADE_POSITION_MULT = 5;
export const PER_TRADE_PORTFOLIO_MULT = 2;

/**
 * When |cumulative realizedPnL| exceeds this multiple of current portfolio
 * value, treat the accumulator as poisoned and rebuild from trade log.
 * 10× gives legitimate long-running bots headroom — a $3k bot that has booked
 * a legitimate $30k of cumulative gains over its life should not trip this —
 * while catching clear poisoning (we saw 732× on 2026-04-22).
 */
export const CUMULATIVE_POISON_MULT = 10;

/**
 * Minimum portfolio value required before either guard activates. Protects
 * against startup where portfolioValue may not be populated yet.
 */
export const MIN_PORTFOLIO_FOR_GUARD = 10;

// ---------------------------------------------------------------------------
// Per-trade guard
// ---------------------------------------------------------------------------

export interface PnLSanitizerInput {
  /** Token symbol being sold (for logging) */
  symbol: string;
  /** Proposed realized P&L for this sell (USD, signed) */
  realizedPnL: number;
  /** USD value of the SELL itself (amount of USDC received) */
  amountUSD: number;
  /** Tokens sold in this trade (native units) */
  tokensSold: number;
  /** Average cost basis at time of sell */
  averageCostBasis: number;
  /** Current portfolio value in USD */
  portfolioValue: number;
  /** Optional: declared decimals from TOKEN_REGISTRY (for diagnostics) */
  decimals?: number;
  /** Optional: the ISO timestamp of this trade */
  timestamp?: string;
}

export interface PnLSanitizerResult {
  /** Whether the proposed pnl was accepted as-is */
  accepted: boolean;
  /** The pnl value the caller should actually book (0 on rejection) */
  sanitizedPnL: number;
  /** Tripwire threshold that was exceeded, if any */
  rejectedBy: 'position_size' | 'portfolio_size' | null;
  /** Absolute ratio |pnl| / max(threshold) for monitoring */
  magnitudeRatio: number;
  /** Human-readable rejection reason (empty string when accepted) */
  reason: string;
}

/**
 * Validate a proposed per-sell realized P&L. Returns a result with an
 * accepted flag and a `sanitizedPnL` that the caller MUST book instead
 * of the raw value.
 *
 * When rejection happens, this function logs a loud error to the console
 * and (if the diagnostics ring buffer is wired) appends to state.errorLog.
 */
export function validateRealizedPnL(input: PnLSanitizerInput): PnLSanitizerResult {
  const {
    symbol,
    realizedPnL,
    amountUSD,
    tokensSold,
    averageCostBasis,
    portfolioValue,
    decimals,
    timestamp,
  } = input;

  // Don't guard against NaN/Infinity silently — treat as poisoned.
  if (!Number.isFinite(realizedPnL)) {
    logPoisonDetection({
      symbol,
      rawPnL: realizedPnL,
      amountUSD,
      tokensSold,
      averageCostBasis,
      decimals,
      timestamp,
      reason: 'non-finite pnl',
    });
    return {
      accepted: false,
      sanitizedPnL: 0,
      rejectedBy: 'position_size',
      magnitudeRatio: Number.POSITIVE_INFINITY,
      reason: 'realizedPnL is non-finite (NaN/Infinity) — likely decimals/wei error',
    };
  }

  // Bootstrap/very-small portfolios: apply position-size gate only. When the
  // portfolio guard is disabled the portfolio cap is effectively 0 so it
  // can't inflate the combined cap (we don't want `max(position, Infinity)`
  // to defeat the position gate at bootstrap).
  const portfolioGuardActive = portfolioValue >= MIN_PORTFOLIO_FOR_GUARD;

  const positionSize = Math.max(Math.abs(amountUSD), 0);
  const positionCap = PER_TRADE_POSITION_MULT * positionSize;
  const portfolioCap = portfolioGuardActive
    ? PER_TRADE_PORTFOLIO_MULT * Math.abs(portfolioValue)
    : 0;
  const cap = Math.max(positionCap, portfolioCap);

  const magnitude = Math.abs(realizedPnL);
  const magnitudeRatio = cap > 0 ? magnitude / cap : Number.POSITIVE_INFINITY;

  if (magnitude <= cap || cap === 0) {
    return {
      accepted: true,
      sanitizedPnL: realizedPnL,
      rejectedBy: null,
      magnitudeRatio,
      reason: '',
    };
  }

  // Rejected — determine which gate triggered
  const rejectedBy: PnLSanitizerResult['rejectedBy'] =
    magnitude > portfolioCap && portfolioGuardActive ? 'portfolio_size' : 'position_size';
  const reason = rejectedBy === 'portfolio_size'
    ? `|pnl|=$${magnitude.toFixed(2)} exceeds ${PER_TRADE_PORTFOLIO_MULT}× portfolio ($${portfolioValue.toFixed(2)})`
    : `|pnl|=$${magnitude.toFixed(2)} exceeds ${PER_TRADE_POSITION_MULT}× position ($${positionSize.toFixed(2)})`;

  logPoisonDetection({
    symbol,
    rawPnL: realizedPnL,
    amountUSD,
    tokensSold,
    averageCostBasis,
    decimals,
    timestamp,
    reason,
  });

  // Sanitize to 0 — losing the "legitimate" portion of this sell's P&L is
  // vastly preferable to poisoning the cumulative accumulator. The token's
  // holding/cost basis is still mutated by the caller's existing code;
  // we ONLY zero the realized-P&L contribution.
  return {
    accepted: false,
    sanitizedPnL: 0,
    rejectedBy,
    magnitudeRatio,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Startup re-sync
// ---------------------------------------------------------------------------

export interface ResyncInput {
  /** Existing cost basis map — MUTATED by this function when resync fires */
  costBasis: Record<string, TokenCostBasis>;
  /** Full trade log (will be filtered through the sanitizer before replay) */
  trades: TradeRecord[];
  /** Current portfolio value (USD) */
  portfolioValue: number;
  /** Optional console logger (defaults to console.log) */
  log?: (msg: string) => void;
}

export interface ResyncResult {
  /** Whether the resync actually fired (cumulative was above threshold) */
  fired: boolean;
  /** Cumulative realizedPnL before resync */
  beforeCumulative: number;
  /** Cumulative realizedPnL after resync (sum over costBasis) */
  afterCumulative: number;
  /** Number of trades rejected by the sanitizer during replay */
  rejectedTrades: number;
  /** Ratio |beforeCumulative| / portfolioValue at check time */
  beforeRatio: number;
}

/**
 * Check whether the cumulative realizedPnL is catastrophically poisoned, and
 * if so, rebuild the accumulator from the trade log with this same sanitizer
 * applied as a filter. The token's other cost-basis fields (averageCostBasis,
 * totalInvested, holding) are left untouched — we only fix the accumulator so
 * dashboards stop showing -$2.6M on a $3k portfolio.
 *
 * Returns early without mutating if the cumulative number looks sane.
 */
export function maybeResyncCumulativePnL(input: ResyncInput): ResyncResult {
  const { costBasis, trades, portfolioValue } = input;
  const log = input.log ?? ((m: string) => console.log(m));

  const entries = Object.values(costBasis);
  const beforeCumulative = entries.reduce((s, cb) => s + (cb?.realizedPnL ?? 0), 0);
  const beforeRatio = portfolioValue > 0
    ? Math.abs(beforeCumulative) / portfolioValue
    : 0;

  // Sanity guard: need a plausible portfolio value AND a poisoned accumulator.
  if (
    portfolioValue < MIN_PORTFOLIO_FOR_GUARD
    || beforeRatio < CUMULATIVE_POISON_MULT
  ) {
    return {
      fired: false,
      beforeCumulative,
      afterCumulative: beforeCumulative,
      rejectedTrades: 0,
      beforeRatio,
    };
  }

  log('');
  log('=================================================================');
  log('  🚨 REALIZED-PNL POISON DETECTED AT STARTUP');
  log(`     Cumulative: $${beforeCumulative.toFixed(2)}`);
  log(`     Portfolio:  $${portfolioValue.toFixed(2)}`);
  log(`     Ratio:      ${beforeRatio.toFixed(1)}× (threshold ${CUMULATIVE_POISON_MULT}×)`);
  log('     → Rebuilding realizedPnL accumulator from trade log with sanitizer');
  log('=================================================================');

  // Chronological replay with the same clamp the live bot uses, plus our
  // stronger per-trade sanitizer gate.
  const sorted = [...trades].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // Track per-symbol running avgCost + holdings independent of the stored
  // costBasis (which may itself be poisoned). We write ONLY the cleaned
  // realizedPnL back to cb so other fields are preserved.
  const running: Record<string, { totalInvested: number; totalTokens: number; pnl: number }> = {};
  let rejectedTrades = 0;

  for (const trade of sorted) {
    if (trade.action === 'BUY') {
      const symbol = trade.toToken;
      if (!symbol || symbol === 'USDC') continue;
      const tokens = trade.tokenAmount ?? 0;
      const usd = trade.amountUSD ?? 0;
      if (tokens <= 0 || usd <= 0) continue;
      running[symbol] ||= { totalInvested: 0, totalTokens: 0, pnl: 0 };
      running[symbol].totalInvested += usd;
      running[symbol].totalTokens += tokens;
    } else if (trade.action === 'SELL') {
      const symbol = trade.fromToken;
      if (!symbol || symbol === 'USDC') continue;
      const tokens = trade.tokenAmount ?? 0;
      const usd = trade.amountUSD ?? 0;
      if (tokens <= 0) continue;

      const r = (running[symbol] ||= { totalInvested: 0, totalTokens: 0, pnl: 0 });
      const avgCost = r.totalTokens > 0 ? r.totalInvested / r.totalTokens : 0;
      const sellPrice = tokens > 0 ? usd / tokens : 0;
      const rawPnL = avgCost > 0 ? (sellPrice - avgCost) * tokens : 0;

      // Existing per-sell clamp
      const implied = avgCost * tokens;
      const clamped = implied > 0 ? Math.max(rawPnL, -implied) : rawPnL;

      // Our new sanitizer gate
      const result = validateRealizedPnL({
        symbol,
        realizedPnL: clamped,
        amountUSD: usd,
        tokensSold: tokens,
        averageCostBasis: avgCost,
        portfolioValue,
        timestamp: trade.timestamp,
      });
      if (!result.accepted) rejectedTrades++;

      r.pnl += result.sanitizedPnL;
      const proportionSold = Math.min(1, tokens / Math.max(r.totalTokens, tokens));
      r.totalInvested = Math.max(0, r.totalInvested * (1 - proportionSold));
      r.totalTokens = Math.max(0, r.totalTokens - tokens);
    }
  }

  // Commit: only overwrite cb.realizedPnL. Other fields (avgCost, totals,
  // holding, ATR, peak) remain — they'll be naturally corrected by future
  // live trades via updateCostBasisAfter{Buy,Sell}.
  let afterCumulative = 0;
  for (const [symbol, r] of Object.entries(running)) {
    if (costBasis[symbol]) {
      costBasis[symbol].realizedPnL = r.pnl;
    }
    afterCumulative += r.pnl;
  }
  // Also zero any costBasis entries that had no trades in our replay — they
  // hold phantom PnL that can't be justified.
  for (const [symbol, cb] of Object.entries(costBasis)) {
    if (!running[symbol]) {
      if (cb.realizedPnL !== 0) {
        log(`     ↪ ${symbol}: zeroed phantom realizedPnL ($${cb.realizedPnL.toFixed(2)}) — no trades in log`);
        cb.realizedPnL = 0;
      }
    }
  }

  log(`  ✅ Resync complete. before=$${beforeCumulative.toFixed(2)} after=$${afterCumulative.toFixed(2)} rejected=${rejectedTrades}`);
  log('');

  return {
    fired: true,
    beforeCumulative,
    afterCumulative,
    rejectedTrades,
    beforeRatio,
  };
}

// ---------------------------------------------------------------------------
// Audit — top-N suspect trades
// ---------------------------------------------------------------------------

export interface SuspectTrade {
  timestamp: string;
  symbol: string;
  action: string;
  amountUSD: number;
  tokenAmount: number | null;
  realizedPnL: number;
  /** |realizedPnL| / max($1, volume). Large = likely poisoned. */
  pnlToVolumeRatio: number;
  /** Whether this trade would be rejected by the current sanitizer */
  wouldReject: boolean;
  rejectionReason: string;
  txHash?: string;
  cycle?: number;
}

/**
 * Scan trade history and return the top-N suspect trades ranked by
 * |realizedPnL|/volume. Used by `/api/diagnostics/realized-pnl-audit`.
 */
export function findSuspectTrades(
  trades: TradeRecord[],
  portfolioValue: number,
  limit = 10,
): SuspectTrade[] {
  const scored: SuspectTrade[] = [];

  for (const trade of trades) {
    if (trade.action !== 'SELL') continue;
    if (!trade.success) continue;
    const pnl = trade.realizedPnL ?? 0;
    if (pnl === 0) continue;
    const volume = Math.max(trade.amountUSD ?? 0, 1);
    const ratio = Math.abs(pnl) / volume;

    // Run sanitizer to see whether *today's* guard would reject this
    const result = validateRealizedPnL({
      symbol: trade.fromToken,
      realizedPnL: pnl,
      amountUSD: trade.amountUSD ?? 0,
      tokensSold: trade.tokenAmount ?? 0,
      averageCostBasis: 0, // unknown from trade record alone
      portfolioValue,
      timestamp: trade.timestamp,
    });

    scored.push({
      timestamp: trade.timestamp,
      symbol: trade.fromToken,
      action: trade.action,
      amountUSD: trade.amountUSD ?? 0,
      tokenAmount: trade.tokenAmount ?? null,
      realizedPnL: pnl,
      pnlToVolumeRatio: ratio,
      wouldReject: !result.accepted,
      rejectionReason: result.reason,
      txHash: trade.txHash,
      cycle: trade.cycle,
    });
  }

  scored.sort((a, b) => b.pnlToVolumeRatio - a.pnlToVolumeRatio);
  return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

interface PoisonLogPayload {
  symbol: string;
  rawPnL: number;
  amountUSD: number;
  tokensSold: number;
  averageCostBasis: number;
  decimals?: number;
  timestamp?: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Per-token phantom detection (v21.20.1)
// ---------------------------------------------------------------------------

export const PHANTOM_ZERO_INV_USD = 50;
export const PHANTOM_INV_MULT = 3;
export const PHANTOM_MIN_CHECK_USD = 10;

export interface PerTokenPhantomResult {
  fired: boolean;
  tokensZeroed: Array<{
    symbol: string;
    beforeRealized: number;
    totalInvested: number;
    reason: string;
  }>;
  totalZeroedUSD: number;
}

export interface PerTokenPhantomInput {
  costBasis: Record<string, TokenCostBasis>;
  log?: (msg: string) => void;
}

/**
 * Per-token phantom detection. Complements the cumulative-ratio resync —
 * catches compositional phantoms (reasonable cumulative made of mostly-bogus
 * per-token gains from corrupted avgCostBasis, from the `|| 1` price
 * fallback at sell paths).
 *
 * Seen 2026-04-22: cumulative +$3,358 (0.93× portfolio, passed 10× cumulative
 * guard) but VADER +$1,951 on $358 inv (5.4×) and KEYCAT/LUNA/AAVE all at $0
 * invested with $100+ realized.
 *
 * Idempotent: safe every startup.
 */
export function resyncPhantomPerToken(input: PerTokenPhantomInput): PerTokenPhantomResult {
  const { costBasis } = input;
  const log = input.log ?? ((m: string) => console.log(m));

  const zeroed: PerTokenPhantomResult['tokensZeroed'] = [];
  let totalZeroedUSD = 0;

  for (const [symbol, cb] of Object.entries(costBasis)) {
    const realized = cb?.realizedPnL ?? 0;
    const invested = cb?.totalInvestedUSD ?? 0;
    if (Math.abs(realized) < PHANTOM_MIN_CHECK_USD) continue;

    let reason = '';
    if (invested === 0 && Math.abs(realized) > PHANTOM_ZERO_INV_USD) {
      reason = `zero-invested with |realized|=$${Math.abs(realized).toFixed(2)}`;
    } else if (invested > 0 && Math.abs(realized) > invested * PHANTOM_INV_MULT) {
      reason = `|realized|=$${Math.abs(realized).toFixed(2)} > ${PHANTOM_INV_MULT}× invested ($${invested.toFixed(2)})`;
    }

    if (reason) {
      zeroed.push({ symbol, beforeRealized: realized, totalInvested: invested, reason });
      totalZeroedUSD += realized;
      cb.realizedPnL = 0;
    }
  }

  if (zeroed.length > 0) {
    log('');
    log('=================================================================');
    log('  🧹 PER-TOKEN PHANTOM REALIZED PNL (v21.20.1)');
    log(`     Zeroing ${zeroed.length} tokens totaling $${totalZeroedUSD.toFixed(2)}`);
    for (const z of zeroed) {
      log(`       ${z.symbol.padEnd(10)} $${z.beforeRealized.toFixed(2)} → $0  (${z.reason})`);
    }
    log('=================================================================');
    log('');
  }

  return {
    fired: zeroed.length > 0,
    tokensZeroed: zeroed,
    totalZeroedUSD,
  };
}

/** Loud console banner — visible in Railway logs. */
function logPoisonDetection(p: PoisonLogPayload): void {
  console.error('');
  console.error('=================================================================');
  console.error('  ❌ REALIZED-PNL POISON REJECTED (sanitizer)');
  console.error(`     Symbol:     ${p.symbol}`);
  console.error(`     Proposed:   ${Number.isFinite(p.rawPnL) ? `$${p.rawPnL.toFixed(2)}` : String(p.rawPnL)}`);
  console.error(`     Amount USD: $${p.amountUSD.toFixed(2)}`);
  console.error(`     Tokens:     ${p.tokensSold}`);
  console.error(`     avgCost:    $${p.averageCostBasis}`);
  if (p.decimals !== undefined) {
    console.error(`     Decimals:   ${p.decimals}`);
  }
  if (p.timestamp) {
    console.error(`     Timestamp:  ${p.timestamp}`);
  }
  console.error(`     Reason:     ${p.reason}`);
  console.error('=================================================================');
  console.error('');
}
