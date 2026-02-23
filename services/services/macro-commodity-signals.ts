/**
 * Macro Commodity Signal Engine v1.0
 *
 * Generates trading signals for commodity futures (Gold, Silver) based on
 * macro-economic indicators. This is the genuinely NEW intelligence layer
 * the brain needs — crypto signals don't drive commodity prices.
 *
 * Signal Sources:
 *   1. US Dollar Index (DXY) — inverse correlation with gold/silver
 *   2. Real Yields (10Y Treasury - CPI) — inverse correlation with gold
 *   3. VIX (Volatility Index) — flight-to-safety signal for gold
 *   4. S&P 500 — risk appetite proxy
 *   5. Gold spot price momentum (via CoinGecko PAXG proxy)
 *   6. Silver spot price momentum (via CoinGecko proxy or external API)
 *
 * Signal Logic:
 *   Gold Bullish: Weak dollar + Falling real yields + Rising VIX + Falling S&P
 *   Gold Bearish: Strong dollar + Rising real yields + Low VIX + Rising S&P
 *   Silver Bullish: Same as gold + Industrial demand signals + Base metal momentum
 *   Silver Bearish: Same as gold bearish + Industrial weakness
 *
 * The existing bot already fetches FRED macro data (Fed rate, 10Y, CPI, M2, DXY)
 * and cross-asset data (PAXG gold, VIX, SPX) — this module CONSUMES that data
 * and produces commodity-specific trading signals.
 */

import axios from "axios";
import { MacroCommoditySignal } from "./derivatives-strategy.js";

// ============================================================================
// TYPES
// ============================================================================

interface MacroInputData {
  // From existing bot's FRED macro layer
  fedFundsRate?: number;
  treasury10Y?: number;
  cpi?: number;
  m2MoneySupply?: number;
  dollarIndex?: number;
  yieldCurve?: number;  // 10Y - 2Y spread

  // From existing bot's cross-asset layer
  goldPrice?: number;        // PAXG price (gold proxy)
  goldChange24h?: number;
  vixLevel?: number;
  spxPrice?: number;
  spxChange24h?: number;

  // From existing bot's macro signal
  macroSignal?: "RISK_ON" | "RISK_OFF" | "NEUTRAL";
}

interface SignalComponent {
  name: string;
  value: number;
  signal: number;      // -1 to +1
  weight: number;
  direction: string;   // Human-readable
}

// ============================================================================
// SIGNAL WEIGHTS
// ============================================================================

const GOLD_WEIGHTS = {
  dollarIndex: 0.25,      // Strongest inverse correlation
  realYields: 0.25,       // Falling real yields = gold bullish
  vix: 0.20,              // Flight to safety
  spx: 0.15,              // Inverse risk signal
  goldMomentum: 0.15,     // Price momentum confirmation
};

const SILVER_WEIGHTS = {
  dollarIndex: 0.20,
  realYields: 0.20,
  vix: 0.15,
  spx: 0.15,
  goldMomentum: 0.15,     // Silver tracks gold
  industrialDemand: 0.15, // Silver has industrial use
};

// ============================================================================
// MACRO COMMODITY SIGNAL ENGINE
// ============================================================================

export class MacroCommoditySignalEngine {
  private lastSignal: MacroCommoditySignal | null = null;
  private silverPriceCache: { price: number; change24h: number; timestamp: number } | null = null;

