import { describe, it, expect } from "vitest";
import {
  FixturePriceFeed,
  GeckoTerminalHistoricalFeed,
} from "../data/price-feed.js";

// ----------------------------------------------------------------------------
// FixturePriceFeed — deterministic, no I/O
// ----------------------------------------------------------------------------

describe("FixturePriceFeed", () => {
  it("returns null for unknown symbols", async () => {
    const feed = new FixturePriceFeed();
    expect(await feed.getPriceAt("WETH", "2026-04-27T12:00:00Z")).toBeNull();
  });

  it("returns null when querying before the earliest data point", async () => {
    const feed = new FixturePriceFeed();
    feed.set("WETH", [["2026-04-27T12:00:00Z", 3000]]);
    expect(await feed.getPriceAt("WETH", "2026-04-27T11:00:00Z")).toBeNull();
  });

  it("returns the price of the latest point at or before the query time", async () => {
    const feed = new FixturePriceFeed();
    feed.set("WETH", [
      ["2026-04-27T12:00:00Z", 3000],
      ["2026-04-27T12:15:00Z", 3010],
      ["2026-04-27T12:30:00Z", 3020],
    ]);
    // At each anchor
    expect(await feed.getPriceAt("WETH", "2026-04-27T12:00:00Z")).toBe(3000);
    expect(await feed.getPriceAt("WETH", "2026-04-27T12:15:00Z")).toBe(3010);
    expect(await feed.getPriceAt("WETH", "2026-04-27T12:30:00Z")).toBe(3020);
    // Between anchors uses the floor
    expect(await feed.getPriceAt("WETH", "2026-04-27T12:07:30Z")).toBe(3000);
    expect(await feed.getPriceAt("WETH", "2026-04-27T12:25:00Z")).toBe(3010);
    // After the last anchor, it carries forward
    expect(await feed.getPriceAt("WETH", "2026-04-27T13:00:00Z")).toBe(3020);
  });

  it("seeds from a constructor map", async () => {
    const seed = new Map<string, ReadonlyArray<readonly [string, number]>>([
      ["WETH", [["2026-04-27T12:00:00Z", 3000]]],
      ["USDC", [["2026-04-27T12:00:00Z", 1.0]]],
    ]);
    const feed = new FixturePriceFeed(seed);
    expect(await feed.getPriceAt("WETH", "2026-04-27T12:30:00Z")).toBe(3000);
    expect(await feed.getPriceAt("USDC", "2026-04-27T12:30:00Z")).toBe(1.0);
  });

  it("ignores malformed seed entries", async () => {
    const feed = new FixturePriceFeed();
    feed.set("X", [
      ["nope", NaN],
      ["2026-04-27T12:00:00Z", 5],
      ["also-nope", Infinity],
    ]);
    expect(await feed.getPriceAt("X", "2026-04-27T12:00:00Z")).toBe(5);
  });

  it("set() replaces (not merges) the series", async () => {
    const feed = new FixturePriceFeed();
    feed.set("WETH", [["2026-04-27T12:00:00Z", 3000]]);
    feed.set("WETH", [["2026-04-27T13:00:00Z", 3500]]);
    expect(await feed.getPriceAt("WETH", "2026-04-27T12:30:00Z")).toBeNull();
    expect(await feed.getPriceAt("WETH", "2026-04-27T13:30:00Z")).toBe(3500);
  });
});

// ----------------------------------------------------------------------------
// GeckoTerminalHistoricalFeed — using injected httpGet for determinism
// ----------------------------------------------------------------------------

