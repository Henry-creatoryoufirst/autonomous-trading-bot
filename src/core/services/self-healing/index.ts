/**
 * NVR Capital — Self-Healing Intelligence: Public API
 *
 * Single import point for everything consumers need from this module.
 * Internal implementation files (router, executor, diagnosis engine)
 * are not re-exported — only the orchestrator surface and shared types.
 */

export { SelfHealingIntelligence } from './orchestrator.js';
export type { SHIConfig } from './orchestrator.js';
export type { DiagnosisContext } from './diagnosis-engine.js';
export * from './types.js';