  /**
   * Generate commodity trading signals from macro data.
   *
   * This is designed to consume the data the main bot ALREADY fetches:
   *   - FRED macro data (via fetchMacroData in agent-v3.2.ts)
   *   - Cross-asset data (via fetchCrossAssetData in agent-v3.2.ts)
   *   - Macro signal classification (RISK_ON / RISK_OFF / NEUTRAL)
   *
   * @param data - Macro data from the existing bot's data pipeline
   */
  generateSignal(data: MacroInputData): MacroCommoditySignal {
    const components: SignalComponent[] = [];

    // === 1. DOLLAR INDEX (DXY) — Inverse correlation with gold/silver ===
    let dxySignal = 0;
    let dxyDirection = "NEUTRAL";
    if (data.dollarIndex) {
      // DXY above 105 = strong dollar = bearish for gold
      // DXY below 100 = weak dollar = bullish for gold
      // DXY 100-105 = neutral zone
      if (data.dollarIndex > 107) {
        dxySignal = -0.9;
        dxyDirection = "VERY STRONG (bearish gold)";
      } else if (data.dollarIndex > 105) {
        dxySignal = -0.6;
        dxyDirection = "STRONG (bearish gold)";
      } else if (data.dollarIndex > 103) {
        dxySignal = -0.3;
        dxyDirection = "Moderate (slightly bearish gold)";
      } else if (data.dollarIndex > 100) {
        dxySignal = 0;
        dxyDirection = "Neutral";
      } else if (data.dollarIndex > 97) {
        dxySignal = 0.3;
        dxyDirection = "Weakening (slightly bullish gold)";
      } else if (data.dollarIndex > 95) {
        dxySignal = 0.6;
        dxyDirection = "WEAK (bullish gold)";
      } else {
        dxySignal = 0.9;
        dxyDirection = "VERY WEAK (very bullish gold)";
      }

      components.push({
        name: "Dollar Index (DXY)",
        value: data.dollarIndex,
        signal: dxySignal,
        weight: GOLD_WEIGHTS.dollarIndex,
        direction: dxyDirection,
      });
    }

    // === 2. REAL YIELDS (10Y Treasury - CPI) — Inverse correlation with gold ===
    let realYieldSignal = 0;
    let realYieldDirection = "NEUTRAL";
    if (data.treasury10Y !== undefined && data.cpi !== undefined) {
      const realYield = data.treasury10Y - data.cpi;

      // Positive real yields = bearish for gold (opportunity cost)
      // Negative real yields = bullish for gold (no yield competition)
      if (realYield > 2.0) {
        realYieldSignal = -0.9;
        realYieldDirection = "HIGH positive (very bearish gold)";
      } else if (realYield > 1.0) {
        realYieldSignal = -0.5;
        realYieldDirection = "Moderate positive (bearish gold)";
      } else if (realYield > 0) {
        realYieldSignal = -0.2;
        realYieldDirection = "Slightly positive (neutral)";
      } else if (realYield > -1.0) {
        realYieldSignal = 0.3;
        realYieldDirection = "Slightly negative (bullish gold)";
      } else if (realYield > -2.0) {
        realYieldSignal = 0.6;
        realYieldDirection = "Negative (bullish gold)";
      } else {
        realYieldSignal = 0.9;
        realYieldDirection = "DEEPLY negative (very bullish gold)";
      }

      components.push({
        name: "Real Yields",
        value: realYield,
        signal: realYieldSignal,
        weight: GOLD_WEIGHTS.realYields,
        direction: realYieldDirection,
      });
    }

    // === 3. VIX (Volatility Index) — Flight to safety ===
    let vixSignal = 0;
    let vixSentiment = "CALM";
    if (data.vixLevel) {
      // VIX > 30 = fear = flight to gold
      // VIX 20-30 = elevated = moderate gold bid
      // VIX < 20 = complacent = gold neutral/bearish
      if (data.vixLevel > 35) {
        vixSignal = 0.9;
        vixSentiment = "PANIC (very bullish gold)";
      } else if (data.vixLevel > 30) {
        vixSignal = 0.6;
        vixSentiment = "FEAR (bullish gold)";
      } else if (data.vixLevel > 25) {
        vixSignal = 0.3;
        vixSentiment = "ELEVATED (slightly bullish gold)";
      } else if (data.vixLevel > 20) {
        vixSignal = 0;
        vixSentiment = "NORMAL";
      } else if (data.vixLevel > 15) {
        vixSignal = -0.3;
        vixSentiment = "COMPLACENT (slightly bearish gold)";
      } else {
        vixSignal = -0.5;
        vixSentiment = "VERY COMPLACENT (bearish gold)";
      }

      components.push({
        name: "VIX",
        value: data.vixLevel,
        signal: vixSignal,
        weight: GOLD_WEIGHTS.vix,
        direction: vixSentiment,
      });
    }

    // === 4. S&P 500 — Risk appetite proxy (inverse for gold) ===
    let spxSignal = 0;
    let spxDirection = "NEUTRAL";
    if (data.spxChange24h !== undefined) {
      // Strong equity rally = risk-on = gold neutral/bearish
      // Equity sell-off = risk-off = gold bullish
      if (data.spxChange24h < -3) {
        spxSignal = 0.8;
        spxDirection = "SHARP SELL-OFF (very bullish gold)";
      } else if (data.spxChange24h < -1.5) {
        spxSignal = 0.5;
        spxDirection = "SELL-OFF (bullish gold)";
      } else if (data.spxChange24h < -0.5) {
        spxSignal = 0.2;
        spxDirection = "DOWN (slightly bullish gold)";
      } else if (data.spxChange24h < 0.5) {
        spxSignal = 0;
        spxDirection = "FLAT";
      } else if (data.spxChange24h < 1.5) {
        spxSignal = -0.2;
        spxDirection = "UP (slightly bearish gold)";
      } else {
        spxSignal = -0.5;
        spxDirection = "STRONG RALLY (bearish gold)";
      }

      components.push({
        name: "S&P 500",
        value: data.spxPrice || 0,
        signal: spxSignal,
        weight: GOLD_WEIGHTS.spx,
        direction: spxDirection,
      });
    }

    // === 5. GOLD PRICE MOMENTUM (via PAXG) ===
    let goldMomentumSignal = 0;
    if (data.goldChange24h !== undefined) {
      // Price momentum — trending gold is more likely to continue
      if (data.goldChange24h > 2) {
        goldMomentumSignal = 0.7;
      } else if (data.goldChange24h > 0.5) {
        goldMomentumSignal = 0.3;
      } else if (data.goldChange24h > -0.5) {
        goldMomentumSignal = 0;
      } else if (data.goldChange24h > -2) {
        goldMomentumSignal = -0.3;
      } else {
        goldMomentumSignal = -0.7;
      }

      components.push({
        name: "Gold Momentum",
        value: data.goldPrice || 0,
        signal: goldMomentumSignal,
        weight: GOLD_WEIGHTS.goldMomentum,
        direction: `${data.goldChange24h >= 0 ? "+" : ""}${data.goldChange24h.toFixed(1)}% 24h`,
      });
    }

    // === COMPOSITE GOLD SIGNAL ===
    let goldSignal = 0;
    let totalGoldWeight = 0;
    for (const comp of components) {
      const goldWeight = GOLD_WEIGHTS[comp.name === "Dollar Index (DXY)" ? "dollarIndex" :
                                       comp.name === "Real Yields" ? "realYields" :
                                       comp.name === "VIX" ? "vix" :
                                       comp.name === "S&P 500" ? "spx" :
                                       comp.name === "Gold Momentum" ? "goldMomentum" : "goldMomentum"] || 0;
      goldSignal += comp.signal * goldWeight;
      totalGoldWeight += goldWeight;
    }
    if (totalGoldWeight > 0) {
      goldSignal /= totalGoldWeight;
      goldSignal *= totalGoldWeight; // Re-scale by coverage (if we have all data, full signal; if partial, weaker)
    }

    // === COMPOSITE SILVER SIGNAL ===
    // Silver correlates with gold but also has industrial demand component
    // Use the macro signal as industrial demand proxy (RISK_ON = industrial demand up)
    let industrialDemandSignal = 0;
    if (data.macroSignal === "RISK_ON") {
      industrialDemandSignal = 0.4; // Risk-on = industrial activity = silver bullish
    } else if (data.macroSignal === "RISK_OFF") {
      industrialDemandSignal = -0.4; // Risk-off = industrial slowdown = silver bearish
    }

    let silverSignal = goldSignal * 0.85; // Silver follows gold at 85% correlation
    silverSignal += industrialDemandSignal * SILVER_WEIGHTS.industrialDemand;

    // Clamp signals to [-1, 1]
    goldSignal = Math.max(-1, Math.min(1, goldSignal));
    silverSignal = Math.max(-1, Math.min(1, silverSignal));

    // Build reasoning string
    const activeComponents = components.filter(c => Math.abs(c.signal) > 0.1);
    const reasoning = activeComponents.length > 0
      ? activeComponents.map(c => `${c.name}: ${c.direction}`).join(" | ")
      : "Insufficient macro data for commodity signal";

    const signal: MacroCommoditySignal = {
      goldSignal,
      silverSignal,
      reasoning,
      components: {
        dollarIndex: {
          value: data.dollarIndex || 0,
          signal: dxySignal,
          direction: dxyDirection,
        },
        realYields: {
          value: data.treasury10Y !== undefined && data.cpi !== undefined
            ? data.treasury10Y - data.cpi
            : 0,
          signal: realYieldSignal,
          direction: realYieldDirection,
        },
        vixLevel: {
          value: data.vixLevel || 0,
          signal: vixSignal,
          riskSentiment: vixSentiment,
        },
        goldPrice: {
          value: data.goldPrice || 0,
          change24h: data.goldChange24h || 0,
        },
        silverPrice: {
          value: this.silverPriceCache?.price || 0,
          change24h: this.silverPriceCache?.change24h || 0,
        },
        spx: {
          value: data.spxPrice || 0,
          change24h: data.spxChange24h || 0,
          signal: spxSignal,
        },
      },
    };

    this.lastSignal = signal;

    console.log(`  🥇 Gold Signal: ${goldSignal >= 0 ? "+" : ""}${goldSignal.toFixed(3)} | Silver Signal: ${silverSignal >= 0 ? "+" : ""}${silverSignal.toFixed(3)}`);
    console.log(`     Components: ${reasoning}`);

    return signal;
  }

