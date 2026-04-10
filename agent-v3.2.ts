/**
 * Henry's Autonomous Trading Agent v20.0
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
 * - MEME_COINS (15%): BRETT, DEGEN, TOSHI
 * - DEFI (18%): AERO, MORPHO, PENDLE, RSR, AAVE, CRV, ENA, ETHFI
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
import { CoinbaseAdvancedTradeClient } from "./src/core/services/coinbase-advanced-trade.js";
import { DerivativesStrategyEngine, DEFAULT_DERIVATIVES_CONFIG, type DerivativesSignal, type DerivativesTradeRecord, type MacroCommoditySignal } from "./src/core/services/derivatives-strategy.js";
import { MacroCommoditySignalEngine, discoverCommodityContracts } from "./src/core/services/macro-commodity-signals.js";

// === v6.0: EQUITY INTEGRATION ===
import { EquityIntegration } from "./src/core/equity-integration.js";

// === v6.1: TOKEN DISCOVERY ENGINE ===
import { TokenDiscoveryEngine, type DiscoveredToken, type TokenDiscoveryState } from "./src/core/services/token-discovery.js";

// === NVR-SPEC-NL: NATURAL LANGUAGE STRATEGY CONFIG ===
import { parseStrategyInstruction, isStrategyInstruction, type ConfigChange, type ParseResult, type ConfigDirective } from "./src/simulation/strategy-config.js";

// === NVR-SPEC-001: BACKTESTING & SIMULATION ENGINE ===
import { runSimulation, compareStrategies, loadPriceHistory, DEFAULT_SIM_CONFIG, type SimConfig } from "./src/simulation/simulator.js";

// === STRATEGY LAB: Paper Trading + Version Registry + Multi-Version Backtester ===
import { STRATEGY_VERSIONS, getVersion, type StrategyVersion } from "./src/simulation/strategy-versions.js";
import {
  createPaperPortfolio, getPaperPortfolio, getAllPaperPortfolios,
  evaluatePaperTrade, updatePaperPortfolio, getPaperPortfolioSummary,
  savePaperPortfolios, loadPaperPortfolios,
  createPaperPortfolio, getPaperPortfolio,
  type PaperPortfolio, type TokenSignal,
} from "./src/simulation/paper-trader.js";
import { runAllVersionBacktestsFromDisk, summarizeBacktestResults } from "./src/simulation/version-backtester.js";

// =============================================================================
// PAPER TRADE GATE — route trades through paper-trader for simulation/validation
// PAPER_TRADE_MODE=true  → ALL trades simulated, NO live execution
// PAPER_VALIDATE_FIRST=true → log simulation THEN proceed with live execution
// =============================================================================
const PAPER_TRADE_MODE = process.env.PAPER_TRADE_MODE === 'true';
const PAPER_VALIDATE_FIRST = process.env.PAPER_VALIDATE_FIRST !== 'false'; // default ON — audit trail before every live trade
const PAPER_GATE_PORTFOLIO_ID = 'paper-gate-shadow';

// === v19.6: STARTUP VALIDATION + TELEGRAM ALERTS ===
import { runPreFlightChecks } from "./src/core/services/startup-checks.js";
import { telegramService } from "./src/core/services/telegram.js";

// === v6.0: SMART CACHING + COOLDOWN + CONSTANTS ===
import { cacheManager, CacheKeys } from "./src/core/services/cache-manager.js";
import { CACHE_TTL } from "./src/core/config/constants.js";
import { activeChain } from "./src/core/config/chain-config.js";
import { cooldownManager } from "./src/core/services/cooldown-manager.js";
import {
  HEAVY_CYCLE_FORCED_INTERVAL_MS,
  AI_MODEL_HEAVY,
  AI_MODEL_ROUTINE,
  SONNET_REQUIRED_REASONS,
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
  // v11.1/v20.2: Cash Deployment Engine (graduated tiers)
  CASH_DEPLOYMENT_TIERS,
  CASH_DEPLOYMENT_THRESHOLD_PCT,
  // CASH_DEPLOY_FEAR_THRESHOLDS removed in v20.8 — F&G is info-only
  CASH_DEPLOYMENT_CONFLUENCE_DISCOUNT,
  CASH_DEPLOYMENT_MAX_DEPLOY_PCT,
  CASH_DEPLOYMENT_MIN_RESERVE_USD,
  CASH_DEPLOYMENT_MAX_ENTRIES,
  CASH_DEPLOY_REQUIRES_MOMENTUM,
  MOMENTUM_HARD_BLOCK_THRESHOLD,
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
  // v20.0: Centralized failure circuit breaker constants (previously shadowed locally)
  MAX_CONSECUTIVE_FAILURES,
  FAILURE_COOLDOWN_HOURS,
  // v20.6: Compressed prompt system
  SYSTEM_PROMPT_CORE,
  SYSTEM_PROMPT_STRATEGY,
  estimateTokens,
} from "./src/core/config/constants.js";
import type { CooldownDecision, TradeRecord, TradePerformanceStats, StrategyPattern, AdaptiveThresholds, PerformanceReview, ExplorationState, ShadowProposal, SectorAllocation, TokenCostBasis, MarketRegime } from "./src/core/types/index.js";
// Phase 3b: Extracted market data, state, and service types
import type { NewsSentimentData, MacroData, GlobalMarketData, StablecoinSupplyData, MarketData, CMCIntelligence, TradingSignal, SignalPayload, TradeDecision } from "./src/core/types/market-data.js";
import type { AgentState, BreakerState, UserDirective, RoundTripTrade, WinRateTruthData, CashDeploymentResult, SignalHistoryEntry, OpportunityCostEntry, HarvestRecipient } from "./src/core/types/state.js";
import type { PoolRegistryEntry, PoolRegistryFile, PoolLiquidity, PriceHistoryStore, OnChainCapitalFlows, BasescanTransfer } from "./src/core/types/services.js";
// Phase 7: Extracted dashboard modules
import { EMBEDDED_DASHBOARD, escapeHtml, fmtExport, generateEquityCurveSVG, nvrExportBaseStyles, generateBacktestMultiExportHTML, generateBacktestSingleExportHTML, generatePaperExportHTML as _generatePaperExportHTML } from "./src/dashboard/index.js";
// Phase 5: Extracted self-improvement engine
import {
  initSelfImprovement, getShadowProposals, setShadowProposals,
  calculateTradePerformance as _calculateTradePerformance,
  calculateWinRateTruth as _calculateWinRateTruth,
  classifyTradePattern as _classifyTradePattern,
  describePattern as _describePattern,
  analyzeStrategyPatterns as _analyzeStrategyPatterns,
  runPerformanceReview as _runPerformanceReview,
  adaptThresholds as _adaptThresholds,
  calculatePatternConfidence as _calculatePatternConfidence,
  checkStagnation as _checkStagnation,
  formatSelfImprovementPrompt as _formatSelfImprovementPrompt,
  formatUserDirectivesPrompt as _formatUserDirectivesPrompt,
  getDirectiveThresholdAdjustments as _getDirectiveThresholdAdjustments,
  THRESHOLD_BOUNDS, DEFAULT_ADAPTIVE_THRESHOLDS, DEFAULT_EXPLORATION_STATE,
} from "./src/core/self-improvement/index.js";
// Phase 7r: Extracted dashboard API functions
import {
  initDashboardAPI,
  sendJSON as _sendJSON, downsample as _downsample, isAuthorized as _isAuthorized,
  calculateRiskRewardMetrics as _calculateRiskRewardMetrics,
  apiPortfolio as _apiPortfolio, apiBalances as _apiBalances, apiSectors as _apiSectors,
  apiTrades as _apiTrades, apiDailyPnL as _apiDailyPnL,
  apiIndicators as _apiIndicators, apiIntelligence as _apiIntelligence,
  apiPatterns as _apiPatterns, apiReviews as _apiReviews, apiThresholds as _apiThresholds,
  getActiveDirectives as _getActiveDirectives, addUserDirective as _addUserDirective,
  removeUserDirective as _removeUserDirective, applyConfigChanges as _applyConfigChanges,
  getActiveConfigDirectives as _getActiveConfigDirectives, removeConfigDirective as _removeConfigDirective,
  executeChatTool as _executeChatTool, handleChatRequest as _handleChatRequest,
  getDashboardHTML as _getDashboardHTML,
} from "./src/dashboard/api.js";
// Phase 13: Extracted HTTP server route handlers
import {
  type ServerContext,
  handleDashboard, handleHealth, handlePersistence, handlePreservation,
  handleCapitalFlows, handleErrors, handleSignals, handleWeeklyReport,
  handleDebug, handleAccounts, handleKill, handleResume,
  handleTrailingStops, handleRiskReview, handleAutoHarvest, handleAutoHarvestTrigger,
  handleAdaptive, handleDerivatives, handleEquity, handleDiscovery, handleCache,
  handleYield, handleYieldRates, handleDexIntelligence,
  handleFamily, handleFamilyMembers, handleFamilyProfiles, handleFamilyWallets,
  handleHealthAudit, handleWinRateTruth, handleCorrectState,
  handleChat, handleDirectives, handleDeleteDirective,
  handleSimulate, handleStrategyVersions, handlePaperPortfolios, handlePaperPortfolioById,
  handleExportResults, handleVersionBacktest,
  handleSwarmStatus, handleSignalDashboard, handleSignalsLatest,
  handleWithdraw, handleStateBackup, handleStateRestore,
  handleConfidence,
  handleModelTelemetry,
  handleTicker,
} from "./src/dashboard/server/index.js";
// Phase 4: Extracted execution engine
import {
  initRpc, getCurrentRpc as _getCurrentRpc, rotateRpc as _rotateRpc,
  rpcCall as _rpcCall, getETHBalance as _getETHBalance, getERC20Balance as _getERC20Balance,
  buildAerodromeExactInputSingleCalldata as _buildAerodromeExactInputSingleCalldata,
  buildExactInputSingleCalldata as _buildExactInputSingleCalldata,
  buildExactInputMultihopCalldata as _buildExactInputMultihopCalldata,
  encodeV3Path as _encodeV3Path,
  initExecutionHelpers, getTokenAddress as _getTokenAddress, getTokenDecimals as _getTokenDecimals,
} from "./src/core/execution/index.js";
// Phase 6: Extracted data fetchers
import {
  initIntelligenceFetchers,
  fetchDefiLlamaData as _fetchDefiLlamaData,
  fetchDerivativesData as _fetchDerivativesData,
  fetchNewsSentiment as _fetchNewsSentiment,
  fetchCrossAssetData as _fetchCrossAssetData,
  fetchCMCIntelligence as _fetchCMCIntelligence,
  fetchMacroData as _fetchMacroData,
} from "./src/core/data/index.js";
// Phase 1b: Extracted algorithm modules
import {
  calculateRSI as _calculateRSI,
  calculateEMA as _calculateEMA,
  calculateMACD as _calculateMACD,
  calculateBollingerBands as _calculateBollingerBands,
  calculateSMA as _calculateSMA,
  calculateATR as _calculateATR,
  calculateADX as _calculateADX,
  determineTrend as _determineTrend,
  decodeSqrtPriceX96 as _decodeSqrtPriceX96,
  calculateConfluence as _calculateConfluence,
  determineMarketRegime as _determineMarketRegime,
  calculateMarketMomentum as _calculateMarketMomentum,
  computeSmartRetailDivergence as _computeSmartRetailDivergence,
  computeFundingMeanReversion as _computeFundingMeanReversion,
  computeTVLPriceDivergence as _computeTVLPriceDivergence,
  getAdjustedSectorTargets as _getAdjustedSectorTargets,
  computeLocalAltseasonSignal as _computeLocalAltseasonSignal,
  computePriceChange as _computePriceChange,
  getEffectiveKellyCeiling as _getEffectiveKellyCeiling,
  calculateKellyPositionSize as _calculateKellyPositionSize,
  calculateVolatilityMultiplier as _calculateVolatilityMultiplier,
  calculateInstitutionalPositionSize as _calculateInstitutionalPositionSize,
  computeAtrStopLevels as _computeAtrStopLevels,
} from "./src/algorithm/index.js";
import type { TechnicalIndicators, DerivativesData, DefiLlamaData, AltseasonSignal, SmartRetailDivergence, FundingRateMeanReversion, TVLPriceDivergence, MarketMomentumSignal } from "./src/algorithm/index.js";
// Phase 9: Extracted reporting/formatting module
import { sf as _sf, formatIntelligenceForPrompt as _formatIntelligenceForPrompt, formatIndicatorsForPrompt as _formatIndicatorsForPrompt } from "./src/core/reporting/index.js";
// Phase 10: Extracted portfolio cost basis module — now imports state directly
import { getOrCreateCostBasis, updateCostBasisAfterBuy as _updateCostBasisAfterBuy, updateCostBasisAfterSell, updateUnrealizedPnL, rebuildCostBasisFromTrades } from "./src/core/portfolio/index.js";
// Phase 11: Extracted diagnostics module — error-tracking now imports state directly
import { logError, recordTradeFailure, clearTradeFailures, isTokenBlocked, logMissedOpportunity as _logMissedOpportunity, updateOpportunityCosts as _updateOpportunityCosts, getOpportunityCostSummary as _getOpportunityCostSummary } from "./src/core/diagnostics/index.js";
import type { OpportunityCostLog } from "./src/core/diagnostics/index.js";
// Phase 12: Extracted capital deployment module
import { getPortfolioSensitivity as _getPortfolioSensitivity, assessVolatility as _assessVolatility, checkCashDeploymentMode as _checkCashDeploymentMode, checkCrashBuyingOverride as _checkCrashBuyingOverride } from "./src/core/capital/index.js";
// Phase 13: Extracted gas & liquidity module
import { fetchPoolLiquidity as _fetchPoolLiquidity, checkLiquidity as _checkLiquidity, fetchGasPrice as _fetchGasPrice, checkGasCost as _checkGasCost } from "./src/core/gas/index.js";
// Phase 14: Extracted on-chain capital flows module
import { detectOnChainCapitalFlows as _detectOnChainCapitalFlows, fetchBlockscoutTransfers as _fetchBlockscoutTransfers, pairTransfersIntoTrades as _pairTransfersIntoTrades } from "./src/core/chain/index.js";
// Phase 3c: Centralized state store
import { setState as _storeSetState, setBreakerState as _storeSetBreakerState, markStateDirty as _storeMarkStateDirty, isStateDirty as _storeIsStateDirty, isCriticalPending as _storeIsCriticalPending, clearDirtyFlag as _storeClearDirtyFlag } from "./src/core/state/index.js";
// Phase 2: Extracted config modules
import { TOKEN_REGISTRY, SECTORS, CDP_UNSUPPORTED_TOKENS, DEX_SWAP_TOKENS, QUOTE_DECIMALS, WETH_ADDRESS, USDC_ADDRESS, CBBTC_ADDRESS, VIRTUAL_ADDRESS } from "./src/core/config/token-registry.js";
import type { SectorKey } from "./src/core/config/token-registry.js";
import { CHAINLINK_FEEDS_BASE, CHAINLINK_ABI_FRAGMENT } from "./src/core/config/chainlink-feeds.js";
// v20.0: Adaptive Exit Timing Engine — ATR-based trailing stops
import { updateTrailingStop, checkTrailingStopHit, getTrailingStopState, getTrailingStop, removeTrailingStop, resetTrailingStopTrigger, saveTrailingStops, loadTrailingStops } from "./src/core/services/trailing-stops.js";
// v20.0: MEV Protection
import { calculateAdaptiveSlippage, needsMevProtection } from "./src/core/services/mev-protection.js";
// v20.0: DEX Aggregator for better execution prices
import { getBestAggregatorQuote, shouldUseAggregator } from "./src/core/services/dex-aggregator.js";
// v20.0: Adversarial Risk Reviewer + Enhanced Drawdown Controls
import { reviewTrade, updateDrawdownTracking, isTradeAllowedByDrawdown, type RiskReviewInput } from "./src/core/services/risk-reviewer.js";

// === v11.0: FAMILY PLATFORM MODULE ===
import { familyManager, WalletManager, fanOutDecision, executeFamilyTrades } from "./src/fleet/family/index.js";
import type { FamilyTradeDecision, FamilyTradeResult } from "./src/fleet/types/family.js";

// === v11.0: AAVE V3 YIELD SERVICE ===
import { aaveYieldService } from "./src/core/services/aave-yield.js";
// v21.2: Morpho yield — DISABLED for now (was crashing Railway deploys)
// TODO: Re-enable once import issue is resolved
const morphoYieldService = {
  enable() {}, disable() {}, isEnabled() { return false; },
  getState() { return { enabled: false, depositedUSDC: 0, currentValueUSDC: 0, totalYieldEarned: 0, shareBalance: 0, supplyCount: 0, withdrawCount: 0, lastSupply: null, lastWithdraw: null, estimatedAPY: 0, operations: [] }; },
  getDepositedUSDC() { return 0; },
  restoreState(_s: any) {}, toJSON() { return {}; },
  refreshBalance(_w: string) { return Promise.resolve(); },
  calculateDepositAmount(_usdcBalance: number, _regime: string, _fearGreedVal: number) { return 0; }, calculateWithdrawAmount(_usdcBalance: number, _regime: string, _fearGreedVal: number, _aiNeedsCapital?: boolean) { return 0; },
  buildDepositCalldata(_a: number, _w: string) { return { to: '', data: '', approvalNeeded: false, approvalTo: '', approvalData: '' }; },
  buildWithdrawCalldata(_a: number, _w: string) { return { to: '', data: '' }; },
  getAllowance(_w: string) { return Promise.resolve(0n); },
  recordSupply(_amountUSDC: number, _txHash?: string, _reason?: string) {}, recordWithdraw(_amountUSDC: number, _txHash?: string, _reason?: string) {},
};

// === v15.3: MULTI-PROTOCOL YIELD OPTIMIZER ===
import { yieldOptimizer } from "./src/core/services/yield-optimizer.js";
import type { ProtocolYield } from "./src/core/services/yield-optimizer.js";

// === v14.1: MOMENTUM DECELERATION DETECTOR (Smart Trim) ===
import { createDecelState, updateBuyRatioHistory, detectDeceleration } from "./src/core/services/deceleration-detector.js";
import type { DecelState } from "./src/core/services/deceleration-detector.js";

// === v19.0: MULTI-TIMEFRAME FLOW AGGREGATION ===
import { createFlowTimeframeState, recordFlowReading, getFlowTimeframes } from "./src/core/services/flow-timeframes.js";
import type { FlowTimeframeState } from "./src/core/services/flow-timeframes.js";

// === v19.0: SIGNAL QUALITY TRACKER ===
import { recordExecuted, recordFiltered, getSignalStats } from "./src/core/services/signal-tracker.js";
import { generateWeeklyReport, shouldGenerateReport, getLatestReport } from "./src/core/services/weekly-report.js";
import type { YieldState } from "./src/core/services/aave-yield.js";

// === v11.0: GECKOTERMINAL DEX INTELLIGENCE ===
import { geckoTerminalService } from "./src/core/services/gecko-terminal.js";
import type { DexIntelligence } from "./src/core/services/gecko-terminal.js";

// === v15.0: MULTI-AGENT SWARM ARCHITECTURE ===
import { runSwarm, formatSwarmForPrompt, setLatestSwarmDecisions, getLatestSwarmDecisions, getLastSwarmRunTime } from "./src/core/services/swarm/orchestrator.js";
import type { SwarmDecision } from "./src/core/services/swarm/agent-framework.js";
import { SIGNAL_ENGINE } from "./src/core/config/constants.js";

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
// TOKEN UNIVERSE — imported from config/token-registry.ts (Phase 2)
// ============================================================================

// TOKEN_REGISTRY, CDP_UNSUPPORTED_TOKENS, DEX_SWAP_TOKENS — imported from config/token-registry.ts

// CHAINLINK_FEEDS_BASE, CHAINLINK_ABI_FRAGMENT — imported from config/chainlink-feeds.ts

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

// PoolRegistryEntry, PoolRegistryFile — imported from types/services.ts

const POOL_REGISTRY_VERSION = 6; // v20.5: Bump — force re-discovery for new tokens (AAVE, CRV, ENA, ETHFI)

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
// WETH_ADDRESS, USDC_ADDRESS, CBBTC_ADDRESS, VIRTUAL_ADDRESS, QUOTE_DECIMALS — imported from config/token-registry.ts

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

        // v20.4.2: Read tickSpacing for Aerodrome Slipstream pools
        let tickSpacing: number | undefined;
        if (poolType === 'aerodromeV3') {
          try {
            // tickSpacing() selector: 0xd0c93a7c
            const tsResult = await rpcCall('eth_call', [{ to: pool.pairAddress, data: '0xd0c93a7c' }, 'latest']);
            if (tsResult && tsResult !== '0x' && tsResult.length >= 66) {
              const raw = parseInt(tsResult.slice(0, 66), 16);
              tickSpacing = raw > 0x7fffff ? raw - 0x1000000 : raw; // int24 decoding
              console.log(`     🔵 ${symbol}: Aerodrome Slipstream tickSpacing=${tickSpacing}`);
            }
          } catch { /* non-critical — will try all spacings during swap */ }
        }

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
          tickSpacing,
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

// decodeSqrtPriceX96 — delegated to src/algorithm/indicators.ts
const decodeSqrtPriceX96 = _decodeSqrtPriceX96;

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

  // v20.3.1: Chainlink deviation detection — compare DEX prices vs oracle reference
  // When DEX deviates >2% from Chainlink, it signals mispricing or arbitrage opportunity
  const chainlinkPrices = await fetchChainlinkPrices();
  const deviations: { symbol: string; dexPrice: number; oraclePrice: number; deviationPct: number }[] = [];
  for (const [symbol, oraclePrice] of chainlinkPrices) {
    const dexPrice = prices.get(symbol);
    if (dexPrice && oraclePrice > 0) {
      const deviation = ((dexPrice - oraclePrice) / oraclePrice) * 100;
      if (Math.abs(deviation) > 2.0) {
        deviations.push({ symbol, dexPrice, oraclePrice, deviationPct: deviation });
      }
    }
  }
  if (deviations.length > 0) {
    chainlinkDeviations = deviations;
    console.log(`  ⚡ CHAINLINK DEVIATION: ${deviations.map(d => `${d.symbol} DEX=$${d.dexPrice.toFixed(2)} vs Oracle=$${d.oraclePrice.toFixed(2)} (${d.deviationPct > 0 ? '+' : ''}${d.deviationPct.toFixed(1)}%)`).join(' | ')}`);
  } else {
    chainlinkDeviations = [];
  }

  return prices;
}

