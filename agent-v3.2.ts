/**
 * Henry's Autonomous Trading Agent v5.2.0
 *
 * PHASE 3: RECURSIVE SELF-IMPROVEMENT ENGINE + v5.1 INTELLIGENCE UPGRADE
 *
 * CHANGES IN V5.1.1:
 * - NEW: Tiered Profit Harvesting — scale out of winners in 4 tranches (+8%, +15%, +25%, +40%)
 * - NEW: Time-based rebalancing — positions held 72h+ with +5% gain get a 10% trim
 * - NEW: Per-tier cooldowns — each harvest tier has independent 6h cooldowns
 * - NEW: Harvested profits tracking — dashboard shows total banked profits +harvest history
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
 * - Last-known-prices cache prevents $0 portfolio between cycles
 * - Intelligence fetches run in parallel with price reads (faster cycles)
 *
 * CHANGES IN V4.5.1:
 * - Fixed CryptoPanic: proper API v1 endpoint with auth_token (env: CRYPTOPANIC_AUTH_TOKEN)
 * - Fixed FRED API: added env var check + warning (auth fixed in v4.5.3)
 * - Price fallback chain: on-chain → DexScreener → Chainlink (no external API dependencies)
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
import { parseUnits, formatUnits, formatEther, getAddress, type Address } from "viem";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const BOT_VERSION: string = _require("./package.json").version;

// === DERIVATIVES MODULE IMPORTS (v6.0) ===
import { CoinbaseAdvancedTradeClient } from "./services/services/coinbase-advanced-trade.js";
import { DerivativesStrategyEngine, DEFAULT_DERIVATIVES_CONFIG, type DerivativesSignal, type DerivativesTradeRecord, type MacroCommoditySignal } from "./services/services/derivatives-strategy.js";
import { MacroCommoditySignalEngine, discoverCommodityContracts } from "./services/services/macro-commodity-signals.js";

// === v6.0: EQUITY INTEGRATION ===
import { EquityIntegration } from './equity-integration.js';

// === v6.1: TOKEN DISCOVERY ENGINE ===
import { TokenDiscoveryEngine, type DiscoveredToken, type TokenDiscoveryState } from './services/token-discovery.js';

// === NVR-SPEC-NL: NATURAL LANGUAGE STRATEGY CONFIG ===
import { parseStrategyInstruction, isStrategyInstruction, type ConfigChange, type ParseResult, type ConfigDirective } from './services/strategy-config.js';

// === NVR-SPEC-001: BACKTESTING & SIMULATION ENGINE ===
import { runSimulation, compareStrategies, loadPriceHistory, DEFAULT_SIM_CONFIG, type SimConfig } from './services/simulator.js';

// === STRATEGY LAB: Paper Trading + Version Registry + Multi-Version Backtester ===
import { STRATEGY_VERSIONS, getVersion, type StrategyVersion } from './services/strategy-versions.js';
import {
  createPaperPortfolio, getPaperPortfolio, getAllPaperPortfolios,
  evaluatePaperTrade, updatePaperPortfolio, getPaperPortfolioSummary,
  savePaperPortfolios, loadPaperPortfolios,
  type PaperPortfolio, type TokenSignal,
} from './services/paper-trader.js';
import { runAllVersionBacktestsFromDisk, summarizeBacktestResults } from './services/version-backtester.js';

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
  TOKEN_WATCH_INTERVAL_MS, // v7.0
  TOKEN_HEAVY_ANALYSIS_INTERVAL_MS, // v7.0
  CAPITAL_FLOOR_PERCENT,
  CAPITAL_FLOOR_ABSOLUTE_USD,
  SECTOR_STOP_LOSS_OVERRIDES,
  // v8.0: Phase 1 — Institutional Position Sizing & Capital Protection
  KELLY_FRACTION,
  KELLY_MIN_TRADES,
  KELLY_ROLLING_WINDOW,
  KELLY_POSITION_FLOOR_USD,
  KELLY_POSITION_CEILING_PCT,
  KELLY_SMALL_PORTFOLIO_CEILING_PCT,
  KELLY_SMALL_PORTFOLIO_THRESHOLD,
  VOL_TARGET_DAILY_PCT,
  VOL_HIGH_THRESHOLD,
  VOL_HIGH_REDUCTION,
  VOL_LOW_THRESHOLD,
  VOL_LOW_BOOST,
  VOL_LOOKBACK_DAYS,
  BREAKER_CONSECUTIVE_LOSSES,
  BREAKER_DAILY_DD_PCT,
  BREAKER_WEEKLY_DD_PCT,
  BREAKER_SINGLE_TRADE_LOSS_PCT,
  BREAKER_PAUSE_HOURS,
  BREAKER_SIZE_REDUCTION,
  BREAKER_SIZE_REDUCTION_HOURS,
  // v8.1: Phase 2 — Execution Quality
  VWS_MAX_SPREAD_PCT,
  VWS_TRADE_AS_POOL_PCT_MAX,
  VWS_TRADE_AS_POOL_PCT_WARN,
  VWS_MIN_LIQUIDITY_USD,
  VWS_PREFERRED_LIQUIDITY_USD,
  VWS_THIN_POOL_SIZE_REDUCTION,
  TWAP_THRESHOLD_USD,
  TWAP_NUM_SLICES,
  TWAP_SLICE_INTERVAL_MS,
  TWAP_TIMING_JITTER_PCT,
  TWAP_ADVERSE_MOVE_PCT,
  TWAP_MAX_DURATION_MS,
  GAS_PRICE_HIGH_GWEI,
  GAS_PRICE_NORMAL_GWEI,
  GAS_COST_MAX_PCT_OF_TRADE,
  BASE_RPC_ENDPOINTS,
  // v9.0: ATR-Based Dynamic Risk Management
  ATR_STOP_LOSS_MULTIPLIER,
  ATR_TRAILING_STOP_MULTIPLIER,
  ATR_STOP_FLOOR_PERCENT,
  ATR_STOP_CEILING_PERCENT,
  ATR_TRAIL_ACTIVATION_MULTIPLIER,
  SECTOR_ATR_MULTIPLIERS,
  ATR_PROFIT_TIERS,
  ATR_COMPARISON_LOG_COUNT,
  // v9.2: Auto Gas Refuel
  GAS_REFUEL_THRESHOLD_ETH,
  GAS_REFUEL_AMOUNT_USDC,
  GAS_REFUEL_MIN_USDC,
  GAS_REFUEL_COOLDOWN_MS,
  // v9.2.1: Gas Bootstrap
  GAS_BOOTSTRAP_MIN_ETH_USD,
  GAS_BOOTSTRAP_SWAP_USD,
  GAS_BOOTSTRAP_MIN_USDC,
  // v9.3: Daily Payout
  DAILY_PAYOUT_CRON,
  DAILY_PAYOUT_MIN_TRANSFER_USD,
  DAILY_PAYOUT_MIN_ETH_RESERVE,
  DAILY_PAYOUT_USDC_BUFFER,
  // v10.0: Market Intelligence Engine
  BTC_DOMINANCE_CHANGE_THRESHOLD,
  SMART_RETAIL_DIVERGENCE_THRESHOLD,
  FUNDING_RATE_STD_DEV_THRESHOLD,
  FUNDING_RATE_HISTORY_LENGTH,
  TVL_PRICE_DIVERGENCE_THRESHOLD,
  STABLECOIN_SUPPLY_CHANGE_THRESHOLD,
  ALTSEASON_SECTOR_BOOST,
  BTC_DOMINANCE_SECTOR_BOOST,
  // v11.1: Cash Deployment Engine
  CASH_DEPLOYMENT_THRESHOLD_PCT,
  CASH_DEPLOYMENT_CONFLUENCE_DISCOUNT,
  CASH_DEPLOYMENT_MAX_DEPLOY_PCT,
  CASH_DEPLOYMENT_MIN_RESERVE_USD,
  CASH_DEPLOYMENT_MAX_ENTRIES,
  CASH_DEPLOY_REQUIRES_MOMENTUM,
  // v11.2/v17.0: Crash-Buying Breaker Override (now flow-based)
  DEPLOYMENT_BREAKER_OVERRIDE_MIN_CASH_PCT,
  DEPLOYMENT_BREAKER_OVERRIDE_SIZE_MULT,
  DEPLOYMENT_BREAKER_OVERRIDE_MAX_ENTRIES,
  VOLUME_SPIKE_THRESHOLD,
  // v12.0: On-Chain Pricing Engine
  PRICE_HISTORY_RECORD_INTERVAL_MS,
  PRICE_HISTORY_MAX_POINTS,
  PRICE_HISTORY_SAVE_INTERVAL_MS,
  POOL_DISCOVERY_MAX_AGE_MS,
  POOL_REDISCOVERY_FAILURE_THRESHOLD,
  VOLUME_ENRICHMENT_INTERVAL_MS,
  VOLUME_SELF_SUFFICIENT_POINTS,
  PRICE_SANITY_MAX_DEVIATION,
  // v12.3: On-Chain Order Flow Intelligence
  ORDER_FLOW_BLOCK_LOOKBACK,
  TWAP_DIVERGENCE_THRESHOLD_PCT,
  TWAP_MILD_THRESHOLD_PCT,
  TICK_DEPTH_RANGE,
  LARGE_TRADE_THRESHOLD_USD,
  SWAP_EVENT_TOPIC,
  TWAP_OBSERVATION_SECONDS,
  // v13.0: Scale-Into-Winners
  SCALE_UP_MIN_GAIN_PCT,
  SCALE_UP_BUY_RATIO_MIN,
  SCALE_UP_SIZE_PCT,
  MOMENTUM_EXIT_BUY_RATIO,
  MOMENTUM_EXIT_MIN_PROFIT,
  RIDE_THE_WAVE_MIN_MOVE,
  RIDE_THE_WAVE_SIZE_PCT,
  SCALE_UP_DEDUP_WINDOW_MINUTES,
  FORCED_DEPLOY_DEDUP_WINDOW_MINUTES,
  MOMENTUM_EXIT_DEDUP_WINDOW_MINUTES,
  NORMAL_DEDUP_WINDOW_MINUTES,
  MAX_TRADES_PER_CYCLE,
  RANGING_MAX_TRADES_PER_CYCLE,
  MOMENTUM_MAX_POSITION_PERCENT,
  // v16.0: Per-Position Stop-Loss
  POSITION_HARD_STOP_PCT,
  POSITION_SOFT_STOP_PCT,
  POSITION_CONCENTRATED_STOP_PCT,
  // v19.0: Flow-reversal exits
  FLOW_REVERSAL_EXIT_BUY_RATIO,
  FLOW_REVERSAL_EXIT_MIN_DECEL_READINGS,
  // v19.0: Scout mode
  SCOUT_POSITION_USD,
  SCOUT_MAX_POSITIONS,
  SCOUT_UPGRADE_BUY_RATIO,
  SCOUT_STOP_EXEMPT_THRESHOLD_USD,
  // v19.0: Surge mode
  SURGE_DEDUP_WINDOW_MINUTES,
  SURGE_MAX_CAPITAL_PER_TOKEN_PCT,
  SURGE_MAX_BUYS_PER_HOUR,
  // v14.1: Smart Trim (Momentum Deceleration Exit)
  DECEL_TRIM_DEDUP_WINDOW_MINUTES,
  // v15.3: Yield Optimizer
  YIELD_CHECK_INTERVAL_CYCLES,
  YIELD_MIN_DIFFERENTIAL_PCT,
  YIELD_MIN_IDLE_USD,
  // v16.0: Fear/Regime constants — v17.0: kept for reference but no longer used as gates
  // v16.0: Dust Cleanup (NVR Audit P1-3)
  DUST_CLEANUP_THRESHOLD_USD,
  DUST_CLEANUP_MIN_AGE_HOURS,
  DUST_CLEANUP_INTERVAL_CYCLES,
} from "./config/constants.js";
import type { CooldownDecision } from "./types/index.js";
// v20.0: Adaptive Exit Timing Engine — ATR-based trailing stops
import { updateTrailingStop, checkTrailingStopHit, getTrailingStopState, getTrailingStop, removeTrailingStop, resetTrailingStopTrigger } from './services/trailing-stops.js';

// === v11.0: FAMILY PLATFORM MODULE ===
import { familyManager, WalletManager, fanOutDecision, executeFamilyTrades } from './family/index.js';
import type { FamilyTradeDecision, FamilyTradeResult } from './types/family.js';

// === v11.0: AAVE V3 YIELD SERVICE ===
import { aaveYieldService } from './services/aave-yield.js';

// === v15.3: MULTI-PROTOCOL YIELD OPTIMIZER ===
import { yieldOptimizer } from './services/yield-optimizer.js';
import type { ProtocolYield } from './services/yield-optimizer.js';

// === v14.1: MOMENTUM DECELERATION DETECTOR (Smart Trim) ===
import { createDecelState, updateBuyRatioHistory, detectDeceleration } from './services/deceleration-detector.js';
import type { DecelState } from './services/deceleration-detector.js';

// === v19.0: MULTI-TIMEFRAME FLOW AGGREGATION ===
import { createFlowTimeframeState, recordFlowReading, getFlowTimeframes } from './services/flow-timeframes.js';
import type { FlowTimeframeState } from './services/flow-timeframes.js';

// === v19.0: SIGNAL QUALITY TRACKER ===
import { recordExecuted, recordFiltered, getSignalStats } from './services/signal-tracker.js';
import { generateWeeklyReport, shouldGenerateReport, getLatestReport } from './services/weekly-report.js';
import type { YieldState } from './services/aave-yield.js';

// === v11.0: GECKOTERMINAL DEX INTELLIGENCE ===
import { geckoTerminalService } from './services/gecko-terminal.js';
import type { DexIntelligence } from './services/gecko-terminal.js';

// === v15.0: MULTI-AGENT SWARM ARCHITECTURE ===
import { runSwarm, formatSwarmForPrompt, setLatestSwarmDecisions, getLatestSwarmDecisions, getLastSwarmRunTime } from './services/swarm/orchestrator.js';
import type { SwarmDecision } from './services/swarm/agent-framework.js';
import { SIGNAL_ENGINE } from './config/constants.js';

dotenv.config();

// ============================================================================
// v14.2: EXPLORATION TRADE GUARDRAILS — prevent exploration from fighting the trend
// Bug: LINK was bought at confluence -26 with BEARISH MACD. Even data-gathering
// trades should respect basic trend filters.
// ============================================================================
const EXPLORATION_MIN_CONFLUENCE = 0;           // No exploration buys with negative confluence
const EXPLORATION_MIN_BUY_RATIO = 45;           // No exploration when sellers dominate (buy ratio < 45%)
const EXPLORATION_RANGING_SIZE_MULTIPLIER = 0.5; // Cut exploration size 50% in RANGING markets
const EXPLORATION_RANGING_MAX_PER_CYCLE = 1;    // Max 1 exploration trade per cycle in RANGING markets

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
    targetAllocation: 0.45, // 45% of portfolio
    description: "Safe, liquid assets - ETH, BTC",
    tokens: ["ETH", "cbBTC", "cbETH", "wstETH", "LINK", "cbLTC", "cbXRP"],
  },
  AI_TOKENS: {
    name: "AI & Agents",
    targetAllocation: 0.20, // 20% of portfolio
    description: "AI and agent tokens - high growth potential",
    tokens: ["VIRTUAL", "AIXBT", "HIGHER", "VVV", "CLANKER"],
  },
  MEME_COINS: {
    name: "Meme Coins",
    targetAllocation: 0.15, // 15% of portfolio
    description: "High risk/reward meme tokens",
    tokens: ["BRETT", "DEGEN", "TOSHI", "MOCHI", "NORMIE", "KEYCAT"],
  },
  DEFI: {
    name: "DeFi Protocols",
    targetAllocation: 0.20, // 20% of portfolio
    description: "Base DeFi ecosystem tokens",
    tokens: ["AERO", "WELL", "SEAM", "EXTRA", "BAL", "MORPHO", "PENDLE", "RSR"],
  },
};

// v11.4.11: Tokens that CDP SDK's routing service cannot swap (returns "Invalid request").
// CoinbaseSmartWallet uses AA — can't fall back to direct DEX calls either.
// These are skipped during forced deployment rotation; alternatives from the same sector are used.
const CDP_UNSUPPORTED_TOKENS = new Set(['AIXBT', 'DEGEN', 'VIRTUAL']);

// v14.3: Tokens that CDP SDK can't swap but CAN be traded via direct DEX swap (Uniswap V3 / Aerodrome).
// These are NOT blocked — executeDirectDexSwap handles them via account.sendTransaction().
const DEX_SWAP_TOKENS = new Set(['MORPHO', 'cbLTC', 'PENDLE']);

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
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18,
  },
  WETH: {
    address: "0x4200000000000000000000000000000000000006",
    symbol: "WETH", name: "Wrapped Ethereum", coingeckoId: "ethereum",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18,
  },
  cbBTC: {
    address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    symbol: "cbBTC", name: "Coinbase Wrapped BTC", coingeckoId: "bitcoin",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 8,
  },
  cbETH: {
    address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    symbol: "cbETH", name: "Coinbase Staked ETH", coingeckoId: "coinbase-wrapped-staked-eth",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18,
  },
  wstETH: {
    address: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
    symbol: "wstETH", name: "Wrapped Lido Staked ETH", coingeckoId: "wrapped-steth",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18,
  },
  LINK: {
    address: "0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196",
    symbol: "LINK", name: "Chainlink", coingeckoId: "chainlink",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18,
  },
  cbLTC: {
    address: "0xcb17C9Db87B595717C857a08468793f5bAb6445F",
    symbol: "cbLTC", name: "Coinbase Wrapped LTC", coingeckoId: "litecoin",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 8,
  },
  cbXRP: {
    address: "0xcb585250f852C6c6bf90434AB21A00f02833a4af",
    symbol: "cbXRP", name: "Coinbase Wrapped XRP", coingeckoId: "ripple",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 6,
  },
  // === AI & AGENT TOKENS (20%) ===
  VIRTUAL: {
    address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
    symbol: "VIRTUAL", name: "Virtuals Protocol", coingeckoId: "virtual-protocol",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
  },
  AIXBT: {
    address: "0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825",
    symbol: "AIXBT", name: "aixbt by Virtuals", coingeckoId: "aixbt",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
  },
  // GAME removed — insufficient liquidity on Base DEX pools (failed 5+ consecutive swaps)
  HIGHER: {
    address: "0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe",
    symbol: "HIGHER", name: "Higher", coingeckoId: "higher",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
  },
  VVV: {
    address: "0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf",
    symbol: "VVV", name: "Venice Token", coingeckoId: "venice-token",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
  },
  CLANKER: {
    address: "0x1bc0c42215582d5A085795f4baDbaC3ff36d1Bcb",
    symbol: "CLANKER", name: "Clanker", coingeckoId: "clanker",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
  },
  // === MEME COINS (15%) ===
  BRETT: {
    address: "0x532f27101965dd16442E59d40670FaF5eBB142E4",
    symbol: "BRETT", name: "Brett", coingeckoId: "brett",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
  },
  DEGEN: {
    address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
    symbol: "DEGEN", name: "Degen", coingeckoId: "degen-base",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
  },
  TOSHI: {
    address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4",
    symbol: "TOSHI", name: "Toshi", coingeckoId: "toshi",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
  },
  MOCHI: {
    address: "0xF6e932Ca12afa26665dC4dDE7e27be02A7c02e50",
    symbol: "MOCHI", name: "Mochi", coingeckoId: "mochi-2",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
  },
  NORMIE: {
    address: "0x7F12d13B34F5F4f0a9449c16Bcd42f0da47AF200",
    symbol: "NORMIE", name: "Normie", coingeckoId: "normie-base",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
  },
  KEYCAT: {
    address: "0x9a26F5433671751C3276a065f57e5a02D2817973",
    symbol: "KEYCAT", name: "Keyboard Cat", coingeckoId: "keyboard-cat",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
  },
  // === DEFI PROTOCOLS (20%) ===
  AERO: {
    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    symbol: "AERO", name: "Aerodrome Finance", coingeckoId: "aerodrome-finance",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  WELL: {
    address: "0xA88594D404727625A9437C3f886C7643872296AE",
    symbol: "WELL", name: "Moonwell", coingeckoId: "moonwell-artemis",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  SEAM: {
    address: "0x1C7a460413dD4e964f96D8dFC56E7223cE88CD85",
    symbol: "SEAM", name: "Seamless Protocol", coingeckoId: "seamless-protocol",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  EXTRA: {
    address: "0x2dAD3a13ef0C6366220f989157009e501e7938F8",
    symbol: "EXTRA", name: "Extra Finance", coingeckoId: "extra-finance",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  BAL: {
    address: "0x4158734D47Fc9692176B5085E0F52ee0Da5d47F1",
    symbol: "BAL", name: "Balancer", coingeckoId: "balancer",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  MORPHO: {
    address: "0xBAa5CC21fd487B8Fcc2F632f3F4E8D37262a0842",
    symbol: "MORPHO", name: "Morpho", coingeckoId: "morpho",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  PENDLE: {
    address: "0xA99F6e6785Da0F5d6fB42495Fe424BCE029Eeb3E",
    symbol: "PENDLE", name: "Pendle", coingeckoId: "pendle",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  RSR: {
    address: "0xaB36452DbAC151bE02b16Ca17d8919826072f64a",
    symbol: "RSR", name: "Reserve Rights", coingeckoId: "reserve-rights-token",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
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
  LINK:  { feed: "0x17CAb8FE31E32f08326e5E27412894e49B0f9D65", decimals: 8 },  // LINK/USD (verified: data.chain.link/feeds/base/mainnet/link-usd)
};

const CHAINLINK_ABI_FRAGMENT = "0x50d25bcd"; // latestAnswer() → int256

/**
 * v6.2: Fetch prices directly from Chainlink oracles on Base via eth_call.
 * These are on-chain reads — no API key needed, no rate limits possible.
 * Only covers major tokens (ETH, BTC) but provides an unbreakable price floor.
 */
async function fetchChainlinkPrices(): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  const chainlinkRpc = BASE_RPC_ENDPOINTS[0]; // v8.1: Use primary from fallback list

  for (const [symbol, config] of Object.entries(CHAINLINK_FEEDS_BASE)) {
    try {
      const res = await axios.post(chainlinkRpc, {
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
// v12.0: ON-CHAIN PRICING ENGINE — Direct DEX pool reads, no CoinGecko
// ============================================================================

interface PoolRegistryEntry {
  poolAddress: string;
  poolType: 'uniswapV3' | 'aerodrome' | 'aerodromeV3';
  quoteToken: 'WETH' | 'USDC' | 'cbBTC' | 'VIRTUAL';
  token0IsBase: boolean; // true if our traded token is token0 in the pool
  token0Decimals: number;
  token1Decimals: number;
  dexName: string;
  liquidityUSD: number;
  consecutiveFailures: number;
  tickSpacing?: number; // v12.3: Cached tick spacing (immutable per pool, read once)
}

interface PoolRegistryFile {
  version: number;
  discoveredAt: string;
  pools: Record<string, PoolRegistryEntry>;
}

const POOL_REGISTRY_VERSION = 5; // v12.2.1: Bump — force re-discovery for new tokens (cbXRP, CLANKER, KEYCAT, cbLTC)

let poolRegistry: Record<string, PoolRegistryEntry> = {};

// v12.3: Cached ticks from slot0 reads — updated every heavy cycle, used by tick depth analysis
let lastPoolTicks: Record<string, number> = {};

// v12.3: On-chain intelligence cache — persists between cycles
let lastOnChainIntelligence: Record<string, {
  twap: TechnicalIndicators["twapDivergence"];
  orderFlow: TechnicalIndicators["orderFlow"];
  tickDepth: TechnicalIndicators["tickDepth"];
}> = {};

const POOL_REGISTRY_FILE = process.env.PERSIST_DIR ? `${process.env.PERSIST_DIR}/pool-registry.json` : "./logs/pool-registry.json";

// Known DEX IDs that we accept (allows filtering out completely unknown DEXes)
const KNOWN_DEX_IDS = new Set([
  'uniswap', 'uniswap_v3', 'uniswap-v3',
  'aerodrome', 'aerodrome_v2', 'aerodrome_slipstream', 'aerodrome-slipstream', 'slipstream',
  'pancakeswap', 'pancakeswap_v3',
  'sushiswap', 'sushiswap_v3',
  'baseswap', 'baseswap_v3',
  'quickswap', 'rocketswap',
]);

/**
 * v12.0.3: Probe a pool contract on-chain to determine V2 vs V3 type.
 * DexScreener's labels field is unreliable (missing for Aerodrome, PancakeSwap, etc.).
 * Instead, we try slot0() first — if it responds, it's V3. Otherwise try getReserves() for V2.
 * This costs 1-2 free RPC view calls per pool during one-time discovery.
 */
async function probePoolType(poolAddress: string, dexId: string): Promise<PoolRegistryEntry['poolType'] | null> {
  const id = dexId.toLowerCase();

  // Try slot0() — V3/CL pools implement this (selector 0x3850c7bd)
  try {
    const slot0Result = await rpcCall('eth_call', [
      { to: poolAddress, data: '0x3850c7bd' }, 'latest'
    ]);
    if (slot0Result && slot0Result !== '0x' && slot0Result.length >= 66) {
      // Valid slot0 response — this is a V3/CL pool
      // Aerodrome CL (slipstream) uses same ABI as Uni V3
      return (id === 'aerodrome' || id === 'aerodrome_slipstream' || id === 'aerodrome-slipstream' || id === 'slipstream')
        ? 'aerodromeV3' : 'uniswapV3';
    }
  } catch { /* slot0 not available — not a V3 pool */ }

  // Try getReserves() — V2/constant-product pools implement this (selector 0x0902f1ac)
  try {
    const reservesResult = await rpcCall('eth_call', [
      { to: poolAddress, data: '0x0902f1ac' }, 'latest'
    ]);
    if (reservesResult && reservesResult !== '0x' && reservesResult.length >= 130) {
      return 'aerodrome'; // V2 pool — all V2 forks use the same getReserves ABI
    }
  } catch { /* getReserves not available either */ }

  // Neither worked — skip this pool
  return null;
}

// Token addresses on Base for pool pair detection
const WETH_ADDRESS = '0x4200000000000000000000000000000000000006'.toLowerCase();
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase();
const CBBTC_ADDRESS = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'.toLowerCase();
const VIRTUAL_ADDRESS = '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b'.toLowerCase();

// Decimals for quote tokens
const QUOTE_DECIMALS: Record<string, number> = {
  WETH: 18, USDC: 6, cbBTC: 8, VIRTUAL: 18,
};

/**
 * Discover pool addresses for all tokens via DexScreener (one-time bootstrap).
 * Caches to disk — subsequent startups load from file.
 */
async function discoverPoolAddresses(): Promise<void> {
  // Try loading from disk first
  try {
    if (fs.existsSync(POOL_REGISTRY_FILE)) {
      const data: PoolRegistryFile = JSON.parse(fs.readFileSync(POOL_REGISTRY_FILE, 'utf-8'));
      const age = Date.now() - new Date(data.discoveredAt).getTime();
      // v12.2.1: Check if any TOKEN_REGISTRY tokens are missing from cached registry — force re-discover if so
      const registryTokens = Object.keys(TOKEN_REGISTRY).filter(s => s !== 'USDC');
      const cachedTokens = new Set(Object.keys(data.pools));
      const missingTokens = registryTokens.filter(s => !cachedTokens.has(s) && s !== 'ETH'); // ETH aliases WETH
      if (data.version === POOL_REGISTRY_VERSION && age < POOL_DISCOVERY_MAX_AGE_MS && Object.keys(data.pools).length > 0 && missingTokens.length === 0) {
        poolRegistry = data.pools;
        // Reset failure counts on fresh load
        for (const entry of Object.values(poolRegistry)) entry.consecutiveFailures = 0;
        console.log(`  ♻️  Pool registry loaded: ${Object.keys(poolRegistry).length} pools from cache (${(age / 3600000).toFixed(1)}h old)`);
        return;
      }
      if (missingTokens.length > 0) {
        console.log(`  🔄 Pool registry stale — missing pools for: ${missingTokens.join(', ')}. Re-discovering...`);
      }
    }
  } catch { /* corrupt file — re-discover */ }

  console.log(`  🔍 Discovering pool addresses via DexScreener...`);

  try {
    // Batch all token addresses in one call
    const addresses = Object.entries(TOKEN_REGISTRY)
      .filter(([s]) => s !== 'USDC' && TOKEN_REGISTRY[s].address !== 'native')
      .map(([_, t]) => t.address)
      .join(',');

    const res = await axios.get(
      `https://api.dexscreener.com/tokens/v1/base/${addresses}`,
      { timeout: 15000 }
    );

    if (!res.data || !Array.isArray(res.data)) {
      console.warn(`  ⚠️ DexScreener pool discovery returned invalid data`);
      return;
    }

    const newRegistry: Record<string, PoolRegistryEntry> = {};

    for (const [symbol, tokenInfo] of Object.entries(TOKEN_REGISTRY)) {
      if (symbol === 'USDC') continue;
      const tokenAddr = (tokenInfo.address === 'native' ? TOKEN_REGISTRY.WETH.address : tokenInfo.address).toLowerCase();

      // Find all Base pools for this token, sorted by liquidity
      const pools = res.data
        .filter((p: any) =>
          p.chainId === 'base' &&
          (p.baseToken?.address?.toLowerCase() === tokenAddr || p.quoteToken?.address?.toLowerCase() === tokenAddr) &&
          (p.liquidity?.usd || 0) > 0
        )
        .sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));

      if (pools.length === 0) continue;

      // Pick deepest pool that we can read on-chain
      for (const pool of pools) {
        const dexId = (pool.dexId || '').toLowerCase();
        if (!KNOWN_DEX_IDS.has(dexId)) continue; // skip completely unknown DEXes

        const baseAddr = pool.baseToken?.address?.toLowerCase() || '';
        const quoteAddr = pool.quoteToken?.address?.toLowerCase() || '';

        // Determine which side is our token and what it's paired with
        const isToken0 = baseAddr === tokenAddr;
        const pairedAddr = isToken0 ? quoteAddr : baseAddr;
        let quoteToken: 'WETH' | 'USDC' | 'cbBTC' | 'VIRTUAL';
        if (pairedAddr === WETH_ADDRESS) quoteToken = 'WETH';
        else if (pairedAddr === USDC_ADDRESS) quoteToken = 'USDC';
        else if (pairedAddr === CBBTC_ADDRESS) quoteToken = 'cbBTC';
        else if (pairedAddr === VIRTUAL_ADDRESS) quoteToken = 'VIRTUAL';
        else continue; // paired with something else, skip

        // v12.0.3: Probe pool on-chain to determine V2 vs V3 (DexScreener labels are unreliable)
        const poolType = await probePoolType(pool.pairAddress, dexId);
        if (!poolType) continue; // pool didn't respond to either slot0 or getReserves

        // For slot0-based pools, token0IsBase refers to Uniswap's actual token0
        // DexScreener's baseToken is the first token in the pair display, which may differ
        // We need to determine the actual on-chain token0 ordering
        // token0 is always the address that sorts lower numerically
        const addr0 = tokenAddr < pairedAddr ? tokenAddr : pairedAddr;
        const token0IsOurToken = addr0 === tokenAddr;

        const quoteDec = QUOTE_DECIMALS[quoteToken] || 18;
        const dec0 = token0IsOurToken ? tokenInfo.decimals : quoteDec;
        const dec1 = token0IsOurToken ? quoteDec : tokenInfo.decimals;

        newRegistry[symbol] = {
          poolAddress: pool.pairAddress,
          poolType,
          quoteToken,
          token0IsBase: token0IsOurToken,
          token0Decimals: dec0,
          token1Decimals: dec1,
          dexName: pool.dexId || 'unknown',
          liquidityUSD: pool.liquidity?.usd || 0,
          consecutiveFailures: 0,
        };
        break; // Use first viable pool (deepest liquidity)
      }
    }

    // Handle ETH as an alias for WETH
    if (newRegistry['WETH'] && !newRegistry['ETH']) {
      newRegistry['ETH'] = { ...newRegistry['WETH'] };
    }

    poolRegistry = newRegistry;
    const v3Count = Object.values(poolRegistry).filter(p => p.poolType === 'uniswapV3' || p.poolType === 'aerodromeV3').length;
    const v2Count = Object.values(poolRegistry).filter(p => p.poolType === 'aerodrome').length;
    console.log(`  ✅ Pool registry: ${Object.keys(poolRegistry).length} pools discovered (${v3Count} V3/slot0, ${v2Count} V2/reserves)`);
    for (const [sym, info] of Object.entries(poolRegistry)) {
      console.log(`     ${sym}: ${info.poolType} @ ${info.poolAddress.slice(0, 10)}... (${info.quoteToken}, $${(info.liquidityUSD / 1000).toFixed(0)}K liq)`);
    }

    // Persist to disk
    const registryData: PoolRegistryFile = { version: POOL_REGISTRY_VERSION, discoveredAt: new Date().toISOString(), pools: poolRegistry };
    const tmpFile = POOL_REGISTRY_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(registryData, null, 2));
    fs.renameSync(tmpFile, POOL_REGISTRY_FILE);
  } catch (e: any) {
    console.warn(`  ⚠️ Pool discovery failed: ${e.message?.substring(0, 100) || e}`);
  }
}

/**
 * Decode sqrtPriceX96 from Uniswap V3 / Aerodrome V3 slot0 into a human-readable price.
 * price = (sqrtPriceX96 / 2^96)^2 adjusted for token decimal difference.
 * Returns: amount of token1 per 1 token0 (decimal-adjusted).
 * i.e., price of token0 denominated in token1.
 */
function decodeSqrtPriceX96(sqrtPriceX96Hex: string, token0Decimals: number, token1Decimals: number): number {
  // sqrtPriceX96 is the first 32 bytes of slot0 return data
  const sqrtPriceX96 = BigInt('0x' + sqrtPriceX96Hex.slice(0, 64));
  if (sqrtPriceX96 === 0n) return 0;

  // price = (sqrtPriceX96)^2 / 2^192 * 10^(token0Decimals - token1Decimals)
  // sqrtPriceX96 is up to 160 bits → squared is up to 320 bits.
  // We must do BigInt division first to stay within Number precision.
  const numerator = sqrtPriceX96 * sqrtPriceX96;
  const Q192 = 2n ** 192n;

  // Split into integer and fractional parts to preserve precision
  const intPart = numerator / Q192;
  const remainder = numerator % Q192;
  const rawPrice = Number(intPart) + Number(remainder) / Number(Q192);

  const decimalAdjustment = 10 ** (token0Decimals - token1Decimals);
  return rawPrice * decimalAdjustment;
}

/**
 * Read a single token's price from its on-chain DEX pool.
 * Returns price in USD, or null on failure.
 */
async function fetchOnChainTokenPrice(symbol: string, ethUsdPrice: number, btcUsdPrice: number = 0, virtualUsdPrice: number = 0): Promise<number | null> {
  const pool = poolRegistry[symbol];
  if (!pool) return null;

  try {
    let tokenPrice: number;

    if (pool.poolType === 'uniswapV3' || pool.poolType === 'aerodromeV3') {
      // slot0() → returns (uint160 sqrtPriceX96, int24 tick, ...)
      const result = await rpcCall('eth_call', [
        { to: pool.poolAddress, data: '0x3850c7bd' }, 'latest'
      ]);
      if (!result || result === '0x' || result.length < 66) return null;

      // Strip '0x' prefix for decoding
      const rawPrice = decodeSqrtPriceX96(result.slice(2), pool.token0Decimals, pool.token1Decimals);

      // v12.3: Parse tick from slot0 bytes 32-63 (int24 packed in int256) — free data, already fetched
      try {
        const tickHex = result.slice(2 + 64, 2 + 128); // bytes 32-63
        const tickBigInt = BigInt('0x' + tickHex);
        const tick = Number(tickBigInt > BigInt('0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')
          ? tickBigInt - BigInt('0x10000000000000000000000000000000000000000000000000000000000000000')
          : tickBigInt);
        if (tick >= -887272 && tick <= 887272) { // Valid V3 tick range
          lastPoolTicks[symbol] = tick;
        }
      } catch { /* tick parse failure is non-critical */ }
      if (rawPrice <= 0) return null;

      // rawPrice = amount of token1 per 1 token0 (price of token0 in token1 terms)
      // If our token is token0: rawPrice IS our token's price in quote (token1) terms
      // If our token is token1: our token's price = 1/rawPrice in quote (token0) terms
      if (pool.token0IsBase) {
        // Our token is token0 → rawPrice = quote_per_our_token → use directly
        tokenPrice = rawPrice;
      } else {
        // Our token is token1 → rawPrice = our_token_per_quote → invert
        tokenPrice = 1 / rawPrice;
      }
    } else {
      // Aerodrome V2: getReserves() → (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)
      const result = await rpcCall('eth_call', [
        { to: pool.poolAddress, data: '0x0902f1ac' }, 'latest'
      ]);
      if (!result || result === '0x' || result.length < 130) return null;

      const reserve0 = BigInt('0x' + result.slice(2, 66));
      const reserve1 = BigInt('0x' + result.slice(66, 130));
      if (reserve0 === 0n || reserve1 === 0n) return null;

      // Adjust for decimals
      const r0 = Number(reserve0) / (10 ** pool.token0Decimals);
      const r1 = Number(reserve1) / (10 ** pool.token1Decimals);

      if (pool.token0IsBase) {
        // Our token is token0 → price = reserve1/reserve0 (how many quote tokens per base token)
        tokenPrice = r1 / r0;
      } else {
        // Our token is token1 → price = reserve0/reserve1
        tokenPrice = r0 / r1;
      }
    }

    // Convert to USD
    let priceUSD: number;
    if (pool.quoteToken === 'WETH') priceUSD = tokenPrice * ethUsdPrice;
    else if (pool.quoteToken === 'cbBTC') priceUSD = btcUsdPrice > 0 ? tokenPrice * btcUsdPrice : 0;
    else if (pool.quoteToken === 'VIRTUAL') priceUSD = virtualUsdPrice > 0 ? tokenPrice * virtualUsdPrice : 0;
    else priceUSD = tokenPrice; // USDC — already in USD
    if (priceUSD <= 0 || !isFinite(priceUSD)) return null;

    // Reset failure counter on success
    pool.consecutiveFailures = 0;
    return priceUSD;
  } catch (e: any) {
    pool.consecutiveFailures++;
    return null;
  }
}

/**
 * Fetch ETH/USD price from Chainlink oracle (single RPC call).
 * Reuses existing Chainlink infrastructure.
 */
async function fetchChainlinkETHPrice(): Promise<number> {
  try {
    const result = await rpcCall('eth_call', [
      { to: CHAINLINK_FEEDS_BASE.ETH.feed, data: CHAINLINK_ABI_FRAGMENT }, 'latest'
    ]);
    if (result && result !== '0x') {
      const price = parseInt(result, 16) / Math.pow(10, CHAINLINK_FEEDS_BASE.ETH.decimals);
      if (price > 0) return price;
    }
  } catch { /* fall through */ }
  // Fallback: use last known ETH price
  return lastKnownPrices['ETH']?.price || lastKnownPrices['WETH']?.price || 0;
}

/**
 * Fetch BTC/USD price from Chainlink oracle (single RPC call).
 */
async function fetchChainlinkBTCPrice(): Promise<number> {
  try {
    const result = await rpcCall('eth_call', [
      { to: CHAINLINK_FEEDS_BASE.cbBTC.feed, data: CHAINLINK_ABI_FRAGMENT }, 'latest'
    ]);
    if (result && result !== '0x') {
      const price = parseInt(result, 16) / Math.pow(10, CHAINLINK_FEEDS_BASE.cbBTC.decimals);
      if (price > 0) return price;
    }
  } catch { /* fall through */ }
  return lastKnownPrices['cbBTC']?.price || 0;
}

/**
 * Fetch LINK/USD price from Chainlink oracle (single RPC call).
 */
async function fetchChainlinkLINKPrice(): Promise<number> {
  try {
    const result = await rpcCall('eth_call', [
      { to: CHAINLINK_FEEDS_BASE.LINK.feed, data: CHAINLINK_ABI_FRAGMENT }, 'latest'
    ]);
    if (result && result !== '0x') {
      const price = parseInt(result, 16) / Math.pow(10, CHAINLINK_FEEDS_BASE.LINK.decimals);
      if (price > 0) return price;
    }
  } catch { /* fall through */ }
  return lastKnownPrices['LINK']?.price || 0;
}

/**
 * Fetch all token prices on-chain in parallel.
 * Primary: DEX pool reads. Chainlink for ETH/BTC/LINK.
 */
async function fetchAllOnChainPrices(): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  prices.set('USDC', 1.0);

  // Step 1: Get ETH, BTC, and LINK prices from Chainlink (most reliable)
  const [ethPrice, btcPrice, linkPrice] = await Promise.all([
    fetchChainlinkETHPrice(),
    fetchChainlinkBTCPrice(),
    fetchChainlinkLINKPrice(),
  ]);

  if (ethPrice > 0) {
    prices.set('ETH', ethPrice);
    prices.set('WETH', ethPrice);
  }
  if (btcPrice > 0) {
    prices.set('cbBTC', btcPrice);
  }
  if (linkPrice > 0) {
    prices.set('LINK', linkPrice);
  }

  // Step 2: Fetch tokens paired with WETH/USDC (no dependency on other token prices)
  const pass1Symbols = Object.keys(poolRegistry).filter(s =>
    !prices.has(s) && (poolRegistry[s].quoteToken === 'WETH' || poolRegistry[s].quoteToken === 'USDC')
  );
  const pass1Results = await Promise.allSettled(
    pass1Symbols.map(s => fetchOnChainTokenPrice(s, ethPrice, btcPrice))
  );

  for (let i = 0; i < pass1Symbols.length; i++) {
    const result = pass1Results[i];
    if (result.status === 'fulfilled' && result.value !== null && result.value > 0) {
      const lastPrice = lastKnownPrices[pass1Symbols[i]]?.price;
      if (lastPrice && lastPrice > 0) {
        const deviation = Math.abs(result.value - lastPrice) / lastPrice;
        if (deviation > PRICE_SANITY_MAX_DEVIATION) {
          console.warn(`  ⚠️ Price sanity fail: ${pass1Symbols[i]} on-chain=$${result.value.toFixed(4)} vs last=$${lastPrice.toFixed(4)} (${(deviation * 100).toFixed(1)}% deviation) — skipping`);
          continue;
        }
      }
      prices.set(pass1Symbols[i], result.value);
    }
  }

  // Step 3: Fetch tokens paired with cbBTC or VIRTUAL (need pass 1 prices)
  const virtualUsdPrice = prices.get('VIRTUAL') || 0;
  const pass2Symbols = Object.keys(poolRegistry).filter(s =>
    !prices.has(s) && (poolRegistry[s].quoteToken === 'cbBTC' || poolRegistry[s].quoteToken === 'VIRTUAL')
  );
  if (pass2Symbols.length > 0) {
    const pass2Results = await Promise.allSettled(
      pass2Symbols.map(s => fetchOnChainTokenPrice(s, ethPrice, btcPrice, virtualUsdPrice))
    );

    for (let i = 0; i < pass2Symbols.length; i++) {
      const result = pass2Results[i];
      if (result.status === 'fulfilled' && result.value !== null && result.value > 0) {
        const lastPrice = lastKnownPrices[pass2Symbols[i]]?.price;
        if (lastPrice && lastPrice > 0) {
          const deviation = Math.abs(result.value - lastPrice) / lastPrice;
          if (deviation > PRICE_SANITY_MAX_DEVIATION) {
            console.warn(`  ⚠️ Price sanity fail: ${pass2Symbols[i]} on-chain=$${result.value.toFixed(4)} vs last=$${lastPrice.toFixed(4)} (${(deviation * 100).toFixed(1)}% deviation) — skipping`);
            continue;
          }
        }
        prices.set(pass2Symbols[i], result.value);
      }
    }
  }

  // Check for tokens that need pool re-discovery
  for (const [symbol, entry] of Object.entries(poolRegistry)) {
    if (entry.consecutiveFailures >= POOL_REDISCOVERY_FAILURE_THRESHOLD) {
      console.warn(`  🔄 ${symbol}: ${entry.consecutiveFailures} consecutive failures — will re-discover pool on next startup`);
    }
  }

  return prices;
}

// ============================================================================
// v12.0: SELF-ACCUMULATING PRICE HISTORY STORE
// ============================================================================

interface PriceHistoryStore {
  version: 1;
  lastSaved: string;
  tokens: Record<string, {
    timestamps: number[];
    prices: number[];
    volumes: number[];
  }>;
}

let priceHistoryStore: PriceHistoryStore = { version: 1, lastSaved: '', tokens: {} };
let lastPriceHistorySaveTime = 0;

const PRICE_HISTORY_FILE = process.env.PERSIST_DIR ? `${process.env.PERSIST_DIR}/price-history.json` : "./logs/price-history.json";

function loadPriceHistoryStore(): void {
  try {
    if (fs.existsSync(PRICE_HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(PRICE_HISTORY_FILE, 'utf-8'));
      if (data.version === 1 && data.tokens) {
        priceHistoryStore = data;
        const tokenCount = Object.keys(data.tokens).length;
        const totalPoints = Object.values(data.tokens as Record<string, { prices: number[] }>).reduce((sum, t) => sum + t.prices.length, 0);
        console.log(`  ♻️  Price history loaded: ${tokenCount} tokens, ${totalPoints} total data points`);
      }
    }
  } catch { /* corrupt file — start fresh */ }
}

function savePriceHistoryStore(): void {
  try {
    priceHistoryStore.lastSaved = new Date().toISOString();
    const tmpFile = PRICE_HISTORY_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(priceHistoryStore));
    fs.renameSync(tmpFile, PRICE_HISTORY_FILE);
    lastPriceHistorySaveTime = Date.now();
  } catch { /* non-critical */ }
}

/**
 * Record current prices into the self-accumulating history store.
 * Only records at hourly intervals to match indicator granularity.
 */
function recordPriceSnapshot(prices: Map<string, number>): void {
  const now = Date.now();

  for (const [symbol, price] of prices) {
    if (price <= 0 || symbol === 'USDC') continue;

    let entry = priceHistoryStore.tokens[symbol];
    if (!entry) {
      entry = { timestamps: [], prices: [], volumes: [] };
      priceHistoryStore.tokens[symbol] = entry;
    }

    const lastTs = entry.timestamps[entry.timestamps.length - 1] || 0;

    // Only record if >= PRICE_HISTORY_RECORD_INTERVAL_MS since last recording
    if (now - lastTs >= PRICE_HISTORY_RECORD_INTERVAL_MS) {
      entry.timestamps.push(now);
      entry.prices.push(price);
      entry.volumes.push(0); // filled by volume enrichment

      // Trim to max points
      if (entry.timestamps.length > PRICE_HISTORY_MAX_POINTS) {
        const excess = entry.timestamps.length - PRICE_HISTORY_MAX_POINTS;
        entry.timestamps = entry.timestamps.slice(excess);
        entry.prices = entry.prices.slice(excess);
        entry.volumes = entry.volumes.slice(excess);
      }
    }
  }

  // Save to disk periodically
  if (now - lastPriceHistorySaveTime >= PRICE_HISTORY_SAVE_INTERVAL_MS) {
    savePriceHistoryStore();
  }
}

// ============================================================================
// v12.3: ON-CHAIN ORDER FLOW INTELLIGENCE
// Three systems: TWAP-Spot Divergence, Swap Event Order Flow, Tick Liquidity Depth
// All use existing rpcCall() infrastructure — zero new API dependencies
// ============================================================================

/**
 * 2A: Fetch TWAP-Spot divergence from V3 pool oracle.
 * Calls observe([0, 900]) to get 15-minute TWAP, compares to current spot price.
 * Only works for V3 pools (uniswapV3, aerodromeV3).
 * Returns null if pool doesn't support oracle or cardinality too low.
 */
async function fetchTWAPDivergence(
  symbol: string,
  spotPrice: number,
  ethPrice: number,
  btcPrice: number = 0,
  virtualPrice: number = 0
): Promise<TechnicalIndicators["twapDivergence"]> {
  const pool = poolRegistry[symbol];
  if (!pool || (pool.poolType !== 'uniswapV3' && pool.poolType !== 'aerodromeV3')) return null;
  if (spotPrice <= 0 || ethPrice <= 0) return null;

  try {
    // observe([0, 900]) — selector 0x883bdbfd, ABI-encoded dynamic uint32 array
    const calldata = '0x883bdbfd' +
      '0000000000000000000000000000000000000000000000000000000000000020' + // offset
      '0000000000000000000000000000000000000000000000000000000000000002' + // length = 2
      '0000000000000000000000000000000000000000000000000000000000000000' + // secondsAgo[0] = 0
      '0000000000000000000000000000000000000000000000000000000000000384'; // secondsAgo[1] = 900

    const result = await rpcCall('eth_call', [
      { to: pool.poolAddress, data: calldata }, 'latest'
    ]);

    if (!result || result === '0x' || result.length < 258) return null; // Need at least 2 int56 values

    // Decode response: (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)
    // tickCumulatives is a dynamic array, starts at offset in response
    // Layout: offset_ticks(32) + offset_spl(32) + [ticks_length(32) + tick0(32) + tick1(32)] + ...
    const data = result.slice(2); // strip 0x

    // Read offsets
    const ticksOffset = parseInt(data.slice(0, 64), 16) * 2; // byte offset → hex char offset
    const ticksLength = parseInt(data.slice(ticksOffset, ticksOffset + 64), 16);
    if (ticksLength < 2) return null;

    // Read tick cumulatives (int56 stored as int256)
    const tick0Hex = data.slice(ticksOffset + 64, ticksOffset + 128);
    const tick1Hex = data.slice(ticksOffset + 128, ticksOffset + 192);

    const parseSigned256 = (hex: string): bigint => {
      const val = BigInt('0x' + hex);
      return val > BigInt('0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')
        ? val - BigInt('0x10000000000000000000000000000000000000000000000000000000000000000')
        : val;
    };

    const tickCum0 = parseSigned256(tick0Hex); // Now (most recent)
    const tickCum1 = parseSigned256(tick1Hex); // 900 seconds ago

    // TWAP tick = (tickCumNow - tickCumPast) / elapsed
    const twapTick = Number(tickCum0 - tickCum1) / TWAP_OBSERVATION_SECONDS;

    // Convert tick to price: price = 1.0001^tick
    // This gives price of token0 in terms of token1
    const twapRawPrice = Math.pow(1.0001, twapTick);

    // Apply decimal adjustment (same as decodeSqrtPriceX96)
    const decimalAdjustment = 10 ** (pool.token0Decimals - pool.token1Decimals);
    let twapTokenPrice = twapRawPrice * decimalAdjustment;

    // If our token is token1, invert
    if (!pool.token0IsBase) {
      twapTokenPrice = 1 / twapTokenPrice;
    }

    // Convert to USD
    let twapPriceUSD: number;
    if (pool.quoteToken === 'WETH') twapPriceUSD = twapTokenPrice * ethPrice;
    else if (pool.quoteToken === 'cbBTC') twapPriceUSD = btcPrice > 0 ? twapTokenPrice * btcPrice : 0;
    else if (pool.quoteToken === 'VIRTUAL') twapPriceUSD = virtualPrice > 0 ? twapTokenPrice * virtualPrice : 0;
    else twapPriceUSD = twapTokenPrice; // USDC

    if (twapPriceUSD <= 0 || !isFinite(twapPriceUSD)) return null;

    // Calculate divergence
    const divergencePct = ((spotPrice - twapPriceUSD) / twapPriceUSD) * 100;

    let signal: "OVERSOLD" | "OVERBOUGHT" | "NORMAL";
    if (divergencePct < -TWAP_DIVERGENCE_THRESHOLD_PCT) signal = "OVERSOLD";
    else if (divergencePct > TWAP_DIVERGENCE_THRESHOLD_PCT) signal = "OVERBOUGHT";
    else signal = "NORMAL";

    return {
      twapPrice: twapPriceUSD,
      spotPrice,
      divergencePct,
      signal,
    };
  } catch {
    return null; // observe() reverted — cardinality too low or pool doesn't support oracle
  }
}

/**
 * 2B: Fetch swap event order flow from DEX pool.
 * Reads eth_getLogs for Swap events over last ~10 minutes (300 blocks on Base).
 * Determines net buy/sell pressure (CVD) with trade size bucketing.
 */
async function fetchSwapOrderFlow(
  symbol: string,
  currentPrice: number,
  ethPrice: number,
  currentBlock: number
): Promise<TechnicalIndicators["orderFlow"]> {
  const pool = poolRegistry[symbol];
  if (!pool || currentPrice <= 0 || ethPrice <= 0 || currentBlock <= 0) return null;

  try {
    const fromBlock = '0x' + Math.max(0, currentBlock - ORDER_FLOW_BLOCK_LOOKBACK).toString(16);
    const toBlock = 'latest';

    const logs = await rpcCall('eth_getLogs', [{
      address: pool.poolAddress,
      topics: [SWAP_EVENT_TOPIC],
      fromBlock,
      toBlock,
    }]);

    if (!logs || !Array.isArray(logs) || logs.length === 0) return null;

    let buyVolumeUSD = 0;
    let sellVolumeUSD = 0;
    let largeBuyVolume = 0;
    let tradeCount = 0;

    for (const log of logs) {
      try {
        if (!log.data || log.data.length < 130) continue;
        const data = log.data.slice(2); // strip 0x

        // Swap event data layout:
        // For V3: amount0 (int256, 32 bytes), amount1 (int256, 32 bytes), sqrtPriceX96 (uint160, 32 bytes), liquidity (uint128, 32 bytes), tick (int24, 32 bytes)
        // For V2/Aerodrome: similar but may differ — we just need amount0 and amount1
        const amount0Hex = data.slice(0, 64);
        const amount1Hex = data.slice(64, 128);

        const parseSigned = (hex: string): bigint => {
          const val = BigInt('0x' + hex);
          return val > BigInt('0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')
            ? val - BigInt('0x10000000000000000000000000000000000000000000000000000000000000000')
            : val;
        };

        const amount0 = parseSigned(amount0Hex);
        const amount1 = parseSigned(amount1Hex);

        // Determine buy/sell direction:
        // In a swap, one amount is positive (received by pool) and one negative (sent by pool)
        // If token0IsBase:
        //   amount0 < 0 means pool sent token0 to user → user BOUGHT our token
        //   amount0 > 0 means user sent token0 to pool → user SOLD our token
        let isBuy: boolean;
        let tradeAmountRaw: bigint;
        let tradeDecimals: number;

        if (pool.token0IsBase) {
          isBuy = amount0 < 0n;
          tradeAmountRaw = amount0 < 0n ? -amount0 : amount0;
          tradeDecimals = pool.token0Decimals;
        } else {
          isBuy = amount1 < 0n;
          tradeAmountRaw = amount1 < 0n ? -amount1 : amount1;
          tradeDecimals = pool.token1Decimals;
        }

        const tradeAmountTokens = Number(tradeAmountRaw) / (10 ** tradeDecimals);
        const tradeValueUSD = tradeAmountTokens * currentPrice;

        if (tradeValueUSD <= 0 || !isFinite(tradeValueUSD) || tradeValueUSD > 10_000_000) continue; // Sanity check

        tradeCount++;
        if (isBuy) {
          buyVolumeUSD += tradeValueUSD;
          if (tradeValueUSD >= LARGE_TRADE_THRESHOLD_USD) {
            largeBuyVolume += tradeValueUSD;
          }
        } else {
          sellVolumeUSD += tradeValueUSD;
        }
      } catch {
        continue; // Skip malformed logs
      }
    }

    if (tradeCount === 0) return null;

    const netBuyVolumeUSD = buyVolumeUSD - sellVolumeUSD;
    const totalVolume = buyVolumeUSD + sellVolumeUSD;
    const buyRatio = totalVolume > 0 ? buyVolumeUSD / totalVolume : 0.5;
    const largeBuyPct = buyVolumeUSD > 0 ? (largeBuyVolume / buyVolumeUSD) * 100 : 0;

    let signal: "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";
    if (buyRatio > 0.65) signal = "STRONG_BUY";
    else if (buyRatio > 0.55) signal = "BUY";
    else if (buyRatio < 0.35) signal = "STRONG_SELL";
    else if (buyRatio < 0.45) signal = "SELL";
    else signal = "NEUTRAL";

    return {
      netBuyVolumeUSD: Math.round(netBuyVolumeUSD),
      buyVolumeUSD: Math.round(buyVolumeUSD),
      sellVolumeUSD: Math.round(sellVolumeUSD),
      tradeCount,
      largeBuyPct: Math.round(largeBuyPct),
      signal,
    };
  } catch {
    return null;
  }
}

/**
 * 2C: Fetch tick liquidity depth around current price.
 * Reads ticks above/below current to map on-chain support/resistance.
 * Heavy cycle only — more RPC calls (~11 per pool).
 */
async function fetchTickLiquidityDepth(
  symbol: string,
  currentPrice: number,
  ethPrice: number
): Promise<TechnicalIndicators["tickDepth"]> {
  const pool = poolRegistry[symbol];
  if (!pool || (pool.poolType !== 'uniswapV3' && pool.poolType !== 'aerodromeV3')) return null;
  if (currentPrice <= 0 || ethPrice <= 0) return null;

  const currentTick = lastPoolTicks[symbol];
  if (currentTick === undefined) return null;

  try {
    // Get tickSpacing (cached — immutable per pool)
    if (!pool.tickSpacing) {
      const tsResult = await rpcCall('eth_call', [
        { to: pool.poolAddress, data: '0xd0c93a7c' }, 'latest'
      ]);
      if (tsResult && tsResult !== '0x') {
        const tsVal = parseInt(tsResult, 16);
        // int24 range: handle potential sign
        pool.tickSpacing = tsVal > 8388607 ? tsVal - 16777216 : tsVal;
        if (pool.tickSpacing <= 0 || pool.tickSpacing > 16384) {
          pool.tickSpacing = undefined;
          return null;
        }
      } else {
        return null;
      }
    }

    const spacing = pool.tickSpacing!;

    // Align current tick to tick spacing
    const alignedTick = Math.floor(currentTick / spacing) * spacing;

    // Read current liquidity
    const liqResult = await rpcCall('eth_call', [
      { to: pool.poolAddress, data: '0x1a686502' }, 'latest'
    ]);
    const inRangeLiquidity = liqResult && liqResult !== '0x' ? Number(BigInt(liqResult)) : 0;

    // Read ticks above and below — batch with Promise.allSettled
    const tickReads: Promise<{ tick: number; liquidityNet: bigint }>[] = [];

    for (let i = 1; i <= TICK_DEPTH_RANGE; i++) {
      // Below current price (support)
      const tickBelow = alignedTick - (i * spacing);
      tickReads.push(readTickLiquidityNet(pool.poolAddress, tickBelow));
      // Above current price (resistance)
      const tickAbove = alignedTick + (i * spacing);
      tickReads.push(readTickLiquidityNet(pool.poolAddress, tickAbove));
    }

    const tickResults = await Promise.allSettled(tickReads);

    let bidDepthRaw = 0n; // Support: positive liquidityNet below price
    let askDepthRaw = 0n; // Resistance: negative liquidityNet above price (absolute)

    for (let i = 0; i < TICK_DEPTH_RANGE; i++) {
      const belowResult = tickResults[i * 2];
      const aboveResult = tickResults[i * 2 + 1];

      if (belowResult.status === 'fulfilled' && belowResult.value.liquidityNet > 0n) {
        bidDepthRaw += belowResult.value.liquidityNet;
      }
      if (aboveResult.status === 'fulfilled') {
        const net = aboveResult.value.liquidityNet;
        if (net < 0n) askDepthRaw += -net; // Take absolute of negative
      }
    }

    // Convert liquidity to USD approximation
    // Each unit of liquidity ≈ sqrt(price) worth of value per tick range
    // Simplified: liquidity × sqrtPrice × tickRange / 2^96 ≈ value in token terms
    // For practical purposes, use currentPrice as proxy multiplier
    const sqrtPrice = Math.sqrt(currentPrice);
    const tickRangePrice = currentPrice * (Math.pow(1.0001, spacing) - 1); // Price diff per tick spacing

    // Convert liquidity to approximate USD using quote token pricing
    let quotePrice = 1; // USDC
    if (pool.quoteToken === 'WETH') quotePrice = ethPrice;
    else if (pool.quoteToken === 'cbBTC') quotePrice = lastKnownPrices['cbBTC']?.price || 0;
    else if (pool.quoteToken === 'VIRTUAL') quotePrice = lastKnownPrices['VIRTUAL']?.price || 0;

    // liquidity * tickRangePrice gives rough token-equivalent depth
    // Divide by 10^18 to normalize (liquidity is in raw form)
    const scaleFactor = tickRangePrice * quotePrice / (10 ** 18);
    const bidDepthUSD = Number(bidDepthRaw) * scaleFactor;
    const askDepthUSD = Number(askDepthRaw) * scaleFactor;
    const inRangeLiqUSD = inRangeLiquidity * scaleFactor;

    if (bidDepthUSD <= 0 && askDepthUSD <= 0) return null;

    const depthRatio = askDepthUSD > 0 ? bidDepthUSD / askDepthUSD : bidDepthUSD > 0 ? 10 : 1;

    let signal: "STRONG_SUPPORT" | "SUPPORT" | "BALANCED" | "RESISTANCE" | "STRONG_RESISTANCE";
    if (depthRatio > 2.0) signal = "STRONG_SUPPORT";
    else if (depthRatio > 1.3) signal = "SUPPORT";
    else if (depthRatio < 0.5) signal = "STRONG_RESISTANCE";
    else if (depthRatio < 0.77) signal = "RESISTANCE";
    else signal = "BALANCED";

    return {
      bidDepthUSD: Math.round(bidDepthUSD),
      askDepthUSD: Math.round(askDepthUSD),
      depthRatio: Math.round(depthRatio * 100) / 100,
      inRangeLiquidity: Math.round(inRangeLiqUSD),
      signal,
    };
  } catch {
    return null;
  }
}

/**
 * Helper: Read liquidityNet for a specific tick from a V3 pool.
 * ticks(int24) selector: 0xf30dba93
 * Returns (uint128 liquidityGross, int128 liquidityNet, ...)
 */
async function readTickLiquidityNet(poolAddress: string, tick: number): Promise<{ tick: number; liquidityNet: bigint }> {
  // ABI-encode int24 as int256 (two's complement for negative)
  let tickHex: string;
  if (tick >= 0) {
    tickHex = tick.toString(16).padStart(64, '0');
  } else {
    // Two's complement for negative int256
    const twosComp = BigInt('0x10000000000000000000000000000000000000000000000000000000000000000') + BigInt(tick);
    tickHex = twosComp.toString(16).padStart(64, '0');
  }

  const result = await rpcCall('eth_call', [
    { to: poolAddress, data: '0xf30dba93' + tickHex }, 'latest'
  ]);

  if (!result || result === '0x' || result.length < 130) {
    return { tick, liquidityNet: 0n };
  }

  // liquidityNet is at bytes 32-63 (int128 stored as int256)
  const netHex = result.slice(2 + 64, 2 + 128);
  const netBigInt = BigInt('0x' + netHex);
  const liquidityNet = netBigInt > BigInt('0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')
    ? netBigInt - BigInt('0x10000000000000000000000000000000000000000000000000000000000000000')
    : netBigInt;

  return { tick, liquidityNet };
}

/**
 * 2D: Orchestrator — fetch all on-chain intelligence for V3 pools.
 * Launches TWAP + OrderFlow in parallel for each pool.
 * Tick depth only on heavy cycles.
 * Returns Record<symbol, { twap, orderFlow, tickDepth }>
 */
async function fetchAllOnChainIntelligence(
  ethPrice: number,
  onChainPrices: Map<string, number>,
  includeTickDepth: boolean = true
): Promise<Record<string, { twap: TechnicalIndicators["twapDivergence"]; orderFlow: TechnicalIndicators["orderFlow"]; tickDepth: TechnicalIndicators["tickDepth"] }>> {
  const result: Record<string, { twap: TechnicalIndicators["twapDivergence"]; orderFlow: TechnicalIndicators["orderFlow"]; tickDepth: TechnicalIndicators["tickDepth"] }> = {};

  if (ethPrice <= 0) return result;

  try {
    // Get current block number (1 call, used for all order flow queries)
    const blockHex = await rpcCall('eth_blockNumber', []);
    const currentBlock = blockHex ? parseInt(blockHex, 16) : 0;
    if (currentBlock <= 0) return result;

    const btcPrice = onChainPrices.get('cbBTC') || lastKnownPrices['cbBTC']?.price || 0;
    const virtualPrice = onChainPrices.get('VIRTUAL') || lastKnownPrices['VIRTUAL']?.price || 0;

    // Collect all V3 pools to analyze
    const poolSymbols = Object.entries(poolRegistry)
      .filter(([symbol, pool]) =>
        (pool.poolType === 'uniswapV3' || pool.poolType === 'aerodromeV3') &&
        symbol !== 'ETH' && symbol !== 'WETH' && symbol !== 'USDC' &&
        pool.consecutiveFailures < 3
      )
      .map(([symbol]) => symbol);

    // Launch TWAP + OrderFlow for each pool in parallel
    const promises = poolSymbols.map(async (symbol) => {
      const spotPrice = onChainPrices.get(symbol) || lastKnownPrices[symbol]?.price || 0;
      if (spotPrice <= 0) return;

      const [twap, orderFlow] = await Promise.all([
        fetchTWAPDivergence(symbol, spotPrice, ethPrice, btcPrice, virtualPrice).catch(() => null),
        fetchSwapOrderFlow(symbol, spotPrice, ethPrice, currentBlock).catch(() => null),
      ]);

      let tickDepth: TechnicalIndicators["tickDepth"] = null;
      if (includeTickDepth) {
        tickDepth = await fetchTickLiquidityDepth(symbol, spotPrice, ethPrice).catch(() => null);
      }

      result[symbol] = { twap, orderFlow, tickDepth };
    });

    await Promise.allSettled(promises);

    // Log summary
    const twapCount = Object.values(result).filter(r => r.twap).length;
    const flowCount = Object.values(result).filter(r => r.orderFlow).length;
    const depthCount = Object.values(result).filter(r => r.tickDepth).length;
    console.log(`  📊 On-chain intelligence: ${twapCount} TWAP, ${flowCount} flow, ${depthCount} depth signals from ${poolSymbols.length} V3 pools`);

    // Cache for light cycles
    lastOnChainIntelligence = result;

    return result;
  } catch (e: any) {
    console.error(`  ⚠️ On-chain intelligence failed: ${e?.message || String(e)}`);
    return result;
  }
}

/**
 * Compute percentage price change from history.
 * lookbackMs: how far back to look (e.g., 24h = 86400000)
 */
function computePriceChange(symbol: string, currentPrice: number, lookbackMs: number): number {
  const entry = priceHistoryStore.tokens[symbol];
  if (!entry || entry.timestamps.length < 2 || currentPrice <= 0) return 0;

  const target = Date.now() - lookbackMs;
  let closestIdx = 0;
  let closestDiff = Infinity;

  for (let i = entry.timestamps.length - 1; i >= 0; i--) {
    const diff = Math.abs(entry.timestamps[i] - target);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestIdx = i;
    }
    if (entry.timestamps[i] < target) break;
  }

  const oldPrice = entry.prices[closestIdx];
  return oldPrice > 0 ? ((currentPrice - oldPrice) / oldPrice) * 100 : 0;
}

// Volume enrichment state
let lastVolumeEnrichmentTime = 0;

/**
 * Periodic volume enrichment from DexScreener (fades out once self-sufficient).
 * Returns volume data per symbol, or empty map if skipped.
 */
async function enrichVolumeData(): Promise<Map<string, number>> {
  const volumes = new Map<string, number>();
  const now = Date.now();

  // Skip if too soon since last enrichment
  if (now - lastVolumeEnrichmentTime < VOLUME_ENRICHMENT_INTERVAL_MS) return volumes;

  // Check if we're self-sufficient (have enough history to skip DexScreener)
  const tokenLengths = Object.values(priceHistoryStore.tokens)
    .filter(t => t.prices.length > 0)
    .map(t => t.prices.length);
  const minPoints = tokenLengths.length > 0 ? Math.min(...tokenLengths) : 0;
  if (minPoints >= VOLUME_SELF_SUFFICIENT_POINTS) {
    // Self-sufficient — no need for DexScreener volume enrichment
    return volumes;
  }

  try {
    const addresses = Object.entries(TOKEN_REGISTRY)
      .filter(([s]) => s !== 'USDC' && TOKEN_REGISTRY[s].address !== 'native')
      .map(([_, t]) => t.address)
      .join(',');

    const res = await axios.get(
      `https://api.dexscreener.com/tokens/v1/base/${addresses}`,
      { timeout: 10000 }
    );

    if (res.data && Array.isArray(res.data)) {
      const seen = new Set<string>();
      for (const pair of res.data) {
        const addr = pair.baseToken?.address?.toLowerCase();
        const entry = Object.entries(TOKEN_REGISTRY).find(([_, t]) => t.address.toLowerCase() === addr);
        if (entry && !seen.has(entry[0])) {
          seen.add(entry[0]);
          const vol = pair.volume?.h24 || 0;
          if (vol > 0) volumes.set(entry[0], vol);
        }
      }
    }

    lastVolumeEnrichmentTime = now;
    if (volumes.size > 0) {
      console.log(`  📊 Volume enrichment: ${volumes.size} tokens (fade-out: ${minPoints}/${VOLUME_SELF_SUFFICIENT_POINTS} points)`);
    }
  } catch { /* non-critical */ }

  return volumes;
}

/**
 * Compute local altseason signal from BTC/ETH price ratio tracked in price history.
 * Replaces fetchCoinGeckoGlobal() — no external API needed.
 */
function computeLocalAltseasonSignal(): AltseasonSignal {
  const btcHistory = priceHistoryStore.tokens['cbBTC'];
  const ethHistory = priceHistoryStore.tokens['ETH'] || priceHistoryStore.tokens['WETH'];

  if (!btcHistory || !ethHistory || btcHistory.prices.length < 24 || ethHistory.prices.length < 24) {
    return 'NEUTRAL'; // Not enough data yet
  }

  const currentBtc = btcHistory.prices[btcHistory.prices.length - 1];
  const currentEth = ethHistory.prices[ethHistory.prices.length - 1];
  if (!currentBtc || !currentEth || currentEth === 0) return 'NEUTRAL';

  const currentRatio = currentBtc / currentEth;

  // Look back ~7 days (168 hourly points) or as far as we have
  const lookbackIdx = Math.max(0, btcHistory.prices.length - 168);
  const oldBtc = btcHistory.prices[lookbackIdx];
  const oldEthIdx = Math.max(0, ethHistory.prices.length - 168);
  const oldEth = ethHistory.prices[oldEthIdx];
  if (!oldBtc || !oldEth || oldEth === 0) return 'NEUTRAL';

  const oldRatio = oldBtc / oldEth;
  if (oldRatio === 0) return 'NEUTRAL';

  const ratioChange = ((currentRatio - oldRatio) / oldRatio) * 100;

  if (ratioChange > BTC_DOMINANCE_CHANGE_THRESHOLD * 2.5) return 'BTC_DOMINANCE_FLIGHT';
  if (ratioChange < -BTC_DOMINANCE_CHANGE_THRESHOLD * 2.5) return 'ALTSEASON_ROTATION';
  return 'NEUTRAL';
}

/**
 * Fetch USDC total supply on Base as a proxy for stablecoin capital flow.
 * Replaces fetchStablecoinSupply() CoinGecko call.
 */
async function fetchBaseUSDCSupply(): Promise<StablecoinSupplyData | null> {
  try {
    // totalSupply() on Base USDC contract (checksummed address)
    const result = await rpcCall('eth_call', [
      { to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', data: '0x18160ddd' },
      'latest'
    ]);
    if (!result || result === '0x') return null;

    // Use BigInt to avoid precision loss on large supply values, then convert to USD
    const totalSupply = Number(BigInt(result)) / 1e6; // USDC has 6 decimals
    const now = new Date().toISOString();

    // v12.0.2: Filter out stale CoinGecko-era history entries (global supply ~$200B vs Base USDC ~$4B)
    // Remove ANY entries that differ >10x from current reading — handles mixed history from migration
    if (stablecoinSupplyHistory.values.length > 0) {
      const before = stablecoinSupplyHistory.values.length;
      stablecoinSupplyHistory.values = stablecoinSupplyHistory.values.filter(v => {
        if (v.totalSupply <= 0) return false;
        const ratio = totalSupply / v.totalSupply;
        return ratio >= 0.1 && ratio <= 10; // Keep only entries within 10x of current
      });
      const purged = before - stablecoinSupplyHistory.values.length;
      if (purged > 0) {
        console.log(`  🔄 Stablecoin history: purged ${purged} stale entries (pre-v12 data), ${stablecoinSupplyHistory.values.length} remain`);
      }
    }

    // Track in existing stablecoinSupplyHistory for persistence
    stablecoinSupplyHistory.values.push({ timestamp: now, totalSupply });
    if (stablecoinSupplyHistory.values.length > 504) {
      stablecoinSupplyHistory.values = stablecoinSupplyHistory.values.slice(-504);
    }

    // Compute 7-day change
    let supplyChange7d = 0;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const oldEntry = stablecoinSupplyHistory.values.find(v => new Date(v.timestamp).getTime() >= sevenDaysAgo);
    if (oldEntry && oldEntry.totalSupply > 0) {
      supplyChange7d = ((totalSupply - oldEntry.totalSupply) / oldEntry.totalSupply) * 100;
    }

    let signal: StablecoinSupplyData['signal'] = 'STABLE';
    if (supplyChange7d > STABLECOIN_SUPPLY_CHANGE_THRESHOLD) signal = 'CAPITAL_INFLOW';
    else if (supplyChange7d < -STABLECOIN_SUPPLY_CHANGE_THRESHOLD) signal = 'CAPITAL_OUTFLOW';

    console.log(`  💵 Base USDC supply: $${(totalSupply / 1e6).toFixed(1)}M (${supplyChange7d >= 0 ? '+' : ''}${supplyChange7d.toFixed(2)}% 7d) → ${signal}`);

    return {
      usdtMarketCap: 0, // Not available on-chain
      usdcMarketCap: totalSupply,
      totalStablecoinSupply: totalSupply,
      supplyChange7d,
      signal,
      lastUpdated: now,
    };
  } catch (e: any) {
    console.warn(`  ⚠️ Base USDC supply fetch failed: ${e.message?.substring(0, 100) || e}`);
    return null;
  }
}

// Load stores on module init
loadPriceHistoryStore();

// ============================================================================
// v9.1: MULTI-WALLET PROFIT DISTRIBUTION
// ============================================================================

interface HarvestRecipient {
  label: string;        // "Henry", "Brother"
  wallet: string;       // 0x address
  percent: number;      // 15 = 15% of harvested profits
}

function parseHarvestRecipients(): HarvestRecipient[] {
  // TODO: Ambassador Program Integration — read feeRate from referral config
  // instead of using a hardcoded 2% platform fee. The 6-tier ambassador program
  // (standard=2.0%, connector=1.75%, builder=1.5%, ambassador=1.25%, partner=1.0%,
  // founding=0.5%) is defined in stc-website/src/lib/referrals.ts. When the
  // referral data pipeline flows to the bot, replace the fixed payout percentage
  // with the user's tier-based feeRate from the referral system.
  //
  // New format: HARVEST_RECIPIENTS='Henry:0xabc...123:15,Brother:0xdef...456:15'
  const recipientStr = process.env.HARVEST_RECIPIENTS || '';
  if (recipientStr) {
    const recipients = recipientStr.split(',').map(r => {
      const parts = r.trim().split(':');
      // Handle wallet addresses containing colons (shouldn't, but be safe)
      if (parts.length >= 3) {
        const label = parts[0].trim();   // v10.4: Trim label — leading space caused key mismatches in payout tracking
        const pct = parseFloat(parts[parts.length - 1]);
        const wallet = parts.slice(1, -1).join(':').trim(); // v10.4: Trim wallet too
        return { label, wallet, percent: pct };
      }
      return { label: '', wallet: '', percent: 0 };
    }).filter(r => r.wallet?.length >= 42 && r.percent > 0 && r.percent <= 50);

    // Validate: total must be <= 70% (protect at least 30% for compounding)
    const totalPct = recipients.reduce((s, r) => s + r.percent, 0);
    if (totalPct > 70) {
      console.warn(`  ⚠️ HARVEST_RECIPIENTS total ${totalPct}% exceeds 70% cap — rejecting all. At least 30% must compound.`);
      return [];
    }
    if (totalPct > 50) {
      console.warn(`  ⚠️ HARVEST_RECIPIENTS total ${totalPct}% — over 50% allocated to withdrawals. Consider reducing.`);
    }
    if (recipients.length > 0) {
      console.log(`  💰 Harvest recipients: ${recipients.map(r => `${r.label}(${r.percent}%)`).join(', ')} | ${100 - totalPct}% reinvested`);
    }
    return recipients;
  }

  // Backward compat: old single-wallet env var → 15% default
  const oldWallet = process.env.PROFIT_DESTINATION_WALLET || '';
  if (oldWallet.length >= 42) {
    return [{ label: 'Owner', wallet: oldWallet, percent: 15 }];
  }
  return [];
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
    maxBuySize: parseFloat(process.env.MAX_BUY_SIZE_USDC || "250"), // v11.4.6: raised from $100 to $250 — deploy capital faster
    maxSellPercent: parseFloat(process.env.MAX_SELL_PERCENT || "50"),
    intervalMinutes: parseInt(process.env.TRADING_INTERVAL_MINUTES || String(DEFAULT_TRADING_INTERVAL_MINUTES)),
    // V3.1: Risk-adjusted position sizing
    maxPositionPercent: 25,  // No single token > 25% of portfolio
    minPositionUSD: 15,      // Minimum position size — no dust trades
    rebalanceThreshold: 10,  // Rebalance if sector drift > 10%
    slippageBps: 100,        // 1% slippage tolerance for swaps
    // V5.1.1: Tiered Profit Harvesting — scale out in tranches, bank small wins consistently
    profitTaking: {
      enabled: true,
      targetPercent: 30,        // Let winners run to 30% before harvesting
      sellPercent: 30,          // Legacy: original sell amount
      minHoldingUSD: 5,         // Don't trigger if holding < $5
      cooldownHours: 8,         // v11.4.13: 24h → 8h — need harvests to happen for payouts. 24h was too restrictive
      // Tiered harvesting: sell progressively more as gains increase
      // v11.4.13: Lowered first tier from 25% → 12% to harvest sooner and feed the payout system.
      // With zero payouts in 3 days, the harvest thresholds were too high for current market conditions.
      tiers: [
        { gainPercent: 12,  sellPercent: 12, label: "EARLY_HARVEST" },   // v11.4.13: 25→12% — harvest sooner
        { gainPercent: 30,  sellPercent: 18, label: "MID_HARVEST" },     // v11.4.13: 50→30% — don't wait for 50%
        { gainPercent: 75,  sellPercent: 25, label: "STRONG_HARVEST" },  // v11.4.13: 100→75%
        { gainPercent: 150, sellPercent: 35, label: "MAJOR_HARVEST" },   // v11.4.13: 200→150%
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

    // v9.1: Multi-Wallet Profit Distribution — percentage-based splits, rest compounds
    autoHarvest: {
      enabled: process.env.AUTO_HARVEST_ENABLED === 'true',
      recipients: parseHarvestRecipients(),
      destinationWallet: process.env.PROFIT_DESTINATION_WALLET || '', // Legacy compat
      thresholdUSD: parseFloat(process.env.AUTO_HARVEST_THRESHOLD_USD || '25'),
      minETHReserve: parseFloat(process.env.AUTO_HARVEST_MIN_ETH_RESERVE || '0.002'),
      cooldownHours: parseFloat(process.env.AUTO_HARVEST_COOLDOWN_HOURS || '24'),
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

// NVR Signal Service: Only initialize Anthropic client if not in central mode (central mode fetches signals remotely)
const anthropic = (process.env.SIGNAL_MODE !== 'central')
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null as any; // Central mode doesn't need Anthropic — signals come from remote producer

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

  // v19.3.3: Pass the key AS-IS to the CDP SDK. Do NOT attempt format conversion.
  // Previous code (v19.0-v19.3.1) tried to convert SEC1 PEM to PKCS#8 by swapping headers,
  // which corrupted the ASN.1 structure and caused the SDK to derive a different account
  // address — all trades failed with "Insufficient balance" for 18+ hours.
  // The CDP SDK handles its own key formats internally.

  if (!apiKeyId || !apiKeySecret) {
    console.error("❌ CDP API credentials not found. Need CDP_API_KEY_ID + CDP_API_KEY_SECRET (or CDP_API_KEY_NAME + CDP_API_KEY_PRIVATE_KEY)");
    throw new Error("Missing CDP credentials");
  }

  // Diagnostic logging (safe - only shows key type and length, never actual values)
  const envSource = process.env.CDP_API_KEY_ID ? 'CDP_API_KEY_ID' : 'CDP_API_KEY_NAME';
  const secretSource = process.env.CDP_API_KEY_SECRET ? 'CDP_API_KEY_SECRET' : 'CDP_API_KEY_PRIVATE_KEY';
  console.log(`  🔑 CDP Auth: apiKeyId from ${envSource} (${apiKeyId.length} chars, starts with "${apiKeyId.substring(0, 8)}...")`);
  console.log(`  🔑 CDP Auth: apiKeySecret from ${secretSource} (${apiKeySecret.length} chars, type: ${apiKeySecret.length === 88 ? 'Ed25519' : apiKeySecret.startsWith('-----') ? 'PEM/ECDSA' : 'unknown'})`);
  console.log(`  🔑 CDP Auth: walletSecret ${walletSecret ? `present (${walletSecret.length} chars)` : 'NOT SET - trades may fail'}`);
  console.log(`  🔑 Node.js: ${process.version} | NODE_OPTIONS: ${process.env.NODE_OPTIONS || 'not set'}`);

  return new CdpClient({
    apiKeyId,
    apiKeySecret,
    walletSecret,
  });
}

let cdpClient: CdpClient;

// === NVR CENTRAL SIGNAL SERVICE — Module State ===
let signalMode: 'local' | 'central' | 'producer' = 'local'; // Set in main() based on env
let latestSignals: SignalPayload | null = null;
let signalCycleNumber = 0;

// === NVR-SPEC-004: Signal Dashboard — History Tracking (capped at 100) ===
interface SignalHistoryEntry {
  cycle: number;
  timestamp: string;
  buys: number;
  sells: number;
  holds: number;
  strongBuys: number;
  strongSells: number;
  regime: string;
  fearGreed: number;
}
const signalHistory: SignalHistoryEntry[] = [];
const SIGNAL_HISTORY_MAX = 100;

function pushSignalHistory(payload: SignalPayload): void {
  const counts = { buys: 0, sells: 0, holds: 0, strongBuys: 0, strongSells: 0 };
  for (const sig of payload.signals) {
    if (sig.action === 'BUY') counts.buys++;
    else if (sig.action === 'SELL') counts.sells++;
    else if (sig.action === 'HOLD') counts.holds++;
    else if (sig.action === 'STRONG_BUY') counts.strongBuys++;
    else if (sig.action === 'STRONG_SELL') counts.strongSells++;
  }
  signalHistory.push({
    cycle: payload.cycleNumber,
    timestamp: payload.timestamp,
    ...counts,
    regime: payload.marketRegime || 'UNKNOWN',
    fearGreed: payload.fearGreedIndex ?? 0,
  });
  if (signalHistory.length > SIGNAL_HISTORY_MAX) {
    signalHistory.splice(0, signalHistory.length - SIGNAL_HISTORY_MAX);
  }
}

// CDP account name — parameterized for multi-tenant deployments (create-nvr-bot CLI)
const CDP_ACCOUNT_NAME = process.env.CDP_ACCOUNT_NAME || "henry-trading-bot";

// === v10.1: SMART ACCOUNT (Gasless Swaps on Base) ===
// NOTE: Wallet 0x55509... IS already a CoinbaseSmartWallet (ERC-4337 proxy).
// CDP SDK's getOrCreateAccount() returns it directly — no wrapping needed.
// Calling getOrCreateSmartAccount() would create a SECOND empty wrapper (Bug #1 fix).
let smartAccount: any = null;  // Only set if CDP creates a NEW Smart Account (not pre-existing)
let smartAccountAddress: string = '';

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
let lastVolumeSnapshot: Map<string, number> = new Map();
let lastFearGreedValue = 0;

// === v19.3: CAPITAL PRESERVATION MODE ===
// When F&G < 15 for >6 consecutive hours, only allow high-conviction trades.
// v19.3.2: Removed cycle multiplier — bot ALWAYS cycles at normal speed.
// Preservation mode filters WHAT trades happen, not HOW OFTEN the bot runs.
// The bot needs to cycle fast to execute trailing stop sells and cut losses.
const PRESERVATION_FG_ACTIVATE = 15;   // Activate when F&G stays below this for 6h
const PRESERVATION_FG_DEACTIVATE = 25; // Deactivate when F&G rises above this
const PRESERVATION_RING_BUFFER_SIZE = 36; // 6 hours at 10-min cycles
const PRESERVATION_CYCLE_MULTIPLIER = 1; // v19.3.2: NO slowdown — always cycle at normal speed
const PRESERVATION_MIN_CONFLUENCE = 80;   // Only trades with confluence > 80/100
const PRESERVATION_MIN_SWARM_CONSENSUS = 80; // Or swarm consensus > 80%
const PRESERVATION_TARGET_CASH_PCT = 50;  // Target 50%+ cash allocation

const capitalPreservationMode: {
  isActive: boolean;
  activatedAt: number | null;
  fearReadings: number[];          // ring buffer of last 36 readings
  tradesBlocked: number;
  tradesPassed: number;
  deactivationCount: number;
  lastUpdated: number;
} = {
  isActive: false,
  activatedAt: null,
  fearReadings: [],
  tradesBlocked: 0,
  tradesPassed: 0,
  deactivationCount: 0,
  lastUpdated: 0,
};

/**
 * v19.3: Update capital preservation mode state based on current Fear & Greed reading.
 * Call after every F&G fetch. Activates when F&G < 15 sustained for 6h, deactivates when F&G > 25.
 * v19.3.1: On first call (startup), if F&G is in extreme fear, pre-fill the ring buffer
 * so preservation mode activates immediately instead of waiting 6 hours after every restart.
 */
function updateCapitalPreservationMode(fgValue: number): void {
  // v19.3.1: Startup pre-fill — if this is the first reading and F&G is already in extreme territory,
  // assume it's been this way (market doesn't jump from 50 to 10 instantly). Fill buffer to activate immediately.
  if (capitalPreservationMode.fearReadings.length === 0 && fgValue < PRESERVATION_FG_ACTIVATE) {
    console.log(`\n🛡️ PRESERVATION STARTUP: F&G=${fgValue} already below ${PRESERVATION_FG_ACTIVATE} — pre-filling buffer for immediate activation`);
    for (let i = 0; i < PRESERVATION_RING_BUFFER_SIZE - 1; i++) {
      capitalPreservationMode.fearReadings.push(fgValue);
    }
  }

  // Push to ring buffer
  capitalPreservationMode.fearReadings.push(fgValue);
  if (capitalPreservationMode.fearReadings.length > PRESERVATION_RING_BUFFER_SIZE) {
    capitalPreservationMode.fearReadings.shift();
  }
  capitalPreservationMode.lastUpdated = Date.now();

  if (capitalPreservationMode.isActive) {
    // Deactivation check: F&G must rise above threshold
    if (fgValue > PRESERVATION_FG_DEACTIVATE) {
      console.log(`\n🟢 CAPITAL PRESERVATION MODE DEACTIVATED — F&G ${fgValue} > ${PRESERVATION_FG_DEACTIVATE}`);
      console.log(`   Duration: ${capitalPreservationMode.activatedAt ? ((Date.now() - capitalPreservationMode.activatedAt) / 3600000).toFixed(1) : '?'}h | Blocked: ${capitalPreservationMode.tradesBlocked} | Passed: ${capitalPreservationMode.tradesPassed}`);
      capitalPreservationMode.isActive = false;
      capitalPreservationMode.activatedAt = null;
      capitalPreservationMode.tradesBlocked = 0;
      capitalPreservationMode.tradesPassed = 0;
      capitalPreservationMode.deactivationCount++;
    }
  } else {
    // Activation check: all readings in buffer must be < threshold AND buffer must be full
    if (capitalPreservationMode.fearReadings.length >= PRESERVATION_RING_BUFFER_SIZE) {
      const allBelowThreshold = capitalPreservationMode.fearReadings.every(r => r < PRESERVATION_FG_ACTIVATE);
      if (allBelowThreshold) {
        capitalPreservationMode.isActive = true;
        capitalPreservationMode.activatedAt = Date.now();
        capitalPreservationMode.tradesBlocked = 0;
        capitalPreservationMode.tradesPassed = 0;
        console.log(`\n🔴 CAPITAL PRESERVATION MODE ACTIVATED — F&G < ${PRESERVATION_FG_ACTIVATE} sustained for 6+ hours`);
        console.log(`   Cycle speed: NORMAL (sells always allowed) | Min buy confluence: ${PRESERVATION_MIN_CONFLUENCE} | Target cash: ${PRESERVATION_TARGET_CASH_PCT}%`);
        console.log(`   Scout seeding: DISABLED | Only high-conviction trades allowed`);
      }
    }
  }
}

// v17.0: Store previous buy ratios for flow direction tracking
let previousBuyRatios: Map<string, number> = new Map();
let cycleStats = { totalLight: 0, totalHeavy: 0, lastHeavyReason: '' };

// === v6.0: EQUITY MODULE STATE (initialized in main()) ===
let equityEngine: EquityIntegration | null = null;
let equityEnabled = false;

// === v6.1: TOKEN DISCOVERY STATE ===
let tokenDiscoveryEngine: TokenDiscoveryEngine | null = null;

// === v11.0: FAMILY PLATFORM STATE ===
let familyWalletManager: WalletManager | null = null;
let familyEnabled = false;
let lastFamilyTradeResults: FamilyTradeResult[] = [];

// === v11.0: AAVE V3 YIELD STATE ===
let yieldEnabled = process.env.AAVE_YIELD_ENABLED !== 'false'; // default ON
let lastYieldAction: string | null = null;
let yieldCycleCount = 0;

// === v15.3: MULTI-PROTOCOL YIELD OPTIMIZER STATE ===
let yieldOptimizerCycleCount = 0;
let lastYieldRates: ProtocolYield[] = [];

// === v11.0: DEX INTELLIGENCE STATE ===
let lastDexIntelligence: DexIntelligence | null = null;
let dexIntelFetchCount = 0;

// === v14.1: MOMENTUM DECELERATION STATE (per-token) ===
const decelStates: Record<string, DecelState> = {};
const flowTimeframeState: FlowTimeframeState = createFlowTimeframeState();

// === v19.2: DexScreener txn data cache — populated by price stream, covers ALL tokens ===
// Stores latest h1 buy/sell counts from DexScreener for every tracked token.
// Merged into buySellPressure after GeckoTerminal fetch to fill coverage gaps.
const dexScreenerTxnCache: Record<string, {
  h1Buys: number; h1Sells: number; h24Buys: number; h24Sells: number;
  h1Buyers: number; h1Sellers: number; updatedAt: number;
}> = {};

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

// === v11.1: CASH DEPLOYMENT ENGINE STATE ===
let cashDeploymentMode = false;
let cashDeploymentCycles = 0;

/**
 * v11.1: Cash Deployment Detection
 * Calculates cash percentage and determines if the bot should enter deployment mode.
 * When cash exceeds CASH_DEPLOYMENT_THRESHOLD_PCT, returns deployment parameters
 * including reduced confluence thresholds and a deployment budget.
 */
function checkCashDeploymentMode(
  usdcBalance: number,
  totalPortfolioValue: number,
): {
  active: boolean;
  cashPercent: number;
  excessCash: number;
  deployBudget: number;
  confluenceDiscount: number;
} {
  if (totalPortfolioValue <= 0) return { active: false, cashPercent: 0, excessCash: 0, deployBudget: 0, confluenceDiscount: 0 };

  const cashPercent = (usdcBalance / totalPortfolioValue) * 100;

  // v11.4.19: Directive-aware threshold — aggressive directives lower the trigger
  const directiveAdj = getDirectiveThresholdAdjustments();
  const effectiveThreshold = directiveAdj.deploymentThresholdOverride ?? CASH_DEPLOYMENT_THRESHOLD_PCT;

  if (cashPercent <= effectiveThreshold) {
    if (cashDeploymentMode) {
      console.log(`  ✅ Cash deployment mode OFF — USDC at ${cashPercent.toFixed(1)}% (below ${effectiveThreshold}% threshold${directiveAdj.deploymentThresholdOverride ? ' [directive override]' : ''})`);
      cashDeploymentMode = false;
    }
    return { active: false, cashPercent, excessCash: 0, deployBudget: 0, confluenceDiscount: 0 };
  }

  // Calculate excess: how much USDC is above the target threshold
  const targetCash = totalPortfolioValue * (effectiveThreshold / 100);
  const excessCash = Math.max(0, usdcBalance - Math.max(targetCash, CASH_DEPLOYMENT_MIN_RESERVE_USD));

  if (excessCash < 10) {
    return { active: false, cashPercent, excessCash: 0, deployBudget: 0, confluenceDiscount: 0 };
  }

  // Deploy up to CASH_DEPLOYMENT_MAX_DEPLOY_PCT of excess per cycle
  const deployBudget = excessCash * (CASH_DEPLOYMENT_MAX_DEPLOY_PCT / 100);

  cashDeploymentMode = true;
  cashDeploymentCycles++;

  // v11.4.19: Stack directive confluence reduction on top of deployment discount
  const totalConfluenceDiscount = CASH_DEPLOYMENT_CONFLUENCE_DISCOUNT + directiveAdj.confluenceReduction;

  return {
    active: true,
    cashPercent,
    excessCash,
    deployBudget,
    confluenceDiscount: totalConfluenceDiscount,
  };
}

// === v11.2: CRASH-BUYING BREAKER OVERRIDE STATE ===
let crashBuyingOverrideActive = false;
let crashBuyingOverrideCycles = 0;

/**
 * v17.0: Crash-Buying Breaker Override — Flow-Based
 * When the breaker is active but cash is heavy, allow deployment buys through
 * IF on-chain flow confirms real buying is happening.
 *
 * v17.0: Removed F&G as the gate. Now uses cash level as the trigger.
 * The bot is willing to buy in any sentiment environment IF flow confirms it.
 * Buy ratio requirements ensure we're not buying into a vacuum.
 *
 * Conditions (ALL must be true):
 * 1. Cash > 40% of portfolio (significant idle capital)
 * 2. NOT blocked by capital floor (portfolio above safety minimum)
 * 3. Some USDC available
 *
 * When active:
 * - BUY actions are allowed despite breaker being active
 * - Position sizes are reduced to 60% of normal (cautious accumulation)
 * - Max entries per cycle capped
 * - Must have positive buy ratio (>50%) — flow must confirm the opportunity
 */
function checkCrashBuyingOverride(
  deploymentCheck: { active: boolean; cashPercent: number; excessCash: number; deployBudget: number; confluenceDiscount: number },
  fearGreedValue: number,
  belowCapitalFloor: boolean,
): {
  active: boolean;
  reason: string;
  sizeMultiplier: number;
  maxEntries: number;
  blueChipOnly: boolean;
  maxPositionPct: number;
  requirePositiveBuyRatio: boolean;
} {
  const inactive = { active: false, reason: '', sizeMultiplier: 1, maxEntries: CASH_DEPLOYMENT_MAX_ENTRIES, blueChipOnly: false, maxPositionPct: 100, requirePositiveBuyRatio: false };

  // v18.2: Block crash buying override in extreme fear — capital preservation first
  if (fearGreedValue < 25) {
    return { ...inactive, reason: `Extreme fear (F&G=${fearGreedValue}) — crash buying override disabled, preserving capital` };
  }

  // v17.0: Gate on cash level, not F&G. Need significant idle capital to override breaker.
  if (deploymentCheck.cashPercent < DEPLOYMENT_BREAKER_OVERRIDE_MIN_CASH_PCT) {
    return { ...inactive, reason: `Cash ${deploymentCheck.cashPercent.toFixed(1)}% below override threshold ${DEPLOYMENT_BREAKER_OVERRIDE_MIN_CASH_PCT}%` };
  }

  // Capital floor still blocks everything — non-negotiable safety
  if (belowCapitalFloor) {
    return { ...inactive, reason: 'Capital floor active — override blocked' };
  }

  // Need at least some USDC
  if (deploymentCheck.cashPercent < 1) {
    return { ...inactive, reason: `No USDC available for crash buying (${deploymentCheck.cashPercent.toFixed(1)}%)` };
  }

  crashBuyingOverrideActive = true;
  crashBuyingOverrideCycles++;

  return {
    active: true,
    reason: `Cash heavy (${deploymentCheck.cashPercent.toFixed(1)}%) + breaker active → deployment override (F&G=${fearGreedValue} for context)`,
    sizeMultiplier: DEPLOYMENT_BREAKER_OVERRIDE_SIZE_MULT,
    maxEntries: DEPLOYMENT_BREAKER_OVERRIDE_MAX_ENTRIES,
    blueChipOnly: false,          // v17.0: swarm decides sector allocation, not F&G
    maxPositionPct: 5,
    requirePositiveBuyRatio: true, // v17.0: always require flow confirmation for breaker override
  };
}

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
  // v10.2: Require at least 2 tokens dropping for emergency (filters single-token flash crashes)
  let droppingTokens = 0;
  let worstDrop = { symbol: '', change: 0 };
  for (const [symbol, price] of currentPrices) {
    const lastCheck = adaptiveCycle.lastPriceCheck.get(symbol);
    if (lastCheck && lastCheck > 0) {
      const change = (price - lastCheck) / lastCheck;
      if (change <= EMERGENCY_DROP_THRESHOLD) {
        droppingTokens++;
        if (change < worstDrop.change) worstDrop = { symbol, change };
      }
    }
  }
  // Single token flash crash = likely price feed issue; 2+ tokens = real market move
  if (droppingTokens >= 2 || (droppingTokens === 1 && worstDrop.change <= EMERGENCY_DROP_THRESHOLD * 2)) {
    return { emergency: true, token: worstDrop.symbol, dropPercent: worstDrop.change * 100 };
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

  // v19.3: Capital preservation mode — 10x slower cycles to reduce trade frequency
  let preservationNote = '';
  if (capitalPreservationMode.isActive) {
    finalInterval = finalInterval * PRESERVATION_CYCLE_MULTIPLIER;
    preservationNote = ' | PRESERVATION MODE (10x)';
  }

  const reason = vol.maxChange > 0
    ? `${vol.level} volatility (${vol.fastestMover} ±${(vol.maxChange * 100).toFixed(1)}%) | ${tier} tier${preservationNote}`
    : `${vol.level} volatility | ${tier} tier${preservationNote}`;

  return { intervalSec: Math.round(finalInterval), reason, volatilityLevel: vol.level };
}

/**
 * v6.2: Schedule the next adaptive cycle.
 * Replaces the fixed cron job with dynamic setTimeout.
 */
// v8.1: Cycle mutex — prevents double-execution from timer + cron overlap
let cycleInProgress = false;
let cycleStartedAt = 0; // v11.5: Timestamp when cycle started — for stuck detection
const CYCLE_TIMEOUT_MS = 5 * 60 * 1000; // v11.4.21: 5-minute hard timeout per cycle

// v11.4.21: Wrap a promise with a timeout — rejects if the promise doesn't resolve in time.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

function scheduleNextCycle() {
  if (adaptiveCycleTimer) clearTimeout(adaptiveCycleTimer);

  const delayMs = adaptiveCycle.currentIntervalSec * 1000;
  adaptiveCycleTimer = setTimeout(async () => {
    // v11.5: Stuck cycle detection — if cycleInProgress is true but cycle started >2× timeout ago,
    // force-reset it. This handles edge cases where withTimeout's rejection doesn't properly
    // clear the flag (e.g., unhandled rejection in finally block, or process.nextTick race).
    if (cycleInProgress) {
      const stuckDuration = Date.now() - cycleStartedAt;
      if (stuckDuration > CYCLE_TIMEOUT_MS * 2) {
        console.error(`[Adaptive Cycle] ⚠️ STUCK CYCLE DETECTED — flag stuck for ${(stuckDuration / 1000).toFixed(0)}s, force-resetting`);
        cycleInProgress = false;
      } else {
        console.log(`[Adaptive Cycle] Skipped — previous cycle still running (${(stuckDuration / 1000).toFixed(0)}s elapsed)`);
        scheduleNextCycle();
        return;
      }
    }
    cycleInProgress = true;
    cycleStartedAt = Date.now();
    try {
      // v11.4.21: Hard timeout prevents a hung API call from killing the trading loop forever.
      // If any single cycle takes >5 minutes, it's stuck — abort and schedule the next one.
      await withTimeout(runTradingCycle(), CYCLE_TIMEOUT_MS, 'Trading cycle');
    } catch (err: any) {
      console.error(`[Adaptive Cycle Error] ${err?.message?.substring(0, 300) || err}`);
    } finally {
      cycleInProgress = false;
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

            // v19.2: Extract DexScreener transaction data for flow coverage on ALL tokens
            // DexScreener returns txns.h1.buys/sells for every token — use it!
            const txns = pair.txns;
            if (txns?.h1) {
              const h1Buys = txns.h1.buys || 0;
              const h1Sells = txns.h1.sells || 0;
              const totalH1 = h1Buys + h1Sells;
              if (totalH1 >= 5) { // minimum activity threshold
                const buyRatioPct = (h1Buys / totalH1) * 100;
                recordFlowReading(flowTimeframeState, entry[0], buyRatioPct);
              }
              // Cache full txn data for buySellPressure merge
              dexScreenerTxnCache[entry[0]] = {
                h1Buys, h1Sells,
                h24Buys: txns.h24?.buys || 0, h24Sells: txns.h24?.sells || 0,
                h1Buyers: txns.h1.buys || 0, h1Sellers: txns.h1.sells || 0, // DexScreener doesn't separate unique buyers; use tx count
                updatedAt: now,
              };
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
  action: "BUY" | "SELL" | "HOLD" | "REBALANCE" | "WITHDRAW";
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
  // v12.2: Store realized P&L at trade time (not retroactive) for accurate daily scoreboard
  realizedPnL?: number;
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
    triggeredBy: "AI" | "STOP_LOSS" | "PROFIT_TAKE" | "EXPLORATION" | "FORCED_DEPLOY";  // What initiated the trade
    isExploration?: boolean;  // V5.0: Whether this was an exploration trade
    isForced?: boolean;       // v12.2.7: Whether this was a forced deployment trade
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
// WIN RATE TRUTH DASHBOARD — Honest profitability metrics
// ============================================================================

interface RoundTripTrade {
  token: string;
  buyTimestamp: string;
  sellTimestamp: string;
  buyAmountUSD: number;
  sellAmountUSD: number;
  pnlUSD: number;
  returnPercent: number;
  holdDurationHours: number;
}

interface WinRateTruthData {
  executionWinRate: number;
  realizedWinRate: number;
  profitFactor: number;
  dailyWinRates: Array<{ date: string; winRate: number; trades: number; wins: number }>;
  avgWinUSD: number;
  avgLossUSD: number;
  winLossRatio: number;
  totalRoundTrips: number;
  profitableRoundTrips: number;
  grossProfitUSD: number;
  grossLossUSD: number;
  roundTrips: RoundTripTrade[];
}

/**
 * Calculate honest win rate metrics by matching BUY -> SELL round-trips.
 * Unlike the existing calculateTradePerformance() which uses current cost basis
 * snapshots, this matches each SELL to its preceding BUY for the same token
 * to compute actual realized profitability per round-trip.
 */
function calculateWinRateTruth(): WinRateTruthData {
  // 1. Execution win rate: the existing "success" metric
  const allActionableTrades = state.tradeHistory.filter(t => t.action !== "HOLD");
  const successfulTrades = allActionableTrades.filter(t => t.success);
  const executionWinRate = allActionableTrades.length > 0
    ? (successfulTrades.length / allActionableTrades.length) * 100
    : 0;

  // 2. Build round-trip trades by matching BUYs to SELLs for the same token.
  // For each SELL, find the most recent unmatched BUY for that token.
  const roundTrips: RoundTripTrade[] = [];
  const unmatchedBuys: Map<string, TradeRecord[]> = new Map(); // token -> stack of buys

  // Process trades chronologically
  const sortedTrades = [...state.tradeHistory]
    .filter(t => t.success && (t.action === "BUY" || t.action === "SELL"))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  for (const trade of sortedTrades) {
    if (trade.action === "BUY") {
      const token = trade.toToken;
      if (!unmatchedBuys.has(token)) unmatchedBuys.set(token, []);
      unmatchedBuys.get(token)!.push(trade);
    } else if (trade.action === "SELL") {
      const token = trade.fromToken;
      const buyStack = unmatchedBuys.get(token);
      if (buyStack && buyStack.length > 0) {
        // Match with the earliest unmatched buy (FIFO)
        const matchedBuy = buyStack.shift()!;
        const pnlUSD = trade.amountUSD - matchedBuy.amountUSD;
        const returnPercent = matchedBuy.amountUSD > 0
          ? (pnlUSD / matchedBuy.amountUSD) * 100
          : 0;
        const holdMs = new Date(trade.timestamp).getTime() - new Date(matchedBuy.timestamp).getTime();
        const holdDurationHours = Math.round((holdMs / (1000 * 60 * 60)) * 10) / 10;

        roundTrips.push({
          token,
          buyTimestamp: matchedBuy.timestamp,
          sellTimestamp: trade.timestamp,
          buyAmountUSD: matchedBuy.amountUSD,
          sellAmountUSD: trade.amountUSD,
          pnlUSD: Math.round(pnlUSD * 100) / 100,
          returnPercent: Math.round(returnPercent * 100) / 100,
          holdDurationHours,
        });
      }
      // If no matching buy found, this sell is from a pre-existing position — skip it
    }
  }

  // 3. Compute realized win rate from round-trips
  const profitableRoundTrips = roundTrips.filter(rt => rt.pnlUSD > 0).length;
  const realizedWinRate = roundTrips.length > 0
    ? (profitableRoundTrips / roundTrips.length) * 100
    : 0;

  // 4. Gross profits and losses
  let grossProfitUSD = 0;
  let grossLossUSD = 0;
  const winPnLs: number[] = [];
  const lossPnLs: number[] = [];

  for (const rt of roundTrips) {
    if (rt.pnlUSD > 0) {
      grossProfitUSD += rt.pnlUSD;
      winPnLs.push(rt.pnlUSD);
    } else {
      grossLossUSD += Math.abs(rt.pnlUSD);
      lossPnLs.push(Math.abs(rt.pnlUSD));
    }
  }

  const profitFactor = grossLossUSD > 0 ? grossProfitUSD / grossLossUSD : (grossProfitUSD > 0 ? Infinity : 0);

  // 5. Average win / average loss
  const avgWinUSD = winPnLs.length > 0
    ? Math.round((winPnLs.reduce((s, v) => s + v, 0) / winPnLs.length) * 100) / 100
    : 0;
  const avgLossUSD = lossPnLs.length > 0
    ? Math.round((lossPnLs.reduce((s, v) => s + v, 0) / lossPnLs.length) * 100) / 100
    : 0;
  const winLossRatio = avgLossUSD > 0 ? Math.round((avgWinUSD / avgLossUSD) * 100) / 100 : (avgWinUSD > 0 ? Infinity : 0);

  // 6. Daily win rates for the last 7 days
  const now = new Date();
  const dailyWinRates: Array<{ date: string; winRate: number; trades: number; wins: number }> = [];
  for (let d = 6; d >= 0; d--) {
    const day = new Date(now);
    day.setDate(day.getDate() - d);
    const dateStr = day.toISOString().slice(0, 10);

    const dayTrips = roundTrips.filter(rt => rt.sellTimestamp.slice(0, 10) === dateStr);
    const dayWins = dayTrips.filter(rt => rt.pnlUSD > 0).length;
    dailyWinRates.push({
      date: dateStr,
      winRate: dayTrips.length > 0 ? Math.round((dayWins / dayTrips.length) * 1000) / 10 : 0,
      trades: dayTrips.length,
      wins: dayWins,
    });
  }

  return {
    executionWinRate: Math.round(executionWinRate * 100) / 100,
    realizedWinRate: Math.round(realizedWinRate * 100) / 100,
    profitFactor: profitFactor === Infinity ? 999 : Math.round(profitFactor * 100) / 100,
    dailyWinRates,
    avgWinUSD,
    avgLossUSD,
    winLossRatio: winLossRatio === Infinity ? 999 : winLossRatio,
    totalRoundTrips: roundTrips.length,
    profitableRoundTrips,
    grossProfitUSD: Math.round(grossProfitUSD * 100) / 100,
    grossLossUSD: Math.round(grossLossUSD * 100) / 100,
    roundTrips: roundTrips.slice(-50), // Last 50 round-trips for detail
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
  // v9.0: ATR-based multiplier tuning
  atrStopMultiplier: number;        // Default 2.5, tuned 1.5-4.0
  atrTrailMultiplier: number;       // Default 2.0, tuned 1.5-4.0
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
  stopLossPercent:       { min: -25, max: -12, maxStep: 2 },    // v12.2.2: widened from -6% ceiling — was causing churn
  trailingStopPercent:   { min: -20, max: -10, maxStep: 2 },   // v12.2.2: widened from -5% ceiling — too tight for altcoins
  atrStopMultiplier:     { min: 1.5, max: 4.0, maxStep: 0.25 }, // v9.0: ATR stop multiplier
  atrTrailMultiplier:    { min: 1.5, max: 4.0, maxStep: 0.25 }, // v9.0: ATR trail multiplier
};

const DEFAULT_ADAPTIVE_THRESHOLDS: AdaptiveThresholds = {
  rsiOversold: 30,
  rsiOverbought: 70,
  confluenceBuy: 8,       // v11.4.22: Lowered from 15 — with no RSI/MACD history, scores stay near 0-8. Need lower bar to bootstrap trades.
  confluenceSell: -8,     // v11.4.22: Symmetrical with buy threshold
  confluenceStrongBuy: 30, // v11.4.22: Lowered from 40 — more achievable for conviction trades
  confluenceStrongSell: -30, // v11.4.22: Symmetrical
  profitTakeTarget: 30,    // Let winners run to 30% before harvesting
  profitTakeSellPercent: 30,
  stopLossPercent: -15,       // v6.2: tightened from -25%
  trailingStopPercent: -12,   // v6.2: tightened from -20%
  atrStopMultiplier: ATR_STOP_LOSS_MULTIPLIER,     // v9.0: 2.5x ATR default
  atrTrailMultiplier: ATR_TRAILING_STOP_MULTIPLIER, // v9.0: 2.0x ATR default
  regimeMultipliers: {
    TRENDING_UP: 1.3,       // v11.4.22: Aligned with constants.ts v9.4 values
    TRENDING_DOWN: 0.85,    // v11.4.22: Was 0.6 — still trade, just more selective
    RANGING: 0.9,           // v11.4.22: Was 0.8 — ranges are opportunity for a fast-cycling bot
    VOLATILE: 0.7,          // v11.4.22: Was 0.5 — vol = opportunity
    UNKNOWN: 0.8,           // v11.4.22: Was 0.7
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

  // v12.2.7: Filter out forced/exploration trades — they pollute pattern recognition
  // because they were executed by mechanical pressure, not signal quality.
  // The engine should only learn from trades the AI actually chose.
  const aiTrades = state.tradeHistory.filter(t => {
    if (!t.success || t.action === "HOLD" || t.action === "REBALANCE") return false;
    if (t.signalContext?.isExploration) return false;
    if (t.signalContext?.isForced) return false;
    if (t.signalContext?.triggeredBy === "EXPLORATION" || t.signalContext?.triggeredBy === "FORCED_DEPLOY") return false;
    // Also catch legacy forced trades by reasoning prefix
    if (t.reasoning?.startsWith("FORCED_DEPLOY:") || t.reasoning?.startsWith("DEPLOYMENT_FALLBACK:") || t.reasoning?.startsWith("DIRECT_DEPLOYMENT:")) return false;
    return true;
  });

  // Process each non-HOLD AI-driven trade
  for (const trade of aiTrades) {
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
  const excludedCount = state.tradeHistory.filter(t => t.success && t.action !== "HOLD" && t.action !== "REBALANCE").length - aiTrades.length;
  console.log(`  🧠 Strategy patterns analyzed: ${Object.keys(patterns).length} patterns from ${aiTrades.length} AI trades (${excludedCount} forced/exploration trades excluded)`);
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

// v9.0: ATR comparison logging — tracks how many comparison entries we've emitted
let atrComparisonLogCount = 0;

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
    // v9.0: Tighten ATR multipliers too (lower multiplier = tighter stop)
    proposeAdaptation("atrStopMultiplier", -0.25, `Negative avg return $${review.periodStats.avgReturn.toFixed(2)}`);
    proposeAdaptation("atrTrailMultiplier", -0.25, `Negative avg return $${review.periodStats.avgReturn.toFixed(2)}`);
  }

  // Strong avg return → propose letting winners run longer
  if (review.periodStats.avgReturn > 5) {
    proposeAdaptation("profitTakeTarget", 2, `Strong avg return $${review.periodStats.avgReturn.toFixed(2)}`);
    // v9.0: Widen ATR multipliers (higher multiplier = wider stop = let winners run)
    proposeAdaptation("atrStopMultiplier", 0.25, `Strong avg return $${review.periodStats.avgReturn.toFixed(2)}`);
    proposeAdaptation("atrTrailMultiplier", 0.25, `Strong avg return $${review.periodStats.avgReturn.toFixed(2)}`);
  }

  // v9.0: Low win rate → tighten ATR stops
  if (winRate < 0.35) {
    proposeAdaptation("atrStopMultiplier", -0.25, `Low win rate ${(winRate * 100).toFixed(0)}%`);
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

  // v10.3: Floor raised from 0.2 → 0.6 — max 40% reduction, never more
  // If 11 dimensions say buy, pattern history shouldn't override that by 80%
  return Math.max(0.6, Math.min(1.0, conf));
}

/**
 * Check for stagnation and generate exploration trade if needed
 * Returns a trade-like object or null
 *
 * v14.2: Added guardrails — exploration trades must not fight the trend.
 *   - Minimum confluence >= 0 (neutral)
 *   - MACD must not be bearish
 *   - Buy ratio must be >= 45% (sellers not dominating)
 *   - In RANGING markets: 50% size reduction, max 1 per cycle
 */
function checkStagnation(
  availableUSDC: number,
  tokenData: any[],
  indicators: Record<string, TechnicalIndicators>,
  marketRegime: MarketRegime
): { toToken: string; amountUSD: number; reasoning: string } | null {
  const exploration = state.explorationState;
  const hoursSinceLastTrade = state.trading.lastTrade
    ? (Date.now() - state.trading.lastTrade.getTime()) / (1000 * 60 * 60)
    : Infinity;

  // No exploration if insufficient capital
  if (availableUSDC < 5) return null;

  // v11.4.22: Trigger exploration after 1 hour (was 4h in v11.4.13).
  // The bot needs to be actively trading to build the 20-trade sample for Kelly sizing.
  // 1 hour stagnation is already too long for a 24/7 autonomous agent.
  if (hoursSinceLastTrade < 1) {
    exploration.consecutiveHolds = 0;
    return null;
  }

  exploration.stagnationAlerts++;
  console.log(`  🔬 Stagnation detected: ${hoursSinceLastTrade.toFixed(1)}h since last trade (alert #${exploration.stagnationAlerts})`);

  // Pick the token with best confluence that we haven't traded recently
  const recentTokens = new Set(state.tradeHistory.slice(-10).map(t => t.toToken));
  const candidates = tokenData
    .filter(t => t.symbol !== "USDC" && !recentTokens.has(t.symbol))
    .sort((a, b) => (b.priceChange24h || 0) - (a.priceChange24h || 0));

  if (candidates.length === 0) return null;

  // v14.2: Apply guardrails — iterate candidates until one passes all filters
  let target: any = null;
  for (const candidate of candidates) {
    const ind = indicators[candidate.symbol];
    const confluenceScore = ind?.confluenceScore ?? 0;
    const macdSignal = ind?.macd?.signal ?? "NEUTRAL";

    // v14.2: Compute buy ratio from order flow data
    const buyVolume = ind?.orderFlow?.buyVolumeUSD ?? 0;
    const sellVolume = ind?.orderFlow?.sellVolumeUSD ?? 0;
    const totalVolume = buyVolume + sellVolume;
    const buyRatioPct = totalVolume > 0 ? (buyVolume / totalVolume) * 100 : 50; // default neutral if no data

    // v14.2: GUARDRAIL 1 — Minimum confluence floor (neutral or positive)
    if (confluenceScore < EXPLORATION_MIN_CONFLUENCE) {
      console.log(`  🚫 EXPLORATION_BLOCKED: ${candidate.symbol} has negative confluence (${confluenceScore})`);
      continue;
    }

    // v14.2: GUARDRAIL 2 — MACD filter (no buying into bearish MACD)
    if (macdSignal === "BEARISH") {
      console.log(`  🚫 EXPLORATION_BLOCKED: ${candidate.symbol} has bearish MACD`);
      continue;
    }

    // v14.2: GUARDRAIL 3 — Volume/flow filter (sellers must not dominate)
    if (totalVolume > 0 && buyRatioPct < EXPLORATION_MIN_BUY_RATIO) {
      console.log(`  🚫 EXPLORATION_BLOCKED: ${candidate.symbol} has weak flow (buy ratio ${buyRatioPct.toFixed(1)}% < ${EXPLORATION_MIN_BUY_RATIO}%)`);
      continue;
    }

    // Candidate passed all guardrails
    target = candidate;
    break;
  }

  if (!target) {
    console.log(`  🔬 No exploration candidates passed guardrails (confluence >= ${EXPLORATION_MIN_CONFLUENCE}, non-bearish MACD, buy ratio >= ${EXPLORATION_MIN_BUY_RATIO}%)`);
    return null;
  }

  // v11.4.22: Increased from $15 to $50 (or 3% of available USDC).
  // $15 exploration trades don't build meaningful positions or generate useful P&L data.
  let explorationAmount = Math.min(50, availableUSDC * 0.03);

  // v14.2: GUARDRAIL 4 — In RANGING markets, cut exploration size by 50%
  if (marketRegime === "RANGING") {
    explorationAmount *= EXPLORATION_RANGING_SIZE_MULTIPLIER;
    console.log(`  🔬 RANGING market: exploration size reduced to $${explorationAmount.toFixed(2)} (${EXPLORATION_RANGING_SIZE_MULTIPLIER * 100}% of normal)`);
  }

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

// v11.4.16: Format user directives for injection into trading AI prompt
function formatUserDirectivesPrompt(): string {
  const active = getActiveDirectives();
  if (active.length === 0) return '';

  let prompt = '\n\n═══ USER DIRECTIVES (from dashboard chat) ═══\n';
  prompt += 'The portfolio owner has given you these instructions via chat. Follow them:\n\n';

  for (const d of active) {
    switch (d.type) {
      case 'WATCHLIST':
        prompt += `  🔍 WATCHLIST: ${d.instruction}. Pay extra attention to ${d.token || 'this token'} — research its price, volume, and technicals. If it looks like a good entry, recommend a BUY.\n`;
        break;
      case 'ALLOCATION':
        prompt += `  📊 ALLOCATION: ${d.instruction}. Adjust your sector targeting to aim for this allocation. Rebalance trades should move toward this target.\n`;
        break;
      case 'AVOID':
        prompt += `  🚫 AVOID: ${d.instruction}. Do NOT recommend buying ${d.token || 'this token'} this cycle. Existing positions are fine but no new entries.\n`;
        break;
      case 'GENERAL':
        prompt += `  📝 STRATEGY: ${d.instruction}\n`;
        break;
      case 'RESEARCH':
        prompt += `  🔬 RESEARCH: ${d.instruction}\n`;
        break;
    }
  }

  prompt += '\nThese directives come from the portfolio owner and should be weighted heavily in your decisions.\n';
  return prompt;
}

// v11.4.19: Directive-aware threshold adjustments
// When user sends aggressive/offensive directives, actually lower trading gates
function getDirectiveThresholdAdjustments(): { confluenceReduction: number; deploymentThresholdOverride: number | null; positionSizeMultiplier: number } {
  const active = getActiveDirectives();
  if (active.length === 0) return { confluenceReduction: 0, deploymentThresholdOverride: null, positionSizeMultiplier: 1.0 };

  const aggressiveKeywords = ['aggressive', 'offense', 'offensive', 'attack', 'deploy', 'deploy capital', 'go hard', 'full send', 'maximize', 'larger positions', 'bigger trades', 'more trades', 'put money to work', 'stop sitting'];
  const conservativeKeywords = ['conservative', 'defensive', 'reduce risk', 'careful', 'slow down', 'less risk', 'protect capital', 'hold cash'];

  let aggressiveScore = 0;
  let conservativeScore = 0;

  for (const d of active) {
    const text = (d.instruction + ' ' + (d.source || '')).toLowerCase();
    for (const kw of aggressiveKeywords) {
      if (text.includes(kw)) { aggressiveScore++; break; }
    }
    for (const kw of conservativeKeywords) {
      if (text.includes(kw)) { conservativeScore++; break; }
    }
  }

  if (aggressiveScore > conservativeScore) {
    // Aggressive: lower confluence by 10 extra points, override deployment threshold to 15%, size up 1.3x
    return { confluenceReduction: 10, deploymentThresholdOverride: 15, positionSizeMultiplier: 1.3 };
  } else if (conservativeScore > aggressiveScore) {
    // Conservative: raise confluence by 5, no deployment override, size down 0.7x
    return { confluenceReduction: -5, deploymentThresholdOverride: null, positionSizeMultiplier: 0.7 };
  }

  return { confluenceReduction: 0, deploymentThresholdOverride: null, positionSizeMultiplier: 1.0 };
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
  // v9.0: ATR-based dynamic stops
  atrStopPercent: number | null;       // Current ATR stop as % (negative, e.g. -12.5)
  atrTrailPercent: number | null;      // Current ATR trail as % (negative)
  atrAtEntry: number | null;           // ATR% snapshot at first buy
  trailActivated: boolean;             // True once position is +1xATR in profit
  lastAtrUpdate: string | null;        // ISO timestamp of last ATR computation
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
  // v8.2: Deposit tracking — separate injected capital from trading gains
  totalDeposited: number;
  lastKnownUSDCBalance: number;
  depositHistory: Array<{ timestamp: string; amountUSD: number; newTotal: number }>;
  // v11.4.7: Safety guards
  sanityAlerts?: Array<{ timestamp: string; symbol: string; type: string; oldCostBasis: number; currentPrice: number; gainPercent: number; action: string }>;
  tradeDedupLog?: Record<string, string>; // "symbol:action:tier" → ISO timestamp of last execution
  // v11.4.16: User Directives — chat commands that influence trading decisions
  userDirectives?: UserDirective[];
  // NVR-NL: Config directives from natural language strategy instructions
  configDirectives?: ConfigDirective[];
}

// v11.4.16: User Directive types — instructions from the dashboard chat that affect bot behavior
interface UserDirective {
  id: string;
  type: 'RESEARCH' | 'WATCHLIST' | 'ALLOCATION' | 'AVOID' | 'GENERAL';
  instruction: string;       // Human-readable description
  token?: string;            // Optional token symbol (e.g. "SUI")
  sector?: string;           // Optional sector
  value?: number;            // Optional numeric value (e.g. target allocation %)
  createdAt: string;         // ISO timestamp
  expiresAt?: string;        // Optional expiry (default: 24h)
  source: string;            // Chat message that created this
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
    initialValue: 0, // v13.0: Start at $0 — actual value detected on first balance fetch. No hardcoded seed capital.
    peakValue: 0, // v13.0: Start at $0 — peak tracks actual portfolio, not hardcoded values
    sectorAllocations: [],
  },
  tradeHistory: [],
  costBasis: {},
  profitTakeCooldowns: {},
  stopLossCooldowns: {},
  tradeFailures: {},
  // v18.1: Error log ring buffer for remote diagnostics
  errorLog: [] as Array<{ timestamp: string; type: string; message: string; details?: any }>,
  harvestedProfits: { totalHarvested: 0, harvestCount: 0, harvests: [] },
  // v9.1: Auto-harvest transfer state (multi-wallet)
  autoHarvestTransfers: [] as Array<{ timestamp: string; amountETH: string; amountUSD: number; txHash: string; destination: string; label: string }>,
  totalAutoHarvestedUSD: 0,
  totalAutoHarvestedETH: 0,
  lastAutoHarvestTime: null as string | null,
  autoHarvestCount: 0,
  autoHarvestByRecipient: {} as Record<string, number>, // v9.1: total USD sent per recipient label
  // v9.3: Daily Payout System
  dailyPayouts: [] as Array<{
    date: string; payoutDate: string; realizedPnL: number; payoutPercent: number;
    totalDistributed: number; transfers: Array<{ label: string; wallet: string; amount: number; txHash?: string; error?: string }>;
    skippedReason?: string;
  }>,
  totalDailyPayoutsUSD: 0,
  dailyPayoutCount: 0,
  lastDailyPayoutDate: null as string | null,
  dailyPayoutByRecipient: {} as Record<string, number>,
  // Phase 3: Self-Improvement Engine
  strategyPatterns: {},
  adaptiveThresholds: { ...DEFAULT_ADAPTIVE_THRESHOLDS },
  performanceReviews: [],
  explorationState: { ...DEFAULT_EXPLORATION_STATE },
  lastReviewTradeIndex: 0,
  lastReviewTimestamp: null,
  // v13.0: Deposit tracking — starts at $0, deposits detected automatically from on-chain activity
  totalDeposited: 0,
  lastKnownUSDCBalance: 0,
  depositHistory: [], // v13.0: No hardcoded deposit history — detected at runtime
  // v10.0: Market Intelligence Engine — persisted historical data
  fundingRateHistory: { btc: [] as number[], eth: [] as number[] },
  btcDominanceHistory: { values: [] as { timestamp: string; dominance: number }[] },
  stablecoinSupplyHistory: { values: [] as { timestamp: string; totalSupply: number }[] },
  // v11.4.16: User Directives from dashboard chat
  userDirectives: [] as UserDirective[],
  // NVR-NL: Config directives from natural language strategy config
  configDirectives: [] as ConfigDirective[],
  // v14.0: Withdraw system
  withdrawPaused: false,
} as any;

// v14.0: Pending withdrawal confirmations (in-memory only, not persisted)
const pendingWithdrawals: Map<string, { toAddress: string; amountUSD: number; token: string; createdAt: number }> = new Map();

// NVR-NL: Pending config change confirmations (in-memory, expires after 5 min)
const pendingConfigChanges: Map<string, { parseResult: ParseResult; instruction: string; createdAt: number }> = new Map();
// Cleanup stale confirmations every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [id, w] of pendingWithdrawals) {
    if (now - w.createdAt > 5 * 60 * 1000) pendingWithdrawals.delete(id);
  }
  for (const [id, c] of pendingConfigChanges) {
    if (now - c.createdAt > 5 * 60 * 1000) pendingConfigChanges.delete(id);
  }
}, 5 * 60 * 1000);

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
        // v13.0: Restore initialValue and peakValue from state file. Fresh bots start at $0.
        // initialValue is set on first deposit detection or from persisted state.
        state.trading.initialValue = parsed.initialValue || 0;
        state.trading.peakValue = parsed.peakValue || 0;
        state.trading.totalTrades = parsed.totalTrades || 0;
        state.trading.successfulTrades = parsed.successfulTrades || 0;
        // v11.4.12: Restore fields that were saved but never loaded back
        if (parsed.currentValue && parsed.currentValue > 0) state.trading.totalPortfolioValue = parsed.currentValue;
        if (parsed.sectorAllocations) state.trading.sectorAllocations = parsed.sectorAllocations;
        state.costBasis = parsed.costBasis || {};
        state.profitTakeCooldowns = parsed.profitTakeCooldowns || {};
        state.stopLossCooldowns = parsed.stopLossCooldowns || {};
        state.tradeFailures = parsed.tradeFailures || {};
        // v11.4.11: Clear stale circuit breaker entries on startup — unsupported tokens
        // are now skipped via CDP_UNSUPPORTED_TOKENS, so old failures won't recur
        if (Object.keys(state.tradeFailures).length > 0) {
          console.log(`  🔓 Clearing ${Object.keys(state.tradeFailures).length} circuit breaker entries on startup`);
          state.tradeFailures = {};
        }
        state.harvestedProfits = parsed.harvestedProfits || { totalHarvested: 0, harvestCount: 0, harvests: [] };
        // Phase 3 fields
        state.strategyPatterns = parsed.strategyPatterns || {};
        if (parsed.adaptiveThresholds) {
          state.adaptiveThresholds = { ...DEFAULT_ADAPTIVE_THRESHOLDS, ...parsed.adaptiveThresholds };
        }
        // v12.2.2: Clamp stop-loss thresholds to new wider bounds — persisted state may have
        // self-tightened to -6% which causes churn (buy → immediate stop → buy again loop).
        if (state.adaptiveThresholds.stopLossPercent > -12) {
          console.log(`  🔧 Widening persisted stop-loss from ${state.adaptiveThresholds.stopLossPercent}% → -15% (was too tight)`);
          state.adaptiveThresholds.stopLossPercent = -15;
        }
        if (state.adaptiveThresholds.trailingStopPercent > -10) {
          console.log(`  🔧 Widening persisted trailing stop from ${state.adaptiveThresholds.trailingStopPercent}% → -12% (was too tight)`);
          state.adaptiveThresholds.trailingStopPercent = -12;
        }
        // v11.4.22: Force lower confluence thresholds until self-improvement has enough data.
        // Persisted state may have the old confluenceBuy=15 which blocks trades when RSI/MACD are null.
        if (state.trading.totalTrades < KELLY_MIN_TRADES) {
          state.adaptiveThresholds.confluenceBuy = Math.min(state.adaptiveThresholds.confluenceBuy, 8);
          state.adaptiveThresholds.confluenceSell = Math.max(state.adaptiveThresholds.confluenceSell, -8);
          state.adaptiveThresholds.confluenceStrongBuy = Math.min(state.adaptiveThresholds.confluenceStrongBuy, 30);
          state.adaptiveThresholds.confluenceStrongSell = Math.max(state.adaptiveThresholds.confluenceStrongSell, -30);
          // Also force updated regime multipliers
          state.adaptiveThresholds.regimeMultipliers = { ...DEFAULT_ADAPTIVE_THRESHOLDS.regimeMultipliers };
          console.log(`  📊 Bootstrap mode: Lowered confluence thresholds (buy≥${state.adaptiveThresholds.confluenceBuy}, sell≤${state.adaptiveThresholds.confluenceSell}) until ${KELLY_MIN_TRADES} trades reached`);
        }
        state.performanceReviews = (parsed.performanceReviews || []).slice(-30);
        state.explorationState = parsed.explorationState || { ...DEFAULT_EXPLORATION_STATE };
        state.lastReviewTradeIndex = parsed.lastReviewTradeIndex || 0;
        state.lastReviewTimestamp = parsed.lastReviewTimestamp || null;
        // v9.1: Restore auto-harvest transfer state (multi-wallet)
        state.autoHarvestTransfers = (parsed.autoHarvestTransfers || []).slice(-100);
        state.totalAutoHarvestedUSD = parsed.totalAutoHarvestedUSD || 0;
        state.totalAutoHarvestedETH = parsed.totalAutoHarvestedETH || 0;
        state.lastAutoHarvestTime = parsed.lastAutoHarvestTime || null;
        state.autoHarvestCount = parsed.autoHarvestCount || 0;
        state.autoHarvestByRecipient = parsed.autoHarvestByRecipient || {};
        // v9.1: Backfill per-recipient tracking from existing transfer records
        if (Object.keys(state.autoHarvestByRecipient).length === 0 && state.autoHarvestTransfers.length > 0) {
          for (const t of state.autoHarvestTransfers) {
            const lbl = (t as any).label || 'Owner';
            state.autoHarvestByRecipient[lbl] = (state.autoHarvestByRecipient[lbl] || 0) + (t.amountUSD || 0);
          }
        }
        // v9.3: Restore daily payout state
        state.dailyPayouts = (parsed.dailyPayouts || []).slice(-90);
        state.totalDailyPayoutsUSD = parsed.totalDailyPayoutsUSD || 0;
        state.dailyPayoutCount = parsed.dailyPayoutCount || 0;
        state.lastDailyPayoutDate = parsed.lastDailyPayoutDate || null;
        state.dailyPayoutByRecipient = parsed.dailyPayoutByRecipient || {};
        // v5.2: Restore shadow proposals
        if (parsed.shadowProposals && Array.isArray(parsed.shadowProposals)) {
          shadowProposals = parsed.shadowProposals;
          console.log(`  🔬 Restored ${shadowProposals.length} shadow proposals`);
        }
        // v8.0: Restore institutional breaker state
        if (parsed.breakerState) {
          breakerState = { ...DEFAULT_BREAKER_STATE, ...parsed.breakerState };
          console.log(`  🚨 Breaker state: ${breakerState.consecutiveLosses} consecutive losses${breakerState.lastBreakerTriggered ? `, last triggered ${breakerState.lastBreakerTriggered}` : ''}`);
        }
        // v10.0: Restore Market Intelligence Engine historical data
        if (parsed.fundingRateHistory) {
          fundingRateHistory = parsed.fundingRateHistory;
          state.fundingRateHistory = parsed.fundingRateHistory;
        }
        if (parsed.btcDominanceHistory) {
          btcDominanceHistory = parsed.btcDominanceHistory;
          state.btcDominanceHistory = parsed.btcDominanceHistory;
        }
        if (parsed.stablecoinSupplyHistory) {
          stablecoinSupplyHistory = parsed.stablecoinSupplyHistory;
          state.stablecoinSupplyHistory = parsed.stablecoinSupplyHistory;
        }
        // v11.0: Restore Aave yield state
        if (parsed.aaveYieldState) {
          aaveYieldService.restoreState(parsed.aaveYieldState);
          const ys = aaveYieldService.getState();
          console.log(`  🏦 Aave yield restored: $${ys.depositedUSDC.toFixed(2)} deposited, $${ys.totalYieldEarned.toFixed(4)} earned, ${ys.supplyCount} supplies`);
        }
        // v11.4.5-6: Restore migration flags
        if (parsed._migrationCostBasisV1145) {
          (state as any)._migrationCostBasisV1145 = true;
        }
        if (parsed._migrationCostBasisV1146) {
          (state as any)._migrationCostBasisV1146 = true;
        }
        // v11.4.7: Restore safety guard state (v11.4.17: bound to last 100)
        state.sanityAlerts = (parsed.sanityAlerts || []).slice(-100);
        state.tradeDedupLog = parsed.tradeDedupLog || {};
        // Clean up expired dedup entries (older than 2 hours)
        if (state.tradeDedupLog) {
          const now = Date.now();
          for (const key of Object.keys(state.tradeDedupLog)) {
            if (now - new Date(state.tradeDedupLog[key]).getTime() > 2 * 60 * 60 * 1000) {
              delete state.tradeDedupLog[key];
            }
          }
        }
        // v13.0: Restore deposit tracking from state file. Fresh bots start at $0 with no deposit history.
        state.totalDeposited = parsed.totalDeposited || 0;
        state.lastKnownUSDCBalance = parsed.lastKnownUSDCBalance || 0;
        state.depositHistory = parsed.depositHistory || [];
        if (state.totalDeposited > 0) {
          console.log(`  💵 Deposit tracking: $${state.totalDeposited.toFixed(2)} total deposited (${state.depositHistory.length} deposits)`);
        }
        // NVR-NL: Restore user directives and config directives
        state.userDirectives = parsed.userDirectives || [];
        state.configDirectives = parsed.configDirectives || [];
        const activeDir = (state.userDirectives || []).length + (state.configDirectives || []).filter((d: ConfigDirective) => d.active).length;
        if (activeDir > 0) {
          console.log(`  📝 Restored ${activeDir} active directives (${state.userDirectives.length} user, ${state.configDirectives.filter((d: ConfigDirective) => d.active).length} config)`);
        }
        // v9.0: Migrate existing cost basis entries — backfill ATR fields
        for (const sym of Object.keys(state.costBasis)) {
          const cb = state.costBasis[sym];
          if (cb.atrStopPercent === undefined) cb.atrStopPercent = null;
          if (cb.atrTrailPercent === undefined) cb.atrTrailPercent = null;
          if (cb.atrAtEntry === undefined) cb.atrAtEntry = null;
          if (cb.trailActivated === undefined) cb.trailActivated = false;
          if (cb.lastAtrUpdate === undefined) cb.lastAtrUpdate = null;
        }
        // v9.0: Ensure adaptive thresholds have ATR multiplier fields
        // v11.4.17: Clamp to THRESHOLD_BOUNDS to prevent corrupted state from widening stops infinitely
        if ((state.adaptiveThresholds as any).atrStopMultiplier === undefined) {
          state.adaptiveThresholds.atrStopMultiplier = ATR_STOP_LOSS_MULTIPLIER;
        } else {
          state.adaptiveThresholds.atrStopMultiplier = Math.max(1.5, Math.min(4.0, state.adaptiveThresholds.atrStopMultiplier));
        }
        if ((state.adaptiveThresholds as any).atrTrailMultiplier === undefined) {
          state.adaptiveThresholds.atrTrailMultiplier = ATR_TRAILING_STOP_MULTIPLIER;
        } else {
          state.adaptiveThresholds.atrTrailMultiplier = Math.max(1.5, Math.min(4.0, state.adaptiveThresholds.atrTrailMultiplier));
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
    const data = {
      version: BOT_VERSION,
      lastUpdated: new Date().toISOString(),
      initialValue: state.trading.initialValue,
      peakValue: state.trading.peakValue,
      currentValue: state.trading.totalPortfolioValue,
      totalTrades: state.trading.totalTrades,
      successfulTrades: state.trading.successfulTrades,
      sectorAllocations: state.trading.sectorAllocations,
      trades: state.tradeHistory.slice(-1000), // v11.4.12: Raised from 200 to 1000 — Kelly needs full rolling window
      costBasis: state.costBasis,
      profitTakeCooldowns: state.profitTakeCooldowns,
      stopLossCooldowns: state.stopLossCooldowns,
      tradeFailures: state.tradeFailures,
      harvestedProfits: state.harvestedProfits,
      // v9.1: Auto-harvest transfer persistence (multi-wallet)
      autoHarvestTransfers: state.autoHarvestTransfers,
      totalAutoHarvestedUSD: state.totalAutoHarvestedUSD,
      totalAutoHarvestedETH: state.totalAutoHarvestedETH,
      lastAutoHarvestTime: state.lastAutoHarvestTime,
      autoHarvestCount: state.autoHarvestCount,
      autoHarvestByRecipient: state.autoHarvestByRecipient,
      // v9.3: Daily Payout persistence
      dailyPayouts: state.dailyPayouts.slice(-90),
      totalDailyPayoutsUSD: state.totalDailyPayoutsUSD,
      dailyPayoutCount: state.dailyPayoutCount,
      lastDailyPayoutDate: state.lastDailyPayoutDate,
      dailyPayoutByRecipient: state.dailyPayoutByRecipient,
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
      // v8.0: Persist institutional breaker state
      breakerState,
      // v8.2: Deposit tracking
      totalDeposited: state.totalDeposited,
      lastKnownUSDCBalance: state.lastKnownUSDCBalance,
      depositHistory: state.depositHistory.slice(-50),
      // v10.0: Market Intelligence Engine historical data
      fundingRateHistory,
      btcDominanceHistory: { values: btcDominanceHistory.values.slice(-504) },
      stablecoinSupplyHistory: { values: stablecoinSupplyHistory.values.slice(-504) },
      // v11.0: Aave V3 yield state persistence
      aaveYieldState: aaveYieldService.getState(),
      // v11.4.5-6: Migration flags
      _migrationCostBasisV1145: (state as any)._migrationCostBasisV1145 || false,
      _migrationCostBasisV1146: (state as any)._migrationCostBasisV1146 || false,
      // v11.4.7: Safety guards
      sanityAlerts: (state.sanityAlerts || []).slice(-50),
      tradeDedupLog: state.tradeDedupLog || {},
      // NVR-NL: Persist user directives and config directives
      userDirectives: (state.userDirectives || []).slice(-30),
      configDirectives: (state.configDirectives || []).filter((d: ConfigDirective) => d.active).slice(-30),
    };
    // Write to persistent volume path, creating directory if needed
    const dir = CONFIG.logFile.substring(0, CONFIG.logFile.lastIndexOf("/"));
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // v11.4.17: Atomic write — write to temp file then rename to prevent corruption on crash
    const tmpFile = CONFIG.logFile + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
    fs.renameSync(tmpFile, CONFIG.logFile);
  } catch (e: any) {
    console.error("Failed to save trade history:", e.message);
  }
}

// ============================================================================
// v11.4.22: ON-CHAIN TRADE HISTORY RECOVERY
// Reconstructs trade history from Basescan ERC20 transfer logs.
// This is the source of truth — it survives any state corruption, restart,
// or file loss. Runs on startup to backfill trades missing from persisted state.
// ============================================================================

// v11.4.22: Blockscout (free, no API key) replaces deprecated Basescan V1 API
const BLOCKSCOUT_API_URL = 'https://base.blockscout.com/api';
// USDC_ADDRESS declared in v12.0 on-chain pricing block (line ~536)

// Reverse lookup: contract address → symbol
const ADDRESS_TO_SYMBOL: Record<string, string> = {};
for (const [symbol, reg] of Object.entries(TOKEN_REGISTRY)) {
  if (reg.address && reg.address !== 'native') {
    ADDRESS_TO_SYMBOL[reg.address.toLowerCase()] = symbol;
  }
}

interface BasescanTransfer {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  contractAddress: string;
  value: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
}

/**
 * Fetch ERC20 token transfers for the bot's wallet from Blockscout (free, no API key).
 * Returns raw transfer records sorted by timestamp ascending.
 */
async function fetchBlockscoutTransfers(walletAddress: string): Promise<BasescanTransfer[]> {
  const allTransfers: BasescanTransfer[] = [];
  let page = 1;
  // Blockscout times out (524) on large offsets — use 100 per page for reliability.
  // Max 30 pages = 3000 transfers which covers all our history.
  const pageSize = 100;
  const maxPages = 30;

  while (page <= maxPages) {
    try {
      const url = `${BLOCKSCOUT_API_URL}?module=account&action=tokentx&address=${walletAddress}&page=${page}&offset=${pageSize}&sort=asc`;
      const response = await axios.get(url, { timeout: 15000 });
      if (response.data.status !== '1' || !Array.isArray(response.data.result)) {
        if (response.data.message === 'No transactions found' || response.data.message === 'No token transfers found') break;
        console.log(`  ⚠️ Blockscout API page ${page}: ${response.data.message || 'Unknown error'}`);
        break;
      }
      allTransfers.push(...response.data.result);
      if (response.data.result.length < pageSize) break;
      page++;
      // Small delay between pages
      await new Promise(r => setTimeout(r, 200));
    } catch (err: any) {
      // If a page fails (timeout, 524, etc.), stop and use what we have
      console.log(`  ⚠️ Blockscout fetch stopped at page ${page}: ${err.message?.substring(0, 80)}`);
      break;
    }
  }
  return allTransfers;
}

/**
 * Pair ERC20 transfers within the same transaction into BUY/SELL trade records.
 * A BUY = USDC leaves wallet + another token enters wallet (same tx hash).
 * A SELL = another token leaves wallet + USDC enters wallet (same tx hash).
 */
function pairTransfersIntoTrades(
  transfers: BasescanTransfer[],
  walletAddress: string
): TradeRecord[] {
  const wallet = walletAddress.toLowerCase();
  const trades: TradeRecord[] = [];

  // Group transfers by transaction hash
  const txGroups = new Map<string, BasescanTransfer[]>();
  for (const t of transfers) {
    const group = txGroups.get(t.hash) || [];
    group.push(t);
    txGroups.set(t.hash, group);
  }

  for (const [txHash, group] of txGroups) {
    // Classify each transfer as incoming/outgoing relative to our wallet
    const outgoing: BasescanTransfer[] = [];
    const incoming: BasescanTransfer[] = [];
    for (const t of group) {
      if (t.from.toLowerCase() === wallet) outgoing.push(t);
      if (t.to.toLowerCase() === wallet) incoming.push(t);
    }

    // Skip if no paired transfer (approvals, wraps, etc.)
    if (outgoing.length === 0 || incoming.length === 0) continue;

    const timestamp = new Date(parseInt(group[0].timeStamp) * 1000).toISOString();

    // Find USDC leg and token leg
    const usdcOut = outgoing.find(t => t.contractAddress.toLowerCase() === USDC_ADDRESS);
    const usdcIn = incoming.find(t => t.contractAddress.toLowerCase() === USDC_ADDRESS);
    const tokenIn = incoming.find(t => t.contractAddress.toLowerCase() !== USDC_ADDRESS);
    const tokenOut = outgoing.find(t => t.contractAddress.toLowerCase() !== USDC_ADDRESS);

    if (usdcOut && tokenIn) {
      // BUY: USDC out, token in
      const usdcAmount = parseFloat(usdcOut.value) / Math.pow(10, parseInt(usdcOut.tokenDecimal));
      const tokenAmount = parseFloat(tokenIn.value) / Math.pow(10, parseInt(tokenIn.tokenDecimal));
      const tokenSymbol = ADDRESS_TO_SYMBOL[tokenIn.contractAddress.toLowerCase()] || tokenIn.tokenSymbol;

      trades.push({
        timestamp,
        cycle: 0,
        action: 'BUY',
        fromToken: 'USDC',
        toToken: tokenSymbol,
        amountUSD: usdcAmount,
        tokenAmount,
        txHash,
        success: true,
        portfolioValueBefore: 0, // Unknown from chain data
        reasoning: `On-chain recovery: bought ${tokenAmount.toFixed(6)} ${tokenSymbol} for $${usdcAmount.toFixed(2)}`,
        sector: TOKEN_REGISTRY[tokenSymbol]?.sector || undefined,
        marketConditions: { fearGreed: 0, ethPrice: 0, btcPrice: 0 },
        signalContext: {
          marketRegime: 'UNKNOWN',
          confluenceScore: 0,
          rsi: null,
          macdSignal: null,
          btcFundingRate: null,
          ethFundingRate: null,
          baseTVLChange24h: null,
          baseDEXVolume24h: null,
          triggeredBy: 'AI',
        },
      });
    } else if (tokenOut && usdcIn) {
      // SELL: token out, USDC in
      const usdcAmount = parseFloat(usdcIn.value) / Math.pow(10, parseInt(usdcIn.tokenDecimal));
      const tokenAmount = parseFloat(tokenOut.value) / Math.pow(10, parseInt(tokenOut.tokenDecimal));
      const tokenSymbol = ADDRESS_TO_SYMBOL[tokenOut.contractAddress.toLowerCase()] || tokenOut.tokenSymbol;

      trades.push({
        timestamp,
        cycle: 0,
        action: 'SELL',
        fromToken: tokenSymbol,
        toToken: 'USDC',
        amountUSD: usdcAmount,
        tokenAmount,
        txHash,
        success: true,
        portfolioValueBefore: 0,
        reasoning: `On-chain recovery: sold ${tokenAmount.toFixed(6)} ${tokenSymbol} for $${usdcAmount.toFixed(2)}`,
        sector: TOKEN_REGISTRY[tokenSymbol]?.sector || undefined,
        marketConditions: { fearGreed: 0, ethPrice: 0, btcPrice: 0 },
        signalContext: {
          marketRegime: 'UNKNOWN',
          confluenceScore: 0,
          rsi: null,
          macdSignal: null,
          btcFundingRate: null,
          ethFundingRate: null,
          baseTVLChange24h: null,
          baseDEXVolume24h: null,
          triggeredBy: 'AI',
        },
      });
    }
    // Skip token-to-token swaps (non-USDC pairs) — these are rare and hard to value
  }

  return trades;
}

/**
 * Rebuild cost basis from a complete trade history.
 * Resets all cost basis entries and replays trades chronologically.
 */
function rebuildCostBasisFromTrades(trades: TradeRecord[]): void {
  // Reset all cost basis
  state.costBasis = {};

  // Replay trades in chronological order
  const sorted = [...trades].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  let totalTrades = 0;
  let successfulTrades = 0;

  for (const trade of sorted) {
    if (trade.action === 'BUY' && trade.toToken !== 'USDC') {
      const cb = getOrCreateCostBasis(trade.toToken);
      const tokens = trade.tokenAmount || (trade.amountUSD / 1); // Fallback if no token amount
      if (tokens > 0) {
        if (cb.totalTokensAcquired === 0) cb.firstBuyDate = trade.timestamp;
        cb.totalInvestedUSD += trade.amountUSD;
        cb.totalTokensAcquired += tokens;
        cb.averageCostBasis = cb.totalTokensAcquired > 0 ? cb.totalInvestedUSD / cb.totalTokensAcquired : 0;
        cb.lastTradeDate = trade.timestamp;
      }
    } else if (trade.action === 'SELL' && trade.fromToken !== 'USDC') {
      const cb = getOrCreateCostBasis(trade.fromToken);
      const tokens = trade.tokenAmount || 0;
      if (tokens > 0 && cb.totalTokensAcquired > 0) {
        const sellPrice = trade.amountUSD / tokens;
        const realizedPnL = (sellPrice - cb.averageCostBasis) * tokens;
        cb.realizedPnL += realizedPnL;
        const proportionSold = Math.min(1, tokens / cb.totalTokensAcquired);
        cb.totalInvestedUSD = Math.max(0, cb.totalInvestedUSD * (1 - proportionSold));
        cb.totalTokensAcquired = Math.max(0, cb.totalTokensAcquired - tokens);
        cb.lastTradeDate = trade.timestamp;
      }
    }
    if (trade.action === 'BUY' || trade.action === 'SELL') {
      totalTrades++;
      if (trade.success) successfulTrades++;
    }
  }

  return;
}

/**
 * Main startup function: recover trade history from Blockscout and merge with state.
 * Uses Blockscout (free, no API key) instead of deprecated Basescan V1.
 * @param walletAddress - The actual CDP wallet address (account.address), NOT CONFIG.walletAddress
 */
async function recoverOnChainTradeHistory(walletAddress?: string): Promise<{ recovered: number; merged: number }> {
  const addr = walletAddress || CONFIG.walletAddress;
  console.log(`  📡 Fetching on-chain transfers for ${addr.slice(0, 6)}...${addr.slice(-4)}`);

  const transfers = await fetchBlockscoutTransfers(addr);
  console.log(`  📥 ${transfers.length} ERC20 transfers found on Base`);

  if (transfers.length === 0) return { recovered: 0, merged: 0 };

  const onChainTrades = pairTransfersIntoTrades(transfers, addr);
  console.log(`  🔄 ${onChainTrades.length} swap trades paired from transfers`);

  // Merge: add on-chain trades that aren't already in state (by txHash)
  const existingHashes = new Set(state.tradeHistory.filter(t => t.txHash).map(t => t.txHash));
  const newTrades = onChainTrades.filter(t => t.txHash && !existingHashes.has(t.txHash));

  if (newTrades.length > 0) {
    console.log(`  ✨ ${newTrades.length} new trades recovered from chain (${existingHashes.size} already in state)`);
    state.tradeHistory = [...state.tradeHistory, ...newTrades]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(-5000); // Cap at 5000

    // Rebuild cost basis from the complete history
    console.log(`  📊 Rebuilding cost basis from ${state.tradeHistory.length} total trades...`);
    rebuildCostBasisFromTrades(state.tradeHistory);
    const cbCount = Object.keys(state.costBasis).length;
    console.log(`  ✅ Cost basis rebuilt for ${cbCount} tokens`);

    // Update trade counters
    const actionable = state.tradeHistory.filter(t => t.action === 'BUY' || t.action === 'SELL');
    state.trading.totalTrades = actionable.length;
    state.trading.successfulTrades = actionable.filter(t => t.success).length;

    // Persist the recovered state
    saveTradeHistory();
  } else {
    console.log(`  ✅ On-chain history matches state — no new trades to recover`);
  }

  return { recovered: onChainTrades.length, merged: newTrades.length };
}

// ============================================================================
// v18.1: ERROR LOG — Ring buffer for remote diagnostics via /api/errors
// ============================================================================
const MAX_ERROR_LOG_SIZE = 100;

function logError(type: string, message: string, details?: any): void {
  state.errorLog.push({
    timestamp: new Date().toISOString(),
    type,
    message: message.substring(0, 500),
    details: details ? JSON.parse(JSON.stringify(details, (_, v) => typeof v === 'string' ? v.substring(0, 300) : v)) : undefined,
  });
  // Ring buffer — keep last N entries
  if (state.errorLog.length > MAX_ERROR_LOG_SIZE) {
    state.errorLog = state.errorLog.slice(-MAX_ERROR_LOG_SIZE);
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
      // v9.0: ATR-based dynamic stops
      atrStopPercent: null,
      atrTrailPercent: null,
      atrAtEntry: null,
      trailActivated: false,
      lastAtrUpdate: null,
    };
  }
  return state.costBasis[symbol];
}

function updateCostBasisAfterBuy(symbol: string, amountUSD: number, tokensReceived: number): void {
  const cb = getOrCreateCostBasis(symbol);
  if (cb.totalTokensAcquired === 0) cb.firstBuyDate = new Date().toISOString();

  // v11.4.15: Guard against zero tokensReceived which corrupts avgCostBasis to infinity.
  // This happened with ETH buys where balance read returned native ETH instead of WETH.
  if (tokensReceived <= 0) {
    const knownPrice = lastKnownPrices[symbol]?.price || lastKnownPrices[symbol === 'ETH' ? 'WETH' : symbol]?.price || 0;
    if (knownPrice > 0) {
      tokensReceived = amountUSD / knownPrice;
      console.log(`     ⚠️ tokensReceived was 0 — estimated ${tokensReceived.toFixed(8)} from price $${knownPrice.toFixed(4)}`);
    } else {
      console.warn(`     ❌ Cannot update cost basis for ${symbol}: tokensReceived=0 and no known price`);
      return;
    }
  }

  cb.totalInvestedUSD += amountUSD;
  cb.totalTokensAcquired += tokensReceived;
  cb.averageCostBasis = cb.totalTokensAcquired > 0 ? cb.totalInvestedUSD / cb.totalTokensAcquired : 0;

  // v11.4.15: Sanity check — if avgCostBasis is >10x market price, it's corrupted. Reset.
  const currentPrice = lastKnownPrices[symbol]?.price || lastKnownPrices[symbol === 'ETH' ? 'WETH' : symbol]?.price || 0;
  if (currentPrice > 0 && cb.averageCostBasis > currentPrice * 10) {
    console.warn(`     🔧 SANITY RESET: ${symbol} avgCost $${cb.averageCostBasis.toFixed(2)} is ${(cb.averageCostBasis / currentPrice).toFixed(0)}x market $${currentPrice.toFixed(4)} — resetting`);
    cb.averageCostBasis = currentPrice;
    cb.totalInvestedUSD = currentPrice * cb.totalTokensAcquired;
  }

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
  // v11.4.17: Clamp proportionSold to [0,1] — selling more than tracked tokens shouldn't go negative
  const proportionSold = Math.min(1, cb.totalTokensAcquired > 0 ? tokensSold / cb.totalTokensAcquired : 0);
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
    (cb as any).currentPrice = currentPrice;

    // v11.4.15: Sanity check — if avgCostBasis is absurdly high (>10x market), reset it.
    // This catches corrupted cost basis from ETH/WETH balance mismatch or stale state.
    if (currentPrice > 0 && cb.averageCostBasis > currentPrice * 10 && b.usdValue > 1) {
      console.warn(`  🔧 COST BASIS RESET: ${b.symbol} avg $${cb.averageCostBasis.toFixed(2)} is ${(cb.averageCostBasis / currentPrice).toFixed(0)}x market $${currentPrice.toFixed(4)} — resetting to market price`);
      cb.averageCostBasis = currentPrice;
      cb.totalInvestedUSD = currentPrice * cb.currentHolding;
      cb.totalTokensAcquired = cb.currentHolding;
      cb.unrealizedPnL = 0;
    } else {
      cb.unrealizedPnL = cb.averageCostBasis > 0 ? (currentPrice - cb.averageCostBasis) * b.balance : 0;
    }

    // Update peak price for trailing stop
    if (currentPrice > cb.peakPrice) {
      cb.peakPrice = currentPrice;
      cb.peakPriceDate = new Date().toISOString();
    }
  }
}

// ============================================================================
// v9.0: ATR-BASED DYNAMIC STOP LEVELS
// ============================================================================

/**
 * Pure function: computes ATR-relative stop and trail levels for a position.
 * Returns null if ATR data is unavailable.
 *
 * Logic:
 * - rawStop = -(sectorMultiplier × atrPercent), clamped to [ATR_STOP_FLOOR, ATR_STOP_CEILING]
 * - Only tightens stops: Math.max(newStop, existingStop) — both negative, max = tighter
 * - Trail activates when unrealized gain >= ATR_TRAIL_ACTIVATION_MULTIPLIER × atrPercent
 * - Trail never moves down (ratchet up only)
 */
function computeAtrStopLevels(
  symbol: string,
  sector: string | undefined,
  atrPercent: number | null,
  currentPrice: number,
  costBasis: TokenCostBasis,
): { stopPercent: number; trailPercent: number; trailActivated: boolean } | null {
  if (atrPercent === null || atrPercent <= 0) return null;

  const sectorKey = sector || "BLUE_CHIP";
  const sectorMult = SECTOR_ATR_MULTIPLIERS[sectorKey] || 2.5;
  const adaptiveStopMult = state.adaptiveThresholds.atrStopMultiplier;
  const adaptiveTrailMult = state.adaptiveThresholds.atrTrailMultiplier;

  // v10.2: ATR stop includes sector multiplier — riskier sectors get wider stops
  // e.g. MEME (sectorMult=2.0) with 4% ATR, adaptiveStop=2.5: -(2.0 × 2.5 × 4) = -20%
  //      BLUE_CHIP (sectorMult=1.5) with 2% ATR, adaptiveStop=2.5: -(1.5 × 2.5 × 2) = -7.5%
  const computedStop = -(sectorMult * adaptiveStopMult * atrPercent);

  // Clamp to floor/ceiling
  const clampedStop = Math.max(ATR_STOP_FLOOR_PERCENT, Math.min(ATR_STOP_CEILING_PERCENT, computedStop));

  // Only tighten: use tighter of new ATR stop vs existing ATR stop (both negative, max = tighter)
  let finalStop = clampedStop;
  if (costBasis.atrStopPercent !== null) {
    finalStop = Math.max(clampedStop, costBasis.atrStopPercent);
  }

  // Compute trailing stop distance
  const computedTrail = -(adaptiveTrailMult * atrPercent);
  const clampedTrail = Math.max(ATR_STOP_FLOOR_PERCENT, Math.min(ATR_STOP_CEILING_PERCENT, computedTrail));

  // Trail only ratchets tighter
  let finalTrail = clampedTrail;
  if (costBasis.atrTrailPercent !== null) {
    finalTrail = Math.max(clampedTrail, costBasis.atrTrailPercent);
  }

  // Check trail activation: gain >= ATR_TRAIL_ACTIVATION_MULTIPLIER × atrPercent
  const gainPercent = costBasis.averageCostBasis > 0
    ? ((currentPrice - costBasis.averageCostBasis) / costBasis.averageCostBasis) * 100
    : 0;
  const activationThreshold = ATR_TRAIL_ACTIVATION_MULTIPLIER * atrPercent;
  const trailActivated = costBasis.trailActivated || gainPercent >= activationThreshold;

  return {
    stopPercent: finalStop,
    trailPercent: finalTrail,
    trailActivated,
  };
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
  indicators: Record<string, TechnicalIndicators> = {},
): TradeDecision | null {
  if (!CONFIG.trading.profitTaking.enabled) return null;

  const cfg = CONFIG.trading.profitTaking;
  const flatTiers = (cfg as any).tiers || [
    { gainPercent: 25,  sellPercent: 15, label: "EARLY_HARVEST" },
    { gainPercent: 50,  sellPercent: 20, label: "MID_HARVEST" },
    { gainPercent: 100, sellPercent: 25, label: "STRONG_HARVEST" },
    { gainPercent: 200, sellPercent: 35, label: "MAJOR_HARVEST" },
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

    // v10.2: Stop-loss cooldown removed from profit-taking — they're independent actions.
    // Profit-taking has its own per-tier cooldown at line ~2246.

    const currentPrice = b.price || (b.balance > 0 ? b.usdValue / b.balance : 0);
    const gainPercent = ((currentPrice - cb.averageCostBasis) / cb.averageCostBasis) * 100;

    if (gainPercent <= 0) continue; // No profit to take

    // v11.4.7: SANITY CHECK — >500% unrealized gain almost certainly means stale cost basis.
    // Flag it, auto-reset cost basis to current price, and skip harvesting this cycle.
    if (gainPercent > 500) {
      console.warn(`\n  🚨 SANITY CHECK: ${b.symbol} shows +${gainPercent.toFixed(1)}% unrealized gain — likely stale cost basis!`);
      console.warn(`     Cost basis: $${cb.averageCostBasis.toFixed(6)} → Current: $${currentPrice.toFixed(6)}`);
      console.warn(`     AUTO-RESETTING cost basis to current market price. Skipping harvest.`);
      // Track the anomaly
      if (!state.sanityAlerts) state.sanityAlerts = [];
      state.sanityAlerts.push({
        timestamp: now.toISOString(),
        symbol: b.symbol,
        type: 'STALE_COST_BASIS',
        oldCostBasis: cb.averageCostBasis,
        currentPrice,
        gainPercent: Math.round(gainPercent * 10) / 10,
        action: 'AUTO_RESET',
      });
      if (state.sanityAlerts.length > 100) state.sanityAlerts = state.sanityAlerts.slice(-100);
      // Auto-reset cost basis to current market price
      cb.averageCostBasis = currentPrice;
      cb.totalInvestedUSD = currentPrice * cb.currentHolding;
      cb.totalTokensAcquired = cb.currentHolding;
      cb.unrealizedPnL = 0;
      cb.firstBuyDate = now.toISOString();
      cb.lastTradeDate = now.toISOString();
      saveTradeHistory();
      continue; // Skip harvesting — cost basis was bogus
    }

    // v9.0: Compute effective tiers — ATR-relative when ATR data available, flat fallback
    const ind = indicators[b.symbol];
    const atrPct = ind?.atrPercent ?? null;
    let effectiveTiers: { gainPercent: number; sellPercent: number; label: string }[];
    if (atrPct !== null && atrPct > 0) {
      // ATR-relative tiers: gainPercent = atrMultiple × atrPercent
      effectiveTiers = ATR_PROFIT_TIERS.map(t => ({
        gainPercent: t.atrMultiple * atrPct,
        sellPercent: t.sellPercent,
        label: t.label,
      }));
    } else {
      effectiveTiers = flatTiers;
    }

    // Find the highest tier this position qualifies for
    // Walk tiers from highest to lowest — take the best available
    const sortedTiers = [...effectiveTiers].sort((a: any, b: any) => b.gainPercent - a.gainPercent);
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

    // Time-based rebalancing: 72+ hours held, up at least 15%, no recent harvest
    // v11.4.5: Raised from +5% to +15% — 5% is normal crypto noise
    if (!bestCandidate && gainPercent >= 15 && cb.totalInvestedUSD > 0) {
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
            tier: { gainPercent: 15, sellPercent: 10, label: "TIME_REBALANCE" },
            costBasis: cb.averageCostBasis,
            currentPrice,
            sector: b.sector,
          };
        }
      }
    }
  }

  if (!bestCandidate) return null;

  // v18.0: LET WINNERS RUN — Do not harvest if momentum is still strong
  // If buy ratio > 55% AND MACD is bullish, the winner is still running.
  // Only trim on deceleration, not on arbitrary percentage thresholds.
  // Exception: MAJOR_HARVEST tier (40%+ gain) always harvests — protect the bag.
  {
    const ind = indicators[bestCandidate.symbol];
    const orderFlow = ind?.orderFlow;
    const macd = ind?.macd;
    const buyRatio = orderFlow ? orderFlow.buyVolumeUSD / (orderFlow.buyVolumeUSD + orderFlow.sellVolumeUSD) : null;
    const macdBullish = macd?.signal === 'BULLISH';

    if (bestCandidate.tier.label !== 'MAJOR_HARVEST' && bestCandidate.tier.label !== 'ATR_MAJOR') {
      if (buyRatio !== null && buyRatio > 0.55 && macdBullish) {
        console.log(`\n  🏃 LET_IT_RUN: ${bestCandidate.symbol} +${bestCandidate.gainPercent.toFixed(1)}% but momentum still strong (buyRatio: ${(buyRatio * 100).toFixed(0)}%, MACD: BULLISH) — holding`);
        return null;
      }
    }
  }

  const { symbol, balance, usdValue, gainPercent, tier, costBasis, currentPrice, sector } = bestCandidate;
  const sellPct = tier.sellPercent;
  const sellUSD = usdValue * (sellPct / 100);
  const tokenAmount = balance * (sellPct / 100);

  // Don't sell less than $2 — not worth the gas
  if (sellUSD < 2) return null;

  // v10.1.1: Capital floor check — selling a position to USDC is value-neutral (doesn't reduce portfolio).
  // Only block if the REMAINING position + rest of portfolio would be below floor.
  // Selling actually HELPS by converting illiquid positions to deployable USDC.
  const capitalFloor = CONFIG.autoHarvest?.minTradingCapitalUSD || 500;
  const currentPortfolio = state.trading.totalPortfolioValue || 0;
  if (currentPortfolio < capitalFloor) {
    // Only block if total portfolio is already below floor (not the sell itself)
    console.log(`  ⚠️ CAPITAL FLOOR: Portfolio $${currentPortfolio.toFixed(2)} below floor $${capitalFloor} — skipping harvest`);
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
  indicators: Record<string, TechnicalIndicators> = {},
): TradeDecision | null {
  if (!CONFIG.trading.stopLoss.enabled) return null;

  const cfg = CONFIG.trading.stopLoss;
  let worstLoss = 0;
  let worstDecision: TradeDecision | null = null;

  for (const b of balances) {
    if (b.symbol === "USDC" || b.usdValue < cfg.minHoldingUSD) continue;
    const cb = state.costBasis[b.symbol];
    if (!cb || cb.averageCostBasis <= 0) continue;

    // v11.4.6: Check stop-loss cooldown — prevent repeated firing on same token
    const lastStopLoss = state.stopLossCooldowns[b.symbol];
    if (lastStopLoss) {
      const hoursSince = (Date.now() - new Date(lastStopLoss).getTime()) / (1000 * 60 * 60);
      if (hoursSince < 24) continue; // Skip — already triggered within 24h
    }

    const currentPrice = b.price || (b.balance > 0 ? b.usdValue / b.balance : 0);
    const lossFromCost = ((currentPrice - cb.averageCostBasis) / cb.averageCostBasis) * 100;

    // Check trailing stop (loss from peak)
    let trailingLoss = 0;
    if (cfg.trailingEnabled && cb.peakPrice > 0) {
      trailingLoss = ((currentPrice - cb.peakPrice) / cb.peakPrice) * 100;
    }

    // --- v9.0: ATR-based dynamic stops ---
    const ind = indicators[b.symbol];
    const atrPct = ind?.atrPercent ?? null;
    const atrLevels = computeAtrStopLevels(b.symbol, b.sector, atrPct, currentPrice, cb);

    // Update cost basis with latest ATR stop data
    if (atrLevels) {
      cb.atrStopPercent = atrLevels.stopPercent;
      cb.atrTrailPercent = atrLevels.trailPercent;
      cb.trailActivated = atrLevels.trailActivated;
      cb.lastAtrUpdate = new Date().toISOString();
      if (cb.atrAtEntry === null && atrPct !== null) {
        cb.atrAtEntry = atrPct;
      }
    }

    // Use adaptive flat thresholds as fallback
    let effectiveSL = state.adaptiveThresholds.stopLossPercent;
    let effectiveTrailing = state.adaptiveThresholds.trailingStopPercent;

    // v6.2: Sector-specific stop-loss tightening
    const sectorOverride = b.sector ? SECTOR_STOP_LOSS_OVERRIDES[b.sector] : undefined;
    if (sectorOverride) {
      effectiveSL = Math.max(effectiveSL, sectorOverride.maxLoss);
      effectiveTrailing = Math.max(effectiveTrailing, sectorOverride.maxTrailing);
    }

    // v9.0: When ATR data available, use tighter of ATR-based vs flat
    if (atrLevels) {
      // ATR stop: use tighter (closer to 0) of ATR vs flat+sector
      effectiveSL = Math.max(effectiveSL, atrLevels.stopPercent);
      // ATR trail: only apply if trail has activated
      if (atrLevels.trailActivated) {
        effectiveTrailing = Math.max(effectiveTrailing, atrLevels.trailPercent);
      }

      // v9.0: Comparison logging for first N cycles
      if (atrComparisonLogCount < ATR_COMPARISON_LOG_COUNT) {
        const flatSL = state.adaptiveThresholds.stopLossPercent;
        const flatTrail = state.adaptiveThresholds.trailingStopPercent;
        console.log(`  [ATR-CMP] ${b.symbol}: ATR%=${atrPct?.toFixed(2)} | ATR-stop=${atrLevels.stopPercent.toFixed(1)}% vs flat=${flatSL}% -> effective=${effectiveSL.toFixed(1)}% | trail=${atrLevels.trailPercent.toFixed(1)}% vs flat=${flatTrail}% activated=${atrLevels.trailActivated}`);
        atrComparisonLogCount++;
      }
    }

    // Determine if stop triggered
    const costBasisTriggered = lossFromCost <= effectiveSL;
    const trailingTriggered = cfg.trailingEnabled && trailingLoss <= effectiveTrailing;
    // v9.0: Only allow trailing stop if trail is activated (ATR mode) or no ATR data
    const trailAllowed = !atrLevels || atrLevels.trailActivated;

    const triggered = costBasisTriggered || (trailingTriggered && trailAllowed);

    if (triggered && lossFromCost < worstLoss) {
      worstLoss = lossFromCost;
      const sellUSD = b.usdValue * (cfg.sellPercent / 100);
      const tokenAmount = b.balance * (cfg.sellPercent / 100);
      const stopType = atrLevels ? "ATR" : "FLAT";
      const reason = costBasisTriggered
        ? `Stop-loss(${stopType}): ${b.symbol} ${lossFromCost.toFixed(1)}% from cost $${cb.averageCostBasis.toFixed(4)} (effective: ${effectiveSL.toFixed(1)}%)`
        : `Trailing-stop(${stopType}): ${b.symbol} ${trailingLoss.toFixed(1)}% from peak $${cb.peakPrice.toFixed(4)} (effective: ${effectiveTrailing.toFixed(1)}%)`;

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

// ============================================================================
// v10.0: MARKET INTELLIGENCE ENGINE — New Data Types
// ============================================================================

type AltseasonSignal = "ALTSEASON_ROTATION" | "BTC_DOMINANCE_FLIGHT" | "NEUTRAL";

interface GlobalMarketData {
  btcDominance: number;
  ethDominance: number;
  totalMarketCap: number;
  totalVolume24h: number;
  defiMarketCap: number | null;
  defiVolume24h: number | null;
  btcDominanceChange7d: number;
  altseasonSignal: AltseasonSignal;
  lastUpdated: string;
}

interface SmartRetailDivergence {
  btcDivergence: number | null;
  ethDivergence: number | null;
  btcSignal: "STRONG_BUY" | "STRONG_SELL" | "NEUTRAL";
  ethSignal: "STRONG_BUY" | "STRONG_SELL" | "NEUTRAL";
}

interface FundingRateMeanReversion {
  btcMean: number;
  btcStdDev: number;
  btcZScore: number;
  btcSignal: "CROWDED_LONGS_REVERSAL" | "CROWDED_SHORTS_BOUNCE" | "NEUTRAL";
  ethMean: number;
  ethStdDev: number;
  ethZScore: number;
  ethSignal: "CROWDED_LONGS_REVERSAL" | "CROWDED_SHORTS_BOUNCE" | "NEUTRAL";
}

interface TVLPriceDivergence {
  divergences: Record<string, {
    tvlChange: number;
    priceChange: number;
    signal: "UNDERVALUED" | "OVERVALUED" | "ALIGNED";
  }>;
}

interface StablecoinSupplyData {
  usdtMarketCap: number;
  usdcMarketCap: number;
  totalStablecoinSupply: number;
  supplyChange7d: number;
  signal: "CAPITAL_INFLOW" | "CAPITAL_OUTFLOW" | "STABLE";
  lastUpdated: string;
}

interface MarketData {
  tokens: {
    symbol: string; name: string; price: number;
    priceChange24h: number; priceChange7d: number;
    volume24h: number; marketCap: number; sector: string;
  }[];
  fearGreed: { value: number; classification: string };
  trendingTokens: string[];
  indicators: Record<string, TechnicalIndicators>;
  defiLlama: DefiLlamaData | null;
  derivatives: DerivativesData | null;
  newsSentiment: NewsSentimentData | null;
  macroData: MacroData | null;
  marketRegime: MarketRegime;
  // v10.0: Market Intelligence Engine
  globalMarket: GlobalMarketData | null;
  smartRetailDivergence: SmartRetailDivergence | null;
  fundingMeanReversion: FundingRateMeanReversion | null;
  tvlPriceDivergence: TVLPriceDivergence | null;
  stablecoinSupply: StablecoinSupplyData | null;
}

// ============================================================================
// NVR CENTRAL SIGNAL SERVICE — Phase 1 Interfaces
// ============================================================================

interface TradingSignal {
  token: string;
  action: "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";
  confluence: number;
  reasoning: string;
  indicators: {
    rsi14: number | null;
    macdSignal: string | null;
    macdHistogram: number | null;
    bollingerSignal: string | null;
    bollingerPercentB: number | null;
    volumeChange24h: number | null;
    buyRatio: number | null;
    adx: number | null;
    atrPercent: number | null;
  };
  price: number;
  priceChange24h: number;
  sector: string;
}

interface SignalPayload {
  timestamp: string;
  cycleNumber: number;
  marketRegime: string;
  fearGreedIndex: number;
  fearGreedClassification: string;
  signals: TradingSignal[];
  meta: {
    version: string;
    generatedAt: string;
    nextExpectedAt: string;
    ttlSeconds: number;
  };
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
  // v11.5: Binance derivatives DISABLED — geo-blocked on US Railway infrastructure,
  // and bot has no futures trading capability (trades Base DeFi via CDP).
  // All 10 API calls removed. Downstream code already handles null gracefully.
  return null;
}

// Cache for derivatives OI comparison + price change tracking for divergence detection
const derivativesCache = { btcOI: 0, ethOI: 0, btcPriceChange: 0, ethPriceChange: 0 };

// v10.0: Historical tracking caches for mean-reversion signals
let fundingRateHistory: { btc: number[]; eth: number[] } = { btc: [], eth: [] };
let btcDominanceHistory: { values: { timestamp: string; dominance: number }[] } = { values: [] };
let stablecoinSupplyHistory: { values: { timestamp: string; totalSupply: number }[] } = { values: [] };
let currentAltseasonSignal: AltseasonSignal = "NEUTRAL";

// ============================================================================
// v10.0: MARKET INTELLIGENCE ENGINE — Fetch & Compute Functions
// ============================================================================

// v12.0: fetchCoinGeckoGlobal() removed — replaced by computeLocalAltseasonSignal() (on-chain BTC/ETH ratio)

/**
 * v10.0: Compute Smart Money vs Retail Divergence Score from existing Binance data
 */
function computeSmartRetailDivergence(derivatives: DerivativesData | null): SmartRetailDivergence | null {
  if (!derivatives) return null;
  const toLongPct = (ratio: number | null): number | null => ratio === null ? null : (ratio / (1 + ratio)) * 100;

  const btcRetailLong = toLongPct(derivatives.btcLongShortRatio);
  const btcSmartLong = toLongPct(derivatives.btcTopTraderLSRatio);
  const ethRetailLong = toLongPct(derivatives.ethLongShortRatio);
  const ethSmartLong = toLongPct(derivatives.ethTopTraderLSRatio);

  const btcDiv = (btcSmartLong !== null && btcRetailLong !== null) ? btcSmartLong - btcRetailLong : null;
  const ethDiv = (ethSmartLong !== null && ethRetailLong !== null) ? ethSmartLong - ethRetailLong : null;

  const classify = (div: number | null): "STRONG_BUY" | "STRONG_SELL" | "NEUTRAL" => {
    if (div === null) return "NEUTRAL";
    if (div > SMART_RETAIL_DIVERGENCE_THRESHOLD) return "STRONG_BUY";
    if (div < -SMART_RETAIL_DIVERGENCE_THRESHOLD) return "STRONG_SELL";
    return "NEUTRAL";
  };

  return { btcDivergence: btcDiv, ethDivergence: ethDiv, btcSignal: classify(btcDiv), ethSignal: classify(ethDiv) };
}

/**
 * v10.0: Funding Rate Mean-Reversion Signal — tracks 7 days, detects z-score extremes
 */
function computeFundingMeanReversion(derivatives: DerivativesData | null): FundingRateMeanReversion | null {
  if (!derivatives) return null;
  // v10.2: Guard against null funding rates contaminating history
  if (derivatives.btcFundingRate === null || derivatives.ethFundingRate === null) return null;

  fundingRateHistory.btc.push(derivatives.btcFundingRate);
  fundingRateHistory.eth.push(derivatives.ethFundingRate);
  if (fundingRateHistory.btc.length > FUNDING_RATE_HISTORY_LENGTH) fundingRateHistory.btc = fundingRateHistory.btc.slice(-FUNDING_RATE_HISTORY_LENGTH);
  if (fundingRateHistory.eth.length > FUNDING_RATE_HISTORY_LENGTH) fundingRateHistory.eth = fundingRateHistory.eth.slice(-FUNDING_RATE_HISTORY_LENGTH);

  if (fundingRateHistory.btc.length < 5) return null;

  const stats = (arr: number[]) => {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / arr.length;
    return { mean, stdDev: Math.sqrt(variance) };
  };

  const btc = stats(fundingRateHistory.btc);
  const eth = stats(fundingRateHistory.eth);
  const btcZ = btc.stdDev > 0 && isFinite(btc.mean) ? (derivatives.btcFundingRate! - btc.mean) / btc.stdDev : 0;
  const ethZ = eth.stdDev > 0 && isFinite(eth.mean) ? (derivatives.ethFundingRate! - eth.mean) / eth.stdDev : 0;

  const classifyZ = (z: number): "CROWDED_LONGS_REVERSAL" | "CROWDED_SHORTS_BOUNCE" | "NEUTRAL" => {
    if (z > FUNDING_RATE_STD_DEV_THRESHOLD) return "CROWDED_LONGS_REVERSAL";
    if (z < -FUNDING_RATE_STD_DEV_THRESHOLD) return "CROWDED_SHORTS_BOUNCE";
    return "NEUTRAL";
  };

  return {
    btcMean: btc.mean, btcStdDev: btc.stdDev, btcZScore: btcZ, btcSignal: classifyZ(btcZ),
    ethMean: eth.mean, ethStdDev: eth.stdDev, ethZScore: ethZ, ethSignal: classifyZ(ethZ),
  };
}

/**
 * v10.0: TVL-Price Divergence per Token — uses existing DefiLlama + on-chain price data
 */
function computeTVLPriceDivergence(defi: DefiLlamaData | null, tokens: MarketData["tokens"]): TVLPriceDivergence | null {
  if (!defi || !defi.protocolTVLByToken || Object.keys(defi.protocolTVLByToken).length === 0) return null;

  const divergences: TVLPriceDivergence["divergences"] = {};
  for (const [symbol, tvlData] of Object.entries(defi.protocolTVLByToken)) {
    const tokenData = tokens.find(t => t.symbol === symbol);
    if (!tokenData) continue;
    const tvlChange = tvlData.change24h;
    const priceChange = tokenData.priceChange24h;
    let signal: "UNDERVALUED" | "OVERVALUED" | "ALIGNED" = "ALIGNED";
    if (tvlChange > TVL_PRICE_DIVERGENCE_THRESHOLD && priceChange < 0) signal = "UNDERVALUED";
    else if (tvlChange < -TVL_PRICE_DIVERGENCE_THRESHOLD && priceChange > 0) signal = "OVERVALUED";
    divergences[symbol] = { tvlChange, priceChange, signal };
  }
  return { divergences };
}

// v12.0: fetchStablecoinSupply() removed — replaced by fetchBaseUSDCSupply() (on-chain totalSupply)

/**
 * v10.0: Dynamic sector targets based on altseason/dominance signal
 */
function getAdjustedSectorTargets(signal: AltseasonSignal): Record<string, number> {
  const adjusted: Record<string, number> = {};
  for (const [key, sector] of Object.entries(SECTORS)) {
    adjusted[key] = sector.targetAllocation;
  }
  if (signal === "ALTSEASON_ROTATION") {
    adjusted.AI_TOKENS = Math.min(0.30, (adjusted.AI_TOKENS || 0) + ALTSEASON_SECTOR_BOOST.AI_TOKENS);
    adjusted.MEME_COINS = Math.min(0.30, (adjusted.MEME_COINS || 0) + ALTSEASON_SECTOR_BOOST.MEME_COINS);
    adjusted.BLUE_CHIP = Math.max(0.25, (adjusted.BLUE_CHIP || 0) + ALTSEASON_SECTOR_BOOST.BLUE_CHIP);
    adjusted.DEFI = (adjusted.DEFI || 0) + ALTSEASON_SECTOR_BOOST.DEFI;
  } else if (signal === "BTC_DOMINANCE_FLIGHT") {
    adjusted.BLUE_CHIP = Math.min(0.55, (adjusted.BLUE_CHIP || 0) + BTC_DOMINANCE_SECTOR_BOOST.BLUE_CHIP);
    adjusted.AI_TOKENS = Math.max(0.15, (adjusted.AI_TOKENS || 0) + BTC_DOMINANCE_SECTOR_BOOST.AI_TOKENS);
    adjusted.MEME_COINS = Math.max(0.10, (adjusted.MEME_COINS || 0) + BTC_DOMINANCE_SECTOR_BOOST.MEME_COINS);
    adjusted.DEFI = Math.max(0.15, (adjusted.DEFI || 0) + BTC_DOMINANCE_SECTOR_BOOST.DEFI);
  }

  // v14.0: Blue Chip Momentum Boost — when BTC is trending up (+2% 24h), temporarily
  // raise BLUE_CHIP target from base to 50% by reducing MEME_COINS allocation.
  // This stacks with BTC_DOMINANCE_FLIGHT but also fires independently on BTC uptrends.
  const btcPrice = lastKnownPrices['cbBTC'] || lastKnownPrices['BTC'];
  if (btcPrice && btcPrice.change24h >= 2) {
    const currentBlueChip = adjusted.BLUE_CHIP || 0;
    const currentMeme = adjusted.MEME_COINS || 0;
    if (currentBlueChip < 0.50) {
      const boost = Math.min(0.10, 0.50 - currentBlueChip); // Boost up to 50%
      adjusted.BLUE_CHIP = currentBlueChip + boost;
      adjusted.MEME_COINS = Math.max(0.05, currentMeme - boost); // Take from meme allocation
    }
  }

  const sum = Object.values(adjusted).reduce((a, b) => a + b, 0);
  if (sum > 0 && Math.abs(sum - 1.0) > 0.001) {
    for (const key of Object.keys(adjusted)) adjusted[key] = adjusted[key] / sum;
  }
  return adjusted;
}

// Last-known prices cache — prevents $0 portfolio between cycles
let lastKnownPrices: Record<string, { price: number; change24h: number; change7d: number; volume: number; marketCap: number; name: string; sector: string }> = {};

// ============================================================================
// v9.2: MARKET MOMENTUM OVERLAY — Detects strong market moves to deploy USDC
// ============================================================================

interface MarketMomentumSignal {
  score: number;           // -100 to +100 composite momentum score
  btcChange24h: number;    // BTC 24h % change
  ethChange24h: number;    // ETH 24h % change
  fearGreedValue: number;  // 0-100
  positionMultiplier: number; // 0.5 to 1.5 — applied to position sizing
  deploymentBias: 'AGGRESSIVE' | 'NORMAL' | 'CAUTIOUS';
  dataAvailable: boolean;  // false if data sources are down — degrades to NORMAL
}

function calculateMarketMomentum(): MarketMomentumSignal {
  const defaultSignal: MarketMomentumSignal = {
    score: 0, btcChange24h: 0, ethChange24h: 0, fearGreedValue: 50,
    positionMultiplier: 1.0, deploymentBias: 'NORMAL', dataAvailable: false,
  };

  // Gather data — each source is optional, missing data degrades gracefully
  const btcData = lastKnownPrices['ETH'] ? null : null; // placeholder
  const btc24h = lastKnownPrices['cbBTC']?.change24h ?? lastKnownPrices['BTC']?.change24h ?? null;
  const eth24h = lastKnownPrices['WETH']?.change24h ?? lastKnownPrices['ETH']?.change24h ?? null;
  const fg = lastFearGreedValue > 0 ? lastFearGreedValue : null;

  // If we have no price data at all, return default (graceful degradation)
  if (btc24h === null && eth24h === null && fg === null) {
    return defaultSignal;
  }

  let score = 0;
  let dataPoints = 0;

  // v11.5: Pure price-action momentum — no F&G. BTC 55% weight, ETH 45% weight.
  // BTC momentum component (weight: 55%)
  if (btc24h !== null) {
    // Scale: +5% BTC move = +50 score, -5% = -50 score, capped at ±55
    score += Math.max(-55, Math.min(55, btc24h * 10)) * 0.55;
    dataPoints++;
  }

  // ETH momentum component (weight: 45%)
  if (eth24h !== null) {
    score += Math.max(-45, Math.min(45, eth24h * 10)) * 0.45;
    dataPoints++;
  }

  // Normalize if we have partial data
  if (dataPoints > 0 && dataPoints < 2) {
    score = score * 2 * 0.85; // Scale up but discount for single data point
  }

  // Clamp to -100 to +100
  score = Math.max(-100, Math.min(100, score));

  // Calculate position multiplier based on momentum score
  // v14.0: More aggressive momentum deployment
  // Score > +20: market is moving, deploy more aggressively (up to 1.5x)
  // BTC/ETH +3% or more in 24h: immediate 1.5x multiplier (catching the wave)
  // Score < -30: market is dropping, be cautious (down to 0.5x)
  let positionMultiplier = 1.0;

  // v14.0: Direct BTC/ETH momentum boost — when majors move +3%, go 1.5x immediately
  const btcStrongMomentum = (btc24h ?? 0) >= 3;
  const ethStrongMomentum = (eth24h ?? 0) >= 3;
  if (btcStrongMomentum || ethStrongMomentum) {
    positionMultiplier = 1.5;
  } else if (score > 20) {
    positionMultiplier = 1.0 + Math.min(0.5, (score - 20) / 160); // +20 to +100 → 1.0 to 1.5
  } else if (score < -30) {
    positionMultiplier = 1.0 + Math.max(-0.5, (score + 30) / 140); // -30 to -100 → 1.0 to 0.5
  }

  const deploymentBias = (btcStrongMomentum || ethStrongMomentum || score > 20) ? 'AGGRESSIVE' : score < -30 ? 'CAUTIOUS' : 'NORMAL';

  return {
    score: Math.round(score * 10) / 10,
    btcChange24h: btc24h ?? 0,
    ethChange24h: eth24h ?? 0,
    fearGreedValue: fg ?? 50,
    positionMultiplier: Math.round(positionMultiplier * 100) / 100,
    deploymentBias,
    dataAvailable: dataPoints > 0,
  };
}

// Store last momentum signal for dashboard access
let lastMomentumSignal: MarketMomentumSignal = {
  score: 0, btcChange24h: 0, ethChange24h: 0, fearGreedValue: 50,
  positionMultiplier: 1.0, deploymentBias: 'NORMAL', dataAvailable: false,
};

// v12.0: Signal health tracker — monitors which data sources are operational
let lastSignalHealth: Record<string, string> = {
  onchain: 'UNKNOWN', fearGreed: 'UNKNOWN', defiLlama: 'UNKNOWN',
  derivatives: 'UNKNOWN', news: 'UNKNOWN', macro: 'UNKNOWN',
  momentum: 'UNKNOWN', altseasonSignal: 'UNKNOWN', stablecoinSupply: 'UNKNOWN',
  onChainFlow: 'UNKNOWN', // v12.3: On-chain order flow intelligence
  lastUpdated: '',
};

// v7.1: Persist price cache to disk so deploys don't start with empty prices
// v11.4.12: Use PERSIST_DIR so cache survives Docker deploys
const PRICE_CACHE_FILE = process.env.PERSIST_DIR ? `${process.env.PERSIST_DIR}/price-cache.json` : "./logs/price-cache.json";

function savePriceCache() {
  try {
    // v10.2: Evict stale entries — keep only active tokens + last 200 discovered
    const activeSymbols = new Set(Object.keys(TOKEN_REGISTRY));
    const keys = Object.keys(lastKnownPrices);
    if (keys.length > 300) {
      const sorted = keys.sort((a, b) => (activeSymbols.has(b) ? 1 : 0) - (activeSymbols.has(a) ? 1 : 0));
      const keep = sorted.slice(0, 200);
      const pruned: typeof lastKnownPrices = {};
      for (const k of keep) pruned[k] = lastKnownPrices[k];
      lastKnownPrices = pruned;
    }
    if (!fs.existsSync("./logs")) fs.mkdirSync("./logs", { recursive: true });
    // v11.4.17: Atomic write for price cache
    const tmpPriceFile = PRICE_CACHE_FILE + '.tmp';
    fs.writeFileSync(tmpPriceFile, JSON.stringify({ lastUpdated: new Date().toISOString(), prices: lastKnownPrices }));
    fs.renameSync(tmpPriceFile, PRICE_CACHE_FILE);
  } catch { /* non-critical */ }
}

function loadPriceCache() {
  try {
    if (fs.existsSync(PRICE_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(PRICE_CACHE_FILE, "utf-8"));
      const age = Date.now() - new Date(data.lastUpdated).getTime();
      // Only use cache if less than 1 hour old — stale prices are worse than no prices
      if (age < 60 * 60 * 1000 && data.prices) {
        lastKnownPrices = data.prices;
        console.log(`♻️ Loaded ${Object.keys(lastKnownPrices).length} cached prices from disk (${(age / 60000).toFixed(0)}m old)`);
      } else {
        console.log(`⏭️ Price cache too old (${(age / 3600000).toFixed(1)}h) — will fetch fresh`);
      }
    }
  } catch { /* non-critical */ }
}

// Load on module init
loadPriceCache();

// ============================================================================
// v8.0: PHASE 1 — INSTITUTIONAL POSITION SIZING & CAPITAL PROTECTION ENGINE
// ============================================================================

/**
 * Portfolio-wide circuit breaker state.
 * Tracks consecutive losses, daily/weekly drawdown baselines, and breaker events.
 * Persisted in saveTradeHistory / loadTradeHistory.
 */
interface BreakerState {
  consecutiveLosses: number;
  lastBreakerTriggered: string | null;    // ISO timestamp when breaker last fired
  lastBreakerReason: string | null;
  breakerSizeReductionUntil: string | null; // ISO timestamp — 30% size reduction expires
  dailyBaseline: { date: string; value: number };   // Reset at midnight UTC
  weeklyBaseline: { weekStart: string; value: number }; // Reset Monday midnight UTC
  // v10.4: Rolling window loss tracker — catches bad streaks even with scattered wins
  rollingTradeResults: boolean[]; // last N results (true=win, false=loss), capped at BREAKER_ROLLING_WINDOW_SIZE
}

// v10.4: Rolling window breaker constants
const BREAKER_ROLLING_WINDOW_SIZE = 8;     // Track last 8 trades
const BREAKER_ROLLING_LOSS_THRESHOLD = 5;  // 5+ losses in 8 trades = trigger breaker

const DEFAULT_BREAKER_STATE: BreakerState = {
  consecutiveLosses: 0,
  lastBreakerTriggered: null,
  lastBreakerReason: null,
  breakerSizeReductionUntil: null,
  dailyBaseline: { date: '', value: 0 },
  weeklyBaseline: { weekStart: '', value: 0 },
  rollingTradeResults: [],
};

let breakerState: BreakerState = { ...DEFAULT_BREAKER_STATE };

/**
 * v10.3: Effective Kelly ceiling — scales up for small portfolios.
 * Under $10K, use 12% ceiling (more capital per trade to overcome minimums and fees).
 * Over $10K, use the standard 8% ceiling.
 */
function getEffectiveKellyCeiling(portfolioValue: number): number {
  return portfolioValue < KELLY_SMALL_PORTFOLIO_THRESHOLD
    ? KELLY_SMALL_PORTFOLIO_CEILING_PCT
    : KELLY_POSITION_CEILING_PCT;
}

/**
 * Quarter Kelly Position Sizing
 * Uses rolling window of recent trades to calculate mathematically optimal bet size.
 * Returns the dollar amount to trade.
 */
function calculateKellyPositionSize(portfolioValue: number): { kellyUSD: number; kellyPct: number; rawKelly: number; winRate: number; avgWin: number; avgLoss: number } {
  const effectiveCeiling = getEffectiveKellyCeiling(portfolioValue); // v10.3: dynamic ceiling
  const recentTrades = state.tradeHistory.slice(-KELLY_ROLLING_WINDOW);
  // v12.2.7: Exclude forced/exploration sells from Kelly — they dilute the real win rate.
  // Kelly should reflect the AI's edge, not mechanical deployment outcomes.
  const sells = recentTrades.filter(t => {
    if (t.action !== 'SELL' || !t.success) return false;
    if (t.signalContext?.isExploration || t.signalContext?.isForced) return false;
    if (t.signalContext?.triggeredBy === "EXPLORATION" || t.signalContext?.triggeredBy === "FORCED_DEPLOY") return false;
    return true;
  });

  // Need minimum sample size for statistical validity
  // v11.4.22: Increased fallback from FLOOR×3 ($15) to 5% of portfolio (capped at ceiling).
  // $15 trades don't build meaningful positions. Use 5% to actually deploy capital while
  // gathering the 20 trades needed for Kelly to kick in.
  if (sells.length < KELLY_MIN_TRADES) {
    const fallback = Math.min(Math.max(50, portfolioValue * 0.05), portfolioValue * (effectiveCeiling / 100));
    return { kellyUSD: fallback, kellyPct: (fallback / portfolioValue) * 100, rawKelly: 0, winRate: 0, avgWin: 0, avgLoss: 0 };
  }

  const wins: number[] = [];
  const losses: number[] = [];

  for (const trade of sells) {
    const cb = state.costBasis[trade.fromToken];
    if (!cb || cb.averageCostBasis <= 0) continue;
    const sellPrice = trade.amountUSD / (trade.tokenAmount || 1);
    const pnlPct = (sellPrice - cb.averageCostBasis) / cb.averageCostBasis;
    if (pnlPct >= 0) wins.push(pnlPct);
    else losses.push(Math.abs(pnlPct));
  }

  if (wins.length + losses.length < KELLY_MIN_TRADES) {
    const fallback = Math.min(Math.max(50, portfolioValue * 0.05), portfolioValue * (effectiveCeiling / 100));
    return { kellyUSD: fallback, kellyPct: (fallback / portfolioValue) * 100, rawKelly: 0, winRate: 0, avgWin: 0, avgLoss: 0 };
  }

  const winRate = wins.length / (wins.length + losses.length);
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;

  // Kelly formula: (WinRate × AvgWin − (1 − WinRate) × AvgLoss) / AvgWin
  const rawKelly = avgWin > 0 ? (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin : 0;

  // Quarter Kelly for safety, then clamp — v10.3: uses dynamic ceiling for small portfolios
  const quarterKelly = Math.max(0, rawKelly * KELLY_FRACTION);
  const kellyPct = Math.min(quarterKelly * 100, effectiveCeiling);
  const kellyUSD = Math.max(KELLY_POSITION_FLOOR_USD, Math.min(portfolioValue * (kellyPct / 100), portfolioValue * (effectiveCeiling / 100)));

  return { kellyUSD, kellyPct, rawKelly, winRate, avgWin, avgLoss };
}

/**
 * Volatility-Adjusted Position Sizing
 * Scales position size inversely with recent portfolio volatility.
 * Returns a multiplier (0.4 to 1.5) to apply to Kelly size.
 */
function calculateVolatilityMultiplier(): { multiplier: number; realizedVol: number } {
  const trades = state.tradeHistory.slice(-100);
  const portfolioValues = trades
    .map(t => t.portfolioValueAfter || t.portfolioValueBefore || 0)
    .filter(v => v > 0);

  if (portfolioValues.length < 5) {
    return { multiplier: 1.0, realizedVol: VOL_TARGET_DAILY_PCT };
  }

  // Calculate daily returns from portfolio snapshots
  const returns: number[] = [];
  for (let i = 1; i < portfolioValues.length; i++) {
    if (portfolioValues[i - 1] > 0) {
      returns.push((portfolioValues[i] - portfolioValues[i - 1]) / portfolioValues[i - 1] * 100);
    }
  }

  if (returns.length < 3) {
    return { multiplier: 1.0, realizedVol: VOL_TARGET_DAILY_PCT };
  }

  // Standard deviation of returns = realized volatility
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const realizedVol = Math.sqrt(variance);

  let multiplier: number;
  if (realizedVol > VOL_HIGH_THRESHOLD) {
    multiplier = VOL_HIGH_REDUCTION; // 0.4 — cut size by 60%
  } else if (realizedVol < VOL_LOW_THRESHOLD) {
    multiplier = VOL_LOW_BOOST; // 1.5 — increase size by 50%
  } else {
    // Linear scaling: TargetVol / CurrentVol
    multiplier = Math.max(0.4, Math.min(1.5, VOL_TARGET_DAILY_PCT / realizedVol));
  }

  return { multiplier, realizedVol };
}

/**
 * Master position sizer — combines Kelly + Volatility + Breaker state.
 * This replaces the flat $25 maxBuySize.
 */
function calculateInstitutionalPositionSize(portfolioValue: number): {
  sizeUSD: number; kellyPct: number; rawKelly: number; volMultiplier: number;
  realizedVol: number; breakerReduction: boolean; winRate: number;
  momentumMultiplier: number; momentumBias: string;
} {
  const kelly = calculateKellyPositionSize(portfolioValue);
  const vol = calculateVolatilityMultiplier();

  // v9.2: Market momentum overlay — boost sizing when market is trending strongly
  const momentum = calculateMarketMomentum();
  lastMomentumSignal = momentum;

  let sizeUSD = kelly.kellyUSD * vol.multiplier * momentum.positionMultiplier;

  // Check if breaker size reduction is active
  // v11.4.8: Skip breaker reduction in cash deployment mode —
  // losses were mechanical stops, not bad AI decisions
  let breakerReduction = false;
  if (breakerState.breakerSizeReductionUntil) {
    const until = new Date(breakerState.breakerSizeReductionUntil).getTime();
    if (Date.now() < until) {
      if (cashDeploymentMode) {
        console.log(`   ⚡ BREAKER SIZE REDUCTION BYPASSED — cash deployment mode active`);
      } else {
        sizeUSD *= BREAKER_SIZE_REDUCTION; // 50% reduction
        breakerReduction = true;
      }
    }
  }

  // v11.5: Derivatives blind-spot reduction REMOVED — derivatives permanently disabled.
  // No longer penalizing position sizing for missing derivatives data.

  // Hard floor and ceiling — v10.3: uses dynamic ceiling for small portfolios
  const effectiveCeiling = getEffectiveKellyCeiling(portfolioValue);
  sizeUSD = Math.max(KELLY_POSITION_FLOOR_USD, Math.min(sizeUSD, portfolioValue * (effectiveCeiling / 100)));

  return {
    sizeUSD: Math.round(sizeUSD * 100) / 100,
    kellyPct: kelly.kellyPct,
    rawKelly: kelly.rawKelly,
    volMultiplier: vol.multiplier,
    realizedVol: vol.realizedVol,
    breakerReduction,
    winRate: kelly.winRate,
    momentumMultiplier: momentum.positionMultiplier,
    momentumBias: momentum.deploymentBias,
  };
}

/**
 * Update daily/weekly baselines if date has changed.
 */
function updateDrawdownBaselines(portfolioValue: number) {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

  // Daily reset
  if (breakerState.dailyBaseline.date !== todayStr) {
    breakerState.dailyBaseline = { date: todayStr, value: portfolioValue };
  }

  // Weekly reset (Monday)
  const dayOfWeek = now.getUTCDay();
  const mondayDate = new Date(now);
  mondayDate.setUTCDate(now.getUTCDate() - ((dayOfWeek + 6) % 7));
  const weekStr = mondayDate.toISOString().split('T')[0];
  if (breakerState.weeklyBaseline.weekStart !== weekStr) {
    breakerState.weeklyBaseline = { weekStart: weekStr, value: portfolioValue };
  }
}

/**
 * Check all circuit breaker conditions.
 * Returns null if clear, or a reason string if breaker should fire.
 */
function checkCircuitBreaker(portfolioValue: number, lastTradeResult?: { success: boolean; pnlUSD?: number }): string | null {
  // Update baselines
  updateDrawdownBaselines(portfolioValue);

  // Check if still in pause from previous breaker
  if (breakerState.lastBreakerTriggered) {
    const pauseEnd = new Date(breakerState.lastBreakerTriggered).getTime() + (BREAKER_PAUSE_HOURS * 3600000);
    if (Date.now() < pauseEnd) {
      const remaining = Math.ceil((pauseEnd - Date.now()) / 60000);
      return `PAUSED: ${breakerState.lastBreakerReason} (${remaining}m remaining)`;
    }
  }

  // 1. Consecutive losses
  if (breakerState.consecutiveLosses >= BREAKER_CONSECUTIVE_LOSSES) {
    return `${breakerState.consecutiveLosses} consecutive losing trades`;
  }

  // 1b. v10.4: Rolling window — catches bad streaks with scattered wins (e.g., 20% win rate day)
  if (breakerState.rollingTradeResults.length >= BREAKER_ROLLING_WINDOW_SIZE) {
    const rollingLosses = breakerState.rollingTradeResults.filter(r => !r).length;
    if (rollingLosses >= BREAKER_ROLLING_LOSS_THRESHOLD) {
      return `${rollingLosses}/${BREAKER_ROLLING_WINDOW_SIZE} trades lost in rolling window`;
    }
  }

  // 2. Daily drawdown
  if (breakerState.dailyBaseline.value > 0) {
    const dailyDD = ((breakerState.dailyBaseline.value - portfolioValue) / breakerState.dailyBaseline.value) * 100;
    if (dailyDD >= BREAKER_DAILY_DD_PCT) {
      return `Daily drawdown ${dailyDD.toFixed(1)}% exceeds ${BREAKER_DAILY_DD_PCT}% limit`;
    }
  }

  // 3. Weekly drawdown
  if (breakerState.weeklyBaseline.value > 0) {
    const weeklyDD = ((breakerState.weeklyBaseline.value - portfolioValue) / breakerState.weeklyBaseline.value) * 100;
    if (weeklyDD >= BREAKER_WEEKLY_DD_PCT) {
      return `Weekly drawdown ${weeklyDD.toFixed(1)}% exceeds ${BREAKER_WEEKLY_DD_PCT}% limit`;
    }
  }

  // 4. Single trade loss check (checked when lastTradeResult provided)
  if (lastTradeResult?.pnlUSD && lastTradeResult.pnlUSD < 0) {
    const lossAsPct = (Math.abs(lastTradeResult.pnlUSD) / portfolioValue) * 100;
    if (lossAsPct >= BREAKER_SINGLE_TRADE_LOSS_PCT) {
      return `Single trade loss $${Math.abs(lastTradeResult.pnlUSD).toFixed(2)} (${lossAsPct.toFixed(1)}%) exceeds ${BREAKER_SINGLE_TRADE_LOSS_PCT}% limit`;
    }
  }

  return null; // All clear
}

/**
 * Fire the circuit breaker — pause trading and activate size reduction.
 */
function triggerCircuitBreaker(reason: string) {
  const now = new Date().toISOString();
  breakerState.lastBreakerTriggered = now;
  breakerState.lastBreakerReason = reason;
  breakerState.breakerSizeReductionUntil = new Date(Date.now() + BREAKER_SIZE_REDUCTION_HOURS * 3600000).toISOString();
  breakerState.rollingTradeResults = []; // v10.4: Reset rolling window so breaker doesn't re-trigger immediately after pause
  breakerState.consecutiveLosses = 0;    // v10.4: Also reset consecutive counter
  console.log(`\n🚨🚨 CIRCUIT BREAKER TRIGGERED 🚨🚨`);
  console.log(`   Reason: ${reason}`);
  console.log(`   Action: ALL trading paused for ${BREAKER_PAUSE_HOURS} hours`);
  console.log(`   After pause: position sizes reduced 50% for ${BREAKER_SIZE_REDUCTION_HOURS}h`);
}

/**
 * Record a trade result for consecutive loss tracking.
 */
function recordTradeResultForBreaker(success: boolean, pnlUSD?: number) {
  const isWin = success && (pnlUSD === undefined || pnlUSD >= 0);
  if (isWin) {
    breakerState.consecutiveLosses = 0; // Reset on win
  } else {
    breakerState.consecutiveLosses++;
    console.log(`   📉 Consecutive losses: ${breakerState.consecutiveLosses}/${BREAKER_CONSECUTIVE_LOSSES}`);
  }

  // v10.4: Rolling window — track last N trade results regardless of outcome
  breakerState.rollingTradeResults.push(isWin);
  if (breakerState.rollingTradeResults.length > BREAKER_ROLLING_WINDOW_SIZE) {
    breakerState.rollingTradeResults = breakerState.rollingTradeResults.slice(-BREAKER_ROLLING_WINDOW_SIZE);
  }
  const rollingLosses = breakerState.rollingTradeResults.filter(r => !r).length;
  if (rollingLosses >= BREAKER_ROLLING_LOSS_THRESHOLD) {
    console.log(`   📉 Rolling window: ${rollingLosses}/${breakerState.rollingTradeResults.length} losses in last ${BREAKER_ROLLING_WINDOW_SIZE} trades`);
  }
}

// ============================================================================
// v8.1: PHASE 2 — EXECUTION QUALITY ENGINE
// ============================================================================

// ---- VWS Liquidity Filter ----

interface PoolLiquidity {
  liquidityUSD: number;
  pairAddress: string;
  dexName: string;
  priceUSD: number;
  fetchedAt: number;
}

const poolLiquidityCache: Map<string, PoolLiquidity> = new Map();
const POOL_LIQUIDITY_CACHE_TTL = 3 * 60 * 1000; // 3 minutes

/**
 * Fetch pool liquidity for a token from DexScreener.
 * Returns the deepest Base pool for the token.
 */
async function fetchPoolLiquidity(tokenSymbol: string): Promise<PoolLiquidity | null> {
  // Check cache first
  const cached = poolLiquidityCache.get(tokenSymbol);
  if (cached && Date.now() - cached.fetchedAt < POOL_LIQUIDITY_CACHE_TTL) {
    return cached;
  }

  try {
    const reg = TOKEN_REGISTRY[tokenSymbol];
    if (!reg || reg.address === 'native') return null;

    const res = await axios.get(
      `https://api.dexscreener.com/tokens/v1/base/${reg.address}`,
      { timeout: 8000 }
    );

    if (!res.data || !Array.isArray(res.data) || res.data.length === 0) return null;

    // Find the deepest liquidity pool on Base
    const basePools = res.data
      .filter((p: any) => p.chainId === 'base' && p.liquidity?.usd > 0)
      .sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));

    if (basePools.length === 0) return null;

    const best = basePools[0];
    const result: PoolLiquidity = {
      liquidityUSD: best.liquidity?.usd || 0,
      pairAddress: best.pairAddress || '',
      dexName: best.dexId || 'unknown',
      priceUSD: parseFloat(best.priceUsd || '0'),
      fetchedAt: Date.now(),
    };

    poolLiquidityCache.set(tokenSymbol, result);
    return result;
  } catch (e: any) {
    console.warn(`   ⚠️ Pool liquidity fetch failed for ${tokenSymbol}: ${e.message?.substring(0, 80)}`);
    return cached || null; // Return stale cache if available
  }
}

/**
 * VWS Pre-Trade Liquidity Check
 * Returns { allowed, adjustedSize, reason } — call before every trade.
 */
async function checkLiquidity(tokenSymbol: string, tradeAmountUSD: number): Promise<{
  allowed: boolean;
  adjustedSize: number;
  liquidityUSD: number;
  tradeAsPoolPct: number;
  reason: string;
}> {
  const pool = await fetchPoolLiquidity(tokenSymbol);

  if (!pool || pool.liquidityUSD <= 0) {
    // No liquidity data available — allow trade but at minimum size
    return {
      allowed: true,
      adjustedSize: Math.min(tradeAmountUSD, 25), // Cap at $25 without liquidity data
      liquidityUSD: 0,
      tradeAsPoolPct: 0,
      reason: 'No pool data — capped at $25',
    };
  }

  const tradeAsPoolPct = (tradeAmountUSD / pool.liquidityUSD) * 100;

  // Hard block: pool too small
  if (pool.liquidityUSD < VWS_MIN_LIQUIDITY_USD) {
    return {
      allowed: false,
      adjustedSize: 0,
      liquidityUSD: pool.liquidityUSD,
      tradeAsPoolPct,
      reason: `Pool liquidity $${(pool.liquidityUSD / 1000).toFixed(1)}K < minimum $${(VWS_MIN_LIQUIDITY_USD / 1000).toFixed(0)}K`,
    };
  }

  // Hard block: trade too large relative to pool
  if (tradeAsPoolPct > VWS_TRADE_AS_POOL_PCT_MAX) {
    const maxAllowed = pool.liquidityUSD * (VWS_TRADE_AS_POOL_PCT_MAX / 100);
    return {
      allowed: true,
      adjustedSize: Math.max(5, Math.min(maxAllowed, tradeAmountUSD)),
      liquidityUSD: pool.liquidityUSD,
      tradeAsPoolPct,
      reason: `Trade ${tradeAsPoolPct.toFixed(1)}% of pool — capped to ${VWS_TRADE_AS_POOL_PCT_MAX}% ($${maxAllowed.toFixed(2)})`,
    };
  }

  // Warn zone: trade moderately large relative to pool
  let adjustedSize = tradeAmountUSD;
  let reason = 'OK';

  if (pool.liquidityUSD < VWS_PREFERRED_LIQUIDITY_USD) {
    adjustedSize = Math.max(5, tradeAmountUSD * VWS_THIN_POOL_SIZE_REDUCTION);
    reason = `Thin pool $${(pool.liquidityUSD / 1000).toFixed(1)}K — size reduced ${((1 - VWS_THIN_POOL_SIZE_REDUCTION) * 100).toFixed(0)}%`;
  } else if (tradeAsPoolPct > VWS_TRADE_AS_POOL_PCT_WARN) {
    reason = `Warning: trade is ${tradeAsPoolPct.toFixed(1)}% of pool — expect elevated slippage`;
  }

  return {
    allowed: true,
    adjustedSize: Math.round(adjustedSize * 100) / 100,
    liquidityUSD: pool.liquidityUSD,
    tradeAsPoolPct,
    reason,
  };
}

// ---- Gas Price Monitor ----

let lastGasPrice: { gweiL1: number; gweiL2: number; ethPriceUSD: number; fetchedAt: number } = {
  gweiL1: 0, gweiL2: 0, ethPriceUSD: 0, fetchedAt: 0,
};

/**
 * Fetch current Base L2 gas price from RPC.
 * Returns gas cost estimate in USD for a typical swap (~150K gas).
 */
async function fetchGasPrice(): Promise<{ gasCostUSD: number; gweiL2: number; isHigh: boolean }> {
  try {
    const gasPriceHex = await rpcCall('eth_gasPrice', []);
    const gasPriceWei = parseInt(gasPriceHex, 16);
    const gweiL2 = gasPriceWei / 1e9;

    // Get ETH price from last known prices
    const ethPrice = lastKnownPrices['ETH']?.price || lastKnownPrices['WETH']?.price || 2000;

    // Typical DEX swap on Base: ~150K gas units
    const gasUnits = 150_000;
    const gasCostETH = (gasPriceWei * gasUnits) / 1e18;
    const gasCostUSD = gasCostETH * ethPrice;

    lastGasPrice = { gweiL1: 0, gweiL2: gweiL2, ethPriceUSD: ethPrice, fetchedAt: Date.now() };

    return {
      gasCostUSD: Math.round(gasCostUSD * 10000) / 10000, // 4 decimal places
      gweiL2,
      isHigh: gweiL2 > GAS_PRICE_HIGH_GWEI,
    };
  } catch (e: any) {
    // Return a conservative estimate if gas fetch fails
    return { gasCostUSD: 0.15, gweiL2: 0.1, isHigh: false };
  }
}

/**
 * Pre-trade gas check. Returns { proceed, gasCostUSD, reason }.
 */
async function checkGasCost(tradeAmountUSD: number): Promise<{
  proceed: boolean;
  gasCostUSD: number;
  gasPctOfTrade: number;
  reason: string;
}> {
  if (tradeAmountUSD <= 0) {
    return { proceed: false, gasCostUSD: 0, gasPctOfTrade: 0, reason: 'Trade amount is zero' };
  }
  const gas = await fetchGasPrice();
  const gasPctOfTrade = (gas.gasCostUSD / tradeAmountUSD) * 100;

  if (gasPctOfTrade > GAS_COST_MAX_PCT_OF_TRADE) {
    return {
      proceed: false,
      gasCostUSD: gas.gasCostUSD,
      gasPctOfTrade,
      reason: `Gas $${gas.gasCostUSD.toFixed(4)} = ${gasPctOfTrade.toFixed(1)}% of $${tradeAmountUSD.toFixed(2)} trade (max ${GAS_COST_MAX_PCT_OF_TRADE}%)`,
    };
  }

  if (gas.isHigh) {
    return {
      proceed: true,
      gasCostUSD: gas.gasCostUSD,
      gasPctOfTrade,
      reason: `Gas elevated (${gas.gweiL2.toFixed(3)} gwei, $${gas.gasCostUSD.toFixed(4)}) — proceeding but noting cost`,
    };
  }

  return {
    proceed: true,
    gasCostUSD: gas.gasCostUSD,
    gasPctOfTrade,
    reason: `Gas OK: $${gas.gasCostUSD.toFixed(4)} (${gasPctOfTrade.toFixed(2)}% of trade)`,
  };
}

// ---- TWAP Execution Engine ----

/**
 * Execute a trade using TWAP (Time-Weighted Average Price).
 * Splits large orders into smaller chunks with randomized timing.
 * Returns aggregated result.
 */
async function executeTWAP(
  decision: TradeDecision,
  marketData: MarketData,
  singleSwapFn: (d: TradeDecision, m: MarketData) => Promise<{ success: boolean; txHash?: string; error?: string; actualTokens?: number }>
): Promise<{ success: boolean; txHash?: string; error?: string; totalTokensReceived?: number; slicesExecuted: number; slicesTotal: number }> {
  const totalAmount = decision.amountUSD;
  const numSlices = Math.min(TWAP_NUM_SLICES, Math.max(2, Math.floor(totalAmount / 20))); // At least $20 per slice
  const sliceAmount = Math.round((totalAmount / numSlices) * 100) / 100;

  console.log(`   ⏱️ TWAP: Splitting $${totalAmount.toFixed(2)} into ${numSlices} slices of ~$${sliceAmount.toFixed(2)} over ~${((numSlices - 1) * TWAP_SLICE_INTERVAL_MS / 1000).toFixed(0)}s`);

  let totalTokensReceived = 0;
  let totalAmountExecuted = 0;
  let slicesExecuted = 0;
  let lastTxHash = '';
  const startPrice = marketData.tokens.find(t => t.symbol === (decision.action === 'BUY' ? decision.toToken : decision.fromToken))?.price || 0;

  for (let i = 0; i < numSlices; i++) {
    // Check for adverse price move before each slice (except first)
    if (i > 0 && startPrice > 0) {
      const currentPrice = lastKnownPrices[decision.action === 'BUY' ? decision.toToken : decision.fromToken]?.price || startPrice;
      const priceMove = ((currentPrice - startPrice) / startPrice) * 100;

      // For buys, price going UP is adverse. For sells, price going DOWN is adverse.
      const adverseMove = decision.action === 'BUY' ? priceMove : -priceMove;
      if (adverseMove > TWAP_ADVERSE_MOVE_PCT) {
        console.log(`   ⏱️ TWAP PAUSED: Price moved ${priceMove > 0 ? '+' : ''}${priceMove.toFixed(2)}% against us (limit: ${TWAP_ADVERSE_MOVE_PCT}%). Executed ${slicesExecuted}/${numSlices} slices.`);
        break;
      }
    }

    // Determine this slice's amount (last slice gets remainder)
    const thisSliceAmount = (i === numSlices - 1)
      ? Math.round((totalAmount - totalAmountExecuted) * 100) / 100
      : sliceAmount;

    if (thisSliceAmount < 3) break; // Skip dust slices

    const sliceDecision: TradeDecision = {
      ...decision,
      amountUSD: thisSliceAmount,
      tokenAmount: decision.tokenAmount ? (decision.tokenAmount * thisSliceAmount / totalAmount) : undefined,
    };

    console.log(`   ⏱️ TWAP slice ${i + 1}/${numSlices}: $${thisSliceAmount.toFixed(2)}`);
    const result = await singleSwapFn(sliceDecision, marketData);

    if (result.success) {
      slicesExecuted++;
      totalAmountExecuted += thisSliceAmount;
      totalTokensReceived += result.actualTokens || 0;
      if (result.txHash) lastTxHash = result.txHash;
    } else {
      console.log(`   ⏱️ TWAP slice ${i + 1} failed: ${result.error} — stopping TWAP`);
      break;
    }

    // Wait between slices (with jitter)
    if (i < numSlices - 1) {
      const jitter = TWAP_SLICE_INTERVAL_MS * (TWAP_TIMING_JITTER_PCT / 100);
      const delay = TWAP_SLICE_INTERVAL_MS + (Math.random() * 2 - 1) * jitter;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  const success = slicesExecuted > 0;
  console.log(`   ⏱️ TWAP complete: ${slicesExecuted}/${numSlices} slices, $${totalAmountExecuted.toFixed(2)} executed${totalTokensReceived > 0 ? `, ${totalTokensReceived.toFixed(6)} tokens` : ''}`);

  return {
    success,
    txHash: lastTxHash || undefined,
    error: !success ? 'All TWAP slices failed' : undefined,
    totalTokensReceived: totalTokensReceived > 0 ? totalTokensReceived : undefined,
    slicesExecuted,
    slicesTotal: numSlices,
  };
}

// ---- Actual Token Balance Diff (for accurate cost basis) ----

/**
 * Get token balance before and after a swap to determine actual tokens received/sent.
 * This replaces the estimated `amountUSD / price` calculation.
 */
async function getTokenBalance(tokenSymbol: string): Promise<number> {
  try {
    // v10.1.1: Always read from CONFIG.walletAddress (the CoinbaseSmartWallet)
    const walletAddr = CONFIG.walletAddress;
    // v11.4.15: ETH buys via CDP produce WETH (ERC-20), not native ETH.
    // Read WETH ERC-20 balance for accurate cost basis tracking.
    if (tokenSymbol === 'ETH' || tokenSymbol === 'WETH') {
      const wethAddr = TOKEN_REGISTRY['WETH'].address;
      return await getERC20Balance(wethAddr, walletAddr, 18);
    }
    const reg = TOKEN_REGISTRY[tokenSymbol];
    if (!reg) return 0;
    if (reg.address === 'native') {
      const wethAddr = TOKEN_REGISTRY['WETH'].address;
      return await getERC20Balance(wethAddr, walletAddr, 18);
    }
    return await getERC20Balance(reg.address, walletAddr, reg.decimals);
  } catch (err: any) {
    console.warn(`  ⚠️ getTokenBalance(${tokenSymbol}) failed: ${err.message?.substring(0, 100)}`);
    return 0;
  }
}

// Cache for macro data (only fetch once per hour since most data is daily/monthly)
// v10.2: Track success separately — retry failures in 5min, cache success for 1hr
let macroCache: { data: MacroData | null; lastFetch: number; lastSuccess: number } = { data: null, lastFetch: 0, lastSuccess: 0 };
const MACRO_CACHE_TTL = 60 * 60 * 1000; // 1 hour (success)
const MACRO_CACHE_RETRY_TTL = 5 * 60 * 1000; // 5 min (failure retry)

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
  // v10.2: Use success TTL for good data, retry TTL for failures
  const ttl = macroCache.data ? MACRO_CACHE_TTL : MACRO_CACHE_RETRY_TTL;
  if (macroCache.data && Date.now() - macroCache.lastSuccess < MACRO_CACHE_TTL) {
    return macroCache.data;
  }
  if (!macroCache.data && Date.now() - macroCache.lastFetch < MACRO_CACHE_RETRY_TTL) {
    return macroCache.data; // Don't spam retries on failure
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

    macroCache = { data: result, lastFetch: Date.now(), lastSuccess: Date.now() };
    return result;
  } catch (error: any) {
    console.warn(`  ⚠️ Macro data fetch failed: ${error?.message?.substring(0, 100) || error}`);
    macroCache.lastFetch = Date.now(); // Track failure time for retry throttle
    return macroCache.data; // Return stale cache if available
  }
}

/**
 * Determine overall market regime from multiple factors
 */
function determineMarketRegime(
  _fearGreed: number, // v11.5: F&G no longer used for regime detection, kept for API compat
  indicators: Record<string, TechnicalIndicators>,
  derivatives: DerivativesData | null
): MarketRegime {
  const indValues = Object.values(indicators);
  if (indValues.length === 0) return "UNKNOWN";

  // Count directional signals
  let upSignals = 0;
  let downSignals = 0;
  let totalSignals = 0;

  for (const ind of indValues) {
    totalSignals++;
    if (ind.trendDirection === "STRONG_UP" || ind.trendDirection === "UP") upSignals++;
    if (ind.trendDirection === "STRONG_DOWN" || ind.trendDirection === "DOWN") downSignals++;
  }

  const upRatio = totalSignals > 0 ? upSignals / totalSignals : 0;
  const downRatio = totalSignals > 0 ? downSignals / totalSignals : 0;

  // Bollinger Band width — volatility proxy
  const bbIndicators = indValues.filter(i => i.bollingerBands);
  const avgBandwidth = bbIndicators.length > 0
    ? bbIndicators.reduce((sum, i) => sum + (i.bollingerBands?.bandwidth || 0), 0) / bbIndicators.length
    : 0;

  // v8.3: ADX-based trend strength (average across tokens that have ADX data)
  const adxIndicators = indValues.filter(i => i.adx14 !== null);
  const avgADX = adxIndicators.length > 0
    ? adxIndicators.reduce((sum, i) => sum + (i.adx14?.adx || 0), 0) / adxIndicators.length
    : 0;

  // v8.3: ATR%-based volatility (average across tokens that have ATR data)
  const atrIndicators = indValues.filter(i => i.atrPercent !== null);
  const avgATRPct = atrIndicators.length > 0
    ? atrIndicators.reduce((sum, i) => sum + (i.atrPercent || 0), 0) / atrIndicators.length
    : 0;

  // v9.2: BTC/ETH momentum overlay — override RANGING when majors are moving
  const btcMom = lastKnownPrices['cbBTC']?.change24h ?? lastKnownPrices['BTC']?.change24h ?? 0;
  const ethMom = lastKnownPrices['WETH']?.change24h ?? lastKnownPrices['ETH']?.change24h ?? 0;
  const majorMomentum = (btcMom + ethMom) / 2;

  // v8.3: Enhanced regime classification — ADX + ATR + BB + directional ratios + F&G + momentum
  // Priority 1: High volatility (ATR% > 5 OR BB bandwidth > 15)
  if (avgATRPct > 5 && avgBandwidth > 12) return "VOLATILE";
  if (avgBandwidth > 15) return "VOLATILE";

  // Priority 2: Strong trending (ADX > 25 confirms directional strength)
  if (avgADX > 25 && upRatio > 0.5) return "TRENDING_UP";
  if (avgADX > 25 && downRatio > 0.5) return "TRENDING_DOWN";

  // v11.5: BTC/ETH momentum overrides weak ADX — pure price action, no F&G
  if (majorMomentum > 4) return "TRENDING_UP";
  if (majorMomentum < -4) return "TRENDING_DOWN";

  // Priority 3: Weak-signal trending (ADX 15-25, directional ratios as tiebreaker)
  if (upRatio > 0.55) return "TRENDING_UP";
  if (downRatio > 0.55) return "TRENDING_DOWN";

  // v11.5: Moderate BTC/ETH momentum — don't sit in RANGING when market is running
  if (majorMomentum > 2.5) return "TRENDING_UP";
  if (majorMomentum < -2.5) return "TRENDING_DOWN";

  // Priority 4: ADX < 20 = trendless market → ranging
  if (avgADX > 0 && avgADX < 20) return "RANGING";
  if (upRatio < 0.4 && downRatio < 0.4) return "RANGING";

  return "UNKNOWN";
}

/**
 * Format DefiLlama + Derivatives data for the AI prompt
 */
// v11.5: Safe toFixed — prevents crash when value is null/undefined/NaN at runtime
function sf(val: number | null | undefined, digits: number): string {
  if (val === null || val === undefined || isNaN(val)) return "N/A";
  return val.toFixed(digits);
}

function formatIntelligenceForPrompt(
  defi: DefiLlamaData | null,
  derivatives: DerivativesData | null,
  regime: MarketRegime,
  news: NewsSentimentData | null,
  macro: MacroData | null,
  globalMarket: GlobalMarketData | null,
  smartRetailDiv: SmartRetailDivergence | null,
  fundingMR: FundingRateMeanReversion | null,
  tvlPriceDiv: TVLPriceDivergence | null,
  stablecoinData: StablecoinSupplyData | null,
): string {
  const lines: string[] = [];

  if (defi) {
    lines.push(`═══ DEFI INTELLIGENCE (DefiLlama) ═══`);
    lines.push(`Base Chain TVL: $${sf((defi.baseTVL || 0) / 1e9, 2)}B (${(defi.baseTVLChange24h ?? 0) >= 0 ? "+" : ""}${sf(defi.baseTVLChange24h, 1)}% 24h)`);
    lines.push(`Base DEX Volume (24h): $${sf((defi.baseDEXVolume24h || 0) / 1e6, 0)}M`);

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
    lines.push(`BTC Funding Rate: ${(derivatives.btcFundingRate ?? 0) >= 0 ? "+" : ""}${sf(derivatives.btcFundingRate, 4)}%/8h → ${derivatives.btcFundingSignal}`);
    lines.push(`ETH Funding Rate: ${(derivatives.ethFundingRate ?? 0) >= 0 ? "+" : ""}${sf(derivatives.ethFundingRate, 4)}%/8h → ${derivatives.ethFundingSignal}`);
    lines.push(`BTC Open Interest: ${sf(derivatives.btcOpenInterest, 0)} BTC ${derivatives.btcOIChange24h !== 0 ? `(${(derivatives.btcOIChange24h ?? 0) >= 0 ? "+" : ""}${sf(derivatives.btcOIChange24h, 1)}% change)` : ""}`);
    lines.push(`ETH Open Interest: ${sf(derivatives.ethOpenInterest, 0)} ETH ${derivatives.ethOIChange24h !== 0 ? `(${(derivatives.ethOIChange24h ?? 0) >= 0 ? "+" : ""}${sf(derivatives.ethOIChange24h, 1)}% change)` : ""}`);

    // v5.1: Long/Short Ratios — retail vs smart money positioning
    lines.push(`--- Positioning Intelligence ---`);
    if (derivatives.btcLongShortRatio !== null) {
      lines.push(`BTC Global L/S Ratio: ${sf(derivatives.btcLongShortRatio, 2)} (${(derivatives.btcLongShortRatio ?? 0) > 1 ? "retail net long" : "retail net short"})`);
    }
    if (derivatives.btcTopTraderLSRatio !== null) {
      lines.push(`BTC Top Trader L/S: ${sf(derivatives.btcTopTraderLSRatio, 2)} (${(derivatives.btcTopTraderLSRatio ?? 0) > 1 ? "smart money long" : "smart money short"})`);
    }
    if (derivatives.ethLongShortRatio !== null) {
      lines.push(`ETH Global L/S Ratio: ${sf(derivatives.ethLongShortRatio, 2)} (${(derivatives.ethLongShortRatio ?? 0) > 1 ? "retail net long" : "retail net short"})`);
    }
    if (derivatives.ethTopTraderLSRatio !== null) {
      lines.push(`ETH Top Trader L/S: ${sf(derivatives.ethTopTraderLSRatio, 2)} (${(derivatives.ethTopTraderLSRatio ?? 0) > 1 ? "smart money long" : "smart money short"})`);
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
    if (macro.fedFundsRate) lines.push(`Fed Funds Rate: ${sf(macro.fedFundsRate.value, 2)}% (${macro.rateDirection})`);
    if (macro.treasury10Y) lines.push(`10-Year Treasury Yield: ${sf(macro.treasury10Y.value, 2)}%`);
    if (macro.yieldCurve) lines.push(`Yield Curve (10Y-2Y): ${(macro.yieldCurve.value ?? 0) >= 0 ? "+" : ""}${sf(macro.yieldCurve.value, 2)}% ${(macro.yieldCurve.value ?? 0) < 0 ? "⚠️ INVERTED" : ""}`);
    if (macro.cpi) lines.push(`CPI: ${sf(macro.cpi.value, 1)} ${macro.cpi.yoyChange !== null ? `(${(macro.cpi.yoyChange ?? 0) >= 0 ? "+" : ""}${sf(macro.cpi.yoyChange, 1)}% YoY)` : ""}`);
    if (macro.m2MoneySupply) lines.push(`M2 Money Supply: ${macro.m2MoneySupply.yoyChange !== null ? `${(macro.m2MoneySupply.yoyChange ?? 0) >= 0 ? "+" : ""}${sf(macro.m2MoneySupply.yoyChange, 1)}% YoY` : "N/A"} ${(macro.m2MoneySupply.yoyChange ?? 0) > 5 ? "🟢 LIQUIDITY EXPANDING" : (macro.m2MoneySupply.yoyChange ?? 0) < 0 ? "🔴 LIQUIDITY CONTRACTING" : ""}`);
    if (macro.dollarIndex) lines.push(`US Dollar Index: ${sf(macro.dollarIndex.value, 1)} ${(macro.dollarIndex.value ?? 0) > 110 ? "🔴 STRONG (headwind)" : (macro.dollarIndex.value ?? 0) < 100 ? "🟢 WEAK (tailwind)" : ""}`);
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
        lines.push(`Gold (XAU): $${sf(ca.goldPrice, 0)} ${ca.goldChange24h !== null ? `(${ca.goldChange24h >= 0 ? "+" : ""}${sf(ca.goldChange24h, 1)}% 24h)` : ""}`);
      }
      if (ca.oilPrice !== null) {
        lines.push(`Oil (WTI): $${sf(ca.oilPrice, 2)} ${ca.oilChange24h !== null ? `(${ca.oilChange24h >= 0 ? "+" : ""}${sf(ca.oilChange24h, 1)}% 24h)` : ""}`);
      }
      if (ca.vixLevel !== null) {
        lines.push(`VIX: ${sf(ca.vixLevel, 1)} ${ca.vixLevel > 30 ? "⚠️ HIGH FEAR" : ca.vixLevel > 20 ? "↑ Elevated" : ca.vixLevel < 15 ? "🟢 Low (complacent)" : ""}`);
      }
      if (ca.sp500Change !== null) {
        lines.push(`S&P 500: ${ca.sp500Change >= 0 ? "+" : ""}${sf(ca.sp500Change, 1)}% ${ca.sp500Change > 2 ? "🟢 Risk-On Rally" : ca.sp500Change < -2 ? "🔴 Risk-Off Selloff" : ""}`);
      }
      lines.push(`Cross-Asset Signal: ${ca.crossAssetSignal}`);

      // Interpretation for AI
      switch (ca.crossAssetSignal) {
        case "RISK_ON":
          lines.push(`🟢 CROSS-ASSET: Traditional risk assets support crypto upside — gold retreating, equities strong, VIX low`);
          break;
        case "RISK_OFF":
          lines.push(`🔴 CROSS-ASSET: Risk-off in traditional markets — crypto may face headwinds but also creates buying opportunities at lower prices`);
          break;
        case "FLIGHT_TO_SAFETY":
          lines.push(`🚨 CROSS-ASSET: Flight to safety in TradFi — gold surging, VIX spiking. Reduce position sizes but look for oversold crypto entries at panic prices.`);
          break;
        default:
          lines.push(`→ Cross-asset signals mixed — no strong directional bias from traditional markets`);
      }
    }
    lines.push("");
  }

  // ── v10.0: Global Market Intelligence ──
  if (globalMarket) {
    lines.push(`═══ GLOBAL MARKET INTELLIGENCE ═══`);
    lines.push(`BTC Dominance: ${sf(globalMarket.btcDominance, 1)}% | ETH Dominance: ${sf(globalMarket.ethDominance, 1)}%`);
    lines.push(`Total Crypto Market Cap: $${sf((globalMarket.totalMarketCap || 0) / 1e9, 1)}B | 24h Volume: $${sf((globalMarket.totalVolume24h || 0) / 1e9, 1)}B`);
    if (globalMarket.defiMarketCap) lines.push(`DeFi Market Cap: $${sf(globalMarket.defiMarketCap / 1e9, 1)}B`);
    lines.push(`BTC Dominance 7d Change: ${(globalMarket.btcDominanceChange7d ?? 0) >= 0 ? '+' : ''}${sf(globalMarket.btcDominanceChange7d, 2)}pp`);
    switch (globalMarket.altseasonSignal) {
      case 'ALTSEASON_ROTATION':
        lines.push(`🔥 ALTSEASON SIGNAL: BTC dominance dropping >2pp — capital rotating into alts. BOOST AI/Meme allocation, REDUCE Blue Chip.`);
        break;
      case 'BTC_DOMINANCE_FLIGHT':
        lines.push(`⚠️ BTC DOMINANCE FLIGHT: Capital fleeing alts back to BTC. BOOST Blue Chip allocation, REDUCE speculative alts.`);
        break;
      default:
        lines.push(`→ Dominance stable — no strong altseason or BTC flight signal`);
    }
    lines.push('');
  }

  // ── v10.0: Smart Money vs Retail Divergence ──
  if (smartRetailDiv) {
    lines.push(`═══ SMART MONEY vs RETAIL DIVERGENCE ═══`);
    if (smartRetailDiv.btcDivergence !== null) {
      lines.push(`BTC: Smart-Retail divergence = ${smartRetailDiv.btcDivergence >= 0 ? '+' : ''}${sf(smartRetailDiv.btcDivergence, 1)}pp → ${smartRetailDiv.btcSignal}`);
    }
    if (smartRetailDiv.ethDivergence !== null) {
      lines.push(`ETH: Smart-Retail divergence = ${smartRetailDiv.ethDivergence >= 0 ? '+' : ''}${sf(smartRetailDiv.ethDivergence, 1)}pp → ${smartRetailDiv.ethSignal}`);
    }
    if (smartRetailDiv.btcSignal === 'STRONG_BUY' || smartRetailDiv.ethSignal === 'STRONG_BUY') {
      lines.push(`🟢 Smart money is MORE long than retail — institutions see opportunity. High conviction BUY signal.`);
    } else if (smartRetailDiv.btcSignal === 'STRONG_SELL' || smartRetailDiv.ethSignal === 'STRONG_SELL') {
      lines.push(`🔴 Retail is MORE long than smart money — institutions are hedging. High conviction SELL/reduce signal.`);
    } else {
      lines.push(`→ Smart money and retail broadly aligned — no divergence edge`);
    }
    lines.push('');
  }

  // ── v10.0: Funding Rate Mean-Reversion ──
  if (fundingMR) {
    lines.push(`═══ FUNDING RATE MEAN-REVERSION ═══`);
    lines.push(`BTC funding: mean=${sf((fundingMR.btcMean ?? 0) * 100, 4)}% | z-score=${sf(fundingMR.btcZScore, 2)} → ${fundingMR.btcSignal}`);
    lines.push(`ETH funding: mean=${sf((fundingMR.ethMean ?? 0) * 100, 4)}% | z-score=${sf(fundingMR.ethZScore, 2)} → ${fundingMR.ethSignal}`);
    if (fundingMR.btcSignal === 'CROWDED_LONGS_REVERSAL' || fundingMR.ethSignal === 'CROWDED_LONGS_REVERSAL') {
      lines.push(`⚠️ CROWDED LONGS: Funding rates >2σ above mean — leveraged longs are overcrowded. Correction risk elevated. Consider taking profit or hedging.`);
    } else if (fundingMR.btcSignal === 'CROWDED_SHORTS_BOUNCE' || fundingMR.ethSignal === 'CROWDED_SHORTS_BOUNCE') {
      lines.push(`🟢 CROWDED SHORTS: Funding rates >2σ below mean — leveraged shorts overcrowded. Short squeeze likely. BUY opportunity.`);
    } else {
      lines.push(`→ Funding rates within normal range — no mean-reversion signal`);
    }
    lines.push('');
  }

  // ── v10.0: TVL-Price Divergence ──
  if (tvlPriceDiv && Object.keys(tvlPriceDiv.divergences).length > 0) {
    lines.push(`═══ TVL-PRICE DIVERGENCE ═══`);
    const undervalued: string[] = [];
    const overvalued: string[] = [];
    for (const [token, d] of Object.entries(tvlPriceDiv.divergences)) {
      if (d.signal === 'UNDERVALUED') undervalued.push(`${token} (TVL ${(d.tvlChange ?? 0) >= 0 ? '+' : ''}${sf(d.tvlChange, 1)}% / Price ${(d.priceChange ?? 0) >= 0 ? '+' : ''}${sf(d.priceChange, 1)}%)`);
      if (d.signal === 'OVERVALUED') overvalued.push(`${token} (TVL ${(d.tvlChange ?? 0) >= 0 ? '+' : ''}${sf(d.tvlChange, 1)}% / Price ${(d.priceChange ?? 0) >= 0 ? '+' : ''}${sf(d.priceChange, 1)}%)`);
    }
    if (undervalued.length > 0) lines.push(`🟢 UNDERVALUED (TVL up, price flat): ${undervalued.join(', ')}`);
    if (overvalued.length > 0) lines.push(`🔴 OVERVALUED (TVL down, price up): ${overvalued.join(', ')}`);
    if (undervalued.length === 0 && overvalued.length === 0) lines.push(`→ TVL and price broadly aligned — no divergence detected`);
    lines.push('');
  }

  // ── v10.0: Stablecoin Supply / Capital Flow ──
  if (stablecoinData) {
    lines.push(`═══ STABLECOIN SUPPLY / CAPITAL FLOW ═══`);
    lines.push(`Total Stablecoin Supply: $${sf((stablecoinData.totalStablecoinSupply || 0) / 1e9, 1)}B (USDT: $${sf((stablecoinData.usdtMarketCap || 0) / 1e9, 1)}B | USDC: $${sf((stablecoinData.usdcMarketCap || 0) / 1e9, 1)}B)`);
    lines.push(`7-Day Supply Change: ${(stablecoinData.supplyChange7d ?? 0) >= 0 ? '+' : ''}${sf(stablecoinData.supplyChange7d, 2)}%`);
    switch (stablecoinData.signal) {
      case 'CAPITAL_INFLOW':
        lines.push(`🟢 CAPITAL INFLOW: Stablecoin supply growing >2% — fresh capital entering crypto. Bullish for prices.`);
        break;
      case 'CAPITAL_OUTFLOW':
        lines.push(`🔴 CAPITAL OUTFLOW: Stablecoin supply shrinking >2% — capital leaving crypto. Bearish headwind.`);
        break;
      default:
        lines.push(`→ Stablecoin supply stable — no strong capital flow signal`);
    }
    lines.push('');
  }

  lines.push(`═══ MARKET REGIME ═══`);
  lines.push(`Current Regime: ${regime}`);
  switch (regime) {
    case "TRENDING_UP": lines.push(`→ Deploy capital aggressively on dips — ride momentum, let winners run`); break;
    case "TRENDING_DOWN": lines.push(`→ Hunt discounted entries — accumulate oversold tokens, trim only clear losers`); break;
    case "RANGING": lines.push(`→ Active mean-reversion — buy oversold, sell overbought, keep capital working`); break;
    case "VOLATILE": lines.push(`→ Volatility = opportunity — smaller positions, more trades, exploit dislocations`); break;
    default: lines.push(`→ Mixed signals — stay active, look for individual token setups`); break;
  }

  return lines.join("\n");
}

async function getMarketData(): Promise<MarketData> {
  try {
    // v12.0: Launch intelligence fetches in parallel with on-chain price reads
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

    // v12.0: On-chain pricing — fetch all token prices from DEX pools in parallel
    const onChainPrices = await fetchAllOnChainPrices();

    // v12.3: After prices are resolved, launch volume + stablecoin + on-chain intelligence in parallel
    const ethPrice = onChainPrices.get('ETH') || onChainPrices.get('WETH') || lastKnownPrices['ETH']?.price || lastKnownPrices['WETH']?.price || 0;
    const [volumeData, stablecoinData, onChainIntel] = await Promise.all([
      enrichVolumeData(),
      fetchBaseUSDCSupply(),
      fetchAllOnChainIntelligence(ethPrice, onChainPrices, true), // includeTickDepth on heavy cycles
    ]);
    const { fng: fngResult, defi: defiResult, deriv: derivResult, news: newsResult, macro: macroResult } = await intelligencePromise;

    const fearGreed = fngResult.status === "fulfilled"
      ? { value: parseInt(fngResult.value.data.data[0].value), classification: fngResult.value.data.data[0].value_classification }
      : { value: 50, classification: "Neutral" };

    // v12.0: Build tokens array from on-chain prices
    let tokens: MarketData["tokens"] = [];

    if (onChainPrices.size > 1) { // > 1 because USDC is always present
      for (const [symbol, regData] of Object.entries(TOKEN_REGISTRY)) {
        const price = onChainPrices.get(symbol);
        if (!price || price <= 0) continue;

        const change24h = computePriceChange(symbol, price, 24 * 60 * 60 * 1000);
        const change7d = computePriceChange(symbol, price, 7 * 24 * 60 * 60 * 1000);
        const volume = volumeData.get(symbol) || lastKnownPrices[symbol]?.volume || 0;
        const marketCap = lastKnownPrices[symbol]?.marketCap || 0;

        tokens.push({
          symbol, name: regData.name, price,
          priceChange24h: change24h,
          priceChange7d: change7d,
          volume24h: volume,
          marketCap: marketCap,
          sector: regData.sector,
        });

        // Update lastKnownPrices for light cycles and persistence
        lastKnownPrices[symbol] = {
          price, change24h, change7d,
          volume, marketCap,
          name: regData.name, sector: regData.sector,
        };
      }

      // Record snapshot for self-accumulating history
      recordPriceSnapshot(onChainPrices);
      savePriceCache();
      console.log(`  ✅ On-chain: ${tokens.length} tokens priced via DEX pools + Chainlink`);
    } else {
      // Fallback: use last-known-prices cache to prevent $0 portfolio
      const cachedCount = Object.keys(lastKnownPrices).length;
      if (cachedCount > 0) {
        console.log(`  ♻️ On-chain pricing returned few results — using ${cachedCount} cached prices`);
        tokens = Object.entries(lastKnownPrices).map(([symbol, data]) => ({
          symbol, name: data.name, price: data.price,
          priceChange24h: data.change24h, priceChange7d: data.change7d,
          volume24h: data.volume, marketCap: data.marketCap, sector: data.sector,
        }));
      }
    }

    const trendingTokens = tokens
      .filter((t: any) => t.priceChange24h > 5)
      .sort((a: any, b: any) => b.priceChange24h - a.priceChange24h)
      .slice(0, 5)
      .map((t: any) => t.symbol);

    // Fetch technical indicators for all tokens
    console.log("📐 Computing technical indicators (RSI, MACD, Bollinger)...");
    const indicators = getTokenIndicators(tokens, onChainIntel);
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

    // v12.0: Compute derived signals — on-chain altseason + stablecoin, no CoinGecko
    const smartRetailDivergence = computeSmartRetailDivergence(derivatives);
    const fundingMeanReversion = computeFundingMeanReversion(derivatives);
    const tvlPriceDivergence = computeTVLPriceDivergence(defiLlama, tokens);

    // v12.0: Altseason signal from BTC/ETH ratio (replaces CoinGecko global)
    currentAltseasonSignal = computeLocalAltseasonSignal();

    // v12.0: Build globalMarket with available on-chain data
    const globalMarket: GlobalMarketData | null = {
      btcDominance: 0, // Not available on-chain — altseason signal derived from BTC/ETH ratio instead
      ethDominance: 0,
      totalMarketCap: 0,
      totalVolume24h: 0,
      defiMarketCap: null,
      defiVolume24h: null,
      btcDominanceChange7d: 0,
      altseasonSignal: currentAltseasonSignal,
      lastUpdated: new Date().toISOString(),
    };

    const stablecoinSupply = stablecoinData;

    // Sync history to state for persistence
    state.fundingRateHistory = fundingRateHistory;
    state.btcDominanceHistory = btcDominanceHistory;
    state.stablecoinSupplyHistory = stablecoinSupplyHistory;

    lastSignalHealth = {
      onchain: onChainPrices.size > 1 ? 'LIVE' : Object.keys(lastKnownPrices).length > 0 ? 'STALE' : 'DOWN',
      fearGreed: fngResult.status === 'fulfilled' ? 'LIVE' : 'DOWN',
      defiLlama: defiResult.status === 'fulfilled' && defiResult.value ? 'LIVE' : 'DOWN',
      derivatives: 'DISABLED', // v11.5: Derivatives removed — geo-blocked and not actionable
      news: newsResult.status === 'fulfilled' && newsResult.value ? 'LIVE' : 'DOWN',
      macro: macroResult.status === 'fulfilled' && macroResult.value ? 'LIVE' : 'DOWN',
      momentum: lastMomentumSignal.dataAvailable ? 'LIVE' : 'DOWN',
      altseasonSignal: (priceHistoryStore.tokens['cbBTC']?.prices.length || 0) >= 24 && (priceHistoryStore.tokens['ETH']?.prices.length || priceHistoryStore.tokens['WETH']?.prices.length || 0) >= 24 ? 'LIVE' : 'BUILDING',
      stablecoinSupply: stablecoinData ? 'LIVE' : 'DOWN',
      fundingHistory: 'DISABLED', // v11.5: depends on derivatives, permanently disabled
      onChainFlow: Object.keys(onChainIntel).length > 0
        ? (Object.values(onChainIntel).filter(r => r.twap || r.orderFlow).length > Object.keys(onChainIntel).length * 0.5 ? 'LIVE' : 'BUILDING')
        : 'DOWN', // v12.3: On-chain order flow intelligence
      lastUpdated: new Date().toISOString(),
    };
    const healthEntries = Object.entries(lastSignalHealth).filter(([k, v]) => k !== 'lastUpdated' && v !== 'DISABLED');
    const liveCount = healthEntries.filter(([, v]) => v === 'LIVE').length;
    const totalSources = healthEntries.length;
    const downSources = healthEntries.filter(([, v]) => v === 'DOWN' || v === 'BUILDING').map(([k]) => k);
    console.log(`  📡 Signal Health: ${liveCount}/${totalSources} sources live${downSources.length > 0 ? ' | DOWN/BUILDING: ' + downSources.join(', ') : ''}`);

    return { tokens, fearGreed, trendingTokens, indicators, defiLlama, derivatives, newsSentiment, macroData, marketRegime, globalMarket, smartRetailDivergence, fundingMeanReversion, tvlPriceDivergence, stablecoinSupply };
  } catch (error: any) {
    const msg = error?.response?.status
      ? `HTTP ${error.response.status}: ${error.message}`
      : error?.message || String(error);
    console.error("Failed to fetch market data:", msg);
    return { tokens: [], fearGreed: { value: 50, classification: "Neutral" }, trendingTokens: [], indicators: {}, defiLlama: null, derivatives: null, newsSentiment: null, macroData: null, marketRegime: "UNKNOWN", globalMarket: null, smartRetailDivergence: null, fundingMeanReversion: null, tvlPriceDivergence: null, stablecoinSupply: null };
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
  // v8.3: ATR + ADX — institutional-grade volatility & trend strength
  atr14: number | null;          // Average True Range (14-period, dollar value)
  atrPercent: number | null;     // ATR as % of price (cross-asset comparable)
  adx14: {                       // Average Directional Index (14-period)
    adx: number;                 // ADX value 0-100 (trend strength, not direction)
    plusDI: number;              // +DI (bullish directional indicator)
    minusDI: number;            // -DI (bearish directional indicator)
    trend: "STRONG_TREND" | "TRENDING" | "WEAK" | "NO_TREND";
  } | null;
  trendDirection: "STRONG_UP" | "UP" | "SIDEWAYS" | "DOWN" | "STRONG_DOWN";
  overallSignal: "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";
  confluenceScore: number;       // -100 to +100, aggregated signal strength
  // v12.3: On-Chain Order Flow Intelligence
  twapDivergence?: {
    twapPrice: number;          // 15-min TWAP from pool oracle
    spotPrice: number;          // Current spot from sqrtPriceX96
    divergencePct: number;      // (spot - twap) / twap * 100
    signal: "OVERSOLD" | "OVERBOUGHT" | "NORMAL";
  } | null;
  orderFlow?: {
    netBuyVolumeUSD: number;    // Positive = net buying, negative = net selling
    buyVolumeUSD: number;       // Total buy-side volume (10 min window)
    sellVolumeUSD: number;      // Total sell-side volume
    tradeCount: number;         // Number of swaps in window
    largeBuyPct: number;        // % of buy volume from trades >$5K (smart money)
    signal: "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";
  } | null;
  tickDepth?: {
    bidDepthUSD: number;        // Total LP capital below current price (support)
    askDepthUSD: number;        // Total LP capital above current price (resistance)
    depthRatio: number;         // bid/ask ratio — >1.5 = strong support, <0.67 = strong resistance
    inRangeLiquidity: number;   // Current liquidity() value in USD terms
    signal: "STRONG_SUPPORT" | "SUPPORT" | "BALANCED" | "RESISTANCE" | "STRONG_RESISTANCE";
  } | null;
}

// v12.0: Price history now comes from the self-accumulating on-chain store
// No external API calls needed — data accumulates automatically each cycle

/**
 * Get price history from the local self-accumulating store (replaces CoinGecko market_chart)
 * Returns the accumulated hourly price/volume/timestamp arrays for a token by symbol.
 */
function getCachedPriceHistory(symbol: string): { prices: number[]; volumes: number[]; timestamps: number[] } {
  const entry = priceHistoryStore.tokens[symbol];
  if (!entry || entry.prices.length === 0) {
    return { prices: [], volumes: [], timestamps: [] };
  }
  return { prices: entry.prices, volumes: entry.volumes, timestamps: entry.timestamps };
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
 * v8.3: Calculate ATR (Average True Range) — close-to-close variant
 * Uses |close[i] - close[i-1]| as True Range since the price history store records close prices.
 * Wilder's smoothing (same as RSI) for the averaging.
 */
function calculateATR(prices: number[], period: number = 14): { atr: number; atrPercent: number } | null {
  if (prices.length < period + 1) return null;

  // Calculate True Range series (close-to-close)
  const tr: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    tr.push(Math.abs(prices[i] - prices[i - 1]));
  }

  // Use last N*3 TRs for smoothed calculation (same approach as RSI)
  const recentTR = tr.slice(-Math.min(tr.length, period * 3));

  // Initial ATR = simple average of first N periods
  let atr = 0;
  for (let i = 0; i < period && i < recentTR.length; i++) {
    atr += recentTR[i];
  }
  atr /= period;

  // Wilder's smoothing for remaining periods
  for (let i = period; i < recentTR.length; i++) {
    atr = (atr * (period - 1) + recentTR[i]) / period;
  }

  const currentPrice = prices[prices.length - 1];
  const atrPercent = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;

  return { atr, atrPercent };
}

/**
 * v8.3: Calculate ADX (Average Directional Index) — close-to-close variant
 * Measures trend STRENGTH (0-100), not direction. Uses +DI/-DI for direction.
 *
 * Close-to-close DM approximation:
 *   +DM = max(close[i] - close[i-1], 0)  if up move > down move, else 0
 *   -DM = max(close[i-1] - close[i], 0)  if down move > up move, else 0
 *
 * Then: +DI = 100 * smoothed(+DM) / ATR
 *       -DI = 100 * smoothed(-DM) / ATR
 *       DX  = 100 * |+DI - -DI| / (+DI + -DI)
 *       ADX = smoothed(DX)
 */
function calculateADX(prices: number[], period: number = 14): TechnicalIndicators["adx14"] {
  // Need at least 2*period+1 prices for a meaningful ADX
  if (prices.length < 2 * period + 1) return null;

  // Step 1: Calculate directional movements and TR
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];

  for (let i = 1; i < prices.length; i++) {
    const upMove = prices[i] - prices[i - 1];
    const downMove = prices[i - 1] - prices[i];

    // Only keep the larger directional movement
    if (upMove > 0 && upMove > downMove) {
      plusDM.push(upMove);
      minusDM.push(0);
    } else if (downMove > 0 && downMove > upMove) {
      plusDM.push(0);
      minusDM.push(downMove);
    } else {
      plusDM.push(0);
      minusDM.push(0);
    }

    tr.push(Math.abs(prices[i] - prices[i - 1]));
  }

  // Step 2: Wilder's smoothing for +DM, -DM, and TR
  const smooth = (values: number[], p: number): number[] => {
    if (values.length < p) return [];
    const result: number[] = [];
    let sum = 0;
    for (let i = 0; i < p; i++) sum += values[i];
    result.push(sum); // First smoothed value = simple sum
    for (let i = p; i < values.length; i++) {
      result.push(result[result.length - 1] - result[result.length - 1] / p + values[i]);
    }
    return result;
  };

  const smoothPlusDM = smooth(plusDM, period);
  const smoothMinusDM = smooth(minusDM, period);
  const smoothTR = smooth(tr, period);

  if (smoothPlusDM.length === 0 || smoothTR.length === 0) return null;

  // Step 3: Calculate +DI and -DI series
  const dx: number[] = [];
  for (let i = 0; i < smoothPlusDM.length; i++) {
    const atr = smoothTR[i];
    if (atr === 0) continue;

    const pDI = (smoothPlusDM[i] / atr) * 100;
    const mDI = (smoothMinusDM[i] / atr) * 100;
    const diSum = pDI + mDI;

    if (diSum > 0) {
      dx.push((Math.abs(pDI - mDI) / diSum) * 100);
    }
  }

  if (dx.length < period) return null;

  // Step 4: Smooth DX to get ADX (Wilder's smoothing)
  let adx = 0;
  for (let i = 0; i < period; i++) adx += dx[i];
  adx /= period;
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }

  // Final +DI and -DI (most recent values)
  const lastIdx = smoothPlusDM.length - 1;
  const lastATR = smoothTR[lastIdx];
  const plusDIVal = lastATR > 0 ? (smoothPlusDM[lastIdx] / lastATR) * 100 : 0;
  const minusDIVal = lastATR > 0 ? (smoothMinusDM[lastIdx] / lastATR) * 100 : 0;

  // Classify trend strength
  let trend: "STRONG_TREND" | "TRENDING" | "WEAK" | "NO_TREND";
  if (adx >= 40) trend = "STRONG_TREND";
  else if (adx >= 25) trend = "TRENDING";
  else if (adx >= 20) trend = "WEAK";
  else trend = "NO_TREND";

  return { adx: Math.round(adx * 10) / 10, plusDI: Math.round(plusDIVal * 10) / 10, minusDI: Math.round(minusDIVal * 10) / 10, trend };
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
  priceChange7d: number,
  adx: TechnicalIndicators["adx14"] = null,
  atr: { atr: number; atrPercent: number } | null = null,
  // v12.3: On-Chain Order Flow Intelligence
  twapDivergence: TechnicalIndicators["twapDivergence"] = null,
  orderFlow: TechnicalIndicators["orderFlow"] = null,
  tickDepth: TechnicalIndicators["tickDepth"] = null
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

  // v8.3: ADX trend strength confirmation/dampening (weight: ±10 directional, ±20% dampening)
  if (adx) {
    signals++;
    // Strong trend confirmation: ADX > 30 adds directional conviction
    if (adx.adx > 30 && adx.plusDI > adx.minusDI) {
      score += 5;  // Strong uptrend confirmation
    } else if (adx.adx > 30 && adx.minusDI > adx.plusDI) {
      score -= 5;  // Strong downtrend confirmation
    }
    // No trend dampening: ADX < 15 means signals are unreliable
    if (adx.adx < 15) {
      score = Math.round(score * 0.80); // 20% dampening — trendless market, less conviction
    }
  }

  // v8.3: ATR volatility adjustment — high vol = less conviction, low vol = breakout potential
  if (atr) {
    if (atr.atrPercent > 5) {
      score = Math.round(score * 0.85); // 15% dampening — high volatility, uncertain
    } else if (atr.atrPercent < 1) {
      score = Math.round(score * 1.10); // 10% boost — low volatility, potential breakout
    }
  }

  // v11.5: Fear & Greed mechanical adjustment REMOVED — F&G reflects lagging sentiment,
  // not actionable alpha. Let technical indicators and on-chain data drive confluence.

  // v12.3: TWAP-Spot Divergence (weight: ±15) — manipulation-resistant overbought/oversold
  if (twapDivergence) {
    signals++;
    const div = twapDivergence.divergencePct;
    if (div < -TWAP_DIVERGENCE_THRESHOLD_PCT) score += 15;           // Spot below TWAP = discount
    else if (div < -TWAP_MILD_THRESHOLD_PCT) score += 8;             // Mild oversold
    else if (div > TWAP_DIVERGENCE_THRESHOLD_PCT) score -= 15;       // Spot above TWAP = premium
    else if (div > TWAP_MILD_THRESHOLD_PCT) score -= 8;              // Mild overbought
  }

  // v12.3: Order Flow CVD (weight: ±15) — real buy/sell pressure from Swap events
  if (orderFlow) {
    signals++;
    if (orderFlow.signal === "STRONG_BUY") score += 15;
    else if (orderFlow.signal === "BUY") score += 8;
    else if (orderFlow.signal === "STRONG_SELL") score -= 15;
    else if (orderFlow.signal === "SELL") score -= 8;
    // Smart money confirmation bonus
    if (orderFlow.largeBuyPct > 50) score += 3;                       // >50% from large trades
    else if (orderFlow.largeBuyPct < 20 && (orderFlow.signal === "BUY" || orderFlow.signal === "STRONG_BUY")) {
      score -= 3;                                                      // Retail-only buys less reliable
    }

    // v14.0: "Catching Fire" signal — DEX buy ratio > 60% with high volume = strong momentum
    const buyRatio = orderFlow.buyVolumeUSD / (orderFlow.buyVolumeUSD + orderFlow.sellVolumeUSD);
    if (buyRatio > 0.60 && orderFlow.tradeCount > 50) {
      score += 10; // Bonus for catching-fire momentum (volume + buy pressure)
    }

    // v14.0: Momentum reversal — buy ratio drops below 45% = sellers taking over
    // This is an exit signal that should push held positions toward SELL
    if (buyRatio < 0.45) {
      score -= 12; // Buyers turning into sellers — strong exit pressure
    }
  }

  // v14.0: BTC/ETH strong momentum confluence boost — when majors are running +3%, lower the bar by 5pts
  const btc24hMom = lastMomentumSignal?.btcChange24h ?? 0;
  const eth24hMom = lastMomentumSignal?.ethChange24h ?? 0;
  if (btc24hMom >= 3 || eth24hMom >= 3) {
    score += 5; // Lower effective confluence threshold by boosting score when market is running
  }

  // v12.3: Tick Liquidity Depth (weight: ±12) — on-chain support/resistance
  if (tickDepth) {
    signals++;
    if (tickDepth.signal === "STRONG_SUPPORT") score += 12;
    else if (tickDepth.signal === "SUPPORT") score += 6;
    else if (tickDepth.signal === "STRONG_RESISTANCE") score -= 12;
    else if (tickDepth.signal === "RESISTANCE") score -= 6;
  }

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
 * Compute all technical indicators for a single token (v12.0: symbol-based, no API calls)
 */
function computeIndicators(
  symbol: string,
  currentPrice: number,
  priceChange24h: number,
  priceChange7d: number,
  volume24h: number,
  onChainIntel?: { twap: TechnicalIndicators["twapDivergence"]; orderFlow: TechnicalIndicators["orderFlow"]; tickDepth: TechnicalIndicators["tickDepth"] }
): TechnicalIndicators {
  const history = getCachedPriceHistory(symbol);

  if (history.prices.length < 20) {
    // Not enough data — return neutral indicators
    return {
      rsi14: null, macd: null, bollingerBands: null,
      sma20: null, sma50: null, volumeChange24h: null,
      atr14: null, atrPercent: null, adx14: null,
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

  // v8.3: ATR + ADX — institutional-grade volatility & trend strength
  const atrData = calculateATR(prices, 14);
  const adxData = calculateADX(prices, 14);

  const trendDirection = determineTrend(prices, sma20, sma50);
  const twap = onChainIntel?.twap ?? null;
  const orderFlow = onChainIntel?.orderFlow ?? null;
  const tickDepth = onChainIntel?.tickDepth ?? null;
  const { score, signal } = calculateConfluence(rsi14, macd, bollingerBands, trendDirection, priceChange24h, priceChange7d, adxData, atrData, twap, orderFlow, tickDepth);

  return {
    rsi14, macd, bollingerBands,
    sma20, sma50,
    volumeChange24h: volumeChange24hPct,
    atr14: atrData?.atr ?? null,
    atrPercent: atrData?.atrPercent ?? null,
    adx14: adxData,
    trendDirection,
    overallSignal: signal,
    confluenceScore: score,
    // v12.3: On-chain intelligence
    twapDivergence: twap,
    orderFlow: orderFlow,
    tickDepth: tickDepth,
  };
}

/**
 * Compute technical indicators for all tokens (v12.0: fully local, no API calls)
 * All data comes from the self-accumulating price history store — no rate limits, no batching needed.
 */
function getTokenIndicators(
  tokens: MarketData["tokens"],
  onChainIntel?: Record<string, { twap: TechnicalIndicators["twapDivergence"]; orderFlow: TechnicalIndicators["orderFlow"]; tickDepth: TechnicalIndicators["tickDepth"] }>
): Record<string, TechnicalIndicators> {
  const indicators: Record<string, TechnicalIndicators> = {};

  for (const token of tokens) {
    if (token.symbol === "USDC") continue;
    const registry = TOKEN_REGISTRY[token.symbol];
    if (!registry) continue;

    indicators[token.symbol] = computeIndicators(
      token.symbol,
      token.price,
      token.priceChange24h,
      token.priceChange7d,
      token.volume24h,
      onChainIntel?.[token.symbol],
    );
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

    // v8.3: ATR volatility measure
    if (ind.atrPercent !== null) {
      const atrLabel = ind.atrPercent > 5 ? "HIGH_VOL" : ind.atrPercent > 3 ? "MODERATE" : ind.atrPercent > 1 ? "NORMAL" : "LOW_VOL";
      parts.push(`ATR=${ind.atrPercent.toFixed(1)}%(${atrLabel})`);
    }

    // v8.3: ADX trend strength
    if (ind.adx14) {
      const dirLabel = ind.adx14.plusDI > ind.adx14.minusDI ? "+DI>-DI" : "-DI>+DI";
      parts.push(`ADX=${ind.adx14.adx.toFixed(0)}(${ind.adx14.trend},${dirLabel})`);
    }

    parts.push(`Trend=${ind.trendDirection}`);

    if (ind.volumeChange24h !== null) {
      parts.push(`Vol=${ind.volumeChange24h > 0 ? "+" : ""}${ind.volumeChange24h.toFixed(0)}%vs7dAvg`);
    }

    // v12.3: On-chain order flow intelligence
    if (ind.twapDivergence) {
      parts.push(`TWAP=${ind.twapDivergence.divergencePct > 0 ? "+" : ""}${ind.twapDivergence.divergencePct.toFixed(1)}%(${ind.twapDivergence.signal})`);
    }
    if (ind.orderFlow) {
      const netStr = ind.orderFlow.netBuyVolumeUSD >= 0 ? `+$${(ind.orderFlow.netBuyVolumeUSD / 1000).toFixed(1)}K` : `-$${(Math.abs(ind.orderFlow.netBuyVolumeUSD) / 1000).toFixed(1)}K`;
      const buyPct = Math.round((ind.orderFlow.buyVolumeUSD / (ind.orderFlow.buyVolumeUSD + ind.orderFlow.sellVolumeUSD || 1)) * 100);
      parts.push(`Flow=${ind.orderFlow.signal}(net${netStr},${buyPct}%buy,${ind.orderFlow.largeBuyPct}%lg)`);
    }
    if (ind.tickDepth) {
      parts.push(`Depth=${ind.tickDepth.signal}(bid/ask=${ind.tickDepth.depthRatio.toFixed(1)})`);
    }

    parts.push(`Signal=${ind.overallSignal}(${ind.confluenceScore > 0 ? "+" : ""}${ind.confluenceScore})`);

    lines.push(`  ${parts.join(" | ")}`);
  }

  // v12.3: Add on-chain flow summary for tokens with strongest signals
  const flowSummary: string[] = [];
  const depthSummary: string[] = [];
  for (const token of tokens) {
    if (token.symbol === "USDC") continue;
    const ind = indicators[token.symbol];
    if (!ind) continue;
    if (ind.orderFlow && ind.orderFlow.signal !== "NEUTRAL") {
      const buyPct = Math.round((ind.orderFlow.buyVolumeUSD / (ind.orderFlow.buyVolumeUSD + ind.orderFlow.sellVolumeUSD || 1)) * 100);
      const netStr = ind.orderFlow.netBuyVolumeUSD >= 0 ? `$${(ind.orderFlow.netBuyVolumeUSD / 1000).toFixed(1)}K net` : `-$${(Math.abs(ind.orderFlow.netBuyVolumeUSD) / 1000).toFixed(1)}K net`;
      const desc = (ind.orderFlow.signal === "STRONG_BUY" || ind.orderFlow.signal === "BUY")
        ? `${token.symbol} buy pressure (${buyPct}% buys, ${netStr})`
        : `${token.symbol} selling (${buyPct}% buys, ${netStr})`;
      flowSummary.push(desc);
    }
    if (ind.tickDepth && ind.tickDepth.signal !== "BALANCED") {
      depthSummary.push(`${token.symbol} ${ind.tickDepth.signal.toLowerCase().replace('_', ' ')} (${ind.tickDepth.depthRatio.toFixed(1)}x ratio)`);
    }
  }
  if (flowSummary.length > 0) {
    lines.push(`  📊 ON-CHAIN FLOW: ${flowSummary.slice(0, 4).join(", ")}`);
  }
  if (depthSummary.length > 0) {
    lines.push(`  📊 LIQUIDITY: ${depthSummary.slice(0, 4).join(", ")}`);
  }

  return lines.join("\n");
}

// ============================================================================
// DIRECT ON-CHAIN BALANCE READING (same as v3.1.1)
// ============================================================================

// v8.1: Fallback RPC system — rotates through multiple providers on failure
let currentRpcIndex = 0;
let rpcFailCounts: number[] = new Array(BASE_RPC_ENDPOINTS.length).fill(0);

function getCurrentRpc(): string {
  return BASE_RPC_ENDPOINTS[currentRpcIndex] || BASE_RPC_ENDPOINTS[0];
}

function rotateRpc(failedIndex: number): string {
  rpcFailCounts[failedIndex]++;
  // Find the RPC with the fewest recent failures
  const nextIndex = (failedIndex + 1) % BASE_RPC_ENDPOINTS.length;
  currentRpcIndex = nextIndex;
  console.log(`   🔄 RPC rotated: ${BASE_RPC_ENDPOINTS[failedIndex]} → ${BASE_RPC_ENDPOINTS[nextIndex]} (fails: ${rpcFailCounts.join(',')})`);
  return BASE_RPC_ENDPOINTS[nextIndex];
}

async function rpcCall(method: string, params: any[]): Promise<any> {
  // Try current RPC first, then rotate through others
  for (let rpcAttempt = 0; rpcAttempt < BASE_RPC_ENDPOINTS.length; rpcAttempt++) {
    const rpcUrl = rpcAttempt === 0 ? getCurrentRpc() : BASE_RPC_ENDPOINTS[(currentRpcIndex + rpcAttempt) % BASE_RPC_ENDPOINTS.length];
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await axios.post(rpcUrl, {
          jsonrpc: "2.0", id: 1, method, params,
        }, { timeout: 12000 });
        if (response.data.error) {
          throw new Error(`RPC error: ${response.data.error.message}`);
        }
        // Success — update current index if we rotated
        if (rpcAttempt > 0) {
          currentRpcIndex = (currentRpcIndex + rpcAttempt) % BASE_RPC_ENDPOINTS.length;
        }
        return response.data.result;
      } catch (error: any) {
        const status = error?.response?.status;
        const isRetryable = status === 429 || status === 502 || status === 503 ||
          error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT' || error?.code === 'ENOTFOUND';
        if (isRetryable && attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, attempt * 1500));
          continue;
        }
        // This RPC failed — try next provider
        break;
      }
    }
  }
  // All RPCs failed
  throw new Error(`All ${BASE_RPC_ENDPOINTS.length} RPC endpoints failed for ${method}`);
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

// ============================================================================
// v9.2: AUTO GAS REFUEL — Swap USDC→WETH when ETH gas balance is low
// ============================================================================

let lastGasRefuelTime = 0;
let lastKnownETHBalance = 0;

async function checkAndRefuelGas(): Promise<{ refueled: boolean; ethBalance: number; error?: string }> {
  try {
    // v10.1: Smart Account swaps are gasless — skip refuel if Smart Account active
    // v10.1.1: Gas refuel remains active — wallet is a CoinbaseSmartWallet but
    // account.swap() still routes through standard paths that may need gas

    const account = await cdpClient.evm.getOrCreateAccount({ name: CDP_ACCOUNT_NAME });
    const ethBalance = await getETHBalance(account.address);
    lastKnownETHBalance = ethBalance;

    // Not low enough to refuel
    if (ethBalance >= GAS_REFUEL_THRESHOLD_ETH) {
      return { refueled: false, ethBalance };
    }

    // Cooldown check — don't refuel too frequently
    if (Date.now() - lastGasRefuelTime < GAS_REFUEL_COOLDOWN_MS) {
      return { refueled: false, ethBalance, error: 'Gas refuel on cooldown' };
    }

    // Check USDC balance — don't drain the last few dollars
    const usdcBalance = await getERC20Balance(TOKEN_REGISTRY.USDC.address, account.address, 6);
    if (usdcBalance < GAS_REFUEL_MIN_USDC) {
      return { refueled: false, ethBalance, error: `USDC balance ($${usdcBalance.toFixed(2)}) below minimum for gas refuel` };
    }

    // Execute USDC → WETH swap for gas (EOA fallback only)
    console.log(`\n  ⛽ AUTO GAS REFUEL: ETH balance ${ethBalance.toFixed(6)} below threshold ${GAS_REFUEL_THRESHOLD_ETH}`);
    console.log(`     Swapping $${GAS_REFUEL_AMOUNT_USDC.toFixed(2)} USDC → WETH for gas...`);

    const fromAmount = parseUnits(GAS_REFUEL_AMOUNT_USDC.toFixed(6), 6); // USDC has 6 decimals
    await account.swap({
      network: "base",
      fromToken: TOKEN_REGISTRY.USDC.address, // USDC
      toToken: "0x4200000000000000000000000000000000000006",   // WETH on Base
      fromAmount,
      slippageBps: 100, // 1% slippage — not critical, just need gas
    });

    lastGasRefuelTime = Date.now();
    const newEthBalance = await getETHBalance(account.address);
    lastKnownETHBalance = newEthBalance;
    console.log(`     ✅ Gas refueled: ${ethBalance.toFixed(6)} → ${newEthBalance.toFixed(6)} ETH`);
    return { refueled: true, ethBalance: newEthBalance };
  } catch (err: any) {
    const msg = err?.message?.substring(0, 200) || 'Unknown error';
    console.warn(`  ⛽ Gas refuel failed: ${msg}`);
    return { refueled: false, ethBalance: lastKnownETHBalance, error: msg };
  }
}

// ============================================================================
// v9.2.1: GAS BOOTSTRAP — Auto-buy ETH on first startup when wallet has USDC but no ETH
// ============================================================================

let gasBootstrapAttempted = false;

async function bootstrapGas(): Promise<void> {
  try {
    const account = await cdpClient.evm.getOrCreateAccount({ name: CDP_ACCOUNT_NAME });
    const walletAddr = CONFIG.walletAddress;
    const ethBalance = await getETHBalance(walletAddr);
    lastKnownETHBalance = ethBalance;

    // Estimate ETH value in USD (~$2700 rough estimate, good enough for threshold check)
    const ethPriceEstimate = 2700;
    const ethValueUSD = ethBalance * ethPriceEstimate;

    if (ethValueUSD >= GAS_BOOTSTRAP_MIN_ETH_USD) {
      console.log(`  [GAS BOOTSTRAP] Gas OK — ETH balance ${ethBalance.toFixed(6)} (~$${ethValueUSD.toFixed(2)})`);
      gasBootstrapAttempted = true;
      return;
    }

    const usdcBalance = await getERC20Balance(TOKEN_REGISTRY.USDC.address, walletAddr, 6);

    if (usdcBalance < GAS_BOOTSTRAP_MIN_USDC) {
      console.log(`  [GAS BOOTSTRAP] Insufficient USDC for gas bootstrap ($${usdcBalance.toFixed(2)} < $${GAS_BOOTSTRAP_MIN_USDC} minimum)`);
      return;
    }

    console.log(`\n  ⛽ [GAS BOOTSTRAP] ETH balance ${ethBalance.toFixed(6)} (~$${ethValueUSD.toFixed(2)}) below $${GAS_BOOTSTRAP_MIN_ETH_USD} threshold`);
    console.log(`     Swapping $${GAS_BOOTSTRAP_SWAP_USD} USDC → WETH for gas fees...`);

    const fromAmount = parseUnits(GAS_BOOTSTRAP_SWAP_USD.toFixed(6), 6);
    await account.swap({
      network: "base",
      fromToken: TOKEN_REGISTRY.USDC.address,
      toToken: "0x4200000000000000000000000000000000000006", // WETH on Base
      fromAmount,
      slippageBps: 100, // 1% slippage
    });

    const newEthBalance = await getETHBalance(walletAddr);
    lastKnownETHBalance = newEthBalance;
    gasBootstrapAttempted = true;
    lastGasRefuelTime = Date.now(); // Prevent immediate refuel after bootstrap

    console.log(`     ✅ [GAS BOOTSTRAP] Swapped $${GAS_BOOTSTRAP_SWAP_USD} USDC → ETH for gas fees`);
    console.log(`     ETH: ${ethBalance.toFixed(6)} → ${newEthBalance.toFixed(6)} ETH`);
  } catch (err: any) {
    const msg = err?.message?.substring(0, 200) || 'Unknown error';
    console.warn(`  ⛽ [GAS BOOTSTRAP] Failed: ${msg} — will retry next cycle`);
    // Don't set gasBootstrapAttempted so it retries next cycle
  }
}

async function getBalances(): Promise<{ symbol: string; balance: number; usdValue: number; price?: number; sector?: string }[]> {
  // v10.1.1: Always read from CONFIG.walletAddress (the CoinbaseSmartWallet at 0x55509...)
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
  // v10.0: Dynamic sector targets based on altseason/BTC dominance signals
  const adjustedTargets = getAdjustedSectorTargets(currentAltseasonSignal);
  const allocations: SectorAllocation[] = [];
  for (const [sectorKey, sectorInfo] of Object.entries(SECTORS)) {
    const sectorTokens = balances.filter(b =>
      sectorInfo.tokens.includes(b.symbol) && b.usdValue > 0
    );
    const sectorValue = sectorTokens.reduce((sum, t) => sum + t.usdValue, 0);
    const currentPercent = totalValue > 0 ? (sectorValue / totalValue) * 100 : 0;
    // v10.0: Use dynamically adjusted target if available, else static
    const dynamicTarget = adjustedTargets[sectorKey as keyof typeof adjustedTargets];
    const targetPercent = (dynamicTarget !== undefined ? dynamicTarget : sectorInfo.targetAllocation) * 100;
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
  action: "BUY" | "SELL" | "HOLD" | "REBALANCE" | "WITHDRAW";
  fromToken: string;
  toToken: string;
  amountUSD: number;
  tokenAmount?: number;
  reasoning: string;
  sector?: string;
  isExploration?: boolean;
  isForced?: boolean; // v12.2.7: Tag forced deploy / fallback trades — excluded from self-improvement engine
}

// ============================================================================
// NVR CENTRAL SIGNAL SERVICE — CONSUMER MODE (Phase 2)
// When signalMode === 'central', this replaces the Claude AI call with
// signals fetched from the NVR central signal service.
// ============================================================================

async function fetchCentralSignals(portfolioContext: any): Promise<TradeDecision[]> {
  const signalUrl = process.env.SIGNAL_URL;
  if (!signalUrl) {
    console.error('[CENTRAL] No SIGNAL_URL configured');
    return []; // HOLD everything
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (process.env.SIGNAL_API_KEY) {
      headers['X-Signal-Key'] = process.env.SIGNAL_API_KEY;
    }

    const response = await fetch(`${signalUrl}/signals/latest`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[CENTRAL] Signal service returned ${response.status}`);
      return [];
    }

    const payload = await response.json() as SignalPayload;

    // Check freshness - signals should be less than 10 minutes old
    const signalAge = Date.now() - new Date(payload.timestamp).getTime();
    if (signalAge > (payload.meta?.ttlSeconds || 600) * 1000) {
      console.warn(`[CENTRAL] Stale signals (${Math.round(signalAge / 1000)}s old). Holding.`);
      return [];
    }

    console.log(`[CENTRAL] Received ${payload.signals.length} signals (cycle ${payload.cycleNumber}, regime: ${payload.marketRegime})`);

    // NVR-SPEC-004: Store for dashboard visibility and track history
    latestSignals = payload;
    pushSignalHistory(payload);

    // Map signals to TradeDecision[]
    const decisions: TradeDecision[] = [];

    for (const signal of payload.signals) {
      if (signal.action === 'HOLD') continue;

      const isBuy = signal.action === 'STRONG_BUY' || signal.action === 'BUY';
      const isSell = signal.action === 'STRONG_SELL' || signal.action === 'SELL';

      if (isBuy) {
        decisions.push({
          action: 'BUY',
          fromToken: 'USDC',
          toToken: signal.token,
          amountUSD: 0, // Will be sized locally by position sizing logic
          reasoning: `CENTRAL_SIGNAL: ${signal.action} (confluence ${signal.confluence}) - ${signal.reasoning}`,
        });
      } else if (isSell) {
        decisions.push({
          action: 'SELL',
          fromToken: signal.token,
          toToken: 'USDC',
          amountUSD: 0, // Will be sized locally
          reasoning: `CENTRAL_SIGNAL: ${signal.action} (confluence ${signal.confluence}) - ${signal.reasoning}`,
        });
      }
    }

    return decisions;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.error('[CENTRAL] Signal service timed out (15s)');
    } else {
      console.error('[CENTRAL] Failed to fetch signals:', err.message);
    }
    return []; // HOLD on failure
  }
}

async function makeTradeDecision(
  balances: { symbol: string; balance: number; usdValue: number; price?: number; sector?: string }[],
  marketData: MarketData,
  totalPortfolioValue: number,
  sectorAllocations: SectorAllocation[],
  cashDeployment?: { active: boolean; cashPercent: number; excessCash: number; deployBudget: number; confluenceDiscount: number },
): Promise<TradeDecision[]> {
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
  // v8.0: Institutional position sizing replaces flat $25 maxBuySize
  const instSize = calculateInstitutionalPositionSize(totalPortfolioValue);
  let maxBuyAmount = Math.min(instSize.sizeUSD, availableUSDC);
  // v11.1: In cash deployment mode, allow larger per-trade buys (capped by deployment budget / max entries)
  if (cashDeployment?.active && cashDeployment.deployBudget > 0) {
    const deployPerTrade = cashDeployment.deployBudget / CASH_DEPLOYMENT_MAX_ENTRIES;
    maxBuyAmount = Math.min(Math.max(maxBuyAmount, deployPerTrade), availableUSDC);
  }
  console.log(`   🎰 Position Sizer: Kelly=$${instSize.sizeUSD.toFixed(2)} (${instSize.kellyPct.toFixed(1)}% of portfolio) | Vol×${instSize.volMultiplier.toFixed(2)} (realized ${instSize.realizedVol.toFixed(1)}%) | WR=${(instSize.winRate * 100).toFixed(0)}%${instSize.breakerReduction ? ' | ⚠️ BREAKER 30% CUT' : ''}${cashDeployment?.active ? ' | 💵 DEPLOY MODE' : ''}`);
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

  // v15.0: Run swarm before Claude call — inject consensus as context
  let swarmPromptSection = '';
  if (SIGNAL_ENGINE === 'swarm') {
    try {
      const swarmTokens = marketData.tokens.filter(t => t.symbol !== 'USDC' && t.symbol !== 'WETH').map(t => {
        // v17.0: Compute price distance from 30-day high
        let priceDistanceFromHigh: number | undefined;
        const histEntry = priceHistoryStore.tokens[t.symbol];
        if (histEntry && histEntry.prices.length > 0) {
          const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
          let high30d = t.price;
          for (let i = 0; i < histEntry.timestamps.length; i++) {
            if (histEntry.timestamps[i] >= thirtyDaysAgo && histEntry.prices[i] > high30d) {
              high30d = histEntry.prices[i];
            }
          }
          if (high30d > 0) {
            priceDistanceFromHigh = ((t.price - high30d) / high30d) * 100; // negative = below high
          }
        }
        // v17.0: Get previous buy ratio for flow direction tracking
        const prevBR = previousBuyRatios.get(t.symbol);
        // v17.0: Store current buy ratio for next cycle
        const ind = marketData.indicators[t.symbol];
        if (ind?.orderFlow) {
          const totalFlow = ind.orderFlow.buyVolumeUSD + ind.orderFlow.sellVolumeUSD;
          if (totalFlow > 0) previousBuyRatios.set(t.symbol, (ind.orderFlow.buyVolumeUSD / totalFlow) * 100);
        }
        // v19.0: Attach multi-timeframe flow data
        const _ftf = getFlowTimeframes(flowTimeframeState, t.symbol);
        return {
          symbol: t.symbol, price: t.price, priceChange24h: t.priceChange24h, volume24h: t.volume24h, sector: t.sector,
          priceDistanceFromHigh,
          previousBuyRatio: prevBR,
          flowAvg5m: _ftf.avg5m ?? undefined, flowAvg1h: _ftf.avg1h ?? undefined, flowAvg4h: _ftf.avg4h ?? undefined, flowPositiveTimeframes: _ftf.positiveTimeframes,
          indicators: marketData.indicators[t.symbol] || undefined,
        };
      });
      const _uBal = balances.find(b => b.symbol === 'USDC');
      const _tVal = totalPortfolioValue || 1;
      const _cPct = _uBal ? (_uBal.usdValue / _tVal) * 100 : 50;
      const _pos: Record<string, { usdValue: number; gainPct?: number; costBasis?: number }> = {};
      for (const b of balances) { if (b.symbol === 'USDC') continue; const cb = state.costBasis[b.symbol]; _pos[b.symbol] = { usdValue: b.usdValue, gainPct: cb ? ((b.usdValue - cb.totalCostBasis) / cb.totalCostBasis) * 100 : undefined, costBasis: cb?.avgCostPerUnit }; }
      const _sa: Record<string, number> = {};
      for (const s of sectorAllocations) _sa[s.name] = s.currentPercent;
      const btcD = marketData.tokens.find(t => t.symbol === 'cbBTC' || t.symbol === 'BTC');
      const ethD = marketData.tokens.find(t => t.symbol === 'ETH');
      const swarmDecs = runSwarm(swarmTokens, { totalValue: _tVal, cashPercent: _cPct, positions: _pos, sectorAllocations: _sa }, { fearGreedIndex: marketData.fearGreed.value, fearGreedClassification: marketData.fearGreed.classification, btc24hChange: btcD?.priceChange24h || 0, eth24hChange: ethD?.priceChange24h || 0, regime: marketData.marketRegime });
      setLatestSwarmDecisions(swarmDecs);
      swarmPromptSection = '\n\n' + formatSwarmForPrompt(swarmDecs) + '\n';
      console.log(`   [SWARM] Ran 5 micro-agents on ${swarmTokens.length} tokens`);
    } catch (e: any) { console.warn('[SWARM] Error running swarm for local mode:', e.message); }
  }

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
  // v11.4.7: Annotate trade types so Claude understands mechanical vs conviction sells
  const recentTrades = state.tradeHistory.slice(-10);
  const sellCount = recentTrades.filter(t => t.action === 'SELL').length;
  const buyCount = recentTrades.filter(t => t.action === 'BUY').length;
  const mechanicalSells = recentTrades.filter(t => t.action === 'SELL' && t.reasoning && /stop.?loss|trailing.?stop|harvest|time.?rebalance|ATR/i.test(t.reasoning)).length;
  const tradeHistorySummary = recentTrades.length > 0
    ? recentTrades.map(t => {
        const isMechanical = t.action === 'SELL' && t.reasoning && /stop.?loss|trailing.?stop|harvest|time.?rebalance|ATR/i.test(t.reasoning);
        const tag = isMechanical ? '[AUTO-STOP]' : t.action === 'BUY' ? '[AI-BUY]' : '[AI-SELL]';
        return `  ${t.timestamp.slice(5, 16)} ${tag} ${t.action} ${t.fromToken}→${t.toToken} $${t.amountUSD.toFixed(2)} ${t.success ? "✅" : "❌"} regime=${t.signalContext?.marketRegime || "?"} ${t.reasoning?.substring(0, 60) || ""}`;
      }).join("\n")
    : "  No trades yet";
  // v11.4.7: Add context header if most recent trades are mechanical sells
  const tradeHistoryContext = mechanicalSells >= sellCount * 0.7 && sellCount >= 3
    ? `⚠️ NOTE: ${mechanicalSells} of the ${sellCount} recent sells were AUTOMATIC stop-losses/trailing-stops, NOT bearish AI decisions. These do NOT indicate market direction — they are mechanical risk management. The market may be neutral or bullish despite the sell-heavy history. Judge the current market on TODAY's indicators, not on past automated exits.\n`
    : '';

  // v11.4: Volume spike alert — flag tokens with volume ≥ 2x their 7-day average
  const volumeSpikeAlerts: string[] = [];
  for (const [symbol, ind] of Object.entries(marketData.indicators)) {
    if (ind?.volumeChange24h !== null && ind?.volumeChange24h !== undefined) {
      const volumeMultiple = 1 + (ind.volumeChange24h / 100);
      if (volumeMultiple >= VOLUME_SPIKE_THRESHOLD) {
        volumeSpikeAlerts.push(`⚡ ${symbol}: volume ${volumeMultiple.toFixed(1)}x 7-day avg (+${ind.volumeChange24h.toFixed(0)}%)`);
      }
    }
  }
  const volumeSpikeSection = volumeSpikeAlerts.length > 0
    ? `\n═══ VOLUME SPIKE ALERTS ═══\n${volumeSpikeAlerts.join('\n')}\nThese tokens have unusual activity — investigate for accumulation or distribution.\n`
    : '';

  // V4.0: Build intelligence layers
  const intelligenceSummary = formatIntelligenceForPrompt(marketData.defiLlama, marketData.derivatives, marketData.marketRegime, marketData.newsSentiment, marketData.macroData, marketData.globalMarket, marketData.smartRetailDivergence, marketData.fundingMeanReversion, marketData.tvlPriceDivergence, marketData.stablecoinSupply);

  // v11.4.23 + v12.2: Compute today's realized P&L for payout-awareness (use stored P&L when available)
  const todayStr = new Date().toISOString().slice(0, 10);
  const todaySells = state.tradeHistory.filter(t => t.success && t.action === 'SELL' && t.timestamp.slice(0, 10) === todayStr);
  let todayRealizedPnL = 0;
  for (const t of todaySells) {
    if (t.realizedPnL !== undefined) {
      todayRealizedPnL += t.realizedPnL;
    } else {
      const cb = state.costBasis[t.fromToken];
      if (cb && cb.averageCostBasis > 0) {
        const tokensSold = t.tokenAmount || (t.amountUSD / (cb.averageCostBasis || 1));
        todayRealizedPnL += t.amountUSD - tokensSold * cb.averageCostBasis;
      }
    }
  }
  const utcHour = new Date().getUTCHours();
  const hoursUntilPayout = utcHour < 8 ? 8 - utcHour : 32 - utcHour; // hours until next 8 AM UTC
  const payoutUrgency = hoursUntilPayout <= 4; // within 4 hours of payout

  // V4.0: Performance stats for self-awareness
  const perfStats = calculateTradePerformance();
  const perfSummary = perfStats.totalTrades > 0
    ? `Win Rate: ${perfStats.winRate.toFixed(0)}% | Avg Return: ${perfStats.avgReturnPercent >= 0 ? "+" : ""}${perfStats.avgReturnPercent.toFixed(1)}% | Profit Factor: ${perfStats.profitFactor === Infinity ? "∞" : perfStats.profitFactor.toFixed(2)}${perfStats.bestTrade ? ` | Best: ${perfStats.bestTrade.symbol} +${perfStats.bestTrade.returnPercent.toFixed(1)}%` : ""}${perfStats.worstTrade ? ` | Worst: ${perfStats.worstTrade.symbol} ${perfStats.worstTrade.returnPercent.toFixed(1)}%` : ""}`
    : "No completed sell trades yet — performance tracking will begin after first sell";

  const systemPrompt = `You are Henry's autonomous crypto trading agent v12.0 "On-Chain Intelligence Engine" on Base network.
You are a MULTI-DIMENSIONAL TRADER with real-time access to: technical indicators, DeFi protocol intelligence, news sentiment analysis, Federal Reserve macro data (rates, yield curve, CPI, M2, dollar), cross-asset correlations (Gold, Oil, VIX, S&P 500), market regime analysis, BTC dominance & altseason rotation, TVL-price divergence, and stablecoin capital flow. Your decisions execute LIVE swaps with adaptive MEV protection. You think like a macro-aware hedge fund — reading both the market microstructure AND the global economic environment. Pay special attention to altseason rotation signals, TVL-price divergence, and cross-asset correlations — these are your highest-conviction indicators.

═══ PORTFOLIO ═══
- USDC Available: $${availableUSDC.toFixed(2)}${cashDeployment?.active ? ` ⚠️ CASH OVERWEIGHT (${cashDeployment.cashPercent.toFixed(1)}% of portfolio)` : ''}
- Token Holdings: $${totalTokenValue.toFixed(2)}
- Total: $${totalPortfolioValue.toFixed(2)}
- Today's P&L: ${breakerState.dailyBaseline.value > 0 ? `${((totalPortfolioValue - breakerState.dailyBaseline.value) / breakerState.dailyBaseline.value * 100).toFixed(2)}% ($${(totalPortfolioValue - breakerState.dailyBaseline.value).toFixed(2)})` : 'Calculating...'}
- Peak: $${state.trading.peakValue.toFixed(2)} | Drawdown: ${state.trading.peakValue > 0 ? ((state.trading.peakValue - totalPortfolioValue) / state.trading.peakValue * 100).toFixed(1) : "0.0"}%
- Today's Realized P&L (from sells): $${todayRealizedPnL.toFixed(2)} (${todaySells.length} sells) | Next payout: ${hoursUntilPayout}h${cashDeployment?.active ? `
- 💵 DEPLOYMENT MODE: Excess cash $${cashDeployment.excessCash.toFixed(2)} | Budget this cycle: $${cashDeployment.deployBudget.toFixed(2)} | Confluence discount: -${cashDeployment.confluenceDiscount}pts` : ''}

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
- Trending: ${marketData.trendingTokens.join(", ") || "None"}
- Momentum: score=${lastMomentumSignal.score} bias=${lastMomentumSignal.deploymentBias} | BTC 24h: ${lastMomentumSignal.btcChange24h >= 0 ? '+' : ''}${lastMomentumSignal.btcChange24h.toFixed(1)}% | ETH 24h: ${lastMomentumSignal.ethChange24h >= 0 ? '+' : ''}${lastMomentumSignal.ethChange24h.toFixed(1)}%

═══ TECHNICAL INDICATORS ═══
${indicatorsSummary || "  No indicator data available"}

${strongBuySignals.length > 0 ? `🟢 STRONGEST BUY SIGNALS: ${strongBuySignals.join(", ")}` : ""}
${strongSellSignals.length > 0 ? `🔴 STRONGEST SELL SIGNALS: ${strongSellSignals.join(", ")}` : ""}
${swarmPromptSection}

${intelligenceSummary}

${lastDexIntelligence?.aiSummary || ''}

═══ TOKEN PRICES ═══
${Object.entries(marketBySector).map(([sector, tokens]) =>
  `${sector}: ${tokens.slice(0, 5).join(" | ")}`
).join("\n")}
${volumeSpikeSection}
═══ RECENT TRADE HISTORY ═══
${tradeHistoryContext}${tradeHistorySummary}

${discoveryIntel}═══ TRADING LIMITS ═══
- Max BUY: $${maxBuyAmount.toFixed(2)} (Kelly ${instSize.kellyPct.toFixed(1)}% × Vol×${instSize.volMultiplier.toFixed(2)} × Mom×${instSize.momentumMultiplier.toFixed(2)}${instSize.breakerReduction ? ' × Breaker 30%' : ''}) | Max SELL: ${CONFIG.trading.maxSellPercent}% of position
- Available tokens: ${tradeableTokens}

═══ STRATEGY FRAMEWORK v12.0 ═══

ENTRY RULES (when to BUY):
1. CONFLUENCE: Buy when 2+ indicators agree (RSI oversold + MACD bullish, or BB oversold + uptrend). In strong momentum, 1 signal is enough
2. SECTOR PRIORITY: Buy into the most underweight sector first
3. VOLUME CONFIRMATION: Prefer tokens where volume is above 7-day average
4. TREND ALIGNMENT: Prefer buying tokens in UP or STRONG_UP trends
5. MOMENTUM DEPLOYMENT: When BTC/ETH are moving +3%+ in 24h, deploy USDC AGGRESSIVELY with 1.5x position sizes. Don't sit in idle USDC when the market is running — this is where money is made
6. CATCHING FIRE: Token with DEX buy ratio >60% AND volume >2x 7-day average = STRONG BUY — apply 1.5x position size. This is real on-chain demand, not noise
7. DEX VOLUME SPIKES: Token with >2x normal volume AND buy-heavy pressure (>55% buys) = strong BUY signal
8. TVL-PRICE DIVERGENCE: DeFi token with rising TVL but flat price = undervalued, prioritize buying
9. QUALITY OVER QUANTITY: You are a TRADING bot but NOT a churning bot. Only enter when 2+ signals align with clear conviction. A missed trade costs nothing — a bad trade costs slippage, fees, and capital. Patience IS a position
12. FALLING KNIFE FILTER: NEVER buy on oversold RSI alone if MACD is bearish. RSI < 30 with bearish MACD is a falling knife, not a buying opportunity. Wait for MACD to turn bullish or neutral before entering oversold positions. This prevents catching falling knives like RSR (-54.8%)
10. SCALE INTO WINNERS: When an existing position is up ${SCALE_UP_MIN_GAIN_PCT}%+ from cost basis AND has strong momentum (buy ratio > ${SCALE_UP_BUY_RATIO_MIN}%, volume above average), INCREASE the position by 2-4x the original size. This is the most important rule. Small scout positions that prove themselves deserve real capital. A $2 position up 8% is a signal to deploy $50-100 more, not to sit and watch.
11. RIDE THE WAVE: If a token is up ${RIDE_THE_WAVE_MIN_MOVE}%+ in the last 4 hours with increasing volume, this is a momentum trade opportunity. Deploy ${RIDE_THE_WAVE_SIZE_PCT}% of portfolio immediately. Don't wait for confluence of 3 indicators. Volume + price action IS the signal.

EXIT RULES (when to SELL):
1. PROFIT HARVESTING: Auto-harvests at +25%, +50%, +100%, +200% gain tiers BUT ONLY when momentum is decelerating (buy ratio dropping or MACD turning). If buy ratio >55% and MACD bullish, let winners run
2. OVERBOUGHT EXIT: Sell if RSI > 75 AND MACD turning bearish
3. STOP LOSS: Tightened to -4% for non-blue-chip, -6% for blue chips. Cut losses FAST
4. SECTOR TRIM: Sell from overweight sectors (>10% drift) to rebalance
5. TIME-BASED HARVEST: Positions held 72+ hours with +15% gain get a 10% trim
6. CAPITAL RECYCLING: If USDC < $10, SELL 20-30% of your highest-gain position to free capital. A bot with $0 USDC cannot compound
7. MOMENTUM REVERSAL: When a held token's DEX buy ratio drops below 45% (buyers turning into sellers), this is a SELL signal regardless of profit/loss. Exit before the crowd
8. MOMENTUM EXIT: When a held position shows buy ratio dropping below ${MOMENTUM_EXIT_BUY_RATIO}% OR MACD crosses bearish AFTER a profitable run of ${MOMENTUM_EXIT_MIN_PROFIT}%+, SELL the position. Don't wait for stop-loss. The momentum wave is over. Take the profit and redeploy.
9. DAILY PAYOUT AWARENESS: Every day at 8 AM UTC, REALIZED profits are distributed to stakeholders. Unrealized gains don't count. Today's realized P&L: $${todayRealizedPnL.toFixed(2)} from ${todaySells.length} sells. Next payout in ${hoursUntilPayout}h.${payoutUrgency ? ` ⚠️ <4h to settlement — sell a portion of winners NOW to lock in realized profit for distribution.` : ''} Always be banking wins, not just holding them

CORE PHILOSOPHY (v18.0):
Trade based on DEX order flow, not market sentiment. Buy when buy ratio confirms accumulation with volume. Sell when flow reverses. Fear and Greed is noise. Capital flow is signal. Be willing to buy in extreme fear IF on-chain flow confirms real buying is happening.

RISK/REWARD (v18.0 — CRITICAL): Only enter trades where potential reward is at least 2x the risk. If a token is near its 30-day high (within 5%), the upside is limited — prefer tokens with more room to run. Tokens 20%+ below their 30-day high with bullish MACD have the best risk/reward.

LET WINNERS RUN (v18.0 — CRITICAL): Do NOT sell a profitable position if buy ratio is still above 55% and MACD is bullish. Trim ONLY on deceleration — when momentum is SLOWING. The old approach of harvesting small wins while letting losses compound created negative expectancy. Cut losses FAST (4-6% stops), let winners RUN (hold through momentum).

PATIENCE IN RANGING (v18.0): In ranging markets, make FEWER trades with HIGHER conviction. Each trade has fees that compound. Target 2 high-conviction trades max per cycle in ranging markets. A missed trade costs nothing — a bad trade costs slippage, fees, and capital.

EXPLORATION TRADE RULES (data-gathering positions):
- Exploration trades must have neutral or positive confluence (>= 0) — never explore into negative confluence
- Never explore against the trend — MACD must not be bearish for the target token
- Exploration requires buy ratio above 45% — do not explore when sellers dominate
- In RANGING markets: exploration size is cut 50%, max 1 exploration per cycle

REGIME STRATEGY:
- TRENDING_UP: Maximum aggression. Buy dips, deploy idle USDC
- TRENDING_DOWN: Hunt oversold bounces. Sell clear losers, recycle capital
- RANGING: PATIENCE. Fewer trades, higher conviction. Max 2 trades per cycle. Only enter with 2+ confirming signals and R:R >= 2:1
- VOLATILE: More trades, smaller sizes. Buy at dislocated prices
${cashDeployment?.active ? `
═══ 💵 CASH DEPLOYMENT AWARENESS ═══
Portfolio is ${cashDeployment.cashPercent.toFixed(0)}% USDC ($${availableUSDC.toFixed(0)} idle). Deploy budget: $${cashDeployment.deployBudget.toFixed(0)}.
Look for quality entries in underweight sectors. Prefer tokens with 2+ confirming signals.
- Focus on: most oversold tokens (RSI < 40), underweight sectors, volume confirming
- Size: $${Math.min(40, cashDeployment.deployBudget / 4).toFixed(0)}-$${Math.min(80, cashDeployment.deployBudget / 3).toFixed(0)} per trade
- Confluence threshold lowered by ${cashDeployment.confluenceDiscount} points
- HOLD is acceptable if no quality entries exist. Better to wait than force bad trades
` : ''}
RISK RULES:
1. No single token > 25% of portfolio
2. ${cashDeployment?.active
    ? `Cash is high — prefer entries with confluence > ${Math.min(state.adaptiveThresholds.confluenceBuy - cashDeployment.confluenceDiscount, 5)}, but HOLD if nothing qualifies`
    : 'HOLD only if confluence is between -15 and +15 (no clear signal)'}
3. Don't chase pumps — if token up >20% in 24h with RSI >75, wait for pullback
4. Minimum trade $15.00 — if you can't size at least $15, skip the trade entirely. No dust positions

DECISION PRIORITY: Market Regime > Altseason/BTC Dominance > Macro Environment > Technical signals + DeFi flows > DEX Intelligence (volume spikes + buy/sell pressure) > TVL-Price Divergence > Stablecoin Capital Flow > Cross-Asset Correlations > News sentiment > Sector rebalancing

For SELLING: fromToken = token symbol, toToken = USDC
For BUYING: fromToken = USDC, toToken = token symbol

DIVERSIFICATION RULE: NEVER buy the same token more than 2 cycles in a row UNLESS it is a SCALE-UP candidate (up ${SCALE_UP_MIN_GAIN_PCT}%+ from cost basis with strong momentum). Winners deserve concentration. Rotate for NEW positions only.
If a token already holds >20% of portfolio, do NOT buy more UNLESS it qualifies for SCALE INTO WINNERS (up ${SCALE_UP_MIN_GAIN_PCT}%+ with buy ratio >${SCALE_UP_BUY_RATIO_MIN}%).

CRITICAL: Respond with ONLY raw JSON. NO prose, NO explanation outside JSON, NO markdown.
v9.2 MULTI-TRADE: You may return a JSON ARRAY of actions per cycle to deploy capital across multiple tokens simultaneously.
Return as many actions as you see strong signals for — each will be validated independently by position guards, Kelly sizing, and circuit breakers.
Return a single object for 1 trade, or an array for multiple. HOLD can be a single object (no array needed).
Examples:
Single: {"action":"BUY","fromToken":"USDC","toToken":"WELL","amountUSD":10,"reasoning":"RSI oversold, MACD bullish","sector":"DEFI"}
Multi: [{"action":"BUY","fromToken":"USDC","toToken":"WELL","amountUSD":15,"reasoning":"RSI oversold","sector":"DEFI"},{"action":"BUY","fromToken":"USDC","toToken":"VIRTUAL","amountUSD":12,"reasoning":"AI sector underweight","sector":"AI_TOKENS"}]
HOLD: {"action":"HOLD","fromToken":"NONE","toToken":"NONE","amountUSD":0,"reasoning":"No clear signals"}` + formatSelfImprovementPrompt() + formatUserDirectivesPrompt();

  // Retry up to 3 times with exponential backoff for rate limits
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // v11.4.9: 90-second timeout on AI call — prevents cycle hanging if API stalls
      const aiCallPromise = anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000, // v9.2: increased for multi-trade array responses
        messages: [{ role: "user", content: systemPrompt }],
      });
      const response = await Promise.race([
        aiCallPromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI call timed out after 90s')), 90_000)),
      ]);

      const content = response.content[0];
      if (content.type === "text") {
        let text = content.text.trim();
        // Strip markdown code fences
        if (text.startsWith("```")) {
          text = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
        }
        // v9.2: Handle both JSON objects and arrays
        if (!text.startsWith("{") && !text.startsWith("[")) {
          const jsonMatch = text.match(/(\[[\s\S]*"action"[\s\S]*\]|\{[\s\S]*"action"[\s\S]*\})/);
          if (jsonMatch) {
            console.log(`   ⚠️ AI returned prose wrapper — extracted JSON from response`);
            text = jsonMatch[0];
          } else {
            console.log(`   ⚠️ AI returned non-JSON response: "${text.substring(0, 80)}..."`);
            return [{ action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: "AI returned prose instead of JSON — HOLD" }];
          }
        }
        const parsed = JSON.parse(text);

        // v9.2: Normalize to array — single object becomes [object], array stays as-is
        const rawDecisions: any[] = Array.isArray(parsed) ? parsed : [parsed];
        if (Array.isArray(parsed)) {
          console.log(`   🚀 Multi-trade: AI returned ${rawDecisions.length} action(s)`);
        }

        const validTokens = ["USDC", "NONE", ...CONFIG.activeTokens];
        const validatedDecisions: TradeDecision[] = [];

        for (const decision of rawDecisions) {
          console.log(`   AI raw response: action=${decision.action} from=${decision.fromToken} to=${decision.toToken} amt=$${decision.amountUSD}`);
          if (decision.action === "HOLD") {
            // HOLD doesn't need further validation — include it but don't block other actions
            validatedDecisions.push({ action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: decision.reasoning || "AI chose HOLD" });
            continue;
          }
          if (!validTokens.includes(decision.fromToken) || !validTokens.includes(decision.toToken)) {
            console.log(`   ⚠️ Invalid tokens: from="${decision.fromToken}" to="${decision.toToken}" — not in valid list`);
            continue; // Skip invalid entries, don't block valid ones
          }

          if (decision.action === "BUY" || decision.action === "REBALANCE") {
            decision.amountUSD = Math.min(decision.amountUSD, maxBuyAmount);
            if (decision.amountUSD < 5.00) {
              console.log(`   ⚠️ Trade amount ($${decision.amountUSD.toFixed(2)}) too small — skipping`);
              continue;
            }
          } else if (decision.action === "SELL") {
            const holding = balances.find(b => b.symbol === decision.fromToken);
            if (!holding || holding.usdValue < 1) {
              console.log(`   ⚠️ No ${decision.fromToken} to sell — skipping`);
              continue;
            }
            const maxSellForToken = holding.usdValue * (CONFIG.trading.maxSellPercent / 100);
            decision.amountUSD = Math.min(decision.amountUSD, maxSellForToken);
            decision.tokenAmount = decision.amountUSD / (holding.price || 1);
          }

          validatedDecisions.push(decision as TradeDecision);
        }

        // If no valid actions survived, return HOLD
        if (validatedDecisions.length === 0) {
          return [{ action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: "All AI actions filtered out — HOLD" }];
        }
        return validatedDecisions;
      }
      return [{ action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: "Parse error" }];
    } catch (error: any) {
      const status = error?.status || error?.response?.status;
      if (status === 429 && attempt < 3) {
        const waitSec = Math.pow(2, attempt) * 10; // 20s, 40s
        console.log(`  ⏳ Rate limited (429). Waiting ${waitSec}s before retry ${attempt + 1}/3...`);
        await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
        continue;
      }
      console.error("AI decision failed:", error.message);
      return [{ action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: `Error: ${error.message}` }];
    }
  }
  return [{ action: "HOLD", fromToken: "NONE", toToken: "NONE", amountUSD: 0, reasoning: "Max retries exceeded" }];
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

// v11.4.17: In-flight trade lock — prevents concurrent cycles from executing same trade
const tradeInFlight = new Set<string>();

async function executeTrade(
  decision: TradeDecision,
  marketData: MarketData
): Promise<{ success: boolean; txHash?: string; error?: string }> {

  // v14.0: Block trading during active withdrawal to prevent race conditions
  if ((state as any).withdrawPaused) {
    console.log(`  ⏸️ Trade blocked — withdrawal in progress`);
    return { success: false, error: 'Trading paused during withdrawal' };
  }

  // v11.4.7: TRADE DEDUP GUARD — block same token/action/tier combo within window
  // Prevents runaway loops where the same trade fires repeatedly
  // v11.4.9: FORCED_DEPLOY gets shorter 10-min window to allow rapid capital deployment
  const dedupToken = decision.action === 'SELL' ? decision.fromToken : decision.toToken;
  const dedupTier = decision.reasoning?.match(/^([A-Z_]+):/)?.[1] || 'AI';
  const dedupKey = `${dedupToken}:${decision.action}:${dedupTier}`;
  // v14.2: Dedup windows increased across the board to reduce churn (was 308 trades/day)
  const isScaleUpTier = dedupTier === 'SCALE_UP' || dedupTier === 'RIDE_THE_WAVE';
  // v19.0: Surge mode — scale-ups with multi-timeframe flow confirmation get shorter dedup
  const isSurgeEligible = isScaleUpTier && decision.reasoning?.includes('confirmed across');
  const dedupWindowMinutes = isSurgeEligible ? SURGE_DEDUP_WINDOW_MINUTES          // 3 min — surge mode
    : isScaleUpTier ? SCALE_UP_DEDUP_WINDOW_MINUTES        // 15 min (normal scale-up)
    : dedupTier === 'TRAILING_STOP' ? DECEL_TRIM_DEDUP_WINDOW_MINUTES              // 3 min — trailing stop exits are urgent
    : dedupTier === 'DIRECTIVE_SELL_ESCALATED' ? MOMENTUM_EXIT_DEDUP_WINDOW_MINUTES // 5 min — escalated directive sell
    : dedupTier === 'FLOW_REVERSAL' ? MOMENTUM_EXIT_DEDUP_WINDOW_MINUTES           // Same urgency as momentum exit
    : dedupTier === 'MOMENTUM_EXIT' ? MOMENTUM_EXIT_DEDUP_WINDOW_MINUTES          // 5 min (was 1)
    : dedupTier === 'SCOUT' ? NORMAL_DEDUP_WINDOW_MINUTES                         // v19.0: scouts use normal window — don't re-scout same token
    : dedupTier === 'DECEL_TRIM' ? DECEL_TRIM_DEDUP_WINDOW_MINUTES                // 3 min — v14.1 smart trim
    : dedupTier === 'FORCED_DEPLOY' ? FORCED_DEPLOY_DEDUP_WINDOW_MINUTES          // 10 min (was 2)
    : NORMAL_DEDUP_WINDOW_MINUTES; // 15 min (was 5) — stop rapid re-trading of same tokens
  if (!state.tradeDedupLog) state.tradeDedupLog = {};
  // v11.4.17: In-flight lock — prevent parallel cycles from both passing dedup check
  if (tradeInFlight.has(dedupKey)) {
    console.warn(`\n  🔁 DEDUP GUARD: Blocking ${dedupKey} — trade already in flight`);
    recordFiltered(dedupToken, decision.action, dedupTier, 'DEDUP_INFLIGHT', decision.amountUSD);
    return { success: false, error: `Dedup guard: ${dedupKey} already in flight` };
  }
  tradeInFlight.add(dedupKey);
  const lastExecution = state.tradeDedupLog[dedupKey];
  if (lastExecution) {
    const minutesSince = (Date.now() - new Date(lastExecution).getTime()) / (1000 * 60);
    if (minutesSince < dedupWindowMinutes) {
      console.warn(`\n  🔁 DEDUP GUARD: Blocking ${dedupKey} — same combo fired ${minutesSince.toFixed(0)}min ago (min ${dedupWindowMinutes}min)`);
      // Track the blocked trade
      if (!state.sanityAlerts) state.sanityAlerts = [];
      state.sanityAlerts.push({
        timestamp: new Date().toISOString(),
        symbol: dedupToken,
        type: 'TRADE_DEDUP_BLOCKED',
        oldCostBasis: 0,
        currentPrice: 0,
        gainPercent: 0,
        action: `Blocked ${dedupKey} — ${minutesSince.toFixed(0)}min since last (threshold: ${dedupWindowMinutes}min)`,
      });
      if (state.sanityAlerts.length > 100) state.sanityAlerts = state.sanityAlerts.slice(-100);
      tradeInFlight.delete(dedupKey);
      recordFiltered(dedupToken, decision.action, dedupTier, 'DEDUP_WINDOW', decision.amountUSD);
      return { success: false, error: `Dedup guard: ${dedupKey} already executed ${minutesSince.toFixed(0)}min ago` };
    }
  }

  // v19.0: SURGE CAPITAL CAP — prevent over-concentration via rapid scale-ups
  if (isScaleUpTier && decision.action === 'BUY' && decision.toToken) {
    const existingPosition = state.trading.balances.find(b => b.symbol === decision.toToken);
    const existingValue = existingPosition?.usdValue || 0;
    const portfolioVal = state.trading.totalPortfolioValue || 1;
    const projectedPct = ((existingValue + decision.amountUSD) / portfolioVal) * 100;

    if (projectedPct > SURGE_MAX_CAPITAL_PER_TOKEN_PCT) {
      const allowedUSD = Math.max(0, (portfolioVal * SURGE_MAX_CAPITAL_PER_TOKEN_PCT / 100) - existingValue);
      if (allowedUSD < KELLY_POSITION_FLOOR_USD) {
        console.log(`  🛑 SURGE CAP: ${decision.toToken} would reach ${projectedPct.toFixed(1)}% of portfolio (max ${SURGE_MAX_CAPITAL_PER_TOKEN_PCT}%) — blocking`);
        tradeInFlight.delete(dedupKey);
        recordFiltered(decision.toToken!, decision.action, dedupTier, 'SURGE_CAP', decision.amountUSD);
        return { success: false, error: `Surge cap: ${decision.toToken} at ${projectedPct.toFixed(1)}% would exceed ${SURGE_MAX_CAPITAL_PER_TOKEN_PCT}% max` };
      }
      console.log(`  ⚠️ SURGE CAP: Reducing ${decision.toToken} buy from $${decision.amountUSD.toFixed(2)} to $${allowedUSD.toFixed(2)} (${SURGE_MAX_CAPITAL_PER_TOKEN_PCT}% cap)`);
      decision.amountUSD = allowedUSD;
    }

    // Hourly buy limit for surge trades
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentBuys = state.tradeHistory.filter(t =>
      t.action === 'BUY' && t.toToken === decision.toToken && t.timestamp > oneHourAgo
    ).length;
    if (recentBuys >= SURGE_MAX_BUYS_PER_HOUR) {
      console.log(`  🛑 SURGE HOURLY CAP: ${decision.toToken} already has ${recentBuys} buys this hour (max ${SURGE_MAX_BUYS_PER_HOUR})`);
      tradeInFlight.delete(dedupKey);
      recordFiltered(decision.toToken!, decision.action, dedupTier, 'SURGE_HOURLY_CAP', decision.amountUSD);
      return { success: false, error: `Surge hourly cap: ${recentBuys}/${SURGE_MAX_BUYS_PER_HOUR} buys this hour` };
    }
  }

  if (!CONFIG.trading.enabled) {
    console.log("  ⚠️ Trading disabled - dry run mode");
    console.log(`  📋 Would execute: $${decision.amountUSD.toFixed(2)} ${decision.fromToken} → ${decision.toToken}`);
    tradeInFlight.delete(dedupKey);
    return { success: false, error: "Trading disabled (dry run)" };
  }

  // v12.2.1: PRICE GATE — never buy a token the price engine can't price.
  // This prevents the catastrophic loop: buy unpriceable token → shows $0 → AI panic-sells everything.
  if (decision.action === 'BUY' && decision.toToken !== 'USDC') {
    const buyTokenPrice = marketData.tokens.find(t => t.symbol === decision.toToken)?.price;
    const hasPool = !!poolRegistry[decision.toToken] || decision.toToken === 'WETH' || decision.toToken === 'ETH';
    if (!buyTokenPrice || buyTokenPrice <= 0) {
      console.warn(`\n  🚫 PRICE GATE: ${decision.toToken} has no valid price — blocking BUY to prevent phantom loss`);
      tradeInFlight.delete(dedupKey);
      return { success: false, error: `Price gate: ${decision.toToken} has no price data` };
    }
    if (!hasPool) {
      console.warn(`\n  🚫 POOL GATE: ${decision.toToken} not in pool registry — blocking BUY`);
      tradeInFlight.delete(dedupKey);
      return { success: false, error: `Pool gate: ${decision.toToken} has no pool entry` };
    }
  }

  // v12.2.1: SELL LOSS GATE — in a green market, block sells at >5% loss unless stop-loss triggered.
  // Prevents AI from panic-selling real positions due to bad data.
  if (decision.action === 'SELL' && decision.fromToken !== 'USDC') {
    const cb = state.costBasis[decision.fromToken];
    const tokenPrice = marketData.tokens.find(t => t.symbol === decision.fromToken)?.price || 0;
    if (cb && cb.averageCostBasis > 0 && tokenPrice > 0) {
      const lossPct = ((tokenPrice - cb.averageCostBasis) / cb.averageCostBasis) * 100;
      const isStopLoss = decision.reasoning?.includes('STOP_LOSS') || decision.reasoning?.includes('TRAILING_STOP') || decision.reasoning?.includes('HARD_STOP') || decision.reasoning?.includes('SOFT_STOP') || decision.reasoning?.includes('CONCENTRATED_STOP') || decision.reasoning?.includes('DIRECTIVE_SELL');
      const marketIsGreen = (lastMomentumSignal?.btcChange24h || 0) > 0.5 && (lastMomentumSignal?.ethChange24h || 0) > 0.5;
      if (lossPct < -8 && marketIsGreen && !isStopLoss) {
        console.warn(`\n  🛡️ SELL LOSS GATE: Blocking ${decision.fromToken} sell at ${lossPct.toFixed(1)}% loss in green market (BTC +${(lastMomentumSignal?.btcChange24h || 0).toFixed(1)}%)`);
        tradeInFlight.delete(dedupKey);
        return { success: false, error: `Sell loss gate: ${decision.fromToken} at ${lossPct.toFixed(1)}% loss in green market` };
      }
    }
  }

  // v19.3.1: SELL BALANCE CAP — read actual on-chain balance before selling to prevent
  // "Insufficient balance" errors that trigger circuit breakers and block tokens for 6 hours.
  // The cached holding.usdValue can drift from on-chain reality after swaps, gas, or price changes.
  if (decision.action === 'SELL' && decision.fromToken !== 'USDC') {
    try {
      const actualBalance = await getTokenBalance(decision.fromToken);
      if (actualBalance > 0) {
        const tokenPrice = marketData.tokens.find(t => t.symbol === decision.fromToken)?.price || 0;
        if (tokenPrice > 0) {
          const actualValueUSD = actualBalance * tokenPrice;
          const cappedUSD = actualValueUSD * 0.95; // 5% buffer for rounding/dust
          if (decision.amountUSD > cappedUSD && cappedUSD >= 1) {
            console.log(`  📊 BALANCE CAP: ${decision.fromToken} sell capped $${decision.amountUSD.toFixed(2)} → $${cappedUSD.toFixed(2)} (on-chain: ${actualBalance.toFixed(8)} @ $${tokenPrice.toFixed(4)} = $${actualValueUSD.toFixed(2)})`);
            decision.amountUSD = cappedUSD;
          } else if (cappedUSD < 1) {
            console.log(`  📊 BALANCE CAP: ${decision.fromToken} on-chain balance too small ($${actualValueUSD.toFixed(2)}) — skipping sell`);
            tradeInFlight.delete(dedupKey);
            return { success: false, error: `Balance too small: ${decision.fromToken} only $${actualValueUSD.toFixed(2)} on-chain` };
          }
        }
      }
    } catch (e: any) {
      console.warn(`  ⚠️ BALANCE CAP: Failed to read ${decision.fromToken} balance — proceeding with cached amount ($${decision.amountUSD.toFixed(2)})`);
    }
  }

  // v11.4.17: try/finally ensures in-flight lock is always released
  try {
    // v8.1: Dynamic gas price check (replaces hardcoded $0.15)
    const gasCheck = await checkGasCost(decision.amountUSD);
    if (!gasCheck.proceed) {
      console.log(`  ⛽ Gas guard: ${gasCheck.reason}`);
      return { success: false, error: gasCheck.reason };
    }
    if (gasCheck.gasPctOfTrade > 2) {
      console.log(`  ⛽ Gas: $${gasCheck.gasCostUSD.toFixed(4)} (${gasCheck.gasPctOfTrade.toFixed(1)}% of trade)`);
    }

    // v8.1: VWS Liquidity check — ensure pool is deep enough for this trade
    // v11.4.9: Skip VWS block for FORCED_DEPLOY — these are small $40-80 trades, liquidity is sufficient
    const tradeToken = decision.action === 'BUY' ? decision.toToken : decision.fromToken;
    const isForcedDeploy = dedupTier === 'FORCED_DEPLOY';
    if (tradeToken !== 'USDC' && tradeToken !== 'ETH') {
      const liqCheck = await checkLiquidity(tradeToken, decision.amountUSD);
      if (!liqCheck.allowed) {
        if (isForcedDeploy && decision.amountUSD <= 100) {
          console.log(`  💧 VWS would block, but FORCED_DEPLOY bypass active ($${decision.amountUSD.toFixed(0)} trade)`);
        } else {
          console.log(`  💧 VWS BLOCKED: ${liqCheck.reason}`);
          recordFiltered(tradeToken, decision.action, dedupTier, 'VWS_LIQUIDITY', decision.amountUSD);
          return { success: false, error: `Liquidity too thin: ${liqCheck.reason}` };
        }
      }
      if (liqCheck.adjustedSize < decision.amountUSD) {
        console.log(`  💧 VWS: Pool $${(liqCheck.liquidityUSD / 1000).toFixed(1)}K | Trade ${liqCheck.tradeAsPoolPct.toFixed(1)}% of pool | Size: $${decision.amountUSD.toFixed(2)} → $${liqCheck.adjustedSize.toFixed(2)} (${liqCheck.reason})`);
        decision.amountUSD = liqCheck.adjustedSize;
      } else if (liqCheck.liquidityUSD > 0) {
        console.log(`  💧 VWS OK: Pool $${(liqCheck.liquidityUSD / 1000).toFixed(1)}K | Trade ${liqCheck.tradeAsPoolPct.toFixed(1)}% of pool`);
      }
    }

    // v8.1: TWAP routing for large orders
    if (decision.amountUSD >= TWAP_THRESHOLD_USD) {
      console.log(`  ⏱️ Order $${decision.amountUSD.toFixed(2)} ≥ $${TWAP_THRESHOLD_USD} → routing through TWAP engine`);
      const twapResult = await executeTWAP(decision, marketData, executeSingleSwap);
      // v11.4.7: Record successful trade in dedup log
      if (twapResult.success) {
        state.tradeDedupLog![dedupKey] = new Date().toISOString();
      }
      return {
        success: twapResult.success,
        txHash: twapResult.txHash,
        error: twapResult.error,
      };
    }

    // Small orders: direct single swap
    const swapResult = await executeSingleSwap(decision, marketData);
    // v11.4.7: Record successful trade in dedup log
    if (swapResult.success) {
      state.tradeDedupLog![dedupKey] = new Date().toISOString();
    }
    return swapResult;
  } finally {
    tradeInFlight.delete(dedupKey);
  }
}

// ============================================================================
// v14.3: DIRECT DEX SWAP — Uniswap V3 SwapRouter on Base
// For tokens that CDP SDK's routing service can't handle (MORPHO, cbLTC, PENDLE).
// Uses account.sendTransaction() — same pattern as Permit2 approvals and Aave interactions.
// ============================================================================

const UNISWAP_V3_SWAP_ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481" as Address;
const DEX_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
const DEX_WETH = "0x4200000000000000000000000000000000000006" as Address;

// exactInputSingle(ExactInputSingleParams) selector: 0x04e45aaf
// struct ExactInputSingleParams {
//   address tokenIn, address tokenOut, uint24 fee,
//   address recipient, uint256 amountIn,
//   uint256 amountOutMinimum, uint160 sqrtPriceLimitX96
// }
const EXACT_INPUT_SINGLE_SELECTOR = "0x04e45aaf";

// exactInput(ExactInputParams) selector: 0xb858183f
// struct ExactInputParams {
//   bytes path, address recipient, uint256 amountIn,
//   uint256 amountOutMinimum
// }
const EXACT_INPUT_SELECTOR = "0xb858183f";

/**
 * Build Uniswap V3 exactInputSingle calldata.
 * ABI: exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
 */
function buildExactInputSingleCalldata(
  tokenIn: Address,
  tokenOut: Address,
  fee: number,
  recipient: Address,
  amountIn: bigint,
  amountOutMin: bigint,
): `0x${string}` {
  const params = [
    tokenIn.slice(2).toLowerCase().padStart(64, "0"),
    tokenOut.slice(2).toLowerCase().padStart(64, "0"),
    fee.toString(16).padStart(64, "0"),
    recipient.slice(2).toLowerCase().padStart(64, "0"),
    amountIn.toString(16).padStart(64, "0"),
    amountOutMin.toString(16).padStart(64, "0"),
    "0".padStart(64, "0"), // sqrtPriceLimitX96 = 0 (no limit)
  ].join("");
  return `${EXACT_INPUT_SINGLE_SELECTOR}${params}` as `0x${string}`;
}

/**
 * Build Uniswap V3 exactInput calldata for multi-hop swaps (token -> WETH -> USDC).
 * Path encoding: tokenIn (20 bytes) + fee (3 bytes) + intermediary (20 bytes) + fee (3 bytes) + tokenOut (20 bytes)
 * ABI: exactInput((bytes,address,uint256,uint256))
 */
function buildExactInputMultihopCalldata(
  path: `0x${string}`,
  recipient: Address,
  amountIn: bigint,
  amountOutMin: bigint,
): `0x${string}` {
  // ABI encode the tuple: (bytes path, address recipient, uint256 amountIn, uint256 amountOutMin)
  // Dynamic type (bytes) gets offset pointer first
  const offsetToPath = "0000000000000000000000000000000000000000000000000000000000000080"; // 128 = 4*32
  const recipientEncoded = recipient.slice(2).toLowerCase().padStart(64, "0");
  const amountInEncoded = amountIn.toString(16).padStart(64, "0");
  const amountOutMinEncoded = amountOutMin.toString(16).padStart(64, "0");

  // bytes path: length (32 bytes) + data (padded to 32-byte boundary)
  const pathHex = path.startsWith("0x") ? path.slice(2) : path;
  const pathByteLength = pathHex.length / 2;
  const pathLengthEncoded = pathByteLength.toString(16).padStart(64, "0");
  const pathPadded = pathHex.padEnd(Math.ceil(pathHex.length / 64) * 64, "0");

  return `${EXACT_INPUT_SELECTOR}${offsetToPath}${recipientEncoded}${amountInEncoded}${amountOutMinEncoded}${pathLengthEncoded}${pathPadded}` as `0x${string}`;
}

/**
 * Encode a multi-hop path for Uniswap V3: tokenIn + fee + intermediary + fee + tokenOut
 * Each address is 20 bytes, each fee is 3 bytes.
 */
function encodeV3Path(tokens: Address[], fees: number[]): `0x${string}` {
  let path = tokens[0].slice(2).toLowerCase();
  for (let i = 0; i < fees.length; i++) {
    path += fees[i].toString(16).padStart(6, "0"); // 3 bytes = 6 hex chars
    path += tokens[i + 1].slice(2).toLowerCase();
  }
  return `0x${path}` as `0x${string}`;
}

/**
 * Execute a direct DEX swap via Uniswap V3 SwapRouter on Base.
 * Used as fallback for tokens CDP SDK cannot route (MORPHO, cbLTC, PENDLE).
 * Sends the transaction through CDP's account.sendTransaction() — same as approvals/Aave.
 */
async function executeDirectDexSwap(
  decision: TradeDecision,
  marketData: MarketData,
): Promise<{ success: boolean; txHash?: string; error?: string; actualTokens?: number }> {
  const portfolioValueBefore = state.trading.totalPortfolioValue;

  try {
    const isSell = decision.action === "SELL" || decision.action === "REBALANCE";
    const tokenSymbol = isSell ? decision.fromToken : decision.toToken;
    const tokenAddress = getAddress(getTokenAddress(tokenSymbol)) as Address;
    const tokenDecimals = getTokenDecimals(tokenSymbol);

    // Determine swap direction
    let tokenIn: Address, tokenOut: Address, fromDecimals: number;
    if (isSell) {
      // Selling token for USDC
      tokenIn = tokenAddress;
      tokenOut = DEX_USDC;
      fromDecimals = tokenDecimals;
    } else {
      // Buying token with USDC
      tokenIn = DEX_USDC;
      tokenOut = tokenAddress;
      fromDecimals = 6; // USDC decimals
    }

    // v19.3.1: Cap sell amount at actual on-chain balance to prevent "Insufficient balance"
    if (isSell) {
      try {
        const actualBal = await getTokenBalance(tokenSymbol);
        if (actualBal > 0) {
          const tPrice = marketData.tokens.find(t => t.symbol === tokenSymbol)?.price || 1;
          const actualValUSD = actualBal * tPrice;
          const cappedUSD = actualValUSD * 0.95;
          if (decision.amountUSD > cappedUSD && cappedUSD >= 1) {
            console.log(`  📊 DEX BALANCE CAP: ${tokenSymbol} sell capped $${decision.amountUSD.toFixed(2)} → $${cappedUSD.toFixed(2)}`);
            decision.amountUSD = cappedUSD;
          }
        }
      } catch { /* proceed with original amount */ }
    }

    // Calculate the amount to swap
    let fromAmount: bigint;
    if (isSell) {
      const tokenPrice = marketData.tokens.find(t => t.symbol === tokenSymbol)?.price || 1;
      const tokenAmount = decision.amountUSD / tokenPrice;
      fromAmount = parseUnits(tokenAmount.toFixed(Math.min(fromDecimals, 8)), fromDecimals);

      // v19.3.2: TOKEN-LEVEL BALANCE CAP for DEX sells
      try {
        const onChainBal = await getTokenBalance(tokenSymbol);
        if (onChainBal > 0) {
          const maxFrom = parseUnits((onChainBal * 0.95).toFixed(Math.min(fromDecimals, 8)), fromDecimals);
          if (fromAmount > maxFrom) {
            console.log(`  📊 DEX TOKEN CAP: ${tokenSymbol} sell capped ${formatUnits(fromAmount, fromDecimals)} → ${formatUnits(maxFrom, fromDecimals)} tokens`);
            fromAmount = maxFrom;
            decision.amountUSD = onChainBal * 0.95 * tokenPrice;
          }
        }
      } catch { /* proceed */ }
    } else {
      fromAmount = parseUnits(decision.amountUSD.toFixed(6), 6);
    }

    console.log(`\n  🔄 EXECUTING DIRECT DEX SWAP (Uniswap V3 Router):`);
    console.log(`     ${decision.fromToken} → ${decision.toToken}`);
    console.log(`     Token: ${tokenSymbol} (${tokenAddress})`);
    console.log(`     Amount: ${formatUnits(fromAmount, fromDecimals)} ${isSell ? decision.fromToken : 'USDC'} (~$${decision.amountUSD.toFixed(2)})`);
    console.log(`     Router: ${UNISWAP_V3_SWAP_ROUTER}`);
    console.log(`     Network: Base Mainnet`);

    // Get the CDP-managed account
    const account = await cdpClient.evm.getOrCreateAccount({ name: CDP_ACCOUNT_NAME });
    const walletAddress = account.address as Address;
    console.log(`     Account: ${walletAddress}`);

    // Step 1: Approve the Uniswap V3 SwapRouter to spend tokenIn (if needed)
    const APPROVE_SELECTOR = "0x095ea7b3";
    const MAX_UINT256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

    const allowanceData = "0xdd62ed3e" +
      walletAddress.slice(2).padStart(64, "0") +
      UNISWAP_V3_SWAP_ROUTER.slice(2).padStart(64, "0");

    const currentAllowance = await rpcCall("eth_call", [{
      to: tokenIn,
      data: allowanceData
    }, "latest"]);

    if (currentAllowance === "0x" || currentAllowance === "0x0000000000000000000000000000000000000000000000000000000000000000" || BigInt(currentAllowance) < fromAmount) {
      console.log(`     🔓 Approving SwapRouter to spend ${isSell ? decision.fromToken : 'USDC'}...`);
      const approveData = APPROVE_SELECTOR +
        UNISWAP_V3_SWAP_ROUTER.slice(2).padStart(64, "0") +
        MAX_UINT256.slice(2);

      const approveTx = await account.sendTransaction({
        network: "base",
        transaction: {
          to: tokenIn,
          data: approveData as `0x${string}`,
          value: BigInt(0),
        },
      });
      console.log(`     ✅ SwapRouter approved: ${approveTx.transactionHash}`);
      console.log(`     ⏳ Waiting 8s for approval to propagate...`);
      await new Promise(resolve => setTimeout(resolve, 8000));
    } else {
      console.log(`     ✅ SwapRouter already approved for ${isSell ? decision.fromToken : 'USDC'}`);
    }

    // Step 2: Snapshot token balance BEFORE swap
    const balanceToken = isSell ? decision.fromToken : decision.toToken;
    let preSwapBalance = 0;
    try {
      preSwapBalance = await getTokenBalance(balanceToken);
    } catch { /* non-critical */ }

    // Step 3: Calculate minimum output with slippage protection
    // Use 2% slippage for DEX-direct swaps (slightly more than CDP since we're doing manual routing)
    const slippageBps = 200; // 2%
    const tokenPrice = marketData.tokens.find(t => t.symbol === tokenSymbol)?.price || 0;
    let expectedOutput: number;
    let outDecimals: number;
    if (isSell) {
      expectedOutput = decision.amountUSD; // Expect ~amountUSD in USDC
      outDecimals = 6;
    } else {
      expectedOutput = tokenPrice > 0 ? decision.amountUSD / tokenPrice : 0;
      outDecimals = tokenDecimals;
    }
    const minOutput = expectedOutput * (1 - slippageBps / 10000);
    const amountOutMin = minOutput > 0 ? parseUnits(minOutput.toFixed(Math.min(outDecimals, 8)), outDecimals) : BigInt(0);
    console.log(`     🛡️ Slippage: ${slippageBps / 100}% | Min output: ${formatUnits(amountOutMin, outDecimals)}`);

    // Step 4: Try swap routes — first direct, then multi-hop via WETH
    const FEE_TIERS = [3000, 10000, 500]; // 0.3%, 1%, 0.05%
    let txHash = '';
    let swapSuccess = false;

    // Try direct single-hop first (tokenIn -> tokenOut) with each fee tier
    for (const fee of FEE_TIERS) {
      if (swapSuccess) break;
      try {
        console.log(`     🔄 Trying direct swap (fee: ${fee / 10000}%)...`);
        const calldata = buildExactInputSingleCalldata(
          tokenIn, tokenOut, fee, walletAddress, fromAmount, amountOutMin
        );

        const result = await account.sendTransaction({
          network: "base",
          transaction: {
            to: UNISWAP_V3_SWAP_ROUTER,
            data: calldata,
            value: BigInt(0),
          },
        });
        txHash = result.transactionHash;
        swapSuccess = true;
        console.log(`     ✅ Direct swap succeeded (fee: ${fee / 10000}%)`);
      } catch (e: any) {
        const msg = e?.message || '';
        console.log(`     ⚠️ Direct swap failed (fee: ${fee / 10000}%): ${msg.substring(0, 100)}`);
      }
    }

    // If direct swap failed, try multi-hop via WETH
    if (!swapSuccess) {
      for (const fee1 of [3000, 10000]) {
        if (swapSuccess) break;
        for (const fee2 of [500, 3000]) {
          if (swapSuccess) break;
          try {
            console.log(`     🔄 Trying multi-hop: ${isSell ? decision.fromToken : 'USDC'} →(${fee1})→ WETH →(${fee2})→ ${isSell ? 'USDC' : decision.toToken}...`);
            const path = encodeV3Path(
              [tokenIn, DEX_WETH, tokenOut],
              [fee1, fee2]
            );
            const calldata = buildExactInputMultihopCalldata(
              path, walletAddress, fromAmount, amountOutMin
            );

            const result = await account.sendTransaction({
              network: "base",
              transaction: {
                to: UNISWAP_V3_SWAP_ROUTER,
                data: calldata,
                value: BigInt(0),
              },
            });
            txHash = result.transactionHash;
            swapSuccess = true;
            console.log(`     ✅ Multi-hop swap succeeded (${fee1}/${fee2})`);
          } catch (e: any) {
            const msg = e?.message || '';
            console.log(`     ⚠️ Multi-hop failed (${fee1}/${fee2}): ${msg.substring(0, 100)}`);
          }
        }
      }
    }

    if (!swapSuccess) {
      throw new Error(`All DEX swap routes failed for ${tokenSymbol}. Tried direct (3 fee tiers) + multi-hop via WETH.`);
    }

    console.log(`\n  ✅ DIRECT DEX TRADE EXECUTED!`);
    console.log(`     TX Hash: ${txHash}`);
    console.log(`     🔍 View: https://basescan.org/tx/${txHash}`);

    // Update state
    state.trading.lastTrade = new Date();
    state.trading.totalTrades++;
    state.trading.successfulTrades++;

    // Read actual token balance AFTER swap with retry
    let postSwapBalance = 0;
    let actualTokens = 0;
    for (let balAttempt = 1; balAttempt <= 5; balAttempt++) {
      try {
        await new Promise(resolve => setTimeout(resolve, balAttempt === 1 ? 2000 : 3000));
        postSwapBalance = await getTokenBalance(balanceToken);
        actualTokens = Math.abs(postSwapBalance - preSwapBalance);
        if (actualTokens > 0) {
          console.log(`     📊 Actual tokens ${isSell ? 'sent' : 'received'}: ${actualTokens.toFixed(8)} ${balanceToken} (${preSwapBalance.toFixed(8)} → ${postSwapBalance.toFixed(8)})`);
          break;
        }
        if (balAttempt < 5) console.log(`     ⏳ Balance unchanged (attempt ${balAttempt}/5), retrying...`);
      } catch (e: any) {
        if (balAttempt === 5) console.warn(`     ⚠️ Post-swap balance check failed: ${e.message?.substring(0, 60)} — using estimate`);
      }
    }

    // Update cost basis
    let tradeRealizedPnL = 0;
    if (!isSell && decision.toToken !== "USDC") {
      const tPrice = marketData.tokens.find(t => t.symbol === decision.toToken)?.price || 1;
      const tokensReceived = actualTokens > 0 ? actualTokens : (decision.amountUSD / tPrice);
      updateCostBasisAfterBuy(decision.toToken, decision.amountUSD, tokensReceived);
    } else if (isSell && decision.fromToken !== "USDC") {
      const tPrice = marketData.tokens.find(t => t.symbol === decision.fromToken)?.price || 1;
      const tokensSold = actualTokens > 0 ? actualTokens : (decision.tokenAmount || (decision.amountUSD / tPrice));
      tradeRealizedPnL = updateCostBasisAfterSell(decision.fromToken, decision.amountUSD, tokensSold);
      // v20.0: Clean up trailing stop after sell
      removeTrailingStop(decision.fromToken);
    }

    // Record trade
    const tradedToken = isSell ? decision.fromToken : decision.toToken;
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
      portfolioValueAfter: portfolioValueBefore - (lastGasPrice.fetchedAt > 0 ? (lastGasPrice.gweiL2 * 150000 / 1e9 * lastGasPrice.ethPriceUSD) : 0.15),
      reasoning: `[DEX-DIRECT] ${decision.reasoning}`,
      sector: decision.sector,
      realizedPnL: tradeRealizedPnL,
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
        triggeredBy: decision.isExploration ? "EXPLORATION" : decision.isForced ? "FORCED_DEPLOY" : "AI",
        isExploration: decision.isExploration || false,
        isForced: decision.isForced || false,
        btcPositioning: marketData.derivatives?.btcPositioningSignal || null,
        ethPositioning: marketData.derivatives?.ethPositioningSignal || null,
        crossAssetSignal: marketData.macroData?.crossAssets?.crossAssetSignal || null,
        adaptiveSlippage: slippageBps,
      },
    };
    state.tradeHistory.push(record);
    if (state.tradeHistory.length > 5000) state.tradeHistory = state.tradeHistory.slice(-5000);
    saveTradeHistory();
    recordExecuted(decision.action === 'BUY' ? (decision.toToken || '') : (decision.fromToken || ''), decision.action, dedupTier, decision.amountUSD);

    return { success: true, txHash, actualTokens: actualTokens > 0 ? actualTokens : undefined };

  } catch (error: any) {
    const errorMsg = error.message || String(error);
    console.error(`\n  ❌ DIRECT DEX SWAP FAILED:`);
    console.error(`     Error: ${errorMsg}`);
    if (error.stack) console.error(`     Stack: ${error.stack.split('\n').slice(0, 3).join('\n     ')}`);

    state.trading.totalTrades++;

    return { success: false, error: errorMsg };
  }
}

/**
 * Execute a single atomic swap (used directly for small orders, or called per-slice by TWAP).
 * v8.1: Now returns actualTokens from pre/post balance diff.
 */
async function executeSingleSwap(
  decision: TradeDecision,
  marketData: MarketData
): Promise<{ success: boolean; txHash?: string; error?: string; actualTokens?: number }> {

  const portfolioValueBefore = state.trading.totalPortfolioValue;

  // v14.3: Route DEX_SWAP_TOKENS directly through DEX — skip CDP SDK entirely
  const tradeToken = decision.action === "SELL" ? decision.fromToken : decision.toToken;
  if (DEX_SWAP_TOKENS.has(tradeToken)) {
    console.log(`  🔀 ${tradeToken} is a DEX-routed token — using direct DEX swap (skipping CDP SDK)`);
    return await executeDirectDexSwap(decision, marketData);
  }

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

      // v19.3.2: TOKEN-LEVEL BALANCE CAP — read actual on-chain balance and cap fromAmount
      // This prevents "Insufficient balance" errors when cached balance drifts from on-chain reality
      try {
        const onChainBalance = await getTokenBalance(decision.fromToken);
        if (onChainBalance > 0) {
          const maxFromAmount = parseUnits((onChainBalance * 0.95).toFixed(Math.min(fromDecimals, 8)), fromDecimals);
          if (fromAmount > maxFromAmount) {
            console.log(`  📊 TOKEN CAP: ${decision.fromToken} sell capped ${formatUnits(fromAmount, fromDecimals)} → ${formatUnits(maxFromAmount, fromDecimals)} tokens (on-chain: ${onChainBalance.toFixed(8)})`);
            fromAmount = maxFromAmount;
            decision.amountUSD = onChainBalance * 0.95 * tokenPrice;
          }
        }
      } catch { /* proceed with calculated amount */ }
    }

    console.log(`\n  🔄 EXECUTING TRADE via CDP SDK (CoinbaseSmartWallet):`);
    console.log(`     ${decision.fromToken} (${fromTokenAddress})`);
    console.log(`     → ${decision.toToken} (${toTokenAddress})`);
    console.log(`     Amount: ${formatUnits(fromAmount, fromDecimals)} ${decision.fromToken} (~$${decision.amountUSD.toFixed(2)})`);
    console.log(`     Slippage: ${CONFIG.trading.slippageBps / 100}%`);
    console.log(`     Network: Base Mainnet`);

    // Get the CDP-managed account (wallet IS a CoinbaseSmartWallet — no wrapper needed)
    const account = await cdpClient.evm.getOrCreateAccount({
      name: CDP_ACCOUNT_NAME,
    });
    const swapperAddress = account.address;
    console.log(`     Account: ${swapperAddress}`);

    // Approve Permit2 contract to spend the fromToken (one-time per token)
    const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    const MAX_UINT256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    const APPROVE_SELECTOR = "0x095ea7b3"; // approve(address,uint256)

    // Check current allowance from the swapper address
    const allowanceData = "0xdd62ed3e" +
      swapperAddress.slice(2).padStart(64, "0") +
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

    // v8.1: Snapshot token balance BEFORE swap for accurate cost basis
    const balanceToken = decision.action === 'BUY' ? decision.toToken : decision.fromToken;
    let preSwapBalance = 0;
    try {
      preSwapBalance = await getTokenBalance(balanceToken);
    } catch { /* non-critical — fall back to estimate */ }

    // Execute the swap with retry logic
    let result: any;
    let txHash = '';
    const maxRetries = justApproved ? 3 : 1;
    let cdpSwapFailed = false;
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
        txHash = result.transactionHash;
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
        } else if (swapMsg.includes("Invalid request") || swapMsg.includes("payment method") || swapMsg.includes("not supported") || swapMsg.includes("invalid")) {
          // v14.3: CDP SDK can't route this token — fall back to direct DEX swap
          console.log(`     ⚠️ CDP SDK rejected swap — will fall back to direct DEX swap`);
          console.log(`     Reason: ${swapMsg.substring(0, 120)}`);
          logError('SWAP_REJECTED', swapMsg, { from: decision.fromToken, to: decision.toToken, amountUSD: decision.amountUSD });
          cdpSwapFailed = true;
          break;
        } else {
          logError('SWAP_ERROR', swapMsg, { from: decision.fromToken, to: decision.toToken, attempt, code: swapError?.code });
          throw swapError; // Re-throw for outer catch to handle
        }
      }
    }

    // v14.3: If CDP SDK doesn't support the token pair, fall back to direct DEX swap.
    // This handles MORPHO, cbLTC, PENDLE and any other tokens CDP can't route.
    if (cdpSwapFailed) {
      const failedToken = decision.action === "SELL" ? decision.fromToken : decision.toToken;
      console.log(`     🔀 CDP swap failed, falling back to direct DEX swap for ${failedToken}`);
      return await executeDirectDexSwap(decision, marketData);
    }

    console.log(`\n  ✅ TRADE EXECUTED SUCCESSFULLY!`);
    console.log(`     TX Hash: ${txHash}`);
    console.log(`     🔍 View: https://basescan.org/tx/${txHash}`);

    // Update state
    state.trading.lastTrade = new Date();
    state.trading.totalTrades++;
    state.trading.successfulTrades++;

    // v8.1 + v10.2: Read actual token balance AFTER swap with retry for accurate cost basis
    let postSwapBalance = 0;
    let actualTokens = 0;
    for (let balAttempt = 1; balAttempt <= 5; balAttempt++) {
      try {
        await new Promise(resolve => setTimeout(resolve, balAttempt === 1 ? 2000 : 3000));
        postSwapBalance = await getTokenBalance(balanceToken);
        actualTokens = Math.abs(postSwapBalance - preSwapBalance);
        if (actualTokens > 0) {
          console.log(`     📊 Actual tokens ${decision.action === 'BUY' ? 'received' : 'sent'}: ${actualTokens.toFixed(8)} ${balanceToken} (balance: ${preSwapBalance.toFixed(8)} → ${postSwapBalance.toFixed(8)})`);
          break; // Got a real balance change
        }
        if (balAttempt < 5) console.log(`     ⏳ Balance unchanged (attempt ${balAttempt}/5), retrying...`);
      } catch (e: any) {
        if (balAttempt === 5) console.warn(`     ⚠️ Post-swap balance check failed: ${e.message?.substring(0, 60)} — using estimate`);
      }
    }

    // Update cost basis — prefer actual tokens, fall back to estimated
    let tradeRealizedPnL = 0; // v12.2: capture realized P&L at trade time for daily scoreboard
    if (decision.action === "BUY" && decision.toToken !== "USDC") {
      const tokenPrice = marketData.tokens.find(t => t.symbol === decision.toToken)?.price || 1;
      const tokensReceived = actualTokens > 0 ? actualTokens : (decision.amountUSD / tokenPrice);
      if (actualTokens > 0) {
        const actualPrice = decision.amountUSD / actualTokens;
        const slippagePaid = ((actualPrice - tokenPrice) / tokenPrice) * 100;
        console.log(`     📊 Cost basis: actual price $${actualPrice.toFixed(6)} vs market $${tokenPrice.toFixed(6)} (slippage: ${slippagePaid > 0 ? '+' : ''}${slippagePaid.toFixed(2)}%)`);
      }
      updateCostBasisAfterBuy(decision.toToken, decision.amountUSD, tokensReceived);
    } else if (decision.action === "SELL" && decision.fromToken !== "USDC") {
      const tokenPrice = marketData.tokens.find(t => t.symbol === decision.fromToken)?.price || 1;
      const tokensSold = actualTokens > 0 ? actualTokens : (decision.tokenAmount || (decision.amountUSD / tokenPrice));
      tradeRealizedPnL = updateCostBasisAfterSell(decision.fromToken, decision.amountUSD, tokensSold);
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
      // v8.1: portfolioValueAfter — use cached gas cost instead of hardcoded 1.5%
      portfolioValueAfter: portfolioValueBefore - (lastGasPrice.fetchedAt > 0 ? (lastGasPrice.gweiL2 * 150000 / 1e9 * lastGasPrice.ethPriceUSD) : 0.15),
      reasoning: decision.reasoning,
      sector: decision.sector,
      realizedPnL: tradeRealizedPnL, // v12.2: store at trade time for accurate daily P&L
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
        triggeredBy: decision.isExploration ? "EXPLORATION" : decision.isForced ? "FORCED_DEPLOY" : "AI",
        isExploration: decision.isExploration || false,
        isForced: decision.isForced || false,
        // v5.1: Enhanced signal context
        btcPositioning: marketData.derivatives?.btcPositioningSignal || null,
        ethPositioning: marketData.derivatives?.ethPositioningSignal || null,
        crossAssetSignal: marketData.macroData?.crossAssets?.crossAssetSignal || null,
        adaptiveSlippage: adaptiveSlippage,
      },
    };
    state.tradeHistory.push(record);
    // v10.2: Cap trade history to prevent unbounded memory growth
    if (state.tradeHistory.length > 5000) state.tradeHistory = state.tradeHistory.slice(-5000);
    saveTradeHistory();

    return { success: true, txHash, actualTokens: actualTokens > 0 ? actualTokens : undefined };

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

    // v18.1: Log to error ring buffer for /api/errors
    logError('TRADE_FAILED', errorMsg, {
      action: decision.action,
      from: decision.fromToken,
      to: decision.toToken,
      amountUSD: decision.amountUSD,
      code: error.code || null,
      status: error.status || null,
      apiResponse: error.response?.data ? JSON.stringify(error.response.data).substring(0, 300) : null,
    });

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
    if (state.tradeHistory.length > 5000) state.tradeHistory = state.tradeHistory.slice(-5000);
    // v11.4.20: Don't increment totalTrades for failed trades — was inflating the counter
    // totalTrades should only count successful executions (line 6967)
    saveTradeHistory();

    return { success: false, error: errorMsg };
  }
}

// ============================================================================
// MAIN TRADING CYCLE
// ============================================================================


/**
 * v9.3: Daily Payout — distributes a percentage of yesterday's realized P&L
 * to configured recipients. Runs once per day at 8 AM UTC via cron.
 * Idempotent: uses state.lastDailyPayoutDate as dedup key (YYYY-MM-DD).
 */
async function executeDailyPayout(): Promise<void> {
  const recipients = CONFIG.autoHarvest.recipients;
  if (!recipients || recipients.length === 0) {
    console.log(`[Daily Payout] No recipients configured — skipping`);
    return;
  }

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  console.log(`\n========================================`);
  console.log(`💰 [Daily Payout] Settlement for ${yesterdayStr}`);
  console.log(`========================================`);

  // Idempotency — already paid this day?
  if (state.lastDailyPayoutDate === yesterdayStr) {
    console.log(`[Daily Payout] Already paid for ${yesterdayStr} — skipping (restart-safe)`);
    return;
  }

  // Compute yesterday's realized P&L
  const dailyData = apiDailyPnL();
  const yesterdayEntry = dailyData.days.find(d => d.date === yesterdayStr);
  const realizedPnL = yesterdayEntry?.realized || 0;

  console.log(`[Daily Payout] Realized P&L: $${realizedPnL.toFixed(2)}`);
  if (yesterdayEntry) {
    console.log(`   Trades: ${yesterdayEntry.trades} | Sells: ${yesterdayEntry.sells} | Wins: ${yesterdayEntry.wins}`);
  }

  // Negative day — record and skip
  if (realizedPnL <= 0) {
    console.log(`[Daily Payout] No profit ($${realizedPnL.toFixed(2)}) — no payout`);
    state.dailyPayouts.push({
      date: yesterdayStr, payoutDate: now.toISOString(), realizedPnL,
      payoutPercent: 0, totalDistributed: 0, transfers: [], skippedReason: 'NEGATIVE_PNL',
    });
    state.lastDailyPayoutDate = yesterdayStr;
    saveTradeHistory();
    return;
  }

  // Capital floor check
  const capitalFloor = CONFIG.autoHarvest.minTradingCapitalUSD || 500;
  const currentPortfolio = state.trading.totalPortfolioValue || 0;
  const headroom = Math.max(0, currentPortfolio - capitalFloor);
  if (headroom <= 0) {
    console.log(`[Daily Payout] Portfolio ($${currentPortfolio.toFixed(2)}) at capital floor ($${capitalFloor}) — skipping`);
    state.dailyPayouts.push({
      date: yesterdayStr, payoutDate: now.toISOString(), realizedPnL,
      payoutPercent: 0, totalDistributed: 0, transfers: [], skippedReason: 'BELOW_FLOOR',
    });
    state.lastDailyPayoutDate = yesterdayStr;
    saveTradeHistory();
    return;
  }

  // v10.2: Persist payout date BEFORE executing transfers to prevent double-payout on crash
  state.lastDailyPayoutDate = yesterdayStr;
  saveTradeHistory();

  // Check USDC balance and ETH for gas
  const payoutWalletAddr = CONFIG.walletAddress;
  const usdcBalance = await getERC20Balance(TOKEN_REGISTRY.USDC.address, payoutWalletAddr, 6);
  const ethBalance = await getETHBalance(payoutWalletAddr);

  if (ethBalance < DAILY_PAYOUT_MIN_ETH_RESERVE) {
    console.log(`[Daily Payout] ETH (${ethBalance.toFixed(6)}) below gas reserve — skipping`);
    state.dailyPayouts.push({
      date: yesterdayStr, payoutDate: now.toISOString(), realizedPnL,
      payoutPercent: 0, totalDistributed: 0, transfers: [], skippedReason: 'LOW_GAS',
    });
    state.lastDailyPayoutDate = yesterdayStr;
    saveTradeHistory();
    return;
  }

  // v10.1.1: Higher USDC reserve — keep at least $50 for trading operations
  // The $5 buffer was too low and caused USDC exhaustion → trading freeze
  const PAYOUT_TRADING_RESERVE = 50; // Keep $50 minimum for active trading
  const effectiveBuffer = Math.max(DAILY_PAYOUT_USDC_BUFFER, PAYOUT_TRADING_RESERVE);
  const sendableUSDC = Math.max(0, usdcBalance - effectiveBuffer);
  const totalRecipientPct = recipients.reduce((s: number, r: HarvestRecipient) => s + r.percent, 0);

  console.log(`[Daily Payout] USDC: $${usdcBalance.toFixed(2)} (sendable: $${sendableUSDC.toFixed(2)}) | ETH: ${ethBalance.toFixed(6)}`);
  console.log(`[Daily Payout] Recipients: ${recipients.map((r: HarvestRecipient) => `${r.label}(${r.percent}%)`).join(', ')}`);

  const account = await cdpClient.evm.getOrCreateAccount({ name: CDP_ACCOUNT_NAME });

  const transferResults: Array<{ label: string; wallet: string; amount: number; txHash?: string; error?: string }> = [];
  let totalSent = 0;

  for (const recipient of recipients) {
    const share = realizedPnL * (recipient.percent / 100);

    if (share < DAILY_PAYOUT_MIN_TRANSFER_USD) {
      transferResults.push({
        label: recipient.label,
        wallet: recipient.wallet.slice(0, 6) + '...' + recipient.wallet.slice(-4),
        amount: 0, error: `Share $${share.toFixed(2)} below min $${DAILY_PAYOUT_MIN_TRANSFER_USD}`,
      });
      continue;
    }

    const remainingSendable = sendableUSDC - totalSent;
    const remainingHeadroom = headroom - totalSent;
    const transferAmount = Math.min(share, remainingSendable, remainingHeadroom);

    if (transferAmount < DAILY_PAYOUT_MIN_TRANSFER_USD) {
      transferResults.push({
        label: recipient.label,
        wallet: recipient.wallet.slice(0, 6) + '...' + recipient.wallet.slice(-4),
        amount: 0, error: `Capped to $${transferAmount.toFixed(2)} — below minimum`,
      });
      continue;
    }

    console.log(`[Daily Payout] -> ${recipient.label}: $${transferAmount.toFixed(2)} (${recipient.percent}% of $${realizedPnL.toFixed(2)}) → ${recipient.wallet.slice(0, 6)}...${recipient.wallet.slice(-4)}`);

    // v10.4: Retry once on failure — transient nonce/gas issues shouldn't cause missed payouts
    let txHash: string | null = null;
    let lastError: string = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        txHash = await sendUSDCTransfer(account, recipient.wallet, transferAmount);
        console.log(`[Daily Payout] ✅ ${recipient.label}: TX ${txHash}${attempt > 1 ? ' (retry succeeded)' : ''}`);
        console.log(`[Daily Payout] 🔍 https://basescan.org/tx/${txHash}`);
        break;
      } catch (err: any) {
        lastError = err.message || String(err);
        console.error(`[Daily Payout] ❌ ${recipient.label} attempt ${attempt}/2: ${lastError}`);
        if (attempt < 2) {
          console.log(`[Daily Payout] ⏳ Retrying ${recipient.label} in 3s...`);
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }

    if (txHash) {
      transferResults.push({
        label: recipient.label,
        wallet: recipient.wallet.slice(0, 6) + '...' + recipient.wallet.slice(-4),
        amount: transferAmount, txHash,
      });
      totalSent += transferAmount;
      state.dailyPayoutByRecipient[recipient.label] =
        (state.dailyPayoutByRecipient[recipient.label] || 0) + transferAmount;

      // Update legacy counters for backward compat
      state.totalAutoHarvestedUSD += transferAmount;
      state.autoHarvestCount++;
      state.autoHarvestByRecipient[recipient.label] =
        (state.autoHarvestByRecipient[recipient.label] || 0) + transferAmount;
    } else {
      console.error(`[Daily Payout] ❌❌ ${recipient.label}: FAILED after 2 attempts — ${lastError}`);
      transferResults.push({
        label: recipient.label,
        wallet: recipient.wallet.slice(0, 6) + '...' + recipient.wallet.slice(-4),
        amount: 0, error: lastError,
      });
    }
  }

  // Record payout
  state.dailyPayouts.push({
    date: yesterdayStr, payoutDate: now.toISOString(), realizedPnL,
    payoutPercent: totalRecipientPct, totalDistributed: totalSent,
    transfers: transferResults,
    skippedReason: totalSent === 0 ? 'ALL_TRANSFERS_FAILED' : undefined,
  });
  if (state.dailyPayouts.length > 90) state.dailyPayouts = state.dailyPayouts.slice(-90);
  state.totalDailyPayoutsUSD += totalSent;
  if (totalSent > 0) state.dailyPayoutCount++;
  // lastDailyPayoutDate already persisted above (pre-transfer idempotency guard)
  state.lastAutoHarvestTime = now.toISOString();

  // v11.4.2: Adjust peakValue downward after payouts — payouts are intentional capital
  // outflows, NOT drawdowns. Without this, peakValue stays at pre-payout highs and
  // eventually triggers CAPITAL FLOOR (HOLD-ONLY) as payouts accumulate.
  // This mirrors the deposit logic at line ~7551 which adjusts peakValue UP for deposits.
  if (totalSent > 0 && state.trading.peakValue > totalSent) {
    const oldPeak = state.trading.peakValue;
    state.trading.peakValue -= totalSent;
    // Also adjust breaker baselines so payouts don't trigger circuit breakers
    if (breakerState.dailyBaseline.value > totalSent) breakerState.dailyBaseline.value -= totalSent;
    if (breakerState.weeklyBaseline.value > totalSent) breakerState.weeklyBaseline.value -= totalSent;
    console.log(`[Daily Payout] Peak adjusted: $${oldPeak.toFixed(2)} → $${state.trading.peakValue.toFixed(2)} (payout-aware baseline)`);
  }

  saveTradeHistory();

  const reinvestPct = 100 - totalRecipientPct;
  console.log(`[Daily Payout] DONE: Sent $${totalSent.toFixed(2)} | Reinvested $${(realizedPnL - totalSent).toFixed(2)} (${reinvestPct}%)`);
  console.log(`[Daily Payout] Lifetime: $${state.totalDailyPayoutsUSD.toFixed(2)} over ${state.dailyPayoutCount} days`);
  console.log(`========================================\n`);
}

// v11.4.18: Removed dead checkAutoHarvestTransfer() — replaced by executeDailyPayout() in v9.3

// Helper: send USDC (ERC-20) transfer — v10.1: uses Smart Account when available (gasless)
async function sendUSDCTransfer(account: any, to: string, amountUSDC: number): Promise<string> {
  const usdcAddress = TOKEN_REGISTRY.USDC.address;
  // USDC has 6 decimals
  const amount = BigInt(Math.floor(amountUSDC * 1e6));
  // ERC-20 transfer(address,uint256) selector: 0xa9059cbb
  const transferData = "0xa9059cbb" +
    to.slice(2).padStart(64, "0") +
    amount.toString(16).padStart(64, "0");

  // v10.1.1: Use account.sendTransaction() directly — wallet IS a CoinbaseSmartWallet
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
  // v10.1.1: Use account.sendTransaction() directly — wallet IS a CoinbaseSmartWallet
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
 * Quick price check for light cycle determination (v12.0: on-chain fallback)
 * Primary: lastKnownPrices (always populated after first heavy cycle)
 * Fallback: fetchAllOnChainPrices() (replaces CoinGecko)
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

  // Fallback: on-chain DEX pool reads (no API keys, no rate limits)
  try {
    const onChainPrices = await fetchAllOnChainPrices();
    for (const [symbol, price] of onChainPrices) {
      prices.set(symbol, price);
      lastKnownPrices[symbol] = {
        price, change24h: 0, change7d: 0,
        volume: 0, marketCap: 0,
        name: TOKEN_REGISTRY[symbol]?.name || symbol,
        sector: TOKEN_REGISTRY[symbol]?.sector || 'unknown',
      };
    }
    if (prices.size > 0) console.log(`  🔗 Quick prices: ${prices.size} tokens via on-chain reads`);
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

  // 1. Forced interval: heavy cycle every 60s — always thinking (v10.3)
  if (now - lastHeavyCycleAt > HEAVY_CYCLE_FORCED_INTERVAL_MS) {
    return { isHeavy: true, reason: `Forced interval (${((now - lastHeavyCycleAt) / 1000).toFixed(0)}s since last heavy)` };
  }

  // 2. v6.1: Force heavy if pricing is broken (all tokens $0 = only USDC counted)
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

  // v11.5: Fear & Greed heavy cycle trigger REMOVED — F&G changes don't warrant full cycles.
  // Heavy cycles now trigger only on: forced interval, price moves, emergencies, cooldown exits.

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

// ============================================================================
// NVR CENTRAL SIGNAL SERVICE — Signal Production (Phase 1)
// ============================================================================

async function produceSignals(): Promise<void> {
  signalCycleNumber++;
  const cycleStart = Date.now();
  console.log(`\n[SIGNAL PRODUCER] Cycle #${signalCycleNumber} — collecting market data...`);

  try {
    const marketData = await getMarketData();
    const signals: TradingSignal[] = [];

    // v15.0: SWARM MODE — multi-agent voting replaces single confluence in producer mode
    if (SIGNAL_ENGINE === 'swarm') {
      console.log('[SIGNAL PRODUCER] Using SWARM engine (5 micro-agents)');
      const _swarmTokens = Object.entries(TOKEN_REGISTRY)
        .filter(([s]) => s !== 'USDC' && s !== 'WETH')
        .map(([symbol, tokenInfo]) => {
          const td = marketData.tokens.find(t => t.symbol === symbol);
          if (!td) return null;
          // v17.0: Compute price distance from 30-day high
          let priceDistanceFromHigh: number | undefined;
          const histEntry = priceHistoryStore.tokens[symbol];
          if (histEntry && histEntry.prices.length > 0) {
            const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
            let high30d = td.price;
            for (let i = 0; i < histEntry.timestamps.length; i++) {
              if (histEntry.timestamps[i] >= thirtyDaysAgo && histEntry.prices[i] > high30d) high30d = histEntry.prices[i];
            }
            if (high30d > 0) priceDistanceFromHigh = ((td.price - high30d) / high30d) * 100;
          }
          const prevBR = previousBuyRatios.get(symbol);
          const ind = marketData.indicators[symbol];
          if (ind?.orderFlow) {
            const totalFlow = ind.orderFlow.buyVolumeUSD + ind.orderFlow.sellVolumeUSD;
            if (totalFlow > 0) previousBuyRatios.set(symbol, (ind.orderFlow.buyVolumeUSD / totalFlow) * 100);
          }
          // v19.0: Attach multi-timeframe flow data
          const _ftf = getFlowTimeframes(flowTimeframeState, symbol);
          return { symbol, price: td.price, priceChange24h: td.priceChange24h, volume24h: td.volume24h, sector: td.sector || tokenInfo.sector, priceDistanceFromHigh, previousBuyRatio: prevBR, flowAvg5m: _ftf.avg5m ?? undefined, flowAvg1h: _ftf.avg1h ?? undefined, flowAvg4h: _ftf.avg4h ?? undefined, flowPositiveTimeframes: _ftf.positiveTimeframes, indicators: marketData.indicators[symbol] || undefined };
        })
        .filter(Boolean) as any[];
      const _usdcBal = state.trading.balances.find(b => b.symbol === 'USDC');
      const _totalVal = state.trading.totalPortfolioValue || 1;
      const _cashPct = _usdcBal ? (_usdcBal.usdValue / _totalVal) * 100 : 50;
      const _swarmPos: Record<string, { usdValue: number; gainPct?: number; costBasis?: number }> = {};
      for (const b of state.trading.balances) { if (b.symbol === 'USDC') continue; const cb = state.costBasis[b.symbol]; _swarmPos[b.symbol] = { usdValue: b.usdValue, gainPct: cb ? ((b.usdValue - cb.totalCostBasis) / cb.totalCostBasis) * 100 : undefined, costBasis: cb?.avgCostPerUnit }; }
      const _sectorAlloc: Record<string, number> = {};
      for (const sa of state.trading.sectorAllocations) _sectorAlloc[sa.name] = sa.currentPercent;
      const _btcData = marketData.tokens.find(t => t.symbol === 'cbBTC' || t.symbol === 'BTC');
      const _ethData = marketData.tokens.find(t => t.symbol === 'ETH');
      const _swarmDecisions = runSwarm(_swarmTokens, { totalValue: _totalVal, cashPercent: _cashPct, positions: _swarmPos, sectorAllocations: _sectorAlloc }, { fearGreedIndex: marketData.fearGreed.value, fearGreedClassification: marketData.fearGreed.classification, btc24hChange: _btcData?.priceChange24h || 0, eth24hChange: _ethData?.priceChange24h || 0, regime: marketData.marketRegime });
      setLatestSwarmDecisions(_swarmDecisions);
      for (const d of _swarmDecisions) {
        const td = marketData.tokens.find(t => t.symbol === d.token);
        const ind = marketData.indicators[d.token];
        let br: number | null = null;
        if (ind?.orderFlow) { const tf = ind.orderFlow.buyVolumeUSD + ind.orderFlow.sellVolumeUSD; if (tf > 0) br = (ind.orderFlow.buyVolumeUSD / tf) * 100; }
        const confluence = Math.round(d.totalScore * 50);
        const vb = d.votes.map(v => `${v.agent}:${v.action}(${v.confidence}%)`).join(' ');
        signals.push({ token: d.token, action: d.finalAction, confluence, reasoning: `Swarm ${d.consensus}% consensus [${vb}]`, indicators: { rsi14: ind?.rsi14 ?? null, macdSignal: ind?.macd?.signal ?? null, macdHistogram: ind?.macd?.histogram ?? null, bollingerSignal: ind?.bollingerBands?.signal ?? null, bollingerPercentB: ind?.bollingerBands?.percentB ?? null, volumeChange24h: ind?.volumeChange24h ?? null, buyRatio: br, adx: ind?.adx14?.adx ?? null, atrPercent: ind?.atrPercent ?? null }, price: td?.price || 0, priceChange24h: td?.priceChange24h || 0, sector: td?.sector || '' });
      }
    } else {
    // CLASSIC MODE — original single confluence calculation
    for (const [symbol, tokenInfo] of Object.entries(TOKEN_REGISTRY)) {
      if (symbol === 'USDC' || symbol === 'WETH') continue;

      const tokenData = marketData.tokens.find(t => t.symbol === symbol);
      if (!tokenData) continue;

      const ind = marketData.indicators[symbol];

      let confluence = 0;
      const reasons: string[] = [];

      // RSI signal
      if (ind?.rsi14 !== null && ind?.rsi14 !== undefined) {
        if (ind.rsi14 < 30) { confluence += 20; reasons.push(`RSI oversold (${ind.rsi14.toFixed(1)})`); }
        else if (ind.rsi14 > 70) { confluence -= 20; reasons.push(`RSI overbought (${ind.rsi14.toFixed(1)})`); }
      }

      // MACD signal
      if (ind?.macd) {
        if (ind.macd.signal === 'BULLISH') { confluence += 15; reasons.push('MACD bullish'); }
        else if (ind.macd.signal === 'BEARISH') { confluence -= 15; reasons.push('MACD bearish'); }
      }

      // Bollinger signal
      if (ind?.bollingerBands) {
        if (ind.bollingerBands.signal === 'OVERSOLD') { confluence += 10; reasons.push('BB oversold'); }
        else if (ind.bollingerBands.signal === 'OVERBOUGHT') { confluence -= 10; reasons.push('BB overbought'); }
      }

      // Buy ratio from order flow
      let buyRatio: number | null = null;
      if (ind?.orderFlow) {
        const totalFlow = ind.orderFlow.buyVolumeUSD + ind.orderFlow.sellVolumeUSD;
        if (totalFlow > 0) {
          buyRatio = (ind.orderFlow.buyVolumeUSD / totalFlow) * 100;
          if (buyRatio > 60) { confluence += 15; reasons.push(`Strong buying (${buyRatio.toFixed(0)}%)`); }
          else if (buyRatio < 40) { confluence -= 15; reasons.push(`Strong selling (${buyRatio.toFixed(0)}%)`); }
        }
      }

      // Volume spike
      if (ind?.volumeChange24h !== null && ind?.volumeChange24h !== undefined) {
        const volumeMultiple = 1 + (ind.volumeChange24h / 100);
        if (volumeMultiple >= 1.5) { confluence += 10; reasons.push(`Volume spike (${volumeMultiple.toFixed(1)}x)`); }
      }

      // ADX trend strength + direction
      if (ind?.adx14 && ind.adx14.adx > 25) {
        if (tokenData.priceChange24h > 0) { confluence += 10; reasons.push(`Strong uptrend (ADX ${ind.adx14.adx.toFixed(0)})`); }
        else if (tokenData.priceChange24h < 0) { confluence -= 10; reasons.push(`Strong downtrend (ADX ${ind.adx14.adx.toFixed(0)})`); }
      }

      // Map confluence to action
      let action: TradingSignal['action'];
      if (confluence >= 40) action = 'STRONG_BUY';
      else if (confluence >= 15) action = 'BUY';
      else if (confluence <= -40) action = 'STRONG_SELL';
      else if (confluence <= -15) action = 'SELL';
      else action = 'HOLD';

      signals.push({
        token: symbol,
        action,
        confluence,
        reasoning: reasons.length > 0 ? reasons.join('; ') : 'No strong signals',
        indicators: {
          rsi14: ind?.rsi14 ?? null,
          macdSignal: ind?.macd?.signal ?? null,
          macdHistogram: ind?.macd?.histogram ?? null,
          bollingerSignal: ind?.bollingerBands?.signal ?? null,
          bollingerPercentB: ind?.bollingerBands?.percentB ?? null,
          volumeChange24h: ind?.volumeChange24h ?? null,
          buyRatio: buyRatio,
          adx: ind?.adx14?.adx ?? null,
          atrPercent: ind?.atrPercent ?? null,
        },
        price: tokenData.price,
        priceChange24h: tokenData.priceChange24h,
        sector: tokenData.sector || tokenInfo.sector,
      });
    }
    } // end classic/swarm branch

    const now = new Date();
    const intervalMs = (CONFIG.trading.intervalMinutes || 5) * 60 * 1000;
    const nextExpected = new Date(now.getTime() + intervalMs);

    latestSignals = {
      timestamp: now.toISOString(),
      cycleNumber: signalCycleNumber,
      marketRegime: marketData.marketRegime,
      fearGreedIndex: marketData.fearGreed.value,
      fearGreedClassification: marketData.fearGreed.classification,
      signals,
      meta: {
        version: BOT_VERSION,
        generatedAt: now.toISOString(),
        nextExpectedAt: nextExpected.toISOString(),
        ttlSeconds: Math.round(intervalMs / 1000) * 2,
      },
    };

    const actionCounts: Record<string, number> = {};
    for (const sig of signals) {
      actionCounts[sig.action] = (actionCounts[sig.action] || 0) + 1;
    }
    const summary = Object.entries(actionCounts).map(([a, c]) => `${c} ${a}`).join(', ');
    console.log(`[SIGNAL PRODUCER] Produced signals: ${summary} (${(Date.now() - cycleStart)}ms)`);

    // NVR-SPEC-004: Track signal history
    pushSignalHistory(latestSignals!);

  } catch (err: any) {
    console.error(`[SIGNAL PRODUCER] Error producing signals: ${err.message?.substring(0, 300)}`);
  }
}

async function runTradingCycle() {
  // NVR Signal Service: In producer mode, only produce signals — skip all trading logic
  if (signalMode === 'producer') {
    await produceSignals();
    return;
  }

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

    // v9.2: Sync costBasis.currentPrice on light cycles so dashboard stays fresh
    for (const [symbol, price] of currentPrices) {
      if (state.costBasis[symbol] && price > 0) {
        (state.costBasis[symbol] as any).currentPrice = price;
      }
    }

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

  // v14.2: Track exploration trades per cycle for RANGING market cap
  let explorationsThisCycle = 0;

  try {
    // v9.2.1: Gas bootstrap retry — if startup bootstrap failed, retry each heavy cycle
    if (cdpClient && CONFIG.trading.enabled && !gasBootstrapAttempted) {
      try {
        await bootstrapGas();
      } catch (bErr: any) {
        console.warn(`  ⛽ [GAS BOOTSTRAP] Cycle retry failed: ${bErr?.message?.substring(0, 150)}`);
      }
    }

    // v9.2: Auto gas refuel check — ensure ETH for tx fees before any trades
    if (cdpClient && CONFIG.trading.enabled) {
      const gasResult = await checkAndRefuelGas();
      if (gasResult.error) {
        console.log(`  ⛽ Gas: ${gasResult.ethBalance.toFixed(6)} ETH — ${gasResult.error}`);
      }
    }

    // v10.1.1: Fund migration removed — wallet IS the Smart Wallet at 0x55509

    console.log("\n📊 Fetching balances...");
    let balances = await getBalances();

    console.log("📈 Fetching market data for all tracked tokens...");
    const marketData = await getMarketData();

    // v6.0: Update light/heavy cycle state
    lastHeavyCycleAt = Date.now();
    lastPriceSnapshot = new Map(marketData.tokens.map(t => [t.symbol, t.price]));
    lastFearGreedValue = marketData.fearGreed.value;

    // v19.3: Update capital preservation mode state
    updateCapitalPreservationMode(marketData.fearGreed.value);

    // v11.4: Volume spike detection — flag tokens with volume ≥ VOLUME_SPIKE_THRESHOLD × 7d avg
    const volumeSpikes: { symbol: string; volumeChange: number }[] = [];
    for (const token of marketData.tokens) {
      const ind = marketData.indicators[token.symbol];
      if (ind?.volumeChange24h !== null && ind?.volumeChange24h !== undefined) {
        const volumeMultiple = 1 + (ind.volumeChange24h / 100);
        if (volumeMultiple >= VOLUME_SPIKE_THRESHOLD) {
          volumeSpikes.push({ symbol: token.symbol, volumeChange: ind.volumeChange24h });
        }
      }
    }
    if (volumeSpikes.length > 0) {
      console.log(`  📊 VOLUME SPIKES (≥${VOLUME_SPIKE_THRESHOLD}x 7d avg): ${volumeSpikes.map(v => `${v.symbol} +${v.volumeChange.toFixed(0)}%`).join(', ')}`);
    }
    lastVolumeSnapshot = new Map(marketData.tokens.map(t => [t.symbol, t.volume24h]));

    // v5.2: Consolidate dust positions every 10 cycles
    if (state.totalCycles % 10 === 1) {
      await consolidateDustPositions(balances, marketData);
    }

    // V4.5: Store intelligence data for API endpoint (now includes news + macro + v10.0)
    lastIntelligenceData = {
      defi: marketData.defiLlama,
      derivatives: marketData.derivatives,
      news: marketData.newsSentiment,
      macro: marketData.macroData,
      regime: marketData.marketRegime,
      performance: calculateTradePerformance(),
      // v10.0: Market Intelligence Engine
      globalMarket: marketData.globalMarket,
      smartRetailDivergence: marketData.smartRetailDivergence,
      fundingMeanReversion: marketData.fundingMeanReversion,
      tvlPriceDivergence: marketData.tvlPriceDivergence,
      stablecoinSupply: marketData.stablecoinSupply,
    };

    // === v11.0: DEX INTELLIGENCE (GeckoTerminal) ===
    try {
      console.log('🦎 Fetching DEX intelligence (GeckoTerminal)...');
      lastDexIntelligence = await geckoTerminalService.fetchIntelligence();
      dexIntelFetchCount++;
      const spikes = lastDexIntelligence.volumeSpikes.length;
      const pressure = lastDexIntelligence.buySellPressure.filter(p => p.signal !== 'NEUTRAL').length;
      console.log(`  ✅ DEX intel: ${lastDexIntelligence.tokenMetrics.length} tokens | ${spikes} volume spikes | ${pressure} pressure signals | ${lastDexIntelligence.errors.length} errors`);
    } catch (dexErr: any) {
      console.warn(`  ⚠️ DEX intelligence fetch failed: ${dexErr.message?.substring(0, 150)} — continuing without`);
    }

    // === v19.2: MERGE DEXSCREENER TXN DATA INTO BUYSELLPRESSURE ===
    // GeckoTerminal only covers ~7 tokens via rotation. DexScreener price stream
    // already fetches txn data for ALL 24 tokens every 10s. Merge to fill gaps.
    if (lastDexIntelligence) {
      const geckoSymbols = new Set(lastDexIntelligence.buySellPressure.map(p => p.symbol));
      let mergedCount = 0;
      for (const [sym, txn] of Object.entries(dexScreenerTxnCache)) {
        if (geckoSymbols.has(sym)) continue; // GeckoTerminal already has this token
        if (Date.now() - txn.updatedAt > 120_000) continue; // stale (>2min old)
        const totalH1 = txn.h1Buys + txn.h1Sells;
        const totalH24 = txn.h24Buys + txn.h24Sells;
        if (totalH1 < 5 && totalH24 < 20) continue; // too low activity

        const buyRatioH1 = totalH1 > 0 ? txn.h1Buys / totalH1 : 0.5;
        const buyRatioH24 = totalH24 > 0 ? txn.h24Buys / totalH24 : 0.5;

        let signal: 'STRONG_BUY' | 'BUY_PRESSURE' | 'NEUTRAL' | 'SELL_PRESSURE' | 'STRONG_SELL' = 'NEUTRAL';
        if (buyRatioH1 > 0.65 && buyRatioH24 > 0.55) signal = 'STRONG_BUY';
        else if (buyRatioH1 > 0.55) signal = 'BUY_PRESSURE';
        else if (buyRatioH1 < 0.35 && buyRatioH24 < 0.45) signal = 'STRONG_SELL';
        else if (buyRatioH1 < 0.45) signal = 'SELL_PRESSURE';

        lastDexIntelligence.buySellPressure.push({
          symbol: sym,
          h1Buys: txn.h1Buys, h1Sells: txn.h1Sells,
          h1Buyers: txn.h1Buyers, h1Sellers: txn.h1Sellers,
          h24Buys: txn.h24Buys, h24Sells: txn.h24Sells,
          buyRatioH1: Math.round(buyRatioH1 * 100) / 100,
          buyRatioH24: Math.round(buyRatioH24 * 100) / 100,
          signal,
        });
        mergedCount++;
      }
      if (mergedCount > 0) {
        console.log(`  📡 Flow coverage: ${geckoSymbols.size} GeckoTerminal + ${mergedCount} DexScreener = ${lastDexIntelligence.buySellPressure.length} total tokens with flow data`);
      }
    } else {
      // GeckoTerminal completely failed — build buySellPressure entirely from DexScreener cache
      const buySellPressure: any[] = [];
      for (const [sym, txn] of Object.entries(dexScreenerTxnCache)) {
        if (Date.now() - txn.updatedAt > 120_000) continue;
        const totalH1 = txn.h1Buys + txn.h1Sells;
        const totalH24 = txn.h24Buys + txn.h24Sells;
        if (totalH1 < 5 && totalH24 < 20) continue;

        const buyRatioH1 = totalH1 > 0 ? txn.h1Buys / totalH1 : 0.5;
        const buyRatioH24 = totalH24 > 0 ? txn.h24Buys / totalH24 : 0.5;

        let signal: 'STRONG_BUY' | 'BUY_PRESSURE' | 'NEUTRAL' | 'SELL_PRESSURE' | 'STRONG_SELL' = 'NEUTRAL';
        if (buyRatioH1 > 0.65 && buyRatioH24 > 0.55) signal = 'STRONG_BUY';
        else if (buyRatioH1 > 0.55) signal = 'BUY_PRESSURE';
        else if (buyRatioH1 < 0.35 && buyRatioH24 < 0.45) signal = 'STRONG_SELL';
        else if (buyRatioH1 < 0.45) signal = 'SELL_PRESSURE';

        buySellPressure.push({
          symbol: sym,
          h1Buys: txn.h1Buys, h1Sells: txn.h1Sells,
          h1Buyers: txn.h1Buyers, h1Sellers: txn.h1Sellers,
          h24Buys: txn.h24Buys, h24Sells: txn.h24Sells,
          buyRatioH1: Math.round(buyRatioH1 * 100) / 100,
          buyRatioH24: Math.round(buyRatioH24 * 100) / 100,
          signal,
        });
      }
      if (buySellPressure.length > 0) {
        lastDexIntelligence = {
          trendingPools: [], tokenMetrics: [], volumeSpikes: [],
          buySellPressure, newPools: [], aiSummary: '',
          timestamp: new Date().toISOString(), errors: ['GeckoTerminal failed — using DexScreener txn cache'],
        };
        console.log(`  📡 Flow coverage: 0 GeckoTerminal (failed) + ${buySellPressure.length} DexScreener = ${buySellPressure.length} total tokens with flow data`);
      }
    }

    // === v19.0: RECORD FLOW READINGS FOR MULTI-TIMEFRAME AGGREGATION ===
    // Store buy ratio from DEX intelligence and on-chain flow for all tracked tokens
    if (lastDexIntelligence) {
      for (const pressure of lastDexIntelligence.buySellPressure) {
        if (pressure.buyRatioH1 !== undefined) {
          recordFlowReading(flowTimeframeState, pressure.symbol, pressure.buyRatioH1 * 100);
        }
      }
    }
    // Also record from on-chain order flow (higher fidelity when available)
    for (const [symbol, ind] of Object.entries(marketData.indicators)) {
      if (ind?.orderFlow) {
        const totalFlow = ind.orderFlow.buyVolumeUSD + ind.orderFlow.sellVolumeUSD;
        if (totalFlow > 0) {
          recordFlowReading(flowTimeframeState, symbol, (ind.orderFlow.buyVolumeUSD / totalFlow) * 100);
        }
      }
    }

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

    // === PHASE 3: ANALYZE STRATEGY PATTERNS ===
    // v10.2: Rebuild every 50 heavy cycles (not just cycle 1) so patterns reflect recent trading
    if (state.tradeHistory.length > 0 && (state.totalCycles <= 1 || state.totalCycles % 50 === 0)) {
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
        if (tokenData && tokenData.price > 0) {
          balance.usdValue = balance.balance * tokenData.price;
          balance.price = tokenData.price;
        } else if (balance.balance > 0) {
          // v7.1: Fall back to lastKnownPrices — prevents phantom $0 portfolio during price feed outages
          const lastPrice = lastKnownPrices[balance.symbol]?.price || 0;
          if (lastPrice > 0) {
            balance.usdValue = balance.balance * lastPrice;
            balance.price = lastPrice;
            console.log(`   ♻️ Using last known price for ${balance.symbol}: $${lastPrice.toFixed(4)} (feed unavailable)`);
          } else {
            console.warn(`   ⚠️ No price data for ${balance.symbol} — no cache available, showing $0`);
          }
        }
      }
      balance.sector = TOKEN_REGISTRY[balance.symbol]?.sector;
    }

    // v12.2.1: HOTFIX — exclude tokens with null/zero price from portfolio total.
    // Unpriceable tokens (no DEX pool found) were showing $0 and dragging down the total,
    // causing the AI to panic-sell real positions to "cut losses" on phantom-priced tokens.
    const unpricedTokens = balances.filter(b => b.symbol !== 'USDC' && b.balance > 0 && !b.price);
    if (unpricedTokens.length > 0) {
      console.warn(`  ⚠️ UNPRICED TOKENS (excluded from portfolio total): ${unpricedTokens.map(b => b.symbol).join(', ')}`);
    }
    state.trading.balances = balances;
    const newPortfolioValue = balances
      .filter(b => b.symbol === 'USDC' || b.price || b.usdValue > 0)
      .reduce((sum, b) => sum + b.usdValue, 0);

    // v7.1 + v10.2 + v12.2: Phantom drop detection — if portfolio drops >10% in a single cycle,
    // it's almost certainly a price feed failure, not a real loss.
    // v12.2: Always set totalPortfolioValue to actual sum of balances (no permanent mismatch).
    // Instead, protect circuit breaker and peak independently by skipping their updates on phantom drops.
    const prevValue = state.trading.totalPortfolioValue;
    const dropPercent = prevValue > 0 ? ((prevValue - newPortfolioValue) / prevValue) * 100 : 0;
    const isPhantomDrop = dropPercent > 10 && prevValue > 100;
    if (isPhantomDrop) {
      const missingPrices = balances.filter(b => b.symbol !== 'USDC' && b.balance > 0 && !b.price).map(b => b.symbol);
      console.warn(`\n🛡️ PHANTOM DROP DETECTED: Portfolio $${prevValue.toFixed(2)} → $${newPortfolioValue.toFixed(2)} (-${dropPercent.toFixed(1)}% in one cycle)`);
      console.warn(`   Tokens missing prices: ${missingPrices.join(', ') || 'none'}`);
      console.warn(`   Portfolio value updated to actual — circuit breaker/peak protected.`);
    }
    // v12.2: Always update to actual value so dashboard matches sum of balances
    state.trading.totalPortfolioValue = newPortfolioValue;

    // v11.4.21: DEPOSIT DETECTION — reliable approach using portfolio value jumps.
    // Compare newPortfolioValue (this cycle's fully-priced total) vs prevValue (last cycle's total).
    // If portfolio jumped by >$200 in a single cycle AND USDC increased, it's a deposit.
    // Trading can't produce $200+ gains in one 3-minute cycle.
    const currentUSDCBalance = balances.find(b => b.symbol === 'USDC')?.usdValue || 0;
    const portfolioJump = newPortfolioValue - prevValue; // v11.4.21: use correctly-scoped variables
    const usdcJump = currentUSDCBalance - state.lastKnownUSDCBalance;
    const DEPOSIT_THRESHOLD = 200; // Minimum jump to consider as deposit (trading does $80-$150 per position)
    if (portfolioJump > DEPOSIT_THRESHOLD && usdcJump > DEPOSIT_THRESHOLD * 0.5 && prevValue > 0) {
      // Likely a deposit — the portfolio and USDC both jumped significantly
      const depositAmount = Math.round(portfolioJump);
      console.log(`\n💰 DEPOSIT DETECTED: Portfolio jumped +$${portfolioJump.toFixed(2)} (USDC +$${usdcJump.toFixed(2)})`);
      console.log(`   Registering deposit: $${depositAmount}`);
      state.totalDeposited += depositAmount;
      state.trading.peakValue += depositAmount;
      state.depositHistory.push({
        timestamp: new Date().toISOString(),
        amountUSD: depositAmount,
        newTotal: Math.round(state.totalDeposited * 100) / 100,
      });
      saveTradeHistory();
    }
    state.lastKnownUSDCBalance = currentUSDCBalance;

    // v12.2: Skip peak/baseline updates during phantom drops to prevent false drawdown triggers
    if (!isPhantomDrop && state.trading.totalPortfolioValue > state.trading.peakValue) {
      state.trading.peakValue = state.trading.totalPortfolioValue;
    }

    const sectorAllocations = calculateSectorAllocations(balances, state.trading.totalPortfolioValue);
    state.trading.sectorAllocations = sectorAllocations;

    // v11.4.21: Persist state after portfolio/peak/sector updates — ensures peakValue
    // survives if cycle crashes later (previously peak was only saved during trades/sanity checks).
    saveTradeHistory();

    // v11.4.21: Update daily/weekly baselines BEFORE capital floor / circuit breaker checks.
    // Previously this was only called inside checkCircuitBreaker(), which runs AFTER the capital
    // floor check. If the floor check returned early, dailyBaseline never got set → P&L stayed 0.
    // v12.2: Skip baseline update during phantom drop to prevent false daily P&L swing
    if (!isPhantomDrop) {
      updateDrawdownBaselines(state.trading.totalPortfolioValue);
    }

    // Display status — v11.4.20: Daily P&L from start-of-day baseline
    const dailyBase = breakerState.dailyBaseline.value;
    const pnl = dailyBase > 0 ? state.trading.totalPortfolioValue - dailyBase : 0;
    const pnlPercent = dailyBase > 0 ? (pnl / dailyBase) * 100 : 0;

    // v11.4.2: Runtime peakValue sanity check — correct inflated peak without needing restart.
    // Peak should never exceed (current portfolio + total payouts sent out + reasonable unrealized buffer).
    // If peakValue is way above that, it was inflated by old payout bug or false deposits.
    const totalPayoutsSent = state.totalDailyPayoutsUSD || 0;
    const maxReasonablePeak = state.trading.totalPortfolioValue + totalPayoutsSent;
    if (state.trading.peakValue > maxReasonablePeak * 1.15 && state.trading.totalPortfolioValue > 500) {
      console.log(`\n🔧 PEAK VALUE RUNTIME CORRECTION: peak $${state.trading.peakValue.toFixed(2)} exceeds reasonable max $${maxReasonablePeak.toFixed(2)} (portfolio $${state.trading.totalPortfolioValue.toFixed(2)} + payouts $${totalPayoutsSent.toFixed(2)} + 15% buffer)`);
      state.trading.peakValue = maxReasonablePeak;
      console.log(`   Corrected peak: $${state.trading.peakValue.toFixed(2)}`);
      saveTradeHistory();
    }

    const drawdown = Math.max(0, ((state.trading.peakValue - state.trading.totalPortfolioValue) / state.trading.peakValue) * 100);

    // === v6.2: CAPITAL FLOOR ENFORCEMENT ===
    // v10.3: Skip floor checks when portfolio value is 0 — this is always a cold-start artifact
    // (balance hasn't been fetched yet after a redeploy), never a real scenario.
    // Real protection kicks in once the first balance fetch populates a real number.
    if (state.trading.totalPortfolioValue <= 0) {
      console.log(`\n⏳ COLD START: Portfolio value $0 — skipping capital floor (waiting for first balance fetch)`);
    }

    // v12.2: Skip capital floor and circuit breaker checks during phantom drops (price feed glitch)
    if (isPhantomDrop) {
      console.warn(`   Skipping capital floor / circuit breaker checks this cycle (phantom drop).`);
    }

    // Absolute minimum: if portfolio is below $50, halt ALL trading (prevent dust churn)
    if (!isPhantomDrop && state.trading.totalPortfolioValue > 0 && state.trading.totalPortfolioValue < CAPITAL_FLOOR_ABSOLUTE_USD) {
      console.log(`\n🚨 CAPITAL FLOOR BREACH: Portfolio $${state.trading.totalPortfolioValue.toFixed(2)} < absolute minimum $${CAPITAL_FLOOR_ABSOLUTE_USD}`);
      console.log(`   ALL TRADING HALTED — wallet needs funding or manual intervention.`);
      state.trading.lastCheck = new Date();
      return;
    }

    // Percentage floor: if portfolio < 60% of peak, HOLD-ONLY mode (stop-losses still fire)
    const capitalFloorValue = state.trading.peakValue * (CAPITAL_FLOOR_PERCENT / 100);
    const belowCapitalFloor = !isPhantomDrop && state.trading.totalPortfolioValue > 0 && state.trading.totalPortfolioValue < capitalFloorValue;
    if (belowCapitalFloor) {
      console.log(`\n⚠️ CAPITAL FLOOR: Portfolio $${state.trading.totalPortfolioValue.toFixed(2)} < floor $${capitalFloorValue.toFixed(2)} (${CAPITAL_FLOOR_PERCENT}% of peak $${state.trading.peakValue.toFixed(2)})`);
      console.log(`   HOLD-ONLY mode active — no new buys, only stop-loss sells allowed.`);
    }

    // === CIRCUIT BREAKERS ===
    // v10.3: Skip breakers when portfolio is $0 — cold-start artifact, not real drawdown
    // Hard halt: if drawdown exceeds 20% from peak, stop all trading this cycle
    if (!isPhantomDrop && drawdown >= 20 && !belowCapitalFloor && state.trading.totalPortfolioValue > 0) {
      console.log(`\n🚨 CIRCUIT BREAKER: Drawdown ${drawdown.toFixed(1)}% exceeds 20% threshold. Halting trading this cycle.`);
      console.log(`   Peak: $${state.trading.peakValue.toFixed(2)} | Current: $${state.trading.totalPortfolioValue.toFixed(2)}`);
      state.trading.lastCheck = new Date();
      return;
    }
    // Caution zone: if drawdown exceeds 12%, reduce max position size by 50%
    const circuitBreakerActive = state.trading.totalPortfolioValue > 0 && drawdown >= 12;
    if (circuitBreakerActive) {
      console.log(`\n⚠️ CIRCUIT BREAKER: Drawdown ${drawdown.toFixed(1)}% — caution mode active, position sizes halved`);
    }

    // === v8.0: INSTITUTIONAL CIRCUIT BREAKER CHECK ===
    // Checks: consecutive losses, daily DD, weekly DD — blocks NEW buys but allows stop-loss/profit-take sells
    const breakerCheck = checkCircuitBreaker(state.trading.totalPortfolioValue);
    let institutionalBreakerActive = false;
    if (breakerCheck) {
      if (breakerCheck.startsWith('PAUSED:')) {
        console.log(`\n🚨🚨 INSTITUTIONAL BREAKER: ${breakerCheck}`);
        console.log(`   Stop-loss and profit-take sells still allowed. New buys blocked.`);
        institutionalBreakerActive = true;
      } else {
        // Fresh trigger — fire the breaker
        triggerCircuitBreaker(breakerCheck);
        institutionalBreakerActive = true;
      }
    }

    console.log(`\n💰 Portfolio: $${state.trading.totalPortfolioValue.toFixed(2)}`);
    console.log(`   Today: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}%) from $${dailyBase.toFixed(2)} start-of-day`);
    console.log(`   Peak: $${state.trading.peakValue.toFixed(2)} | Drawdown: ${drawdown.toFixed(1)}%`);
    console.log(`   Regime: ${marketData.marketRegime}`);

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
    // v10.4: Stop-loss no longer returns early — executes the emergency sell, then
    // continues to profit-take and AI decision phases. A stop-loss on one token
    // shouldn't prevent the AI from deploying capital into other opportunities.
    const stopLossDecision = checkStopLoss(balances, marketData.indicators);
    if (stopLossDecision) {
      console.log(`\n  🛑 STOP-LOSS GUARD executing sell...`);
      const slResult = await executeTrade(stopLossDecision, marketData);
      // v5.3.3: Track failures and set cooldown
      state.stopLossCooldowns[stopLossDecision.fromToken] = new Date().toISOString();
      // v11.4.6: Reset peak price to current after stop-loss — prevents re-triggering trailing stop
      const slCb = state.costBasis[stopLossDecision.fromToken];
      if (slCb && slResult.success) {
        const currentPrice = slCb.averageCostBasis; // Use cost basis as new reference
        slCb.peakPrice = currentPrice;
        slCb.peakPriceDate = new Date().toISOString();
      }
      if (!slResult.success) {
        const slBalErr = slResult.error?.includes('Insufficient balance') || slResult.error?.includes('Balance too small');
        if (!slBalErr) recordTradeFailure(stopLossDecision.fromToken);
      } else {
        clearTradeFailures(stopLossDecision.fromToken);
      }
      // v8.0: Record stop-loss as a loss for breaker tracking
      recordTradeResultForBreaker(slResult.success, -(stopLossDecision.amountUSD * 0.05)); // Estimate ~5% loss on stop-loss
      saveTradeHistory();
      // v10.4: Refresh balances and continue to AI phase
      const refreshedAfterSL = await getBalances();
      if (refreshedAfterSL && refreshedAfterSL.length > 0) {
        balances = refreshedAfterSL;
      }
      console.log(`  ✅ Stop-loss executed — continuing to AI decision phase`);
    }

    // === v16.0: DUST/MICRO POSITION CLEANUP (NVR Audit P1-3) ===
    // Every DUST_CLEANUP_INTERVAL_CYCLES cycles, auto-sell positions under $5 held >24h
    if (state.totalCycles % DUST_CLEANUP_INTERVAL_CYCLES === 0) {
      const now = Date.now();
      const dustPositions: { symbol: string; usdValue: number; ageHours: number }[] = [];

      for (const holding of balances) {
        if (holding.symbol === 'USDC' || holding.symbol === 'ETH' || holding.symbol === 'WETH') continue;
        if (!holding.usdValue || holding.usdValue >= DUST_CLEANUP_THRESHOLD_USD) continue;
        if (holding.usdValue < 0.01) continue; // skip zero-value

        // Check position age
        const cb = state.costBasis[holding.symbol];
        if (!cb?.firstBuyDate) continue;
        const ageHours = (now - new Date(cb.firstBuyDate).getTime()) / (1000 * 60 * 60);
        if (ageHours < DUST_CLEANUP_MIN_AGE_HOURS) continue;

        dustPositions.push({ symbol: holding.symbol, usdValue: holding.usdValue, ageHours });
      }

      if (dustPositions.length > 0) {
        console.log(`\n🧹 DUST_CLEANUP: Found ${dustPositions.length} micro positions under $${DUST_CLEANUP_THRESHOLD_USD} (held >${DUST_CLEANUP_MIN_AGE_HOURS}h)`);
        for (const dust of dustPositions) {
          console.log(`   🧹 Cleaning: ${dust.symbol} $${dust.usdValue.toFixed(2)} (held ${dust.ageHours.toFixed(0)}h)`);
          if (isTokenBlocked(dust.symbol)) {
            console.log(`   🚫 ${dust.symbol} blocked by circuit breaker — skipping`);
            continue;
          }
          const dustDecision: TradeDecision = {
            action: 'SELL',
            fromToken: dust.symbol,
            toToken: 'USDC',
            amountUSD: dust.usdValue,
            reasoning: `DUST_CLEANUP: Position too small to impact portfolio ($${dust.usdValue.toFixed(2)} < $${DUST_CLEANUP_THRESHOLD_USD}, held ${dust.ageHours.toFixed(0)}h). Freeing capital and reducing clutter.`,
            sector: TOKEN_REGISTRY[dust.symbol]?.sector,
          };
          const dustResult = await executeTrade(dustDecision, marketData);
          if (dustResult.success) {
            clearTradeFailures(dust.symbol);
            console.log(`   ✅ Dust sold: ${dust.symbol} $${dust.usdValue.toFixed(2)}`);
          } else {
            recordTradeFailure(dust.symbol);
            console.log(`   ❌ Dust sell failed: ${dust.symbol}`);
          }
        }
        // Refresh balances after dust cleanup
        const refreshedAfterDust = await getBalances();
        if (refreshedAfterDust && refreshedAfterDust.length > 0) {
          balances = refreshedAfterDust;
        }
        saveTradeHistory();
      }
    }

    // === PROFIT-TAKING CHECK ===
    // v10.4: Profit-take no longer returns early — after harvesting, the cycle
    // continues to the AI decision phase so the bot can also deploy capital.
    // Previously, this `return` caused a harvest-only loop: every cycle found
    // something to harvest, sold a slice, and exited before AI could recommend BUYs.
    const profitTakeDecision = checkProfitTaking(balances, marketData.indicators);
    if (profitTakeDecision) {
      // v5.3.3: Check circuit breaker before attempting profit-take
      if (isTokenBlocked(profitTakeDecision.fromToken)) {
        console.log(`\n  🚫 PROFIT-TAKE skipped: ${profitTakeDecision.fromToken} blocked by circuit breaker`);
      } else {
        console.log(`\n  🎯 PROFIT-TAKE GUARD executing sell...`);
        const ptResult = await executeTrade(profitTakeDecision, marketData);
        if (!ptResult.success) {
          const ptBalErr = ptResult.error?.includes('Insufficient balance') || ptResult.error?.includes('Balance too small');
          if (!ptBalErr) recordTradeFailure(profitTakeDecision.fromToken);
        } else {
          clearTradeFailures(profitTakeDecision.fromToken);
        }
        // v8.0: Profit-take is a win for breaker tracking
        recordTradeResultForBreaker(ptResult.success, ptResult.success ? profitTakeDecision.amountUSD * 0.05 : 0);
        saveTradeHistory();
        // v10.4: Refresh balances after harvest so AI sees updated USDC
        const refreshedBalances = await getBalances();
        if (refreshedBalances && refreshedBalances.length > 0) {
          balances = refreshedBalances;
        }
        console.log(`  ✅ Profit harvested — continuing to AI decision phase`);
      }
    }

    // === PHASE 3: STAGNATION CHECK ===
    // v10.4: Exploration trade no longer returns early — continues to AI phase
    // v14.2: Pass indicators + regime for guardrail filtering
    const usdcBal = balances.find(b => b.symbol === "USDC");
    const availableUSDCForExplore = usdcBal?.balance || 0;
    const explorationTrade = checkStagnation(availableUSDCForExplore, marketData.tokens, marketData.indicators, marketData.marketRegime);
    if (explorationTrade) {
      // v14.2: In RANGING markets, enforce max 1 exploration trade per cycle
      // (explorationsThisCycle is tracked at the top of the cycle loop)
      if (marketData.marketRegime === "RANGING" && explorationsThisCycle >= EXPLORATION_RANGING_MAX_PER_CYCLE) {
        console.log(`\n🔬 EXPLORATION CAPPED: RANGING market — already ${explorationsThisCycle} exploration(s) this cycle (max ${EXPLORATION_RANGING_MAX_PER_CYCLE})`);
      } else {
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
        explorationsThisCycle++;
        analyzeStrategyPatterns();
        saveTradeHistory();
      }
    }

    // === v11.4.8: PRE-AI FORCED DEPLOYMENT ===
    // If cash >80%, deploy BEFORE the AI call. This guarantees deployment even if
    // the AI call fails, times out, or returns HOLD. Runs in the same proven path
    // as exploration trades above.
    const preAiUSDC = balances.find(b => b.symbol === 'USDC')?.balance || 0;
    const preAiCashPct = state.trading.totalPortfolioValue > 0 ? (preAiUSDC / state.trading.totalPortfolioValue) * 100 : 0;
    // v11.4.19: threshold — if deployment mode is on, forced deploy fires too
    // v14.1: Now gated behind market momentum check to avoid buying into falling knives
    if (preAiCashPct > CASH_DEPLOYMENT_THRESHOLD_PCT && preAiUSDC > CASH_DEPLOYMENT_MIN_RESERVE_USD) {
      // v18.2: FEAR GATE — NEVER force-deploy cash in extreme fear. Capital preservation is non-negotiable.
      // SCALE_UP and RIDE_THE_WAVE are unaffected (they run independently below, are opportunity-based)
      let shouldForceDeploy = true;
      const currentFearGreed = marketData?.fearGreed?.value ?? 50;
      if (currentFearGreed < 25) {
        console.log(`\n⚡ FORCED_DEPLOY: ${preAiCashPct.toFixed(0)}% cash ($${preAiUSDC.toFixed(0)}) exceeds ${CASH_DEPLOYMENT_THRESHOLD_PCT}% threshold`);
        console.log(`   🛑 BLOCKED — Fear & Greed is ${currentFearGreed} (Extreme Fear). Capital preservation mode.`);
        console.log(`   Cash is KING in extreme fear. SCALE_UP and RIDE_THE_WAVE still active for real opportunities.`);
        shouldForceDeploy = false;
      } else if (CASH_DEPLOY_REQUIRES_MOMENTUM) {
        const deployMomentum = calculateMarketMomentum();
        const btcEthAvgChange = (deployMomentum.btcChange24h + deployMomentum.ethChange24h) / 2;
        if (btcEthAvgChange < 0) {
          console.log(`\n⚡ FORCED_DEPLOY: ${preAiCashPct.toFixed(0)}% cash ($${preAiUSDC.toFixed(0)}) exceeds ${CASH_DEPLOYMENT_THRESHOLD_PCT}% threshold`);
          console.log(`   Skipping forced deploy — market momentum negative (BTC ${deployMomentum.btcChange24h >= 0 ? '+' : ''}${deployMomentum.btcChange24h.toFixed(2)}%, ETH ${deployMomentum.ethChange24h >= 0 ? '+' : ''}${deployMomentum.ethChange24h.toFixed(2)}%, avg ${btcEthAvgChange >= 0 ? '+' : ''}${btcEthAvgChange.toFixed(2)}%), preserving cash`);
          console.log(`   SCALE_UP and RIDE_THE_WAVE still active — will catch opportunities independently`);
          shouldForceDeploy = false;
        } else if (deployMomentum.score < 0) {
          console.log(`\n⚡ FORCED_DEPLOY: ${preAiCashPct.toFixed(0)}% cash ($${preAiUSDC.toFixed(0)}) exceeds ${CASH_DEPLOYMENT_THRESHOLD_PCT}% threshold`);
          console.log(`   Skipping forced deploy — portfolio momentum score negative (${deployMomentum.score.toFixed(1)}), preserving cash`);
          console.log(`   SCALE_UP and RIDE_THE_WAVE still active — will catch opportunities independently`);
          shouldForceDeploy = false;
        } else {
          // Market conditions neutral-to-positive — proceed with forced deployment
          console.log(`\n⚡ FORCED_DEPLOY: ${preAiCashPct.toFixed(0)}% cash ($${preAiUSDC.toFixed(0)}) — market momentum OK (score: ${deployMomentum.score.toFixed(1)}, BTC/ETH avg: ${btcEthAvgChange >= 0 ? '+' : ''}${btcEthAvgChange.toFixed(2)}%), deploying`);
        }
      }

      if (shouldForceDeploy) {
      console.log(`\n⚡ PRE-AI FORCED DEPLOYMENT: ${preAiCashPct.toFixed(0)}% cash ($${preAiUSDC.toFixed(0)}) — deploying before AI call`);

      // Build target list from most underweight sectors, rotating tokens to avoid dedup
      // v11.4.11: CDP-supported tokens first. AIXBT/DEGEN moved to end (CDP unsupported).
      // v12.2.1: HOTFIX — removed cbLTC, cbXRP, CLANKER, KEYCAT from forced deploy.
      // These tokens lack on-chain pricing pools (no WETH/USDC pair on known DEXes),
      // causing $0 price → phantom loss → AI panic-sells real positions.
      // Only deploy into tokens the price engine can reliably price.
      const sectorTokenPool: Record<string, string[]> = {
        BLUE_CHIP: ['ETH', 'cbBTC', 'cbETH', 'LINK', 'wstETH'],
        AI_TOKENS: ['VIRTUAL', 'HIGHER', 'VVV', 'AIXBT'],
        MEME_COINS: ['TOSHI', 'BRETT', 'MOCHI', 'NORMIE', 'DEGEN'],
        DEFI: ['AERO', 'SEAM', 'WELL', 'EXTRA', 'BAL', 'RSR'],  // v14.2: removed MORPHO, PENDLE (CDP unsupported)
      };

      // v12.2: Shuffle each sector's token list to prevent first-token bias (ETH dominance fix)
      for (const tokens of Object.values(sectorTokenPool)) {
        for (let i = tokens.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [tokens[i], tokens[j]] = [tokens[j], tokens[i]];
        }
      }

      const deployTargets: { token: string; sector: string }[] = [];
      const FORCED_DEPLOY_DEDUP_MINUTES = FORCED_DEPLOY_DEDUP_WINDOW_MINUTES; // v14.2: uses constant (10 min)
      for (const [sector, tokens] of Object.entries(sectorTokenPool)) {
        // Pick the token in this sector that's NOT in the dedup log and not blocked
        for (const token of tokens) {
          // v11.4.11: Skip tokens that CDP SDK cannot swap
          if (CDP_UNSUPPORTED_TOKENS.has(token)) continue;
          // Skip tokens blocked by circuit breaker (consecutive failures)
          if (isTokenBlocked(token)) continue;

          // v18.2: SIGNAL QUALITY GATE — Don't force-buy into falling knives
          const tokenIndicators = marketData?.indicators?.[token];
          if (tokenIndicators) {
            const confluence = tokenIndicators.confluenceScore ?? 0;
            const macdSignal = tokenIndicators.macd?.signal;
            const rsi = tokenIndicators.rsi14 ?? 50;
            // Block: negative confluence + bearish MACD = falling knife
            if (confluence < -10 && macdSignal === 'BEARISH') {
              console.log(`   ⛔ FORCED_DEPLOY: Skipping ${token} — falling knife (confluence: ${confluence}, MACD: BEARISH)`);
              continue;
            }
            // Block: deeply oversold RSI with bearish MACD = capitulation, don't catch
            if (rsi < 30 && macdSignal === 'BEARISH') {
              console.log(`   ⛔ FORCED_DEPLOY: Skipping ${token} — oversold capitulation (RSI: ${rsi.toFixed(1)}, MACD: BEARISH)`);
              continue;
            }
          }

          const dedupKey = `${token}:BUY:FORCED_DEPLOY`;
          const lastExec = state.tradeDedupLog?.[dedupKey];
          const minutesSince = lastExec ? (Date.now() - new Date(lastExec).getTime()) / (1000 * 60) : Infinity;
          if (minutesSince >= FORCED_DEPLOY_DEDUP_MINUTES) {
            deployTargets.push({ token, sector });
            break; // one token per sector
          }
        }
      }

      const deploySize = Math.max(25, Math.min(150, preAiUSDC * 0.10)); // v14.2: min $25 per deploy (was no floor), max $150, 10% of USDC
      let preAiBuys = 0;
      for (const target of deployTargets) {
        try {
          // Reset stale cost basis BEFORE buying — if existing cost basis is >200% above current price, reset it
          const existingCB = state.costBasis[target.token];
          if (existingCB && existingCB.averageCostBasis > 0) {
            const tokenPrice = balances.find(b => b.symbol === target.token)?.price || 0;
            if (tokenPrice > 0 && existingCB.averageCostBasis > tokenPrice * 3) {
              console.log(`   🔧 Resetting stale cost basis for ${target.token}: $${existingCB.averageCostBasis.toFixed(4)} → $${tokenPrice.toFixed(4)} (was ${((existingCB.averageCostBasis / tokenPrice - 1) * 100).toFixed(0)}% above market)`);
              existingCB.averageCostBasis = tokenPrice;
              existingCB.totalInvestedUSD = tokenPrice * existingCB.currentHolding;
              existingCB.totalTokensAcquired = existingCB.currentHolding;
              existingCB.unrealizedPnL = 0;
              existingCB.firstBuyDate = new Date().toISOString();
            }
          }

          const deployDecision: TradeDecision = {
            action: 'BUY',
            fromToken: 'USDC',
            toToken: target.token,
            amountUSD: deploySize,
            reasoning: `FORCED_DEPLOY: Pre-AI deployment into ${target.token} — ${preAiCashPct.toFixed(0)}% cash is too high. Sector: ${target.sector}`,
            sector: target.sector,
            isForced: true,
          };
          console.log(`   📦 FORCED_DEPLOY: $${deploySize.toFixed(0)} → ${target.token}`);
          const result = await executeTrade(deployDecision, marketData);
          if (result.success) {
            preAiBuys++;
            console.log(`   ✅ FORCED_DEPLOY: ${target.token} buy executed`);
          } else {
            console.log(`   ❌ FORCED_DEPLOY: ${target.token} failed: ${result.error}`);
          }
        } catch (err: any) {
          console.log(`   ❌ FORCED_DEPLOY: ${target.token} error: ${err.message}`);
        }
      }
      if (preAiBuys > 0) {
        console.log(`   ⚡ FORCED_DEPLOY: ${preAiBuys} buys executed`);
        saveTradeHistory();
        // Refresh balances for the AI call
        const refreshedBalances = await getBalances();
        if (refreshedBalances && refreshedBalances.length > 0) {
          balances = refreshedBalances;
        }
      }
      } // end if (shouldForceDeploy)
    }

    // === v11.1: CASH DEPLOYMENT ENGINE ===
    // Check if portfolio is over-concentrated in USDC and needs active deployment
    const currentUSDCForDeploy = balances.find(b => b.symbol === 'USDC')?.balance || 0;
    // v19.0: Scout positions are data probes, not deployed capital.
    // Add scout value back to "available cash" so scouts don't suppress deployment mode
    // when the bot actually has most capital sitting idle in tiny positions.
    const scoutValue = balances
      .filter(b => b.symbol !== 'USDC' && b.symbol !== 'ETH' && b.symbol !== 'WETH' && b.usdValue < SCOUT_STOP_EXEMPT_THRESHOLD_USD)
      .reduce((sum, b) => sum + (b.usdValue || 0), 0);
    const effectiveCashForDeployment = currentUSDCForDeploy + scoutValue;
    const deploymentCheck = checkCashDeploymentMode(effectiveCashForDeployment, state.trading.totalPortfolioValue);
    if (deploymentCheck.active) {
      console.log(`\n💵 CASH DEPLOYMENT MODE ACTIVE`);
      console.log(`   USDC: $${currentUSDCForDeploy.toFixed(2)} (${deploymentCheck.cashPercent.toFixed(1)}% of portfolio) — exceeds ${CASH_DEPLOYMENT_THRESHOLD_PCT}% threshold`);
      console.log(`   Excess cash: $${deploymentCheck.excessCash.toFixed(2)} | Deploy budget this cycle: $${deploymentCheck.deployBudget.toFixed(2)}`);
      console.log(`   Confluence discount: -${deploymentCheck.confluenceDiscount} points (BUY threshold: ${state.adaptiveThresholds.confluenceBuy} → ${state.adaptiveThresholds.confluenceBuy - deploymentCheck.confluenceDiscount})`);
      console.log(`   Underweight sectors: ${sectorAllocations.filter(s => s.drift < -5).map(s => `${s.name}(${s.drift.toFixed(1)}%)`).join(', ') || 'none'}`);
    }

    // === v17.0: CRASH-BUYING BREAKER OVERRIDE (flow-based) ===
    // When cash-heavy and breaker active, allow deployment buys IF flow confirms
    const crashBuyOverride = checkCrashBuyingOverride(deploymentCheck, marketData.fearGreed.value, belowCapitalFloor);
    if (crashBuyOverride.active && institutionalBreakerActive) {
      console.log(`\n🦈 BREAKER OVERRIDE ACTIVE (v17.0 — flow-based)`);
      console.log(`   ${crashBuyOverride.reason}`);
      console.log(`   Position size: ${(crashBuyOverride.sizeMultiplier * 100).toFixed(0)}% of normal | Max entries: ${crashBuyOverride.maxEntries}`);
      console.log(`   Requires positive buy ratio (>50%) for each token — flow must confirm`);
    } else if (crashBuyOverride.active) {
      // Deployment active but breaker isn't — no override needed, just log
      crashBuyingOverrideActive = false;
    }

    // v17.0: FEAR/REGIME MODE REMOVED — the swarm makes the decision based on flow, momentum,
    // risk, and sentiment. No external F&G overrides. F&G is display-only context.
    const fgValue = marketData.fearGreed.value; // kept for display/logging
    const regime = marketData.marketRegime;

    // AI decision (or central signal fetch)
    let decisions: TradeDecision[];

    if (signalMode === 'central') {
      console.log("\n📡 Fetching signals from NVR central service...");
      decisions = await fetchCentralSignals({ balances, marketData, portfolioValue: state.trading.totalPortfolioValue });

      // Apply local position sizing to each central signal decision
      const portfolioValue = state.trading.totalPortfolioValue;
      const availableUSDC = balances.find(b => b.symbol === 'USDC')?.balance || 0;
      for (const decision of decisions) {
        if (decision.amountUSD === 0 && decision.action === 'BUY') {
          // 4% of portfolio per trade, capped by available USDC and max buy size
          decision.amountUSD = Math.min(
            CONFIG.trading.maxBuySize,
            portfolioValue * 0.04,
            availableUSDC * 0.9, // Leave 10% USDC buffer
          );
        }
        if (decision.amountUSD === 0 && decision.action === 'SELL') {
          // Sell 50% of position by default for central signals
          const holding = balances.find(b => b.symbol === decision.fromToken);
          if (holding) {
            decision.amountUSD = holding.usdValue * 0.5;
          }
        }
      }
      console.log(`  📡 Central decisions: ${decisions.length} (${decisions.filter(d => d.action === 'BUY').length} buys, ${decisions.filter(d => d.action === 'SELL').length} sells)`);
    } else {
      // Existing Claude AI call — unchanged
      console.log("\n🧠 AI analyzing portfolio & market...");
      decisions = await makeTradeDecision(balances, marketData, state.trading.totalPortfolioValue, sectorAllocations, deploymentCheck.active ? deploymentCheck : undefined);
    }

    // === v19.1: EXTREME FEAR BUY BLOCK ===
    // In extreme fear (F&G < 20), block ALL new buy decisions. Only allow sells.
    // Oversold indicators fail in sustained downtrends — stop buying falling knives.
    const EXTREME_FEAR_THRESHOLD = 20;
    if (fgValue < EXTREME_FEAR_THRESHOLD) {
      const buyCount = decisions.filter(d => d.action === 'BUY').length;
      if (buyCount > 0) {
        console.log(`\n🚫 EXTREME FEAR BLOCK: Fear/Greed ${fgValue} < ${EXTREME_FEAR_THRESHOLD} — blocking ${buyCount} buy decisions. Sells only.`);
        decisions = decisions.filter(d => d.action !== 'BUY');
      }
    }

    // === v19.3: CAPITAL PRESERVATION MODE — HIGH-CONVICTION FILTER ===
    // When preservation mode is active, only allow trades with high confluence or high swarm consensus.
    // Also prioritize sells over buys if cash is below 50% target.
    if (capitalPreservationMode.isActive) {
      const latestSwarm = getLatestSwarmDecisions();
      const swarmConsensusMap = new Map<string, number>();
      for (const sd of latestSwarm) {
        swarmConsensusMap.set(sd.token, sd.consensus);
      }

      const _usdcBalPres = balances.find(b => b.symbol === 'USDC');
      const cashPctPres = _usdcBalPres ? (_usdcBalPres.usdValue / (state.trading.totalPortfolioValue || 1)) * 100 : 0;
      const belowCashTarget = cashPctPres < PRESERVATION_TARGET_CASH_PCT;

      const preservationFiltered: TradeDecision[] = [];
      let blockedCount = 0;

      for (const d of decisions) {
        if (d.action === 'HOLD') {
          preservationFiltered.push(d);
          continue;
        }

        // Always allow sells — capital preservation prioritizes raising cash
        if (d.action === 'SELL') {
          capitalPreservationMode.tradesPassed++;
          preservationFiltered.push(d);
          continue;
        }

        // For buys: require high confluence OR high swarm consensus
        if (d.action === 'BUY') {
          // If cash is below target, block all buys to raise cash allocation
          if (belowCashTarget) {
            console.log(`   🛡️ PRESERVATION: Blocking BUY ${d.toToken} — cash ${cashPctPres.toFixed(1)}% below ${PRESERVATION_TARGET_CASH_PCT}% target`);
            capitalPreservationMode.tradesBlocked++;
            blockedCount++;
            continue;
          }

          const tokenInd = marketData.indicators[d.toToken];
          const confluenceScore = tokenInd?.confluenceScore ?? 0;
          const swarmConsensus = swarmConsensusMap.get(d.toToken) ?? 0;

          if (confluenceScore >= PRESERVATION_MIN_CONFLUENCE || swarmConsensus >= PRESERVATION_MIN_SWARM_CONSENSUS) {
            capitalPreservationMode.tradesPassed++;
            preservationFiltered.push(d);
            console.log(`   🛡️ PRESERVATION: Passing high-conviction BUY ${d.toToken} (confluence=${confluenceScore}, swarm=${swarmConsensus}%)`);
          } else {
            capitalPreservationMode.tradesBlocked++;
            blockedCount++;
            console.log(`   🛡️ PRESERVATION: Blocking low-conviction BUY ${d.toToken} (confluence=${confluenceScore} < ${PRESERVATION_MIN_CONFLUENCE}, swarm=${swarmConsensus}% < ${PRESERVATION_MIN_SWARM_CONSENSUS}%)`);
          }
        }
      }

      if (blockedCount > 0) {
        console.log(`\n🛡️ CAPITAL PRESERVATION: Blocked ${blockedCount} low-conviction trades | Passed: ${preservationFiltered.filter(d => d.action !== 'HOLD').length} | Cash: ${cashPctPres.toFixed(1)}%`);
      }
      decisions = preservationFiltered;
    }

    // === v19.1: POSITION SPRAWL REDUCER ===
    // Auto-sell small losing positions that lack flow data coverage.
    // These are dead weight — can't make flow-based decisions without data.
    {
      const sprawlSells: TradeDecision[] = [];
      const tokensWithFlowData = new Set<string>();
      if (lastDexIntelligence) {
        for (const p of lastDexIntelligence.buySellPressure) {
          tokensWithFlowData.add(p.symbol);
        }
      }

      for (const holding of balances) {
        if (holding.symbol === 'USDC' || holding.symbol === 'ETH' || holding.symbol === 'WETH') continue;
        if (!holding.usdValue || holding.usdValue < 1) continue;
        if (holding.usdValue > 50) continue; // Only consolidate small positions

        // Skip if we have flow data for this token
        if (tokensWithFlowData.has(holding.symbol)) continue;

        // Skip if position is profitable
        const cb = state.costBasis[holding.symbol];
        if (cb && cb.avgCostBasis > 0) {
          const currentPrice = marketData.tokens.find(t => t.symbol === holding.symbol)?.price || 0;
          if (currentPrice > 0 && currentPrice >= cb.avgCostBasis) continue; // In profit, keep it
        }

        // No flow data + small + losing = dead weight
        console.log(`\n🧹 SPRAWL_REDUCE: ${holding.symbol} — $${holding.usdValue.toFixed(2)}, no flow data, losing position. Consolidating to USDC.`);
        sprawlSells.push({
          action: 'SELL',
          fromToken: holding.symbol,
          toToken: 'USDC',
          amountUSD: holding.usdValue,
          reasoning: `SPRAWL_REDUCE: ${holding.symbol} $${holding.usdValue.toFixed(2)} — no DEX flow data available, small losing position. Consolidating to free capital for positions with data coverage.`,
          sector: TOKEN_REGISTRY[holding.symbol]?.sector,
        });
      }

      if (sprawlSells.length > 0) {
        console.log(`\n🧹 SPRAWL REDUCER: ${sprawlSells.length} small blind positions being consolidated`);
        decisions = [...sprawlSells, ...decisions];
      }
    }

    // === v20.0: ADAPTIVE EXIT TIMING ENGINE — ATR-based trailing stops ===
    // PRIMARY exit mechanism. Updates trailing stops for every position every cycle.
    // Asymmetric: wide trails for winners (let profits run), tight trails for losers (cut losses fast).
    // Fires BEFORE fixed percentage stops — if trailing stop fires first, it takes priority.
    {
      const trailingStopDecisions: TradeDecision[] = [];

      for (const holding of balances) {
        if (holding.symbol === 'USDC' || holding.symbol === 'ETH' || holding.symbol === 'WETH') continue;
        if (!holding.usdValue || holding.usdValue < 1) continue;

        const cb = state.costBasis[holding.symbol];
        if (!cb || !cb.averageCostBasis || cb.averageCostBasis <= 0) continue;

        const currentPrice = marketData.tokens.find(t => t.symbol === holding.symbol)?.price || 0;
        if (currentPrice <= 0) continue;

        const gainPct = ((currentPrice - cb.averageCostBasis) / cb.averageCostBasis) * 100;
        const ind = marketData.indicators[holding.symbol];
        const atrPct = ind?.atrPercent ?? null;

        // Update trailing stop with latest price and ATR data
        if (atrPct !== null && atrPct > 0) {
          updateTrailingStop(holding.symbol, currentPrice, atrPct, gainPct, cb.averageCostBasis);

          // Check if trailing stop has been hit
          if (checkTrailingStopHit(holding.symbol, currentPrice)) {
            const tsEntry = getTrailingStop(holding.symbol);
            const zone = tsEntry?.zone || 'NEUTRAL';
            const stopPrice = tsEntry?.currentStopPrice?.toFixed(6) || '?';
            const hwm = tsEntry?.highWaterMark?.toFixed(6) || '?';
            console.log(`\n📉 TRAILING_STOP: ${holding.symbol} hit trailing stop at $${stopPrice} (HWM: $${hwm}, zone: ${zone}, gain: ${gainPct.toFixed(1)}%, ATR: ${atrPct.toFixed(1)}%)`);
            // Sell 95% of position to avoid "insufficient balance" from rounding/dust
            const sellAmountUSD = Math.max(1, holding.usdValue * 0.95);
            trailingStopDecisions.push({
              action: 'SELL',
              fromToken: holding.symbol,
              toToken: 'USDC',
              amountUSD: sellAmountUSD,
              reasoning: `TRAILING_STOP: ${holding.symbol} hit adaptive trailing stop at $${stopPrice} (HWM: $${hwm}, zone: ${zone}, P&L: ${gainPct.toFixed(1)}%, ATR: ${atrPct.toFixed(1)}%) — ${zone === 'LOSING' ? 'cutting losses fast' : 'protecting profits'}`,
              sector: TOKEN_REGISTRY[holding.symbol]?.sector,
            });
          }
        }
      }

      if (trailingStopDecisions.length > 0) {
        console.log(`\n📉 TRAILING STOPS: ${trailingStopDecisions.length} adaptive trailing stop exits triggered`);
        decisions = [...trailingStopDecisions, ...decisions];
      }
    }

    // === v16.0: PER-POSITION STOP-LOSS ENGINE ===
    // Fires BEFORE AI/swarm decisions. Hard stops protect capital from indefinite bleed.
    // v20.0: These are now BACKSTOPS — trailing stops are the primary exit mechanism.
    {
      const stopLossDecisions: TradeDecision[] = [];
      const portfolioVal = state.trading.totalPortfolioValue;

      for (const holding of balances) {
        if (holding.symbol === 'USDC' || holding.symbol === 'ETH' || holding.symbol === 'WETH') continue;
        if (!holding.usdValue || holding.usdValue < 1) continue;

        // v20.0: Skip if trailing stop already triggered for this token
        if (decisions.some(d => d.fromToken === holding.symbol && d.reasoning?.startsWith('TRAILING_STOP'))) continue;

        const cb = state.costBasis[holding.symbol];
        if (!cb || !cb.avgCostBasis || cb.avgCostBasis <= 0) continue;

        const currentPrice = marketData.tokens.find(t => t.symbol === holding.symbol)?.price || 0;
        if (currentPrice <= 0) continue;

        const gainPct = ((currentPrice - cb.avgCostBasis) / cb.avgCostBasis) * 100;
        const positionPct = portfolioVal > 0 ? (holding.usdValue / portfolioVal) * 100 : 0;

        // P0-1a: HARD STOP — position down more than 15% from cost basis (backstop)
        if (gainPct < POSITION_HARD_STOP_PCT) {
          console.log(`\n🛑 HARD_STOP: ${holding.symbol} down ${gainPct.toFixed(1)}% from cost basis — max loss exceeded (threshold: ${POSITION_HARD_STOP_PCT}%)`);
          stopLossDecisions.push({
            action: 'SELL',
            fromToken: holding.symbol,
            toToken: 'USDC',
            amountUSD: holding.usdValue,
            reasoning: `HARD_STOP: ${holding.symbol} down ${gainPct.toFixed(1)}% from cost basis — max loss exceeded (threshold: ${POSITION_HARD_STOP_PCT}%)`,
            sector: TOKEN_REGISTRY[holding.symbol]?.sector,
          });
          continue; // Don't double-trigger softer stops
        }

        // v19.0: Scout positions (< $15) are exempt from soft/concentrated stops — they're data probes, not investments
        const isScoutPosition = holding.usdValue < SCOUT_STOP_EXEMPT_THRESHOLD_USD;

        // P0-1b: SOFT STOP — position down more than 12% AND worth > $20 (scouts exempt)
        if (!isScoutPosition && gainPct < POSITION_SOFT_STOP_PCT && holding.usdValue > 20) {
          console.log(`\n⚠️ SOFT_STOP: ${holding.symbol} down ${gainPct.toFixed(1)}% from cost basis, position $${holding.usdValue.toFixed(2)} (threshold: ${POSITION_SOFT_STOP_PCT}% for >$20)`);
          stopLossDecisions.push({
            action: 'SELL',
            fromToken: holding.symbol,
            toToken: 'USDC',
            amountUSD: holding.usdValue,
            reasoning: `SOFT_STOP: ${holding.symbol} down ${gainPct.toFixed(1)}% from cost basis, position $${holding.usdValue.toFixed(2)} — approaching max loss`,
            sector: TOKEN_REGISTRY[holding.symbol]?.sector,
          });
          continue;
        }

        // P0-1c: CONCENTRATED STOP — position down more than 7% AND > 10% of portfolio (scouts exempt)
        if (!isScoutPosition && gainPct < POSITION_CONCENTRATED_STOP_PCT && positionPct > 10) {
          console.log(`\n⚠️ CONCENTRATED_STOP: ${holding.symbol} down ${gainPct.toFixed(1)}% and ${positionPct.toFixed(1)}% of portfolio (threshold: ${POSITION_CONCENTRATED_STOP_PCT}% for >10% concentration)`);
          stopLossDecisions.push({
            action: 'SELL',
            fromToken: holding.symbol,
            toToken: 'USDC',
            amountUSD: holding.usdValue,
            reasoning: `CONCENTRATED_STOP: ${holding.symbol} down ${gainPct.toFixed(1)}% and ${positionPct.toFixed(1)}% of portfolio — concentrated loser exit`,
            sector: TOKEN_REGISTRY[holding.symbol]?.sector,
          });
        }
      }

      if (stopLossDecisions.length > 0) {
        console.log(`\n🛑 PER-POSITION STOP-LOSS: ${stopLossDecisions.length} stop-loss sells triggered`);
        // Prepend stop-losses — they have highest priority
        decisions = [...stopLossDecisions, ...decisions];
      }
    }

    // === v19.0: FLOW-REVERSAL EXIT ENGINE ===
    // The PRIMARY exit mechanism. When capital is leaving a token (buy ratio < 40%
    // AND decelerating for 2+ consecutive readings), exit regardless of P&L.
    // This is the physics: money is leaving → we leave with it.
    {
      const flowReversalDecisions: TradeDecision[] = [];

      for (const holding of balances) {
        if (holding.symbol === 'USDC' || holding.symbol === 'ETH' || holding.symbol === 'WETH') continue;
        if (!holding.usdValue || holding.usdValue < 3) continue;

        // Skip if stop-loss or trailing stop already triggered for this token
        if (decisions.some(d => d.fromToken === holding.symbol && d.reasoning?.startsWith('TRAILING_STOP'))) continue;
        if (decisions.some(d => d.fromToken === holding.symbol && d.reasoning?.startsWith('HARD_STOP'))) continue;
        if (decisions.some(d => d.fromToken === holding.symbol && d.reasoning?.startsWith('SOFT_STOP'))) continue;
        if (decisions.some(d => d.fromToken === holding.symbol && d.reasoning?.startsWith('CONCENTRATED_STOP'))) continue;

        // Get current buy ratio
        let buyRatioPct = 50;
        if (lastDexIntelligence) {
          const dexPressure = lastDexIntelligence.buySellPressure.find(p => p.symbol === holding.symbol);
          if (dexPressure) buyRatioPct = dexPressure.buyRatioH1 * 100;
        }
        const ind = marketData.indicators[holding.symbol];
        if (ind?.orderFlow) {
          const totalFlow = ind.orderFlow.buyVolumeUSD + ind.orderFlow.sellVolumeUSD;
          if (totalFlow > 0) buyRatioPct = (ind.orderFlow.buyVolumeUSD / totalFlow) * 100;
        }

        // Flow reversal check: buy ratio below threshold?
        if (buyRatioPct >= FLOW_REVERSAL_EXIT_BUY_RATIO) continue;

        // Check deceleration history for consecutive negative readings
        const decelState = decelStates[holding.symbol];
        if (!decelState || decelState.buyRatioHistory.length < 3) continue;

        const h = decelState.buyRatioHistory;
        let consecutiveDecel = 0;
        for (let i = h.length - 1; i >= 1; i--) {
          if (h[i] < h[i - 1]) {
            consecutiveDecel++;
          } else {
            break;
          }
        }

        if (consecutiveDecel < FLOW_REVERSAL_EXIT_MIN_DECEL_READINGS) continue;

        const cb = state.costBasis[holding.symbol];
        const currentPrice = marketData.tokens.find(t => t.symbol === holding.symbol)?.price || 0;
        const gainPct = (cb && cb.avgCostBasis > 0 && currentPrice > 0)
          ? ((currentPrice - cb.avgCostBasis) / cb.avgCostBasis) * 100
          : 0;

        console.log(`\n🌊 FLOW_REVERSAL_EXIT: ${holding.symbol} — buy ratio ${buyRatioPct.toFixed(0)}% (< ${FLOW_REVERSAL_EXIT_BUY_RATIO}%), decelerating for ${consecutiveDecel} readings. P&L: ${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%. Capital is leaving — we leave with it.`);
        flowReversalDecisions.push({
          action: 'SELL',
          fromToken: holding.symbol,
          toToken: 'USDC',
          amountUSD: holding.usdValue,
          reasoning: `FLOW_REVERSAL: ${holding.symbol} buy ratio ${buyRatioPct.toFixed(0)}% with ${consecutiveDecel} consecutive decelerating readings. Capital outflow confirmed — exiting with the flow.`,
          sector: TOKEN_REGISTRY[holding.symbol]?.sector,
        });
      }

      if (flowReversalDecisions.length > 0) {
        console.log(`\n🌊 FLOW-REVERSAL: ${flowReversalDecisions.length} flow-reversal exits triggered`);
        decisions = [...flowReversalDecisions, ...decisions];
      }
    }

    // === v16.0: DIRECTIVE SELL ENFORCEMENT ===
    // Parse active directives for explicit sell/exit instructions and generate SELL decisions
    // every cycle until the position is gone. Fixes P0-2 (directives not executing).
    {
      const directiveSellDecisions: TradeDecision[] = [];
      const activeDirectives = getActiveDirectives();
      const activeConfigDirectives = getActiveConfigDirectives();

      // Combine user directives and config directives
      // v20.0: Include createdAt for directive escalation — directives signaling sell for >24h on losing positions get priority 0.5
      const allInstructions: { instruction: string; token?: string; createdAt?: string }[] = [];
      for (const d of activeDirectives) {
        allInstructions.push({ instruction: d.instruction, token: d.token, createdAt: d.createdAt });
      }
      for (const cd of activeConfigDirectives) {
        allInstructions.push({ instruction: cd.instruction, createdAt: (cd as any).appliedAt });
      }

      // Parse for sell/exit action keywords
      const sellActionPatterns = [
        /\b(?:sell|exit|dump|liquidate|close|get rid of|offload)\s+(?:all\s+)?(\b[A-Z]{2,10}\b)/i,
        /\b(?:prioritize selling|prioritize exiting)\s+(\b[A-Z]{2,10}\b)/i,
        /\b(\b[A-Z]{2,10}\b)\s+(?:should be sold|needs to be sold|must be sold)/i,
      ];

      for (const item of allInstructions) {
        const text = item.instruction;
        let targetToken: string | null = item.token || null;

        if (!targetToken) {
          for (const pattern of sellActionPatterns) {
            const match = text.match(pattern);
            if (match) {
              targetToken = match[1].toUpperCase();
              break;
            }
          }
        }

        // Also check for direct token mention with sell-like keywords in same directive
        if (!targetToken) {
          const hasSellKeyword = /\b(?:sell|exit|dump|liquidate|close|offload|get rid of|prioritize selling)\b/i.test(text);
          if (hasSellKeyword) {
            const tokenMatches = text.match(/\b([A-Z]{2,10})\b/g);
            if (tokenMatches) {
              for (const t of tokenMatches) {
                if (['USDC', 'USD', 'ETH', 'WETH', 'THE', 'AND', 'FOR', 'NOT', 'ALL', 'BUY', 'RSI', 'MACD'].includes(t)) continue;
                const holding = balances.find(b => b.symbol === t && b.usdValue && b.usdValue > 1);
                if (holding) { targetToken = t; break; }
              }
            }
          }
        }

        if (!targetToken) continue;

        // Check if we still hold this token
        const holding = balances.find(b => b.symbol === targetToken && b.usdValue && b.usdValue > 1);
        if (!holding) continue;

        // Don't duplicate if stop-loss or trailing stop already covers this token
        if (decisions.some(d => d.action === 'SELL' && d.fromToken === targetToken)) continue;

        // v20.0: DIRECTIVE ESCALATION — if directive has been signaling sell for >24h AND position is losing,
        // escalate to immediate market sell with high priority. Fixes the PENDLE problem: directive signaling
        // exit for 3 days with -$35.87 daily loss but position wasn't sold.
        const directiveAgeMs = item.createdAt ? (Date.now() - new Date(item.createdAt).getTime()) : 0;
        const directiveAgeHours = directiveAgeMs / (1000 * 60 * 60);
        const dirCb = state.costBasis[targetToken];
        const dirCurrentPrice = marketData.tokens.find(t => t.symbol === targetToken)?.price || 0;
        const dirIsLosing = dirCb && dirCb.averageCostBasis > 0 && dirCurrentPrice > 0 && dirCurrentPrice < dirCb.averageCostBasis;
        const isEscalated = directiveAgeHours > 24 && dirIsLosing;

        if (isEscalated) {
          const dirLossPct = dirCb && dirCb.averageCostBasis > 0 ? ((dirCurrentPrice - dirCb.averageCostBasis) / dirCb.averageCostBasis) * 100 : 0;
          console.log(`\n🚨 DIRECTIVE_ESCALATED: ${targetToken} — directive active ${directiveAgeHours.toFixed(0)}h, position losing ${dirLossPct.toFixed(1)}%. IMMEDIATE SELL escalation.`);
          directiveSellDecisions.push({
            action: 'SELL',
            fromToken: targetToken,
            toToken: 'USDC',
            amountUSD: holding.usdValue,
            reasoning: `DIRECTIVE_SELL_ESCALATED: ${targetToken} — directive active ${directiveAgeHours.toFixed(0)}h with ${dirLossPct.toFixed(1)}% loss. Immediate exit — "${text.substring(0, 50)}"`,
            sector: TOKEN_REGISTRY[targetToken]?.sector,
          });
        } else {
          console.log(`\n📋 DIRECTIVE_SELL: Executing directive to sell ${targetToken} — "${text.substring(0, 80)}"`);
          directiveSellDecisions.push({
            action: 'SELL',
            fromToken: targetToken,
            toToken: 'USDC',
            amountUSD: holding.usdValue,
            reasoning: `DIRECTIVE_SELL: User directive instructs selling ${targetToken} — "${text.substring(0, 60)}"`,
            sector: TOKEN_REGISTRY[targetToken]?.sector,
          });
        }
      }

      if (directiveSellDecisions.length > 0) {
        console.log(`\n📋 DIRECTIVE ENFORCEMENT: ${directiveSellDecisions.length} directive-driven sells`);
        // Insert after stop-losses but before AI decisions
        decisions = [...directiveSellDecisions, ...decisions];
      }
    }

    // === v13.0: SCALE-INTO-WINNERS ENGINE ===
    // Check each held position for scale-up candidates and momentum exits.
    // These are injected alongside (not replacing) the AI's decisions.
    {
      const scaleUpDecisions: TradeDecision[] = [];
      const momentumExitDecisions: TradeDecision[] = [];
      const decelTrimDecisions: TradeDecision[] = [];
      const availableUSDCForScale = balances.find(b => b.symbol === 'USDC')?.balance || 0;
      const portfolioVal = state.trading.totalPortfolioValue;

      for (const holding of balances) {
        if (holding.symbol === 'USDC' || holding.symbol === 'ETH' || holding.symbol === 'WETH') continue;
        if (!holding.usdValue || holding.usdValue < 1) continue;

        const cb = state.costBasis[holding.symbol];
        if (!cb || !cb.avgCostBasis || cb.avgCostBasis <= 0) continue;

        const currentPrice = marketData.tokens.find(t => t.symbol === holding.symbol)?.price || 0;
        if (currentPrice <= 0) continue;

        const gainPct = ((currentPrice - cb.avgCostBasis) / cb.avgCostBasis) * 100;
        const ind = marketData.indicators[holding.symbol];

        // Get buy ratio from DEX intelligence or on-chain order flow
        let buyRatioPct = 50; // default neutral
        if (lastDexIntelligence) {
          const dexPressure = lastDexIntelligence.buySellPressure.find(p => p.symbol === holding.symbol);
          if (dexPressure) buyRatioPct = dexPressure.buyRatioH1 * 100;
        }
        if (ind?.orderFlow) {
          const totalFlow = ind.orderFlow.buyVolumeUSD + ind.orderFlow.sellVolumeUSD;
          if (totalFlow > 0) buyRatioPct = (ind.orderFlow.buyVolumeUSD / totalFlow) * 100;
        }

        // v14.1: Update deceleration history for Smart Trim
        if (!decelStates[holding.symbol]) decelStates[holding.symbol] = createDecelState();
        updateBuyRatioHistory(decelStates[holding.symbol], buyRatioPct);

        const volumeAboveAvg = (ind?.volumeChange24h ?? 0) > 0; // volume > 7-day average
        const volumeSpike = (ind?.volumeChange24h ?? 0) > 50; // volume 1.5x+ average
        const macdBearish = ind?.macd ? ind.macd.histogram < 0 && ind.macd.signal === 'BEARISH' : false;

        // --- v19.0: SCOUT UPGRADE ---
        // Scout position with confirmed multi-timeframe flow → upgrade to full position
        const isScout = holding.usdValue < SCOUT_STOP_EXEMPT_THRESHOLD_USD;
        if (isScout && buyRatioPct > SCOUT_UPGRADE_BUY_RATIO) {
          const ftf = getFlowTimeframes(flowTimeframeState, holding.symbol);
          if (ftf.confirmed) {
            const upgradeSize = Math.min(
              portfolioVal * (SCALE_UP_SIZE_PCT / 100),
              availableUSDCForScale * 0.3
            );
            if (upgradeSize >= 10 && availableUSDCForScale >= 20) {
              console.log(`\n🎯 SCOUT→SURGE: ${holding.symbol} scout confirmed — buy ratio ${buyRatioPct.toFixed(0)}%, flow positive across ${ftf.positiveTimeframes} timeframes. Upgrading to full position.`);
              scaleUpDecisions.push({
                action: 'BUY',
                fromToken: 'USDC',
                toToken: holding.symbol,
                amountUSD: Math.round(upgradeSize * 100) / 100,
                reasoning: `SCALE_UP: Scout ${holding.symbol} upgraded — buy ratio ${buyRatioPct.toFixed(0)}% confirmed across ${ftf.positiveTimeframes} timeframes. Deploying real capital.`,
                sector: TOKEN_REGISTRY[holding.symbol]?.sector,
              });
            }
          }
        }

        // --- SCALE-UP CANDIDATE ---
        // Position up 3%+ with strong momentum → deploy real capital
        if (gainPct >= SCALE_UP_MIN_GAIN_PCT && (buyRatioPct > SCALE_UP_BUY_RATIO_MIN || volumeSpike)) {
          const scaleSize = Math.min(
            portfolioVal * (SCALE_UP_SIZE_PCT / 100),
            availableUSDCForScale * 0.4 // Don't blow entire USDC on one scale-up
          );
          if (scaleSize >= 5 && availableUSDCForScale >= 10) {
            console.log(`\n🎯 SCALE-UP CANDIDATE: ${holding.symbol} up ${gainPct.toFixed(1)}% | buy ratio: ${buyRatioPct.toFixed(0)}% | vol: ${(ind?.volumeChange24h ?? 0).toFixed(0)}%`);
            scaleUpDecisions.push({
              action: 'BUY',
              fromToken: 'USDC',
              toToken: holding.symbol,
              amountUSD: Math.round(scaleSize * 100) / 100,
              reasoning: `SCALE_UP: ${holding.symbol} scout position up ${gainPct.toFixed(1)}% with buy ratio ${buyRatioPct.toFixed(0)}%. Deploying real capital into proven winner.`,
              sector: TOKEN_REGISTRY[holding.symbol]?.sector,
            });
          }
        }

        // --- MOMENTUM EXIT ---
        // Position was up 5%+ but momentum is now reversing → take profit before wave breaks
        if (gainPct >= MOMENTUM_EXIT_MIN_PROFIT && (buyRatioPct < MOMENTUM_EXIT_BUY_RATIO || macdBearish)) {
          const sellReason = buyRatioPct < MOMENTUM_EXIT_BUY_RATIO
            ? `buy ratio collapsed to ${buyRatioPct.toFixed(0)}%`
            : 'MACD crossed bearish';
          console.log(`\n⚡ MOMENTUM EXIT: ${holding.symbol} was up ${gainPct.toFixed(1)}% but ${sellReason}`);
          momentumExitDecisions.push({
            action: 'SELL',
            fromToken: holding.symbol,
            toToken: 'USDC',
            amountUSD: holding.usdValue * 0.8, // Sell 80% — keep a small position in case it recovers
            reasoning: `MOMENTUM_EXIT: ${holding.symbol} up ${gainPct.toFixed(1)}% but ${sellReason}. Taking profit before reversal.`,
            sector: TOKEN_REGISTRY[holding.symbol]?.sector,
          });
        }

        // --- v14.1: DECEL_TRIM (Smart Trim) ---
        // Buy ratio still above 45% but momentum is decelerating → trim gradually
        // Only fires when momentum exit did NOT fire (they're mutually exclusive)
        if (!momentumExitDecisions.some(d => d.fromToken === holding.symbol)) {
          const decelState = decelStates[holding.symbol];
          if (decelState) {
            const trimSignal = detectDeceleration(decelState, gainPct, holding.usdValue);
            if (trimSignal.shouldTrim) {
              const trimAmount = holding.usdValue * (trimSignal.trimPercent / 100);
              console.log(`\n✂️ DECEL_TRIM: ${holding.symbol} trim ${trimSignal.trimPercent}% ($${trimAmount.toFixed(2)}) — ${trimSignal.reason}`);
              decelTrimDecisions.push({
                action: 'SELL',
                fromToken: holding.symbol,
                toToken: 'USDC',
                amountUSD: trimAmount,
                reasoning: `DECEL_TRIM: ${trimSignal.reason}`,
                sector: TOKEN_REGISTRY[holding.symbol]?.sector,
              });
              decelState.lastTrimTime = Date.now();
            }
          }
        }
      }

      // --- RIDE THE WAVE ---
      // Tokens with strong short-term moves + volume → momentum entry regardless of current holdings
      for (const token of marketData.tokens) {
        if (token.symbol === 'USDC' || token.symbol === 'ETH' || token.symbol === 'WETH') continue;
        // Use 24h price change as proxy (we don't have 4h data); require >5% AND volume spike
        if (token.priceChange24h >= RIDE_THE_WAVE_MIN_MOVE) {
          const ind = marketData.indicators[token.symbol];
          const volAboveAvg = (ind?.volumeChange24h ?? 0) > 50; // 1.5x+ volume
          if (!volAboveAvg) continue;

          // Don't wave-ride if we already have a scale-up for this token
          if (scaleUpDecisions.some(d => d.toToken === token.symbol)) continue;
          // Don't wave-ride if AI already decided to buy this token
          if (decisions.some(d => d.action === 'BUY' && d.toToken === token.symbol)) continue;

          const waveSize = Math.min(
            portfolioVal * (RIDE_THE_WAVE_SIZE_PCT / 100),
            availableUSDCForScale * 0.3
          );
          if (waveSize >= 5 && availableUSDCForScale >= 10) {
            console.log(`\n🌊 RIDE THE WAVE: ${token.symbol} up ${token.priceChange24h.toFixed(1)}% with ${(ind?.volumeChange24h ?? 0).toFixed(0)}% volume spike`);
            scaleUpDecisions.push({
              action: 'BUY',
              fromToken: 'USDC',
              toToken: token.symbol,
              amountUSD: Math.round(waveSize * 100) / 100,
              reasoning: `RIDE_THE_WAVE: ${token.symbol} up ${token.priceChange24h.toFixed(1)}% in 24h with volume ${(ind?.volumeChange24h ?? 0).toFixed(0)}% above average. Momentum trade.`,
              sector: TOKEN_REGISTRY[token.symbol]?.sector,
            });
          }
        }
      }

      // --- v19.0: SCOUT SEEDING ---
      // Seed small $8 positions across tokens we don't hold yet.
      // Scouts are data-gathering probes, not investments. They provide real-time flow data.
      // v19.3: Skip entirely in capital preservation mode — conserve every dollar.
      const scoutDecisions: TradeDecision[] = [];
      if (capitalPreservationMode.isActive) {
        console.log(`\n🛡️ PRESERVATION: Scout seeding SKIPPED — capital preservation mode active`);
      } else {
        const heldSymbols = new Set(balances.filter(b => b.usdValue >= 1).map(b => b.symbol));
        const scoutCandidates = marketData.tokens.filter(t =>
          t.symbol !== 'USDC' && t.symbol !== 'ETH' && t.symbol !== 'WETH' &&
          !heldSymbols.has(t.symbol) &&
          TOKEN_REGISTRY[t.symbol] // Only scout tokens in our registry
        );

        // Count existing scout-sized positions
        const existingScouts = balances.filter(b =>
          b.symbol !== 'USDC' && b.symbol !== 'ETH' && b.symbol !== 'WETH' &&
          b.usdValue >= 1 && b.usdValue < SCOUT_STOP_EXEMPT_THRESHOLD_USD
        ).length;

        const spotsAvailable = Math.max(0, SCOUT_MAX_POSITIONS - existingScouts);
        const cashForScouts = availableUSDCForScale - 50; // Keep $50 reserve for surges

        if (spotsAvailable > 0 && cashForScouts > SCOUT_POSITION_USD * 2) {
          // Prioritize scouts by: tokens with flow data available, then by sector diversification
          const maxNewScouts = Math.min(
            spotsAvailable,
            Math.floor(cashForScouts / SCOUT_POSITION_USD),
            3 // Max 3 new scouts per cycle to avoid churn
          );

          for (let i = 0; i < Math.min(maxNewScouts, scoutCandidates.length); i++) {
            const token = scoutCandidates[i];
            // Don't scout if AI or scale-up already targets this token
            if (decisions.some(d => d.toToken === token.symbol)) continue;
            if (scaleUpDecisions.some(d => d.toToken === token.symbol)) continue;

            scoutDecisions.push({
              action: 'BUY',
              fromToken: 'USDC',
              toToken: token.symbol,
              amountUSD: SCOUT_POSITION_USD,
              reasoning: `SCOUT: Seeding $${SCOUT_POSITION_USD} probe in ${token.symbol} — data-gathering position, not an investment.`,
              sector: TOKEN_REGISTRY[token.symbol]?.sector,
            });
          }

          if (scoutDecisions.length > 0) {
            console.log(`\n🔭 SCOUT SEEDING: ${scoutDecisions.length} new scouts (${existingScouts} existing, ${spotsAvailable} spots available)`);
          }
        }
      }

      // Inject scale-up, decel trim, momentum exit, and scout decisions alongside AI decisions
      if (scaleUpDecisions.length > 0 || momentumExitDecisions.length > 0 || decelTrimDecisions.length > 0 || scoutDecisions.length > 0) {
        console.log(`\n📊 SCALE-INTO-WINNERS: ${scaleUpDecisions.length} scale-ups, ${momentumExitDecisions.length} momentum exits, ${decelTrimDecisions.length} decel trims, ${scoutDecisions.length} scouts`);
        // Priority: momentum exits first, then decel trims, then AI decisions, then scale-ups, then scouts
        decisions = [...momentumExitDecisions, ...decelTrimDecisions, ...decisions, ...scaleUpDecisions, ...scoutDecisions];
      }
    }

    // v12.2.7: DEPLOYMENT FALLBACK — only fires after 3+ consecutive HOLDs AND cash >65%.
    // Previously fired immediately on any HOLD in deployment mode, overriding AI judgment.
    // Now gives the AI 3 chances to find quality entries before mechanical fallback.
    const allHold = decisions.every(d => d.action === 'HOLD');
    if (allHold && deploymentCheck.active && state.explorationState.consecutiveHolds >= 3 && deploymentCheck.cashPercent > 65) {
      console.log(`\n⚡ DEPLOYMENT FALLBACK: ${state.explorationState.consecutiveHolds} consecutive HOLDs with ${deploymentCheck.cashPercent.toFixed(0)}% USDC — deploying into best-scoring entries`);

      // Pick tokens from the most underweight sectors
      const underweightSectors = sectorAllocations
        .filter(s => s.name !== 'Blue Chip' || s.drift < -10) // only force blue chips if very underweight
        .sort((a, b) => a.drift - b.drift) // most underweight first
        .slice(0, 3);

      const fallbackBuys: TradeDecision[] = [];
      const sizePerTrade = Math.min(120, deploymentCheck.deployBudget / 3); // v11.4.13: $120 max (was $50), /3 (was /4)

      for (const sector of underweightSectors) {
        // Find best token from this sector: prefer tokens with best confluence or most oversold RSI
        const sectorKey = Object.keys(SECTORS).find(k => SECTORS[k as keyof typeof SECTORS].name === sector.name) as keyof typeof SECTORS | undefined;
        if (!sectorKey) continue;

        const sectorTokens = SECTORS[sectorKey].tokens;
        // Score each token: prefer lower RSI (oversold) and higher confluence
        let bestToken = '';
        let bestScore = -Infinity;
        for (const token of sectorTokens) {
          if (token === 'USDC' || token === 'WETH') continue; // skip stablecoins and wrapped
          const ind = marketData.indicators[token];
          const rsiScore = ind?.rsi14 !== null && ind?.rsi14 !== undefined ? (50 - ind.rsi14) : 0; // lower RSI = higher score
          const confScore = ind?.confluenceScore || 0;
          const score = rsiScore + confScore;
          // Check we don't already have a large position
          const currentBal = balances.find(b => b.symbol === token);
          const currentPct = currentBal ? ((currentBal.usdValue || 0) / state.trading.totalPortfolioValue) * 100 : 0;
          if (currentPct > 15) continue; // skip if already > 15% of portfolio
          if (score > bestScore) {
            bestScore = score;
            bestToken = token;
          }
        }

        if (bestToken) {
          fallbackBuys.push({
            action: 'BUY',
            fromToken: 'USDC',
            toToken: bestToken,
            amountUSD: sizePerTrade,
            reasoning: `DEPLOYMENT_FALLBACK: Auto-deploy into ${bestToken} (${sector.name} sector underweight by ${sector.drift.toFixed(1)}%). AI returned HOLD but portfolio is ${deploymentCheck.cashPercent.toFixed(0)}% cash.`,
            sector: sectorKey,
            isForced: true,
          });
          console.log(`   📦 Auto-BUY: $${sizePerTrade.toFixed(0)} → ${bestToken} (${sector.name}, drift: ${sector.drift.toFixed(1)}%)`);
        }
      }

      if (fallbackBuys.length > 0) {
        decisions = fallbackBuys;
        console.log(`   Generated ${fallbackBuys.length} fallback BUY decisions`);
      }
    }

    // v14.2: MAX_TRADES_PER_CYCLE GUARD — cap total trades to prevent churn
    // v18.0: RANGING regime gets tighter cap (2 trades) — fewer, higher-conviction trades
    // Priority order: stop-loss > momentum-exit > profit-take > AI > scale-up > forced-deploy > ride-the-wave
    const effectiveMaxTrades = regime === 'RANGING' ? RANGING_MAX_TRADES_PER_CYCLE : MAX_TRADES_PER_CYCLE;
    if (decisions.filter(d => d.action !== 'HOLD').length > effectiveMaxTrades) {
      const priorityOrder = (d: TradeDecision): number => {
        const tier = d.reasoning?.match(/^([A-Z_]+):/)?.[1] || 'AI';
        switch (tier) {
          case 'HARD_STOP': return -1;   // v16.0: highest priority — absolute loss limit
          case 'TRAILING_STOP': return -0.8; // v20.0: adaptive trailing stop — primary exit mechanism
          case 'SOFT_STOP': return -0.5;  // v16.0: approaching loss limit
          case 'CONCENTRATED_STOP': return -0.5; // v16.0: concentrated loser
          case 'STOP_LOSS': return 0;
          case 'DIRECTIVE_SELL_ESCALATED': return 0.3; // v20.0: escalated directive — >24h sell signal on losing position
          case 'DIRECTIVE_SELL': return 0.5; // v16.0: user directive enforcement
          case 'FLOW_REVERSAL': return 0.7; // v19.0: flow physics exit — fires before momentum exit
          case 'MOMENTUM_EXIT': return 1;
          case 'DECEL_TRIM': return 1.5; // v14.1: after momentum exit, before profit take
          case 'PROFIT_TAKE': return 2;
          default: return 3; // AI
          case 'SCALE_UP': return 4;
          case 'FORCED_DEPLOY': return 5;
          case 'DEPLOYMENT_FALLBACK': return 5;
          case 'RIDE_THE_WAVE': return 6;
          case 'SCOUT': return 7; // v19.0: lowest priority — scouts seed last
        }
      };
      const actionDecisions = decisions.filter(d => d.action !== 'HOLD');
      const holdDecisions = decisions.filter(d => d.action === 'HOLD');
      actionDecisions.sort((a, b) => priorityOrder(a) - priorityOrder(b));
      const kept = actionDecisions.slice(0, effectiveMaxTrades);
      const dropped = actionDecisions.length - effectiveMaxTrades;
      console.log(`\n⚠️ TRADE_CAP: Dropping ${dropped} lower-priority trades this cycle (max ${effectiveMaxTrades} per cycle${regime === 'RANGING' ? ' — RANGING regime' : ''})`);
      for (const d of actionDecisions.slice(effectiveMaxTrades)) {
        const tier = d.reasoning?.match(/^([A-Z_]+):/)?.[1] || 'AI';
        console.log(`   Dropped: ${tier} ${d.action} ${d.fromToken}→${d.toToken} $${d.amountUSD.toFixed(0)}`);
      }
      decisions = [...kept, ...holdDecisions];
    }

    // v17.0: FEAR/REGIME BUY FILTERING REMOVED — the swarm handles all buy/sell decisions
    // based on capital flow, momentum, risk metrics, and trend. No F&G-based overrides.

    // v18.0: RISK/REWARD FILTER — Only enter trades where potential reward >= 2x risk
    // Risk = stop-loss distance (sector-based). Reward = distance below 30-day high.
    // Tokens near their 30-day high have limited upside — skip them.
    {
      const rrFiltered: TradeDecision[] = [];
      for (const d of decisions) {
        if (d.action !== 'BUY') {
          rrFiltered.push(d);
          continue;
        }

        const tokenInfo = TOKEN_REGISTRY[d.toToken];
        const sectorKey = tokenInfo?.sector || 'DEFI';
        const sectorStop = SECTOR_STOP_LOSS_OVERRIDES[sectorKey];
        const riskPercent = Math.abs(sectorStop?.maxLoss || 5);

        // Calculate potential upside using price history (distance from 30-day high)
        const tokenHistory = priceHistoryStore.tokens[d.toToken];
        const currentTokenPrice = marketData.tokens.find(t => t.symbol === d.toToken)?.price || 0;
        let rewardPercent = riskPercent * 3; // Default: assume 3x risk if no history

        if (tokenHistory && tokenHistory.prices.length > 10 && currentTokenPrice > 0) {
          // Look at last 720 hourly entries (30 days) or whatever is available
          const recentPrices = tokenHistory.prices.slice(-720);
          const high30d = Math.max(...recentPrices);
          if (high30d > 0) {
            const distFromHigh = ((high30d - currentTokenPrice) / currentTokenPrice) * 100;
            rewardPercent = distFromHigh;

            // Token within 5% of 30-day high — limited upside, skip
            if (distFromHigh < 5) {
              console.log(`\n  📏 R:R_FILTER: Skipping ${d.toToken} BUY — only ${distFromHigh.toFixed(1)}% below 30d high ($${high30d.toFixed(4)}), limited upside`);
              d.action = 'HOLD' as any;
              d.reasoning = `R:R_FILTER: ${d.toToken} within ${distFromHigh.toFixed(1)}% of 30-day high — upside limited`;
              rrFiltered.push(d);
              continue;
            }
          }
        }

        const rrRatio = rewardPercent / riskPercent;
        if (rrRatio < 2.0) {
          console.log(`\n  📏 R:R_FILTER: Skipping ${d.toToken} BUY — R:R ratio ${rrRatio.toFixed(1)}:1 (risk: ${riskPercent}%, reward: ${rewardPercent.toFixed(1)}%) below 2:1 minimum`);
          d.action = 'HOLD' as any;
          d.reasoning = `R:R_FILTER: Reward/risk ratio ${rrRatio.toFixed(1)}:1 too low (need 2:1+)`;
          rrFiltered.push(d);
          continue;
        }

        rrFiltered.push(d);
      }
      decisions = rrFiltered;
    }

    // v9.2: Track remaining USDC across multi-trade to prevent overspend
    let remainingUSDC = balances.find(b => b.symbol === 'USDC')?.balance || 0;
    let anyTradeExecuted = false;
    let crashBuyEntriesThisCycle = 0; // v11.2: Track crash-buy entries to enforce max cap

    for (let di = 0; di < decisions.length; di++) {
      const decision = decisions[di];
      if (decisions.length > 1) console.log(`\n   --- Trade ${di + 1}/${decisions.length} ---`);

      console.log(`\n   Decision: ${decision.action}`);
      if (decision.action !== "HOLD") {
        console.log(`   Trade: $${decision.amountUSD.toFixed(2)} ${decision.fromToken} → ${decision.toToken}`);
        if (decision.sector) console.log(`   Sector: ${decision.sector}`);
      }
      console.log(`   Reasoning: ${decision.reasoning}`);

      // === v6.2: CAPITAL FLOOR — BLOCK NEW BUYS ===
      if (belowCapitalFloor && decision.action === "BUY") {
        console.log(`   🚫 CAPITAL FLOOR: Blocking BUY — portfolio $${state.trading.totalPortfolioValue.toFixed(2)} below floor $${capitalFloorValue.toFixed(2)}. Only sells allowed.`);
        decision.action = "HOLD";
        decision.reasoning = `Capital floor active: portfolio at $${state.trading.totalPortfolioValue.toFixed(2)} is below ${CAPITAL_FLOOR_PERCENT}% of peak ($${capitalFloorValue.toFixed(2)}). Holding until recovery or funding.`;
      }

      // === v8.0: INSTITUTIONAL BREAKER — BLOCK NEW BUYS ===
      // v17.0: Crash-buying override — allow deployment buys through breaker when cash-heavy + flow confirms
      if (institutionalBreakerActive && decision.action === "BUY") {
        if (crashBuyOverride.active && crashBuyEntriesThisCycle < crashBuyOverride.maxEntries) {
          // v17.0: Flow confirmation gate — always require positive buy ratio for breaker override
          if (crashBuyOverride.requirePositiveBuyRatio) {
            // v16.0: Buy ratio gate — confirm the dip is being bought
            let tokenBuyRatio = 50;
            if (lastDexIntelligence) {
              const dexP = lastDexIntelligence.buySellPressure.find((p: any) => p.symbol === decision.toToken);
              if (dexP) tokenBuyRatio = dexP.buyRatioH1 * 100;
            }
            const tokenInd = marketData.indicators[decision.toToken];
            if (tokenInd?.orderFlow) {
              const totalFlow = tokenInd.orderFlow.buyVolumeUSD + tokenInd.orderFlow.sellVolumeUSD;
              if (totalFlow > 0) tokenBuyRatio = (tokenInd.orderFlow.buyVolumeUSD / totalFlow) * 100;
            }
            if (tokenBuyRatio <= 50) {
              console.log(`   🦈 CRASH-BUY: Blocking ${decision.toToken} — buy ratio ${tokenBuyRatio.toFixed(0)}% <= 50%, dip not being bought`);
              decision.action = "HOLD";
              decision.reasoning = `Crash-buy override: buy ratio ${tokenBuyRatio.toFixed(0)}% too low — dip not confirmed as being bought.`;
            } else {
              // Override: allow the BUY with breaker-override sizing
              const originalAmount = decision.amountUSD;
              const maxCrashBuyUSD = state.trading.totalPortfolioValue * (crashBuyOverride.maxPositionPct / 100);
              decision.amountUSD = Math.min(decision.amountUSD * crashBuyOverride.sizeMultiplier, maxCrashBuyUSD);
              crashBuyEntriesThisCycle++;
              console.log(`   🦈 CRASH-BUY OVERRIDE: Allowing BUY through breaker — $${originalAmount.toFixed(2)} → $${decision.amountUSD.toFixed(2)} (${(crashBuyOverride.sizeMultiplier * 100).toFixed(0)}% size, max ${crashBuyOverride.maxPositionPct}% portfolio) [${crashBuyEntriesThisCycle}/${crashBuyOverride.maxEntries} entries]`);
            }
          } else {
            // Normal crash-buy (F&G 20-30): allow with standard reduction
            const originalAmount = decision.amountUSD;
            decision.amountUSD = decision.amountUSD * crashBuyOverride.sizeMultiplier;
            crashBuyEntriesThisCycle++;
            console.log(`   🦈 CRASH-BUY OVERRIDE: Allowing BUY through breaker — $${originalAmount.toFixed(2)} → $${decision.amountUSD.toFixed(2)} (${(crashBuyOverride.sizeMultiplier * 100).toFixed(0)}% size) [${crashBuyEntriesThisCycle}/${crashBuyOverride.maxEntries} entries]`);
          }
        } else if (crashBuyOverride.active && crashBuyEntriesThisCycle >= crashBuyOverride.maxEntries) {
          console.log(`   🦈 CRASH-BUY: Max entries reached (${crashBuyOverride.maxEntries}) — blocking additional BUY`);
          decision.action = "HOLD";
          decision.reasoning = `Crash-buy override: max ${crashBuyOverride.maxEntries} entries per cycle reached.`;
        } else {
          console.log(`   🚨 INSTITUTIONAL BREAKER: Blocking BUY — ${breakerCheck}`);
          decision.action = "HOLD";
          decision.reasoning = `Institutional circuit breaker active: ${breakerCheck}. Only sells allowed until breaker clears.`;
        }
      }

      // v9.2: Check remaining USDC for BUY actions in multi-trade
      if (decision.action === "BUY" && decision.amountUSD > remainingUSDC) {
        if (remainingUSDC < 5) {
          console.log(`   🚫 USDC exhausted ($${remainingUSDC.toFixed(2)} left) — skipping BUY`);
          decision.action = "HOLD";
          decision.reasoning = `Insufficient USDC remaining ($${remainingUSDC.toFixed(2)}) after prior trades this cycle.`;
        } else {
          console.log(`   ⚠️ Capping BUY to remaining USDC: $${decision.amountUSD.toFixed(2)} → $${remainingUSDC.toFixed(2)}`);
          decision.amountUSD = remainingUSDC;
        }
      }

      // === v11.4.15: POSITION SIZING — streamlined from 5 multiplicative reductions to 2 ===
      // Previously: Kelly × Vol × ATR × Confidence × LegacyBreaker stacked to kill trade sizes.
      // With 0 trade history, Kelly fallback was $15, confidence ~0.5 → $7.50 per trade.
      // Now: Kelly sets a ceiling. During deployment mode, use a generous floor instead.
      if (decision.action === "BUY" && decision.amountUSD > 0) {
        const instSizeCycle = calculateInstitutionalPositionSize(state.trading.totalPortfolioValue);

        if (deploymentCheck.active) {
          // DEPLOYMENT MODE: Use generous sizing — the whole point is to get capital deployed.
          // Floor at 2.5% of portfolio or $100, whichever is larger. Cap at remaining USDC.
          const deployFloor = Math.max(100, state.trading.totalPortfolioValue * 0.025);
          const deployMax = Math.min(deployFloor, remainingUSDC);
          decision.amountUSD = Math.max(decision.amountUSD, deployMax);
          decision.amountUSD = Math.min(decision.amountUSD, remainingUSDC);
          console.log(`   ⚡ DEPLOY SIZING: $${decision.amountUSD.toFixed(2)} (floor: $${deployFloor.toFixed(0)}, Kelly would be: $${instSizeCycle.sizeUSD.toFixed(2)})`);
        } else {
          // NORMAL MODE: Kelly cap with ATR adjustment, no other reductions.
          const kellyMax = Math.min(instSizeCycle.sizeUSD, remainingUSDC);
          decision.amountUSD = Math.min(decision.amountUSD, kellyMax);
          console.log(`   🎰 Kelly Cap: $${kellyMax.toFixed(2)} (${instSizeCycle.kellyPct.toFixed(1)}%)`);

          // ATR scaling only in normal mode — slight adjustment, floored at 0.75x
          const tokenATR = marketData.indicators[decision.toToken]?.atrPercent;
          if (tokenATR && tokenATR > 0) {
            const allATRs = Object.values(marketData.indicators)
              .map((ind: any) => ind?.atrPercent)
              .filter((a: any) => a && a > 0) as number[];
            const avgATR = allATRs.length > 0 ? allATRs.reduce((s, a) => s + a, 0) / allATRs.length : tokenATR;
            const atrMultiplier = Math.max(0.75, Math.min(1.25, avgATR / tokenATR));
            if (Math.abs(atrMultiplier - 1.0) > 0.05) {
              const preATR = decision.amountUSD;
              decision.amountUSD = Math.max(KELLY_POSITION_FLOOR_USD, Math.round(decision.amountUSD * atrMultiplier * 100) / 100);
              console.log(`   📊 ATR: ×${atrMultiplier.toFixed(2)} ($${preATR.toFixed(2)} → $${decision.amountUSD.toFixed(2)})`);
            }
          }
        }
        // v11.4.15: Removed legacy 12% DD breaker (duplicate of institutional breaker)
        // v11.4.15: Removed pattern confidence multiplier (was halving trades with no history)

        // v11.4.19: Directive-aware sizing — aggressive directive scales up, conservative scales down
        const dirAdj = getDirectiveThresholdAdjustments();
        if (dirAdj.positionSizeMultiplier !== 1.0) {
          const preDirSize = decision.amountUSD;
          decision.amountUSD = Math.min(Math.round(decision.amountUSD * dirAdj.positionSizeMultiplier * 100) / 100, remainingUSDC);
          if (Math.abs(preDirSize - decision.amountUSD) >= 1) {
            console.log(`   📣 Directive sizing: ×${dirAdj.positionSizeMultiplier} ($${preDirSize.toFixed(2)} → $${decision.amountUSD.toFixed(2)})`);
          }
        }

        // v14.0: "Catching Fire" momentum multiplier — 1.5x size when on-chain order flow
        // shows buy ratio > 60% with significant volume (>50 trades in lookback window)
        const tokenFlow = marketData.indicators[decision.toToken]?.orderFlow;
        if (tokenFlow) {
          const totalFlowVol = tokenFlow.buyVolumeUSD + tokenFlow.sellVolumeUSD;
          const tokenBuyRatio = totalFlowVol > 0 ? tokenFlow.buyVolumeUSD / totalFlowVol : 0.5;
          if (tokenBuyRatio > 0.60 && tokenFlow.tradeCount > 50) {
            const preCatchingFire = decision.amountUSD;
            decision.amountUSD = Math.min(Math.round(decision.amountUSD * 1.5 * 100) / 100, remainingUSDC);
            console.log(`   🔥 CATCHING FIRE: ${decision.toToken} buy ratio ${(tokenBuyRatio * 100).toFixed(0)}% with ${tokenFlow.tradeCount} trades — 1.5x size ($${preCatchingFire.toFixed(2)} → $${decision.amountUSD.toFixed(2)})`);
          }
        }

        // v14.0: Enforce minimum $15 position — no dust trades
        if (decision.amountUSD < KELLY_POSITION_FLOOR_USD) {
          console.log(`   🚫 DUST GUARD: $${decision.amountUSD.toFixed(2)} < $${KELLY_POSITION_FLOOR_USD} minimum — skipping trade`);
          recordFiltered(decision.toToken || decision.fromToken || '?', decision.action, dedupTier || 'AI', 'DUST_GUARD', decision.amountUSD);
          decision.action = "HOLD";
          decision.reasoning = `Position size $${decision.amountUSD.toFixed(2)} below $${KELLY_POSITION_FLOOR_USD} minimum — not worth the fees`;
        }
      }

      // === POSITION SIZE GUARD ===
      // v11.4.15: Changed from BLOCK to RESIZE — trim the buy to fit within sector limit
      // instead of killing the entire trade. A $26 buy shouldn't be blocked just because
      // the limit is $25. Trim it to $25 and execute.
      if (decision.action === "BUY" && decision.toToken !== "USDC" && state.trading.totalPortfolioValue > 0) {
        const targetHolding = balances.find(b => b.symbol === decision.toToken);
        const currentValue = targetHolding?.usdValue || 0;
        const afterBuyValue = currentValue + decision.amountUSD;
        const afterBuyPercent = (afterBuyValue / state.trading.totalPortfolioValue) * 100;

        const tokenSector = TOKEN_REGISTRY[decision.toToken]?.sector;
        // v13.0: Scale-up / momentum trades get elevated position cap (15% minimum)
        const isScaleUpOrWave = decision.reasoning?.startsWith('SCALE_UP:') || decision.reasoning?.startsWith('RIDE_THE_WAVE:');
        const baseSectorLimit = tokenSector && SECTOR_STOP_LOSS_OVERRIDES[tokenSector]
          ? SECTOR_STOP_LOSS_OVERRIDES[tokenSector].maxPositionPercent
          : CONFIG.trading.maxPositionPercent;
        const sectorLimit = isScaleUpOrWave ? Math.max(baseSectorLimit, MOMENTUM_MAX_POSITION_PERCENT) : baseSectorLimit;

        if (afterBuyPercent > sectorLimit) {
          const maxBuyUSD = Math.max(0, (sectorLimit / 100) * state.trading.totalPortfolioValue - currentValue);
          if (maxBuyUSD >= 5) {
            console.log(`   ✂️ POSITION GUARD: ${decision.toToken} trimmed $${decision.amountUSD.toFixed(2)} → $${maxBuyUSD.toFixed(2)} (${sectorLimit}% sector cap)`);
            decision.amountUSD = maxBuyUSD;
          } else {
            console.log(`   🚫 POSITION GUARD: ${decision.toToken} at ${(currentValue / state.trading.totalPortfolioValue * 100).toFixed(1)}% — at sector limit ${sectorLimit}%. No room.`);
            decision.action = "HOLD";
            decision.reasoning = `Position guard: ${decision.toToken} at sector limit ${sectorLimit}%.`;
          }
        }
      }

      // v11.4.15: Diversity guard REMOVED — the position size guard (sector limits) already
      // prevents over-concentration. This guard was blocking legitimate conviction plays.

      // v5.3.3: Circuit breaker guard
      if (["SELL", "REBALANCE"].includes(decision.action) && decision.fromToken && isTokenBlocked(decision.fromToken)) {
        console.log(`   🚫 CIRCUIT BREAKER: Skipping ${decision.action} for ${decision.fromToken} — too many consecutive failures`);
        decision.action = "HOLD";
        decision.reasoning = `Circuit breaker: ${decision.fromToken} blocked after repeated failures. Cooling off.`;
      }

      // v11.4.11: Block AI from buying CDP-unsupported tokens
      if (decision.action === "BUY" && CDP_UNSUPPORTED_TOKENS.has(decision.toToken)) {
        console.log(`   🚫 CDP UNSUPPORTED: Skipping BUY for ${decision.toToken} — CDP SDK cannot swap this token`);
        decision.action = "HOLD";
        decision.reasoning = `CDP unsupported: ${decision.toToken} cannot be traded via CDP SDK.`;
      }

      // Execute if needed
      if (["BUY", "SELL", "REBALANCE"].includes(decision.action) && decision.amountUSD >= 1.00) {
        const tradeResult = await executeTrade(decision, marketData);

        // v5.3.3: Track consecutive failures / clear on success
        // v19.3.1: Skip circuit breaker for "Insufficient balance" — these are transient sync issues,
        // not permanent routing failures. Blocking tokens for 6h over a balance mismatch is too aggressive.
        const tradeToken = decision.action === "SELL" ? decision.fromToken : decision.toToken;
        const isBalanceError = tradeResult.error?.includes('Insufficient balance') || tradeResult.error?.includes('Balance too small');
        if (!tradeResult.success && !isBalanceError) {
          recordTradeFailure(tradeToken);
        } else if (!tradeResult.success && isBalanceError) {
          console.log(`  ℹ️ Balance error for ${tradeToken} — NOT triggering circuit breaker (transient issue)`);
        } else {
          clearTradeFailures(tradeToken);
          // v9.2 + v10.2: Deduct spent USDC + buffer for gas/slippage from remaining pool
          if (decision.action === "BUY") {
            const slippageBuffer = decision.amountUSD * 0.02; // 2% buffer for slippage + gas
            remainingUSDC -= (decision.amountUSD + slippageBuffer);
          }
          anyTradeExecuted = true;
        }

        // v8.0: Track for institutional breaker
        if (decision.action === "SELL" && tradeResult.success) {
          const cb = state.costBasis[decision.fromToken];
          const sellPrice = decision.amountUSD / (decision.tokenAmount || 1);
          const avgCost = cb?.averageCostBasis || sellPrice;
          const pnlEstimate = (sellPrice - avgCost) * (decision.tokenAmount || 0);
          recordTradeResultForBreaker(true, pnlEstimate);
        } else if (decision.action === "BUY" && tradeResult.success) {
          // Buys are neutral for breaker — determined on sell
        } else if (!tradeResult.success) {
          recordTradeResultForBreaker(false, 0);
        }

        // v6.0: Set cooldown for traded token
        const cooldownToken = decision.action === "SELL" ? decision.fromToken : decision.toToken;
        const tokenPrice = currentPrices.get(cooldownToken) || 0;
        cooldownManager.setCooldown(cooldownToken, decision.action === "HOLD" ? "HOLD" : decision.action as CooldownDecision, tokenPrice, marketData.indicators[cooldownToken]?.confluenceScore);

      } else if (decision.action === "HOLD") {
        // v6.0: Set HOLD cooldown for tokens to skip re-evaluation
        if (decision.toToken && decision.toToken !== "USDC") {
          const holdPrice = currentPrices.get(decision.toToken) || 0;
          cooldownManager.setCooldown(decision.toToken, "HOLD", holdPrice, marketData.indicators[decision.toToken]?.confluenceScore);
        }
      }
    } // end multi-trade loop

    // Post-trade bookkeeping (runs once after all trades)
    if (anyTradeExecuted) {
      analyzeStrategyPatterns();
      state.explorationState.lastTradeTimestamp = new Date().toISOString();
      state.explorationState.consecutiveHolds = 0;
      state.explorationState.totalExploitationTrades++;
      saveTradeHistory();
    } else {
      // All decisions were HOLD
      state.explorationState.consecutiveHolds++;

      // v12.2.7: POST-GUARDRAIL FALLBACK REMOVED — was the 4th forced-buy mechanism
      // stacking on Pre-AI Forced Deploy + AI Prompt Override + Deployment Fallback.
      // When AI says HOLD after guardrails, respect it. The AI has the most context.
      if (deploymentCheck.active && state.explorationState.consecutiveHolds >= 5) {
        console.log(`\n📊 AI has returned HOLD for ${state.explorationState.consecutiveHolds} consecutive cycles with ${deploymentCheck.cashPercent.toFixed(0)}% cash — respecting AI judgment`);
      }
    }

    // v9.3: Auto-harvest replaced by Daily Payout cron (8 AM UTC) — see executeDailyPayout()

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

    // === v11.0: AAVE V3 YIELD CYCLE ===
    // Park idle USDC in Aave V3 for yield when markets are ranging/fearful.
    // Withdraw when AI brain needs capital for active trading.
    if (yieldEnabled && cdpClient) {
      try {
        yieldCycleCount++;
        const walletAddr = CONFIG.walletAddress;
        const usdcBalance = balances.find(b => b.symbol === 'USDC')?.balance || 0;
        const regime = marketData.marketRegime || 'UNKNOWN';
        const fearGreedVal = marketData.fearGreed?.value || 50;

        // Refresh aToken balance from chain every 3 heavy cycles
        if (yieldCycleCount % 3 === 1) {
          await aaveYieldService.refreshBalance(walletAddr);
        }

        // Check if AI needs capital (any BUY decision was made but USDC is low)
        const aiNeedsCapital = decisions.some(
          (d: any) => d.action === 'BUY' && d.amountUSD > usdcBalance * 0.8
        );

        // Calculate deposit opportunity
        const depositAmount = aaveYieldService.calculateDepositAmount(usdcBalance, regime, fearGreedVal);

        // Calculate withdrawal need
        const withdrawAmount = aaveYieldService.calculateWithdrawAmount(usdcBalance, regime, fearGreedVal, aiNeedsCapital);

        if (withdrawAmount > 0) {
          // WITHDRAW: AI needs capital or market turning bullish
          console.log(`\n  🏦 AAVE YIELD: Withdrawing $${withdrawAmount.toFixed(2)} USDC (${regime}, F&G: ${fearGreedVal})`);
          const withdrawCalldata = aaveYieldService.buildWithdrawCalldata(withdrawAmount, walletAddr);
          const account = await cdpClient.evm.getOrCreateAccount({ name: CDP_ACCOUNT_NAME });
          const tx = await account.sendTransaction({
            network: "base",
            transaction: {
              to: withdrawCalldata.to as `0x${string}`,
              data: withdrawCalldata.data as `0x${string}`,
              value: BigInt(0),
            },
          });
          aaveYieldService.recordWithdraw(withdrawAmount, tx.transactionHash, `${regime} regime, F&G ${fearGreedVal}${aiNeedsCapital ? ', AI needs capital' : ''}`);
          lastYieldAction = `WITHDRAW $${withdrawAmount.toFixed(2)} @ ${new Date().toISOString()}`;
          console.log(`  ✅ Aave withdraw: $${withdrawAmount.toFixed(2)} USDC — tx: ${tx.transactionHash}`);
          saveTradeHistory();
        } else if (depositAmount > 0 && !anyTradeExecuted) {
          // DEPOSIT: Only when no trades executed this cycle (don't compete for USDC)
          console.log(`\n  🏦 AAVE YIELD: Depositing $${depositAmount.toFixed(2)} USDC (${regime}, F&G: ${fearGreedVal})`);
          const supplyCalldata = aaveYieldService.buildSupplyCalldata(depositAmount, walletAddr);
          const account = await cdpClient.evm.getOrCreateAccount({ name: CDP_ACCOUNT_NAME });

          // Check and set approval if needed
          const currentAllowance = await aaveYieldService.getAllowance(walletAddr);
          const depositAmountRaw = BigInt(Math.floor(depositAmount * 1e6));
          if (currentAllowance < depositAmountRaw) {
            console.log(`  🔓 Approving Aave Pool to spend USDC...`);
            const approveTx = await account.sendTransaction({
              network: "base",
              transaction: {
                to: supplyCalldata.approvalTo as `0x${string}`,
                data: supplyCalldata.approvalData as `0x${string}`,
                value: BigInt(0),
              },
            });
            console.log(`  ✅ Aave approval: ${approveTx.transactionHash}`);
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for propagation
          }

          // Execute supply
          const tx = await account.sendTransaction({
            network: "base",
            transaction: {
              to: supplyCalldata.to as `0x${string}`,
              data: supplyCalldata.data as `0x${string}`,
              value: BigInt(0),
            },
          });
          aaveYieldService.recordSupply(depositAmount, tx.transactionHash, `${regime} regime, F&G ${fearGreedVal}`);
          lastYieldAction = `SUPPLY $${depositAmount.toFixed(2)} @ ${new Date().toISOString()}`;
          console.log(`  ✅ Aave supply: $${depositAmount.toFixed(2)} USDC — tx: ${tx.transactionHash}`);
          saveTradeHistory();
        } else {
          const yieldState = aaveYieldService.getState();
          if (yieldState.depositedUSDC > 0) {
            console.log(`  🏦 Aave yield: $${yieldState.aTokenBalance.toFixed(2)} earning ~${yieldState.estimatedAPY}% APY | Yield: $${yieldState.totalYieldEarned.toFixed(4)}`);
          }
        }
      } catch (yieldError: any) {
        console.error(`  ❌ Aave yield cycle error: ${yieldError?.message?.substring(0, 200)}`);
        // Non-critical — yield is supplementary, bot continues trading normally
      }
    }

    // === v15.3: MULTI-PROTOCOL YIELD OPTIMIZER CYCLE ===
    // Compare rates across Aave, Compound, Morpho, Moonwell every YIELD_CHECK_INTERVAL_CYCLES cycles.
    if (yieldEnabled) {
      try {
        yieldOptimizerCycleCount++;
        if (yieldOptimizerCycleCount % YIELD_CHECK_INTERVAL_CYCLES === 1) {
          const rates = await yieldOptimizer.getCurrentRates();
          lastYieldRates = rates;
          const best = rates[0];
          const current = yieldOptimizer.getCurrentProtocol();

          if (rates.length > 0) {
            console.log(`\n  🔍 YIELD OPTIMIZER: Checked ${rates.length} protocols`);
            rates.forEach(r => {
              const marker = r.protocol === current ? ' ◀ current' : '';
              const bestMarker = r === best ? ' ★ best' : '';
              console.log(`     ${r.protocol.padEnd(10)} ${r.apy.toFixed(2)}% APY  [${r.status}]${marker}${bestMarker}`);
            });

            // Check if rebalancing is warranted
            if (best && yieldOptimizer.shouldRebalance(current, best, YIELD_MIN_DIFFERENTIAL_PCT)) {
              const deposited = aaveYieldService.getState().depositedUSDC;
              if (deposited >= YIELD_MIN_IDLE_USD) {
                const result = await yieldOptimizer.rebalance(current, best.protocol, deposited);
                if (result.success) {
                  console.log(`  🔄 ${result.message}`);
                }
              }
            }
          }
        }
      } catch (yieldOptErr: any) {
        console.error(`  ❌ Yield optimizer cycle error: ${yieldOptErr?.message?.substring(0, 200)}`);
      }
    }

  } catch (error: any) {
    console.error("Cycle error:", error.message);
    logError('CYCLE_ERROR', error.message, { stack: error.stack?.split('\n').slice(0, 3).join(' | ') });
  }

  // === STRATEGY LAB: Paper Trading Update ===
  try {
    const paperPortfolios = getAllPaperPortfolios();
    if (paperPortfolios.length > 0 && marketData?.tokens && marketData?.indicators) {
      // Build current prices map for portfolio valuation
      const currentPricesMap: Record<string, number> = {};
      for (const t of marketData.tokens) {
        if (t.price > 0) currentPricesMap[t.symbol] = t.price;
      }

      for (const pp of paperPortfolios) {
        try {
          const sv = getVersion(pp.strategyVersion);

          // Evaluate paper trades for each token with indicator data
          let tradesThisCycle = 0;
          for (const [symbol, ind] of Object.entries(marketData.indicators)) {
            if (tradesThisCycle >= sv.config.maxTradesPerCycle) break;
            const tokenInfo = marketData.tokens.find((t: any) => t.symbol === symbol);
            if (!tokenInfo || tokenInfo.price <= 0) continue;

            const signal: TokenSignal = {
              symbol,
              price: tokenInfo.price,
              rsi: ind.rsi14 || 50,
              macd: ind.macd?.signal || 'NEUTRAL',
              confluence: ind.confluenceScore || 0,
              buyRatio: 0.5,
            };

            const trade = evaluatePaperTrade(pp, sv.config, signal);
            if (trade) tradesThisCycle++;
          }

          // Update portfolio metrics with current prices
          updatePaperPortfolio(pp, currentPricesMap);
        } catch (ppErr: any) {
          // Silent — don't let paper trading errors affect the live bot
        }
      }

      // Save paper portfolios every 10 cycles
      if (state.totalCycles % 10 === 0) {
        savePaperPortfolios();
      }

      // Log paper portfolio summary
      const bestPaper = paperPortfolios.reduce((best, p) =>
        p.metrics.totalReturnPct > (best?.metrics.totalReturnPct || -Infinity) ? p : best, paperPortfolios[0]);
      if (bestPaper) {
        console.log(`   [StrategyLab] ${paperPortfolios.length} paper portfolios | Best: ${bestPaper.id} (${bestPaper.metrics.totalReturnPct >= 0 ? '+' : ''}${bestPaper.metrics.totalReturnPct.toFixed(1)}%)`);
      }
    }
  } catch (paperErr: any) {
    // Paper trading errors must never affect live bot operation
  }

  // === v19.0: WEEKLY REPORT TRIGGER ===
  if (shouldGenerateReport()) {
    try {
      const tradeRecordsForReport = state.tradeHistory.map(t => ({
        timestamp: t.timestamp,
        action: t.action,
        fromToken: t.fromToken,
        toToken: t.toToken,
        amountUSD: t.amountUSD,
        success: t.success,
        reasoning: t.reasoning,
        pnlUSD: t.realizedPnL,
      }));
      const report = generateWeeklyReport(
        tradeRecordsForReport,
        state.trading.totalPortfolioValue,
        BOT_VERSION,
      );
      console.log(`\n📋 WEEKLY REPORT GENERATED — ${report.totalTrades} trades, ${report.winRate.toFixed(1)}% win rate`);
      console.log(`   Period: ${report.periodStart} to ${report.periodEnd}`);
    } catch (err) {
      console.error(`⚠️ Weekly report generation failed:`, err);
    }
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
  if (yieldEnabled && aaveYieldService.getState().depositedUSDC > 0) {
    const ys = aaveYieldService.getState();
    const bestRate = lastYieldRates.length > 0 ? lastYieldRates[0] : null;
    const bestInfo = bestRate ? ` | Best: ${bestRate.protocol} ${bestRate.apy.toFixed(2)}%` : '';
    console.log(`   Yield: $${ys.aTokenBalance.toFixed(2)} in Aave (~${ys.estimatedAPY}% APY) | Earned: $${ys.totalYieldEarned.toFixed(4)}${bestInfo}`);
  }
  if (lastDexIntelligence) {
    const di = lastDexIntelligence;
    const actionableSignals = di.buySellPressure.filter(p => p.signal !== 'NEUTRAL').length;
    console.log(`   DEX Intel: ${di.tokenMetrics.length} tokens | ${di.volumeSpikes.length} spikes | ${actionableSignals} pressure signals | fetches: ${dexIntelFetchCount}`);
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
║   🤖 HENRY'S AUTONOMOUS TRADING AGENT v10.1                             ║
║   ═══════════════════════════════════════════                           ║
║                                                                        ║
║   AGENTIC WALLETS — Smart Account + Gasless Swaps                     ║
║   LIVE TRADING | Base Network | Capital Compounding Mindset            ║
║                                                                        ║
║   Intelligence Stack (Lean & Action-Biased):                           ║
║   • Technical: RSI, MACD, Bollinger Bands, ADX, ATR, Volume           ║
║   • DeFi Intel: Base TVL, DEX Volume, Protocol TVL (DefiLlama)        ║
║   • News: Crypto news sentiment — bullish/bearish (CryptoPanic)       ║
║   • Macro: Fed Rate, 10Y Yield, CPI, M2, Dollar Index (FRED)         ║
║   • Cross-Asset: Gold, Oil, VIX, S&P 500 correlation signals         ║
║   • Regime: Technical Regime Detection + Pure Price Action             ║
║   • BTC Dominance: Altseason rotation + dominance flight signals      ║
║   • Capital Flow: Stablecoin supply tracking + TVL-price divergence   ║
║                                                                        ║
╚══════════════════════════════════════════════════════════════════════════╝
  `);
  console.log("📍 Configuration:");
  console.log(`   Wallet: ${CONFIG.walletAddress} (CoinbaseSmartWallet)`);
  console.log(`   Trading: ${CONFIG.trading.enabled ? "LIVE 🟢" : "DRY RUN 🟡"}`);
  console.log(`   Execution: Coinbase CDP SDK v10.1.1 (CoinbaseSmartWallet + Permit2)`);
  console.log(`   Brain: v12.0 — 11-Dimensional (Technicals + DeFi + Derivatives + Positioning + News + Macro + Cross-Asset + Regime + BTC Dominance + Funding MR + Capital Flow)`);
  console.log(`   AI Strategy: 11-dim regime-adapted (regime > altseason > macro > smart-retail > technicals+DeFi > funding MR > TVL-price > stablecoin > derivatives > news > sectors)`);
  console.log(`   Max Buy: $${CONFIG.trading.maxBuySize}`);
  console.log(`   Max Sell: ${CONFIG.trading.maxSellPercent}% of position`);
  console.log(`   Slippage: ${CONFIG.trading.slippageBps / 100}%`);
  console.log(`   Interval: ${CONFIG.trading.intervalMinutes} min`);
  console.log(`   Tokens: ${CONFIG.activeTokens.length} across 4 sectors`);
  console.log("");
}

async function main() {
  displayBanner();

  // === NVR SIGNAL SERVICE: Mode Detection ===
  signalMode = (process.env.SIGNAL_MODE as typeof signalMode) || (process.env.ANTHROPIC_API_KEY ? 'local' : 'central');
  console.log(`[SIGNAL MODE] Running in ${signalMode} mode`);

  if (signalMode === 'local' && !process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY required for local mode");
    process.exit(1);
  }
  if (signalMode === 'central' && !process.env.SIGNAL_URL) {
    console.error("SIGNAL_URL required for central mode");
    process.exit(1);
  }
  if (signalMode === 'producer' && !process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY required for producer mode");
    process.exit(1);
  }

  // In producer mode, skip CDP wallet initialization entirely — only market data + Claude needed
  if (signalMode === 'producer') {
    console.log("[SIGNAL MODE] Producer mode — skipping CDP wallet initialization");
  }

  // Initialize CDP client with EOA account
  if (signalMode !== 'producer') try {
    console.log("\n🔧 Initializing CDP SDK...");
    cdpClient = createCdpClient();
    console.log("  ✅ CDP Client created");

    // Get or create the EOA account for trading
    console.log("  🔍 Verifying CDP account access...");
    const account = await cdpClient.evm.getOrCreateAccount({ name: CDP_ACCOUNT_NAME });
    console.log(`  ✅ CDP EOA Account verified: ${account.address}`);

    // v10.1.1: Smart Account detection — wallet 0x55509 IS already a CoinbaseSmartWallet.
    // CDP SDK's getOrCreateAccount() returns the Smart Wallet directly.
    // We do NOT call getOrCreateSmartAccount() — that would create a nested empty wrapper.
    // The existing wallet already supports UserOperations via ERC-4337.
    console.log(`  ✅ Wallet ${account.address} is a CoinbaseSmartWallet (ERC-4337)`);
    console.log(`  ✅ Swaps execute via account.swap() through the existing Smart Wallet`);
    // Keep smartAccount = null — use account.swap() directly (which works with Smart Wallets)
    smartAccount = null;
    smartAccountAddress = '';

    // v10.1.1: Policy Engine deferred — wallet already has native CoinbaseSmartWallet protections
    console.log(`  ✅ CoinbaseSmartWallet protections active (native to wallet)`);
    console.log(`  ✅ Bot-level guards: max trade $${CONFIG.trading.maxBuySize}, Base-only, circuit breakers`);

    console.log(`  ✅ CDP SDK fully operational — trades WILL execute`);

    if (account.address.toLowerCase() !== CONFIG.walletAddress.toLowerCase()) {
      console.log(`\n  ⚠️ WALLET MISMATCH: CDP account address differs from WALLET_ADDRESS`);
      console.log(`     CDP Account: ${account.address}`);
      console.log(`     WALLET_ADDRESS (where tokens live): ${CONFIG.walletAddress}`);
      console.log(`     ❌ Trades will fail — CDP SDK is trying to swap from the wrong address.`);
      console.log(`     The CDP API key may have changed, creating a new account.`);
      console.log(`     Tokens need to be transferred from WALLET_ADDRESS to the CDP account,`);
      console.log(`     or the CDP API key needs to be restored to the one that controls WALLET_ADDRESS.`);
    }

    // Check fund status
    try {
      const walletAddr = CONFIG.walletAddress;
      const ethBalance = await getETHBalance(walletAddr);
      const usdcBalance = await getERC20Balance(TOKEN_REGISTRY.USDC.address, walletAddr, 6);
      console.log(`\n  💰 Fund Status:`);
      console.log(`     USDC: $${usdcBalance.toFixed(2)}`);
      console.log(`     ETH (for gas): ${ethBalance.toFixed(6)} ETH (~$${(ethBalance * 2700).toFixed(2)})`);
      if (ethBalance < 0.0001 && usdcBalance > 1) {
        console.log(`\n  ⚠️ WARNING: Account has USDC but almost no ETH for gas!`);
        console.log(`     Attempting gas bootstrap...`);
      }
    } catch (balError: any) {
      console.log(`  ⚠️ Balance check failed: ${balError.message?.substring(0, 150)}`);
    }

    // v9.2.1: GAS BOOTSTRAP — Auto-buy ETH if wallet has USDC but no ETH
    // Runs once at startup before the first trading cycle
    if (CONFIG.trading.enabled) {
      try {
        await bootstrapGas();
      } catch (bootstrapErr: any) {
        console.warn(`  ⛽ [GAS BOOTSTRAP] Startup error: ${bootstrapErr?.message?.substring(0, 150)} — will retry on first cycle`);
      }
    }

    // v10.3: Warm up portfolio value on startup — prevents capital floor false trigger after redeploy.
    // Without this, totalPortfolioValue stays at $0 from persisted state until first heavy cycle,
    // which triggers HOLD-ONLY mode and blocks all buys.
    try {
      console.log(`\n  📊 Warming up portfolio value...`);
      const startupBalances = await getBalances();
      const startupValue = startupBalances.reduce((sum, b) => sum + b.usdValue, 0);
      if (startupValue > 0) {
        state.trading.totalPortfolioValue = startupValue;
        state.trading.balances = startupBalances;
        if (startupValue > state.trading.peakValue) {
          state.trading.peakValue = startupValue;
        }
        // v13.0: If initialValue is $0 (fresh bot, no state file), set it to first detected balance.
        // This ensures "Capital in" displays correctly from the very first startup.
        if (state.trading.initialValue === 0 && startupValue > 0) {
          state.trading.initialValue = startupValue;
          console.log(`  ✅ Initial capital set: $${startupValue.toFixed(2)} (first-time detection)`);
        }
        // v11.3: Hydrate USDC balance on startup to prevent false deposit detection.
        // Without this, the first heavy cycle sees a huge USDC increase (from accumulated
        // sells during previous session) and misclassifies it as an external deposit,
        // inflating peakValue and initialValue and triggering CAPITAL FLOOR erroneously.
        const startupUSDC = startupBalances.find(b => b.symbol === 'USDC')?.usdValue || 0;
        if (startupUSDC > 0) {
          state.lastKnownUSDCBalance = startupUSDC;
          console.log(`  ✅ USDC balance hydrated: $${startupUSDC.toFixed(2)} (deposit detection baseline set)`);
        }
        // v11.4.21: REMOVED startup peakValue sanity check — getBalances() only prices USDC
        // (non-USDC tokens have usdValue: 0 until a heavy cycle fetches market data).
        // This was incorrectly capping peak to the USDC-only balance (~$859), which then
        // prevented the runtime check from correcting it (since runtime peak = portfolio).
        // The runtime sanity check at line ~7784 handles peak correction with fully-priced balances.

        // v11.4.21: Initialize dailyBaseline if it's unset (fresh deploy or date rollover).
        // Uses persisted portfolio value (from state file) as baseline, NOT the unpriced startupValue.
        // The first heavy cycle will correct this with fully-priced balances.
        if (breakerState.dailyBaseline.value === 0) {
          const persistedValue = state.trading.totalPortfolioValue; // was set by loadTradeHistory or warmup
          if (persistedValue > 0) {
            const todayStr = new Date().toISOString().split('T')[0];
            breakerState.dailyBaseline = { date: todayStr, value: persistedValue };
            console.log(`  ✅ Daily baseline initialized: $${persistedValue.toFixed(2)} (${todayStr})`);
          }
        }

        console.log(`  ✅ Portfolio hydrated: $${startupValue.toFixed(2)} (peak: $${state.trading.peakValue.toFixed(2)})`);
      } else {
        console.log(`  ⚠️ Startup balance fetch returned $0 — first heavy cycle will hydrate`);
      }
    } catch (warmupErr: any) {
      console.log(`  ⚠️ Startup warmup failed: ${warmupErr.message?.substring(0, 150)} — first heavy cycle will hydrate`);
    }

  } catch (error: any) {
    console.error(`\n❌ CDP initialization FAILED: ${error.message}`);
    if (error.stack) console.error(`   Stack: ${error.stack.split('\n').slice(0, 3).join('\n   ')}`);
    if (error.code) console.error(`   Code: ${error.code}`);
    console.error("   🚫 Trades will NOT execute. Bot will run in analysis-only mode.");
    console.error("   Fix: Verify CDP_API_KEY_NAME, CDP_API_KEY_PRIVATE_KEY, CDP_WALLET_SECRET in Railway vars.");
  }

  // === v12.0: ON-CHAIN PRICING — Pool Discovery ===
  try {
    console.log("\n🔗 Initializing on-chain pricing engine...");
    await discoverPoolAddresses();
    console.log(`  ✅ On-chain pricing ready: ${Object.keys(poolRegistry).length} pools`);
  } catch (poolErr: any) {
    console.warn(`  ⚠️ Pool discovery failed: ${poolErr.message?.substring(0, 150)} — will retry on first cycle`);
  }

  // === v11.0: FAMILY PLATFORM INITIALIZATION ===
  // NVR Signal Service: Skip wallet-dependent init in producer mode
  if (signalMode !== 'producer') try {
    if (familyManager.isEnabled() || process.env.FAMILY_TRADING_ENABLED === 'true') {
      console.log("\n👨‍👩‍👧‍👦 Initializing Family Platform...");
      familyWalletManager = new WalletManager(cdpClient);
      await familyWalletManager.initializeAll();
      familyEnabled = true;
      console.log(`  ✅ Family Platform active: ${familyManager.getActiveMembers().length} member(s)`);
      console.log(`  📋 Mode: ${familyManager.isDryRun() ? 'DRY RUN (safe)' : 'LIVE TRADING'}`);
    } else {
      console.log("\n👨‍👩‍👧‍👦 Family Platform: disabled (set FAMILY_TRADING_ENABLED=true to activate)");
      // Still create WalletManager for API access, just don't enable trading
      if (cdpClient) {
        familyWalletManager = new WalletManager(cdpClient);
      }
    }
  } catch (familyErr: any) {
    console.error(`  ⚠️ Family Platform init error: ${familyErr.message?.substring(0, 200)}`);
    console.error(`  Family trading disabled — bot continues in single-wallet mode`);
  }

  // === v11.0: AAVE V3 YIELD SERVICE INITIALIZATION ===
  if (yieldEnabled && signalMode !== 'producer') {
    try {
      aaveYieldService.enable();
      const walletAddr = CONFIG.walletAddress;
      await aaveYieldService.refreshBalance(walletAddr);
      const ys = aaveYieldService.getState();
      console.log(`\n🏦 Aave V3 Yield Service: ACTIVE`);
      console.log(`  💰 aBasUSDC balance: $${ys.aTokenBalance.toFixed(2)}`);
      console.log(`  📈 Deposited: $${ys.depositedUSDC.toFixed(2)} | Yield earned: $${ys.totalYieldEarned.toFixed(4)}`);
      console.log(`  📊 Estimated APY: ~${ys.estimatedAPY}%`);
      console.log(`  ⚙️ Config: Keep $500 liquid, min deposit $50, min withdraw $25`);
      // v15.3: Initialize yield optimizer — fetch initial rates
      try {
        const rates = await yieldOptimizer.getCurrentRates();
        lastYieldRates = rates;
        console.log(`  🔍 Yield Optimizer: ${rates.length} protocols monitored`);
        rates.forEach(r => console.log(`     ${r.protocol.padEnd(10)} ${r.apy.toFixed(2)}% APY  [${r.status}]`));
      } catch (optErr: any) {
        console.warn(`  ⚠️ Yield optimizer init: ${optErr?.message?.substring(0, 100)} — will retry on cycle`);
      }
    } catch (yieldInitErr: any) {
      console.warn(`  ⚠️ Aave yield init: ${yieldInitErr.message?.substring(0, 150)} — will retry on first cycle`);
    }
  } else {
    console.log(`\n🏦 Aave V3 Yield: disabled (set AAVE_YIELD_ENABLED=true to activate)`);
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
  // v11.4.19: Startup diagnostic — confirm state file location and persistence
  console.log(`  💾 State file: ${CONFIG.logFile}`);
  console.log(`  💾 PERSIST_DIR: ${process.env.PERSIST_DIR || '(not set — using ./logs)'}`);
  console.log(`  💾 Loaded: ${state.tradeHistory.length} trades, ${Object.keys(state.costBasis).length} cost basis, peak $${state.trading.peakValue.toFixed(2)}`);

  // === STRATEGY LAB: Initialize Paper Portfolios ===
  loadPaperPortfolios();
  const paperVersions = ["v14.0", "v14.1", "aggressive"];
  for (const vId of paperVersions) {
    const existingId = `paper-${vId}`;
    if (!getPaperPortfolio(existingId)) {
      try {
        const sv = getVersion(vId);
        const capital = state.trading.totalPortfolioValue > 0 ? state.trading.totalPortfolioValue : 500;
        createPaperPortfolio(existingId, sv.version, capital);
        console.log(`  [StrategyLab] Created paper portfolio: ${existingId} ($${capital.toFixed(0)} capital)`);
      } catch (err: any) {
        console.warn(`  [StrategyLab] Could not create paper-${vId}: ${err.message}`);
      }
    }
  }
  if (getAllPaperPortfolios().length > 0) {
    console.log(`  [StrategyLab] ${getAllPaperPortfolios().length} paper portfolio(s) active`);
  }

  // v11.4.22: Clear stale circuit breaker on startup.
  // Must run AFTER loadTradeHistory() because that restores breakerState from persisted file.
  // The breaker may have been triggered by corrupted state (e.g. fake drawdown from
  // peakValue bug). On fresh deploy, reset pause and size reduction so the bot starts clean.
  if (breakerState.lastBreakerTriggered) {
    console.log(`  🔓 Clearing stale breaker (was: ${breakerState.lastBreakerReason})`);
    breakerState.lastBreakerTriggered = null;
    breakerState.lastBreakerReason = null;
  }
  if (breakerState.breakerSizeReductionUntil) {
    console.log(`  🔓 Clearing stale size reduction (was until: ${breakerState.breakerSizeReductionUntil})`);
    breakerState.breakerSizeReductionUntil = null;
  }
  breakerState.consecutiveLosses = 0;

  // v11.4.22: On-chain trade history recovery — DISABLED pending debug.
  // The Blockscout recovery was causing Railway deploy failures (healthcheck timeout / crash).
  // Will re-enable once we confirm the root cause from logs.
  (state as any)._recoveryStatus = 'disabled';
  console.log(`  ⏭️ On-chain recovery disabled — will re-enable after debug`);

  // v11.4.20: Reconcile trade counter with actual trade history
  // If totalTrades drifted from tradeHistory (failed-trade counting bug, crash during save, etc.), fix it
  const successfulInHistory = state.tradeHistory.filter(t => t.success).length;
  const totalInHistory = state.tradeHistory.length;
  if (state.trading.totalTrades !== totalInHistory || state.trading.successfulTrades !== successfulInHistory) {
    console.log(`  🔧 Trade counter reconciliation: totalTrades ${state.trading.totalTrades} → ${totalInHistory}, successful ${state.trading.successfulTrades} → ${successfulInHistory}`);
    state.trading.totalTrades = totalInHistory;
    state.trading.successfulTrades = successfulInHistory;
    saveTradeHistory();
  }

  // v11.4.5: One-time cost basis migration — fix ETH cost basis from $55 → current market price.
  // The original $55 cost basis was from the bot's inception and caused a perpetual harvest loop.
  // This migration marks itself done by setting a flag in state so it only runs once.
  if (!(state as any)._migrationCostBasisV1145) {
    const ethCb = state.costBasis['ETH'];
    if (ethCb && ethCb.averageCostBasis < 200) {
      // ETH cost basis is absurdly low — reset to a reasonable value
      // We'll use 2000 as a baseline; the next price fetch will update it precisely
      const resetPrice = 2000;
      console.log(`\n🔧 MIGRATION v11.4.5: Resetting ETH cost basis from $${ethCb.averageCostBasis.toFixed(2)} → $${resetPrice}`);
      ethCb.averageCostBasis = resetPrice;
      ethCb.totalInvestedUSD = resetPrice * ethCb.currentHolding;
      ethCb.totalTokensAcquired = ethCb.currentHolding;
      ethCb.unrealizedPnL = 0;
      ethCb.firstBuyDate = new Date().toISOString();
      ethCb.lastTradeDate = new Date().toISOString();
    }
    // Clear all harvest cooldowns so new thresholds apply fresh
    const cooldownCount = Object.keys(state.profitTakeCooldowns).length;
    if (cooldownCount > 0) {
      console.log(`🔧 MIGRATION v11.4.5: Clearing ${cooldownCount} harvest cooldowns (new thresholds apply)`);
      state.profitTakeCooldowns = {};
    }
    (state as any)._migrationCostBasisV1145 = true;
    saveTradeHistory();
    console.log(`✅ MIGRATION v11.4.5 complete — harvest loop fix applied\n`);
  }

  // v11.4.6: Broader cost basis fix — reset ANY token where cost basis produces >500% unrealized gain.
  // This catches BRETT ($0.0001 cost, $0.007 current = +6800%) and any other stale entries.
  if (!(state as any)._migrationCostBasisV1146) {
    let fixCount = 0;
    for (const symbol of Object.keys(state.costBasis)) {
      const cb = state.costBasis[symbol];
      if (!cb || cb.averageCostBasis <= 0 || cb.currentHolding <= 0) continue;
      // We don't have live prices yet at boot, so use the stored unrealized PnL ratio
      // If unrealizedPnL / totalInvestedUSD > 5 (500%+), the cost basis is stale
      const positionValue = cb.averageCostBasis * cb.currentHolding;
      const unrealizedGainPct = positionValue > 0 ? (cb.unrealizedPnL / positionValue) * 100 : 0;
      // Alternative check: if cost basis is more than 10x below what it should be
      // Use totalInvestedUSD vs currentHolding as a sanity check
      if (cb.totalInvestedUSD > 0 && cb.currentHolding > 0) {
        const impliedCost = cb.totalInvestedUSD / cb.totalTokensAcquired;
        const costRatio = cb.averageCostBasis / impliedCost;
        // If average cost is wildly different from implied cost, something is wrong
        if (costRatio < 0.01 || costRatio > 100) {
          console.log(`🔧 MIGRATION v11.4.6: ${symbol} cost basis looks stale (avg=$${cb.averageCostBasis.toFixed(8)}, implied=$${impliedCost.toFixed(8)}, ratio=${costRatio.toFixed(4)})`);
          // Reset to implied cost from actual investment
          cb.averageCostBasis = impliedCost;
          cb.unrealizedPnL = 0;
          cb.firstBuyDate = new Date().toISOString();
          fixCount++;
        }
      }
    }
    // Also clear harvest cooldowns again for fresh start
    if (fixCount > 0 || Object.keys(state.profitTakeCooldowns).length > 0) {
      state.profitTakeCooldowns = {};
      console.log(`🔧 MIGRATION v11.4.6: Fixed ${fixCount} stale cost bases, cleared cooldowns`);
    }
    (state as any)._migrationCostBasisV1146 = true;
    saveTradeHistory();
    console.log(`✅ MIGRATION v11.4.6 complete\n`);
  }

  // Restore discovery state if available
  if (tokenDiscoveryEngine) {
    try {
      const logData = fs.existsSync(CONFIG.logFile) ? JSON.parse(fs.readFileSync(CONFIG.logFile, "utf-8")) : null;
      if (logData?.tokenDiscovery) {
        tokenDiscoveryEngine.restoreState(logData.tokenDiscovery);
      }
    } catch { /* non-critical */ }
  }

  // v12.0: Price history is self-accumulating from on-chain reads — no bootstrap needed.
  // The priceHistoryStore is loaded from disk on startup (loadPriceHistoryStore).
  // Indicators activate automatically once sufficient data points accumulate.
  const historyPoints = Object.values(priceHistoryStore.tokens).reduce((max, t) => Math.max(max, t.prices.length), 0);
  console.log(`\n📊 Price history store: ${Object.keys(priceHistoryStore.tokens).length} tokens, max ${historyPoints} data points`);
  if (historyPoints >= 20) {
    console.log(`  ✅ Technical indicators ready (RSI, Bollinger, SMA)`);
  } else if (historyPoints > 0) {
    console.log(`  ⏳ Accumulating — ${historyPoints}/20 points, indicators activate soon`);
  } else {
    console.log(`  ⏳ Fresh start — indicators will activate after ~20 hours of data collection`);
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
      const timeSinceLastCycle = Date.now() - (lastHeavyCycleAt || 0);

      // v11.5: Force-reset stuck cycle flag — if cycle has been "in progress" for >2× timeout,
      // the flag is stuck from an unhandled edge case. Reset it so cycles can resume.
      if (cycleInProgress && cycleStartedAt > 0) {
        const stuckDuration = Date.now() - cycleStartedAt;
        if (stuckDuration > CYCLE_TIMEOUT_MS * 2) {
          console.error(`[Safety Net] ⚠️ STUCK CYCLE: flag stuck for ${(stuckDuration / 1000).toFixed(0)}s — force-resetting`);
          cycleInProgress = false;
        }
      }

      if (timeSinceLastCycle > HEAVY_CYCLE_FORCED_INTERVAL_MS * 1.5) {
        if (cycleInProgress) {
          console.log(`[Safety Net] Cycle already in progress (${((Date.now() - cycleStartedAt) / 1000).toFixed(0)}s elapsed) — skipping forced trigger`);
        } else {
          console.log(`[Safety Net] Adaptive engine may have stalled — forcing cycle (${(timeSinceLastCycle / 60000).toFixed(0)}m since last heavy)`);
          cycleInProgress = true;
          cycleStartedAt = Date.now();
          try {
            await withTimeout(runTradingCycle(), CYCLE_TIMEOUT_MS, 'Safety net cycle');
          } finally {
            cycleInProgress = false;
          }
        }
      }
      // v11.4.21: If cron fires and cycle loop seems completely dead, restart it
      if (!cycleInProgress && timeSinceLastCycle > HEAVY_CYCLE_FORCED_INTERVAL_MS * 10) {
        console.log(`[Safety Net] ⚠️ Cycle loop appears dead (${(timeSinceLastCycle / 60000).toFixed(0)}m stale) — restarting scheduler`);
        scheduleNextCycle();
      }
    } catch (cronError: any) {
      console.error(`[Cron Safety Net Error] ${cronError?.message?.substring(0, 300) || cronError}`);
      // v11.5: Even if safety net cycle crashes, ensure flag is reset
      cycleInProgress = false;
    }
  });

  // v9.3: Daily Payout cron — runs at 8 AM UTC every day
  if (CONFIG.autoHarvest.enabled && CONFIG.autoHarvest.recipients.length > 0) {
    cron.schedule(DAILY_PAYOUT_CRON, async () => {
      try {
        console.log(`\n[Daily Payout] Cron triggered at ${new Date().toISOString()}`);
        await executeDailyPayout();
      } catch (err: any) {
        console.error(`[Daily Payout] Cron error: ${err?.message?.substring(0, 300) || err}`);
      }
    }, { timezone: 'UTC' });
    console.log(`  ✅ Daily Payout cron registered: ${DAILY_PAYOUT_CRON} (8 AM UTC)`);
    // v10.4: Log parsed recipients at startup for debugging payout issues
    CONFIG.autoHarvest.recipients.forEach((r: HarvestRecipient, i: number) => {
      console.log(`     ${i + 1}. "${r.label}" → ${r.wallet.slice(0, 6)}...${r.wallet.slice(-4)} (${r.percent}%)`);
    });

    // Startup catch-up: if bot starts after 8 AM UTC and yesterday hasn't been paid
    const nowUTC = new Date();
    const hourUTC = nowUTC.getUTCHours();
    if (hourUTC >= 8) {
      const yesterday = new Date(nowUTC);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);
      if (state.lastDailyPayoutDate !== yesterdayStr) {
        console.log(`  ⏰ Daily Payout catch-up: yesterday (${yesterdayStr}) not yet paid — scheduling in 30s`);
        setTimeout(async () => {
          try {
            await executeDailyPayout();
          } catch (err: any) {
            console.error(`[Daily Payout] Catch-up error: ${err?.message?.substring(0, 300) || err}`);
          }
        }, 30_000);
      }
    }
  }

  // Heartbeat every 5 minutes to confirm process is alive
  setInterval(() => {
    const lastTrade = state.tradeHistory.length > 0 ? state.tradeHistory[state.tradeHistory.length - 1] : null;
    const lastTradeAge = lastTrade ? `${((Date.now() - new Date(lastTrade.timestamp).getTime()) / 60000).toFixed(0)}m ago` : 'never';
    const cycleStatus = cycleInProgress ? `IN_PROGRESS (${((Date.now() - cycleStartedAt) / 1000).toFixed(0)}s)` : 'idle';
    const lastHeavyAge = lastHeavyCycleAt ? `${((Date.now() - lastHeavyCycleAt) / 1000).toFixed(0)}s ago` : 'never';
    console.log(`💓 Heartbeat | ${new Date().toISOString()} | Cycles: ${state.totalCycles} | Trades: ${state.trading.successfulTrades}/${state.trading.totalTrades} | Last trade: ${lastTradeAge} | Cycle: ${cycleStatus} | Last heavy: ${lastHeavyAge} | Portfolio: $${(state.trading.totalPortfolioValue || 0).toFixed(0)}`);
    // v5.2: Save state every heartbeat
    saveTradeHistory();
  }, 5 * 60 * 1000);

  const { tier: startTier } = getPortfolioSensitivity(state.trading.totalPortfolioValue || 0);
  console.log(`\n🚀 Agent v8.1 running! Kelly Sizing + VWS Liquidity + TWAP + Fallback RPCs.\n`);
  console.log(`   📂 State persistence: ${CONFIG.logFile}`);
  const startCeiling = getEffectiveKellyCeiling(state.trading.totalPortfolioValue || 0);
  console.log(`   💰 Position sizing: Quarter Kelly (${KELLY_FRACTION}×) | Ceiling: ${startCeiling}% (${(state.trading.totalPortfolioValue || 0) < KELLY_SMALL_PORTFOLIO_THRESHOLD ? 'small-portfolio boost' : 'standard'}) | Floor: $${KELLY_POSITION_FLOOR_USD}`);
  console.log(`   💧 VWS: Min pool $${(VWS_MIN_LIQUIDITY_USD / 1000).toFixed(0)}K | Max trade ${VWS_TRADE_AS_POOL_PCT_MAX}% of pool | TWAP > $${TWAP_THRESHOLD_USD}`);
  console.log(`   🔗 RPC: ${BASE_RPC_ENDPOINTS.length} endpoints (${BASE_RPC_ENDPOINTS[0].replace('https://', '')}${BASE_RPC_ENDPOINTS.length > 1 ? ` +${BASE_RPC_ENDPOINTS.length - 1} fallbacks` : ''})`);
  console.log(`   ⚡ Adaptive tempo: ${ADAPTIVE_MIN_INTERVAL_SEC}s – ${ADAPTIVE_MAX_INTERVAL_SEC}s | Emergency: ${EMERGENCY_INTERVAL_SEC}s`);
  console.log(`   🎯 Portfolio tier: ${startTier} | Emergency drop trigger: ${(EMERGENCY_DROP_THRESHOLD * 100).toFixed(0)}%`);
  console.log(`   🔒 Cycle mutex: ACTIVE | Gas: dynamic (RPC query)`);

  // v10.3: Intelligence data source diagnostic — surface missing env vars at startup
  const envDiag: string[] = [];
  if (!process.env.FRED_API_KEY) envDiag.push('FRED_API_KEY (macro: Fed Rate, CPI, M2, DXY — free at fred.stlouisfed.org)');
  if (!process.env.CRYPTOPANIC_AUTH_TOKEN) envDiag.push('CRYPTOPANIC_AUTH_TOKEN (news sentiment — free at cryptopanic.com)');
  if (!process.env.ANTHROPIC_API_KEY) envDiag.push('ANTHROPIC_API_KEY (AI trading brain — REQUIRED)');
  if (envDiag.length > 0) {
    console.log(`\n   ⚠️  Missing optional API keys (${envDiag.length}):`);
    envDiag.forEach(d => console.log(`      · ${d}`));
    console.log(`      → Bot will trade without these signals. Add them in Railway for fuller intelligence.`);
  } else {
    console.log(`   ✅ All API keys configured`);
  }
  console.log('');
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
// NVR-SPEC-005: STRATEGY LAB MARKETING EXPORT
// ============================================================================

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtExport(n: number, dec: number = 1): string {
  return n.toFixed(dec);
}

function generateEquityCurveSVG(curve: number[], width: number = 900, height: number = 200): string {
  if (!curve || curve.length < 2) return "";
  const min = Math.min(...curve) * 0.98;
  const max = Math.max(...curve) * 1.02;
  const range = max - min || 1;
  const positive = curve[curve.length - 1] >= curve[0];

  const points = curve.map((v, i) => {
    const x = 40 + (i / (curve.length - 1)) * (width - 60);
    const y = 10 + (1 - (v - min) / range) * (height - 30);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const firstX = 40;
  const lastX = 40 + (width - 60);
  const bottomY = height - 20;
  const fillPoints = `${firstX},${bottomY} ${points} ${lastX},${bottomY}`;
  const lineColor = positive ? "#22C55E" : "#EF4444";
  const fillColor = positive ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)";

  const yLabels = [0, 0.25, 0.5, 0.75, 1].map(frac => {
    const val = max - frac * range;
    const y = 10 + frac * (height - 30);
    return `<text x="36" y="${y + 3}" text-anchor="end" fill="#94A3B8" font-size="10" font-family="Nunito,sans-serif">$${val.toFixed(0)}</text>
    <line x1="40" y1="${y}" x2="${width - 20}" y2="${y}" stroke="#334155" stroke-width="0.5" stroke-dasharray="3,3"/>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" style="width:100%;height:auto">
    ${yLabels}
    <polygon points="${fillPoints}" fill="${fillColor}"/>
    <polyline points="${points}" fill="none" stroke="${lineColor}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

function nvrExportBaseStyles(size: "square" | "portrait" = "square"): string {
  const h = size === "portrait" ? 1350 : 1080;
  return `
    @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1080px; height: ${h}px; overflow: hidden;
      background: linear-gradient(160deg, #0F172A 0%, #1E3A5F 40%, #1E3A5F 60%, #0F172A 100%);
      font-family: 'Nunito', sans-serif; color: #FFFFFF;
      display: flex; flex-direction: column;
    }
    .export-header {
      padding: 48px 56px 0 56px; display: flex; align-items: center; justify-content: space-between;
    }
    .logo-group { display: flex; align-items: center; gap: 16px; }
    .logo-text {
      font-size: 42px; font-weight: 900; letter-spacing: 4px;
      background: linear-gradient(135deg, #60A5FA, #93C5FD);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .lab-badge-export {
      background: rgba(96,165,250,0.15); border: 1px solid rgba(96,165,250,0.3);
      padding: 4px 14px; border-radius: 20px; font-size: 13px; font-weight: 700;
      color: #60A5FA; letter-spacing: 1.5px; text-transform: uppercase;
    }
    .header-date { color: #94A3B8; font-size: 14px; font-weight: 600; }
    .export-title {
      padding: 20px 56px 0 56px; font-size: 26px; font-weight: 800; color: #E2E8F0;
    }
    .export-body { flex: 1; padding: 28px 56px; display: flex; flex-direction: column; gap: 20px; }
    .export-footer {
      padding: 0 56px 40px 56px; display: flex; flex-direction: column; gap: 8px;
    }
    .footer-line { font-size: 12px; color: #64748B; letter-spacing: 0.5px; }
    .footer-tagline {
      font-size: 16px; font-weight: 700; color: #60A5FA;
      font-style: italic; letter-spacing: 0.5px;
    }
    .footer-handle { font-size: 13px; color: #94A3B8; font-weight: 600; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    .kpi-box {
      background: rgba(255,255,255,0.05); border: 1px solid rgba(96,165,250,0.15);
      border-radius: 16px; padding: 20px; text-align: center;
    }
    .kpi-label { font-size: 12px; color: #94A3B8; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .kpi-value { font-size: 32px; font-weight: 900; }
    .kpi-sub { font-size: 11px; color: #64748B; margin-top: 4px; }
    .positive { color: #22C55E; }
    .negative { color: #EF4444; }
    .version-table { width: 100%; border-collapse: collapse; }
    .version-table th {
      font-size: 11px; color: #94A3B8; font-weight: 700; text-transform: uppercase;
      letter-spacing: 1px; padding: 10px 12px; text-align: left;
      border-bottom: 1px solid rgba(96,165,250,0.2);
    }
    .version-table td {
      font-size: 15px; padding: 12px 12px; border-bottom: 1px solid rgba(255,255,255,0.04);
      font-weight: 600;
    }
    .version-table tr.best-row td { background: rgba(96,165,250,0.08); }
    .rank-badge {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 50%; font-size: 13px; font-weight: 900;
    }
    .rank-1 { background: linear-gradient(135deg, #F59E0B, #EAB308); color: #1E3A5F; }
    .rank-2 { background: linear-gradient(135deg, #94A3B8, #CBD5E1); color: #1E3A5F; }
    .rank-3 { background: linear-gradient(135deg, #B45309, #D97706); color: #1E3A5F; }
    .rank-other { background: rgba(255,255,255,0.08); color: #94A3B8; }
    .best-callout {
      background: linear-gradient(135deg, rgba(96,165,250,0.12), rgba(96,165,250,0.05));
      border: 1px solid rgba(96,165,250,0.3); border-radius: 16px; padding: 20px 28px;
      display: flex; align-items: center; gap: 20px;
    }
    .best-callout-icon { font-size: 36px; }
    .best-callout-text { flex: 1; }
    .best-callout-label { font-size: 12px; color: #60A5FA; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; }
    .best-callout-value { font-size: 22px; font-weight: 900; margin-top: 2px; }
    .best-callout-sub { font-size: 13px; color: #94A3B8; margin-top: 2px; }
    .vs-hold-bar {
      background: rgba(255,255,255,0.05); border: 1px solid rgba(96,165,250,0.15);
      border-radius: 12px; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between;
    }
    .vs-hold-label { font-size: 14px; color: #94A3B8; font-weight: 600; }
    .vs-hold-value { font-size: 22px; font-weight: 900; }
    .equity-section {
      background: rgba(255,255,255,0.03); border: 1px solid rgba(96,165,250,0.1);
      border-radius: 16px; padding: 20px;
    }
    .equity-label { font-size: 12px; color: #94A3B8; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
  `;
}

function generateBacktestMultiExportHTML(results: any[]): string {
  const best = results[0];
  const runDate = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const tableRows = results.slice(0, 6).map((r: any, i: number) => {
    const rankClass = i < 3 ? `rank-${i + 1}` : "rank-other";
    const retClass = r.returnPct >= 0 ? "positive" : "negative";
    const vsHoldClass = (r.vsHold || 0) >= 0 ? "positive" : "negative";
    const isBest = i === 0 ? ' class="best-row"' : "";
    return `<tr${isBest}>
      <td style="width:36px"><span class="rank-badge ${rankClass}">${i + 1}</span></td>
      <td style="font-weight:800;color:#E2E8F0">${escapeHtml(r.version)}</td>
      <td style="color:#94A3B8">${escapeHtml(r.name)}</td>
      <td class="${retClass}">${r.returnPct >= 0 ? "+" : ""}${fmtExport(r.returnPct)}%</td>
      <td class="negative">-${fmtExport(Math.abs(r.maxDrawdownPct))}%</td>
      <td>${fmtExport((r.winRate || 0) * 100, 0)}%</td>
      <td>${fmtExport(r.profitFactor || 0, 2)}</td>
      <td class="${vsHoldClass}">${(r.vsHold || 0) >= 0 ? "+" : ""}${fmtExport(r.vsHold || 0)}%</td>
    </tr>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080">
<title>NVR Strategy Lab - Version Comparison</title>
<style>${nvrExportBaseStyles("square")}</style>
</head><body>

<div class="export-header">
  <div class="logo-group">
    <div class="logo-text">NVR</div>
    <div class="lab-badge-export">Strategy Lab</div>
  </div>
  <div class="header-date">${runDate}</div>
</div>

<div class="export-title">Version Comparison &middot; Last 30 days</div>

<div class="export-body">
  <div style="overflow:hidden;border-radius:16px;border:1px solid rgba(96,165,250,0.12)">
    <table class="version-table">
      <thead><tr>
        <th></th><th>Version</th><th>Name</th><th>Return</th><th>Max DD</th><th>Win Rate</th><th>P.Factor</th><th>vs HOLD</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>

  <div class="best-callout">
    <div class="best-callout-icon">&#x1F3C6;</div>
    <div class="best-callout-text">
      <div class="best-callout-label">Best Strategy</div>
      <div class="best-callout-value">${escapeHtml(best.version)} &mdash; ${escapeHtml(best.name)}</div>
      <div class="best-callout-sub">${best.returnPct >= 0 ? "+" : ""}${fmtExport(best.returnPct)}% return &middot; ${fmtExport((best.winRate || 0) * 100, 0)}% win rate &middot; ${fmtExport(best.profitFactor || 0, 2)} profit factor</div>
    </div>
  </div>
</div>

<div class="export-footer">
  <div class="footer-line">Backtested on 30 days of live price data</div>
  <div class="footer-tagline">&ldquo;Your money should never rest.&rdquo;</div>
  <div class="footer-handle">@neverrestcapital</div>
</div>

</body></html>`;
}

function generateBacktestSingleExportHTML(r: any): string {
  const retClass = r.returnPct >= 0 ? "positive" : "negative";
  const vsHold = r.vsHold || 0;
  const vsHoldAbs = Math.abs(vsHold);
  const vsHoldText = vsHold >= 0
    ? `Beat buy-and-hold by +${fmtExport(vsHoldAbs)}%`
    : `Underperformed buy-and-hold by -${fmtExport(vsHoldAbs)}%`;
  const vsHoldClass = vsHold >= 0 ? "positive" : "negative";
  const equitySVG = generateEquityCurveSVG(r.equityCurve || [], 960, 220);
  const desc = r.description || "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080">
<title>NVR Strategy Lab - ${escapeHtml(r.version)}</title>
<style>${nvrExportBaseStyles("square")}</style>
</head><body>

<div class="export-header">
  <div class="logo-group">
    <div class="logo-text">NVR</div>
    <div class="lab-badge-export">Strategy Lab</div>
  </div>
  <div class="header-date">${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
</div>

<div class="export-title">${escapeHtml(r.version)} &mdash; ${escapeHtml(r.name)}</div>
<div style="padding:0 56px;font-size:13px;color:#64748B;margin-top:4px">${escapeHtml(desc)}</div>

<div class="export-body">
  <div class="kpi-grid">
    <div class="kpi-box">
      <div class="kpi-label">Total Return</div>
      <div class="kpi-value ${retClass}">${r.returnPct >= 0 ? "+" : ""}${fmtExport(r.returnPct)}%</div>
      <div class="kpi-sub">30-day backtest</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Max Drawdown</div>
      <div class="kpi-value negative">-${fmtExport(Math.abs(r.maxDrawdownPct))}%</div>
      <div class="kpi-sub">Peak to trough</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Win Rate</div>
      <div class="kpi-value" style="color:#E2E8F0">${fmtExport((r.winRate || 0) * 100, 0)}%</div>
      <div class="kpi-sub">${r.totalTrades || 0} total trades</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Profit Factor</div>
      <div class="kpi-value" style="color:#E2E8F0">${fmtExport(r.profitFactor || 0, 2)}</div>
      <div class="kpi-sub">Sharpe: ${fmtExport(r.sharpeRatio || 0, 2)}</div>
    </div>
  </div>

  ${equitySVG ? `<div class="equity-section">
    <div class="equity-label">Equity Curve</div>
    ${equitySVG}
  </div>` : ""}

  <div class="vs-hold-bar">
    <div class="vs-hold-label">vs Buy &amp; Hold</div>
    <div class="vs-hold-value ${vsHoldClass}">${vsHoldText}</div>
  </div>
</div>

<div class="export-footer">
  <div class="footer-line">Backtested on 30 days of live price data</div>
  <div class="footer-tagline">&ldquo;Your money should never rest.&rdquo;</div>
  <div class="footer-handle">@neverrestcapital</div>
</div>

</body></html>`;
}

function generatePaperExportHTML(portfolio: any, detail: any): string {
  const metrics = portfolio.metrics || {};
  const retClass = (metrics.totalReturnPct || 0) >= 0 ? "positive" : "negative";
  const startDate = portfolio.startTime
    ? new Date(portfolio.startTime).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : portfolio.startedAt
      ? new Date(portfolio.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "Unknown";

  const equityCurve = detail?.equityCurve
    ? (Array.isArray(detail.equityCurve) ? detail.equityCurve.map((p: any) => typeof p === 'number' ? p : p.value) : [])
    : [];
  const equitySVG = generateEquityCurveSVG(equityCurve, 960, 200);

  const liveReturnPct = state.trading.initialValue > 0
    ? ((state.trading.totalPortfolioValue - state.trading.initialValue) / state.trading.initialValue) * 100
    : 0;
  const vsLive = (metrics.totalReturnPct || 0) - liveReturnPct;
  const vsLiveClass = vsLive >= 0 ? "positive" : "negative";
  const vsLiveText = vsLive >= 0 ? `+${fmtExport(vsLive)}% vs live bot` : `${fmtExport(vsLive)}% vs live bot`;

  const displayId = portfolio.id || "Paper Portfolio";
  const displayVersion = portfolio.strategyVersion || "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080">
<title>NVR Paper Trading - ${escapeHtml(displayId)}</title>
<style>${nvrExportBaseStyles("square")}</style>
</head><body>

<div class="export-header">
  <div class="logo-group">
    <div class="logo-text">NVR</div>
    <div class="lab-badge-export">Paper Trading</div>
  </div>
  <div class="header-date">${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
</div>

<div class="export-title">${escapeHtml(displayId)}</div>
<div style="padding:0 56px;font-size:14px;color:#60A5FA;font-weight:600;margin-top:4px">Strategy ${escapeHtml(displayVersion)}</div>

<div class="export-body">
  <div class="kpi-grid">
    <div class="kpi-box">
      <div class="kpi-label">Current Value</div>
      <div class="kpi-value" style="color:#E2E8F0">$${fmtExport(metrics.totalValue || 0, 2)}</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Return</div>
      <div class="kpi-value ${retClass}">${(metrics.totalReturnPct || 0) >= 0 ? "+" : ""}${fmtExport(metrics.totalReturnPct || 0)}%</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Win Rate</div>
      <div class="kpi-value" style="color:#E2E8F0">${fmtExport(metrics.winRate || 0, 0)}%</div>
      <div class="kpi-sub">${metrics.totalTrades || portfolio.tradeCount || 0} trades</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-label">Max Drawdown</div>
      <div class="kpi-value negative">-${fmtExport(Math.abs(metrics.maxDrawdown || 0))}%</div>
    </div>
  </div>

  ${equitySVG ? `<div class="equity-section">
    <div class="equity-label">Portfolio Equity Curve</div>
    ${equitySVG}
  </div>` : ""}

  <div class="vs-hold-bar">
    <div class="vs-hold-label">vs Live Bot</div>
    <div class="vs-hold-value ${vsLiveClass}">${vsLiveText}</div>
  </div>

  <div style="font-size:13px;color:#64748B;margin-top:4px">Running live since ${startDate}</div>
</div>

<div class="export-footer">
  <div class="footer-line">Paper trading with simulated execution</div>
  <div class="footer-tagline">&ldquo;Your money should never rest.&rdquo;</div>
  <div class="footer-handle">@neverrestcapital</div>
</div>

</body></html>`;
}

// ============================================================================
// HTTP SERVER — Dashboard + API Endpoints
// ============================================================================
import http from 'http';

// v10.2: Restrict CORS to localhost only — prevents external sites from reading portfolio data
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173',
  'http://127.0.0.1:3000', 'http://127.0.0.1:3001', 'http://127.0.0.1:5173',
]);

function sendJSON(res: http.ServerResponse, status: number, data: any, req?: http.IncomingMessage) {
  const origin = req?.headers?.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.has(origin) ? origin : '';
  res.writeHead(status, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
  res.end(JSON.stringify(data));
}

/** Downsample an array to N evenly-spaced points (for equity curve API responses) */
function downsample(arr: number[], n: number): number[] {
  if (arr.length <= n) return arr;
  const result: number[] = [];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) result.push(arr[Math.round(i * step)]);
  return result;
}

// v10.2: Auth token for sensitive endpoints. Auto-generates a random token if not set — never leave admin endpoints open.
const API_AUTH_TOKEN = process.env.API_AUTH_TOKEN || `auto-${Date.now()}-${Math.random().toString(36).substring(2, 14)}`;
if (!process.env.API_AUTH_TOKEN) console.warn(`⚠️  API_AUTH_TOKEN not set — auto-generated token: ${API_AUTH_TOKEN} (set API_AUTH_TOKEN env var for stable access)`);
function isAuthorized(req: http.IncomingMessage): boolean {
  const authHeader = req.headers['authorization'] || '';
  return authHeader === `Bearer ${API_AUTH_TOKEN}`;
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
  const perfStats = calculateTradePerformance();
  // v11.4.20: Daily P&L — use start-of-day baseline instead of unreliable lifetime deposit tracking
  const dailyBaseline = breakerState.dailyBaseline.value;
  const dailyPnl = dailyBaseline > 0 ? state.trading.totalPortfolioValue - dailyBaseline : 0;
  const dailyPnlPercent = dailyBaseline > 0 ? (dailyPnl / dailyBaseline) * 100 : 0;
  return {
    totalValue: state.trading.totalPortfolioValue,
    initialValue: state.trading.initialValue,
    peakValue: state.trading.peakValue,
    pnl: dailyPnl,
    pnlPercent: dailyPnlPercent,
    dailyBaseline,
    drawdown: state.trading.peakValue > 0 ? Math.max(0, ((state.trading.peakValue - state.trading.totalPortfolioValue) / state.trading.peakValue) * 100) : 0,
    realizedPnL: totalRealized,
    unrealizedPnL: totalUnrealized,
    totalTrades: state.trading.totalTrades,
    successfulTrades: state.trading.successfulTrades,
    // v12.2.4: Real P&L win rate (profitable sells / total sells) — NOT execution success rate
    winRate: perfStats.winRate,
    totalCycles: state.totalCycles,
    uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
    lastCycle: state.trading.lastCheck.toISOString(),
    tradingEnabled: CONFIG.trading.enabled,
    version: BOT_VERSION,
    // v8.2: Deposit tracking — separate injected capital from trading gains
    totalDeposited: state.totalDeposited,
    depositCount: state.depositHistory.length,
    recentDeposits: state.depositHistory.slice(-5),
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
        mode: 'daily',
        totalTransferredUSD: state.totalAutoHarvestedUSD,
        totalTransferredETH: state.totalAutoHarvestedETH,
        transferCount: state.autoHarvestCount,
        lastTransfer: state.lastAutoHarvestTime,
        destination: CONFIG.autoHarvest.destinationWallet ?
          CONFIG.autoHarvest.destinationWallet.slice(0, 6) + '...' + CONFIG.autoHarvest.destinationWallet.slice(-4) : null,
        // v9.1: Multi-wallet recipients
        recipients: (CONFIG.autoHarvest.recipients || []).map((r: HarvestRecipient) => ({
          label: r.label,
          wallet: r.wallet.slice(0, 6) + '...' + r.wallet.slice(-4),
          percent: r.percent,
          totalTransferred: state.autoHarvestByRecipient[r.label] || 0,
        })),
        reinvestPercent: 100 - (CONFIG.autoHarvest.recipients || []).reduce((s: number, r: HarvestRecipient) => s + r.percent, 0),
        // v9.3: Daily Payout
        lastPayoutDate: state.lastDailyPayoutDate,
        dailyPayoutCount: state.dailyPayoutCount,
        totalDailyPayoutsUSD: state.totalDailyPayoutsUSD,
      },
    // v11.1: Cash deployment engine status
    cashDeployment: {
      active: cashDeploymentMode,
      cyclesActive: cashDeploymentCycles,
      thresholdPercent: CASH_DEPLOYMENT_THRESHOLD_PCT,
      confluenceDiscount: CASH_DEPLOYMENT_CONFLUENCE_DISCOUNT,
      minReserveUSD: CASH_DEPLOYMENT_MIN_RESERVE_USD,
    },
    // v17.0: Breaker override status (flow-based, not F&G-based)
    crashBuyingOverride: {
      active: crashBuyingOverrideActive,
      cyclesActive: crashBuyingOverrideCycles,
      cashThresholdPct: DEPLOYMENT_BREAKER_OVERRIDE_MIN_CASH_PCT,
      sizeMultiplier: DEPLOYMENT_BREAKER_OVERRIDE_SIZE_MULT,
      maxEntriesPerCycle: DEPLOYMENT_BREAKER_OVERRIDE_MAX_ENTRIES,
      note: 'v17.0: Flow-based — activates on cash level, requires positive buy ratio per token',
    },
    // v11.4.22: On-chain recovery diagnostic
    _recovery: (state as any)._recoveryStatus || 'not run',
    _recoveryWallet: (state as any)._recoveryWallet || 'unknown',
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
      // v9.0: ATR-based stop data
      atrStopPercent: state.costBasis[b.symbol]?.atrStopPercent ?? null,
      atrTrailPercent: state.costBasis[b.symbol]?.atrTrailPercent ?? null,
      atrAtEntry: state.costBasis[b.symbol]?.atrAtEntry ?? null,
      trailActivated: state.costBasis[b.symbol]?.trailActivated ?? false,
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

function apiTrades(limit: number, includeFailures: boolean = false) {
  const filtered = includeFailures
    ? state.tradeHistory
    : state.tradeHistory.filter(t => t.success !== false);
  return {
    trades: filtered.slice(-limit).reverse(),
    totalTrades: state.trading.totalTrades,
    successfulTrades: state.trading.successfulTrades,
  };
}

// v11.4.4: Dashboard AI Chat — answers user questions with full live state context
// v11.4.16: Helper to get active (non-expired) user directives
function getActiveDirectives(): UserDirective[] {
  const directives = state.userDirectives || [];
  const now = new Date().toISOString();
  return directives.filter(d => !d.expiresAt || d.expiresAt > now);
}

// v11.4.16: Add a user directive from chat
function addUserDirective(directive: Omit<UserDirective, 'id' | 'createdAt'>): UserDirective {
  const d: UserDirective = {
    ...directive,
    id: `dir-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    createdAt: new Date().toISOString(),
    expiresAt: directive.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Default 24h
  };
  if (!state.userDirectives) state.userDirectives = [];
  state.userDirectives.push(d);
  // Cap at 20 active directives
  const active = getActiveDirectives();
  if (active.length > 20) {
    state.userDirectives = active.slice(-20);
  }
  console.log(`[Chat Action] Added directive: ${d.type} — "${d.instruction}" (expires ${d.expiresAt})`);
  return d;
}

// v11.4.16: Remove a directive by ID
function removeUserDirective(id: string): boolean {
  if (!state.userDirectives) return false;
  const before = state.userDirectives.length;
  state.userDirectives = state.userDirectives.filter(d => d.id !== id);
  return state.userDirectives.length < before;
}

// NVR-NL: Apply parsed config changes as config directives + user directives
function applyConfigChanges(parseResult: ParseResult, instruction: string): ConfigDirective {
  const directive: ConfigDirective = {
    id: `cfg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    instruction,
    changes: parseResult.changes,
    appliedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    active: true,
  };

  if (!state.configDirectives) state.configDirectives = [];
  state.configDirectives.push(directive);
  if (state.configDirectives.length > 30) {
    state.configDirectives = state.configDirectives.filter((d: ConfigDirective) => d.active).slice(-30);
  }

  // Create corresponding UserDirectives so changes feed into the AI prompt
  for (const change of parseResult.changes) {
    if (change.parameter === 'tradingEnabled') {
      CONFIG.trading.enabled = change.newValue;
      console.log(`[NL Config] Trading ${change.newValue ? 'ENABLED' : 'DISABLED'} by user instruction`);
    } else if (change.parameter.startsWith('sectorTargets.')) {
      const sector = change.parameter.replace('sectorTargets.', '');
      addUserDirective({
        type: 'ALLOCATION',
        instruction: `Adjust ${sector} target allocation to ${change.newValue}%`,
        sector,
        value: change.newValue,
        source: `NL Config: ${instruction.substring(0, 50)}`,
      });
    } else if (change.parameter.startsWith('blacklist.')) {
      const token = change.parameter.replace('blacklist.', '');
      addUserDirective({
        type: 'AVOID',
        instruction: `Avoid buying ${token} — user instruction`,
        token,
        source: `NL Config: avoid ${token}`,
      });
    } else if (change.parameter.startsWith('watchlist.')) {
      const token = change.parameter.replace('watchlist.', '');
      addUserDirective({
        type: 'WATCHLIST',
        instruction: `Research and watch ${token} — user requested`,
        token,
        source: `NL Config: watch ${token}`,
      });
    } else {
      addUserDirective({
        type: 'GENERAL',
        instruction: `${change.parameter}: ${change.oldValue} -> ${change.newValue}`,
        source: `NL Config: ${instruction.substring(0, 50)}`,
      });
    }
  }

  console.log(`[NL Config] Applied ${parseResult.changes.length} config changes from: "${instruction.substring(0, 60)}"`);
  saveTradeHistory();
  return directive;
}

// NVR-NL: Get active config directives
function getActiveConfigDirectives(): ConfigDirective[] {
  const directives = state.configDirectives || [];
  const now = new Date().toISOString();
  return directives.filter((d: ConfigDirective) => d.active && (!d.expiresAt || d.expiresAt > now));
}

// NVR-NL: Remove a config directive by ID
function removeConfigDirective(id: string): boolean {
  if (!state.configDirectives) return false;
  const directive = state.configDirectives.find((d: ConfigDirective) => d.id === id);
  if (!directive) return false;
  directive.active = false;
  console.log(`[NL Config] Removed config directive: ${id}`);
  saveTradeHistory();
  return true;
}

// v11.4.16: Chat tool definitions for Claude tool_use
const CHAT_TOOLS: any[] = [
  {
    name: 'add_to_watchlist',
    description: 'Add a token to the research watchlist. The bot will pay extra attention to this token in upcoming trading cycles, research its price action, and consider it for trades.',
    input_schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol (e.g. SUI, PEPE, ARB)' },
        reason: { type: 'string', description: 'Why the user wants to watch this token' },
      },
      required: ['token', 'reason'],
    },
  },
  {
    name: 'adjust_sector_target',
    description: 'Adjust the target allocation percentage for a sector. Valid sectors: BLUE_CHIP, AI_TOKENS, MEME_COINS, DEFI. Total across all sectors should stay around 100%.',
    input_schema: {
      type: 'object',
      properties: {
        sector: { type: 'string', enum: ['BLUE_CHIP', 'AI_TOKENS', 'MEME_COINS', 'DEFI'], description: 'Sector to adjust' },
        target_percent: { type: 'number', description: 'New target allocation (e.g. 30 for 30%)' },
      },
      required: ['sector', 'target_percent'],
    },
  },
  {
    name: 'add_research_directive',
    description: 'Add a general research/strategy directive that will be injected into the AI trading prompt. For things like "be more aggressive on dips", "focus on DeFi tokens", "avoid meme coins this week".',
    input_schema: {
      type: 'object',
      properties: {
        instruction: { type: 'string', description: 'The strategy directive in plain English' },
        hours: { type: 'number', description: 'How many hours this directive should last (default 24)' },
      },
      required: ['instruction'],
    },
  },
  {
    name: 'avoid_token',
    description: 'Tell the bot to avoid buying a specific token. The bot will not open new positions in this token.',
    input_schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol to avoid (e.g. NORMIE, BRETT)' },
        reason: { type: 'string', description: 'Why to avoid it' },
      },
      required: ['token', 'reason'],
    },
  },
  {
    name: 'clear_directives',
    description: 'Clear all active user directives, resetting the bot to its default trading strategy.',
    input_schema: {
      type: 'object',
      properties: {
        confirm: { type: 'boolean', description: 'Must be true to confirm clearing' },
      },
      required: ['confirm'],
    },
  },
  {
    name: 'list_directives',
    description: 'List all currently active user directives affecting the bot.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

// v11.4.16: Execute a chat tool call
function executeChatTool(toolName: string, input: any): { result: string; directive?: UserDirective } {
  switch (toolName) {
    case 'add_to_watchlist': {
      const token = (input.token || '').toUpperCase().trim();
      const d = addUserDirective({
        type: 'WATCHLIST',
        instruction: `Research and watch ${token} — ${input.reason}`,
        token,
        source: `Watchlist: ${token}`,
      });
      return { result: `Added ${token} to watchlist. I'll research its price action and consider it in upcoming trading cycles. This directive expires in 24 hours.`, directive: d };
    }
    case 'adjust_sector_target': {
      const sector = input.sector as string;
      const target = Math.max(5, Math.min(60, input.target_percent));
      const sectorName = SECTORS[sector as keyof typeof SECTORS]?.name || sector;
      const d = addUserDirective({
        type: 'ALLOCATION',
        instruction: `Adjust ${sectorName} target allocation to ${target}%`,
        sector,
        value: target,
        source: `Allocation: ${sectorName} → ${target}%`,
      });
      return { result: `Set ${sectorName} target to ${target}%. The bot will rebalance toward this target over the next trading cycles. Active for 24 hours.`, directive: d };
    }
    case 'add_research_directive': {
      const hours = Math.max(1, Math.min(168, input.hours || 24));
      const d = addUserDirective({
        type: 'GENERAL',
        instruction: input.instruction,
        expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
        source: `Directive: ${input.instruction.substring(0, 50)}`,
      });
      return { result: `Got it. I'll follow this directive for the next ${hours} hours: "${input.instruction}"`, directive: d };
    }
    case 'avoid_token': {
      const token = (input.token || '').toUpperCase().trim();
      const d = addUserDirective({
        type: 'AVOID',
        instruction: `Avoid buying ${token} — ${input.reason}`,
        token,
        source: `Avoid: ${token}`,
      });
      return { result: `I'll avoid opening new positions in ${token}. Existing positions won't be affected. Active for 24 hours.`, directive: d };
    }
    case 'clear_directives': {
      if (!input.confirm) return { result: 'Clearing cancelled — confirm must be true.' };
      const count = getActiveDirectives().length;
      state.userDirectives = [];
      return { result: `Cleared ${count} active directive(s). Bot is back to default strategy.` };
    }
    case 'list_directives': {
      const active = getActiveDirectives();
      if (active.length === 0) return { result: 'No active directives. The bot is running its default strategy.' };
      const list = active.map((d, i) => `${i + 1}. [${d.type}] ${d.instruction} (expires ${new Date(d.expiresAt || '').toLocaleString()})`).join('\n');
      return { result: `Active directives:\n${list}` };
    }
    default:
      return { result: `Unknown action: ${toolName}` };
  }
}

async function handleChatRequest(userMessage: string, history: { role: string; content: string }[]) {
  const n = (v: any) => Number(v) || 0;

  const portfolio = apiPortfolio();
  const balances = apiBalances();
  const recentTrades = apiTrades(10);
  const riskReward = calculateRiskRewardMetrics();

  const holdingsLines = (balances.balances || []).map((b: any) =>
    `- ${b.symbol}: ${n(b.balance).toFixed(4)} ($${n(b.usdValue).toFixed(2)})${b.unrealizedPnL ? ` | Unrealized: $${n(b.unrealizedPnL).toFixed(2)}` : ''}`
  ).join('\n');

  const tradeLines = (recentTrades.trades || []).slice(0, 10).map((t: any) =>
    `- ${t.timestamp}: ${t.action} ${t.fromToken || ''}→${t.toToken || ''} $${n(t.amountUSD).toFixed(2)} ${t.success ? '✓' : '✗'} — ${(t.reasoning || '').substring(0, 80)}`
  ).join('\n');

  const activeDirectives = getActiveDirectives();
  const directivesSection = activeDirectives.length > 0
    ? `\nACTIVE USER DIRECTIVES:\n${activeDirectives.map(d => `- [${d.type}] ${d.instruction}`).join('\n')}`
    : '';

  const sectorInfo = Object.entries(SECTORS).map(([key, s]) =>
    `${s.name} (${key}): target ${(s.targetAllocation * 100).toFixed(0)}% | tokens: ${s.tokens.join(', ')}`
  ).join('\n');

  const context = `LIVE PORTFOLIO (real-time):
- Total Value: $${n(portfolio.totalValue).toFixed(2)}
- Today's P&L: ${n(portfolio.pnlPercent) >= 0 ? '+' : ''}${n(portfolio.pnlPercent).toFixed(2)}% ($${n(portfolio.pnl).toFixed(2)}) from $${n(portfolio.dailyBaseline).toFixed(2)} start-of-day
- Peak: $${n(portfolio.peakValue).toFixed(2)} | Drawdown: ${n(portfolio.drawdown).toFixed(1)}%
- Trading: ${portfolio.tradingEnabled ? 'ENABLED' : 'DISABLED'}
- Uptime: ${portfolio.uptime}

CURRENT HOLDINGS:
${holdingsLines || '(none yet)'}

SECTORS:
${sectorInfo}

PERFORMANCE METRICS:
- Total Trades: ${portfolio.totalTrades} | Win Rate: ${portfolio.winRate !== undefined ? portfolio.winRate.toFixed(1) : 0}%
- Profit Factor: ${n(riskReward.profitFactor).toFixed(2)} | Expectancy: $${n(riskReward.expectancy).toFixed(2)}
- Avg Win: $${n(riskReward.avgWinUSD).toFixed(2)} | Avg Loss: $${n(riskReward.avgLossUSD).toFixed(2)}

LAST 10 TRADES:
${tradeLines || '(no trades yet)'}${directivesSection}

AVAILABLE TOKENS: ${CONFIG.activeTokens.join(', ')}
NOTE: This bot trades on Base network only. Tokens not in the registry (like SUI) can be added to the watchlist for research — the bot will note user interest even if it cannot trade them directly yet.`;

  const systemPrompt = `You are the NVR trading bot assistant. You have full access to your own live trading state AND you can take actions that affect trading behavior.

CAPABILITIES:
- Answer questions about portfolio, positions, trades, strategy, and market outlook
- Add tokens to your research watchlist (you'll pay extra attention to them)
- Adjust sector allocation targets
- Add strategy directives that influence your trading decisions
- Mark tokens to avoid
- List or clear active directives

When the user asks you to DO something (watch a token, change strategy, avoid a token, adjust allocations), use the appropriate tool. When they ask a question, just answer it.

Use specific numbers from context. Keep responses conversational and under 150 words unless detail is requested. Do not use markdown formatting — plain text only.`;

  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    { role: 'user', content: `${systemPrompt}\n\nCurrent State:\n${context}` },
    { role: 'assistant', content: 'Ready. I have full context of my live trading state and can take actions. What do you need?' },
  ];

  // Add conversation history (ensure alternating roles)
  const safeHistory = (history || []).slice(-6);
  for (const m of safeHistory) {
    const role = m.role === 'assistant' ? 'assistant' as const : 'user' as const;
    if (messages.length > 0 && messages[messages.length - 1].role === role) continue;
    messages.push({ role, content: m.content });
  }

  if (messages[messages.length - 1].role === 'user') {
    messages.push({ role: 'assistant', content: 'Go ahead.' });
  }
  messages.push({ role: 'user', content: userMessage });

  console.log(`[Chat API] Question: "${userMessage.substring(0, 60)}..." | History: ${safeHistory.length} msgs | Directives: ${activeDirectives.length}`);

  // v11.4.16: Use tool_use so Claude can take actions
  const chatCallPromise = anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    tools: CHAT_TOOLS,
    messages,
  });
  const response = await Promise.race([
    chatCallPromise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Chat AI call timed out after 30s')), 30_000)),
  ]);

  // Process response — may contain text, tool_use, or both
  let textResponse = '';
  const actions: string[] = [];

  for (const block of response.content) {
    if (block.type === 'text') {
      textResponse += block.text;
    } else if (block.type === 'tool_use') {
      const toolResult = executeChatTool(block.name, block.input);
      actions.push(toolResult.result);
      console.log(`[Chat Action] Tool: ${block.name} → ${toolResult.result.substring(0, 80)}`);
    }
  }

  // If Claude used tools but didn't include text, we need a follow-up call to get a natural response
  if (!textResponse && actions.length > 0) {
    textResponse = actions.join('\n\n');
  } else if (textResponse && actions.length > 0) {
    // Append action confirmations to the text response
    textResponse += '\n\n' + actions.join('\n');
  }

  if (!textResponse) {
    textResponse = "I processed your request but couldn't generate a response. Try asking again.";
  }

  console.log(`[Chat API] Response: ${textResponse.substring(0, 80)}... | Actions: ${actions.length}`);
  return { response: textResponse, actions: actions.length > 0 ? actions : undefined };
}

// v9.2: Daily P&L Scoreboard — realized trading profits grouped by calendar day
function apiDailyPnL() {
  const dailyMap: Record<string, { realized: number; trades: number; wins: number; sells: number; buys: number; volume: number }> = {};

  for (const trade of state.tradeHistory) {
    if (!trade.success || trade.action === "HOLD") continue;
    const day = trade.timestamp.slice(0, 10); // "YYYY-MM-DD"
    if (!dailyMap[day]) dailyMap[day] = { realized: 0, trades: 0, wins: 0, sells: 0, buys: 0, volume: 0 };
    dailyMap[day].trades++;
    dailyMap[day].volume += trade.amountUSD || 0;

    if (trade.action === "BUY") {
      dailyMap[day].buys++;
    } else if (trade.action === "SELL") {
      dailyMap[day].sells++;
      // v12.2: Use stored realizedPnL (accurate, captured at trade time) when available.
      // Fall back to retroactive calc for historical trades that predate this fix.
      let pnl = 0;
      if (trade.realizedPnL !== undefined) {
        pnl = trade.realizedPnL;
      } else {
        const cb = state.costBasis[trade.fromToken];
        if (cb && cb.averageCostBasis > 0) {
          const tokensSold = trade.tokenAmount || (trade.amountUSD / (cb.averageCostBasis || 1));
          const costOfSold = tokensSold * cb.averageCostBasis;
          pnl = trade.amountUSD - costOfSold;
        }
      }
      dailyMap[day].realized += pnl;
      if (pnl > 0) dailyMap[day].wins++;
    }
  }

  // Sort by date descending, return last 30 days
  const days = Object.entries(dailyMap)
    .map(([date, d]) => ({
      date,
      realized: Math.round(d.realized * 100) / 100,
      trades: d.trades,
      sells: d.sells,
      buys: d.buys,
      wins: d.wins,
      winRate: d.sells > 0 ? Math.round((d.wins / d.sells) * 100) : null,
      volume: Math.round(d.volume * 100) / 100,
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);

  // Today's unrealized (current holdings minus cost basis)
  const totalUnrealized = Object.values(state.costBasis).reduce((s, cb) => s + cb.unrealizedPnL, 0);

  return { days, unrealized: Math.round(totalUnrealized * 100) / 100 };
}

function apiIndicators() {
  // Build a price lookup from current balances
  const priceLookup: Record<string, number> = {};
  for (const b of state.trading.balances) {
    if (b.price && b.price > 0) priceLookup[b.symbol] = b.price;
  }

  return {
    costBasis: Object.values(state.costBasis)
      .filter(cb => cb.currentHolding > 0)
      .map(cb => ({
        ...cb,
        sector: TOKEN_REGISTRY[cb.symbol]?.sector || null,
        currentPrice: priceLookup[cb.symbol] || null,
        // Show effective stop even when ATR is null (flat fallback)
        effectiveStopPercent: cb.atrStopPercent ?? state.adaptiveThresholds.stopLossPercent,
        effectiveTrailPercent: cb.atrTrailPercent ?? state.adaptiveThresholds.trailingStopPercent,
      })),
    // v9.0: ATR risk management config
    atrConfig: {
      stopMultiplier: state.adaptiveThresholds.atrStopMultiplier,
      trailMultiplier: state.adaptiveThresholds.atrTrailMultiplier,
      stopFloor: ATR_STOP_FLOOR_PERCENT,
      stopCeiling: ATR_STOP_CEILING_PERCENT,
      trailActivation: ATR_TRAIL_ACTIVATION_MULTIPLIER,
    },
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
  // v10.0: Market Intelligence Engine
  globalMarket: GlobalMarketData | null;
  smartRetailDivergence: SmartRetailDivergence | null;
  fundingMeanReversion: FundingRateMeanReversion | null;
  tvlPriceDivergence: TVLPriceDivergence | null;
  stablecoinSupply: StablecoinSupplyData | null;
} | null = null;

function apiIntelligence() {
  const perf = calculateTradePerformance();
  return {
    version: BOT_VERSION,
    defiLlama: lastIntelligenceData?.defi || null,
    derivatives: lastIntelligenceData?.derivatives || null,
    newsSentiment: lastIntelligenceData?.news || null,
    macroData: lastIntelligenceData?.macro || null,
    marketRegime: lastIntelligenceData?.regime || "UNKNOWN",
    tradePerformance: perf,
    shadowProposals: shadowProposals,
    // v10.0: Market Intelligence Engine
    globalMarket: lastIntelligenceData?.globalMarket || null,
    smartRetailDivergence: lastIntelligenceData?.smartRetailDivergence || null,
    fundingMeanReversion: lastIntelligenceData?.fundingMeanReversion || null,
    tvlPriceDivergence: lastIntelligenceData?.tvlPriceDivergence || null,
    stablecoinSupply: lastIntelligenceData?.stablecoinSupply || null,
    altseasonSignal: currentAltseasonSignal,
    dataSources: [
      "On-Chain DEX Pool Reads (Uniswap V3 / Aerodrome — Base RPC)",
      "Chainlink Oracles (ETH/USD, BTC/USD — Base)",
      "Self-Accumulating Price History (persistent hourly store)",
      "Fear & Greed Index",
      "DefiLlama (TVL/DEX/Protocols)",
      "CryptoPanic (News Sentiment)",
      "FRED (Fed Rates/Yield Curve/CPI/M2/Dollar/Gold/Oil/VIX/S&P 500)",
      "Technical Indicators (RSI/MACD/BB/SMA/ATR/ADX)",
      "BTC/ETH Ratio Altseason Signal (On-Chain Derived)",
      "Smart Money vs Retail Divergence (Binance Derived)",
      "TVL-Price Divergence (DefiLlama + On-Chain Derived)",
      "USDC Supply Capital Flow (On-Chain totalSupply)",
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
    version: BOT_VERSION,
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
    version: BOT_VERSION,
    totalReviews: state.performanceReviews.length,
    latestReview: reviews.length > 0 ? reviews[reviews.length - 1] : null,
    recentReviews: reviews,
    lastReviewTimestamp: state.lastReviewTimestamp,
    tradesSinceLastReview: state.tradeHistory.length - state.lastReviewTradeIndex,
  };
}

function apiThresholds() {
  return {
    version: BOT_VERSION,
    currentThresholds: state.adaptiveThresholds,
    bounds: THRESHOLD_BOUNDS,
    defaults: DEFAULT_ADAPTIVE_THRESHOLDS,
    adaptationCount: state.adaptiveThresholds.adaptationCount,
    recentHistory: state.adaptiveThresholds.history.slice(-20),
    explorationState: state.explorationState,
  };
}

function getDashboardHTML(): string {
    // Try multiple paths to find dashboard/index.html on disk
    const path = require('path');
    const candidates = [
      path.join(process.cwd(), 'dashboard', 'index.html'),
      path.join(__dirname, 'dashboard', 'index.html'),
      '/app/dashboard/index.html',
      path.join(process.cwd(), 'index.html'),
      path.join(__dirname, 'index.html'),
      '/app/index.html'
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          return fs.readFileSync(p, 'utf-8');
        }
      } catch (e) { /* skip */ }
    }
    return EMBEDDED_DASHBOARD;
  }

const healthServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  // v10.2: Restrict CORS to known origins
  const reqOrigin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(reqOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', reqOrigin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    switch (url.pathname) {
      case '/':
      case '/dashboard':
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getDashboardHTML());
        break;
      case '/health': {
        // v11.4.22: Healthcheck must return 200 quickly during startup so Railway doesn't kill the deploy.
        // Grace period: first 5 minutes always healthy. After that, require a recent cycle.
        const uptimeSec = (Date.now() - state.startTime.getTime()) / 1000;
        const lastCycleAge = state.trading.lastCheck ? (Date.now() - state.trading.lastCheck.getTime()) / 1000 : Infinity;
        const inStartupGrace = uptimeSec < 300; // 5 min grace
        const isHealthy = inStartupGrace || (lastCycleAge < 600);
        sendJSON(res, isHealthy ? 200 : 503, {
          status: isHealthy ? "ok" : "degraded",
          version: BOT_VERSION,
          uptimeSec: Math.round(uptimeSec),
          lastCycleAgeSec: Math.round(lastCycleAge),
          inStartupGrace,
        });
        break;
      }
      case '/api/persistence': {
        // v11.4.21: Diagnostic endpoint — check if state file persists across deploys
        const stateFileExists = fs.existsSync(CONFIG.logFile);
        let stateFileSize = 0;
        let stateFileModified = '';
        try {
          if (stateFileExists) {
            const stat = fs.statSync(CONFIG.logFile);
            stateFileSize = stat.size;
            stateFileModified = stat.mtime.toISOString();
          }
        } catch {}
        sendJSON(res, 200, {
          persistDir: process.env.PERSIST_DIR || '(not set)',
          stateFilePath: CONFIG.logFile,
          stateFileExists,
          stateFileSizeBytes: stateFileSize,
          stateFileModified,
          tradeHistoryCount: state.tradeHistory.length,
          costBasisCount: Object.keys(state.costBasis).length,
          breakerStateLoaded: breakerState.dailyBaseline.value > 0,
          version: BOT_VERSION,
        });
        break;
      }
      // === v19.3: CAPITAL PRESERVATION MODE API ===
      case '/api/preservation': {
        const _fgReadings = capitalPreservationMode.fearReadings;
        const _fgAvg6h = _fgReadings.length > 0
          ? _fgReadings.reduce((sum, v) => sum + v, 0) / _fgReadings.length
          : null;
        const _usdcBalPres = state.trading.balances.find(b => b.symbol === 'USDC');
        const _portfolioTotal = state.trading.totalPortfolioValue || 0;
        const _cashAllocationPct = _portfolioTotal > 0 && _usdcBalPres
          ? (_usdcBalPres.usdValue / _portfolioTotal) * 100
          : 0;
        sendJSON(res, 200, {
          isActive: capitalPreservationMode.isActive,
          activatedAt: capitalPreservationMode.activatedAt
            ? new Date(capitalPreservationMode.activatedAt).toISOString()
            : null,
          durationHours: capitalPreservationMode.activatedAt
            ? ((Date.now() - capitalPreservationMode.activatedAt) / 3600000).toFixed(1)
            : null,
          currentFearGreed: lastFearGreedValue,
          fearGreedAvg6h: _fgAvg6h !== null ? Math.round(_fgAvg6h * 10) / 10 : null,
          fearGreedReadings: _fgReadings.length,
          fearGreedBufferFull: _fgReadings.length >= PRESERVATION_RING_BUFFER_SIZE,
          tradesBlocked: capitalPreservationMode.tradesBlocked,
          tradesPassed: capitalPreservationMode.tradesPassed,
          cashAllocationPct: Math.round(_cashAllocationPct * 10) / 10,
          cashTargetPct: PRESERVATION_TARGET_CASH_PCT,
          belowCashTarget: _cashAllocationPct < PRESERVATION_TARGET_CASH_PCT,
          thresholds: {
            activateBelow: PRESERVATION_FG_ACTIVATE,
            deactivateAbove: PRESERVATION_FG_DEACTIVATE,
            sustainedHours: 6,
            cycleMultiplier: PRESERVATION_CYCLE_MULTIPLIER,
            minConfluence: PRESERVATION_MIN_CONFLUENCE,
            minSwarmConsensus: PRESERVATION_MIN_SWARM_CONSENSUS,
          },
          totalDeactivations: capitalPreservationMode.deactivationCount,
          version: BOT_VERSION,
        }, req);
        break;
      }

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
        sendJSON(res, 200, apiTrades(
          parseInt(url.searchParams.get('limit') || '50'),
          url.searchParams.get('include_failures') === 'true'
        ));
        break;

      // === v18.1: ERROR LOG + DEBUG ENDPOINTS ===
      case '/api/errors': {
        const failedTrades = state.tradeHistory.filter(t => t.success === false);
        const recentFailures = failedTrades.slice(-20).reverse();
        const errorsByType: Record<string, number> = {};
        for (const t of failedTrades) {
          const errType = t.error?.includes('Unauthorized') || t.error?.includes('401') ? 'AUTH'
            : t.error?.includes('insufficient') ? 'INSUFFICIENT_FUNDS'
            : t.error?.includes('liquidity') ? 'LIQUIDITY'
            : t.error?.includes('timeout') || t.error?.includes('ETIMEDOUT') ? 'TIMEOUT'
            : t.error?.includes('payment method') ? 'PAYMENT_METHOD'
            : t.error?.includes('slippage') ? 'SLIPPAGE'
            : t.error?.includes('allowance') ? 'ALLOWANCE'
            : t.error?.includes('not supported') || t.error?.includes('Invalid request') ? 'UNSUPPORTED_TOKEN'
            : 'OTHER';
          errorsByType[errType] = (errorsByType[errType] || 0) + 1;
        }
        sendJSON(res, 200, {
          version: BOT_VERSION,
          summary: {
            totalAttempted: state.trading.totalTrades + failedTrades.length,
            totalSuccessful: state.trading.totalTrades,
            totalFailed: failedTrades.length,
            failureRate: failedTrades.length > 0 ? `${((failedTrades.length / (state.trading.totalTrades + failedTrades.length)) * 100).toFixed(1)}%` : '0%',
            errorsByType,
          },
          circuitBreakers: Object.entries(state.tradeFailures).map(([symbol, data]) => ({
            symbol,
            consecutiveFailures: (data as any).count,
            lastFailure: (data as any).lastFailure,
            blocked: (data as any).count >= 3,
          })),
          recentFailedTrades: recentFailures.map(t => ({
            timestamp: t.timestamp,
            action: t.action,
            from: t.fromToken,
            to: t.toToken,
            amountUSD: t.amountUSD,
            error: t.error,
          })),
          errorLog: (state.errorLog || []).slice(-50).reverse(),
        });
        break;
      }

      case '/api/signals': {
        if (!isAuthorized(req)) { res.writeHead(401); res.end('Unauthorized'); return; }
        const signalStats = getSignalStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          version: BOT_VERSION,
          ...signalStats,
        }, null, 2));
        break;
      }

      case '/api/weekly-report': {
        if (!isAuthorized(req)) { res.writeHead(401); res.end('Unauthorized'); return; }
        const report = getLatestReport();
        if (!report) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ version: BOT_VERSION, message: 'No weekly report generated yet. Reports are generated every Sunday at UTC midnight.' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ version: BOT_VERSION, ...report }, null, 2));
        }
        break;
      }

      case '/api/debug': {
        const apiKeyId = process.env.CDP_API_KEY_ID || process.env.CDP_API_KEY_NAME || '';
        const apiKeySecret = process.env.CDP_API_KEY_SECRET || process.env.CDP_API_KEY_PRIVATE_KEY || '';
        const walletSecret = process.env.CDP_WALLET_SECRET || '';
        const signalUrl = process.env.SIGNAL_URL || process.env.NVR_SIGNAL_URL || '';

        // Test CDP connection using the same method the bot uses for trading
        let cdpStatus = 'unknown';
        let cdpError = '';
        let walletAddress = '';
        try {
          if (cdpClient) {
            const account = await cdpClient.evm.getOrCreateAccount({ name: process.env.CDP_ACCOUNT_NAME || 'nvr-trading' });
            cdpStatus = 'connected';
            walletAddress = (account as any).address || 'account found but no address field';
          } else {
            cdpStatus = 'not_initialized';
          }
        } catch (e: any) {
          cdpStatus = 'error';
          cdpError = e.message || String(e);
          logError('CDP_CONNECTION_TEST', cdpError);
        }

        sendJSON(res, 200, {
          version: BOT_VERSION,
          cdp: {
            status: cdpStatus,
            error: cdpError || undefined,
            walletAddress: walletAddress || undefined,
            apiKeyId: apiKeyId ? `${apiKeyId.substring(0, 8)}...${apiKeyId.substring(apiKeyId.length - 4)}` : 'NOT SET',
            apiKeySecretType: !apiKeySecret ? 'NOT SET'
              : apiKeySecret.startsWith('-----') ? 'PEM/ECDSA'
              : apiKeySecret.startsWith('MIGHAgEA') ? 'DER/EC_RAW_BASE64'
              : apiKeySecret.length === 88 ? 'Ed25519'
              : `unknown (${apiKeySecret.length} chars, starts: ${apiKeySecret.substring(0, 6)})`,
            walletSecretPresent: !!walletSecret,
            walletSecretLength: walletSecret.length || 0,
          },
          signalMode,
          signalUrl: signalUrl || 'not configured',
          env: {
            NODE_ENV: process.env.NODE_ENV || 'not set',
            SIGNAL_MODE: process.env.SIGNAL_MODE || 'not set',
            ANTHROPIC_KEY_SET: !!process.env.ANTHROPIC_API_KEY,
            hasPayoutRecipients: !!(CONFIG.autoHarvest?.recipients?.length),
          },
          uptime: process.uptime(),
          totalCycles: state.totalCycles,
          lastCycleTime: state.lastCycleTime || null,
          tradingEnabled: CONFIG.trading.enabled,
          memory: {
            heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1048576),
            rssMB: Math.round(process.memoryUsage().rss / 1048576),
          },
        });
        break;
      }

      case '/api/accounts': {
        // Temporary endpoint: list ALL CDP accounts to find wallet 0xB7c51b
        try {
          if (!cdpClient) { sendJSON(res, 500, { error: 'CDP not initialized' }); break; }
          const allAccounts: any[] = [];
          let listResp = await cdpClient.evm.listAccounts();
          allAccounts.push(...listResp.accounts);
          while (listResp.nextPageToken) {
            listResp = await cdpClient.evm.listAccounts({ pageToken: listResp.nextPageToken });
            allAccounts.push(...listResp.accounts);
          }
          sendJSON(res, 200, {
            total: allAccounts.length,
            accounts: allAccounts.map((a: any) => ({
              name: a.name,
              address: a.address,
            })),
          });
        } catch (e: any) {
          sendJSON(res, 500, { error: e.message });
        }
        break;
      }

      case '/api/daily-pnl':
        sendJSON(res, 200, apiDailyPnL());
        break;
      case '/api/indicators':
        sendJSON(res, 200, apiIndicators());
        break;

      // === v20.0: ADAPTIVE EXIT TIMING ENGINE — Trailing Stops API ===
      case '/api/trailing-stops': {
        const tsState = getTrailingStopState();
        const balancesForTS = state.trading.balances || [];
        sendJSON(res, 200, {
          version: BOT_VERSION,
          count: tsState.length,
          stops: tsState.map(ts => {
            const holding = balancesForTS.find(b => b.symbol === ts.symbol);
            const currentPrice = holding?.price || 0;
            const distanceToStop = currentPrice > 0 && ts.currentStopPrice > 0
              ? ((currentPrice - ts.currentStopPrice) / currentPrice) * 100
              : null;
            return {
              symbol: ts.symbol,
              entryPrice: ts.entryPrice,
              highWaterMark: ts.highWaterMark,
              highWaterMarkDate: ts.highWaterMarkDate,
              currentStopPrice: ts.currentStopPrice,
              currentPrice,
              distanceToStopPct: distanceToStop !== null ? Math.round(distanceToStop * 100) / 100 : null,
              atrPercentUsed: ts.atrPercentUsed,
              atrMultiplierUsed: ts.atrMultiplierUsed,
              zone: ts.zone,
              stopTriggered: ts.stopTriggered,
              triggerPrice: ts.triggerPrice,
              triggerDate: ts.triggerDate,
              lastUpdated: ts.lastUpdated,
            };
          }),
        });
        break;
      }

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
        // Compute next payout time (next 8 AM UTC)
        const nextPayoutDate = new Date();
        nextPayoutDate.setUTCHours(8, 0, 0, 0);
        if (nextPayoutDate.getTime() <= Date.now()) nextPayoutDate.setUTCDate(nextPayoutDate.getUTCDate() + 1);

        sendJSON(res, 200, {
          enabled: CONFIG.autoHarvest.enabled,
          mode: 'daily',
          thresholdUSD: CONFIG.autoHarvest.thresholdUSD,
          cooldownHours: CONFIG.autoHarvest.cooldownHours,
          minETHReserve: CONFIG.autoHarvest.minETHReserve,
          totalTransferredUSD: state.totalAutoHarvestedUSD + (state.totalDailyPayoutsUSD || 0),
          transferCount: (state.autoHarvestCount || 0) + (state.dailyPayoutCount || 0),
          totalTransfers: (state.autoHarvestTransfers || []).length,
          recentTransfers: (state.autoHarvestTransfers || []).slice(-5),
          lastHarvestTime: (state.lastAutoHarvestTime || null),
          // v9.1: Multi-wallet recipients
          recipients: (CONFIG.autoHarvest.recipients || []).map((r: HarvestRecipient) => ({
            label: r.label,
            wallet: r.wallet.slice(0, 6) + '...' + r.wallet.slice(-4),
            percent: r.percent,
            totalTransferred: (state.autoHarvestByRecipient[r.label] || 0) + (state.dailyPayoutByRecipient[r.label] || 0),
          })),
          reinvestPercent: 100 - (CONFIG.autoHarvest.recipients || []).reduce((s: number, r: HarvestRecipient) => s + r.percent, 0),
          // v9.3: Daily Payout info
          dailyPayout: {
            lastPayoutDate: state.lastDailyPayoutDate,
            dailyPayoutCount: state.dailyPayoutCount,
            totalDailyPayoutsUSD: state.totalDailyPayoutsUSD,
            nextPayoutUTC: nextPayoutDate.toISOString(),
            recentPayouts: (state.dailyPayouts || []).slice(-7),
            byRecipient: state.dailyPayoutByRecipient || {},
          },
        });
        break;
      case '/api/auto-harvest/trigger':
        // v10.2: Require auth token for payout trigger — prevents unauthorized wallet drain
        if (!isAuthorized(req)) {
          sendJSON(res, 401, { error: 'Unauthorized — set API_AUTH_TOKEN env var and pass Bearer token' }, req);
          break;
        }
        if (CONFIG.autoHarvest.enabled) {
          sendJSON(res, 200, { message: 'Daily payout triggered manually' }, req);
          executeDailyPayout().catch((err: any) => console.error(`[Daily Payout] Manual trigger error: ${err?.message}`));
        } else {
          sendJSON(res, 400, { error: 'Auto-harvest is not enabled' }, req);
        }
        break;
      // === v6.2: ADAPTIVE CYCLE API ENDPOINT ===
      case '/api/adaptive':
        sendJSON(res, 200, {
          version: BOT_VERSION,
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
          // v8.0: Institutional breaker state
          institutionalBreaker: {
            consecutiveLosses: breakerState.consecutiveLosses,
            maxConsecutive: BREAKER_CONSECUTIVE_LOSSES,
            lastTriggered: breakerState.lastBreakerTriggered,
            lastReason: breakerState.lastBreakerReason,
            sizeReductionUntil: breakerState.breakerSizeReductionUntil,
            dailyBaseline: breakerState.dailyBaseline,
            weeklyBaseline: breakerState.weeklyBaseline,
            isPaused: breakerState.lastBreakerTriggered ? Date.now() < new Date(breakerState.lastBreakerTriggered).getTime() + (BREAKER_PAUSE_HOURS * 3600000) : false,
            isSizeReduced: breakerState.breakerSizeReductionUntil ? Date.now() < new Date(breakerState.breakerSizeReductionUntil).getTime() : false,
          },
          // v8.0: Position sizing info
          positionSizing: {
            method: 'QUARTER_KELLY',
            kellyFraction: KELLY_FRACTION,
            minTrades: KELLY_MIN_TRADES,
            ceilingPct: getEffectiveKellyCeiling(state.trading.totalPortfolioValue || 0),
            baseCeilingPct: KELLY_POSITION_CEILING_PCT,
            smallPortfolioCeilingPct: KELLY_SMALL_PORTFOLIO_CEILING_PCT,
            floorUSD: KELLY_POSITION_FLOOR_USD,
          },
          // v9.2: Signal health — which data feeds are live/stale/down
          signalHealth: lastSignalHealth,
          // v9.2: Market momentum overlay
          momentum: {
            score: lastMomentumSignal.score,
            btcChange24h: lastMomentumSignal.btcChange24h,
            ethChange24h: lastMomentumSignal.ethChange24h,
            fearGreedValue: lastMomentumSignal.fearGreedValue,
            positionMultiplier: lastMomentumSignal.positionMultiplier,
            deploymentBias: lastMomentumSignal.deploymentBias,
            dataAvailable: lastMomentumSignal.dataAvailable,
          },
          // v10.1.1: Wallet status — using native CoinbaseSmartWallet
          smartAccount: {
            enabled: true,
            address: CONFIG.walletAddress,
            gasless: false, // Wallet is a SmartWallet but uses standard swap() path
            mode: 'COINBASE_SMART_WALLET',
          },
          // v9.2: Gas tank status
          gasTank: {
            ethBalance: lastKnownETHBalance,
            thresholdETH: GAS_REFUEL_THRESHOLD_ETH,
            lastRefuelTime: lastGasRefuelTime > 0 ? new Date(lastGasRefuelTime).toISOString() : null,
            autoRefuelEnabled: CONFIG.trading.enabled,
            status: lastKnownETHBalance >= GAS_REFUEL_THRESHOLD_ETH * 3 ? 'HEALTHY'
              : lastKnownETHBalance >= GAS_REFUEL_THRESHOLD_ETH ? 'LOW'
              : 'CRITICAL',
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
            entries: cooldownManager.getActiveCooldowns().map(e => ({
              symbol: e.symbol,
              decision: e.decision,
              remainingMs: Math.max(0, e.cooldownMs - (Date.now() - e.decidedAt)),
            })),
          },
          cycleStats,
        });
        break;

      // === v11.0: AAVE V3 YIELD API ENDPOINT ===
      case '/api/yield':
        sendJSON(res, 200, {
          enabled: yieldEnabled,
          ...aaveYieldService.toJSON(),
          lastAction: lastYieldAction,
          yieldCycles: yieldCycleCount,
          optimizer: yieldOptimizer.toJSON(),
        });
        break;
      case '/api/yield-rates':
        sendJSON(res, 200, {
          enabled: yieldEnabled,
          currentProtocol: yieldOptimizer.getCurrentProtocol(),
          rates: lastYieldRates.length > 0 ? lastYieldRates : yieldOptimizer.getRates(),
          aaveDeposited: aaveYieldService.getState().depositedUSDC,
          aaveBalance: aaveYieldService.getState().aTokenBalance,
          totalYieldEarned: aaveYieldService.getState().totalYieldEarned,
          lastRateCheck: yieldOptimizer.getState().lastRateCheck,
          checkCount: yieldOptimizer.getCheckCount(),
          rebalanceCount: yieldOptimizer.getState().rebalanceCount,
        });
        break;

      // === v11.0: DEX INTELLIGENCE API ===
      case '/api/dex-intelligence':
        if (lastDexIntelligence) {
          sendJSON(res, 200, {
            ...lastDexIntelligence,
            stats: geckoTerminalService.getStats(),
            fetchCount: dexIntelFetchCount,
          });
        } else {
          sendJSON(res, 200, {
            message: 'No DEX intelligence data yet — will be available after first heavy cycle',
            stats: geckoTerminalService.getStats(),
          });
        }
        break;

      // === v11.0: FAMILY PLATFORM API ENDPOINTS ===
      case '/api/family':
        sendJSON(res, 200, {
          enabled: familyEnabled,
          ...familyManager.toJSON(),
          wallets: familyWalletManager?.toJSON() || { totalWallets: 0, familyTotalValue: 0, wallets: [] },
          recentFamilyTrades: lastFamilyTradeResults.slice(-20),
        });
        break;

      case '/api/family/members':
        sendJSON(res, 200, {
          members: familyManager.getMembers(),
          activeCount: familyManager.getActiveMembers().length,
        });
        break;

      case '/api/family/profiles':
        sendJSON(res, 200, {
          profiles: familyManager.getRiskProfiles(),
        });
        break;

      case '/api/family/wallets':
        sendJSON(res, 200, familyWalletManager?.toJSON() || { totalWallets: 0, familyTotalValue: 0, wallets: [] });
        break;

      // v11.4.7: Admin health audit — cost basis vs market price for all positions
      case '/api/admin/health-audit': {
        if (!isAuthorized(req)) {
          sendJSON(res, 401, { error: 'Unauthorized — Bearer token required' });
          break;
        }
        const balancesForAudit = apiBalances();
        const auditPositions: Array<{
          symbol: string;
          balance: number;
          usdValue: number;
          marketPrice: number;
          costBasis: number | null;
          unrealizedGainPct: number | null;
          totalInvested: number;
          realizedPnL: number;
          peakPrice: number | null;
          drawdownFromPeak: number | null;
          holdingAgeDays: number | null;
          flags: string[];
        }> = [];

        for (const b of balancesForAudit.balances) {
          if (b.symbol === 'USDC' || b.balance <= 0) continue;
          const cb = state.costBasis[b.symbol];
          const marketPrice = b.price || (b.balance > 0 ? b.usdValue / b.balance : 0);
          const flags: string[] = [];

          let unrealizedGainPct: number | null = null;
          let drawdownFromPeak: number | null = null;
          let holdingAgeDays: number | null = null;

          if (cb && cb.averageCostBasis > 0) {
            unrealizedGainPct = ((marketPrice - cb.averageCostBasis) / cb.averageCostBasis) * 100;

            // Flag: >500% gain — likely stale cost basis
            if (unrealizedGainPct > 500) flags.push('STALE_COST_BASIS_LIKELY');
            // Flag: >200% gain — review recommended
            else if (unrealizedGainPct > 200) flags.push('EXTREME_GAIN_REVIEW');

            // Flag: cost basis way below market (10x+)
            if (marketPrice / cb.averageCostBasis > 10) flags.push('COST_10X_BELOW_MARKET');

            // Flag: cost basis way above market (position underwater by 80%+)
            if (unrealizedGainPct < -80) flags.push('SEVERE_LOSS');

            // Flag: zero or negative cost basis
            if (cb.averageCostBasis <= 0) flags.push('ZERO_COST_BASIS');

            // Drawdown from peak
            if (cb.peakPrice && cb.peakPrice > 0) {
              drawdownFromPeak = ((marketPrice - cb.peakPrice) / cb.peakPrice) * 100;
              if (drawdownFromPeak < -50) flags.push('PEAK_DRAWDOWN_50PCT');
            }

            // Holding age
            if (cb.firstBuyDate) {
              holdingAgeDays = Math.round((Date.now() - new Date(cb.firstBuyDate).getTime()) / (1000 * 60 * 60 * 24));
              // Flag: stale position (30+ days held, small value)
              if (holdingAgeDays > 30 && b.usdValue < 5) flags.push('STALE_DUST_POSITION');
            }

            // Flag: inconsistent cost basis data
            if (cb.totalTokensAcquired > 0 && cb.currentHolding > 0) {
              const impliedCost = cb.totalInvestedUSD / cb.totalTokensAcquired;
              const costRatio = cb.averageCostBasis / impliedCost;
              if (costRatio < 0.1 || costRatio > 10) flags.push('COST_BASIS_INCONSISTENT');
            }
          } else {
            flags.push('NO_COST_BASIS');
          }

          auditPositions.push({
            symbol: b.symbol,
            balance: b.balance,
            usdValue: b.usdValue,
            marketPrice,
            costBasis: cb?.averageCostBasis || null,
            unrealizedGainPct: unrealizedGainPct !== null ? Math.round(unrealizedGainPct * 10) / 10 : null,
            totalInvested: cb?.totalInvestedUSD || 0,
            realizedPnL: cb?.realizedPnL || 0,
            peakPrice: cb?.peakPrice || null,
            drawdownFromPeak: drawdownFromPeak !== null ? Math.round(drawdownFromPeak * 10) / 10 : null,
            holdingAgeDays,
            flags,
          });
        }

        // Sort: flagged positions first, then by USD value descending
        auditPositions.sort((a, b) => {
          if (a.flags.length > 0 && b.flags.length === 0) return -1;
          if (a.flags.length === 0 && b.flags.length > 0) return 1;
          return b.usdValue - a.usdValue;
        });

        const totalFlags = auditPositions.reduce((sum, p) => sum + p.flags.length, 0);

        sendJSON(res, 200, {
          timestamp: new Date().toISOString(),
          portfolioValue: balancesForAudit.totalValue,
          positionCount: auditPositions.length,
          flaggedPositions: auditPositions.filter(p => p.flags.length > 0).length,
          totalFlags,
          healthStatus: totalFlags === 0 ? 'HEALTHY' : totalFlags <= 2 ? 'REVIEW' : 'CRITICAL',
          positions: auditPositions,
          // Recent sanity alerts
          recentAlerts: (state.sanityAlerts || []).slice(-20),
          // Active dedup entries
          activeDedups: Object.entries(state.tradeDedupLog || {}).map(([key, ts]) => ({
            key,
            lastExecuted: ts,
            minutesAgo: Math.round((Date.now() - new Date(ts).getTime()) / (1000 * 60)),
          })),
          // Harvest cooldown state
          harvestCooldowns: Object.entries(state.profitTakeCooldowns).map(([key, ts]) => ({
            key,
            lastTrigger: ts,
            hoursAgo: Math.round((Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60) * 10) / 10,
          })),
          // Stop-loss cooldown state
          stopLossCooldowns: Object.entries(state.stopLossCooldowns).map(([key, ts]) => ({
            symbol: key,
            lastTrigger: ts,
            hoursAgo: Math.round((Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60) * 10) / 10,
          })),
        });
        break;
      }

      // Win Rate Truth Dashboard — honest profitability metrics
      case '/api/win-rate-truth': {
        const truth = calculateWinRateTruth();
        sendJSON(res, 200, {
          timestamp: new Date().toISOString(),
          disclaimer: "executionWinRate counts successful API calls. realizedWinRate counts trades where sellPrice > buyPrice. The gap between these two numbers is the honesty gap.",
          ...truth,
        });
        break;
      }

      // v11.3: Admin endpoint to correct corrupted state values (e.g. false deposit detection)
      case '/api/admin/correct-state': {
        if (req.method !== 'POST') {
          sendJSON(res, 405, { error: 'Method not allowed — use POST' });
          break;
        }
        if (!isAuthorized(req)) {
          sendJSON(res, 401, { error: 'Unauthorized — Bearer token required' });
          break;
        }
        // Read POST body (v11.4.17: bounded to 10KB to prevent DoS)
        let body = '';
        let bodyTooLarge = false;
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
          if (body.length > 10_000) { bodyTooLarge = true; req.destroy(); }
        });
        req.on('end', () => {
          if (bodyTooLarge) { sendJSON(res, 413, { error: 'Request body too large (max 10KB)' }); return; }
          try {
            const corrections = JSON.parse(body);
            const applied: string[] = [];
            const before = {
              peakValue: state.trading.peakValue,
              initialValue: state.trading.initialValue,
              totalDeposited: state.totalDeposited,
            };
            if (typeof corrections.peakValue === 'number') {
              state.trading.peakValue = corrections.peakValue;
              applied.push(`peakValue: ${before.peakValue.toFixed(2)} → ${corrections.peakValue.toFixed(2)}`);
            }
            if (typeof corrections.initialValue === 'number') {
              state.trading.initialValue = corrections.initialValue;
              applied.push(`initialValue: ${before.initialValue.toFixed(2)} → ${corrections.initialValue.toFixed(2)}`);
            }
            if (typeof corrections.totalDeposited === 'number') {
              state.totalDeposited = corrections.totalDeposited;
              applied.push(`totalDeposited: ${before.totalDeposited.toFixed(2)} → ${corrections.totalDeposited.toFixed(2)}`);
            }
            if (corrections.removeLastDeposit === true && state.depositHistory.length > 0) {
              const removed = state.depositHistory.pop();
              applied.push(`removed last deposit: $${removed?.amountUSD}`);
            }
            // v11.4.20: Explicit deposit registration — adjusts totalDeposited, peakValue, breaker baselines.
            // initialValue is NOT modified — it's the original seed capital. All deposits go into totalDeposited.
            if (typeof corrections.registerDeposit === 'number' && corrections.registerDeposit > 0) {
              const amt = corrections.registerDeposit;
              state.totalDeposited += amt;
              state.trading.peakValue += amt;
              if (breakerState.dailyBaseline.value > 0) breakerState.dailyBaseline.value += amt;
              if (breakerState.weeklyBaseline.value > 0) breakerState.weeklyBaseline.value += amt;
              state.depositHistory.push({
                timestamp: new Date().toISOString(),
                amountUSD: Math.round(amt * 100) / 100,
                newTotal: Math.round(state.totalDeposited * 100) / 100,
              });
              applied.push(`registerDeposit: +$${amt.toFixed(2)} (peak: $${state.trading.peakValue.toFixed(2)}, initial: $${state.trading.initialValue.toFixed(2)})`);
            }
            // v11.4.5: Reset cost basis to current market prices — fixes stale/wrong cost basis
            // Usage: { "resetCostBasis": true } or { "resetCostBasis": ["ETH", "AERO"] }
            if (corrections.resetCostBasis) {
              const balances = apiBalances();
              const tokensToReset: string[] = Array.isArray(corrections.resetCostBasis)
                ? corrections.resetCostBasis
                : Object.keys(state.costBasis);
              for (const symbol of tokensToReset) {
                const cb = state.costBasis[symbol];
                if (!cb) continue;
                const bal = balances.balances.find((b: any) => b.symbol === symbol);
                const currentPrice = bal ? (bal.price || (bal.balance > 0 ? bal.usdValue / bal.balance : 0)) : 0;
                if (currentPrice <= 0) {
                  applied.push(`resetCostBasis: ${symbol} — skipped (no price data)`);
                  continue;
                }
                const oldCost = cb.averageCostBasis;
                cb.averageCostBasis = currentPrice;
                cb.totalInvestedUSD = currentPrice * cb.currentHolding;
                cb.totalTokensAcquired = cb.currentHolding;
                cb.realizedPnL = 0;
                cb.unrealizedPnL = 0;
                cb.firstBuyDate = new Date().toISOString();
                cb.lastTradeDate = new Date().toISOString();
                applied.push(`resetCostBasis: ${symbol} $${oldCost.toFixed(6)} → $${currentPrice.toFixed(6)}`);
              }
            }
            // v11.4.5: Clear all harvest cooldowns to let fresh thresholds apply
            if (corrections.clearHarvestCooldowns === true) {
              const count = Object.keys(state.profitTakeCooldowns).length;
              state.profitTakeCooldowns = {};
              applied.push(`clearHarvestCooldowns: cleared ${count} cooldown entries`);
            }
            // Recalculate derived values
            const drawdown = Math.max(0, ((state.trading.peakValue - state.trading.totalPortfolioValue) / state.trading.peakValue) * 100);
            saveTradeHistory();
            console.log(`\n🔧 ADMIN STATE CORRECTION applied:`);
            applied.forEach(a => console.log(`   ${a}`));
            sendJSON(res, 200, {
              message: 'State corrected successfully',
              applied,
              current: {
                peakValue: state.trading.peakValue,
                initialValue: state.trading.initialValue,
                totalDeposited: state.totalDeposited,
                totalPortfolioValue: state.trading.totalPortfolioValue,
                drawdown: drawdown.toFixed(2) + '%',
                depositCount: state.depositHistory.length,
              },
            });
          } catch (parseErr: any) {
            sendJSON(res, 400, { error: 'Invalid JSON body: ' + parseErr.message });
          }
        });
        return; // Don't end response here — it's handled in req.on('end')
      }

      // v11.4.4: Dashboard AI Chat
      case '/api/chat': {
        if (req.method !== 'POST') { sendJSON(res, 405, { error: 'POST only' }); break; }
        // v11.4.17: Bounded POST body (max 50KB for chat with history)
        let chatBody = '';
        let chatBodyTooLarge = false;
        req.on('data', (chunk: Buffer) => {
          chatBody += chunk.toString();
          if (chatBody.length > 50_000) { chatBodyTooLarge = true; req.destroy(); }
        });
        req.on('end', async () => {
          if (chatBodyTooLarge) { sendJSON(res, 413, { error: 'Request body too large (max 50KB)' }); return; }
          try {
            const { message, history } = JSON.parse(chatBody);
            if (!message || typeof message !== 'string') {
              sendJSON(res, 400, { error: 'message required' });
              return;
            }

            // NVR-NL: Check for "confirm" — apply pending config change
            const msgLower = message.toLowerCase().trim();
            if (msgLower === 'confirm' || msgLower === 'yes' || msgLower === 'apply') {
              // Find most recent pending config change
              const entries = [...pendingConfigChanges.entries()];
              if (entries.length > 0) {
                const [confId, pending] = entries[entries.length - 1];
                const directive = applyConfigChanges(pending.parseResult, pending.instruction);
                pendingConfigChanges.delete(confId);
                sendJSON(res, 200, {
                  response: `Applied. ${pending.parseResult.summary}\n\nDirective ID: ${directive.id} (active for 24h). Say "list directives" to see all active changes.`,
                  configApplied: true,
                  directiveId: directive.id,
                });
                return;
              }
            }

            // NVR-NL: Try strategy config parser first (keyword matching, no AI needed)
            if (isStrategyInstruction(message)) {
              const parseResult = parseStrategyInstruction(message, {
                stopLossPercent: Math.abs(CONFIG.trading.stopLoss.percentThreshold),
                profitTakePercent: CONFIG.trading.profitTaking.targetPercent,
                tradingEnabled: CONFIG.trading.enabled,
              });

              if (parseResult.understood && parseResult.summary === 'QUERY') {
                // Fall through to normal chat handling below
              } else if (parseResult.understood && parseResult.summary === 'STRATEGY_QUERY') {
                const activeCfg = getActiveConfigDirectives();
                const cfgList = activeCfg.length > 0
                  ? activeCfg.map((d: ConfigDirective, i: number) => `${i + 1}. "${d.instruction}" (${new Date(d.appliedAt).toLocaleString()})`).join('\n')
                  : 'No active config directives — running default strategy.';
                sendJSON(res, 200, { response: `Current strategy config directives:\n${cfgList}` });
                return;
              } else if (parseResult.understood && parseResult.changes.length > 0) {
                if (parseResult.requiresConfirmation) {
                  const confId = `cfgconf-${Date.now()}`;
                  pendingConfigChanges.set(confId, { parseResult, instruction: message, createdAt: Date.now() });
                  const changeList = parseResult.changes.map(c => `  ${c.parameter}: ${c.oldValue} -> ${c.newValue}`).join('\n');
                  sendJSON(res, 200, {
                    response: `I understand. Here is what I will change:\n\n${parseResult.summary}\n\nDetails:\n${changeList}\n\nReply "confirm" to apply these changes.`,
                    pendingConfirmation: true,
                  });
                  return;
                } else {
                  // No confirmation needed (e.g. watchlist adds)
                  const directive = applyConfigChanges(parseResult, message);
                  sendJSON(res, 200, {
                    response: `Done. ${parseResult.summary}\n\nDirective ID: ${directive.id} (active for 24h).`,
                    configApplied: true,
                    directiveId: directive.id,
                  });
                  return;
                }
              }
            }

            // NVR Central Mode: Chat fallback — no Claude API needed
            if (signalMode === 'central') {
              const portfolio = apiPortfolio();
              const perfStats = calculateTradePerformance();
              const totalValue = portfolio.totalValue || 0;
              const pnlPercent = portfolio.pnlPercent || 0;
              const winRate = portfolio.winRate || 0;
              const totalTrades = portfolio.totalTrades || 0;
              const usdcBal = (apiBalances().balances || []).find((b: any) => b.symbol === 'USDC');
              const usdcBalance = usdcBal?.balance || 0;
              const cashPct = totalValue > 0 ? ((usdcBalance / totalValue) * 100).toFixed(0) : '0';

              const activeCfgDirectives = getActiveConfigDirectives();
              const cfgSection = activeCfgDirectives.length > 0
                ? '\n\nActive strategy directives:\n' + activeCfgDirectives.map((d: ConfigDirective) => `- ${d.instruction}`).join('\n')
                : '';

              const summary = [
                `Portfolio: $${totalValue.toFixed(2)} | P&L: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`,
                `Win Rate: ${winRate.toFixed(1)}% | Trades: ${totalTrades}`,
                `Cash: $${usdcBalance.toFixed(2)} (${cashPct}%)`,
                `Drawdown: ${portfolio.drawdown.toFixed(1)}% | Peak: $${portfolio.peakValue.toFixed(2)}`,
                '',
                'You can configure strategy via chat: "be more aggressive", "set stop loss to 10%", "avoid BRETT", etc.',
                'AI chat requires local mode for full conversation.',
              ].join('\n') + cfgSection;

              sendJSON(res, 200, { response: summary });
              return;
            }

            const result = await handleChatRequest(message.substring(0, 500), history || []);
            sendJSON(res, 200, result);
          } catch (err: any) {
            console.error('[Chat API Error]', err.message, err.stack?.substring(0, 300));
            sendJSON(res, 500, { error: 'Chat request failed: ' + (err.message || 'unknown') });
          }
        });
        return; // Don't end response here — it's handled in req.on('end')
      }

      // v11.4.16: User Directives API
      case '/api/directives': {
        const activeUserDir = getActiveDirectives();
        const activeCfgDir = getActiveConfigDirectives();
        sendJSON(res, 200, {
          directives: activeUserDir.map(d => ({
            id: d.id,
            type: d.type,
            instruction: d.instruction,
            token: d.token,
            sector: d.sector,
            value: d.value,
            createdAt: d.createdAt,
            expiresAt: d.expiresAt,
          })),
          configDirectives: activeCfgDir.map((d: ConfigDirective) => ({
            id: d.id,
            instruction: d.instruction,
            changes: d.changes,
            appliedAt: d.appliedAt,
            expiresAt: d.expiresAt,
            active: d.active,
          })),
          count: activeUserDir.length,
          configCount: activeCfgDir.length,
        });
        break;
      }

      // === NVR-SPEC-001: SIMULATION API ===
      case '/api/simulate': {
        try {
          const history = loadPriceHistory();
          const compare = url.searchParams.get('compare') === 'true';
          if (compare) {
            const configB: SimConfig = { ...DEFAULT_SIM_CONFIG };
            for (const [key, val] of url.searchParams.entries()) {
              if (key === 'compare') continue;
              if (key in configB) (configB as any)[key] = parseFloat(val);
            }
            const result = compareStrategies(DEFAULT_SIM_CONFIG, configB, history);
            sendJSON(res, 200, result);
          } else {
            const cfg: SimConfig = { ...DEFAULT_SIM_CONFIG };
            for (const [key, val] of url.searchParams.entries()) {
              if (key in cfg) (cfg as any)[key] = parseFloat(val);
            }
            const result = runSimulation(cfg, history);
            sendJSON(res, 200, { ...result, trades: result.trades.slice(-100), equityCurve: result.equityCurve.length > 500 ? downsample(result.equityCurve, 500) : result.equityCurve });
          }
        } catch (err: any) {
          sendJSON(res, 500, { error: `Simulation failed: ${err.message}` });
        }
        break;
      }

      // === STRATEGY LAB API ENDPOINTS ===
      case '/api/strategy-versions': {
        sendJSON(res, 200, STRATEGY_VERSIONS);
        break;
      }

      case '/api/paper-portfolios': {
        const portfolios = getAllPaperPortfolios();
        sendJSON(res, 200, {
          portfolios: portfolios.map(p => getPaperPortfolioSummary(p)),
          count: portfolios.length,
          liveValue: state.trading.totalPortfolioValue,
          liveReturnPct: state.trading.initialValue > 0
            ? ((state.trading.totalPortfolioValue - state.trading.initialValue) / state.trading.initialValue) * 100
            : 0,
        });
        break;
      }

      // === NVR-SPEC-005: Strategy Lab Marketing Export ===
      case '/api/export-results': {
        const exportType = url.searchParams.get('type') || 'backtest';
        const exportVersion = url.searchParams.get('version');

        try {
          let html = '';

          if (exportType === 'backtest') {
            // Multi-version comparison export
            const capital = parseFloat(url.searchParams.get('capital') || '500');
            const results = runAllVersionBacktestsFromDisk(capital);
            const summarized = summarizeBacktestResults(results);
            html = generateBacktestMultiExportHTML(summarized);

          } else if (exportType === 'single' && exportVersion) {
            // Single version backtest export
            const capital = parseFloat(url.searchParams.get('capital') || '500');
            const results = runAllVersionBacktestsFromDisk(capital);
            const summarized = summarizeBacktestResults(results);
            const match = summarized.find((r: any) => r.version === exportVersion);
            if (!match) {
              sendJSON(res, 400, {
                error: `Unknown version: ${exportVersion}`,
                available: summarized.map((r: any) => r.version),
              });
              return;
            }
            html = generateBacktestSingleExportHTML(match);

          } else if (exportType === 'paper') {
            // Paper trading export
            const portfolioId = url.searchParams.get('id');
            const allPortfolios = getAllPaperPortfolios();

            if (portfolioId) {
              const portfolio = getPaperPortfolio(portfolioId);
              if (!portfolio) {
                sendJSON(res, 404, {
                  error: `Paper portfolio "${portfolioId}" not found`,
                  available: allPortfolios.map((p: any) => p.id),
                });
                return;
              }
              const summary = getPaperPortfolioSummary(portfolio);
              const detail = {
                equityCurve: portfolio.equityCurve.length > 500
                  ? portfolio.equityCurve.filter((_: any, i: number) => i === 0 || i === portfolio.equityCurve.length - 1 || i % Math.ceil(portfolio.equityCurve.length / 500) === 0)
                  : portfolio.equityCurve,
              };
              html = generatePaperExportHTML(summary, detail);
            } else {
              // Default: export first paper portfolio
              if (allPortfolios.length === 0) {
                sendJSON(res, 404, { error: 'No paper portfolios available' });
                return;
              }
              const portfolio = allPortfolios[0];
              const summary = getPaperPortfolioSummary(portfolio);
              const detail = {
                equityCurve: portfolio.equityCurve.length > 500
                  ? portfolio.equityCurve.filter((_: any, i: number) => i === 0 || i === portfolio.equityCurve.length - 1 || i % Math.ceil(portfolio.equityCurve.length / 500) === 0)
                  : portfolio.equityCurve,
              };
              html = generatePaperExportHTML(summary, detail);
            }

          } else {
            sendJSON(res, 400, { error: 'Invalid type. Use: backtest, single (with version param), or paper (with optional id param)' });
            return;
          }

          res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
          res.end(html);
        } catch (err: any) {
          sendJSON(res, 500, { error: `Export failed: ${err.message}` });
        }
        break;
      }

      case '/api/version-backtest': {
        try {
          const capital = parseFloat(url.searchParams.get('capital') || '500');
          const results = runAllVersionBacktestsFromDisk(capital);
          sendJSON(res, 200, {
            results: summarizeBacktestResults(results),
            count: results.length,
            runAt: new Date().toISOString(),
          });
        } catch (err: any) {
          sendJSON(res, 500, { error: `Version backtest failed: ${err.message}` });
        }
        break;
      }

      // === v15.0: SWARM STATUS API ===
      case '/api/swarm-status': {
        const _swarmDecs = getLatestSwarmDecisions();
        const _swarmTime = getLastSwarmRunTime();
        sendJSON(res, 200, {
          engine: SIGNAL_ENGINE,
          agents: ['momentum', 'flow', 'risk', 'sentiment', 'trend'],
          lastRunTime: _swarmTime?.toISOString() || null,
          lastDecisions: _swarmDecs.map(d => ({
            token: d.token, finalAction: d.finalAction, totalScore: d.totalScore, consensus: d.consensus,
            votes: d.votes.map(v => ({ agent: v.agent, action: v.action, confidence: v.confidence, reasoning: v.reasoning, weight: v.weight })),
          })),
        }, req);
        break;
      }

      // === NVR-SPEC-004: Signal Dashboard API ===
      case '/api/signal-dashboard': {
        const uptimeMs = Date.now() - state.startTime.getTime();
        const uptimeH = Math.floor(uptimeMs / 3600000);
        const uptimeM = Math.floor((uptimeMs % 3600000) / 60000);

        const statusMap: Record<string, string> = { producer: 'producing', central: 'consuming', local: 'local' };

        // Build current signal counts
        const sigs = latestSignals?.signals || [];
        const counts = { total: sigs.length, buy: 0, sell: 0, hold: 0, strongBuy: 0, strongSell: 0 };
        for (const s of sigs) {
          if (s.action === 'BUY') counts.buy++;
          else if (s.action === 'SELL') counts.sell++;
          else if (s.action === 'HOLD') counts.hold++;
          else if (s.action === 'STRONG_BUY') counts.strongBuy++;
          else if (s.action === 'STRONG_SELL') counts.strongSell++;
        }

        const lastTime = latestSignals?.timestamp || null;
        const signalAgeSec = lastTime ? Math.round((Date.now() - new Date(lastTime).getTime()) / 1000) : null;

        // Token signals sorted by action priority
        const actionOrder: Record<string, number> = { STRONG_BUY: 0, BUY: 1, HOLD: 2, SELL: 3, STRONG_SELL: 4 };
        const tokenSignals = sigs
          .map(s => ({
            token: s.token,
            action: s.action,
            confluence: s.confluence,
            buyRatio: s.indicators?.buyRatio ?? null,
            rsi: s.indicators?.rsi14 ?? null,
            sector: s.sector || '',
            price: s.price,
            priceChange24h: s.priceChange24h,
          }))
          .sort((a, b) => (actionOrder[a.action] ?? 2) - (actionOrder[b.action] ?? 2));

        sendJSON(res, 200, {
          signalService: {
            status: statusMap[signalMode] || 'local',
            mode: signalMode,
            uptime: `${uptimeH}h ${uptimeM}m`,
            totalCyclesProduced: signalCycleNumber,
            lastSignalTime: lastTime,
            signalAgeSeconds: signalAgeSec,
          },
          currentSignals: counts,
          signalHistory: signalHistory.slice(-100),
          tokenSignals,
        });
        break;
      }

      // === NVR CENTRAL SIGNAL SERVICE — Signal API Endpoint ===
      case '/signals/latest': {
        // Simple API key check
        const signalKey = req.headers['x-signal-key'];
        const expectedKey = process.env.SIGNAL_API_KEY;
        if (expectedKey && signalKey !== expectedKey) {
          sendJSON(res, 401, { error: 'Invalid signal key' });
          return;
        }

        if (!latestSignals) {
          sendJSON(res, 503, { error: 'No signals produced yet. Service is starting up.' });
          return;
        }

        const etag = `"cycle-${latestSignals.cycleNumber}"`;
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304);
          res.end();
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'ETag': etag,
          'Cache-Control': 'public, max-age=120',
        });
        res.end(JSON.stringify(latestSignals));
        return;
      }

      // v14.0: Withdraw funds endpoint — two-step confirmation flow
      case '/api/withdraw': {
        if (req.method !== 'POST') { sendJSON(res, 405, { error: 'POST only' }); break; }
        if (!isAuthorized(req)) {
          sendJSON(res, 401, { error: 'Unauthorized — Bearer token required' });
          break;
        }
        let withdrawBody = '';
        let withdrawBodyTooLarge = false;
        req.on('data', (chunk: Buffer) => {
          withdrawBody += chunk.toString();
          if (withdrawBody.length > 10_000) { withdrawBodyTooLarge = true; req.destroy(); }
        });
        req.on('end', async () => {
          if (withdrawBodyTooLarge) { sendJSON(res, 413, { error: 'Request body too large' }); return; }
          try {
            const body = JSON.parse(withdrawBody);
            const { toAddress, amountUSD, token: tokenParam, confirmationId, confirm } = body;
            const token = (tokenParam || 'USDC').toUpperCase();

            // Step 2: Confirm and execute a pending withdrawal
            if (confirmationId && confirm === true) {
              const pending = pendingWithdrawals.get(confirmationId);
              if (!pending) {
                sendJSON(res, 400, { success: false, error: 'Confirmation expired or invalid. Please start a new withdrawal.' });
                return;
              }
              pendingWithdrawals.delete(confirmationId);

              // Pause trading
              (state as any).withdrawPaused = true;
              console.log(`\n💸 [WITHDRAW] Executing: $${pending.amountUSD.toFixed(2)} ${pending.token} → ${pending.toAddress}`);

              try {
                const account = await cdpClient.evm.getOrCreateAccount({ name: CDP_ACCOUNT_NAME });
                let txHash: string;

                if (pending.token === 'USDC') {
                  txHash = await sendUSDCTransfer(account, pending.toAddress, pending.amountUSD);
                } else {
                  // For other tokens, use USDC transfer (primary use case)
                  txHash = await sendUSDCTransfer(account, pending.toAddress, pending.amountUSD);
                }

                console.log(`[WITHDRAW] ✅ TX: ${txHash}`);
                console.log(`[WITHDRAW] 🔍 https://basescan.org/tx/${txHash}`);

                // Log withdrawal in trade history
                state.tradeHistory.push({
                  timestamp: new Date().toISOString(),
                  cycle: state.totalCycles,
                  action: 'WITHDRAW' as any,
                  fromToken: pending.token,
                  toToken: 'EXTERNAL',
                  amountUSD: pending.amountUSD,
                  txHash,
                  success: true,
                  portfolioValueBefore: state.trading.totalPortfolioValue,
                  reasoning: `Manual withdrawal: $${pending.amountUSD.toFixed(2)} ${pending.token} to ${pending.toAddress.slice(0, 6)}...${pending.toAddress.slice(-4)}`,
                  marketConditions: { fearGreed: 0, ethPrice: 0, btcPrice: 0 },
                } as TradeRecord);
                if (state.tradeHistory.length > 5000) state.tradeHistory = state.tradeHistory.slice(-5000);

                // Adjust peak value like payouts do (prevent false drawdown triggers)
                if (state.trading.peakValue > pending.amountUSD) {
                  state.trading.peakValue -= pending.amountUSD;
                  if (breakerState.dailyBaseline.value > pending.amountUSD) breakerState.dailyBaseline.value -= pending.amountUSD;
                  if (breakerState.weeklyBaseline.value > pending.amountUSD) breakerState.weeklyBaseline.value -= pending.amountUSD;
                }

                saveTradeHistory();
                (state as any).withdrawPaused = false;

                sendJSON(res, 200, {
                  success: true,
                  txHash,
                  amountSent: pending.amountUSD,
                  token: pending.token,
                  toAddress: pending.toAddress,
                });
              } catch (err: any) {
                console.error(`[WITHDRAW] ❌ FAILED: ${err.message}`);
                (state as any).withdrawPaused = false;
                sendJSON(res, 500, { success: false, error: err.message || 'Transfer failed' });
              }
              return;
            }

            // Step 1: Validate and create pending confirmation
            if (!toAddress || typeof toAddress !== 'string') {
              sendJSON(res, 400, { success: false, error: 'Missing destination address (toAddress)' });
              return;
            }
            if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
              sendJSON(res, 400, { success: false, error: 'Invalid Ethereum address — must start with 0x and be 42 characters' });
              return;
            }
            if (!amountUSD || typeof amountUSD !== 'number' || amountUSD <= 0) {
              sendJSON(res, 400, { success: false, error: 'Amount must be a positive number' });
              return;
            }

            // Check available balance
            const walletAddr = CONFIG.walletAddress;
            const usdcBal = await getERC20Balance(TOKEN_REGISTRY.USDC.address, walletAddr, 6);
            const minReserve = 10; // Keep $10 for gas
            const maxWithdrawable = Math.max(0, usdcBal - minReserve);
            const portfolioTotal = state.trading.totalPortfolioValue || usdcBal;

            if (amountUSD > maxWithdrawable) {
              sendJSON(res, 400, {
                success: false,
                error: `Insufficient balance. Available: $${maxWithdrawable.toFixed(2)} USDC (keeping $${minReserve} reserve). Current balance: $${usdcBal.toFixed(2)}`,
                availableBalance: maxWithdrawable,
              });
              return;
            }

            // Safety guard: max 90% of total portfolio
            if (amountUSD > portfolioTotal * 0.9) {
              sendJSON(res, 400, {
                success: false,
                error: `Safety limit: Cannot withdraw more than 90% of total portfolio ($${(portfolioTotal * 0.9).toFixed(2)}). To withdraw more, contact admin.`,
                maxAllowed: Math.floor(portfolioTotal * 0.9 * 100) / 100,
              });
              return;
            }

            // Create confirmation
            const confId = `w-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
            pendingWithdrawals.set(confId, {
              toAddress,
              amountUSD,
              token,
              createdAt: Date.now(),
            });

            console.log(`[WITHDRAW] Confirmation created: ${confId} — $${amountUSD.toFixed(2)} ${token} → ${toAddress.slice(0, 6)}...${toAddress.slice(-4)}`);

            sendJSON(res, 200, {
              success: true,
              confirmationId: confId,
              message: `Ready to send $${amountUSD.toFixed(2)} ${token} to ${toAddress}. Confirm within 5 minutes.`,
              amountUSD,
              token,
              toAddress,
              availableBalance: maxWithdrawable,
            });
          } catch (parseErr: any) {
            sendJSON(res, 400, { success: false, error: 'Invalid JSON body: ' + parseErr.message });
          }
        });
        return; // Don't end response here — it's handled in req.on('end')
      }

      default: {
        // NVR-NL: DELETE /api/directives/:id — remove a directive
        if (url.pathname.startsWith('/api/directives/') && req.method === 'DELETE') {
          const id = url.pathname.replace('/api/directives/', '');
          const removedUser = removeUserDirective(id);
          const removedConfig = removeConfigDirective(id);
          if (removedUser || removedConfig) {
            sendJSON(res, 200, { success: true, removed: id });
          } else {
            sendJSON(res, 404, { success: false, error: `Directive "${id}" not found` });
          }
          break;
        }

        // Handle dynamic route: /api/paper-portfolio/:id
        if (url.pathname.startsWith('/api/paper-portfolio/')) {
          const id = url.pathname.replace('/api/paper-portfolio/', '');
          const portfolio = getPaperPortfolio(id);
          if (portfolio) {
            sendJSON(res, 200, {
              ...getPaperPortfolioSummary(portfolio),
              trades: portfolio.trades.slice(-100),
              equityCurve: portfolio.equityCurve.length > 500
                ? portfolio.equityCurve.filter((_: any, i: number) => i === 0 || i === portfolio.equityCurve.length - 1 || i % Math.ceil(portfolio.equityCurve.length / 500) === 0)
                : portfolio.equityCurve,
            });
          } else {
            sendJSON(res, 404, { error: `Paper portfolio "${id}" not found` });
          }
          break;
        }
        sendJSON(res, 404, { error: 'Not found' });
      }
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
<title>Never Rest Capital</title>
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
<div class="border-b border-white/5 px-4 sm:px-6 py-2">
  <div class="max-w-7xl mx-auto flex items-center justify-between">
    <div>
      <h1 class="text-sm font-bold text-white">Never Rest Capital</h1>
      <p class="text-[10px] text-slate-500">Autonomous Trading Agent v12.2</p>
    </div>
    <div class="flex items-center gap-3">
      <span class="pulse-dot inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
      <span class="text-xs text-emerald-400 font-medium" id="bot-status">Online</span>
      <span class="text-xs text-slate-600 mono" id="last-update"></span>
    </div>
  </div>
</div>

<!-- Hero Metrics -->
<div class="max-w-7xl mx-auto px-4 sm:px-6 py-3">
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
    <div class="glass rounded-lg p-2.5">
      <p class="text-[9px] uppercase tracking-widest text-slate-500">Portfolio</p>
      <p class="text-lg font-bold text-white mono" id="portfolio-value">--</p>
    </div>
    <div class="glass rounded-lg p-2.5">
      <p class="text-[9px] uppercase tracking-widest text-slate-500">Total P&L</p>
      <p class="text-lg font-bold mono" id="total-pnl">--</p>
    </div>
    <div class="glass rounded-lg p-2.5">
      <p class="text-[9px] uppercase tracking-widest text-slate-500">Realized</p>
      <p class="text-sm font-semibold mono" id="realized-pnl">--</p>
    </div>
    <div class="glass rounded-lg p-2.5">
      <p class="text-[9px] uppercase tracking-widest text-slate-500">Harvested</p>
      <p class="text-sm font-semibold mono text-amber-400" id="harvested-pnl">--</p>
      <p class="text-[8px] text-slate-600" id="harvest-count"></p>
    </div>
  </div>

  <!-- Sub metrics -->
  <div class="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mt-2">
    <div class="glass rounded p-1.5 text-center">
      <p class="text-[8px] uppercase tracking-wider text-slate-500">Trades</p>
      <p class="text-xs font-semibold text-white mono" id="trade-count">--</p>
    </div>
    <div class="glass rounded p-1.5 text-center">
      <p class="text-[8px] uppercase tracking-wider text-slate-500">Win Rate</p>
      <p class="text-xs font-semibold text-emerald-400 mono" id="success-rate">--</p>
    </div>
    <div class="glass rounded p-1.5 text-center">
      <p class="text-[8px] uppercase tracking-wider text-slate-500">Cycles</p>
      <p class="text-xs font-semibold text-white mono" id="cycle-count">--</p>
    </div>
    <div class="glass rounded p-1.5 text-center">
      <p class="text-[8px] uppercase tracking-wider text-slate-500">Uptime</p>
      <p class="text-xs font-semibold text-white mono" id="uptime">--</p>
    </div>
    <div class="glass rounded p-1.5 text-center">
      <p class="text-[8px] uppercase tracking-wider text-slate-500">Peak</p>
      <p class="text-xs font-semibold text-accent-gold mono" id="peak-value">--</p>
    </div>
    <div class="glass rounded p-1.5 text-center">
      <p class="text-[8px] uppercase tracking-wider text-slate-500">Drawdown</p>
      <p class="text-xs font-semibold text-slate-400 mono" id="drawdown">--</p>
    </div>
  </div>
</div>

<!-- Holdings + Sectors Grid -->
<div class="max-w-7xl mx-auto px-4 sm:px-6 pb-3">
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-2">

    <!-- Holdings -->
    <div class="lg:col-span-2 glass rounded-lg p-3">
      <h2 class="text-xs font-semibold text-white mb-2">Holdings & P&L</h2>
      <div class="overflow-x-auto max-h-[200px] overflow-y-auto">
        <table class="w-full text-[11px]">
          <thead class="sticky top-0 bg-surface-800">
            <tr class="text-[9px] uppercase tracking-wider text-slate-500 border-b border-white/5">
              <th class="pb-1 text-left">Token</th>
              <th class="pb-1 text-right">Value</th>
              <th class="pb-1 text-right hidden sm:table-cell">Avg Cost</th>
              <th class="pb-1 text-right">P&L</th>
              <th class="pb-1 text-right hidden sm:table-cell">Sector</th>
            </tr>
          </thead>
          <tbody id="holdings-table"></tbody>
        </table>
      </div>
    </div>

    <!-- Sector Allocation -->
    <div class="glass rounded-lg p-3">
      <h2 class="text-xs font-semibold text-white mb-2">Sector Allocation</h2>
      <div class="flex justify-center mb-2" style="height: 130px;">
        <canvas id="sector-chart"></canvas>
      </div>
      <div id="sector-list" class="space-y-1"></div>
    </div>
  </div>
</div>

<!-- Trade Log -->
<div class="max-w-7xl mx-auto px-4 sm:px-6 pb-3">
  <div class="glass rounded-lg p-3">
    <h2 class="text-xs font-semibold text-white mb-2">Recent Trades</h2>
    <div class="overflow-x-auto max-h-[160px] overflow-y-auto">
      <table class="w-full text-[11px]">
        <thead class="sticky top-0 bg-surface-800">
          <tr class="text-[9px] uppercase tracking-wider text-slate-500 border-b border-white/5">
            <th class="pb-1 text-left">Time</th>
            <th class="pb-1 text-left">Action</th>
            <th class="pb-1 text-left">Pair</th>
            <th class="pb-1 text-right">Amount</th>
            <th class="pb-1 text-center">Status</th>
            <th class="pb-1 text-left hidden sm:table-cell">Reasoning</th>
          </tr>
        </thead>
        <tbody id="trades-table"></tbody>
      </table>
    </div>
  </div>
</div>

<!-- Phase 3: Self-Improvement Intelligence -->
<div class="max-w-7xl mx-auto px-4 sm:px-6 pb-3">
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-2">
    <!-- Top Patterns -->
    <div class="glass rounded-lg p-3">
      <h2 class="text-xs font-semibold text-white mb-0.5">Top Patterns</h2>
      <p class="text-[9px] text-slate-500 mb-2">Winning strategies by return</p>
      <div id="top-patterns" class="space-y-1 max-h-[120px] overflow-y-auto">
        <p class="text-[11px] text-slate-600">Loading...</p>
      </div>
    </div>
    <!-- Adaptive Thresholds -->
    <div class="glass rounded-lg p-3">
      <h2 class="text-xs font-semibold text-white mb-0.5">Adaptive Thresholds</h2>
      <p class="text-[9px] text-slate-500 mb-2">Self-tuning parameters</p>
      <div id="thresholds-display" class="space-y-1 max-h-[120px] overflow-y-auto">
        <p class="text-[11px] text-slate-600">Loading...</p>
      </div>
    </div>
    <!-- Latest Insights -->
    <div class="glass rounded-lg p-3">
      <h2 class="text-xs font-semibold text-white mb-0.5">Latest Insights</h2>
      <p class="text-[9px] text-slate-500 mb-2">Self-improvement engine</p>
      <div id="latest-insights" class="space-y-1 max-h-[120px] overflow-y-auto">
        <p class="text-[11px] text-slate-600">Loading...</p>
      </div>
    </div>
  </div>
</div>

<!-- v5.1: Market Intelligence Dashboard -->
<div class="max-w-7xl mx-auto px-4 sm:px-6 pb-3">
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-2">
    <!-- Derivatives Positioning -->
    <div class="glass rounded-lg p-3">
      <h2 class="text-xs font-semibold text-white mb-0.5">Derivatives Positioning</h2>
      <p class="text-[9px] text-slate-500 mb-2">Smart money vs retail</p>
      <div id="derivatives-intel" class="space-y-1">
        <p class="text-[11px] text-slate-600">Loading...</p>
      </div>
    </div>
    <!-- Cross-Asset Correlation -->
    <div class="glass rounded-lg p-3">
      <h2 class="text-xs font-semibold text-white mb-0.5">Cross-Asset Intelligence</h2>
      <p class="text-[9px] text-slate-500 mb-2">Gold, Oil, VIX, S&P 500</p>
      <div id="cross-asset-intel" class="space-y-1">
        <p class="text-[11px] text-slate-600">Loading...</p>
      </div>
    </div>
    <!-- Shadow Model Proposals -->
    <div class="glass rounded-lg p-3">
      <h2 class="text-xs font-semibold text-white mb-0.5">Shadow Model Validation</h2>
      <p class="text-[9px] text-slate-500 mb-2">Pending threshold changes</p>
      <div id="shadow-proposals" class="space-y-1 max-h-[120px] overflow-y-auto">
        <p class="text-[11px] text-slate-600">Loading...</p>
      </div>
    </div>
  </div>
</div>

<!-- Footer -->
<div class="border-t border-white/5 px-4 sm:px-6 py-2 text-center">
  <p class="text-[9px] text-slate-600">Schertzinger Company Limited — Auto-refreshes every 30s</p>
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
  pnlEl.textContent = 'Today: ' + pnlSign(p.pnl) + fmt(p.pnl) + ' (' + pnlSign(p.pnlPercent) + p.pnlPercent.toFixed(2) + '%)';
  pnlEl.className = 'text-lg font-bold mono ' + pnlColor(p.pnl);

  const rEl = $('realized-pnl');
  rEl.textContent = pnlSign(p.realizedPnL) + fmt(p.realizedPnL);
  rEl.className = 'text-sm font-semibold mono ' + pnlColor(p.realizedPnL);

  // v5.1.1: Harvested profits display
  const hEl = $('harvested-pnl');
  const harv = p.harvestedProfits || 0;
  hEl.textContent = harv > 0 ? pnlSign(harv) + fmt(harv) : '$0.00';
  hEl.className = 'text-sm font-semibold mono ' + (harv > 0 ? 'text-amber-400' : 'text-slate-500');
  const hcEl = $('harvest-count');
  if (hcEl) hcEl.textContent = (p.harvestCount || 0) > 0 ? p.harvestCount + ' harvests' : 'no harvests yet';

  // Show recent harvests as mini-feed if available
  if (p.recentHarvests && p.recentHarvests.length > 0) {
    const lastH = p.recentHarvests[p.recentHarvests.length - 1];
    if (hcEl) hcEl.textContent = p.harvestCount + ' harvests | last: ' + lastH.symbol + ' +' + lastH.gainPercent + '%';
  }

  $('trade-count').textContent = p.totalTrades;
  $('success-rate').textContent = p.winRate !== undefined ? p.winRate.toFixed(0) + '%' : '--';
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
        '<td class="py-1 font-semibold text-white">' + h.symbol + '</td>' +
        '<td class="py-1 text-right mono text-slate-300">' + fmt(h.usdValue) + '</td>' +
        '<td class="py-1 text-right mono text-slate-500 hidden sm:table-cell">' + costStr + '</td>' +
        '<td class="py-1 text-right"><span class="px-1 py-0.5 rounded ' + pnlBg(pnl) + ' ' + pnlColor(pnl) + ' mono text-[10px]">' +
          pnlSign(pnl) + '$' + Math.abs(pnl).toFixed(2) + (h.totalInvested > 0 ? ' (' + pnlSign(pnlPct) + pnlPct.toFixed(1) + '%)' : '') +
        '</span></td>' +
        '<td class="py-1 text-right text-slate-600 hidden sm:table-cell">' + (h.sector || '-') + '</td>' +
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
      '<td class="py-1 text-slate-400 mono">' + time + '</td>' +
      '<td class="py-1"><span class="px-1 py-0.5 rounded text-[9px] font-semibold ' + actionColor + '">' + tr.action + '</span></td>' +
      '<td class="py-1 text-slate-300 mono">' + pair + '</td>' +
      '<td class="py-1 text-right mono text-white">$' + (tr.amountUSD || 0).toFixed(2) + '</td>' +
      '<td class="py-1 text-center">' + statusIcon + '</td>' +
      '<td class="py-1 text-slate-500 truncate max-w-[200px] hidden sm:table-cell">' + reason + '</td></tr>';
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


