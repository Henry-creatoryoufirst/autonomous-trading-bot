/**
 * Never Rest Capital — Shared Constants
 * Extracted from agent-v3.2.ts for v6.0 modular architecture
 */

// ============================================================================
// TRADING CYCLE TIMING
// ============================================================================

/** Trading cycle interval in minutes (env override: TRADING_INTERVAL_MINUTES) */
export const DEFAULT_TRADING_INTERVAL_MINUTES = 2;

/** Force a heavy cycle at least this often (milliseconds) */
export const HEAVY_CYCLE_FORCED_INTERVAL_MS = 60 * 1000; // v10.3: 60 seconds — autonomous agent should always be thinking

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
export const ADAPTIVE_MIN_INTERVAL_SEC = 60; // v14.2: 30→60s — even max vigilance shouldn't be sub-minute

/** Maximum cycle interval in seconds (calm markets, conserve API quota) */
export const ADAPTIVE_MAX_INTERVAL_SEC = 300; // 5 minutes

/** Default cycle interval in seconds (normal conditions) */
export const ADAPTIVE_DEFAULT_INTERVAL_SEC = 300; // v14.2: 120→300s (5 min) — matches VOLATILITY_SPEED_MAP.NORMAL

/** Emergency rapid-fire interval in seconds (triggered by large drops) */
export const EMERGENCY_INTERVAL_SEC = 30; // v14.2: 15→30s — even emergencies don't need 15s cycles

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
  EXTREME: 60,    // v14.2: 30→60s cycles — reduce churn, 308 trades/day was killing the portfolio
  HIGH: 120,      // v14.2: 45→120s cycles — 2min minimum for significant movement
  ELEVATED: 180,  // v14.2: 60→180s cycles — 3min for above normal activity
  NORMAL: 300,    // v14.2: 120→300s cycles — 5min standard conditions
  LOW: 300,       // 5min cycles — quiet market (unchanged)
  DEAD: 300,      // 5min cycles — nothing happening (unchanged)
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
  /** Macro economic data (FRED) */
  MACRO: 60 * 60 * 1000,             // 60 minutes
  /** DefiLlama TVL data */
  DEFI_LLAMA: 10 * 60 * 1000,        // 10 minutes
  /** News sentiment (CryptoPanic) */
  NEWS: 10 * 60 * 1000,              // 10 minutes
  /** Derivatives data (Binance funding/OI) */
  DERIVATIVES: 5 * 60 * 1000,        // 5 minutes
  // v12.0: CoinGecko-related TTLs removed (PRICE_HISTORY, COINGECKO_GLOBAL, STABLECOIN_SUPPLY)
  // Price history is now self-accumulating from on-chain reads. See PRICE_HISTORY_* constants below.
} as const;

// ============================================================================
// COOLDOWN DURATIONS (milliseconds) — Per-Token Cooldown System v6.0
// NOTE: TRADE_EXECUTED (90s) > HEAVY_CYCLE_FORCED_INTERVAL (60s), so a traded
// token will miss exactly 1 heavy cycle before becoming eligible again (~120s
// effective blind spot). This is intentional — the 3% price-move override in
// cooldown-manager.ts still fast-tracks re-evaluation if the token moves hard.
// ============================================================================

export const COOLDOWN_DURATIONS = {
  /** After executing a trade (buy/sell) — brief pause, then re-evaluate */
  TRADE_EXECUTED: 30 * 1000,        // v10.4: 30 seconds — crypto moves fast, don't sit idle
  /** After explicit HOLD decision — re-evaluate almost immediately */
  HOLD_DECISION: 10 * 1000,         // v10.4: 10 seconds — conditions change fast
  /** Signal was too weak — check again next cycle */
  WEAK_SIGNAL: 5 * 1000,            // v10.4: 5 seconds — weak signals flip quickly
} as const;

/** Price move threshold to override cooldown (2% in either direction) */
export const COOLDOWN_OVERRIDE_THRESHOLD = 0.02; // v10.4: Lowered from 3% — react faster to moves

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
export const STAGNATION_THRESHOLD_HOURS = 4; // v12.2.7: 1h → 4h — 1h was too aggressive, contributed to overtrading. Let AI breathe

/** Max exploration trade amount (USD) */
export const EXPLORATION_TRADE_USD = 50; // v11.4.22: $3 → $50 — build real positions

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
// v10.0: MARKET INTELLIGENCE ENGINE — Signal Thresholds
// ============================================================================

