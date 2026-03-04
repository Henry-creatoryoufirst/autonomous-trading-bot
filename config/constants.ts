/**
 * Schertzinger Trading Command — Shared Constants
 * Extracted from agent-v3.2.ts for v6.0 modular architecture
 */

// ============================================================================
// TRADING CYCLE TIMING
// ============================================================================

/** Trading cycle interval in minutes (env override: TRADING_INTERVAL_MINUTES) */
export const DEFAULT_TRADING_INTERVAL_MINUTES = 2;

/** Force a heavy cycle at least this often (milliseconds) */
export const HEAVY_CYCLE_FORCED_INTERVAL_MS = 8 * 60 * 1000; // v9.2: 8 minutes (was 15)

/** Price change threshold to trigger a heavy cycle */
export const PRICE_CHANGE_THRESHOLD = 0.02; // 2%

/** Fear & Greed change threshold to trigger a heavy cycle */
export const FG_CHANGE_THRESHOLD = 5; // 5 points

/** Volume spike threshold (multiple of 7-day average) to trigger heavy cycle */
export const VOLUME_SPIKE_THRESHOLD = 2.0;

// ============================================================================
// v6.2: ADAPTIVE CYCLE ENGINE — Dynamic tempo based on market conditions
// ============================================================================

/** Minimum cycle interval in seconds (maximum vigilance during volatility) */
export const ADAPTIVE_MIN_INTERVAL_SEC = 30;

/** Maximum cycle interval in seconds (calm markets, conserve API quota) */
export const ADAPTIVE_MAX_INTERVAL_SEC = 300; // 5 minutes

/** Default cycle interval in seconds (normal conditions) */
export const ADAPTIVE_DEFAULT_INTERVAL_SEC = 120; // 2 minutes

/** Emergency rapid-fire interval in seconds (triggered by large drops) */
export const EMERGENCY_INTERVAL_SEC = 15;

/** Emergency trigger: any position drops this much → immediate heavy cycle */
export const EMERGENCY_DROP_THRESHOLD = -0.05; // -5%

/** Portfolio size tiers for scaling sensitivity */
export const PORTFOLIO_SENSITIVITY_TIERS = [
  { minUSD: 0,      priceChangeThreshold: 0.02, label: 'STARTER' },      // $0-5K: 2% move triggers
  { minUSD: 5000,   priceChangeThreshold: 0.015, label: 'GROWTH' },      // $5K-25K: 1.5% move triggers
  { minUSD: 25000,  priceChangeThreshold: 0.01, label: 'SCALED' },       // $25K-50K: 1% move triggers
  { minUSD: 50000,  priceChangeThreshold: 0.005, label: 'PREMIUM' },     // $50K-100K: 0.5% move triggers
  { minUSD: 100000, priceChangeThreshold: 0.003, label: 'INSTITUTIONAL' }, // $100K+: 0.3% move triggers
] as const;

/** Volatility levels that control cycle speed */
export const VOLATILITY_SPEED_MAP = {
  EXTREME: 30,    // 30s cycles — market is on fire
  HIGH: 45,       // 45s cycles — significant movement
  ELEVATED: 60,   // 60s cycles — above normal activity
  NORMAL: 120,    // 2min cycles — standard conditions
  LOW: 180,       // 3min cycles — quiet market
  DEAD: 300,      // 5min cycles — nothing happening
} as const;

/** WebSocket reconnect delay in ms */
export const WS_RECONNECT_DELAY_MS = 5000;

/** WebSocket max reconnect attempts before falling back to polling */
export const WS_MAX_RECONNECT_ATTEMPTS = 10;

// ============================================================================
// CACHE TTLs (milliseconds) — Smart Caching System v6.0
// ============================================================================

