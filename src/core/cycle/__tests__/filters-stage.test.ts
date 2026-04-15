/**
 * Unit tests for Phase 5f filter pure helpers.
 *
 * Tests the three extracted pure functions:
 *   - computeDecisionPriority
 *   - checkRiskReward
 *   - applySectorCapGuard
 *
 * These are the highest test-value pieces in the cycle — sorting bugs
 * drop wrong trades, R:R bugs let us enter at bad prices, sector cap bugs
 * allow position concentration beyond limits.
 */

import { describe, it, expect } from 'vitest';
import {
  computeDecisionPriority,
  checkRiskReward,
  applySectorCapGuard,
} from '../stages/filters.js';
import type { TradeDecision } from '../../types/market-data.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeDecision(overrides: Partial<TradeDecision> = {}): TradeDecision {
  return {
    action:    'BUY',
    fromToken: 'USDC',
    toToken:   'ETH',
    amountUSD: 100,
    reasoning: 'AI: good setup',
    ...overrides,
  };
}

function makePriceHistory(prices: number[]) {
  return { prices };
}

// ─── computeDecisionPriority ──────────────────────────────────────────────────

describe('computeDecisionPriority', () => {
  it('HARD_STOP gets the lowest priority number (highest urgency)', () => {
    const d = makeDecision({ reasoning: 'HARD_STOP: -52% loss' });
    expect(computeDecisionPriority(d)).toBe(-1);
  });

  it('TRAILING_STOP is just above HARD_STOP', () => {
    const d = makeDecision({ reasoning: 'TRAILING_STOP: deceleration exit' });
    expect(computeDecisionPriority(d)).toBe(-0.8);
  });

  it('STOP_LOSS is 0', () => {
    const d = makeDecision({ reasoning: 'STOP_LOSS: -15%' });
    expect(computeDecisionPriority(d)).toBe(0);
  });

  it('DIRECTIVE_SELL_ESCALATED has priority 0.3', () => {
    const d = makeDecision({ reasoning: 'DIRECTIVE_SELL_ESCALATED: 30h old' });
    expect(computeDecisionPriority(d)).toBe(0.3);
  });

  it('DIRECTIVE_SELL has priority 0.5', () => {
    const d = makeDecision({ reasoning: 'DIRECTIVE_SELL: user said sell' });
    expect(computeDecisionPriority(d)).toBe(0.5);
  });

  it('FLOW_REVERSAL has priority 0.7', () => {
    const d = makeDecision({ reasoning: 'FLOW_REVERSAL: buy ratio 35%' });
    expect(computeDecisionPriority(d)).toBe(0.7);
  });

  it('MOMENTUM_EXIT has priority 1', () => {
    const d = makeDecision({ reasoning: 'MOMENTUM_EXIT: trend gone' });
    expect(computeDecisionPriority(d)).toBe(1);
  });

  it('PROFIT_TAKE has priority 2', () => {
    const d = makeDecision({ reasoning: 'PROFIT_TAKE: +35%' });
    expect(computeDecisionPriority(d)).toBe(2);
  });

  it('untagged AI decision defaults to 3', () => {
    const d = makeDecision({ reasoning: 'AI: good setup' });
    expect(computeDecisionPriority(d)).toBe(3);
  });

  it('explicit AI: tag returns 3', () => {
    const d = makeDecision({ reasoning: 'AI: ETH looks strong' });
    expect(computeDecisionPriority(d)).toBe(3);
  });

  it('SCALE_UP has priority 4', () => {
    const d = makeDecision({ reasoning: 'SCALE_UP: momentum confirmed' });
    expect(computeDecisionPriority(d)).toBe(4);
  });

  it('FORCED_DEPLOY and DEPLOYMENT_FALLBACK both have priority 5', () => {
    expect(computeDecisionPriority(makeDecision({ reasoning: 'FORCED_DEPLOY: cash 80%' }))).toBe(5);
    expect(computeDecisionPriority(makeDecision({ reasoning: 'DEPLOYMENT_FALLBACK: cash heavy' }))).toBe(5);
  });

  it('RIDE_THE_WAVE has priority 6', () => {
    const d = makeDecision({ reasoning: 'RIDE_THE_WAVE: momentum signal' });
    expect(computeDecisionPriority(d)).toBe(6);
  });

  it('SCOUT has the highest number (lowest urgency)', () => {
    const d = makeDecision({ reasoning: 'SCOUT: $8 data probe' });
    expect(computeDecisionPriority(d)).toBe(7);
  });

  it('unknown tier falls back to AI (3)', () => {
    const d = makeDecision({ reasoning: 'MYSTERY_TIER: unknown' });
    expect(computeDecisionPriority(d)).toBe(3);
  });

  it('empty reasoning falls back to AI (3)', () => {
    const d = makeDecision({ reasoning: '' });
    expect(computeDecisionPriority(d)).toBe(3);
  });

  it('stops are always sorted before AI decisions', () => {
    const stop = makeDecision({ reasoning: 'STOP_LOSS: -15%' });
    const ai   = makeDecision({ reasoning: 'AI: buy ETH' });
    expect(computeDecisionPriority(stop)).toBeLessThan(computeDecisionPriority(ai));
  });

  it('hard stop sorts before stop loss', () => {
    const hard = makeDecision({ reasoning: 'HARD_STOP: -55%' });
    const soft = makeDecision({ reasoning: 'STOP_LOSS: -15%' });
    expect(computeDecisionPriority(hard)).toBeLessThan(computeDecisionPriority(soft));
  });
});

