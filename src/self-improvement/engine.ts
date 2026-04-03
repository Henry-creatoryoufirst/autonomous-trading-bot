/**
 * Never Rest Capital — Self-Improvement Engine
 * Extracted from agent-v3.2.ts (Phase 5 refactor)
 *
 * Pattern analysis, performance reviews, threshold adaptation,
 * and self-learning functions.
 *
 * Functions that mutate state accept state slices as parameters.
 */

import type { TradeRecord, TradePerformanceStats, StrategyPattern, AdaptiveThresholds, PerformanceReview, ExplorationState, ShadowProposal, MarketRegime } from '../types/index.js';
import type { RoundTripTrade, WinRateTruthData, AgentState, UserDirective } from '../types/state.js';
import type { TechnicalIndicators } from '../algorithm/indicators.js';
import {
  ATR_STOP_LOSS_MULTIPLIER, ATR_TRAILING_STOP_MULTIPLIER,
} from '../../config/constants.js';

// Exploration constants (defined inline — not yet in constants.ts)
const EXPLORATION_MIN_CONFLUENCE = 0;
const EXPLORATION_MIN_BUY_RATIO = 45;
const EXPLORATION_RANGING_SIZE_MULTIPLIER = 0.5;

// Re-exported types used by callers
export type { RoundTripTrade, WinRateTruthData };

// ============================================================================
// Module-level state reference — set by initSelfImprovement() from monolith
// ============================================================================
let state: AgentState;
let getActiveDirectives: () => UserDirective[];

/** Call once from monolith to inject state references */
export function initSelfImprovement(deps: {
  state: AgentState;
  getActiveDirectives: () => UserDirective[];
}) {
  state = deps.state;
  getActiveDirectives = deps.getActiveDirectives;
}

/** Get current shadow proposals (for state persistence) */
export function getShadowProposals(): ShadowProposal[] { return shadowProposals; }
export function setShadowProposals(proposals: ShadowProposal[]): void { shadowProposals = proposals; }

export function calculateTradePerformance(): TradePerformanceStats {
  const completedTrades = state.tradeHistory.filter(t => t.success && t.action !== "HOLD");
  const totalTrades = completedTrades.length;

  if (totalTrades === 0) {
    return {
      totalTrades: 0, winRate: 0, avgReturnPercent: 0,
      bestTrade: null, worstTrade: null, avgHoldingPeriod: "N/A",
      profitFactor: 0, winsByRegime: {} as any,
    };
  }

  // Calculate wins based on realized P&L from cost basis
  let grossProfit = 0;
  let grossLoss = 0;
  const tradeReturns: { symbol: string; returnPercent: number }[] = [];

  for (const trade of completedTrades) {
    if (trade.action === "SELL") {
      const cb = state.costBasis[trade.fromToken];
      if (cb && cb.averageCostBasis > 0 && trade.amountUSD > 0) {
        const tokensSold = trade.tokenAmount || (trade.amountUSD / (cb.averageCostBasis || 1));
        const costOfSold = tokensSold * cb.averageCostBasis;
        const pnl = trade.amountUSD - costOfSold;
        const returnPct = costOfSold > 0 ? (pnl / costOfSold) * 100 : 0;
        tradeReturns.push({ symbol: trade.fromToken, returnPercent: returnPct });
        if (pnl > 0) grossProfit += pnl;
        else grossLoss += Math.abs(pnl);
      }
    }
  }

  const wins = tradeReturns.filter(t => t.returnPercent > 0).length;
  const winRate = tradeReturns.length > 0 ? (wins / tradeReturns.length) * 100 : 0;
  const avgReturn = tradeReturns.length > 0 ? tradeReturns.reduce((s, t) => s + t.returnPercent, 0) / tradeReturns.length : 0;
  const best = tradeReturns.length > 0 ? tradeReturns.reduce((a, b) => a.returnPercent > b.returnPercent ? a : b) : null;
  const worst = tradeReturns.length > 0 ? tradeReturns.reduce((a, b) => a.returnPercent < b.returnPercent ? a : b) : null;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Win rate by market regime
  const winsByRegime: Record<string, { wins: number; total: number }> = {};
  for (const trade of completedTrades) {
    const regime = trade.signalContext?.marketRegime || "UNKNOWN";
    if (!winsByRegime[regime]) winsByRegime[regime] = { wins: 0, total: 0 };
    winsByRegime[regime].total++;
    // Approximate: if trade was a sell with positive reasoning
    if (trade.action === "SELL") {
      const ret = tradeReturns.find(r => r.symbol === trade.fromToken);
      if (ret && ret.returnPercent > 0) winsByRegime[regime].wins++;
    }
  }

  return {
    totalTrades, winRate, avgReturnPercent: avgReturn,
    bestTrade: best, worstTrade: worst,
    avgHoldingPeriod: "tracked per token via costBasis",
    profitFactor,
    winsByRegime: winsByRegime as any,
  };
}

// ============================================================================
// WIN RATE TRUTH DASHBOARD — Honest profitability metrics
// ============================================================================

// RoundTripTrade, WinRateTruthData — imported from types/state.ts

/**
 * Calculate honest win rate metrics by matching BUY -> SELL round-trips.
 * Unlike the existing calculateTradePerformance() which uses current cost basis
 * snapshots, this matches each SELL to its preceding BUY for the same token
 * to compute actual realized profitability per round-trip.
 */
