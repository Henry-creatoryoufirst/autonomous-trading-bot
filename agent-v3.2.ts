/**
 * Henry's Autonomous Trading Agent v4.5.1.1
 *
 * PHASE 2 BRAIN UPGRADE: News Sentiment + Macro Intelligence
 *
 * CHANGES IN V4.5.1:
 * - Fixed CryptoPanic: proper API v1 endpoint with auth_token (env: CRYPTOPANIC_AUTH_TOKEN)
 * - Fixed FRED API: updated to v2 Bearer auth header (Nov 2025 change)
 * - Fixed CoinGecko: retry with exponential backoff (3 attempts) to prevent $0 portfolio pricing
 *
 * CHANGES IN V4.5:
 * - CryptoPanic news sentiment: bullish/bearish news classification, per-token mentions, headline tracking
 * - FRED macro data: Fed Funds Rate, 10Y Treasury, yield curve, CPI, M2 money supply, dollar index
 * - Macro signal engine: composite RISK_ON / RISK_OFF / NEUTRAL based on Fed policy + liquidity + dollar
 * - News sentiment scoring: -100 to +100 composite, per-token bullish/bearish mention tracking
 * - Macro-aware strategy: regime × macro cross-rules for position sizing and conviction
 * - 8 data sources feeding every decision cycle
 * - Upgraded AI prompt: 8-dimensional market awareness
 *
 * CHANGES IN V4.0 (Phase 1):
 * - DefiLlama integration: Base chain TVL, DEX volumes, protocol-level TVL changes
 * - Binance derivatives: BTC/ETH funding rates + open interest (leading indicators)
 * - Enhanced trade logging: full signal context, market regime, indicator snapshots
 * - Trade performance scoring: win rate, avg return, signal effectiveness tracking
 * - Market regime detection: trending/ranging/volatile based on multi-factor analysis
 *
 * CHANGES IN V3.5:
 * - Cost basis tracking: avg purchase price, realized/unrealized P&L per token
 * - Profit-taking guard: auto-sell 30% when token up 20%+ from avg cost
 * - Stop-loss guard: auto-sell 50% when token down 25%+ (or 20% trailing from peak)
 * - Live dashboard: real-time web UI at / with portfolio, P&L, holdings, trades
 * - API endpoints: /api/portfolio, /api/balances, /api/sectors, /api/trades, /api/indicators
 *
 * Sectors:
 * - BLUE_CHIP (40%): ETH, cbBTC, cbETH
 * - AI_TOKENS (20%): VIRTUAL, AIXBT, GAME, HIGHER
 * - MEME_COINS (20%): BRETT, DEGEN, TOSHI, MOCHI, NORMIE
 * - DEFI (20%): AERO, WELL, SEAM, EXTRA, BAL
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
    symbol: "WELL", name: "Moonwell", coingeckoId: "moonwell-artemis",
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
    // V3.5: Profit-Taking
    profitTaking: {
      enabled: true,
      targetPercent: 20,        // Trigger at 20% unrealized gain
      sellPercent: 30,          // Sell 30% of the winning position
      minHoldingUSD: 10,        // Don't trigger if holding < $10
      cooldownHours: 24,        // Cooldown per token between triggers
    },
    // V3.5: Stop-Loss
    stopLoss: {
      enabled: true,
      percentThreshold: -25,    // Trigger at -25% from avg cost
      sellPercent: 50,          // Sell 50% of the losing position
      minHoldingUSD: 5,         // Don't trigger if holding < $5
      trailingEnabled: true,    // Also use trailing stop from peak
      trailingPercent: -20,     // Trigger at -20% from token's peak
    },
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
  // V4.0: Enhanced signal context for self-learning
  signalContext?: {
    marketRegime: MarketRegime;
    confluenceScore: number;             // Score at time of trade
    rsi: number | null;                  // RSI of traded token
    macdSignal: string | null;           // MACD signal of traded token
    btcFundingRate: number | null;       // BTC funding rate at time of trade
    ethFundingRate: number | null;       // ETH funding rate at time of trade
    baseTVLChange24h: number | null;     // Base chain TVL change
    baseDEXVolume24h: number | null;     // Base DEX volume
    triggeredBy: "AI" | "STOP_LOSS" | "PROFIT_TAKE";  // What initiated the trade
  };
}

// V4.0: Trade performance tracking
interface TradePerformanceStats {
  totalTrades: number;
  winRate: number;               // % of trades with positive outcome
  avgReturnPercent: number;      // Average return per trade
  bestTrade: { symbol: string; returnPercent: number } | null;
  worstTrade: { symbol: string; returnPercent: number } | null;
  avgHoldingPeriod: string;      // Average time between buy and sell
  profitFactor: number;          // Gross profit / Gross loss
  winsByRegime: Record<MarketRegime, { wins: number; total: number }>;
}

/**
 * Calculate trade performance stats from history (for AI context)
 */
function calculateTradePerformance(): TradePerformanceStats {
  const completedTrades = state.tradeHistory.filter(t => t.success && t.action !== "HOLD");
  const totalTrades = completedTrades.length;

  if (totalTrades === 0) {
    return {
      totalTrades: 0, winRate: 0, avgReturnPercent: 0,
      bestTrade: null, worstTrade: null, avgHoldingPeriod: "N/A",
      profitFactor: 0, winsByRegime: {} as any,
    };
  }

  // Calculate wins based on realized P&L from cost basis
  let grossProfit = 0;
  let grossLoss = 0;
  const tradeReturns: { symbol: string; returnPercent: number }[] = [];

  for (const trade of completedTrades) {
    if (trade.action === "SELL") {
      const cb = state.costBasis[trade.fromToken];
      if (cb && cb.averageCostBasis > 0 && trade.amountUSD > 0) {
        const tokensSold = trade.tokenAmount || (trade.amountUSD / (cb.averageCostBasis || 1));
        const costOfSold = tokensSold * cb.averageCostBasis;
        const pnl = trade.amountUSD - costOfSold;
        const returnPct = costOfSold > 0 ? (pnl / costOfSold) * 100 : 0;
        tradeReturns.push({ symbol: trade.fromToken, returnPercent: returnPct });
        if (pnl > 0) grossProfit += pnl;
        else grossLoss += Math.abs(pnl);
      }
    }
  }

  const wins = tradeReturns.filter(t => t.returnPercent > 0).length;
  const winRate = tradeReturns.length > 0 ? (wins / tradeReturns.length) * 100 : 0;
  const avgReturn = tradeReturns.length > 0 ? tradeReturns.reduce((s, t) => s + t.returnPercent, 0) / tradeReturns.length : 0;
  const best = tradeReturns.length > 0 ? tradeReturns.reduce((a, b) => a.returnPercent > b.returnPercent ? a : b) : null;
  const worst = tradeReturns.length > 0 ? tradeReturns.reduce((a, b) => a.returnPercent < b.returnPercent ? a : b) : null;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Win rate by market regime
  const winsByRegime: Record<string, { wins: number; total: number }> = {};
  for (const trade of completedTrades) {
    const regime = trade.signalContext?.marketRegime || "UNKNOWN";
    if (!winsByRegime[regime]) winsByRegime[regime] = { wins: 0, total: 0 };
    winsByRegime[regime].total++;
    // Approximate: if trade was a sell with positive reasoning
    if (trade.action === "SELL") {
      const ret = tradeReturns.find(r => r.symbol === trade.fromToken);
      if (ret && ret.returnPercent > 0) winsByRegime[regime].wins++;
    }
  }

  return {
    totalTrades, winRate, avgReturnPercent: avgReturn,
    bestTrade: best, worstTrade: worst,
    avgHoldingPeriod: "tracked per token via costBasis",
    profitFactor,
    winsByRegime: winsByRegime as any,
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

interface TokenCostBasis {
  symbol: string;
  totalInvestedUSD: number;       // Total USD spent buying this token
  totalTokensAcquired: number;    // Total tokens bought (gross, before sells reduce it)
  averageCostBasis: number;       // Weighted avg price paid per token
  currentHolding: number;         // Tokens held right now (synced from on-chain)
  realizedPnL: number;            // Cumulative profit/loss from sells
  unrealizedPnL: number;          // (currentPrice - avgCost) * currentHolding
  peakPrice: number;              // Highest price seen since first purchase
  peakPriceDate: string;          // When peak occurred
  firstBuyDate: string;
  lastTradeDate: string;
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
  costBasis: Record<string, TokenCostBasis>;
  profitTakeCooldowns: Record<string, string>;  // symbol → ISO date of last trigger
  stopLossCooldowns: Record<string, string>;     // symbol → ISO date of last trigger
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
    initialValue: 494,
    peakValue: 494,
    sectorAllocations: [],
  },
  tradeHistory: [],
  costBasis: {},
  profitTakeCooldowns: {},
  stopLossCooldowns: {},
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
        state.trading.initialValue = parsed.initialValue || 494;
        state.trading.peakValue = parsed.peakValue || 374;
        state.trading.totalTrades = parsed.totalTrades || 0;
        state.trading.successfulTrades = parsed.successfulTrades || 0;
        state.costBasis = parsed.costBasis || {};
        state.profitTakeCooldowns = parsed.profitTakeCooldowns || {};
        state.stopLossCooldowns = parsed.stopLossCooldowns || {};
        console.log(`  📂 Loaded ${state.tradeHistory.length} trades, ${Object.keys(state.costBasis).length} cost basis entries from ${file}`);
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
      version: "4.5.1",
      lastUpdated: new Date().toISOString(),
      initialValue: state.trading.initialValue,
      peakValue: state.trading.peakValue,
      currentValue: state.trading.totalPortfolioValue,
      totalTrades: state.trading.totalTrades,
      successfulTrades: state.trading.successfulTrades,
      sectorAllocations: state.trading.sectorAllocations,
      trades: state.tradeHistory,
      costBasis: state.costBasis,
      profitTakeCooldowns: state.profitTakeCooldowns,
      stopLossCooldowns: state.stopLossCooldowns,
    };
    fs.writeFileSync(CONFIG.logFile, JSON.stringify(data, null, 2));
  } catch (e: any) {
    console.error("Failed to save trade history:", e.message);
  }
}

// ============================================================================
// COST BASIS TRACKING
// ============================================================================

function getOrCreateCostBasis(symbol: string): TokenCostBasis {
  if (!state.costBasis[symbol]) {
    state.costBasis[symbol] = {
      symbol,
      totalInvestedUSD: 0,
      totalTokensAcquired: 0,
      averageCostBasis: 0,
      currentHolding: 0,
      realizedPnL: 0,
      unrealizedPnL: 0,
      peakPrice: 0,
      peakPriceDate: new Date().toISOString(),
      firstBuyDate: new Date().toISOString(),
      lastTradeDate: new Date().toISOString(),
    };
  }
  return state.costBasis[symbol];
}

function updateCostBasisAfterBuy(symbol: string, amountUSD: number, tokensReceived: number): void {
  const cb = getOrCreateCostBasis(symbol);
  if (cb.totalTokensAcquired === 0) cb.firstBuyDate = new Date().toISOString();
  cb.totalInvestedUSD += amountUSD;
  cb.totalTokensAcquired += tokensReceived;
  // Weighted average: new avg = total invested / total tokens
  cb.averageCostBasis = cb.totalInvestedUSD / cb.totalTokensAcquired;
  cb.lastTradeDate = new Date().toISOString();
  console.log(`     📊 Cost basis updated: ${symbol} avg=$${cb.averageCostBasis.toFixed(6)} invested=$${cb.totalInvestedUSD.toFixed(2)}`);
}

