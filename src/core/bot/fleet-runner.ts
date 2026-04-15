/**
 * Never Rest Capital — Fleet Runner
 *
 * Phase 6 of the monolith refactor. Manages a fleet of `Bot` instances,
 * each running in isolation with its own state and service handles.
 *
 * Current scope (Phase 6a — this file):
 *   - FleetRunner class with register / unregister / getBot
 *   - Status reporting (getStatus) — all bots in a uniform snapshot
 *   - No execution loop wired yet (Phase 6b)
 *
 * Future scope (Phase 6b+):
 *   - runCycle(botId) — trigger one cycle for a specific bot
 *   - runAll() — run all registered bots in parallel
 *   - Graceful shutdown (stop all bots, flush state)
 *   - Health-check endpoint integration
 *
 * The FleetRunner is designed for Railway's multi-service model:
 * each service runs one Bot via the existing agent-v3.2.ts entry point
 * but shares the FleetRunner for cross-bot reporting (e.g., the /admin
 * dashboard aggregates all registered bots via a shared runner).
 */

import { Bot } from './bot.js';

// ============================================================================
// TYPES
// ============================================================================

export interface BotStatus {
  botId: string;
  instanceName: string;
  walletAddress: string;
  portfolioValue: number;
  drawdownPct: number;
  cycleNumber: number;
  lastCycleAgoSec: number | null;
  circuitBreakerActive: boolean;
  circuitBreakerReason: string | null;
  uptimeSec: number;
}

// ============================================================================
// FLEET RUNNER
// ============================================================================

export class FleetRunner {
  private readonly bots = new Map<string, Bot>();

  /**
   * Register a bot with the fleet.
   * Throws if a bot with the same botId is already registered.
   */
  register(bot: Bot): void {
    if (this.bots.has(bot.botId)) {
      throw new Error(`FleetRunner: bot "${bot.botId}" is already registered`);
    }
    this.bots.set(bot.botId, bot);
  }

  /**
   * Unregister a bot from the fleet.
   * Returns true if it was registered, false if it was unknown.
   */
  unregister(botId: string): boolean {
    return this.bots.delete(botId);
  }

  /**
   * Get a registered bot by ID. Returns undefined if not found.
   */
  getBot(botId: string): Bot | undefined {
    return this.bots.get(botId);
  }

  /**
   * All registered bot IDs.
   */
  getBotIds(): string[] {
    return [...this.bots.keys()];
  }

  /**
   * How many bots are registered.
   */
  get size(): number {
    return this.bots.size;
  }

  /**
   * Get a status snapshot for all registered bots.
   *
   * Used by the /admin dashboard + Telegram fleet reports.
   * Returns bots sorted by portfolio value descending.
   */
  getStatus(): BotStatus[] {
    const statuses: BotStatus[] = [];
    const now = Date.now();

    for (const bot of this.bots.values()) {
      const breaker = bot.getCircuitBreakerState();
      const lastCycle = bot.getLastCycleTime();
      const peak = bot.getPeakValue();
      const portfolio = bot.getPortfolioValue();
      const drawdownPct = peak > 0 && portfolio > 0
        ? Math.max(0, ((peak - portfolio) / peak) * 100)
        : 0;

      statuses.push({
        botId:                bot.botId,
        instanceName:         bot.instanceName,
        walletAddress:        bot.walletAddress,
        portfolioValue:       portfolio,
        drawdownPct,
        cycleNumber:          bot.getCycleNumber(),
        lastCycleAgoSec:      lastCycle !== null ? Math.floor((now - lastCycle) / 1000) : null,
        circuitBreakerActive: breaker.active,
        circuitBreakerReason: breaker.reason,
        uptimeSec:            bot.getUptimeSec(),
      });
    }

    return statuses.sort((a, b) => b.portfolioValue - a.portfolioValue);
  }

  /**
   * Total portfolio value across all registered bots.
   */
  getTotalPortfolioValue(): number {
    let total = 0;
    for (const bot of this.bots.values()) {
      total += bot.getPortfolioValue();
    }
    return total;
  }
}

// ============================================================================
// SINGLETON — shared fleet runner instance
// ============================================================================

/**
 * The singleton fleet runner used by the health server and admin endpoints.
 *
 * In multi-service Railway deployments, each service registers its single Bot
 * here. The /admin dashboard aggregates across all services via the same
 * in-memory instance (within one process), or via the Telegram bot API
 * (across services).
 */
export const fleetRunner = new FleetRunner();
