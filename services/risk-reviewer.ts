/**
 * Adversarial Risk Reviewer — v20.0
 *
 * A "devil's advocate" that challenges every trade decision before execution.
 * Inspired by TradingAgents' Bull vs Bear debate architecture.
 *
 * Instead of blindly executing the AI's trade decisions, the Risk Reviewer
 * runs a series of deterministic checks that look for reasons NOT to trade.
 * Each objection carries a severity weight. If total objections exceed the
 * threshold, the trade is blocked or size-reduced.
 *
 * This is NOT a duplicate of circuit breakers — those are portfolio-level.
 * The Risk Reviewer is per-trade, looking at the specific token + conditions.
 *
 * NO Claude API calls — pure deterministic logic, zero cost, zero latency.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface RiskReviewInput {
  symbol: string;
  action: 'BUY' | 'SELL';
  amountUSD: number;
  portfolioValue: number;
  cashPercent: number;
  // Token indicators
  rsi?: number;
  macdSignal?: string;          // 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  confluenceScore?: number;
  atrPercent?: number;
  buyRatio?: number;            // 0-1 range
  priceChange24h?: number;      // percent
  priceChange7d?: number;       // percent
  // Position data
  existingPositionUSD?: number;
  existingGainPct?: number;
  costBasis?: number;
  // Market context
  fearGreedIndex?: number;
  fearGreedClassification?: string;
  marketRegime?: string;
  btcChange24h?: number;
  ethChange24h?: number;
  // Portfolio health
  numLosingPositions?: number;
  numTotalPositions?: number;
  drawdownPct?: number;
  // Trade history
  recentConsecutiveLosses?: number;
  winRateLast20?: number;
}

export interface RiskObjection {
  check: string;           // Name of the check
  severity: number;        // 1-10 (10 = most severe)
  reason: string;          // Human-readable explanation
}

export interface RiskReviewResult {
  approved: boolean;                 // Whether the trade should proceed
  objections: RiskObjection[];       // List of all objections raised
  totalSeverity: number;             // Sum of objection severities
  sizeReduction: number;             // Recommended size reduction multiplier (0-1)
  recommendation: string;            // Human-readable verdict
}

// ============================================================================
// CONFIGURATION
// ============================================================================

// Severity thresholds
const BLOCK_THRESHOLD = 20;
const REDUCE_THRESHOLD = 10;
const REDUCE_SIZE_MULTIPLIER = 0.5;

// Buy check thresholds
const PUMP_PRICE_CHANGE_PCT = 15;
const PUMP_RSI_THRESHOLD = 70;
const FALLING_KNIFE_CONFLUENCE = -15;
const SELLER_DOMINATED_BUY_RATIO = 0.40;
const EXTREME_GREED_FG = 80;
const OVER_CONCENTRATED_PCT = 20;
const ADDING_TO_LOSER_PCT = -10;
const OVERSIZED_TRADE_PCT = 0.15;
const HIGH_VOL_ATR_PCT = 8;
const HIGH_VOL_MIN_CONFLUENCE = 30;
const SUSTAINED_DOWNTREND_7D_PCT = -20;
const LOW_CASH_PCT = 15;

// Portfolio check thresholds
const PORTFOLIO_DD_SEVERITY_PCT = 12;
const CORRELATION_CRISIS_PCT = 70;
const LOSING_STREAK_THRESHOLD = 4;
const LOW_WIN_RATE_THRESHOLD = 0.35;

// ============================================================================
// RISK REVIEW ENGINE
// ============================================================================

/**
 * Run the adversarial risk review on a proposed trade.
 * Returns objections and a final recommendation.
 */
