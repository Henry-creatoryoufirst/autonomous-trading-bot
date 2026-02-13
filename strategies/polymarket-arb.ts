/**
 * Polymarket Arbitrage Strategy
 *
 * THE $500K STRATEGY from X posts:
 * - Monitor 5-minute and 15-minute BTC/ETH markets
 * - When YES + NO prices sum to less than $1, buy both
 * - Guaranteed profit regardless of outcome
 *
 * Key insight from @0x_Discover:
 * "When temporary inefficiencies appear -- where YES + NO briefly price below $1 --
 * the system executes instantly. No prediction. No directional bias. Just structural arbitrage."
 *
 * Stats from successful traders:
 * - 29,256 trades → $500K profit
 * - 4,507 predictions in 24 hours → $56K profit
 * - Each trade earns cents, but volume compounds
 */

import { PolymarketService, ArbitrageOpportunity, PolymarketMarket } from "../services/polymarket.js";

export interface ArbitrageConfig {
  // Minimum spread to consider (as decimal, e.g., 0.02 = 2%)
  minSpread: number;
  // Maximum amount per arbitrage trade
  maxTradeSize: number;
  // Minimum liquidity required in market
  minLiquidity: number;
  // How often to scan (milliseconds)
  scanInterval: number;
  // Whether to actually execute trades
  tradingEnabled: boolean;
}

export interface ArbitrageResult {
  timestamp: Date;
  market: string;
  yesPrice: number;
  noPrice: number;
  spread: number;
  amountTraded: number;
  profit: number;
  success: boolean;
  txHash?: string;
  error?: string;
}

export class PolymarketArbStrategy {
  private polymarket: PolymarketService;
  private config: ArbitrageConfig;
  private results: ArbitrageResult[] = [];
  private isRunning: boolean = false;
  private scanCount: number = 0;
  private opportunitiesFound: number = 0;
  private totalProfit: number = 0;

  constructor(config: Partial<ArbitrageConfig> = {}) {
    this.polymarket = new PolymarketService(
      process.env.POLYMARKET_API_KEY,
      process.env.POLYMARKET_PRIVATE_KEY
    );

    this.config = {
      minSpread: config.minSpread ?? 0.02,           // 2% minimum
      maxTradeSize: config.maxTradeSize ?? 100,      // $100 max per trade
      minLiquidity: config.minLiquidity ?? 1000,     // $1000 min liquidity
      scanInterval: config.scanInterval ?? 30000,    // 30 seconds
      tradingEnabled: config.tradingEnabled ?? false,
    };
  }

  /**
   * Run a single arbitrage scan
   */
  async scan(): Promise<ArbitrageOpportunity[]> {
    this.scanCount++;
    console.log(`\n🔍 Arbitrage Scan #${this.scanCount}`);

    const opportunities = await this.polymarket.scanForArbitrage();

    if (opportunities.length === 0) {
      console.log("   No arbitrage opportunities found");
      return [];
    }

    console.log(`   Found ${opportunities.length} potential opportunities:`);

    for (const opp of opportunities) {
      this.opportunitiesFound++;
      const emoji = opp.urgency === "HIGH" ? "🔥" : opp.urgency === "MEDIUM" ? "⚡" : "📊";
      console.log(`   ${emoji} ${opp.market.question.substring(0, 50)}...`);
      console.log(`      YES: $${opp.yesPrice.toFixed(3)} | NO: $${opp.noPrice.toFixed(3)} | Profit: ${opp.profitPercent.toFixed(2)}%`);
    }

    return opportunities;
  }

  /**
   * Execute arbitrage on a specific opportunity
   */
  async execute(opportunity: ArbitrageOpportunity): Promise<ArbitrageResult> {
    const tradeAmount = Math.min(opportunity.recommendedSize, this.config.maxTradeSize);

    console.log(`\n💰 Executing Arbitrage Trade`);
    console.log(`   Market: ${opportunity.market.question}`);
    console.log(`   Amount: $${tradeAmount}`);
    console.log(`   Expected Profit: $${(tradeAmount * opportunity.profitPercent / 100).toFixed(2)}`);

    if (!this.config.tradingEnabled) {
      console.log("   ⚠️ Trading disabled - dry run only");
      return {
        timestamp: new Date(),
        market: opportunity.market.question,
        yesPrice: opportunity.yesPrice,
        noPrice: opportunity.noPrice,
        spread: opportunity.profitPercent / 100,
        amountTraded: 0,
        profit: 0,
        success: false,
        error: "Trading disabled",
      };
    }

    const result = await this.polymarket.executeArbitrage(opportunity, tradeAmount);

    const arbResult: ArbitrageResult = {
      timestamp: new Date(),
      market: opportunity.market.question,
      yesPrice: opportunity.yesPrice,
      noPrice: opportunity.noPrice,
      spread: opportunity.profitPercent / 100,
      amountTraded: result.success ? tradeAmount : 0,
      profit: result.success ? (tradeAmount * opportunity.profitPercent / 100) : 0,
      success: result.success,
      txHash: result.txHash,
      error: result.error,
    };

    this.results.push(arbResult);
    if (arbResult.success) {
      this.totalProfit += arbResult.profit;
    }

    return arbResult;
  }

  /**
   * Run continuous arbitrage scanning and execution
   */
  async startContinuousScanning(): Promise<void> {
    if (this.isRunning) {
      console.log("Arbitrage scanner already running");
      return;
    }

    this.isRunning = true;
    console.log("\n🚀 Starting Polymarket Arbitrage Scanner");
    console.log(`   Min Spread: ${this.config.minSpread * 100}%`);
    console.log(`   Max Trade: $${this.config.maxTradeSize}`);
    console.log(`   Scan Interval: ${this.config.scanInterval / 1000}s`);
    console.log(`   Trading: ${this.config.tradingEnabled ? "ENABLED" : "DISABLED (dry run)"}`);

    while (this.isRunning) {
      try {
        const opportunities = await this.scan();

        // Execute on HIGH urgency opportunities
        const highUrgency = opportunities.filter(o => o.urgency === "HIGH");
        for (const opp of highUrgency) {
          await this.execute(opp);
        }

        // Wait for next scan
        await new Promise(resolve => setTimeout(resolve, this.config.scanInterval));
      } catch (error: any) {
        console.error("Scan cycle error:", error.message);
        // Continue scanning even on errors
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  /**
   * Stop continuous scanning
   */
  stop(): void {
    this.isRunning = false;
    console.log("\n⏹️ Arbitrage scanner stopped");
    this.printSummary();
  }

  /**
   * Print performance summary
   */
  printSummary(): void {
    console.log("\n" + "=".repeat(50));
    console.log("📊 ARBITRAGE STRATEGY SUMMARY");
    console.log("=".repeat(50));
    console.log(`Total Scans: ${this.scanCount}`);
    console.log(`Opportunities Found: ${this.opportunitiesFound}`);
    console.log(`Trades Executed: ${this.results.filter(r => r.success).length}`);
    console.log(`Total Profit: $${this.totalProfit.toFixed(2)}`);
    console.log("=".repeat(50));
  }

  /**
   * Get current stats
   */
  getStats() {
    return {
      scanCount: this.scanCount,
      opportunitiesFound: this.opportunitiesFound,
      tradesExecuted: this.results.filter(r => r.success).length,
      totalProfit: this.totalProfit,
      results: this.results,
      isRunning: this.isRunning,
    };
  }
}

// Export factory function
export function createArbStrategy(config?: Partial<ArbitrageConfig>): PolymarketArbStrategy {
  return new PolymarketArbStrategy(config);
}
