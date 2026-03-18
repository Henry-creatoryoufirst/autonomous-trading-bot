/**
 * NVR-SPEC-001: Lightweight Backtesting & Simulation Engine
 *
 * Replays on-chain price history through strategy logic to produce performance
 * reports WITHOUT making any real trades. Zero new dependencies.
 */

import * as fs from "fs";

// ============================================================================
// TYPES
// ============================================================================

export interface SimConfig {
  startingCapital: number;
  profitTakePercent: number;   // e.g. 20 → sell when +20%
  stopLossPercent: number;     // e.g. 15 → sell when -15%
  kellyFraction: number;       // 0-1, fraction of Kelly bet
  maxPositionPercent: number;  // max % of portfolio in one token
  minPositionUSD: number;      // minimum trade size
  cashDeployThreshold: number; // % cash before deploying (0-100)
  sectorTargets?: Record<string, number>;
}

export interface SimTrade {
  timestamp: string;
  action: 'BUY' | 'SELL';
  token: string;
  amountUSD: number;
  price: number;
  reason: string;
  portfolioValueAfter: number;
  realizedPnl: number;
}

export interface SimResult {
  totalReturn: number;
  totalReturnPct: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  sharpeRatio: number;
  holdBaseline: number;
  trades: SimTrade[];
  equityCurve: number[];
}

interface PriceHistoryStore {
  version: number;
  lastSaved: string;
  tokens: Record<string, { timestamps: number[]; prices: number[]; volumes: number[] }>;
}

interface Position {
  qty: number;       // token quantity held
  costBasis: number; // average USD cost per token
}

// ============================================================================
// INDICATOR MATH (self-contained, no imports from agent)
// ============================================================================

