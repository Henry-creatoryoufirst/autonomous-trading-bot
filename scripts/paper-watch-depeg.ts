/**
 * NVR-SPEC-022 — Paper-mode Stablecoin Depeg Watcher
 *
 * Validates the v22 Pattern Runtime against the live market — real prices,
 * real triggers, no real trades. Polls Base stablecoin prices every 60s
 * via GeckoTerminal's public API, constructs MarketSnapshots, ticks the
 * PatternRuntime with the stablecoin-depeg pattern in PAPER status.
 *
 * Run:
 *   DEPEG_PATTERN_ENABLED=true npx tsx scripts/paper-watch-depeg.ts
 *
 * What it produces:
 *   - Console log per tick: timestamp, current prices, deviation in bps
 *   - Detected triggers (when a stable goes >50bps below peg for >5min)
 *   - Paper-trade entries/exits attributed to the pattern
 *   - At Ctrl-C: final per-pattern stats summary
 *
 * Why this exists:
 *   - Validates the Pattern interface end-to-end against real data
 *   - Generates real trigger telemetry without ever placing a real trade
 *   - Sanity-checks the price-feed plumbing before subgraph integration
 *   - If a stable depegs while this is running, we capture the actual
 *     trigger trace and can compare against what the runtime would have
 *     done in production
 *
 * What it does NOT do:
 *   - Subscribe to on-chain LiquidationCall events (Aave subgraph integ.
 *     is the next ship)
 *   - Persist state across runs (each invocation starts fresh)
 *   - Actually trade — every executeFn call is a paper fill
 */

import { PatternRegistry } from "../src/core/patterns/registry.js";
import { PatternRuntime } from "../src/core/patterns/runtime.js";
import { stablecoinDepegPattern } from "../src/core/patterns/stablecoin-depeg.js";
import type {
  MarketSnapshot,
  PatternState,
} from "../src/core/patterns/types.js";
import type { TradeDecision } from "../src/core/patterns/trade-decision-shim.js";

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

/** Token addresses on Base mainnet. */
const STABLES: Record<string, string> = {
  USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  USDT: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
  DAI: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
  // USDS, sUSDe addresses on Base would go here when verified
};

const POLL_INTERVAL_MS = 60_000;
const PAPER_SLEEVE_USD = 1000; // Pretend $1k is the alpha sleeve for sizing

// ----------------------------------------------------------------------------
// Price feed — GeckoTerminal public API, no auth
// ----------------------------------------------------------------------------

interface GtTokenResponse {
  data?: {
    attributes?: {
      price_usd?: string;
      name?: string;
    };
  };
}

async function fetchTokenPrice(tokenAddr: string): Promise<number | null> {
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/base/tokens/${tokenAddr}`;
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as GtTokenResponse;
    const px = data.data?.attributes?.price_usd;
    return px ? parseFloat(px) : null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Paper executor — record decisions, return synthetic fills
// ----------------------------------------------------------------------------

interface PaperFill {
  timestamp: string;
  decision: TradeDecision;
  filledUsd: number;
  filledPrice: number;
}

const fills: PaperFill[] = [];

function paperExecuteFactory(currentPriceFor: (sym: string) => number) {
  return async (decision: TradeDecision) => {
    const sym = decision.action === "BUY" ? decision.toToken : decision.fromToken;
    const px = currentPriceFor(sym);
    const fill: PaperFill = {
      timestamp: new Date().toISOString(),
      decision,
      filledUsd: decision.amountUSD,
      filledPrice: px > 0 ? px : 1.0,
    };
    fills.push(fill);
    console.log(
      `   📝 [PAPER FILL] ${decision.action} ${sym} $${decision.amountUSD.toFixed(2)} @ $${fill.filledPrice.toFixed(4)} · ${decision.reasoning}`,
    );
    return { filledUsd: fill.filledUsd, filledPrice: fill.filledPrice };
  };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log(`\n=== NVR Paper-Mode Stablecoin Depeg Watcher ===`);
  console.log(`Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`Paper alpha sleeve: $${PAPER_SLEEVE_USD}`);
  console.log(`Pattern: ${stablecoinDepegPattern.name}@${stablecoinDepegPattern.version}`);
  console.log(`Stub guard: ${process.env.DEPEG_PATTERN_ENABLED === "true" ? "DISABLED (will fire)" : "ENABLED (silent)"}`);
  console.log(`Watching ${Object.keys(STABLES).join(", ")} on Base.\n`);

  if (process.env.DEPEG_PATTERN_ENABLED !== "true") {
    console.warn(
      `⚠️  DEPEG_PATTERN_ENABLED is not 'true' — pattern will accumulate state but not fire triggers. ` +
        `Set DEPEG_PATTERN_ENABLED=true to enable triggers.`,
    );
  }

  const registry = new PatternRegistry();
  registry.register(stablecoinDepegPattern, "paper");

  const states: Record<string, PatternState> = {
    [stablecoinDepegPattern.name]: {},
  };

  // Closure that the executor reads to fill at the most recent price
  const lastPrices = new Map<string, number>();
  const runtime = new PatternRuntime(
    registry,
    {
      alphaSleeveUsd: () => PAPER_SLEEVE_USD,
      executeFn: paperExecuteFactory((sym) => lastPrices.get(sym) ?? 0),
      loadPatternState: (name) => states[name] ?? {},
    },
    "paper",
  );

  let tickCount = 0;

  async function tick() {
    tickCount++;
    const prices = new Map<string, number>();
    for (const [sym, addr] of Object.entries(STABLES)) {
      const px = await fetchTokenPrice(addr);
      if (px !== null && px > 0) {
        prices.set(sym, px);
        lastPrices.set(sym, px);
      }
    }

    if (prices.size === 0) {
      console.warn(`[tick #${tickCount}] no prices fetched — skipping`);
      return;
    }

    const snapshot: MarketSnapshot = {
      timestamp: new Date().toISOString(),
      prices,
    };

    const report = await runtime.tick(snapshot);

    // Concise per-tick log: timestamp, prices in bps from peg, action summary
    const priceLine = [...prices.entries()]
      .map(([sym, px]) => `${sym}=${px.toFixed(4)} (${Math.round((px - 1) * 10000)}bps)`)
      .join(" · ");
    const actionLine = `triggers=${report.triggersDetected} entered=${report.entered} exited=${report.exited}`;
    console.log(`[tick #${tickCount} ${snapshot.timestamp}] ${priceLine} | ${actionLine}`);

    if (report.detectErrors.length > 0) {
      for (const err of report.detectErrors) {
        console.error(`   ❌ detect error in ${err.patternName}:`, err.error);
      }
    }
  }

  // Immediate first tick, then on interval
  await tick();
  const interval = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);

  // Graceful shutdown summary
  const summarize = () => {
    clearInterval(interval);
    console.log(`\n=== Final Summary ===`);
    console.log(`Total ticks: ${tickCount}`);
    console.log(`Total paper fills: ${fills.length}`);
    const stats = runtime.tracker.stats(lastPrices);
    for (const s of stats) {
      console.log(
        `Pattern ${s.patternName}: open=${s.openCount}, closed=${s.closedCount}, ` +
          `realized=$${s.realizedPnL.toFixed(2)}, unrealized=$${s.unrealizedPnL.toFixed(2)}, ` +
          `winRate=${(s.winRate * 100).toFixed(0)}%`,
      );
    }
    process.exit(0);
  };
  process.on("SIGINT", summarize);
  process.on("SIGTERM", summarize);
}

main().catch((err) => {
  console.error("paper-watch-depeg fatal error:", err);
  process.exit(1);
});
