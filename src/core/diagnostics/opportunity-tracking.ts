/**
 * Never Rest Capital — Opportunity Cost Tracking
 * Extracted from agent-v3.2.ts (Phase 11 refactor)
 *
 * Tracks blocked trades, scores them after 4h to evaluate whether holding cash was correct.
 */

export interface OpportunityCostLog {
  entries: OpportunityCostEntry[];
  cumulativeMissedPnl: number;
  cumulativeMissedCount: number;
}

interface OpportunityCostEntry {
  timestamp: number;
  token: string;
  reason: string;
  blockedSizeUSD: number;
  priceAtBlock: number;
  scored: boolean;
  priceNow?: number;
  missedPnlUSD?: number;
}

export function logMissedOpportunity(
  token: string,
  reason: string,
  blockedSizeUSD: number,
  priceAtBlock: number,
  log: OpportunityCostLog,
): void {
  log.entries.push({
    timestamp: Date.now(),
    token,
    reason,
    blockedSizeUSD,
    priceAtBlock,
    scored: false,
  });
  if (log.entries.length > 1000) log.entries = log.entries.slice(-1000);
  log.cumulativeMissedCount++;
}

export function updateOpportunityCosts(
  currentPrices: Record<string, number>,
  log: OpportunityCostLog,
): void {
  const SCORING_DELAY_MS = 4 * 60 * 60 * 1000;
  for (const entry of log.entries) {
    if (entry.scored) continue;
    if (Date.now() - entry.timestamp < SCORING_DELAY_MS) continue;
    if (entry.priceAtBlock <= 0) { entry.scored = true; continue; }
    const currentPrice = currentPrices[entry.token];
    if (!currentPrice || currentPrice <= 0) continue;
    entry.priceNow = currentPrice;
    const pnlPct = (currentPrice - entry.priceAtBlock) / entry.priceAtBlock;
    entry.missedPnlUSD = entry.blockedSizeUSD * pnlPct;
    log.cumulativeMissedPnl += entry.missedPnlUSD;
    entry.scored = true;
    const sign = entry.missedPnlUSD >= 0 ? '+' : '';
    console.log(`  📊 OPPORTUNITY COST: ${entry.token} (${entry.reason}) — blocked $${entry.blockedSizeUSD.toFixed(0)} → ${sign}$${entry.missedPnlUSD.toFixed(2)} (${(pnlPct * 100).toFixed(1)}%) after 4h`);
  }
}

export function getOpportunityCostSummary(log: OpportunityCostLog) {
  const scored = log.entries.filter(e => e.scored && e.missedPnlUSD !== undefined);
  const missedGains = scored.filter(e => (e.missedPnlUSD ?? 0) > 0);
  const avoidedLosses = scored.filter(e => (e.missedPnlUSD ?? 0) <= 0);
  return {
    totalMissedPnl: log.cumulativeMissedPnl,
    totalBlockedCount: log.cumulativeMissedCount,
    scoredCount: scored.length,
    missedGainsCount: missedGains.length,
    avoidedLossesCount: avoidedLosses.length,
    avgMissedPnl: scored.length > 0 ? log.cumulativeMissedPnl / scored.length : 0,
    recentMisses: log.entries.slice(-10).map(e => ({
      token: e.token,
      reason: e.reason,
      blockedUSD: e.blockedSizeUSD,
      missedPnl: e.missedPnlUSD,
      scored: e.scored,
      age: Math.round((Date.now() - e.timestamp) / 3600000) + 'h ago',
    })),
  };
}
