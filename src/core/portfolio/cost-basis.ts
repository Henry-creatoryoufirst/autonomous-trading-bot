/**
 * Never Rest Capital — Cost Basis Tracking
 * Extracted from agent-v3.2.ts (Phase 10 refactor)
 *
 * Now imports state directly from src/state/store.ts for costBasisMap access.
 * lastKnownPrices is still passed as a parameter (it lives outside AgentState).
 */

import type { TokenCostBasis, TradeRecord } from "../types/index.js";
import { getState } from '../state/index.js';
import { validateRealizedPnL } from './pnl-sanitizer.js';
import { COHORT_QUALITY_7_SYMBOLS } from '../config/token-registry.js';

type PriceMap = Record<string, { price: number; [key: string]: any }>;

/**
 * v21.19-fix: Targeted cost-basis rebuild for a single token.
 *
 * Replays this token's BUY records from the trade log to reconstruct
 * averageCostBasis, totalInvestedUSD, and totalTokensAcquired. Used as a
 * just-in-time repair when a sell hits a token with no cost basis (usually
 * because older BUY records were written with a missing tokenAmount, or the
 * cost-basis entry was lost in a state-file migration).
 *
 * Mutates `cb` in place when replayable buys exist. Returns true iff cost
 * basis was restored to a non-zero average.
 *
 * Intentionally permissive: even a partial reconstruction (e.g. recent buys
 * replayable, older ones missing tokenAmount) is better than $0 pure-revenue
 * accounting because it gives the harvest reserve something to work with.
 */
function attemptSelfHeal(symbol: string, cb: TokenCostBasis): boolean {
  const trades = getState().tradeHistory || [];
  let totalInvested = 0;
  let totalTokens = 0;
  let realizedPnLFromSells = 0;
  let firstBuyDate: string | null = null;

  // Replay buys chronologically
  const chrono = [...trades].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  for (const t of chrono) {
    if (t.action === 'BUY' && t.toToken === symbol) {
      const tokens = t.tokenAmount ?? 0;
      const usd = t.amountUSD ?? 0;
      if (tokens <= 0 || usd <= 0) continue; // skip records missing either field
      totalInvested += usd;
      totalTokens += tokens;
      if (!firstBuyDate) firstBuyDate = t.timestamp;
    } else if (t.action === 'SELL' && t.fromToken === symbol) {
      const tokens = t.tokenAmount ?? 0;
      const usd = t.amountUSD ?? 0;
      if (tokens <= 0) continue;
      // Use the weighted-average at this point in time
      const avgCost = totalTokens > 0 ? totalInvested / totalTokens : 0;
      const sellPrice = usd / tokens;
      const pnl = avgCost > 0 ? (sellPrice - avgCost) * tokens : 0;
      realizedPnLFromSells += pnl;
      // Reduce holdings proportionally, same formula as live sell path
      const proportionSold = totalTokens > 0 ? tokens / totalTokens : 0;
      totalInvested = Math.max(0, totalInvested * (1 - proportionSold));
      totalTokens = Math.max(0, totalTokens - tokens);
    }
  }

  if (totalTokens <= 0 || totalInvested <= 0) return false;

  cb.totalInvestedUSD = totalInvested;
  cb.totalTokensAcquired = totalTokens;
  cb.averageCostBasis = totalInvested / totalTokens;
  // Preserve any existing realizedPnL — do not overwrite with replay value
  // (that would be destructive; current value may contain legitimate pre-fix
  // realizations the caller wants to keep).
  if (cb.realizedPnL === 0 && realizedPnLFromSells !== 0) {
    cb.realizedPnL = realizedPnLFromSells;
  }
  if (firstBuyDate && !cb.firstBuyDate) cb.firstBuyDate = firstBuyDate;
  return true;
}

