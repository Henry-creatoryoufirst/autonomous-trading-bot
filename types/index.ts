/**
 * Never Rest Capital — Shared Type Definitions
 * Extracted from agent-v3.2.ts for v6.0 modular architecture
 */

// ============================================================================
// MARKET & REGIME TYPES
// ============================================================================

export type MarketRegime = "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "VOLATILE" | "UNKNOWN";

export type TradeAction = "BUY" | "SELL" | "HOLD" | "REBALANCE";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type TriggerSource = "AI" | "STOP_LOSS" | "PROFIT_TAKE" | "EXPLORATION";

// ============================================================================
// TOKEN TYPES
// ============================================================================

export interface TokenRegistryEntry {
  address: string;
  symbol: string;
  name: string;
  coingeckoId: string;
  sector: string;
  riskLevel: RiskLevel;
  minTradeUSD: number;
  decimals: number;
}

export interface SectorDefinition {
  name: string;
  targetAllocation: number;
  description: string;
  tokens: string[];
}

// ============================================================================
// TRADE TYPES
// ============================================================================

export interface TradeRecord {
  timestamp: string;
  cycle: number;
  action: "BUY" | "SELL" | "HOLD" | "REBALANCE" | "WITHDRAW";
  fromToken: string;
  toToken: string;
  amountUSD: number;
  tokenAmount?: number;
  txHash?: string;
  success: boolean;
  error?: string;
  portfolioValueBefore: number;
  portfolioValueAfter?: number;
  reasoning: string;
  sector?: string;
  marketConditions: {
    fearGreed: number;
    ethPrice: number;
    btcPrice: number;
  };
  // v12.2: Store realized P&L at trade time
  realizedPnL?: number;
  signalContext?: SignalContext;
}

export interface SignalContext {
  marketRegime: MarketRegime;
  confluenceScore: number;
  rsi: number | null;
  macdSignal: string | null;
  btcFundingRate: number | null;
  ethFundingRate: number | null;
  baseTVLChange24h: number | null;
  baseDEXVolume24h: number | null;
  triggeredBy: "AI" | "STOP_LOSS" | "PROFIT_TAKE" | "EXPLORATION" | "FORCED_DEPLOY";
  isExploration?: boolean;
  isForced?: boolean;
  btcPositioning?: string | null;
  ethPositioning?: string | null;
  crossAssetSignal?: string | null;
  adaptiveSlippage?: number;
}

export interface TradePerformanceStats {
  totalTrades: number;
  winRate: number;
  avgReturnPercent: number;
  bestTrade: { symbol: string; returnPercent: number } | null;
  worstTrade: { symbol: string; returnPercent: number } | null;
  avgHoldingPeriod: string;
  profitFactor: number;
  winsByRegime: Record<MarketRegime, { wins: number; total: number }>;
}

// ============================================================================
// SELF-IMPROVEMENT ENGINE TYPES
// ============================================================================

export interface StrategyPattern {
  patternId: string;
  description: string;
  conditions: {
    action: "BUY" | "SELL";
    regime: MarketRegime;
    rsiBucket: "OVERSOLD" | "NEUTRAL" | "OVERBOUGHT" | "UNKNOWN";
    confluenceBucket: "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";
  };
  stats: {
    wins: number;
    losses: number;
    pending: number;
    avgReturnPercent: number;
    totalReturnUSD: number;
    sampleSize: number;
    lastTriggered: string;
  };
  confidence: number;
}

export interface AdaptiveThresholds {
  rsiOversold: number;
  rsiOverbought: number;
  confluenceBuy: number;
  confluenceSell: number;
  confluenceStrongBuy: number;
  confluenceStrongSell: number;
  profitTakeTarget: number;
  profitTakeSellPercent: number;
  stopLossPercent: number;
  trailingStopPercent: number;
  // v9.0: ATR-based multiplier tuning
  atrStopMultiplier: number;        // Default 2.5, tuned 1.5-4.0
  atrTrailMultiplier: number;       // Default 2.0, tuned 1.5-4.0
  regimeMultipliers: Record<MarketRegime, number>;
  history: Array<{
    timestamp: string;
    field: string;
    oldValue: number;
    newValue: number;
    reason: string;
  }>;
  lastAdapted: string | null;
  adaptationCount: number;
}

