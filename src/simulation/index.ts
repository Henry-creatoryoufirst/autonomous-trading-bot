/**
 * NVR Capital — Simulation Engine Public API
 *
 * Central export point for the simulation engine.
 * Import from 'src/simulation/index.js' for all simulation capabilities.
 */

// === Types ===
export type {
  OHLCVCandle,
  HistoricalDataset,
  MarketCondition,
  MarketPeriod,
  StrategyParams,
  ReplayConfig,
  ReplayTrade,
  ReplayResult,
  PerformanceMetrics,
  ConditionBreakdown,
  StrategyVariant,
  ComparisonResult,
  SweepRange,
  SweepResult,
  ConfidenceScore,
  ConfidenceScorerConfig,
  EnhancedPaperState,
  DataFetchConfig,
  CachedDataset,
} from './types.js';

export { DEFAULT_STRATEGY_PARAMS, DEFAULT_CONFIDENCE_CONFIG } from './types.js';

// === Replay Engine ===
export { runReplay } from './engine/replay-engine.js';

// === Market Simulator ===
export {
  sliceDataset,
  filterByCondition,
  alignDatasets,
  getDatasetStats,
  walkForwardSplit,
} from './engine/market-simulator.js';

// === Historical Data ===
export {
  fetchHistoricalData,
  fromPriceHistory,
  generateSyntheticData,
  clearCache,
  getCachedDataset,
} from './data/historical-data.js';

// === Market Conditions ===
export {
  classifyWindow,
  classifyMarketPeriods,
  getConditionDistribution,
} from './data/market-conditions.js';

// === Strategy Comparison ===
export {
  compareStrategies,
  getPresetVariants,
} from './backtester/strategy-tester.js';

// === Parameter Sweep ===
export {
  runParameterSweep,
  PRESET_SWEEPS,
} from './backtester/parameter-sweep.js';

// === Confidence Scoring ===
export {
  calculateConfidence,
  calculateAggregateConfidence,
} from './scoring/confidence-scorer.js';

// === Enhanced Paper Trading ===
export {
  createEnhancedPaper,
  processTick,
  updateLiveComparison,
  getPaperSummary,
} from './paper-trading/enhanced-paper.js';
