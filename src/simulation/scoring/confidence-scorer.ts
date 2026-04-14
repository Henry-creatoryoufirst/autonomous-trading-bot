/**
 * NVR Capital — Confidence Scorer
 *
 * Produces a confidence score for algorithm changes before deployment.
 * Score is based on backtest results across multiple market conditions
 * (bull, bear, ranging, volatile).
 *
 * Minimum confidence threshold must be met before allowing deployment.
 */

import type {
  ReplayResult,
  ConfidenceScore,
  ConfidenceScorerConfig,
  MarketCondition,
  ConditionBreakdown,
  PerformanceMetrics,
} from '../types.js';
import { DEFAULT_CONFIDENCE_CONFIG } from '../types.js';

// ============================================================================
// MAIN SCORER
// ============================================================================

/**
 * Calculate a confidence score for a strategy based on backtest results.
 *
 * @param result - Replay/backtest results
 * @param config - Scoring configuration
 * @returns Confidence score with breakdown and pass/fail
 */
export function calculateConfidence(
  result: ReplayResult,
  config: ConfidenceScorerConfig = DEFAULT_CONFIDENCE_CONFIG
): ConfidenceScore {
  const reasoning: string[] = [];

  // 1. Return Score (0-25): how well does it beat buy-and-hold?
  const returnScore = scoreReturns(result.metrics, config, reasoning);

  // 2. Risk Score (0-25): drawdown and risk-adjusted returns
  const riskScore = scoreRisk(result.metrics, config, reasoning);

  // 3. Consistency Score (0-25): win rate, profit factor, trade count
  const consistencyScore = scoreConsistency(result.metrics, config, reasoning);

  // 4. Robustness Score (0-25): performance across market conditions
  const robustnessScore = scoreRobustness(result.conditionBreakdown, config, reasoning);

  const overall = returnScore + riskScore + consistencyScore + robustnessScore;

  // Score by condition
  const byCondition = scoreByCondition(result.conditionBreakdown, config);

  // Check minimum per-condition confidence
  let allConditionsPass = true;
  for (const [condition, score] of Object.entries(byCondition)) {
    if (score < config.minimumConditionConfidence) {
      reasoning.push(
        `WARNING: ${condition} condition score ${score.toFixed(0)} below minimum ${config.minimumConditionConfidence}`
      );
      allConditionsPass = false;
    }
  }

  const passesThreshold = overall >= config.minimumConfidence && allConditionsPass;

  if (passesThreshold) {
    reasoning.push(`PASS: Overall confidence ${overall.toFixed(1)} >= ${config.minimumConfidence} threshold`);
  } else {
    reasoning.push(`FAIL: Overall confidence ${overall.toFixed(1)} or condition minimums not met`);
  }

  return {
    overall,
    byCondition,
    byMetric: {
      returnScore,
      riskScore,
      consistencyScore,
      robustnessScore,
    },
    passesThreshold,
    threshold: config.minimumConfidence,
    reasoning,
  };
}

// ============================================================================
// COMPONENT SCORERS
// ============================================================================

/**
 * Score returns (0-25).
 *
 * Uses max(Sharpe score, beat-hold score) as the primary component (0-15 pts).
 *
 * Rationale: either metric alone is incomplete —
 *   • A strategy with Sharpe 2.2 but missing a 100% bull-run deserves credit
 *     for outstanding risk-adjusted performance (Sharpe path wins).
 *   • A strategy with near-zero Sharpe that preserves capital in a -50% crash
 *     deserves credit for massive alpha vs hold (beat-hold path wins).
 * Taking the max rewards the strategy for whichever kind of excellence it shows.
 */
