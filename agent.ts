/**
 * Henry's Autonomous Trading Agent v2.0
 *
 * FULL MARKET OBSERVER - Can trade ANY asset on Base network
 *
 * This agent monitors the entire crypto market and makes trading decisions
 * across all available assets, not just ETH/USDC.
 *
 * How it works:
 * 1. Fetches market data for top cryptocurrencies
 * 2. Analyzes trends, sentiment, and opportunities across ALL assets
 * 3. AI (Claude) decides which assets to buy/sell
 * 4. Executes trades via the `awal` CLI using contract addresses
 * 5. Logs all activity for transparency
 *
 * Your wallet: 0x55509AA76E2769eCCa5B4293359e3001dA16dd0F
 */

import Anthropic from "@anthropic-ai/sdk";
import { exec } from "child_process";
import { promisify } from "util";
import * as dotenv from "dotenv";
import cron from "node-cron";
import axios from "axios";

dotenv.config();

const execAsync = promisify(exec);

// ============================================================================
// SUPPORTED ASSETS ON BASE NETWORK
// ============================================================================
// These are popular tokens available on Base with their contract addresses
// The AI can choose to trade any of these based on market conditions

const BASE_TOKENS: Record<string, { address: string; symbol: string; name: string; coingeckoId: string }> = {
  // Stablecoins
  USDC: {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    symbol: "USDC",
    name: "USD Coin",
    coingeckoId: "usd-coin",
  },

  // Major cryptocurrencies
  ETH: {
    address: "native", // ETH is native, use "eth" in awal
    symbol: "ETH",
    name: "Ethereum",
    coingeckoId: "ethereum",
  },
  WETH: {
    address: "0x4200000000000000000000000000000000000006",
    symbol: "WETH",
    name: "Wrapped Ethereum",
    coingeckoId: "ethereum",
  },
  cbBTC: {
    address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    symbol: "cbBTC",
    name: "Coinbase Wrapped BTC",
    coingeckoId: "bitcoin",
  },
  cbETH: {
    address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    symbol: "cbETH",
    name: "Coinbase Staked ETH",
    coingeckoId: "coinbase-wrapped-staked-eth",
  },

  // Base ecosystem tokens
  AERO: {
    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    symbol: "AERO",
    name: "Aerodrome Finance",
    coingeckoId: "aerodrome-finance",
  },
  BRETT: {
    address: "0x532f27101965dd16442E59d40670FaF5eBB142E4",
    symbol: "BRETT",
    name: "Brett",
    coingeckoId: "brett",
  },
  DEGEN: {
    address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
    symbol: "DEGEN",
    name: "Degen",
    coingeckoId: "degen-base",
  },
  TOSHI: {
    address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4",
    symbol: "TOSHI",
    name: "Toshi",
    coingeckoId: "toshi",
  },

  // DeFi tokens
  WELL: {
    address: "0xA88594D404727625A9437C3f886C7643872296AE",
    symbol: "WELL",
    name: "Moonwell",
    coingeckoId: "moonwell",
  },
  SEAM: {
    address: "0x1C7a460413dD4e964f96D8dFC56E7223cE88CD85",
    symbol: "SEAM",
    name: "Seamless Protocol",
    coingeckoId: "seamless-protocol",
  },

  // Memecoins
  MOCHI: {
    address: "0xF6e932Ca12afa26665dC4dDE7e27be02A7c02e50",
    symbol: "MOCHI",
    name: "Mochi",
    coingeckoId: "mochi-token",
  },
  NORMIE: {
    address: "0x7F12d13B34F5F4f0a9449c16Bcd42f0da47AF200",
    symbol: "NORMIE",
    name: "Normie",
    coingeckoId: "normie-base",
  },
};

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  walletAddress: process.env.WALLET_ADDRESS || "0x55509AA76E2769eCCa5B4293359e3001dA16dd0F",
  maxTradeSize: parseFloat(process.env.MAX_TRADE_SIZE_USDC || "10"),
  tradingEnabled: process.env.TRADING_ENABLED === "true",
  intervalMinutes: parseInt(process.env.TRADING_INTERVAL_MINUTES || "15"),
  // Which tokens we want to actively track and potentially trade
  activeTokens: ["ETH", "cbBTC", "AERO", "BRETT", "DEGEN", "WELL"],
};

