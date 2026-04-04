/**
 * NVR Capital — Rapid Historical Replay Engine
 *
 * Feeds historical candle data through the same indicator + confluence pipeline
 * used by the live bot. Compresses months of market data into seconds.
 *
 * Key design decisions:
 * - Reuses calculateRSI, calculateMACD, calculateBollingerBands, calculateSMA
 *   from src/algorithm/indicators.ts
 * - Does NOT call Claude API — uses confluence scoring as the decision model
 * - Pure functions, fully testable, no side effects
 */

import { calculateRSI, calculateMACD, calculateBollingerBands, calculateSMA } from '../../algorithm/indicators.js';
import type {
  HistoricalDataset,
  ReplayConfig,
  ReplayResult,
  ReplayTrade,
  PerformanceMetrics,
  ConditionBreakdown,
  MarketCondition,
} from '../types.js';
import { classifyWindow } from '../data/market-conditions.js';

// ============================================================================
// INTERNAL STATE
// ============================================================================

interface Position {
  qty: number;
  costBasis: number;
  entryTime: number;
}

// ============================================================================
// CONFLUENCE SCORING (simplified, mirrors live bot logic)
// ============================================================================

/**
 * Calculate a simplified confluence score from indicators.
 * Score range: -100 to +100
 * This matches the logic in services/simulator.ts but uses the real
 * indicator functions from src/algorithm/indicators.ts
 */
function calculateSimConfluence(prices: number[]): number {
  let score = 0;

  // RSI (weight: 25)
  const rsi = calculateRSI(prices);
  if (rsi !== null) {
    if (rsi < 30) score += 25;
    else if (rsi < 40) score += 12;
    else if (rsi > 70) score -= 25;
    else if (rsi > 60) score -= 12;
  }

  // MACD (weight: 25)
  const macd = calculateMACD(prices);
  if (macd) {
    if (macd.signal === 'BULLISH') score += 25;
    else if (macd.signal === 'BEARISH') score -= 25;
  }

  // Bollinger Bands (weight: 20)
  const bb = calculateBollingerBands(prices);
  if (bb) {
    if (bb.signal === 'OVERSOLD') score += 20;
    else if (bb.signal === 'OVERBOUGHT') score -= 20;
  }

  // SMA trend (weight: 15)
  const sma20 = calculateSMA(prices, 20);
  const sma50 = calculateSMA(prices, 50);
  const currentPrice = prices[prices.length - 1];
  if (sma20 !== null) {
    if (currentPrice > sma20) score += 8;
    else score -= 8;
  }
  if (sma50 !== null) {
    if (currentPrice > sma50) score += 7;
    else score -= 7;
  }

  return Math.max(-100, Math.min(100, score));
}

// ============================================================================
// CORE REPLAY
// ============================================================================

/**
 * Run a historical replay through the trading decision pipeline.
 *
 * @param datasets - One or more historical datasets (multi-token support)
 * @param config - Replay configuration
 * @returns Comprehensive replay results
 */
