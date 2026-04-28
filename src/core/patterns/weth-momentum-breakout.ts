/**
 * NVR-SPEC-022 — WETH Momentum Breakout (single-asset specialist pattern)
 *
 * The first v22 candle-cadence pattern. Single-asset, by design — per
 * `feedback_specialist_depth_beats_breadth`: alpha lives in catching the
 * physics of capital movement at high resolution on tokens that matter,
 * not in scanning all of crypto for shallow signals.
 *
 * Mechanism (Moskowitz-Ooi-Pedersen JFE 2012; Liu & Tsyvinski RFS 2021):
 *   When an asset closes above its prior N-period high WITH volume confirmation,
 *   the breakout reflects a regime shift in flow that has measured forward
 *   returns over horizons of days-to-weeks. The pattern's edge is being
 *   present + sized in the first close after the regime breaks, NOT chasing
 *   intraday wicks (those are dominated by MEV/HFT and have decayed alpha).
 *
 * Trigger:
 *   - On every 4h candle close on WETH:
 *     1. Maintain rolling LOOKBACK_PERIODS-candle window in state
 *     2. After warmup, fire when:
 *        (a) current close  > max(high) of prior LOOKBACK_PERIODS candles, AND
 *        (b) current volume > VOLUME_MULT × mean(volume) of prior candles
 *
 * Sizing:
 *   - Pattern can use up to MAX_ALLOCATION_PCT of alpha sleeve
 *   - Conviction defaults to 100 (deterministic backtest); AI confirm() is
 *     a deferred v2 enhancement once mechanism is validated empirically
 *
 * Exit (mechanical, no AI):
 *   - Take-profit: realized > +TAKE_PROFIT_PCT
 *   - Trail-stop: drawdown from peak > TRAIL_STOP_PCT
 *   - Time-stop: held >= MAX_HOLD_PERIODS * timeframeMs
 *
 * Why "AI does what humans can't": humans CAN watch a 4h ETH chart for
 * breakouts in theory, but humans sleep, FOMO-chase fakeouts, hesitate at
 * close, and lack mechanical exit discipline. This pattern fires at every
 * 4h close, sizes uniformly, exits without negotiation.
 *
 * STATUS: STUB. detect() is gated by env var WETH_BREAKOUT_PATTERN_ENABLED
 * for the same reason P0/P1 were — no live triggers until empirical
 * historical validation passes.
 */

import type {
  Pattern,
  MarketSnapshot,
  PatternState,
  Trigger,
  Position,
  ExitDecision,
} from "./types.js";
import type { TradeDecision } from "./trade-decision-shim.js";

// ----------------------------------------------------------------------------
// Pattern parameters (defensible defaults; CRITIC will tune via real data)
// ----------------------------------------------------------------------------

/** Number of prior candles to compute the breakout reference from. */
const LOOKBACK_PERIODS = 20;

/** Volume must exceed this multiple of the prior period's mean to confirm. */
const VOLUME_MULT = 1.5;

/** Max % of alpha sleeve this pattern can deploy. */
const MAX_ALLOCATION_PCT = 25;

/** Max concurrent open positions (one at a time on a single asset). */
const MAX_CONCURRENT = 1;

/** Take-profit threshold (% from entry). */
const TAKE_PROFIT_PCT = 15;

/** Trailing-stop drawdown from peak (% from local high since entry). */
const TRAIL_STOP_PCT = 8;

/** Time-stop in periods (4h × MAX_HOLD_PERIODS = max hold). */
const MAX_HOLD_PERIODS = 42; // 42 × 4h = 7 days

/** Tick hint — patterns are event-driven, but the runtime takes the min. */
const TICK_INTERVAL_MS = 60_000;

// ----------------------------------------------------------------------------
// Pattern state
// ----------------------------------------------------------------------------

interface CandleSummary {
  ts: string; // ISO close time
  close: number;
  high: number;
  volumeUsd: number;
}

interface BreakoutState extends PatternState {
  /** Rolling window of the last LOOKBACK_PERIODS candles (excluding current). */
  recent?: CandleSummary[];
  /** Per-position peak (close) since entry, keyed by entry ISO. Used for trailing-stop. */
  peakSinceEntry?: Record<string, number | undefined>;
}

// ----------------------------------------------------------------------------
// Pattern implementation
// ----------------------------------------------------------------------------

