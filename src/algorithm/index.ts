/**
 * Never Rest Capital — Algorithm Module
 * Barrel re-exports for all algorithm functions extracted from agent-v3.2.ts
 */

// Technical indicators (pure math)
export {
  calculateRSI,
  calculateEMA,
  calculateMACD,
  calculateBollingerBands,
  calculateSMA,
  calculateATR,
  calculateADX,
  determineTrend,
  decodeSqrtPriceX96,
} from './indicators.js';
export type { TechnicalIndicators } from './indicators.js';

// Confluence scoring
export { calculateConfluence } from './confluence.js';
export type { ConfluenceContext } from './confluence.js';

// Market analysis
export {
  determineMarketRegime,
  calculateMarketMomentum,
  computeSmartRetailDivergence,
  computeFundingMeanReversion,
  computeTVLPriceDivergence,
  getAdjustedSectorTargets,
  computeLocalAltseasonSignal,
  computePriceChange,
} from './market-analysis.js';
export type {
  DerivativesData,
  DefiLlamaData,
  AltseasonSignal,
  SmartRetailDivergence,
  FundingRateMeanReversion,
  TVLPriceDivergence,
  MarketMomentumSignal,
  FundingRateHistory,
  PriceHistoryEntry,
  PriceInfo,
  MarketToken,
} from './market-analysis.js';

// Position sizing
export {
  getEffectiveKellyCeiling,
  calculateKellyPositionSize,
  calculateVolatilityMultiplier,
  calculateInstitutionalPositionSize,
} from './position-sizing.js';
export type {
  KellyResult,
  VolatilityResult,
  InstitutionalSizeResult,
  PositionSizingState,
  BreakerSizeState,
  KellyConstants,
  VolatilityConstants,
} from './position-sizing.js';

// Risk management
export { computeAtrStopLevels } from './risk.js';
export type { AtrStopConstants } from './risk.js';
