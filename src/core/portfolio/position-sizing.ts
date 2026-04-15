/**
 * Never Rest Capital — Position Sizing Helpers
 *
 * Pure mathematical functions extracted from the per-trade sizing block in
 * agent-v3.2.ts (L7500–7590). These are the multipliers that adjust a trade's
 * base Kelly size up or down based on volatility, signal confidence, and
 * on-chain flow. Bugs here change real trade sizes on every buy.
 *
 * All three functions are:
 *   - Pure (no I/O, no state)
 *   - Deterministic (same inputs → same output)
 *   - Composable (caller multiplies them together)
 *
 * ## Usage
 *
 * In the execution loop, these run AFTER the Kelly cap and BEFORE the dust guard:
 *
 *   const volMult  = computeVolatilityMultiplier(tokenATR, allATRs);
 *   const confMult = computeConfidenceMultiplier(confluenceScore);
 *   const combined = combinePositionMultipliers(volMult, confMult);
 *   // apply: decision.amountUSD = Math.max(FLOOR, amountUSD * combined);
 *
 *   const flowMult = computeCatchingFireMultiplier(buyRatio, tradeCount);
 *   // apply after combined: decision.amountUSD = amountUSD * flowMult;
 *
 * ## Why separate functions, not one big function
 *
 * Each multiplier has independent semantics:
 *   - Volatility: risk-normalization — equal risk per position regardless of ATR
 *   - Confidence: signal quality — scale size with conviction
 *   - Flow: momentum confirmation — extra size when on-chain agrees
 *
 * Keeping them separate makes it easy to disable one without touching the others,
 * and means tests can verify each independently.
 */

// ============================================================================
// VOLATILITY MULTIPLIER
// ============================================================================

/**
 * Compute the inverse-volatility position sizing multiplier.
 *
 * Goal: each position contributes equal risk to the portfolio, regardless of
 * how volatile the token is. Higher ATR (more volatile) → smaller position.
 *
 * Formula:
 *   volRatio = avgATR / tokenATR   (>1 = calmer than average = bigger position)
 *   multiplier = clamp(volRatio, 0.5, 1.5)
 *
 * The clamp prevents extreme sizing: a very calm token never gets >1.5x, and
 * a very volatile token never falls below 0.5x.
 *
 * Source: agent-v3.2.ts L7527–7548
 *
 * @param tokenATR  ATR% for the token being sized (e.g. 3.5 = 3.5% daily range)
 * @param allATRs   ATR% values for all tokens in the portfolio (to compute average)
 * @returns         Multiplier in the range [0.5, 1.5]
 */
export function computeVolatilityMultiplier(tokenATR: number, allATRs: number[]): number {
  if (tokenATR <= 0) return 1.0;

  const validATRs = allATRs.filter(a => a > 0);
  const avgATR = validATRs.length > 0
    ? validATRs.reduce((s, a) => s + a, 0) / validATRs.length
    : tokenATR;

  const volRatio = avgATR / tokenATR;
  return Math.max(0.5, Math.min(1.5, volRatio));
}

// ============================================================================
// CONFIDENCE MULTIPLIER
// ============================================================================

/**
 * Compute the confluence-weighted position sizing multiplier.
 *
 * Goal: scale position size with signal quality. High-confluence signals
 * (many indicators agree) get full size; weak signals get reduced size.
 *
 * Scale (from agent-v3.2.ts L7533–7536):
 *   confluence  0–19  → 0.6x  (weak signal — meaningful reduction)
 *   confluence 20–39  → 0.8x  (moderate signal — small reduction)
 *   confluence  40+   → 1.0x  (strong signal — full size)
 *
 * Uses the absolute value of the confluence score (negative = sell signal,
 * which is handled by the trade direction, not the size multiplier).
 *
 * Source: agent-v3.2.ts L7533–7537
 *
 * @param confluenceScore  The token's confluence score (positive = BUY, negative = SELL)
 * @returns                Multiplier in { 0.6, 0.8, 1.0 }
 */
export function computeConfidenceMultiplier(confluenceScore: number): number {
  const abs = Math.abs(confluenceScore);
  if (abs >= 40) return 1.0;
  if (abs >= 20) return 0.8;
  return 0.6;
}

// ============================================================================
// COMBINED MULTIPLIER
// ============================================================================

/**
 * Combine the volatility and confidence multipliers.
 *
 * This is a simple product — the two multipliers are designed to be
 * composed. Only returns a value meaningfully different from 1.0 when the
 * combined effect is > 5% off baseline (to avoid spurious log noise).
 *
 * Source: agent-v3.2.ts L7539–7540
 *
 * @param volMultiplier   Result of computeVolatilityMultiplier()
 * @param confMultiplier  Result of computeConfidenceMultiplier()
 * @returns               Combined multiplier (product of the two)
 */
export function combinePositionMultipliers(volMultiplier: number, confMultiplier: number): number {
  return volMultiplier * confMultiplier;
}

// ============================================================================
// CATCHING FIRE MULTIPLIER
// ============================================================================

/**
 * Compute the "Catching Fire" on-chain flow momentum multiplier.
 *
 * When on-chain order flow shows strong buying pressure (>60% buy ratio) with
 * meaningful volume (>50 trades in the lookback window), the position gets
 * 1.5x size. This is a momentum confirmation signal — the on-chain data
 * agrees with the AI's BUY decision.
 *
 * Source: agent-v3.2.ts L7557–7564
 *
 * @param buyRatio    Fraction of volume that is buys, 0.0–1.0 (e.g. 0.65 = 65% buys)
 * @param tradeCount  Number of trades in the flow lookback window
 * @returns           1.5 if conditions met, 1.0 otherwise
 */
export function computeCatchingFireMultiplier(buyRatio: number, tradeCount: number): number {
  if (buyRatio > 0.60 && tradeCount > 50) return 1.5;
  return 1.0;
}

// ============================================================================
// DEPLOYMENT FLOOR
// ============================================================================

/**
 * Compute the minimum trade size during cash deployment mode.
 *
 * When the portfolio is over-concentrated in USDC (cash deployment mode
 * is active), the bot uses a generous floor instead of Kelly sizing.
 * The goal is to get capital deployed meaningfully — not in $5 drips.
 *
 * Floor: max($150, 3.5% of portfolio value)
 * Capped by remaining USDC.
 *
 * Source: agent-v3.2.ts L7467–7471
 *
 * @param portfolioValue  Total portfolio value in USD
 * @param remainingUSDC   Available USDC for this trade
 * @returns               The deployment floor in USD
 */
export function computeDeploymentFloor(portfolioValue: number, remainingUSDC: number): number {
  const floor = Math.max(150, portfolioValue * 0.035);
  return Math.min(floor, remainingUSDC);
}
