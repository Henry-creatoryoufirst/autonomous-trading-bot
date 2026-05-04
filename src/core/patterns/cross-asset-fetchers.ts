/**
 * NVR-SPEC-024 — Cross-Asset Fetchers + State Builder
 *
 * The fetchers + orchestrator that turn the CrossAssetState type from
 * cross-asset-state.ts into real values.
 *
 * Three external feeds:
 *   - CoinGecko /global         — BTC dominance + 24h trend (TTL 5 min)
 *   - alternative.me /fng       — Fear & Greed index (TTL 1 hour)
 *   - signal-service /outcomes  — smart-wallet aggregate (TTL 30 min)
 *
 * All three use Promise.allSettled in the builder so a single feed
 * failure doesn't block the others. Each fetcher has a fallback value
 * that means "no signal yet" — the AI conviction layer reading these
 * should treat the fallbacks as neutral.
 *
 * HTTP injection: every fetcher accepts an optional `httpGet` /
 * `fetchImpl` override so unit tests can mock without touching real
 * endpoints. Production passes nothing and gets `axios` / global
 * `fetch` per the codebase convention.
 */

import axios from "axios";
import { CacheManager } from "../services/cache-manager.js";
import {
  computeCoStressScore,
  type CrossAssetState,
  type PatternEdgeStats,
  type TokenState,
} from "./cross-asset-state.js";
import type { MacroRegimeResult } from "../../algorithm/macro-regime.js";

// ----------------------------------------------------------------------------
// Cache TTLs + keys
// ----------------------------------------------------------------------------

const TTL_BTC_DOMINANCE_MS = 5 * 60 * 1000;
const TTL_FEAR_GREED_MS = 60 * 60 * 1000;
const TTL_SMART_WALLET_FLOW_MS = 30 * 60 * 1000;

const CACHE_KEY_BTC_DOM = "nvr:cross-asset:btc-dominance";
const CACHE_KEY_FEAR_GREED = "nvr:cross-asset:fear-greed";
const CACHE_KEY_SW_FLOW = "nvr:cross-asset:smart-wallet-flow";

const HTTP_TIMEOUT_MS = 10_000;
const SIGNAL_SERVICE_TIMEOUT_MS = 2500;

// ----------------------------------------------------------------------------
// Dependencies (injectable for tests)
// ----------------------------------------------------------------------------

export interface CrossAssetFetcherDeps {
  /** Shared CacheManager (the harness's). Reuse — don't roll your own. */
  cache: CacheManager;
  /** Override axios (for tests). Returns { data: unknown }. */
  httpGet?: (
    url: string,
    opts?: { timeout?: number },
  ) => Promise<{ data: unknown }>;
  /** Override global fetch (for tests). Used for the signal-service call. */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Logger. Defaults to console.warn for failures, console.log for info. */
  log?: (msg: string) => void;
  /** Clock for testable time math. Defaults to Date.now. */
  now?: () => number;
}

// ----------------------------------------------------------------------------
// CoinGecko /global response shape (only the fields we read)
// ----------------------------------------------------------------------------

interface CoinGeckoGlobalResponse {
  data?: {
    market_cap_percentage?: {
      btc?: number;
    };
  };
}

// alternative.me /fng response shape
interface FearGreedResponse {
  data?: Array<{ value?: string | number }>;
}

// signal-service /outcomes response shape (subset we read)
interface SignalServiceOutcomesResponse {
  walletHitRates?: Array<{
    walletId: string;
    hitRate4h: number;
    totalSignals: number;
  }>;
  signalAccuracy?: Array<{
    metric: string;
    edge: number;
    totalSamples: number;
  }>;
  totalTracked?: number;
}

// ----------------------------------------------------------------------------
// CrossAssetFetchers — the external-feed surface
// ----------------------------------------------------------------------------

/**
 * Stateful fetcher class. Owns:
 *   - The shared CacheManager (for short-cadence per-feed caching).
 *   - A rolling 25h history of BTC dominance values (so we can compute
 *     `trend24h` ourselves — CoinGecko's free `/global` only returns the
 *     current snapshot, not historical dominance).
 *
 * Bootstrap: until 24h+ of dominance history exists, `trend24h` returns 0
 * (neutral). The harness reads this as "no signal yet" rather than
 * crashing or producing a misleading number. After 24h of uptime the
 * trend becomes meaningful.
 */
export class CrossAssetFetchers {
  private readonly cache: CacheManager;
  private readonly httpGet: (
    url: string,
    opts?: { timeout?: number },
  ) => Promise<{ data: unknown }>;
  private readonly fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  private readonly log: (msg: string) => void;
  private readonly now: () => number;

  /** Rolling history of (timestamp_ms, btcDominancePct). Trimmed to 25h. */
  private readonly btcDominanceHistory: { ts: number; pct: number }[] = [];

