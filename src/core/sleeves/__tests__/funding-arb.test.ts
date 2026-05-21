import { describe, it, expect, afterEach } from 'vitest';
import { FundingArbSleeve, fundingArbSleeve } from '../funding-arb.js';
import { buildDefaultRegistry } from '../registry.js';
import type { SleeveContext, SleevePosition } from '../types.js';
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
    createdAt: '2026-05-21T00:00:00.000Z',
  };
}

function mkPosition(symbol: string, costBasisUSD: number, openedAt: string): SleevePosition {
  return {
    symbol,
    balance: 1,
    costBasisUSD,
    valueUSD: costBasisUSD,
    openedAt,
    openedInCycle: 1,
  };
}

function mkCtx(partial: {
  positions?: SleevePosition[];
  availableUSDC?: number;
  capitalBudgetUSD?: number;
  prices?: Record<string, number>;
  cycleNumber?: number;
  regime?: string;
}): SleeveContext {
  return {
    capitalBudgetUSD: partial.capitalBudgetUSD ?? 1000,
    positions: partial.positions ?? [],
    availableUSDC: partial.availableUSDC ?? 1000,
    market: {
      cycleNumber: partial.cycleNumber ?? 1,
      builtAt: new Date().toISOString(),
      prices: partial.prices ?? { cbBTC: 60_000 },
      regime: partial.regime ?? 'RANGING',
      fearGreed: 50,
    },
  };
}

describe('FundingArbSleeve — Phase 1a scaffolding', () => {
  it('exposes id, displayName, default paper mode, and 0% min capital', () => {
    const sleeve = new FundingArbSleeve();
    expect(sleeve.id).toBe('funding-arb');
    expect(sleeve.displayName).toContain('Funding Arb');
    expect(sleeve.mode).toBe('paper');
    expect(sleeve.minCapitalPct).toBe(0);
    expect(sleeve.maxCapitalPct).toBeGreaterThan(0);
    expect(sleeve.maxCapitalPct).toBeLessThanOrEqual(0.20);
  });

  it('exports a ready-to-use default fundingArbSleeve instance', () => {
    expect(fundingArbSleeve.id).toBe('funding-arb');
    expect(fundingArbSleeve.mode).toBe('paper');
  });

  it('getStats() returns zero stats when no ownership provider configured', () => {
    const sleeve = new FundingArbSleeve();
    const stats = sleeve.getStats();
    expect(stats.realizedPnLUSD).toBe(0);
    expect(stats.unrealizedPnLUSD).toBe(0);
    expect(stats.trades).toBe(0);
    expect(stats.rollingSharpe7d).toBeNull();
  });

  it('getStats() reads from the supplied ownership provider', () => {
    const own = mkOwnership();
    own.realizedPnLUSD = 12.5;
    own.trades = 2;
    own.wins = 1;
    const sleeve = new FundingArbSleeve({
      getOwnership: () => own,
      getPortfolioValue: () => 1000,
    });
    const stats = sleeve.getStats();
    expect(stats.realizedPnLUSD).toBe(12.5);
    expect(stats.trades).toBe(2);
    expect(stats.winRate).toBeCloseTo(50, 5);
  });
});

describe('FundingArbSleeve — decide() shape', () => {
  it('returns a decision array on every call (never empty)', async () => {
    const sleeve = new FundingArbSleeve({ getFundingRateStub: () => 0 });
    const ctx = mkCtx({});
    const decisions = await sleeve.decide(ctx);
    expect(Array.isArray(decisions)).toBe(true);
    expect(decisions.length).toBeGreaterThanOrEqual(1);
  });

  it('decision objects carry the required TradeDecision fields', async () => {
    const sleeve = new FundingArbSleeve({ getFundingRateStub: () => 10 });
    const decisions = await sleeve.decide(mkCtx({}));
    const buy = decisions.find((d) => d.action === 'BUY');
    expect(buy).toBeDefined();
    expect(buy!.fromToken).toBe('USDC');
    expect(buy!.toToken).toBe('cbBTC');
    expect(buy!.amountUSD).toBeGreaterThan(0);
    expect(buy!.reasoning).toContain('ALPHA_FUNDING_ARB_V1');
  });

  it('tags reasoning with the regime so audits can filter by regime', async () => {
    const sleeve = new FundingArbSleeve({ getFundingRateStub: () => 10 });
    const decisions = await sleeve.decide(mkCtx({ regime: 'TRENDING_UP' }));
    const buy = decisions.find((d) => d.action === 'BUY');
    expect(buy?.reasoning).toContain('TRENDING_UP');
  });
});