function updateCostBasisAfterSell(symbol: string, amountUSD: number, tokensSold: number): number {
  const cb = getOrCreateCostBasis(symbol);
  // Realized P&L = (sell price per token - avg cost) * tokens sold
  const sellPricePerToken = tokensSold > 0 ? amountUSD / tokensSold : 0;
  const realizedPnL = (sellPricePerToken - cb.averageCostBasis) * tokensSold;
  cb.realizedPnL += realizedPnL;
  // Reduce invested proportionally (cost basis stays same for remaining tokens)
  const proportionSold = cb.totalTokensAcquired > 0 ? tokensSold / cb.totalTokensAcquired : 0;
  cb.totalInvestedUSD = Math.max(0, cb.totalInvestedUSD * (1 - proportionSold));
  cb.totalTokensAcquired = Math.max(0, cb.totalTokensAcquired - tokensSold);
  cb.lastTradeDate = new Date().toISOString();
  console.log(`     📊 Sell P&L: ${realizedPnL >= 0 ? "+" : ""}$${realizedPnL.toFixed(2)} on ${symbol} (avg cost $${cb.averageCostBasis.toFixed(6)})`);
  return realizedPnL;
}

function updateUnrealizedPnL(balances: { symbol: string; balance: number; usdValue: number; price?: number }[]): void {
  for (const b of balances) {
    if (b.symbol === "USDC" || !state.costBasis[b.symbol]) continue;
    const cb = state.costBasis[b.symbol];
    cb.currentHolding = b.balance;
    const currentPrice = b.price || (b.balance > 0 ? b.usdValue / b.balance : 0);
    cb.unrealizedPnL = cb.averageCostBasis > 0 ? (currentPrice - cb.averageCostBasis) * b.balance : 0;
    // Update peak price for trailing stop
    if (currentPrice > cb.peakPrice) {
      cb.peakPrice = currentPrice;
      cb.peakPriceDate = new Date().toISOString();
    }
  }
}

// ============================================================================
// PROFIT-TAKING & STOP-LOSS GUARDS
// ============================================================================

function checkProfitTaking(
  balances: { symbol: string; balance: number; usdValue: number; price?: number; sector?: string }[],
): TradeDecision | null {
  if (!CONFIG.trading.profitTaking.enabled) return null;

  const cfg = CONFIG.trading.profitTaking;
  const now = new Date();

  for (const b of balances) {
    if (b.symbol === "USDC" || b.usdValue < cfg.minHoldingUSD) continue;
    const cb = state.costBasis[b.symbol];
    if (!cb || cb.averageCostBasis <= 0) continue;

    const currentPrice = b.price || (b.balance > 0 ? b.usdValue / b.balance : 0);
    const gainPercent = ((currentPrice - cb.averageCostBasis) / cb.averageCostBasis) * 100;

    if (gainPercent >= cfg.targetPercent) {
      // Check cooldown
      const lastTrigger = state.profitTakeCooldowns[b.symbol];
      if (lastTrigger) {
        const hoursSince = (now.getTime() - new Date(lastTrigger).getTime()) / (1000 * 60 * 60);
        if (hoursSince < cfg.cooldownHours) continue;
      }

      const sellUSD = b.usdValue * (cfg.sellPercent / 100);
      const tokenAmount = b.balance * (cfg.sellPercent / 100);
      console.log(`\n  🎯 PROFIT-TAKE: ${b.symbol} is UP +${gainPercent.toFixed(1)}% (target: ${cfg.targetPercent}%)`);
      console.log(`     Avg cost: $${cb.averageCostBasis.toFixed(6)} → Current: $${currentPrice.toFixed(6)}`);
      console.log(`     Selling ${cfg.sellPercent}% = ~$${sellUSD.toFixed(2)}`);

      state.profitTakeCooldowns[b.symbol] = now.toISOString();

      return {
        action: "SELL",
        fromToken: b.symbol,
        toToken: "USDC",
        amountUSD: sellUSD,
        tokenAmount,
        reasoning: `Profit-take: ${b.symbol} +${gainPercent.toFixed(1)}% from avg cost $${cb.averageCostBasis.toFixed(4)}. Selling ${cfg.sellPercent}%.`,
        sector: b.sector,
      };
    }
  }
  return null;
}

function checkStopLoss(
  balances: { symbol: string; balance: number; usdValue: number; price?: number; sector?: string }[],
): TradeDecision | null {
  if (!CONFIG.trading.stopLoss.enabled) return null;

  const cfg = CONFIG.trading.stopLoss;
  let worstLoss = 0;
  let worstDecision: TradeDecision | null = null;

  for (const b of balances) {
    if (b.symbol === "USDC" || b.usdValue < cfg.minHoldingUSD) continue;
    const cb = state.costBasis[b.symbol];
    if (!cb || cb.averageCostBasis <= 0) continue;

    const currentPrice = b.price || (b.balance > 0 ? b.usdValue / b.balance : 0);
    const lossFromCost = ((currentPrice - cb.averageCostBasis) / cb.averageCostBasis) * 100;

    // Check trailing stop (loss from peak)
    let trailingLoss = 0;
    if (cfg.trailingEnabled && cb.peakPrice > 0) {
      trailingLoss = ((currentPrice - cb.peakPrice) / cb.peakPrice) * 100;
    }

    const triggered = lossFromCost <= cfg.percentThreshold ||
      (cfg.trailingEnabled && trailingLoss <= cfg.trailingPercent);

    if (triggered && lossFromCost < worstLoss) {
      worstLoss = lossFromCost;
      const sellUSD = b.usdValue * (cfg.sellPercent / 100);
      const tokenAmount = b.balance * (cfg.sellPercent / 100);
      const reason = lossFromCost <= cfg.percentThreshold
        ? `Stop-loss: ${b.symbol} ${lossFromCost.toFixed(1)}% from cost basis $${cb.averageCostBasis.toFixed(4)}`
        : `Trailing stop: ${b.symbol} ${trailingLoss.toFixed(1)}% from peak $${cb.peakPrice.toFixed(4)}`;

      worstDecision = {
        action: "SELL",
        fromToken: b.symbol,
        toToken: "USDC",
        amountUSD: sellUSD,
        tokenAmount,
        reasoning: `${reason}. Selling ${cfg.sellPercent}%.`,
        sector: b.sector,
      };
    }
  }

  if (worstDecision) {
    console.log(`\n  🛑 STOP-LOSS: ${worstDecision.fromToken} is DOWN ${worstLoss.toFixed(1)}%`);
    console.log(`     Selling ${cfg.sellPercent}% = ~$${worstDecision.amountUSD.toFixed(2)}`);
  }

  return worstDecision;
}

// ============================================================================
// MARKET DATA
// ============================================================================

// ============================================================================
// DEFI INTELLIGENCE — DefiLlama + Derivatives (Phase 1 Brain Upgrade)
// ============================================================================

interface DefiLlamaData {
  baseTVL: number;                    // Total TVL on Base chain in USD
  baseTVLChange24h: number;           // % change in Base TVL over 24h
  baseDEXVolume24h: number;           // Total DEX volume on Base in 24h
  topProtocols: { name: string; tvl: number; change24h: number }[];  // Top Base protocols by TVL
  protocolTVLByToken: Record<string, { tvl: number; change24h: number }>;  // TVL for tokens we track
}

interface DerivativesData {
  btcFundingRate: number;             // BTC perp funding rate (% per 8h)
  ethFundingRate: number;             // ETH perp funding rate (% per 8h)
  btcOpenInterest: number;            // BTC total open interest in USD
  ethOpenInterest: number;            // ETH total open interest in USD
  btcFundingSignal: "LONG_CROWDED" | "SHORT_CROWDED" | "NEUTRAL";
  ethFundingSignal: "LONG_CROWDED" | "SHORT_CROWDED" | "NEUTRAL";
  btcOIChange24h: number;             // % change in BTC OI over 24h
  ethOIChange24h: number;             // % change in ETH OI over 24h
}

interface NewsSentimentData {
  overallSentiment: "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";
  bullishCount: number;                              // Number of bullish news items
  bearishCount: number;                              // Number of bearish news items
  totalCount: number;                                // Total news items analyzed
  sentimentScore: number;                            // -100 to +100 composite score
  topHeadlines: { title: string; sentiment: string; source: string }[];  // Top 5 headlines
  tokenMentions: Record<string, { bullish: number; bearish: number; neutral: number }>;  // Per-token sentiment
  lastUpdated: string;                               // ISO timestamp
}

interface MacroData {
  fedFundsRate: { value: number; date: string } | null;           // DFF - Fed Funds Effective Rate
  treasury10Y: { value: number; date: string } | null;            // DGS10 - 10-Year Treasury Yield
  yieldCurve: { value: number; date: string } | null;             // T10Y2Y - 10Y minus 2Y spread
  cpi: { value: number; date: string; yoyChange: number | null } | null;  // CPIAUCSL - Consumer Price Index
  m2MoneySupply: { value: number; date: string; yoyChange: number | null } | null;  // M2SL - M2 Money Supply
  dollarIndex: { value: number; date: string } | null;            // DTWEXBGS - Trade Weighted Dollar
  macroSignal: "RISK_ON" | "RISK_OFF" | "NEUTRAL";               // Composite macro signal
  rateDirection: "HIKING" | "CUTTING" | "PAUSED";                // Fed rate trajectory
}

type MarketRegime = "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "VOLATILE" | "UNKNOWN";

interface MarketData {
  tokens: {
    symbol: string; name: string; price: number;
    priceChange24h: number; priceChange7d: number;
    volume24h: number; marketCap: number; sector: string;
  }[];
  fearGreed: { value: number; classification: string };
  trendingTokens: string[];
  indicators: Record<string, TechnicalIndicators>;  // Technical indicators per token
  defiLlama: DefiLlamaData | null;                   // DeFi intelligence layer
  derivatives: DerivativesData | null;                // Derivatives/funding rate layer
  newsSentiment: NewsSentimentData | null;            // Phase 2: News sentiment layer
  macroData: MacroData | null;                        // Phase 2: Macro economic data layer
  marketRegime: MarketRegime;                         // Overall market regime assessment
}

/**
 * Fetch Base chain DeFi data from DefiLlama (free, no API key needed)
 */
async function fetchDefiLlamaData(): Promise<DefiLlamaData | null> {
  try {
    // Fetch Base chain TVL + historical for 24h change
    const [chainRes, protocolsRes, dexVolumeRes] = await Promise.allSettled([
      axios.get("https://api.llama.fi/v2/historicalChainTvl/Base", { timeout: 10000 }),
      axios.get("https://api.llama.fi/v2/protocols", { timeout: 15000 }),
      axios.get("https://api.llama.fi/overview/dexs/base?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyVolume", { timeout: 10000 }),
    ]);

    let baseTVL = 0;
    let baseTVLChange24h = 0;

    if (chainRes.status === "fulfilled" && chainRes.value.data?.length > 1) {
      const tvlData = chainRes.value.data;
      baseTVL = tvlData[tvlData.length - 1]?.tvl || 0;
      const prevTVL = tvlData[tvlData.length - 2]?.tvl || baseTVL;
      baseTVLChange24h = prevTVL > 0 ? ((baseTVL - prevTVL) / prevTVL) * 100 : 0;
    }

    let baseDEXVolume24h = 0;
    if (dexVolumeRes.status === "fulfilled") {
      baseDEXVolume24h = dexVolumeRes.value.data?.total24h || 0;
    }

    // Map protocol names to our token symbols for matching
    const tokenProtocolMap: Record<string, string[]> = {
      AERO: ["aerodrome"],
      WELL: ["moonwell"],
      SEAM: ["seamless-protocol", "seamless"],
      EXTRA: ["extra-finance"],
      BAL: ["balancer"],
    };

    const topProtocols: { name: string; tvl: number; change24h: number }[] = [];
    const protocolTVLByToken: Record<string, { tvl: number; change24h: number }> = {};

    if (protocolsRes.status === "fulfilled") {
      const baseProtocols = protocolsRes.value.data
        .filter((p: any) => p.chains?.includes("Base") && p.tvl > 0)
        .sort((a: any, b: any) => (b.tvl || 0) - (a.tvl || 0))
        .slice(0, 15);

      for (const protocol of baseProtocols) {
        const tvl = protocol.tvl || 0;
        const change24h = protocol.change_1d || 0;
        topProtocols.push({ name: protocol.name, tvl, change24h });

        // Match to our tokens
        for (const [symbol, slugs] of Object.entries(tokenProtocolMap)) {
          if (slugs.some(slug => protocol.slug?.includes(slug) || protocol.name?.toLowerCase().includes(slug))) {
            protocolTVLByToken[symbol] = { tvl, change24h };
          }
        }
      }
    }

    console.log(`  📊 DefiLlama: Base TVL $${(baseTVL / 1e9).toFixed(2)}B (${baseTVLChange24h >= 0 ? "+" : ""}${baseTVLChange24h.toFixed(1)}%) | DEX Vol $${(baseDEXVolume24h / 1e6).toFixed(0)}M`);
    return { baseTVL, baseTVLChange24h, baseDEXVolume24h, topProtocols, protocolTVLByToken };
  } catch (error: any) {
    console.warn(`  ⚠️ DefiLlama fetch failed: ${error?.message?.substring(0, 100) || error}`);
    return null;
  }
}

