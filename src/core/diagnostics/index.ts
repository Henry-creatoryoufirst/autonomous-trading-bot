/**
 * Never Rest Capital — Diagnostics Module
 * Extracted from agent-v3.2.ts (Phase 11 refactor)
 *
 * Error logging, token failure circuit breaker, and opportunity cost tracking.
 */

export { logError, recordTradeFailure, clearTradeFailures, isTokenBlocked } from './error-tracking.js';
export { logMissedOpportunity, updateOpportunityCosts, getOpportunityCostSummary } from './opportunity-tracking.js';
export type { OpportunityCostLog } from './opportunity-tracking.js';
