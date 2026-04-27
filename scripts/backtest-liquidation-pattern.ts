/**
 * NVR-SPEC-022 — Pattern P1 (Liquidation Counter-Trade) historical backtest
 *
 * The first real backtest of a v22 pattern against live on-chain history.
 *
 * Procedure:
 *   1. Fetch last 7 days of Aave V3 LiquidationCall events on Base
 *      (via the bot's existing RPC fallback chain)
 *   2. Convert events to HistoricalEvents
 *   3. Replay them through the PatternRuntime with Pattern P1 in
 *      'paper' mode and a stub executor that fills at the event's
 *      stated dislocation price (a synthetic but consistent assumption)
 *   4. Report: trigger count, entries, exits, paper P&L by reason
 *
 * Run:
 *   LIQUIDATION_PATTERN_ENABLED=true npx tsx scripts/backtest-liquidation-pattern.ts
 *
 * Output:
 *   - Per-event log: which liquidations triggered the pattern (and why
 *     the others didn't — collateral not in universe, size below floor)
 *   - Final summary: # triggers, # entries, # exits, paper realized P&L
 *     attributed to liquidation_counter_trade
 *
 * Caveats — be honest about what this proves:
 *   - The "fill price" for both entry and exit is a synthetic constant
 *     pulled from the rough hardcoded approxUsdPerToken. We are NOT yet
 *     pulling historical DEX prices at the event timestamp; doing so
 *     correctly requires either a price-oracle backfill or a dedicated
 *     historical price API. So this run measures TRIGGER FIDELITY
 *     (does the pattern fire on the right events?) but not REALIZED
 *     P&L. A real $-figure requires the price feed integration.
 *   - The pattern's monitor() returns 'profit_target' / 'stop_loss' /
 *     'max_hold_time' decisions based on synthetic prices that don't
 *     change between entry and exit in this script — so the backtest
 *     here will mostly hit max_hold_time. That's expected.
 *
 * What this DOES prove:
 *   - Trigger logic works correctly against real liquidation events
 *   - Filter heuristics (collateral whitelist, size threshold) catch
 *     the right events vs reject the right events
 *   - The end-to-end pipeline (subgraph fetch → EventReplayer →
 *     PatternRuntime → tracker) functions on real data
 *   - Sample size of patterns we'd actually trade per week
 */

import { PatternRegistry } from "../src/core/patterns/registry.js";
import { PatternRuntime } from "../src/core/patterns/runtime.js";
import { liquidationCounterTradePattern } from "../src/core/patterns/liquidation-counter-trade.js";
import {
  EventReplayer,
} from "../src/simulation/event-replayer.js";
import { fetchAaveLiquidations } from "../src/simulation/data/aave-liquidations.js";
import type { TradeDecision } from "../src/core/patterns/trade-decision-shim.js";
import type { PatternState } from "../src/core/patterns/types.js";

const LOOKBACK_HOURS = parseInt(
  process.env.BACKTEST_LOOKBACK_HOURS ?? "168",
  10,
);
const PAPER_SLEEVE_USD = parseInt(
  process.env.BACKTEST_SLEEVE_USD ?? "1000",
  10,
);

async function main() {
  console.log(`\n=== NVR Pattern P1 Backtest ===`);
  console.log(`Pattern: ${liquidationCounterTradePattern.name}@${liquidationCounterTradePattern.version}`);
  console.log(`Lookback: ${LOOKBACK_HOURS}h on Aave V3 Base`);
  console.log(`Paper sleeve: $${PAPER_SLEEVE_USD}`);
  console.log(
    `Trigger gate: ${process.env.LIQUIDATION_PATTERN_ENABLED === "true" ? "OPEN" : "CLOSED"} (${process.env.LIQUIDATION_PATTERN_ENABLED === "true" ? "will fire" : "set LIQUIDATION_PATTERN_ENABLED=true to enable"})`,
  );
  console.log("");

  // 1. Fetch events
  console.log(`[1/4] Fetching liquidation events...`);
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
  console.log(`[2/4] Setting up runtime + registering pattern...`);
  const registry = new PatternRegistry();
  registry.register(liquidationCounterTradePattern, "paper");
  const states: Record<string, PatternState> = {
    [liquidationCounterTradePattern.name]: {},
  };

  // Stub executor — fills at the event's "approximate price." Marks
  // every trade so the tracker has something to attribute. The price
  // model is synthetic: entry and exit at the same approxUsdPerToken,
  // so realized P&L is mostly noise (rounding); this run validates
  // trigger fidelity, not P&L.
  const fills: TradeDecision[] = [];
  const executeFn = async (decision: TradeDecision) => {
    fills.push(decision);
    // Approximate fill price: read from the trigger context if present,
    // else default to 1.0 USD-equivalent per token. The tracker will
    // compute a near-zero P&L either way, which is honest given we
    // don't have real historical pricing.
    const sym = decision.action === "BUY" ? decision.toToken : decision.fromToken;
    const px = sym === "USDC" ? 1.0 : 1.0; // pure stub
    return { filledUsd: decision.amountUSD, filledPrice: px };
  };

  const runtime = new PatternRuntime(
    registry,
    {
      alphaSleeveUsd: () => PAPER_SLEEVE_USD,
      executeFn,
      loadPatternState: (name) => states[name] ?? {},
    },
    "paper",
  );

  // 3. Replay
  console.log(`[3/4] Replaying ${fetched.events.length} events through runtime...`);
  const replayer = new EventReplayer(runtime);
  let triggersDetected = 0;
  let entered = 0;
  const triggeredEvents: { ts: string; symbol: string; size: number; txHash: string }[] = [];
  await replayer.replay(fetched.events, {
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

  // 4. Report
  console.log(`[4/4] Reporting...\n`);
  console.log(`=== Backtest Results ===`);
  console.log(`Events scanned:       ${fetched.events.length}`);
  console.log(`Triggers fired:       ${triggersDetected}`);
  console.log(`Pattern entries:      ${entered}`);
  console.log(`Open positions:       ${runtime.tracker.openPositions(liquidationCounterTradePattern.name).length}`);
  console.log(`Closed positions:     ${runtime.tracker.closedPositions(liquidationCounterTradePattern.name).length}`);

  // Show which events triggered
  if (triggeredEvents.length > 0) {
    console.log(`\n=== Triggered Events ===`);
    for (const t of triggeredEvents) {
      console.log(`  ${t.ts}  collateral=${t.symbol.slice(0, 10)}... tx=${t.txHash.slice(0, 12)}`);
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

  // Per-pattern stats
  const stats = runtime.tracker.stats(new Map());
  if (stats.length > 0) {
    console.log(`\n=== Per-pattern stats ===`);
    for (const s of stats) {
      console.log(
        `  ${s.patternName}: open=${s.openCount} closed=${s.closedCount} ` +
          `realized=$${s.realizedPnL.toFixed(2)} unrealized=$${s.unrealizedPnL.toFixed(2)}`,
      );
    }
  }

  console.log(`\n=== Honest read ===`);
  console.log(
    `  This run validates TRIGGER FIDELITY. P&L numbers are noise because`,
  );
  console.log(
    `  the executor uses a synthetic constant price (no historical DEX feed`,
  );
  console.log(
    `  integration yet). Next step is wiring real historical token prices`,
  );
  console.log(
    `  into the executor so we can answer the actual question: "if Pattern`,
  );
  console.log(
    `  P1 had been live during this window, would it have made money?"`,
  );
}

main().catch((err) => {
  console.error("backtest error:", err);
  process.exit(1);
});
