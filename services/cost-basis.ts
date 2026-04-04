/**
 * Cost Basis Tracking Service
 *
 * Extracted from agent-v3.2.ts — manages cost basis tracking, peakPrice management,
 * and P&L calculation for all token positions.
 *
 * All functions accept state/dependencies as explicit parameters (no globals).
 */

// ============================================================================
// TYPES
// ============================================================================

export interface TokenCostBasis {
  symbol: string;
  totalInvestedUSD: number;       // Total USD spent buying this token
  totalTokensAcquired: number;    // Total tokens bought (gross, before sells reduce it)
  averageCostBasis: number;       // Weighted avg price paid per token
  currentHolding: number;         // Tokens held right now (synced from on-chain)
  realizedPnL: number;            // Cumulative profit/loss from sells
  unrealizedPnL: number;          // (currentPrice - avgCost) * currentHolding
  peakPrice: number;              // Highest price seen since first purchase
  peakPriceDate: string;          // When peak occurred
  firstBuyDate: string;
  lastTradeDate: string;
  // v9.0: ATR-based dynamic stops
  atrStopPercent: number | null;       // Current ATR stop as % (negative, e.g. -12.5)
  atrTrailPercent: number | null;      // Current ATR trail as % (negative)
  atrAtEntry: number | null;           // ATR% snapshot at first buy
  trailActivated: boolean;             // True once position is +1xATR in profit
  lastAtrUpdate: string | null;        // ISO timestamp of last ATR computation
}

/** Lookup for last known prices, keyed by symbol */
export type PriceLookup = Record<string, { price: number; [key: string]: any }>;

/** Minimal trade record for cost basis rebuild */
export interface CostBasisTradeRecord {
  timestamp: string;
  action: "BUY" | "SELL" | "HOLD" | "REBALANCE" | "WITHDRAW";
  fromToken: string;
  toToken: string;
  amountUSD: number;
  tokenAmount?: number;
  success: boolean;
}

// ============================================================================
// DEFAULTS
// ============================================================================

