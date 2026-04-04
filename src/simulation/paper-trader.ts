/**
 * Paper Trading Engine
 *
 * Runs virtual portfolios alongside the live bot using the same market data.
 * No additional API calls — receives data already fetched by the live bot.
 * Persists state to disk so paper portfolios survive restarts.
 */

import * as fs from "fs";
import type { StrategyVersionConfig } from "./strategy-versions.js";

// ============================================================================
// TYPES
// ============================================================================

export interface PaperTrade {
  timestamp: string;
  action: "BUY" | "SELL";
  token: string;
  amountUSD: number;
  price: number;
  reason: string;
  portfolioValueAfter: number;
  realizedPnl: number;
}

export interface PaperPortfolio {
  id: string;
  strategyVersion: string;
  startTime: string;
  startingCapital: number;
  cash: number;
  positions: Record<string, { tokens: number; costBasis: number; avgPrice: number }>;
  trades: PaperTrade[];
  equityCurve: { timestamp: string; value: number }[];
  metrics: {
    totalValue: number;
    totalReturn: number;
    totalReturnPct: number;
    maxDrawdown: number;
    peakValue: number;
    winRate: number;
    totalTrades: number;
    wins: number;
    losses: number;
    profitFactor: number;
  };
}

export interface TokenSignal {
  symbol: string;
  price: number;
  rsi: number;
  macd: string;
  confluence: number;
  buyRatio: number;
}

// ============================================================================
// PERSISTENCE
// ============================================================================

const PERSIST_FILE = process.env.PERSIST_DIR
  ? `${process.env.PERSIST_DIR}/paper-portfolios.json`
  : "./data/paper-portfolios.json";

let activePortfolios: Map<string, PaperPortfolio> = new Map();

export function savePaperPortfolios(): void {
  try {
    const dir = PERSIST_FILE.substring(0, PERSIST_FILE.lastIndexOf("/"));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = Object.fromEntries(activePortfolios);
    const tmp = PERSIST_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, PERSIST_FILE);
  } catch (err: any) {
    console.error(`[PaperTrader] Save error: ${err.message?.substring(0, 200)}`);
  }
}

export function loadPaperPortfolios(): void {
  try {
    if (fs.existsSync(PERSIST_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PERSIST_FILE, "utf-8"));
      activePortfolios = new Map(Object.entries(raw));
      console.log(`  [PaperTrader] Loaded ${activePortfolios.size} paper portfolio(s)`);
    }
  } catch (err: any) {
    console.error(`[PaperTrader] Load error: ${err.message?.substring(0, 200)}`);
  }
}

// ============================================================================
// PORTFOLIO MANAGEMENT
// ============================================================================

export function createPaperPortfolio(id: string, version: string, capital: number): PaperPortfolio {
  const portfolio: PaperPortfolio = {
    id,
    strategyVersion: version,
    startTime: new Date().toISOString(),
    startingCapital: capital,
    cash: capital,
    positions: {},
    trades: [],
    equityCurve: [{ timestamp: new Date().toISOString(), value: capital }],
    metrics: {
      totalValue: capital,
      totalReturn: 0,
      totalReturnPct: 0,
      maxDrawdown: 0,
      peakValue: capital,
      winRate: 0,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      profitFactor: 0,
    },
  };
  activePortfolios.set(id, portfolio);
  return portfolio;
}

export function getPaperPortfolio(id: string): PaperPortfolio | undefined {
  return activePortfolios.get(id);
}

export function getAllPaperPortfolios(): PaperPortfolio[] {
  return [...activePortfolios.values()];
}

// ============================================================================
// TRADE EVALUATION — mirrors live bot logic using strategy config
// ============================================================================

