/**
 * NVR-SPEC-024 — Pattern P-PostVolatilityLong
 *
 * After any ≥5%/1h move on a tracked Base meme token (AERO/BRETT/DEGEN),
 * take a long with +3% target / -3% stop / 3h time stop.
 *
 * Direction of the prior move is irrelevant. From the EVE FINDING
 * (2026-05-04): both fade-after-down and continuation-after-up arms
 * showed the same +18pp edge over an 18.7% null on real AERO+BRETT+DEGEN
 * 30d data. The signal is volatility clustering — after any large move,
 * the probability of another +3% UP move in the next 3h roughly doubles.
 *
 * What makes this AI-shaped (not "Telegram alert with extra steps"):
 * confirm() reads CrossAssetState (macro regime, BTC dominance trend,
 * F&G, co-stress score, smart-wallet flow, recent realized edge per
 * pattern AND per token) and asks the AI for a 0-100 conviction score.
 * Conviction sizes the position. The trigger is just attention; the
 * conviction is the alpha layer.
 *
 * STATUS: STUB. detect() is gated by env var POST_VOL_LONG_PATTERN_ENABLED.
 * No live triggers until the 90d retest passes the validation gates per
 * SPEC-024.
 */

import type {
  Pattern,
  MarketSnapshot,
  PatternState,
  Trigger,
  Position,
  ConfirmContext,
  Conviction,
  ExitDecision,
} from "./types.js";
import type { TradeDecision } from "./trade-decision-shim.js";
import {
  readCrossAssetState,
  type CrossAssetState,
  type TokenState,
} from "./cross-asset-state.js";

// ----------------------------------------------------------------------------
// Pattern parameters — locked to the values that produced +17.7pp / +18.2pp
// edge in the 30d retro (FINDING_2026-05-04-EVE). Don't tune without re-
// running the full validation gauntlet from scratch.
// ----------------------------------------------------------------------------

/** Threshold for a "big move" that triggers post-vol-long (%). */
const MOVE_THRESHOLD_PCT = 5;

/** Window (minutes) over which to compute the rolling move. */
const ROLLING_WINDOW_MIN = 60;

/** Anti-stack: don't fire if a trigger already fired on this token in the
 *  last N minutes. Matches the retro's anti-stack guard. */
const ANTI_STACK_MIN = 60;

/** Profit target (%) — exit when realized PnL hits this. */
const TAKE_PROFIT_PCT = 3;

/** Stop loss (%) — exit when realized PnL drops to this. Symmetric. */
const STOP_LOSS_PCT = 3;

/** Time stop (hours) — exit if neither target nor stop hit by this. */
const TIME_STOP_HOURS = 3;

/** Max % of alpha sleeve this single per-token pattern can deploy. */
const MAX_ALLOCATION_PCT = 8;

/** Min position size (USD) — below this, gas eats the trade. Skip. */
const MIN_POSITION_USD = 50;

/** Tick cadence — 1-min resolution matches the trigger's time scale. */
const TICK_INTERVAL_MS = 60_000;

/** confirm() AI call timeout (ms). On timeout, treat as veto (fail closed). */
const CONFIRM_TIMEOUT_MS = 1500;

// ----------------------------------------------------------------------------
// Pattern state (persisted by runtime across ticks)
// ----------------------------------------------------------------------------

interface PostVolatilityLongState extends PatternState {
  /** Last trigger ISO per token. Used for anti-stack. */
  lastTriggerAt?: Record<string, string | undefined>;
}

// ----------------------------------------------------------------------------
// Pattern factory — one instance per token. Per
// `feedback_specialist_depth_beats_breadth`: explicit per-token instances,
// not generic universe scan.
// ----------------------------------------------------------------------------

export interface PostVolatilityLongOptions {
  /** Token symbol the pattern watches + trades. */
  symbol: string;
  /** Sector tag for downstream telemetry. Defaults to MEME_COINS. */
  sector?: string;
  /** Override the default pattern name. */
  name?: string;
}

