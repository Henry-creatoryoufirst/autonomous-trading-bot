import { describe, it, expect } from "vitest";
import { stablecoinDepegPattern, _testInternals } from "../stablecoin-depeg.js";
import type { MarketSnapshot, PatternState } from "../types.js";

function snapshot(prices: Record<string, number>, atIso: string): MarketSnapshot {
  return {
    timestamp: atIso,
    prices: new Map(Object.entries(prices)),
  };
}

describe("stablecoinDepegPattern (stub)", () => {
  it("identifies itself + its allocation budget correctly", () => {
    expect(stablecoinDepegPattern.name).toBe("stablecoin_depeg");
    expect(stablecoinDepegPattern.maxAllocationPct).toBeLessThanOrEqual(10);
    expect(stablecoinDepegPattern.maxConcurrentPositions).toBeGreaterThan(0);
  });

  it("returns null when no whitelisted stable has a price", () => {
    const state: PatternState = {};
    const t = stablecoinDepegPattern.detect(
      snapshot({ AERO: 1.5 }, "2026-04-27T20:00:00Z"),
      state,
    );
    expect(t).toBeNull();
  });

  it("returns null when stable is at peg", () => {
    const state: PatternState = {};
    const t = stablecoinDepegPattern.detect(
      snapshot({ USDC: 1.0001 }, "2026-04-27T20:00:00Z"),
      state,
    );
    expect(t).toBeNull();
  });

  it("excludes algorithmic / non-whitelisted stables from triggers", () => {
    const state: PatternState = {};
    // UST is intentionally not in the whitelist; even at huge depeg, no trigger.
    const t = stablecoinDepegPattern.detect(
      snapshot({ UST: 0.5 }, "2026-04-27T20:00:00Z"),
      state,
    );
    expect(t).toBeNull();
    expect(_testInternals.WHITELIST.has("UST")).toBe(false);
  });

  it("does not fire on first tick below threshold (needs sustained duration)", () => {
    const state: PatternState = {};
    const t = stablecoinDepegPattern.detect(
      snapshot({ USDC: 0.99 }, "2026-04-27T20:00:00Z"), // -100 bps
      state,
    );
    expect(t).toBeNull();
    // But state should now record the first-seen time
    expect((state as { firstSeenBelowPeg?: Record<string, string> }).firstSeenBelowPeg?.USDC).toBe("2026-04-27T20:00:00Z");
  });

  it("does not fire even after sustained duration while STUB_DISABLE_TRIGGERS is on", () => {
    // Documents the current safety guard: detect() builds up state but
    // returns null until the stub guard is removed.
    const state: PatternState = {};
    const t1 = stablecoinDepegPattern.detect(
      snapshot({ USDC: 0.99 }, "2026-04-27T20:00:00Z"),
      state,
    );
    expect(t1).toBeNull();
    const tenMinLater = "2026-04-27T20:10:00Z";
    const t2 = stablecoinDepegPattern.detect(snapshot({ USDC: 0.99 }, tenMinLater), state);
    // Sustained > 5min, but stub guard still blocks the live fire.
    expect(t2).toBeNull();
  });

  it("resets first-seen tracking when stable recovers above threshold", () => {
    const state: PatternState = {};
    stablecoinDepegPattern.detect(
      snapshot({ USDC: 0.99 }, "2026-04-27T20:00:00Z"),
      state,
    );
    // Recovery
    stablecoinDepegPattern.detect(
      snapshot({ USDC: 1.0 }, "2026-04-27T20:01:00Z"),
      state,
    );
    expect((state as { firstSeenBelowPeg?: Record<string, string | undefined> }).firstSeenBelowPeg?.USDC).toBeUndefined();
  });

  it("monitor returns 'hold' on the stub", () => {
    const exit = stablecoinDepegPattern.monitor(
      {
        patternName: "stablecoin_depeg",
        symbol: "USDC",
        entryAt: "2026-04-27T20:00:00Z",
        entryPrice: 0.97,
        entryUsd: 100,
        meta: {},
      },
      snapshot({ USDC: 0.985 }, "2026-04-27T21:00:00Z"),
      {},
    );
    expect(exit).toBe("hold");
  });

  it("enter() builds a BUY decision sized by conviction", () => {
    const trigger = {
      patternName: "stablecoin_depeg",
      symbol: "USDC" as const,
      detectedAt: "2026-04-27T20:00:00Z",
      context: {},
      summary: "test",
    };
    const decision = stablecoinDepegPattern.enter(trigger, 80, 100);
    expect(decision.action).toBe("BUY");
    expect(decision.fromToken).toBe("USDC");
    expect(decision.toToken).toBe("USDC"); // stable depeg targets the stable itself
    expect(decision.amountUSD).toBeCloseTo(80, 2); // 80% conviction × $100 allocation
  });
});
