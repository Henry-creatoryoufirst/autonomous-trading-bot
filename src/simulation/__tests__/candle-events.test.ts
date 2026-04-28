import { describe, it, expect } from "vitest";
import {
  candlesToEvents,
  feedToEvents,
  timeframeMs,
} from "../data/candle-events.js";
import type { OhlcvCandle } from "../data/price-feed.js";

// ----------------------------------------------------------------------------
// timeframeMs
// ----------------------------------------------------------------------------

describe("timeframeMs", () => {
  it("computes minute timeframes correctly", () => {
    expect(timeframeMs("minute", 1)).toBe(60_000);
    expect(timeframeMs("minute", 15)).toBe(900_000);
  });

  it("computes hour timeframes correctly", () => {
    expect(timeframeMs("hour", 1)).toBe(3_600_000);
    expect(timeframeMs("hour", 4)).toBe(14_400_000); // 4h = the WETH-breakout cadence
    expect(timeframeMs("hour", 12)).toBe(43_200_000);
  });

  it("computes daily correctly", () => {
    expect(timeframeMs("day", 1)).toBe(86_400_000);
  });

  it("rejects unknown timeframes", () => {
    expect(() => timeframeMs("week" as never, 1)).toThrow(/unknown timeframe/);
  });

  it("rejects bad aggregate values", () => {
    expect(() => timeframeMs("hour", 0)).toThrow(/positive integer/);
    expect(() => timeframeMs("hour", -1)).toThrow(/positive integer/);
    expect(() => timeframeMs("hour", 1.5)).toThrow(/positive integer/);
  });
});

// ----------------------------------------------------------------------------
// candlesToEvents
// ----------------------------------------------------------------------------

function mkCandle(tsSec: number, close: number, volumeUsd = 1_000_000): OhlcvCandle {
  return {
    ts: tsSec,
    open: close * 0.99,
    high: close * 1.01,
    low: close * 0.98,
    close,
    volumeUsd,
  };
}

