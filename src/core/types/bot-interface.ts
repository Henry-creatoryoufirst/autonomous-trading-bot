/**
 * Never Rest Capital — IBot (multi-tenant boundary)
 *
 * Phase 1 of the monolith refactor. `IBot` is the SUPERSET of the existing
 * `BotInterface` used by Self-Healing Intelligence (shipped today). It is
 * the single boundary that every service module consumes instead of
 * reaching into module-level singletons.
 *
 * Design intent:
 *   - The Self-Healing subsystem already uses `BotInterface` as its clean
 *     abstraction — that worked well, so we generalize it.
 *   - A `Bot` instance (Phase 6) implements `IBot`.
 *   - Every service that currently imports singletons (cache, cooldown,
 *     telegram) will migrate to accepting an `IBot` in its constructor.
 *   - SHI's existing `BotInterface` stays as-is for backward compat; it's
 *     a structural subset of `IBot`, so a full `IBot` implementation
 *     satisfies both.
 *
 * Phase 2: StateManager implements the read-only surface of `IBot`.
 * Phase 3-5: Risk/Portfolio/Cycle modules accept `IBot` in constructors.
 * Phase 6: `Bot` class in `src/core/bot/bot.ts` is the concrete impl.
 */
import type { AgentState, BreakerState } from './state.js';
import type { MarketData } from './market-data.js';
import type { PreservationMode, RiskContext } from './risk.js';

// ============================================================================
// IBot — The full bot boundary
// ============================================================================

/**
 * IBot is the ONLY surface that extracted service modules touch.
 *
 * Read methods return snapshots or direct references — implementations MUST
 * NOT clone (state mutations happen through the same underlying objects).
 * Write methods funnel every state mutation through named, auditable methods.
 */
export interface IBot {
  // ==========================================================================
  // Identity & metadata
  // ==========================================================================

  /** Stable identifier for this bot (e.g., "henry", "ryan-denome"). */
  readonly botId: string;

  /** On-chain wallet address this bot signs for. */
  readonly walletAddress: string;

  /** Human-readable name used in logs + Telegram. */
  readonly instanceName: string;

  // ==========================================================================
  // State reads — cycle metadata
  // ==========================================================================

  getCycleNumber(): number;
  getLastCycleTime(): number | null;
  getUptimeSec(): number;

  // ==========================================================================
  // State reads — portfolio
  // ==========================================================================

  /** Total USD value across all holdings (cached from last valuation). */
  getPortfolioValue(): number;

  /** Peak portfolio value seen since bot start (used for drawdown math). */
  getPeakValue(): number;

  /** Current balances snapshot (reference — do not mutate). */
  getBalances(): AgentState['trading']['balances'];

  /** Active positions with unrealized P&L (excludes USDC and dust). */
  getActivePositions(): Array<{
    symbol: string;
    usdValue: number;
    unrealizedPct: number;
  }>;

  // ==========================================================================
  // State reads — history
  // ==========================================================================

  /** Recent trade history, newest-last. */
  getTradeHistory(limit: number): Array<{
    token: string;
    action: string;
    success: boolean;
    pnlUSD?: number;
    timestamp: string;
  }>;

  /** Recent error log entries, newest-last. */
  getErrorLog(limit: number): Array<{
    type: string;
    message: string;
    timestamp: string;
  }>;

  // ==========================================================================
  // State reads — market context
  // ==========================================================================

  /** Most-recent market regime classification (e.g., "RANGING", "BEAR"). */
  getMarketRegime(): string;

  /** Most-recent Fear & Greed value (0-100). */
  getFearGreed(): number;

  /** Optional: last computed MarketData snapshot. */
  getLastMarketData(): MarketData | undefined;

  // ==========================================================================
  // State reads — risk
  // ==========================================================================

  getCircuitBreakerState(): {
    active: boolean;
    reason: string | null;
    triggeredAt: string | null;
  };

  /** Full risk context (breaker + preservation combined). */
  getRiskContext(): RiskContext;

  /** Full breaker state reference (read-only). */
  getBreakerState(): BreakerState;

  /** Current capital preservation mode. */
  getPreservationMode(): PreservationMode;

  // ==========================================================================
  // State writes — healing actions (exact surface SHI requires)
  // ==========================================================================

  /** Put a token in cooldown for the given duration. */
  addTokenCooldown(symbol: string, durationMs: number): void;

  /** Invalidate price cache, optionally for a specific symbol. */
  invalidatePriceCache(symbol?: string): void;

  /** Set the bot-wide position size multiplier (0.25–1.0). */
  setPositionSizeMultiplier(multiplier: number): void;

  /** Raise the minimum confluence required for BUY decisions. */
  setConfluenceThresholdOverride(delta: number): void;

  /** Clear circuit breaker (only when recovery evidence is proven). */
  resetCircuitBreaker(): void;

  /** Extend the circuit breaker pause by N hours. */
  extendCircuitBreaker(additionalHours: number): void;

  // ==========================================================================
  // State writes — persistence
  // ==========================================================================

  /** Mark the state dirty for the next flush. `force=true` flushes immediately. */
  markStateDirty(force?: boolean): void;

  // ==========================================================================
  // Service handles — injected per-bot (Phase 6 multi-tenant)
  // ==========================================================================

  /** Telegram handle — tenant-aware after Phase 6. */
  readonly telegram: {
    sendAlert(alert: {
      severity: 'CRITICAL' | 'HIGH' | 'INFO';
      title: string;
      message: string;
      data?: Record<string, string | number | boolean>;
    }): Promise<boolean>;
  };

  /** Cache handle — per-bot after Phase 6. */
  readonly cache: {
    invalidate(key: string): void;
    getStats(): { hits: number; misses: number; hitRate: number };
  };

  /** Cooldown handle — per-bot after Phase 6. */
  readonly cooldown: {
    getActiveCount(): number;
    setRawCooldown(symbol: string, durationMs: number): void;
  };
}

// ============================================================================
// IBot read-only slice — for modules that only read, never write
// ============================================================================

/**
 * A read-only view of IBot. Modules like dashboard formatters, intelligence
 * collectors, and telemetry exporters should accept this instead of full
 * IBot — makes it structurally impossible to accidentally write state.
 */
export type IBotReadOnly = Pick<
  IBot,
  | 'botId'
  | 'walletAddress'
  | 'instanceName'
  | 'getCycleNumber'
  | 'getLastCycleTime'
  | 'getUptimeSec'
  | 'getPortfolioValue'
  | 'getPeakValue'
  | 'getBalances'
  | 'getActivePositions'
  | 'getTradeHistory'
  | 'getErrorLog'
  | 'getMarketRegime'
  | 'getFearGreed'
  | 'getLastMarketData'
  | 'getCircuitBreakerState'
  | 'getRiskContext'
  | 'getBreakerState'
  | 'getPreservationMode'
>;
