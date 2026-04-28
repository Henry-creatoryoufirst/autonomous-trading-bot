import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  wethMomentumBreakoutPattern,
  _testInternals,
} from "../weth-momentum-breakout.js";
import type {
  MarketSnapshot,
  PatternState,
  Position,
} from "../types.js";

const { LOOKBACK_PERIODS, VOLUME_MULT, TAKE_PROFIT_PCT, TRAIL_STOP_PCT } =
  _testInternals;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function snap(opts: {
  ts: string;
  symbol?: string;
  close: number;
  high?: number;
  volumeUsd?: number;
  prices?: Record<string, number>;
  kind?: string;
}): MarketSnapshot {
  return {
    timestamp: opts.ts,
    prices: new Map(Object.entries(opts.prices ?? { WETH: opts.close })),
    extras: {
      event: {
        kind: opts.kind ?? "candle_close",
        symbol: opts.symbol ?? "WETH",
        payload: {
          open: opts.close * 0.99,
          high: opts.high ?? opts.close * 1.01,
          low: opts.close * 0.98,
          close: opts.close,
          volumeUsd: opts.volumeUsd ?? 1_000_000,
          timeframe: "hour",
          aggregate: 4,
        },
      },
    },
  };
}

function fillState(
  state: PatternState,
  count: number,
  startTs = "2026-01-01T00:00:00Z",
  baseVolume = 1_000_000,
): void {
  // Pre-populate the rolling window with `count` flat candles so the
  // pattern's warmup is satisfied. Each candle: close=3000, high=3010,
  // volume=baseVolume.
  let t = Date.parse(startTs);
  for (let i = 0; i < count; i++) {
    const s = snap({
      ts: new Date(t).toISOString(),
      close: 3000,
      high: 3010,
      volumeUsd: baseVolume,
    });
    wethMomentumBreakoutPattern.detect(s, state);
    t += 4 * 60 * 60 * 1000;
  }
}

// ----------------------------------------------------------------------------
// Detection tests
// ----------------------------------------------------------------------------

describe("wethMomentumBreakoutPattern.detect", () => {
  beforeEach(() => {
    process.env.WETH_BREAKOUT_PATTERN_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.WETH_BREAKOUT_PATTERN_ENABLED;
  });

  it("returns null when feature flag is OFF", () => {
    delete process.env.WETH_BREAKOUT_PATTERN_ENABLED;
    const state: PatternState = {};
    fillState(state, LOOKBACK_PERIODS);
    const s = snap({
      ts: "2026-04-28T00:00:00Z",
      close: 3500, // big breakout
      high: 3510,
      volumeUsd: 5_000_000,
    });
    expect(wethMomentumBreakoutPattern.detect(s, state)).toBeNull();
  });

  it("ignores non-candle_close events", () => {
    const state: PatternState = {};
    fillState(state, LOOKBACK_PERIODS);
    const s = snap({
      ts: "2026-04-28T00:00:00Z",
      close: 3500,
      kind: "aave_liquidation", // wrong kind
    });
    expect(wethMomentumBreakoutPattern.detect(s, state)).toBeNull();
  });

  it("ignores events for non-WETH symbols", () => {
    const state: PatternState = {};
    fillState(state, LOOKBACK_PERIODS);
    const s = snap({
      ts: "2026-04-28T00:00:00Z",
      symbol: "cbBTC",
      close: 3500,
      volumeUsd: 5_000_000,
    });
    expect(wethMomentumBreakoutPattern.detect(s, state)).toBeNull();
  });

  it("returns null during warmup (less than LOOKBACK candles seen)", () => {
    const state: PatternState = {};
    fillState(state, 5); // only 5 prior candles
    const s = snap({
      ts: "2026-04-28T00:00:00Z",
      close: 3500, // would be a big break
      volumeUsd: 5_000_000,
    });
    expect(wethMomentumBreakoutPattern.detect(s, state)).toBeNull();
  });

  it("does NOT fire when close is below prior high (no breakout)", () => {
    const state: PatternState = {};
    fillState(state, LOOKBACK_PERIODS); // prior high is 3010
    const s = snap({
      ts: "2026-04-28T00:00:00Z",
      close: 3005, // below prior high 3010
      high: 3009,
      volumeUsd: 5_000_000, // even with high volume
    });
    expect(wethMomentumBreakoutPattern.detect(s, state)).toBeNull();
  });

  it("does NOT fire when volume confirmation is missing", () => {
    const state: PatternState = {};
    fillState(state, LOOKBACK_PERIODS); // prior vol mean = 1M
    const s = snap({
      ts: "2026-04-28T00:00:00Z",
      close: 3050, // breaks above 3010
      high: 3055,
      volumeUsd: 1_200_000, // only 1.2× mean — below 1.5× threshold
    });
    expect(wethMomentumBreakoutPattern.detect(s, state)).toBeNull();
  });

  it("FIRES when both breakout AND volume confirmation present", () => {
    const state: PatternState = {};
    fillState(state, LOOKBACK_PERIODS);
    const s = snap({
      ts: "2026-04-28T00:00:00Z",
      close: 3050,
      high: 3055,
      volumeUsd: VOLUME_MULT * 1_000_000 + 1, // just above threshold
    });
    const trigger = wethMomentumBreakoutPattern.detect(s, state);
    expect(trigger).not.toBeNull();
    expect(trigger!.symbol).toBe("WETH");
    expect(trigger!.patternName).toBe("weth_momentum_breakout");
    expect(trigger!.context.close).toBe(3050);
    expect(trigger!.context.priorHigh).toBe(3010);
  });

  it("trims its rolling state to bounded size", () => {
    const state: PatternState = {};
    fillState(state, LOOKBACK_PERIODS * 4); // way more than needed
    const internal = (state as unknown as { recent: unknown[] }).recent;
    expect(internal.length).toBeLessThanOrEqual(LOOKBACK_PERIODS + 5);
  });
});

