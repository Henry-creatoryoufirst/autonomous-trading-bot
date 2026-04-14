/**
 * NVR Capital — Historical Data Layer
 *
 * Fetches OHLCV candle data from CoinGecko API (free tier).
 * Includes in-memory caching to avoid redundant API calls.
 * Also supports loading from the existing price-history.json format.
 */

import type { OHLCVCandle, HistoricalDataset, DataFetchConfig, CachedDataset } from '../types.js';

// ============================================================================
// IN-MEMORY CACHE
// ============================================================================

const dataCache = new Map<string, CachedDataset>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCacheKey(coinId: string, vsCurrency: string, days: number): string {
  return `${coinId}_${vsCurrency}_${days}`;
}

export function clearCache(): void {
  dataCache.clear();
}

export function getCachedDataset(coinId: string, vsCurrency = 'usd', days = 365): HistoricalDataset | null {
  const key = getCacheKey(coinId, vsCurrency, days);
  const cached = dataCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) {
    dataCache.delete(key);
    return null;
  }
  return cached.dataset;
}

// ============================================================================
// COINGECKO FETCHER
// ============================================================================

/**
 * Fetch OHLCV candle data from CoinGecko.
 * Uses the /coins/{id}/ohlc endpoint for OHLCV data.
 * Free tier: 30 calls/min.
 *
 * Note: CoinGecko OHLC endpoint returns [timestamp, open, high, low, close].
 * Volume is not included in OHLC — we supplement with market_chart data.
 */
export async function fetchHistoricalData(config: DataFetchConfig): Promise<HistoricalDataset> {
  const { coinId, vsCurrency = 'usd', days = 365 } = config;

  // Check cache first
  const cached = getCachedDataset(coinId, vsCurrency, days);
  if (cached) return cached;

  // Fetch OHLC data
  const ohlcUrl = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=${vsCurrency}&days=${days}`;
  const ohlcResponse = await fetch(ohlcUrl, {
    headers: { 'Accept': 'application/json' },
  });

  if (!ohlcResponse.ok) {
    throw new Error(`CoinGecko OHLC fetch failed: ${ohlcResponse.status} ${ohlcResponse.statusText}`);
  }

  const ohlcData: number[][] = await ohlcResponse.json();

  // Also fetch market chart for volume data
  const chartUrl = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=${vsCurrency}&days=${days}`;
  let volumeMap = new Map<number, number>();

  try {
    const chartResponse = await fetch(chartUrl, {
      headers: { 'Accept': 'application/json' },
    });
    if (chartResponse.ok) {
      const chartData = await chartResponse.json();
      if (chartData.total_volumes) {
        for (const [ts, vol] of chartData.total_volumes) {
          // Round timestamp to nearest hour for matching
          const roundedTs = Math.round(ts / 3600000) * 3600000;
          volumeMap.set(roundedTs, vol);
        }
      }
    }
  } catch {
    // Volume data is supplementary — continue without it
  }

  // Convert to our candle format
  const candles: OHLCVCandle[] = ohlcData.map(([ts, open, high, low, close]) => {
    const roundedTs = Math.round(ts / 3600000) * 3600000;
    return {
      timestamp: ts,
      open,
      high,
      low,
      close,
      volume: volumeMap.get(roundedTs) || 0,
    };
  });

  // Sort by timestamp
  candles.sort((a, b) => a.timestamp - b.timestamp);

  // Determine interval
  let intervalMs = 3600000; // default 1h
  if (candles.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < Math.min(candles.length, 10); i++) {
      gaps.push(candles[i].timestamp - candles[i - 1].timestamp);
    }
    intervalMs = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  }

  const dataset: HistoricalDataset = {
    symbol: coinId,
    candles,
    startTime: candles.length > 0 ? candles[0].timestamp : 0,
    endTime: candles.length > 0 ? candles[candles.length - 1].timestamp : 0,
    intervalMs,
  };

  // Cache it
  const cacheKey = getCacheKey(coinId, vsCurrency, days);
  dataCache.set(cacheKey, { dataset, fetchedAt: Date.now(), cacheKey });

  return dataset;
}

// ============================================================================
// BINANCE FETCHER — no API key, reliable OHLCV, up to 1000 candles/call
// ============================================================================

