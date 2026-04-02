/**
 * Never Rest Capital — Technical Indicator Functions
 * Extracted from agent-v3.2.ts (Phase 1b refactor)
 *
 * Pure computational functions — no external state dependencies.
 * All data passed in as parameters.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface TechnicalIndicators {
  rsi14: number | null;
  macd: {
    macdLine: number;
    signalLine: number;
    histogram: number;
    signal: "BULLISH" | "BEARISH" | "NEUTRAL";
  } | null;
  bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
    percentB: number;
    bandwidth: number;
    signal: "OVERBOUGHT" | "OVERSOLD" | "SQUEEZE" | "NORMAL";
  } | null;
  sma20: number | null;
  sma50: number | null;
  volumeChange24h: number | null;
  atr14: number | null;
  atrPercent: number | null;
  adx14: {
    adx: number;
    plusDI: number;
    minusDI: number;
    trend: "STRONG_TREND" | "TRENDING" | "WEAK" | "NO_TREND";
  } | null;
  trendDirection: "STRONG_UP" | "UP" | "SIDEWAYS" | "DOWN" | "STRONG_DOWN";
  overallSignal: "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";
  confluenceScore: number;
  twapDivergence?: {
    twapPrice: number;
    spotPrice: number;
    divergencePct: number;
    signal: "OVERSOLD" | "OVERBOUGHT" | "NORMAL";
  } | null;
  orderFlow?: {
    netBuyVolumeUSD: number;
    buyVolumeUSD: number;
    sellVolumeUSD: number;
    tradeCount: number;
    largeBuyPct: number;
    signal: "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";
  } | null;
  tickDepth?: {
    bidDepthUSD: number;
    askDepthUSD: number;
    depthRatio: number;
    inRangeLiquidity: number;
    signal: "STRONG_SUPPORT" | "SUPPORT" | "BALANCED" | "RESISTANCE" | "STRONG_RESISTANCE";
  } | null;
}

// ============================================================================
// RSI (Relative Strength Index)
// ============================================================================

/**
 * Calculate RSI (Relative Strength Index) — 14-period
 * RSI = 100 - (100 / (1 + RS))
 * RS = Average Gain / Average Loss over N periods
 */
