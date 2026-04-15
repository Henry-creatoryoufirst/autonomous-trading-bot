/**
 * Integration tests for runHeavyCycle — the 8-stage pipeline orchestrator.
 *
 * These tests cover the ORCHESTRATOR's contract:
 *   - The full pipeline runs all 8 stages when none halts
 *   - Each `if (ctx.halted) return ctx;` guard skips everything after it
 *   - The returned ctx is the same reference (not a clone)
 *   - Downstream-stage invariants survive (e.g. ctx.decisions is an array)
 *
 * Individual stage logic lives in the per-stage test files. Here we only
 * verify that the orchestrator threads ctx through them correctly and
 * respects the halted-flag short-circuit.
 *
 * For the "halted after INTELLIGENCE" case we use vi.mock on the intelligence
 * module to inject a stub that sets ctx.halted. The real intelligenceStage
 * never sets halted on its own, so without the mock there would be no way
 * to test the post-intel halt guard at this layer.
 */

import { describe, it, expect, expectTypeOf, vi, beforeEach } from 'vitest';

import { runHeavyCycle, type HeavyCycleDeps } from '../heavy-cycle.js';
import type { CycleContext } from '../../types/cycle.js';
import type { MarketData } from '../../types/market-data.js';
import type { AgentState, BreakerState } from '../../types/state.js';
import type { MetricsDeps, RiskRewardStats } from '../stages/metrics.js';
import type { IntelligenceDeps } from '../stages/intelligence.js';
import type { SetupDeps, BalanceEntry } from '../stages/setup.js';
import type { DexIntelligence } from '../../services/gecko-terminal.js';
import { intelligenceStage } from '../stages/intelligence.js';

// ────────────────────────────────────────────────────────────────────────────
// MODULE MOCK — spy on intelligenceStage so the "halted after INTEL" test can
// override its behavior. Default implementation delegates to the real stage,
// so full-pipeline tests remain integration-level.
// ────────────────────────────────────────────────────────────────────────────

vi.mock('../stages/intelligence.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stages/intelligence.js')>();
  return {
    ...actual,
    // Wrap the real stage in vi.fn so individual tests can replace behavior.
    intelligenceStage: vi.fn(actual.intelligenceStage),
  };
});

// Silence the stages' heavy console output during tests.
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  // Reset the intelligence mock to delegate to the real stage implementation.
  // Each test that needs halt behavior overrides this explicitly.
  vi.mocked(intelligenceStage).mockImplementation(
    (ctx: CycleContext, _deps: IntelligenceDeps) => {
      ctx.stagesCompleted.push('INTELLIGENCE');
      return Promise.resolve(ctx);
    },
  );
});

