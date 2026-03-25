/**
 * DEX Aggregator Service — v20.0
 *
 * Routes swaps through DEX aggregators for better execution prices.
 * Instead of trading directly on a single Uniswap V3 pool, aggregators
 * split orders across multiple DEXs (Uniswap, Aerodrome, Sushiswap, etc.)
 * and find optimal routing paths.
 *
 * Supported aggregators (in priority order):
 * 1. 0x API (Swap v2) — free tier available, Base chain supported
 * 2. 1inch Fusion API — requires API key, built-in MEV protection
 * 3. Fallback: direct Uniswap V3 (existing behavior)
 *
 * Price improvement: typically 0.1-3% better than direct DEX swaps,
 * especially for larger orders or less liquid tokens.
 */

import axios from "axios";

// ============================================================================
// CONFIGURATION
// ============================================================================

const BASE_CHAIN_ID = 8453;

/** 0x API base URL for Base chain */
const ZERO_X_API_URL = "https://base.api.0x.org";

/** 1inch API base URL */
const ONE_INCH_API_URL = "https://api.1inch.dev/swap/v6.0";

/** Base USDC address */
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** Minimum trade size to use aggregator (smaller trades: direct is fine) */
export const AGGREGATOR_MIN_TRADE_USD = 20;

/** Request timeout for aggregator APIs */
const API_TIMEOUT_MS = 8000;

// ============================================================================
// TYPES
// ============================================================================

export interface AggregatorQuote {
  aggregator: '0x' | '1inch' | 'direct';
  buyAmount: string;       // Amount of output token (in wei/smallest unit)
  sellAmount: string;      // Amount of input token
  price: number;           // Effective price
  priceImpactPct: number;  // Estimated price impact
  gas: number;             // Estimated gas cost
  sources: string[];       // DEXs used (e.g. ["Uniswap_V3", "Aerodrome"])
  // For execution:
  to?: string;             // Contract to call
  data?: string;           // Calldata
  value?: string;          // ETH value to send
  allowanceTarget?: string; // Contract to approve
}

// ============================================================================
// 0x API INTEGRATION (Primary)
// ============================================================================

/**
 * Get a swap quote from 0x API.
 *
 * Requires 0X_API_KEY env var for authenticated access.
 * Free tier: 1 request/second, 200 requests/minute.
 */
export async function get0xQuote(
  sellToken: string,
  buyToken: string,
  sellAmountWei: string,
  slippageBps: number,
  takerAddress: string,
): Promise<AggregatorQuote | null> {
  const apiKey = process.env.ZERO_X_API_KEY || process.env['0X_API_KEY'];
  if (!apiKey) return null;

  try {
    const response = await axios.get(`${ZERO_X_API_URL}/swap/v1/quote`, {
      params: {
        sellToken,
        buyToken,
        sellAmount: sellAmountWei,
        slippagePercentage: (slippageBps / 10000).toString(),
        takerAddress,
        skipValidation: true,
        enableSlippageProtection: true,
      },
      headers: {
        '0x-api-key': apiKey,
      },
      timeout: API_TIMEOUT_MS,
    });

    const data = response.data;
    if (!data?.buyAmount) return null;

    return {
      aggregator: '0x',
      buyAmount: data.buyAmount,
      sellAmount: data.sellAmount,
      price: parseFloat(data.price) || 0,
      priceImpactPct: parseFloat(data.estimatedPriceImpact) || 0,
      gas: parseInt(data.estimatedGas) || 0,
      sources: (data.sources || [])
        .filter((s: any) => parseFloat(s.proportion) > 0)
        .map((s: any) => s.name),
      to: data.to,
      data: data.data,
      value: data.value,
      allowanceTarget: data.allowanceTarget,
    };
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 429) {
      console.warn(`  ⚠️ 0x API rate limited — skipping aggregator`);
    } else {
      console.warn(`  ⚠️ 0x API quote failed: ${err.message?.substring(0, 80)}`);
    }
    return null;
  }
}

