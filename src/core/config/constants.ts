/**
 * Never Rest Capital — Shared Constants
 * Extracted from agent-v3.2.ts for v6.0 modular architecture
 */

import { createRequire } from 'module';
const _require = createRequire(import.meta.url);

/** Bot version from package.json */
export const BOT_VERSION: string = _require('../../../package.json').version;

// ============================================================================
// CHAIN CONFIGURATION — Multi-chain support (v21.3)
// ============================================================================

import { activeChain } from './chain-config.js';
export { activeChain } from './chain-config.js';

/** Active chain ID (Base=8453, Ethereum=1, Arbitrum=42161) */
export const BASE_CHAIN_ID = activeChain.chainId;

/** USDC on active chain (checksummed) */
export const BASE_USDC_ADDRESS = activeChain.usdc.address;

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
  // 'Forced interval' REMOVED v21.21.1 — routine forced-interval heartbeats are exactly the
  // cycle type v21.21 routing wants on the cheap tier. v21.1 put it here to force Sonnet in
  // "difficult markets", but v21.21 tightened isDifficultMarket so the difficult-market path
  // catches the real emergencies on its own. Keeping this entry made v21.21 a no-op on ~95%
  // of cycles — routine heartbeats fire with reason='Forced interval' and were matching here.
] as const;

// ============================================================================
// GEMMA 4 / OLLAMA INTEGRATION (v21.2)
// ============================================================================

/** Local Gemma 4 26B-A4B via Ollama for routine heartbeat cycles */
export const AI_MODEL_GEMMA = 'gemma4:26b';

/** Ollama base URL — configurable via OLLAMA_BASE_URL env var */
export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434';

/** Timeout for Ollama health check probe */
export const OLLAMA_HEALTH_CHECK_TIMEOUT_MS = 5_000;

/** Timeout for Ollama chat completion requests */
export const OLLAMA_REQUEST_TIMEOUT_MS = 120_000;

/** How often to re-probe Ollama availability (5 minutes) */
export const OLLAMA_HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Thresholds for escalating Gemma decisions to Claude QC */
export const GEMMA_ESCALATION_CONFIG = {
  /** Trade exceeding this % of portfolio triggers escalation */
  maxTradePercentOfPortfolio: 5,
  /** Trade exceeding this USD amount triggers escalation */
  maxTradeAmountUSD: 200,
  /** Keywords in Gemma's reasoning that trigger escalation */
  uncertaintyKeywords: [
    'uncertain', 'unsure', 'not confident', 'risky',
    'unclear', 'ambiguous', 'difficult to assess',
  ],
  /** Max concurrent non-HOLD actions before escalation */
  maxConcurrentTrades: 3,
} as const;

// ============================================================================
// GROQ INTEGRATION (v21.14) — OpenAI-compatible, cloud-hosted, near-zero cost
// ============================================================================

/** Groq API base URL (OpenAI-compatible) */
export const GROQ_BASE_URL = 'https://api.groq.com/openai';

/** Fast cheap model for routine pre-screening (~$0.05/1M tokens, 750 tokens/s) */
export const GROQ_MODEL_FAST = 'llama-3.1-8b-instant';

/** Smarter model for moderate-confidence decisions (~$0.59/1M tokens) */
export const GROQ_MODEL_SMART = 'llama-3.3-70b-versatile';

/** Timeout for Groq requests */
export const GROQ_REQUEST_TIMEOUT_MS = 30_000;

/** Cerebras API base URL (OpenAI-compatible, ~2000 tokens/s at <$1/1M) */
export const CEREBRAS_BASE_URL = 'https://api.cerebras.ai/v1';

/** Llama 3.3-70B via Cerebras — high quality, ultra-fast inference */
export const CEREBRAS_MODEL = 'llama-3.3-70b';

/** Timeout for Cerebras requests (fast inference — 15s is generous) */
export const CEREBRAS_REQUEST_TIMEOUT_MS = 15_000;

// ============================================================================
// DEEPINFRA INTEGRATION (v21.20 — NVR-SPEC-018 Brain+Hands Architecture)
// DeepSeek V3.2 is the primary NVR-TRADER workhorse: ~90% of Sonnet-4 reasoning
// quality at ~1/10 the cost. OpenAI-compatible endpoint.
// Pricing (2026-04): $0.28/MTok input, $0.42/MTok output.
// ============================================================================