export function getOrCreateCostBasis(
  symbol: string,
): TokenCostBasis {
  const costBasisMap = getState().costBasis;
  if (!costBasisMap[symbol]) {
    costBasisMap[symbol] = {
      symbol,
      totalInvestedUSD: 0,
      totalTokensAcquired: 0,
      averageCostBasis: 0,
      currentHolding: 0,
      realizedPnL: 0,
      unrealizedPnL: 0,
      peakPrice: 0,
      peakPriceDate: new Date().toISOString(),
      firstBuyDate: new Date().toISOString(),
      lastTradeDate: new Date().toISOString(),
      // v9.0: ATR-based dynamic stops
      atrStopPercent: null,
      atrTrailPercent: null,
      atrAtEntry: null,
      trailActivated: false,
      lastAtrUpdate: null,
    };
  }
  return costBasisMap[symbol];
}

export function updateCostBasisAfterBuy(
  symbol: string,
  amountUSD: number,
  tokensReceived: number,
  lastKnownPrices: PriceMap,
): void {
  const cb = getOrCreateCostBasis(symbol);
  if (cb.totalTokensAcquired === 0) cb.firstBuyDate = new Date().toISOString();

  // v21.2: Reset peakPrice on re-entry after full/near-full exit.
  const buyPrice = tokensReceived > 0 ? amountUSD / tokensReceived : 0;
  const wasEmpty = cb.currentHolding <= 0 || cb.totalTokensAcquired <= 0;
  if (wasEmpty && buyPrice > 0) {
    cb.peakPrice = buyPrice;
    cb.peakPriceDate = new Date().toISOString();
    cb.trailActivated = false;
    console.log(`  🔄 Peak price reset for ${symbol}: $${buyPrice.toFixed(6)} (re-entry after exit)`);
  }

  // v11.4.15: Guard against zero tokensReceived which corrupts avgCostBasis to infinity.
  if (tokensReceived <= 0) {
    const knownPrice = lastKnownPrices[symbol]?.price || lastKnownPrices[symbol === 'ETH' ? 'WETH' : symbol]?.price || 0;
    if (knownPrice > 0) {
      tokensReceived = amountUSD / knownPrice;
      console.log(`     ⚠️ tokensReceived was 0 — estimated ${tokensReceived.toFixed(8)} from price $${knownPrice.toFixed(4)}`);
    } else {
      console.warn(`     ❌ Cannot update cost basis for ${symbol}: tokensReceived=0 and no known price`);
      return;
    }
  }

  cb.totalInvestedUSD += amountUSD;
  cb.totalTokensAcquired += tokensReceived;
  cb.averageCostBasis = cb.totalTokensAcquired > 0 ? cb.totalInvestedUSD / cb.totalTokensAcquired : 0;

  // v11.4.15: Sanity check — if avgCostBasis is >20x market price, it's corrupted. Reset.
  const currentPrice = lastKnownPrices[symbol]?.price || lastKnownPrices[symbol === 'ETH' ? 'WETH' : symbol]?.price || 0;
  if (currentPrice > 0 && cb.averageCostBasis > currentPrice * 20) {
    const oldCost = cb.averageCostBasis;
    cb.averageCostBasis = currentPrice;
    cb.totalInvestedUSD = currentPrice * cb.totalTokensAcquired;
    console.warn(`🔧 SANITY RESET: ${symbol} avgCost $${oldCost.toFixed(4)} -> $${currentPrice.toFixed(4)} (was ${(oldCost/currentPrice).toFixed(0)}x market). realizedPnL preserved: $${cb.realizedPnL.toFixed(2)}`);
  }

  cb.lastTradeDate = new Date().toISOString();
  console.log(`     📊 Cost basis updated: ${symbol} avg=$${cb.averageCostBasis.toFixed(6)} invested=$${cb.totalInvestedUSD.toFixed(2)}`);
}

