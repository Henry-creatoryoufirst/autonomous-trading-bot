import { describe, it, expect, beforeEach } from "vitest";
import {
  CrossAssetFetchers,
  buildCrossAssetState,
} from "../cross-asset-fetchers.js";
import { CacheManager } from "../../services/cache-manager.js";
import type { TokenState } from "../cross-asset-state.js";
import type { MacroRegimeResult } from "../../../algorithm/macro-regime.js";

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

function makeRegime(score = 0): MacroRegimeResult {
  return {
    regime: score > 25 ? "BULL" : score < -50 ? "BEAR" : "RANGING",
    score,
    confidence: Math.abs(score) / 100,
    signals: { trend: 0, dominance: 0, sentiment: 0 },
  };
}

function makeToken(
  symbol: string,
  realizedVol24h: number,
  candles: number[] = [1.0, 1.0, 1.0],
): TokenState {
  return {
    symbol,
    candles,
    recentDirectionalEdge: { fadeHit: 0.4, continueHit: 0.4 },
    realizedVol24h,
  };
}

// Mock httpGet that returns a sequence of values (lets us simulate cache miss
// → fetch → hit).
function makeMockHttpGet(handler: (url: string) => unknown) {
  let calls = 0;
  const fn = async (url: string, _opts?: { timeout?: number }) => {
    calls++;
    return { data: handler(url) };
  };
  Object.defineProperty(fn, "callCount", { get: () => calls });
  return fn as ((url: string, opts?: { timeout?: number }) => Promise<{ data: unknown }>) & {
    readonly callCount: number;
  };
}

// Mock fetch that returns a JSON body and a status.
function makeMockFetch(handler: (url: string) => { status: number; body: unknown }) {
  let calls = 0;
  const fn = async (url: string, _init?: RequestInit) => {
    calls++;
    const result = handler(url);
    return new Response(JSON.stringify(result.body), { status: result.status });
  };
  Object.defineProperty(fn, "callCount", { get: () => calls });
  return fn as ((url: string, init?: RequestInit) => Promise<Response>) & {
    readonly callCount: number;
  };
}

// ----------------------------------------------------------------------------
// CrossAssetFetchers — unit tests
// ----------------------------------------------------------------------------

describe("CrossAssetFetchers.fetchBtcDominance", () => {
  let cache: CacheManager;
  beforeEach(() => {
    cache = new CacheManager();
  });

  it("returns the current dominance and trend=0 when there's no history", async () => {
    const httpGet = makeMockHttpGet(() => ({
      data: { market_cap_percentage: { btc: 56.42 } },
    }));
    const fetchers = new CrossAssetFetchers({ cache, httpGet });
    const result = await fetchers.fetchBtcDominance();
    expect(result).not.toBeNull();
    expect(result!.current).toBe(56.42);
    expect(result!.trend24h).toBe(0); // no history → neutral
  });

  it("computes a positive trend24h when dominance has risen over 24h", async () => {
    let now = 1_000_000_000_000;
    let dominance = 50.0;
    const httpGet = makeMockHttpGet(() => ({
      data: { market_cap_percentage: { btc: dominance } },
    }));
    const fetchers = new CrossAssetFetchers({
      cache,
      httpGet,
      now: () => now,
    });

    // Seed at t=0 with dominance=50
    await fetchers.fetchBtcDominance();

    // 25h later, dominance has risen to 53. The 24h-ago closest entry is
    // the 50% one, so trend24h should be +3.
    now += 25 * 60 * 60 * 1000;
    dominance = 53.0;
    cache.invalidate("btc-dominance"); // bypass the 5-min TTL for this test
    const result = await fetchers.fetchBtcDominance();
    expect(result).not.toBeNull();
    expect(result!.current).toBe(53.0);
    expect(result!.trend24h).toBeCloseTo(3.0, 2);
  });

  it("returns null on upstream failure", async () => {
    const httpGet = async () => {
      throw new Error("ECONNREFUSED");
    };
    const fetchers = new CrossAssetFetchers({
      cache,
      httpGet,
      log: () => {}, // suppress
    });
    const result = await fetchers.fetchBtcDominance();
    expect(result).toBeNull();
  });

  it("respects cache TTL — second call within window doesn't re-fetch", async () => {
    const httpGet = makeMockHttpGet(() => ({
      data: { market_cap_percentage: { btc: 56.42 } },
    }));
    const fetchers = new CrossAssetFetchers({ cache, httpGet });
    await fetchers.fetchBtcDominance();
    await fetchers.fetchBtcDominance();
    expect(httpGet.callCount).toBe(1);
  });

  it("treats a malformed response as failure (returns null)", async () => {
    const httpGet = makeMockHttpGet(() => ({})); // no data.market_cap_percentage
    const fetchers = new CrossAssetFetchers({ cache, httpGet, log: () => {} });
    const result = await fetchers.fetchBtcDominance();
    expect(result).toBeNull();
  });
});

