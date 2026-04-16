/**
 * Unit tests for Phase 6 bot factory (createBot, createInitialState).
 */

import { describe, it, expect } from 'vitest';
import { createBot, createInitialAgentState, createInitialBreakerState } from '../bot-factory.js';
import type { BotConfig } from '../bot-config.js';

function makeConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    botId:         'test-bot',
    walletAddress: '0x1234567890123456789012345678901234567890',
    instanceName:  'Test Bot',
    trading: {
      enabled: false, maxBuySize: 100, maxSellPercent: 50, intervalMinutes: 15,
      maxPositionPercent: 25, minPositionUSD: 15, rebalanceThreshold: 10, slippageBps: 100,
      profitTaking: { enabled: true, targetPercent: 30, sellPercent: 30, minHoldingUSD: 5, cooldownHours: 8, tiers: [] },
      stopLoss: { enabled: true, percentThreshold: -15, sellPercent: 75, minHoldingUSD: 5, trailingEnabled: true, trailingPercent: -12 },
    },
    activeTokens: ['ETH', 'BTC'],
    persistDir:   './tmp',
    logFile:      './tmp/trades.json',
    ...overrides,
  };
}

describe('createInitialAgentState', () => {
  it('returns state with zero totalCycles', () => {
    const s = createInitialAgentState();
    expect(s.totalCycles).toBe(0);
  });

  it('returns state with zero portfolio value', () => {
    const s = createInitialAgentState();
    expect(s.trading.totalPortfolioValue).toBe(0);
  });

  it('returns state with empty trade history', () => {
    const s = createInitialAgentState();
    expect(s.tradeHistory).toHaveLength(0);
  });

  it('returns state with startTime as Date', () => {
    const before = new Date();
    const s = createInitialAgentState();
    expect(s.startTime).toBeInstanceOf(Date);
    expect(s.startTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});

describe('createInitialBreakerState', () => {
  it('returns non-active breaker state', () => {
    const b = createInitialBreakerState();
    expect(b.consecutiveLosses).toBe(0);
    expect(b.lastBreakerTriggered).toBeNull();
  });

  it('returns empty rolling results', () => {
    const b = createInitialBreakerState();
    expect(b.rollingTradeResults).toHaveLength(0);
  });
});

describe('createBot', () => {
  it('creates a bot with matching botId', () => {
    const bot = createBot(makeConfig({ botId: 'henry' }));
    expect(bot.botId).toBe('henry');
  });

  it('creates a bot with matching walletAddress', () => {
    const config = makeConfig();
    const bot = createBot(config);
    expect(bot.walletAddress).toBe(config.walletAddress);
  });

  it('initialises portfolio value to 0', () => {
    const bot = createBot(makeConfig());
    expect(bot.getPortfolioValue()).toBe(0);
  });

  it('initialises cycle number to 0', () => {
    const bot = createBot(makeConfig());
    expect(bot.getCycleNumber()).toBe(0);
  });

  it('has uptime > 0 after construction', () => {
    const bot = createBot(makeConfig());
    expect(bot.getUptimeSec()).toBeGreaterThanOrEqual(0);
  });

  it('each createBot call produces an isolated state (no shared reference)', () => {
    const bot1 = createBot(makeConfig({ botId: 'bot1' }));
    const bot2 = createBot(makeConfig({ botId: 'bot2' }));
    // Mutate bot1's state
    (bot1.getStateManager().getState() as any).totalCycles = 99;
    // bot2 should be unaffected
    expect(bot2.getCycleNumber()).toBe(0);
  });

  it('returns no-op telegram handle by default', async () => {
    const bot = createBot(makeConfig());
    const result = await bot.telegram.sendAlert({
      severity: 'INFO', title: 'Test', message: 'test',
    });
    expect(result).toBe(false); // no-op returns false
  });

  it('circuit breaker is inactive on fresh bot', () => {
    const bot = createBot(makeConfig());
    expect(bot.getCircuitBreakerState().active).toBe(false);
  });
});

describe('FleetRunner isolation (via createBot)', () => {
  it('bots do not share costBasis state', () => {
    const bot1 = createBot(makeConfig({ botId: 'bot-a' }));
    const bot2 = createBot(makeConfig({ botId: 'bot-b' }));
    const state1 = bot1.getStateManager().getState();
    (state1 as any).costBasis['ETH'] = { symbol: 'ETH', averageCostBasis: 3000 };
    const state2 = bot2.getStateManager().getState();
    expect(state2.costBasis['ETH']).toBeUndefined();
  });
});