function scoreReturns(
  metrics: PerformanceMetrics,
  config: ConfidenceScorerConfig,
  reasoning: string[]
): number {
  // 1. Sharpe-based sub-score (0-15)
  let sharpeScore = 0;
  if (metrics.sharpeRatio >= 2.0) {
    sharpeScore = 15;
    reasoning.push(`Excellent Sharpe: ${metrics.sharpeRatio.toFixed(2)}`);
  } else if (metrics.sharpeRatio >= 1.0) {
    sharpeScore = 11;
    reasoning.push(`Strong Sharpe: ${metrics.sharpeRatio.toFixed(2)}`);
  } else if (metrics.sharpeRatio >= config.minimumSharpe) {
    sharpeScore = 7;
    reasoning.push(`Good Sharpe: ${metrics.sharpeRatio.toFixed(2)}`);
  } else if (metrics.sharpeRatio >= 0) {
    sharpeScore = 4;
    reasoning.push(`Positive Sharpe: ${metrics.sharpeRatio.toFixed(2)}`);
  } else {
    reasoning.push(`Negative Sharpe: ${metrics.sharpeRatio.toFixed(2)}`);
  }

  // 2. Beat-hold sub-score (0-15)
  const holdBeatPct = metrics.totalReturnPct - metrics.holdBaselinePct;
  let holdBeatScore = 0;
  if (holdBeatPct >= config.holdBeatThresholdPct * 2) {
    holdBeatScore = 15;
    reasoning.push(`Beat hold by ${holdBeatPct.toFixed(1)}% (strong alpha)`);
  } else if (holdBeatPct >= config.holdBeatThresholdPct) {
    holdBeatScore = 10;
    reasoning.push(`Beat hold by ${holdBeatPct.toFixed(1)}%`);
  } else if (holdBeatPct >= 0) {
    holdBeatScore = 5;
    reasoning.push(`Marginally beat hold (${holdBeatPct.toFixed(1)}%)`);
  } else {
    reasoning.push(`Hold outperformed by ${Math.abs(holdBeatPct).toFixed(1)}%`);
  }

  // Take the higher of Sharpe or beat-hold — reward the form of excellence achieved
  const primaryScore = Math.max(sharpeScore, holdBeatScore);

  // 3. Absolute return (0-10)
  let absoluteScore = 0;
  if (metrics.totalReturnPct > 20) {
    absoluteScore = 10;
    reasoning.push(`High absolute return: ${metrics.totalReturnPct.toFixed(1)}%`);
  } else if (metrics.totalReturnPct > 10) {
    absoluteScore = 7;
  } else if (metrics.totalReturnPct > 0) {
    absoluteScore = 4;
    reasoning.push(`Positive return: ${metrics.totalReturnPct.toFixed(1)}%`);
  } else if (metrics.totalReturnPct > -5) {
    absoluteScore = 1;
  }

  return Math.min(25, primaryScore + absoluteScore);
}

/**
 * Score risk management (0-25).
 * Based on drawdown, Sharpe ratio, and Sortino ratio.
 */
function scoreRisk(
  metrics: PerformanceMetrics,
  config: ConfidenceScorerConfig,
  reasoning: string[]
): number {
  let score = 0;

  // Drawdown scoring
  if (metrics.maxDrawdownPct < config.maxAcceptableDrawdownPct * 0.5) {
    score += 10;
    reasoning.push(`Low drawdown: ${metrics.maxDrawdownPct.toFixed(1)}%`);
  } else if (metrics.maxDrawdownPct < config.maxAcceptableDrawdownPct) {
    score += 6;
    reasoning.push(`Acceptable drawdown: ${metrics.maxDrawdownPct.toFixed(1)}%`);
  } else {
    score += 2;
    reasoning.push(`High drawdown: ${metrics.maxDrawdownPct.toFixed(1)}% exceeds ${config.maxAcceptableDrawdownPct}%`);
  }

  // Sharpe ratio
  if (metrics.sharpeRatio >= config.minimumSharpe * 3) {
    score += 10;
    reasoning.push(`Excellent Sharpe: ${metrics.sharpeRatio.toFixed(2)}`);
  } else if (metrics.sharpeRatio >= config.minimumSharpe) {
    score += 6;
    reasoning.push(`Good Sharpe: ${metrics.sharpeRatio.toFixed(2)}`);
  } else if (metrics.sharpeRatio > 0) {
    score += 3;
    reasoning.push(`Low Sharpe: ${metrics.sharpeRatio.toFixed(2)}`);
  } else {
    reasoning.push(`Negative Sharpe: ${metrics.sharpeRatio.toFixed(2)}`);
  }

  // Calmar bonus
  if (metrics.calmarRatio > 1) score += 5;
  else if (metrics.calmarRatio > 0.5) score += 3;

  return Math.min(25, score);
}

/**
 * Score consistency (0-25).
 * Based on win rate, profit factor, and trade activity.
 */
