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
