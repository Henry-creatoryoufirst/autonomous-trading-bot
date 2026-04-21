/**
 * NVR Capital — Capital Sleeves: Paper-trade simulator.
 *
 * v21.16 Phase 2: when a paper-mode sleeve returns a BUY or SELL decision,
 * the orchestrator doesn't route it to real execution — it routes here.
 * This module virtually applies the decision against the sleeve's own
 * positions map, tracks realized P&L, and updates the ownership record so
 * getStats() reflects the simulated performance.
 *
 * This is the engine that turns "Alpha Hunter decided to buy VIRTUAL" into
 * a line on the dashboard with a cost basis, a current mark, and eventually
 * a realized P&L when it exits. Without this, paper sleeves just log HOLDs
 * and never produce a track record worth graduating on.
 *
 * Design notes:
 *   - Paper sleeve's USDC is virtual. We track `virtualUSDC` as the
 *     remaining budget derived from paperBudgetsUSD minus deployed capital.
 *   - Two paper sleeves may hold the same symbol; each keeps its own cost
 *     basis. No interaction with global costBasis.
 *   - Realized P&L on SELL uses proportional cost basis (industry standard:
 *     average-cost method).
 *   - All mutations happen on the passed-in state. No I/O.
 *
 * See NVR-SPEC-010 §"Paper mode", NVR-SPEC-016 (graduation uses these stats).
 */

import type { TradeDecision } from '../types/market-data.js';
import type { SleevePosition } from './types.js';
import type { SleeveOwnership } from './state-types.js';

/**
 * Result of a single paper trade simulation. Useful for logging + tests.
 */
export interface PaperTradeResult {
  sleeveId: string;
  action: 'BUY' | 'SELL' | 'SKIP';
  symbol: string;
  tokensDelta: number;      // signed: positive for BUY, negative for SELL
  amountUSD: number;        // notional in USD at simulation time
  realizedPnLUSD?: number;  // only set on SELL
  skippedReason?: string;
}

/**
 * Available virtual USDC for a paper sleeve = total paper budget minus sum
 * of current position values (at cost). Bounded at 0.
 *
 * Note: this is a conservative budget — once a paper sleeve is fully
 * invested, it can't take another position until something exits. Matches
 * how real capital works.
 */
export function availablePaperUSDC(
  ownership: SleeveOwnership | undefined,
  paperBudgetUSD: number,
): number {
  if (!ownership) return paperBudgetUSD;
  const deployed = Object.values(ownership.positions).reduce(
    (sum, p) => sum + (p.costBasisUSD ?? 0),
    0,
  );
  return Math.max(0, paperBudgetUSD - deployed);
}

/**
 * Virtually apply a BUY decision to a paper sleeve's ownership.
 * Compounds with any existing position on the same symbol using the
 * weighted-average cost method.
 */
export function simulatePaperBuy(
  ownership: SleeveOwnership,
  decision: TradeDecision,
  currentPrice: number,
  cycle: number,
  nowIso: string = new Date().toISOString(),
): PaperTradeResult {
  const symbol = decision.toToken;
  const amountUSD = decision.amountUSD ?? 0;

  if (amountUSD <= 0) {
    return { sleeveId: '', action: 'SKIP', symbol, tokensDelta: 0, amountUSD: 0, skippedReason: 'amountUSD <= 0' };
  }
  if (currentPrice <= 0) {
    return { sleeveId: '', action: 'SKIP', symbol, tokensDelta: 0, amountUSD, skippedReason: 'no price' };
  }

  const tokensBought = amountUSD / currentPrice;
  const existing = ownership.positions[symbol];

  if (existing) {
    existing.balance += tokensBought;
    existing.costBasisUSD += amountUSD;
    existing.valueUSD = existing.balance * currentPrice;
  } else {
    ownership.positions[symbol] = {
      symbol,
      balance: tokensBought,
      costBasisUSD: amountUSD,
      valueUSD: amountUSD,
      openedAt: nowIso,
      openedInCycle: cycle,
    };
  }

  return { sleeveId: '', action: 'BUY', symbol, tokensDelta: tokensBought, amountUSD };
}

