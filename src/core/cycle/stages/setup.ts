/**
 * Never Rest Capital — Cycle Stage: SETUP
 *
 * Phase 5b extraction. Extracts agent-v3.2.ts lines 6073–6082:
 * the balance fetch, market data fetch, and the three module-level
 * state variable updates that anchor every heavy cycle.
 *
 * Scope deliberately minimal for 5b — only the async data-acquisition
 * calls and their immediate downstream writes. The macro regime block
 * (L6084–6124), volume spikes, DEX intel, etc. remain inline in the
 * monolith until later sub-sessions can inject their many extra deps.
 *
 * SetupDeps: two injected async functions, nothing else. The monolith
 * passes its own module-level functions at call time.
 *
 * Caller pattern (agent-v3.2.ts after extraction):
 *   const ctx = buildInitialCycleContext(...);
 *   ctx = await setupStage(ctx, { getBalances, getMarketData });
 *   if (ctx.halted) return;
 *   // Update module-level vars from ctx output
 *   lastHeavyCycleAt  = Date.now();
 *   lastPriceSnapshot = new Map(ctx.marketData!.tokens.map(t => [t.symbol, t.price]));
 *   lastFearGreedValue = ctx.marketData!.fearGreed.value;
 *   // Reassign locals for remaining inline sections
 *   balances   = ctx.balances as any;
 *   marketData = ctx.marketData;
 */

import type { CycleContext } from '../../types/cycle.js';
import type { MarketData } from '../../types/market-data.js';

// ============================================================================
// DEPS
// ============================================================================

export type BalanceEntry = {
  symbol: string;
  balance: number;
  usdValue: number;
  price?: number;
  sector?: string;
};

export interface SetupDeps {
  /** Fetch on-chain balances for the bot wallet. Mirrors agent-v3.2.ts getBalances(). */
  getBalances(): Promise<BalanceEntry[]>;
  /** Fetch market data for all tracked tokens. Mirrors agent-v3.2.ts getMarketData(). */
  getMarketData(): Promise<MarketData>;
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * SETUP stage — data acquisition.
 *
 * Fetches balances and market data in sequence (market data depends on having
 * fresh prices after balances are known).
 *
 * On success:  ctx.balances, ctx.marketData, ctx.currentPrices populated.
 * On failure:  ctx.halted = true, ctx.haltReason set — caller skips heavy cycle.
 */
export async function setupStage(
  ctx: CycleContext,
  deps: SetupDeps,
): Promise<CycleContext> {
  // ── Fetch balances (mirrors L6073–6074) ──────────────────────────────────
  console.log('\n📊 Fetching balances...');
  let balances: BalanceEntry[];
  try {
    balances = await deps.getBalances();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ getBalances failed: ${msg}`);
    ctx.halted    = true;
    ctx.haltReason = `SETUP_FAIL:getBalances — ${msg}`;
    ctx.stagesCompleted.push('SETUP');
    return ctx;
  }

  // ── Fetch market data (mirrors L6076–6077) ───────────────────────────────
  console.log('📈 Fetching market data for all tracked tokens...');
  let marketData: MarketData;
  try {
    marketData = await deps.getMarketData();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ getMarketData failed: ${msg}`);
    ctx.halted    = true;
    ctx.haltReason = `SETUP_FAIL:getMarketData — ${msg}`;
    ctx.stagesCompleted.push('SETUP');
    return ctx;
  }

  // ── Populate ctx (L6079–6082 state var updates handled by caller) ────────
  ctx.balances      = balances;
  ctx.marketData    = marketData;
  ctx.currentPrices = Object.fromEntries(
    marketData.tokens.map(t => [t.symbol, t.price]),
  );

  ctx.stagesCompleted.push('SETUP');
  return ctx;
}
