/**
 * NVR Capital — Self-Improvement Loop
 *
 * Automated pipeline that continuously improves the trading strategy:
 *   1. RESEARCH  — Analyze current performance (confidence gate baseline)
 *   2. HYPOTHESIZE — Generate parameter change proposals based on weak spots
 *   3. SIMULATE  — Test proposals through tournament sweep
 *   4. VALIDATE  — Walk-forward validation to prevent overfitting
 *   5. SCORE     — Compare against current confidence baseline
 *   6. REPORT    — Recommend apply or reject with full reasoning
 *
 * Pure functions. No global state. No side effects.
 * Designed to be called from CLI or automated cron.
 */

import { runReplay } from '../engine/replay-engine.js';
import { walkForwardSplit } from '../engine/market-simulator.js';
import { generateSyntheticData } from '../data/historical-data.js';
import { calculateAggregateConfidence } from '../scoring/confidence-scorer.js';
import { runTournamentSweep, PRESET_SWEEPS } from '../backtester/parameter-sweep.js';
import type {
  StrategyParams,
  ConfidenceScore,
  SweepRange,
  MarketCondition,
  PerformanceMetrics,
  HistoricalDataset,
} from '../types.js';
import { DEFAULT_STRATEGY_PARAMS, DEFAULT_CONFIDENCE_CONFIG } from '../types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ImprovementReport {
  /** When this report was generated */
  timestamp: string;
  /** Current strategy confidence */
  currentScore: ConfidenceScore;
  /** Proposed strategy confidence (null if no improvement found) */
  proposedScore: ConfidenceScore | null;
  /** Best params found (null if no improvement) */
  proposedParams: StrategyParams | null;
  /** Delta in overall confidence */
  delta: number;
  /** Whether the proposal passes walk-forward validation */
  walkForwardValid: boolean;
  /** Recommendation */
  recommendation: 'APPLY' | 'REJECT' | 'REVIEW';
  /** Detailed reasoning */
  reasoning: string[];
  /** Which weak spots were targeted */
  weakSpots: WeakSpot[];
  /** How long the loop took */
  durationMs: number;
  /** Sweep presets that were tested */
  sweepsRun: string[];
}

interface WeakSpot {
  area: string;
  score: number;
  maxScore: number;
  suggestion: string;
}

interface SweepCandidate {
  presetName: string;
  ranges: SweepRange[];
  rationale: string;
}

// ============================================================================
// MARKET SCENARIOS (shared with tournament)
// ============================================================================

const SCENARIOS: Array<{
  label: MarketCondition;
  days: number;
  startPrice: number;
  drift: number;
  volatility: number;
  seed: number;
}> = [
  { label: 'BULL',     days: 365, startPrice: 40000, drift: 1.0,  volatility: 0.4,  seed: 101 },
  { label: 'BEAR',     days: 365, startPrice: 60000, drift: -0.6, volatility: 0.5,  seed: 202 },
  { label: 'RANGING',  days: 365, startPrice: 45000, drift: 0.0,  volatility: 0.25, seed: 303 },
  { label: 'VOLATILE', days: 365, startPrice: 50000, drift: 0.1,  volatility: 0.9,  seed: 404 },
];

function generateDatasets(days = 365): HistoricalDataset[] {
  return SCENARIOS.map(s =>
    generateSyntheticData({
      symbol: `BTC-${s.label}`,
      startPrice: s.startPrice,
      candles: days * 24,
      drift: s.drift,
      volatility: s.volatility,
      seed: s.seed,
    })
  );
}

// ============================================================================
// STEP 1: RESEARCH — Analyze current performance
// ============================================================================

