/**
 * Never Rest Capital — Bot Factory
 *
 * Phase 6 of the monolith refactor. `createBot()` is the single entry point
 * for constructing a bot instance with its own isolated state and services.
 *
 * Current scope (Phase 6a — this file):
 *   - Creates isolated AgentState + BreakerState per bot
 *   - Wires a StateManager
 *   - Returns a Bot with no-op service handles (Phase 6b wires live services)
 *
 * Future scope (Phase 6b):
 *   - Wire live TelegramService (per-bot chat ID)
 *   - Wire live CacheManager (per-bot cache namespace)
 *   - Wire live CooldownManager (per-bot cooldown state)
 *   - Wire live SHI (per-bot incident log)
 */

import type { AgentState, BreakerState } from '../types/state.js';
import { StateManager } from '../state/state-manager.js';
import { Bot, type TelegramHandle, type CacheHandle, type CooldownHandle } from './bot.js';
import type { BotConfig } from './bot-config.js';

// ============================================================================
// INITIAL STATE FACTORY
// ============================================================================

/**
 * Construct a fresh AgentState with zero-value fields.
 *
 * This mirrors the initial `state` object in agent-v3.2.ts (the `const state`
 * declaration at the module level). Phase 6b will load from persisted state.
 */
export function createInitialAgentState(): AgentState {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  return {
    startTime:    now,
    totalCycles:  0,
    lastCycleTime: null,
    trading: {
      lastCheck:           now,
      lastTrade:           null,
      totalTrades:         0,
      successfulTrades:    0,
      balances:            [],
      totalPortfolioValue: 0,
      initialValue:        0,
      peakValue:           0,
      sectorAllocations:   [],
      marketRegime:        'UNKNOWN',
    },
    tradeHistory:          [],
    costBasis:             {},
    profitTakeCooldowns:   {},
    stopLossCooldowns:     {},
    tradeFailures:         {},
    autoHarvestTransfers:  [],
    totalAutoHarvestedUSD: 0,
    totalAutoHarvestedETH: 0,
    lastAutoHarvestTime:   null,
    autoHarvestCount:      0,
    autoHarvestByRecipient: {},
    dailyPayouts:           [],
    totalDailyPayoutsUSD:   0,
    dailyPayoutCount:       0,
    lastDailyPayoutDate:    null,
    // v21.19.1 (2026-04-22) — see state.ts for rationale.
    lastDailyPayoutExecutedDate: null,
    dailyPayoutByRecipient: {},
    pendingFeeUSDC:         0,
    strategyPatterns:       {},
    adaptiveThresholds:     { adaptationCount: 0 } as any,
    performanceReviews:     [],
    explorationState:       {
      consecutiveHolds:           0,
      totalExplorationTrades:     0,
      totalExploitationTrades:    0,
      lastTradeTimestamp:         null,
    } as any,
    lastReviewTradeIndex:  0,
    lastReviewTimestamp:   null,
    totalDeposited:        0,
    onChainWithdrawn:      0,
    lastKnownUSDCBalance:  0,
    depositHistory:        [],
    fundingRateHistory:    { btc: [], eth: [] },
    btcDominanceHistory:   { values: [] },
    stablecoinSupplyHistory: { values: [] },
    errorLog:              [],
  } as unknown as AgentState;
}

/**
 * Construct a fresh BreakerState.
 *
 * Mirrors the initial `breakerState` object in agent-v3.2.ts.
 */
export function createInitialBreakerState(): BreakerState {
  const today = new Date().toISOString().split('T')[0];
  return {
    consecutiveLosses:       0,
    lastBreakerTriggered:    null,
    lastBreakerReason:       null,
    breakerSizeReductionUntil: null,
    dailyBaseline:           { date: today, value: 0 },
    dailyBaselineValidated:  false,
    weeklyBaseline:          { weekStart: today, value: 0 },
    rollingTradeResults:     [],
  };
}

// ============================================================================
// FACTORY
// ============================================================================

export interface BotFactoryHandles {
  telegram?: TelegramHandle;
  cache?:    CacheHandle;
  cooldown?: CooldownHandle;
}

/**
 * Create a fully isolated Bot instance from a BotConfig.
 *
 * Each call returns a new Bot with its own AgentState, BreakerState, and
 * StateManager. No shared state between bots — fleet isolation guaranteed.
 *
 * @param config  Per-bot configuration (wallet address, trading params, etc.)
 * @param handles Live service handles (telegram, cache, cooldown). Defaults to
 *                no-ops if not provided — useful for testing and paper trade bots.
 * @param state   Optional: provide existing state (for state restoration after
 *                restart). If omitted, starts from a fresh zero-value state.
 */
export function createBot(
  config: BotConfig,
  handles: BotFactoryHandles = {},
  state?: AgentState,
  breakerState?: BreakerState,
): Bot {
  const agentState   = state        ?? createInitialAgentState();
  const breaker      = breakerState ?? createInitialBreakerState();
  const stateManager = new StateManager(agentState, breaker);
  return new Bot(config, stateManager, handles);
}
