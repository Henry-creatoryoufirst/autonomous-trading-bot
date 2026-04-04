/**
 * Sentiment Micro-Agent v17.0
 *
 * Focuses on: BTC/ETH broad market momentum, market regime.
 * Fear & Greed is a MINOR modifier (context, not trigger).
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

  // === PRIMARY: BTC + ETH broad market momentum ===
  // This is the actual signal — where is capital flowing?
  if (btc24hChange > 5 && eth24hChange > 3) {
    // Broad market momentum — both majors moving up strongly
    score += 2;
    confidence += 15;
    reasons.push(`Broad market momentum (BTC +${btc24hChange.toFixed(1)}%, ETH +${eth24hChange.toFixed(1)}%) — capital flowing in`);
  } else if (btc24hChange < -8 && eth24hChange < -6) {
    // Market crash — don't catch a falling knife
    score -= 2;
    confidence += 15;
    reasons.push(`Market crash (BTC ${btc24hChange.toFixed(1)}%, ETH ${eth24hChange.toFixed(1)}%) — don't catch falling knife`);
  } else if (btc24hChange > 3 || eth24hChange > 3) {
    // One major moving up — mild bullish signal
    score += 1;
    confidence += 8;
    reasons.push(`Major moving up (BTC ${btc24hChange >= 0 ? '+' : ''}${btc24hChange.toFixed(1)}%, ETH ${eth24hChange >= 0 ? '+' : ''}${eth24hChange.toFixed(1)}%)`);
  } else if (btc24hChange < -5 || eth24hChange < -5) {
    // One major dropping hard — mild bearish
    score -= 1;
    confidence += 8;
    reasons.push(`Major dropping (BTC ${btc24hChange.toFixed(1)}%, ETH ${eth24hChange.toFixed(1)}%)`);
  } else if (btc24hChange > -3 && btc24hChange < 3) {
    // Ranging — no macro signal
    reasons.push(`Majors ranging (BTC ${btc24hChange >= 0 ? '+' : ''}${btc24hChange.toFixed(1)}%, ETH ${eth24hChange >= 0 ? '+' : ''}${eth24hChange.toFixed(1)}%) — no macro signal`);
  }

  // === Market regime context ===
  if (regime === 'TRENDING_DOWN' || regime === 'VOLATILE') {
    score -= 1;
    reasons.push(`Market regime: ${regime}`);
  } else if (regime === 'TRENDING_UP') {
    score += 1;
    reasons.push('Market regime: uptrend');
  }

  // === MINOR MODIFIER: Fear & Greed as context ===
  // F&G is information, not instruction. Extreme values reduce confidence slightly.
  if (fearGreedIndex < 20) {
    confidence -= 10;
    reasons.push(`F&G=${fearGreedIndex} (extreme fear) — reduced confidence 10%`);
  } else if (fearGreedIndex > 80) {
    confidence -= 10;
    reasons.push(`F&G=${fearGreedIndex} (extreme greed) — reduced confidence 10%`);
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
    agent: 'sentiment',
    action,
    confidence,
    reasoning: reasons.length > 0 ? reasons.join('; ') : 'Neutral sentiment',
    weight: SWARM_AGENT_WEIGHTS.sentiment,
  };
}
