/**
 * NVR-SPEC-022 — WETH Momentum Breakout backtest
 *
 * The first v22 candle-cadence pattern through the gauntlet WITH real
 * historical prices. Single-asset (WETH) by design — specialist depth
 * over generalist breadth.
 *
 * Procedure:
 *   1. Construct a GeckoTerminalHistoricalFeed at 4h resolution
 *   2. Preload ~90 days of WETH OHLCV from the feed
 *   3. Convert candles → HistoricalEvents (close-time emission)
 *   4. Run them through the PatternRuntime with the new
 *      makeBacktestExecutor (real-price fills via the same feed)
 *   5. Report: triggers, entries, exits-by-reason, realized + unrealized P&L
 *
 * Run:
 *   WETH_BREAKOUT_PATTERN_ENABLED=true npx tsx scripts/backtest-weth-breakout.ts
 *
 * Environment:
 *   WETH_BREAKOUT_PATTERN_ENABLED  required ('true' to fire)
 *   BACKTEST_LOOKBACK_DAYS         default 90
 *   BACKTEST_SLEEVE_USD            default 1000 (paper alpha sleeve)
 *   BACKTEST_SLIPPAGE_BPS          default 25 (0.25% per side)
 *   BACKTEST_VERBOSE               '1' to log every fill
 *
 * Output:
 *   - Per-trigger log
 *   - Per-fill detail
 *   - Final summary: triggers, entries, exits-by-reason, realized P&L,
 *     win rate, avg-win/avg-loss, expectancy
 *   - Verdict block: ship / extend window / kill
 */

import { PatternRegistry } from "../src/core/patterns/registry.js";
import { PatternRuntime } from "../src/core/patterns/runtime.js";
import { wethMomentumBreakoutPattern } from "../src/core/patterns/weth-momentum-breakout.js";
import { EventReplayer } from "../src/simulation/event-replayer.js";
import { GeckoTerminalHistoricalFeed } from "../src/simulation/data/price-feed.js";
import { feedToEvents } from "../src/simulation/data/candle-events.js";
import {
  makeBacktestExecutor,
  makeSnapshotRef,
} from "../src/simulation/backtest-executor.js";
import type { PatternState } from "../src/core/patterns/types.js";

const LOOKBACK_DAYS = parseInt(process.env.BACKTEST_LOOKBACK_DAYS ?? "90", 10);
const PAPER_SLEEVE_USD = parseInt(
  process.env.BACKTEST_SLEEVE_USD ?? "1000",
  10,
);
const SLIPPAGE_BPS = parseInt(process.env.BACKTEST_SLIPPAGE_BPS ?? "25", 10);
const VERBOSE = process.env.BACKTEST_VERBOSE === "1";

