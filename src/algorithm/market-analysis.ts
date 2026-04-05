/**
 * Never Rest Capital — Market Analysis Functions
 * Extracted from agent-v3.2.ts (Phase 1b refactor)
 *
 * Market regime detection, momentum calculation, and intelligence computations.
 * Functions are parameterized — state is passed in, not read from globals.
 */

import type { TechnicalIndicators } from './indicators.js';
import type { MarketRegime, SectorDefinition } from '../core/types/index.js';

// ============================================================================
// TYPES (previously inline in monolith)
// ============================================================================

export interface DerivativesData {
  btcFundingRate: number;
  ethFundingRate: number;
  btcOpenInterest: number;
  ethOpenInterest: number;
  btcFundingSignal: "LONG_CROWDED" | "SHORT_CROWDED" | "NEUTRAL";
  ethFundingSignal: "LONG_CROWDED" | "SHORT_CROWDED" | "NEUTRAL";
  btcOIChange24h: number;
  ethOIChange24h: number;
  btcLongShortRatio: number | null;
  ethLongShortRatio: number | null;
  btcTopTraderLSRatio: number | null;
  ethTopTraderLSRatio: number | null;
  btcTopTraderPositionRatio: number | null;
  ethTopTraderPositionRatio: number | null;
  btcPositioningSignal: "OVERLEVERAGED_LONG" | "OVERLEVERAGED_SHORT" | "SMART_MONEY_LONG" | "SMART_MONEY_SHORT" | "NEUTRAL";
  ethPositioningSignal: "OVERLEVERAGED_LONG" | "OVERLEVERAGED_SHORT" | "SMART_MONEY_LONG" | "SMART_MONEY_SHORT" | "NEUTRAL";
  btcOIPriceDivergence: "OI_UP_PRICE_DOWN" | "OI_DOWN_PRICE_UP" | "ALIGNED" | "NEUTRAL";
  ethOIPriceDivergence: "OI_UP_PRICE_DOWN" | "OI_DOWN_PRICE_UP" | "ALIGNED" | "NEUTRAL";
}

export interface DefiLlamaData {
  baseTVL: number;
  baseTVLChange24h: number;
  baseDEXVolume24h: number;
  topProtocols: { name: string; tvl: number; change24h: number }[];
  protocolTVLByToken: Record<string, { tvl: number; change24h: number }>;
}

export type AltseasonSignal = "ALTSEASON_ROTATION" | "BTC_DOMINANCE_FLIGHT" | "NEUTRAL";

export interface SmartRetailDivergence {
  btcDivergence: number | null;
  ethDivergence: number | null;
  btcSignal: "STRONG_BUY" | "STRONG_SELL" | "NEUTRAL";
  ethSignal: "STRONG_BUY" | "STRONG_SELL" | "NEUTRAL";
}

export interface FundingRateMeanReversion {
  btcMean: number;
  btcStdDev: number;
  btcZScore: number;
  btcSignal: "CROWDED_LONGS_REVERSAL" | "CROWDED_SHORTS_BOUNCE" | "NEUTRAL";
  ethMean: number;
  ethStdDev: number;
  ethZScore: number;
  ethSignal: "CROWDED_LONGS_REVERSAL" | "CROWDED_SHORTS_BOUNCE" | "NEUTRAL";
}

export interface TVLPriceDivergence {
  divergences: Record<string, {
    tvlChange: number;
    priceChange: number;
    signal: "UNDERVALUED" | "OVERVALUED" | "ALIGNED";
  }>;
}

export interface MarketMomentumSignal {
  score: number;
  btcChange24h: number;
  ethChange24h: number;
  fearGreedValue: number;
  positionMultiplier: number;
  deploymentBias: string;
  dataAvailable: boolean;
}

export interface FundingRateHistory {
  btc: number[];
  eth: number[];
}

/** Minimal token data needed by market intelligence functions */
export interface MarketToken {
  symbol: string;
  priceChange24h: number;
}

/** Price info from lastKnownPrices cache */
export interface PriceInfo {
  price: number;
  change24h: number;
}

// ============================================================================
// MARKET REGIME DETECTION
// ============================================================================

/**
 * Determine overall market regime from multiple factors.
 * @param lastKnownPrices  Map of symbol -> { change24h } for BTC/ETH momentum overlay
 */