/** DeepInfra OpenAI-compatible API base URL */
export const DEEPINFRA_BASE_URL = 'https://api.deepinfra.com/v1/openai';

/** DeepSeek V3.2 via DeepInfra — Sonnet-class reasoning at OSS prices */
export const DEEPINFRA_MODEL_DEFAULT = 'deepseek-ai/DeepSeek-V3';

/** Timeout for DeepInfra requests */
export const DEEPINFRA_REQUEST_TIMEOUT_MS = 60_000;

// ============================================================================
// NVR-SPEC-018 BRAIN+HANDS MODE (v21.20)
// Flip the default: OSS makes per-cycle decisions, Claude supervises.
// OSS_TRADER_MODE env controls the master switch.
// ============================================================================

/** Trade % of portfolio that forces GUARDIAN (Claude review) */
export const GUARDIAN_RISKY_PCT_DEFAULT = 0.05;

/** Token age (hours) under which GUARDIAN always reviews */
export const GUARDIAN_NOVEL_TOKEN_HOURS_DEFAULT = 48;

/** OSS confidence below this triggers GUARDIAN review */
export const GUARDIAN_MIN_CONFIDENCE_DEFAULT = 0.55;

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
export const STAGNATION_THRESHOLD_HOURS = 6; // v12.2.7: 1h → 4h; auditor Apr-2026: 4h → 6h — extreme fear (F&G 23) + RANGING regime warrants patience; reduces forced friction trades by ~33%

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
  TRENDING_DOWN: 0.75,  // v9.4: Raised from 0.6; auditor Apr-2026: lowered 0.85→0.75 — 46-day bear/extreme-fear tightens sizing without killing activity
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

/** Trailing stop distance in ATR units
 *  v21.25: widened from 2.0 → 2.5. CRITIC Audit 2026-04-24 (n=274 trades, 168h)
 *  found the bot captured -24% of available entry-to-current move on round-trips,
 *  bailing on +115%, +104%, +33% movers. Wider trail gives running winners more
 *  room before profit-taking pulls the rip cord. Pulling profits is still the
 *  edge — but the trail was over-tightening on noise. */
export const ATR_TRAILING_STOP_MULTIPLIER = 2.5;

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
 *  v21.6: Lowered from 8/12/18/25x to 4/7/12/18x — bot was sitting fully deployed
 *  with no dry powder for days. First harvest now triggers at ~4x ATR (~8-12% gain).
 *  The let-winners-run filter still prevents harvesting during strong momentum. */
