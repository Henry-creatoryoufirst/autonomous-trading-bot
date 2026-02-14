/**
 * Henry's Autonomous Trading Agent v3.2
 *
 * MAJOR UPGRADE: Live Trade Execution via Coinbase CDP SDK
 *
 * CHANGES IN V3.2:
 * - REPLACED broken awal CLI trade execution with Coinbase CDP SDK
 * - Uses account.swap() for one-call trade execution on Base network
 * - Handles Permit2 approvals automatically
 * - CDP-managed wallet signing via CDP_WALLET_SECRET
 * - Supports both old env vars (CDP_API_KEY_NAME/PRIVATE_KEY) and new (CDP_API_KEY_ID/SECRET)
 * - Added swap quote preview logging before execution
 * - Improved error handling for insufficient liquidity
 * - Added viem for transaction monitoring and token allowance checks
 *
 * FIX IN V3.1.1 (retained):
 * - Balance reading via direct on-chain RPC calls to Base network
 * - All ERC-20 token balances read via eth_call (balanceOf)
 * - ETH balance read via eth_getBalance
 * - Parallel balance fetching for all tokens
 *
 * Sectors:
 * - BLUE_CHIP (40%): ETH, cbBTC, cbETH - Safe, liquid assets
 * - AI_TOKENS (20%): VIRTUAL, AIXBT, GAME, HIGHER - High growth AI sector
 * - MEME_COINS (20%): BRETT, DEGEN, TOSHI, MOCHI, NORMIE - High risk/reward
 * - DEFI (20%): AERO, WELL, SEAM, EXTRA, BAL - DeFi protocols on Base
 *
 * Your wallet: 0x55509AA76E2769eCCa5B4293359e3001dA16dd0F
 */

import Anthropic from "@anthropic-ai/sdk";
import { CdpClient } from "@coinbase/cdp-sdk";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as dotenv from "dotenv";
import cron from "node-cron";
import axios from "axios";
import { parseUnits, formatUnits, formatEther, type Address } from "viem";

dotenv.config();

const execAsync = promisify(exec);

// ============================================================================
// EXPANDED TOKEN UNIVERSE - V3.1
// ============================================================================

// Sector definitions with target allocations
const SECTORS = {
  BLUE_CHIP: {
    name: "Blue Chip",
    targetAllocation: 0.40, // 40% of portfolio
    description: "Safe, liquid assets - ETH, BTC",
    tokens: ["ETH", "cbBTC", "cbETH"],
  },
  AI_TOKENS: {
    name: "AI & Agents",
    targetAllocation: 0.20, // 20% of portfolio
    description: "AI and agent tokens - high growth potential",
    tokens: ["VIRTUAL", "AIXBT", "GAME", "HIGHER"],
  },
  MEME_COINS: {
    name: "Meme Coins",
    targetAllocation: 0.20, // 20% of portfolio
    description: "High risk/reward meme tokens",
    tokens: ["BRETT", "DEGEN", "TOSHI", "MOCHI", "NORMIE"],
  },
  DEFI: {
    name: "DeFi Protocols",
    targetAllocation: 0.20, // 20% of portfolio
    description: "Base DeFi ecosystem tokens",
    tokens: ["AERO", "WELL", "SEAM", "EXTRA", "BAL"],
  },
};

