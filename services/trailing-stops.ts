/**
 * Adaptive Exit Timing Engine — ATR-Based Trailing Stops
 *
 * Problem: The bot wins often but loses big. Winners are trimmed too early,
 * losers held too long.
 *
 * Solution: Asymmetric trailing stops that let profits run and cut losses fast:
 *   - Winning positions (gain > 5%): wide trail = 2.5x ATR below high-water mark
 *   - Losing positions (loss > -3%): tight trail = 1.0x ATR below entry price
 *   - Neutral zone (-3% to +5%): moderate trail = 1.5x ATR below high-water mark
 *
 * The trailing stop tracks each position's high-water mark (highest price since entry)
 * and dynamically adjusts the stop level based on ATR and position P&L.
 */

interface TrailingStopEntry {
  symbol: string;
  entryPrice: number;          // Price at entry (cost basis)
  highWaterMark: number;       // Highest price seen since entry
  highWaterMarkDate: string;   // When high-water mark was set
  currentStopPrice: number;    // Current trailing stop price level
  atrPercentUsed: number;      // Last ATR% used for calculation
  atrMultiplierUsed: number;   // Last ATR multiplier used (1.0, 1.5, or 2.5)
  zone: 'WINNING' | 'LOSING' | 'NEUTRAL'; // Current P&L zone
  lastUpdated: string;         // ISO timestamp
  stopTriggered: boolean;      // Whether the stop has been hit
  triggerPrice?: number;       // Price at which stop was triggered
  triggerDate?: string;        // When stop was triggered
}

// In-memory store for trailing stops
const trailingStops: Map<string, TrailingStopEntry> = new Map();

// ATR multipliers for asymmetric stops
const WINNING_ATR_MULTIPLIER = 2.5;   // Wide trail — let profits run
const NEUTRAL_ATR_MULTIPLIER = 1.5;   // Moderate trail
const LOSING_ATR_MULTIPLIER = 1.0;    // Tight trail — cut losses fast

// P&L zone thresholds
const WINNING_THRESHOLD_PCT = 5;       // Position is "winning" above +5%
const LOSING_THRESHOLD_PCT = -3;       // Position is "losing" below -3%

/**
 * Update the trailing stop for a position.
 * Called every cycle with fresh price and ATR data.
 *
 * @param symbol - Token symbol
 * @param currentPrice - Current market price
 * @param atrPercent - ATR as percentage of price (e.g. 4.0 = 4%)
 * @param gainPct - Current gain/loss percentage from entry
 * @param entryPrice - Entry price (cost basis) — only used on first call to initialize
 * @returns The updated trailing stop entry
 */
export function updateTrailingStop(
  symbol: string,
  currentPrice: number,
  atrPercent: number,
  gainPct: number,
  entryPrice?: number,
): TrailingStopEntry | null {
  if (currentPrice <= 0 || atrPercent <= 0) return null;

  let entry = trailingStops.get(symbol);

  // Initialize new entry if first time seeing this position
  if (!entry) {
    if (!entryPrice || entryPrice <= 0) return null; // Need entry price for initialization
    entry = {
      symbol,
      entryPrice,
      highWaterMark: currentPrice,
      highWaterMarkDate: new Date().toISOString(),
      currentStopPrice: 0,
      atrPercentUsed: atrPercent,
      atrMultiplierUsed: NEUTRAL_ATR_MULTIPLIER,
      zone: 'NEUTRAL',
      lastUpdated: new Date().toISOString(),
      stopTriggered: false,
    };
    trailingStops.set(symbol, entry);
  }

  // Update high-water mark (ratchet up only)
  if (currentPrice > entry.highWaterMark) {
    entry.highWaterMark = currentPrice;
    entry.highWaterMarkDate = new Date().toISOString();
  }

  // Determine P&L zone and select ATR multiplier
  let multiplier: number;
  let zone: 'WINNING' | 'LOSING' | 'NEUTRAL';

  if (gainPct >= WINNING_THRESHOLD_PCT) {
    multiplier = WINNING_ATR_MULTIPLIER;
    zone = 'WINNING';
  } else if (gainPct <= LOSING_THRESHOLD_PCT) {
    multiplier = LOSING_ATR_MULTIPLIER;
    zone = 'LOSING';
  } else {
    multiplier = NEUTRAL_ATR_MULTIPLIER;
    zone = 'NEUTRAL';
  }

  // Compute trailing stop price
  // For winning positions: trail below high-water mark (let profits run)
  // For losing positions: trail below entry price (cut losses fast)
  // For neutral: trail below high-water mark (moderate protection)
  const atrDollar = currentPrice * (atrPercent / 100);
  const trailDistance = multiplier * atrDollar;

  let newStopPrice: number;
  if (zone === 'LOSING') {
    // Tight stop below entry price — cut losses fast
    newStopPrice = entry.entryPrice - trailDistance;
  } else {
    // Trail below high-water mark — let profits run
    newStopPrice = entry.highWaterMark - trailDistance;
  }

  // Trailing stop only ratchets up (never moves down)
  if (newStopPrice > entry.currentStopPrice) {
    entry.currentStopPrice = newStopPrice;
  }

  entry.atrPercentUsed = atrPercent;
  entry.atrMultiplierUsed = multiplier;
  entry.zone = zone;
  entry.lastUpdated = new Date().toISOString();

  return entry;
}

/**
 * Check if the trailing stop has been hit for a position.
 *
 * @param symbol - Token symbol
 * @param currentPrice - Current market price
 * @returns true if the stop has been hit (price dropped below trailing stop level)
 */
export function checkTrailingStopHit(symbol: string, currentPrice: number): boolean {
  const entry = trailingStops.get(symbol);
  if (!entry || entry.stopTriggered) return false;
  if (entry.currentStopPrice <= 0) return false;

  if (currentPrice <= entry.currentStopPrice) {
    entry.stopTriggered = true;
    entry.triggerPrice = currentPrice;
    entry.triggerDate = new Date().toISOString();
    return true;
  }

  return false;
}

/**
 * Get the full state of all trailing stops.
 * Used by the /api/trailing-stops endpoint.
 */
export function getTrailingStopState(): TrailingStopEntry[] {
  return Array.from(trailingStops.values());
}

/**
 * Get trailing stop for a specific symbol.
 */
export function getTrailingStop(symbol: string): TrailingStopEntry | null {
  return trailingStops.get(symbol) || null;
}

/**
 * Remove a trailing stop entry (e.g. after position is fully sold).
 */
export function removeTrailingStop(symbol: string): void {
  trailingStops.delete(symbol);
}

/**
 * Reset the triggered state for a trailing stop (e.g. if the sell failed).
 */
export function resetTrailingStopTrigger(symbol: string): void {
  const entry = trailingStops.get(symbol);
  if (entry) {
    entry.stopTriggered = false;
    entry.triggerPrice = undefined;
    entry.triggerDate = undefined;
  }
}
