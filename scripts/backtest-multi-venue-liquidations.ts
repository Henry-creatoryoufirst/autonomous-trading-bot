/**
 * NVR-SPEC-022 — Pattern P1 multi-venue backtest (Aave V3 + Morpho Blue, Base)
 *
 * The follow-up to FINDING_2026-04-27 (Aave-only Base flow too thin).
 * Aggregates LiquidationCall events from Aave V3 with Liquidate events
 * from Morpho Blue, runs them chronologically through the same Pattern P1
 * (`liquidation_counter_trade`), and answers the question:
 *
 *   "Does combined Aave + Morpho flow on Base have enough $50k+ events
 *    to support Pattern P1 in production?"
 *
 * Runs with the new GeckoTerminal real-price wiring, so any fills produce
 * real-price-grounded P&L (not synthetic).
 *
 * Run:
 *   LIQUIDATION_PATTERN_ENABLED=true \
 *     npx tsx scripts/backtest-multi-venue-liquidations.ts
 *
 * Environment:
 *   LIQUIDATION_PATTERN_ENABLED  required ('true' to fire)
 *   BACKTEST_LOOKBACK_HOURS      default 168 (7 days)
 *   BACKTEST_SLEEVE_USD          default 1000
 *   BACKTEST_SLIPPAGE_BPS        default 25
 *   BACKTEST_VERBOSE             '1' to log every fill
 */

import { PatternRegistry } from "../src/core/patterns/registry.js";
import { PatternRuntime } from "../src/core/patterns/runtime.js";
import { liquidationCounterTradePattern } from "../src/core/patterns/liquidation-counter-trade.js";
import { EventReplayer } from "../src/simulation/event-replayer.js";
import { fetchAaveLiquidations } from "../src/simulation/data/aave-liquidations.js";
import { fetchMorphoLiquidations } from "../src/simulation/data/morpho-liquidations.js";
import { GeckoTerminalHistoricalFeed } from "../src/simulation/data/price-feed.js";
import {
  makeBacktestExecutor,
  makeSnapshotRef,
} from "../src/simulation/backtest-executor.js";
import type { HistoricalEvent } from "../src/simulation/event-replayer.js";
import type { PatternState } from "../src/core/patterns/types.js";

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

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Merge two pre-sorted event arrays into one chronologically-ordered list. */
function mergeChronological(
  a: readonly HistoricalEvent[],
  b: readonly HistoricalEvent[],
): HistoricalEvent[] {
  const out: HistoricalEvent[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ta = Date.parse(a[i]!.timestamp);
    const tb = Date.parse(b[j]!.timestamp);
    if (ta <= tb) out.push(a[i++]!);
    else out.push(b[j++]!);
  }
  while (i < a.length) out.push(a[i++]!);
  while (j < b.length) out.push(b[j++]!);
  return out;
}

