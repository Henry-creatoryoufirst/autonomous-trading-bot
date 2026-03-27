/**
 * Never Rest Capital — Shared Constants
 * Extracted from agent-v3.2.ts for v6.0 modular architecture
 */

// ============================================================================
// BASE CHAIN ADDRESSES & IDS
// ============================================================================

/** Base Mainnet chain ID */
export const BASE_CHAIN_ID = 8453;

/** USDC on Base Mainnet (checksummed) */
export const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// ============================================================================
// AI MODEL ROUTING — Cost Optimization (v20.5)
// ============================================================================

/** Sonnet for complex decisions: trade execution, portfolio rebalancing, emergencies */
export const AI_MODEL_HEAVY = 'claude-sonnet-4-20250514';

/** Haiku for routine monitoring: forced-interval checks, status updates, chat */
export const AI_MODEL_ROUTINE = 'claude-haiku-4-5-20251001';

/** Heavy cycle reasons that MUST use Sonnet (any cycle that could trigger a trade) */
export const SONNET_REQUIRED_REASONS = [
  'EMERGENCY',
  'moved',         // price move — could trigger trade
  'exited cooldown', // token ready to trade again
] as const;

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

/** v20.4.3: Tiered cycle architecture — three layers of data pull
 *  Layer 1: Price stream (10s polling) — emergency detection, always running
 *  Layer 2: Normal cycle (10min) — price check, stop-loss, quick decisions
 *  Layer 3: Heavy cycle (30-60min) — full intelligence refresh (APIs, indicators, AI)
 *
 *  Why: indicators update on hourly data, F&G changes slowly, macro is daily.
 *  Cycling every 1-5min was 288 cycles/day with 98% HOLD decisions.
 *  At 10min normal + 30min heavy: 144 cycles/day, 66% less infra load.
 *  At 100 bots this is the difference between $X and $3X in RPC costs.
 */

/** Minimum cycle interval in seconds (maximum vigilance during volatility) */
export const ADAPTIVE_MIN_INTERVAL_SEC = 120; // v20.4.3: 60→120s — 2min floor, price stream handles emergencies

/** Maximum cycle interval in seconds (calm markets, conserve API quota) */
export const ADAPTIVE_MAX_INTERVAL_SEC = 900; // v20.4.3: 300→900s (15min) — calm markets don't need 5min checks

/** Default cycle interval in seconds (normal conditions) */
export const ADAPTIVE_DEFAULT_INTERVAL_SEC = 600; // v20.4.3: 300→600s (10min) — the new normal

/** Emergency rapid-fire interval in seconds (triggered by large drops) */
export const EMERGENCY_INTERVAL_SEC = 30; // Stays at 30s — emergencies are emergencies

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

/** v20.4.3: Volatility-tiered cycle speeds
 *  Price stream (10s) catches emergencies. These are for the trading cycle. */
export const VOLATILITY_SPEED_MAP = {
  EXTREME: 120,   // v20.4.3: 60→120s — 2min, price stream already watching at 10s
  HIGH: 300,      // v20.4.3: 120→300s — 5min, enough to react to fast moves
  ELEVATED: 480,  // v20.4.3: 180→480s — 8min, above normal but not urgent
  NORMAL: 600,    // v20.4.3: 300→600s — 10min, the new standard
  LOW: 900,       // v20.4.3: 300→900s — 15min, nothing happening, save resources
  DEAD: 900,      // v20.4.3: 300→900s — 15min, market is asleep
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

/** Max exploration trade amount (USD) — used for full positions */
export const EXPLORATION_TRADE_USD = 50; // v11.4.22: $3 → $50 — build real positions

// ============================================================================
// v19.0: SCOUT MODE — Seed cheap data-gathering probes across all tracked tokens
// ============================================================================

/** Scout position size in USD — cheap probes, not commitments */
export const SCOUT_POSITION_USD = 8;

/** Minimum floor for any position (replaces old $15 floor for scouts) */
export const SCOUT_POSITION_FLOOR_USD = 3;

/** Max number of concurrent scout positions */
export const SCOUT_MAX_POSITIONS = 18;

/** Scout-to-full upgrade threshold: buy ratio must exceed this across 2+ timeframes */
export const SCOUT_UPGRADE_BUY_RATIO = 55;

/** Scout positions below this USD value are exempt from percentage-based stops */
export const SCOUT_STOP_EXEMPT_THRESHOLD_USD = 15;

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
  TOKENIZED_STOCKS: 0.00,
} as const;