/** BTC dominance change over 7 days to trigger altseason/dominance signals (percentage points) */
export const BTC_DOMINANCE_CHANGE_THRESHOLD = 2.0;

/** Smart money vs retail divergence threshold for high-conviction signals (percentage points) */
export const SMART_RETAIL_DIVERGENCE_THRESHOLD = 20;

/** Funding rate mean-reversion: std devs from mean to trigger signal */
export const FUNDING_RATE_STD_DEV_THRESHOLD = 2.0;

/** Funding rate history length (8h periods: 21 entries ≈ 7 days) */
export const FUNDING_RATE_HISTORY_LENGTH = 21;

/** TVL-Price divergence threshold (%) */
export const TVL_PRICE_DIVERGENCE_THRESHOLD = 5.0;

/** Stablecoin supply change threshold for bullish/bearish signal (% over 7 days) */
export const STABLECOIN_SUPPLY_CHANGE_THRESHOLD = 2.0;

/** Altseason sector allocation adjustments (added to base targets) */
export const ALTSEASON_SECTOR_BOOST = {
  AI_TOKENS: 0.05,
  MEME_COINS: 0.05,
  BLUE_CHIP: -0.10,
  DEFI: 0.00,
} as const;

/** BTC dominance sector allocation adjustments (added to base targets) */
export const BTC_DOMINANCE_SECTOR_BOOST = {
  BLUE_CHIP: 0.10,
  AI_TOKENS: -0.03,
  MEME_COINS: -0.05,
  DEFI: -0.02,
} as const;

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
  TRENDING_UP: 1.3,     // v9.4: Raised — lean into uptrends harder
  TRENDING_DOWN: 0.85,  // v9.4: Raised from 0.6 — still trade, just more selective (was too defensive)
  RANGING: 0.9,         // v9.4: Raised from 0.8 — ranges are opportunity, not risk
  VOLATILE: 0.7,        // v9.4: Raised from 0.5 — vol = opportunity for a bot that cycles fast
  UNKNOWN: 0.8,         // v9.4: Raised from 0.7
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
export const REENTRY_CONFLUENCE_BUY = 27;   // v10.4: Narrowed from 30 — 5pt premium was causing "sell-all, buy-nothing" lockout. 2pt premium still rewards fresh entries over re-entries.
export const REENTRY_CONFLUENCE_SELL = -23;  // v10.4: Narrowed from -28 — symmetrical 3pt premium above normal (-20)
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
export const TRADE_MINIMUM_COOLDOWN_MS = 90 * 1000; // v10.3: 90 seconds — prevents same-candle flip, stop-losses handle real risk

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
export const CAPITAL_FLOOR_PERCENT = 40; // Hold-only if portfolio < 40% of peak — only block buys at severe drawdown

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

/** ATR stop-loss ceiling — never tighter than -12% regardless of ATR
 *  v12.2.2: Widened from -6% — was causing churn loop (buy → -6% stop → buy again) */
export const ATR_STOP_CEILING_PERCENT = -12;

/** Trail activates after position is +1×ATR% in profit */
export const ATR_TRAIL_ACTIVATION_MULTIPLIER = 1.0;

/** Per-sector ATR multipliers — higher = wider stop for that sector */
export const SECTOR_ATR_MULTIPLIERS: Record<string, number> = {
  MEME_COINS: 2.0,   // Meme coins: volatile, use 2× ATR
  AI_TOKENS: 2.5,     // AI tokens: moderate vol, use 2.5× ATR
  DEFI: 2.5,          // DeFi: moderate vol, use 2.5× ATR
  BLUE_CHIP: 3.0,     // Blue chips: low vol, wider multiple needed
};

/** ATR-relative profit harvest tiers: [atrMultiple, sellPercent]
 *  v11.4.5: Raised multiples — 3x ATR was triggering on normal daily swings */
