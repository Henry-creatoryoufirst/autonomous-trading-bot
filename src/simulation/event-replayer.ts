/**
 * NVR-SPEC-022 — Event Replayer (foundation)
 *
 * The companion to `replay-engine.ts`. The replay-engine ticks candles
 * through technical-indicator strategies; this replays discrete events
 * (stablecoin price snapshots, Aave LiquidationCall events, listing
 * announcements, on-chain whale moves) through the v22 PatternRuntime.
 *
 * Why a separate class:
 *   - Patterns trigger on events with sub-candle precision (e.g., a
 *     depeg crossing -50bps for 5min, or a $200k liquidation block).
 *     A 1h candle replay would miss the trigger or replay it at wrong
 *     time. Events have their own timestamps; we play them back exactly.
 *   - Patterns share state across events (the depeg pattern remembers
 *     "first seen below peg"). Replaying chronologically lets that
 *     state evolve naturally.
 *
 * What it does:
 *   1. Take a chronologically-sorted list of HistoricalEvents
 *   2. For each event, construct a MarketSnapshot (price+context)
 *   3. Call runtime.tick(snapshot)
 *   4. Aggregate per-pattern P&L from the runtime's position tracker
 *
 * What it doesn't do (deferred to follow-up work):
 *   - Pull events from Aave/Morpho subgraphs (returns from an injected
 *     loader; for now, synthetic fixtures or hand-curated event lists)
 *   - Walk-forward IS/OOS validation (use existing walk-forward/engine)
 *   - Multi-symbol composite snapshots (foundation handles single-symbol
 *     events well; multi-symbol needs a snapshot merger — TODO)
 */

import type { MarketSnapshot } from "../core/patterns/types.js";
import type { PatternRuntime, TickReport } from "../core/patterns/runtime.js";
import type { HistoricalPriceFeed } from "./data/price-feed.js";
import type { SnapshotRef } from "./backtest-executor.js";

// ----------------------------------------------------------------------------
// Event shape — minimal but enough for the patterns we care about
// ----------------------------------------------------------------------------

export interface HistoricalEvent {
  /** ISO timestamp of the event. Events are replayed in this order. */
  readonly timestamp: string;
  /** Primary symbol the event applies to. */
  readonly symbol: string;
  /** Spot price at event time. */
  readonly price: number;
  /** Event-specific payload, made available to patterns via
   *  MarketSnapshot.extras.event. Examples:
   *    - depeg event: { source: 'aerodrome_subgraph', poolId: '0x...' }
   *    - liquidation event: { protocol: 'aave-v3', collateral, liquidator,
   *                            amountUsd, txHash, blockNumber }
   *    - listing event: { exchange: 'coinbase', stage: 'roadmap'|'live' }
   */
  readonly kind: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

// ----------------------------------------------------------------------------
// Replay options
// ----------------------------------------------------------------------------

export interface ReplayOptions {
  /**
   * Optional callback invoked after each tick. Useful for live progress
   * updates in long backtests, or for capturing per-tick TickReports.
   */
  onTick?: (event: HistoricalEvent, report: TickReport) => void | Promise<void>;
  /**
   * If true, runs each tick sequentially with await. If false, the
   * replayer fires ticks as fast as the runtime returns, but still
   * waits for each before moving on (no parallelism — patterns need
   * deterministic state evolution). Default true.
   */
  sequential?: boolean;
  /**
   * Carry-forward prices: if set, the replayer remembers the last
   * price seen for each symbol and includes it in every snapshot's
   * `prices` map. Useful when one event happens for SymbolA while
   * a pattern tracking SymbolB still wants a current quote. Default true.
   */
  carryForwardPrices?: boolean;
  /**
   * Optional historical price feed. When set together with
   * `watchedSymbols`, the replayer enriches each snapshot's `prices`
   * with feed-derived USD prices for those symbols at the event's
   * timestamp. This is what turns a trigger-fidelity backtest into a
   * P&L-fidelity backtest — without it, monitor() exits at synthetic
   * prices and realized P&L is meaningless.
   *
   * If the feed implements `preload()`, the replayer calls it once
   * with the full event window before iterating, so the per-tick
   * `getPriceAt` calls hit a warm cache.
   */
  priceFeed?: HistoricalPriceFeed;
  /**
   * Symbols whose prices should be present on every snapshot. Required
   * when using `priceFeed` for it to do anything. Typically the union
   * of symbols any enabled pattern might trade, or the symbols any
   * open position holds.
   */
  watchedSymbols?: readonly string[];
  /**
   * If set, the replayer writes the current snapshot to this ref before
   * each `runtime.tick()` call. The backtest executor reads from the
   * same ref to resolve fill prices. Without this, the executor has no
   * way to know what timestamp/prices apply to the decision being
   * filled.
   */
  snapshotRef?: SnapshotRef;
  /**
   * Logger. Default no-op. Used for preload status and per-tick price
   * miss diagnostics.
   */
  log?: (msg: string) => void;
}

// ----------------------------------------------------------------------------
// Replay result
// ----------------------------------------------------------------------------

export interface ReplayResult {
  readonly eventsReplayed: number;
  readonly tickReports: readonly TickReport[];
  readonly startedAt: string;
  readonly endedAt: string;
  /** Wall-clock elapsed time of the replay (ms). */
  readonly elapsedMs: number;
}

// ----------------------------------------------------------------------------
// EventReplayer
// ----------------------------------------------------------------------------

export class EventReplayer {
  constructor(private readonly runtime: PatternRuntime) {}

