/**
 * NVR Capital — Enhanced Paper Trading
 *
 * Real-time paper trading that mirrors exactly what the live bot would do.
 * Side-by-side comparison with live results.
 * Tracks divergence between paper and live over time.
 */

import { calculateRSI, calculateMACD, calculateBollingerBands, calculateSMA } from '../../algorithm/indicators.js';
import type {
  EnhancedPaperState,
  StrategyParams,
  ReplayTrade,
  PerformanceMetrics,
} from '../types.js';
import { DEFAULT_STRATEGY_PARAMS } from '../types.js';

// ============================================================================
// PAPER PORTFOLIO MANAGEMENT
// ============================================================================

/**
 * Create a new enhanced paper portfolio.
 */
export function createEnhancedPaper(
  id: string,
  strategyName: string,
  capital: number
): EnhancedPaperState {
  return {
    id,
    strategyName,
    startedAt: Date.now(),
    capital,
    cash: capital,
    positions: {},
    trades: [],
    equityCurve: [{ timestamp: Date.now(), value: capital }],
    metrics: emptyMetrics(capital),
    liveComparison: {
      liveReturnPct: 0,
      paperReturnPct: 0,
      divergencePct: 0,
      lastUpdated: Date.now(),
      divergenceHistory: [],
    },
  };
}

// ============================================================================
// TICK PROCESSING
// ============================================================================

/**
 * Process a price tick through the paper trader.
 * Mirrors the live bot's decision pipeline.
 *
 * @param state - Current paper portfolio state
 * @param params - Strategy parameters
 * @param symbol - Token symbol
 * @param price - Current price
 * @param priceHistory - Array of historical close prices (for indicators)
 * @returns Updated state and any trade executed
 */
export function processTick(
  state: EnhancedPaperState,
  params: StrategyParams,
  symbol: string,
  price: number,
  priceHistory: number[]
): { state: EnhancedPaperState; trade: ReplayTrade | null } {
  if (price <= 0 || priceHistory.length < 50) {
    return { state, trade: null };
  }

  // Calculate confluence
  const confluence = calculateSimConfluence(priceHistory);
  const portfolioValue = getPortfolioValue(state, { [symbol]: price });
  const cashPct = portfolioValue > 0 ? (state.cash / portfolioValue) * 100 : 100;
  const pos = state.positions[symbol];

  // === SELL LOGIC ===
  if (pos && pos.qty > 0) {
    const gainPct = ((price - pos.costBasis) / pos.costBasis) * 100;

    // Stop loss
    if (gainPct <= -params.stopLossPercent) {
      const sellUSD = pos.qty * price;
      const pnl = sellUSD - pos.qty * pos.costBasis;
      state.cash += sellUSD;
      delete state.positions[symbol];
      const trade = makeTrade(Date.now(), 'SELL', symbol, sellUSD, price,
        `STOP_LOSS (${gainPct.toFixed(1)}%)`, getPortfolioValue(state, { [symbol]: price }), pnl, confluence);
      state.trades.push(trade);
      updateMetrics(state, { [symbol]: price });
      return { state, trade };
    }

    // Profit take
    if (gainPct >= params.profitTakePercent) {
      const sellQty = pos.qty * 0.3;
      const sellUSD = sellQty * price;
      const pnl = sellQty * (price - pos.costBasis);
      state.cash += sellUSD;
      pos.qty -= sellQty;
      if (pos.qty < 0.0001) delete state.positions[symbol];
      const trade = makeTrade(Date.now(), 'SELL', symbol, sellUSD, price,
        `PROFIT_TAKE (${gainPct.toFixed(1)}%)`, getPortfolioValue(state, { [symbol]: price }), pnl, confluence);
      state.trades.push(trade);
      updateMetrics(state, { [symbol]: price });
      return { state, trade };
    }

    // Confluence sell
    if (confluence <= params.confluenceSellThreshold) {
      const sellQty = pos.qty * 0.5;
      const sellUSD = sellQty * price;
      const pnl = sellQty * (price - pos.costBasis);
      state.cash += sellUSD;
      pos.qty -= sellQty;
      if (pos.qty < 0.0001) delete state.positions[symbol];
      const trade = makeTrade(Date.now(), 'SELL', symbol, sellUSD, price,
        `SIGNAL_SELL (conf=${confluence})`, getPortfolioValue(state, { [symbol]: price }), pnl, confluence);
      state.trades.push(trade);
      updateMetrics(state, { [symbol]: price });
      return { state, trade };
    }
  }

  // === BUY LOGIC ===
  if (confluence >= params.confluenceBuyThreshold && cashPct >= params.cashDeployThreshold) {
    const currentPosValue = pos ? pos.qty * price : 0;
    const currentPosPct = portfolioValue > 0 ? (currentPosValue / portfolioValue) * 100 : 0;
    if (currentPosPct >= params.maxPositionPercent) {
      updateMetrics(state, { [symbol]: price });
      return { state, trade: null };
    }

    const winRate = 0.55;
    const avgWinLoss = 1.5;
    const kellyPct = (winRate - (1 - winRate) / avgWinLoss) * params.kellyFraction * 100;
    const sizePct = Math.min(kellyPct, params.maxPositionPercent - currentPosPct);
    let sizeUSD = (sizePct / 100) * portfolioValue;
    sizeUSD = Math.min(sizeUSD, state.cash);
    if (sizeUSD < params.minPositionUSD) {
      updateMetrics(state, { [symbol]: price });
      return { state, trade: null };
    }

    const qty = sizeUSD / price;
    state.cash -= sizeUSD;

    if (pos) {
      const totalQty = pos.qty + qty;
      pos.costBasis = (pos.qty * pos.costBasis + sizeUSD) / totalQty;
      pos.qty = totalQty;
    } else {
      state.positions[symbol] = { qty, costBasis: price, entryTime: Date.now() };
    }

    const trade = makeTrade(Date.now(), 'BUY', symbol, sizeUSD, price,
      `SIGNAL_BUY (conf=${confluence})`, getPortfolioValue(state, { [symbol]: price }), 0, confluence);
    state.trades.push(trade);
    updateMetrics(state, { [symbol]: price });
    return { state, trade };
  }

  // No trade — just update metrics
  updateMetrics(state, { [symbol]: price });
  return { state, trade: null };
}