// Initialize Claude
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ============================================================================
// TYPES
// ============================================================================

interface TokenBalance {
  symbol: string;
  balance: number;
  usdValue: number;
}

interface TokenMarketData {
  symbol: string;
  name: string;
  price: number;
  marketCap: number;
  volume24h: number;
  priceChange24h: number;
  priceChange7d: number;
  priceChange30d?: number;
  rank?: number;
}

interface TradingState {
  lastCheck: Date;
  lastTrade: Date | null;
  totalTrades: number;
  balances: TokenBalance[];
  totalPortfolioValue: number;
}

interface TradeDecision {
  action: "BUY" | "SELL" | "HOLD";
  fromToken: string;
  toToken: string;
  amount: number;
  reasoning: string;
}

let state: TradingState = {
  lastCheck: new Date(),
  lastTrade: null,
  totalTrades: 0,
  balances: [],
  totalPortfolioValue: 0,
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Execute awal CLI command
 */
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

/**
 * Get current wallet balances
 */
async function getBalances(): Promise<TokenBalance[]> {
  try {
    const output = await executeAwalCommand("balance");

    // Parse the balance output
    const balances: TokenBalance[] = [];
    const lines = output.split("\n");

    for (const line of lines) {
      // Match lines like "USDC    $230.00" or "ETH     0.00"
      const match = line.match(/(\w+)\s+\$?([\d.]+)/);
      if (match) {
        const symbol = match[1];
        const balance = parseFloat(match[2]);
        if (balance > 0 || ["USDC", "ETH", "WETH"].includes(symbol)) {
          balances.push({
            symbol,
            balance,
            usdValue: symbol === "USDC" ? balance : 0, // Will be updated with prices
          });
        }
      }
    }

    return balances;
  } catch (error) {
    console.error("Failed to get balances:", error);
    return [];
  }
}

/**
 * Fetch market data for multiple tokens from CoinGecko
 */
async function getMarketData(): Promise<{ tokens: TokenMarketData[]; fearGreed: { value: number; classification: string } }> {
  try {
    // Get Fear & Greed Index
    const fngResponse = await axios.get("https://api.alternative.me/fng/", { timeout: 10000 });
    const fearGreed = {
      value: parseInt(fngResponse.data.data[0].value),
      classification: fngResponse.data.data[0].value_classification,
    };

    // Get market data for our tracked tokens
    const coingeckoIds = [...new Set(
      CONFIG.activeTokens
        .map(symbol => BASE_TOKENS[symbol]?.coingeckoId)
        .filter(Boolean)
    )].join(",");

    const marketResponse = await axios.get(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coingeckoIds}&order=market_cap_desc&sparkline=false&price_change_percentage=24h,7d,30d`,
      { timeout: 10000 }
    );

    const tokens: TokenMarketData[] = marketResponse.data.map((coin: any) => {
      // Find which of our symbols this corresponds to
      const symbol = Object.keys(BASE_TOKENS).find(
        s => BASE_TOKENS[s].coingeckoId === coin.id
      ) || coin.symbol.toUpperCase();

      return {
        symbol,
        name: coin.name,
        price: coin.current_price,
        marketCap: coin.market_cap,
        volume24h: coin.total_volume,
        priceChange24h: coin.price_change_percentage_24h || 0,
        priceChange7d: coin.price_change_percentage_7d_in_currency || 0,
        priceChange30d: coin.price_change_percentage_30d_in_currency || 0,
        rank: coin.market_cap_rank,
      };
    });

    // Also get data for Base-native tokens that might not be on CoinGecko top markets
    const baseTokenIds = ["aerodrome-finance", "brett", "degen-base", "moonwell"].join(",");
    try {
      const baseResponse = await axios.get(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${baseTokenIds}&order=market_cap_desc&sparkline=false&price_change_percentage=24h,7d,30d`,
        { timeout: 10000 }
      );

      for (const coin of baseResponse.data) {
        if (!tokens.find(t => t.name === coin.name)) {
          const symbol = Object.keys(BASE_TOKENS).find(
            s => BASE_TOKENS[s].coingeckoId === coin.id
          ) || coin.symbol.toUpperCase();

          tokens.push({
            symbol,
            name: coin.name,
            price: coin.current_price,
            marketCap: coin.market_cap,
            volume24h: coin.total_volume,
            priceChange24h: coin.price_change_percentage_24h || 0,
            priceChange7d: coin.price_change_percentage_7d_in_currency || 0,
            priceChange30d: coin.price_change_percentage_30d_in_currency || 0,
            rank: coin.market_cap_rank,
          });
        }
      }
    } catch (e) {
      // Continue even if Base tokens fail
    }

    return { tokens, fearGreed };
  } catch (error) {
    console.error("Failed to fetch market data:", error);
    return { tokens: [], fearGreed: { value: 50, classification: "Neutral" } };
  }
}