function research(params: StrategyParams, onProgress: (msg: string) => void): {
  score: ConfidenceScore;
  weakSpots: WeakSpot[];
} {
  onProgress('STEP 1: RESEARCH — Analyzing current strategy performance...');

  const datasets = generateDatasets();
  const conditions: MarketCondition[] = ['BULL', 'BEAR', 'RANGING', 'VOLATILE'];

  const results = datasets.map(ds => runReplay([ds], { strategy: params }));
  const score = calculateAggregateConfidence(results, conditions, DEFAULT_CONFIDENCE_CONFIG);

  // Identify weak spots
  const weakSpots: WeakSpot[] = [];
  const { byMetric, byCondition } = score;

  if (byMetric.returnScore < 15) {
    weakSpots.push({
      area: 'Returns',
      score: byMetric.returnScore,
      maxScore: 25,
      suggestion: 'Bot underperforms buy-and-hold. Try wider profit targets or more aggressive sizing.',
    });
  }
  if (byMetric.riskScore < 15) {
    weakSpots.push({
      area: 'Risk',
      score: byMetric.riskScore,
      maxScore: 25,
      suggestion: 'Drawdowns too large. Tighten stop losses or reduce position sizes.',
    });
  }
  if (byMetric.consistencyScore < 15) {
    weakSpots.push({
      area: 'Consistency',
      score: byMetric.consistencyScore,
      maxScore: 25,
      suggestion: 'Low win rate or profit factor. Raise confluence threshold for better entries.',
    });
  }
  if (byMetric.robustnessScore < 15) {
    weakSpots.push({
      area: 'Robustness',
      score: byMetric.robustnessScore,
      maxScore: 25,
      suggestion: 'Performance varies too much across conditions. Need balanced params.',
    });
  }

  // Condition-level weak spots
  for (const cond of conditions) {
    if (byCondition[cond] < 50) {
      weakSpots.push({
        area: `${cond} market`,
        score: byCondition[cond],
        maxScore: 100,
        suggestion: `Strategy struggles in ${cond} conditions.`,
      });
    }
  }

  onProgress(`  Current score: ${Math.round(score.overall)}/100`);
  onProgress(`  Weak spots: ${weakSpots.length > 0 ? weakSpots.map(w => `${w.area} (${Math.round(w.score)}/${w.maxScore})`).join(', ') : 'None critical'}`);

  return { score, weakSpots };
}

// ============================================================================
// STEP 2: HYPOTHESIZE — Generate sweep candidates based on weak spots
// ============================================================================

function hypothesize(weakSpots: WeakSpot[], currentParams: StrategyParams, onProgress: (msg: string) => void): SweepCandidate[] {
  onProgress('\nSTEP 2: HYPOTHESIZE — Generating parameter change proposals...');

  const candidates: SweepCandidate[] = [];

  // Always run a returns-focused sweep (most common weak spot)
  const hasReturnWeakness = weakSpots.some(w => w.area === 'Returns');
  if (hasReturnWeakness) {
    candidates.push({
      presetName: 'returnsFocused',
      ranges: PRESET_SWEEPS.returnsFocused,
      rationale: 'Returns score is low — testing wider profit targets and position sizing',
    });
  }

  // If BEAR or VOLATILE is weak, try conservative params
  const hasBearWeakness = weakSpots.some(w => w.area.includes('BEAR'));
  const hasVolatileWeakness = weakSpots.some(w => w.area.includes('VOLATILE'));
  if (hasBearWeakness || hasVolatileWeakness) {
    candidates.push({
      presetName: 'riskManagement',
      ranges: PRESET_SWEEPS.riskManagement,
      rationale: `Weak in ${hasBearWeakness ? 'BEAR' : ''}${hasBearWeakness && hasVolatileWeakness ? '+' : ''}${hasVolatileWeakness ? 'VOLATILE' : ''} — testing tighter risk management`,
    });
  }

  // If consistency is weak, try confluence thresholds
  const hasConsistencyWeakness = weakSpots.some(w => w.area === 'Consistency');
  if (hasConsistencyWeakness) {
    candidates.push({
      presetName: 'confluence',
      ranges: PRESET_SWEEPS.confluence,
      rationale: 'Consistency score is low — testing confluence threshold adjustments',
    });
  }

  // Always try aggressive as a moonshot
  candidates.push({
    presetName: 'aggressive',
    ranges: PRESET_SWEEPS.aggressive,
    rationale: 'Aggressive sweep — higher entries, tighter stops, wider profits',
  });

  // Deduplicate by preset name
  const seen = new Set<string>();
  const unique = candidates.filter(c => {
    if (seen.has(c.presetName)) return false;
    seen.add(c.presetName);
    return true;
  });

  for (const c of unique) {
    onProgress(`  Hypothesis: ${c.presetName} — ${c.rationale}`);
  }

  return unique;
}