export function calculateRSI(prices: number[], period: number = 14): number | null {
  if (prices.length < period + 1) return null;

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  const recentChanges = changes.slice(-Math.min(changes.length, period * 3));

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period && i < recentChanges.length; i++) {
    if (recentChanges[i] > 0) avgGain += recentChanges[i];
    else avgLoss += Math.abs(recentChanges[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smoothed RSI using Wilder's smoothing
  for (let i = period; i < recentChanges.length; i++) {
    const change = recentChanges[i];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ============================================================================
// EMA (Exponential Moving Average)
// ============================================================================

export function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return [];

  const multiplier = 2 / (period + 1);
  const ema: number[] = [];

  let sum = 0;
  for (let i = 0; i < period; i++) sum += prices[i];
  ema.push(sum / period);

  for (let i = period; i < prices.length; i++) {
    ema.push((prices[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1]);
  }

  return ema;
}

// ============================================================================
// MACD (Moving Average Convergence Divergence)
// ============================================================================

/**
 * Calculate MACD
 * MACD Line = EMA(12) - EMA(26)
 * Signal Line = EMA(9) of MACD Line
 * Histogram = MACD Line - Signal Line
 */
export function calculateMACD(prices: number[]): { macdLine: number; signalLine: number; histogram: number; signal: "BULLISH" | "BEARISH" | "NEUTRAL" } | null {
  if (prices.length < 35) return null;

  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);

  if (ema12.length === 0 || ema26.length === 0) return null;

  const offset = 26 - 12;
  const macdValues: number[] = [];
  for (let i = 0; i < ema26.length; i++) {
    macdValues.push(ema12[i + offset] - ema26[i]);
  }

  if (macdValues.length < 9) return null;

  const signalLine = calculateEMA(macdValues, 9);
  if (signalLine.length === 0) return null;

  const macdLine = macdValues[macdValues.length - 1];
  const signal = signalLine[signalLine.length - 1];
  const histogram = macdLine - signal;

  let macdSignal: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  const prevHistogram = macdValues.length >= 2 && signalLine.length >= 2
    ? macdValues[macdValues.length - 2] - signalLine[signalLine.length - 2]
    : 0;

  if (histogram > 0 && prevHistogram <= 0) macdSignal = "BULLISH";
  else if (histogram < 0 && prevHistogram >= 0) macdSignal = "BEARISH";
  else if (histogram > 0) macdSignal = "BULLISH";
  else if (histogram < 0) macdSignal = "BEARISH";

  return { macdLine, signalLine: signal, histogram, signal: macdSignal };
}

// ============================================================================
// Bollinger Bands
// ============================================================================

export function calculateBollingerBands(prices: number[], period: number = 20, stdDevMultiplier: number = 2): TechnicalIndicators["bollingerBands"] {
  if (prices.length < period) return null;

  const recentPrices = prices.slice(-period);
  const sma = recentPrices.reduce((sum, p) => sum + p, 0) / period;
  const squaredDiffs = recentPrices.map(p => Math.pow(p - sma, 2));
  const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = sma + stdDevMultiplier * stdDev;
  const lower = sma - stdDevMultiplier * stdDev;
  const currentPrice = prices[prices.length - 1];

  const percentB = upper !== lower ? (currentPrice - lower) / (upper - lower) : 0.5;
  const bandwidth = sma !== 0 ? ((upper - lower) / sma) * 100 : 0;

  let signal: "OVERBOUGHT" | "OVERSOLD" | "SQUEEZE" | "NORMAL" = "NORMAL";
  if (percentB > 1) signal = "OVERBOUGHT";
  else if (percentB < 0) signal = "OVERSOLD";
  else if (bandwidth < 2) signal = "SQUEEZE";

  return { upper, middle: sma, lower, percentB, bandwidth, signal };
}

// ============================================================================
// SMA (Simple Moving Average)
// ============================================================================

export function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const recentPrices = prices.slice(-period);
  return recentPrices.reduce((sum, p) => sum + p, 0) / period;
}

// ============================================================================
// ATR (Average True Range) — close-to-close variant
// ============================================================================

/**
 * v8.3: Calculate ATR — close-to-close variant
 * Uses |close[i] - close[i-1]| as True Range since the price history store records close prices.
 * Wilder's smoothing (same as RSI) for the averaging.
 */
export function calculateATR(prices: number[], period: number = 14): { atr: number; atrPercent: number } | null {
  if (prices.length < period + 1) return null;

  const tr: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    tr.push(Math.abs(prices[i] - prices[i - 1]));
  }

  const recentTR = tr.slice(-Math.min(tr.length, period * 3));

  let atr = 0;
  for (let i = 0; i < period && i < recentTR.length; i++) {
    atr += recentTR[i];
  }
  atr /= period;

  for (let i = period; i < recentTR.length; i++) {
    atr = (atr * (period - 1) + recentTR[i]) / period;
  }

  const currentPrice = prices[prices.length - 1];
  const atrPercent = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;

  return { atr, atrPercent };
}

// ============================================================================
// ADX (Average Directional Index) — close-to-close variant
// ============================================================================

/**
 * v8.3: Calculate ADX — close-to-close variant
 * Measures trend STRENGTH (0-100), not direction. Uses +DI/-DI for direction.
 */
export function calculateADX(prices: number[], period: number = 14): TechnicalIndicators["adx14"] {
  if (prices.length < 2 * period + 1) return null;

  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];

  for (let i = 1; i < prices.length; i++) {
    const upMove = prices[i] - prices[i - 1];
    const downMove = prices[i - 1] - prices[i];

    if (upMove > 0 && upMove > downMove) {
      plusDM.push(upMove);
      minusDM.push(0);
    } else if (downMove > 0 && downMove > upMove) {
      plusDM.push(0);
      minusDM.push(downMove);
    } else {
      plusDM.push(0);
      minusDM.push(0);
    }

    tr.push(Math.abs(prices[i] - prices[i - 1]));
  }

  const smooth = (values: number[], p: number): number[] => {
    if (values.length < p) return [];
    const result: number[] = [];
    let sum = 0;
    for (let i = 0; i < p; i++) sum += values[i];
    result.push(sum);
    for (let i = p; i < values.length; i++) {
      result.push(result[result.length - 1] - result[result.length - 1] / p + values[i]);
    }
    return result;
  };

  const smoothPlusDM = smooth(plusDM, period);
  const smoothMinusDM = smooth(minusDM, period);
  const smoothTR = smooth(tr, period);

  if (smoothPlusDM.length === 0 || smoothTR.length === 0) return null;

  const dx: number[] = [];
  for (let i = 0; i < smoothPlusDM.length; i++) {
    const atr = smoothTR[i];
    if (atr === 0) continue;

    const pDI = (smoothPlusDM[i] / atr) * 100;
    const mDI = (smoothMinusDM[i] / atr) * 100;
    const diSum = pDI + mDI;

    if (diSum > 0) {
      dx.push((Math.abs(pDI - mDI) / diSum) * 100);
    }
  }

  if (dx.length < period) return null;

  let adx = 0;
  for (let i = 0; i < period; i++) adx += dx[i];
  adx /= period;
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }

  const lastIdx = smoothPlusDM.length - 1;
  const lastATR = smoothTR[lastIdx];
  const plusDIVal = lastATR > 0 ? (smoothPlusDM[lastIdx] / lastATR) * 100 : 0;
  const minusDIVal = lastATR > 0 ? (smoothMinusDM[lastIdx] / lastATR) * 100 : 0;

  let trend: "STRONG_TREND" | "TRENDING" | "WEAK" | "NO_TREND";
  if (adx >= 40) trend = "STRONG_TREND";
  else if (adx >= 25) trend = "TRENDING";
  else if (adx >= 20) trend = "WEAK";
  else trend = "NO_TREND";

  return { adx: Math.round(adx * 10) / 10, plusDI: Math.round(plusDIVal * 10) / 10, minusDI: Math.round(minusDIVal * 10) / 10, trend };
}

