/**
 * NVR Capital — Macro Regime Detector
 *
 * Computes a single macro regime score from three clean signals:
 *   1. Price vs 140-day SMA  — trend direction (weight 40)
 *   2. BTC dominance trend   — risk-on / risk-off (weight 30)
 *   3. Fear & Greed / RSI    — sentiment (weight 30)
 *
 * Output: BULL / RANGING / BEAR with a -100…+100 score.
 *
 * Used by:
 *   - simulation/engine/replay-engine.ts  (synthetic data, price-derived proxies)
 *   - agent-v3.2.ts                       (real BTC dominance + Fear & Greed)
 *
 * Design principle: one interpretable number beats five noisy signals.
 * The bot sees `regime` + `score` — not the raw inputs.
 */

import { calculateSMA, calculateRSI } from './indicators.js';

// ============================================================================
// TYPES
// ============================================================================

export type Regime = 'BULL' | 'RANGING' | 'BEAR';

export interface MacroRegimeResult {
  /** Classified regime */
  regime: Regime;
  /** Composite score: -100 (extreme bear) → +100 (extreme bull) */
  score: number;
  /** 0–1 confidence in the classification */
  confidence: number;
  /** Per-signal breakdown for diagnostics */
  signals: {
    trend: number;      // -40 to +40 — price vs SMA140 (or SMA50 fallback)
    dominance: number;  // -30 to +30 — BTC dominance trend (or price-proxy)
    sentiment: number;  // -30 to +30 — Fear & Greed or RSI proxy
  };
}

// ============================================================================
// CORE FUNCTION
// ============================================================================

/**
 * Compute the macro market regime.
 *
 * @param prices            Close prices (needs 50+ for SMA50, 140+ for SMA140)
 * @param btcDominanceTrend 14-day change in BTC dominance % (positive = risk-off).
 *                          Pass undefined to derive a proxy from price momentum.
 * @param fearGreed         Fear & Greed index 0–100 (0 = extreme fear).
 *                          Pass undefined to derive from RSI.
 */
export function computeMacroRegime(
  prices: number[],
  btcDominanceTrend?: number,
  fearGreed?: number,
): MacroRegimeResult {
  let score = 0;

  // ── Signal 1: Price vs long-term SMA (weight 40) ────────────────────────
  // SMA140 ≈ 20-week moving average — the classic bull/bear dividing line.
  // Fall back to SMA50 if we don't have 140 candles yet.
  const currentPrice = prices[prices.length - 1];
  const sma140 = calculateSMA(prices, 140);
  const sma50  = calculateSMA(prices, 50);
  const smaRef = sma140 ?? sma50;

  let trendSignal = 0;
  if (smaRef !== null && smaRef > 0) {
    const pctAbove = ((currentPrice - smaRef) / smaRef) * 100;
    if      (pctAbove >  10) trendSignal = 40;   // solidly above → strong bull
    else if (pctAbove >   3) trendSignal = 25;   // above → bullish
    else if (pctAbove >   0) trendSignal = 10;   // just above → neutral-bull
    else if (pctAbove >  -3) trendSignal = -10;  // just below → neutral-bear
    else if (pctAbove > -10) trendSignal = -25;  // below → bearish
    else                     trendSignal = -40;  // deeply below → strong bear
  }
  score += trendSignal;

  // ── Signal 2: BTC Dominance trend (weight 30) ───────────────────────────
  // Rising dominance = capital fleeing alts to BTC safety = BEAR for the bot.
  // Only uses REAL dominance data — no proxy when unavailable.
  // Reason: short-term price momentum is too noisy on sub-daily timeframes
  // and causes false-positive BEAR detections during normal corrections.
  let dominanceSignal = 0;
  if (btcDominanceTrend !== undefined) {
    if      (btcDominanceTrend >  3) dominanceSignal = -30;  // dominance rising fast → BEAR
    else if (btcDominanceTrend >  1) dominanceSignal = -15;  // rising slowly → cautious
    else if (btcDominanceTrend < -3) dominanceSignal =  30;  // falling fast → risk-on BULL
    else if (btcDominanceTrend < -1) dominanceSignal =  15;  // falling → bullish
    // -1 to +1: neutral → 0
  }
  // When no real dominance data: dominanceSignal = 0 (neutral, no false positives)
  score += dominanceSignal;

  // ── Signal 3: Sentiment — Fear & Greed / RSI proxy (weight 30) ──────────
  // Real Fear & Greed: 0 = extreme fear, 100 = extreme greed.
  // RSI proxy: RSI < 30 ≈ extreme fear, RSI > 70 ≈ extreme greed.
  let sentimentSignal = 0;
  if (fearGreed !== undefined) {
    // Real data path
    if      (fearGreed <  20) sentimentSignal = -30;  // extreme fear → BEAR
    else if (fearGreed <  35) sentimentSignal = -15;  // fear → cautious
    else if (fearGreed >  80) sentimentSignal =  30;  // extreme greed → BULL
    else if (fearGreed >  65) sentimentSignal =  15;  // greed → bullish
    // 35–65: neutral → 0
  } else {
    // RSI proxy path (simulation)
    const rsi = calculateRSI(prices);
    if (rsi !== null) {
      if      (rsi < 25) sentimentSignal = -30;
      else if (rsi < 35) sentimentSignal = -15;
      else if (rsi > 75) sentimentSignal =  30;
      else if (rsi > 65) sentimentSignal =  15;
    }
  }
  score += sentimentSignal;

  // ── Classify ─────────────────────────────────────────────────────────────
  // Thresholds are deliberately asymmetric — we require strong conviction to
  // declare BEAR (all three signals must lean negative) to avoid false
  // positives on short corrections inside a broader bull trend.
  score = Math.max(-100, Math.min(100, score));

  let regime: Regime;
  if      (score >=  25) regime = 'BULL';
  else if (score <= -50) regime = 'BEAR';   // high bar: needs ≥2 signals strongly negative
  else                   regime = 'RANGING';

  const confidence = Math.abs(score) / 100;

  return {
    regime,
    score,
    confidence,
    signals: { trend: trendSignal, dominance: dominanceSignal, sentiment: sentimentSignal },
  };
}
