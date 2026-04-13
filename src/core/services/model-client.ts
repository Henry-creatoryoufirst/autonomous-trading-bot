/**
 * NVR Capital — Model Client Abstraction (v21.14)
 *
 * Unified interface for AI model backends:
 * - Anthropic Claude (Sonnet/Haiku) via @anthropic-ai/sdk
 * - Google Gemma 4 26B-A4B via Ollama (OpenAI-compatible endpoint)
 * - Groq cloud inference (OpenAI-compatible, near-zero cost, no local GPU needed)
 *
 * Routing priority for routine cycles: Groq → Ollama → Claude Haiku
 * Supports phased rollout: shadow → supervised → graduated → production.
 * Falls back to Claude when cheaper backends are unreachable.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  AI_MODEL_HEAVY,
  AI_MODEL_ROUTINE,
  AI_MODEL_GEMMA,
  OLLAMA_DEFAULT_BASE_URL,
  OLLAMA_HEALTH_CHECK_TIMEOUT_MS,
  OLLAMA_REQUEST_TIMEOUT_MS,
  OLLAMA_HEALTH_CHECK_INTERVAL_MS,
  GEMMA_ESCALATION_CONFIG,
  GROQ_BASE_URL,
  GROQ_MODEL_FAST,
  GROQ_REQUEST_TIMEOUT_MS,
} from '../config/constants.js';

// ============================================================================
// TYPES
// ============================================================================

/** Unified response from any model backend */
export interface ModelResponse {
  text: string;
  model: string;
  backend: 'anthropic' | 'ollama' | 'groq';
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
}

/** Request options (shared across backends) */
export interface ModelRequestOptions {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  maxTokens: number;
  jsonMode?: boolean;
  timeoutMs?: number;
}

/** Model routing tiers */
export type ModelTier = 'GROQ' | 'GEMMA' | 'HAIKU' | 'SONNET';

/** Gemma operating mode */
export type GemmaMode = 'disabled' | 'shadow' | 'supervised' | 'graduated' | 'production';

/** Per-call telemetry */
export interface ModelTelemetry {
  timestamp: string;
  tier: ModelTier;
  model: string;
  backend: 'anthropic' | 'ollama' | 'groq';
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  success: boolean;
  escalated: boolean;
  escalationReason?: string;
  shadowComparison?: {
    gemmaText: string;
    claudeText: string;
    agreed: boolean;
    gemmaLatencyMs: number;
    claudeLatencyMs: number;
  };
}

interface RoutingDecision {
  tier: ModelTier;
  model: string;
  backend: 'anthropic' | 'ollama' | 'groq';
  reason: string;
}

/** Context needed for routing and escalation decisions */
export interface ModelCallContext {
  needsSonnet: boolean;
  portfolioValue?: number;
}

// ============================================================================
// OLLAMA HEALTH CHECK (cached)
// ============================================================================

let _ollamaAvailable: boolean | null = null;
let _ollamaCheckedAt = 0;

function getOllamaBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL || OLLAMA_DEFAULT_BASE_URL;
}

/**
 * Check if Ollama is reachable. Caches result for OLLAMA_HEALTH_CHECK_INTERVAL_MS.
 */
export async function isOllamaAvailable(): Promise<boolean> {
  const now = Date.now();
  if (_ollamaAvailable !== null && (now - _ollamaCheckedAt) < OLLAMA_HEALTH_CHECK_INTERVAL_MS) {
    return _ollamaAvailable;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OLLAMA_HEALTH_CHECK_TIMEOUT_MS);
    const res = await fetch(`${getOllamaBaseUrl()}/v1/models`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    _ollamaAvailable = res.ok;
  } catch {
    _ollamaAvailable = false;
  }
  _ollamaCheckedAt = now;
  return _ollamaAvailable;
}

/** Reset cached availability (for testing or forced re-check) */
export function resetOllamaCache(): void {
  _ollamaAvailable = null;
  _ollamaCheckedAt = 0;
}

// ============================================================================
// OLLAMA BACKEND (raw fetch, no npm dependency)
// ============================================================================

/**
 * Call Ollama's OpenAI-compatible chat completions endpoint.
 */
