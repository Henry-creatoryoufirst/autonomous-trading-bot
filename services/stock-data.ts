/**
 * Schertzinger Trading Command — Stock Technical Indicators Engine (v6.0)
 *
 * Computes RSI, MACD, Bollinger Bands, SMA, and confluence scoring
 * for equities using the same -100 to +100 scale as crypto.
 */

import type { AlpacaBar, AlpacaClient } from './alpaca-client.js';

// ============================================================================
// TYPES
// ============================================================================

export interface StockIndicators {
  symbol: string;
  rsi14: number | null;
  macd: {
    macdLine: number;
    signalLine: number;
    histogram: number;
    signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  } | null;
  bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
    percentB: number;
    bandwidth: number;
    signal: 'OVERBOUGHT' | 'OVERSOLD' | 'SQUEEZE' | 'NEUTRAL';
  } | null;
  sma20: number | null;
  sma50: number | null;
  trendDirection: 'STRONG_UP' | 'UP' | 'SIDEWAYS' | 'DOWN' | 'STRONG_DOWN';
  volumeChange: number; // % vs 20-day average
  overallSignal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  confluenceScore: number; // -100 to +100
  currentPrice: number;
  change24h: number;
}

// ============================================================================
// COMPUTATION
// ============================================================================

function computeRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function computeMACD(closes: number[]): StockIndicators['macd'] {
  if (closes.length < 26) return null;

  const ema = (data: number[], period: number): number[] => {
    const k = 2 / (period + 1);
    const result: number[] = [data[0]];
    for (let i = 1; i < data.length; i++) {
      result.push(data[i] * k + result[i - 1] * (1 - k));
    }
    return result;
  };

  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine.slice(26), 9);

  const latestMACD = macdLine[macdLine.length - 1];
  const latestSignal = signalLine[signalLine.length - 1];
  const histogram = latestMACD - latestSignal;

  return {
    macdLine: latestMACD,
    signalLine: latestSignal,
    histogram,
    signal: histogram > 0 ? 'BULLISH' : histogram < 0 ? 'BEARISH' : 'NEUTRAL',
  };
}

function computeBollingerBands(closes: number[], period = 20, stdDevMultiplier = 2): StockIndicators['bollingerBands'] {
  if (closes.length < period) return null;

  const recent = closes.slice(-period);
  const middle = recent.reduce((s, v) => s + v, 0) / period;
  const stdDev = Math.sqrt(recent.reduce((s, v) => s + Math.pow(v - middle, 2), 0) / period);

  const upper = middle + stdDevMultiplier * stdDev;
  const lower = middle - stdDevMultiplier * stdDev;
  const currentPrice = closes[closes.length - 1];
  const percentB = (upper - lower) > 0 ? (currentPrice - lower) / (upper - lower) : 0.5;
  const bandwidth = middle > 0 ? (upper - lower) / middle : 0;

  let signal: 'OVERBOUGHT' | 'OVERSOLD' | 'SQUEEZE' | 'NEUTRAL' = 'NEUTRAL';
  if (percentB > 1) signal = 'OVERBOUGHT';
  else if (percentB < 0) signal = 'OVERSOLD';
  else if (bandwidth < 0.02) signal = 'SQUEEZE';

  return { upper, middle, lower, percentB, bandwidth, signal };
}

function computeSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

function determineTrend(closes: number[], sma20: number | null, sma50: number | null): StockIndicators['trendDirection'] {
  if (!sma20 || !sma50 || closes.length < 5) return 'SIDEWAYS';

  const currentPrice = closes[closes.length - 1];
  const recentChange = closes.length >= 10
    ? (currentPrice - closes[closes.length - 10]) / closes[closes.length - 10] * 100
    : 0;

  if (currentPrice > sma20 && sma20 > sma50 && recentChange > 3) return 'STRONG_UP';
  if (currentPrice > sma20 && recentChange > 0) return 'UP';
  if (currentPrice < sma20 && sma20 < sma50 && recentChange < -3) return 'STRONG_DOWN';
  if (currentPrice < sma20 && recentChange < 0) return 'DOWN';
  return 'SIDEWAYS';
}

