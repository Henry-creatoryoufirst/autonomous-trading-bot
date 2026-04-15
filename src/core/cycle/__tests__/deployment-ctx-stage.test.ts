/**
 * Unit tests for Phase 5e: DEPLOYMENT_CTX stage extraction.
 *
 * Contract under test:
 *   1. ctx.sectorAllocations is set after stage runs
 *   2. ctx.deploymentCheck is set after stage runs
 *   3. 'DEPLOYMENT_CTX' pushed to ctx.stagesCompleted
 *   4. calculateSectorAllocations called with correct balances + totalPortfolioValue
 *   5. checkCashDeploymentMode called with correct usdcBalance and fearGreedValue
 *   6. halted ctx returns immediately — no fields set, nothing pushed
 *   7. if calculateSectorAllocations throws, stage still completes and pushes DEPLOYMENT_CTX
 *   8. if checkCashDeploymentMode throws, stage still completes and pushes DEPLOYMENT_CTX
 *   9. fearGreedValue defaults to 50 when ctx.marketData is absent
 *  10. usdcBalance = usdValue of the USDC balance entry (not raw balance)
 *
 * All runtime behavior is dep-injected — these tests never import the monolith.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deploymentCtxStage } from '../stages/deployment-ctx.js';
import type { DeploymentCtxDeps } from '../stages/deployment-ctx.js';
import type { CycleContext } from '../../types/cycle.js';
import type { SectorAllocation } from '../../types/index.js';
import type { CashDeploymentResult } from '../../types/state.js';

// ─── Silence stage console output ────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ─── Factory helpers ──────────────────────────────────────────────────────────

function makeSectorAllocations(): SectorAllocation[] {
  return [
    { name: 'blueChip',   targetPercent: 40, currentPercent: 38, currentUSD: 380, drift: -2,  tokens: [] },
    { name: 'ai',         targetPercent: 20, currentPercent: 22, currentUSD: 220, drift:  2,  tokens: [] },
    { name: 'meme',       targetPercent: 20, currentPercent: 10, currentUSD: 100, drift: -10, tokens: [] },
    { name: 'defi',       targetPercent: 20, currentPercent: 30, currentUSD: 300, drift:  10, tokens: [] },
  ];
}

function makeCashDeploymentResult(overrides: Partial<CashDeploymentResult> = {}): CashDeploymentResult {
  return {
    active:             false,
    cashPercent:        15,
    excessCash:         0,
    deployBudget:       0,
    confluenceDiscount: 0,
    tier:               'NONE',
    maxEntries:         0,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<DeploymentCtxDeps> = {}): DeploymentCtxDeps {
  return {
    calculateSectorAllocations: vi.fn().mockReturnValue(makeSectorAllocations()),
    checkCashDeploymentMode:    vi.fn().mockReturnValue(makeCashDeploymentResult()),
    ...overrides,
  };
}

function makeCtx(overrides: Partial<CycleContext> = {}): CycleContext {
  return {
    cycleNumber:     1,
    isHeavy:         true,
    trigger:         'SCHEDULED',
    startedAt:       Date.now(),
    balances:        [
      { symbol: 'USDC', balance: 150, usdValue: 150 },
      { symbol: 'ETH',  balance: 0.1, usdValue: 300, price: 3000, sector: 'blueChip' },
    ] as CycleContext['balances'],
    currentPrices:   { ETH: 3000, USDC: 1 },
    decisions:       [],
    tradeResults:    [],
    halted:          false,
    stagesCompleted: [],
    services: {
      stateManager: {
        getState: vi.fn().mockReturnValue({
          trading: { totalPortfolioValue: 450 },
        }),
        getBreakerState: vi.fn(),
        markDirty:       vi.fn(),
      },
      telegram:  null as any,
      cache:     null as any,
      cooldown:  null as any,
    },
    marketData: {
      fearGreed: { value: 55, classification: 'Greed' },
    } as any,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('deploymentCtxStage', () => {
  it('sets ctx.sectorAllocations after stage runs', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps();
    const out  = await deploymentCtxStage(ctx, deps);
    expect(out.sectorAllocations).toBeDefined();
    expect(out.sectorAllocations).toHaveLength(4);
  });

  it('sets ctx.deploymentCheck after stage runs', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps();
    const out  = await deploymentCtxStage(ctx, deps);
    expect(out.deploymentCheck).toBeDefined();
    expect(out.deploymentCheck).toHaveProperty('active');
  });

  it('pushes DEPLOYMENT_CTX to stagesCompleted', async () => {
    const out = await deploymentCtxStage(makeCtx(), makeDeps());
    expect(out.stagesCompleted).toContain('DEPLOYMENT_CTX');
  });

  it('calls calculateSectorAllocations with ctx.balances and totalPortfolioValue', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps();
    await deploymentCtxStage(ctx, deps);

    expect(deps.calculateSectorAllocations).toHaveBeenCalledOnce();
    expect(deps.calculateSectorAllocations).toHaveBeenCalledWith(
      ctx.balances,
      450, // from stateManager.getState().trading.totalPortfolioValue
    );
  });

  it('calls checkCashDeploymentMode with correct usdcBalance and fearGreedValue', async () => {
    const ctx  = makeCtx(); // USDC usdValue = 150, fearGreed = 55
    const deps = makeDeps();
    await deploymentCtxStage(ctx, deps);

    expect(deps.checkCashDeploymentMode).toHaveBeenCalledOnce();
    expect(deps.checkCashDeploymentMode).toHaveBeenCalledWith(
      150,   // usdcBalance = USDC entry's usdValue
      450,   // totalPortfolioValue
      55,    // fearGreed.value from ctx.marketData
    );
  });

  it('uses usdValue (not raw balance) for usdcBalance', async () => {
    // USDC balance = 150 tokens, usdValue = 149.5 (slight depeg)
    const ctx = makeCtx({
      balances: [
        { symbol: 'USDC', balance: 150, usdValue: 149.5 },
      ] as CycleContext['balances'],
    });
    const deps = makeDeps();
    await deploymentCtxStage(ctx, deps);

    const call = vi.mocked(deps.checkCashDeploymentMode).mock.calls[0];
    expect(call[0]).toBe(149.5);
  });

  it('defaults fearGreedValue to 50 when ctx.marketData is absent', async () => {
    const ctx  = makeCtx({ marketData: undefined });
    const deps = makeDeps();
    await deploymentCtxStage(ctx, deps);

    const call = vi.mocked(deps.checkCashDeploymentMode).mock.calls[0];
    expect(call[2]).toBe(50);
  });

  it('defaults usdcBalance to 0 when no USDC in balances', async () => {
    const ctx = makeCtx({
      balances: [
        { symbol: 'ETH', balance: 0.1, usdValue: 300, price: 3000, sector: 'blueChip' },
      ] as CycleContext['balances'],
    });
    const deps = makeDeps();
    await deploymentCtxStage(ctx, deps);

    const call = vi.mocked(deps.checkCashDeploymentMode).mock.calls[0];
    expect(call[0]).toBe(0);
  });

  it('halted ctx returns immediately — no fields set, nothing pushed', async () => {
    const ctx  = makeCtx({ halted: true, stagesCompleted: [] });
    const deps = makeDeps();
    const out  = await deploymentCtxStage(ctx, deps);

    expect(out.stagesCompleted).toHaveLength(0);
    expect(out.sectorAllocations).toBeUndefined();
    expect(out.deploymentCheck).toBeUndefined();
    expect(deps.calculateSectorAllocations).not.toHaveBeenCalled();
    expect(deps.checkCashDeploymentMode).not.toHaveBeenCalled();
  });

  it('stage completes and pushes DEPLOYMENT_CTX when calculateSectorAllocations throws', async () => {
    const deps = makeDeps({
      calculateSectorAllocations: vi.fn().mockImplementation(() => {
        throw new Error('sector calc boom');
      }),
    });
    const out = await deploymentCtxStage(makeCtx(), deps);

    expect(out.stagesCompleted).toContain('DEPLOYMENT_CTX');
    expect(out.sectorAllocations).toBeUndefined(); // not set — threw before assignment
    expect(out.deploymentCheck).toBeDefined();     // second call still ran
    expect(out.halted).toBe(false);
  });

  it('stage completes and pushes DEPLOYMENT_CTX when checkCashDeploymentMode throws', async () => {
    const deps = makeDeps({
      checkCashDeploymentMode: vi.fn().mockImplementation(() => {
        throw new Error('deployment check boom');
      }),
    });
    const out = await deploymentCtxStage(makeCtx(), deps);

    expect(out.stagesCompleted).toContain('DEPLOYMENT_CTX');
    expect(out.sectorAllocations).toBeDefined(); // first call succeeded
    expect(out.deploymentCheck).toBeUndefined(); // not set — threw before assignment
    expect(out.halted).toBe(false);
  });

  it('never sets ctx.halted regardless of failures', async () => {
    const deps = makeDeps({
      calculateSectorAllocations: vi.fn().mockImplementation(() => { throw new Error('x'); }),
      checkCashDeploymentMode:    vi.fn().mockImplementation(() => { throw new Error('y'); }),
    });
    const out = await deploymentCtxStage(makeCtx(), deps);
    expect(out.halted).toBe(false);
  });

  it('returns the same ctx reference', async () => {
    const ctx = makeCtx();
    const out = await deploymentCtxStage(ctx, makeDeps());
    expect(out).toBe(ctx);
  });

  it('deployment mode active when cashPercent is high', async () => {
    const deps = makeDeps({
      checkCashDeploymentMode: vi.fn().mockReturnValue(
        makeCashDeploymentResult({ active: true, cashPercent: 65, deployBudget: 200, tier: 'HEAVY' }),
      ),
    });
    const out = await deploymentCtxStage(makeCtx(), deps);
    expect(out.deploymentCheck?.active).toBe(true);
    expect(out.deploymentCheck?.tier).toBe('HEAVY');
    expect(out.deploymentCheck?.deployBudget).toBe(200);
  });
});