export function evaluatePaperTrade(
  portfolio: PaperPortfolio,
  config: StrategyVersionConfig,
  tokenData: TokenSignal
): PaperTrade | null {
  const { symbol, price, confluence } = tokenData;
  if (price <= 0) return null;

  const totalValue = calcPortfolioValue(portfolio, { [symbol]: price });
  const pos = portfolio.positions[symbol];

  // === SELL LOGIC ===
  if (pos && pos.tokens > 0) {
    const gainPct = ((price - pos.avgPrice) / pos.avgPrice) * 100;

    // Stop loss
    if (gainPct <= -config.stopLossPercent) {
      const sellUSD = pos.tokens * price;
      const pnl = sellUSD - pos.tokens * pos.avgPrice;
      portfolio.cash += sellUSD;
      delete portfolio.positions[symbol];
      const afterValue = calcPortfolioValue(portfolio, { [symbol]: price });
      return makeTrade("SELL", symbol, sellUSD, price, `STOP_LOSS (${gainPct.toFixed(1)}%)`, afterValue, pnl, portfolio);
    }

    // Profit take
    if (gainPct >= config.profitTakePercent) {
      const sellQty = pos.tokens * 0.3;
      const sellUSD = sellQty * price;
      const pnl = sellQty * (price - pos.avgPrice);
      portfolio.cash += sellUSD;
      pos.tokens -= sellQty;
      if (pos.tokens < 0.0001) delete portfolio.positions[symbol];
      const afterValue = calcPortfolioValue(portfolio, { [symbol]: price });
      return makeTrade("SELL", symbol, sellUSD, price, `PROFIT_TAKE (${gainPct.toFixed(1)}%)`, afterValue, pnl, portfolio);
    }

    // Confluence sell
    if (confluence <= config.confluenceSellThreshold) {
      const sellQty = pos.tokens * 0.5;
      const sellUSD = sellQty * price;
      const pnl = sellQty * (price - pos.avgPrice);
      portfolio.cash += sellUSD;
      pos.tokens -= sellQty;
      if (pos.tokens < 0.0001) delete portfolio.positions[symbol];
      const afterValue = calcPortfolioValue(portfolio, { [symbol]: price });
      return makeTrade("SELL", symbol, sellUSD, price, `SIGNAL_SELL (conf=${confluence})`, afterValue, pnl, portfolio);
    }
  }

  // === BUY LOGIC ===
  const cashPct = totalValue > 0 ? (portfolio.cash / totalValue) * 100 : 100;
  if (confluence >= config.confluenceBuyThreshold && cashPct >= config.cashDeployThreshold) {
    const currentPosValue = pos ? pos.tokens * price : 0;
    const currentPosPct = totalValue > 0 ? (currentPosValue / totalValue) * 100 : 0;
    if (currentPosPct >= config.maxPositionPercent) return null;

    // Position sizing: simplified Kelly
    const winRate = 0.55;
    const avgWinLoss = 1.5;
    const kellyPct = (winRate - (1 - winRate) / avgWinLoss) * config.kellyFraction * 100;
    const sizePct = Math.min(kellyPct, config.maxPositionPercent - currentPosPct);
    let sizeUSD = (sizePct / 100) * totalValue;
    sizeUSD = Math.min(sizeUSD, portfolio.cash);
    if (sizeUSD < config.minPositionUSD) return null;

    const qty = sizeUSD / price;
    portfolio.cash -= sizeUSD;

    if (pos) {
      const totalQty = pos.tokens + qty;
      pos.avgPrice = (pos.tokens * pos.avgPrice + sizeUSD) / totalQty;
      pos.costBasis = pos.avgPrice;
      pos.tokens = totalQty;
    } else {
      portfolio.positions[symbol] = { tokens: qty, costBasis: price, avgPrice: price };
    }

    const afterValue = calcPortfolioValue(portfolio, { [symbol]: price });
    return makeTrade("BUY", symbol, sizeUSD, price, `SIGNAL_BUY (conf=${confluence})`, afterValue, 0, portfolio);
  }

  return null;
}

// ============================================================================
// PORTFOLIO UPDATE — call each cycle with current prices
// ============================================================================

