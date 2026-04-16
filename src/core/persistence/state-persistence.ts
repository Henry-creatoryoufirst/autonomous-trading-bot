/**
 * NVR Capital — State Persistence Engine
 *
 * Extracted from agent-v3.2.ts (Phase 2b refactor).
 * Owns all state save/load operations:
 *   - loadTradeHistory() — restore full agent state from disk
 *   - saveTradeHistory() — write agent state to disk (atomic)
 *   - markStateDirty / flushStateIfDirty — dirty-flag batching system
 *
 * State exposed via getState() / getBreakerState() from src/core/state/store.ts.
 * Service dependencies injected via initPersistence() at bot startup.
 */

import * as fs from 'fs';
import {
  getState,
  getBreakerState,
  isStateDirty,
  clearDirtyFlag,
  markStateDirty as _storeMarkDirty,
} from '../state/index.js';
import { getShadowProposals, setShadowProposals, DEFAULT_ADAPTIVE_THRESHOLDS, DEFAULT_EXPLORATION_STATE } from '../self-improvement/index.js';
import { getStablecoinSupplyHistory, setStablecoinSupplyHistory } from '../data/on-chain-prices.js';
import {
  BOT_VERSION,
  MAX_CONSECUTIVE_FAILURES,
  FAILURE_COOLDOWN_HOURS,
  ATR_STOP_LOSS_MULTIPLIER,
  ATR_TRAILING_STOP_MULTIPLIER,
  THRESHOLD_BOUNDS,
  BREAKER_PAUSE_HOURS,
  BREAKER_CONSECUTIVE_LOSSES,
  KELLY_MIN_TRADES,
} from '../config/constants.js';
import type { BreakerState } from '../types/state.js';

// ============================================================================
// DEFAULT STATE OBJECTS
// ============================================================================

export const DEFAULT_BREAKER_STATE: BreakerState = {
  consecutiveLosses: 0,
  lastBreakerTriggered: null,
  lastBreakerReason: null,
  breakerSizeReductionUntil: null,
  dailyBaseline: { date: '', value: 0 },
  dailyBaselineValidated: false,
  weeklyBaseline: { weekStart: '', value: 0 },
  rollingTradeResults: [],
};

// ============================================================================
// SERVICE DEPENDENCIES — injected via initPersistence()
// ============================================================================

interface YieldService {
  restoreState: (s: any) => void;
  getState: () => any;
}

export interface PersistenceServices {
  /** Path to the primary trades JSON file (CONFIG.logFile) */
  logFile: string;
  /** Fallback log files to try on load (e.g. legacy trades-v3.1.json) */
  fallbackLogFiles?: string[];
  aaveYieldService: YieldService;
  morphoYieldService: YieldService;
  /** Returns current token discovery state (or null if not initialized) */
  getTokenDiscoveryState: () => any;
  /** Restore trailing stops from disk */
  loadTrailingStops: () => void;
  /** Save trailing stops to disk */
  saveTrailingStops: () => void;
  /** Rebuild cost basis from trade array on startup */
  rebuildCostBasisFromTrades: (trades: any[]) => void;
  /** Get the agent-level fundingRateHistory variable */
  getFundingRateHistory: () => { btc: number[]; eth: number[] };
  /** Set the agent-level fundingRateHistory variable */
  setFundingRateHistory: (h: { btc: number[]; eth: number[] }) => void;
  /** Get the agent-level btcDominanceHistory variable */
  getBtcDominanceHistory: () => { values: Array<{ timestamp: string; dominance: number }> };
  /** Set the agent-level btcDominanceHistory variable */
  setBtcDominanceHistory: (h: { values: Array<{ timestamp: string; dominance: number }> }) => void;
}

let _svc: PersistenceServices | null = null;

export function initPersistence(services: PersistenceServices): void {
  _svc = services;
}

function svc(): PersistenceServices {
  if (!_svc) throw new Error('[persistence] initPersistence() was not called before persistence operations');
  return _svc;
}

// ============================================================================
// LOAD — restore full agent state from disk
// ============================================================================

