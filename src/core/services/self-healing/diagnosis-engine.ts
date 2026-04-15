/**
 * NVR Capital — Self-Healing Intelligence: Diagnosis Engine
 *
 * Uses Claude (claude-sonnet-4-6) to analyze incidents in context
 * and recommend playbook actions. This is the only place in the
 * self-healing system that calls the Anthropic API.
 *
 * Model is intentionally hardcoded — never swap to Haiku here.
 * Diagnosis is a meta-decision that affects capital safety.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  Incident,
  Diagnosis,
  PlaybookAction,
  DiagnosisConfidence,
} from './types.js';
import { PLAYBOOK_DESCRIPTIONS } from './types.js';

// ============================================================================
// DIAGNOSIS CONTEXT — snapshot of bot state at incident time
// ============================================================================

export interface DiagnosisContext {
  cycleNumber: number;
  portfolioValue: number;
  marketRegime: string;
  recentTrades: Array<{
    token: string;
    action: string;
    success: boolean;
    pnlUSD?: number;
    timestamp: string;
  }>;
  activePositions: Array<{
    symbol: string;
    usdValue: number;
    unrealizedPct: number;
  }>;
  recentErrors: Array<{
    type: string;
    message: string;
    timestamp: string;
  }>;
  circuitBreakerState: {
    active: boolean;
    reason: string | null;
    triggeredAt: string | null;
  };
  recentHealingHistory: Array<{
    type: string;
    actionsExecuted: string[];
    resolved: boolean;
  }>;
}

// ============================================================================
// INTERNAL: Claude's raw JSON response shape
// ============================================================================

interface ClaudeRawDiagnosis {
  rootCause: string;
  confidence: DiagnosisConfidence;
  recommendedActions: PlaybookAction[];
  reasoning: string;
}

// ============================================================================
// DIAGNOSIS ENGINE
// ============================================================================

const DIAGNOSIS_TIMEOUT_MS = 20_000;
const MODEL = 'claude-sonnet-4-6'; // Never change — meta-decision, not a cost optimization point

export class DiagnosisEngine {
  private readonly client: Anthropic;

  constructor(anthropicApiKey: string) {
    this.client = new Anthropic({ apiKey: anthropicApiKey });
  }

  // ============================================================================
  // SYSTEM PROMPT — tells Claude what it is and what actions are available
  // ============================================================================

  private buildSystemPrompt(): string {
    const actionList = (Object.keys(PLAYBOOK_DESCRIPTIONS) as PlaybookAction[])
      .map((action) => `  - ${action}: ${PLAYBOOK_DESCRIPTIONS[action]}`)
      .join('\n');

    return `You are NVR Capital's Self-Healing Intelligence — an expert autonomous system embedded inside a 24/7 cryptocurrency trading bot running on Base (L2).

Your role is to diagnose trading incidents and recommend safe, targeted remediation actions from the approved playbook. You have full context on the bot's state, recent activity, and error history.

AVAILABLE PLAYBOOK ACTIONS:
${actionList}

DIAGNOSIS RULES:
- Prefer the most specific, minimal action set that resolves the root cause
- Never recommend RESET_CIRCUIT_BREAKER unless recovery evidence is clear (net-positive recent trades, no ongoing errors)
- Prefer ADD_TOKEN_COOLDOWN over broad position size reductions when the issue is token-specific
- Use ESCALATE_TO_HUMAN only when no playbook action can safely resolve the situation
- NOTIFY_ONLY is appropriate for low-severity informational incidents where no state change is warranted
- Multiple actions are allowed — list them in execution order
- Confidence reflects how certain you are of the root cause, not whether you can fix it

RESPONSE FORMAT:
You MUST respond with raw JSON only. No markdown fences, no preamble, no explanation outside the JSON.

{
  "rootCause": "<clear human-readable explanation of what caused this incident>",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "recommendedActions": ["ACTION_1", "ACTION_2"],
  "reasoning": "<your chain of thought — what signals pointed to this cause, why these actions>"
}`;
  }

  // ============================================================================
  // USER PROMPT — incident + full context
  // ============================================================================

  private buildUserPrompt(incident: Incident, context: DiagnosisContext): string {
    const recentTradesSummary = context.recentTrades.length > 0
      ? context.recentTrades
          .map(
            (t) =>
              `  [${t.timestamp}] ${t.action} ${t.token} — ${t.success ? 'SUCCESS' : 'FAILED'}${
                t.pnlUSD !== undefined ? ` ($${t.pnlUSD.toFixed(2)})` : ''
              }`
          )
          .join('\n')
      : '  (none)';

    const positionsSummary = context.activePositions.length > 0
      ? context.activePositions
          .map(
            (p) =>
              `  ${p.symbol}: $${p.usdValue.toFixed(2)} (${
                p.unrealizedPct >= 0 ? '+' : ''
              }${p.unrealizedPct.toFixed(1)}%)`
          )
          .join('\n')
      : '  (no active positions)';

    const errorsSummary = context.recentErrors.length > 0
      ? context.recentErrors
          .map((e) => `  [${e.timestamp}] ${e.type}: ${e.message}`)
          .join('\n')
      : '  (none)';

    const healingHistorySummary = context.recentHealingHistory.length > 0
      ? context.recentHealingHistory
          .map(
            (h) =>
              `  ${h.type} → [${h.actionsExecuted.join(', ')}] — ${
                h.resolved ? 'resolved' : 'unresolved'
              }`
          )
          .join('\n')
      : '  (none)';

    const cbState = context.circuitBreakerState.active
      ? `ACTIVE (reason: ${context.circuitBreakerState.reason}, since: ${context.circuitBreakerState.triggeredAt})`
      : 'inactive';

    return `INCIDENT TO DIAGNOSE:
  ID:       ${incident.id}
  Type:     ${incident.type}
  Severity: ${incident.severity}
  Time:     ${incident.timestamp}
  Cycle:    #${incident.cycleNumber}

INCIDENT CONTEXT:
${JSON.stringify(incident.context, null, 2)}

BOT STATE AT TIME OF INCIDENT:
  Portfolio Value: $${context.portfolioValue.toFixed(2)}
  Market Regime:   ${context.marketRegime}
  Circuit Breaker: ${cbState}

RECENT TRADES (last 10):
${recentTradesSummary}

ACTIVE POSITIONS:
${positionsSummary}

RECENT ERRORS:
${errorsSummary}

RECENT HEALING HISTORY:
${healingHistorySummary}

Diagnose this incident and recommend playbook actions. Respond with raw JSON only.`;
  }

  // ============================================================================
  // DIAGNOSE — main public method
  // ============================================================================

  async diagnose(incident: Incident, context: DiagnosisContext): Promise<Diagnosis> {
    const startedAt = Date.now();

    const fallback = (reason: string): Diagnosis => ({
      incidentId: incident.id,
      rootCause: 'Diagnosis failed',
      confidence: 'LOW',
      recommendedActions: ['NOTIFY_ONLY'],
      reasoning: reason,
      modelUsed: MODEL,
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Diagnosis timeout after 20s')), DIAGNOSIS_TIMEOUT_MS)
      );

      const apiPromise = this.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: this.buildSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: this.buildUserPrompt(incident, context),
          },
        ],
      });

      const response = await Promise.race([apiPromise, timeoutPromise]);

      const latencyMs = Date.now() - startedAt;

      // Extract text content
      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        return fallback('No text content in response');
      }

      // Strip any accidental markdown fences before parsing
      const rawText = textBlock.text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();

      let parsed: ClaudeRawDiagnosis;
      try {
        parsed = JSON.parse(rawText) as ClaudeRawDiagnosis;
      } catch {
        return fallback(`Parse error: ${rawText.substring(0, 200)}`);
      }

      // Validate required fields
      if (
        typeof parsed.rootCause !== 'string' ||
        !['HIGH', 'MEDIUM', 'LOW'].includes(parsed.confidence) ||
        !Array.isArray(parsed.recommendedActions) ||
        typeof parsed.reasoning !== 'string'
      ) {
        return fallback('Invalid response shape from model');
      }

      return {
        incidentId: incident.id,
        rootCause: parsed.rootCause,
        confidence: parsed.confidence as DiagnosisConfidence,
        recommendedActions: parsed.recommendedActions as PlaybookAction[],
        reasoning: parsed.reasoning,
        modelUsed: MODEL,
        latencyMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return fallback(`API error: ${message}`);
    }
  }
}
