/**
 * NVR Capital — Adaptive Replay Engine
 *
 * Composes all 5 strategy levels into a single replay loop:
 *   L1: Multi-timeframe confluence
 *   L2: Regime-adaptive strategy params
 *   L3: Dynamic indicator weights
 *   L4: Intelligent exits
 *   L5: Volume intelligence
 *
 * Each level has a toggle for ablation testing.
 * Follows the same structure as runReplay but with enhanced decision-making.
 *
 * Pure functions. No global state.
 */

import { computeMetrics } from './replay-engine.js';
import { calculateATR } from '../../algorithm/indicators.js';
import { classifyWindow } from '../data/market-conditions.js';
import { buildMultiTimeframeData, calculateMultiTimeframeConfluence, calculateTimeframeConfluence } from '../strategy/multi-timeframe.js';
import { detectRegime, smoothedRegime } from '../strategy/regime-detector.js';
import { applyRegimeOverlay } from '../strategy/regime-params.js';
import { createDynamicWeightState, getEffectiveWeights, updateWeightsAfterTrade } from '../strategy/dynamic-weights.js';
import { evaluateExit } from '../strategy/intelligent-exits.js';
import { ensureRealisticVolume, analyzeVolume } from '../strategy/volume-intelligence.js';
import type {
  HistoricalDataset,
  AdaptiveReplayConfig,
  AdaptiveReplayResult,
  AdaptivePosition,
  ReplayTrade,
  PerformanceMetrics,
  ConditionBreakdown,
  MarketCondition,
  SimRegime,
  RegimeState,
  DynamicWeightState,
  TradeSignalSnapshot,
  OHLCVCandle,
} from '../types.js';

// ============================================================================
// MAIN ADAPTIVE REPLAY
// ============================================================================

