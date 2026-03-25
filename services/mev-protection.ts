/**
 * MEV Protection Service — v20.0
 *
 * Protects on-chain trades from sandwich attacks and frontrunning.
 *
 * On Base (L2), the sequencer orders transactions, so traditional mempool MEV
 * is less prevalent than on L1. However, builders can still extract value via:
 *   - Sandwich attacks on large swaps
 *   - Frontrunning via private orderflow access
 *   - Backrunning profitable trades
 *
 * Protection layers:
 * 1. Flashbots Protect RPC on Base — private transaction submission
 * 2. Adaptive slippage based on trade size and pool depth
 * 3. Deadline enforcement — trades expire quickly to prevent stale execution
 * 4. Trade size thresholds — only large trades need MEV protection
 */

import axios from "axios";

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Minimum trade size in USD to trigger MEV-protected submission */
export const MEV_PROTECT_MIN_TRADE_USD = 50;

/** Flashbots Protect RPC for Base */
export const FLASHBOTS_PROTECT_BASE_RPC = "https://rpc.flashbots.net/fast?chainId=8453";

/** Maximum transaction deadline (seconds from now) */
export const MEV_TX_DEADLINE_SECONDS = 120; // 2 minutes

/** Maximum acceptable slippage multiplier for MEV-protected trades */
export const MEV_MAX_SLIPPAGE_BPS = 300; // 3%

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
 * Larger trades relative to pool size need wider slippage to execute,
 * but wider slippage means more MEV exposure.
 *
 * Returns slippage in basis points (1 bps = 0.01%).
 */
export function calculateAdaptiveSlippage(params: SlippageParams): number {
  const { tradeAmountUSD, poolLiquidityUSD, volatilityLevel } = params;

  // Base slippage by volatility regime
  const baseSlippage: Record<string, number> = {
    LOW: 30,       // 0.3%
    NORMAL: 50,    // 0.5%
    HIGH: 100,     // 1.0%
    EXTREME: 200,  // 2.0%
  };

  let slippage = baseSlippage[volatilityLevel] || 50;

  // Trade-as-pool-percent impact: larger relative trades need more slippage
  if (poolLiquidityUSD > 0) {
    const tradeAsPoolPct = (tradeAmountUSD / poolLiquidityUSD) * 100;

    if (tradeAsPoolPct > 5) {
      slippage += 150; // +1.5% for very large relative trades
    } else if (tradeAsPoolPct > 2) {
      slippage += 75;  // +0.75%
    } else if (tradeAsPoolPct > 1) {
      slippage += 30;  // +0.3%
    }
  }

  // Cap slippage
  return Math.min(slippage, MEV_MAX_SLIPPAGE_BPS);
}

/**
 * Calculate the swap deadline timestamp.
 * Short deadlines reduce the window for MEV attacks.
 */
export function getSwapDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + MEV_TX_DEADLINE_SECONDS);
}

// ============================================================================
// MEV-PROTECTED RPC SUBMISSION
// ============================================================================

/**
 * Send a raw transaction via Flashbots Protect RPC on Base.
 * Falls back to standard submission if Flashbots is unavailable.
 *
 * @param signedTx - The signed transaction hex string
 * @param fallbackRpc - Fallback RPC URL if Flashbots fails
 * @returns Transaction hash
 */
export async function sendProtectedTransaction(
  signedTx: string,
  fallbackRpc: string,
): Promise<{ txHash: string; usedProtection: boolean }> {
  // Try Flashbots Protect first
  try {
    const response = await axios.post(FLASHBOTS_PROTECT_BASE_RPC, {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_sendRawTransaction",
      params: [signedTx],
    }, { timeout: 10000 });

    if (response.data?.result) {
      console.log(`  🛡️ MEV: Transaction sent via Flashbots Protect`);
      return { txHash: response.data.result, usedProtection: true };
    }

    // Flashbots returned an error — fall through to standard
    if (response.data?.error) {
      console.warn(`  ⚠️ MEV: Flashbots error: ${response.data.error.message || JSON.stringify(response.data.error)} — falling back to standard RPC`);
    }
  } catch (err: any) {
    console.warn(`  ⚠️ MEV: Flashbots unavailable: ${err.message?.substring(0, 80)} — falling back to standard RPC`);
  }

  // Fallback: standard RPC submission
  try {
    const response = await axios.post(fallbackRpc, {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_sendRawTransaction",
      params: [signedTx],
    }, { timeout: 15000 });

    if (response.data?.result) {
      return { txHash: response.data.result, usedProtection: false };
    }

    throw new Error(response.data?.error?.message || "No tx hash returned");
  } catch (err: any) {
    throw new Error(`Failed to submit transaction: ${err.message}`);
  }
}

// ============================================================================
// TRADE SIZE ANALYSIS
// ============================================================================

/**
 * Determine if a trade needs MEV protection based on size and context.
 */
export function needsMevProtection(tradeAmountUSD: number): boolean {
  return tradeAmountUSD >= MEV_PROTECT_MIN_TRADE_USD;
}

/**
 * Log MEV protection decision for observability.
 */
export function logMevDecision(
  symbol: string,
  action: string,
  amountUSD: number,
  slippageBps: number,
  usedProtection: boolean,
): void {
  const protectionLabel = usedProtection ? '🛡️ Flashbots' : '⚡ Standard';
  console.log(`  ${protectionLabel} | ${action} ${symbol} $${amountUSD.toFixed(2)} | Slippage: ${slippageBps}bps (${(slippageBps / 100).toFixed(2)}%)`);
}
