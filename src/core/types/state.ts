/**
 * Never Rest Capital — Core State Types
 * Extracted from agent-v3.2.ts (Phase 3b refactor)
 */

import type { StrategyPattern, AdaptiveThresholds, PerformanceReview, ExplorationState, TradeRecord, TokenCostBasis, SectorAllocation } from './index.js';
import type { ConfigDirective } from '../services/strategy-config.js';
import type { SleeveOwnership, SleeveConfig } from '../sleeves/state-types.js';
import type { PositionEnteredBy, PositionEntryContext, PositionExitCriterion } from './position-attribution.js';

// ============================================================================
// NVR-SPEC-032 Phase 2: per-position entry attribution row.
//
// Written by executeTrade() on every successful BUY (keyed by canonical
// symbol), removed on every successful SELL. The position-attribution
// synthesizer prefers this row over backfilled trade-history matching when
// present, so future cycles never need to re-derive attribution from
// reasoning strings — the truth is captured at the moment of entry.
//
// Optional on AgentState.trading for back-compat: existing serialized
// states (pre-Phase-2) have `positionEntries === undefined`. All readers
// MUST handle this defensively (`?? {}`).
// ============================================================================
export interface PositionEntryRow {
  /** ISO timestamp of the BUY that opened this position. */
  enteredAt: string;
  /** Which decision path put this position on the books. */
  enteredBy: PositionEnteredBy;
  /** Full entry context (trigger, reviewer verdict, regime, reasoning). */
  entryContext: PositionEntryContext;
  /** Exit criterion currently in force (WD tight-exit, core-thesis, etc.). */
  exitCriterion?: PositionExitCriterion;
}

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
    /** Drawdown-aware peak. Adjusted DOWN by daily payouts so drawdown%
     *  reflects market drawdown, not the intentional capital outflow.
     *  Use this for drawdown calculations. */
    peakValue: number;
    /** v21.28: Honest all-time-high portfolio value, never adjusted for
     *  payouts. Use this for "what was the highest dollar amount the bot
     *  ever showed?" — answers Henry's question. May be undefined on
     *  states that pre-date this field; bot fills it in lazily. */
    allTimePeakNominal?: number;
    /** v21.4: Lifetime maximum drawdown observed (percent, positive number).
     *  Updated whenever current drawdown from peak exceeds the prior max. */
    maxDrawdownPercent?: number;
    sectorAllocations: SectorAllocation[];
    marketRegime?: string;
    /**
     * NVR-SPEC-032 Phase 2: per-symbol attribution captured at BUY time.
     * Optional for back-compat — pre-Phase-2 states have this undefined,
     * and the position-attribution synthesizer falls back to trade-history
     * backfill in that case. Keyed by canonical (state-balance) symbol.
     */
    positionEntries?: Record<string, PositionEntryRow>;
    /**
     * 2026-05-15 Ship 4: per-failure-mode counters. The pre-existing
     * totalTrades / successfulTrades pair told us the rate (~6.9%) but
     * not the shape — were failures liquidity, CDP routing, balance
     * cache, RPC outages, or genuine swap rejects? Without the shape,
     * we can't tell whether to invest in better routing, better balance
     * sync, or RPC redundancy. Optional for back-compat.
     *
     * Mode keys are stable: 'balance-cache' (CDP SDK sync), 'rpc-system'
     * (all RPC endpoints failed), 'liquidity' ('swap routes failed' /
     * 'pool reverted'), 'cdp-routing' (CDP unsupported routes), 'twap'
     * ('TWAP slices failed'), 'timeout', 'unknown' (anything else).
     */
    failedTradesByMode?: Record<string, number>;
    /**
     * 2026-05-15 Ship 4 (Option B pivot): daily benchmark snapshots for
     * measuring alpha vs a passive cbBTC/WETH 60/40 hold. Captured by
     * the dedicated 00:00 UTC cron in agent-v3.2.ts. Ring buffer capped
     * at 90 entries (matches dailyPayouts cap) — covers a rolling 3-month
     * window which is well above the goal's 30-day rolling alpha metric.
     *
     * Rolling-window returns + alpha are DERIVED at read time from this
     * buffer; not stored, never get stale. The /api/benchmark endpoint
     * does the math. State is the source-of-truth fact set; computation
     * is the synthesizer.
     *
     * The cumulativeNetDeposits field is critical: raw portfolio-delta
     * over a window is distorted by deposits (Henry adding capital
     * grows portfolioValue but isn't bot performance) AND payouts (the
     * bot paying Henry shrinks portfolioValue but isn't bot loss). Alpha
     * math subtracts the change in net deposits to isolate bot return.
     */
    benchmarkSnapshots?: Array<{
      date: string;                  // ISO date "YYYY-MM-DD" UTC — idempotency key
      btcPrice: number;              // cbBTC price USD at capture moment
      ethPrice: number;              // WETH price USD at capture moment
      portfolioValue: number;        // state.trading.totalPortfolioValue at capture
      cumulativeNetDeposits: number; // state.totalDeposited - state.onChainWithdrawn (or 0 fallback)
    }>;
    /**
     * 2026-05-15 Ship 4: tracks the last successful benchmark snapshot
     * date so the cron is idempotent (skip if today's already captured).
     */
    lastBenchmarkSnapshotDate?: string;
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
  /**
   * v21.29: WETH rebalance escape hatch — last fire timestamp.
   *
   * The escape hatch detects portfolio-shape lockups (WETH dominance + USDC
   * dryness) and queues a one-time WETH→USDC rebalance trade per cooldown
   * window. This field gates re-fires so successive cycles don't pile up
   * rebalances. Optional for backward compat — absent on pre-v21.29 states.
   *
   * See `maybeRebalanceWeth()` in agent-v3.2.ts and the
   * project_nvr_session_2026_05_05 memory.
   */
  lastWethRebalanceAt?: string | null;
  /**
   * NVR-SPEC-029 follow-on: USDC fast-strike liberation — last fire timestamp.
   *
   * The fast-strike detects "USDC starved + high-conviction WD candidate" and
   * frees capital by selling a single stale-flat Core position so the next
   * cycle's WD entry has budget. This field gates the 24h cooldown so we
   * don't churn Core positions trying to feed back-to-back WD signals.
   * Optional for backward compat — absent on pre-feature states.
   *
   * See `maybeAlphaLiberation()` in agent-v3.2.ts.
   */
  lastAlphaLiberationAt?: string | null;
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
  /**
   * v21.19.1 (2026-04-22) — payout-accrual-2026-04-22 fix.
   * Actual UTC execution date of the last successful transfer (YYYY-MM-DD).
   * Distinct from `lastDailyPayoutDate`, which holds the settlement-period
   * key (yesterday-as-of-cron) used for idempotency. Customer-facing
   * dashboards should read THIS field for "last paid on ___" so the widget
   * reflects the real payout date rather than the dedup key.
   */
  lastDailyPayoutExecutedDate?: string | null;
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
  /**
   * NVR-SPEC-026: True-net-wealth harvest high-water mark.
   * Tracks the highest `currentEquity − totalDeposited − cumulativeHarvested`
   * the bot has ever observed at a successful payout. Harvest is only
   * permitted on equity ABOVE this mark. Round-trip "wins" inside a flat
   * portfolio don't generate harvestable profit. Optional — only consulted
   * when HARVEST_MODE=hwm; legacy mode ignores this field.
   */
  hwmBuffer?: number;
  /**
   * NVR-SPEC-028 Phase 5: Auto-promoter persistent override of Reflex mode.
   * When set, takes precedence over the ALPHA_REFLEX_MODE env var on
   * startup — so a redeploy doesn't reset live → dry-run mid-soak. The
   * Promoter writes to this field whenever it promotes/demotes. Set to
   * undefined to fall back to env-var default.
   */
  alphaReflexModeOverride?: 'disabled' | 'dry-run' | 'live';
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
  // ==========================================================================
  // v21.15 Phase 1.2a: Capital Sleeves per-sleeve state
  //
  // Optional during 1.2a rollout — migration.ts populates these on first run
  // once the orchestrator wires the migration call (Phase 1.2b). Downstream
  // consumers should treat absence as "pre-migration" and fall back to
  // global state.
  //
  // See NVR-SPEC-010 and src/core/sleeves/state-types.ts for the shape.
  // ==========================================================================
  /** sleeveId -> balance sheet (positions, realized P&L, decisions, regime returns) */
  sleeveOwnership?: Record<string, SleeveOwnership>;
  /** sleeveId -> target weight [0..1]; sum ≤ 1.0, remainder held as USDC reserve */
  sleeveAllocation?: Record<string, number>;
  /** Hot-reloadable config (allocations, enabled flags, mode overrides) */
  sleeveConfig?: SleeveConfig;
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