const BINANCE_BASE = 'https://api.binance.com/api/v3';
const BINANCE_SYMBOL_MAP: Record<string, string> = {
  bitcoin:  'BTCUSDT',
  ethereum: 'ETHUSDT',
  BTC:      'BTCUSDT',
  ETH:      'ETHUSDT',
  BTCUSDT:  'BTCUSDT',
  ETHUSDT:  'ETHUSDT',
};

/**
 * Fetch daily OHLCV candles from Binance public API (no auth required).
 *
 * @param coinId - CoinGecko-style ID ('bitcoin', 'ethereum') or direct Binance symbol ('BTCUSDT')
 * @param limit  - Number of daily candles to fetch (max 1000). Default 500 (~16 months).
 */
export async function fetchFromBinance(
  coinId: string,
  limit = 500,
  interval: '1d' | '4h' | '1h' = '1d',
): Promise<HistoricalDataset> {
  const symbol = BINANCE_SYMBOL_MAP[coinId] ?? coinId.toUpperCase();

  const url = `${BINANCE_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!res.ok) {
    throw new Error(`Binance klines fetch failed: ${res.status} for ${symbol}`);
  }

  // Binance kline format: [openTime, open, high, low, close, volume, closeTime, ...]
  const raw: string[][] = await res.json();

  const intervalMs = interval === '1d' ? 86_400_000 : interval === '4h' ? 14_400_000 : 3_600_000;

  const candles: OHLCVCandle[] = raw.map(k => ({
    timestamp: Number(k[0]),
    open:      parseFloat(k[1]),
    high:      parseFloat(k[2]),
    low:       parseFloat(k[3]),
    close:     parseFloat(k[4]),
    volume:    parseFloat(k[5]),
  }));

  candles.sort((a, b) => a.timestamp - b.timestamp);

  return {
    symbol: symbol.replace('USDT', ''),
    candles,
    startTime: candles[0]?.timestamp ?? 0,
    endTime:   candles[candles.length - 1]?.timestamp ?? 0,
    intervalMs,
  };
}

// ============================================================================
// KRAKEN FETCHER — no API key, US-accessible, up to 720 daily candles/call
// ============================================================================

const KRAKEN_BASE = 'https://api.kraken.com/0/public';
const KRAKEN_SYMBOL_MAP: Record<string, string> = {
  bitcoin:  'XBTUSD',
  ethereum: 'ETHUSD',
  BTC:      'XBTUSD',
  ETH:      'ETHUSD',
  BTCUSDT:  'XBTUSD',
  ETHUSDT:  'ETHUSD',
};

/**
 * Fetch daily OHLCV candles from Kraken public REST API (no auth, US-accessible).
 * Kraken returns up to 720 rows per call at daily (1440 min) granularity.
 *
 * @param coinId  - CoinGecko-style ID ('bitcoin', 'ethereum') or 'BTC'/'ETH'
 * @param limit   - Approximate number of candles (Kraken always returns ≤720 from current time)
 * @param interval - 'daily' | '4h' | '1h' (maps to Kraken minute values)
 */
export async function fetchFromKraken(
  coinId: string,
  limit = 500,
  interval: 'daily' | '4h' | '1h' = 'daily',
): Promise<HistoricalDataset> {
  const pair = KRAKEN_SYMBOL_MAP[coinId] ?? coinId.toUpperCase();
  const intervalMin = interval === 'daily' ? 1440 : interval === '4h' ? 240 : 60;
  const intervalMs  = intervalMin * 60 * 1000;

  // Compute `since` so we get ~limit candles back from now
  const sinceUnix = Math.floor((Date.now() - limit * intervalMs) / 1000);

  const url = `${KRAKEN_BASE}/OHLC?pair=${pair}&interval=${intervalMin}&since=${sinceUnix}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!res.ok) {
    throw new Error(`Kraken OHLC fetch failed: ${res.status} for ${pair}`);
  }

  const json = await res.json();

  if (json.error && json.error.length > 0) {
    throw new Error(`Kraken API error: ${json.error.join(', ')}`);
  }

  // Kraken returns data under result[pairKey] — key may differ from requested pair
  const resultKey = Object.keys(json.result).find(k => k !== 'last');
  if (!resultKey) throw new Error(`Kraken returned no data for ${pair}`);

  // Kraken OHLC row: [time(s), open, high, low, close, vwap, volume, count]
  const raw: (string | number)[][] = json.result[resultKey];

  const candles: OHLCVCandle[] = raw.map(row => ({
    timestamp: Number(row[0]) * 1000,          // seconds → ms
    open:      parseFloat(String(row[1])),
    high:      parseFloat(String(row[2])),
    low:       parseFloat(String(row[3])),
    close:     parseFloat(String(row[4])),
    volume:    parseFloat(String(row[6])),
  }));

  candles.sort((a, b) => a.timestamp - b.timestamp);

  return {
    symbol: pair.replace('USD', '').replace('XBT', 'BTC'),
    candles,
    startTime: candles[0]?.timestamp ?? 0,
    endTime:   candles[candles.length - 1]?.timestamp ?? 0,
    intervalMs,
  };
}