function computeConfluence(
  rsi: number | null,
  macd: StockIndicators['macd'],
  bb: StockIndicators['bollingerBands'],
  trend: StockIndicators['trendDirection'],
  volumeChange: number
): number {
  let score = 0;

  // RSI contribution (-30 to +30)
  if (rsi !== null) {
    if (rsi < 30) score += 25;
    else if (rsi < 40) score += 10;
    else if (rsi > 70) score -= 25;
    else if (rsi > 60) score -= 10;
  }

  // MACD contribution (-20 to +20)
  if (macd) {
    if (macd.signal === 'BULLISH') score += 15;
    else if (macd.signal === 'BEARISH') score -= 15;
    if (macd.histogram > 0 && macd.macdLine > 0) score += 5;
    if (macd.histogram < 0 && macd.macdLine < 0) score -= 5;
  }

  // Bollinger Bands contribution (-15 to +15)
  if (bb) {
    if (bb.signal === 'OVERSOLD') score += 15;
    else if (bb.signal === 'OVERBOUGHT') score -= 15;
    else if (bb.signal === 'SQUEEZE') score += 5; // Squeeze often precedes breakout
  }

  // Trend contribution (-20 to +20)
  switch (trend) {
    case 'STRONG_UP': score += 20; break;
    case 'UP': score += 10; break;
    case 'DOWN': score -= 10; break;
    case 'STRONG_DOWN': score -= 20; break;
  }

  // Volume contribution (-15 to +15)
  if (volumeChange > 100) score += 10; // Volume spike
  else if (volumeChange > 50) score += 5;
  else if (volumeChange < -30) score -= 5; // Low volume

  return Math.max(-100, Math.min(100, score));
}

// ============================================================================
// PUBLIC API
// ============================================================================

export class StockDataEngine {
  private client: AlpacaClient;
  private indicatorCache: Map<string, { data: StockIndicators; cachedAt: number }> = new Map();
  private cacheTTL = 5 * 60 * 1000; // 5 minutes

  constructor(client: AlpacaClient) {
    this.client = client;
  }

  /**
   * Compute indicators for a single stock symbol
   */
  async getIndicators(symbol: string): Promise<StockIndicators> {
    // Check cache
    const cached = this.indicatorCache.get(symbol);
    if (cached && Date.now() - cached.cachedAt < this.cacheTTL) {
      return cached.data;
    }

    try {
      const bars = await this.client.getHistoricalBars(symbol, '1Hour', 240);
      const closes = bars.map(b => b.c);
      const volumes = bars.map(b => b.v);

      if (closes.length < 26) {
        return this.emptyIndicators(symbol);
      }

      const currentPrice = closes[closes.length - 1];
      const prevPrice = closes.length >= 24 ? closes[closes.length - 24] : closes[0];
      const change24h = prevPrice > 0 ? ((currentPrice - prevPrice) / prevPrice) * 100 : 0;

      const rsi14 = computeRSI(closes);
      const macd = computeMACD(closes);
      const bollingerBands = computeBollingerBands(closes);
      const sma20 = computeSMA(closes, 20);
      const sma50 = computeSMA(closes, 50);
      const trendDirection = determineTrend(closes, sma20, sma50);

      // Volume change vs 20-bar average
      const recentVol = volumes.slice(-5).reduce((s, v) => s + v, 0) / 5;
      const avgVol = volumes.slice(-20).reduce((s, v) => s + v, 0) / 20;
      const volumeChange = avgVol > 0 ? ((recentVol - avgVol) / avgVol) * 100 : 0;

      const confluenceScore = computeConfluence(rsi14, macd, bollingerBands, trendDirection, volumeChange);

      let overallSignal: StockIndicators['overallSignal'] = 'NEUTRAL';
      if (confluenceScore >= 40) overallSignal = 'STRONG_BUY';
      else if (confluenceScore >= 15) overallSignal = 'BUY';
      else if (confluenceScore <= -40) overallSignal = 'STRONG_SELL';
      else if (confluenceScore <= -15) overallSignal = 'SELL';

      const result: StockIndicators = {
        symbol, rsi14, macd, bollingerBands, sma20, sma50,
        trendDirection, volumeChange, overallSignal, confluenceScore,
        currentPrice, change24h,
      };

      this.indicatorCache.set(symbol, { data: result, cachedAt: Date.now() });
      return result;
    } catch (error: any) {
      console.warn(`  ⚠️ Stock indicators failed for ${symbol}: ${error?.message?.substring(0, 100)}`);
      return this.emptyIndicators(symbol);
    }
  }

  /**
   * Get indicators for all watched symbols
   */
  async getAllIndicators(symbols: string[]): Promise<Record<string, StockIndicators>> {
    const results: Record<string, StockIndicators> = {};

    // Fetch in batches to avoid rate limits (5 at a time)
    for (let i = 0; i < symbols.length; i += 5) {
      const batch = symbols.slice(i, i + 5);
      const promises = batch.map(s => this.getIndicators(s));
      const batchResults = await Promise.allSettled(promises);

      for (let j = 0; j < batch.length; j++) {
        if (batchResults[j].status === 'fulfilled') {
          results[batch[j]] = batchResults[j].value;
        } else {
          results[batch[j]] = this.emptyIndicators(batch[j]);
        }
      }
    }

    return results;
  }

  private emptyIndicators(symbol: string): StockIndicators {
    return {
      symbol, rsi14: null, macd: null, bollingerBands: null,
      sma20: null, sma50: null, trendDirection: 'SIDEWAYS',
      volumeChange: 0, overallSignal: 'NEUTRAL', confluenceScore: 0,
      currentPrice: 0, change24h: 0,
    };
  }
}
