/**
 * Polymarket API Service
 *
 * Connects to Polymarket's CLOB (Central Limit Order Book) API
 * to fetch markets, prices, and execute trades.
 *
 * Based on strategies from X posts showing $134 → $56K profits
 * through 5-minute BTC/ETH market arbitrage.
 */

import axios from "axios";

// Polymarket API endpoints
const POLYMARKET_API = "https://clob.polymarket.com";
const GAMMA_API = "https://gamma-api.polymarket.com";

export interface PolymarketMarket {
  id: string;
  question: string;
  slug: string;
  conditionId: string;
  outcomes: string[];
  outcomePrices: string[];  // ["0.55", "0.45"] for YES/NO
  volume: string;
  liquidity: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  marketType: string;
  category: string;
}

export interface PriceQuote {
  marketId: string;
  yesPrice: number;
  noPrice: number;
  spread: number;
  arbitrageOpportunity: boolean;
  potentialProfit: number;  // As percentage
  timestamp: Date;
}

export interface ArbitrageOpportunity {
  market: PolymarketMarket;
  yesPrice: number;
  noPrice: number;
  profitPercent: number;
  recommendedSize: number;
  urgency: "HIGH" | "MEDIUM" | "LOW";
}

export class PolymarketService {
  private apiKey?: string;
  private privateKey?: string;

  constructor(apiKey?: string, privateKey?: string) {
    this.apiKey = apiKey;
    this.privateKey = privateKey;
  }

  /**
   * Get all active crypto prediction markets
   * Focus on 5-minute and 15-minute BTC/ETH markets
   */
  async getCryptoMarkets(): Promise<PolymarketMarket[]> {
    try {
      // Try multiple API endpoints for robustness
      let markets: any[] = [];

      // Try Gamma API first
      try {
        const gammaResponse = await axios.get(`${GAMMA_API}/markets`, {
          params: {
            active: true,
            closed: false,
            limit: 200,
          },
          timeout: 10000,
        });
        if (Array.isArray(gammaResponse.data)) {
          markets = gammaResponse.data;
          console.log(`      Gamma API returned ${markets.length} markets`);
        }
      } catch (e: any) {
        console.log(`      Gamma API error: ${e.message}`);
      }

      // Also try CLOB API for active markets
      if (markets.length === 0) {
        try {
          const clobResponse = await axios.get(`${POLYMARKET_API}/markets`, {
            timeout: 10000,
          });
          if (Array.isArray(clobResponse.data)) {
            markets = clobResponse.data;
            console.log(`      CLOB API returned ${markets.length} markets`);
          }
        } catch (e: any) {
          console.log(`      CLOB API error: ${e.message}`);
        }
      }

      if (markets.length === 0) {
        console.log("      No markets returned from APIs");
        return [];
      }

      // Filter for crypto-related markets - expanded search terms
      const cryptoMarkets = markets.filter((market: any) => {
        const question = market.question?.toLowerCase() || "";
        const slug = market.slug?.toLowerCase() || "";
        const description = market.description?.toLowerCase() || "";
        const tags = (market.tags || []).join(" ").toLowerCase();

        return (
          question.includes("bitcoin") ||
          question.includes("btc") ||
          question.includes("ethereum") ||
          question.includes("eth") ||
          question.includes("crypto") ||
          slug.includes("bitcoin") ||
          slug.includes("btc") ||
          slug.includes("ethereum") ||
          slug.includes("eth") ||
          slug.includes("crypto") ||
          tags.includes("crypto") ||
          tags.includes("bitcoin") ||
          // Catch price prediction markets
          (question.includes("price") && (question.includes("up") || question.includes("down"))) ||
          // Catch "will X reach" style
          (question.includes("will") && (question.includes("$") || question.includes("reach")))
        );
      });

      console.log(`      Found ${cryptoMarkets.length} crypto-related markets`);

      return cryptoMarkets.map((m: any) => ({
        id: m.id,
        question: m.question,
        slug: m.slug,
        conditionId: m.conditionId,
        outcomes: m.outcomes || ["Yes", "No"],
        outcomePrices: m.outcomePrices || ["0.50", "0.50"],
        volume: m.volume || "0",
        liquidity: m.liquidity || "0",
        endDate: m.endDate,
        active: m.active,
        closed: m.closed,
        marketType: m.marketType || "binary",
        category: m.category || "crypto",
      }));
    } catch (error: any) {
      console.error("Failed to fetch Polymarket markets:", error.message);
      return [];
    }
  }

  /**
   * Get 5-minute and 15-minute crypto markets specifically
   * These are the gold mines identified in the X posts
   */
  async getShortTermCryptoMarkets(): Promise<PolymarketMarket[]> {
    try {
      const allMarkets = await this.getCryptoMarkets();

      if (allMarkets.length === 0) {
        console.log("      No crypto markets found to filter");
        return [];
      }

      // Filter for short-term markets (5min, 15min, 1hr)
      const shortTermMarkets = allMarkets.filter((market) => {
        const question = market.question.toLowerCase();
        const slug = market.slug?.toLowerCase() || "";
        return (
          question.includes("5 minute") ||
          question.includes("5-minute") ||
          question.includes("5min") ||
          question.includes("15 minute") ||
          question.includes("15-minute") ||
          question.includes("15min") ||
          question.includes("1 hour") ||
          question.includes("hourly") ||
          slug.includes("5-min") ||
          slug.includes("15-min") ||
          slug.includes("hourly") ||
          // Also check for time-based patterns
          question.includes("next hour") ||
          question.includes("in the next")
        );
      });

      console.log(`      Found ${shortTermMarkets.length} short-term markets`);

      // If no short-term, return ALL crypto markets for scanning
      // (they may still have arbitrage opportunities)
      if (shortTermMarkets.length === 0 && allMarkets.length > 0) {
        console.log(`      No short-term markets, scanning all ${allMarkets.length} crypto markets`);
        return allMarkets;
      }

      return shortTermMarkets;
    } catch (error: any) {
      console.error("Failed to fetch short-term markets:", error.message);
      return [];
    }
  }

