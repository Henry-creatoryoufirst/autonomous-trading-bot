import { describe, it, expect } from "vitest";
import {
  makeBacktestExecutor,
  makeSnapshotRef,
} from "../backtest-executor.js";
import { FixturePriceFeed } from "../data/price-feed.js";
import type { MarketSnapshot } from "../../core/patterns/types.js";
import type { TradeDecision } from "../../core/patterns/trade-decision-shim.js";

function snap(opts: {
  ts?: string;
  prices?: Record<string, number>;
}): MarketSnapshot {
  return {
    timestamp: opts.ts ?? "2026-04-27T12:00:00Z",
    prices: new Map(Object.entries(opts.prices ?? {})),
    extras: {},
  };
}

function buy(toToken: string, usd: number): TradeDecision {
  return {
    action: "BUY",
    fromToken: "USDC",
    toToken,
    amountUSD: usd,
    reasoning: "test",
  };
}

function sell(fromToken: string, usd: number): TradeDecision {
  return {
    action: "SELL",
    fromToken,
    toToken: "USDC",
    amountUSD: usd,
    reasoning: "test",
  };
}

describe("makeBacktestExecutor", () => {
  it("throws if no snapshot has been set yet", async () => {
    const ref = makeSnapshotRef();
    const { executeFn } = makeBacktestExecutor({ snapshotRef: ref });
    await expect(executeFn(buy("WETH", 100))).rejects.toThrow(/no current snapshot/);
  });

  it("fills a BUY at the snapshot's price for the toToken", async () => {
    const ref = makeSnapshotRef();
    const { executeFn, fills } = makeBacktestExecutor({ snapshotRef: ref });
    ref.current = snap({ prices: { WETH: 3000 } });
    const fill = await executeFn(buy("WETH", 100));
    expect(fill.filledPrice).toBe(3000);
    expect(fill.filledUsd).toBe(100);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.midPrice).toBe(3000);
    expect(fills[0]!.filledAt).toBe("2026-04-27T12:00:00Z");
  });

  it("fills a SELL at the snapshot's price for the fromToken", async () => {
    const ref = makeSnapshotRef();
    const { executeFn, fills } = makeBacktestExecutor({ snapshotRef: ref });
    ref.current = snap({ prices: { WETH: 3000 } });
    await executeFn(sell("WETH", 100));
    expect(fills).toHaveLength(1);
    expect(fills[0]!.filledPrice).toBe(3000);
  });

  it("falls back to the priceFeed when the snapshot lacks the symbol", async () => {
    const ref = makeSnapshotRef();
    const feed = new FixturePriceFeed();
    feed.set("AERO", [["2026-04-27T11:00:00Z", 1.5]]);
    const { executeFn } = makeBacktestExecutor({
      snapshotRef: ref,
      priceFeed: feed,
    });
    ref.current = snap({ ts: "2026-04-27T12:00:00Z", prices: {} });
    const fill = await executeFn(buy("AERO", 50));
    expect(fill.filledPrice).toBe(1.5);
  });

  it("USDC is always $1 even with no snapshot or feed entry", async () => {
    const ref = makeSnapshotRef();
    const { executeFn } = makeBacktestExecutor({ snapshotRef: ref });
    ref.current = snap({ prices: {} });
    const fill = await executeFn(sell("USDC", 25));
    expect(fill.filledPrice).toBe(1.0);
  });

  it("throws when no price source has the symbol", async () => {
    const ref = makeSnapshotRef();
    const { executeFn } = makeBacktestExecutor({ snapshotRef: ref });
    ref.current = snap({ prices: {} });
    await expect(executeFn(buy("WETH", 100))).rejects.toThrow(/no price for WETH/);
  });

  it("applies positive slippage on BUY (pays more) and negative on SELL (gets less)", async () => {
    const ref = makeSnapshotRef();
    const { executeFn, fills } = makeBacktestExecutor({
      snapshotRef: ref,
      slippage: { bps: 50 }, // 0.5%
    });
    ref.current = snap({ prices: { WETH: 1000 } });
    await executeFn(buy("WETH", 100));
    await executeFn(sell("WETH", 100));
    expect(fills).toHaveLength(2);
    expect(fills[0]!.filledPrice).toBeCloseTo(1005, 4); // BUY pays mid + 0.5%
    expect(fills[1]!.filledPrice).toBeCloseTo(995, 4); // SELL receives mid − 0.5%
  });

  it("snapshot prices take precedence over the feed (zero network calls when present)", async () => {
    let feedCalls = 0;
    const feed = new FixturePriceFeed();
    feed.set("WETH", [["2026-04-27T11:00:00Z", 9999]]);
    const wrappedFeed = {
      getPriceAt: async (sym: string, ts: string) => {
        feedCalls++;
        return await feed.getPriceAt(sym, ts);
      },
    };
    const ref = makeSnapshotRef();
    const { executeFn } = makeBacktestExecutor({
      snapshotRef: ref,
      priceFeed: wrappedFeed,
    });
    ref.current = snap({ prices: { WETH: 3000 } });
    const fill = await executeFn(buy("WETH", 100));
    expect(fill.filledPrice).toBe(3000); // not 9999
    expect(feedCalls).toBe(0);
  });

  it("uses the same fills array across calls when one is supplied", async () => {
    const collected = [] as Parameters<typeof makeBacktestExecutor>[0]["fills"] extends infer F
      ? F
      : never;
    const fills: import("../backtest-executor.js").ExecutorFill[] = [];
    const ref = makeSnapshotRef();
    const { executeFn } = makeBacktestExecutor({ snapshotRef: ref, fills });
    ref.current = snap({ prices: { WETH: 3000 } });
    await executeFn(buy("WETH", 50));
    await executeFn(sell("WETH", 50));
    expect(fills).toHaveLength(2);
    expect(collected).toBe(collected); // typing smoke
  });
});