/**
 * Get the token identifier for awal trade command
 */
function getTokenIdentifier(symbol: string): string {
  // awal supports these aliases directly
  if (["usdc", "eth", "weth"].includes(symbol.toLowerCase())) {
    return symbol.toLowerCase();
  }
  // For other tokens, use contract address
  const token = BASE_TOKENS[symbol];
  if (token && token.address !== "native") {
    return token.address;
  }
  return symbol.toLowerCase();
}

/**
 * Execute a trade via awal CLI
 */
async function executeTrade(
  amount: number,
  fromToken: string,
  toToken: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  if (!CONFIG.tradingEnabled) {
    console.log("⚠️ Trading disabled - would have traded:", { amount, fromToken, toToken });
    return { success: false, error: "Trading disabled" };
  }

  if (amount > CONFIG.maxTradeSize) {
    console.log(`⚠️ Trade size ${amount} exceeds max ${CONFIG.maxTradeSize}, capping...`);
    amount = CONFIG.maxTradeSize;
  }

  try {
    const fromId = getTokenIdentifier(fromToken);
    const toId = getTokenIdentifier(toToken);

    console.log(`🔄 Executing trade: $${amount} ${fromToken} → ${toToken}`);
    console.log(`   Using: awal trade ${amount} ${fromId} ${toId}`);

    const output = await executeAwalCommand(`trade ${amount} ${fromId} ${toId}`);

    // Parse transaction hash from output
    const txHashMatch = output.match(/Transaction: (0x[a-fA-F0-9]+)/);
    const txHash = txHashMatch ? txHashMatch[1] : undefined;

    state.lastTrade = new Date();
    state.totalTrades++;

    console.log(`✅ Trade executed! TX: ${txHash}`);
    console.log(`   View on Basescan: https://basescan.org/tx/${txHash}`);
    return { success: true, txHash };
  } catch (error: any) {
    console.error("❌ Trade failed:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * AI-powered trading decision - now considers ALL assets
 */
async function makeTradeDecision(
  balances: TokenBalance[],
  marketData: { tokens: TokenMarketData[]; fearGreed: { value: number; classification: string } }
): Promise<TradeDecision> {

  const availableTokens = Object.keys(BASE_TOKENS).join(", ");

  const systemPrompt = `You are an autonomous crypto trading agent managing a wallet on Base network.
You have access to trade ANY of these tokens: ${availableTokens}

Your job is to analyze the ENTIRE market and make the best trading decision.

AVAILABLE TOKENS ON BASE:
- USDC: Stablecoin (always worth $1)
- ETH: Ethereum - the main crypto asset
- cbBTC: Coinbase Wrapped Bitcoin - tracks BTC price
- cbETH: Coinbase Staked ETH - ETH + staking yield
- AERO: Aerodrome - largest DEX on Base
- BRETT: Memecoin on Base (high risk/high reward)
- DEGEN: Memecoin popular in Farcaster community
- TOSHI: Base mascot memecoin
- WELL: Moonwell DeFi lending protocol
- SEAM: Seamless Protocol DeFi

TRADING RULES:
1. You can trade FROM any token you hold TO any other token
2. Be conservative - only trade when there's a clear opportunity
3. Never trade more than 20% of total portfolio value in one trade
4. Consider Fear & Greed: <25 = extreme fear (accumulate), >75 = extreme greed (take profits)
5. Memecoins (BRETT, DEGEN, TOSHI) are HIGH RISK - only small positions
6. Blue chips (ETH, cbBTC) are safer for larger positions
7. When in doubt, stay in USDC or HOLD
8. Look for tokens with strong negative 7d/30d change that might be oversold
9. Look for tokens with unusual volume spikes
10. DeFi tokens (AERO, WELL, SEAM) can be good during "risk-on" markets

PORTFOLIO STRATEGY:
- Minimum 40% in stables (USDC) or blue chips (ETH, cbBTC)
- Maximum 20% in any single altcoin
- Maximum 10% total in memecoins

You must respond with ONLY valid JSON (no markdown, no explanation outside JSON):
{
  "action": "BUY" | "SELL" | "HOLD",
  "fromToken": "<symbol to sell, e.g., USDC, ETH, BRETT>",
  "toToken": "<symbol to buy, e.g., ETH, AERO, USDC>",
  "amount": <number in USD value to trade>,
  "reasoning": "<brief 1-2 sentence explanation>"
}

For HOLD, set fromToken and toToken to "NONE" and amount to 0.`;

  const portfolioSummary = balances.length > 0
    ? balances.map(b => `- ${b.symbol}: ${b.balance} ($${b.usdValue.toFixed(2)})`).join("\n")
    : "- USDC: $0.00 (wallet may be syncing)";

  const marketSummary = marketData.tokens.map(t =>
    `- ${t.symbol} (${t.name}): $${t.price.toLocaleString()} | 24h: ${t.priceChange24h.toFixed(1)}% | 7d: ${t.priceChange7d.toFixed(1)}% | Vol: $${(t.volume24h/1000000).toFixed(1)}M`
  ).join("\n");

  const userMessage = `CURRENT PORTFOLIO:
${portfolioSummary}
Total Value: ~$${state.totalPortfolioValue.toFixed(2)}

MARKET SENTIMENT:
Fear & Greed Index: ${marketData.fearGreed.value} (${marketData.fearGreed.classification})

MARKET DATA:
${marketSummary}

Based on this data, what is your trading decision?`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [
        { role: "user", content: systemPrompt + "\n\n" + userMessage }
      ],
    });

    const content = response.content[0];
    if (content.type === "text") {
      // Clean the response - remove any markdown formatting
      let text = content.text.trim();
      if (text.startsWith("```")) {
        text = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      }
      const decision = JSON.parse(text);
      return decision;
    }

    return { action: "HOLD", fromToken: "NONE", toToken: "NONE", amount: 0, reasoning: "Failed to parse AI response" };
  } catch (error: any) {
    console.error("AI decision failed:", error.message);
    return { action: "HOLD", fromToken: "NONE", toToken: "NONE", amount: 0, reasoning: `Error: ${error.message}` };
  }
}

