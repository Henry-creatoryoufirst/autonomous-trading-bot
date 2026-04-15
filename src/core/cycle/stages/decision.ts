/**
 * Never Rest Capital — Cycle Stage: DECISION
 *
 * Phase 5b target. Extracts agent-v3.2.ts lines 6950–7010.
 *
 * Responsibilities:
 *   - Cash deployment context computation
 *   - AI trade decision call (Claude / Haiku / Groq based on tier)
 *   - Adversarial risk review
 *   - Decision list assembly (BUY/SELL/HOLD per token)
 *
 * Outputs on ctx:
 *   - ctx.decisions  populated with raw AI decisions before filtering
 *
 * DO NOT EXTRACT until Phase 5b session.
 */

import type { CycleContext } from '../../types/cycle.js';

export async function decisionStage(ctx: CycleContext): Promise<CycleContext> {
  throw new Error('[Phase 5b] decisionStage not yet extracted — monolith handles DECISION inline (L6950–7010)');
  return ctx;
}
