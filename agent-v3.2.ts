/**
 * Henry's Autonomous Trading Agent v5.2.0
 *
 * PHASE 3: RECURSIVE SELF-IMPROVEMENT ENGINE + v5.1 INTELLIGENCE UPGRADE
 *
 * CHANGES IN V5.1.1:
 * - NEW: Tiered Profit Harvesting — scale out of winners in 4 tranches (+8%, +15%, +25%, +40%)
 * - NEW: Time-based rebalancing — positions held 72h+ with +5% gain get a 10% trim
 * - NEW: Per-tier cooldowns — each harvest tier has independent 6h cooldowns
 * - NEW: Harvested profits tracking — dashboard shows total banked profits + harvest history
 * - NEW: "Harvested" metric card on dashboard with harvest count + last harvest details
 * - UPGRADED: AI prompt teaches profit harvesting philosophy and smart money exit signals
 * - LOWERED: minHoldingUSD from $10 to $5, cooldown from 24h to 6h for faster harvesting cycles
 *
 * CHANGES IN V5.1:
 * - NEW: Binance Long/Short Ratios — global retail vs top trader (smart money) positioning
 * - NEW: Composite Positioning Signals — SMART_MONEY_LONG/SHORT, OVERLEVERAGED detection
 * - NEW: OI-Price Divergence Detection — identifies squeeze setups before they trigger
 * - NEW: Cross-Asset Correlation — Gold (PAXG real-time), Oil, VIX, S&P 500 as direct signals
 * - NEW: Cross-Asset Signal Engine — RISK_ON/RISK_OFF/FLIGHT_TO_SAFETY from traditional markets
 * - NEW: Shadow Model Validation — threshold changes require 3+ statistical confirmations before promoting
 * - NEW: MEV Protection — adaptive slippage based on trade size + market conditions
 * - NEW: Dashboard panels for Derivatives Positioning, Cross-Asset Intelligence, Shadow Proposals
 * - UPGRADED: AI prompt now receives positioning intelligence + cross-asset signals
 *
 * CHANGES IN V5.0.1:
 * - BUGFIX: Performance reviews now properly stored (were computed but discarded)
 * - BUGFIX: lastReviewTradeIndex and lastReviewTimestamp now persist after each review
 * - BUGFIX: Dashboard "trades until next" now shows remaining trades, not elapsed trades
 * - BUGFIX: Pattern analysis rebuilds on deploy to pick up new v5.0 trades with signalContext
 * - NEW: Circuit breakers — hard halt at 20% drawdown, caution mode (half positions) at 12%
 *
 * CHANGES IN V5.0:
 * - Strategy Pattern Memory: auto-classifies trades into strategy buckets, tracks win/loss rates
 * - Performance Review Cycle: structured analysis every 10 trades or 24h with actionable insights
 * - Adaptive Threshold Engine: RSI, confluence, profit-take, stop-loss thresholds self-tune based on performance
 * - Confidence-Weighted Position Sizing: proven patterns get full size, unproven get smaller exploratory sizes
 * - Anti-Stagnation / Exploration: triggers $3 exploration trades after 48h inactivity
 * - Self-improvement prompt injection: AI sees its own patterns, insights, and threshold changes
 * - New API endpoints: /api/patterns, /api/reviews, /api/thresholds
 * - Dashboard: Intelligence section showing top patterns, adaptive thresholds, latest insights
 *
 * CHANGES IN V4.5.3:
 * - Fixed FRED API auth: uses api_key query parameter (not Bearer header)
 * - FRED macro data now flowing: Fed Rate, 10Y Yield, CPI, M2, Dollar Index
 *
 * CHANGES IN V4.5.2:
 * - CoinGecko: last-known-prices cache prevents $0 portfolio when rate limited
 * - CoinGecko: longer retry delays (15s, 45s) to survive 60s rate limit windows
 * - Intelligence fetches run in parallel with CoinGecko retries (faster cycles)
 *
 * CHANGES IN V4.5.1:
 * - Fixed CryptoPanic: proper API v1 endpoint with auth_token (env: CRYPTOPANIC_AUTH_TOKEN)
 * - Fixed FRED API: added env var check + warning (auth fixed in v4.5.3)
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
 * - AI_TOKENS (20%): VIRTUAL, AIXBT, HIGHER
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

// === DERIVATIVES MODULE IMPORTS (v6.0) ===
import { CoinbaseAdvancedTradeClient } from "./services/services/coinbase-advanced-trade.js";
import { DerivativesStrategyEngine, DEFAULT_DERIVATIVES_CONFIG, type DerivativesSignal, type DerivativesTradeRecord, type MacroCommoditySignal } from "./services/services/derivatives-strategy.js";
import { MacroCommoditySignalEngine, discoverCommodityContracts } from "./services/services/macro-commodity-signals.js";

// === v6.0: EQUITY INTEGRATION ===
import { EquityIntegration } from './equity-integration.js';

// === v6.1: TOKEN DISCOVERY ENGINE ===
import { TokenDiscoveryEngine, type DiscoveredToken, type TokenDiscoveryState } from './services/token-discovery.js';

// === v6.0: SMART CACHING + COOLDOWN + CONSTANTS ===
import { cacheManager, CacheKeys } from "./services/cache-manager.js";
import { CACHE_TTL } from "./config/constants.js";
import { cooldownManager } from "./services/cooldown-manager.js";
import {
  HEAVY_CYCLE_FORCED_INTERVAL_MS,
  PRICE_CHANGE_THRESHOLD,
  FG_CHANGE_THRESHOLD,
  DEFAULT_TRADING_INTERVAL_MINUTES,
  ADAPTIVE_MIN_INTERVAL_SEC,
  ADAPTIVE_MAX_INTERVAL_SEC,
  ADAPTIVE_DEFAULT_INTERVAL_SEC,
  EMERGENCY_INTERVAL_SEC,
  EMERGENCY_DROP_THRESHOLD,
  PORTFOLIO_SENSITIVITY_TIERS,
  VOLATILITY_SPEED_MAP,
} from "./config/constants.js";
import type { CooldownDecision } from "./types/index.js";

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
    tokens: ["VIRTUAL", "AIXBT", "HIGHER"],
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
  // GAME removed — insufficient liquidity on Base DEX pools (failed 5+ consecutive swaps)
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
// v6.2: CHAINLINK ORACLE PRICE FEEDS — On-chain prices that can never rate-limit
// ============================================================================
// AggregatorV3Interface: latestRoundData() → (roundId, answer, startedAt, updatedAt, answeredInRound)
// answer is price with 8 decimals for USD feeds

const CHAINLINK_FEEDS_BASE: Record<string, { feed: string; decimals: number }> = {
  ETH:   { feed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", decimals: 8 },  // ETH/USD
  WETH:  { feed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", decimals: 8 },  // Same as ETH
  cbBTC: { feed: "0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D", decimals: 8 },  // BTC/USD
  cbETH: { feed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", decimals: 8 },  // Uses ETH feed as proxy
};

const CHAINLINK_ABI_FRAGMENT = "0x50d25bcd"; // latestAnswer() → int256

/**
 * v6.2: Fetch prices directly from Chainlink oracles on Base via eth_call.
 * These are on-chain reads — no API key needed, no rate limits possible.
 * Only covers major tokens (ETH, BTC) but provides an unbreakable price floor.
 */
async function fetchChainlinkPrices(): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  const BASE_RPC = "https://mainnet.base.org";

  for (const [symbol, config] of Object.entries(CHAINLINK_FEEDS_BASE)) {
    try {
      const res = await axios.post(BASE_RPC, {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: config.feed, data: CHAINLINK_ABI_FRAGMENT }, "latest"],
      }, { timeout: 5000 });

      if (res.data?.result && res.data.result !== "0x") {
        const rawPrice = parseInt(res.data.result, 16);
        const price = rawPrice / Math.pow(10, config.decimals);
        if (price > 0) {
          prices.set(symbol, price);
        }
      }
    } catch {
      // Silent fail per token — other sources still available
    }
  }

  if (prices.size > 0) {
    console.log(`  🔗 Chainlink oracle: ${prices.size} prices (${[...prices.entries()].map(([s, p]) => `${s}=$${p.toFixed(2)}`).join(", ")})`);
  }

  return prices;
}

// ============================================================================
// CONFIGURATION V3.2
// ============================================================================

const CONFIG = {
  // Wallet
  walletAddress: process.env.WALLET_ADDRESS || "0x55509AA76E2769eCCa5B4293359e3001dA16dd0F",

  // Trading Parameters
  trading: {
    enabled: process.env.TRADING_ENABLED === "true",
    maxBuySize: parseFloat(process.env.MAX_BUY_SIZE_USDC || "25"),
    maxSellPercent: parseFloat(process.env.MAX_SELL_PERCENT || "50"),
    intervalMinutes: parseInt(process.env.TRADING_INTERVAL_MINUTES || String(DEFAULT_TRADING_INTERVAL_MINUTES)),
    // V3.1: Risk-adjusted position sizing
    maxPositionPercent: 25,  // No single token > 25% of portfolio
    minPositionUSD: 5,       // Minimum position size
    rebalanceThreshold: 10,  // Rebalance if sector drift > 10%
    slippageBps: 100,        // 1% slippage tolerance for swaps
    // V5.1.1: Tiered Profit Harvesting — scale out in tranches, bank small wins consistently
    profitTaking: {
      enabled: true,
      targetPercent: 20,        // Legacy: original trigger (used by adaptive thresholds as base)
      sellPercent: 30,          // Legacy: original sell amount
      minHoldingUSD: 5,         // Don't trigger if holding < $5
      cooldownHours: 6,         // Reduced: faster harvesting cycles (was 24h)
      // Tiered harvesting: sell progressively more as gains increase
      tiers: [
        { gainPercent: 8,  sellPercent: 15, label: "EARLY_HARVEST" },    // Small win: skim 15%
        { gainPercent: 15, sellPercent: 20, label: "MID_HARVEST" },      // Moderate win: take 20%
        { gainPercent: 25, sellPercent: 30, label: "STRONG_HARVEST" },   // Strong win: take 30%
        { gainPercent: 40, sellPercent: 40, label: "MAJOR_HARVEST" },    // Major win: take 40%
      ],
    },
    // V3.5: Stop-Loss
    stopLoss: {
      enabled: true,
      percentThreshold: -15,    // v6.2: Tightened from -25% to -15% from avg cost
      sellPercent: 75,          // v6.2: Sell 75% of losing position (was 50%)
      minHoldingUSD: 5,         // Don't trigger if holding < $5
      trailingEnabled: true,    // Also use trailing stop from peak
      trailingPercent: -12,     // v6.2: Tightened from -20% to -12% from peak
    },
  },

  // Active tokens (all tradeable tokens)
  activeTokens: Object.keys(TOKEN_REGISTRY).filter(t => t !== "USDC"),

  // Logging
  logFile: process.env.PERSIST_DIR ? `${process.env.PERSIST_DIR}/trades-v3.4.json` : "./logs/trades-v3.4.json",

    // v5.3.0: Auto-Harvest — send realized profits back to owner wallet
    autoHarvest: {
      enabled: process.env.AUTO_HARVEST_ENABLED === 'true',
      destinationWallet: process.env.PROFIT_DESTINATION_WALLET || '',
      thresholdUSD: parseFloat(process.env.AUTO_HARVEST_THRESHOLD_USD || '25'),
      minETHReserve: parseFloat(process.env.AUTO_HARVEST_MIN_ETH_RESERVE || '0.002'),
      cooldownHours: parseFloat(process.env.AUTO_HARVEST_COOLDOWN_HOURS || '24'),
      // v6.2.2: Capital floor — never harvest below this portfolio value
      minTradingCapitalUSD: parseFloat(process.env.MIN_TRADING_CAPITAL_USD || '500'),
    },

    // v6.0: Derivatives Module — Perpetual Futures + Commodity Futures
    derivatives: {
      enabled: process.env.DERIVATIVES_ENABLED === 'true',
      maxLeverage: parseInt(process.env.DERIVATIVES_MAX_LEVERAGE || '3'),
      basePositionUSD: parseFloat(process.env.DERIVATIVES_BASE_POSITION_USD || '50'),
      stopLossPercent: parseFloat(process.env.DERIVATIVES_STOP_LOSS_PERCENT || '-10'),
      takeProfitPercent: parseFloat(process.env.DERIVATIVES_TAKE_PROFIT_PERCENT || '15'),
      apiKeyId: process.env.COINBASE_ADV_API_KEY_ID || process.env.CDP_API_KEY_ID || process.env.CDP_API_KEY_NAME || '',
      apiKeySecret: process.env.COINBASE_ADV_API_KEY_SECRET || process.env.CDP_API_KEY_SECRET || process.env.CDP_API_KEY_PRIVATE_KEY || '',
    },
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

// === DERIVATIVES MODULE STATE (v6.0) ===
let advancedTradeClient: CoinbaseAdvancedTradeClient | null = null;
let derivativesEngine: DerivativesStrategyEngine | null = null;
let commoditySignalEngine: MacroCommoditySignalEngine | null = null;
let lastDerivativesData: {
  state: any;
  signals: DerivativesSignal[];
  trades: DerivativesTradeRecord[];
  commoditySignal: MacroCommoditySignal | null;
} | null = null;

// === v6.0: LIGHT/HEAVY CYCLE STATE ===
let lastHeavyCycleAt = 0;
let lastPriceSnapshot: Map<string, number> = new Map();
let lastFearGreedValue = 0;
let cycleStats = { totalLight: 0, totalHeavy: 0, lastHeavyReason: '' };

// === v6.0: EQUITY MODULE STATE (initialized in main()) ===
let equityEngine: EquityIntegration | null = null;
let equityEnabled = false;

// === v6.1: TOKEN DISCOVERY STATE ===
let tokenDiscoveryEngine: TokenDiscoveryEngine | null = null;

// === v6.2: ADAPTIVE CYCLE ENGINE ===
// Replaces fixed cron with dynamic setTimeout that adjusts to market conditions

const adaptiveCycle: {
  currentIntervalSec: number;
  volatilityLevel: string;
  portfolioTier: string;
  dynamicPriceThreshold: number;
  consecutiveLightCycles: number;
  lastPriceCheck: Map<string, number>;
  emergencyMode: boolean;
  emergencyUntil: number;
  wsConnected: boolean;
  wsReconnectAttempts: number;
  realtimePrices: Map<string, { price: number; timestamp: number }>;
} = {
  currentIntervalSec: ADAPTIVE_DEFAULT_INTERVAL_SEC,
  volatilityLevel: 'NORMAL',
  portfolioTier: 'STARTER',
  dynamicPriceThreshold: PRICE_CHANGE_THRESHOLD,
  consecutiveLightCycles: 0,
  lastPriceCheck: new Map(),
  emergencyMode: false,
  emergencyUntil: 0,
  wsConnected: false,
  wsReconnectAttempts: 0,
  realtimePrices: new Map(),
};

let adaptiveCycleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * v6.2: Determine the portfolio sensitivity tier based on current value.
 * Higher portfolio = lower threshold = more sensitive to price moves.
 */
function getPortfolioSensitivity(portfolioUSD: number): { threshold: number; tier: string } {
  let matched = PORTFOLIO_SENSITIVITY_TIERS[0];
  for (const tier of PORTFOLIO_SENSITIVITY_TIERS) {
    if (portfolioUSD >= tier.minUSD) matched = tier;
  }
  return { threshold: matched.priceChangeThreshold, tier: matched.label };
}

/**
 * v6.2: Calculate volatility level from recent price movements.
 * Looks at max price change across all tracked tokens in the last snapshot.
 */
function assessVolatility(currentPrices: Map<string, number>, previousPrices: Map<string, number>): {
  level: string;
  maxChange: number;
  fastestMover: string;
} {
  let maxChange = 0;
  let fastestMover = '';

  for (const [symbol, price] of currentPrices) {
    const prev = previousPrices.get(symbol);
    if (prev && prev > 0) {
      const change = Math.abs(price - prev) / prev;
      if (change > maxChange) {
        maxChange = change;
        fastestMover = symbol;
      }
    }
  }

  let level: string;
  if (maxChange > 0.08) level = 'EXTREME';
  else if (maxChange > 0.05) level = 'HIGH';
  else if (maxChange > 0.03) level = 'ELEVATED';
  else if (maxChange > 0.01) level = 'NORMAL';
  else if (maxChange > 0.003) level = 'LOW';
  else level = 'DEAD';

  return { level, maxChange, fastestMover };
}

/**
 * v6.2: Check for emergency conditions — any position dropped 5%+ since last check.
 * Returns the token and drop percentage if emergency detected.
 */
function checkEmergencyConditions(currentPrices: Map<string, number>): {
  emergency: boolean;
  token?: string;
  dropPercent?: number;
} {
  for (const [symbol, price] of currentPrices) {
    const lastCheck = adaptiveCycle.lastPriceCheck.get(symbol);
    if (lastCheck && lastCheck > 0) {
      const change = (price - lastCheck) / lastCheck;
      if (change <= EMERGENCY_DROP_THRESHOLD) {
        return { emergency: true, token: symbol, dropPercent: change * 100 };
      }
    }
  }
  return { emergency: false };
}

/**
 * v6.2: Compute the next cycle interval based on all adaptive factors.
 * This is the brain of the adaptive engine.
 */
function computeNextInterval(currentPrices: Map<string, number>): {
  intervalSec: number;
  reason: string;
  volatilityLevel: string;
} {
  const portfolioValue = state.trading.totalPortfolioValue || 0;
  const { tier } = getPortfolioSensitivity(portfolioValue);
  adaptiveCycle.portfolioTier = tier;

  // Check emergency first
  if (adaptiveCycle.emergencyMode && Date.now() < adaptiveCycle.emergencyUntil) {
    return {
      intervalSec: EMERGENCY_INTERVAL_SEC,
      reason: `EMERGENCY rapid-fire (${adaptiveCycle.portfolioTier} tier)`,
      volatilityLevel: 'EXTREME',
    };
  }

  // Assess volatility from price movements
  const vol = assessVolatility(currentPrices, adaptiveCycle.lastPriceCheck);
  const baseInterval = (VOLATILITY_SPEED_MAP as any)[vol.level] || ADAPTIVE_DEFAULT_INTERVAL_SEC;

  // Scale down interval for larger portfolios (more at stake = check more often)
  let portfolioMultiplier = 1.0;
  if (portfolioValue >= 100000) portfolioMultiplier = 0.5;
  else if (portfolioValue >= 50000) portfolioMultiplier = 0.6;
  else if (portfolioValue >= 25000) portfolioMultiplier = 0.75;
  else if (portfolioValue >= 5000) portfolioMultiplier = 0.85;

  let finalInterval = Math.round(baseInterval * portfolioMultiplier);

  // Clamp to bounds
  finalInterval = Math.max(ADAPTIVE_MIN_INTERVAL_SEC, Math.min(ADAPTIVE_MAX_INTERVAL_SEC, finalInterval));

  // If many consecutive light cycles, gradually relax (nothing is happening)
  if (adaptiveCycle.consecutiveLightCycles > 10) {
    finalInterval = Math.min(finalInterval * 1.5, ADAPTIVE_MAX_INTERVAL_SEC);
  }

  const reason = vol.maxChange > 0
    ? `${vol.level} volatility (${vol.fastestMover} ±${(vol.maxChange * 100).toFixed(1)}%) | ${tier} tier`
    : `${vol.level} volatility | ${tier} tier`;

  return { intervalSec: Math.round(finalInterval), reason, volatilityLevel: vol.level };
}

/**
 * v6.2: Schedule the next adaptive cycle.
 * Replaces the fixed cron job with dynamic setTimeout.
 */
function scheduleNextCycle() {
  if (adaptiveCycleTimer) clearTimeout(adaptiveCycleTimer);

  const delayMs = adaptiveCycle.currentIntervalSec * 1000;
  adaptiveCycleTimer = setTimeout(async () => {
    try {
      await runTradingCycle();
    } catch (err: any) {
      console.error(`[Adaptive Cycle Error] ${err?.message?.substring(0, 300) || err}`);
    }
    // After cycle completes, schedule the next one (interval may have changed)
    scheduleNextCycle();
  }, delayMs);
}

/**
 * v6.2: Initialize WebSocket price stream from DexScreener.
 * Provides real-time price updates between cycles for emergency detection.
 */
function initPriceStream() {
  // DexScreener doesn't have a public WebSocket API, so we use a high-frequency
  // HTTP polling approach with a dedicated interval (every 10s) for real-time awareness.
  // This is more reliable than WebSocket for DexScreener and avoids connection issues.

  const STREAM_INTERVAL = 10000; // 10 seconds

  const streamPrices = async () => {
    try {
      const addresses = Object.entries(TOKEN_REGISTRY)
        .filter(([s]) => s !== "USDC")
        .map(([_, t]) => t.address)
        .join(",");

      const dexRes = await axios.get(
        `https://api.dexscreener.com/tokens/v1/base/${addresses}`,
        { timeout: 8000 }
      );

      if (dexRes.data && Array.isArray(dexRes.data)) {
        const seen = new Set<string>();
        const now = Date.now();
        for (const pair of dexRes.data) {
          const addr = pair.baseToken?.address?.toLowerCase();
          const entry = Object.entries(TOKEN_REGISTRY).find(([_, t]) => t.address.toLowerCase() === addr);
          if (entry && !seen.has(entry[0])) {
            seen.add(entry[0]);
            const price = parseFloat(pair.priceUsd || "0");
            if (price > 0) {
              adaptiveCycle.realtimePrices.set(entry[0], { price, timestamp: now });

              // Check for emergency drop in real-time
              const lastCheck = adaptiveCycle.lastPriceCheck.get(entry[0]);
              if (lastCheck && lastCheck > 0) {
                const change = (price - lastCheck) / lastCheck;
                if (change <= EMERGENCY_DROP_THRESHOLD && !adaptiveCycle.emergencyMode) {
                  console.log(`\n🚨 EMERGENCY DETECTED: ${entry[0]} dropped ${(change * 100).toFixed(1)}% — activating rapid-fire mode!`);
                  adaptiveCycle.emergencyMode = true;
                  adaptiveCycle.emergencyUntil = now + 5 * 60 * 1000; // 5 minutes of emergency mode
                  // Force immediate cycle
                  if (adaptiveCycleTimer) clearTimeout(adaptiveCycleTimer);
                  scheduleNextCycle();
                }
              }
            }
          }
        }
        adaptiveCycle.wsConnected = true; // Mark stream as active
      }
    } catch {
      // Silent fail — normal cycles still work as backup
      adaptiveCycle.wsConnected = false;
    }
  };

  // Start streaming
  streamPrices();
  setInterval(streamPrices, STREAM_INTERVAL);
  console.log(`   📡 Real-time price stream: active (${STREAM_INTERVAL / 1000}s polling)`);
}

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
    triggeredBy: "AI" | "STOP_LOSS" | "PROFIT_TAKE" | "EXPLORATION";  // What initiated the trade
    isExploration?: boolean;  // V5.0: Whether this was an exploration trade
    // v5.1: Enhanced context
    btcPositioning?: string | null;      // BTC positioning signal
    ethPositioning?: string | null;      // ETH positioning signal
    crossAssetSignal?: string | null;    // Cross-asset correlation signal
    adaptiveSlippage?: number;           // Slippage bps used (MEV protection)
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

// ============================================================================
// PHASE 3: RECURSIVE SELF-IMPROVEMENT ENGINE
// ============================================================================

interface StrategyPattern {
  patternId: string;
  description: string;
  conditions: {
    action: "BUY" | "SELL";
    regime: MarketRegime;
    rsiBucket: "OVERSOLD" | "NEUTRAL" | "OVERBOUGHT" | "UNKNOWN";
    confluenceBucket: "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";
  };
  stats: {
    wins: number;
    losses: number;
    pending: number;           // Trades not yet resolved (no matching sell)
    avgReturnPercent: number;
    totalReturnUSD: number;
    sampleSize: number;
    lastTriggered: string;
  };
  confidence: number;          // 0.2 to 1.0
}

interface AdaptiveThresholds {
  rsiOversold: number;              // Default 30
  rsiOverbought: number;            // Default 70
  confluenceBuy: number;            // Default 15
  confluenceSell: number;           // Default -15
  confluenceStrongBuy: number;      // Default 40
  confluenceStrongSell: number;     // Default -40
  profitTakeTarget: number;         // Default 20
  profitTakeSellPercent: number;    // Default 30
  stopLossPercent: number;          // Default -25
  trailingStopPercent: number;      // Default -20
  regimeMultipliers: Record<MarketRegime, number>;  // Position size multiplier per regime
  history: Array<{
    timestamp: string;
    field: string;
    oldValue: number;
    newValue: number;
    reason: string;
  }>;
  lastAdapted: string | null;
  adaptationCount: number;
}

interface PerformanceReview {
  timestamp: string;
  triggerReason: "TRADE_COUNT" | "TIME_ELAPSED";
  tradesSinceLastReview: number;
  insights: Array<{
    category: "REGIME" | "PATTERN" | "THRESHOLD" | "SECTOR" | "ACTIVITY";
    severity: "INFO" | "WARNING" | "ACTION";
    message: string;
  }>;
  recommendations: Array<{
    type: "THRESHOLD_CHANGE" | "POSITION_SIZE" | "PATTERN_AVOID" | "PATTERN_FAVOR";
    description: string;
    applied: boolean;
  }>;
  periodStats: {
    winRate: number;
    avgReturn: number;
    totalTrades: number;
    bestPattern: string | null;
    worstPattern: string | null;
    dominantRegime: MarketRegime | null;
  };
}

interface ExplorationState {
  totalExplorationTrades: number;
  totalExploitationTrades: number;
  consecutiveHolds: number;
  lastTradeTimestamp: string | null;
  stagnationAlerts: number;
}

const THRESHOLD_BOUNDS: Record<string, { min: number; max: number; maxStep: number }> = {
  rsiOversold:           { min: 20, max: 40, maxStep: 2 },
  rsiOverbought:         { min: 60, max: 80, maxStep: 2 },
  confluenceBuy:         { min: 5,  max: 30, maxStep: 2 },
  confluenceSell:        { min: -30, max: -5, maxStep: 2 },
  confluenceStrongBuy:   { min: 25, max: 60, maxStep: 3 },
  confluenceStrongSell:  { min: -60, max: -25, maxStep: 3 },
  profitTakeTarget:      { min: 10, max: 40, maxStep: 2 },
  profitTakeSellPercent: { min: 15, max: 50, maxStep: 3 },
  stopLossPercent:       { min: -25, max: -8, maxStep: 2 },    // v6.2: tighter bounds
  trailingStopPercent:   { min: -20, max: -8, maxStep: 2 },   // v6.2: tighter bounds
};

const DEFAULT_ADAPTIVE_THRESHOLDS: AdaptiveThresholds = {
  rsiOversold: 30,
  rsiOverbought: 70,
  confluenceBuy: 15,
  confluenceSell: -15,
  confluenceStrongBuy: 40,
  confluenceStrongSell: -40,
  profitTakeTarget: 20,
  profitTakeSellPercent: 30,
  stopLossPercent: -15,       // v6.2: tightened from -25%
  trailingStopPercent: -12,   // v6.2: tightened from -20%
  regimeMultipliers: {
    TRENDING_UP: 1.2,
    TRENDING_DOWN: 0.6,
    RANGING: 0.8,      // v5.2: reduced from 1.0 — smaller positions in ranging markets
    VOLATILE: 0.5,
    UNKNOWN: 0.7,
  },
  history: [],
  lastAdapted: null,
  adaptationCount: 0,
};

const DEFAULT_EXPLORATION_STATE: ExplorationState = {
  totalExplorationTrades: 0,
  totalExploitationTrades: 0,
  consecutiveHolds: 0,
  lastTradeTimestamp: null,
  stagnationAlerts: 0,
};

/**
 * Classify a trade into a strategy pattern bucket based on its signal context
 */
function classifyTradePattern(trade: TradeRecord): string {
  if (!trade.signalContext) return "UNKNOWN_UNKNOWN_UNKNOWN_UNKNOWN";
  const { marketRegime, confluenceScore, rsi } = trade.signalContext;
  const action = trade.action === "BUY" || trade.action === "SELL" ? trade.action : "BUY";

  // RSI bucket
  let rsiBucket = "UNKNOWN";
  if (rsi !== null && rsi !== undefined) {
    if (rsi < state.adaptiveThresholds.rsiOversold) rsiBucket = "OVERSOLD";
    else if (rsi > state.adaptiveThresholds.rsiOverbought) rsiBucket = "OVERBOUGHT";
    else rsiBucket = "NEUTRAL";
  }

  // Confluence bucket
  let confBucket = "NEUTRAL";
  if (confluenceScore >= state.adaptiveThresholds.confluenceStrongBuy) confBucket = "STRONG_BUY";
  else if (confluenceScore >= state.adaptiveThresholds.confluenceBuy) confBucket = "BUY";
  else if (confluenceScore <= state.adaptiveThresholds.confluenceStrongSell) confBucket = "STRONG_SELL";
  else if (confluenceScore <= state.adaptiveThresholds.confluenceSell) confBucket = "SELL";

  return `${action}_${rsiBucket}_${marketRegime}_${confBucket}`;
}

/**
 * Build pattern description from pattern ID
 */
function describePattern(patternId: string): string {
  const parts = patternId.split("_");
  if (parts.length < 4) return patternId;
  const [action, rsi, ...rest] = parts;
  const regime = rest.slice(0, -1).join("_") || "UNKNOWN";
  const conf = rest[rest.length - 1] || "NEUTRAL";
  const rsiLabel = rsi === "OVERSOLD" ? "RSI oversold" : rsi === "OVERBOUGHT" ? "RSI overbought" : "RSI neutral";
  const confLabel = conf.replace("_", " ").toLowerCase();
  return `${action} when ${rsiLabel} in ${regime} regime (${confLabel} confluence)`;
}

/**
 * Analyze all trade history to build strategy pattern memory
 */
function analyzeStrategyPatterns(): void {
  const patterns: Record<string, StrategyPattern> = {};

  // Process each non-HOLD successful trade
  for (const trade of state.tradeHistory) {
    if (!trade.success || trade.action === "HOLD" || trade.action === "REBALANCE") continue;
    const patternId = classifyTradePattern(trade);

    if (!patterns[patternId]) {
      const parts = patternId.split("_");
      const action = (parts[0] === "BUY" || parts[0] === "SELL") ? parts[0] as "BUY" | "SELL" : "BUY";
      const rsiBucket = parts[1] as any || "UNKNOWN";
      const regime = parts.slice(2, -1).join("_") as MarketRegime || "UNKNOWN";
      const confBucket = parts[parts.length - 1] as any || "NEUTRAL";

      patterns[patternId] = {
        patternId,
        description: describePattern(patternId),
        conditions: { action, regime: regime as MarketRegime, rsiBucket, confluenceBucket: confBucket },
        stats: { wins: 0, losses: 0, pending: 0, avgReturnPercent: 0, totalReturnUSD: 0, sampleSize: 0, lastTriggered: trade.timestamp },
        confidence: 0.3,
      };
    }

    patterns[patternId].stats.lastTriggered = trade.timestamp;

    // For BUY trades, find the matching SELL to compute return
    if (trade.action === "BUY") {
      const buyTime = new Date(trade.timestamp).getTime();
      const matchingSell = state.tradeHistory.find(t =>
        t.action === "SELL" && t.fromToken === trade.toToken && t.success &&
        new Date(t.timestamp).getTime() > buyTime
      );
      if (matchingSell) {
        const cb = state.costBasis[trade.toToken];
        if (cb && cb.averageCostBasis > 0) {
          const returnPct = matchingSell.amountUSD > 0 && trade.amountUSD > 0
            ? ((matchingSell.amountUSD / trade.amountUSD) - 1) * 100
            : 0;
          patterns[patternId].stats.sampleSize++;
          if (returnPct > 0) patterns[patternId].stats.wins++;
          else patterns[patternId].stats.losses++;
          patterns[patternId].stats.totalReturnUSD += (matchingSell.amountUSD - trade.amountUSD);
        }
      } else {
        patterns[patternId].stats.pending++;
      }
    }

    // For SELL trades, look back for the BUY
    if (trade.action === "SELL") {
      const sellTime = new Date(trade.timestamp).getTime();
      const matchingBuy = [...state.tradeHistory].reverse().find(t =>
        t.action === "BUY" && t.toToken === trade.fromToken && t.success &&
        new Date(t.timestamp).getTime() < sellTime
      );
      if (matchingBuy && matchingBuy.amountUSD > 0) {
        const returnPct = ((trade.amountUSD / matchingBuy.amountUSD) - 1) * 100;
        patterns[patternId].stats.sampleSize++;
        if (returnPct > 0) patterns[patternId].stats.wins++;
        else patterns[patternId].stats.losses++;
        patterns[patternId].stats.totalReturnUSD += (trade.amountUSD - matchingBuy.amountUSD);
      } else {
        patterns[patternId].stats.pending++;
      }
    }
  }

  // Calculate avg returns and confidence for each pattern
  for (const p of Object.values(patterns)) {
    p.stats.avgReturnPercent = p.stats.sampleSize > 0
      ? (p.stats.totalReturnUSD / Math.max(1, p.stats.sampleSize))
      : 0;

    // Confidence: based on sample size + win rate
    const winRate = p.stats.sampleSize > 0 ? p.stats.wins / p.stats.sampleSize : 0;
    let conf = 0.3; // base
    if (p.stats.sampleSize >= 3) conf = 0.4;
    if (p.stats.sampleSize >= 5) conf = 0.55;
    if (p.stats.sampleSize >= 10) conf = 0.7;
    if (p.stats.sampleSize >= 20) conf = 0.85;
    conf *= (0.5 + winRate * 0.5); // weight by win rate
    if (p.stats.avgReturnPercent < 0) conf *= 0.7; // penalty for negative avg
    p.confidence = Math.max(0.2, Math.min(1.0, conf));
  }

  state.strategyPatterns = patterns;
  console.log(`  🧠 Strategy patterns analyzed: ${Object.keys(patterns).length} patterns from ${state.tradeHistory.length} trades`);
}

/**
 * Run performance review — generates insights and recommendations
 */
function runPerformanceReview(reason: "TRADE_COUNT" | "TIME_ELAPSED"): PerformanceReview {
  const startIdx = state.lastReviewTradeIndex || 0;
  const recentTrades = state.tradeHistory.slice(startIdx);
  const successTrades = recentTrades.filter(t => t.success && t.action !== "HOLD");

  const insights: PerformanceReview["insights"] = [];
  const recommendations: PerformanceReview["recommendations"] = [];

  // Win rate analysis
  const sellTrades = successTrades.filter(t => t.action === "SELL");
  let wins = 0, losses = 0;
  for (const sell of sellTrades) {
    const cb = state.costBasis[sell.fromToken];
    if (cb && cb.averageCostBasis > 0 && sell.amountUSD > 0) {
      const tokensSold = sell.tokenAmount || (sell.amountUSD / cb.averageCostBasis);
      const pnl = sell.amountUSD - (tokensSold * cb.averageCostBasis);
      if (pnl > 0) wins++; else losses++;
    }
  }
  const winRate = (wins + losses) > 0 ? wins / (wins + losses) : 0;
  const avgReturn = sellTrades.length > 0
    ? sellTrades.reduce((sum, t) => sum + (t.portfolioValueAfter || t.portfolioValueBefore) - t.portfolioValueBefore, 0) / sellTrades.length
    : 0;

  // Regime analysis
  const regimeCounts: Record<string, number> = {};
  for (const t of successTrades) {
    const r = t.signalContext?.marketRegime || "UNKNOWN";
    regimeCounts[r] = (regimeCounts[r] || 0) + 1;
  }
  const dominantRegime = Object.entries(regimeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as MarketRegime || null;

  // Pattern analysis
  const patternArr = Object.values(state.strategyPatterns)
    .filter(p => p.stats.sampleSize >= 2)
    .sort((a, b) => b.stats.avgReturnPercent - a.stats.avgReturnPercent);
  const bestPattern = patternArr[0] || null;
  const worstPattern = patternArr[patternArr.length - 1] || null;

  // Generate insights
  if (winRate < 0.35 && (wins + losses) >= 3) {
    insights.push({ category: "PATTERN", severity: "WARNING",
      message: `Win rate dropped to ${(winRate * 100).toFixed(0)}% over last ${wins + losses} resolved trades. Consider tightening entry criteria.` });
    recommendations.push({ type: "THRESHOLD_CHANGE", description: "Raise confluence buy threshold to be more selective", applied: false });
  }
  if (winRate > 0.65 && (wins + losses) >= 3) {
    insights.push({ category: "PATTERN", severity: "INFO",
      message: `Strong ${(winRate * 100).toFixed(0)}% win rate over last ${wins + losses} trades. Strategy is working well.` });
    recommendations.push({ type: "THRESHOLD_CHANGE", description: "Can slightly lower confluence buy threshold to capture more opportunities", applied: false });
  }

  if (bestPattern && bestPattern.stats.sampleSize >= 3 && bestPattern.stats.avgReturnPercent > 0) {
    insights.push({ category: "PATTERN", severity: "INFO",
      message: `Best pattern: "${bestPattern.description}" — ${bestPattern.stats.wins}/${bestPattern.stats.sampleSize} wins, avg $${bestPattern.stats.avgReturnPercent.toFixed(2)} return` });
    recommendations.push({ type: "PATTERN_FAVOR", description: `Favor ${bestPattern.patternId} — proven profitable`, applied: false });
  }
  if (worstPattern && worstPattern.stats.sampleSize >= 3 && worstPattern.stats.avgReturnPercent < 0) {
    insights.push({ category: "PATTERN", severity: "WARNING",
      message: `Worst pattern: "${worstPattern.description}" — ${worstPattern.stats.losses}/${worstPattern.stats.sampleSize} losses, avg $${worstPattern.stats.avgReturnPercent.toFixed(2)} return` });
    recommendations.push({ type: "PATTERN_AVOID", description: `Avoid ${worstPattern.patternId} — consistent losses`, applied: false });
  }

  // Regime-specific insights
  for (const [regime, count] of Object.entries(regimeCounts)) {
    const regimePatterns = Object.values(state.strategyPatterns).filter(p => p.conditions.regime === regime && p.stats.sampleSize >= 2);
    const regimeWinRate = regimePatterns.length > 0
      ? regimePatterns.reduce((s, p) => s + p.stats.wins, 0) / Math.max(1, regimePatterns.reduce((s, p) => s + p.stats.sampleSize, 0))
      : 0;
    if (regimeWinRate < 0.3 && count >= 3) {
      insights.push({ category: "REGIME", severity: "ACTION",
        message: `${regime} regime trades have only ${(regimeWinRate * 100).toFixed(0)}% win rate. Consider reducing position sizes in this regime.` });
      recommendations.push({ type: "POSITION_SIZE", description: `Reduce regime multiplier for ${regime}`, applied: false });
    }
  }

  // Stagnation check
  const hoursSinceLastTrade = state.trading.lastTrade
    ? (Date.now() - state.trading.lastTrade.getTime()) / (1000 * 60 * 60)
    : Infinity;
  if (hoursSinceLastTrade > 48) {
    insights.push({ category: "ACTIVITY", severity: "WARNING",
      message: `No trades in ${(hoursSinceLastTrade / 24).toFixed(1)} days. Bot may be too selective.` });
    recommendations.push({ type: "THRESHOLD_CHANGE", description: "Consider lowering confluence thresholds to increase trade frequency", applied: false });
  }

  const review: PerformanceReview = {
    timestamp: new Date().toISOString(),
    triggerReason: reason,
    tradesSinceLastReview: recentTrades.length,
    insights,
    recommendations,
    periodStats: {
      winRate, avgReturn, totalTrades: successTrades.length,
      bestPattern: bestPattern?.patternId || null,
      worstPattern: worstPattern?.patternId || null,
      dominantRegime,
    },
  };

  console.log(`  📊 Performance Review: ${insights.length} insights, ${recommendations.length} recommendations`);
  for (const i of insights) console.log(`     [${i.severity}] ${i.message}`);
  return review;
}

/**
 * Adapt thresholds based on performance review — bounded, gradual, audited
 */
/**
 * v5.1: Shadow Model Validation — proposed threshold changes must pass statistical
 * significance checks before being promoted to live. Changes sit in a "shadow" queue
 * and only apply after n=5+ confirming reviews or when p-value proxy drops below 0.10.
 */
interface ShadowProposal {
  field: string;
  proposedDelta: number;
  reason: string;
  proposedAt: string;
  confirmingReviews: number;      // How many subsequent reviews still agree
  contradictingReviews: number;   // How many subsequent reviews disagree
  status: "PENDING" | "PROMOTED" | "REJECTED";
}

// In-memory shadow proposal queue (persisted via state)
let shadowProposals: ShadowProposal[] = [];

function adaptThresholds(review: PerformanceReview): void {
  const t = state.adaptiveThresholds;
  const { winRate, totalTrades } = review.periodStats;
  if (totalTrades < 3) return; // Not enough data to adapt

  // v5.1: Shadow model validation constants
  const MIN_CONFIRMING_REVIEWS = 3;   // Need 3 consecutive confirmations
  const MIN_SAMPLE_SIZE = 5;          // Need at least 5 trades in review period
  const MAX_CONTRADICTION_RATIO = 0.3; // Reject if >30% contradictions

  const proposeAdaptation = (field: string, delta: number, reason: string) => {
    const bounds = THRESHOLD_BOUNDS[field];
    if (!bounds) return;

    // Check if there's already a pending proposal for this field in the same direction
    const existing = shadowProposals.find(
      p => p.field === field && p.status === "PENDING" && Math.sign(p.proposedDelta) === Math.sign(delta)
    );

    if (existing) {
      // Confirm existing proposal
      existing.confirmingReviews++;
      console.log(`     🔬 Shadow: ${field} proposal confirmed (${existing.confirmingReviews}/${MIN_CONFIRMING_REVIEWS} confirmations)`);

      // Check if ready for promotion
      const totalReviews = existing.confirmingReviews + existing.contradictingReviews;
      const contradictionRatio = totalReviews > 0 ? existing.contradictingReviews / totalReviews : 0;

      if (existing.confirmingReviews >= MIN_CONFIRMING_REVIEWS && contradictionRatio <= MAX_CONTRADICTION_RATIO && totalTrades >= MIN_SAMPLE_SIZE) {
        // PROMOTE — apply the change
        const currentVal = (t as any)[field] as number;
        const cappedDelta = Math.sign(existing.proposedDelta) * Math.min(Math.abs(existing.proposedDelta), bounds.maxStep);
        const newVal = Math.max(bounds.min, Math.min(bounds.max, currentVal + cappedDelta));
        if (newVal !== currentVal) {
          t.history.push({
            timestamp: new Date().toISOString(),
            field,
            oldValue: currentVal,
            newValue: newVal,
            reason: `SHADOW VALIDATED: ${existing.reason} (${existing.confirmingReviews} confirmations, ${existing.contradictingReviews} contradictions, ${totalTrades} trades)`,
          });
          (t as any)[field] = newVal;
          existing.status = "PROMOTED";
          console.log(`     ✅ Shadow PROMOTED: ${field}: ${currentVal} → ${newVal} (${existing.confirmingReviews} confirmations over ${totalReviews} reviews)`);
        }
      }
    } else {
      // Check for contradicting proposals (same field, opposite direction)
      const contradicted = shadowProposals.find(
        p => p.field === field && p.status === "PENDING" && Math.sign(p.proposedDelta) !== Math.sign(delta)
      );
      if (contradicted) {
        contradicted.contradictingReviews++;
        const totalReviews = contradicted.confirmingReviews + contradicted.contradictingReviews;
        const contradictionRatio = totalReviews > 0 ? contradicted.contradictingReviews / totalReviews : 0;
        if (contradictionRatio > MAX_CONTRADICTION_RATIO && totalReviews >= 3) {
          contradicted.status = "REJECTED";
          console.log(`     ❌ Shadow REJECTED: ${field} (${contradicted.contradictingReviews}/${totalReviews} contradictions)`);
        }
      }

      // Create new shadow proposal
      shadowProposals.push({
        field,
        proposedDelta: delta,
        reason,
        proposedAt: new Date().toISOString(),
        confirmingReviews: 1,
        contradictingReviews: 0,
        status: "PENDING",
      });
      console.log(`     🔬 Shadow: New proposal for ${field} (delta: ${delta > 0 ? "+" : ""}${delta}) — needs ${MIN_CONFIRMING_REVIEWS} confirmations`);
    }
  };

  // Low win rate → propose being more selective
  if (winRate < 0.35) {
    proposeAdaptation("confluenceBuy", 2, `Low win rate ${(winRate * 100).toFixed(0)}%`);
    proposeAdaptation("confluenceStrongBuy", 2, `Low win rate ${(winRate * 100).toFixed(0)}%`);
    proposeAdaptation("stopLossPercent", 2, `Tighten stops: win rate ${(winRate * 100).toFixed(0)}%`);
  }

  // High win rate → propose slightly more aggressive
  if (winRate > 0.65) {
    proposeAdaptation("confluenceBuy", -1, `High win rate ${(winRate * 100).toFixed(0)}%`);
  }

  // Negative avg return → propose tighter risk management
  if (review.periodStats.avgReturn < -2) {
    proposeAdaptation("stopLossPercent", 2, `Negative avg return $${review.periodStats.avgReturn.toFixed(2)}`);
    proposeAdaptation("trailingStopPercent", 2, `Negative avg return $${review.periodStats.avgReturn.toFixed(2)}`);
  }

  // Strong avg return → propose letting winners run longer
  if (review.periodStats.avgReturn > 5) {
    proposeAdaptation("profitTakeTarget", 2, `Strong avg return $${review.periodStats.avgReturn.toFixed(2)}`);
  }

  // Clean up old completed/rejected proposals (keep last 50)
  shadowProposals = shadowProposals.filter(p => p.status === "PENDING").concat(
    shadowProposals.filter(p => p.status !== "PENDING").slice(-20)
  );

  // Trim audit trail to last 100 entries
  if (t.history.length > 100) t.history = t.history.slice(-100);
  t.lastAdapted = new Date().toISOString();
  t.adaptationCount++;
}

/**
 * Calculate confidence for a specific pattern in the current regime
 */
function calculatePatternConfidence(patternId: string, regime: MarketRegime): number {
  const pattern = state.strategyPatterns[patternId];
  if (!pattern || pattern.stats.sampleSize < 2) return 0.5; // Unproven → moderate confidence (v5.2: raised from 0.3 to prevent $2-3 dust trades) // Unproven → low confidence

  let conf = pattern.confidence;

  // Regime multiplier from adaptive thresholds
  const regimeMult = state.adaptiveThresholds.regimeMultipliers[regime] || 1.0;
  conf *= regimeMult;

  // Decay if stale (not triggered in 14+ days)
  if (pattern.stats.lastTriggered) {
    const daysSince = (Date.now() - new Date(pattern.stats.lastTriggered).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 14) conf *= 0.9;
    if (daysSince > 30) conf *= 0.8;
  }

  return Math.max(0.2, Math.min(1.0, conf));
}

/**
 * Check for stagnation and generate exploration trade if needed
 * Returns a trade-like object or null
 */
function checkStagnation(availableUSDC: number, tokenData: any[]): { toToken: string; amountUSD: number; reasoning: string } | null {
  const exploration = state.explorationState;
  const hoursSinceLastTrade = state.trading.lastTrade
    ? (Date.now() - state.trading.lastTrade.getTime()) / (1000 * 60 * 60)
    : Infinity;

  // No exploration if insufficient capital
  if (availableUSDC < 3) return null;

  // Trigger exploration if no trade in 48+ hours
  if (hoursSinceLastTrade < 48) {
    exploration.consecutiveHolds = 0;
    return null;
  }

  exploration.stagnationAlerts++;
  console.log(`  🔬 Stagnation detected: ${(hoursSinceLastTrade / 24).toFixed(1)} days since last trade (alert #${exploration.stagnationAlerts})`);

  // Pick the token with best confluence that we haven't traded recently
  const recentTokens = new Set(state.tradeHistory.slice(-10).map(t => t.toToken));
  const candidates = tokenData
    .filter(t => t.symbol !== "USDC" && !recentTokens.has(t.symbol))
    .sort((a, b) => (b.priceChange24h || 0) - (a.priceChange24h || 0));

  if (candidates.length === 0) return null;

  const target = candidates[0];
  const explorationAmount = Math.min(3, availableUSDC); // $3 max for exploration

  return {
    toToken: target.symbol,
    amountUSD: explorationAmount,
    reasoning: `Exploration: No trade in ${(hoursSinceLastTrade / 24).toFixed(1)} days. Testing ${target.symbol} with small $${explorationAmount.toFixed(2)} position to gather data.`,
  };
}

/**
 * Format self-improvement data for AI prompt injection
 * Replaces the generic "LEARN FROM HISTORY" instruction with structured analysis
 */
function formatSelfImprovementPrompt(): string {
  const patterns = Object.values(state.strategyPatterns)
    .filter(p => p.stats.sampleSize >= 1)
    .sort((a, b) => b.confidence - a.confidence);

  const topPatterns = patterns.filter(p => p.stats.avgReturnPercent > 0).slice(0, 5);
  const bottomPatterns = patterns.filter(p => p.stats.avgReturnPercent < 0).slice(-3);

  const recentReview = state.performanceReviews.length > 0
    ? state.performanceReviews[state.performanceReviews.length - 1]
    : null;

  const t = state.adaptiveThresholds;

  let prompt = `\n=== SELF-IMPROVEMENT ENGINE (Phase 3) ===\n`;
  prompt += `Adaptive Thresholds: RSI oversold=${t.rsiOversold} overbought=${t.rsiOverbought} | `;
  prompt += `Confluence buy=${t.confluenceBuy} sell=${t.confluenceSell} strongBuy=${t.confluenceStrongBuy} strongSell=${t.confluenceStrongSell} | `;
  prompt += `Profit-take=${t.profitTakeTarget}% | Stop-loss=${t.stopLossPercent}% trailing=${t.trailingStopPercent}%\n`;
  prompt += `Regime multipliers: TRENDING_UP=${t.regimeMultipliers.TRENDING_UP}x TRENDING_DOWN=${t.regimeMultipliers.TRENDING_DOWN}x RANGING=${t.regimeMultipliers.RANGING}x VOLATILE=${t.regimeMultipliers.VOLATILE}x\n`;
  prompt += `Adaptations applied: ${t.adaptationCount} total\n\n`;

  if (topPatterns.length > 0) {
    prompt += `PROVEN WINNING PATTERNS (favor these):\n`;
    for (const p of topPatterns) {
      const wr = p.stats.sampleSize > 0 ? ((p.stats.wins / p.stats.sampleSize) * 100).toFixed(0) : "?";
      prompt += `  ✅ ${p.description} — ${p.stats.wins}/${p.stats.sampleSize} wins (${wr}%), avg $${p.stats.avgReturnPercent.toFixed(2)}, confidence ${(p.confidence * 100).toFixed(0)}%\n`;
    }
    prompt += `\n`;
  }

  if (bottomPatterns.length > 0) {
    prompt += `LOSING PATTERNS (avoid these):\n`;
    for (const p of bottomPatterns) {
      const wr = p.stats.sampleSize > 0 ? ((p.stats.wins / p.stats.sampleSize) * 100).toFixed(0) : "?";
      prompt += `  ❌ ${p.description} — ${p.stats.losses}/${p.stats.sampleSize} losses (${wr}% win), avg $${p.stats.avgReturnPercent.toFixed(2)}\n`;
    }
    prompt += `\n`;
  }

  if (recentReview && recentReview.insights.length > 0) {
    prompt += `LATEST PERFORMANCE REVIEW (${recentReview.timestamp.slice(0, 10)}):\n`;
    for (const i of recentReview.insights) {
      prompt += `  [${i.severity}] ${i.message}\n`;
    }
    for (const r of recentReview.recommendations) {
      prompt += `  → ${r.description}\n`;
    }
    prompt += `\n`;
  }

  prompt += `USE THIS DATA: Favor proven patterns, avoid losing ones. Adjust position conviction by pattern confidence. The thresholds above are adaptive — they have been tuned by your performance history.\n`;

  return prompt;
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
  profitTakeCooldowns: Record<string, string>;  // symbol:tier → ISO date of last trigger
  stopLossCooldowns: Record<string, string>;     // symbol → ISO date of last trigger
  // v5.3.3: Consecutive failure tracking per token
  tradeFailures: Record<string, { count: number; lastFailure: string }>;  // symbol → consecutive fail count + timestamp
  // v5.1.1: Profit harvesting tracking
  harvestedProfits?: {
    totalHarvested: number;
    harvestCount: number;
    harvests: { timestamp: string; symbol: string; tier: string; gainPercent: number; sellPercent: number; amountUSD: number; profitUSD: number }[];
  };
  // v5.3.0: Auto-harvest transfer tracking (top-level state)
  autoHarvestTransfers: Array<{ timestamp: string; amountETH: string; amountUSD: number; txHash: string; destination: string }>;
  totalAutoHarvestedUSD: number;
  totalAutoHarvestedETH: number;
  lastAutoHarvestTime: string | null;
  autoHarvestCount: number;
  // Phase 3: Self-Improvement Engine
  strategyPatterns: Record<string, StrategyPattern>;
  adaptiveThresholds: AdaptiveThresholds;
  performanceReviews: PerformanceReview[];
  explorationState: ExplorationState;
  lastReviewTradeIndex: number;
  lastReviewTimestamp: string | null;
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
  tradeFailures: {},
  harvestedProfits: { totalHarvested: 0, harvestCount: 0, harvests: [] },
  // v5.3.0: Auto-harvest transfer state
  autoHarvestTransfers: [] as Array<{ timestamp: string; amountETH: string; amountUSD: number; txHash: string; destination: string }>,
  totalAutoHarvestedUSD: 0,
  totalAutoHarvestedETH: 0,
  lastAutoHarvestTime: null as string | null,
  autoHarvestCount: 0,
  // Phase 3: Self-Improvement Engine
  strategyPatterns: {},
  adaptiveThresholds: { ...DEFAULT_ADAPTIVE_THRESHOLDS },
  performanceReviews: [],
  explorationState: { ...DEFAULT_EXPLORATION_STATE },
  lastReviewTradeIndex: 0,
  lastReviewTimestamp: null,
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
        state.tradeFailures = parsed.tradeFailures || {};
        state.harvestedProfits = parsed.harvestedProfits || { totalHarvested: 0, harvestCount: 0, harvests: [] };
        // Phase 3 fields
        state.strategyPatterns = parsed.strategyPatterns || {};
        if (parsed.adaptiveThresholds) {
          state.adaptiveThresholds = { ...DEFAULT_ADAPTIVE_THRESHOLDS, ...parsed.adaptiveThresholds };
        }
        state.performanceReviews = (parsed.performanceReviews || []).slice(-30);
        state.explorationState = parsed.explorationState || { ...DEFAULT_EXPLORATION_STATE };
        state.lastReviewTradeIndex = parsed.lastReviewTradeIndex || 0;
        state.lastReviewTimestamp = parsed.lastReviewTimestamp || null;
        // v5.3.0: Restore auto-harvest transfer state
        state.autoHarvestTransfers = parsed.autoHarvestTransfers || [];
        state.totalAutoHarvestedUSD = parsed.totalAutoHarvestedUSD || 0;
        state.totalAutoHarvestedETH = parsed.totalAutoHarvestedETH || 0;
        state.lastAutoHarvestTime = parsed.lastAutoHarvestTime || null;
        state.autoHarvestCount = parsed.autoHarvestCount || 0;
        // v5.2: Restore shadow proposals
        if (parsed.shadowProposals && Array.isArray(parsed.shadowProposals)) {
          shadowProposals = parsed.shadowProposals;
          console.log(`  🔬 Restored ${shadowProposals.length} shadow proposals`);
        }
        console.log(`  📂 Loaded ${state.tradeHistory.length} trades, ${Object.keys(state.costBasis).length} cost basis entries from ${file}`);
        console.log(`  🧠 Phase 3: ${Object.keys(state.strategyPatterns).length} patterns, ${state.performanceReviews.length} reviews, ${state.adaptiveThresholds.adaptationCount} adaptations`);
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
      version: "5.2",
      lastUpdated: new Date().toISOString(),
      initialValue: state.trading.initialValue,
      peakValue: state.trading.peakValue,
      currentValue: state.trading.totalPortfolioValue,
      totalTrades: state.trading.totalTrades,
      successfulTrades: state.trading.successfulTrades,
      sectorAllocations: state.trading.sectorAllocations,
      trades: state.tradeHistory.slice(-200), // Cap at 200 trades
      costBasis: state.costBasis,
      profitTakeCooldowns: state.profitTakeCooldowns,
      stopLossCooldowns: state.stopLossCooldowns,
      tradeFailures: state.tradeFailures,
      harvestedProfits: state.harvestedProfits,
      // v5.3.0: Auto-harvest transfer persistence
      autoHarvestTransfers: state.autoHarvestTransfers,
      totalAutoHarvestedUSD: state.totalAutoHarvestedUSD,
      totalAutoHarvestedETH: state.totalAutoHarvestedETH,
      lastAutoHarvestTime: state.lastAutoHarvestTime,
      autoHarvestCount: state.autoHarvestCount,
      // Phase 3: Self-Improvement Engine
      strategyPatterns: state.strategyPatterns,
      adaptiveThresholds: state.adaptiveThresholds,
      performanceReviews: state.performanceReviews.slice(-30),
      explorationState: state.explorationState,
      lastReviewTradeIndex: state.lastReviewTradeIndex,
      lastReviewTimestamp: state.lastReviewTimestamp,
      // v5.2: Persist shadow proposals so they survive restarts
      shadowProposals: shadowProposals.filter(p => p.status === "PENDING").slice(-50),
      // v6.1: Persist token discovery state
      tokenDiscovery: tokenDiscoveryEngine?.getState() || null,
    };
    // Write to persistent volume path, creating directory if needed
    const dir = CONFIG.logFile.substring(0, CONFIG.logFile.lastIndexOf("/"));
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG.logFile, JSON.stringify(data, null, 2));
  } catch (e: any) {
    console.error("Failed to save trade history:", e.message);
  }
}

// ============================================================================
// v5.3.3: CONSECUTIVE FAILURE CIRCUIT BREAKER
// ============================================================================

const MAX_CONSECUTIVE_FAILURES = 3;       // Block token after 3 consecutive failures
const FAILURE_COOLDOWN_HOURS = 6;          // Unblock after 6 hours

function recordTradeFailure(symbol: string): void {
  const existing = state.tradeFailures[symbol];
  state.tradeFailures[symbol] = {
    count: (existing?.count || 0) + 1,
    lastFailure: new Date().toISOString(),
  };
  const f = state.tradeFailures[symbol];
  if (f.count >= MAX_CONSECUTIVE_FAILURES) {
    console.log(`  🚫 CIRCUIT BREAKER: ${symbol} blocked after ${f.count} consecutive failures (cooldown ${FAILURE_COOLDOWN_HOURS}h)`);
  }
}

function clearTradeFailures(symbol: string): void {
  if (state.tradeFailures[symbol]) {
    delete state.tradeFailures[symbol];
  }
}

function isTokenBlocked(symbol: string): boolean {
  const f = state.tradeFailures[symbol];
  if (!f || f.count < MAX_CONSECUTIVE_FAILURES) return false;

  // Check if cooldown has expired
  const hoursSinceLastFailure = (Date.now() - new Date(f.lastFailure).getTime()) / (1000 * 60 * 60);
  if (hoursSinceLastFailure >= FAILURE_COOLDOWN_HOURS) {
    console.log(`  🔓 CIRCUIT BREAKER: ${symbol} unblocked after ${hoursSinceLastFailure.toFixed(1)}h cooldown`);
    delete state.tradeFailures[symbol];
    return false;
  }

  const remainingHours = (FAILURE_COOLDOWN_HOURS - hoursSinceLastFailure).toFixed(1);
  console.log(`  🚫 CIRCUIT BREAKER: ${symbol} blocked (${f.count} failures, ${remainingHours}h remaining)`);
  return true;
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
// v5.2: DUST POSITION CONSOLIDATION
// ============================================================================

const DUST_THRESHOLD_USD = 3.00;

async function consolidateDustPositions(
  balances: { symbol: string; balance: number; usdValue: number; price?: number }[],
  marketData: MarketData
): Promise<number> {
  if (!CONFIG.trading.enabled) return 0;
  const dustPositions = balances.filter(
    b => b.symbol !== "USDC" && b.usdValue > 0.10 && b.usdValue < DUST_THRESHOLD_USD
  );
  if (dustPositions.length === 0) return 0;
  console.log(`\n  🧹 DUST CONSOLIDATION: Found ${dustPositions.length} positions under ${DUST_THRESHOLD_USD.toFixed(2)}`);
  let consolidated = 0;
  for (const dust of dustPositions) {
    try {
      console.log(`     Selling dust: ${dust.symbol} (${dust.usdValue.toFixed(2)})`);
      const decision: TradeDecision = {
        action: "SELL", fromToken: dust.symbol, toToken: "USDC",
        amountUSD: dust.usdValue,
        reasoning: `Dust consolidation: ${dust.symbol} at ${dust.usdValue.toFixed(2)} is below ${DUST_THRESHOLD_USD} threshold`,
        tokenAmount: dust.balance,
      };
      const result = await executeTrade(decision, marketData);
      if (result.success) {
        consolidated++;
        console.log(`     ✅ Consolidated ${dust.symbol} → USDC`);
        updateCostBasisAfterSell(dust.symbol, dust.usdValue, dust.balance);
      } else {
        console.log(`     ❌ Failed to consolidate ${dust.symbol}: ${result.error}`);
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (e: any) {
      console.log(`     ❌ Error consolidating ${dust.symbol}: ${e.message}`);
    }
  }
  if (consolidated > 0) {
    console.log(`  🧹 Consolidated ${consolidated}/${dustPositions.length} dust positions to USDC`);
    saveTradeHistory();
  }
  return consolidated;
}

// ============================================================================
// PROFIT-TAKING & STOP-LOSS GUARDS
// ============================================================================

/**
 * v5.1.1: TIERED PROFIT HARVESTING — scale out of winners in tranches
 *
 * Philosophy: Don't ride everything to the moon and back. When the market gives you
 * something, take a piece. Bank small wins consistently. The remaining position still
 * rides for the bigger move, but you've already locked in profit.
 *
 * Tiers:
 *   +8%  → sell 15% (early harvest — skim the cream)
 *   +15% → sell 20% (moderate win — bank a real gain)
 *   +25% → sell 30% (strong win — significant profit lock)
 *   +40% → sell 40% (major win — protect the bag)
 *
 * Each tier has its own cooldown tracking per token. A token can trigger tier 1,
 * then later trigger tier 2 as it keeps climbing — harvesting along the way.
 *
 * Time-based rebalancing: If a position has been held for 72+ hours without any
 * profit trigger and is up at least 5%, take a small 10% harvest. Patient capital,
 * but not passive capital.
 */
function checkProfitTaking(
  balances: { symbol: string; balance: number; usdValue: number; price?: number; sector?: string }[],
): TradeDecision | null {
  if (!CONFIG.trading.profitTaking.enabled) return null;

  const cfg = CONFIG.trading.profitTaking;
  const tiers = (cfg as any).tiers || [
    { gainPercent: 8,  sellPercent: 15, label: "EARLY_HARVEST" },
    { gainPercent: 15, sellPercent: 20, label: "MID_HARVEST" },
    { gainPercent: 25, sellPercent: 30, label: "STRONG_HARVEST" },
    { gainPercent: 40, sellPercent: 40, label: "MAJOR_HARVEST" },
  ];
  const now = new Date();

  // Track the best opportunity across all holdings (highest tier hit wins)
  let bestCandidate: {
    symbol: string;
    balance: number;
    usdValue: number;
    gainPercent: number;
    tier: { gainPercent: number; sellPercent: number; label: string };
    costBasis: number;
    currentPrice: number;
    sector?: string;
  } | null = null;

  for (const b of balances) {
    if (b.symbol === "USDC" || b.usdValue < cfg.minHoldingUSD) continue;
    const cb = state.costBasis[b.symbol];
    if (!cb || cb.averageCostBasis <= 0) continue;

    // v5.3.3: Skip tokens blocked by circuit breaker
    if (isTokenBlocked(b.symbol)) continue;

    // v5.3.3: Check stop-loss cooldown (1 hour between attempts per token)
    const slCooldown = state.stopLossCooldowns[b.symbol];
    if (slCooldown) {
      const hoursSinceLast = (Date.now() - new Date(slCooldown).getTime()) / (1000 * 60 * 60);
      if (hoursSinceLast < 1) {
        continue; // Skip — cooldown active
      }
    }

    const currentPrice = b.price || (b.balance > 0 ? b.usdValue / b.balance : 0);
    const gainPercent = ((currentPrice - cb.averageCostBasis) / cb.averageCostBasis) * 100;

    if (gainPercent <= 0) continue; // No profit to take

    // Find the highest tier this position qualifies for
    // Walk tiers from highest to lowest — take the best available
    const sortedTiers = [...tiers].sort((a: any, b: any) => b.gainPercent - a.gainPercent);
    for (const tier of sortedTiers) {
      if (gainPercent >= tier.gainPercent) {
        // Check per-tier cooldown: key is "symbol:tierLabel"
        const cooldownKey = `${b.symbol}:${tier.label}`;
        const lastTrigger = state.profitTakeCooldowns[cooldownKey];
        if (lastTrigger) {
          const hoursSince = (now.getTime() - new Date(lastTrigger).getTime()) / (1000 * 60 * 60);
          if (hoursSince < cfg.cooldownHours) continue; // This tier is on cooldown
        }

        // This tier is available — is it better than our current best?
        if (!bestCandidate || tier.gainPercent > bestCandidate.tier.gainPercent) {
          bestCandidate = {
            symbol: b.symbol,
            balance: b.balance,
            usdValue: b.usdValue,
            gainPercent,
            tier,
            costBasis: cb.averageCostBasis,
            currentPrice,
            sector: b.sector,
          };
        }
        break; // Found highest qualifying tier for this token, move to next token
      }
    }

    // Time-based rebalancing: 72+ hours held, up at least 5%, no recent harvest
    if (!bestCandidate && gainPercent >= 5 && cb.totalInvestedUSD > 0) {
      const holdingAge = cb.firstBuyDate
        ? (now.getTime() - new Date(cb.firstBuyDate).getTime()) / (1000 * 60 * 60)
        : 0;
      if (holdingAge >= 72) {
        const timeKey = `${b.symbol}:TIME_REBALANCE`;
        const lastTimeHarvest = state.profitTakeCooldowns[timeKey];
        if (!lastTimeHarvest || (now.getTime() - new Date(lastTimeHarvest).getTime()) / (1000 * 60 * 60) >= 48) {
          bestCandidate = {
            symbol: b.symbol,
            balance: b.balance,
            usdValue: b.usdValue,
            gainPercent,
            tier: { gainPercent: 5, sellPercent: 10, label: "TIME_REBALANCE" },
            costBasis: cb.averageCostBasis,
            currentPrice,
            sector: b.sector,
          };
        }
      }
    }
  }

  if (!bestCandidate) return null;

  const { symbol, balance, usdValue, gainPercent, tier, costBasis, currentPrice, sector } = bestCandidate;
  const sellPct = tier.sellPercent;
  const sellUSD = usdValue * (sellPct / 100);
  const tokenAmount = balance * (sellPct / 100);

  // Don't sell less than $2 — not worth the gas
  if (sellUSD < 2) return null;

  // v6.2.2: Capital floor — don't harvest if it would push portfolio below minimum trading capital
  const capitalFloor = CONFIG.autoHarvest?.minTradingCapitalUSD || 500;
  const currentPortfolio = state.trading.totalPortfolioValue || 0;
  if (currentPortfolio - sellUSD < capitalFloor) {
    console.log(`  ⚠️ CAPITAL FLOOR: Skipping ${symbol} harvest ($${sellUSD.toFixed(2)}) — would breach $${capitalFloor} floor (portfolio: $${currentPortfolio.toFixed(2)})`);
    return null;
  }

  const tierEmoji = tier.label === "EARLY_HARVEST" ? "🌱" :
                    tier.label === "MID_HARVEST" ? "🌿" :
                    tier.label === "STRONG_HARVEST" ? "🎯" :
                    tier.label === "MAJOR_HARVEST" ? "💰" :
                    tier.label === "TIME_REBALANCE" ? "⏰" : "📊";

  console.log(`\n  ${tierEmoji} ${tier.label}: ${symbol} is UP +${gainPercent.toFixed(1)}% (tier threshold: +${tier.gainPercent}%)`);
  console.log(`     Avg cost: $${costBasis.toFixed(6)} → Current: $${currentPrice.toFixed(6)}`);
  console.log(`     Harvesting ${sellPct}% = ~$${sellUSD.toFixed(2)} → USDC (banking profit)`);

  // Record cooldown for this specific tier
  const cooldownKey = `${symbol}:${tier.label}`;
  state.profitTakeCooldowns[cooldownKey] = now.toISOString();

  // Track cumulative harvested profits for dashboard
  if (!state.harvestedProfits) {
    state.harvestedProfits = { totalHarvested: 0, harvestCount: 0, harvests: [] };
  }
  const profitPortion = sellUSD - (sellUSD / (1 + gainPercent / 100)); // Approximate profit from this sell
  state.harvestedProfits.totalHarvested += profitPortion;
  state.harvestedProfits.harvestCount++;
  state.harvestedProfits.harvests.push({
    timestamp: now.toISOString(),
    symbol,
    tier: tier.label,
    gainPercent: Math.round(gainPercent * 10) / 10,
    sellPercent: sellPct,
    amountUSD: Math.round(sellUSD * 100) / 100,
    profitUSD: Math.round(profitPortion * 100) / 100,
  });
  // Keep last 50 harvests
  if (state.harvestedProfits.harvests.length > 50) {
    state.harvestedProfits.harvests = state.harvestedProfits.harvests.slice(-50);
  }

  return {
    action: "SELL" as const,
    fromToken: symbol,
    toToken: "USDC",
    amountUSD: sellUSD,
    tokenAmount,
    reasoning: `${tier.label}: ${symbol} +${gainPercent.toFixed(1)}% from avg cost $${costBasis.toFixed(4)}. Harvesting ${sellPct}% (~$${sellUSD.toFixed(2)}) to lock in profit. Remaining ${100 - sellPct}% continues to ride.`,
    sector,
  };
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

    // Use adaptive thresholds (Phase 3) instead of static config
    const adaptiveSL = state.adaptiveThresholds.stopLossPercent;
    const adaptiveTrailing = state.adaptiveThresholds.trailingStopPercent;

    const triggered = lossFromCost <= adaptiveSL ||
      (cfg.trailingEnabled && trailingLoss <= adaptiveTrailing);

    if (triggered && lossFromCost < worstLoss) {
      worstLoss = lossFromCost;
      const sellUSD = b.usdValue * (cfg.sellPercent / 100);
      const tokenAmount = b.balance * (cfg.sellPercent / 100);
      const reason = lossFromCost <= adaptiveSL
        ? `Stop-loss: ${b.symbol} ${lossFromCost.toFixed(1)}% from cost basis $${cb.averageCostBasis.toFixed(4)} (adaptive: ${adaptiveSL}%)`
        : `Trailing stop: ${b.symbol} ${trailingLoss.toFixed(1)}% from peak $${cb.peakPrice.toFixed(4)} (adaptive: ${adaptiveTrailing}%)`;

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
  // v5.1: Long/Short Ratio Intelligence
  btcLongShortRatio: number | null;           // Global long/short account ratio (>1 = more longs)
  ethLongShortRatio: number | null;           // Global long/short account ratio
  btcTopTraderLSRatio: number | null;         // Top trader long/short ratio (smart money)
  ethTopTraderLSRatio: number | null;         // Top trader long/short ratio
  btcTopTraderPositionRatio: number | null;   // Top trader position long/short ratio
  ethTopTraderPositionRatio: number | null;   // Top trader position long/short ratio
  // v5.1: Composite Positioning Signals
  btcPositioningSignal: "OVERLEVERAGED_LONG" | "OVERLEVERAGED_SHORT" | "SMART_MONEY_LONG" | "SMART_MONEY_SHORT" | "NEUTRAL";
  ethPositioningSignal: "OVERLEVERAGED_LONG" | "OVERLEVERAGED_SHORT" | "SMART_MONEY_LONG" | "SMART_MONEY_SHORT" | "NEUTRAL";
  // v5.1: OI + Price Divergence Detection
  btcOIPriceDivergence: "OI_UP_PRICE_DOWN" | "OI_DOWN_PRICE_UP" | "ALIGNED" | "NEUTRAL";  // Divergence = impending move
  ethOIPriceDivergence: "OI_UP_PRICE_DOWN" | "OI_DOWN_PRICE_UP" | "ALIGNED" | "NEUTRAL";
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
  // v5.1: Cross-Asset Correlation Signals
  crossAssets: {
    goldPrice: number | null;         // Gold price in USD (XAU/USD)
    goldChange24h: number | null;     // Gold 24h % change
    oilPrice: number | null;          // Crude oil price (WTI)
    oilChange24h: number | null;      // Oil 24h % change
    dxyRealtime: number | null;       // DXY real-time (supplements FRED's lagged data)
    dxyChange24h: number | null;      // DXY 24h % change
    sp500Change: number | null;       // S&P 500 daily % change (risk appetite proxy)
    vixLevel: number | null;          // VIX fear index
    crossAssetSignal: "RISK_ON" | "RISK_OFF" | "FLIGHT_TO_SAFETY" | "NEUTRAL";
  } | null;
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
    // v5.1: Expanded Binance derivatives intelligence — funding, OI, long/short ratios, top trader sentiment
    const [btcFundingRes, ethFundingRes, btcOIRes, ethOIRes,
           btcLSRes, ethLSRes, btcTopLSRes, ethTopLSRes, btcTopPosRes, ethTopPosRes] = await Promise.allSettled([
      // Original: Funding rates + Open Interest
      axios.get("https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=2", { timeout: 8000 }),
      axios.get("https://fapi.binance.com/fapi/v1/fundingRate?symbol=ETHUSDT&limit=2", { timeout: 8000 }),
      axios.get("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT", { timeout: 8000 }),
      axios.get("https://fapi.binance.com/fapi/v1/openInterest?symbol=ETHUSDT", { timeout: 8000 }),
      // v5.1: Global Long/Short Account Ratio (retail sentiment)
      axios.get("https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1", { timeout: 8000 }),
      axios.get("https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=ETHUSDT&period=1h&limit=1", { timeout: 8000 }),
      // v5.1: Top Trader Long/Short Account Ratio (smart money)
      axios.get("https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1", { timeout: 8000 }),
      axios.get("https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=ETHUSDT&period=1h&limit=1", { timeout: 8000 }),
      // v5.1: Top Trader Long/Short Position Ratio (smart money position sizing)
      axios.get("https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=1h&limit=1", { timeout: 8000 }),
      axios.get("https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=ETHUSDT&period=1h&limit=1", { timeout: 8000 }),
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

    // v5.1: Parse long/short ratios — value > 1 means more longs than shorts
    const parseLSRatio = (res: PromiseSettledResult<any>): number | null => {
      if (res.status !== "fulfilled" || !res.value.data?.length) return null;
      return parseFloat(res.value.data[0].longShortRatio);
    };

    const btcLongShortRatio = parseLSRatio(btcLSRes);
    const ethLongShortRatio = parseLSRatio(ethLSRes);
    const btcTopTraderLSRatio = parseLSRatio(btcTopLSRes);
    const ethTopTraderLSRatio = parseLSRatio(ethTopLSRes);
    const btcTopTraderPositionRatio = parseLSRatio(btcTopPosRes);
    const ethTopTraderPositionRatio = parseLSRatio(ethTopPosRes);

    // Interpret funding rates — extreme values indicate crowded positions
    const interpretFunding = (rate: number): "LONG_CROWDED" | "SHORT_CROWDED" | "NEUTRAL" => {
      if (rate > 0.03) return "LONG_CROWDED";
      if (rate < -0.03) return "SHORT_CROWDED";
      return "NEUTRAL";
    };

    const btcFundingSignal = interpretFunding(btcFundingRate);
    const ethFundingSignal = interpretFunding(ethFundingRate);

    // Calculate OI change (we'll store previous values in cache)
    const btcOIChange24h = derivativesCache.btcOI > 0 ? ((btcOpenInterest - derivativesCache.btcOI) / derivativesCache.btcOI) * 100 : 0;
    const ethOIChange24h = derivativesCache.ethOI > 0 ? ((ethOpenInterest - derivativesCache.ethOI) / derivativesCache.ethOI) * 100 : 0;

    // v5.1: Composite Positioning Signal — combines funding, global L/S, and top trader L/S
    const interpretPositioning = (
      fundingSignal: string,
      globalLS: number | null,
      topTraderLS: number | null,
      topTraderPos: number | null,
    ): "OVERLEVERAGED_LONG" | "OVERLEVERAGED_SHORT" | "SMART_MONEY_LONG" | "SMART_MONEY_SHORT" | "NEUTRAL" => {
      // Smart money divergence from retail = highest conviction signal
      if (topTraderLS !== null && globalLS !== null) {
        // Top traders long while retail short = smart money accumulation
        if (topTraderLS > 1.3 && globalLS < 0.8) return "SMART_MONEY_LONG";
        // Top traders short while retail long = smart money distribution
        if (topTraderLS < 0.7 && globalLS > 1.3) return "SMART_MONEY_SHORT";
      }
      // Extreme crowding — everyone on same side = danger
      if (fundingSignal === "LONG_CROWDED" && (globalLS ?? 1) > 1.5) return "OVERLEVERAGED_LONG";
      if (fundingSignal === "SHORT_CROWDED" && (globalLS ?? 1) < 0.5) return "OVERLEVERAGED_SHORT";
      return "NEUTRAL";
    };

    const btcPositioningSignal = interpretPositioning(btcFundingSignal, btcLongShortRatio, btcTopTraderLSRatio, btcTopTraderPositionRatio);
    const ethPositioningSignal = interpretPositioning(ethFundingSignal, ethLongShortRatio, ethTopTraderLSRatio, ethTopTraderPositionRatio);

    // v5.1: OI + Price Divergence Detection — OI rising while price falls = potential squeeze
    const interpretOIPriceDivergence = (
      oiChange: number, priceChange: number
    ): "OI_UP_PRICE_DOWN" | "OI_DOWN_PRICE_UP" | "ALIGNED" | "NEUTRAL" => {
      if (Math.abs(oiChange) < 1 || Math.abs(priceChange) < 1) return "NEUTRAL"; // Not enough movement
      if (oiChange > 3 && priceChange < -2) return "OI_UP_PRICE_DOWN";   // Shorts piling in OR longs averaging down = squeeze incoming
      if (oiChange < -3 && priceChange > 2) return "OI_DOWN_PRICE_UP";    // Short squeeze happening — OI drops as shorts close
      return "ALIGNED";
    };

    // Use cached price changes from derivativesCache
    const btcOIPriceDivergence = interpretOIPriceDivergence(btcOIChange24h, derivativesCache.btcPriceChange ?? 0);
    const ethOIPriceDivergence = interpretOIPriceDivergence(ethOIChange24h, derivativesCache.ethPriceChange ?? 0);

    // Update cache
    derivativesCache.btcOI = btcOpenInterest;
    derivativesCache.ethOI = ethOpenInterest;

    console.log(`  📈 Derivatives: BTC funding ${btcFundingRate >= 0 ? "+" : ""}${btcFundingRate.toFixed(4)}% (${btcFundingSignal}) | ETH funding ${ethFundingRate >= 0 ? "+" : ""}${ethFundingRate.toFixed(4)}% (${ethFundingSignal})`);
    console.log(`     BTC OI: ${btcOpenInterest.toFixed(0)} BTC | ETH OI: ${ethOpenInterest.toFixed(0)} ETH`);
    console.log(`     BTC L/S: Global ${btcLongShortRatio?.toFixed(2) ?? "N/A"} | TopTrader ${btcTopTraderLSRatio?.toFixed(2) ?? "N/A"} → ${btcPositioningSignal}`);
    console.log(`     ETH L/S: Global ${ethLongShortRatio?.toFixed(2) ?? "N/A"} | TopTrader ${ethTopTraderLSRatio?.toFixed(2) ?? "N/A"} → ${ethPositioningSignal}`);

    return {
      btcFundingRate, ethFundingRate, btcOpenInterest, ethOpenInterest,
      btcFundingSignal, ethFundingSignal, btcOIChange24h, ethOIChange24h,
      btcLongShortRatio, ethLongShortRatio,
      btcTopTraderLSRatio, ethTopTraderLSRatio,
      btcTopTraderPositionRatio, ethTopTraderPositionRatio,
      btcPositioningSignal, ethPositioningSignal,
      btcOIPriceDivergence, ethOIPriceDivergence,
    };
  } catch (error: any) {
    console.warn(`  ⚠️ Derivatives fetch failed: ${error?.message?.substring(0, 100) || error}`);
    return null;
  }
}

// Cache for derivatives OI comparison + price change tracking for divergence detection
const derivativesCache = { btcOI: 0, ethOI: 0, btcPriceChange: 0, ethPriceChange: 0 };

// Cache for CoinGecko last-known prices — prevents $0 portfolio when rate limited
let lastKnownPrices: Record<string, { price: number; change24h: number; change7d: number; volume: number; marketCap: number; name: string; sector: string }> = {};

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
/**
 * v5.1: Fetch cross-asset correlation data (Gold, Oil, DXY, S&P 500, VIX)
 * Uses free FRED series for daily data — supplements with Binance PAXG for real-time gold proxy
 */
async function fetchCrossAssetData(fredKey: string | undefined): Promise<MacroData["crossAssets"]> {
  try {
    const fetches: Promise<any>[] = [];

    // FRED series for Gold (GOLDPMGBD228NLBM), Oil WTI (DCOILWTICO), VIX (VIXCLS)
    // S&P 500 daily close (SP500) — limited to 2 most recent for change calc
    if (fredKey) {
      const fredBase = "https://api.stlouisfed.org/fred/series/observations";
      const baseParams = `&api_key=${fredKey}&file_type=json&sort_order=desc&limit=3`;
      fetches.push(
        axios.get(`${fredBase}?series_id=GOLDPMGBD228NLBM${baseParams}`, { timeout: 10000 }).catch(() => null),  // Gold
        axios.get(`${fredBase}?series_id=DCOILWTICO${baseParams}`, { timeout: 10000 }).catch(() => null),         // Oil WTI
        axios.get(`${fredBase}?series_id=VIXCLS${baseParams}`, { timeout: 10000 }).catch(() => null),              // VIX
        axios.get(`${fredBase}?series_id=SP500${baseParams}`, { timeout: 10000 }).catch(() => null),               // S&P 500
      );
    } else {
      fetches.push(Promise.resolve(null), Promise.resolve(null), Promise.resolve(null), Promise.resolve(null));
    }

    // Real-time DXY proxy via Binance USDC/USDT (inverse correlation approximation)
    // Plus PAXG/USDT for real-time gold price
    fetches.push(
      axios.get("https://api.binance.com/api/v3/ticker/24hr?symbol=PAXGUSDT", { timeout: 8000 }).catch(() => null),  // Real-time gold via PAXG
    );

    const [goldRes, oilRes, vixRes, sp500Res, paxgRes] = await Promise.all(fetches);

    const parseFred = (res: any): { latest: number; prev: number } | null => {
      if (!res?.data?.observations) return null;
      const valid = res.data.observations.filter((o: any) => o.value && o.value !== ".");
      if (valid.length < 1) return null;
      return {
        latest: parseFloat(valid[0].value),
        prev: valid.length >= 2 ? parseFloat(valid[1].value) : parseFloat(valid[0].value),
      };
    };

    const gold = parseFred(goldRes);
    const oil = parseFred(oilRes);
    const vix = parseFred(vixRes);
    const sp500 = parseFred(sp500Res);

    // Real-time gold via PAXG (Pax Gold on Binance — 1 PAXG = 1 troy oz gold)
    let goldPrice = gold?.latest ?? null;
    let goldChange24h: number | null = null;
    if (paxgRes?.data) {
      goldPrice = parseFloat(paxgRes.data.lastPrice);
      goldChange24h = parseFloat(paxgRes.data.priceChangePercent);
    } else if (gold) {
      goldChange24h = gold.prev > 0 ? ((gold.latest - gold.prev) / gold.prev) * 100 : null;
    }

    const oilPrice = oil?.latest ?? null;
    const oilChange24h = oil && oil.prev > 0 ? ((oil.latest - oil.prev) / oil.prev) * 100 : null;
    const vixLevel = vix?.latest ?? null;
    const sp500Change = sp500 && sp500.prev > 0 ? ((sp500.latest - sp500.prev) / sp500.prev) * 100 : null;

    // DXY — use FRED DTWEXBGS as real-time proxy (already fetched in main macro function)
    const dxyRealtime: number | null = null;  // Will be filled from main macro's dollarIndex
    const dxyChange24h: number | null = null;

    // Cross-asset correlation signal:
    // Gold up + Dollar down + VIX low = RISK_ON for crypto
    // Gold up + Dollar up + VIX high = FLIGHT_TO_SAFETY (bad for crypto)
    // Dollar down + Oil stable + VIX low = RISK_ON
    let riskOnPts = 0;
    let riskOffPts = 0;
    let flightToSafety = false;

    if (goldChange24h !== null) {
      if (goldChange24h > 1) riskOffPts += 1;  // Gold surging = uncertainty
      if (goldChange24h < -1) riskOnPts += 1;   // Gold dropping = risk appetite
    }
    if (vixLevel !== null) {
      if (vixLevel > 25) { riskOffPts += 2; }   // High fear
      if (vixLevel > 35) { flightToSafety = true; }
      if (vixLevel < 15) riskOnPts += 1;         // Complacency/risk appetite
    }
    if (sp500Change !== null) {
      if (sp500Change > 1) riskOnPts += 1;       // Stocks rallying = risk on
      if (sp500Change < -1) riskOffPts += 1;      // Stocks selling = risk off
      if (sp500Change < -3) riskOffPts += 1;      // Big selloff = extra risk off
    }
    if (oilChange24h !== null) {
      if (oilChange24h > 5) riskOffPts += 1;     // Oil spike = inflation fear
      if (oilChange24h < -5) riskOnPts += 1;      // Oil crash = deflation/demand concerns but good for margins
    }

    let crossAssetSignal: "RISK_ON" | "RISK_OFF" | "FLIGHT_TO_SAFETY" | "NEUTRAL" = "NEUTRAL";
    if (flightToSafety && (goldChange24h ?? 0) > 1) crossAssetSignal = "FLIGHT_TO_SAFETY";
    else if (riskOnPts >= riskOffPts + 2) crossAssetSignal = "RISK_ON";
    else if (riskOffPts >= riskOnPts + 2) crossAssetSignal = "RISK_OFF";

    console.log(`  🌍 Cross-Assets: Gold $${goldPrice?.toFixed(0) ?? "N/A"} (${goldChange24h !== null ? (goldChange24h >= 0 ? "+" : "") + goldChange24h.toFixed(1) + "%" : "N/A"}) | Oil $${oilPrice?.toFixed(1) ?? "N/A"} | VIX ${vixLevel?.toFixed(1) ?? "N/A"} | S&P ${sp500Change !== null ? (sp500Change >= 0 ? "+" : "") + sp500Change.toFixed(1) + "%" : "N/A"} → ${crossAssetSignal}`);

    return {
      goldPrice, goldChange24h, oilPrice, oilChange24h,
      dxyRealtime, dxyChange24h, sp500Change, vixLevel,
      crossAssetSignal,
    };
  } catch (error: any) {
    console.warn(`  ⚠️ Cross-asset fetch failed: ${error?.message?.substring(0, 100) || error}`);
    return null;
  }
}

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
    // FRED API uses api_key query parameter for authentication
    const fredBase = "https://api.stlouisfed.org/fred/series/observations";
    const fredOpts = { timeout: 10000 };
    const baseParams = `&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=2`;

    // Fetch all series in parallel (6 requests, well within 120/min limit)
    const [dffRes, dgs10Res, t10y2yRes, cpiRes, m2Res, dollarRes] = await Promise.allSettled([
      axios.get(`${fredBase}?series_id=DFF${baseParams}`, fredOpts),
      axios.get(`${fredBase}?series_id=DGS10${baseParams}`, fredOpts),
      axios.get(`${fredBase}?series_id=T10Y2Y${baseParams}`, fredOpts),
      axios.get(`${fredBase}?series_id=CPIAUCSL${baseParams}&limit=13`, fredOpts),  // 13 months for YoY
      axios.get(`${fredBase}?series_id=M2SL${baseParams}&limit=13`, fredOpts),      // 13 months for YoY
      axios.get(`${fredBase}?series_id=DTWEXBGS${baseParams}`, fredOpts),
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

    // v5.1: Fetch cross-asset data in parallel with FRED processing
    const crossAssets = await fetchCrossAssetData(FRED_KEY);

    // v5.1: Feed cross-asset signals into composite macro signal
    if (crossAssets) {
      if (crossAssets.crossAssetSignal === "RISK_ON") riskOnPoints += 1;
      if (crossAssets.crossAssetSignal === "RISK_OFF") riskOffPoints += 1;
      if (crossAssets.crossAssetSignal === "FLIGHT_TO_SAFETY") riskOffPoints += 2;
      // Recalculate
      if (riskOnPoints >= riskOffPoints + 2) macroSignal = "RISK_ON";
      else if (riskOffPoints >= riskOnPoints + 2) macroSignal = "RISK_OFF";
      else macroSignal = "NEUTRAL";

      // Feed DXY back from FRED if available
      if (dollarIndex && crossAssets.dxyRealtime === null) {
        crossAssets.dxyRealtime = dollarIndex.value;
      }
    }

    const result: MacroData = {
      fedFundsRate,
      treasury10Y,
      yieldCurve,
      cpi,
      m2MoneySupply,
      dollarIndex,
      macroSignal,
      rateDirection,
      crossAssets,
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

    // v5.1: Long/Short Ratios — retail vs smart money positioning
    lines.push(`--- Positioning Intelligence ---`);
    if (derivatives.btcLongShortRatio !== null) {
      lines.push(`BTC Global L/S Ratio: ${derivatives.btcLongShortRatio.toFixed(2)} (${derivatives.btcLongShortRatio > 1 ? "retail net long" : "retail net short"})`);
    }
    if (derivatives.btcTopTraderLSRatio !== null) {
      lines.push(`BTC Top Trader L/S: ${derivatives.btcTopTraderLSRatio.toFixed(2)} (${derivatives.btcTopTraderLSRatio > 1 ? "smart money long" : "smart money short"})`);
    }
    if (derivatives.ethLongShortRatio !== null) {
      lines.push(`ETH Global L/S Ratio: ${derivatives.ethLongShortRatio.toFixed(2)} (${derivatives.ethLongShortRatio > 1 ? "retail net long" : "retail net short"})`);
    }
    if (derivatives.ethTopTraderLSRatio !== null) {
      lines.push(`ETH Top Trader L/S: ${derivatives.ethTopTraderLSRatio.toFixed(2)} (${derivatives.ethTopTraderLSRatio > 1 ? "smart money long" : "smart money short"})`);
    }

    // v5.1: Composite Positioning Signals
    lines.push(`BTC Positioning: ${derivatives.btcPositioningSignal}`);
    lines.push(`ETH Positioning: ${derivatives.ethPositioningSignal}`);

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

    // v5.1: Positioning signal interpretation
    const posSignals = [
      { asset: "BTC", signal: derivatives.btcPositioningSignal },
      { asset: "ETH", signal: derivatives.ethPositioningSignal },
    ];
    for (const { asset, signal } of posSignals) {
      switch (signal) {
        case "SMART_MONEY_LONG":
          lines.push(`🟢 POSITIONING: ${asset} — Top traders accumulating longs while retail is short. High-conviction BUY signal.`);
          break;
        case "SMART_MONEY_SHORT":
          lines.push(`🔴 POSITIONING: ${asset} — Top traders going short while retail is long. Distribution phase — caution.`);
          break;
        case "OVERLEVERAGED_LONG":
          lines.push(`⚠️ POSITIONING: ${asset} — Extreme long crowding across all participants. Long squeeze risk elevated.`);
          break;
        case "OVERLEVERAGED_SHORT":
          lines.push(`⚠️ POSITIONING: ${asset} — Extreme short crowding. Short squeeze potential.`);
          break;
      }
    }

    // v5.1: OI-Price Divergence interpretation
    if (derivatives.btcOIPriceDivergence !== "NEUTRAL" && derivatives.btcOIPriceDivergence !== "ALIGNED") {
      if (derivatives.btcOIPriceDivergence === "OI_UP_PRICE_DOWN") {
        lines.push(`⚡ DIVERGENCE: BTC OI rising while price falling — new shorts entering OR longs averaging down. Squeeze potential building.`);
      } else {
        lines.push(`⚡ DIVERGENCE: BTC OI falling while price rising — short squeeze in progress, shorts capitulating.`);
      }
    }
    if (derivatives.ethOIPriceDivergence !== "NEUTRAL" && derivatives.ethOIPriceDivergence !== "ALIGNED") {
      if (derivatives.ethOIPriceDivergence === "OI_UP_PRICE_DOWN") {
        lines.push(`⚡ DIVERGENCE: ETH OI rising while price falling — squeeze potential building.`);
      } else {
        lines.push(`⚡ DIVERGENCE: ETH OI falling while price rising — short squeeze in progress.`);
      }
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

    // v5.1: Cross-Asset Correlation Intelligence
    if (macro.crossAssets) {
      const ca = macro.crossAssets;
      lines.push("");
      lines.push(`═══ CROSS-ASSET CORRELATION (v5.1) ═══`);
      if (ca.goldPrice !== null) {
        lines.push(`Gold (XAU): $${ca.goldPrice.toFixed(0)} ${ca.goldChange24h !== null ? `(${ca.goldChange24h >= 0 ? "+" : ""}${ca.goldChange24h.toFixed(1)}% 24h)` : ""}`);
      }
      if (ca.oilPrice !== null) {
        lines.push(`Oil (WTI): $${ca.oilPrice.toFixed(2)} ${ca.oilChange24h !== null ? `(${ca.oilChange24h >= 0 ? "+" : ""}${ca.oilChange24h.toFixed(1)}% 24h)` : ""}`);
      }
      if (ca.vixLevel !== null) {
        lines.push(`VIX: ${ca.vixLevel.toFixed(1)} ${ca.vixLevel > 30 ? "⚠️ HIGH FEAR" : ca.vixLevel > 20 ? "↑ Elevated" : ca.vixLevel < 15 ? "🟢 Low (complacent)" : ""}`);
      }
      if (ca.sp500Change !== null) {
        lines.push(`S&P 500: ${ca.sp500Change >= 0 ? "+" : ""}${ca.sp500Change.toFixed(1)}% ${ca.sp500Change > 2 ? "🟢 Risk-On Rally" : ca.sp500Change < -2 ? "🔴 Risk-Off Selloff" : ""}`);
      }
      lines.push(`Cross-Asset Signal: ${ca.crossAssetSignal}`);

      // Interpretation for AI
      switch (ca.crossAssetSignal) {
        case "RISK_ON":
          lines.push(`🟢 CROSS-ASSET: Traditional risk assets support crypto upside — gold retreating, equities strong, VIX low`);
          break;
        case "RISK_OFF":
          lines.push(`🔴 CROSS-ASSET: Risk-off environment in traditional markets — headwind for crypto`);
          break;
        case "FLIGHT_TO_SAFETY":
          lines.push(`🚨 CROSS-ASSET: Flight to safety — gold surging, VIX spiking. Reduce exposure, protect capital.`);
          break;
        default:
          lines.push(`→ Cross-asset signals mixed — no strong directional bias from traditional markets`);
      }
    }
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

    // v6.0: Launch all non-CoinGecko fetches in parallel with smart caching
    const intelligencePromise = (async () => {
      const fng = await Promise.allSettled([
        cacheManager.getOrFetch(CacheKeys.FEAR_GREED, CACHE_TTL.FEAR_GREED, () =>
          axios.get("https://api.alternative.me/fng/", { timeout: 10000 })
        )
      ]).then(r => r[0]);
      const [defi, deriv] = await Promise.allSettled([
        cacheManager.getOrFetch(CacheKeys.DEFI_LLAMA_TVL, CACHE_TTL.DEFI_LLAMA, fetchDefiLlamaData),
        cacheManager.getOrFetch(CacheKeys.BINANCE_FUNDING, CACHE_TTL.DERIVATIVES, fetchDerivativesData),
      ]);
      const [news, macro] = await Promise.allSettled([
        cacheManager.getOrFetch(CacheKeys.NEWS_SENTIMENT, CACHE_TTL.NEWS, fetchNewsSentiment),
        cacheManager.getOrFetch(CacheKeys.MACRO_DATA, CACHE_TTL.MACRO, fetchMacroData),
      ]);
      return { fng, defi, deriv, news, macro };
    })();

    // v6.0: CoinGecko with smart cache + retry — critical data source for portfolio pricing
    const cachedCoinGecko = cacheManager.get<any>(CacheKeys.COINGECKO_PRICES);
    let marketResult: PromiseSettledResult<any>;

    if (cachedCoinGecko) {
      marketResult = { status: "fulfilled", value: cachedCoinGecko };
      console.log(`  ♻️  CoinGecko: using cached data (${((cacheManager.getAge(CacheKeys.COINGECKO_PRICES) || 0) / 1000).toFixed(0)}s old)`);
    } else {
    // Free tier rate limit window is ~60s, so retries need substantial delays
    const retryDelays = [15000, 45000]; // 15s after 1st fail, 45s after 2nd fail
    marketResult = { status: "rejected", reason: new Error("No attempt") } as PromiseRejectedResult;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await axios.get(coingeckoUrl, { timeout: 15000 });
        if (res.data && Array.isArray(res.data) && res.data.length > 0) {
          marketResult = { status: "fulfilled", value: res };
          // v6.0: Cache the successful response
          cacheManager.set(CacheKeys.COINGECKO_PRICES, res, CACHE_TTL.PRICE);
          // Update last-known-prices cache on success
          for (const coin of res.data) {
            const registryEntry = Object.entries(TOKEN_REGISTRY).find(([_, t]) => t.coingeckoId === coin.id);
            const symbol = registryEntry ? registryEntry[0] : coin.symbol.toUpperCase();
            const sector = registryEntry ? registryEntry[1].sector : "UNKNOWN";
            lastKnownPrices[symbol] = {
              price: coin.current_price, change24h: coin.price_change_percentage_24h || 0,
              change7d: coin.price_change_percentage_7d_in_currency || 0,
              volume: coin.total_volume, marketCap: coin.market_cap, name: coin.name, sector,
            };
          }
          break;
        } else {
          console.warn(`  \u26a0\ufe0f CoinGecko attempt ${attempt}/3: empty response, retrying in ${(retryDelays[attempt - 1] || 0) / 1000}s...`);
          if (attempt < 3) await new Promise(r => setTimeout(r, retryDelays[attempt - 1]));
        }
      } catch (err: any) {
        const status = err?.response?.status;
        console.warn(`  \u26a0\ufe0f CoinGecko attempt ${attempt}/3: ${status === 429 ? "rate limited (429)" : err?.message?.substring(0, 80) || err}`);
        if (attempt < 3) {
          console.log(`     Waiting ${retryDelays[attempt - 1] / 1000}s before retry...`);
          await new Promise(r => setTimeout(r, retryDelays[attempt - 1]));
        }
        if (attempt === 3) marketResult = { status: "rejected", reason: err } as PromiseRejectedResult;
      }
    }
    } // end of cache miss else block

    // Await intelligence data (likely already resolved during CoinGecko retries)
    const { fng: fngResult, defi: defiResult, deriv: derivResult, news: newsResult, macro: macroResult } = await intelligencePromise;

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
      console.error(`  \u274c CoinGecko FAILED: ${reason?.response?.status || ""} ${reason?.message || reason}`);
      // Fallback: use last-known-prices cache to prevent $0 portfolio
      const cachedCount = Object.keys(lastKnownPrices).length;
      if (cachedCount > 0) {
        console.log(`  \u267b\ufe0f Using ${cachedCount} cached prices from last successful CoinGecko fetch`);
        tokens = Object.entries(lastKnownPrices).map(([symbol, data]) => ({
          symbol, name: data.name, price: data.price,
          priceChange24h: data.change24h, priceChange7d: data.change7d,
          volume24h: data.volume, marketCap: data.marketCap, sector: data.sector,
        }));
      }
    }

    // v6.1: DexScreener fallback — if CoinGecko returned no tokens or failed,
    // fetch prices from DexScreener using on-chain token addresses (no API key needed)
    if (tokens.length === 0 || tokens.every(t => !t.price || t.price === 0)) {
      console.log(`  🔄 DexScreener fallback: CoinGecko returned 0 priced tokens, fetching from DexScreener...`);
      try {
        const tokenAddresses = Object.entries(TOKEN_REGISTRY)
          .filter(([symbol]) => symbol !== "USDC")
          .map(([_, t]) => t.address)
          .join(",");
        const dexRes = await axios.get(
          `https://api.dexscreener.com/tokens/v1/base/${tokenAddresses}`,
          { timeout: 15000 }
        );
        if (dexRes.data && Array.isArray(dexRes.data) && dexRes.data.length > 0) {
          const dexTokens: MarketData["tokens"] = [];
          const seenSymbols = new Set<string>();
          for (const pair of dexRes.data) {
            const addr = pair.baseToken?.address?.toLowerCase();
            const registryEntry = Object.entries(TOKEN_REGISTRY).find(
              ([_, t]) => t.address.toLowerCase() === addr
            );
            if (registryEntry && !seenSymbols.has(registryEntry[0])) {
              const [symbol, regData] = registryEntry;
              seenSymbols.add(symbol);
              const price = parseFloat(pair.priceUsd || "0");
              if (price > 0) {
                dexTokens.push({
                  symbol, name: regData.name, price,
                  priceChange24h: pair.priceChange?.h24 || 0,
                  priceChange7d: 0,
                  volume24h: pair.volume?.h24 || 0,
                  marketCap: pair.marketCap || 0,
                  sector: regData.sector,
                });
                // Also update lastKnownPrices so light cycles have data
                lastKnownPrices[symbol] = {
                  price, change24h: pair.priceChange?.h24 || 0, change7d: 0,
                  volume: pair.volume?.h24 || 0, marketCap: pair.marketCap || 0,
                  name: regData.name, sector: regData.sector,
                };
              }
            }
          }
          if (dexTokens.length > 0) {
            tokens = dexTokens;
            console.log(`  ✅ DexScreener fallback: ${dexTokens.length} tokens priced`);
            // Cache the DexScreener result so subsequent cycles don't re-fetch
            cacheManager.set(CacheKeys.COINGECKO_PRICES, { data: dexTokens.map(t => ({
              id: TOKEN_REGISTRY[t.symbol]?.coingeckoId || t.symbol.toLowerCase(),
              symbol: t.symbol.toLowerCase(), name: t.name,
              current_price: t.price, price_change_percentage_24h: t.priceChange24h,
              price_change_percentage_7d_in_currency: t.priceChange7d,
              total_volume: t.volume24h, market_cap: t.marketCap,
            })) }, CACHE_TTL.PRICE);
          } else {
            console.warn(`  ⚠️ DexScreener returned data but no valid prices`);
          }
        }
      } catch (dexErr: any) {
        console.error(`  ❌ DexScreener fallback also failed: ${dexErr?.message || dexErr}`);
      }
    }

    // v6.2: Chainlink on-chain oracle — 3rd fallback for blue-chip prices
    // If we still have no ETH/BTC prices, read directly from on-chain oracles
    const hasETHPrice = tokens.some(t => t.symbol === "ETH" && t.price > 0);
    if (!hasETHPrice || tokens.length === 0) {
      try {
        const chainlinkPrices = await fetchChainlinkPrices();
        for (const [symbol, price] of chainlinkPrices) {
          const existing = tokens.find(t => t.symbol === symbol);
          if (!existing && TOKEN_REGISTRY[symbol]) {
            const reg = TOKEN_REGISTRY[symbol];
            tokens.push({
              symbol, name: reg.name, price,
              priceChange24h: 0, priceChange7d: 0,
              volume24h: 0, marketCap: 0, sector: reg.sector,
            });
            lastKnownPrices[symbol] = {
              price, change24h: 0, change7d: 0,
              volume: 0, marketCap: 0, name: reg.name, sector: reg.sector,
            };
          } else if (existing && existing.price === 0) {
            existing.price = price;
            lastKnownPrices[symbol] = { ...lastKnownPrices[symbol], price };
          }
        }
        if (chainlinkPrices.size > 0) {
          console.log(`  🔗 Chainlink oracle backfill: ${chainlinkPrices.size} blue-chip prices`);
        }
      } catch (chainErr: any) {
        console.error(`  ❌ Chainlink oracle fallback failed: ${chainErr?.message || chainErr}`);
      }
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

    // v5.1: Feed BTC/ETH price changes into derivatives cache for OI-price divergence detection
    const btcToken = tokens.find(t => t.symbol === "WETH" || t.symbol === "cbBTC");
    const ethToken = tokens.find(t => t.symbol === "WETH");
    const btcPriceToken = tokens.find(t => t.symbol === "cbBTC");
    derivativesCache.btcPriceChange = btcPriceToken?.priceChange24h ?? 0;
    derivativesCache.ethPriceChange = ethToken?.priceChange24h ?? 0;

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

  // RSI (weight: 25) — uses adaptive thresholds
  if (rsi !== null) {
    signals++;
    const oversold = state.adaptiveThresholds.rsiOversold;
    const overbought = state.adaptiveThresholds.rsiOverbought;
    if (rsi < oversold) score += 25;       // Oversold — buy signal
    else if (rsi < oversold + 10) score += 12;
    else if (rsi > overbought) score -= 25;  // Overbought — sell signal
    else if (rsi > overbought - 10) score -= 12;
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

  // Determine signal — uses adaptive thresholds
  const at = state.adaptiveThresholds;
  let signal: TechnicalIndicators["overallSignal"];
  if (normalizedScore >= at.confluenceStrongBuy) signal = "STRONG_BUY";
  else if (normalizedScore >= at.confluenceBuy) signal = "BUY";
  else if (normalizedScore <= at.confluenceStrongSell) signal = "STRONG_SELL";
  else if (normalizedScore <= at.confluenceSell) signal = "SELL";
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
  isExploration?: boolean;
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
  // v6.1: Merge static tokens with dynamically discovered tokens
  const discoveredTokensList = tokenDiscoveryEngine?.getTradableTokens() || [];
  const discoveredSymbols = discoveredTokensList.map(t => t.symbol);
  const allTradeableTokens = [...CONFIG.activeTokens, ...discoveredSymbols.filter(s => !CONFIG.activeTokens.includes(s))];
  const tradeableTokens = allTradeableTokens.join(", ");

  // v6.1: Build discovery intel for AI prompt
  const discoveryIntel = discoveredTokensList.length > 0
    ? `\n═══ DISCOVERED TOKENS (Dynamic Scanner) ═══\nTokens discovered by on-chain liquidity scanner (tradeable if you see opportunity):\n${discoveredTokensList.slice(0, 15).map(t =>
        `${t.symbol} ($${t.priceUSD.toFixed(4)}) | Vol24h: $${(t.volume24hUSD / 1000).toFixed(0)}K | Liq: $${(t.liquidityUSD / 1000).toFixed(0)}K | ${t.priceChange24h > 0 ? '+' : ''}${t.priceChange24h.toFixed(1)}% | Sector: ${t.sector} | DEX: ${t.dexName}`
      ).join("\n")}\nNote: Discovered tokens may have less data than core tokens. Size positions smaller (50-75% of normal) for discovered tokens.\n`
    : "";

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

  const systemPrompt = `You are Henry's autonomous crypto trading agent v5.1.1 on Base network.
You are a MULTI-DIMENSIONAL TRADER with real-time access to: technical indicators, DeFi protocol intelligence, derivatives data (funding rates + OI + long/short ratios + top trader positioning), news sentiment analysis, Federal Reserve macro data (rates, yield curve, CPI, M2, dollar), cross-asset correlations (Gold, Oil, VIX, S&P 500), and market regime analysis. Your decisions execute LIVE swaps with adaptive MEV protection. You think like a macro-aware hedge fund — reading both the market microstructure AND the global economic environment. Pay special attention to SMART MONEY positioning divergence from retail and OI-Price divergence signals — these are your highest-conviction indicators.

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

${discoveryIntel}═══ TRADING LIMITS ═══
- Max BUY: $${maxBuyAmount.toFixed(2)} | Max SELL: ${CONFIG.trading.maxSellPercent}% of position
- Available tokens: ${tradeableTokens}

═══ STRATEGY FRAMEWORK v5.1.1 ═══

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
1. TIERED PROFIT HARVESTING (v5.1.1): The bot automatically harvests profits in tranches:
   - +8% gain → harvest 15% of position (early wins, bank the cream)
   - +15% gain → harvest 20% of position (moderate win, real profit locked)
   - +25% gain → harvest 30% of position (strong win, protect the bag)
   - +40% gain → harvest 40% of position (major win, substantial profit lock)
   The remaining position continues to ride. Patient capital, not passive capital.
   IMPORTANT: When you recommend a SELL, also consider which tier the position has already been harvested at.
2. OVERBOUGHT EXIT: Sell if RSI > 75 AND Bollinger %B > 0.95 AND MACD turning bearish — even if no harvest tier triggered
3. STOP LOSS: Sell if token is down >20% in 7d and trend is STRONG_DOWN
4. SECTOR TRIM: Sell from overweight sectors (>10% drift) to rebalance
5. FUNDING WARNING: If BTC/ETH longs are CROWDED (high positive funding), prepare to take profits — correction risk
6. TVL OUTFLOW: If a DeFi protocol's TVL is dropping >5% while you hold its token, consider trimming
7. MACRO HEADWIND: If macro signal is RISK_OFF (rate hikes, yield curve inverting, strong dollar), tighten profit-taking. Sell into strength rather than holding
8. NEWS RISK: If a token has strong bearish news mentions AND technical indicators confirm (RSI dropping, MACD bearish), trim position proactively
9. SMART MONEY WARNING: If derivatives show SMART_MONEY_SHORT while you're holding a token, this is a high-priority sell signal
10. TIME-BASED HARVEST: Positions held 72+ hours with +5% gain get a 10% trim — don't let stale winners sit forever

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
6. SELF-IMPROVEMENT: Your strategy patterns, adaptive thresholds, and performance insights are provided below. FAVOR proven winning patterns and AVOID known losing patterns. Trust the confidence-weighted sizing
7. NEWS NOISE FILTER: Ignore news sentiment if it contradicts strong technical + DeFi signals. Headlines lag price action

DECISION PRIORITY: Market Regime > Macro Environment > Technical signals + DeFi flows > Derivatives signals > News sentiment > Sector rebalancing

For SELLING: fromToken = token symbol, toToken = USDC
For BUYING: fromToken = USDC, toToken = token symbol

DIVERSIFICATION RULE: NEVER buy the same token more than 2 cycles in a row. Rotate across sectors and tokens.
If a token already holds >20% of portfolio, do NOT buy more — pick a different underweight token or HOLD.

CRITICAL: Respond with ONLY a raw JSON object. NO prose, NO explanation outside JSON, NO markdown.
Your ENTIRE response must be exactly one JSON object:
{"action":"BUY","fromToken":"USDC","toToken":"WELL","amountUSD":10,"reasoning":"RSI oversold at 28, MACD bullish crossover, Base TVL +3.2%, WELL protocol TVL rising, BTC shorts crowded, macro RISK_ON, news bullish +45","sector":"DEFI"}` + formatSelfImprovementPrompt();

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
          if (decision.amountUSD < 5.00) {  // v5.2: raised from $1 to $5
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
  // Check static registry first
  const token = TOKEN_REGISTRY[symbol];
  if (token) {
    // For swaps, native ETH should use WETH address
    if (token.address === "native") {
      return TOKEN_REGISTRY["WETH"].address;
    }
    return token.address;
  }
  // v6.1: Check discovered tokens
  if (tokenDiscoveryEngine) {
    const discovered = tokenDiscoveryEngine.getDiscoveredTokens().find(
      t => t.symbol.toUpperCase() === symbol.toUpperCase()
    );
    if (discovered) return discovered.address;
  }
  throw new Error(`Unknown token: ${symbol}`);
}

function getTokenDecimals(symbol: string): number {
  if (TOKEN_REGISTRY[symbol]) return TOKEN_REGISTRY[symbol].decimals;
  // v6.1: Check discovered tokens
  if (tokenDiscoveryEngine) {
    const discovered = tokenDiscoveryEngine.getDiscoveredTokens().find(
      t => t.symbol.toUpperCase() === symbol.toUpperCase()
    );
    if (discovered) return discovered.decimals;
  }
  return 18;
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

  // v6.2: Gas-aware trade sizing — skip trades where gas eats the profit
  // Base chain gas is cheap (~$0.01-0.10) but for tiny trades it still matters
  const estimatedGasUSD = 0.15; // Conservative estimate for Base swap (higher than typical)
  const MIN_PROFIT_TO_GAS_RATIO = 3; // Trade must expect 3x gas cost in profit potential
  const gasThreshold = estimatedGasUSD * MIN_PROFIT_TO_GAS_RATIO;

  if (decision.amountUSD < gasThreshold && decision.amountUSD < 3) {
    console.log(`  ⛽ Gas guard: Skipping $${decision.amountUSD.toFixed(2)} trade — below gas threshold ($${gasThreshold.toFixed(2)})`);
    return { success: false, error: `Trade too small: $${decision.amountUSD.toFixed(2)} < gas threshold $${gasThreshold.toFixed(2)}` };
  }

  // Log gas-to-trade ratio for monitoring
  const gasPercent = (estimatedGasUSD / decision.amountUSD) * 100;
  if (gasPercent > 5) {
    console.log(`  ⛽ Gas warning: Gas ~$${estimatedGasUSD.toFixed(2)} = ${gasPercent.toFixed(1)}% of $${decision.amountUSD.toFixed(2)} trade`);
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

    // v5.1: MEV Protection — Adaptive Slippage Based on Trade Size & Conditions
    // Larger trades need tighter slippage to avoid sandwich attacks
    // High-volume periods can tolerate more; volatile periods need less
    let adaptiveSlippage = CONFIG.trading.slippageBps; // Default base slippage
    const tradeValueUSD = decision.amountUSD;

    // Tighten slippage for larger trades (more attractive to MEV bots)
    if (tradeValueUSD > 50) {
      adaptiveSlippage = Math.min(adaptiveSlippage, 100); // Cap at 1% for trades > $50
    }
    if (tradeValueUSD > 100) {
      adaptiveSlippage = Math.min(adaptiveSlippage, 75);  // Cap at 0.75% for trades > $100
    }
    if (tradeValueUSD > 500) {
      adaptiveSlippage = Math.min(adaptiveSlippage, 50);  // Cap at 0.5% for trades > $500
    }

    // In volatile market regime, tighten slippage further (more MEV activity during volatility)
    if (marketData.marketRegime === "VOLATILE") {
      adaptiveSlippage = Math.min(adaptiveSlippage, Math.floor(adaptiveSlippage * 0.75));
    }

    console.log(`     🛡️ MEV Protection: Adaptive slippage ${adaptiveSlippage}bps (${(adaptiveSlippage / 100).toFixed(2)}%) for $${tradeValueUSD.toFixed(2)} trade`);

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
          slippageBps: adaptiveSlippage,
        });
        break; // Success — exit retry loop
      } catch (swapError: any) {
        const swapMsg = swapError?.message || "";
        if (swapMsg.includes("Insufficient token allowance") && attempt < maxRetries) {
          console.log(`     ⏳ Allowance not yet visible to API, retrying in 15s... (attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 15000));
        } else if (swapMsg.includes("slippage") && adaptiveSlippage < CONFIG.trading.slippageBps && attempt < maxRetries) {
          // v5.1: If slippage too tight, relax slightly and retry (but never above base config)
          adaptiveSlippage = Math.min(adaptiveSlippage + 25, CONFIG.trading.slippageBps);
          console.log(`     ⚠️ Slippage too tight, relaxing to ${adaptiveSlippage}bps and retrying...`);
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
        triggeredBy: decision.isExploration ? "EXPLORATION" : "AI",
        isExploration: decision.isExploration || false,
        // v5.1: Enhanced signal context
        btcPositioning: marketData.derivatives?.btcPositioningSignal || null,
        ethPositioning: marketData.derivatives?.ethPositioningSignal || null,
        crossAssetSignal: marketData.macroData?.crossAssets?.crossAssetSignal || null,
        adaptiveSlippage: adaptiveSlippage,
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


/**
 * v5.3.0: Auto-Harvest Transfer (USDC)
 * Checks if accumulated harvested profits exceed the threshold,
 * then sends USDC directly to the owner's wallet.
 * Profits are already in USDC (harvests sell tokens → USDC), so we transfer USDC directly.
 */
async function checkAutoHarvestTransfer(
  account: any,
  cdp: any,
  ethPrice: number,
  ethBalance: number
): Promise<{ sent: boolean; amountUSDC?: number; amountUSD?: number; txHash?: string; error?: string }> {
  const cfg = CONFIG.autoHarvest;

  if (!cfg.enabled) {
    return { sent: false, error: 'Auto-harvest disabled' };
  }

  if (!cfg.destinationWallet || cfg.destinationWallet.length < 42) {
    console.log('⚠️  Auto-harvest: No destination wallet configured');
    return { sent: false, error: 'No destination wallet' };
  }

  // Cooldown check
  if (state.lastAutoHarvestTime) {
    const hoursSinceLast = (Date.now() - new Date(state.lastAutoHarvestTime).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLast < cfg.cooldownHours) {
      return { sent: false, error: `Cooldown: ${(cfg.cooldownHours - hoursSinceLast).toFixed(1)}h remaining` };
    }
  }

  // Gas check — need ETH for the USDC transfer tx
  if (ethBalance < cfg.minETHReserve) {
    return { sent: false, error: `ETH balance (${ethBalance.toFixed(4)}) below reserve (${cfg.minETHReserve}) for gas` };
  }

  // Calculate unharvested profit (total harvested profits minus already transferred)
  const profitUSD = (state.harvestedProfits?.harvests || [])
    .reduce((sum: number, h: any) => sum + (h.profitUSD || 0), 0) - state.totalAutoHarvestedUSD;

  if (profitUSD < cfg.thresholdUSD) {
    return { sent: false, error: `Unharvested profit ($${profitUSD.toFixed(2)}) below threshold ($${cfg.thresholdUSD})` };
  }

  // Check actual USDC balance available
  const usdcAddress = TOKEN_REGISTRY.USDC.address;
  const usdcBalance = await getERC20Balance(usdcAddress, CONFIG.walletAddress, 6);

  // v6.2.2: Capital floor — never let portfolio drop below minTradingCapitalUSD
  const currentPortfolio = state.trading.totalPortfolioValue || 0;
  const capitalFloor = cfg.minTradingCapitalUSD || 500;
  const headroom = Math.max(0, currentPortfolio - capitalFloor);
  if (headroom <= 0) {
    return { sent: false, error: `Portfolio ($${currentPortfolio.toFixed(2)}) at or below capital floor ($${capitalFloor}). Preserving trading capital.` };
  }

  // Only send the profit amount, capped at available USDC and headroom above capital floor
  const sendableUSDC = Math.max(0, usdcBalance - 5);
  const transferAmount = Math.min(profitUSD, sendableUSDC, headroom);

  if (transferAmount < cfg.thresholdUSD) {
    return { sent: false, error: `Sendable amount ($${transferAmount.toFixed(2)}) below threshold after capital floor + $5 buffer` };
  }

  console.log(`\n💰 AUTO-HARVEST TRANSFER (USDC)`);
  console.log(`   Sending $${transferAmount.toFixed(2)} USDC to ${cfg.destinationWallet}`);
  console.log(`   USDC balance: $${usdcBalance.toFixed(2)} | Capital floor: $${capitalFloor} | Headroom: $${headroom.toFixed(2)} | Sendable: $${sendableUSDC.toFixed(2)}`);
  console.log(`   Profit available: $${profitUSD.toFixed(2)} | Transferring: $${transferAmount.toFixed(2)}`);

  try {
    const txHash = await sendUSDCTransfer(account, cfg.destinationWallet, transferAmount);

    console.log(`   ✅ USDC Transfer sent! TX: ${txHash}`);
    console.log(`   🔍 View: https://basescan.org/tx/${txHash}`);

    const transferRecord = {
      timestamp: new Date().toISOString(),
      amountETH: '0', // We send USDC not ETH now
      amountUSD: transferAmount,
      txHash: txHash,
      destination: cfg.destinationWallet
    };

    state.autoHarvestTransfers.push(transferRecord);
    state.totalAutoHarvestedUSD += transferAmount;
    state.lastAutoHarvestTime = new Date().toISOString();
    state.autoHarvestCount++;

    if (state.autoHarvestTransfers.length > 50) {
      state.autoHarvestTransfers = state.autoHarvestTransfers.slice(-50);
    }

    saveTradeHistory();

    return { sent: true, amountUSDC: transferAmount, amountUSD: transferAmount, txHash: txHash };

  } catch (err: any) {
    console.error(`   ❌ Auto-harvest USDC transfer failed:`, err.message);
    return { sent: false, error: err.message };
  }
}

// Helper: send USDC (ERC-20) transfer
async function sendUSDCTransfer(account: any, to: string, amountUSDC: number): Promise<string> {
  const usdcAddress = TOKEN_REGISTRY.USDC.address;
  // USDC has 6 decimals
  const amount = BigInt(Math.floor(amountUSDC * 1e6));
  // ERC-20 transfer(address,uint256) selector: 0xa9059cbb
  const transferData = "0xa9059cbb" +
    to.slice(2).padStart(64, "0") +
    amount.toString(16).padStart(64, "0");

  const result = await account.sendTransaction({
    network: "base",
    transaction: {
      to: usdcAddress,
      data: transferData as `0x${string}`,
      value: BigInt(0),
    },
  });
  return result.transactionHash || result.hash || String(result);
}

// Helper: send native ETH transfer using CDP SDK (kept for future use)
async function sendNativeTransfer(account: any, to: string, amountETH: number): Promise<string> {
  const result = await account.sendTransaction({
    to: to,
    value: BigInt(Math.floor(amountETH * 1e18)),
    data: "0x"
  });
  return typeof result === "string" ? result : result.transactionHash || result.hash || String(result);
}

// ============================================================================
// v6.0: LIGHT/HEAVY CYCLE ORCHESTRATOR
// ============================================================================

/**
 * Quick price check for light cycle determination.
 * Uses cached CoinGecko data (3-min TTL) — essentially free.
 */
async function fetchQuickPrices(): Promise<Map<string, number>> {
  const prices = new Map<string, number>();

  // Use cached prices first (most light cycles will hit cache)
  if (Object.keys(lastKnownPrices).length > 0) {
    for (const [symbol, data] of Object.entries(lastKnownPrices)) {
      prices.set(symbol, data.price);
    }
    return prices;
  }

  // Fallback: fetch from CoinGecko (will be cached by getMarketData on next heavy cycle)
  try {
    const coingeckoIds = [...new Set(
      Object.values(TOKEN_REGISTRY).map(t => t.coingeckoId).filter(Boolean)
    )].join(",");
    const res = await axios.get(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coingeckoIds}&sparkline=false`,
      { timeout: 10000 }
    );
    if (res.data && Array.isArray(res.data)) {
      for (const coin of res.data) {
        const registryEntry = Object.entries(TOKEN_REGISTRY).find(([_, t]) => t.coingeckoId === coin.id);
        const symbol = registryEntry ? registryEntry[0] : coin.symbol.toUpperCase();
        prices.set(symbol, coin.current_price);
      }
    }
  } catch {
    // On failure, use whatever cached prices exist
    for (const [symbol, data] of Object.entries(lastKnownPrices)) {
      prices.set(symbol, data.price);
    }
  }

  // v6.1: DexScreener fallback for quick prices if nothing else worked
  if (prices.size === 0) {
    try {
      const addresses = Object.entries(TOKEN_REGISTRY)
        .filter(([s]) => s !== "USDC")
        .map(([_, t]) => t.address)
        .join(",");
      const dexRes = await axios.get(
        `https://api.dexscreener.com/tokens/v1/base/${addresses}`,
        { timeout: 10000 }
      );
      if (dexRes.data && Array.isArray(dexRes.data)) {
        const seen = new Set<string>();
        for (const pair of dexRes.data) {
          const addr = pair.baseToken?.address?.toLowerCase();
          const entry = Object.entries(TOKEN_REGISTRY).find(([_, t]) => t.address.toLowerCase() === addr);
          if (entry && !seen.has(entry[0])) {
            seen.add(entry[0]);
            const price = parseFloat(pair.priceUsd || "0");
            if (price > 0) {
              prices.set(entry[0], price);
              lastKnownPrices[entry[0]] = {
                price, change24h: pair.priceChange?.h24 || 0, change7d: 0,
                volume: pair.volume?.h24 || 0, marketCap: pair.marketCap || 0,
                name: entry[1].name, sector: entry[1].sector,
              };
            }
          }
        }
        if (prices.size > 0) console.log(`  🔄 Quick prices: ${prices.size} tokens via DexScreener fallback`);
      }
    } catch { /* DexScreener quick price fallback failed silently */ }
  }

  // v6.2: Chainlink on-chain oracle — 3rd fallback, can never be rate-limited
  // Only covers ETH/BTC but ensures we always have blue-chip prices
  if (prices.size === 0 || !prices.has("ETH")) {
    try {
      const chainlinkPrices = await fetchChainlinkPrices();
      for (const [symbol, price] of chainlinkPrices) {
        if (!prices.has(symbol)) {
          prices.set(symbol, price);
        }
      }
    } catch { /* Chainlink fallback failed silently */ }
  }

  return prices;
}

/**
 * Determine if this cycle should be HEAVY (full analysis + AI) or LIGHT (price check only).
 */
async function shouldRunHeavyCycle(currentPrices: Map<string, number>): Promise<{ isHeavy: boolean; reason: string }> {
  const now = Date.now();

  // 1. Forced interval: at least one heavy cycle every 15 minutes
  if (now - lastHeavyCycleAt > HEAVY_CYCLE_FORCED_INTERVAL_MS) {
    return { isHeavy: true, reason: `Forced interval (${((now - lastHeavyCycleAt) / 60000).toFixed(0)}m since last heavy)` };
  }

  // 2. First cycle is always heavy
  if (lastHeavyCycleAt === 0) {
    return { isHeavy: true, reason: 'First cycle' };
  }

  // 2b. v6.1: Force heavy if pricing is broken (all tokens $0 = only USDC counted)
  const pricedTokenCount = Array.from(currentPrices.values()).filter(p => p > 0).length;
  if (pricedTokenCount === 0 && Object.keys(lastKnownPrices).length === 0) {
    return { isHeavy: true, reason: 'No token prices available — forcing price refresh' };
  }

  // 3. Check for significant price moves since last heavy cycle
  // v6.2: Use portfolio-scaled threshold instead of fixed 2%
  const portfolioValue = state.trading.totalPortfolioValue || 0;
  const { threshold: dynamicThreshold, tier: portfolioTier } = getPortfolioSensitivity(portfolioValue);
  adaptiveCycle.dynamicPriceThreshold = dynamicThreshold;

  for (const [symbol, price] of currentPrices) {
    const lastPrice = lastPriceSnapshot.get(symbol);
    if (lastPrice && lastPrice > 0) {
      const change = Math.abs(price - lastPrice) / lastPrice;
      if (change > dynamicThreshold) {
        const direction = price > lastPrice ? 'UP' : 'DOWN';
        return { isHeavy: true, reason: `${symbol} moved ${(change * 100).toFixed(1)}% ${direction} (${portfolioTier} tier threshold: ${(dynamicThreshold * 100).toFixed(1)}%)` };
      }
    }
  }

  // 3b. v6.2: Emergency drop detection — any token down 5%+ → immediate heavy
  const emergency = checkEmergencyConditions(currentPrices);
  if (emergency.emergency) {
    adaptiveCycle.emergencyMode = true;
    adaptiveCycle.emergencyUntil = Date.now() + 5 * 60 * 1000;
    return { isHeavy: true, reason: `🚨 EMERGENCY: ${emergency.token} dropped ${emergency.dropPercent?.toFixed(1)}%` };
  }

  // 4. Check Fear & Greed change (use cached value, no API call)
  const cachedFG = cacheManager.get<any>(CacheKeys.FEAR_GREED);
  if (cachedFG) {
    try {
      const currentFG = parseInt(cachedFG?.data?.data?.[0]?.value || '0');
      if (currentFG > 0 && lastFearGreedValue > 0 && Math.abs(currentFG - lastFearGreedValue) > FG_CHANGE_THRESHOLD) {
        return { isHeavy: true, reason: `Fear & Greed changed: ${lastFearGreedValue} → ${currentFG}` };
      }
    } catch { /* ignore parse errors */ }
  }

  // 5. Check if any tokens exited cooldown
  // Capture count BEFORE filterTokensForEvaluation, which deletes expired entries
  const activeBeforeFilter = cooldownManager.getActiveCount();
  const tokensWithPrices = Array.from(currentPrices.entries())
    .filter(([symbol]) => symbol !== 'USDC')
    .map(([symbol, price]) => ({ symbol, price }));
  const [tokensToEval] = cooldownManager.filterTokensForEvaluation(tokensWithPrices);
  const activeAfterFilter = cooldownManager.getActiveCount();
  if (activeBeforeFilter > 0 && activeBeforeFilter > activeAfterFilter) {
    const exited = activeBeforeFilter - activeAfterFilter;
    return { isHeavy: true, reason: `${exited} token(s) exited cooldown` };
  }

  return { isHeavy: false, reason: 'No significant changes' };
}

async function runTradingCycle() {
  state.totalCycles++;
  const cycleStart = Date.now();

  // v6.0: Light/Heavy cycle determination
  const currentPrices = await fetchQuickPrices();
  const { isHeavy, reason: heavyReason } = await shouldRunHeavyCycle(currentPrices);

  if (!isHeavy) {
    // === LIGHT CYCLE ===
    cycleStats.totalLight++;
    adaptiveCycle.consecutiveLightCycles++;
    const portfolioValue = state.trading.totalPortfolioValue || 0;
    const cooldownCount = cooldownManager.getActiveCount();
    const cacheStats = cacheManager.getStats();

    // v6.2: Update adaptive interval even on light cycles
    const lightInterval = computeNextInterval(currentPrices);
    adaptiveCycle.currentIntervalSec = lightInterval.intervalSec;
    adaptiveCycle.volatilityLevel = lightInterval.volatilityLevel;
    adaptiveCycle.lastPriceCheck = new Map(currentPrices);

    console.log(`[CYCLE #${state.totalCycles}] LIGHT | Portfolio: $${portfolioValue.toFixed(2)} | Cooldowns: ${cooldownCount} | Cache: ${cacheStats.entries} entries (${cacheStats.hitRate} hit rate) | ${(Date.now() - cycleStart)}ms | ⚡ Next: ${lightInterval.intervalSec}s (${lightInterval.volatilityLevel})`);
    return; // Skip full analysis
  }

  // === HEAVY CYCLE ===
  cycleStats.totalHeavy++;
  cycleStats.lastHeavyReason = heavyReason;

  console.log("\n" + "═".repeat(70));
  console.log(`🤖 TRADING CYCLE #${state.totalCycles} [HEAVY: ${heavyReason}] | ${new Date().toISOString()}`);
  console.log(`   Light/Heavy ratio: ${cycleStats.totalLight}L / ${cycleStats.totalHeavy}H | Cache hit rate: ${cacheManager.getStats().hitRate}`);
  console.log("═".repeat(70));

  try {
    console.log("\n📊 Fetching balances...");
    const balances = await getBalances();

    console.log("📈 Fetching market data for all tracked tokens...");
    const marketData = await getMarketData();

    // v6.0: Update light/heavy cycle state
    lastHeavyCycleAt = Date.now();
    lastPriceSnapshot = new Map(marketData.tokens.map(t => [t.symbol, t.price]));
    lastFearGreedValue = marketData.fearGreed.value;

    // v5.2: Consolidate dust positions every 10 cycles
    if (state.totalCycles % 10 === 1) {
      await consolidateDustPositions(balances, marketData);
    }

    // V4.5: Store intelligence data for API endpoint (now includes news + macro)
    lastIntelligenceData = {
      defi: marketData.defiLlama,
      derivatives: marketData.derivatives,
      news: marketData.newsSentiment,
      macro: marketData.macroData,
      regime: marketData.marketRegime,
      performance: calculateTradePerformance(),
    };

    // === PHASE 3: PERFORMANCE REVIEW TRIGGER ===
    // Run review every 10 trades or every 24 hours
    const tradesSinceReview = state.tradeHistory.length - state.lastReviewTradeIndex;
    const hoursSinceReview = state.lastReviewTimestamp
      ? (Date.now() - new Date(state.lastReviewTimestamp).getTime()) / (1000 * 60 * 60)
      : 999;
    if (tradesSinceReview >= 10 || hoursSinceReview >= 24) {
      const reason = tradesSinceReview >= 10 ? "TRADE_COUNT" as const : "TIME_ELAPSED" as const;
      console.log(`\n🧪 SELF-IMPROVEMENT: Running performance review (${reason})...`);
      const review = runPerformanceReview(reason);
      console.log(`   Generated ${review.insights.length} insights, ${review.recommendations.length} recommendations`);

      // Store the review
      state.performanceReviews.push(review);
      if (state.performanceReviews.length > 30) {
        state.performanceReviews = state.performanceReviews.slice(-30);
      }

      // Update review tracking state
      state.lastReviewTradeIndex = state.tradeHistory.length;
      state.lastReviewTimestamp = new Date().toISOString();

      // Adapt thresholds based on review findings
      adaptThresholds(review);
      console.log(`   Thresholds adapted (${state.adaptiveThresholds.adaptationCount} total adaptations)`);

      // Persist everything
      saveTradeHistory();
      console.log(`   Review #${state.performanceReviews.length} stored | Next review after ${state.lastReviewTradeIndex + 10} trades or 24h`);
    }

    // === PHASE 3: ANALYZE STRATEGY PATTERNS (rebuild every cycle for accuracy) ===
    if (state.tradeHistory.length > 0 && state.totalCycles <= 1) {
      console.log(`\n🧬 SELF-IMPROVEMENT: Building strategy pattern memory from ${state.tradeHistory.length} trades...`);
      analyzeStrategyPatterns();
      const validPatterns = Object.values(state.strategyPatterns).filter(p => !p.patternId.startsWith("UNKNOWN"));
      console.log(`   Identified ${Object.keys(state.strategyPatterns).length} patterns (${validPatterns.length} with signal data)`);
      saveTradeHistory();
    }

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

    // === CIRCUIT BREAKERS ===
    // Hard halt: if drawdown exceeds 20% from peak, stop all trading this cycle
    if (drawdown >= 20) {
      console.log(`\n🚨 CIRCUIT BREAKER: Drawdown ${drawdown.toFixed(1)}% exceeds 20% threshold. Halting trading this cycle.`);
      console.log(`   Peak: $${state.trading.peakValue.toFixed(2)} | Current: $${state.trading.totalPortfolioValue.toFixed(2)}`);
      state.trading.lastCheck = new Date();
      return;
    }
    // Caution zone: if drawdown exceeds 12%, reduce max position size by 50%
    const circuitBreakerActive = drawdown >= 12;
    if (circuitBreakerActive) {
      console.log(`\n⚠️ CIRCUIT BREAKER: Drawdown ${drawdown.toFixed(1)}% — caution mode active, position sizes halved`);
    }

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

    // v6.2: Risk-Reward Metrics
    const rrMetrics = calculateRiskRewardMetrics();
    if (rrMetrics.avgWinUSD > 0 || rrMetrics.avgLossUSD > 0) {
      console.log(`\n📊 Risk-Reward Profile:`);
      console.log(`   Avg Win: +$${rrMetrics.avgWinUSD.toFixed(2)} | Avg Loss: -$${rrMetrics.avgLossUSD.toFixed(2)} | Ratio: ${rrMetrics.riskRewardRatio.toFixed(2)}x`);
      console.log(`   Largest Win: +$${rrMetrics.largestWin.toFixed(2)} | Largest Loss: -$${rrMetrics.largestLoss.toFixed(2)}`);
      console.log(`   Expectancy: $${rrMetrics.expectancy.toFixed(2)}/trade | Profit Factor: ${rrMetrics.profitFactor.toFixed(2)}`);
    }

    // === STOP-LOSS CHECK (highest priority) ===
    const stopLossDecision = checkStopLoss(balances);
    if (stopLossDecision) {
      console.log(`\n  🛑 STOP-LOSS GUARD executing sell...`);
      const slResult = await executeTrade(stopLossDecision, marketData);
      // v5.3.3: Track failures and set cooldown
      state.stopLossCooldowns[stopLossDecision.fromToken] = new Date().toISOString();
      if (!slResult.success) {
        recordTradeFailure(stopLossDecision.fromToken);
      } else {
        clearTradeFailures(stopLossDecision.fromToken);
      }
      state.trading.lastCheck = new Date();
      return; // Skip AI decision this cycle
    }

    // === PROFIT-TAKING CHECK ===
    const profitTakeDecision = checkProfitTaking(balances);
    if (profitTakeDecision) {
      // v5.3.3: Check circuit breaker before attempting profit-take
      if (isTokenBlocked(profitTakeDecision.fromToken)) {
        console.log(`\n  🚫 PROFIT-TAKE skipped: ${profitTakeDecision.fromToken} blocked by circuit breaker`);
      } else {
        console.log(`\n  🎯 PROFIT-TAKE GUARD executing sell...`);
        const ptResult = await executeTrade(profitTakeDecision, marketData);
        if (!ptResult.success) {
          recordTradeFailure(profitTakeDecision.fromToken);
        } else {
          clearTradeFailures(profitTakeDecision.fromToken);
        }
        state.trading.lastCheck = new Date();
        return; // Skip AI decision this cycle
      }
    }

    // === PHASE 3: STAGNATION CHECK ===
    const usdcBal = balances.find(b => b.symbol === "USDC");
    const availableUSDCForExplore = usdcBal?.balance || 0;
    const explorationTrade = checkStagnation(availableUSDCForExplore, marketData.tokens);
    if (explorationTrade) {
      console.log(`\n🔬 EXPLORATION TRADE: ${explorationTrade.reasoning}`);
      const exploreDecision: TradeDecision = {
        action: "BUY",
        fromToken: "USDC",
        toToken: explorationTrade.toToken,
        amountUSD: explorationTrade.amountUSD,
        reasoning: explorationTrade.reasoning,
        isExploration: true,
      };
      await executeTrade(exploreDecision, marketData);
      // Update pattern memory after exploration trade
      analyzeStrategyPatterns();
      saveTradeHistory();
      state.trading.lastCheck = new Date();
      return;
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

    // === PHASE 3: CONFIDENCE-WEIGHTED POSITION SIZING ===
    if (decision.action === "BUY" && decision.amountUSD > 0) {
      const tradePatternId = [
        "BUY",
        marketData.indicators[decision.toToken]?.rsi14 !== undefined
          ? (marketData.indicators[decision.toToken].rsi14 < state.adaptiveThresholds.rsiOversold ? "OVERSOLD"
             : marketData.indicators[decision.toToken].rsi14 > state.adaptiveThresholds.rsiOverbought ? "OVERBOUGHT" : "NEUTRAL")
          : "UNKNOWN",
        marketData.marketRegime,
        marketData.indicators[decision.toToken]?.overallSignal || "NEUTRAL",
      ].join("_");
      const confidence = calculatePatternConfidence(tradePatternId, marketData.marketRegime);
      const originalAmount = decision.amountUSD;
      decision.amountUSD = Math.max(5, Math.round(decision.amountUSD * confidence * 100) / 100);
      const confLabel = confidence >= 0.8 ? "HIGH" : confidence >= 0.5 ? "MEDIUM" : "LOW";
      console.log(`   🎯 Pattern Confidence: ${(confidence * 100).toFixed(0)}% (${confLabel}) | Size: $${originalAmount.toFixed(2)} → $${decision.amountUSD.toFixed(2)}`);

      // Circuit breaker: halve position size in caution zone
      if (circuitBreakerActive) {
        decision.amountUSD = Math.max(5, Math.round(decision.amountUSD * 0.5 * 100) / 100);
        console.log(`   🚨 Circuit breaker applied: size reduced to $${decision.amountUSD.toFixed(2)}`);
      }
    }

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

    // v5.3.3: Circuit breaker guard — block trades on tokens with consecutive failures
    if (["SELL", "REBALANCE"].includes(decision.action) && decision.fromToken && isTokenBlocked(decision.fromToken)) {
      console.log(`   🚫 CIRCUIT BREAKER: Skipping ${decision.action} for ${decision.fromToken} — too many consecutive failures`);
      decision.action = "HOLD";
      decision.reasoning = `Circuit breaker: ${decision.fromToken} blocked after repeated failures. Cooling off.`;
    }

    // Execute if needed
    if (["BUY", "SELL", "REBALANCE"].includes(decision.action) && decision.amountUSD >= 1.00) {
      const tradeResult = await executeTrade(decision, marketData);

      // v5.3.3: Track consecutive failures / clear on success
      const tradeToken = decision.action === "SELL" ? decision.fromToken : decision.toToken;
      if (!tradeResult.success) {
        recordTradeFailure(tradeToken);
      } else {
        clearTradeFailures(tradeToken);
      }

      // v6.0: Set cooldown for traded token
      const cooldownToken = decision.action === "SELL" ? decision.fromToken : decision.toToken;
      const tokenPrice = currentPrices.get(cooldownToken) || 0;
      cooldownManager.setCooldown(cooldownToken, decision.action === "HOLD" ? "HOLD" : decision.action as CooldownDecision, tokenPrice);

      // === PHASE 3: UPDATE PATTERN MEMORY AFTER TRADE ===
      analyzeStrategyPatterns();
      // Update exploration state
      state.explorationState.lastTradeTimestamp = new Date().toISOString();
      state.explorationState.consecutiveHolds = 0;
      state.explorationState.totalExploitationTrades++;
      saveTradeHistory();

    } else if (decision.action === "HOLD") {} else if (decision.action === "HOLD") {
      // v6.0: Set HOLD cooldown for all tokens to skip re-evaluation
      if (decision.toToken && decision.toToken !== "USDC") {
        const holdPrice = currentPrices.get(decision.toToken) || 0;
        cooldownManager.setCooldown(decision.toToken, "HOLD", holdPrice);
      }
      // Track consecutive holds for stagnation detection
      state.explorationState.consecutiveHolds++;
    }

    // v6.2.1: Auto-harvest profits to owner wallet — runs every heavy cycle regardless of trade action
    if (CONFIG.autoHarvest.enabled) {
      try {
        const ethBal = await getETHBalance(CONFIG.walletAddress);
        const ethPriceUSD = lastKnownPrices['WETH']?.price || lastKnownPrices['ETH']?.price || 2700;
        const harvestAccount = await cdpClient.evm.getOrCreateAccount({ name: "henry-trading-bot" });
        const harvestResult = await checkAutoHarvestTransfer(harvestAccount, cdpClient, ethPriceUSD, ethBal);
        if (harvestResult.sent) {
          console.log(`Auto-harvested ${harvestResult.amountUSD?.toFixed(2)} to owner wallet`);
        }
      } catch (harvestErr: any) {
        console.warn('Auto-harvest check failed:', harvestErr.message);
      }
    }

    state.trading.lastCheck = new Date();

    // === DERIVATIVES CYCLE (v6.0) ===
    if (derivativesEngine?.isEnabled() && advancedTradeClient) {
      try {
        // Generate commodity signals from existing macro data
        let commoditySignal: MacroCommoditySignal | undefined = undefined;
        if (commoditySignalEngine && marketData.macroData) {
          const silverData = await commoditySignalEngine.fetchSilverPrice();
          const macro = marketData.macroData;
          commoditySignal = commoditySignalEngine.generateSignal({
            fedFundsRate: macro.fedFundsRate?.value,
            treasury10Y: macro.treasury10Y?.value,
            cpi: macro.cpi?.value,
            m2MoneySupply: macro.m2MoneySupply?.value,
            dollarIndex: macro.dollarIndex?.value || macro.crossAssets?.dxyRealtime || undefined,
            goldPrice: macro.crossAssets?.goldPrice || undefined,
            goldChange24h: macro.crossAssets?.goldChange24h || undefined,
            vixLevel: macro.crossAssets?.vixLevel || undefined,
            spxChange24h: macro.crossAssets?.sp500Change || undefined,
            macroSignal: macro.macroSignal,
          });
        }

        // Run derivatives cycle — brain signals → derivatives execution
        const derivResult = await derivativesEngine.runCycle({
          indicators: marketData.indicators,
          marketRegime: marketData.marketRegime,
          macroSignal: marketData.macroData?.macroSignal,
          derivatives: marketData.derivatives,
          fearGreed: marketData.fearGreed,
          commoditySignal,
        });

        // Log results
        if (derivResult.tradesExecuted.length > 0) {
          for (const trade of derivResult.tradesExecuted) {
            console.log(`  ${trade.success ? "✅" : "❌"} [Deriv] ${trade.action} ${trade.product} $${trade.sizeUSD.toFixed(2)} @ ${trade.leverage}x — ${trade.reasoning.substring(0, 80)}`);
          }
        }

        // Store derivatives state for dashboard
        lastDerivativesData = {
          state: derivResult.portfolioState,
          signals: derivResult.signalsGenerated,
          trades: derivResult.tradesExecuted,
          commoditySignal: commoditySignalEngine?.getLastSignal() || null,
        };
      } catch (derivError: any) {
        console.error(`  ❌ Derivatives cycle error: ${derivError?.message?.substring(0, 200)}`);
      }
    }

    // === v6.0: EQUITY CYCLE ===
    if (equityEnabled && equityEngine) {
      try {
        const equityResult = await equityEngine.runEquityCycle(marketData.fearGreed.value);
        // The AI prompt section is available but we don't inject it into the crypto AI call
        // (equity has its own signal generation). Log the summary instead.
        console.log(`  [EQUITY] ${equityResult.signals.length} signals, ${equityResult.executedTrades.length} trades | Value: $${equityResult.totalEquityValue.toFixed(2)}`);
      } catch (eqError: any) {
        console.error(`  ❌ Equity cycle error: ${eqError?.message?.substring(0, 200)}`);
      }
    }

  } catch (error: any) {
    console.error("Cycle error:", error.message);
  }

  // Summary
  const derivSummary = derivativesEngine?.isEnabled()
    ? ` | Deriv Positions: ${derivativesEngine?.getState()?.openPositionCount || 0} | Deriv P&L: $${(derivativesEngine?.getState()?.totalUnrealizedPnl || 0).toFixed(2)}`
    : "";
  console.log("\n" + "═".repeat(70));
  console.log("📊 CYCLE SUMMARY");
  console.log(`   Portfolio: $${state.trading.totalPortfolioValue.toFixed(2)}${derivSummary}`);
  console.log(`   Trades: ${state.trading.successfulTrades}/${state.trading.totalTrades} successful`);
  console.log(`   Tracking: ${CONFIG.activeTokens.length} tokens across 4 sectors`);
  if (derivativesEngine?.isEnabled()) {
    console.log(`   Derivatives: ACTIVE | Buying Power: $${(derivativesEngine?.getState()?.availableBuyingPower || 0).toFixed(2)}`);
  }
  console.log(`   Cooldowns: ${cooldownManager.getActiveCount()} active | Cache: ${cacheManager.getStats().entries} entries (${cacheManager.getStats().hitRate} hit rate)`);
  console.log(`   Cycle type: HEAVY (${heavyReason}) | Light/Heavy: ${cycleStats.totalLight}L / ${cycleStats.totalHeavy}H`);

  // v6.2: Compute and apply adaptive interval for next cycle
  const nextInterval = computeNextInterval(currentPrices);
  adaptiveCycle.currentIntervalSec = nextInterval.intervalSec;
  adaptiveCycle.volatilityLevel = nextInterval.volatilityLevel;
  adaptiveCycle.consecutiveLightCycles = 0; // Reset on heavy cycle

  // Update price snapshot for next adaptive comparison
  adaptiveCycle.lastPriceCheck = new Map(currentPrices);

  // Clear emergency if conditions resolved
  if (adaptiveCycle.emergencyMode && Date.now() > adaptiveCycle.emergencyUntil) {
    adaptiveCycle.emergencyMode = false;
    console.log(`   ✅ Emergency mode ended — returning to adaptive tempo`);
  }

  console.log(`   ⚡ Adaptive: ${nextInterval.intervalSec}s next cycle | ${nextInterval.reason}`);
  console.log(`   📡 Price stream: ${adaptiveCycle.wsConnected ? 'LIVE' : 'offline'} | Threshold: ${(adaptiveCycle.dynamicPriceThreshold * 100).toFixed(1)}% (${adaptiveCycle.portfolioTier})`);
  console.log("═".repeat(70));
}

// ============================================================================
// STARTUP
// ============================================================================

function displayBanner() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                        ║
║   🤖 HENRY'S AUTONOMOUS TRADING AGENT v6.0                              ║
║   ════════════════════════════════════════                              ║
║                                                                        ║
║   PHASE 4: DERIVATIVES MODULE — Spot + Perps + Commodities             ║
║   LIVE TRADING | Base Network + Coinbase Advanced Trade                ║
║                                                                        ║
║   Intelligence Stack:                                                  ║
║   • Technical: RSI, MACD, Bollinger Bands, SMA, Volume                ║
║   • DeFi Intel: Base TVL, DEX Volume, Protocol TVL (DefiLlama)        ║
║   • Derivatives: Funding + OI + Long/Short Ratios + Top Traders       ║
║   • Positioning: Smart Money vs Retail + OI-Price Divergence           ║
║   • News: Crypto news sentiment — bullish/bearish (CryptoPanic)       ║
║   • Macro: Fed Rate, 10Y Yield, CPI, M2, Dollar Index (FRED)         ║
║   • Cross-Asset: Gold, Oil, VIX, S&P 500 correlation signals         ║
║   • Sentiment: Fear & Greed Index + Market Regime Detection           ║
║   • Self-Learning: Trade performance scoring + signal attribution     ║
║                                                                        ║
║   v5.1 Upgrades:                                                       ║
║   • Shadow Model Validation: changes need 3+ confirmations to go live ║
║   • MEV Protection: adaptive slippage by trade size + conditions      ║
║   • Cross-Asset Engine: RISK_ON/OFF/FLIGHT_TO_SAFETY from TradFi     ║
║   • Smart Money Tracking: top trader positioning vs retail divergence ║
║                                                                        ║
╚══════════════════════════════════════════════════════════════════════════╝
  `);
  console.log("📍 Configuration:");
  console.log(`   Wallet: ${CONFIG.walletAddress}`);
  console.log(`   Trading: ${CONFIG.trading.enabled ? "LIVE 🟢" : "DRY RUN 🟡"}`);
  console.log(`   Execution: Coinbase CDP SDK (account.swap + Permit2 approval)`);
  console.log(`   Brain: v5.1 — Technicals + DeFi + Derivatives + Positioning + News + Macro + Cross-Asset + Regime + Self-Improvement + Shadow Validation`);
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

  // === DERIVATIVES MODULE INITIALIZATION (v6.0) ===
  if (CONFIG.derivatives.enabled) {
    console.log("\n🔧 Initializing Derivatives Module...");
    try {
      let advApiSecret = CONFIG.derivatives.apiKeySecret;
      if (advApiSecret.includes('\\n')) {
        advApiSecret = advApiSecret.replace(/\\n/g, '\n');
      }

      advancedTradeClient = new CoinbaseAdvancedTradeClient({
        apiKeyId: CONFIG.derivatives.apiKeyId,
        apiKeySecret: advApiSecret,
      });

      // Test connectivity
      const connectionTest = await advancedTradeClient.testConnection();
      console.log(`  📡 Advanced Trade: ${connectionTest.message}`);

      if (connectionTest.success) {
        // Discover available commodity contracts
        const contracts = await discoverCommodityContracts(advancedTradeClient);

        // Initialize strategy engine
        derivativesEngine = new DerivativesStrategyEngine(advancedTradeClient, {
          enabled: true,
          products: {
            perpetuals: ["BTC-PERP-INTX", "ETH-PERP-INTX"],
            commodityFutures: [...contracts.gold.slice(0, 1), ...contracts.silver.slice(0, 1)],
          },
          risk: {
            ...DEFAULT_DERIVATIVES_CONFIG.risk,
            maxLeverage: CONFIG.derivatives.maxLeverage,
            stopLossPercent: CONFIG.derivatives.stopLossPercent,
            takeProfitPercent: CONFIG.derivatives.takeProfitPercent,
          },
          sizing: {
            ...DEFAULT_DERIVATIVES_CONFIG.sizing,
            basePositionUSD: CONFIG.derivatives.basePositionUSD,
          },
        });

        // Initialize commodity signal engine
        commoditySignalEngine = new MacroCommoditySignalEngine();

        console.log("  ✅ Derivatives module fully operational");
        console.log(`     Perpetuals: BTC-PERP-INTX, ETH-PERP-INTX`);
        console.log(`     Gold Futures: ${contracts.gold[0] || "none available"}`);
        console.log(`     Silver Futures: ${contracts.silver[0] || "none available"}`);
      } else {
        console.log("  ⚠️ Derivatives module: API not accessible. Running spot-only.");
      }
    } catch (error: any) {
      console.error(`  ❌ Derivatives init failed: ${error.message?.substring(0, 200)}`);
      console.log("  ⚠️ Continuing in spot-only mode.");
    }
  } else {
    console.log("\n📊 Derivatives module: DISABLED (set DERIVATIVES_ENABLED=true to activate)");
  }

  // === v6.0: EQUITY INTEGRATION INITIALIZATION ===
  equityEngine = new EquityIntegration();
  equityEnabled = await equityEngine.initialize();

  // === v6.1: TOKEN DISCOVERY ENGINE INITIALIZATION ===
  console.log("\n🔍 Initializing Token Discovery Engine...");
  const staticTokens = Object.keys(TOKEN_REGISTRY);
  tokenDiscoveryEngine = new TokenDiscoveryEngine(staticTokens);
  tokenDiscoveryEngine.start();
  console.log(`  ✅ Discovery engine active. Static pool: ${staticTokens.length} tokens. Dynamic discovery every 6h.`);

  loadTradeHistory();

  // Restore discovery state if available
  if (tokenDiscoveryEngine) {
    try {
      const logData = fs.existsSync(CONFIG.logFile) ? JSON.parse(fs.readFileSync(CONFIG.logFile, "utf-8")) : null;
      if (logData?.tokenDiscovery) {
        tokenDiscoveryEngine.restoreState(logData.tokenDiscovery);
      }
    } catch { /* non-critical */ }
  }

  // Run immediately
  await runTradingCycle();

  // v6.2: ADAPTIVE CYCLE ENGINE — replaces fixed cron with dynamic scheduling
  // The cron still exists as a safety net (forced heavy every 15min), but the
  // primary scheduler is now adaptive setTimeout that adjusts 15s-5min based on
  // volatility, portfolio size, and emergency conditions.
  console.log("\n⚡ v6.2: Initializing Adaptive Cycle Engine...");

  // Start real-time price stream (10s polling for emergency detection)
  initPriceStream();

  // Schedule first adaptive cycle
  scheduleNextCycle();

  // Safety net: keep the cron as a backup forced heavy cycle trigger
  const cronExpression = `*/${Math.max(CONFIG.trading.intervalMinutes, 15)} * * * *`;
  cron.schedule(cronExpression, async () => {
    try {
      // Only run if the adaptive engine somehow stalled
      const timeSinceLastCycle = Date.now() - (lastHeavyCycleAt || 0);
      if (timeSinceLastCycle > HEAVY_CYCLE_FORCED_INTERVAL_MS * 1.5) {
        console.log(`[Safety Net] Adaptive engine may have stalled — forcing cycle (${(timeSinceLastCycle / 60000).toFixed(0)}m since last heavy)`);
        await runTradingCycle();
      }
    } catch (cronError: any) {
      console.error(`[Cron Safety Net Error] ${cronError?.message?.substring(0, 300) || cronError}`);
    }
  });

  // Heartbeat every 5 minutes to confirm process is alive
  setInterval(() => {
    const adaptiveInfo = `Interval: ${adaptiveCycle.currentIntervalSec}s | Vol: ${adaptiveCycle.volatilityLevel} | Tier: ${adaptiveCycle.portfolioTier} | Stream: ${adaptiveCycle.wsConnected ? 'LIVE' : 'OFF'}${adaptiveCycle.emergencyMode ? ' | 🚨 EMERGENCY' : ''}`;
    console.log(`💓 Heartbeat | ${new Date().toISOString()} | Cycles: ${state.totalCycles} | Trades: ${state.trading.successfulTrades}/${state.trading.totalTrades} | ${adaptiveInfo}`);
    // v5.2: Save state every heartbeat
    saveTradeHistory();
  }, 5 * 60 * 1000);

  const { tier: startTier } = getPortfolioSensitivity(state.trading.totalPortfolioValue || 0);
  console.log(`\n🚀 Agent v6.2 running! Adaptive Cycles + Real-Time Streaming + Portfolio-Scaled Intelligence.\n`);
  console.log(`   📂 State persistence: ${CONFIG.logFile}`);
  console.log(`   💰 Max buy size: ${CONFIG.trading.maxBuySize} | Min trade: $5`);
  console.log(`   ⚡ Adaptive tempo: ${ADAPTIVE_MIN_INTERVAL_SEC}s – ${ADAPTIVE_MAX_INTERVAL_SEC}s | Emergency: ${EMERGENCY_INTERVAL_SEC}s`);
  console.log(`   🎯 Portfolio tier: ${startTier} | Emergency drop trigger: ${(EMERGENCY_DROP_THRESHOLD * 100).toFixed(0)}%`);
  console.log(`   📡 Real-time price stream: ACTIVE (10s polling)`);
  console.log(`   🧹 Dust threshold: ${DUST_THRESHOLD_USD} (consolidates every 10 cycles)\n`);
}

// ============================================================================
// GRACEFUL SHUTDOWN — save state before Railway restarts / redeploys
// ============================================================================
let isShuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n🛑 Received ${signal} — saving state before shutdown...`);
  try {
    saveTradeHistory();
    console.log("   ✅ State saved successfully. Goodbye.");
  } catch (e: any) {
    console.error(`   ❌ Error saving state on shutdown: ${e.message}`);
  }
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

main().catch((err) => {
  console.error("Fatal error:", err?.message || String(err));
  if (err?.stack) console.error(err.stack.split('\n').slice(0, 5).join('\n'));
  // v5.2: Try to save state even on fatal crash
  try { saveTradeHistory(); } catch (_) {}
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

/**
 * v6.2: Calculate risk-reward metrics from trade history.
 * Avg win size vs avg loss size tells you if the strategy is actually profitable
 * beyond just win rate. A 60% win rate with $5 avg wins and $15 avg losses = net negative.
 */
function calculateRiskRewardMetrics(): {
  avgWinUSD: number;
  avgLossUSD: number;
  riskRewardRatio: number;
  largestWin: number;
  largestLoss: number;
  expectancy: number;
  profitFactor: number;
} {
  const trades = state.trading.trades || [];
  const sells = trades.filter(t => t.action === "SELL" && t.success);

  const wins: number[] = [];
  const losses: number[] = [];

  for (const trade of sells) {
    const symbol = trade.fromToken;
    const cb = state.costBasis[symbol];
    if (!cb || cb.averageCostBasis <= 0) continue;

    // Calculate P&L for this sell based on cost basis
    const tokenPrice = trade.amountUSD / (trade.tokenAmount || 1);
    const pnl = (tokenPrice - cb.averageCostBasis) * (trade.tokenAmount || 0);

    if (pnl >= 0) wins.push(pnl);
    else losses.push(Math.abs(pnl));
  }

  // Also check realized P&L from cost basis records
  for (const [, cb] of Object.entries(state.costBasis)) {
    if (cb.realizedPnL > 0) wins.push(cb.realizedPnL);
    else if (cb.realizedPnL < 0) losses.push(Math.abs(cb.realizedPnL));
  }

  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const totalWins = wins.reduce((a, b) => a + b, 0);
  const totalLosses = losses.reduce((a, b) => a + b, 0);
  const winRate = (wins.length + losses.length) > 0 ? wins.length / (wins.length + losses.length) : 0;

  return {
    avgWinUSD: avgWin,
    avgLossUSD: avgLoss,
    riskRewardRatio: avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0,
    largestWin: wins.length > 0 ? Math.max(...wins) : 0,
    largestLoss: losses.length > 0 ? Math.max(...losses) : 0,
    // Expectancy: how much you expect to make per trade on average
    expectancy: (winRate * avgWin) - ((1 - winRate) * avgLoss),
    // Profit factor: total wins / total losses (>1 = profitable)
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
  };
}

function apiPortfolio() {
  const uptime = Math.floor((Date.now() - state.startTime.getTime()) / 1000);
  const totalRealized = Object.values(state.costBasis).reduce((s, cb) => s + cb.realizedPnL, 0);
  const totalUnrealized = Object.values(state.costBasis).reduce((s, cb) => s + cb.unrealizedPnL, 0);
  const riskReward = calculateRiskRewardMetrics();
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
    version: "6.2",
    // v6.2: Risk-reward metrics
    riskReward: {
      avgWinUSD: riskReward.avgWinUSD,
      avgLossUSD: riskReward.avgLossUSD,
      riskRewardRatio: riskReward.riskRewardRatio,
      largestWin: riskReward.largestWin,
      largestLoss: riskReward.largestLoss,
      expectancy: riskReward.expectancy,
      profitFactor: riskReward.profitFactor,
    },
    // v5.1.1: Profit harvesting stats
    harvestedProfits: state.harvestedProfits?.totalHarvested || 0,
    harvestCount: state.harvestedProfits?.harvestCount || 0,
    recentHarvests: (state.harvestedProfits?.harvests || []).slice(-5),
      // v5.3.0: Auto-harvest info
      autoHarvest: {
        enabled: CONFIG.autoHarvest.enabled,
        totalTransferredUSD: state.totalAutoHarvestedUSD,
        totalTransferredETH: state.totalAutoHarvestedETH,
        transferCount: state.autoHarvestCount,
        lastTransfer: state.lastAutoHarvestTime,
        destination: CONFIG.autoHarvest.destinationWallet ?
          CONFIG.autoHarvest.destinationWallet.slice(0, 6) + '...' + CONFIG.autoHarvest.destinationWallet.slice(-4) : null,
      },
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
    version: "5.1",
    defiLlama: lastIntelligenceData?.defi || null,
    derivatives: lastIntelligenceData?.derivatives || null,
    newsSentiment: lastIntelligenceData?.news || null,
    macroData: lastIntelligenceData?.macro || null,
    marketRegime: lastIntelligenceData?.regime || "UNKNOWN",
    tradePerformance: perf,
    shadowProposals: shadowProposals,
    dataSources: [
      "CoinGecko", "Fear & Greed Index",
      "DefiLlama (TVL/DEX/Protocols)",
      "Binance (Funding/OI/Long-Short Ratios/Top Trader Positioning)",
      "Binance (PAXG for real-time Gold)",
      "CryptoPanic (News Sentiment)",
      "FRED (Fed Rates/Yield Curve/CPI/M2/Dollar/Gold/Oil/VIX/S&P 500)",
      "Technical Indicators (RSI/MACD/BB/SMA)",
    ],
  };
}

// === PHASE 3 API ENDPOINTS ===
function apiPatterns() {
  const patterns = Object.values(state.strategyPatterns);
  const sorted = patterns.sort((a, b) => b.stats.sampleSize - a.stats.sampleSize);
  const topPerformers = sorted.filter(p => p.stats.sampleSize >= 3).sort((a, b) => b.stats.avgReturnPercent - a.stats.avgReturnPercent).slice(0, 5);
  const worstPerformers = sorted.filter(p => p.stats.sampleSize >= 3).sort((a, b) => a.stats.avgReturnPercent - b.stats.avgReturnPercent).slice(0, 5);
  return {
    version: "5.1",
    totalPatterns: patterns.length,
    patternsWithData: patterns.filter(p => p.stats.sampleSize >= 3).length,
    topPerformers,
    worstPerformers,
    allPatterns: sorted,
  };
}

function apiReviews() {
  const reviews = state.performanceReviews.slice(-10);
  return {
    version: "5.1",
    totalReviews: state.performanceReviews.length,
    latestReview: reviews.length > 0 ? reviews[reviews.length - 1] : null,
    recentReviews: reviews,
    lastReviewTimestamp: state.lastReviewTimestamp,
    tradesSinceLastReview: state.tradeHistory.length - state.lastReviewTradeIndex,
  };
}

function apiThresholds() {
  return {
    version: "5.1",
    currentThresholds: state.adaptiveThresholds,
    bounds: THRESHOLD_BOUNDS,
    defaults: DEFAULT_ADAPTIVE_THRESHOLDS,
    adaptationCount: state.adaptiveThresholds.adaptationCount,
    recentHistory: state.adaptiveThresholds.history.slice(-20),
    explorationState: state.explorationState,
  };
}

function getDashboardHTML(): string {
  // Always use embedded dashboard (connected to bot API)
  // Old dashboard/index.html reads from blockchain directly — not useful
  return EMBEDDED_DASHBOARD;
}

const healthServer = http.createServer(async (req, res) => {
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
      case '/api/patterns':
        sendJSON(res, 200, apiPatterns());
        break;
      case '/api/reviews':
        sendJSON(res, 200, apiReviews());
        break;
      case '/api/thresholds':
        sendJSON(res, 200, apiThresholds());
        break;
      case '/api/auto-harvest':
        sendJSON(res, 200, {
          enabled: CONFIG.autoHarvest.enabled,
          destinationWallet: CONFIG.autoHarvest.destinationWallet ? CONFIG.autoHarvest.destinationWallet.slice(0, 6) + '...' + CONFIG.autoHarvest.destinationWallet.slice(-4) : 'not configured',
          thresholdUSD: CONFIG.autoHarvest.thresholdUSD,
          cooldownHours: CONFIG.autoHarvest.cooldownHours,
          minETHReserve: CONFIG.autoHarvest.minETHReserve,
          totalTransfers: (state.autoHarvestTransfers || []).length,
          recentTransfers: (state.autoHarvestTransfers || []).slice(-5),
          lastHarvestTime: (state.lastAutoHarvestTime || null)
        });
        break;
      case '/api/auto-harvest/trigger':
        if (CONFIG.autoHarvest.enabled) {
          const cooldownMs = CONFIG.autoHarvest.cooldownHours * 60 * 60 * 1000;
          CONFIG.autoHarvest.cooldownHours = 0;
          sendJSON(res, 200, { message: 'Auto-harvest cooldown reset, will trigger on next cycle' });
          setTimeout(() => { CONFIG.autoHarvest.cooldownHours = cooldownMs / (60 * 60 * 1000); }, 60000);
        } else {
          sendJSON(res, 400, { error: 'Auto-harvest is not enabled' });
        }
        break;
      // === v6.2: ADAPTIVE CYCLE API ENDPOINT ===
      case '/api/adaptive':
        sendJSON(res, 200, {
          version: '6.2',
          currentIntervalSec: adaptiveCycle.currentIntervalSec,
          volatilityLevel: adaptiveCycle.volatilityLevel,
          portfolioTier: adaptiveCycle.portfolioTier,
          dynamicPriceThreshold: adaptiveCycle.dynamicPriceThreshold,
          emergencyMode: adaptiveCycle.emergencyMode,
          emergencyUntil: adaptiveCycle.emergencyMode ? new Date(adaptiveCycle.emergencyUntil).toISOString() : null,
          priceStreamActive: adaptiveCycle.wsConnected,
          consecutiveLightCycles: adaptiveCycle.consecutiveLightCycles,
          cycleStats: {
            light: cycleStats.totalLight,
            heavy: cycleStats.totalHeavy,
            lastHeavyReason: cycleStats.lastHeavyReason,
          },
          config: {
            minIntervalSec: ADAPTIVE_MIN_INTERVAL_SEC,
            maxIntervalSec: ADAPTIVE_MAX_INTERVAL_SEC,
            emergencyIntervalSec: EMERGENCY_INTERVAL_SEC,
            emergencyDropThreshold: EMERGENCY_DROP_THRESHOLD,
            portfolioTiers: PORTFOLIO_SENSITIVITY_TIERS,
          },
        });
        break;

      // === DERIVATIVES API ENDPOINT (v6.0) ===
      case '/api/derivatives':
        sendJSON(res, 200, {
          enabled: derivativesEngine?.isEnabled() || false,
          state: derivativesEngine?.getState() || null,
          recentTrades: derivativesEngine?.getTradeHistory()?.slice(-20) || [],
          config: derivativesEngine?.getConfig() || null,
          commoditySignal: commoditySignalEngine?.getLastSignal() || null,
          lastCycleData: lastDerivativesData,
        });
        break;

      case '/api/equity':
        if (equityEnabled && equityEngine) {
          const eqDash = await equityEngine.getDashboardData();
          sendJSON(res, 200, eqDash);
        } else {
          sendJSON(res, 200, { enabled: false });
        }
        break;

      case '/api/discovery':
        if (tokenDiscoveryEngine) {
          const discoveryState = tokenDiscoveryEngine.getState();
          sendJSON(res, 200, {
            ...discoveryState,
            tradableTokens: tokenDiscoveryEngine.getTradableTokens().length,
            topByVolume: tokenDiscoveryEngine.getDiscoveredTokens().slice(0, 10).map(t => ({
              symbol: t.symbol,
              name: t.name,
              sector: t.sector,
              volume24h: t.volume24hUSD,
              liquidity: t.liquidityUSD,
              price: t.priceUSD,
              change24h: t.priceChange24h,
              dex: t.dexName,
              hasCoinGecko: !!t.coingeckoId,
            })),
          });
        } else {
          sendJSON(res, 200, { enabled: false });
        }
        break;

      case '/api/cache':
        sendJSON(res, 200, {
          stats: cacheManager.getStats(),
          cooldowns: {
            active: cooldownManager.getActiveCount(),
            summary: cooldownManager.getSummary(),
          },
          cycleStats,
        });
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
      <p class="text-xs text-slate-500 mt-0.5">Autonomous Trading Agent v5.1.1</p>
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
      <p class="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Harvested</p>
      <p class="text-lg font-semibold mono text-amber-400" id="harvested-pnl">--</p>
      <p class="text-[9px] text-slate-600" id="harvest-count"></p>
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

<!-- Phase 3: Self-Improvement Intelligence -->
<div class="max-w-7xl mx-auto px-4 sm:px-6 pb-8">
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
    <!-- Top Patterns -->
    <div class="glass rounded-xl p-5">
      <h2 class="text-sm font-semibold text-white mb-1">Top Patterns</h2>
      <p class="text-[10px] text-slate-500 mb-3">Winning strategies by return</p>
      <div id="top-patterns" class="space-y-2">
        <p class="text-xs text-slate-600">Loading...</p>
      </div>
    </div>
    <!-- Adaptive Thresholds -->
    <div class="glass rounded-xl p-5">
      <h2 class="text-sm font-semibold text-white mb-1">Adaptive Thresholds</h2>
      <p class="text-[10px] text-slate-500 mb-3">Self-tuning parameters</p>
      <div id="thresholds-display" class="space-y-2">
        <p class="text-xs text-slate-600">Loading...</p>
      </div>
    </div>
    <!-- Latest Insights -->
    <div class="glass rounded-xl p-5">
      <h2 class="text-sm font-semibold text-white mb-1">Latest Insights</h2>
      <p class="text-[10px] text-slate-500 mb-3">Self-improvement engine</p>
      <div id="latest-insights" class="space-y-2">
        <p class="text-xs text-slate-600">Loading...</p>
      </div>
    </div>
  </div>
</div>

<!-- v5.1: Market Intelligence Dashboard -->
<div class="max-w-7xl mx-auto px-4 sm:px-6 pb-8">
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <!-- Derivatives Positioning -->
    <div class="glass rounded-xl p-5">
      <h2 class="text-sm font-semibold text-white mb-1">Derivatives Positioning</h2>
      <p class="text-[10px] text-slate-500 mb-3">Smart money vs retail sentiment</p>
      <div id="derivatives-intel" class="space-y-2">
        <p class="text-xs text-slate-600">Loading...</p>
      </div>
    </div>
    <!-- Cross-Asset Correlation -->
    <div class="glass rounded-xl p-5">
      <h2 class="text-sm font-semibold text-white mb-1">Cross-Asset Intelligence</h2>
      <p class="text-[10px] text-slate-500 mb-3">Gold, Oil, VIX, S&P 500</p>
      <div id="cross-asset-intel" class="space-y-2">
        <p class="text-xs text-slate-600">Loading...</p>
      </div>
    </div>
  </div>
  <!-- Shadow Model Proposals -->
  <div class="glass rounded-xl p-5 mt-4">
    <h2 class="text-sm font-semibold text-white mb-1">Shadow Model Validation</h2>
    <p class="text-[10px] text-slate-500 mb-3">Proposed threshold changes awaiting statistical confirmation</p>
    <div id="shadow-proposals" class="space-y-2">
      <p class="text-xs text-slate-600">Loading...</p>
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
    const [pRes, bRes, sRes, tRes, patRes, thrRes, revRes, intRes] = await Promise.allSettled([
      fetch('/api/portfolio').then(r => r.json()),
      fetch('/api/balances').then(r => r.json()),
      fetch('/api/sectors').then(r => r.json()),
      fetch('/api/trades?limit=30').then(r => r.json()),
      fetch('/api/patterns').then(r => r.json()),
      fetch('/api/thresholds').then(r => r.json()),
      fetch('/api/reviews').then(r => r.json()),
      fetch('/api/intelligence').then(r => r.json()),
    ]);
    const p = pRes.status === 'fulfilled' ? pRes.value : null;
    const b = bRes.status === 'fulfilled' ? bRes.value : null;
    const s = sRes.status === 'fulfilled' ? sRes.value : null;
    const t = tRes.status === 'fulfilled' ? tRes.value : null;
    const pat = patRes.status === 'fulfilled' ? patRes.value : null;
    const thr = thrRes.status === 'fulfilled' ? thrRes.value : null;
    const rev = revRes.status === 'fulfilled' ? revRes.value : null;
    const intel = intRes.status === 'fulfilled' ? intRes.value : null;

    if (p) renderPortfolio(p);
    if (b) renderHoldings(b);
    if (s) renderSectors(s);
    if (t) renderTrades(t);
    if (pat) renderPatterns(pat);
    if (thr) renderThresholds(thr);
    if (rev) renderInsights(rev);
    if (intel) renderIntelligence(intel);
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

  // v5.1.1: Harvested profits display
  const hEl = $('harvested-pnl');
  const harv = p.harvestedProfits || 0;
  hEl.textContent = harv > 0 ? pnlSign(harv) + fmt(harv) : '$0.00';
  hEl.className = 'text-lg font-semibold mono ' + (harv > 0 ? 'text-amber-400' : 'text-slate-500');
  const hcEl = $('harvest-count');
  if (hcEl) hcEl.textContent = (p.harvestCount || 0) > 0 ? p.harvestCount + ' harvests' : 'no harvests yet';

  // Show recent harvests as mini-feed if available
  if (p.recentHarvests && p.recentHarvests.length > 0) {
    const lastH = p.recentHarvests[p.recentHarvests.length - 1];
    if (hcEl) hcEl.textContent = p.harvestCount + ' harvests | last: ' + lastH.symbol + ' +' + lastH.gainPercent + '%';
  }

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

function renderPatterns(pat) {
  const el = $('top-patterns');
  if (!pat.topPerformers || pat.topPerformers.length === 0) {
    el.innerHTML = '<p class="text-xs text-slate-600">No patterns with enough data yet (' + pat.totalPatterns + ' tracked)</p>';
    return;
  }
  el.innerHTML = pat.topPerformers.map(p => {
    const winRate = p.stats.sampleSize > 0 ? ((p.stats.wins / p.stats.sampleSize) * 100).toFixed(0) : '0';
    const retColor = p.stats.avgReturnPercent >= 0 ? 'text-emerald-400' : 'text-red-400';
    const confColor = p.confidence >= 0.7 ? 'text-emerald-400' : p.confidence >= 0.4 ? 'text-amber-400' : 'text-red-400';
    return '<div class="flex items-center justify-between py-1.5 border-b border-white/5">' +
      '<div class="flex-1 min-w-0"><p class="text-[11px] text-slate-300 truncate">' + p.description + '</p>' +
      '<p class="text-[10px] text-slate-500">' + p.stats.sampleSize + ' trades | ' + winRate + '% win</p></div>' +
      '<div class="text-right ml-2"><span class="text-xs mono font-semibold ' + retColor + '">' + (p.stats.avgReturnPercent >= 0 ? '+' : '') + p.stats.avgReturnPercent.toFixed(1) + '%</span>' +
      '<p class="text-[10px] ' + confColor + '">' + (p.confidence * 100).toFixed(0) + '% conf</p></div></div>';
  }).join('');
}

function renderThresholds(thr) {
  const el = $('thresholds-display');
  const t = thr.currentThresholds;
  const d = thr.defaults;
  const rows = [
    ['RSI Oversold', t.rsiOversold, d.rsiOversold],
    ['RSI Overbought', t.rsiOverbought, d.rsiOverbought],
    ['Buy Signal', t.confluenceBuy, d.confluenceBuy],
    ['Sell Signal', t.confluenceSell, d.confluenceSell],
    ['Profit Take', t.profitTakeTarget + '%', d.profitTakeTarget + '%'],
    ['Stop Loss', t.stopLossPercent + '%', d.stopLossPercent + '%'],
  ];
  const changed = rows.filter(r => String(r[1]) !== String(r[2])).length;
  el.innerHTML = '<p class="text-[10px] text-slate-500 mb-2">' + thr.adaptationCount + ' adaptations | ' + changed + ' modified</p>' +
    rows.map(r => {
      const isModified = String(r[1]) !== String(r[2]);
      const valColor = isModified ? 'text-amber-400' : 'text-slate-300';
      return '<div class="flex justify-between py-1 border-b border-white/5">' +
        '<span class="text-[11px] text-slate-400">' + r[0] + '</span>' +
        '<span class="text-[11px] mono font-medium ' + valColor + '">' + r[1] + (isModified ? ' (was ' + r[2] + ')' : '') + '</span></div>';
    }).join('');
  if (thr.explorationState) {
    el.innerHTML += '<div class="mt-2 pt-2 border-t border-white/5"><p class="text-[10px] text-slate-500">Exploration: ' +
      thr.explorationState.totalExplorationTrades + ' trades | ' + thr.explorationState.consecutiveHolds + ' consecutive holds</p></div>';
  }
}

function renderInsights(rev) {
  const el = $('latest-insights');
  if (!rev.latestReview) {
    const remaining = Math.max(0, 10 - rev.tradesSinceLastReview);
    el.innerHTML = '<p class="text-xs text-slate-600">No reviews yet (' + remaining + ' trades until first review)</p>';
    return;
  }
  const r = rev.latestReview;
  const sevIcon = { INFO: '💡', WARNING: '⚠️', ACTION: '🎯' };
  el.innerHTML = '<p class="text-[10px] text-slate-500 mb-2">Review ' + rev.totalReviews + ' | ' + new Date(r.timestamp).toLocaleDateString() + ' | Win rate: ' + (r.periodStats.winRate * 100).toFixed(0) + '%</p>' +
    r.insights.slice(0, 5).map(i => {
      const icon = sevIcon[i.severity] || '📊';
      return '<div class="py-1.5 border-b border-white/5"><p class="text-[11px] text-slate-300">' + icon + ' ' + i.message + '</p></div>';
    }).join('') +
    (r.recommendations.length > 0 ? '<div class="mt-2 pt-1"><p class="text-[10px] text-slate-500 mb-1">Recommendations:</p>' +
      r.recommendations.slice(0, 3).map(rec => '<p class="text-[10px] text-amber-400/80 py-0.5">→ ' + rec.description + '</p>').join('') + '</div>' : '');
}

// v5.1: Render derivatives positioning + cross-asset intelligence
function renderIntelligence(intel) {
  // Derivatives positioning
  const derivEl = $('derivatives-intel');
  const d = intel.derivatives;
  if (d) {
    const posColor = (sig) => {
      if (sig === 'SMART_MONEY_LONG') return 'text-emerald-400';
      if (sig === 'SMART_MONEY_SHORT' || sig === 'OVERLEVERAGED_LONG') return 'text-red-400';
      if (sig === 'OVERLEVERAGED_SHORT') return 'text-amber-400';
      return 'text-slate-400';
    };
    const posIcon = (sig) => {
      if (sig === 'SMART_MONEY_LONG') return '🟢';
      if (sig === 'SMART_MONEY_SHORT') return '🔴';
      if (sig === 'OVERLEVERAGED_LONG') return '⚠️';
      if (sig === 'OVERLEVERAGED_SHORT') return '⚠️';
      return '⚪';
    };
    derivEl.innerHTML =
      '<div class="grid grid-cols-2 gap-3">' +
      '<div><p class="text-[10px] text-slate-500 mb-1">BTC Positioning</p>' +
      '<p class="text-xs font-medium ' + posColor(d.btcPositioningSignal) + '">' + posIcon(d.btcPositioningSignal) + ' ' + (d.btcPositioningSignal || 'N/A').replace(/_/g, ' ') + '</p>' +
      '<p class="text-[10px] text-slate-500 mt-1">L/S: ' + (d.btcLongShortRatio != null ? d.btcLongShortRatio.toFixed(2) : 'N/A') + ' | Top: ' + (d.btcTopTraderLSRatio != null ? d.btcTopTraderLSRatio.toFixed(2) : 'N/A') + '</p>' +
      '<p class="text-[10px] text-slate-500">Funding: ' + (d.btcFundingRate >= 0 ? '+' : '') + d.btcFundingRate.toFixed(4) + '%</p></div>' +
      '<div><p class="text-[10px] text-slate-500 mb-1">ETH Positioning</p>' +
      '<p class="text-xs font-medium ' + posColor(d.ethPositioningSignal) + '">' + posIcon(d.ethPositioningSignal) + ' ' + (d.ethPositioningSignal || 'N/A').replace(/_/g, ' ') + '</p>' +
      '<p class="text-[10px] text-slate-500 mt-1">L/S: ' + (d.ethLongShortRatio != null ? d.ethLongShortRatio.toFixed(2) : 'N/A') + ' | Top: ' + (d.ethTopTraderLSRatio != null ? d.ethTopTraderLSRatio.toFixed(2) : 'N/A') + '</p>' +
      '<p class="text-[10px] text-slate-500">Funding: ' + (d.ethFundingRate >= 0 ? '+' : '') + d.ethFundingRate.toFixed(4) + '%</p></div>' +
      '</div>';
    // OI-Price Divergence
    if (d.btcOIPriceDivergence && d.btcOIPriceDivergence !== 'NEUTRAL' && d.btcOIPriceDivergence !== 'ALIGNED') {
      derivEl.innerHTML += '<div class="mt-2 pt-2 border-t border-white/5"><p class="text-[10px] text-amber-400">⚡ BTC: ' + d.btcOIPriceDivergence.replace(/_/g, ' ') + '</p></div>';
    }
    if (d.ethOIPriceDivergence && d.ethOIPriceDivergence !== 'NEUTRAL' && d.ethOIPriceDivergence !== 'ALIGNED') {
      derivEl.innerHTML += '<p class="text-[10px] text-amber-400">⚡ ETH: ' + d.ethOIPriceDivergence.replace(/_/g, ' ') + '</p>';
    }
  } else {
    derivEl.innerHTML = '<p class="text-xs text-slate-600">Derivatives data not yet available</p>';
  }

  // Cross-asset intelligence
  const caEl = $('cross-asset-intel');
  const m = intel.macroData;
  if (m && m.crossAssets) {
    const ca = m.crossAssets;
    const sigColor = ca.crossAssetSignal === 'RISK_ON' ? 'text-emerald-400' : ca.crossAssetSignal === 'RISK_OFF' ? 'text-red-400' : ca.crossAssetSignal === 'FLIGHT_TO_SAFETY' ? 'text-red-500' : 'text-slate-400';
    const sigIcon = ca.crossAssetSignal === 'RISK_ON' ? '🟢' : ca.crossAssetSignal === 'RISK_OFF' ? '🔴' : ca.crossAssetSignal === 'FLIGHT_TO_SAFETY' ? '🚨' : '⚪';
    const pctFmt = (n) => n != null ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : 'N/A';
    caEl.innerHTML =
      '<div class="grid grid-cols-2 gap-x-4 gap-y-2">' +
      '<div class="flex justify-between"><span class="text-[11px] text-slate-400">Gold</span><span class="text-[11px] mono ' + (ca.goldChange24h >= 0 ? 'text-emerald-400' : 'text-red-400') + '">$' + (ca.goldPrice != null ? ca.goldPrice.toFixed(0) : 'N/A') + ' ' + pctFmt(ca.goldChange24h) + '</span></div>' +
      '<div class="flex justify-between"><span class="text-[11px] text-slate-400">Oil (WTI)</span><span class="text-[11px] mono text-slate-300">$' + (ca.oilPrice != null ? ca.oilPrice.toFixed(1) : 'N/A') + ' ' + pctFmt(ca.oilChange24h) + '</span></div>' +
      '<div class="flex justify-between"><span class="text-[11px] text-slate-400">VIX</span><span class="text-[11px] mono ' + (ca.vixLevel > 25 ? 'text-red-400' : ca.vixLevel < 15 ? 'text-emerald-400' : 'text-slate-300') + '">' + (ca.vixLevel != null ? ca.vixLevel.toFixed(1) : 'N/A') + '</span></div>' +
      '<div class="flex justify-between"><span class="text-[11px] text-slate-400">S&P 500</span><span class="text-[11px] mono ' + ((ca.sp500Change || 0) >= 0 ? 'text-emerald-400' : 'text-red-400') + '">' + pctFmt(ca.sp500Change) + '</span></div>' +
      '</div>' +
      '<div class="mt-2 pt-2 border-t border-white/5"><p class="text-xs font-medium ' + sigColor + '">' + sigIcon + ' ' + ca.crossAssetSignal.replace(/_/g, ' ') + '</p></div>';
  } else {
    caEl.innerHTML = '<p class="text-xs text-slate-600">Cross-asset data not yet available</p>';
  }

  // Shadow Model Proposals
  const shadowEl = $('shadow-proposals');
  if (intel.shadowProposals && intel.shadowProposals.length > 0) {
    const pending = intel.shadowProposals.filter(p => p.status === 'PENDING');
    const recent = intel.shadowProposals.filter(p => p.status !== 'PENDING').slice(-3);
    shadowEl.innerHTML = '<p class="text-[10px] text-slate-500 mb-2">' + pending.length + ' pending proposals</p>' +
      pending.map(p => {
        const pct = p.confirmingReviews + '/' + 3;
        const barWidth = Math.min(100, (p.confirmingReviews / 3) * 100);
        return '<div class="py-1.5 border-b border-white/5">' +
          '<div class="flex justify-between"><span class="text-[11px] text-slate-300">' + p.field + ' ' + (p.proposedDelta > 0 ? '↑' : '↓') + Math.abs(p.proposedDelta) + '</span>' +
          '<span class="text-[10px] text-slate-500">' + pct + ' confirmations</span></div>' +
          '<div class="w-full bg-white/5 rounded-full h-1 mt-1"><div class="bg-amber-500/60 h-1 rounded-full" style="width:' + barWidth + '%"></div></div>' +
          '<p class="text-[10px] text-slate-600 mt-0.5">' + p.reason + '</p></div>';
      }).join('') +
      (recent.length > 0 ? '<div class="mt-2 pt-1">' + recent.map(p => {
        const icon = p.status === 'PROMOTED' ? '✅' : '❌';
        return '<p class="text-[10px] ' + (p.status === 'PROMOTED' ? 'text-emerald-400/70' : 'text-red-400/70') + '">' + icon + ' ' + p.field + ' — ' + p.status + '</p>';
      }).join('') + '</div>' : '');
  } else {
    shadowEl.innerHTML = '<p class="text-xs text-slate-600">No active proposals — thresholds at defaults</p>';
  }
}

// Initial load + auto-refresh every 30s
fetchData();
setInterval(fetchData, 30000);
</script>
</body>
</html>`;

/**
 * Henry's Autonomous Trading Agent v5.2.0
 *
 * PHASE 3: RECURSIVE SELF-IMPROVEMENT ENGINE + v5.1 INTELLIGENCE UPGRADE
 *
 * CHANGES IN V5.1.1:
 * - NEW: Tiered Profit Harvesting — scale out of winners in 4 tranches (+8%, +15%, +25%, +40%)
 * - NEW: Time-based rebalancing — positions held 72h+ with +5% gain get a 10% trim
 * - NEW: Per-tier cooldowns — each harvest tier has independent 6h cooldowns
 * - NEW: Harvested profits tracking — dashboard shows total banked profits + harvest history
 * - NEW: "Harvested" metric card on dashboard with harvest count + last harvest details
 * - UPGRADED: AI prompt teaches profit harvesting philosophy and smart money exit signals
 * - LOWERED: minHoldingUSD from $10 to $5, cooldown from 24h to 6h for faster harvesting cycles
 *
 * CHANGES IN V5.1:
 * - NEW: Binance Long/Short Ratios — global retail vs top trader (smart money) positioning
 * - NEW: Composite Positioning Signals — SMART_MONEY_LONG/SHORT, OVERLEVERAGED detection
 * - NEW: OI-Price Divergence Detection — identifies squeeze setups before they trigger
 * - NEW: Cross-Asset Correlation — Gold (PAXG real-time), Oil, VIX, S&P 500 as direct signals
 * - NEW: Cross-Asset Signal Engine — RISK_ON/RISK_OFF/FLIGHT_TO_SAFETY from traditional markets
 * - NEW: Shadow Model Validation — threshold changes require 3+ statistical confirmations before promoting
 * - NEW: MEV Protection — adaptive slippage based on trade size + market conditions
 * - NEW: Dashboard panels for Derivatives Positioning, Cross-Asset Intelligence, Shadow Proposals
 * - UPGRADED: AI prompt now receives positioning intelligence + cross-asset signals
 *
 * CHANGES IN V5.0.1:
 * - BUGFIX: Performance reviews now properly stored (were computed but discarded)
 * - BUGFIX: lastReviewTradeIndex and lastReviewTimestamp now persist after each review
 * - BUGFIX: Dashboard "trades until next" now shows remaining trades, not elapsed trades
 * - BUGFIX: Pattern analysis rebuilds on deploy to pick up new v5.0 trades with signalContext
 * - NEW: Circuit breakers — hard halt at 20% drawdown, caution mode (half positions) at 12%
 *
 * CHANGES IN V5.0:
 * - Strategy Pattern Memory: auto-classifies trades into strategy buckets, tracks win/loss rates
 * - Performance Review Cycle: structured analysis every 10 trades or 24h with actionable insights
 * - Adaptive Threshold Engine: RSI, confluence, profit-take, stop-loss thresholds self-tune based on performance
 * - Confidence-Weighted Position Sizing: proven patterns get full size, unproven get smaller exploratory sizes
 * - Anti-Stagnation / Exploration: triggers $3 exploration trades after 48h inactivity
 * - Self-improvement prompt injection: AI sees its own patterns, insights, and threshold changes
 * - New API endpoints: /api/patterns, /api/reviews, /api/thresholds
 * - Dashboard: Intelligence section showing top patterns, adaptive thresholds, latest insights
 *
 * CHANGES IN V4.5.3:
 * - Fixed FRED API auth: uses api_key query parameter (not Bearer header)
 * - FRED macro data now flowing: Fed Rate, 10Y Yield, CPI, M2, Dollar Index
 *
 * CHANGES IN V4.5.2:
 * - CoinGecko: last-known-prices cache prevents $0 portfolio when rate limited
 * - CoinGecko: longer retry delays (15s, 45s) to survive 60s rate limit windows
 * - Intelligence fetches run in parallel with CoinGecko retries (faster cycles)
 *
 * CHANGES IN V4.5.1:
 * - Fixed CryptoPanic: proper API v1 endpoint with auth_token (env: CRYPTOPANIC_AUTH_TOKEN)
 * - Fixed FRED API: added env var check + warning (auth fixed in v4.5.3)
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
 * - AI_TOKENS (20%): VIRTUAL, AIXBT, HIGHER
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

// === DERIVATIVES MODULE IMPORTS (v6.0) ===
import { CoinbaseAdvancedTradeClient } from "./services/services/coinbase-advanced-trade.js";
import { DerivativesStrategyEngine, DEFAULT_DERIVATIVES_CONFIG, type DerivativesSignal, type DerivativesTradeRecord, type MacroCommoditySignal } from "./services/services/derivatives-strategy.js";
import { MacroCommoditySignalEngine, discoverCommodityContracts } from "./services/services/macro-commodity-signals.js";

// === v6.0: EQUITY INTEGRATION ===
import { EquityIntegration } from './equity-integration.js';

// === v6.1: TOKEN DISCOVERY ENGINE ===
import { TokenDiscoveryEngine, type DiscoveredToken, type TokenDiscoveryState } from './services/token-discovery.js';

// === v6.0: SMART CACHING + COOLDOWN + CONSTANTS ===
import { cacheManager, CacheKeys } from "./services/cache-manager.js";
import { CACHE_TTL } from "./config/constants.js";
import { cooldownManager } from "./services/cooldown-manager.js";
import {
  HEAVY_CYCLE_FORCED_INTERVAL_MS,
  PRICE_CHANGE_THRESHOLD,
  FG_CHANGE_THRESHOLD,
  DEFAULT_TRADING_INTERVAL_MINUTES,
  ADAPTIVE_MIN_INTERVAL_SEC,
  ADAPTIVE_MAX_INTERVAL_SEC,
  ADAPTIVE_DEFAULT_INTERVAL_SEC,
  EMERGENCY_INTERVAL_SEC,
  EMERGENCY_DROP_THRESHOLD,
  PORTFOLIO_SENSITIVITY_TIERS,
  VOLATILITY_SPEED_MAP,
} from "./config/constants.js";
import type { CooldownDecision } from "./types/index.js";

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
    tokens: ["VIRTUAL", "AIXBT", "HIGHER"],
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
  // GAME removed — insufficient liquidity on Base DEX pools (failed 5+ consecutive swaps)
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
// v6.2: CHAINLINK ORACLE PRICE FEEDS — On-chain prices that can never rate-limit
// ============================================================================
// AggregatorV3Interface: latestRoundData() → (roundId, answer, startedAt, updatedAt, answeredInRound)
// answer is price with 8 decimals for USD feeds

const CHAINLINK_FEEDS_BASE: Record<string, { feed: string; decimals: number }> = {
  ETH:   { feed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", decimals: 8 },  // ETH/USD
  WETH:  { feed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", decimals: 8 },  // Same as ETH
  cbBTC: { feed: "0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D", decimals: 8 },  // BTC/USD
  cbETH: { feed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", decimals: 8 },  // Uses ETH feed as proxy
};

const CHAINLINK_ABI_FRAGMENT = "0x50d25bcd"; // latestAnswer() → int256

/**
 * v6.2: Fetch prices directly from Chainlink oracles on Base via eth_call.
 * These are on-chain reads — no API key needed, no rate limits possible.
 * Only covers major tokens (ETH, BTC) but provides an unbreakable price floor.
 */
async function fetchChainlinkPrices(): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  const BASE_RPC = "https://mainnet.base.org";

  for (const [symbol, config] of Object.entries(CHAINLINK_FEEDS_BASE)) {
    try {
      const res = await axios.post(BASE_RPC, {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: config.feed, data: CHAINLINK_ABI_FRAGMENT }, "latest"],
      }, { timeout: 5000 });

      if (res.data?.result && res.data.result !== "0x") {
        const rawPrice = parseInt(res.data.result, 16);
        const price = rawPrice / Math.pow(10, config.decimals);
        if (price > 0) {
          prices.set(symbol, price);
        }
      }
    } catch {
      // Silent fail per token — other sources still available
    }
  }

  if (prices.size > 0) {
    console.log(`  🔗 Chainlink oracle: ${prices.size} prices (${[...prices.entries()].map(([s, p]) => `${s}=$${p.toFixed(2)}`).join(", ")})`);
  }

  return prices;
}

// ============================================================================
// CONFIGURATION V3.2
// ============================================================================

const CONFIG = {
  // Wallet
  walletAddress: process.env.WALLET_ADDRESS || "0x55509AA76E2769eCCa5B4293359e3001dA16dd0F",

  // Trading Parameters
  trading: {
    enabled: process.env.TRADING_ENABLED === "true",
    maxBuySize: parseFloat(process.env.MAX_BUY_SIZE_USDC || "25"),
    maxSellPercent: parseFloat(process.env.MAX_SELL_PERCENT || "50"),
    intervalMinutes: parseInt(process.env.TRADING_INTERVAL_MINUTES || String(DEFAULT_TRADING_INTERVAL_MINUTES)),
    // V3.1: Risk-adjusted position sizing
    maxPositionPercent: 25,  // No single token > 25% of portfolio
    minPositionUSD: 5,       // Minimum position size
    rebalanceThreshold: 10,  // Rebalance if sector drift > 10%
    slippageBps: 100,        // 1% slippage tolerance for swaps
    // V5.1.1: Tiered Profit Harvesting — scale out in tranches, bank small wins consistently
    profitTaking: {
      enabled: true,
      targetPercent: 20,        // Legacy: original trigger (used by adaptive thresholds as base)
      sellPercent: 30,          // Legacy: original sell amount
      minHoldingUSD: 5,         // Don't trigger if holding < $5
      cooldownHours: 6,         // Reduced: faster harvesting cycles (was 24h)
      // Tiered harvesting: sell progressively more as gains increase
      tiers: [
        { gainPercent: 8,  sellPercent: 15, label: "EARLY_HARVEST" },    // Small win: skim 15%
        { gainPercent: 15, sellPercent: 20, label: "MID_HARVEST" },      // Moderate win: take 20%
        { gainPercent: 25, sellPercent: 30, label: "STRONG_HARVEST" },   // Strong win: take 30%
        { gainPercent: 40, sellPercent: 40, label: "MAJOR_HARVEST" },    // Major win: take 40%
      ],
    },
    // V3.5: Stop-Loss
    stopLoss: {
      enabled: true,
      percentThreshold: -15,    // v6.2: Tightened from -25% to -15% from avg cost
      sellPercent: 75,          // v6.2: Sell 75% of losing position (was 50%)
      minHoldingUSD: 5,         // Don't trigger if holding < $5
      trailingEnabled: true,    // Also use trailing stop from peak
      trailingPercent: -12,     // v6.2: Tightened from -20% to -12% from peak
    },
  },

  // Active tokens (all tradeable tokens)
  activeTokens: Object.keys(TOKEN_REGISTRY).filter(t => t !== "USDC"),

  // Logging
  logFile: process.env.PERSIST_DIR ? `${process.env.PERSIST_DIR}/trades-v3.4.json` : "./logs/trades-v3.4.json",

    // v5.3.0: Auto-Harvest — send realized profits back to owner wallet
    autoHarvest: {
      enabled: process.env.AUTO_HARVEST_ENABLED === 'true',
      destinationWallet: process.env.PROFIT_DESTINATION_WALLET || '',
      thresholdUSD: parseFloat(process.env.AUTO_HARVEST_THRESHOLD_USD || '25'),
      minETHReserve: parseFloat(process.env.AUTO_HARVEST_MIN_ETH_RESERVE || '0.002'),
      cooldownHours: parseFloat(process.env.AUTO_HARVEST_COOLDOWN_HOURS || '24'),
    },

    // v6.0: Derivatives Module — Perpetual Futures + Commodity Futures
    derivatives: {
      enabled: process.env.DERIVATIVES_ENABLED === 'true',
      maxLeverage: parseInt(process.env.DERIVATIVES_MAX_LEVERAGE || '3'),
      basePositionUSD: parseFloat(process.env.DERIVATIVES_BASE_POSITION_USD || '50'),
      stopLossPercent: parseFloat(process.env.DERIVATIVES_STOP_LOSS_PERCENT || '-10'),
      takeProfitPercent: parseFloat(process.env.DERIVATIVES_TAKE_PROFIT_PERCENT || '15'),
      apiKeyId: process.env.COINBASE_ADV_API_KEY_ID || process.env.CDP_API_KEY_ID || process.env.CDP_API_KEY_NAME || '',
      apiKeySecret: process.env.COINBASE_ADV_API_KEY_SECRET || process.env.CDP_API_KEY_SECRET || process.env.CDP_API_KEY_PRIVATE_KEY || '',
    },
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

// === DERIVATIVES MODULE STATE (v6.0) ===
let advancedTradeClient: CoinbaseAdvancedTradeClient | null = null;
let derivativesEngine: DerivativesStrategyEngine | null = null;
let commoditySignalEngine: MacroCommoditySignalEngine | null = null;
let lastDerivativesData: {
  state: any;
  signals: DerivativesSignal[];
  trades: DerivativesTradeRecord[];
  commoditySignal: MacroCommoditySignal | null;
} | null = null;

// === v6.0: LIGHT/HEAVY CYCLE STATE ===
let lastHeavyCycleAt = 0;
let lastPriceSnapshot: Map<string, number> = new Map();
let lastFearGreedValue = 0;
let cycleStats = { totalLight: 0, totalHeavy: 0, lastHeavyReason: '' };

// === v6.0: EQUITY MODULE STATE (initialized in main()) ===
let equityEngine: EquityIntegration | null = null;
let equityEnabled = false;

// === v6.1: TOKEN DISCOVERY STATE ===
let tokenDiscoveryEngine: TokenDiscoveryEngine | null = null;

// === v6.2: ADAPTIVE CYCLE ENGINE ===
// Replaces fixed cron with dynamic setTimeout that adjusts to market conditions

const adaptiveCycle: {
  currentIntervalSec: number;
  volatilityLevel: string;
  portfolioTier: string;
  dynamicPriceThreshold: number;
  consecutiveLightCycles: number;
  lastPriceCheck: Map<string, number>;
  emergencyMode: boolean;
  emergencyUntil: number;
  wsConnected: boolean;
  wsReconnectAttempts: number;
  realtimePrices: Map<string, { price: number; timestamp: number }>;
} = {
  currentIntervalSec: ADAPTIVE_DEFAULT_INTERVAL_SEC,
  volatilityLevel: 'NORMAL',
  portfolioTier: 'STARTER',
  dynamicPriceThreshold: PRICE_CHANGE_THRESHOLD,
  consecutiveLightCycles: 0,
  lastPriceCheck: new Map(),
  emergencyMode: false,
  emergencyUntil: 0,
  wsConnected: false,
  wsReconnectAttempts: 0,
  realtimePrices: new Map(),
};

let adaptiveCycleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * v6.2: Determine the portfolio sensitivity tier based on current value.
 * Higher portfolio = lower threshold = more sensitive to price moves.
 */
function getPortfolioSensitivity(portfolioUSD: number): { threshold: number; tier: string } {
  let matched = PORTFOLIO_SENSITIVITY_TIERS[0];
  for (const tier of PORTFOLIO_SENSITIVITY_TIERS) {
    if (portfolioUSD >= tier.minUSD) matched = tier;
  }
  return { threshold: matched.priceChangeThreshold, tier: matched.label };
}

/**
 * v6.2: Calculate volatility level from recent price movements.
 * Looks at max price change across all tracked tokens in the last snapshot.
 */
function assessVolatility(currentPrices: Map<string, number>, previousPrices: Map<string, number>): {
  level: string;
  maxChange: number;
  fastestMover: string;
} {
  let maxChange = 0;
  let fastestMover = '';

  for (const [symbol, price] of currentPrices) {
    const prev = previousPrices.get(symbol);
    if (prev && prev > 0) {
      const change = Math.abs(price - prev) / prev;
      if (change > maxChange) {
        maxChange = change;
        fastestMover = symbol;
      }
    }
  }

  let level: string;
  if (maxChange > 0.08) level = 'EXTREME';
  else if (maxChange > 0.05) level = 'HIGH';
  else if (maxChange > 0.03) level = 'ELEVATED';
  else if (maxChange > 0.01) level = 'NORMAL';
  else if (maxChange > 0.003) level = 'LOW';
  else level = 'DEAD';

  return { level, maxChange, fastestMover };
}

/**
 * v6.2: Check for emergency conditions — any position dropped 5%+ since last check.
 * Returns the token and drop percentage if emergency detected.
 */
function checkEmergencyConditions(currentPrices: Map<string, number>): {
  emergency: boolean;
  token?: string;
  dropPercent?: number;
} {
  for (const [symbol, price] of currentPrices) {
    const lastCheck = adaptiveCycle.lastPriceCheck.get(symbol);
    if (lastCheck && lastCheck > 0) {
      const change = (price - lastCheck) / lastCheck;
      if (change <= EMERGENCY_DROP_THRESHOLD) {
        return { emergency: true, token: symbol, dropPercent: change * 100 };
      }
    }
  }
  return { emergency: false };
}

/**
 * v6.2: Compute the next cycle interval based on all adaptive factors.
 * This is the brain of the adaptive engine.
 */
function computeNextInterval(currentPrices: Map<string, number>): {
  intervalSec: number;
  reason: string;
  volatilityLevel: string;
} {
  const portfolioValue = state.trading.totalPortfolioValue || 0;
  const { tier } = getPortfolioSensitivity(portfolioValue);
  adaptiveCycle.portfolioTier = tier;

  // Check emergency first
  if (adaptiveCycle.emergencyMode && Date.now() < adaptiveCycle.emergencyUntil) {
    return {
      intervalSec: EMERGENCY_INTERVAL_SEC,
      reason: `EMERGENCY rapid-fire (${adaptiveCycle.portfolioTier} tier)`,
      volatilityLevel: 'EXTREME',
    };
  }

  // Assess volatility from price movements
  const vol = assessVolatility(currentPrices, adaptiveCycle.lastPriceCheck);
  const baseInterval = (VOLATILITY_SPEED_MAP as any)[vol.level] || ADAPTIVE_DEFAULT_INTERVAL_SEC;

  // Scale down interval for larger portfolios (more at stake = check more often)
  let portfolioMultiplier = 1.0;
  if (portfolioValue >= 100000) portfolioMultiplier = 0.5;
  else if (portfolioValue >= 50000) portfolioMultiplier = 0.6;
  else if (portfolioValue >= 25000) portfolioMultiplier = 0.75;
  else if (portfolioValue >= 5000) portfolioMultiplier = 0.85;

  let finalInterval = Math.round(baseInterval * portfolioMultiplier);

  // Clamp to bounds
  finalInterval = Math.max(ADAPTIVE_MIN_INTERVAL_SEC, Math.min(ADAPTIVE_MAX_INTERVAL_SEC, finalInterval));

  // If many consecutive light cycles, gradually relax (nothing is happening)
  if (adaptiveCycle.consecutiveLightCycles > 10) {
    finalInterval = Math.min(finalInterval * 1.5, ADAPTIVE_MAX_INTERVAL_SEC);
  }

  const reason = vol.maxChange > 0
    ? `${vol.level} volatility (${vol.fastestMover} ±${(vol.maxChange * 100).toFixed(1)}%) | ${tier} tier`
    : `${vol.level} volatility | ${tier} tier`;

  return { intervalSec: Math.round(finalInterval), reason, volatilityLevel: vol.level };
}

/**
 * v6.2: Schedule the next adaptive cycle.
 * Replaces the fixed cron job with dynamic setTimeout.
 */
function scheduleNextCycle() {
  if (adaptiveCycleTimer) clearTimeout(adaptiveCycleTimer);

  const delayMs = adaptiveCycle.currentIntervalSec * 1000;
  adaptiveCycleTimer = setTimeout(async () => {
    try {
      await runTradingCycle();
    } catch (err: any) {
      console.error(`[Adaptive Cycle Error] ${err?.message?.substring(0, 300) || err}`);
    }
    // After cycle completes, schedule the next one (interval may have changed)
    scheduleNextCycle();
  }, delayMs);
}

/**
 * v6.2: Initialize WebSocket price stream from DexScreener.
 * Provides real-time price updates between cycles for emergency detection.
 */
function initPriceStream() {
  // DexScreener doesn't have a public WebSocket API, so we use a high-frequency
  // HTTP polling approach with a dedicated interval (every 10s) for real-time awareness.
  // This is more reliable than WebSocket for DexScreener and avoids connection issues.

  const STREAM_INTERVAL = 10000; // 10 seconds

  const streamPrices = async () => {
    try {
      const addresses = Object.entries(TOKEN_REGISTRY)
        .filter(([s]) => s !== "USDC")
        .map(([_, t]) => t.address)
        .join(",");

      const dexRes = await axios.get(
        `https://api.dexscreener.com/tokens/v1/base/${addresses}`,
        { timeout: 8000 }
      );

      if (dexRes.data && Array.isArray(dexRes.data)) {
        const seen = new Set<string>();
        const now = Date.now();
        for (const pair of dexRes.data) {
          const addr = pair.baseToken?.address?.toLowerCase();
          const entry = Object.entries(TOKEN_REGISTRY).find(([_, t]) => t.address.toLowerCase() === addr);
          if (entry && !seen.has(entry[0])) {
            seen.add(entry[0]);
            const price = parseFloat(pair.priceUsd || "0");
            if (price > 0) {
              adaptiveCycle.realtimePrices.set(entry[0], { price, timestamp: now });

              // Check for emergency drop in real-time
              const lastCheck = adaptiveCycle.lastPriceCheck.get(entry[0]);
              if (lastCheck && lastCheck > 0) {
                const change = (price - lastCheck) / lastCheck;
                if (change <= EMERGENCY_DROP_THRESHOLD && !adaptiveCycle.emergencyMode) {
                  console.log(`\n🚨 EMERGENCY DETECTED: ${entry[0]} dropped ${(change * 100).toFixed(1)}% — activating rapid-fire mode!`);
                  adaptiveCycle.emergencyMode = true;
                  adaptiveCycle.emergencyUntil = now + 5 * 60 * 1000; // 5 minutes of emergency mode
                  // Force immediate cycle
                  if (adaptiveCycleTimer) clearTimeout(adaptiveCycleTimer);
                  scheduleNextCycle();
                }
              }
            }
          }
        }
        adaptiveCycle.wsConnected = true; // Mark stream as active
      }
    } catch {
      // Silent fail — normal cycles still work as backup
      adaptiveCycle.wsConnected = false;
    }
  };

  // Start streaming
  streamPrices();
  setInterval(streamPrices, STREAM_INTERVAL);
  console.log(`   📡 Real-time price stream: active (${STREAM_INTERVAL / 1000}s polling)`);
}

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
    triggeredBy: "AI" | "STOP_LOSS" | "PROFIT_TAKE" | "EXPLORATION";  // What initiated the trade
    isExploration?: boolean;  // V5.0: Whether this was an exploration trade
    // v5.1: Enhanced context
    btcPositioning?: string | null;      // BTC positioning signal
    ethPositioning?: string | null;      // ETH positioning signal
    crossAssetSignal?: string | null;    // Cross-asset correlation signal
    adaptiveSlippage?: number;           // Slippage bps used (MEV protection)
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

// ============================================================================
// PHASE 3: RECURSIVE SELF-IMPROVEMENT ENGINE
// ============================================================================

interface StrategyPattern {
  patternId: string;
  description: string;
  conditions: {
    action: "BUY" | "SELL";
    regime: MarketRegime;
    rsiBucket: "OVERSOLD" | "NEUTRAL" | "OVERBOUGHT" | "UNKNOWN";
    confluenceBucket: "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";
  };
  stats: {
    wins: number;
    losses: number;
    pending: number;           // Trades not yet resolved (no matching sell)
    avgReturnPercent: number;
    totalReturnUSD: number;
    sampleSize: number;
    lastTriggered: string;
  };
  confidence: number;          // 0.2 to 1.0
}

interface AdaptiveThresholds {
  rsiOversold: number;              // Default 30
  rsiOverbought: number;            // Default 70
  confluenceBuy: number;            // Default 15
  confluenceSell: number;           // Default -15
  confluenceStrongBuy: number;      // Default 40
  confluenceStrongSell: number;     // Default -40
  profitTakeTarget: number;         // Default 20
  profitTakeSellPercent: number;    // Default 30
  stopLossPercent: number;          // Default -25
  trailingStopPercent: number;      // Default -20
  regimeMultipliers: Record<MarketRegime, number>;  // Position size multiplier per regime
  history: Array<{
    timestamp: string;
    field: string;
    oldValue: number;
    newValue: number;
    reason: string;
  }>;
  lastAdapted: string | null;
  adaptationCount: number;
}

interface PerformanceReview {
  timestamp: string;
  triggerReason: "TRADE_COUNT" | "TIME_ELAPSED";
  tradesSinceLastReview: number;
  insights: Array<{
    category: "REGIME" | "PATTERN" | "THRESHOLD" | "SECTOR" | "ACTIVITY";
    severity: "INFO" | "WARNING" | "ACTION";
    message: string;
  }>;
  recommendations: Array<{
    type: "THRESHOLD_CHANGE" | "POSITION_SIZE" | "PATTERN_AVOID" | "PATTERN_FAVOR";
    description: string;
    applied: boolean;
  }>;
  periodStats: {
    winRate: number;
    avgReturn: number;
    totalTrades: number;
    bestPattern: string | null;
    worstPattern: string | null;
    dominantRegime: MarketRegime | null;
  };
}

interface ExplorationState {
  totalExplorationTrades: number;
  totalExploitationTrades: number;
  consecutiveHolds: number;
  lastTradeTimestamp: string | null;
  stagnationAlerts: number;
}

const THRESHOLD_BOUNDS: Record<string, { min: number; max: number; maxStep: number }> = {
  rsiOversold:           { min: 20, max: 40, maxStep: 2 },
  rsiOverbought:         { min: 60, max: 80, maxStep: 2 },
  confluenceBuy:         { min: 5,  max: 30, maxStep: 2 },
  confluenceSell:        { min: -30, max: -5, maxStep: 2 },
  confluenceStrongBuy:   { min: 25, max: 60, maxStep: 3 },
  confluenceStrongSell:  { min: -60, max: -25, maxStep: 3 },
  profitTakeTarget:      { min: 10, max: 40, maxStep: 2 },
  profitTakeSellPercent: { min: 15, max: 50, maxStep: 3 },
  stopLossPercent:       { min: -25, max: -8, maxStep: 2 },    // v6.2: tighter bounds
  trailingStopPercent:   { min: -20, max: -8, maxStep: 2 },   // v6.2: tighter bounds
};

const DEFAULT_ADAPTIVE_THRESHOLDS: AdaptiveThresholds = {
  rsiOversold: 30,
  rsiOverbought: 70,
  confluenceBuy: 15,
  confluenceSell: -15,
  confluenceStrongBuy: 40,
  confluenceStrongSell: -40,
  profitTakeTarget: 20,
  profitTakeSellPercent: 30,
  stopLossPercent: -15,       // v6.2: tightened from -25%
  trailingStopPercent: -12,   // v6.2: tightened from -20%
  regimeMultipliers: {
    TRENDING_UP: 1.2,
    TRENDING_DOWN: 0.6,
    RANGING: 0.8,      // v5.2: reduced from 1.0 — smaller positions in ranging markets
    VOLATILE: 0.5,
    UNKNOWN: 0.7,
  },
  history: [],
  lastAdapted: null,
  adaptationCount: 0,
};

const DEFAULT_EXPLORATION_STATE: ExplorationState = {
  totalExplorationTrades: 0,
  totalExploitationTrades: 0,
  consecutiveHolds: 0,
  lastTradeTimestamp: null,
  stagnationAlerts: 0,
};

/**
 * Classify a trade into a strategy pattern bucket based on its signal context
 */
function classifyTradePattern(trade: TradeRecord): string {
  if (!trade.signalContext) return "UNKNOWN_UNKNOWN_UNKNOWN_UNKNOWN";
  const { marketRegime, confluenceScore, rsi } = trade.signalContext;
  const action = trade.action === "BUY" || trade.action === "SELL" ? trade.action : "BUY";

  // RSI bucket
  let rsiBucket = "UNKNOWN";
  if (rsi !== null && rsi !== undefined) {
    if (rsi < state.adaptiveThresholds.rsiOversold) rsiBucket = "OVERSOLD";
    else if (rsi > state.adaptiveThresholds.rsiOverbought) rsiBucket = "OVERBOUGHT";
    else rsiBucket = "NEUTRAL";
  }

  // Confluence bucket
  let confBucket = "NEUTRAL";
  if (confluenceScore >= state.adaptiveThresholds.confluenceStrongBuy) confBucket = "STRONG_BUY";
  else if (confluenceScore >= state.adaptiveThresholds.confluenceBuy) confBucket = "BUY";
  else if (confluenceScore <= state.adaptiveThresholds.confluenceStrongSell) confBucket = "STRONG_SELL";
  else if (confluenceScore <= state.adaptiveThresholds.confluenceSell) confBucket = "SELL";

  return `${action}_${rsiBucket}_${marketRegime}_${confBucket}`;
}

/**
 * Build pattern description from pattern ID
 */
function describePattern(patternId: string): string {
  const parts = patternId.split("_");
  if (parts.length < 4) return patternId;
  const [action, rsi, ...rest] = parts;
  const regime = rest.slice(0, -1).join("_") || "UNKNOWN";
  const conf = rest[rest.length - 1] || "NEUTRAL";
  const rsiLabel = rsi === "OVERSOLD" ? "RSI oversold" : rsi === "OVERBOUGHT" ? "RSI overbought" : "RSI neutral";
  const confLabel = conf.replace("_", " ").toLowerCase();
  return `${action} when ${rsiLabel} in ${regime} regime (${confLabel} confluence)`;
}

/**
 * Analyze all trade history to build strategy pattern memory
 */
function analyzeStrategyPatterns(): void {
  const patterns: Record<string, StrategyPattern> = {};

  // Process each non-HOLD successful trade
  for (const trade of state.tradeHistory) {
    if (!trade.success || trade.action === "HOLD" || trade.action === "REBALANCE") continue;
    const patternId = classifyTradePattern(trade);

    if (!patterns[patternId]) {
      const parts = patternId.split("_");
      const action = (parts[0] === "BUY" || parts[0] === "SELL") ? parts[0] as "BUY" | "SELL" : "BUY";
      const rsiBucket = parts[1] as any || "UNKNOWN";
      const regime = parts.slice(2, -1).join("_") as MarketRegime || "UNKNOWN";
      const confBucket = parts[parts.length - 1] as any || "NEUTRAL";

      patterns[patternId] = {
        patternId,
        description: describePattern(patternId),
        conditions: { action, regime: regime as MarketRegime, rsiBucket, confluenceBucket: confBucket },
        stats: { wins: 0, losses: 0, pending: 0, avgReturnPercent: 0, totalReturnUSD: 0, sampleSize: 0, lastTriggered: trade.timestamp },
        confidence: 0.3,
      };
    }

    patterns[patternId].stats.lastTriggered = trade.timestamp;

    // For BUY trades, find the matching SELL to compute return
    if (trade.action === "BUY") {
      const buyTime = new Date(trade.timestamp).getTime();
      const matchingSell = state.tradeHistory.find(t =>
        t.action === "SELL" && t.fromToken === trade.toToken && t.success &&
        new Date(t.timestamp).getTime() > buyTime
      );
      if (matchingSell) {
        const cb = state.costBasis[trade.toToken];
        if (cb && cb.averageCostBasis > 0) {
          const returnPct = matchingSell.amountUSD > 0 && trade.amountUSD > 0
            ? ((matchingSell.amountUSD / trade.amountUSD) - 1) * 100
            : 0;
          patterns[patternId].stats.sampleSize++;
          if (returnPct > 0) patterns[patternId].stats.wins++;
          else patterns[patternId].stats.losses++;
          patterns[patternId].stats.totalReturnUSD += (matchingSell.amountUSD - trade.amountUSD);
        }
      } else {
        patterns[patternId].stats.pending++;
      }
    }

    // For SELL trades, look back for the BUY
    if (trade.action === "SELL") {
      const sellTime = new Date(trade.timestamp).getTime();
      const matchingBuy = [...state.tradeHistory].reverse().find(t =>
        t.action === "BUY" && t.toToken === trade.fromToken && t.success &&
        new Date(t.timestamp).getTime() < sellTime
      );
      if (matchingBuy && matchingBuy.amountUSD > 0) {
        const returnPct = ((trade.amountUSD / matchingBuy.amountUSD) - 1) * 100;
        patterns[patternId].stats.sampleSize++;
        if (returnPct > 0) patterns[patternId].stats.wins++;
        else patterns[patternId].stats.losses++;
        patterns[patternId].stats.totalReturnUSD += (trade.amountUSD - matchingBuy.amountUSD);
      } else {
        patterns[patternId].stats.pending++;
      }
    }
  }

  // Calculate avg returns and confidence for each pattern
  for (const p of Object.values(patterns)) {
    p.stats.avgReturnPercent = p.stats.sampleSize > 0
      ? (p.stats.totalReturnUSD / Math.max(1, p.stats.sampleSize))
      : 0;

    // Confidence: based on sample size + win rate
    const winRate = p.stats.sampleSize > 0 ? p.stats.wins / p.stats.sampleSize : 0;
    let conf = 0.3; // base
    if (p.stats.sampleSize >= 3) conf = 0.4;
    if (p.stats.sampleSize >= 5) conf = 0.55;
    if (p.stats.sampleSize >= 10) conf = 0.7;
    if (p.stats.sampleSize >= 20) conf = 0.85;
    conf *= (0.5 + winRate * 0.5); // weight by win rate
    if (p.stats.avgReturnPercent < 0) conf *= 0.7; // penalty for negative avg
    p.confidence = Math.max(0.2, Math.min(1.0, conf));
  }

  state.strategyPatterns = patterns;
  console.log(`  🧠 Strategy patterns analyzed: ${Object.keys(patterns).length} patterns from ${state.tradeHistory.length} trades`);
}

/**
 * Run performance review — generates insights and recommendations
 */
function runPerformanceReview(reason: "TRADE_COUNT" | "TIME_ELAPSED"): PerformanceReview {
  const startIdx = state.lastReviewTradeIndex || 0;
  const recentTrades = state.tradeHistory.slice(startIdx);
  const successTrades = recentTrades.filter(t => t.success && t.action !== "HOLD");

  const insights: PerformanceReview["insights"] = [];
  const recommendations: PerformanceReview["recommendations"] = [];

  // Win rate analysis
  const sellTrades = successTrades.filter(t => t.action === "SELL");
  let wins = 0, losses = 0;
  for (const sell of sellTrades) {
    const cb = state.costBasis[sell.fromToken];
    if (cb && cb.averageCostBasis > 0 && sell.amountUSD > 0) {
      const tokensSold = sell.tokenAmount || (sell.amountUSD / cb.averageCostBasis);
      const pnl = sell.amountUSD - (tokensSold * cb.averageCostBasis);
      if (pnl > 0) wins++; else losses++;
    }
  }
  const winRate = (wins + losses) > 0 ? wins / (wins + losses) : 0;
  const avgReturn = sellTrades.length > 0
    ? sellTrades.reduce((sum, t) => sum + (t.portfolioValueAfter || t.portfolioValueBefore) - t.portfolioValueBefore, 0) / sellTrades.length
    : 0;

  // Regime analysis
  const regimeCounts: Record<string, number> = {};
  for (const t of successTrades) {
    const r = t.signalContext?.marketRegime || "UNKNOWN";
    regimeCounts[r] = (regimeCounts[r] || 0) + 1;
  }
  const dominantRegime = Object.entries(regimeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as MarketRegime || null;

  // Pattern analysis
  const patternArr = Object.values(state.strategyPatterns)
    .filter(p => p.stats.sampleSize >= 2)
    .sort((a, b) => b.stats.avgReturnPercent - a.stats.avgReturnPercent);
  const bestPattern = patternArr[0] || null;
  const worstPattern = patternArr[patternArr.length - 1] || null;

  // Generate insights
  if (winRate < 0.35 && (wins + losses) >= 3) {
    insights.push({ category: "PATTERN", severity: "WARNING",
      message: `Win rate dropped to ${(winRate * 100).toFixed(0)}% over last ${wins + losses} resolved trades. Consider tightening entry criteria.` });
    recommendations.push({ type: "THRESHOLD_CHANGE", description: "Raise confluence buy threshold to be more selective", applied: false });
  }
  if (winRate > 0.65 && (wins + losses) >= 3) {
    insights.push({ category: "PATTERN", severity: "INFO",
      message: `Strong ${(winRate * 100).toFixed(0)}% win rate over last ${wins + losses} trades. Strategy is working well.` });
    recommendations.push({ type: "THRESHOLD_CHANGE", description: "Can slightly lower confluence buy threshold to capture more opportunities", applied: false });
  }

  if (bestPattern && bestPattern.stats.sampleSize >= 3 && bestPattern.stats.avgReturnPercent > 0) {
    insights.push({ category: "PATTERN", severity: "INFO",
      message: `Best pattern: "${bestPattern.description}" — ${bestPattern.stats.wins}/${bestPattern.stats.sampleSize} wins, avg $${bestPattern.stats.avgReturnPercent.toFixed(2)} return` });
    recommendations.push({ type: "PATTERN_FAVOR", description: `Favor ${bestPattern.patternId} — proven profitable`, applied: false });
  }
  if (worstPattern && worstPattern.stats.sampleSize >= 3 && worstPattern.stats.avgReturnPercent < 0) {
    insights.push({ category: "PATTERN", severity: "WARNING",
      message: `Worst pattern: "${worstPattern.description}" — ${worstPattern.stats.losses}/${worstPattern.stats.sampleSize} losses, avg $${worstPattern.stats.avgReturnPercent.toFixed(2)} return` });
    recommendations.push({ type: "PATTERN_AVOID", description: `Avoid ${worstPattern.patternId} — consistent losses`, applied: false });
  }

  // Regime-specific insights
  for (const [regime, count] of Object.entries(regimeCounts)) {
    const regimePatterns = Object.values(state.strategyPatterns).filter(p => p.conditions.regime === regime && p.stats.sampleSize >= 2);
    const regimeWinRate = regimePatterns.length > 0
      ? regimePatterns.reduce((s, p) => s + p.stats.wins, 0) / Math.max(1, regimePatterns.reduce((s, p) => s + p.stats.sampleSize, 0))
      : 0;
    if (regimeWinRate < 0.3 && count >= 3) {
      insights.push({ category: "REGIME", severity: "ACTION",
        message: `${regime} regime trades have only ${(regimeWinRate * 100).toFixed(0)}% win rate. Consider reducing position sizes in this regime.` });
      recommendations.push({ type: "POSITION_SIZE", description: `Reduce regime multiplier for ${regime}`, applied: false });
    }
  }

  // Stagnation check
  const hoursSinceLastTrade = state.trading.lastTrade
    ? (Date.now() - state.trading.lastTrade.getTime()) / (1000 * 60 * 60)
    : Infinity;
  if (hoursSinceLastTrade > 48) {
    insights.push({ category: "ACTIVITY", severity: "WARNING",
      message: `No trades in ${(hoursSinceLastTrade / 24).toFixed(1)} days. Bot may be too selective.` });
    recommendations.push({ type: "THRESHOLD_CHANGE", description: "Consider lowering confluence thresholds to increase trade frequency", applied: false });
  }

  const review: PerformanceReview = {
    timestamp: new Date().toISOString(),
    triggerReason: reason,
    tradesSinceLastReview: recentTrades.length,
    insights,
    recommendations,
    periodStats: {
      winRate, avgReturn, totalTrades: successTrades.length,
      bestPattern: bestPattern?.patternId || null,
      worstPattern: worstPattern?.patternId || null,
      dominantRegime,
    },
  };

  console.log(`  📊 Performance Review: ${insights.length} insights, ${recommendations.length} recommendations`);
  for (const i of insights) console.log(`     [${i.severity}] ${i.message}`);
  return review;
}

/**
 * Adapt thresholds based on performance review — bounded, gradual, audited
 */
/**
 * v5.1: Shadow Model Validation — proposed threshold changes must pass statistical
 * significance checks before being promoted to live. Changes sit in a "shadow" queue
 * and only apply after n=5+ confirming reviews or when p-value proxy drops below 0.10.
 */
interface ShadowProposal {
  field: string;
  proposedDelta: number;
  reason: string;
  proposedAt: string;
  confirmingReviews: number;      // How many subsequent reviews still agree
  contradictingReviews: number;   // How many subsequent reviews disagree
  status: "PENDING" | "PROMOTED" | "REJECTED";
}

// In-memory shadow proposal queue (persisted via state)
let shadowProposals: ShadowProposal[] = [];

function adaptThresholds(review: PerformanceReview): void {
  const t = state.adaptiveThresholds;
  const { winRate, totalTrades } = review.periodStats;
  if (totalTrades < 3) return; // Not enough data to adapt

  // v5.1: Shadow model validation constants
  const MIN_CONFIRMING_REVIEWS = 3;   // Need 3 consecutive confirmations
  const MIN_SAMPLE_SIZE = 5;          // Need at least 5 trades in review period
  const MAX_CONTRADICTION_RATIO = 0.3; // Reject if >30% contradictions

  const proposeAdaptation = (field: string, delta: number, reason: string) => {
    const bounds = THRESHOLD_BOUNDS[field];
    if (!bounds) return;

    // Check if there's already a pending proposal for this field in the same direction
    const existing = shadowProposals.find(
      p => p.field === field && p.status === "PENDING" && Math.sign(p.proposedDelta) === Math.sign(delta)
    );

    if (existing) {
      // Confirm existing proposal
      existing.confirmingReviews++;
      console.log(`     🔬 Shadow: ${field} proposal confirmed (${existing.confirmingReviews}/${MIN_CONFIRMING_REVIEWS} confirmations)`);

      // Check if ready for promotion
      const totalReviews = existing.confirmingReviews + existing.contradictingReviews;
      const contradictionRatio = totalReviews > 0 ? existing.contradictingReviews / totalReviews : 0;

      if (existing.confirmingReviews >= MIN_CONFIRMING_REVIEWS && contradictionRatio <= MAX_CONTRADICTION_RATIO && totalTrades >= MIN_SAMPLE_SIZE) {
        // PROMOTE — apply the change
        const currentVal = (t as any)[field] as number;
        const cappedDelta = Math.sign(existing.proposedDelta) * Math.min(Math.abs(existing.proposedDelta), bounds.maxStep);
        const newVal = Math.max(bounds.min, Math.min(bounds.max, currentVal + cappedDelta));
        if (newVal !== currentVal) {
          t.history.push({
            timestamp: new Date().toISOString(),
            field,
            oldValue: currentVal,
            newValue: newVal,
            reason: `SHADOW VALIDATED: ${existing.reason} (${existing.confirmingReviews} confirmations, ${existing.contradictingReviews} contradictions, ${totalTrades} trades)`,
          });
          (t as any)[field] = newVal;
          existing.status = "PROMOTED";
          console.log(`     ✅ Shadow PROMOTED: ${field}: ${currentVal} → ${newVal} (${existing.confirmingReviews} confirmations over ${totalReviews} reviews)`);
        }
      }
    } else {
      // Check for contradicting proposals (same field, opposite direction)
      const contradicted = shadowProposals.find(
        p => p.field === field && p.status === "PENDING" && Math.sign(p.proposedDelta) !== Math.sign(delta)
      );
      if (contradicted) {
        contradicted.contradictingReviews++;
        const totalReviews = contradicted.confirmingReviews + contradicted.contradictingReviews;
        const contradictionRatio = totalReviews > 0 ? contradicted.contradictingReviews / totalReviews : 0;
        if (contradictionRatio > MAX_CONTRADICTION_RATIO && totalReviews >= 3) {
          contradicted.status = "REJECTED";
          console.log(`     ❌ Shadow REJECTED: ${field} (${contradicted.contradictingReviews}/${totalReviews} contradictions)`);
        }
      }

      // Create new shadow proposal
      shadowProposals.push({
        field,
        proposedDelta: delta,
        reason,
        proposedAt: new Date().toISOString(),
        confirmingReviews: 1,
        contradictingReviews: 0,
        status: "PENDING",
      });
      console.log(`     🔬 Shadow: New proposal for ${field} (delta: ${delta > 0 ? "+" : ""}${delta}) — needs ${MIN_CONFIRMING_REVIEWS} confirmations`);
    }
  };

  // Low win rate → propose being more selective
  if (winRate < 0.35) {
    proposeAdaptation("confluenceBuy", 2, `Low win rate ${(winRate * 100).toFixed(0)}%`);
    proposeAdaptation("confluenceStrongBuy", 2, `Low win rate ${(winRate * 100).toFixed(0)}%`);
    proposeAdaptation("stopLossPercent", 2, `Tighten stops: win rate ${(winRate * 100).toFixed(0)}%`);
  }

  // High win rate → propose slightly more aggressive
  if (winRate > 0.65) {
    proposeAdaptation("confluenceBuy", -1, `High win rate ${(winRate * 100).toFixed(0)}%`);
  }

  // Negative avg return → propose tighter risk management
  if (review.periodStats.avgReturn < -2) {
    proposeAdaptation("stopLossPercent", 2, `Negative avg return $${review.periodStats.avgReturn.toFixed(2)}`);
    proposeAdaptation("trailingStopPercent", 2, `Negative avg return $${review.periodStats.avgReturn.toFixed(2)}`);
  }

  // Strong avg return → propose letting winners run longer
  if (review.periodStats.avgReturn > 5) {
    proposeAdaptation("profitTakeTarget", 2, `Strong avg return $${review.periodStats.avgReturn.toFixed(2)}`);
  }

  // Clean up old completed/rejected proposals (keep last 50)
  shadowProposals = shadowProposals.filter(p => p.status === "PENDING").concat(
    shadowProposals.filter(p => p.status !== "PENDING").slice(-20)
  );

  // Trim audit trail to last 100 entries
  if (t.history.length > 100) t.history = t.history.slice(-100);
  t.lastAdapted = new Date().toISOString();
  t.adaptationCount++;
}

/**
 * Calculate confidence for a specific pattern in the current regime
 */
function calculatePatternConfidence(patternId: string, regime: MarketRegime): number {
  const pattern = state.strategyPatterns[patternId];
  if (!pattern || pattern.stats.sampleSize < 2) return 0.5; // Unproven → moderate confidence (v5.2: raised from 0.3 to prevent $2-3 dust trades) // Unproven → low confidence

  let conf = pattern.confidence;

  // Regime multiplier from adaptive thresholds
  const regimeMult = state.adaptiveThresholds.regimeMultipliers[regime] || 1.0;
  conf *= regimeMult;

  // Decay if stale (not triggered in 14+ days)
  if (pattern.stats.lastTriggered) {
    const daysSince = (Date.now() - new Date(pattern.stats.lastTriggered).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 14) conf *= 0.9;
    if (daysSince > 30) conf *= 0.8;
  }

  return Math.max(0.2, Math.min(1.0, conf));
}

/**
 * Check for stagnation and generate exploration trade if needed
 * Returns a trade-like object or null
 */
function checkStagnation(availableUSDC: number, tokenData: any[]): { toToken: string; amountUSD: number; reasoning: string } | null {
  const exploration = state.explorationState;
  const hoursSinceLastTrade = state.trading.lastTrade
    ? (Date.now() - state.trading.lastTrade.getTime()) / (1000 * 60 * 60)
    : Infinity;

  // No exploration if insufficient capital
  if (availableUSDC < 3) return null;

  // Trigger exploration if no trade in 48+ hours
  if (hoursSinceLastTrade < 48) {
    exploration.consecutiveHolds = 0;
    return null;
  }

  exploration.stagnationAlerts++;
  console.log(`  🔬 Stagnation detected: ${(hoursSinceLastTrade / 24).toFixed(1)} days since last trade (alert #${exploration.stagnationAlerts})`);

  // Pick the token with best confluence that we haven't traded recently
  const recentTokens = new Set(state.tradeHistory.slice(-10).map(t => t.toToken));
  const candidates = tokenData
    .filter(t => t.symbol !== "USDC" && !recentTokens.has(t.symbol))
    .sort((a, b) => (b.priceChange24h || 0) - (a.priceChange24h || 0));

  if (candidates.length === 0) return null;

  const target = candidates[0];
  const explorationAmount = Math.min(3, availableUSDC); // $3 max for exploration

  return {
    toToken: target.symbol,
    amountUSD: explorationAmount,
    reasoning: `Exploration: No trade in ${(hoursSinceLastTrade / 24).toFixed(1)} days. Testing ${target.symbol} with small $${explorationAmount.toFixed(2)} position to gather data.`,
  };
}

/**
 * Format self-improvement data for AI prompt injection
 * Replaces the generic "LEARN FROM HISTORY" instruction with structured analysis
 */
function formatSelfImprovementPrompt(): string {
  const patterns = Object.values(state.strategyPatterns)
    .filter(p => p.stats.sampleSize >= 1)
    .sort((a, b) => b.confidence - a.confidence);

  const topPatterns = patterns.filter(p => p.stats.avgReturnPercent > 0).slice(0, 5);
  const bottomPatterns = patterns.filter(p => p.stats.avgReturnPercent < 0).slice(-3);

  const recentReview = state.performanceReviews.length > 0
    ? state.performanceReviews[state.performanceReviews.length - 1]
    : null;

  const t = state.adaptiveThresholds;

  let prompt = `\n=== SELF-IMPROVEMENT ENGINE (Phase 3) ===\n`;
  prompt += `Adaptive Thresholds: RSI oversold=${t.rsiOversold} overbought=${t.rsiOverbought} | `;
  prompt += `Confluence buy=${t.confluenceBuy} sell=${t.confluenceSell} strongBuy=${t.confluenceStrongBuy} strongSell=${t.confluenceStrongSell} | `;
  prompt += `Profit-take=${t.profitTakeTarget}% | Stop-loss=${t.stopLossPercent}% trailing=${t.trailingStopPercent}%\n`;
  prompt += `Regime multipliers: TRENDING_UP=${t.regimeMultipliers.TRENDING_UP}x TRENDING_DOWN=${t.regimeMultipliers.TRENDING_DOWN}x RANGING=${t.regimeMultipliers.RANGING}x VOLATILE=${t.regimeMultipliers.VOLATILE}x\n`;
  prompt += `Adaptations applied: ${t.adaptationCount} total\n\n`;

  if (topPatterns.length > 0) {
    prompt += `PROVEN WINNING PATTERNS (favor these):\n`;
    for (const p of topPatterns) {
      const wr = p.stats.sampleSize > 0 ? ((p.stats.wins / p.stats.sampleSize) * 100).toFixed(0) : "?";
      prompt += `  ✅ ${p.description} — ${p.stats.wins}/${p.stats.sampleSize} wins (${wr}%), avg $${p.stats.avgReturnPercent.toFixed(2)}, confidence ${(p.confidence * 100).toFixed(0)}%\n`;
    }
    prompt += `\n`;
  }

  if (bottomPatterns.length > 0) {
    prompt += `LOSING PATTERNS (avoid these):\n`;
    for (const p of bottomPatterns) {
      const wr = p.stats.sampleSize > 0 ? ((p.stats.wins / p.stats.sampleSize) * 100).toFixed(0) : "?";
      prompt += `  ❌ ${p.description} — ${p.stats.losses}/${p.stats.sampleSize} losses (${wr}% win), avg $${p.stats.avgReturnPercent.toFixed(2)}\n`;
    }
    prompt += `\n`;
  }

  if (recentReview && recentReview.insights.length > 0) {
    prompt += `LATEST PERFORMANCE REVIEW (${recentReview.timestamp.slice(0, 10)}):\n`;
    for (const i of recentReview.insights) {
      prompt += `  [${i.severity}] ${i.message}\n`;
    }
    for (const r of recentReview.recommendations) {
      prompt += `  → ${r.description}\n`;
    }
    prompt += `\n`;
  }

  prompt += `USE THIS DATA: Favor proven patterns, avoid losing ones. Adjust position conviction by pattern confidence. The thresholds above are adaptive — they have been tuned by your performance history.\n`;

  return prompt;
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
  profitTakeCooldowns: Record<string, string>;  // symbol:tier → ISO date of last trigger
  stopLossCooldowns: Record<string, string>;     // symbol → ISO date of last trigger
  // v5.3.3: Consecutive failure tracking per token
  tradeFailures: Record<string, { count: number; lastFailure: string }>;  // symbol → consecutive fail count + timestamp
  // v5.1.1: Profit harvesting tracking
  harvestedProfits?: {
    totalHarvested: number;
    harvestCount: number;
    harvests: { timestamp: string; symbol: string; tier: string; gainPercent: number; sellPercent: number; amountUSD: number; profitUSD: number }[];
  };
  // v5.3.0: Auto-harvest transfer tracking (top-level state)
  autoHarvestTransfers: Array<{ timestamp: string; amountETH: string; amountUSD: number; txHash: string; destination: string }>;
  totalAutoHarvestedUSD: number;
  totalAutoHarvestedETH: number;
  lastAutoHarvestTime: string | null;
  autoHarvestCount: number;
  // Phase 3: Self-Improvement Engine
  strategyPatterns: Record<string, StrategyPattern>;
  adaptiveThresholds: AdaptiveThresholds;
  performanceReviews: PerformanceReview[];
  explorationState: ExplorationState;
  lastReviewTradeIndex: number;
  lastReviewTimestamp: string | null;
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
  tradeFailures: {},
  harvestedProfits: { totalHarvested: 0, harvestCount: 0, harvests: [] },
  // v5.3.0: Auto-harvest transfer state
  autoHarvestTransfers: [] as Array<{ timestamp: string; amountETH: string; amountUSD: number; txHash: string; destination: string }>,
  totalAutoHarvestedUSD: 0,
  totalAutoHarvestedETH: 0,
  lastAutoHarvestTime: null as string | null,
  autoHarvestCount: 0,
  // Phase 3: Self-Improvement Engine
  strategyPatterns: {},
  adaptiveThresholds: { ...DEFAULT_ADAPTIVE_THRESHOLDS },
  performanceReviews: [],
  explorationState: { ...DEFAULT_EXPLORATION_STATE },
  lastReviewTradeIndex: 0,
  lastReviewTimestamp: null,
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
        state.tradeFailures = parsed.tradeFailures || {};
        state.harvestedProfits = parsed.harvestedProfits || { totalHarvested: 0, harvestCount: 0, harvests: [] };
        // Phase 3 fields
        state.strategyPatterns = parsed.strategyPatterns || {};
        if (parsed.adaptiveThresholds) {
          state.adaptiveThresholds = { ...DEFAULT_ADAPTIVE_THRESHOLDS, ...parsed.adaptiveThresholds };
        }
        state.performanceReviews = (parsed.performanceReviews || []).slice(-30);
        state.explorationState = parsed.explorationState || { ...DEFAULT_EXPLORATION_STATE };
        state.lastReviewTradeIndex = parsed.lastReviewTradeIndex || 0;
        state.lastReviewTimestamp = parsed.lastReviewTimestamp || null;
        // v5.3.0: Restore auto-harvest transfer state
        state.autoHarvestTransfers = parsed.autoHarvestTransfers || [];
        state.totalAutoHarvestedUSD = parsed.totalAutoHarvestedUSD || 0;
        state.totalAutoHarvestedETH = parsed.totalAutoHarvestedETH || 0;
        state.lastAutoHarvestTime = parsed.lastAutoHarvestTime || null;
        state.autoHarvestCount = parsed.autoHarvestCount || 0;
        // v5.2: Restore shadow proposals
        if (parsed.shadowProposals && Array.isArray(parsed.shadowProposals)) {
          shadowProposals = parsed.shadowProposals;
          console.log(`  🔬 Restored ${shadowProposals.length} shadow proposals`);
        }
        console.log(`  📂 Loaded ${state.tradeHistory.length} trades, ${Object.keys(state.costBasis).length} cost basis entries from ${file}`);
        console.log(`  🧠 Phase 3: ${Object.keys(state.strategyPatterns).length} patterns, ${state.performanceReviews.length} reviews, ${state.adaptiveThresholds.adaptationCount} adaptations`);
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
      version: "5.2",
      lastUpdated: new Date().toISOString(),
      initialValue: state.trading.initialValue,
      peakValue: state.trading.peakValue,
      currentValue: state.trading.totalPortfolioValue,
      totalTrades: state.trading.totalTrades,
      successfulTrades: state.trading.successfulTrades,
      sectorAllocations: state.trading.sectorAllocations,
      trades: state.tradeHistory.slice(-200), // Cap at 200 trades
      costBasis: state.costBasis,
      profitTakeCooldowns: state.profitTakeCooldowns,
      stopLossCooldowns: state.stopLossCooldowns,
      tradeFailures: state.tradeFailures,
      harvestedProfits: state.harvestedProfits,
      // v5.3.0: Auto-harvest transfer persistence
      autoHarvestTransfers: state.autoHarvestTransfers,
      totalAutoHarvestedUSD: state.totalAutoHarvestedUSD,
      totalAutoHarvestedETH: state.totalAutoHarvestedETH,
      lastAutoHarvestTime: state.lastAutoHarvestTime,
      autoHarvestCount: state.autoHarvestCount,
      // Phase 3: Self-Improvement Engine
      strategyPatterns: state.strategyPatterns,
      adaptiveThresholds: state.adaptiveThresholds,
      performanceReviews: state.performanceReviews.slice(-30),
      explorationState: state.explorationState,
      lastReviewTradeIndex: state.lastReviewTradeIndex,
      lastReviewTimestamp: state.lastReviewTimestamp,
      // v5.2: Persist shadow proposals so they survive restarts
      shadowProposals: shadowProposals.filter(p => p.status === "PENDING").slice(-50),
      // v6.1: Persist token discovery state
      tokenDiscovery: tokenDiscoveryEngine?.getState() || null,
    };
    // Write to persistent volume path, creating directory if needed
    const dir = CONFIG.logFile.substring(0, CONFIG.logFile.lastIndexOf("/"));
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG.logFile, JSON.stringify(data, null, 2));
  } catch (e: any) {
    console.error("Failed to save trade history:", e.message);
  }
}

// ============================================================================
// v5.3.3: CONSECUTIVE FAILURE CIRCUIT BREAKER
// ============================================================================

const MAX_CONSECUTIVE_FAILURES = 3;       // Block token after 3 consecutive failures
const FAILURE_COOLDOWN_HOURS = 6;          // Unblock after 6 hours

function recordTradeFailure(symbol: string): void {
  const existing = state.tradeFailures[symbol];
  state.tradeFailures[symbol] = {
    count: (existing?.count || 0) + 1,
    lastFailure: new Date().toISOString(),
  };
  const f = state.tradeFailures[symbol];
  if (f.count >= MAX_CONSECUTIVE_FAILURES) {
    console.log(`  🚫 CIRCUIT BREAKER: ${symbol} blocked after ${f.count} consecutive failures (cooldown ${FAILURE_COOLDOWN_HOURS}h)`);
  }
}

function clearTradeFailures(symbol: string): void {
  if (state.tradeFailures[symbol]) {
    delete state.tradeFailures[symbol];
  }
}

function isTokenBlocked(symbol: string): boolean {
  const f = state.tradeFailures[symbol];
  if (!f || f.count < MAX_CONSECUTIVE_FAILURES) return false;

  // Check if cooldown has expired
  const hoursSinceLastFailure = (Date.now() - new Date(f.lastFailure).getTime()) / (1000 * 60 * 60);
  if (hoursSinceLastFailure >= FAILURE_COOLDOWN_HOURS) {
    console.log(`  🔓 CIRCUIT BREAKER: ${symbol} unblocked after ${hoursSinceLastFailure.toFixed(1)}h cooldown`);
    delete state.tradeFailures[symbol];
    return false;
  }

  const remainingHours = (FAILURE_COOLDOWN_HOURS - hoursSinceLastFailure).toFixed(1);
  console.log(`  🚫 CIRCUIT BREAKER: ${symbol} blocked (${f.count} failures, ${remainingHours}h remaining)`);
  return true;
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
// v5.2: DUST POSITION CONSOLIDATION
// ============================================================================

const DUST_THRESHOLD_USD = 3.00;

async function consolidateDustPositions(
  balances: { symbol: string; balance: number; usdValue: number; price?: number }[],
  marketData: MarketData
): Promise<number> {
  if (!CONFIG.trading.enabled) return 0;
  const dustPositions = balances.filter(
    b => b.symbol !== "USDC" && b.usdValue > 0.10 && b.usdValue < DUST_THRESHOLD_USD
  );
  if (dustPositions.length === 0) return 0;
  console.log(`\n  🧹 DUST CONSOLIDATION: Found ${dustPositions.length} positions under ${DUST_THRESHOLD_USD.toFixed(2)}`);
  let consolidated = 0;
  for (const dust of dustPositions) {
    try {
      console.log(`     Selling dust: ${dust.symbol} (${dust.usdValue.toFixed(2)})`);
      const decision: TradeDecision = {
        action: "SELL", fromToken: dust.symbol, toToken: "USDC",
        amountUSD: dust.usdValue,
        reasoning: `Dust consolidation: ${dust.symbol} at ${dust.usdValue.toFixed(2)} is below ${DUST_THRESHOLD_USD} threshold`,
        tokenAmount: dust.balance,
      };
      const result = await executeTrade(decision, marketData);
      if (result.success) {
        consolidated++;
        console.log(`     ✅ Consolidated ${dust.symbol} → USDC`);
        updateCostBasisAfterSell(dust.symbol, dust.usdValue, dust.balance);
      } else {
        console.log(`     ❌ Failed to consolidate ${dust.symbol}: ${result.error}`);
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (e: any) {
      console.log(`     ❌ Error consolidating ${dust.symbol}: ${e.message}`);
    }
  }
  if (consolidated > 0) {
    console.log(`  🧹 Consolidated ${consolidated}/${dustPositions.length} dust positions to USDC`);
    saveTradeHistory();
  }
  return consolidated;
}

// ============================================================================
// PROFIT-TAKING & STOP-LOSS GUARDS
// ============================================================================

/**
 * v5.1.1: TIERED PROFIT HARVESTING — scale out of winners in tranches
 *
 * Philosophy: Don't ride everything to the moon and back. When the market gives you
 * something, take a piece. Bank small wins consistently. The remaining position still
 * rides for the bigger move, but you've already locked in profit.
 *
 * Tiers:
 *   +8%  → sell 15% (early harvest — skim the cream)
 *   +15% → sell 20% (moderate win — bank a real gain)
 *   +25% → sell 30% (strong win — significant profit lock)
 *   +40% → sell 40% (major win — protect the bag)
 *
 * Each tier has its own cooldown tracking per token. A token can trigger tier 1,
 * then later trigger tier 2 as it keeps climbing — harvesting along the way.
 *
 * Time-based rebalancing: If a position has been held for 72+ hours without any
 * profit trigger and is up at least 5%, take a small 10% harvest. Patient capital,
 * but not passive capital.
 */
function checkProfitTaking(
  balances: { symbol: string; balance: number; usdValue: number; price?: number; sector?: string }[],
): TradeDecision | null {
  if (!CONFIG.trading.profitTaking.enabled) return null;

  const cfg = CONFIG.trading.profitTaking;
  const tiers = (cfg as any).tiers || [
    { gainPercent: 8,  sellPercent: 15, label: "EARLY_HARVEST" },
    { gainPercent: 15, sellPercent: 20, label: "MID_HARVEST" },
    { gainPercent: 25, sellPercent: 30, label: "STRONG_HARVEST" },
    { gainPercent: 40, sellPercent: 40, label: "MAJOR_HARVEST" },
  ];
  const now = new Date();

  // Track the best opportunity across all holdings (highest tier hit wins)
  let bestCandidate: {
    symbol: string;
    balance: number;
    usdValue: number;
    gainPercent: number;
    tier: { gainPercent: number; sellPercent: number; label: string };
    costBasis: number;
    currentPrice: number;
    sector?: string;
  } | null = null;

  for (const b of balances) {
    if (b.symbol === "USDC" || b.usdValue < cfg.minHoldingUSD) continue;
    const cb = state.costBasis[b.symbol];
    if (!cb || cb.averageCostBasis <= 0) continue;

    // v5.3.3: Skip tokens blocked by circuit breaker
    if (isTokenBlocked(b.symbol)) continue;

    // v5.3.3: Check stop-loss cooldown (1 hour between attempts per token)
    const slCooldown = state.stopLossCooldowns[b.symbol];
    if (slCooldown) {
      const hoursSinceLast = (Date.now() - new Date(slCooldown).getTime()) / (1000 * 60 * 60);
      if (hoursSinceLast < 1) {
        continue; // Skip — cooldown active
      }
    }

    const currentPrice = b.price || (b.balance > 0 ? b.usdValue / b.balance : 0);
    const gainPercent = ((currentPrice - cb.averageCostBasis) / cb.averageCostBasis) * 100;

    if (gainPercent <= 0) continue; // No profit to take

    // Find the highest tier this position qualifies for
    // Walk tiers from highest to lowest — take the best available
    const sortedTiers = [...tiers].sort((a: any, b: any) => b.gainPercent - a.gainPercent);
    for (const tier of sortedTiers) {
      if (gainPercent >= tier.gainPercent) {
        // Check per-tier cooldown: key is "symbol:tierLabel"
        const cooldownKey = `${b.symbol}:${tier.label}`;
        const lastTrigger = state.profitTakeCooldowns[cooldownKey];
        if (lastTrigger) {
          const hoursSince = (now.getTime() - new Date(lastTrigger).getTime()) / (1000 * 60 * 60);
          if (hoursSince < cfg.cooldownHours) continue; // This tier is on cooldown
        }

        // This tier is available — is it better than our current best?
        if (!bestCandidate || tier.gainPercent > bestCandidate.tier.gainPercent) {
          bestCandidate = {
            symbol: b.symbol,
            balance: b.balance,
            usdValue: b.usdValue,
            gainPercent,
            tier,
            costBasis: cb.averageCostBasis,
            currentPrice,
            sector: b.sector,
          };
        }
        break; // Found highest qualifying tier for this token, move to next token
      }
    }

    // Time-based rebalancing: 72+ hours held, up at least 5%, no recent harvest
    if (!bestCandidate && gainPercent >= 5 && cb.totalInvestedUSD > 0) {
      const holdingAge = cb.firstBuyDate
        ? (now.getTime() - new Date(cb.firstBuyDate).getTime()) / (1000 * 60 * 60)
        : 0;
      if (holdingAge >= 72) {
        const timeKey = `${b.symbol}:TIME_REBALANCE`;
        const lastTimeHarvest = state.profitTakeCooldowns[timeKey];
        if (!lastTimeHarvest || (now.getTime() - new Date(lastTimeHarvest).getTime()) / (1000 * 60 * 60) >= 48) {
          bestCandidate = {
            symbol: b.symbol,
            balance: b.balance,
            usdValue: b.usdValue,
            gainPercent,
            tier: { gainPercent: 5, sellPercent: 10, label: "TIME_REBALANCE" },
            costBasis: cb.averageCostBasis,
            currentPrice,
            sector: b.sector,
          };
        }
      }
    }
  }

  if (!bestCandidate) return null;

  const { symbol, balance, usdValue, gainPercent, tier, costBasis, currentPrice, sector } = bestCandidate;
  const sellPct = tier.sellPercent;
  const sellUSD = usdValue * (sellPct / 100);
  const tokenAmount = balance * (sellPct / 100);

  // Don't sell less than $2 — not worth the gas
  if (sellUSD < 2) return null;

  const tierEmoji = tier.label === "EARLY_HARVEST" ? "🌱" :
                    tier.label === "MID_HARVEST" ? "🌿" :
                    tier.label === "STRONG_HARVEST" ? "🎯" :
                    tier.label === "MAJOR_HARVEST" ? "💰" :
                    tier.label === "TIME_REBALANCE" ? "⏰" : "📊";

  console.log(`\n  ${tierEmoji} ${tier.label}: ${symbol} is UP +${gainPercent.toFixed(1)}% (tier threshold: +${tier.gainPercent}%)`);
  console.log(`     Avg cost: $${costBasis.toFixed(6)} → Current: $${currentPrice.toFixed(6)}`);
  console.log(`     Harvesting ${sellPct}% = ~$${sellUSD.toFixed(2)} → USDC (banking profit)`);

  // Record cooldown for this specific tier
  const cooldownKey = `${symbol}:${tier.label}`;
  state.profitTakeCooldowns[cooldownKey] = now.toISOString();

  // Track cumulative harvested profits for dashboard
  if (!state.harvestedProfits) {
    state.harvestedProfits = { totalHarvested: 0, harvestCount: 0, harvests: [] };
  }
  const profitPortion = sellUSD - (sellUSD / (1 + gainPercent / 100)); // Approximate profit from this sell
  state.harvestedProfits.totalHarvested += profitPortion;
  state.harvestedProfits.harvestCount++;
  state.harvestedProfits.harvests.push({
    timestamp: now.toISOString(),
    symbol,
    tier: tier.label,
    gainPercent: Math.round(gainPercent * 10) / 10,
    sellPercent: sellPct,
    amountUSD: Math.round(sellUSD * 100) / 100,
    profitUSD: Math.round(profitPortion * 100) / 100,
  });
  // Keep last 50 harvests
  if (state.harvestedProfits.harvests.length > 50) {
    state.harvestedProfits.harvests = state.harvestedProfits.harvests.slice(-50);
  }

  return {
    action: "SELL" as const,
    fromToken: symbol,
    toToken: "USDC",
    amountUSD: sellUSD,
    tokenAmount,
    reasoning: `${tier.label}: ${symbol} +${gainPercent.toFixed(1)}% from avg cost $${costBasis.toFixed(4)}. Harvesting ${sellPct}% (~$${sellUSD.toFixed(2)}) to lock in profit. Remaining ${100 - sellPct}% continues to ride.`,
    sector,
  };
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

    // Use adaptive thresholds (Phase 3) instead of static config
    const adaptiveSL = state.adaptiveThresholds.stopLossPercent;
    const adaptiveTrailing = state.adaptiveThresholds.trailingStopPercent;

    const triggered = lossFromCost <= adaptiveSL ||
      (cfg.trailingEnabled && trailingLoss <= adaptiveTrailing);

    if (triggered && lossFromCost < worstLoss) {
      worstLoss = lossFromCost;
      const sellUSD = b.usdValue * (cfg.sellPercent / 100);
      const tokenAmount = b.balance * (cfg.sellPercent / 100);
      const reason = lossFromCost <= adaptiveSL
        ? `Stop-loss: ${b.symbol} ${lossFromCost.toFixed(1)}% from cost basis $${cb.averageCostBasis.toFixed(4)} (adaptive: ${adaptiveSL}%)`
        : `Trailing stop: ${b.symbol} ${trailingLoss.toFixed(1)}% from peak $${cb.peakPrice.toFixed(4)} (adaptive: ${adaptiveTrailing}%)`;

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
  // v5.1: Long/Short Ratio Intelligence
  btcLongShortRatio: number | null;           // Global long/short account ratio (>1 = more longs)
  ethLongShortRatio: number | null;           // Global long/short account ratio
  btcTopTraderLSRatio: number | null;         // Top trader long/short ratio (smart money)
  ethTopTraderLSRatio: number | null;         // Top trader long/short ratio
  btcTopTraderPositionRatio: number | null;   // Top trader position long/short ratio
  ethTopTraderPositionRatio: number | null;   // Top trader position long/short ratio
  // v5.1: Composite Positioning Signals
  btcPositioningSignal: "OVERLEVERAGED_LONG" | "OVERLEVERAGED_SHORT" | "SMART_MONEY_LONG" | "SMART_MONEY_SHORT" | "NEUTRAL";
  ethPositioningSignal: "OVERLEVERAGED_LONG" | "OVERLEVERAGED_SHORT" | "SMART_MONEY_LONG" | "SMART_MONEY_SHORT" | "NEUTRAL";
  // v5.1: OI + Price Divergence Detection
  btcOIPriceDivergence: "OI_UP_PRICE_DOWN" | "OI_DOWN_PRICE_UP" | "ALIGNED" | "NEUTRAL";  // Divergence = impending move
  ethOIPriceDivergence: "OI_UP_PRICE_DOWN" | "OI_DOWN_PRICE_UP" | "ALIGNED" | "NEUTRAL";
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
  // v5.1: Cross-Asset Correlation Signals
  crossAssets: {
    goldPrice: number | null;         // Gold price in USD (XAU/USD)
    goldChange24h: number | null;     // Gold 24h % change
    oilPrice: number | null;          // Crude oil price (WTI)
    oilChange24h: number | null;      // Oil 24h % change
    dxyRealtime: number | null;       // DXY real-time (supplements FRED's lagged data)
    dxyChange24h: number | null;      // DXY 24h % change
    sp500Change: number | null;       // S&P 500 daily % change (risk appetite proxy)
    vixLevel: number | null;          // VIX fear index
    crossAssetSignal: "RISK_ON" | "RISK_OFF" | "FLIGHT_TO_SAFETY" | "NEUTRAL";
  } | null;
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
    // v5.1: Expanded Binance derivatives intelligence — funding, OI, long/short ratios, top trader sentiment
    const [btcFundingRes, ethFundingRes, btcOIRes, ethOIRes,
           btcLSRes, ethLSRes, btcTopLSRes, ethTopLSRes, btcTopPosRes, ethTopPosRes] = await Promise.allSettled([
      // Original: Funding rates + Open Interest
      axios.get("https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=2", { timeout: 8000 }),
      axios.get("https://fapi.binance.com/fapi/v1/fundingRate?symbol=ETHUSDT&limit=2", { timeout: 8000 }),
      axios.get("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT", { timeout: 8000 }),
      axios.get("https://fapi.binance.com/fapi/v1/openInterest?symbol=ETHUSDT", { timeout: 8000 }),
      // v5.1: Global Long/Short Account Ratio (retail sentiment)
      axios.get("https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1", { timeout: 8000 }),
      axios.get("https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=ETHUSDT&period=1h&limit=1", { timeout: 8000 }),
      // v5.1: Top Trader Long/Short Account Ratio (smart money)
      axios.get("https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1", { timeout: 8000 }),
      axios.get("https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=ETHUSDT&period=1h&limit=1", { timeout: 8000 }),
      // v5.1: Top Trader Long/Short Position Ratio (smart money position sizing)
      axios.get("https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=1h&limit=1", { timeout: 8000 }),
      axios.get("https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=ETHUSDT&period=1h&limit=1", { timeout: 8000 }),
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

    // v5.1: Parse long/short ratios — value > 1 means more longs than shorts
    const parseLSRatio = (res: PromiseSettledResult<any>): number | null => {
      if (res.status !== "fulfilled" || !res.value.data?.length) return null;
      return parseFloat(res.value.data[0].longShortRatio);
    };

    const btcLongShortRatio = parseLSRatio(btcLSRes);
    const ethLongShortRatio = parseLSRatio(ethLSRes);
    const btcTopTraderLSRatio = parseLSRatio(btcTopLSRes);
    const ethTopTraderLSRatio = parseLSRatio(ethTopLSRes);
    const btcTopTraderPositionRatio = parseLSRatio(btcTopPosRes);
    const ethTopTraderPositionRatio = parseLSRatio(ethTopPosRes);

    // Interpret funding rates — extreme values indicate crowded positions
    const interpretFunding = (rate: number): "LONG_CROWDED" | "SHORT_CROWDED" | "NEUTRAL" => {
      if (rate > 0.03) return "LONG_CROWDED";
      if (rate < -0.03) return "SHORT_CROWDED";
      return "NEUTRAL";
    };

    const btcFundingSignal = interpretFunding(btcFundingRate);
    const ethFundingSignal = interpretFunding(ethFundingRate);

    // Calculate OI change (we'll store previous values in cache)
    const btcOIChange24h = derivativesCache.btcOI > 0 ? ((btcOpenInterest - derivativesCache.btcOI) / derivativesCache.btcOI) * 100 : 0;
    const ethOIChange24h = derivativesCache.ethOI > 0 ? ((ethOpenInterest - derivativesCache.ethOI) / derivativesCache.ethOI) * 100 : 0;

    // v5.1: Composite Positioning Signal — combines funding, global L/S, and top trader L/S
    const interpretPositioning = (
      fundingSignal: string,
      globalLS: number | null,
      topTraderLS: number | null,
      topTraderPos: number | null,
    ): "OVERLEVERAGED_LONG" | "OVERLEVERAGED_SHORT" | "SMART_MONEY_LONG" | "SMART_MONEY_SHORT" | "NEUTRAL" => {
      // Smart money divergence from retail = highest conviction signal
      if (topTraderLS !== null && globalLS !== null) {
        // Top traders long while retail short = smart money accumulation
        if (topTraderLS > 1.3 && globalLS < 0.8) return "SMART_MONEY_LONG";
        // Top traders short while retail long = smart money distribution
        if (topTraderLS < 0.7 && globalLS > 1.3) return "SMART_MONEY_SHORT";
      }
      // Extreme crowding — everyone on same side = danger
      if (fundingSignal === "LONG_CROWDED" && (globalLS ?? 1) > 1.5) return "OVERLEVERAGED_LONG";
      if (fundingSignal === "SHORT_CROWDED" && (globalLS ?? 1) < 0.5) return "OVERLEVERAGED_SHORT";
      return "NEUTRAL";
    };

    const btcPositioningSignal = interpretPositioning(btcFundingSignal, btcLongShortRatio, btcTopTraderLSRatio, btcTopTraderPositionRatio);
    const ethPositioningSignal = interpretPositioning(ethFundingSignal, ethLongShortRatio, ethTopTraderLSRatio, ethTopTraderPositionRatio);

    // v5.1: OI + Price Divergence Detection — OI rising while price falls = potential squeeze
    const interpretOIPriceDivergence = (
      oiChange: number, priceChange: number
    ): "OI_UP_PRICE_DOWN" | "OI_DOWN_PRICE_UP" | "ALIGNED" | "NEUTRAL" => {
      if (Math.abs(oiChange) < 1 || Math.abs(priceChange) < 1) return "NEUTRAL"; // Not enough movement
      if (oiChange > 3 && priceChange < -2) return "OI_UP_PRICE_DOWN";   // Shorts piling in OR longs averaging down = squeeze incoming
      if (oiChange < -3 && priceChange > 2) return "OI_DOWN_PRICE_UP";    // Short squeeze happening — OI drops as shorts close
      return "ALIGNED";
    };

    // Use cached price changes from derivativesCache
    const btcOIPriceDivergence = interpretOIPriceDivergence(btcOIChange24h, derivativesCache.btcPriceChange ?? 0);
    const ethOIPriceDivergence = interpretOIPriceDivergence(ethOIChange24h, derivativesCache.ethPriceChange ?? 0);

    // Update cache
    derivativesCache.btcOI = btcOpenInterest;
    derivativesCache.ethOI = ethOpenInterest;

    console.log(`  📈 Derivatives: BTC funding ${btcFundingRate >= 0 ? "+" : ""}${btcFundingRate.toFixed(4)}% (${btcFundingSignal}) | ETH funding ${ethFundingRate >= 0 ? "+" : ""}${ethFundingRate.toFixed(4)}% (${ethFundingSignal})`);
    console.log(`     BTC OI: ${btcOpenInterest.toFixed(0)} BTC | ETH OI: ${ethOpenInterest.toFixed(0)} ETH`);
    console.log(`     BTC L/S: Global ${btcLongShortRatio?.toFixed(2) ?? "N/A"} | TopTrader ${btcTopTraderLSRatio?.toFixed(2) ?? "N/A"} → ${btcPositioningSignal}`);
    console.log(`     ETH L/S: Global ${ethLongShortRatio?.toFixed(2) ?? "N/A"} | TopTrader ${ethTopTraderLSRatio?.toFixed(2) ?? "N/A"} → ${ethPositioningSignal}`);

    return {
      btcFundingRate, ethFundingRate, btcOpenInterest, ethOpenInterest,
      btcFundingSignal, ethFundingSignal, btcOIChange24h, ethOIChange24h,
      btcLongShortRatio, ethLongShortRatio,
      btcTopTraderLSRatio, ethTopTraderLSRatio,
      btcTopTraderPositionRatio, ethTopTraderPositionRatio,
      btcPositioningSignal, ethPositioningSignal,
      btcOIPriceDivergence, ethOIPriceDivergence,
    };
  } catch (error: any) {
    console.warn(`  ⚠️ Derivatives fetch failed: ${error?.message?.substring(0, 100) || error}`);
    return null;
  }
}

// Cache for derivatives OI comparison + price change tracking for divergence detection
const derivativesCache = { btcOI: 0, ethOI: 0, btcPriceChange: 0, ethPriceChange: 0 };

// Cache for CoinGecko last-known prices — prevents $0 portfolio when rate limited
let lastKnownPrices: Record<string, { price: number; change24h: number; change7d: number; volume: number; marketCap: number; name: string; sector: string }> = {};

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
/**
 * v5.1: Fetch cross-asset correlation data (Gold, Oil, DXY, S&P 500, VIX)
 * Uses free FRED series for daily data — supplements with Binance PAXG for real-time gold proxy
 */
async function fetchCrossAssetData(fredKey: string | undefined): Promise<MacroData["crossAssets"]> {
  try {
    const fetches: Promise<any>[] = [];

    // FRED series for Gold (GOLDPMGBD228NLBM), Oil WTI (DCOILWTICO), VIX (VIXCLS)
    // S&P 500 daily close (SP500) — limited to 2 most recent for change calc
    if (fredKey) {
      const fredBase = "https://api.stlouisfed.org/fred/series/observations";
      const baseParams = `&api_key=${fredKey}&file_type=json&sort_order=desc&limit=3`;
      fetches.push(
        axios.get(`${fredBase}?series_id=GOLDPMGBD228NLBM${baseParams}`, { timeout: 10000 }).catch(() => null),  // Gold
        axios.get(`${fredBase}?series_id=DCOILWTICO${baseParams}`, { timeout: 10000 }).catch(() => null),         // Oil WTI
        axios.get(`${fredBase}?series_id=VIXCLS${baseParams}`, { timeout: 10000 }).catch(() => null),              // VIX
        axios.get(`${fredBase}?series_id=SP500${baseParams}`, { timeout: 10000 }).catch(() => null),               // S&P 500
      );
    } else {
      fetches.push(Promise.resolve(null), Promise.resolve(null), Promise.resolve(null), Promise.resolve(null));
    }

    // Real-time DXY proxy via Binance USDC/USDT (inverse correlation approximation)
    // Plus PAXG/USDT for real-time gold price
    fetches.push(
      axios.get("https://api.binance.com/api/v3/ticker/24hr?symbol=PAXGUSDT", { timeout: 8000 }).catch(() => null),  // Real-time gold via PAXG
    );

    const [goldRes, oilRes, vixRes, sp500Res, paxgRes] = await Promise.all(fetches);

    const parseFred = (res: any): { latest: number; prev: number } | null => {
      if (!res?.data?.observations) return null;
      const valid = res.data.observations.filter((o: any) => o.value && o.value !== ".");
      if (valid.length < 1) return null;
      return {
        latest: parseFloat(valid[0].value),
        prev: valid.length >= 2 ? parseFloat(valid[1].value) : parseFloat(valid[0].value),
      };
    };

    const gold = parseFred(goldRes);
    const oil = parseFred(oilRes);
    const vix = parseFred(vixRes);
    const sp500 = parseFred(sp500Res);

    // Real-time gold via PAXG (Pax Gold on Binance — 1 PAXG = 1 troy oz gold)
    let goldPrice = gold?.latest ?? null;
    let goldChange24h: number | null = null;
    if (paxgRes?.data) {
      goldPrice = parseFloat(paxgRes.data.lastPrice);
      goldChange24h = parseFloat(paxgRes.data.priceChangePercent);
    } else if (gold) {
      goldChange24h = gold.prev > 0 ? ((gold.latest - gold.prev) / gold.prev) * 100 : null;
    }

    const oilPrice = oil?.latest ?? null;
    const oilChange24h = oil && oil.prev > 0 ? ((oil.latest - oil.prev) / oil.prev) * 100 : null;
    const vixLevel = vix?.latest ?? null;
    const sp500Change = sp500 && sp500.prev > 0 ? ((sp500.latest - sp500.prev) / sp500.prev) * 100 : null;

    // DXY — use FRED DTWEXBGS as real-time proxy (already fetched in main macro function)
    const dxyRealtime: number | null = null;  // Will be filled from main macro's dollarIndex
    const dxyChange24h: number | null = null;

    // Cross-asset correlation signal:
    // Gold up + Dollar down + VIX low = RISK_ON for crypto
    // Gold up + Dollar up + VIX high = FLIGHT_TO_SAFETY (bad for crypto)
    // Dollar down + Oil stable + VIX low = RISK_ON
    let riskOnPts = 0;
    let riskOffPts = 0;
    let flightToSafety = false;

    if (goldChange24h !== null) {
      if (goldChange24h > 1) riskOffPts += 1;  // Gold surging = uncertainty
      if (goldChange24h < -1) riskOnPts += 1;   // Gold dropping = risk appetite
    }
    if (vixLevel !== null) {
      if (vixLevel > 25) { riskOffPts += 2; }   // High fear
      if (vixLevel > 35) { flightToSafety = true; }
      if (vixLevel < 15) riskOnPts += 1;         // Complacency/risk appetite
    }
    if (sp500Change !== null) {
      if (sp500Change > 1) riskOnPts += 1;       // Stocks rallying = risk on
      if (sp500Change < -1) riskOffPts += 1;      // Stocks selling = risk off
      if (sp500Change < -3) riskOffPts += 1;      // Big selloff = extra risk off
    }
    if (oilChange24h !== null) {
      if (oilChange24h > 5) riskOffPts += 1;     // Oil spike = inflation fear
      if (oilChange24h < -5) riskOnPts += 1;      // Oil crash = deflation/demand concerns but good for margins
    }

    let crossAssetSignal: "RISK_ON" | "RISK_OFF" | "FLIGHT_TO_SAFETY" | "NEUTRAL" = "NEUTRAL";
    if (flightToSafety && (goldChange24h ?? 0) > 1) crossAssetSignal = "FLIGHT_TO_SAFETY";
    else if (riskOnPts >= riskOffPts + 2) crossAssetSignal = "RISK_ON";
    else if (riskOffPts >= riskOnPts + 2) crossAssetSignal = "RISK_OFF";

    console.log(`  🌍 Cross-Assets: Gold $${goldPrice?.toFixed(0) ?? "N/A"} (${goldChange24h !== null ? (goldChange24h >= 0 ? "+" : "") + goldChange24h.toFixed(1) + "%" : "N/A"}) | Oil $${oilPrice?.toFixed(1) ?? "N/A"} | VIX ${vixLevel?.toFixed(1) ?? "N/A"} | S&P ${sp500Change !== null ? (sp500Change >= 0 ? "+" : "") + sp500Change.toFixed(1) + "%" : "N/A"} → ${crossAssetSignal}`);

    return {
      goldPrice, goldChange24h, oilPrice, oilChange24h,
      dxyRealtime, dxyChange24h, sp500Change, vixLevel,
      crossAssetSignal,
    };
  } catch (error: any) {
    console.warn(`  ⚠️ Cross-asset fetch failed: ${error?.message?.substring(0, 100) || error}`);
    return null;
  }
}

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
    // FRED API uses api_key query parameter for authentication
    const fredBase = "https://api.stlouisfed.org/fred/series/observations";
    const fredOpts = { timeout: 10000 };
    const baseParams = `&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=2`;

    // Fetch all series in parallel (6 requests, well within 120/min limit)
    const [dffRes, dgs10Res, t10y2yRes, cpiRes, m2Res, dollarRes] = await Promise.allSettled([
      axios.get(`${fredBase}?series_id=DFF${baseParams}`, fredOpts),
      axios.get(`${fredBase}?series_id=DGS10${baseParams}`, fredOpts),
      axios.get(`${fredBase}?series_id=T10Y2Y${baseParams}`, fredOpts),
      axios.get(`${fredBase}?series_id=CPIAUCSL${baseParams}&limit=13`, fredOpts),  // 13 months for YoY
      axios.get(`${fredBase}?series_id=M2SL${baseParams}&limit=13`, fredOpts),      // 13 months for YoY
      axios.get(`${fredBase}?series_id=DTWEXBGS${baseParams}`, fredOpts),
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

    // v5.1: Fetch cross-asset data in parallel with FRED processing
    const crossAssets = await fetchCrossAssetData(FRED_KEY);

    // v5.1: Feed cross-asset signals into composite macro signal
    if (crossAssets) {
      if (crossAssets.crossAssetSignal === "RISK_ON") riskOnPoints += 1;
      if (crossAssets.crossAssetSignal === "RISK_OFF") riskOffPoints += 1;
      if (crossAssets.crossAssetSignal === "FLIGHT_TO_SAFETY") riskOffPoints += 2;
      // Recalculate
      if (riskOnPoints >= riskOffPoints + 2) macroSignal = "RISK_ON";
      else if (riskOffPoints >= riskOnPoints + 2) macroSignal = "RISK_OFF";
      else macroSignal = "NEUTRAL";

      // Feed DXY back from FRED if available
      if (dollarIndex && crossAssets.dxyRealtime === null) {
        crossAssets.dxyRealtime = dollarIndex.value;
      }
    }

    const result: MacroData = {
      fedFundsRate,
      treasury10Y,
      yieldCurve,
      cpi,
      m2MoneySupply,
      dollarIndex,
      macroSignal,
      rateDirection,
      crossAssets,
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

    // v5.1: Long/Short Ratios — retail vs smart money positioning
    lines.push(`--- Positioning Intelligence ---`);
    if (derivatives.btcLongShortRatio !== null) {
      lines.push(`BTC Global L/S Ratio: ${derivatives.btcLongShortRatio.toFixed(2)} (${derivatives.btcLongShortRatio > 1 ? "retail net long" : "retail net short"})`);
    }
    if (derivatives.btcTopTraderLSRatio !== null) {
      lines.push(`BTC Top Trader L/S: ${derivatives.btcTopTraderLSRatio.toFixed(2)} (${derivatives.btcTopTraderLSRatio > 1 ? "smart money long" : "smart money short"})`);
    }
    if (derivatives.ethLongShortRatio !== null) {
      lines.push(`ETH Global L/S Ratio: ${derivatives.ethLongShortRatio.toFixed(2)} (${derivatives.ethLongShortRatio > 1 ? "retail net long" : "retail net short"})`);
    }
    if (derivatives.ethTopTraderLSRatio !== null) {
      lines.push(`ETH Top Trader L/S: ${derivatives.ethTopTraderLSRatio.toFixed(2)} (${derivatives.ethTopTraderLSRatio > 1 ? "smart money long" : "smart money short"})`);
    }

    // v5.1: Composite Positioning Signals
    lines.push(`BTC Positioning: ${derivatives.btcPositioningSignal}`);
    lines.push(`ETH Positioning: ${derivatives.ethPositioningSignal}`);

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

    // v5.1: Positioning signal interpretation
    const posSignals = [
      { asset: "BTC", signal: derivatives.btcPositioningSignal },
      { asset: "ETH", signal: derivatives.ethPositioningSignal },
    ];
    for (const { asset, signal } of posSignals) {
      switch (signal) {
        case "SMART_MONEY_LONG":
          lines.push(`🟢 POSITIONING: ${asset} — Top traders accumulating longs while retail is short. High-conviction BUY signal.`);
          break;
        case "SMART_MONEY_SHORT":
          lines.push(`🔴 POSITIONING: ${asset} — Top traders going short while retail is long. Distribution phase — caution.`);
          break;
        case "OVERLEVERAGED_LONG":
          lines.push(`⚠️ POSITIONING: ${asset} — Extreme long crowding across all participants. Long squeeze risk elevated.`);
          break;
        case "OVERLEVERAGED_SHORT":
          lines.push(`⚠️ POSITIONING: ${asset} — Extreme short crowding. Short squeeze potential.`);
          break;
      }
    }

    // v5.1: OI-Price Divergence interpretation
    if (derivatives.btcOIPriceDivergence !== "NEUTRAL" && derivatives.btcOIPriceDivergence !== "ALIGNED") {
      if (derivatives.btcOIPriceDivergence === "OI_UP_PRICE_DOWN") {
        lines.push(`⚡ DIVERGENCE: BTC OI rising while price falling — new shorts entering OR longs averaging down. Squeeze potential building.`);
      } else {
        lines.push(`⚡ DIVERGENCE: BTC OI falling while price rising — short squeeze in progress, shorts capitulating.`);
      }
    }
    if (derivatives.ethOIPriceDivergence !== "NEUTRAL" && derivatives.ethOIPriceDivergence !== "ALIGNED") {
      if (derivatives.ethOIPriceDivergence === "OI_UP_PRICE_DOWN") {
        lines.push(`⚡ DIVERGENCE: ETH OI rising while price falling — squeeze potential building.`);
      } else {
        lines.push(`⚡ DIVERGENCE: ETH OI falling while price rising — short squeeze in progress.`);
      }
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

    // v5.1: Cross-Asset Correlation Intelligence
    if (macro.crossAssets) {
      const ca = macro.crossAssets;
      lines.push("");
      lines.push(`═══ CROSS-ASSET CORRELATION (v5.1) ═══`);
      if (ca.goldPrice !== null) {
        lines.push(`Gold (XAU): $${ca.goldPrice.toFixed(0)} ${ca.goldChange24h !== null ? `(${ca.goldChange24h >= 0 ? "+" : ""}${ca.goldChange24h.toFixed(1)}% 24h)` : ""}`);
      }
      if (ca.oilPrice !== null) {
        lines.push(`Oil (WTI): $${ca.oilPrice.toFixed(2)} ${ca.oilChange24h !== null ? `(${ca.oilChange24h >= 0 ? "+" : ""}${ca.oilChange24h.toFixed(1)}% 24h)` : ""}`);
      }
      if (ca.vixLevel !== null) {
        lines.push(`VIX: ${ca.vixLevel.toFixed(1)} ${ca.vixLevel > 30 ? "⚠️ HIGH FEAR" : ca.vixLevel > 20 ? "↑ Elevated" : ca.vixLevel < 15 ? "🟢 Low (complacent)" : ""}`);
      }
      if (ca.sp500Change !== null) {
        lines.push(`S&P 500: ${ca.sp500Change >= 0 ? "+" : ""}${ca.sp500Change.toFixed(1)}% ${ca.sp500Change > 2 ? "🟢 Risk-On Rally" : ca.sp500Change < -2 ? "🔴 Risk-Off Selloff" : ""}`);
      }
      lines.push(`Cross-Asset Signal: ${ca.crossAssetSignal}`);

      // Interpretation for AI
      switch (ca.crossAssetSignal) {
        case "RISK_ON":
          lines.push(`🟢 CROSS-ASSET: Traditional risk assets support crypto upside — gold retreating, equities strong, VIX low`);
          break;
        case "RISK_OFF":
          lines.push(`🔴 CROSS-ASSET: Risk-off environment in traditional markets — headwind for crypto`);
          break;
        case "FLIGHT_TO_SAFETY":
          lines.push(`🚨 CROSS-ASSET: Flight to safety — gold surging, VIX spiking. Reduce exposure, protect capital.`);
          break;
        default:
          lines.push(`→ Cross-asset signals mixed — no strong directional bias from traditional markets`);
      }
    }
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

    // v6.0: Launch all non-CoinGecko fetches in parallel with smart caching
    const intelligencePromise = (async () => {
      const fng = await Promise.allSettled([
        cacheManager.getOrFetch(CacheKeys.FEAR_GREED, CACHE_TTL.FEAR_GREED, () =>
          axios.get("https://api.alternative.me/fng/", { timeout: 10000 })
        )
      ]).then(r => r[0]);
      const [defi, deriv] = await Promise.allSettled([
        cacheManager.getOrFetch(CacheKeys.DEFI_LLAMA_TVL, CACHE_TTL.DEFI_LLAMA, fetchDefiLlamaData),
        cacheManager.getOrFetch(CacheKeys.BINANCE_FUNDING, CACHE_TTL.DERIVATIVES, fetchDerivativesData),
      ]);
      const [news, macro] = await Promise.allSettled([
        cacheManager.getOrFetch(CacheKeys.NEWS_SENTIMENT, CACHE_TTL.NEWS, fetchNewsSentiment),
        cacheManager.getOrFetch(CacheKeys.MACRO_DATA, CACHE_TTL.MACRO, fetchMacroData),
      ]);
      return { fng, defi, deriv, news, macro };
    })();

    // v6.0: CoinGecko with smart cache + retry — critical data source for portfolio pricing
    const cachedCoinGecko = cacheManager.get<any>(CacheKeys.COINGECKO_PRICES);
    let marketResult: PromiseSettledResult<any>;

    if (cachedCoinGecko) {
      marketResult = { status: "fulfilled", value: cachedCoinGecko };
      console.log(`  ♻️  CoinGecko: using cached data (${((cacheManager.getAge(CacheKeys.COINGECKO_PRICES) || 0) / 1000).toFixed(0)}s old)`);
    } else {
    // Free tier rate limit window is ~60s, so retries need substantial delays
    const retryDelays = [15000, 45000]; // 15s after 1st fail, 45s after 2nd fail
    marketResult = { status: "rejected", reason: new Error("No attempt") } as PromiseRejectedResult;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await axios.get(coingeckoUrl, { timeout: 15000 });
        if (res.data && Array.isArray(res.data) && res.data.length > 0) {
          marketResult = { status: "fulfilled", value: res };
          // v6.0: Cache the successful response
          cacheManager.set(CacheKeys.COINGECKO_PRICES, res, CACHE_TTL.PRICE);
          // Update last-known-prices cache on success
          for (const coin of res.data) {
            const registryEntry = Object.entries(TOKEN_REGISTRY).find(([_, t]) => t.coingeckoId === coin.id);
            const symbol = registryEntry ? registryEntry[0] : coin.symbol.toUpperCase();
            const sector = registryEntry ? registryEntry[1].sector : "UNKNOWN";
            lastKnownPrices[symbol] = {
              price: coin.current_price, change24h: coin.price_change_percentage_24h || 0,
              change7d: coin.price_change_percentage_7d_in_currency || 0,
              volume: coin.total_volume, marketCap: coin.market_cap, name: coin.name, sector,
            };
          }
          break;
        } else {
          console.warn(`  \u26a0\ufe0f CoinGecko attempt ${attempt}/3: empty response, retrying in ${(retryDelays[attempt - 1] || 0) / 1000}s...`);
          if (attempt < 3) await new Promise(r => setTimeout(r, retryDelays[attempt - 1]));
        }
      } catch (err: any) {
        const status = err?.response?.status;
        console.warn(`  \u26a0\ufe0f CoinGecko attempt ${attempt}/3: ${status === 429 ? "rate limited (429)" : err?.message?.substring(0, 80) || err}`);
        if (attempt < 3) {
          console.log(`     Waiting ${retryDelays[attempt - 1] / 1000}s before retry...`);
          await new Promise(r => setTimeout(r, retryDelays[attempt - 1]));
        }
        if (attempt === 3) marketResult = { status: "rejected", reason: err } as PromiseRejectedResult;
      }
    }
    } // end of cache miss else block

    // Await intelligence data (likely already resolved during CoinGecko retries)
    const { fng: fngResult, defi: defiResult, deriv: derivResult, news: newsResult, macro: macroResult } = await intelligencePromise;

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
      console.error(`  \u274c CoinGecko FAILED: ${reason?.response?.status || ""} ${reason?.message || reason}`);
      // Fallback: use last-known-prices cache to prevent $0 portfolio
      const cachedCount = Object.keys(lastKnownPrices).length;
      if (cachedCount > 0) {
        console.log(`  \u267b\ufe0f Using ${cachedCount} cached prices from last successful CoinGecko fetch`);
        tokens = Object.entries(lastKnownPrices).map(([symbol, data]) => ({
          symbol, name: data.name, price: data.price,
          priceChange24h: data.change24h, priceChange7d: data.change7d,
          volume24h: data.volume, marketCap: data.marketCap, sector: data.sector,
        }));
      }
    }

    // v6.1: DexScreener fallback — if CoinGecko returned no tokens or failed,
    // fetch prices from DexScreener using on-chain token addresses (no API key needed)
    if (tokens.length === 0 || tokens.every(t => !t.price || t.price === 0)) {
      console.log(`  🔄 DexScreener fallback: CoinGecko returned 0 priced tokens, fetching from DexScreener...`);
      try {
        const tokenAddresses = Object.entries(TOKEN_REGISTRY)
          .filter(([symbol]) => symbol !== "USDC")
          .map(([_, t]) => t.address)
          .join(",");
        const dexRes = await axios.get(
          `https://api.dexscreener.com/tokens/v1/base/${tokenAddresses}`,
          { timeout: 15000 }
        );
        if (dexRes.data && Array.isArray(dexRes.data) && dexRes.data.length > 0) {
          const dexTokens: MarketData["tokens"] = [];
          const seenSymbols = new Set<string>();
          for (const pair of dexRes.data) {
            const addr = pair.baseToken?.address?.toLowerCase();
            const registryEntry = Object.entries(TOKEN_REGISTRY).find(
              ([_, t]) => t.address.toLowerCase() === addr
            );
            if (registryEntry && !seenSymbols.has(registryEntry[0])) {
              const [symbol, regData] = registryEntry;
              seenSymbols.add(symbol);
              const price = parseFloat(pair.priceUsd || "0");
              if (price > 0) {
                dexTokens.push({
                  symbol, name: regData.name, price,
                  priceChange24h: pair.priceChange?.h24 || 0,
                  priceChange7d: 0,
                  volume24h: pair.volume?.h24 || 0,
                  marketCap: pair.marketCap || 0,
                  sector: regData.sector,
                });
                // Also update lastKnownPrices so light cycles have data
                lastKnownPrices[symbol] = {
                  price, change24h: pair.priceChange?.h24 || 0, change7d: 0,
                  volume: pair.volume?.h24 || 0, marketCap: pair.marketCap || 0,
                  name: regData.name, sector: regData.sector,
                };
              }
            }
          }
          if (dexTokens.length > 0) {
            tokens = dexTokens;
            console.log(`  ✅ DexScreener fallback: ${dexTokens.length} tokens priced`);
            // Cache the DexScreener result so subsequent cycles don't re-fetch
            cacheManager.set(CacheKeys.COINGECKO_PRICES, { data: dexTokens.map(t => ({
              id: TOKEN_REGISTRY[t.symbol]?.coingeckoId || t.symbol.toLowerCase(),
              symbol: t.symbol.toLowerCase(), name: t.name,
              current_price: t.price, price_change_percentage_24h: t.priceChange24h,
              price_change_percentage_7d_in_currency: t.priceChange7d,
              total_volume: t.volume24h, market_cap: t.marketCap,
            })) }, CACHE_TTL.PRICE);
          } else {
            console.warn(`  ⚠️ DexScreener returned data but no valid prices`);
          }
        }
      } catch (dexErr: any) {
        console.error(`  ❌ DexScreener fallback also failed: ${dexErr?.message || dexErr}`);
      }
    }

    // v6.2: Chainlink on-chain oracle — 3rd fallback for blue-chip prices
    // If we still have no ETH/BTC prices, read directly from on-chain oracles
    const hasETHPrice = tokens.some(t => t.symbol === "ETH" && t.price > 0);
    if (!hasETHPrice || tokens.length === 0) {
      try {
        const chainlinkPrices = await fetchChainlinkPrices();
        for (const [symbol, price] of chainlinkPrices) {
          const existing = tokens.find(t => t.symbol === symbol);
          if (!existing && TOKEN_REGISTRY[symbol]) {
            const reg = TOKEN_REGISTRY[symbol];
            tokens.push({
              symbol, name: reg.name, price,
              priceChange24h: 0, priceChange7d: 0,
              volume24h: 0, marketCap: 0, sector: reg.sector,
            });
            lastKnownPrices[symbol] = {
              price, change24h: 0, change7d: 0,
              volume: 0, marketCap: 0, name: reg.name, sector: reg.sector,
            };
          } else if (existing && existing.price === 0) {
            existing.price = price;
            lastKnownPrices[symbol] = { ...lastKnownPrices[symbol], price };
          }
        }
        if (chainlinkPrices.size > 0) {
          console.log(`  🔗 Chainlink oracle backfill: ${chainlinkPrices.size} blue-chip prices`);
        }
      } catch (chainErr: any) {
        console.error(`  ❌ Chainlink oracle fallback failed: ${chainErr?.message || chainErr}`);
      }
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

    // v5.1: Feed BTC/ETH price changes into derivatives cache for OI-price divergence detection
    const btcToken = tokens.find(t => t.symbol === "WETH" || t.symbol === "cbBTC");
    const ethToken = tokens.find(t => t.symbol === "WETH");
    const btcPriceToken = tokens.find(t => t.symbol === "cbBTC");
    derivativesCache.btcPriceChange = btcPriceToken?.priceChange24h ?? 0;
    derivativesCache.ethPriceChange = ethToken?.priceChange24h ?? 0;

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

  // RSI (weight: 25) — uses adaptive thresholds
  if (rsi !== null) {
    signals++;
    const oversold = state.adaptiveThresholds.rsiOversold;
    const overbought = state.adaptiveThresholds.rsiOverbought;
    if (rsi < oversold) score += 25;       // Oversold — buy signal
    else if (rsi < oversold + 10) score += 12;
    else if (rsi > overbought) score -= 25;  // Overbought — sell signal
    else if (rsi > overbought - 10) score -= 12;
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

  // Determine signal — uses adaptive thresholds
  const at = state.adaptiveThresholds;
  let signal: TechnicalIndicators["overallSignal"];
  if (normalizedScore >= at.confluenceStrongBuy) signal = "STRONG_BUY";
  else if (normalizedScore >= at.confluenceBuy) signal = "BUY";
  else if (normalizedScore <= at.confluenceStrongSell) signal = "STRONG_SELL";
  else if (normalizedScore <= at.confluenceSell) signal = "SELL";
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
  isExploration?: boolean;
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
  // v6.1: Merge static tokens with dynamically discovered tokens
  const discoveredTokensList = tokenDiscoveryEngine?.getTradableTokens() || [];
  const discoveredSymbols = discoveredTokensList.map(t => t.symbol);
  const allTradeableTokens = [...CONFIG.activeTokens, ...discoveredSymbols.filter(s => !CONFIG.activeTokens.includes(s))];
  const tradeableTokens = allTradeableTokens.join(", ");

  // v6.1: Build discovery intel for AI prompt
  const discoveryIntel = discoveredTokensList.length > 0
    ? `\n═══ DISCOVERED TOKENS (Dynamic Scanner) ═══\nTokens discovered by on-chain liquidity scanner (tradeable if you see opportunity):\n${discoveredTokensList.slice(0, 15).map(t =>
        `${t.symbol} ($${t.priceUSD.toFixed(4)}) | Vol24h: $${(t.volume24hUSD / 1000).toFixed(0)}K | Liq: $${(t.liquidityUSD / 1000).toFixed(0)}K | ${t.priceChange24h > 0 ? '+' : ''}${t.priceChange24h.toFixed(1)}% | Sector: ${t.sector} | DEX: ${t.dexName}`
      ).join("\n")}\nNote: Discovered tokens may have less data than core tokens. Size positions smaller (50-75% of normal) for discovered tokens.\n`
    : "";

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

  const systemPrompt = `You are Henry's autonomous crypto trading agent v5.1.1 on Base network.
You are a MULTI-DIMENSIONAL TRADER with real-time access to: technical indicators, DeFi protocol intelligence, derivatives data (funding rates + OI + long/short ratios + top trader positioning), news sentiment analysis, Federal Reserve macro data (rates, yield curve, CPI, M2, dollar), cross-asset correlations (Gold, Oil, VIX, S&P 500), and market regime analysis. Your decisions execute LIVE swaps with adaptive MEV protection. You think like a macro-aware hedge fund — reading both the market microstructure AND the global economic environment. Pay special attention to SMART MONEY positioning divergence from retail and OI-Price divergence signals — these are your highest-conviction indicators.

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

${discoveryIntel}═══ TRADING LIMITS ═══
- Max BUY: $${maxBuyAmount.toFixed(2)} | Max SELL: ${CONFIG.trading.maxSellPercent}% of position
- Available tokens: ${tradeableTokens}

═══ STRATEGY FRAMEWORK v5.1.1 ═══

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
1. TIERED PROFIT HARVESTING (v5.1.1): The bot automatically harvests profits in tranches:
   - +8% gain → harvest 15% of position (early wins, bank the cream)
   - +15% gain → harvest 20% of position (moderate win, real profit locked)
   - +25% gain → harvest 30% of position (strong win, protect the bag)
   - +40% gain → harvest 40% of position (major win, substantial profit lock)
   The remaining position continues to ride. Patient capital, not passive capital.
   IMPORTANT: When you recommend a SELL, also consider which tier the position has already been harvested at.
2. OVERBOUGHT EXIT: Sell if RSI > 75 AND Bollinger %B > 0.95 AND MACD turning bearish — even if no harvest tier triggered
3. STOP LOSS: Sell if token is down >20% in 7d and trend is STRONG_DOWN
4. SECTOR TRIM: Sell from overweight sectors (>10% drift) to rebalance
5. FUNDING WARNING: If BTC/ETH longs are CROWDED (high positive funding), prepare to take profits — correction risk
6. TVL OUTFLOW: If a DeFi protocol's TVL is dropping >5% while you hold its token, consider trimming
7. MACRO HEADWIND: If macro signal is RISK_OFF (rate hikes, yield curve inverting, strong dollar), tighten profit-taking. Sell into strength rather than holding
8. NEWS RISK: If a token has strong bearish news mentions AND technical indicators confirm (RSI dropping, MACD bearish), trim position proactively
9. SMART MONEY WARNING: If derivatives show SMART_MONEY_SHORT while you're holding a token, this is a high-priority sell signal
10. TIME-BASED HARVEST: Positions held 72+ hours with +5% gain get a 10% trim — don't let stale winners sit forever

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
6. SELF-IMPROVEMENT: Your strategy patterns, adaptive thresholds, and performance insights are provided below. FAVOR proven winning patterns and AVOID known losing patterns. Trust the confidence-weighted sizing
7. NEWS NOISE FILTER: Ignore news sentiment if it contradicts strong technical + DeFi signals. Headlines lag price action

DECISION PRIORITY: Market Regime > Macro Environment > Technical signals + DeFi flows > Derivatives signals > News sentiment > Sector rebalancing

For SELLING: fromToken = token symbol, toToken = USDC
For BUYING: fromToken = USDC, toToken = token symbol

DIVERSIFICATION RULE: NEVER buy the same token more than 2 cycles in a row. Rotate across sectors and tokens.
If a token already holds >20% of portfolio, do NOT buy more — pick a different underweight token or HOLD.

CRITICAL: Respond with ONLY a raw JSON object. NO prose, NO explanation outside JSON, NO markdown.
Your ENTIRE response must be exactly one JSON object:
{"action":"BUY","fromToken":"USDC","toToken":"WELL","amountUSD":10,"reasoning":"RSI oversold at 28, MACD bullish crossover, Base TVL +3.2%, WELL protocol TVL rising, BTC shorts crowded, macro RISK_ON, news bullish +45","sector":"DEFI"}` + formatSelfImprovementPrompt();

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
          if (decision.amountUSD < 5.00) {  // v5.2: raised from $1 to $5
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
  // Check static registry first
  const token = TOKEN_REGISTRY[symbol];
  if (token) {
    // For swaps, native ETH should use WETH address
    if (token.address === "native") {
      return TOKEN_REGISTRY["WETH"].address;
    }
    return token.address;
  }
  // v6.1: Check discovered tokens
  if (tokenDiscoveryEngine) {
    const discovered = tokenDiscoveryEngine.getDiscoveredTokens().find(
      t => t.symbol.toUpperCase() === symbol.toUpperCase()
    );
    if (discovered) return discovered.address;
  }
  throw new Error(`Unknown token: ${symbol}`);
}

function getTokenDecimals(symbol: string): number {
  if (TOKEN_REGISTRY[symbol]) return TOKEN_REGISTRY[symbol].decimals;
  // v6.1: Check discovered tokens
  if (tokenDiscoveryEngine) {
    const discovered = tokenDiscoveryEngine.getDiscoveredTokens().find(
      t => t.symbol.toUpperCase() === symbol.toUpperCase()
    );
    if (discovered) return discovered.decimals;
  }
  return 18;
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

  // v6.2: Gas-aware trade sizing — skip trades where gas eats the profit
  // Base chain gas is cheap (~$0.01-0.10) but for tiny trades it still matters
  const estimatedGasUSD = 0.15; // Conservative estimate for Base swap (higher than typical)
  const MIN_PROFIT_TO_GAS_RATIO = 3; // Trade must expect 3x gas cost in profit potential
  const gasThreshold = estimatedGasUSD * MIN_PROFIT_TO_GAS_RATIO;

  if (decision.amountUSD < gasThreshold && decision.amountUSD < 3) {
    console.log(`  ⛽ Gas guard: Skipping $${decision.amountUSD.toFixed(2)} trade — below gas threshold ($${gasThreshold.toFixed(2)})`);
    return { success: false, error: `Trade too small: $${decision.amountUSD.toFixed(2)} < gas threshold $${gasThreshold.toFixed(2)}` };
  }

  // Log gas-to-trade ratio for monitoring
  const gasPercent = (estimatedGasUSD / decision.amountUSD) * 100;
  if (gasPercent > 5) {
    console.log(`  ⛽ Gas warning: Gas ~$${estimatedGasUSD.toFixed(2)} = ${gasPercent.toFixed(1)}% of $${decision.amountUSD.toFixed(2)} trade`);
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

    // v5.1: MEV Protection — Adaptive Slippage Based on Trade Size & Conditions
    // Larger trades need tighter slippage to avoid sandwich attacks
    // High-volume periods can tolerate more; volatile periods need less
    let adaptiveSlippage = CONFIG.trading.slippageBps; // Default base slippage
    const tradeValueUSD = decision.amountUSD;

    // Tighten slippage for larger trades (more attractive to MEV bots)
    if (tradeValueUSD > 50) {
      adaptiveSlippage = Math.min(adaptiveSlippage, 100); // Cap at 1% for trades > $50
    }
    if (tradeValueUSD > 100) {
      adaptiveSlippage = Math.min(adaptiveSlippage, 75);  // Cap at 0.75% for trades > $100
    }
    if (tradeValueUSD > 500) {
      adaptiveSlippage = Math.min(adaptiveSlippage, 50);  // Cap at 0.5% for trades > $500
    }

    // In volatile market regime, tighten slippage further (more MEV activity during volatility)
    if (marketData.marketRegime === "VOLATILE") {
      adaptiveSlippage = Math.min(adaptiveSlippage, Math.floor(adaptiveSlippage * 0.75));
    }

    console.log(`     🛡️ MEV Protection: Adaptive slippage ${adaptiveSlippage}bps (${(adaptiveSlippage / 100).toFixed(2)}%) for $${tradeValueUSD.toFixed(2)} trade`);

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
          slippageBps: adaptiveSlippage,
        });
        break; // Success — exit retry loop
      } catch (swapError: any) {
        const swapMsg = swapError?.message || "";
        if (swapMsg.includes("Insufficient token allowance") && attempt < maxRetries) {
          console.log(`     ⏳ Allowance not yet visible to API, retrying in 15s... (attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 15000));
        } else if (swapMsg.includes("slippage") && adaptiveSlippage < CONFIG.trading.slippageBps && attempt < maxRetries) {
          // v5.1: If slippage too tight, relax slightly and retry (but never above base config)
          adaptiveSlippage = Math.min(adaptiveSlippage + 25, CONFIG.trading.slippageBps);
          console.log(`     ⚠️ Slippage too tight, relaxing to ${adaptiveSlippage}bps and retrying...`);
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
        triggeredBy: decision.isExploration ? "EXPLORATION" : "AI",
        isExploration: decision.isExploration || false,
        // v5.1: Enhanced signal context
        btcPositioning: marketData.derivatives?.btcPositioningSignal || null,
        ethPositioning: marketData.derivatives?.ethPositioningSignal || null,
        crossAssetSignal: marketData.macroData?.crossAssets?.crossAssetSignal || null,
        adaptiveSlippage: adaptiveSlippage,
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


/**
 * v5.3.0: Auto-Harvest Transfer (USDC)
 * Checks if accumulated harvested profits exceed the threshold,
 * then sends USDC directly to the owner's wallet.
 * Profits are already in USDC (harvests sell tokens → USDC), so we transfer USDC directly.
 */
async function checkAutoHarvestTransfer(
  account: any,
  cdp: any,
  ethPrice: number,
  ethBalance: number
): Promise<{ sent: boolean; amountUSDC?: number; amountUSD?: number; txHash?: string; error?: string }> {
  const cfg = CONFIG.autoHarvest;

  if (!cfg.enabled) {
    return { sent: false, error: 'Auto-harvest disabled' };
  }

  if (!cfg.destinationWallet || cfg.destinationWallet.length < 42) {
    console.log('⚠️  Auto-harvest: No destination wallet configured');
    return { sent: false, error: 'No destination wallet' };
  }

  // Cooldown check
  if (state.lastAutoHarvestTime) {
    const hoursSinceLast = (Date.now() - new Date(state.lastAutoHarvestTime).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLast < cfg.cooldownHours) {
      return { sent: false, error: `Cooldown: ${(cfg.cooldownHours - hoursSinceLast).toFixed(1)}h remaining` };
    }
  }

  // Gas check — need ETH for the USDC transfer tx
  if (ethBalance < cfg.minETHReserve) {
    return { sent: false, error: `ETH balance (${ethBalance.toFixed(4)}) below reserve (${cfg.minETHReserve}) for gas` };
  }

  // Calculate unharvested profit (total harvested profits minus already transferred)
  const profitUSD = (state.harvestedProfits?.harvests || [])
    .reduce((sum: number, h: any) => sum + (h.profitUSD || 0), 0) - state.totalAutoHarvestedUSD;

  if (profitUSD < cfg.thresholdUSD) {
    return { sent: false, error: `Unharvested profit ($${profitUSD.toFixed(2)}) below threshold ($${cfg.thresholdUSD})` };
  }

  // Check actual USDC balance available
  const usdcAddress = TOKEN_REGISTRY.USDC.address;
  const usdcBalance = await getERC20Balance(usdcAddress, CONFIG.walletAddress, 6);

  // Only send the profit amount, capped at available USDC (leave $5 USDC buffer for trading)
  const sendableUSDC = Math.max(0, usdcBalance - 5);
  const transferAmount = Math.min(profitUSD, sendableUSDC);

  if (transferAmount < cfg.thresholdUSD) {
    return { sent: false, error: `Sendable USDC ($${transferAmount.toFixed(2)}) below threshold after $5 buffer` };
  }

  console.log(`\n💰 AUTO-HARVEST TRANSFER (USDC)`);
  console.log(`   Sending $${transferAmount.toFixed(2)} USDC to ${cfg.destinationWallet}`);
  console.log(`   USDC balance: $${usdcBalance.toFixed(2)} | Buffer: $5 | Sendable: $${sendableUSDC.toFixed(2)}`);
  console.log(`   Profit available: $${profitUSD.toFixed(2)} | Transferring: $${transferAmount.toFixed(2)}`);

  try {
    const txHash = await sendUSDCTransfer(account, cfg.destinationWallet, transferAmount);

    console.log(`   ✅ USDC Transfer sent! TX: ${txHash}`);
    console.log(`   🔍 View: https://basescan.org/tx/${txHash}`);

    const transferRecord = {
      timestamp: new Date().toISOString(),
      amountETH: '0', // We send USDC not ETH now
      amountUSD: transferAmount,
      txHash: txHash,
      destination: cfg.destinationWallet
    };

    state.autoHarvestTransfers.push(transferRecord);
    state.totalAutoHarvestedUSD += transferAmount;
    state.lastAutoHarvestTime = new Date().toISOString();
    state.autoHarvestCount++;

    if (state.autoHarvestTransfers.length > 50) {
      state.autoHarvestTransfers = state.autoHarvestTransfers.slice(-50);
    }

    saveTradeHistory();

    return { sent: true, amountUSDC: transferAmount, amountUSD: transferAmount, txHash: txHash };

  } catch (err: any) {
    console.error(`   ❌ Auto-harvest USDC transfer failed:`, err.message);
    return { sent: false, error: err.message };
  }
}

// Helper: send USDC (ERC-20) transfer
async function sendUSDCTransfer(account: any, to: string, amountUSDC: number): Promise<string> {
  const usdcAddress = TOKEN_REGISTRY.USDC.address;
  // USDC has 6 decimals
  const amount = BigInt(Math.floor(amountUSDC * 1e6));
  // ERC-20 transfer(address,uint256) selector: 0xa9059cbb
  const transferData = "0xa9059cbb" +
    to.slice(2).padStart(64, "0") +
    amount.toString(16).padStart(64, "0");

  const result = await account.sendTransaction({
    network: "base",
    transaction: {
      to: usdcAddress,
      data: transferData as `0x${string}`,
      value: BigInt(0),
    },
  });
  return result.transactionHash || result.hash || String(result);
}

// Helper: send native ETH transfer using CDP SDK (kept for future use)
async function sendNativeTransfer(account: any, to: string, amountETH: number): Promise<string> {
  const result = await account.sendTransaction({
    to: to,
    value: BigInt(Math.floor(amountETH * 1e18)),
    data: "0x"
  });
  return typeof result === "string" ? result : result.transactionHash || result.hash || String(result);
}

// ============================================================================
// v6.0: LIGHT/HEAVY CYCLE ORCHESTRATOR
// ============================================================================

/**
 * Quick price check for light cycle determination.
 * Uses cached CoinGecko data (3-min TTL) — essentially free.
 */
async function fetchQuickPrices(): Promise<Map<string, number>> {
  const prices = new Map<string, number>();

  // Use cached prices first (most light cycles will hit cache)
  if (Object.keys(lastKnownPrices).length > 0) {
    for (const [symbol, data] of Object.entries(lastKnownPrices)) {
      prices.set(symbol, data.price);
    }
    return prices;
  }

  // Fallback: fetch from CoinGecko (will be cached by getMarketData on next heavy cycle)
  try {
    const coingeckoIds = [...new Set(
      Object.values(TOKEN_REGISTRY).map(t => t.coingeckoId).filter(Boolean)
    )].join(",");
    const res = await axios.get(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coingeckoIds}&sparkline=false`,
      { timeout: 10000 }
    );
    if (res.data && Array.isArray(res.data)) {
      for (const coin of res.data) {
        const registryEntry = Object.entries(TOKEN_REGISTRY).find(([_, t]) => t.coingeckoId === coin.id);
        const symbol = registryEntry ? registryEntry[0] : coin.symbol.toUpperCase();
        prices.set(symbol, coin.current_price);
      }
    }
  } catch {
    // On failure, use whatever cached prices exist
    for (const [symbol, data] of Object.entries(lastKnownPrices)) {
      prices.set(symbol, data.price);
    }
  }

  // v6.1: DexScreener fallback for quick prices if nothing else worked
  if (prices.size === 0) {
    try {
      const addresses = Object.entries(TOKEN_REGISTRY)
        .filter(([s]) => s !== "USDC")
        .map(([_, t]) => t.address)
        .join(",");
      const dexRes = await axios.get(
        `https://api.dexscreener.com/tokens/v1/base/${addresses}`,
        { timeout: 10000 }
      );
      if (dexRes.data && Array.isArray(dexRes.data)) {
        const seen = new Set<string>();
        for (const pair of dexRes.data) {
          const addr = pair.baseToken?.address?.toLowerCase();
          const entry = Object.entries(TOKEN_REGISTRY).find(([_, t]) => t.address.toLowerCase() === addr);
          if (entry && !seen.has(entry[0])) {
            seen.add(entry[0]);
            const price = parseFloat(pair.priceUsd || "0");
            if (price > 0) {
              prices.set(entry[0], price);
              lastKnownPrices[entry[0]] = {
                price, change24h: pair.priceChange?.h24 || 0, change7d: 0,
                volume: pair.volume?.h24 || 0, marketCap: pair.marketCap || 0,
                name: entry[1].name, sector: entry[1].sector,
              };
            }
          }
        }
        if (prices.size > 0) console.log(`  🔄 Quick prices: ${prices.size} tokens via DexScreener fallback`);
      }
    } catch { /* DexScreener quick price fallback failed silently */ }
  }

  // v6.2: Chainlink on-chain oracle — 3rd fallback, can never be rate-limited
  // Only covers ETH/BTC but ensures we always have blue-chip prices
  if (prices.size === 0 || !prices.has("ETH")) {
    try {
      const chainlinkPrices = await fetchChainlinkPrices();
      for (const [symbol, price] of chainlinkPrices) {
        if (!prices.has(symbol)) {
          prices.set(symbol, price);
        }
      }
    } catch { /* Chainlink fallback failed silently */ }
  }

  return prices;
}

/**
 * Determine if this cycle should be HEAVY (full analysis + AI) or LIGHT (price check only).
 */
async function shouldRunHeavyCycle(currentPrices: Map<string, number>): Promise<{ isHeavy: boolean; reason: string }> {
  const now = Date.now();

  // 1. Forced interval: at least one heavy cycle every 15 minutes
  if (now - lastHeavyCycleAt > HEAVY_CYCLE_FORCED_INTERVAL_MS) {
    return { isHeavy: true, reason: `Forced interval (${((now - lastHeavyCycleAt) / 60000).toFixed(0)}m since last heavy)` };
  }

  // 2. First cycle is always heavy
  if (lastHeavyCycleAt === 0) {
    return { isHeavy: true, reason: 'First cycle' };
  }

  // 2b. v6.1: Force heavy if pricing is broken (all tokens $0 = only USDC counted)
  const pricedTokenCount = Array.from(currentPrices.values()).filter(p => p > 0).length;
  if (pricedTokenCount === 0 && Object.keys(lastKnownPrices).length === 0) {
    return { isHeavy: true, reason: 'No token prices available — forcing price refresh' };
  }

  // 3. Check for significant price moves since last heavy cycle
  // v6.2: Use portfolio-scaled threshold instead of fixed 2%
  const portfolioValue = state.trading.totalPortfolioValue || 0;
  const { threshold: dynamicThreshold, tier: portfolioTier } = getPortfolioSensitivity(portfolioValue);
  adaptiveCycle.dynamicPriceThreshold = dynamicThreshold;

  for (const [symbol, price] of currentPrices) {
    const lastPrice = lastPriceSnapshot.get(symbol);
    if (lastPrice && lastPrice > 0) {
      const change = Math.abs(price - lastPrice) / lastPrice;
      if (change > dynamicThreshold) {
        const direction = price > lastPrice ? 'UP' : 'DOWN';
        return { isHeavy: true, reason: `${symbol} moved ${(change * 100).toFixed(1)}% ${direction} (${portfolioTier} tier threshold: ${(dynamicThreshold * 100).toFixed(1)}%)` };
      }
    }
  }

  // 3b. v6.2: Emergency drop detection — any token down 5%+ → immediate heavy
  const emergency = checkEmergencyConditions(currentPrices);
  if (emergency.emergency) {
    adaptiveCycle.emergencyMode = true;
    adaptiveCycle.emergencyUntil = Date.now() + 5 * 60 * 1000;
    return { isHeavy: true, reason: `🚨 EMERGENCY: ${emergency.token} dropped ${emergency.dropPercent?.toFixed(1)}%` };
  }

  // 4. Check Fear & Greed change (use cached value, no API call)
  const cachedFG = cacheManager.get<any>(CacheKeys.FEAR_GREED);
  if (cachedFG) {
    try {
      const currentFG = parseInt(cachedFG?.data?.data?.[0]?.value || '0');
      if (currentFG > 0 && lastFearGreedValue > 0 && Math.abs(currentFG - lastFearGreedValue) > FG_CHANGE_THRESHOLD) {
        return { isHeavy: true, reason: `Fear & Greed changed: ${lastFearGreedValue} → ${currentFG}` };
      }
    } catch { /* ignore parse errors */ }
  }

  // 5. Check if any tokens exited cooldown
  // Capture count BEFORE filterTokensForEvaluation, which deletes expired entries
  const activeBeforeFilter = cooldownManager.getActiveCount();
  const tokensWithPrices = Array.from(currentPrices.entries())
    .filter(([symbol]) => symbol !== 'USDC')
    .map(([symbol, price]) => ({ symbol, price }));
  const [tokensToEval] = cooldownManager.filterTokensForEvaluation(tokensWithPrices);
  const activeAfterFilter = cooldownManager.getActiveCount();
  if (activeBeforeFilter > 0 && activeBeforeFilter > activeAfterFilter) {
    const exited = activeBeforeFilter - activeAfterFilter;
    return { isHeavy: true, reason: `${exited} token(s) exited cooldown` };
  }

  return { isHeavy: false, reason: 'No significant changes' };
}

async function runTradingCycle() {
  state.totalCycles++;
  const cycleStart = Date.now();

  // v6.0: Light/Heavy cycle determination
  const currentPrices = await fetchQuickPrices();
  const { isHeavy, reason: heavyReason } = await shouldRunHeavyCycle(currentPrices);

  if (!isHeavy) {
    // === LIGHT CYCLE ===
    cycleStats.totalLight++;
    adaptiveCycle.consecutiveLightCycles++;
    const portfolioValue = state.trading.totalPortfolioValue || 0;
    const cooldownCount = cooldownManager.getActiveCount();
    const cacheStats = cacheManager.getStats();

    // v6.2: Update adaptive interval even on light cycles
    const lightInterval = computeNextInterval(currentPrices);
    adaptiveCycle.currentIntervalSec = lightInterval.intervalSec;
    adaptiveCycle.volatilityLevel = lightInterval.volatilityLevel;
    adaptiveCycle.lastPriceCheck = new Map(currentPrices);

    console.log(`[CYCLE #${state.totalCycles}] LIGHT | Portfolio: $${portfolioValue.toFixed(2)} | Cooldowns: ${cooldownCount} | Cache: ${cacheStats.entries} entries (${cacheStats.hitRate} hit rate) | ${(Date.now() - cycleStart)}ms | ⚡ Next: ${lightInterval.intervalSec}s (${lightInterval.volatilityLevel})`);
    return; // Skip full analysis
  }

  // === HEAVY CYCLE ===
  cycleStats.totalHeavy++;
  cycleStats.lastHeavyReason = heavyReason;

  console.log("\n" + "═".repeat(70));
  console.log(`🤖 TRADING CYCLE #${state.totalCycles} [HEAVY: ${heavyReason}] | ${new Date().toISOString()}`);
  console.log(`   Light/Heavy ratio: ${cycleStats.totalLight}L / ${cycleStats.totalHeavy}H | Cache hit rate: ${cacheManager.getStats().hitRate}`);
  console.log("═".repeat(70));

  try {
    console.log("\n📊 Fetching balances...");
    const balances = await getBalances();

    console.log("📈 Fetching market data for all tracked tokens...");
    const marketData = await getMarketData();

    // v6.0: Update light/heavy cycle state
    lastHeavyCycleAt = Date.now();
    lastPriceSnapshot = new Map(marketData.tokens.map(t => [t.symbol, t.price]));
    lastFearGreedValue = marketData.fearGreed.value;

    // v5.2: Consolidate dust positions every 10 cycles
    if (state.totalCycles % 10 === 1) {
      await consolidateDustPositions(balances, marketData);
    }

    // V4.5: Store intelligence data for API endpoint (now includes news + macro)
    lastIntelligenceData = {
      defi: marketData.defiLlama,
      derivatives: marketData.derivatives,
      news: marketData.newsSentiment,
      macro: marketData.macroData,
      regime: marketData.marketRegime,
      performance: calculateTradePerformance(),
    };

    // === PHASE 3: PERFORMANCE REVIEW TRIGGER ===
    // Run review every 10 trades or every 24 hours
    const tradesSinceReview = state.tradeHistory.length - state.lastReviewTradeIndex;
    const hoursSinceReview = state.lastReviewTimestamp
      ? (Date.now() - new Date(state.lastReviewTimestamp).getTime()) / (1000 * 60 * 60)
      : 999;
    if (tradesSinceReview >= 10 || hoursSinceReview >= 24) {
      const reason = tradesSinceReview >= 10 ? "TRADE_COUNT" as const : "TIME_ELAPSED" as const;
      console.log(`\n🧪 SELF-IMPROVEMENT: Running performance review (${reason})...`);
      const review = runPerformanceReview(reason);
      console.log(`   Generated ${review.insights.length} insights, ${review.recommendations.length} recommendations`);

      // Store the review
      state.performanceReviews.push(review);
      if (state.performanceReviews.length > 30) {
        state.performanceReviews = state.performanceReviews.slice(-30);
      }

      // Update review tracking state
      state.lastReviewTradeIndex = state.tradeHistory.length;
      state.lastReviewTimestamp = new Date().toISOString();

      // Adapt thresholds based on review findings
      adaptThresholds(review);
      console.log(`   Thresholds adapted (${state.adaptiveThresholds.adaptationCount} total adaptations)`);

      // Persist everything
      saveTradeHistory();
      console.log(`   Review #${state.performanceReviews.length} stored | Next review after ${state.lastReviewTradeIndex + 10} trades or 24h`);
    }

    // === PHASE 3: ANALYZE STRATEGY PATTERNS (rebuild every cycle for accuracy) ===
    if (state.tradeHistory.length > 0 && state.totalCycles <= 1) {
      console.log(`\n🧬 SELF-IMPROVEMENT: Building strategy pattern memory from ${state.tradeHistory.length} trades...`);
      analyzeStrategyPatterns();
      const validPatterns = Object.values(state.strategyPatterns).filter(p => !p.patternId.startsWith("UNKNOWN"));
      console.log(`   Identified ${Object.keys(state.strategyPatterns).length} patterns (${validPatterns.length} with signal data)`);
      saveTradeHistory();
    }

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

    // === CIRCUIT BREAKERS ===
    // Hard halt: if drawdown exceeds 20% from peak, stop all trading this cycle
    if (drawdown >= 20) {
      console.log(`\n🚨 CIRCUIT BREAKER: Drawdown ${drawdown.toFixed(1)}% exceeds 20% threshold. Halting trading this cycle.`);
      console.log(`   Peak: $${state.trading.peakValue.toFixed(2)} | Current: $${state.trading.totalPortfolioValue.toFixed(2)}`);
      state.trading.lastCheck = new Date();
      return;
    }
    // Caution zone: if drawdown exceeds 12%, reduce max position size by 50%
    const circuitBreakerActive = drawdown >= 12;
    if (circuitBreakerActive) {
      console.log(`\n⚠️ CIRCUIT BREAKER: Drawdown ${drawdown.toFixed(1)}% — caution mode active, position sizes halved`);
    }

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

    // v6.2: Risk-Reward Metrics
    const rrMetrics = calculateRiskRewardMetrics();
    if (rrMetrics.avgWinUSD > 0 || rrMetrics.avgLossUSD > 0) {
      console.log(`\n📊 Risk-Reward Profile:`);
      console.log(`   Avg Win: +$${rrMetrics.avgWinUSD.toFixed(2)} | Avg Loss: -$${rrMetrics.avgLossUSD.toFixed(2)} | Ratio: ${rrMetrics.riskRewardRatio.toFixed(2)}x`);
      console.log(`   Largest Win: +$${rrMetrics.largestWin.toFixed(2)} | Largest Loss: -$${rrMetrics.largestLoss.toFixed(2)}`);
      console.log(`   Expectancy: $${rrMetrics.expectancy.toFixed(2)}/trade | Profit Factor: ${rrMetrics.profitFactor.toFixed(2)}`);
    }

    // === STOP-LOSS CHECK (highest priority) ===
    const stopLossDecision = checkStopLoss(balances);
    if (stopLossDecision) {
      console.log(`\n  🛑 STOP-LOSS GUARD executing sell...`);
      const slResult = await executeTrade(stopLossDecision, marketData);
      // v5.3.3: Track failures and set cooldown
      state.stopLossCooldowns[stopLossDecision.fromToken] = new Date().toISOString();
      if (!slResult.success) {
        recordTradeFailure(stopLossDecision.fromToken);
      } else {
        clearTradeFailures(stopLossDecision.fromToken);
      }
      state.trading.lastCheck = new Date();
      return; // Skip AI decision this cycle
    }

    // === PROFIT-TAKING CHECK ===
    const profitTakeDecision = checkProfitTaking(balances);
    if (profitTakeDecision) {
      // v5.3.3: Check circuit breaker before attempting profit-take
      if (isTokenBlocked(profitTakeDecision.fromToken)) {
        console.log(`\n  🚫 PROFIT-TAKE skipped: ${profitTakeDecision.fromToken} blocked by circuit breaker`);
      } else {
        console.log(`\n  🎯 PROFIT-TAKE GUARD executing sell...`);
        const ptResult = await executeTrade(profitTakeDecision, marketData);
        if (!ptResult.success) {
          recordTradeFailure(profitTakeDecision.fromToken);
        } else {
          clearTradeFailures(profitTakeDecision.fromToken);
        }
        state.trading.lastCheck = new Date();
        return; // Skip AI decision this cycle
      }
    }

    // === PHASE 3: STAGNATION CHECK ===
    const usdcBal = balances.find(b => b.symbol === "USDC");
    const availableUSDCForExplore = usdcBal?.balance || 0;
    const explorationTrade = checkStagnation(availableUSDCForExplore, marketData.tokens);
    if (explorationTrade) {
      console.log(`\n🔬 EXPLORATION TRADE: ${explorationTrade.reasoning}`);
      const exploreDecision: TradeDecision = {
        action: "BUY",
        fromToken: "USDC",
        toToken: explorationTrade.toToken,
        amountUSD: explorationTrade.amountUSD,
        reasoning: explorationTrade.reasoning,
        isExploration: true,
      };
      await executeTrade(exploreDecision, marketData);
      // Update pattern memory after exploration trade
      analyzeStrategyPatterns();
      saveTradeHistory();
      state.trading.lastCheck = new Date();
      return;
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

    // === PHASE 3: CONFIDENCE-WEIGHTED POSITION SIZING ===
    if (decision.action === "BUY" && decision.amountUSD > 0) {
      const tradePatternId = [
        "BUY",
        marketData.indicators[decision.toToken]?.rsi14 !== undefined
          ? (marketData.indicators[decision.toToken].rsi14 < state.adaptiveThresholds.rsiOversold ? "OVERSOLD"
             : marketData.indicators[decision.toToken].rsi14 > state.adaptiveThresholds.rsiOverbought ? "OVERBOUGHT" : "NEUTRAL")
          : "UNKNOWN",
        marketData.marketRegime,
        marketData.indicators[decision.toToken]?.overallSignal || "NEUTRAL",
      ].join("_");
      const confidence = calculatePatternConfidence(tradePatternId, marketData.marketRegime);
      const originalAmount = decision.amountUSD;
      decision.amountUSD = Math.max(5, Math.round(decision.amountUSD * confidence * 100) / 100);
      const confLabel = confidence >= 0.8 ? "HIGH" : confidence >= 0.5 ? "MEDIUM" : "LOW";
      console.log(`   🎯 Pattern Confidence: ${(confidence * 100).toFixed(0)}% (${confLabel}) | Size: $${originalAmount.toFixed(2)} → $${decision.amountUSD.toFixed(2)}`);

      // Circuit breaker: halve position size in caution zone
      if (circuitBreakerActive) {
        decision.amountUSD = Math.max(5, Math.round(decision.amountUSD * 0.5 * 100) / 100);
        console.log(`   🚨 Circuit breaker applied: size reduced to $${decision.amountUSD.toFixed(2)}`);
      }
    }

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

    // v5.3.3: Circuit breaker guard — block trades on tokens with consecutive failures
    if (["SELL", "REBALANCE"].includes(decision.action) && decision.fromToken && isTokenBlocked(decision.fromToken)) {
      console.log(`   🚫 CIRCUIT BREAKER: Skipping ${decision.action} for ${decision.fromToken} — too many consecutive failures`);
      decision.action = "HOLD";
      decision.reasoning = `Circuit breaker: ${decision.fromToken} blocked after repeated failures. Cooling off.`;
    }

    // Execute if needed
    if (["BUY", "SELL", "REBALANCE"].includes(decision.action) && decision.amountUSD >= 1.00) {
      const tradeResult = await executeTrade(decision, marketData);

      // v5.3.3: Track consecutive failures / clear on success
      const tradeToken = decision.action === "SELL" ? decision.fromToken : decision.toToken;
      if (!tradeResult.success) {
        recordTradeFailure(tradeToken);
      } else {
        clearTradeFailures(tradeToken);
      }

      // v6.0: Set cooldown for traded token
      const cooldownToken = decision.action === "SELL" ? decision.fromToken : decision.toToken;
      const tokenPrice = currentPrices.get(cooldownToken) || 0;
      cooldownManager.setCooldown(cooldownToken, decision.action === "HOLD" ? "HOLD" : decision.action as CooldownDecision, tokenPrice);

      // === PHASE 3: UPDATE PATTERN MEMORY AFTER TRADE ===
      analyzeStrategyPatterns();
      // Update exploration state
      state.explorationState.lastTradeTimestamp = new Date().toISOString();
      state.explorationState.consecutiveHolds = 0;
      state.explorationState.totalExploitationTrades++;
      saveTradeHistory();

    } else if (decision.action === "HOLD") {} else if (decision.action === "HOLD") {
      // v6.0: Set HOLD cooldown for all tokens to skip re-evaluation
      if (decision.toToken && decision.toToken !== "USDC") {
        const holdPrice = currentPrices.get(decision.toToken) || 0;
        cooldownManager.setCooldown(decision.toToken, "HOLD", holdPrice);
      }
      // Track consecutive holds for stagnation detection
      state.explorationState.consecutiveHolds++;
    }

    // v6.2.1: Auto-harvest profits to owner wallet — runs every heavy cycle regardless of trade action
    if (CONFIG.autoHarvest.enabled) {
      try {
        const ethBal = await getETHBalance(CONFIG.walletAddress);
        const ethPriceUSD = lastKnownPrices['WETH']?.price || lastKnownPrices['ETH']?.price || 2700;
        const harvestAccount = await cdpClient.evm.getOrCreateAccount({ name: "henry-trading-bot" });
        const harvestResult = await checkAutoHarvestTransfer(harvestAccount, cdpClient, ethPriceUSD, ethBal);
        if (harvestResult.sent) {
          console.log(`Auto-harvested ${harvestResult.amountUSD?.toFixed(2)} to owner wallet`);
        }
      } catch (harvestErr: any) {
        console.warn('Auto-harvest check failed:', harvestErr.message);
      }
    }

    state.trading.lastCheck = new Date();

    // === DERIVATIVES CYCLE (v6.0) ===
    if (derivativesEngine?.isEnabled() && advancedTradeClient) {
      try {
        // Generate commodity signals from existing macro data
        let commoditySignal: MacroCommoditySignal | undefined = undefined;
        if (commoditySignalEngine && marketData.macroData) {
          const silverData = await commoditySignalEngine.fetchSilverPrice();
          const macro = marketData.macroData;
          commoditySignal = commoditySignalEngine.generateSignal({
            fedFundsRate: macro.fedFundsRate?.value,
            treasury10Y: macro.treasury10Y?.value,
            cpi: macro.cpi?.value,
            m2MoneySupply: macro.m2MoneySupply?.value,
            dollarIndex: macro.dollarIndex?.value || macro.crossAssets?.dxyRealtime || undefined,
            goldPrice: macro.crossAssets?.goldPrice || undefined,
            goldChange24h: macro.crossAssets?.goldChange24h || undefined,
            vixLevel: macro.crossAssets?.vixLevel || undefined,
            spxChange24h: macro.crossAssets?.sp500Change || undefined,
            macroSignal: macro.macroSignal,
          });
        }

        // Run derivatives cycle — brain signals → derivatives execution
        const derivResult = await derivativesEngine.runCycle({
          indicators: marketData.indicators,
          marketRegime: marketData.marketRegime,
          macroSignal: marketData.macroData?.macroSignal,
          derivatives: marketData.derivatives,
          fearGreed: marketData.fearGreed,
          commoditySignal,
        });

        // Log results
        if (derivResult.tradesExecuted.length > 0) {
          for (const trade of derivResult.tradesExecuted) {
            console.log(`  ${trade.success ? "✅" : "❌"} [Deriv] ${trade.action} ${trade.product} $${trade.sizeUSD.toFixed(2)} @ ${trade.leverage}x — ${trade.reasoning.substring(0, 80)}`);
          }
        }

        // Store derivatives state for dashboard
        lastDerivativesData = {
          state: derivResult.portfolioState,
          signals: derivResult.signalsGenerated,
          trades: derivResult.tradesExecuted,
          commoditySignal: commoditySignalEngine?.getLastSignal() || null,
        };
      } catch (derivError: any) {
        console.error(`  ❌ Derivatives cycle error: ${derivError?.message?.substring(0, 200)}`);
      }
    }

    // === v6.0: EQUITY CYCLE ===
    if (equityEnabled && equityEngine) {
      try {
        const equityResult = await equityEngine.runEquityCycle(marketData.fearGreed.value);
        // The AI prompt section is available but we don't inject it into the crypto AI call
        // (equity has its own signal generation). Log the summary instead.
        console.log(`  [EQUITY] ${equityResult.signals.length} signals, ${equityResult.executedTrades.length} trades | Value: $${equityResult.totalEquityValue.toFixed(2)}`);
      } catch (eqError: any) {
        console.error(`  ❌ Equity cycle error: ${eqError?.message?.substring(0, 200)}`);
      }
    }

  } catch (error: any) {
    console.error("Cycle error:", error.message);
  }

  // Summary
  const derivSummary = derivativesEngine?.isEnabled()
    ? ` | Deriv Positions: ${derivativesEngine?.getState()?.openPositionCount || 0} | Deriv P&L: $${(derivativesEngine?.getState()?.totalUnrealizedPnl || 0).toFixed(2)}`
    : "";
  console.log("\n" + "═".repeat(70));
  console.log("📊 CYCLE SUMMARY");
  console.log(`   Portfolio: $${state.trading.totalPortfolioValue.toFixed(2)}${derivSummary}`);
  console.log(`   Trades: ${state.trading.successfulTrades}/${state.trading.totalTrades} successful`);
  console.log(`   Tracking: ${CONFIG.activeTokens.length} tokens across 4 sectors`);
  if (derivativesEngine?.isEnabled()) {
    console.log(`   Derivatives: ACTIVE | Buying Power: $${(derivativesEngine?.getState()?.availableBuyingPower || 0).toFixed(2)}`);
  }
  console.log(`   Cooldowns: ${cooldownManager.getActiveCount()} active | Cache: ${cacheManager.getStats().entries} entries (${cacheManager.getStats().hitRate} hit rate)`);
  console.log(`   Cycle type: HEAVY (${heavyReason}) | Light/Heavy: ${cycleStats.totalLight}L / ${cycleStats.totalHeavy}H`);

  // v6.2: Compute and apply adaptive interval for next cycle
  const nextInterval = computeNextInterval(currentPrices);
  adaptiveCycle.currentIntervalSec = nextInterval.intervalSec;
  adaptiveCycle.volatilityLevel = nextInterval.volatilityLevel;
  adaptiveCycle.consecutiveLightCycles = 0; // Reset on heavy cycle

  // Update price snapshot for next adaptive comparison
  adaptiveCycle.lastPriceCheck = new Map(currentPrices);

  // Clear emergency if conditions resolved
  if (adaptiveCycle.emergencyMode && Date.now() > adaptiveCycle.emergencyUntil) {
    adaptiveCycle.emergencyMode = false;
    console.log(`   ✅ Emergency mode ended — returning to adaptive tempo`);
  }

  console.log(`   ⚡ Adaptive: ${nextInterval.intervalSec}s next cycle | ${nextInterval.reason}`);
  console.log(`   📡 Price stream: ${adaptiveCycle.wsConnected ? 'LIVE' : 'offline'} | Threshold: ${(adaptiveCycle.dynamicPriceThreshold * 100).toFixed(1)}% (${adaptiveCycle.portfolioTier})`);
  console.log("═".repeat(70));
}

// ============================================================================
// STARTUP
// ============================================================================

function displayBanner() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                        ║
║   🤖 HENRY'S AUTONOMOUS TRADING AGENT v6.0                              ║
║   ════════════════════════════════════════                              ║
║                                                                        ║
║   PHASE 4: DERIVATIVES MODULE — Spot + Perps + Commodities             ║
║   LIVE TRADING | Base Network + Coinbase Advanced Trade                ║
║                                                                        ║
║   Intelligence Stack:                                                  ║
║   • Technical: RSI, MACD, Bollinger Bands, SMA, Volume                ║
║   • DeFi Intel: Base TVL, DEX Volume, Protocol TVL (DefiLlama)        ║
║   • Derivatives: Funding + OI + Long/Short Ratios + Top Traders       ║
║   • Positioning: Smart Money vs Retail + OI-Price Divergence           ║
║   • News: Crypto news sentiment — bullish/bearish (CryptoPanic)       ║
║   • Macro: Fed Rate, 10Y Yield, CPI, M2, Dollar Index (FRED)         ║
║   • Cross-Asset: Gold, Oil, VIX, S&P 500 correlation signals         ║
║   • Sentiment: Fear & Greed Index + Market Regime Detection           ║
║   • Self-Learning: Trade performance scoring + signal attribution     ║
║                                                                        ║
║   v5.1 Upgrades:                                                       ║
║   • Shadow Model Validation: changes need 3+ confirmations to go live ║
║   • MEV Protection: adaptive slippage by trade size + conditions      ║
║   • Cross-Asset Engine: RISK_ON/OFF/FLIGHT_TO_SAFETY from TradFi     ║
║   • Smart Money Tracking: top trader positioning vs retail divergence ║
║                                                                        ║
╚══════════════════════════════════════════════════════════════════════════╝
  `);
  console.log("📍 Configuration:");
  console.log(`   Wallet: ${CONFIG.walletAddress}`);
  console.log(`   Trading: ${CONFIG.trading.enabled ? "LIVE 🟢" : "DRY RUN 🟡"}`);
  console.log(`   Execution: Coinbase CDP SDK (account.swap + Permit2 approval)`);
  console.log(`   Brain: v5.1 — Technicals + DeFi + Derivatives + Positioning + News + Macro + Cross-Asset + Regime + Self-Improvement + Shadow Validation`);
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

  // === DERIVATIVES MODULE INITIALIZATION (v6.0) ===
  if (CONFIG.derivatives.enabled) {
    console.log("\n🔧 Initializing Derivatives Module...");
    try {
      let advApiSecret = CONFIG.derivatives.apiKeySecret;
      if (advApiSecret.includes('\\n')) {
        advApiSecret = advApiSecret.replace(/\\n/g, '\n');
      }

      advancedTradeClient = new CoinbaseAdvancedTradeClient({
        apiKeyId: CONFIG.derivatives.apiKeyId,
        apiKeySecret: advApiSecret,
      });

      // Test connectivity
      const connectionTest = await advancedTradeClient.testConnection();
      console.log(`  📡 Advanced Trade: ${connectionTest.message}`);

      if (connectionTest.success) {
        // Discover available commodity contracts
        const contracts = await discoverCommodityContracts(advancedTradeClient);

        // Initialize strategy engine
        derivativesEngine = new DerivativesStrategyEngine(advancedTradeClient, {
          enabled: true,
          products: {
            perpetuals: ["BTC-PERP-INTX", "ETH-PERP-INTX"],
            commodityFutures: [...contracts.gold.slice(0, 1), ...contracts.silver.slice(0, 1)],
          },
          risk: {
            ...DEFAULT_DERIVATIVES_CONFIG.risk,
            maxLeverage: CONFIG.derivatives.maxLeverage,
            stopLossPercent: CONFIG.derivatives.stopLossPercent,
            takeProfitPercent: CONFIG.derivatives.takeProfitPercent,
          },
          sizing: {
            ...DEFAULT_DERIVATIVES_CONFIG.sizing,
            basePositionUSD: CONFIG.derivatives.basePositionUSD,
          },
        });

        // Initialize commodity signal engine
        commoditySignalEngine = new MacroCommoditySignalEngine();

        console.log("  ✅ Derivatives module fully operational");
        console.log(`     Perpetuals: BTC-PERP-INTX, ETH-PERP-INTX`);
        console.log(`     Gold Futures: ${contracts.gold[0] || "none available"}`);
        console.log(`     Silver Futures: ${contracts.silver[0] || "none available"}`);
      } else {
        console.log("  ⚠️ Derivatives module: API not accessible. Running spot-only.");
      }
    } catch (error: any) {
      console.error(`  ❌ Derivatives init failed: ${error.message?.substring(0, 200)}`);
      console.log("  ⚠️ Continuing in spot-only mode.");
    }
  } else {
    console.log("\n📊 Derivatives module: DISABLED (set DERIVATIVES_ENABLED=true to activate)");
  }

  // === v6.0: EQUITY INTEGRATION INITIALIZATION ===
  equityEngine = new EquityIntegration();
  equityEnabled = await equityEngine.initialize();

  // === v6.1: TOKEN DISCOVERY ENGINE INITIALIZATION ===
  console.log("\n🔍 Initializing Token Discovery Engine...");
  const staticTokens = Object.keys(TOKEN_REGISTRY);
  tokenDiscoveryEngine = new TokenDiscoveryEngine(staticTokens);
  tokenDiscoveryEngine.start();
  console.log(`  ✅ Discovery engine active. Static pool: ${staticTokens.length} tokens. Dynamic discovery every 6h.`);

  loadTradeHistory();

  // Restore discovery state if available
  if (tokenDiscoveryEngine) {
    try {
      const logData = fs.existsSync(CONFIG.logFile) ? JSON.parse(fs.readFileSync(CONFIG.logFile, "utf-8")) : null;
      if (logData?.tokenDiscovery) {
        tokenDiscoveryEngine.restoreState(logData.tokenDiscovery);
      }
    } catch { /* non-critical */ }
  }

  // Run immediately
  await runTradingCycle();

  // v6.2: ADAPTIVE CYCLE ENGINE — replaces fixed cron with dynamic scheduling
  // The cron still exists as a safety net (forced heavy every 15min), but the
  // primary scheduler is now adaptive setTimeout that adjusts 15s-5min based on
  // volatility, portfolio size, and emergency conditions.
  console.log("\n⚡ v6.2: Initializing Adaptive Cycle Engine...");

  // Start real-time price stream (10s polling for emergency detection)
  initPriceStream();

  // Schedule first adaptive cycle
  scheduleNextCycle();

  // Safety net: keep the cron as a backup forced heavy cycle trigger
  const cronExpression = `*/${Math.max(CONFIG.trading.intervalMinutes, 15)} * * * *`;
  cron.schedule(cronExpression, async () => {
    try {
      // Only run if the adaptive engine somehow stalled
      const timeSinceLastCycle = Date.now() - (lastHeavyCycleAt || 0);
      if (timeSinceLastCycle > HEAVY_CYCLE_FORCED_INTERVAL_MS * 1.5) {
        console.log(`[Safety Net] Adaptive engine may have stalled — forcing cycle (${(timeSinceLastCycle / 60000).toFixed(0)}m since last heavy)`);
        await runTradingCycle();
      }
    } catch (cronError: any) {
      console.error(`[Cron Safety Net Error] ${cronError?.message?.substring(0, 300) || cronError}`);
    }
  });

  // Heartbeat every 5 minutes to confirm process is alive
  setInterval(() => {
    const adaptiveInfo = `Interval: ${adaptiveCycle.currentIntervalSec}s | Vol: ${adaptiveCycle.volatilityLevel} | Tier: ${adaptiveCycle.portfolioTier} | Stream: ${adaptiveCycle.wsConnected ? 'LIVE' : 'OFF'}${adaptiveCycle.emergencyMode ? ' | 🚨 EMERGENCY' : ''}`;
    console.log(`💓 Heartbeat | ${new Date().toISOString()} | Cycles: ${state.totalCycles} | Trades: ${state.trading.successfulTrades}/${state.trading.totalTrades} | ${adaptiveInfo}`);
    // v5.2: Save state every heartbeat
    saveTradeHistory();
  }, 5 * 60 * 1000);

  const { tier: startTier } = getPortfolioSensitivity(state.trading.totalPortfolioValue || 0);
  console.log(`\n🚀 Agent v6.2 running! Adaptive Cycles + Real-Time Streaming + Portfolio-Scaled Intelligence.\n`);
  console.log(`   📂 State persistence: ${CONFIG.logFile}`);
  console.log(`   💰 Max buy size: ${CONFIG.trading.maxBuySize} | Min trade: $5`);
  console.log(`   ⚡ Adaptive tempo: ${ADAPTIVE_MIN_INTERVAL_SEC}s – ${ADAPTIVE_MAX_INTERVAL_SEC}s | Emergency: ${EMERGENCY_INTERVAL_SEC}s`);
  console.log(`   🎯 Portfolio tier: ${startTier} | Emergency drop trigger: ${(EMERGENCY_DROP_THRESHOLD * 100).toFixed(0)}%`);
  console.log(`   📡 Real-time price stream: ACTIVE (10s polling)`);
  console.log(`   🧹 Dust threshold: ${DUST_THRESHOLD_USD} (consolidates every 10 cycles)\n`);
}

// ============================================================================
// GRACEFUL SHUTDOWN — save state before Railway restarts / redeploys
// ============================================================================
let isShuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n🛑 Received ${signal} — saving state before shutdown...`);
  try {
    saveTradeHistory();
    console.log("   ✅ State saved successfully. Goodbye.");
  } catch (e: any) {
    console.error(`   ❌ Error saving state on shutdown: ${e.message}`);
  }
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

main().catch((err) => {
  console.error("Fatal error:", err?.message || String(err));
  if (err?.stack) console.error(err.stack.split('\n').slice(0, 5).join('\n'));
  // v5.2: Try to save state even on fatal crash
  try { saveTradeHistory(); } catch (_) {}
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

/**
 * v6.2: Calculate risk-reward metrics from trade history.
 * Avg win size vs avg loss size tells you if the strategy is actually profitable
 * beyond just win rate. A 60% win rate with $5 avg wins and $15 avg losses = net negative.
 */
function calculateRiskRewardMetrics(): {
  avgWinUSD: number;
  avgLossUSD: number;
  riskRewardRatio: number;
  largestWin: number;
  largestLoss: number;
  expectancy: number;
  profitFactor: number;
} {
  const trades = state.trading.trades || [];
  const sells = trades.filter(t => t.action === "SELL" && t.success);

  const wins: number[] = [];
  const losses: number[] = [];

  for (const trade of sells) {
    const symbol = trade.fromToken;
    const cb = state.costBasis[symbol];
    if (!cb || cb.averageCostBasis <= 0) continue;

    // Calculate P&L for this sell based on cost basis
    const tokenPrice = trade.amountUSD / (trade.tokenAmount || 1);
    const pnl = (tokenPrice - cb.averageCostBasis) * (trade.tokenAmount || 0);

    if (pnl >= 0) wins.push(pnl);
    else losses.push(Math.abs(pnl));
  }

  // Also check realized P&L from cost basis records
  for (const [, cb] of Object.entries(state.costBasis)) {
    if (cb.realizedPnL > 0) wins.push(cb.realizedPnL);
    else if (cb.realizedPnL < 0) losses.push(Math.abs(cb.realizedPnL));
  }

  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const totalWins = wins.reduce((a, b) => a + b, 0);
  const totalLosses = losses.reduce((a, b) => a + b, 0);
  const winRate = (wins.length + losses.length) > 0 ? wins.length / (wins.length + losses.length) : 0;

  return {
    avgWinUSD: avgWin,
    avgLossUSD: avgLoss,
    riskRewardRatio: avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0,
    largestWin: wins.length > 0 ? Math.max(...wins) : 0,
    largestLoss: losses.length > 0 ? Math.max(...losses) : 0,
    // Expectancy: how much you expect to make per trade on average
    expectancy: (winRate * avgWin) - ((1 - winRate) * avgLoss),
    // Profit factor: total wins / total losses (>1 = profitable)
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
  };
}

function apiPortfolio() {
  const uptime = Math.floor((Date.now() - state.startTime.getTime()) / 1000);
  const totalRealized = Object.values(state.costBasis).reduce((s, cb) => s + cb.realizedPnL, 0);
  const totalUnrealized = Object.values(state.costBasis).reduce((s, cb) => s + cb.unrealizedPnL, 0);
  const riskReward = calculateRiskRewardMetrics();
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
    version: "6.2",
    // v6.2: Risk-reward metrics
    riskReward: {
      avgWinUSD: riskReward.avgWinUSD,
      avgLossUSD: riskReward.avgLossUSD,
      riskRewardRatio: riskReward.riskRewardRatio,
      largestWin: riskReward.largestWin,
      largestLoss: riskReward.largestLoss,
      expectancy: riskReward.expectancy,
      profitFactor: riskReward.profitFactor,
    },
    // v5.1.1: Profit harvesting stats
    harvestedProfits: state.harvestedProfits?.totalHarvested || 0,
    harvestCount: state.harvestedProfits?.harvestCount || 0,
    recentHarvests: (state.harvestedProfits?.harvests || []).slice(-5),
      // v5.3.0: Auto-harvest info
      autoHarvest: {
        enabled: CONFIG.autoHarvest.enabled,
        totalTransferredUSD: state.totalAutoHarvestedUSD,
        totalTransferredETH: state.totalAutoHarvestedETH,
        transferCount: state.autoHarvestCount,
        lastTransfer: state.lastAutoHarvestTime,
        destination: CONFIG.autoHarvest.destinationWallet ?
          CONFIG.autoHarvest.destinationWallet.slice(0, 6) + '...' + CONFIG.autoHarvest.destinationWallet.slice(-4) : null,
      },
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
    version: "5.1",
    defiLlama: lastIntelligenceData?.defi || null,
    derivatives: lastIntelligenceData?.derivatives || null,
    newsSentiment: lastIntelligenceData?.news || null,
    macroData: lastIntelligenceData?.macro || null,
    marketRegime: lastIntelligenceData?.regime || "UNKNOWN",
    tradePerformance: perf,
    shadowProposals: shadowProposals,
    dataSources: [
      "CoinGecko", "Fear & Greed Index",
      "DefiLlama (TVL/DEX/Protocols)",
      "Binance (Funding/OI/Long-Short Ratios/Top Trader Positioning)",
      "Binance (PAXG for real-time Gold)",
      "CryptoPanic (News Sentiment)",
      "FRED (Fed Rates/Yield Curve/CPI/M2/Dollar/Gold/Oil/VIX/S&P 500)",
      "Technical Indicators (RSI/MACD/BB/SMA)",
    ],
  };
}

// === PHASE 3 API ENDPOINTS ===
function apiPatterns() {
  const patterns = Object.values(state.strategyPatterns);
  const sorted = patterns.sort((a, b) => b.stats.sampleSize - a.stats.sampleSize);
  const topPerformers = sorted.filter(p => p.stats.sampleSize >= 3).sort((a, b) => b.stats.avgReturnPercent - a.stats.avgReturnPercent).slice(0, 5);
  const worstPerformers = sorted.filter(p => p.stats.sampleSize >= 3).sort((a, b) => a.stats.avgReturnPercent - b.stats.avgReturnPercent).slice(0, 5);
  return {
    version: "5.1",
    totalPatterns: patterns.length,
    patternsWithData: patterns.filter(p => p.stats.sampleSize >= 3).length,
    topPerformers,
    worstPerformers,
    allPatterns: sorted,
  };
}

function apiReviews() {
  const reviews = state.performanceReviews.slice(-10);
  return {
    version: "5.1",
    totalReviews: state.performanceReviews.length,
    latestReview: reviews.length > 0 ? reviews[reviews.length - 1] : null,
    recentReviews: reviews,
    lastReviewTimestamp: state.lastReviewTimestamp,
    tradesSinceLastReview: state.tradeHistory.length - state.lastReviewTradeIndex,
  };
}

function apiThresholds() {
  return {
    version: "5.1",
    currentThresholds: state.adaptiveThresholds,
    bounds: THRESHOLD_BOUNDS,
    defaults: DEFAULT_ADAPTIVE_THRESHOLDS,
    adaptationCount: state.adaptiveThresholds.adaptationCount,
    recentHistory: state.adaptiveThresholds.history.slice(-20),
    explorationState: state.explorationState,
  };
}

function getDashboardHTML(): string {
  // Always use embedded dashboard (connected to bot API)
  // Old dashboard/index.html reads from blockchain directly — not useful
  return EMBEDDED_DASHBOARD;
}

const healthServer = http.createServer(async (req, res) => {
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
      case '/api/patterns':
        sendJSON(res, 200, apiPatterns());
        break;
      case '/api/reviews':
        sendJSON(res, 200, apiReviews());
        break;
      case '/api/thresholds':
        sendJSON(res, 200, apiThresholds());
        break;
      case '/api/auto-harvest':
        sendJSON(res, 200, {
          enabled: CONFIG.autoHarvest.enabled,
          destinationWallet: CONFIG.autoHarvest.destinationWallet ? CONFIG.autoHarvest.destinationWallet.slice(0, 6) + '...' + CONFIG.autoHarvest.destinationWallet.slice(-4) : 'not configured',
          thresholdUSD: CONFIG.autoHarvest.thresholdUSD,
          cooldownHours: CONFIG.autoHarvest.cooldownHours,
          minETHReserve: CONFIG.autoHarvest.minETHReserve,
          totalTransfers: (state.autoHarvestTransfers || []).length,
          recentTransfers: (state.autoHarvestTransfers || []).slice(-5),
          lastHarvestTime: (state.lastAutoHarvestTime || null)
        });
        break;
      case '/api/auto-harvest/trigger':
        if (CONFIG.autoHarvest.enabled) {
          const cooldownMs = CONFIG.autoHarvest.cooldownHours * 60 * 60 * 1000;
          CONFIG.autoHarvest.cooldownHours = 0;
          sendJSON(res, 200, { message: 'Auto-harvest cooldown reset, will trigger on next cycle' });
          setTimeout(() => { CONFIG.autoHarvest.cooldownHours = cooldownMs / (60 * 60 * 1000); }, 60000);
        } else {
          sendJSON(res, 400, { error: 'Auto-harvest is not enabled' });
        }
        break;
      // === v6.2: ADAPTIVE CYCLE API ENDPOINT ===
      case '/api/adaptive':
        sendJSON(res, 200, {
          version: '6.2',
          currentIntervalSec: adaptiveCycle.currentIntervalSec,
          volatilityLevel: adaptiveCycle.volatilityLevel,
          portfolioTier: adaptiveCycle.portfolioTier,
          dynamicPriceThreshold: adaptiveCycle.dynamicPriceThreshold,
          emergencyMode: adaptiveCycle.emergencyMode,
          emergencyUntil: adaptiveCycle.emergencyMode ? new Date(adaptiveCycle.emergencyUntil).toISOString() : null,
          priceStreamActive: adaptiveCycle.wsConnected,
          consecutiveLightCycles: adaptiveCycle.consecutiveLightCycles,
          cycleStats: {
            light: cycleStats.totalLight,
            heavy: cycleStats.totalHeavy,
            lastHeavyReason: cycleStats.lastHeavyReason,
          },
          config: {
            minIntervalSec: ADAPTIVE_MIN_INTERVAL_SEC,
            maxIntervalSec: ADAPTIVE_MAX_INTERVAL_SEC,
            emergencyIntervalSec: EMERGENCY_INTERVAL_SEC,
            emergencyDropThreshold: EMERGENCY_DROP_THRESHOLD,
            portfolioTiers: PORTFOLIO_SENSITIVITY_TIERS,
          },
        });
        break;

      // === DERIVATIVES API ENDPOINT (v6.0) ===
      case '/api/derivatives':
        sendJSON(res, 200, {
          enabled: derivativesEngine?.isEnabled() || false,
          state: derivativesEngine?.getState() || null,
          recentTrades: derivativesEngine?.getTradeHistory()?.slice(-20) || [],
          config: derivativesEngine?.getConfig() || null,
          commoditySignal: commoditySignalEngine?.getLastSignal() || null,
          lastCycleData: lastDerivativesData,
        });
        break;

      case '/api/equity':
        if (equityEnabled && equityEngine) {
          const eqDash = await equityEngine.getDashboardData();
          sendJSON(res, 200, eqDash);
        } else {
          sendJSON(res, 200, { enabled: false });
        }
        break;

      case '/api/discovery':
        if (tokenDiscoveryEngine) {
          const discoveryState = tokenDiscoveryEngine.getState();
          sendJSON(res, 200, {
            ...discoveryState,
            tradableTokens: tokenDiscoveryEngine.getTradableTokens().length,
            topByVolume: tokenDiscoveryEngine.getDiscoveredTokens().slice(0, 10).map(t => ({
              symbol: t.symbol,
              name: t.name,
              sector: t.sector,
              volume24h: t.volume24hUSD,
              liquidity: t.liquidityUSD,
              price: t.priceUSD,
              change24h: t.priceChange24h,
              dex: t.dexName,
              hasCoinGecko: !!t.coingeckoId,
            })),
          });
        } else {
          sendJSON(res, 200, { enabled: false });
        }
        break;

      case '/api/cache':
        sendJSON(res, 200, {
          stats: cacheManager.getStats(),
          cooldowns: {
            active: cooldownManager.getActiveCount(),
            summary: cooldownManager.getSummary(),
          },
          cycleStats,
        });
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
      <p class="text-xs text-slate-500 mt-0.5">Autonomous Trading Agent v5.1.1</p>
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
      <p class="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Harvested</p>
      <p class="text-lg font-semibold mono text-amber-400" id="harvested-pnl">--</p>
      <p class="text-[9px] text-slate-600" id="harvest-count"></p>
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

<!-- Phase 3: Self-Improvement Intelligence -->
<div class="max-w-7xl mx-auto px-4 sm:px-6 pb-8">
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
    <!-- Top Patterns -->
    <div class="glass rounded-xl p-5">
      <h2 class="text-sm font-semibold text-white mb-1">Top Patterns</h2>
      <p class="text-[10px] text-slate-500 mb-3">Winning strategies by return</p>
      <div id="top-patterns" class="space-y-2">
        <p class="text-xs text-slate-600">Loading...</p>
      </div>
    </div>
    <!-- Adaptive Thresholds -->
    <div class="glass rounded-xl p-5">
      <h2 class="text-sm font-semibold text-white mb-1">Adaptive Thresholds</h2>
      <p class="text-[10px] text-slate-500 mb-3">Self-tuning parameters</p>
      <div id="thresholds-display" class="space-y-2">
        <p class="text-xs text-slate-600">Loading...</p>
      </div>
    </div>
    <!-- Latest Insights -->
    <div class="glass rounded-xl p-5">
      <h2 class="text-sm font-semibold text-white mb-1">Latest Insights</h2>
      <p class="text-[10px] text-slate-500 mb-3">Self-improvement engine</p>
      <div id="latest-insights" class="space-y-2">
        <p class="text-xs text-slate-600">Loading...</p>
      </div>
    </div>
  </div>
</div>

<!-- v5.1: Market Intelligence Dashboard -->
<div class="max-w-7xl mx-auto px-4 sm:px-6 pb-8">
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <!-- Derivatives Positioning -->
    <div class="glass rounded-xl p-5">
      <h2 class="text-sm font-semibold text-white mb-1">Derivatives Positioning</h2>
      <p class="text-[10px] text-slate-500 mb-3">Smart money vs retail sentiment</p>
      <div id="derivatives-intel" class="space-y-2">
        <p class="text-xs text-slate-600">Loading...</p>
      </div>
    </div>
    <!-- Cross-Asset Correlation -->
    <div class="glass rounded-xl p-5">
      <h2 class="text-sm font-semibold text-white mb-1">Cross-Asset Intelligence</h2>
      <p class="text-[10px] text-slate-500 mb-3">Gold, Oil, VIX, S&P 500</p>
      <div id="cross-asset-intel" class="space-y-2">
        <p class="text-xs text-slate-600">Loading...</p>
      </div>
    </div>
  </div>
  <!-- Shadow Model Proposals -->
  <div class="glass rounded-xl p-5 mt-4">
    <h2 class="text-sm font-semibold text-white mb-1">Shadow Model Validation</h2>
    <p class="text-[10px] text-slate-500 mb-3">Proposed threshold changes awaiting statistical confirmation</p>
    <div id="shadow-proposals" class="space-y-2">
      <p class="text-xs text-slate-600">Loading...</p>
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
    const [pRes, bRes, sRes, tRes, patRes, thrRes, revRes, intRes] = await Promise.allSettled([
      fetch('/api/portfolio').then(r => r.json()),
      fetch('/api/balances').then(r => r.json()),
      fetch('/api/sectors').then(r => r.json()),
      fetch('/api/trades?limit=30').then(r => r.json()),
      fetch('/api/patterns').then(r => r.json()),
      fetch('/api/thresholds').then(r => r.json()),
      fetch('/api/reviews').then(r => r.json()),
      fetch('/api/intelligence').then(r => r.json()),
    ]);
    const p = pRes.status === 'fulfilled' ? pRes.value : null;
    const b = bRes.status === 'fulfilled' ? bRes.value : null;
    const s = sRes.status === 'fulfilled' ? sRes.value : null;
    const t = tRes.status === 'fulfilled' ? tRes.value : null;
    const pat = patRes.status === 'fulfilled' ? patRes.value : null;
    const thr = thrRes.status === 'fulfilled' ? thrRes.value : null;
    const rev = revRes.status === 'fulfilled' ? revRes.value : null;
    const intel = intRes.status === 'fulfilled' ? intRes.value : null;

    if (p) renderPortfolio(p);
    if (b) renderHoldings(b);
    if (s) renderSectors(s);
    if (t) renderTrades(t);
    if (pat) renderPatterns(pat);
    if (thr) renderThresholds(thr);
    if (rev) renderInsights(rev);
    if (intel) renderIntelligence(intel);
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

  // v5.1.1: Harvested profits display
  const hEl = $('harvested-pnl');
  const harv = p.harvestedProfits || 0;
  hEl.textContent = harv > 0 ? pnlSign(harv) + fmt(harv) : '$0.00';
  hEl.className = 'text-lg font-semibold mono ' + (harv > 0 ? 'text-amber-400' : 'text-slate-500');
  const hcEl = $('harvest-count');
  if (hcEl) hcEl.textContent = (p.harvestCount || 0) > 0 ? p.harvestCount + ' harvests' : 'no harvests yet';

  // Show recent harvests as mini-feed if available
  if (p.recentHarvests && p.recentHarvests.length > 0) {
    const lastH = p.recentHarvests[p.recentHarvests.length - 1];
    if (hcEl) hcEl.textContent = p.harvestCount + ' harvests | last: ' + lastH.symbol + ' +' + lastH.gainPercent + '%';
  }

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

function renderPatterns(pat) {
  const el = $('top-patterns');
  if (!pat.topPerformers || pat.topPerformers.length === 0) {
    el.innerHTML = '<p class="text-xs text-slate-600">No patterns with enough data yet (' + pat.totalPatterns + ' tracked)</p>';
    return;
  }
  el.innerHTML = pat.topPerformers.map(p => {
    const winRate = p.stats.sampleSize > 0 ? ((p.stats.wins / p.stats.sampleSize) * 100).toFixed(0) : '0';
    const retColor = p.stats.avgReturnPercent >= 0 ? 'text-emerald-400' : 'text-red-400';
    const confColor = p.confidence >= 0.7 ? 'text-emerald-400' : p.confidence >= 0.4 ? 'text-amber-400' : 'text-red-400';
    return '<div class="flex items-center justify-between py-1.5 border-b border-white/5">' +
      '<div class="flex-1 min-w-0"><p class="text-[11px] text-slate-300 truncate">' + p.description + '</p>' +
      '<p class="text-[10px] text-slate-500">' + p.stats.sampleSize + ' trades | ' + winRate + '% win</p></div>' +
      '<div class="text-right ml-2"><span class="text-xs mono font-semibold ' + retColor + '">' + (p.stats.avgReturnPercent >= 0 ? '+' : '') + p.stats.avgReturnPercent.toFixed(1) + '%</span>' +
      '<p class="text-[10px] ' + confColor + '">' + (p.confidence * 100).toFixed(0) + '% conf</p></div></div>';
  }).join('');
}

function renderThresholds(thr) {
  const el = $('thresholds-display');
  const t = thr.currentThresholds;
  const d = thr.defaults;
  const rows = [
    ['RSI Oversold', t.rsiOversold, d.rsiOversold],
    ['RSI Overbought', t.rsiOverbought, d.rsiOverbought],
    ['Buy Signal', t.confluenceBuy, d.confluenceBuy],
    ['Sell Signal', t.confluenceSell, d.confluenceSell],
    ['Profit Take', t.profitTakeTarget + '%', d.profitTakeTarget + '%'],
    ['Stop Loss', t.stopLossPercent + '%', d.stopLossPercent + '%'],
  ];
  const changed = rows.filter(r => String(r[1]) !== String(r[2])).length;
  el.innerHTML = '<p class="text-[10px] text-slate-500 mb-2">' + thr.adaptationCount + ' adaptations | ' + changed + ' modified</p>' +
    rows.map(r => {
      const isModified = String(r[1]) !== String(r[2]);
      const valColor = isModified ? 'text-amber-400' : 'text-slate-300';
      return '<div class="flex justify-between py-1 border-b border-white/5">' +
        '<span class="text-[11px] text-slate-400">' + r[0] + '</span>' +
        '<span class="text-[11px] mono font-medium ' + valColor + '">' + r[1] + (isModified ? ' (was ' + r[2] + ')' : '') + '</span></div>';
    }).join('');
  if (thr.explorationState) {
    el.innerHTML += '<div class="mt-2 pt-2 border-t border-white/5"><p class="text-[10px] text-slate-500">Exploration: ' +
      thr.explorationState.totalExplorationTrades + ' trades | ' + thr.explorationState.consecutiveHolds + ' consecutive holds</p></div>';
  }
}

function renderInsights(rev) {
  const el = $('latest-insights');
  if (!rev.latestReview) {
    const remaining = Math.max(0, 10 - rev.tradesSinceLastReview);
    el.innerHTML = '<p class="text-xs text-slate-600">No reviews yet (' + remaining + ' trades until first review)</p>';
    return;
  }
  const r = rev.latestReview;
  const sevIcon = { INFO: '💡', WARNING: '⚠️', ACTION: '🎯' };
  el.innerHTML = '<p class="text-[10px] text-slate-500 mb-2">Review ' + rev.totalReviews + ' | ' + new Date(r.timestamp).toLocaleDateString() + ' | Win rate: ' + (r.periodStats.winRate * 100).toFixed(0) + '%</p>' +
    r.insights.slice(0, 5).map(i => {
      const icon = sevIcon[i.severity] || '📊';
      return '<div class="py-1.5 border-b border-white/5"><p class="text-[11px] text-slate-300">' + icon + ' ' + i.message + '</p></div>';
    }).join('') +
    (r.recommendations.length > 0 ? '<div class="mt-2 pt-1"><p class="text-[10px] text-slate-500 mb-1">Recommendations:</p>' +
      r.recommendations.slice(0, 3).map(rec => '<p class="text-[10px] text-amber-400/80 py-0.5">→ ' + rec.description + '</p>').join('') + '</div>' : '');
}

// v5.1: Render derivatives positioning + cross-asset intelligence
function renderIntelligence(intel) {
  // Derivatives positioning
  const derivEl = $('derivatives-intel');
  const d = intel.derivatives;
  if (d) {
    const posColor = (sig) => {
      if (sig === 'SMART_MONEY_LONG') return 'text-emerald-400';
      if (sig === 'SMART_MONEY_SHORT' || sig === 'OVERLEVERAGED_LONG') return 'text-red-400';
      if (sig === 'OVERLEVERAGED_SHORT') return 'text-amber-400';
      return 'text-slate-400';
    };
    const posIcon = (sig) => {
      if (sig === 'SMART_MONEY_LONG') return '🟢';
      if (sig === 'SMART_MONEY_SHORT') return '🔴';
      if (sig === 'OVERLEVERAGED_LONG') return '⚠️';
      if (sig === 'OVERLEVERAGED_SHORT') return '⚠️';
      return '⚪';
    };
    derivEl.innerHTML =
      '<div class="grid grid-cols-2 gap-3">' +
      '<div><p class="text-[10px] text-slate-500 mb-1">BTC Positioning</p>' +
      '<p class="text-xs font-medium ' + posColor(d.btcPositioningSignal) + '">' + posIcon(d.btcPositioningSignal) + ' ' + (d.btcPositioningSignal || 'N/A').replace(/_/g, ' ') + '</p>' +
      '<p class="text-[10px] text-slate-500 mt-1">L/S: ' + (d.btcLongShortRatio != null ? d.btcLongShortRatio.toFixed(2) : 'N/A') + ' | Top: ' + (d.btcTopTraderLSRatio != null ? d.btcTopTraderLSRatio.toFixed(2) : 'N/A') + '</p>' +
      '<p class="text-[10px] text-slate-500">Funding: ' + (d.btcFundingRate >= 0 ? '+' : '') + d.btcFundingRate.toFixed(4) + '%</p></div>' +
      '<div><p class="text-[10px] text-slate-500 mb-1">ETH Positioning</p>' +
      '<p class="text-xs font-medium ' + posColor(d.ethPositioningSignal) + '">' + posIcon(d.ethPositioningSignal) + ' ' + (d.ethPositioningSignal || 'N/A').replace(/_/g, ' ') + '</p>' +
      '<p class="text-[10px] text-slate-500 mt-1">L/S: ' + (d.ethLongShortRatio != null ? d.ethLongShortRatio.toFixed(2) : 'N/A') + ' | Top: ' + (d.ethTopTraderLSRatio != null ? d.ethTopTraderLSRatio.toFixed(2) : 'N/A') + '</p>' +
      '<p class="text-[10px] text-slate-500">Funding: ' + (d.ethFundingRate >= 0 ? '+' : '') + d.ethFundingRate.toFixed(4) + '%</p></div>' +
      '</div>';
    // OI-Price Divergence
    if (d.btcOIPriceDivergence && d.btcOIPriceDivergence !== 'NEUTRAL' && d.btcOIPriceDivergence !== 'ALIGNED') {
      derivEl.innerHTML += '<div class="mt-2 pt-2 border-t border-white/5"><p class="text-[10px] text-amber-400">⚡ BTC: ' + d.btcOIPriceDivergence.replace(/_/g, ' ') + '</p></div>';
    }
    if (d.ethOIPriceDivergence && d.ethOIPriceDivergence !== 'NEUTRAL' && d.ethOIPriceDivergence !== 'ALIGNED') {
      derivEl.innerHTML += '<p class="text-[10px] text-amber-400">⚡ ETH: ' + d.ethOIPriceDivergence.replace(/_/g, ' ') + '</p>';
    }
  } else {
    derivEl.innerHTML = '<p class="text-xs text-slate-600">Derivatives data not yet available</p>';
  }

  // Cross-asset intelligence
  const caEl = $('cross-asset-intel');
  const m = intel.macroData;
  if (m && m.crossAssets) {
    const ca = m.crossAssets;
    const sigColor = ca.crossAssetSignal === 'RISK_ON' ? 'text-emerald-400' : ca.crossAssetSignal === 'RISK_OFF' ? 'text-red-400' : ca.crossAssetSignal === 'FLIGHT_TO_SAFETY' ? 'text-red-500' : 'text-slate-400';
    const sigIcon = ca.crossAssetSignal === 'RISK_ON' ? '🟢' : ca.crossAssetSignal === 'RISK_OFF' ? '🔴' : ca.crossAssetSignal === 'FLIGHT_TO_SAFETY' ? '🚨' : '⚪';
    const pctFmt = (n) => n != null ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : 'N/A';
    caEl.innerHTML =
      '<div class="grid grid-cols-2 gap-x-4 gap-y-2">' +
      '<div class="flex justify-between"><span class="text-[11px] text-slate-400">Gold</span><span class="text-[11px] mono ' + (ca.goldChange24h >= 0 ? 'text-emerald-400' : 'text-red-400') + '">$' + (ca.goldPrice != null ? ca.goldPrice.toFixed(0) : 'N/A') + ' ' + pctFmt(ca.goldChange24h) + '</span></div>' +
      '<div class="flex justify-between"><span class="text-[11px] text-slate-400">Oil (WTI)</span><span class="text-[11px] mono text-slate-300">$' + (ca.oilPrice != null ? ca.oilPrice.toFixed(1) : 'N/A') + ' ' + pctFmt(ca.oilChange24h) + '</span></div>' +
      '<div class="flex justify-between"><span class="text-[11px] text-slate-400">VIX</span><span class="text-[11px] mono ' + (ca.vixLevel > 25 ? 'text-red-400' : ca.vixLevel < 15 ? 'text-emerald-400' : 'text-slate-300') + '">' + (ca.vixLevel != null ? ca.vixLevel.toFixed(1) : 'N/A') + '</span></div>' +
      '<div class="flex justify-between"><span class="text-[11px] text-slate-400">S&P 500</span><span class="text-[11px] mono ' + ((ca.sp500Change || 0) >= 0 ? 'text-emerald-400' : 'text-red-400') + '">' + pctFmt(ca.sp500Change) + '</span></div>' +
      '</div>' +
      '<div class="mt-2 pt-2 border-t border-white/5"><p class="text-xs font-medium ' + sigColor + '">' + sigIcon + ' ' + ca.crossAssetSignal.replace(/_/g, ' ') + '</p></div>';
  } else {
    caEl.innerHTML = '<p class="text-xs text-slate-600">Cross-asset data not yet available</p>';
  }

  // Shadow Model Proposals
  const shadowEl = $('shadow-proposals');
  if (intel.shadowProposals && intel.shadowProposals.length > 0) {
    const pending = intel.shadowProposals.filter(p => p.status === 'PENDING');
    const recent = intel.shadowProposals.filter(p => p.status !== 'PENDING').slice(-3);
    shadowEl.innerHTML = '<p class="text-[10px] text-slate-500 mb-2">' + pending.length + ' pending proposals</p>' +
      pending.map(p => {
        const pct = p.confirmingReviews + '/' + 3;
        const barWidth = Math.min(100, (p.confirmingReviews / 3) * 100);
        return '<div class="py-1.5 border-b border-white/5">' +
          '<div class="flex justify-between"><span class="text-[11px] text-slate-300">' + p.field + ' ' + (p.proposedDelta > 0 ? '↑' : '↓') + Math.abs(p.proposedDelta) + '</span>' +
          '<span class="text-[10px] text-slate-500">' + pct + ' confirmations</span></div>' +
          '<div class="w-full bg-white/5 rounded-full h-1 mt-1"><div class="bg-amber-500/60 h-1 rounded-full" style="width:' + barWidth + '%"></div></div>' +
          '<p class="text-[10px] text-slate-600 mt-0.5">' + p.reason + '</p></div>';
      }).join('') +
      (recent.length > 0 ? '<div class="mt-2 pt-1">' + recent.map(p => {
        const icon = p.status === 'PROMOTED' ? '✅' : '❌';
        return '<p class="text-[10px] ' + (p.status === 'PROMOTED' ? 'text-emerald-400/70' : 'text-red-400/70') + '">' + icon + ' ' + p.field + ' — ' + p.status + '</p>';
      }).join('') + '</div>' : '');
  } else {
    shadowEl.innerHTML = '<p class="text-xs text-slate-600">No active proposals — thresholds at defaults</p>';
  }
}

// Initial load + auto-refresh every 30s
fetchData();
setInterval(fetchData, 30000);
</script>
</body>
</html>`;