export function determineMarketRegime(
  _fearGreed: number,
  indicators: Record<string, TechnicalIndicators>,
  derivatives: DerivativesData | null,
  lastKnownPrices: Record<string, PriceInfo>,
): MarketRegime {
  const indValues = Object.values(indicators);
  if (indValues.length === 0) return "UNKNOWN";

  let upSignals = 0;
  let downSignals = 0;
  let totalSignals = 0;

  for (const ind of indValues) {
    totalSignals++;
    if (ind.trendDirection === "STRONG_UP" || ind.trendDirection === "UP") upSignals++;
    if (ind.trendDirection === "STRONG_DOWN" || ind.trendDirection === "DOWN") downSignals++;
  }

  const upRatio = totalSignals > 0 ? upSignals / totalSignals : 0;
  const downRatio = totalSignals > 0 ? downSignals / totalSignals : 0;

  const bbIndicators = indValues.filter(i => i.bollingerBands);
  const avgBandwidth = bbIndicators.length > 0
    ? bbIndicators.reduce((sum, i) => sum + (i.bollingerBands?.bandwidth || 0), 0) / bbIndicators.length
    : 0;

  const adxIndicators = indValues.filter(i => i.adx14 !== null);
  const avgADX = adxIndicators.length > 0
    ? adxIndicators.reduce((sum, i) => sum + (i.adx14?.adx || 0), 0) / adxIndicators.length
    : 0;

  const atrIndicators = indValues.filter(i => i.atrPercent !== null);
  const avgATRPct = atrIndicators.length > 0
    ? atrIndicators.reduce((sum, i) => sum + (i.atrPercent || 0), 0) / atrIndicators.length
    : 0;

  // v9.2: BTC/ETH momentum overlay
  const btcMom = lastKnownPrices['cbBTC']?.change24h ?? lastKnownPrices['BTC']?.change24h ?? 0;
  const ethMom = lastKnownPrices['WETH']?.change24h ?? lastKnownPrices['ETH']?.change24h ?? 0;
  const majorMomentum = (btcMom + ethMom) / 2;

  if (avgATRPct > 5 && avgBandwidth > 12) return "VOLATILE";
  if (avgBandwidth > 15) return "VOLATILE";

  if (avgADX > 25 && upRatio > 0.5) return "TRENDING_UP";
  if (avgADX > 25 && downRatio > 0.5) return "TRENDING_DOWN";

  if (majorMomentum > 4) return "TRENDING_UP";
  if (majorMomentum < -4) return "TRENDING_DOWN";

  if (upRatio > 0.55) return "TRENDING_UP";
  if (downRatio > 0.55) return "TRENDING_DOWN";

  if (majorMomentum > 2.5) return "TRENDING_UP";
  if (majorMomentum < -2.5) return "TRENDING_DOWN";

  if (avgADX > 0 && avgADX < 20) return "RANGING";
  if (upRatio < 0.4 && downRatio < 0.4) return "RANGING";

  return "UNKNOWN";
}

// ============================================================================
// MARKET MOMENTUM
// ============================================================================

/**
 * Calculate market momentum signal from BTC/ETH price action.
 * @param lastKnownPrices  Price cache for BTC/ETH
 * @param lastFearGreedValue  Current Fear & Greed value
 */