export const CACHE_TTL = {
  /** Price data — changes fast, refresh every other cycle */
  PRICE: 3 * 60 * 1000,              // 3 minutes
  /** Volume data — trends shift gradually */
  VOLUME: 10 * 60 * 1000,            // 10 minutes
  /** Market cap / supply — structural data, changes slowly */
  MARKET_CAP: 30 * 60 * 1000,        // 30 minutes
  /** Fear & Greed Index — updates every few hours */
  FEAR_GREED: 15 * 60 * 1000,        // 15 minutes
  /** Binance long/short ratios — fast-moving derivative data */
  BINANCE_RATIOS: 5 * 60 * 1000,     // 5 minutes
  /** Cross-asset data (Gold, Oil, VIX, S&P) — macro moves slowly */
  CROSS_ASSET: 30 * 60 * 1000,       // 30 minutes
  /** Macro economic data (FRED) */
  MACRO: 60 * 60 * 1000,             // 60 minutes
  /** DefiLlama TVL data */
  DEFI_LLAMA: 10 * 60 * 1000,        // 10 minutes
  /** News sentiment (CryptoPanic) */
  NEWS: 10 * 60 * 1000,              // 10 minutes
  /** Price history for technical indicators (hourly candles) */
  PRICE_HISTORY: 4 * 60 * 60 * 1000, // 4 hours
  /** Derivatives data (Binance funding/OI) */
  DERIVATIVES: 5 * 60 * 1000,        // 5 minutes
} as const;

// ============================================================================
// COOLDOWN DURATIONS (milliseconds) — Per-Token Cooldown System v6.0
// ============================================================================

export const COOLDOWN_DURATIONS = {
  /** After executing a trade (buy/sell) — give position time to develop */
  TRADE_EXECUTED: 5 * 60 * 1000,    // v9.2: 5 minutes (was 10min — faster re-evaluation)
  /** After explicit HOLD decision — skip a few cycles then re-evaluate */
  HOLD_DECISION: 3 * 60 * 1000,     // v9.2: 3 minutes (was 6min)
  /** Signal was too weak — almost triggered, check again soon */
      WEAK_SIGNAL: 2 * 60 * 1000,         // v9.2: 2 minutes (was 3min)
} as const;

/** Price move threshold to override cooldown (3% in either direction) */
export const COOLDOWN_OVERRIDE_THRESHOLD = 0.03;

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

/** Block token after this many consecutive trade failures */
export const MAX_CONSECUTIVE_FAILURES = 3;

/** Unblock token after this many hours */
export const FAILURE_COOLDOWN_HOURS = 6;

// ============================================================================
// DUST & POSITION MANAGEMENT
// ============================================================================

/** Consolidate positions smaller than this (USD) */
export const DUST_THRESHOLD_USD = 3.00;

// ============================================================================
// SELF-IMPROVEMENT ENGINE
// ============================================================================

/** Minimum confirming reviews before shadow proposal is promoted */
export const MIN_CONFIRMING_REVIEWS = 3;

/** Minimum trades in review period for shadow promotion */
export const MIN_SAMPLE_SIZE = 5;

/** Reject proposal if contradiction ratio exceeds this */
export const MAX_CONTRADICTION_RATIO = 0.3;

/** Trigger performance review every N trades */
export const REVIEW_TRADE_INTERVAL = 10;

/** Trigger performance review if this many hours elapsed */
export const REVIEW_TIME_INTERVAL_HOURS = 24;

/** Stagnation threshold — trigger exploration trade if no trade in this many hours */
export const STAGNATION_THRESHOLD_HOURS = 48;

/** Max exploration trade amount (USD) */
export const EXPLORATION_TRADE_USD = 3;

// ============================================================================
// THRESHOLD BOUNDS — limits for adaptive threshold changes
// ============================================================================

export const THRESHOLD_BOUNDS: Record<string, { min: number; max: number; maxStep: number }> = {
  rsiOversold:           { min: 20, max: 40, maxStep: 2 },
  rsiOverbought:         { min: 60, max: 80, maxStep: 2 },
  confluenceBuy:         { min: 5,  max: 30, maxStep: 2 },
  confluenceSell:        { min: -30, max: -5, maxStep: 2 },
  confluenceStrongBuy:   { min: 25, max: 60, maxStep: 3 },
  confluenceStrongSell:  { min: -60, max: -25, maxStep: 3 },
  profitTakeTarget:      { min: 10, max: 40, maxStep: 2 },
  profitTakeSellPercent: { min: 15, max: 50, maxStep: 3 },
  stopLossPercent:       { min: -20, max: -6, maxStep: 2 },    // v6.2: tighter bounds
  trailingStopPercent:   { min: -15, max: -5, maxStep: 2 },   // v6.2: tighter bounds
  atrStopMultiplier:     { min: 1.5, max: 4.0, maxStep: 0.25 }, // v9.0: ATR stop multiplier tuning
  atrTrailMultiplier:    { min: 1.5, max: 4.0, maxStep: 0.25 }, // v9.0: ATR trail multiplier tuning
};

