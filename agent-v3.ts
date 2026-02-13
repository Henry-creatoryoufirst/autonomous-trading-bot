/**
 * Henry's Autonomous Trading Agent v3.0
 *
 * MAJOR UPGRADE: Multi-Strategy Architecture
 *
 * Strategies:
 * 1. Polymarket Arbitrage (NEW) - The $500K strategy from X posts
 * 2. Base DEX Trading (IMPROVED) - Sentiment-based swaps
 *
 * Key improvements:
 * - FIXED: Trade amount syntax (was sending token qty, now sends USD value)
 * - NEW: Asymmetric limits - conservative buys ($10), flexible sells (take profits)
 * - NEW: Polymarket 5-minute market integration
 * - NEW: Balance-aware trading
 *
 * Your wallet: 0x55509AA76E2769eCCa5B4293359e3001dA16dd0F
 */

import Anthropic from "@anthropic-ai/sdk";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as dotenv from "dotenv";
import cron from "node-cron";
import axios from "axios";
import { PolymarketService } from "./services/polymarket.js";

dotenv.config();

const execAsync = promisify(exec);

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Wallet
  walletAddress: process.env.WALLET_ADDRESS || "0x55509AA76E2769eCCa5B4293359e3001dA16dd0F",

  // Base DEX Trading
  baseDex: {
    enabled: true,
    // ASYMMETRIC LIMITS: Conservative buys, flexible sells
    maxBuySize: parseFloat(process.env.MAX_BUY_SIZE_USDC || "10"),     // Conservative buys
    maxSellPercent: parseFloat(process.env.MAX_SELL_PERCENT || "50"),  // Can sell up to 50% of position
    intervalMinutes: parseInt(process.env.TRADING_INTERVAL_MINUTES || "15"),
    tradingEnabled: process.env.TRADING_ENABLED === "true",
  },

  // Polymarket Arbitrage
  polymarketArb: {
    enabled: process.env.POLYMARKET_ARB_ENABLED === "true",
    minSpread: parseFloat(process.env.POLYMARKET_MIN_SPREAD || "0.02"),
    maxTradeSize: parseFloat(process.env.POLYMARKET_MAX_TRADE || "50"),
    tradingEnabled: process.env.POLYMARKET_TRADING_ENABLED === "true",
  },

  // Tokens
  activeTokens: ["ETH", "cbBTC", "AERO", "BRETT", "DEGEN", "WELL"],

  // Logging
  logFile: "./logs/trades.json",
};

