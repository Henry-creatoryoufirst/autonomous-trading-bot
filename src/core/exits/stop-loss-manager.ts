/**
 * Never Rest Capital — Stop Loss Manager
 * Extracted from agent-v3.2.ts (Phase 2 refactor)
 *
 * Cost-basis stop loss + trailing stop from peak.
 * Uses ATR-dynamic stops when indicator data available.
 */

import { ATR_COMPARISON_LOG_COUNT, SECTOR_STOP_LOSS_OVERRIDES } from '../config/constants.js';
import type { TechnicalIndicators } from '../../algorithm/indicators.js';

// ============================================================================
// TYPES
// ============================================================================

interface BalanceEntry {
  symbol: string;
  balance: number;
  usdValue: number;
  price?: number;
  sector?: string;
}

interface StopLossConfig {
  enabled: boolean;
  minHoldingUSD: number;
  sellPercent: number;
  trailingEnabled: boolean;
}

interface TradeDecision {
  action: 'SELL';
  fromToken: string;
  toToken: string;
  amountUSD: number;
  tokenAmount?: number;
  reasoning: string;
  sector?: string;
}

export interface StopLossDeps {
  state: {
    costBasis: Record<string, any>;
    stopLossCooldowns: Record<string, string>;
    adaptiveThresholds: { stopLossPercent: number; trailingStopPercent: number };
    tradeHistory: Array<{ toToken?: string; action: string; success?: boolean; reasoning?: string; timestamp: string }>;
  };
  config: { stopLoss: StopLossConfig };
  tokenRegistry: Record<string, any>;
  isTokenBlocked: (symbol: string) => boolean;
  computeAtrStopLevels: (symbol: string, sector: string | undefined, atrPct: number | null, currentPrice: number, cb: any) => any;
}

let atrComparisonLogCount = 0;

// ============================================================================
// STOP LOSS CHECK
// ============================================================================