export function updateCostBasisAfterSell(
  symbol: string,
  amountUSD: number,
  tokensSold: number,
): number {
  const cb = getOrCreateCostBasis(symbol);

  // v21.19-fix: Self-heal missing cost basis from trade history.
  // If no averageCostBasis exists, attempt a targeted rebuild from the trade
  // log BEFORE giving up. This catches tokens like ENA/cbXRP/CLANKER where
  // older BUY records had a missing tokenAmount (buys didn't capture post-swap
  // amount) — pre-v21.19 records can't be rebuilt, but newer ones can, and
  // even partial rebuilds recover realized P&L from this point forward.
  if (cb.averageCostBasis <= 0 || cb.totalTokensAcquired <= 0) {
    const healed = attemptSelfHeal(symbol, cb);
    if (!healed) {
      console.log(`  📊 P&L: No cost basis for ${symbol} — recording sell as $${amountUSD.toFixed(2)} pure revenue (P&L neutral, self-heal failed)`);
      cb.currentHolding = Math.max(0, cb.currentHolding - tokensSold);
      return 0;
    }
    console.log(`  🔧 Self-healed cost basis for ${symbol}: avg=$${cb.averageCostBasis.toFixed(6)} from ${getState().tradeHistory.filter(t => t.action === 'BUY' && t.toToken === symbol && (t.tokenAmount ?? 0) > 0).length} replayable buys`);
  }

  // Realized P&L = (sell price per token - avg cost) * tokens sold
  const sellPricePerToken = tokensSold > 0 ? amountUSD / tokensSold : 0;
  const rawPnL = (sellPricePerToken - cb.averageCostBasis) * tokensSold;
  // Sanity clamp: can't lose more than the USDC invested in this position.
  // Without this, a corrupted averageCostBasis can produce phantom losses of thousands of dollars per sell.
  const impliedInvestment = cb.averageCostBasis * tokensSold;
  const clampedPnL = impliedInvestment > 0 ? Math.max(rawPnL, -impliedInvestment) : rawPnL;
  if (rawPnL !== clampedPnL) {
    console.warn(`  ⚠️ P&L clamp: ${symbol} raw $${rawPnL.toFixed(2)} → clamped $${clampedPnL.toFixed(2)} (avgCost $${cb.averageCostBasis.toFixed(6)} may be corrupted)`);
  }
  // v21.20: Second-line defense — reject P&Ls that are absurd relative to the
  // position or portfolio. The per-sell clamp above fails when avgCost itself
  // is poisoned (the clamp floor IS avgCost × tokens). The sanitizer uses the
  // trade's actual USD volume and the live portfolio value as honest anchors.
  const portfolioValue = (getState() as unknown as { trading?: { totalPortfolioValue?: number } })
    .trading?.totalPortfolioValue ?? 0;
  const sanitized = validateRealizedPnL({
    symbol,
    realizedPnL: clampedPnL,
    amountUSD,
    tokensSold,
    averageCostBasis: cb.averageCostBasis,
    portfolioValue,
  });
  const realizedPnL = sanitized.sanitizedPnL;
  cb.realizedPnL += realizedPnL;
  // v11.4.17: Clamp proportionSold to [0,1]
  const proportionSold = Math.min(1, cb.totalTokensAcquired > 0 ? tokensSold / cb.totalTokensAcquired : 0);
  cb.totalInvestedUSD = Math.max(0, cb.totalInvestedUSD * (1 - proportionSold));
  cb.totalTokensAcquired = Math.max(0, cb.totalTokensAcquired - tokensSold);
  cb.lastTradeDate = new Date().toISOString();
  console.log(`     📊 Sell P&L: ${realizedPnL >= 0 ? "+" : ""}$${realizedPnL.toFixed(2)} on ${symbol} (avg cost $${cb.averageCostBasis.toFixed(6)})`);
  return realizedPnL;
}

export function updateUnrealizedPnL(
  balances: { symbol: string; balance: number; usdValue: number; price?: number }[],
): void {
  const costBasisMap = getState().costBasis;
  for (const b of balances) {
    if (b.symbol === "USDC" || !costBasisMap[b.symbol]) continue;
    const cb = costBasisMap[b.symbol];
    cb.currentHolding = b.balance;
    const currentPrice = b.price || (b.balance > 0 ? b.usdValue / b.balance : 0);
    (cb as any).currentPrice = currentPrice;

    // v11.4.15: Sanity check — if avgCostBasis is absurdly high (>20x market), reset it.
    if (currentPrice > 0 && cb.averageCostBasis > currentPrice * 20 && b.usdValue > 1) {
      const oldCost = cb.averageCostBasis;
      cb.averageCostBasis = currentPrice;
      cb.totalInvestedUSD = currentPrice * cb.currentHolding;
      cb.totalTokensAcquired = cb.currentHolding;
      cb.unrealizedPnL = 0;
      console.warn(`🔧 SANITY RESET: ${b.symbol} avgCost $${oldCost.toFixed(4)} -> $${currentPrice.toFixed(4)} (was ${(oldCost/currentPrice).toFixed(0)}x market). realizedPnL preserved: $${cb.realizedPnL.toFixed(2)}`);
    } else {
      cb.unrealizedPnL = cb.averageCostBasis > 0 ? (currentPrice - cb.averageCostBasis) * b.balance : 0;
    }

    // Update peak price for trailing stop
    if (currentPrice > cb.peakPrice) {
      cb.peakPrice = currentPrice;
      cb.peakPriceDate = new Date().toISOString();
    }
  }
}