export function calculateMarketMomentum(
  lastKnownPrices: Record<string, PriceInfo>,
  lastFearGreedValue: number,
): MarketMomentumSignal {
  const defaultSignal: MarketMomentumSignal = {
    score: 0, btcChange24h: 0, ethChange24h: 0, fearGreedValue: 50,
    positionMultiplier: 1.0, deploymentBias: 'NORMAL', dataAvailable: false,
  };

  const btc24h = lastKnownPrices['cbBTC']?.change24h ?? lastKnownPrices['BTC']?.change24h ?? null;
  const eth24h = lastKnownPrices['WETH']?.change24h ?? lastKnownPrices['ETH']?.change24h ?? null;
  const fg = lastFearGreedValue > 0 ? lastFearGreedValue : null;

  if (btc24h === null && eth24h === null && fg === null) {
    return defaultSignal;
  }

  let score = 0;
  let dataPoints = 0;

  if (btc24h !== null) {
    score += Math.max(-55, Math.min(55, btc24h * 10)) * 0.55;
    dataPoints++;
  }

  if (eth24h !== null) {
    score += Math.max(-45, Math.min(45, eth24h * 10)) * 0.45;
    dataPoints++;
  }

  if (dataPoints > 0 && dataPoints < 2) {
    score = score * 2 * 0.85;
  }

  score = Math.max(-100, Math.min(100, score));

  let positionMultiplier = 1.0;

  const btcMom = btc24h ?? 0;
  const ethMom = eth24h ?? 0;
  const strongestMajor = Math.max(btcMom, ethMom);
  const btcStrongMomentum = btcMom >= 2;
  const ethStrongMomentum = ethMom >= 2;

  if (strongestMajor >= 5) {
    positionMultiplier = 2.0;
  } else if (strongestMajor >= 3) {
    positionMultiplier = 1.75;
  } else if (btcStrongMomentum || ethStrongMomentum) {
    positionMultiplier = 1.5;
  } else if (score > 20) {
    positionMultiplier = 1.0 + Math.min(0.5, (score - 20) / 160);
  } else if (score < -30) {
    positionMultiplier = 1.0 + Math.max(-0.5, (score + 30) / 140);
  }

  const deploymentBias = strongestMajor >= 3 ? 'WAVE' : (btcStrongMomentum || ethStrongMomentum || score > 20) ? 'AGGRESSIVE' : score < -30 ? 'CAUTIOUS' : 'NORMAL';

  return {
    score: Math.round(score * 10) / 10,
    btcChange24h: btc24h ?? 0,
    ethChange24h: eth24h ?? 0,
    fearGreedValue: fg ?? 50,
    positionMultiplier: Math.round(positionMultiplier * 100) / 100,
    deploymentBias,
    dataAvailable: dataPoints > 0,
  };
}

// ============================================================================
// SMART MONEY vs RETAIL DIVERGENCE
// ============================================================================

/**
 * v10.0: Compute Smart Money vs Retail Divergence Score from Binance data.
 * @param threshold  SMART_RETAIL_DIVERGENCE_THRESHOLD from constants
 */
export function computeSmartRetailDivergence(
  derivatives: DerivativesData | null,
  threshold: number,
): SmartRetailDivergence | null {
  if (!derivatives) return null;
  const toLongPct = (ratio: number | null): number | null => ratio === null ? null : (ratio / (1 + ratio)) * 100;

  const btcRetailLong = toLongPct(derivatives.btcLongShortRatio);
  const btcSmartLong = toLongPct(derivatives.btcTopTraderLSRatio);
  const ethRetailLong = toLongPct(derivatives.ethLongShortRatio);
  const ethSmartLong = toLongPct(derivatives.ethTopTraderLSRatio);

  const btcDiv = (btcSmartLong !== null && btcRetailLong !== null) ? btcSmartLong - btcRetailLong : null;
  const ethDiv = (ethSmartLong !== null && ethRetailLong !== null) ? ethSmartLong - ethRetailLong : null;

  const classify = (div: number | null): "STRONG_BUY" | "STRONG_SELL" | "NEUTRAL" => {
    if (div === null) return "NEUTRAL";
    if (div > threshold) return "STRONG_BUY";
    if (div < -threshold) return "STRONG_SELL";
    return "NEUTRAL";
  };

  return { btcDivergence: btcDiv, ethDivergence: ethDiv, btcSignal: classify(btcDiv), ethSignal: classify(ethDiv) };
}

// ============================================================================
// FUNDING RATE MEAN REVERSION
// ============================================================================

/**
 * v10.0: Funding Rate Mean-Reversion Signal — tracks 7 days, detects z-score extremes.
 * MUTATES fundingRateHistory — caller must pass in mutable reference.
 * @param historyLength  FUNDING_RATE_HISTORY_LENGTH from constants
 * @param stdDevThreshold  FUNDING_RATE_STD_DEV_THRESHOLD from constants
 */
