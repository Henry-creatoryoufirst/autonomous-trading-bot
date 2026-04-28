/**
 * NVR-SPEC-022 — Backtest Executor
 *
 * The bridge between the EventReplayer's market snapshots and the
 * PatternRuntime's `executeFn` callback. The runtime calls `executeFn`
 * to fill a TradeDecision; the runtime expects back the actual fill
 * price + size. In production that price comes from on-chain swap
 * settlement; in backtest it comes from this module.
 *
 * The replayer updates `SnapshotRef.current` immediately before calling
 * `runtime.tick(snapshot)`. The executor reads the same ref to get the
 * current snapshot's price for the symbol the decision targets.
 *
 *   replayer ──updates── snapshotRef ──reads── executor
 *                         │
 *                         └── runtime.tick uses the same snapshot for
 *                             monitor() exits, so entry & exit prices
 *                             are sourced from a single coherent view.
 *
 * If the snapshot doesn't have a price (because the symbol isn't in
 * `watchedSymbols` and no event for it has fired yet), the executor
 * falls back to the priceFeed directly. If both fail, the executor
 * throws — better to fail loudly in backtest than silently fill at $0
 * and report fictitious P&L.
 */

import type { MarketSnapshot } from "../core/patterns/types.js";
import type { TradeDecision } from "../core/patterns/trade-decision-shim.js";
import type { RuntimeDeps } from "../core/patterns/runtime.js";
import type { HistoricalPriceFeed } from "./data/price-feed.js";

// ----------------------------------------------------------------------------
// Snapshot ref — a tiny mutable container the EventReplayer updates per tick
// ----------------------------------------------------------------------------

/**
 * A single-cell mutable reference to the "current snapshot" that the
 * EventReplayer is processing. The executor reads from `current` to
 * resolve fill prices.
 *
 * Why a ref and not a global / not the runtime: the runtime is meant to
 * be a pure orchestrator that doesn't know it's being driven by a
 * replayer. The ref keeps backtest plumbing out of runtime/types.
 */
export interface SnapshotRef {
  current: MarketSnapshot | null;
}

export function makeSnapshotRef(): SnapshotRef {
  return { current: null };
}

// ----------------------------------------------------------------------------
// Slippage model
// ----------------------------------------------------------------------------

/**
 * Slippage model for the backtest fill. Default is "none" (perfect fill).
 *
 * For BUYs the executor pays a slightly worse price (mid + slippage) and
 * for SELLs it receives a slightly worse price (mid − slippage). This is
 * a deliberately simple model — pattern-grade backtests aren't trying
 * to model microstructure, just to honestly account for the cost of
 * touching a DEX.
 */
export interface SlippageModel {
  /** BUY pays mid * (1 + bps/10000); SELL receives mid * (1 − bps/10000). */
  bps: number;
}

export const NO_SLIPPAGE: SlippageModel = { bps: 0 };

// ----------------------------------------------------------------------------
// Executor factory
// ----------------------------------------------------------------------------

export interface BacktestExecutorOptions {
  /** Snapshot ref maintained by the EventReplayer. */
  snapshotRef: SnapshotRef;
  /** Optional fallback price feed. Used when the snapshot's prices map
   *  doesn't have the target symbol. */
  priceFeed?: HistoricalPriceFeed;
  /** Slippage model. Default no slippage. */
  slippage?: SlippageModel;
  /** If provided, the executor pushes every decision here (helpful for
   *  test assertions and per-pattern attribution checks). */
  fills?: ExecutorFill[];
  /** Logger for misses; default no-op. */
  log?: (msg: string) => void;
}

/**
 * Record of a single fill the executor emitted. Useful for test
 * assertions ("did we fill at the expected price?") and for
 * post-backtest analysis ("which patterns paid the most slippage?").
 */
export interface ExecutorFill {
  decision: TradeDecision;
  filledPrice: number;
  filledUsd: number;
  /** ISO timestamp of the fill (from the snapshot). */
  filledAt: string;
  /** Mid price before slippage was applied. Useful for slippage analysis. */
  midPrice: number;
}

/**
 * Build an `executeFn` for `RuntimeDeps` that fills using historical
 * prices supplied by the replayer's snapshot (and optionally a fallback
 * feed). Returns the function plus the running fills list (the same
 * array passed in, or a fresh one if none).
 */
export function makeBacktestExecutor(opts: BacktestExecutorOptions): {
  executeFn: RuntimeDeps["executeFn"];
  fills: ExecutorFill[];
} {
  const ref = opts.snapshotRef;
  const slip = opts.slippage ?? NO_SLIPPAGE;
  const fills = opts.fills ?? [];
  const log = opts.log ?? (() => {});

  const executeFn: RuntimeDeps["executeFn"] = async (decision: TradeDecision) => {
    const snap = ref.current;
    if (!snap) {
      throw new Error(
        "BacktestExecutor: no current snapshot — was EventReplayer.replay() started with the same SnapshotRef?",
      );
    }

    // Determine the symbol whose price we need. For a BUY, it's the
    // token being bought; for a SELL, it's the token being sold.
    const symbol = decision.action === "BUY" ? decision.toToken : decision.fromToken;

    // 1) Snapshot prices first (no I/O, fastest).
    let mid = snap.prices.get(symbol);

    // 2) Fall back to the price feed (cache-only after preload).
    if (!mid || mid <= 0) {
      if (opts.priceFeed) {
        const fed = await opts.priceFeed.getPriceAt(symbol, snap.timestamp);
        if (fed && fed > 0) mid = fed;
      }
    }

    // 3) USDC is always $1 in this venue (stable on Base; depeg backtests
    // override via snapshot). This avoids needing a USDC pool fetch just
    // to confirm the obvious.
    if ((!mid || mid <= 0) && symbol === "USDC") mid = 1.0;

    if (!mid || mid <= 0) {
      throw new Error(
        `BacktestExecutor: no price for ${symbol} at ${snap.timestamp} ` +
          `(snapshot prices=${snap.prices.size}, decision=${decision.action} ` +
          `${decision.fromToken}→${decision.toToken})`,
      );
    }

    // Apply slippage.
    const slipFactor = 1 + (slip.bps / 10_000) * (decision.action === "BUY" ? 1 : -1);
    const filledPrice = mid * slipFactor;
    const filledUsd = decision.amountUSD;

    const fill: ExecutorFill = {
      decision,
      filledPrice,
      filledUsd,
      filledAt: snap.timestamp,
      midPrice: mid,
    };
    fills.push(fill);
    log(
      `executor: ${decision.action} ${symbol} usd=${filledUsd.toFixed(2)} ` +
        `mid=${mid.toFixed(6)} fill=${filledPrice.toFixed(6)} @ ${snap.timestamp}`,
    );

    return {
      filledUsd,
      filledPrice,
      // No txHash in backtest; executors that simulate finality can fill it.
    };
  };

  return { executeFn, fills };
}