// ============================================================================
// v12.0: SELF-ACCUMULATING PRICE HISTORY STORE
// ============================================================================

// PriceHistoryStore — imported from types/services.ts

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

// computePriceChange — delegated to src/algorithm/market-analysis.ts
function computePriceChange(symbol: string, currentPrice: number, lookbackMs: number): number {
  return _computePriceChange(priceHistoryStore.tokens[symbol], currentPrice, lookbackMs);
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

// computeLocalAltseasonSignal — delegated to src/algorithm/market-analysis.ts
function computeLocalAltseasonSignal(): AltseasonSignal {
  return _computeLocalAltseasonSignal(
    priceHistoryStore.tokens['cbBTC'],
    priceHistoryStore.tokens['ETH'] || priceHistoryStore.tokens['WETH'],
    BTC_DOMINANCE_CHANGE_THRESHOLD,
  );
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

// HarvestRecipient — imported from types/state.ts

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

// v21.2: Gemma 4 local model integration
import { callModelWithShadow, logModelTelemetry } from './src/core/services/model-client.js';
import type { GemmaMode } from './src/core/services/model-client.js';
const gemmaMode: GemmaMode = (process.env.GEMMA_MODE as GemmaMode) || 'disabled';
if (gemmaMode !== 'disabled') {
  console.log(`[Gemma] Mode: ${gemmaMode} | Ollama: ${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}`);
}

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

  const client = new CdpClient({
    apiKeyId,
    apiKeySecret,
    walletSecret,
  });

  // v20.4.3: Validate CDP client is functional before returning
  // If credentials are malformed, fail fast at startup rather than silently during trades
  if (!client || typeof client.evm?.getOrCreateAccount !== 'function') {
    throw new Error('CDP client created but evm.getOrCreateAccount is not available — SDK version mismatch or malformed credentials');
  }

  return client;
}

let cdpClient: CdpClient;

// === NVR CENTRAL SIGNAL SERVICE — Module State ===
let signalMode: 'local' | 'central' | 'producer' = 'local'; // Set in main() based on env
let latestSignals: SignalPayload | null = null;
let signalCycleNumber = 0;

// === NVR-SPEC-004: Signal Dashboard — History Tracking (capped at 100) ===
// SignalHistoryEntry — imported from types/state.ts
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

// === v21.3: TRADE DROUGHT DETECTOR ===
// Alert if the bot runs for 2+ hours without executing a single trade.
let lastSuccessfulTradeAt = Date.now(); // Assume last trade was "now" on startup
let tradeDroughtAlerted = false; // Prevent spamming — alert once per drought
const TRADE_DROUGHT_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

// === v6.0: LIGHT/HEAVY CYCLE STATE ===
let lastHeavyCycleAt = 0;
let lastPriceSnapshot: Map<string, number> = new Map();
let lastVolumeSnapshot: Map<string, number> = new Map();
let lastFearGreedValue = 0;
let lastMarketRegime = 'UNKNOWN'; // v20.3.1: Track for hourly Telegram reports
let chainlinkDeviations: { symbol: string; dexPrice: number; oraclePrice: number; deviationPct: number }[] = []; // v20.3.1: DEX vs oracle price deviations

// === v19.3: CAPITAL PRESERVATION MODE ===
// When F&G < 15 for >6 consecutive hours, only allow high-conviction trades.
// v19.3.2: Removed cycle multiplier — bot ALWAYS cycles at normal speed.
// Preservation mode filters WHAT trades happen, not HOW OFTEN the bot runs.
// The bot needs to cycle fast to execute trailing stop sells and cut losses.
const PRESERVATION_FG_ACTIVATE = 12;   // v20.2: 15→12 — only activate in truly extreme fear. F&G 12-15 is fear, not extreme. Market bottoms here.
const PRESERVATION_FG_DEACTIVATE = 20; // v20.2: 25→20 — resume normal trading sooner. Prevents overlap with graduated fear deploy multiplier.
const PRESERVATION_RING_BUFFER_SIZE = 36; // 6 hours at 10-min cycles
const PRESERVATION_CYCLE_MULTIPLIER = 1; // v19.3.2: NO slowdown — always cycle at normal speed
// v19.6.1: REMOVED hard buy-block. The AI sees F&G data and should make its own decisions.
// Old behavior: confluence >= 80 required (impossible bar = zero trades for days).
// New behavior: reduce position sizes by 50% during extreme fear, but let the AI trade.
// The circuit breaker is the real safety net, not a blunt F&G gate.
const PRESERVATION_MIN_CONFLUENCE = 25;   // v19.6.1: Same as normal — let AI decide (was 80)
const PRESERVATION_MIN_SWARM_CONSENSUS = 50; // v19.6.1: Reasonable bar, not impossible (was 80)
const PRESERVATION_SIZE_MULTIPLIER = 0.5;  // v19.6.1: Half-size positions during extreme fear
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
  // v20.8: F&G demoted to info-only. Preservation mode is DISABLED.
  // The bot follows price physics (momentum, volume, capital flows), not sentiment surveys.
  // F&G is still tracked for logging/dashboard display.
  capitalPreservationMode.fearReadings.push(fgValue);
  if (capitalPreservationMode.fearReadings.length > PRESERVATION_RING_BUFFER_SIZE) {
    capitalPreservationMode.fearReadings.shift();
  }
  capitalPreservationMode.lastUpdated = Date.now();

  // Force deactivation if somehow still active from before this update
  if (capitalPreservationMode.isActive) {
    console.log(`\n🟢 PRESERVATION MODE DISABLED (v20.8) — F&G=${fgValue} logged as info-only`);
    capitalPreservationMode.isActive = false;
    capitalPreservationMode.activatedAt = null;
  }
}

// === v20.2: OPPORTUNITY COST TRACKER — delegated to src/diagnostics/opportunity-tracking.ts ===
const opportunityCostState: OpportunityCostLog = { entries: [], cumulativeMissedPnl: 0, cumulativeMissedCount: 0 };
function logMissedOpportunity(token: string, reason: string, blockedSizeUSD: number, priceAtBlock: number): void {
  _logMissedOpportunity(token, reason, blockedSizeUSD, priceAtBlock, opportunityCostState);
}
function updateOpportunityCosts(currentPrices: Record<string, number>): void {
  _updateOpportunityCosts(currentPrices, opportunityCostState);
}
function getOpportunityCostSummary() {
  return _getOpportunityCostSummary(opportunityCostState);
}

// V4.5: Intelligence data for API endpoint
let lastIntelligenceData: any = null;

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

// === v11.1/v20.2: CASH DEPLOYMENT ENGINE STATE ===
let cashDeploymentMode = false;
let cashDeploymentCycles = 0;

// DeploymentTierLabel, CashDeploymentResult — imported from types/state.ts
type DeploymentTierLabel = typeof CASH_DEPLOYMENT_TIERS[number]['label'] | 'NONE';

// ============================================================================
// CAPITAL DEPLOYMENT — delegated to src/capital/deployment.ts
// ============================================================================
function getFearAdjustedDeployThreshold(_fearGreedValue: number): number {
  return CASH_DEPLOYMENT_THRESHOLD_PCT;
}
function checkCashDeploymentMode(
  usdcBalance: number, totalPortfolioValue: number, _fearGreedValue: number = 50,
): CashDeploymentResult {
  return _checkCashDeploymentMode(usdcBalance, totalPortfolioValue, _fearGreedValue,
    CASH_DEPLOYMENT_TIERS, CASH_DEPLOYMENT_MIN_RESERVE_USD, getDirectiveThresholdAdjustments(),
    { cashDeploymentMode, cashDeploymentCycles });
}

// === v11.2: CRASH-BUYING BREAKER OVERRIDE STATE ===
let crashBuyingOverrideActive = false;
let crashBuyingOverrideCycles = 0;
function checkCrashBuyingOverride(
  deploymentCheck: { active: boolean; cashPercent: number; excessCash: number; deployBudget: number; confluenceDiscount: number },
  fearGreedValue: number, belowCapitalFloor: boolean,
) {
  return _checkCrashBuyingOverride(deploymentCheck, fearGreedValue, belowCapitalFloor,
    DEPLOYMENT_BREAKER_OVERRIDE_MIN_CASH_PCT, DEPLOYMENT_BREAKER_OVERRIDE_SIZE_MULT,
    DEPLOYMENT_BREAKER_OVERRIDE_MAX_ENTRIES, CASH_DEPLOYMENT_MAX_ENTRIES,
    { crashBuyingOverrideActive, crashBuyingOverrideCycles });
}

function getPortfolioSensitivity(portfolioUSD: number) {
  return _getPortfolioSensitivity(portfolioUSD, PORTFOLIO_SENSITIVITY_TIERS);
}
function assessVolatility(currentPrices: Map<string, number>, previousPrices: Map<string, number>) {
  return _assessVolatility(currentPrices, previousPrices);
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
    preservationNote = PRESERVATION_CYCLE_MULTIPLIER > 1 ? ` | PRESERVATION MODE (${PRESERVATION_CYCLE_MULTIPLIER}x)` : ' | PRESERVATION MODE (active)';
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
      // v20.5: Flush any dirty state at end of cycle (batched I/O)
      flushStateIfDirty('end-of-cycle');

      // v21.3: TRADE DROUGHT DETECTOR — alert if no trades for 2+ hours
      const timeSinceLastTrade = Date.now() - lastSuccessfulTradeAt;
      if (timeSinceLastTrade > TRADE_DROUGHT_THRESHOLD_MS && !tradeDroughtAlerted) {
        tradeDroughtAlerted = true;
        const droughtHours = (timeSinceLastTrade / 3600000).toFixed(1);
        const blockers: string[] = [];
        if (!CONFIG.trading.enabled) blockers.push("Trading is DISABLED (dry run)");
        if (!cdpClient) blockers.push("CDP client not initialized");
        const drawdown = state.trading.peakValue > 0 ? ((state.trading.peakValue - state.trading.totalPortfolioValue) / state.trading.peakValue) * 100 : 0;
        if (drawdown >= 20) blockers.push(`Circuit breaker: ${drawdown.toFixed(1)}% drawdown`);
        if (state.trading.totalPortfolioValue < CAPITAL_FLOOR_ABSOLUTE_USD && state.trading.totalPortfolioValue > 0) blockers.push(`Capital floor: $${state.trading.totalPortfolioValue.toFixed(2)} < $${CAPITAL_FLOOR_ABSOLUTE_USD}`);
        if (blockers.length === 0) blockers.push("No obvious blockers — AI may be choosing HOLD for all tokens");

        console.warn(`\n🚨 TRADE DROUGHT: No trades in ${droughtHours} hours!`);
        blockers.forEach(b => console.warn(`   ❌ ${b}`));
        await telegramService.sendAlert({
          severity: "HIGH",
          title: `Trade Drought — ${droughtHours}h with zero trades`,
          message: `Bot has been running but hasn't executed a trade in ${droughtHours} hours.\n\nPossible causes:\n${blockers.map(b => `• ${b}`).join('\n')}\n\nPortfolio: $${state.trading.totalPortfolioValue.toFixed(2)}\nCycles completed: ${state.totalCycles}`,
        });
      }
    }
    // After cycle completes, schedule the next one (interval may have changed)
    scheduleNextCycle();
  }, delayMs);
}

/**
 * v6.2 / v21.0: Initialize smart price stream from DexScreener.
 * Provides real-time price updates between cycles for emergency detection.
 *
 * v21.0: Smart polling — instead of polling all 40+ tokens every 10s, only poll
 * tokens that matter. Three tiers:
 *   - Every 10s: Active tokens (holdings + ETH/USDC + watchlist) — ~15-20 tokens
 *   - Every 60s: Also include cooldown tokens — adds ~5-10 more
 *   - Every 5min: Full registry sweep — catch new opportunities on all tokens
 */
function initPriceStream() {
  // DexScreener doesn't have a public WebSocket API, so we use a high-frequency
  // HTTP polling approach with a dedicated interval (every 10s) for real-time awareness.
  // This is more reliable than WebSocket for DexScreener and avoids connection issues.

  const STREAM_INTERVAL = 10000; // 10 seconds
  const COOLDOWN_POLL_INTERVAL = 60000; // 60 seconds — poll cooldown tokens less often
  const FULL_SWEEP_INTERVAL = 5 * 60 * 1000; // 5 minutes — full registry discovery

  let lastCooldownPollAt = 0;
  let lastFullPollAt = 0;

  /**
   * v21.0: Determine which tokens should be polled this tick.
   * Returns [symbolsToQuery, pollMode] where pollMode is for logging.
   */
  function getActiveTokens(): [string[], string] {
    const now = Date.now();
    const activeSymbols = new Set<string>();

    // --- ALWAYS POLL: ETH and USDC (base pair, needed for gas/balance) ---
    activeSymbols.add("ETH");
    activeSymbols.add("WETH");
    // USDC is filtered out before the API call (no DexScreener pair), but we
    // include it in the set so it's counted in the log correctly.

    // --- ALWAYS POLL: Tokens the bot currently holds (costBasis entries with value) ---
    if (state.costBasis) {
      for (const sym of Object.keys(state.costBasis)) {
        if (TOKEN_REGISTRY[sym]) {
          activeSymbols.add(sym);
        }
      }
    }
    // Also check live balances — costBasis may lag behind on-chain state
    if (state.trading?.balances) {
      for (const b of state.trading.balances) {
        if (b.usdValue > 1 && TOKEN_REGISTRY[b.symbol]) {
          activeSymbols.add(b.symbol);
        }
      }
    }

    // --- ALWAYS POLL: Watchlist tokens from user directives ---
    const activeDirectives = (state.userDirectives || []).filter(
      (d: UserDirective) => !d.expiresAt || d.expiresAt > new Date().toISOString()
    );
    for (const d of activeDirectives) {
      if ((d.type === 'WATCHLIST' || d.type === 'RESEARCH') && d.token && TOKEN_REGISTRY[d.token]) {
        activeSymbols.add(d.token);
      }
    }

    // --- Determine poll mode based on elapsed time ---
    const doFullSweep = (now - lastFullPollAt) >= FULL_SWEEP_INTERVAL;
    const doCooldownPoll = (now - lastCooldownPollAt) >= COOLDOWN_POLL_INTERVAL;

    if (doFullSweep) {
      // Full registry sweep — all tokens for discovery
      lastFullPollAt = now;
      lastCooldownPollAt = now; // Reset cooldown timer too
      const allSymbols = Object.keys(TOKEN_REGISTRY);
      return [allSymbols, "full"];
    }

    if (doCooldownPoll) {
      // Include cooldown tokens alongside active tokens
      lastCooldownPollAt = now;
      const cooldowns = cooldownManager.getActiveCooldowns();
      for (const cd of cooldowns) {
        if (TOKEN_REGISTRY[cd.symbol]) {
          activeSymbols.add(cd.symbol);
        }
      }
      // Also include circuit-breaker tokens (tradeFailures) — they're in cooldown too
      if (state.tradeFailures) {
        for (const sym of Object.keys(state.tradeFailures)) {
          if (TOKEN_REGISTRY[sym]) {
            activeSymbols.add(sym);
          }
        }
      }
      return [Array.from(activeSymbols), "cooldown"];
    }

    // Normal 10s tick — active tokens only
    return [Array.from(activeSymbols), "active"];
  }

  const streamPrices = async () => {
    try {
      const [symbolsToQuery, pollMode] = getActiveTokens();

      const addresses = symbolsToQuery
        .filter(s => s !== "USDC") // USDC has no DexScreener pair
        .map(s => TOKEN_REGISTRY[s]?.address)
        .filter(Boolean)
        .join(",");

      if (!addresses) return; // Nothing to poll

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

        // v21.0: Log polling mode and token count (skip "active" mode to keep console clean)
        const totalRegistry = Object.keys(TOKEN_REGISTRY).length;
        const polledCount = symbolsToQuery.filter(s => s !== "USDC").length;
        if (pollMode === "full") {
          console.log(`  [Price] Polling ${polledCount} tokens (full sweep — discovery cycle)`);
        } else if (pollMode === "cooldown") {
          console.log(`  [Price] Polling ${polledCount}/${totalRegistry} tokens (${pollMode}: active + cooldown)`);
        }
        // "active" mode logs nothing — it fires every 10s, would spam the console
      }
    } catch {
      // Silent fail — normal cycles still work as backup
      adaptiveCycle.wsConnected = false;
    }
  };

  // Start streaming — first call is always a full sweep (lastFullPollAt = 0 triggers it)
  streamPrices();
  setInterval(streamPrices, STREAM_INTERVAL);
  console.log(`   📡 Real-time price stream: active (${STREAM_INTERVAL / 1000}s polling, smart filter: active/60s cooldown/5m full)`);
}

// ============================================================================
// STATE
// ============================================================================

// TradeRecord, TradePerformanceStats — imported from types/index.ts

/**
 * Calculate trade performance stats from history (for AI context)
 */
// ============================================================================
// SELF-IMPROVEMENT ENGINE — delegated to src/self-improvement/engine.ts
// ============================================================================
const calculateTradePerformance = _calculateTradePerformance;
const calculateWinRateTruth = _calculateWinRateTruth;
const classifyTradePattern = _classifyTradePattern;
const describePattern = _describePattern;
const analyzeStrategyPatterns = _analyzeStrategyPatterns;
const runPerformanceReview = _runPerformanceReview;
const adaptThresholds = _adaptThresholds;
const calculatePatternConfidence = _calculatePatternConfidence;
const checkStagnation = _checkStagnation;
const formatSelfImprovementPrompt = _formatSelfImprovementPrompt;
const formatUserDirectivesPrompt = _formatUserDirectivesPrompt;
const getDirectiveThresholdAdjustments = _getDirectiveThresholdAdjustments;
let shadowProposals = getShadowProposals();
let atrComparisonLogCount = 0;

// SectorAllocation, TokenCostBasis — imported from types/index.ts

