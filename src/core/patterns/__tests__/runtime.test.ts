import { describe, it, expect } from "vitest";
import { PatternRegistry } from "../registry.js";
import { PatternRuntime } from "../runtime.js";
import type {
  Pattern,
  MarketSnapshot,
  PatternState,
  Trigger,
  Position,
  ExitDecision,
} from "../types.js";
import type { TradeDecision } from "../trade-decision-shim.js";

// ----------------------------------------------------------------------------
// Test fixtures
// ----------------------------------------------------------------------------

function snap(prices: Record<string, number>, t: string): MarketSnapshot {
  return { timestamp: t, prices: new Map(Object.entries(prices)) };
}

/** A deterministic test pattern that fires when XYZ < 0.95 and exits at >= 0.99. */
function makeArbPattern(): Pattern {
  return {
    name: "test_arb",
    version: "0.0.1-test",
    description: "fires below 0.95, exits at 0.99",
    maxAllocationPct: 50,
    maxConcurrentPositions: 1,
    tickIntervalMs: 1000,
    detect(market, _state) {
      const px = market.prices.get("XYZ");
      if (px === undefined || px >= 0.95) return null;
      return {
        patternName: "test_arb",
        symbol: "XYZ",
        detectedAt: market.timestamp,
        context: { price: px },
        summary: `XYZ at ${px}, below 0.95 threshold`,
      };
    },
    enter(trigger, conviction, allocationUsd) {
      const sizeUsd = (allocationUsd * conviction) / 100;
      return {
        action: "BUY",
        fromToken: "USDC",
        toToken: "XYZ",
        amountUSD: sizeUsd,
        reasoning: `test_arb entry · ${trigger.summary}`,
      };
    },
    monitor(_pos, market, _state): ExitDecision {
      const px = market.prices.get("XYZ");
      if (px === undefined) return "hold";
      if (px >= 0.99) return { action: "exit", reason: "recovery_target", pctClose: 100 };
      return "hold";
    },
  };
}

interface Filled {
  decision: TradeDecision;
  filledUsd: number;
  filledPrice: number;
}

/** Stub executor that fills at the current spot price for the trade's
 *  token, recording each call for assertion. */