export function rebuildCostBasisFromTrades(
  trades: TradeRecord[],
): void {
  const costBasisMap = getState().costBasis;
  // Preserve accumulated realizedPnL before rebuilding
  const preservedPnL: Record<string, number> = {};
  for (const [sym, cb] of Object.entries(costBasisMap)) {
    preservedPnL[sym] = cb.realizedPnL;
  }
  // Clear and rebuild
  for (const key of Object.keys(costBasisMap)) {
    delete costBasisMap[key];
  }

  // Replay trades in chronological order
  const sorted = [...trades].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  for (const trade of sorted) {
    if (trade.action === 'BUY' && trade.toToken !== 'USDC') {
      const cb = getOrCreateCostBasis(trade.toToken);
      const tokens = trade.tokenAmount || (trade.amountUSD / 1);
      if (tokens > 0) {
        if (cb.totalTokensAcquired === 0) cb.firstBuyDate = trade.timestamp;
        cb.totalInvestedUSD += trade.amountUSD;
        cb.totalTokensAcquired += tokens;
        cb.averageCostBasis = cb.totalTokensAcquired > 0 ? cb.totalInvestedUSD / cb.totalTokensAcquired : 0;
        cb.lastTradeDate = trade.timestamp;
      }
    } else if (trade.action === 'SELL' && trade.fromToken !== 'USDC') {
      const cb = getOrCreateCostBasis(trade.fromToken);
      const tokens = trade.tokenAmount || 0;
      if (tokens > 0 && cb.totalTokensAcquired > 0) {
        const sellPrice = trade.amountUSD / tokens;
        const rawPnL = (sellPrice - cb.averageCostBasis) * tokens;
        // Sanity clamp: can't lose more than the capital invested in this tranche
        const impliedInvestment = cb.averageCostBasis * tokens;
        const realizedPnL = impliedInvestment > 0 ? Math.max(rawPnL, -impliedInvestment) : rawPnL;
        cb.realizedPnL += realizedPnL;
        const proportionSold = Math.min(1, tokens / cb.totalTokensAcquired);
        cb.totalInvestedUSD = Math.max(0, cb.totalInvestedUSD * (1 - proportionSold));
        cb.totalTokensAcquired = Math.max(0, cb.totalTokensAcquired - tokens);
        cb.lastTradeDate = trade.timestamp;
      } else if (tokens > 0) {
        cb.currentHolding = Math.max(0, cb.currentHolding - tokens);
      }
    }
  }

  // Restore preserved P&L for tokens that had it
  for (const [sym, pnl] of Object.entries(preservedPnL)) {
    if (costBasisMap[sym] && pnl !== 0) {
      if (costBasisMap[sym].realizedPnL === 0) {
        costBasisMap[sym].realizedPnL = pnl;
      }
    }
  }
}

