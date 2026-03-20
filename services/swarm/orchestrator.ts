/**
 * Swarm Orchestrator
 *
 * Builds MicroAgentInput for each token from available market data,
 * runs all 5 micro-agents, aggregates votes, returns consensus decisions
 * sorted by signal strength.
 *
 * NO Claude API calls — pure deterministic math.
 */

import { runAgents, type MicroAgentInput, type SwarmDecision, type MicroAgentFn } from './agent-framework.js';
import { momentumAgent } from './agents/momentum-agent.js';
import { flowAgent } from './agents/flow-agent.js';
import { riskAgent } from './agents/risk-agent.js';
import { sentimentAgent } from './agents/sentiment-agent.js';
import { trendAgent } from './agents/trend-agent.js';

// ============================================================================
// DATA INTERFACES (match what agent-v3.2.ts provides)
// ============================================================================

export interface SwarmTokenData {
  symbol: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  sector: string;
  priceDistanceFromHigh?: number;  // v17.0: % below 30-day high (e.g. -15 = 15% below)
  previousBuyRatio?: number;       // v17.0: buy ratio from previous cycle
  indicators?: {
    rsi14?: number | null;
    macd?: { signal: string } | null;
    bollingerBands?: { signal: string } | null;
    volumeChange24h?: number | null;
    adx14?: { adx: number } | null;
    atrPercent?: number | null;
    orderFlow?: {
      buyVolumeUSD: number;
      sellVolumeUSD: number;
      tradeCount?: number;         // v17.0: number of swaps in flow window
    } | null;
  };
}

export interface SwarmPortfolioData {
  totalValue: number;
  cashPercent: number;
  positions: Record<string, {
    usdValue: number;
    gainPct?: number;
    costBasis?: number;
  }>;
  sectorAllocations: Record<string, number>;
}

export interface SwarmMarketData {
  fearGreedIndex: number;
  fearGreedClassification: string;
  btc24hChange: number;
  eth24hChange: number;
  regime: string;
}

// ============================================================================
// AGENT REGISTRY
// ============================================================================

const ALL_AGENTS: MicroAgentFn[] = [
  momentumAgent,
  flowAgent,
  riskAgent,
  sentimentAgent,
  trendAgent,
];

// ============================================================================
// ORCHESTRATOR
// ============================================================================

/**
 * Run the full swarm analysis across all tokens.
 * Returns SwarmDecision[] sorted by absolute score (strongest signals first).
 */
export function runSwarm(
  tokens: SwarmTokenData[],
  portfolio: SwarmPortfolioData,
  market: SwarmMarketData,
): SwarmDecision[] {
  const decisions: SwarmDecision[] = [];

  for (const token of tokens) {
    if (token.symbol === 'USDC' || token.symbol === 'WETH') continue;

    // Build MicroAgentInput from available data
    const ind = token.indicators;

    // Calculate buy ratio from order flow
    let buyRatio: number | undefined;
    let tradeCount: number | undefined;
    if (ind?.orderFlow) {
      const total = ind.orderFlow.buyVolumeUSD + ind.orderFlow.sellVolumeUSD;
      if (total > 0) {
        buyRatio = (ind.orderFlow.buyVolumeUSD / total) * 100;
      }
      tradeCount = ind.orderFlow.tradeCount;  // v17.0: pass trade count for volume context
    }

    // Calculate volume spike
    let volumeSpike: number | undefined;
    if (ind?.volumeChange24h !== null && ind?.volumeChange24h !== undefined) {
      volumeSpike = 1 + (ind.volumeChange24h / 100);
    }

    // Get position data
    const position = portfolio.positions[token.symbol];

    const input: MicroAgentInput = {
      token: token.symbol,
      price: token.price,
      indicators: {
        rsi: ind?.rsi14 ?? undefined,
        macd: ind?.macd?.signal ?? undefined,
        bollingerSignal: ind?.bollingerBands?.signal ?? undefined,
        buyRatio,
        previousBuyRatio: token.previousBuyRatio,  // v17.0: flow direction tracking
        volume24h: token.volume24h,
        volumeSpike,
        tradeCount,                                  // v17.0: volume context for flow agent
        adx: ind?.adx14?.adx ?? undefined,
        atr: ind?.atrPercent !== null && ind?.atrPercent !== undefined
          ? (ind.atrPercent / 100) * token.price : undefined,
        price24hChange: token.priceChange24h,
        priceDistanceFromHigh: token.priceDistanceFromHigh,  // v17.0: distance from 30d high
      },
      portfolio: {
        totalValue: portfolio.totalValue,
        cashPercent: portfolio.cashPercent,
        positionSize: position?.usdValue,
        positionGainPct: position?.gainPct,
        costBasis: position?.costBasis,
        sectorAllocation: portfolio.sectorAllocations,
      },
      market: {
        fearGreedIndex: market.fearGreedIndex,
        btc24hChange: market.btc24hChange,
        eth24hChange: market.eth24hChange,
        regime: market.regime,
      },
    };

    const decision = runAgents(ALL_AGENTS, input);
    decisions.push(decision);
  }

  // Sort by absolute score (strongest signals first)
  decisions.sort((a, b) => Math.abs(b.totalScore) - Math.abs(a.totalScore));

  return decisions;
}

/**
 * Format a swarm decision as a human-readable string for Claude prompt injection.
 */
export function formatSwarmForPrompt(decisions: SwarmDecision[]): string {
  if (decisions.length === 0) return '';

  const lines = ['SWARM INTELLIGENCE (5 micro-agents voted):'];

  for (const d of decisions) {
    if (d.finalAction === 'HOLD' && Math.abs(d.totalScore) < 0.3) continue; // skip uninteresting HOLDs

    const voteBreakdown = d.votes
      .map(v => `${v.agent}: ${v.action} ${v.confidence}%`)
      .join(', ');

    lines.push(`  ${d.token}: ${d.finalAction} (score ${d.totalScore >= 0 ? '+' : ''}${d.totalScore.toFixed(2)}, ${d.consensus}% consensus) [${voteBreakdown}]`);
  }

  if (lines.length === 1) {
    lines.push('  All tokens show weak/mixed signals — no strong consensus.');
  }

  return lines.join('\n');
}

// Store latest decisions for the API endpoint
let latestSwarmDecisions: SwarmDecision[] = [];
let lastSwarmRunTime: Date | null = null;

export function getLatestSwarmDecisions(): SwarmDecision[] {
  return latestSwarmDecisions;
}

export function getLastSwarmRunTime(): Date | null {
  return lastSwarmRunTime;
}

export function setLatestSwarmDecisions(decisions: SwarmDecision[]): void {
  latestSwarmDecisions = decisions;
  lastSwarmRunTime = new Date();
}