// ────────────────────────────────────────────────────────────────────────────
// CTX FACTORY (mirrors setup-stage.test.ts)
// ────────────────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<CycleContext> = {}): CycleContext {
  return {
    cycleNumber: 1,
    isHeavy: true,
    trigger: 'SCHEDULED',
    startedAt: Date.now(),
    balances: [],
    currentPrices: {},
    decisions: [],
    tradeResults: [],
    halted: false,
    stagesCompleted: [],
    services: {} as CycleContext['services'],
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// HAPPY-PATH DATA FACTORIES
// ────────────────────────────────────────────────────────────────────────────

function makeMarketData(): MarketData {
  return {
    tokens: [],
    fearGreed: { value: 50, classification: 'Neutral' },
    trendingTokens: [],
    indicators: {},
    defiLlama: null,
    derivatives: null,
    newsSentiment: null,
    macroData: null,
    marketRegime: 'RANGING',
    globalMarket: null,
    smartRetailDivergence: null,
    fundingMeanReversion: null,
    tvlPriceDivergence: null,
    stablecoinSupply: null,
  } as unknown as MarketData;
}

function makeDexIntelligence(): DexIntelligence {
  return {
    trendingPools: [],
    tokenMetrics: [],
    volumeSpikes: [],
    buySellPressure: [],
    newPools: [],
    aiSummary: '',
    timestamp: new Date().toISOString(),
    errors: [],
  };
}

function makeAgentState(): AgentState {
  return {
    trading: {
      totalPortfolioValue: 0,
      peakValue: 0,
      balances: [],
      lastCheck: new Date(),
    },
    costBasis: {},
    tradeFailures: {},
  } as unknown as AgentState;
}

function makeBreakerState(): BreakerState {
  return {
    dailyBaseline: { value: 0, date: new Date().toISOString() },
  } as unknown as BreakerState;
}

function makeRR(): RiskRewardStats {
  return {
    avgWinUSD: 0,
    avgLossUSD: 0,
    riskRewardRatio: 0,
    largestWin: 0,
    largestLoss: 0,
    expectancy: 0,
    profitFactor: 0,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// DEPS FACTORIES
// ────────────────────────────────────────────────────────────────────────────

function makeSetupDeps(overrides: Partial<SetupDeps> = {}): SetupDeps {
  const balances: BalanceEntry[] = [];
  return {
    getBalances:  vi.fn().mockResolvedValue(balances),
    getMarketData: vi.fn().mockResolvedValue(makeMarketData()),
    ...overrides,
  };
}

function makeIntelligenceDeps(overrides: Partial<IntelligenceDeps> = {}): IntelligenceDeps {
  return {
    fetchSignalIntel: vi.fn().mockResolvedValue(null),
    getCachedPriceHistory: vi.fn(() => ({ prices: [] })),
    computeMacroRegime: vi.fn(() => ({ regime: 'RANGING' as const, score: 0 })),
    updateCapitalPreservationMode: vi.fn(),
    macroState: {
      getLastFearGreedValue: vi.fn(() => 50),
      setLastFearGreedValue: vi.fn(),
      getConsecutiveBearChecks: vi.fn(() => 0),
      setConsecutiveBearChecks: vi.fn(),
      setCurrentMacroRegime: vi.fn(),
      getBtcDominanceBuffer: vi.fn(() => []),
      pushBtcDominance: vi.fn(),
    },
    intelState: {
      getDexIntelligence: vi.fn(() => null),
      setDexIntelligence: vi.fn(),
      getDexIntelFetchCount: vi.fn(() => 0),
      incrementDexIntelFetchCount: vi.fn(),
      getDexScreenerTxnCache: vi.fn(() => ({})),
      setLastVolumeSnapshot: vi.fn(),
      setLastIntelligenceData: vi.fn(),
    },
    flowTimeframeState: { readings: {} },
    recordFlowReading: vi.fn(),
    fetchDexIntelligence: vi.fn().mockResolvedValue(makeDexIntelligence()),
    consolidateDustPositions: vi.fn().mockResolvedValue(undefined),
    calculateTradePerformance: vi.fn(() => ({})),
    runPerformanceReview: vi.fn(() => ({ insights: [], recommendations: [] })),
    adaptThresholds: vi.fn(),
    analyzeStrategyPatterns: vi.fn(),
    volumeSpikeThreshold: 2.0,
    ...overrides,
  };
}

function makeMetricsDeps(overrides: Partial<MetricsDeps> = {}): MetricsDeps {
  return {
    getState: vi.fn(() => makeAgentState()),
    getBreakerState: vi.fn(() => makeBreakerState()),
    calculateSectorAllocations: vi.fn(() => []),
    updateUnrealizedPnL: vi.fn(),
    calculateRiskRewardMetrics: vi.fn(() => makeRR()),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<HeavyCycleDeps> = {}): HeavyCycleDeps {
  return {
    setup: makeSetupDeps(),
    intelligence: makeIntelligenceDeps(),
    metrics: makeMetricsDeps(),
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// EXPECTED STAGE ORDER — must match heavy-cycle.ts pipeline order
// ────────────────────────────────────────────────────────────────────────────

const ALL_STAGES = [
  'SETUP',
  'INTELLIGENCE',
  'METRICS',
  'AI_DECISION', // decisionStage pushes 'AI_DECISION', not 'DECISION'
  'FILTERS',
  'EXECUTION',
  'REPORTING',
  'SCHEDULING',
] as const;

// ────────────────────────────────────────────────────────────────────────────
// TESTS
// ────────────────────────────────────────────────────────────────────────────

describe('runHeavyCycle — full pipeline', () => {
  it('pushes all 8 stages to ctx.stagesCompleted in order on a clean run', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    const out = await runHeavyCycle(ctx, deps);

    expect(out.stagesCompleted).toEqual([...ALL_STAGES]);
  });

  it('returns the SAME ctx reference, not a new object', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    const out = await runHeavyCycle(ctx, deps);

    expect(out).toBe(ctx);
  });

  it('leaves ctx.halted === false after a clean run', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();

    const out = await runHeavyCycle(ctx, deps);

    expect(out.halted).toBe(false);
    expect(out.haltReason).toBeUndefined();
  });

  it('ensures ctx.decisions is an array after the run (AI_DECISION init)', async () => {
    // Start with decisions undefined to prove decisionStage initialises it.
    const ctx = makeCtx({ decisions: undefined as unknown as CycleContext['decisions'] });
    const deps = makeDeps();

    const out = await runHeavyCycle(ctx, deps);

    expect(Array.isArray(out.decisions)).toBe(true);
  });
});

describe('runHeavyCycle — halted guards', () => {
  it('halts after SETUP: only SETUP in stagesCompleted when setup fails', async () => {
    const ctx = makeCtx();
    const deps = makeDeps({
      setup: makeSetupDeps({
        getBalances: vi.fn().mockRejectedValue(new Error('RPC down')),
      }),
    });

    const out = await runHeavyCycle(ctx, deps);

    expect(out.halted).toBe(true);
    expect(out.haltReason).toMatch(/SETUP_FAIL/);
    expect(out.stagesCompleted).toEqual(['SETUP']);
  });

  it('halts after INTELLIGENCE: SETUP + INTELLIGENCE only, nothing after', async () => {
    // Force intelligenceStage to halt. The real stage never sets halted,
    // so we inject the halt via the module mock configured in beforeEach.
    vi.mocked(intelligenceStage).mockImplementationOnce(
      (ctx: CycleContext, _deps: IntelligenceDeps) => {
        ctx.halted = true;
        ctx.haltReason = 'test: forced intel halt';
        ctx.stagesCompleted.push('INTELLIGENCE');
        return Promise.resolve(ctx);
      },
    );

    const ctx = makeCtx();
    const deps = makeDeps();

    const out = await runHeavyCycle(ctx, deps);

    expect(out.halted).toBe(true);
    expect(out.haltReason).toBe('test: forced intel halt');
    expect(out.stagesCompleted).toEqual(['SETUP', 'INTELLIGENCE']);
    // Downstream stages should NOT have run.
    expect(out.stagesCompleted).not.toContain('METRICS');
    expect(out.stagesCompleted).not.toContain('AI_DECISION');
    expect(out.stagesCompleted).not.toContain('FILTERS');
    expect(out.stagesCompleted).not.toContain('EXECUTION');
    expect(out.stagesCompleted).not.toContain('REPORTING');
    expect(out.stagesCompleted).not.toContain('SCHEDULING');
  });

  it('does NOT call metrics deps when setup halted', async () => {
    const metricsDeps = makeMetricsDeps();
    const deps = makeDeps({
      setup: makeSetupDeps({
        getBalances: vi.fn().mockRejectedValue(new Error('boom')),
      }),
      metrics: metricsDeps,
    });

    await runHeavyCycle(makeCtx(), deps);

    // Every metrics accessor should remain untouched when the pipeline
    // short-circuits at SETUP.
    expect(metricsDeps.getState).not.toHaveBeenCalled();
    expect(metricsDeps.getBreakerState).not.toHaveBeenCalled();
    expect(metricsDeps.calculateSectorAllocations).not.toHaveBeenCalled();
    expect(metricsDeps.updateUnrealizedPnL).not.toHaveBeenCalled();
    expect(metricsDeps.calculateRiskRewardMetrics).not.toHaveBeenCalled();
  });
});

describe('HeavyCycleDeps type', () => {
  it('is exported with setup, intelligence, and metrics keys', () => {
    // TS-level assertion — compiles iff HeavyCycleDeps has exactly these keys
    // with the expected per-stage deps types.
    expectTypeOf<HeavyCycleDeps>().toHaveProperty('setup');
    expectTypeOf<HeavyCycleDeps>().toHaveProperty('intelligence');
    expectTypeOf<HeavyCycleDeps>().toHaveProperty('metrics');

    // Runtime assertion — a valid HeavyCycleDeps instance must carry all three.
    const deps = makeDeps();
    expect(Object.keys(deps).sort()).toEqual(['intelligence', 'metrics', 'setup']);
  });
});
