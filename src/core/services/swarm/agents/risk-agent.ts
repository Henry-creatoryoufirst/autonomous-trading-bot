/**
 * Risk Micro-Agent v17.0
 *
 * Focuses ONLY on: position size, portfolio exposure, drawdown, ATR, cost basis,
 * cash levels, and capital flow confirmation.
 * NO Fear & Greed overrides — decisions based on actual portfolio risk metrics.
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

  // 1. Position loss check — cut losers fast when flow confirms the loss
  if (portfolio.positionGainPct !== undefined) {
    if (portfolio.positionGainPct < -7) {
      // v17.0: Check if flow confirms the loss (buy ratio < 45% = sellers dominating)
      const buyRatio = indicators.buyRatio;
      if (buyRatio !== undefined && buyRatio < 45) {
        action = 'STRONG_SELL';
        confidence = 95;
        reasons.push(`Position down ${portfolio.positionGainPct.toFixed(1)}% AND buy ratio ${buyRatio.toFixed(0)}% confirms selling pressure — cut the loss`);
        return { agent: 'risk', action, confidence, reasoning: reasons.join('; '), weight: SWARM_AGENT_WEIGHTS.risk };
      } else {
        // Down 7%+ but flow is neutral/positive — still sell but less urgent
        action = 'SELL';
        confidence = 80;
        reasons.push(`Position down ${portfolio.positionGainPct.toFixed(1)}% from cost basis — approaching max loss${buyRatio !== undefined ? ` (buy ratio ${buyRatio.toFixed(0)}% not confirming reversal yet)` : ''}`);
      }
    }
    if (portfolio.positionGainPct < -4 && action !== 'SELL' && (action as SwarmAction) !== 'STRONG_SELL') {
      action = 'SELL';
      confidence = 75;
      reasons.push(`Position down ${portfolio.positionGainPct.toFixed(1)}% — approaching stop-loss`);
    }
  }

  // 2. Concentration check — too much in one token
  if (portfolio.positionSize !== undefined && portfolio.totalValue > 0) {
    const positionPct = (portfolio.positionSize / portfolio.totalValue) * 100;
    const isUnderwater = (portfolio.positionGainPct ?? 0) < 0;

    // Over 15% AND losing money = aggressive sell
    if (positionPct > 15 && isUnderwater) {
      action = 'STRONG_SELL';
      confidence = 85;
      reasons.push(`Position is ${positionPct.toFixed(0)}% of portfolio AND underwater — must trim`);
      return { agent: 'risk', action, confidence, reasoning: reasons.join('; '), weight: SWARM_AGENT_WEIGHTS.risk };
    }
    if (positionPct > 20) {
      action = 'SELL';
      confidence = 75;
      reasons.push(`Position is ${positionPct.toFixed(0)}% of portfolio — too concentrated`);
    } else if (positionPct > 15) {
      action = 'SELL';
      confidence = 65;
      reasons.push(`Position ${positionPct.toFixed(0)}% of portfolio — trimming concentration`);
    }
  }

  // 3. v17.0: Capital flow-based cash deployment — no F&G gating
  // Deploy idle capital when flow confirms real buying is happening
  if (portfolio.cashPercent > 70 && indicators.buyRatio !== undefined && indicators.buyRatio > 55) {
    // Heavy cash + confirmed buying flow → deploy into confirmed flow
    action = 'BUY';
    confidence = 65;
    reasons.push(`Cash at ${portfolio.cashPercent.toFixed(0)}% + buy ratio ${indicators.buyRatio.toFixed(0)}% confirms accumulation — deploy into flow`);
  } else if (portfolio.cashPercent > 70 && (indicators.buyRatio === undefined || indicators.buyRatio <= 50)) {
    // Heavy cash but no confirmed flow — stay patient
    reasons.push(`Cash at ${portfolio.cashPercent.toFixed(0)}% but buy ratio ${indicators.buyRatio !== undefined ? indicators.buyRatio.toFixed(0) + '%' : 'unknown'} — no confirmed flow, stay patient`);
  } else if (portfolio.cashPercent > 60) {
    // Moderately overweight cash — deploy if flow is positive
    if (indicators.buyRatio !== undefined && indicators.buyRatio > 50) {
      action = 'BUY';
      confidence = 55;
      reasons.push(`Cash at ${portfolio.cashPercent.toFixed(0)}% with positive flow (${indicators.buyRatio.toFixed(0)}% buy) — deploy idle capital`);
    } else {
      reasons.push(`Cash at ${portfolio.cashPercent.toFixed(0)}% — slightly overweight, watching flow`);
    }
  }

  // 4. ATR-based volatility awareness
  if (indicators.atr !== undefined && input.price > 0) {
    const atrPct = (indicators.atr / input.price) * 100;
    if (atrPct > 8) {
      confidence -= 10;
      reasons.push(`High volatility (ATR ${atrPct.toFixed(1)}%)`);
    }
  }

  // v17.0: NO F&G override — the risk agent judges risk based on portfolio metrics
  // (concentration, drawdown, cash levels, flow confirmation), not crowd sentiment

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
