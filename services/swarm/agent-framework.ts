/**
 * Multi-Agent Swarm Framework
 *
 * Runs specialized micro-agents in parallel on the same market data,
 * aggregates their weighted votes, and returns a consensus decision.
 * NO Claude API calls — pure math, fast, free, deterministic.
 */

import { SWARM_AGENT_WEIGHTS, SWARM_ACTION_SCORES, SWARM_SCORE_THRESHOLDS } from '../../config/constants.js';

// ============================================================================
// INTERFACES
// ============================================================================

export interface MicroAgentInput {
  token: string;
  price: number;
  indicators: {
    rsi?: number;
    macd?: string;
    bollingerSignal?: string;
    buyRatio?: number;
    previousBuyRatio?: number;   // v17.0: buy ratio from previous cycle for flow direction
    volume24h?: number;
    volumeSpike?: number;
    tradeCount?: number;         // v17.0: number of swaps in flow window
    adx?: number;
    atr?: number;
    price24hChange?: number;
    priceDistanceFromHigh?: number;  // v17.0: % below 30-day high (negative number, e.g. -15 = 15% below high)
  };
  portfolio: {
    totalValue: number;
    cashPercent: number;
    positionSize?: number;
    positionGainPct?: number;
    costBasis?: number;
    sectorAllocation?: Record<string, number>;
  };
  market: {
    fearGreedIndex: number;
    btc24hChange: number;
    eth24hChange: number;
    regime: string;
  };
}

export type SwarmAction = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';

export interface MicroAgentVote {
  agent: string;
  action: SwarmAction;
  confidence: number;  // 0-100
  reasoning: string;
  weight: number;      // how much this agent's vote counts
}

export interface SwarmDecision {
  token: string;
  finalAction: SwarmAction;
  totalScore: number;
  votes: MicroAgentVote[];
  consensus: number;   // % agreement among agents
}

export type MicroAgentFn = (input: MicroAgentInput) => MicroAgentVote;

// ============================================================================
// FRAMEWORK
// ============================================================================

/**
 * Run all micro-agents on a single token input, aggregate votes, return decision.
 */
export function runAgents(agents: MicroAgentFn[], input: MicroAgentInput): SwarmDecision {
  const votes = agents.map(agent => agent(input));

  // Weighted score: action numeric value * weight * (confidence / 100)
  let weightedSum = 0;
  let totalWeight = 0;

  for (const vote of votes) {
    const actionScore = SWARM_ACTION_SCORES[vote.action] ?? 0;
    const w = vote.weight * (vote.confidence / 100);
    weightedSum += actionScore * w;
    totalWeight += w;
  }

  const totalScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Map score to final action
  let finalAction: SwarmAction;
  if (totalScore >= SWARM_SCORE_THRESHOLDS.STRONG_BUY) finalAction = 'STRONG_BUY';
  else if (totalScore >= SWARM_SCORE_THRESHOLDS.BUY) finalAction = 'BUY';
  else if (totalScore <= SWARM_SCORE_THRESHOLDS.STRONG_SELL) finalAction = 'STRONG_SELL';
  else if (totalScore <= SWARM_SCORE_THRESHOLDS.SELL) finalAction = 'SELL';
  else finalAction = 'HOLD';

  // Consensus: % of agents that agree with the final direction
  const finalDirection = finalAction === 'HOLD' ? 'HOLD'
    : (finalAction === 'BUY' || finalAction === 'STRONG_BUY') ? 'BULLISH' : 'BEARISH';

  let agreeCount = 0;
  for (const vote of votes) {
    const voteDir = vote.action === 'HOLD' ? 'HOLD'
      : (vote.action === 'BUY' || vote.action === 'STRONG_BUY') ? 'BULLISH' : 'BEARISH';
    if (voteDir === finalDirection) agreeCount++;
  }
  const consensus = votes.length > 0 ? Math.round((agreeCount / votes.length) * 100) : 0;

  return {
    token: input.token,
    finalAction,
    totalScore: Math.round(totalScore * 1000) / 1000,
    votes,
    consensus,
  };
}