async function main() {
  console.log(`\n=== NVR WETH Momentum Breakout Backtest (real prices) ===`);
  console.log(
    `Pattern: ${wethMomentumBreakoutPattern.name}@${wethMomentumBreakoutPattern.version}`,
  );
  console.log(`Window: ${LOOKBACK_DAYS} days on WETH/Base @ 4h candles`);
  console.log(`Paper sleeve: $${PAPER_SLEEVE_USD}`);
  console.log(`Slippage: ${SLIPPAGE_BPS}bps per side`);
  console.log(
    `Trigger gate: ${process.env.WETH_BREAKOUT_PATTERN_ENABLED === "true" ? "OPEN" : "CLOSED"}`,
  );
  console.log("");

  const toIso = new Date().toISOString();
  const fromIso = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000,
  ).toISOString();

  // 1) Construct + preload the price feed at 4h resolution
  console.log(`[1/5] Constructing price feed at 4h resolution...`);
  const priceFeed = new GeckoTerminalHistoricalFeed({
    timeframe: "hour",
    aggregate: 4,
    preferredDex: "aerodrome",
    log: VERBOSE ? (m) => console.log(`    ${m}`) : undefined,
  });
  const preload = await priceFeed.preload(["WETH"], fromIso, toIso);
  console.log(
    `  preloaded: loaded=${preload.loaded} failed=${JSON.stringify(preload.failed)}`,
  );
  if (preload.failed.includes("WETH")) {
    console.error(`  ❌ preload failed for WETH — cannot run backtest`);
    process.exit(1);
  }
  const stats = priceFeed.cacheStats();
  console.log(
    `  cache: ${stats.symbols} symbols, ${stats.candles} candles, ${stats.failed} failed`,
  );

  // 2) Generate candle events
  console.log(`[2/5] Generating candle events...`);
  const events = feedToEvents({
    feed: priceFeed,
    symbol: "WETH",
    fromISO: fromIso,
    toISO: toIso,
  });
  console.log(`  ${events.length} candle events ready for replay`);
  if (events.length === 0) {
    console.error(`  ❌ no events to replay`);
    process.exit(1);
  }
  console.log(
    `  window: ${events[0]!.timestamp} → ${events[events.length - 1]!.timestamp}`,
  );

  // 3) Set up runtime + executor
  console.log(`[3/5] Wiring runtime + price-aware executor...`);
  const registry = new PatternRegistry();
  registry.register(wethMomentumBreakoutPattern, "paper");
  const states: Record<string, PatternState> = {
    [wethMomentumBreakoutPattern.name]: {},
  };

  const snapshotRef = makeSnapshotRef();
  const { executeFn, fills } = makeBacktestExecutor({
    snapshotRef,
    priceFeed,
    slippage: { bps: SLIPPAGE_BPS },
    log: VERBOSE ? (m) => console.log(`    ${m}`) : undefined,
  });

  const runtime = new PatternRuntime(
    registry,
    {
      alphaSleeveUsd: () => PAPER_SLEEVE_USD,
      executeFn,
      loadPatternState: (name) => states[name] ?? {},
    },
    "paper",
  );

  // 4) Replay
  console.log(`[4/5] Replaying ${events.length} candle events...`);
  const replayer = new EventReplayer(runtime);
  let triggersDetected = 0;
  let entered = 0;
  let exited = 0;
  const triggerLog: string[] = [];
  const replayResult = await replayer.replay(events, {
    priceFeed,
    watchedSymbols: ["WETH"],
    snapshotRef,
    onTick: (event, report) => {
      triggersDetected += report.triggersDetected;
      entered += report.entered;
      exited += report.exited;
      if (report.triggersDetected > 0) {
        const p = event.payload as Record<string, unknown> | undefined;
        triggerLog.push(
          `  ${event.timestamp}  close=${(p?.close as number)?.toFixed(2)}  vol=${((p?.volumeUsd as number) / 1e6).toFixed(2)}M`,
        );
      }
    },
  });
  console.log(
    `  replay completed in ${(replayResult.elapsedMs / 1000).toFixed(1)}s`,
  );

  // 5) Report
  console.log(`\n[5/5] Reporting...\n`);
  console.log(`=== Backtest Results ===`);
  console.log(`Window:               ${LOOKBACK_DAYS} days`);
  console.log(`Candles replayed:     ${events.length}`);
  console.log(`Triggers fired:       ${triggersDetected}`);
  console.log(`Pattern entries:      ${entered}`);
  console.log(`Pattern exits:        ${exited}`);
  console.log(`Total fills:          ${fills.length}`);
  console.log(
    `Open positions:       ${runtime.tracker.openPositions(wethMomentumBreakoutPattern.name).length}`,
  );
  const closed = runtime.tracker.closedPositions(
    wethMomentumBreakoutPattern.name,
  );
  console.log(`Closed positions:     ${closed.length}`);

  if (triggerLog.length > 0) {
    console.log(`\n=== Triggered candle closes ===`);
    triggerLog.forEach((l) => console.log(l));
  }

  // Per-pattern stats with real prices
  // Use last seen price as the "current" for unrealized P&L on opens
  const lastPx =
    fills.length > 0 ? fills[fills.length - 1]!.midPrice : undefined;
  const currentPrices = new Map<string, number>(
    lastPx ? [["WETH", lastPx]] : [],
  );
  const stats2 = runtime.tracker.stats(currentPrices);
  if (stats2.length > 0) {
    console.log(`\n=== Per-pattern stats (real-price P&L) ===`);
    for (const s of stats2) {
      console.log(
        `  ${s.patternName}: open=${s.openCount} closed=${s.closedCount} ` +
          `realized=$${s.realizedPnL.toFixed(2)} unrealized=$${s.unrealizedPnL.toFixed(2)} ` +
          `winRate=${(s.winRate * 100).toFixed(0)}%`,
      );
    }
  }

  // Exit-reason histogram
  if (closed.length > 0) {
    const reasonCounts = new Map<string, number>();
    const reasonPnL = new Map<string, number>();
    for (const c of closed) {
      const r = c.closeReason ?? "unknown";
      reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
      reasonPnL.set(r, (reasonPnL.get(r) ?? 0) + (c.realizedPnL ?? 0));
    }
    console.log(`\n=== Exit reason histogram ===`);
    for (const [r, n] of reasonCounts.entries()) {
      const pnl = reasonPnL.get(r) ?? 0;
      console.log(
        `  ${r.padEnd(15)}: ${n} exits, total P&L $${pnl.toFixed(2)}, avg $${(pnl / n).toFixed(2)}`,
      );
    }

    // Win/loss breakdown
    const wins = closed.filter((c) => (c.realizedPnL ?? 0) > 0);
    const losses = closed.filter((c) => (c.realizedPnL ?? 0) < 0);
    const avgWin =
      wins.length > 0
        ? wins.reduce((s, c) => s + (c.realizedPnL ?? 0), 0) / wins.length
        : 0;
    const avgLoss =
      losses.length > 0
        ? losses.reduce((s, c) => s + (c.realizedPnL ?? 0), 0) / losses.length
        : 0;
    const totalPnL = closed.reduce((s, c) => s + (c.realizedPnL ?? 0), 0);
    const winRate = closed.length > 0 ? wins.length / closed.length : 0;
    const expectancy = totalPnL / closed.length;
    console.log(`\n=== Risk/reward ===`);
    console.log(`  Trades:       ${closed.length}`);
    console.log(
      `  Win rate:     ${(winRate * 100).toFixed(0)}% (${wins.length} wins / ${losses.length} losses)`,
    );
    console.log(`  Avg win:      $${avgWin.toFixed(2)}`);
    console.log(`  Avg loss:     $${avgLoss.toFixed(2)}`);
    console.log(`  Risk/reward:  ${avgLoss !== 0 ? Math.abs(avgWin / avgLoss).toFixed(2) : "n/a"}`);
    console.log(`  Total P&L:    $${totalPnL.toFixed(2)}`);
    console.log(`  Expectancy:   $${expectancy.toFixed(2)} per trade`);
  }

  // Per-fill detail (only verbose, since this can be long)
  if (VERBOSE && fills.length > 0) {
    console.log(`\n=== Fill detail (verbose) ===`);
    for (const f of fills) {
      console.log(
        `  ${f.filledAt}  ${f.decision.action.padEnd(4)} WETH ` +
          `usd=${f.filledUsd.toFixed(2)}  fill=${f.filledPrice.toFixed(2)}`,
      );
    }
  }

  // Verdict block — explicit, end-of-day call
  console.log(`\n=== Verdict ===`);
  if (closed.length === 0) {
    console.log(
      `  Pattern fired ${triggersDetected} times but produced 0 closed trades.`,
    );
    console.log(
      `  Window may be too short to observe full holds, or all entries are still`,
    );
    console.log(
      `  open as unrealized. Either way, no edge measurement yet — run again`,
    );
    console.log(
      `  with longer window (BACKTEST_LOOKBACK_DAYS=180) for resolution.`,
    );
  } else if (closed.length < 5) {
    const totalPnL = closed.reduce((s, c) => s + (c.realizedPnL ?? 0), 0);
    console.log(
      `  ${closed.length} closed trades — below the n≥5 minimum for any signal.`,
    );
    console.log(
      `  Total P&L $${totalPnL.toFixed(2)} but sample is too thin to trust.`,
    );
    console.log(
      `  Recommend extending lookback or relaxing trigger thresholds slightly`,
    );
    console.log(
      `  (e.g., LOOKBACK_PERIODS 20→15) to gather more signal events.`,
    );
  } else {
    const totalPnL = closed.reduce((s, c) => s + (c.realizedPnL ?? 0), 0);
    const wins = closed.filter((c) => (c.realizedPnL ?? 0) > 0).length;
    const winRate = wins / closed.length;
    const avgPnL = totalPnL / closed.length;
    if (totalPnL > 0 && winRate >= 0.4) {
      console.log(
        `  ✓ EDGE DETECTED: ${closed.length} trades, ${(winRate * 100).toFixed(0)}% win rate,`,
      );
      console.log(
        `    $${avgPnL.toFixed(2)} avg P&L, $${totalPnL.toFixed(2)} total over ${LOOKBACK_DAYS}d.`,
      );
      console.log(
        `    Recommend graduating from paper → live status with sleeve carve-out.`,
      );
      console.log(
        `    Next: add AI confirm() for conviction sizing, observe out-of-sample.`,
      );
    } else if (totalPnL > 0) {
      console.log(
        `  ⚠ Marginal: ${closed.length} trades, total +$${totalPnL.toFixed(2)} but win rate`,
      );
      console.log(
        `    only ${(winRate * 100).toFixed(0)}%. Edge depends heavily on tails (large wins).`,
      );
      console.log(
        `    Recommend tightening trigger (volume mult 1.5→2.0) or extending lookback.`,
      );
    } else {
      console.log(
        `  ✗ NO EDGE: ${closed.length} trades, total $${totalPnL.toFixed(2)},`,
      );
      console.log(
        `    win rate ${(winRate * 100).toFixed(0)}%, avg $${avgPnL.toFixed(2)} per trade.`,
      );
      console.log(
        `    Pattern as specified does not earn on WETH/Base over ${LOOKBACK_DAYS}d.`,
      );
      console.log(
        `    Either kill or pivot to a different signal (e.g., volume-only,`,
      );
      console.log(
        `    or different lookback period). Document and move on.`,
      );
    }
  }
}

main().catch((err) => {
  console.error("backtest error:", err);
  process.exit(1);
});