export function runAdaptiveReplay(
  datasets: HistoricalDataset[],
  config: AdaptiveReplayConfig,
): AdaptiveReplayResult {
  const startMs = Date.now();
  const { strategy } = config;
  const warmup = config.warmupCandles ?? 50;
  const stepSize = config.stepSize ?? 1;

  // Level toggles (all default true EXCEPT intelligent exits — original exits are already strong)
  const enableMTF = config.enableMultiTimeframe !== false;
  const enableRegime = config.enableRegimeAdaptation !== false;
  const enableWeights = config.enableDynamicWeights !== false;
  const enableExits = config.enableIntelligentExits === true; // opt-IN, original exits are better
  const enableVolume = config.enableVolumeIntel !== false;

  // L5: Pre-process volume if enabled
  const processedDatasets = enableVolume
    ? datasets.map(ds => ({ ...ds, candles: ensureRealisticVolume(ds.candles) }))
    : datasets;

  // Build timeline
  const { timeline, priceBySymbol, closePricesBySymbol, candlesBySymbol, timestampIndexBySymbol } =
    buildTimeline(processedDatasets, config);

  if (timeline.length === 0) {
    return emptyAdaptiveResult(strategy.startingCapital, startMs, config);
  }

  // State
  let cash = strategy.startingCapital;
  const positions = new Map<string, AdaptivePosition>();
  const trades: ReplayTrade[] = [];
  const equityCurve: number[] = [];
  const equityTimestamps: number[] = [];
  const lastKnown = new Map<string, number>();
  const firstPrices = new Map<string, number>();
  const symbols = processedDatasets.map(d => d.symbol);

  let candlesProcessed = 0;
  let equityPeak = strategy.startingCapital;
  let buyingPaused = false;
  const DRAWDOWN_PAUSE_PCT = 20;
  const DRAWDOWN_RESUME_PCT = 10;
  let lastBuyTime = 0;
  const MIN_BUY_INTERVAL_CANDLES = 6;

  // L2: Regime state
  let regimeHistory: RegimeState[] = [];
  let currentRegime: SimRegime = 'RANGING';
  let regimeConfidence = 0.5;
  const regimeDistribution: Record<SimRegime, number> = { TRENDING: 0, RANGING: 0, VOLATILE: 0, BREAKOUT: 0 };

  // L3: Dynamic weights
  let weightState: DynamicWeightState = createDynamicWeightState(20);

  // L6: Trade snapshots for meta-learning
  const tradeSnapshots: TradeSignalSnapshot[] = [];

  // ============================================================================
  // MAIN LOOP
  // ============================================================================

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

    for (const sym of symbols) {
      const price = lastKnown.get(sym);
      if (price === undefined) continue;

      const closePrices = closePricesBySymbol.get(sym);
      if (!closePrices) continue;

      // Get current candle index
      const indexMap = timestampIndexBySymbol.get(sym);
      const idx = indexMap?.get(tick) ?? 0;
      if (idx < warmup) continue;

      const histSlice = closePrices.slice(0, idx);

      // --- L2: Detect regime ---
      if (enableRegime && histSlice.length >= 50) {
        const raw = detectRegime(histSlice);
        const smoothed = smoothedRegime(raw, regimeHistory, 3);
        currentRegime = smoothed.regime;
        regimeConfidence = smoothed.confidence;
        regimeHistory = smoothed.history;
        regimeDistribution[currentRegime]++;
      }

      // --- L2: Apply regime overlay ---
      const effectiveParams = enableRegime
        ? applyRegimeOverlay(strategy, currentRegime, regimeConfidence)
        : strategy;

      // --- L3: Get dynamic weights ---
      const dynWeights = enableWeights ? getEffectiveWeights(weightState) : undefined;

      // --- L1: Calculate confluence ---
      let confluence: number;
      let indicatorSignals: Record<string, number> = {};
      let aligned = false;

      if (enableMTF) {
        const candles = candlesBySymbol.get(sym);
        if (candles && candles.length > 0) {
          const mtfData = buildMultiTimeframeData(candles.slice(0, idx), idx - 1);
          const mtfResult = calculateMultiTimeframeConfluence(mtfData, dynWeights);
          confluence = mtfResult.compositeScore;
          aligned = mtfResult.aligned;
          // Merge indicator signals from the 1h timeframe (primary)
          if (mtfResult.scores.length > 0) {
            indicatorSignals = mtfResult.scores[0].indicatorSignals;
          }
        } else {
          const tfResult = calculateTimeframeConfluence(histSlice, dynWeights);
          confluence = tfResult.score;
          indicatorSignals = tfResult.indicatorSignals;
        }
      } else {
        const tfResult = calculateTimeframeConfluence(histSlice, dynWeights);
        confluence = tfResult.score;
        indicatorSignals = tfResult.indicatorSignals;
      }

      const candles = candlesBySymbol.get(sym);
      let volumeConfirmed = true;

      const pos = positions.get(sym);
      const portfolioValue = calcPortfolioValue(cash, positions, lastKnown);
      const cashPct = portfolioValue > 0 ? (cash / portfolioValue) * 100 : 100;

      // === SELL LOGIC ===
      if (pos && pos.qty > 0) {
        pos.candlesHeld++;

        if (pos.peakPrice < price) pos.peakPrice = price;

        if (enableExits) {
          // L4: Intelligent exit evaluation
          const exitSignal = evaluateExit(histSlice, pos, price, effectiveParams, confluence);

          if (exitSignal.type === 'EXIT') {
            const sellUSD = pos.qty * price;
            const pnl = sellUSD - pos.qty * pos.costBasis;
            cash += sellUSD;

            // L3: Update weights
            if (enableWeights) {
              weightState = updateWeightsAfterTrade(weightState, pos.entrySignals, pnl > 0);
            }

            // L6: Record snapshot
            tradeSnapshots.push({
              timestamp: tick, action: 'SELL', symbol: sym, price,
              regime: currentRegime, confluenceScore: confluence,
              timeframeAligned: aligned, volumeConfirmed,
              indicatorSignals, pnl, holdCandles: pos.candlesHeld,
            });

            positions.delete(sym);
            trades.push(makeTrade(tick, 'SELL', sym, sellUSD, price, exitSignal.reason,
              calcPortfolioValue(cash, positions, lastKnown), pnl, confluence));
            continue;
          }

          if (exitSignal.type === 'REDUCE') {
            const sellQty = pos.qty * exitSignal.suggestedSellFraction;
            const sellUSD = sellQty * price;
            const pnl = sellQty * (price - pos.costBasis);
            cash += sellUSD;
            pos.qty -= sellQty;

            // Update harvest tier based on reason
            if (exitSignal.reason.includes('PROFIT_T3')) pos.lastHarvestTier = 3;
            else if (exitSignal.reason.includes('PROFIT_T2')) pos.lastHarvestTier = 2;
            else if (exitSignal.reason.includes('PROFIT_T1')) pos.lastHarvestTier = 1;

            if (pos.qty < 0.0001) {
              if (enableWeights) {
                weightState = updateWeightsAfterTrade(weightState, pos.entrySignals, pnl > 0);
              }
              positions.delete(sym);
            }

            tradeSnapshots.push({
              timestamp: tick, action: 'SELL', symbol: sym, price,
              regime: currentRegime, confluenceScore: confluence,
              timeframeAligned: aligned, volumeConfirmed,
              indicatorSignals, pnl, holdCandles: pos.candlesHeld,
            });

            trades.push(makeTrade(tick, 'SELL', sym, sellUSD, price, exitSignal.reason,
              calcPortfolioValue(cash, positions, lastKnown), pnl, confluence));
            continue;
          }
        } else {
          // FULL original 4-layer sell logic (proven at 17/25 risk, 19/25 consistency)
          const gainPct = ((price - pos.costBasis) / pos.costBasis) * 100;

          // 1. ATR-adaptive hard stop loss
          const atrData = calculateATR(histSlice);
          const atrPct = atrData?.atrPercent ?? 0;
          const adaptiveStopLoss = atrPct > 3
            ? Math.min(effectiveParams.stopLossPercent * 2, effectiveParams.stopLossPercent + atrPct)
            : effectiveParams.stopLossPercent;
          if (gainPct <= -adaptiveStopLoss) {
            const sellUSD = pos.qty * price;
            const pnl = sellUSD - pos.qty * pos.costBasis;
            cash += sellUSD;
            if (enableWeights) weightState = updateWeightsAfterTrade(weightState, pos.entrySignals, false);
            tradeSnapshots.push({ timestamp: tick, action: 'SELL', symbol: sym, price, regime: currentRegime, confluenceScore: confluence, timeframeAligned: aligned, volumeConfirmed, indicatorSignals, pnl, holdCandles: pos.candlesHeld });
            positions.delete(sym);
            trades.push(makeTrade(tick, 'SELL', sym, sellUSD, price,
              `STOP_LOSS (${gainPct.toFixed(1)}%)`, calcPortfolioValue(cash, positions, lastKnown), pnl, confluence));
            continue;
          }

          // 2. Trailing stop
          if (gainPct >= 3 && pos.peakPrice > pos.costBasis) {
            const dropFromPeak = ((pos.peakPrice - price) / pos.peakPrice) * 100;
            if (dropFromPeak >= (effectiveParams.trailingStopPercent ?? 10)) {
              const sellUSD = pos.qty * price;
              const pnl = sellUSD - pos.qty * pos.costBasis;
              cash += sellUSD;
              if (enableWeights) weightState = updateWeightsAfterTrade(weightState, pos.entrySignals, pnl > 0);
              tradeSnapshots.push({ timestamp: tick, action: 'SELL', symbol: sym, price, regime: currentRegime, confluenceScore: confluence, timeframeAligned: aligned, volumeConfirmed, indicatorSignals, pnl, holdCandles: pos.candlesHeld });
              positions.delete(sym);
              trades.push(makeTrade(tick, 'SELL', sym, sellUSD, price,
                `TRAILING_STOP (drop=${dropFromPeak.toFixed(1)}%)`, calcPortfolioValue(cash, positions, lastKnown), pnl, confluence));
              continue;
            }
          }

          // 3. Tiered profit-taking
          const tier1Pct = effectiveParams.profitTakePercent;
          const tier2Pct = tier1Pct * 1.875;
          const tier3Pct = tier1Pct * 3.125;
          const tier4Pct = tier1Pct * 5;
          const tiers = [
            { level: 1, threshold: tier1Pct, sellFrac: 0.30 },
            { level: 2, threshold: tier2Pct, sellFrac: 0.40 },
            { level: 3, threshold: tier3Pct, sellFrac: 0.50 },
            { level: 4, threshold: tier4Pct, sellFrac: 0.70 },
          ];
          let harvested = false;
          for (let t = tiers.length - 1; t >= 0; t--) {
            const tier = tiers[t];
            if (gainPct >= tier.threshold && pos.lastHarvestTier < tier.level) {
              const sellQty = pos.qty * tier.sellFrac;
              const sellUSD = sellQty * price;
              const pnl = sellQty * (price - pos.costBasis);
              cash += sellUSD;
              pos.qty -= sellQty;
              pos.lastHarvestTier = tier.level;
              if (pos.qty < 0.0001) {
                if (enableWeights) weightState = updateWeightsAfterTrade(weightState, pos.entrySignals, pnl > 0);
                positions.delete(sym);
              }
              tradeSnapshots.push({ timestamp: tick, action: 'SELL', symbol: sym, price, regime: currentRegime, confluenceScore: confluence, timeframeAligned: aligned, volumeConfirmed, indicatorSignals, pnl, holdCandles: pos.candlesHeld });
              trades.push(makeTrade(tick, 'SELL', sym, sellUSD, price,
                `PROFIT_T${tier.level} (${gainPct.toFixed(1)}%)`, calcPortfolioValue(cash, positions, lastKnown), pnl, confluence));
              harvested = true;
              break;
            }
          }
          if (harvested) continue;

          // 4. Confluence sell signal
          if (confluence <= effectiveParams.confluenceSellThreshold) {
            const sellQty = pos.qty * 0.5;
            const sellUSD = sellQty * price;
            const pnl = sellQty * (price - pos.costBasis);
            cash += sellUSD;
            pos.qty -= sellQty;
            if (pos.qty < 0.0001) {
              if (enableWeights) weightState = updateWeightsAfterTrade(weightState, pos.entrySignals, pnl > 0);
              positions.delete(sym);
            }
            tradeSnapshots.push({ timestamp: tick, action: 'SELL', symbol: sym, price, regime: currentRegime, confluenceScore: confluence, timeframeAligned: aligned, volumeConfirmed, indicatorSignals, pnl, holdCandles: pos.candlesHeld });
            trades.push(makeTrade(tick, 'SELL', sym, sellUSD, price,
              `SIGNAL_SELL (conf=${Math.round(confluence)})`, calcPortfolioValue(cash, positions, lastKnown), pnl, confluence));
            continue;
          }
        }
      }

      // === BUY LOGIC ===
      const currentPortfolio = calcPortfolioValue(cash, positions, lastKnown);
      if (currentPortfolio > equityPeak) equityPeak = currentPortfolio;
      const drawdownPct = equityPeak > 0 ? ((equityPeak - currentPortfolio) / equityPeak) * 100 : 0;
      if (drawdownPct >= DRAWDOWN_PAUSE_PCT) buyingPaused = true;
      if (buyingPaused && drawdownPct < DRAWDOWN_RESUME_PCT) buyingPaused = false;

      // L5: Volume as soft signal — boost/dampen confluence instead of hard gate
      if (enableVolume && candles) {
        const volSignal = analyzeVolume(candles, idx - 1);
        volumeConfirmed = volSignal.confirmed;
        if (volSignal.confirmed) confluence = Math.min(100, confluence * 1.1); // +10% boost
        else if (volSignal.dryingUp) confluence = confluence * 0.85; // -15% dampening
      }

      if (!buyingPaused
        && confluence >= effectiveParams.confluenceBuyThreshold
        && cashPct >= effectiveParams.cashDeployThreshold
        && (candlesProcessed - lastBuyTime) >= MIN_BUY_INTERVAL_CANDLES) {
        const currentPosValue = pos ? pos.qty * price : 0;
        const currentPosPct = portfolioValue > 0 ? (currentPosValue / portfolioValue) * 100 : 0;
        if (currentPosPct >= effectiveParams.maxPositionPercent) continue;

        // Dynamic Kelly sizing
        const sellTrades = trades.filter(t => t.action === 'SELL');
        let winRate = 0.50;
        let avgWinLoss = 1.2;
        if (sellTrades.length >= 10) {
          const wins = sellTrades.filter(t => t.realizedPnl > 0);
          const losses = sellTrades.filter(t => t.realizedPnl <= 0);
          winRate = wins.length / sellTrades.length;
          const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.realizedPnl, 0) / wins.length : 1;
          const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0) / losses.length) : 1;
          avgWinLoss = avgLoss > 0 ? avgWin / avgLoss : 1.5;
        }

        const kellyPct = Math.max(0, (winRate - (1 - winRate) / avgWinLoss) * effectiveParams.kellyFraction * 100);
        const sizePct = Math.min(kellyPct, effectiveParams.maxPositionPercent - currentPosPct);
        let sizeUSD = (sizePct / 100) * portfolioValue;
        sizeUSD = Math.min(sizeUSD, cash);
        if (sizeUSD < effectiveParams.minPositionUSD) continue;

        const qty = sizeUSD / price;
        cash -= sizeUSD;

        if (pos) {
          const totalQty = pos.qty + qty;
          pos.costBasis = (pos.qty * pos.costBasis + sizeUSD) / totalQty;
          pos.qty = totalQty;
          pos.peakPrice = Math.max(pos.peakPrice, price);
        } else {
          positions.set(sym, {
            qty, costBasis: price, entryTime: tick, peakPrice: price,
            lastHarvestTier: 0, candlesHeld: 0,
            entryRegime: currentRegime, entrySignals: { ...indicatorSignals },
            entryConfluence: confluence,
          });
        }

        lastBuyTime = candlesProcessed;

        tradeSnapshots.push({
          timestamp: tick, action: 'BUY', symbol: sym, price,
          regime: currentRegime, confluenceScore: confluence,
          timeframeAligned: aligned, volumeConfirmed,
          indicatorSignals,
        });

        trades.push(makeTrade(tick, 'BUY', sym, sizeUSD, price,
          `SIGNAL_BUY (conf=${Math.round(confluence)}, regime=${currentRegime})`,
          calcPortfolioValue(cash, positions, lastKnown), 0, confluence));
      }
    }

    equityCurve.push(calcPortfolioValue(cash, positions, lastKnown));
    equityTimestamps.push(tick);
  }

  // ============================================================================
  // COMPUTE RESULTS
  // ============================================================================

  // Convert AdaptivePosition map to simple Position map for computeMetrics
  const simplePositions = new Map<string, { qty: number; costBasis: number }>();
  for (const [sym, pos] of positions) {
    simplePositions.set(sym, { qty: pos.qty, costBasis: pos.costBasis });
  }

  const metrics = computeMetrics(
    strategy.startingCapital, cash, simplePositions as any,
    lastKnown, firstPrices, trades, equityCurve, symbols, timeline,
  );

  const conditionBreakdown = computeConditionBreakdownAdaptive(
    processedDatasets, config, trades, equityCurve, equityTimestamps,
  );

  return {
    metrics,
    trades,
    equityCurve,
    equityTimestamps,
    conditionBreakdown,
    replayDurationMs: Date.now() - startMs,
    candlesProcessed,
    regimeDistribution,
    finalWeights: weightState,
    tradeSnapshots,
    levelsEnabled: {
      multiTimeframe: enableMTF,
      regimeAdaptation: enableRegime,
      dynamicWeights: enableWeights,
      intelligentExits: enableExits,
      volumeIntel: enableVolume,
    },
  };
}

