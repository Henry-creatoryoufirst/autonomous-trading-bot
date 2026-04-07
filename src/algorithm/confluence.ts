/**
 * Never Rest Capital — Confluence Scoring Engine
 * Extracted from agent-v3.2.ts (Phase 1b refactor)
 *
 * calculateConfluence is parameterized to accept adaptive thresholds and
 * momentum data rather than reading module-level globals.
 */

import type { TechnicalIndicators } from './indicators.js';
import type { AdaptiveThresholds } from '../core/types/index.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ConfluenceContext {
  adaptiveThresholds: AdaptiveThresholds;
  /** BTC 24h momentum (%), used for major-momentum confluence boost */
  btcChange24h: number;
  /** ETH 24h momentum (%) */
  ethChange24h: number;
}

// ============================================================================
// CONFLUENCE SCORING
// ============================================================================

/**
 * Calculate overall signal from confluence of indicators.
 * Returns a score from -100 (strong sell) to +100 (strong buy).
 *
 * @param ctx  Runtime context (adaptive thresholds + momentum data)
 * @param twapDivThreshold  TWAP_DIVERGENCE_THRESHOLD_PCT from constants
 * @param twapMildThreshold  TWAP_MILD_THRESHOLD_PCT from constants
 */
export function calculateConfluence(
  rsi: number | null,
  macd: TechnicalIndicators["macd"],
  bb: TechnicalIndicators["bollingerBands"],
  trend: TechnicalIndicators["trendDirection"],
  priceChange24h: number,
  priceChange7d: number,
  adx: TechnicalIndicators["adx14"] = null,
  atr: { atr: number; atrPercent: number } | null = null,
  twapDivergence: TechnicalIndicators["twapDivergence"] = null,
  orderFlow: TechnicalIndicators["orderFlow"] = null,
  tickDepth: TechnicalIndicators["tickDepth"] = null,
  ctx: ConfluenceContext,
  twapDivThreshold: number,
  twapMildThreshold: number,
): { score: number; signal: TechnicalIndicators["overallSignal"] } {
  let score = 0;
  let signals = 0;

  // RSI (weight: 15, reduced from 25) — meta-learning: 6% accuracy on real data
  // RSI anti-predicts in trending crypto — oversold signals during pullbacks get stopped out
  if (rsi !== null) {
    signals++;
    const oversold = ctx.adaptiveThresholds.rsiOversold;
    const overbought = ctx.adaptiveThresholds.rsiOverbought;
    if (rsi < oversold) score += 15;
    else if (rsi < oversold + 10) score += 7;
    else if (rsi > overbought) score -= 15;
    else if (rsi > overbought - 10) score -= 7;
  }

  // MACD (weight: 25)
  if (macd) {
    signals++;
    if (macd.signal === "BULLISH") score += 25;
    else if (macd.signal === "BEARISH") score -= 25;
    if (Math.abs(macd.histogram) > Math.abs(macd.macdLine) * 0.3) {
      score += macd.histogram > 0 ? 5 : -5;
    }
  }

  // Bollinger Bands (weight: 12, reduced from 20) — meta-learning: 0% accuracy on real data
  // BB mean-reversion signals conflict with trending crypto markets
  if (bb) {
    signals++;
    if (bb.signal === "OVERSOLD") score += 12;
    else if (bb.signal === "OVERBOUGHT") score -= 12;
    else if (bb.signal === "SQUEEZE") score += 3;
    if (bb.percentB > 0.8 && bb.percentB <= 1) score -= 3;
    else if (bb.percentB < 0.2 && bb.percentB >= 0) score += 3;
  }

  // Trend (weight: 15)
  signals++;
  switch (trend) {
    case "STRONG_UP": score += 15; break;
    case "UP": score += 8; break;
    case "STRONG_DOWN": score -= 15; break;
    case "DOWN": score -= 8; break;
    default: break;
  }

  // Price momentum (weight: 22, increased from 15) — meta-learning: 95% accuracy
  // Momentum is the strongest predictor across all market conditions
  signals++;
  if (priceChange24h > 5) score += 12;
  else if (priceChange24h > 2) score += 6;
  else if (priceChange24h < -5) score -= 12;
  else if (priceChange24h < -2) score -= 6;

  if (priceChange7d > 10) score += 10;
  else if (priceChange7d > 3) score += 5;
  else if (priceChange7d < -10) score -= 10;
  else if (priceChange7d < -3) score -= 5;

  // ADX trend strength confirmation (weight: ±10 directional, increased from ±5) — 80% accuracy
  if (adx) {
    signals++;
    if (adx.adx > 30 && adx.plusDI > adx.minusDI) {
      score += 10;
    } else if (adx.adx > 30 && adx.minusDI > adx.plusDI) {
      score -= 10;
    }
    if (adx.adx < 15) {
      score = Math.round(score * 0.80);
    }
  }

  // v8.3: ATR volatility adjustment
  if (atr) {
    if (atr.atrPercent > 5) {
      score = Math.round(score * 0.85);
    } else if (atr.atrPercent < 1) {
      score = Math.round(score * 1.10);
    }
  }

  // v12.3: TWAP-Spot Divergence (weight: ±15)
  if (twapDivergence) {
    signals++;
    const div = twapDivergence.divergencePct;
    if (div < -twapDivThreshold) score += 15;
    else if (div < -twapMildThreshold) score += 8;
    else if (div > twapDivThreshold) score -= 15;
    else if (div > twapMildThreshold) score -= 8;
  }

  // v12.3: Order Flow CVD (weight: ±15)
  if (orderFlow) {
    signals++;
    if (orderFlow.signal === "STRONG_BUY") score += 15;
    else if (orderFlow.signal === "BUY") score += 8;
    else if (orderFlow.signal === "STRONG_SELL") score -= 15;
    else if (orderFlow.signal === "SELL") score -= 8;
    if (orderFlow.largeBuyPct > 50) score += 3;
    else if (orderFlow.largeBuyPct < 20 && (orderFlow.signal === "BUY" || orderFlow.signal === "STRONG_BUY")) {
      score -= 3;
    }

    // v14.0: "Catching Fire" signal
    const totalFlowVol = orderFlow.buyVolumeUSD + orderFlow.sellVolumeUSD;
    const buyRatio = totalFlowVol > 0 ? orderFlow.buyVolumeUSD / totalFlowVol : 0.5;
    if (buyRatio > 0.60 && orderFlow.tradeCount > 50) {
      score += 10;
    }

    // v14.0: Momentum reversal
    if (buyRatio < 0.45) {
      score -= 12;
    }
  }

  // v14.0: BTC/ETH strong momentum confluence boost
  const btc24hMom = ctx.btcChange24h ?? 0;
  const eth24hMom = ctx.ethChange24h ?? 0;
  if (btc24hMom >= 3 || eth24hMom >= 3) {
    score += 5;
  }

  // v12.3: Tick Liquidity Depth (weight: ±12)
  if (tickDepth) {
    signals++;
    if (tickDepth.signal === "STRONG_SUPPORT") score += 12;
    else if (tickDepth.signal === "SUPPORT") score += 6;
    else if (tickDepth.signal === "STRONG_RESISTANCE") score -= 12;
    else if (tickDepth.signal === "RESISTANCE") score -= 6;
  }

  // Normalize to -100 to +100
  const normalizedScore = Math.max(-100, Math.min(100, score));

  // Determine signal — uses adaptive thresholds
  const at = ctx.adaptiveThresholds;
  let signal: TechnicalIndicators["overallSignal"];
  if (normalizedScore >= at.confluenceStrongBuy) signal = "STRONG_BUY";
  else if (normalizedScore >= at.confluenceBuy) signal = "BUY";
  else if (normalizedScore <= at.confluenceStrongSell) signal = "STRONG_SELL";
  else if (normalizedScore <= at.confluenceSell) signal = "SELL";
  else signal = "NEUTRAL";

  return { score: normalizedScore, signal };
}
