/**
 * Never Rest Capital — CircuitBreaker
 *
 * Phase 3 of the monolith refactor. Extracts the circuit breaker logic
 * from agent-v3.2.ts lines 2650-2773 (triggerCircuitBreaker,
 * recordTradeResultForBreaker, checkCircuitBreaker, updateDrawdownBaselines).
 *
 * The class owns all reasoning about WHEN to trigger and WHEN to recover.
 * It performs state mutations through the injected StateManager so the
 * shared AgentState+BreakerState references stay consistent with the
 * monolith's direct-access paths during the incremental migration.
 *
 * Pattern matches src/core/services/self-healing/ — constructor DI, pure
 * methods where possible, typed decision output.
 */

import type { StateManager } from '../state/state-manager.js';
import type {
  BreakerDecision,
  BreakerConfig,
  BreakerSeverity,
  BreakerTriggerReason,
} from '../types/risk.js';

export interface CircuitBreakerDeps {
  stateManager: StateManager;
  config: BreakerConfig;
}

export class CircuitBreaker {
  private readonly state: StateManager;
  private readonly config: BreakerConfig;

  constructor(deps: CircuitBreakerDeps) {
    this.state = deps.stateManager;
    this.config = deps.config;
  }

  // ==========================================================================
  // PUBLIC: evaluate — call once per cycle, returns the decision the
  // cycle engine uses to decide whether to trade, with what size, etc.
  // ==========================================================================

  /**
   * Evaluate all breaker conditions against current portfolio state.
   * Updates baselines as a side effect (via StateManager).
   *
   * @returns BreakerDecision — severity + sizeMultiplier + optional trigger reason
   */
  evaluate(
    portfolioValue: number,
    lastTradeResult?: { success: boolean; pnlUSD?: number },
  ): BreakerDecision {
    this.updateBaselines(portfolioValue);

    const breakerState = this.state.getBreakerState();

    // ── Already paused? ────────────────────────────────────────────────────
    if (breakerState.lastBreakerTriggered) {
      const pauseEnd =
        new Date(breakerState.lastBreakerTriggered).getTime() +
        this.config.pauseHours * 3600000;

      if (Date.now() < pauseEnd) {
        const remaining = Math.ceil((pauseEnd - Date.now()) / 60000);
        return this.makePausedDecision(
          `PAUSED: ${breakerState.lastBreakerReason} (${remaining}m remaining)`,
          new Date(pauseEnd).toISOString(),
        );
      }

      // Pause expired — clear rolling window + consecutive losses so the bot
      // doesn't immediately re-trip on stale history (v20.4.2).
      this.clearPauseAfterExpiry(breakerState.rollingTradeResults.length, breakerState.consecutiveLosses);
    }

    // ── Post-pause size reduction still in effect? ────────────────────────
    const inSizeReduction =
      !!breakerState.breakerSizeReductionUntil &&
      Date.now() < new Date(breakerState.breakerSizeReductionUntil).getTime();

    // ── Check all trigger conditions ──────────────────────────────────────
    const trigger = this.detectTrigger(portfolioValue, lastTradeResult);
    if (trigger) {
      // Fire it — this ALSO mutates state through StateManager
      this.trigger(trigger.reason, trigger.message);
      return this.makeTriggeredDecision(trigger.reason, trigger.message);
    }

    // ── Clear-but-in-caution path ─────────────────────────────────────────
    if (inSizeReduction) {
      return {
        severity: 'CAUTION',
        active: true,
        message: 'Post-breaker size reduction active',
        sizeMultiplier: this.config.sizeReductionPercent,
        sizeReductionUntil: breakerState.breakerSizeReductionUntil ?? undefined,
        mutations: {},
      };
    }

    return {
      severity: 'NONE',
      active: false,
      message: 'All breaker checks clear',
      sizeMultiplier: 1.0,
      mutations: {},
    };
  }

  // ==========================================================================
  // PUBLIC: record trade result — call after every trade execution
  // ==========================================================================

  /**
   * Record a trade result against the rolling window + consecutive loss
   * counter. Must be called for every trade (buy or sell) whether it
   * succeeded or failed.
   *
   * @returns { isWin, consecutiveLosses, rollingLosses }
   */
  recordTradeResult(
    success: boolean,
    pnlUSD?: number,
  ): { isWin: boolean; consecutiveLosses: number; rollingLosses: number } {
    const isWin = success && (pnlUSD === undefined || pnlUSD >= 0);

    if (isWin) {
      this.state.resetConsecutiveLosses();
    } else {
      this.state.incrementConsecutiveLosses();
    }
    this.state.appendRollingResult(isWin, this.config.rollingWindowSize);

    const bs = this.state.getBreakerState();
    const rollingLosses = bs.rollingTradeResults.filter((r) => !r).length;

    return {
      isWin,
      consecutiveLosses: bs.consecutiveLosses,
      rollingLosses,
    };
  }

  // ==========================================================================
  // PUBLIC: trigger manually — used by emergency exits + SHI
  // ==========================================================================

  /** Fire the breaker with a specific reason. */
  trigger(reason: BreakerTriggerReason, message: string): void {
    this.state.triggerBreaker(message, this.config.sizeReductionHours);
    console.log('\n🚨🚨 CIRCUIT BREAKER TRIGGERED 🚨🚨');
    console.log(`   Reason:  ${reason} — ${message}`);
    console.log(`   Action:  ALL trading paused for ${this.config.pauseHours}h`);
    console.log(`   After:   position sizes reduced to ${(this.config.sizeReductionPercent * 100).toFixed(0)}% for ${this.config.sizeReductionHours}h`);
  }

  /** Clear the breaker — only when recovery evidence is proven. */
  reset(): void {
    this.state.resetBreaker();
    console.log('✅ Circuit breaker cleared');
  }