// ============================================================================
// 1INCH API INTEGRATION (Secondary)
// ============================================================================

/**
 * Get a swap quote from 1inch API.
 *
 * Requires ONE_INCH_API_KEY env var.
 */
export async function get1inchQuote(
  sellToken: string,
  buyToken: string,
  sellAmountWei: string,
  slippageBps: number,
  takerAddress: string,
): Promise<AggregatorQuote | null> {
  const apiKey = process.env.ONE_INCH_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await axios.get(`${ONE_INCH_API_URL}/${BASE_CHAIN_ID}/swap`, {
      params: {
        src: sellToken,
        dst: buyToken,
        amount: sellAmountWei,
        from: takerAddress,
        slippage: (slippageBps / 100).toString(), // 1inch uses percentage
        disableEstimate: true,
        allowPartialFill: false,
      },
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      timeout: API_TIMEOUT_MS,
    });

    const data = response.data;
    if (!data?.dstAmount) return null;

    return {
      aggregator: '1inch',
      buyAmount: data.dstAmount,
      sellAmount: data.srcAmount || sellAmountWei,
      price: 0, // Calculated by caller
      priceImpactPct: 0,
      gas: parseInt(data.tx?.gas) || 0,
      sources: data.protocols?.[0]?.map((p: any) => p[0]?.name).filter(Boolean) || [],
      to: data.tx?.to,
      data: data.tx?.data,
      value: data.tx?.value || '0',
    };
  } catch (err: any) {
    console.warn(`  ⚠️ 1inch API quote failed: ${err.message?.substring(0, 80)}`);
    return null;
  }
}

// ============================================================================
// BEST QUOTE SELECTOR
// ============================================================================

/**
 * Get the best swap quote from available aggregators.
 * Compares prices and returns the quote with the most output tokens.
 *
 * @returns Best quote, or null if no aggregators available (use direct swap)
 */
export async function getBestAggregatorQuote(
  sellToken: string,
  buyToken: string,
  sellAmountWei: string,
  slippageBps: number,
  takerAddress: string,
): Promise<AggregatorQuote | null> {
  // Fetch quotes from all available aggregators in parallel
  const [zeroXQuote, oneInchQuote] = await Promise.all([
    get0xQuote(sellToken, buyToken, sellAmountWei, slippageBps, takerAddress),
    get1inchQuote(sellToken, buyToken, sellAmountWei, slippageBps, takerAddress),
  ]);

  const quotes = [zeroXQuote, oneInchQuote].filter((q): q is AggregatorQuote => q !== null);

  if (quotes.length === 0) return null;

  // Select quote with most output tokens (highest buyAmount)
  quotes.sort((a, b) => {
    const aBuy = BigInt(a.buyAmount || '0');
    const bBuy = BigInt(b.buyAmount || '0');
    return bBuy > aBuy ? 1 : bBuy < aBuy ? -1 : 0;
  });

  const best = quotes[0];

  // Log comparison
  if (quotes.length > 1) {
    console.log(`  🔀 Aggregator comparison:`);
    for (const q of quotes) {
      console.log(`     ${q.aggregator}: ${q.buyAmount} output | sources: ${q.sources.join(', ') || 'unknown'}`);
    }
    console.log(`     → Best: ${best.aggregator}`);
  } else {
    console.log(`  🔀 Aggregator: ${best.aggregator} | sources: ${best.sources.join(', ') || 'optimal routing'}`);
  }

  return best;
}

/**
 * Check if a trade should use the aggregator.
 * Small trades don't benefit much from aggregation.
 */
export function shouldUseAggregator(tradeAmountUSD: number): boolean {
  // Must have at least one API key configured
  const hasApiKey = !!(process.env.ZERO_X_API_KEY || process.env['0X_API_KEY'] || process.env.ONE_INCH_API_KEY);
  return hasApiKey && tradeAmountUSD >= AGGREGATOR_MIN_TRADE_USD;
}
