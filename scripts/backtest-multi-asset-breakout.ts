/**
 * NVR-SPEC-022 — Multi-asset momentum breakout backtest
 *
 * Same mechanism as `backtest-weth-breakout.ts` but applied across the
 * top 3-5 high-volume Base assets simultaneously. Per
 * `feedback_specialist_depth_beats_breadth`: keep the universe SMALL —
 * not "all of crypto." Default universe: WETH, cbBTC, AERO.
 *
 * Why multi-asset: a single-asset 90-day window produced n=7 closed trades
 * — below CRITIC's n≥20 statistical-power floor. Three assets multiplies
 * the sample without diluting the specialist thesis.
 *
 * Run:
 *   MOMENTUM_BREAKOUT_PATTERN_ENABLED=true \
 *     npx tsx scripts/backtest-multi-asset-breakout.ts
 *
 * Environment:
 *   MOMENTUM_BREAKOUT_PATTERN_ENABLED  required
 *   BACKTEST_LOOKBACK_DAYS             default 90
 *   BACKTEST_SLEEVE_USD                default 1000
 *   BACKTEST_SLIPPAGE_BPS              default 25
 *   BACKTEST_SYMBOLS                   default 'WETH,cbBTC,AERO'
 *   BACKTEST_VERBOSE                   '1' to log every fill
 */

import { PatternRegistry } from "../src/core/patterns/registry.js";
import { PatternRuntime } from "../src/core/patterns/runtime.js";
import { createMomentumBreakoutPattern } from "../src/core/patterns/weth-momentum-breakout.js";
import { EventReplayer } from "../src/simulation/event-replayer.js";
import { GeckoTerminalHistoricalFeed } from "../src/simulation/data/price-feed.js";
import { feedToEvents } from "../src/simulation/data/candle-events.js";
import {
  makeBacktestExecutor,
  makeSnapshotRef,
} from "../src/simulation/backtest-executor.js";
import type { HistoricalEvent } from "../src/simulation/event-replayer.js";
import type { PatternState } from "../src/core/patterns/types.js";

const LOOKBACK_DAYS = parseInt(process.env.BACKTEST_LOOKBACK_DAYS ?? "90", 10);
const PAPER_SLEEVE_USD = parseInt(
  process.env.BACKTEST_SLEEVE_USD ?? "1000",
  10,
);
const SLIPPAGE_BPS = parseInt(process.env.BACKTEST_SLIPPAGE_BPS ?? "25", 10);
const VERBOSE = process.env.BACKTEST_VERBOSE === "1";
const SYMBOLS = (process.env.BACKTEST_SYMBOLS ?? "WETH,cbBTC,AERO")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function mergeChronological(eventArrays: HistoricalEvent[][]): HistoricalEvent[] {
  const out: HistoricalEvent[] = [];
  for (const arr of eventArrays) out.push(...arr);
  out.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return out;
}