/**
 * Main trading cycle
 */
async function runTradingCycle() {
  console.log("\n" + "=".repeat(70));
  console.log(`🤖 Trading Cycle Started: ${new Date().toISOString()}`);
  console.log("=".repeat(70));

  try {
    // 1. Get current balances
    console.log("\n📊 Fetching wallet balances...");
    const balances = await getBalances();
    state.balances = balances;

    if (balances.length === 0) {
      console.log("   ⚠️ No balances returned (Coinbase API may be down)");
    } else {
      for (const b of balances) {
        console.log(`   ${b.symbol}: ${b.balance}${b.symbol === "USDC" ? "" : ` ($${b.usdValue.toFixed(2)})`}`);
      }
    }

    // 2. Get market data for ALL tracked tokens
    console.log("\n📈 Fetching market data for all tracked assets...");
    const marketData = await getMarketData();

    console.log(`   Fear & Greed Index: ${marketData.fearGreed.value} (${marketData.fearGreed.classification})`);
    console.log(`   Tracking ${marketData.tokens.length} tokens:`);

    // Update USD values for balances
    for (const balance of state.balances) {
      if (balance.symbol === "USDC") {
        balance.usdValue = balance.balance;
      } else {
        const tokenData = marketData.tokens.find(t => t.symbol === balance.symbol);
        if (tokenData) {
          balance.usdValue = balance.balance * tokenData.price;
        }
      }
    }
    state.totalPortfolioValue = state.balances.reduce((sum, b) => sum + b.usdValue, 0);

    for (const token of marketData.tokens) {
      const change24h = token.priceChange24h >= 0 ? `+${token.priceChange24h.toFixed(1)}%` : `${token.priceChange24h.toFixed(1)}%`;
      const change7d = token.priceChange7d >= 0 ? `+${token.priceChange7d.toFixed(1)}%` : `${token.priceChange7d.toFixed(1)}%`;
      console.log(`   • ${token.symbol}: $${token.price.toLocaleString()} (24h: ${change24h}, 7d: ${change7d})`);
    }

    // 3. AI makes trading decision considering ALL assets
    console.log("\n🧠 AI analyzing full market conditions...");
    const decision = await makeTradeDecision(state.balances, marketData);
    console.log(`   Action: ${decision.action}`);
    if (decision.action !== "HOLD") {
      console.log(`   Trade: ${decision.fromToken} → ${decision.toToken}`);
      console.log(`   Amount: $${decision.amount}`);
    }
    console.log(`   Reasoning: ${decision.reasoning}`);

    // 4. Execute trade if needed
    if (decision.action === "BUY" || decision.action === "SELL") {
      if (decision.amount > 0 && decision.fromToken !== "NONE" && decision.toToken !== "NONE") {
        await executeTrade(decision.amount, decision.fromToken, decision.toToken);
      }
    } else {
      console.log("\n⏸️ Holding current positions - no trade executed");
    }

    state.lastCheck = new Date();

  } catch (error: any) {
    console.error("\n❌ Trading cycle error:", error.message);
  }

  console.log("\n" + "=".repeat(70));
  console.log(`📊 Portfolio Value: ~$${state.totalPortfolioValue.toFixed(2)} | Total Trades: ${state.totalTrades}`);
  console.log(`⏰ Next check in ${CONFIG.intervalMinutes} minutes`);
  console.log("=".repeat(70) + "\n");
}

