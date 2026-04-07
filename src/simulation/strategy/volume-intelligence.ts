/**
 * NVR Capital — Level 5: Volume Intelligence
 *
 * Correlates volume with price moves in synthetic data and provides
 * volume confirmation signals for entry/exit decisions.
 *
 * Pure functions. No side effects.
 */

import type { OHLCVCandle, VolumeSignal } from '../types.js';

// ============================================================================
// REALISTIC VOLUME GENERATION
// ============================================================================

/**
 * Ensure candle volume is realistically correlated with price moves.
 * If volume exists but is random, adjust to correlate with |priceChange|.
 * Returns a new array (no mutation).
 */
export function ensureRealisticVolume(candles: OHLCVCandle[]): OHLCVCandle[] {
  if (candles.length === 0) return [];

  // Calculate base volume (median of existing volumes)
  const volumes = candles.map(c => c.volume).sort((a, b) => a - b);
  const baseVolume = volumes[Math.floor(volumes.length / 2)] || 1000000;

  return candles.map((c, i) => {
    const priceChange = c.open > 0 ? Math.abs(c.close - c.open) / c.open : 0;

    // Volume spikes on big moves: 1x base + 3x for each 1% move
    const volumeMultiplier = 1 + priceChange * 300;

    // Add some randomness (seeded from price for determinism)
    const noise = 0.7 + (((c.close * 1000) % 100) / 100) * 0.6;

    return {
      ...c,
      volume: baseVolume * volumeMultiplier * noise,
    };
  });
}

// ============================================================================
// VOLUME ANALYSIS
// ============================================================================

/**
 * Analyze volume at a given candle index relative to recent average.
 *
 * @param candles - Full candle array
 * @param currentIndex - Index of current candle to analyze
 * @param lookback - Number of prior candles for average (default 20)
 */
export function analyzeVolume(
  candles: OHLCVCandle[],
  currentIndex: number,
  lookback: number = 20,
): VolumeSignal {
  if (currentIndex < lookback || currentIndex >= candles.length) {
    return { volumeRatio: 1.0, confirmed: true, dryingUp: false };
  }

  // Average volume over lookback window
  const windowStart = currentIndex - lookback;
  let sumVol = 0;
  for (let i = windowStart; i < currentIndex; i++) {
    sumVol += candles[i].volume;
  }
  const avgVolume = sumVol / lookback;

  if (avgVolume === 0) {
    return { volumeRatio: 1.0, confirmed: true, dryingUp: false };
  }

  const currentVolume = candles[currentIndex].volume;
  const volumeRatio = currentVolume / avgVolume;

  // Confirmed: volume above average and price moved meaningfully
  const priceChange = Math.abs(
    (candles[currentIndex].close - candles[currentIndex].open) / candles[currentIndex].open
  ) * 100;
  const confirmed = volumeRatio > 1.2 && priceChange > 0.3;

  // Drying up: declining volume over last 3 candles after a significant move
  let dryingUp = false;
  if (currentIndex >= 3) {
    const recent3Volumes = [
      candles[currentIndex - 2].volume,
      candles[currentIndex - 1].volume,
      candles[currentIndex].volume,
    ];
    const declining = recent3Volumes[0] > recent3Volumes[1] && recent3Volumes[1] > recent3Volumes[2];

    // Check if there was a significant move in the last 5 candles
    if (currentIndex >= 5) {
      const recentHigh = Math.max(...candles.slice(currentIndex - 5, currentIndex + 1).map(c => c.high));
      const recentLow = Math.min(...candles.slice(currentIndex - 5, currentIndex + 1).map(c => c.low));
      const recentRange = recentLow > 0 ? ((recentHigh - recentLow) / recentLow) * 100 : 0;
      dryingUp = declining && recentRange > 2;
    }
  }

  return { volumeRatio, confirmed, dryingUp };
}