export function runReplay(
  datasets: HistoricalDataset[],
  config: ReplayConfig
): ReplayResult {
  const startMs = Date.now();

  const { strategy } = config;
  const warmup = config.warmupCandles ?? 50;
  const stepSize = config.stepSize ?? 1;

  // Build unified timeline from all datasets
  const { timeline, priceBySymbol, closePricesBySymbol } = buildTimeline(datasets, config);

  if (timeline.length === 0) {
    return emptyResult(strategy.startingCapital, startMs);
  }

  // State
  let cash = strategy.startingCapital;
  const positions = new Map<string, Position>();
  const trades: ReplayTrade[] = [];
  const equityCurve: number[] = [];
  const equityTimestamps: number[] = [];
  const lastKnown = new Map<string, number>();
  const firstPrices = new Map<string, number>();
  const symbols = datasets.map(d => d.symbol);

  // Track candle indices per symbol for price history slicing
  const candleIndexBySymbol = new Map<string, number>();
  for (const sym of symbols) candleIndexBySymbol.set(sym, 0);

  let candlesProcessed = 0;

  for (let ti = 0; ti < timeline.length; ti += stepSize) {
    const tick = timeline[ti];
    candlesProcessed++;

    // Update last known prices
    for (const sym of symbols) {
      const symPrices = priceBySymbol.get(sym);
      if (!symPrices) continue;
      const price = symPrices.get(tick);
      if (price !== undefined) {
        lastKnown.set(sym, price);
        if (!firstPrices.has(sym)) firstPrices.set(sym, price);
      }
    }

    // For each symbol, run the decision pipeline
    for (const sym of symbols) {
      const price = lastKnown.get(sym);
      if (price === undefined) continue;

      // Get price history up to this tick
      const closePrices = closePricesBySymbol.get(sym);
      if (!closePrices) continue;

      // Find how many prices are up to this tick
      const allTimestamps = datasets.find(d => d.symbol === sym)!.candles;
      let idx = 0;
      for (let j = 0; j < allTimestamps.length; j++) {
        if (allTimestamps[j].timestamp <= tick) idx = j + 1;
        else break;
      }

      if (idx < warmup) continue;

      const histSlice = closePrices.slice(0, idx);
      const confluence = calculateSimConfluence(histSlice);

      const pos = positions.get(sym);
      const portfolioValue = calcPortfolioValue(cash, positions, lastKnown);
      const cashPct = portfolioValue > 0 ? (cash / portfolioValue) * 100 : 100;

      // === SELL LOGIC ===
      if (pos && pos.qty > 0) {
        const gainPct = ((price - pos.costBasis) / pos.costBasis) * 100;

        // Stop loss
        if (gainPct <= -strategy.stopLossPercent) {
          const sellUSD = pos.qty * price;
          const pnl = sellUSD - pos.qty * pos.costBasis;
          cash += sellUSD;
          positions.delete(sym);
          trades.push(makeTrade(tick, 'SELL', sym, sellUSD, price,
            `STOP_LOSS (${gainPct.toFixed(1)}%)`, calcPortfolioValue(cash, positions, lastKnown), pnl, confluence));
          continue;
        }

        // Profit take
        if (gainPct >= strategy.profitTakePercent) {
          const sellQty = pos.qty * 0.3;
          const sellUSD = sellQty * price;
          const pnl = sellQty * (price - pos.costBasis);
          cash += sellUSD;
          pos.qty -= sellQty;
          if (pos.qty < 0.0001) positions.delete(sym);
          trades.push(makeTrade(tick, 'SELL', sym, sellUSD, price,
            `PROFIT_TAKE (${gainPct.toFixed(1)}%)`, calcPortfolioValue(cash, positions, lastKnown), pnl, confluence));
          continue;
        }

        // Confluence sell signal
        if (confluence <= strategy.confluenceSellThreshold) {
          const sellQty = pos.qty * 0.5;
          const sellUSD = sellQty * price;
          const pnl = sellQty * (price - pos.costBasis);
          cash += sellUSD;
          pos.qty -= sellQty;
          if (pos.qty < 0.0001) positions.delete(sym);
          trades.push(makeTrade(tick, 'SELL', sym, sellUSD, price,
            `SIGNAL_SELL (conf=${confluence})`, calcPortfolioValue(cash, positions, lastKnown), pnl, confluence));
          continue;
        }
      }

      // === BUY LOGIC ===
      if (confluence >= strategy.confluenceBuyThreshold && cashPct >= strategy.cashDeployThreshold) {
        const currentPosValue = pos ? pos.qty * price : 0;
        const currentPosPct = portfolioValue > 0 ? (currentPosValue / portfolioValue) * 100 : 0;
        if (currentPosPct >= strategy.maxPositionPercent) continue;

        // Position sizing: simplified Kelly
        const winRate = 0.55;
        const avgWinLoss = 1.5;
        const kellyPct = (winRate - (1 - winRate) / avgWinLoss) * strategy.kellyFraction * 100;
        const sizePct = Math.min(kellyPct, strategy.maxPositionPercent - currentPosPct);
        let sizeUSD = (sizePct / 100) * portfolioValue;
        sizeUSD = Math.min(sizeUSD, cash);
        if (sizeUSD < strategy.minPositionUSD) continue;

        const qty = sizeUSD / price;
        cash -= sizeUSD;

        if (pos) {
          const totalQty = pos.qty + qty;
          pos.costBasis = (pos.qty * pos.costBasis + sizeUSD) / totalQty;
          pos.qty = totalQty;
        } else {
          positions.set(sym, { qty, costBasis: price, entryTime: tick });
        }

        trades.push(makeTrade(tick, 'BUY', sym, sizeUSD, price,
          `SIGNAL_BUY (conf=${confluence})`, calcPortfolioValue(cash, positions, lastKnown), 0, confluence));
      }
    }

    equityCurve.push(calcPortfolioValue(cash, positions, lastKnown));
    equityTimestamps.push(tick);
  }

  // Compute metrics
  const metrics = computeMetrics(
    strategy.startingCapital,
    cash,
    positions,
    lastKnown,
    firstPrices,
    trades,
    equityCurve,
    symbols,
    timeline
  );

  // Compute condition breakdown
  const conditionBreakdown = computeConditionBreakdown(
    datasets, config, trades, equityCurve, equityTimestamps
  );

  return {
    metrics,
    trades,
    equityCurve,
    equityTimestamps,
    conditionBreakdown,
    replayDurationMs: Date.now() - startMs,
    candlesProcessed,
  };
}

