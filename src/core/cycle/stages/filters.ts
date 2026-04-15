/**
 * Never Rest Capital — Cycle Stage: FILTERS
 *
 * Phase 5f. Extracts the pure, stateless predicate functions from the
 * per-trade guard loop in agent-v3.2.ts (L7100–7650).
 *
 * ## What's extracted here
 *
 * Three pure helpers that are the highest unit-test-value pieces in the
 * entire cycle — bugs here cost real money:
 *
 *   computeDecisionPriority(decision)
 *     Maps a decision's reasoning tier to a sort priority number.
 *     Used by the TRADE_CAP guard to decide which decisions survive when
 *     the per-cycle cap is hit. Wrong priorities → wrong trades get dropped.
 *
 *   checkRiskReward(decision, priceHistory, currentPrice, sectorStopPct)
 *     Computes the reward/risk ratio for a BUY decision using the 30-day
 *     price history. Tokens within 5% of their 30d high get blocked (limited
 *     upside). Below 2:1 R:R gets blocked. Pure: no I/O, no state.
 *
 *   applySectorCapGuard(decision, currentHoldingUSD, portfolioValue, sectorLimitPct, isScaleUp)
 *     Enforces the per-sector position size cap. If a BUY would push the
 *     holding above the sector % limit, the amount is trimmed to fit. If
 *     the trimmed amount is < $5, the decision is converted to HOLD.
 *     Pure: takes numbers in, returns a mutated copy of the decision.
 *
 * ## What's NOT here (still in the monolith)
 *
 *   - Capital preservation filter (L7040–7100) — reads capitalPreservationMode state
 *   - Directive sell enforcement (L7100–7200) — reads activeDirectives + balances
 *   - Trade cap guard loop (L7200–7270) — uses these helpers but needs decisions array
 *   - Capital liberation (L7270–7360) — calls executeTrade (execution stage territory)
 *   - Per-trade sizing multipliers (Kelly, ATR, alpha, sector boost, directive) — too many
 *     cross-cutting constants; extracted as helpers when execution stage lands
 *
 * The stage wrapper (filtersStage) is a no-op today — it pushes 'FILTERS' to
 * stagesCompleted. The real orchestration still runs inline in agent-v3.2.ts.
 * This file exists so the pure helpers can be imported + unit-tested now, and
 * the stage body can be filled in once decision + execution stages are extracted.
 */

import type { CycleContext } from '../../types/cycle.js';
import type { TradeDecision } from '../../types/market-data.js';

// ============================================================================
// TYPES
// ============================================================================

/** Token price history store — matches getPriceHistoryStore() shape. */
export interface TokenPriceHistory {
  /** Hourly price samples, oldest first. */
  prices: number[];
}

/** Result from checkRiskReward. */
export interface RiskRewardResult {
  /** Whether the BUY passes the R:R filter. */
  pass: boolean;
  /** Human-readable reason — logged to console by the caller. */
  reason: string;
  /** The R:R ratio computed (undefined when no price history available). */
  ratio?: number;
  /** Distance below 30-day high, as a percent (undefined when no history). */
  distFromHighPct?: number;
}

/** Result from applySectorCapGuard. */
export interface SectorCapResult {
  /**
   * The (possibly trimmed) buy amount in USD.
   * 0 means the decision should be converted to HOLD.
   */
  trimmedAmountUSD: number;
  /** Whether the decision was trimmed (amount reduced). */
  trimmed: boolean;
  /** Whether the decision was blocked entirely (amount → 0). */
  blocked: boolean;
  /** Human-readable reason for trim/block. */
  reason?: string;
}

// ============================================================================
// PURE HELPER: computeDecisionPriority
// ============================================================================

/**
 * Map a trade decision to a numeric priority for the TRADE_CAP sort.
 *
 * Lower number = higher priority = survives the cap.
 * Mirrors the `priorityOrder` inner function in agent-v3.2.ts L7220–7255.
 *
 * Pure — no side effects, no I/O.
 */