/**
 * Fetch BTC/ETH funding rates and open interest from Binance (free, no API key needed)
 */
async function fetchDerivativesData(): Promise<DerivativesData | null> {
  try {
    const [btcFundingRes, ethFundingRes, btcOIRes, ethOIRes] = await Promise.allSettled([
      axios.get("https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=2", { timeout: 8000 }),
      axios.get("https://fapi.binance.com/fapi/v1/fundingRate?symbol=ETHUSDT&limit=2", { timeout: 8000 }),
      axios.get("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT", { timeout: 8000 }),
      axios.get("https://fapi.binance.com/fapi/v1/openInterest?symbol=ETHUSDT", { timeout: 8000 }),
    ]);

    let btcFundingRate = 0;
    let ethFundingRate = 0;
    let btcOpenInterest = 0;
    let ethOpenInterest = 0;

    if (btcFundingRes.status === "fulfilled" && btcFundingRes.value.data?.length > 0) {
      btcFundingRate = parseFloat(btcFundingRes.value.data[btcFundingRes.value.data.length - 1].fundingRate) * 100;
    }
    if (ethFundingRes.status === "fulfilled" && ethFundingRes.value.data?.length > 0) {
      ethFundingRate = parseFloat(ethFundingRes.value.data[ethFundingRes.value.data.length - 1].fundingRate) * 100;
    }
    if (btcOIRes.status === "fulfilled") {
      btcOpenInterest = parseFloat(btcOIRes.value.data?.openInterest || "0");
    }
    if (ethOIRes.status === "fulfilled") {
      ethOpenInterest = parseFloat(ethOIRes.value.data?.openInterest || "0");
    }

    // Interpret funding rates — extreme values indicate crowded positions
    // Typical neutral range: -0.01% to +0.01% (per 8h)
    const interpretFunding = (rate: number): "LONG_CROWDED" | "SHORT_CROWDED" | "NEUTRAL" => {
      if (rate > 0.03) return "LONG_CROWDED";      // Longs paying shorts heavily — potential for long squeeze
      if (rate < -0.03) return "SHORT_CROWDED";     // Shorts paying longs heavily — potential for short squeeze
      return "NEUTRAL";
    };

    const btcFundingSignal = interpretFunding(btcFundingRate);
    const ethFundingSignal = interpretFunding(ethFundingRate);

    // Calculate OI change (we'll store previous values in cache)
    const btcOIChange24h = derivativesCache.btcOI > 0 ? ((btcOpenInterest - derivativesCache.btcOI) / derivativesCache.btcOI) * 100 : 0;
    const ethOIChange24h = derivativesCache.ethOI > 0 ? ((ethOpenInterest - derivativesCache.ethOI) / derivativesCache.ethOI) * 100 : 0;

    // Update cache
    derivativesCache.btcOI = btcOpenInterest;
    derivativesCache.ethOI = ethOpenInterest;

    console.log(`  📈 Derivatives: BTC funding ${btcFundingRate >= 0 ? "+" : ""}${btcFundingRate.toFixed(4)}% (${btcFundingSignal}) | ETH funding ${ethFundingRate >= 0 ? "+" : ""}${ethFundingRate.toFixed(4)}% (${ethFundingSignal})`);
    console.log(`     BTC OI: ${btcOpenInterest.toFixed(0)} BTC | ETH OI: ${ethOpenInterest.toFixed(0)} ETH`);

    return { btcFundingRate, ethFundingRate, btcOpenInterest, ethOpenInterest, btcFundingSignal, ethFundingSignal, btcOIChange24h, ethOIChange24h };
  } catch (error: any) {
    console.warn(`  ⚠️ Derivatives fetch failed: ${error?.message?.substring(0, 100) || error}`);
    return null;
  }
}

// Cache for derivatives OI comparison
const derivativesCache = { btcOI: 0, ethOI: 0 };

// Cache for macro data (only fetch once per hour since most data is daily/monthly)
let macroCache: { data: MacroData | null; lastFetch: number } = { data: null, lastFetch: 0 };
const MACRO_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Cache for news sentiment (fetch every cycle but with fallback)
let newsCache: { data: NewsSentimentData | null; lastFetch: number } = { data: null, lastFetch: 0 };
const NEWS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch crypto news sentiment from CryptoPanic API
 * Requires CRYPTOPANIC_AUTH_TOKEN env var (free signup at cryptopanic.com/developers/api/keys)
 * Falls back to headline keyword analysis if CryptoPanic is unavailable
 */
async function fetchNewsSentiment(): Promise<NewsSentimentData | null> {
  // Return cached data if fresh enough
  if (newsCache.data && Date.now() - newsCache.lastFetch < NEWS_CACHE_TTL) {
    return newsCache.data;
  }

  const authToken = process.env.CRYPTOPANIC_AUTH_TOKEN;
  if (!authToken) {
    console.warn("  \u26a0\ufe0f CRYPTOPANIC_AUTH_TOKEN not set \u2014 news sentiment unavailable. Get a free key at https://cryptopanic.com/developers/api/keys");
    return newsCache.data; // Return stale cache if available
  }

  try {
    // CryptoPanic API v1: auth_token is required as query param (even on free tier)
    const baseUrl = `https://cryptopanic.com/api/v1/posts/?auth_token=${authToken}&public=true&kind=news&regions=en`;

    // Fetch bullish, bearish, and rising news in parallel
    const [bullishRes, bearishRes, risingRes] = await Promise.allSettled([
      axios.get(`${baseUrl}&filter=bullish`, { timeout: 10000 }),
      axios.get(`${baseUrl}&filter=bearish`, { timeout: 10000 }),
      axios.get(`${baseUrl}&filter=rising`, { timeout: 10000 }),
    ]);

    let bullishCount = 0;
    let bearishCount = 0;
    let totalCount = 0;
    const topHeadlines: { title: string; sentiment: string; source: string }[] = [];
    const tokenMentions: Record<string, { bullish: number; bearish: number; neutral: number }> = {};

    // Our token symbols to track
    const trackedSymbols = new Set(Object.keys(TOKEN_REGISTRY));

    // Process bullish news
    if (bullishRes.status === "fulfilled" && bullishRes.value?.data?.results) {
      const results = bullishRes.value.data.results;
      bullishCount = results.length;
      for (const item of results.slice(0, 10)) {
        if (topHeadlines.length < 5) {
          topHeadlines.push({ title: item.title?.substring(0, 120) || "", sentiment: "bullish", source: item.source?.title || "unknown" });
        }
        // Track token mentions
        if (item.currencies) {
          for (const c of item.currencies) {
            const sym = c.code?.toUpperCase();
            if (sym && trackedSymbols.has(sym)) {
              if (!tokenMentions[sym]) tokenMentions[sym] = { bullish: 0, bearish: 0, neutral: 0 };
              tokenMentions[sym].bullish++;
            }
          }
        }
      }
    }

    // Process bearish news
    if (bearishRes.status === "fulfilled" && bearishRes.value?.data?.results) {
      const results = bearishRes.value.data.results;
      bearishCount = results.length;
      for (const item of results.slice(0, 10)) {
        if (topHeadlines.length < 5) {
          topHeadlines.push({ title: item.title?.substring(0, 120) || "", sentiment: "bearish", source: item.source?.title || "unknown" });
        }
        if (item.currencies) {
          for (const c of item.currencies) {
            const sym = c.code?.toUpperCase();
            if (sym && trackedSymbols.has(sym)) {
              if (!tokenMentions[sym]) tokenMentions[sym] = { bullish: 0, bearish: 0, neutral: 0 };
              tokenMentions[sym].bearish++;
            }
          }
        }
      }
    }

    // Process rising/trending news as neutral signal strength indicator
    if (risingRes.status === "fulfilled" && risingRes.value?.data?.results) {
      const results = risingRes.value.data.results;
      totalCount = bullishCount + bearishCount + results.length;
      for (const item of results.slice(0, 10)) {
        if (item.currencies) {
          for (const c of item.currencies) {
            const sym = c.code?.toUpperCase();
            if (sym && trackedSymbols.has(sym)) {
              if (!tokenMentions[sym]) tokenMentions[sym] = { bullish: 0, bearish: 0, neutral: 0 };
              tokenMentions[sym].neutral++;
            }
          }
        }
      }
    } else {
      totalCount = bullishCount + bearishCount;
    }

    // Calculate sentiment score (-100 to +100)
    const sentimentScore = totalCount > 0
      ? Math.round(((bullishCount - bearishCount) / Math.max(totalCount, 1)) * 100)
      : 0;

    // Determine overall sentiment
    let overallSentiment: "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" = "NEUTRAL";
    if (sentimentScore > 30) overallSentiment = "BULLISH";
    else if (sentimentScore < -30) overallSentiment = "BEARISH";
    else if (bullishCount > 3 && bearishCount > 3) overallSentiment = "MIXED";

    const result: NewsSentimentData = {
      overallSentiment,
      bullishCount,
      bearishCount,
      totalCount,
      sentimentScore,
      topHeadlines,
      tokenMentions,
      lastUpdated: new Date().toISOString(),
    };

    console.log(`  📰 News Sentiment: ${overallSentiment} (score: ${sentimentScore >= 0 ? "+" : ""}${sentimentScore}) | ${bullishCount} bullish, ${bearishCount} bearish`);
    newsCache = { data: result, lastFetch: Date.now() };
    return result;
  } catch (error: any) {
    console.warn(`  ⚠️ News sentiment fetch failed: ${error?.message?.substring(0, 100) || error}`);
    return newsCache.data; // Return stale cache if available
  }
}

/**
 * Fetch macro economic data from FRED API (Federal Reserve)
 * Free tier: 120 requests/minute, API key required
 * We fetch daily series each cycle but cache for 1 hour since most data updates daily
 */
