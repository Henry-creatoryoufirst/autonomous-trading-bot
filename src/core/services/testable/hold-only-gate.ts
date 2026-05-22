/**
 * HOLD-ONLY trade-execution gate — extracted for unit testing.
 *
 * Wired into agent-v3.2.ts's executeTrade(). For any BUY/SELL/REBALANCE
 * targeting a token in the HOLD_ONLY list (default `['cbLTC']`, overridable
 * via `HOLD_ONLY_TOKENS` env), the gate returns blocked + a structured
 * reason. The bot still HOLDs existing positions (cost basis, balance,
 * INV-5 cohort coverage are untouched) — we only block new in/out flow.
 *
 * Operational rationale: cbLTC self-healing 2026-05-22 found 3 consecutive
 * TWAP-slice failures with root cause "Compound-backed LTC may have thinner
 * liquidity than base pairs." Skip the execution attempt rather than
 * compound failed-trade churn. See HOLD_ONLY_TOKENS_2026-05-22 vault doc.
 */

import { getHoldOnlyTokens } from '../../config/token-registry.js';

export interface HoldOnlyDecision {
  action: 'BUY' | 'SELL' | 'HOLD' | 'REBALANCE' | string;
  fromToken?: string;
  toToken?: string;
}

export interface HoldOnlyGateResult {
  /** True when the trade should be skipped. */
  blocked: boolean;
  /** Symbol that triggered the skip (the target of the trade). */
  symbol?: string;
  /** Action that was about to fire. */
  action?: string;
  /** Human-readable reason for the log line. */
  reason?: string;
}

/**
 * Resolve the target symbol for a TradeDecision: for BUY it's the toToken
 * (the asset we'd be acquiring), for SELL it's the fromToken (the asset
 * we'd be disposing of), for REBALANCE it's either side (we check both).
 */
function getTargetSymbols(decision: HoldOnlyDecision): string[] {
  if (decision.action === 'BUY') return decision.toToken ? [decision.toToken] : [];
  if (decision.action === 'SELL') return decision.fromToken ? [decision.fromToken] : [];
  if (decision.action === 'REBALANCE') {
    const targets: string[] = [];
    if (decision.fromToken) targets.push(decision.fromToken);
    if (decision.toToken) targets.push(decision.toToken);
    return targets;
  }
  // HOLD or unknown: nothing to block.
  return [];
}

/**
 * Pure gate function. Pass an explicit list to bypass the env-read (useful
 * for tests); omit to consult `getHoldOnlyTokens()` (env-aware).
 */
export function checkHoldOnlyGate(
  decision: HoldOnlyDecision,
  holdOnlyList?: readonly string[],
): HoldOnlyGateResult {
  // HOLDs are never blocked — the whole point is to keep holding.
  if (decision.action !== 'BUY' && decision.action !== 'SELL' && decision.action !== 'REBALANCE') {
    return { blocked: false };
  }

  const list = holdOnlyList ?? getHoldOnlyTokens();
  if (list.length === 0) return { blocked: false };

  const targets = getTargetSymbols(decision);
  for (const symbol of targets) {
    if (list.includes(symbol)) {
      return {
        blocked: true,
        symbol,
        action: decision.action,
        reason: `[HoldOnly] skipping ${decision.action} on ${symbol} — Base L2 liquidity too thin for active execution`,
      };
    }
  }
  return { blocked: false };
}

/**
 * Process-wide counter for telemetry — incremented every time the gate
 * actually blocks a trade. Inspect via `getHoldOnlyBlockedCount()`.
 */
let _blockedCount = 0;

/** Returns the live counter value. Tests can reset it via `resetHoldOnlyBlockedCount()`. */
export function getHoldOnlyBlockedCount(): number {
  return _blockedCount;
}

/** Reset the counter — exported for test isolation. */
export function resetHoldOnlyBlockedCount(): void {
  _blockedCount = 0;
}

/** Increment the counter — called by the wired-in gate site after a block. */
export function recordHoldOnlyBlock(): void {
  _blockedCount += 1;
}
