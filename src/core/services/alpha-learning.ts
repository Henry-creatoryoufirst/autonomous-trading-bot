/**
 * NVR-SPEC-028 Phase 4: Outcome Learning Loop
 *
 * The Watcher fires triggers. The Reviewer judges them. The Reflex acts
 * (or simulates). This service closes the loop: every day, it audits the
 * graded outcomes and produces a recommendation report:
 *
 *   - Per-trigger-type hit rate over the trailing window
 *   - Reviewer accuracy (BUY-verdict hit rate vs Watcher-alone baseline)
 *   - Reflex P&L (when in live mode) per token / per trigger type
 *   - Threshold tuning suggestions (which thresholds are too loose / tight)
 *   - Trigger types to KILL (zero hit rate over n>20 sample)
 *
 * Phase 4 v1 is REPORT-ONLY — it produces the audit but doesn't auto-tune
 * thresholds or auto-disable trigger types. Henry reads the report,
 * decides whether the recommendations are right, edits the constants in
 * alpha-watcher.ts. Future v2 can wire automated retuning behind a flag.
 *
 * The report runs:
 *   - On-demand via /api/admin/alpha-learning?action=report
 *   - Optionally on a daily cron (ALPHA_LEARNING_CRON_ENABLED=true), at
 *     08:30 UTC (right after the harvest payout — natural daily tick).
 *
 * Cost: $0. All offline aggregation over data the Watcher already records.
 */

import { alphaWatcher, type AlphaTrigger, type TriggerType } from './alpha-watcher.js';
import { alphaReflex } from './alpha-reflex.js';

// ============================================================================
// TYPES
// ============================================================================

export interface LearningReport {
  generatedAt: string;
  windowHours: number;
  totalTriggersAnalyzed: number;
  totalResolved: number;
  totalOpen: number;

  /**
   * Per-trigger-type performance over the window. Sorted by hit rate desc.
   * KILL_CANDIDATES = types with n≥10 and hitRate=0%.
   * KEEP_CANDIDATES = types with n≥10 and hitRate ≥ 40%.
   * UNCERTAIN = everything else.
   */
  triggerPerformance: Array<{
    type: TriggerType;
    fired: number;
    resolved: number;
    targetHit: number;
    stopHit: number;
    decayed: number;
    hitRate: number | null;
    avgPctChangeOnTarget: number | null;
    avgPctChangeOnStop: number | null;
    verdict: 'KILL_CANDIDATE' | 'KEEP_CANDIDATE' | 'UNCERTAIN' | 'INSUFFICIENT_DATA';
  }>;

  /**
   * Reviewer's BUY-call accuracy. The number that decides whether the
   * Haiku gate is improving things or just adding cost.
   *
   * If reviewerBuyHitRate > watcherAloneHitRate: Reviewer is the gate
   * we need. If equal or worse: Reviewer is wasted spend.
   */
  reviewerAccuracy: {
    buyVerdictsCount: number;
    buyResolved: number;
    buyTargetHit: number;
    buyHitRate: number | null;
    /** Watcher-alone hit rate over the same window (no Reviewer gate) */
    watcherAloneHitRate: number | null;
    /** Did Haiku improve precision? */
    delta: number | null;
    verdict: 'REVIEWER_HELPS' | 'REVIEWER_NEUTRAL' | 'REVIEWER_HURTS' | 'INSUFFICIENT_DATA';
  };

  /**
   * Reflex P&L summary. Empty if Reflex is disabled or hasn't fired.
   */
  reflexSummary: {
    mode: string;
    totalPositions24h: number;
    targetHits: number;
    stopHits: number;
    timeouts: number;
    realizedPnlUSD: number;
    /** Avg holding time across closed positions in minutes */
    avgHoldMinutes: number | null;
  };

  /**
   * Concrete recommendations Henry can apply by editing constants.
   */
  recommendations: string[];
}

// ============================================================================
// LEARNING CLASS
// ============================================================================

const KILL_CANDIDATE_MIN_SAMPLE = 10;
const KEEP_CANDIDATE_MIN_HITRATE = 0.4;
const REVIEWER_DELTA_HELPS_THRESHOLD = 0.05; // +5pp better than Watcher alone