// ============================================================================
// TIMELINE BUILDER
// ============================================================================

function buildTimeline(
  datasets: HistoricalDataset[],
  config: ReplayConfig
): {
  timeline: number[];
  priceBySymbol: Map<string, Map<number, number>>;
  closePricesBySymbol: Map<string, number[]>;
} {
  const tickSet = new Set<number>();
  const priceBySymbol = new Map<string, Map<number, number>>();
  const closePricesBySymbol = new Map<string, number[]>();

  for (const ds of datasets) {
    const priceMap = new Map<number, number>();
    const closePrices: number[] = [];

    for (const candle of ds.candles) {
      if (config.startTime && candle.timestamp < config.startTime) continue;
      if (config.endTime && candle.timestamp > config.endTime) continue;
      tickSet.add(candle.timestamp);
      priceMap.set(candle.timestamp, candle.close);
      closePrices.push(candle.close);
    }

    priceBySymbol.set(ds.symbol, priceMap);
    closePricesBySymbol.set(ds.symbol, closePrices);
  }

  const timeline = [...tickSet].sort((a, b) => a - b);
  return { timeline, priceBySymbol, closePricesBySymbol };
}

// ============================================================================
// METRICS COMPUTATION
// ============================================================================

export function computeMetrics(
  startingCapital: number,
  cash: number,
  positions: Map<string, Position>,
  lastKnown: Map<string, number>,
  firstPrices: Map<string, number>,
  trades: ReplayTrade[],
  equityCurve: number[],
  symbols: string[],
  timeline: number[]
): PerformanceMetrics {
  const finalValue = calcPortfolioValue(cash, positions, lastKnown);
  const totalReturn = finalValue - startingCapital;
  const totalReturnPct = startingCapital > 0 ? (totalReturn / startingCapital) * 100 : 0;

  // Max drawdown
  let peak = equityCurve[0] || startingCapital;
  let maxDD = 0;
  let maxDDPct = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxDD) {
      maxDD = dd;
      maxDDPct = peak > 0 ? (dd / peak) * 100 : 0;
    }
  }

  // Win/loss stats
  const sellTrades = trades.filter(t => t.action === 'SELL');
  const wins = sellTrades.filter(t => t.realizedPnl > 0);
  const losses = sellTrades.filter(t => t.realizedPnl <= 0);
  const totalWinAmt = wins.reduce((s, t) => s + t.realizedPnl, 0);
  const totalLossAmt = Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0));

  // Hold baseline: equal-weight basket
  let holdValue = 0;
  const tokenCount = symbols.filter(t => firstPrices.has(t) && lastKnown.has(t)).length;
  if (tokenCount > 0) {
    const perToken = startingCapital / tokenCount;
    for (const token of symbols) {
      const fp = firstPrices.get(token);
      const lp = lastKnown.get(token);
      if (fp && lp) holdValue += perToken * (lp / fp);
    }
  }
  const holdBaselinePct = startingCapital > 0 ? ((holdValue - startingCapital) / startingCapital) * 100 : 0;

  // Sharpe ratio (annualized)
  let sharpe = 0;
  let sortino = 0;
  if (equityCurve.length > 2) {
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      if (equityCurve[i - 1] > 0) {
        returns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
      }
    }
    const avgRet = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
    const variance = returns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / (returns.length || 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) {
      sharpe = (avgRet / stdDev) * Math.sqrt(8760); // annualize from hourly
    }

    // Sortino: only downside deviation
    const negReturns = returns.filter(r => r < 0);
    const downsideVariance = negReturns.length > 0
      ? negReturns.reduce((s, r) => s + r ** 2, 0) / negReturns.length
      : 0;
    const downsideStdDev = Math.sqrt(downsideVariance);
    if (downsideStdDev > 0) {
      sortino = (avgRet / downsideStdDev) * Math.sqrt(8760);
    }
  }

  // Calmar ratio: annualized return / max drawdown
  const durationMs = timeline.length > 1 ? timeline[timeline.length - 1] - timeline[0] : 1;
  const years = durationMs / (365.25 * 24 * 3600 * 1000);
  const annualizedReturn = years > 0 ? totalReturnPct / years : totalReturnPct;
  const calmar = maxDDPct > 0 ? annualizedReturn / maxDDPct : 0;

  // Trades per month
  const months = durationMs / (30.44 * 24 * 3600 * 1000);
  const avgTradesPerMonth = months > 0 ? trades.length / months : trades.length;

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
    sortinoRatio: sortino,
    calmarRatio: calmar,
    holdBaseline: holdValue,
    holdBaselinePct,
    avgTradesPerMonth,
  };
}

