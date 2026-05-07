/**
 * NVR-SPEC-028 Phase 5: Alpha Auto-Promoter
 *
 * The first four phases shipped a complete pipeline (Watcher → Reviewer →
 * Reflex → Learning) but the Reflex stays in dry-run forever unless someone
 * flips ALPHA_REFLEX_MODE=live. Asking Henry to manually monitor and flip
 * is exactly the wrong shape.
 *
 * The Promoter runs on an hourly cron, evaluates promotion criteria from
 * the learning report, and:
 *   - Auto-promotes Reflex from dry-run → live when conditions are met
 *   - Auto-demotes from live → dry-run if performance degrades
 *   - Sends Telegram notification on every state change
 *
 * Promotion criteria (ALL must hold):
 *   - n ≥ MIN_DRYRUN_TRADES dry-run closed positions in trailing 24h (default 10)
 *   - Dry-run target hit rate ≥ MIN_HITRATE_FOR_PROMOTION (default 40%)
 *   - At least one trigger type is KEEP_CANDIDATE (≥40% hit rate, n≥10)
 *   - Reviewer is REVIEWER_HELPS or REVIEWER_NEUTRAL (not HURTS)
 *   - Reflex realized P&L ≥ 0 in dry-run window
 *
 * Demotion criteria (ANY triggers):
 *   - In live mode for ≥ MIN_LIVE_HOURS_BEFORE_DEMOTE (default 6h)
 *   - 3+ consecutive STOP_HIT exits
 *   - OR live target hit rate drops below MIN_HITRATE_FOR_LIVE (default 25%)
 *     over rolling 24h window with n ≥ 5
 *
 * Cron cadence:
 *   Every PROMOTER_CHECK_INTERVAL_SEC (default 3600s = 1h). First check
 *   fires PROMOTER_FIRST_CHECK_DELAY_SEC (default 1800s = 30min) after
 *   startup so the system has time to accumulate data.
 *
 * Persistence:
 *   The current Reflex mode override is stored in
 *   `state.alphaReflexModeOverride` (added to AgentState). Persisted across
 *   restarts so a redeploy doesn't reset live → dry-run mid-soak.
 *
 * Hard kill switches:
 *   - ALPHA_PROMOTER_ENABLED=false: Promoter doesn't run at all
 *   - ALPHA_REFLEX_MODE=disabled: Reflex itself is disabled (Promoter
 *     respects this — never promotes a disabled service)
 *
 * Future v2: more sophisticated criteria (per-trigger-type performance,
 * volatility regime awareness, time-of-day gates).
 */

import { alphaLearning } from './alpha-learning.js';
import { alphaReflex, type ReflexMode } from './alpha-reflex.js';
import { telegramService } from './telegram.js';
import { getState, markStateDirty } from '../state/index.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const PROMOTER_CONFIG = {
  CHECK_INTERVAL_SEC: parseInt(process.env.ALPHA_PROMOTER_CHECK_SEC ?? '3600', 10) || 3600,
  FIRST_CHECK_DELAY_SEC: parseInt(process.env.ALPHA_PROMOTER_FIRST_DELAY_SEC ?? '1800', 10) || 1800,

  // Promotion gates
  MIN_DRYRUN_TRADES: 10,
  MIN_HITRATE_FOR_PROMOTION: 0.4,
  PROMOTION_WINDOW_HOURS: 24,

  // Demotion gates
  MIN_LIVE_HOURS_BEFORE_DEMOTE: 6,
  CONSECUTIVE_STOPS_TO_DEMOTE: 3,
  MIN_HITRATE_FOR_LIVE: 0.25,
  DEMOTION_WINDOW_HOURS: 24,
  DEMOTION_MIN_LIVE_TRADES: 5,
};

// ============================================================================
// PROMOTER CLASS
// ============================================================================

export interface PromoterDecision {
  decidedAt: string;
  currentMode: ReflexMode;
  recommendedMode: ReflexMode;
  action: 'PROMOTE' | 'DEMOTE' | 'HOLD';
  reasons: string[];
  blockers: string[];
  /** Snapshot of the metrics that drove the decision */
  metrics: {
    dryRunClosed24h: number;
    dryRunHitRate: number | null;
    dryRunRealizedPnlUSD: number;
    liveClosed24h: number;
    liveHitRate: number | null;
    consecutiveStops: number;
    keepCandidateTriggers: number;
    reviewerVerdict: string;
  };
}

