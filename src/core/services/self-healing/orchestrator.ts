/**
 * NVR Capital — Self-Healing Intelligence: Orchestrator
 *
 * The central coordinator of the self-healing system. When an incident is
 * reported it:
 *   1. Deduplicates via IncidentRouter
 *   2. Gathers a DiagnosisContext from the BotInterface
 *   3. Asks Claude to diagnose the root cause and recommend actions
 *   4. Executes the playbook (safe, non-trade state changes only)
 *   5. Evaluates resolution and logs a HealingOutcome via OutcomeLogger
 *   6. Sends ONE consolidated Telegram message via NotificationGate
 *
 * The entire processIncident method is wrapped in a top-level try/catch so
 * a bug here can NEVER crash the 24/7 trading bot.
 */

import { IncidentRouter } from './incident-router.js';
import { PlaybookExecutor } from './playbook-executor.js';
import { DiagnosisEngine } from './diagnosis-engine.js';
import type { DiagnosisContext } from './diagnosis-engine.js';
import { NotificationGate } from './notification-gate.js';
import { OutcomeLogger } from './outcome-logger.js';
import type {
  BotInterface,
  HealingOutcome,
  HealingStats,
  IncidentType,
} from './types.js';

// ============================================================================
// PUBLIC CONFIG
// ============================================================================

export interface SHIConfig {
  anthropicApiKey: string;
  persistDir: string;
  bot: BotInterface;
  telegramService: any; // injected — use any to avoid import complexity
  enabled: boolean;
}

// ============================================================================
// SelfHealingIntelligence
// ============================================================================

export class SelfHealingIntelligence {
  private readonly router: IncidentRouter;
  private readonly executor: PlaybookExecutor;
  private readonly diagnosisEngine: DiagnosisEngine;
  private readonly notificationGate: NotificationGate;
  private readonly outcomeLogger: OutcomeLogger;

  constructor(private readonly config: SHIConfig) {
    this.router          = new IncidentRouter();
    this.executor        = new PlaybookExecutor(config.bot);
    this.diagnosisEngine = new DiagnosisEngine(config.anthropicApiKey);
    this.notificationGate = new NotificationGate(config.telegramService);
    this.outcomeLogger   = new OutcomeLogger(config.persistDir);
  }

  // --------------------------------------------------------------------------
  // Core: process one incident through the full healing pipeline
  // --------------------------------------------------------------------------

  async processIncident(
    type: IncidentType,
    context: Record<string, unknown>,
  ): Promise<void> {
    // Guard: disabled mode — silently drop
    if (!this.config.enabled) return;

    const startMs = Date.now();

    try {
      const bot = this.config.bot;

      // 1. Route + dedup
      const incident = this.router.report(
        type,
        context,
        bot.getCycleNumber(),
        bot.getPortfolioValue(),
      );
      if (!incident) return; // absorbed by dedup

      const portfolioValueBefore = incident.portfolioValue;

      // 2. Hold notification — ONE message at the end, not during healing
      this.notificationGate.hold(incident.id);

      // 3. Build DiagnosisContext from BotInterface
      const diagContext: DiagnosisContext = {
        cycleNumber:         bot.getCycleNumber(),
        portfolioValue:      portfolioValueBefore,
        marketRegime:        bot.getMarketRegime(),
        recentTrades:        bot.getTradeHistory(20),
        activePositions:     bot.getActivePositions(),
        recentErrors:        bot.getErrorLog(10),
        circuitBreakerState: bot.getCircuitBreakerState(),
        // Learning history from the logger — what the system already tried
        recentHealingHistory: this.outcomeLogger
          .getRecent(5)
          .map((o) => ({
            type:            o.incident.type,
            actionsExecuted: o.actionsExecuted.map((a) => a.action),
            resolved:        o.resolved,
          })),
      };

      // 4. Diagnose with Claude
      const diagnosis = await this.diagnosisEngine.diagnose(incident, diagContext);

      // 5. Escalation fast-path:
      //    - Claude recommends ESCALATE_TO_HUMAN, OR
      //    - Incident is CRITICAL and diagnosis confidence is LOW
      const shouldEscalate =
        diagnosis.recommendedActions.includes('ESCALATE_TO_HUMAN') ||
        (incident.severity === 'CRITICAL' && diagnosis.confidence === 'LOW');

      if (shouldEscalate) {
        this.notificationGate.escalate(incident, diagnosis.rootCause);

        const outcome: HealingOutcome = {
          id:               incident.id,
          incident,
          diagnosis,
          actionsExecuted:  [],
          resolved:         false,
          resolvedAt:       null,
          notificationSent: true,
          durationMs:       Date.now() - startMs,
          portfolioValueBefore,
          portfolioValueAfter: bot.getPortfolioValue(),
        };

        this.outcomeLogger.log(outcome);
        return;
      }

      // 6. Execute playbook actions in sequence
      const actionResults = await this.executor.executeAll(
        diagnosis.recommendedActions,
        incident,
      );

      // 7. Check resolution
      //    Success = at least one action succeeded, OR the only action was NOTIFY_ONLY
      const isNotifyOnly =
        diagnosis.recommendedActions.length === 1 &&
        diagnosis.recommendedActions[0] === 'NOTIFY_ONLY';
      const anySuccess = actionResults.some((r) => r.success);
      const resolved   = anySuccess || isNotifyOnly;

      // 8. Build HealingOutcome
      const portfolioValueAfter = bot.getPortfolioValue();
      const outcome: HealingOutcome = {
        id:               incident.id,
        incident:         { ...incident, resolved },
        diagnosis,
        actionsExecuted:  actionResults,
        resolved,
        resolvedAt:       resolved ? new Date().toISOString() : null,
        notificationSent: false,
        durationMs:       Date.now() - startMs,
        portfolioValueBefore,
        portfolioValueAfter,
      };

      // 9. Log outcome (persisted to disk with debounce)
      this.outcomeLogger.log(outcome);

      // 10. Release notification (resolved) or escalate (failed)
      if (resolved) {
        this.notificationGate.release(outcome);
        outcome.notificationSent = true;
      } else {
        this.notificationGate.escalate(
          incident,
          'All healing actions failed — manual review required.',
        );
        outcome.notificationSent = true;
      }

    } catch (outerErr: unknown) {
      // NEVER crash the bot — log locally and move on
      const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
      console.error(`[SHI] processIncident error (type=${type}): ${msg}`);
    }
  }

  // --------------------------------------------------------------------------
  // Public accessors
  // --------------------------------------------------------------------------

  getStats(): HealingStats {
    return this.outcomeLogger.getStats();
  }

  getRecentOutcomes(n: number): HealingOutcome[] {
    return this.outcomeLogger.getRecent(n);
  }

  // --------------------------------------------------------------------------
  // Static factory — reads config from environment
  // --------------------------------------------------------------------------

  static create(bot: BotInterface, telegramService: any): SelfHealingIntelligence {
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? '';
    const persistDir      = process.env.PERSIST_DIR ?? './logs';
    const enabled         = process.env.SELF_HEALING_ENABLED !== 'false';

    return new SelfHealingIntelligence({
      anthropicApiKey,
      persistDir,
      bot,
      telegramService,
      enabled,
    });
  }
}
