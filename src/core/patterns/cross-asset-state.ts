/**
 * NVR-SPEC-024 — Cross-Asset State (the AI conviction layer's input)
 *
 * The struct that the harness populates each tick and injects into
 * MarketSnapshot.extras.crossAsset. Pattern.confirm() reads this to size
 * conviction with cross-asset context — exactly what humans can't watch
 * in real time.
 *
 * Refresh cadences (the harness is responsible for honoring these):
 *   macroRegime               every tick     (computeMacroRegime over BTC history)
 *   btcDominanceTrend24h      5 min          (CoinGecko /global)
 *   fearGreed                 1 hour         (alternative.me /fng)
 *   tokens.*.candles          every tick     (price feed)
 *   tokens.*.recentDirEdge    on position close  (runtime tracker)
 *   tokens.*.realizedVol24h   every tick     (derived from candles)
 *   coStressScore             every tick     (derived from tokens.*.realizedVol24h)
 *   recentEdge                on position close  (runtime tracker)
 *   smartWalletFlow24h        30 min         (signal-service /outcomes)
 *
 * All fields have fallbacks so the runtime doesn't crash when an external
 * feed is stale. Patterns reading this should treat the numbers as
 * "best-effort recent" not "real-time exact."
 *
 * The struct is read-only by design — patterns must not mutate it. The
 * harness is the sole writer.
 */

import type { MacroRegimeResult } from "../../algorithm/macro-regime.js";

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface CrossAssetState {
  /** ISO timestamp the snapshot was computed. */
  readonly computedAt: string;

  /** Macro regime (BULL/RANGING/BEAR + score + signals). */
  readonly macroRegime: MacroRegimeResult;

  /** 24h trailing change in BTC dominance %. Positive = capital fleeing
   *  alts to BTC = risk-off. */
  readonly btcDominanceTrend24h: number;

  /** Fear & Greed index 0-100 (real value when available; RSI-derived
   *  fallback otherwise). */
  readonly fearGreed: number;

  /** Per-token rolling state, keyed by uppercase symbol. */
  readonly tokens: Readonly<Record<string, TokenState>>;

  /** Are multiple memes simultaneously volatile right now? 0-100.
   *  High = correlated risk-off; low = idiosyncratic moves. */
  readonly coStressScore: number;

  /** Last N closed positions for the post-volatility-long pattern. */
  readonly recentEdge: PatternEdgeStats;

  /** Smart-wallet aggregate positioning shift in past 24h. Signed USD. */
  readonly smartWalletFlow24h: number;
}

export interface TokenState {
  readonly symbol: string;
  /** Last 60+ 1-min closes. detect() reads the tail for the rolling 1h
   *  move calc; realizedVol24h is computed from a wider window upstream. */
  readonly candles: readonly number[];
  /** Per-token directional edge from recent closed positions. 0-1. */
  readonly recentDirectionalEdge: {
    readonly fadeHit: number;
    readonly continueHit: number;
  };
  /** Realized volatility annualized %, 24h window. */
  readonly realizedVol24h: number;
}

export interface PatternEdgeStats {
  /** N closed positions in the window (last 10 by convention). */
  readonly count: number;
  /** Hit rate 0-1. */
  readonly hitRate: number;
  /** Mean signed return %. */
  readonly meanReturn: number;
  /** Std of returns %. */
  readonly stdReturn: number;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Read CrossAssetState from a MarketSnapshot.extras. Returns null if not
 * populated (tests, or harness booted without the populator). Patterns
 * should fail closed when null.
 */
export function readCrossAssetState(
  extras: Readonly<Record<string, unknown>> | undefined,
): CrossAssetState | null {
  if (!extras) return null;
  const cas = (extras as { crossAsset?: unknown }).crossAsset;
  if (!cas || typeof cas !== "object") return null;
  return cas as CrossAssetState;
}

/**
 * Empty state for tests + the harness's pre-first-refresh state. All
 * numeric fields are zeroed and the regime defaults to RANGING with zero
 * confidence — so any AI conviction call sees "no signal" and any pattern
 * checking confidence thresholds vetoes naturally.
 */
export function emptyCrossAssetState(now: string): CrossAssetState {
  return {
    computedAt: now,
    macroRegime: {
      regime: "RANGING",
      score: 0,
      confidence: 0,
      signals: { trend: 0, dominance: 0, sentiment: 0 },
    },
    btcDominanceTrend24h: 0,
    fearGreed: 50,
    tokens: {},
    coStressScore: 0,
    recentEdge: { count: 0, hitRate: 0, meanReturn: 0, stdReturn: 0 },
    smartWalletFlow24h: 0,
  };
}

/**
 * Compute a co-stress score from per-token realized volatilities. High
 * value = many tokens are simultaneously volatile (correlated risk-off);
 * low = at most one is volatile (idiosyncratic).
 *
 * The score is the geometric-style intersection of the top two tokens'
 * elevation over the lowest-vol token (treated as the "calm baseline").
 * If both top tokens are well above the calm one, that's correlated
 * stress — a market-wide event. If only one is, that's idiosyncratic —
 * a mispriced single-name move and a more attractive long entry.
 *
 * Geometric (not additive) so a single-name spike paired with a calm
 * second token can't masquerade as broad stress.
 *
 * Returns 0-100. Pure function — exposed for tests + reuse.
 */
export function computeCoStressScore(realizedVols: readonly number[]): number {
  if (realizedVols.length < 2) return 0;
  const sorted = [...realizedVols].sort((a, b) => b - a);
  // Lowest-vol token as the "calm baseline." For our small universe (3
  // memes), the median IS the second-highest, so it can't represent
  // "calm." The min is the conservative anchor.
  const baseline = sorted[sorted.length - 1] ?? 0;
  if (baseline <= 0) return 0;
  const top1 = sorted[0]!;
  const top2 = sorted[1]!;
  const ratio1 = top1 / baseline;
  const ratio2 = top2 / baseline;
  // Both elevated → high co-stress. One elevated, one matching baseline →
  // ratio2 ≈ 1 → second factor ≈ 0 → low score (good: idiosyncratic).
  const elevated = Math.sqrt(Math.max(0, ratio1 - 1) * Math.max(0, ratio2 - 1));
  // Saturate at 2 (a 3× / 3× double-spike — broad stress).
  const saturated = Math.min(2, elevated);
  return Math.round((saturated / 2) * 100);
}