export function loadTradeHistory(): void {
  const { logFile, fallbackLogFiles = [], aaveYieldService, morphoYieldService, loadTrailingStops, rebuildCostBasisFromTrades } = svc();
  const state = getState();

  try {
    const logFiles = [logFile, ...fallbackLogFiles];
    for (const file of logFiles) {
      if (!fs.existsSync(file)) continue;

      const data = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(data);

      state.tradeHistory = parsed.trades || [];
      state.trading.initialValue = parsed.initialValue || 0;
      state.trading.peakValue = parsed.peakValue || 0;
      (state.trading as any).maxDrawdownPercent = parsed.maxDrawdownPercent || 0;
      state.trading.totalTrades = parsed.totalTrades || 0;
      state.trading.successfulTrades = parsed.successfulTrades || 0;

      // Lifetime counters (persisted separately from capped trade array)
      if (parsed.lifetimeTotalTrades && parsed.lifetimeTotalTrades > state.trading.totalTrades) {
        state.trading.totalTrades = parsed.lifetimeTotalTrades;
      }
      if (parsed.lifetimeSuccessfulTrades && parsed.lifetimeSuccessfulTrades > state.trading.successfulTrades) {
        state.trading.successfulTrades = parsed.lifetimeSuccessfulTrades;
      }

      if (parsed.currentValue && parsed.currentValue > 0) state.trading.totalPortfolioValue = parsed.currentValue;
      if (parsed.sectorAllocations) state.trading.sectorAllocations = parsed.sectorAllocations;

      state.costBasis = parsed.costBasis || {};
      state.profitTakeCooldowns = parsed.profitTakeCooldowns || {};
      state.stopLossCooldowns = parsed.stopLossCooldowns || {};
      state.tradeFailures = parsed.tradeFailures || {};

      // Expire stale trade failures on startup
      if (Object.keys(state.tradeFailures).length > 0) {
        const active = Object.entries(state.tradeFailures).filter(([, f]: [string, any]) => {
          const hours = (Date.now() - new Date(f.lastFailure).getTime()) / 3_600_000;
          return hours < FAILURE_COOLDOWN_HOURS && f.count >= MAX_CONSECUTIVE_FAILURES;
        });
        if (active.length > 0) {
          console.log(`  🚫 ${active.length} token(s) still blocked: ${active.map(([s, f]: [string, any]) => `${s}(${f.count} fails)`).join(', ')}`);
        }
        for (const [sym, f] of Object.entries(state.tradeFailures)) {
          const hours = (Date.now() - new Date((f as any).lastFailure).getTime()) / 3_600_000;
          if (hours >= FAILURE_COOLDOWN_HOURS) delete state.tradeFailures[sym];
        }
      }

      state.harvestedProfits = parsed.harvestedProfits || { totalHarvested: 0, harvestCount: 0, harvests: [] };

      // Phase 3 fields
      state.strategyPatterns = parsed.strategyPatterns || {};
      if (parsed.adaptiveThresholds) {
        state.adaptiveThresholds = { ...DEFAULT_ADAPTIVE_THRESHOLDS, ...parsed.adaptiveThresholds };
      }

      // Clamp stop-loss thresholds — persisted state may have self-tightened causing churn
      if (state.adaptiveThresholds.stopLossPercent > -12) {
        console.log(`  🔧 Widening persisted stop-loss from ${state.adaptiveThresholds.stopLossPercent}% → -15% (was too tight)`);
        state.adaptiveThresholds.stopLossPercent = -15;
      }
      if (state.adaptiveThresholds.trailingStopPercent > -10) {
        console.log(`  🔧 Widening persisted trailing stop from ${state.adaptiveThresholds.trailingStopPercent}% → -12% (was too tight)`);
        state.adaptiveThresholds.trailingStopPercent = -12;
      }

      // Force lower confluence thresholds until self-improvement has enough data
      if (state.trading.totalTrades < KELLY_MIN_TRADES) {
        state.adaptiveThresholds.confluenceBuy = Math.min(state.adaptiveThresholds.confluenceBuy, 8);
        state.adaptiveThresholds.confluenceSell = Math.max(state.adaptiveThresholds.confluenceSell, -8);
        state.adaptiveThresholds.confluenceStrongBuy = Math.min(state.adaptiveThresholds.confluenceStrongBuy, 30);
        state.adaptiveThresholds.confluenceStrongSell = Math.max(state.adaptiveThresholds.confluenceStrongSell, -30);
        state.adaptiveThresholds.regimeMultipliers = { ...DEFAULT_ADAPTIVE_THRESHOLDS.regimeMultipliers };
        console.log(`  📊 Bootstrap mode: Lowered confluence thresholds (buy≥${state.adaptiveThresholds.confluenceBuy}) until ${KELLY_MIN_TRADES} trades reached`);
      }

      state.performanceReviews = (parsed.performanceReviews || []).slice(-30);
      state.explorationState = parsed.explorationState || { ...DEFAULT_EXPLORATION_STATE };
      state.lastReviewTradeIndex = parsed.lastReviewTradeIndex || 0;
      state.lastReviewTimestamp = parsed.lastReviewTimestamp || null;

      // Auto-harvest transfer state
      state.autoHarvestTransfers = (parsed.autoHarvestTransfers || []).slice(-100);
      state.totalAutoHarvestedUSD = parsed.totalAutoHarvestedUSD || 0;
      state.totalAutoHarvestedETH = parsed.totalAutoHarvestedETH || 0;
      state.lastAutoHarvestTime = parsed.lastAutoHarvestTime || null;
      state.autoHarvestCount = parsed.autoHarvestCount || 0;
      state.autoHarvestByRecipient = parsed.autoHarvestByRecipient || {};

      // Backfill per-recipient tracking from existing transfer records
      if (Object.keys(state.autoHarvestByRecipient).length === 0 && state.autoHarvestTransfers.length > 0) {
        for (const t of state.autoHarvestTransfers) {
          const lbl = (t as any).label || 'Owner';
          state.autoHarvestByRecipient[lbl] = (state.autoHarvestByRecipient[lbl] || 0) + ((t as any).amountUSD || 0);
        }
      }

      // Daily payout state
      state.dailyPayouts = (parsed.dailyPayouts || []).slice(-90);
      state.totalDailyPayoutsUSD = parsed.totalDailyPayoutsUSD || 0;
      state.dailyPayoutCount = parsed.dailyPayoutCount || 0;
      state.lastDailyPayoutDate = parsed.lastDailyPayoutDate || null;
      state.dailyPayoutByRecipient = parsed.dailyPayoutByRecipient || {};
      // v21.15-fix: Harvest-on-sell reservation. Previously lived only as
      // (state as any).pendingFeeUSDC so it was lost on every restart. Now
      // persisted so the bot keeps the reserve across redeploys and the 8AM
      // UTC payout pays the correct amount even if the bot restarted mid-day.
      state.pendingFeeUSDC = parsed.pendingFeeUSDC || 0;

      // Shadow proposals
      if (parsed.shadowProposals && Array.isArray(parsed.shadowProposals)) {
        setShadowProposals(parsed.shadowProposals);
        console.log(`  🔬 Restored ${parsed.shadowProposals.length} shadow proposals`);
      }

      // Circuit breaker state — reset stale pauses
      if (parsed.breakerState) {
        let restoredBreaker: BreakerState = { ...DEFAULT_BREAKER_STATE, ...parsed.breakerState };
        if (restoredBreaker.lastBreakerTriggered) {
          const pauseEnd = new Date(restoredBreaker.lastBreakerTriggered).getTime() + (BREAKER_PAUSE_HOURS * 3_600_000);
          if (Date.now() > pauseEnd) {
            console.log(`  ✅ Breaker pause expired — clearing stale breaker state (was: ${restoredBreaker.consecutiveLosses} losses, triggered ${restoredBreaker.lastBreakerTriggered})`);
            restoredBreaker = { ...DEFAULT_BREAKER_STATE };
          } else {
            console.log(`  🚨 Breaker state: ${restoredBreaker.consecutiveLosses} consecutive losses, last triggered ${restoredBreaker.lastBreakerTriggered}`);
          }
        } else if (restoredBreaker.consecutiveLosses > 0) {
          const lastResult = restoredBreaker.rollingTradeResults.length > 0;
          if (!lastResult && restoredBreaker.consecutiveLosses >= BREAKER_CONSECUTIVE_LOSSES) {
            console.log(`  ✅ Resetting stale consecutive losses (${restoredBreaker.consecutiveLosses}) — no recent trade activity`);
            restoredBreaker.consecutiveLosses = 0;
            restoredBreaker.rollingTradeResults = [];
          } else {
            console.log(`  🚨 Breaker state: ${restoredBreaker.consecutiveLosses} consecutive losses`);
          }
        }
        // Mutate the existing store reference in-place so the agent's local
        // breakerState variable (wired into the store at startup) gets updated.
        Object.assign(getBreakerState(), restoredBreaker);
      }

      // Market Intelligence historical data
      if (parsed.fundingRateHistory) {
        svc().setFundingRateHistory(parsed.fundingRateHistory);
        state.fundingRateHistory = parsed.fundingRateHistory;
      }
      if (parsed.btcDominanceHistory) {
        svc().setBtcDominanceHistory(parsed.btcDominanceHistory);
        state.btcDominanceHistory = parsed.btcDominanceHistory;
      }
      if (parsed.stablecoinSupplyHistory) {
        setStablecoinSupplyHistory(parsed.stablecoinSupplyHistory);
        state.stablecoinSupplyHistory = parsed.stablecoinSupplyHistory;
      }

      // Yield service state
      if (parsed.aaveYieldState) {
        aaveYieldService.restoreState(parsed.aaveYieldState);
        const ys = aaveYieldService.getState();
        console.log(`  🏦 Aave yield restored: $${ys.depositedUSDC.toFixed(2)} deposited, $${ys.totalYieldEarned.toFixed(4)} earned, ${ys.supplyCount} supplies`);
      }
      if (parsed.morphoYieldState) {
        morphoYieldService.restoreState(parsed.morphoYieldState);
        const ms = morphoYieldService.getState();
        console.log(`  🏦 Morpho yield restored: $${ms.depositedUSDC.toFixed(2)} deposited, $${ms.totalYieldEarned.toFixed(4)} earned, ${ms.supplyCount} supplies`);
      }

      // Migration flags
      if (parsed._migrationCostBasisV1145) (state as any)._migrationCostBasisV1145 = true;
      if (parsed._migrationCostBasisV1146) (state as any)._migrationCostBasisV1146 = true;
      if (parsed._migrationPnLResetV1950) (state as any)._migrationPnLResetV1950 = true;

      // Safety guards
      state.sanityAlerts = (parsed.sanityAlerts || []).slice(-100);
      state.tradeDedupLog = parsed.tradeDedupLog || {};
      // Clean expired dedup entries
      if (state.tradeDedupLog) {
        const now = Date.now();
        for (const key of Object.keys(state.tradeDedupLog)) {
          if (now - new Date(state.tradeDedupLog[key]).getTime() > 2 * 60 * 60 * 1000) {
            delete state.tradeDedupLog[key];
          }
        }
      }

      // On-chain deposit tracking
      state.totalDeposited = parsed.totalDeposited || 0;
      state.onChainWithdrawn = parsed.onChainWithdrawn || 0;
      state.lastKnownUSDCBalance = parsed.lastKnownUSDCBalance || 0;
      state.depositHistory = parsed.depositHistory || [];
      if (state.totalDeposited > 0) {
        console.log(`  💵 Deposit tracking: $${state.totalDeposited.toFixed(2)} deposited, $${state.onChainWithdrawn.toFixed(2)} withdrawn (${state.depositHistory.length} deposits)`);
      }

      // User & config directives
      state.userDirectives = parsed.userDirectives || [];
      state.configDirectives = parsed.configDirectives || [];
      const activeDir = (state.userDirectives || []).length + (state.configDirectives || []).filter((d: any) => d.active).length;
      if (activeDir > 0) {
        console.log(`  📝 Restored ${activeDir} active directives`);
      }

      // Migrate cost basis — backfill ATR fields
      for (const sym of Object.keys(state.costBasis)) {
        const cb = state.costBasis[sym];
        if (cb.atrStopPercent === undefined) cb.atrStopPercent = null;
        if (cb.atrTrailPercent === undefined) cb.atrTrailPercent = null;
        if (cb.atrAtEntry === undefined) cb.atrAtEntry = null;
        if (cb.trailActivated === undefined) cb.trailActivated = false;
        if (cb.lastAtrUpdate === undefined) cb.lastAtrUpdate = null;
      }

      // Clamp adaptive thresholds to bounds — prevent runaway self-improvement
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

      // Hard reset — prevent confluence paralysis
      if (state.adaptiveThresholds.confluenceBuy > 22) {
        console.log(`  🔧 RESET confluenceBuy: ${state.adaptiveThresholds.confluenceBuy} → 22 (sim-optimal)`);
        state.adaptiveThresholds.confluenceBuy = 22;
      }
      if (state.adaptiveThresholds.confluenceStrongBuy > 40) {
        console.log(`  🔧 RESET confluenceStrongBuy: ${state.adaptiveThresholds.confluenceStrongBuy} → 40`);
        state.adaptiveThresholds.confluenceStrongBuy = 40;
      }

      console.log(`  📂 Loaded ${state.tradeHistory.length} trades, ${Object.keys(state.costBasis).length} cost basis entries from ${file}`);
      console.log(`  🧠 Phase 3: ${Object.keys(state.strategyPatterns).length} patterns, ${state.performanceReviews.length} reviews, ${state.adaptiveThresholds.adaptationCount} adaptations`);

      // Restore trailing stops
      loadTrailingStops();

      // Rebuild cost basis if needed
      if (Object.keys(state.costBasis).length === 0 && state.tradeHistory.length > 0) {
        console.log(`  📊 Rebuilding cost basis from ${state.tradeHistory.length} trades...`);
        rebuildCostBasisFromTrades(state.tradeHistory);
      }

      return;
    }

    console.log('  📂 No existing trade history found, starting fresh');
  } catch (e) {
    console.log('  📂 No existing trade history found, starting fresh');
  }
}