function makeExecutor(currentPriceFor: (sym: string) => number) {
  const calls: Filled[] = [];
  const fn = async (decision: TradeDecision) => {
    const sym = decision.action === "BUY" ? decision.toToken : decision.fromToken;
    const px = currentPriceFor(sym);
    if (!sym || px <= 0) {
      throw new Error(`stub executor cannot fill ${decision.action} ${sym} at $${px}`);
    }
    const filled = {
      decision,
      filledUsd: decision.amountUSD,
      filledPrice: px,
    };
    calls.push(filled);
    return { filledUsd: filled.filledUsd, filledPrice: filled.filledPrice };
  };
  return { fn, calls };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("PatternRuntime — end-to-end pattern lifecycle", () => {
  it("ticks an inactive pattern with no triggers and does nothing", async () => {
    const reg = new PatternRegistry();
    reg.register(makeArbPattern(), "live");
    const exec = makeExecutor(() => 1.0);

    const states: Record<string, PatternState> = { test_arb: {} };
    const rt = new PatternRuntime(
      reg,
      {
        alphaSleeveUsd: () => 1000,
        executeFn: exec.fn,
        loadPatternState: (n) => states[n] ?? {},
      },
      "live",
    );

    const report = await rt.tick(snap({ XYZ: 1.0 }, "2026-01-01T00:00:00Z"));
    expect(report.triggersDetected).toBe(0);
    expect(report.entered).toBe(0);
    expect(exec.calls.length).toBe(0);
  });

  it("does not tick disabled patterns even when their detect would fire", async () => {
    const reg = new PatternRegistry();
    reg.register(makeArbPattern(), "disabled");
    const exec = makeExecutor((s) => (s === "XYZ" ? 0.9 : 1.0));
    const states: Record<string, PatternState> = { test_arb: {} };
    const rt = new PatternRuntime(
      reg,
      {
        alphaSleeveUsd: () => 1000,
        executeFn: exec.fn,
        loadPatternState: (n) => states[n] ?? {},
      },
      "live",
    );

    const report = await rt.tick(snap({ XYZ: 0.9 }, "2026-01-01T00:00:00Z"));
    expect(report.activePatternCount).toBe(0);
    expect(report.triggersDetected).toBe(0);
    expect(exec.calls.length).toBe(0);
  });

  it("full lifecycle: trigger → enter → monitor → exit, with attribution + P&L", async () => {
    const reg = new PatternRegistry();
    reg.register(makeArbPattern(), "live");

    let xyzPrice = 0.9;
    const exec = makeExecutor((s) => (s === "XYZ" ? xyzPrice : 1.0));
    const states: Record<string, PatternState> = { test_arb: {} };
    const rt = new PatternRuntime(
      reg,
      {
        alphaSleeveUsd: () => 1000,
        executeFn: exec.fn,
        loadPatternState: (n) => states[n] ?? {},
      },
      "live",
    );

    // Tick 1: depegged → detect fires → enter
    const r1 = await rt.tick(snap({ XYZ: xyzPrice }, "2026-01-01T00:00:00Z"));
    expect(r1.triggersDetected).toBe(1);
    expect(r1.entered).toBe(1);
    expect(rt.tracker.openPositions("test_arb").length).toBe(1);

    // Capacity check: maxConcurrentPositions=1, so a second tick at same price
    // should NOT enter again
    const r2 = await rt.tick(snap({ XYZ: xyzPrice }, "2026-01-01T00:00:30Z"));
    expect(r2.entered).toBe(0);
    expect(rt.tracker.openPositions("test_arb").length).toBe(1);

    // Tick 3: price recovers → monitor fires exit
    xyzPrice = 1.0;
    const r3 = await rt.tick(snap({ XYZ: xyzPrice }, "2026-01-01T01:00:00Z"));
    expect(r3.exited).toBe(1);
    expect(rt.tracker.openPositions("test_arb").length).toBe(0);
    expect(rt.tracker.closedPositions("test_arb").length).toBe(1);

    // P&L: bought at 0.9, sold at 1.0 → +11.1% gain
    const closed = rt.tracker.closedPositions("test_arb");
    expect(closed[0]!.realizedPnL).toBeGreaterThan(0);
    expect(closed[0]!.closeReason).toBe("recovery_target");

    // Stats — winRate should be 1.0 since we closed one winner
    const stats = rt.tracker.stats(new Map([["XYZ", 1.0]]));
    expect(stats.length).toBe(1);
    expect(stats[0]!.patternName).toBe("test_arb");
    expect(stats[0]!.winRate).toBe(1);
    expect(stats[0]!.realizedPnL).toBeGreaterThan(0);
  });

  it("respects allocation budget — enter() gets the per-position budget, not the full sleeve", async () => {
    const reg = new PatternRegistry();
    // 50% of $1000 sleeve = $500, divided across 2 positions = $250/position
    reg.register({ ...makeArbPattern(), maxConcurrentPositions: 2 }, "live");
    const exec = makeExecutor(() => 0.9);
    const states: Record<string, PatternState> = { test_arb: {} };
    const rt = new PatternRuntime(
      reg,
      {
        alphaSleeveUsd: () => 1000,
        executeFn: exec.fn,
        loadPatternState: (n) => states[n] ?? {},
      },
      "live",
    );
    await rt.tick(snap({ XYZ: 0.9 }, "2026-01-01T00:00:00Z"));
    // First entry: $250 budget × 100% conviction (no confirm()) = $250
    expect(exec.calls[0]!.decision.amountUSD).toBeCloseTo(250, 2);
  });

  it("survives detect() throwing — error reported, no crash, other patterns unaffected", async () => {
    const reg = new PatternRegistry();
    const broken: Pattern = {
      ...makeArbPattern(),
      name: "broken",
      detect: () => {
        throw new Error("intentional bomb");
      },
    };
    reg.register(broken, "live");
    reg.register({ ...makeArbPattern(), name: "ok" }, "live");
    const exec = makeExecutor(() => 0.9);
    const states: Record<string, PatternState> = { broken: {}, ok: {} };
    const rt = new PatternRuntime(
      reg,
      {
        alphaSleeveUsd: () => 1000,
        executeFn: exec.fn,
        loadPatternState: (n) => states[n] ?? {},
      },
      "live",
    );
    const report = await rt.tick(snap({ XYZ: 0.9 }, "2026-01-01T00:00:00Z"));
    expect(report.detectErrors.length).toBe(1);
    expect(report.detectErrors[0]!.patternName).toBe("broken");
    expect(report.entered).toBe(1); // 'ok' pattern still fires
  });

  it("confirm() returning null vetoes the trigger", async () => {
    const reg = new PatternRegistry();
    const veto: Pattern = {
      ...makeArbPattern(),
      name: "vetoed",
      confirm: async () => null,
    };
    reg.register(veto, "live");
    const exec = makeExecutor(() => 0.9);
    const states: Record<string, PatternState> = { vetoed: {} };
    const rt = new PatternRuntime(
      reg,
      {
        alphaSleeveUsd: () => 1000,
        executeFn: exec.fn,
        loadPatternState: (n) => states[n] ?? {},
      },
      "live",
    );
    const report = await rt.tick(snap({ XYZ: 0.9 }, "2026-01-01T00:00:00Z"));
    expect(report.triggersDetected).toBe(1);
    expect(report.convictionsAccepted).toBe(0);
    expect(report.entered).toBe(0);
  });

  it("paper mode runs only paper-status patterns", async () => {
    const reg = new PatternRegistry();
    reg.register({ ...makeArbPattern(), name: "live_p" }, "live");
    reg.register({ ...makeArbPattern(), name: "paper_p" }, "paper");
    const exec = makeExecutor(() => 0.9);
    const states: Record<string, PatternState> = { live_p: {}, paper_p: {} };
    const rt = new PatternRuntime(
      reg,
      {
        alphaSleeveUsd: () => 1000,
        executeFn: exec.fn,
        loadPatternState: (n) => states[n] ?? {},
      },
      "paper",
    );
    const report = await rt.tick(snap({ XYZ: 0.9 }, "2026-01-01T00:00:00Z"));
    expect(report.activePatternCount).toBe(1);
    expect(rt.tracker.openPositions("paper_p").length).toBe(1);
    expect(rt.tracker.openPositions("live_p").length).toBe(0);
  });
});
