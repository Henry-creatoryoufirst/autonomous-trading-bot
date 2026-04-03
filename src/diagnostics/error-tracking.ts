/**
 * Never Rest Capital — Error Tracking & Token Failure Circuit Breaker
 * Extracted from agent-v3.2.ts (Phase 11 refactor)
 *
 * Now imports state directly from src/state/store.ts and config constants
 * from config/constants.ts — no more parameter-passing for state access.
 */

import { getState } from '../state/index.js';
import { MAX_CONSECUTIVE_FAILURES, FAILURE_COOLDOWN_HOURS } from '../../config/constants.js';

const MAX_ERROR_LOG_SIZE = 100;

export function logError(
  type: string,
  message: string,
  details?: any,
): void {
  const errorLog = getState().errorLog;
  errorLog.push({
    timestamp: new Date().toISOString(),
    type,
    message: message.substring(0, 500),
    details: details ? JSON.parse(JSON.stringify(details, (_, v) => typeof v === 'string' ? v.substring(0, 300) : v)) : undefined,
  });
  if (errorLog.length > MAX_ERROR_LOG_SIZE) {
    errorLog.splice(0, errorLog.length - MAX_ERROR_LOG_SIZE);
  }
}

export function recordTradeFailure(
  symbol: string,
): void {
  const tradeFailures = getState().tradeFailures;
  const existing = tradeFailures[symbol];
  tradeFailures[symbol] = {
    count: (existing?.count || 0) + 1,
    lastFailure: new Date().toISOString(),
  };
  const f = tradeFailures[symbol];
  if (f.count >= MAX_CONSECUTIVE_FAILURES) {
    console.log(`  🚫 CIRCUIT BREAKER: ${symbol} blocked after ${f.count} consecutive failures (cooldown ${FAILURE_COOLDOWN_HOURS}h)`);
  }
}

export function clearTradeFailures(
  symbol: string,
): void {
  const tradeFailures = getState().tradeFailures;
  if (tradeFailures[symbol]) {
    delete tradeFailures[symbol];
  }
}

export function isTokenBlocked(
  symbol: string,
): boolean {
  const tradeFailures = getState().tradeFailures;
  const f = tradeFailures[symbol];
  if (!f || f.count < MAX_CONSECUTIVE_FAILURES) return false;

  const hoursSinceLastFailure = (Date.now() - new Date(f.lastFailure).getTime()) / (1000 * 60 * 60);
  if (hoursSinceLastFailure >= FAILURE_COOLDOWN_HOURS) {
    console.log(`  🔓 CIRCUIT BREAKER: ${symbol} unblocked after ${hoursSinceLastFailure.toFixed(1)}h cooldown`);
    delete tradeFailures[symbol];
    return false;
  }

  const remainingHours = (FAILURE_COOLDOWN_HOURS - hoursSinceLastFailure).toFixed(1);
  console.log(`  🚫 CIRCUIT BREAKER: ${symbol} blocked (${f.count} failures, ${remainingHours}h remaining)`);
  return true;
}
