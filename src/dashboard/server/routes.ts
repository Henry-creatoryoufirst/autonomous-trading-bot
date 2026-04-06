/**
 * Never Rest Capital — HTTP Server Route Handlers
 * Extracted from agent-v3.2.ts (Phase 13 refactor)
 *
 * All route handler logic for the dashboard/health/API server.
 * Dependencies injected via ServerContext — no module-level globals.
 */

import http from 'http';
import fs from 'fs';
import type { HarvestRecipient } from '../../core/types/state.js';
import type { ConfigDirective } from '../../simulation/strategy-config.js';
import { BOT_VERSION } from '../../core/config/constants.js';
import type { ConfidenceScore } from '../../simulation/types.js';
import { runConfidenceGate } from '../../../scripts/confidence-gate.js';
import { getModelTelemetry, getAgreementRate, type ModelTelemetry, type GemmaMode } from '../../core/services/model-client.js';
import { activeChain } from '../../core/config/chain-config.js';

// ============================================================================
// ServerContext — all monolith state/functions passed in from agent-v3.2.ts
// ============================================================================
export interface ServerContext {
  // State
  state: any;
  breakerState: any;
  CONFIG: any;
  cdpClient: any;
  CDP_ACCOUNT_NAME: string;

  // Constants
  CAPITAL_FLOOR_ABSOLUTE_USD: number;
  PRESERVATION_RING_BUFFER_SIZE: number;
  PRESERVATION_FG_ACTIVATE: number;
  PRESERVATION_FG_DEACTIVATE: number;
  PRESERVATION_CYCLE_MULTIPLIER: number;
  PRESERVATION_MIN_CONFLUENCE: number;
  PRESERVATION_MIN_SWARM_CONSENSUS: number;
  PRESERVATION_TARGET_CASH_PCT: number;
  BREAKER_CONSECUTIVE_LOSSES: number;
  BREAKER_PAUSE_HOURS: number;
  KELLY_FRACTION: number;
  KELLY_MIN_TRADES: number;
  KELLY_POSITION_CEILING_PCT: number;
  KELLY_SMALL_PORTFOLIO_CEILING_PCT: number;
  KELLY_POSITION_FLOOR_USD: number;
  GAS_REFUEL_THRESHOLD_ETH: number;
  ADAPTIVE_MIN_INTERVAL_SEC: number;
  ADAPTIVE_MAX_INTERVAL_SEC: number;
  EMERGENCY_INTERVAL_SEC: number;
  EMERGENCY_DROP_THRESHOLD: number;
  PORTFOLIO_SENSITIVITY_TIERS: any;
  SIGNAL_ENGINE: string;

  // Mutable monolith variables
  capitalPreservationMode: any;
  lastFearGreedValue: number;
  lastSuccessfulTradeAt: number;
  adaptiveCycle: any;
  cycleStats: any;
  lastSignalHealth: any;
  lastMomentumSignal: any;
  lastKnownETHBalance: number;
  lastGasRefuelTime: number;
  lastDerivativesData: any;
  lastDexIntelligence: any;
  dexIntelFetchCount: number;
  lastYieldAction: string | null;
  yieldCycleCount: number;
  lastYieldRates: any[];
  lastFamilyTradeResults: any[];
  latestSignals: any;
  signalCycleNumber: number;
  signalHistory: any[];
  signalMode: string;
  pendingConfigChanges: Map<string, any>;
  pendingWithdrawals: Map<string, { toAddress: string; amountUSD: number; token: string; createdAt: number }>;

  // Service instances
  derivativesEngine: any;
  commoditySignalEngine: any;
  equityEnabled: boolean;
  equityEngine: any;
  tokenDiscoveryEngine: any;
  cacheManager: any;
  cooldownManager: any;
  yieldEnabled: boolean;
  yieldOptimizer: any;
  aaveYieldService: any;
  morphoYieldService: any;
  geckoTerminalService: any;
  familyEnabled: boolean;
  familyManager: any;
  familyWalletManager: any;
  telegramService: any;

  // Dashboard API functions (already extracted to src/dashboard/api.ts)
  sendJSON: (res: http.ServerResponse, status: number, data: any, req?: http.IncomingMessage) => void;
  isAuthorized: (req: http.IncomingMessage) => boolean;
  getDashboardHTML: () => string;
  apiPortfolio: () => any;
  apiBalances: () => any;
  apiSectors: () => any;
  apiTrades: (limit: number, includeFailures: boolean) => any;
  apiDailyPnL: () => any;
  apiIndicators: () => any;
  apiIntelligence: () => any;
  apiPatterns: () => any;
  apiReviews: () => any;
  apiThresholds: () => any;
  getActiveDirectives: () => any[];
  addUserDirective: (...args: any[]) => any;
  removeUserDirective: (id: string) => boolean;
  applyConfigChanges: (parseResult: any, instruction: string) => any;
  getActiveConfigDirectives: () => any[];
  removeConfigDirective: (id: string) => boolean;
  handleChatRequest: (message: string, history: any[]) => Promise<any>;
  downsample: (data: any[], maxPoints: number) => any[];

  // Monolith functions
  getEffectiveKellyCeiling: (portfolioUSD: number) => number;
  getSignalStats: () => any;
  getLatestReport: () => any;
  getTrailingStopState: () => any[];
  calculateWinRateTruth: () => any;
  calculateTradePerformance: () => any;
  getLatestSwarmDecisions: () => any[];
  getLastSwarmRunTime: () => Date | null;
  triggerCircuitBreaker: (reason: string) => void;
  executeDailyPayout: () => Promise<void>;
  saveTradeHistory: () => void;
  loadTradeHistory: () => void;
  markStateDirty: (critical?: boolean) => void;
  flushStateIfDirty: (reason: string) => void;
  logError: (type: string, message: string, details?: any) => void;
  detectOnChainCapitalFlows: (walletAddress: string) => Promise<any>;
  sendUSDCTransfer: (account: any, to: string, amountUSDC: number) => Promise<string>;
  getERC20Balance: (tokenAddress: string, walletAddress: string, decimals: number) => Promise<number>;
  TOKEN_REGISTRY: any;
  isStrategyInstruction: (msg: string) => boolean;
  parseStrategyInstruction: (msg: string, ctx: any) => any;
  generatePaperExportHTML: (portfolio: any, detail: any) => string;

  // Simulation & strategy lab
  loadPriceHistory: () => any;
  DEFAULT_SIM_CONFIG: any;
  runSimulation: (cfg: any, history: any) => any;
  compareStrategies: (a: any, b: any, history: any) => any;
  STRATEGY_VERSIONS: any;
  getAllPaperPortfolios: () => any[];
  getPaperPortfolioSummary: (portfolio: any) => any;
  getPaperPortfolio: (id: string) => any;
  runAllVersionBacktestsFromDisk: (capital: number) => any[];
  summarizeBacktestResults: (results: any[]) => any[];
  generateBacktestMultiExportHTML: (summarized: any[]) => string;
  generateBacktestSingleExportHTML: (match: any) => string;
}

// ============================================================================
// Route handler: Dashboard + Health
// ============================================================================

export function handleDashboard(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(ctx.getDashboardHTML());
}

export function handleHealth(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  // v11.4.22: Healthcheck must return 200 quickly during startup so Railway doesn't kill the deploy.
  // Grace period: first 5 minutes always healthy. After that, require a recent cycle.
  const uptimeSec = (Date.now() - ctx.state.startTime.getTime()) / 1000;
  const lastCycleAge = ctx.state.trading.lastCheck ? (Date.now() - ctx.state.trading.lastCheck.getTime()) / 1000 : Infinity;
  const inStartupGrace = uptimeSec < 300; // 5 min grace
  // v21.1: Bumped from 600s to 1200s — 15-min cycles regularly exceed 600s,
  // causing false "degraded" that locked users out of the dashboard.
  const isHealthy = inStartupGrace || (lastCycleAge < 1200);

  // v21.3: Include trading status and blockers so health check reveals WHY bot isn't trading
  const healthBlockers: string[] = [];
  if (!ctx.CONFIG.trading.enabled) healthBlockers.push("TRADING_ENABLED is not 'true' — dry run mode");
  if (!ctx.cdpClient) healthBlockers.push("CDP client not initialized");
  const healthDrawdown = ctx.state.trading.peakValue > 0 ? ((ctx.state.trading.peakValue - ctx.state.trading.totalPortfolioValue) / ctx.state.trading.peakValue) * 100 : 0;
  if (healthDrawdown >= 20) healthBlockers.push(`Circuit breaker: ${healthDrawdown.toFixed(1)}% drawdown`);
  if (ctx.state.trading.totalPortfolioValue > 0 && ctx.state.trading.totalPortfolioValue < ctx.CAPITAL_FLOOR_ABSOLUTE_USD) healthBlockers.push(`Capital floor breach: $${ctx.state.trading.totalPortfolioValue.toFixed(2)}`);
  const timeSinceTradeHealth = Date.now() - ctx.lastSuccessfulTradeAt;
  const recentTradeCount = ctx.state.tradeHistory.filter((t: any) => t.success && t.action !== 'HOLD').length;

  ctx.sendJSON(res, isHealthy ? 200 : 503, {
    status: isHealthy ? "ok" : "degraded",
    version: BOT_VERSION,
    uptimeSec: Math.round(uptimeSec),
    lastCycleAgeSec: Math.round(lastCycleAge),
    inStartupGrace,
    tradingEnabled: ctx.CONFIG.trading.enabled,
    tradingMode: ctx.CONFIG.trading.enabled ? "LIVE" : "DRY_RUN",
    tradingBlockers: healthBlockers,
    totalTradesExecuted: recentTradeCount,
    hoursSinceLastTrade: Math.round(timeSinceTradeHealth / 3600000 * 10) / 10,
    portfolioValue: Math.round(ctx.state.trading.totalPortfolioValue * 100) / 100,
    drawdownPercent: Math.round(healthDrawdown * 10) / 10,
  });
}

