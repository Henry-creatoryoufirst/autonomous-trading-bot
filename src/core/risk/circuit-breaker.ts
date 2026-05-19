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
  /**
   * Consecutive cycles the stored baseline has looked stuck-HIGH (i.e.
   * sitting well above the running portfolio). Used to confirm a phantom
   * mark before self-healing it downward — a single high-baseline cycle
   * could legitimately be the result of a real flash-crash that we'd
   * never want to mask. Reset to 0 on bot restart; one extra cycle of
   * waiting on restart is an acceptable cost vs. persisting this field.
   */
  private _stuckHighCycles = 0;

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
   *
   * v21.13: Added sanity validation + self-healing for stuck baselines
   *         (one-sided — caught phantom-LOW only).
   *
   * v21.28 (2026-05-19 fix): Symmetrize the gate. The original logic only
   * defended against phantom-LOW captures and stuck-LOW baselines. A
   * phantom-HIGH capture at UTC midnight (price-stream burp, position-
   * discovery transient) would commit a high baseline and stay stuck for
   * the entire day, generating phantom losses every cycle until the next
   * midnight roll. Observed on 2026-05-18: baseline anchored at $3,080
   * against a real ~$2,835 book, dashboard reported a phantom −$215 all
   * day. See `feedback_stale_cache_gates_truth` — one-way sanity gates
   * trap stale-cache values in whichever direction isn't guarded.
   *
   * The corrected logic:
   *  1. On date rollover, defer the capture if the new value is wildly
   *     different from the previous baseline in EITHER direction
   *     (>DAILY_DELTA_SANITY in absolute terms). A real flash-crash or a
   *     real surge over a single UTC day boundary is rare enough that
   *     one extra cycle of "Calibrating" is worth the safety.
   *  2. Within the same day, check for stuck baselines in EITHER
   *     direction:
   *       - stuck-LOW (current >> baseline): self-heal immediately. The
   *         common cause is a bad earlier capture; the cost of waiting
   *         is that we under-report a real rally.
   *       - stuck-HIGH (baseline >> current): self-heal only after
   *         STUCK_HIGH_CONFIRMATION_CYCLES consecutive cycles confirm
   *         the divergence. The cost of waiting is one extra cycle of
   *         phantom loss; the cost of NOT waiting is that a real
   *         fast-crash gets quietly masked out.
   *  3. Every baseline mutation is logged with a single `[BaselineAudit]`
   *     line — date, reason, before, after — so the next time something
   *     drifts the cause is greppable from Railway logs.
   */
  updateBaselines(portfolioValue: number): void {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const bs = this.state.getBreakerState();

    // ── Sanity thresholds ──────────────────────────────────────────────────
    // A "suspicious delta" is >35% movement between the previous baseline
    // and a new candidate at date rollover, in either direction. Real
    // 35%-in-a-day moves happen (March 2020), but they're rare enough that
    // deferring one cycle to recapture is cheap insurance.
    const DAILY_DELTA_SANITY = 0.35;
    // A "suspicious stuck baseline" is when the running portfolio diverges
    // from the stored baseline by >25%. That's the same 25% sanity cap the
    // dashboard uses to hide "Today's P&L" as "Calibrating".
    const STUCK_BASELINE_THRESHOLD = 0.25;
    // Stuck-HIGH self-heal requires N consecutive confirmation cycles to
    // avoid masking a real flash-crash. 3 cycles ≈ 30-45 min at the bot's
    // current 10-15 min cycle cadence — long enough that a real crash
    // would have triggered the daily-drawdown breaker before we masked it.
    const STUCK_HIGH_CONFIRMATION_CYCLES = 3;

    if (bs.dailyBaseline.date !== dateStr) {
      // Date rollover — decide whether to capture or defer.
      const previousValue = bs.dailyBaseline.value;
      const absoluteDelta = previousValue > 0
        ? Math.abs(portfolioValue - previousValue) / previousValue
        : 0;
      const direction = portfolioValue < previousValue ? 'below' : 'above';

      if (previousValue > 0 && absoluteDelta > DAILY_DELTA_SANITY) {
        // Suspicious in either direction. Defer capture — keep yesterday's
        // date so we retry next cycle. Mark not-validated so the dashboard
        // shows "Calibrating".
        console.log(
          `[BaselineAudit] rollover-deferred date=${dateStr} reason=delta-sanity ` +
          `previous=$${previousValue.toFixed(2)} candidate=$${portfolioValue.toFixed(2)} ` +
          `delta=${(absoluteDelta * 100).toFixed(1)}%(${direction}) threshold=${(DAILY_DELTA_SANITY * 100).toFixed(0)}%`,
        );
        this.state.setDailyBaselineValidated(false);
      } else {
        const before = previousValue;
        this.state.setDailyBaseline(dateStr, portfolioValue);
        this.state.setDailyBaselineValidated(true);
        this._stuckHighCycles = 0;
        console.log(
          `[BaselineAudit] rollover-captured date=${dateStr} value=$${portfolioValue.toFixed(2)} ` +
          `previous=$${before.toFixed(2)} delta=${previousValue > 0 ? `${(absoluteDelta * 100).toFixed(1)}%(${direction})` : 'n/a-first-baseline'}`,
        );
      }
    } else if (bs.dailyBaseline.value > 0) {
      // Same day — check for stuck-baseline self-heal in either direction.
      const delta = (portfolioValue - bs.dailyBaseline.value) / bs.dailyBaseline.value;

      if (delta > STUCK_BASELINE_THRESHOLD) {
        // Stuck-LOW baseline (portfolio is much higher) — self-heal up
        // immediately. Common cause: the morning capture happened during a
        // pricing glitch that under-counted a position. Reset stuck-high
        // counter since this is the opposite direction.
        const before = bs.dailyBaseline.value;
        this.state.setDailyBaseline(dateStr, portfolioValue);
        this.state.setDailyBaselineValidated(true);
        this._stuckHighCycles = 0;
        console.log(
          `[BaselineAudit] self-heal-up date=${dateStr} before=$${before.toFixed(2)} ` +
          `after=$${portfolioValue.toFixed(2)} delta=+${(delta * 100).toFixed(1)}% (stored baseline was stuck low)`,
        );
      } else if (delta < -STUCK_BASELINE_THRESHOLD) {
        // Stuck-HIGH baseline (portfolio is much lower) — needs
        // confirmation. A single high-baseline cycle could legitimately be
        // a real fast-crash that we'd want the daily-drawdown trigger to
        // see, not the self-heal to mask.
        this._stuckHighCycles += 1;
        if (this._stuckHighCycles >= STUCK_HIGH_CONFIRMATION_CYCLES) {
          const before = bs.dailyBaseline.value;
          this.state.setDailyBaseline(dateStr, portfolioValue);
          this.state.setDailyBaselineValidated(true);
          this._stuckHighCycles = 0;
          console.log(
            `[BaselineAudit] self-heal-down date=${dateStr} before=$${before.toFixed(2)} ` +
            `after=$${portfolioValue.toFixed(2)} delta=${(delta * 100).toFixed(1)}% confirmedCycles=${STUCK_HIGH_CONFIRMATION_CYCLES} ` +
            `(stored baseline was stuck high — likely phantom rollover capture)`,
          );
        } else {
          console.log(
            `[BaselineAudit] stuck-high-watching date=${dateStr} stored=$${bs.dailyBaseline.value.toFixed(2)} ` +
            `current=$${portfolioValue.toFixed(2)} delta=${(delta * 100).toFixed(1)}% ` +
            `confirmCount=${this._stuckHighCycles}/${STUCK_HIGH_CONFIRMATION_CYCLES}`,
          );
        }
      } else {
        // Within tolerance — reset the stuck-high counter so a transient
        // dip doesn't accumulate toward a false self-heal.
        if (this._stuckHighCycles > 0) {
          this._stuckHighCycles = 0;
        }
      }
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
