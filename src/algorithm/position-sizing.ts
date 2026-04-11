/**
 * Never Rest Capital — Position Sizing Engine
 * Extracted from agent-v3.2.ts (Phase 1b refactor)
 *
 * Kelly criterion, volatility-adjusted sizing, and institutional position sizing.
 * All state dependencies are passed in as parameters.
 */

import type { MarketMomentumSignal } from './market-analysis.js';
import type { TradeRecord, TokenCostBasis } from '../core/types/index.js';

// ============================================================================
// TYPES
// ============================================================================

export interface KellyResult {
  kellyUSD: number;
  kellyPct: number;
  rawKelly: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
}

export interface VolatilityResult {
  multiplier: number;
  realizedVol: number;
}

export interface InstitutionalSizeResult {
  sizeUSD: number;
  kellyPct: number;
  rawKelly: number;
  volMultiplier: number;
  realizedVol: number;
  breakerReduction: boolean;
  winRate: number;
  momentumMultiplier: number;
  momentumBias: string;
}

/** Subset of AgentState needed for position sizing */
export interface PositionSizingState {
  tradeHistory: TradeRecord[];
  costBasis: Record<string, TokenCostBasis>;
}

/** Subset of BreakerState needed for position sizing */
export interface BreakerSizeState {
  breakerSizeReductionUntil: string | null;
}

/** Constants needed for Kelly sizing */
export interface KellyConstants {
  KELLY_FRACTION: number;
  KELLY_MIN_TRADES: number;
  KELLY_ROLLING_WINDOW: number;
  KELLY_POSITION_FLOOR_USD: number;
  KELLY_POSITION_CEILING_PCT: number;
  KELLY_SMALL_PORTFOLIO_CEILING_PCT: number;
  KELLY_SMALL_PORTFOLIO_THRESHOLD: number;
}

/** Constants needed for volatility sizing */
export interface VolatilityConstants {
  VOL_TARGET_DAILY_PCT: number;
  VOL_HIGH_THRESHOLD: number;
  VOL_HIGH_REDUCTION: number;
  VOL_LOW_THRESHOLD: number;
  VOL_LOW_BOOST: number;
}

// ============================================================================
// EFFECTIVE KELLY CEILING
// ============================================================================

/**
 * v10.3: Effective Kelly ceiling — scales up for small portfolios.
 */
export function getEffectiveKellyCeiling(
  portfolioValue: number,
  threshold: number,
  smallCeiling: number,
  normalCeiling: number,
): number {
  return portfolioValue < threshold ? smallCeiling : normalCeiling;
}

// ============================================================================
// KELLY POSITION SIZING
// ============================================================================

/**
 * Quarter Kelly Position Sizing.
 * Uses rolling window of recent trades to calculate mathematically optimal bet size.
 */