// ============================================================================
// Route handler: /api/persistence
// ============================================================================

export function handlePersistence(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  const stateFileExists = fs.existsSync(ctx.CONFIG.logFile);
  let stateFileSize = 0;
  let stateFileModified = '';
  try {
    if (stateFileExists) {
      const stat = fs.statSync(ctx.CONFIG.logFile);
      stateFileSize = stat.size;
      stateFileModified = stat.mtime.toISOString();
    }
  } catch {}
  ctx.sendJSON(res, 200, {
    persistDir: process.env.PERSIST_DIR || '(not set)',
    stateFilePath: ctx.CONFIG.logFile,
    stateFileExists,
    stateFileSizeBytes: stateFileSize,
    stateFileModified,
    tradeHistoryCount: ctx.state.tradeHistory.length,
    costBasisCount: Object.keys(ctx.state.costBasis).length,
    breakerStateLoaded: ctx.breakerState.dailyBaseline.value > 0,
    version: BOT_VERSION,
  });
}

// ============================================================================
// Route handler: /api/preservation
// ============================================================================

export function handlePreservation(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  const _fgReadings = ctx.capitalPreservationMode.fearReadings;
  const _fgAvg6h = _fgReadings.length > 0
    ? _fgReadings.reduce((sum: number, v: number) => sum + v, 0) / _fgReadings.length
    : null;
  const _usdcBalPres = ctx.state.trading.balances.find((b: any) => b.symbol === 'USDC');
  const _portfolioTotal = ctx.state.trading.totalPortfolioValue || 0;
  const _cashAllocationPct = _portfolioTotal > 0 && _usdcBalPres
    ? (_usdcBalPres.usdValue / _portfolioTotal) * 100
    : 0;
  ctx.sendJSON(res, 200, {
    isActive: ctx.capitalPreservationMode.isActive,
    activatedAt: ctx.capitalPreservationMode.activatedAt
      ? new Date(ctx.capitalPreservationMode.activatedAt).toISOString()
      : null,
    durationHours: ctx.capitalPreservationMode.activatedAt
      ? ((Date.now() - ctx.capitalPreservationMode.activatedAt) / 3600000).toFixed(1)
      : null,
    currentFearGreed: ctx.lastFearGreedValue,
    fearGreedAvg6h: _fgAvg6h !== null ? Math.round(_fgAvg6h * 10) / 10 : null,
    fearGreedReadings: _fgReadings.length,
    fearGreedBufferFull: _fgReadings.length >= ctx.PRESERVATION_RING_BUFFER_SIZE,
    tradesBlocked: ctx.capitalPreservationMode.tradesBlocked,
    tradesPassed: ctx.capitalPreservationMode.tradesPassed,
    cashAllocationPct: Math.round(_cashAllocationPct * 10) / 10,
    cashTargetPct: ctx.PRESERVATION_TARGET_CASH_PCT,
    belowCashTarget: _cashAllocationPct < ctx.PRESERVATION_TARGET_CASH_PCT,
    thresholds: {
      activateBelow: ctx.PRESERVATION_FG_ACTIVATE,
      deactivateAbove: ctx.PRESERVATION_FG_DEACTIVATE,
      sustainedHours: 6,
      cycleMultiplier: ctx.PRESERVATION_CYCLE_MULTIPLIER,
      minConfluence: ctx.PRESERVATION_MIN_CONFLUENCE,
      minSwarmConsensus: ctx.PRESERVATION_MIN_SWARM_CONSENSUS,
    },
    totalDeactivations: ctx.capitalPreservationMode.deactivationCount,
    version: BOT_VERSION,
  }, req);
}

// ============================================================================
// Route handler: /api/capital-flows
// ============================================================================

export async function handleCapitalFlows(
  res: http.ServerResponse,
  ctx: ServerContext,
): Promise<void> {
  try {
    const flows = await ctx.detectOnChainCapitalFlows(ctx.CONFIG.walletAddress);
    const currentPortfolio = ctx.state.trading.totalPortfolioValue;
    ctx.sendJSON(res, 200, {
      version: BOT_VERSION,
      wallet: ctx.CONFIG.walletAddress,
      ...flows,
      currentPortfolio,
      truePnL: Math.round((currentPortfolio + flows.totalWithdrawn - flows.totalDeposited) * 100) / 100,
      truePnLPercent: flows.totalDeposited > 0
        ? Math.round(((currentPortfolio + flows.totalWithdrawn - flows.totalDeposited) / flows.totalDeposited) * 10000) / 100
        : 0,
    });
  } catch (e: any) {
    ctx.sendJSON(res, 500, { error: e.message });
  }
}

// ============================================================================
// Route handler: /api/errors
// ============================================================================

export function handleErrors(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  const failedTrades = ctx.state.tradeHistory.filter((t: any) => t.success === false);
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
  ctx.sendJSON(res, 200, {
    version: BOT_VERSION,
    summary: {
      totalAttempted: ctx.state.trading.totalTrades + failedTrades.length,
      totalSuccessful: ctx.state.trading.totalTrades,
      totalFailed: failedTrades.length,
      failureRate: failedTrades.length > 0 ? `${((failedTrades.length / (ctx.state.trading.totalTrades + failedTrades.length)) * 100).toFixed(1)}%` : '0%',
      errorsByType,
    },
    circuitBreakers: Object.entries(ctx.state.tradeFailures).map(([symbol, data]) => ({
      symbol,
      consecutiveFailures: (data as any).count,
      lastFailure: (data as any).lastFailure,
      blocked: (data as any).count >= 3,
    })),
    recentFailedTrades: recentFailures.map((t: any) => ({
      timestamp: t.timestamp,
      action: t.action,
      from: t.fromToken,
      to: t.toToken,
      amountUSD: t.amountUSD,
      error: t.error,
    })),
    errorLog: (ctx.state.errorLog || []).slice(-50).reverse(),
  });
}

// ============================================================================
// Route handler: /api/signals
// ============================================================================

export function handleSignals(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  if (!ctx.isAuthorized(req)) { res.writeHead(401); res.end('Unauthorized'); return; }
  const signalStats = ctx.getSignalStats();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    version: BOT_VERSION,
    ...signalStats,
  }, null, 2));
}

// ============================================================================
// Route handler: /api/weekly-report
// ============================================================================

export function handleWeeklyReport(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  if (!ctx.isAuthorized(req)) { res.writeHead(401); res.end('Unauthorized'); return; }
  const report = ctx.getLatestReport();
  if (!report) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: BOT_VERSION, message: 'No weekly report generated yet. Reports are generated every Sunday at UTC midnight.' }));
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: BOT_VERSION, ...report }, null, 2));
  }
}

// ============================================================================
// Route handler: /api/debug
// ============================================================================

export async function handleDebug(
  res: http.ServerResponse,
  ctx: ServerContext,
): Promise<void> {
  const apiKeyId = process.env.CDP_API_KEY_ID || process.env.CDP_API_KEY_NAME || '';
  const apiKeySecret = process.env.CDP_API_KEY_SECRET || process.env.CDP_API_KEY_PRIVATE_KEY || '';
  const walletSecret = process.env.CDP_WALLET_SECRET || '';
  const signalUrl = process.env.SIGNAL_URL || process.env.NVR_SIGNAL_URL || '';

  // Test CDP connection using the same method the bot uses for trading
  let cdpStatus = 'unknown';
  let cdpError = '';
  let walletAddress = '';
  try {
    if (ctx.cdpClient) {
      const account = await ctx.cdpClient.evm.getOrCreateAccount({ name: ctx.CDP_ACCOUNT_NAME });
      cdpStatus = 'connected';
      walletAddress = (account as any).address || 'account found but no address field';
    } else {
      cdpStatus = 'not_initialized';
    }
  } catch (e: any) {
    cdpStatus = 'error';
    cdpError = e.message || String(e);
    ctx.logError('CDP_CONNECTION_TEST', cdpError);
  }

  ctx.sendJSON(res, 200, {
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
    signalMode: ctx.signalMode,
    signalUrl: signalUrl || 'not configured',
    env: {
      NODE_ENV: process.env.NODE_ENV || 'not set',
      SIGNAL_MODE: process.env.SIGNAL_MODE || 'not set',
      ANTHROPIC_KEY_SET: !!process.env.ANTHROPIC_API_KEY,
      hasPayoutRecipients: !!(ctx.CONFIG.autoHarvest?.recipients?.length),
    },
    uptime: process.uptime(),
    totalCycles: ctx.state.totalCycles,
    lastCycleTime: ctx.state.lastCycleTime || null,
    tradingEnabled: ctx.CONFIG.trading.enabled,
    memory: {
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1048576),
      rssMB: Math.round(process.memoryUsage().rss / 1048576),
    },
  });
}

// ============================================================================
// Route handler: /api/accounts
// ============================================================================

