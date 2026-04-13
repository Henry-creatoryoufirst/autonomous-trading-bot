/**
 * NVR Capital — Simulation Engine Types
 * Type definitions for replay engine, strategy comparison, confidence scoring,
 * and enhanced paper trading.
 */

// ============================================================================
// CANDLE / OHLCV DATA
// ============================================================================

export interface OHLCVCandle {
  timestamp: number;   // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoricalDataset {
  symbol: string;
  candles: OHLCVCandle[];
  startTime: number;
  endTime: number;
  intervalMs: number;  // e.g. 3600000 for 1h candles
}

// ============================================================================
// MARKET CONDITIONS
// ============================================================================

export type MarketCondition = 'BULL' | 'BEAR' | 'RANGING' | 'VOLATILE';

export interface MarketPeriod {
  condition: MarketCondition;
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  metrics: {
    returnPct: number;
    volatility: number;     // annualized std dev of returns
    maxDrawdownPct: number;
    avgVolume: number;
  };
}

// ============================================================================
// STRATEGY PARAMETERS
// ============================================================================

export interface StrategyParams {
  confluenceBuyThreshold: number;    // e.g. 15
  confluenceSellThreshold: number;   // e.g. -30
  stopLossPercent: number;           // e.g. 15
  profitTakePercent: number;         // e.g. 20
  trailingStopPercent?: number;      // optional trailing stop
  maxPositionPercent: number;        // max % of portfolio in one token
  kellyFraction: number;             // 0-1
  minPositionUSD: number;            // minimum trade size
  cashDeployThreshold: number;       // % cash before deploying
  startingCapital: number;
}

/**
 * Default strategy parameters — tuned via parallel parameter sweep (Phase 1 + Phase 2).
 * Phase 1 result: stop=6, profit=5, maxPos=6 (score: 63/100)
 * Phase 2 result: confluence=22, stop=7, profit=5, maxPos=6 (score: 64/100)
 *
 * NOTE: live bot uses adaptive confluenceBuy (starts at 8, caps at 25).
 * The simulation uses this as a fixed threshold. 22 is proven optimal.
 */
export const DEFAULT_STRATEGY_PARAMS: StrategyParams = {
  confluenceBuyThreshold: 22,
  confluenceSellThreshold: -50,
  stopLossPercent: 7,
  profitTakePercent: 5,
  trailingStopPercent: 10,
  maxPositionPercent: 6,
  kellyFraction: 0.3,
  minPositionUSD: 5,
  cashDeployThreshold: 10,
  startingCapital: 500,
};

// ============================================================================
// REPLAY ENGINE
// ============================================================================

export interface ReplayConfig {
  /** Strategy parameters */
  strategy: StrategyParams;
  /** Start timestamp (unix ms). If omitted, use earliest data */
  startTime?: number;
  /** End timestamp (unix ms). If omitted, use latest data */
  endTime?: number;
  /** Step size: how many candles to advance per tick. Default 1 */
  stepSize?: number;
  /** Minimum candles needed before first trade. Default 50 */
  warmupCandles?: number;
}

export interface ReplayTrade {
  timestamp: number;
  action: 'BUY' | 'SELL';
  symbol: string;
  amountUSD: number;
  price: number;
  reason: string;
  portfolioValueAfter: number;
  realizedPnl: number;
  confluenceScore: number;
}

export interface ReplayResult {
  /** Final performance metrics */
  metrics: PerformanceMetrics;
  /** All trades executed */
  trades: ReplayTrade[];
  /** Equity curve: array of portfolio values at each step */
  equityCurve: number[];
  /** Timestamps corresponding to equity curve points */
  equityTimestamps: number[];
  /** Performance by market condition */
  conditionBreakdown: ConditionBreakdown[];
  /** Duration of replay in real ms */
  replayDurationMs: number;
  /** Number of candles processed */
  candlesProcessed: number;
}

export interface PerformanceMetrics {
  totalReturn: number;
  totalReturnPct: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  holdBaseline: number;
  holdBaselinePct: number;
  avgTradesPerMonth: number;
}

export interface ConditionBreakdown {
  condition: MarketCondition;
  metrics: PerformanceMetrics;
  periodCount: number;
  totalCandles: number;
}

// ============================================================================
// STRATEGY COMPARISON
// ============================================================================

export interface StrategyVariant {
  name: string;
  params: StrategyParams;
}

