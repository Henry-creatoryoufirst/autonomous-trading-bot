/**
 * NVR-SPEC-022 — OHLCV → HistoricalEvent converter
 *
 * Bridges cached `OhlcvCandle` data (from `GeckoTerminalHistoricalFeed`)
 * into `HistoricalEvent[]` the EventReplayer can drive through the
 * PatternRuntime. Used by candle-cadence patterns (breakouts, vol-regime
 * shifts) where the trigger is "this candle closed" rather than an
 * external on-chain event like a liquidation.
 *
 * Convention:
 *   - GeckoTerminal returns candles with `ts` = candle START time (unix sec).
 *   - This converter emits each event at candle CLOSE time
 *     (`ts + timeframeMs`) — that's when the OHLCV is fully observable
 *     and a pattern would realistically be able to act.
 *   - The full OHLCV is in `payload`, so patterns can read open/high/low/
 *     close/volumeUsd from `market.extras.event.payload`.
 *   - Event `price` is set to `close` for downstream `getPriceAt` lookups.
 */

import type { HistoricalEvent } from "../event-replayer.js";
import type { OhlcvCandle } from "./price-feed.js";

// ----------------------------------------------------------------------------
// Timeframe → milliseconds
// ----------------------------------------------------------------------------

/** GeckoTerminal timeframe units, in seconds. */
const TIMEFRAME_BASE_SEC: Record<string, number> = {
  minute: 60,
  hour: 3600,
  day: 86_400,
};

/**
 * Compute candle duration in ms from a timeframe + aggregate.
 *   timeframeMs('hour', 4)   → 14_400_000  (4h candles)
 *   timeframeMs('minute', 15) → 900_000    (15-min candles)
 *   timeframeMs('day', 1)    → 86_400_000 (daily candles)
 */
export function timeframeMs(timeframe: string, aggregate: number): number {
  const base = TIMEFRAME_BASE_SEC[timeframe];
  if (!base) {
    throw new Error(`candle-events: unknown timeframe "${timeframe}"`);
  }
  if (!Number.isInteger(aggregate) || aggregate <= 0) {
    throw new Error(`candle-events: aggregate must be a positive integer, got ${aggregate}`);
  }
  return base * aggregate * 1000;
}

// ----------------------------------------------------------------------------
// Converter
// ----------------------------------------------------------------------------

export interface CandleEventOptions {
  /** Symbol the candles describe (e.g. "WETH"). */
  symbol: string;
  /** OHLCV timeframe label this candle list came from (e.g. 'hour'). */
  timeframe: "minute" | "hour" | "day";
  /** Aggregate count. */
  aggregate: number;
  /** Candles in ascending time order. Each `ts` is the candle START in unix sec. */
  candles: ReadonlyArray<Readonly<OhlcvCandle>>;
  /**
   * Event `kind` to emit. Default `'candle_close'`. Patterns gate on this
   * to distinguish candle ticks from other event sources (liquidations,
   * stable-depeg ticks, etc.).
   */
  kind?: string;
}

/**
 * Convert OHLCV candles into HistoricalEvents emitted at candle close.
 *
 * Returns events in ascending chronological order, ready to feed into
 * `EventReplayer.replay()`. If the input candles are out of order, they
 * are sorted defensively.
 */
export function candlesToEvents(opts: CandleEventOptions): HistoricalEvent[] {
  const tfMs = timeframeMs(opts.timeframe, opts.aggregate);
  const kind = opts.kind ?? "candle_close";
  const sorted = [...opts.candles].sort((a, b) => a.ts - b.ts);

  const events: HistoricalEvent[] = [];
  for (const c of sorted) {
    if (!Number.isFinite(c.ts) || c.ts <= 0) continue;
    if (!Number.isFinite(c.close) || c.close <= 0) continue;
    const closeTsMs = c.ts * 1000 + tfMs;
    events.push({
      timestamp: new Date(closeTsMs).toISOString(),
      symbol: opts.symbol,
      price: c.close,
      kind,
      payload: {
        timeframe: opts.timeframe,
        aggregate: opts.aggregate,
        timeframeMs: tfMs,
        // Raw OHLCV — patterns read these for detection logic
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volumeUsd: c.volumeUsd,
        // The candle's own start time (in case a pattern wants intra-candle math)
        candleStartTs: c.ts,
      },
    });
  }
  return events;
}

// ----------------------------------------------------------------------------
// Convenience: read candles straight from a GeckoTerminalHistoricalFeed
// ----------------------------------------------------------------------------

/**
 * Bridge between a preloaded `GeckoTerminalHistoricalFeed` and `EventReplayer`.
 * Reads cached candles for `symbol` in the requested window and converts
 * them to events. Throws if the feed has no candles for the symbol (i.e.
 * preload didn't run or it failed for that symbol).
 */
export interface FeedLikeForCandles {
  getCandlesInWindow(
    symbol: string,
    fromISO: string,
    toISO: string,
  ): ReadonlyArray<Readonly<OhlcvCandle>>;
  config: { timeframe: "minute" | "hour" | "day"; aggregate: number };
}

export function feedToEvents(opts: {
  feed: FeedLikeForCandles;
  symbol: string;
  fromISO: string;
  toISO: string;
  kind?: string;
}): HistoricalEvent[] {
  const candles = opts.feed.getCandlesInWindow(opts.symbol, opts.fromISO, opts.toISO);
  if (candles.length === 0) {
    throw new Error(
      `feedToEvents: no candles for ${opts.symbol} in [${opts.fromISO}, ${opts.toISO}] — ` +
        `did preload() run and succeed for this symbol?`,
    );
  }
  return candlesToEvents({
    symbol: opts.symbol,
    timeframe: opts.feed.config.timeframe,
    aggregate: opts.feed.config.aggregate,
    candles,
    kind: opts.kind,
  });
}
