/**
 * Flow Micro-Agent
 *
 * Focuses ONLY on: DEX buy/sell ratio, volume, trade count.
 * Pure math — no Claude API calls.
 * Weight: 25%
 */

import type { MicroAgentInput, MicroAgentVote, SwarmAction } from '../agent-framework.js';
import { SWARM_AGENT_WEIGHTS } from '../../../config/constants.js';

export function flowAgent(input: MicroAgentInput): MicroAgentVote {
  const { buyRatio, volume24h, volumeSpike } = input.indicators;
  let score = 0;
  let confidence = 40;
  const reasons: string[] = [];

  // Buy ratio is the primary signal
  if (buyRatio !== undefined) {
    if (buyRatio > 65) {
      score += 3;
      confidence += 20;
      reasons.push(`Strong buying pressure (${buyRatio.toFixed(0)}% buy)`);
    } else if (buyRatio > 55) {
      score += 1;
      confidence += 10;
      reasons.push(`Net buying (${buyRatio.toFixed(0)}% buy)`);
    } else if (buyRatio < 30) {
      score -= 3;
      confidence += 20;
      reasons.push(`Heavy selling pressure (${buyRatio.toFixed(0)}% buy)`);
    } else if (buyRatio < 40) {
      score -= 1;
      confidence += 10;
      reasons.push(`Net selling (${buyRatio.toFixed(0)}% buy)`);
    } else {
      reasons.push(`Balanced flow (${buyRatio.toFixed(0)}% buy)`);
    }
  } else {
    // No flow data — low confidence
    confidence -= 20;
    reasons.push('No order flow data');
  }

  // Volume context — high volume validates the signal
  if (volumeSpike !== undefined) {
    if (volumeSpike > 2.0) {
      confidence += 15;
      reasons.push(`High volume (${volumeSpike.toFixed(1)}x avg)`);
    } else if (volumeSpike > 1.5) {
      confidence += 8;
    } else if (volumeSpike < 0.5) {
      confidence -= 10;
      reasons.push('Very low volume');
    }
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
    agent: 'flow',
    action,
    confidence,
    reasoning: reasons.length > 0 ? reasons.join('; ') : 'No flow data available',
    weight: SWARM_AGENT_WEIGHTS.flow,
  };
}