function scoreConsistency(
  metrics: PerformanceMetrics,
  config: ConfidenceScorerConfig,
  reasoning: string[]
): number {
  let score = 0;

  // Win rate
  if (metrics.winRate >= 0.6) {
    score += 10;
    reasoning.push(`High win rate: ${(metrics.winRate * 100).toFixed(0)}%`);
  } else if (metrics.winRate >= config.minimumWinRate) {
    score += 6;
    reasoning.push(`Acceptable win rate: ${(metrics.winRate * 100).toFixed(0)}%`);
  } else if (metrics.winRate > 0) {
    score += 2;
    reasoning.push(`Low win rate: ${(metrics.winRate * 100).toFixed(0)}%`);
  }

  // Profit factor
  if (metrics.profitFactor >= 2) {
    score += 8;
    reasoning.push(`Strong profit factor: ${metrics.profitFactor.toFixed(2)}`);
  } else if (metrics.profitFactor >= 1.3) {
    score += 5;
  } else if (metrics.profitFactor >= 1) {
    score += 2;
  }

  // Trade activity: need enough trades for statistical significance
  if (metrics.totalTrades >= 50) {
    score += 7;
    reasoning.push(`Good sample size: ${metrics.totalTrades} trades`);
  } else if (metrics.totalTrades >= 20) {
    score += 4;
  } else if (metrics.totalTrades >= 10) {
    score += 2;
    reasoning.push(`Low sample size: ${metrics.totalTrades} trades`);
  } else {
    reasoning.push(`Insufficient trades: ${metrics.totalTrades} (need 10+)`);
  }

  return Math.min(25, score);
}

/**
 * Score robustness across market conditions (0-25).
 * Strategy should perform acceptably in all conditions, not just one.
 */
function scoreRobustness(
  breakdowns: ConditionBreakdown[],
  config: ConfidenceScorerConfig,
  reasoning: string[]
): number {
  if (breakdowns.length === 0) {
    reasoning.push('No market condition breakdown available');
    return 5; // Give minimal score if no breakdown
  }

  const conditionsWithData = breakdowns.filter(b => b.totalCandles > 0 && b.metrics.totalTrades > 0);

  if (conditionsWithData.length === 0) {
    reasoning.push('No market conditions had sufficient trading activity');
    return 5;
  }

  let score = 0;

  // Score: profitable in how many conditions?
  const profitableConditions = conditionsWithData.filter(b => b.metrics.totalReturnPct > 0);
  const profitablePct = profitableConditions.length / conditionsWithData.length;

  if (profitablePct >= 0.75) {
    score += 12;
    reasoning.push(`Profitable in ${profitableConditions.length}/${conditionsWithData.length} conditions`);
  } else if (profitablePct >= 0.5) {
    score += 7;
    reasoning.push(`Profitable in ${profitableConditions.length}/${conditionsWithData.length} conditions`);
  } else {
    score += 3;
    reasoning.push(`Only profitable in ${profitableConditions.length}/${conditionsWithData.length} conditions`);
  }

  // Score: consistency of returns across conditions
  const returns = conditionsWithData.map(b => b.metrics.totalReturnPct);
  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const returnVariance = returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length;
  const returnStdDev = Math.sqrt(returnVariance);

  // Lower variance is better (more consistent)
  if (returnStdDev < 5) {
    score += 8;
    reasoning.push(`Consistent across conditions (std dev: ${returnStdDev.toFixed(1)}%)`);
  } else if (returnStdDev < 15) {
    score += 5;
  } else {
    score += 2;
    reasoning.push(`Inconsistent across conditions (std dev: ${returnStdDev.toFixed(1)}%)`);
  }

  // Bonus: performs well in bear markets
  const bearBreakdown = breakdowns.find(b => b.condition === 'BEAR');
  if (bearBreakdown && bearBreakdown.metrics.totalTrades > 0) {
    if (bearBreakdown.metrics.totalReturnPct > 0) {
      score += 5;
      reasoning.push(`Profitable in BEAR conditions: ${bearBreakdown.metrics.totalReturnPct.toFixed(1)}%`);
    } else if (bearBreakdown.metrics.totalReturnPct > -5) {
      score += 3;
      reasoning.push(`Limited losses in BEAR: ${bearBreakdown.metrics.totalReturnPct.toFixed(1)}%`);
    }
  }

  return Math.min(25, score);
}

// ============================================================================
// PER-CONDITION SCORING
// ============================================================================

/**
 * Score each market condition independently (0-100 each).
 */
