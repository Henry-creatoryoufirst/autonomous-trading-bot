/**
 * NVR-SPEC-022 — Pattern P1: Liquidation Counter-Trade
 *
 * Mechanism: when a leveraged position on Aave/Morpho is liquidated, the
 * liquidator sells collateral at market regardless of fundamentals to
 * recover the debt. Forced sellers create temporary price dislocation
 * below the prevailing DEX-aggregated mid. Natural buyers and arbitrage
 * absorb the dislocation within minutes-to-hours, recovering some
 * fraction of the gap. The pattern's edge is being present + fast on
 * the second wave (15min – 4hr horizon), not the same-block MEV race
 * that institutional searchers dominate.
 *
 * Reference: Qin, Zhou, Gervais et al. (2021), "An Empirical Study of
 * DeFi Liquidations," Financial Cryptography '21,
 * https://arxiv.org/abs/2106.06389. Quantifies post-liquidation
 * reversion on Aave/Compound mainnet. Base subgraph confirms similar
 * event-frequency dynamics on Base (68 events / 7 days, 2026-04-21..27).
 *
 * Trigger semantics (this module):
 *   - Pattern reads `MarketSnapshot.extras.event` looking for
 *     kind === 'aave_liquidation' (produced by aave-liquidations.ts).
 *   - Filters by:
 *       (a) collateral asset is in our tradeable universe (WETH, cbBTC,
 *           AERO, etc.) — i.e., we can actually buy it on Base DEXes
 *       (b) approximate USD size of the liquidation > MIN_LIQUIDATION_USD
 *           (rough heuristic using hardcoded token-to-USD conversion;
 *           real-time pricing will replace this when we wire to live data)
 *   - On fire, returns a Trigger with the original liquidation payload
 *     so confirm() / enter() can size based on liquidation magnitude.
 *
 * STATUS: STUB. detect() is gated by env var LIQUIDATION_PATTERN_ENABLED
 * for the same reason stablecoin-depeg is — no live triggers until the
 * pattern has cleared a confidence-gate against historical replay.
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
// Tradeable universe — Base mainnet token addresses (lowercase) we'd act on.
// Must match the bot's known-tradeable list. Stablecoins themselves are
// excluded (their liquidations are meaningless to counter-trade since the
// collateral price is already ~$1 by definition).
// ----------------------------------------------------------------------------

interface TokenInfo {
  symbol: string;
  decimals: number;
  /** Rough USD/token used only for the size filter. Will be replaced by
   *  real-time pricing when we wire the pattern to a live price feed.
   *  Stale values are OK for an order-of-magnitude size check. */
  approxUsdPerToken: number;
}

const TRADEABLE_COLLATERAL: Record<string, TokenInfo> = {
  // WETH (Base)
  "0x4200000000000000000000000000000000000006": {
    symbol: "WETH",
    decimals: 18,
    approxUsdPerToken: 2700,
  },
  // cbBTC (Base)
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": {
    symbol: "cbBTC",
    decimals: 8,
    approxUsdPerToken: 95000,
  },
  // cbETH (Base)
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": {
    symbol: "cbETH",
    decimals: 18,
    approxUsdPerToken: 2900,
  },
  // wstETH (Base)
  "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452": {
    symbol: "wstETH",
    decimals: 18,
    approxUsdPerToken: 3200,
  },
  // AERO (Base) — Aerodrome governance token
  "0x940181a94a35a4569e4529a3cdfb74e38fd98631": {
    symbol: "AERO",
    decimals: 18,
    approxUsdPerToken: 1.0,
  },
};

// ----------------------------------------------------------------------------
// Pattern config
// ----------------------------------------------------------------------------

/** Minimum approximate USD size of a liquidation to act on. Below this,
 *  the dislocation is too small for our trade size to capture the spread
 *  net of gas + slippage. */
const MIN_LIQUIDATION_USD = 50_000;

/** Maximum hold duration in minutes. After this, exit regardless of
 *  price action — the dislocation should have absorbed in under an hour. */
const MAX_HOLD_MINUTES = 240; // 4 hours

/** Tick hint for the runtime. Doesn't matter much for event-driven
 *  patterns since they fire on event injection, not schedule. */
const TICK_INTERVAL_MS = 30_000;

// ----------------------------------------------------------------------------
// Pattern state
// ----------------------------------------------------------------------------

interface LiquidationState extends PatternState {
  /** Tx hashes we've already triggered on, prevents duplicate triggers
   *  if the same event arrives twice (defensive — the EventReplayer
   *  shouldn't, but real-time event subscriptions might). */
  seenTxHashes?: Record<string, string | undefined>;
}

