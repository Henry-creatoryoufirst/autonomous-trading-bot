/**
 * NVR-SPEC-022 — Historical Price Feed
 *
 * The piece that turns event-fidelity backtests into P&L-fidelity backtests.
 *
 * The v22 backtest harness drives PatternRuntime through historical events.
 * Without a real price source, the executor fills at synthetic constant
 * prices and "realized P&L" is meaningless. Patterns fire, positions open,
 * positions close — but every entry and exit is at the same fake price.
 *
 * This module fixes that:
 *   1. `HistoricalPriceFeed` — the contract: given (symbol, timestamp),
 *      return the historical USD price at (or just before) that moment.
 *   2. `FixturePriceFeed` — in-memory, deterministic, for tests.
 *   3. `GeckoTerminalHistoricalFeed` — pulls real OHLCV history from the
 *      free GeckoTerminal API for any token that has a Base pool there.
 *
 * Performance model:
 *   - The feed expects to be `preload()`-ed for the replay window. Preload
 *     does the network calls and warms an in-memory cache.
 *   - During the replay loop, `getPriceAt()` reads from cache only — it
 *     does not block on network. Patterns get sub-millisecond price reads.
 *   - If a price is missing from cache, getPriceAt returns null and the
 *     caller decides the fallback (carry-forward, abort, etc.). The
 *     EventReplayer prefers carry-forward by default.
 *
 * Backwards-compat:
 *   - The interface has no methods on the runtime side. Patterns and the
 *     PatternRuntime never call this directly — only the EventReplayer
 *     and the backtest executor do. Production code that calls runtime.tick
 *     with a fully-formed snapshot is unaffected.
 */

import axios from "axios";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { TOKEN_REGISTRY } from "../../core/config/token-registry.js";

// ----------------------------------------------------------------------------
// Interface
// ----------------------------------------------------------------------------

export interface HistoricalPriceFeed {
  /**
   * Return the USD price of `symbol` at `timestampISO`, or null if the
   * feed has no data for that symbol/time. Implementations should return
   * the price of the candle that contains the timestamp, or the most
   * recent candle ending before it (whichever the feed's resolution
   * supports).
   *
   * Must be O(log n) or faster after preload — never blocks on network.
   */
  getPriceAt(symbol: string, timestampISO: string): Promise<number | null>;

  /**
   * Optional: warm the feed's cache for a (symbols, time-window) tuple.
   * Implementations that hit network APIs should do all their fetching
   * here; getPriceAt should be cache-only after preload returns.
   *
   * Returns a summary so the caller can log "loaded N symbols, failed M".
   * A symbol failing preload is not fatal — getPriceAt will simply return
   * null for it later.
   */
  preload?(
    symbols: readonly string[],
    fromISO: string,
    toISO: string,
  ): Promise<{ loaded: number; failed: readonly string[] }>;
}

// ----------------------------------------------------------------------------
// FixturePriceFeed — for tests + offline backtests
// ----------------------------------------------------------------------------

/**
 * Simple price feed backed by a `Map<symbol, [timestampISO, price][]>`.
 * Returns the price of the most-recent point at or before the query time.
 *
 * Useful for tests (deterministic) and for replaying CSV/JSON dumps that
 * a researcher captured by hand or from a one-shot fetch.
 */
export class FixturePriceFeed implements HistoricalPriceFeed {
  /** Per-symbol points, sorted ascending by timestamp ms. */
  private readonly points = new Map<string, { tsMs: number; price: number }[]>();

  constructor(seed?: ReadonlyMap<string, ReadonlyArray<readonly [string, number]>>) {
    if (seed) for (const [sym, pts] of seed) this.set(sym, pts);
  }

  /** Replace (or set) the series for one symbol. */
  set(symbol: string, points: ReadonlyArray<readonly [string, number]>): void {
    const sorted = [...points]
      .map(([ts, px]) => ({ tsMs: Date.parse(ts), price: px }))
      .filter((p) => Number.isFinite(p.tsMs) && Number.isFinite(p.price))
      .sort((a, b) => a.tsMs - b.tsMs);
    this.points.set(symbol, sorted);
  }

  async getPriceAt(symbol: string, timestampISO: string): Promise<number | null> {
    const series = this.points.get(symbol);
    if (!series || series.length === 0) return null;
    const t = Date.parse(timestampISO);
    if (!Number.isFinite(t)) return null;
    // Binary search for the largest tsMs <= t
    let lo = 0;
    let hi = series.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid]!.tsMs <= t) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best < 0) return null;
    return series[best]!.price;
  }
}