/** BTC dominance sector allocation adjustments (added to base targets) */
export const BTC_DOMINANCE_SECTOR_BOOST = {
  BLUE_CHIP: 0.10,
  AI_TOKENS: -0.03,
  MEME_COINS: -0.05,
  DEFI: -0.02,
  TOKENIZED_STOCKS: 0.00,
} as const;

// ============================================================================
// PROFIT HARVESTING DEFAULTS
// ============================================================================

/** v18.0: Widened profit tiers — let winners run longer before first harvest.
 *  Old tiers (8/15/25/40%) harvested too early, creating small wins and big losses.
 *  New tiers start at 25% to give trades room to develop. */
export const DEFAULT_PROFIT_TIERS = [
  { gainPercent: 25,  sellPercent: 15, label: "EARLY_HARVEST" },
  { gainPercent: 50,  sellPercent: 20, label: "MID_HARVEST" },
  { gainPercent: 100, sellPercent: 25, label: "STRONG_HARVEST" },
  { gainPercent: 200, sellPercent: 35, label: "MAJOR_HARVEST" },
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
/** v18.0: Tightened non-blue-chip stops to ~4% effective, blue chips keep 6%
 *  Core fix: losses were 2x wins because stops were too wide for $20-30 trades */
export const SECTOR_STOP_LOSS_OVERRIDES: Record<string, { maxLoss: number; maxTrailing: number; maxPositionPercent: number }> = {
  MEME_COINS:       { maxLoss: -4,  maxTrailing: -3,  maxPositionPercent: 15 },
  AI_TOKENS:        { maxLoss: -4,  maxTrailing: -3,  maxPositionPercent: 20 },
  DEFI:             { maxLoss: -5,  maxTrailing: -4,  maxPositionPercent: 25 },
  BLUE_CHIP:        { maxLoss: -6,  maxTrailing: -5,  maxPositionPercent: 30 },
  TOKENIZED_STOCKS: { maxLoss: -5,  maxTrailing: -4,  maxPositionPercent: 10 }, // v20.3.1: Conservative — thin liquidity
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
  MEME_COINS: 2.0,        // Meme coins: volatile, use 2× ATR
  AI_TOKENS: 2.5,          // AI tokens: moderate vol, use 2.5× ATR
  DEFI: 2.5,               // DeFi: moderate vol, use 2.5× ATR
  BLUE_CHIP: 3.0,          // Blue chips: low vol, wider multiple needed
  TOKENIZED_STOCKS: 3.0,   // v20.3.1: Similar to blue chips — tracks TradFi equity vol
};

/** ATR-relative profit harvest tiers: [atrMultiple, sellPercent]
 *  v18.0: Raised further — 5x ATR was still triggering too early on volatile tokens.
 *  Combined with let-winners-run filter, these only fire when momentum decelerates. */
export const ATR_PROFIT_TIERS = [
  { atrMultiple: 8,  sellPercent: 15, label: "ATR_EARLY" },
  { atrMultiple: 12, sellPercent: 20, label: "ATR_MID" },
  { atrMultiple: 18, sellPercent: 25, label: "ATR_STRONG" },
  { atrMultiple: 25, sellPercent: 35, label: "ATR_MAJOR" },
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
export const KELLY_POSITION_FLOOR_USD = 3;    // v19.0: Lowered from $15 to $3 — allow scout micro-positions
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

// v9.2.1: GAS BOOTSTRAP — First-startup auto-buy ETH for gas
/** Trigger gas bootstrap if ETH balance is worth less than this (USD) */
export const GAS_BOOTSTRAP_MIN_ETH_USD = 2;
/** Amount of USDC to swap into ETH during bootstrap */
export const GAS_BOOTSTRAP_SWAP_USD = 5;
/** Minimum USDC balance required before bootstrap is allowed */
export const GAS_BOOTSTRAP_MIN_USDC = 20;

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
 * v20.2: GRADUATED CASH DEPLOYMENT TIERS
 * Replaces the old binary threshold (40%) with 4 tiers that increase deployment
 * pressure as cash grows. Fixes the "dead zone" where 25-39% cash sat idle.
 *
 * History: v11.4.13: 50→30. v11.4.19: 30→20. v14.1: 25→40. v20.2: graduated tiers.
 * The bot was stuck at 37.5% cash ($3K on $8K) — 2.5% below the 40% trigger — doing nothing.
 */
export const CASH_DEPLOYMENT_TIERS = [
  { cashPct: 20, deployPct: 30, confluenceDiscount: 5,  maxEntries: 2, label: 'LIGHT' as const },      // v20.3.1: 25→20 — start deploying sooner, no more dead zone
  { cashPct: 35, deployPct: 50, confluenceDiscount: 10, maxEntries: 3, label: 'MODERATE' as const },
  { cashPct: 50, deployPct: 70, confluenceDiscount: 15, maxEntries: 4, label: 'AGGRESSIVE' as const },
  { cashPct: 65, deployPct: 80, confluenceDiscount: 20, maxEntries: 5, label: 'URGENT' as const },
];

/** Backwards-compatible: lowest tier threshold. Used by forced deploy gate check. */
export const CASH_DEPLOYMENT_THRESHOLD_PCT = 20; // v20.3.1: 25% → 20% (match first tier)

/** Legacy — still used as the URGENT tier's confluence discount for directive stacking */
export const CASH_DEPLOYMENT_CONFLUENCE_DISCOUNT = 20;

/** Legacy — kept for reference; tiers now define per-tier deploy percentages */
export const CASH_DEPLOYMENT_MAX_DEPLOY_PCT = 80;

/** Minimum USDC to always keep as reserve (gas + emergency buffer) */
export const CASH_DEPLOYMENT_MIN_RESERVE_USD = 150;

/** Legacy fallback — tiers define per-tier maxEntries now */
export const CASH_DEPLOYMENT_MAX_ENTRIES = 5;

/** v14.1: Gate forced cash deployment behind market momentum check.
 *  v20.2: Softened — only hard-blocks at -5% BTC+ETH avg (genuine crash).
 *  Dips between -5% and 0% scale deployment down proportionally.
 *  SCALE_UP and RIDE_THE_WAVE are unaffected — those are opportunity-based. */
export const CASH_DEPLOY_REQUIRES_MOMENTUM = true;

/** v20.2: BTC+ETH avg 24h change must be worse than this to hard-block forced deployment.
 *  Between this and 0%, deployment scales down proportionally. */
export const MOMENTUM_HARD_BLOCK_THRESHOLD = -5;

// v11.2: CRASH-BUYING OVERRIDE — v17.0: Now flow-based, not F&G-based
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
  'https://rpc.flashbots.net/fast?chainId=8453', // v20.0: Flashbots Protect — private tx submission, MEV rebates
  'https://mainnet-sequencer.base.org',  // Direct sequencer — bypasses public mempool
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

/** Dedup window in minutes for scale-up buys
 *  v18.0: Widened from 5 to 15 min — reduce churn */
export const SCALE_UP_DEDUP_WINDOW_MINUTES = 15;

/** v19.0: Surge mode dedup — rapid scale-ups when multi-timeframe flow confirms */
export const SURGE_DEDUP_WINDOW_MINUTES = 3;

/** v19.0: Max portfolio % to deploy into a single token via surge (prevents over-concentration) */
export const SURGE_MAX_CAPITAL_PER_TOKEN_PCT = 25;

/** v19.0: Max surge buys per token per hour (prevents runaway buying on noisy flow) */
export const SURGE_MAX_BUYS_PER_HOUR = 5;

/** Dedup window in minutes for forced deploy buys
 *  v18.0: Widened from 10 to 20 min — be more patient with deployment */
export const FORCED_DEPLOY_DEDUP_WINDOW_MINUTES = 20;

/** Dedup window in minutes for momentum exit sells
 *  v18.0: Widened from 5 to 15 min — avoid panic selling on minor dips */
export const MOMENTUM_EXIT_DEDUP_WINDOW_MINUTES = 15;

/** Dedup window in minutes for normal AI trades
 *  v18.0: Widened from 15 to 30 min — minimum time between trades on the same token */
export const NORMAL_DEDUP_WINDOW_MINUTES = 30;

/** Maximum trades to execute per cycle (prevents churn)
 *  v18.0: Kept at 3 for trending markets, but RANGING regime caps to 2 (see RANGING_MAX_TRADES_PER_CYCLE) */
export const MAX_TRADES_PER_CYCLE = 3;

/** v18.0: Max trades per cycle in RANGING regime — fewer, higher-conviction trades */
export const RANGING_MAX_TRADES_PER_CYCLE = 2;

/** Max position percent override for tokens showing strong momentum */
export const MOMENTUM_MAX_POSITION_PERCENT = 15;

// ============================================================================
// v16.0: DUST/MICRO POSITION CLEANUP — NVR Live Audit P1-3
// ============================================================================

/** Positions under this USD value get cleaned up */
export const DUST_CLEANUP_THRESHOLD_USD = 5;

/** Must be held for at least this many hours before cleanup */
export const DUST_CLEANUP_MIN_AGE_HOURS = 24;

/** How often (in cycles) to run dust cleanup */
export const DUST_CLEANUP_INTERVAL_CYCLES = 10;

// ============================================================================
// v16.0: PER-POSITION STOP-LOSS — Prevent individual positions from bleeding indefinitely
// ============================================================================

/** Absolute max loss per position — STRONG_SELL immediately
 *  v19.0: Widened to -15% — emergency backstop only. Flow-reversal exits should fire first. */
export const POSITION_HARD_STOP_PCT = -15;

/** Soft stop for positions worth > $20
 *  v19.0: Widened to -12% — secondary backstop. Flow-reversal exits are the primary exit mechanism. */
export const POSITION_SOFT_STOP_PCT = -12;

/** Flow-reversal exit: buy ratio below this AND decelerating for 2+ readings = exit regardless of P&L
 *  v19.0: Flow physics — when capital leaves, we leave with it. */
export const FLOW_REVERSAL_EXIT_BUY_RATIO = 40;
export const FLOW_REVERSAL_EXIT_MIN_DECEL_READINGS = 2;

/** Stop for concentrated positions (> 10% of portfolio) */
export const POSITION_CONCENTRATED_STOP_PCT = -7;

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

/** Agent weights — how much each micro-agent's vote counts (must sum to 1.0)
 *  v19.0: Reweighted to reflect capital flow physics thesis.
 *  Flow is the dominant signal — where money moves, price follows.
 *  Momentum confirms flow, doesn't lead. Sentiment near-zero. */
export const SWARM_AGENT_WEIGHTS = {
  momentum:  0.20,  // RSI, MACD, Bollinger — confirms flow direction
  flow:      0.35,  // DEX buy/sell ratio, volume — THE core signal
  risk:      0.25,  // Position sizing, portfolio exposure, drawdown
  sentiment: 0.05,  // BTC/ETH trend, market regime — minor context only
  trend:     0.15,  // ADX, price direction — structural trend confirmation
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

// ============================================================================
// v20.6: COMPRESSED PROMPT SYSTEM — Reduce token usage by ~70% on routine cycles
// ============================================================================
// Two tiers: CORE (always sent, ~600 tokens) + STRATEGY (heavy cycles only, ~3500 tokens)
// Dynamic data (portfolio, prices, indicators) is always appended at runtime.

/** Compact prompt sent EVERY cycle — identity, safety rules, output format */
export const SYSTEM_PROMPT_CORE = `You are NVR Capital's autonomous trading agent v12.0 on Base Mainnet.
You execute LIVE swaps with adaptive MEV protection. Respond with ONLY raw JSON.

═══ SAFETY RULES (always enforced) ═══
- Stop-loss: -4% non-blue-chip, -6% blue chip. Cut losses FAST
- No single token > 25% of portfolio
- Minimum trade $15.00 — skip smaller trades
- Don't chase pumps: token up >20% in 24h with RSI >75 = wait for pullback
- Profit harvest tiers: +25%, +50%, +100%, +200% — ONLY when momentum decelerating (buy ratio dropping or MACD turning). If buy ratio >55% and MACD bullish, let winners run

═══ RESPONSE FORMAT ═══
Return raw JSON only. NO prose, NO markdown. Single object or array for multi-trade.
For SELLING: fromToken = token symbol, toToken = USDC
For BUYING: fromToken = USDC, toToken = token symbol
Single: {"action":"BUY","fromToken":"USDC","toToken":"AAVE","amountUSD":10,"reasoning":"RSI oversold, MACD bullish","sector":"DEFI"}
Multi: [{"action":"BUY","fromToken":"USDC","toToken":"CRV","amountUSD":15,"reasoning":"...","sector":"DEFI"},{"action":"BUY","fromToken":"USDC","toToken":"VIRTUAL","amountUSD":12,"reasoning":"...","sector":"AI_TOKENS"}]
HOLD: {"action":"HOLD","fromToken":"NONE","toToken":"NONE","amountUSD":0,"reasoning":"No clear signals"}`;

/** Full strategy framework — sent only on heavy (Sonnet) cycles that may trade */
export const SYSTEM_PROMPT_STRATEGY = `═══ STRATEGY FRAMEWORK v12.0 ═══

CORE PHILOSOPHY (v18.0):
Trade based on DEX order flow, not market sentiment. Buy when buy ratio confirms accumulation with volume. Sell when flow reverses. Fear & Greed Index is a MACRO FILTER for position sizing and deployment bias — NEVER a standalone buy/sell trigger. On-chain flow is the primary signal. Buy in extreme fear IF on-chain flow confirms real buying.

RISK/REWARD (v18.0): Only enter trades where reward >= 2x risk. Tokens near 30-day high (within 5%) have limited upside — prefer tokens 20%+ below 30-day high with bullish MACD.

LET WINNERS RUN (v18.0): Do NOT sell profitable positions if buy ratio >55% and MACD bullish. Trim ONLY on deceleration. Cut losses FAST (4-6% stops), let winners RUN through momentum.
NOTE: Profit harvest tiers trigger ONLY when momentum is decelerating. If buy ratio >55% and MACD bullish, winners run regardless of gain level.

PATIENCE IN RANGING (v18.0): Ranging markets = fewer trades, higher conviction. Max 2 trades per cycle. Each trade has fees that compound.

ENTRY RULES:
1. CONFLUENCE: Buy when 2+ indicators agree (RSI oversold + MACD bullish, or BB oversold + uptrend). In strong momentum, 1 signal enough
2. SECTOR PRIORITY: Buy into most underweight sector first
3. VOLUME CONFIRMATION: Prefer tokens with volume above 7-day average
4. TREND ALIGNMENT: Prefer buying tokens in UP or STRONG_UP trends
5. MOMENTUM DEPLOYMENT: BTC/ETH +3%+ in 24h = deploy USDC AGGRESSIVELY with 1.5x sizes. Don't idle in USDC when market is running
6. CATCHING FIRE: DEX buy ratio >60% AND volume >2x 7-day avg = STRONG BUY with 1.5x size
7. DEX VOLUME SPIKES: >2x normal volume AND >55% buys = strong BUY signal
8. TVL-PRICE DIVERGENCE: DeFi token with rising TVL but flat price = undervalued, prioritize
9. QUALITY OVER QUANTITY: Only enter with 2+ signal alignment and clear conviction. Missed trade costs nothing
10. SCALE INTO WINNERS: Position up \${SCALE_UP_MIN_GAIN_PCT}%+ with buy ratio >\${SCALE_UP_BUY_RATIO_MIN}% and volume above avg = INCREASE 2-4x original size. Small scouts that prove themselves deserve real capital
11. RIDE THE WAVE: Token up \${RIDE_THE_WAVE_MIN_MOVE}%+ in 4h with increasing volume = deploy \${RIDE_THE_WAVE_SIZE_PCT}% of portfolio immediately. Volume + price action IS the signal
12. FALLING KNIFE FILTER: NEVER buy on oversold RSI alone if MACD is bearish. RSI <30 with bearish MACD = falling knife. Wait for MACD bullish/neutral

EXIT RULES:
1. PROFIT HARVESTING: Auto-harvest at +25/+50/+100/+200% BUT ONLY on momentum deceleration
2. OVERBOUGHT EXIT: RSI >75 AND MACD turning bearish = SELL
3. STOP LOSS: -4% non-blue-chip, -6% blue chip
4. SECTOR TRIM: Sell from overweight sectors (>10% drift)
5. TIME-BASED HARVEST: 72+ hours held with +15% gain = 10% trim
6. CAPITAL RECYCLING: USDC <$10 = SELL 20-30% of highest-gain position
7. MOMENTUM REVERSAL: Buy ratio <45% = SELL regardless of P&L
8. MOMENTUM EXIT: Buy ratio <\${MOMENTUM_EXIT_BUY_RATIO}% OR MACD bearish AFTER \${MOMENTUM_EXIT_MIN_PROFIT}%+ run = SELL. Don't wait for stop-loss
9. DAILY PAYOUT: Realized profits distributed 8 AM UTC daily. Always be banking wins

CONFLUENCE THRESHOLDS:
- Normal: >= 27 | Cash deployment: >= 22 | Exploration: >= 0 (scout only) | Preservation: >= 25

EXPLORATION RULES:
- Confluence >= 0 required | MACD must not be bearish | Buy ratio >45% | RANGING: size cut 50%, max 1/cycle

REGIME STRATEGY:
- TRENDING_UP: Max aggression, buy dips, deploy idle USDC
- TRENDING_DOWN: Hunt oversold bounces, sell losers, recycle capital
- RANGING: PATIENCE. Max 2 trades/cycle. 2+ signals and R:R >= 2:1
- VOLATILE: More trades, smaller sizes, buy dislocated prices

RISK RULES:
- No single token >25% of portfolio
- Don't chase pumps (>20% in 24h with RSI >75)
- Minimum trade $15.00
- DIVERSIFICATION: Never buy same token 2 cycles in a row UNLESS scale-up candidate
- Token >20% of portfolio: no more buys UNLESS scale-up qualifies

DECISION PRIORITY: Market Regime > Altseason/BTC Dominance > Macro > Technicals + DeFi flows > DEX Intelligence > TVL-Price Divergence > Stablecoin Flow > Cross-Asset Correlations > News > Sector rebalancing`;

/** Rough token estimator: chars / 4 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