describe('FundingArbSleeve — entry gating', () => {
  it('HOLDs when funding rate is below the entry threshold', async () => {
    const sleeve = new FundingArbSleeve({ getFundingRateStub: () => 1 });
    const decisions = await sleeve.decide(mkCtx({}));
    expect(decisions.filter((d) => d.action === 'BUY')).toHaveLength(0);
    const hold = decisions.find((d) => d.action === 'HOLD');
    expect(hold?.reasoning).toContain('entry floor');
  });

  it('ENTERS when funding rate clears the entry threshold and paper budget is sufficient', async () => {
    const sleeve = new FundingArbSleeve({ getFundingRateStub: () => 5 });
    const decisions = await sleeve.decide(mkCtx({ availableUSDC: 1000 }));
    const buys = decisions.filter((d) => d.action === 'BUY');
    expect(buys).toHaveLength(1);
    expect(buys[0].toToken).toBe('cbBTC');
    expect(buys[0].amountUSD).toBe(300);
  });

  it('respects the paper budget — refuses to enter when virtual USDC is short', async () => {
    const sleeve = new FundingArbSleeve({ getFundingRateStub: () => 5 });
    const decisions = await sleeve.decide(mkCtx({ availableUSDC: 100 }));
    expect(decisions.filter((d) => d.action === 'BUY')).toHaveLength(0);
    const hold = decisions.find((d) => d.action === 'HOLD');
    expect(hold?.reasoning).toContain('availableUSDC');
    expect(hold?.reasoning).toContain('notional');
  });

  it('refuses to enter when the base-asset price is missing', async () => {
    const sleeve = new FundingArbSleeve({ getFundingRateStub: () => 5 });
    const decisions = await sleeve.decide(mkCtx({ prices: {} }));
    expect(decisions.filter((d) => d.action === 'BUY')).toHaveLength(0);
    const hold = decisions.find((d) => d.action === 'HOLD');
    expect(hold?.reasoning).toContain('no price');
  });
});

describe('FundingArbSleeve — exit gating', () => {
  it('EXITS the open position when funding drops below the exit threshold', async () => {
    const sleeve = new FundingArbSleeve({ getFundingRateStub: () => 0.5 });
    const ctx = mkCtx({
      positions: [mkPosition('cbBTC', 300, new Date().toISOString())],
    });
    const decisions = await sleeve.decide(ctx);
    const sells = decisions.filter((d) => d.action === 'SELL');
    expect(sells).toHaveLength(1);
    expect(sells[0].fromToken).toBe('cbBTC');
    expect(sells[0].percent).toBe(100);
    expect(sells[0].reasoning).toContain('funding decay');
  });

  it('HOLDs the open position when funding is in the dead zone (between exit and entry)', async () => {
    const sleeve = new FundingArbSleeve({ getFundingRateStub: () => 2.5 });
    const ctx = mkCtx({
      positions: [mkPosition('cbBTC', 300, new Date().toISOString())],
    });
    const decisions = await sleeve.decide(ctx);
    expect(decisions.filter((d) => d.action === 'BUY')).toHaveLength(0);
    expect(decisions.filter((d) => d.action === 'SELL')).toHaveLength(0);
    const hold = decisions.find((d) => d.action === 'HOLD');
    expect(hold?.reasoning).toContain('HOLD');
    expect(hold?.reasoning).toContain('accruing');
  });

  it('EXITS the open position once max-hold elapses regardless of funding rate', async () => {
    const sleeve = new FundingArbSleeve({ getFundingRateStub: () => 10 });
    const ancient = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const ctx = mkCtx({
      positions: [mkPosition('cbBTC', 300, ancient)],
    });
    const decisions = await sleeve.decide(ctx);
    const sells = decisions.filter((d) => d.action === 'SELL');
    expect(sells).toHaveLength(1);
    expect(sells[0].reasoning).toContain('max-hold');
  });

  it('does NOT enter a new position while one is already open', async () => {
    // Even with funding well above entry threshold, sleeve should HOLD or SELL,
    // not stack a second entry — Phase 1a is single-position.
    const sleeve = new FundingArbSleeve({ getFundingRateStub: () => 10 });
    const ctx = mkCtx({
      positions: [mkPosition('cbBTC', 300, new Date().toISOString())],
    });
    const decisions = await sleeve.decide(ctx);
    expect(decisions.filter((d) => d.action === 'BUY')).toHaveLength(0);
  });
});