export function reviewTrade(input: RiskReviewInput): RiskReviewResult {
  const objections: RiskObjection[] = [];

  if (input.action === 'BUY') {
    reviewBuy(input, objections);
  } else {
    reviewSell(input, objections);
  }

  // Always run portfolio-level checks
  reviewPortfolioHealth(input, objections);

  const totalSeverity = objections.reduce((sum, o) => sum + o.severity, 0);

  let approved = true;
  let sizeReduction = 1.0;
  let recommendation = '';

  if (totalSeverity >= BLOCK_THRESHOLD) {
    approved = false;
    sizeReduction = 0;
    recommendation = `BLOCKED: ${objections.length} objections (severity ${totalSeverity}/${BLOCK_THRESHOLD}). Top: ${objections.sort((a, b) => b.severity - a.severity)[0]?.reason || 'unknown'}`;
  } else if (totalSeverity >= REDUCE_THRESHOLD) {
    approved = true;
    sizeReduction = REDUCE_SIZE_MULTIPLIER;
    recommendation = `REDUCED: ${objections.length} objections (severity ${totalSeverity}). Size ×${REDUCE_SIZE_MULTIPLIER}. Concerns: ${objections.map(o => o.check).join(', ')}`;
  } else if (objections.length > 0) {
    recommendation = `APPROVED with ${objections.length} minor concern(s): ${objections.map(o => o.check).join(', ')}`;
  } else {
    recommendation = 'APPROVED: no objections';
  }

  return { approved, objections, totalSeverity, sizeReduction, recommendation };
}

// ============================================================================
// BUY-SPECIFIC CHECKS
// ============================================================================

function reviewBuy(input: RiskReviewInput, objections: RiskObjection[]): void {
  const {
    symbol, amountUSD, portfolioValue, rsi, macdSignal, confluenceScore,
    buyRatio, priceChange24h, priceChange7d, fearGreedIndex,
    atrPercent, existingPositionUSD, existingGainPct,
  } = input;

  // 1. Chasing a pump — price already up big with overbought RSI
  if ((priceChange24h ?? 0) > PUMP_PRICE_CHANGE_PCT && (rsi ?? 50) > PUMP_RSI_THRESHOLD) {
    objections.push({
      check: 'CHASING_PUMP',
      severity: 8,
      reason: `${symbol} already up ${priceChange24h?.toFixed(1)}% in 24h with RSI ${rsi?.toFixed(0)} — chasing`,
    });
  }

  // 2. Bearish MACD with negative confluence — falling knife
  if (macdSignal === 'BEARISH' && (confluenceScore ?? 0) < FALLING_KNIFE_CONFLUENCE) {
    objections.push({
      check: 'FALLING_KNIFE',
      severity: 7,
      reason: `${symbol} bearish MACD + negative confluence (${confluenceScore?.toFixed(0)}) — falling knife`,
    });
  }

  // 3. Sellers dominating order flow
  if (buyRatio !== undefined && buyRatio < SELLER_DOMINATED_BUY_RATIO) {
    objections.push({
      check: 'SELLER_DOMINATED',
      severity: 6,
      reason: `${symbol} buy ratio ${(buyRatio * 100).toFixed(0)}% — sellers in control`,
    });
  }

  // 4. Extreme greed + buying — everyone else is already in
  if ((fearGreedIndex ?? 50) > EXTREME_GREED_FG) {
    objections.push({
      check: 'EXTREME_GREED',
      severity: 4,
      reason: `Fear & Greed at ${fearGreedIndex} (extreme greed) — late to the party`,
    });
  }

  // 5. Position concentration — already have a big position in this token
  if (existingPositionUSD && portfolioValue > 0) {
    const positionPct = (existingPositionUSD / portfolioValue) * 100;
    if (positionPct > OVER_CONCENTRATED_PCT) {
      objections.push({
        check: 'OVER_CONCENTRATED',
        severity: 6,
        reason: `${symbol} already ${positionPct.toFixed(1)}% of portfolio — over-concentrated`,
      });
    }
  }

  // 6. Adding to a loser — existing position is underwater
  if ((existingGainPct ?? 0) < ADDING_TO_LOSER_PCT && (existingPositionUSD ?? 0) > 0) {
    objections.push({
      check: 'ADDING_TO_LOSER',
      severity: 5,
      reason: `${symbol} existing position down ${existingGainPct?.toFixed(1)}% — averaging down is risky`,
    });
  }

  // 7. Trade size too large relative to portfolio
  if (portfolioValue > 0 && amountUSD > portfolioValue * OVERSIZED_TRADE_PCT) {
    objections.push({
      check: 'OVERSIZED_TRADE',
      severity: 5,
      reason: `$${amountUSD.toFixed(0)} is ${((amountUSD / portfolioValue) * 100).toFixed(1)}% of portfolio — oversized`,
    });
  }

  // 8. High volatility token without proportional confluence
  if ((atrPercent ?? 0) > HIGH_VOL_ATR_PCT && Math.abs(confluenceScore ?? 0) < HIGH_VOL_MIN_CONFLUENCE) {
    objections.push({
      check: 'HIGH_VOL_WEAK_SIGNAL',
      severity: 4,
      reason: `${symbol} ATR ${atrPercent?.toFixed(1)}% (high vol) but weak confluence (${confluenceScore?.toFixed(0)}) — noise trade`,
    });
  }

  // 9. Sustained downtrend — 7d price significantly negative
  if ((priceChange7d ?? 0) < SUSTAINED_DOWNTREND_7D_PCT) {
    objections.push({
      check: 'SUSTAINED_DOWNTREND',
      severity: 5,
      reason: `${symbol} down ${priceChange7d?.toFixed(1)}% over 7 days — sustained downtrend`,
    });
  }

  // 10. Low cash reserves — keep powder dry
  if ((input.cashPercent ?? 100) < LOW_CASH_PCT) {
    objections.push({
      check: 'LOW_CASH',
      severity: 3,
      reason: `Cash at ${input.cashPercent?.toFixed(1)}% — limited ability to buy dips`,
    });
  }
}

