/**
 * Sentiment Micro-Agent
 *
 * Focuses ONLY on: Fear & Greed index, BTC/ETH 24h change, market regime.
 * Pure math — no Claude API calls.
 * Weight: 10%
 */

import type { MicroAgentInput, MicroAgentVote, SwarmAction } from '../agent-framework.js';
import { SWARM_AGENT_WEIGHTS } from '../../../config/constants.js';

export function sentimentAgent(input: MicroAgentInput): MicroAgentVote {
  const { fearGreedIndex, btc24hChange, eth24hChange, regime } = input.market;
  let score = 0;
  let confidence = 50;
  const reasons: string[] = [];

  // Fear & Greed — contrarian signals
  if (fearGreedIndex < 15) {
    // Extreme fear = opportunity, but only if BTC isn't in complete freefall
    if (btc24hChange > -8) {
      score += 3;
      confidence += 15;
      reasons.push(`Extreme fear (F&G ${fearGreedIndex}) — contrarian buy opportunity`);
    } else {
      score += 1;
      confidence += 5;
      reasons.push(`Extreme fear (F&G ${fearGreedIndex}) but BTC in freefall (${btc24hChange.toFixed(1)}%)`);
    }
  } else if (fearGreedIndex < 30) {
    if (btc24hChange > -5) {
      score += 1;
      confidence += 8;
      reasons.push(`Fear zone (F&G ${fearGreedIndex}) — buy opportunity`);
    }
  } else if (fearGreedIndex > 85) {
    score -= 3;
    confidence += 15;
    reasons.push(`Extreme greed (F&G ${fearGreedIndex}) — exit signal`);
  } else if (fearGreedIndex > 75) {
    score -= 1;
    confidence += 8;
    reasons.push(`Greed zone (F&G ${fearGreedIndex}) — take profits`);
  }

  // Market regime context
  if (regime === 'TRENDING_DOWN' || regime === 'VOLATILE') {
    score -= 1;
    reasons.push(`Market regime: ${regime}`);
  } else if (regime === 'TRENDING_UP') {
    score += 1;
    reasons.push('Market regime: uptrend');
  }

  // BTC + ETH as market barometers
  const avgMajorChange = (btc24hChange + eth24hChange) / 2;
  if (avgMajorChange > 5) {
    confidence += 5;
    reasons.push(`Majors rallying (avg +${avgMajorChange.toFixed(1)}%)`);
  } else if (avgMajorChange < -5) {
    confidence += 5;
    reasons.push(`Majors dropping (avg ${avgMajorChange.toFixed(1)}%)`);
  }

  // Map score to action
  let action: SwarmAction;
  if (score >= 3) action = 'STRONG_BUY';
  else if (score >= 1) action = 'BUY';
  else if (score <= -3) action = 'STRONG_SELL';
  else if (score <= -1) action = 'SELL';
  else action = 'HOLD';

  confidence = Math.max(10, Math.min(100, confidence));

  return {
    agent: 'sentiment',
    action,
    confidence,
    reasoning: reasons.length > 0 ? reasons.join('; ') : 'Neutral sentiment',
    weight: SWARM_AGENT_WEIGHTS.sentiment,
  };
}