  /**
   * Get current prices for a market
   */
  async getMarketPrices(marketId: string): Promise<PriceQuote | null> {
    try {
      const response = await axios.get(`${GAMMA_API}/markets/${marketId}`, {
        timeout: 5000,
      });

      const market = response.data;
      const prices = market.outcomePrices || [];

      // Parse prices (they come as strings like "0.55")
      const yesPrice = parseFloat(prices[0] || "0.5");
      const noPrice = parseFloat(prices[1] || "0.5");
      const total = yesPrice + noPrice;
      const spread = 1 - total;

      return {
        marketId,
        yesPrice,
        noPrice,
        spread,
        arbitrageOpportunity: spread > 0.02, // 2%+ spread = opportunity
        potentialProfit: spread * 100,
        timestamp: new Date(),
      };
    } catch (error: any) {
      console.error(`Failed to fetch prices for market ${marketId}:`, error.message);
      return null;
    }
  }

  /**
   * Scan all short-term markets for arbitrage opportunities
   * This is THE strategy that made $500K according to X posts
   */
  async scanForArbitrage(): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];

    try {
      const markets = await this.getShortTermCryptoMarkets();
      console.log(`   Scanning ${markets.length} short-term crypto markets...`);

      for (const market of markets) {
        const prices = await this.getMarketPrices(market.id);

        if (prices && prices.arbitrageOpportunity) {
          // Calculate urgency based on profit potential
          let urgency: "HIGH" | "MEDIUM" | "LOW" = "LOW";
          if (prices.potentialProfit > 5) urgency = "HIGH";
          else if (prices.potentialProfit > 3) urgency = "MEDIUM";

          opportunities.push({
            market,
            yesPrice: prices.yesPrice,
            noPrice: prices.noPrice,
            profitPercent: prices.potentialProfit,
            recommendedSize: this.calculateOptimalSize(prices.potentialProfit, parseFloat(market.liquidity)),
            urgency,
          });
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Sort by profit potential (highest first)
      opportunities.sort((a, b) => b.profitPercent - a.profitPercent);

      return opportunities;
    } catch (error: any) {
      console.error("Arbitrage scan failed:", error.message);
      return [];
    }
  }

  /**
   * Calculate optimal trade size based on profit potential and liquidity
   */
  private calculateOptimalSize(profitPercent: number, liquidity: number): number {
    // Base size on liquidity (don't exceed 10% of available liquidity)
    const maxFromLiquidity = liquidity * 0.1;

    // Higher profit = can risk more
    let sizeMultiplier = 1;
    if (profitPercent > 5) sizeMultiplier = 2;
    if (profitPercent > 10) sizeMultiplier = 3;

    // Cap at reasonable amounts for risk management
    const baseSize = 50 * sizeMultiplier;  // $50 base

    return Math.min(baseSize, maxFromLiquidity, 500);  // Max $500 per trade
  }

  /**
   * Execute arbitrage trade (buy both YES and NO)
   * NOTE: Requires Polymarket account setup with API keys
   */
  async executeArbitrage(
    opportunity: ArbitrageOpportunity,
    amount: number
  ): Promise<{ success: boolean; txHash?: string; profit?: number; error?: string }> {
    if (!this.apiKey || !this.privateKey) {
      return {
        success: false,
        error: "Polymarket API credentials not configured. Set POLYMARKET_API_KEY and POLYMARKET_PRIVATE_KEY in .env",
      };
    }

    try {
      // In a real implementation, this would:
      // 1. Connect to Polymarket CLOB
      // 2. Place limit orders for both YES and NO
      // 3. Wait for fills
      // 4. Return combined result

      console.log(`🎯 Would execute arbitrage on: ${opportunity.market.question}`);
      console.log(`   Buy YES @ $${opportunity.yesPrice.toFixed(3)}`);
      console.log(`   Buy NO @ $${opportunity.noPrice.toFixed(3)}`);
      console.log(`   Amount: $${amount}`);
      console.log(`   Expected profit: ${opportunity.profitPercent.toFixed(2)}%`);

      // Placeholder for actual execution
      return {
        success: false,
        error: "Polymarket trading not yet implemented - needs CLOB client setup",
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get account balance on Polymarket
   */
  async getBalance(): Promise<{ usdc: number; positions: any[] } | null> {
    if (!this.apiKey) {
      return null;
    }

    try {
      // This would query the Polymarket API for account balance
      // Requires authentication
      return {
        usdc: 0,
        positions: [],
      };
    } catch (error: any) {
      console.error("Failed to fetch Polymarket balance:", error.message);
      return null;
    }
  }
}

// Export singleton instance
export const polymarket = new PolymarketService(
  process.env.POLYMARKET_API_KEY,
  process.env.POLYMARKET_PRIVATE_KEY
);