export const ATR_PROFIT_TIERS = [
  { atrMultiple: 4,  sellPercent: 15, label: "ATR_EARLY" },
  { atrMultiple: 7,  sellPercent: 20, label: "ATR_MID" },
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
export const KELLY_FRACTION = 0.35;           // Bear-adjusted Apr-2026: Quarter-Kelly range (was 0.5 half-Kelly); 46-day bear + auditor ceiling already at 14% → 0.35×14%=4.9% effective max vs 7% prior
export const KELLY_MIN_TRADES = 20;           // Need at least 20 trades before Kelly kicks in
export const KELLY_ROLLING_WINDOW = 30;       // Bear-adjusted Apr-2026: 50→30 — tighter recent window responds faster to bear-market win-rate decay
export const KELLY_POSITION_FLOOR_USD = 3;    // v19.0: Lowered from $15 to $3 — allow scout micro-positions
export const KELLY_POSITION_CEILING_PCT = 14;  // 14% of portfolio per trade — bear-adjusted (was 18%); with TRENDING_DOWN ×0.75 → 10.5% effective max; auditor Apr-2026: 46-day bear warrants Quarter-Kelly-range caps
export const KELLY_SMALL_PORTFOLIO_CEILING_PCT = 30; // Boost for <$10K portfolios — $5K × 30% = $1,500 max per position
export const KELLY_SMALL_PORTFOLIO_THRESHOLD = 10_000; // Portfolio under $10K gets the boosted ceiling

/**
 * Volatility-Adjusted Sizing
 * Size = BaseSize × (TargetVol / CurrentVol)
 */
export const VOL_TARGET_DAILY_PCT = 1.5;       // Bear-adjusted Apr-2026: 1.5% target tightens VAPS multiplier in 2-4% vol range by ~25% (was 2%; matches 46-day bear-market realized-vol reality)
export const VOL_HIGH_THRESHOLD = 6;           // >6% daily vol → reduce size by 60% (was 8; bear-adjusted Apr-2026: 6-8% vol common in bear markets, VAPS warrants earlier trigger)
export const VOL_HIGH_REDUCTION = 0.4;         // Multiplier when vol > threshold (1 - 0.6 = 0.4)
export const VOL_LOW_THRESHOLD = 1;            // <1% daily vol → increase size by 50%
export const VOL_LOW_BOOST = 1.2;              // Bear-adjusted May-2026: 1.5→1.2 — 54-day bear; low-vol periods in sustained bears are distribution windows, not bull consolidations; 1.5× oversize into bear traps; 1.2× maintains tactical flexibility without over-committing
export const VOL_LOOKBACK_DAYS = 7;            // Rolling window for vol calculation

/**
 * Portfolio-Wide Drawdown Circuit Breaker
 * Triggers on ANY of these conditions
 */
export const BREAKER_CONSECUTIVE_LOSSES = 5;   // 5 consecutive losing trades → pause (less hair-trigger)
export const BREAKER_DAILY_DD_PCT = 7;         // 7% daily drawdown → pause (auditor Apr-2026: tightened 8→7; industry practice 5-6%, bear-market defensive posture warrants earlier pause)
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
// v21.11: GAS — Raptor 3. Inline check baked into trade execution. No external service.
// ============================================================================

/** ETH below this triggers an inline USDC→ETH top-up before the trade executes */
export const GAS_MIN_ETH_FOR_TRADE = 0.003;

/** USDC amount to swap inline when gas is low — enough for ~600 Base L2 transactions */
export const GAS_INLINE_TOP_UP_USDC = 3.00;

/** On each profitable payout day, convert this much USDC→ETH as gas reservoir.
 *  Self-funds gas from bot's own earnings. ~$0.50 × 200 profitable days = $100/yr per bot,
 *  covering ~10,000+ transactions at current Base L2 gas prices. */
export const GAS_RESERVOIR_DAILY_USD = 0.50;

// ============================================================================
// v21.12: HOT MOVER SCANNER — Gemma-era always-on market radar
// ============================================================================

/** Min 1h price gain to qualify as a hot mover (%) */
export const HOT_MOVER_MIN_CHANGE_H1_PCT = 7; // Bear-adjusted Apr-2026: 5→7 — 46-day bear; 5% h1 pumps reverse ~70% of the time in bear markets; require stronger conviction

/** Min 1h volume to confirm the move is real (not illiquid pump) */
export const HOT_MOVER_MIN_VOLUME_H1_USD = 150_000;

/** Min pool liquidity — below this is a rug risk, skip it */
export const HOT_MOVER_MIN_LIQUIDITY_USD = 75_000;

/** How often to scan GeckoTerminal trending pools (ms) — reuses cached data, free */
export const HOT_SCAN_INTERVAL_MS = 90_000;

/** Cooldown per token after it fires a hot mover alert — prevents spam re-alerting */
export const HOT_MOVER_COOLDOWN_MS = 25 * 60 * 1000;

/** When hot movers are detected, override adaptive cycle to run within this many ms */
export const HOT_MOVER_URGENT_CYCLE_MS = 90_000;

/** Hot mover quality gate: minimum FDV ($500K — reject micro-cap rugs) */
export const HOT_MOVER_MIN_FDV_USD = 500_000;

/** Hot mover quality gate: maximum FDV ($300M — not already fully mooned) */
export const HOT_MOVER_MAX_FDV_USD = 300_000_000;

/** Hot mover quality gate: pool must be at least this old in hours (reject brand-new pools = rug risk) */
export const HOT_MOVER_MIN_POOL_AGE_HOURS = 24;

/** Hot mover quality gate: minimum buy ratio in h1 (55%+ buys = genuine demand, not sell-off) */
export const HOT_MOVER_MIN_BUY_RATIO = 0.55;

// ============================================================================
// v21.13: ICU WATCH MODE — Intensive monitoring for new/small-cap positions
// ============================================================================

/** Loss % from entry price that triggers an immediate ICU exit (positive number, applied as negative) */
export const ICU_STOP_LOSS_PCT = 15;

/** Hours a position must survive at > ICU_STABLE_THRESHOLD_PCT before graduating to ESTABLISHED */
export const ICU_GRADUATION_HOURS = 4;

/** Minimum P&L % required to graduate out of ICU (position must not be deeply underwater) */
export const ICU_STABLE_THRESHOLD_PCT = -5;

/** How often to send a Telegram progress update while a position is in ICU (ms) */
export const ICU_ALERT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/** How often the ICU scanner runs (ms) — tighter than the main cycle */
export const ICU_SCAN_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

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
// v21.1: Confluence discounts REMOVED — high cash does not justify weak entries.
// Claude sees the cash % and deploy budget in the prompt and decides on merit.
// The tiers still control deploy budget and max entries per cycle.
export const CASH_DEPLOYMENT_TIERS = [
  { cashPct: 20, deployPct: 30, confluenceDiscount: 0, maxEntries: 2, label: 'LIGHT' as const },
  { cashPct: 35, deployPct: 50, confluenceDiscount: 0, maxEntries: 3, label: 'MODERATE' as const },
  { cashPct: 50, deployPct: 70, confluenceDiscount: 0, maxEntries: 4, label: 'AGGRESSIVE' as const },
  { cashPct: 65, deployPct: 80, confluenceDiscount: 0, maxEntries: 5, label: 'URGENT' as const },
];

/** Backwards-compatible: lowest tier threshold. Used by forced deploy gate check in normal markets. */
export const CASH_DEPLOYMENT_THRESHOLD_PCT = 20; // v20.3.1: 25% → 20% (match first tier)

/** v20.8: F&G demoted to info-only. Deployment thresholds are now purely momentum-based.
 *  The bot follows price physics (capital flows, momentum, volume), not sentiment surveys.
 *  CASH_DEPLOY_FEAR_THRESHOLDS removed — threshold is always CASH_DEPLOYMENT_THRESHOLD_PCT. */

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
/** RPC endpoints for active chain (v21.3: from chain config) */
export const BASE_RPC_ENDPOINTS = activeChain.rpcEndpoints;

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
export const PRICE_SANITY_MAX_DEVIATION = 0.30; // 30% — v20.6: tightened from 50% to reject volatile meme coin price swings

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

/** Large trade threshold in USD — trades above this are "smart money"
 *  Base L2 pools ($100K-$1.5M typical) see whale moves at $2.5K+ not $5K+ (Ethereum floor) */
export const LARGE_TRADE_THRESHOLD_USD = 2500;

/** Uniswap V3 Swap event topic hash */
export const SWAP_EVENT_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';

/** TWAP observation period in seconds (15 minutes) */
export const TWAP_OBSERVATION_SECONDS = 900;

// ============================================================================
// v13.0: SCALE-INTO-WINNERS — Deploy real capital into proven positions
// ============================================================================

/** Position must be up this % from cost basis to qualify for scale-up */
export const SCALE_UP_MIN_GAIN_PCT = 5; // Bear-adjusted Apr-2026: 3→5 — 3% gains reverse easily in 46-day bear; require stronger confirmation before adding capital

/** Buy ratio must exceed this % to confirm momentum for scale-up */
export const SCALE_UP_BUY_RATIO_MIN = 55;

/** Deploy this % of portfolio on each scale-up buy */
export const SCALE_UP_SIZE_PCT = 4;

/** Exit when buy ratio drops below this % on a profitable position */
export const MOMENTUM_EXIT_BUY_RATIO = 45;

/** Only momentum-exit if position was up this %+ (don't panic sell small gains) */
export const MOMENTUM_EXIT_MIN_PROFIT = 5;

/** Token must be up this %+ in 4h to qualify as a wave ride */
export const RIDE_THE_WAVE_MIN_MOVE = 7; // Bear-adjusted Apr-2026: 5→7 — F&G 31 (Fear); 5% 4h bounces reverse ~65% in fear markets; require stronger wave confirmation before chasing

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
// v21.9: POSITION GRADUATION / STALE RESEARCH CULL
// Auto-exit research positions ($5–$100) that have sat >7 days with no momentum.
// This is the middle tier between dust cleanup (<$5) and meaningful holds (>$100).
// ============================================================================

/** Minimum position age in hours before culling is considered (7 days) */
export const CULL_MIN_AGE_HOURS = 168;

/** Only cull positions under this USD value — don't touch meaningful holds */
export const CULL_MAX_USD = 100;

/** Position must be flat or losing to qualify — don't cull winners */
export const CULL_MIN_PNL_PCT = -5;

/** If 24h price change exceeds this %, skip — token still has momentum */
export const CULL_MAX_MOMENTUM = 3;

/** How often (in cycles) to run the culling pass (~5h at 15min intervals) */
export const CULL_INTERVAL_CYCLES = 20;

/** Max positions to sell per culling pass */
export const CULL_MAX_PER_RUN = 3;

// ============================================================================
// STALE POSITION EXIT — Fast-exit discipline for meaningful positions
//
// Complements CULL_* (which targets <$100 research positions held 7+ days).
// This rule catches meaningful-sized positions ($100+) that have been held
// long enough to prove their thesis (48h+) but remain flat with weak flow.
// When a position sits without working, capital should move — either to a
// fresh signal or back to the alpha-strike reserve.
//
// Aligned with the "fast safe exits" pillar — don't sit through dead money.
// Strategic rationale: see project_nvr_strategy_shape memory.
// ============================================================================

/** Minimum age before a meaningful position is eligible for stale-exit */
export const STALE_POSITION_MIN_AGE_HOURS = 48;

/** Only consider positions above this USD value — smaller tier is cullStalePositions' job */
export const STALE_POSITION_MIN_USD = 100;

/** Max unrealized gain %; above this, the position is a quiet winner — let it run.
 *  v21.25: lowered from 3 → 1. CRITIC flagged systemic early exits — even modest
 *  winners (+1% to +3%) deserve the exemption. Stale-exit now only catches truly
 *  flat or losing meaningful positions. Kill switch: STALE_POSITION_MAX_GAIN_PCT
 *  is a constant (no env), so revert by recompile if behavior regresses. */
export const STALE_POSITION_MAX_GAIN_PCT = 1;

/** v21.14 SPEC-015: UP-momentum threshold for exemption. Only *positive* moves above
 * this exempt a position from stale-exit. A bleeding micro-cap always has noise;
 * down-momentum must not hide it. See [[Pulling profits is the edge, not picking winners]]. */
export const STALE_POSITION_MAX_MOMENTUM_PCT = 2;

/** v21.14 SPEC-015: Drawdown override — positions at this unrealized P&L or worse
 * exit regardless of momentum. -8% is 1% below the default stop-loss (7%), so the
 * two rules don't fire on the same cycle with conflicting reasons. Tune if data
 * shows we're cutting recoveries too eagerly (2-week re-baseline window). */
export const STALE_POSITION_DRAWDOWN_OVERRIDE_PCT = -8;

/** Max stale-exits per check pass — avoid fire-sale */
export const STALE_POSITION_MAX_EXITS_PER_CYCLE = 2;

/** How often (in cycles) to run the stale-exit check (~1h at 15min intervals) */
export const STALE_POSITION_CHECK_INTERVAL_CYCLES = 4;

// ============================================================================
// FORCED-LIQUIDATION CONSTANTS — DELETED v21.27
//
// MIN_DRY_POWDER_PCT, RESERVE_CHECK_INTERVAL_CYCLES, RESERVE_MAX_SELLS,
// DRY_POWDER_MIN_UNREALIZED_PCT, DRY_POWDER_MIN_AGE_HOURS,
// DRY_POWDER_WINNER_PROTECTION_PCT, LIBERATION_MIN_AGE_HOURS,
// LIBERATION_WINNER_PROTECTION_PCT — all deleted with the maintainDryPowder()
// and liberateCapital() functions they configured.
//
// Why: CRITIC 14-day data 2026-04-27 — dry_powder_rebalance lost -$87 on 97
// trades; liberation lost -$76 on 20 trades, 0% win rate. Combined: -$163,
// nearly cancelling the +$486 made by harvest + ai_discretionary trades.
//
// First-principles: WETH/ETH are NEVER_SELL, so the 25% USDC floor was
// structurally unenforceable while WETH dominated (~76%). The function fired
// every cycle and sold proven alts for cents. USDC % now floats with natural
// turnover (harvest, stale-exit, drawdown override, circuit breaker).
//
// See project_nvr_session_2026_04_27 + Step 2 of Elon's algorithm:
// "if you don't add back at least 10% of what you deleted, you didn't delete enough."
// ============================================================================

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

/** Compact prompt sent EVERY cycle — identity, safety rules, output format.
 *  Version is pulled live from package.json (BOT_VERSION, defined at top of
 *  this file) so Claude is never told the wrong version. */
export const SYSTEM_PROMPT_CORE = `You are NVR Capital's autonomous trading agent v${BOT_VERSION} on Base Mainnet.
You are the SOLE decision-maker. No mechanical systems override you. You execute LIVE swaps.

═══ YOUR MISSION ═══
Grow the portfolio by riding waves of capital flow. When money moves, you move with it — FAST and DECISIVELY. When money leaves, you leave too — IMMEDIATELY to USDC. When the market is dead, you sit in USDC and WAIT. A missed trade costs nothing; a bad trade costs real money. 5 great trades beat 100 mediocre ones.

═══ YOUR POWERS ═══
You decide EVERYTHING: what to buy, what to sell, how much, when to hold. There are no forced deployments, no mechanical stop-losses, no hardcoded profit-taking. You see the full picture and you make the call.

═══ HARD SAFETY RAILS (non-negotiable, enforced by system) ═══
- No single token > 15% of portfolio
- Minimum trade $5.00
- $150 USDC always reserved for gas
- Circuit breaker: 8% daily drawdown pauses everything (not your concern — system handles it)
- Slippage/liquidity checks happen automatically

═══ DECISION FRAMEWORK ═══
1. CAPITAL DEPLOYMENT: Look at your cash %. If cash is high and momentum is positive, deploy. Size positions proportional to conviction. Don't drip — deploy meaningfully when you see opportunity.
2. EXIT DECISIONS: Cut positions when the physics change — flow reversal (buy ratio dropping), momentum deceleration, MACD turning bearish on a winner. Don't wait for arbitrary % thresholds.
3. HOLD: If nothing is compelling, say HOLD. Being patient is profitable. Every trade has fees.
4. SIZING: Scale with conviction. High confluence + strong momentum = larger position. Weak signals = smaller or skip.

═══ RESPONSE FORMAT ═══
Return raw JSON only. NO prose, NO markdown. Single object or array for multi-trade.
For SELLING: fromToken = token symbol, toToken = USDC
For BUYING: fromToken = USDC, toToken = token symbol
Single: {"action":"BUY","fromToken":"USDC","toToken":"AAVE","amountUSD":50,"reasoning":"RSI oversold + MACD bullish + buy ratio 62% — strong confluence","sector":"DEFI"}
Multi: [{"action":"BUY",...},{"action":"SELL",...}]
HOLD: {"action":"HOLD","fromToken":"NONE","toToken":"NONE","amountUSD":0,"reasoning":"No clear signals — staying patient"}`;

/** Full strategy framework — sent only on heavy (Sonnet) cycles that may trade */
export const SYSTEM_PROMPT_STRATEGY = `═══ STRATEGY FRAMEWORK v${BOT_VERSION} — FOLLOW THE PHYSICS ═══

CORE PHILOSOPHY:
You are a wave rider. Capital flows create waves — money rushing into an asset lifts the price. Your job is to detect the wave early, ride it hard, and exit when momentum fades. You don't create waves, you don't fight them, and you don't sit idle when one is forming.

When the market is DEAD — no waves, no flows, conflicting signals — you sit in USDC and wait. Patience IS the trade. A missed opportunity costs nothing. A forced trade in a dead market bleeds real money through fees and slippage.

When the market is ALIVE — capital flowing, momentum building, BTC/ETH moving — you deploy aggressively. 10 trades in an hour is fine if each one is riding a real wave. Volume is a function of OPPORTUNITY, not a constant.

═══ THE PHYSICS OF CAPITAL ═══
- Money flows in → buy ratio rising, volume increasing → price accelerates → RIDE IT
- Money flows out → buy ratio dropping, volume declining → price decelerating → EXIT TO USDC
- No clear flow → conflicting signals, low volume, sideways → HOLD USDC, WAIT
- Sudden reversal → what was flowing out starts flowing in → REACT FAST, deploy into the new wave

═══ WHEN TO BUY ═══
- THE WAVE: Buy ratio >55% AND rising, volume above average, MACD bullish or turning — capital is arriving. Deploy NOW
- CATCHING FIRE: BTC/ETH up +2% and accelerating — everything lifts. Get exposure to the strongest movers
- CONVICTION ENTRY: 3+ indicators aligned (RSI oversold + MACD bullish + volume spike + positive flow) = max size
- ADDING TO WINNERS: Position is UP with strong continuing flow = add more. Double down on what's working
- NEVER: Buy into falling knives (RSI <30 + MACD bearish). Wait for the turn, THEN buy
- NEVER: Buy because cash is high. Cash is not a problem — bad trades are

═══ WHEN TO SELL ═══
- THE WAVE DIES: Buy ratio drops below 45% + volume declining = capital is leaving. Leave with it. Don't hope
- MOMENTUM EXHAUSTION: Big run + MACD turning bearish + volume drying up = take profits into strength
- PHYSICS CHANGED: What was working stops working. Cut it. Don't average down on broken momentum
- LOSS LIMIT: Down 5-8% with bearish flow = cut immediately. Protect capital for the next wave
- THESIS PLAYED OUT: Meaningful position held >48h with <3% gain and weak 24h momentum — exit. The stale-exit rule auto-fires every 4 cycles for $100+ positions that match; you should pre-empt that by rotating out before it triggers.

═══ WHEN TO HOLD ═══
- Market is dead. No clear flows. Conflicting signals. Low volume. HOLD IS THE MOVE
- Winners still running — buy ratio >55%, MACD bullish, volume steady. LET THEM RUN
- You just entered a position — give it at least 1-2 cycles to develop before cutting
- Nothing passes the conviction bar. 0 trades is better than 5 mediocre trades

═══ SIZING — SCALE WITH CONVICTION ═══
- No conviction = no trade. Skip entirely
- Moderate conviction (2 signals aligned): $30-$60
- High conviction (3+ signals, strong flow): $80-$200
- Adding to a winner with continued momentum: $50-$150
- Max single position: 15% of portfolio
- DO NOT size down to $8-$15 "probes" — either you believe in it or you don't

═══ REGIME AWARENESS ═══
- TRENDING_UP: This is your time. Deploy capital aggressively. Ride every wave. Multiple trades per cycle. ADD to winners
- TRENDING_DOWN: Be a sniper. Only the strongest setups. Smaller sizes. Quick exits. Preserve USDC
- RANGING: The trap. Most losses happen here from overtrading. HOLD unless signal is screaming. 0-2 trades max
- VOLATILE: Dislocations create opportunity. Quick entries, quick exits. Don't hold through the chaos

═══ SELF-AWARENESS ═══
Look at your recent trade history. If your last 5 sells were losses, you are in a losing streak — REDUCE ACTIVITY, not increase it. The market is not giving right now. Wait for it to change.

If your win rate today is below 20%, stop and HOLD until next cycle. Something in the market isn't matching your reads.

═══ DECISION PRIORITY ═══
Capital Flow & Momentum > Price Action > On-Chain Flow (buy ratio, volume) > Technical Indicators (RSI, MACD) > Everything Else

Sector balance is a GUIDELINE, not a rule. If DeFi is where the wave is, go 100% DeFi. If memes are ripping, ride memes. Follow the money, not the spreadsheet.

═══ CASH DISCIPLINE (THE ONE HARD RULE) ═══
Maintain ~25% of portfolio in USDC as dry powder. This is a RULE, not a guideline. The reserve exists for alpha strikes — when a meme/alt opportunity appears, deploy from the reserve and exit fast. Do NOT drain the reserve to add to existing winners or chase sector rotations — that's what the other 75% is for. If USDC drops below 25%, the reserve restorer will auto-sell the weakest positions to refill; avoid triggering that by leaving room before deploying aggressively. The reserve is rolling, not idle: USDC → alpha entry → fast exit → USDC.`;

/** Rough token estimator: chars / 4 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
