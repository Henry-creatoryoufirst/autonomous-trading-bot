/**
 * src/core/risk — barrel export
 *
 * Risk management modules (Phase 3 of monolith refactor).
 * Both classes consume a StateManager for state access + mutations.
 */

export { CircuitBreaker } from './circuit-breaker.js';
export type { CircuitBreakerDeps } from './circuit-breaker.js';

export { PreservationMode } from './preservation-mode.js';
export type { PreservationModeDeps } from './preservation-mode.js';
