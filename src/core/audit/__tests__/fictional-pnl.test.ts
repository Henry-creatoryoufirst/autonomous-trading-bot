/**
 * INV-2 tests — pure-function invariant.
 *
 * Test cases include the canonical example: TOSHI with -$2.3M realizedPnL
 * on a $3K portfolio. The invariant must catch this.
 */

import { describe, it, expect } from 'vitest';
import { fictionalPnl } from '../invariants/fictional-pnl.js';
import type { InvariantContext } from '../types.js';

function cb(opts: Partial<{ realizedPnL: number; totalInvestedUSD: number }>): {
  symbol: string; realizedPnL: number; totalInvestedUSD: number; totalTokensAcquired: number; averageCostBasis: number; currentHolding: number;
} {
  return {
    symbol: 'TEST',
    realizedPnL: opts.realizedPnL ?? 0,
    totalInvestedUSD: opts.totalInvestedUSD ?? 0,
    totalTokensAcquired: 1,
    averageCostBasis: 1,
    currentHolding: 1,
  };
}

function makeCtx(costBasisMap: Record<string, ReturnType<typeof cb>>, portfolioValue = 3000): InvariantContext {
  return {
    balances: [],
    totalPortfolioValue: portfolioValue,
    costBasis: costBasisMap,
    lastKnownPrices: {},
    capturedPrompt: null,
    cycle: 100,
    previousReport: null,
  };
}

describe('INV-2 no fictional per-token PnL', () => {
  it('returns null when all tokens have honest PnL', () => {
    const ctx = makeCtx({
      WETH: cb({ realizedPnL: 87, totalInvestedUSD: 217 }),
      USDC: cb({ realizedPnL: 0, totalInvestedUSD: 0 }),
    });
    expect(fictionalPnl(ctx)).toBeNull();
  });

  it('catches the TOSHI case (-$2.3M realized on $3K portfolio)', () => {
    const ctx = makeCtx({
      TOSHI: cb({ realizedPnL: -2_307_308, totalInvestedUSD: 1792 }),
      WETH: cb({ realizedPnL: 87, totalInvestedUSD: 217 }),
    });
    const v = fictionalPnl(ctx);
    expect(v).not.toBeNull();
    expect(v!.severity).toBe('SEVERE');
    expect(v!.invariantId).toBe('INV-2');
    expect(v!.affectedTokens).toContain('TOSHI');
    expect(v!.affectedTokens).not.toContain('WETH'); // clean tokens stay clean
    expect(v!.pauseScope).toBe('per-token-buys');
  });

  it('catches a token with realizedPnL > 10x totalInvestedUSD even when below portfolio', () => {
    const ctx = makeCtx({
      MYTOKEN: cb({ realizedPnL: -5000, totalInvestedUSD: 100 }), // 50× invested, but only $5K (< $30K portfolio)
    }, 30000);
    const v = fictionalPnl(ctx);
    expect(v).not.toBeNull();
    expect(v!.affectedTokens).toContain('MYTOKEN');
  });

  it('does not fire for small realizations on small investments (under absolute floor)', () => {
    // $5 invested, $60 realized P&L — 12× ratio but $60 is dust noise
    const ctx = makeCtx({
      DUST: cb({ realizedPnL: -60, totalInvestedUSD: 5 }),
    });
    expect(fictionalPnl(ctx)).toBeNull();
  });

  it('returns null when portfolio is zero (cannot compute ratios)', () => {
    const ctx = makeCtx({
      TOSHI: cb({ realizedPnL: -2_307_308, totalInvestedUSD: 1792 }),
    }, 0);
    expect(fictionalPnl(ctx)).toBeNull();
  });

  it('flags multiple offenders + sorts worst-first in observed', () => {
    const ctx = makeCtx({
      TOSHI: cb({ realizedPnL: -2_307_308, totalInvestedUSD: 1792 }),
      LUNA: cb({ realizedPnL: -50_000, totalInvestedUSD: 287 }),
      WELL: cb({ realizedPnL: -8_299, totalInvestedUSD: 0 }),
    });
    const v = fictionalPnl(ctx);
    expect(v).not.toBeNull();
    expect(v!.affectedTokens).toEqual(expect.arrayContaining(['TOSHI', 'LUNA', 'WELL']));
    const worst = (v!.observed as any).worstOffender;
    expect(worst.symbol).toBe('TOSHI');
  });

  it('handles totalInvestedUSD=0 case via the absolute floor', () => {
    // Token where invested is zero (sells stripped totalInvested) but realized is still big
    const ctx = makeCtx({
      ZOMBIE: cb({ realizedPnL: -50_000, totalInvestedUSD: 0 }),
    });
    const v = fictionalPnl(ctx);
    expect(v).not.toBeNull();
    expect(v!.affectedTokens).toContain('ZOMBIE');
  });
});