export function calculateWinRateTruth(): WinRateTruthData {
  // 1. Execution win rate: the existing "success" metric
  const allActionableTrades = state.tradeHistory.filter(t => t.action !== "HOLD");
  const successfulTrades = allActionableTrades.filter(t => t.success);
  const executionWinRate = allActionableTrades.length > 0
    ? (successfulTrades.length / allActionableTrades.length) * 100
    : 0;

  // 2. Build round-trip trades by matching BUYs to SELLs for the same token.
  // For each SELL, find the most recent unmatched BUY for that token.
  const roundTrips: RoundTripTrade[] = [];
  const unmatchedBuys: Map<string, TradeRecord[]> = new Map(); // token -> stack of buys

  // Process trades chronologically
  const sortedTrades = [...state.tradeHistory]
    .filter(t => t.success && (t.action === "BUY" || t.action === "SELL"))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  for (const trade of sortedTrades) {
    if (trade.action === "BUY") {
      const token = trade.toToken;
      if (!unmatchedBuys.has(token)) unmatchedBuys.set(token, []);
      unmatchedBuys.get(token)!.push(trade);
    } else if (trade.action === "SELL") {
      const token = trade.fromToken;
      const buyStack = unmatchedBuys.get(token);
      if (buyStack && buyStack.length > 0) {
        // Match with the earliest unmatched buy (FIFO)
        const matchedBuy = buyStack.shift()!;
        const pnlUSD = trade.amountUSD - matchedBuy.amountUSD;
        const returnPercent = matchedBuy.amountUSD > 0
          ? (pnlUSD / matchedBuy.amountUSD) * 100
          : 0;
        const holdMs = new Date(trade.timestamp).getTime() - new Date(matchedBuy.timestamp).getTime();
        const holdDurationHours = Math.round((holdMs / (1000 * 60 * 60)) * 10) / 10;

        roundTrips.push({
          token,
          buyTimestamp: matchedBuy.timestamp,
          sellTimestamp: trade.timestamp,
          buyAmountUSD: matchedBuy.amountUSD,
          sellAmountUSD: trade.amountUSD,
          pnlUSD: Math.round(pnlUSD * 100) / 100,
          returnPercent: Math.round(returnPercent * 100) / 100,
          holdDurationHours,
        });
      }
      // If no matching buy found, this sell is from a pre-existing position — skip it
    }
  }

  // 3. Compute realized win rate from round-trips
  const profitableRoundTrips = roundTrips.filter(rt => rt.pnlUSD > 0).length;
  const realizedWinRate = roundTrips.length > 0
    ? (profitableRoundTrips / roundTrips.length) * 100
    : 0;

  // 4. Gross profits and losses
  let grossProfitUSD = 0;
  let grossLossUSD = 0;
  const winPnLs: number[] = [];
  const lossPnLs: number[] = [];

  for (const rt of roundTrips) {
    if (rt.pnlUSD > 0) {
      grossProfitUSD += rt.pnlUSD;
      winPnLs.push(rt.pnlUSD);
    } else {
      grossLossUSD += Math.abs(rt.pnlUSD);
      lossPnLs.push(Math.abs(rt.pnlUSD));
    }
  }

  const profitFactor = grossLossUSD > 0 ? grossProfitUSD / grossLossUSD : (grossProfitUSD > 0 ? Infinity : 0);

  // 5. Average win / average loss
  const avgWinUSD = winPnLs.length > 0
    ? Math.round((winPnLs.reduce((s, v) => s + v, 0) / winPnLs.length) * 100) / 100
    : 0;
  const avgLossUSD = lossPnLs.length > 0
    ? Math.round((lossPnLs.reduce((s, v) => s + v, 0) / lossPnLs.length) * 100) / 100
    : 0;
  const winLossRatio = avgLossUSD > 0 ? Math.round((avgWinUSD / avgLossUSD) * 100) / 100 : (avgWinUSD > 0 ? Infinity : 0);

  // 6. Daily win rates for the last 7 days
  const now = new Date();
  const dailyWinRates: Array<{ date: string; winRate: number; trades: number; wins: number }> = [];
  for (let d = 6; d >= 0; d--) {
    const day = new Date(now);
    day.setDate(day.getDate() - d);
    const dateStr = day.toISOString().slice(0, 10);

    const dayTrips = roundTrips.filter(rt => rt.sellTimestamp.slice(0, 10) === dateStr);
    const dayWins = dayTrips.filter(rt => rt.pnlUSD > 0).length;
    dailyWinRates.push({
      date: dateStr,
      winRate: dayTrips.length > 0 ? Math.round((dayWins / dayTrips.length) * 1000) / 10 : 0,
      trades: dayTrips.length,
      wins: dayWins,
    });
  }

  return {
    executionWinRate: Math.round(executionWinRate * 100) / 100,
    realizedWinRate: Math.round(realizedWinRate * 100) / 100,
    profitFactor: profitFactor === Infinity ? 999 : Math.round(profitFactor * 100) / 100,
    dailyWinRates,
    avgWinUSD,
    avgLossUSD,
    winLossRatio: winLossRatio === Infinity ? 999 : winLossRatio,
    totalRoundTrips: roundTrips.length,
    profitableRoundTrips,
    grossProfitUSD: Math.round(grossProfitUSD * 100) / 100,
    grossLossUSD: Math.round(grossLossUSD * 100) / 100,
    roundTrips: roundTrips.slice(-50), // Last 50 round-trips for detail
  };
}

// ============================================================================
// PHASE 3: RECURSIVE SELF-IMPROVEMENT ENGINE
// ============================================================================

// StrategyPattern, AdaptiveThresholds, PerformanceReview, ExplorationState — imported from types/index.ts

export const THRESHOLD_BOUNDS: Record<string, { min: number; max: number; maxStep: number }> = {
  rsiOversold:           { min: 20, max: 40, maxStep: 2 },
  rsiOverbought:         { min: 60, max: 80, maxStep: 2 },
  confluenceBuy:         { min: 5,  max: 28, maxStep: 2 },  // v21.2: capped at 28 (was 30) — bot tuned itself to 30 and stopped trading entirely
  confluenceSell:        { min: -30, max: -5, maxStep: 2 },
  confluenceStrongBuy:   { min: 25, max: 45, maxStep: 3 },  // v21.2: capped at 45 (was 60) — death spiral prevention
  confluenceStrongSell:  { min: -60, max: -25, maxStep: 3 },
  profitTakeTarget:      { min: 10, max: 40, maxStep: 2 },
  profitTakeSellPercent: { min: 15, max: 50, maxStep: 3 },
  stopLossPercent:       { min: -25, max: -12, maxStep: 2 },    // v12.2.2: widened from -6% ceiling — was causing churn
  trailingStopPercent:   { min: -20, max: -10, maxStep: 2 },   // v12.2.2: widened from -5% ceiling — too tight for altcoins
  atrStopMultiplier:     { min: 1.5, max: 4.0, maxStep: 0.25 }, // v9.0: ATR stop multiplier
  atrTrailMultiplier:    { min: 1.5, max: 4.0, maxStep: 0.25 }, // v9.0: ATR trail multiplier
};

