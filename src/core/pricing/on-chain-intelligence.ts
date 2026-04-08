/**
 * Never Rest Capital -- On-Chain Intelligence Engine
 * Extracted from agent-v3.2.ts (Phase 16 refactor)
 *
 * Handles:
 * - TWAP-spot divergence calculation (V3 pools)
 * - Swap event log analysis (order flow / CVD)
 * - Tick-level liquidity depth reads
 * - Volume enrichment via DexScreener
 * - Local altseason signal (BTC/ETH ratio)
 * - Base USDC supply (stablecoin capital flow proxy)
 * - Price change computation
 * - Orchestrator: fetchAllOnChainIntelligence()
 */

import axios from 'axios';
import type { PoolRegistryEntry } from '../types/services.js';
import type { TechnicalIndicators, AltseasonSignal } from '../../algorithm/index.js';
import type { StablecoinSupplyData } from '../types/market-data.js';

// ============================================================================
// MODULE STATE
// ============================================================================

let lastVolumeEnrichmentTime = 0;

// ============================================================================
// INJECTED DEPENDENCIES
// ============================================================================

let _rpcCall: (method: string, params: any[]) => Promise<any>;
let _getPoolRegistry: () => Record<string, PoolRegistryEntry>;
let _getLastPoolTicks: () => Record<string, number>;
let _setLastOnChainIntelligence: (value: Record<string, {
  twap: TechnicalIndicators["twapDivergence"];
  orderFlow: TechnicalIndicators["orderFlow"];
  tickDepth: TechnicalIndicators["tickDepth"];
}>) => void;
let _getLastKnownPrices: () => Record<string, { price: number; [key: string]: any }>;
let _getPriceHistoryTokens: () => Record<string, { timestamps: number[]; prices: number[]; volumes: number[] }>;
let _getStablecoinSupplyHistory: () => { values: { timestamp: string; totalSupply: number }[] };
let _setStablecoinSupplyHistory: (h: { values: { timestamp: string; totalSupply: number }[] }) => void;
let _computePriceChangeFn: (tokenHistory: { timestamps: number[]; prices: number[]; volumes: number[] } | undefined, currentPrice: number, lookbackMs: number) => number;
let _computeLocalAltseasonSignalFn: (btcHistory: any, ethHistory: any, threshold: number) => AltseasonSignal;
let _TOKEN_REGISTRY: Record<string, any>;
let _TWAP_OBSERVATION_SECONDS: number;
let _TWAP_DIVERGENCE_THRESHOLD_PCT: number;
let _ORDER_FLOW_BLOCK_LOOKBACK: number;
let _SWAP_EVENT_TOPIC: string;
let _LARGE_TRADE_THRESHOLD_USD: number;
let _TICK_DEPTH_RANGE: number;
let _VOLUME_ENRICHMENT_INTERVAL_MS: number;
let _VOLUME_SELF_SUFFICIENT_POINTS: number;
let _BTC_DOMINANCE_CHANGE_THRESHOLD: number;
let _STABLECOIN_SUPPLY_CHANGE_THRESHOLD: number;

// ============================================================================
// INITIALIZATION
// ============================================================================

