/**
 * Never Rest Capital — Gas & Liquidity Checks
 * Extracted from agent-v3.2.ts (Phase 13 refactor)
 */

import axios from "axios";
import type { PoolLiquidity } from "../../types/services.js";

// Module-level caches (owned by this module)
const poolLiquidityCache = new Map<string, PoolLiquidity>();
const POOL_LIQUIDITY_CACHE_TTL = 5 * 60 * 1000; // 5 min

let lastGasPrice: { gweiL1: number; gweiL2: number; ethPriceUSD: number; fetchedAt: number } = {
  gweiL1: 0, gweiL2: 0, ethPriceUSD: 0, fetchedAt: 0,
};

export async function fetchPoolLiquidity(
  tokenSymbol: string,
  tokenRegistry: Record<string, { address: string; [key: string]: any }>,
): Promise<PoolLiquidity | null> {
  const cached = poolLiquidityCache.get(tokenSymbol);
  if (cached && Date.now() - cached.fetchedAt < POOL_LIQUIDITY_CACHE_TTL) {
    return cached;
  }

  try {
    const reg = tokenRegistry[tokenSymbol];
    if (!reg || reg.address === 'native') return null;

    const res = await axios.get(
      `https://api.dexscreener.com/tokens/v1/base/${reg.address}`,
      { timeout: 8000 }
    );

    if (!res.data || !Array.isArray(res.data) || res.data.length === 0) return null;

    const basePools = res.data
      .filter((p: any) => p.chainId === 'base' && p.liquidity?.usd > 0)
      .sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));

    if (basePools.length === 0) return null;

    const best = basePools[0];
    const result: PoolLiquidity = {
      liquidityUSD: best.liquidity?.usd || 0,
      pairAddress: best.pairAddress || '',
      dexName: best.dexId || 'unknown',
      priceUSD: parseFloat(best.priceUsd || '0'),
      fetchedAt: Date.now(),
    };

    poolLiquidityCache.set(tokenSymbol, result);
    return result;
  } catch (e: any) {
    console.warn(`   ⚠️ Pool liquidity fetch failed for ${tokenSymbol}: ${e.message?.substring(0, 80)}`);
    return cached || null;
  }
}

export async function checkLiquidity(
  tokenSymbol: string,
  tradeAmountUSD: number,
  tokenRegistry: Record<string, { address: string; [key: string]: any }>,
  constants: { minLiquidityUSD: number; preferredLiquidityUSD: number; maxPoolPct: number; warnPoolPct: number; thinPoolReduction: number },
): Promise<{
  allowed: boolean;
  adjustedSize: number;
  liquidityUSD: number;
  tradeAsPoolPct: number;
  reason: string;
}> {
  const pool = await fetchPoolLiquidity(tokenSymbol, tokenRegistry);

  if (!pool || pool.liquidityUSD <= 0) {
    return { allowed: true, adjustedSize: Math.min(tradeAmountUSD, 25), liquidityUSD: 0, tradeAsPoolPct: 0, reason: 'No pool data — capped at $25' };
  }

  const tradeAsPoolPct = (tradeAmountUSD / pool.liquidityUSD) * 100;

  if (pool.liquidityUSD < constants.minLiquidityUSD) {
    return { allowed: false, adjustedSize: 0, liquidityUSD: pool.liquidityUSD, tradeAsPoolPct,
      reason: `Pool liquidity $${(pool.liquidityUSD / 1000).toFixed(1)}K < minimum $${(constants.minLiquidityUSD / 1000).toFixed(0)}K` };
  }

  if (tradeAsPoolPct > constants.maxPoolPct) {
    const maxAllowed = pool.liquidityUSD * (constants.maxPoolPct / 100);
    return { allowed: true, adjustedSize: Math.max(5, Math.min(maxAllowed, tradeAmountUSD)), liquidityUSD: pool.liquidityUSD, tradeAsPoolPct,
      reason: `Trade ${tradeAsPoolPct.toFixed(1)}% of pool — capped to ${constants.maxPoolPct}% ($${maxAllowed.toFixed(2)})` };
  }

  let adjustedSize = tradeAmountUSD;
  let reason = 'OK';

  if (pool.liquidityUSD < constants.preferredLiquidityUSD) {
    adjustedSize = Math.max(5, tradeAmountUSD * constants.thinPoolReduction);
    reason = `Thin pool $${(pool.liquidityUSD / 1000).toFixed(1)}K — size reduced ${((1 - constants.thinPoolReduction) * 100).toFixed(0)}%`;
  } else if (tradeAsPoolPct > constants.warnPoolPct) {
    reason = `Warning: trade is ${tradeAsPoolPct.toFixed(1)}% of pool — expect elevated slippage`;
  }

  return { allowed: true, adjustedSize: Math.round(adjustedSize * 100) / 100, liquidityUSD: pool.liquidityUSD, tradeAsPoolPct, reason };
}