// ============================================================================
// TIMELINE BUILDER (same pattern as replay-engine)
// ============================================================================

function buildTimeline(
  datasets: HistoricalDataset[],
  config: AdaptiveReplayConfig,
): {
  timeline: number[];
  priceBySymbol: Map<string, Map<number, number>>;
  closePricesBySymbol: Map<string, number[]>;
  candlesBySymbol: Map<string, OHLCVCandle[]>;
  timestampIndexBySymbol: Map<string, Map<number, number>>;
} {
  const tickSet = new Set<number>();
  const priceBySymbol = new Map<string, Map<number, number>>();
  const closePricesBySymbol = new Map<string, number[]>();
  const candlesBySymbol = new Map<string, OHLCVCandle[]>();
  const timestampIndexBySymbol = new Map<string, Map<number, number>>();

  for (const ds of datasets) {
    const priceMap = new Map<number, number>();
    const closePrices: number[] = [];
    const candles: OHLCVCandle[] = [];
    const indexMap = new Map<number, number>();

    for (let j = 0; j < ds.candles.length; j++) {
      const candle = ds.candles[j];
      if (config.startTime && candle.timestamp < config.startTime) continue;
      if (config.endTime && candle.timestamp > config.endTime) continue;
      tickSet.add(candle.timestamp);
      priceMap.set(candle.timestamp, candle.close);
      closePrices.push(candle.close);
      candles.push(candle);
      indexMap.set(candle.timestamp, j + 1);
    }

    priceBySymbol.set(ds.symbol, priceMap);
    closePricesBySymbol.set(ds.symbol, closePrices);
    candlesBySymbol.set(ds.symbol, candles);
    timestampIndexBySymbol.set(ds.symbol, indexMap);
  }

  const timeline = [...tickSet].sort((a, b) => a - b);
  return { timeline, priceBySymbol, closePricesBySymbol, candlesBySymbol, timestampIndexBySymbol };
}