export function updatePaperPortfolio(portfolio: PaperPortfolio, currentPrices: Record<string, number>): void {
  const totalValue = calcPortfolioValue(portfolio, currentPrices);
  portfolio.metrics.totalValue = totalValue;
  portfolio.metrics.totalReturn = totalValue - portfolio.startingCapital;
  portfolio.metrics.totalReturnPct = portfolio.startingCapital > 0
    ? ((totalValue - portfolio.startingCapital) / portfolio.startingCapital) * 100
    : 0;

  if (totalValue > portfolio.metrics.peakValue) {
    portfolio.metrics.peakValue = totalValue;
  }
  const drawdown = portfolio.metrics.peakValue > 0
    ? ((portfolio.metrics.peakValue - totalValue) / portfolio.metrics.peakValue) * 100
    : 0;
  if (drawdown > portfolio.metrics.maxDrawdown) {
    portfolio.metrics.maxDrawdown = drawdown;
  }

  // Win/loss stats
  const sells = portfolio.trades.filter((t) => t.action === "SELL");
  const wins = sells.filter((t) => t.realizedPnl > 0);
  const losses = sells.filter((t) => t.realizedPnl <= 0);
  const totalWin = wins.reduce((s, t) => s + t.realizedPnl, 0);
  const totalLoss = Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0));

  portfolio.metrics.totalTrades = portfolio.trades.length;
  portfolio.metrics.wins = wins.length;
  portfolio.metrics.losses = losses.length;
  portfolio.metrics.winRate = sells.length > 0 ? (wins.length / sells.length) * 100 : 0;
  portfolio.metrics.profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0;

  // Equity curve — cap at 2000 points
  portfolio.equityCurve.push({ timestamp: new Date().toISOString(), value: totalValue });
  if (portfolio.equityCurve.length > 2000) {
    // Downsample: keep first, last, and every Nth point
    const target = 1500;
    const step = Math.ceil(portfolio.equityCurve.length / target);
    const downsampled = portfolio.equityCurve.filter((_, i) => i === 0 || i === portfolio.equityCurve.length - 1 || i % step === 0);
    portfolio.equityCurve = downsampled;
  }
}

// ============================================================================
// SUMMARY — clean output for API / dashboard
// ============================================================================

export function getPaperPortfolioSummary(portfolio: PaperPortfolio) {
  const positionSummary: Record<string, { tokens: number; avgPrice: number }> = {};
  for (const [sym, pos] of Object.entries(portfolio.positions)) {
    positionSummary[sym] = { tokens: pos.tokens, avgPrice: pos.avgPrice };
  }
  return {
    id: portfolio.id,
    strategyVersion: portfolio.strategyVersion,
    startTime: portfolio.startTime,
    startingCapital: portfolio.startingCapital,
    cash: portfolio.cash,
    positions: positionSummary,
    positionCount: Object.keys(portfolio.positions).length,
    tradeCount: portfolio.trades.length,
    metrics: portfolio.metrics,
    lastTrade: portfolio.trades.length > 0 ? portfolio.trades[portfolio.trades.length - 1] : null,
    equityCurveLength: portfolio.equityCurve.length,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function calcPortfolioValue(portfolio: PaperPortfolio, prices: Record<string, number>): number {
  let total = portfolio.cash;
  for (const [sym, pos] of Object.entries(portfolio.positions)) {
    const price = prices[sym] || pos.avgPrice;
    total += pos.tokens * price;
  }
  return total;
}

function makeTrade(
  action: "BUY" | "SELL",
  token: string,
  amountUSD: number,
  price: number,
  reason: string,
  portfolioValueAfter: number,
  realizedPnl: number,
  portfolio: PaperPortfolio
): PaperTrade {
  const trade: PaperTrade = {
    timestamp: new Date().toISOString(),
    action,
    token,
    amountUSD,
    price,
    reason,
    portfolioValueAfter,
    realizedPnl,
  };
  portfolio.trades.push(trade);
  // Cap trade history at 500 trades per portfolio
  if (portfolio.trades.length > 500) {
    portfolio.trades = portfolio.trades.slice(-500);
  }
  return trade;
}