describe('FundingArbSleeve — multi-cycle funding-rate sweep', () => {
  it('produces a coherent entry → hold → exit sequence over a falling funding curve', async () => {
    // Drive entry on cycle 1, hold on cycle 2 (still above exit floor),
    // exit on cycle 3 (below exit floor). Mimics the spec's full lifecycle
    // without depending on the sine-wave default.
    const sleeve = new FundingArbSleeve({
      getFundingRateStub: (cycle) => {
        if (cycle === 1) return 5;     // above entry (3.4) → BUY
        if (cycle === 2) return 2.5;   // between exit (1.7) and entry → HOLD
        return 0.5;                    // below exit → SELL
      },
    });

    // Cycle 1: enter.
    const c1 = await sleeve.decide(mkCtx({ cycleNumber: 1 }));
    expect(c1.filter((d) => d.action === 'BUY')).toHaveLength(1);

    // Cycle 2: holding now — simulate by passing the position back in.
    const c2 = await sleeve.decide(mkCtx({
      cycleNumber: 2,
      positions: [mkPosition('cbBTC', 300, new Date().toISOString())],
    }));
    expect(c2.filter((d) => d.action === 'BUY')).toHaveLength(0);
    expect(c2.filter((d) => d.action === 'SELL')).toHaveLength(0);
    const hold2 = c2.find((d) => d.action === 'HOLD');
    expect(hold2?.reasoning).toContain('HOLD');

    // Cycle 3: exit.
    const c3 = await sleeve.decide(mkCtx({
      cycleNumber: 3,
      positions: [mkPosition('cbBTC', 300, new Date().toISOString())],
    }));
    const sells = c3.filter((d) => d.action === 'SELL');
    expect(sells).toHaveLength(1);
    expect(sells[0].fromToken).toBe('cbBTC');
  });

  it('default sine-wave stub crosses the entry threshold at least once over a full period', async () => {
    // Sanity check that the default stub actually produces actionable
    // signal — if the sine-wave parameters drift the sleeve goes dead.
    const sleeve = new FundingArbSleeve();
    let sawEntry = false;
    for (let c = 0; c < 72 && !sawEntry; c++) {
      const decisions = await sleeve.decide(mkCtx({ cycleNumber: c, availableUSDC: 1000 }));
      if (decisions.some((d) => d.action === 'BUY')) sawEntry = true;
    }
    expect(sawEntry).toBe(true);
  });
});

describe('FundingArbSleeve — registry opt-in (NVR-SPEC-034 kill switch)', () => {
  afterEach(() => {
    delete process.env.FUNDING_ARB_PAPER_ENABLED;
  });

  it('is NOT installed in the default registry by default', () => {
    delete process.env.FUNDING_ARB_PAPER_ENABLED;
    const registry = buildDefaultRegistry();
    expect(registry.get('funding-arb')).toBeUndefined();
    // Existing sleeves still present — no regression on the default roster.
    expect(registry.get('core')).toBeDefined();
    expect(registry.get('alpha-hunter')).toBeDefined();
    expect(registry.get('alpha-rotation')).toBeDefined();
  });

  it('is NOT installed when env flag is any value other than the exact string "true"', () => {
    process.env.FUNDING_ARB_PAPER_ENABLED = '1';
    const registry = buildDefaultRegistry();
    expect(registry.get('funding-arb')).toBeUndefined();
  });

  it('IS installed and pinned to paper mode when FUNDING_ARB_PAPER_ENABLED=true', () => {
    process.env.FUNDING_ARB_PAPER_ENABLED = 'true';
    const registry = buildDefaultRegistry();
    const sleeve = registry.get('funding-arb');
    expect(sleeve).toBeDefined();
    // Hard-pinned to paper regardless of any other flag — this PR does not
    // wire a live-promotion path. See NVR-SPEC-034 §8 Phase 2 review gate.
    expect(sleeve!.mode).toBe('paper');
  });
});