// ============================================================================
// SAVE — atomic write to disk
// ============================================================================

export function saveTradeHistory(): void {
  const { logFile, aaveYieldService, morphoYieldService, getTokenDiscoveryState, saveTrailingStops } = svc();
  const state = getState();
  const breakerState = getBreakerState();

  try {
    const data = {
      version: BOT_VERSION,
      lastUpdated: new Date().toISOString(),
      initialValue: state.trading.initialValue,
      peakValue: state.trading.peakValue,
      maxDrawdownPercent: (state.trading as any).maxDrawdownPercent || 0,
      currentValue: state.trading.totalPortfolioValue,
      totalTrades: state.trading.totalTrades,
      successfulTrades: state.trading.successfulTrades,
      sectorAllocations: state.trading.sectorAllocations,
      trades: state.tradeHistory.slice(-2500),
      lifetimeTotalTrades: state.trading.totalTrades,
      lifetimeSuccessfulTrades: state.trading.successfulTrades,
      costBasis: state.costBasis,
      profitTakeCooldowns: state.profitTakeCooldowns,
      stopLossCooldowns: state.stopLossCooldowns,
      tradeFailures: state.tradeFailures,
      harvestedProfits: state.harvestedProfits,
      autoHarvestTransfers: state.autoHarvestTransfers,
      totalAutoHarvestedUSD: state.totalAutoHarvestedUSD,
      totalAutoHarvestedETH: state.totalAutoHarvestedETH,
      lastAutoHarvestTime: state.lastAutoHarvestTime,
      autoHarvestCount: state.autoHarvestCount,
      autoHarvestByRecipient: state.autoHarvestByRecipient,
      dailyPayouts: state.dailyPayouts.slice(-90),
      totalDailyPayoutsUSD: state.totalDailyPayoutsUSD,
      dailyPayoutCount: state.dailyPayoutCount,
      lastDailyPayoutDate: state.lastDailyPayoutDate,
      dailyPayoutByRecipient: state.dailyPayoutByRecipient,
      pendingFeeUSDC: state.pendingFeeUSDC || 0,
      strategyPatterns: state.strategyPatterns,
      adaptiveThresholds: state.adaptiveThresholds,
      performanceReviews: state.performanceReviews.slice(-30),
      explorationState: state.explorationState,
      lastReviewTradeIndex: state.lastReviewTradeIndex,
      lastReviewTimestamp: state.lastReviewTimestamp,
      shadowProposals: getShadowProposals().filter((p: any) => p.status === 'PENDING').slice(-50),
      tokenDiscovery: getTokenDiscoveryState(),
      breakerState,
      totalDeposited: state.totalDeposited,
      onChainWithdrawn: state.onChainWithdrawn,
      lastKnownUSDCBalance: state.lastKnownUSDCBalance,
      depositHistory: state.depositHistory.slice(-50),
      fundingRateHistory: svc().getFundingRateHistory(),
      btcDominanceHistory: { values: svc().getBtcDominanceHistory().values.slice(-504) },
      stablecoinSupplyHistory: { values: getStablecoinSupplyHistory().values.slice(-504) },
      aaveYieldState: aaveYieldService.getState(),
      morphoYieldState: morphoYieldService.getState(),
      _migrationCostBasisV1145: (state as any)._migrationCostBasisV1145 || false,
      _migrationCostBasisV1146: (state as any)._migrationCostBasisV1146 || false,
      _migrationPnLResetV1950: (state as any)._migrationPnLResetV1950 || false,
      sanityAlerts: (state.sanityAlerts || []).slice(-50),
      tradeDedupLog: state.tradeDedupLog || {},
      userDirectives: (state.userDirectives || []).slice(-30),
      configDirectives: (state.configDirectives || []).filter((d: any) => d.active).slice(-30),
    };

    saveTrailingStops();

    const dir = logFile.substring(0, logFile.lastIndexOf('/'));
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Atomic write — temp file + rename to prevent corruption on crash
    const tmpFile = logFile + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
    fs.renameSync(tmpFile, logFile);
  } catch (e: any) {
    console.error('Failed to save trade history:', e.message);
  }
}