// ============================================================================
// SELL-SPECIFIC CHECKS
// ============================================================================

function reviewSell(input: RiskReviewInput, objections: RiskObjection[]): void {
  const { symbol, rsi, macdSignal, buyRatio, existingGainPct, priceChange24h } = input;

  // 1. Panic selling during a recovery — RSI climbing with bullish MACD
  if ((rsi ?? 50) > 40 && (rsi ?? 50) < 60 && macdSignal === 'BULLISH' && (priceChange24h ?? 0) > 2) {
    objections.push({
      check: 'SELLING_INTO_RECOVERY',
      severity: 5,
      reason: `${symbol} showing recovery signs (RSI ${rsi?.toFixed(0)}, MACD bullish, +${priceChange24h?.toFixed(1)}% 24h) — may be premature sell`,
    });
  }

  // 2. Selling a big winner too early
  if ((existingGainPct ?? 0) > 20 && (buyRatio ?? 0.5) > 0.55) {
    objections.push({
      check: 'CUTTING_WINNER_EARLY',
      severity: 4,
      reason: `${symbol} up ${existingGainPct?.toFixed(1)}% with buy ratio ${((buyRatio ?? 0) * 100).toFixed(0)}% — let winners run`,
    });
  }
}

// ============================================================================
// PORTFOLIO-LEVEL CHECKS
// ============================================================================

function reviewPortfolioHealth(input: RiskReviewInput, objections: RiskObjection[]): void {
  const { drawdownPct, numLosingPositions, numTotalPositions, recentConsecutiveLosses, winRateLast20 } = input;

  // 1. Portfolio in significant drawdown
  if ((drawdownPct ?? 0) > PORTFOLIO_DD_SEVERITY_PCT) {
    objections.push({
      check: 'PORTFOLIO_DRAWDOWN',
      severity: 6,
      reason: `Portfolio in ${drawdownPct?.toFixed(1)}% drawdown — reduce risk`,
    });
  }

  // 2. Correlation crisis — majority of positions losing
  if (numLosingPositions && numTotalPositions && numTotalPositions > 3) {
    const losingPct = (numLosingPositions / numTotalPositions) * 100;
    if (losingPct >= CORRELATION_CRISIS_PCT) {
      objections.push({
        check: 'CORRELATION_CRISIS',
        severity: 8,
        reason: `${numLosingPositions}/${numTotalPositions} positions losing (${losingPct.toFixed(0)}%) — systemic sell-off`,
      });
    }
  }

  // 3. Losing streak
  if ((recentConsecutiveLosses ?? 0) >= LOSING_STREAK_THRESHOLD) {
    objections.push({
      check: 'LOSING_STREAK',
      severity: 5,
      reason: `${recentConsecutiveLosses} consecutive losses — strategy may be miscalibrated`,
    });
  }

  // 4. Low win rate
  if (winRateLast20 !== undefined && winRateLast20 < LOW_WIN_RATE_THRESHOLD) {
    objections.push({
      check: 'LOW_WIN_RATE',
      severity: 4,
      reason: `Win rate ${(winRateLast20 * 100).toFixed(0)}% over last 20 trades — below 35% threshold`,
    });
  }
}