export async function handleAccounts(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
): Promise<void> {
  if (!ctx.isAuthorized(req)) { ctx.sendJSON(res, 401, { error: 'Unauthorized' }); return; }
  try {
    if (!ctx.cdpClient) { ctx.sendJSON(res, 500, { error: 'CDP not initialized' }); return; }
    const allAccounts: any[] = [];
    let listResp = await ctx.cdpClient.evm.listAccounts();
    allAccounts.push(...listResp.accounts);
    while (listResp.nextPageToken) {
      listResp = await ctx.cdpClient.evm.listAccounts({ pageToken: listResp.nextPageToken });
      allAccounts.push(...listResp.accounts);
    }
    ctx.sendJSON(res, 200, {
      total: allAccounts.length,
      accounts: allAccounts.map((a: any) => ({
        name: a.name,
        address: a.address,
      })),
    });
  } catch (e: any) {
    ctx.sendJSON(res, 500, { error: e.message });
  }
}

// ============================================================================
// Route handler: /api/kill
// ============================================================================

export function handleKill(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  if (req.method !== 'POST') { ctx.sendJSON(res, 405, { error: 'POST required' }); return; }
  if (!ctx.isAuthorized(req)) { ctx.sendJSON(res, 401, { error: 'Unauthorized' }); return; }
  ctx.CONFIG.trading.enabled = false;
  ctx.triggerCircuitBreaker('KILL SWITCH activated via /api/kill');
  ctx.telegramService.onKillSwitch('API endpoint /api/kill').catch(() => {});
  console.error('\n🛑 KILL SWITCH ACTIVATED — All trading halted');
  ctx.sendJSON(res, 200, {
    status: 'killed',
    message: 'All trading halted immediately. Redeploy to resume.',
    timestamp: new Date().toISOString(),
  });
}

// ============================================================================
// Route handler: /api/resume
// ============================================================================

export function handleResume(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  if (req.method !== 'POST') { ctx.sendJSON(res, 405, { error: 'POST required' }); return; }
  if (!ctx.isAuthorized(req)) { ctx.sendJSON(res, 401, { error: 'Unauthorized' }); return; }
  ctx.CONFIG.trading.enabled = true;
  ctx.breakerState.lastBreakerTriggered = null;
  ctx.breakerState.lastBreakerReason = null;
  ctx.breakerState.consecutiveLosses = 0;
  ctx.breakerState.rollingTradeResults = [];
  console.log('\n✅ TRADING RESUMED via /api/resume');
  ctx.telegramService.sendAlert({
    severity: "INFO",
    title: "Trading Resumed",
    message: "Kill switch deactivated via /api/resume. Trading is active again.",
  }).catch(() => {});
  ctx.sendJSON(res, 200, {
    status: 'resumed',
    message: 'Trading re-enabled. Circuit breaker reset.',
    timestamp: new Date().toISOString(),
  });
}

// ============================================================================
// Route handler: /api/trailing-stops
// ============================================================================