// ============================================================================
// PRICE HISTORY CONVERTER
// ============================================================================

/**
 * Convert the existing price-history.json format to HistoricalDataset.
 * The existing format: { timestamps: number[], prices: number[] }
 * This creates synthetic OHLCV where open=high=low=close=price, volume=0.
 */
export function fromPriceHistory(
  symbol: string,
  data: { timestamps: number[]; prices: number[] }
): HistoricalDataset {
  const candles: OHLCVCandle[] = [];
  for (let i = 0; i < data.timestamps.length; i++) {
    const price = data.prices[i];
    candles.push({
      timestamp: data.timestamps[i],
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0,
    });
  }

  candles.sort((a, b) => a.timestamp - b.timestamp);

  let intervalMs = 3600000;
  if (candles.length >= 2) {
    intervalMs = candles[1].timestamp - candles[0].timestamp;
  }

  return {
    symbol,
    candles,
    startTime: candles.length > 0 ? candles[0].timestamp : 0,
    endTime: candles.length > 0 ? candles[candles.length - 1].timestamp : 0,
    intervalMs,
  };
}

// ============================================================================
// SYNTHETIC DATA GENERATOR (for testing)
// ============================================================================

/**
 * Generate synthetic OHLCV data with configurable market behavior.
 * Useful for testing without hitting external APIs.
 */
export function generateSyntheticData(config: {
  symbol?: string;
  startPrice: number;
  candles: number;
  intervalMs?: number;
  /** Annualized drift rate. e.g. 0.5 = +50%/year */
  drift?: number;
  /** Annualized volatility. e.g. 0.8 = 80% annualized vol */
  volatility?: number;
  /** Random seed for reproducibility */
  seed?: number;
}): HistoricalDataset {
  const {
    symbol = 'synthetic',
    startPrice,
    candles: candleCount,
    intervalMs = 3600000,
    drift = 0,
    volatility = 0.5,
    seed = 42,
  } = config;

  // Simple seeded PRNG (Mulberry32)
  let s = seed;
  function rand(): number {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Box-Muller for normal distribution
  function randn(): number {
    const u1 = rand();
    const u2 = rand();
    return Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
  }

  const candlesPerYear = (365.25 * 24 * 3600000) / intervalMs;
  const dtDrift = drift / candlesPerYear;
  const dtVol = volatility / Math.sqrt(candlesPerYear);

  const result: OHLCVCandle[] = [];
  let price = startPrice;
  const startTime = Date.now() - candleCount * intervalMs;

  for (let i = 0; i < candleCount; i++) {
    const open = price;
    // Intra-candle random walk for OHLC
    const returns = dtDrift + dtVol * randn();
    const close = open * Math.exp(returns);

    // Generate realistic high/low
    const intraVol = Math.abs(close - open) * (0.5 + rand());
    const high = Math.max(open, close) + intraVol * rand();
    const low = Math.min(open, close) - intraVol * rand();

    const volume = startPrice * 1000000 * (0.5 + rand()); // synthetic volume

    result.push({
      timestamp: startTime + i * intervalMs,
      open: Math.max(open, 0.001),
      high: Math.max(high, 0.001),
      low: Math.max(low, 0.001),
      close: Math.max(close, 0.001),
      volume,
    });

    price = Math.max(close, 0.001);
  }

  return {
    symbol,
    candles: result,
    startTime: result[0].timestamp,
    endTime: result[result.length - 1].timestamp,
    intervalMs,
  };
}