// ============================================================================
// PROFIT HARVESTING DEFAULTS
// ============================================================================

export const DEFAULT_PROFIT_TIERS = [
  { gainPercent: 8,  sellPercent: 15, label: "EARLY_HARVEST" },
  { gainPercent: 15, sellPercent: 20, label: "MID_HARVEST" },
  { gainPercent: 25, sellPercent: 30, label: "STRONG_HARVEST" },
  { gainPercent: 40, sellPercent: 40, label: "MAJOR_HARVEST" },
] as const;

// ============================================================================
// ADAPTIVE THRESHOLD DEFAULTS
// ============================================================================

export const DEFAULT_REGIME_MULTIPLIERS = {
  TRENDING_UP: 1.2,
  TRENDING_DOWN: 0.6,
  RANGING: 0.8,
  VOLATILE: 0.5,
  UNKNOWN: 0.7,
} as const;

// ========================================================================
// v7.0: SIGNAL-WEIGHTED RE-ENTRY THRESHOLDS
// ========================================================================

/**
 * After a recent trade, re-entry requires a HIGHER confluence score.
 * Normal BUY entry:  confluence >= +25
 * Re-entry BUY:      confluence >= +40 (within TRADE_EXECUTED window)
 * Normal SELL entry: confluence <= -20
 * Re-entry SELL:     confluence <= -35 (within TRADE_EXECUTED window)
 */
export const REENTRY_CONFLUENCE_BUY = 40;
export const REENTRY_CONFLUENCE_SELL = -35;
export const NORMAL_CONFLUENCE_BUY = 25;
export const NORMAL_CONFLUENCE_SELL = -20;

// ========================================================================
// v7.0: PARALLEL EVALUATION ENGINE
// ========================================================================

/** Maximum concurrent trade executions (evaluations are always parallel) */
export const MAX_CONCURRENT_TRADES = 5;

/** Minimum delay between consecutive on-chain transactions (ms) */
export const TRADE_EXECUTION_GAP_MS = 2000; // 2 seconds

/** Absolute minimum cooldown after ANY trade — prevents same-candle flip */
export const TRADE_MINIMUM_COOLDOWN_MS = 3 * 60 * 1000; // v9.2: 3 minutes (was 5min)

/** How often each token watcher re-checks price when in cooldown */
export const TOKEN_WATCH_INTERVAL_MS = 30 * 1000; // 30 seconds

/** How often each token watcher runs a full AI heavy analysis */
export const TOKEN_HEAVY_ANALYSIS_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// ============================================================================
// CAPITAL FLOOR — v6.2 Portfolio Protection
// ============================================================================

/**
 * Capital floor as a percentage of peak portfolio value.
 * When portfolio drops below this floor, the bot enters HOLD-ONLY mode
 * (no new buys, only stop-loss sells allowed).
 */
export const CAPITAL_FLOOR_PERCENT = 60; // Hold-only if portfolio < 60% of peak

/**
 * Absolute minimum portfolio value (USD) below which ALL trading halts.
 * This is the emergency kill switch — even stop-losses won't fire below this
 * to prevent dust-level churn on a depleted wallet.
 */
export const CAPITAL_FLOOR_ABSOLUTE_USD = 50; // $50 absolute minimum

// ============================================================================
// SECTOR RISK LIMITS — v6.2 Per-Sector Stop-Loss Overrides
// ============================================================================

/**
 * Tighter stop-loss bounds for high-risk sectors.
 * These override the adaptive stop-loss when the sector is riskier.
 */
export const SECTOR_STOP_LOSS_OVERRIDES: Record<string, { maxLoss: number; maxTrailing: number; maxPositionPercent: number }> = {
  MEME_COINS:  { maxLoss: -10, maxTrailing: -8,  maxPositionPercent: 15 },
  AI_TOKENS:   { maxLoss: -12, maxTrailing: -10, maxPositionPercent: 20 },
  DEFI:        { maxLoss: -15, maxTrailing: -12, maxPositionPercent: 25 },
  BLUE_CHIP:   { maxLoss: -20, maxTrailing: -15, maxPositionPercent: 30 },
} as const;

