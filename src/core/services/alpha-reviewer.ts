/**
 * NVR-SPEC-028 Phase 2: Alpha Reviewer
 *
 * The Reviewer is the gate between the Watcher's deterministic triggers
 * and capital deployment. The Watcher knows "something interesting is
 * happening" — the Reviewer judges "is this actionable RIGHT NOW".
 *
 * Architecture position:
 *   Watcher (deterministic)  → fires trigger
 *      ↓
 *   Reviewer (Haiku, this file) → packages microstructure into a curated
 *                                  prompt, gets BUY/WAIT/PASS verdict
 *      ↓
 *   Reflex (Phase 3)         → executes BUYs with hard stops/timers
 *
 * The Reviewer's job is judgment under uncertainty — exactly the thing
 * LLMs are good at. The Watcher's hindsight replay 2026-05-07 showed
 * VOLUME_SPIKE alone has 0% precision. The Reviewer should down-weight
 * solo VOLUME_SPIKE triggers and only call BUY when multiple signals
 * align (e.g., VOLUME_SPIKE + BUY_PRESSURE + WHALE_BUY all fired in the
 * same poll).
 *
 * Cost discipline:
 *   - One Haiku call per fired trigger. With cooldowns + threshold
 *     tuning, the Watcher fires ~5-30 triggers per day across the cohort.
 *   - At Haiku pricing (~$0.80/1M input, $4.00/1M output) and ~250
 *     input + 80 output tokens per call: roughly $0.0006 per review.
 *   - Daily budget: 30 triggers × $0.0006 = $0.018/day = $0.54/month.
 *     Well within the cost-audit envelope.
 *
 * Phase 1.5 paper-trade outcomes give us the truth signal: did the
 * Reviewer's BUY calls actually convert to +5% moves? Phase 4's outcome
 * learning loop will use this to weight Haiku's verdicts (e.g., if Haiku's
 * BUY calls hit at 25% vs the Watcher-alone baseline of 30%, the Reviewer
 * is hurting us — kill it. If 60%, Reviewer is the gate we need).
 */

import type Anthropic from '@anthropic-ai/sdk';
import { callAnthropic, type ModelResponse } from './model-client.js';
import { AI_MODEL_ROUTINE } from '../config/constants.js';
import type { AlphaTrigger } from './alpha-watcher.js';

// ============================================================================
// TYPES
// ============================================================================

export type ReviewVerdict = 'BUY' | 'WAIT' | 'PASS';

export interface TriggerReview {
  /** The verdict — gates Phase 3 reflex execution */
  verdict: ReviewVerdict;
  /** 0-1 confidence in the verdict; affects future weighting */
  confidence: number;
  /** Reviewer's one-line rationale (logged for outcome correlation) */
  reasoning: string;
  /** ISO timestamp of the review */
  reviewedAt: string;
  /** Model that produced the verdict */
  modelUsed: string;
  /** Token + latency footprint for cost tracking */
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** True if the parser had to fall back (response wasn't clean JSON) */
  parseFailed?: boolean;
}

// ============================================================================
// REVIEWER CLASS
// ============================================================================

export class AlphaReviewer {
  private client: Anthropic | null = null;
  private model: string = AI_MODEL_ROUTINE;
  private enabled = false;
  private callsCompleted = 0;
  private callErrors = 0;
  private cumulativeInputTokens = 0;
  private cumulativeOutputTokens = 0;

  /**
   * Initialize with the bot's Anthropic client. Called at startup from
   * agent-v3.2.ts. Idempotent — re-init replaces the client.
   */
  init(client: Anthropic | null, modelOverride?: string): void {
    this.client = client;
    if (modelOverride) this.model = modelOverride;
    this.enabled = client !== null;
  }

  isEnabled(): boolean {
    return this.enabled && this.client !== null;
  }

  getStats() {
    return {
      enabled: this.enabled,
      model: this.model,
      callsCompleted: this.callsCompleted,
      callErrors: this.callErrors,
      cumulativeInputTokens: this.cumulativeInputTokens,
      cumulativeOutputTokens: this.cumulativeOutputTokens,
    };
  }

  /**
   * Review a single trigger. Returns null if Reviewer is disabled (no
   * Anthropic client) or if the call errored — caller should treat null
   * as "no opinion" and fall back to the Watcher's raw signal.
   *
   * Bot's own internal cooldown/dedup happens at the Watcher level. By
   * the time a trigger reaches the Reviewer, it's already passed the
   * "should we even think about this" gate.
   */
  async review(trigger: AlphaTrigger): Promise<TriggerReview | null> {
    if (!this.client || !this.enabled) return null;

    const prompt = this.buildPrompt(trigger);
    let response: ModelResponse;
    try {
      response = await callAnthropic(
        { messages: [{ role: 'user', content: prompt }], maxTokens: 200 },
        this.client,
        this.model,
      );
      this.callsCompleted++;
      this.cumulativeInputTokens += response.usage.inputTokens ?? 0;
      this.cumulativeOutputTokens += response.usage.outputTokens ?? 0;
    } catch (e: any) {
      this.callErrors++;
      console.warn(`[AlphaReviewer] call failed for ${trigger.symbol}/${trigger.type}: ${e?.message ?? e}`);
      return null;
    }

    return this.parseResponse(response);
  }

