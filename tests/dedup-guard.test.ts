/**
 * Dedup guard tests: prevent the same token/action/tier combo from firing
 * repeatedly within a dedup window.
 *
 * Without this guard, the bot can loop: buy -> trailing stop sell -> buy -> sell
 * hundreds of times per day, hemorrhaging gas fees and slippage.
 */

import { describe, it, expect } from 'vitest';
import {
  buildDedupKey,
  getDedupWindowMinutes,
  checkDedupGuard,
  NORMAL_DEDUP_WINDOW_MINUTES,
  FORCED_DEPLOY_DEDUP_WINDOW_MINUTES,
  SCALE_UP_DEDUP_WINDOW_MINUTES,
  SURGE_DEDUP_WINDOW_MINUTES,
  MOMENTUM_EXIT_DEDUP_WINDOW_MINUTES,
  DECEL_TRIM_DEDUP_WINDOW_MINUTES,
} from '../src/core/services/testable/dedup-guard.js';

describe('buildDedupKey', () => {
  it('should extract tier from reasoning prefix', () => {
    const result = buildDedupKey({
      action: 'BUY',
      toToken: 'cbBTC',
      reasoning: 'FORCED_DEPLOY: High cash',
    });
    expect(result.token).toBe('cbBTC');
    expect(result.tier).toBe('FORCED_DEPLOY');
    expect(result.key).toBe('cbBTC:BUY:FORCED_DEPLOY');
  });

  it('should default tier to AI when no prefix match', () => {
    const result = buildDedupKey({
      action: 'BUY',
      toToken: 'AERO',
      reasoning: 'Technical confluence buy signal',
    });
    expect(result.tier).toBe('AI');
    expect(result.key).toBe('AERO:BUY:AI');
  });

  it('should use fromToken for SELL actions', () => {
    const result = buildDedupKey({
      action: 'SELL',
      fromToken: 'cbBTC',
      reasoning: 'TRAILING_STOP: Price fell below trail',
    });
    expect(result.token).toBe('cbBTC');
    expect(result.key).toBe('cbBTC:SELL:TRAILING_STOP');
  });
});

describe('getDedupWindowMinutes', () => {
  it('should return NORMAL window for generic AI tier', () => {
    expect(getDedupWindowMinutes('AI')).toBe(NORMAL_DEDUP_WINDOW_MINUTES);
  });

  it('should return FORCED_DEPLOY window for FORCED_DEPLOY tier', () => {
    expect(getDedupWindowMinutes('FORCED_DEPLOY')).toBe(FORCED_DEPLOY_DEDUP_WINDOW_MINUTES);
  });

  it('should return SCALE_UP window for SCALE_UP tier (non-surge)', () => {
    expect(getDedupWindowMinutes('SCALE_UP')).toBe(SCALE_UP_DEDUP_WINDOW_MINUTES);
  });

  it('should return SURGE window for SCALE_UP with multi-timeframe confirmation', () => {
    expect(getDedupWindowMinutes('SCALE_UP', 'SCALE_UP: confirmed across 5m/15m/1h')).toBe(
      SURGE_DEDUP_WINDOW_MINUTES,
    );
  });

  it('should return DECEL_TRIM window for TRAILING_STOP exits', () => {
    expect(getDedupWindowMinutes('TRAILING_STOP')).toBe(DECEL_TRIM_DEDUP_WINDOW_MINUTES);
  });

  it('should return MOMENTUM_EXIT window for MOMENTUM_EXIT tier', () => {
    expect(getDedupWindowMinutes('MOMENTUM_EXIT')).toBe(MOMENTUM_EXIT_DEDUP_WINDOW_MINUTES);
  });

  it('should return MOMENTUM_EXIT window for FLOW_REVERSAL tier', () => {
    expect(getDedupWindowMinutes('FLOW_REVERSAL')).toBe(MOMENTUM_EXIT_DEDUP_WINDOW_MINUTES);
  });

  it('should return NORMAL window for SCOUT tier', () => {
    expect(getDedupWindowMinutes('SCOUT')).toBe(NORMAL_DEDUP_WINDOW_MINUTES);
  });
});

