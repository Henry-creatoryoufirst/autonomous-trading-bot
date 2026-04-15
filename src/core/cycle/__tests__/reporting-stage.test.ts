/**
 * Unit tests for the Phase 5e reportingStage stub.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reportingStage } from '../stages/reporting.js';
import type { ReportingDeps } from '../stages/reporting.js';
import type { CycleContext } from '../../types/cycle.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
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

function makeDeps(overrides: Partial<ReportingDeps> = {}): ReportingDeps {
  return {
    flushState: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── non-throwing behaviour ───────────────────────────────────────────────────

describe('reportingStage — non-throwing', () => {
  it('completes without throwing when flushState resolves', async () => {
    const ctx = makeCtx();
    await expect(reportingStage(ctx, makeDeps())).resolves.toBeDefined();
  });

  it('does NOT throw when flushState rejects', async () => {
    const ctx = makeCtx();
    const deps = makeDeps({ flushState: vi.fn().mockRejectedValue(new Error('disk full')) });
    await expect(reportingStage(ctx, deps)).resolves.toBeDefined();
  });

  it('logs a warning when flushState rejects', async () => {
    const ctx = makeCtx();
    const deps = makeDeps({ flushState: vi.fn().mockRejectedValue(new Error('disk full')) });
    await reportingStage(ctx, deps);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[REPORTING]'),
      expect.stringContaining('disk full'),
    );
  });

  it('completes when no deps provided', async () => {
    const ctx = makeCtx();
    await expect(reportingStage(ctx)).resolves.toBeDefined();
  });
});

// ─── stagesCompleted ─────────────────────────────────────────────────────────

describe('reportingStage — stagesCompleted', () => {
  it('pushes REPORTING to stagesCompleted', async () => {
    const ctx = makeCtx();
    const result = await reportingStage(ctx, makeDeps());
    expect(result.stagesCompleted).toContain('REPORTING');
  });

  it('does NOT push REPORTING when ctx.halted', async () => {
    const ctx = makeCtx({ halted: true, haltReason: 'circuit breaker' });
    const result = await reportingStage(ctx, makeDeps());
    expect(result.stagesCompleted).not.toContain('REPORTING');
  });
});

// ─── halt fast-return ─────────────────────────────────────────────────────────

describe('reportingStage — halt handling', () => {
  it('returns immediately when ctx.halted without calling flushState', async () => {
    const ctx = makeCtx({ halted: true });
    const deps = makeDeps();
    await reportingStage(ctx, deps);
    expect(deps.flushState).not.toHaveBeenCalled();
  });

  it('returns the same ctx reference when halted', async () => {
    const ctx = makeCtx({ halted: true });
    const result = await reportingStage(ctx, makeDeps());
    expect(result).toBe(ctx);
  });
});

// ─── flushState call contract ─────────────────────────────────────────────────

describe('reportingStage — flushState', () => {
  it('calls flushState exactly once per cycle', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await reportingStage(ctx, deps);
    expect(deps.flushState).toHaveBeenCalledTimes(1);
  });

  it('does not call flushState when deps not provided', async () => {
    const ctx = makeCtx();
    // Should complete without error even with no deps
    const result = await reportingStage(ctx);
    expect(result.stagesCompleted).toContain('REPORTING');
  });
});

// ─── ReportingDeps shape ──────────────────────────────────────────────────────

describe('ReportingDeps interface', () => {
  it('is exported and has flushState as a required member', () => {
    // Compile-time check via type assertion — if this builds, the shape is correct
    const deps: ReportingDeps = { flushState: async () => {} };
    expect(typeof deps.flushState).toBe('function');
  });

  it('sendHourlyReport is optional', () => {
    const deps: ReportingDeps = { flushState: async () => {} };
    expect(deps.sendHourlyReport).toBeUndefined();
  });
});