// ----------------------------------------------------------------------------
// Pattern implementation
// ----------------------------------------------------------------------------

export const liquidationCounterTradePattern: Pattern = {
  name: "liquidation_counter_trade",
  version: "0.1.0-stub",
  description:
    "Counter-trade buy of liquidated collateral. Fires when an Aave V3 LiquidationCall event lands with a tradeable Base asset and ≥$50k size. Holds up to 4h while the dislocation reverts.",

  maxAllocationPct: 10,
  maxConcurrentPositions: 3,
  tickIntervalMs: TICK_INTERVAL_MS,

  detect(market: MarketSnapshot, state: PatternState): Trigger | null {
    if (process.env.LIQUIDATION_PATTERN_ENABLED !== "true") return null;

    const ev = (market.extras as { event?: { kind?: string; payload?: Record<string, unknown> } } | undefined)?.event;
    if (!ev || ev.kind !== "aave_liquidation") return null;
    const p = ev.payload;
    if (!p) return null;

    const collateralAddr = (p.collateralAsset as string | undefined)?.toLowerCase();
    const txHash = p.txHash as string | undefined;
    const liquidatedAmountStr = p.liquidatedCollateralAmount as string | undefined;

    if (!collateralAddr || !txHash || !liquidatedAmountStr) return null;

    // Filter: collateral must be tradeable on Base
    const tokenInfo = TRADEABLE_COLLATERAL[collateralAddr];
    if (!tokenInfo) return null;

    // Filter: approximate USD size
    let liquidatedAmountWei: bigint;
    try {
      liquidatedAmountWei = BigInt(liquidatedAmountStr);
    } catch {
      return null;
    }
    const tokenAmount =
      Number(liquidatedAmountWei) / 10 ** tokenInfo.decimals;
    const approxUsdSize = tokenAmount * tokenInfo.approxUsdPerToken;
    if (approxUsdSize < MIN_LIQUIDATION_USD) return null;

    // Filter: dedupe by tx hash
    const s = state as LiquidationState;
    s.seenTxHashes ??= {};
    if (s.seenTxHashes[txHash]) return null;
    s.seenTxHashes[txHash] = market.timestamp;

    return {
      patternName: "liquidation_counter_trade",
      symbol: tokenInfo.symbol,
      detectedAt: market.timestamp,
      context: {
        collateralAddr,
        approxUsdSize: Math.round(approxUsdSize),
        tokenAmount,
        txHash,
        debtAsset: p.debtAsset,
        liquidator: p.liquidator,
        userLiquidated: p.user,
      },
      summary: `${tokenInfo.symbol} liquidated ~$${Math.round(approxUsdSize / 1000)}k on Aave V3 — counter-trade entry`,
    };
  },

  enter(trigger: Trigger, conviction: number, allocationUsd: number): TradeDecision {
    const sizeUsd = Math.max(0, allocationUsd * (conviction / 100));
    return {
      action: "BUY",
      fromToken: "USDC",
      toToken: trigger.symbol,
      amountUSD: sizeUsd,
      reasoning: `${trigger.summary} · conviction=${conviction} · pattern=liquidation_counter_trade@${liquidationCounterTradePattern.version}`,
      sector: undefined,
    };
  },

  monitor(position: Position, market: MarketSnapshot, _state: PatternState): ExitDecision {
    const heldMs =
      Date.parse(market.timestamp) - Date.parse(position.entryAt);
    const heldMin = heldMs / 60_000;
    if (heldMin >= MAX_HOLD_MINUTES) {
      return { action: "exit", reason: "max_hold_time", pctClose: 100 };
    }

    // Take-profit: if price is up >2% from entry, take it
    const px = market.prices.get(position.symbol);
    if (px !== undefined && position.entryPrice > 0) {
      const pnlPct = ((px - position.entryPrice) / position.entryPrice) * 100;
      if (pnlPct >= 2) {
        return { action: "exit", reason: "profit_target", pctClose: 100 };
      }
      // Stop-loss: if price drops >5% from entry, cut. Liquidation
      // dislocations should revert UP, not deepen — a 5% further drop
      // suggests the market is genuinely re-rating the asset and we
      // should not stay long.
      if (pnlPct <= -5) {
        return { action: "exit", reason: "stop_loss", pctClose: 100 };
      }
    }

    return "hold";
  },
};

// ----------------------------------------------------------------------------
// Internal exports for tests
// ----------------------------------------------------------------------------

export const _testInternals = {
  TRADEABLE_COLLATERAL,
  MIN_LIQUIDATION_USD,
  MAX_HOLD_MINUTES,
};