// ============================================================================
// Trend Direction
// ============================================================================

export function determineTrend(prices: number[], sma20: number | null, sma50: number | null): TechnicalIndicators["trendDirection"] {
  if (prices.length < 5) return "SIDEWAYS";

  const currentPrice = prices[prices.length - 1];
  const priceWeekAgo = prices[Math.max(0, prices.length - 168)];
  const priceDayAgo = prices[Math.max(0, prices.length - 24)];

  const weeklyChange = ((currentPrice - priceWeekAgo) / priceWeekAgo) * 100;
  const dailyChange = ((currentPrice - priceDayAgo) / priceDayAgo) * 100;

  const aboveSMA20 = sma20 ? currentPrice > sma20 : null;
  const aboveSMA50 = sma50 ? currentPrice > sma50 : null;

  if (weeklyChange > 10 && dailyChange > 3 && aboveSMA20 !== false) return "STRONG_UP";
  if (weeklyChange > 3 && dailyChange > 0 && aboveSMA20 !== false) return "UP";
  if (weeklyChange < -10 && dailyChange < -3 && aboveSMA20 !== true) return "STRONG_DOWN";
  if (weeklyChange < -3 && dailyChange < 0 && aboveSMA20 !== true) return "DOWN";
  return "SIDEWAYS";
}

// ============================================================================
// Decode sqrtPriceX96 (Uniswap V3 / Aerodrome V3)
// ============================================================================

/**
 * Decode sqrtPriceX96 from Uniswap V3 / Aerodrome V3 slot0 into a human-readable price.
 * price = (sqrtPriceX96 / 2^96)^2 adjusted for token decimal difference.
 * Returns: amount of token1 per 1 token0 (decimal-adjusted).
 */
export function decodeSqrtPriceX96(sqrtPriceX96Hex: string, token0Decimals: number, token1Decimals: number): number {
  const sqrtPriceX96 = BigInt('0x' + sqrtPriceX96Hex.slice(0, 64));
  if (sqrtPriceX96 === 0n) return 0;

  const numerator = sqrtPriceX96 * sqrtPriceX96;
  const Q192 = 2n ** 192n;

  const intPart = numerator / Q192;
  const remainder = numerator % Q192;
  const rawPrice = Number(intPart) + Number(remainder) / Number(Q192);

  const decimalAdjustment = 10 ** (token0Decimals - token1Decimals);
  return rawPrice * decimalAdjustment;
}