function calcRSI(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null;
  const changes = [];
  for (let i = 1; i < prices.length; i++) changes.push(prices[i] - prices[i - 1]);
  const recent = changes.slice(-Math.min(changes.length, period * 3));
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period && i < recent.length; i++) {
    if (recent[i] > 0) avgGain += recent[i]; else avgLoss += Math.abs(recent[i]);
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period; i < recent.length; i++) {
    const c = recent[i];
    avgGain = (avgGain * (period - 1) + (c > 0 ? c : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (c < 0 ? Math.abs(c) : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  const mult = 2 / (period + 1);
  const ema: number[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += prices[i];
  ema.push(sum / period);
  for (let i = period; i < prices.length; i++)
    ema.push((prices[i] - ema[ema.length - 1]) * mult + ema[ema.length - 1]);
  return ema;
}

function calcMACD(prices: number[]): { histogram: number; signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' } | null {
  if (prices.length < 35) return null;
  const ema12 = calcEMA(prices, 12), ema26 = calcEMA(prices, 26);
  if (!ema12.length || !ema26.length) return null;
  const offset = 26 - 12;
  const macdVals: number[] = [];
  for (let i = 0; i < ema26.length; i++) macdVals.push(ema12[i + offset] - ema26[i]);
  if (macdVals.length < 9) return null;
  const sigLine = calcEMA(macdVals, 9);
  if (!sigLine.length) return null;
  const hist = macdVals[macdVals.length - 1] - sigLine[sigLine.length - 1];
  return { histogram: hist, signal: hist > 0 ? 'BULLISH' : hist < 0 ? 'BEARISH' : 'NEUTRAL' };
}

function calcBBSignal(prices: number[], period = 20): 'OVERSOLD' | 'OVERBOUGHT' | 'NORMAL' {
  if (prices.length < period) return 'NORMAL';
  const slice = prices.slice(-period);
  const sma = slice.reduce((s, p) => s + p, 0) / period;
  const variance = slice.reduce((s, p) => s + (p - sma) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = sma + 2 * stdDev, lower = sma - 2 * stdDev;
  const cur = prices[prices.length - 1];
  const pctB = upper !== lower ? (cur - lower) / (upper - lower) : 0.5;
  if (pctB > 1) return 'OVERBOUGHT';
  if (pctB < 0) return 'OVERSOLD';
  return 'NORMAL';
}

function calcSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((s, p) => s + p, 0) / period;
}

/** Simplified confluence score: -100 to +100 */
function simConfluence(prices: number[]): number {
  let score = 0;
  const rsi = calcRSI(prices);
  if (rsi !== null) {
    if (rsi < 30) score += 25; else if (rsi < 40) score += 12;
    else if (rsi > 70) score -= 25; else if (rsi > 60) score -= 12;
  }
  const macd = calcMACD(prices);
  if (macd) { score += macd.signal === 'BULLISH' ? 25 : macd.signal === 'BEARISH' ? -25 : 0; }
  const bb = calcBBSignal(prices);
  if (bb === 'OVERSOLD') score += 20; else if (bb === 'OVERBOUGHT') score -= 20;
  // Trend from SMAs
  const sma20 = calcSMA(prices, 20), sma50 = calcSMA(prices, 50);
  const cur = prices[prices.length - 1];
  if (sma20 && cur > sma20) score += 8; else if (sma20 && cur < sma20) score -= 8;
  if (sma50 && cur > sma50) score += 7; else if (sma50 && cur < sma50) score -= 7;
  return Math.max(-100, Math.min(100, score));
}

// ============================================================================
// CORE SIMULATION
// ============================================================================

export function runSimulation(
  config: SimConfig,
  priceHistory: Map<string, { timestamps: number[]; prices: number[] }>
): SimResult {
  // 1. Build a unified sorted timeline of all ticks
  const tickSet = new Set<number>();
  for (const [, data] of priceHistory) {
    for (const ts of data.timestamps) tickSet.add(ts);
  }
  const ticks = [...tickSet].sort((a, b) => a - b);
  if (ticks.length === 0) return emptyResult(config.startingCapital);

  // Build per-token price lookup (timestamp → price)
  const priceLookup = new Map<string, Map<number, number>>();
  for (const [symbol, data] of priceHistory) {
    const m = new Map<number, number>();
    for (let i = 0; i < data.timestamps.length; i++) m.set(data.timestamps[i], data.prices[i]);
    priceLookup.set(symbol, m);
  }

  let cash = config.startingCapital;
  const positions = new Map<string, Position>();
  const trades: SimTrade[] = [];
  const equityCurve: number[] = [];
  let totalRealizedPnl = 0;
  // Track per-token last-known prices for portfolio valuation
  const lastKnown = new Map<string, number>();
  // Hold baseline: record first-seen prices
  const firstPrices = new Map<string, number>();
  const tokens = [...priceHistory.keys()];

  for (const tick of ticks) {
    // Update last known prices
    for (const token of tokens) {
      const price = priceLookup.get(token)?.get(tick);
      if (price !== undefined) lastKnown.set(token, price);
      if (price !== undefined && !firstPrices.has(token)) firstPrices.set(token, price);
    }

    // Build price history up to this tick for indicator calculation
    // (Use a lighter approach: maintain running arrays)
    for (const token of tokens) {
      const price = lastKnown.get(token);
      if (price === undefined) continue;

      const data = priceHistory.get(token)!;
      // Find how many points exist up to this tick
      const idx = upperBound(data.timestamps, tick);
      if (idx < 20) continue; // need enough data for indicators
      const histSlice = data.prices.slice(0, idx);
      const confluence = simConfluence(histSlice);

      const pos = positions.get(token);
      const portfolioValue = calcPortfolioValue(cash, positions, lastKnown);
      const cashPct = (cash / portfolioValue) * 100;

      // === SELL LOGIC ===
      if (pos && pos.qty > 0) {
        const gainPct = ((price - pos.costBasis) / pos.costBasis) * 100;
        // Stop loss
        if (gainPct <= -config.stopLossPercent) {
          const sellUSD = pos.qty * price;
          const pnl = sellUSD - pos.qty * pos.costBasis;
          cash += sellUSD;
          totalRealizedPnl += pnl;
          trades.push({ timestamp: new Date(tick).toISOString(), action: 'SELL', token, amountUSD: sellUSD, price, reason: `STOP_LOSS (${gainPct.toFixed(1)}%)`, portfolioValueAfter: calcPortfolioValue(cash, positions, lastKnown), realizedPnl: pnl });
          positions.delete(token);
          continue;
        }
        // Profit take
        if (gainPct >= config.profitTakePercent) {
          const sellQty = pos.qty * 0.3; // sell 30%
          const sellUSD = sellQty * price;
          const pnl = sellQty * (price - pos.costBasis);
          cash += sellUSD;
          totalRealizedPnl += pnl;
          pos.qty -= sellQty;
          if (pos.qty < 0.0001) positions.delete(token);
          trades.push({ timestamp: new Date(tick).toISOString(), action: 'SELL', token, amountUSD: sellUSD, price, reason: `PROFIT_TAKE (${gainPct.toFixed(1)}%)`, portfolioValueAfter: calcPortfolioValue(cash, positions, lastKnown), realizedPnl: pnl });
          continue;
        }
        // Confluence sell signal
        if (confluence <= -30) {
          const sellQty = pos.qty * 0.5;
          const sellUSD = sellQty * price;
          const pnl = sellQty * (price - pos.costBasis);
          cash += sellUSD;
          totalRealizedPnl += pnl;
          pos.qty -= sellQty;
          if (pos.qty < 0.0001) positions.delete(token);
          trades.push({ timestamp: new Date(tick).toISOString(), action: 'SELL', token, amountUSD: sellUSD, price, reason: `SIGNAL_SELL (conf=${confluence})`, portfolioValueAfter: calcPortfolioValue(cash, positions, lastKnown), realizedPnl: pnl });
          continue;
        }
      }

      // === BUY LOGIC ===
      if (confluence >= 15 && cashPct >= config.cashDeployThreshold) {
        const currentPosValue = pos ? pos.qty * price : 0;
        const currentPosPct = (currentPosValue / portfolioValue) * 100;
        if (currentPosPct >= config.maxPositionPercent) continue; // already maxed out

        // Position size: simplified Kelly
        const winRate = 0.55; // assume slight edge
        const avgWinLoss = 1.5;
        const kellyPct = (winRate - (1 - winRate) / avgWinLoss) * config.kellyFraction * 100;
        const sizePct = Math.min(kellyPct, config.maxPositionPercent - currentPosPct);
        let sizeUSD = (sizePct / 100) * portfolioValue;
        sizeUSD = Math.min(sizeUSD, cash);
        if (sizeUSD < config.minPositionUSD) continue;

        const qty = sizeUSD / price;
        cash -= sizeUSD;
        if (pos) {
          const totalQty = pos.qty + qty;
          pos.costBasis = (pos.qty * pos.costBasis + sizeUSD) / totalQty;
          pos.qty = totalQty;
        } else {
          positions.set(token, { qty, costBasis: price });
        }
        trades.push({ timestamp: new Date(tick).toISOString(), action: 'BUY', token, amountUSD: sizeUSD, price, reason: `SIGNAL_BUY (conf=${confluence})`, portfolioValueAfter: calcPortfolioValue(cash, positions, lastKnown), realizedPnl: 0 });
      }
    }

    equityCurve.push(calcPortfolioValue(cash, positions, lastKnown));
  }

  // === COMPUTE METRICS ===
  const finalValue = calcPortfolioValue(cash, positions, lastKnown);
  const totalReturn = finalValue - config.startingCapital;
  const totalReturnPct = (totalReturn / config.startingCapital) * 100;

  // Max drawdown from equity curve
  let peak = equityCurve[0] || config.startingCapital;
  let maxDD = 0, maxDDPct = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxDD) { maxDD = dd; maxDDPct = peak > 0 ? (dd / peak) * 100 : 0; }
  }

  // Win/loss stats
  const sellTrades = trades.filter(t => t.action === 'SELL');
  const wins = sellTrades.filter(t => t.realizedPnl > 0);
  const losses = sellTrades.filter(t => t.realizedPnl <= 0);
  const totalWinAmt = wins.reduce((s, t) => s + t.realizedPnl, 0);
  const totalLossAmt = Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0));

  // Hold baseline: equal-weight basket
  let holdValue = 0;
  const tokenCount = tokens.filter(t => firstPrices.has(t) && lastKnown.has(t)).length;
  if (tokenCount > 0) {
    const perToken = config.startingCapital / tokenCount;
    for (const token of tokens) {
      const fp = firstPrices.get(token), lp = lastKnown.get(token);
      if (fp && lp) holdValue += perToken * (lp / fp);
    }
  }

  // Sharpe ratio (annualized, from hourly returns)
  let sharpe = 0;
  if (equityCurve.length > 2) {
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      returns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
    }
    const avgRet = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) sharpe = (avgRet / stdDev) * Math.sqrt(8760); // annualize from hourly
  }

  return {
    totalReturn,
    totalReturnPct,
    maxDrawdown: maxDD,
    maxDrawdownPct: maxDDPct,
    winRate: sellTrades.length > 0 ? wins.length / sellTrades.length : 0,
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    profitFactor: totalLossAmt > 0 ? totalWinAmt / totalLossAmt : totalWinAmt > 0 ? Infinity : 0,
    avgWin: wins.length > 0 ? totalWinAmt / wins.length : 0,
    avgLoss: losses.length > 0 ? totalLossAmt / losses.length : 0,
    sharpeRatio: sharpe,
    holdBaseline: holdValue,
    trades,
    equityCurve,
  };
}