async function main() {
  console.log(`\n=== NVR Multi-Asset Momentum Breakout Backtest ===`);
  console.log(`Symbols: ${SYMBOLS.join(", ")}`);
  console.log(`Window: ${LOOKBACK_DAYS} days @ 4h candles`);
  console.log(`Paper sleeve: $${PAPER_SLEEVE_USD}  Slippage: ${SLIPPAGE_BPS}bps`);
  console.log(
    `Trigger gate: ${process.env.MOMENTUM_BREAKOUT_PATTERN_ENABLED === "true" ? "OPEN" : "CLOSED"}`,
  );
  console.log("");

  const toIso = new Date().toISOString();
  const fromIso = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000,
  ).toISOString();

  // 1) Construct + preload feed
  console.log(`[1/5] Preloading ${SYMBOLS.length}-asset feed @ 4h...`);
  const priceFeed = new GeckoTerminalHistoricalFeed({
    timeframe: "hour",
    aggregate: 4,
    preferredDex: "aerodrome",
    log: VERBOSE ? (m) => console.log(`    ${m}`) : undefined,
  });
  const preload = await priceFeed.preload(SYMBOLS, fromIso, toIso);
  console.log(
    `  loaded=${preload.loaded}/${SYMBOLS.length} failed=${JSON.stringify(preload.failed)}`,
  );
  const successfulSymbols = SYMBOLS.filter((s) => !preload.failed.includes(s));
  if (successfulSymbols.length === 0) {
    console.error(`  ❌ no symbols preloaded successfully`);
    process.exit(1);
  }
  const cache = priceFeed.cacheStats();
  console.log(
    `  cache: ${cache.symbols} symbols, ${cache.candles} total candles`,
  );

  // 2) Generate per-asset events, merge
  console.log(`[2/5] Generating + merging candle events...`);
  const perAssetEvents: HistoricalEvent[][] = [];
  for (const sym of successfulSymbols) {
    try {
      const events = feedToEvents({
        feed: priceFeed,
        symbol: sym,
        fromISO: fromIso,
        toISO: toIso,
      });
      console.log(`  ${sym}: ${events.length} events`);
      perAssetEvents.push(events);
    } catch (e: unknown) {
      console.warn(`  ${sym}: feedToEvents failed: ${(e as Error).message}`);
    }
  }
  const events = mergeChronological(perAssetEvents);
  console.log(`  merged: ${events.length} total events chronologically`);

  // 3) Set up runtime + register pattern per successful asset
  console.log(`[3/5] Wiring runtime + per-asset patterns...`);
  const registry = new PatternRegistry();
  const states: Record<string, PatternState> = {};
  for (const sym of successfulSymbols) {
    const sector =
      sym === "WETH" || sym === "cbBTC" ? "BLUE_CHIP" : "DEFI";
    const p = createMomentumBreakoutPattern({ symbol: sym, sector });
    registry.register(p, "paper");
    states[p.name] = {};
  }

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
  console.log(`[4/5] Replaying ${events.length} candle events through runtime...`);
  const replayer = new EventReplayer(runtime);
  let triggersDetected = 0;
  let entered = 0;
  let exited = 0;
  const replayResult = await replayer.replay(events, {
    priceFeed,
    watchedSymbols: successfulSymbols,
    snapshotRef,
    onTick: (_event, report) => {
      triggersDetected += report.triggersDetected;
      entered += report.entered;
      exited += report.exited;
    },
  });
  console.log(
    `  replay completed in ${(replayResult.elapsedMs / 1000).toFixed(1)}s`,
  );

  // 5) Report — per-asset breakdown + aggregate
  console.log(`\n[5/5] Reporting...\n`);
  console.log(`=== Aggregate Backtest Results ===`);
  console.log(`Window:               ${LOOKBACK_DAYS} days`);
  console.log(`Assets:               ${successfulSymbols.join(", ")}`);
  console.log(`Candles replayed:     ${events.length}`);
  console.log(`Triggers fired:       ${triggersDetected}`);
  console.log(`Pattern entries:      ${entered}`);
  console.log(`Pattern exits:        ${exited}`);
  console.log(`Total fills:          ${fills.length}`);

  // Build last-price map for unrealized P&L
  const lastPrices = new Map<string, number>();
  for (const f of fills) {
    const sym = f.decision.action === "BUY" ? f.decision.toToken : f.decision.fromToken;
    lastPrices.set(sym, f.midPrice);
  }
  const stats = runtime.tracker.stats(lastPrices);

  console.log(`\n=== Per-asset stats (real-price P&L) ===`);
  let aggClosed = 0;
  let aggWins = 0;
  let aggRealized = 0;
  let aggUnrealized = 0;
  for (const s of stats) {
    console.log(
      `  ${s.patternName.padEnd(28)}: open=${s.openCount} closed=${s.closedCount} ` +
        `realized=$${s.realizedPnL.toFixed(2)} unrealized=$${s.unrealizedPnL.toFixed(2)} ` +
        `winRate=${(s.winRate * 100).toFixed(0)}%`,
    );
    aggClosed += s.closedCount;
    aggWins += Math.round(s.winRate * s.closedCount);
    aggRealized += s.realizedPnL;
    aggUnrealized += s.unrealizedPnL;
  }
  const aggWinRate = aggClosed > 0 ? aggWins / aggClosed : 0;
  console.log(
    `  ${"AGGREGATE".padEnd(28)}: closed=${aggClosed} ` +
      `realized=$${aggRealized.toFixed(2)} unrealized=$${aggUnrealized.toFixed(2)} ` +
      `winRate=${(aggWinRate * 100).toFixed(0)}%`,
  );

  // Aggregate exit-reason histogram across all patterns
  const reasonCounts = new Map<string, number>();
  const reasonPnL = new Map<string, number>();
  for (const sym of successfulSymbols) {
    const closed = runtime.tracker.closedPositions(
      `${sym.toLowerCase()}_momentum_breakout`,
    );
    for (const c of closed) {
      const r = c.closeReason ?? "unknown";
      reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
      reasonPnL.set(r, (reasonPnL.get(r) ?? 0) + (c.realizedPnL ?? 0));
    }
  }
  if (reasonCounts.size > 0) {
    console.log(`\n=== Aggregate exit-reason histogram ===`);
    for (const [r, n] of reasonCounts.entries()) {
      const pnl = reasonPnL.get(r) ?? 0;
      console.log(
        `  ${r.padEnd(15)}: ${n} exits, total P&L $${pnl.toFixed(2)}, avg $${(pnl / n).toFixed(2)}`,
      );
    }
  }

  // Verdict
  console.log(`\n=== Verdict ===`);
  const expectancy = aggClosed > 0 ? aggRealized / aggClosed : 0;
  if (aggClosed === 0) {
    console.log(`  No closed trades — sample empty. Extend window or check feed coverage.`);
  } else if (aggClosed < 20) {
    console.log(
      `  ${aggClosed} closed trades — below n≥20 statistical-power floor.`,
    );
    console.log(
      `  Aggregate P&L $${aggRealized.toFixed(2)}, win rate ${(aggWinRate * 100).toFixed(0)}%, ` +
        `expectancy $${expectancy.toFixed(2)}/trade.`,
    );
    console.log(`  Recommend extending window (BACKTEST_LOOKBACK_DAYS=180) before final call.`);
  } else if (aggRealized > 0 && aggWinRate >= 0.4) {
    console.log(
      `  ✓ EDGE DETECTED across ${successfulSymbols.length} assets:`,
    );
    console.log(
      `    ${aggClosed} trades, ${(aggWinRate * 100).toFixed(0)}% win rate, $${expectancy.toFixed(2)}/trade,`,
    );
    console.log(
      `    $${aggRealized.toFixed(2)} total realized over ${LOOKBACK_DAYS}d.`,
    );
    console.log(`    Recommend graduating to live status with sleeve carve-out.`);
  } else if (aggRealized > 0) {
    console.log(
      `  ⚠ Marginal: ${aggClosed} trades, +$${aggRealized.toFixed(2)} but win rate only ${(aggWinRate * 100).toFixed(0)}%.`,
    );
    console.log(
      `    Edge depends on rare large wins. Tighten triggers or extend window.`,
    );
  } else {
    console.log(
      `  ✗ NO EDGE: ${aggClosed} trades, $${aggRealized.toFixed(2)}, win rate ${(aggWinRate * 100).toFixed(0)}%, ` +
        `expectancy $${expectancy.toFixed(2)}/trade.`,
    );
    console.log(
      `    Mechanism does not earn on this universe at this parameter set.`,
    );
    console.log(
      `    Per feedback_data_driven_delete: kill, don't tune. Document and pivot to next pattern.`,
    );
  }
}

main().catch((err) => {
  console.error("multi-asset backtest error:", err);
  process.exit(1);
});