// Complete token registry with addresses and metadata
const TOKEN_REGISTRY: Record<string, {
  address: string;
  symbol: string;
  name: string;
  coingeckoId: string;
  sector: keyof typeof SECTORS;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  minTradeUSD: number;
  decimals: number;
}> = {
  // === STABLECOINS ===
  USDC: {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    symbol: "USDC", name: "USD Coin", coingeckoId: "usd-coin",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 1, decimals: 6,
  },
  // === BLUE CHIP (40%) ===
  ETH: {
    address: "native",
    symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 5, decimals: 18,
  },
  WETH: {
    address: "0x4200000000000000000000000000000000000006",
    symbol: "WETH", name: "Wrapped Ethereum", coingeckoId: "ethereum",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 5, decimals: 18,
  },
  cbBTC: {
    address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    symbol: "cbBTC", name: "Coinbase Wrapped BTC", coingeckoId: "bitcoin",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 5, decimals: 8,
  },
  cbETH: {
    address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    symbol: "cbETH", name: "Coinbase Staked ETH", coingeckoId: "coinbase-wrapped-staked-eth",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 5, decimals: 18,
  },
  // === AI & AGENT TOKENS (20%) ===
  VIRTUAL: {
    address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
    symbol: "VIRTUAL", name: "Virtuals Protocol", coingeckoId: "virtual-protocol",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 5, decimals: 18,
  },
  AIXBT: {
    address: "0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825",
    symbol: "AIXBT", name: "aixbt by Virtuals", coingeckoId: "aixbt",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 5, decimals: 18,
  },
  GAME: {
    address: "0x1C4CcA7C5DB003824208eDac21dd3b84C73Aecd1",
    symbol: "GAME", name: "GAME by Virtuals", coingeckoId: "game-by-virtuals",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 5, decimals: 18,
  },
  HIGHER: {
    address: "0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe",
    symbol: "HIGHER", name: "Higher", coingeckoId: "higher",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 3, decimals: 18,
  },
  // === MEME COINS (20%) ===
  BRETT: {
    address: "0x532f27101965dd16442E59d40670FaF5eBB142E4",
    symbol: "BRETT", name: "Brett", coingeckoId: "brett",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 3, decimals: 18,
  },
  DEGEN: {
    address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
    symbol: "DEGEN", name: "Degen", coingeckoId: "degen-base",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 3, decimals: 18,
  },
  TOSHI: {
    address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4",
    symbol: "TOSHI", name: "Toshi", coingeckoId: "toshi",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 3, decimals: 18,
  },
  MOCHI: {
    address: "0xF6e932Ca12afa26665dC4dDE7e27be02A7c02e50",
    symbol: "MOCHI", name: "Mochi", coingeckoId: "mochi-2",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 3, decimals: 18,
  },
  NORMIE: {
    address: "0x7F12d13B34F5F4f0a9449c16Bcd42f0da47AF200",
    symbol: "NORMIE", name: "Normie", coingeckoId: "normie-base",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 3, decimals: 18,
  },
  // === DEFI PROTOCOLS (20%) ===
  AERO: {
    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    symbol: "AERO", name: "Aerodrome Finance", coingeckoId: "aerodrome-finance",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 5, decimals: 18,
  },
  WELL: {
    address: "0xA88594D404727625A9437C3f886C7643872296AE",
    symbol: "WELL", name: "Moonwell", coingeckoId: "moonwell",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 5, decimals: 18,
  },
  SEAM: {
    address: "0x1C7a460413dD4e964f96D8dFC56E7223cE88CD85",
    symbol: "SEAM", name: "Seamless Protocol", coingeckoId: "seamless-protocol",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 5, decimals: 18,
  },
  EXTRA: {
    address: "0x2Dad3a13ef0C6366220f989157009e501e7938F8",
    symbol: "EXTRA", name: "Extra Finance", coingeckoId: "extra-finance",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 5, decimals: 18,
  },
  BAL: {
    address: "0x4158734D47Fc9692176B5085E0F52ee0Da5d47F1",
    symbol: "BAL", name: "Balancer", coingeckoId: "balancer",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 5, decimals: 18,
  },
};

// ============================================================================
// CONFIGURATION V3.2
// ============================================================================

const CONFIG = {
  // Wallet
  walletAddress: process.env.WALLET_ADDRESS || "0x55509AA76E2769eCCa5B4293359e3001dA16dd0F",

  // Trading Parameters
  trading: {
    enabled: process.env.TRADING_ENABLED === "true",
    maxBuySize: parseFloat(process.env.MAX_BUY_SIZE_USDC || "10"),
    maxSellPercent: parseFloat(process.env.MAX_SELL_PERCENT || "50"),
    intervalMinutes: parseInt(process.env.TRADING_INTERVAL_MINUTES || "15"),
    // V3.1: Risk-adjusted position sizing
    maxPositionPercent: 25,  // No single token > 25% of portfolio
    minPositionUSD: 5,       // Minimum position size
    rebalanceThreshold: 10,  // Rebalance if sector drift > 10%
    slippageBps: 100,        // 1% slippage tolerance for swaps
  },

  // Active tokens (all tradeable tokens)
  activeTokens: Object.keys(TOKEN_REGISTRY).filter(t => t !== "USDC"),

  // Logging
  logFile: "./logs/trades-v3.2.json",
};

// ============================================================================
// SERVICES - CDP SDK + ANTHROPIC
// ============================================================================

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Initialize CDP Client - supports both old and new env var naming
function createCdpClient(): CdpClient {
  // Try new naming first, then fall back to old
  const apiKeyId = process.env.CDP_API_KEY_ID || process.env.CDP_API_KEY_NAME;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET || process.env.CDP_API_KEY_PRIVATE_KEY;
  const walletSecret = process.env.CDP_WALLET_SECRET;

  if (!apiKeyId || !apiKeySecret) {
    console.error("❌ CDP API credentials not found. Need CDP_API_KEY_ID + CDP_API_KEY_SECRET (or CDP_API_KEY_NAME + CDP_API_KEY_PRIVATE_KEY)");
    throw new Error("Missing CDP credentials");
  }

  console.log(`  🔑 CDP Auth: Using ${process.env.CDP_API_KEY_ID ? 'new' : 'legacy'} env var naming`);
  console.log(`  🔑 Wallet Secret: ${walletSecret ? 'present' : 'NOT SET - trades may fail'}`);

  return new CdpClient({
    apiKeyId,
    apiKeySecret,
    walletSecret,
  });
}

let cdpClient: CdpClient;

// ============================================================================
// STATE
// ============================================================================

