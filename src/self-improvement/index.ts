/**
 * Never Rest Capital — Self-Improvement Module
 * Barrel re-exports for self-improvement engine extracted from agent-v3.2.ts
 */

export {
  initSelfImprovement,
  getShadowProposals,
  setShadowProposals,
  calculateTradePerformance,
  calculateWinRateTruth,
  classifyTradePattern,
  describePattern,
  analyzeStrategyPatterns,
  runPerformanceReview,
  adaptThresholds,
  calculatePatternConfidence,
  checkStagnation,
  formatSelfImprovementPrompt,
  formatUserDirectivesPrompt,
  getDirectiveThresholdAdjustments,
  THRESHOLD_BOUNDS,
  DEFAULT_ADAPTIVE_THRESHOLDS,
  DEFAULT_EXPLORATION_STATE,
} from './engine.js';