// ----------------------------------------------------------------------------
// GeckoTerminal historical OHLCV
// ----------------------------------------------------------------------------

/**
 * GeckoTerminal free OHLCV API base. Free tier supports ~30 calls/min.
 * Docs: https://www.geckoterminal.com/dex-api
 */
const GT_API_BASE = "https://api.geckoterminal.com/api/v2";

/** Minimum spacing between API calls (ms). 2.1s ≈ 28 calls/min. */
const GT_RATE_LIMIT_MS = 2100;

/**
 * Stablecoin quote-token addresses on Base, lowercased. When a pool quotes
 * a token in one of these, OHLCV `close` is in true USD. Pools quoted in
 * volatile tokens (WETH, cbBTC) return prices in *quote-token units*, which
 * is fine for relative-move pattern detection but is NOT raw USD — callers
 * doing P&L math should multiply by the quote token's USD price.
 *
 * Pre-fix bug: resolvePoolByAddress took the top-by-reserve pool blindly,
 * which for WETH-on-Base picked TTPA/WETH (WETH as QUOTE) — meaning OHLCV
 * gave us TTPA's USD price labeled as "WETH". See FINDING_2026-05-04 for
 * the full incident write-up.
 */
const STABLE_QUOTE_ADDRS = new Set<string>([
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC (Base)
  "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", // USDT (Base)
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", // DAI  (Base)
]);

/** GeckoTerminal pool relationships shape — typed minimally for what we read. */
type GtPool = {
  id?: string;
  attributes?: { dex_id?: string };
  relationships?: {
    base_token?: { data?: { id?: string } };
    quote_token?: { data?: { id?: string } };
  };
};

/** Extract a lowercase token address from a GT id like "base_0xabc...". */
function gtIdToAddr(id: string | undefined): string {
  if (!id) return "";
  const sep = id.indexOf("_");
  return (sep > 0 ? id.slice(sep + 1) : id).toLowerCase();
}

/**
 * GeckoTerminal OHLCV timeframes. We default to "minute"/aggregate=15
 * which strikes a reasonable balance: 15-minute candles back ~6 months
 * (1000 candles * 15min ≈ 250 hours per page, with up to 1000 candles per
 * call). For longer windows, the implementation auto-paginates via
 * `before_timestamp`.
 */
type GTTimeframe = "minute" | "hour" | "day";

interface GeckoFeedOptions {
  /** Network ID per GeckoTerminal. Default 'base'. */
  network?: string;
  /** OHLCV timeframe. Default 'minute'. */
  timeframe?: GTTimeframe;
  /** Aggregate count within timeframe. Default 15 (= 15min candles). */
  aggregate?: number;
  /** HTTP timeout per call (ms). */
  httpTimeoutMs?: number;
  /** If a token has multiple pools, which dex name to prefer (lowercased
   *  match). Default no preference (top by reserve). */
  preferredDex?: string;
  /** Logger. Default no-op. */
  log?: (msg: string) => void;
  /** Inject a custom HTTP getter (for tests). */
  httpGet?: (url: string) => Promise<unknown>;
  /**
   * On-disk cache directory for OHLCV + pool resolutions. When set, preload()
   * reads from disk first and only fetches the gap (if any) between cache
   * and requested window. Pool resolutions are also persisted, surviving
   * GeckoTerminal rate-limit hiccups across script runs.
   *
   * Default: undefined (no disk cache — original behavior). Pass a path
   * to enable; standard usage is `data/observation-pass/.price-cache`.
   */
  cacheDir?: string;
  /**
   * Max age (seconds) for a cached entry before we treat it as stale and
   * re-fetch. Default 24h. Set to Infinity to use cache permanently for
   * historical analysis where the past doesn't change.
   */
  cacheMaxAgeSec?: number;
}

interface OhlcvCandle {
  /** Unix seconds. */
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
}

/**
 * Real historical price feed backed by GeckoTerminal's free OHLCV API.
 *
 * The feed resolves each requested symbol to (1) its Base token address
 * via TOKEN_REGISTRY and (2) its top liquidity pool on Base via the
 * `/networks/base/tokens/{address}/pools` endpoint. It then fetches
 * OHLCV candles for that pool and caches them in-memory.
 *
 * `getPriceAt` returns the close of the candle that contains the query
 * time, or the nearest preceding candle if the exact one isn't cached.
 */