// ============================================================================
// v9.0: ATR-BASED DYNAMIC RISK MANAGEMENT
// ============================================================================

/** Base stop-loss distance in ATR units (e.g. 2.5 × ATR% = stop distance) */
export const ATR_STOP_LOSS_MULTIPLIER = 2.5;

/** Trailing stop distance in ATR units */
export const ATR_TRAILING_STOP_MULTIPLIER = 2.0;

/** ATR stop-loss floor — never wider than -25% regardless of ATR */
export const ATR_STOP_FLOOR_PERCENT = -25;

/** ATR stop-loss ceiling — never tighter than -6% regardless of ATR */
export const ATR_STOP_CEILING_PERCENT = -6;

/** Trail activates after position is +1×ATR% in profit */
export const ATR_TRAIL_ACTIVATION_MULTIPLIER = 1.0;

/** Per-sector ATR multipliers — higher = wider stop for that sector */
export const SECTOR_ATR_MULTIPLIERS: Record<string, number> = {
  MEME_COINS: 2.0,   // Meme coins: volatile, use 2× ATR
  AI_TOKENS: 2.5,     // AI tokens: moderate vol, use 2.5× ATR
  DEFI: 2.5,          // DeFi: moderate vol, use 2.5× ATR
  BLUE_CHIP: 3.0,     // Blue chips: low vol, wider multiple needed
};

/** ATR-relative profit harvest tiers: [atrMultiple, sellPercent] */
export const ATR_PROFIT_TIERS = [
  { atrMultiple: 3,  sellPercent: 15, label: "ATR_EARLY" },
  { atrMultiple: 5,  sellPercent: 20, label: "ATR_MID" },
  { atrMultiple: 8,  sellPercent: 30, label: "ATR_STRONG" },
  { atrMultiple: 12, sellPercent: 40, label: "ATR_MAJOR" },
] as const;

/** How many ATR comparison log entries to emit (for debugging first N cycles) */
export const ATR_COMPARISON_LOG_COUNT = 20;

// ============================================================================
// v8.0: PHASE 1 — INSTITUTIONAL POSITION SIZING & CAPITAL PROTECTION
// ============================================================================

/**
 * Quarter Kelly Position Sizing
 * Kelly % = (WinRate × AvgWin − (1 − WinRate) × AvgLoss) / AvgWin
 * Position = Kelly% × KELLY_FRACTION × Portfolio
 */
export const KELLY_FRACTION = 0.25;           // Quarter Kelly — crypto-appropriate conservatism
export const KELLY_MIN_TRADES = 20;           // Need at least 20 trades before Kelly kicks in
export const KELLY_ROLLING_WINDOW = 50;       // Calculate from last 50 trades
export const KELLY_POSITION_FLOOR_USD = 5;    // Minimum viable trade
export const KELLY_POSITION_CEILING_PCT = 8;  // v9.2: Hard cap: 8% of portfolio per trade (was 5%)

/**
 * Volatility-Adjusted Sizing
 * Size = BaseSize × (TargetVol / CurrentVol)
 */
export const VOL_TARGET_DAILY_PCT = 2;         // Target 2% daily portfolio volatility
export const VOL_HIGH_THRESHOLD = 5;           // >5% daily vol → reduce size by 60%
export const VOL_HIGH_REDUCTION = 0.4;         // Multiplier when vol > threshold (1 - 0.6 = 0.4)
export const VOL_LOW_THRESHOLD = 1;            // <1% daily vol → increase size by 50%
export const VOL_LOW_BOOST = 1.5;              // Multiplier when vol < threshold
export const VOL_LOOKBACK_DAYS = 7;            // Rolling window for vol calculation

/**
 * Portfolio-Wide Drawdown Circuit Breaker
 * Triggers on ANY of these conditions
 */
export const BREAKER_CONSECUTIVE_LOSSES = 3;   // 3 consecutive losing trades → pause
export const BREAKER_DAILY_DD_PCT = 5;         // 5% daily drawdown → pause
export const BREAKER_WEEKLY_DD_PCT = 10;       // 10% weekly drawdown → pause
export const BREAKER_SINGLE_TRADE_LOSS_PCT = 3;// Single trade > 3% of portfolio → pause
export const BREAKER_PAUSE_HOURS = 2;          // Pause duration after breaker triggers
export const BREAKER_SIZE_REDUCTION = 0.5;     // 50% size reduction for 24h after breaker
export const BREAKER_SIZE_REDUCTION_HOURS = 24;// Duration of post-breaker size reduction