describe("GeckoTerminalHistoricalFeed", () => {
  /**
   * Fake GT server: route /tokens/.../pools to a single-pool response,
   * and /pools/.../ohlcv/minute to a small descending OHLCV list. The
   * feed must reverse to ASC and binary-search correctly.
   */
  function makeFakeHttp(opts?: {
    poolsForAddress?: Record<string, string>; // tokenAddrLower → poolId (e.g. "base_0xpool")
    ohlcvByPool?: Record<string, number[][]>; // poolAddrLower → DESC rows [ts, o, h, l, c, v]
    onCall?: (url: string) => void;
  }) {
    const pools = opts?.poolsForAddress ?? {};
    const ohlcv = opts?.ohlcvByPool ?? {};
    return async (url: string) => {
      opts?.onCall?.(url);
      const tokensMatch = url.match(/\/tokens\/([0-9a-fx]+)\/pools/i);
      if (tokensMatch) {
        const id = pools[tokensMatch[1]!.toLowerCase()];
        if (!id) return { data: [] };
        return {
          data: [
            { id, attributes: { dex_id: "aerodrome" } },
          ],
        };
      }
      const poolMatch = url.match(/\/pools\/([0-9a-fx]+)\/ohlcv/i);
      if (poolMatch) {
        const list = ohlcv[poolMatch[1]!.toLowerCase()] ?? [];
        return { data: { attributes: { ohlcv_list: list } } };
      }
      return {};
    };
  }

  it("preloads + serves prices for a known Base symbol", async () => {
    // WETH on Base — address from TOKEN_REGISTRY (case preserved by registry,
    // but we lowercase before lookup in the fake)
    const wethAddr = "0x4200000000000000000000000000000000000006";
    const poolAddr = "0xaaa1111aaaa2222aaaa3333aaaa4444aaaa5555a";
    const t1 = Math.floor(Date.parse("2026-04-27T12:00:00Z") / 1000);
    const t2 = t1 + 900; // +15 min
    const t3 = t1 + 1800; // +30 min
    // GT returns DESC; the feed must sort ASC
    const httpGet = makeFakeHttp({
      poolsForAddress: { [wethAddr]: `base_${poolAddr}` },
      ohlcvByPool: {
        [poolAddr]: [
          [t3, 3020, 3025, 3015, 3022, 1_000_000],
          [t2, 3010, 3015, 3005, 3012, 1_000_000],
          [t1, 3000, 3005, 2995, 3002, 1_000_000],
        ],
      },
    });

    const feed = new GeckoTerminalHistoricalFeed({ httpGet });
    const summary = await feed.preload(
      ["WETH"],
      "2026-04-27T12:00:00Z",
      "2026-04-27T12:30:00Z",
    );
    expect(summary.loaded).toBe(1);
    expect(summary.failed).toEqual([]);

    // Exact candle hits use that candle's close
    expect(await feed.getPriceAt("WETH", "2026-04-27T12:00:00Z")).toBe(3002);
    expect(await feed.getPriceAt("WETH", "2026-04-27T12:15:00Z")).toBe(3012);
    expect(await feed.getPriceAt("WETH", "2026-04-27T12:30:00Z")).toBe(3022);
    // Between candles uses the floor candle
    expect(await feed.getPriceAt("WETH", "2026-04-27T12:07:00Z")).toBe(3002);
    expect(await feed.getPriceAt("WETH", "2026-04-27T12:22:30Z")).toBe(3012);
    // Earlier than oldest: best-effort returns the oldest close (not null)
    expect(await feed.getPriceAt("WETH", "2026-04-27T11:00:00Z")).toBe(3002);
  });

  it("marks a symbol failed when the network has no pools", async () => {
    const httpGet = makeFakeHttp({ poolsForAddress: {}, ohlcvByPool: {} });
    const feed = new GeckoTerminalHistoricalFeed({ httpGet });
    const summary = await feed.preload(
      ["WETH"],
      "2026-04-27T12:00:00Z",
      "2026-04-27T13:00:00Z",
    );
    expect(summary.loaded).toBe(0);
    expect(summary.failed).toEqual(["WETH"]);
    expect(await feed.getPriceAt("WETH", "2026-04-27T12:30:00Z")).toBeNull();
  });

  it("returns null for unknown registry symbols", async () => {
    const httpGet = makeFakeHttp();
    const feed = new GeckoTerminalHistoricalFeed({ httpGet });
    const summary = await feed.preload(
      ["NOT_A_REAL_SYMBOL_12345"],
      "2026-04-27T12:00:00Z",
      "2026-04-27T13:00:00Z",
    );
    expect(summary.loaded).toBe(0);
    expect(summary.failed).toEqual(["NOT_A_REAL_SYMBOL_12345"]);
    expect(
      await feed.getPriceAt("NOT_A_REAL_SYMBOL_12345", "2026-04-27T12:30:00Z"),
    ).toBeNull();
  });

  it("rejects backwards windows", async () => {
    const httpGet = makeFakeHttp();
    const feed = new GeckoTerminalHistoricalFeed({ httpGet });
    await expect(
      feed.preload(["WETH"], "2026-04-27T13:00:00Z", "2026-04-27T12:00:00Z"),
    ).rejects.toThrow(/bad window/);
  });

  it("respects preferredDex when multiple pools are returned", async () => {
    const wethAddr = "0x4200000000000000000000000000000000000006";
    const aerodromePool = "0xaeroaeroaeroaeroaeroaeroaeroaeroaeroaero";
    const uniPool = "0xuniuniuniuniuniuniuniuniuniuniuniuniuniun";
    const t1 = Math.floor(Date.parse("2026-04-27T12:00:00Z") / 1000);
    const httpGet = async (url: string) => {
      if (url.includes(`/tokens/${wethAddr}/pools`)) {
        return {
          data: [
            { id: `base_${uniPool}`, attributes: { dex_id: "uniswap-v3" } },
            { id: `base_${aerodromePool}`, attributes: { dex_id: "aerodrome" } },
          ],
        };
      }
      if (url.includes(`/pools/${aerodromePool}/ohlcv`)) {
        return {
          data: { attributes: { ohlcv_list: [[t1, 1, 1, 1, 99, 1]] } },
        };
      }
      if (url.includes(`/pools/${uniPool}/ohlcv`)) {
        return {
          data: { attributes: { ohlcv_list: [[t1, 1, 1, 1, 11, 1]] } },
        };
      }
      return {};
    };
    const feed = new GeckoTerminalHistoricalFeed({
      httpGet,
      preferredDex: "aerodrome",
    });
    await feed.preload(["WETH"], "2026-04-27T12:00:00Z", "2026-04-27T12:01:00Z");
    expect(await feed.getPriceAt("WETH", "2026-04-27T12:00:00Z")).toBe(99);
  });

  it("cacheStats reports loaded symbols + total candles", async () => {
    const wethAddr = "0x4200000000000000000000000000000000000006";
    const poolAddr = "0xaaa1111aaaa2222aaaa3333aaaa4444aaaa5555a";
    const t1 = Math.floor(Date.parse("2026-04-27T12:00:00Z") / 1000);
    const httpGet = makeFakeHttp({
      poolsForAddress: { [wethAddr]: `base_${poolAddr}` },
      ohlcvByPool: {
        [poolAddr]: [
          [t1 + 1800, 1, 1, 1, 3020, 1],
          [t1 + 900, 1, 1, 1, 3010, 1],
          [t1, 1, 1, 1, 3000, 1],
        ],
      },
    });
    const feed = new GeckoTerminalHistoricalFeed({ httpGet });
    await feed.preload(["WETH"], "2026-04-27T12:00:00Z", "2026-04-27T12:30:00Z");
    const stats = feed.cacheStats();
    expect(stats.symbols).toBe(1);
    expect(stats.candles).toBeGreaterThanOrEqual(3);
    expect(stats.failed).toBe(0);
  });
});
