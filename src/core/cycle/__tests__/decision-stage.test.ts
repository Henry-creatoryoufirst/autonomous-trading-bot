/**
 * Unit tests for Phase 5h: DECISION stage — real AI routing + stub fallback.
 *
 * Two paths tested:
 *   1. No-deps stub: decisionStage(ctx) — returns [] decisions, marks AI_DECISION
 *   2. Real routing: decisionStage(ctx, deps) — routes to makeTradeDecision (local)
 *      or fetchCentralSignals (central), sets ctx.decisions, marks AI_DECISION
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decisionStage } from '../stages/decision.js';
import type { DecisionDeps } from '../stages/decision.js';
import type { CycleContext } from '../../types/cycle.js';

// Silence console output from the stage
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<CycleContext> = {}): CycleContext {
  return {
    cycleNumber: 1,
    isHeavy: true,
    trigger: 'SCHEDULED',
    startedAt: Date.now(),
    balances: [{ symbol: 'USDC', balance: 500, usdValue: 500 }],
    currentPrices: {},
    decisions: [],
    tradeResults: [],
    halted: false,
    stagesCompleted: [],
    services: {
      stateManager: {
        getState: vi.fn(() => ({
          trading: { totalPortfolioValue: 1000, balances: [], peakValue: 1000, lastCheck: new Date() },
        })),
      },
    } as unknown as CycleContext['services'],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<DecisionDeps> = {}): DecisionDeps {
  return {
    signalMode:              'local',
    fetchCentralSignals:     vi.fn().mockResolvedValue([]),
    makeTradeDecision:       vi.fn().mockResolvedValue([]),
    getLatestSwarmDecisions: vi.fn().mockReturnValue([]),
    maxBuySize:              100,
    ...overrides,
  };
}

// ─── No-deps stub fallback ────────────────────────────────────────────────────

describe('decisionStage — no-deps stub fallback', () => {
  it('returns ctx without throwing when no deps provided', async () => {
    const ctx = makeCtx();
    await expect(decisionStage(ctx)).resolves.not.toThrow();
  });

  it('returns the same ctx reference', async () => {
    const ctx = makeCtx();
    const result = await decisionStage(ctx);
    expect(result).toBe(ctx);
  });

  it('does NOT set halted', async () => {
    const ctx = makeCtx();
    const result = await decisionStage(ctx);
    expect(result.halted).toBe(false);
  });
});

// ─── Real routing (with deps) ─────────────────────────────────────────────────

describe('decisionStage — real routing (Phase 5h)', () => {
  it('calls makeTradeDecision when signalMode is local', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps({ signalMode: 'local' });
    await decisionStage(ctx, deps);
    expect(deps.makeTradeDecision).toHaveBeenCalledOnce();
    expect(deps.fetchCentralSignals).not.toHaveBeenCalled();
  });

  it('calls fetchCentralSignals when signalMode is central', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps({ signalMode: 'central' });
    await decisionStage(ctx, deps);
    expect(deps.fetchCentralSignals).toHaveBeenCalledOnce();
    expect(deps.makeTradeDecision).not.toHaveBeenCalled();
  });

  it('sets ctx.decisions to the results returned by makeTradeDecision', async () => {
    const fakeDecisions = [
      { action: 'BUY' as const, fromToken: 'USDC', toToken: 'ETH', amountUSD: 50, reasoning: 'test' },
    ];
    const ctx  = makeCtx();
    const deps = makeDeps({ makeTradeDecision: vi.fn().mockResolvedValue(fakeDecisions) });
    await decisionStage(ctx, deps);
    expect(ctx.decisions).toBe(fakeDecisions);
  });

  it('does not throw when deps are fully provided', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps();
    await expect(decisionStage(ctx, deps)).resolves.not.toThrow();
  });
});

// ─── stagesCompleted ─────────────────────────────────────────────────────────

describe('decisionStage — stagesCompleted', () => {
  it("pushes 'AI_DECISION' to stagesCompleted", async () => {
    const ctx = makeCtx();
    const result = await decisionStage(ctx);
    expect(result.stagesCompleted).toContain('AI_DECISION');
  });

  it("appends 'AI_DECISION' after existing stages", async () => {
    const ctx = makeCtx({ stagesCompleted: ['SETUP', 'INTELLIGENCE'] });
    const result = await decisionStage(ctx);
    expect(result.stagesCompleted).toEqual(['SETUP', 'INTELLIGENCE', 'AI_DECISION']);
  });
});

// ─── ctx.decisions ────────────────────────────────────────────────────────────

describe('decisionStage — ctx.decisions', () => {
  it('leaves decisions as an empty array when it was already []', async () => {
    const ctx = makeCtx({ decisions: [] });
    const result = await decisionStage(ctx);
    expect(Array.isArray(result.decisions)).toBe(true);
    expect(result.decisions).toHaveLength(0);
  });

  it('does not overwrite decisions that were pre-populated', async () => {
    const existing = [{ action: 'HOLD' as const, fromToken: 'USDC', toToken: 'ETH', amountUSD: 0, reasoning: 'test' }];
    const ctx = makeCtx({ decisions: existing });
    const result = await decisionStage(ctx);
    // Stub must not clear decisions set by an earlier stage
    expect(result.decisions).toBe(existing);
  });

  it('initialises decisions to [] if somehow undefined', async () => {
    const ctx = makeCtx({ decisions: undefined as any });
    const result = await decisionStage(ctx);
    expect(Array.isArray(result.decisions)).toBe(true);
  });
});

// ─── Halted guard ─────────────────────────────────────────────────────────────

describe('decisionStage — halted guard', () => {
  it('returns immediately when ctx.halted is true', async () => {
    const ctx = makeCtx({ halted: true, haltReason: 'circuit breaker', stagesCompleted: [] });
    const result = await decisionStage(ctx);
    // Should NOT push AI_DECISION when halted
    expect(result.stagesCompleted).not.toContain('AI_DECISION');
  });
});

// ─── DecisionDeps interface shape ─────────────────────────────────────────────

describe('DecisionDeps interface', () => {
  it('is exported and satisfiable with the expected shape', () => {
    const deps: DecisionDeps = {
      signalMode:              'central',
      fetchCentralSignals:     async (_ctx) => [],
      makeTradeDecision:       async (_b, _m, _p, _s, _d, _r) => [],
      getLatestSwarmDecisions: () => [],
      maxBuySize:              100,
    };
    expect(deps.signalMode).toBe('central');
    expect(typeof deps.fetchCentralSignals).toBe('function');
    expect(typeof deps.makeTradeDecision).toBe('function');
    expect(typeof deps.getLatestSwarmDecisions).toBe('function');
    expect(deps.maxBuySize).toBe(100);
  });

  it('signalMode accepts all three routing modes', () => {
    const modes: DecisionDeps['signalMode'][] = ['local', 'central', 'producer'];
    for (const mode of modes) {
      const deps = makeDeps({ signalMode: mode });
      expect(deps.signalMode).toBe(mode);
    }
  });
});
