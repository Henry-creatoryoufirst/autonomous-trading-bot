/**
 * Unit tests for Phase 5d: METRICS stage extraction.
 *
 * Contract under test (per task spec):
 *   1. updateUnrealizedPnL called with ctx.balances
 *   2. 'METRICS' in ctx.stagesCompleted
 *   3. ctx.balances unchanged after stage
 *   4. stage does NOT halt when deps.updateUnrealizedPnL throws
 *   5. stage does NOT halt when deps.calculateRiskRewardMetrics throws
 *
 * Everything is dep-injected so these tests never import the monolith.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { metricsStage } from '../stages/metrics.js';
import type { MetricsDeps, RiskRewardStats } from '../stages/metrics.js';
import type { CycleContext } from '../../types/cycle.js';
import type { AgentState, BreakerState } from '../../types/state.js';
import type { SectorAllocation } from '../../types/index.js';

// ─── Silence the stage's heavy console output during tests ────────────────────
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ─── Minimal factory helpers ─────────────────────────────────────────────────

function makeBalances(): CycleContext['balances'] {
  return [
    { symbol: 'USDC', balance: 500, usdValue: 500 },
    { symbol: 'AERO', balance: 100, usdValue: 120, price: 1.2, sector: 'defi' },
    { symbol: 'cbBTC', balance: 0.01, usdValue: 650, price: 65000, sector: 'blueChip' },
  ] as unknown as CycleContext['balances'];
}

function makeState(): AgentState {
  // Only the fields metricsStage reads. Cast through unknown so we don't
  // have to populate the entire AgentState tree.
  return {
    trading: {
      totalPortfolioValue: 1270,
      peakValue: 1300,
      balances: [],
      lastCheck: new Date(),
    },
    costBasis: {
      AERO: {
        symbol: 'AERO',
        currentHolding: 100,
        averageCostBasis: 1.0,
        totalInvestedUSD: 100,
        totalTokensAcquired: 100,
        realizedPnL: 5,
        unrealizedPnL: 20,
        peakPrice: 1.25,
        peakPriceDate: new Date().toISOString(),
        firstBuyDate: new Date().toISOString(),
        lastTradeDate: new Date().toISOString(),
        atrStopPercent: null,
        atrTrailPercent: null,
        atrAtEntry: null,
      },
    },
    tradeFailures: {},
  } as unknown as AgentState;
}

function makeBreakerState(): BreakerState {
  return {
    dailyBaseline: { value: 1200, date: new Date().toISOString() },
  } as unknown as BreakerState;
}

function makeSectorAllocations(): SectorAllocation[] {
  return [
    {
      name: 'blueChip',
      targetPercent: 40,
      currentPercent: 51,
      currentUSD: 650,
      drift: 11,
      tokens: [{ symbol: 'cbBTC', usdValue: 650, percent: 100 }],
    },
    {
      name: 'defi',
      targetPercent: 20,
      currentPercent: 10,
      currentUSD: 120,
      drift: -10,
      tokens: [{ symbol: 'AERO', usdValue: 120, percent: 100 }],
    },
  ];
}

function makeRR(): RiskRewardStats {
  return {
    avgWinUSD: 12,
    avgLossUSD: 5,
    riskRewardRatio: 2.4,
    largestWin: 40,
    largestLoss: 15,
    expectancy: 4.5,
    profitFactor: 2.1,
  };
}

function makeCtx(overrides: Partial<CycleContext> = {}): CycleContext {
  return {
    cycleNumber: 1,
    isHeavy: true,
    trigger: 'SCHEDULED',
    startedAt: Date.now(),
    balances: makeBalances(),
    currentPrices: { AERO: 1.2, cbBTC: 65000 },
    decisions: [],
    tradeResults: [],
    halted: false,
    stagesCompleted: [],
    services: {} as CycleContext['services'],
    marketData: {
      tokens: [],
      marketRegime: 'RANGING',
      trendingTokens: ['AERO', 'WELL'],
      indicators: {
        AERO: {
          rsi14: 55,
          macd: { signal: 'BULLISH' },
          bollingerBands: { signal: 'NEUTRAL' },
          trendDirection: 'UP',
          confluenceScore: 35,
          overallSignal: 'BUY',
        } as unknown as never,
      } as unknown as never,
    } as unknown as CycleContext['marketData'],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<MetricsDeps> = {}): MetricsDeps {
  return {
    getState: vi.fn(() => makeState()),
    getBreakerState: vi.fn(() => makeBreakerState()),
    calculateSectorAllocations: vi.fn(() => makeSectorAllocations()),
    updateUnrealizedPnL: vi.fn(),
    calculateRiskRewardMetrics: vi.fn(() => makeRR()),
    ...overrides,
  };
}

// ─── Contract tests ───────────────────────────────────────────────────────────

describe('metricsStage (Phase 5d)', () => {
  it('calls deps.updateUnrealizedPnL with ctx.balances', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    await metricsStage(ctx, deps);

    expect(deps.updateUnrealizedPnL).toHaveBeenCalledTimes(1);
    expect(deps.updateUnrealizedPnL).toHaveBeenCalledWith(ctx.balances);
  });

  it("pushes 'METRICS' onto ctx.stagesCompleted exactly once", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    const out = await metricsStage(ctx, deps);

    const hits = out.stagesCompleted.filter((s) => s === 'METRICS').length;
    expect(hits).toBe(1);
    expect(out.stagesCompleted).toContain('METRICS');
  });

  it('leaves ctx.balances unchanged (same reference, same contents)', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    const balancesBefore = ctx.balances;
    const snapshot = JSON.parse(JSON.stringify(ctx.balances));

    const out = await metricsStage(ctx, deps);

    // Same reference — stage didn't reassign
    expect(out.balances).toBe(balancesBefore);
    // Same contents — stage didn't mutate in place
    expect(JSON.parse(JSON.stringify(out.balances))).toEqual(snapshot);
  });

  it('does NOT halt when deps.updateUnrealizedPnL throws', async () => {
    const ctx = makeCtx();
    const deps = makeDeps({
      updateUnrealizedPnL: vi.fn(() => {
        throw new Error('cost-basis write exploded');
      }),
    });

    const out = await metricsStage(ctx, deps);

    expect(out.halted).toBe(false);
    expect(out.haltReason).toBeUndefined();
    expect(out.stagesCompleted).toContain('METRICS');
  });

  it('does NOT halt when deps.calculateRiskRewardMetrics throws', async () => {
    const ctx = makeCtx();
    const deps = makeDeps({
      calculateRiskRewardMetrics: vi.fn(() => {
        throw new Error('r/r calc blew up');
      }),
    });

    const out = await metricsStage(ctx, deps);

    expect(out.halted).toBe(false);
    expect(out.haltReason).toBeUndefined();
    expect(out.stagesCompleted).toContain('METRICS');
  });

  // ─── Additional safety checks on top of the spec requirements ─────────────

  it('does NOT halt when deps.getState throws (fatal path)', async () => {
    const ctx = makeCtx();
    const deps = makeDeps({
      getState: vi.fn(() => {
        throw new Error('state unavailable');
      }),
    });

    const out = await metricsStage(ctx, deps);

    // Even with the earliest failure, stage must push METRICS and not halt.
    expect(out.halted).toBe(false);
    expect(out.stagesCompleted).toContain('METRICS');
  });

  it('does NOT halt when deps.calculateSectorAllocations throws', async () => {
    const ctx = makeCtx();
    const deps = makeDeps({
      calculateSectorAllocations: vi.fn(() => {
        throw new Error('sector calc blew up');
      }),
    });

    const out = await metricsStage(ctx, deps);

    expect(out.halted).toBe(false);
    expect(out.stagesCompleted).toContain('METRICS');
  });

  it('does not write to ctx.decisions, ctx.tradeResults, or ctx.halted', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    const out = await metricsStage(ctx, deps);

    expect(out.decisions).toEqual([]);
    expect(out.tradeResults).toEqual([]);
    expect(out.halted).toBe(false);
  });
});
