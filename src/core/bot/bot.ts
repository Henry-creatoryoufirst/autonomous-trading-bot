/**
 * Never Rest Capital — Bot class
 *
 * Phase 6 of the monolith refactor. The `Bot` class is the concrete
 * implementation of `IBot`. It wraps a `StateManager` (Phase 2) plus
 * per-bot service handles (telegram, cache, cooldown) into a single object.
 *
 * Current scope (Phase 6a):
 *   - Full IBot implementation backed by StateManager
 *   - Service handles injected at construction (no live services wired yet)
 *   - createBot() factory in bot-factory.ts produces instances
 *
 * Future scope (Phase 6b):
 *   - Inject live TelegramService / CacheManager / CooldownManager
 *   - Wire Bot into fleet-runner.ts multi-tenant execution
 *   - Replace CONFIG global with bot.config references
 */

import type { IBot } from '../types/bot-interface.js';
import type { AgentState, BreakerState } from '../types/state.js';
import type { MarketData } from '../types/market-data.js';
import type { RiskContext, PreservationMode } from '../types/risk.js';
import { StateManager } from '../state/state-manager.js';
import type { BotConfig } from './bot-config.js';

// ============================================================================
// SERVICE HANDLE TYPES (subset of full service interfaces)
// ============================================================================

export type TelegramHandle = IBot['telegram'];
export type CacheHandle    = IBot['cache'];
export type CooldownHandle = IBot['cooldown'];

/** No-op telegram handle — for testing and paper-trade bots. */
export const NOOP_TELEGRAM: TelegramHandle = {
  sendAlert: async () => false,
};

/** No-op cache handle. */
export const NOOP_CACHE: CacheHandle = {
  invalidate: () => {},
  getStats:   () => ({ hits: 0, misses: 0, hitRate: 0 }),
};

/** No-op cooldown handle. */
export const NOOP_COOLDOWN: CooldownHandle = {
  getActiveCount:   () => 0,
  setRawCooldown:   () => {},
};

// ============================================================================
// BOT CLASS
// ============================================================================

export class Bot implements IBot {
  readonly botId: string;
  readonly walletAddress: string;
  readonly instanceName: string;

  readonly telegram: TelegramHandle;
  readonly cache:    CacheHandle;
  readonly cooldown: CooldownHandle;

  private readonly _stateManager: StateManager;
  private readonly _startedAt: number;

  constructor(
    public readonly config: BotConfig,
    stateManager: StateManager,
    handles: {
      telegram?: TelegramHandle;
      cache?:    CacheHandle;
      cooldown?: CooldownHandle;
    } = {},
  ) {
    this.botId         = config.botId;
    this.walletAddress = config.walletAddress;
    this.instanceName  = config.instanceName;
    this._stateManager = stateManager;
    this._startedAt    = Date.now();
    this.telegram = handles.telegram ?? NOOP_TELEGRAM;
    this.cache    = handles.cache    ?? NOOP_CACHE;
    this.cooldown = handles.cooldown ?? NOOP_COOLDOWN;
  }

  // ==========================================================================
  // Expose state manager (for cycle stages)
  // ==========================================================================

  getStateManager(): StateManager { return this._stateManager; }

  // ==========================================================================
  // IBot: cycle metadata
  // ==========================================================================

  getCycleNumber(): number {
    return this._stateManager.getState().totalCycles;
  }

  getLastCycleTime(): number | null {
    const ts = this._stateManager.getState().trading.lastCheck;
    return ts ? new Date(ts).getTime() : null;
  }

  getUptimeSec(): number {
    return Math.floor((Date.now() - this._startedAt) / 1000);
  }

  // ==========================================================================
  // IBot: portfolio reads
  // ==========================================================================

  getPortfolioValue(): number {
    return this._stateManager.getState().trading.totalPortfolioValue;
  }

  getPeakValue(): number {
    return this._stateManager.getState().trading.peakValue;
  }

  getBalances(): AgentState['trading']['balances'] {
    return this._stateManager.getState().trading.balances;
  }

  getActivePositions(): Array<{ symbol: string; usdValue: number; unrealizedPct: number }> {
    const state = this._stateManager.getState();
    const results: Array<{ symbol: string; usdValue: number; unrealizedPct: number }> = [];
    for (const balance of (state.trading.balances ?? [])) {
      if (balance.symbol === 'USDC' || !balance.usdValue || balance.usdValue < 1) continue;
      const cb = state.costBasis[balance.symbol];
      const unrealizedPct = cb && cb.averageCostBasis > 0
        ? ((balance.usdValue / (cb.averageCostBasis * cb.currentHolding)) - 1) * 100
        : 0;
      results.push({ symbol: balance.symbol, usdValue: balance.usdValue, unrealizedPct });
    }
    return results;
  }