/**
 * NVR-SPEC-027: Cost-basis audit + repair.
 *
 * Scans every cost-basis entry for corruption patterns observed in production
 * 2026-05-07:
 *   - SPX with averageCostBasis = $3.7B/token (decimal-mismatch corruption)
 *   - WELL/VADER/LUNA/TIBBIR/ENA/cbLTC with averageCostBasis ~ 0 despite
 *     non-zero current holding (lost history or capital-liberation zeroing)
 *
 * Repair priority:
 *   1. attemptSelfHeal() — replay trade history for that token (best fidelity)
 *   2. peg-to-market — set avg cost = current market price (honest "we don't
 *      know historical entry; treat as just-bought"). Last-ditch when trade
 *      history is missing or unreplayable.
 *
 * Realized P&L is preserved across repair (we don't claw back past sells —
 * those happened, the P&L numbers may be inflated but they're durable
 * accounting facts in the trade log).
 *
 * Use:
 *   - On startup: report-only mode (dryRun=true) logs what WOULD be repaired
 *   - Via POST /api/admin/repair-cost-basis: dryRun=false to apply
 *
 * Returns a structured audit report so the dashboard / admin tooling can
 * surface what the bot found and fixed.
 */
export interface CostBasisAuditReport {
  scannedAt: string;
  scanned: number;
  healthy: number;
  repaired: Array<{
    symbol: string;
    method: 'self-heal-from-trade-history' | 'peg-to-market' | 'DRY_RUN' | 'delete-ghost-entry' | 'zero-stuck-position';
    reasons: string[];
    before: { averageCostBasis: number; totalInvestedUSD: number; totalTokensAcquired: number };
    after: { averageCostBasis: number; totalInvestedUSD: number; totalTokensAcquired: number } | null;
  }>;
  unrepaired: Array<{ symbol: string; reasons: string[] }>;
  dryRun: boolean;
}

const ABSOLUTE_AVG_COST_CEILING_USD = 100_000;
const RATIO_TO_MARKET_CEILING = 50; // avgCost > 50× market = corrupted
const MIN_BALANCE_TO_FLAG_MISSING = 0.000001; // ignore dust