// ============================================================================
// LIVE COMPARISON
// ============================================================================

/**
 * Update the live comparison tracking.
 * Call this periodically with the live bot's current return.
 */
export function updateLiveComparison(
  state: EnhancedPaperState,
  liveReturnPct: number,
  currentPrices: Record<string, number>
): void {
  const paperValue = getPortfolioValue(state, currentPrices);
  const paperReturnPct = state.capital > 0
    ? ((paperValue - state.capital) / state.capital) * 100
    : 0;

  const divergencePct = paperReturnPct - liveReturnPct;

  if (!state.liveComparison) {
    state.liveComparison = {
      liveReturnPct,
      paperReturnPct,
      divergencePct,
      lastUpdated: Date.now(),
      divergenceHistory: [],
    };
  }

  state.liveComparison.liveReturnPct = liveReturnPct;
  state.liveComparison.paperReturnPct = paperReturnPct;
  state.liveComparison.divergencePct = divergencePct;
  state.liveComparison.lastUpdated = Date.now();

  state.liveComparison.divergenceHistory.push({
    timestamp: Date.now(),
    livePct: liveReturnPct,
    paperPct: paperReturnPct,
    divergencePct,
  });

  // Cap history at 2000 entries
  if (state.liveComparison.divergenceHistory.length > 2000) {
    const step = Math.ceil(state.liveComparison.divergenceHistory.length / 1500);
    state.liveComparison.divergenceHistory = state.liveComparison.divergenceHistory.filter(
      (_, i) => i === 0 || i === state.liveComparison!.divergenceHistory.length - 1 || i % step === 0
    );
  }
}

/**
 * Get a summary of paper trading performance and comparison with live.
 */
