/**
 * Never Rest Capital — Dashboard API Data Functions
 * Extracted from agent-v3.2.ts (Phase 7r refactor)
 *
 * API endpoint data functions + directive management + chat handler.
 * Dependencies injected via initDashboardAPI().
 */

import http from 'http';
import fs from 'fs';
import type { UserDirective, HarvestRecipient } from '../core/types/state.js';
import type { StrategyPattern, TokenCostBasis, SectorDefinition, MarketRegime, TradePerformanceStats } from '../core/types/index.js';
import type { MacroData, GlobalMarketData, NewsSentimentData, StablecoinSupplyData } from '../core/types/market-data.js';
import type { DefiLlamaData, DerivativesData, FundingRateMeanReversion, SmartRetailDivergence, TVLPriceDivergence } from '../algorithm/market-analysis.js';
import { parseStrategyInstruction, isStrategyInstruction, type ParseResult, type ConfigDirective } from '../core/services/strategy-config.js';
import {
  BOT_VERSION,
  AI_MODEL_ROUTINE,
  THRESHOLD_BOUNDS,
  ATR_STOP_FLOOR_PERCENT,
  ATR_STOP_CEILING_PERCENT,
  ATR_TRAIL_ACTIVATION_MULTIPLIER,
  CASH_DEPLOYMENT_THRESHOLD_PCT,
  CASH_DEPLOYMENT_TIERS,
  CASH_DEPLOYMENT_MIN_RESERVE_USD,
  CASH_DEPLOYMENT_CONFLUENCE_DISCOUNT,
  DEPLOYMENT_BREAKER_OVERRIDE_SIZE_MULT,
  DEPLOYMENT_BREAKER_OVERRIDE_MIN_CASH_PCT,
  DEPLOYMENT_BREAKER_OVERRIDE_MAX_ENTRIES,
} from '../core/config/constants.js';
import { SECTORS, TOKEN_REGISTRY } from '../core/config/token-registry.js';
import { EMBEDDED_DASHBOARD } from './embedded-html.js';

// Module-level deps — set by initDashboardAPI()
let state: any;
let breakerState: any;
let lastMomentumSignal: any;
let lastSignalHealth: any;
let lastMarketRegime: string;
let CONFIG: any;
let calculateTradePerformance: any;
let calculateWinRateTruth: any;
let signalHistory: any[];
let opportunityCostLog: any[];
let cumulativeMissedPnl: number;
let cumulativeMissedCount: number;
let shadowProposals: any[];
let anthropic: any;
let SYSTEM_PROMPT_CORE: string;
let SYSTEM_PROMPT_STRATEGY: string;
let tokenDiscoveryEngine: any;
let yieldOptimizer: any;
let DEFAULT_ADAPTIVE_THRESHOLDS: any;
let formatSelfImprovementPrompt: any;
let ALLOWED_ORIGINS: Set<string>;
let markStateDirty: (critical?: boolean) => void;
let getOpportunityCostSummary: () => any;
let getCashDeploymentMode: () => boolean;
let getCashDeploymentCycles: () => number;
let getCrashBuyingOverrideActive: () => boolean;
let getCrashBuyingOverrideCycles: () => number;
let getCurrentAltseasonSignal: () => any;

export function initDashboardAPI(deps: Record<string, any>) {
  state = deps.state;
  breakerState = deps.breakerState;
  lastMomentumSignal = deps.lastMomentumSignal;
  lastSignalHealth = deps.lastSignalHealth;
  lastMarketRegime = deps.lastMarketRegime;
  CONFIG = deps.CONFIG;
  calculateTradePerformance = deps.calculateTradePerformance;
  calculateWinRateTruth = deps.calculateWinRateTruth;
  signalHistory = deps.signalHistory;
  opportunityCostLog = deps.opportunityCostLog;
  cumulativeMissedPnl = deps.cumulativeMissedPnl;
  cumulativeMissedCount = deps.cumulativeMissedCount;
  shadowProposals = deps.shadowProposals;
  anthropic = deps.anthropic;
  SYSTEM_PROMPT_CORE = deps.SYSTEM_PROMPT_CORE;
  SYSTEM_PROMPT_STRATEGY = deps.SYSTEM_PROMPT_STRATEGY;
  tokenDiscoveryEngine = deps.tokenDiscoveryEngine;
  yieldOptimizer = deps.yieldOptimizer;
  DEFAULT_ADAPTIVE_THRESHOLDS = deps.DEFAULT_ADAPTIVE_THRESHOLDS;
  formatSelfImprovementPrompt = deps.formatSelfImprovementPrompt;
  ALLOWED_ORIGINS = deps.ALLOWED_ORIGINS;
  markStateDirty = deps.markStateDirty;
  getOpportunityCostSummary = deps.getOpportunityCostSummary;
  getCashDeploymentMode = deps.getCashDeploymentMode;
  getCashDeploymentCycles = deps.getCashDeploymentCycles;
  getCrashBuyingOverrideActive = deps.getCrashBuyingOverrideActive;
  getCrashBuyingOverrideCycles = deps.getCrashBuyingOverrideCycles;
  getCurrentAltseasonSignal = deps.getCurrentAltseasonSignal;
}