export function auditAndRepairCostBasis(opts: {
  dryRun?: boolean;
  balances?: Array<{ symbol: string; balance: number; usdValue: number; price?: number }>;
} = {}): CostBasisAuditReport {
  const dryRun = opts.dryRun ?? true;
  const cbMap = getState().costBasis;
  const balances = opts.balances ?? ((getState() as any).trading?.balances ?? []);

  const balanceBySym: Record<string, number> = {};
  const priceBySym: Record<string, number> = {};
  const usdBySym: Record<string, number> = {};
  for (const b of balances) {
    balanceBySym[b.symbol] = b.balance ?? 0;
    usdBySym[b.symbol] = b.usdValue ?? 0;
    if (b.balance > 0 && b.usdValue > 0) priceBySym[b.symbol] = b.usdValue / b.balance;
    else if (b.price && b.price > 0) priceBySym[b.symbol] = b.price;
  }

  const report: CostBasisAuditReport = {
    scannedAt: new Date().toISOString(),
    scanned: 0,
    healthy: 0,
    repaired: [],
    unrepaired: [],
    dryRun,
  };

  for (const [symbol, cb] of Object.entries(cbMap)) {
    report.scanned++;
    if (symbol === 'USDC') { report.healthy++; continue; }

    const balance = balanceBySym[symbol] ?? cb.currentHolding ?? 0;
    const price = priceBySym[symbol] ?? 0;
    const usdValue = usdBySym[symbol] ?? (balance * price);

    const reasons: string[] = [];
    if (cb.averageCostBasis > ABSOLUTE_AVG_COST_CEILING_USD) {
      reasons.push(
        `averageCostBasis $${cb.averageCostBasis.toFixed(2)} exceeds $${ABSOLUTE_AVG_COST_CEILING_USD} ceiling (corruption)`,
      );
    }
    if (price > 0 && cb.averageCostBasis > price * RATIO_TO_MARKET_CEILING) {
      reasons.push(
        `averageCostBasis $${cb.averageCostBasis.toFixed(6)} > ${RATIO_TO_MARKET_CEILING}× market $${price.toFixed(6)}`,
      );
    }
    if (
      balance > MIN_BALANCE_TO_FLAG_MISSING &&
      usdValue > 1 &&
      cb.averageCostBasis === 0 &&
      cb.totalInvestedUSD === 0 &&
      cb.totalTokensAcquired === 0
    ) {
      reasons.push(
        `holds ${balance.toFixed(6)} ${symbol} ($${usdValue.toFixed(2)}) but no cost-basis history`,
      );
    }

    if (reasons.length === 0) {
      report.healthy++;
      continue;
    }

    const before = {
      averageCostBasis: cb.averageCostBasis,
      totalInvestedUSD: cb.totalInvestedUSD,
      totalTokensAcquired: cb.totalTokensAcquired,
    };

    if (dryRun) {
      report.repaired.push({ symbol, method: 'DRY_RUN', reasons, before, after: null });
      continue;
    }

    // Pre-repair: zero out the corrupted fields so attemptSelfHeal sees an
    // empty slate and replays cleanly. Self-heal's gate is `averageCostBasis
    // <= 0 || totalTokensAcquired <= 0`, so resetting forces it to engage.
    cb.averageCostBasis = 0;
    cb.totalInvestedUSD = 0;
    cb.totalTokensAcquired = 0;

    const healed = attemptSelfHeal(symbol, cb);

    // Validate self-heal result — if replay produced fresh corruption (e.g.
    // because trade-record tokenAmount values themselves carry the decimal
    // bug, as observed on SPX 2026-05-07), don't accept the result.
    const selfHealClean = healed
      && cb.averageCostBasis > 0
      && cb.averageCostBasis < ABSOLUTE_AVG_COST_CEILING_USD
      && cb.totalTokensAcquired > 0
      && (price <= 0 || cb.averageCostBasis < price * RATIO_TO_MARKET_CEILING);

    if (selfHealClean) {
      report.repaired.push({
        symbol,
        method: 'self-heal-from-trade-history',
        reasons,
        before,
        after: {
          averageCostBasis: cb.averageCostBasis,
          totalInvestedUSD: cb.totalInvestedUSD,
          totalTokensAcquired: cb.totalTokensAcquired,
        },
      });
    } else if (
      price > 0 &&
      price < ABSOLUTE_AVG_COST_CEILING_USD &&
      balance > 0 &&
      balance * price > 1
    ) {
      // Peg to current market. unrealizedPnL becomes 0 (honest: we don't
      // know historical entry; treat residual as just-bought today).
      // Guards: skip when implied per-token price is absurd ($100K+ for one
      // token = corrupted on-chain balance read, like SPX 2026-05-07). Also
      // skip dust positions (balance × price ≤ $1).
      cb.averageCostBasis = price;
      cb.totalInvestedUSD = price * balance;
      cb.totalTokensAcquired = balance;
      cb.currentHolding = balance;
      cb.unrealizedPnL = 0;
      report.repaired.push({
        symbol,
        method: 'peg-to-market',
        reasons,
        before,
        after: {
          averageCostBasis: cb.averageCostBasis,
          totalInvestedUSD: cb.totalInvestedUSD,
          totalTokensAcquired: cb.totalTokensAcquired,
        },
      });
    } else if (usdValue < 1 || balance <= 0) {
      // No real position remaining. Delete the entry — it's a ghost.
      // Bot will recreate on next buy with clean accounting.
      delete cbMap[symbol];
      report.repaired.push({
        symbol,
        method: 'delete-ghost-entry',
        reasons,
        before,
        after: { averageCostBasis: 0, totalInvestedUSD: 0, totalTokensAcquired: 0 },
      });
    } else {
      // Position is real ($1+) but BOTH self-heal AND peg-to-market would
      // produce corruption (typically because on-chain balance itself has
      // bad decimals, like SPX 2026-05-07). Last resort: zero the
      // costBasis fields. Future sells return 0 P&L (treated as pure
      // revenue per existing fallback in updateCostBasisAfterSell);
      // future buys re-establish costBasis cleanly.
      cb.averageCostBasis = 0;
      cb.totalInvestedUSD = 0;
      cb.totalTokensAcquired = 0;
      cb.unrealizedPnL = 0;
      report.repaired.push({
        symbol,
        method: 'zero-stuck-position',
        reasons,
        before,
        after: { averageCostBasis: 0, totalInvestedUSD: 0, totalTokensAcquired: 0 },
      });
    }
  }

  return report;
}