// ============================================================================
// STEP 3: SIMULATE — Run tournament sweeps for each hypothesis
// ============================================================================

function simulate(
  candidates: SweepCandidate[],
  baseParams: StrategyParams,
  onProgress: (msg: string) => void,
): Array<{ presetName: string; bestParams: Partial<StrategyParams>; bestMetrics: PerformanceMetrics; durationMs: number }> {
  onProgress('\nSTEP 3: SIMULATE — Running tournament sweeps...');

  const results: Array<{
    presetName: string;
    bestParams: Partial<StrategyParams>;
    bestMetrics: PerformanceMetrics;
    durationMs: number;
  }> = [];

  for (const candidate of candidates) {
    onProgress(`\n  Running: ${candidate.presetName} (${candidate.rationale})`);
    const result = runTournamentSweep({
      ranges: candidate.ranges,
      baseParams,
      survivalRate: 0.3,
      screenDays: 90,
      fullDays: 365,
      onProgress: (msg) => onProgress(`    ${msg}`),
    });

    results.push({
      presetName: candidate.presetName,
      bestParams: result.bestParams,
      bestMetrics: result.bestMetrics,
      durationMs: result.durationMs,
    });

    onProgress(`  Result: return=${result.bestMetrics.totalReturnPct.toFixed(1)}% | sharpe=${result.bestMetrics.sharpeRatio.toFixed(2)} (${(result.durationMs / 1000).toFixed(0)}s)`);
  }

  return results;
}

// ============================================================================
// STEP 4: VALIDATE — Walk-forward validation
// ============================================================================

function validate(
  proposedParams: StrategyParams,
  onProgress: (msg: string) => void,
): { valid: boolean; reasoning: string[] } {
  onProgress('\nSTEP 4: VALIDATE — Walk-forward validation (70/30 split)...');

  const datasets = generateDatasets();
  const conditions: MarketCondition[] = ['BULL', 'BEAR', 'RANGING', 'VOLATILE'];
  const reasoning: string[] = [];
  let overfitCount = 0;

  for (let i = 0; i < datasets.length; i++) {
    const ds = datasets[i];
    const cond = conditions[i];
    const { train, test } = walkForwardSplit(ds, 0.7);

    const trainResult = runReplay([train], { strategy: proposedParams });
    const testResult = runReplay([test], { strategy: proposedParams });

    const trainReturn = trainResult.metrics.totalReturnPct;
    const testReturn = testResult.metrics.totalReturnPct;
    const overfit = trainReturn > 0 && testReturn < 0;

    if (overfit) {
      overfitCount++;
      reasoning.push(`${cond}: OVERFIT — train ${trainReturn.toFixed(1)}%, test ${testReturn.toFixed(1)}%`);
    } else {
      reasoning.push(`${cond}: OK — train ${trainReturn.toFixed(1)}%, test ${testReturn.toFixed(1)}%`);
    }
    onProgress(`  ${cond}: train=${trainReturn.toFixed(1)}% test=${testReturn.toFixed(1)}% ${overfit ? '[OVERFIT]' : '[OK]'}`);
  }

  // Allow 1 overfit condition (BEAR is often tough), fail on 2+
  const valid = overfitCount <= 1;
  if (!valid) {
    reasoning.push(`FAILED: ${overfitCount} conditions show overfitting (max allowed: 1)`);
  }

  return { valid, reasoning };
}

// ============================================================================
// STEP 5+6: SCORE & REPORT
// ============================================================================