/**
 * Virtually apply a SELL decision to a paper sleeve's ownership.
 * Computes realized P&L against the sleeve-local weighted-average cost.
 * Supports both amountUSD and percent-based sells.
 */
export function simulatePaperSell(
  ownership: SleeveOwnership,
  decision: TradeDecision,
  currentPrice: number,
  cycle: number,
  _nowIso: string = new Date().toISOString(),
): PaperTradeResult {
  const symbol = decision.fromToken;
  const existing = ownership.positions[symbol];

  if (!existing || existing.balance <= 0) {
    return {
      sleeveId: '',
      action: 'SKIP',
      symbol,
      tokensDelta: 0,
      amountUSD: 0,
      skippedReason: 'no position to sell',
    };
  }
  if (currentPrice <= 0) {
    return { sleeveId: '', action: 'SKIP', symbol, tokensDelta: 0, amountUSD: 0, skippedReason: 'no price' };
  }

  // Resolve sell size: explicit amountUSD wins; else percent × position value; else full.
  const positionValue = existing.balance * currentPrice;
  let sellAmountUSD: number;
  if (decision.amountUSD && decision.amountUSD > 0) {
    sellAmountUSD = Math.min(decision.amountUSD, positionValue);
  } else if (decision.percent && decision.percent > 0) {
    sellAmountUSD = positionValue * Math.min(100, decision.percent) / 100;
  } else {
    sellAmountUSD = positionValue;
  }

  const tokensSold = sellAmountUSD / currentPrice;
  const proportionSold = Math.min(1, tokensSold / existing.balance);
  const costBasisSold = existing.costBasisUSD * proportionSold;
  const realizedPnLUSD = sellAmountUSD - costBasisSold;

  existing.balance -= tokensSold;
  existing.costBasisUSD -= costBasisSold;

  // If balance is effectively zero, remove the position entirely.
  if (existing.balance < 1e-9) {
    delete ownership.positions[symbol];
  } else {
    existing.valueUSD = existing.balance * currentPrice;
  }

  // Update sleeve-level counters (trades + wins + realized P&L).
  ownership.trades += 1;
  if (realizedPnLUSD > 0) ownership.wins += 1;
  ownership.realizedPnLUSD += realizedPnLUSD;

  return {
    sleeveId: '',
    action: 'SELL',
    symbol,
    tokensDelta: -tokensSold,
    amountUSD: sellAmountUSD,
    realizedPnLUSD,
  };
}

/**
 * Refresh valueUSD on every position in a sleeve's ownership from the
 * current market prices. Called each heavy cycle before decide() fires,
 * so sleeves see their own mark-to-market in ctx.positions.
 */
export function markToMarketSleeve(
  ownership: SleeveOwnership | undefined,
  prices: Record<string, number>,
): void {
  if (!ownership) return;
  for (const [symbol, position] of Object.entries(ownership.positions)) {
    const price = prices[symbol];
    if (typeof price === 'number' && price > 0) {
      position.valueUSD = position.balance * price;
    }
  }
}

/**
 * Dispatch a decision to the correct paper-sim path based on action.
 * Returns the simulation result (for logging). Mutates `ownership`.
 * Returns null if the decision isn't a BUY or SELL (no-op for HOLD, etc.).
 */
export function simulatePaperDecision(
  sleeveId: string,
  ownership: SleeveOwnership,
  decision: TradeDecision,
  prices: Record<string, number>,
  cycle: number,
  nowIso: string = new Date().toISOString(),
): PaperTradeResult | null {
  if (decision.action === 'BUY') {
    const price = prices[decision.toToken] ?? 0;
    const result = simulatePaperBuy(ownership, decision, price, cycle, nowIso);
    result.sleeveId = sleeveId;
    return result;
  }
  if (decision.action === 'SELL') {
    const price = prices[decision.fromToken] ?? 0;
    const result = simulatePaperSell(ownership, decision, price, cycle, nowIso);
    result.sleeveId = sleeveId;
    return result;
  }
  return null;
}