// ============================================================================
// DUST PRUNE — v21.28 (one-shot migration)
//
// Background: after the 2026-05-15 Option B pivot the bot kept dozens of
// cost-basis entries from the abandoned meme/AI cohort. Each entry was
// for a near-zero on-chain balance (sub-cent residue from past rebalances)
// but still appeared in every prompt the LLM reasons over. The corruption
// surfaced 2026-05-18 when the WETH-sell reasoning text contained
// "+$2408.96 unrealized" against an actual unrealized of +$72 — the model
// was averaging across 38 entries, most of them dead.
//
// This module deletes dust entries from state.costBasis without touching
// the on-chain wallet. The tokens themselves stay where they are
// (worthless, no slippage, no gas exposure); the bot just stops thinking
// about them.
//
// Two safety belts:
//   1. Symbols in COHORT_QUALITY_7 are NEVER pruned, even if their value
//      is currently dust. The cohort is locked for the Option B window
//      per CLAUDE.md Rule 1.
//   2. A position is only considered dust if BOTH its cost-basis-residual
//      AND its current market value are below threshold. This protects
//      mooners — a tiny invested amount that's now worth $50 stays.
// ============================================================================

/**
 * Default dust threshold in USD. Anything under this in BOTH invested
 * residual and current market value is considered prunable (unless
 * cohort-protected).
 */
export const DUST_PRUNE_THRESHOLD_USD = 1.0;

/**
 * Pure dust classifier — no side effects, fully testable.
 *
 * @param costBasis        the bot's `state.costBasis` map (not mutated).
 * @param currentValueMap  symbol → current market USD value (from
 *                          state.trading.balances, populated after the
 *                          first wallet poll).
 * @param thresholdUsd     dust ceiling in USD.
 * @param protectedSymbols symbols that must never be pruned regardless of
 *                          value. Defaults to COHORT_QUALITY_7_SYMBOLS.
 *
 * @returns the symbols whose entries SHOULD be pruned. Sorted for
 *           deterministic logging.
 */
export function identifyDustCostBasisEntries(
  costBasis: Record<string, TokenCostBasis>,
  currentValueMap: Record<string, number>,
  thresholdUsd: number = DUST_PRUNE_THRESHOLD_USD,
  protectedSymbols: ReadonlyArray<string> = COHORT_QUALITY_7_SYMBOLS,
): string[] {
  const protectedSet = new Set(protectedSymbols);
  const prunable: string[] = [];

  for (const [symbol, cb] of Object.entries(costBasis)) {
    if (protectedSet.has(symbol)) continue;
    // Invested-residual proxy: how much we paid for what we still hold.
    const investedResidualUsd = (cb.totalTokensAcquired ?? 0) * (cb.averageCostBasis ?? 0);
    const currentValueUsd = currentValueMap[symbol] ?? 0;
    // Require BOTH to be sub-threshold. A mooner with tiny cost basis but
    // large current value (rare but possible) survives this check.
    if (investedResidualUsd < thresholdUsd && currentValueUsd < thresholdUsd) {
      prunable.push(symbol);
    }
  }

  return prunable.sort();
}

/**
 * One-shot migration runner. Idempotent — checks the persistence flag
 * `_migrationDustPruneV21_28` and no-ops if already applied.
 *
 * Mutates `state.costBasis` by deleting prunable entries. Sets the flag
 * on completion. Returns the symbols that were actually pruned (or null
 * if the migration was already applied or balances aren't ready yet).
 *
 * Caller is responsible for calling `saveTradeHistory()` afterward to
 * persist the cleaned-up state + the migration flag.
 */
export function runDustPruneMigrationOnce(
  thresholdUsd: number = DUST_PRUNE_THRESHOLD_USD,
): string[] | null {
  const state = getState();
  if ((state as any)._migrationDustPruneV21_28) {
    return null; // already applied
  }

  const balances = state.trading?.balances ?? [];
  if (balances.length === 0) {
    // Wallet hasn't been polled yet — defer to a later call. Don't set the
    // flag so we retry next cycle.
    return null;
  }

  const valueMap: Record<string, number> = {};
  for (const b of balances) {
    if (b && typeof b.symbol === 'string') {
      valueMap[b.symbol] = b.usdValue ?? 0;
    }
  }

  const prunable = identifyDustCostBasisEntries(state.costBasis, valueMap, thresholdUsd);
  for (const symbol of prunable) {
    delete state.costBasis[symbol];
  }

  (state as any)._migrationDustPruneV21_28 = true;

  if (prunable.length > 0) {
    console.log(
      `🔧 MIGRATION v21.28 (dust-prune): removed ${prunable.length} cost-basis entries ` +
      `below $${thresholdUsd.toFixed(2)} (cohort tokens preserved). Symbols: ${prunable.join(', ')}`,
    );
  } else {
    console.log(`🔧 MIGRATION v21.28 (dust-prune): no dust entries above the noise floor; nothing to remove.`);
  }

  return prunable;
}

