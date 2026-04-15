/**
 * NVR Capital — Self-Healing Intelligence: Notification Gate
 *
 * Controls when and what the self-healing system sends to Telegram.
 * Core contract: one incident = one message (hold → heal → release),
 * unless the situation requires immediate escalation.
 *
 * No noise. Henry gets one clean summary when something goes wrong
 * and the system fixes it — or an immediate alert when it can't.
 */

import type { TelegramAlertService } from '../telegram.js';
import type { Incident, HealingOutcome } from './types.js';
import { PLAYBOOK_DESCRIPTIONS } from './types.js';

// ============================================================================
// NOTIFICATION GATE
// ============================================================================

export class NotificationGate {
  private readonly telegramService: TelegramAlertService;
  private readonly heldIncidents = new Set<string>();

  constructor(telegramService: TelegramAlertService) {
    this.telegramService = telegramService;
  }

  // ============================================================================
  // HOLD — suppress notifications while healing is in progress
  // ============================================================================

  hold(incidentId: string): void {
    this.heldIncidents.add(incidentId);
  }

  isHeld(incidentId: string): boolean {
    return this.heldIncidents.has(incidentId);
  }

  // ============================================================================
  // RELEASE — send ONE clean summary after healing completes
  // ============================================================================

  release(outcome: HealingOutcome): void {
    // Always clear hold state, even if we can't send
    this.heldIncidents.delete(outcome.id);

    const { incident, diagnosis, actionsExecuted, durationMs } = outcome;

    const rootCause = diagnosis?.rootCause ?? 'Unknown cause';
    const confidence = diagnosis?.confidence ?? 'LOW';

    // Build human-readable action list
    const actionDescriptions = actionsExecuted
      .filter((r) => r.success)
      .map((r) => PLAYBOOK_DESCRIPTIONS[r.action])
      .join(', ');

    const actionsLine = actionDescriptions.length > 0
      ? actionDescriptions
      : 'No actions taken';

    const durationSec = (durationMs / 1000).toFixed(1);

    const message = [
      `What happened: ${rootCause}`,
      `Actions: ${actionsLine}`,
      `Duration: ${durationSec}s`,
      `Confidence: ${confidence}`,
      `No action needed.`,
    ].join('\n');

    this.telegramService
      .sendAlert({
        severity: 'INFO',
        title: `Self-Healed: ${incident.type}`,
        message,
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[NotificationGate] Failed to send release alert for ${outcome.id}: ${msg}`);
      });
  }

  // ============================================================================
  // ESCALATE — immediate CRITICAL alert, bypasses hold gate entirely
  // ============================================================================

  escalate(incident: Incident, reason: string): void {
    // Clear any hold — escalation overrides suppression
    this.heldIncidents.delete(incident.id);

    const portfolioLine = `Portfolio: $${incident.portfolioValue.toFixed(2)}`;
    const cycleLine = `Cycle: #${incident.cycleNumber}`;
    const severityLine = `Severity: ${incident.severity}`;

    const message = [
      `${portfolioLine} | ${cycleLine} | ${severityLine}`,
      `Reason: ${reason}`,
      `Manual review required.`,
    ].join('\n');

    this.telegramService
      .sendAlert({
        severity: 'CRITICAL',
        title: `Healing Failed: ${incident.type}`,
        message,
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[NotificationGate] Failed to send escalation alert for ${incident.id}: ${msg}`);
      });
  }
}