describe("CrossAssetFetchers.fetchFearGreed", () => {
  let cache: CacheManager;
  beforeEach(() => {
    cache = new CacheManager();
  });

  it("parses a numeric value", async () => {
    const httpGet = makeMockHttpGet(() => ({
      data: [{ value: 65 }],
    }));
    const fetchers = new CrossAssetFetchers({ cache, httpGet });
    expect(await fetchers.fetchFearGreed()).toBe(65);
  });

  it("parses a string value (alternative.me actually returns strings)", async () => {
    const httpGet = makeMockHttpGet(() => ({
      data: [{ value: "42" }],
    }));
    const fetchers = new CrossAssetFetchers({ cache, httpGet });
    expect(await fetchers.fetchFearGreed()).toBe(42);
  });

  it("rejects out-of-range values", async () => {
    const httpGet = makeMockHttpGet(() => ({
      data: [{ value: 150 }], // not a real F&G value
    }));
    const fetchers = new CrossAssetFetchers({ cache, httpGet, log: () => {} });
    expect(await fetchers.fetchFearGreed()).toBeNull();
  });

  it("returns null on upstream failure", async () => {
    const httpGet = async () => {
      throw new Error("timeout");
    };
    const fetchers = new CrossAssetFetchers({ cache, httpGet, log: () => {} });
    expect(await fetchers.fetchFearGreed()).toBeNull();
  });
});

