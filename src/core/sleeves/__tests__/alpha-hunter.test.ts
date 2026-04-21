import { describe, it, expect } from 'vitest';
import { AlphaHunterSleeve } from '../alpha-hunter.js';
import type { SleeveContext, SleevePosition, DiscoveryCandidate } from '../types.js';
import type { SleeveOwnership } from '../state-types.js';

function mkOwnership(): SleeveOwnership {
  return {
    positions: {},
    realizedPnLUSD: 0,
    trades: 0,
    wins: 0,
    dailyPayouts: [],
    regimeReturns: {},
    decisions: [],
    lastDecisionAt: null,
    createdAt: '2026-04-21T00:00:00.000Z',
  };
}

function mkPosition(symbol: string, costBasisUSD: number, balance: number, openedAt: string): SleevePosition {
  return {
    symbol,
    balance,
    costBasisUSD,
    valueUSD: balance,
    openedAt,
    openedInCycle: 1,
  };
}

function mkCandidate(partial: Partial<DiscoveryCandidate> & { symbol: string; convictionScore: number }): DiscoveryCandidate {
  return {
    symbol: partial.symbol,
    convictionScore: partial.convictionScore,
    sector: partial.sector ?? 'MEME',
    price: partial.price ?? 1,
    volume24h: partial.volume24h ?? 100_000,
    priceChange24h: partial.priceChange24h ?? 5,
    isRunner: partial.isRunner ?? false,
  };
}

function mkCtx(partial: {
  positions?: SleevePosition[];
  availableUSDC?: number;
  capitalBudgetUSD?: number;
  prices?: Record<string, number>;
  candidates?: DiscoveryCandidate[];
}): SleeveContext {
  return {
    capitalBudgetUSD: partial.capitalBudgetUSD ?? 1000,
    positions: partial.positions ?? [],
    availableUSDC: partial.availableUSDC ?? 1000,
    market: {
      cycleNumber: 42,
      builtAt: new Date().toISOString(),
      prices: partial.prices ?? {},
      regime: 'RANGING',
      fearGreed: 50,
      discovery: { candidates: partial.candidates ?? [] },
    },
  };
}

describe('AlphaHunterSleeve v1 — entries', () => {
  it('enters a qualifying candidate above the conviction floor', async () => {
    const sleeve = new AlphaHunterSleeve({ getOwnership: mkOwnership });
    const ctx = mkCtx({
      candidates: [mkCandidate({ symbol: 'VIRTUAL', convictionScore: 80, sector: 'MEME' })],
    });
    const decisions = await sleeve.decide(ctx);

    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe('BUY');
    expect(decisions[0].fromToken).toBe('USDC');
    expect(decisions[0].toToken).toBe('VIRTUAL');
    expect(decisions[0].amountUSD).toBeGreaterThanOrEqual(10);
    expect(decisions[0].amountUSD).toBeLessThanOrEqual(100);
    expect(decisions[0].reasoning).toContain('ALPHA_HUNTER_V1');
  });

  it('skips candidates below the conviction floor (65)', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      candidates: [mkCandidate({ symbol: 'LOWCONV', convictionScore: 50 })],
    });
    const decisions = await sleeve.decide(ctx);
    expect(decisions).toHaveLength(0);
  });

  it('prioritizes runners over higher-score non-runners', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      candidates: [
        mkCandidate({ symbol: 'HIGH', convictionScore: 90, isRunner: false }),
        mkCandidate({ symbol: 'RUNNER', convictionScore: 75, isRunner: true }),
      ],
    });
    const decisions = await sleeve.decide(ctx);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].toToken).toBe('RUNNER');
  });

  it('does not re-enter a symbol already held', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      positions: [mkPosition('VIRTUAL', 50, 50, '2026-04-21T00:00:00.000Z')],
      candidates: [mkCandidate({ symbol: 'VIRTUAL', convictionScore: 80 })],
      prices: { VIRTUAL: 1.05 }, // small gain, not exit-triggering
    });
    const decisions = await sleeve.decide(ctx);
    // No BUY decision for VIRTUAL (already held)
    expect(decisions.filter((d) => d.action === 'BUY')).toHaveLength(0);
  });

  it('refuses to buy protected base tokens (USDC, ETH, WETH, cbBTC)', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      candidates: [
        mkCandidate({ symbol: 'cbBTC', convictionScore: 99 }),
        mkCandidate({ symbol: 'ETH', convictionScore: 95 }),
      ],
    });
    const decisions = await sleeve.decide(ctx);
    expect(decisions).toHaveLength(0);
  });

  it('caps new entries at 1 per cycle even when multiple candidates qualify', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      candidates: [
        mkCandidate({ symbol: 'A', convictionScore: 90 }),
        mkCandidate({ symbol: 'B', convictionScore: 88 }),
        mkCandidate({ symbol: 'C', convictionScore: 85 }),
      ],
    });
    const decisions = await sleeve.decide(ctx);
    const buys = decisions.filter((d) => d.action === 'BUY');
    expect(buys).toHaveLength(1);
    expect(buys[0].toToken).toBe('A'); // highest conviction, no runners
  });

  it('respects max 3 open positions', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      positions: [
        mkPosition('X', 50, 50, '2026-04-21T00:00:00.000Z'),
        mkPosition('Y', 50, 50, '2026-04-21T00:00:00.000Z'),
        mkPosition('Z', 50, 50, '2026-04-21T00:00:00.000Z'),
      ],
      candidates: [mkCandidate({ symbol: 'NEW', convictionScore: 90 })],
      prices: { X: 1.02, Y: 1.01, Z: 1.03 }, // no exits, small gains
    });
    const decisions = await sleeve.decide(ctx);
    expect(decisions.filter((d) => d.action === 'BUY')).toHaveLength(0);
  });

  it('refuses to enter when availableUSDC is below the floor', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      availableUSDC: 5, // below $10 floor
      candidates: [mkCandidate({ symbol: 'VIRTUAL', convictionScore: 90 })],
    });
    const decisions = await sleeve.decide(ctx);
    expect(decisions).toHaveLength(0);
  });
});