export interface ComparisonResult {
  variants: Array<{
    name: string;
    params: StrategyParams;
    result: ReplayResult;
  }>;
  /** Ranked by total return (descending) */
  ranking: Array<{
    rank: number;
    name: string;
    totalReturnPct: number;
    sharpeRatio: number;
    maxDrawdownPct: number;
    winRate: number;
  }>;
  /** Dataset info */
  datasetInfo: {
    symbols: string[];
    startTime: number;
    endTime: number;
    totalCandles: number;
  };
}

// ============================================================================
// PARAMETER SWEEP
// ============================================================================

export interface SweepRange {
  param: keyof StrategyParams;
  min: number;
  max: number;
  step: number;
}

export interface SweepResult {
  /** All parameter combinations tested */
  results: Array<{
    params: Partial<StrategyParams>;
    metrics: PerformanceMetrics;
  }>;
  /** Best by total return */
  bestByReturn: {
    params: Partial<StrategyParams>;
    metrics: PerformanceMetrics;
  };
  /** Best by Sharpe ratio */
  bestBySharpe: {
    params: Partial<StrategyParams>;
    metrics: PerformanceMetrics;
  };
  /** Best by win rate */
  bestByWinRate: {
    params: Partial<StrategyParams>;
    metrics: PerformanceMetrics;
  };
  /** Total combinations tested */
  totalCombinations: number;
  /** Duration in ms */
  durationMs: number;
}

// ============================================================================
// CONFIDENCE SCORING
// ============================================================================

export interface ConfidenceScore {
  /** Overall confidence 0-100 */
  overall: number;
  /** Breakdown by market condition */
  byCondition: Record<MarketCondition, number>;
  /** Breakdown by metric */
  byMetric: {
    returnScore: number;      // 0-25: based on returns vs hold
    riskScore: number;        // 0-25: based on drawdown + Sharpe
    consistencyScore: number; // 0-25: based on win rate + profit factor
    robustnessScore: number;  // 0-25: based on performance across conditions
  };
  /** Whether this meets the minimum threshold for deployment */
  passesThreshold: boolean;
  /** Minimum threshold used */
  threshold: number;
  /** Detailed reasoning */
  reasoning: string[];
}

export interface ConfidenceScorerConfig {
  /** Minimum overall confidence to pass. Default 60 */
  minimumConfidence: number;
  /** Minimum condition-level confidence. Default 40 */
  minimumConditionConfidence: number;
  /** Benchmark: must beat hold by this % to score well. Default 5 */
  holdBeatThresholdPct: number;
  /** Maximum acceptable drawdown %. Default 30 */
  maxAcceptableDrawdownPct: number;
  /** Minimum win rate to score well. Default 0.45 */
  minimumWinRate: number;
  /** Minimum Sharpe ratio. Default 0.5 */
  minimumSharpe: number;
}

export const DEFAULT_CONFIDENCE_CONFIG: ConfidenceScorerConfig = {
  minimumConfidence: 60,
  minimumConditionConfidence: 40,
  holdBeatThresholdPct: 5,
  maxAcceptableDrawdownPct: 30,
  minimumWinRate: 0.45,
  minimumSharpe: 0.5,
};

// ============================================================================
// ENHANCED PAPER TRADING
// ============================================================================

export interface EnhancedPaperState {
  id: string;
  strategyName: string;
  startedAt: number;
  capital: number;
  cash: number;
  positions: Record<string, {
    qty: number;
    costBasis: number;
    entryTime: number;
  }>;
  trades: ReplayTrade[];
  equityCurve: Array<{ timestamp: number; value: number }>;
  metrics: PerformanceMetrics;
  /** Live comparison tracking */
  liveComparison?: {
    liveReturnPct: number;
    paperReturnPct: number;
    divergencePct: number;
    lastUpdated: number;
    divergenceHistory: Array<{
      timestamp: number;
      livePct: number;
      paperPct: number;
      divergencePct: number;
    }>;
  };
}

// ============================================================================
// HISTORICAL DATA FETCHING
// ============================================================================

export interface DataFetchConfig {
  /** CoinGecko coin ID (e.g. 'ethereum', 'bitcoin') */
  coinId: string;
  /** VS currency. Default 'usd' */
  vsCurrency?: string;
  /** Number of days of history. Default 365 */
  days?: number;
}

export interface CachedDataset {
  dataset: HistoricalDataset;
  fetchedAt: number;
  cacheKey: string;
}

// ============================================================================
// ADAPTIVE ENGINE TYPES (Levels 1-6)
// ============================================================================

/** Market structure regime (direction-agnostic) */
export type SimRegime = 'TRENDING' | 'RANGING' | 'VOLATILE' | 'BREAKOUT';

