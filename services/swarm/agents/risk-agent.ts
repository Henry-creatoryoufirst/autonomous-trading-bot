/**
 * Risk Micro-Agent
 *
 * Focuses ONLY on: position size, portfolio exposure, drawdown, ATR, cost basis.
 * Override: blocks all buys when Fear & Greed < 20 (extreme fear override).
 * Pure math — no Claude API calls.
 * Weight: 25%
 */

import type { MicroAgentInput, MicroAgentVote, SwarmAction } from '../agent-framework.js';
import { SWARM_AGENT_WEIGHTS } from '../../../config/constants.js';

export function riskAgent(input: MicroAgentInput): MicroAgentVote {
  const { portfolio, market, indicators } = input;
  let action: SwarmAction = 'HOLD';
  let confidence = 60;
  const reasons: string[] = [];

  // 1. Position loss check — stop-loss signal
  if (portfolio.positionGainPct !== undefined) {
    if (portfolio.positionGainPct < -10) {
      action = 'STRONG_SELL';
      confidence = 85;
      reasons.push(`Position down ${portfolio.positionGainPct.toFixed(1)}% from cost basis — stop-loss`);
      return { agent: 'risk', action, confidence, reasoning: reasons.join('; '), weight: SWARM_AGENT_WEIGHTS.risk };
    }
    if (portfolio.positionGainPct < -7) {
      action = 'SELL';
      confidence = 70;
      reasons.push(`Position down ${portfolio.positionGainPct.toFixed(1)}% — approaching stop-loss`);
    }
  }

  // 2. Concentration check — too much in one token
  if (portfolio.positionSize !== undefined && portfolio.totalValue > 0) {
    const positionPct = (portfolio.positionSize / portfolio.totalValue) * 100;
    if (positionPct > 20) {
      action = 'SELL';
      confidence = 70;
      reasons.push(`Position is ${positionPct.toFixed(0)}% of portfolio — too concentrated`);
    } else if (positionPct > 15) {
      reasons.push(`Position ${positionPct.toFixed(0)}% of portfolio — watching concentration`);
    }
  }

  // 3. Cash deployment — too much idle capital
  if (portfolio.cashPercent > 60 && market.fearGreedIndex >= 20) {
    action = 'BUY';
    confidence = 55;
    reasons.push(`Cash at ${portfolio.cashPercent.toFixed(0)}% — deploy idle capital`);
  } else if (portfolio.cashPercent > 40 && market.fearGreedIndex >= 30) {
    reasons.push(`Cash at ${portfolio.cashPercent.toFixed(0)}% — slightly overweight`);
  }

  // 4. ATR-based volatility awareness
  if (indicators.atr !== undefined && input.price > 0) {
    const atrPct = (indicators.atr / input.price) * 100;
    if (atrPct > 8) {
      confidence -= 10;
      reasons.push(`High volatility (ATR ${atrPct.toFixed(1)}%)`);
    }
  }

  // OVERRIDE: Extreme fear blocks ALL buys
  if (market.fearGreedIndex < 20) {
    if (action === 'BUY' || action === 'STRONG_BUY') {
      action = 'HOLD';
      confidence = 75;
      reasons.push(`Fear & Greed at ${market.fearGreedIndex} — extreme fear override, blocking buys`);
    }
  }

  if (reasons.length === 0) {
    reasons.push('Position within normal risk parameters');
  }

  confidence = Math.max(10, Math.min(100, confidence));

  return {
    agent: 'risk',
    action,
    confidence,
    reasoning: reasons.join('; '),
    weight: SWARM_AGENT_WEIGHTS.risk,
  };
}
