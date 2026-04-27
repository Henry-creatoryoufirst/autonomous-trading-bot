import { describe, it, expect } from "vitest";
import { PatternRegistry } from "../../core/patterns/registry.js";
import { PatternRuntime } from "../../core/patterns/runtime.js";
import { EventReplayer, syntheticDepegScenario } from "../event-replayer.js";
import type {
  Pattern,
  MarketSnapshot,
  PatternState,
  Trigger,
  Position,
  ExitDecision,
} from "../../core/patterns/types.js";
import type { TradeDecision } from "../../core/patterns/trade-decision-shim.js";

// ----------------------------------------------------------------------------
// A test pattern that fires when price drops below 0.95 and exits >= 0.99.
// (Identical shape to the runtime test fixture so we know the runtime
// pieces work; what we're testing here is the event replayer driving them.)
// ----------------------------------------------------------------------------

function makeDepegishPattern(): Pattern {
  return {
    name: "test_depeg_like",
    version: "0.0.1-test",
    description: "fires <0.95, exits >=0.99",
    maxAllocationPct: 50,
    maxConcurrentPositions: 1,
    tickIntervalMs: 1000,
    detect(market, _state) {
      const px = market.prices.get("USDC");
      if (px === undefined || px >= 0.95) return null;
      return {
        patternName: "test_depeg_like",
        symbol: "USDC",
        detectedAt: market.timestamp,
        context: { price: px },
        summary: `USDC at ${px}`,
      };
    },
    enter(_t, conviction, allocationUsd) {
      return {
        action: "BUY",
        fromToken: "USDC",
        toToken: "USDC",
        amountUSD: (allocationUsd * conviction) / 100,
        reasoning: "test entry",
      };
    },
    monitor(_pos, market, _state): ExitDecision {
      const px = market.prices.get("USDC");
      if (px === undefined) return "hold";
      if (px >= 0.99) return { action: "exit", reason: "recovery", pctClose: 100 };
      return "hold";
    },
  };
}