// ============================================================================
// ENHANCED DRAWDOWN CONTROLS
// ============================================================================

export interface DrawdownState {
  dailyHighValue: number;
  dailyHighTimestamp: string;
  weeklyHighValue: number;
  weeklyHighTimestamp: string;
  dailyHaltActive: boolean;
  dailyHaltUntil: string | null;
  weeklyDefensiveMode: boolean;
  weeklyDefensiveUntil: string | null;
}

const DAILY_HALT_DRAWDOWN_PCT = 5;     // Halt all new buys if portfolio drops 5% in 24h
const DAILY_HALT_DURATION_HOURS = 4;   // Resume after 4 hours
const WEEKLY_DEFENSIVE_DD_PCT = 10;    // Enter defensive mode if down 10% in 7 days
const WEEKLY_DEFENSIVE_DURATION_HOURS = 24; // Stay defensive for 24 hours

let drawdownState: DrawdownState = {
  dailyHighValue: 0,
  dailyHighTimestamp: new Date().toISOString(),
  weeklyHighValue: 0,
  weeklyHighTimestamp: new Date().toISOString(),
  dailyHaltActive: false,
  dailyHaltUntil: null,
  weeklyDefensiveMode: false,
  weeklyDefensiveUntil: null,
};

const MS_PER_HOUR = 60 * 60 * 1000;

function updateHighWaterMark(
  currentValue: number, highValue: number, highTimestamp: string, maxAgeMs: number, nowMs: number
): { value: number; timestamp: string } {
  const age = nowMs - new Date(highTimestamp).getTime();
  if (age > maxAgeMs || currentValue > highValue) {
    return { value: currentValue, timestamp: new Date(nowMs).toISOString() };
  }
  return { value: highValue, timestamp: highTimestamp };
}

/**
 * Update drawdown tracking with current portfolio value. Called every cycle.
 */
