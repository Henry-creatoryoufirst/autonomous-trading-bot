/**
 * NVR-SPEC-035 System Auditor — barrel exports.
 *
 * Public surface (Phase A):
 *   - runSystemAuditor(deps)  — main entry, called at end of every heavy cycle
 *   - captureLastPrompt(args) — call right before any Anthropic API hit
 *   - canExecuteAction(args)  — trade-execution gate
 *   - getCurrentBlocker()     — current SystemHealthBlocker | null
 *   - getMonitorStats()       — cumulative + per-invariant counters
 *   - wireTelegram(fn)        — agent registers its Telegram sender at startup
 *   - clearBlocker(reason)    — operator escape hatch
 */

export {
  runSystemAuditor,
  captureLastPrompt,
  canExecuteAction,
  getCurrentBlocker,
  getMonitorStats,
  getLastReport,
  getStartedAt,
  wireTelegram,
  clearBlocker,
  _internals,
  type AuditorDeps,
} from './system-auditor.js';

export type {
  AuditReport,
  AuditorMode,
  CapturedPrompt,
  Invariant,
  InvariantContext,
  PauseScope,
  Severity,
  SystemHealthBlocker,
  Violation,
} from './types.js';

export { dimensionalHonesty } from './invariants/dimensional-honesty.js';
export { fictionalPnl } from './invariants/fictional-pnl.js';
export { promptCoherence } from './invariants/prompt-coherence.js';
export { auditorSelfTest } from './invariants/auditor-self-test.js';
export { chainTruthReconciliation } from './invariants/chain-truth-reconciliation.js';
export { chainDepositReconciliation } from './invariants/chain-deposit-reconciliation.js';
export { cohortCoverage } from './invariants/cohort-coverage.js';
export { reserveFloor } from './invariants/reserve-floor.js';
export { sleeveLiveness } from './invariants/sleeve-liveness.js';
export { observationConsumer } from './invariants/observation-consumer.js';
export { cycleTradeRatio } from './invariants/cycle-trade-ratio.js';

// Phase B — prompt-block formatter (heavy-cycle prompt wiring)
export { formatSystemAuditPromptBlock } from './prompt-block.js';

// Phase A.1 — live-RPC source for INV-10
export { captureLiveOnChainSnapshot } from './sources/live-onchain.js';
export type { LiveOnChainSnapshot, LiveOnChainBalance, LiveOnChainTokenSpec, YieldReceiptSpec } from './sources/live-onchain.js';

// Phase A.1 — chain-deposit history source for INV-11
export { fetchChainDepositHistory } from './sources/chain-deposit-history.js';
export type { ChainDepositHistory, DepositRecord } from './sources/chain-deposit-history.js';