function makeExecutor(currentPrice: () => number) {
  const calls: TradeDecision[] = [];
  const fn = async (decision: TradeDecision) => {
    calls.push(decision);
    return { filledUsd: decision.amountUSD, filledPrice: currentPrice() };
  };
  return { fn, calls };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("EventReplayer", () => {
  it("replays an empty event list cleanly", async () => {
    const reg = new PatternRegistry();
    const exec = makeExecutor(() => 1.0);
    const runtime = new PatternRuntime(reg, {
      alphaSleeveUsd: () => 1000,
      executeFn: exec.fn,
      loadPatternState: () => ({}),
    });
    const replayer = new EventReplayer(runtime);
    const result = await replayer.replay([]);
    expect(result.eventsReplayed).toBe(0);
    expect(result.tickReports).toHaveLength(0);
  });

  it("rejects out-of-order events", async () => {
    const reg = new PatternRegistry();
    const exec = makeExecutor(() => 1.0);
    const runtime = new PatternRuntime(reg, {
      alphaSleeveUsd: () => 1000,
      executeFn: exec.fn,
      loadPatternState: () => ({}),
    });
    const replayer = new EventReplayer(runtime);
    await expect(
      replayer.replay([
        { timestamp: "2026-01-01T00:01:00Z", symbol: "X", price: 1, kind: "x" },
        { timestamp: "2026-01-01T00:00:00Z", symbol: "X", price: 1, kind: "x" }, // out of order!
      ]),
    ).rejects.toThrow(/chronologically sorted/);
  });

  it("invokes onTick callback for every event with the corresponding report", async () => {
    const reg = new PatternRegistry();
    const exec = makeExecutor(() => 1.0);
    const runtime = new PatternRuntime(reg, {
      alphaSleeveUsd: () => 1000,
      executeFn: exec.fn,
      loadPatternState: () => ({}),
    });
    const replayer = new EventReplayer(runtime);
    const seen: { ts: string; reportTs: string }[] = [];
    const events = [
      { timestamp: "2026-01-01T00:00:00Z", symbol: "X", price: 1, kind: "x" },
      { timestamp: "2026-01-01T00:00:30Z", symbol: "X", price: 1, kind: "x" },
    ];
    await replayer.replay(events, {
      onTick: (ev, rep) => {
        seen.push({ ts: ev.timestamp, reportTs: rep.timestamp });
      },
    });
    expect(seen).toEqual([
      { ts: "2026-01-01T00:00:00Z", reportTs: "2026-01-01T00:00:00Z" },
      { ts: "2026-01-01T00:00:30Z", reportTs: "2026-01-01T00:00:30Z" },
    ]);
  });

  it("end-to-end: depeg scenario drives a pattern through entry → exit", async () => {
    const reg = new PatternRegistry();
    const pattern = makeDepegishPattern();
    reg.register(pattern, "live");

    const states: Record<string, PatternState> = { test_depeg_like: {} };

    // Track the latest market price the executor should fill at.
    // The runtime updates it via tick() (not directly), but our exec
    // needs the price at fill time. We track via a closure that the
    // replayer's onTick callback updates.
    let latestPrice = 1.0;
    const exec = makeExecutor(() => latestPrice);

    const runtime = new PatternRuntime(reg, {
      alphaSleeveUsd: () => 1000,
      executeFn: exec.fn,
      loadPatternState: (n) => states[n] ?? {},
    });

    const replayer = new EventReplayer(runtime);
    const events = syntheticDepegScenario({
      warmupMinutes: 1,
      dropMinutes: 5,
      floorPrice: 0.9,
      holdMinutes: 5,
      recoveryMinutes: 10,
      tickIntervalSec: 60, // 1 tick per minute
    });

    // Update latestPrice as we replay so the executor fills at the
    // right level. (The replayer doesn't know about the executor's
    // closure; the onTick hook is exactly for this kind of glue.)
    await replayer.replay(events, {
      onTick: (ev) => {
        latestPrice = ev.price;
      },
    });

    // We should have entered on the way down (somewhere below 0.95)
    // and exited on the way back up (>=0.99). One round-trip.
    const open = runtime.tracker.openPositions("test_depeg_like");
    const closed = runtime.tracker.closedPositions("test_depeg_like");
    expect(open.length).toBe(0);
    expect(closed.length).toBe(1);
    expect(closed[0]!.closeReason).toBe("recovery");
    // Bought below 0.95, sold at >= 0.99 — should be a winner.
    expect(closed[0]!.realizedPnL).toBeGreaterThan(0);

    // Stats should attribute correctly to our test pattern.
    const stats = runtime.tracker.stats(new Map([["USDC", 1.0]]));
    expect(stats.length).toBe(1);
    expect(stats[0]!.patternName).toBe("test_depeg_like");
    expect(stats[0]!.winRate).toBe(1);
    expect(stats[0]!.realizedPnL).toBeGreaterThan(0);
  });

  it("synthetic depeg scenario produces monotonically chronological events", () => {
    const events = syntheticDepegScenario({ tickIntervalSec: 30 });
    let prev = 0;
    for (const e of events) {
      const t = Date.parse(e.timestamp);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    expect(events.length).toBeGreaterThan(0);
  });

  it("synthetic depeg scenario goes peg → floor → recovery in price", () => {
    const events = syntheticDepegScenario({
      warmupMinutes: 1,
      dropMinutes: 2,
      floorPrice: 0.85,
      holdMinutes: 2,
      recoveryMinutes: 4,
      tickIntervalSec: 60,
    });
    const prices = events.map((e) => e.price);
    // First tick is at peg
    expect(prices[0]).toBeCloseTo(1.0, 2);
    // Floor reached somewhere in the middle
    const minPrice = Math.min(...prices);
    expect(minPrice).toBeCloseTo(0.85, 2);
    // Recovery completes
    expect(prices[prices.length - 1]).toBeCloseTo(1.0, 2);
  });
});
