/**
 * NVR Capital — Signal Service Intel Collector
 *
 * Fetches raw market data (Fear & Greed, BTC dominance, prices) and runs
 * computeMacroRegime() to produce a single authoritative IntelPayload.
 *
 * Data sources (all public or API-key-gated):
 *   - alternative.me/fng    → Fear & Greed index (free, no key)
 *   - api.kraken.com        → BTC/ETH spot prices (free, no key, US-accessible)
 *   - pro-api.coinmarketcap → BTC dominance (free tier, CMC_API_KEY required)
 *
 * Regime computation uses the same computeMacroRegime() as the live bot,
 * ensuring 100% consistency between Signal Service and any fallback local run.
 *
 * Refresh cadence: every 5 minutes (driven by signal-service.ts scheduler).
 * Bots poll /intel and skip their own independent fetches when intel is fresh.
 */

import axios from 'axios';
import { computeMacroRegime } from '../algorithm/macro-regime.js';
import type { IntelPayload } from './types.js';

// ============================================================================
// ROLLING BUFFERS — in-memory, rebuilt from scratch on restart
// ============================================================================

// BTC close prices for SMA/RSI computation
// 300 samples @ 5-min cadence = 25 hours. Need 50 for SMA50, 140 for SMA140.
const btcPriceBuffer: number[] = [];
const MAX_PRICE_BUF = 300;

// BTC dominance readings for trend computation
// 2016 samples @ 5-min cadence = 7 days
const dominanceBuffer: number[] = [];
const MAX_DOM_BUF = 2016;

// ============================================================================
// REGIME STATE
// ============================================================================

let consecutiveBearChecks = 0;
let lastRefreshMs = 0;
let lastRegime: 'BULL' | 'RANGING' | 'BEAR' = 'RANGING';
export let latestIntel: IntelPayload | null = null;

// Callback fired when regime transitions (for Telegram alerts)
type RegimeChangeHandler = (prev: string, next: string, payload: IntelPayload) => void;
let onRegimeChange: RegimeChangeHandler | null = null;

export function setRegimeChangeHandler(handler: RegimeChangeHandler): void {
  onRegimeChange = handler;
}

// ============================================================================
// FETCHERS
// ============================================================================

async function fetchFearGreed(): Promise<number> {
  try {
    const res = await axios.get('https://api.alternative.me/fng/', { timeout: 8000 });
    const raw = res.data?.data?.[0]?.value;
    const val = parseInt(raw ?? '50');
    return isNaN(val) ? 50 : Math.max(0, Math.min(100, val));
  } catch {
    return latestIntel?.fearGreed ?? 50; // stale fallback
  }
}

async function fetchKrakenPrices(): Promise<{ btc: number; eth: number }> {
  try {
    const [btcRes, ethRes] = await Promise.allSettled([
      axios.get('https://api.kraken.com/0/public/Ticker?pair=XBTUSD', { timeout: 8000 }),
      axios.get('https://api.kraken.com/0/public/Ticker?pair=ETHUSD', { timeout: 8000 }),
    ]);

    let btc = latestIntel?.btcPrice ?? 0;
    let eth = latestIntel?.ethPrice ?? 0;

    if (btcRes.status === 'fulfilled') {
      const result = btcRes.value.data?.result;
      const pair = result ? Object.values(result)[0] as any : null;
      const raw = parseFloat(pair?.c?.[0] ?? '0');
      if (raw > 1000) btc = raw; // sanity: BTC > $1000
    }
    if (ethRes.status === 'fulfilled') {
      const result = ethRes.value.data?.result;
      const pair = result ? Object.values(result)[0] as any : null;
      const raw = parseFloat(pair?.c?.[0] ?? '0');
      if (raw > 100) eth = raw; // sanity: ETH > $100
    }
    return { btc, eth };
  } catch {
    return { btc: latestIntel?.btcPrice ?? 0, eth: latestIntel?.ethPrice ?? 0 };
  }
}

async function fetchBtcDominance(): Promise<number> {
  const cmcKey = process.env.CMC_API_KEY;
  if (!cmcKey) return latestIntel?.btcDominance ?? 0;

  try {
    const res = await axios.get(
      'https://pro-api.coinmarketcap.com/v1/global-metrics/quotes/latest',
      { headers: { 'X-CMC_PRO_API_KEY': cmcKey, Accept: 'application/json' }, timeout: 8000 }
    );
    const raw = res.data?.data?.btc_dominance;
    const val = typeof raw === 'number' ? raw : parseFloat(raw ?? '0');
    return isNaN(val) ? latestIntel?.btcDominance ?? 0 : val;
  } catch {
    return latestIntel?.btcDominance ?? 0;
  }
}

