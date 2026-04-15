/**
 * Never Rest Capital — Cycle Stage: SETUP
 *
 * Phase 5b target. Extracts agent-v3.2.ts lines 6102–6175.
 *
 * Responsibilities:
 *   - Fetch on-chain balances (getBalances)
 *   - Fetch market data for all tracked tokens (getMarketData)
 *   - Update light/heavy cycle timestamps + price snapshot
 *   - Bear mode / macro regime determination (Signal Service → local fallback)
 *   - Fetch fear & greed, SHI incident router warmup
 *
 * Outputs on ctx:
 *   - ctx.balances          populated
 *   - ctx.marketData        populated
 *   - ctx.currentPrices     populated (from marketData)
 *
 * DO NOT EXTRACT until Phase 5b session. This stub throws to prevent
 * accidental early calls.
 */

import type { CycleContext } from '../../types/cycle.js';

export async function setupStage(ctx: CycleContext): Promise<CycleContext> {
  throw new Error('[Phase 5b] setupStage not yet extracted — monolith handles SETUP inline (L6102–6175)');
  return ctx; // unreachable — satisfies TypeScript return type
}
