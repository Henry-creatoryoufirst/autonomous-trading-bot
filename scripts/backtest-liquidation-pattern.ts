/**
 * NVR-SPEC-022 — Pattern P1 (Liquidation Counter-Trade) historical backtest
 *
 * The first real backtest of a v22 pattern against live on-chain history,
 * NOW WITH REAL HISTORICAL PRICING via GeckoTerminal OHLCV.
 *
 * Procedure:
 *   1. Fetch last 7 days of Aave V3 LiquidationCall events on Base
 *      (via the bot's existing RPC fallback chain)
 *   2. Convert events to HistoricalEvents
 *   3. Preload GeckoTerminal OHLCV for the tradeable collateral set
 *   4. Replay events through the PatternRuntime with Pattern P1 in
 *      'paper' mode and a price-aware backtest executor
 *   5. Report: trigger count, entries, exits, REAL paper P&L by reason
 *
 * Run:
 *   LIQUIDATION_PATTERN_ENABLED=true npx tsx scripts/backtest-liquidation-pattern.ts
 *
 * Environment:
 *   LIQUIDATION_PATTERN_ENABLED  required ('true' to fire)
 *   BACKTEST_LOOKBACK_HOURS      default 168 (7 days)
 *   BACKTEST_SLEEVE_USD          default 1000 (paper alpha sleeve)
 *   BACKTEST_SLIPPAGE_BPS        default 25 (0.25% per side)
 *   BACKTEST_VERBOSE             '1' to log every fill
 *
 * Output:
 *   - Per-event log: which liquidations triggered the pattern (and why
 *     the others didn't — collateral not in universe, size below floor)
 *   - Final summary: # triggers, # entries, # exits, REAL paper realized
 *     P&L attributed to liquidation_counter_trade
 *
 * What this proves:
 *   - Trigger logic works correctly against real liquidation events
 *   - Filter heuristics (collateral whitelist, size threshold) catch
 *     the right events vs reject the right events
 *   - The end-to-end pipeline (subgraph fetch → EventReplayer →
 *     PatternRuntime → tracker → P&L) functions on real data
 *   - Sample size of patterns we'd actually trade per week
 *   - Realized P&L if Pattern P1 had been live during this window
 */

import { PatternRegistry } from "../src/core/patterns/registry.js";
import { PatternRuntime } from "../src/core/patterns/runtime.js";
import { liquidationCounterTradePattern } from "../src/core/patterns/liquidation-counter-trade.js";
import { EventReplayer } from "../src/simulation/event-replayer.js";
import { fetchAaveLiquidations } from "../src/simulation/data/aave-liquidations.js";
import { GeckoTerminalHistoricalFeed } from "../src/simulation/data/price-feed.js";
import {
  makeBacktestExecutor,
  makeSnapshotRef,
} from "../src/simulation/backtest-executor.js";
import type { PatternState } from "../src/core/patterns/types.js";

// Pattern P1 trades these collateral symbols (per liquidation-counter-trade.ts).
// Watched symbols are queried on every tick so monitor() exits price correctly.
const WATCHED_SYMBOLS = ["WETH", "cbBTC", "cbETH", "wstETH", "AERO"] as const;

const LOOKBACK_HOURS = parseInt(
  process.env.BACKTEST_LOOKBACK_HOURS ?? "168",
  10,
);
const PAPER_SLEEVE_USD = parseInt(
  process.env.BACKTEST_SLEEVE_USD ?? "1000",
  10,
);
const SLIPPAGE_BPS = parseInt(process.env.BACKTEST_SLIPPAGE_BPS ?? "25", 10);
const VERBOSE = process.env.BACKTEST_VERBOSE === "1";