export function createPostVolatilityLongPattern(
  opts: PostVolatilityLongOptions,
): Pattern {
  const symbol = opts.symbol.toUpperCase();
  const name = opts.name ?? `${symbol.toLowerCase()}_post_volatility_long`;
  const sector = opts.sector ?? "MEME_COINS";
  const version = "0.1.0-stub";

  return {
    name,
    version,
    description:
      `Single-asset (${symbol}) post-volatility long: after any ≥${MOVE_THRESHOLD_PCT}% / ` +
      `${ROLLING_WINDOW_MIN}min move, target +${TAKE_PROFIT_PCT}% in ${TIME_STOP_HOURS}h. ` +
      `AI conviction sizes via cross-asset state. Direction-agnostic.`,

    maxAllocationPct: MAX_ALLOCATION_PCT,
    maxConcurrentPositions: 1, // per-symbol pattern; one open at a time
    tickIntervalMs: TICK_INTERVAL_MS,

    // ── Layer 1: Mechanical Attention ────────────────────────────────────
    detect(market: MarketSnapshot, state: PatternState): Trigger | null {
      if (process.env["POST_VOL_LONG_PATTERN_ENABLED"] !== "true") {
        return null;
      }

      const cas = readCrossAssetState(market.extras);
      if (!cas) return null;
      const tokenState = cas.tokens[symbol];
      if (!tokenState) return null;

      const candles = tokenState.candles;
      // Need ROLLING_WINDOW_MIN+1 closes: oldest at the start of the window
      // and most-recent at the end. If the candle stream hasn't filled yet,
      // wait — return null without state side-effects.
      if (candles.length < ROLLING_WINDOW_MIN + 1) return null;

      const recent = candles[candles.length - 1]!;
      const oldest = candles[candles.length - 1 - ROLLING_WINDOW_MIN]!;
      if (oldest <= 0 || recent <= 0) return null;

      const movePct = ((recent - oldest) / oldest) * 100;
      const absMove = Math.abs(movePct);
      if (absMove < MOVE_THRESHOLD_PCT) return null;

      // Anti-stack: skip if we triggered on this token recently.
      const s = state as PostVolatilityLongState;
      s.lastTriggerAt ??= {};
      const lastIso = s.lastTriggerAt[symbol];
      if (lastIso) {
        const elapsedMin =
          (Date.parse(market.timestamp) - Date.parse(lastIso)) / 60_000;
        if (elapsedMin < ANTI_STACK_MIN) return null;
      }

      const direction: "up" | "down" = movePct > 0 ? "up" : "down";

      // Persist this trigger time for the anti-stack guard.
      s.lastTriggerAt[symbol] = market.timestamp;

      return {
        patternName: name,
        symbol,
        detectedAt: market.timestamp,
        context: {
          direction,
          movePct: Number(movePct.toFixed(2)),
          rollingWindowMin: ROLLING_WINDOW_MIN,
          oldestPrice: oldest,
          currentPrice: recent,
          realizedVol24h: tokenState.realizedVol24h,
        },
        summary:
          `${symbol} ${ROLLING_WINDOW_MIN}min move ${direction === "up" ? "+" : ""}` +
          `${movePct.toFixed(2)}% — post-volatility long candidate`,
      };
    },

    // ── Layer 2: AI Judgment (the alpha layer) ───────────────────────────
    async confirm(ctx: ConfirmContext): Promise<Conviction | null> {
      // Fail closed when the AI path or cross-asset state isn't available.
      // The pattern is meaningless without the conditioning layer — without
      // it, this is just a Telegram alert.
      if (!ctx.askAI) return null;
      const cas = readCrossAssetState(ctx.market.extras);
      if (!cas) return null;
      const tokenState = cas.tokens[symbol];
      if (!tokenState) return null;

      const prompt = buildConvictionPrompt(ctx.trigger, cas, tokenState);

      let response: string;
      try {
        const callPromise = ctx.askAI(prompt, { tier: "cheap", maxTokens: 80 });
        const timeoutPromise = new Promise<string>((_, reject) =>
          setTimeout(
            () => reject(new Error("confirm_timeout")),
            CONFIRM_TIMEOUT_MS,
          ),
        );
        response = await Promise.race([callPromise, timeoutPromise]);
      } catch {
        // Timeout or upstream failure → veto. Better to skip than to take
        // a malformed bet.
        return null;
      }

      return parseConvictionScore(response);
    },

    // ── Layer 3: Mechanical Execution ────────────────────────────────────
    enter(
      trigger: Trigger,
      conviction: Conviction,
      allocationUsd: number,
    ): TradeDecision {
      const sizeUsd = Math.max(0, allocationUsd * (conviction / 100));
      // Below the gas-loss floor: return a $0 BUY. The runtime treats $0
      // as no-op, so this is an explicit skip rather than an error.
      const effectiveSize = sizeUsd >= MIN_POSITION_USD ? sizeUsd : 0;

      return {
        action: "BUY",
        fromToken: "USDC",
        toToken: symbol,
        amountUSD: effectiveSize,
        reasoning:
          `${trigger.summary} · conviction=${conviction} · ` +
          `pattern=${name}@${version}`,
        sector,
      };
    },

    monitor(
      position: Position,
      market: MarketSnapshot,
      _state: PatternState,
    ): ExitDecision {
      const px = market.prices.get(position.symbol);
      if (px === undefined || px <= 0) return "hold";

      const pnlPct = ((px - position.entryPrice) / position.entryPrice) * 100;

      if (pnlPct >= TAKE_PROFIT_PCT) {
        return { action: "exit", reason: "profit_target", pctClose: 100 };
      }
      if (pnlPct <= -STOP_LOSS_PCT) {
        return { action: "exit", reason: "stop_loss", pctClose: 100 };
      }

      const heldMs =
        Date.parse(market.timestamp) - Date.parse(position.entryAt);
      const heldHours = heldMs / (60 * 60 * 1000);
      if (heldHours >= TIME_STOP_HOURS) {
        return { action: "exit", reason: "time_stop", pctClose: 100 };
      }

      return "hold";
    },
  };
}