/** Multi-timeframe candle data derived from base 1h candles */
export interface MultiTimeframeData {
  tf1h: OHLCVCandle[];
  tf4h: OHLCVCandle[];
  tf1d: OHLCVCandle[];
}

/** Score from a single timeframe's indicators */
export interface TimeframeScore {
  timeframe: '1h' | '4h' | '1d';
  score: number;
  weight: number;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  indicatorSignals: Record<string, number>;
}

/** Alignment detection across timeframes */
export interface TimeframeAlignment {
  aligned: boolean;
  bonus: number;
  scores: TimeframeScore[];
  compositeScore: number;
}

/** Detected market regime with confidence and underlying metrics */
export interface RegimeState {
  regime: SimRegime;
  confidence: number;
  adx: number;
  atrPercent: number;
  bbBandwidth: number;
  trendDirection: 'UP' | 'DOWN' | 'FLAT';
}

/** Per-regime strategy parameter adjustments */
export interface RegimeOverlay {
  confluenceBuyThreshold: number;
  stopLossPercent: number;
  profitTakePercent: number;
  trailingStopPercent: number;
  maxPositionPercent: number;
  kellyFraction: number;
}

/** Per-indicator weight tracking for dynamic adjustment */
export interface IndicatorWeight {
  name: string;
  baseWeight: number;
  multiplier: number;
  correctPredictions: number;
  totalPredictions: number;
  rollingAccuracy: number;
}

/** Collection of all dynamic indicator weights */
export interface DynamicWeightState {
  weights: IndicatorWeight[];
  windowSize: number;
  /** Rolling window of recent prediction results per indicator */
  history: Array<{ indicator: string; correct: boolean }>;
}

/** Exit signal from intelligent exit evaluation */
export interface ExitSignal {
  type: 'HOLD' | 'REDUCE' | 'EXIT';
  reason: string;
  urgency: number; // 0-1
  suggestedSellFraction: number; // 0-1
}

/** ATR-based dynamic profit targets */
export interface DynamicProfitTargets {
  target1: number; // 1.5x ATR
  target2: number; // 3x ATR
  target3: number; // 5x ATR
  atrValue: number;
  atrPercent: number;
}

/** Volume analysis signal */
export interface VolumeSignal {
  volumeRatio: number;
  confirmed: boolean;
  dryingUp: boolean;
}

/** Snapshot of signals at trade entry/exit for meta-learning */
export interface TradeSignalSnapshot {
  timestamp: number;
  action: 'BUY' | 'SELL';
  symbol: string;
  price: number;
  regime: SimRegime;
  confluenceScore: number;
  timeframeAligned: boolean;
  volumeConfirmed: boolean;
  indicatorSignals: Record<string, number>;
  pnl?: number; // filled on sell
  holdCandles?: number;
}

/** Extended position with adaptive metadata */
export interface AdaptivePosition {
  qty: number;
  costBasis: number;
  entryTime: number;
  peakPrice: number;
  lastHarvestTier: number;
  candlesHeld: number;
  entryRegime: SimRegime;
  entrySignals: Record<string, number>;
  entryConfluence: number;
}

/** Config for the adaptive replay engine with level toggles */
export interface AdaptiveReplayConfig {
  strategy: StrategyParams;
  startTime?: number;
  endTime?: number;
  stepSize?: number;
  warmupCandles?: number;
  /** Level toggles — all default true */
  enableMultiTimeframe?: boolean;
  enableRegimeAdaptation?: boolean;
  enableDynamicWeights?: boolean;
  enableIntelligentExits?: boolean;
  enableVolumeIntel?: boolean;
}

/** Result from the adaptive replay engine */
export interface AdaptiveReplayResult extends ReplayResult {
  regimeDistribution: Record<SimRegime, number>;
  finalWeights: DynamicWeightState;
  tradeSnapshots: TradeSignalSnapshot[];
  levelsEnabled: {
    multiTimeframe: boolean;
    regimeAdaptation: boolean;
    dynamicWeights: boolean;
    intelligentExits: boolean;
    volumeIntel: boolean;
  };
}

/** Meta-learning report from trade analysis */
export interface MetaLearningReport {
  bestEntryConditions: Array<{
    regime: SimRegime;
    aligned: boolean;
    volumeConfirmed: boolean;
    winRate: number;
    avgPnlPct: number;
    tradeCount: number;
  }>;
  indicatorRankings: Array<{
    name: string;
    accuracy: number;
    contribution: number;
  }>;
  recommendations: string[];
}