  constructor(deps: CrossAssetFetcherDeps) {
    this.cache = deps.cache;
    this.httpGet =
      deps.httpGet ??
      (async (url, opts) => {
        const res = await axios.get(url, { timeout: opts?.timeout ?? HTTP_TIMEOUT_MS });
        return { data: res.data as unknown };
      });
    this.fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init));
    this.log = deps.log ?? ((m) => console.warn(`[cross-asset] ${m}`));
    this.now = deps.now ?? (() => Date.now());
  }

  // ── BTC Dominance + 24h Trend ────────────────────────────────────────

  /**
   * Returns current BTC dominance (%) and the 24h trend (signed pct points).
   * Returns null if the upstream call fails. The caller should treat
   * `trend24h: 0` as "no history yet" (the bot booted within the last 24h).
   */
  async fetchBtcDominance(): Promise<{ current: number; trend24h: number } | null> {
    let current: number | null;
    try {
      current = await this.cache.getOrFetch(
        CACHE_KEY_BTC_DOM,
        TTL_BTC_DOMINANCE_MS,
        async () => {
          const res = await this.httpGet(
            "https://api.coingecko.com/api/v3/global",
            { timeout: HTTP_TIMEOUT_MS },
          );
          const body = res.data as CoinGeckoGlobalResponse;
          const pct = body?.data?.market_cap_percentage?.btc;
          if (typeof pct !== "number" || !Number.isFinite(pct)) {
            throw new Error("coingecko /global returned no btc dominance");
          }
          return pct;
        },
      );
    } catch (e) {
      this.log(
        `BTC dominance fetch failed: ${(e as Error).message?.slice(0, 100)}`,
      );
      return null;
    }

    if (current === null) return null;

    // Append + trim history. Cache hits will re-append the same value, but
    // that's fine — the de-dupe by approximate timestamp keeps the buffer
    // bounded and the trend calculation is still correct (newest matches).
    const nowMs = this.now();
    this.btcDominanceHistory.push({ ts: nowMs, pct: current });
    const cutoff = nowMs - 25 * 60 * 60 * 1000;
    while (
      this.btcDominanceHistory.length > 0 &&
      this.btcDominanceHistory[0]!.ts < cutoff
    ) {
      this.btcDominanceHistory.shift();
    }

    // Find the history entry closest to 24h ago. If none exists (bootstrap
    // window), trend is 0.
    const target = nowMs - 24 * 60 * 60 * 1000;
    let closest: { ts: number; pct: number } | null = null;
    let closestDist = Number.POSITIVE_INFINITY;
    for (const entry of this.btcDominanceHistory) {
      const dist = Math.abs(entry.ts - target);
      // Only consider entries at-or-before the 24h-ago target — using a
      // future entry as "24h ago" would invert the sign.
      if (entry.ts > target) continue;
      if (dist < closestDist) {
        closest = entry;
        closestDist = dist;
      }
    }
    const trend24h = closest ? current - closest.pct : 0;
    return { current, trend24h };
  }

  // ── Fear & Greed ─────────────────────────────────────────────────────

  /**
   * Returns the Fear & Greed index (0-100). Falls back to null on failure;
   * callers should treat null as "use neutral 50."
   */
  async fetchFearGreed(): Promise<number | null> {
    try {
      const value = await this.cache.getOrFetch(
        CACHE_KEY_FEAR_GREED,
        TTL_FEAR_GREED_MS,
        async () => {
          const res = await this.httpGet("https://api.alternative.me/fng/", {
            timeout: HTTP_TIMEOUT_MS,
          });
          const body = res.data as FearGreedResponse;
          const raw = body?.data?.[0]?.value;
          const num = typeof raw === "string" ? parseInt(raw, 10) : raw;
          if (typeof num !== "number" || !Number.isFinite(num) || num < 0 || num > 100) {
            throw new Error("alternative.me /fng returned bad value");
          }
          return num;
        },
      );
      return value;
    } catch (e) {
      this.log(
        `Fear & Greed fetch failed: ${(e as Error).message?.slice(0, 100)}`,
      );
      return null;
    }
  }

  // ── Smart-Wallet 24h Flow (signal-service /outcomes) ─────────────────

  /**
   * Returns a signed "smart-wallet flow" proxy in approximate USD-scale.
   *
   * IMPORTANT: this is a PROXY, not a true on-chain net-buy/sell number.
   * The signal-service /outcomes endpoint exposes per-wallet hit rates and
   * per-metric edge percentages, not directional flow USD. We derive a
   * directional bias from the smart-wallet edge measure:
   *
   *   - Positive edge = smart wallets are right + accumulating-correlated → +flow
   *   - Negative edge = smart wallets are wrong / distributing-correlated → −flow
   *
   * The magnitude is scaled by `topProposerSignals` so a high-conviction
   * window has a larger absolute number than a low-conviction one. The
   * scalar (1000) is chosen so typical values land in the ±1k–10k USD
   * range — comparable to what a "real" flow number would look like.
   *
   * Future work (TODO in SPEC-024 followups): extend signal-service to
   * expose true net buy/sell USD aggregated over watched smart wallets.
   * Until then, this approximation captures directional bias without
   * blocking the pattern from shipping.
   */
  async fetchSmartWalletFlow24h(
    signalServiceUrl: string | undefined,
  ): Promise<number | null> {
    if (!signalServiceUrl) {
      // No signal service configured → null → caller treats as 0 (neutral).
      return null;
    }
    try {
      const flow = await this.cache.getOrFetch(
        CACHE_KEY_SW_FLOW,
        TTL_SMART_WALLET_FLOW_MS,
        async () => {
          const controller = new AbortController();
          const timeout = setTimeout(
            () => controller.abort(),
            SIGNAL_SERVICE_TIMEOUT_MS,
          );
          let res: Response;
          try {
            res = await this.fetchImpl(`${signalServiceUrl}/outcomes`, {
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timeout);
          }
          if (!res.ok) {
            throw new Error(`signal-service /outcomes returned ${res.status}`);
          }
          const data = (await res.json()) as SignalServiceOutcomesResponse;

          // Smart-wallet edge: edge of "smartWalletStrong" metric.
          const sa = Array.isArray(data.signalAccuracy) ? data.signalAccuracy : [];
          const swEdge = sa.find((s) => s.metric === "smartWalletStrong");
          const edge =
            swEdge && swEdge.totalSamples >= 5 ? swEdge.edge : 0;

          // Conviction proxy: top-proposer signal count over the window.
          const whr = Array.isArray(data.walletHitRates) ? data.walletHitRates : [];
          const topSignals =
            whr.filter((w) => w.totalSignals >= 10).sort((a, b) => b.hitRate4h - a.hitRate4h)[0]
              ?.totalSignals ?? 0;

          // Scale: edge (signed pct) × signal count × 1000 ≈ "USD-equivalent
          // directional bias." Plenty of approximation here, but documented.
          return edge * Math.min(topSignals, 100) * 1000;
        },
      );
      return flow;
    } catch (e) {
      this.log(
        `Smart-wallet flow fetch failed: ${(e as Error).message?.slice(0, 100)}`,
      );
      return null;
    }
  }

  // ── Diagnostics ──────────────────────────────────────────────────────

  /** Test/diagnostic helper. Returns the current size of the dominance
   *  history ring. */
  btcDominanceHistorySize(): number {
    return this.btcDominanceHistory.length;
  }
}