// ============================================================================
// CONDITION BREAKDOWN (duplicated from replay-engine since it's not exported)
// ============================================================================

function computeConditionBreakdownAdaptive(
  datasets: HistoricalDataset[],
  config: AdaptiveReplayConfig,
  trades: ReplayTrade[],
  equityCurve: number[],
  equityTimestamps: number[],
): ConditionBreakdown[] {
  if (datasets.length === 0 || datasets[0].candles.length < 20) return [];

  const candles = datasets[0].candles.filter(c => {
    if (config.startTime && c.timestamp < config.startTime) return false;
    if (config.endTime && c.timestamp > config.endTime) return false;
    return true;
  });

  const windowSize = 168;
  const conditionRanges: Array<{ condition: MarketCondition; startTime: number; endTime: number }> = [];

  for (let i = 0; i + windowSize <= candles.length; i += windowSize) {
    const window = candles.slice(i, i + windowSize);
    const condition = classifyWindow(window);
    conditionRanges.push({ condition, startTime: window[0].timestamp, endTime: window[window.length - 1].timestamp });
  }

  const conditionMap = new Map<MarketCondition, { trades: ReplayTrade[]; equityCurve: number[]; totalCandles: number; periodCount: number }>();
  for (const cond of ['BULL', 'BEAR', 'RANGING', 'VOLATILE'] as MarketCondition[]) {
    conditionMap.set(cond, { trades: [], equityCurve: [], totalCandles: 0, periodCount: 0 });
  }

  for (const range of conditionRanges) {
    const entry = conditionMap.get(range.condition)!;
    entry.periodCount++;
    entry.totalCandles += windowSize;
    for (const trade of trades) {
      if (trade.timestamp >= range.startTime && trade.timestamp <= range.endTime) entry.trades.push(trade);
    }
    for (let i = 0; i < equityTimestamps.length; i++) {
      if (equityTimestamps[i] >= range.startTime && equityTimestamps[i] <= range.endTime) entry.equityCurve.push(equityCurve[i]);
    }
  }

  const breakdowns: ConditionBreakdown[] = [];
  for (const [condition, data] of conditionMap) {
    if (data.equityCurve.length < 2) {
      breakdowns.push({ condition, metrics: emptyMetrics(), periodCount: data.periodCount, totalCandles: data.totalCandles });
      continue;
    }
    const startVal = data.equityCurve[0];
    const endVal = data.equityCurve[data.equityCurve.length - 1];
    const condReturn = endVal - startVal;
    const condReturnPct = startVal > 0 ? (condReturn / startVal) * 100 : 0;
    let peak = data.equityCurve[0], maxDD = 0, maxDDPct = 0;
    for (const v of data.equityCurve) {
      if (v > peak) peak = v;
      const dd = peak - v;
      if (dd > maxDD) { maxDD = dd; maxDDPct = peak > 0 ? (dd / peak) * 100 : 0; }
    }
    const sellTrades = data.trades.filter(t => t.action === 'SELL');
    const wins = sellTrades.filter(t => t.realizedPnl > 0);
    const losses = sellTrades.filter(t => t.realizedPnl <= 0);
    const winAmt = wins.reduce((s, t) => s + t.realizedPnl, 0);
    const lossAmt = Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0));
    breakdowns.push({
      condition,
      metrics: {
        totalReturn: condReturn, totalReturnPct: condReturnPct, maxDrawdown: maxDD, maxDrawdownPct: maxDDPct,
        winRate: sellTrades.length > 0 ? wins.length / sellTrades.length : 0,
        totalTrades: data.trades.length, winningTrades: wins.length, losingTrades: losses.length,
        profitFactor: lossAmt > 0 ? winAmt / lossAmt : winAmt > 0 ? Infinity : 0,
        avgWin: wins.length > 0 ? winAmt / wins.length : 0, avgLoss: losses.length > 0 ? lossAmt / losses.length : 0,
        sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0, holdBaseline: 0, holdBaselinePct: 0, avgTradesPerMonth: 0,
      },
      periodCount: data.periodCount, totalCandles: data.totalCandles,
    });
  }
  return breakdowns;
}