export async function callOllama(options: ModelRequestOptions): Promise<ModelResponse> {
  const startMs = Date.now();
  const baseUrl = getOllamaBaseUrl();

  // Build messages — prepend JSON enforcement system message
  const messages = [
    {
      role: 'system' as const,
      content: 'Respond ONLY with a valid JSON array of trade decisions. No markdown fences, no prose, no explanation outside the JSON. If no action needed, return [{"action":"HOLD","fromToken":"NONE","toToken":"NONE","amountUSD":0,"reasoning":"no action"}].',
    },
    ...options.messages,
  ];

  const body: Record<string, unknown> = {
    model: AI_MODEL_GEMMA,
    messages,
    stream: false,
    temperature: 0.1,
    max_tokens: options.maxTokens,
  };

  if (options.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? OLLAMA_REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = data.choices?.[0]?.message?.content ?? '';
    const latencyMs = Date.now() - startMs;

    return {
      text,
      model: AI_MODEL_GEMMA,
      backend: 'ollama',
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      latencyMs,
    };
  } catch (err) {
    clearTimeout(timer);
    // Mark Ollama as unavailable on any error
    _ollamaAvailable = false;
    _ollamaCheckedAt = Date.now();
    throw err;
  }
}

// ============================================================================
// GROQ BACKEND (OpenAI-compatible, cloud-hosted, no local GPU required)
// ============================================================================

/**
 * Check if Groq is available (simply verifies GROQ_API_KEY is set).
 * No network round-trip needed — Groq is a managed API with 99.9% uptime.
 */
export async function isGroqAvailable(): Promise<boolean> {
  return typeof process.env.GROQ_API_KEY === 'string' && process.env.GROQ_API_KEY.length > 0;
}

/**
 * Call Groq's OpenAI-compatible chat completions endpoint.
 * Same request/response shape as callOllama() — only base URL, auth, and model differ.
 */