export function checkStopLoss(
  balances: BalanceEntry[],
  indicators: Record<string, TechnicalIndicators>,
  deps: StopLossDeps,
): TradeDecision | null {
  const { state, config, tokenRegistry, isTokenBlocked, computeAtrStopLevels } = deps;
  if (!config.stopLoss.enabled) return null;

  const cfg = config.stopLoss;
  let worstLoss = 0;
  let worstDecision: TradeDecision | null = null;

  for (const b of balances) {
    if (b.symbol === "USDC" || b.usdValue < cfg.minHoldingUSD) continue;
    if (!tokenRegistry[b.symbol]) continue;
    if (isTokenBlocked(b.symbol)) continue;
    const cb = state.costBasis[b.symbol];
    if (!cb || cb.averageCostBasis <= 0) continue;

    // 24h cooldown after stop-loss fires
    const lastStopLoss = state.stopLossCooldowns[b.symbol];
    if (lastStopLoss) {
      const hoursSince = (Date.now() - new Date(lastStopLoss).getTime()) / (1000 * 60 * 60);
      if (hoursSince < 24) continue;
    }

    // FORCED_DEPLOY cooldown — 2h grace period
    const recentBuy = state.tradeHistory.find(t =>
      t.toToken === b.symbol && t.action === 'BUY' && t.success !== false
    );
    if (recentBuy && (recentBuy.reasoning?.includes('FORCED_DEPLOY') || recentBuy.reasoning?.includes('SCOUT'))) {
      const hoursSinceBuy = (Date.now() - new Date(recentBuy.timestamp).getTime()) / (1000 * 60 * 60);
      if (hoursSinceBuy < 2) continue;
    }

    const currentPrice = b.price || (b.balance > 0 ? b.usdValue / b.balance : 0);
    const lossFromCost = ((currentPrice - cb.averageCostBasis) / cb.averageCostBasis) * 100;

    let trailingLoss = 0;
    if (cfg.trailingEnabled && cb.peakPrice > 0) {
      trailingLoss = ((currentPrice - cb.peakPrice) / cb.peakPrice) * 100;
    }

    // ATR-based dynamic stops
    const ind = indicators[b.symbol];
    const atrPct = ind?.atrPercent ?? null;
    const atrLevels = computeAtrStopLevels(b.symbol, b.sector, atrPct, currentPrice, cb);

    if (atrLevels) {
      cb.atrStopPercent = atrLevels.stopPercent;
      cb.atrTrailPercent = atrLevels.trailPercent;
      cb.trailActivated = atrLevels.trailActivated;
      cb.lastAtrUpdate = new Date().toISOString();
      if (cb.atrAtEntry === null && atrPct !== null) cb.atrAtEntry = atrPct;
    }

    // Effective thresholds (adaptive flat + sector overrides + ATR)
    let effectiveSL = state.adaptiveThresholds.stopLossPercent;
    let effectiveTrailing = state.adaptiveThresholds.trailingStopPercent;

    const sectorOverride = b.sector ? (SECTOR_STOP_LOSS_OVERRIDES as any)[b.sector] : undefined;
    if (sectorOverride) {
      effectiveSL = Math.max(effectiveSL, sectorOverride.maxLoss);
      effectiveTrailing = Math.max(effectiveTrailing, sectorOverride.maxTrailing);
    }

    if (atrLevels) {
      effectiveSL = Math.max(effectiveSL, atrLevels.stopPercent);
      if (atrLevels.trailActivated) {
        effectiveTrailing = Math.max(effectiveTrailing, atrLevels.trailPercent);
      }

      if (atrComparisonLogCount < ATR_COMPARISON_LOG_COUNT) {
        console.log(`  [ATR-CMP] ${b.symbol}: ATR%=${atrPct?.toFixed(2)} | ATR-stop=${atrLevels.stopPercent.toFixed(1)}% vs flat=${state.adaptiveThresholds.stopLossPercent}% -> effective=${effectiveSL.toFixed(1)}% | trail=${atrLevels.trailPercent.toFixed(1)}% activated=${atrLevels.trailActivated}`);
        atrComparisonLogCount++;
      }
    }

    const costBasisTriggered = lossFromCost <= effectiveSL;
    const trailingTriggered = cfg.trailingEnabled && trailingLoss <= effectiveTrailing;
    const trailAllowed = !atrLevels || atrLevels.trailActivated;
    const triggered = costBasisTriggered || (trailingTriggered && trailAllowed);

    if (triggered && lossFromCost < worstLoss) {
      worstLoss = lossFromCost;
      const sellUSD = b.usdValue * (cfg.sellPercent / 100);
      const tokenAmount = b.balance * (cfg.sellPercent / 100);
      const stopType = atrLevels ? "ATR" : "FLAT";
      const reason = costBasisTriggered
        ? `Stop-loss(${stopType}): ${b.symbol} ${lossFromCost.toFixed(1)}% from cost $${cb.averageCostBasis.toFixed(4)} (effective: ${effectiveSL.toFixed(1)}%)`
        : `Trailing-stop(${stopType}): ${b.symbol} ${trailingLoss.toFixed(1)}% from peak $${cb.peakPrice.toFixed(4)} (effective: ${effectiveTrailing.toFixed(1)}%)`;

      worstDecision = {
        action: "SELL", fromToken: b.symbol, toToken: "USDC",
        amountUSD: sellUSD, tokenAmount,
        reasoning: `${reason}. Selling ${cfg.sellPercent}%.`,
        sector: b.sector,
      };
    }
  }

  if (worstDecision) {
    console.log(`\n  🛑 STOP-LOSS: ${worstDecision.fromToken} is DOWN ${worstLoss.toFixed(1)}%`);
    console.log(`     Selling ${cfg.sellPercent}% = ~$${worstDecision.amountUSD.toFixed(2)}`);
  }

  return worstDecision;
}