// ----------------------------------------------------------------------------
// AI conviction prompt (exported for tests + visibility)
// ----------------------------------------------------------------------------

export function buildConvictionPrompt(
  trigger: Trigger,
  cas: CrossAssetState,
  tokenState: TokenState,
): string {
  const direction =
    (trigger.context as { direction?: string }).direction ?? "?";
  const movePct = (trigger.context as { movePct?: number }).movePct ?? 0;

  const dominanceLabel =
    cas.btcDominanceTrend24h > 1
      ? "rising"
      : cas.btcDominanceTrend24h < -1
        ? "falling"
        : "flat";
  const fgLabel =
    cas.fearGreed < 25
      ? "extreme fear"
      : cas.fearGreed < 45
        ? "fear"
        : cas.fearGreed < 55
          ? "neutral"
          : cas.fearGreed < 75
            ? "greed"
            : "extreme greed";
  const swLabel =
    cas.smartWalletFlow24h > 1000
      ? "accumulating"
      : cas.smartWalletFlow24h < -1000
        ? "distributing"
        : "flat";

  return `You are scoring a post-volatility long entry on a Base meme token.

TRIGGER:
- Token: ${trigger.symbol}
- Direction of prior move: ${direction}
- Magnitude: ${movePct}% in 1h
- Trigger time: ${trigger.detectedAt}

CROSS-ASSET STATE (right now):
- Macro regime: ${cas.macroRegime.regime} (score ${cas.macroRegime.score}/100, confidence ${cas.macroRegime.confidence.toFixed(2)})
- BTC dominance 24h trend: ${cas.btcDominanceTrend24h > 0 ? "+" : ""}${cas.btcDominanceTrend24h.toFixed(2)}% (${dominanceLabel})
- Fear & Greed: ${cas.fearGreed} (${fgLabel})
- Co-stress score (other memes also volatile?): ${cas.coStressScore}/100
- Smart-wallet 24h flow: ${cas.smartWalletFlow24h > 0 ? "+" : ""}$${cas.smartWalletFlow24h.toFixed(0)} (${swLabel})

THIS TOKEN, RIGHT NOW:
- Realized vol 24h: ${tokenState.realizedVol24h.toFixed(1)}%
- Recent fade hit rate (last 10 events): ${(tokenState.recentDirectionalEdge.fadeHit * 100).toFixed(0)}%
- Recent continuation hit rate (last 10 events): ${(tokenState.recentDirectionalEdge.continueHit * 100).toFixed(0)}%

THIS PATTERN'S RECENT EDGE (last ${cas.recentEdge.count} closed positions):
- Hit rate: ${(cas.recentEdge.hitRate * 100).toFixed(0)}%
- Mean return: ${cas.recentEdge.meanReturn > 0 ? "+" : ""}${cas.recentEdge.meanReturn.toFixed(2)}%
- Std return: ${cas.recentEdge.stdReturn.toFixed(2)}%

OUTPUT: single integer 0-100 on its own line, then one line of reasoning.
0 = veto (do not enter).
100 = max conviction (full size).

Calibration anchor: 50 = roughly the +18pp baseline edge from the 30d retro.
Score above 50 if conditions are MORE favorable than baseline; below if less.`;
}

/**
 * Parse the AI response, expecting a 0-100 integer (typically on its own
 * line, possibly with reasoning that follows). Returns null on parse
 * failure (treated as veto by confirm()).
 */
export function parseConvictionScore(response: string): number | null {
  if (!response) return null;
  const lines = response.trim().split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    // Match a leading 1-3 digit integer, optionally followed by space or
    // end-of-line. Accept "75", "75 because …", "75.", but reject "150"
    // or "abc".
    const m = trimmed.match(/^(\d{1,3})(?=$|[\s.,;:!?])/);
    if (!m) continue;
    const n = parseInt(m[1]!, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  }
  return null;
}

// ----------------------------------------------------------------------------
// Pre-built instances for the canonical 3-token meme universe (AERO + BRETT
// + DEGEN — the same universe validated in the 30d retro). Adding more
// tokens = adding more factory calls; keep the universe tight per
// `feedback_specialist_depth_beats_breadth`.
// ----------------------------------------------------------------------------

export const aeroPostVolatilityLong = createPostVolatilityLongPattern({
  symbol: "AERO",
});

export const brettPostVolatilityLong = createPostVolatilityLongPattern({
  symbol: "BRETT",
});

export const degenPostVolatilityLong = createPostVolatilityLongPattern({
  symbol: "DEGEN",
});

// ----------------------------------------------------------------------------
// Internals exposed for tests
// ----------------------------------------------------------------------------

export const _testInternals = {
  MOVE_THRESHOLD_PCT,
  ROLLING_WINDOW_MIN,
  ANTI_STACK_MIN,
  TAKE_PROFIT_PCT,
  STOP_LOSS_PCT,
  TIME_STOP_HOURS,
  MAX_ALLOCATION_PCT,
  MIN_POSITION_USD,
  CONFIRM_TIMEOUT_MS,
  TICK_INTERVAL_MS,
};