  /** Extend the pause by additional hours. */
  extend(additionalHours: number): boolean {
    return this.state.extendBreakerPause(additionalHours, this.config.pauseHours);
  }

  // ==========================================================================
  // PUBLIC: baseline management (called internally, exposed for tests)
  // ==========================================================================

  /**
   * Update the daily and weekly baselines used for drawdown checks.
   * Daily baseline resets at UTC midnight; weekly resets on Monday UTC.
   */
  updateBaselines(portfolioValue: number): void {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const bs = this.state.getBreakerState();

    if (bs.dailyBaseline.date !== dateStr) {
      this.state.setDailyBaseline(dateStr, portfolioValue);
      this.state.setDailyBaselineValidated(true);
    }

    // Weekly (Monday = start of week in UTC)
    const dayOfWeek = now.getUTCDay();
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - ((dayOfWeek + 6) % 7));
    const weekStr = monday.toISOString().split('T')[0];
    if (bs.weeklyBaseline.weekStart !== weekStr) {
      this.state.setWeeklyBaseline(weekStr, portfolioValue);
    }
  }

  // ==========================================================================
  // INTERNAL: trigger detection
  // ==========================================================================

  /** Returns the first trigger that fires, or null if all clear. */
  private detectTrigger(
    portfolioValue: number,
    lastTradeResult?: { success: boolean; pnlUSD?: number },
  ): { reason: BreakerTriggerReason; message: string } | null {
    const bs = this.state.getBreakerState();

    // 1. Consecutive losses
    if (bs.consecutiveLosses >= this.config.consecutiveLossLimit) {
      return {
        reason: 'CONSECUTIVE_LOSSES',
        message: `${bs.consecutiveLosses} consecutive losing trades`,
      };
    }

    // 2. Rolling window loss rate
    if (bs.rollingTradeResults.length >= this.config.rollingWindowSize) {
      const rollingLosses = bs.rollingTradeResults.filter((r) => !r).length;
      if (rollingLosses >= this.config.rollingLossThreshold) {
        return {
          reason: 'ROLLING_LOSS_RATE',
          message: `${rollingLosses}/${this.config.rollingWindowSize} trades lost in rolling window`,
        };
      }
    }

    // 3. Daily drawdown
    if (bs.dailyBaseline.value > 0) {
      const dailyDD = ((bs.dailyBaseline.value - portfolioValue) / bs.dailyBaseline.value) * 100;
      if (dailyDD >= this.config.dailyDrawdownPercent) {
        return {
          reason: 'DAILY_DRAWDOWN',
          message: `Daily drawdown ${dailyDD.toFixed(1)}% exceeds ${this.config.dailyDrawdownPercent}% limit`,
        };
      }
    }

    // 4. Weekly drawdown
    if (bs.weeklyBaseline.value > 0) {
      const weeklyDD = ((bs.weeklyBaseline.value - portfolioValue) / bs.weeklyBaseline.value) * 100;
      if (weeklyDD >= this.config.weeklyDrawdownPercent) {
        return {
          reason: 'WEEKLY_DRAWDOWN',
          message: `Weekly drawdown ${weeklyDD.toFixed(1)}% exceeds ${this.config.weeklyDrawdownPercent}% limit`,
        };
      }
    }

    // 5. Single trade loss (only checked if a trade result is passed in)
    if (lastTradeResult?.pnlUSD && lastTradeResult.pnlUSD < 0 && portfolioValue > 0) {
      const lossAsPct = (Math.abs(lastTradeResult.pnlUSD) / portfolioValue) * 100;
      // Reuses emergencyExitLossPercent as the threshold for hard-halt single-trade loss.
      // The existing monolith config uses BREAKER_SINGLE_TRADE_LOSS_PCT; the refactored
      // config absorbs it into emergencyExitLossPercent for now (P4 will separate them).
      const threshold = Math.abs(this.config.emergencyExitLossPercent * 100);
      if (lossAsPct >= threshold) {
        return {
          reason: 'EMERGENCY_EXIT',
          message: `Single trade loss $${Math.abs(lastTradeResult.pnlUSD).toFixed(2)} (${lossAsPct.toFixed(1)}%) exceeds ${threshold}% limit`,
        };
      }
    }

    return null;
  }

  // ==========================================================================
  // INTERNAL: helpers
  // ==========================================================================

  private clearPauseAfterExpiry(rollingLen: number, consecLosses: number): void {
    console.log(
      `  ✅ Breaker pause expired — resetting rolling window (${rollingLen} entries) and consecutive losses (${consecLosses})`,
    );
    // Use resetBreaker to clear the lastBreakerTriggered + reason + rolling + consecutive
    this.state.resetBreaker();
  }

  private makePausedDecision(message: string, pauseUntil: string): BreakerDecision {
    return {
      severity: 'PAUSED' as BreakerSeverity,
      active: true,
      message,
      sizeMultiplier: 0,
      pauseUntil,
      mutations: {},
    };
  }

  private makeTriggeredDecision(
    reason: BreakerTriggerReason,
    message: string,
  ): BreakerDecision {
    const bs = this.state.getBreakerState();
    return {
      severity: 'PAUSED' as BreakerSeverity,
      active: true,
      triggerReason: reason,
      message,
      sizeMultiplier: 0, // Just triggered — no trades this cycle
      pauseUntil:
        bs.lastBreakerTriggered !== null
          ? new Date(
              new Date(bs.lastBreakerTriggered).getTime() + this.config.pauseHours * 3600000,
            ).toISOString()
          : undefined,
      sizeReductionUntil: bs.breakerSizeReductionUntil ?? undefined,
      mutations: {}, // Mutations already applied inside trigger()
    };
  }
}