export const ATR_PROFIT_TIERS = [
  { atrMultiple: 5,  sellPercent: 15, label: "ATR_EARLY" },
  { atrMultiple: 8,  sellPercent: 20, label: "ATR_MID" },
  { atrMultiple: 12, sellPercent: 25, label: "ATR_STRONG" },
  { atrMultiple: 18, sellPercent: 35, label: "ATR_MAJOR" },
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
export const KELLY_FRACTION = 0.5;            // Half Kelly — aggressive capital deployment
export const KELLY_MIN_TRADES = 20;           // Need at least 20 trades before Kelly kicks in
export const KELLY_ROLLING_WINDOW = 50;       // Calculate from last 50 trades
export const KELLY_POSITION_FLOOR_USD = 15;   // Minimum $15 trade — no dust positions
export const KELLY_POSITION_CEILING_PCT = 18;  // 18% of portfolio per trade — bigger positions, less fragmentation
export const KELLY_SMALL_PORTFOLIO_CEILING_PCT = 30; // Boost for <$10K portfolios — $5K × 30% = $1,500 max per position
export const KELLY_SMALL_PORTFOLIO_THRESHOLD = 10_000; // Portfolio under $10K gets the boosted ceiling

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
export const BREAKER_CONSECUTIVE_LOSSES = 5;   // 5 consecutive losing trades → pause (less hair-trigger)
export const BREAKER_DAILY_DD_PCT = 8;         // 8% daily drawdown → pause
export const BREAKER_WEEKLY_DD_PCT = 15;       // 15% weekly drawdown → pause
export const BREAKER_SINGLE_TRADE_LOSS_PCT = 3;// Single trade > 3% of portfolio → pause
export const BREAKER_PAUSE_HOURS = 1;          // 1 hour pause — get back in the game faster
export const BREAKER_SIZE_REDUCTION = 0.7;     // 30% size reduction for 24h after breaker
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

// ============================================================================
// v11.1: CASH DEPLOYMENT ENGINE — Put idle USDC to work
// ============================================================================

/**
 * When USDC exceeds this percentage of total portfolio, the bot enters
 * "capital deployment mode" — lowers confluence thresholds to actively
 * seek entries and bring the portfolio closer to sector targets.
 *
 * v11.4.13: Lowered from 50% → 30%. v11.4.19: Lowered from 30% → 20%.
 * Bot was stuck at 29.6% — 0.4% below threshold — doing nothing with $1,482 USDC.
 * 20% ensures deployment mode fires for any meaningful cash drag.
 */
export const CASH_DEPLOYMENT_THRESHOLD_PCT = 40; // v14.1: 25% → 40% — not as lazy as 50, not as aggressive as 25. Pairs with momentum gate to avoid buying falling knives.

/** Confluence score reduction when in deployment mode (makes entries easier)
 *  v11.4.13: Raised from 15 → 20 — lower the bar further to get capital deployed */
export const CASH_DEPLOYMENT_CONFLUENCE_DISCOUNT = 20;

/** Maximum percentage of excess cash to deploy per cycle (prevents all-in)
 *  v11.4.13: Raised from 50% → 65% — deploy faster, the bot needs to be in the market */
export const CASH_DEPLOYMENT_MAX_DEPLOY_PCT = 80;

/** Minimum USDC to always keep as reserve (gas + emergency buffer) */
export const CASH_DEPLOYMENT_MIN_RESERVE_USD = 150;

/** Number of tokens to target per deployment cycle (spread across sectors)
 *  v11.4.13: Raised from 6 → 8 — more entries per cycle for maximum deployment speed */
export const CASH_DEPLOYMENT_MAX_ENTRIES = 5;

/** v14.1: Gate forced cash deployment behind market momentum check.
 *  When true, FORCED_DEPLOY only fires when BTC+ETH avg 24h change >= 0 AND
 *  portfolio momentum score >= 0. Prevents buying into falling knives.
 *  SCALE_UP and RIDE_THE_WAVE are unaffected — those are opportunity-based. */
export const CASH_DEPLOY_REQUIRES_MOMENTUM = true;

// v11.2: CRASH-BUYING OVERRIDE — Let Cash Deployment punch through breaker during extreme fear
/** Fear & Greed threshold: at or below this, deployment mode can override the institutional breaker */
export const DEPLOYMENT_BREAKER_OVERRIDE_FG_MAX = 30; // v11.4.13: 25 → 30 — wider fear window
/** Minimum cash % to qualify for breaker override (must be heavily overweight cash)
 *  v11.4.13: 60 → 40 — don't need to be 60% cash to override, 40% is already too much */
export const DEPLOYMENT_BREAKER_OVERRIDE_MIN_CASH_PCT = 40;
/** Position size multiplier when buying through breaker (reduced size for safety)
 *  v11.4.13: 0.4 → 0.6 — be more aggressive when buying fear */
export const DEPLOYMENT_BREAKER_OVERRIDE_SIZE_MULT = 0.6;
/** Max entries per cycle when overriding breaker (fewer than normal deployment)
 *  v11.4.13: 2 → 4 — more entries when crash-buying */
export const DEPLOYMENT_BREAKER_OVERRIDE_MAX_ENTRIES = 4;

/**
 * Fallback RPC Endpoints — try in order
 * v11.4: MEV protection — sequencer-direct endpoint first (bypasses public mempool),
 * then privacy-preserving relays, then public RPCs as fallback.
 */
export const BASE_RPC_ENDPOINTS = [
  'https://mainnet-sequencer.base.org',  // Direct sequencer — best MEV protection (bypasses mempool)
  'https://1rpc.io/base',               // TEE-attested privacy relay — burns metadata after relay
  'https://mainnet.base.org',            // Coinbase public RPC
  'https://base.meowrpc.com',            // Community RPC fallback
  'https://base.drpc.org',               // dRPC fallback
] as const;

// ============================================================================
// v12.0: ON-CHAIN PRICING ENGINE — Replace CoinGecko with direct DEX pool reads
// ============================================================================

/** How often to record a price snapshot for the self-accumulating history (hourly) */
export const PRICE_HISTORY_RECORD_INTERVAL_MS = 55 * 60 * 1000; // 55 min (allows for cycle drift)

/** Maximum hourly data points to retain per token (30 days of hourly data) */
export const PRICE_HISTORY_MAX_POINTS = 720;

/** How often to persist price history to disk */
export const PRICE_HISTORY_SAVE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/** Pool registry re-discovery interval (re-discover if older than this) */
export const POOL_DISCOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Consecutive on-chain read failures before triggering pool re-discovery for a token */
export const POOL_REDISCOVERY_FAILURE_THRESHOLD = 3;

/** DexScreener volume enrichment interval (fades out once self-sufficient) */
export const VOLUME_ENRICHMENT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/** Number of hourly data points needed before volume enrichment auto-disables */
export const VOLUME_SELF_SUFFICIENT_POINTS = 168; // 7 days of hourly data

/** Price sanity check — skip update if on-chain price deviates more than this from last known */
export const PRICE_SANITY_MAX_DEVIATION = 0.50; // 50%

// ============================================================================
// v12.3: ON-CHAIN ORDER FLOW INTELLIGENCE
// ============================================================================

/** Number of blocks to look back for Swap events (~10 min on Base at 2s blocks) */
export const ORDER_FLOW_BLOCK_LOOKBACK = 300;

/** TWAP divergence threshold — |divergence| > this % triggers OVERBOUGHT/OVERSOLD signal */
export const TWAP_DIVERGENCE_THRESHOLD_PCT = 2.0;

/** Mild TWAP divergence — between this and full threshold gives partial signal */
export const TWAP_MILD_THRESHOLD_PCT = 1.0;

/** Number of ticks above and below current to read for depth analysis */
export const TICK_DEPTH_RANGE = 5;

/** Large trade threshold in USD — trades above this are "smart money" */
export const LARGE_TRADE_THRESHOLD_USD = 5000;

/** Uniswap V3 Swap event topic hash */
export const SWAP_EVENT_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';

/** TWAP observation period in seconds (15 minutes) */
export const TWAP_OBSERVATION_SECONDS = 900;

// ============================================================================
// v13.0: SCALE-INTO-WINNERS — Deploy real capital into proven positions
// ============================================================================

/** Position must be up this % from cost basis to qualify for scale-up */
export const SCALE_UP_MIN_GAIN_PCT = 3;

/** Buy ratio must exceed this % to confirm momentum for scale-up */
export const SCALE_UP_BUY_RATIO_MIN = 55;

/** Deploy this % of portfolio on each scale-up buy */
export const SCALE_UP_SIZE_PCT = 4;

/** Exit when buy ratio drops below this % on a profitable position */
export const MOMENTUM_EXIT_BUY_RATIO = 45;

/** Only momentum-exit if position was up this %+ (don't panic sell small gains) */
export const MOMENTUM_EXIT_MIN_PROFIT = 5;

/** Token must be up this %+ in 4h to qualify as a wave ride */
export const RIDE_THE_WAVE_MIN_MOVE = 5;

/** Deploy this % of portfolio on a wave ride entry */
export const RIDE_THE_WAVE_SIZE_PCT = 4;

/** Dedup window in minutes for scale-up buys (shorter than normal 15min) */
export const SCALE_UP_DEDUP_WINDOW_MINUTES = 5; // v14.2: 1→5 min — reduce churn on scale-up/wave trades

/** Dedup window in minutes for forced deploy buys */
export const FORCED_DEPLOY_DEDUP_WINDOW_MINUTES = 10; // v14.2: was hardcoded 2min → 10min constant

/** Dedup window in minutes for momentum exit sells */
export const MOMENTUM_EXIT_DEDUP_WINDOW_MINUTES = 5; // v14.2: was hardcoded 1min → 5min constant

/** Dedup window in minutes for normal AI trades */
export const NORMAL_DEDUP_WINDOW_MINUTES = 15; // v14.2: was hardcoded 5min → 15min constant

/** Maximum trades to execute per cycle (prevents churn) */
export const MAX_TRADES_PER_CYCLE = 3; // v14.2: cap total trades per cycle — stop-loss > momentum-exit > profit-take > AI > scale-up > forced-deploy > ride-the-wave

/** Max position percent override for tokens showing strong momentum */
export const MOMENTUM_MAX_POSITION_PERCENT = 15;

// ============================================================================
// v14.1: SMART TRIM (Momentum Deceleration Exit)
// ============================================================================

/** Number of buy ratio readings to store per token */
export const DECEL_HISTORY_LENGTH = 5;

/** Min drop from peak buy ratio before trim activates (percentage points) */
export const DECEL_MIN_DROP_FROM_PEAK = 8;

/** Consecutive deceleration cycles before first trim */
export const DECEL_MIN_CYCLES = 2;

/** Base trim % per cycle */
export const DECEL_BASE_TRIM_PCT = 10;

/** Moderate deceleration threshold (acceleration < -this) */
export const DECEL_MODERATE_THRESHOLD = 3;

/** Severe deceleration threshold (acceleration < -this) */
export const DECEL_SEVERE_THRESHOLD = 6;

/** Max trim per cycle (%) */
export const DECEL_MAX_TRIM_PCT = 30;

/** Min position value (USD) to bother trimming */
export const DECEL_MIN_POSITION_USD = 10;

/** Cooldown between trims in seconds */
export const DECEL_TRIM_COOLDOWN_SEC = 120;

/** Min profit % before trimming activates */
export const DECEL_MIN_PROFIT_PCT = 3;

/** Dedup window in minutes for decel trim sells */
export const DECEL_TRIM_DEDUP_WINDOW_MINUTES = 3;

// ============================================================================
// v15.0: MULTI-AGENT SWARM ARCHITECTURE
// ============================================================================

/** Signal engine mode: 'swarm' uses multi-agent voting, 'classic' uses single confluence */
export const SIGNAL_ENGINE: 'swarm' | 'classic' = (process.env.SIGNAL_ENGINE as any) || 'swarm';

/** Agent weights — how much each micro-agent's vote counts (must sum to 1.0) */
export const SWARM_AGENT_WEIGHTS = {
  momentum:  0.30,  // RSI, MACD, Bollinger, volume spikes
  flow:      0.25,  // DEX buy/sell ratio, volume
  risk:      0.25,  // Position sizing, portfolio exposure, drawdown
  sentiment: 0.10,  // Fear & Greed, BTC/ETH trend, market regime
  trend:     0.10,  // ADX, price direction, trend strength
} as const;

/** Numeric score for each action (used in weighted voting) */
export const SWARM_ACTION_SCORES: Record<string, number> = {
  STRONG_BUY:  2,
  BUY:         1,
  HOLD:        0,
  SELL:       -1,
  STRONG_SELL: -2,
};

/** Score thresholds to map aggregated score to final action */
export const SWARM_SCORE_THRESHOLDS = {
  STRONG_BUY:   1.5,
  BUY:          1.0,
  SELL:        -1.0,
  STRONG_SELL: -1.5,
} as const;

// ============================================================================
// v15.3: YIELD OPTIMIZER — Multi-protocol yield comparison & rebalancing
// ============================================================================

/** Check yield rates every N heavy cycles (~60 min at 30 cycles × 2min) */
export const YIELD_CHECK_INTERVAL_CYCLES = 30;

/** Minimum APY difference (percentage points) to trigger a rebalance */
export const YIELD_MIN_DIFFERENTIAL_PCT = 0.5;

/** Minimum idle USDC (USD) to bother optimizing across protocols */
export const YIELD_MIN_IDLE_USD = 50;

/** Auto-compound accrued rewards every N hours */
export const YIELD_AUTO_COMPOUND_INTERVAL_HOURS = 12;