export function createDefaultCostBasis(symbol: string): TokenCostBasis {
  return {
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

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Get or create a cost basis entry for the given symbol.
 * Mutates costBasisMap in place (creates entry if missing).
 */
export function getOrCreateCostBasis(
  costBasisMap: Record<string, TokenCostBasis>,
  symbol: string,
): TokenCostBasis {
  if (!costBasisMap[symbol]) {
    costBasisMap[symbol] = createDefaultCostBasis(symbol);
  }
  return costBasisMap[symbol];
}

/**
 * Update cost basis after a BUY.
 * Mutates the cost basis entry in place.
 *
 * v21.2: Resets peakPrice on re-entry after full/near-full exit to prevent
 * the trailing stop from firing instantly on stale peak data.
 */
export function updateCostBasisAfterBuy(
  costBasisMap: Record<string, TokenCostBasis>,
  symbol: string,
  amountUSD: number,
  tokensReceived: number,
  lastKnownPrices: PriceLookup,
): void {
  const cb = getOrCreateCostBasis(costBasisMap, symbol);
  if (cb.totalTokensAcquired === 0) cb.firstBuyDate = new Date().toISOString();

  // v21.2: Reset peakPrice on re-entry after full/near-full exit.
  // Without this, buying cbBTC at $68K with a stale peakPrice of $69.9K means
  // the trailing stop fires instantly (-2.7% from "peak"). The buy-sell-buy-sell
  // death loop burned hundreds of dollars.
  const buyPrice = tokensReceived > 0 ? amountUSD / tokensReceived : 0;
  const wasEmpty = cb.currentHolding <= 0 || cb.totalTokensAcquired <= 0;
  if (wasEmpty && buyPrice > 0) {
    cb.peakPrice = buyPrice;
    cb.peakPriceDate = new Date().toISOString();
    cb.trailActivated = false; // Reset trailing stop activation
    console.log(`  🔄 Peak price reset for ${symbol}: $${buyPrice.toFixed(6)} (re-entry after exit)`);
  }

  // v11.4.15: Guard against zero tokensReceived which corrupts avgCostBasis to infinity.
  // This happened with ETH buys where balance read returned native ETH instead of WETH.
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

/**
 * Update cost basis after a SELL. Returns the realized P&L.
 *
 * v11.4.17: Clamps proportionSold to [0,1] — selling more than tracked tokens shouldn't go negative.
 */
export function updateCostBasisAfterSell(
  costBasisMap: Record<string, TokenCostBasis>,
  symbol: string,
  amountUSD: number,
  tokensSold: number,
): number {
  const cb = getOrCreateCostBasis(costBasisMap, symbol);

  // If we have no cost basis for this token (lost on restart), treat as pure profit
  if (cb.averageCostBasis <= 0 || cb.totalTokensAcquired <= 0) {
    console.log(`  📊 P&L: No cost basis for ${symbol} — recording sell as $${amountUSD.toFixed(2)} pure revenue (P&L neutral)`);
    cb.currentHolding = Math.max(0, cb.currentHolding - tokensSold);
    return 0; // Don't record false P&L when cost basis is unknown
  }

  // Realized P&L = (sell price per token - avg cost) * tokens sold
  const sellPricePerToken = tokensSold > 0 ? amountUSD / tokensSold : 0;
  const realizedPnL = (sellPricePerToken - cb.averageCostBasis) * tokensSold;
  cb.realizedPnL += realizedPnL;
  // Reduce invested proportionally (cost basis stays same for remaining tokens)
  // v11.4.17: Clamp proportionSold to [0,1] — selling more than tracked tokens shouldn't go negative
  const proportionSold = Math.min(1, cb.totalTokensAcquired > 0 ? tokensSold / cb.totalTokensAcquired : 0);
  cb.totalInvestedUSD = Math.max(0, cb.totalInvestedUSD * (1 - proportionSold));
  cb.totalTokensAcquired = Math.max(0, cb.totalTokensAcquired - tokensSold);
  cb.lastTradeDate = new Date().toISOString();
  console.log(`     📊 Sell P&L: ${realizedPnL >= 0 ? "+" : ""}$${realizedPnL.toFixed(2)} on ${symbol} (avg cost $${cb.averageCostBasis.toFixed(6)})`);
  return realizedPnL;
}

/**
 * Update unrealized P&L for all held positions from current balances.
 * Also updates peakPrice for trailing stop tracking.
 */
export function updateUnrealizedPnL(
  costBasisMap: Record<string, TokenCostBasis>,
  balances: { symbol: string; balance: number; usdValue: number; price?: number }[],
): void {
  for (const b of balances) {
    if (b.symbol === "USDC" || !costBasisMap[b.symbol]) continue;
    const cb = costBasisMap[b.symbol];
    cb.currentHolding = b.balance;
    const currentPrice = b.price || (b.balance > 0 ? b.usdValue / b.balance : 0);
    (cb as any).currentPrice = currentPrice;

    // v11.4.15: Sanity check — if avgCostBasis is absurdly high (>20x market), reset it.
    // This catches corrupted cost basis from ETH/WETH balance mismatch or stale state.
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

/**
 * Rebuild cost basis from a complete trade history.
 * Resets all cost basis entries and replays trades chronologically.
 * Returns the rebuilt costBasis map.
 */
export function rebuildCostBasisFromTrades(
  costBasisMap: Record<string, TokenCostBasis>,
  trades: CostBasisTradeRecord[],
): Record<string, TokenCostBasis> {
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
      const cb = getOrCreateCostBasis(costBasisMap, trade.toToken);
      const tokens = trade.tokenAmount || (trade.amountUSD / 1); // Fallback if no token amount
      if (tokens > 0) {
        if (cb.totalTokensAcquired === 0) cb.firstBuyDate = trade.timestamp;
        cb.totalInvestedUSD += trade.amountUSD;
        cb.totalTokensAcquired += tokens;
        cb.averageCostBasis = cb.totalTokensAcquired > 0 ? cb.totalInvestedUSD / cb.totalTokensAcquired : 0;
        cb.lastTradeDate = trade.timestamp;
      }
    } else if (trade.action === 'SELL' && trade.fromToken !== 'USDC') {
      const cb = getOrCreateCostBasis(costBasisMap, trade.fromToken);
      const tokens = trade.tokenAmount || 0;
      if (tokens > 0 && cb.totalTokensAcquired > 0) {
        const sellPrice = trade.amountUSD / tokens;
        const realizedPnL = (sellPrice - cb.averageCostBasis) * tokens;
        cb.realizedPnL += realizedPnL;
        const proportionSold = Math.min(1, tokens / cb.totalTokensAcquired);
        cb.totalInvestedUSD = Math.max(0, cb.totalInvestedUSD * (1 - proportionSold));
        cb.totalTokensAcquired = Math.max(0, cb.totalTokensAcquired - tokens);
        cb.lastTradeDate = trade.timestamp;
      } else if (tokens > 0) {
        // No matching buy in history — cannot compute P&L, skip silently
        cb.currentHolding = Math.max(0, cb.currentHolding - tokens);
      }
    }
  }

  // Restore preserved P&L for tokens that had it
  for (const [sym, pnl] of Object.entries(preservedPnL)) {
    if (costBasisMap[sym] && pnl !== 0) {
      // Only add back if the rebuild didn't already compute a value
      if (costBasisMap[sym].realizedPnL === 0) {
        costBasisMap[sym].realizedPnL = pnl;
      }
    }
  }

  return costBasisMap;
}
