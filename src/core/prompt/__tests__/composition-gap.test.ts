import { describe, it, expect } from 'vitest';
import {
  formatCompositionGapBlock,
  type PositionRow,
  type CompositionMissionContext,
} from '../composition-gap.js';

/**
 * 2026-05-28 — "yardstick, not target" reframe.
 *
 * These tests lock in the dead-cash-ratchet fix: the prompt frame must (a) make
 * deploying excess cash the dominant directive when over the 25% reserve, (b)
 * forbid raising cash above reserve by trimming a liquid hold, and (c) frame the
 * 60/40 cbBTC/WETH benchmark as a yardstick rather than a holdings target the
 * LLM must replicate by "closing the cbBTC gap."
 */

// The real prod shape on 2026-05-28: 61% cash/stables, WETH the only meaningful
// risk hold, cbBTC dust, never accumulated.
function overCashContext(): { positions: PositionRow[]; ctx: CompositionMissionContext } {
  const positions: PositionRow[] = [
    { symbol: 'WETH', usdValue: 980 },
    { symbol: 'cbBTC', usdValue: 0.7 },
    { symbol: 'cbLTC', usdValue: 196 },
    { symbol: 'aBasUSDC', usdValue: 546 }, // Aave yield — non-cohort bucket
  ];
  const ctx: CompositionMissionContext = {
    totalPortfolioValue: 3050,
    usdcWalletBalance: 1302, // ~43% raw USDC
    totalHarvestedUsd: 389,
    netCapitalInUsd: 3277,
  };
  return { positions, ctx };
}

describe('formatCompositionGapBlock — yardstick, not target', () => {
  it('makes deploying excess cash the dominant directive when over the 25% reserve', () => {
    const { positions, ctx } = overCashContext();
    const block = formatCompositionGapBlock(positions, ctx);
    expect(block).toContain('UNDER-DEPLOYED');
    expect(block).toMatch(/DEPLOY/);
    // Must explicitly forbid the ratchet: raising cash by trimming a liquid hold.
    expect(block).toContain('DO NOT raise cash');
  });

  it('frames the 60/40 benchmark as a YARDSTICK, not a holdings target', () => {
    const { positions, ctx } = overCashContext();
    const block = formatCompositionGapBlock(positions, ctx);
    expect(block).toMatch(/YARDSTICK|measured against|not required to HOLD/i);
    // The old ratchet language must be gone.
    expect(block).not.toContain('LARGE structural drag');
    expect(block).not.toMatch(/close the .*gap/i);
    expect(block).not.toMatch(/fund the cbBTC gap/i);
  });

  it('marks cbBTC as thin-liquidity / opportunistic, never a weight to force', () => {
    const { positions, ctx } = overCashContext();
    const block = formatCompositionGapBlock(positions, ctx);
    expect(block).toMatch(/cbBTC.*thin|thin.*Base/i);
    expect(block).toMatch(/opportunistic/i);
  });

  it('does NOT label WETH as overweight (it is the deepest-liquidity major)', () => {
    const { positions, ctx } = overCashContext();
    const block = formatCompositionGapBlock(positions, ctx);
    // The old ratchet framing: "WETH structurally overweight at X% vs 40% target".
    expect(block).not.toMatch(/overweight at/i);
    expect(block).not.toMatch(/structurally overweight/i);
    // The new framing affirms WETH as a legitimate hold.
    expect(block).toMatch(/WETH.*legitimate core hold|deepest-liquidity major/i);
  });

  it('tells the bot to replenish when reserve is BELOW 25%', () => {
    const positions: PositionRow[] = [{ symbol: 'WETH', usdValue: 2900 }];
    const ctx: CompositionMissionContext = {
      totalPortfolioValue: 3000,
      usdcWalletBalance: 100, // ~3% — well under reserve
      totalHarvestedUsd: 0,
      netCapitalInUsd: 3000,
    };
    const block = formatCompositionGapBlock(positions, ctx);
    expect(block).toMatch(/BELOW 25%|replenish/i);
    expect(block).not.toContain('UNDER-DEPLOYED');
  });

  it('stays neutral when reserve is in the healthy ~25% band', () => {
    const positions: PositionRow[] = [{ symbol: 'WETH', usdValue: 2250 }];
    const ctx: CompositionMissionContext = {
      totalPortfolioValue: 3000,
      usdcWalletBalance: 750, // 25%
      totalHarvestedUsd: 0,
      netCapitalInUsd: 3000,
    };
    const block = formatCompositionGapBlock(positions, ctx);
    expect(block).toMatch(/healthy band/i);
    expect(block).not.toContain('UNDER-DEPLOYED');
    expect(block).not.toContain('DO NOT raise cash');
  });

  it('preserves the mission framing (grow port + harvest from growth)', () => {
    const { positions, ctx } = overCashContext();
    const block = formatCompositionGapBlock(positions, ctx);
    expect(block).toMatch(/GROW port value/i);
    expect(block).toMatch(/harvest/i);
    // Sustainability read: port ($3050) below net capital in ($3277) → not sustainable.
    expect(block).toContain('NOT sustainable');
  });

  it('handles unloaded portfolio gracefully', () => {
    const block = formatCompositionGapBlock([], {
      totalPortfolioValue: 0,
      usdcWalletBalance: 0,
      totalHarvestedUsd: 0,
      netCapitalInUsd: 0,
    });
    expect(block).toContain('Composition data unavailable');
  });
});