// ============================================================================
// DIRTY-FLAG BATCHING — reduces disk I/O
// Critical saves (post-trade) flush within 5s; non-critical batch into 30s windows.
// ============================================================================

const SAVE_INTERVAL_MS = 30_000;
const SAVE_CRITICAL_INTERVAL_MS = 5_000;

let _lastSaveAt = Date.now();
let _criticalSaveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Mark state as needing persistence.
 * If critical (post-trade), queues a flush within SAVE_CRITICAL_INTERVAL_MS.
 * Also sets the store's dirty flag for modules that only need to check it.
 */
export function markStateDirty(critical?: boolean): void {
  _storeMarkDirty(critical);
  if (critical && !_criticalSaveTimer) {
    _criticalSaveTimer = setTimeout(() => {
      _criticalSaveTimer = null;
      flushStateIfDirty('critical-timer');
    }, SAVE_CRITICAL_INTERVAL_MS);
  }
}

/**
 * Flush state to disk if dirty.
 * Periodic calls respect the 30s batch window; explicit calls always flush.
 */
export function flushStateIfDirty(reason: string = 'periodic'): void {
  if (!isStateDirty()) return;
  const elapsed = Date.now() - _lastSaveAt;
  if (reason === 'periodic' && elapsed < SAVE_INTERVAL_MS) return;
  saveTradeHistory();
  clearDirtyFlag();
  _lastSaveAt = Date.now();
  if (_criticalSaveTimer) {
    clearTimeout(_criticalSaveTimer);
    _criticalSaveTimer = null;
  }
}