  // ==========================================================================
  // IBot: history reads
  // ==========================================================================

  getTradeHistory(limit: number): Array<{
    token: string; action: string; success: boolean; pnlUSD?: number; timestamp: string;
  }> {
    const history = this._stateManager.getState().tradeHistory ?? [];
    return history.slice(-limit).map(t => ({
      token:     t.toToken,
      action:    t.action,
      success:   t.success,
      pnlUSD:    t.realizedPnL,
      timestamp: t.timestamp,
    }));
  }

  getErrorLog(_limit: number): Array<{ type: string; message: string; timestamp: string }> {
    // Error log not yet in state — Phase 6b will add it
    return [];
  }

  // ==========================================================================
  // IBot: market context
  // ==========================================================================

  getMarketRegime(): string {
    return (this._stateManager.getState() as any).lastMarketRegime ?? 'UNKNOWN';
  }

  getFearGreed(): number {
    return (this._stateManager.getState() as any).lastFearGreed ?? 50;
  }

  getLastMarketData(): MarketData | undefined {
    return (this._stateManager.getState() as any).lastMarketData;
  }

  // ==========================================================================
  // IBot: risk reads
  // ==========================================================================

  getCircuitBreakerState(): { active: boolean; reason: string | null; triggeredAt: string | null } {
    const breaker = this._stateManager.getBreakerState();
    return {
      active:      !!breaker.lastBreakerTriggered,
      reason:      breaker.lastBreakerReason ?? null,
      triggeredAt: breaker.lastBreakerTriggered ?? null,
    };
  }

  getRiskContext(): RiskContext {
    // Phase 6b: wire real CircuitBreaker evaluation here
    // For now return a minimal safe context that doesn't block trading
    const preservation = this.getPreservationMode();
    return {
      breaker: {
        severity: 'NONE',
        active:   false,
        message:  'Phase 6a stub — full evaluation wired in Phase 6b',
        sizeMultiplier: 1.0,
        mutations: {},
      },
      preservation,
      isDerisked:               false,
      effectiveSizeMultiplier:  preservation.positionSizeMultiplier,
      effectiveMinConfluence:   preservation.minConfluenceForBuy,
    };
  }

  getBreakerState(): BreakerState {
    return this._stateManager.getBreakerState();
  }

  getPreservationMode(): PreservationMode {
    return (this._stateManager.getState() as any).preservationMode ?? {
      label:                   'INACTIVE',
      activatedAt:             null,
      fearGreedValue:          50,
      positionSizeMultiplier:  1.0,
      minConfluenceForBuy:     0,
      minSwarmConsensusForBuy: 0,
      cycleIntervalMultiplier: 1.0,
      metrics: { tradesBlocked: 0, tradesSizedDown: 0, enteredFromRegime: 'UNKNOWN' },
    };
  }

  // ==========================================================================
  // IBot: state writes (healing surface)
  // ==========================================================================

  addTokenCooldown(symbol: string, durationMs: number): void {
    this.cooldown.setRawCooldown(symbol, durationMs);
  }

  invalidatePriceCache(symbol?: string): void {
    this.cache.invalidate(symbol ?? '*');
  }

  setPositionSizeMultiplier(multiplier: number): void {
    const state = this._stateManager.getState() as any;
    if (state.adaptiveThresholds) {
      state.adaptiveThresholds.positionSizeMultiplier = multiplier;
      this._stateManager.markDirty();
    }
  }

  setConfluenceThresholdOverride(delta: number): void {
    const state = this._stateManager.getState() as any;
    if (state.adaptiveThresholds) {
      state.adaptiveThresholds.confluenceThresholdDelta = delta;
      this._stateManager.markDirty();
    }
  }

  resetCircuitBreaker(): void {
    const breaker = this._stateManager.getBreakerState();
    (breaker as any).active      = false;
    (breaker as any).reason      = null;
    (breaker as any).triggeredAt = null;
    this._stateManager.markDirty();
  }

  extendCircuitBreaker(additionalHours: number): void {
    const breaker = this._stateManager.getBreakerState() as any;
    const currentPause = breaker.pauseUntil ? new Date(breaker.pauseUntil).getTime() : Date.now();
    breaker.pauseUntil = new Date(currentPause + additionalHours * 3_600_000).toISOString();
    this._stateManager.markDirty();
  }

  markStateDirty(force?: boolean): void {
    this._stateManager.markDirty(force);
  }

  // ==========================================================================
  // PRIVATE
  // ==========================================================================

  private _computeDrawdown(): number {
    const peak = this.getPeakValue();
    const current = this.getPortfolioValue();
    if (peak <= 0 || current <= 0) return 0;
    return Math.max(0, ((peak - current) / peak) * 100);
  }
}