export function computeDecisionPriority(decision: TradeDecision): number {
  const tier = decision.reasoning?.match(/^([A-Z_]+):/)?.[1] ?? 'AI';

  switch (tier) {
    case 'HARD_STOP':               return -1;      // absolute loss limit — always first
    case 'TRAILING_STOP':           return -0.8;    // adaptive trailing exit
    case 'SOFT_STOP':               return -0.5;    // approaching loss limit
    case 'CONCENTRATED_STOP':       return -0.5;    // concentrated loser exit
    case 'STOP_LOSS':               return 0;
    case 'DIRECTIVE_SELL_ESCALATED':return 0.3;     // >24h directive on losing position
    case 'DIRECTIVE_SELL':          return 0.5;     // user directive enforcement
    case 'FLOW_REVERSAL':           return 0.7;     // flow physics exit
    case 'MOMENTUM_EXIT':           return 1;
    case 'DECEL_TRIM':              return 1.5;     // deceleration trim
    case 'PROFIT_TAKE':             return 2;
    case 'AI':                      return 3;       // default / untagged Claude decision
    case 'SCALE_UP':                return 4;
    case 'FORCED_DEPLOY':           return 5;
    case 'DEPLOYMENT_FALLBACK':     return 5;
    case 'RIDE_THE_WAVE':           return 6;
    case 'SCOUT':                   return 7;       // lowest — data probes seed last
    default:                        return 3;       // unknown tier → treat as AI
  }
}

// ============================================================================
// PURE HELPER: checkRiskReward
// ============================================================================

/**
 * Evaluate the reward/risk ratio for a BUY decision.
 *
 * Logic (from agent-v3.2.ts L7280–7330):
 *   - Look at the last 720 hourly price samples (≈30 days).
 *   - Find the 30-day high.
 *   - `rewardPct` = distance below that high.
 *   - `riskPct`   = sector stop-loss percent (absolute value).
 *   - If distFromHigh < 5% → block (too close to high, limited upside).
 *   - If rewardPct / riskPct < 2.0 → block (minimum 2:1 R:R).
 *   - If no price history → pass with default 3:1 assumed ratio.
 *
 * Applies only to BUY decisions — all others pass unconditionally.
 *
 * Pure — no side effects, no I/O.
 *
 * @param decision        The trade decision to evaluate.
 * @param priceHistory    Hourly price samples for the token (may be empty).
 * @param currentPrice    Current token price in USD.
 * @param sectorStopPct   Absolute sector stop-loss percentage (e.g. 5 = 5%).
 */
export function checkRiskReward(
  decision:       TradeDecision,
  priceHistory:   TokenPriceHistory,
  currentPrice:   number,
  sectorStopPct:  number,
): RiskRewardResult {
  // Only filter BUY decisions
  if (decision.action !== 'BUY') {
    return { pass: true, reason: 'non-BUY action — R:R filter skipped' };
  }

  const token = decision.toToken ?? '?';
  const riskPct = Math.abs(sectorStopPct);

  // No price history → assume 3:1 R:R (pass)
  if (!priceHistory?.prices?.length || priceHistory.prices.length < 10 || currentPrice <= 0) {
    return {
      pass:   true,
      reason: `${token}: no price history — assuming 3:1 R:R default`,
      ratio:  3,
    };
  }

  // Use last 720 samples (≈30 days of hourly data)
  const recentPrices = priceHistory.prices.slice(-720);
  const high30d = Math.max(...recentPrices);

  if (high30d <= 0) {
    return { pass: true, reason: `${token}: invalid 30d high — skipping R:R check` };
  }

  const distFromHighPct = ((high30d - currentPrice) / currentPrice) * 100;

  // Block: token within 5% of 30-day high
  if (distFromHighPct < 5) {
    return {
      pass:           false,
      reason:         `${token}: only ${distFromHighPct.toFixed(1)}% below 30d high ($${high30d.toFixed(4)}) — limited upside`,
      ratio:          distFromHighPct / riskPct,
      distFromHighPct,
    };
  }

  const rewardPct = distFromHighPct;
  const ratio     = rewardPct / riskPct;

  if (ratio < 2.0) {
    return {
      pass:           false,
      reason:         `${token}: R:R ${ratio.toFixed(1)}:1 (risk ${riskPct}%, reward ${rewardPct.toFixed(1)}%) below 2:1 minimum`,
      ratio,
      distFromHighPct,
    };
  }

  return {
    pass:           true,
    reason:         `${token}: R:R ${ratio.toFixed(1)}:1 — passes`,
    ratio,
    distFromHighPct,
  };
}