export const DEFAULT_ADAPTIVE_THRESHOLDS: AdaptiveThresholds = {
  rsiOversold: 30,
  rsiOverbought: 70,
  confluenceBuy: 8,       // v11.4.22: Lowered from 15 — with no RSI/MACD history, scores stay near 0-8. Need lower bar to bootstrap trades.
  confluenceSell: -8,     // v11.4.22: Symmetrical with buy threshold
  confluenceStrongBuy: 30, // v11.4.22: Lowered from 40 — more achievable for conviction trades
  confluenceStrongSell: -30, // v11.4.22: Symmetrical
  profitTakeTarget: 30,    // Let winners run to 30% before harvesting
  profitTakeSellPercent: 30,
  stopLossPercent: -15,       // v6.2: tightened from -25%
  trailingStopPercent: -12,   // v6.2: tightened from -20%
  atrStopMultiplier: ATR_STOP_LOSS_MULTIPLIER,     // v9.0: 2.5x ATR default
  atrTrailMultiplier: ATR_TRAILING_STOP_MULTIPLIER, // v9.0: 2.0x ATR default
  regimeMultipliers: {
    TRENDING_UP: 1.3,       // v11.4.22: Aligned with constants.ts v9.4 values
    TRENDING_DOWN: 0.85,    // v11.4.22: Was 0.6 — still trade, just more selective
    RANGING: 0.9,           // v11.4.22: Was 0.8 — ranges are opportunity for a fast-cycling bot
    VOLATILE: 0.7,          // v11.4.22: Was 0.5 — vol = opportunity
    UNKNOWN: 0.8,           // v11.4.22: Was 0.7
  },
  history: [],
  lastAdapted: null,
  adaptationCount: 0,
};

export const DEFAULT_EXPLORATION_STATE: ExplorationState = {
  totalExplorationTrades: 0,
  totalExploitationTrades: 0,
  consecutiveHolds: 0,
  lastTradeTimestamp: null,
  stagnationAlerts: 0,
};

/**
 * Classify a trade into a strategy pattern bucket based on its signal context
 */
export function classifyTradePattern(trade: TradeRecord): string {
  if (!trade.signalContext) return "UNKNOWN_UNKNOWN_UNKNOWN_UNKNOWN";
  const { marketRegime, confluenceScore, rsi } = trade.signalContext;
  const action = trade.action === "BUY" || trade.action === "SELL" ? trade.action : "BUY";

  // RSI bucket
  let rsiBucket = "UNKNOWN";
  if (rsi !== null && rsi !== undefined) {
    if (rsi < state.adaptiveThresholds.rsiOversold) rsiBucket = "OVERSOLD";
    else if (rsi > state.adaptiveThresholds.rsiOverbought) rsiBucket = "OVERBOUGHT";
    else rsiBucket = "NEUTRAL";
  }

  // Confluence bucket
  let confBucket = "NEUTRAL";
  if (confluenceScore >= state.adaptiveThresholds.confluenceStrongBuy) confBucket = "STRONG_BUY";
  else if (confluenceScore >= state.adaptiveThresholds.confluenceBuy) confBucket = "BUY";
  else if (confluenceScore <= state.adaptiveThresholds.confluenceStrongSell) confBucket = "STRONG_SELL";
  else if (confluenceScore <= state.adaptiveThresholds.confluenceSell) confBucket = "SELL";

  return `${action}_${rsiBucket}_${marketRegime}_${confBucket}`;
}

/**
 * Build pattern description from pattern ID
 */
export function describePattern(patternId: string): string {
  const parts = patternId.split("_");
  if (parts.length < 4) return patternId;
  const [action, rsi, ...rest] = parts;
  const regime = rest.slice(0, -1).join("_") || "UNKNOWN";
  const conf = rest[rest.length - 1] || "NEUTRAL";
  const rsiLabel = rsi === "OVERSOLD" ? "RSI oversold" : rsi === "OVERBOUGHT" ? "RSI overbought" : "RSI neutral";
  const confLabel = conf.replace("_", " ").toLowerCase();
  return `${action} when ${rsiLabel} in ${regime} regime (${confLabel} confluence)`;
}

/**
 * Analyze all trade history to build strategy pattern memory
 */