export interface PerformanceReview {
  timestamp: string;
  triggerReason: "TRADE_COUNT" | "TIME_ELAPSED";
  tradesSinceLastReview: number;
  insights: Array<{
    category: "REGIME" | "PATTERN" | "THRESHOLD" | "SECTOR" | "ACTIVITY";
    severity: "INFO" | "WARNING" | "ACTION";
    message: string;
  }>;
  recommendations: Array<{
    type: "THRESHOLD_CHANGE" | "POSITION_SIZE" | "PATTERN_AVOID" | "PATTERN_FAVOR";
    description: string;
    applied: boolean;
  }>;
  periodStats: {
    winRate: number;
    avgReturn: number;
    totalTrades: number;
    bestPattern: string | null;
    worstPattern: string | null;
    dominantRegime: MarketRegime | null;
  };
}

export interface ExplorationState {
  totalExplorationTrades: number;
  totalExploitationTrades: number;
  consecutiveHolds: number;
  lastTradeTimestamp: string | null;
  stagnationAlerts: number;
}

export interface ShadowProposal {
  field: string;
  proposedDelta: number;
  reason: string;
  proposedAt: string;
  confirmingReviews: number;
  contradictingReviews: number;
  status: "PENDING" | "PROMOTED" | "REJECTED";
  regimesSeen?: string[];
}

// ============================================================================
// PORTFOLIO & COST BASIS TYPES
// ============================================================================

export interface SectorAllocation {
  name: string;
  targetPercent: number;
  currentPercent: number;
  currentUSD: number;
  drift: number;
  tokens: { symbol: string; usdValue: number; percent: number }[];
}

export interface TokenCostBasis {
  symbol: string;
  totalInvestedUSD: number;
  totalTokensAcquired: number;
  averageCostBasis: number;
  currentHolding: number;
  realizedPnL: number;
  unrealizedPnL: number;
  peakPrice: number;
  peakPriceDate: string;
  firstBuyDate: string;
  lastTradeDate: string;
  // v9.0: ATR-based dynamic stops
  atrStopPercent: number | null;       // Current ATR stop as % (negative, e.g. -12.5)
  atrTrailPercent: number | null;      // Current ATR trail as % (negative)
  atrAtEntry: number | null;           // ATR% snapshot at first buy
  trailActivated: boolean;             // True once position is +1xATR in profit
  lastAtrUpdate: string | null;        // ISO timestamp of last ATR computation
}

export interface BalanceEntry {
  symbol: string;
  balance: number;
  usdValue: number;
  price?: number;
  sector?: string;
}

// ============================================================================
// COOLDOWN TYPES (v6.0)
// ============================================================================

export type CooldownDecision = "BUY" | "SELL" | "HOLD" | "WEAK_SIGNAL" | "REBALANCE";

export interface CooldownEntry {
  symbol: string;
  decision: CooldownDecision;
  decidedAt: number;
  cooldownMs: number;
  priceAtDecision: number;
  confluenceAtDecision?: number; // v7.0: confluence score that triggered this decision
}

// ============================================================================
// AI DECISION TYPES
// ============================================================================

export interface AITradeDecision {
  action: TradeAction;
  fromToken: string;
  toToken: string;
  amountUSD: number;
  reasoning: string;
}

// ============================================================================
// CYCLE TYPES (v6.0)
// ============================================================================

export type CycleType = "LIGHT" | "HEAVY";

export interface CycleResult {
  cycleNumber: number;
  type: CycleType;
  reason: string;
  timestamp: string;
  durationMs: number;
  tradeExecuted: boolean;
}