// ============================================================================
// PURE HELPER: applySectorCapGuard
// ============================================================================

/**
 * Enforce the per-sector maximum position size on a BUY decision.
 *
 * Logic (from agent-v3.2.ts L7570–7620):
 *   - Compute `afterBuyPercent = (currentHolding + buyAmount) / portfolioValue * 100`.
 *   - If afterBuyPercent > sectorLimitPct → trim the buy to fit within the cap.
 *   - If the trimmed amount is < $5 → block entirely (return trimmedAmountUSD = 0).
 *   - Scale-up / ride-the-wave tiers can use a higher momentum cap (caller passes
 *     the correct sectorLimitPct — this function does not look up the registry).
 *
 * Only applied to BUY decisions on non-USDC tokens.
 *
 * Pure — no side effects, no I/O.
 *
 * @param decision          The trade decision to evaluate (not mutated).
 * @param currentHoldingUSD Current USD value already held in this token.
 * @param portfolioValue    Total portfolio value in USD.
 * @param sectorLimitPct    The effective sector cap percentage (e.g. 20 = 20%).
 */
export function applySectorCapGuard(
  decision:          TradeDecision,
  currentHoldingUSD: number,
  portfolioValue:    number,
  sectorLimitPct:    number,
): SectorCapResult {
  // Only applies to BUY decisions on non-USDC tokens with a valid portfolio value
  if (
    decision.action !== 'BUY' ||
    decision.toToken === 'USDC' ||
    portfolioValue <= 0
  ) {
    return { trimmedAmountUSD: decision.amountUSD, trimmed: false, blocked: false };
  }

  const token = decision.toToken ?? '?';
  const afterBuyUSD     = currentHoldingUSD + decision.amountUSD;
  const afterBuyPercent = (afterBuyUSD / portfolioValue) * 100;

  if (afterBuyPercent <= sectorLimitPct) {
    // Within cap — no change
    return { trimmedAmountUSD: decision.amountUSD, trimmed: false, blocked: false };
  }

  // Compute the most we can add without breaching the cap
  const maxBuyUSD = Math.max(0, (sectorLimitPct / 100) * portfolioValue - currentHoldingUSD);

  if (maxBuyUSD >= 5) {
    return {
      trimmedAmountUSD: maxBuyUSD,
      trimmed:          true,
      blocked:          false,
      reason:           `${token} trimmed $${decision.amountUSD.toFixed(2)} → $${maxBuyUSD.toFixed(2)} (${sectorLimitPct}% sector cap)`,
    };
  }

  // At or beyond cap — block entirely
  const currentPct = (currentHoldingUSD / portfolioValue * 100).toFixed(1);
  return {
    trimmedAmountUSD: 0,
    trimmed:          false,
    blocked:          true,
    reason:           `${token} at ${currentPct}% of portfolio — at sector limit ${sectorLimitPct}%. No room.`,
  };
}

// ============================================================================
// STAGE WRAPPER
// ============================================================================

/**
 * Dependencies injected into filtersStage.
 *
 * Both fields are optional at the call-site — the stage supplies safe defaults
 * so the monolith can call it without wiring up the full dep graph yet.
 */
export interface FiltersStageDeps {
  /**
   * 30-day hourly price samples per token for R:R evaluation.
   * Return [] if unavailable — checkRiskReward passes by default.
   */
  getPriceHistory(symbol: string): number[];

