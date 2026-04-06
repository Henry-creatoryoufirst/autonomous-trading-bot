/**
 * Diagnostic script — shows detailed per-run metrics to understand scoring gaps.
 */
import { generateSyntheticData } from '../src/simulation/data/historical-data.js';
import { runReplay } from '../src/simulation/engine/replay-engine.js';
import { calculateConfidence } from '../src/simulation/scoring/confidence-scorer.js';
import { DEFAULT_STRATEGY_PARAMS, DEFAULT_CONFIDENCE_CONFIG } from '../src/simulation/types.js';
import type { MarketCondition } from '../src/simulation/types.js';

const scenarios = [
  { label: 'BULL' as MarketCondition, days: 365, startPrice: 40000, drift: 1.0, volatility: 0.4, seed: 101 },
  { label: 'BEAR' as MarketCondition, days: 365, startPrice: 60000, drift: -0.6, volatility: 0.5, seed: 202 },
  { label: 'RANGING' as MarketCondition, days: 365, startPrice: 45000, drift: 0.0, volatility: 0.25, seed: 303 },
  { label: 'VOLATILE' as MarketCondition, days: 365, startPrice: 50000, drift: 0.1, volatility: 0.9, seed: 404 },
];

for (const s of scenarios) {
  const ds = generateSyntheticData({
    symbol: `BTC-${s.label}`,
    startPrice: s.startPrice,
    candles: s.days * 24,
    drift: s.drift,
    volatility: s.volatility,
    seed: s.seed,
  });

  const result = runReplay([ds], { strategy: DEFAULT_STRATEGY_PARAMS });
  const score = calculateConfidence(result, DEFAULT_CONFIDENCE_CONFIG);
  const m = result.metrics;

  console.log(`\n=== ${s.label} ===`);
  console.log(`  Score: ${score.overall.toFixed(0)}/100  (ret=${score.byMetric.returnScore.toFixed(0)} risk=${score.byMetric.riskScore.toFixed(0)} cons=${score.byMetric.consistencyScore.toFixed(0)} rob=${score.byMetric.robustnessScore.toFixed(0)})`);
  console.log(`  Return: ${m.totalReturnPct.toFixed(1)}%  Hold: ${m.holdBaselinePct.toFixed(1)}%  Beat: ${(m.totalReturnPct - m.holdBaselinePct).toFixed(1)}%`);
  console.log(`  Trades: ${m.totalTrades}  Wins: ${m.winningTrades}  Losses: ${m.losingTrades}  WR: ${(m.winRate * 100).toFixed(0)}%`);
  console.log(`  Drawdown: ${m.maxDrawdownPct.toFixed(1)}%  Sharpe: ${m.sharpeRatio.toFixed(2)}  PF: ${m.profitFactor.toFixed(2)}`);
  console.log(`  Avg Win: $${m.avgWin.toFixed(2)}  Avg Loss: $${m.avgLoss.toFixed(2)}`);

  // Show first 5 trades
  const first5 = result.trades.slice(0, 5);
  if (first5.length > 0) {
    console.log(`  First trades:`);
    for (const t of first5) {
      console.log(`    ${t.action} $${t.amountUSD.toFixed(0)} @ ${t.price.toFixed(0)} [${t.reason}] PnL=${t.realizedPnl.toFixed(2)}`);
    }
  }

  // Condition breakdown
  for (const cb of result.conditionBreakdown) {
    if (cb.totalCandles > 0) {
      console.log(`  ${cb.condition}: ${cb.periodCount} periods, ${cb.metrics.totalTrades} trades, ret=${cb.metrics.totalReturnPct.toFixed(1)}%`);
    }
  }
}
