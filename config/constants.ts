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
export const HEAVY_CYCLE_FORCED_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/** Price change threshold to trigger a heavy cycle */
export const PRICE_CHANGE_THRESHOLD = 0.02; // 2%

/** Fear & Greed change threshold to trigger a heavy cycle */
export const FG_CHANGE_THRESHOLD = 5; // 5 points

/** Volume spike threshold (multiple of 7-day average) to trigger heavy cycle */
export const VOLUME_SPIKE_THRESHOLD = 2.0;

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
  TRADE_EXECUTED: 30 * 60 * 1000,    // 30 minutes
  /** After explicit HOLD decision — skip 5 cycles then re-evaluate */
  HOLD_DECISION: 10 * 60 * 1000,     // 10 minutes
  /** Signal was too weak — almost triggered, check again soon */
  WEAK_SIGNAL: 6 * 60 * 1000,        // 6 minutes
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
  stopLossPercent:       { min: -40, max: -10, maxStep: 2 },
  trailingStopPercent:   { min: -35, max: -10, maxStep: 2 },
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
