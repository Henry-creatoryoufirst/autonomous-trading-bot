/**
 * Adaptive Thresholds Engine Service
 *
 * Extracted from agent-v3.2.ts — manages shadow proposals, threshold adaptation
 * with bounded gradual changes, walk-forward validation, and decay toward defaults.
 *
 * All functions accept state/dependencies as explicit parameters (no globals).
 *
 * v5.1: Shadow Model Validation — proposed changes require statistical significance
 * v20.0: Walk-forward validation — require confirmations from multiple market regimes
 * v21.2: Clamp ALL adaptive thresholds to THRESHOLD_BOUNDS on restore
 * v21.3: Raised confirmation thresholds, added decay toward defaults
 */

// ============================================================================
// TYPES
// ============================================================================

export type MarketRegime = "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "VOLATILE" | "UNKNOWN";

export interface AdaptiveThresholds {
  rsiOversold: number;              // Default 30
  rsiOverbought: number;            // Default 70
  confluenceBuy: number;            // Default 15
  confluenceSell: number;           // Default -15
  confluenceStrongBuy: number;      // Default 40
  confluenceStrongSell: number;     // Default -40
  profitTakeTarget: number;         // Default 20
  profitTakeSellPercent: number;    // Default 30
  stopLossPercent: number;          // Default -25
  trailingStopPercent: number;      // Default -20
  // v9.0: ATR-based multiplier tuning
  atrStopMultiplier: number;        // Default 2.5, tuned 1.5-4.0
  atrTrailMultiplier: number;       // Default 2.0, tuned 1.5-4.0
  regimeMultipliers: Record<MarketRegime, number>;  // Position size multiplier per regime
  history: Array<{
    timestamp: string;
    field: string;
    oldValue: number;
    newValue: number;
    reason: string;
  }>;
  lastAdapted: string | null;
  adaptationCount: number;
}

export interface ShadowProposal {
  field: string;
  proposedDelta: number;
  reason: string;
  proposedAt: string;
  confirmingReviews: number;      // How many subsequent reviews still agree
  contradictingReviews: number;   // How many subsequent reviews disagree
  status: "PENDING" | "PROMOTED" | "REJECTED";
  regimesSeen?: string[];         // v20.0: Market regimes that confirmed this proposal (walk-forward validation)
}

export interface PerformanceReviewPeriodStats {
  winRate: number;
  avgReturn: number;
  totalTrades: number;
  bestPattern: string | null;
  worstPattern: string | null;
  dominantRegime: MarketRegime | null;
}

