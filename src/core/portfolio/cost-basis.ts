/**
 * Never Rest Capital — Cost Basis Tracking
 * Extracted from agent-v3.2.ts (Phase 10 refactor)
 *
 * Now imports state directly from src/state/store.ts for costBasisMap access.
 * lastKnownPrices is still passed as a parameter (it lives outside AgentState).
 */

import type { TokenCostBasis, TradeRecord } from "../types/index.js";
import { getState } from '../state/index.js';

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
  const realizedPnL = impliedInvestment > 0 ? Math.max(rawPnL, -impliedInvestment) : rawPnL;
  if (rawPnL !== realizedPnL) {
    console.warn(`  ⚠️ P&L clamp: ${symbol} raw $${rawPnL.toFixed(2)} → clamped $${realizedPnL.toFixed(2)} (avgCost $${cb.averageCostBasis.toFixed(6)} may be corrupted)`);
  }
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