async function fetchMacroData(): Promise<MacroData | null> {
  // Return cached data if fresh enough
  if (macroCache.data && Date.now() - macroCache.lastFetch < MACRO_CACHE_TTL) {
    return macroCache.data;
  }

  const FRED_KEY = process.env.FRED_API_KEY;
  if (!FRED_KEY) {
    console.warn("  \u26a0\ufe0f FRED_API_KEY not set \u2014 macro data unavailable. Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html");
    return macroCache.data; // Return stale cache if available
  }

  try {
    // FRED API v2 (Nov 2025): uses Bearer auth header instead of query param
    const fredBase = "https://api.stlouisfed.org/fred/series/observations";
    const fredHeaders = { headers: { Authorization: `Bearer ${FRED_KEY}` }, timeout: 10000 };
    const baseParams = "&file_type=json&sort_order=desc&limit=2";

    // Fetch all series in parallel (6 requests, well within 120/min limit)
    const [dffRes, dgs10Res, t10y2yRes, cpiRes, m2Res, dollarRes] = await Promise.allSettled([
      axios.get(`${fredBase}?series_id=DFF${baseParams}`, fredHeaders),
      axios.get(`${fredBase}?series_id=DGS10${baseParams}`, fredHeaders),
      axios.get(`${fredBase}?series_id=T10Y2Y${baseParams}`, fredHeaders),
      axios.get(`${fredBase}?series_id=CPIAUCSL${baseParams}&limit=13`, fredHeaders),  // 13 months for YoY
      axios.get(`${fredBase}?series_id=M2SL${baseParams}&limit=13`, fredHeaders),      // 13 months for YoY
      axios.get(`${fredBase}?series_id=DTWEXBGS${baseParams}`, fredHeaders),
    ]);

    const parseLatest = (res: PromiseSettledResult<any>): { value: number; date: string } | null => {
      if (res.status !== "fulfilled") return null;
      const obs = res.value?.data?.observations;
      if (!obs || obs.length === 0) return null;
      // Find first valid (non-".") observation
      for (const o of obs) {
        if (o.value && o.value !== ".") {
          return { value: parseFloat(o.value), date: o.date };
        }
      }
      return null;
    };

    const parseYoY = (res: PromiseSettledResult<any>): { value: number; date: string; yoyChange: number | null } | null => {
      if (res.status !== "fulfilled") return null;
      const obs = res.value?.data?.observations?.filter((o: any) => o.value && o.value !== ".");
      if (!obs || obs.length === 0) return null;
      const latest = { value: parseFloat(obs[0].value), date: obs[0].date };
      // Calculate YoY change if we have 12+ months of data
      let yoyChange: number | null = null;
      if (obs.length >= 12) {
        const yearAgo = parseFloat(obs[11].value || obs[obs.length - 1].value);
        if (yearAgo > 0) {
          yoyChange = ((latest.value - yearAgo) / yearAgo) * 100;
        }
      }
      return { ...latest, yoyChange };
    };

    const fedFundsRate = parseLatest(dffRes);
    const treasury10Y = parseLatest(dgs10Res);
    const yieldCurve = parseLatest(t10y2yRes);
    const cpi = parseYoY(cpiRes);
    const m2MoneySupply = parseYoY(m2Res);
    const dollarIndex = parseLatest(dollarRes);

    // Determine rate direction from Fed Funds Rate
    let rateDirection: "HIKING" | "CUTTING" | "PAUSED" = "PAUSED";
    if (dffRes.status === "fulfilled") {
      const obs = dffRes.value?.data?.observations?.filter((o: any) => o.value && o.value !== ".");
      if (obs && obs.length >= 2) {
        const diff = parseFloat(obs[0].value) - parseFloat(obs[1].value);
        if (diff > 0.1) rateDirection = "HIKING";
        else if (diff < -0.1) rateDirection = "CUTTING";
      }
    }

    // Determine composite macro signal
    let macroSignal: "RISK_ON" | "RISK_OFF" | "NEUTRAL" = "NEUTRAL";
    let riskOnPoints = 0;
    let riskOffPoints = 0;

    // Rate cutting = risk on for crypto
    if (rateDirection === "CUTTING") riskOnPoints += 2;
    if (rateDirection === "HIKING") riskOffPoints += 2;

    // Yield curve inversion = recession risk = ultimately risk off
    if (yieldCurve && yieldCurve.value < 0) riskOffPoints += 1;
    if (yieldCurve && yieldCurve.value > 0.5) riskOnPoints += 1;

    // Rising 10Y yields = competition for risk assets = risk off
    if (treasury10Y && treasury10Y.value > 4.5) riskOffPoints += 1;
    if (treasury10Y && treasury10Y.value < 3.5) riskOnPoints += 1;

    // High CPI = Fed may tighten = risk off; falling CPI = room to cut = risk on
    if (cpi?.yoyChange !== null && cpi?.yoyChange !== undefined) {
      if (cpi.yoyChange > 4) riskOffPoints += 1;
      if (cpi.yoyChange < 2.5) riskOnPoints += 1;
    }

    // Growing M2 = more liquidity = risk on
    if (m2MoneySupply?.yoyChange !== null && m2MoneySupply?.yoyChange !== undefined) {
      if (m2MoneySupply.yoyChange > 5) riskOnPoints += 1;
      if (m2MoneySupply.yoyChange < 0) riskOffPoints += 1;
    }

    // Strong dollar = headwind for crypto
    if (dollarIndex && dollarIndex.value > 110) riskOffPoints += 1;
    if (dollarIndex && dollarIndex.value < 100) riskOnPoints += 1;

    if (riskOnPoints >= riskOffPoints + 2) macroSignal = "RISK_ON";
    else if (riskOffPoints >= riskOnPoints + 2) macroSignal = "RISK_OFF";

    const result: MacroData = {
      fedFundsRate,
      treasury10Y,
      yieldCurve,
      cpi,
      m2MoneySupply,
      dollarIndex,
      macroSignal,
      rateDirection,
    };

    console.log(`  🏦 Macro Data: ${macroSignal} | Fed: ${fedFundsRate?.value ?? "N/A"}% (${rateDirection}) | 10Y: ${treasury10Y?.value ?? "N/A"}% | Curve: ${yieldCurve?.value ?? "N/A"}`);
    if (cpi) console.log(`     CPI: ${cpi.value.toFixed(1)} (${cpi.yoyChange !== null ? `${cpi.yoyChange.toFixed(1)}% YoY` : "N/A"}) | M2: ${m2MoneySupply?.yoyChange !== null ? `${m2MoneySupply?.yoyChange?.toFixed(1)}% YoY` : "N/A"} | Dollar: ${dollarIndex?.value?.toFixed(1) ?? "N/A"}`);

    macroCache = { data: result, lastFetch: Date.now() };
    return result;
  } catch (error: any) {
    console.warn(`  ⚠️ Macro data fetch failed: ${error?.message?.substring(0, 100) || error}`);
    return macroCache.data; // Return stale cache if available
  }
}

/**
 * Determine overall market regime from multiple factors
 */
function determineMarketRegime(
  fearGreed: number,
  indicators: Record<string, TechnicalIndicators>,
  derivatives: DerivativesData | null
): MarketRegime {
  // Count directional signals
  let upSignals = 0;
  let downSignals = 0;
  let totalSignals = 0;

  for (const ind of Object.values(indicators)) {
    totalSignals++;
    if (ind.trendDirection === "STRONG_UP" || ind.trendDirection === "UP") upSignals++;
    if (ind.trendDirection === "STRONG_DOWN" || ind.trendDirection === "DOWN") downSignals++;
  }

  const upRatio = totalSignals > 0 ? upSignals / totalSignals : 0;
  const downRatio = totalSignals > 0 ? downSignals / totalSignals : 0;

  // Check for high volatility regime
  const avgBandwidth = Object.values(indicators)
    .filter(i => i.bollingerBands)
    .reduce((sum, i) => sum + (i.bollingerBands?.bandwidth || 0), 0) / Math.max(1, Object.values(indicators).filter(i => i.bollingerBands).length);

  if (avgBandwidth > 15) return "VOLATILE";
  if (upRatio > 0.6 && fearGreed > 40) return "TRENDING_UP";
  if (downRatio > 0.6 && fearGreed < 40) return "TRENDING_DOWN";
  if (upRatio < 0.4 && downRatio < 0.4) return "RANGING";

  return "UNKNOWN";
}

/**
 * Format DefiLlama + Derivatives data for the AI prompt
 */
function formatIntelligenceForPrompt(
  defi: DefiLlamaData | null,
  derivatives: DerivativesData | null,
  regime: MarketRegime,
  news: NewsSentimentData | null,
  macro: MacroData | null,
): string {
  const lines: string[] = [];

  if (defi) {
    lines.push(`═══ DEFI INTELLIGENCE (DefiLlama) ═══`);
    lines.push(`Base Chain TVL: $${(defi.baseTVL / 1e9).toFixed(2)}B (${defi.baseTVLChange24h >= 0 ? "+" : ""}${defi.baseTVLChange24h.toFixed(1)}% 24h)`);
    lines.push(`Base DEX Volume (24h): $${(defi.baseDEXVolume24h / 1e6).toFixed(0)}M`);

    if (defi.topProtocols.length > 0) {
      lines.push(`Top Base Protocols by TVL:`);
      for (const p of defi.topProtocols.slice(0, 8)) {
        lines.push(`  ${p.name}: $${p.tvl > 1e9 ? (p.tvl / 1e9).toFixed(2) + "B" : (p.tvl / 1e6).toFixed(0) + "M"} (${p.change24h >= 0 ? "+" : ""}${p.change24h.toFixed(1)}%)`);
      }
    }

    if (Object.keys(defi.protocolTVLByToken).length > 0) {
      lines.push(`Our DeFi token protocol TVL:`);
      for (const [symbol, data] of Object.entries(defi.protocolTVLByToken)) {
        const tvlStr = data.tvl > 1e9 ? (data.tvl / 1e9).toFixed(2) + "B" : (data.tvl / 1e6).toFixed(0) + "M";
        lines.push(`  ${symbol}: TVL $${tvlStr} (${data.change24h >= 0 ? "+" : ""}${data.change24h.toFixed(1)}% 24h)`);
      }
    }

    // Signal interpretation
    if (defi.baseTVLChange24h > 3) lines.push(`🟢 TVL SIGNAL: Capital flowing INTO Base (+${defi.baseTVLChange24h.toFixed(1)}%) — bullish for Base tokens`);
    else if (defi.baseTVLChange24h < -3) lines.push(`🔴 TVL SIGNAL: Capital flowing OUT of Base (${defi.baseTVLChange24h.toFixed(1)}%) — bearish for Base tokens`);
    lines.push("");
  }

  if (derivatives) {
    lines.push(`═══ DERIVATIVES INTELLIGENCE (Binance) ═══`);
    lines.push(`BTC Funding Rate: ${derivatives.btcFundingRate >= 0 ? "+" : ""}${derivatives.btcFundingRate.toFixed(4)}%/8h → ${derivatives.btcFundingSignal}`);
    lines.push(`ETH Funding Rate: ${derivatives.ethFundingRate >= 0 ? "+" : ""}${derivatives.ethFundingRate.toFixed(4)}%/8h → ${derivatives.ethFundingSignal}`);
    lines.push(`BTC Open Interest: ${derivatives.btcOpenInterest.toFixed(0)} BTC ${derivatives.btcOIChange24h !== 0 ? `(${derivatives.btcOIChange24h >= 0 ? "+" : ""}${derivatives.btcOIChange24h.toFixed(1)}% change)` : ""}`);
    lines.push(`ETH Open Interest: ${derivatives.ethOpenInterest.toFixed(0)} ETH ${derivatives.ethOIChange24h !== 0 ? `(${derivatives.ethOIChange24h >= 0 ? "+" : ""}${derivatives.ethOIChange24h.toFixed(1)}% change)` : ""}`);

    // Funding rate interpretation
    if (derivatives.btcFundingSignal === "LONG_CROWDED") {
      lines.push(`⚠️ FUNDING SIGNAL: BTC longs crowded — risk of long squeeze / correction`);
    } else if (derivatives.btcFundingSignal === "SHORT_CROWDED") {
      lines.push(`🟢 FUNDING SIGNAL: BTC shorts crowded — potential short squeeze / rally`);
    }
    if (derivatives.ethFundingSignal === "LONG_CROWDED") {
      lines.push(`⚠️ FUNDING SIGNAL: ETH longs crowded — risk of long squeeze / correction`);
    } else if (derivatives.ethFundingSignal === "SHORT_CROWDED") {
      lines.push(`🟢 FUNDING SIGNAL: ETH shorts crowded — potential short squeeze / rally`);
    }
    lines.push("");
  }

  if (news) {
    lines.push(`═══ NEWS SENTIMENT (CryptoPanic) ═══`);
    lines.push(`Overall: ${news.overallSentiment} (Score: ${news.sentimentScore >= 0 ? "+" : ""}${news.sentimentScore}/100)`);
    lines.push(`Bullish headlines: ${news.bullishCount} | Bearish headlines: ${news.bearishCount} | Total: ${news.totalCount}`);

    if (news.topHeadlines.length > 0) {
      lines.push(`Key Headlines:`);
      for (const h of news.topHeadlines.slice(0, 4)) {
        lines.push(`  [${h.sentiment.toUpperCase()}] ${h.title} (${h.source})`);
      }
    }

    // Token-specific sentiment
    const tokenSentimentEntries = Object.entries(news.tokenMentions).filter(([_, v]) => v.bullish + v.bearish > 0);
    if (tokenSentimentEntries.length > 0) {
      lines.push(`Token News Sentiment:`);
      for (const [sym, counts] of tokenSentimentEntries) {
        const net = counts.bullish - counts.bearish;
        const signal = net > 0 ? "🟢 BULLISH" : net < 0 ? "🔴 BEARISH" : "⚪ NEUTRAL";
        lines.push(`  ${sym}: ${signal} (${counts.bullish} bullish, ${counts.bearish} bearish mentions)`);
      }
    }

    // Sentiment signal interpretation
    if (news.sentimentScore > 40) lines.push(`🟢 NEWS SIGNAL: Strong bullish sentiment — market optimism, watch for FOMO tops`);
    else if (news.sentimentScore < -40) lines.push(`🔴 NEWS SIGNAL: Strong bearish sentiment — market fear, contrarian buying opportunity?`);
    else if (news.overallSentiment === "MIXED") lines.push(`⚠️ NEWS SIGNAL: Mixed sentiment — conflicting narratives, use other signals for direction`);
    lines.push("");
  }

  if (macro) {
    lines.push(`═══ MACRO INTELLIGENCE (Federal Reserve / FRED) ═══`);
    if (macro.fedFundsRate) lines.push(`Fed Funds Rate: ${macro.fedFundsRate.value.toFixed(2)}% (${macro.rateDirection})`);
    if (macro.treasury10Y) lines.push(`10-Year Treasury Yield: ${macro.treasury10Y.value.toFixed(2)}%`);
    if (macro.yieldCurve) lines.push(`Yield Curve (10Y-2Y): ${macro.yieldCurve.value >= 0 ? "+" : ""}${macro.yieldCurve.value.toFixed(2)}% ${macro.yieldCurve.value < 0 ? "⚠️ INVERTED" : ""}`);
    if (macro.cpi) lines.push(`CPI: ${macro.cpi.value.toFixed(1)} ${macro.cpi.yoyChange !== null ? `(${macro.cpi.yoyChange >= 0 ? "+" : ""}${macro.cpi.yoyChange.toFixed(1)}% YoY)` : ""}`);
    if (macro.m2MoneySupply) lines.push(`M2 Money Supply: ${macro.m2MoneySupply.yoyChange !== null ? `${macro.m2MoneySupply.yoyChange >= 0 ? "+" : ""}${macro.m2MoneySupply.yoyChange.toFixed(1)}% YoY` : "N/A"} ${(macro.m2MoneySupply.yoyChange ?? 0) > 5 ? "🟢 LIQUIDITY EXPANDING" : (macro.m2MoneySupply.yoyChange ?? 0) < 0 ? "🔴 LIQUIDITY CONTRACTING" : ""}`);
    if (macro.dollarIndex) lines.push(`US Dollar Index: ${macro.dollarIndex.value.toFixed(1)} ${macro.dollarIndex.value > 110 ? "🔴 STRONG (headwind)" : macro.dollarIndex.value < 100 ? "🟢 WEAK (tailwind)" : ""}`);
    lines.push(`Macro Signal: ${macro.macroSignal}`);

    // Macro signal interpretation
    if (macro.macroSignal === "RISK_ON") lines.push(`🟢 MACRO SIGNAL: Conditions favor risk assets — looser policy, expanding liquidity, or weakening dollar`);
    else if (macro.macroSignal === "RISK_OFF") lines.push(`🔴 MACRO SIGNAL: Conditions headwind for crypto — tightening policy, high yields, or strong dollar`);
    else lines.push(`→ Macro environment neutral — no strong directional bias from macro factors`);
    lines.push("");
  }

  lines.push(`═══ MARKET REGIME ═══`);
  lines.push(`Current Regime: ${regime}`);
  switch (regime) {
    case "TRENDING_UP": lines.push(`→ Favor buying dips, ride momentum, widen stops`); break;
    case "TRENDING_DOWN": lines.push(`→ Favor selling rallies, tighten stops, preserve capital`); break;
    case "RANGING": lines.push(`→ Mean-revert: buy oversold, sell overbought, smaller positions`); break;
    case "VOLATILE": lines.push(`→ Reduce position sizes, widen stops, wait for clarity`); break;
    default: lines.push(`→ Mixed signals — use standard rules, stay disciplined`); break;
  }

  return lines.join("\n");
}