export function handleTrailingStops(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  const tsState = ctx.getTrailingStopState();
  const balancesForTS = ctx.state.trading.balances || [];
  ctx.sendJSON(res, 200, {
    version: BOT_VERSION,
    count: tsState.length,
    stops: tsState.map((ts: any) => {
      const holding = balancesForTS.find((b: any) => b.symbol === ts.symbol);
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
}

// ============================================================================
// Route handler: /api/risk-review
// ============================================================================

export async function handleRiskReview(
  res: http.ServerResponse,
  ctx: ServerContext,
): Promise<void> {
  const ddState = (await import('../../services/risk-reviewer.js')).getDrawdownState();
  ctx.sendJSON(res, 200, {
    version: BOT_VERSION,
    drawdown: ddState,
    thresholds: {
      blockSeverity: 20,
      reduceSeverity: 10,
      dailyHaltPct: 5,
      weeklyDefensivePct: 10,
    },
  });
}

// ============================================================================
// Route handler: /api/auto-harvest
// ============================================================================

export function handleAutoHarvest(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  const nextPayoutDate = new Date();
  nextPayoutDate.setUTCHours(8, 0, 0, 0);
  if (nextPayoutDate.getTime() <= Date.now()) nextPayoutDate.setUTCDate(nextPayoutDate.getUTCDate() + 1);

  ctx.sendJSON(res, 200, {
    enabled: ctx.CONFIG.autoHarvest.enabled,
    mode: 'daily',
    thresholdUSD: ctx.CONFIG.autoHarvest.thresholdUSD,
    cooldownHours: ctx.CONFIG.autoHarvest.cooldownHours,
    minETHReserve: ctx.CONFIG.autoHarvest.minETHReserve,
    totalTransferredUSD: ctx.state.totalAutoHarvestedUSD + (ctx.state.totalDailyPayoutsUSD || 0),
    transferCount: (ctx.state.autoHarvestCount || 0) + (ctx.state.dailyPayoutCount || 0),
    totalTransfers: (ctx.state.autoHarvestTransfers || []).length,
    recentTransfers: (ctx.state.autoHarvestTransfers || []).slice(-5),
    lastHarvestTime: (ctx.state.lastAutoHarvestTime || null),
    recipients: (ctx.CONFIG.autoHarvest.recipients || []).map((r: HarvestRecipient) => ({
      label: r.label,
      wallet: r.wallet.slice(0, 6) + '...' + r.wallet.slice(-4),
      percent: r.percent,
      totalTransferred: (ctx.state.autoHarvestByRecipient[r.label] || 0) + (ctx.state.dailyPayoutByRecipient[r.label] || 0),
    })),
    reinvestPercent: 100 - (ctx.CONFIG.autoHarvest.recipients || []).reduce((s: number, r: HarvestRecipient) => s + r.percent, 0),
    dailyPayout: {
      lastPayoutDate: ctx.state.lastDailyPayoutDate,
      dailyPayoutCount: ctx.state.dailyPayoutCount,
      totalDailyPayoutsUSD: ctx.state.totalDailyPayoutsUSD,
      nextPayoutUTC: nextPayoutDate.toISOString(),
      recentPayouts: (ctx.state.dailyPayouts || []).slice(-7),
      byRecipient: ctx.state.dailyPayoutByRecipient || {},
    },
  });
}

// ============================================================================
// Route handler: /api/auto-harvest/trigger
// ============================================================================

export function handleAutoHarvestTrigger(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  if (!ctx.isAuthorized(req)) {
    ctx.sendJSON(res, 401, { error: 'Unauthorized — set API_AUTH_TOKEN env var and pass Bearer token' }, req);
    return;
  }
  if (ctx.CONFIG.autoHarvest.enabled) {
    ctx.sendJSON(res, 200, { message: 'Daily payout triggered manually' }, req);
    ctx.executeDailyPayout().catch((err: any) => console.error(`[Daily Payout] Manual trigger error: ${err?.message}`));
  } else {
    ctx.sendJSON(res, 400, { error: 'Auto-harvest is not enabled' }, req);
  }
}

// ============================================================================
// Route handler: /api/adaptive
// ============================================================================

export function handleAdaptive(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  ctx.sendJSON(res, 200, {
    version: BOT_VERSION,
    currentIntervalSec: ctx.adaptiveCycle.currentIntervalSec,
    volatilityLevel: ctx.adaptiveCycle.volatilityLevel,
    portfolioTier: ctx.adaptiveCycle.portfolioTier,
    dynamicPriceThreshold: ctx.adaptiveCycle.dynamicPriceThreshold,
    emergencyMode: ctx.adaptiveCycle.emergencyMode,
    emergencyUntil: ctx.adaptiveCycle.emergencyMode ? new Date(ctx.adaptiveCycle.emergencyUntil).toISOString() : null,
    priceStreamActive: ctx.adaptiveCycle.wsConnected,
    consecutiveLightCycles: ctx.adaptiveCycle.consecutiveLightCycles,
    cycleStats: {
      light: ctx.cycleStats.totalLight,
      heavy: ctx.cycleStats.totalHeavy,
      lastHeavyReason: ctx.cycleStats.lastHeavyReason,
    },
    institutionalBreaker: {
      consecutiveLosses: ctx.breakerState.consecutiveLosses,
      maxConsecutive: ctx.BREAKER_CONSECUTIVE_LOSSES,
      lastTriggered: ctx.breakerState.lastBreakerTriggered,
      lastReason: ctx.breakerState.lastBreakerReason,
      sizeReductionUntil: ctx.breakerState.breakerSizeReductionUntil,
      dailyBaseline: ctx.breakerState.dailyBaseline,
      weeklyBaseline: ctx.breakerState.weeklyBaseline,
      isPaused: ctx.breakerState.lastBreakerTriggered ? Date.now() < new Date(ctx.breakerState.lastBreakerTriggered).getTime() + (ctx.BREAKER_PAUSE_HOURS * 3600000) : false,
      isSizeReduced: ctx.breakerState.breakerSizeReductionUntil ? Date.now() < new Date(ctx.breakerState.breakerSizeReductionUntil).getTime() : false,
    },
    positionSizing: {
      method: 'QUARTER_KELLY',
      kellyFraction: ctx.KELLY_FRACTION,
      minTrades: ctx.KELLY_MIN_TRADES,
      ceilingPct: ctx.getEffectiveKellyCeiling(ctx.state.trading.totalPortfolioValue || 0),
      baseCeilingPct: ctx.KELLY_POSITION_CEILING_PCT,
      smallPortfolioCeilingPct: ctx.KELLY_SMALL_PORTFOLIO_CEILING_PCT,
      floorUSD: ctx.KELLY_POSITION_FLOOR_USD,
    },
    signalHealth: ctx.lastSignalHealth,
    momentum: {
      score: ctx.lastMomentumSignal.score,
      btcChange24h: ctx.lastMomentumSignal.btcChange24h,
      ethChange24h: ctx.lastMomentumSignal.ethChange24h,
      fearGreedValue: ctx.lastMomentumSignal.fearGreedValue,
      positionMultiplier: ctx.lastMomentumSignal.positionMultiplier,
      deploymentBias: ctx.lastMomentumSignal.deploymentBias,
      dataAvailable: ctx.lastMomentumSignal.dataAvailable,
    },
    smartAccount: {
      enabled: true,
      address: ctx.CONFIG.walletAddress,
      gasless: false,
      mode: 'COINBASE_SMART_WALLET',
    },
    gasTank: {
      ethBalance: ctx.lastKnownETHBalance,
      thresholdETH: ctx.GAS_REFUEL_THRESHOLD_ETH,
      lastRefuelTime: ctx.lastGasRefuelTime > 0 ? new Date(ctx.lastGasRefuelTime).toISOString() : null,
      autoRefuelEnabled: ctx.CONFIG.trading.enabled,
      status: ctx.lastKnownETHBalance >= ctx.GAS_REFUEL_THRESHOLD_ETH * 3 ? 'HEALTHY'
        : ctx.lastKnownETHBalance >= ctx.GAS_REFUEL_THRESHOLD_ETH ? 'LOW'
        : 'CRITICAL',
    },
    config: {
      minIntervalSec: ctx.ADAPTIVE_MIN_INTERVAL_SEC,
      maxIntervalSec: ctx.ADAPTIVE_MAX_INTERVAL_SEC,
      emergencyIntervalSec: ctx.EMERGENCY_INTERVAL_SEC,
      emergencyDropThreshold: ctx.EMERGENCY_DROP_THRESHOLD,
      portfolioTiers: ctx.PORTFOLIO_SENSITIVITY_TIERS,
    },
  });
}

// ============================================================================
// Route handler: /api/derivatives
// ============================================================================

export function handleDerivatives(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  ctx.sendJSON(res, 200, {
    enabled: ctx.derivativesEngine?.isEnabled() || false,
    state: ctx.derivativesEngine?.getState() || null,
    recentTrades: ctx.derivativesEngine?.getTradeHistory()?.slice(-20) || [],
    config: ctx.derivativesEngine?.getConfig() || null,
    commoditySignal: ctx.commoditySignalEngine?.getLastSignal() || null,
    lastCycleData: ctx.lastDerivativesData,
  });
}

// ============================================================================
// Route handler: /api/equity
// ============================================================================

export async function handleEquity(
  res: http.ServerResponse,
  ctx: ServerContext,
): Promise<void> {
  if (ctx.equityEnabled && ctx.equityEngine) {
    const eqDash = await ctx.equityEngine.getDashboardData();
    ctx.sendJSON(res, 200, eqDash);
  } else {
    ctx.sendJSON(res, 200, { enabled: false });
  }
}

// ============================================================================
// Route handler: /api/discovery
// ============================================================================

export function handleDiscovery(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  if (ctx.tokenDiscoveryEngine) {
    const discoveryState = ctx.tokenDiscoveryEngine.getState();
    ctx.sendJSON(res, 200, {
      ...discoveryState,
      tradableTokens: ctx.tokenDiscoveryEngine.getTradableTokens().length,
      topByVolume: ctx.tokenDiscoveryEngine.getDiscoveredTokens().slice(0, 10).map((t: any) => ({
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
    ctx.sendJSON(res, 200, { enabled: false });
  }
}

// ============================================================================
// Route handler: /api/cache
// ============================================================================

export function handleCache(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  ctx.sendJSON(res, 200, {
    stats: ctx.cacheManager.getStats(),
    cooldowns: {
      active: ctx.cooldownManager.getActiveCount(),
      summary: ctx.cooldownManager.getSummary(),
      entries: ctx.cooldownManager.getActiveCooldowns().map((e: any) => ({
        symbol: e.symbol,
        decision: e.decision,
        remainingMs: Math.max(0, e.cooldownMs - (Date.now() - e.decidedAt)),
      })),
    },
    cycleStats: ctx.cycleStats,
  });
}

// ============================================================================
// Route handler: /api/yield
// ============================================================================

export function handleYield(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  const aaveState = ctx.aaveYieldService.getState();
  const morphoState = ctx.morphoYieldService.getState();
  ctx.sendJSON(res, 200, {
    enabled: ctx.yieldEnabled,
    currentProtocol: ctx.yieldOptimizer.getCurrentProtocol(),
    totalDepositedUSDC: aaveState.depositedUSDC + morphoState.depositedUSDC,
    totalValueUSDC: aaveState.aTokenBalance + morphoState.currentValueUSDC,
    totalYieldEarned: aaveState.totalYieldEarned + morphoState.totalYieldEarned,
    aave: ctx.aaveYieldService.toJSON(),
    morpho: ctx.morphoYieldService.toJSON(),
    lastAction: ctx.lastYieldAction,
    yieldCycles: ctx.yieldCycleCount,
    optimizer: ctx.yieldOptimizer.toJSON(),
  });
}

// ============================================================================
// Route handler: /api/yield-rates
// ============================================================================

export function handleYieldRates(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  ctx.sendJSON(res, 200, {
    enabled: ctx.yieldEnabled,
    currentProtocol: ctx.yieldOptimizer.getCurrentProtocol(),
    rates: ctx.lastYieldRates.length > 0 ? ctx.lastYieldRates : ctx.yieldOptimizer.getRates(),
    aaveDeposited: ctx.aaveYieldService.getState().depositedUSDC,
    aaveBalance: ctx.aaveYieldService.getState().aTokenBalance,
    morphoDeposited: ctx.morphoYieldService.getDepositedUSDC(),
    morphoValue: ctx.morphoYieldService.getState().currentValueUSDC,
    totalYieldEarned: ctx.aaveYieldService.getState().totalYieldEarned + ctx.morphoYieldService.getState().totalYieldEarned,
    lastRateCheck: ctx.yieldOptimizer.getState().lastRateCheck,
    checkCount: ctx.yieldOptimizer.getCheckCount(),
    rebalanceCount: ctx.yieldOptimizer.getState().rebalanceCount,
  });
}

// ============================================================================
// Route handler: /api/dex-intelligence
// ============================================================================

export function handleDexIntelligence(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  if (ctx.lastDexIntelligence) {
    ctx.sendJSON(res, 200, {
      ...ctx.lastDexIntelligence,
      stats: ctx.geckoTerminalService.getStats(),
      fetchCount: ctx.dexIntelFetchCount,
    });
  } else {
    ctx.sendJSON(res, 200, {
      message: 'No DEX intelligence data yet — will be available after first heavy cycle',
      stats: ctx.geckoTerminalService.getStats(),
    });
  }
}

// ============================================================================
// Route handler: /api/family
// ============================================================================

export function handleFamily(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  ctx.sendJSON(res, 200, {
    enabled: ctx.familyEnabled,
    ...ctx.familyManager.toJSON(),
    wallets: ctx.familyWalletManager?.toJSON() || { totalWallets: 0, familyTotalValue: 0, wallets: [] },
    recentFamilyTrades: ctx.lastFamilyTradeResults.slice(-20),
  });
}

// ============================================================================
// Route handler: /api/family/members
// ============================================================================

export function handleFamilyMembers(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  ctx.sendJSON(res, 200, {
    members: ctx.familyManager.getMembers(),
    activeCount: ctx.familyManager.getActiveMembers().length,
  });
}

// ============================================================================
// Route handler: /api/family/profiles
// ============================================================================

export function handleFamilyProfiles(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  ctx.sendJSON(res, 200, {
    profiles: ctx.familyManager.getRiskProfiles(),
  });
}

// ============================================================================
// Route handler: /api/family/wallets
// ============================================================================

export function handleFamilyWallets(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  ctx.sendJSON(res, 200, ctx.familyWalletManager?.toJSON() || { totalWallets: 0, familyTotalValue: 0, wallets: [] });
}

// ============================================================================
// Route handler: /api/admin/health-audit
// ============================================================================

export function handleHealthAudit(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  if (!ctx.isAuthorized(req)) {
    ctx.sendJSON(res, 401, { error: 'Unauthorized — Bearer token required' });
    return;
  }
  const balancesForAudit = ctx.apiBalances();
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
    const cb = ctx.state.costBasis[b.symbol];
    const marketPrice = b.price || (b.balance > 0 ? b.usdValue / b.balance : 0);
    const flags: string[] = [];

    let unrealizedGainPct: number | null = null;
    let drawdownFromPeak: number | null = null;
    let holdingAgeDays: number | null = null;

    if (cb && cb.averageCostBasis > 0) {
      unrealizedGainPct = ((marketPrice - cb.averageCostBasis) / cb.averageCostBasis) * 100;

      if (unrealizedGainPct > 500) flags.push('STALE_COST_BASIS_LIKELY');
      else if (unrealizedGainPct > 200) flags.push('EXTREME_GAIN_REVIEW');

      if (marketPrice / cb.averageCostBasis > 10) flags.push('COST_10X_BELOW_MARKET');
      if (unrealizedGainPct < -80) flags.push('SEVERE_LOSS');
      if (cb.averageCostBasis <= 0) flags.push('ZERO_COST_BASIS');

      if (cb.peakPrice && cb.peakPrice > 0) {
        drawdownFromPeak = ((marketPrice - cb.peakPrice) / cb.peakPrice) * 100;
        if (drawdownFromPeak < -50) flags.push('PEAK_DRAWDOWN_50PCT');
      }

      if (cb.firstBuyDate) {
        holdingAgeDays = Math.round((Date.now() - new Date(cb.firstBuyDate).getTime()) / (1000 * 60 * 60 * 24));
        if (holdingAgeDays > 30 && b.usdValue < 5) flags.push('STALE_DUST_POSITION');
      }

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

  auditPositions.sort((a, b) => {
    if (a.flags.length > 0 && b.flags.length === 0) return -1;
    if (a.flags.length === 0 && b.flags.length > 0) return 1;
    return b.usdValue - a.usdValue;
  });

  const totalFlags = auditPositions.reduce((sum, p) => sum + p.flags.length, 0);

  ctx.sendJSON(res, 200, {
    timestamp: new Date().toISOString(),
    portfolioValue: balancesForAudit.totalValue,
    positionCount: auditPositions.length,
    flaggedPositions: auditPositions.filter(p => p.flags.length > 0).length,
    totalFlags,
    healthStatus: totalFlags === 0 ? 'HEALTHY' : totalFlags <= 2 ? 'REVIEW' : 'CRITICAL',
    positions: auditPositions,
    recentAlerts: (ctx.state.sanityAlerts || []).slice(-20),
    activeDedups: Object.entries(ctx.state.tradeDedupLog || {}).map(([key, ts]) => ({
      key,
      lastExecuted: ts,
      minutesAgo: Math.round((Date.now() - new Date(ts as string).getTime()) / (1000 * 60)),
    })),
    harvestCooldowns: Object.entries(ctx.state.profitTakeCooldowns).map(([key, ts]) => ({
      key,
      lastTrigger: ts,
      hoursAgo: Math.round((Date.now() - new Date(ts as string).getTime()) / (1000 * 60 * 60) * 10) / 10,
    })),
    stopLossCooldowns: Object.entries(ctx.state.stopLossCooldowns).map(([key, ts]) => ({
      symbol: key,
      lastTrigger: ts,
      hoursAgo: Math.round((Date.now() - new Date(ts as string).getTime()) / (1000 * 60 * 60) * 10) / 10,
    })),
  });
}

// ============================================================================
// Route handler: /api/win-rate-truth
// ============================================================================

export function handleWinRateTruth(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  const truth = ctx.calculateWinRateTruth();
  ctx.sendJSON(res, 200, {
    timestamp: new Date().toISOString(),
    disclaimer: "executionWinRate counts successful API calls. realizedWinRate counts trades where sellPrice > buyPrice. The gap between these two numbers is the honesty gap.",
    ...truth,
  });
}

// ============================================================================
// Route handler: /api/admin/correct-state (POST with streaming body)
// Returns true to indicate caller should NOT call res.end()
// ============================================================================

export function handleCorrectState(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
): boolean {
  if (req.method !== 'POST') {
    ctx.sendJSON(res, 405, { error: 'Method not allowed — use POST' });
    return false;
  }
  if (!ctx.isAuthorized(req)) {
    ctx.sendJSON(res, 401, { error: 'Unauthorized — Bearer token required' });
    return false;
  }
  // Read POST body (v11.4.17: bounded to 10KB to prevent DoS)
  let body = '';
  let bodyTooLarge = false;
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString();
    if (body.length > 10_000) { bodyTooLarge = true; req.destroy(); }
  });
  req.on('end', () => {
    if (bodyTooLarge) { ctx.sendJSON(res, 413, { error: 'Request body too large (max 10KB)' }); return; }
    try {
      const corrections = JSON.parse(body);
      const applied: string[] = [];
      const before = {
        peakValue: ctx.state.trading.peakValue,
        initialValue: ctx.state.trading.initialValue,
        totalDeposited: ctx.state.totalDeposited,
      };
      if (typeof corrections.peakValue === 'number') {
        ctx.state.trading.peakValue = corrections.peakValue;
        applied.push(`peakValue: ${before.peakValue.toFixed(2)} → ${corrections.peakValue.toFixed(2)}`);
      }
      if (typeof corrections.initialValue === 'number') {
        ctx.state.trading.initialValue = corrections.initialValue;
        applied.push(`initialValue: ${before.initialValue.toFixed(2)} → ${corrections.initialValue.toFixed(2)}`);
      }
      if (typeof corrections.totalDeposited === 'number') {
        ctx.state.totalDeposited = corrections.totalDeposited;
        applied.push(`totalDeposited: ${before.totalDeposited.toFixed(2)} → ${corrections.totalDeposited.toFixed(2)}`);
      }
      if (corrections.removeLastDeposit === true && ctx.state.depositHistory.length > 0) {
        const removed = ctx.state.depositHistory.pop();
        applied.push(`removed last deposit: $${removed?.amountUSD}`);
      }
      // v11.4.20: Explicit deposit registration
      if (typeof corrections.registerDeposit === 'number' && corrections.registerDeposit > 0) {
        const amt = corrections.registerDeposit;
        ctx.state.totalDeposited += amt;
        ctx.state.trading.peakValue += amt;
        if (ctx.breakerState.dailyBaseline.value > 0) ctx.breakerState.dailyBaseline.value += amt;
        if (ctx.breakerState.weeklyBaseline.value > 0) ctx.breakerState.weeklyBaseline.value += amt;
        ctx.state.depositHistory.push({
          timestamp: new Date().toISOString(),
          amountUSD: Math.round(amt * 100) / 100,
          newTotal: Math.round(ctx.state.totalDeposited * 100) / 100,
        });
        applied.push(`registerDeposit: +$${amt.toFixed(2)} (peak: $${ctx.state.trading.peakValue.toFixed(2)}, initial: $${ctx.state.trading.initialValue.toFixed(2)})`);
      }
      // v11.4.5: Reset cost basis to current market prices
      if (corrections.resetCostBasis) {
        const balances = ctx.apiBalances();
        const tokensToReset: string[] = Array.isArray(corrections.resetCostBasis)
          ? corrections.resetCostBasis
          : Object.keys(ctx.state.costBasis);
        for (const symbol of tokensToReset) {
          const cb = ctx.state.costBasis[symbol];
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
      // v11.4.5: Clear all harvest cooldowns
      if (corrections.clearHarvestCooldowns === true) {
        const count = Object.keys(ctx.state.profitTakeCooldowns).length;
        ctx.state.profitTakeCooldowns = {};
        applied.push(`clearHarvestCooldowns: cleared ${count} cooldown entries`);
      }
      // Recalculate derived values
      const drawdown = Math.max(0, ((ctx.state.trading.peakValue - ctx.state.trading.totalPortfolioValue) / ctx.state.trading.peakValue) * 100);
      ctx.markStateDirty();
      ctx.flushStateIfDirty('admin-correction');
      console.log(`\n🔧 ADMIN STATE CORRECTION applied:`);
      applied.forEach(a => console.log(`   ${a}`));
      ctx.sendJSON(res, 200, {
        message: 'State corrected successfully',
        applied,
        current: {
          peakValue: ctx.state.trading.peakValue,
          initialValue: ctx.state.trading.initialValue,
          totalDeposited: ctx.state.totalDeposited,
          totalPortfolioValue: ctx.state.trading.totalPortfolioValue,
          drawdown: drawdown.toFixed(2) + '%',
          depositCount: ctx.state.depositHistory.length,
        },
      });
    } catch (parseErr: any) {
      ctx.sendJSON(res, 400, { error: 'Invalid JSON body: ' + parseErr.message });
    }
  });
  return true; // Don't end response — it's handled in req.on('end')
}

// ============================================================================
// Route handler: /api/chat (POST with streaming body)
// Returns true to indicate caller should NOT call res.end()
// ============================================================================

export function handleChat(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
): boolean {
  if (req.method !== 'POST') { ctx.sendJSON(res, 405, { error: 'POST only' }); return false; }
  // v11.4.17: Bounded POST body (max 50KB for chat with history)
  let chatBody = '';
  let chatBodyTooLarge = false;
  req.on('data', (chunk: Buffer) => {
    chatBody += chunk.toString();
    if (chatBody.length > 50_000) { chatBodyTooLarge = true; req.destroy(); }
  });
  req.on('end', async () => {
    if (chatBodyTooLarge) { ctx.sendJSON(res, 413, { error: 'Request body too large (max 50KB)' }); return; }
    try {
      const { message, history } = JSON.parse(chatBody);
      if (!message || typeof message !== 'string') {
        ctx.sendJSON(res, 400, { error: 'message required' });
        return;
      }

      // NVR-NL: Check for "confirm" — apply pending config change
      const msgLower = message.toLowerCase().trim();
      if (msgLower === 'confirm' || msgLower === 'yes' || msgLower === 'apply') {
        const entries = [...ctx.pendingConfigChanges.entries()];
        if (entries.length > 0) {
          const [confId, pending] = entries[entries.length - 1];
          const directive = ctx.applyConfigChanges(pending.parseResult, pending.instruction);
          ctx.pendingConfigChanges.delete(confId);
          ctx.sendJSON(res, 200, {
            response: `Applied. ${pending.parseResult.summary}\n\nDirective ID: ${directive.id} (active for 24h). Say "list directives" to see all active changes.`,
            configApplied: true,
            directiveId: directive.id,
          });
          return;
        }
      }

      // NVR-NL: Try strategy config parser first (keyword matching, no AI needed)
      if (ctx.isStrategyInstruction(message)) {
        const parseResult = ctx.parseStrategyInstruction(message, {
          stopLossPercent: Math.abs(ctx.CONFIG.trading.stopLoss.percentThreshold),
          profitTakePercent: ctx.CONFIG.trading.profitTaking.targetPercent,
          tradingEnabled: ctx.CONFIG.trading.enabled,
        });

        if (parseResult.understood && parseResult.summary === 'QUERY') {
          // Fall through to normal chat handling below
        } else if (parseResult.understood && parseResult.summary === 'STRATEGY_QUERY') {
          const activeCfg = ctx.getActiveConfigDirectives();
          const cfgList = activeCfg.length > 0
            ? activeCfg.map((d: ConfigDirective, i: number) => `${i + 1}. "${d.instruction}" (${new Date(d.appliedAt).toLocaleString()})`).join('\n')
            : 'No active config directives — running default strategy.';
          ctx.sendJSON(res, 200, { response: `Current strategy config directives:\n${cfgList}` });
          return;
        } else if (parseResult.understood && parseResult.changes.length > 0) {
          if (parseResult.requiresConfirmation) {
            const confId = `cfgconf-${Date.now()}`;
            ctx.pendingConfigChanges.set(confId, { parseResult, instruction: message, createdAt: Date.now() });
            const changeList = parseResult.changes.map((c: any) => `  ${c.parameter}: ${c.oldValue} -> ${c.newValue}`).join('\n');
            ctx.sendJSON(res, 200, {
              response: `I understand. Here is what I will change:\n\n${parseResult.summary}\n\nDetails:\n${changeList}\n\nReply "confirm" to apply these changes.`,
              pendingConfirmation: true,
            });
            return;
          } else {
            const directive = ctx.applyConfigChanges(parseResult, message);
            ctx.sendJSON(res, 200, {
              response: `Done. ${parseResult.summary}\n\nDirective ID: ${directive.id} (active for 24h).`,
              configApplied: true,
              directiveId: directive.id,
            });
            return;
          }
        }
      }

      // NVR Central Mode: Chat fallback — no Claude API needed
      if (ctx.signalMode === 'central') {
        const portfolio = ctx.apiPortfolio();
        const perfStats = ctx.calculateTradePerformance();
        const totalValue = portfolio.totalValue || 0;
        const pnlPercent = portfolio.pnlPercent || 0;
        const winRate = portfolio.winRate || 0;
        const totalTrades = portfolio.totalTrades || 0;
        const usdcBal = (ctx.apiBalances().balances || []).find((b: any) => b.symbol === 'USDC');
        const usdcBalance = usdcBal?.balance || 0;
        const cashPct = totalValue > 0 ? ((usdcBalance / totalValue) * 100).toFixed(0) : '0';

        const activeCfgDirectives = ctx.getActiveConfigDirectives();
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

        ctx.sendJSON(res, 200, { response: summary });
        return;
      }

      const result = await ctx.handleChatRequest(message.substring(0, 500), history || []);
      ctx.sendJSON(res, 200, result);
    } catch (err: any) {
      console.error('[Chat API Error]', err.message, err.stack?.substring(0, 300));
      ctx.sendJSON(res, 500, { error: 'Chat request failed: ' + (err.message || 'unknown') });
    }
  });
  return true; // Don't end response here — it's handled in req.on('end')
}

// ============================================================================
// Route handler: /api/directives
// ============================================================================

export function handleDirectives(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  const activeUserDir = ctx.getActiveDirectives();
  const activeCfgDir = ctx.getActiveConfigDirectives();
  ctx.sendJSON(res, 200, {
    directives: activeUserDir.map((d: any) => ({
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
}

// ============================================================================
// Route handler: DELETE /api/directives/:id
// ============================================================================

export function handleDeleteDirective(
  url: URL,
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  const id = url.pathname.replace('/api/directives/', '');
  const removedUser = ctx.removeUserDirective(id);
  const removedConfig = ctx.removeConfigDirective(id);
  if (removedUser || removedConfig) {
    ctx.sendJSON(res, 200, { success: true, removed: id });
  } else {
    ctx.sendJSON(res, 404, { success: false, error: `Directive "${id}" not found` });
  }
}

// ============================================================================
// Route handler: /api/simulate
// ============================================================================

export function handleSimulate(
  url: URL,
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  try {
    const history = ctx.loadPriceHistory();
    const compare = url.searchParams.get('compare') === 'true';
    if (compare) {
      const configB: any = { ...ctx.DEFAULT_SIM_CONFIG };
      for (const [key, val] of url.searchParams.entries()) {
        if (key === 'compare') continue;
        if (key in configB) (configB as any)[key] = parseFloat(val);
      }
      const result = ctx.compareStrategies(ctx.DEFAULT_SIM_CONFIG, configB, history);
      ctx.sendJSON(res, 200, result);
    } else {
      const cfg: any = { ...ctx.DEFAULT_SIM_CONFIG };
      for (const [key, val] of url.searchParams.entries()) {
        if (key in cfg) (cfg as any)[key] = parseFloat(val);
      }
      const result = ctx.runSimulation(cfg, history);
      ctx.sendJSON(res, 200, { ...result, trades: result.trades.slice(-100), equityCurve: result.equityCurve.length > 500 ? ctx.downsample(result.equityCurve, 500) : result.equityCurve });
    }
  } catch (err: any) {
    ctx.sendJSON(res, 500, { error: `Simulation failed: ${err.message}` });
  }
}

// ============================================================================
// Route handler: /api/strategy-versions
// ============================================================================

export function handleStrategyVersions(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  ctx.sendJSON(res, 200, ctx.STRATEGY_VERSIONS);
}

// ============================================================================
// Route handler: /api/paper-portfolios
// ============================================================================

export function handlePaperPortfolios(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  const portfolios = ctx.getAllPaperPortfolios();
  ctx.sendJSON(res, 200, {
    portfolios: portfolios.map((p: any) => ctx.getPaperPortfolioSummary(p)),
    count: portfolios.length,
    liveValue: ctx.state.trading.totalPortfolioValue,
    liveReturnPct: ctx.state.trading.initialValue > 0
      ? ((ctx.state.trading.totalPortfolioValue - ctx.state.trading.initialValue) / ctx.state.trading.initialValue) * 100
      : 0,
  });
}

// ============================================================================
// Route handler: /api/paper-portfolio/:id (dynamic route)
// ============================================================================

export function handlePaperPortfolioById(
  url: URL,
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  const id = url.pathname.replace('/api/paper-portfolio/', '');
  const portfolio = ctx.getPaperPortfolio(id);
  if (portfolio) {
    ctx.sendJSON(res, 200, {
      ...ctx.getPaperPortfolioSummary(portfolio),
      trades: portfolio.trades.slice(-100),
      equityCurve: portfolio.equityCurve.length > 500
        ? portfolio.equityCurve.filter((_: any, i: number) => i === 0 || i === portfolio.equityCurve.length - 1 || i % Math.ceil(portfolio.equityCurve.length / 500) === 0)
        : portfolio.equityCurve,
    });
  } else {
    ctx.sendJSON(res, 404, { error: `Paper portfolio "${id}" not found` });
  }
}

// ============================================================================
// Route handler: /api/export-results
// ============================================================================

export function handleExportResults(
  url: URL,
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  const exportType = url.searchParams.get('type') || 'backtest';
  const exportVersion = url.searchParams.get('version');

  try {
    let html = '';

    if (exportType === 'backtest') {
      const capital = parseFloat(url.searchParams.get('capital') || '500');
      const results = ctx.runAllVersionBacktestsFromDisk(capital);
      const summarized = ctx.summarizeBacktestResults(results);
      html = ctx.generateBacktestMultiExportHTML(summarized);

    } else if (exportType === 'single' && exportVersion) {
      const capital = parseFloat(url.searchParams.get('capital') || '500');
      const results = ctx.runAllVersionBacktestsFromDisk(capital);
      const summarized = ctx.summarizeBacktestResults(results);
      const match = summarized.find((r: any) => r.version === exportVersion);
      if (!match) {
        ctx.sendJSON(res, 400, {
          error: `Unknown version: ${exportVersion}`,
          available: summarized.map((r: any) => r.version),
        });
        return;
      }
      html = ctx.generateBacktestSingleExportHTML(match);

    } else if (exportType === 'paper') {
      const portfolioId = url.searchParams.get('id');
      const allPortfolios = ctx.getAllPaperPortfolios();

      if (portfolioId) {
        const portfolio = ctx.getPaperPortfolio(portfolioId);
        if (!portfolio) {
          ctx.sendJSON(res, 404, {
            error: `Paper portfolio "${portfolioId}" not found`,
            available: allPortfolios.map((p: any) => p.id),
          });
          return;
        }
        const summary = ctx.getPaperPortfolioSummary(portfolio);
        const detail = {
          equityCurve: portfolio.equityCurve.length > 500
            ? portfolio.equityCurve.filter((_: any, i: number) => i === 0 || i === portfolio.equityCurve.length - 1 || i % Math.ceil(portfolio.equityCurve.length / 500) === 0)
            : portfolio.equityCurve,
        };
        html = ctx.generatePaperExportHTML(summary, detail);
      } else {
        if (allPortfolios.length === 0) {
          ctx.sendJSON(res, 404, { error: 'No paper portfolios available' });
          return;
        }
        const portfolio = allPortfolios[0];
        const summary = ctx.getPaperPortfolioSummary(portfolio);
        const detail = {
          equityCurve: portfolio.equityCurve.length > 500
            ? portfolio.equityCurve.filter((_: any, i: number) => i === 0 || i === portfolio.equityCurve.length - 1 || i % Math.ceil(portfolio.equityCurve.length / 500) === 0)
            : portfolio.equityCurve,
        };
        html = ctx.generatePaperExportHTML(summary, detail);
      }

    } else {
      ctx.sendJSON(res, 400, { error: 'Invalid type. Use: backtest, single (with version param), or paper (with optional id param)' });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
    res.end(html);
  } catch (err: any) {
    ctx.sendJSON(res, 500, { error: `Export failed: ${err.message}` });
  }
}

// ============================================================================
// Route handler: /api/version-backtest
// ============================================================================

export function handleVersionBacktest(
  url: URL,
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  try {
    const capital = parseFloat(url.searchParams.get('capital') || '500');
    const results = ctx.runAllVersionBacktestsFromDisk(capital);
    ctx.sendJSON(res, 200, {
      results: ctx.summarizeBacktestResults(results),
      count: results.length,
      runAt: new Date().toISOString(),
    });
  } catch (err: any) {
    ctx.sendJSON(res, 500, { error: `Version backtest failed: ${err.message}` });
  }
}

// ============================================================================
// Route handler: /api/swarm-status
// ============================================================================

export function handleSwarmStatus(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  const _swarmDecs = ctx.getLatestSwarmDecisions();
  const _swarmTime = ctx.getLastSwarmRunTime();
  ctx.sendJSON(res, 200, {
    engine: ctx.SIGNAL_ENGINE,
    agents: ['momentum', 'flow', 'risk', 'sentiment', 'trend'],
    lastRunTime: _swarmTime?.toISOString() || null,
    lastDecisions: _swarmDecs.map((d: any) => ({
      token: d.token, finalAction: d.finalAction, totalScore: d.totalScore, consensus: d.consensus,
      votes: d.votes.map((v: any) => ({ agent: v.agent, action: v.action, confidence: v.confidence, reasoning: v.reasoning, weight: v.weight })),
    })),
  }, req);
}

// ============================================================================
// Route handler: /api/signal-dashboard
// ============================================================================

export function handleSignalDashboard(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  const uptimeMs = Date.now() - ctx.state.startTime.getTime();
  const uptimeH = Math.floor(uptimeMs / 3600000);
  const uptimeM = Math.floor((uptimeMs % 3600000) / 60000);

  const statusMap: Record<string, string> = { producer: 'producing', central: 'consuming', local: 'local' };

  const sigs = ctx.latestSignals?.signals || [];
  const counts = { total: sigs.length, buy: 0, sell: 0, hold: 0, strongBuy: 0, strongSell: 0 };
  for (const s of sigs) {
    if (s.action === 'BUY') counts.buy++;
    else if (s.action === 'SELL') counts.sell++;
    else if (s.action === 'HOLD') counts.hold++;
    else if (s.action === 'STRONG_BUY') counts.strongBuy++;
    else if (s.action === 'STRONG_SELL') counts.strongSell++;
  }

  const lastTime = ctx.latestSignals?.timestamp || null;
  const signalAgeSec = lastTime ? Math.round((Date.now() - new Date(lastTime).getTime()) / 1000) : null;

  const actionOrder: Record<string, number> = { STRONG_BUY: 0, BUY: 1, HOLD: 2, SELL: 3, STRONG_SELL: 4 };
  const tokenSignals = sigs
    .map((s: any) => ({
      token: s.token,
      action: s.action,
      confluence: s.confluence,
      buyRatio: s.indicators?.buyRatio ?? null,
      rsi: s.indicators?.rsi14 ?? null,
      sector: s.sector || '',
      price: s.price,
      priceChange24h: s.priceChange24h,
    }))
    .sort((a: any, b: any) => (actionOrder[a.action] ?? 2) - (actionOrder[b.action] ?? 2));

  ctx.sendJSON(res, 200, {
    signalService: {
      status: statusMap[ctx.signalMode] || 'local',
      mode: ctx.signalMode,
      uptime: `${uptimeH}h ${uptimeM}m`,
      totalCyclesProduced: ctx.signalCycleNumber,
      lastSignalTime: lastTime,
      signalAgeSeconds: signalAgeSec,
    },
    currentSignals: counts,
    signalHistory: ctx.signalHistory.slice(-100),
    tokenSignals,
  });
}

// ============================================================================
// Route handler: /signals/latest
// ============================================================================

export function handleSignalsLatest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  const signalKey = req.headers['x-signal-key'];
  const expectedKey = process.env.SIGNAL_API_KEY;
  if (expectedKey && signalKey !== expectedKey) {
    ctx.sendJSON(res, 401, { error: 'Invalid signal key' });
    return;
  }

  if (!ctx.latestSignals) {
    ctx.sendJSON(res, 503, { error: 'No signals produced yet. Service is starting up.' });
    return;
  }

  const etag = `"cycle-${ctx.latestSignals.cycleNumber}"`;
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
  res.end(JSON.stringify(ctx.latestSignals));
}

// ============================================================================
// Route handler: /api/withdraw (POST with streaming body)
// Returns true to indicate caller should NOT call res.end()
// ============================================================================

export function handleWithdraw(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
): boolean {
  if (req.method !== 'POST') { ctx.sendJSON(res, 405, { error: 'POST only' }); return false; }
  if (!ctx.isAuthorized(req)) {
    ctx.sendJSON(res, 401, { error: 'Unauthorized — Bearer token required' });
    return false;
  }
  let withdrawBody = '';
  let withdrawBodyTooLarge = false;
  req.on('data', (chunk: Buffer) => {
    withdrawBody += chunk.toString();
    if (withdrawBody.length > 10_000) { withdrawBodyTooLarge = true; req.destroy(); }
  });
  req.on('end', async () => {
    if (withdrawBodyTooLarge) { ctx.sendJSON(res, 413, { error: 'Request body too large' }); return; }
    try {
      const body = JSON.parse(withdrawBody);
      const { toAddress, amountUSD, token: tokenParam, confirmationId, confirm } = body;
      const token = (tokenParam || 'USDC').toUpperCase();

      // Step 2: Confirm and execute a pending withdrawal
      if (confirmationId && confirm === true) {
        const pending = ctx.pendingWithdrawals.get(confirmationId);
        if (!pending) {
          ctx.sendJSON(res, 400, { success: false, error: 'Confirmation expired or invalid. Please start a new withdrawal.' });
          return;
        }
        ctx.pendingWithdrawals.delete(confirmationId);

        // Pause trading
        (ctx.state as any).withdrawPaused = true;
        console.log(`\n💸 [WITHDRAW] Executing: $${pending.amountUSD.toFixed(2)} ${pending.token} → ${pending.toAddress}`);

        try {
          const account = await ctx.cdpClient.evm.getOrCreateAccount({ name: ctx.CDP_ACCOUNT_NAME });
          let txHash: string;

          if (pending.token === 'USDC') {
            txHash = await ctx.sendUSDCTransfer(account, pending.toAddress, pending.amountUSD);
          } else {
            txHash = await ctx.sendUSDCTransfer(account, pending.toAddress, pending.amountUSD);
          }

          console.log(`[WITHDRAW] ✅ TX: ${txHash}`);
          console.log(`[WITHDRAW] 🔍 https://basescan.org/tx/${txHash}`);

          // Log withdrawal in trade history
          ctx.state.tradeHistory.push({
            timestamp: new Date().toISOString(),
            cycle: ctx.state.totalCycles,
            action: 'WITHDRAW' as any,
            fromToken: pending.token,
            toToken: 'EXTERNAL',
            amountUSD: pending.amountUSD,
            txHash,
            success: true,
            portfolioValueBefore: ctx.state.trading.totalPortfolioValue,
            reasoning: `Manual withdrawal: $${pending.amountUSD.toFixed(2)} ${pending.token} to ${pending.toAddress.slice(0, 6)}...${pending.toAddress.slice(-4)}`,
            marketConditions: { fearGreed: 0, ethPrice: 0, btcPrice: 0 },
          });
          if (ctx.state.tradeHistory.length > 5000) ctx.state.tradeHistory = ctx.state.tradeHistory.slice(-5000);

          // Adjust peak value like payouts do (prevent false drawdown triggers)
          if (ctx.state.trading.peakValue > pending.amountUSD) {
            ctx.state.trading.peakValue -= pending.amountUSD;
            if (ctx.breakerState.dailyBaseline.value > pending.amountUSD) ctx.breakerState.dailyBaseline.value -= pending.amountUSD;
            if (ctx.breakerState.weeklyBaseline.value > pending.amountUSD) ctx.breakerState.weeklyBaseline.value -= pending.amountUSD;
          }

          ctx.saveTradeHistory();
          (ctx.state as any).withdrawPaused = false;

          ctx.sendJSON(res, 200, {
            success: true,
            txHash,
            amountSent: pending.amountUSD,
            token: pending.token,
            toAddress: pending.toAddress,
          });
        } catch (err: any) {
          console.error(`[WITHDRAW] ❌ FAILED: ${err.message}`);
          (ctx.state as any).withdrawPaused = false;
          ctx.sendJSON(res, 500, { success: false, error: err.message || 'Transfer failed' });
        }
        return;
      }

      // Step 1: Validate and create pending confirmation
      if (!toAddress || typeof toAddress !== 'string') {
        ctx.sendJSON(res, 400, { success: false, error: 'Missing destination address (toAddress)' });
        return;
      }
      if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
        ctx.sendJSON(res, 400, { success: false, error: 'Invalid Ethereum address — must start with 0x and be 42 characters' });
        return;
      }
      if (!amountUSD || typeof amountUSD !== 'number' || amountUSD <= 0) {
        ctx.sendJSON(res, 400, { success: false, error: 'Amount must be a positive number' });
        return;
      }

      // Check available balance
      const walletAddr = ctx.CONFIG.walletAddress;
      const usdcBal = await ctx.getERC20Balance(ctx.TOKEN_REGISTRY.USDC.address, walletAddr, 6);
      const minReserve = 10;
      const maxWithdrawable = Math.max(0, usdcBal - minReserve);
      const portfolioTotal = ctx.state.trading.totalPortfolioValue || usdcBal;

      if (amountUSD > maxWithdrawable) {
        ctx.sendJSON(res, 400, {
          success: false,
          error: `Insufficient balance. Available: $${maxWithdrawable.toFixed(2)} USDC (keeping $${minReserve} reserve). Current balance: $${usdcBal.toFixed(2)}`,
          availableBalance: maxWithdrawable,
        });
        return;
      }

      // Safety guard: max 90% of total portfolio
      if (amountUSD > portfolioTotal * 0.9) {
        ctx.sendJSON(res, 400, {
          success: false,
          error: `Safety limit: Cannot withdraw more than 90% of total portfolio ($${(portfolioTotal * 0.9).toFixed(2)}). To withdraw more, contact admin.`,
          maxAllowed: Math.floor(portfolioTotal * 0.9 * 100) / 100,
        });
        return;
      }

      // Create confirmation
      const confId = `w-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      ctx.pendingWithdrawals.set(confId, {
        toAddress,
        amountUSD,
        token,
        createdAt: Date.now(),
      });

      console.log(`[WITHDRAW] Confirmation created: ${confId} — $${amountUSD.toFixed(2)} ${token} → ${toAddress.slice(0, 6)}...${toAddress.slice(-4)}`);

      ctx.sendJSON(res, 200, {
        success: true,
        confirmationId: confId,
        message: `Ready to send $${amountUSD.toFixed(2)} ${token} to ${toAddress}. Confirm within 5 minutes.`,
        amountUSD,
        token,
        toAddress,
        availableBalance: maxWithdrawable,
      });
    } catch (parseErr: any) {
      ctx.sendJSON(res, 400, { success: false, error: 'Invalid JSON body: ' + parseErr.message });
    }
  });
  return true; // Don't end response here — it's handled in req.on('end')
}

// ============================================================================
// Route handler: /api/state-backup
// ============================================================================

export function handleStateBackup(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  if (!ctx.isAuthorized(req)) {
    ctx.sendJSON(res, 401, { error: 'Unauthorized — Bearer token required' });
    return;
  }
  try {
    ctx.saveTradeHistory();
    const stateData = fs.readFileSync(ctx.CONFIG.logFile, 'utf-8');
    ctx.sendJSON(res, 200, {
      state: stateData,
      timestamp: Date.now(),
      version: BOT_VERSION,
      tradeCount: ctx.state.tradeHistory.length,
      costBasisCount: Object.keys(ctx.state.costBasis).length,
      filePath: ctx.CONFIG.logFile,
      fileSizeBytes: Buffer.byteLength(stateData, 'utf-8'),
    });
  } catch (e: any) {
    ctx.sendJSON(res, 500, { error: `Failed to export state: ${e.message}` });
  }
}

// ============================================================================
// Route handler: /api/state-restore (POST with streaming body)
// Returns true to indicate caller should NOT call res.end()
// ============================================================================

export function handleStateRestore(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
): boolean {
  if (req.method !== 'POST') { ctx.sendJSON(res, 405, { error: 'POST only' }); return false; }
  if (!ctx.isAuthorized(req)) {
    ctx.sendJSON(res, 401, { error: 'Unauthorized — Bearer token required' });
    return false;
  }
  let restoreBody = '';
  let restoreBodyTooLarge = false;
  req.on('data', (chunk: Buffer) => {
    restoreBody += chunk.toString();
    if (restoreBody.length > 50_000_000) { restoreBodyTooLarge = true; req.destroy(); }
  });
  req.on('end', () => {
    if (restoreBodyTooLarge) { ctx.sendJSON(res, 413, { error: 'Request body too large (50MB limit)' }); return; }
    try {
      const body = JSON.parse(restoreBody);
      const parsed = typeof body.state === 'string' ? JSON.parse(body.state) : body.state;

      if (!parsed.trades || !Array.isArray(parsed.trades)) {
        ctx.sendJSON(res, 400, { error: 'Invalid state: missing "trades" array' });
        return;
      }
      if (!parsed.costBasis || typeof parsed.costBasis !== 'object') {
        ctx.sendJSON(res, 400, { error: 'Invalid state: missing "costBasis" object' });
        return;
      }

      const dir = ctx.CONFIG.logFile.substring(0, ctx.CONFIG.logFile.lastIndexOf('/'));
      if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmpFile = ctx.CONFIG.logFile + '.tmp';
      fs.writeFileSync(tmpFile, typeof body.state === 'string' ? body.state : JSON.stringify(parsed, null, 2));
      fs.renameSync(tmpFile, ctx.CONFIG.logFile);

      const tradesBeforeRestore = ctx.state.tradeHistory.length;
      const positionsBeforeRestore = Object.keys(ctx.state.costBasis).length;
      ctx.loadTradeHistory();

      const tradesRestored = ctx.state.tradeHistory.length;
      const positionsRestored = Object.keys(ctx.state.costBasis).length;
      console.log(`[State] Restored from API: ${tradesRestored} trades, ${positionsRestored} positions (was: ${tradesBeforeRestore} trades, ${positionsBeforeRestore} positions)`);

      ctx.sendJSON(res, 200, {
        success: true,
        tradesRestored,
        positionsRestored,
        version: parsed.version || 'unknown',
        lastUpdated: parsed.lastUpdated || null,
      });
    } catch (e: any) {
      ctx.sendJSON(res, 400, { error: `Failed to restore state: ${e.message}` });
    }
  });
  return true; // Don't end response here — handled in req.on('end')
}

// ============================================================================
// Route handler: /api/confidence
// ============================================================================

let cachedConfidence: { score: ConfidenceScore; timestamp: number } | null = null;
const CONFIDENCE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function handleConfidence(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  try {
    // Return cached result if still fresh
    if (cachedConfidence && (Date.now() - cachedConfidence.timestamp) < CONFIDENCE_CACHE_TTL_MS) {
      ctx.sendJSON(res, 200, {
        ...cachedConfidence.score,
        cached: true,
        cachedAt: new Date(cachedConfidence.timestamp).toISOString(),
      });
      return;
    }

    const threshold = parseInt(process.env.CONFIDENCE_MIN || '60', 10);
    const gate = runConfidenceGate(threshold);

    cachedConfidence = { score: gate.score, timestamp: Date.now() };

    ctx.sendJSON(res, 200, {
      ...gate.score,
      cached: false,
      cachedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    ctx.sendJSON(res, 500, { error: `Confidence gate failed: ${err.message}` });
  }
}

// ============================================================================
// Route handler: /api/model-telemetry
// ============================================================================

export function handleModelTelemetry(
  res: http.ServerResponse,
  ctx: ServerContext,
): void {
  try {
    const telemetry = getModelTelemetry();
    const agreement = getAgreementRate();
    const gemmaMode = (process.env.GEMMA_MODE || 'disabled') as GemmaMode;

    // Compute stats from telemetry buffer
    const gemmaEntries = telemetry.filter(t => t.tier === 'GEMMA');
    const claudeEntries = telemetry.filter(t => t.tier === 'HAIKU' || t.tier === 'SONNET');
    const allEntries = telemetry;

    const gemmaAvgLatency = gemmaEntries.length > 0
      ? gemmaEntries.reduce((s, t) => s + t.latencyMs, 0) / gemmaEntries.length
      : 0;
    const claudeAvgLatency = claudeEntries.length > 0
      ? claudeEntries.reduce((s, t) => s + t.latencyMs, 0) / claudeEntries.length
      : 0;

    // Cost estimation: Haiku ~$0.0002/call, Sonnet ~$0.003/call, Gemma = $0
    const haikuCalls = telemetry.filter(t => t.tier === 'HAIKU').length;
    const sonnetCalls = telemetry.filter(t => t.tier === 'SONNET').length;
    const estimatedClaudeCost = (haikuCalls * 0.0002) + (sonnetCalls * 0.003);
    const estimatedSavings = gemmaEntries.length * 0.0002; // What those calls would have cost on Haiku

    // Determine current tier from most recent entry
    const lastEntry = allEntries[allEntries.length - 1];
    const currentTier = lastEntry?.tier || (gemmaMode !== 'disabled' ? 'GEMMA' : 'HAIKU');

    // Build escalation log from telemetry
    const escalations = telemetry
      .filter(t => t.escalated)
      .slice(-10)
      .map(t => ({
        timestamp: t.timestamp,
        reason: t.escalationReason || 'Unknown',
        fromModel: 'Gemma',
        toModel: t.model,
      }));

    ctx.sendJSON(res, 200, {
      currentTier,
      gemmaMode,
      agreementRate: Math.round(agreement.rate * 1000) / 10, // percentage with 1 decimal
      totalCycles: allEntries.length,
      gemmaCycles: gemmaEntries.length,
      claudeCycles: claudeEntries.length,
      gemmaAvgLatencyMs: Math.round(gemmaAvgLatency),
      claudeAvgLatencyMs: Math.round(claudeAvgLatency),
      estimatedSavingsUSD: Math.round(estimatedSavings * 100) / 100,
      monthlyClaudeCostUSD: Math.round(estimatedClaudeCost * 100) / 100,
      escalations,
      chain: activeChain.name.toLowerCase(),
      updatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    ctx.sendJSON(res, 500, { error: `Model telemetry failed: ${err.message}` });
  }
}
