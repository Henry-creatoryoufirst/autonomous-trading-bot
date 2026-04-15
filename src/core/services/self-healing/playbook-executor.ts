/**
 * NVR Capital — Self-Healing Intelligence: Playbook Executor
 *
 * Runs a sequence of PlaybookActions against the BotInterface.
 * Sequential (not parallel) to avoid races on shared bot state.
 * One action failing never stops the rest — resilience over perfection.
 */

import type { BotInterface, Incident, PlaybookAction, ActionResult } from './types.js';

// ============================================================================
// PlaybookExecutor
// ============================================================================

export class PlaybookExecutor {
  constructor(private readonly bot: BotInterface) {}

  /**
   * Execute all recommended actions in order.
   * Catches individual errors — a single failure does not abort the sequence.
   * Calls bot.markStateDirty() after each action that changes state.
   */
  async executeAll(actions: PlaybookAction[], incident: Incident): Promise<ActionResult[]> {
    const results: ActionResult[] = [];

    for (const action of actions) {
      const result = await this._executeOne(action, incident);
      results.push(result);
    }

    return results;
  }

  // --------------------------------------------------------------------------
  // Private: single action dispatch
  // --------------------------------------------------------------------------

  private async _executeOne(action: PlaybookAction, incident: Incident): Promise<ActionResult> {
    const appliedAt = new Date().toISOString();

    try {
      const details = await this._dispatch(action, incident);

      // Mark state dirty for all actions that mutate bot state
      const isStateChanging = action !== 'NOTIFY_ONLY' && action !== 'ESCALATE_TO_HUMAN';
      if (isStateChanging) {
        this.bot.markStateDirty();
      }

      return { action, success: true, details, appliedAt };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        action,
        success: false,
        details: `Action failed: ${msg}`,
        appliedAt,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Private: per-action implementations
  // --------------------------------------------------------------------------

  private async _dispatch(action: PlaybookAction, incident: Incident): Promise<string> {
    switch (action) {
      case 'ADD_TOKEN_COOLDOWN': {
        const token = incident.context.token as string | undefined;
        if (token) {
          this.bot.addTokenCooldown(token, 30 * 60 * 1000);
          return `Token ${token} placed in 30-minute cooldown.`;
        }
        return 'No specific token in context — cooldown skipped.';
      }

      case 'REFRESH_PRICE_CACHE': {
        const token = incident.context.token as string | undefined;
        this.bot.invalidatePriceCache(token);
        return token
          ? `Price cache invalidated for ${token}.`
          : 'Global price cache invalidated.';
      }

      case 'REDUCE_POSITION_SIZE': {
        this.bot.setPositionSizeMultiplier(0.5);
        return 'Position size multiplier set to 0.5 (50% reduction).';
      }

      case 'RAISE_CONFLUENCE_THRESHOLD': {
        this.bot.setConfluenceThresholdOverride(15);
        return 'Confluence threshold raised by +15 points.';
      }

      case 'EXTEND_CIRCUIT_BREAKER': {
        const additionalHours = (incident.context.additionalHours as number) ?? 2;
        this.bot.extendCircuitBreaker(additionalHours);
        return `Circuit breaker extended by ${additionalHours} hour(s).`;
      }

      case 'RESET_CIRCUIT_BREAKER': {
        if (incident.severity === 'CRITICAL') {
          return 'Reset skipped — incident is CRITICAL; manual review required.';
        }
        this.bot.resetCircuitBreaker();
        return 'Circuit breaker cleared — recovery evidence confirmed.';
      }

      case 'NOTIFY_ONLY': {
        return 'Incident logged. No autonomous action taken.';
      }

      case 'ESCALATE_TO_HUMAN': {
        return 'Escalated to human.';
      }

      default: {
        // TypeScript exhaustiveness check
        const _exhaustive: never = action;
        throw new Error(`Unknown playbook action: ${_exhaustive}`);
      }
    }
  }
}
