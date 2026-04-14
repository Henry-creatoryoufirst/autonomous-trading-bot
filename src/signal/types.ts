/**
 * NVR Capital — Signal Service Types
 *
 * Shared types between the Signal Service and all bots.
 * Bots import IntelPayload to consume centralized intelligence.
 */

// ============================================================================
// REGIME
// ============================================================================

export interface RegimeSignals {
  trend: number;      // -40 to +40 — price vs SMA140
  dominance: number;  // -30 to +30 — BTC dominance trend
  sentiment: number;  // -30 to +30 — Fear & Greed
}

// ============================================================================
// INTEL PAYLOAD — what /intel returns
// ============================================================================

export interface IntelPayload {
  // Macro regime
  regime: 'BULL' | 'RANGING' | 'BEAR';
  score: number;              // -100 to +100
  confidence: number;         // 0 to 1
  signals: RegimeSignals;
  inBearMode: boolean;        // true when 3+ consecutive BEAR checks
  consecutiveBearChecks: number;

  // Market data
  fearGreed: number;          // 0–100, alternative.me
  btcDominance: number;       // %, from CMC (0 if unavailable)
  btcDominanceTrend: number | null; // pp change vs 7d ago, null if insufficient history
  btcPrice: number;           // USD, from Kraken
  ethPrice: number;           // USD, from Kraken

  // Quality metadata
  fetchedAt: string;          // ISO timestamp of last successful refresh
  ageSec: number;             // seconds since last refresh (computed on serve)
  priceHistoryLen: number;    // BTC price samples in buffer (need 50 for SMA50, 140 for SMA140)
  stale: boolean;             // true when ageSec > 600 (10 min) — bots should self-fetch
}

// ============================================================================
// FLEET
// ============================================================================

export interface BotHeartbeat {
  botId: string;
  lastSeenAt: string;     // ISO timestamp
  lastSeenMs: number;     // unix ms — for computing "online" status
  totalPolls: number;     // how many times this bot has polled us
}

export interface FleetStatus {
  bots: BotHeartbeat[];
  onlineCount: number;    // bots seen in last 30 minutes
  totalBots: number;
  updatedAt: string;
}

// ============================================================================
// HISTORY
// ============================================================================

export interface SignalHistoryEntry {
  timestamp: string;       // ISO
  regime: 'BULL' | 'RANGING' | 'BEAR';
  score: number;
  fearGreed: number;
  btcPrice: number;
  btcDominance: number;
  inBearMode: boolean;
}

// ============================================================================
// PER-BOT CONFIG
// ============================================================================

export type BotProfile = 'conservative' | 'standard' | 'aggressive';

export interface BotConfig {
  botId: string;
  profile: BotProfile;
  // Strategy overrides (bots merge these with their defaults)
  confluenceBuyThreshold: number;
  maxPositionSizePct: number;  // % of portfolio per position
  stopLossPercent: number;
  bearModeEnabled: boolean;    // whether this bot honors inBearMode from intel
}

// ============================================================================
// SERVICE HEALTH
// ============================================================================

export interface ServiceHealth {
  status: 'ok' | 'degraded';
  uptimeSec: number;
  lastRefreshAt: string | null;
  lastRefreshAgeSec: number;
  priceHistoryLen: number;
  dominanceHistoryLen: number;
  fleetSize: number;
  regime: 'BULL' | 'RANGING' | 'BEAR' | 'UNKNOWN';
  score: number;
  inBearMode: boolean;
  version: string;
}