export async function callGroq(options: ModelRequestOptions): Promise<ModelResponse> {
  const startMs = Date.now();
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set');
  }

  // Build messages — prepend JSON enforcement system message
  const messages = [
    {
      role: 'system' as const,
      content: 'Respond ONLY with a valid JSON array of trade decisions. No markdown fences, no prose, no explanation outside the JSON. If no action needed, return [{"action":"HOLD","fromToken":"NONE","toToken":"NONE","amountUSD":0,"reasoning":"no action"}].',
    },
    ...options.messages,
  ];

  const body: Record<string, unknown> = {
    model: GROQ_MODEL_FAST,
    messages,
    stream: false,
    temperature: 0.1,
    max_tokens: options.maxTokens,
  };

  if (options.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? GROQ_REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${GROQ_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`Groq returned ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = data.choices?.[0]?.message?.content ?? '';
    const latencyMs = Date.now() - startMs;

    return {
      text,
      model: GROQ_MODEL_FAST,
      backend: 'groq',
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      latencyMs,
    };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ============================================================================
// ANTHROPIC BACKEND (wraps existing SDK)
// ============================================================================

/**
 * Call Anthropic Claude API and normalize to ModelResponse.
 */
export async function callAnthropic(
  options: ModelRequestOptions,
  client: Anthropic,
  model: string,
): Promise<ModelResponse> {
  const startMs = Date.now();

  // Anthropic SDK uses 'user'/'assistant' messages only (no 'system' in messages array)
  // The existing bot sends everything in a single 'user' message
  const messages = options.messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const response = await client.messages.create({
    model,
    max_tokens: options.maxTokens,
    messages,
  });

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  const latencyMs = Date.now() - startMs;

  return {
    text,
    model,
    backend: 'anthropic',
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
    latencyMs,
  };
}

// ============================================================================
// ROUTING
// ============================================================================

/**
 * Decide which model tier to use based on context and mode.
 */
export async function resolveModelRouting(
  context: ModelCallContext,
  gemmaMode: GemmaMode,
): Promise<RoutingDecision> {
  // Disabled = existing behavior
  if (gemmaMode === 'disabled') {
    return context.needsSonnet
      ? { tier: 'SONNET', model: AI_MODEL_HEAVY, backend: 'anthropic', reason: 'Gemma disabled, using Sonnet' }
      : { tier: 'HAIKU', model: AI_MODEL_ROUTINE, backend: 'anthropic', reason: 'Gemma disabled, using Haiku' };
  }

  // Difficult markets always get Sonnet
  if (context.needsSonnet) {
    return { tier: 'SONNET', model: AI_MODEL_HEAVY, backend: 'anthropic', reason: 'Difficult market → Sonnet required' };
  }

  // Routine cycle: Groq → Ollama → Haiku
  // Groq first — it's a managed cloud API, no health check latency needed
  const groqReady = await isGroqAvailable();
  if (groqReady) {
    return { tier: 'GROQ', model: GROQ_MODEL_FAST, backend: 'groq', reason: 'Routine cycle → Groq (GROQ_API_KEY set)' };
  }

  // Groq not configured — try local Ollama
  const ollamaReady = await isOllamaAvailable();
  if (ollamaReady) {
    return { tier: 'GEMMA', model: AI_MODEL_GEMMA, backend: 'ollama', reason: 'Routine cycle → Gemma (no Groq key)' };
  }

  // Both cheap backends unavailable — fall back to Claude Haiku
  console.warn('[Model] Groq not configured and Ollama unreachable, falling back to Claude Haiku');
  return { tier: 'HAIKU', model: AI_MODEL_ROUTINE, backend: 'anthropic', reason: 'Groq not set + Ollama unreachable → Haiku fallback' };
}

// ============================================================================
// ESCALATION
// ============================================================================

interface EscalationResult {
  shouldEscalate: boolean;
  reason?: string;
}

/**
 * Check if a Gemma response should be escalated to Claude QC.
 * Pure function — no I/O.
 */
export function checkEscalation(
  responseText: string,
  portfolioValue: number,
  gemmaMode: GemmaMode,
): EscalationResult {
  const config = GEMMA_ESCALATION_CONFIG;

  // Try to parse the response
  let decisions: Array<{ action?: string; amountUSD?: number; reasoning?: string }>;
  try {
    let text = responseText.trim();
    // Strip markdown fences
    if (text.startsWith('```')) {
      text = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }
    const parsed = JSON.parse(text);
    decisions = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return { shouldEscalate: true, reason: 'Malformed JSON from Gemma' };
  }

  // All HOLDs — no escalation needed
  const nonHoldActions = decisions.filter(d => d.action && d.action !== 'HOLD');
  if (nonHoldActions.length === 0) return { shouldEscalate: false };

  // Too many concurrent trades
  if (nonHoldActions.length >= config.maxConcurrentTrades) {
    return { shouldEscalate: true, reason: `${nonHoldActions.length} concurrent trades exceed limit of ${config.maxConcurrentTrades}` };
  }

  // In supervised mode, ALL trades escalate
  if (gemmaMode === 'supervised') {
    return { shouldEscalate: true, reason: 'Supervised mode — all trades require Claude QC' };
  }

  // In graduated mode, all SELLs escalate
  if (gemmaMode === 'graduated') {
    const hasSell = nonHoldActions.some(d => d.action === 'SELL');
    if (hasSell) {
      return { shouldEscalate: true, reason: 'Graduated mode — SELL actions require Claude QC' };
    }
  }

  // Check trade size thresholds
  for (const d of nonHoldActions) {
    const amt = d.amountUSD ?? 0;
    if (amt > config.maxTradeAmountUSD) {
      return { shouldEscalate: true, reason: `Trade $${amt.toFixed(0)} exceeds $${config.maxTradeAmountUSD} threshold` };
    }
    if (portfolioValue > 0 && (amt / portfolioValue) * 100 > config.maxTradePercentOfPortfolio) {
      return {
        shouldEscalate: true,
        reason: `Trade $${amt.toFixed(0)} is ${((amt / portfolioValue) * 100).toFixed(1)}% of portfolio (limit: ${config.maxTradePercentOfPortfolio}%)`,
      };
    }
  }

  // Check uncertainty keywords in reasoning
  for (const d of decisions) {
    const reasoning = (d.reasoning ?? '').toLowerCase();
    for (const keyword of config.uncertaintyKeywords) {
      if (reasoning.includes(keyword)) {
        return { shouldEscalate: true, reason: `Uncertainty keyword "${keyword}" in reasoning` };
      }
    }
  }

  return { shouldEscalate: false };
}

// ============================================================================
// TELEMETRY
// ============================================================================

const MAX_TELEMETRY_ENTRIES = 1000;
const _telemetryBuffer: ModelTelemetry[] = [];