describe("CrossAssetFetchers.fetchSmartWalletFlow24h", () => {
  let cache: CacheManager;
  beforeEach(() => {
    cache = new CacheManager();
  });

  it("returns null when no signal-service URL is configured", async () => {
    const fetchers = new CrossAssetFetchers({ cache });
    expect(await fetchers.fetchSmartWalletFlow24h(undefined)).toBeNull();
  });

  it("derives a positive flow when smart wallets have positive edge", async () => {
    const fetchImpl = makeMockFetch(() => ({
      status: 200,
      body: {
        walletHitRates: [
          { walletId: "0xabc", hitRate4h: 0.75, totalSignals: 30 },
        ],
        signalAccuracy: [
          { metric: "smartWalletStrong", edge: 0.05, totalSamples: 20 },
        ],
        totalTracked: 100,
      },
    }));
    const fetchers = new CrossAssetFetchers({ cache, fetchImpl });
    const flow = await fetchers.fetchSmartWalletFlow24h("https://signal.example");
    expect(flow).not.toBeNull();
    expect(flow!).toBeGreaterThan(0);
    // 0.05 edge × 30 signals × 1000 = 1500
    expect(flow!).toBeCloseTo(1500, 0);
  });

  it("derives a negative flow when smart wallets have negative edge", async () => {
    const fetchImpl = makeMockFetch(() => ({
      status: 200,
      body: {
        walletHitRates: [
          { walletId: "0xdef", hitRate4h: 0.30, totalSignals: 25 },
        ],
        signalAccuracy: [
          { metric: "smartWalletStrong", edge: -0.04, totalSamples: 15 },
        ],
      },
    }));
    const fetchers = new CrossAssetFetchers({ cache, fetchImpl });
    const flow = await fetchers.fetchSmartWalletFlow24h("https://signal.example");
    expect(flow).not.toBeNull();
    expect(flow!).toBeLessThan(0);
  });

  it("returns 0 flow when the metric has too few samples (low confidence)", async () => {
    const fetchImpl = makeMockFetch(() => ({
      status: 200,
      body: {
        walletHitRates: [{ walletId: "0xabc", hitRate4h: 0.6, totalSignals: 12 }],
        signalAccuracy: [
          { metric: "smartWalletStrong", edge: 0.10, totalSamples: 3 }, // <5 samples
        ],
      },
    }));
    const fetchers = new CrossAssetFetchers({ cache, fetchImpl });
    const flow = await fetchers.fetchSmartWalletFlow24h("https://signal.example");
    expect(flow).toBe(0);
  });

  it("returns null on non-200 response", async () => {
    const fetchImpl = makeMockFetch(() => ({ status: 503, body: { error: "down" } }));
    const fetchers = new CrossAssetFetchers({ cache, fetchImpl, log: () => {} });
    const flow = await fetchers.fetchSmartWalletFlow24h("https://signal.example");
    expect(flow).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// buildCrossAssetState — orchestrator
// ----------------------------------------------------------------------------

describe("buildCrossAssetState", () => {
  let cache: CacheManager;
  beforeEach(() => {
    cache = new CacheManager();
  });

  it("assembles a complete CrossAssetState from successful fetcher results", async () => {
    const httpGet = makeMockHttpGet((url) => {
      if (url.includes("coingecko")) {
        return { data: { market_cap_percentage: { btc: 56.42 } } };
      }
      if (url.includes("alternative.me")) {
        return { data: [{ value: 70 }] };
      }
      return {};
    });
    const fetchImpl = makeMockFetch(() => ({
      status: 200,
      body: {
        walletHitRates: [{ walletId: "0xabc", hitRate4h: 0.75, totalSignals: 30 }],
        signalAccuracy: [
          { metric: "smartWalletStrong", edge: 0.05, totalSamples: 20 },
        ],
      },
    }));
    const fetchers = new CrossAssetFetchers({ cache, httpGet, fetchImpl });

    const state = await buildCrossAssetState({
      fetchers,
      tokens: {
        AERO: makeToken("AERO", 60),
        BRETT: makeToken("BRETT", 80),
        DEGEN: makeToken("DEGEN", 30),
      },
      macroRegime: makeRegime(40),
      recentEdge: { count: 8, hitRate: 0.36, meanReturn: 0.4, stdReturn: 2.1 },
      signalServiceUrl: "https://signal.example",
      computedAt: "2026-05-04T19:00:00Z",
    });

    expect(state.computedAt).toBe("2026-05-04T19:00:00Z");
    expect(state.macroRegime.regime).toBe("BULL");
    expect(state.fearGreed).toBe(70);
    expect(state.tokens.AERO!.realizedVol24h).toBe(60);
    expect(state.tokens.BRETT!.realizedVol24h).toBe(80);
    expect(state.tokens.DEGEN!.realizedVol24h).toBe(30);
    expect(state.coStressScore).toBeGreaterThan(0);
    expect(state.smartWalletFlow24h).toBeCloseTo(1500, 0);
    expect(state.recentEdge.hitRate).toBe(0.36);
    // BTC dominance trend is 0 (no 24h history yet)
    expect(state.btcDominanceTrend24h).toBe(0);
  });

  it("falls back to neutral defaults when individual feeds fail", async () => {
    const httpGet = async () => {
      throw new Error("network down");
    };
    const fetchImpl = async () => {
      throw new Error("network down");
    };
    const fetchers = new CrossAssetFetchers({
      cache,
      httpGet,
      fetchImpl,
      log: () => {},
    });

    const state = await buildCrossAssetState({
      fetchers,
      tokens: { AERO: makeToken("AERO", 50) },
      macroRegime: makeRegime(0),
      recentEdge: { count: 0, hitRate: 0, meanReturn: 0, stdReturn: 0 },
      signalServiceUrl: "https://signal.example",
    });

    expect(state.fearGreed).toBe(50); // neutral fallback
    expect(state.btcDominanceTrend24h).toBe(0); // neutral fallback
    expect(state.smartWalletFlow24h).toBe(0); // neutral fallback
    // The struct is still well-formed — patterns can read it without
    // crashing, they'll just see neutral signals.
    expect(state.tokens.AERO).toBeDefined();
  });

  it("applies non-default fallbacks correctly when only some feeds fail", async () => {
    // F&G works, but CoinGecko fails
    const httpGet = makeMockHttpGet((url) => {
      if (url.includes("coingecko")) {
        throw new Error("coingecko down");
      }
      if (url.includes("alternative.me")) {
        return { data: [{ value: 30 }] };
      }
      return {};
    });
    const fetchers = new CrossAssetFetchers({ cache, httpGet, log: () => {} });

    const state = await buildCrossAssetState({
      fetchers,
      tokens: {},
      macroRegime: makeRegime(0),
      recentEdge: { count: 0, hitRate: 0, meanReturn: 0, stdReturn: 0 },
    });

    expect(state.fearGreed).toBe(30); // real value
    expect(state.btcDominanceTrend24h).toBe(0); // fallback
    expect(state.smartWalletFlow24h).toBe(0); // no signal-service URL → null → 0
  });

  it("computes coStressScore from per-token realized vols", async () => {
    const httpGet = makeMockHttpGet((url) => {
      if (url.includes("coingecko")) return { data: { market_cap_percentage: { btc: 50 } } };
      if (url.includes("alternative.me")) return { data: [{ value: 50 }] };
      return {};
    });
    const fetchers = new CrossAssetFetchers({ cache, httpGet });

    // Both AERO and BRETT spike at 90+, DEGEN calm at 30 → high co-stress
    const stressedState = await buildCrossAssetState({
      fetchers,
      tokens: {
        AERO: makeToken("AERO", 92),
        BRETT: makeToken("BRETT", 90),
        DEGEN: makeToken("DEGEN", 30),
      },
      macroRegime: makeRegime(0),
      recentEdge: { count: 0, hitRate: 0, meanReturn: 0, stdReturn: 0 },
    });
    expect(stressedState.coStressScore).toBeGreaterThan(50);

    // Only AERO spikes → idiosyncratic, low co-stress
    const idiosyncraticState = await buildCrossAssetState({
      fetchers,
      tokens: {
        AERO: makeToken("AERO", 92),
        BRETT: makeToken("BRETT", 30),
        DEGEN: makeToken("DEGEN", 30),
      },
      macroRegime: makeRegime(0),
      recentEdge: { count: 0, hitRate: 0, meanReturn: 0, stdReturn: 0 },
    });
    expect(idiosyncraticState.coStressScore).toBeLessThan(20);
  });
});