export interface OnChainIntelligenceDeps {
  rpcCall: (method: string, params: any[]) => Promise<any>;
  getPoolRegistry: () => Record<string, PoolRegistryEntry>;
  getLastPoolTicks: () => Record<string, number>;
  setLastOnChainIntelligence: (value: Record<string, {
    twap: TechnicalIndicators["twapDivergence"];
    orderFlow: TechnicalIndicators["orderFlow"];
    tickDepth: TechnicalIndicators["tickDepth"];
  }>) => void;
  getLastKnownPrices: () => Record<string, { price: number; [key: string]: any }>;
  getPriceHistoryTokens: () => Record<string, { timestamps: number[]; prices: number[]; volumes: number[] }>;
  getStablecoinSupplyHistory: () => { values: { timestamp: string; totalSupply: number }[] };
  setStablecoinSupplyHistory: (h: { values: { timestamp: string; totalSupply: number }[] }) => void;
  computePriceChange: (tokenHistory: { timestamps: number[]; prices: number[]; volumes: number[] } | undefined, currentPrice: number, lookbackMs: number) => number;
  computeLocalAltseasonSignal: (btcHistory: any, ethHistory: any, threshold: number) => AltseasonSignal;
  TOKEN_REGISTRY: Record<string, any>;
  TWAP_OBSERVATION_SECONDS: number;
  TWAP_DIVERGENCE_THRESHOLD_PCT: number;
  ORDER_FLOW_BLOCK_LOOKBACK: number;
  SWAP_EVENT_TOPIC: string;
  LARGE_TRADE_THRESHOLD_USD: number;
  TICK_DEPTH_RANGE: number;
  VOLUME_ENRICHMENT_INTERVAL_MS: number;
  VOLUME_SELF_SUFFICIENT_POINTS: number;
  BTC_DOMINANCE_CHANGE_THRESHOLD: number;
  STABLECOIN_SUPPLY_CHANGE_THRESHOLD: number;
}

export function initOnChainIntelligence(deps: OnChainIntelligenceDeps): void {
  _rpcCall = deps.rpcCall;
  _getPoolRegistry = deps.getPoolRegistry;
  _getLastPoolTicks = deps.getLastPoolTicks;
  _setLastOnChainIntelligence = deps.setLastOnChainIntelligence;
  _getLastKnownPrices = deps.getLastKnownPrices;
  _getPriceHistoryTokens = deps.getPriceHistoryTokens;
  _getStablecoinSupplyHistory = deps.getStablecoinSupplyHistory;
  _setStablecoinSupplyHistory = deps.setStablecoinSupplyHistory;
  _computePriceChangeFn = deps.computePriceChange;
  _computeLocalAltseasonSignalFn = deps.computeLocalAltseasonSignal;
  _TOKEN_REGISTRY = deps.TOKEN_REGISTRY;
  _TWAP_OBSERVATION_SECONDS = deps.TWAP_OBSERVATION_SECONDS;
  _TWAP_DIVERGENCE_THRESHOLD_PCT = deps.TWAP_DIVERGENCE_THRESHOLD_PCT;
  _ORDER_FLOW_BLOCK_LOOKBACK = deps.ORDER_FLOW_BLOCK_LOOKBACK;
  _SWAP_EVENT_TOPIC = deps.SWAP_EVENT_TOPIC;
  _LARGE_TRADE_THRESHOLD_USD = deps.LARGE_TRADE_THRESHOLD_USD;
  _TICK_DEPTH_RANGE = deps.TICK_DEPTH_RANGE;
  _VOLUME_ENRICHMENT_INTERVAL_MS = deps.VOLUME_ENRICHMENT_INTERVAL_MS;
  _VOLUME_SELF_SUFFICIENT_POINTS = deps.VOLUME_SELF_SUFFICIENT_POINTS;
  _BTC_DOMINANCE_CHANGE_THRESHOLD = deps.BTC_DOMINANCE_CHANGE_THRESHOLD;
  _STABLECOIN_SUPPLY_CHANGE_THRESHOLD = deps.STABLECOIN_SUPPLY_CHANGE_THRESHOLD;
}

// ============================================================================
// TWAP DIVERGENCE
// ============================================================================

/**
 * 2A: Fetch TWAP-spot divergence from V3 pool oracle.
 * Calls observe([0, 900]) to get 15-minute TWAP tick, converts to price.
 */