export class AlphaPromoter {
  private interval: ReturnType<typeof setInterval> | null = null;
  private firstCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private liveSinceTs: number | null = null;
  private decisions: PromoterDecision[] = [];

  start(): void {
    if (this.interval) return;
    if ((process.env.ALPHA_PROMOTER_ENABLED ?? 'false').toLowerCase() !== 'true') {
      console.log('[AlphaPromoter] disabled (ALPHA_PROMOTER_ENABLED != true)');
      return;
    }
    console.log(
      `[AlphaPromoter] starting — first check in ${PROMOTER_CONFIG.FIRST_CHECK_DELAY_SEC}s, then every ${PROMOTER_CONFIG.CHECK_INTERVAL_SEC}s`,
    );

    // First check fires after a delay so we have data to evaluate
    this.firstCheckTimer = setTimeout(() => {
      this.tick().catch((e) => {
        console.warn(`[AlphaPromoter] first tick failed: ${e?.message ?? e}`);
      });
      this.interval = setInterval(() => {
        this.tick().catch((e) => {
          console.warn(`[AlphaPromoter] tick failed: ${e?.message ?? e}`);
        });
      }, PROMOTER_CONFIG.CHECK_INTERVAL_SEC * 1000);
    }, PROMOTER_CONFIG.FIRST_CHECK_DELAY_SEC * 1000);
  }