export function computeFundingMeanReversion(
  derivatives: DerivativesData | null,
  fundingRateHistory: FundingRateHistory,
  historyLength: number,
  stdDevThreshold: number,
): FundingRateMeanReversion | null {
  if (!derivatives) return null;
  if (derivatives.btcFundingRate === null || derivatives.ethFundingRate === null) return null;

  fundingRateHistory.btc.push(derivatives.btcFundingRate);
  fundingRateHistory.eth.push(derivatives.ethFundingRate);
  if (fundingRateHistory.btc.length > historyLength) fundingRateHistory.btc = fundingRateHistory.btc.slice(-historyLength);
  if (fundingRateHistory.eth.length > historyLength) fundingRateHistory.eth = fundingRateHistory.eth.slice(-historyLength);

  if (fundingRateHistory.btc.length < 5) return null;

  const stats = (arr: number[]) => {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / arr.length;
    return { mean, stdDev: Math.sqrt(variance) };
  };

  const btc = stats(fundingRateHistory.btc);
  const eth = stats(fundingRateHistory.eth);
  const btcZ = btc.stdDev > 0 && isFinite(btc.mean) ? (derivatives.btcFundingRate! - btc.mean) / btc.stdDev : 0;
  const ethZ = eth.stdDev > 0 && isFinite(eth.mean) ? (derivatives.ethFundingRate! - eth.mean) / eth.stdDev : 0;

  const classifyZ = (z: number): "CROWDED_LONGS_REVERSAL" | "CROWDED_SHORTS_BOUNCE" | "NEUTRAL" => {
    if (z > stdDevThreshold) return "CROWDED_LONGS_REVERSAL";
    if (z < -stdDevThreshold) return "CROWDED_SHORTS_BOUNCE";
    return "NEUTRAL";
  };

  return {
    btcMean: btc.mean, btcStdDev: btc.stdDev, btcZScore: btcZ, btcSignal: classifyZ(btcZ),
    ethMean: eth.mean, ethStdDev: eth.stdDev, ethZScore: ethZ, ethSignal: classifyZ(ethZ),
  };
}

// ============================================================================
// TVL-PRICE DIVERGENCE
// ============================================================================

/**
 * v10.0: TVL-Price Divergence per Token.
 * @param threshold  TVL_PRICE_DIVERGENCE_THRESHOLD from constants
 */
export function computeTVLPriceDivergence(
  defi: DefiLlamaData | null,
  tokens: MarketToken[],
  threshold: number,
): TVLPriceDivergence | null {
  if (!defi || !defi.protocolTVLByToken || Object.keys(defi.protocolTVLByToken).length === 0) return null;

  const divergences: TVLPriceDivergence["divergences"] = {};
  for (const [symbol, tvlData] of Object.entries(defi.protocolTVLByToken)) {
    const tokenData = tokens.find(t => t.symbol === symbol);
    if (!tokenData) continue;
    const tvlChange = tvlData.change24h;
    const priceChange = tokenData.priceChange24h;
    let signal: "UNDERVALUED" | "OVERVALUED" | "ALIGNED" = "ALIGNED";
    if (tvlChange > threshold && priceChange < 0) signal = "UNDERVALUED";
    else if (tvlChange < -threshold && priceChange > 0) signal = "OVERVALUED";
    divergences[symbol] = { tvlChange, priceChange, signal };
  }
  return { divergences };
}

// ============================================================================
// ADJUSTED SECTOR TARGETS
// ============================================================================

/**
 * v10.0: Dynamic sector targets based on altseason/dominance signal.
 * @param sectors  SECTORS config
 * @param altseasonBoost  ALTSEASON_SECTOR_BOOST from constants
 * @param btcDominanceBoost  BTC_DOMINANCE_SECTOR_BOOST from constants
 * @param lastKnownPrices  Price cache for BTC momentum boost
 */
export function getAdjustedSectorTargets(
  signal: AltseasonSignal,
  sectors: Record<string, SectorDefinition>,
  altseasonBoost: Record<string, number>,
  btcDominanceBoost: Record<string, number>,
  lastKnownPrices: Record<string, PriceInfo>,
): Record<string, number> {
  const adjusted: Record<string, number> = {};
  for (const [key, sector] of Object.entries(sectors)) {
    adjusted[key] = sector.targetAllocation;
  }
  if (signal === "ALTSEASON_ROTATION") {
    adjusted.AI_TOKENS = Math.min(0.30, (adjusted.AI_TOKENS || 0) + (altseasonBoost.AI_TOKENS || 0));
    adjusted.MEME_COINS = Math.min(0.30, (adjusted.MEME_COINS || 0) + (altseasonBoost.MEME_COINS || 0));
    adjusted.BLUE_CHIP = Math.max(0.25, (adjusted.BLUE_CHIP || 0) + (altseasonBoost.BLUE_CHIP || 0));
    adjusted.DEFI = (adjusted.DEFI || 0) + (altseasonBoost.DEFI || 0);
  } else if (signal === "BTC_DOMINANCE_FLIGHT") {
    adjusted.BLUE_CHIP = Math.min(0.55, (adjusted.BLUE_CHIP || 0) + (btcDominanceBoost.BLUE_CHIP || 0));
    adjusted.AI_TOKENS = Math.max(0.15, (adjusted.AI_TOKENS || 0) + (btcDominanceBoost.AI_TOKENS || 0));
    adjusted.MEME_COINS = Math.max(0.10, (adjusted.MEME_COINS || 0) + (btcDominanceBoost.MEME_COINS || 0));
    adjusted.DEFI = Math.max(0.15, (adjusted.DEFI || 0) + (btcDominanceBoost.DEFI || 0));
  }

  // v14.0: Blue Chip Momentum Boost
  const btcPrice = lastKnownPrices['cbBTC'] || lastKnownPrices['BTC'];
  if (btcPrice && btcPrice.change24h >= 2) {
    const currentBlueChip = adjusted.BLUE_CHIP || 0;
    const currentMeme = adjusted.MEME_COINS || 0;
    if (currentBlueChip < 0.50) {
      const boost = Math.min(0.10, 0.50 - currentBlueChip);
      adjusted.BLUE_CHIP = currentBlueChip + boost;
      adjusted.MEME_COINS = Math.max(0.05, currentMeme - boost);
    }
  }

  const sum = Object.values(adjusted).reduce((a, b) => a + b, 0);
  if (sum > 0 && Math.abs(sum - 1.0) > 0.001) {
    for (const key of Object.keys(adjusted)) adjusted[key] = adjusted[key] / sum;
  }
  return adjusted;
}

