/**
 * MEV Protection Service — v20.0
 *
 * Protects on-chain trades from sandwich attacks via:
 * 1. Flashbots Protect RPC (primary in BASE_RPC_ENDPOINTS)
 * 2. Adaptive slippage based on trade size and volatility
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const MEV_PROTECT_MIN_TRADE_USD = 50;
const MEV_MAX_SLIPPAGE_BPS = 300; // 3% cap

// ============================================================================
// ADAPTIVE SLIPPAGE CALCULATOR
// ============================================================================

interface SlippageParams {
  tradeAmountUSD: number;
  poolLiquidityUSD: number;
  volatilityLevel: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  isBuy: boolean;
}

/**
 * Calculate adaptive slippage based on trade size relative to pool depth.
 * Returns slippage in basis points (1 bps = 0.01%).
 */
export function calculateAdaptiveSlippage(params: SlippageParams): number {
  const { tradeAmountUSD, poolLiquidityUSD, volatilityLevel } = params;

  const baseSlippage: Record<string, number> = {
    LOW: 30,       // 0.3%
    NORMAL: 50,    // 0.5%
    HIGH: 100,     // 1.0%
    EXTREME: 200,  // 2.0%
  };

  let slippage = baseSlippage[volatilityLevel] || 50;

  if (poolLiquidityUSD > 0) {
    const tradeAsPoolPct = (tradeAmountUSD / poolLiquidityUSD) * 100;
    if (tradeAsPoolPct > 5) slippage += 150;
    else if (tradeAsPoolPct > 2) slippage += 75;
    else if (tradeAsPoolPct > 1) slippage += 30;
  }

  return Math.min(slippage, MEV_MAX_SLIPPAGE_BPS);
}

/**
 * Determine if a trade needs MEV protection based on size.
 */
export function needsMevProtection(tradeAmountUSD: number): boolean {
  return tradeAmountUSD >= MEV_PROTECT_MIN_TRADE_USD;
}
