/**
 * Flow Micro-Agent v17.0
 *
 * Focuses on: DEX buy/sell ratio, volume context, trade count, flow direction.
 * The most important agent — capital flow is the ground truth.
 * Pure math — no Claude API calls.
 * Weight: 25%
 */

import type { MicroAgentInput, MicroAgentVote, SwarmAction } from '../agent-framework.js';
import { SWARM_AGENT_WEIGHTS } from '../../../config/constants.js';

export function flowAgent(input: MicroAgentInput): MicroAgentVote {
  const { buyRatio, previousBuyRatio, volume24h, volumeSpike, tradeCount } = input.indicators;
  let score = 0;
  let confidence = 40;
  const reasons: string[] = [];

  // === v17.0: Volume context gate ===
  // Buy ratio is only meaningful with significant volume (> 50 trades in window)
  const hasSignificantVolume = tradeCount === undefined || tradeCount > 50;
  const hasThinVolume = tradeCount !== undefined && tradeCount < 50;

  // === v17.0: Volume dry-up check ===
  // If volume is < 0.5x average → HOLD regardless of ratio (thin market, unreliable signal)
  if (volumeSpike !== undefined && volumeSpike < 0.5) {
    confidence -= 20;
    reasons.push(`Volume dry-up (${volumeSpike.toFixed(2)}x avg) — thin market, signals unreliable`);
    // Don't return early — still calculate score but with very low confidence
  }

  // Buy ratio is the primary signal
  if (buyRatio !== undefined) {
    if (hasThinVolume) {
      // Low trade count — discount the signal heavily
      confidence -= 15;
      reasons.push(`Low trade count (${tradeCount} swaps) — buy ratio less reliable`);
    }

    if (buyRatio > 65) {
      score += 3;
      confidence += 20;
      reasons.push(`Strong buying pressure (${buyRatio.toFixed(0)}% buy)`);

      // === v17.0: Volume spike + strong buy ratio = STRONG_BUY ===
      // Money is rushing in — volume 2x+ AND buy ratio > 55%
      if (volumeSpike !== undefined && volumeSpike > 2.0 && hasSignificantVolume) {
        score += 1; // Boost to STRONG_BUY territory
        confidence += 10;
        reasons.push(`Volume spike ${volumeSpike.toFixed(1)}x + strong buy ratio — money rushing in`);
      }
    } else if (buyRatio > 55) {
      score += 1;
      confidence += 10;
      reasons.push(`Net buying (${buyRatio.toFixed(0)}% buy)`);

      // Volume spike with moderate buy ratio is still significant
      if (volumeSpike !== undefined && volumeSpike > 2.0 && hasSignificantVolume) {
        score += 1;
        confidence += 8;
        reasons.push(`Volume spike ${volumeSpike.toFixed(1)}x confirms buying pressure`);
      }
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

    // === v17.0: Flow DIRECTION — rate of change matters ===
    // If buy ratio was 60% last cycle and now 45%, that's DECELERATING
    if (previousBuyRatio !== undefined && buyRatio !== undefined) {
      const flowDelta = buyRatio - previousBuyRatio;

      if (flowDelta < -10) {
        // Sharp deceleration — flow reversing
        score -= 1;
        confidence += 8;
        reasons.push(`Flow decelerating sharply (${previousBuyRatio.toFixed(0)}% → ${buyRatio.toFixed(0)}%, delta ${flowDelta.toFixed(0)})`);
      } else if (flowDelta > 10) {
        // Sharp acceleration — flow strengthening
        score += 1;
        confidence += 8;
        reasons.push(`Flow accelerating (${previousBuyRatio.toFixed(0)}% → ${buyRatio.toFixed(0)}%, delta +${flowDelta.toFixed(0)})`);
      } else if (flowDelta < -5 && buyRatio < 50) {
        // Moderate deceleration into net selling territory
        reasons.push(`Flow decelerating (${previousBuyRatio.toFixed(0)}% → ${buyRatio.toFixed(0)}%) into sell territory`);
      }
    }
  } else {
    // No flow data — low confidence
    confidence -= 20;
    reasons.push('No order flow data');
  }

  // Volume context — high volume validates the signal (only if not already handled above)
  if (volumeSpike !== undefined && score === 0) {
    if (volumeSpike > 2.0) {
      confidence += 15;
      reasons.push(`High volume (${volumeSpike.toFixed(1)}x avg)`);
    } else if (volumeSpike > 1.5) {
      confidence += 8;
    }
  }

  // Map score to action
  let action: SwarmAction;
  if (score >= 4) action = 'STRONG_BUY';
  else if (score >= 1) action = 'BUY';
  else if (score <= -4) action = 'STRONG_SELL';
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
