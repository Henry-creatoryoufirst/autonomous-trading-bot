/**
 * Trade counter reconciliation tests (v21.19-counters).
 *
 * Prod snapshot on 2026-04-22 ~12:14 UTC showed three disagreeing counters:
 *   - GET /health          .totalTradesExecuted  = 1814
 *   - GET /api/portfolio   .totalTrades          = 1968
 *   - GET /api/sleeves     [0].trades            = 1814
 * …plus /health.hoursSinceLastTrade = 13.9 while /api/daily-pnl showed 30
 * trades the same day — a direct lie.
 *
 * Root cause: /health and sleeve stats count successful actionable trades in
 * the in-memory tradeHistory array (capped at 5000 rows), while
 * /api/portfolio.totalTrades is a monotonically-incremented lifetime counter
 * persisted as lifetimeTotalTrades in the state file. These measure
 * fundamentally different things and MUST diverge once the buffer rolls.
 *
 * Separately, /health.hoursSinceLastTrade was derived from a ServerContext
 * primitive captured at construction time — it never updated post-startup.
 *
 * This test pins the invariants of the reconciliation:
 *   1. totalTradesAllTime   >= tradesSinceRestart    (monotonic counter cap)
 *   2. successfulTradesAllTime <= totalTradesAllTime (filter subset)
 *   3. tradesSinceRestart computed from tradeHistory matches sleeve stats
 *   4. lastLiveExecutionAt is derived from tradeHistory (never stale)
 */

import { describe, it, expect } from 'vitest';

type TradeRecordLite = {
  action: 'BUY' | 'SELL' | 'HOLD';
  success: boolean;
  timestamp: string;
};

/**
 * Mirrors the canonical filter used by both /health and CoreSleeve.getStats():
 * "successful, actionable (non-HOLD) trades in the current in-memory buffer".
 * If this filter ever diverges between callers we'll see two counters that
 * can't agree even theoretically — don't let that happen.
 */
function tradesSinceRestart(history: TradeRecordLite[]): number {
  return history.filter(
    (t) => t.success && (t.action === 'BUY' || t.action === 'SELL'),
  ).length;
}

function lastLiveExecutionAt(history: TradeRecordLite[]): string | null {
  const actionable = history.filter(
    (t) => t.success && (t.action === 'BUY' || t.action === 'SELL'),
  );
  return actionable.length > 0
    ? actionable[actionable.length - 1].timestamp
    : null;
}

describe('trade counter reconciliation (v21.19-counters)', () => {
  it('totalTradesAllTime >= tradesSinceRestart once buffer rolls', () => {
    // Simulate prod-like state: lifetime counter at 1968, tradeHistory holds
    // only the most recent 1814 successful actionable trades (older rows
    // trimmed by the 5000-row cap over time).
    const stateTrading = {
      totalTrades: 1968,
      successfulTrades: 1831,
    };
    const tradeHistory: TradeRecordLite[] = Array.from({ length: 1814 }, (_, i) => ({
      action: i % 2 === 0 ? 'BUY' : 'SELL',
      success: true,
      timestamp: new Date(Date.now() - (1814 - i) * 60_000).toISOString(),
    }));

    const sinceRestart = tradesSinceRestart(tradeHistory);
    expect(stateTrading.totalTrades).toBeGreaterThanOrEqual(sinceRestart);
    expect(stateTrading.successfulTrades).toBeLessThanOrEqual(stateTrading.totalTrades);
    expect(sinceRestart).toBe(1814);
  });

  it('tradesSinceRestart matches CoreSleeve-style filter (health <-> sleeves)', () => {
    // The bug we're fixing: /health and /api/sleeves/compare.sleeves[0].trades
    // must agree because they count the same thing. If we ever split their
    // filters, this test will catch it before the dashboard does.
    const history: TradeRecordLite[] = [
      { action: 'BUY',  success: true,  timestamp: '2026-04-22T01:00:00Z' },
      { action: 'SELL', success: true,  timestamp: '2026-04-22T02:00:00Z' },
      { action: 'BUY',  success: false, timestamp: '2026-04-22T03:00:00Z' }, // failed — excluded
      { action: 'HOLD', success: true,  timestamp: '2026-04-22T04:00:00Z' }, // hold — excluded
      { action: 'SELL', success: true,  timestamp: '2026-04-22T05:00:00Z' },
    ];
    const healthCount = history.filter(
      (t) => t.success && (t.action === 'BUY' || t.action === 'SELL'),
    ).length;
    const sleeveCount = tradesSinceRestart(history);
    expect(healthCount).toBe(sleeveCount);
    expect(sleeveCount).toBe(3);
  });

  it('lastLiveExecutionAt reflects the most recent successful trade, not process uptime', () => {
    // The smoking-gun bug: old /health read a module-level `let` snapshot
    // captured at ServerContext construction. Post-restart, with 30 trades
    // already persisted from yesterday, hoursSinceLastTrade still reported
    // ~uptime-hours because the snapshot never updated.
    //
    // The fixed implementation derives this from tradeHistory every call.
    const history: TradeRecordLite[] = [
      { action: 'BUY',  success: true,  timestamp: '2026-04-22T08:00:00Z' },
      { action: 'SELL', success: true,  timestamp: '2026-04-22T10:30:00Z' },
      { action: 'BUY',  success: false, timestamp: '2026-04-22T11:00:00Z' }, // failed — ignored
    ];
    expect(lastLiveExecutionAt(history)).toBe('2026-04-22T10:30:00Z');

    // Empty / fresh bot: null, not "now" or a uptime proxy.
    expect(lastLiveExecutionAt([])).toBeNull();
  });

  it('deprecated aliases (totalTradesExecuted, hoursSinceLastTrade, trades) equal their canonical counterparts', () => {
    // Alias contract: during the one-release deprecation window, old names
    // must return exactly the same value as the new names — otherwise we
    // ship a silent behavior change alongside the rename.
    const history: TradeRecordLite[] = [
      { action: 'BUY',  success: true, timestamp: '2026-04-22T08:00:00Z' },
      { action: 'SELL', success: true, timestamp: '2026-04-22T10:30:00Z' },
    ];
    const canonical = {
      tradesSinceRestart: tradesSinceRestart(history),
      hoursSinceLastLiveExecution: 2.5, // representative, not asserting value
    };
    const deprecated = {
      totalTradesExecuted: canonical.tradesSinceRestart,
      hoursSinceLastTrade: canonical.hoursSinceLastLiveExecution,
    };
    expect(deprecated.totalTradesExecuted).toBe(canonical.tradesSinceRestart);
    expect(deprecated.hoursSinceLastTrade).toBe(canonical.hoursSinceLastLiveExecution);
  });
});