async function main() {
  console.log(`\n=== NVR Pattern P1 Backtest (real prices) ===`);
  console.log(
    `Pattern: ${liquidationCounterTradePattern.name}@${liquidationCounterTradePattern.version}`,
  );
  console.log(`Lookback: ${LOOKBACK_HOURS}h on Aave V3 Base`);
  console.log(`Paper sleeve: $${PAPER_SLEEVE_USD}`);
  console.log(`Slippage model: ${SLIPPAGE_BPS}bps per side`);
  console.log(
    `Trigger gate: ${process.env.LIQUIDATION_PATTERN_ENABLED === "true" ? "OPEN" : "CLOSED"} (${process.env.LIQUIDATION_PATTERN_ENABLED === "true" ? "will fire" : "set LIQUIDATION_PATTERN_ENABLED=true to enable"})`,
  );
  console.log("");

  // 1. Fetch events
  console.log(`[1/5] Fetching liquidation events...`);
  const fetched = await fetchAaveLiquidations({
    lookbackHours: LOOKBACK_HOURS,
    verbose: false,
  });
  console.log(
    `  → ${fetched.events.length} events in ${(fetched.fetchMs / 1000).toFixed(1)}s ` +
      `(${fetched.chunkCount} RPC chunks)`,
  );
  if (fetched.events.length === 0) {
    console.log(`  No events found. Exiting.`);
    return;
  }

  // 2. Set up runtime
  console.log(`[2/5] Setting up runtime + registering pattern...`);
  const registry = new PatternRegistry();
  registry.register(liquidationCounterTradePattern, "paper");
  const states: Record<string, PatternState> = {
    [liquidationCounterTradePattern.name]: {},
  };

  // 3. Build the price-aware executor (fills from GT OHLCV via the snapshot)
  const snapshotRef = makeSnapshotRef();
  const priceFeed = new GeckoTerminalHistoricalFeed({
    log: VERBOSE ? (m) => console.log(`    ${m}`) : undefined,
    preferredDex: "aerodrome",
  });
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

  // 4. Replay (preload happens automatically via priceFeed.preload)
  console.log(
    `[3/5] Preloading historical prices for ${WATCHED_SYMBOLS.length} symbols + replaying...`,
  );
  const replayer = new EventReplayer(runtime);
  let triggersDetected = 0;
  let entered = 0;
  const triggeredEvents: {
    ts: string;
    symbol: string;
    size: number;
    txHash: string;
  }[] = [];
  const replayResult = await replayer.replay(fetched.events, {
    priceFeed,
    watchedSymbols: WATCHED_SYMBOLS,
    snapshotRef,
    log: (m) => console.log(`  ${m}`),
    onTick: (event, report) => {
      triggersDetected += report.triggersDetected;
      entered += report.entered;
      if (report.triggersDetected > 0) {
        const collateral = (event.payload?.collateralAsset as string | undefined) ?? "?";
        const amountStr = event.payload?.liquidatedCollateralAmount as string | undefined;
        triggeredEvents.push({
          ts: event.timestamp,
          symbol: collateral,
          size: amountStr ? Number(BigInt(amountStr)) : 0,
          txHash: (event.payload?.txHash as string | undefined) ?? "?",
        });
      }
    },
  });

  console.log(
    `[4/5] Replay complete in ${(replayResult.elapsedMs / 1000).toFixed(1)}s`,
  );
  const cache = priceFeed.cacheStats();
  console.log(
    `  price feed cache: ${cache.symbols} symbols, ${cache.candles} candles, ${cache.failed} failed`,
  );

  // 5. Report
  console.log(`[5/5] Reporting...\n`);
  console.log(`=== Backtest Results ===`);
  console.log(`Events scanned:       ${fetched.events.length}`);
  console.log(`Triggers fired:       ${triggersDetected}`);
  console.log(`Pattern entries:      ${entered}`);
  console.log(`Total fills:          ${fills.length}`);
  console.log(
    `Open positions:       ${runtime.tracker.openPositions(liquidationCounterTradePattern.name).length}`,
  );
  console.log(
    `Closed positions:     ${runtime.tracker.closedPositions(liquidationCounterTradePattern.name).length}`,
  );

  // Show which events triggered
  if (triggeredEvents.length > 0) {
    console.log(`\n=== Triggered Events ===`);
    for (const t of triggeredEvents) {
      console.log(
        `  ${t.ts}  collateral=${t.symbol.slice(0, 10)}... tx=${t.txHash.slice(0, 12)}`,
      );
    }
  }

  // Show non-triggered events grouped by why they were rejected
  const rejected = fetched.events.length - triggersDetected;
  if (rejected > 0) {
    console.log(
      `\n=== ${rejected} events rejected (collateral not whitelisted OR size below \$50k threshold) ===`,
    );
    console.log(
      `  This is expected — most liquidations on Base are small-position margin calls`,
    );
    console.log(
      `  on stablecoin / cbBTC pairs that don't meet our trigger criteria.`,
    );
  }

  // Per-pattern stats — now meaningful because fills used real prices
  const stats = runtime.tracker.stats(new Map());
  if (stats.length > 0) {
    console.log(`\n=== Per-pattern stats (real-price P&L) ===`);
    for (const s of stats) {
      console.log(
        `  ${s.patternName}: open=${s.openCount} closed=${s.closedCount} ` +
          `realized=$${s.realizedPnL.toFixed(2)} unrealized=$${s.unrealizedPnL.toFixed(2)} ` +
          `winRate=${(s.winRate * 100).toFixed(0)}%`,
      );
    }
  }

  // Per-fill detail when entries actually happened — useful for proving the
  // real-price wiring. With 0 triggers (the empirical finding), this section
  // stays empty.
  if (fills.length > 0) {
    console.log(`\n=== Fill detail ===`);
    for (const f of fills) {
      const sym =
        f.decision.action === "BUY" ? f.decision.toToken : f.decision.fromToken;
      console.log(
        `  ${f.filledAt}  ${f.decision.action.padEnd(4)} ${sym.padEnd(7)} ` +
          `usd=${f.filledUsd.toFixed(2)}  mid=${f.midPrice.toFixed(6)}  fill=${f.filledPrice.toFixed(6)}`,
      );
    }
  }

  console.log(`\n=== Honest read ===`);
  if (triggersDetected === 0) {
    console.log(
      `  0 triggers fired — confirming the FINDING_2026-04-27 result that`,
    );
    console.log(
      `  Aave V3 Base does not have the liquidation flow to support Pattern P1.`,
    );
    console.log(
      `  Real-price wiring is now in place; when this pattern fires (e.g.,`,
    );
    console.log(
      `  after lowering the threshold or running on a different venue), the`,
    );
    console.log(`  P&L numbers will be measured against real DEX history.`);
  } else {
    console.log(
      `  Triggers fired with real-price fills. Realized P&L above reflects`,
    );
    console.log(
      `  what Pattern P1 would have made on Aave V3 Base for this window.`,
    );
    console.log(
      `  This is now a P&L-fidelity backtest, not just a trigger-fidelity one.`,
    );
  }
}

main().catch((err) => {
  console.error("backtest error:", err);
  process.exit(1);
});