export function sendJSON(res: http.ServerResponse, status: number, data: any, req?: http.IncomingMessage) {
  const origin = req?.headers?.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.has(origin) ? origin : '';
  res.writeHead(status, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
  res.end(JSON.stringify(data));
}

/** Downsample an array to N evenly-spaced points (for equity curve API responses) */
export function downsample(arr: number[], n: number): number[] {
  if (arr.length <= n) return arr;
  const result: number[] = [];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) result.push(arr[Math.round(i * step)]);
  return result;
}

// v10.2: Auth token for sensitive endpoints. Auto-generates a random token if not set — never leave admin endpoints open.
const API_AUTH_TOKEN = process.env.API_AUTH_TOKEN || `auto-${Date.now()}-${Math.random().toString(36).substring(2, 14)}`;
if (!process.env.API_AUTH_TOKEN) console.warn(`⚠️  API_AUTH_TOKEN not set — auto-generated (set API_AUTH_TOKEN env var for stable access)`);
export function isAuthorized(req: http.IncomingMessage): boolean {
  const authHeader = req.headers['authorization'] || '';
  return authHeader === `Bearer ${API_AUTH_TOKEN}`;
}

/**
 * v6.2: Calculate risk-reward metrics from trade history.
 * Avg win size vs avg loss size tells you if the strategy is actually profitable
 * beyond just win rate. A 60% win rate with $5 avg wins and $15 avg losses = net negative.
 */