export const wethMomentumBreakoutPattern: Pattern = {
  name: "weth_momentum_breakout",
  version: "0.1.0-stub",
  description:
    "Single-asset (WETH) 4h breakout: closes above prior 20-period high with volume > 1.5× average. " +
    "Specialist depth on a single high-volume Base asset — first v22 candle-cadence pattern.",

  maxAllocationPct: MAX_ALLOCATION_PCT,
  maxConcurrentPositions: MAX_CONCURRENT,
  tickIntervalMs: TICK_INTERVAL_MS,

  detect(market: MarketSnapshot, state: PatternState): Trigger | null {
    if (process.env.WETH_BREAKOUT_PATTERN_ENABLED !== "true") return null;

    const ev = (market.extras as { event?: { kind?: string; symbol?: string; payload?: Record<string, unknown> } } | undefined)?.event;
    if (!ev || ev.kind !== "candle_close") return null;
    if (ev.symbol !== "WETH") return null;

    const p = ev.payload;
    if (!p) return null;

    const close = Number(p.close);
    const high = Number(p.high);
    const volumeUsd = Number(p.volumeUsd);
    if (!Number.isFinite(close) || close <= 0) return null;
    if (!Number.isFinite(high) || high <= 0) return null;
    if (!Number.isFinite(volumeUsd) || volumeUsd < 0) return null;

    const s = state as BreakoutState;
    s.recent ??= [];

    // We need at least LOOKBACK_PERIODS prior candles to evaluate.
    // The current candle does NOT participate in the lookback — it's the
    // candle being EVALUATED against the prior window.
    let trigger: Trigger | null = null;
    if (s.recent.length >= LOOKBACK_PERIODS) {
      const prior = s.recent.slice(-LOOKBACK_PERIODS);
      const priorHigh = Math.max(...prior.map((c) => c.high));
      const priorVolMean =
        prior.reduce((sum, c) => sum + c.volumeUsd, 0) / prior.length;

      const breakout = close > priorHigh;
      const volumeConfirm = volumeUsd > VOLUME_MULT * priorVolMean;

      if (breakout && volumeConfirm) {
        const breakoutMagnitudePct = ((close - priorHigh) / priorHigh) * 100;
        const volumeRatio = priorVolMean > 0 ? volumeUsd / priorVolMean : 0;
        trigger = {
          patternName: "weth_momentum_breakout",
          symbol: "WETH",
          detectedAt: market.timestamp,
          context: {
            close,
            priorHigh,
            breakoutMagnitudePct: Number(breakoutMagnitudePct.toFixed(3)),
            volumeUsd,
            priorVolMean,
            volumeRatio: Number(volumeRatio.toFixed(2)),
            lookbackPeriods: LOOKBACK_PERIODS,
          },
          summary: `WETH 4h close ${close.toFixed(2)} > prior-${LOOKBACK_PERIODS} high ${priorHigh.toFixed(2)} (+${breakoutMagnitudePct.toFixed(2)}%) with vol ${volumeRatio.toFixed(2)}× avg`,
        };
      }
    }

    // Append current candle to the window AFTER evaluating, so the next
    // tick has this candle in its prior-window.
    s.recent.push({
      ts: market.timestamp,
      close,
      high,
      volumeUsd,
    });
    // Cap window to avoid unbounded memory; we only need the last LOOKBACK.
    if (s.recent.length > LOOKBACK_PERIODS + 5) {
      s.recent.splice(0, s.recent.length - (LOOKBACK_PERIODS + 5));
    }

    return trigger;
  },

  enter(trigger: Trigger, conviction: number, allocationUsd: number): TradeDecision {
    const sizeUsd = Math.max(0, allocationUsd * (conviction / 100));
    return {
      action: "BUY",
      fromToken: "USDC",
      toToken: "WETH",
      amountUSD: sizeUsd,
      reasoning:
        `${trigger.summary} · conviction=${conviction} · ` +
        `pattern=weth_momentum_breakout@${wethMomentumBreakoutPattern.version}`,
      sector: "BLUE_CHIP",
    };
  },

  monitor(position: Position, market: MarketSnapshot, state: PatternState): ExitDecision {
    const px = market.prices.get(position.symbol);
    if (px === undefined || px <= 0) return "hold";

    const s = state as BreakoutState;
    s.peakSinceEntry ??= {};

    // Track peak-since-entry for trailing-stop math
    const prevPeak = s.peakSinceEntry[position.entryAt] ?? position.entryPrice;
    if (px > prevPeak) {
      s.peakSinceEntry[position.entryAt] = px;
    }
    const peak = s.peakSinceEntry[position.entryAt] ?? position.entryPrice;

    const pnlPct = ((px - position.entryPrice) / position.entryPrice) * 100;
    const drawdownFromPeakPct = peak > 0 ? ((peak - px) / peak) * 100 : 0;

    // 1) Take-profit
    if (pnlPct >= TAKE_PROFIT_PCT) {
      delete s.peakSinceEntry[position.entryAt];
      return { action: "exit", reason: "take_profit", pctClose: 100 };
    }

    // 2) Trailing stop — only after the position has actually been in profit
    // at some point (peak > entry). Otherwise "trail_stop" is just a noisy
    // re-label of stop_loss, which is handled separately below.
    if (peak > position.entryPrice && drawdownFromPeakPct >= TRAIL_STOP_PCT) {
      delete s.peakSinceEntry[position.entryAt];
      return { action: "exit", reason: "trail_stop", pctClose: 100 };
    }

    // 3) Hard stop-loss (catastrophic protection — separate from trail)
    if (pnlPct <= -10) {
      delete s.peakSinceEntry[position.entryAt];
      return { action: "exit", reason: "stop_loss", pctClose: 100 };
    }

    // 4) Time-stop
    const heldMs = Date.parse(market.timestamp) - Date.parse(position.entryAt);
    const heldPeriods = heldMs / (4 * 60 * 60 * 1000); // 4h periods
    if (heldPeriods >= MAX_HOLD_PERIODS) {
      delete s.peakSinceEntry[position.entryAt];
      return { action: "exit", reason: "time_stop", pctClose: 100 };
    }

    return "hold";
  },
};

// ----------------------------------------------------------------------------
// Internals exposed for tests (parameters can be probed without re-import)
// ----------------------------------------------------------------------------

export const _testInternals = {
  LOOKBACK_PERIODS,
  VOLUME_MULT,
  MAX_ALLOCATION_PCT,
  MAX_CONCURRENT,
  TAKE_PROFIT_PCT,
  TRAIL_STOP_PCT,
  MAX_HOLD_PERIODS,
};
