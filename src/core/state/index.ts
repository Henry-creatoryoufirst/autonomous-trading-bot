/**
 * src/state — barrel export
 */
export {
  getState,
  getBreakerState,
  setState,
  setBreakerState,
  markStateDirty,
  isStateDirty,
  isCriticalPending,
  clearDirtyFlag,
} from './store.js';

// Phase 2: class-based state surface for typed mutations + IBot compliance
export { StateManager, createStateManager } from './state-manager.js';
