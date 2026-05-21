/**
 * NVR-SPEC-035 INV-8 — Cycle-vs-trade ratio (Phase B, WARN tier).
 *
 * The "bot is running but not trading" detector. Heavy cycles advance
 * (state.totalCycles + 1) every ~15 minutes whether or not a trade fires.
 * If the cycle counter advances past warmup and `tradesSinceRestart`
 * stays at zero, the bot is rendering decisions that never execute —
 * either a routing bug, a stale gate, or a permanent HOLD lock-in.
 *
 * Captured by tracking trades since THIS process booted, not lifetime
 * `totalTrades`. A bot deployed mid-day with a 4,000-trade history would
 * never fire INV-8 against lifetime counters even if the new build was
 * completely silent. The boot-baseline (`state._tradesAtBoot`) snapshots
 * the lifetime count once at startup and we measure deltas off it.
 *
 * Fires WARN when:
 *   - `tradesSinceRestart === 0` AND `cycle > 8`
 *
 * Why cycle > 8 (not 1):
 *   - First few cycles after a Railway redeploy can legitimately not
 *     trade: discovery sweep is running, balance reconciliation might
 *     have rolled the cache, the auditor itself is warming. ~8 cycles ≈
 *     2 hours of heavy-cycle cadence (15 min/cycle) — generous enough to
 *     absorb that legitimate variance, tight enough to catch a real
 *     death within the first half-day after deploy.
 *
 * Why WARN, not SEVERE:
 *   - Going silent is OPPORTUNITY COST, not safety damage. Gating buys
 *     would cement the silence. The cure is to fix routing/gating, which
 *     informational pressure surfaces — surfacing it in-prompt lets the
 *     bot (or operator on Telegram) notice and remediate.
 *
 * Skip conditions:
 *   - `tradesSinceRestart` undefined → caller didn't populate this cycle
 *     (warmup, or pre-Phase-B agent version)
 *   - `cycle < 8` → still inside the boot grace window
 *   - `tradesSinceRestart > 0` → at least one trade has fired since boot;
 *     the bot is alive
 *
 * Pause scope: 'none'.
 */

import type { Invariant, Violation } from '../types.js';

const BOOT_GRACE_CYCLES = 8;

export const cycleTradeRatio: Invariant = (ctx) => {
  if (ctx.tradesSinceRestart === undefined) return null;
  if (ctx.cycle <= BOOT_GRACE_CYCLES) return null;
  if (ctx.tradesSinceRestart > 0) return null;

  // Approximate hours since boot from cycles. Heavy cycles default to
  // 15-minute cadence in CONFIG.cycleIntervalSec, so cycles * 0.25 ≈
  // hours since boot. This is informational only; the threshold check
  // is on cycle count, not wall time.
  const approxHoursSilent = parseFloat((ctx.cycle * 0.25).toFixed(2));

  const violation: Violation = {
    invariantId: 'INV-8',
    invariantName: 'cycle-trade-ratio',
    severity: 'WARN',
    message: `Bot has run ${ctx.cycle} heavy cycles (~${approxHoursSilent.toFixed(1)}h) since restart with zero trades executed. The bot is rendering decisions that never reach execution — investigate routing, gates, or permanent HOLD lock-in.`,
    observed: {
      cycle: ctx.cycle,
      tradesSinceRestart: ctx.tradesSinceRestart,
      bootGraceCycles: BOOT_GRACE_CYCLES,
      approxHoursSilent,
    },
    expected: {
      rule: `tradesSinceRestart > 0 once cycle > ${BOOT_GRACE_CYCLES}`,
    },
    pauseScope: 'none',
    detectedAt: new Date().toISOString(),
  };

  return violation;
};
