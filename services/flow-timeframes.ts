/**
 * v19.0: Multi-Timeframe Flow Aggregation
 *
 * Accumulates buy ratio readings every cycle and computes rolling averages
 * across 5m, 1h, and 4h windows. No extra RPC calls — just stores readings
 * from existing flow data and aggregates from the buffer.
 *
 * Used by surge mode: only surge when flow is positive across 2+ timeframes.
 */

export interface FlowReading {
  timestamp: number;
  buyRatio: number; // 0-100
}

export interface FlowTimeframeState {
  /** Ring buffer of flow readings per token */
  readings: Record<string, FlowReading[]>;
}

export interface FlowTimeframeResult {
  /** Average buy ratio over last 5 minutes */
  avg5m: number | null;
  /** Average buy ratio over last 1 hour */
  avg1h: number | null;
  /** Average buy ratio over last 4 hours */
  avg4h: number | null;
  /** Number of timeframes with positive flow (buy ratio > 50%) */
  positiveTimeframes: number;
  /** Whether flow is confirmed across 2+ timeframes */
  confirmed: boolean;
}

// Max readings to keep per token (~4h at 2-min cycles = 120 readings)
const MAX_READINGS_PER_TOKEN = 150;

const WINDOW_5M_MS = 5 * 60 * 1000;
const WINDOW_1H_MS = 60 * 60 * 1000;
const WINDOW_4H_MS = 4 * 60 * 60 * 1000;

export function createFlowTimeframeState(): FlowTimeframeState {
  return { readings: {} };
}

/**
 * Record a new buy ratio reading for a token.
 */
export function recordFlowReading(
  state: FlowTimeframeState,
  symbol: string,
  buyRatio: number,
): void {
  if (!state.readings[symbol]) {
    state.readings[symbol] = [];
  }

  state.readings[symbol].push({
    timestamp: Date.now(),
    buyRatio,
  });

  // Trim to max size
  if (state.readings[symbol].length > MAX_READINGS_PER_TOKEN) {
    state.readings[symbol] = state.readings[symbol].slice(-MAX_READINGS_PER_TOKEN);
  }
}

/**
 * Get multi-timeframe flow analysis for a token.
 */
export function getFlowTimeframes(
  state: FlowTimeframeState,
  symbol: string,
): FlowTimeframeResult {
  const readings = state.readings[symbol];
  if (!readings || readings.length === 0) {
    return { avg5m: null, avg1h: null, avg4h: null, positiveTimeframes: 0, confirmed: false };
  }

  const now = Date.now();

  const avg5m = averageInWindow(readings, now, WINDOW_5M_MS);
  const avg1h = averageInWindow(readings, now, WINDOW_1H_MS);
  const avg4h = averageInWindow(readings, now, WINDOW_4H_MS);

  let positiveTimeframes = 0;
  if (avg5m !== null && avg5m > 50) positiveTimeframes++;
  if (avg1h !== null && avg1h > 50) positiveTimeframes++;
  if (avg4h !== null && avg4h > 50) positiveTimeframes++;

  return {
    avg5m,
    avg1h,
    avg4h,
    positiveTimeframes,
    confirmed: positiveTimeframes >= 2,
  };
}

function averageInWindow(
  readings: FlowReading[],
  now: number,
  windowMs: number,
): number | null {
  const cutoff = now - windowMs;
  const inWindow = readings.filter(r => r.timestamp >= cutoff);
  if (inWindow.length === 0) return null;
  const sum = inWindow.reduce((acc, r) => acc + r.buyRatio, 0);
  return sum / inWindow.length;
}
