/**
 * Never Rest Capital — Cycle Stage: EXECUTION
 *
 * Phase 5c target. DEDICATED PR. 48-HOUR PAPER-TRADE SOAK BEFORE PRODUCTION.
 *
 * ⚠️  NEVER extract this stage alongside anything else.
 * ⚠️  Requires diff of tradeHistory JSON across 24h staging window (zero drift).
 * ⚠️  Requires separate PR from all other Phase 5 work.
 *
 * Extracts agent-v3.2.ts lines 7350–8000 (the 650-line trade loop).
 *
 * Responsibilities:
 *   - Per-decision executeTrade() calls with sizing, slippage, gas checks
 *   - TWAP execution for large orders
 *   - Sell-before-buy ordering
 *   - Post-trade cost basis + state mutations via StateManager
 *   - Trade circuit breaker (3 consecutive swap failures)
 *   - Hot Movers urgent re-evaluation
 *
 * Outputs on ctx:
 *   - ctx.tradeResults  populated with success/failure per decision
 *
 * DO NOT EXTRACT until Phase 5c session.
 */

import type { CycleContext } from '../../types/cycle.js';

export async function executionStage(ctx: CycleContext): Promise<CycleContext> {
  throw new Error(
    '[Phase 5c] executionStage not yet extracted — monolith handles EXECUTION inline (L7350–8000). ' +
    'This stage requires a DEDICATED PR with 48h paper-trade soak before production.',
  );
  return ctx;
}