// ----------------------------------------------------------------------------
// enter()
// ----------------------------------------------------------------------------

describe("wethMomentumBreakoutPattern.enter", () => {
  it("returns a BUY USDC→WETH decision sized by conviction", () => {
    const trigger = {
      patternName: "weth_momentum_breakout",
      symbol: "WETH",
      detectedAt: "2026-04-28T00:00:00Z",
      context: {},
      summary: "test breakout",
    };
    const decision = wethMomentumBreakoutPattern.enter(trigger, 75, 200);
    expect(decision.action).toBe("BUY");
    expect(decision.fromToken).toBe("USDC");
    expect(decision.toToken).toBe("WETH");
    expect(decision.amountUSD).toBe(150); // 200 × 0.75
    expect(decision.sector).toBe("BLUE_CHIP");
    expect(decision.reasoning).toContain("test breakout");
    expect(decision.reasoning).toContain("conviction=75");
  });

  it("returns 0 size on conviction=0", () => {
    const trigger = {
      patternName: "weth_momentum_breakout",
      symbol: "WETH",
      detectedAt: "2026-04-28T00:00:00Z",
      context: {},
      summary: "test",
    };
    const decision = wethMomentumBreakoutPattern.enter(trigger, 0, 200);
    expect(decision.amountUSD).toBe(0);
  });
});

// ----------------------------------------------------------------------------
// monitor() — exit logic
// ----------------------------------------------------------------------------

