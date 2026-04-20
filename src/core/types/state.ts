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
  lastCycleTime: number | null;
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
    marketRegime?: string;
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
  // Auto-harvest state
  autoHarvestTransfers: Array<{ timestamp: string; amountETH: string; amountUSD: number; txHash: string; destination: string }>;
  totalAutoHarvestedUSD: number;
  totalAutoHarvestedETH: number;
  lastAutoHarvestTime: string | null;
  autoHarvestCount: number;
  autoHarvestByRecipient: Record<string, number>;
  // Daily payout state
  dailyPayouts: Array<{ date: string; payoutDate: string; realizedPnL: number; payoutPercent: number; totalDistributed: number; transfers: any[]; skippedReason?: string }>;
  totalDailyPayoutsUSD: number;
  dailyPayoutCount: number;
  lastDailyPayoutDate: string | null;
  dailyPayoutByRecipient: Record<string, number>;
  /**
   * v21.14: Payout accrual buckets.
   * Small daily shares (e.g. $0.03) that fall below DAILY_PAYOUT_MIN_TRANSFER_USD
   * accumulate here instead of being silently skipped. When a bucket crosses
   * the minimum, it transfers in a single tx and resets to 0.
   * Gas-efficient for family bots with small realized P&L.
   */
  pendingPayoutsByRecipient?: Record<string, number>;
  /**
   * v21.15/v21.13-fix: Harvest-on-sell reservation.
   * Accumulates `profit × totalRecipientPct/100` on every profitable sell so
   * the fee can't be re-deployed before the 8AM UTC daily payout fires.
   * Reset to 0 AFTER a successful payout in runDailyPayout().
   *
   * Historically this was stored via `(state as any).pendingFeeUSDC` and was
   * never persisted → every bot restart wiped it to 0, silently under-paying
   * recipients on any day with a restart. Now in the type + persistence layer.
   */
  pendingFeeUSDC: number;
  // Self-improvement engine
  strategyPatterns: Record<string, StrategyPattern>;
  adaptiveThresholds: AdaptiveThresholds;
  performanceReviews: PerformanceReview[];
  explorationState: ExplorationState;
  lastReviewTradeIndex: number;
  lastReviewTimestamp: string | null;
  // On-chain deposit tracking
  totalDeposited: number;
  onChainWithdrawn: number;
  lastKnownUSDCBalance: number;
  depositHistory: Array<{ timestamp: string; amountUSD: number; newTotal: number }>;
  // Market intelligence history (persisted for mean-reversion signals)
  fundingRateHistory: { btc: number[]; eth: number[] };
  btcDominanceHistory: { values: { timestamp: string; dominance: number }[] };
  stablecoinSupplyHistory: { values: { timestamp: string; totalSupply: number }[] };
  // Error tracking & diagnostics
  errorLog: Array<{ timestamp: string; type: string; message: string; details?: any }>;
  sanityAlerts?: Array<{ timestamp: string; symbol: string; type: string; oldCostBasis: number; currentPrice: number; gainPercent: number; action: string }>;
  tradeDedupLog?: Record<string, string>;
  // User & config directives
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
  /** v21.3: true once a full cycle with real market prices has validated the baseline.
   *  Prevents showing fake daily P&L from stale/warmup-only baselines after restart. */
  dailyBaselineValidated: boolean;
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