export function updateDrawdownTracking(currentValue: number): DrawdownState {
  const nowMs = Date.now();
  const nowISO = new Date(nowMs).toISOString();

  // Update high-water marks
  const daily = updateHighWaterMark(currentValue, drawdownState.dailyHighValue, drawdownState.dailyHighTimestamp, 24 * MS_PER_HOUR, nowMs);
  drawdownState.dailyHighValue = daily.value;
  drawdownState.dailyHighTimestamp = daily.timestamp;

  const weekly = updateHighWaterMark(currentValue, drawdownState.weeklyHighValue, drawdownState.weeklyHighTimestamp, 7 * 24 * MS_PER_HOUR, nowMs);
  drawdownState.weeklyHighValue = weekly.value;
  drawdownState.weeklyHighTimestamp = weekly.timestamp;

  // Check daily drawdown → halt
  if (drawdownState.dailyHighValue > 0 && !drawdownState.dailyHaltActive) {
    const dailyDD = ((drawdownState.dailyHighValue - currentValue) / drawdownState.dailyHighValue) * 100;
    if (dailyDD >= DAILY_HALT_DRAWDOWN_PCT) {
      drawdownState.dailyHaltActive = true;
      drawdownState.dailyHaltUntil = new Date(nowMs + DAILY_HALT_DURATION_HOURS * MS_PER_HOUR).toISOString();
      console.log(`\n  🚨 DAILY DRAWDOWN HALT: Portfolio dropped ${dailyDD.toFixed(1)}% today. Halting buys until ${drawdownState.dailyHaltUntil}`);
    }
  }

  // Check weekly drawdown → defensive mode
  if (drawdownState.weeklyHighValue > 0 && !drawdownState.weeklyDefensiveMode) {
    const weeklyDD = ((drawdownState.weeklyHighValue - currentValue) / drawdownState.weeklyHighValue) * 100;
    if (weeklyDD >= WEEKLY_DEFENSIVE_DD_PCT) {
      drawdownState.weeklyDefensiveMode = true;
      drawdownState.weeklyDefensiveUntil = new Date(nowMs + WEEKLY_DEFENSIVE_DURATION_HOURS * MS_PER_HOUR).toISOString();
      console.log(`\n  🚨 WEEKLY DEFENSIVE MODE: Portfolio dropped ${weeklyDD.toFixed(1)}% this week. Defensive until ${drawdownState.weeklyDefensiveUntil}`);
    }
  }

  // Clear expired halts
  if (drawdownState.dailyHaltActive && drawdownState.dailyHaltUntil && nowMs >= new Date(drawdownState.dailyHaltUntil).getTime()) {
    drawdownState.dailyHaltActive = false;
    drawdownState.dailyHaltUntil = null;
    console.log(`  ✅ Daily drawdown halt expired — resuming normal trading`);
  }
  if (drawdownState.weeklyDefensiveMode && drawdownState.weeklyDefensiveUntil && nowMs >= new Date(drawdownState.weeklyDefensiveUntil).getTime()) {
    drawdownState.weeklyDefensiveMode = false;
    drawdownState.weeklyDefensiveUntil = null;
    console.log(`  ✅ Weekly defensive mode expired — resuming normal trading`);
  }

  return drawdownState;
}

/**
 * Check if a trade is allowed given current drawdown state.
 */
export function isTradeAllowedByDrawdown(action: 'BUY' | 'SELL'): { allowed: boolean; reason: string } {
  // Sells are always allowed (need to be able to cut losses)
  if (action === 'SELL') return { allowed: true, reason: '' };

  if (drawdownState.dailyHaltActive) {
    return { allowed: false, reason: `Daily drawdown halt active until ${drawdownState.dailyHaltUntil}` };
  }

  // Weekly defensive mode: allow buys but at reduced size (caller handles reduction)
  return { allowed: true, reason: drawdownState.weeklyDefensiveMode ? 'WEEKLY_DEFENSIVE' : '' };
}

/**
 * Get current drawdown state for API/dashboard.
 */
export function getDrawdownState(): DrawdownState {
  return { ...drawdownState };
}

/**
 * Restore drawdown state from persisted data (called at startup).
 */
export function restoreDrawdownState(saved: Partial<DrawdownState>): void {
  if (!saved || typeof saved !== 'object') return;
  const validated: Partial<DrawdownState> = {};
  if (typeof saved.dailyHighValue === 'number' && saved.dailyHighValue >= 0) validated.dailyHighValue = saved.dailyHighValue;
  if (typeof saved.dailyHighTimestamp === 'string') validated.dailyHighTimestamp = saved.dailyHighTimestamp;
  if (typeof saved.weeklyHighValue === 'number' && saved.weeklyHighValue >= 0) validated.weeklyHighValue = saved.weeklyHighValue;
  if (typeof saved.weeklyHighTimestamp === 'string') validated.weeklyHighTimestamp = saved.weeklyHighTimestamp;
  if (typeof saved.dailyHaltActive === 'boolean') validated.dailyHaltActive = saved.dailyHaltActive;
  if (saved.dailyHaltUntil === null || typeof saved.dailyHaltUntil === 'string') validated.dailyHaltUntil = saved.dailyHaltUntil;
  if (typeof saved.weeklyDefensiveMode === 'boolean') validated.weeklyDefensiveMode = saved.weeklyDefensiveMode;
  if (saved.weeklyDefensiveUntil === null || typeof saved.weeklyDefensiveUntil === 'string') validated.weeklyDefensiveUntil = saved.weeklyDefensiveUntil;
  drawdownState = { ...drawdownState, ...validated };
}