// ============================================================================
// CONDITION BREAKDOWN
// ============================================================================

function computeConditionBreakdown(
  datasets: HistoricalDataset[],
  config: ReplayConfig,
  trades: ReplayTrade[],
  equityCurve: number[],
  equityTimestamps: number[]
): ConditionBreakdown[] {
  if (datasets.length === 0 || datasets[0].candles.length < 20) return [];

  // Classify using the first dataset's candles
  const candles = datasets[0].candles.filter(c => {
    if (config.startTime && c.timestamp < config.startTime) return false;
    if (config.endTime && c.timestamp > config.endTime) return false;
    return true;
  });

  // Classify in windows of 168 candles (~1 week)
  const windowSize = 168;
  const conditionRanges: Array<{ condition: MarketCondition; startTime: number; endTime: number }> = [];

  for (let i = 0; i + windowSize <= candles.length; i += windowSize) {
    const window = candles.slice(i, i + windowSize);
    const condition = classifyWindow(window);
    conditionRanges.push({
      condition,
      startTime: window[0].timestamp,
      endTime: window[window.length - 1].timestamp,
    });
  }

  // Group trades and equity by condition
  const conditionMap = new Map<MarketCondition, {
    trades: ReplayTrade[];
    equityCurve: number[];
    totalCandles: number;
    periodCount: number;
  }>();

  for (const cond of ['BULL', 'BEAR', 'RANGING', 'VOLATILE'] as MarketCondition[]) {
    conditionMap.set(cond, { trades: [], equityCurve: [], totalCandles: 0, periodCount: 0 });
  }

  for (const range of conditionRanges) {
    const entry = conditionMap.get(range.condition)!;
    entry.periodCount++;
    entry.totalCandles += windowSize;

    // Assign trades in this time range
    for (const trade of trades) {
      if (trade.timestamp >= range.startTime && trade.timestamp <= range.endTime) {
        entry.trades.push(trade);
      }
    }

    // Assign equity curve points in this time range
    for (let i = 0; i < equityTimestamps.length; i++) {
      if (equityTimestamps[i] >= range.startTime && equityTimestamps[i] <= range.endTime) {
        entry.equityCurve.push(equityCurve[i]);
      }
    }
  }

  const breakdowns: ConditionBreakdown[] = [];
  for (const [condition, data] of conditionMap) {
    if (data.equityCurve.length < 2) {
      // Not enough data for this condition
      breakdowns.push({
        condition,
        metrics: emptyMetrics(),
        periodCount: data.periodCount,
        totalCandles: data.totalCandles,
      });
      continue;
    }

    // Compute metrics for this condition's equity curve
    const startVal = data.equityCurve[0];
    const endVal = data.equityCurve[data.equityCurve.length - 1];
    const condReturn = endVal - startVal;
    const condReturnPct = startVal > 0 ? (condReturn / startVal) * 100 : 0;

    // Drawdown
    let peak = data.equityCurve[0];
    let maxDD = 0;
    let maxDDPct = 0;
    for (const v of data.equityCurve) {
      if (v > peak) peak = v;
      const dd = peak - v;
      if (dd > maxDD) {
        maxDD = dd;
        maxDDPct = peak > 0 ? (dd / peak) * 100 : 0;
      }
    }

    const sellTrades = data.trades.filter(t => t.action === 'SELL');
    const wins = sellTrades.filter(t => t.realizedPnl > 0);
    const losses = sellTrades.filter(t => t.realizedPnl <= 0);
    const winAmt = wins.reduce((s, t) => s + t.realizedPnl, 0);
    const lossAmt = Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0));

    breakdowns.push({
      condition,
      metrics: {
        totalReturn: condReturn,
        totalReturnPct: condReturnPct,
        maxDrawdown: maxDD,
        maxDrawdownPct: maxDDPct,
        winRate: sellTrades.length > 0 ? wins.length / sellTrades.length : 0,
        totalTrades: data.trades.length,
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
      },
      periodCount: data.periodCount,
      totalCandles: data.totalCandles,
    });
  }

  return breakdowns;
}

// ============================================================================
// HELPERS
// ============================================================================

function calcPortfolioValue(
  cash: number,
  positions: Map<string, Position>,
  prices: Map<string, number>
): number {
  let total = cash;
  for (const [token, pos] of positions) {
    const price = prices.get(token) || pos.costBasis;
    total += pos.qty * price;
  }
  return total;
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

function emptyMetrics(): PerformanceMetrics {
  return {
    totalReturn: 0, totalReturnPct: 0, maxDrawdown: 0, maxDrawdownPct: 0,
    winRate: 0, totalTrades: 0, winningTrades: 0, losingTrades: 0,
    profitFactor: 0, avgWin: 0, avgLoss: 0, sharpeRatio: 0,
    sortinoRatio: 0, calmarRatio: 0, holdBaseline: 0, holdBaselinePct: 0,
    avgTradesPerMonth: 0,
  };
}

function emptyResult(capital: number, startMs: number): ReplayResult {
  return {
    metrics: {
      ...emptyMetrics(),
      holdBaseline: capital,
    },
    trades: [],
    equityCurve: [capital],
    equityTimestamps: [Date.now()],
    conditionBreakdown: [],
    replayDurationMs: Date.now() - startMs,
    candlesProcessed: 0,
  };
}