export function analyzeStrategyPatterns(): void {
  const patterns: Record<string, StrategyPattern> = {};

  // v12.2.7: Filter out forced/exploration trades — they pollute pattern recognition
  // because they were executed by mechanical pressure, not signal quality.
  // The engine should only learn from trades the AI actually chose.
  const aiTrades = state.tradeHistory.filter(t => {
    if (!t.success || t.action === "HOLD" || t.action === "REBALANCE") return false;
    if (t.signalContext?.isExploration) return false;
    if (t.signalContext?.isForced) return false;
    if (t.signalContext?.triggeredBy === "EXPLORATION" || t.signalContext?.triggeredBy === "FORCED_DEPLOY") return false;
    // Also catch legacy forced trades by reasoning prefix
    if (t.reasoning?.startsWith("FORCED_DEPLOY:") || t.reasoning?.startsWith("DEPLOYMENT_FALLBACK:") || t.reasoning?.startsWith("DIRECT_DEPLOYMENT:")) return false;
    return true;
  });

  // Process each non-HOLD AI-driven trade
  for (const trade of aiTrades) {
    const patternId = classifyTradePattern(trade);

    if (!patterns[patternId]) {
      const parts = patternId.split("_");
      const action = (parts[0] === "BUY" || parts[0] === "SELL") ? parts[0] as "BUY" | "SELL" : "BUY";
      const rsiBucket = parts[1] as any || "UNKNOWN";
      const regime = parts.slice(2, -1).join("_") as MarketRegime || "UNKNOWN";
      const confBucket = parts[parts.length - 1] as any || "NEUTRAL";

      patterns[patternId] = {
        patternId,
        description: describePattern(patternId),
        conditions: { action, regime: regime as MarketRegime, rsiBucket, confluenceBucket: confBucket },
        stats: { wins: 0, losses: 0, pending: 0, avgReturnPercent: 0, totalReturnUSD: 0, sampleSize: 0, lastTriggered: trade.timestamp },
        confidence: 0.3,
      };
    }

    patterns[patternId].stats.lastTriggered = trade.timestamp;

    // For BUY trades, find the matching SELL to compute return
    if (trade.action === "BUY") {
      const buyTime = new Date(trade.timestamp).getTime();
      const matchingSell = state.tradeHistory.find(t =>
        t.action === "SELL" && t.fromToken === trade.toToken && t.success &&
        new Date(t.timestamp).getTime() > buyTime
      );
      if (matchingSell) {
        const cb = state.costBasis[trade.toToken];
        if (cb && cb.averageCostBasis > 0) {
          const returnPct = matchingSell.amountUSD > 0 && trade.amountUSD > 0
            ? ((matchingSell.amountUSD / trade.amountUSD) - 1) * 100
            : 0;
          patterns[patternId].stats.sampleSize++;
          if (returnPct > 0) patterns[patternId].stats.wins++;
          else patterns[patternId].stats.losses++;
          patterns[patternId].stats.totalReturnUSD += (matchingSell.amountUSD - trade.amountUSD);
        }
      } else {
        patterns[patternId].stats.pending++;
      }
    }

    // For SELL trades, look back for the BUY
    if (trade.action === "SELL") {
      const sellTime = new Date(trade.timestamp).getTime();
      const matchingBuy = [...state.tradeHistory].reverse().find(t =>
        t.action === "BUY" && t.toToken === trade.fromToken && t.success &&
        new Date(t.timestamp).getTime() < sellTime
      );
      if (matchingBuy && matchingBuy.amountUSD > 0) {
        const returnPct = ((trade.amountUSD / matchingBuy.amountUSD) - 1) * 100;
        patterns[patternId].stats.sampleSize++;
        if (returnPct > 0) patterns[patternId].stats.wins++;
        else patterns[patternId].stats.losses++;
        patterns[patternId].stats.totalReturnUSD += (trade.amountUSD - matchingBuy.amountUSD);
      } else {
        patterns[patternId].stats.pending++;
      }
    }
  }

  // Calculate avg returns and confidence for each pattern
  for (const p of Object.values(patterns)) {
    p.stats.avgReturnPercent = p.stats.sampleSize > 0
      ? (p.stats.totalReturnUSD / Math.max(1, p.stats.sampleSize))
      : 0;

    // Confidence: based on sample size + win rate
    const winRate = p.stats.sampleSize > 0 ? p.stats.wins / p.stats.sampleSize : 0;
    let conf = 0.3; // base
    if (p.stats.sampleSize >= 3) conf = 0.4;
    if (p.stats.sampleSize >= 5) conf = 0.55;
    if (p.stats.sampleSize >= 10) conf = 0.7;
    if (p.stats.sampleSize >= 20) conf = 0.85;
    conf *= (0.5 + winRate * 0.5); // weight by win rate
    if (p.stats.avgReturnPercent < 0) conf *= 0.7; // penalty for negative avg
    p.confidence = Math.max(0.2, Math.min(1.0, conf));
  }

  state.strategyPatterns = patterns;
  const excludedCount = state.tradeHistory.filter(t => t.success && t.action !== "HOLD" && t.action !== "REBALANCE").length - aiTrades.length;
  console.log(`  🧠 Strategy patterns analyzed: ${Object.keys(patterns).length} patterns from ${aiTrades.length} AI trades (${excludedCount} forced/exploration trades excluded)`);
}

/**
 * Run performance review — generates insights and recommendations
 */