// ============================================================================
// HELPERS
// ============================================================================

function calcPortfolioValue(cash: number, positions: Map<string, AdaptivePosition>, prices: Map<string, number>): number {
  let total = cash;
  for (const [token, pos] of positions) {
    total += pos.qty * (prices.get(token) || pos.costBasis);
  }
  return total;
}

function makeTrade(timestamp: number, action: 'BUY' | 'SELL', symbol: string, amountUSD: number, price: number, reason: string, portfolioValueAfter: number, realizedPnl: number, confluenceScore: number): ReplayTrade {
  return { timestamp, action, symbol, amountUSD, price, reason, portfolioValueAfter, realizedPnl, confluenceScore };
}

function emptyMetrics(): PerformanceMetrics {
  return { totalReturn: 0, totalReturnPct: 0, maxDrawdown: 0, maxDrawdownPct: 0, winRate: 0, totalTrades: 0, winningTrades: 0, losingTrades: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0, holdBaseline: 0, holdBaselinePct: 0, avgTradesPerMonth: 0 };
}

function emptyAdaptiveResult(capital: number, startMs: number, config: AdaptiveReplayConfig): AdaptiveReplayResult {
  return {
    metrics: { ...emptyMetrics(), holdBaseline: capital },
    trades: [], equityCurve: [capital], equityTimestamps: [Date.now()],
    conditionBreakdown: [], replayDurationMs: Date.now() - startMs, candlesProcessed: 0,
    regimeDistribution: { TRENDING: 0, RANGING: 0, VOLATILE: 0, BREAKOUT: 0 },
    finalWeights: createDynamicWeightState(),
    tradeSnapshots: [],
    levelsEnabled: {
      multiTimeframe: config.enableMultiTimeframe !== false,
      regimeAdaptation: config.enableRegimeAdaptation !== false,
      dynamicWeights: config.enableDynamicWeights !== false,
      intelligentExits: config.enableIntelligentExits !== false,
      volumeIntel: config.enableVolumeIntel !== false,
    },
  };
}
