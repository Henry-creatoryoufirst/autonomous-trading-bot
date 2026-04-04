/**
 * Never Rest Capital — Market Data & Intelligence Types
 * Extracted from agent-v3.2.ts (Phase 3b refactor)
 */

import type { TechnicalIndicators } from '../src/algorithm/indicators.js';
import type { MarketRegime } from './index.js';
import type { DefiLlamaData, DerivativesData, AltseasonSignal, SmartRetailDivergence, FundingRateMeanReversion, TVLPriceDivergence } from '../src/algorithm/market-analysis.js';

// ============================================================================
// NEWS & SENTIMENT
// ============================================================================

export interface NewsSentimentData {
  overallSentiment: "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";
  bullishCount: number;
  bearishCount: number;
  totalCount: number;
  sentimentScore: number;
  topHeadlines: { title: string; sentiment: string; source: string }[];
  tokenMentions: Record<string, { bullish: number; bearish: number; neutral: number }>;
  lastUpdated: string;
}

// ============================================================================
// MACRO ECONOMICS
// ============================================================================

export interface MacroData {
  fedFundsRate: { value: number; date: string } | null;
  treasury10Y: { value: number; date: string } | null;
  yieldCurve: { value: number; date: string } | null;
  cpi: { value: number; date: string; yoyChange: number | null } | null;
  m2MoneySupply: { value: number; date: string; yoyChange: number | null } | null;
  dollarIndex: { value: number; date: string } | null;
  macroSignal: "RISK_ON" | "RISK_OFF" | "NEUTRAL";
  rateDirection: "HIKING" | "CUTTING" | "PAUSED";
  crossAssets: {
    goldPrice: number | null;
    goldChange24h: number | null;
    oilPrice: number | null;
    oilChange24h: number | null;
    dxyRealtime: number | null;
    dxyChange24h: number | null;
    sp500Change: number | null;
    vixLevel: number | null;
    crossAssetSignal: "RISK_ON" | "RISK_OFF" | "FLIGHT_TO_SAFETY" | "NEUTRAL";
  } | null;
}

// ============================================================================
// GLOBAL MARKET DATA
// ============================================================================

export interface GlobalMarketData {
  btcDominance: number;
  ethDominance: number;
  totalMarketCap: number;
  totalVolume24h: number;
  defiMarketCap: number | null;
  defiVolume24h: number | null;
  btcDominanceChange7d: number;
  altseasonSignal: AltseasonSignal;
  lastUpdated: string;
}

// ============================================================================
// STABLECOIN SUPPLY
// ============================================================================

export interface StablecoinSupplyData {
  usdtMarketCap: number;
  usdcMarketCap: number;
  totalStablecoinSupply: number;
  supplyChange7d: number;
  signal: "CAPITAL_INFLOW" | "CAPITAL_OUTFLOW" | "STABLE";
  lastUpdated: string;
}

// ============================================================================
// AGGREGATED MARKET DATA
// ============================================================================

export interface MarketData {
  tokens: {
    symbol: string; name: string; price: number;
    priceChange24h: number; priceChange7d: number;
    volume24h: number; marketCap: number; sector: string;
  }[];
  fearGreed: { value: number; classification: string };
  trendingTokens: string[];
  indicators: Record<string, TechnicalIndicators>;
  defiLlama: DefiLlamaData | null;
  derivatives: DerivativesData | null;
  newsSentiment: NewsSentimentData | null;
  macroData: MacroData | null;
  marketRegime: MarketRegime;
  globalMarket: GlobalMarketData | null;
  smartRetailDivergence: SmartRetailDivergence | null;
  fundingMeanReversion: FundingRateMeanReversion | null;
  tvlPriceDivergence: TVLPriceDivergence | null;
  stablecoinSupply: StablecoinSupplyData | null;
}

// ============================================================================
// CMC INTELLIGENCE
// ============================================================================

export interface CMCIntelligence {
  trendingCoins: { name: string; symbol: string; change24h: number }[];
  globalMetrics: { totalMarketCap: number; btcDominance: number; totalVolume24h: number; altcoinMarketCap: number };
  fetchedAt: number;
}

// ============================================================================
// SIGNAL SERVICE
// ============================================================================

export interface TradingSignal {
  token: string;
  action: "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";
  confluence: number;
  reasoning: string;
  indicators: {
    rsi14: number | null;
    macdSignal: string | null;
    macdHistogram: number | null;
    bollingerSignal: string | null;
    bollingerPercentB: number | null;
    volumeChange24h: number | null;
    buyRatio: number | null;
    adx: number | null;
    atrPercent: number | null;
  };
  price: number;
  priceChange24h: number;
  sector: string;
}

export interface SignalPayload {
  timestamp: string;
  cycleNumber: number;
  marketRegime: string;
  fearGreedIndex: number;
  fearGreedClassification: string;
  signals: TradingSignal[];
  meta: {
    version: string;
    generatedAt: string;
    nextExpectedAt: string;
    ttlSeconds: number;
  };
}

// ============================================================================
// TRADE DECISION
// ============================================================================

export interface TradeDecision {
  action: "BUY" | "SELL" | "HOLD" | "REBALANCE" | "WITHDRAW";
  fromToken: string;
  toToken: string;
  amountUSD: number;
  tokenAmount?: number;
  reasoning: string;
  sector?: string;
  isExploration?: boolean;
  isForced?: boolean;
  isTWAPSlice?: boolean;
  signalContext?: {
    marketRegime: string;
    confluenceScore: number;
    rsi: number | null;
    macdSignal: string | null;
    btcFundingRate: number | null;
    ethFundingRate: number | null;
    baseTVLChange24h: number | null;
    baseDEXVolume24h: number | null;
    triggeredBy: string;
    isExploration?: boolean;
    isForced?: boolean;
  };
}
