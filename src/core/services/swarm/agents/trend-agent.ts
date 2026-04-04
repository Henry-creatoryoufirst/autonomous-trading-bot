/**
 * Trend Micro-Agent
 *
 * Focuses ONLY on: ADX, price change 24h, market regime, BTC dominance.
 * Pure math — no Claude API calls.
 * Weight: 10%
 */

import type { MicroAgentInput, MicroAgentVote, SwarmAction } from '../agent-framework.js';
import { SWARM_AGENT_WEIGHTS } from '../../../config/constants.js';

export function trendAgent(input: MicroAgentInput): MicroAgentVote {
  const { adx, price24hChange } = input.indicators;
  const { regime, btc24hChange } = input.market;
  let score = 0;
  let confidence = 45;
  const reasons: string[] = [];

  // ADX trend strength + price direction
  if (adx !== undefined) {
    if (adx > 30) {
      // Strong trend — direction matters
      confidence += 15;
      if (price24hChange !== undefined && price24hChange > 3) {
        score += 3;
        reasons.push(`Strong uptrend (ADX ${adx.toFixed(0)}, price +${price24hChange.toFixed(1)}%)`);
      } else if (price24hChange !== undefined && price24hChange < -3) {
        score -= 3;
        reasons.push(`Strong downtrend (ADX ${adx.toFixed(0)}, price ${price24hChange.toFixed(1)}%)`);
      } else if (price24hChange !== undefined && price24hChange > 0) {
        score += 1;
        reasons.push(`Mild uptrend (ADX ${adx.toFixed(0)})`);
      } else if (price24hChange !== undefined && price24hChange < 0) {
        score -= 1;
        reasons.push(`Mild downtrend (ADX ${adx.toFixed(0)})`);
      }
    } else if (adx > 20) {
      // Weak trend
      confidence += 5;
      if (price24hChange !== undefined && price24hChange > 2) {
        score += 1;
        reasons.push(`Emerging uptrend (ADX ${adx.toFixed(0)})`);
      } else if (price24hChange !== undefined && price24hChange < -2) {
        score -= 1;
        reasons.push(`Emerging downtrend (ADX ${adx.toFixed(0)})`);
      }
    } else {
      // ADX < 20 — ranging market
      reasons.push(`Ranging market (ADX ${adx.toFixed(0)}) — no clear trend`);
      confidence -= 10;
    }
  } else {
    confidence -= 15;
    reasons.push('No ADX data');
  }

  // Market regime alignment
  if (regime === 'TRENDING_UP' && score > 0) {
    confidence += 5;
  } else if (regime === 'TRENDING_DOWN' && score < 0) {
    confidence += 5;
  } else if (regime === 'VOLATILE') {
    confidence -= 5;
    reasons.push('Volatile regime — trend unreliable');
  }

  // BTC trend context — if token trend aligns with BTC, higher conviction
  if (btc24hChange > 3 && score > 0) {
    confidence += 5;
  } else if (btc24hChange < -3 && score < 0) {
    confidence += 5;
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
    agent: 'trend',
    action,
    confidence,
    reasoning: reasons.length > 0 ? reasons.join('; ') : 'No trend data',
    weight: SWARM_AGENT_WEIGHTS.trend,
  };
}