export function calculateRiskRewardMetrics(): {
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
  for (const [, cb] of Object.entries(state.costBasis) as [string, TokenCostBasis][]) {
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

export function apiPortfolio() {
  try {
  const uptime = Math.floor((Date.now() - state.startTime.getTime()) / 1000);
  const costBasisValues = Object.values(state.costBasis) as TokenCostBasis[];
  const totalRealized = costBasisValues.reduce((s, cb) => s + cb.realizedPnL, 0);
  const totalUnrealized = costBasisValues.reduce((s, cb) => s + cb.unrealizedPnL, 0);
  let riskReward: ReturnType<typeof calculateRiskRewardMetrics>;
  let perfStats: ReturnType<typeof calculateTradePerformance>;
  try {
    riskReward = calculateRiskRewardMetrics();
    perfStats = calculateTradePerformance();
  } catch {
    // v21.0: Graceful fallback when trade history is empty after restart
    riskReward = { avgWinUSD: 0, avgLossUSD: 0, riskRewardRatio: 0, largestWin: 0, largestLoss: 0, expectancy: 0, profitFactor: 0 };
    perfStats = { winRate: 0, avgWinPercent: 0, avgLossPercent: 0, avgHoldTimeMinutes: 0, totalRealizedPnL: totalRealized, profitableTrades: 0, unprofitableTrades: 0 } as any;
  }
  // v11.4.20: Daily P&L — use start-of-day baseline
  const dailyBaseline = breakerState.dailyBaseline.value;
  const dailyPnl = dailyBaseline > 0 ? state.trading.totalPortfolioValue - dailyBaseline : 0;
  const dailyPnlPercent = dailyBaseline > 0 ? (dailyPnl / dailyBaseline) * 100 : 0;
  // v20.3: Use on-chain deposits as source of truth for P&L (not stale initialValue)
  // v21.0: Fallback to INITIAL_DEPOSIT_USD env var for CDP-provisioned wallets
  // CDP deposits don't show as standard ERC-20 transfers on Blockscout,
  // so on-chain detection returns $0. The env var is set during onboarding.
  const effectiveDeposited = state.totalDeposited > 0
    ? state.totalDeposited
    : parseFloat(process.env.INITIAL_DEPOSIT_USD || '0');
  const effectiveWithdrawn = state.onChainWithdrawn;
  // truePnL = current portfolio + withdrawn profits - total deposited
  const netCapitalIn = effectiveDeposited - effectiveWithdrawn;
  const truePnL = effectiveDeposited > 0
    ? Math.round((state.trading.totalPortfolioValue + effectiveWithdrawn - effectiveDeposited) * 100) / 100
    : dailyPnl;
  const truePnLPercent = effectiveDeposited > 0
    ? Math.round(((state.trading.totalPortfolioValue + effectiveWithdrawn - effectiveDeposited) / effectiveDeposited) * 10000) / 100
    : dailyPnlPercent;
  // initialValue should reflect total capital injected, not first-startup snapshot
  const effectiveInitialValue = effectiveDeposited > 0 ? netCapitalIn : state.trading.initialValue;
  return {
    totalValue: state.trading.totalPortfolioValue,
    initialValue: effectiveInitialValue,
    peakValue: state.trading.peakValue,
    pnl: truePnL,
    pnlPercent: truePnLPercent,
    dailyPnl,
    dailyPnlPercent,
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
    // v19.5.0 + v21.0: Capital flows — uses INITIAL_DEPOSIT_USD fallback for CDP wallets
    totalDeposited: effectiveDeposited,
    totalWithdrawn: effectiveWithdrawn,
    netCapitalIn: Math.round(netCapitalIn * 100) / 100,
    depositCount: state.depositHistory.length || (effectiveDeposited > 0 ? 1 : 0),
    recentDeposits: state.depositHistory.slice(-5),
    // True P&L = current portfolio + withdrawn - deposited
    truePnL,
    truePnLPercent,
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
      active: getCashDeploymentMode(),
      cyclesActive: getCashDeploymentCycles(),
      thresholdPercent: CASH_DEPLOYMENT_THRESHOLD_PCT, // v21.0: always 20%, F&G is info-only
      baseThresholdPercent: CASH_DEPLOYMENT_THRESHOLD_PCT,
      tiers: CASH_DEPLOYMENT_TIERS,
      confluenceDiscount: CASH_DEPLOYMENT_CONFLUENCE_DISCOUNT,
      minReserveUSD: CASH_DEPLOYMENT_MIN_RESERVE_USD,
    },
    // v17.0: Breaker override status (flow-based, not F&G-based)
    crashBuyingOverride: {
      active: getCrashBuyingOverrideActive(),
      cyclesActive: getCrashBuyingOverrideCycles(),
      cashThresholdPct: DEPLOYMENT_BREAKER_OVERRIDE_MIN_CASH_PCT,
      sizeMultiplier: DEPLOYMENT_BREAKER_OVERRIDE_SIZE_MULT,
      maxEntriesPerCycle: DEPLOYMENT_BREAKER_OVERRIDE_MAX_ENTRIES,
      note: 'v17.0: Flow-based — activates on cash level, requires positive buy ratio per token',
    },
    // v20.2: Opportunity cost tracker — shows what the bot missed by holding cash
    opportunityCost: getOpportunityCostSummary ? getOpportunityCostSummary() : null,
    // v11.4.22: On-chain recovery diagnostic
    _recovery: (state as any)._recoveryStatus || 'not run',
    _recoveryWallet: (state as any)._recoveryWallet || 'unknown',
  };
  } catch (err: any) {
    // v21.0: Graceful fallback — return minimal portfolio data instead of 500 error
    console.error(`apiPortfolio() error: ${err.message}`);
    const totalFromBalances = state.trading.balances.reduce((s, b) => s + (b.usdValue || 0), 0);
    const fallbackDeposited = state.totalDeposited > 0
      ? state.totalDeposited
      : parseFloat(process.env.INITIAL_DEPOSIT_USD || '0');
    const fallbackPnL = fallbackDeposited > 0
      ? Math.round((totalFromBalances - fallbackDeposited) * 100) / 100
      : 0;
    const fallbackPnLPct = fallbackDeposited > 0
      ? Math.round((fallbackPnL / fallbackDeposited) * 10000) / 100
      : 0;
    return {
      totalValue: totalFromBalances,
      pnl: fallbackPnL,
      pnlPercent: fallbackPnLPct,
      truePnL: fallbackPnL,
      truePnLPercent: fallbackPnLPct,
      totalDeposited: fallbackDeposited,
      totalTrades: state.trading.totalTrades,
      totalCycles: state.totalCycles,
      version: BOT_VERSION,
      uptime: `${Math.floor((Date.now() - state.startTime.getTime()) / 3600000)}h`,
    };
  }
}

export function apiBalances() {
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

export function apiSectors() {
  return {
    allocations: state.trading.sectorAllocations,
    totalValue: state.trading.totalPortfolioValue,
  };
}

export function apiTrades(limit: number, includeFailures: boolean = false) {
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
export function getActiveDirectives(): UserDirective[] {
  const directives = state.userDirectives || [];
  const now = new Date().toISOString();
  return directives.filter(d => !d.expiresAt || d.expiresAt > now);
}

// v11.4.16: Add a user directive from chat
export function addUserDirective(directive: Omit<UserDirective, 'id' | 'createdAt'>): UserDirective {
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
export function removeUserDirective(id: string): boolean {
  if (!state.userDirectives) return false;
  const before = state.userDirectives.length;
  state.userDirectives = state.userDirectives.filter(d => d.id !== id);
  return state.userDirectives.length < before;
}

// NVR-NL: Apply parsed config changes as config directives + user directives
export function applyConfigChanges(parseResult: ParseResult, instruction: string): ConfigDirective {
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
  markStateDirty();
  return directive;
}

// NVR-NL: Get active config directives
export function getActiveConfigDirectives(): ConfigDirective[] {
  const directives = state.configDirectives || [];
  const now = new Date().toISOString();
  return directives.filter((d: ConfigDirective) => d.active && (!d.expiresAt || d.expiresAt > now));
}

// NVR-NL: Remove a config directive by ID
export function removeConfigDirective(id: string): boolean {
  if (!state.configDirectives) return false;
  const directive = state.configDirectives.find((d: ConfigDirective) => d.id === id);
  if (!directive) return false;
  directive.active = false;
  console.log(`[NL Config] Removed config directive: ${id}`);
  markStateDirty();
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
        token: { type: 'string', description: 'Token symbol to avoid (e.g. DEGEN, BRETT)' },
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
export function executeChatTool(toolName: string, input: any): { result: string; directive?: UserDirective } {
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

export async function handleChatRequest(userMessage: string, history: { role: string; content: string }[]) {
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

  const sectorInfo = (Object.entries(SECTORS) as unknown as [string, SectorDefinition][]).map(([key, s]) =>
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
  // v20.5: Chat uses Haiku — dashboard queries don't need Sonnet-level intelligence
  console.log(`  [AI] Using Haiku (chat) for dashboard query`);
  const chatCallPromise = anthropic.messages.create({
    model: AI_MODEL_ROUTINE,
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
export function apiDailyPnL() {
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
  const totalUnrealized = (Object.values(state.costBasis) as TokenCostBasis[]).reduce((s, cb) => s + cb.unrealizedPnL, 0);

  return { days, unrealized: Math.round(totalUnrealized * 100) / 100 };
}

export function apiIndicators() {
  // Build a price lookup from current balances
  const priceLookup: Record<string, number> = {};
  for (const b of state.trading.balances) {
    if (b.price && b.price > 0) priceLookup[b.symbol] = b.price;
  }

  return {
    costBasis: (Object.values(state.costBasis) as TokenCostBasis[])
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

export function apiIntelligence() {
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
    altseasonSignal: getCurrentAltseasonSignal ? getCurrentAltseasonSignal() : null,
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
export function apiPatterns() {
  const patterns = Object.values(state.strategyPatterns) as StrategyPattern[];
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

export function apiReviews() {
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

export function apiThresholds() {
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

export function getDashboardHTML(): string {
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