async function getMarketData(): Promise<MarketData> {
  try {
    // Build CoinGecko URL before parallel call
    const coingeckoIds = [...new Set(
      Object.values(TOKEN_REGISTRY).map(t => t.coingeckoId).filter(Boolean)
    )].join(",");
    const coingeckoUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coingeckoIds}&order=market_cap_desc&sparkline=false&price_change_percentage=24h,7d`;

    // Fetch Fear & Greed first (lightweight)
    const fngResult = await Promise.allSettled([
      axios.get("https://api.alternative.me/fng/", { timeout: 10000 }),
    ]).then(r => r[0]);

    // CoinGecko with retry — this is the most critical data source for portfolio pricing
    let marketResult: PromiseSettledResult<any> = { status: "rejected", reason: new Error("No attempt") } as PromiseRejectedResult;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await axios.get(coingeckoUrl, { timeout: 15000 });
        if (res.data && Array.isArray(res.data) && res.data.length > 0) {
          marketResult = { status: "fulfilled", value: res };
          break;
        } else {
          console.warn(`  \u26a0\ufe0f CoinGecko attempt ${attempt}: empty response (${res.data?.length || 0} tokens), retrying in ${attempt * 3}s...`);
          if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 3000));
        }
      } catch (err: any) {
        const status = err?.response?.status;
        console.warn(`  \u26a0\ufe0f CoinGecko attempt ${attempt}: ${status === 429 ? "rate limited (429)" : err?.message?.substring(0, 80) || err}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 4000)); // longer wait on error
        if (attempt === 3) marketResult = { status: "rejected", reason: err } as PromiseRejectedResult;
      }
    }

    // Then fetch intelligence layers (don't compete with price data for connections)
    const [defiResult, derivResult] = await Promise.allSettled([
      fetchDefiLlamaData(),
      fetchDerivativesData(),
    ]);

    // Phase 2: Fetch news sentiment + macro data (staggered after core intelligence)
    const [newsResult, macroResult] = await Promise.allSettled([
      fetchNewsSentiment(),
      fetchMacroData(),
    ]);

    const fearGreed = fngResult.status === "fulfilled"
      ? { value: parseInt(fngResult.value.data.data[0].value), classification: fngResult.value.data.data[0].value_classification }
      : { value: 50, classification: "Neutral" };

    let tokens: MarketData["tokens"] = [];
    if (marketResult.status === "fulfilled") {
      tokens = marketResult.value.data.map((coin: any) => {
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
      console.log(`  ✅ CoinGecko: ${tokens.length} tokens priced`);
    } else {
      const reason = (marketResult as PromiseRejectedResult).reason;
      console.error(`  ❌ CoinGecko FAILED: ${reason?.response?.status || ""} ${reason?.message || reason}`);
    }

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

    // Extract new data layers
    const defiLlama = defiResult.status === "fulfilled" ? defiResult.value : null;
    const derivatives = derivResult.status === "fulfilled" ? derivResult.value : null;
    const newsSentiment = newsResult.status === "fulfilled" ? newsResult.value : null;
    const macroData = macroResult.status === "fulfilled" ? macroResult.value : null;

    // Determine market regime
    const marketRegime = determineMarketRegime(fearGreed.value, indicators, derivatives);
    console.log(`  🌐 Market Regime: ${marketRegime}`);

    return { tokens, fearGreed, trendingTokens, indicators, defiLlama, derivatives, newsSentiment, macroData, marketRegime };
  } catch (error: any) {
    const msg = error?.response?.status
      ? `HTTP ${error.response.status}: ${error.message}`
      : error?.message || String(error);
    console.error("Failed to fetch market data:", msg);
    return { tokens: [], fearGreed: { value: 50, classification: "Neutral" }, trendingTokens: [], indicators: {}, defiLlama: null, derivatives: null, newsSentiment: null, macroData: null, marketRegime: "UNKNOWN" };
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

  const tokenEntries = Object.entries(TOKEN_REGISTRY);
  const results: { symbol: string; balance: number }[] = [];
  const failedTokens: string[] = [];

  // Read balances one at a time with delay — public RPC rate-limits batch calls
  for (let i = 0; i < tokenEntries.length; i++) {
    const [symbol, token] = tokenEntries[i];
    let balance = 0;
    let success = false;

    // Try up to 3 times per token
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        balance = token.address === "native"
          ? await getETHBalance(walletAddress)
          : await getERC20Balance(token.address, walletAddress, token.decimals);
        success = true;
        break;
      } catch (err: any) {
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        } else {
          console.warn(`  ⚠️ Failed to read ${symbol} after 3 attempts: ${err?.message || err}`);
          failedTokens.push(symbol);
        }
      }
    }

    if (success) {
      results.push({ symbol, balance });
    }

    // Delay between each token read to avoid RPC rate limits
    if (i < tokenEntries.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  // If any tokens failed, retry them after a longer pause
  if (failedTokens.length > 0) {
    console.log(`  🔄 Retrying ${failedTokens.length} failed tokens after cooldown...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    for (const symbol of failedTokens) {
      const token = TOKEN_REGISTRY[symbol];
      try {
        const balance = token.address === "native"
          ? await getETHBalance(walletAddress)
          : await getERC20Balance(token.address, walletAddress, token.decimals);
        results.push({ symbol, balance });
        console.log(`  ✅ Retry succeeded for ${symbol}: ${balance}`);
      } catch (err: any) {
        console.warn(`  ❌ Final retry failed for ${symbol}: ${err?.message || err}`);
        // Use last known balance from state if available
        const lastKnown = state.trading.balances?.find(b => b.symbol === symbol);
        if (lastKnown && lastKnown.balance > 0) {
          results.push({ symbol, balance: lastKnown.balance });
          console.log(`  📎 Using last known balance for ${symbol}: ${lastKnown.balance}`);
        }
      }
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
        `  ${t.timestamp.slice(5, 16)} ${t.action} ${t.fromToken}→${t.toToken} $${t.amountUSD.toFixed(2)} ${t.success ? "✅" : "❌"} regime=${t.signalContext?.marketRegime || "?"} ${t.reasoning?.substring(0, 60) || ""}`
      ).join("\n")
    : "  No trades yet";

  // V4.0: Build intelligence layers
  const intelligenceSummary = formatIntelligenceForPrompt(marketData.defiLlama, marketData.derivatives, marketData.marketRegime, marketData.newsSentiment, marketData.macroData);

  // V4.0: Performance stats for self-awareness
  const perfStats = calculateTradePerformance();
  const perfSummary = perfStats.totalTrades > 0
    ? `Win Rate: ${perfStats.winRate.toFixed(0)}% | Avg Return: ${perfStats.avgReturnPercent >= 0 ? "+" : ""}${perfStats.avgReturnPercent.toFixed(1)}% | Profit Factor: ${perfStats.profitFactor === Infinity ? "∞" : perfStats.profitFactor.toFixed(2)}${perfStats.bestTrade ? ` | Best: ${perfStats.bestTrade.symbol} +${perfStats.bestTrade.returnPercent.toFixed(1)}%` : ""}${perfStats.worstTrade ? ` | Worst: ${perfStats.worstTrade.symbol} ${perfStats.worstTrade.returnPercent.toFixed(1)}%` : ""}`
    : "No completed sell trades yet — performance tracking will begin after first sell";

  const systemPrompt = `You are Henry's autonomous crypto trading agent v4.5.1 on Base network.
You are a MULTI-DIMENSIONAL TRADER with real-time access to: technical indicators, DeFi protocol intelligence, derivatives data (funding rates + open interest), news sentiment analysis, Federal Reserve macro data (rates, yield curve, CPI, M2, dollar), and market regime analysis. Your decisions execute LIVE swaps. You think like a macro-aware hedge fund — reading both the market microstructure AND the global economic environment.

═══ PORTFOLIO ═══
- USDC Available: $${availableUSDC.toFixed(2)}
- Token Holdings: $${totalTokenValue.toFixed(2)}
- Total: $${totalPortfolioValue.toFixed(2)}
- P&L: ${((totalPortfolioValue - state.trading.initialValue) / state.trading.initialValue * 100).toFixed(1)}% from $${state.trading.initialValue}
- Peak: $${state.trading.peakValue.toFixed(2)} | Drawdown: ${state.trading.peakValue > 0 ? ((state.trading.peakValue - totalPortfolioValue) / state.trading.peakValue * 100).toFixed(1) : "0.0"}%

═══ YOUR TRADE PERFORMANCE ═══
${perfSummary}

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

${intelligenceSummary}

═══ TOKEN PRICES ═══
${Object.entries(marketBySector).map(([sector, tokens]) =>
  `${sector}: ${tokens.slice(0, 5).join(" | ")}`
).join("\n")}

═══ RECENT TRADE HISTORY ═══
${tradeHistorySummary}

═══ TRADING LIMITS ═══
- Max BUY: $${maxBuyAmount.toFixed(2)} | Max SELL: ${CONFIG.trading.maxSellPercent}% of position
- Available tokens: ${tradeableTokens}

═══ STRATEGY FRAMEWORK v4.5.1 ═══

ENTRY RULES (when to BUY):
1. CONFLUENCE: Only buy when 2+ indicators agree (RSI oversold + MACD bullish, or BB oversold + uptrend)
2. FEAR AMPLIFIER: During extreme fear (<25), lower the bar — buy on 1 indicator signal
3. SECTOR PRIORITY: Buy into the most underweight sector first
4. VOLUME CONFIRMATION: Prefer tokens where volume is above 7-day average (strength behind the move)
5. TREND ALIGNMENT: Prefer buying tokens in UP or STRONG_UP trends
6. DEFI FLOW: If Base TVL is rising (>+2% 24h), favor buying DeFi tokens. If falling, avoid new DeFi positions
7. FUNDING RATE: If BTC/ETH shorts are CROWDED (negative funding), this is contrarian bullish — favor buying
8. TVL MOMENTUM: If a specific protocol's TVL is rising while price hasn't followed, it's undervalued — buy opportunity
9. NEWS CATALYST: If news sentiment is BULLISH (score >+30) and a token has bullish mentions, it's a buy signal amplifier
10. MACRO TAILWIND: If macro signal is RISK_ON (rate cuts, expanding liquidity, weak dollar), be more aggressive on buys. Increase conviction on dip buys
11. CONTRARIAN NEWS: If news sentiment is extremely BEARISH (score <-50) but technical indicators show oversold, this is a high-conviction contrarian buy — fear is priced in

EXIT RULES (when to SELL):
1. TAKE PROFIT: Sell 25-50% of a position if token is up >15% in 24h AND RSI > 65
2. OVERBOUGHT EXIT: Sell if RSI > 75 AND Bollinger %B > 0.95 AND MACD turning bearish
3. STOP LOSS: Sell if token is down >20% in 7d and trend is STRONG_DOWN
4. SECTOR TRIM: Sell from overweight sectors (>10% drift) to rebalance
5. FUNDING WARNING: If BTC/ETH longs are CROWDED (high positive funding), prepare to take profits — correction risk
6. TVL OUTFLOW: If a DeFi protocol's TVL is dropping >5% while you hold its token, consider trimming
7. MACRO HEADWIND: If macro signal is RISK_OFF (rate hikes, yield curve inverting, strong dollar), tighten profit-taking. Sell into strength rather than holding
8. NEWS RISK: If a token has strong bearish news mentions AND technical indicators confirm (RSI dropping, MACD bearish), trim position proactively

REGIME-ADAPTED STRATEGY:
- TRENDING_UP: Be aggressive on dips. Favor momentum entries. Let winners run longer
- TRENDING_DOWN: Be defensive. Tighter stops. Favor HOLD or sell rallies. Preserve capital
- RANGING: Mean-revert. Buy oversold tokens, sell overbought. Keep positions smaller
- VOLATILE: Reduce position sizes by 50%. Wait for clearer signals. Only trade strong confluence

MACRO-AWARE ADJUSTMENTS:
- RISK_ON macro + TRENDING_UP regime = Maximum aggression. Deploy capital on dips. This is the best environment for crypto
- RISK_OFF macro + TRENDING_DOWN regime = Maximum defense. Preserve capital. Hold USDC. Only buy extreme oversold
- RISK_ON macro + RANGING regime = Lean bullish. Buy oversold more aggressively, hold longer before selling
- RISK_OFF macro + VOLATILE regime = Stay defensive. Smaller positions. Wait for clarity

RISK RULES:
1. No single token > 25% of portfolio
2. HOLD if confluence score is between -15 and +15 (no clear signal)
3. Never chase pumps — if token up >20% in 24h with RSI >75, wait for pullback
4. In extreme greed (>75), tighten sell rules — take profits more aggressively
5. Minimum trade $1.00
6. LEARN FROM HISTORY: Review your past trades above. Avoid repeating strategies that lost money. Double down on patterns that worked
7. NEWS NOISE FILTER: Ignore news sentiment if it contradicts strong technical + DeFi signals. Headlines lag price action

DECISION PRIORITY: Market Regime > Macro Environment > Technical signals + DeFi flows > Derivatives signals > News sentiment > Sector rebalancing

For SELLING: fromToken = token symbol, toToken = USDC
For BUYING: fromToken = USDC, toToken = token symbol

DIVERSIFICATION RULE: NEVER buy the same token more than 2 cycles in a row. Rotate across sectors and tokens.
If a token already holds >20% of portfolio, do NOT buy more — pick a different underweight token or HOLD.

CRITICAL: Respond with ONLY a raw JSON object. NO prose, NO explanation outside JSON, NO markdown.
Your ENTIRE response must be exactly one JSON object:
{"action":"BUY","fromToken":"USDC","toToken":"WELL","amountUSD":10,"reasoning":"RSI oversold at 28, MACD bullish crossover, Base TVL +3.2%, WELL protocol TVL rising, BTC shorts crowded, macro RISK_ON, news bullish +45","sector":"DEFI"}`;

  // Retry up to 3 times with exponential backoff for rate limits
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 700,
        messages: [{ role: "user", content: systemPrompt }],
      });

      const content = response.content[0];
      if (content.type === "text") {
        let text = content.text.trim();
        // Strip markdown code fences
        if (text.startsWith("```")) {
          text = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
        }
        // If AI wrapped JSON in prose, extract the JSON object
        if (!text.startsWith("{")) {
          const jsonMatch = text.match(/\{[\s\S]*"action"[\s\S]*\}/);
          if (jsonMatch) {
            console.log(`   ⚠️ AI returned prose wrapper — extracted JSON from response`);
            text = jsonMatch[0];
          } else {
            console.log(`   ⚠️ AI returned non-JSON response: "${text.substring(0, 80)}..."`);
            return { action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: "AI returned prose instead of JSON — HOLD" };
          }
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

    // Update cost basis
    if (decision.action === "BUY" && decision.toToken !== "USDC") {
      // Estimate tokens received: amountUSD / current price
      const tokenPrice = marketData.tokens.find(t => t.symbol === decision.toToken)?.price || 1;
      const estimatedTokens = decision.amountUSD / tokenPrice;
      updateCostBasisAfterBuy(decision.toToken, decision.amountUSD, estimatedTokens);
    } else if (decision.action === "SELL" && decision.fromToken !== "USDC") {
      const tokenPrice = marketData.tokens.find(t => t.symbol === decision.fromToken)?.price || 1;
      const estimatedTokensSold = decision.tokenAmount || (decision.amountUSD / tokenPrice);
      updateCostBasisAfterSell(decision.fromToken, decision.amountUSD, estimatedTokensSold);
    }

    // Record trade with full signal context (V4.0)
    const tradedToken = decision.action === "BUY" ? decision.toToken : decision.fromToken;
    const tradedIndicators = marketData.indicators[tradedToken];
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
      signalContext: {
        marketRegime: marketData.marketRegime,
        confluenceScore: tradedIndicators?.confluenceScore || 0,
        rsi: tradedIndicators?.rsi14 || null,
        macdSignal: tradedIndicators?.macd?.signal || null,
        btcFundingRate: marketData.derivatives?.btcFundingRate || null,
        ethFundingRate: marketData.derivatives?.ethFundingRate || null,
        baseTVLChange24h: marketData.defiLlama?.baseTVLChange24h || null,
        baseDEXVolume24h: marketData.defiLlama?.baseDEXVolume24h || null,
        triggeredBy: "AI",
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

    // Record failed trade with signal context (V4.0)
    const failedToken = decision.action === "BUY" ? decision.toToken : decision.fromToken;
    const failedIndicators = marketData.indicators[failedToken];
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
      signalContext: {
        marketRegime: marketData.marketRegime,
        confluenceScore: failedIndicators?.confluenceScore || 0,
        rsi: failedIndicators?.rsi14 || null,
        macdSignal: failedIndicators?.macd?.signal || null,
        btcFundingRate: marketData.derivatives?.btcFundingRate || null,
        ethFundingRate: marketData.derivatives?.ethFundingRate || null,
        baseTVLChange24h: marketData.defiLlama?.baseTVLChange24h || null,
        baseDEXVolume24h: marketData.defiLlama?.baseDEXVolume24h || null,
        triggeredBy: "AI",
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

    // V4.5: Store intelligence data for API endpoint (now includes news + macro)
    lastIntelligenceData = {
      defi: marketData.defiLlama,
      derivatives: marketData.derivatives,
      news: marketData.newsSentiment,
      macro: marketData.macroData,
      regime: marketData.marketRegime,
      performance: calculateTradePerformance(),
    };

    // Update USD values
    for (const balance of balances) {
      if (balance.symbol !== "USDC") {
        let tokenData = marketData.tokens.find(t => t.symbol === balance.symbol);
        // WETH uses same price as ETH (1 WETH = 1 ETH)
        if (!tokenData && balance.symbol === "WETH") {
          tokenData = marketData.tokens.find(t => t.symbol === "ETH");
        }
        // Fallback: try matching by coingeckoId if symbol match fails
        if (!tokenData) {
          const registryToken = TOKEN_REGISTRY[balance.symbol];
          if (registryToken?.coingeckoId) {
            const cgMatch = marketData.tokens.find(t => {
              const regEntry = Object.entries(TOKEN_REGISTRY).find(([s]) => s === t.symbol);
              return regEntry && regEntry[1].coingeckoId === registryToken.coingeckoId;
            });
            if (cgMatch) {
              tokenData = cgMatch;
              console.log(`   📎 Pricing ${balance.symbol} via shared coingeckoId (${registryToken.coingeckoId}) at $${cgMatch.price}`);
            }
          }
        }
        if (tokenData) {
          balance.usdValue = balance.balance * tokenData.price;
          balance.price = tokenData.price;
        } else if (balance.balance > 0) {
          console.warn(`   ⚠️ No price data for ${balance.symbol} — showing $0`);
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

    // Update unrealized P&L and peak prices for all holdings
    updateUnrealizedPnL(balances);

    // Display cost basis summary
    const activeCB = Object.values(state.costBasis).filter(cb => cb.currentHolding > 0 && cb.averageCostBasis > 0);
    if (activeCB.length > 0) {
      const totalRealized = Object.values(state.costBasis).reduce((s, cb) => s + cb.realizedPnL, 0);
      const totalUnrealized = activeCB.reduce((s, cb) => s + cb.unrealizedPnL, 0);
      console.log(`\n💹 Cost Basis P&L: Realized ${totalRealized >= 0 ? "+" : ""}$${totalRealized.toFixed(2)} | Unrealized ${totalUnrealized >= 0 ? "+" : ""}$${totalUnrealized.toFixed(2)}`);
      for (const cb of activeCB) {
        const pct = cb.averageCostBasis > 0 ? ((cb.unrealizedPnL / (cb.averageCostBasis * cb.currentHolding)) * 100) : 0;
        console.log(`   ${cb.unrealizedPnL >= 0 ? "🟢" : "🔴"} ${cb.symbol}: avg $${cb.averageCostBasis.toFixed(4)} | P&L ${cb.unrealizedPnL >= 0 ? "+" : ""}$${cb.unrealizedPnL.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`);
      }
    }

    // === STOP-LOSS CHECK (highest priority) ===
    const stopLossDecision = checkStopLoss(balances);
    if (stopLossDecision) {
      console.log(`\n  🛑 STOP-LOSS GUARD executing sell...`);
      await executeTrade(stopLossDecision, marketData);
      state.trading.lastCheck = new Date();
      return; // Skip AI decision this cycle
    }

    // === PROFIT-TAKING CHECK ===
    const profitTakeDecision = checkProfitTaking(balances);
    if (profitTakeDecision) {
      console.log(`\n  🎯 PROFIT-TAKE GUARD executing sell...`);
      await executeTrade(profitTakeDecision, marketData);
      state.trading.lastCheck = new Date();
      return; // Skip AI decision this cycle
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

    // === POSITION SIZE GUARD ===
    // Hard enforcement: block BUY if target token already exceeds maxPositionPercent
    if (decision.action === "BUY" && decision.toToken !== "USDC" && state.trading.totalPortfolioValue > 0) {
      const targetHolding = balances.find(b => b.symbol === decision.toToken);
      const currentValue = targetHolding?.usdValue || 0;
      const afterBuyValue = currentValue + decision.amountUSD;
      const afterBuyPercent = (afterBuyValue / state.trading.totalPortfolioValue) * 100;

      if (afterBuyPercent > CONFIG.trading.maxPositionPercent) {
        console.log(`   🚫 POSITION GUARD: ${decision.toToken} would be ${afterBuyPercent.toFixed(1)}% of portfolio (max ${CONFIG.trading.maxPositionPercent}%). Current: $${currentValue.toFixed(2)}. Blocked.`);
        decision.action = "HOLD";
        decision.reasoning = `Position guard: ${decision.toToken} at ${(currentValue / state.trading.totalPortfolioValue * 100).toFixed(1)}% — too concentrated. Holding.`;
      }
    }

    // === DIVERSIFICATION GUARD ===
    // If we've bought the same token in the last 3 consecutive trades, force diversification
    const last3Trades = state.tradeHistory.slice(-3);
    if (decision.action === "BUY" && last3Trades.length >= 3) {
      const allSameToken = last3Trades.every(t => t.action === "BUY" && t.toToken === decision.toToken);
      if (allSameToken) {
        console.log(`   🔄 DIVERSITY GUARD: Bought ${decision.toToken} 3x in a row. Forcing HOLD to avoid concentration.`);
        decision.action = "HOLD";
        decision.reasoning = `Diversity guard: ${decision.toToken} bought 3 consecutive times. Cooling off.`;
      }
    }

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
║   🤖 HENRY'S AUTONOMOUS TRADING AGENT v4.5.1                            ║
║   ════════════════════════════════════════                              ║
║                                                                        ║
║   PHASE 2 BRAIN UPGRADE — News Sentiment + Macro Intelligence          ║
║   LIVE TRADING | Base Network | 8 Data Sources Active                  ║
║                                                                        ║
║   Data Sources:                                                        ║
║   • Technical: RSI, MACD, Bollinger Bands, SMA, Volume                ║
║   • DeFi Intel: Base TVL, DEX Volume, Protocol TVL (DefiLlama)        ║
║   • Derivatives: BTC/ETH Funding Rates + Open Interest (Binance)      ║
║   • News: Crypto news sentiment — bullish/bearish (CryptoPanic)       ║
║   • Macro: Fed Rate, 10Y Yield, CPI, M2, Dollar Index (FRED)         ║
║   • Sentiment: Fear & Greed Index + Market Regime Detection           ║
║   • Self-Learning: Trade performance scoring + signal attribution     ║
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
  console.log(`   Brain: v4.5.1 — Technicals + DeFi + Derivatives + News + Macro + Regime + Self-Learning`);
  console.log(`   AI Strategy: Macro-aware regime-adapted (regime > macro > technicals + DeFi > derivatives > news > sectors)`);
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

  console.log("\n🚀 Agent v4.5.1 running! Phase 2 active: DefiLlama + Binance derivatives + CryptoPanic news + FRED macro + regime detection + self-learning.\n");
}

main().catch((err) => {
  console.error("Fatal error:", err?.message || String(err));
  if (err?.stack) console.error(err.stack.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
});

// ============================================================================
// HTTP SERVER — Dashboard + API Endpoints
// ============================================================================
import http from 'http';

function sendJSON(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function apiPortfolio() {
  const uptime = Math.floor((Date.now() - state.startTime.getTime()) / 1000);
  const totalRealized = Object.values(state.costBasis).reduce((s, cb) => s + cb.realizedPnL, 0);
  const totalUnrealized = Object.values(state.costBasis).reduce((s, cb) => s + cb.unrealizedPnL, 0);
  return {
    totalValue: state.trading.totalPortfolioValue,
    initialValue: state.trading.initialValue,
    peakValue: state.trading.peakValue,
    pnl: state.trading.totalPortfolioValue - state.trading.initialValue,
    pnlPercent: state.trading.initialValue > 0 ? ((state.trading.totalPortfolioValue - state.trading.initialValue) / state.trading.initialValue) * 100 : 0,
    drawdown: state.trading.peakValue > 0 ? ((state.trading.peakValue - state.trading.totalPortfolioValue) / state.trading.peakValue) * 100 : 0,
    realizedPnL: totalRealized,
    unrealizedPnL: totalUnrealized,
    totalTrades: state.trading.totalTrades,
    successfulTrades: state.trading.successfulTrades,
    totalCycles: state.totalCycles,
    uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
    lastCycle: state.trading.lastCheck.toISOString(),
    tradingEnabled: CONFIG.trading.enabled,
    version: "4.5.1",
  };
}

function apiBalances() {
  return {
    balances: state.trading.balances.map(b => ({
      symbol: b.symbol,
      balance: b.balance,
      usdValue: b.usdValue,
      price: b.price,
      sector: b.sector,
      costBasis: state.costBasis[b.symbol]?.averageCostBasis || null,
      unrealizedPnL: state.costBasis[b.symbol]?.unrealizedPnL || 0,
      totalInvested: state.costBasis[b.symbol]?.totalInvestedUSD || 0,
      realizedPnL: state.costBasis[b.symbol]?.realizedPnL || 0,
    })),
    totalValue: state.trading.totalPortfolioValue,
    lastUpdate: state.trading.lastCheck.toISOString(),
  };
}

function apiSectors() {
  return {
    allocations: state.trading.sectorAllocations,
    totalValue: state.trading.totalPortfolioValue,
  };
}

function apiTrades(limit: number) {
  return {
    trades: state.tradeHistory.slice(-limit).reverse(),
    totalTrades: state.trading.totalTrades,
    successfulTrades: state.trading.successfulTrades,
  };
}

function apiIndicators() {
  // Return last known indicator data from state if we store it
  return {
    message: "Indicators computed each cycle — see /api/portfolio for latest summary",
    costBasis: Object.values(state.costBasis).filter(cb => cb.currentHolding > 0),
  };
}

// V4.5: Intelligence API endpoint (Phase 2 — includes news + macro)
let lastIntelligenceData: {
  defi: DefiLlamaData | null;
  derivatives: DerivativesData | null;
  news: NewsSentimentData | null;
  macro: MacroData | null;
  regime: MarketRegime;
  performance: TradePerformanceStats;
} | null = null;

function apiIntelligence() {
  const perf = calculateTradePerformance();
  return {
    version: "4.5.1",
    defiLlama: lastIntelligenceData?.defi || null,
    derivatives: lastIntelligenceData?.derivatives || null,
    newsSentiment: lastIntelligenceData?.news || null,
    macroData: lastIntelligenceData?.macro || null,
    marketRegime: lastIntelligenceData?.regime || "UNKNOWN",
    tradePerformance: perf,
    dataSources: [
      "CoinGecko", "Fear & Greed Index",
      "DefiLlama (TVL/DEX/Protocols)", "Binance (Funding Rates/OI)",
      "CryptoPanic (News Sentiment)", "FRED (Fed Rates/Yield Curve/CPI/M2/Dollar)",
      "Technical Indicators (RSI/MACD/BB/SMA)",
    ],
  };
}

function getDashboardHTML(): string {
  // Always use embedded dashboard (connected to bot API)
  // Old dashboard/index.html reads from blockchain directly — not useful
  return EMBEDDED_DASHBOARD;
}

const healthServer = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    switch (url.pathname) {
      case '/':
      case '/dashboard':
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getDashboardHTML());
        break;
      case '/health':
        sendJSON(res, 200, { status: "ok", ...apiPortfolio() });
        break;
      case '/api/portfolio':
        sendJSON(res, 200, apiPortfolio());
        break;
      case '/api/balances':
        sendJSON(res, 200, apiBalances());
        break;
      case '/api/sectors':
        sendJSON(res, 200, apiSectors());
        break;
      case '/api/trades':
        sendJSON(res, 200, apiTrades(parseInt(url.searchParams.get('limit') || '50')));
        break;
      case '/api/indicators':
        sendJSON(res, 200, apiIndicators());
        break;
      case '/api/intelligence':
        sendJSON(res, 200, apiIntelligence());
        break;
      default:
        sendJSON(res, 404, { error: 'Not found' });
    }
  } catch (err: any) {
    console.error('HTTP error:', err.message);
    sendJSON(res, 500, { error: 'Internal server error' });
  }
});
healthServer.listen(process.env.PORT || 3000, () => {
  console.log('Dashboard + API server running on port', process.env.PORT || 3000);
});

// ============================================================================
// EMBEDDED DASHBOARD (fallback if dashboard/index.html not found)
// ============================================================================
const EMBEDDED_DASHBOARD = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Schertzinger Trading Command</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<script>
tailwind.config = { theme: { extend: {
  fontFamily: { sans: ['Inter', 'system-ui'], mono: ['JetBrains Mono', 'monospace'] },
  colors: {
    surface: { 900: '#0a0e1a', 800: '#0f1629', 700: '#151d35', 600: '#1c2541' },
    accent: { gold: '#f0b429', emerald: '#10b981', crimson: '#ef4444', sky: '#38bdf8' }
  }
}}}
</script>
<style>
body { font-family: 'Inter', system-ui; background: #060a14; color: #e2e8f0; }
.mono { font-family: 'JetBrains Mono', monospace; }
.glass { background: rgba(15,22,41,0.6); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.06); }
.glow-green { box-shadow: 0 0 20px rgba(16,185,129,0.15); }
.glow-red { box-shadow: 0 0 20px rgba(239,68,68,0.15); }
.mesh-bg {
  background:
    radial-gradient(ellipse 80% 50% at 20% 40%, rgba(76,110,245,0.08) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 20%, rgba(16,185,129,0.06) 0%, transparent 50%),
    linear-gradient(180deg, #060a14 0%, #0a0e1a 100%);
}
@keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.pulse-dot { animation: pulse-dot 2s ease-in-out infinite; }
</style>
</head>
<body class="mesh-bg min-h-screen">

<!-- Header -->
<div class="border-b border-white/5 px-4 sm:px-6 py-4">
  <div class="max-w-7xl mx-auto flex items-center justify-between">
    <div>
      <h1 class="text-lg font-bold text-white">Schertzinger Trading Command</h1>
      <p class="text-xs text-slate-500 mt-0.5">Autonomous Trading Agent v4.5.1</p>
    </div>
    <div class="flex items-center gap-3">
      <span class="pulse-dot inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
      <span class="text-xs text-emerald-400 font-medium" id="bot-status">Online</span>
      <span class="text-xs text-slate-600 mono" id="last-update"></span>
    </div>
  </div>
</div>

<!-- Hero Metrics -->
<div class="max-w-7xl mx-auto px-4 sm:px-6 py-6">
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
    <div class="glass rounded-xl p-4">
      <p class="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Portfolio</p>
      <p class="text-xl sm:text-2xl font-bold text-white mono" id="portfolio-value">--</p>
    </div>
    <div class="glass rounded-xl p-4">
      <p class="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Total P&L</p>
      <p class="text-xl sm:text-2xl font-bold mono" id="total-pnl">--</p>
    </div>
    <div class="glass rounded-xl p-4">
      <p class="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Realized</p>
      <p class="text-lg font-semibold mono" id="realized-pnl">--</p>
    </div>
    <div class="glass rounded-xl p-4">
      <p class="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Unrealized</p>
      <p class="text-lg font-semibold mono" id="unrealized-pnl">--</p>
    </div>
  </div>

  <!-- Sub metrics -->
  <div class="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3">
    <div class="glass rounded-lg p-3 text-center">
      <p class="text-[9px] uppercase tracking-wider text-slate-500">Trades</p>
      <p class="text-sm font-semibold text-white mono" id="trade-count">--</p>
    </div>
    <div class="glass rounded-lg p-3 text-center">
      <p class="text-[9px] uppercase tracking-wider text-slate-500">Success</p>
      <p class="text-sm font-semibold text-emerald-400 mono" id="success-rate">--</p>
    </div>
    <div class="glass rounded-lg p-3 text-center">
      <p class="text-[9px] uppercase tracking-wider text-slate-500">Cycles</p>
      <p class="text-sm font-semibold text-white mono" id="cycle-count">--</p>
    </div>
    <div class="glass rounded-lg p-3 text-center">
      <p class="text-[9px] uppercase tracking-wider text-slate-500">Uptime</p>
      <p class="text-sm font-semibold text-white mono" id="uptime">--</p>
    </div>
    <div class="glass rounded-lg p-3 text-center">
      <p class="text-[9px] uppercase tracking-wider text-slate-500">Peak</p>
      <p class="text-sm font-semibold text-accent-gold mono" id="peak-value">--</p>
    </div>
    <div class="glass rounded-lg p-3 text-center">
      <p class="text-[9px] uppercase tracking-wider text-slate-500">Drawdown</p>
      <p class="text-sm font-semibold text-slate-400 mono" id="drawdown">--</p>
    </div>
  </div>
</div>

<!-- Holdings + Sectors Grid -->
<div class="max-w-7xl mx-auto px-4 sm:px-6 pb-6">
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">

    <!-- Holdings -->
    <div class="lg:col-span-2 glass rounded-xl p-5">
      <h2 class="text-sm font-semibold text-white mb-4">Holdings & P&L</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/5">
              <th class="pb-2 text-left">Token</th>
              <th class="pb-2 text-right">Value</th>
              <th class="pb-2 text-right hidden sm:table-cell">Avg Cost</th>
              <th class="pb-2 text-right">P&L</th>
              <th class="pb-2 text-right hidden sm:table-cell">Sector</th>
            </tr>
          </thead>
          <tbody id="holdings-table"></tbody>
        </table>
      </div>
    </div>

    <!-- Sector Allocation -->
    <div class="glass rounded-xl p-5">
      <h2 class="text-sm font-semibold text-white mb-4">Sector Allocation</h2>
      <div class="flex justify-center mb-4" style="height: 200px;">
        <canvas id="sector-chart"></canvas>
      </div>
      <div id="sector-list" class="space-y-2"></div>
    </div>
  </div>
</div>

<!-- Trade Log -->
<div class="max-w-7xl mx-auto px-4 sm:px-6 pb-8">
  <div class="glass rounded-xl p-5">
    <h2 class="text-sm font-semibold text-white mb-4">Recent Trades</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead>
          <tr class="text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/5">
            <th class="pb-2 text-left">Time</th>
            <th class="pb-2 text-left">Action</th>
            <th class="pb-2 text-left">Pair</th>
            <th class="pb-2 text-right">Amount</th>
            <th class="pb-2 text-center">Status</th>
            <th class="pb-2 text-left hidden sm:table-cell">Reasoning</th>
          </tr>
        </thead>
        <tbody id="trades-table"></tbody>
      </table>
    </div>
  </div>
</div>

<!-- Footer -->
<div class="border-t border-white/5 px-4 sm:px-6 py-4 text-center">
  <p class="text-[10px] text-slate-600">Schertzinger Company Limited — Auto-refreshes every 30s</p>
</div>

<script>
let sectorChart = null;
const $ = id => document.getElementById(id);

function fmt(n, d=2) { return n != null ? '$' + Number(n).toFixed(d) : '--'; }
function pnlColor(n) { return n >= 0 ? 'text-emerald-400' : 'text-red-400'; }
function pnlSign(n) { return n >= 0 ? '+' : ''; }
function pnlBg(n) { return n >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'; }

async function fetchData() {
  try {
    const [pRes, bRes, sRes, tRes] = await Promise.allSettled([
      fetch('/api/portfolio').then(r => r.json()),
      fetch('/api/balances').then(r => r.json()),
      fetch('/api/sectors').then(r => r.json()),
      fetch('/api/trades?limit=30').then(r => r.json()),
    ]);
    const p = pRes.status === 'fulfilled' ? pRes.value : null;
    const b = bRes.status === 'fulfilled' ? bRes.value : null;
    const s = sRes.status === 'fulfilled' ? sRes.value : null;
    const t = tRes.status === 'fulfilled' ? tRes.value : null;

    if (p) renderPortfolio(p);
    if (b) renderHoldings(b);
    if (s) renderSectors(s);
    if (t) renderTrades(t);
    $('last-update').textContent = new Date().toLocaleTimeString();
  } catch (e) {
    console.error('Fetch error:', e);
    $('bot-status').textContent = 'Connection Error';
    $('bot-status').className = 'text-xs text-red-400 font-medium';
  }
}

function renderPortfolio(p) {
  $('portfolio-value').textContent = fmt(p.totalValue);
  const pnlEl = $('total-pnl');
  pnlEl.textContent = pnlSign(p.pnl) + fmt(p.pnl) + ' (' + pnlSign(p.pnlPercent) + p.pnlPercent.toFixed(1) + '%)';
  pnlEl.className = 'text-xl sm:text-2xl font-bold mono ' + pnlColor(p.pnl);

  const rEl = $('realized-pnl');
  rEl.textContent = pnlSign(p.realizedPnL) + fmt(p.realizedPnL);
  rEl.className = 'text-lg font-semibold mono ' + pnlColor(p.realizedPnL);

  const uEl = $('unrealized-pnl');
  uEl.textContent = pnlSign(p.unrealizedPnL) + fmt(p.unrealizedPnL);
  uEl.className = 'text-lg font-semibold mono ' + pnlColor(p.unrealizedPnL);

  $('trade-count').textContent = p.totalTrades;
  $('success-rate').textContent = p.totalTrades > 0 ? ((p.successfulTrades/p.totalTrades)*100).toFixed(0) + '%' : '--';
  $('cycle-count').textContent = p.totalCycles;
  $('uptime').textContent = p.uptime;
  $('peak-value').textContent = fmt(p.peakValue);
  $('drawdown').textContent = p.drawdown.toFixed(1) + '%';
  $('bot-status').textContent = 'Online';
  $('bot-status').className = 'text-xs text-emerald-400 font-medium';
}

function renderHoldings(b) {
  const rows = b.balances
    .filter(h => h.usdValue > 0.01)
    .sort((a, b) => b.usdValue - a.usdValue)
    .map(h => {
      const pnl = h.unrealizedPnL || 0;
      const pnlPct = h.totalInvested > 0 ? (pnl / h.totalInvested * 100) : 0;
      const costStr = h.costBasis ? '$' + (h.costBasis < 0.01 ? h.costBasis.toFixed(6) : h.costBasis.toFixed(4)) : '-';
      return '<tr class="border-b border-white/5 hover:bg-white/[0.02]">' +
        '<td class="py-2.5 font-semibold text-white">' + h.symbol + '</td>' +
        '<td class="py-2.5 text-right mono text-slate-300">' + fmt(h.usdValue) + '</td>' +
        '<td class="py-2.5 text-right mono text-slate-500 hidden sm:table-cell">' + costStr + '</td>' +
        '<td class="py-2.5 text-right"><span class="px-1.5 py-0.5 rounded ' + pnlBg(pnl) + ' ' + pnlColor(pnl) + ' mono text-[11px]">' +
          pnlSign(pnl) + '$' + Math.abs(pnl).toFixed(2) + (h.totalInvested > 0 ? ' (' + pnlSign(pnlPct) + pnlPct.toFixed(1) + '%)' : '') +
        '</span></td>' +
        '<td class="py-2.5 text-right text-slate-600 hidden sm:table-cell">' + (h.sector || '-') + '</td>' +
      '</tr>';
    }).join('');
  $('holdings-table').innerHTML = rows || '<tr><td colspan="5" class="py-6 text-center text-slate-600">No holdings yet</td></tr>';
}

function renderSectors(s) {
  if (!s.allocations || s.allocations.length === 0) return;
  const colors = ['#4c6ef5', '#10b981', '#f0b429', '#ef4444', '#38bdf8', '#a78bfa'];
  const labels = s.allocations.map(a => a.name);
  const data = s.allocations.map(a => a.currentUSD);

  if (sectorChart) sectorChart.destroy();
  sectorChart = new Chart($('sector-chart'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
    options: {
      cutout: '65%',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } }
    }
  });

  $('sector-list').innerHTML = s.allocations.map((a, i) => {
    const drift = a.drift;
    const driftColor = Math.abs(drift) > 5 ? (drift > 0 ? 'text-amber-400' : 'text-sky-400') : 'text-slate-400';
    return '<div class="flex items-center justify-between text-xs">' +
      '<div class="flex items-center gap-2"><span class="w-2 h-2 rounded-full" style="background:' + colors[i] + '"></span>' +
      '<span class="text-slate-300">' + a.name + '</span></div>' +
      '<div class="mono"><span class="text-white">' + a.currentPercent.toFixed(0) + '%</span>' +
      '<span class="text-slate-600 mx-1">/</span><span class="text-slate-500">' + a.targetPercent + '%</span>' +
      '<span class="ml-2 ' + driftColor + '">' + (drift >= 0 ? '+' : '') + drift.toFixed(1) + '</span></div></div>';
  }).join('');
}

function renderTrades(t) {
  if (!t.trades || t.trades.length === 0) {
    $('trades-table').innerHTML = '<tr><td colspan="6" class="py-6 text-center text-slate-600">No trades yet</td></tr>';
    return;
  }
  $('trades-table').innerHTML = t.trades.map(tr => {
    const time = new Date(tr.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const actionColor = tr.action === 'BUY' ? 'text-emerald-400 bg-emerald-500/10' : tr.action === 'SELL' ? 'text-red-400 bg-red-500/10' : 'text-slate-400 bg-slate-500/10';
    const pair = tr.fromToken + ' → ' + tr.toToken;
    const statusIcon = tr.success ? '<span class="text-emerald-400">✓</span>' : '<span class="text-red-400">✗</span>';
    const reason = (tr.reasoning || '').substring(0, 60);
    return '<tr class="border-b border-white/5 hover:bg-white/[0.02]">' +
      '<td class="py-2 text-slate-400 mono">' + time + '</td>' +
      '<td class="py-2"><span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ' + actionColor + '">' + tr.action + '</span></td>' +
      '<td class="py-2 text-slate-300 mono">' + pair + '</td>' +
      '<td class="py-2 text-right mono text-white">$' + (tr.amountUSD || 0).toFixed(2) + '</td>' +
      '<td class="py-2 text-center">' + statusIcon + '</td>' +
      '<td class="py-2 text-slate-500 truncate max-w-[200px] hidden sm:table-cell">' + reason + '</td></tr>';
  }).join('');
}

// Initial load + auto-refresh every 30s
fetchData();
setInterval(fetchData, 30000);
</script>
</body>
</html>`;