describe("candlesToEvents", () => {
  it("returns events at candle close time, not start time", () => {
    const startTsSec = Math.floor(Date.parse("2026-04-27T12:00:00Z") / 1000);
    const events = candlesToEvents({
      symbol: "WETH",
      timeframe: "hour",
      aggregate: 4,
      candles: [mkCandle(startTsSec, 3000)],
    });
    expect(events).toHaveLength(1);
    // 4h candle starting 12:00 closes at 16:00
    expect(events[0]!.timestamp).toBe("2026-04-27T16:00:00.000Z");
    expect(events[0]!.symbol).toBe("WETH");
    expect(events[0]!.price).toBe(3000);
    expect(events[0]!.kind).toBe("candle_close");
  });

  it("emits all OHLCV fields in payload", () => {
    const tsSec = Math.floor(Date.parse("2026-04-27T12:00:00Z") / 1000);
    const candle: OhlcvCandle = {
      ts: tsSec,
      open: 2990,
      high: 3050,
      low: 2980,
      close: 3010,
      volumeUsd: 5_000_000,
    };
    const events = candlesToEvents({
      symbol: "WETH",
      timeframe: "hour",
      aggregate: 4,
      candles: [candle],
    });
    const p = events[0]!.payload as Record<string, number | string>;
    expect(p.open).toBe(2990);
    expect(p.high).toBe(3050);
    expect(p.low).toBe(2980);
    expect(p.close).toBe(3010);
    expect(p.volumeUsd).toBe(5_000_000);
    expect(p.timeframe).toBe("hour");
    expect(p.aggregate).toBe(4);
    expect(p.timeframeMs).toBe(14_400_000);
    expect(p.candleStartTs).toBe(tsSec);
  });

  it("sorts unsorted input chronologically", () => {
    const t0 = Math.floor(Date.parse("2026-04-27T00:00:00Z") / 1000);
    const events = candlesToEvents({
      symbol: "WETH",
      timeframe: "hour",
      aggregate: 4,
      candles: [
        mkCandle(t0 + 14_400, 3010), // 4h later
        mkCandle(t0, 3000), // earlier
        mkCandle(t0 + 28_800, 3020), // 8h later
      ],
    });
    expect(events.map((e) => e.price)).toEqual([3000, 3010, 3020]);
  });

  it("filters out candles with non-finite or non-positive close", () => {
    const ts = Math.floor(Date.parse("2026-04-27T00:00:00Z") / 1000);
    const events = candlesToEvents({
      symbol: "WETH",
      timeframe: "hour",
      aggregate: 4,
      candles: [
        { ts, open: 3000, high: 3010, low: 2990, close: 0, volumeUsd: 1 } as OhlcvCandle,
        { ts: ts + 14400, open: NaN, high: NaN, low: NaN, close: NaN, volumeUsd: 0 } as OhlcvCandle,
        mkCandle(ts + 28800, 3020),
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.price).toBe(3020);
  });

  it("uses a custom kind when provided", () => {
    const events = candlesToEvents({
      symbol: "WETH",
      timeframe: "hour",
      aggregate: 4,
      candles: [mkCandle(Date.parse("2026-04-27T00:00:00Z") / 1000, 3000)],
      kind: "custom_event",
    });
    expect(events[0]!.kind).toBe("custom_event");
  });

  it("produces chronologically-sorted output (always)", () => {
    const t0 = Math.floor(Date.parse("2026-04-27T00:00:00Z") / 1000);
    const events = candlesToEvents({
      symbol: "WETH",
      timeframe: "hour",
      aggregate: 4,
      candles: Array.from({ length: 50 }, (_, i) =>
        mkCandle(t0 + i * 14_400, 3000 + i),
      ),
    });
    let prev = 0;
    for (const ev of events) {
      const t = Date.parse(ev.timestamp);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });
});

// ----------------------------------------------------------------------------
// feedToEvents
// ----------------------------------------------------------------------------

describe("feedToEvents", () => {
  function makeFakeFeed(opts: {
    candles: OhlcvCandle[];
    timeframe?: "minute" | "hour" | "day";
    aggregate?: number;
  }) {
    return {
      getCandlesInWindow: (sym: string, fromIso: string, toIso: string) => {
        const fromTs = Math.floor(Date.parse(fromIso) / 1000);
        const toTs = Math.floor(Date.parse(toIso) / 1000);
        return opts.candles.filter((c) => c.ts >= fromTs && c.ts <= toTs);
      },
      config: {
        timeframe: opts.timeframe ?? ("hour" as const),
        aggregate: opts.aggregate ?? 4,
      },
    };
  }

  it("reads candles from a feed and converts to events", () => {
    const t0 = Math.floor(Date.parse("2026-04-27T00:00:00Z") / 1000);
    const candles = [mkCandle(t0, 3000), mkCandle(t0 + 14_400, 3010)];
    const feed = makeFakeFeed({ candles });
    const events = feedToEvents({
      feed,
      symbol: "WETH",
      fromISO: "2026-04-27T00:00:00Z",
      toISO: "2026-04-27T12:00:00Z",
    });
    expect(events).toHaveLength(2);
    expect(events[0]!.timestamp).toBe("2026-04-27T04:00:00.000Z");
    expect(events[1]!.timestamp).toBe("2026-04-27T08:00:00.000Z");
  });

  it("throws when the feed has no candles for the symbol/window", () => {
    const feed = makeFakeFeed({ candles: [] });
    expect(() =>
      feedToEvents({
        feed,
        symbol: "WETH",
        fromISO: "2026-04-27T00:00:00Z",
        toISO: "2026-04-27T12:00:00Z",
      }),
    ).toThrow(/no candles for WETH/);
  });

  it("respects the feed's timeframe config", () => {
    const t0 = Math.floor(Date.parse("2026-04-27T00:00:00Z") / 1000);
    const dailyFeed = makeFakeFeed({
      candles: [mkCandle(t0, 3000)],
      timeframe: "day",
      aggregate: 1,
    });
    const events = feedToEvents({
      feed: dailyFeed,
      symbol: "WETH",
      fromISO: "2026-04-27T00:00:00Z",
      toISO: "2026-04-28T00:00:00Z",
    });
    // 1d candle starting 00:00 closes at next 00:00
    expect(events[0]!.timestamp).toBe("2026-04-28T00:00:00.000Z");
    const p = events[0]!.payload as Record<string, unknown>;
    expect(p.timeframe).toBe("day");
    expect(p.aggregate).toBe(1);
  });
});