describe("wethMomentumBreakoutPattern.monitor", () => {
  function makePosition(opts: { entryPrice: number; entryAt?: string; entryUsd?: number }): Position {
    return {
      patternName: "weth_momentum_breakout",
      symbol: "WETH",
      entryAt: opts.entryAt ?? "2026-04-28T00:00:00Z",
      entryPrice: opts.entryPrice,
      entryUsd: opts.entryUsd ?? 100,
      meta: {},
    };
  }

  it("holds when price is flat and within profit + loss bands", () => {
    const pos = makePosition({ entryPrice: 3000 });
    const market = snap({ ts: "2026-04-28T04:00:00Z", close: 3010 });
    const state: PatternState = {};
    expect(wethMomentumBreakoutPattern.monitor(pos, market, state)).toBe("hold");
  });

  it("exits with take_profit at TAKE_PROFIT_PCT gain", () => {
    const pos = makePosition({ entryPrice: 3000 });
    // Add 1 to side-step floating-point rounding when computing the
    // exact threshold price (3000 * 1.15 may compute to 3449.999... in IEEE-754)
    const tpPrice = 3000 * (1 + TAKE_PROFIT_PCT / 100) + 1;
    const market = snap({ ts: "2026-04-28T04:00:00Z", close: tpPrice });
    const decision = wethMomentumBreakoutPattern.monitor(pos, market, {});
    expect(decision).not.toBe("hold");
    expect((decision as { reason: string }).reason).toBe("take_profit");
  });

  it("exits with stop_loss at -10% from entry", () => {
    const pos = makePosition({ entryPrice: 3000 });
    const market = snap({ ts: "2026-04-28T04:00:00Z", close: 2700 });
    const decision = wethMomentumBreakoutPattern.monitor(pos, market, {});
    expect((decision as { reason: string }).reason).toBe("stop_loss");
  });

  it("exits with trail_stop after price ran up then dropped >TRAIL_STOP_PCT from peak", () => {
    const pos = makePosition({ entryPrice: 3000 });
    const state: PatternState = {};

    // Step 1: price runs up to 3300 (10% gain — under TP) — hold
    const m1 = snap({ ts: "2026-04-28T04:00:00Z", close: 3300 });
    expect(wethMomentumBreakoutPattern.monitor(pos, m1, state)).toBe("hold");

    // Step 2: price drops to 3050 — that's +1.67% from entry, but down
    // ~7.6% from peak — under TRAIL_STOP_PCT (8%)
    const m2 = snap({ ts: "2026-04-28T08:00:00Z", close: 3050 });
    expect(wethMomentumBreakoutPattern.monitor(pos, m2, state)).toBe("hold");

    // Step 3: price drops further to 3030 — drawdown from 3300 peak is 8.18%
    // crosses TRAIL_STOP_PCT ⇒ exit trail_stop
    const m3 = snap({ ts: "2026-04-28T12:00:00Z", close: 3030 });
    const decision = wethMomentumBreakoutPattern.monitor(pos, m3, state);
    expect((decision as { reason: string }).reason).toBe("trail_stop");
  });

  it("does NOT trigger trail_stop when never in profit territory", () => {
    const pos = makePosition({ entryPrice: 3000 });
    const state: PatternState = {};
    // Price goes 3000 → 2980 → 2920 — losing throughout, never +1% ahead
    const m1 = snap({ ts: "2026-04-28T04:00:00Z", close: 2980 });
    expect(wethMomentumBreakoutPattern.monitor(pos, m1, state)).toBe("hold");
    const m2 = snap({ ts: "2026-04-28T08:00:00Z", close: 2920 });
    expect(wethMomentumBreakoutPattern.monitor(pos, m2, state)).toBe("hold");
    // drop to 2700 triggers stop_loss, not trail_stop
    const m3 = snap({ ts: "2026-04-28T12:00:00Z", close: 2700 });
    const decision = wethMomentumBreakoutPattern.monitor(pos, m3, state);
    expect((decision as { reason: string }).reason).toBe("stop_loss");
  });

  it("exits with time_stop after MAX_HOLD_PERIODS × 4h", () => {
    const pos = makePosition({ entryPrice: 3000 });
    const state: PatternState = {};
    const entryMs = Date.parse(pos.entryAt);
    // 7d + a few hours past
    const lateTs = new Date(entryMs + (7 * 24 + 2) * 3600 * 1000).toISOString();
    const market = snap({ ts: lateTs, close: 3010 }); // basically flat
    const decision = wethMomentumBreakoutPattern.monitor(pos, market, state);
    expect((decision as { reason: string }).reason).toBe("time_stop");
  });

  it("returns hold when market price is missing", () => {
    const pos = makePosition({ entryPrice: 3000 });
    const market: MarketSnapshot = {
      timestamp: "2026-04-28T04:00:00Z",
      prices: new Map(), // no WETH
      extras: {},
    };
    expect(wethMomentumBreakoutPattern.monitor(pos, market, {})).toBe("hold");
  });
});