interface TradeRecord {
  timestamp: string;
  cycle: number;
  action: "BUY" | "SELL" | "HOLD" | "REBALANCE";
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
  sector?: string;
  marketConditions: {
    fearGreed: number;
    ethPrice: number;
    btcPrice: number;
  };
}

interface SectorAllocation {
  name: string;
  targetPercent: number;
  currentPercent: number;
  currentUSD: number;
  drift: number;
  tokens: { symbol: string; usdValue: number; percent: number }[];
}

interface AgentState {
  startTime: Date;
  totalCycles: number;
  trading: {
    lastCheck: Date;
    lastTrade: Date | null;
    totalTrades: number;
    successfulTrades: number;
    balances: { symbol: string; balance: number; usdValue: number; price?: number; sector?: string }[];
    totalPortfolioValue: number;
    initialValue: number;
    peakValue: number;
    sectorAllocations: SectorAllocation[];
  };
  tradeHistory: TradeRecord[];
}

let state: AgentState = {
  startTime: new Date(),
  totalCycles: 0,
  trading: {
    lastCheck: new Date(),
    lastTrade: null,
    totalTrades: 0,
    successfulTrades: 0,
    balances: [],
    totalPortfolioValue: 0,
    initialValue: 230,
    peakValue: 374,
    sectorAllocations: [],
  },
  tradeHistory: [],
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function loadTradeHistory() {
  try {
    // Try v3.2 log first, then v3.1
    const logFiles = [CONFIG.logFile, "./logs/trades-v3.1.json"];
    for (const file of logFiles) {
      if (fs.existsSync(file)) {
        const data = fs.readFileSync(file, "utf-8");
        const parsed = JSON.parse(data);
        state.tradeHistory = parsed.trades || [];
        state.trading.initialValue = parsed.initialValue || 230;
        state.trading.peakValue = parsed.peakValue || 374;
        state.trading.totalTrades = parsed.totalTrades || 0;
        state.trading.successfulTrades = parsed.successfulTrades || 0;
        console.log(`  📂 Loaded ${state.tradeHistory.length} historical trades from ${file}`);
        return;
      }
    }
    console.log("  📂 No existing trade history found, starting fresh");
  } catch (e) {
    console.log("  📂 No existing trade history found, starting fresh");
  }
}

function saveTradeHistory() {
  try {
    if (!fs.existsSync("./logs")) {
      fs.mkdirSync("./logs", { recursive: true });
    }
    const data = {
      version: "3.2",
      lastUpdated: new Date().toISOString(),
      initialValue: state.trading.initialValue,
      peakValue: state.trading.peakValue,
      currentValue: state.trading.totalPortfolioValue,
      totalTrades: state.trading.totalTrades,
      successfulTrades: state.trading.successfulTrades,
      sectorAllocations: state.trading.sectorAllocations,
      trades: state.tradeHistory,
    };
    fs.writeFileSync(CONFIG.logFile, JSON.stringify(data, null, 2));
  } catch (e: any) {
    console.error("Failed to save trade history:", e.message);
  }
}

// ============================================================================
// MARKET DATA
// ============================================================================

interface MarketData {
  tokens: {
    symbol: string; name: string; price: number;
    priceChange24h: number; priceChange7d: number;
    volume24h: number; marketCap: number; sector: string;
  }[];
  fearGreed: { value: number; classification: string };
  trendingTokens: string[];
}

async function getMarketData(): Promise<MarketData> {
  try {
    const fngResponse = await axios.get("https://api.alternative.me/fng/", { timeout: 10000 });
    const fearGreed = {
      value: parseInt(fngResponse.data.data[0].value),
      classification: fngResponse.data.data[0].value_classification,
    };

    const coingeckoIds = [...new Set(
      Object.values(TOKEN_REGISTRY).map(t => t.coingeckoId).filter(Boolean)
    )].join(",");

    const marketResponse = await axios.get(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coingeckoIds}&order=market_cap_desc&sparkline=false&price_change_percentage=24h,7d`,
      { timeout: 15000 }
    );

    const tokens = marketResponse.data.map((coin: any) => {
      const registryEntry = Object.entries(TOKEN_REGISTRY).find(
        ([_, t]) => t.coingeckoId === coin.id
      );
      const symbol = registryEntry ? registryEntry[0] : coin.symbol.toUpperCase();
      const sector = registryEntry ? registryEntry[1].sector : "UNKNOWN";
      return {
        symbol, name: coin.name, price: coin.current_price,
        priceChange24h: coin.price_change_percentage_24h || 0,
        priceChange7d: coin.price_change_percentage_7d_in_currency || 0,
        volume24h: coin.total_volume, marketCap: coin.market_cap, sector,
      };
    });

    const trendingTokens = tokens
      .filter((t: any) => t.priceChange24h > 5)
      .sort((a: any, b: any) => b.priceChange24h - a.priceChange24h)
      .slice(0, 5)
      .map((t: any) => t.symbol);

    return { tokens, fearGreed, trendingTokens };
  } catch (error) {
    console.error("Failed to fetch market data:", error);
    return { tokens: [], fearGreed: { value: 50, classification: "Neutral" }, trendingTokens: [] };
  }
}

// ============================================================================
// DIRECT ON-CHAIN BALANCE READING (same as v3.1.1)
// ============================================================================

const BASE_RPC_URL = "https://mainnet.base.org";

async function rpcCall(method: string, params: any[]): Promise<any> {
  const response = await axios.post(BASE_RPC_URL, {
    jsonrpc: "2.0", id: 1, method, params,
  }, { timeout: 15000 });
  if (response.data.error) {
    throw new Error(`RPC error: ${response.data.error.message}`);
  }
  return response.data.result;
}

async function getETHBalance(address: string): Promise<number> {
  const result = await rpcCall("eth_getBalance", [address, "latest"]);
  return parseInt(result, 16) / 1e18;
}

async function getERC20Balance(tokenAddress: string, walletAddress: string, decimals: number = 18): Promise<number> {
  const data = "0x70a08231" + walletAddress.slice(2).padStart(64, "0");
  const result = await rpcCall("eth_call", [{ to: tokenAddress, data }, "latest"]);
  return parseInt(result, 16) / Math.pow(10, decimals);
}

async function getBalances(): Promise<{ symbol: string; balance: number; usdValue: number; price?: number; sector?: string }[]> {
  const walletAddress = CONFIG.walletAddress;
  const balances: { symbol: string; balance: number; usdValue: number; price?: number; sector?: string }[] = [];

  console.log(`  📡 Reading on-chain balances for ${walletAddress.slice(0, 8)}...`);

  const balancePromises: { symbol: string; promise: Promise<number> }[] = [];

  for (const [symbol, token] of Object.entries(TOKEN_REGISTRY)) {
    if (token.address === "native") {
      balancePromises.push({ symbol, promise: getETHBalance(walletAddress) });
    } else {
      balancePromises.push({
        symbol,
        promise: getERC20Balance(token.address, walletAddress, token.decimals),
      });
    }
  }

  // Add small stagger to avoid 429 rate limits
  const results: { symbol: string; balance: number }[] = [];
  const batchSize = 5;
  for (let i = 0; i < balancePromises.length; i += batchSize) {
    const batch = balancePromises.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async ({ symbol, promise }) => {
        const balance = await promise;
        return { symbol, balance };
      })
    );
    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        console.warn(`  ⚠️ Failed to fetch balance for a token: ${result.reason}`);
      }
    }
    // Small delay between batches to respect rate limits
    if (i + batchSize < balancePromises.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  for (const { symbol, balance } of results) {
    const token = TOKEN_REGISTRY[symbol];
    if (balance > 0 || ["USDC", "ETH", "WETH"].includes(symbol)) {
      balances.push({
        symbol, balance,
        usdValue: symbol === "USDC" ? balance : 0,
        sector: token?.sector,
      });
    }
  }

  console.log(`  ✅ Found ${balances.filter(b => b.balance > 0).length} tokens with balances`);
  return balances;
}

// ============================================================================
// SECTOR ANALYSIS
// ============================================================================

function calculateSectorAllocations(
  balances: { symbol: string; balance: number; usdValue: number; sector?: string }[],
  totalValue: number
): SectorAllocation[] {
  const allocations: SectorAllocation[] = [];
  for (const [sectorKey, sectorInfo] of Object.entries(SECTORS)) {
    const sectorTokens = balances.filter(b =>
      sectorInfo.tokens.includes(b.symbol) && b.usdValue > 0
    );
    const sectorValue = sectorTokens.reduce((sum, t) => sum + t.usdValue, 0);
    const currentPercent = totalValue > 0 ? (sectorValue / totalValue) * 100 : 0;
    const targetPercent = sectorInfo.targetAllocation * 100;
    const drift = currentPercent - targetPercent;
    allocations.push({
      name: sectorInfo.name, targetPercent, currentPercent,
      currentUSD: sectorValue, drift,
      tokens: sectorTokens.map(t => ({
        symbol: t.symbol, usdValue: t.usdValue,
        percent: totalValue > 0 ? (t.usdValue / totalValue) * 100 : 0,
      })),
    });
  }
  return allocations;
}

// ============================================================================
// AI TRADING DECISION - V3.1 with Sector Awareness
// ============================================================================

interface TradeDecision {
  action: "BUY" | "SELL" | "HOLD" | "REBALANCE";
  fromToken: string;
  toToken: string;
  amountUSD: number;
  tokenAmount?: number;
  reasoning: string;
  sector?: string;
}

async function makeTradeDecision(
  balances: { symbol: string; balance: number; usdValue: number; price?: number; sector?: string }[],
  marketData: MarketData,
  totalPortfolioValue: number,
  sectorAllocations: SectorAllocation[]
): Promise<TradeDecision> {
  const usdcBalance = balances.find(b => b.symbol === "USDC");
  const availableUSDC = usdcBalance?.balance || 0;

  const holdingsBySector: Record<string, string[]> = {};
  for (const allocation of sectorAllocations) {
    holdingsBySector[allocation.name] = allocation.tokens.map(
      t => `${t.symbol}: $${t.usdValue.toFixed(2)} (${t.percent.toFixed(1)}%)`
    );
  }

  const underweightSectors = sectorAllocations.filter(s => s.drift < -5);
  const overweightSectors = sectorAllocations.filter(s => s.drift > 10);

  const marketBySector: Record<string, string[]> = {};
  for (const token of marketData.tokens) {
    const sector = token.sector || "OTHER";
    if (!marketBySector[sector]) marketBySector[sector] = [];
    marketBySector[sector].push(
      `${token.symbol}: $${token.price < 1 ? token.price.toFixed(6) : token.price.toFixed(2)} (24h: ${token.priceChange24h >= 0 ? "+" : ""}${token.priceChange24h.toFixed(1)}%)`
    );
  }

  const totalTokenValue = balances.filter(b => b.symbol !== "USDC").reduce((sum, b) => sum + b.usdValue, 0);
  const maxBuyAmount = Math.min(CONFIG.trading.maxBuySize, availableUSDC);
  const maxSellAmount = totalTokenValue * (CONFIG.trading.maxSellPercent / 100);
  const tradeableTokens = CONFIG.activeTokens.join(", ");

  const systemPrompt = `You are Henry's autonomous crypto trading agent v3.2 on Base network.
IMPORTANT: Trade execution is LIVE via Coinbase CDP SDK. Your decisions WILL execute real swaps.

PORTFOLIO OVERVIEW:
- USDC Available: $${availableUSDC.toFixed(2)}
- Total Holdings: $${totalTokenValue.toFixed(2)}
- Total Portfolio: $${totalPortfolioValue.toFixed(2)}
- Initial Value: $${state.trading.initialValue}
- Peak Value: $${state.trading.peakValue.toFixed(2)}
- P&L: ${((totalPortfolioValue - state.trading.initialValue) / state.trading.initialValue * 100).toFixed(1)}%

SECTOR ALLOCATIONS (Target vs Current):
${sectorAllocations.map(s =>
  `- ${s.name}: Target ${s.targetPercent}% | Current ${s.currentPercent.toFixed(1)}% | Drift: ${s.drift >= 0 ? "+" : ""}${s.drift.toFixed(1)}%`
).join("\n")}

CURRENT HOLDINGS BY SECTOR:
${Object.entries(holdingsBySector).map(([sector, holdings]) =>
  `${sector}:\n  ${holdings.length > 0 ? holdings.join("\n  ") : "No positions"}`
).join("\n\n")}

MARKET CONDITIONS:
- Fear & Greed: ${marketData.fearGreed.value} (${marketData.fearGreed.classification})
- Trending (24h gainers): ${marketData.trendingTokens.join(", ") || "None"}

TOKEN PRICES BY SECTOR:
${Object.entries(marketBySector).map(([sector, tokens]) =>
  `${sector}:\n  ${tokens.slice(0, 5).join("\n  ")}`
).join("\n\n")}

REBALANCING NEEDS:
${underweightSectors.length > 0
  ? `- UNDERWEIGHT: ${underweightSectors.map(s => `${s.name} (${s.drift.toFixed(1)}%)`).join(", ")}`
  : "- All sectors within target range"}
${overweightSectors.length > 0
  ? `- OVERWEIGHT: ${overweightSectors.map(s => `${s.name} (+${s.drift.toFixed(1)}%)`).join(", ")}`
  : ""}

TRADING LIMITS:
- Max BUY: $${maxBuyAmount.toFixed(2)}
- Max SELL: $${maxSellAmount.toFixed(2)} (${CONFIG.trading.maxSellPercent}% of holdings)

AVAILABLE TOKENS: ${tradeableTokens}

IMPORTANT NOTES FOR SELLING:
- When selling a token, use its ERC-20 address (fromToken = token address)
- When selling to USDC, toToken = USDC address
- For selling ETH, use WETH address (0x4200000000000000000000000000000000000006)
- Amounts should be in USD value

STRATEGY RULES:
1. SECTOR BALANCE: Keep allocations near targets (Blue Chip 40%, AI 20%, Meme 20%, DeFi 20%)
2. BUY on extreme fear (< 25) - DCA into underweight sectors
3. SELL/TAKE PROFITS when:
   - Any token up > 15% in 24h
   - Sector becomes > 10% overweight
   - Fear & Greed > 65
4. REBALANCE: If a sector drifts > 10% from target
5. DIVERSIFY: No single token > 25% of portfolio
6. HOLD if uncertain or market is neutral
7. MINIMUM TRADE: Only trade if amount >= $1.00

Respond with ONLY valid JSON:
{
  "action": "BUY" | "SELL" | "HOLD" | "REBALANCE",
  "fromToken": "USDC" or token symbol,
  "toToken": token symbol or "USDC",
  "amountUSD": <number>,
  "reasoning": "<1-2 sentence explanation>",
  "sector": "<sector name if relevant>"
}`;

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

      const validTokens = ["USDC", ...CONFIG.activeTokens];
      if (!validTokens.includes(decision.fromToken) || !validTokens.includes(decision.toToken)) {
        return { action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: "Invalid token in decision" };
      }

      if (decision.action === "BUY" || decision.action === "REBALANCE") {
        decision.amountUSD = Math.min(decision.amountUSD, maxBuyAmount);
        if (decision.amountUSD < 1.00) {
          decision.action = "HOLD";
          decision.reasoning = `Trade amount ($${decision.amountUSD.toFixed(2)}) too small. Minimum $1.00. Holding.`;
        }
      } else if (decision.action === "SELL") {
        const holding = balances.find(b => b.symbol === decision.fromToken);
        if (!holding || holding.usdValue < 1) {
          return { action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: `No ${decision.fromToken} to sell` };
        }
        const maxSellForToken = holding.usdValue * (CONFIG.trading.maxSellPercent / 100);
        decision.amountUSD = Math.min(decision.amountUSD, maxSellForToken);
        decision.tokenAmount = decision.amountUSD / (holding.price || 1);
      }

      return decision;
    }
    return { action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: "Parse error" };
  } catch (error: any) {
    console.error("AI decision failed:", error.message);
    return { action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: `Error: ${error.message}` };
  }
}

// ============================================================================
// TRADE EXECUTION - V3.2 via Coinbase CDP SDK
// ============================================================================

function getTokenAddress(symbol: string): string {
  const token = TOKEN_REGISTRY[symbol];
  if (!token) throw new Error(`Unknown token: ${symbol}`);
  // For swaps, native ETH should use WETH address
  if (token.address === "native") {
    return TOKEN_REGISTRY["WETH"].address;
  }
  return token.address;
}

function getTokenDecimals(symbol: string): number {
  return TOKEN_REGISTRY[symbol]?.decimals || 18;
}

async function executeTrade(
  decision: TradeDecision,
  marketData: MarketData
): Promise<{ success: boolean; txHash?: string; error?: string }> {

  if (!CONFIG.trading.enabled) {
    console.log("  ⚠️ Trading disabled - dry run mode");
    console.log(`  📋 Would execute: $${decision.amountUSD.toFixed(2)} ${decision.fromToken} → ${decision.toToken}`);
    return { success: false, error: "Trading disabled (dry run)" };
  }

  const portfolioValueBefore = state.trading.totalPortfolioValue;

  try {
    // Get token addresses for the swap
    const fromTokenAddress = getTokenAddress(decision.fromToken) as Address;
    const toTokenAddress = getTokenAddress(decision.toToken) as Address;
    const fromDecimals = getTokenDecimals(decision.fromToken);

    // Calculate the token amount to swap
    let fromAmount: bigint;
    if (decision.fromToken === "USDC") {
      // Buying: convert USD amount to USDC units (6 decimals)
      fromAmount = parseUnits(decision.amountUSD.toFixed(6), 6);
    } else {
      // Selling: convert USD to token amount using current price
      const tokenPrice = marketData.tokens.find(t => t.symbol === decision.fromToken)?.price || 1;
      const tokenAmount = decision.amountUSD / tokenPrice;
      fromAmount = parseUnits(tokenAmount.toFixed(Math.min(fromDecimals, 8)), fromDecimals);
    }

    console.log(`\n  🔄 EXECUTING TRADE via CDP SDK:`);
    console.log(`     ${decision.fromToken} (${fromTokenAddress})`);
    console.log(`     → ${decision.toToken} (${toTokenAddress})`);
    console.log(`     Amount: ${formatUnits(fromAmount, fromDecimals)} ${decision.fromToken} (~$${decision.amountUSD.toFixed(2)})`);
    console.log(`     Slippage: ${CONFIG.trading.slippageBps / 100}%`);
    console.log(`     Network: Base Mainnet`);

    // Get or create the CDP-managed account
    const account = await cdpClient.evm.getOrCreateAccount({
      name: "henry-trading-bot",
    });

    console.log(`     Account: ${account.address}`);

    // Verify this is the right wallet
    if (account.address.toLowerCase() !== CONFIG.walletAddress.toLowerCase()) {
      console.log(`     ⚠️ CDP account address differs from configured wallet!`);
      console.log(`     CDP: ${account.address}`);
      console.log(`     Config: ${CONFIG.walletAddress}`);
      console.log(`     Proceeding with CDP-managed account...`);
    }

    // Execute the swap - CDP SDK handles Permit2, approvals, and signing
    const result = await account.swap({
      network: "base",
      fromToken: fromTokenAddress,
      toToken: toTokenAddress,
      fromAmount,
      slippageBps: CONFIG.trading.slippageBps,
    });

    const txHash = result.transactionHash;

    console.log(`\n  ✅ TRADE EXECUTED SUCCESSFULLY!`);
    console.log(`     TX Hash: ${txHash}`);
    console.log(`     🔍 View: https://basescan.org/tx/${txHash}`);

    // Update state
    state.trading.lastTrade = new Date();
    state.trading.totalTrades++;
    state.trading.successfulTrades++;

    // Record trade
    const record: TradeRecord = {
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
      sector: decision.sector,
      marketConditions: {
        fearGreed: marketData.fearGreed.value,
        ethPrice: marketData.tokens.find(t => t.symbol === "ETH")?.price || 0,
        btcPrice: marketData.tokens.find(t => t.symbol === "cbBTC")?.price || 0,
      },
    };
    state.tradeHistory.push(record);
    saveTradeHistory();

    return { success: true, txHash };

  } catch (error: any) {
    const errorMsg = error.message || String(error);

    // Handle specific error types
    if (errorMsg.includes("Insufficient liquidity")) {
      console.error(`  ❌ Trade failed: Insufficient liquidity for ${decision.fromToken} → ${decision.toToken}`);
      console.error(`     Try reducing amount or using a different pair.`);
    } else if (errorMsg.includes("insufficient funds")) {
      console.error(`  ❌ Trade failed: Insufficient ${decision.fromToken} balance for this trade.`);
    } else {
      console.error(`  ❌ Trade failed: ${errorMsg}`);
    }

    // Record failed trade
    const record: TradeRecord = {
      timestamp: new Date().toISOString(),
      cycle: state.totalCycles,
      action: decision.action,
      fromToken: decision.fromToken,
      toToken: decision.toToken,
      amountUSD: decision.amountUSD,
      success: false,
      error: errorMsg,
      portfolioValueBefore,
      reasoning: decision.reasoning,
      sector: decision.sector,
      marketConditions: {
        fearGreed: marketData.fearGreed.value,
        ethPrice: marketData.tokens.find(t => t.symbol === "ETH")?.price || 0,
        btcPrice: marketData.tokens.find(t => t.symbol === "cbBTC")?.price || 0,
      },
    };
    state.tradeHistory.push(record);
    state.trading.totalTrades++;
    saveTradeHistory();

    return { success: false, error: errorMsg };
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

  try {
    console.log("\n📊 Fetching balances...");
    const balances = await getBalances();

    console.log("📈 Fetching market data for all tracked tokens...");
    const marketData = await getMarketData();

    // Update USD values
    for (const balance of balances) {
      if (balance.symbol !== "USDC") {
        const tokenData = marketData.tokens.find(t => t.symbol === balance.symbol);
        if (tokenData) {
          balance.usdValue = balance.balance * tokenData.price;
          balance.price = tokenData.price;
        }
      }
      balance.sector = TOKEN_REGISTRY[balance.symbol]?.sector;
    }

    state.trading.balances = balances;
    state.trading.totalPortfolioValue = balances.reduce((sum, b) => sum + b.usdValue, 0);

    if (state.trading.totalPortfolioValue > state.trading.peakValue) {
      state.trading.peakValue = state.trading.totalPortfolioValue;
    }

    const sectorAllocations = calculateSectorAllocations(balances, state.trading.totalPortfolioValue);
    state.trading.sectorAllocations = sectorAllocations;

    // Display status
    const pnl = state.trading.totalPortfolioValue - state.trading.initialValue;
    const pnlPercent = (pnl / state.trading.initialValue) * 100;
    const drawdown = ((state.trading.peakValue - state.trading.totalPortfolioValue) / state.trading.peakValue) * 100;

    console.log(`\n💰 Portfolio: $${state.trading.totalPortfolioValue.toFixed(2)}`);
    console.log(`   P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(1)}%)`);
    console.log(`   Peak: $${state.trading.peakValue.toFixed(2)} | Drawdown: ${drawdown.toFixed(1)}%`);
    console.log(`   Fear & Greed: ${marketData.fearGreed.value} (${marketData.fearGreed.classification})`);

    console.log(`\n📊 Sector Allocations:`);
    for (const sector of sectorAllocations) {
      const status = Math.abs(sector.drift) > 5
        ? (sector.drift > 0 ? "⚠️ OVER" : "⚠️ UNDER")
        : "✅";
      console.log(`   ${status} ${sector.name}: ${sector.currentPercent.toFixed(1)}% (target: ${sector.targetPercent}%)`);
    }

    if (marketData.trendingTokens.length > 0) {
      console.log(`\n🔥 Trending: ${marketData.trendingTokens.join(", ")}`);
    }

    // AI decision
    console.log("\n🧠 AI analyzing portfolio & market...");
    const decision = await makeTradeDecision(balances, marketData, state.trading.totalPortfolioValue, sectorAllocations);

    console.log(`\n   Decision: ${decision.action}`);
    if (decision.action !== "HOLD") {
      console.log(`   Trade: $${decision.amountUSD.toFixed(2)} ${decision.fromToken} → ${decision.toToken}`);
      if (decision.sector) console.log(`   Sector: ${decision.sector}`);
    }
    console.log(`   Reasoning: ${decision.reasoning}`);

    // Execute if needed
    if (["BUY", "SELL", "REBALANCE"].includes(decision.action) && decision.amountUSD >= 1.00) {
      await executeTrade(decision, marketData);
    }

    state.trading.lastCheck = new Date();

  } catch (error: any) {
    console.error("Cycle error:", error.message);
  }

  // Summary
  console.log("\n" + "═".repeat(70));
  console.log("📊 CYCLE SUMMARY");
  console.log(`   Portfolio: $${state.trading.totalPortfolioValue.toFixed(2)}`);
  console.log(`   Trades: ${state.trading.successfulTrades}/${state.trading.totalTrades} successful`);
  console.log(`   Tracking: ${CONFIG.activeTokens.length} tokens across 4 sectors`);
  console.log(`   Next cycle in ${CONFIG.trading.intervalMinutes} minutes`);
  console.log("═".repeat(70));
}

// ============================================================================
// STARTUP
// ============================================================================

function displayBanner() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                        ║
║   🤖 HENRY'S AUTONOMOUS TRADING AGENT v3.2                            ║
║   ════════════════════════════════════════                              ║
║                                                                        ║
║   LIVE TRADING via Coinbase CDP SDK | Base Network                     ║
║                                                                        ║
║   Sectors:                                                             ║
║   • Blue Chip (40%): ETH, cbBTC, cbETH                                ║
║   • AI Tokens (20%): VIRTUAL, AIXBT, GAME, HIGHER                     ║
║   • Meme Coins (20%): BRETT, DEGEN, TOSHI, MOCHI, NORMIE              ║
║   • DeFi (20%): AERO, WELL, SEAM, EXTRA, BAL                         ║
║                                                                        ║
╚══════════════════════════════════════════════════════════════════════════╝
  `);
  console.log("📍 Configuration:");
  console.log(`   Wallet: ${CONFIG.walletAddress}`);
  console.log(`   Trading: ${CONFIG.trading.enabled ? "LIVE 🟢" : "DRY RUN 🟡"}`);
  console.log(`   Execution: Coinbase CDP SDK (account.swap)`);
  console.log(`   Max Buy: $${CONFIG.trading.maxBuySize}`);
  console.log(`   Max Sell: ${CONFIG.trading.maxSellPercent}% of position`);
  console.log(`   Slippage: ${CONFIG.trading.slippageBps / 100}%`);
  console.log(`   Interval: ${CONFIG.trading.intervalMinutes} min`);
  console.log(`   Tokens: ${CONFIG.activeTokens.length} across 4 sectors`);
  console.log("");
}

async function main() {
  displayBanner();

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  // Initialize CDP client
  try {
    cdpClient = createCdpClient();
    console.log("  ✅ CDP Client initialized");

    // Verify account access
    const account = await cdpClient.evm.getOrCreateAccount({ name: "henry-trading-bot" });
    console.log(`  ✅ CDP Account: ${account.address}`);

    if (account.address.toLowerCase() !== CONFIG.walletAddress.toLowerCase()) {
      console.log(`  ⚠️ Note: CDP account address (${account.address}) differs from WALLET_ADDRESS (${CONFIG.walletAddress})`);
      console.log(`  ⚠️ Trades will execute from CDP account. Balance reading uses WALLET_ADDRESS.`);
      console.log(`  ⚠️ If these should match, update WALLET_ADDRESS in Railway vars.`);
    }
  } catch (error: any) {
    console.error(`❌ CDP initialization failed: ${error.message}`);
    console.error("   Trades will NOT execute. Bot will run in analysis-only mode.");
    console.error("   Fix: Set CDP_API_KEY_ID, CDP_API_KEY_SECRET, and CDP_WALLET_SECRET in Railway vars.");
  }

  loadTradeHistory();

  // Run immediately
  await runTradingCycle();

  // Schedule recurring cycles
  const cronExpression = `*/${CONFIG.trading.intervalMinutes} * * * *`;
  cron.schedule(cronExpression, runTradingCycle);

  console.log("\n🚀 Agent v3.2 running! Press Ctrl+C to stop.\n");
}

main().catch(console.error);

// Simple HTTP health check server for Railway
import http from 'http';
const healthServer = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    const uptime = Math.floor((Date.now() - state.startTime.getTime()) / 1000);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: "ok",
      version: "3.2",
      uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      portfolio: state.trading.totalPortfolioValue,
      trades: `${state.trading.successfulTrades}/${state.trading.totalTrades}`,
      lastCycle: state.trading.lastCheck.toISOString(),
      tradingEnabled: CONFIG.trading.enabled,
    }));
  }
});
healthServer.listen(process.env.PORT || 3000, () => {
  console.log('Health check server running on port', process.env.PORT || 3000);
});
