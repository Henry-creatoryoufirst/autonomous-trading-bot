/**
 * NVR Capital — Level 6: Meta-Learning Analytics
 *
 * Analyzes trade signal snapshots to identify which conditions,
 * indicator combinations, and regimes produce the best trades.
 *
 * Pure functions. No side effects.
 */

import type { TradeSignalSnapshot, MetaLearningReport, SimRegime } from '../types.js';

/**
 * Generate a meta-learning report from trade snapshots.
 * Groups trades by regime + alignment + volume and computes
 * win rates and average P&L for each group.
 */
export function generateMetaLearningReport(
  snapshots: TradeSignalSnapshot[],
): MetaLearningReport {
  // Only analyze completed round-trips (sells with P&L data)
  const sells = snapshots.filter(s => s.action === 'SELL' && s.pnl !== undefined);

  if (sells.length === 0) {
    return { bestEntryConditions: [], indicatorRankings: [], recommendations: ['Insufficient trade data for analysis'] };
  }

  // Group by regime + aligned + volumeConfirmed
  const groups = new Map<string, { trades: TradeSignalSnapshot[]; regime: SimRegime; aligned: boolean; volumeConfirmed: boolean }>();

  for (const trade of sells) {
    const key = `${trade.regime}_${trade.timeframeAligned}_${trade.volumeConfirmed}`;
    if (!groups.has(key)) {
      groups.set(key, { trades: [], regime: trade.regime, aligned: trade.timeframeAligned, volumeConfirmed: trade.volumeConfirmed });
    }
    groups.get(key)!.trades.push(trade);
  }

  // Compute metrics per group
  const bestEntryConditions = [...groups.values()]
    .filter(g => g.trades.length >= 3) // minimum sample
    .map(g => {
      const wins = g.trades.filter(t => (t.pnl ?? 0) > 0).length;
      const totalPnl = g.trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
      const avgEntry = g.trades.reduce((s, t) => s + t.price, 0) / g.trades.length;
      return {
        regime: g.regime,
        aligned: g.aligned,
        volumeConfirmed: g.volumeConfirmed,
        winRate: wins / g.trades.length,
        avgPnlPct: avgEntry > 0 ? (totalPnl / avgEntry / g.trades.length) * 100 : 0,
        tradeCount: g.trades.length,
      };
    })
    .sort((a, b) => (b.winRate * b.tradeCount) - (a.winRate * a.tradeCount))
    .slice(0, 10);

  // Rank indicators by prediction accuracy
  const indicatorRankings = rankIndicators(sells);

  // Generate recommendations
  const recommendations = generateRecommendations(bestEntryConditions, indicatorRankings);

  return { bestEntryConditions, indicatorRankings, recommendations };
}

/**
 * Rank indicators by prediction accuracy across all trades.
 */
export function rankIndicators(
  sells: TradeSignalSnapshot[],
): Array<{ name: string; accuracy: number; contribution: number }> {
  const stats = new Map<string, { correct: number; total: number; totalPnl: number }>();

  for (const trade of sells) {
    const profitable = (trade.pnl ?? 0) > 0;

    for (const [name, signal] of Object.entries(trade.indicatorSignals)) {
      if (signal === 0) continue;

      if (!stats.has(name)) stats.set(name, { correct: 0, total: 0, totalPnl: 0 });
      const s = stats.get(name)!;
      s.total++;

      // Correct if bullish signal + profitable, or bearish signal + unprofitable
      const correct = (signal > 0 && profitable) || (signal < 0 && !profitable);
      if (correct) {
        s.correct++;
        s.totalPnl += Math.abs(trade.pnl ?? 0);
      }
    }
  }

  const totalPnlAll = [...stats.values()].reduce((s, v) => s + v.totalPnl, 0) || 1;

  return [...stats.entries()]
    .map(([name, s]) => ({
      name,
      accuracy: s.total > 0 ? s.correct / s.total : 0,
      contribution: s.totalPnl / totalPnlAll,
    }))
    .sort((a, b) => b.accuracy - a.accuracy);
}

function generateRecommendations(
  bestConditions: MetaLearningReport['bestEntryConditions'],
  rankings: MetaLearningReport['indicatorRankings'],
): string[] {
  const recs: string[] = [];

  // Best regime
  if (bestConditions.length > 0) {
    const best = bestConditions[0];
    recs.push(`Best condition: ${best.regime} + aligned=${best.aligned} + vol=${best.volumeConfirmed} (${(best.winRate * 100).toFixed(0)}% win rate, ${best.tradeCount} trades)`);
  }

  // Alignment impact
  const alignedWins = bestConditions.filter(c => c.aligned);
  const unalignedWins = bestConditions.filter(c => !c.aligned);
  if (alignedWins.length > 0 && unalignedWins.length > 0) {
    const avgAligned = alignedWins.reduce((s, c) => s + c.winRate, 0) / alignedWins.length;
    const avgUnaligned = unalignedWins.reduce((s, c) => s + c.winRate, 0) / unalignedWins.length;
    if (avgAligned > avgUnaligned + 0.05) {
      recs.push(`Timeframe alignment adds +${((avgAligned - avgUnaligned) * 100).toFixed(0)}% win rate`);
    }
  }

  // Best/worst indicators
  if (rankings.length >= 2) {
    const best = rankings[0];
    const worst = rankings[rankings.length - 1];
    recs.push(`Most accurate indicator: ${best.name} (${(best.accuracy * 100).toFixed(0)}%)`);
    if (worst.accuracy < 0.4) {
      recs.push(`Least accurate: ${worst.name} (${(worst.accuracy * 100).toFixed(0)}%) — consider downweighting`);
    }
  }

  return recs;
}