// ============================================================================
// V2 DUST PRUNE — stricter single-factor sweep on stale per-unit math
//
// The v1 prune (above) uses joint-AND: invested-residual < $1 AND current
// market value < $1. That preserves "loser" positions where we paid real
// money but value collapsed — which is correct accounting.
//
// v2 catches a different class: entries whose per-unit math is so warped
// that source A of INV-1 keeps drifting from sources B+C, even though the
// position is effectively zero. The 2026-05-21 production case: Henry's
// main bot had INV-1 firing SEVERE for 33 hours straight (3.15% drift,
// outlier=A) because some entries had `currentHolding × averageCostBasis`
// computing to bizarre values — exactly the SPX-style bug pattern
// (averageCostBasis = $3.77B from a unit-conversion bug, currentHolding =
// 1e-15 → $3.77e-6 in source A but $0 in balances).
//
// v2 is a one-shot stricter sweep targeting entries where
// `currentHolding × averageCostBasis < $0.10` — anything below that floor
// can never contribute meaningful capital but DOES pollute source A.
// Cohort tokens are still protected.
// ============================================================================

export const DUST_PRUNE_V2_THRESHOLD_USD = 0.10;

/**
 * Pure classifier for v2: entries whose per-unit valuation (currentHolding
 * × averageCostBasis) is below the threshold. Single-factor — doesn't
 * require the balances side to also be sub-threshold, because the failure
 * mode is exactly when in-state math diverges from balances.
 */
export function identifyDustV2CostBasisEntries(
  costBasis: Record<string, TokenCostBasis>,
  thresholdUsd: number = DUST_PRUNE_V2_THRESHOLD_USD,
  protectedSymbols: ReadonlyArray<string> = COHORT_QUALITY_7_SYMBOLS,
): string[] {
  const protectedSet = new Set(protectedSymbols);
  const prunable: string[] = [];

  for (const [symbol, cb] of Object.entries(costBasis)) {
    if (protectedSet.has(symbol)) continue;
    const holding = cb.currentHolding ?? 0;
    const avgCost = cb.averageCostBasis ?? 0;
    const perUnitValueUsd = holding * avgCost;
    if (perUnitValueUsd < thresholdUsd) {
      prunable.push(symbol);
    }
  }

  return prunable.sort();
}

/**
 * Idempotent one-shot v2 migration runner. Gated by
 * `_migrationDustPruneV2`. Caller responsible for `saveTradeHistory()`
 * after.
 */
export function runDustPruneV2MigrationOnce(
  thresholdUsd: number = DUST_PRUNE_V2_THRESHOLD_USD,
): string[] | null {
  const state = getState();
  if ((state as any)._migrationDustPruneV2) {
    return null;
  }

  const prunable = identifyDustV2CostBasisEntries(state.costBasis, thresholdUsd);
  for (const symbol of prunable) {
    delete state.costBasis[symbol];
  }

  (state as any)._migrationDustPruneV2 = true;

  if (prunable.length > 0) {
    console.log(
      `🔧 MIGRATION v2 (dust-prune): removed ${prunable.length} cost-basis entries ` +
      `with currentHolding × averageCostBasis < $${thresholdUsd.toFixed(2)} ` +
      `(cohort tokens preserved). Symbols: ${prunable.join(', ')}`,
    );
  } else {
    console.log(`🔧 MIGRATION v2 (dust-prune): no stale per-unit entries; nothing to remove.`);
  }

  return prunable;
}