function scoreByCondition(
  breakdowns: ConditionBreakdown[],
  config: ConfidenceScorerConfig
): Record<MarketCondition, number> {
  const scores: Record<MarketCondition, number> = {
    BULL: 50,    // Default neutral score
    BEAR: 50,
    RANGING: 50,
    VOLATILE: 50,
  };

  for (const b of breakdowns) {
    if (b.totalCandles === 0 || b.metrics.totalTrades === 0) continue;

    let score = 50; // Start at neutral

    // Return component (0-40).
    // BEAR uses lenient thresholds — a long-only bot that loses -8% in a -60% market
    // is performing exceptionally. Standard thresholds penalise this unfairly.
    const ret = b.metrics.totalReturnPct;
    if (b.condition === 'BEAR') {
      // Lenient thresholds: losing up to -15% in a bear market is acceptable
      if (ret > 5) score += 30;
      else if (ret > 0) score += 20;
      else if (ret > -10) score += 10;    // small loss = OK
      else if (ret > -20) score -= 5;     // moderate loss = minor penalty
      else if (ret > -30) score -= 15;
      else score -= 30;
    } else {
      // Standard absolute thresholds for BULL / RANGING / VOLATILE
      if (ret > 10) score += 30;
      else if (ret > 5) score += 20;
      else if (ret > 0) score += 10;
      else if (ret > -5) score -= 5;
      else if (ret > -10) score -= 15;
      else score -= 30;
    }

    // Win rate component (0-20)
    if (b.metrics.winRate >= 0.6) score += 15;
    else if (b.metrics.winRate >= 0.45) score += 8;
    else score -= 10;

    // Drawdown penalty
    if (b.metrics.maxDrawdownPct > 25) score -= 15;
    else if (b.metrics.maxDrawdownPct > 15) score -= 5;

    scores[b.condition] = Math.max(0, Math.min(100, score));
  }

  return scores;
}

// ============================================================================
// CONVENIENCE: Score from multiple replay results
// ============================================================================

/**
 * Calculate aggregate confidence from multiple backtest runs
 * (e.g., from walk-forward validation).
 */
export function calculateAggregateConfidence(
  results: ReplayResult[],
  config: ConfidenceScorerConfig = DEFAULT_CONFIDENCE_CONFIG
): ConfidenceScore {
  if (results.length === 0) {
    return {
      overall: 0,
      byCondition: { BULL: 0, BEAR: 0, RANGING: 0, VOLATILE: 0 },
      byMetric: { returnScore: 0, riskScore: 0, consistencyScore: 0, robustnessScore: 0 },
      passesThreshold: false,
      threshold: config.minimumConfidence,
      reasoning: ['No results to score'],
    };
  }

  // Score each result independently
  const scores = results.map(r => calculateConfidence(r, config));

  // Average the scores
  const avgOverall = scores.reduce((s, c) => s + c.overall, 0) / scores.length;

  const conditions: MarketCondition[] = ['BULL', 'BEAR', 'RANGING', 'VOLATILE'];
  const avgByCondition: Record<MarketCondition, number> = { BULL: 0, BEAR: 0, RANGING: 0, VOLATILE: 0 };
  for (const cond of conditions) {
    avgByCondition[cond] = scores.reduce((s, c) => s + c.byCondition[cond], 0) / scores.length;
  }

  const avgByMetric = {
    returnScore: scores.reduce((s, c) => s + c.byMetric.returnScore, 0) / scores.length,
    riskScore: scores.reduce((s, c) => s + c.byMetric.riskScore, 0) / scores.length,
    consistencyScore: scores.reduce((s, c) => s + c.byMetric.consistencyScore, 0) / scores.length,
    robustnessScore: scores.reduce((s, c) => s + c.byMetric.robustnessScore, 0) / scores.length,
  };

  // Pass if: average overall >= threshold AND all per-condition averages >= condition minimum
  const allConditionsPass = conditions.every(
    cond => avgByCondition[cond] >= config.minimumConditionConfidence
  );
  const overallPasses = avgOverall >= config.minimumConfidence;

  const reasoning = [
    `Aggregated from ${results.length} backtest runs`,
    `Individual scores: ${scores.map(s => s.overall.toFixed(0)).join(', ')}`,
    overallPasses && allConditionsPass
      ? 'Overall and all conditions pass threshold'
      : 'Overall or condition minimums not met',
  ];

  return {
    overall: avgOverall,
    byCondition: avgByCondition,
    byMetric: avgByMetric,
    passesThreshold: overallPasses && allConditionsPass,
    threshold: config.minimumConfidence,
    reasoning,
  };
}
