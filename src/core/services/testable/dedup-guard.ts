/**
 * Extracted trade dedup guard logic from agent-v3.2.ts for unit testing.
 * Window durations imported from the canonical DEDUP_WINDOWS bundle in
 * src/core/config/constants.ts (2026-05-15 dual-source cleanup) — the
 * previous local re-declarations risked silent drift on retunes.
 */

import { DEDUP_WINDOWS } from '../../config/constants.js';

const {
  SCALE_UP: SCALE_UP_DEDUP_WINDOW_MINUTES,
  SURGE: SURGE_DEDUP_WINDOW_MINUTES,
  FORCED_DEPLOY: FORCED_DEPLOY_DEDUP_WINDOW_MINUTES,
  MOMENTUM_EXIT: MOMENTUM_EXIT_DEDUP_WINDOW_MINUTES,
  NORMAL: NORMAL_DEDUP_WINDOW_MINUTES,
  DECEL_TRIM: DECEL_TRIM_DEDUP_WINDOW_MINUTES,
} = DEDUP_WINDOWS;

export {
  SCALE_UP_DEDUP_WINDOW_MINUTES,
  SURGE_DEDUP_WINDOW_MINUTES,
  FORCED_DEPLOY_DEDUP_WINDOW_MINUTES,
  MOMENTUM_EXIT_DEDUP_WINDOW_MINUTES,
  NORMAL_DEDUP_WINDOW_MINUTES,
  DECEL_TRIM_DEDUP_WINDOW_MINUTES,
};

export interface TradeDecision {
  action: 'BUY' | 'SELL';
  fromToken?: string;
  toToken?: string;
  reasoning?: string;
  amountUSD?: number;
}

/**
 * Extract the dedup key components from a trade decision.
 * Replicates lines 9570-9572 of agent-v3.2.ts.
 */
export function buildDedupKey(decision: TradeDecision): {
  token: string;
  tier: string;
  key: string;
} {
  const token = decision.action === 'SELL' ? (decision.fromToken || '') : (decision.toToken || '');
  const tier = decision.reasoning?.match(/^([A-Z_]+):/)?.[1] || 'AI';
  return { token, tier, key: `${token}:${decision.action}:${tier}` };
}

/**
 * Determine the dedup window in minutes for a given tier and reasoning.
 * Replicates lines 9577-9586 of agent-v3.2.ts.
 */
export function getDedupWindowMinutes(tier: string, reasoning?: string): number {
  const isScaleUpTier = tier === 'SCALE_UP' || tier === 'RIDE_THE_WAVE';
  const isSurgeEligible = isScaleUpTier && (reasoning?.includes('confirmed across') ?? false);

  if (isSurgeEligible) return SURGE_DEDUP_WINDOW_MINUTES;
  if (isScaleUpTier) return SCALE_UP_DEDUP_WINDOW_MINUTES;
  if (tier === 'TRAILING_STOP') return DECEL_TRIM_DEDUP_WINDOW_MINUTES;
  if (tier === 'DIRECTIVE_SELL_ESCALATED') return MOMENTUM_EXIT_DEDUP_WINDOW_MINUTES;
  if (tier === 'FLOW_REVERSAL') return MOMENTUM_EXIT_DEDUP_WINDOW_MINUTES;
  if (tier === 'MOMENTUM_EXIT') return MOMENTUM_EXIT_DEDUP_WINDOW_MINUTES;
  if (tier === 'SCOUT') return NORMAL_DEDUP_WINDOW_MINUTES;
  if (tier === 'DECEL_TRIM') return DECEL_TRIM_DEDUP_WINDOW_MINUTES;
  if (tier === 'FORCED_DEPLOY') return FORCED_DEPLOY_DEDUP_WINDOW_MINUTES;
  return NORMAL_DEDUP_WINDOW_MINUTES;
}

/**
 * Check if a trade should be blocked by the dedup guard.
 * Returns { blocked: true, reason } if blocked, { blocked: false } otherwise.
 */
export function checkDedupGuard(
  decision: TradeDecision,
  tradeDedupLog: Record<string, string>,
  inFlightKeys: Set<string>,
  nowMs: number = Date.now(),
): { blocked: boolean; reason?: string; dedupKey?: string } {
  const { key, tier } = buildDedupKey(decision);

  // In-flight lock
  if (inFlightKeys.has(key)) {
    return { blocked: true, reason: 'DEDUP_INFLIGHT', dedupKey: key };
  }

  const lastExecution = tradeDedupLog[key];
  if (lastExecution) {
    const minutesSince = (nowMs - new Date(lastExecution).getTime()) / (1000 * 60);
    const windowMinutes = getDedupWindowMinutes(tier, decision.reasoning);
    if (minutesSince < windowMinutes) {
      return {
        blocked: true,
        reason: `DEDUP_WINDOW: ${minutesSince.toFixed(0)}min ago (min ${windowMinutes}min)`,
        dedupKey: key,
      };
    }
  }

  return { blocked: false, dedupKey: key };
}
