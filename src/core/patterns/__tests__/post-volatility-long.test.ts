import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  aeroPostVolatilityLong,
  createPostVolatilityLongPattern,
  parseConvictionScore,
  buildConvictionPrompt,
  _testInternals,
} from "../post-volatility-long.js";
import {
  emptyCrossAssetState,
  computeCoStressScore,
  type CrossAssetState,
  type TokenState,
} from "../cross-asset-state.js";
import type {
  MarketSnapshot,
  PatternState,
  ConfirmContext,
  Position,
  Trigger,
} from "../types.js";

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

/** Build a TokenState with N flat candles + a final close. */
function makeTokenState(
  symbol: string,
  flatPrice: number,
  flatCount: number,
  finalPrice: number,
  realizedVol = 60,
): TokenState {
  return {
    symbol,
    candles: [...Array(flatCount).fill(flatPrice), finalPrice],
    recentDirectionalEdge: { fadeHit: 0.4, continueHit: 0.4 },
    realizedVol24h: realizedVol,
  };
}

/** Build a MarketSnapshot with cross-asset state injected. */
function snapshot(opts: {
  ts: string;
  prices?: Record<string, number>;
  cas?: CrossAssetState | null;
}): MarketSnapshot {
  return {
    timestamp: opts.ts,
    prices: new Map(Object.entries(opts.prices ?? {})),
    extras: opts.cas ? { crossAsset: opts.cas } : {},
  };
}

/** A CAS with one token populated for the happy-path tests. */
function casWithToken(
  symbol: string,
  tokenState: TokenState,
  ts = "2026-05-04T18:00:00Z",
): CrossAssetState {
  const base = emptyCrossAssetState(ts);
  return {
    ...base,
    tokens: { [symbol]: tokenState },
    fearGreed: 55,
    coStressScore: 30,
    btcDominanceTrend24h: -0.5,
    smartWalletFlow24h: 2500,
    recentEdge: { count: 8, hitRate: 0.36, meanReturn: 0.4, stdReturn: 2.1 },
  };
}

// ----------------------------------------------------------------------------
// Identity
// ----------------------------------------------------------------------------

describe("post-volatility-long: identity", () => {
  it("declares name, version, and bounded allocation", () => {
    expect(aeroPostVolatilityLong.name).toBe("aero_post_volatility_long");
    expect(aeroPostVolatilityLong.version).toMatch(/^0\.\d+\.\d+/);
    expect(aeroPostVolatilityLong.maxAllocationPct).toBeGreaterThan(0);
    expect(aeroPostVolatilityLong.maxAllocationPct).toBeLessThanOrEqual(10);
    expect(aeroPostVolatilityLong.maxConcurrentPositions).toBe(1);
    expect(aeroPostVolatilityLong.tickIntervalMs).toBeLessThanOrEqual(60_000);
  });

  it("factory builds a pattern for any uppercased symbol", () => {
    const p = createPostVolatilityLongPattern({ symbol: "brett" });
    expect(p.name).toBe("brett_post_volatility_long");
    // Description references the configured params
    expect(p.description).toMatch(/≥5%/);
    expect(p.description).toMatch(/3h/);
  });
});

// ----------------------------------------------------------------------------
// detect() — Layer 1
// ----------------------------------------------------------------------------