function scoreAndReport(
  currentScore: ConfidenceScore,
  proposedParams: StrategyParams | null,
  walkForwardValid: boolean,
  validationReasoning: string[],
  weakSpots: WeakSpot[],
  sweepsRun: string[],
  durationMs: number,
  onProgress: (msg: string) => void,
): ImprovementReport {
  onProgress('\nSTEP 5-6: SCORE & REPORT...');

  let proposedScore: ConfidenceScore | null = null;
  let delta = 0;
  let recommendation: 'APPLY' | 'REJECT' | 'REVIEW' = 'REJECT';
  const reasoning: string[] = [];

  if (proposedParams) {
    const datasets = generateDatasets();
    const conditions: MarketCondition[] = ['BULL', 'BEAR', 'RANGING', 'VOLATILE'];
    const results = datasets.map(ds => runReplay([ds], { strategy: proposedParams }));
    proposedScore = calculateAggregateConfidence(results, conditions, DEFAULT_CONFIDENCE_CONFIG);
    delta = proposedScore.overall - currentScore.overall;

    if (delta > 3 && walkForwardValid && proposedScore.passesThreshold) {
      recommendation = 'APPLY';
      reasoning.push(`+${delta.toFixed(1)} confidence points with walk-forward validation passing`);
    } else if (delta > 0 && walkForwardValid) {
      recommendation = 'REVIEW';
      reasoning.push(`Small improvement (+${delta.toFixed(1)}) — manual review recommended`);
    } else if (!walkForwardValid) {
      recommendation = 'REJECT';
      reasoning.push('Walk-forward validation failed — likely overfitting');
    } else {
      recommendation = 'REJECT';
      reasoning.push(`No improvement (delta: ${delta.toFixed(1)})`);
    }

    reasoning.push(...validationReasoning);
  } else {
    recommendation = 'REJECT';
    reasoning.push('No candidates produced better results than current params');
  }

  const report: ImprovementReport = {
    timestamp: new Date().toISOString(),
    currentScore,
    proposedScore,
    proposedParams,
    delta,
    walkForwardValid,
    recommendation,
    reasoning,
    weakSpots,
    durationMs,
    sweepsRun,
  };

  onProgress(`\n  Recommendation: ${recommendation}`);
  onProgress(`  Delta: ${delta > 0 ? '+' : ''}${delta.toFixed(1)} points`);
  for (const r of reasoning) {
    onProgress(`  ${r}`);
  }

  return report;
}

// ============================================================================
// MAIN LOOP
// ============================================================================

export interface ImprovementLoopConfig {
  /** Current strategy params to improve upon */
  currentParams?: StrategyParams;
  /** Minimum confidence threshold */
  minConfidence?: number;
  /** Progress callback */
  onProgress?: (msg: string) => void;
}

/**
 * Run the full self-improvement loop.
 *
 * Analyzes current strategy, identifies weak spots, generates hypotheses,
 * tests them through tournament sweeps, validates with walk-forward,
 * and produces an improvement report.
 *
 * Total runtime: ~10-20 min depending on number of hypotheses.
 */
export function runImprovementLoop(config: ImprovementLoopConfig = {}): ImprovementReport {
  const {
    currentParams = DEFAULT_STRATEGY_PARAMS,
    minConfidence = 60,
    onProgress = () => {},
  } = config;

  const startMs = Date.now();

  onProgress('═══════════════════════════════════════════════════');
  onProgress('NVR CAPITAL — SELF-IMPROVEMENT LOOP');
  onProgress('═══════════════════════════════════════════════════');

  // Step 1: Research
  const { score: currentScore, weakSpots } = research(currentParams, onProgress);

  // Step 2: Hypothesize
  const candidates = hypothesize(weakSpots, currentParams, onProgress);

  // Step 3: Simulate
  const simResults = simulate(candidates, currentParams, onProgress);

  // Find the best overall candidate
  const bestSim = simResults.sort((a, b) => b.bestMetrics.sharpeRatio - a.bestMetrics.sharpeRatio)[0];
  let proposedParams: StrategyParams | null = null;
  if (bestSim) {
    proposedParams = { ...currentParams, ...bestSim.bestParams };
  }

  // Step 4: Validate (only if we have a candidate)
  let walkForwardValid = false;
  let validationReasoning: string[] = [];
  if (proposedParams) {
    const validation = validate(proposedParams, onProgress);
    walkForwardValid = validation.valid;
    validationReasoning = validation.reasoning;
  }

  // Step 5-6: Score & Report
  const report = scoreAndReport(
    currentScore,
    proposedParams,
    walkForwardValid,
    validationReasoning,
    weakSpots,
    candidates.map(c => c.presetName),
    Date.now() - startMs,
    onProgress,
  );

  onProgress('\n═══════════════════════════════════════════════════');
  onProgress(`LOOP COMPLETE — ${((Date.now() - startMs) / 1000 / 60).toFixed(1)} minutes`);
  onProgress('═══════════════════════════════════════════════════\n');

  return report;
}