export class GeckoTerminalHistoricalFeed implements HistoricalPriceFeed {
  private readonly network: string;
  private readonly timeframe: GTTimeframe;
  private readonly aggregate: number;
  private readonly httpTimeoutMs: number;
  private readonly preferredDex?: string;
  private readonly log: (msg: string) => void;
  private readonly httpGet: (url: string) => Promise<unknown>;
  private readonly cacheDir?: string;
  private readonly cacheMaxAgeSec: number;

  /** symbol → resolved pool address (lowercased) on the network. */
  private readonly poolBySymbol = new Map<string, string>();

  /** symbol → ascending OHLCV candles. */
  private readonly candlesBySymbol = new Map<string, OhlcvCandle[]>();

  /** Symbols that we know preload failed on, so getPriceAt returns null fast. */
  private readonly failedSymbols = new Set<string>();

  /** Throttle clock for the rate limiter. */
  private lastCallAt = 0;

  constructor(opts: GeckoFeedOptions = {}) {
    this.network = opts.network ?? "base";
    this.timeframe = opts.timeframe ?? "minute";
    this.aggregate = opts.aggregate ?? 15;
    this.httpTimeoutMs = opts.httpTimeoutMs ?? 12_000;
    this.preferredDex = opts.preferredDex?.toLowerCase();
    this.log = opts.log ?? (() => {});
    this.httpGet =
      opts.httpGet ??
      (async (url: string) => {
        const res = await axios.get(url, {
          headers: { Accept: "application/json" },
          timeout: this.httpTimeoutMs,
        });
        return res.data;
      });
    this.cacheDir = opts.cacheDir;
    this.cacheMaxAgeSec = opts.cacheMaxAgeSec ?? 24 * 3600;
    if (this.cacheDir) {
      mkdirSync(this.cacheDir, { recursive: true });
      // Eagerly hydrate pool resolutions from disk so we don't re-fetch
      // them across script runs (the pools/{address}/pools endpoint is the
      // most frequent rate-limit casualty).
      this.hydratePoolResolutions();
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // On-disk cache
  // ────────────────────────────────────────────────────────────────────────

  private cacheKeyForSymbol(symbol: string): string {
    return `${this.network}-${this.timeframe}-${this.aggregate}-${symbol.toUpperCase()}`;
  }

  private cachePathForCandles(symbol: string): string | null {
    if (!this.cacheDir) return null;
    return join(this.cacheDir, `candles-${this.cacheKeyForSymbol(symbol)}.json`);
  }

  private cachePathForPools(): string | null {
    if (!this.cacheDir) return null;
    return join(this.cacheDir, `pools-${this.network}.json`);
  }

  private hydratePoolResolutions(): void {
    const path = this.cachePathForPools();
    if (!path || !existsSync(path)) return;
    try {
      const data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, string>;
      for (const [sym, pool] of Object.entries(data)) {
        if (pool && typeof pool === "string") this.poolBySymbol.set(sym, pool);
      }
      this.log(`price-feed: hydrated ${this.poolBySymbol.size} pool resolutions from cache`);
    } catch (e) {
      this.log(`price-feed: pool cache read failed: ${(e as Error).message}`);
    }
  }

  private persistPoolResolutions(): void {
    const path = this.cachePathForPools();
    if (!path) return;
    try {
      const obj: Record<string, string> = {};
      for (const [sym, pool] of this.poolBySymbol) obj[sym] = pool;
      writeFileSync(path, JSON.stringify(obj, null, 2));
    } catch (e) {
      this.log(`price-feed: pool cache write failed: ${(e as Error).message}`);
    }
  }

  /**
   * Returns cached candles for a symbol if the on-disk file exists, is
   * fresh enough, and covers (or extends past) the requested window.
   * Returns null if cache is missing/stale/insufficient.
   */
  private readCandleCache(
    symbol: string,
    fromTs: number,
    toTs: number,
  ): OhlcvCandle[] | null {
    const path = this.cachePathForCandles(symbol);
    if (!path || !existsSync(path)) return null;
    try {
      const stored = JSON.parse(readFileSync(path, "utf-8")) as {
        cachedAt: number;
        candles: OhlcvCandle[];
      };
      if (!Array.isArray(stored.candles) || stored.candles.length === 0) return null;
      const ageSec = Date.now() / 1000 - stored.cachedAt;
      if (ageSec > this.cacheMaxAgeSec) {
        this.log(`price-feed: ${symbol} cache stale (${(ageSec / 3600).toFixed(1)}h > ${(this.cacheMaxAgeSec / 3600).toFixed(0)}h)`);
        return null;
      }
      const oldestCached = stored.candles[0]!.ts;
      const newestCached = stored.candles[stored.candles.length - 1]!.ts;
      // Only use cache if it covers the whole requested window. Partial
      // coverage forces a re-fetch — simpler than gap-filling logic.
      if (oldestCached > fromTs || newestCached < toTs - 3600) {
        this.log(
          `price-feed: ${symbol} cache window [${new Date(oldestCached * 1000).toISOString().slice(0, 16)} → ${new Date(newestCached * 1000).toISOString().slice(0, 16)}] doesn't cover request [${new Date(fromTs * 1000).toISOString().slice(0, 16)} → ${new Date(toTs * 1000).toISOString().slice(0, 16)}]`,
        );
        return null;
      }
      return stored.candles;
    } catch (e) {
      this.log(`price-feed: ${symbol} cache read failed: ${(e as Error).message}`);
      return null;
    }
  }

  private writeCandleCache(symbol: string, candles: OhlcvCandle[]): void {
    const path = this.cachePathForCandles(symbol);
    if (!path) return;
    try {
      writeFileSync(
        path,
        JSON.stringify({ cachedAt: Math.floor(Date.now() / 1000), candles }, null, 0),
      );
    } catch (e) {
      this.log(`price-feed: ${symbol} cache write failed: ${(e as Error).message}`);
    }
  }

  /** Throttle calls to respect GeckoTerminal's free-tier rate limit. */
  private async throttle(): Promise<void> {
    const since = Date.now() - this.lastCallAt;
    if (since < GT_RATE_LIMIT_MS) {
      await new Promise((r) => setTimeout(r, GT_RATE_LIMIT_MS - since));
    }
    this.lastCallAt = Date.now();
  }

  /**
   * Resolve `symbol` (e.g. 'WETH') to a pool address on `network`. Returns
   * null and marks the symbol failed if no pool can be found.
   */
  private async resolvePool(symbol: string): Promise<string | null> {
    const cached = this.poolBySymbol.get(symbol);
    if (cached) return cached;
    if (this.failedSymbols.has(symbol)) return null;

    const reg = TOKEN_REGISTRY[symbol];
    if (!reg || !reg.address || reg.address === "native") {
      // ETH "native" maps to WETH for pricing purposes
      if (symbol === "ETH") {
        const w = TOKEN_REGISTRY["WETH"];
        if (w?.address) return this.resolvePoolByAddress(symbol, w.address);
      }
      this.log(`price-feed: no token registry entry for ${symbol}`);
      this.failedSymbols.add(symbol);
      return null;
    }
    return this.resolvePoolByAddress(symbol, reg.address);
  }

  private async resolvePoolByAddress(
    symbol: string,
    address: string,
  ): Promise<string | null> {
    await this.throttle();
    const url = `${GT_API_BASE}/networks/${this.network}/tokens/${address.toLowerCase()}/pools?page=1`;
    let data: unknown;
    try {
      data = await this.httpGet(url);
    } catch (e: unknown) {
      this.log(`price-feed: pool lookup failed for ${symbol}: ${(e as Error).message}`);
      this.failedSymbols.add(symbol);
      return null;
    }

    const pools = (data as { data?: unknown[] })?.data;
    if (!Array.isArray(pools) || pools.length === 0) {
      this.log(`price-feed: no pools for ${symbol} on ${this.network}`);
      this.failedSymbols.add(symbol);
      return null;
    }

    // GeckoTerminal returns pools sorted by reserve_in_usd desc. We can NOT
    // simply take the top — the top pool may have our token as the QUOTE side
    // (e.g. for WETH on Base, the top pool by reserve was TTPA/WETH where
    // WETH is the quote). OHLCV from such a pool gives the BASE token's
    // USD price, NOT ours. The pre-fix code blindly picked pools[0] and
    // produced contaminated "WETH" data; see FINDING_2026-05-04.
    //
    // Correct behavior: filter to pools where the requested address is the
    // BASE (priced) token, then prefer stablecoin-quoted for true USD.
    const targetAddr = address.toLowerCase();
    const typedPools = pools as GtPool[];
    const baseMatched = typedPools.filter(
      (p) => gtIdToAddr(p.relationships?.base_token?.data?.id) === targetAddr,
    );

    if (baseMatched.length === 0) {
      this.log(
        `price-feed: ${symbol} (${targetAddr}) is not the BASE token of any of the top ${typedPools.length} pools on ${this.network} — only quote-side matches exist, which would yield wrong-direction OHLCV. Failing resolution.`,
      );
      this.failedSymbols.add(symbol);
      return null;
    }

    // Among base-matched pools, prefer one quoted in a stablecoin (true USD
    // price). The list returned by GT is already reserve-sorted, so the first
    // stablecoin match is the deepest-liquidity USD pool.
    const stableMatched = baseMatched.filter((p) =>
      STABLE_QUOTE_ADDRS.has(gtIdToAddr(p.relationships?.quote_token?.data?.id)),
    );

    // Selection precedence (most-preferred first):
    //   1. preferredDex inside stable-quoted base-matched
    //   2. first stable-quoted base-matched (true USD)
    //   3. preferredDex inside base-matched (any quote)
    //   4. first base-matched (top by reserve)
    const dexMatch = (set: GtPool[]) =>
      this.preferredDex
        ? set.find((p) => p.attributes?.dex_id?.toLowerCase() === this.preferredDex)
        : undefined;

    let pick: GtPool;
    if (stableMatched.length > 0) {
      pick = dexMatch(stableMatched) ?? stableMatched[0]!;
    } else {
      pick = dexMatch(baseMatched) ?? baseMatched[0]!;
      this.log(
        `price-feed: ${symbol} no stablecoin-quoted pool found; using top base-matched pool. OHLCV will be in quote-token units, not raw USD — callers doing P&L math should multiply by the quote token's USD price.`,
      );
    }

    const poolAddr = gtIdToAddr(pick.id);
    if (!poolAddr) {
      this.failedSymbols.add(symbol);
      return null;
    }
    this.poolBySymbol.set(symbol, poolAddr);
    this.persistPoolResolutions();
    return poolAddr;
  }

  /**
   * Fetch a single OHLCV page (up to 1000 candles, ending at `beforeTs`).
   * Returns the candles in ascending time order.
   */
  private async fetchOhlcvPage(
    poolAddress: string,
    beforeTsSec: number,
  ): Promise<OhlcvCandle[]> {
    await this.throttle();
    const url = `${GT_API_BASE}/networks/${this.network}/pools/${poolAddress}/ohlcv/${this.timeframe}?aggregate=${this.aggregate}&before_timestamp=${beforeTsSec}&limit=1000&currency=usd`;
    const data = (await this.httpGet(url)) as {
      data?: { attributes?: { ohlcv_list?: number[][] } };
    };
    const list = data?.data?.attributes?.ohlcv_list;
    if (!Array.isArray(list)) return [];
    // GeckoTerminal returns DESC; reverse to ASC and reshape.
    const candles: OhlcvCandle[] = [];
    for (const row of list) {
      if (!Array.isArray(row) || row.length < 6) continue;
      candles.push({
        ts: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volumeUsd: Number(row[5]),
      });
    }
    candles.sort((a, b) => a.ts - b.ts);
    return candles;
  }

  /**
   * Preload OHLCV for `symbols` covering `[fromISO, toISO]`. Pages back
   * from `toISO` until either (a) the oldest candle is before `fromISO`,
   * or (b) GT returns an empty page. Cached by symbol.
   */
  async preload(
    symbols: readonly string[],
    fromISO: string,
    toISO: string,
  ): Promise<{ loaded: number; failed: readonly string[] }> {
    const fromTs = Math.floor(Date.parse(fromISO) / 1000);
    const toTs = Math.floor(Date.parse(toISO) / 1000);
    if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || toTs <= fromTs) {
      throw new Error(
        `GeckoTerminalHistoricalFeed.preload: bad window ${fromISO} → ${toISO}`,
      );
    }

    const failed: string[] = [];
    let loaded = 0;
    for (const symbol of symbols) {
      try {
        // Disk cache fast path — if we already have candles covering this
        // window, skip the network entirely. Pool resolution still happens
        // (it's also cached), but no OHLCV calls are made.
        const cached = this.readCandleCache(symbol, fromTs, toTs);
        if (cached) {
          this.candlesBySymbol.set(symbol, cached);
          loaded++;
          this.log(
            `price-feed: ${symbol} HIT cache: ${cached.length} candles ` +
              `[${new Date(cached[0]!.ts * 1000).toISOString()} → ` +
              `${new Date(cached[cached.length - 1]!.ts * 1000).toISOString()}]`,
          );
          continue;
        }
        const pool = await this.resolvePool(symbol);
        if (!pool) {
          failed.push(symbol);
          continue;
        }
        const allCandles: OhlcvCandle[] = [];
        let cursor = toTs + 1; // start one second after toTs to include it
        let safetyPages = 0;
        while (cursor > fromTs && safetyPages < 50) {
          const page = await this.fetchOhlcvPage(pool, cursor);
          if (page.length === 0) break;
          allCandles.unshift(...page);
          // Step cursor back to the oldest candle in this page (exclusive),
          // so the next page picks up before it.
          const oldest = page[0]!.ts;
          if (oldest >= cursor) break; // safety: API returned newer than asked
          cursor = oldest;
          safetyPages++;
          // If oldest < fromTs we've covered the window; stop paginating.
          if (oldest < fromTs) break;
        }
        // De-dup + sort + filter into window. We keep candles slightly
        // outside the window so getPriceAt at an edge still has data.
        const seen = new Set<number>();
        const dedup: OhlcvCandle[] = [];
        for (const c of allCandles) {
          if (seen.has(c.ts)) continue;
          seen.add(c.ts);
          dedup.push(c);
        }
        dedup.sort((a, b) => a.ts - b.ts);
        if (dedup.length === 0) {
          failed.push(symbol);
          continue;
        }
        this.candlesBySymbol.set(symbol, dedup);
        loaded++;
        this.log(
          `price-feed: ${symbol} loaded ${dedup.length} candles ` +
            `[${new Date(dedup[0]!.ts * 1000).toISOString()} → ` +
            `${new Date(dedup[dedup.length - 1]!.ts * 1000).toISOString()}]`,
        );
        // Persist to disk so subsequent runs hit cache instead of GeckoTerminal.
        this.writeCandleCache(symbol, dedup);
      } catch (e: unknown) {
        this.log(
          `price-feed: preload failed for ${symbol}: ${(e as Error).message}`,
        );
        failed.push(symbol);
      }
    }
    return { loaded, failed };
  }

  async getPriceAt(symbol: string, timestampISO: string): Promise<number | null> {
    if (this.failedSymbols.has(symbol)) return null;
    const candles = this.candlesBySymbol.get(symbol);
    if (!candles || candles.length === 0) return null;
    const t = Math.floor(Date.parse(timestampISO) / 1000);
    if (!Number.isFinite(t)) return null;

    // Binary search for the largest candle ts <= t.
    let lo = 0;
    let hi = candles.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (candles[mid]!.ts <= t) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best < 0) {
      // t is older than our oldest candle. Use the oldest as a best-effort
      // approximation rather than returning null — the alternative is
      // dropping the trade entirely, which is a worse default.
      return candles[0]!.close;
    }
    return candles[best]!.close;
  }