export interface PerformanceReviewForAdaptation {
  periodStats: PerformanceReviewPeriodStats;
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const THRESHOLD_BOUNDS: Record<string, { min: number; max: number; maxStep: number }> = {
  rsiOversold:           { min: 20, max: 40, maxStep: 2 },
  rsiOverbought:         { min: 60, max: 80, maxStep: 2 },
  confluenceBuy:         { min: 5,  max: 20, maxStep: 2 },  // v21.3: capped at 20 (was 28) — death spiral hardening: high threshold → only worst signals pass → lose → raise → repeat
  confluenceSell:        { min: -30, max: -5, maxStep: 2 },
  confluenceStrongBuy:   { min: 25, max: 38, maxStep: 3 },  // v21.3: capped at 38 (was 45) — tighter ceiling to prevent paralysis
  confluenceStrongSell:  { min: -60, max: -25, maxStep: 3 },
  profitTakeTarget:      { min: 10, max: 40, maxStep: 2 },
  profitTakeSellPercent: { min: 15, max: 50, maxStep: 3 },
  stopLossPercent:       { min: -25, max: -12, maxStep: 2 },    // v12.2.2: widened from -6% ceiling — was causing churn
  trailingStopPercent:   { min: -20, max: -10, maxStep: 2 },   // v12.2.2: widened from -5% ceiling — too tight for altcoins
  atrStopMultiplier:     { min: 1.5, max: 4.0, maxStep: 0.25 }, // v9.0: ATR stop multiplier
  atrTrailMultiplier:    { min: 1.5, max: 4.0, maxStep: 0.25 }, // v9.0: ATR trail multiplier
};

// ============================================================================
// DEFAULTS
// ============================================================================

export function createDefaultAdaptiveThresholds(
  atrStopMultiplier: number,
  atrTrailMultiplier: number,
): AdaptiveThresholds {
  return {
    rsiOversold: 30,
    rsiOverbought: 70,
    confluenceBuy: 8,       // v11.4.22: Lowered from 15 — with no RSI/MACD history, scores stay near 0-8. Need lower bar to bootstrap trades.
    confluenceSell: -8,     // v11.4.22: Symmetrical with buy threshold
    confluenceStrongBuy: 30, // v11.4.22: Lowered from 40 — more achievable for conviction trades
    confluenceStrongSell: -30, // v11.4.22: Symmetrical
    profitTakeTarget: 15,    // v21.6: Lowered from 30% — harvest earlier, maintain dry powder
    profitTakeSellPercent: 30,
    stopLossPercent: -15,       // v6.2: tightened from -25%
    trailingStopPercent: -12,   // v6.2: tightened from -20%
    atrStopMultiplier,     // v9.0: 2.5x ATR default
    atrTrailMultiplier,    // v9.0: 2.0x ATR default
    regimeMultipliers: {
      TRENDING_UP: 1.3,       // v11.4.22: Aligned with constants.ts v9.4 values
      TRENDING_DOWN: 0.85,    // v11.4.22: Was 0.6 — still trade, just more selective
      RANGING: 0.9,           // v11.4.22: Was 0.8 — ranges are opportunity for a fast-cycling bot
      VOLATILE: 0.7,          // v11.4.22: Was 0.5 — vol = opportunity
      UNKNOWN: 0.8,           // v11.4.22: Was 0.7
    },
    history: [],
    lastAdapted: null,
    adaptationCount: 0,
  };
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Adapt thresholds based on performance review — bounded, gradual, audited.
 *
 * v5.1: Shadow Model Validation — proposed threshold changes must pass statistical
 * significance checks before being promoted to live. Changes sit in a "shadow" queue
 * and only apply after n=5+ confirming reviews or when p-value proxy drops below 0.10.
 *
 * v21.3: DECAY TOWARD DEFAULTS — every cycle, move each threshold 5% toward its default.
 * This counteracts the ratchet effect where thresholds only ever increase.
 *
 * Mutates thresholds and shadowProposals in place.
 */
export function adaptThresholds(
  review: PerformanceReviewForAdaptation,
  thresholds: AdaptiveThresholds,
  shadowProposals: ShadowProposal[],
  defaults: AdaptiveThresholds,
  currentRegime?: string,
): ShadowProposal[] {
  const t = thresholds;
  const { winRate, totalTrades } = review.periodStats;
  if (totalTrades < 3) return shadowProposals; // Not enough data to adapt

  // v5.1: Shadow model validation constants
  // v21.3: Raised MIN_CONFIRMING_REVIEWS 3→5, MIN_REGIME_DIVERSITY 2→3 to slow threshold drift.
  // The death spiral was caused by proposals promoting too quickly on thin evidence.
  const MIN_CONFIRMING_REVIEWS = 5;   // Need 5 consecutive confirmations (was 3)
  const MIN_SAMPLE_SIZE = 5;          // Need at least 5 trades in review period
  const MAX_CONTRADICTION_RATIO = 0.3; // Reject if >30% contradictions
  // v20.0: Walk-forward validation — require confirmations from 3+ market regimes (was 2)
  const MIN_REGIME_DIVERSITY = 3;     // Must be confirmed in 3+ different regimes

  const proposeAdaptation = (field: string, delta: number, reason: string) => {
    const bounds = THRESHOLD_BOUNDS[field];
    if (!bounds) return;

    // Check if there's already a pending proposal for this field in the same direction
    const existing = shadowProposals.find(
      p => p.field === field && p.status === "PENDING" && Math.sign(p.proposedDelta) === Math.sign(delta)
    );

    if (existing) {
      // Confirm existing proposal + track regime diversity
      existing.confirmingReviews++;
      if (currentRegime) {
        if (!existing.regimesSeen) existing.regimesSeen = [];
        if (!existing.regimesSeen.includes(currentRegime)) existing.regimesSeen.push(currentRegime);
      }
      const regimeCount = existing.regimesSeen?.length || 0;
      console.log(`     🔬 Shadow: ${field} confirmed (${existing.confirmingReviews}/${MIN_CONFIRMING_REVIEWS} reviews, ${regimeCount}/${MIN_REGIME_DIVERSITY} regimes)`);

      // Check if ready for promotion — requires both review count AND regime diversity
      const totalReviews = existing.confirmingReviews + existing.contradictingReviews;
      const contradictionRatio = totalReviews > 0 ? existing.contradictingReviews / totalReviews : 0;

      if (existing.confirmingReviews >= MIN_CONFIRMING_REVIEWS && contradictionRatio <= MAX_CONTRADICTION_RATIO && totalTrades >= MIN_SAMPLE_SIZE && regimeCount >= MIN_REGIME_DIVERSITY) {
        // PROMOTE — apply the change
        const currentVal = (t as any)[field] as number;
        const cappedDelta = Math.sign(existing.proposedDelta) * Math.min(Math.abs(existing.proposedDelta), bounds.maxStep);
        const newVal = Math.max(bounds.min, Math.min(bounds.max, currentVal + cappedDelta));
        if (newVal !== currentVal) {
          t.history.push({
            timestamp: new Date().toISOString(),
            field,
            oldValue: currentVal,
            newValue: newVal,
            reason: `SHADOW VALIDATED: ${existing.reason} (${existing.confirmingReviews} confirmations, ${existing.contradictingReviews} contradictions, ${totalTrades} trades)`,
          });
          (t as any)[field] = newVal;
          existing.status = "PROMOTED";
          console.log(`     ✅ Shadow PROMOTED: ${field}: ${currentVal} → ${newVal} (${existing.confirmingReviews} confirmations over ${totalReviews} reviews)`);
        }
      }
    } else {
      // Check for contradicting proposals (same field, opposite direction)
      const contradicted = shadowProposals.find(
        p => p.field === field && p.status === "PENDING" && Math.sign(p.proposedDelta) !== Math.sign(delta)
      );
      if (contradicted) {
        contradicted.contradictingReviews++;
        const totalReviews = contradicted.confirmingReviews + contradicted.contradictingReviews;
        const contradictionRatio = totalReviews > 0 ? contradicted.contradictingReviews / totalReviews : 0;
        if (contradictionRatio > MAX_CONTRADICTION_RATIO && totalReviews >= 3) {
          contradicted.status = "REJECTED";
          console.log(`     ❌ Shadow REJECTED: ${field} (${contradicted.contradictingReviews}/${totalReviews} contradictions)`);
        }
      }

      // Create new shadow proposal
      shadowProposals.push({
        field,
        proposedDelta: delta,
        reason,
        proposedAt: new Date().toISOString(),
        confirmingReviews: 1,
        contradictingReviews: 0,
        status: "PENDING",
        regimesSeen: currentRegime ? [currentRegime] : [],
      });
      console.log(`     🔬 Shadow: New proposal for ${field} (delta: ${delta > 0 ? "+" : ""}${delta}) — needs ${MIN_CONFIRMING_REVIEWS} confirmations`);
    }
  };

  // Low win rate → propose being more selective
  if (winRate < 0.35) {
    proposeAdaptation("confluenceBuy", 2, `Low win rate ${(winRate * 100).toFixed(0)}%`);
    proposeAdaptation("confluenceStrongBuy", 2, `Low win rate ${(winRate * 100).toFixed(0)}%`);
    proposeAdaptation("stopLossPercent", 2, `Tighten stops: win rate ${(winRate * 100).toFixed(0)}%`);
  }

  // High win rate → propose slightly more aggressive
  if (winRate > 0.65) {
    proposeAdaptation("confluenceBuy", -1, `High win rate ${(winRate * 100).toFixed(0)}%`);
  }

  // Negative avg return → propose tighter risk management
  if (review.periodStats.avgReturn < -2) {
    proposeAdaptation("stopLossPercent", 2, `Negative avg return $${review.periodStats.avgReturn.toFixed(2)}`);
    proposeAdaptation("trailingStopPercent", 2, `Negative avg return $${review.periodStats.avgReturn.toFixed(2)}`);
    // v9.0: Tighten ATR multipliers too (lower multiplier = tighter stop)
    proposeAdaptation("atrStopMultiplier", -0.25, `Negative avg return $${review.periodStats.avgReturn.toFixed(2)}`);
    proposeAdaptation("atrTrailMultiplier", -0.25, `Negative avg return $${review.periodStats.avgReturn.toFixed(2)}`);
  }

  // Strong avg return → propose letting winners run longer
  if (review.periodStats.avgReturn > 5) {
    proposeAdaptation("profitTakeTarget", 2, `Strong avg return $${review.periodStats.avgReturn.toFixed(2)}`);
    // v9.0: Widen ATR multipliers (higher multiplier = wider stop = let winners run)
    proposeAdaptation("atrStopMultiplier", 0.25, `Strong avg return $${review.periodStats.avgReturn.toFixed(2)}`);
    proposeAdaptation("atrTrailMultiplier", 0.25, `Strong avg return $${review.periodStats.avgReturn.toFixed(2)}`);
  }

  // v9.0: Low win rate → tighten ATR stops
  if (winRate < 0.35) {
    proposeAdaptation("atrStopMultiplier", -0.25, `Low win rate ${(winRate * 100).toFixed(0)}%`);
  }

  // Clean up old completed/rejected proposals (keep last 50)
  shadowProposals = shadowProposals.filter(p => p.status === "PENDING").concat(
    shadowProposals.filter(p => p.status !== "PENDING").slice(-20)
  );

  // v21.3: DECAY TOWARD DEFAULTS — every cycle, move each threshold 5% toward its default value.
  // This counteracts the ratchet effect where thresholds only ever increase.
  // Example: confluenceBuy=20, default=8 → 20 - (20-8)*0.05 = 19.4
  for (const field of Object.keys(THRESHOLD_BOUNDS)) {
    const currentVal = (t as any)[field] as number;
    const defaultVal = (defaults as any)[field] as number;
    if (currentVal !== undefined && defaultVal !== undefined && typeof currentVal === 'number' && typeof defaultVal === 'number') {
      const decayed = currentVal - (currentVal - defaultVal) * 0.05;
      const bounds = THRESHOLD_BOUNDS[field];
      const clamped = Math.max(bounds.min, Math.min(bounds.max, decayed));
      if (Math.abs(clamped - currentVal) > 0.01) {
        (t as any)[field] = clamped;
        console.log(`     📉 Decay: ${field} ${currentVal.toFixed(2)} → ${clamped.toFixed(2)} (default: ${defaultVal}, 5% pull)`);
      }
    }
  }

  // Trim audit trail to last 100 entries
  if (t.history.length > 100) t.history = t.history.slice(-100);
  t.lastAdapted = new Date().toISOString();
  t.adaptationCount++;

  return shadowProposals;
}

/**
 * Clamp all adaptive thresholds to THRESHOLD_BOUNDS.
 * v21.2: Applied on restore to prevent drifted values from persisting.
 */
export function clampThresholdsToBounds(thresholds: AdaptiveThresholds): void {
  for (const [field, bounds] of Object.entries(THRESHOLD_BOUNDS)) {
    const val = (thresholds as any)[field];
    if (typeof val === 'number') {
      const clamped = Math.max(bounds.min, Math.min(bounds.max, val));
      if (clamped !== val) {
        console.log(`  🔧 Clamped ${field}: ${val} → ${clamped} (bounds: [${bounds.min}, ${bounds.max}])`);
        (thresholds as any)[field] = clamped;
      }
    }
  }
}
