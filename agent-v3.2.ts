/**
 * Henry's Autonomous Trading Agent v3.4
 *
 * MAJOR UPGRADE: Technical Indicators Engine + Advanced AI Trading Strategy
 *
 * CHANGES IN V3.4:
 * - Technical Indicators Engine: RSI(14), MACD(12/26/9), Bollinger Bands(20,2), SMA(20/50)
 * - Confluence scoring system: -100 to +100 aggregated signal strength
 * - CoinGecko historical price data with 2-hour caching (free tier optimized)
 * - AI prompt v3.4 with indicator-driven entry/exit/risk rules
 * - Trade history memory: last 10 trades fed to AI for learning across cycles
 * - Trend direction detection from price action + moving averages
 * - Volume analysis: 24h volume vs 7-day average comparison
 *
 * CHANGES IN V3.3:
 * - Added Permit2 ERC-20 approval before swaps (fixes insufficient allowance error)
 * - Checks current allowance via eth_call before approving
 * - Gas status check on startup — warns if ETH needed for approvals
 * - Coinbase CDP SDK for trade execution
 * - CDP-managed wallet signing via CDP_WALLET_SECRET
 * - Supports both old env vars (CDP_API_KEY_NAME/PRIVATE_KEY) and new (CDP_API_KEY_ID/SECRET)
 * - Swap quote preview logging before execution
 * - Improved error handling for insufficient liquidity
 * - viem for transaction monitoring and token allowance checks
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
import * as fs from "fs";
import * as dotenv from "dotenv";
import cron from "node-cron";
import axios from "axios";
import { parseUnits, formatUnits, formatEther, type Address } from "viem";

dotenv.config();

// ============================================================================
// GLOBAL ERROR HANDLERS — prevent TLS/Axios object dumps from crashing Railway
// ============================================================================
process.on('unhandledRejection', (reason: any) => {
  const msg = reason?.message || reason?.toString?.() || 'Unknown rejection';
  console.error(`[Unhandled Rejection] ${msg.substring(0, 300)}`);
});

process.on('uncaughtException', (error: any) => {
  const msg = error?.message || error?.toString?.() || 'Unknown exception';
  console.error(`[Uncaught Exception] ${msg.substring(0, 300)}`);
  // Don't exit — let the bot keep running
});

// Override console.error to prevent massive object dumps that flood Railway logs
const _origConsoleError = console.error.bind(console);
console.error = (...args: any[]) => {
  const safeArgs = args.map((arg) => {
    if (typeof arg === 'string') return arg.substring(0, 1000);
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    if (typeof arg === 'object' && arg !== null) {
      // Detect TLS/socket objects that crash Railway
      if ('_tlsOptions' in arg || '_secureContext' in arg || 'authorizationError' in arg || '_closeAfterHandlingError' in arg) {
        return '[Filtered: TLS/Socket object]';
      }
      try {
        return JSON.stringify(arg).substring(0, 500);
      } catch {
        return '[Non-serializable object]';
      }
    }
    return String(arg);
  });
  _origConsoleError(...safeArgs);
};

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
  logFile: "./logs/trades-v3.4.json",
};

// ============================================================================
// SERVICES - CDP SDK + ANTHROPIC
// ============================================================================

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Initialize CDP Client - supports both old and new env var naming
// CDP SDK credential format (verified from source):
//   apiKeyId: UUID string (e.g. "fe3fabdc-...")
//   apiKeySecret: Either raw base64 Ed25519 key (88 chars) OR PEM PKCS#8 EC key (-----BEGIN PRIVATE KEY-----)
//   walletSecret: Raw base64 DER-encoded ECDSA P-256 key (no PEM headers - SDK wraps internally)
function createCdpClient(): CdpClient {
  // Try new naming first, then fall back to old
  const apiKeyId = process.env.CDP_API_KEY_ID || process.env.CDP_API_KEY_NAME;
  let apiKeySecret = process.env.CDP_API_KEY_SECRET || process.env.CDP_API_KEY_PRIVATE_KEY;
  const walletSecret = process.env.CDP_WALLET_SECRET;

  // Railway env vars may store PEM newlines as literal \n — convert to real newlines
  if (apiKeySecret && apiKeySecret.includes('\\n')) {
    apiKeySecret = apiKeySecret.replace(/\\n/g, '\n');
  }

  if (!apiKeyId || !apiKeySecret) {
    console.error("❌ CDP API credentials not found. Need CDP_API_KEY_ID + CDP_API_KEY_SECRET (or CDP_API_KEY_NAME + CDP_API_KEY_PRIVATE_KEY)");
    throw new Error("Missing CDP credentials");
  }

  // Diagnostic logging (safe - only shows key type and length, never actual values)
  const envSource = process.env.CDP_API_KEY_ID ? 'CDP_API_KEY_ID' : 'CDP_API_KEY_NAME';
  const secretSource = process.env.CDP_API_KEY_SECRET ? 'CDP_API_KEY_SECRET' : 'CDP_API_KEY_PRIVATE_KEY';
  console.log(`  🔑 CDP Auth: apiKeyId from ${envSource} (${apiKeyId.length} chars, starts with "${apiKeyId.substring(0, 8)}...")`);
  console.log(`  🔑 CDP Auth: apiKeySecret from ${secretSource} (${apiKeySecret.length} chars, type: ${apiKeySecret.length === 88 ? 'Ed25519' : apiKeySecret.startsWith('-----') ? 'PEM/ECDSA' : 'unknown'})`);
  console.log(`  🔑 CDP Auth: walletSecret ${walletSecret ? `present (${walletSecret.length} chars, starts with "${walletSecret.substring(0, 8)}...")` : 'NOT SET - trades may fail'}`);
  console.log(`  🔑 Node.js: ${process.version} | NODE_OPTIONS: ${process.env.NODE_OPTIONS || 'not set'}`);

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
    // Try v3.3 log first, then v3.1
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
      version: "3.4",
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
  indicators: Record<string, TechnicalIndicators>;  // Technical indicators per token
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

    // Fetch technical indicators for all tokens
    console.log("📐 Computing technical indicators (RSI, MACD, Bollinger)...");
    const indicators = await getTokenIndicators(tokens);
    const indicatorCount = Object.values(indicators).filter(i => i.rsi14 !== null).length;
    console.log(`   ✅ Indicators computed for ${indicatorCount}/${Object.keys(indicators).length} tokens`);

    return { tokens, fearGreed, trendingTokens, indicators };
  } catch (error: any) {
    const msg = error?.response?.status
      ? `HTTP ${error.response.status}: ${error.message}`
      : error?.message || String(error);
    console.error("Failed to fetch market data:", msg);
    return { tokens: [], fearGreed: { value: 50, classification: "Neutral" }, trendingTokens: [], indicators: {} };
  }
}

// ============================================================================
// TECHNICAL INDICATORS ENGINE (Phase 1 Upgrade)
// ============================================================================

interface TechnicalIndicators {
  rsi14: number | null;          // Relative Strength Index (14-period)
  macd: {                        // Moving Average Convergence Divergence
    macdLine: number;
    signalLine: number;
    histogram: number;
    signal: "BULLISH" | "BEARISH" | "NEUTRAL";
  } | null;
  bollingerBands: {              // Bollinger Bands (20-period, 2 std dev)
    upper: number;
    middle: number;
    lower: number;
    percentB: number;            // 0-1 where price sits in bands (>1 = above upper, <0 = below lower)
    bandwidth: number;           // Band width as % of middle (volatility measure)
    signal: "OVERBOUGHT" | "OVERSOLD" | "SQUEEZE" | "NORMAL";
  } | null;
  sma20: number | null;         // 20-period Simple Moving Average
  sma50: number | null;         // 50-period Simple Moving Average (if enough data)
  volumeChange24h: number | null; // Volume change vs 7-day average
  trendDirection: "STRONG_UP" | "UP" | "SIDEWAYS" | "DOWN" | "STRONG_DOWN";
  overallSignal: "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";
  confluenceScore: number;       // -100 to +100, aggregated signal strength
}

interface TokenWithIndicators {
  symbol: string;
  name: string;
  price: number;
  priceChange24h: number;
  priceChange7d: number;
  volume24h: number;
  marketCap: number;
  sector: string;
  indicators: TechnicalIndicators;
}

// Cache for historical price data — refreshed every 2 hours
const priceHistoryCache: Record<string, {
  prices: number[];        // Hourly close prices (most recent last)
  volumes: number[];       // Hourly volumes
  timestamps: number[];    // Unix timestamps
  lastFetched: number;     // Unix ms when last refreshed
}> = {};

const HISTORY_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours in ms

/**
 * Fetch hourly price history for a token from CoinGecko (30 days = hourly auto-granularity)
 */
