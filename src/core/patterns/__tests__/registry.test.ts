import { describe, it, expect } from "vitest";
import { PatternRegistry } from "../registry.js";
import type { Pattern, MarketSnapshot, PatternState, Trigger, Position, ExitDecision } from "../types.js";
import type { TradeDecision } from "../trade-decision-shim.js";

// Minimal fake pattern for testing registry behavior.
function makeFake(overrides: Partial<Pattern> = {}): Pattern {
  return {
    name: "fake",
    version: "0.0.0",
    description: "test pattern",
    maxAllocationPct: 5,
    maxConcurrentPositions: 1,
    tickIntervalMs: 30_000,
    detect: (_m: MarketSnapshot, _s: PatternState): Trigger | null => null,
    enter: (_t: Trigger, _c: number, _a: number): TradeDecision => ({
      action: "BUY",
      fromToken: "USDC",
      toToken: "TEST",
      amountUSD: 1,
      reasoning: "test",
    }),
    monitor: (_p: Position, _m: MarketSnapshot, _s: PatternState): ExitDecision => "hold",
    ...overrides,
  };
}

describe("PatternRegistry", () => {
  it("registers a pattern with default disabled status", () => {
    const r = new PatternRegistry();
    const rec = r.register(makeFake());
    expect(rec.status).toBe("disabled");
    expect(rec.attributionTag).toBe("fake@0.0.0");
    expect(r.get("fake")?.pattern.name).toBe("fake");
  });

  it("rejects duplicate registrations by name", () => {
    const r = new PatternRegistry();
    r.register(makeFake());
    expect(() => r.register(makeFake())).toThrow(/already registered/);
  });

  it("rejects invalid maxAllocationPct", () => {
    const r = new PatternRegistry();
    expect(() => r.register(makeFake({ maxAllocationPct: -1 }))).toThrow(/maxAllocationPct/);
    expect(() => r.register(makeFake({ maxAllocationPct: 150 }))).toThrow(/maxAllocationPct/);
  });

  it("rejects invalid maxConcurrentPositions", () => {
    const r = new PatternRegistry();
    expect(() => r.register(makeFake({ maxConcurrentPositions: -1 }))).toThrow(/maxConcurrentPositions/);
    expect(() => r.register(makeFake({ maxConcurrentPositions: 1.5 }))).toThrow(/maxConcurrentPositions/);
  });

  it("rejects too-aggressive tickIntervalMs (MEV territory)", () => {
    const r = new PatternRegistry();
    expect(() => r.register(makeFake({ tickIntervalMs: 100 }))).toThrow(/tickIntervalMs/);
  });

  it("toggles status: disabled → paper → live", () => {
    const r = new PatternRegistry();
    r.register(makeFake());
    expect(r.get("fake")?.status).toBe("disabled");
    r.setStatus("fake", "paper");
    expect(r.get("fake")?.status).toBe("paper");
    r.setStatus("fake", "live");
    expect(r.get("fake")?.status).toBe("live");
  });

  it("byStatus filters correctly", () => {
    const r = new PatternRegistry();
    r.register(makeFake({ name: "a" }), "live");
    r.register(makeFake({ name: "b" }), "paper");
    r.register(makeFake({ name: "c" }), "disabled");
    expect(r.byStatus("live").map((x) => x.pattern.name)).toEqual(["a"]);
    expect(r.byStatus("paper").map((x) => x.pattern.name)).toEqual(["b"]);
    expect(r.byStatus("disabled").map((x) => x.pattern.name)).toEqual(["c"]);
  });

  it("deregister removes a pattern", () => {
    const r = new PatternRegistry();
    r.register(makeFake());
    expect(r.deregister("fake")).toBe(true);
    expect(r.deregister("fake")).toBe(false);
    expect(r.get("fake")).toBeUndefined();
  });

  it("minActiveTickIntervalMs returns the tightest tick across active patterns", () => {
    const r = new PatternRegistry();
    r.register(makeFake({ name: "slow", tickIntervalMs: 60_000 }), "live");
    r.register(makeFake({ name: "fast", tickIntervalMs: 1_000 }), "paper");
    r.register(makeFake({ name: "off", tickIntervalMs: 500 }), "disabled");
    // The disabled one's tick is ignored; min of slow + fast is fast.
    expect(r.minActiveTickIntervalMs()).toBe(1_000);
  });

  it("minActiveTickIntervalMs returns Infinity when nothing is active", () => {
    const r = new PatternRegistry();
    r.register(makeFake(), "disabled");
    expect(r.minActiveTickIntervalMs()).toBe(Number.POSITIVE_INFINITY);
  });

  it("setStatus on unknown pattern throws", () => {
    const r = new PatternRegistry();
    expect(() => r.setStatus("nope", "live")).toThrow(/not registered/);
  });
});