export class AlphaLearning {
  /**
   * Generate a report over the last N hours. Default 24h.
   * Pulls from in-memory state of the Watcher + Reflex services.
   */
  generateReport(windowHours = 24): LearningReport {
    const cutoff = Date.now() - windowHours * 60 * 60 * 1000;

    // Pull the full trigger log (limited to ring buffer, but we only use
    // the windowed subset anyway).
    const triggers: AlphaTrigger[] = alphaWatcher.getTriggers(500);
    const recent = triggers.filter((t) => new Date(t.raisedAt).getTime() >= cutoff);
    const resolved = recent.filter((t) => t.outcome && t.outcome.status !== 'OPEN');
    const open = recent.filter((t) => t.outcome && t.outcome.status === 'OPEN');

    // Per-trigger-type aggregation
    const byType = new Map<
      TriggerType,
      {
        fired: number;
        resolved: number;
        targetHit: number;
        stopHit: number;
        decayed: number;
        targetPctSum: number;
        stopPctSum: number;
      }
    >();

    for (const t of recent) {
      let slot = byType.get(t.type);
      if (!slot) {
        slot = { fired: 0, resolved: 0, targetHit: 0, stopHit: 0, decayed: 0, targetPctSum: 0, stopPctSum: 0 };
        byType.set(t.type, slot);
      }
      slot.fired++;
      const o = t.outcome;
      if (!o || o.status === 'OPEN') continue;
      slot.resolved++;
      if (o.status === 'TARGET_HIT') {
        slot.targetHit++;
        slot.targetPctSum += o.finalPctChange;
      } else if (o.status === 'STOP_HIT') {
        slot.stopHit++;
        slot.stopPctSum += o.finalPctChange;
      } else if (o.status === 'DECAYED') {
        slot.decayed++;
      }
    }

    const triggerPerformance: LearningReport['triggerPerformance'] = [];
    for (const [type, slot] of byType.entries()) {
      const definitive = slot.targetHit + slot.stopHit;
      const hitRate = definitive > 0 ? slot.targetHit / definitive : null;
      let verdict: LearningReport['triggerPerformance'][number]['verdict'];
      if (slot.fired < KILL_CANDIDATE_MIN_SAMPLE) verdict = 'INSUFFICIENT_DATA';
      else if (hitRate !== null && hitRate === 0) verdict = 'KILL_CANDIDATE';
      else if (hitRate !== null && hitRate >= KEEP_CANDIDATE_MIN_HITRATE) verdict = 'KEEP_CANDIDATE';
      else verdict = 'UNCERTAIN';
      triggerPerformance.push({
        type,
        fired: slot.fired,
        resolved: slot.resolved,
        targetHit: slot.targetHit,
        stopHit: slot.stopHit,
        decayed: slot.decayed,
        hitRate,
        avgPctChangeOnTarget: slot.targetHit > 0 ? slot.targetPctSum / slot.targetHit : null,
        avgPctChangeOnStop: slot.stopHit > 0 ? slot.stopPctSum / slot.stopHit : null,
        verdict,
      });
    }
    triggerPerformance.sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1));

    // Reviewer accuracy: hit rate of BUY verdicts vs all-triggers baseline
    const reviewedRecent = recent.filter((t) => t.review && t.review.verdict);
    const buyVerdicts = reviewedRecent.filter((t) => t.review!.verdict === 'BUY');
    const buyResolved = buyVerdicts.filter((t) => t.outcome && (t.outcome.status === 'TARGET_HIT' || t.outcome.status === 'STOP_HIT'));
    const buyTargetHit = buyResolved.filter((t) => t.outcome!.status === 'TARGET_HIT').length;
    const buyHitRate = buyResolved.length > 0 ? buyTargetHit / buyResolved.length : null;

    const allDefinitive = resolved.filter((t) => t.outcome!.status === 'TARGET_HIT' || t.outcome!.status === 'STOP_HIT');
    const allTargetHit = allDefinitive.filter((t) => t.outcome!.status === 'TARGET_HIT').length;
    const watcherAloneHitRate = allDefinitive.length > 0 ? allTargetHit / allDefinitive.length : null;

    const delta = buyHitRate !== null && watcherAloneHitRate !== null ? buyHitRate - watcherAloneHitRate : null;
    let reviewerVerdict: LearningReport['reviewerAccuracy']['verdict'];
    if (buyResolved.length < KILL_CANDIDATE_MIN_SAMPLE) reviewerVerdict = 'INSUFFICIENT_DATA';
    else if (delta !== null && delta >= REVIEWER_DELTA_HELPS_THRESHOLD) reviewerVerdict = 'REVIEWER_HELPS';
    else if (delta !== null && delta <= -REVIEWER_DELTA_HELPS_THRESHOLD) reviewerVerdict = 'REVIEWER_HURTS';
    else reviewerVerdict = 'REVIEWER_NEUTRAL';

    // Reflex summary
    const reflexStatus = alphaReflex.getStatus();
    const reflexClosed = alphaReflex.getRecentClosed(200).filter((p) => new Date(p.exitedAt).getTime() >= cutoff);
    const totalHoldMs = reflexClosed.reduce((s, p) => s + (new Date(p.exitedAt).getTime() - new Date(p.entryAt).getTime()), 0);
    const avgHoldMinutes = reflexClosed.length > 0 ? totalHoldMs / reflexClosed.length / 60_000 : null;

    // Recommendations
    const recs: string[] = [];
    for (const tp of triggerPerformance) {
      if (tp.verdict === 'KILL_CANDIDATE') {
        recs.push(`KILL: ${tp.type} fired ${tp.fired}× with 0% hit rate. Either raise threshold significantly or remove from scoring loop.`);
      } else if (tp.verdict === 'KEEP_CANDIDATE') {
        recs.push(`KEEP: ${tp.type} hitRate ${(tp.hitRate! * 100).toFixed(0)}% over ${tp.resolved} resolved triggers. Strong signal — consider lowering threshold to fire more often.`);
      } else if (tp.verdict === 'UNCERTAIN' && tp.fired >= 20 && tp.hitRate !== null && tp.hitRate < 0.2) {
        recs.push(`TUNE: ${tp.type} hitRate ${(tp.hitRate * 100).toFixed(0)}% — below 20%. Raise threshold to filter weak signals.`);
      }
    }
    if (reviewerVerdict === 'REVIEWER_HURTS') {
      recs.push(`KILL REVIEWER: Reviewer BUY hit rate ${(buyHitRate! * 100).toFixed(0)}% < Watcher-alone ${(watcherAloneHitRate! * 100).toFixed(0)}%. Haiku is filtering out winners. Disable ALPHA_REVIEWER_ENABLED.`);
    } else if (reviewerVerdict === 'REVIEWER_HELPS') {
      recs.push(`KEEP REVIEWER: BUY hit rate ${(buyHitRate! * 100).toFixed(0)}% beats Watcher-alone by ${(delta! * 100).toFixed(0)}pp. Reviewer is earning its keep.`);
    }
    if (reflexStatus.mode === 'dry-run' && reflexClosed.length >= 5) {
      const targetRatio = reflexStatus.byOutcome24h.TARGET_HIT / Math.max(1, reflexClosed.length);
      if (targetRatio >= 0.4) {
        recs.push(`PROMOTE REFLEX TO LIVE: Dry-run target hit rate ${(targetRatio * 100).toFixed(0)}% over ${reflexClosed.length} simulated trades. Strong enough to risk capital.`);
      } else if (targetRatio < 0.2) {
        recs.push(`HOLD REFLEX IN DRY-RUN: Dry-run target hit rate ${(targetRatio * 100).toFixed(0)}% — too low to risk capital. Tune triggers first.`);
      }
    }

    if (recs.length === 0) {
      recs.push(`No actionable recommendations yet. Need n≥${KILL_CANDIDATE_MIN_SAMPLE} resolved triggers per type. Continue soaking.`);
    }

    return {
      generatedAt: new Date().toISOString(),
      windowHours,
      totalTriggersAnalyzed: recent.length,
      totalResolved: resolved.length,
      totalOpen: open.length,
      triggerPerformance,
      reviewerAccuracy: {
        buyVerdictsCount: buyVerdicts.length,
        buyResolved: buyResolved.length,
        buyTargetHit,
        buyHitRate,
        watcherAloneHitRate,
        delta,
        verdict: reviewerVerdict,
      },
      reflexSummary: {
        mode: reflexStatus.mode,
        totalPositions24h: reflexClosed.length,
        targetHits: reflexStatus.byOutcome24h.TARGET_HIT,
        stopHits: reflexStatus.byOutcome24h.STOP_HIT,
        timeouts: reflexStatus.byOutcome24h.TIMEOUT,
        realizedPnlUSD: reflexStatus.realizedPnl24hUSD,
        avgHoldMinutes,
      },
      recommendations: recs,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

export const alphaLearning = new AlphaLearning();