export function runPerformanceReview(reason: "TRADE_COUNT" | "TIME_ELAPSED"): PerformanceReview {
  const startIdx = state.lastReviewTradeIndex || 0;
  const recentTrades = state.tradeHistory.slice(startIdx);
  const successTrades = recentTrades.filter(t => t.success && t.action !== "HOLD");

  const insights: PerformanceReview["insights"] = [];
  const recommendations: PerformanceReview["recommendations"] = [];

  // Win rate analysis
  const sellTrades = successTrades.filter(t => t.action === "SELL");
  let wins = 0, losses = 0;
  for (const sell of sellTrades) {
    const cb = state.costBasis[sell.fromToken];
    if (cb && cb.averageCostBasis > 0 && sell.amountUSD > 0) {
      const tokensSold = sell.tokenAmount || (sell.amountUSD / cb.averageCostBasis);
      const pnl = sell.amountUSD - (tokensSold * cb.averageCostBasis);
      if (pnl > 0) wins++; else losses++;
    }
  }
  const winRate = (wins + losses) > 0 ? wins / (wins + losses) : 0;
  const avgReturn = sellTrades.length > 0
    ? sellTrades.reduce((sum, t) => sum + (t.portfolioValueAfter || t.portfolioValueBefore) - t.portfolioValueBefore, 0) / sellTrades.length
    : 0;

  // Regime analysis
  const regimeCounts: Record<string, number> = {};
  for (const t of successTrades) {
    const r = t.signalContext?.marketRegime || "UNKNOWN";
    regimeCounts[r] = (regimeCounts[r] || 0) + 1;
  }
  const dominantRegime = Object.entries(regimeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as MarketRegime || null;

  // Pattern analysis
  const patternArr = Object.values(state.strategyPatterns)
    .filter(p => p.stats.sampleSize >= 2)
    .sort((a, b) => b.stats.avgReturnPercent - a.stats.avgReturnPercent);
  const bestPattern = patternArr[0] || null;
  const worstPattern = patternArr[patternArr.length - 1] || null;

  // Generate insights
  if (winRate < 0.35 && (wins + losses) >= 3) {
    insights.push({ category: "PATTERN", severity: "WARNING",
      message: `Win rate dropped to ${(winRate * 100).toFixed(0)}% over last ${wins + losses} resolved trades. Consider tightening entry criteria.` });
    recommendations.push({ type: "THRESHOLD_CHANGE", description: "Raise confluence buy threshold to be more selective", applied: false });
  }
  if (winRate > 0.65 && (wins + losses) >= 3) {
    insights.push({ category: "PATTERN", severity: "INFO",
      message: `Strong ${(winRate * 100).toFixed(0)}% win rate over last ${wins + losses} trades. Strategy is working well.` });
    recommendations.push({ type: "THRESHOLD_CHANGE", description: "Can slightly lower confluence buy threshold to capture more opportunities", applied: false });
  }

  if (bestPattern && bestPattern.stats.sampleSize >= 3 && bestPattern.stats.avgReturnPercent > 0) {
    insights.push({ category: "PATTERN", severity: "INFO",
      message: `Best pattern: "${bestPattern.description}" — ${bestPattern.stats.wins}/${bestPattern.stats.sampleSize} wins, avg $${bestPattern.stats.avgReturnPercent.toFixed(2)} return` });
    recommendations.push({ type: "PATTERN_FAVOR", description: `Favor ${bestPattern.patternId} — proven profitable`, applied: false });
  }
  if (worstPattern && worstPattern.stats.sampleSize >= 3 && worstPattern.stats.avgReturnPercent < 0) {
    insights.push({ category: "PATTERN", severity: "WARNING",
      message: `Worst pattern: "${worstPattern.description}" — ${worstPattern.stats.losses}/${worstPattern.stats.sampleSize} losses, avg $${worstPattern.stats.avgReturnPercent.toFixed(2)} return` });
    recommendations.push({ type: "PATTERN_AVOID", description: `Avoid ${worstPattern.patternId} — consistent losses`, applied: false });
  }

  // Regime-specific insights
  for (const [regime, count] of Object.entries(regimeCounts)) {
    const regimePatterns = Object.values(state.strategyPatterns).filter((p: any) => p.conditions.regime === regime && p.stats.sampleSize >= 2);
    const regimeWinRate = regimePatterns.length > 0
      ? (regimePatterns as any[]).reduce((s: number, p: any) => s + p.stats.wins, 0) / Math.max(1, (regimePatterns as any[]).reduce((s: number, p: any) => s + p.stats.sampleSize, 0))
      : 0;
    if (regimeWinRate < 0.3 && count >= 3) {
      insights.push({ category: "REGIME", severity: "ACTION",
        message: `${regime} regime trades have only ${(regimeWinRate * 100).toFixed(0)}% win rate. Consider reducing position sizes in this regime.` });
      recommendations.push({ type: "POSITION_SIZE", description: `Reduce regime multiplier for ${regime}`, applied: false });
    }
  }

  // Stagnation check
  const hoursSinceLastTrade = state.trading.lastTrade
    ? (Date.now() - state.trading.lastTrade.getTime()) / (1000 * 60 * 60)
    : Infinity;
  if (hoursSinceLastTrade > 48) {
    insights.push({ category: "ACTIVITY", severity: "WARNING",
      message: `No trades in ${(hoursSinceLastTrade / 24).toFixed(1)} days. Bot may be too selective.` });
    recommendations.push({ type: "THRESHOLD_CHANGE", description: "Consider lowering confluence thresholds to increase trade frequency", applied: false });
  }

  const review: PerformanceReview = {
    timestamp: new Date().toISOString(),
    triggerReason: reason,
    tradesSinceLastReview: recentTrades.length,
    insights,
    recommendations,
    periodStats: {
      winRate, avgReturn, totalTrades: successTrades.length,
      bestPattern: bestPattern?.patternId || null,
      worstPattern: worstPattern?.patternId || null,
      dominantRegime,
    },
  };

  console.log(`  📊 Performance Review: ${insights.length} insights, ${recommendations.length} recommendations`);
  for (const i of insights) console.log(`     [${i.severity}] ${i.message}`);
  return review;
}

/**
 * Adapt thresholds based on performance review — bounded, gradual, audited
 */
/**
 * v5.1: Shadow Model Validation — proposed threshold changes must pass statistical
 * significance checks before being promoted to live. Changes sit in a "shadow" queue
 * and only apply after n=5+ confirming reviews or when p-value proxy drops below 0.10.
 */
// ShadowProposal — imported from types/index.ts

// In-memory shadow proposal queue (persisted via state)
let shadowProposals: ShadowProposal[] = [];

// v9.0: ATR comparison logging — tracks how many comparison entries we've emitted
let atrComparisonLogCount = 0;

export function adaptThresholds(review: PerformanceReview, currentRegime?: string): void {
  const t = state.adaptiveThresholds;
  const { winRate, totalTrades } = review.periodStats;
  if (totalTrades < 3) return; // Not enough data to adapt

  // v5.1: Shadow model validation constants
  const MIN_CONFIRMING_REVIEWS = 3;   // Need 3 consecutive confirmations
  const MIN_SAMPLE_SIZE = 5;          // Need at least 5 trades in review period
  const MAX_CONTRADICTION_RATIO = 0.3; // Reject if >30% contradictions
  // v20.0: Walk-forward validation — require confirmations from 2+ market regimes
  const MIN_REGIME_DIVERSITY = 2;     // Must be confirmed in 2+ different regimes

  const proposeAdaptation = (field: string, delta: number, reason: string) => {
    const bounds = THRESHOLD_BOUNDS[field];
    if (!bounds) return;

    // Check if there's already a pending proposal for this field in the same direction
    const existing = shadowProposals.find(
      p => p.field === field && p.status === "PENDING" && Math.sign(p.proposedDelta) === Math.sign(delta)
    );

    if (existing) {
      // Confirm existing proposal + track regime diversity
      existing.confirmingReviews++;
      if (currentRegime) {
        if (!existing.regimesSeen) existing.regimesSeen = [];
        if (!existing.regimesSeen.includes(currentRegime)) existing.regimesSeen.push(currentRegime);
      }
      const regimeCount = existing.regimesSeen?.length || 0;
      console.log(`     🔬 Shadow: ${field} confirmed (${existing.confirmingReviews}/${MIN_CONFIRMING_REVIEWS} reviews, ${regimeCount}/${MIN_REGIME_DIVERSITY} regimes)`);

      // Check if ready for promotion — requires both review count AND regime diversity
      const totalReviews = existing.confirmingReviews + existing.contradictingReviews;
      const contradictionRatio = totalReviews > 0 ? existing.contradictingReviews / totalReviews : 0;

      if (existing.confirmingReviews >= MIN_CONFIRMING_REVIEWS && contradictionRatio <= MAX_CONTRADICTION_RATIO && totalTrades >= MIN_SAMPLE_SIZE && regimeCount >= MIN_REGIME_DIVERSITY) {
        // PROMOTE — apply the change
        const currentVal = (t as any)[field] as number;
        const cappedDelta = Math.sign(existing.proposedDelta) * Math.min(Math.abs(existing.proposedDelta), bounds.maxStep);
        const newVal = Math.max(bounds.min, Math.min(bounds.max, currentVal + cappedDelta));
        if (newVal !== currentVal) {
          t.history.push({
            timestamp: new Date().toISOString(),
            field,
            oldValue: currentVal,
            newValue: newVal,
            reason: `SHADOW VALIDATED: ${existing.reason} (${existing.confirmingReviews} confirmations, ${existing.contradictingReviews} contradictions, ${totalTrades} trades)`,
          });
          (t as any)[field] = newVal;
          existing.status = "PROMOTED";
          console.log(`     ✅ Shadow PROMOTED: ${field}: ${currentVal} → ${newVal} (${existing.confirmingReviews} confirmations over ${totalReviews} reviews)`);
        }
      }
    } else {
      // Check for contradicting proposals (same field, opposite direction)
      const contradicted = shadowProposals.find(
        p => p.field === field && p.status === "PENDING" && Math.sign(p.proposedDelta) !== Math.sign(delta)
      );
      if (contradicted) {
        contradicted.contradictingReviews++;
        const totalReviews = contradicted.confirmingReviews + contradicted.contradictingReviews;
        const contradictionRatio = totalReviews > 0 ? contradicted.contradictingReviews / totalReviews : 0;
        if (contradictionRatio > MAX_CONTRADICTION_RATIO && totalReviews >= 3) {
          contradicted.status = "REJECTED";
          console.log(`     ❌ Shadow REJECTED: ${field} (${contradicted.contradictingReviews}/${totalReviews} contradictions)`);
        }
      }

      // Create new shadow proposal
      shadowProposals.push({
        field,
        proposedDelta: delta,
        reason,
        proposedAt: new Date().toISOString(),
        confirmingReviews: 1,
        contradictingReviews: 0,
        status: "PENDING",
        regimesSeen: currentRegime ? [currentRegime] : [],
      });
      console.log(`     🔬 Shadow: New proposal for ${field} (delta: ${delta > 0 ? "+" : ""}${delta}) — needs ${MIN_CONFIRMING_REVIEWS} confirmations`);
    }
  };

  // Low win rate → propose being more selective
  if (winRate < 0.35) {
    proposeAdaptation("confluenceBuy", 2, `Low win rate ${(winRate * 100).toFixed(0)}%`);
    proposeAdaptation("confluenceStrongBuy", 2, `Low win rate ${(winRate * 100).toFixed(0)}%`);
    proposeAdaptation("stopLossPercent", 2, `Tighten stops: win rate ${(winRate * 100).toFixed(0)}%`);
  }

  // High win rate → propose slightly more aggressive
  if (winRate > 0.65) {
    proposeAdaptation("confluenceBuy", -1, `High win rate ${(winRate * 100).toFixed(0)}%`);
  }

  // Negative avg return → propose tighter risk management
  if (review.periodStats.avgReturn < -2) {
    proposeAdaptation("stopLossPercent", 2, `Negative avg return $${review.periodStats.avgReturn.toFixed(2)}`);
    proposeAdaptation("trailingStopPercent", 2, `Negative avg return $${review.periodStats.avgReturn.toFixed(2)}`);
    // v9.0: Tighten ATR multipliers too (lower multiplier = tighter stop)
    proposeAdaptation("atrStopMultiplier", -0.25, `Negative avg return $${review.periodStats.avgReturn.toFixed(2)}`);
    proposeAdaptation("atrTrailMultiplier", -0.25, `Negative avg return $${review.periodStats.avgReturn.toFixed(2)}`);
  }

  // Strong avg return → propose letting winners run longer
  if (review.periodStats.avgReturn > 5) {
    proposeAdaptation("profitTakeTarget", 2, `Strong avg return $${review.periodStats.avgReturn.toFixed(2)}`);
    // v9.0: Widen ATR multipliers (higher multiplier = wider stop = let winners run)
    proposeAdaptation("atrStopMultiplier", 0.25, `Strong avg return $${review.periodStats.avgReturn.toFixed(2)}`);
    proposeAdaptation("atrTrailMultiplier", 0.25, `Strong avg return $${review.periodStats.avgReturn.toFixed(2)}`);
  }

  // v9.0: Low win rate → tighten ATR stops
  if (winRate < 0.35) {
    proposeAdaptation("atrStopMultiplier", -0.25, `Low win rate ${(winRate * 100).toFixed(0)}%`);
  }

  // Clean up old completed/rejected proposals (keep last 50)
  shadowProposals = shadowProposals.filter(p => p.status === "PENDING").concat(
    shadowProposals.filter(p => p.status !== "PENDING").slice(-20)
  );

  // Trim audit trail to last 100 entries
  if (t.history.length > 100) t.history = t.history.slice(-100);
  t.lastAdapted = new Date().toISOString();
  t.adaptationCount++;
}

/**
 * Calculate confidence for a specific pattern in the current regime
 */
export function calculatePatternConfidence(patternId: string, regime: MarketRegime): number {
  const pattern = state.strategyPatterns[patternId];
  if (!pattern || pattern.stats.sampleSize < 2) return 0.5; // Unproven → moderate confidence (v5.2: raised from 0.3 to prevent $2-3 dust trades) // Unproven → low confidence

  let conf = pattern.confidence;

  // Regime multiplier from adaptive thresholds
  const regimeMult = state.adaptiveThresholds.regimeMultipliers[regime] || 1.0;
  conf *= regimeMult;

  // Decay if stale (not triggered in 14+ days)
  if (pattern.stats.lastTriggered) {
    const daysSince = (Date.now() - new Date(pattern.stats.lastTriggered).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 14) conf *= 0.9;
    if (daysSince > 30) conf *= 0.8;
  }

  // v10.3: Floor raised from 0.2 → 0.6 — max 40% reduction, never more
  // If 11 dimensions say buy, pattern history shouldn't override that by 80%
  return Math.max(0.6, Math.min(1.0, conf));
}

/**
 * Check for stagnation and generate exploration trade if needed
 * Returns a trade-like object or null
 *
 * v14.2: Added guardrails — exploration trades must not fight the trend.
 *   - Minimum confluence >= 0 (neutral)
 *   - MACD must not be bearish
 *   - Buy ratio must be >= 45% (sellers not dominating)
 *   - In RANGING markets: 50% size reduction, max 1 per cycle
 */
export function checkStagnation(
  availableUSDC: number,
  tokenData: any[],
  indicators: Record<string, TechnicalIndicators>,
  marketRegime: MarketRegime
): { toToken: string; amountUSD: number; reasoning: string } | null {
  const exploration = state.explorationState;
  const hoursSinceLastTrade = state.trading.lastTrade
    ? (Date.now() - state.trading.lastTrade.getTime()) / (1000 * 60 * 60)
    : Infinity;

  // No exploration if insufficient capital
  if (availableUSDC < 5) return null;

  // v11.4.22: Trigger exploration after 1 hour (was 4h in v11.4.13).
  // The bot needs to be actively trading to build the 20-trade sample for Kelly sizing.
  // 1 hour stagnation is already too long for a 24/7 autonomous agent.
  if (hoursSinceLastTrade < 1) {
    exploration.consecutiveHolds = 0;
    return null;
  }

  exploration.stagnationAlerts++;
  console.log(`  🔬 Stagnation detected: ${hoursSinceLastTrade.toFixed(1)}h since last trade (alert #${exploration.stagnationAlerts})`);

  // Pick the token with best confluence that we haven't traded recently
  const recentTokens = new Set(state.tradeHistory.slice(-10).map(t => t.toToken));
  const candidates = tokenData
    .filter(t => t.symbol !== "USDC" && !recentTokens.has(t.symbol))
    .sort((a, b) => (b.priceChange24h || 0) - (a.priceChange24h || 0));

  if (candidates.length === 0) return null;

  // v14.2: Apply guardrails — iterate candidates until one passes all filters
  let target: any = null;
  for (const candidate of candidates) {
    const ind = indicators[candidate.symbol];
    const confluenceScore = ind?.confluenceScore ?? 0;
    const macdSignal = ind?.macd?.signal ?? "NEUTRAL";

    // v14.2: Compute buy ratio from order flow data
    const buyVolume = ind?.orderFlow?.buyVolumeUSD ?? 0;
    const sellVolume = ind?.orderFlow?.sellVolumeUSD ?? 0;
    const totalVolume = buyVolume + sellVolume;
    const buyRatioPct = totalVolume > 0 ? (buyVolume / totalVolume) * 100 : 50; // default neutral if no data

    // v14.2: GUARDRAIL 1 — Minimum confluence floor (neutral or positive)
    if (confluenceScore < EXPLORATION_MIN_CONFLUENCE) {
      console.log(`  🚫 EXPLORATION_BLOCKED: ${candidate.symbol} has negative confluence (${confluenceScore})`);
      continue;
    }

    // v14.2: GUARDRAIL 2 — MACD filter (no buying into bearish MACD)
    if (macdSignal === "BEARISH") {
      console.log(`  🚫 EXPLORATION_BLOCKED: ${candidate.symbol} has bearish MACD`);
      continue;
    }

    // v14.2: GUARDRAIL 3 — Volume/flow filter (sellers must not dominate)
    if (totalVolume > 0 && buyRatioPct < EXPLORATION_MIN_BUY_RATIO) {
      console.log(`  🚫 EXPLORATION_BLOCKED: ${candidate.symbol} has weak flow (buy ratio ${buyRatioPct.toFixed(1)}% < ${EXPLORATION_MIN_BUY_RATIO}%)`);
      continue;
    }

    // Candidate passed all guardrails
    target = candidate;
    break;
  }

  if (!target) {
    console.log(`  🔬 No exploration candidates passed guardrails (confluence >= ${EXPLORATION_MIN_CONFLUENCE}, non-bearish MACD, buy ratio >= ${EXPLORATION_MIN_BUY_RATIO}%)`);
    return null;
  }

  // v11.4.22: Increased from $15 to $50 (or 3% of available USDC).
  // $15 exploration trades don't build meaningful positions or generate useful P&L data.
  let explorationAmount = Math.min(50, availableUSDC * 0.03);

  // v14.2: GUARDRAIL 4 — In RANGING markets, cut exploration size by 50%
  if (marketRegime === "RANGING") {
    explorationAmount *= EXPLORATION_RANGING_SIZE_MULTIPLIER;
    console.log(`  🔬 RANGING market: exploration size reduced to $${explorationAmount.toFixed(2)} (${EXPLORATION_RANGING_SIZE_MULTIPLIER * 100}% of normal)`);
  }

  return {
    toToken: target.symbol,
    amountUSD: explorationAmount,
    reasoning: `Exploration: No trade in ${(hoursSinceLastTrade / 24).toFixed(1)} days. Testing ${target.symbol} with small $${explorationAmount.toFixed(2)} position to gather data.`,
  };
}

/**
 * Format self-improvement data for AI prompt injection
 * Replaces the generic "LEARN FROM HISTORY" instruction with structured analysis
 */
export function formatSelfImprovementPrompt(): string {
  const patterns = Object.values(state.strategyPatterns)
    .filter(p => p.stats.sampleSize >= 1)
    .sort((a, b) => b.confidence - a.confidence);

  const topPatterns = patterns.filter(p => p.stats.avgReturnPercent > 0).slice(0, 5);
  const bottomPatterns = patterns.filter(p => p.stats.avgReturnPercent < 0).slice(-3);

  const recentReview = state.performanceReviews.length > 0
    ? state.performanceReviews[state.performanceReviews.length - 1]
    : null;

  const t = state.adaptiveThresholds;

  let prompt = `\n=== SELF-IMPROVEMENT ENGINE (Phase 3) ===\n`;
  prompt += `Adaptive Thresholds: RSI oversold=${t.rsiOversold} overbought=${t.rsiOverbought} | `;
  prompt += `Confluence buy=${t.confluenceBuy} sell=${t.confluenceSell} strongBuy=${t.confluenceStrongBuy} strongSell=${t.confluenceStrongSell} | `;
  prompt += `Profit-take=${t.profitTakeTarget}% | Stop-loss=${t.stopLossPercent}% trailing=${t.trailingStopPercent}%\n`;
  prompt += `Regime multipliers: TRENDING_UP=${t.regimeMultipliers.TRENDING_UP}x TRENDING_DOWN=${t.regimeMultipliers.TRENDING_DOWN}x RANGING=${t.regimeMultipliers.RANGING}x VOLATILE=${t.regimeMultipliers.VOLATILE}x\n`;
  prompt += `Adaptations applied: ${t.adaptationCount} total\n\n`;

  if (topPatterns.length > 0) {
    prompt += `PROVEN WINNING PATTERNS (favor these):\n`;
    for (const p of topPatterns) {
      const wr = p.stats.sampleSize > 0 ? ((p.stats.wins / p.stats.sampleSize) * 100).toFixed(0) : "?";
      prompt += `  ✅ ${p.description} — ${p.stats.wins}/${p.stats.sampleSize} wins (${wr}%), avg $${p.stats.avgReturnPercent.toFixed(2)}, confidence ${(p.confidence * 100).toFixed(0)}%\n`;
    }
    prompt += `\n`;
  }

  if (bottomPatterns.length > 0) {
    prompt += `LOSING PATTERNS (avoid these):\n`;
    for (const p of bottomPatterns) {
      const wr = p.stats.sampleSize > 0 ? ((p.stats.wins / p.stats.sampleSize) * 100).toFixed(0) : "?";
      prompt += `  ❌ ${p.description} — ${p.stats.losses}/${p.stats.sampleSize} losses (${wr}% win), avg $${p.stats.avgReturnPercent.toFixed(2)}\n`;
    }
    prompt += `\n`;
  }

  if (recentReview && recentReview.insights.length > 0) {
    prompt += `LATEST PERFORMANCE REVIEW (${recentReview.timestamp.slice(0, 10)}):\n`;
    for (const i of recentReview.insights) {
      prompt += `  [${i.severity}] ${i.message}\n`;
    }
    for (const r of recentReview.recommendations) {
      prompt += `  → ${r.description}\n`;
    }
    prompt += `\n`;
  }

  prompt += `USE THIS DATA: Favor proven patterns, avoid losing ones. Adjust position conviction by pattern confidence. The thresholds above are adaptive — they have been tuned by your performance history.\n`;

  return prompt;
}

// v11.4.16: Format user directives for injection into trading AI prompt
export function formatUserDirectivesPrompt(): string {
  const active = getActiveDirectives();
  if (active.length === 0) return '';

  let prompt = '\n\n═══ USER DIRECTIVES (from dashboard chat) ═══\n';
  prompt += 'The portfolio owner has given you these instructions via chat. Follow them:\n\n';

  for (const d of active) {
    switch (d.type) {
      case 'WATCHLIST':
        prompt += `  🔍 WATCHLIST: ${d.instruction}. Pay extra attention to ${d.token || 'this token'} — research its price, volume, and technicals. If it looks like a good entry, recommend a BUY.\n`;
        break;
      case 'ALLOCATION':
        prompt += `  📊 ALLOCATION: ${d.instruction}. Adjust your sector targeting to aim for this allocation. Rebalance trades should move toward this target.\n`;
        break;
      case 'AVOID':
        prompt += `  🚫 AVOID: ${d.instruction}. Do NOT recommend buying ${d.token || 'this token'} this cycle. Existing positions are fine but no new entries.\n`;
        break;
      case 'GENERAL':
        prompt += `  📝 STRATEGY: ${d.instruction}\n`;
        break;
      case 'RESEARCH':
        prompt += `  🔬 RESEARCH: ${d.instruction}\n`;
        break;
    }
  }

  prompt += '\nThese directives come from the portfolio owner and should be weighted heavily in your decisions.\n';
  return prompt;
}

// v11.4.19: Directive-aware threshold adjustments
// When user sends aggressive/offensive directives, actually lower trading gates
export function getDirectiveThresholdAdjustments(): { confluenceReduction: number; deploymentThresholdOverride: number | null; positionSizeMultiplier: number } {
  const active = getActiveDirectives();
  if (active.length === 0) return { confluenceReduction: 0, deploymentThresholdOverride: null, positionSizeMultiplier: 1.0 };

  const aggressiveKeywords = ['aggressive', 'offense', 'offensive', 'attack', 'deploy', 'deploy capital', 'go hard', 'full send', 'maximize', 'larger positions', 'bigger trades', 'more trades', 'put money to work', 'stop sitting'];
  const conservativeKeywords = ['conservative', 'defensive', 'reduce risk', 'careful', 'slow down', 'less risk', 'protect capital', 'hold cash'];

  let aggressiveScore = 0;
  let conservativeScore = 0;

  for (const d of active) {
    const text = (d.instruction + ' ' + (d.source || '')).toLowerCase();
    for (const kw of aggressiveKeywords) {
      if (text.includes(kw)) { aggressiveScore++; break; }
    }
    for (const kw of conservativeKeywords) {
      if (text.includes(kw)) { conservativeScore++; break; }
    }
  }

  if (aggressiveScore > conservativeScore) {
    // Aggressive: lower confluence by 10 extra points, override deployment threshold to 15%, size up 1.3x
    return { confluenceReduction: 10, deploymentThresholdOverride: 15, positionSizeMultiplier: 1.3 };
  } else if (conservativeScore > aggressiveScore) {
    // Conservative: raise confluence by 5, no deployment override, size down 0.7x
    return { confluenceReduction: -5, deploymentThresholdOverride: null, positionSizeMultiplier: 0.7 };
  }

  return { confluenceReduction: 0, deploymentThresholdOverride: null, positionSizeMultiplier: 1.0 };
}