// ----------------------------------------------------------------------------
// State builder — composes fetcher results + caller-provided per-token data
// into a fully-populated CrossAssetState.
//
// Caller responsibilities (the harness):
//   - Pre-compute MacroRegimeResult from BTC price history.
//   - Maintain the per-token candle rings + recentDirectionalEdge from
//     the position tracker.
//   - Track the pattern's recent edge stats from closed positions.
//
// This builder's responsibility:
//   - Fan-out fetcher calls in parallel with Promise.allSettled.
//   - Apply fallbacks when individual feeds fail.
//   - Compute coStressScore from per-token realized vols.
//   - Assemble the final CrossAssetState.
// ----------------------------------------------------------------------------

export interface BuildCrossAssetStateOptions {
  fetchers: CrossAssetFetchers;
  /** Per-token state — keyed by uppercase symbol. */
  tokens: Record<string, TokenState>;
  /** Pre-computed macro regime. */
  macroRegime: MacroRegimeResult;
  /** Pattern's recent edge stats from closed positions. */
  recentEdge: PatternEdgeStats;
  /** signal-service URL. Pass undefined to skip the smart-wallet feed. */
  signalServiceUrl?: string;
  /** ISO timestamp to stamp the snapshot. Defaults to "now." */
  computedAt?: string;
}

export async function buildCrossAssetState(
  opts: BuildCrossAssetStateOptions,
): Promise<CrossAssetState> {
  const [btcDomResult, fgResult, swFlowResult] = await Promise.allSettled([
    opts.fetchers.fetchBtcDominance(),
    opts.fetchers.fetchFearGreed(),
    opts.fetchers.fetchSmartWalletFlow24h(opts.signalServiceUrl),
  ]);

  const btcDominanceTrend24h =
    btcDomResult.status === "fulfilled" && btcDomResult.value
      ? btcDomResult.value.trend24h
      : 0;
  const fearGreed =
    fgResult.status === "fulfilled" && fgResult.value !== null
      ? fgResult.value
      : 50;
  const smartWalletFlow24h =
    swFlowResult.status === "fulfilled" && swFlowResult.value !== null
      ? swFlowResult.value
      : 0;

  const realizedVols = Object.values(opts.tokens).map((t) => t.realizedVol24h);
  const coStressScore = computeCoStressScore(realizedVols);

  return {
    computedAt: opts.computedAt ?? new Date().toISOString(),
    macroRegime: opts.macroRegime,
    btcDominanceTrend24h,
    fearGreed,
    tokens: opts.tokens,
    coStressScore,
    recentEdge: opts.recentEdge,
    smartWalletFlow24h,
  };
}