export async function fetchTWAPDivergence(
  symbol: string,
  spotPrice: number,
  ethPrice: number,
  btcPrice: number = 0,
  virtualPrice: number = 0
): Promise<TechnicalIndicators["twapDivergence"]> {
  const poolRegistry = _getPoolRegistry();
  const pool = poolRegistry[symbol];
  if (!pool || (pool.poolType !== 'uniswapV3' && pool.poolType !== 'aerodromeV3')) return null;
  if (spotPrice <= 0 || ethPrice <= 0) return null;

  try {
    // observe([0, 900]) -- selector 0x883bdbfd, ABI-encoded dynamic uint32 array
    const calldata = '0x883bdbfd' +
      '0000000000000000000000000000000000000000000000000000000000000020' + // offset
      '0000000000000000000000000000000000000000000000000000000000000002' + // length = 2
      '0000000000000000000000000000000000000000000000000000000000000000' + // secondsAgo[0] = 0
      '0000000000000000000000000000000000000000000000000000000000000384'; // secondsAgo[1] = 900

    const result = await _rpcCall('eth_call', [
      { to: pool.poolAddress, data: calldata }, 'latest'
    ]);

    if (!result || result === '0x' || result.length < 258) return null;

    const data = result.slice(2); // strip 0x

    // Read offsets
    const ticksOffset = parseInt(data.slice(0, 64), 16) * 2;
    const ticksLength = parseInt(data.slice(ticksOffset, ticksOffset + 64), 16);
    if (ticksLength < 2) return null;

    // Read tick cumulatives (int56 stored as int256)
    const tick0Hex = data.slice(ticksOffset + 64, ticksOffset + 128);
    const tick1Hex = data.slice(ticksOffset + 128, ticksOffset + 192);

    const parseSigned256 = (hex: string): bigint => {
      const val = BigInt('0x' + hex);
      return val > BigInt('0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')
        ? val - BigInt('0x10000000000000000000000000000000000000000000000000000000000000000')
        : val;
    };

    const tickCum0 = parseSigned256(tick0Hex);
    const tickCum1 = parseSigned256(tick1Hex);

    // TWAP tick = (tickCumNow - tickCumPast) / elapsed
    const twapTick = Number(tickCum0 - tickCum1) / _TWAP_OBSERVATION_SECONDS;

    // Convert tick to price: price = 1.0001^tick
    const twapRawPrice = Math.pow(1.0001, twapTick);

    // Apply decimal adjustment
    const decimalAdjustment = 10 ** (pool.token0Decimals - pool.token1Decimals);
    let twapTokenPrice = twapRawPrice * decimalAdjustment;

    // If our token is token1, invert
    if (!pool.token0IsBase) {
      twapTokenPrice = 1 / twapTokenPrice;
    }

    // Convert to USD
    let twapPriceUSD: number;
    if (pool.quoteToken === 'WETH') twapPriceUSD = twapTokenPrice * ethPrice;
    else if (pool.quoteToken === 'cbBTC') twapPriceUSD = btcPrice > 0 ? twapTokenPrice * btcPrice : 0;
    else if (pool.quoteToken === 'VIRTUAL') twapPriceUSD = virtualPrice > 0 ? twapTokenPrice * virtualPrice : 0;
    else twapPriceUSD = twapTokenPrice; // USDC

    if (twapPriceUSD <= 0 || !isFinite(twapPriceUSD)) return null;

    // Calculate divergence
    const divergencePct = ((spotPrice - twapPriceUSD) / twapPriceUSD) * 100;

    let signal: "OVERSOLD" | "OVERBOUGHT" | "NORMAL";
    if (divergencePct < -_TWAP_DIVERGENCE_THRESHOLD_PCT) signal = "OVERSOLD";
    else if (divergencePct > _TWAP_DIVERGENCE_THRESHOLD_PCT) signal = "OVERBOUGHT";
    else signal = "NORMAL";

    return {
      twapPrice: twapPriceUSD,
      spotPrice,
      divergencePct,
      signal,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// SWAP ORDER FLOW
// ============================================================================

/**
 * 2B: Fetch swap event order flow from DEX pool.
 * Reads eth_getLogs for Swap events over last ~10 minutes (300 blocks on Base).
 * Determines net buy/sell pressure (CVD) with trade size bucketing.
 */
export async function fetchSwapOrderFlow(
  symbol: string,
  currentPrice: number,
  ethPrice: number,
  currentBlock: number
): Promise<TechnicalIndicators["orderFlow"]> {
  const poolRegistry = _getPoolRegistry();
  const pool = poolRegistry[symbol];
  if (!pool || currentPrice <= 0 || ethPrice <= 0 || currentBlock <= 0) return null;

  try {
    const fromBlock = '0x' + Math.max(0, currentBlock - _ORDER_FLOW_BLOCK_LOOKBACK).toString(16);
    const toBlock = 'latest';

    const logs = await _rpcCall('eth_getLogs', [{
      address: pool.poolAddress,
      topics: [_SWAP_EVENT_TOPIC],
      fromBlock,
      toBlock,
    }]);

    if (!logs || !Array.isArray(logs) || logs.length === 0) return null;

    let buyVolumeUSD = 0;
    let sellVolumeUSD = 0;
    let largeBuyVolume = 0;
    let tradeCount = 0;

    for (const log of logs) {
      try {
        if (!log.data || log.data.length < 130) continue;
        const data = log.data.slice(2);

        const amount0Hex = data.slice(0, 64);
        const amount1Hex = data.slice(64, 128);

        const parseSigned = (hex: string): bigint => {
          const val = BigInt('0x' + hex);
          return val > BigInt('0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')
            ? val - BigInt('0x10000000000000000000000000000000000000000000000000000000000000000')
            : val;
        };

        const amount0 = parseSigned(amount0Hex);
        const amount1 = parseSigned(amount1Hex);

        let isBuy: boolean;
        let tradeAmountRaw: bigint;
        let tradeDecimals: number;

        if (pool.token0IsBase) {
          isBuy = amount0 < 0n;
          tradeAmountRaw = amount0 < 0n ? -amount0 : amount0;
          tradeDecimals = pool.token0Decimals;
        } else {
          isBuy = amount1 < 0n;
          tradeAmountRaw = amount1 < 0n ? -amount1 : amount1;
          tradeDecimals = pool.token1Decimals;
        }

        const tradeAmountTokens = Number(tradeAmountRaw) / (10 ** tradeDecimals);
        const tradeValueUSD = tradeAmountTokens * currentPrice;

        if (tradeValueUSD <= 0 || !isFinite(tradeValueUSD) || tradeValueUSD > 10_000_000) continue;

        tradeCount++;
        if (isBuy) {
          buyVolumeUSD += tradeValueUSD;
          if (tradeValueUSD >= _LARGE_TRADE_THRESHOLD_USD) {
            largeBuyVolume += tradeValueUSD;
          }
        } else {
          sellVolumeUSD += tradeValueUSD;
        }
      } catch {
        continue;
      }
    }

    if (tradeCount === 0) return null;

    const netBuyVolumeUSD = buyVolumeUSD - sellVolumeUSD;
    const totalVolume = buyVolumeUSD + sellVolumeUSD;
    const buyRatio = totalVolume > 0 ? buyVolumeUSD / totalVolume : 0.5;
    const largeBuyPct = buyVolumeUSD > 0 ? (largeBuyVolume / buyVolumeUSD) * 100 : 0;

    let signal: "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";
    if (buyRatio > 0.65) signal = "STRONG_BUY";
    else if (buyRatio > 0.55) signal = "BUY";
    else if (buyRatio < 0.35) signal = "STRONG_SELL";
    else if (buyRatio < 0.45) signal = "SELL";
    else signal = "NEUTRAL";

    return {
      netBuyVolumeUSD: Math.round(netBuyVolumeUSD),
      buyVolumeUSD: Math.round(buyVolumeUSD),
      sellVolumeUSD: Math.round(sellVolumeUSD),
      tradeCount,
      largeBuyPct: Math.round(largeBuyPct),
      signal,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// TICK LIQUIDITY DEPTH
// ============================================================================

/**
 * Helper: Read liquidityNet for a specific tick from a V3 pool.
 * ticks(int24) selector: 0xf30dba93
 * Returns (uint128 liquidityGross, int128 liquidityNet, ...)
 */
export async function readTickLiquidityNet(poolAddress: string, tick: number): Promise<{ tick: number; liquidityNet: bigint }> {
  let tickHex: string;
  if (tick >= 0) {
    tickHex = tick.toString(16).padStart(64, '0');
  } else {
    const twosComp = BigInt('0x10000000000000000000000000000000000000000000000000000000000000000') + BigInt(tick);
    tickHex = twosComp.toString(16).padStart(64, '0');
  }

  const result = await _rpcCall('eth_call', [
    { to: poolAddress, data: '0xf30dba93' + tickHex }, 'latest'
  ]);

  if (!result || result === '0x' || result.length < 130) {
    return { tick, liquidityNet: 0n };
  }

  const netHex = result.slice(2 + 64, 2 + 128);
  const netBigInt = BigInt('0x' + netHex);
  const liquidityNet = netBigInt > BigInt('0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')
    ? netBigInt - BigInt('0x10000000000000000000000000000000000000000000000000000000000000000')
    : netBigInt;

  return { tick, liquidityNet };
}

/**
 * 2C: Fetch tick liquidity depth around current price.
 * Reads ticks above/below current to map on-chain support/resistance.
 * Heavy cycle only -- more RPC calls (~11 per pool).
 */
export async function fetchTickLiquidityDepth(
  symbol: string,
  currentPrice: number,
  ethPrice: number
): Promise<TechnicalIndicators["tickDepth"]> {
  const poolRegistry = _getPoolRegistry();
  const lastPoolTicks = _getLastPoolTicks();
  const lastKnownPrices = _getLastKnownPrices();
  const pool = poolRegistry[symbol];
  if (!pool || (pool.poolType !== 'uniswapV3' && pool.poolType !== 'aerodromeV3')) return null;
  if (currentPrice <= 0 || ethPrice <= 0) return null;

  const currentTick = lastPoolTicks[symbol];
  if (currentTick === undefined) return null;

  try {
    // Get tickSpacing (cached -- immutable per pool)
    if (!pool.tickSpacing) {
      const tsResult = await _rpcCall('eth_call', [
        { to: pool.poolAddress, data: '0xd0c93a7c' }, 'latest'
      ]);
      if (tsResult && tsResult !== '0x') {
        const tsVal = parseInt(tsResult, 16);
        pool.tickSpacing = tsVal > 8388607 ? tsVal - 16777216 : tsVal;
        if (pool.tickSpacing <= 0 || pool.tickSpacing > 16384) {
          pool.tickSpacing = undefined;
          return null;
        }
      } else {
        return null;
      }
    }

    const spacing = pool.tickSpacing!;

    // Align current tick to tick spacing
    const alignedTick = Math.floor(currentTick / spacing) * spacing;

    // Read current liquidity
    const liqResult = await _rpcCall('eth_call', [
      { to: pool.poolAddress, data: '0x1a686502' }, 'latest'
    ]);
    const inRangeLiquidity = liqResult && liqResult !== '0x' ? Number(BigInt(liqResult)) : 0;

    // Read ticks above and below
    const tickReads: Promise<{ tick: number; liquidityNet: bigint }>[] = [];

    for (let i = 1; i <= _TICK_DEPTH_RANGE; i++) {
      const tickBelow = alignedTick - (i * spacing);
      tickReads.push(readTickLiquidityNet(pool.poolAddress, tickBelow));
      const tickAbove = alignedTick + (i * spacing);
      tickReads.push(readTickLiquidityNet(pool.poolAddress, tickAbove));
    }

    const tickResults = await Promise.allSettled(tickReads);

    let bidDepthRaw = 0n;
    let askDepthRaw = 0n;

    for (let i = 0; i < _TICK_DEPTH_RANGE; i++) {
      const belowResult = tickResults[i * 2];
      const aboveResult = tickResults[i * 2 + 1];

      if (belowResult.status === 'fulfilled' && belowResult.value.liquidityNet > 0n) {
        bidDepthRaw += belowResult.value.liquidityNet;
      }
      if (aboveResult.status === 'fulfilled') {
        const net = aboveResult.value.liquidityNet;
        if (net < 0n) askDepthRaw += -net;
      }
    }

    const sqrtPrice = Math.sqrt(currentPrice);
    const tickRangePrice = currentPrice * (Math.pow(1.0001, spacing) - 1);

    let quotePrice = 1;
    if (pool.quoteToken === 'WETH') quotePrice = ethPrice;
    else if (pool.quoteToken === 'cbBTC') quotePrice = lastKnownPrices['cbBTC']?.price || 0;
    else if (pool.quoteToken === 'VIRTUAL') quotePrice = lastKnownPrices['VIRTUAL']?.price || 0;

    const scaleFactor = tickRangePrice * quotePrice / (10 ** 18);
    const bidDepthUSD = Number(bidDepthRaw) * scaleFactor;
    const askDepthUSD = Number(askDepthRaw) * scaleFactor;
    const inRangeLiqUSD = inRangeLiquidity * scaleFactor;

    if (bidDepthUSD <= 0 && askDepthUSD <= 0) return null;

    const depthRatio = askDepthUSD > 0 ? bidDepthUSD / askDepthUSD : bidDepthUSD > 0 ? 10 : 1;

    let signal: "STRONG_SUPPORT" | "SUPPORT" | "BALANCED" | "RESISTANCE" | "STRONG_RESISTANCE";
    if (depthRatio > 2.0) signal = "STRONG_SUPPORT";
    else if (depthRatio > 1.3) signal = "SUPPORT";
    else if (depthRatio < 0.5) signal = "STRONG_RESISTANCE";
    else if (depthRatio < 0.77) signal = "RESISTANCE";
    else signal = "BALANCED";

    return {
      bidDepthUSD: Math.round(bidDepthUSD),
      askDepthUSD: Math.round(askDepthUSD),
      depthRatio: Math.round(depthRatio * 100) / 100,
      inRangeLiquidity: Math.round(inRangeLiqUSD),
      signal,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

/**
 * 2D: Orchestrator -- fetch all on-chain intelligence for V3 pools.
 * Launches TWAP + OrderFlow in parallel for each pool.
 * Tick depth only on heavy cycles.
 * Returns Record<symbol, { twap, orderFlow, tickDepth }>
 */
export async function fetchAllOnChainIntelligence(
  ethPrice: number,
  onChainPrices: Map<string, number>,
  includeTickDepth: boolean = true
): Promise<Record<string, { twap: TechnicalIndicators["twapDivergence"]; orderFlow: TechnicalIndicators["orderFlow"]; tickDepth: TechnicalIndicators["tickDepth"] }>> {
  const result: Record<string, { twap: TechnicalIndicators["twapDivergence"]; orderFlow: TechnicalIndicators["orderFlow"]; tickDepth: TechnicalIndicators["tickDepth"] }> = {};
  const poolRegistry = _getPoolRegistry();
  const lastKnownPrices = _getLastKnownPrices();

  if (ethPrice <= 0) return result;

  try {
    // Get current block number (1 call, used for all order flow queries)
    const blockHex = await _rpcCall('eth_blockNumber', []);
    const currentBlock = blockHex ? parseInt(blockHex, 16) : 0;
    if (currentBlock <= 0) return result;

    const btcPrice = onChainPrices.get('cbBTC') || lastKnownPrices['cbBTC']?.price || 0;
    const virtualPrice = onChainPrices.get('VIRTUAL') || lastKnownPrices['VIRTUAL']?.price || 0;

    // Collect all V3 pools to analyze
    const poolSymbols = Object.entries(poolRegistry)
      .filter(([symbol, pool]) =>
        (pool.poolType === 'uniswapV3' || pool.poolType === 'aerodromeV3') &&
        symbol !== 'ETH' && symbol !== 'WETH' && symbol !== 'USDC' &&
        pool.consecutiveFailures < 3
      )
      .map(([symbol]) => symbol);

    // Launch TWAP + OrderFlow for each pool in parallel
    const promises = poolSymbols.map(async (symbol) => {
      const spotPrice = onChainPrices.get(symbol) || lastKnownPrices[symbol]?.price || 0;
      if (spotPrice <= 0) return;

      const [twap, orderFlow] = await Promise.all([
        fetchTWAPDivergence(symbol, spotPrice, ethPrice, btcPrice, virtualPrice).catch(() => null),
        fetchSwapOrderFlow(symbol, spotPrice, ethPrice, currentBlock).catch(() => null),
      ]);

      let tickDepth: TechnicalIndicators["tickDepth"] = null;
      if (includeTickDepth) {
        tickDepth = await fetchTickLiquidityDepth(symbol, spotPrice, ethPrice).catch(() => null);
      }

      result[symbol] = { twap, orderFlow, tickDepth };
    });

    await Promise.allSettled(promises);

    // Log summary
    const twapCount = Object.values(result).filter(r => r.twap).length;
    const flowCount = Object.values(result).filter(r => r.orderFlow).length;
    const depthCount = Object.values(result).filter(r => r.tickDepth).length;
    console.log(`  \u{1F4CA} On-chain intelligence: ${twapCount} TWAP, ${flowCount} flow, ${depthCount} depth signals from ${poolSymbols.length} V3 pools`);

    // Cache for light cycles
    _setLastOnChainIntelligence(result);

    return result;
  } catch (e: any) {
    console.error(`  \u26A0\uFE0F On-chain intelligence failed: ${e?.message || String(e)}`);
    return result;
  }
}

// ============================================================================
// PRICE CHANGE COMPUTATION
// ============================================================================

/**
 * Compute price change for a symbol over a lookback window.
 * Delegates to algorithm/market-analysis.ts implementation.
 */
export function computePriceChange(symbol: string, currentPrice: number, lookbackMs: number): number {
  const tokens = _getPriceHistoryTokens();
  return _computePriceChangeFn(tokens[symbol], currentPrice, lookbackMs);
}

// ============================================================================
// VOLUME ENRICHMENT
// ============================================================================

/**
 * Periodic volume enrichment from DexScreener (fades out once self-sufficient).
 * Returns volume data per symbol, or empty map if skipped.
 */
export async function enrichVolumeData(): Promise<Map<string, number>> {
  const volumes = new Map<string, number>();
  const now = Date.now();

  // Skip if too soon since last enrichment
  if (now - lastVolumeEnrichmentTime < _VOLUME_ENRICHMENT_INTERVAL_MS) return volumes;

  // Check if self-sufficient
  const tokens = _getPriceHistoryTokens();
  const tokenLengths = Object.values(tokens)
    .filter(t => t.prices.length > 0)
    .map(t => t.prices.length);
  const minPoints = tokenLengths.length > 0 ? Math.min(...tokenLengths) : 0;
  if (minPoints >= _VOLUME_SELF_SUFFICIENT_POINTS) {
    return volumes;
  }

  try {
    const addresses = Object.entries(_TOKEN_REGISTRY)
      .filter(([s]) => s !== 'USDC' && _TOKEN_REGISTRY[s].address !== 'native')
      .map(([_, t]) => t.address)
      .join(',');

    const res = await axios.get(
      `https://api.dexscreener.com/tokens/v1/base/${addresses}`,
      { timeout: 10000 }
    );

    if (res.data && Array.isArray(res.data)) {
      const seen = new Set<string>();
      for (const pair of res.data) {
        const addr = pair.baseToken?.address?.toLowerCase();
        const entry = Object.entries(_TOKEN_REGISTRY).find(([_, t]) => t.address.toLowerCase() === addr);
        if (entry && !seen.has(entry[0])) {
          seen.add(entry[0]);
          const vol = pair.volume?.h24 || 0;
          if (vol > 0) volumes.set(entry[0], vol);
        }
      }
    }

    lastVolumeEnrichmentTime = now;
    if (volumes.size > 0) {
      console.log(`  \u{1F4CA} Volume enrichment: ${volumes.size} tokens (fade-out: ${minPoints}/${_VOLUME_SELF_SUFFICIENT_POINTS} points)`);
    }
  } catch { /* non-critical */ }

  return volumes;
}

// ============================================================================
// ALTSEASON SIGNAL
// ============================================================================

/**
 * Compute local altseason signal from BTC/ETH price ratio history.
 * Delegates to algorithm/market-analysis.ts implementation.
 */
export function computeLocalAltseasonSignal(): AltseasonSignal {
  const tokens = _getPriceHistoryTokens();
  return _computeLocalAltseasonSignalFn(
    tokens['cbBTC'],
    tokens['ETH'] || tokens['WETH'],
    _BTC_DOMINANCE_CHANGE_THRESHOLD,
  );
}

// ============================================================================
// USDC SUPPLY
// ============================================================================

/**
 * Fetch USDC total supply on Base as a proxy for stablecoin capital flow.
 * Replaces fetchStablecoinSupply() CoinGecko call.
 */
export async function fetchBaseUSDCSupply(): Promise<StablecoinSupplyData | null> {
  try {
    const result = await _rpcCall('eth_call', [
      { to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', data: '0x18160ddd' },
      'latest'
    ]);
    if (!result || result === '0x') return null;

    const totalSupply = Number(BigInt(result)) / 1e6; // USDC has 6 decimals
    const now = new Date().toISOString();

    const stablecoinSupplyHistory = _getStablecoinSupplyHistory();

    // Filter out stale history entries
    if (stablecoinSupplyHistory.values.length > 0) {
      const before = stablecoinSupplyHistory.values.length;
      stablecoinSupplyHistory.values = stablecoinSupplyHistory.values.filter(v => {
        if (v.totalSupply <= 0) return false;
        const ratio = totalSupply / v.totalSupply;
        return ratio >= 0.1 && ratio <= 10;
      });
      const purged = before - stablecoinSupplyHistory.values.length;
      if (purged > 0) {
        console.log(`  \u{1F504} Stablecoin history: purged ${purged} stale entries (pre-v12 data), ${stablecoinSupplyHistory.values.length} remain`);
      }
    }

    stablecoinSupplyHistory.values.push({ timestamp: now, totalSupply });
    if (stablecoinSupplyHistory.values.length > 504) {
      stablecoinSupplyHistory.values = stablecoinSupplyHistory.values.slice(-504);
    }

    // Write back the mutated history
    _setStablecoinSupplyHistory(stablecoinSupplyHistory);

    // Compute 7-day change
    let supplyChange7d = 0;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const oldEntry = stablecoinSupplyHistory.values.find(v => new Date(v.timestamp).getTime() >= sevenDaysAgo);
    if (oldEntry && oldEntry.totalSupply > 0) {
      supplyChange7d = ((totalSupply - oldEntry.totalSupply) / oldEntry.totalSupply) * 100;
    }

    let signal: StablecoinSupplyData['signal'] = 'STABLE';
    if (supplyChange7d > _STABLECOIN_SUPPLY_CHANGE_THRESHOLD) signal = 'CAPITAL_INFLOW';
    else if (supplyChange7d < -_STABLECOIN_SUPPLY_CHANGE_THRESHOLD) signal = 'CAPITAL_OUTFLOW';

    console.log(`  \u{1F4B5} Base USDC supply: $${(totalSupply / 1e6).toFixed(1)}M (${supplyChange7d >= 0 ? '+' : ''}${supplyChange7d.toFixed(2)}% 7d) \u2192 ${signal}`);

    return {
      usdtMarketCap: 0,
      usdcMarketCap: totalSupply,
      totalStablecoinSupply: totalSupply,
      supplyChange7d,
      signal,
      lastUpdated: now,
    };
  } catch (e: any) {
    console.warn(`  \u26A0\uFE0F Base USDC supply fetch failed: ${e.message?.substring(0, 100) || e}`);
    return null;
  }
}