export function getPaperSummary(state: EnhancedPaperState, currentPrices: Record<string, number>) {
  const portfolioValue = getPortfolioValue(state, currentPrices);
  const returnPct = state.capital > 0
    ? ((portfolioValue - state.capital) / state.capital) * 100
    : 0;

  return {
    id: state.id,
    strategyName: state.strategyName,
    startedAt: state.startedAt,
    portfolioValue,
    returnPct,
    cash: state.cash,
    positionCount: Object.keys(state.positions).length,
    tradeCount: state.trades.length,
    metrics: state.metrics,
    liveComparison: state.liveComparison,
  };
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function calculateSimConfluence(prices: number[]): number {
  let score = 0;

  const rsi = calculateRSI(prices);
  if (rsi !== null) {
    if (rsi < 30) score += 25;
    else if (rsi < 40) score += 12;
    else if (rsi > 70) score -= 25;
    else if (rsi > 60) score -= 12;
  }

  const macd = calculateMACD(prices);
  if (macd) {
    if (macd.signal === 'BULLISH') score += 25;
    else if (macd.signal === 'BEARISH') score -= 25;
  }

  const bb = calculateBollingerBands(prices);
  if (bb) {
    if (bb.signal === 'OVERSOLD') score += 20;
    else if (bb.signal === 'OVERBOUGHT') score -= 20;
  }

  const sma20 = calculateSMA(prices, 20);
  const sma50 = calculateSMA(prices, 50);
  const cur = prices[prices.length - 1];
  if (sma20 !== null) score += cur > sma20 ? 8 : -8;
  if (sma50 !== null) score += cur > sma50 ? 7 : -7;

  return Math.max(-100, Math.min(100, score));
}

function getPortfolioValue(state: EnhancedPaperState, prices: Record<string, number>): number {
  let total = state.cash;
  for (const [sym, pos] of Object.entries(state.positions)) {
    const price = prices[sym] || pos.costBasis;
    total += pos.qty * price;
  }
  return total;
}

function updateMetrics(state: EnhancedPaperState, prices: Record<string, number>): void {
  const value = getPortfolioValue(state, prices);

  state.equityCurve.push({ timestamp: Date.now(), value });
  if (state.equityCurve.length > 2000) {
    const step = Math.ceil(state.equityCurve.length / 1500);
    state.equityCurve = state.equityCurve.filter(
      (_, i) => i === 0 || i === state.equityCurve.length - 1 || i % step === 0
    );
  }

  const sellTrades = state.trades.filter(t => t.action === 'SELL');
  const wins = sellTrades.filter(t => t.realizedPnl > 0);
  const losses = sellTrades.filter(t => t.realizedPnl <= 0);
  const winAmt = wins.reduce((s, t) => s + t.realizedPnl, 0);
  const lossAmt = Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0));

  // Peak and drawdown
  let peak = state.capital;
  let maxDD = 0;
  let maxDDPct = 0;
  for (const point of state.equityCurve) {
    if (point.value > peak) peak = point.value;
    const dd = peak - point.value;
    if (dd > maxDD) {
      maxDD = dd;
      maxDDPct = peak > 0 ? (dd / peak) * 100 : 0;
    }
  }

  state.metrics = {
    totalReturn: value - state.capital,
    totalReturnPct: state.capital > 0 ? ((value - state.capital) / state.capital) * 100 : 0,
    maxDrawdown: maxDD,
    maxDrawdownPct: maxDDPct,
    winRate: sellTrades.length > 0 ? wins.length / sellTrades.length : 0,
    totalTrades: state.trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    profitFactor: lossAmt > 0 ? winAmt / lossAmt : winAmt > 0 ? Infinity : 0,
    avgWin: wins.length > 0 ? winAmt / wins.length : 0,
    avgLoss: losses.length > 0 ? lossAmt / losses.length : 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    calmarRatio: 0,
    holdBaseline: 0,
    holdBaselinePct: 0,
    avgTradesPerMonth: 0,
  };
}

function makeTrade(
  timestamp: number,
  action: 'BUY' | 'SELL',
  symbol: string,
  amountUSD: number,
  price: number,
  reason: string,
  portfolioValueAfter: number,
  realizedPnl: number,
  confluenceScore: number
): ReplayTrade {
  return { timestamp, action, symbol, amountUSD, price, reason, portfolioValueAfter, realizedPnl, confluenceScore };
}

function emptyMetrics(capital: number): PerformanceMetrics {
  return {
    totalReturn: 0, totalReturnPct: 0, maxDrawdown: 0, maxDrawdownPct: 0,
    winRate: 0, totalTrades: 0, winningTrades: 0, losingTrades: 0,
    profitFactor: 0, avgWin: 0, avgLoss: 0, sharpeRatio: 0,
    sortinoRatio: 0, calmarRatio: 0, holdBaseline: capital, holdBaselinePct: 0,
    avgTradesPerMonth: 0,
  };
}