// ============================================================================
// v8.1: PHASE 2 — EXECUTION QUALITY (VWS, TWAP, Gas, Liquidity)
// ============================================================================

/**
 * VWS Liquidity Filter — Volume-Weighted Spread
 * VWS = (Ask - Bid) / ((AskSize + BidSize) / 2)
 * Only trade when liquidity is thick enough to execute without excessive slippage.
 */
export const VWS_MAX_SPREAD_PCT = 0.5;             // Skip trade if VWS > 0.5%
export const VWS_TRADE_AS_POOL_PCT_MAX = 5;        // Max trade size as % of pool liquidity
export const VWS_TRADE_AS_POOL_PCT_WARN = 2;       // Warn if trade > 2% of pool
export const VWS_MIN_LIQUIDITY_USD = 10_000;       // Minimum pool liquidity to trade at all
export const VWS_PREFERRED_LIQUIDITY_USD = 50_000; // Preferred minimum for full-size trades
export const VWS_THIN_POOL_SIZE_REDUCTION = 0.5;   // 50% size cut for pools between min and preferred

/**
 * TWAP Execution — Time-Weighted Average Price
 * Split large orders into smaller chunks to minimize market impact.
 */
export const TWAP_THRESHOLD_USD = 100;              // Orders > $100 get TWAP'd
export const TWAP_NUM_SLICES = 5;                   // Split into 5 sub-orders
export const TWAP_SLICE_INTERVAL_MS = 12_000;       // 12 seconds between slices
export const TWAP_TIMING_JITTER_PCT = 20;           // Randomize ±20% to avoid pattern detection
export const TWAP_ADVERSE_MOVE_PCT = 1.0;           // Pause TWAP if price moves >1% against us
export const TWAP_MAX_DURATION_MS = 120_000;        // Max 2 minutes total TWAP duration

/**
 * Gas Price Optimization — Dynamic gas monitoring for Base L2
 */
export const GAS_PRICE_HIGH_GWEI = 0.5;            // Base L2: >0.5 gwei = congested
export const GAS_PRICE_NORMAL_GWEI = 0.1;          // Base L2: normal ~0.01-0.1 gwei
export const GAS_QUEUE_MAX_WAIT_MS = 30 * 60 * 1000; // Max 30 min wait for lower gas
export const GAS_CHECK_INTERVAL_MS = 30_000;        // Re-check gas every 30s when queued
export const GAS_COST_MAX_PCT_OF_TRADE = 5;         // Skip if gas > 5% of trade value

// ============================================================================
// v9.2: AUTO GAS REFUEL — Keep ETH balance topped up for tx fees
// ============================================================================

/** ETH balance (in ETH) below which auto-refuel triggers */
export const GAS_REFUEL_THRESHOLD_ETH = 0.0003; // ~$0.80 at $2700/ETH

/** Amount of USDC to swap into WETH when refueling */
export const GAS_REFUEL_AMOUNT_USDC = 1.00; // $1 USDC → ~0.00037 ETH

/** Minimum USDC balance required before refuel is allowed (don't drain last dollar) */
export const GAS_REFUEL_MIN_USDC = 5.00;

/** Cooldown between gas refuels to prevent rapid-fire refueling on errors */
export const GAS_REFUEL_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// ============================================================================
// v9.3: DAILY PAYOUT — Scheduled profit distribution replacing opportunistic harvest
// ============================================================================

/** Cron expression: 8:00 AM UTC daily */
export const DAILY_PAYOUT_CRON = '0 8 * * *';

/** Minimum payout per recipient (skip if share is less) */
export const DAILY_PAYOUT_MIN_TRANSFER_USD = 1.00;

/** Minimum ETH for gas before payout is allowed */
export const DAILY_PAYOUT_MIN_ETH_RESERVE = 0.0003;

/** USDC buffer to keep in wallet after payout */
export const DAILY_PAYOUT_USDC_BUFFER = 5.00;

/**
 * Fallback RPC Endpoints — try in order
 */
export const BASE_RPC_ENDPOINTS = [
  'https://mainnet.base.org',
  'https://base.meowrpc.com',
  'https://base.drpc.org',
  'https://1rpc.io/base',
] as const;
