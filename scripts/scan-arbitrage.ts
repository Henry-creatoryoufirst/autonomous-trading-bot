/**
 * Quick Polymarket Arbitrage Scanner
 *
 * Run: npm run arb
 *
 * Scans Polymarket for 5-minute crypto markets with YES+NO < $1 opportunities
 */

import { PolymarketService } from "../services/polymarket.js";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("\n🔍 POLYMARKET ARBITRAGE SCANNER");
  console.log("═".repeat(50));
  console.log("Looking for YES + NO < $1 opportunities...\n");

  const polymarket = new PolymarketService();

  try {
    // Get all crypto markets first
    console.log("📊 Fetching crypto markets...");
    const markets = await polymarket.getCryptoMarkets();
    console.log(`   Found ${markets.length} crypto-related markets\n`);

    // Get short-term markets
    console.log("⏱️ Filtering for short-term (5min/15min) markets...");
    const shortTermMarkets = await polymarket.getShortTermCryptoMarkets();
    console.log(`   Found ${shortTermMarkets.length} short-term markets\n`);

    if (shortTermMarkets.length > 0) {
      console.log("📈 Short-term crypto markets:");
      for (const market of shortTermMarkets.slice(0, 10)) {
        console.log(`   • ${market.question}`);
        console.log(`     Prices: YES=$${market.outcomePrices[0]} NO=$${market.outcomePrices[1]}`);
        console.log(`     Volume: $${parseFloat(market.volume).toLocaleString()}`);
        console.log("");
      }
    }

    // Scan for arbitrage
    console.log("\n💰 Scanning for arbitrage opportunities...");
    const opportunities = await polymarket.scanForArbitrage();

    if (opportunities.length === 0) {
      console.log("   No arbitrage opportunities found at this moment.");
      console.log("   (Markets are efficient - spread is too small)");
    } else {
      console.log(`\n🔥 FOUND ${opportunities.length} ARBITRAGE OPPORTUNITIES:\n`);

      for (const opp of opportunities) {
        const urgencyEmoji = opp.urgency === "HIGH" ? "🔥" : opp.urgency === "MEDIUM" ? "⚡" : "📊";
        console.log(`${urgencyEmoji} ${opp.market.question}`);
        console.log(`   YES Price: $${opp.yesPrice.toFixed(4)}`);
        console.log(`   NO Price:  $${opp.noPrice.toFixed(4)}`);
        console.log(`   Total:     $${(opp.yesPrice + opp.noPrice).toFixed(4)}`);
        console.log(`   PROFIT:    ${opp.profitPercent.toFixed(2)}% (${opp.urgency})`);
        console.log(`   Recommended size: $${opp.recommendedSize}`);
        console.log("");
      }
    }

    // Show some sample markets for context
    console.log("\n📋 Sample Active Crypto Markets:");
    for (const market of markets.slice(0, 5)) {
      console.log(`   • ${market.question}`);
    }

  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
  }

  console.log("\n" + "═".repeat(50));
  console.log("Scan complete.\n");
}

main();