describe("post-volatility-long: detect()", () => {
  const ENV_KEY = "POST_VOL_LONG_PATTERN_ENABLED";

  beforeEach(() => {
    process.env[ENV_KEY] = "true";
  });
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("returns null when the env-var gate is off", () => {
    delete process.env[ENV_KEY];
    const tokenState = makeTokenState("AERO", 1.0, 60, 1.06); // +6%
    const t = aeroPostVolatilityLong.detect(
      snapshot({ ts: "2026-05-04T18:00:00Z", cas: casWithToken("AERO", tokenState) }),
      {} as PatternState,
    );
    expect(t).toBeNull();
  });

  it("returns null when no cross-asset state is present", () => {
    const t = aeroPostVolatilityLong.detect(
      snapshot({ ts: "2026-05-04T18:00:00Z", cas: null }),
      {} as PatternState,
    );
    expect(t).toBeNull();
  });

  it("returns null when the requested token isn't in the cross-asset map", () => {
    const otherTokenState = makeTokenState("BRETT", 1.0, 60, 1.10);
    const t = aeroPostVolatilityLong.detect(
      snapshot({
        ts: "2026-05-04T18:00:00Z",
        cas: casWithToken("BRETT", otherTokenState),
      }),
      {} as PatternState,
    );
    expect(t).toBeNull();
  });

  it("returns null when the candle ring isn't filled to the rolling window", () => {
    const tokenState = makeTokenState("AERO", 1.0, 30, 1.06); // only 31 candles
    const t = aeroPostVolatilityLong.detect(
      snapshot({ ts: "2026-05-04T18:00:00Z", cas: casWithToken("AERO", tokenState) }),
      {} as PatternState,
    );
    expect(t).toBeNull();
  });

  it("returns null when the rolling-1h move is below the 5% threshold", () => {
    const tokenState = makeTokenState("AERO", 1.0, 60, 1.04); // +4%
    const t = aeroPostVolatilityLong.detect(
      snapshot({ ts: "2026-05-04T18:00:00Z", cas: casWithToken("AERO", tokenState) }),
      {} as PatternState,
    );
    expect(t).toBeNull();
  });

  it("fires on a +6% UP move", () => {
    const tokenState = makeTokenState("AERO", 1.0, 60, 1.06); // +6%
    const state: PatternState = {};
    const t = aeroPostVolatilityLong.detect(
      snapshot({ ts: "2026-05-04T18:00:00Z", cas: casWithToken("AERO", tokenState) }),
      state,
    );
    expect(t).not.toBeNull();
    expect(t!.symbol).toBe("AERO");
    expect((t!.context as { direction: string }).direction).toBe("up");
    expect((t!.context as { movePct: number }).movePct).toBeCloseTo(6, 0);
    expect(t!.summary).toMatch(/AERO/);
    expect(t!.summary).toMatch(/\+6/);
  });

  it("fires on a -7% DOWN move", () => {
    const tokenState = makeTokenState("AERO", 1.0, 60, 0.93); // -7%
    const t = aeroPostVolatilityLong.detect(
      snapshot({ ts: "2026-05-04T18:00:00Z", cas: casWithToken("AERO", tokenState) }),
      {} as PatternState,
    );
    expect(t).not.toBeNull();
    expect((t!.context as { direction: string }).direction).toBe("down");
    expect((t!.context as { movePct: number }).movePct).toBeCloseTo(-7, 0);
  });

  it("respects anti-stack — no second trigger within the cooldown window", () => {
    const tokenState = makeTokenState("AERO", 1.0, 60, 1.06);
    const state: PatternState = {};

    const first = aeroPostVolatilityLong.detect(
      snapshot({ ts: "2026-05-04T18:00:00Z", cas: casWithToken("AERO", tokenState) }),
      state,
    );
    expect(first).not.toBeNull();

    // 30 min later, still inside the 60-min cooldown
    const second = aeroPostVolatilityLong.detect(
      snapshot({ ts: "2026-05-04T18:30:00Z", cas: casWithToken("AERO", tokenState) }),
      state,
    );
    expect(second).toBeNull();
  });

  it("allows another trigger after the anti-stack window has passed", () => {
    const tokenState = makeTokenState("AERO", 1.0, 60, 1.06);
    const state: PatternState = {};

    aeroPostVolatilityLong.detect(
      snapshot({ ts: "2026-05-04T18:00:00Z", cas: casWithToken("AERO", tokenState) }),
      state,
    );

    // 65 min later, past the 60-min cooldown
    const second = aeroPostVolatilityLong.detect(
      snapshot({ ts: "2026-05-04T19:05:00Z", cas: casWithToken("AERO", tokenState) }),
      state,
    );
    expect(second).not.toBeNull();
  });
});

// ----------------------------------------------------------------------------
// confirm() — Layer 2 (the alpha layer)
// ----------------------------------------------------------------------------