  /**
   * Replay a sorted list of events through the runtime. Throws if events
   * are not chronologically ordered (a defensive guard — out-of-order
   * replay would corrupt pattern state).
   */
  async replay(
    events: readonly HistoricalEvent[],
    opts: ReplayOptions = {},
  ): Promise<ReplayResult> {
    if (events.length === 0) {
      return {
        eventsReplayed: 0,
        tickReports: [],
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        elapsedMs: 0,
      };
    }

    // Defensive: enforce chronological ordering
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1]!;
      const curr = events[i]!;
      if (Date.parse(curr.timestamp) < Date.parse(prev.timestamp)) {
        throw new Error(
          `EventReplayer.replay: events not chronologically sorted at index ${i} (${prev.timestamp} → ${curr.timestamp})`,
        );
      }
    }

    const carry = opts.carryForwardPrices !== false;
    const lastPrices = new Map<string, number>();
    const reports: TickReport[] = [];
    const wallStart = Date.now();
    const startedAt = new Date().toISOString();
    const log = opts.log ?? (() => {});
    const watched = opts.watchedSymbols ?? [];

    // Preload the price feed once for the full event window, if supported.
    // Doing this here means the per-tick getPriceAt is a cache read.
    if (opts.priceFeed?.preload && watched.length > 0) {
      const fromIso = events[0]!.timestamp;
      const toIso = events[events.length - 1]!.timestamp;
      const summary = await opts.priceFeed.preload([...watched], fromIso, toIso);
      log(
        `event-replayer: priceFeed preloaded ${summary.loaded}/${watched.length}` +
          (summary.failed.length > 0 ? ` (failed: ${summary.failed.join(",")})` : ""),
      );
    }

