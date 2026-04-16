/**
 * Never Rest Capital — Bot module barrel
 * Phase 6 of the monolith refactor.
 */

export { Bot, NOOP_TELEGRAM, NOOP_CACHE, NOOP_COOLDOWN } from './bot.js';
export { botConfigFromEnv }                               from './bot-config.js';
export { createBot, createInitialAgentState, createInitialBreakerState } from './bot-factory.js';
export { FleetRunner, fleetRunner }                       from './fleet-runner.js';

export type { BotConfig, TradingConfig, ProfitTakingTier } from './bot-config.js';
export type { TelegramHandle, CacheHandle, CooldownHandle } from './bot.js';
export type { BotStatus }                                  from './fleet-runner.js';
export type { BotFactoryHandles }                          from './bot-factory.js';