  // --------------------------------------------------------------------------
  // PROMPT CONSTRUCTION
  // --------------------------------------------------------------------------

  private buildPrompt(t: AlphaTrigger): string {
    const s = t.snapshot;
    const direction = t.type === 'WHALE_SELL' ? 'SHORT-side signal'
      : t.type === 'LIQUIDITY_VACUUM' ? 'POSSIBLY-EXIT signal'
      : 'LONG-side signal';

    return `You are reviewing a real-time trading signal on Base (Coinbase L2). Decide whether to BUY, WAIT, or PASS.

CONTEXT:
The bot's Alpha Watcher fired a ${t.type} trigger on ${t.symbol} (${direction}).
We are looking for setups likely to reach +5% within 30 minutes; stop is -3%.

TRIGGER:
- Type: ${t.type}
- Strength: ${t.strength.toFixed(2)} (0-1 scale)
- Reason: ${t.reason}
- Pool: ${s.poolAddress}

MICROSTRUCTURE (current state):
- Price: $${s.priceUSD.toFixed(6)}
- 5-min change: ${s.priceChange5m >= 0 ? '+' : ''}${s.priceChange5m.toFixed(2)}%
- 1-hour change: ${s.priceChange1h >= 0 ? '+' : ''}${s.priceChange1h.toFixed(2)}%
- 1h volume: $${s.volume1hUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
- 24h volume: $${s.volume24hUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
- Volume rate vs 24h baseline: ${s.volumeSpikeRatio.toFixed(2)}× normal
- 1h transactions: ${s.buys1h} buys / ${s.sells1h} sells (${(s.buyRatio1h * 100).toFixed(0)}% buy ratio)
- Avg trade size: $${s.avgTradeSize1hUSD.toFixed(0)}
- Pool TVL: $${s.liquidityUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}

CRITERIA:
- BUY: Strong directional setup. Multiple signals align. Microstructure is flowing in the trigger's direction. Likely to reach +5% within 30 min.
- WAIT: Setup is real but unclear. Counter-indicators present (e.g., 5-min momentum already extended, or volume spiking but buy ratio mixed). Check again next cycle.
- PASS: Trigger fired but the broader microstructure contradicts (e.g., VOLUME_SPIKE on a token with 30% buy ratio = sellers exiting). Or single-signal trigger with no confluence (VOLUME_SPIKE alone has historically zero precision — needs another signal to be actionable).

Respond with JSON only, no other text:
{"verdict": "BUY" | "WAIT" | "PASS", "confidence": 0.0-1.0, "reasoning": "<one short sentence, max 20 words>"}`;
  }

  // --------------------------------------------------------------------------
  // RESPONSE PARSING
  // --------------------------------------------------------------------------

  private parseResponse(response: ModelResponse): TriggerReview {
    const fallback: TriggerReview = {
      verdict: 'PASS',
      confidence: 0,
      reasoning: 'parse failed — Reviewer response was not valid JSON',
      reviewedAt: new Date().toISOString(),
      modelUsed: response.model,
      inputTokens: response.usage.inputTokens ?? 0,
      outputTokens: response.usage.outputTokens ?? 0,
      latencyMs: response.latencyMs,
      parseFailed: true,
    };

    // Greedy match the largest JSON object in the response — Haiku occasionally
    // wraps JSON in markdown code fences or prepends a sentence even when asked not to.
    const match = response.text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;

    try {
      const parsed = JSON.parse(match[0]);
      const rawVerdict = String(parsed.verdict ?? 'PASS').toUpperCase();
      const verdict: ReviewVerdict =
        rawVerdict === 'BUY' || rawVerdict === 'WAIT' ? (rawVerdict as ReviewVerdict) : 'PASS';
      const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
      const reasoning = String(parsed.reasoning ?? '').slice(0, 200);
      return {
        verdict,
        confidence,
        reasoning,
        reviewedAt: new Date().toISOString(),
        modelUsed: response.model,
        inputTokens: response.usage.inputTokens ?? 0,
        outputTokens: response.usage.outputTokens ?? 0,
        latencyMs: response.latencyMs,
      };
    } catch {
      return fallback;
    }
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

export const alphaReviewer = new AlphaReviewer();
