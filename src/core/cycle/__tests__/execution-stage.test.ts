/**
 * Unit tests for the Phase 5e executionStage stub.
 *
 * The stub must be non-throwing and must respect the halt fast-return.
 * Real execution logic is gated behind Phase 5c (48h soak).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executionStage } from '../stages/execution.js';
import type { CycleContext } from '../../types/cycle.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function makeCtx(overrides: Partial<CycleContext> = {}): CycleContext {
  return {
    cycleNumber:     1,
    isHeavy:         true,
    trigger:         'SCHEDULED',
    startedAt:       Date.now(),
    balances:        [],
    currentPrices:   {},
    decisions:       [],
    tradeResults:    [],
    halted:          false,
    stagesCompleted: [],
    services: {
      stateManager: { getState: () => ({} as any), getBreakerState: () => ({} as any), markDirty: () => {} },
      telegram:     { sendAlert: async () => false, onCircuitBreakerTriggered: async () => {}, onTradeResult: async () => {} },
      cache:        { invalidate: () => {}, getStats: () => ({ hits: 0, misses: 0, hitRate: 0 }) },
      cooldown:     { getActiveCount: () => 0, setRawCooldown: () => {} },
    },
    ...overrides,
  } as CycleContext;
}

// ─── non-throwing ─────────────────────────────────────────────────────────────

describe('executionStage — non-throwing', () => {
  it('resolves without throwing', async () => {
    const ctx = makeCtx();
    await expect(executionStage(ctx)).resolves.toBeDefined();
  });

  it('returns a CycleContext', async () => {
    const ctx = makeCtx();
    const result = await executionStage(ctx);
    expect(result).toHaveProperty('stagesCompleted');
    expect(result).toHaveProperty('decisions');
    expect(result).toHaveProperty('tradeResults');
  });
});

// ─── stagesCompleted ─────────────────────────────────────────────────────────

describe('executionStage — stagesCompleted', () => {
  it('pushes EXECUTION to stagesCompleted', async () => {
    const ctx = makeCtx();
    const result = await executionStage(ctx);
    expect(result.stagesCompleted).toContain('EXECUTION');
  });

  it('does NOT push EXECUTION when ctx.halted', async () => {
    const ctx = makeCtx({ halted: true, haltReason: 'drawdown exceeded' });
    const result = await executionStage(ctx);
    expect(result.stagesCompleted).not.toContain('EXECUTION');
  });
});

// ─── halt fast-return ─────────────────────────────────────────────────────────

describe('executionStage — halt handling', () => {
  it('returns the same ctx reference when halted', async () => {
    const ctx = makeCtx({ halted: true });
    const result = await executionStage(ctx);
    expect(result).toBe(ctx);
  });

  it('does not log the stub marker when halted', async () => {
    const ctx = makeCtx({ halted: true });
    await executionStage(ctx);
    expect(console.log).not.toHaveBeenCalled();
  });
});

// ─── trade safety ─────────────────────────────────────────────────────────────

describe('executionStage — trade safety', () => {
  it('does not mutate ctx.decisions', async () => {
    const decisions = [{ action: 'BUY' as const, fromToken: 'USDC', toToken: 'ETH', amountUSD: 100, reasoning: 'test' }];
    const ctx = makeCtx({ decisions: [...decisions] });
    await executionStage(ctx);
    expect(ctx.decisions).toHaveLength(1);
    expect(ctx.decisions[0].action).toBe('BUY');
  });

  it('does not append to ctx.tradeResults (stub executes no trades)', async () => {
    const ctx = makeCtx();
    const result = await executionStage(ctx);
    expect(result.tradeResults).toHaveLength(0);
  });

  it('does not set ctx.halted', async () => {
    const ctx = makeCtx();
    const result = await executionStage(ctx);
    expect(result.halted).toBe(false);
  });
});

// ─── real deps ────────────────────────────────────────────────────────────────

describe('executionStage — real deps', () => {
  it('calls deps.run with ctx', async () => {
    const ctx = makeCtx();
    const run = vi.fn().mockResolvedValue(ctx);
    await executionStage(ctx, { run });
    expect(run).toHaveBeenCalledWith(ctx);
  });

  it('skips deps.run when halted', async () => {
    const ctx = makeCtx({ halted: true });
    const run = vi.fn().mockResolvedValue(ctx);
    await executionStage(ctx, { run });
    expect(run).not.toHaveBeenCalled();
  });

  it('sets halted + haltReason when deps.run throws', async () => {
    const ctx = makeCtx();
    const result = await executionStage(ctx, {
      run: vi.fn().mockRejectedValue(new Error('swap failed')),
    });
    expect(result.halted).toBe(true);
    expect(result.haltReason).toBe('swap failed');
  });

  it('always pushes EXECUTION even when deps.run throws', async () => {
    const ctx = makeCtx();
    const result = await executionStage(ctx, {
      run: vi.fn().mockRejectedValue(new Error('swap failed')),
    });
    expect(result.stagesCompleted).toContain('EXECUTION');
  });
});
