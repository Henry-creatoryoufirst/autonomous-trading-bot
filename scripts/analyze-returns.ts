/**
 * analyze-returns.ts — Detailed breakdown of simulation scores.
 */
import { generateSyntheticData } from '../src/simulation/data/historical-data.js';
import { runReplay } from '../src/simulation/engine/replay-engine.js';
import { calculateConfidence, calculateAggregateConfidence } from '../src/simulation/scoring/confidence-scorer.js';
import { DEFAULT_STRATEGY_PARAMS } from '../src/simulation/types.js';

const SCENARIOS = [
  { label: 'BULL',     days: 365, startPrice: 40000, drift: 1.0,  volatility: 0.4,  seed: 101 },
  { label: 'BEAR',     days: 365, startPrice: 60000, drift: -0.6, volatility: 0.5,  seed: 202 },
  { label: 'RANGING',  days: 365, startPrice: 45000, drift: 0.0,  volatility: 0.25, seed: 303 },
  { label: 'VOLATILE', days: 365, startPrice: 50000, drift: 0.1,  volatility: 0.9,  seed: 404 },
];

const datasets = SCENARIOS.map(s => generateSyntheticData({
  symbol: 'BTC-'+s.label, startPrice: s.startPrice, candles: s.days*24,
  drift: s.drift, volatility: s.volatility, seed: s.seed,
}));

const params = { ...DEFAULT_STRATEGY_PARAMS, confluenceBuyThreshold: 22, stopLossPercent: 7, profitTakePercent: 5, maxPositionPercent: 6 };

const results = datasets.map((ds, i) => {
  const r = runReplay([ds], { strategy: params });
  const sc = calculateConfidence(r);
  console.log(SCENARIOS[i].label + ':');
  console.log(`  totalReturn: ${r.metrics.totalReturnPct.toFixed(1)}%  holdBaseline: ${r.metrics.holdBaselinePct.toFixed(1)}%  beatHoldBy: ${(r.metrics.totalReturnPct - r.metrics.holdBaselinePct).toFixed(1)}%`);
  console.log(`  maxDrawdown: ${r.metrics.maxDrawdownPct.toFixed(1)}%  winRate: ${(r.metrics.winRate*100).toFixed(0)}%  trades: ${r.metrics.totalTrades}  Sharpe: ${r.metrics.sharpeRatio.toFixed(2)}`);
  console.log(`  returnScore: ${sc.byMetric.returnScore}  riskScore: ${sc.byMetric.riskScore}  consistency: ${sc.byMetric.consistencyScore}  robustness: ${sc.byMetric.robustnessScore}  TOTAL: ${sc.overall}`);
  return r;
});

const agg = calculateAggregateConfidence(results);
console.log('');
console.log(`AGGREGATE: ${agg.overall.toFixed(1)} | returnScore: ${agg.byMetric.returnScore.toFixed(1)} | riskScore: ${agg.byMetric.riskScore.toFixed(1)} | consistency: ${agg.byMetric.consistencyScore.toFixed(1)} | robustness: ${agg.byMetric.robustnessScore.toFixed(1)}`);