describe("post-volatility-long: confirm()", () => {
  const sampleTrigger: Trigger = {
    patternName: "aero_post_volatility_long",
    symbol: "AERO",
    detectedAt: "2026-05-04T18:00:00Z",
    context: { direction: "up", movePct: 6.2 },
    summary: "AERO 60min move +6.2% — post-volatility long candidate",
  };

  it("returns null (veto) when askAI is not provided — fail closed", async () => {
    const tokenState = makeTokenState("AERO", 1.0, 60, 1.06);
    const ctx: ConfirmContext = {
      trigger: sampleTrigger,
      market: snapshot({
        ts: "2026-05-04T18:00:00Z",
        cas: casWithToken("AERO", tokenState),
      }),
      // no askAI
    };
    const c = await aeroPostVolatilityLong.confirm!(ctx);
    expect(c).toBeNull();
  });

  it("returns null (veto) when cross-asset state is missing", async () => {
    const ctx: ConfirmContext = {
      trigger: sampleTrigger,
      market: snapshot({ ts: "2026-05-04T18:00:00Z", cas: null }),
      askAI: vi.fn(async () => "75"),
    };
    const c = await aeroPostVolatilityLong.confirm!(ctx);
    expect(c).toBeNull();
  });

  it("returns the parsed conviction score on a clean AI response", async () => {
    const tokenState = makeTokenState("AERO", 1.0, 60, 1.06);
    const askAI: NonNullable<ConfirmContext["askAI"]> = vi.fn(
      async () => "72\nBecause the macro regime is BULL and co-stress is low",
    );
    const ctx: ConfirmContext = {
      trigger: sampleTrigger,
      market: snapshot({
        ts: "2026-05-04T18:00:00Z",
        cas: casWithToken("AERO", tokenState),
      }),
      askAI,
    };
    const c = await aeroPostVolatilityLong.confirm!(ctx);
    expect(c).toBe(72);
    expect(askAI).toHaveBeenCalledOnce();
    // Verify the cheap-tier preference is passed through
    const mockedAskAI = askAI as unknown as ReturnType<typeof vi.fn>;
    expect(mockedAskAI.mock.calls[0]?.[1]).toMatchObject({ tier: "cheap" });
  });

  it("returns null when the AI response can't be parsed", async () => {
    const tokenState = makeTokenState("AERO", 1.0, 60, 1.06);
    const askAI = vi.fn(async () => "I cannot determine a score from these inputs.");
    const ctx: ConfirmContext = {
      trigger: sampleTrigger,
      market: snapshot({
        ts: "2026-05-04T18:00:00Z",
        cas: casWithToken("AERO", tokenState),
      }),
      askAI,
    };
    const c = await aeroPostVolatilityLong.confirm!(ctx);
    expect(c).toBeNull();
  });

  it("returns null when the AI throws — failure is veto, never silent enter", async () => {
    const tokenState = makeTokenState("AERO", 1.0, 60, 1.06);
    const askAI = vi.fn(async () => {
      throw new Error("rate-limited");
    });
    const ctx: ConfirmContext = {
      trigger: sampleTrigger,
      market: snapshot({
        ts: "2026-05-04T18:00:00Z",
        cas: casWithToken("AERO", tokenState),
      }),
      askAI,
    };
    const c = await aeroPostVolatilityLong.confirm!(ctx);
    expect(c).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// enter() — Layer 3 (mechanical sizing)
// ----------------------------------------------------------------------------

describe("post-volatility-long: enter()", () => {
  const trigger: Trigger = {
    patternName: "aero_post_volatility_long",
    symbol: "AERO",
    detectedAt: "2026-05-04T18:00:00Z",
    context: { direction: "up", movePct: 6.2 },
    summary: "AERO 60min move +6.2% — post-volatility long candidate",
  };

  it("sizes the position proportional to conviction", () => {
    const decision = aeroPostVolatilityLong.enter(trigger, 75, 1000);
    expect(decision.action).toBe("BUY");
    expect(decision.fromToken).toBe("USDC");
    expect(decision.toToken).toBe("AERO");
    expect(decision.amountUSD).toBeCloseTo(750, 2);
    expect(decision.reasoning).toMatch(/conviction=75/);
  });

  it("scales linearly: conviction=100 → full allocation", () => {
    const decision = aeroPostVolatilityLong.enter(trigger, 100, 1000);
    expect(decision.amountUSD).toBeCloseTo(1000, 2);
  });

  it("returns $0 BUY (explicit no-op) when conviction-sized < min position", () => {
    // 30% of $100 = $30, below the $50 floor
    const decision = aeroPostVolatilityLong.enter(trigger, 30, 100);
    expect(decision.amountUSD).toBe(0);
  });

  it("does NOT zero-out a position that's exactly at the floor", () => {
    // 50% of $100 = $50, exactly at the floor — should pass
    const decision = aeroPostVolatilityLong.enter(trigger, 50, 100);
    expect(decision.amountUSD).toBe(50);
  });
});

// ----------------------------------------------------------------------------
// monitor() — Layer 3 (mechanical exits)
// ----------------------------------------------------------------------------

describe("post-volatility-long: monitor()", () => {
  function position(opts?: Partial<Position>): Position {
    return {
      patternName: "aero_post_volatility_long",
      symbol: "AERO",
      entryAt: "2026-05-04T18:00:00Z",
      entryPrice: 1.0,
      entryUsd: 500,
      meta: {},
      ...opts,
    };
  }

  it("returns 'hold' when no price is available for the symbol", () => {
    const r = aeroPostVolatilityLong.monitor(
      position(),
      snapshot({ ts: "2026-05-04T18:30:00Z" }),
      {},
    );
    expect(r).toBe("hold");
  });

  it("returns 'hold' when within the ±3% range and within time stop", () => {
    const r = aeroPostVolatilityLong.monitor(
      position(),
      snapshot({ ts: "2026-05-04T18:30:00Z", prices: { AERO: 1.015 } }),
      {},
    );
    expect(r).toBe("hold");
  });

  it("exits on profit_target at +3%", () => {
    const r = aeroPostVolatilityLong.monitor(
      position(),
      snapshot({ ts: "2026-05-04T18:30:00Z", prices: { AERO: 1.03 } }),
      {},
    );
    expect(r).toMatchObject({ action: "exit", reason: "profit_target" });
  });

  it("exits on stop_loss at -3%", () => {
    const r = aeroPostVolatilityLong.monitor(
      position(),
      snapshot({ ts: "2026-05-04T18:30:00Z", prices: { AERO: 0.97 } }),
      {},
    );
    expect(r).toMatchObject({ action: "exit", reason: "stop_loss" });
  });

  it("exits on time_stop after 3h regardless of PnL", () => {
    const r = aeroPostVolatilityLong.monitor(
      position(),
      snapshot({ ts: "2026-05-04T21:00:00Z", prices: { AERO: 1.005 } }),
      {},
    );
    expect(r).toMatchObject({ action: "exit", reason: "time_stop" });
  });

  it("does not time-stop just before the 3h mark", () => {
    const r = aeroPostVolatilityLong.monitor(
      position(),
      snapshot({ ts: "2026-05-04T20:55:00Z", prices: { AERO: 1.005 } }),
      {},
    );
    expect(r).toBe("hold");
  });
});

// ----------------------------------------------------------------------------
// parseConvictionScore — exported helper
// ----------------------------------------------------------------------------

describe("parseConvictionScore", () => {
  it("parses a bare integer", () => {
    expect(parseConvictionScore("75")).toBe(75);
  });

  it("parses an integer followed by reasoning on the same line", () => {
    expect(parseConvictionScore("82 — strong macro tailwind")).toBe(82);
  });

  it("parses an integer followed by reasoning on the next line", () => {
    expect(parseConvictionScore("60\nBecause co-stress is moderate")).toBe(60);
  });

  it("accepts the boundary values 0 and 100", () => {
    expect(parseConvictionScore("0")).toBe(0);
    expect(parseConvictionScore("100")).toBe(100);
  });

  it("rejects out-of-range values", () => {
    expect(parseConvictionScore("150")).toBeNull();
    expect(parseConvictionScore("-5")).toBeNull();
  });

  it("returns null on garbage input", () => {
    expect(parseConvictionScore("")).toBeNull();
    expect(parseConvictionScore("not a number")).toBeNull();
    expect(parseConvictionScore("abc 75")).toBeNull(); // integer must be at line start
  });
});

// ----------------------------------------------------------------------------
// computeCoStressScore — cross-asset helper
// ----------------------------------------------------------------------------

describe("computeCoStressScore", () => {
  it("returns 0 for empty input", () => {
    expect(computeCoStressScore([])).toBe(0);
  });

  it("returns 0 when only one token has data", () => {
    expect(computeCoStressScore([100])).toBe(0);
  });

  it("returns 0 when no token is elevated above the baseline", () => {
    expect(computeCoStressScore([50, 50, 50])).toBe(0);
  });

  it("returns a high score when the top two tokens are both elevated", () => {
    // Three tokens; baseline (median) = 30, top two are 90+ — strong co-stress.
    const score = computeCoStressScore([90, 92, 30]);
    expect(score).toBeGreaterThan(50);
  });

  it("returns a LOW score when only one token is elevated (idiosyncratic)", () => {
    // One token spikes; the other two stay calm. Idiosyncratic — low co-stress.
    const score = computeCoStressScore([90, 30, 30]);
    expect(score).toBeLessThan(20);
  });

  it("saturates at 100 (does not over-shoot)", () => {
    const score = computeCoStressScore([1000, 1000, 10]);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ----------------------------------------------------------------------------
// buildConvictionPrompt — sanity that all the alpha-layer inputs reach the LLM
// ----------------------------------------------------------------------------

describe("buildConvictionPrompt", () => {
  it("includes the trigger, all cross-asset signals, and per-token state", () => {
    const tokenState = makeTokenState("AERO", 1.0, 60, 1.06);
    const cas = casWithToken("AERO", tokenState);
    const trigger: Trigger = {
      patternName: "aero_post_volatility_long",
      symbol: "AERO",
      detectedAt: "2026-05-04T18:00:00Z",
      context: { direction: "up", movePct: 6.2 },
      summary: "AERO 60min move +6.2% — post-volatility long candidate",
    };

    const prompt = buildConvictionPrompt(trigger, cas, tokenState);

    // Trigger details surfaced
    expect(prompt).toMatch(/AERO/);
    expect(prompt).toMatch(/up/);
    expect(prompt).toMatch(/6\.2%/);

    // All cross-asset inputs surfaced — these are the alpha layer
    expect(prompt).toMatch(/Macro regime: RANGING/);
    expect(prompt).toMatch(/BTC dominance/);
    expect(prompt).toMatch(/Fear & Greed: 55/);
    expect(prompt).toMatch(/Co-stress score/);
    expect(prompt).toMatch(/Smart-wallet/);

    // Per-token state surfaced
    expect(prompt).toMatch(/Realized vol/);
    expect(prompt).toMatch(/fade hit rate/i);
    expect(prompt).toMatch(/continuation hit rate/i);

    // Pattern-level recent edge surfaced
    expect(prompt).toMatch(/THIS PATTERN'S RECENT EDGE/);

    // Calibration anchor — the LLM needs to know what 50 means
    expect(prompt).toMatch(/Calibration anchor: 50/);
  });
});

// ----------------------------------------------------------------------------
// Internals exposed match what the spec promised
// ----------------------------------------------------------------------------

describe("post-volatility-long: parameter values match SPEC-024", () => {
  it("uses the 5%/1h trigger, 3% target, 3h time stop", () => {
    expect(_testInternals.MOVE_THRESHOLD_PCT).toBe(5);
    expect(_testInternals.ROLLING_WINDOW_MIN).toBe(60);
    expect(_testInternals.TAKE_PROFIT_PCT).toBe(3);
    expect(_testInternals.STOP_LOSS_PCT).toBe(3);
    expect(_testInternals.TIME_STOP_HOURS).toBe(3);
    expect(_testInternals.ANTI_STACK_MIN).toBe(60);
    expect(_testInternals.MIN_POSITION_USD).toBe(50);
  });
});
