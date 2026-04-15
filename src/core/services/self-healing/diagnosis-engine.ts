/**
 * NVR Capital — Self-Healing Intelligence: Diagnosis Engine
 *
 * Uses tiered model routing to analyze incidents and recommend playbook
 * actions. Matches the bot's philosophy: cheap-first, Claude is fallback.
 *
 * Routing priority (severity-aware):
 *   LOW / MEDIUM:    Cerebras → Groq → Ollama → Claude Haiku → Claude Sonnet
 *   HIGH / CRITICAL: Cerebras → Groq → Claude Sonnet (skip slower fallbacks)
 *
 * Claude Sonnet is only used when:
 *   - All cheaper backends are unreachable or fail to produce valid JSON
 *   - A cheap model returns LOW confidence on a CRITICAL incident (re-diagnose)
 *
 * This aligns with the Crew/NVR philosophy: "Anthropic is fallback only."
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  Incident,
  Diagnosis,
  PlaybookAction,
  DiagnosisConfidence,
  IncidentSeverity,
} from './types.js';
import { PLAYBOOK_DESCRIPTIONS } from './types.js';
import {
  AI_MODEL_HEAVY,
  AI_MODEL_ROUTINE,
  AI_MODEL_GEMMA,
  OLLAMA_DEFAULT_BASE_URL,
  GROQ_BASE_URL,
  GROQ_MODEL_FAST,
  CEREBRAS_BASE_URL,
  CEREBRAS_MODEL,
} from '../../config/constants.js';

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
// INTERNAL: model's raw JSON response shape
// ============================================================================

interface RawDiagnosis {
  rootCause: string;
  confidence: DiagnosisConfidence;
  recommendedActions: PlaybookAction[];
  reasoning: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DIAGNOSIS_TIMEOUT_MS = 20_000;
const CHEAP_BACKEND_TIMEOUT_MS = 8_000;  // Cerebras/Groq are fast — short leash
const OLLAMA_BACKEND_TIMEOUT_MS = 15_000; // Local can be slower
const MAX_TOKENS = 1024;

type BackendId = 'cerebras' | 'groq' | 'ollama' | 'claude-haiku' | 'claude-sonnet';

interface BackendResult {
  text: string;
  model: string;
  latencyMs: number;
}

// ============================================================================
// DIAGNOSIS ENGINE
// ============================================================================

export class DiagnosisEngine {
  private readonly anthropicClient: Anthropic;

  constructor(anthropicApiKey: string) {
    this.anthropicClient = new Anthropic({ apiKey: anthropicApiKey });
  }

  // ============================================================================
  // SYSTEM PROMPT — model-agnostic, enforces strict JSON
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
Do not wrap the JSON in a code block. Output must be parseable by JSON.parse().

{
  "rootCause": "<clear human-readable explanation of what caused this incident>",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "recommendedActions": ["ACTION_1", "ACTION_2"],
  "reasoning": "<your chain of thought — what signals pointed to this cause, why these actions>"
}`;
  }

  // ============================================================================
  // USER PROMPT — incident + full bot context
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
  // BACKEND ROUTING — pick list of backends to try, in order, based on severity
  // ============================================================================

  private pickBackends(severity: IncidentSeverity): BackendId[] {
    const hasCerebras = !!process.env.CEREBRAS_API_KEY;
    const hasGroq     = !!process.env.GROQ_API_KEY;
    const hasOllama   = !!process.env.OLLAMA_BASE_URL || !!process.env.OLLAMA_ENABLED;
    const hasClaude   = !!process.env.ANTHROPIC_API_KEY;

    const list: BackendId[] = [];

    // CRITICAL and HIGH — use cheap but fast backends, Sonnet as escalation
    // LOW and MEDIUM — try every cheap option before spending on Claude
    if (hasCerebras) list.push('cerebras');
    if (hasGroq)     list.push('groq');

    if (severity === 'LOW' || severity === 'MEDIUM') {
      if (hasOllama) list.push('ollama');
      if (hasClaude) list.push('claude-haiku');
    }

    if (hasClaude) list.push('claude-sonnet'); // Always last resort

    return list;
  }

  // ============================================================================
  // BACKEND CALLERS — one per provider, all return { text, model, latencyMs }
  // ============================================================================

  private async callCerebras(systemPrompt: string, userPrompt: string): Promise<BackendResult> {
    const startedAt = Date.now();
    const apiKey = process.env.CEREBRAS_API_KEY!;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHEAP_BACKEND_TIMEOUT_MS);

    try {
      const res = await fetch(`${CEREBRAS_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: CEREBRAS_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: MAX_TOKENS,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`Cerebras ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const data = await res.json() as { choices: Array<{ message: { content: string } }> };
      return {
        text:      data.choices?.[0]?.message?.content ?? '',
        model:     CEREBRAS_MODEL,
        latencyMs: Date.now() - startedAt,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async callGroq(systemPrompt: string, userPrompt: string): Promise<BackendResult> {
    const startedAt = Date.now();
    const apiKey = process.env.GROQ_API_KEY!;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHEAP_BACKEND_TIMEOUT_MS);

    try {
      const res = await fetch(`${GROQ_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL_FAST,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: MAX_TOKENS,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const data = await res.json() as { choices: Array<{ message: { content: string } }> };
      return {
        text:      data.choices?.[0]?.message?.content ?? '',
        model:     GROQ_MODEL_FAST,
        latencyMs: Date.now() - startedAt,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async callOllama(systemPrompt: string, userPrompt: string): Promise<BackendResult> {
    const startedAt = Date.now();
    const baseUrl = process.env.OLLAMA_BASE_URL || OLLAMA_DEFAULT_BASE_URL;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OLLAMA_BACKEND_TIMEOUT_MS);

    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: AI_MODEL_GEMMA,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: MAX_TOKENS,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const data = await res.json() as { choices: Array<{ message: { content: string } }> };
      return {
        text:      data.choices?.[0]?.message?.content ?? '',
        model:     AI_MODEL_GEMMA,
        latencyMs: Date.now() - startedAt,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async callClaude(
    systemPrompt: string,
    userPrompt: string,
    modelName: string,
  ): Promise<BackendResult> {
    const startedAt = Date.now();
    const response = await this.anthropicClient.messages.create({
      model:      modelName,
      max_tokens: MAX_TOKENS,
      system:     systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';
    return {
      text,
      model:     modelName,
      latencyMs: Date.now() - startedAt,
    };
  }

  private async callBackend(
    id: BackendId,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<BackendResult> {
    switch (id) {
      case 'cerebras':       return this.callCerebras(systemPrompt, userPrompt);
      case 'groq':           return this.callGroq(systemPrompt, userPrompt);
      case 'ollama':         return this.callOllama(systemPrompt, userPrompt);
      case 'claude-haiku':   return this.callClaude(systemPrompt, userPrompt, AI_MODEL_ROUTINE);
      case 'claude-sonnet':  return this.callClaude(systemPrompt, userPrompt, AI_MODEL_HEAVY);
    }
  }

  // ============================================================================
  // PARSE + VALIDATE — strip fences, parse JSON, check shape
  // ============================================================================

  private parseResponse(rawText: string): RawDiagnosis | null {
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;

    if (
      typeof obj.rootCause !== 'string' ||
      !['HIGH', 'MEDIUM', 'LOW'].includes(obj.confidence as string) ||
      !Array.isArray(obj.recommendedActions) ||
      typeof obj.reasoning !== 'string'
    ) {
      return null;
    }

    return {
      rootCause:          obj.rootCause,
      confidence:         obj.confidence as DiagnosisConfidence,
      recommendedActions: obj.recommendedActions as PlaybookAction[],
      reasoning:          obj.reasoning,
    };
  }

  // ============================================================================
  // DIAGNOSE — main public method, orchestrates tiered routing
  // ============================================================================

  async diagnose(incident: Incident, context: DiagnosisContext): Promise<Diagnosis> {
    const startedAt = Date.now();
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt   = this.buildUserPrompt(incident, context);
    const backends     = this.pickBackends(incident.severity);

    const fallback = (reason: string, modelUsed: string): Diagnosis => ({
      incidentId:         incident.id,
      rootCause:          'Diagnosis failed — defaulting to safe notification',
      confidence:         'LOW',
      recommendedActions: ['NOTIFY_ONLY'],
      reasoning:          reason,
      modelUsed,
      latencyMs:          Date.now() - startedAt,
      timestamp:          new Date().toISOString(),
    });

    if (backends.length === 0) {
      return fallback('No model backend configured', 'none');
    }

    // Global timeout for the entire diagnosis (all backends combined)
    const globalDeadline = Date.now() + DIAGNOSIS_TIMEOUT_MS;

    const attemptFailures: string[] = [];
    let lastParsedResult: { parsed: RawDiagnosis; backend: BackendId; model: string; latencyMs: number } | null = null;

    for (const backendId of backends) {
      if (Date.now() > globalDeadline) {
        attemptFailures.push(`${backendId}: global timeout reached, skipping`);
        break;
      }

      try {
        const result = await this.callBackend(backendId, systemPrompt, userPrompt);
        const parsed = this.parseResponse(result.text);

        if (!parsed) {
          attemptFailures.push(`${backendId}(${result.model}): parse failed`);
          continue; // Try next backend
        }

        // For CRITICAL incidents, a LOW-confidence cheap-model diagnosis is not good enough.
        // Escalate to Claude Sonnet for a second opinion.
        const isCritical = incident.severity === 'CRITICAL';
        const isCheapBackend = backendId !== 'claude-sonnet';
        if (isCritical && isCheapBackend && parsed.confidence === 'LOW') {
          attemptFailures.push(`${backendId}(${result.model}): LOW confidence on CRITICAL, escalating`);
          lastParsedResult = { parsed, backend: backendId, model: result.model, latencyMs: result.latencyMs };
          continue; // Try next backend (ideally Claude)
        }

        // Success — return the diagnosis from this backend
        return {
          incidentId:         incident.id,
          rootCause:          parsed.rootCause,
          confidence:         parsed.confidence,
          recommendedActions: parsed.recommendedActions,
          reasoning:          parsed.reasoning,
          modelUsed:          result.model,
          latencyMs:          result.latencyMs,
          timestamp:          new Date().toISOString(),
        };

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        attemptFailures.push(`${backendId}: ${msg.substring(0, 100)}`);
        continue; // Try next backend
      }
    }

    // If we got a valid parse but kept escalating (CRITICAL + LOW), use the last parsed result
    if (lastParsedResult) {
      return {
        incidentId:         incident.id,
        rootCause:          lastParsedResult.parsed.rootCause,
        confidence:         lastParsedResult.parsed.confidence,
        recommendedActions: lastParsedResult.parsed.recommendedActions,
        reasoning:          `${lastParsedResult.parsed.reasoning} [Note: escalation backends also failed]`,
        modelUsed:          lastParsedResult.model,
        latencyMs:          lastParsedResult.latencyMs,
        timestamp:          new Date().toISOString(),
      };
    }

    // Complete failure — return safe fallback
    return fallback(
      `All backends failed: ${attemptFailures.join(' | ')}`,
      backends[backends.length - 1] ?? 'none',
    );
  }
}
