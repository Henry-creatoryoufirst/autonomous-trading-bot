/**
 * NVR-SPEC-024 — askAI adapter for the v22 Pattern Runtime
 *
 * The runtime injects this function into ConfirmContext so patterns can ask
 * AI a focused conviction question without reaching into bot internals
 * (provider selection, retries, telemetry). It's a thin adapter over the
 * existing model-client (src/core/services/model-client.ts) which already
 * supports Groq, Cerebras, DeepInfra, Ollama, and Anthropic.
 *
 * Tier routing:
 *   "cheap" (default)
 *     → Groq (llama-3.1-8b-instant, ~300ms, ~$0.0001/call)
 *     → Anthropic Haiku fallback when GROQ_API_KEY is missing
 *
 *   "heavy"
 *     → Anthropic Sonnet (~3s, ~$0.005/call)
 *     → No fallback. Heavy tier means we're paying for the best.
 *
 * Per SPEC-024's cost model: ~60 confirm() calls per month at ~$0.0001 each
 * ≈ $0.006/month. Effectively free. The ratio matters — the cheap tier
 * has to be the default because the trigger window is short.
 *
 * Design notes:
 *   - Errors propagate. The pattern's confirm() wraps this call in a 1.5s
 *     timeout via Promise.race and treats throws as "veto" (return null).
 *     That's the right place for fail-closed behavior — not here.
 *   - DI via the deps shape (callGroqImpl / callAnthropicImpl) so unit
 *     tests don't need vi.mock incantations.
 */

import type Anthropic from "@anthropic-ai/sdk";
import {
  callGroq,
  callAnthropic,
  isGroqAvailable,
  type ModelRequestOptions,
  type ModelResponse,
} from "../services/model-client.js";
import { AI_MODEL_HEAVY, AI_MODEL_ROUTINE } from "../config/constants.js";
import type { AskAIOptions } from "./types.js";

export interface AskAIDeps {
  /** Anthropic SDK client. Required for the heavy tier and as the
   *  cheap-tier fallback when Groq is unavailable. */
  anthropic?: Anthropic;
  /** Logger. Defaults to console.warn for fallbacks/errors. */
  log?: (msg: string) => void;
  /** Default timeout for cheap-tier calls (ms). Defaults to 1500. */
  cheapTimeoutMs?: number;
  /** Default timeout for heavy-tier calls (ms). Defaults to 8000. */
  heavyTimeoutMs?: number;

  // ── DI overrides for tests ───────────────────────────────────────────
  callGroqImpl?: (opts: ModelRequestOptions) => Promise<ModelResponse>;
  callAnthropicImpl?: (
    opts: ModelRequestOptions,
    client: Anthropic,
    model: string,
  ) => Promise<ModelResponse>;
  isGroqAvailableImpl?: () => Promise<boolean>;
}

export type AskAIFn = (prompt: string, opts?: AskAIOptions) => Promise<string>;

/**
 * Build an `askAI` function suitable for injection into RuntimeDeps.askAI.
 *
 * The returned function:
 *   1. Builds a single-user-message ModelRequestOptions from the prompt.
 *   2. Routes by tier — cheap → Groq (fall back to Haiku), heavy → Sonnet.
 *   3. Returns the response text. On terminal failure throws — the
 *      pattern's confirm() wraps this with the veto policy.
 */
export function createAskAI(deps: AskAIDeps = {}): AskAIFn {
  const log = deps.log ?? ((m) => console.warn(`[ask-ai] ${m}`));
  const cheapTimeoutMs = deps.cheapTimeoutMs ?? 1500;
  const heavyTimeoutMs = deps.heavyTimeoutMs ?? 8000;
  const callGroqFn = deps.callGroqImpl ?? callGroq;
  const callAnthropicFn = deps.callAnthropicImpl ?? callAnthropic;
  const isGroqAvailableFn = deps.isGroqAvailableImpl ?? isGroqAvailable;

  return async (prompt: string, opts?: AskAIOptions) => {
    const tier = opts?.tier ?? "cheap";
    const maxTokens = opts?.maxTokens ?? 200;

    const requestOpts: ModelRequestOptions = {
      messages: [{ role: "user", content: prompt }],
      maxTokens,
      timeoutMs: tier === "cheap" ? cheapTimeoutMs : heavyTimeoutMs,
    };

    if (tier === "cheap") {
      const groqUp = await isGroqAvailableFn().catch(() => false);
      if (groqUp) {
        try {
          const r = await callGroqFn(requestOpts);
          return r.text;
        } catch (e) {
          log(
            `Groq cheap-tier failed (${(e as Error).message?.slice(0, 80)}); ` +
              `falling back to Haiku`,
          );
          // Fall through to Anthropic Haiku.
        }
      }
    }

    if (!deps.anthropic) {
      throw new Error(
        `ask-ai: ${tier} tier requested but Anthropic client not configured ` +
          `(and Groq unavailable for cheap-tier). Set ANTHROPIC_API_KEY in env ` +
          `and pass an Anthropic instance to createAskAI(deps).`,
      );
    }

    const model = tier === "heavy" ? AI_MODEL_HEAVY : AI_MODEL_ROUTINE;
    const r = await callAnthropicFn(requestOpts, deps.anthropic, model);
    return r.text;
  };
}

// ----------------------------------------------------------------------------
// Internals exposed for tests
// ----------------------------------------------------------------------------

export const _testInternals = {
  /** Default cheap-tier timeout matches the 1.5s confirm() race in the
   *  post-volatility-long pattern. Don't drift these without updating
   *  CONFIRM_TIMEOUT_MS too. */
  defaultCheapTimeoutMs: 1500,
  defaultHeavyTimeoutMs: 8000,
  defaultMaxTokens: 200,
};