describe('AlphaHunterSleeve v1 — exits', () => {
  it('exits on drawdown override (-5%)', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      positions: [mkPosition('VIRTUAL', 100, 100, '2026-04-21T00:00:00.000Z')],
      prices: { VIRTUAL: 0.92 }, // -8% from $1 → worse than -5%
    });
    const decisions = await sleeve.decide(ctx);
    const sells = decisions.filter((d) => d.action === 'SELL');
    expect(sells).toHaveLength(1);
    expect(sells[0].reasoning).toContain('ALPHA_DRAWDOWN_CUT');
    expect(sells[0].percent).toBe(100);
  });

  it('exits on take-profit (+15%)', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      positions: [mkPosition('VIRTUAL', 100, 100, '2026-04-21T00:00:00.000Z')],
      prices: { VIRTUAL: 1.18 }, // +18% from $1
    });
    const decisions = await sleeve.decide(ctx);
    const sells = decisions.filter((d) => d.action === 'SELL');
    expect(sells).toHaveLength(1);
    expect(sells[0].reasoning).toContain('ALPHA_TAKE_PROFIT');
  });

  it('exits on stale (48h+ with <2% gain)', async () => {
    const sleeve = new AlphaHunterSleeve();
    const staleDate = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(); // 50h ago
    const ctx = mkCtx({
      positions: [mkPosition('VIRTUAL', 100, 100, staleDate)],
      prices: { VIRTUAL: 1.01 }, // +1% — below stale-max-gain
    });
    const decisions = await sleeve.decide(ctx);
    const sells = decisions.filter((d) => d.action === 'SELL');
    expect(sells).toHaveLength(1);
    expect(sells[0].reasoning).toContain('ALPHA_STALE');
  });

  it('holds a position that is neither drawing down, profitable enough, nor stale', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      positions: [mkPosition('VIRTUAL', 100, 100, new Date().toISOString())],
      prices: { VIRTUAL: 1.04 }, // +4%, fresh, no exit trigger
    });
    const decisions = await sleeve.decide(ctx);
    expect(decisions.filter((d) => d.action === 'SELL')).toHaveLength(0);
  });

  it('honors getExitOverride — harsher drawdown cut fires earlier', async () => {
    const sleeve = new AlphaHunterSleeve({
      getExitOverride: () => ({ drawdownOverridePct: -3 }),
    });
    const ctx = mkCtx({
      positions: [mkPosition('VIRTUAL', 100, 100, new Date().toISOString())],
      prices: { VIRTUAL: 0.96 }, // -4% — trips -3% override but not the -5% default
    });
    const decisions = await sleeve.decide(ctx);
    expect(decisions.filter((d) => d.action === 'SELL')).toHaveLength(1);
  });
});
