/**
 * Never Rest Capital — Core State Types
 * Extracted from agent-v3.2.ts (Phase 3b refactor)
 */

import type { StrategyPattern, AdaptiveThresholds, PerformanceReview, ExplorationState, TradeRecord, TokenCostBasis, SectorAllocation } from './index.js';
import type { ConfigDirective } from '../services/strategy-config.js';

// ============================================================================
// AGENT STATE — The core global state persisted across cycles
// ============================================================================

export interface UserDirective {
  id: string;
  type: 'RESEARCH' | 'WATCHLIST' | 'ALLOCATION' | 'AVOID' | 'GENERAL';
  instruction: string;
  token?: string;
  sector?: string;
  value?: number;
  createdAt: string;
  expiresAt?: string;
  source: string;
}

export interface AgentState {
  startTime: Date;
  totalCycles: number;
  trading: {
    lastCheck: Date;
    lastTrade: Date | null;
    totalTrades: number;
    successfulTrades: number;
    balances: { symbol: string; balance: number; usdValue: number; price?: number; sector?: string }[];
    totalPortfolioValue: number;
    initialValue: number;
    peakValue: number;
    sectorAllocations: SectorAllocation[];
  };
  tradeHistory: TradeRecord[];
  costBasis: Record<string, TokenCostBasis>;
  profitTakeCooldowns: Record<string, string>;
  stopLossCooldowns: Record<string, string>;
  tradeFailures: Record<string, { count: number; lastFailure: string }>;
  harvestedProfits?: {
    totalHarvested: number;
    harvestCount: number;
    harvests: { timestamp: string; symbol: string; tier: string; gainPercent: number; sellPercent: number; amountUSD: number; profitUSD: number }[];
  };
  autoHarvestTransfers: Array<{ timestamp: string; amountETH: string; amountUSD: number; txHash: string; destination: string }>;
  totalAutoHarvestedUSD: number;
  totalAutoHarvestedETH: number;
  lastAutoHarvestTime: string | null;
  autoHarvestCount: number;
  strategyPatterns: Record<string, StrategyPattern>;
  adaptiveThresholds: AdaptiveThresholds;
  performanceReviews: PerformanceReview[];
  explorationState: ExplorationState;
  lastReviewTradeIndex: number;
  lastReviewTimestamp: string | null;
  totalDeposited: number;
  onChainWithdrawn: number;
  lastKnownUSDCBalance: number;
  depositHistory: Array<{ timestamp: string; amountUSD: number; newTotal: number }>;
  sanityAlerts?: Array<{ timestamp: string; symbol: string; type: string; oldCostBasis: number; currentPrice: number; gainPercent: number; action: string }>;
  tradeDedupLog?: Record<string, string>;
  userDirectives?: UserDirective[];
  configDirectives?: ConfigDirective[];
}

// ============================================================================
// CIRCUIT BREAKER STATE
// ============================================================================

export interface BreakerState {
  consecutiveLosses: number;
  lastBreakerTriggered: string | null;
  lastBreakerReason: string | null;
  breakerSizeReductionUntil: string | null;
  dailyBaseline: { date: string; value: number };
  weeklyBaseline: { weekStart: string; value: number };
  rollingTradeResults: boolean[];
}

// ============================================================================
// TRADE ANALYTICS
// ============================================================================

export interface RoundTripTrade {
  token: string;
  buyTimestamp: string;
  sellTimestamp: string;
  buyAmountUSD: number;
  sellAmountUSD: number;
  pnlUSD: number;
  returnPercent: number;
  holdDurationHours: number;
}

export interface WinRateTruthData {
  executionWinRate: number;
  realizedWinRate: number;
  profitFactor: number;
  dailyWinRates: Array<{ date: string; winRate: number; trades: number; wins: number }>;
  avgWinUSD: number;
  avgLossUSD: number;
  winLossRatio: number;
  totalRoundTrips: number;
  profitableRoundTrips: number;
  grossProfitUSD: number;
  grossLossUSD: number;
  roundTrips: RoundTripTrade[];
}

// ============================================================================
// CASH DEPLOYMENT
// ============================================================================

export interface CashDeploymentResult {
  active: boolean;
  cashPercent: number;
  excessCash: number;
  deployBudget: number;
  confluenceDiscount: number;
  tier: string;
  maxEntries: number;
}

// ============================================================================
// SIGNAL & OPPORTUNITY TRACKING
// ============================================================================

export interface SignalHistoryEntry {
  cycle: number;
  timestamp: string;
  buys: number;
  sells: number;
  holds: number;
  strongBuys: number;
  strongSells: number;
  regime: string;
  fearGreed: number;
}

export interface OpportunityCostEntry {
  timestamp: number;
  token: string;
  reason: string;
  blockedSizeUSD: number;
  priceAtBlock: number;
  priceNow?: number;
  missedPnlUSD?: number;
  scored: boolean;
}

export interface HarvestRecipient {
  label: string;
  wallet: string;
  percent: number;
}