async function fetchPriceHistory(coingeckoId: string): Promise<{ prices: number[]; volumes: number[]; timestamps: number[] }> {
  try {
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/coins/${coingeckoId}/market_chart?vs_currency=usd&days=30`,
      { timeout: 15000 }
    );

    const prices = response.data.prices.map((p: [number, number]) => p[1]);
    const volumes = response.data.total_volumes.map((v: [number, number]) => v[1]);
    const timestamps = response.data.prices.map((p: [number, number]) => p[0]);

    return { prices, volumes, timestamps };
  } catch (error: any) {
    const msg = error?.response?.status === 429 ? "Rate limited (429)" : error?.message || String(error);
    console.error(`  ⚠️ Price history fetch failed for ${coingeckoId}: ${msg}`);
    return { prices: [], volumes: [], timestamps: [] };
  }
}

/**
 * Get cached price history, refreshing if stale
 */
async function getCachedPriceHistory(coingeckoId: string): Promise<{ prices: number[]; volumes: number[]; timestamps: number[] }> {
  const cached = priceHistoryCache[coingeckoId];
  const now = Date.now();

  if (cached && (now - cached.lastFetched) < HISTORY_CACHE_TTL && cached.prices.length > 0) {
    return cached;
  }

  const data = await fetchPriceHistory(coingeckoId);
  if (data.prices.length > 0) {
    priceHistoryCache[coingeckoId] = { ...data, lastFetched: now };
  }
  return data;
}

/**
 * Calculate RSI (Relative Strength Index) — 14-period
 * RSI = 100 - (100 / (1 + RS))
 * RS = Average Gain / Average Loss over N periods
 */
function calculateRSI(prices: number[], period: number = 14): number | null {
  if (prices.length < period + 1) return null;

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  // Use the last (period + extra) changes for smoothed calculation
  const recentChanges = changes.slice(-Math.min(changes.length, period * 3));

  // Initial average gain/loss (first N periods)
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period && i < recentChanges.length; i++) {
    if (recentChanges[i] > 0) avgGain += recentChanges[i];
    else avgLoss += Math.abs(recentChanges[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smoothed RSI using Wilder's smoothing
  for (let i = period; i < recentChanges.length; i++) {
    const change = recentChanges[i];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Calculate EMA (Exponential Moving Average)
 */
function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return [];

  const multiplier = 2 / (period + 1);
  const ema: number[] = [];

  // Start with SMA for the first value
  let sum = 0;
  for (let i = 0; i < period; i++) sum += prices[i];
  ema.push(sum / period);

  // Calculate EMA for remaining values
  for (let i = period; i < prices.length; i++) {
    ema.push((prices[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1]);
  }

  return ema;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * MACD Line = EMA(12) - EMA(26)
 * Signal Line = EMA(9) of MACD Line
 * Histogram = MACD Line - Signal Line
 */
function calculateMACD(prices: number[]): { macdLine: number; signalLine: number; histogram: number; signal: "BULLISH" | "BEARISH" | "NEUTRAL" } | null {
  if (prices.length < 35) return null; // Need at least 26 + 9 periods

  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);

  if (ema12.length === 0 || ema26.length === 0) return null;

  // Align the arrays — EMA26 starts later, so MACD starts at EMA26's start
  const offset = 26 - 12; // EMA12 has 14 more values at the front
  const macdValues: number[] = [];
  for (let i = 0; i < ema26.length; i++) {
    macdValues.push(ema12[i + offset] - ema26[i]);
  }

  if (macdValues.length < 9) return null;

  const signalLine = calculateEMA(macdValues, 9);
  if (signalLine.length === 0) return null;

  const macdLine = macdValues[macdValues.length - 1];
  const signal = signalLine[signalLine.length - 1];
  const histogram = macdLine - signal;

  // Determine signal
  let macdSignal: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  const prevHistogram = macdValues.length >= 2 && signalLine.length >= 2
    ? macdValues[macdValues.length - 2] - signalLine[signalLine.length - 2]
    : 0;

  if (histogram > 0 && prevHistogram <= 0) macdSignal = "BULLISH"; // Crossover
  else if (histogram < 0 && prevHistogram >= 0) macdSignal = "BEARISH"; // Crossunder
  else if (histogram > 0) macdSignal = "BULLISH";
  else if (histogram < 0) macdSignal = "BEARISH";

  return { macdLine, signalLine: signal, histogram, signal: macdSignal };
}

/**
 * Calculate Bollinger Bands (20-period, 2 standard deviations)
 */
function calculateBollingerBands(prices: number[], period: number = 20, stdDevMultiplier: number = 2): TechnicalIndicators["bollingerBands"] {
  if (prices.length < period) return null;

  const recentPrices = prices.slice(-period);

  // Simple Moving Average
  const sma = recentPrices.reduce((sum, p) => sum + p, 0) / period;

  // Standard Deviation
  const squaredDiffs = recentPrices.map(p => Math.pow(p - sma, 2));
  const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = sma + stdDevMultiplier * stdDev;
  const lower = sma - stdDevMultiplier * stdDev;
  const currentPrice = prices[prices.length - 1];

  // %B = (Price - Lower) / (Upper - Lower)
  const percentB = upper !== lower ? (currentPrice - lower) / (upper - lower) : 0.5;

  // Bandwidth = (Upper - Lower) / Middle * 100
  const bandwidth = sma !== 0 ? ((upper - lower) / sma) * 100 : 0;

  // Signal
  let signal: "OVERBOUGHT" | "OVERSOLD" | "SQUEEZE" | "NORMAL" = "NORMAL";
  if (percentB > 1) signal = "OVERBOUGHT";
  else if (percentB < 0) signal = "OVERSOLD";
  else if (bandwidth < 2) signal = "SQUEEZE"; // Tight bands = incoming move

  return { upper, middle: sma, lower, percentB, bandwidth, signal };
}

/**
 * Calculate Simple Moving Average
 */
function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const recentPrices = prices.slice(-period);
  return recentPrices.reduce((sum, p) => sum + p, 0) / period;
}

/**
 * Determine trend direction from price action and moving averages
 */
function determineTrend(prices: number[], sma20: number | null, sma50: number | null): TechnicalIndicators["trendDirection"] {
  if (prices.length < 5) return "SIDEWAYS";

  const currentPrice = prices[prices.length - 1];
  const priceWeekAgo = prices[Math.max(0, prices.length - 168)]; // ~7 days of hourly data
  const priceDayAgo = prices[Math.max(0, prices.length - 24)];

  const weeklyChange = ((currentPrice - priceWeekAgo) / priceWeekAgo) * 100;
  const dailyChange = ((currentPrice - priceDayAgo) / priceDayAgo) * 100;

  // Check moving average alignment
  const aboveSMA20 = sma20 ? currentPrice > sma20 : null;
  const aboveSMA50 = sma50 ? currentPrice > sma50 : null;

  if (weeklyChange > 10 && dailyChange > 3 && aboveSMA20 !== false) return "STRONG_UP";
  if (weeklyChange > 3 && dailyChange > 0 && aboveSMA20 !== false) return "UP";
  if (weeklyChange < -10 && dailyChange < -3 && aboveSMA20 !== true) return "STRONG_DOWN";
  if (weeklyChange < -3 && dailyChange < 0 && aboveSMA20 !== true) return "DOWN";
  return "SIDEWAYS";
}

/**
 * Calculate overall signal from confluence of indicators
 * Returns a score from -100 (strong sell) to +100 (strong buy)
 */
function calculateConfluence(
  rsi: number | null,
  macd: TechnicalIndicators["macd"],
  bb: TechnicalIndicators["bollingerBands"],
  trend: TechnicalIndicators["trendDirection"],
  priceChange24h: number,
  priceChange7d: number
): { score: number; signal: TechnicalIndicators["overallSignal"] } {
  let score = 0;
  let signals = 0;

  // RSI (weight: 25)
  if (rsi !== null) {
    signals++;
    if (rsi < 30) score += 25;       // Oversold — buy signal
    else if (rsi < 40) score += 12;
    else if (rsi > 70) score -= 25;  // Overbought — sell signal
    else if (rsi > 60) score -= 12;
    // 40-60 = neutral
  }

  // MACD (weight: 25)
  if (macd) {
    signals++;
    if (macd.signal === "BULLISH") score += 25;
    else if (macd.signal === "BEARISH") score -= 25;
    // Histogram magnitude adds conviction
    if (Math.abs(macd.histogram) > Math.abs(macd.macdLine) * 0.3) {
      score += macd.histogram > 0 ? 5 : -5;
    }
  }

  // Bollinger Bands (weight: 20)
  if (bb) {
    signals++;
    if (bb.signal === "OVERSOLD") score += 20;
    else if (bb.signal === "OVERBOUGHT") score -= 20;
    else if (bb.signal === "SQUEEZE") score += 5; // Squeeze slightly bullish (potential breakout)
    // %B nuance
    if (bb.percentB > 0.8 && bb.percentB <= 1) score -= 5;
    else if (bb.percentB < 0.2 && bb.percentB >= 0) score += 5;
  }

  // Trend (weight: 15)
  signals++;
  switch (trend) {
    case "STRONG_UP": score += 15; break;
    case "UP": score += 8; break;
    case "STRONG_DOWN": score -= 15; break;
    case "DOWN": score -= 8; break;
    default: break; // SIDEWAYS = 0
  }

  // Price momentum (weight: 15)
  signals++;
  if (priceChange24h > 5) score += 8;
  else if (priceChange24h > 2) score += 4;
  else if (priceChange24h < -5) score -= 8;
  else if (priceChange24h < -2) score -= 4;

  if (priceChange7d > 10) score += 7;
  else if (priceChange7d > 3) score += 3;
  else if (priceChange7d < -10) score -= 7;
  else if (priceChange7d < -3) score -= 3;

  // Normalize to -100 to +100
  const normalizedScore = Math.max(-100, Math.min(100, score));

  // Determine signal
  let signal: TechnicalIndicators["overallSignal"];
  if (normalizedScore >= 40) signal = "STRONG_BUY";
  else if (normalizedScore >= 15) signal = "BUY";
  else if (normalizedScore <= -40) signal = "STRONG_SELL";
  else if (normalizedScore <= -15) signal = "SELL";
  else signal = "NEUTRAL";

  return { score: normalizedScore, signal };
}

/**
 * Compute all technical indicators for a single token
 */
async function computeIndicators(
  coingeckoId: string,
  currentPrice: number,
  priceChange24h: number,
  priceChange7d: number,
  volume24h: number
): Promise<TechnicalIndicators> {
  const history = await getCachedPriceHistory(coingeckoId);

  if (history.prices.length < 20) {
    // Not enough data — return neutral indicators
    return {
      rsi14: null, macd: null, bollingerBands: null,
      sma20: null, sma50: null, volumeChange24h: null,
      trendDirection: "SIDEWAYS", overallSignal: "NEUTRAL", confluenceScore: 0,
    };
  }

  const prices = history.prices;

  const rsi14 = calculateRSI(prices, 14);
  const macd = calculateMACD(prices);
  const bollingerBands = calculateBollingerBands(prices, 20, 2);
  const sma20 = calculateSMA(prices, 20);
  const sma50 = calculateSMA(prices, 50);

  // Volume analysis: compare current 24h volume to 7-day average
  let volumeChange24hPct: number | null = null;
  if (history.volumes.length >= 168) { // 7 days of hourly data
    const recentVolumes = history.volumes.slice(-168);
    const avgDailyVolume = recentVolumes.reduce((s, v) => s + v, 0) / 7;
    if (avgDailyVolume > 0) {
      volumeChange24hPct = ((volume24h - avgDailyVolume) / avgDailyVolume) * 100;
    }
  }

  const trendDirection = determineTrend(prices, sma20, sma50);
  const { score, signal } = calculateConfluence(rsi14, macd, bollingerBands, trendDirection, priceChange24h, priceChange7d);

  return {
    rsi14, macd, bollingerBands,
    sma20, sma50,
    volumeChange24h: volumeChange24hPct,
    trendDirection,
    overallSignal: signal,
    confluenceScore: score,
  };
}

/**
 * Fetch technical indicators for all tokens — with rate limit awareness
 * Staggers requests to stay within CoinGecko free tier limits
 */
async function getTokenIndicators(
  tokens: MarketData["tokens"]
): Promise<Record<string, TechnicalIndicators>> {
  const indicators: Record<string, TechnicalIndicators> = {};

  // Deduplicate by coingeckoId (ETH and WETH share same ID)
  const uniqueTokens: { symbol: string; coingeckoId: string; price: number; change24h: number; change7d: number; volume: number }[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const registry = TOKEN_REGISTRY[token.symbol];
    if (!registry || token.symbol === "USDC") continue;

    const cgId = registry.coingeckoId;
    if (seen.has(cgId)) {
      // Copy indicators from the first token with this ID
      const firstToken = uniqueTokens.find(t => t.coingeckoId === cgId);
      if (firstToken) {
        // Will be copied after computation
      }
      continue;
    }
    seen.add(cgId);
    uniqueTokens.push({
      symbol: token.symbol, coingeckoId: cgId,
      price: token.price, change24h: token.priceChange24h,
      change7d: token.priceChange7d, volume: token.volume24h,
    });
  }

  // Fetch in batches of 3 with 1s delay between batches
  for (let i = 0; i < uniqueTokens.length; i += 3) {
    const batch = uniqueTokens.slice(i, i + 3);
    const results = await Promise.allSettled(
      batch.map(t => computeIndicators(t.coingeckoId, t.price, t.change24h, t.change7d, t.volume))
    );

    for (let j = 0; j < batch.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled") {
        indicators[batch[j].symbol] = result.value;
        // Copy to tokens sharing same coingeckoId
        for (const token of tokens) {
          const reg = TOKEN_REGISTRY[token.symbol];
          if (reg && reg.coingeckoId === batch[j].coingeckoId && token.symbol !== batch[j].symbol) {
            indicators[token.symbol] = result.value;
          }
        }
      } else {
        indicators[batch[j].symbol] = {
          rsi14: null, macd: null, bollingerBands: null,
          sma20: null, sma50: null, volumeChange24h: null,
          trendDirection: "SIDEWAYS", overallSignal: "NEUTRAL", confluenceScore: 0,
        };
      }
    }

    // Rate limit delay between batches
    if (i + 3 < uniqueTokens.length) {
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
  }

  return indicators;
}

/**
 * Format technical indicators for the AI prompt — human-readable summary
 */
function formatIndicatorsForPrompt(indicators: Record<string, TechnicalIndicators>, tokens: MarketData["tokens"]): string {
  const lines: string[] = [];

  for (const token of tokens) {
    if (token.symbol === "USDC") continue;
    const ind = indicators[token.symbol];
    if (!ind) continue;

    const parts: string[] = [`${token.symbol}:`];

    if (ind.rsi14 !== null) {
      const rsiLabel = ind.rsi14 < 30 ? "OVERSOLD" : ind.rsi14 > 70 ? "OVERBOUGHT" : "neutral";
      parts.push(`RSI=${ind.rsi14.toFixed(0)}(${rsiLabel})`);
    }

    if (ind.macd) {
      parts.push(`MACD=${ind.macd.signal}`);
    }

    if (ind.bollingerBands) {
      parts.push(`BB%B=${ind.bollingerBands.percentB.toFixed(2)}(${ind.bollingerBands.signal})`);
    }

    parts.push(`Trend=${ind.trendDirection}`);

    if (ind.volumeChange24h !== null) {
      parts.push(`Vol=${ind.volumeChange24h > 0 ? "+" : ""}${ind.volumeChange24h.toFixed(0)}%vs7dAvg`);
    }

    parts.push(`Signal=${ind.overallSignal}(${ind.confluenceScore > 0 ? "+" : ""}${ind.confluenceScore})`);

    lines.push(`  ${parts.join(" | ")}`);
  }

  return lines.join("\n");
}

// ============================================================================
// DIRECT ON-CHAIN BALANCE READING (same as v3.1.1)
// ============================================================================

const BASE_RPC_URL = "https://mainnet.base.org";

async function rpcCall(method: string, params: any[]): Promise<any> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.post(BASE_RPC_URL, {
        jsonrpc: "2.0", id: 1, method, params,
      }, { timeout: 15000 });
      if (response.data.error) {
        throw new Error(`RPC error: ${response.data.error.message}`);
      }
      return response.data.result;
    } catch (error: any) {
      const status = error?.response?.status;
      const isRetryable = status === 429 || status === 502 || status === 503 ||
        error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT' || error?.code === 'ENOTFOUND';
      if (isRetryable && attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        continue;
      }
      throw error;
    }
  }
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

  // Build list of tokens to query (deferred — promises created per batch to avoid RPC rate limits)
  const tokenEntries = Object.entries(TOKEN_REGISTRY);

  const results: { symbol: string; balance: number }[] = [];
  const batchSize = 4; // Smaller batches for public RPC
  for (let i = 0; i < tokenEntries.length; i += batchSize) {
    const batch = tokenEntries.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async ([symbol, token]) => {
        const balance = token.address === "native"
          ? await getETHBalance(walletAddress)
          : await getERC20Balance(token.address, walletAddress, token.decimals);
        return { symbol, balance };
      })
    );
    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        const failedSymbol = batch[batchResults.indexOf(result)]?.[0] || "unknown";
        console.warn(`  ⚠️ Failed to fetch balance for ${failedSymbol}: ${result.reason}`);
      }
    }
    // Stagger between batches to respect public RPC rate limits
    if (i + batchSize < tokenEntries.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
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

  const nonZero = balances.filter(b => b.balance > 0);
  console.log(`  ✅ Found ${nonZero.length} tokens with balances`);
  for (const b of nonZero) {
    console.log(`     ${b.symbol}: ${b.balance < 0.001 ? b.balance.toFixed(8) : b.balance.toFixed(4)} (${b.symbol === "USDC" ? `$${b.usdValue.toFixed(2)}` : "pending price"})`);
  }
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

  // Build technical indicators summary for the AI
  const indicatorsSummary = formatIndicatorsForPrompt(marketData.indicators, marketData.tokens);

  // Find tokens with strongest buy/sell signals
  const strongBuySignals = Object.entries(marketData.indicators)
    .filter(([_, ind]) => ind.confluenceScore >= 30)
    .sort(([_, a], [__, b]) => b.confluenceScore - a.confluenceScore)
    .slice(0, 3)
    .map(([sym, ind]) => `${sym}(+${ind.confluenceScore})`);

  const strongSellSignals = Object.entries(marketData.indicators)
    .filter(([_, ind]) => ind.confluenceScore <= -30)
    .sort(([_, a], [__, b]) => a.confluenceScore - b.confluenceScore)
    .slice(0, 3)
    .map(([sym, ind]) => `${sym}(${ind.confluenceScore})`);

  // Build trade history summary for AI memory (last 10 trades)
  const recentTrades = state.tradeHistory.slice(-10);
  const tradeHistorySummary = recentTrades.length > 0
    ? recentTrades.map(t =>
        `  ${t.timestamp.slice(5, 16)} ${t.action} ${t.fromToken}→${t.toToken} $${t.amountUSD.toFixed(2)} ${t.success ? "✅" : "❌"} ${t.reasoning?.substring(0, 60) || ""}`
      ).join("\n")
    : "  No trades yet";

  const systemPrompt = `You are Henry's autonomous crypto trading agent v3.4 on Base network.
You are a TECHNICAL TRADER with access to real-time indicators. Your decisions execute LIVE swaps.

═══ PORTFOLIO ═══
- USDC Available: $${availableUSDC.toFixed(2)}
- Token Holdings: $${totalTokenValue.toFixed(2)}
- Total: $${totalPortfolioValue.toFixed(2)}
- P&L: ${((totalPortfolioValue - state.trading.initialValue) / state.trading.initialValue * 100).toFixed(1)}% from $${state.trading.initialValue}
- Peak: $${state.trading.peakValue.toFixed(2)} | Drawdown: ${state.trading.peakValue > 0 ? ((state.trading.peakValue - totalPortfolioValue) / state.trading.peakValue * 100).toFixed(1) : "0.0"}%

═══ SECTOR ALLOCATIONS ═══
${sectorAllocations.map(s =>
  `${s.drift > 5 ? "⚠️OVER" : s.drift < -5 ? "⚠️UNDER" : "✅"} ${s.name}: ${s.currentPercent.toFixed(1)}% (target: ${s.targetPercent}%) drift: ${s.drift >= 0 ? "+" : ""}${s.drift.toFixed(1)}%`
).join("\n")}

═══ HOLDINGS ═══
${Object.entries(holdingsBySector).map(([sector, holdings]) =>
  `${sector}: ${holdings.length > 0 ? holdings.join(" | ") : "Empty"}`
).join("\n")}

═══ MARKET SENTIMENT ═══
- Fear & Greed: ${marketData.fearGreed.value}/100 (${marketData.fearGreed.classification})
- Trending: ${marketData.trendingTokens.join(", ") || "None"}

═══ TECHNICAL INDICATORS ═══
${indicatorsSummary || "  No indicator data available"}

${strongBuySignals.length > 0 ? `🟢 STRONGEST BUY SIGNALS: ${strongBuySignals.join(", ")}` : ""}
${strongSellSignals.length > 0 ? `🔴 STRONGEST SELL SIGNALS: ${strongSellSignals.join(", ")}` : ""}

═══ TOKEN PRICES ═══
${Object.entries(marketBySector).map(([sector, tokens]) =>
  `${sector}: ${tokens.slice(0, 5).join(" | ")}`
).join("\n")}

═══ RECENT TRADE HISTORY ═══
${tradeHistorySummary}

═══ TRADING LIMITS ═══
- Max BUY: $${maxBuyAmount.toFixed(2)} | Max SELL: ${CONFIG.trading.maxSellPercent}% of position
- Available tokens: ${tradeableTokens}

═══ STRATEGY FRAMEWORK ═══

ENTRY RULES (when to BUY):
1. CONFLUENCE: Only buy when 2+ indicators agree (RSI oversold + MACD bullish, or BB oversold + uptrend)
2. FEAR AMPLIFIER: During extreme fear (<25), lower the bar — buy on 1 indicator signal
3. SECTOR PRIORITY: Buy into the most underweight sector first
4. VOLUME CONFIRMATION: Prefer tokens where volume is above 7-day average (strength behind the move)
5. TREND ALIGNMENT: Prefer buying tokens in UP or STRONG_UP trends

EXIT RULES (when to SELL):
1. TAKE PROFIT: Sell 25-50% of a position if token is up >15% in 24h AND RSI > 65
2. OVERBOUGHT EXIT: Sell if RSI > 75 AND Bollinger %B > 0.95 AND MACD turning bearish
3. STOP LOSS: Sell if token is down >20% in 7d and trend is STRONG_DOWN
4. SECTOR TRIM: Sell from overweight sectors (>10% drift) to rebalance

RISK RULES:
1. No single token > 25% of portfolio
2. HOLD if confluence score is between -15 and +15 (no clear signal)
3. Never chase pumps — if token up >20% in 24h with RSI >75, wait for pullback
4. In extreme greed (>75), tighten sell rules — take profits more aggressively
5. Minimum trade $1.00

DECISION PRIORITY: Technical signals > Sector rebalancing > Sentiment

For SELLING: fromToken = token symbol, toToken = USDC
For BUYING: fromToken = USDC, toToken = token symbol

Respond with ONLY valid JSON:
{
  "action": "BUY" | "SELL" | "HOLD" | "REBALANCE",
  "fromToken": "USDC" or token symbol,
  "toToken": token symbol or "USDC",
  "amountUSD": <number>,
  "reasoning": "<1-2 sentences citing specific indicators that drove this decision>",
  "sector": "<sector name if relevant>"
}`;

  // Retry up to 3 times with exponential backoff for rate limits
  for (let attempt = 1; attempt <= 3; attempt++) {
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

        const validTokens = ["USDC", "NONE", ...CONFIG.activeTokens];
        console.log(`   AI raw response: action=${decision.action} from=${decision.fromToken} to=${decision.toToken} amt=$${decision.amountUSD}`);
        if (decision.action === "HOLD") {
          return { action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: decision.reasoning || "AI chose HOLD" };
        }
        if (!validTokens.includes(decision.fromToken) || !validTokens.includes(decision.toToken)) {
          console.log(`   ⚠️ Invalid tokens: from="${decision.fromToken}" to="${decision.toToken}" — not in valid list`);
          return { action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: `Invalid token: ${decision.fromToken}→${decision.toToken}` };
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
      const status = error?.status || error?.response?.status;
      if (status === 429 && attempt < 3) {
        const waitSec = Math.pow(2, attempt) * 10; // 20s, 40s
        console.log(`  ⏳ Rate limited (429). Waiting ${waitSec}s before retry ${attempt + 1}/3...`);
        await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
        continue;
      }
      console.error("AI decision failed:", error.message);
      return { action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: `Error: ${error.message}` };
    }
  }
  return { action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: "Max retries exceeded" };
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

    // Get or create the CDP-managed EOA account
    const account = await cdpClient.evm.getOrCreateAccount({
      name: "henry-trading-bot",
    });

    console.log(`     Account: ${account.address}`);

    // Approve Permit2 contract to spend the fromToken (one-time per token)
    const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    const MAX_UINT256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    const APPROVE_SELECTOR = "0x095ea7b3"; // approve(address,uint256)

    // Check current allowance first
    const allowanceData = "0xdd62ed3e" +
      account.address.slice(2).padStart(64, "0") +
      PERMIT2_ADDRESS.slice(2).padStart(64, "0");

    const currentAllowance = await rpcCall("eth_call", [{
      to: fromTokenAddress,
      data: allowanceData
    }, "latest"]);

    let justApproved = false;
    if (currentAllowance === "0x" || currentAllowance === "0x0000000000000000000000000000000000000000000000000000000000000000" || BigInt(currentAllowance) < fromAmount) {
      console.log(`     🔓 Approving Permit2 to spend ${decision.fromToken}...`);
      const approveData = APPROVE_SELECTOR +
        PERMIT2_ADDRESS.slice(2).padStart(64, "0") +
        MAX_UINT256.slice(2);

      const approveTx = await account.sendTransaction({
        network: "base",
        transaction: {
          to: fromTokenAddress,
          data: approveData as `0x${string}`,
          value: BigInt(0),
        },
      });
      console.log(`     ✅ Permit2 approved: ${approveTx.transactionHash}`);
      justApproved = true;
      // Wait for the approval to propagate — CDP API needs time to see the on-chain state
      console.log(`     ⏳ Waiting 10s for approval to propagate...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    } else {
      console.log(`     ✅ Permit2 already approved for ${decision.fromToken}`);
    }

    // Execute the swap with retry logic — CDP API may not see the approval immediately
    let result: any;
    const maxRetries = justApproved ? 3 : 1;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`     🔄 Swap attempt ${attempt}/${maxRetries}...`);
        result = await account.swap({
          network: "base",
          fromToken: fromTokenAddress,
          toToken: toTokenAddress,
          fromAmount,
          slippageBps: CONFIG.trading.slippageBps,
        });
        break; // Success — exit retry loop
      } catch (swapError: any) {
        const swapMsg = swapError?.message || "";
        if (swapMsg.includes("Insufficient token allowance") && attempt < maxRetries) {
          console.log(`     ⏳ Allowance not yet visible to API, retrying in 15s... (attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 15000));
        } else {
          throw swapError; // Re-throw for outer catch to handle
        }
      }
    }

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

    // Full diagnostic logging for trade failures
    console.error(`\n  ❌ TRADE FAILED — Full Diagnostics:`);
    console.error(`     Error: ${errorMsg}`);
    if (error.code) console.error(`     Code: ${error.code}`);
    if (error.status) console.error(`     Status: ${error.status}`);
    if (error.response?.data) {
      try {
        console.error(`     API Response: ${JSON.stringify(error.response.data).substring(0, 500)}`);
      } catch { console.error(`     API Response: [non-serializable]`); }
    }
    if (error.stack) console.error(`     Stack: ${error.stack.split('\n').slice(0, 5).join('\n     ')}`);

    // Handle specific error types
    if (errorMsg.includes("Insufficient liquidity")) {
      console.error(`     → Insufficient liquidity for ${decision.fromToken} → ${decision.toToken}. Try smaller amount.`);
    } else if (errorMsg.includes("insufficient funds")) {
      console.error(`     → Insufficient ${decision.fromToken} balance for this trade.`);
    } else if (errorMsg.includes("timeout") || errorMsg.includes("ETIMEDOUT")) {
      console.error(`     → Network timeout. CDP API may be unreachable from this server.`);
    } else if (errorMsg.includes("401") || errorMsg.includes("Unauthorized")) {
      console.error(`     → Authentication failed. Check CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET.`);
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

    // Display technical indicators summary
    if (Object.keys(marketData.indicators).length > 0) {
      console.log(`\n📐 Technical Indicators:`);
      const buySignals: string[] = [];
      const sellSignals: string[] = [];
      for (const [symbol, ind] of Object.entries(marketData.indicators)) {
        const rsiStr = ind.rsi14 !== null ? `RSI=${ind.rsi14.toFixed(0)}` : "";
        const macdStr = ind.macd ? `MACD=${ind.macd.signal}` : "";
        const bbStr = ind.bollingerBands ? `BB=${ind.bollingerBands.signal}` : "";
        const scoreStr = `Score=${ind.confluenceScore > 0 ? "+" : ""}${ind.confluenceScore}`;
        console.log(`   ${symbol}: ${[rsiStr, macdStr, bbStr, `Trend=${ind.trendDirection}`, scoreStr].filter(Boolean).join(" | ")} → ${ind.overallSignal}`);
        if (ind.confluenceScore >= 30) buySignals.push(`${symbol}(+${ind.confluenceScore})`);
        if (ind.confluenceScore <= -30) sellSignals.push(`${symbol}(${ind.confluenceScore})`);
      }
      if (buySignals.length > 0) console.log(`   🟢 Buy signals: ${buySignals.join(", ")}`);
      if (sellSignals.length > 0) console.log(`   🔴 Sell signals: ${sellSignals.join(", ")}`);
    }

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
║   🤖 HENRY'S AUTONOMOUS TRADING AGENT v3.4                            ║
║   ════════════════════════════════════════                              ║
║                                                                        ║
║   LIVE TRADING + TECHNICAL INDICATORS | Base Network                   ║
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
  console.log(`   Execution: Coinbase CDP SDK (account.swap + Permit2 approval)`);
  console.log(`   Indicators: RSI(14), MACD(12/26/9), Bollinger(20,2), SMA(20/50)`);
  console.log(`   AI Strategy: Confluence-based (indicators > sectors > sentiment)`);
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

  // Initialize CDP client with EOA account
  try {
    console.log("\n🔧 Initializing CDP SDK...");
    cdpClient = createCdpClient();
    console.log("  ✅ CDP Client created");

    // Get or create the EOA account for trading
    console.log("  🔍 Verifying CDP account access...");
    const account = await cdpClient.evm.getOrCreateAccount({ name: "henry-trading-bot" });
    console.log(`  ✅ CDP Account verified: ${account.address}`);
    console.log(`  ✅ CDP SDK fully operational — trades WILL execute`);

    if (account.address.toLowerCase() !== CONFIG.walletAddress.toLowerCase()) {
      console.log(`\n  ⚠️ Note: CDP account address differs from WALLET_ADDRESS`);
      console.log(`     CDP Account: ${account.address}`);
      console.log(`     WALLET_ADDRESS: ${CONFIG.walletAddress}`);
      console.log(`     Trades execute from CDP account. Balance reading uses WALLET_ADDRESS.`);
      console.log(`     To align: update WALLET_ADDRESS=${account.address} in Railway vars.`);
    }

    // Check gas balance — EOA needs ETH for gas to approve tokens
    try {
      const ethBalance = await getETHBalance(account.address);
      const usdcBalance = await getERC20Balance("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", account.address, 6);
      console.log(`\n  💰 Fund Status:`);
      console.log(`     USDC: $${usdcBalance.toFixed(2)}`);
      console.log(`     ETH (for gas): ${ethBalance.toFixed(6)} ETH (~$${(ethBalance * 2700).toFixed(2)})`);
      if (ethBalance < 0.0001 && usdcBalance > 1) {
        console.log(`\n  ⚠️ WARNING: Account has USDC but almost no ETH for gas!`);
        console.log(`     Token approvals require a small ETH gas fee (~$0.01 on Base).`);
        console.log(`     Send at least 0.0005 ETH (~$1.35) to: ${account.address}`);
        console.log(`     Once ETH is available, Permit2 approvals and swaps will work.`);
      }
    } catch (balError: any) {
      console.log(`  ⚠️ Balance check failed: ${balError.message?.substring(0, 150)}`);
    }

  } catch (error: any) {
    console.error(`\n❌ CDP initialization FAILED: ${error.message}`);
    if (error.stack) console.error(`   Stack: ${error.stack.split('\n').slice(0, 3).join('\n   ')}`);
    if (error.code) console.error(`   Code: ${error.code}`);
    console.error("   🚫 Trades will NOT execute. Bot will run in analysis-only mode.");
    console.error("   Fix: Verify CDP_API_KEY_NAME, CDP_API_KEY_PRIVATE_KEY, CDP_WALLET_SECRET in Railway vars.");
  }

  loadTradeHistory();

  // Run immediately
  await runTradingCycle();

  // Schedule recurring cycles with robust error handling
  const cronExpression = `*/${CONFIG.trading.intervalMinutes} * * * *`;
  cron.schedule(cronExpression, async () => {
    try {
      await runTradingCycle();
    } catch (cronError: any) {
      console.error(`[Cron Error] Cycle failed: ${cronError?.message?.substring(0, 300) || cronError}`);
    }
  });

  // Heartbeat every 5 minutes to confirm process is alive
  setInterval(() => {
    console.log(`💓 Heartbeat | ${new Date().toISOString()} | Cycles: ${state.totalCycles} | Trades: ${state.trading.successfulTrades}/${state.trading.totalTrades}`);
  }, 5 * 60 * 1000);

  console.log("\n🚀 Agent v3.4 running! Technical indicators active. Press Ctrl+C to stop.\n");
}

main().catch((err) => {
  console.error("Fatal error:", err?.message || String(err));
  if (err?.stack) console.error(err.stack.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
});

// Simple HTTP health check server for Railway
import http from 'http';
const healthServer = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    const uptime = Math.floor((Date.now() - state.startTime.getTime()) / 1000);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: "ok",
      version: "3.4",
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