// ============================================================================
// A/B COMPARISON
// ============================================================================

export function compareStrategies(
  configA: SimConfig,
  configB: SimConfig,
  priceHistory: Map<string, { timestamps: number[]; prices: number[] }>
): { a: SimResult; b: SimResult; delta: Record<string, number> } {
  const a = runSimulation(configA, priceHistory);
  const b = runSimulation(configB, priceHistory);
  return {
    a, b,
    delta: {
      totalReturnPct: b.totalReturnPct - a.totalReturnPct,
      maxDrawdownPct: b.maxDrawdownPct - a.maxDrawdownPct,
      winRate: b.winRate - a.winRate,
      sharpeRatio: b.sharpeRatio - a.sharpeRatio,
      profitFactor: b.profitFactor - a.profitFactor,
      totalTrades: b.totalTrades - a.totalTrades,
    },
  };
}

// ============================================================================
// PRICE HISTORY LOADER
// ============================================================================

export function loadPriceHistory(persistDir?: string): Map<string, { timestamps: number[]; prices: number[] }> {
  const filePath = persistDir
    ? `${persistDir}/price-history.json`
    : (process.env.PERSIST_DIR ? `${process.env.PERSIST_DIR}/price-history.json` : './logs/price-history.json');

  if (!fs.existsSync(filePath)) throw new Error(`Price history not found at ${filePath}`);
  const raw: PriceHistoryStore = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (raw.version !== 1 || !raw.tokens) throw new Error('Invalid price history format');

  const result = new Map<string, { timestamps: number[]; prices: number[] }>();
  for (const [symbol, entry] of Object.entries(raw.tokens)) {
    if (entry.prices.length >= 20) { // need minimum data for indicators
      result.set(symbol, { timestamps: entry.timestamps, prices: entry.prices });
    }
  }
  return result;
}

// ============================================================================
// DEFAULT CONFIG (mirrors live bot parameters)
// ============================================================================

export const DEFAULT_SIM_CONFIG: SimConfig = {
  startingCapital: 500,
  profitTakePercent: 20,
  stopLossPercent: 15,
  kellyFraction: 0.5,
  maxPositionPercent: 18,
  minPositionUSD: 5,
  cashDeployThreshold: 40,
};

// ============================================================================
// HELPERS
// ============================================================================

function calcPortfolioValue(cash: number, positions: Map<string, Position>, prices: Map<string, number>): number {
  let total = cash;
  for (const [token, pos] of positions) {
    const price = prices.get(token) || pos.costBasis;
    total += pos.qty * price;
  }
  return total;
}

function upperBound(arr: number[], target: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function emptyResult(capital: number): SimResult {
  return {
    totalReturn: 0, totalReturnPct: 0, maxDrawdown: 0, maxDrawdownPct: 0,
    winRate: 0, totalTrades: 0, winningTrades: 0, losingTrades: 0,
    profitFactor: 0, avgWin: 0, avgLoss: 0, sharpeRatio: 0,
    holdBaseline: capital, trades: [], equityCurve: [capital],
  };
}