describe('same token/action/tier within window -> BLOCKED', () => {
  it('should block when same combo was executed 5 minutes ago (normal 30min window)', () => {
    const now = Date.now();
    const fiveMinAgo = new Date(now - 5 * 60 * 1000).toISOString();

    const result = checkDedupGuard(
      { action: 'BUY', toToken: 'cbBTC', reasoning: 'AI: buy signal' },
      { 'cbBTC:BUY:AI': fiveMinAgo },
      new Set(),
      now,
    );

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('DEDUP_WINDOW');
  });

  it('should block FORCED_DEPLOY within its 20min window', () => {
    const now = Date.now();
    const tenMinAgo = new Date(now - 10 * 60 * 1000).toISOString();

    const result = checkDedupGuard(
      { action: 'BUY', toToken: 'cbBTC', reasoning: 'FORCED_DEPLOY: deploying' },
      { 'cbBTC:BUY:FORCED_DEPLOY': tenMinAgo },
      new Set(),
      now,
    );

    expect(result.blocked).toBe(true);
  });

  it('should block when trade is in-flight', () => {
    const result = checkDedupGuard(
      { action: 'BUY', toToken: 'cbBTC', reasoning: 'AI: buy' },
      {},
      new Set(['cbBTC:BUY:AI']),
    );

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('DEDUP_INFLIGHT');
  });
});

describe('same combo outside window -> ALLOWED', () => {
  it('should allow when last execution was 35 minutes ago (outside 30min normal window)', () => {
    const now = Date.now();
    const thirtyFiveMinAgo = new Date(now - 35 * 60 * 1000).toISOString();

    const result = checkDedupGuard(
      { action: 'BUY', toToken: 'cbBTC', reasoning: 'AI: buy signal' },
      { 'cbBTC:BUY:AI': thirtyFiveMinAgo },
      new Set(),
      now,
    );

    expect(result.blocked).toBe(false);
  });

  it('should allow FORCED_DEPLOY when last was 25 minutes ago (outside 20min window)', () => {
    const now = Date.now();
    const twentyFiveMinAgo = new Date(now - 25 * 60 * 1000).toISOString();

    const result = checkDedupGuard(
      { action: 'BUY', toToken: 'cbBTC', reasoning: 'FORCED_DEPLOY: deploying' },
      { 'cbBTC:BUY:FORCED_DEPLOY': twentyFiveMinAgo },
      new Set(),
      now,
    );

    expect(result.blocked).toBe(false);
  });

  it('should allow when no prior execution exists', () => {
    const result = checkDedupGuard(
      { action: 'BUY', toToken: 'cbBTC', reasoning: 'AI: buy' },
      {},
      new Set(),
    );

    expect(result.blocked).toBe(false);
  });

  it('should allow different token even if same action/tier is in window', () => {
    const now = Date.now();
    const fiveMinAgo = new Date(now - 5 * 60 * 1000).toISOString();

    // cbBTC was recently traded, but we're trading AERO now
    const result = checkDedupGuard(
      { action: 'BUY', toToken: 'AERO', reasoning: 'AI: buy signal' },
      { 'cbBTC:BUY:AI': fiveMinAgo },
      new Set(),
      now,
    );

    expect(result.blocked).toBe(false);
  });

  it('should allow different tier for same token within window', () => {
    const now = Date.now();
    const fiveMinAgo = new Date(now - 5 * 60 * 1000).toISOString();

    // cbBTC AI buy was recent, but this is a FORCED_DEPLOY buy
    const result = checkDedupGuard(
      { action: 'BUY', toToken: 'cbBTC', reasoning: 'FORCED_DEPLOY: deploying' },
      { 'cbBTC:BUY:AI': fiveMinAgo },
      new Set(),
      now,
    );

    expect(result.blocked).toBe(false);
  });
});

describe('boundary conditions', () => {
  it('should block at exactly the window boundary (29 min for 30 min window)', () => {
    const now = Date.now();
    const twentyNineMinAgo = new Date(now - 29 * 60 * 1000).toISOString();

    const result = checkDedupGuard(
      { action: 'BUY', toToken: 'cbBTC', reasoning: 'AI: buy' },
      { 'cbBTC:BUY:AI': twentyNineMinAgo },
      new Set(),
      now,
    );

    expect(result.blocked).toBe(true);
  });

  it('should allow at exactly the window boundary (30 min for 30 min window)', () => {
    const now = Date.now();
    const exactlyThirtyMinAgo = new Date(now - 30 * 60 * 1000).toISOString();

    const result = checkDedupGuard(
      { action: 'BUY', toToken: 'cbBTC', reasoning: 'AI: buy' },
      { 'cbBTC:BUY:AI': exactlyThirtyMinAgo },
      new Set(),
      now,
    );

    // minutesSince = 30, window = 30, 30 < 30 is false => ALLOWED
    expect(result.blocked).toBe(false);
  });
});
