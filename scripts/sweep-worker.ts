/**
 * sweep-worker.ts — spawned as child process by fast-sweep.ts
 * Reads params from env, outputs JSON result to stdout.
 */
import { generateSyntheticData } from '../src/simulation/data/historical-data.js';
import { runReplay } from '../src/simulation/engine/replay-engine.js';
import { calculateAggregateConfidence, calculateConfidence } from '../src/simulation/scoring/confidence-scorer.js';
import { DEFAULT_STRATEGY_PARAMS, DEFAULT_CONFIDENCE_CONFIG } from '../src/simulation/types.js';

const stopLoss   = parseFloat(process.env.SWEEP_STOP!);
const profitTake = parseFloat(process.env.SWEEP_PROFIT!);
const maxPos     = parseFloat(process.env.SWEEP_MAXPOS!);
const threshold  = parseInt(process.env.SWEEP_THRESHOLD || '60');

const SCENARIOS = [
  { label: 'BULL',     days: 365, startPrice: 40000, drift: 1.0,  volatility: 0.4,  seed: 101 },
  { label: 'BEAR',     days: 365, startPrice: 60000, drift: -0.6, volatility: 0.5,  seed: 202 },
  { label: 'RANGING',  days: 365, startPrice: 45000, drift: 0.0,  volatility: 0.25, seed: 303 },
  { label: 'VOLATILE', days: 365, startPrice: 50000, drift: 0.1,  volatility: 0.9,  seed: 404 },
];

const datasets = SCENARIOS.map(s => generateSyntheticData({
  symbol: `BTC-${s.label}`,
  startPrice: s.startPrice,
  candles: s.days * 24,
  drift: s.drift,
  volatility: s.volatility,
  seed: s.seed,
}));

const params = { ...DEFAULT_STRATEGY_PARAMS, stopLossPercent: stopLoss, profitTakePercent: profitTake, maxPositionPercent: maxPos };
const results = datasets.map(ds => runReplay([ds], { strategy: params }));
const config = { ...DEFAULT_CONFIDENCE_CONFIG, minimumConfidence: threshold };
const score = calculateAggregateConfidence(results, config);
const individual = results.map(r => calculateConfidence(r).overall);

process.stdout.write(JSON.stringify({
  params: { stopLoss, profitTake, maxPos },
  score: score.overall,
  bull:     score.byCondition.BULL,
  bear:     score.byCondition.BEAR,
  ranging:  score.byCondition.RANGING,
  volatile: score.byCondition.VOLATILE,
  passed:   score.passesThreshold,
  individual,
}));
