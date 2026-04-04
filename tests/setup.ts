/**
 * Shared test helpers and mock state objects for the trading bot test suite.
 */

import type { TokenCostBasis, TradeRecord, StopLossConfig } from '../src/core/services/testable/stop-loss.js';
import type { AdaptiveThresholds } from '../src/core/services/testable/adaptive-thresholds.js';
import { DEFAULT_ADAPTIVE_THRESHOLDS } from '../src/core/services/testable/adaptive-thresholds.js';

/**
 * Create a mock TokenCostBasis with sensible defaults.
 */
export function mockCostBasis(overrides: Partial<TokenCostBasis> = {}): TokenCostBasis {
  return {
    symbol: 'cbBTC',
    totalInvestedUSD: 1000,
    totalTokensAcquired: 0.015,
    averageCostBasis: 66666,
    currentHolding: 0.015,
    realizedPnL: 0,
    unrealizedPnL: 0,
    peakPrice: 69900,
    peakPriceDate: new Date('2026-03-30T12:00:00Z').toISOString(),
    firstBuyDate: new Date('2026-03-28T10:00:00Z').toISOString(),
    lastTradeDate: new Date('2026-03-30T12:00:00Z').toISOString(),
    atrStopPercent: null,
    atrTrailPercent: null,
    atrAtEntry: null,
    trailActivated: false,
    lastAtrUpdate: null,
    ...overrides,
  };
}

/**
 * Create a mock trade record.
 */
export function mockTradeRecord(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return {
    action: 'BUY',
    toToken: 'cbBTC',
    reasoning: 'FORCED_DEPLOY: High cash, deploying',
    timestamp: new Date().toISOString(),
    success: true,
    ...overrides,
  };
}

/**
 * Create a mock StopLossConfig.
 */
export function mockStopLossConfig(overrides: Partial<StopLossConfig> = {}): StopLossConfig {
  return {
    trailingEnabled: true,
    sellPercent: 100,
    ...overrides,
  };
}

/**
 * Create a mock AdaptiveThresholds object (cloned from defaults).
 */
export function mockThresholds(overrides: Partial<AdaptiveThresholds> = {}): AdaptiveThresholds {
  return { ...DEFAULT_ADAPTIVE_THRESHOLDS, ...overrides };
}

/**
 * Helper: create a timestamp N hours ago from a reference time.
 */
export function hoursAgo(hours: number, fromMs: number = Date.now()): string {
  return new Date(fromMs - hours * 60 * 60 * 1000).toISOString();
}

/**
 * Helper: create a timestamp N minutes ago from a reference time.
 */
export function minutesAgo(minutes: number, fromMs: number = Date.now()): string {
  return new Date(fromMs - minutes * 60 * 60000).toISOString();
}
