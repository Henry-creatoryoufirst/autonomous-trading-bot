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

export type MacroRegime = 'BULL' | 'RANGING' | 'BEAR';

export class AlphaReviewer {
  private client: Anthropic | null = null;
  private model: string = AI_MODEL_ROUTINE;
  private enabled = false;
  private callsCompleted = 0;
  private callErrors = 0;
  private cumulativeInputTokens = 0;
  private cumulativeOutputTokens = 0;
  /**
   * 2026-05-14 (max-out-current-system): macro regime context for the
   * Reviewer prompt. signal-service computes this every 5min; agent-v3.2.ts
   * pushes it via setRegime() whenever currentMacroRegime updates.
   *
   * Why this matters: the Reviewer was rejecting valid micro signals
   * (BNKR/BUY_PRESSURE conf 0.62, AIXBT/VOLUME_SPIKE conf 0.62) because
   * the 1h price action was DOWN on those tokens. Without macro context,
   * the Reviewer can't distinguish "buy-the-dip in a bull market"
   * (actionable) from "catching a falling knife in a bear" (correctly WAIT).
   * Feeding regime in lets the Reviewer calibrate its confluence bar.
   */
  private currentRegime: MacroRegime = 'RANGING';
  private regimeScore: number = 0;
  private regimeUpdatedAt: string = new Date().toISOString();

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

  /**
   * Push the latest macro regime into the Reviewer's context. Called from
   * agent-v3.2.ts whenever signal-service refreshes intel (every ~5min).
   * Cheap (just sets fields); call as often as needed.
   */
  setRegime(regime: MacroRegime, score: number = 0): void {
    this.currentRegime = regime;
    this.regimeScore = score;
    this.regimeUpdatedAt = new Date().toISOString();
  }

  getStats() {
    return {
      enabled: this.enabled,
      model: this.model,
      callsCompleted: this.callsCompleted,
      callErrors: this.callErrors,
      cumulativeInputTokens: this.cumulativeInputTokens,
      cumulativeOutputTokens: this.cumulativeOutputTokens,
      currentRegime: this.currentRegime,
      regimeScore: this.regimeScore,
      regimeUpdatedAt: this.regimeUpdatedAt,
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

    // 2026-05-14: regime-aware calibration. The Reviewer was rejecting
    // every micro signal because the 1h price action contradicted (proper
    // behavior in BEAR, over-conservative in BULL). Inject macro regime so
    // the model can scale its confluence bar to what the market is doing.
    const regimeBlock = this.buildRegimeBlock();

    return `You are reviewing a real-time trading signal on Base (Coinbase L2). Decide whether to BUY, WAIT, or PASS.

CONTEXT:
The bot's Alpha Watcher fired a ${t.type} trigger on ${t.symbol} (${direction}).
We are looking for setups likely to reach +5% within 30 minutes; stop is -3%.

${regimeBlock}

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
- BUY: Strong directional setup. Multiple signals align. Microstructure is flowing in the trigger's direction. Likely to reach +5% within 30 min. CALIBRATE THE BAR TO REGIME (recalibrated 2026-05-15 for the quality-asset cohort — BTC/ETH/XRP/LTC/LINK/ADA/SOL have higher signal-to-noise on TA than meme/AI tokens): in BULL, 2 of 3 confluence factors aligning is enough; in RANGING, 2 of 3 with macro alignment (1h matching trigger direction); in BEAR, only call BUY when most signals scream and 1h is also positive.
- WAIT: Setup is real but unclear. Counter-indicators present (e.g., 5-min momentum already extended, or volume spiking but buy ratio mixed). Check again next cycle.
- PASS: Trigger fired but the broader microstructure contradicts (e.g., VOLUME_SPIKE on a token with 30% buy ratio = sellers exiting). Or single-signal trigger with no confluence (VOLUME_SPIKE alone has historically zero precision — needs another signal to be actionable).

Respond with JSON only, no other text:
{"verdict": "BUY" | "WAIT" | "PASS", "confidence": 0.0-1.0, "reasoning": "<one short sentence, max 20 words>"}`;
  }

  /**
   * The MACRO REGIME block injected into the Reviewer prompt. Specific
   * guidance per regime so the model knows when to be aggressive vs
   * defensive. Without this, Reviewer treats every signal identically
   * regardless of whether the broader market is rallying or falling.
   */
  private buildRegimeBlock(): string {
    const guidance =
      this.currentRegime === 'BULL'
        ? 'BULL — broader market is risk-on. A LONG-side trigger that has 2 of 3 confluence factors aligning is actionable. Buy-the-dip is in play; a -1% 1h on a token can be a buying opportunity if microstructure confirms (rising buy ratio + volume spike).'
        : this.currentRegime === 'BEAR'
          ? "BEAR — broader market is risk-off. Be DEFENSIVE. Only call BUY when most confluence factors align AND 1h is positive AND volume is multi-x baseline. Buy-the-dip rallies in bear markets are typically traps. When in doubt, WAIT or PASS."
          // 2026-05-15: relaxed RANGING from "3 of 3 confluence" → "2 of 3 with
          // macro alignment" for the quality-asset pivot. Quality coins range
          // most of the time; demanding 3-of-3 in RANGING produced near-zero
          // entries. The macro-alignment constraint (1h matching trigger
          // direction) replaces strict 3-of-3 as the false-positive guard.
          : 'RANGING — no clear macro direction. Quality cohort spends most time here. Require 2 of 3 confluence factors AND macro alignment: the 1h price move must match the trigger direction (rising for BUY triggers, falling for SELL triggers). Slight 1h pullbacks are OK if 5-min momentum is clearly turning back up. Do not chase parabolic moves in either direction.';
    return `MACRO REGIME (from signal-service, refreshed every ~5min):
- Regime: ${this.currentRegime} (score ${this.regimeScore.toFixed(0)})
- ${guidance}`;
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