  stop(): void {
    if (this.firstCheckTimer) {
      clearTimeout(this.firstCheckTimer);
      this.firstCheckTimer = null;
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Evaluate current performance, decide whether to promote/demote/hold,
   * and apply the change. Returns the decision for logging/inspection.
   */
  async tick(): Promise<PromoterDecision> {
    const decision = this.evaluate();
    this.decisions.push(decision);
    if (this.decisions.length > 100) this.decisions = this.decisions.slice(-100);

    if (decision.action === 'PROMOTE') {
      await this.applyPromotion(decision);
    } else if (decision.action === 'DEMOTE') {
      await this.applyDemotion(decision);
    } else {
      // HOLD — log periodically but don't notify
      console.log(
        `[AlphaPromoter] HOLD (mode=${decision.currentMode}). Reasons: ${decision.blockers.slice(0, 3).join('; ')}`,
      );
    }

    return decision;
  }

  evaluate(): PromoterDecision {
    const status = alphaReflex.getStatus();
    const reflexClosed = alphaReflex.getRecentClosed(200);
    const cutoff = Date.now() - PROMOTER_CONFIG.PROMOTION_WINDOW_HOURS * 60 * 60 * 1000;
    const recent = reflexClosed.filter((p) => new Date(p.exitedAt).getTime() >= cutoff);

    // Dry-run metrics
    const dryRunRecent = recent.filter((p) => !p.executed);
    const dryRunDef = dryRunRecent.filter((p) => p.exitReason === 'TARGET_HIT' || p.exitReason === 'STOP_HIT');
    const dryRunTargetHit = dryRunDef.filter((p) => p.exitReason === 'TARGET_HIT').length;
    const dryRunHitRate = dryRunDef.length > 0 ? dryRunTargetHit / dryRunDef.length : null;
    const dryRunPnl = dryRunRecent.reduce((s, p) => s + p.realizedPnlUSD, 0);

    // Live metrics
    const liveRecent = recent.filter((p) => p.executed);
    const liveDef = liveRecent.filter((p) => p.exitReason === 'TARGET_HIT' || p.exitReason === 'STOP_HIT');
    const liveTargetHit = liveDef.filter((p) => p.exitReason === 'TARGET_HIT').length;
    const liveHitRate = liveDef.length > 0 ? liveTargetHit / liveDef.length : null;

    // Consecutive stops in live mode (most-recent backwards)
    let consecutiveStops = 0;
    for (let i = liveRecent.length - 1; i >= 0; i--) {
      if (liveRecent[i].exitReason === 'STOP_HIT') consecutiveStops++;
      else break;
    }

    // Learning report — count KEEP_CANDIDATE trigger types + reviewer verdict
    const report = alphaLearning.generateReport(PROMOTER_CONFIG.PROMOTION_WINDOW_HOURS);
    const keepCandidates = report.triggerPerformance.filter((t) => t.verdict === 'KEEP_CANDIDATE').length;
    const reviewerVerdict = report.reviewerAccuracy.verdict;

    const metrics = {
      dryRunClosed24h: dryRunRecent.length,
      dryRunHitRate,
      dryRunRealizedPnlUSD: dryRunPnl,
      liveClosed24h: liveRecent.length,
      liveHitRate,
      consecutiveStops,
      keepCandidateTriggers: keepCandidates,
      reviewerVerdict,
    };

    // Decide
    const reasons: string[] = [];
    const blockers: string[] = [];
    let action: PromoterDecision['action'] = 'HOLD';
    let recommendedMode: ReflexMode = status.mode;

    if (status.mode === 'dry-run') {
      // Promotion check
      if (dryRunRecent.length >= PROMOTER_CONFIG.MIN_DRYRUN_TRADES) {
        reasons.push(`Dry-run sample size: ${dryRunRecent.length} ≥ ${PROMOTER_CONFIG.MIN_DRYRUN_TRADES}`);
      } else {
        blockers.push(`Need ${PROMOTER_CONFIG.MIN_DRYRUN_TRADES - dryRunRecent.length} more dry-run closes (have ${dryRunRecent.length})`);
      }
      if (dryRunHitRate !== null && dryRunHitRate >= PROMOTER_CONFIG.MIN_HITRATE_FOR_PROMOTION) {
        reasons.push(`Dry-run hit rate: ${(dryRunHitRate * 100).toFixed(0)}% ≥ ${(PROMOTER_CONFIG.MIN_HITRATE_FOR_PROMOTION * 100).toFixed(0)}%`);
      } else {
        blockers.push(`Dry-run hit rate ${dryRunHitRate === null ? 'n/a' : (dryRunHitRate * 100).toFixed(0) + '%'} < ${(PROMOTER_CONFIG.MIN_HITRATE_FOR_PROMOTION * 100).toFixed(0)}%`);
      }
      if (keepCandidates >= 1) {
        reasons.push(`${keepCandidates} trigger type(s) are KEEP_CANDIDATE`);
      } else {
        blockers.push(`No trigger types yet qualify as KEEP_CANDIDATE`);
      }
      if (reviewerVerdict === 'REVIEWER_HELPS' || reviewerVerdict === 'REVIEWER_NEUTRAL') {
        reasons.push(`Reviewer verdict: ${reviewerVerdict}`);
      } else if (reviewerVerdict === 'REVIEWER_HURTS') {
        blockers.push(`Reviewer is REVIEWER_HURTS — fix or disable Reviewer first`);
      } else {
        blockers.push(`Reviewer verdict: ${reviewerVerdict} (need more data)`);
      }
      if (dryRunPnl >= 0) {
        reasons.push(`Dry-run P&L: $${dryRunPnl.toFixed(2)} ≥ 0`);
      } else {
        blockers.push(`Dry-run P&L negative: $${dryRunPnl.toFixed(2)}`);
      }

      if (blockers.length === 0) {
        action = 'PROMOTE';
        recommendedMode = 'live';
      }
    } else if (status.mode === 'live') {
      // Demotion check
      const liveSinceMs = this.liveSinceTs ?? Date.now();
      const liveHours = (Date.now() - liveSinceMs) / (60 * 60 * 1000);

      if (liveHours < PROMOTER_CONFIG.MIN_LIVE_HOURS_BEFORE_DEMOTE) {
        blockers.push(`In live mode only ${liveHours.toFixed(1)}h — minimum ${PROMOTER_CONFIG.MIN_LIVE_HOURS_BEFORE_DEMOTE}h before demote eligible`);
      } else if (consecutiveStops >= PROMOTER_CONFIG.CONSECUTIVE_STOPS_TO_DEMOTE) {
        action = 'DEMOTE';
        recommendedMode = 'dry-run';
        reasons.push(`${consecutiveStops} consecutive STOP_HIT exits — demote to dry-run`);
      } else if (
        liveDef.length >= PROMOTER_CONFIG.DEMOTION_MIN_LIVE_TRADES &&
        liveHitRate !== null &&
        liveHitRate < PROMOTER_CONFIG.MIN_HITRATE_FOR_LIVE
      ) {
        action = 'DEMOTE';
        recommendedMode = 'dry-run';
        reasons.push(`Live hit rate ${(liveHitRate * 100).toFixed(0)}% < ${(PROMOTER_CONFIG.MIN_HITRATE_FOR_LIVE * 100).toFixed(0)}% over ${liveDef.length} trades`);
      } else {
        reasons.push(`Live performance OK: ${liveHitRate === null ? 'n/a' : (liveHitRate * 100).toFixed(0) + '%'} hit rate over ${liveDef.length} trades, ${consecutiveStops} consecutive stops`);
      }
    }

    return {
      decidedAt: new Date().toISOString(),
      currentMode: status.mode,
      recommendedMode,
      action,
      reasons,
      blockers,
      metrics,
    };
  }

  // --------------------------------------------------------------------------
  // ACTIONS
  // --------------------------------------------------------------------------

  private async applyPromotion(d: PromoterDecision): Promise<void> {
    alphaReflex.setMode('live');
    this.liveSinceTs = Date.now();
    // Persist override so a restart doesn't lose the promotion
    const state = getState() as any;
    state.alphaReflexModeOverride = 'live';
    markStateDirty();
    console.log(`[AlphaPromoter] PROMOTED dry-run → live. Reasons: ${d.reasons.join('; ')}`);
    await this.notify({
      severity: 'HIGH',
      title: 'AlphaHunter Reflex PROMOTED to LIVE',
      message: `Auto-promotion criteria satisfied. Reflex now executing real trades up to $${alphaReflex.getStatus().budget.maxUSD} budget.`,
      data: {
        dryRunClosed24h: d.metrics.dryRunClosed24h,
        dryRunHitRate: d.metrics.dryRunHitRate === null ? 'n/a' : `${(d.metrics.dryRunHitRate * 100).toFixed(0)}%`,
        dryRunPnl: `$${d.metrics.dryRunRealizedPnlUSD.toFixed(2)}`,
        keepCandidates: d.metrics.keepCandidateTriggers,
        reviewer: d.metrics.reviewerVerdict,
      },
    });
  }

  private async applyDemotion(d: PromoterDecision): Promise<void> {
    alphaReflex.setMode('dry-run');
    this.liveSinceTs = null;
    const state = getState() as any;
    state.alphaReflexModeOverride = 'dry-run';
    markStateDirty();
    console.log(`[AlphaPromoter] DEMOTED live → dry-run. Reasons: ${d.reasons.join('; ')}`);
    await this.notify({
      severity: 'CRITICAL',
      title: 'AlphaHunter Reflex DEMOTED to dry-run',
      message: `Live performance degraded. Reflex returned to dry-run for safety. Investigate before re-promoting.`,
      data: {
        liveClosed24h: d.metrics.liveClosed24h,
        liveHitRate: d.metrics.liveHitRate === null ? 'n/a' : `${(d.metrics.liveHitRate * 100).toFixed(0)}%`,
        consecutiveStops: d.metrics.consecutiveStops,
      },
    });
  }

  private async notify(alert: {
    severity: 'CRITICAL' | 'HIGH' | 'INFO';
    title: string;
    message: string;
    data?: Record<string, string | number>;
  }): Promise<void> {
    try {
      await telegramService.sendAlert(alert);
    } catch (e: any) {
      console.warn(`[AlphaPromoter] telegram notify failed: ${e?.message ?? e}`);
    }
  }

  // --------------------------------------------------------------------------
  // PUBLIC READ
  // --------------------------------------------------------------------------

  getRecentDecisions(limit = 20): PromoterDecision[] {
    return this.decisions.slice(-limit).reverse();
  }

  /**
   * Restore live-since timestamp from persisted state on startup. Called
   * by the bot's main() after state is loaded — lets us not demote
   * immediately if a restart happens mid-soak.
   */
  restoreFromState(): void {
    const state = getState() as any;
    if (state.alphaReflexModeOverride === 'live' && !this.liveSinceTs) {
      this.liveSinceTs = Date.now() - PROMOTER_CONFIG.MIN_LIVE_HOURS_BEFORE_DEMOTE * 60 * 60 * 1000;
      // Set to "exactly the minimum threshold ago" so the next tick still
      // requires fresh hit-rate evidence to demote, but the time-gate is satisfied.
    }
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

export const alphaPromoter = new AlphaPromoter();
