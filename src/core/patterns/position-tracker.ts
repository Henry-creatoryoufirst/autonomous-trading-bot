/**
 * NVR-SPEC-022 — Position Tracker
 *
 * Per-pattern position bookkeeping. Tracks every position the runtime
 * has opened on behalf of a pattern, marks them to market, and answers
 * the question Constitution #8 + the Cockpit Mirror demand:
 *
 *   "Which pattern made or lost money this week?"
 *
 * Each open position carries its source pattern as `patternName` so
 * realized P&L attributes to the right module. Closed positions move
 * to a per-pattern history bucket so the runtime can summarize.
 *
 * Pure in-memory data structure — persistence is the runtime's concern,
 * not this tracker's. The tracker is intentionally small + dependency-free
 * so it can be reused under tests, backtests, and the live runtime
 * without coupling.
 */

import type { Position } from "./types.js";

// ----------------------------------------------------------------------------
// A closed position carries the realization data we need for attribution
// ----------------------------------------------------------------------------

export interface ClosedPosition extends Position {
  readonly closedAt: string;
  readonly closePrice: number;
  readonly closeUsd: number;
  readonly realizedPnL: number;
  readonly closeReason: string;
}

// ----------------------------------------------------------------------------
// Per-pattern summary the cockpit will render
// ----------------------------------------------------------------------------

export interface PatternStats {
  readonly patternName: string;
  readonly openCount: number;
  readonly closedCount: number;
  readonly realizedPnL: number;
  readonly unrealizedPnL: number;
  readonly winCount: number;
  readonly lossCount: number;
  readonly breakevenCount: number;
  readonly winRate: number; // 0–1, 0 if no closes
}

// ----------------------------------------------------------------------------
// Tracker
// ----------------------------------------------------------------------------

export class PositionTracker {
  private open: Map<string, Position[]> = new Map(); // patternName → positions
  private closed: Map<string, ClosedPosition[]> = new Map(); // patternName → history

  /** Record a freshly-opened position from a pattern's `enter()`. */
  open_(p: Position): void {
    const list = this.open.get(p.patternName) ?? [];
    list.push(p);
    this.open.set(p.patternName, list);
  }

  /**
   * Close an open position. Caller passes the exit price + reason; tracker
   * computes realized P&L. If no matching open position is found (by
   * patternName + symbol + entryAt), throws — closing a phantom is a bug.
   */
  close_(
    patternName: string,
    symbol: string,
    entryAt: string,
    exit: { closeAt: string; closePrice: number; reason: string },
  ): ClosedPosition {
    const list = this.open.get(patternName) ?? [];
    const idx = list.findIndex((p) => p.symbol === symbol && p.entryAt === entryAt);
    if (idx < 0) {
      throw new Error(
        `PositionTracker.close: no open position for ${patternName}/${symbol}@${entryAt}`,
      );
    }
    const [pos] = list.splice(idx, 1);
    if (pos === undefined) {
      throw new Error(
        `PositionTracker.close: spliced position was undefined (${patternName}/${symbol})`,
      );
    }
    this.open.set(patternName, list);

    // Same-token spot trade: P&L is just (closePrice − entryPrice) × tokenAmount.
    // entryUsd / entryPrice = tokenAmount. closeUsd = tokenAmount × closePrice.
    const tokenAmount = pos.entryPrice > 0 ? pos.entryUsd / pos.entryPrice : 0;
    const closeUsd = tokenAmount * exit.closePrice;
    const realizedPnL = closeUsd - pos.entryUsd;

    const c: ClosedPosition = {
      ...pos,
      closedAt: exit.closeAt,
      closePrice: exit.closePrice,
      closeUsd,
      realizedPnL,
      closeReason: exit.reason,
    };
    const hist = this.closed.get(patternName) ?? [];
    hist.push(c);
    this.closed.set(patternName, hist);

    return c;
  }

  /** All currently-open positions for a pattern (or all patterns if omitted). */
  openPositions(patternName?: string): readonly Position[] {
    if (patternName !== undefined) return this.open.get(patternName) ?? [];
    const out: Position[] = [];
    for (const list of this.open.values()) out.push(...list);
    return out;
  }

  /** All closed positions for a pattern (or all if omitted). */
  closedPositions(patternName?: string): readonly ClosedPosition[] {
    if (patternName !== undefined) return this.closed.get(patternName) ?? [];
    const out: ClosedPosition[] = [];
    for (const list of this.closed.values()) out.push(...list);
    return out;
  }

  /** Pattern-by-pattern breakdown for the cockpit. Marks open positions
   *  to market using the supplied price map. */
  stats(currentPrices: ReadonlyMap<string, number>): PatternStats[] {
    const allPatterns = new Set<string>([
      ...this.open.keys(),
      ...this.closed.keys(),
    ]);
    const out: PatternStats[] = [];
    for (const name of allPatterns) {
      const opens = this.open.get(name) ?? [];
      const closes = this.closed.get(name) ?? [];
      const realized = closes.reduce((s, c) => s + c.realizedPnL, 0);
      let unrealized = 0;
      for (const p of opens) {
        const px = currentPrices.get(p.symbol);
        if (px === undefined || p.entryPrice <= 0) continue;
        const tokenAmount = p.entryUsd / p.entryPrice;
        unrealized += tokenAmount * px - p.entryUsd;
      }
      // Win / loss / BE thresholds match CRITIC's classification (±$0.50)
      // so per-pattern stats and CRITIC's audit speak the same language.
      let wins = 0;
      let losses = 0;
      let breakeven = 0;
      for (const c of closes) {
        if (c.realizedPnL > 0.5) wins++;
        else if (c.realizedPnL < -0.5) losses++;
        else breakeven++;
      }
      const decisive = wins + losses;
      out.push({
        patternName: name,
        openCount: opens.length,
        closedCount: closes.length,
        realizedPnL: realized,
        unrealizedPnL: unrealized,
        winCount: wins,
        lossCount: losses,
        breakevenCount: breakeven,
        winRate: decisive > 0 ? wins / decisive : 0,
      });
    }
    return out;
  }
}