/**
 * Display agent status
 */
function displayStatus() {
  console.log("\n" + "🤖".repeat(35));
  console.log("\n   HENRY'S AUTONOMOUS TRADING AGENT v2.0");
  console.log("   ═══════════════════════════════════════");
  console.log("   FULL MARKET OBSERVER - All Base Assets\n");
  console.log("🤖".repeat(35) + "\n");

  console.log(`📍 Wallet: ${CONFIG.walletAddress}`);
  console.log(`⚡ Trading Enabled: ${CONFIG.tradingEnabled}`);
  console.log(`💰 Max Trade Size: $${CONFIG.maxTradeSize} USD`);
  console.log(`⏱️ Check Interval: ${CONFIG.intervalMinutes} minutes`);
  console.log(`📊 Total Trades: ${state.totalTrades}`);
  console.log(`🕐 Last Trade: ${state.lastTrade || "Never"}`);

  console.log(`\n📈 Actively Tracking: ${CONFIG.activeTokens.join(", ")}`);
  console.log(`🔗 Available Tokens: ${Object.keys(BASE_TOKENS).join(", ")}`);
  console.log("\n" + "═".repeat(50) + "\n");
}

/**
 * Start the autonomous agent
 */
async function main() {
  displayStatus();

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY not set in .env file");
    console.log("\nTo get started:");
    console.log("1. Copy .env.example to .env");
    console.log("2. Add your Anthropic API key");
    console.log("3. Run: npm start");
    process.exit(1);
  }

  // Run immediately on start
  await runTradingCycle();

  // Schedule recurring checks
  const cronExpression = `*/${CONFIG.intervalMinutes} * * * *`;
  console.log(`📅 Scheduling checks every ${CONFIG.intervalMinutes} minutes...`);

  cron.schedule(cronExpression, async () => {
    await runTradingCycle();
  });

  // Keep process alive
  console.log("🚀 Agent is now running autonomously!");
  console.log("Press Ctrl+C to stop.\n");
}

main().catch(console.error);