/** Log a telemetry entry */
export function logModelTelemetry(entry: ModelTelemetry): void {
  _telemetryBuffer.push(entry);
  if (_telemetryBuffer.length > MAX_TELEMETRY_ENTRIES) {
    _telemetryBuffer.shift();
  }

  // Console output
  const status = entry.escalated ? `ESCALATED: ${entry.escalationReason}` : 'OK';
  console.log(
    `[Model] ${entry.tier}/${entry.model} (${entry.backend}) | ${entry.latencyMs}ms | ${entry.inputTokens}→${entry.outputTokens} tokens | ${status}`
  );
}

/** Get recent telemetry entries */
export function getModelTelemetry(): readonly ModelTelemetry[] {
  return _telemetryBuffer;
}

/** Get Gemma/Claude agreement rate from shadow mode comparisons */
export function getAgreementRate(): { total: number; agreed: number; rate: number } {
  const shadows = _telemetryBuffer.filter(t => t.shadowComparison);
  const agreed = shadows.filter(t => t.shadowComparison!.agreed).length;
  return {
    total: shadows.length,
    agreed,
    rate: shadows.length > 0 ? agreed / shadows.length : 0,
  };
}

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

/**
 * Top-level model call with shadow/supervised/graduated/production mode handling.
 *
 * This replaces the direct `anthropic.messages.create()` call in agent-v3.2.ts.
 * Returns the model response + telemetry entry for logging.
 */
export async function callModelWithShadow(
  options: ModelRequestOptions,
  context: ModelCallContext,
  anthropicClient: Anthropic,
  gemmaMode: GemmaMode,
): Promise<{ response: ModelResponse; telemetry: ModelTelemetry }> {
  const routing = await resolveModelRouting(context, gemmaMode);

  // ── DISABLED MODE: pure Claude, existing behavior ──
  if (gemmaMode === 'disabled' || routing.backend === 'anthropic') {
    const response = await callAnthropic(options, anthropicClient, routing.model);
    const telemetry: ModelTelemetry = {
      timestamp: new Date().toISOString(),
      tier: routing.tier,
      model: routing.model,
      backend: 'anthropic',
      latencyMs: response.latencyMs,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      success: true,
      escalated: false,
    };
    return { response, telemetry };
  }

  // ── SHADOW MODE: call both, use Claude's decision ──
  if (gemmaMode === 'shadow') {
    return callShadowMode(options, context, anthropicClient);
  }

  // ── GEMMA-PRIMARY MODES: supervised / graduated / production ──
  return callGemmaPrimary(options, context, anthropicClient, gemmaMode);
}

// ============================================================================
// SHADOW MODE
// ============================================================================

async function callShadowMode(
  options: ModelRequestOptions,
  context: ModelCallContext,
  anthropicClient: Anthropic,
): Promise<{ response: ModelResponse; telemetry: ModelTelemetry }> {
  // Claude is authoritative; cheap model (Groq preferred, Ollama fallback) runs in parallel for comparison
  const claudeModel = context.needsSonnet ? AI_MODEL_HEAVY : AI_MODEL_ROUTINE;

  // Select shadow backend: Groq if key is set, else Ollama
  const groqReady = await isGroqAvailable();
  const cheapCall = groqReady ? callGroq(options) : callOllama(options);
  const shadowBackendLabel = groqReady ? 'Groq' : 'Gemma';

  const [claudeResult, gemmaResult] = await Promise.allSettled([
    callAnthropic(options, anthropicClient, claudeModel),
    cheapCall,
  ]);

  const claudeResponse = claudeResult.status === 'fulfilled' ? claudeResult.value : null;
  const gemmaResponse = gemmaResult.status === 'fulfilled' ? gemmaResult.value : null;

  if (!claudeResponse) {
    throw (claudeResult as PromiseRejectedResult).reason;
  }

  // Compare decisions (simple: same first action keyword?)
  let agreed = false;
  if (gemmaResponse) {
    try {
      const claudeAction = extractFirstAction(claudeResponse.text);
      const gemmaAction = extractFirstAction(gemmaResponse.text);
      agreed = claudeAction === gemmaAction;
    } catch {
      agreed = false;
    }
  }

  const telemetry: ModelTelemetry = {
    timestamp: new Date().toISOString(),
    tier: 'HAIKU',
    model: claudeModel,
    backend: 'anthropic',
    latencyMs: claudeResponse.latencyMs,
    inputTokens: claudeResponse.usage.inputTokens,
    outputTokens: claudeResponse.usage.outputTokens,
    success: true,
    escalated: false,
    shadowComparison: gemmaResponse ? {
      gemmaText: gemmaResponse.text.substring(0, 500),
      claudeText: claudeResponse.text.substring(0, 500),
      agreed,
      gemmaLatencyMs: gemmaResponse.latencyMs,
      claudeLatencyMs: claudeResponse.latencyMs,
    } : undefined,
  };

  if (gemmaResponse) {
    console.log(
      `[Shadow] Claude=${claudeResponse.latencyMs}ms ${shadowBackendLabel}=${gemmaResponse.latencyMs}ms | Agreement: ${agreed ? 'YES' : 'NO'}`
    );
  } else {
    console.log(`[Shadow] ${shadowBackendLabel} call failed, Claude-only this cycle`);
  }

  return { response: claudeResponse, telemetry };
}