// ─── checkRiskReward ──────────────────────────────────────────────────────────

describe('checkRiskReward', () => {
  it('non-BUY decisions always pass', () => {
    const sell = makeDecision({ action: 'SELL', fromToken: 'ETH', toToken: 'USDC' });
    const hold = makeDecision({ action: 'HOLD' });
    expect(checkRiskReward(sell, makePriceHistory([]), 3000, 5).pass).toBe(true);
    expect(checkRiskReward(hold, makePriceHistory([]), 3000, 5).pass).toBe(true);
  });

  it('passes with default ratio when no price history', () => {
    const d = makeDecision();
    const result = checkRiskReward(d, makePriceHistory([]), 3000, 5);
    expect(result.pass).toBe(true);
    expect(result.ratio).toBe(3);
  });

  it('passes with default ratio when fewer than 10 price samples', () => {
    const d = makeDecision();
    const result = checkRiskReward(d, makePriceHistory([2900, 3000, 3100]), 3000, 5);
    expect(result.pass).toBe(true);
  });

  it('blocks when token is within 5% of 30d high', () => {
    // Current price 3000, 30d high 3100 → dist = (3100-3000)/3000*100 = 3.33%
    const prices = Array(50).fill(2800).concat([3100]);
    const d = makeDecision({ toToken: 'ETH' });
    const result = checkRiskReward(d, makePriceHistory(prices), 3000, 5);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/limited upside/);
    expect(result.distFromHighPct).toBeCloseTo(3.33, 1);
  });

  it('blocks when R:R ratio is below 2:1', () => {
    // Current price 3000, 30d high 3150 → dist = (3150-3000)/3000*100 = 5%
    // risk = 5%, reward = 5% → ratio = 1.0 < 2.0
    const prices = Array(50).fill(2800).concat([3150]);
    const d = makeDecision({ toToken: 'ETH' });
    const result = checkRiskReward(d, makePriceHistory(prices), 3000, 5);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/below 2:1 minimum/);
    expect(result.ratio).toBeCloseTo(1.0, 1);
  });

  it('passes when R:R ratio is 2:1 or better', () => {
    // Current price 2000, 30d high 3000 → dist = 50%, risk = 5% → ratio = 10.0
    const prices = Array(50).fill(1800).concat([3000]);
    const d = makeDecision({ toToken: 'ETH' });
    const result = checkRiskReward(d, makePriceHistory(prices), 2000, 5);
    expect(result.pass).toBe(true);
    expect(result.ratio).toBeGreaterThanOrEqual(2);
  });

  it('passes exactly at 2:1 ratio threshold', () => {
    // dist from high = 10%, risk = 5% → ratio = 2.0 exactly
    const prices = Array(50).fill(1800).concat([3300]);
    // currentPrice = 3000, high = 3300 → dist = (3300-3000)/3000*100 = 10%
    const d = makeDecision({ toToken: 'ETH' });
    const result = checkRiskReward(d, makePriceHistory(prices), 3000, 5);
    expect(result.pass).toBe(true);
    expect(result.ratio).toBeCloseTo(2.0, 1);
  });

  it('uses only the last 720 price samples for 30d high', () => {
    // The 30d high is in the last 720 samples (3500)
    // Older sample is higher (9999) but should be ignored
    const old = Array(200).fill(9999);          // older — beyond the 720-sample window
    const recent = Array(720).fill(2000).concat([3500]);  // recent window
    const prices = [...old, ...recent];
    const d = makeDecision({ toToken: 'ETH' });
    // currentPrice = 3000, effective high = 3500 → dist = (3500-3000)/3000*100 = 16.7%
    // ratio = 16.7 / 5 = 3.33 → pass
    const result = checkRiskReward(d, makePriceHistory(prices), 3000, 5);
    expect(result.pass).toBe(true);
    // High should be 3500, not 9999
    expect(result.distFromHighPct).toBeCloseTo(16.7, 0);
  });

  it('returns distFromHighPct on block for near-high reason', () => {
    const prices = Array(50).fill(2800).concat([3100]);
    const result = checkRiskReward(makeDecision(), makePriceHistory(prices), 3000, 5);
    expect(result.distFromHighPct).toBeDefined();
  });
});