// ============================================================================
// LOCAL ALTSEASON SIGNAL
// ============================================================================

export interface PriceHistoryEntry {
  prices: number[];
  volumes: number[];
  timestamps: number[];
}

/**
 * Compute local altseason signal from BTC/ETH price ratio.
 * @param btcHistory  Price history for cbBTC
 * @param ethHistory  Price history for ETH/WETH
 * @param btcDominanceChangeThreshold  BTC_DOMINANCE_CHANGE_THRESHOLD from constants
 */
export function computeLocalAltseasonSignal(
  btcHistory: PriceHistoryEntry | undefined,
  ethHistory: PriceHistoryEntry | undefined,
  btcDominanceChangeThreshold: number,
): AltseasonSignal {
  if (!btcHistory || !ethHistory || btcHistory.prices.length < 24 || ethHistory.prices.length < 24) {
    return 'NEUTRAL';
  }

  const currentBtc = btcHistory.prices[btcHistory.prices.length - 1];
  const currentEth = ethHistory.prices[ethHistory.prices.length - 1];
  if (!currentBtc || !currentEth || currentEth === 0) return 'NEUTRAL';

  const currentRatio = currentBtc / currentEth;

  const lookbackIdx = Math.max(0, btcHistory.prices.length - 168);
  const oldBtc = btcHistory.prices[lookbackIdx];
  const oldEthIdx = Math.max(0, ethHistory.prices.length - 168);
  const oldEth = ethHistory.prices[oldEthIdx];
  if (!oldBtc || !oldEth || oldEth === 0) return 'NEUTRAL';

  const oldRatio = oldBtc / oldEth;
  if (oldRatio === 0) return 'NEUTRAL';

  const ratioChange = ((currentRatio - oldRatio) / oldRatio) * 100;

  if (ratioChange > btcDominanceChangeThreshold * 2.5) return 'BTC_DOMINANCE_FLIGHT';
  if (ratioChange < -btcDominanceChangeThreshold * 2.5) return 'ALTSEASON_ROTATION';
  return 'NEUTRAL';
}

// ============================================================================
// PRICE CHANGE COMPUTATION
// ============================================================================

/**
 * Compute percentage price change from history.
 * @param entry  Token's price history entry from the store
 * @param currentPrice  Current price
 * @param lookbackMs  How far back to look (e.g., 24h = 86400000)
 */
export function computePriceChange(
  entry: PriceHistoryEntry | undefined,
  currentPrice: number,
  lookbackMs: number,
): number {
  if (!entry || entry.timestamps.length < 2 || currentPrice <= 0) return 0;

  const target = Date.now() - lookbackMs;
  let closestIdx = 0;
  let closestDiff = Infinity;

  for (let i = entry.timestamps.length - 1; i >= 0; i--) {
    const diff = Math.abs(entry.timestamps[i] - target);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestIdx = i;
    }
    if (entry.timestamps[i] < target) break;
  }

  const oldPrice = entry.prices[closestIdx];
  return oldPrice > 0 ? ((currentPrice - oldPrice) / oldPrice) * 100 : 0;
}