// Token definitions
const BASE_TOKENS: Record<string, { address: string; symbol: string; name: string; coingeckoId: string }> = {
  USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", name: "USD Coin", coingeckoId: "usd-coin" },
  ETH: { address: "native", symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum" },
  WETH: { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ethereum", coingeckoId: "ethereum" },
  cbBTC: { address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", symbol: "cbBTC", name: "Coinbase Wrapped BTC", coingeckoId: "bitcoin" },
  cbETH: { address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", symbol: "cbETH", name: "Coinbase Staked ETH", coingeckoId: "coinbase-wrapped-staked-eth" },
  AERO: { address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", symbol: "AERO", name: "Aerodrome Finance", coingeckoId: "aerodrome-finance" },
  BRETT: { address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", symbol: "BRETT", name: "Brett", coingeckoId: "brett" },
  DEGEN: { address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", symbol: "DEGEN", name: "Degen", coingeckoId: "degen-base" },
  WELL: { address: "0xA88594D404727625A9437C3f886C7643872296AE", symbol: "WELL", name: "Moonwell", coingeckoId: "moonwell" },
};

// Initialize services
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const polymarketService = new PolymarketService(
  process.env.POLYMARKET_API_KEY,
  process.env.POLYMARKET_PRIVATE_KEY
);

// ============================================================================
// STATE & TRADE HISTORY
// ============================================================================

interface TradeRecord {
  timestamp: string;
  cycle: number;
  action: "BUY" | "SELL" | "HOLD";
  fromToken: string;
  toToken: string;
  amountUSD: number;
  tokenAmount?: number;
  txHash?: string;
  success: boolean;
  error?: string;
  portfolioValueBefore: number;
  portfolioValueAfter?: number;
  reasoning: string;
  marketConditions: {
    fearGreed: number;
    ethPrice: number;
    btcPrice: number;
  };
}

interface AgentState {
  startTime: Date;
  totalCycles: number;
  baseDex: {
    lastCheck: Date;
    lastTrade: Date | null;
    totalTrades: number;
    successfulTrades: number;
    balances: { symbol: string; balance: number; usdValue: number; price?: number }[];
    totalPortfolioValue: number;
    initialValue: number;
    peakValue: number;
  };
  polymarket: {
    lastScan: Date | null;
    arbitrageOpportunities: number;
    tradesExecuted: number;
    totalProfit: number;
  };
  tradeHistory: TradeRecord[];
}

let state: AgentState = {
  startTime: new Date(),
  totalCycles: 0,
  baseDex: {
    lastCheck: new Date(),
    lastTrade: null,
    totalTrades: 0,
    successfulTrades: 0,
    balances: [],
    totalPortfolioValue: 0,
    initialValue: 230, // Your starting value
    peakValue: 230,
  },
  polymarket: {
    lastScan: null,
    arbitrageOpportunities: 0,
    tradesExecuted: 0,
    totalProfit: 0,
  },
  tradeHistory: [],
};

// Load existing trade history
function loadTradeHistory() {
  try {
    if (fs.existsSync(CONFIG.logFile)) {
      const data = fs.readFileSync(CONFIG.logFile, "utf-8");
      const parsed = JSON.parse(data);
      state.tradeHistory = parsed.trades || [];
      state.baseDex.initialValue = parsed.initialValue || 230;
      state.baseDex.peakValue = parsed.peakValue || 230;
      console.log(`   Loaded ${state.tradeHistory.length} historical trades`);
    }
  } catch (e) {
    console.log("   No existing trade history found");
  }
}

// Save trade history
function saveTradeHistory() {
  try {
    const data = {
      lastUpdated: new Date().toISOString(),
      initialValue: state.baseDex.initialValue,
      peakValue: state.baseDex.peakValue,
      currentValue: state.baseDex.totalPortfolioValue,
      totalTrades: state.baseDex.totalTrades,
      successfulTrades: state.baseDex.successfulTrades,
      trades: state.tradeHistory,
    };
    fs.writeFileSync(CONFIG.logFile, JSON.stringify(data, null, 2));
  } catch (e: any) {
    console.error("Failed to save trade history:", e.message);
  }
}

// ============================================================================
// AWAL CLI HELPERS
// ============================================================================

async function executeAwalCommand(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(`npx awal ${command}`, { timeout: 60000 });
    if (stderr && !stderr.includes("npm warn") && !stderr.includes("Fetching")) {
      console.error("AWAL stderr:", stderr);
    }
    return stdout;
  } catch (error: any) {
    console.error("AWAL command failed:", error.message);
    throw error;
  }
}

async function getBalances(): Promise<{ symbol: string; balance: number; usdValue: number; price?: number }[]> {
  try {
    const output = await executeAwalCommand("balance");
    const balances: { symbol: string; balance: number; usdValue: number; price?: number }[] = [];
    const lines = output.split("\n");

    for (const line of lines) {
      const match = line.match(/(\w+)\s+\$?([\d.]+)/);
      if (match) {
        const symbol = match[1];
        const balance = parseFloat(match[2]);
        if (balance > 0 || ["USDC", "ETH", "WETH"].includes(symbol)) {
          balances.push({ symbol, balance, usdValue: symbol === "USDC" ? balance : 0 });
        }
      }
    }
    return balances;
  } catch (error) {
    console.error("Failed to get balances:", error);
    return [];
  }
}

function getTokenIdentifier(symbol: string): string {
  if (["usdc", "eth", "weth"].includes(symbol.toLowerCase())) {
    return symbol.toLowerCase();
  }
  const token = BASE_TOKENS[symbol];
  if (token && token.address !== "native") {
    return token.address;
  }
  return symbol.toLowerCase();
}

// ============================================================================
// MARKET DATA
// ============================================================================

interface MarketData {
  tokens: { symbol: string; name: string; price: number; priceChange24h: number; priceChange7d: number; volume24h: number }[];
  fearGreed: { value: number; classification: string };
}

async function getMarketData(): Promise<MarketData> {
  try {
    const fngResponse = await axios.get("https://api.alternative.me/fng/", { timeout: 10000 });
    const fearGreed = {
      value: parseInt(fngResponse.data.data[0].value),
      classification: fngResponse.data.data[0].value_classification,
    };

    const coingeckoIds = [...new Set(
      CONFIG.activeTokens.map(symbol => BASE_TOKENS[symbol]?.coingeckoId).filter(Boolean)
    )].join(",");

    const marketResponse = await axios.get(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coingeckoIds}&order=market_cap_desc&sparkline=false&price_change_percentage=24h,7d`,
      { timeout: 10000 }
    );

    const tokens = marketResponse.data.map((coin: any) => {
      const symbol = Object.keys(BASE_TOKENS).find(s => BASE_TOKENS[s].coingeckoId === coin.id) || coin.symbol.toUpperCase();
      return {
        symbol,
        name: coin.name,
        price: coin.current_price,
        priceChange24h: coin.price_change_percentage_24h || 0,
        priceChange7d: coin.price_change_percentage_7d_in_currency || 0,
        volume24h: coin.total_volume,
      };
    });

    return { tokens, fearGreed };
  } catch (error) {
    console.error("Failed to fetch market data:", error);
    return { tokens: [], fearGreed: { value: 50, classification: "Neutral" } };
  }
}

// ============================================================================
// AI TRADING DECISION - IMPROVED WITH ASYMMETRIC LIMITS
// ============================================================================

interface TradeDecision {
  action: "BUY" | "SELL" | "HOLD";
  fromToken: string;
  toToken: string;
  amountUSD: number;      // USD value to trade
  tokenAmount?: number;   // Calculated token amount for execution
  reasoning: string;
}

async function makeTradeDecision(
  balances: { symbol: string; balance: number; usdValue: number; price?: number }[],
  marketData: MarketData,
  totalPortfolioValue: number
): Promise<TradeDecision> {

  // Calculate available amounts for ALL tokens
  const usdcBalance = balances.find(b => b.symbol === "USDC");
  const availableUSDC = usdcBalance?.balance || 0;

  // Build holdings summary for all tokens
  const holdingsSummary: string[] = [];
  const tokenHoldings: { symbol: string; balance: number; usdValue: number; price: number }[] = [];

  for (const symbol of CONFIG.activeTokens) {
    const balance = balances.find(b => b.symbol === symbol);
    const tokenData = marketData.tokens.find(t => t.symbol === symbol);
    if (balance && balance.usdValue > 0.50) {
      const price = tokenData?.price || balance.price || 0;
      holdingsSummary.push(`- ${symbol}: ${balance.balance.toFixed(6)} ($${balance.usdValue.toFixed(2)}) | 24h: ${tokenData?.priceChange24h?.toFixed(1) || 0}%`);
      tokenHoldings.push({ symbol, balance: balance.balance, usdValue: balance.usdValue, price });
    }
  }

  // Calculate total sellable value (all non-USDC holdings)
  const totalTokenValue = tokenHoldings.reduce((sum, t) => sum + t.usdValue, 0);

  // ASYMMETRIC LIMITS
  const maxBuyAmount = Math.min(CONFIG.baseDex.maxBuySize, availableUSDC);
  const maxSellAmount = totalTokenValue * (CONFIG.baseDex.maxSellPercent / 100);

  // Check if we have anything to trade
  if (availableUSDC < 1 && totalTokenValue < 5) {
    return {
      action: "HOLD",
      fromToken: "NONE",
      toToken: "NONE",
      amountUSD: 0,
      reasoning: `Portfolio too small for meaningful trades. USDC: $${availableUSDC.toFixed(2)}, Tokens: $${totalTokenValue.toFixed(2)}`,
    };
  }

  // Build market data for all tokens
  const marketSummary = marketData.tokens.map(t =>
    `- ${t.symbol}: $${t.price.toFixed(2)} | 24h: ${t.priceChange24h?.toFixed(1) || 0}% | 7d: ${t.priceChange7d?.toFixed(1) || 0}%`
  ).join("\n");

  // Available tokens for diversification
  const availableTokens = CONFIG.activeTokens.join(", ");

  const systemPrompt = `You are an autonomous crypto trading agent on Base network with DIVERSIFICATION capabilities.

PORTFOLIO STATUS:
- USDC Balance: $${availableUSDC.toFixed(2)} (dry powder for buying)
- Total Holdings: $${totalTokenValue.toFixed(2)} across tokens
- Total Portfolio: $${totalPortfolioValue.toFixed(2)}
- Initial Value: $${state.baseDex.initialValue}
- Peak Value: $${state.baseDex.peakValue.toFixed(2)}
- Current P&L: ${((totalPortfolioValue - state.baseDex.initialValue) / state.baseDex.initialValue * 100).toFixed(1)}%

CURRENT HOLDINGS:
${holdingsSummary.length > 0 ? holdingsSummary.join("\n") : "- No token holdings yet"}

AVAILABLE TOKENS FOR TRADING:
${availableTokens}
(You can BUY any of these with USDC, or SELL any holding back to USDC)

TRADING LIMITS (Asymmetric - Conservative Buys, Flexible Sells):
- MAX BUY: $${maxBuyAmount.toFixed(2)} per trade (conservative position building)
- MAX SELL: $${maxSellAmount.toFixed(2)} total (${CONFIG.baseDex.maxSellPercent}% of holdings)

MARKET CONDITIONS:
- Fear & Greed: ${marketData.fearGreed.value} (${marketData.fearGreed.classification})

TOKEN PRICES & PERFORMANCE:
${marketSummary}

DIVERSIFICATION STRATEGY:
1. DON'T put all eggs in one basket - spread across ETH, cbBTC, and high-conviction altcoins
2. Core holdings (60-70%): ETH and cbBTC (safer, more liquid)
3. Satellite positions (30-40%): AERO, BRETT, DEGEN, WELL (higher risk/reward)
4. BUY on extreme fear (index < 25) - DCA into positions
5. Consider REBALANCING: sell overweight positions, buy underweight ones
6. TAKE PROFITS when any position is up significantly (>10% in 24h)

DECISION RULES:
- If you have USDC and fear is extreme → BUY diversified (spread across multiple tokens)
- If one token is pumping hard (>8% 24h) → Consider taking some profits
- If portfolio is too concentrated in one token → Rebalance
- If uncertain → HOLD

Respond with ONLY valid JSON:
{
  "action": "BUY" | "SELL" | "HOLD",
  "fromToken": "USDC" or any token symbol (${availableTokens}),
  "toToken": any token symbol (${availableTokens}) or "USDC",
  "amountUSD": <number - USD value to trade>,
  "reasoning": "<1-2 sentence explanation>"
}

For BUY: fromToken=USDC, toToken=any token, max amountUSD=${maxBuyAmount.toFixed(2)}
For SELL: fromToken=any held token, toToken=USDC, max amountUSD=${maxSellAmount.toFixed(2)}
For HOLD: set amountUSD=0`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [{ role: "user", content: systemPrompt }],
    });

    const content = response.content[0];
    if (content.type === "text") {
      let text = content.text.trim();
      if (text.startsWith("```")) {
        text = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      }
      const decision = JSON.parse(text);

      // Validate token symbols
      const validTokens = ["USDC", ...CONFIG.activeTokens];
      if (!validTokens.includes(decision.fromToken) || !validTokens.includes(decision.toToken)) {
        return { action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: "Invalid token in AI response" };
      }

      // Validate and cap amounts
      if (decision.action === "BUY") {
        decision.amountUSD = Math.min(decision.amountUSD, maxBuyAmount);
        if (decision.amountUSD < 0.50) {
          decision.action = "HOLD";
          decision.reasoning = "Buy amount too small, holding instead.";
        }
      } else if (decision.action === "SELL") {
        // Find the specific holding being sold
        const holdingToSell = tokenHoldings.find(h => h.symbol === decision.fromToken);
        if (!holdingToSell) {
          return { action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: `Don't hold ${decision.fromToken} to sell` };
        }

        // Cap sell amount at holding value * max sell percent
        const maxSellForToken = holdingToSell.usdValue * (CONFIG.baseDex.maxSellPercent / 100);
        decision.amountUSD = Math.min(decision.amountUSD, maxSellForToken);

        // Calculate token amount for selling
        decision.tokenAmount = decision.amountUSD / holdingToSell.price;

        if (decision.amountUSD < 1) {
          decision.action = "HOLD";
          decision.reasoning = "Sell amount too small, holding instead.";
        }
      }

      return decision;
    }

    return { action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: "Failed to parse AI response" };
  } catch (error: any) {
    console.error("AI decision failed:", error.message);
    return { action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: `Error: ${error.message}` };
  }
}

// ============================================================================
// TRADE EXECUTION - FIXED AMOUNT SYNTAX
// ============================================================================

async function executeTrade(
  decision: TradeDecision,
  marketData: MarketData
): Promise<{ success: boolean; txHash?: string; error?: string }> {

  if (!CONFIG.baseDex.tradingEnabled) {
    console.log("   ⚠️ Trading disabled - dry run");
    return { success: false, error: "Trading disabled" };
  }

  const portfolioValueBefore = state.baseDex.totalPortfolioValue;

  try {
    const fromId = getTokenIdentifier(decision.fromToken);
    const toId = getTokenIdentifier(decision.toToken);

    // CRITICAL FIX: Use correct amount format for awal CLI
    // For USDC buys: use $X format
    // For token sells: use token amount (calculated from USD value)
    let amountArg: string;

    if (decision.fromToken === "USDC") {
      // Buying with USDC - use plain number (no $ symbol)
      amountArg = decision.amountUSD.toFixed(2);
    } else {
      // Selling tokens - use pre-calculated token amount if available
      if (decision.tokenAmount) {
        amountArg = decision.tokenAmount.toFixed(6);
      } else {
        // Fallback: calculate from market data
        const tokenPrice = marketData.tokens.find(t => t.symbol === decision.fromToken)?.price || 2000;
        const tokenAmount = decision.amountUSD / tokenPrice;
        amountArg = tokenAmount.toFixed(6);
      }
    }

    console.log(`   🔄 Executing: ${amountArg} ${decision.fromToken} → ${decision.toToken}`);
    console.log(`   Command: awal trade ${amountArg} ${fromId} ${toId}`);

    const output = await executeAwalCommand(`trade ${amountArg} ${fromId} ${toId}`);

    const txHashMatch = output.match(/Transaction: (0x[a-fA-F0-9]+)/);
    const txHash = txHashMatch ? txHashMatch[1] : undefined;

    state.baseDex.lastTrade = new Date();
    state.baseDex.totalTrades++;
    state.baseDex.successfulTrades++;

    // Record the trade
    const tradeRecord: TradeRecord = {
      timestamp: new Date().toISOString(),
      cycle: state.totalCycles,
      action: decision.action,
      fromToken: decision.fromToken,
      toToken: decision.toToken,
      amountUSD: decision.amountUSD,
      tokenAmount: decision.tokenAmount,
      txHash,
      success: true,
      portfolioValueBefore,
      reasoning: decision.reasoning,
      marketConditions: {
        fearGreed: marketData.fearGreed.value,
        ethPrice: marketData.tokens.find(t => t.symbol === "ETH")?.price || 0,
        btcPrice: marketData.tokens.find(t => t.symbol === "cbBTC")?.price || 0,
      },
    };
    state.tradeHistory.push(tradeRecord);
    saveTradeHistory();

    console.log(`   ✅ Trade executed! TX: ${txHash}`);
    console.log(`   📝 View: https://basescan.org/tx/${txHash}`);

    return { success: true, txHash };
  } catch (error: any) {
    // Record failed trade
    const tradeRecord: TradeRecord = {
      timestamp: new Date().toISOString(),
      cycle: state.totalCycles,
      action: decision.action,
      fromToken: decision.fromToken,
      toToken: decision.toToken,
      amountUSD: decision.amountUSD,
      success: false,
      error: error.message,
      portfolioValueBefore,
      reasoning: decision.reasoning,
      marketConditions: {
        fearGreed: marketData.fearGreed.value,
        ethPrice: marketData.tokens.find(t => t.symbol === "ETH")?.price || 0,
        btcPrice: marketData.tokens.find(t => t.symbol === "cbBTC")?.price || 0,
      },
    };
    state.tradeHistory.push(tradeRecord);
    state.baseDex.totalTrades++;
    saveTradeHistory();

    console.error(`   ❌ Trade failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// STRATEGY RUNNERS
// ============================================================================

async function runPolymarketArbStrategy() {
  if (!CONFIG.polymarketArb.enabled) return;

  console.log("\n" + "─".repeat(50));
  console.log("📊 POLYMARKET ARBITRAGE SCAN");
  console.log("─".repeat(50));

  try {
    const opportunities = await polymarketService.scanForArbitrage();
    state.polymarket.lastScan = new Date();
    state.polymarket.arbitrageOpportunities += opportunities.length;

    if (opportunities.length === 0) {
      console.log("   No arbitrage opportunities found");
      return;
    }

    console.log(`   Found ${opportunities.length} opportunities:`);
    for (const opp of opportunities.slice(0, 3)) {
      const emoji = opp.urgency === "HIGH" ? "🔥" : opp.urgency === "MEDIUM" ? "⚡" : "📊";
      console.log(`   ${emoji} ${opp.market.question.substring(0, 40)}...`);
      console.log(`      Spread: ${opp.profitPercent.toFixed(2)}% profit potential`);
    }
  } catch (error: any) {
    console.error("   Polymarket scan error:", error.message);
  }
}

async function runBaseDexStrategy() {
  if (!CONFIG.baseDex.enabled) return;

  console.log("\n" + "─".repeat(50));
  console.log("🔗 BASE DEX TRADING");
  console.log("─".repeat(50));

  try {
    // Get balances
    console.log("   Fetching balances...");
    const balances = await getBalances();
    state.baseDex.balances = balances;

    // Get market data
    console.log("   Fetching market data...");
    const marketData = await getMarketData();

    // Update USD values and prices
    for (const balance of balances) {
      if (balance.symbol !== "USDC") {
        const tokenData = marketData.tokens.find(t => t.symbol === balance.symbol);
        if (tokenData) {
          balance.usdValue = balance.balance * tokenData.price;
          balance.price = tokenData.price;
        }
      }
    }

    state.baseDex.totalPortfolioValue = balances.reduce((sum, b) => sum + b.usdValue, 0);

    // Update peak value
    if (state.baseDex.totalPortfolioValue > state.baseDex.peakValue) {
      state.baseDex.peakValue = state.baseDex.totalPortfolioValue;
    }

    // Display status
    const pnl = state.baseDex.totalPortfolioValue - state.baseDex.initialValue;
    const pnlPercent = (pnl / state.baseDex.initialValue) * 100;
    const drawdown = ((state.baseDex.peakValue - state.baseDex.totalPortfolioValue) / state.baseDex.peakValue) * 100;

    console.log(`   Portfolio: $${state.baseDex.totalPortfolioValue.toFixed(2)}`);
    console.log(`   P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(1)}%)`);
    console.log(`   Peak: $${state.baseDex.peakValue.toFixed(2)} | Drawdown: ${drawdown.toFixed(1)}%`);
    console.log(`   Fear & Greed: ${marketData.fearGreed.value} (${marketData.fearGreed.classification})`);

    // AI decision
    console.log("\n   🧠 AI analyzing...");
    const decision = await makeTradeDecision(balances, marketData, state.baseDex.totalPortfolioValue);

    console.log(`   Decision: ${decision.action}`);
    if (decision.action !== "HOLD") {
      console.log(`   Trade: $${decision.amountUSD.toFixed(2)} ${decision.fromToken} → ${decision.toToken}`);
    }
    console.log(`   Reasoning: ${decision.reasoning}`);

    // Execute if needed
    if ((decision.action === "BUY" || decision.action === "SELL") && decision.amountUSD >= 0.50) {
      await executeTrade(decision, marketData);
    }

    state.baseDex.lastCheck = new Date();
  } catch (error: any) {
    console.error("   Base DEX error:", error.message);
  }
}

// ============================================================================
// MAIN TRADING CYCLE
// ============================================================================

async function runTradingCycle() {
  state.totalCycles++;

  console.log("\n" + "═".repeat(70));
  console.log(`🤖 TRADING CYCLE #${state.totalCycles} | ${new Date().toISOString()}`);
  console.log("═".repeat(70));

  await runPolymarketArbStrategy();
  await runBaseDexStrategy();

  // Summary
  console.log("\n" + "═".repeat(70));
  console.log("📊 CYCLE SUMMARY");
  console.log(`   Portfolio: $${state.baseDex.totalPortfolioValue.toFixed(2)}`);
  console.log(`   Trades: ${state.baseDex.successfulTrades}/${state.baseDex.totalTrades} successful`);
  console.log(`   Polymarket Opps Found: ${state.polymarket.arbitrageOpportunities}`);
  console.log(`   Next cycle in ${CONFIG.baseDex.intervalMinutes} minutes`);
  console.log("═".repeat(70));
}

// ============================================================================
// STARTUP
// ============================================================================

function displayBanner() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   🤖 HENRY'S AUTONOMOUS TRADING AGENT v3.0                          ║
║   ═══════════════════════════════════════                            ║
║                                                                      ║
║   MULTI-STRATEGY | ASYMMETRIC LIMITS | PROFIT-TAKING ENABLED        ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  console.log("📍 Configuration:");
  console.log(`   Wallet: ${CONFIG.walletAddress}`);
  console.log("");
  console.log("   BASE DEX (Asymmetric Limits):");
  console.log(`   • Trading: ${CONFIG.baseDex.tradingEnabled ? "LIVE" : "DRY RUN"}`);
  console.log(`   • Max BUY: $${CONFIG.baseDex.maxBuySize} (conservative)`);
  console.log(`   • Max SELL: ${CONFIG.baseDex.maxSellPercent}% of position (take profits)`);
  console.log(`   • Interval: ${CONFIG.baseDex.intervalMinutes} min`);
  console.log("");
  console.log("   POLYMARKET ARBITRAGE:");
  console.log(`   • Enabled: ${CONFIG.polymarketArb.enabled}`);
  console.log(`   • Min Spread: ${CONFIG.polymarketArb.minSpread * 100}%`);
  console.log("");
}

async function main() {
  displayBanner();

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  // Load history
  loadTradeHistory();

  // Run immediately
  await runTradingCycle();

  // Schedule recurring cycles
  const cronExpression = `*/${CONFIG.baseDex.intervalMinutes} * * * *`;
  cron.schedule(cronExpression, runTradingCycle);

  console.log("\n🚀 Agent running! Press Ctrl+C to stop.\n");
}

main().catch(console.error);