export function calculateKellyPositionSize(
  portfolioValue: number,
  state: PositionSizingState,
  kc: KellyConstants,
): KellyResult {
  const effectiveCeiling = getEffectiveKellyCeiling(
    portfolioValue, kc.KELLY_SMALL_PORTFOLIO_THRESHOLD,
    kc.KELLY_SMALL_PORTFOLIO_CEILING_PCT, kc.KELLY_POSITION_CEILING_PCT,
  );
  const recentTrades = state.tradeHistory.slice(-kc.KELLY_ROLLING_WINDOW);
  const sells = recentTrades.filter(t => {
    if (t.action !== 'SELL' || !t.success) return false;
    if (t.signalContext?.isExploration || (t.signalContext as any)?.isForced) return false;
    if (t.signalContext?.triggeredBy === "EXPLORATION" || (t.signalContext?.triggeredBy as string) === "FORCED_DEPLOY") return false;
    return true;
  });

  if (sells.length < kc.KELLY_MIN_TRADES) {
    const fallback = Math.min(Math.max(75, portfolioValue * 0.08), portfolioValue * (effectiveCeiling / 100));
    return { kellyUSD: fallback, kellyPct: (fallback / portfolioValue) * 100, rawKelly: 0, winRate: 0, avgWin: 0, avgLoss: 0 };
  }

  const wins: number[] = [];
  const losses: number[] = [];

  for (const trade of sells) {
    const cb = state.costBasis[trade.fromToken];
    if (!cb || cb.averageCostBasis <= 0) continue;
    const sellPrice = trade.amountUSD / (trade.tokenAmount || 1);
    const pnlPct = (sellPrice - cb.averageCostBasis) / cb.averageCostBasis;
    if (pnlPct >= 0) wins.push(pnlPct);
    else losses.push(Math.abs(pnlPct));
  }

  if (wins.length + losses.length < kc.KELLY_MIN_TRADES) {
    const fallback = Math.min(Math.max(75, portfolioValue * 0.08), portfolioValue * (effectiveCeiling / 100));
    return { kellyUSD: fallback, kellyPct: (fallback / portfolioValue) * 100, rawKelly: 0, winRate: 0, avgWin: 0, avgLoss: 0 };
  }

  // Cap win rate at 0.65 — no edge this strong is credible from a 20-50 trade sample;
  // guards against Kelly over-betting during lucky streaks.
  const winRate = Math.min(0.65, wins.length / (wins.length + losses.length));
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;

  const rawKelly = avgWin > 0 ? (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin : 0;

  // Sample confidence: sqrt(n/window) ramps from ~63% at KELLY_MIN_TRADES to 100% at full window.
  // Prevents overconfident sizing when win-rate estimate has high statistical uncertainty.
  const sampleConfidence = Math.min(1.0, Math.sqrt(sells.length / kc.KELLY_ROLLING_WINDOW));
  const quarterKelly = Math.max(0, rawKelly * kc.KELLY_FRACTION * sampleConfidence);
  const kellyPct = Math.min(quarterKelly * 100, effectiveCeiling);
  const kellyUSD = Math.max(kc.KELLY_POSITION_FLOOR_USD, Math.min(portfolioValue * (kellyPct / 100), portfolioValue * (effectiveCeiling / 100)));

  return { kellyUSD, kellyPct, rawKelly, winRate, avgWin, avgLoss };
}

// ============================================================================
// VOLATILITY MULTIPLIER
// ============================================================================

/**
 * Volatility-Adjusted Position Sizing.
 * Scales position size inversely with recent portfolio volatility.
 * Returns a multiplier (0.4 to 1.5) to apply to Kelly size.
 */
export function calculateVolatilityMultiplier(
  state: PositionSizingState,
  vc: VolatilityConstants,
): VolatilityResult {
  const trades = state.tradeHistory.slice(-100);
  const portfolioValues = trades
    .map(t => t.portfolioValueAfter || t.portfolioValueBefore || 0)
    .filter(v => v > 0);

  if (portfolioValues.length < 5) {
    return { multiplier: 1.0, realizedVol: vc.VOL_TARGET_DAILY_PCT };
  }

  const returns: number[] = [];
  for (let i = 1; i < portfolioValues.length; i++) {
    if (portfolioValues[i - 1] > 0) {
      returns.push((portfolioValues[i] - portfolioValues[i - 1]) / portfolioValues[i - 1] * 100);
    }
  }

  if (returns.length < 3) {
    return { multiplier: 1.0, realizedVol: vc.VOL_TARGET_DAILY_PCT };
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const realizedVol = Math.sqrt(variance);

  let multiplier: number;
  if (realizedVol > vc.VOL_HIGH_THRESHOLD) {
    multiplier = vc.VOL_HIGH_REDUCTION;
  } else if (realizedVol < vc.VOL_LOW_THRESHOLD) {
    multiplier = vc.VOL_LOW_BOOST;
  } else {
    multiplier = Math.max(0.4, Math.min(1.5, vc.VOL_TARGET_DAILY_PCT / realizedVol));
  }

  return { multiplier, realizedVol };
}

// ============================================================================
// INSTITUTIONAL POSITION SIZING (MASTER SIZER)
// ============================================================================

/**
 * Master position sizer — combines Kelly + Volatility + Breaker + Momentum.
 * @param momentumSignal  Pre-computed market momentum signal
 * @param breakerState  Current breaker size reduction state
 * @param cashDeploymentMode  Whether cash deployment mode is active
 * @param breakerSizeReduction  BREAKER_SIZE_REDUCTION constant
 */
export function calculateInstitutionalPositionSize(
  portfolioValue: number,
  state: PositionSizingState,
  kc: KellyConstants,
  vc: VolatilityConstants,
  momentumSignal: MarketMomentumSignal,
  breakerState: BreakerSizeState,
  cashDeploymentMode: boolean,
  breakerSizeReduction: number,
): InstitutionalSizeResult {
  const kelly = calculateKellyPositionSize(portfolioValue, state, kc);
  const vol = calculateVolatilityMultiplier(state, vc);

  let sizeUSD = kelly.kellyUSD * vol.multiplier * momentumSignal.positionMultiplier;

  let breakerReduction = false;
  if (breakerState.breakerSizeReductionUntil) {
    const until = new Date(breakerState.breakerSizeReductionUntil).getTime();
    if (Date.now() < until) {
      if (cashDeploymentMode) {
        console.log(`   ⚡ BREAKER SIZE REDUCTION BYPASSED — cash deployment mode active`);
      } else {
        sizeUSD *= breakerSizeReduction;
        breakerReduction = true;
      }
    }
  }

  const effectiveCeiling = getEffectiveKellyCeiling(
    portfolioValue, kc.KELLY_SMALL_PORTFOLIO_THRESHOLD,
    kc.KELLY_SMALL_PORTFOLIO_CEILING_PCT, kc.KELLY_POSITION_CEILING_PCT,
  );
  sizeUSD = Math.max(kc.KELLY_POSITION_FLOOR_USD, Math.min(sizeUSD, portfolioValue * (effectiveCeiling / 100)));

  return {
    sizeUSD: Math.round(sizeUSD * 100) / 100,
    kellyPct: kelly.kellyPct,
    rawKelly: kelly.rawKelly,
    volMultiplier: vol.multiplier,
    realizedVol: vol.realizedVol,
    breakerReduction,
    winRate: kelly.winRate,
    momentumMultiplier: momentumSignal.positionMultiplier,
    momentumBias: momentumSignal.deploymentBias,
  };
}