  /**
   * Regime-aware max trades per cycle.
   * Mirrors CONFIG.trading.maxTradesPerCycle with RANGING override.
   */
  maxTradesPerCycle: number;
}

/**
 * filtersStage — Phase 5f CycleStageFn wrapper.
 *
 * Runs four passes over ctx.decisions:
 *   Pass 1 — sort all non-HOLD decisions by priority (HARD_STOP first, SCOUT last)
 *   Pass 2 — trade cap: keep top maxTrades non-HOLD decisions, HOLDs always survive
 *   Pass 3 — R:R filter: BUYs that fail the 2:1 reward/risk check become HOLD
 *   Pass 4 — sector cap: BUYs that would breach the 20% sector limit are trimmed or blocked
 *
 * Preservation and directives are no-ops this phase (pushed to stagesCompleted
 * but not filtered — that logic lands in Phase 5h with the real decisionStage).
 */
export async function filtersStage(
  ctx: CycleContext,
  deps?: FiltersStageDeps,
): Promise<CycleContext> {
  if (ctx.halted) return ctx;

  const priceHistory = deps?.getPriceHistory ?? (() => []);
  const maxTrades    = deps?.maxTradesPerCycle ?? 5;

  // Pass 1 — sort by priority (HARD_STOP first, SCOUT last)
  {
    const actions = ctx.decisions.filter(d => d.action !== 'HOLD');
    const holds   = ctx.decisions.filter(d => d.action === 'HOLD');
    actions.sort((a, b) => computeDecisionPriority(a) - computeDecisionPriority(b));
    ctx.decisions = [...actions, ...holds];
  }

  // Pass 2 — trade cap (keep top maxTrades non-HOLD decisions)
  // HOLDs always pass through — they have no execution cost
  {
    const actions = ctx.decisions.filter(d => d.action !== 'HOLD');
    const holds   = ctx.decisions.filter(d => d.action === 'HOLD');
    if (actions.length > maxTrades) {
      ctx.decisions = [...actions.slice(0, maxTrades), ...holds];
    }
  }

  // Pass 3 — R:R filter on BUYs using checkRiskReward
  // Failed BUYs are converted to HOLD (mirrors monolith L7122–7170)
  ctx.decisions = ctx.decisions.map(d => {
    if (d.action !== 'BUY') return d;
    const symbol       = d.toToken ?? '';
    const prices       = priceHistory(symbol);
    const currentPrice = ctx.currentPrices[symbol] ?? 0;
    const rr           = checkRiskReward(d, { prices }, currentPrice, 5);
    if (!rr.pass) {
      return { ...d, action: 'HOLD', reasoning: `R:R_FILTER: ${rr.reason}` };
    }
    return d;
  });

  // Pass 4 — sector cap using applySectorCapGuard
  // Trimmed BUYs get their amountUSD reduced; blocked BUYs become HOLD
  // (mirrors monolith L7570–7620)
  {
    const portfolioValue = ctx.balances.reduce((sum, b) => sum + (b.usdValue ?? 0), 0);
    ctx.decisions = ctx.decisions.map(d => {
      if (d.action !== 'BUY') return d;
      const symbol            = d.toToken ?? '';
      const currentHoldingUSD = ctx.balances.find(b => b.symbol === symbol)?.usdValue ?? 0;
      const cap               = applySectorCapGuard(d, currentHoldingUSD, portfolioValue, 20);
      if (cap.blocked) {
        return { ...d, action: 'HOLD', reasoning: `SECTOR_CAP: ${cap.reason ?? 'sector limit reached'}` };
      }
      if (cap.trimmed) {
        return { ...d, amountUSD: cap.trimmedAmountUSD };
      }
      return d;
    });
  }

  // PRESERVATION and DIRECTIVES are no-ops this phase — Phase 5h scope
  ctx.stagesCompleted.push('PRESERVATION', 'DIRECTIVES', 'TRADE_CAP', 'RISK_REWARD');
  return ctx;
}