    for (const ev of events) {
      // Update price book for carry-forward from the event itself
      if (ev.price > 0) lastPrices.set(ev.symbol, ev.price);

      // Enrich with price-feed values for watched symbols at this timestamp.
      // We always re-read so the snapshot reflects the current moment, not
      // the most recent event for that symbol. If the feed has nothing,
      // we fall back to the carry-forward value already in lastPrices.
      if (opts.priceFeed && watched.length > 0) {
        for (const sym of watched) {
          const fed = await opts.priceFeed.getPriceAt(sym, ev.timestamp);
          if (fed !== null && fed > 0) lastPrices.set(sym, fed);
        }
      }

      // Build snapshot. If carry-forward is on, every snapshot carries
      // the most-recent price for every symbol seen so far. Otherwise
      // only the current event's symbol.
      const prices = carry
        ? new Map(lastPrices)
        : new Map<string, number>([[ev.symbol, ev.price]]);

      const snapshot: MarketSnapshot = {
        timestamp: ev.timestamp,
        prices,
        extras: { event: { kind: ev.kind, symbol: ev.symbol, payload: ev.payload } },
      };

      // Update snapshotRef BEFORE the tick so the executor can read it
      // when runtime.tick calls executeFn for an entry. Monitor() reads
      // market.prices directly from the snapshot itself.
      if (opts.snapshotRef) opts.snapshotRef.current = snapshot;

      const report = await this.runtime.tick(snapshot);
      reports.push(report);

      if (opts.onTick) {
        await opts.onTick(ev, report);
      }
    }

    const endedAt = new Date().toISOString();
    return {
      eventsReplayed: events.length,
      tickReports: reports,
      startedAt,
      endedAt,
      elapsedMs: Date.now() - wallStart,
    };
  }
}

// ----------------------------------------------------------------------------
// Synthetic event helpers — for tests + early validation before real
// subgraph integration. These let us verify the runtime end-to-end
// against a hand-curated scenario.
// ----------------------------------------------------------------------------

/**
 * Generate a synthetic stablecoin-depeg scenario:
 *   - peg at 1.00 for warmup minutes
 *   - drops to floorPrice over `dropMinutes`
 *   - holds at floorPrice for `holdMinutes`
 *   - recovers linearly to 1.00 over `recoveryMinutes`
 *   - emits a price tick every `tickIntervalSec` seconds
 *
 * Default profile mirrors the USDC March 2023 event reasonably well
 * (-13% over hours, 72h to recover).
 */
export function syntheticDepegScenario(opts: {
  symbol?: string;
  startIso?: string;
  warmupMinutes?: number;
  dropMinutes?: number;
  floorPrice?: number;
  holdMinutes?: number;
  recoveryMinutes?: number;
  tickIntervalSec?: number;
} = {}): HistoricalEvent[] {
  const symbol = opts.symbol ?? "USDC";
  const startMs = Date.parse(opts.startIso ?? "2026-04-27T20:00:00Z");
  const warmupMin = opts.warmupMinutes ?? 5;
  const dropMin = opts.dropMinutes ?? 60;
  const floor = opts.floorPrice ?? 0.92;
  const holdMin = opts.holdMinutes ?? 240;
  const recoveryMin = opts.recoveryMinutes ?? 720;
  const tickSec = opts.tickIntervalSec ?? 60;
  const tickMs = tickSec * 1000;

  const events: HistoricalEvent[] = [];
  const totalMin = warmupMin + dropMin + holdMin + recoveryMin;
  for (let t = 0; t <= totalMin * 60; t += tickSec) {
    let price: number;
    const minute = t / 60;
    if (minute < warmupMin) {
      price = 1.0;
    } else if (minute < warmupMin + dropMin) {
      const f = (minute - warmupMin) / dropMin;
      price = 1.0 - (1.0 - floor) * f;
    } else if (minute < warmupMin + dropMin + holdMin) {
      price = floor;
    } else {
      const f =
        (minute - warmupMin - dropMin - holdMin) / recoveryMin;
      price = floor + (1.0 - floor) * Math.min(1.0, f);
    }
    events.push({
      timestamp: new Date(startMs + t * 1000).toISOString(),
      symbol,
      price: Math.max(0, Math.min(1.5, price)),
      kind: "stable_price_tick",
      payload: { source: "synthetic", scenario: "depeg" },
    });
  }
  return events;
}