  /**
   * Fetch silver spot price from CoinGecko (no API key needed).
   * Cache for 2 hours to avoid rate limits.
   */
  async fetchSilverPrice(): Promise<{ price: number; change24h: number } | null> {
    // Check cache
    if (this.silverPriceCache && Date.now() - this.silverPriceCache.timestamp < 2 * 60 * 60 * 1000) {
      return { price: this.silverPriceCache.price, change24h: this.silverPriceCache.change24h };
    }

    try {
      const response = await axios.get(
        "https://api.coingecko.com/api/v3/simple/price?ids=silver&vs_currencies=usd&include_24hr_change=true",
        { timeout: 8000 }
      );
      const price = response.data?.silver?.usd || 0;
      const change24h = response.data?.silver?.usd_24h_change || 0;

      this.silverPriceCache = { price, change24h, timestamp: Date.now() };
      return { price, change24h };
    } catch (error: any) {
      console.warn(`  ⚠️ Silver price fetch failed: ${error?.message?.substring(0, 80)}`);
      return this.silverPriceCache ? { price: this.silverPriceCache.price, change24h: this.silverPriceCache.change24h } : null;
    }
  }

  getLastSignal(): MacroCommoditySignal | null {
    return this.lastSignal;
  }
}

/**
 * Discover available commodity futures contracts on Coinbase CDE.
 * Product IDs change monthly (e.g., GCJ6-USD for March 2026 Gold, GCK6-USD for April 2026).
 * This function finds the nearest active contracts.
 */
export async function discoverCommodityContracts(
  client: import("./coinbase-advanced-trade.js").CoinbaseAdvancedTradeClient
): Promise<{ gold: string[]; silver: string[] }> {
  try {
    const products = await client.listProducts({
      product_type: "FUTURE",
    });

    const gold: string[] = [];
    const silver: string[] = [];

    for (const product of products.products || []) {
      const id = product.product_id;
      // Gold contracts: GC prefix (e.g., GCJ6-USD, GCK6-USD)
      if (id.startsWith("GC") && !id.includes("PERP")) {
        gold.push(id);
      }
      // Silver contracts: SI prefix (e.g., SIH6-USD, SIK6-USD)
      if (id.startsWith("SI") && !id.includes("PERP")) {
        silver.push(id);
      }
    }

    console.log(`  🥇 Gold contracts found: ${gold.length > 0 ? gold.join(", ") : "none"}`);
    console.log(`  🥈 Silver contracts found: ${silver.length > 0 ? silver.join(", ") : "none"}`);

    return { gold, silver };
  } catch (error: any) {
    console.warn(`  ⚠️ Contract discovery failed: ${error?.message?.substring(0, 100)}`);
    return { gold: [], silver: [] };
  }
}
