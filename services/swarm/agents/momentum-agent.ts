/**
 * Momentum Micro-Agent v17.0
 *
 * Focuses on: RSI, MACD, Bollinger, price momentum, volume spikes,
 * price distance from 30-day high, capitulation buy detection.
 * Pure math — no Claude API calls.
 * Weight: 30%
 */

import type { MicroAgentInput, MicroAgentVote, SwarmAction } from '../agent-framework.js';
import { SWARM_AGENT_WEIGHTS } from '../../../config/constants.js';

export function momentumAgent(input: MicroAgentInput): MicroAgentVote {
  const { rsi, macd, bollingerSignal, volumeSpike, price24hChange, priceDistanceFromHigh } = input.indicators;
  let score = 0;
  let confidence = 50;
  const reasons: string[] = [];

  // RSI signals — v16.0: MACD trend filter prevents buying falling knives
  if (rsi !== undefined) {
    const macdIsBearish = macd === 'BEARISH';
    if (rsi < 25) {
      if (macdIsBearish) {
        // P0-3: RSI deeply oversold but MACD bearish — falling knife, do NOT buy
        score += 0; // neutral, no buy signal
        confidence += 10;
        reasons.push(`RSI deeply oversold (${rsi.toFixed(0)}) but MACD bearish — waiting for trend confirmation`);
      } else {
        score += 3; confidence += 15; reasons.push(`RSI deeply oversold (${rsi.toFixed(0)}) with MACD confirmation`);
      }
    }
    else if (rsi < 30) {
      if (macdIsBearish) {
        score += 0;
        confidence += 5;
        reasons.push(`RSI oversold (${rsi.toFixed(0)}) but MACD bearish — waiting for trend confirmation`);
      } else {
        score += 2; confidence += 10; reasons.push(`RSI oversold (${rsi.toFixed(0)}) with MACD non-bearish`);
      }
    }
    else if (rsi < 35) { score += 1; confidence += 8; reasons.push(`RSI oversold (${rsi.toFixed(0)})`); }
    else if (rsi > 80) { score -= 3; confidence += 15; reasons.push(`RSI extremely overbought (${rsi.toFixed(0)})`); }
    else if (rsi > 70) { score -= 2; confidence += 10; reasons.push(`RSI overbought (${rsi.toFixed(0)})`); }
  } else {
    confidence -= 15;
  }

  // MACD signals
  if (macd) {
    if (macd === 'BULLISH') { score += 1; confidence += 5; reasons.push('MACD bullish crossover'); }
    else if (macd === 'BEARISH') { score -= 1; confidence += 5; reasons.push('MACD bearish crossover'); }
  }

  // Bollinger Band signals
  if (bollingerSignal) {
    if (bollingerSignal === 'OVERSOLD') { score += 1; confidence += 5; reasons.push('BB oversold'); }
    else if (bollingerSignal === 'OVERBOUGHT') { score -= 1; confidence += 5; reasons.push('BB overbought'); }
  }

  // Volume spike amplifies conviction
  if (volumeSpike !== undefined) {
    if (volumeSpike > 2) { confidence += 10; reasons.push(`Volume spike ${volumeSpike.toFixed(1)}x`); }
    else if (volumeSpike < 0.5) { confidence -= 5; reasons.push('Low volume'); }
  }

  // === v17.0: Price distance from 30-day high ===
  if (priceDistanceFromHigh !== undefined) {
    if (priceDistanceFromHigh > -5) {
      // Within 5% of 30-day high — already expensive, less aggressive
      score -= 1;
      confidence += 5;
      reasons.push(`Near 30d high (${priceDistanceFromHigh.toFixed(1)}% from peak) — already expensive`);
    } else if (priceDistanceFromHigh < -20 && macd !== 'BEARISH') {
      // > 20% below 30-day high AND MACD not bearish → deep value + trend reversal
      score += 2;
      confidence += 12;
      reasons.push(`Deep value: ${priceDistanceFromHigh.toFixed(1)}% below 30d high with MACD ${macd || 'neutral'} — potential trend reversal`);
    } else if (priceDistanceFromHigh < -15) {
      // Significant discount from high
      reasons.push(`${priceDistanceFromHigh.toFixed(1)}% below 30d high`);
    }
  }

  // === v17.0: Capitulation buy detection ===
  // Down > 5% in 24h with volume spike = potential capitulation buy IF MACD is neutral/bullish
  if (price24hChange !== undefined) {
    if (price24hChange < -5 && volumeSpike !== undefined && volumeSpike > 2.0 && macd !== 'BEARISH') {
      score += 2;
      confidence += 10;
      reasons.push(`Capitulation setup: ${price24hChange.toFixed(1)}% 24h drop + ${volumeSpike.toFixed(1)}x volume + MACD ${macd || 'neutral'}`);
    } else if (price24hChange > 5) {
      score += 1;
      reasons.push(`Strong momentum +${price24hChange.toFixed(1)}%`);
    } else if (price24hChange < -5) {
      score -= 1;
      reasons.push(`Negative momentum ${price24hChange.toFixed(1)}%`);
    }
  }

  // Map score to action
  let action: SwarmAction;
  if (score >= 4) action = 'STRONG_BUY';
  else if (score >= 2) action = 'BUY';
  else if (score <= -4) action = 'STRONG_SELL';
  else if (score <= -2) action = 'SELL';
  else action = 'HOLD';

  confidence = Math.max(10, Math.min(100, confidence));

  return {
    agent: 'momentum',
    action,
    confidence,
    reasoning: reasons.length > 0 ? reasons.join('; ') : 'No clear momentum signals',
    weight: SWARM_AGENT_WEIGHTS.momentum,
  };
}