// ============================================================================
// MAIN REFRESH
// ============================================================================

export async function refreshIntel(): Promise<IntelPayload> {
  // Fetch all data sources in parallel — each has its own timeout + fallback
  const [fearGreed, prices, btcDominance] = await Promise.all([
    fetchFearGreed(),
    fetchKrakenPrices(),
    fetchBtcDominance(),
  ]);

  const { btc: btcPrice, eth: ethPrice } = prices;

  // ── Update rolling price buffer ────────────────────────────────────────────
  if (btcPrice > 0) {
    btcPriceBuffer.push(btcPrice);
    if (btcPriceBuffer.length > MAX_PRICE_BUF) {
      btcPriceBuffer.splice(0, btcPriceBuffer.length - MAX_PRICE_BUF);
    }
  }

  // ── Update dominance buffer ────────────────────────────────────────────────
  if (btcDominance > 0) {
    dominanceBuffer.push(btcDominance);
    if (dominanceBuffer.length > MAX_DOM_BUF) {
      dominanceBuffer.splice(0, dominanceBuffer.length - MAX_DOM_BUF);
    }
  }

  // ── Compute 7-day dominance trend ─────────────────────────────────────────
  // Need ≥24h (288 readings @ 5-min) before the trend is meaningful.
  // Lookback: up to 7 days (2016 readings).
  let btcDominanceTrend: number | null = null;
  if (dominanceBuffer.length >= 288 && btcDominance > 0) {
    const lookback = Math.min(2016, dominanceBuffer.length - 1);
    const oldVal = dominanceBuffer[dominanceBuffer.length - 1 - lookback];
    if (oldVal > 0) btcDominanceTrend = btcDominance - oldVal;
  }

  // ── Run regime computation ────────────────────────────────────────────────
  const regime = btcPriceBuffer.length >= 50
    ? computeMacroRegime(
        btcPriceBuffer,
        btcDominanceTrend !== null ? btcDominanceTrend : undefined,
        fearGreed
      )
    : {
        regime: 'RANGING' as const,
        score: 0,
        confidence: 0,
        signals: { trend: 0, dominance: 0, sentiment: 0 },
      };

  // ── Hysteresis: require 3 consecutive BEAR readings ────────────────────────
  const prevRegime = lastRegime;
  if (regime.regime === 'BEAR') {
    consecutiveBearChecks = Math.min(consecutiveBearChecks + 1, 10);
  } else {
    consecutiveBearChecks = 0;
  }
  lastRegime = regime.regime;

  const inBearMode = consecutiveBearChecks >= 3;
  lastRefreshMs = Date.now();

  const intel: IntelPayload = {
    regime: regime.regime,
    score: regime.score,
    confidence: regime.confidence,
    signals: regime.signals,
    inBearMode,
    consecutiveBearChecks,
    fearGreed,
    btcDominance,
    btcDominanceTrend,
    btcPrice,
    ethPrice,
    fetchedAt: new Date().toISOString(),
    ageSec: 0,
    priceHistoryLen: btcPriceBuffer.length,
    stale: false,
  };

  latestIntel = intel;

  // ── Fire regime change alert ───────────────────────────────────────────────
  // Alert on meaningful transitions only (not RANGING↔RANGING noise).
  const changed = prevRegime !== regime.regime;
  const meaningful =
    (regime.regime === 'BEAR' && inBearMode) ||    // BEAR confirmed
    (prevRegime === 'BEAR' && regime.regime !== 'BEAR');  // exiting BEAR
  if (changed && meaningful && onRegimeChange) {
    onRegimeChange(prevRegime, regime.regime, intel);
  }

  return intel;
}

// ============================================================================
// SERVE — adds computed ageSec to the cached payload
// ============================================================================

export function getLatestIntel(): IntelPayload | null {
  if (!latestIntel) return null;
  const ageSec = Math.round((Date.now() - lastRefreshMs) / 1000);
  const stale = ageSec > 600; // 10 min — bot should self-fetch
  return { ...latestIntel, ageSec, stale };
}

export function getBufferLengths(): { prices: number; dominance: number } {
  return { prices: btcPriceBuffer.length, dominance: dominanceBuffer.length };
}

export function getConsecutiveBearChecks(): number {
  return consecutiveBearChecks;
}