export async function fetchGasPrice(
  rpcCall: (method: string, params: any[]) => Promise<any>,
  lastKnownPrices: Record<string, { price: number }>,
  gasHighGwei: number,
): Promise<{ gasCostUSD: number; gweiL2: number; isHigh: boolean }> {
  try {
    const gasPriceHex = await rpcCall('eth_gasPrice', []);
    const gasPriceWei = parseInt(gasPriceHex, 16);
    const gweiL2 = gasPriceWei / 1e9;
    const ethPrice = lastKnownPrices['ETH']?.price || lastKnownPrices['WETH']?.price || 2000;
    const gasUnits = 150_000;
    const gasCostETH = (gasPriceWei * gasUnits) / 1e18;
    const gasCostUSD = gasCostETH * ethPrice;
    lastGasPrice = { gweiL1: 0, gweiL2, ethPriceUSD: ethPrice, fetchedAt: Date.now() };
    return { gasCostUSD: Math.round(gasCostUSD * 10000) / 10000, gweiL2, isHigh: gweiL2 > gasHighGwei };
  } catch {
    return { gasCostUSD: 0.15, gweiL2: 0.1, isHigh: false };
  }
}

export async function checkGasCost(
  tradeAmountUSD: number,
  rpcCall: (method: string, params: any[]) => Promise<any>,
  lastKnownPrices: Record<string, { price: number }>,
  constants: { gasHighGwei: number; gasMaxPctOfTrade: number },
): Promise<{ proceed: boolean; gasCostUSD: number; gasPctOfTrade: number; reason: string }> {
  if (tradeAmountUSD <= 0) {
    return { proceed: false, gasCostUSD: 0, gasPctOfTrade: 0, reason: 'Trade amount is zero' };
  }
  const gas = await fetchGasPrice(rpcCall, lastKnownPrices, constants.gasHighGwei);
  const gasPctOfTrade = (gas.gasCostUSD / tradeAmountUSD) * 100;

  if (gasPctOfTrade > constants.gasMaxPctOfTrade) {
    return { proceed: false, gasCostUSD: gas.gasCostUSD, gasPctOfTrade,
      reason: `Gas $${gas.gasCostUSD.toFixed(4)} = ${gasPctOfTrade.toFixed(1)}% of $${tradeAmountUSD.toFixed(2)} trade (max ${constants.gasMaxPctOfTrade}%)` };
  }

  if (gas.isHigh) {
    return { proceed: true, gasCostUSD: gas.gasCostUSD, gasPctOfTrade,
      reason: `Gas elevated (${gas.gweiL2.toFixed(3)} gwei, $${gas.gasCostUSD.toFixed(4)}) — proceeding but noting cost` };
  }

  return { proceed: true, gasCostUSD: gas.gasCostUSD, gasPctOfTrade,
    reason: `Gas OK: $${gas.gasCostUSD.toFixed(4)} (${gasPctOfTrade.toFixed(2)}% of trade)` };
}