// ─── applySectorCapGuard ──────────────────────────────────────────────────────

describe('applySectorCapGuard', () => {
  it('non-BUY decisions pass through unchanged', () => {
    const sell = makeDecision({ action: 'SELL', fromToken: 'ETH', toToken: 'USDC', amountUSD: 200 });
    const result = applySectorCapGuard(sell, 0, 1000, 20);
    expect(result.trimmedAmountUSD).toBe(200);
    expect(result.trimmed).toBe(false);
    expect(result.blocked).toBe(false);
  });

  it('BUY for USDC passes through unchanged', () => {
    const d = makeDecision({ action: 'BUY', toToken: 'USDC', amountUSD: 100 });
    const result = applySectorCapGuard(d, 0, 1000, 20);
    expect(result.trimmedAmountUSD).toBe(100);
    expect(result.blocked).toBe(false);
  });

  it('BUY within sector cap passes through unchanged', () => {
    // $100 buy, 0 existing, portfolio $1000, cap 20% → after = 10% → fine
    const result = applySectorCapGuard(makeDecision(), 0, 1000, 20);
    expect(result.trimmedAmountUSD).toBe(100);
    expect(result.trimmed).toBe(false);
    expect(result.blocked).toBe(false);
  });

  it('BUY that would breach cap gets trimmed', () => {
    // existing $150, buy $100, portfolio $1000, cap 20% (=$200)
    // afterBuy = $250 = 25% > 20% → trim to $200 - $150 = $50
    const result = applySectorCapGuard(makeDecision({ amountUSD: 100 }), 150, 1000, 20);
    expect(result.trimmedAmountUSD).toBe(50);
    expect(result.trimmed).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.reason).toMatch(/trimmed/);
  });

  it('BUY at sector limit with no room gets blocked', () => {
    // existing $200, buy $50, portfolio $1000, cap 20% (=$200)
    // maxBuy = $200 - $200 = $0 → blocked
    const result = applySectorCapGuard(makeDecision({ amountUSD: 50 }), 200, 1000, 20);
    expect(result.trimmedAmountUSD).toBe(0);
    expect(result.blocked).toBe(true);
    expect(result.trimmed).toBe(false);
  });

  it('BUY with only tiny room (< $5) gets blocked', () => {
    // existing $198, buy $50, portfolio $1000, cap 20% → maxBuy = $2 < $5 → blocked
    const result = applySectorCapGuard(makeDecision({ amountUSD: 50 }), 198, 1000, 20);
    expect(result.trimmedAmountUSD).toBe(0);
    expect(result.blocked).toBe(true);
  });

  it('BUY with exactly $5 room gets trimmed (not blocked)', () => {
    // existing $195, portfolio $1000, cap 20% → maxBuy = $5 >= $5 → trim
    const result = applySectorCapGuard(makeDecision({ amountUSD: 50 }), 195, 1000, 20);
    expect(result.trimmedAmountUSD).toBe(5);
    expect(result.trimmed).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it('returns reason string when trimmed', () => {
    const result = applySectorCapGuard(makeDecision({ amountUSD: 100 }), 150, 1000, 20);
    expect(result.reason).toBeTruthy();
    expect(typeof result.reason).toBe('string');
  });

  it('returns reason string when blocked', () => {
    const result = applySectorCapGuard(makeDecision({ amountUSD: 50 }), 200, 1000, 20);
    expect(result.reason).toBeTruthy();
    expect(result.reason).toMatch(/sector limit/);
  });

  it('zero portfolio value passes through (guard against division by zero)', () => {
    const result = applySectorCapGuard(makeDecision(), 0, 0, 20);
    expect(result.trimmedAmountUSD).toBe(100);
    expect(result.blocked).toBe(false);
  });

  it('higher sector cap (momentum scale-up) allows larger position', () => {
    // existing $199, portfolio $1000, normal cap 20% ($200) → $1 room < $5 → blocked
    // momentum cap 30% ($300) → $101 room → trimmed to $50 (no trimming needed)
    const blocked = applySectorCapGuard(makeDecision({ amountUSD: 50 }), 199, 1000, 20);
    const allowed = applySectorCapGuard(makeDecision({ amountUSD: 50 }), 199, 1000, 30);
    expect(blocked.blocked).toBe(true);
    expect(allowed.blocked).toBe(false);
    expect(allowed.trimmedAmountUSD).toBeGreaterThan(0);
  });
});