// AgentState, UserDirective — imported from types/state.ts

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
    maxDrawdownPercent: 0, // v21.4: Lifetime max drawdown tracking
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
  // v19.5.0: Deposit tracking — detected from on-chain Blockscout data (source of truth)
  totalDeposited: 0,
  onChainWithdrawn: 0,
  lastKnownUSDCBalance: 0,
  depositHistory: [],
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
        state.trading.maxDrawdownPercent = parsed.maxDrawdownPercent || 0; // v21.4: Restore lifetime max drawdown
        state.trading.totalTrades = parsed.totalTrades || 0;
        state.trading.successfulTrades = parsed.successfulTrades || 0;
        // v11.4.24: Restore lifetime trade counters (persisted separately from capped trade array)
        if (parsed.lifetimeTotalTrades && parsed.lifetimeTotalTrades > state.trading.totalTrades) {
          state.trading.totalTrades = parsed.lifetimeTotalTrades;
        }
        if (parsed.lifetimeSuccessfulTrades && parsed.lifetimeSuccessfulTrades > state.trading.successfulTrades) {
          state.trading.successfulTrades = parsed.lifetimeSuccessfulTrades;
        }
        // v11.4.12: Restore fields that were saved but never loaded back
        if (parsed.currentValue && parsed.currentValue > 0) state.trading.totalPortfolioValue = parsed.currentValue;
        if (parsed.sectorAllocations) state.trading.sectorAllocations = parsed.sectorAllocations;
        state.costBasis = parsed.costBasis || {};
        state.profitTakeCooldowns = parsed.profitTakeCooldowns || {};
        state.stopLossCooldowns = parsed.stopLossCooldowns || {};
        state.tradeFailures = parsed.tradeFailures || {};
        // v11.4.11: Clear stale circuit breaker entries on startup — unsupported tokens
        // are now skipped via CDP_UNSUPPORTED_TOKENS, so old failures won't recur
        // v20.4.2: Preserve trade failures across restarts — don't clear on startup.
        // If a token's swap routes are broken, restarting shouldn't retry them immediately.
        // The cooldown timer (FAILURE_COOLDOWN_HOURS) handles expiry automatically.
        if (Object.keys(state.tradeFailures).length > 0) {
          const active = Object.entries(state.tradeFailures).filter(([, f]) => {
            const hours = (Date.now() - new Date(f.lastFailure).getTime()) / 3600000;
            return hours < FAILURE_COOLDOWN_HOURS && f.count >= MAX_CONSECUTIVE_FAILURES;
          });
          if (active.length > 0) {
            console.log(`  🚫 ${active.length} token(s) still blocked: ${active.map(([s, f]) => `${s}(${f.count} fails)`).join(', ')}`);
          }
          // Clear expired entries
          for (const [sym, f] of Object.entries(state.tradeFailures)) {
            const hours = (Date.now() - new Date(f.lastFailure).getTime()) / 3600000;
            if (hours >= FAILURE_COOLDOWN_HOURS) delete state.tradeFailures[sym];
          }
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
        // v20.1: Reset stale breaker state if pause has already expired or losses are from a previous deploy
        if (parsed.breakerState) {
          breakerState = { ...DEFAULT_BREAKER_STATE, ...parsed.breakerState };
          // If the breaker was triggered but the pause period has expired, clear it
          if (breakerState.lastBreakerTriggered) {
            const pauseEnd = new Date(breakerState.lastBreakerTriggered).getTime() + (BREAKER_PAUSE_HOURS * 3600000);
            if (Date.now() > pauseEnd) {
              console.log(`  ✅ Breaker pause expired — clearing stale breaker state (was: ${breakerState.consecutiveLosses} losses, rolling: ${breakerState.rollingTradeResults?.length || 0} entries, triggered ${breakerState.lastBreakerTriggered})`);
              breakerState = { ...DEFAULT_BREAKER_STATE };
            } else {
              console.log(`  🚨 Breaker state: ${breakerState.consecutiveLosses} consecutive losses, last triggered ${breakerState.lastBreakerTriggered}`);
            }
          } else if (breakerState.consecutiveLosses > 0) {
            // Losses recorded but no breaker triggered — check if they're stale (no trades in 24h = reset)
            const lastResult = breakerState.rollingTradeResults.length > 0;
            if (!lastResult && breakerState.consecutiveLosses >= BREAKER_CONSECUTIVE_LOSSES) {
              console.log(`  ✅ Resetting stale consecutive losses (${breakerState.consecutiveLosses}) — no recent trade activity`);
              breakerState.consecutiveLosses = 0;
              breakerState.rollingTradeResults = [];
            } else {
              console.log(`  🚨 Breaker state: ${breakerState.consecutiveLosses} consecutive losses`);
            }
          }
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
        // v21.2: Restore Morpho yield state
        if (parsed.morphoYieldState) {
          morphoYieldService.restoreState(parsed.morphoYieldState);
          const ms = morphoYieldService.getState();
          console.log(`  🏦 Morpho yield restored: $${ms.depositedUSDC.toFixed(2)} deposited, $${ms.totalYieldEarned.toFixed(4)} earned, ${ms.supplyCount} supplies`);
        }
        // v11.4.5-6: Restore migration flags
        if (parsed._migrationCostBasisV1145) {
          (state as any)._migrationCostBasisV1145 = true;
        }
        if (parsed._migrationCostBasisV1146) {
          (state as any)._migrationCostBasisV1146 = true;
        }
        if (parsed._migrationPnLResetV1950) {
          (state as any)._migrationPnLResetV1950 = true;
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
        // v19.5.0: Restore deposit tracking from state file (will be overwritten by on-chain truth on first cycle)
        state.totalDeposited = parsed.totalDeposited || 0;
        state.onChainWithdrawn = parsed.onChainWithdrawn || 0;
        state.lastKnownUSDCBalance = parsed.lastKnownUSDCBalance || 0;
        state.depositHistory = parsed.depositHistory || [];
        if (state.totalDeposited > 0) {
          console.log(`  💵 Deposit tracking: $${state.totalDeposited.toFixed(2)} deposited, $${state.onChainWithdrawn.toFixed(2)} withdrawn (${state.depositHistory.length} deposits)`);
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
        // v21.2: Clamp ALL adaptive thresholds to THRESHOLD_BOUNDS on restore.
        // The shadow proposal system drifted confluenceBuy to 30 and confluenceStrongBuy to 60,
        // which paralyzed the bot (zero trades for 15+ hours). Force back within safe bounds.
        for (const [field, bounds] of Object.entries(THRESHOLD_BOUNDS)) {
          const val = (state.adaptiveThresholds as any)[field];
          if (val !== undefined && typeof val === 'number') {
            const clamped = Math.max(bounds.min, Math.min(bounds.max, val));
            if (clamped !== val) {
              console.log(`  ⚠️ Clamped ${field}: ${val} → ${clamped} (bounds: ${bounds.min}–${bounds.max})`);
              (state.adaptiveThresholds as any)[field] = clamped;
            }
          }
        }
        // v21.2: Hard reset — if confluenceBuy drifted above 25, reset to 25.
        // The bot MUST be able to trade. A threshold of 30 means nothing qualifies.
        if (state.adaptiveThresholds.confluenceBuy > 25) {
          console.log(`  🔧 RESET confluenceBuy: ${state.adaptiveThresholds.confluenceBuy} → 25 (was paralyzed)`);
          state.adaptiveThresholds.confluenceBuy = 25;
        }
        if (state.adaptiveThresholds.confluenceStrongBuy > 40) {
          console.log(`  🔧 RESET confluenceStrongBuy: ${state.adaptiveThresholds.confluenceStrongBuy} → 40 (was paralyzed)`);
          state.adaptiveThresholds.confluenceStrongBuy = 40;
        }
        console.log(`  📂 Loaded ${state.tradeHistory.length} trades, ${Object.keys(state.costBasis).length} cost basis entries from ${file}`);
        console.log(`  🧠 Phase 3: ${Object.keys(state.strategyPatterns).length} patterns, ${state.performanceReviews.length} reviews, ${state.adaptiveThresholds.adaptationCount} adaptations`);
        // v20.0: Restore trailing stops from disk
        loadTrailingStops();
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
      maxDrawdownPercent: state.trading.maxDrawdownPercent || 0, // v21.4: Persist lifetime max drawdown
      currentValue: state.trading.totalPortfolioValue,
      totalTrades: state.trading.totalTrades,
      successfulTrades: state.trading.successfulTrades,
      sectorAllocations: state.trading.sectorAllocations,
      trades: state.tradeHistory.slice(-2500), // v11.4.24: Raised from 1000 to 2500 — Kelly needs full rolling window
      lifetimeTotalTrades: state.trading.totalTrades,
      lifetimeSuccessfulTrades: state.trading.successfulTrades,
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
      // v19.5.0: On-chain deposit/withdrawal tracking
      totalDeposited: state.totalDeposited,
      onChainWithdrawn: state.onChainWithdrawn,
      lastKnownUSDCBalance: state.lastKnownUSDCBalance,
      depositHistory: state.depositHistory.slice(-50),
      // v10.0: Market Intelligence Engine historical data
      fundingRateHistory,
      btcDominanceHistory: { values: btcDominanceHistory.values.slice(-504) },
      stablecoinSupplyHistory: { values: stablecoinSupplyHistory.values.slice(-504) },
      // v11.0: Aave V3 yield state persistence
      aaveYieldState: aaveYieldService.getState(),
      // v21.2: Morpho yield state persistence
      morphoYieldState: morphoYieldService.getState(),
      // v11.4.5-6: Migration flags
      _migrationCostBasisV1145: (state as any)._migrationCostBasisV1145 || false,
      _migrationCostBasisV1146: (state as any)._migrationCostBasisV1146 || false,
      _migrationPnLResetV1950: (state as any)._migrationPnLResetV1950 || false,
      // v11.4.7: Safety guards
      sanityAlerts: (state.sanityAlerts || []).slice(-50),
      tradeDedupLog: state.tradeDedupLog || {},
      // NVR-NL: Persist user directives and config directives
      userDirectives: (state.userDirectives || []).slice(-30),
      configDirectives: (state.configDirectives || []).filter((d: ConfigDirective) => d.active).slice(-30),
    };
    // v20.0: Save trailing stops alongside main state
    saveTrailingStops();
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
// v20.5: BATCHED STATE PERSISTENCE — dirty-flag system to reduce disk I/O
// Instead of writing on every state mutation (~33 call sites), we mark state
// as dirty and flush periodically. Critical saves (post-trade) flush within 5s.
// Non-critical saves (HOLD, status updates) batch into 30s windows.
// Shutdown handlers still save immediately for data safety.
// ============================================================================
// Phase 3c: Dirty-flag state now delegates to src/state/store.ts.
// Local variables kept only for the critical-timer and flush-interval logic.
let lastSaveAt = Date.now();
let criticalSaveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_INTERVAL_MS = 30_000;          // Flush every 30s if dirty
const SAVE_CRITICAL_INTERVAL_MS = 5_000;  // Flush within 5s after trade execution

function markStateDirty(critical?: boolean): void {
  _storeMarkStateDirty(critical);
  if (critical && !criticalSaveTimer) {
    criticalSaveTimer = setTimeout(() => {
      criticalSaveTimer = null;
      flushStateIfDirty('critical-timer');
    }, SAVE_CRITICAL_INTERVAL_MS);
  }
}

function flushStateIfDirty(reason: string = 'periodic'): void {
  if (!_storeIsStateDirty()) return;
  const elapsed = Date.now() - lastSaveAt;
  // For periodic flushes, respect the interval; for explicit calls, always flush
  if (reason === 'periodic' && elapsed < SAVE_INTERVAL_MS) return;
  saveTradeHistory();
  _storeClearDirtyFlag();
  lastSaveAt = Date.now();
  if (criticalSaveTimer) {
    clearTimeout(criticalSaveTimer);
    criticalSaveTimer = null;
  }
  console.log(`[State] Flushed state (reason: ${reason}, dirty for ${elapsed}ms)`);
}

// ============================================================================
// v11.4.22: ON-CHAIN TRADE HISTORY RECOVERY
// Reconstructs trade history from Basescan ERC20 transfer logs.
// This is the source of truth — it survives any state corruption, restart,
// or file loss. Runs on startup to backfill trades missing from persisted state.
// ============================================================================


// ============================================================================
// ON-CHAIN CAPITAL FLOWS — delegated to src/chain/capital-flows.ts
// ============================================================================
const ADDRESS_TO_SYMBOL: Record<string, string> = {};
for (const [symbol, reg] of Object.entries(TOKEN_REGISTRY)) {
  if (reg.address && reg.address !== 'native') {
    ADDRESS_TO_SYMBOL[reg.address.toLowerCase()] = symbol;
  }
}
async function detectOnChainCapitalFlows(walletAddress: string, forceRefresh = false): Promise<OnChainCapitalFlows> {
  return _detectOnChainCapitalFlows(walletAddress, USDC_ADDRESS, forceRefresh);
}
async function fetchBlockscoutTransfers(walletAddress: string): Promise<BasescanTransfer[]> {
  return _fetchBlockscoutTransfers(walletAddress);
}
function pairTransfersIntoTrades(transfers: BasescanTransfer[], walletAddress: string): TradeRecord[] {
  return _pairTransfersIntoTrades(transfers, walletAddress, USDC_ADDRESS, ADDRESS_TO_SYMBOL, TOKEN_REGISTRY);
}
// rebuildCostBasisFromTrades is now imported directly from src/portfolio/ (accesses state via getState())

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
    markStateDirty();
  } else {
    console.log(`  ✅ On-chain history matches state — no new trades to recover`);
  }

  return { recovered: onChainTrades.length, merged: newTrades.length };
}

// ============================================================================
// DIAGNOSTICS — logError, recordTradeFailure, clearTradeFailures, isTokenBlocked
// are now imported directly from src/diagnostics/ (they access state via getState())
// ============================================================================

// ============================================================================
// COST BASIS TRACKING — getOrCreateCostBasis, updateCostBasisAfterSell,
// updateUnrealizedPnL, rebuildCostBasisFromTrades are now imported directly
// from src/portfolio/ (they access state.costBasis via getState()).
// updateCostBasisAfterBuy still needs a thin wrapper to pass lastKnownPrices.
// ============================================================================
function updateCostBasisAfterBuy(symbol: string, amountUSD: number, tokensReceived: number): void {
  _updateCostBasisAfterBuy(symbol, amountUSD, tokensReceived, lastKnownPrices);
}

// ============================================================================
// v9.0: ATR-BASED DYNAMIC STOP LEVELS
// ============================================================================

// computeAtrStopLevels — delegated to src/algorithm/risk.ts
function computeAtrStopLevels(
  symbol: string, sector: string | undefined, atrPercent: number | null,
  currentPrice: number, costBasis: TokenCostBasis,
): { stopPercent: number; trailPercent: number; trailActivated: boolean } | null {
  return _computeAtrStopLevels(symbol, sector, atrPercent, currentPrice, costBasis,
    state.adaptiveThresholds,
    { ATR_STOP_FLOOR_PERCENT, ATR_STOP_CEILING_PERCENT, ATR_TRAIL_ACTIVATION_MULTIPLIER, SECTOR_ATR_MULTIPLIERS });
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
    markStateDirty(true);
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
  // v21.6: Lowered profit-take tiers to free up dry powder faster.
  // Old: 25/50/100/200% — too conservative, bot sat fully deployed for days.
  // New: 10/20/40/80% — takes profits earlier, keeps USDC available for new opportunities.
  const flatTiers = (cfg as any).tiers || [
    { gainPercent: 10,  sellPercent: 15, label: "EARLY_HARVEST" },
    { gainPercent: 20,  sellPercent: 20, label: "MID_HARVEST" },
    { gainPercent: 40,  sellPercent: 25, label: "STRONG_HARVEST" },
    { gainPercent: 80,  sellPercent: 35, label: "MAJOR_HARVEST" },
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
    // v20.4.1: Skip tokens not in active registry
    if (!TOKEN_REGISTRY[b.symbol]) continue;
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
      markStateDirty();
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

    // Time-based rebalancing: 72+ hours held, up at least 8%, no recent harvest
    // v21.6: Lowered from 15% to 8% — 15% meant stale positions never rebalanced
    if (!bestCandidate && gainPercent >= 8 && cb.totalInvestedUSD > 0) {
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
    // v20.4.1: Skip tokens not in active registry — can't execute the sell anyway
    if (!TOKEN_REGISTRY[b.symbol]) continue;
    // v20.4.2: Skip tokens blocked by per-token circuit breaker — swap routes are broken
    if (isTokenBlocked(b.symbol)) continue;
    const cb = state.costBasis[b.symbol];
    if (!cb || cb.averageCostBasis <= 0) continue;

    // v11.4.6: Check stop-loss cooldown — prevent repeated firing on same token
    const lastStopLoss = state.stopLossCooldowns[b.symbol];
    if (lastStopLoss) {
      const hoursSince = (Date.now() - new Date(lastStopLoss).getTime()) / (1000 * 60 * 60);
      if (hoursSince < 24) continue; // Skip — already triggered within 24h
    }

    // v21.2: FORCED_DEPLOY cooldown — if last buy was a forced deployment, don't trigger
    // trailing stop for 2 hours. This prevents the buy-sell-buy-sell death loop where
    // FORCED_DEPLOY buys and the trailing stop immediately sells every 15 minutes.
    const recentBuy = state.tradeHistory.find(t =>
      t.toToken === b.symbol && t.action === 'BUY' && t.success !== false
    );
    if (recentBuy && (recentBuy.reasoning?.includes('FORCED_DEPLOY') || recentBuy.reasoning?.includes('SCOUT'))) {
      const hoursSinceBuy = (Date.now() - new Date(recentBuy.timestamp).getTime()) / (1000 * 60 * 60);
      if (hoursSinceBuy < 2) {
        continue; // Give forced/scout buys 2 hours before trailing stop can fire
      }
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

// DefiLlamaData, DerivativesData — imported from src/algorithm/index.ts

// NewsSentimentData, MacroData, GlobalMarketData, StablecoinSupplyData, MarketData — imported from types/market-data.ts

// ============================================================================
// NVR CENTRAL SIGNAL SERVICE — Phase 1 Interfaces
// ============================================================================

// TradingSignal, SignalPayload — imported from types/market-data.ts

const fetchDefiLlamaData = _fetchDefiLlamaData;

const fetchDerivativesData = _fetchDerivativesData;

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

// computeSmartRetailDivergence — delegated to src/algorithm/market-analysis.ts
function computeSmartRetailDivergence(derivatives: DerivativesData | null): SmartRetailDivergence | null {
  return _computeSmartRetailDivergence(derivatives, SMART_RETAIL_DIVERGENCE_THRESHOLD);
}

// computeFundingMeanReversion — delegated to src/algorithm/market-analysis.ts (mutates fundingRateHistory)
function computeFundingMeanReversion(derivatives: DerivativesData | null): FundingRateMeanReversion | null {
  return _computeFundingMeanReversion(derivatives, fundingRateHistory, FUNDING_RATE_HISTORY_LENGTH, FUNDING_RATE_STD_DEV_THRESHOLD);
}

// computeTVLPriceDivergence — delegated to src/algorithm/market-analysis.ts
function computeTVLPriceDivergence(defi: DefiLlamaData | null, tokens: MarketData["tokens"]): TVLPriceDivergence | null {
  return _computeTVLPriceDivergence(defi, tokens, TVL_PRICE_DIVERGENCE_THRESHOLD);
}

// v12.0: fetchStablecoinSupply() removed — replaced by fetchBaseUSDCSupply() (on-chain totalSupply)

// getAdjustedSectorTargets — delegated to src/algorithm/market-analysis.ts
function getAdjustedSectorTargets(signal: AltseasonSignal): Record<string, number> {
  return _getAdjustedSectorTargets(signal, SECTORS as any, ALTSEASON_SECTOR_BOOST as any, BTC_DOMINANCE_SECTOR_BOOST as any, lastKnownPrices);
}

// Last-known prices cache — prevents $0 portfolio between cycles
let lastKnownPrices: Record<string, { price: number; change24h: number; change7d: number; volume: number; marketCap: number; name: string; sector: string }> = {};

// ============================================================================
// v9.2: MARKET MOMENTUM OVERLAY — Detects strong market moves to deploy USDC
// ============================================================================

// MarketMomentumSignal — imported from src/algorithm/index.ts

// calculateMarketMomentum — delegated to src/algorithm/market-analysis.ts
function calculateMarketMomentum(): MarketMomentumSignal {
  return _calculateMarketMomentum(lastKnownPrices, lastFearGreedValue);
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
      // Sort active symbols first (higher value = earlier in array), then keep first 200
      const sorted = keys.sort((a, b) => (activeSymbols.has(a) ? 1 : 0) - (activeSymbols.has(b) ? 1 : 0));
      const keep = sorted.slice(-200);
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
      // v20.5.1: Use cache up to 6 hours old — stale prices are better than $0 portfolio drops.
      // Fresh on-chain prices will overwrite these on first successful cycle anyway.
      if (age < 6 * 60 * 60 * 1000 && data.prices) {
        lastKnownPrices = data.prices;
        console.log(`♻️ Loaded ${Object.keys(lastKnownPrices).length} cached prices from disk (${(age / 60000).toFixed(0)}m old)`);
      } else {
        // v20.5.1: Still load stale cache as emergency fallback but warn
        if (data.prices && Object.keys(data.prices).length > 0) {
          lastKnownPrices = data.prices;
          console.log(`⚠️ Price cache is old (${(age / 3600000).toFixed(1)}h) — loaded ${Object.keys(lastKnownPrices).length} prices as emergency fallback`);
        } else {
          console.log(`⏭️ No usable price cache — will fetch fresh`);
        }
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
// BreakerState — imported from types/state.ts

// v10.4: Rolling window breaker constants
const BREAKER_ROLLING_WINDOW_SIZE = 8;     // Track last 8 trades
const BREAKER_ROLLING_LOSS_THRESHOLD = 5;  // 5+ losses in 8 trades = trigger breaker

const DEFAULT_BREAKER_STATE: BreakerState = {
  consecutiveLosses: 0,
  lastBreakerTriggered: null,
  lastBreakerReason: null,
  breakerSizeReductionUntil: null,
  dailyBaseline: { date: '', value: 0 },
  dailyBaselineValidated: false,
  weeklyBaseline: { weekStart: '', value: 0 },
  rollingTradeResults: [],
};

let breakerState: BreakerState = { ...DEFAULT_BREAKER_STATE };

/**
 * v10.3: Effective Kelly ceiling — scales up for small portfolios.
 * Under $10K, use 12% ceiling (more capital per trade to overcome minimums and fees).
 * Over $10K, use the standard 8% ceiling.
 */
// ============================================================================
// POSITION SIZING — delegated to src/algorithm/position-sizing.ts (wrappers pass globals)
// ============================================================================
const _kellyConstants = {
  KELLY_FRACTION, KELLY_MIN_TRADES, KELLY_ROLLING_WINDOW,
  KELLY_POSITION_FLOOR_USD, KELLY_POSITION_CEILING_PCT,
  KELLY_SMALL_PORTFOLIO_CEILING_PCT, KELLY_SMALL_PORTFOLIO_THRESHOLD,
};
const _volConstants = {
  VOL_TARGET_DAILY_PCT, VOL_HIGH_THRESHOLD, VOL_HIGH_REDUCTION,
  VOL_LOW_THRESHOLD, VOL_LOW_BOOST,
};

function getEffectiveKellyCeiling(portfolioValue: number): number {
  return _getEffectiveKellyCeiling(portfolioValue, KELLY_SMALL_PORTFOLIO_THRESHOLD, KELLY_SMALL_PORTFOLIO_CEILING_PCT, KELLY_POSITION_CEILING_PCT);
}

function calculateKellyPositionSize(portfolioValue: number) {
  return _calculateKellyPositionSize(portfolioValue, state, _kellyConstants);
}

function calculateVolatilityMultiplier() {
  return _calculateVolatilityMultiplier(state, _volConstants);
}

function calculateInstitutionalPositionSize(portfolioValue: number) {
  // v9.2: Market momentum overlay
  const momentum = calculateMarketMomentum();
  lastMomentumSignal = momentum;

  const base = _calculateInstitutionalPositionSize(
    portfolioValue, state, _kellyConstants, _volConstants,
    momentum, breakerState, cashDeploymentMode, BREAKER_SIZE_REDUCTION,
  );
  // v21.7: Drawdown-aware Kelly — smoothly reduce size as portfolio pulls back from peak.
  // Starts scaling at 5% drawdown, floors at 0.5× by ~17.5% (before circuit breaker halts at 20%).
  const dd = state.trading.peakValue > 0 ? (state.trading.peakValue - portfolioValue) / state.trading.peakValue : 0;
  const ddScaler = dd > 0.05 ? Math.max(0.5, 1 - (dd - 0.05) * 4) : 1;
  return { ...base, sizeUSD: base.sizeUSD * ddScaler, kellyPct: base.kellyPct * ddScaler };
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
    // v21.3: Mark baseline as validated — this function is only called from real cycles
    // with fully-priced balances (not from startup warmup which only prices USDC).
    breakerState.dailyBaselineValidated = true;
  }
  // v21.3: If baseline exists for today but wasn't validated yet, validate it now
  // (happens when baseline was set by startup warmup, then first real cycle runs)
  if (!breakerState.dailyBaselineValidated) {
    breakerState.dailyBaselineValidated = true;
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
    // v20.4.2: Pause expired — clear the rolling window and consecutive losses so the bot can trade again.
    // Without this, the stale 8/8 losses would immediately re-trip the breaker.
    console.log(`  ✅ Breaker pause expired — resetting rolling window (${breakerState.rollingTradeResults.length} entries) and consecutive losses (${breakerState.consecutiveLosses})`);
    breakerState.lastBreakerTriggered = null;
    breakerState.lastBreakerReason = null;
    breakerState.consecutiveLosses = 0;
    breakerState.rollingTradeResults = [];
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
  // v19.6: Telegram alert on circuit breaker
  telegramService.onCircuitBreakerTriggered(reason, state.trading.totalPortfolioValue).catch(() => {});
}

/**
 * Record a trade result for consecutive loss tracking.
 */
function recordTradeResultForBreaker(success: boolean, pnlUSD?: number, tradeDetails?: { token?: string; error?: string; action?: string }) {
  const isWin = success && (pnlUSD === undefined || pnlUSD >= 0);
  if (isWin) {
    breakerState.consecutiveLosses = 0; // Reset on win
  } else {
    breakerState.consecutiveLosses++;
    console.log(`   📉 Consecutive losses: ${breakerState.consecutiveLosses}/${BREAKER_CONSECUTIVE_LOSSES}`);
  }
  // v19.6: Telegram trade failure tracking
  telegramService.onTradeResult(success, tradeDetails).catch(() => {});

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

// ============================================================================
// GAS & LIQUIDITY — delegated to src/gas/gas-liquidity.ts
// lastGasPrice kept in monolith for trade record gas cost estimation
let lastGasPrice: { gweiL1: number; gweiL2: number; ethPriceUSD: number; fetchedAt: number } = {
  gweiL1: 0, gweiL2: 0, ethPriceUSD: 0, fetchedAt: 0,
};
// ============================================================================
async function fetchPoolLiquidity(tokenSymbol: string): Promise<PoolLiquidity | null> {
  return _fetchPoolLiquidity(tokenSymbol, TOKEN_REGISTRY);
}
async function checkLiquidity(tokenSymbol: string, tradeAmountUSD: number) {
  return _checkLiquidity(tokenSymbol, tradeAmountUSD, TOKEN_REGISTRY, {
    minLiquidityUSD: VWS_MIN_LIQUIDITY_USD, preferredLiquidityUSD: VWS_PREFERRED_LIQUIDITY_USD,
    maxPoolPct: VWS_TRADE_AS_POOL_PCT_MAX, warnPoolPct: VWS_TRADE_AS_POOL_PCT_WARN,
    thinPoolReduction: VWS_THIN_POOL_SIZE_REDUCTION,
  });
}
async function fetchGasPrice() {
  const result = await _fetchGasPrice(rpcCall, lastKnownPrices, GAS_PRICE_HIGH_GWEI);
  lastGasPrice = { gweiL1: 0, gweiL2: result.gweiL2, ethPriceUSD: lastKnownPrices['ETH']?.price || lastKnownPrices['WETH']?.price || 2000, fetchedAt: Date.now() };
  return result;
}
async function checkGasCost(tradeAmountUSD: number) {
  return _checkGasCost(tradeAmountUSD, rpcCall, lastKnownPrices, { gasHighGwei: GAS_PRICE_HIGH_GWEI, gasMaxPctOfTrade: GAS_COST_MAX_PCT_OF_TRADE });
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
      isTWAPSlice: true, // v20.0: Prevent duplicate trade history — parent records the aggregate
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
async function getTokenBalance(tokenSymbol: string): Promise<number | null> {
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
    return null; // Return null on error so callers can distinguish "no balance" from "RPC failure"
  }
}

// Cache for macro data (only fetch once per hour since most data is daily/monthly)
// v10.2: Track success separately — retry failures in 5min, cache success for 1hr
const fetchNewsSentiment = _fetchNewsSentiment;

/**
 * Fetch macro economic data from FRED API (Federal Reserve)
 * Free tier: 120 requests/minute, API key required
 * We fetch daily series each cycle but cache for 1 hour since most data updates daily
 */
/**
 * v5.1: Fetch cross-asset correlation data (Gold, Oil, DXY, S&P 500, VIX)
 * Uses free FRED series for daily data — supplements with Binance PAXG for real-time gold proxy
 */
const fetchCrossAssetData = _fetchCrossAssetData;

// ============================================================================
const fetchCMCIntelligence = _fetchCMCIntelligence;

const fetchMacroData = _fetchMacroData;

// determineMarketRegime — delegated to src/algorithm/market-analysis.ts (wrapper passes globals)
function determineMarketRegime(
  _fearGreed: number,
  indicators: Record<string, TechnicalIndicators>,
  derivatives: DerivativesData | null
): MarketRegime {
  return _determineMarketRegime(_fearGreed, indicators, derivatives, lastKnownPrices);
}

// ============================================================================
// REPORTING — delegated to src/reporting/formatting.ts
// ============================================================================
const sf = _sf;
const formatIntelligenceForPrompt = _formatIntelligenceForPrompt;
const formatIndicatorsForPrompt = _formatIndicatorsForPrompt;

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
      const [news, macro, cmcIntel] = await Promise.allSettled([
        cacheManager.getOrFetch(CacheKeys.NEWS_SENTIMENT, CACHE_TTL.NEWS, fetchNewsSentiment),
        cacheManager.getOrFetch(CacheKeys.MACRO_DATA, CACHE_TTL.MACRO, fetchMacroData),
        fetchCMCIntelligence(), // v20.3.1: CMC trending + global metrics
      ]);
      return { fng, defi, deriv, news, macro, cmcIntel };
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
    const { fng: fngResult, defi: defiResult, deriv: derivResult, news: newsResult, macro: macroResult, cmcIntel: cmcIntelResult } = await intelligencePromise;

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
    lastMarketRegime = marketRegime; // v20.3.1: Persist for hourly Telegram report
    console.log(`  🌐 Market Regime: ${marketRegime}`);

    // v12.0: Compute derived signals — on-chain altseason + stablecoin, no CoinGecko
    const smartRetailDivergence = computeSmartRetailDivergence(derivatives);
    const fundingMeanReversion = computeFundingMeanReversion(derivatives);
    const tvlPriceDivergence = computeTVLPriceDivergence(defiLlama, tokens);

    // v12.0: Altseason signal from BTC/ETH ratio (replaces CoinGecko global)
    currentAltseasonSignal = computeLocalAltseasonSignal();

    // v12.0: Build globalMarket with available on-chain data
    // v20.3.1: Enrich globalMarket with CMC intelligence if available
    const cmcData = cmcIntelResult?.status === 'fulfilled' ? cmcIntelResult.value : null;
    const globalMarket: GlobalMarketData | null = {
      btcDominance: cmcData?.globalMetrics?.btcDominance || 0,
      ethDominance: 0,
      totalMarketCap: cmcData?.globalMetrics?.totalMarketCap || 0,
      totalVolume24h: cmcData?.globalMetrics?.totalVolume24h || 0,
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

// TechnicalIndicators — imported from src/algorithm/index.ts

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

// ============================================================================
// TECHNICAL INDICATORS — delegated to src/algorithm/indicators.ts
// ============================================================================
const calculateRSI = _calculateRSI;
const calculateEMA = _calculateEMA;
const calculateMACD = _calculateMACD;
const calculateBollingerBands = _calculateBollingerBands;
const calculateSMA = _calculateSMA;
const calculateATR = _calculateATR;
const calculateADX = _calculateADX;
const determineTrend = _determineTrend;

// calculateConfluence — delegated to src/algorithm/confluence.ts (wrapper passes globals)
function calculateConfluence(
  rsi: number | null,
  macd: TechnicalIndicators["macd"],
  bb: TechnicalIndicators["bollingerBands"],
  trend: TechnicalIndicators["trendDirection"],
  priceChange24h: number,
  priceChange7d: number,
  adx: TechnicalIndicators["adx14"] = null,
  atr: { atr: number; atrPercent: number } | null = null,
  twapDivergence: TechnicalIndicators["twapDivergence"] = null,
  orderFlow: TechnicalIndicators["orderFlow"] = null,
  tickDepth: TechnicalIndicators["tickDepth"] = null
): { score: number; signal: TechnicalIndicators["overallSignal"] } {
  return _calculateConfluence(
    rsi, macd, bb, trend, priceChange24h, priceChange7d, adx, atr,
    twapDivergence, orderFlow, tickDepth,
    {
      adaptiveThresholds: state.adaptiveThresholds,
      btcChange24h: lastMomentumSignal?.btcChange24h ?? 0,
      ethChange24h: lastMomentumSignal?.ethChange24h ?? 0,
    },
    TWAP_DIVERGENCE_THRESHOLD_PCT,
    TWAP_MILD_THRESHOLD_PCT,
  );
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
// ============================================================================
// DIRECT ON-CHAIN BALANCE READING (same as v3.1.1)
// ============================================================================

// RPC + balance functions — delegated to src/execution/rpc.ts
const getCurrentRpc = _getCurrentRpc;
const rotateRpc = _rotateRpc;
const rpcCall = _rpcCall;
const getETHBalance = _getETHBalance;
const getERC20Balance = _getERC20Balance;

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
      network: activeChain.cdpNetwork,
      fromToken: TOKEN_REGISTRY.USDC.address as `0x${string}`, // USDC
      toToken: "0x4200000000000000000000000000000000000006" as `0x${string}`,   // WETH on Base
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

// v19.3.3: One-time rescue — transfer ETH from nvr-trading (0xf129) to henry-trading-bot (0xB7c51b)
let gasRescueAttempted = false;
async function rescueGasFromNvrTrading(): Promise<void> {
  if (gasRescueAttempted) return;
  gasRescueAttempted = true;
  try {
    const mainAccount = await cdpClient.evm.getOrCreateAccount({ name: CDP_ACCOUNT_NAME });
    const mainETH = await getETHBalance(mainAccount.address);

    if (mainETH >= 0.001) {
      console.log(`  [GAS RESCUE] Main wallet has ${mainETH.toFixed(6)} ETH — no rescue needed`);
      return;
    }

    // Check if nvr-trading account has ETH we can rescue
    const nvrAccount = await cdpClient.evm.getOrCreateAccount({ name: "nvr-trading" });
    const nvrETH = await getETHBalance(nvrAccount.address);

    if (nvrETH < 0.001) {
      console.log(`  [GAS RESCUE] nvr-trading (${nvrAccount.address}) has ${nvrETH.toFixed(6)} ETH — nothing to rescue`);
      return;
    }

    // Transfer 90% of nvr-trading ETH to main account (keep some for the tx fee)
    const transferAmount = Math.floor((nvrETH * 0.9) * 1e18);
    console.log(`\n  🚨 [GAS RESCUE] Transferring ${(transferAmount/1e18).toFixed(6)} ETH from nvr-trading → ${mainAccount.address}`);

    const tx = await nvrAccount.sendTransaction({
      network: activeChain.cdpNetwork,
      transaction: {
        to: mainAccount.address as `0x${string}`,
        value: BigInt(transferAmount),
      },
    });

    console.log(`  ✅ [GAS RESCUE] ETH transferred! TX: ${(tx as any).transactionHash || 'sent'}`);
    const newBalance = await getETHBalance(mainAccount.address);
    console.log(`  ✅ [GAS RESCUE] Main wallet ETH: ${newBalance.toFixed(6)}`);
  } catch (err: any) {
    console.warn(`  ⚠️ [GAS RESCUE] Failed: ${err?.message?.substring(0, 200) || 'Unknown'}`);
  }
}

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
      network: activeChain.cdpNetwork,
      fromToken: TOKEN_REGISTRY.USDC.address as `0x${string}`,
      toToken: "0x4200000000000000000000000000000000000006" as `0x${string}`, // WETH on Base
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
      (sectorInfo.tokens as readonly string[]).includes(b.symbol) && b.usdValue > 0
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

// TradeDecision — imported from types/market-data.ts

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
  cashDeployment?: CashDeploymentResult,
  heavyCycleReason?: string,
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
    const deployPerTrade = cashDeployment.deployBudget / (cashDeployment.maxEntries || CASH_DEPLOYMENT_MAX_ENTRIES);
    maxBuyAmount = Math.min(Math.max(maxBuyAmount, deployPerTrade), availableUSDC);
  }
  console.log(`   🎰 Position Sizer: Kelly=$${instSize.sizeUSD.toFixed(2)} (${instSize.kellyPct.toFixed(1)}% of portfolio) | Vol×${instSize.volMultiplier.toFixed(2)} (realized ${instSize.realizedVol.toFixed(1)}%) | WR=${(instSize.winRate * 100).toFixed(0)}%${instSize.breakerReduction ? ' | ⚠️ BREAKER 30% CUT' : ''}${cashDeployment?.active ? ' | 💵 DEPLOY MODE' : ''}`);
  const maxSellAmount = totalTokenValue * (CONFIG.trading.maxSellPercent / 100);
  // v6.2: Curated top opportunities from discovery engine (max 5, runner-aware)
  const topOpportunities = tokenDiscoveryEngine?.getTopOpportunities(5) || [];
  const discoveredSymbols = topOpportunities.map(t => t.symbol);
  const allTradeableTokens = [...CONFIG.activeTokens, ...discoveredSymbols.filter(s => !CONFIG.activeTokens.includes(s))];
  const tradeableTokens = allTradeableTokens.join(", ");

  // v6.2: Focused discovery intel — only top 5 curated opportunities, runners flagged
  const discoveryIntel = topOpportunities.length > 0
    ? `\n═══ EMERGING OPPORTUNITIES (Top ${topOpportunities.length} from Discovery Scanner) ═══\n${topOpportunities.map(t =>
        `${t.isRunner ? '🚀 RUNNER: ' : ''}${t.symbol} ($${t.priceUSD.toFixed(4)}) | Vol24h: $${(t.volume24hUSD / 1000).toFixed(0)}K | Liq: $${(t.liquidityUSD / 1000).toFixed(0)}K | ${t.priceChange24h > 0 ? '+' : ''}${t.priceChange24h.toFixed(1)}% | Score: ${t.compositeScore}/100 | Sector: ${t.sector} | Risk: ${t.riskLevel}`
      ).join("\n")}\nThese are curated from ${tokenDiscoveryEngine?.getTradableTokens().length || 0} scanned tokens. Size discovered tokens at 50-75% of normal. Runners (🚀) show exceptional momentum — evaluate carefully.\n`
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

  // v20.6: Build dynamic data sections (always included regardless of prompt tier)
  const dynamicData = `
═══ PORTFOLIO ═══
- USDC Available: $${availableUSDC.toFixed(2)}${cashDeployment?.active ? ` ⚠️ CASH OVERWEIGHT (${cashDeployment.cashPercent.toFixed(1)}% of portfolio)` : ''}
- Token Holdings: $${totalTokenValue.toFixed(2)}
- Total: $${totalPortfolioValue.toFixed(2)}
- Today's P&L: ${breakerState.dailyBaseline.value > 0 ? `${((totalPortfolioValue - breakerState.dailyBaseline.value) / breakerState.dailyBaseline.value * 100).toFixed(2)}% ($${(totalPortfolioValue - breakerState.dailyBaseline.value).toFixed(2)})` : 'Calculating...'}
- Peak: $${state.trading.peakValue.toFixed(2)} | Drawdown: ${state.trading.peakValue > 0 ? ((state.trading.peakValue - totalPortfolioValue) / state.trading.peakValue * 100).toFixed(1) : "0.0"}%
- Today's Realized P&L (from sells): $${todayRealizedPnL.toFixed(2)} (${todaySells.length} sells) | Next payout: ${hoursUntilPayout}h${cashDeployment?.active ? `
- DEPLOYMENT MODE: Excess cash $${cashDeployment.excessCash.toFixed(2)} | Budget this cycle: $${cashDeployment.deployBudget.toFixed(2)} | Confluence discount: -${cashDeployment.confluenceDiscount}pts` : ''}

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
- Available tokens: ${tradeableTokens}`;

  // v20.6: Dynamic addenda only included on heavy (full strategy) cycles
  const dynamicStrategyAddenda = `${cashDeployment?.active ? `
═══ CASH STATUS ═══
Portfolio is ${cashDeployment.cashPercent.toFixed(0)}% USDC ($${availableUSDC.toFixed(0)} available). Deploy budget: $${cashDeployment.deployBudget.toFixed(0)}.
High cash is NOT a problem — it means you have ammunition for the next wave.
ONLY deploy if you see real momentum and conviction. Do NOT buy just to reduce cash.
If the market is dead, HOLD is the best trade. Protect capital for when opportunity arrives.
` : ''}${payoutUrgency ? `
⚠️ PAYOUT URGENCY: <4h to settlement — sell a portion of winners NOW to lock in realized profit. Today's realized: $${todayRealizedPnL.toFixed(2)} from ${todaySells.length} sells. Next payout in ${hoursUntilPayout}h.
` : ''}`;

  // v21.1: Model routing — Sonnet for all cycles in difficult markets.
  // Haiku is only used for routine cycles when the market is calm (F&G > 25, trending up).
  // In fear/ranging/volatile conditions, every decision matters — use full intelligence.
  const reasonLower = (heavyCycleReason || '').toLowerCase();
  const currentFG = lastFearGreedValue ?? 50;
  const currentRegime = state.trading.marketRegime || 'UNKNOWN';
  const isDifficultMarket = currentFG < 25 || currentRegime === 'RANGING' || currentRegime === 'VOLATILE' || currentRegime === 'TRENDING_DOWN';
  const needsSonnet = !heavyCycleReason  // No reason = unknown, play safe with Sonnet
    || SONNET_REQUIRED_REASONS.some(r => reasonLower.includes(r.toLowerCase()))
    || (cashDeployment?.active)  // Cash deployment mode needs full intelligence
    || isDifficultMarket;  // v21.1: Difficult markets get Sonnet ALWAYS — no intern during a crisis
  const selectedModel = needsSonnet ? AI_MODEL_HEAVY : AI_MODEL_ROUTINE;
  const modelLabel = needsSonnet ? 'Sonnet (heavy)' : 'Haiku (routine)';

  // v20.6: Compressed prompt system — CORE (always) + STRATEGY (heavy cycles only) + dynamic data (always)
  const isFullPrompt = needsSonnet;
  const promptForAI = isFullPrompt
    ? SYSTEM_PROMPT_CORE + '\n\n' + dynamicData + '\n\n' + SYSTEM_PROMPT_STRATEGY + '\n' + dynamicStrategyAddenda + formatSelfImprovementPrompt() + formatUserDirectivesPrompt()
    : SYSTEM_PROMPT_CORE + '\n\n' + dynamicData + formatSelfImprovementPrompt() + formatUserDirectivesPrompt();

  const promptTokens = estimateTokens(promptForAI);
  console.log(`  [AI] Using ${modelLabel} for cycle | Reason: ${heavyCycleReason || 'unknown'}`);
  console.log(`  [Prompt] ${isFullPrompt ? 'Full' : 'Compact'} prompt: ~${promptTokens} tokens`);

  // Retry up to 3 times with exponential backoff for rate limits
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // v21.2: Model routing — Gemma for routine, Claude for difficult markets
      const { response: modelResponse, telemetry: modelTelemetry } = await callModelWithShadow(
        {
          messages: [{ role: 'user', content: promptForAI }],
          maxTokens: needsSonnet ? 2000 : 500,
          jsonMode: true,
          timeoutMs: 90_000,
        },
        { needsSonnet, portfolioValue: totalPortfolioValue },
        anthropic,
        gemmaMode,
      );
      logModelTelemetry(modelTelemetry);

      {
        let text = modelResponse.text.trim();
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

        // v6.2: Include curated discovered tokens in validation (top 5 only, not full discovery pool)
        const validTokens = ["USDC", "NONE", ...CONFIG.activeTokens, ...discoveredSymbols];
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

// getTokenAddress, getTokenDecimals — delegated to src/execution/helpers.ts
const getTokenAddress = _getTokenAddress;
const getTokenDecimals = _getTokenDecimals;

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
      if (actualBalance !== null && actualBalance > 0) {
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

    // PAPER VALIDATE GATE — shadow-simulate trade for audit trail before live execution
    if (PAPER_VALIDATE_FIRST && !PAPER_TRADE_MODE) {
      try {
        let shadowPortfolio = getPaperPortfolio(PAPER_GATE_PORTFOLIO_ID);
        if (!shadowPortfolio) {
          shadowPortfolio = createPaperPortfolio(PAPER_GATE_PORTFOLIO_ID, 'paper-gate', state.trading.totalPortfolioValue || 1000);
        }
        const tradeTokenSymbol = decision.action === 'BUY' ? decision.toToken : decision.fromToken;
        const tokenPrice = marketData.tokens.find(t => t.symbol === tradeTokenSymbol)?.price || 0;
        const paperLog = {
          timestamp: new Date().toISOString(),
          action: decision.action,
          token: tradeTokenSymbol,
          amountUSD: decision.amountUSD,
          price: tokenPrice,
          reasoning: decision.reasoning?.slice(0, 120) || '',
          portfolioValue: state.trading.totalPortfolioValue,
        };
        console.log(`  📝 PAPER GATE: shadow-logged ${decision.action} $${decision.amountUSD.toFixed(2)} ${tradeTokenSymbol} @ $${tokenPrice.toFixed(4)} — proceeding to live execution`);
        // Persist to state for audit trail
        if (!(state as any).paperGateLog) (state as any).paperGateLog = [];
        (state as any).paperGateLog.push(paperLog);
        // Keep last 500 entries
        if ((state as any).paperGateLog.length > 500) {
          (state as any).paperGateLog = (state as any).paperGateLog.slice(-500);
        }
        markStateDirty(true);
      } catch (e: any) {
        console.warn(`  ⚠️ PAPER GATE: Simulation failed (${e.message}) — proceeding with live trade`);
      }
    }

    // PAPER TRADE MODE — block all live execution, only simulate
    if (PAPER_TRADE_MODE) {
      console.log(`  📄 PAPER TRADE MODE: Simulated ${decision.action} $${decision.amountUSD.toFixed(2)} ${decision.action === 'BUY' ? decision.toToken : decision.fromToken} — NO live execution`);
      return { success: true, txHash: `paper-${Date.now()}` };
    }

    // v8.1: TWAP routing for large orders
    if (decision.amountUSD >= TWAP_THRESHOLD_USD) {
      console.log(`  ⏱️ Order $${decision.amountUSD.toFixed(2)} ≥ $${TWAP_THRESHOLD_USD} → routing through TWAP engine`);
      const twapResult = await executeTWAP(decision, marketData, executeSingleSwap);
      // v20.0: Record a single aggregate trade entry for the entire TWAP order
      if (twapResult.slicesExecuted > 0) {
        const aggregateAmountUSD = decision.amountUSD * (twapResult.slicesExecuted / twapResult.slicesTotal);
        const twapPortfolioValue = state.trading.totalPortfolioValue;
        state.tradeHistory.push({
          cycle: 0,
          timestamp: new Date().toISOString(),
          action: decision.action,
          fromToken: decision.fromToken,
          toToken: decision.toToken,
          amountUSD: aggregateAmountUSD,
          tokenAmount: twapResult.totalTokensReceived,
          txHash: twapResult.txHash || '',
          success: twapResult.success,
          portfolioValueBefore: twapPortfolioValue,
          portfolioValueAfter: twapPortfolioValue,
          reasoning: `${decision.reasoning} [TWAP: ${twapResult.slicesExecuted}/${twapResult.slicesTotal} slices]`,
          sector: decision.sector,
          marketConditions: {
            fearGreed: marketData.fearGreed.value,
            ethPrice: marketData.tokens.find(t => t.symbol === "ETH")?.price || 0,
            btcPrice: marketData.tokens.find(t => t.symbol === "cbBTC")?.price || 0,
          },
          signalContext: {
            marketRegime: marketData.marketRegime,
            confluenceScore: 0,
            rsi: null,
            macdSignal: null,
            btcFundingRate: marketData.derivatives?.btcFundingRate || null,
            ethFundingRate: marketData.derivatives?.ethFundingRate || null,
            baseTVLChange24h: marketData.defiLlama?.baseTVLChange24h || null,
            baseDEXVolume24h: marketData.defiLlama?.baseDEXVolume24h || null,
            triggeredBy: decision.isExploration ? "EXPLORATION" : decision.isForced ? "FORCED_DEPLOY" : "AI",
            isExploration: decision.isExploration || false,
            isForced: decision.isForced || false,
          },
        });
        if (state.tradeHistory.length > 5000) state.tradeHistory = state.tradeHistory.slice(-5000);
        markStateDirty(true);
      }
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

// v21.3: DEX router addresses from chain config
const UNISWAP_V3_SWAP_ROUTER = (activeChain.dexRouters.uniswapV3?.router ?? '') as Address;
const AERODROME_SLIPSTREAM_ROUTER = (activeChain.dexRouters.aerodromeSlipstream?.router ?? '') as Address;
const AERODROME_TICK_SPACINGS = [200, 100, 50, 2000, 1]; // Common Slipstream tick spacings, ordered by liquidity likelihood

// v20.0: Cache MAX_UINT256 approvals — once approved, no need to check on-chain again
// Key: "tokenAddress:spenderAddress". Cleared on startup since it's an in-memory cache.
const approvalCache = new Set<string>();
// Note: approvals persist on-chain, so cache only saves RPC reads — no correctness risk on restart.
const DEX_USDC = activeChain.usdc.address as Address;
const DEX_WETH = activeChain.weth.address as Address;

// Calldata builders + selectors — delegated to src/execution/calldata.ts

const buildAerodromeExactInputSingleCalldata = _buildAerodromeExactInputSingleCalldata;
const buildExactInputSingleCalldata = _buildExactInputSingleCalldata;
const buildExactInputMultihopCalldata = _buildExactInputMultihopCalldata;
const encodeV3Path = _encodeV3Path;

/**
 * Execute a direct DEX swap via Uniswap V3 SwapRouter on Base.
 * Used as fallback for tokens CDP SDK cannot route (MORPHO, cbLTC, PENDLE).
 * Sends the transaction through CDP's account.sendTransaction() — same as approvals/Aave.
 */
async function executeDirectDexSwap(
  decision: TradeDecision,
  marketData: MarketData,
): Promise<{ success: boolean; txHash?: string; error?: string; actualTokens?: number }> {
  const dedupTier = decision.reasoning?.match(/^([A-Z_]+):/)?.[1] || 'AI';
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
        if (actualBal !== null && actualBal > 0) {
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
        if (onChainBal !== null && onChainBal > 0) {
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
    // v20.0: Check in-memory cache first to skip redundant on-chain allowance reads
    const approvalKey = `${tokenIn}:${UNISWAP_V3_SWAP_ROUTER}`.toLowerCase();
    if (approvalCache.has(approvalKey)) {
      console.log(`     ✅ SwapRouter approved (cached) for ${isSell ? decision.fromToken : 'USDC'}`);
    } else {
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
          network: activeChain.cdpNetwork,
          transaction: {
            to: tokenIn,
            data: approveData as `0x${string}`,
            value: BigInt(0),
          },
        });
        console.log(`     ✅ SwapRouter approved: ${approveTx.transactionHash}`);
        approvalCache.add(approvalKey);
        console.log(`     ⏳ Waiting 8s for approval to propagate...`);
        await new Promise(resolve => setTimeout(resolve, 8000));
      } else {
        console.log(`     ✅ SwapRouter already approved for ${isSell ? decision.fromToken : 'USDC'}`);
        approvalCache.add(approvalKey); // Cache the on-chain confirmation
      }
    }

    // Step 2: Snapshot token balance BEFORE swap
    const balanceToken = isSell ? decision.fromToken : decision.toToken;
    let preSwapBalance = 0;
    try {
      preSwapBalance = await getTokenBalance(balanceToken) ?? 0;
    } catch { /* non-critical */ }

    // Step 3: Calculate minimum output with slippage protection
    // v20.0: MEV-aware adaptive slippage based on trade size and market conditions
    // v20.1: Wire actual pool liquidity from poolRegistry instead of hardcoded 0
    const volatilityLevel = marketData.marketRegime === 'VOLATILE' ? 'HIGH' : (marketData.marketRegime === 'TRENDING_UP' || marketData.marketRegime === 'TRENDING_DOWN') ? 'NORMAL' : 'NORMAL';
    const poolEntry = poolRegistry[tokenSymbol];
    const slippageBps = calculateAdaptiveSlippage({
      tradeAmountUSD: decision.amountUSD,
      poolLiquidityUSD: poolEntry?.liquidityUSD || 0,
      volatilityLevel: volatilityLevel as 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME',
    });
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
    const mevProtected = needsMevProtection(decision.amountUSD);
    console.log(`     🛡️ Slippage: ${slippageBps / 100}% | Min output: ${formatUnits(amountOutMin, outDecimals)} | MEV: ${mevProtected ? 'Flashbots RPC active' : 'standard (small trade)'}`);

    // Step 4: Try swap routes — first aggregator, then direct, then multi-hop via WETH
    let txHash = '';
    let swapSuccess = false;

    // v20.0: Try DEX aggregator first for better pricing (0x / 1inch)
    if (shouldUseAggregator(decision.amountUSD)) {
      try {
        console.log(`     🔀 Trying DEX aggregator for better execution...`);
        const aggQuote = await getBestAggregatorQuote(
          tokenIn, tokenOut, fromAmount.toString(), slippageBps, walletAddress
        );
        if (aggQuote?.to && aggQuote?.data) {
          // Check if we need to approve the aggregator's allowance target
          // v20.0: Cache-aware approval for aggregator targets
          if (aggQuote.allowanceTarget && aggQuote.allowanceTarget !== UNISWAP_V3_SWAP_ROUTER) {
            const aggApprovalKey = `${tokenIn}:${aggQuote.allowanceTarget}`.toLowerCase();
            if (!approvalCache.has(aggApprovalKey)) {
              const allowanceData = "0xdd62ed3e" +
                walletAddress.slice(2).padStart(64, "0") +
                aggQuote.allowanceTarget.slice(2).padStart(64, "0");
              const currentAllowance = await rpcCall("eth_call", [{ to: tokenIn, data: allowanceData }, "latest"]);
              if (currentAllowance === "0x" || BigInt(currentAllowance) < fromAmount) {
                console.log(`     🔓 Approving aggregator allowance target...`);
                const APPROVE_SELECTOR = "0x095ea7b3";
                const MAX_UINT256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
                const approveData = APPROVE_SELECTOR + aggQuote.allowanceTarget.slice(2).padStart(64, "0") + MAX_UINT256.slice(2);
                await account.sendTransaction({
                  network: activeChain.cdpNetwork,
                  transaction: { to: tokenIn, data: approveData as `0x${string}`, value: BigInt(0) },
                });
                await new Promise(resolve => setTimeout(resolve, 5000));
              }
              approvalCache.add(aggApprovalKey);
            }
          }

          const result = await account.sendTransaction({
            network: activeChain.cdpNetwork,
            transaction: {
              to: aggQuote.to as `0x${string}`,
              data: aggQuote.data as `0x${string}`,
              value: BigInt(aggQuote.value || '0'),
            },
          });
          txHash = result.transactionHash;
          swapSuccess = true;
          console.log(`     ✅ Aggregator swap succeeded (${aggQuote.aggregator}) | Sources: ${aggQuote.sources.join(', ') || 'optimized'}`);
        }
      } catch (e: any) {
        console.log(`     ⚠️ Aggregator swap failed: ${e.message?.substring(0, 100)} — falling back to direct Uniswap`);
      }
    }

    // v20.4.2: Try Aerodrome Slipstream if the token's pool is on Aerodrome
    const aeroPool = poolRegistry[tokenSymbol];
    if (!swapSuccess && AERODROME_SLIPSTREAM_ROUTER && aeroPool && (aeroPool.poolType === 'aerodromeV3' || aeroPool.poolType === 'aerodrome')) {
      const tickSpacings = aeroPool.tickSpacing ? [aeroPool.tickSpacing, ...AERODROME_TICK_SPACINGS.filter(t => t !== aeroPool.tickSpacing)] : AERODROME_TICK_SPACINGS;

      // Ensure approval for Aerodrome router (same pattern as Uniswap V3 approval above)
      const aeroApprovalKey = `${tokenIn}:${AERODROME_SLIPSTREAM_ROUTER}`;
      if (!approvalCache.has(aeroApprovalKey) && tokenIn !== DEX_WETH) {
        const APPROVE_SEL = "0x095ea7b3";
        const MAX_U256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
        const allowData = "0xdd62ed3e" + walletAddress.slice(2).padStart(64, "0") + AERODROME_SLIPSTREAM_ROUTER.slice(2).padStart(64, "0");
        const curAllowance = await rpcCall("eth_call", [{ to: tokenIn, data: allowData }, "latest"]);
        if (curAllowance === "0x" || curAllowance === "0x0000000000000000000000000000000000000000000000000000000000000000" || BigInt(curAllowance) < fromAmount) {
          console.log(`     🔑 Approving ${tokenSymbol} for Aerodrome Slipstream router...`);
          const appData = APPROVE_SEL + AERODROME_SLIPSTREAM_ROUTER.slice(2).padStart(64, "0") + MAX_U256.slice(2);
          await account.sendTransaction({ network: activeChain.cdpNetwork, transaction: { to: tokenIn, data: appData as `0x${string}`, value: BigInt(0) } });
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        approvalCache.add(aeroApprovalKey);
      }

      for (const tickSpacing of tickSpacings) {
        if (swapSuccess) break;
        try {
          console.log(`     🔵 Trying Aerodrome Slipstream (tickSpacing: ${tickSpacing})...`);
          const calldata = buildAerodromeExactInputSingleCalldata(
            tokenIn, tokenOut, tickSpacing, walletAddress, fromAmount, amountOutMin
          );

          const result = await account.sendTransaction({
            network: activeChain.cdpNetwork,
            transaction: {
              to: AERODROME_SLIPSTREAM_ROUTER,
              data: calldata,
              value: BigInt(0),
            },
          });
          txHash = result.transactionHash;
          swapSuccess = true;
          console.log(`     ✅ Aerodrome Slipstream swap succeeded (tickSpacing: ${tickSpacing})`);
        } catch (e: any) {
          const msg = e?.message || '';
          console.log(`     ⚠️ Aerodrome Slipstream failed (tickSpacing: ${tickSpacing}): ${msg.substring(0, 100)}`);
        }
      }
    }

    const FEE_TIERS = [3000, 10000, 500]; // 0.3%, 1%, 0.05%

    // Try direct single-hop first (tokenIn -> tokenOut) with each fee tier
    for (const fee of FEE_TIERS) {
      if (swapSuccess) break;
      try {
        console.log(`     🔄 Trying direct swap (fee: ${fee / 10000}%)...`);
        const calldata = buildExactInputSingleCalldata(
          tokenIn, tokenOut, fee, walletAddress, fromAmount, amountOutMin
        );

        const result = await account.sendTransaction({
          network: activeChain.cdpNetwork,
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
              network: activeChain.cdpNetwork,
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
        postSwapBalance = await getTokenBalance(balanceToken) ?? 0;
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
      // v20.8.1: Add cooldown to prevent re-buying recently stopped-out tokens
      state.stopLossCooldowns[decision.fromToken] = new Date().toISOString();
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
    // v20.0: Skip trade history for TWAP slices — parent records the aggregate
    if (!decision.isTWAPSlice) {
      state.tradeHistory.push(record);
      if (state.tradeHistory.length > 5000) state.tradeHistory = state.tradeHistory.slice(-5000);
      markStateDirty(true);
    }
    recordExecuted(decision.action === 'BUY' ? (decision.toToken || '') : (decision.fromToken || ''), decision.action, dedupTier, decision.amountUSD);

    // v21.3: Reset trade drought tracker on successful trade
    lastSuccessfulTradeAt = Date.now();
    tradeDroughtAlerted = false;

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
        if (onChainBalance !== null && onChainBalance > 0) {
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
        network: activeChain.cdpNetwork,
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
      preSwapBalance = await getTokenBalance(balanceToken) ?? 0;
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
          network: activeChain.cdpNetwork,
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
        } else if (swapMsg.includes("Invalid request") || swapMsg.includes("payment method") || swapMsg.includes("not supported") || swapMsg.includes("invalid") || swapMsg.includes("Insufficient balance")) {
          // v14.3: CDP SDK can't route this token — fall back to direct DEX swap
          // v21.7: "Insufficient balance" added — CDP SDK returns this when it can't route a
          // SELL even though on-chain balance is sufficient (verified via getTokenBalance cap).
          // Fall back to Aerodrome DEX which can route these sells directly.
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
        postSwapBalance = await getTokenBalance(balanceToken) ?? 0;
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
    // v20.0: Skip trade history for TWAP slices — parent records the aggregate
    if (!decision.isTWAPSlice) {
      state.tradeHistory.push(record);
      // v10.2: Cap trade history to prevent unbounded memory growth
      if (state.tradeHistory.length > 5000) state.tradeHistory = state.tradeHistory.slice(-5000);
      markStateDirty(true);
    }

    // v21.3: Reset trade drought tracker on successful trade
    lastSuccessfulTradeAt = Date.now();
    tradeDroughtAlerted = false;

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
    // v20.0: Skip trade history for TWAP slices — parent records the aggregate
    if (!decision.isTWAPSlice) {
      state.tradeHistory.push(record);
      if (state.tradeHistory.length > 5000) state.tradeHistory = state.tradeHistory.slice(-5000);
      // v11.4.20: Don't increment totalTrades for failed trades — was inflating the counter
      // totalTrades should only count successful executions (line 6967)
      markStateDirty(true);
    }

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
    markStateDirty();
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
    markStateDirty();
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
    markStateDirty();
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

  markStateDirty(true);

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
    network: activeChain.cdpNetwork,
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
  let marketData: MarketData | null = null;

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
    marketData = await getMarketData();

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

      // Adapt thresholds based on review findings — pass current regime for walk-forward validation
      adaptThresholds(review, marketData.marketRegime);
      console.log(`   Thresholds adapted (${state.adaptiveThresholds.adaptationCount} total adaptations)`);

      // Persist everything
      markStateDirty();
      console.log(`   Review #${state.performanceReviews.length} stored | Next review after ${state.lastReviewTradeIndex + 10} trades or 24h`);
    }

    // === PHASE 3: ANALYZE STRATEGY PATTERNS ===
    // v10.2: Rebuild every 50 heavy cycles (not just cycle 1) so patterns reflect recent trading
    if (state.tradeHistory.length > 0 && (state.totalCycles <= 1 || state.totalCycles % 50 === 0)) {
      console.log(`\n🧬 SELF-IMPROVEMENT: Building strategy pattern memory from ${state.tradeHistory.length} trades...`);
      analyzeStrategyPatterns();
      const validPatterns = Object.values(state.strategyPatterns).filter(p => !p.patternId.startsWith("UNKNOWN"));
      console.log(`   Identified ${Object.keys(state.strategyPatterns).length} patterns (${validPatterns.length} with signal data)`);
      markStateDirty();
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
            // v20.5.1: Final fallback — use previous cycle's price from state.trading.balances
            // Prevents phantom portfolio drops when both live feed AND price cache miss
            const prevBalance = state.trading.balances?.find(b => b.symbol === balance.symbol);
            if (prevBalance && prevBalance.price && prevBalance.price > 0) {
              balance.usdValue = balance.balance * prevBalance.price;
              balance.price = prevBalance.price;
              console.log(`   📎 Using previous cycle price for ${balance.symbol}: $${prevBalance.price.toFixed(4)} (all feeds unavailable)`);
            } else {
              console.warn(`   ⚠️ No price data for ${balance.symbol} — no cache or previous cycle data, showing $0`);
            }
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

    // v20.6: Phantom SPIKE detection — mirror of phantom drop guard.
    // If portfolio jumps >10% in a single cycle without any trades, it's almost certainly
    // a bad DEX pool read or a token going from $0 → inflated value (e.g. low-liquidity meme coins).
    // Protect peak and baseline from false inflation that would corrupt drawdown/P&L calculations.
    const spikePercent = prevValue > 0 ? ((newPortfolioValue - prevValue) / prevValue) * 100 : 0;
    const isPhantomSpike = spikePercent > 10 && prevValue > 100;
    if (isPhantomSpike) {
      const suspectTokens = balances
        .filter(b => b.symbol !== 'USDC' && b.usdValue > 0)
        .filter(b => {
          const prevBal = state.trading.balances?.find(pb => pb.symbol === b.symbol);
          if (!prevBal || !prevBal.usdValue) return b.usdValue > 50; // new token appearing with value
          return prevBal.usdValue > 0 && ((b.usdValue - prevBal.usdValue) / prevBal.usdValue) > 0.5; // >50% jump
        })
        .map(b => {
          const prevBal = state.trading.balances?.find(pb => pb.symbol === b.symbol);
          const prevUSD = prevBal?.usdValue || 0;
          return `${b.symbol} $${prevUSD.toFixed(2)}→$${b.usdValue.toFixed(2)}`;
        });
      console.warn(`\n🛡️ PHANTOM SPIKE DETECTED: Portfolio $${prevValue.toFixed(2)} → $${newPortfolioValue.toFixed(2)} (+${spikePercent.toFixed(1)}% in one cycle)`);
      console.warn(`   Suspect tokens: ${suspectTokens.join(', ') || 'none identified'}`);
      console.warn(`   Portfolio value updated to actual — peak/baseline protected from false inflation.`);
    }

    const isPhantomMove = isPhantomDrop || isPhantomSpike;

    // v12.2: Always update to actual value so dashboard matches sum of balances
    state.trading.totalPortfolioValue = newPortfolioValue;

    // v20.0: Update drawdown tracking for daily/weekly halt controls
    updateDrawdownTracking(newPortfolioValue);

    // v19.6 + v20.6: Telegram balance drop tracking (fire-and-forget)
    // Skip update during phantom moves — prevents false drop alerts AND prevents
    // inflating Telegram's lastKnownBalance baseline during phantom spikes
    if (!isPhantomMove) {
      telegramService.onBalanceUpdate(newPortfolioValue).catch(() => {});
    }

    // v19.5.0: ON-CHAIN DEPOSIT DETECTION — replaces flaky portfolio-jump heuristic.
    // The blockchain is the source of truth. We query Blockscout for real USDC transfers
    // and identify deposits vs swaps. Runs on a 10-minute cache to avoid API spam.
    const currentUSDCBalance = balances.find(b => b.symbol === 'USDC')?.usdValue || 0;
    try {
      const flows = await detectOnChainCapitalFlows(CONFIG.walletAddress);
      // Update state with on-chain truth — overwrites any stale/wrong values
      if (flows.totalDeposited > 0) {
        const prevDeposited = state.totalDeposited;
        state.totalDeposited = flows.totalDeposited;
        state.onChainWithdrawn = flows.totalWithdrawn;
        state.depositHistory = flows.deposits.map(d => ({
          timestamp: d.timestamp,
          amountUSD: Math.round(d.amountUSD * 100) / 100,
          newTotal: 0, // Recalculated below
        }));
        // Recalculate running totals
        let running = 0;
        for (const d of state.depositHistory) {
          running += d.amountUSD;
          d.newTotal = Math.round(running * 100) / 100;
        }
        // If deposit total changed significantly, adjust peak to prevent false drawdown
        if (Math.abs(state.totalDeposited - prevDeposited) > 50) {
          state.trading.peakValue += (state.totalDeposited - prevDeposited);
          if (state.trading.peakValue < state.trading.totalPortfolioValue) {
            state.trading.peakValue = state.trading.totalPortfolioValue;
          }
        }
      }
    } catch (err: any) {
      // Non-fatal — fall back to existing state values if Blockscout is down
      console.warn(`  ⚠️ On-chain deposit detection failed: ${err.message?.substring(0, 100)}`);
    }
    state.lastKnownUSDCBalance = currentUSDCBalance;

    // v12.2 + v20.6: Skip peak/baseline updates during phantom moves to prevent false drawdown/inflation
    if (!isPhantomMove && state.trading.totalPortfolioValue > state.trading.peakValue) {
      state.trading.peakValue = state.trading.totalPortfolioValue;
    }

    const sectorAllocations = calculateSectorAllocations(balances, state.trading.totalPortfolioValue);
    state.trading.sectorAllocations = sectorAllocations;

    // v11.4.21: Persist state after portfolio/peak/sector updates — ensures peakValue
    // survives if cycle crashes later (previously peak was only saved during trades/sanity checks).
    markStateDirty();

    // v11.4.21: Update daily/weekly baselines BEFORE capital floor / circuit breaker checks.
    // Previously this was only called inside checkCircuitBreaker(), which runs AFTER the capital
    // floor check. If the floor check returned early, dailyBaseline never got set → P&L stayed 0.
    // v12.2 + v20.6: Skip baseline update during phantom move to prevent false daily P&L swing
    if (!isPhantomMove) {
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
      markStateDirty();
    }

    const drawdown = Math.max(0, ((state.trading.peakValue - state.trading.totalPortfolioValue) / state.trading.peakValue) * 100);

    // v21.4: Track lifetime max drawdown
    if (drawdown > (state.trading.maxDrawdownPercent || 0)) {
      state.trading.maxDrawdownPercent = drawdown;
      markStateDirty();
    }

    // === v6.2: CAPITAL FLOOR ENFORCEMENT ===
    // v10.3: Skip floor checks when portfolio value is 0 — this is always a cold-start artifact
    // (balance hasn't been fetched yet after a redeploy), never a real scenario.
    // Real protection kicks in once the first balance fetch populates a real number.
    if (state.trading.totalPortfolioValue <= 0) {
      console.log(`\n⏳ COLD START: Portfolio value $0 — skipping capital floor (waiting for first balance fetch)`);
    }

    // v12.2 + v20.6: Skip capital floor and circuit breaker checks during phantom moves (price feed glitch)
    if (isPhantomMove) {
      console.warn(`   Skipping capital floor / circuit breaker checks this cycle (phantom ${isPhantomDrop ? 'drop' : 'spike'}).`);
    }

    // Absolute minimum: if portfolio is below $50, halt ALL trading (prevent dust churn)
    if (!isPhantomMove && state.trading.totalPortfolioValue > 0 && state.trading.totalPortfolioValue < CAPITAL_FLOOR_ABSOLUTE_USD) {
      console.log(`\n🚨 CAPITAL FLOOR BREACH: Portfolio $${state.trading.totalPortfolioValue.toFixed(2)} < absolute minimum $${CAPITAL_FLOOR_ABSOLUTE_USD}`);
      console.log(`   ALL TRADING HALTED — wallet needs funding or manual intervention.`);
      state.trading.lastCheck = new Date();
      return;
    }

    // Percentage floor: if portfolio < 60% of peak, HOLD-ONLY mode (stop-losses still fire)
    // v20.4.3: Guard against peakValue being 0/undefined — would make capitalFloorValue 0 and always trigger
    const safePeakValue = state.trading.peakValue > CAPITAL_FLOOR_ABSOLUTE_USD ? state.trading.peakValue : state.trading.totalPortfolioValue;
    const capitalFloorValue = safePeakValue * (CAPITAL_FLOOR_PERCENT / 100);
    const belowCapitalFloor = !isPhantomMove && state.trading.totalPortfolioValue > 0 && capitalFloorValue > 0 && state.trading.totalPortfolioValue < capitalFloorValue;
    if (belowCapitalFloor) {
      console.log(`\n⚠️ CAPITAL FLOOR: Portfolio $${state.trading.totalPortfolioValue.toFixed(2)} < floor $${capitalFloorValue.toFixed(2)} (${CAPITAL_FLOOR_PERCENT}% of peak $${safePeakValue.toFixed(2)})`);
      console.log(`   HOLD-ONLY mode active — no new buys, only stop-loss sells allowed.`);
    }

    // === CIRCUIT BREAKERS ===
    // v10.3: Skip breakers when portfolio is $0 — cold-start artifact, not real drawdown
    // Hard halt: if drawdown exceeds 20% from peak, stop all trading this cycle
    if (!isPhantomMove && drawdown >= 20 && !belowCapitalFloor && state.trading.totalPortfolioValue > 0) {
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

    // v21.0: MECHANICAL STOP-LOSS REMOVED — Claude decides all exits.
    // The circuit breaker (8% daily drawdown) is the catastrophic safety net.
    // Claude sees every position's P&L, entry price, hold time, and flow data.
    // It decides when to cut losses based on the full picture, not a fixed % threshold.

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
        markStateDirty(true);
      }
    }

    // v21.0: MECHANICAL PROFIT-TAKING REMOVED — Claude decides when to harvest.
    // Claude sees each position's gain %, hold duration, momentum, and flow data.
    // It decides profit-taking based on deceleration signals and portfolio balance,
    // not fixed 25/50/100% thresholds.

    // v21.0: STAGNATION/EXPLORATION TRADES REMOVED — Claude decides all buys.
    // Claude sees cash %, market conditions, and token opportunities. It decides
    // when and what to explore. No more mechanical "stagnation" buys.

    // v21.0: PRE-AI FORCED DEPLOYMENT REMOVED — Claude decides all capital deployment.
    // Claude sees cash %, sector allocations, momentum, and market conditions.
    // It decides when, how much, and where to deploy capital.
    // The cash deployment engine data (below) is kept to provide context to Claude.
    const preAiUSDC = balances.find(b => b.symbol === 'USDC')?.balance || 0;
    const preAiCashPct = state.trading.totalPortfolioValue > 0 ? (preAiUSDC / state.trading.totalPortfolioValue) * 100 : 0;

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
    const currentFearGreedForDeploy = marketData?.fearGreed?.value ?? 50;
    const deploymentCheck = checkCashDeploymentMode(effectiveCashForDeployment, state.trading.totalPortfolioValue, currentFearGreedForDeploy);
    if (deploymentCheck.active) {
      console.log(`\n💵 CASH DEPLOYMENT MODE ACTIVE`);
      console.log(`   USDC: $${currentUSDCForDeploy.toFixed(2)} (${deploymentCheck.cashPercent.toFixed(1)}% of portfolio) — tier: ${deploymentCheck.tier}`);
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
      // Existing Claude AI call — v20.5: now with tiered model routing
      console.log("\n🧠 AI analyzing portfolio & market...");
      decisions = await makeTradeDecision(balances, marketData, state.trading.totalPortfolioValue, sectorAllocations, deploymentCheck.active ? deploymentCheck : undefined, heavyReason);
    }

    // v20.8: EXTREME FEAR SIZE REDUCTION REMOVED — F&G is info-only.
    // The bot follows price physics. Momentum gates and signal quality filters
    // (confluence, MACD, RSI) handle risk. Sentiment surveys don't gate trades.
    // F&G=${fgValue} logged for dashboard display only.

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

        // v19.6.1: For buys during preservation — reduce size, don't block.
        // The AI already sees F&G=11 in its prompt. Let it make decisions.
        // Circuit breaker handles real risk. Preservation just sizes down.
        if (d.action === 'BUY') {
          const tokenInd = marketData.indicators[d.toToken];
          const confluenceScore = tokenInd?.confluenceScore ?? 0;
          const swarmConsensus = swarmConsensusMap.get(d.toToken) ?? 0;

          // Only block if confluence is truly garbage AND swarm disagrees
          if (confluenceScore < PRESERVATION_MIN_CONFLUENCE && swarmConsensus < PRESERVATION_MIN_SWARM_CONSENSUS) {
            capitalPreservationMode.tradesBlocked++;
            blockedCount++;
            console.log(`   🛡️ PRESERVATION: Blocking weak BUY ${d.toToken} (confluence=${confluenceScore} < ${PRESERVATION_MIN_CONFLUENCE}, swarm=${swarmConsensus}% < ${PRESERVATION_MIN_SWARM_CONSENSUS}%)`);
            continue;
          }

          // Size reduction: half-size during extreme fear
          // v20.7: ALL buys get sized down during preservation — including deployment buys.
          // The bot should be comfortable holding cash during fear, not forcing full-size buys.
          if (d.amountUSD) {
            const originalSize = d.amountUSD;
            d.amountUSD = d.amountUSD * PRESERVATION_SIZE_MULTIPLIER;
            const isDeploymentBuy = d.signalContext?.triggeredBy === "FORCED_DEPLOY" || d.signalContext?.triggeredBy === "CASH_DEPLOYMENT";
            console.log(`   🛡️ PRESERVATION: Sizing down ${isDeploymentBuy ? 'deployment ' : ''}BUY ${d.toToken} $${originalSize.toFixed(2)} → $${d.amountUSD.toFixed(2)} (${PRESERVATION_SIZE_MULTIPLIER}x extreme fear)`);
          }
          capitalPreservationMode.tradesPassed++;
          preservationFiltered.push(d);
        }
      }

      if (blockedCount > 0) {
        console.log(`\n🛡️ CAPITAL PRESERVATION: Blocked ${blockedCount} low-conviction trades | Passed: ${preservationFiltered.filter(d => d.action !== 'HOLD').length} | Cash: ${cashPctPres.toFixed(1)}%`);
      }
      decisions = preservationFiltered;
    }

    // v21.0: MIND-FIRST ARCHITECTURE — All mechanical trading systems removed.
    // Claude is the ONLY source of trade decisions. It sees:
    // - Every position with entry price, P&L, hold time, ATR, flow data
    // - Market momentum, regime, volume, technical indicators
    // - Portfolio cash %, sector allocations, sector drift
    // - Recent trade history with outcomes
    //
    // REMOVED SYSTEMS (v21.0):
    // - Position Sprawl Reducer (auto-sell small positions)
    // - Trailing Stop Exits (ATR-based mechanical exits)
    // - Per-Position Hard Stops (-15%, -12% mechanical exits)
    // - Flow-Reversal Exit Engine (buy ratio < 40% exits)
    // - Scale-Into-Winners (scale-up, momentum exit, decel trim)
    // - Scout Seeding ($8 data probes)
    // - Ride The Wave (FOMO momentum buys)
    // - Deployment Fallback (auto-deploy after 3 HOLDs)
    //
    // KEPT: Directive Enforcement (user commands) + Trade Cap Guard (prevent churn)

    // === v16.0: DIRECTIVE SELL ENFORCEMENT === (KEPT — user commands are not mechanical trading)
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

    // v21.0: SCALE-INTO-WINNERS + DEPLOYMENT FALLBACK REMOVED
    // Claude decides all scaling, exits, scouts, and deployment. These mechanical
    // systems are preserved as dead code during the transition period.

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
      const dedupTier = decision.reasoning?.match(/^([A-Z_]+):/)?.[1] || 'AI';
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
      // v20.8.1: Scout trades are EXEMPT from deployment sizing — they're $8 data probes, not investments.
      const isScoutTrade = decision.reasoning?.startsWith('SCOUT:') || decision.signalContext?.triggeredBy === 'SCOUT';
      if (isScoutTrade && decision.action === "BUY") {
        decision.amountUSD = Math.min(SCOUT_POSITION_USD, remainingUSDC);
        console.log(`   🔭 SCOUT SIZING: $${decision.amountUSD.toFixed(2)} (exempt from deployment/Kelly sizing)`);
      } else if (decision.action === "BUY" && decision.amountUSD > 0) {
        const instSizeCycle = calculateInstitutionalPositionSize(state.trading.totalPortfolioValue);

        if (deploymentCheck.active) {
          // DEPLOYMENT MODE: Use generous sizing — the whole point is to get capital deployed.
          // v20.3.1: Raised floor from $100/2.5% to $150/3.5% — deploy meaningfully, not in drips.
          const deployFloor = Math.max(150, state.trading.totalPortfolioValue * 0.035);
          const deployMax = Math.min(deployFloor, remainingUSDC);
          decision.amountUSD = Math.max(decision.amountUSD, deployMax);
          decision.amountUSD = Math.min(decision.amountUSD, remainingUSDC);
          console.log(`   ⚡ DEPLOY SIZING: $${decision.amountUSD.toFixed(2)} (floor: $${deployFloor.toFixed(0)}, Kelly would be: $${instSizeCycle.sizeUSD.toFixed(2)})`);
        } else {
          // NORMAL MODE: Kelly cap with ATR adjustment, no other reductions.
          const kellyMax = Math.min(instSizeCycle.sizeUSD, remainingUSDC);
          decision.amountUSD = Math.min(decision.amountUSD, kellyMax);
          console.log(`   🎰 Kelly Cap: $${kellyMax.toFixed(2)} (${instSizeCycle.kellyPct.toFixed(1)}%)`);

          // v20.0: Enhanced volatility-adjusted position sizing
          // Goal: each position contributes equal RISK to the portfolio.
          // Higher ATR → more volatile → smaller position (and vice versa).
          const tokenATR = marketData.indicators[decision.toToken]?.atrPercent;
          if (tokenATR && tokenATR > 0) {
            const allATRs = Object.values(marketData.indicators)
              .map((ind: any) => ind?.atrPercent)
              .filter((a: any) => a && a > 0) as number[];
            const avgATR = allATRs.length > 0 ? allATRs.reduce((s, a) => s + a, 0) / allATRs.length : tokenATR;

            // Inverse volatility sizing: target daily risk = VOL_TARGET_DAILY_PCT
            // If token has 2x average volatility → 0.5x position size
            // Clamped to 0.5x-1.5x to prevent extreme sizing
            const volRatio = avgATR / tokenATR; // >1 means token is calmer than average
            const atrMultiplier = Math.max(0.5, Math.min(1.5, volRatio));

            // v20.0: Confluence-weighted sizing — high confidence gets full size, low gets reduced
            const confluenceScore = marketData.indicators[decision.toToken]?.confluenceScore || 0;
            const absConfluence = Math.abs(confluenceScore);
            // Scale: 0-20 → 0.6x, 20-40 → 0.8x, 40-60 → 1.0x, 60+ → 1.0x (no boost above base)
            const confidenceMultiplier = absConfluence >= 40 ? 1.0 : absConfluence >= 20 ? 0.8 : 0.6;

            const combinedMultiplier = atrMultiplier * confidenceMultiplier;

            if (Math.abs(combinedMultiplier - 1.0) > 0.05) {
              const preATR = decision.amountUSD;
              decision.amountUSD = Math.max(KELLY_POSITION_FLOOR_USD, Math.round(decision.amountUSD * combinedMultiplier * 100) / 100);
              const volLabel = tokenATR > avgATR * 1.3 ? '⚡HIGH' : tokenATR < avgATR * 0.7 ? '🧊LOW' : '📊MED';
              console.log(`   📊 VOL-SIZE: ${volLabel} vol (ATR ${tokenATR.toFixed(1)}% vs avg ${avgATR.toFixed(1)}%) → ×${atrMultiplier.toFixed(2)} | Confidence ${absConfluence.toFixed(0)} → ×${confidenceMultiplier} | Combined: ×${combinedMultiplier.toFixed(2)} ($${preATR.toFixed(2)} → $${decision.amountUSD.toFixed(2)})`);
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

        // v20.5.4: Small portfolio minimum — after all multipliers (vol, ATR, fear, confluence),
        // ensure trades stay above a useful size. Without this, multiplicative reductions stack
        // to produce $1-3 trades that waste gas. For portfolios <$5K, enforce a $10 floor on buys
        // so the bot can actually rebalance instead of churning micro-trades.
        const SMALL_PORTFOLIO_MIN_TRADE = 10;
        const SMALL_PORTFOLIO_THRESHOLD = 5000;
        if (state.trading.totalPortfolioValue < SMALL_PORTFOLIO_THRESHOLD && decision.amountUSD > 0 && decision.amountUSD < SMALL_PORTFOLIO_MIN_TRADE) {
          const boosted = Math.min(SMALL_PORTFOLIO_MIN_TRADE, remainingUSDC);
          if (boosted >= SMALL_PORTFOLIO_MIN_TRADE) {
            console.log(`   📈 SMALL PORTFOLIO BOOST: $${decision.amountUSD.toFixed(2)} → $${boosted.toFixed(2)} (min $${SMALL_PORTFOLIO_MIN_TRADE} for portfolios <$${SMALL_PORTFOLIO_THRESHOLD})`);
            decision.amountUSD = boosted;
          }
        }

        // v14.0: Enforce minimum position — no dust trades
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

      // v20.4.2: Circuit breaker guard — block ALL actions for tokens with broken swap routes
      const blockedToken = decision.action === "BUY" ? decision.toToken : decision.fromToken;
      if (blockedToken && isTokenBlocked(blockedToken)) {
        console.log(`   🚫 CIRCUIT BREAKER: Skipping ${decision.action} for ${blockedToken} — swap routes broken, cooling off`);
        decision.action = "HOLD";
        decision.reasoning = `Circuit breaker: ${blockedToken} blocked after repeated swap failures. Auto-unblocks after ${FAILURE_COOLDOWN_HOURS}h.`;
      }

      // v11.4.11: Block AI from buying CDP-unsupported tokens
      if (decision.action === "BUY" && CDP_UNSUPPORTED_TOKENS.has(decision.toToken)) {
        console.log(`   🚫 CDP UNSUPPORTED: Skipping BUY for ${decision.toToken} — CDP SDK cannot swap this token`);
        decision.action = "HOLD";
        decision.reasoning = `CDP unsupported: ${decision.toToken} cannot be traded via CDP SDK.`;
      }

      // Execute if needed
      if (["BUY", "SELL", "REBALANCE"].includes(decision.action) && decision.amountUSD >= 1.00) {
        // v20.0: Enhanced drawdown controls — block buys during daily drawdown halt
        const ddCheck = isTradeAllowedByDrawdown(decision.action as 'BUY' | 'SELL');
        if (!ddCheck.allowed) {
          console.log(`   🚨 DRAWDOWN HALT: ${decision.action} ${decision.toToken || decision.fromToken} blocked — ${ddCheck.reason}`);
          decision.action = "HOLD";
          decision.reasoning = `Drawdown halt: ${ddCheck.reason}`;
        }

        // v20.0: Adversarial Risk Reviewer — challenge trade before execution
        if (["BUY", "SELL"].includes(decision.action)) {
          const tradeToken = decision.action === "BUY" ? decision.toToken : decision.fromToken;
          const tokenInd = marketData.indicators?.[tradeToken];
          const position = state.costBasis[tradeToken];
          const numLosing = Object.values(state.costBasis).filter((cb: any) => cb.unrealizedPnLPercent < 0).length;
          const numTotal = Object.keys(state.costBasis).length;

          const riskInput: RiskReviewInput = {
            symbol: tradeToken,
            action: decision.action as 'BUY' | 'SELL',
            amountUSD: decision.amountUSD,
            portfolioValue: state.trading.totalPortfolioValue,
            cashPercent: ((balances.find(b => b.symbol === 'USDC')?.balance || 0) / Math.max(1, state.trading.totalPortfolioValue)) * 100,
            rsi: tokenInd?.rsi14 ?? undefined,
            macdSignal: tokenInd?.macd?.signal ?? undefined,
            confluenceScore: tokenInd?.confluenceScore ?? undefined,
            atrPercent: tokenInd?.atrPercent ?? undefined,
            buyRatio: tokenInd?.orderFlow ? tokenInd.orderFlow.buyVolumeUSD / Math.max(1, tokenInd.orderFlow.buyVolumeUSD + tokenInd.orderFlow.sellVolumeUSD) : undefined,
            priceChange24h: marketData.tokens.find(t => t.symbol === tradeToken)?.priceChange24h,
            existingPositionUSD: position?.totalUnits ? (position.totalUnits * (marketData.tokens.find(t => t.symbol === tradeToken)?.price || 0)) : undefined,
            existingGainPct: position?.unrealizedPnLPercent,
            fearGreedIndex: marketData.fearGreed?.value,
            marketRegime: marketData.marketRegime,
            numLosingPositions: numLosing,
            numTotalPositions: numTotal,
            drawdownPct: state.trading.peakValue > 0 ? ((state.trading.peakValue - state.trading.totalPortfolioValue) / state.trading.peakValue) * 100 : 0,
          };

          const review = reviewTrade(riskInput);

          if (!review.approved) {
            console.log(`   🛑 RISK REVIEWER: ${review.recommendation}`);
            recordFiltered(tradeToken, decision.action, dedupTier || 'AI', 'RISK_REVIEWER', decision.amountUSD);
            decision.action = "HOLD";
            decision.reasoning = `Risk reviewer blocked: ${review.recommendation}`;
          } else if (review.sizeReduction < 1.0 && review.sizeReduction > 0) {
            const preSize = decision.amountUSD;
            decision.amountUSD = Math.max(KELLY_POSITION_FLOOR_USD, Math.round(decision.amountUSD * review.sizeReduction * 100) / 100);
            console.log(`   ⚠️ RISK REVIEWER: ${review.recommendation} | Size: $${preSize.toFixed(2)} → $${decision.amountUSD.toFixed(2)}`);
          }
        }
      }

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
          // v20.4.2: Only count ACTUAL trading losses in the breaker, not execution failures.
          // Swap routing failures (PENDLE, TWAP) are not losses — no money was lost.
          // Still track for Telegram alerts, but don't poison the rolling window.
          const isExecutionFailure = tradeResult.error?.includes('swap routes failed') ||
            tradeResult.error?.includes('TWAP slices failed') ||
            tradeResult.error?.includes('Insufficient balance') ||
            tradeResult.error?.includes('Balance too small');
          if (!isExecutionFailure) {
            recordTradeResultForBreaker(false, 0, {
              token: decision.toToken || decision.fromToken || '?',
              error: tradeResult.error || 'unknown',
              action: decision.action,
            });
          } else {
            // Still notify Telegram but don't count toward breaker
            telegramService.onTradeResult(false, {
              token: decision.toToken || decision.fromToken || '?',
              error: tradeResult.error || 'unknown',
              action: decision.action,
            }).catch(() => {});
          }
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
      markStateDirty(true);
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
            network: activeChain.cdpNetwork,
            transaction: {
              to: withdrawCalldata.to as `0x${string}`,
              data: withdrawCalldata.data as `0x${string}`,
              value: BigInt(0),
            },
          });
          aaveYieldService.recordWithdraw(withdrawAmount, tx.transactionHash, `${regime} regime, F&G ${fearGreedVal}${aiNeedsCapital ? ', AI needs capital' : ''}`);
          lastYieldAction = `WITHDRAW $${withdrawAmount.toFixed(2)} @ ${new Date().toISOString()}`;
          console.log(`  ✅ Aave withdraw: $${withdrawAmount.toFixed(2)} USDC — tx: ${tx.transactionHash}`);
          markStateDirty(true);
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
              network: activeChain.cdpNetwork,
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
            network: activeChain.cdpNetwork,
            transaction: {
              to: supplyCalldata.to as `0x${string}`,
              data: supplyCalldata.data as `0x${string}`,
              value: BigInt(0),
            },
          });
          aaveYieldService.recordSupply(depositAmount, tx.transactionHash, `${regime} regime, F&G ${fearGreedVal}`);
          lastYieldAction = `SUPPLY $${depositAmount.toFixed(2)} @ ${new Date().toISOString()}`;
          console.log(`  ✅ Aave supply: $${depositAmount.toFixed(2)} USDC — tx: ${tx.transactionHash}`);
          markStateDirty(true);
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

    // === v21.2: MORPHO YIELD CYCLE ===
    // Park idle USDC in Morpho Steakhouse Prime vault (ERC-4626) when optimizer selects Morpho.
    if (yieldEnabled && cdpClient && yieldOptimizer.getCurrentProtocol() === 'morpho') {
      try {
        const walletAddr = CONFIG.walletAddress;
        const usdcBalance = balances.find(b => b.symbol === 'USDC')?.balance || 0;
        const regime = marketData.marketRegime || 'UNKNOWN';
        const fearGreedVal = marketData.fearGreed?.value || 50;

        // Refresh share balance every 3 heavy cycles
        if (yieldCycleCount % 3 === 1) {
          await morphoYieldService.refreshBalance(walletAddr);
        }

        const aiNeedsCapital = decisions.some(
          (d: any) => d.action === 'BUY' && d.amountUSD > usdcBalance * 0.8
        );

        const depositAmount = morphoYieldService.calculateDepositAmount(usdcBalance, regime, fearGreedVal);
        const withdrawAmount = morphoYieldService.calculateWithdrawAmount(usdcBalance, regime, fearGreedVal, aiNeedsCapital);

        if (withdrawAmount > 0) {
          console.log(`\n  🏦 MORPHO YIELD: Withdrawing $${withdrawAmount.toFixed(2)} USDC (${regime}, F&G: ${fearGreedVal})`);
          const withdrawCalldata = morphoYieldService.buildWithdrawCalldata(withdrawAmount, walletAddr);
          const account = await cdpClient.evm.getOrCreateAccount({ name: CDP_ACCOUNT_NAME });
          const tx = await account.sendTransaction({
            network: activeChain.cdpNetwork,
            transaction: {
              to: withdrawCalldata.to as `0x${string}`,
              data: withdrawCalldata.data as `0x${string}`,
              value: BigInt(0),
            },
          });
          morphoYieldService.recordWithdraw(withdrawAmount, tx.transactionHash, `${regime} regime, F&G ${fearGreedVal}${aiNeedsCapital ? ', AI needs capital' : ''}`);
          lastYieldAction = `MORPHO WITHDRAW $${withdrawAmount.toFixed(2)} @ ${new Date().toISOString()}`;
          console.log(`  ✅ Morpho withdraw: $${withdrawAmount.toFixed(2)} USDC — tx: ${tx.transactionHash}`);
          markStateDirty(true);
        } else if (depositAmount > 0 && !anyTradeExecuted) {
          console.log(`\n  🏦 MORPHO YIELD: Depositing $${depositAmount.toFixed(2)} USDC (${regime}, F&G: ${fearGreedVal})`);
          const depositCalldata = morphoYieldService.buildDepositCalldata(depositAmount, walletAddr);
          const account = await cdpClient.evm.getOrCreateAccount({ name: CDP_ACCOUNT_NAME });

          // Check and set approval if needed
          const currentAllowance = await morphoYieldService.getAllowance(walletAddr);
          const depositAmountRaw = BigInt(Math.floor(depositAmount * 1e6));
          if (currentAllowance < depositAmountRaw) {
            console.log(`  🔓 Approving Morpho vault to spend USDC...`);
            const approveTx = await account.sendTransaction({
              network: activeChain.cdpNetwork,
              transaction: {
                to: depositCalldata.approvalTo as `0x${string}`,
                data: depositCalldata.approvalData as `0x${string}`,
                value: BigInt(0),
              },
            });
            console.log(`  ✅ Morpho approval: ${approveTx.transactionHash}`);
            await new Promise(resolve => setTimeout(resolve, 5000));
          }

          const tx = await account.sendTransaction({
            network: activeChain.cdpNetwork,
            transaction: {
              to: depositCalldata.to as `0x${string}`,
              data: depositCalldata.data as `0x${string}`,
              value: BigInt(0),
            },
          });
          morphoYieldService.recordSupply(depositAmount, tx.transactionHash, `${regime} regime, F&G ${fearGreedVal}`);
          lastYieldAction = `MORPHO SUPPLY $${depositAmount.toFixed(2)} @ ${new Date().toISOString()}`;
          console.log(`  ✅ Morpho supply: $${depositAmount.toFixed(2)} USDC — tx: ${tx.transactionHash}`);
          markStateDirty(true);
        } else {
          const morphoState = morphoYieldService.getState();
          if (morphoState.depositedUSDC > 0) {
            console.log(`  🏦 Morpho yield: $${morphoState.currentValueUSDC.toFixed(2)} earning ~${morphoState.estimatedAPY}% APY | Yield: $${morphoState.totalYieldEarned.toFixed(4)}`);
          }
        }
      } catch (morphoError: any) {
        console.error(`  ❌ Morpho yield cycle error: ${morphoError?.message?.substring(0, 200)}`);
      }
    }

    // === v15.3 / v21.2: MULTI-PROTOCOL YIELD OPTIMIZER CYCLE ===
    // Compare rates across Aave, Compound, Morpho, Moonwell every YIELD_CHECK_INTERVAL_CYCLES cycles.
    // v21.2: Now supports live Aave <-> Morpho rebalancing.
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
              // v21.2: Get deposited amount from whichever protocol is currently active
              const deposited = current === 'morpho'
                ? morphoYieldService.getDepositedUSDC()
                : aaveYieldService.getState().depositedUSDC;
              if (deposited >= YIELD_MIN_IDLE_USD) {
                const result = await yieldOptimizer.rebalance(current, best.protocol, deposited);
                if (result.success) {
                  console.log(`  🔄 ${result.message}`);

                  // v21.2: Execute real rebalance between Aave and Morpho
                  if (result.action === 'REBALANCE_AAVE_TO_MORPHO' && cdpClient) {
                    try {
                      const walletAddr = CONFIG.walletAddress;
                      const account = await cdpClient.evm.getOrCreateAccount({ name: CDP_ACCOUNT_NAME });

                      // Step 1: Withdraw from Aave
                      const withdrawCalldata = aaveYieldService.buildWithdrawCalldata(deposited, walletAddr);
                      const withdrawTx = await account.sendTransaction({
                        network: activeChain.cdpNetwork,
                        transaction: { to: withdrawCalldata.to as `0x${string}`, data: withdrawCalldata.data as `0x${string}`, value: BigInt(0) },
                      });
                      aaveYieldService.recordWithdraw(deposited, withdrawTx.transactionHash, 'Rebalance to Morpho (higher APY)');
                      console.log(`  ✅ Aave → withdraw $${deposited.toFixed(2)}: ${withdrawTx.transactionHash}`);
                      await new Promise(resolve => setTimeout(resolve, 5000));

                      // Step 2: Deposit to Morpho
                      const depositCalldata = morphoYieldService.buildDepositCalldata(deposited, walletAddr);
                      const allowance = await morphoYieldService.getAllowance(walletAddr);
                      if (allowance < BigInt(Math.floor(deposited * 1e6))) {
                        const approveTx = await account.sendTransaction({
                          network: activeChain.cdpNetwork,
                          transaction: { to: depositCalldata.approvalTo as `0x${string}`, data: depositCalldata.approvalData as `0x${string}`, value: BigInt(0) },
                        });
                        console.log(`  ✅ Morpho approval: ${approveTx.transactionHash}`);
                        await new Promise(resolve => setTimeout(resolve, 5000));
                      }
                      const depositTx = await account.sendTransaction({
                        network: activeChain.cdpNetwork,
                        transaction: { to: depositCalldata.to as `0x${string}`, data: depositCalldata.data as `0x${string}`, value: BigInt(0) },
                      });
                      morphoYieldService.recordSupply(deposited, depositTx.transactionHash, 'Rebalance from Aave (higher APY)');
                      console.log(`  ✅ Morpho ← deposit $${deposited.toFixed(2)}: ${depositTx.transactionHash}`);
                      markStateDirty(true);
                    } catch (rebalErr: any) {
                      console.error(`  ❌ Aave→Morpho rebalance error: ${rebalErr?.message?.substring(0, 200)}`);
                    }
                  } else if (result.action === 'REBALANCE_MORPHO_TO_AAVE' && cdpClient) {
                    try {
                      const walletAddr = CONFIG.walletAddress;
                      const account = await cdpClient.evm.getOrCreateAccount({ name: CDP_ACCOUNT_NAME });

                      // Step 1: Withdraw from Morpho
                      const withdrawCalldata = morphoYieldService.buildWithdrawCalldata(deposited, walletAddr);
                      const withdrawTx = await account.sendTransaction({
                        network: activeChain.cdpNetwork,
                        transaction: { to: withdrawCalldata.to as `0x${string}`, data: withdrawCalldata.data as `0x${string}`, value: BigInt(0) },
                      });
                      morphoYieldService.recordWithdraw(deposited, withdrawTx.transactionHash, 'Rebalance to Aave (higher APY)');
                      console.log(`  ✅ Morpho → withdraw $${deposited.toFixed(2)}: ${withdrawTx.transactionHash}`);
                      await new Promise(resolve => setTimeout(resolve, 5000));

                      // Step 2: Deposit to Aave
                      const supplyCalldata = aaveYieldService.buildSupplyCalldata(deposited, walletAddr);
                      const allowance = await aaveYieldService.getAllowance(walletAddr);
                      if (allowance < BigInt(Math.floor(deposited * 1e6))) {
                        const approveTx = await account.sendTransaction({
                          network: activeChain.cdpNetwork,
                          transaction: { to: supplyCalldata.approvalTo as `0x${string}`, data: supplyCalldata.approvalData as `0x${string}`, value: BigInt(0) },
                        });
                        console.log(`  ✅ Aave approval: ${approveTx.transactionHash}`);
                        await new Promise(resolve => setTimeout(resolve, 5000));
                      }
                      const depositTx = await account.sendTransaction({
                        network: activeChain.cdpNetwork,
                        transaction: { to: supplyCalldata.to as `0x${string}`, data: supplyCalldata.data as `0x${string}`, value: BigInt(0) },
                      });
                      aaveYieldService.recordSupply(deposited, depositTx.transactionHash, 'Rebalance from Morpho (higher APY)');
                      console.log(`  ✅ Aave ← deposit $${deposited.toFixed(2)}: ${depositTx.transactionHash}`);
                      markStateDirty(true);
                    } catch (rebalErr: any) {
                      console.error(`  ❌ Morpho→Aave rebalance error: ${rebalErr?.message?.substring(0, 200)}`);
                    }
                  }
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
  if (yieldEnabled) {
    const ys = aaveYieldService.getState();
    const ms = morphoYieldService.getState();
    const totalDeposited = ys.aTokenBalance + ms.currentValueUSDC;
    const totalYield = ys.totalYieldEarned + ms.totalYieldEarned;
    const currentProto = yieldOptimizer.getCurrentProtocol();
    const bestRate = lastYieldRates.length > 0 ? lastYieldRates[0] : null;
    const bestInfo = bestRate ? ` | Best: ${bestRate.protocol} ${bestRate.apy.toFixed(2)}%` : '';
    if (totalDeposited > 0) {
      const parts: string[] = [];
      if (ys.aTokenBalance > 0) parts.push(`Aave: $${ys.aTokenBalance.toFixed(2)}`);
      if (ms.currentValueUSDC > 0) parts.push(`Morpho: $${ms.currentValueUSDC.toFixed(2)}`);
      console.log(`   Yield: ${parts.join(' + ')} ($${totalDeposited.toFixed(2)} total) | Active: ${currentProto} | Earned: $${totalYield.toFixed(4)}${bestInfo}`);
    }
  }
  if (lastDexIntelligence) {
    const di = lastDexIntelligence;
    const actionableSignals = di.buySellPressure.filter(p => p.signal !== 'NEUTRAL').length;
    console.log(`   DEX Intel: ${di.tokenMetrics.length} tokens | ${di.volumeSpikes.length} spikes | ${actionableSignals} pressure signals | fetches: ${dexIntelFetchCount}`);
  }
  console.log(`   Cooldowns: ${cooldownManager.getActiveCount()} active | Cache: ${cacheManager.getStats().entries} entries (${cacheManager.getStats().hitRate} hit rate)`);
  console.log(`   Cycle type: HEAVY (${heavyReason}) | Light/Heavy: ${cycleStats.totalLight}L / ${cycleStats.totalHeavy}H`);

  // v20.2: Score missed opportunities from previous cycles
  const priceRecord: Record<string, number> = {};
  for (const [symbol, price] of currentPrices) { priceRecord[symbol] = price; }
  updateOpportunityCosts(priceRecord);

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

  // Phase 3c: Wire module-level state into the centralized store
  _storeSetState(state);
  _storeSetBreakerState(breakerState);

  // Phase 4: Initialize execution engine
  initRpc([...BASE_RPC_ENDPOINTS]);
  initExecutionHelpers({ TOKEN_REGISTRY, tokenDiscoveryEngine });

  // Phase 6: Initialize intelligence fetchers
  initIntelligenceFetchers({ TOKEN_REGISTRY });

  // Phase 5: Initialize self-improvement engine with state references
  initSelfImprovement({ state, getActiveDirectives });

  // Phase 7r: Initialize dashboard API with state references
  initDashboardAPI({
    state, breakerState, lastMomentumSignal, lastSignalHealth, lastMarketRegime,
    CONFIG, calculateTradePerformance, calculateWinRateTruth,
    signalHistory, opportunityCostLog: opportunityCostState.entries, cumulativeMissedPnl: opportunityCostState.cumulativeMissedPnl, cumulativeMissedCount: opportunityCostState.cumulativeMissedCount,
    shadowProposals, anthropic, SYSTEM_PROMPT_CORE, SYSTEM_PROMPT_STRATEGY,
    tokenDiscoveryEngine, yieldOptimizer, DEFAULT_ADAPTIVE_THRESHOLDS, formatSelfImprovementPrompt,
    ALLOWED_ORIGINS, markStateDirty, getOpportunityCostSummary,
    getCashDeploymentMode: () => cashDeploymentMode,
    getCashDeploymentCycles: () => cashDeploymentCycles,
    getCrashBuyingOverrideActive: () => crashBuyingOverrideActive,
    getCrashBuyingOverrideCycles: () => crashBuyingOverrideCycles,
    getCurrentAltseasonSignal: () => currentAltseasonSignal,
  });

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

  // === v19.6: PRE-FLIGHT CHECKS — Fail fast, not 14 hours later ===
  const preFlightResults = await runPreFlightChecks(signalMode);
  if (!preFlightResults.allPassed) {
    const criticalNames = preFlightResults.criticalFailures.map(f => f.name).join(', ');
    console.error(`\n🚫 CRITICAL pre-flight failures: ${criticalNames}`);
    console.error(`   Bot will start in ANALYSIS-ONLY mode — no trades will execute.`);
    console.error(`   Fix the above issues and redeploy.\n`);
    // Notify via Telegram if available
    await telegramService.sendAlert({
      severity: "CRITICAL",
      title: "Pre-Flight Check FAILED",
      message: `Bot started but trading is DISABLED due to:\n${preFlightResults.criticalFailures.map(f => `- ${f.name}: ${f.message}`).join('\n')}`,
    });
    // Don't exit — allow analysis-only mode, but disable trading
    CONFIG.trading.enabled = false;
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
      console.error(`\n  🚫 WALLET MISMATCH — TRADING DISABLED`);
      console.error(`     CDP Account: ${account.address}`);
      console.error(`     WALLET_ADDRESS (where tokens live): ${CONFIG.walletAddress}`);
      console.error(`     ❌ Trades WILL fail — CDP SDK would swap from the wrong address.`);
      console.error(`     The CDP API key may have changed, creating a new account.`);
      console.error(`     Fix: Restore the correct CDP API key, or transfer tokens to ${account.address}`);
      // v19.6: Hard stop — disable trading instead of silently failing for hours
      CONFIG.trading.enabled = false;
      await telegramService.sendAlert({
        severity: "CRITICAL",
        title: "WALLET MISMATCH — Trading Disabled",
        message: `CDP account ${account.address.substring(0, 10)}... does not match WALLET_ADDRESS ${CONFIG.walletAddress.substring(0, 10)}...\n\nAll trades would fail. Trading has been disabled. Fix the CDP API key and redeploy.`,
      });
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
        await rescueGasFromNvrTrading(); // v19.3.3: Rescue ETH from wrong account first
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
        // v21.4: Never clobber persisted peakValue — startup warmup only prices USDC,
        // so startupValue is always lower than the real peak. Only raise peak, never lower.
        state.trading.peakValue = Math.max(state.trading.peakValue || 0, startupValue);
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
        // v21.3: Mark baseline as NOT validated on startup — startup warmup only prices USDC,
        // so the baseline is unreliable until a full cycle with real market prices runs.
        // This prevents showing fake daily P&L (e.g. +$2,225 when actually down).
        breakerState.dailyBaselineValidated = false;

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

  // === v11.0 / v21.2: YIELD SERVICE INITIALIZATION (Aave + Morpho) ===
  if (yieldEnabled && signalMode !== 'producer') {
    try {
      aaveYieldService.enable();
      morphoYieldService.enable();
      const walletAddr = CONFIG.walletAddress;

      // Initialize both yield services in parallel
      await Promise.allSettled([
        aaveYieldService.refreshBalance(walletAddr),
        morphoYieldService.refreshBalance(walletAddr),
      ]);

      const ys = aaveYieldService.getState();
      const ms = morphoYieldService.getState();
      console.log(`\n🏦 Yield Services: ACTIVE (Aave + Morpho)`);
      console.log(`  💰 Aave:   $${ys.aTokenBalance.toFixed(2)} deposited | Yield: $${ys.totalYieldEarned.toFixed(4)} | ~${ys.estimatedAPY}% APY`);
      console.log(`  💰 Morpho: $${ms.currentValueUSDC.toFixed(2)} deposited | Yield: $${ms.totalYieldEarned.toFixed(4)} | ~${ms.estimatedAPY}% APY`);
      console.log(`  ⚙️ Config: Keep $500 liquid, min deposit $50, min withdraw $25`);

      // v15.3 / v21.2: Initialize yield optimizer — fetch initial rates, select best protocol
      try {
        const rates = await yieldOptimizer.getCurrentRates();
        lastYieldRates = rates;
        console.log(`  🔍 Yield Optimizer: ${rates.length} protocols (${rates.filter(r => r.status === 'active').length} active)`);
        rates.forEach(r => console.log(`     ${r.protocol.padEnd(10)} ${r.apy.toFixed(2)}% APY  [${r.status}]`));

        // Auto-select best active protocol on startup
        const bestActive = rates.find(r => r.status === 'active');
        if (bestActive) {
          // If we already have deposits in a protocol, stay there (avoid unnecessary rebalance on restart)
          if (ms.depositedUSDC > 0 && ys.depositedUSDC === 0) {
            yieldOptimizer.setCurrentProtocol('morpho');
            console.log(`  ✅ Active protocol: Morpho (has existing deposits)`);
          } else if (ys.depositedUSDC > 0) {
            yieldOptimizer.setCurrentProtocol('aave');
            console.log(`  ✅ Active protocol: Aave (has existing deposits)`);
          } else {
            yieldOptimizer.setCurrentProtocol(bestActive.protocol);
            console.log(`  ✅ Active protocol: ${bestActive.protocol} (best APY: ${bestActive.apy.toFixed(2)}%)`);
          }
        }
      } catch (optErr: any) {
        console.warn(`  ⚠️ Yield optimizer init: ${optErr?.message?.substring(0, 100)} — will retry on cycle`);
      }
    } catch (yieldInitErr: any) {
      console.warn(`  ⚠️ Yield init: ${yieldInitErr.message?.substring(0, 150)} — will retry on first cycle`);
    }
  } else {
    console.log(`\n🏦 Yield Services: disabled (set AAVE_YIELD_ENABLED=true to activate)`);
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

  // v20.7: STATE_BACKUP_URL fallback — if disk state is empty and a backup URL is configured,
  // fetch state from the URL and restore it. This handles cases where volumes AND local disk fail.
  if (state.tradeHistory.length === 0 && Object.keys(state.costBasis).length === 0 && process.env.STATE_BACKUP_URL) {
    console.log(`[State] No local state found — attempting recovery from STATE_BACKUP_URL...`);
    try {
      const backupRes = await axios.get(process.env.STATE_BACKUP_URL, {
        timeout: 15_000,
        headers: process.env.STATE_BACKUP_AUTH ? { 'Authorization': `Bearer ${process.env.STATE_BACKUP_AUTH}` } : {},
      });
      const backupData = backupRes.data;
      // The backup URL may return the raw state or a wrapper { state: "..." }
      const statePayload = backupData.state ? (typeof backupData.state === 'string' ? JSON.parse(backupData.state) : backupData.state) : backupData;
      if (statePayload.trades && Array.isArray(statePayload.trades) && statePayload.trades.length > 0) {
        // Write to disk
        const dir = CONFIG.logFile.substring(0, CONFIG.logFile.lastIndexOf('/'));
        if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const tmpFile = CONFIG.logFile + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify(statePayload, null, 2));
        fs.renameSync(tmpFile, CONFIG.logFile);
        // Reload from disk into memory
        loadTradeHistory();
        console.log(`[State] Recovered ${state.tradeHistory.length} trades and ${Object.keys(state.costBasis).length} positions from backup URL`);
      } else {
        console.log(`[State] Backup URL returned empty/invalid state — starting fresh`);
      }
    } catch (e: any) {
      console.warn(`[State] Failed to recover from backup URL: ${e.message} — starting fresh`);
    }
  }

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

  // v21.7: On-chain recovery moved to post-startup (30s after server.listen) to avoid
  // blocking Railway healthchecks. Runs background after boot — see healthServer.listen().

  // v11.4.24: Log discrepancy between lifetime counters and capped trade history array, but do NOT
  // overwrite lifetime counters — the trade array is capped at 2500 so it will always be smaller.
  const successfulInHistory = state.tradeHistory.filter(t => t.success).length;
  const totalInHistory = state.tradeHistory.length;
  if (state.trading.totalTrades !== totalInHistory || state.trading.successfulTrades !== successfulInHistory) {
    console.log(`  ℹ️ Trade counter vs history: lifetime totalTrades=${state.trading.totalTrades} (history has ${totalInHistory}), lifetime successful=${state.trading.successfulTrades} (history has ${successfulInHistory})`);
    console.log(`  ℹ️ This is expected — trade history array is capped at 2500, lifetime counters preserved separately`);
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

  // v19.5.0: One-time P&L reset — zero out corrupted realized P&L from months of cost basis bugs.
  // The old data had inflated SANITY RESETs, truncated trade history losing buys, and zero-cost-basis
  // sells producing hundreds of dollars in false losses. Start fresh with accurate tracking.
  if (!(state as any)._migrationPnLResetV1950) {
    console.log(`\n🔧 MIGRATION v19.5.0: Resetting corrupted realized P&L data...`);
    let resetCount = 0;
    for (const [symbol, cb] of Object.entries(state.costBasis)) {
      if (cb.realizedPnL !== 0) {
        console.log(`   ${symbol}: realizedPnL $${cb.realizedPnL.toFixed(2)} → $0.00`);
        cb.realizedPnL = 0;
        resetCount++;
      }
      // Also reset cost basis to current market price for dust positions
      // to prevent false unrealized P&L on near-zero holdings
      if (cb.currentHolding > 0 && cb.averageCostBasis > 0) {
        const currentPrice = cb.averageCostBasis; // Will be corrected by next updateUnrealizedPnL cycle
        cb.unrealizedPnL = 0;
      }
    }
    (state as any)._migrationPnLResetV1950 = true;
    saveTradeHistory();
    console.log(`✅ MIGRATION v19.5.0: Reset realized P&L on ${resetCount} tokens. Clean slate.\n`);
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

  // === v21.3: STARTUP STATUS ALERT — Never silently run in dry-run mode again ===
  // Send Telegram alert on every startup so we KNOW if trading is live or disabled.
  const startupBlockers: string[] = [];
  if (!CONFIG.trading.enabled) startupBlockers.push("TRADING_ENABLED env var is not 'true'");
  if (!cdpClient) startupBlockers.push("CDP client failed to initialize");
  const portfolioVal = state.trading.totalPortfolioValue || 0;
  if (portfolioVal > 0 && portfolioVal < CAPITAL_FLOOR_ABSOLUTE_USD) startupBlockers.push(`Portfolio $${portfolioVal.toFixed(2)} below $${CAPITAL_FLOOR_ABSOLUTE_USD} capital floor`);
  const startupDrawdown = state.trading.peakValue > 0 ? ((state.trading.peakValue - portfolioVal) / state.trading.peakValue) * 100 : 0;
  if (startupDrawdown >= 20) startupBlockers.push(`Drawdown ${startupDrawdown.toFixed(1)}% exceeds 20% circuit breaker`);

  if (startupBlockers.length > 0) {
    console.error(`\n🚨 STARTUP: Trading is BLOCKED by ${startupBlockers.length} issue(s):`);
    startupBlockers.forEach(b => console.error(`   ❌ ${b}`));
    await telegramService.sendAlert({
      severity: "CRITICAL",
      title: "Bot Started — Trading DISABLED",
      message: `Bot deployed but CANNOT trade:\n${startupBlockers.map(b => `❌ ${b}`).join('\n')}\n\nPortfolio: $${portfolioVal.toFixed(2)}\nFix these issues and redeploy.`,
    });
  } else {
    console.log(`\n✅ STARTUP: Trading is LIVE — no blockers detected`);
    await telegramService.sendAlert({
      severity: "INFO",
      title: "Bot Started — Trading LIVE 🟢",
      message: `Bot deployed and trading is ACTIVE.\n\nPortfolio: $${portfolioVal.toFixed(2)}\nPeak: $${state.trading.peakValue.toFixed(2)}\nTokens: ${CONFIG.activeTokens.length}\nInterval: ${CONFIG.trading.intervalMinutes}min`,
    });
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

  // v19.6: Daily P&L digest via Telegram — 11:00 AM UTC (7 AM EDT)
  if (telegramService.isEnabled()) {
    cron.schedule('0 11 * * *', async () => {
      try {
        const pv = state.trading.totalPortfolioValue || 0;
        const dailyBase = breakerState.dailyBaseline.value || pv;
        // v21.3: Only report daily P&L when baseline is validated by a real cycle
        const baselineOk = breakerState.dailyBaselineValidated !== false;
        const dailyPnL = baselineOk ? (pv - dailyBase) : 0;
        const dailyPnLPct = (baselineOk && dailyBase > 0) ? (dailyPnL / dailyBase) * 100 : 0;

        // Find today's trades
        const todayStr = new Date().toISOString().split('T')[0];
        const todayTrades = state.tradeHistory.filter(t =>
          t.timestamp && t.timestamp.startsWith(todayStr)
        );
        const todayWins = todayTrades.filter(t => t.success).length;
        const winRate = todayTrades.length > 0 ? (todayWins / todayTrades.length) * 100 : 0;

        await telegramService.sendDailyDigest({
          portfolioValue: pv,
          dailyPnL,
          dailyPnLPct,
          totalTrades: todayTrades.length,
          winRate,
          fearGreedIndex: lastFearGreedValue || undefined,
        });
      } catch (err: any) {
        console.warn(`[Telegram Digest] Error: ${err?.message?.substring(0, 200)}`);
      }
    }, { timezone: 'UTC' });
    console.log(`  📊 Daily P&L digest: Telegram at 11:00 UTC (7 AM EDT)`);

    // v20.3.1: Hourly status report — bot health snapshot every hour
    cron.schedule('0 * * * *', async () => {
      try {
        const pv = state.trading.totalPortfolioValue || 0;
        const uptimeSec = Math.floor((Date.now() - state.startTime.getTime()) / 1000);
        const uptimeStr = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`;

        // Hourly P&L: compare to portfolio value from 1 hour ago
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        const recentTrades = state.tradeHistory.filter(t =>
          t.timestamp && new Date(t.timestamp).getTime() > oneHourAgo
        );
        const hourlyWins = recentTrades.filter(t => t.success).length;

        // Hourly realized P&L from trade history
        const hourlyPnL = recentTrades.reduce((sum, t) => sum + (t.realizedPnL || 0), 0);

        // Cash percentage from balance entries
        const balances = state.trading.balances || [];
        const usdcEntry = balances.find(b => b.symbol === 'USDC');
        const usdcValue = usdcEntry?.usdValue || 0;
        const cashPct = pv > 0 ? (usdcValue / pv) * 100 : 0;

        // Top positions from balance entries
        const positions = balances
          .filter(b => b.symbol !== 'USDC' && b.usdValue > 1)
          .map(b => {
            const cb = state.costBasis[b.symbol];
            const pnlPct = cb?.averageCostBasis && b.price
              ? ((b.price - cb.averageCostBasis) / cb.averageCostBasis) * 100
              : 0;
            return { symbol: b.symbol, usdValue: b.usdValue, pnlPct };
          });

        await telegramService.sendHourlyReport({
          portfolioValue: pv,
          hourlyPnL,
          hourlyTrades: recentTrades.length,
          hourlyWins,
          totalTrades: state.trading.totalTrades,
          totalCycles: state.totalCycles,
          cashPercent: cashPct,
          positions,
          marketRegime: lastMarketRegime || undefined,
          fearGreedIndex: lastFearGreedValue || undefined,
          preservationMode: capitalPreservationMode.isActive,
          uptime: uptimeStr,
          version: BOT_VERSION,
        });
      } catch (err: any) {
        console.warn(`[Telegram Hourly] Error: ${err?.message?.substring(0, 200)}`);
      }
    }, { timezone: 'UTC' });
    console.log(`  ⏰ Hourly status report: Telegram every hour on the hour`);
  }

  // Heartbeat every 5 minutes to confirm process is alive
  setInterval(() => {
    const lastTrade = state.tradeHistory.length > 0 ? state.tradeHistory[state.tradeHistory.length - 1] : null;
    const lastTradeAge = lastTrade ? `${((Date.now() - new Date(lastTrade.timestamp).getTime()) / 60000).toFixed(0)}m ago` : 'never';
    const cycleStatus = cycleInProgress ? `IN_PROGRESS (${((Date.now() - cycleStartedAt) / 1000).toFixed(0)}s)` : 'idle';
    const lastHeavyAge = lastHeavyCycleAt ? `${((Date.now() - lastHeavyCycleAt) / 1000).toFixed(0)}s ago` : 'never';
    // v20.4.2: Self-healing health score — GREEN / YELLOW / RED
    const blockedTokens = Object.entries(state.tradeFailures).filter(([, f]) => f.count >= MAX_CONSECUTIVE_FAILURES).map(([s]) => s);
    const lastTradeMinutes = lastTrade ? (Date.now() - new Date(lastTrade.timestamp).getTime()) / 60000 : Infinity;
    const breakerActive = breakerState.lastBreakerTriggered ? Date.now() < new Date(breakerState.lastBreakerTriggered).getTime() + (BREAKER_PAUSE_HOURS * 3600000) : false;
    const healthScore = breakerActive ? '🔴 RED' : (blockedTokens.length >= 3 || lastTradeMinutes > 360) ? '🟡 YELLOW' : '🟢 GREEN';
    console.log(`💓 Heartbeat | ${new Date().toISOString()} | ${healthScore} | Cycles: ${state.totalCycles} | Trades: ${state.trading.successfulTrades}/${state.trading.totalTrades} | Last trade: ${lastTradeAge} | Blocked: ${blockedTokens.length > 0 ? blockedTokens.join(',') : 'none'} | Portfolio: $${(state.trading.totalPortfolioValue || 0).toFixed(0)}`);
    // v20.5: Heartbeat now flushes only if state is dirty (was: unconditional save every 5min)
    flushStateIfDirty('heartbeat');
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

  // v20.7: Save state IMMEDIATELY with timeout protection
  console.log(`[Shutdown] Saving state before exit...`);
  const saveStart = Date.now();
  const saveTimeout = setTimeout(() => {
    console.error(`[Shutdown] State save timed out after 5s — forcing exit`);
    process.exit(1);
  }, 5000);

  try {
    saveTradeHistory();
    clearTimeout(saveTimeout);
    const elapsed = Date.now() - saveStart;
    // Log state file path and size for debugging
    let fileSizeKB = 0;
    try {
      const stat = fs.statSync(CONFIG.logFile);
      fileSizeKB = Math.round(stat.size / 1024);
    } catch {}
    console.log(`   ✅ State saved successfully in ${elapsed}ms — ${CONFIG.logFile} (${fileSizeKB}KB)`);
    console.log(`   📊 ${state.tradeHistory.length} trades, ${Object.keys(state.costBasis).length} positions`);
  } catch (e: any) {
    clearTimeout(saveTimeout);
    console.error(`   ❌ Error saving state on shutdown: ${e.message}`);
  }

  // v19.6: Telegram shutdown notification (best-effort, 3s timeout)
  telegramService.onShutdown(`Received ${signal}`).catch(() => {}).finally(() => {
    console.log("   Goodbye.");
    process.exit(0);
  });
  // Fallback exit if Telegram takes too long
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// === Dashboard API aliases — must be before main() to avoid TDZ errors ===
const sendJSON = _sendJSON;
const downsample = _downsample;
const isAuthorized = _isAuthorized;
const calculateRiskRewardMetrics = _calculateRiskRewardMetrics;
const apiPortfolio = _apiPortfolio;
const apiBalances = _apiBalances;
const apiSectors = _apiSectors;
const apiTrades = _apiTrades;
const apiDailyPnL = _apiDailyPnL;
const apiIndicators = _apiIndicators;
const apiIntelligence = _apiIntelligence;
const apiPatterns = _apiPatterns;
const apiReviews = _apiReviews;
const apiThresholds = _apiThresholds;
const getActiveDirectives = _getActiveDirectives;
const addUserDirective = _addUserDirective;
const removeUserDirective = _removeUserDirective;
const applyConfigChanges = _applyConfigChanges;
const getActiveConfigDirectives = _getActiveConfigDirectives;
const removeConfigDirective = _removeConfigDirective;
const executeChatTool = _executeChatTool;
const handleChatRequest = _handleChatRequest;
const getDashboardHTML = _getDashboardHTML;

// ============================================================================
// Export functions — imported from src/dashboard/exports.ts
// generatePaperExportHTML wrapper passes live return from state
function generatePaperExportHTML(portfolio: any, detail: any): string {
  const liveReturnPct = state.trading.initialValue > 0
    ? ((state.trading.totalPortfolioValue - state.trading.initialValue) / state.trading.initialValue) * 100
    : 0;
  return _generatePaperExportHTML(portfolio, detail, liveReturnPct);
}

// ============================================================================
// HTTP SERVER — Dashboard + API Endpoints
// ============================================================================
import http from 'http';

// v10.2: Restrict CORS to localhost only — prevents external sites from reading portfolio data
// ============================================================================
// DASHBOARD API — delegated to src/dashboard/api.ts
// ============================================================================
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000", "http://localhost:3001", "http://localhost:5173",
  "http://127.0.0.1:3000", "http://127.0.0.1:3001", "http://127.0.0.1:5173",
]);

const serverCtx: ServerContext = {
  state, breakerState, CONFIG, cdpClient, CDP_ACCOUNT_NAME,
  CAPITAL_FLOOR_ABSOLUTE_USD, PRESERVATION_RING_BUFFER_SIZE,
  PRESERVATION_FG_ACTIVATE, PRESERVATION_FG_DEACTIVATE,
  PRESERVATION_CYCLE_MULTIPLIER, PRESERVATION_MIN_CONFLUENCE,
  PRESERVATION_MIN_SWARM_CONSENSUS, PRESERVATION_TARGET_CASH_PCT,
  BREAKER_CONSECUTIVE_LOSSES, BREAKER_PAUSE_HOURS,
  KELLY_FRACTION, KELLY_MIN_TRADES, KELLY_POSITION_CEILING_PCT,
  KELLY_SMALL_PORTFOLIO_CEILING_PCT, KELLY_POSITION_FLOOR_USD,
  GAS_REFUEL_THRESHOLD_ETH, ADAPTIVE_MIN_INTERVAL_SEC, ADAPTIVE_MAX_INTERVAL_SEC,
  EMERGENCY_INTERVAL_SEC, EMERGENCY_DROP_THRESHOLD, PORTFOLIO_SENSITIVITY_TIERS,
  SIGNAL_ENGINE,
  capitalPreservationMode, lastFearGreedValue, lastSuccessfulTradeAt,
  adaptiveCycle, cycleStats, lastSignalHealth, lastMomentumSignal,
  lastKnownETHBalance, lastGasRefuelTime, lastDerivativesData,
  lastDexIntelligence, dexIntelFetchCount, lastYieldAction, yieldCycleCount,
  lastYieldRates, lastFamilyTradeResults, latestSignals, signalCycleNumber,
  signalHistory, signalMode, pendingConfigChanges, pendingWithdrawals,
  derivativesEngine, commoditySignalEngine, equityEnabled, equityEngine,
  tokenDiscoveryEngine, cacheManager, cooldownManager, yieldEnabled, yieldOptimizer,
  aaveYieldService, morphoYieldService, geckoTerminalService,
  familyEnabled, familyManager, familyWalletManager, telegramService,
  sendJSON, isAuthorized, getDashboardHTML,
  apiPortfolio, apiBalances, apiSectors, apiTrades, apiDailyPnL,
  apiIndicators, apiIntelligence, apiPatterns, apiReviews, apiThresholds,
  getActiveDirectives, addUserDirective, removeUserDirective,
  applyConfigChanges, getActiveConfigDirectives, removeConfigDirective,
  handleChatRequest, downsample,
  getEffectiveKellyCeiling, getSignalStats, getLatestReport,
  getTrailingStopState, calculateWinRateTruth, calculateTradePerformance,
  getLatestSwarmDecisions, getLastSwarmRunTime,
  triggerCircuitBreaker, executeDailyPayout, saveTradeHistory, loadTradeHistory,
  markStateDirty, flushStateIfDirty, logError,
  detectOnChainCapitalFlows, sendUSDCTransfer, getERC20Balance, TOKEN_REGISTRY,
  isStrategyInstruction, parseStrategyInstruction, generatePaperExportHTML,
  loadPriceHistory, DEFAULT_SIM_CONFIG, runSimulation, compareStrategies,
  STRATEGY_VERSIONS, getAllPaperPortfolios, getPaperPortfolioSummary,
  getPaperPortfolio, runAllVersionBacktestsFromDisk, summarizeBacktestResults,
  generateBacktestMultiExportHTML, generateBacktestSingleExportHTML,
};

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
        handleDashboard(res, serverCtx);
        break;
      case '/health':
        handleHealth(res, serverCtx);
        break;
      case '/api/persistence':
        handlePersistence(res, serverCtx);
        break;
      case '/api/preservation':
        handlePreservation(req, res, serverCtx);
        break;
      case '/api/portfolio':
        sendJSON(res, 200, apiPortfolio());
        break;
      case '/api/capital-flows':
        await handleCapitalFlows(res, serverCtx);
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
      case '/api/errors':
        handleErrors(res, serverCtx);
        break;
      case '/api/signals':
        handleSignals(req, res, serverCtx);
        break;
      case '/api/weekly-report':
        handleWeeklyReport(req, res, serverCtx);
        break;
      case '/api/debug':
        await handleDebug(res, serverCtx);
        break;
      case '/api/accounts':
        await handleAccounts(req, res, serverCtx);
        break;
      case '/api/kill':
        handleKill(req, res, serverCtx);
        break;
      case '/api/resume':
        handleResume(req, res, serverCtx);
        break;
      case '/api/daily-pnl':
        sendJSON(res, 200, apiDailyPnL());
        break;
      case '/api/indicators':
        sendJSON(res, 200, apiIndicators());
        break;
      case '/api/trailing-stops':
        handleTrailingStops(res, serverCtx);
        break;
      case '/api/risk-review':
        await handleRiskReview(res, serverCtx);
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
        handleAutoHarvest(res, serverCtx);
        break;
      case '/api/auto-harvest/trigger':
        handleAutoHarvestTrigger(req, res, serverCtx);
        break;
      case '/api/adaptive':
        handleAdaptive(res, serverCtx);
        break;
      case '/api/derivatives':
        handleDerivatives(res, serverCtx);
        break;
      case '/api/equity':
        await handleEquity(res, serverCtx);
        break;
      case '/api/discovery':
        handleDiscovery(res, serverCtx);
        break;
      case '/api/cache':
        handleCache(res, serverCtx);
        break;
      case '/api/yield':
        handleYield(res, serverCtx);
        break;
      case '/api/yield-rates':
        handleYieldRates(res, serverCtx);
        break;
      case '/api/dex-intelligence':
        handleDexIntelligence(res, serverCtx);
        break;
      case '/api/family':
        handleFamily(res, serverCtx);
        break;
      case '/api/family/members':
        handleFamilyMembers(res, serverCtx);
        break;
      case '/api/family/profiles':
        handleFamilyProfiles(res, serverCtx);
        break;
      case '/api/family/wallets':
        handleFamilyWallets(res, serverCtx);
        break;
      case '/api/admin/health-audit':
        handleHealthAudit(req, res, serverCtx);
        break;
      case '/api/win-rate-truth':
        handleWinRateTruth(res, serverCtx);
        break;
      case '/api/admin/correct-state':
        if (handleCorrectState(req, res, serverCtx)) return;
        break;
      case '/api/chat':
        if (handleChat(req, res, serverCtx)) return;
        break;
      case '/api/directives':
        handleDirectives(res, serverCtx);
        break;
      case '/api/confidence':
        handleConfidence(res, serverCtx);
        break;
      case '/api/model-telemetry':
        handleModelTelemetry(res, serverCtx);
        break;
      case '/api/ticker':
        handleTicker(res, serverCtx);
        break;
      case '/api/discovery/scan':
        // Manual trigger for token discovery scan
        if (tokenDiscoveryEngine) {
          tokenDiscoveryEngine.runScan().then(tokens => {
            sendJSON(res, 200, {
              scanned: true,
              tokensFound: tokens.length,
              state: tokenDiscoveryEngine!.getState(),
            });
          }).catch(err => {
            sendJSON(res, 500, { error: `Scan failed: ${(err as Error).message}` });
          });
          return; // async handler
        } else {
          sendJSON(res, 503, { error: 'Discovery engine not initialized' });
        }
        break;
      case '/api/simulate':
        handleSimulate(url, res, serverCtx);
        break;
      case '/api/strategy-versions':
        handleStrategyVersions(res, serverCtx);
        break;
      case '/api/paper-portfolios':
        handlePaperPortfolios(res, serverCtx);
        break;
      case '/api/export-results':
        handleExportResults(url, res, serverCtx);
        break;
      case '/api/version-backtest':
        handleVersionBacktest(url, res, serverCtx);
        break;
      case '/api/swarm-status':
        handleSwarmStatus(req, res, serverCtx);
        break;
      case '/api/signal-dashboard':
        handleSignalDashboard(res, serverCtx);
        break;
      case '/signals/latest':
        handleSignalsLatest(req, res, serverCtx);
        return;
      case '/api/withdraw':
        if (handleWithdraw(req, res, serverCtx)) return;
        break;
      case '/api/state-backup':
        handleStateBackup(req, res, serverCtx);
        break;
      case '/api/state-restore':
        if (handleStateRestore(req, res, serverCtx)) return;
        break;
      case '/api/recover-trades':
        // POST — trigger on-chain trade history recovery on demand
        if (req.method !== 'POST') { sendJSON(res, 405, { error: 'POST required' }); break; }
        (async () => {
          try {
            const before = state.tradeHistory.length;
            const result = await recoverOnChainTradeHistory(CONFIG.walletAddress);
            const after = state.tradeHistory.length;
            sendJSON(res, 200, {
              ok: true,
              recovered: result.recovered,
              merged: result.merged,
              tradesBefore: before,
              tradesAfter: after,
            });
          } catch (e: any) {
            sendJSON(res, 500, { error: `Recovery failed: ${e.message}` });
          }
        })();
        return;
      default: {
        // NVR-NL: DELETE /api/directives/:id — remove a directive
        if (url.pathname.startsWith('/api/directives/') && req.method === 'DELETE') {
          handleDeleteDirective(url, res, serverCtx);
          break;
        }
        // Handle dynamic route: /api/paper-portfolio/:id
        if (url.pathname.startsWith('/api/paper-portfolio/')) {
          handlePaperPortfolioById(url, res, serverCtx);
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
  // v19.6: Telegram startup notification (fire-and-forget)
  telegramService.onStartup(
    BOT_VERSION,
    state.trading.totalPortfolioValue,
    CONFIG.walletAddress
  ).catch(() => {});

  // v21.7: Background on-chain trade recovery — runs 30s after server starts so
  // healthcheck passes first. Merges any on-chain trades missing from persisted state
  // (e.g. trades made during an unstable deploy that didn't save to disk).
  // Safe: additive-only, no blocking, full error containment.
  setTimeout(() => {
    recoverOnChainTradeHistory(CONFIG.walletAddress)
      .then(result => {
        if (result.merged > 0) {
          console.log(`[Recovery] Backfilled ${result.merged} on-chain trades missing from state`);
          markStateDirty(true);
        } else {
          console.log(`[Recovery] On-chain history in sync — no gaps found (${result.recovered} chain trades checked)`);
        }
      })
      .catch(e => console.warn(`[Recovery] Background on-chain recovery skipped: ${e.message}`));
  }, 30_000);
});

// EMBEDDED_DASHBOARD — imported from src/dashboard/embedded-html.ts

// ============================================================================
// ENTRY POINT — must be at the very end after all declarations
// ============================================================================
main().catch((err) => {
  console.error("Fatal error:", err?.message || String(err));
  if (err?.stack) console.error(err.stack.split('\n').slice(0, 5).join('\n'));
  // v5.2: Try to save state even on fatal crash
  try { saveTradeHistory(); } catch (_) {}
  process.exit(1);
});