// ============================================================================
// GEMMA-PRIMARY MODES (supervised / graduated / production)
// ============================================================================

async function callGemmaPrimary(
  options: ModelRequestOptions,
  context: ModelCallContext,
  anthropicClient: Anthropic,
  gemmaMode: GemmaMode,
): Promise<{ response: ModelResponse; telemetry: ModelTelemetry }> {
  let gemmaResponse: ModelResponse;

  // Determine which cheap backend to use based on routing
  const routing = await resolveModelRouting(context, gemmaMode);
  const useGroq = routing.backend === 'groq';
  const cheapBackendLabel = useGroq ? 'Groq' : 'Gemma';

  try {
    gemmaResponse = useGroq ? await callGroq(options) : await callOllama(options);
  } catch (err) {
    // Cheap backend failed — fall back to Claude
    console.warn(`[Model] ${cheapBackendLabel} failed (${(err as Error).message}), falling back to Claude`);
    const fallbackModel = context.needsSonnet ? AI_MODEL_HEAVY : AI_MODEL_ROUTINE;
    const response = await callAnthropic(options, anthropicClient, fallbackModel);
    const telemetry: ModelTelemetry = {
      timestamp: new Date().toISOString(),
      tier: context.needsSonnet ? 'SONNET' : 'HAIKU',
      model: fallbackModel,
      backend: 'anthropic',
      latencyMs: response.latencyMs,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      success: true,
      escalated: true,
      escalationReason: `${cheapBackendLabel} failed: ${(err as Error).message}`,
    };
    return { response, telemetry };
  }

  // Check if escalation is needed
  const portfolioValue = context.portfolioValue ?? 0;
  const escalation = checkEscalation(gemmaResponse.text, portfolioValue, gemmaMode);

  if (escalation.shouldEscalate) {
    console.log(`[Escalation] ${cheapBackendLabel}→Sonnet: ${escalation.reason}`);
    const claudeResponse = await callAnthropic(options, anthropicClient, AI_MODEL_HEAVY);
    const telemetry: ModelTelemetry = {
      timestamp: new Date().toISOString(),
      tier: 'SONNET',
      model: AI_MODEL_HEAVY,
      backend: 'anthropic',
      latencyMs: claudeResponse.latencyMs,
      inputTokens: claudeResponse.usage.inputTokens,
      outputTokens: claudeResponse.usage.outputTokens,
      success: true,
      escalated: true,
      escalationReason: escalation.reason,
    };
    return { response: claudeResponse, telemetry };
  }

  // Cheap backend response is good — use it
  const telemetry: ModelTelemetry = {
    timestamp: new Date().toISOString(),
    tier: routing.tier,
    model: gemmaResponse.model,
    backend: gemmaResponse.backend,
    latencyMs: gemmaResponse.latencyMs,
    inputTokens: gemmaResponse.usage.inputTokens,
    outputTokens: gemmaResponse.usage.outputTokens,
    success: true,
    escalated: false,
  };
  return { response: gemmaResponse, telemetry };
}

// ============================================================================
// HELPERS
// ============================================================================

/** Extract the first action from a trade decision JSON string */
function extractFirstAction(text: string): string {
  try {
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }
    const parsed = JSON.parse(cleaned);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr[0]?.action ?? 'UNKNOWN';
  } catch {
    return 'PARSE_ERROR';
  }
}
