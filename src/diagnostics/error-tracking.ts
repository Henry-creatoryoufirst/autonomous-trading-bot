/**
 * Never Rest Capital — Error Tracking & Token Failure Circuit Breaker
 * Extracted from agent-v3.2.ts (Phase 11 refactor)
 */

const MAX_ERROR_LOG_SIZE = 100;

type ErrorLogEntry = {
  timestamp: string;
  type: string;
  message: string;
  details?: any;
};

type TradeFailureMap = Record<string, { count: number; lastFailure: string }>;

export function logError(
  type: string,
  message: string,
  errorLog: ErrorLogEntry[],
  details?: any,
): void {
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
  tradeFailures: TradeFailureMap,
  maxConsecutiveFailures: number,
  failureCooldownHours: number,
): void {
  const existing = tradeFailures[symbol];
  tradeFailures[symbol] = {
    count: (existing?.count || 0) + 1,
    lastFailure: new Date().toISOString(),
  };
  const f = tradeFailures[symbol];
  if (f.count >= maxConsecutiveFailures) {
    console.log(`  🚫 CIRCUIT BREAKER: ${symbol} blocked after ${f.count} consecutive failures (cooldown ${failureCooldownHours}h)`);
  }
}

export function clearTradeFailures(
  symbol: string,
  tradeFailures: TradeFailureMap,
): void {
  if (tradeFailures[symbol]) {
    delete tradeFailures[symbol];
  }
}

export function isTokenBlocked(
  symbol: string,
  tradeFailures: TradeFailureMap,
  maxConsecutiveFailures: number,
  failureCooldownHours: number,
): boolean {
  const f = tradeFailures[symbol];
  if (!f || f.count < maxConsecutiveFailures) return false;

  const hoursSinceLastFailure = (Date.now() - new Date(f.lastFailure).getTime()) / (1000 * 60 * 60);
  if (hoursSinceLastFailure >= failureCooldownHours) {
    console.log(`  🔓 CIRCUIT BREAKER: ${symbol} unblocked after ${hoursSinceLastFailure.toFixed(1)}h cooldown`);
    delete tradeFailures[symbol];
    return false;
  }

  const remainingHours = (failureCooldownHours - hoursSinceLastFailure).toFixed(1);
  console.log(`  🚫 CIRCUIT BREAKER: ${symbol} blocked (${f.count} failures, ${remainingHours}h remaining)`);
  return true;
}
