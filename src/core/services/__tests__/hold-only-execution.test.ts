/**
 * HOLD-ONLY execution-gate integration test.
 *
 * cbLTC self-healing 2026-05-22 found 3 consecutive failed TWAP slices with
 * root cause "Compound-backed LTC may have thinner liquidity than base pairs."
 * Instead of compounding failed-trade churn, the bot now skips execution on
 * any token listed in HOLD_ONLY_TOKENS (default `['cbLTC']`). The position
 * stays HELD (cost basis, balance, INV-5 cohort coverage untouched) — only
 * BUY/SELL/REBALANCE flow is blocked.
 *
 * This test exercises the REAL code path. `checkHoldOnlyGate` is the same
 * function imported and called inside `agent-v3.2.ts`'s `executeTrade()` —
 * see import at the top of agent-v3.2.ts and the wire-in directly after
 * the SystemAuditor gate. It also asserts the wire-in by reading the
 * production source — if the gate is removed from executeTrade, the
 * "wiring contract" test fails.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkHoldOnlyGate,
  getHoldOnlyBlockedCount,
  resetHoldOnlyBlockedCount,
  recordHoldOnlyBlock,
} from '../testable/hold-only-gate.js';
import {
  getHoldOnlyTokens,
  HOLD_ONLY_TOKENS_DEFAULT,
} from '../../config/token-registry.js';

// ─── Setup / teardown ────────────────────────────────────────────────────────

const ORIGINAL_ENV = process.env.HOLD_ONLY_TOKENS;

beforeEach(() => {
  resetHoldOnlyBlockedCount();
  delete process.env.HOLD_ONLY_TOKENS;
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.HOLD_ONLY_TOKENS;
  } else {
    process.env.HOLD_ONLY_TOKENS = ORIGINAL_ENV;
  }
});

// ─── Default list semantics ──────────────────────────────────────────────────

describe('HOLD_ONLY_TOKENS_DEFAULT', () => {
  it('includes cbLTC by default (Base L2 thin-liquidity finding 2026-05-22)', () => {
    expect(HOLD_ONLY_TOKENS_DEFAULT).toContain('cbLTC');
  });

  it('getHoldOnlyTokens() returns the default when env unset', () => {
    const list = getHoldOnlyTokens();
    expect(list).toEqual(['cbLTC']);
  });

  it('getHoldOnlyTokens() returns env list when HOLD_ONLY_TOKENS set', () => {
    process.env.HOLD_ONLY_TOKENS = 'cbLTC,FOO,BAR';
    expect(getHoldOnlyTokens()).toEqual(['cbLTC', 'FOO', 'BAR']);
  });

  it('getHoldOnlyTokens() trims whitespace and filters empties', () => {
    process.env.HOLD_ONLY_TOKENS = ' cbLTC , , FOO ';
    expect(getHoldOnlyTokens()).toEqual(['cbLTC', 'FOO']);
  });

  it('getHoldOnlyTokens() returns default when env is blank/whitespace', () => {
    process.env.HOLD_ONLY_TOKENS = '   ';
    expect(getHoldOnlyTokens()).toEqual(['cbLTC']);
  });

  it('getHoldOnlyTokens() returns empty list when env is just commas', () => {
    process.env.HOLD_ONLY_TOKENS = ',,,';
    expect(getHoldOnlyTokens()).toEqual([]);
  });
});

// ─── Gate behavior — the production gate-call ────────────────────────────────

describe('checkHoldOnlyGate — BUY decisions', () => {
  it('BLOCKS a BUY into cbLTC (default list, env unset)', () => {
    const result = checkHoldOnlyGate({
      action: 'BUY',
      fromToken: 'USDC',
      toToken: 'cbLTC',
    });
    expect(result.blocked).toBe(true);
    expect(result.symbol).toBe('cbLTC');
    expect(result.action).toBe('BUY');
    expect(result.reason).toMatch(/\[HoldOnly\] skipping BUY on cbLTC/);
    expect(result.reason).toMatch(/Base L2 liquidity too thin/);
  });

  it('ALLOWS a BUY into WETH (not in the hold-only list)', () => {
    const result = checkHoldOnlyGate({
      action: 'BUY',
      fromToken: 'USDC',
      toToken: 'WETH',
    });
    expect(result.blocked).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('ALLOWS a BUY into cbBTC (other quality-cohort tokens trade normally)', () => {
    const result = checkHoldOnlyGate({
      action: 'BUY',
      fromToken: 'USDC',
      toToken: 'cbBTC',
    });
    expect(result.blocked).toBe(false);
  });
});

describe('checkHoldOnlyGate — SELL decisions', () => {
  it('BLOCKS a SELL of cbLTC (no active disposal either — pure HOLD)', () => {
    const result = checkHoldOnlyGate({
      action: 'SELL',
      fromToken: 'cbLTC',
      toToken: 'USDC',
    });
    expect(result.blocked).toBe(true);
    expect(result.symbol).toBe('cbLTC');
    expect(result.action).toBe('SELL');
    expect(result.reason).toMatch(/\[HoldOnly\] skipping SELL on cbLTC/);
  });

  it('ALLOWS a SELL of WETH', () => {
    const result = checkHoldOnlyGate({
      action: 'SELL',
      fromToken: 'WETH',
      toToken: 'USDC',
    });
    expect(result.blocked).toBe(false);
  });
});

describe('checkHoldOnlyGate — REBALANCE decisions', () => {
  it('BLOCKS a REBALANCE INTO cbLTC', () => {
    const result = checkHoldOnlyGate({
      action: 'REBALANCE',
      fromToken: 'WETH',
      toToken: 'cbLTC',
    });
    expect(result.blocked).toBe(true);
    expect(result.symbol).toBe('cbLTC');
  });

  it('BLOCKS a REBALANCE OUT OF cbLTC', () => {
    const result = checkHoldOnlyGate({
      action: 'REBALANCE',
      fromToken: 'cbLTC',
      toToken: 'WETH',
    });
    expect(result.blocked).toBe(true);
    expect(result.symbol).toBe('cbLTC');
  });

  it('ALLOWS a REBALANCE between non-hold-only tokens', () => {
    const result = checkHoldOnlyGate({
      action: 'REBALANCE',
      fromToken: 'WETH',
      toToken: 'cbBTC',
    });
    expect(result.blocked).toBe(false);
  });
});

describe('checkHoldOnlyGate — HOLD is never blocked', () => {
  it('ALLOWS a HOLD on cbLTC (the whole point — keep holding)', () => {
    const result = checkHoldOnlyGate({
      action: 'HOLD',
      fromToken: 'cbLTC',
      toToken: 'cbLTC',
    });
    expect(result.blocked).toBe(false);
  });
});

// ─── Env override ────────────────────────────────────────────────────────────

describe('checkHoldOnlyGate — env override', () => {
  it('ALLOWS a BUY into cbLTC when env override removes cbLTC', () => {
    process.env.HOLD_ONLY_TOKENS = 'OTHER_THIN_TOKEN';
    const result = checkHoldOnlyGate({
      action: 'BUY',
      fromToken: 'USDC',
      toToken: 'cbLTC',
    });
    expect(result.blocked).toBe(false);
  });

  it('BLOCKS a BUY into a newly-added env token (e.g., expanding the list)', () => {
    process.env.HOLD_ONLY_TOKENS = 'cbLTC,EXPERIMENTAL';
    const result = checkHoldOnlyGate({
      action: 'BUY',
      fromToken: 'USDC',
      toToken: 'EXPERIMENTAL',
    });
    expect(result.blocked).toBe(true);
    expect(result.symbol).toBe('EXPERIMENTAL');
  });

  it('Empty env override (HOLD_ONLY_TOKENS=,,,) disables the gate', () => {
    process.env.HOLD_ONLY_TOKENS = ',,,';
    const result = checkHoldOnlyGate({
      action: 'BUY',
      fromToken: 'USDC',
      toToken: 'cbLTC',
    });
    expect(result.blocked).toBe(false);
  });
});

// ─── Explicit-list bypass (test injection) ───────────────────────────────────

describe('checkHoldOnlyGate — explicit list bypass', () => {
  it('uses the explicit list when provided (does not consult env)', () => {
    process.env.HOLD_ONLY_TOKENS = 'cbLTC';
    const result = checkHoldOnlyGate(
      { action: 'BUY', fromToken: 'USDC', toToken: 'cbLTC' },
      ['FOO'], // explicit override — cbLTC not present
    );
    expect(result.blocked).toBe(false);
  });
});

// ─── Block counter ───────────────────────────────────────────────────────────

describe('HOLD-ONLY block counter', () => {
  it('starts at 0 after reset', () => {
    expect(getHoldOnlyBlockedCount()).toBe(0);
  });

  it('increments on recordHoldOnlyBlock()', () => {
    recordHoldOnlyBlock();
    recordHoldOnlyBlock();
    recordHoldOnlyBlock();
    expect(getHoldOnlyBlockedCount()).toBe(3);
  });

  it('resets to 0 on reset', () => {
    recordHoldOnlyBlock();
    resetHoldOnlyBlockedCount();
    expect(getHoldOnlyBlockedCount()).toBe(0);
  });
});

// ─── Integration: simulate executeTrade ordering ─────────────────────────────
//
// Replicates the wired-in flow inside agent-v3.2.ts's executeTrade(): when
// the gate fires, the bot logs the skip line, increments the counter, and
// returns { success: false, error: <reason> } WITHOUT touching the swap
// router, dedup state, balances, or cost basis. Below we run the same
// shape through the actual gate function and confirm the return contract.

describe('HOLD-ONLY integration — executeTrade-shape early return', () => {
  function simulateExecuteTradeGate(decision: {
    action: 'BUY' | 'SELL' | 'HOLD' | 'REBALANCE';
    fromToken: string;
    toToken: string;
  }): { success: boolean; error?: string; reachedSwap: boolean } {
    // Mirrors the wire-in at agent-v3.2.ts (immediately after the auditor
    // gate, before any gas / dedup / swap-router logic).
    const gate = checkHoldOnlyGate({
      action: decision.action,
      fromToken: decision.fromToken,
      toToken: decision.toToken,
    });
    if (gate.blocked) {
      recordHoldOnlyBlock();
      return { success: false, error: gate.reason, reachedSwap: false };
    }
    // Would proceed to gas check, dedup, swap, etc.
    return { success: true, reachedSwap: true };
  }

  it('cbLTC BUY: returns success=false, reachedSwap=false, error tagged', () => {
    const before = getHoldOnlyBlockedCount();
    const result = simulateExecuteTradeGate({
      action: 'BUY',
      fromToken: 'USDC',
      toToken: 'cbLTC',
    });
    expect(result.success).toBe(false);
    expect(result.reachedSwap).toBe(false);
    expect(result.error).toMatch(/\[HoldOnly\]/);
    expect(getHoldOnlyBlockedCount()).toBe(before + 1);
  });

  it('WETH BUY: success=true, reachedSwap=true, counter unchanged', () => {
    const before = getHoldOnlyBlockedCount();
    const result = simulateExecuteTradeGate({
      action: 'BUY',
      fromToken: 'USDC',
      toToken: 'WETH',
    });
    expect(result.success).toBe(true);
    expect(result.reachedSwap).toBe(true);
    expect(getHoldOnlyBlockedCount()).toBe(before);
  });

  it('BOTH cbLTC + WETH: only cbLTC blocked, counter increments by 1', () => {
    resetHoldOnlyBlockedCount();
    const cbLTCResult = simulateExecuteTradeGate({
      action: 'BUY',
      fromToken: 'USDC',
      toToken: 'cbLTC',
    });
    const wethResult = simulateExecuteTradeGate({
      action: 'BUY',
      fromToken: 'USDC',
      toToken: 'WETH',
    });
    expect(cbLTCResult.success).toBe(false);
    expect(cbLTCResult.reachedSwap).toBe(false);
    expect(wethResult.success).toBe(true);
    expect(wethResult.reachedSwap).toBe(true);
    expect(getHoldOnlyBlockedCount()).toBe(1);
  });
});

// ─── Wiring contract: assert the gate is actually wired into executeTrade ────
//
// This test exists to fail if anyone removes the gate from agent-v3.2.ts
// without also updating the test. It anchors the "ship-it-wired" contract:
// the gate must demonstrably live on the production code path.

describe('HOLD-ONLY wiring contract', () => {
  const AGENT_PATH = join(
    new URL('../../../../', import.meta.url).pathname,
    'agent-v3.2.ts',
  );

  let agentSourceRaw: string;
  try {
    agentSourceRaw = readFileSync(AGENT_PATH, 'utf8');
  } catch {
    agentSourceRaw = '';
  }

  // Strip line-comments and block-comments so a "test-passes-while-the-gate-
  // is-commented-out" regression is caught. Tracks the canonical wire-in
  // discipline from feedback_ship_it_wired: code under a `//` doesn't ship.
  function stripComments(src: string): string {
    // Remove block comments first (non-greedy).
    let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
    // Remove single-line `//` comments (anything after `//` on a line, naive
    // but sufficient for this regression check — TS source here doesn't have
    // `//` inside string literals on the gate-relevant lines).
    out = out.replace(/\/\/[^\n]*/g, '');
    return out;
  }

  const agentSource = stripComments(agentSourceRaw);

  it('agent-v3.2.ts imports checkHoldOnlyGate from the testable module', () => {
    expect(agentSource).toMatch(
      /import\s*\{\s*[^}]*checkHoldOnlyGate[^}]*\}\s*from\s*['"][^'"]*hold-only-gate(\.js)?['"]/,
    );
  });

  it('agent-v3.2.ts imports recordHoldOnlyBlock from the testable module', () => {
    expect(agentSource).toMatch(/recordHoldOnlyBlock/);
  });

  it('executeTrade calls checkHoldOnlyGate (live, not commented-out)', () => {
    const start = agentSource.indexOf('async function executeTrade(');
    expect(start).toBeGreaterThan(0);
    const slice = agentSource.slice(start, start + 8000);
    expect(slice).toMatch(/checkHoldOnlyGate\s*\(/);
  });

  it('executeTrade returns early on hold-only block (does NOT fall through to swap)', () => {
    const start = agentSource.indexOf('async function executeTrade(');
    const slice = agentSource.slice(start, start + 8000);
    const gateIdx = slice.indexOf('checkHoldOnlyGate');
    const gasIdx = slice.indexOf('ensureGasForTrade');
    expect(gateIdx).toBeGreaterThan(0);
    expect(gasIdx).toBeGreaterThan(gateIdx);
    const blockBranch = slice.slice(gateIdx, gasIdx);
    expect(blockBranch).toMatch(/holdOnlyGate\.blocked/);
    expect(blockBranch).toMatch(/return\s*\{\s*success:\s*false/);
    expect(blockBranch).toMatch(/recordHoldOnlyBlock\s*\(\s*\)/);
  });
});
