/**
 * NVR Capital — Capital Sleeves: Orchestrator helpers.
 *
 * v21.15 Phase 1.2b: pure helpers the agent-v3.2.ts heavy-cycle orchestrator
 * uses to loop every registered sleeve, log decisions (including HOLDs),
 * project global costBasis into Core's sleeve balance sheet, and write back
 * trade effects to per-sleeve ownership.
 *
 * Kept in its own module so the logic is testable without spinning up the
 * monolith. All functions are pure w.r.t. their inputs — mutations happen
 * only on the state object passed in.
 *
 * See NVR-SPEC-010, NVR-SPEC-016 (graduation), and the 2026-04-21 session.
 */

import type { TokenCostBasis, TradeRecord } from '../types/index.js';
import type { TradeDecision } from '../types/market-data.js';
import type {
  SleeveDecisionLog,
  SleeveDecisionMode,
  SleeveOwnership,
} from './state-types.js';
import type { SleeveMode, SleevePosition } from './types.js';
import { MAX_DECISIONS_PER_SLEEVE } from './state-types.js';

/**
 * Determine the effective execution mode for a sleeve this cycle:
 *   - 'live':   sleeve mode='live' AND allocation > 0 AND enabled
 *   - 'paper':  sleeve mode='paper' (or overridden to paper) AND enabled —
 *               decide() runs, decisions logged as paper, never executed
 *   - 'shadow': allocation = 0 OR disabled — decide() still runs so the
 *               sleeve keeps building a shadow track record; decisions
 *               logged as shadow, never executed
 *
 * The invariant: only 'live' decisions leave the sleeve orchestrator bound
 * for execution. Everything else is observability.
 */
export function resolveEffectiveMode(
  sleeveMode: SleeveMode,
  allocation: number,
  enabled: boolean,
  modeOverride: SleeveMode | undefined,
): SleeveDecisionMode {
  if (!enabled) return 'shadow';
  const effective = modeOverride ?? sleeveMode;
  if (effective === 'paper') return 'paper';
  if (allocation <= 0) return 'shadow';
  return 'live';
}

/**
 * Project the bot's global costBasis into the Core sleeve's position map.
 * Called at the start of each heavy cycle before sleeves run decide().
 *
 * Why projection (not independent tracking) for Core in Phase 1.2b:
 *   - Core owns 100% of live positions today; its sleeve balance sheet must
 *     match the global cost-basis engine exactly, or reconciliation drifts.
 *   - Keeping global costBasis as the source of truth means the existing
 *     cost-basis engine remains authoritative — no parallel bookkeeping.
 *   - Alpha sleeves, when they graduate to live capital, will track their
 *     own positions independently (and the global costBasis will sum over
 *     sleeves). That upgrade is Phase 3+.
 *
 * For now: Core's positions are a pure function of global costBasis, and
 * we call this every cycle so the sleeve API always reflects reality.
 */
export function syncCoreSleevePositions(state: {
  costBasis: Record<string, TokenCostBasis>;
  sleeveOwnership?: Record<string, SleeveOwnership>;
  totalCycles?: number;
}): void {
  const core = state.sleeveOwnership?.core;
  if (!core) return;

  const positions: Record<string, SleevePosition> = {};
  const now = new Date().toISOString();
  for (const [symbol, cb] of Object.entries(state.costBasis)) {
    if (!cb || !cb.currentHolding || cb.currentHolding <= 0) continue;
    const avgCost = cb.averageCostBasis || 0;
    positions[symbol] = {
      symbol,
      balance: cb.currentHolding,
      costBasisUSD: avgCost * cb.currentHolding,
      valueUSD: 0, // filled by mark-to-market elsewhere
      openedAt: cb.firstBuyDate || now,
      openedInCycle: 0,
    };
  }
  core.positions = positions;
  core.realizedPnLUSD = Object.values(state.costBasis).reduce(
    (sum, cb) => sum + (cb?.realizedPnL || 0),
    0,
  );
}

/**
 * Write-back after a trade record lands in state.tradeHistory. Updates
 * the owning sleeve's counters. Position changes are handled separately
 * by syncCoreSleevePositions() (projection from costBasis).
 *
 * Win tracking: only successful SELLs with a realizedPnL field get
 * counted — failed trades and BUYs don't score. realizedPnL > 0 → win,
 * otherwise → loss (but still counts toward `trades` for win-rate base).
 */
export function recordTradeOnSleeve(
  state: { sleeveOwnership?: Record<string, SleeveOwnership> },
  record: TradeRecord,
): void {
  const sleeveId = record.ownerSleeve ?? 'core';
  const ownership = state.sleeveOwnership?.[sleeveId];
  if (!ownership) return;

  if (record.success && (record.action === 'BUY' || record.action === 'SELL')) {
    ownership.trades += 1;
  }
  if (
    record.success
    && record.action === 'SELL'
    && record.realizedPnL !== undefined
    && record.realizedPnL > 0
  ) {
    ownership.wins += 1;
  }

  ownership.lastDecisionAt = record.timestamp;
}

/**
 * Log a decision entry to the owning sleeve. A null decision is recorded
 * as a HOLD — this keeps a per-cycle cadence in the log so later
 * regime-conditioned analyses don't have missing rows.
 *
 * Capped per sleeve to MAX_DECISIONS_PER_SLEEVE; oldest entries are dropped.
 */
export function logSleeveDecision(
  state: {
    sleeveOwnership?: Record<string, SleeveOwnership>;
    totalCycles: number;
  },
  sleeveId: string,
  decision: TradeDecision | null,
  mode: SleeveDecisionMode,
  regime: string,
  options?: { executed?: boolean; txHash?: string; realizedPnL?: number },
): void {
  const ownership = state.sleeveOwnership?.[sleeveId];
  if (!ownership) return;

  const now = new Date().toISOString();
  const symbol = decision
    ? decision.fromToken === 'USDC'
      ? decision.toToken
      : decision.fromToken
    : '';

  const log: SleeveDecisionLog = {
    cycle: state.totalCycles,
    timestamp: now,
    action: decision?.action === 'WITHDRAW' ? 'HOLD' : (decision?.action ?? 'HOLD'),
    symbol: symbol || '',
    amountUSD: decision?.amountUSD,
    mode,
    executed: options?.executed ?? false,
    reasoning: decision?.reasoning?.slice(0, 200),
    attribution: decision?.signalContext?.triggeredBy,
    regime,
    txHash: options?.txHash,
    realizedPnL: options?.realizedPnL,
  };

  ownership.decisions.push(log);
  if (ownership.decisions.length > MAX_DECISIONS_PER_SLEEVE) {
    ownership.decisions = ownership.decisions.slice(-MAX_DECISIONS_PER_SLEEVE);
  }
  ownership.lastDecisionAt = now;
}
