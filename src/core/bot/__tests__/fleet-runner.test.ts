/**
 * Unit tests for Phase 6 FleetRunner.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FleetRunner } from '../fleet-runner.js';
import { createBot } from '../bot-factory.js';
import type { BotConfig } from '../bot-config.js';

function makeConfig(botId: string, portfolioValue = 0): BotConfig {
  return {
    botId,
    walletAddress: `0x${'0'.repeat(40)}`,
    instanceName:  `Bot ${botId}`,
    trading: {
      enabled: false, maxBuySize: 100, maxSellPercent: 50, intervalMinutes: 15,
      maxPositionPercent: 25, minPositionUSD: 15, rebalanceThreshold: 10, slippageBps: 100,
      profitTaking: { enabled: true, targetPercent: 30, sellPercent: 30, minHoldingUSD: 5, cooldownHours: 8, tiers: [] },
      stopLoss: { enabled: true, percentThreshold: -15, sellPercent: 75, minHoldingUSD: 5, trailingEnabled: true, trailingPercent: -12 },
    },
    activeTokens: [],
    persistDir:   './tmp',
    logFile:      './tmp/trades.json',
  };
}

let runner: FleetRunner;

beforeEach(() => {
  runner = new FleetRunner();
});

describe('register / unregister', () => {
  it('registers a bot successfully', () => {
    const bot = createBot(makeConfig('henry'));
    runner.register(bot);
    expect(runner.size).toBe(1);
  });

  it('throws on duplicate botId', () => {
    const bot = createBot(makeConfig('henry'));
    runner.register(bot);
    const dup = createBot(makeConfig('henry'));
    expect(() => runner.register(dup)).toThrow('henry');
  });

  it('unregisters an existing bot and returns true', () => {
    runner.register(createBot(makeConfig('henry')));
    const removed = runner.unregister('henry');
    expect(removed).toBe(true);
    expect(runner.size).toBe(0);
  });

  it('returns false when unregistering unknown botId', () => {
    expect(runner.unregister('unknown')).toBe(false);
  });
});

describe('getBot', () => {
  it('returns the registered bot by id', () => {
    const bot = createBot(makeConfig('henry'));
    runner.register(bot);
    expect(runner.getBot('henry')).toBe(bot);
  });

  it('returns undefined for unknown id', () => {
    expect(runner.getBot('not-there')).toBeUndefined();
  });
});

describe('getBotIds', () => {
  it('returns all registered bot ids', () => {
    runner.register(createBot(makeConfig('a')));
    runner.register(createBot(makeConfig('b')));
    const ids = runner.getBotIds();
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toHaveLength(2);
  });
});

describe('getStatus', () => {
  it('returns one status per registered bot', () => {
    runner.register(createBot(makeConfig('a')));
    runner.register(createBot(makeConfig('b')));
    expect(runner.getStatus()).toHaveLength(2);
  });

  it('each status has expected fields', () => {
    runner.register(createBot(makeConfig('henry')));
    const [status] = runner.getStatus();
    expect(status.botId).toBe('henry');
    expect(status.portfolioValue).toBe(0);
    expect(status.circuitBreakerActive).toBe(false);
    expect(status.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it('sorts bots by portfolioValue descending', () => {
    const bot1 = createBot(makeConfig('low'));
    const bot2 = createBot(makeConfig('high'));
    // Manually set portfolio values
    (bot1.getStateManager().getState() as any).trading.totalPortfolioValue = 100;
    (bot2.getStateManager().getState() as any).trading.totalPortfolioValue = 500;
    runner.register(bot1);
    runner.register(bot2);
    const statuses = runner.getStatus();
    expect(statuses[0].botId).toBe('high');
    expect(statuses[1].botId).toBe('low');
  });

  it('returns empty array when no bots registered', () => {
    expect(runner.getStatus()).toHaveLength(0);
  });
});

describe('getTotalPortfolioValue', () => {
  it('sums portfolio values across all bots', () => {
    const bot1 = createBot(makeConfig('a'));
    const bot2 = createBot(makeConfig('b'));
    (bot1.getStateManager().getState() as any).trading.totalPortfolioValue = 1000;
    (bot2.getStateManager().getState() as any).trading.totalPortfolioValue = 500;
    runner.register(bot1);
    runner.register(bot2);
    expect(runner.getTotalPortfolioValue()).toBe(1500);
  });

  it('returns 0 when no bots registered', () => {
    expect(runner.getTotalPortfolioValue()).toBe(0);
  });
});
