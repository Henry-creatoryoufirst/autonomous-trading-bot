/**
 * Unit tests for the SETUP stage extraction (Phase 5b).
 *
 * Verifies that setupStage() produces identical observable behavior to
 * the original inline code in agent-v3.2.ts lines 6073–6082.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupStage, type SetupDeps, type BalanceEntry } from '../stages/setup.js';
import type { CycleContext } from '../../types/cycle.js';
import type { MarketData } from '../../types/market-data.js';

// Silence console during tests
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ─── Helpers ────────────────────────────────────────────────────────────────

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
    services: {} as any,
    ...overrides,
  };
}

function makeBalances(): BalanceEntry[] {
  return [
    { symbol: 'ETH',  balance: 0.5,  usdValue: 1500, price: 3000 },
    { symbol: 'USDC', balance: 1000, usdValue: 1000 },
  ];
}

function makeMarketData(): MarketData {
  return {
    tokens: [
      { symbol: 'ETH',  price: 3000, change24h: 1.5,  volume24h: 1e9,  marketCap: 3e11 },
      { symbol: 'BTC',  price: 65000, change24h: 0.5, volume24h: 2e9,  marketCap: 1e12 },
      { symbol: 'USDC', price: 1,    change24h: 0,    volume24h: 5e8,  marketCap: 4e10 },
    ],
    fearGreed: { value: 55, classification: 'Greed' },
    timestamp: Date.now(),
  } as unknown as MarketData;
}

function makeDeps(overrides: Partial<SetupDeps> = {}): SetupDeps {
  return {
    getBalances:  vi.fn().mockResolvedValue(makeBalances()),
    getMarketData: vi.fn().mockResolvedValue(makeMarketData()),
    ...overrides,
  };
}

// ─── Success path ─────────────────────────────────────────────────────────

describe('success path', () => {
  it('returns ctx with balances populated', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps();
    const out  = await setupStage(ctx, deps);
    expect(out.balances).toHaveLength(2);
    expect((out.balances as BalanceEntry[])[0].symbol).toBe('ETH');
  });

  it('returns ctx with marketData populated', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps();
    const out  = await setupStage(ctx, deps);
    expect(out.marketData).toBeDefined();
    expect(out.marketData!.tokens).toHaveLength(3);
  });

  it('builds currentPrices from marketData.tokens', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps();
    const out  = await setupStage(ctx, deps);
    expect(out.currentPrices['ETH']).toBe(3000);
    expect(out.currentPrices['BTC']).toBe(65000);
    expect(out.currentPrices['USDC']).toBe(1);
  });

  it('pushes SETUP to stagesCompleted', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps();
    const out  = await setupStage(ctx, deps);
    expect(out.stagesCompleted).toContain('SETUP');
  });

  it('does NOT set halted', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps();
    const out  = await setupStage(ctx, deps);
    expect(out.halted).toBe(false);
  });

  it('calls getBalances exactly once', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps();
    await setupStage(ctx, deps);
    expect(deps.getBalances).toHaveBeenCalledTimes(1);
  });

  it('calls getMarketData exactly once', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps();
    await setupStage(ctx, deps);
    expect(deps.getMarketData).toHaveBeenCalledTimes(1);
  });
});

// ─── getBalances failure ──────────────────────────────────────────────────

describe('getBalances failure', () => {
  it('sets halted = true', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps({ getBalances: vi.fn().mockRejectedValue(new Error('RPC down')) });
    const out  = await setupStage(ctx, deps);
    expect(out.halted).toBe(true);
  });

  it('sets haltReason containing SETUP_FAIL:getBalances', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps({ getBalances: vi.fn().mockRejectedValue(new Error('timeout')) });
    const out  = await setupStage(ctx, deps);
    expect(out.haltReason).toMatch(/SETUP_FAIL:getBalances/);
    expect(out.haltReason).toMatch(/timeout/);
  });

  it('pushes SETUP to stagesCompleted even on failure', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps({ getBalances: vi.fn().mockRejectedValue(new Error('x')) });
    const out  = await setupStage(ctx, deps);
    expect(out.stagesCompleted).toContain('SETUP');
  });

  it('does NOT call getMarketData when getBalances fails', async () => {
    const ctx  = makeCtx();
    const getMarketData = vi.fn().mockResolvedValue(makeMarketData());
    const deps = makeDeps({ getBalances: vi.fn().mockRejectedValue(new Error('x')), getMarketData });
    await setupStage(ctx, deps);
    expect(getMarketData).not.toHaveBeenCalled();
  });

  it('works with non-Error thrown values', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps({ getBalances: vi.fn().mockRejectedValue('plain string error') });
    const out  = await setupStage(ctx, deps);
    expect(out.halted).toBe(true);
    expect(out.haltReason).toMatch(/plain string error/);
  });
});

// ─── getMarketData failure ────────────────────────────────────────────────

describe('getMarketData failure', () => {
  it('sets halted = true', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps({ getMarketData: vi.fn().mockRejectedValue(new Error('CoinGecko 429')) });
    const out  = await setupStage(ctx, deps);
    expect(out.halted).toBe(true);
  });

  it('sets haltReason containing SETUP_FAIL:getMarketData', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps({ getMarketData: vi.fn().mockRejectedValue(new Error('CoinGecko 429')) });
    const out  = await setupStage(ctx, deps);
    expect(out.haltReason).toMatch(/SETUP_FAIL:getMarketData/);
    expect(out.haltReason).toMatch(/CoinGecko 429/);
  });

  it('pushes SETUP to stagesCompleted even on getMarketData failure', async () => {
    const ctx  = makeCtx();
    const deps = makeDeps({ getMarketData: vi.fn().mockRejectedValue(new Error('x')) });
    const out  = await setupStage(ctx, deps);
    expect(out.stagesCompleted).toContain('SETUP');
  });
});
