/**
 * Centralized State Store — Never Rest Capital
 *
 * Single source of truth for AgentState and BreakerState.
 * Modules can import getState() / getBreakerState() instead of
 * receiving state through parameter-passing or context objects.
 *
 * The monolith (agent-v3.2.ts) calls setState() and setBreakerState()
 * at startup to wire its existing module-level variables into this store.
 *
 * Phase 1: store + dirty-flag helpers live here; the monolith delegates
 * to them. Consumer modules (dashboard, server, etc.) will migrate
 * to direct imports in a future step.
 */

import type { AgentState, BreakerState } from '../../types/state.js';

// ---------------------------------------------------------------------------
// Internal singleton references — set once at startup via setState / setBreakerState
// ---------------------------------------------------------------------------
let _state: AgentState | null = null;
let _breakerState: BreakerState | null = null;

// ---------------------------------------------------------------------------
// Dirty-flag persistence helpers
// ---------------------------------------------------------------------------
let _stateDirty = false;
let _criticalPending = false;

// ---------------------------------------------------------------------------
// Public API — State access
// ---------------------------------------------------------------------------

/** Initialize (or replace) the global AgentState reference. Call once at startup. */
export function setState(s: AgentState): void {
  _state = s;
}

/** Return the current AgentState. Throws if setState() was never called. */
export function getState(): AgentState {
  if (!_state) throw new Error('[state/store] getState() called before setState() — agent not initialized');
  return _state;
}

/** Initialize (or replace) the global BreakerState reference. Call once at startup. */
export function setBreakerState(b: BreakerState): void {
  _breakerState = b;
}

/** Return the current BreakerState. Throws if setBreakerState() was never called. */
export function getBreakerState(): BreakerState {
  if (!_breakerState) throw new Error('[state/store] getBreakerState() called before setBreakerState() — agent not initialized');
  return _breakerState;
}

// ---------------------------------------------------------------------------
// Public API — Dirty-flag persistence
// ---------------------------------------------------------------------------

/**
 * Mark state as needing persistence.
 * @param critical  If true, the persistence layer should flush within seconds
 *                  (e.g. after a trade execution) rather than waiting for the
 *                  normal 30-second batch window.
 */
export function markStateDirty(critical?: boolean): void {
  _stateDirty = true;
  if (critical) _criticalPending = true;
}

/** Check whether state has been mutated since the last flush. */
export function isStateDirty(): boolean {
  return _stateDirty;
}

/** Check whether a critical (fast) flush was requested. */
export function isCriticalPending(): boolean {
  return _criticalPending;
}

/** Reset the dirty flag after a successful persistence flush. */
export function clearDirtyFlag(): void {
  _stateDirty = false;
  _criticalPending = false;
}