  /**
   * Diagnostic accessor — returns counts useful for tests and logging.
   * Not part of the public interface.
   */
  cacheStats(): { symbols: number; candles: number; failed: number } {
    let total = 0;
    for (const c of this.candlesBySymbol.values()) total += c.length;
    return {
      symbols: this.candlesBySymbol.size,
      candles: total,
      failed: this.failedSymbols.size,
    };
  }

  /**
   * Return cached OHLCV candles for `symbol` whose timestamps fall within
   * [fromISO, toISO] inclusive. Used by candle-driven pattern backtests
   * (e.g. breakout detection) that need full OHLCV access, not just close.
   * Returns an empty array if the symbol failed preload or has no candles
   * in the window.
   */
  getCandlesInWindow(
    symbol: string,
    fromISO: string,
    toISO: string,
  ): ReadonlyArray<Readonly<OhlcvCandle>> {
    const candles = this.candlesBySymbol.get(symbol);
    if (!candles || candles.length === 0) return [];
    const fromTs = Math.floor(Date.parse(fromISO) / 1000);
    const toTs = Math.floor(Date.parse(toISO) / 1000);
    if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) return [];
    return candles.filter((c) => c.ts >= fromTs && c.ts <= toTs);
  }

  /** The timeframe + aggregate this feed was constructed with. */
  get config(): { timeframe: GTTimeframe; aggregate: number } {
    return { timeframe: this.timeframe, aggregate: this.aggregate };
  }
}

// Re-export the candle shape so downstream modules don't need a
// duplicate definition.
export type { OhlcvCandle };