function bucketByVenue(events: readonly HistoricalEvent[]): {
  aave: number;
  morpho: number;
  other: number;
} {
  let aave = 0;
  let morpho = 0;
  let other = 0;
  for (const e of events) {
    if (e.kind === "aave_liquidation") aave++;
    else if (e.kind === "morpho_liquidation") morpho++;
    else other++;
  }
  return { aave, morpho, other };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log(`\n=== NVR Pattern P1 Multi-Venue Backtest (Aave + Morpho, real prices) ===`);
  console.log(
    `Pattern: ${liquidationCounterTradePattern.name}@${liquidationCounterTradePattern.version}`,
  );
  console.log(`Lookback: ${LOOKBACK_HOURS}h on Aave V3 + Morpho Blue (Base)`);
  console.log(`Paper sleeve: $${PAPER_SLEEVE_USD}`);
  console.log(`Slippage: ${SLIPPAGE_BPS}bps`);
  console.log(
    `Trigger gate: ${process.env.LIQUIDATION_PATTERN_ENABLED === "true" ? "OPEN" : "CLOSED"}`,
  );
  console.log("");

  // 1. Fetch from both venues in parallel
  console.log(`[1/5] Fetching liquidation events from both venues...`);
  const [aaveResult, morphoResult] = await Promise.all([
    fetchAaveLiquidations({ lookbackHours: LOOKBACK_HOURS, verbose: false }),
    fetchMorphoLiquidations({ lookbackHours: LOOKBACK_HOURS, verbose: false }),
  ]);
  console.log(
    `  Aave:   ${aaveResult.events.length} events in ${(aaveResult.fetchMs / 1000).toFixed(1)}s ` +
      `(${aaveResult.chunkCount} chunks)`,
  );
  console.log(
    `  Morpho: ${morphoResult.events.length} events in ${(morphoResult.fetchMs / 1000).toFixed(1)}s ` +
      `(${morphoResult.chunkCount} chunks, ${morphoResult.marketsResolved} markets resolved)`,
  );

  // 2. Merge chronologically
  console.log(`[2/5] Merging events chronologically...`);
  const events = mergeChronological(aaveResult.events, morphoResult.events);
  const buckets = bucketByVenue(events);
  console.log(
    `  Total: ${events.length} events (Aave=${buckets.aave}, Morpho=${buckets.morpho}, other=${buckets.other})`,
  );
  if (events.length === 0) {
    console.log(`  No events found in either venue. Exiting.`);
    return;
  }

  // 3. Set up runtime with real-price executor
  console.log(`[3/5] Setting up runtime + price feed + executor...`);
  const registry = new PatternRegistry();
  registry.register(liquidationCounterTradePattern, "paper");
  const states: Record<string, PatternState> = {
    [liquidationCounterTradePattern.name]: {},
  };

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

  // 4. Replay (preload runs automatically inside replay)
  console.log(`[4/5] Preloading prices + replaying...`);
  const replayer = new EventReplayer(runtime);
  let triggersDetected = 0;
  let entered = 0;
  const triggeredEvents: {
    ts: string;
    venue: string;
    symbol: string;
    txHash: string;
  }[] = [];
  const replayResult = await replayer.replay(events, {
    priceFeed,
    watchedSymbols: WATCHED_SYMBOLS,
    snapshotRef,
    log: (m) => console.log(`  ${m}`),
    onTick: (event, report) => {
      triggersDetected += report.triggersDetected;
      entered += report.entered;
      if (report.triggersDetected > 0) {
        const venue = event.kind.replace("_liquidation", "");
        const collateral =
          (event.payload?.collateralAsset as string | undefined) ?? "?";
        triggeredEvents.push({
          ts: event.timestamp,
          venue,
          symbol: collateral,
          txHash: (event.payload?.txHash as string | undefined) ?? "?",
        });
      }
    },
  });

  console.log(
    `  replay completed in ${(replayResult.elapsedMs / 1000).toFixed(1)}s`,
  );

  // 5. Report
  console.log(`\n[5/5] Reporting...\n`);
  console.log(`=== Combined Backtest Results ===`);
  console.log(`Window:               ${LOOKBACK_HOURS}h`);
  console.log(`Total events:         ${events.length}`);
  console.log(`  - Aave V3:          ${buckets.aave}`);
  console.log(`  - Morpho Blue:      ${buckets.morpho}`);
  console.log(`Triggers fired:       ${triggersDetected}`);
  console.log(`Pattern entries:      ${entered}`);
  console.log(`Total fills:          ${fills.length}`);
  console.log(
    `Open positions:       ${runtime.tracker.openPositions(liquidationCounterTradePattern.name).length}`,
  );
  console.log(
    `Closed positions:     ${runtime.tracker.closedPositions(liquidationCounterTradePattern.name).length}`,
  );

  if (triggeredEvents.length > 0) {
    console.log(`\n=== Triggered Events (by venue) ===`);
    for (const t of triggeredEvents) {
      console.log(
        `  ${t.ts}  venue=${t.venue.padEnd(7)} collateral=${t.symbol.slice(0, 14)}... tx=${t.txHash.slice(0, 12)}`,
      );
    }
  }

  // Per-pattern stats — meaningful with real prices
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

  // Per-fill detail when entries actually happened
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

  // Honest verdict — what does the data say?
  console.log(`\n=== Verdict ===`);
  if (triggersDetected === 0) {
    console.log(
      `  Pattern P1 fires 0 times across ${events.length} events from BOTH venues over`,
    );
    console.log(
      `  ${LOOKBACK_HOURS}h. The FINDING_2026-04-27 conclusion stands: Base liquidation`,
    );
    console.log(
      `  flow is structurally too thin for Pattern P1 at the $50k threshold —`,
    );
    console.log(
      `  adding Morpho doesn't change the answer. Recommend demoting P1 from the`,
    );
    console.log(
      `  v22 priority list and replacing with a different pattern shape.`,
    );
  } else if (triggersDetected < 5) {
    console.log(
      `  Pattern P1 fires ${triggersDetected} times across ${events.length} events from`,
    );
    console.log(
      `  both venues over ${LOOKBACK_HOURS}h. Below the n≥20 statistical-power floor`,
    );
    console.log(
      `  CRITIC requires; sample size still inadequate for confidence-gating.`,
    );
    console.log(
      `  Recommend either (a) extending lookback to 30+ days, or (b) adding a`,
    );
    console.log(
      `  third venue (Compound V3 / cross-chain) before treating this as live-ready.`,
    );
  } else {
    console.log(
      `  Pattern P1 fires ${triggersDetected} times across ${events.length} events from`,
    );
    console.log(
      `  both venues over ${LOOKBACK_HOURS}h. Sample size approaches statistical`,
    );
    console.log(
      `  significance. Realized P&L above is the answer to "would P1 have made`,
    );
    console.log(`  money on Base in this window?"`);
  }
}

main().catch((err) => {
  console.error("multi-venue backtest error:", err);
  process.exit(1);
});
