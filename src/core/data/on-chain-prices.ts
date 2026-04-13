/**
 * NVR Capital — On-Chain Price Engine
 *
 * Extracted from agent-v3.2.ts (Phase 2a refactor).
 * Owns all on-chain pricing and DEX pool state:
 *   - Chainlink oracle reads (ETH, BTC, LINK)
 *   - DEX pool registry (discovery + caching)
 *   - V3 slot0 / V2 getReserves price reads
 *   - TWAP divergence, swap order flow, tick liquidity depth
 *   - Self-accumulating price history store
 *   - Volume enrichment (DexScreener fade-out)
 *   - Base USDC supply (stablecoin capital flow)
 *   - Harvest recipient parsing
 *
 * State exposed via getters — callers never mutate module state directly.
 */

import * as fs from 'fs';
import axios from 'axios';
import { rpcCall } from '../execution/rpc.js';
import {
  CHAINLINK_FEEDS_BASE,
  CHAINLINK_ABI_FRAGMENT,
} from '../config/chainlink-feeds.js';
import {
  TOKEN_REGISTRY,
  WETH_ADDRESS,
  USDC_ADDRESS,
  CBBTC_ADDRESS,
  VIRTUAL_ADDRESS,
  QUOTE_DECIMALS,
} from '../config/token-registry.js';
import {
  PRICE_HISTORY_RECORD_INTERVAL_MS,
  PRICE_HISTORY_MAX_POINTS,
  PRICE_HISTORY_SAVE_INTERVAL_MS,
  POOL_DISCOVERY_MAX_AGE_MS,
  POOL_REDISCOVERY_FAILURE_THRESHOLD,
  VOLUME_ENRICHMENT_INTERVAL_MS,
  VOLUME_SELF_SUFFICIENT_POINTS,
  PRICE_SANITY_MAX_DEVIATION,
  ORDER_FLOW_BLOCK_LOOKBACK,
  TWAP_DIVERGENCE_THRESHOLD_PCT,
  TICK_DEPTH_RANGE,
  LARGE_TRADE_THRESHOLD_USD,
  SWAP_EVENT_TOPIC,
  TWAP_OBSERVATION_SECONDS,
  STABLECOIN_SUPPLY_CHANGE_THRESHOLD,
  BTC_DOMINANCE_CHANGE_THRESHOLD,
} from '../config/constants.js';
import {
  computeLocalAltseasonSignal as _computeLocalAltseasonSignal,
  computePriceChange as _computePriceChange,
  decodeSqrtPriceX96,
} from '../../algorithm/index.js';
import type {
  PoolRegistryEntry,
  PoolRegistryFile,
  PriceHistoryStore,
} from '../types/services.js';
import type { StablecoinSupplyData } from '../types/market-data.js';
import type { HarvestRecipient } from '../types/state.js';
import type { TechnicalIndicators, AltseasonSignal } from '../../algorithm/index.js';

// ============================================================================
// MODULE STATE
// ============================================================================

const POOL_REGISTRY_VERSION = 6;

let poolRegistry: Record<string, PoolRegistryEntry> = {};
let lastPoolTicks: Record<string, number> = {};
let lastOnChainIntelligence: Record<string, {
  twap: TechnicalIndicators['twapDivergence'];
  orderFlow: TechnicalIndicators['orderFlow'];
  tickDepth: TechnicalIndicators['tickDepth'];
}> = {};

let priceHistoryStore: PriceHistoryStore = { version: 1, lastSaved: '', tokens: {} };
let lastPriceHistorySaveTime = 0;
let lastVolumeEnrichmentTime = 0;

let chainlinkDeviations: { symbol: string; dexPrice: number; oraclePrice: number; deviationPct: number }[] = [];
let stablecoinSupplyHistory: { values: { timestamp: string; totalSupply: number }[] } = { values: [] };

const POOL_REGISTRY_FILE = process.env.PERSIST_DIR
  ? `${process.env.PERSIST_DIR}/pool-registry.json`
  : './logs/pool-registry.json';

const PRICE_HISTORY_FILE = process.env.PERSIST_DIR
  ? `${process.env.PERSIST_DIR}/price-history.json`
  : './logs/price-history.json';

const KNOWN_DEX_IDS = new Set([
  'uniswap', 'uniswap_v3', 'uniswap-v3',
  'aerodrome', 'aerodrome_v2', 'aerodrome_slipstream', 'aerodrome-slipstream', 'slipstream',
  'pancakeswap', 'pancakeswap_v3',
  'sushiswap', 'sushiswap_v3',
  'baseswap', 'baseswap_v3',
  'quickswap', 'rocketswap',
]);

// ============================================================================
// STATE GETTERS
// ============================================================================

export function getPoolRegistry(): Record<string, PoolRegistryEntry> { return poolRegistry; }
export function getLastPoolTicks(): Record<string, number> { return lastPoolTicks; }
export function getLastOnChainIntelligence() { return lastOnChainIntelligence; }
export function getPriceHistoryStore(): PriceHistoryStore { return priceHistoryStore; }
export function getChainlinkDeviations() { return chainlinkDeviations; }
export function getStablecoinSupplyHistory() { return stablecoinSupplyHistory; }
/** Called by agent after state restore from disk to sync module state */
export function setStablecoinSupplyHistory(data: { values: { timestamp: string; totalSupply: number }[] }) {
  stablecoinSupplyHistory = data;
}

// ============================================================================
// CHAINLINK ORACLE READS
// ============================================================================

/**
 * Fetch prices directly from Chainlink oracles on Base via eth_call.
 * No API key needed, no rate limits. Covers ETH and BTC.
 */
export async function fetchChainlinkPrices(): Promise<Map<string, number>> {
  return fetchChainlinkPricesRaw();
}

export async function fetchChainlinkETHPrice(fallbackPrices: Record<string, { price: number }>): Promise<number> {
  try {
    const result = await rpcCall('eth_call', [
      { to: CHAINLINK_FEEDS_BASE.ETH.feed, data: CHAINLINK_ABI_FRAGMENT }, 'latest',
    ]);
    if (result && result !== '0x') {
      const price = parseInt(result, 16) / Math.pow(10, CHAINLINK_FEEDS_BASE.ETH.decimals);
      if (price > 0) return price;
    }
  } catch { /* fall through */ }
  return fallbackPrices['ETH']?.price || fallbackPrices['WETH']?.price || 0;
}

export async function fetchChainlinkBTCPrice(fallbackPrices: Record<string, { price: number }>): Promise<number> {
  try {
    const result = await rpcCall('eth_call', [
      { to: CHAINLINK_FEEDS_BASE.cbBTC.feed, data: CHAINLINK_ABI_FRAGMENT }, 'latest',
    ]);
    if (result && result !== '0x') {
      const price = parseInt(result, 16) / Math.pow(10, CHAINLINK_FEEDS_BASE.cbBTC.decimals);
      if (price > 0) return price;
    }
  } catch { /* fall through */ }
  return fallbackPrices['cbBTC']?.price || 0;
}

export async function fetchChainlinkLINKPrice(fallbackPrices: Record<string, { price: number }>): Promise<number> {
  try {
    const result = await rpcCall('eth_call', [
      { to: CHAINLINK_FEEDS_BASE.LINK.feed, data: CHAINLINK_ABI_FRAGMENT }, 'latest',
    ]);
    if (result && result !== '0x') {
      const price = parseInt(result, 16) / Math.pow(10, CHAINLINK_FEEDS_BASE.LINK.decimals);
      if (price > 0) return price;
    }
  } catch { /* fall through */ }
  return fallbackPrices['LINK']?.price || 0;
}

// ============================================================================
// DEX POOL REGISTRY
// ============================================================================

async function probePoolType(
  poolAddress: string,
  dexId: string,
): Promise<PoolRegistryEntry['poolType'] | null> {
  const id = dexId.toLowerCase();

  try {
    const slot0Result = await rpcCall('eth_call', [{ to: poolAddress, data: '0x3850c7bd' }, 'latest']);
    if (slot0Result && slot0Result !== '0x' && slot0Result.length >= 66) {
      return (id === 'aerodrome' || id === 'aerodrome_slipstream' || id === 'aerodrome-slipstream' || id === 'slipstream')
        ? 'aerodromeV3' : 'uniswapV3';
    }
  } catch { /* not V3 */ }

  try {
    const reservesResult = await rpcCall('eth_call', [{ to: poolAddress, data: '0x0902f1ac' }, 'latest']);
    if (reservesResult && reservesResult !== '0x' && reservesResult.length >= 130) {
      return 'aerodrome';
    }
  } catch { /* not V2 either */ }

  return null;
}

export async function discoverPoolAddresses(): Promise<void> {
  try {
    if (fs.existsSync(POOL_REGISTRY_FILE)) {
      const data: PoolRegistryFile = JSON.parse(fs.readFileSync(POOL_REGISTRY_FILE, 'utf-8'));
      const age = Date.now() - new Date(data.discoveredAt).getTime();
      const registryTokens = Object.keys(TOKEN_REGISTRY).filter(s => s !== 'USDC');
      const cachedTokens = new Set(Object.keys(data.pools));
      const missingTokens = registryTokens.filter(s => !cachedTokens.has(s) && s !== 'ETH');
      if (data.version === POOL_REGISTRY_VERSION && age < POOL_DISCOVERY_MAX_AGE_MS && Object.keys(data.pools).length > 0 && missingTokens.length === 0) {
        poolRegistry = data.pools;
        for (const entry of Object.values(poolRegistry)) entry.consecutiveFailures = 0;
        console.log(`  ♻️  Pool registry loaded: ${Object.keys(poolRegistry).length} pools from cache (${(age / 3600000).toFixed(1)}h old)`);
        return;
      }
      if (missingTokens.length > 0) {
        console.log(`  🔄 Pool registry stale — missing pools for: ${missingTokens.join(', ')}. Re-discovering...`);
      }
    }
  } catch { /* corrupt file — re-discover */ }

  console.log(`  🔍 Discovering pool addresses via DexScreener...`);

  try {
    const addresses = Object.entries(TOKEN_REGISTRY)
      .filter(([s]) => s !== 'USDC' && TOKEN_REGISTRY[s].address !== 'native')
      .map(([_, t]) => t.address)
      .join(',');

    const res = await axios.get(
      `https://api.dexscreener.com/tokens/v1/base/${addresses}`,
      { timeout: 15000 },
    );

    if (!res.data || !Array.isArray(res.data)) {
      console.warn(`  ⚠️ DexScreener pool discovery returned invalid data`);
      return;
    }

    const newRegistry: Record<string, PoolRegistryEntry> = {};

    for (const [symbol, tokenInfo] of Object.entries(TOKEN_REGISTRY)) {
      if (symbol === 'USDC') continue;
      const tokenAddr = (tokenInfo.address === 'native' ? TOKEN_REGISTRY.WETH.address : tokenInfo.address).toLowerCase();

      const pools = res.data
        .filter((p: any) =>
          p.chainId === 'base' &&
          (p.baseToken?.address?.toLowerCase() === tokenAddr || p.quoteToken?.address?.toLowerCase() === tokenAddr) &&
          (p.liquidity?.usd || 0) > 0
        )
        .sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));

      if (pools.length === 0) continue;

      for (const pool of pools) {
        const dexId = (pool.dexId || '').toLowerCase();
        if (!KNOWN_DEX_IDS.has(dexId)) continue;

        const baseAddr = pool.baseToken?.address?.toLowerCase() || '';
        const quoteAddr = pool.quoteToken?.address?.toLowerCase() || '';
        const isToken0 = baseAddr === tokenAddr;
        const pairedAddr = isToken0 ? quoteAddr : baseAddr;

        let quoteToken: 'WETH' | 'USDC' | 'cbBTC' | 'VIRTUAL';
        if (pairedAddr === WETH_ADDRESS) quoteToken = 'WETH';
        else if (pairedAddr === USDC_ADDRESS) quoteToken = 'USDC';
        else if (pairedAddr === CBBTC_ADDRESS) quoteToken = 'cbBTC';
        else if (pairedAddr === VIRTUAL_ADDRESS) quoteToken = 'VIRTUAL';
        else continue;

        const poolType = await probePoolType(pool.pairAddress, dexId);
        if (!poolType) continue;

        const addr0 = tokenAddr < pairedAddr ? tokenAddr : pairedAddr;
        const token0IsOurToken = addr0 === tokenAddr;
        const quoteDec = QUOTE_DECIMALS[quoteToken] || 18;
        const dec0 = token0IsOurToken ? tokenInfo.decimals : quoteDec;
        const dec1 = token0IsOurToken ? quoteDec : tokenInfo.decimals;

        let tickSpacing: number | undefined;
        if (poolType === 'aerodromeV3') {
          try {
            const tsResult = await rpcCall('eth_call', [{ to: pool.pairAddress, data: '0xd0c93a7c' }, 'latest']);
            if (tsResult && tsResult !== '0x' && tsResult.length >= 66) {
              const raw = parseInt(tsResult.slice(0, 66), 16);
              tickSpacing = raw > 0x7fffff ? raw - 0x1000000 : raw;
              console.log(`     🔵 ${symbol}: Aerodrome Slipstream tickSpacing=${tickSpacing}`);
            }
          } catch { /* non-critical */ }
        }

        newRegistry[symbol] = {
          poolAddress: pool.pairAddress,
          poolType,
          quoteToken,
          token0IsBase: token0IsOurToken,
          token0Decimals: dec0,
          token1Decimals: dec1,
          dexName: pool.dexId || 'unknown',
          liquidityUSD: pool.liquidity?.usd || 0,
          consecutiveFailures: 0,
          tickSpacing,
        };
        break;
      }
    }

    if (newRegistry['WETH'] && !newRegistry['ETH']) {
      newRegistry['ETH'] = { ...newRegistry['WETH'] };
    }

    poolRegistry = newRegistry;
    const v3Count = Object.values(poolRegistry).filter(p => p.poolType === 'uniswapV3' || p.poolType === 'aerodromeV3').length;
    const v2Count = Object.values(poolRegistry).filter(p => p.poolType === 'aerodrome').length;
    console.log(`  ✅ Pool registry: ${Object.keys(poolRegistry).length} pools discovered (${v3Count} V3/slot0, ${v2Count} V2/reserves)`);
    for (const [sym, info] of Object.entries(poolRegistry)) {
      console.log(`     ${sym}: ${info.poolType} @ ${info.poolAddress.slice(0, 10)}... (${info.quoteToken}, $${(info.liquidityUSD / 1000).toFixed(0)}K liq)`);
    }

    const registryData: PoolRegistryFile = {
      version: POOL_REGISTRY_VERSION,
      discoveredAt: new Date().toISOString(),
      pools: poolRegistry,
    };
    const tmpFile = POOL_REGISTRY_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(registryData, null, 2));
    fs.renameSync(tmpFile, POOL_REGISTRY_FILE);
  } catch (e: any) {
    console.warn(`  ⚠️ Pool discovery failed: ${e.message?.substring(0, 100) || e}`);
  }
}

// ============================================================================
// ON-CHAIN TOKEN PRICE READS
// ============================================================================

export async function fetchOnChainTokenPrice(
  symbol: string,
  ethUsdPrice: number,
  btcUsdPrice: number = 0,
  virtualUsdPrice: number = 0,
): Promise<number | null> {
  const pool = poolRegistry[symbol];
  if (!pool) return null;

  try {
    let tokenPrice: number;

    if (pool.poolType === 'uniswapV3' || pool.poolType === 'aerodromeV3') {
      const result = await rpcCall('eth_call', [{ to: pool.poolAddress, data: '0x3850c7bd' }, 'latest']);
      if (!result || result === '0x' || result.length < 66) return null;

      const rawPrice = decodeSqrtPriceX96(result.slice(2), pool.token0Decimals, pool.token1Decimals);

      try {
        const tickHex = result.slice(2 + 64, 2 + 128);
        const tickBigInt = BigInt('0x' + tickHex);
        const tick = Number(
          tickBigInt > BigInt('0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')
            ? tickBigInt - BigInt('0x10000000000000000000000000000000000000000000000000000000000000000')
            : tickBigInt,
        );
        if (tick >= -887272 && tick <= 887272) {
          lastPoolTicks[symbol] = tick;
        }
      } catch { /* non-critical */ }

      if (rawPrice <= 0) return null;
      tokenPrice = pool.token0IsBase ? rawPrice : 1 / rawPrice;
    } else {
      const result = await rpcCall('eth_call', [{ to: pool.poolAddress, data: '0x0902f1ac' }, 'latest']);
      if (!result || result === '0x' || result.length < 130) return null;

      const reserve0 = BigInt('0x' + result.slice(2, 66));
      const reserve1 = BigInt('0x' + result.slice(66, 130));
      if (reserve0 === 0n || reserve1 === 0n) return null;

      const r0 = Number(reserve0) / (10 ** pool.token0Decimals);
      const r1 = Number(reserve1) / (10 ** pool.token1Decimals);
      tokenPrice = pool.token0IsBase ? r1 / r0 : r0 / r1;
    }

    let priceUSD: number;
    if (pool.quoteToken === 'WETH') priceUSD = tokenPrice * ethUsdPrice;
    else if (pool.quoteToken === 'cbBTC') priceUSD = btcUsdPrice > 0 ? tokenPrice * btcUsdPrice : 0;
    else if (pool.quoteToken === 'VIRTUAL') priceUSD = virtualUsdPrice > 0 ? tokenPrice * virtualUsdPrice : 0;
    else priceUSD = tokenPrice;

    if (priceUSD <= 0 || !isFinite(priceUSD)) return null;

    pool.consecutiveFailures = 0;
    return priceUSD;
  } catch {
    pool.consecutiveFailures++;
    return null;
  }
}

export async function fetchAllOnChainPrices(
  fallbackPrices: Record<string, { price: number }> = {},
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  prices.set('USDC', 1.0);

  const [ethPrice, btcPrice, linkPrice] = await Promise.all([
    fetchChainlinkETHPrice(fallbackPrices),
    fetchChainlinkBTCPrice(fallbackPrices),
    fetchChainlinkLINKPrice(fallbackPrices),
  ]);

  if (ethPrice > 0) { prices.set('ETH', ethPrice); prices.set('WETH', ethPrice); }
  if (btcPrice > 0) prices.set('cbBTC', btcPrice);
  if (linkPrice > 0) prices.set('LINK', linkPrice);

  // Pass 1: tokens paired with WETH or USDC
  const pass1Symbols = Object.keys(poolRegistry).filter(s =>
    !prices.has(s) && (poolRegistry[s].quoteToken === 'WETH' || poolRegistry[s].quoteToken === 'USDC'),
  );
  const pass1Results = await Promise.allSettled(
    pass1Symbols.map(s => fetchOnChainTokenPrice(s, ethPrice, btcPrice)),
  );
  for (let i = 0; i < pass1Symbols.length; i++) {
    const result = pass1Results[i];
    if (result.status === 'fulfilled' && result.value !== null && result.value > 0) {
      const lastPrice = fallbackPrices[pass1Symbols[i]]?.price;
      if (lastPrice && lastPrice > 0) {
        const deviation = Math.abs(result.value - lastPrice) / lastPrice;
        if (deviation > PRICE_SANITY_MAX_DEVIATION) {
          console.warn(`  ⚠️ Price sanity fail: ${pass1Symbols[i]} on-chain=$${result.value.toFixed(4)} vs last=$${lastPrice.toFixed(4)} (${(deviation * 100).toFixed(1)}% deviation) — skipping`);
          continue;
        }
      }
      prices.set(pass1Symbols[i], result.value);
    }
  }

  // Pass 2: tokens paired with cbBTC or VIRTUAL
  const virtualUsdPrice = prices.get('VIRTUAL') || 0;
  const pass2Symbols = Object.keys(poolRegistry).filter(s =>
    !prices.has(s) && (poolRegistry[s].quoteToken === 'cbBTC' || poolRegistry[s].quoteToken === 'VIRTUAL'),
  );
  if (pass2Symbols.length > 0) {
    const pass2Results = await Promise.allSettled(
      pass2Symbols.map(s => fetchOnChainTokenPrice(s, ethPrice, btcPrice, virtualUsdPrice)),
    );
    for (let i = 0; i < pass2Symbols.length; i++) {
      const result = pass2Results[i];
      if (result.status === 'fulfilled' && result.value !== null && result.value > 0) {
        const lastPrice = fallbackPrices[pass2Symbols[i]]?.price;
        if (lastPrice && lastPrice > 0) {
          const deviation = Math.abs(result.value - lastPrice) / lastPrice;
          if (deviation > PRICE_SANITY_MAX_DEVIATION) {
            console.warn(`  ⚠️ Price sanity fail: ${pass2Symbols[i]} on-chain=$${result.value.toFixed(4)} vs last=$${lastPrice.toFixed(4)} (${(deviation * 100).toFixed(1)}% deviation) — skipping`);
            continue;
          }
        }
        prices.set(pass2Symbols[i], result.value);
      }
    }
  }

  // Pool health check
  for (const [symbol, entry] of Object.entries(poolRegistry)) {
    if (entry.consecutiveFailures >= POOL_REDISCOVERY_FAILURE_THRESHOLD) {
      console.warn(`  🔄 ${symbol}: ${entry.consecutiveFailures} consecutive failures — will re-discover pool on next startup`);
    }
  }

  // Chainlink deviation detection
  const clPrices = await fetchChainlinkPricesRaw();
  const deviations: typeof chainlinkDeviations = [];
  for (const [symbol, oraclePrice] of clPrices) {
    const dexPrice = prices.get(symbol);
    if (dexPrice && oraclePrice > 0) {
      const deviation = ((dexPrice - oraclePrice) / oraclePrice) * 100;
      if (Math.abs(deviation) > 2.0) {
        deviations.push({ symbol, dexPrice, oraclePrice, deviationPct: deviation });
      }
    }
  }
  chainlinkDeviations = deviations;
  if (deviations.length > 0) {
    console.log(`  ⚡ CHAINLINK DEVIATION: ${deviations.map(d => `${d.symbol} DEX=$${d.dexPrice.toFixed(2)} vs Oracle=$${d.oraclePrice.toFixed(2)} (${d.deviationPct > 0 ? '+' : ''}${d.deviationPct.toFixed(1)}%)`).join(' | ')}`);
  }

  return prices;
}

// Internal version that returns Map (used above to avoid duplicate Axios calls)
async function fetchChainlinkPricesRaw(): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  for (const [symbol, config] of Object.entries(CHAINLINK_FEEDS_BASE)) {
    try {
      const result = await rpcCall('eth_call', [
        { to: config.feed, data: CHAINLINK_ABI_FRAGMENT }, 'latest',
      ]);
      if (result && result !== '0x') {
        const price = parseInt(result, 16) / Math.pow(10, config.decimals);
        if (price > 0) prices.set(symbol, price);
      }
    } catch { /* silent */ }
  }
  return prices;
}

// ============================================================================
// PRICE HISTORY STORE
// ============================================================================

export function loadPriceHistoryStore(): void {
  try {
    if (fs.existsSync(PRICE_HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(PRICE_HISTORY_FILE, 'utf-8'));
      if (data.version === 1 && data.tokens) {
        priceHistoryStore = data;
        const tokenCount = Object.keys(data.tokens).length;
        const totalPoints = Object.values(data.tokens as Record<string, { prices: number[] }>)
          .reduce((sum, t) => sum + t.prices.length, 0);
        console.log(`  ♻️  Price history loaded: ${tokenCount} tokens, ${totalPoints} total data points`);
      }
    }
  } catch { /* corrupt file — start fresh */ }
}

export function savePriceHistoryStore(): void {
  try {
    priceHistoryStore.lastSaved = new Date().toISOString();
    const tmpFile = PRICE_HISTORY_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(priceHistoryStore));
    fs.renameSync(tmpFile, PRICE_HISTORY_FILE);
    lastPriceHistorySaveTime = Date.now();
  } catch { /* non-critical */ }
}

export function recordPriceSnapshot(prices: Map<string, number>): void {
  const now = Date.now();

  for (const [symbol, price] of prices) {
    if (price <= 0 || symbol === 'USDC') continue;

    let entry = priceHistoryStore.tokens[symbol];
    if (!entry) {
      entry = { timestamps: [], prices: [], volumes: [] };
      priceHistoryStore.tokens[symbol] = entry;
    }

    const lastTs = entry.timestamps[entry.timestamps.length - 1] || 0;
    if (now - lastTs >= PRICE_HISTORY_RECORD_INTERVAL_MS) {
      entry.timestamps.push(now);
      entry.prices.push(price);
      entry.volumes.push(0);

      if (entry.timestamps.length > PRICE_HISTORY_MAX_POINTS) {
        const excess = entry.timestamps.length - PRICE_HISTORY_MAX_POINTS;
        entry.timestamps = entry.timestamps.slice(excess);
        entry.prices = entry.prices.slice(excess);
        entry.volumes = entry.volumes.slice(excess);
      }
    }
  }

  if (now - lastPriceHistorySaveTime >= PRICE_HISTORY_SAVE_INTERVAL_MS) {
    savePriceHistoryStore();
  }
}

// Thin wrappers that pass module state to algorithm-layer pure functions
export function computePriceChange(symbol: string, currentPrice: number, lookbackMs: number): number {
  return _computePriceChange(priceHistoryStore.tokens[symbol], currentPrice, lookbackMs);
}

export function computeLocalAltseasonSignal(): AltseasonSignal {
  return _computeLocalAltseasonSignal(
    priceHistoryStore.tokens['cbBTC'],
    priceHistoryStore.tokens['ETH'] || priceHistoryStore.tokens['WETH'],
    BTC_DOMINANCE_CHANGE_THRESHOLD,
  );
}

// ============================================================================
// ON-CHAIN ORDER FLOW INTELLIGENCE (V3 pools)
// ============================================================================

export async function fetchTWAPDivergence(
  symbol: string,
  spotPrice: number,
  ethPrice: number,
  btcPrice: number = 0,
  virtualPrice: number = 0,
): Promise<TechnicalIndicators['twapDivergence']> {
  const pool = poolRegistry[symbol];
  if (!pool || (pool.poolType !== 'uniswapV3' && pool.poolType !== 'aerodromeV3')) return null;
  if (spotPrice <= 0 || ethPrice <= 0) return null;

  try {
    const calldata = '0x883bdbfd' +
      '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000002' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000384';

    const result = await rpcCall('eth_call', [{ to: pool.poolAddress, data: calldata }, 'latest']);
    if (!result || result === '0x' || result.length < 258) return null;

    const data = result.slice(2);
    const ticksOffset = parseInt(data.slice(0, 64), 16) * 2;
    const ticksLength = parseInt(data.slice(ticksOffset, ticksOffset + 64), 16);
    if (ticksLength < 2) return null;

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
    const twapTick = Number(tickCum0 - tickCum1) / TWAP_OBSERVATION_SECONDS;
    const twapRawPrice = Math.pow(1.0001, twapTick);
    const decimalAdjustment = 10 ** (pool.token0Decimals - pool.token1Decimals);
    let twapTokenPrice = twapRawPrice * decimalAdjustment;
    if (!pool.token0IsBase) twapTokenPrice = 1 / twapTokenPrice;

    let twapPriceUSD: number;
    if (pool.quoteToken === 'WETH') twapPriceUSD = twapTokenPrice * ethPrice;
    else if (pool.quoteToken === 'cbBTC') twapPriceUSD = btcPrice > 0 ? twapTokenPrice * btcPrice : 0;
    else if (pool.quoteToken === 'VIRTUAL') twapPriceUSD = virtualPrice > 0 ? twapTokenPrice * virtualPrice : 0;
    else twapPriceUSD = twapTokenPrice;

    if (twapPriceUSD <= 0 || !isFinite(twapPriceUSD)) return null;

    const divergencePct = ((spotPrice - twapPriceUSD) / twapPriceUSD) * 100;
    let signal: 'OVERSOLD' | 'OVERBOUGHT' | 'NORMAL';
    if (divergencePct < -TWAP_DIVERGENCE_THRESHOLD_PCT) signal = 'OVERSOLD';
    else if (divergencePct > TWAP_DIVERGENCE_THRESHOLD_PCT) signal = 'OVERBOUGHT';
    else signal = 'NORMAL';

    return { twapPrice: twapPriceUSD, spotPrice, divergencePct, signal };
  } catch {
    return null;
  }
}

export async function fetchSwapOrderFlow(
  symbol: string,
  currentPrice: number,
  ethPrice: number,
  currentBlock: number,
): Promise<TechnicalIndicators['orderFlow']> {
  const pool = poolRegistry[symbol];
  if (!pool || currentPrice <= 0 || ethPrice <= 0 || currentBlock <= 0) return null;

  try {
    const fromBlock = '0x' + Math.max(0, currentBlock - ORDER_FLOW_BLOCK_LOOKBACK).toString(16);
    const logs = await rpcCall('eth_getLogs', [{
      address: pool.poolAddress,
      topics: [SWAP_EVENT_TOPIC],
      fromBlock,
      toBlock: 'latest',
    }]);

    if (!logs || !Array.isArray(logs) || logs.length === 0) return null;

    let buyVolumeUSD = 0, sellVolumeUSD = 0, largeBuyVolume = 0, tradeCount = 0;

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

        let isBuy: boolean, tradeAmountRaw: bigint, tradeDecimals: number;
        if (pool.token0IsBase) {
          isBuy = amount0 < 0n;
          tradeAmountRaw = amount0 < 0n ? -amount0 : amount0;
          tradeDecimals = pool.token0Decimals;
        } else {
          isBuy = amount1 < 0n;
          tradeAmountRaw = amount1 < 0n ? -amount1 : amount1;
          tradeDecimals = pool.token1Decimals;
        }

        const tradeValueUSD = (Number(tradeAmountRaw) / (10 ** tradeDecimals)) * currentPrice;
        if (tradeValueUSD <= 0 || !isFinite(tradeValueUSD) || tradeValueUSD > 10_000_000) continue;

        tradeCount++;
        if (isBuy) {
          buyVolumeUSD += tradeValueUSD;
          if (tradeValueUSD >= LARGE_TRADE_THRESHOLD_USD) largeBuyVolume += tradeValueUSD;
        } else {
          sellVolumeUSD += tradeValueUSD;
        }
      } catch { continue; }
    }

    if (tradeCount === 0) return null;

    const totalVolume = buyVolumeUSD + sellVolumeUSD;
    const buyRatio = totalVolume > 0 ? buyVolumeUSD / totalVolume : 0.5;
    const largeBuyPct = buyVolumeUSD > 0 ? (largeBuyVolume / buyVolumeUSD) * 100 : 0;

    let signal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
    if (buyRatio > 0.65) signal = 'STRONG_BUY';
    else if (buyRatio > 0.55) signal = 'BUY';
    else if (buyRatio < 0.35) signal = 'STRONG_SELL';
    else if (buyRatio < 0.45) signal = 'SELL';
    else signal = 'NEUTRAL';

    return {
      netBuyVolumeUSD: Math.round(buyVolumeUSD - sellVolumeUSD),
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

async function readTickLiquidityNet(
  poolAddress: string,
  tick: number,
): Promise<{ tick: number; liquidityNet: bigint }> {
  let tickHex: string;
  if (tick >= 0) {
    tickHex = tick.toString(16).padStart(64, '0');
  } else {
    const twosComp = BigInt('0x10000000000000000000000000000000000000000000000000000000000000000') + BigInt(tick);
    tickHex = twosComp.toString(16).padStart(64, '0');
  }

  const result = await rpcCall('eth_call', [{ to: poolAddress, data: '0xf30dba93' + tickHex }, 'latest']);
  if (!result || result === '0x' || result.length < 130) return { tick, liquidityNet: 0n };

  const netHex = result.slice(2 + 64, 2 + 128);
  const netBigInt = BigInt('0x' + netHex);
  const liquidityNet = netBigInt > BigInt('0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')
    ? netBigInt - BigInt('0x10000000000000000000000000000000000000000000000000000000000000000')
    : netBigInt;

  return { tick, liquidityNet };
}

export async function fetchTickLiquidityDepth(
  symbol: string,
  currentPrice: number,
  ethPrice: number,
  lastKnownPrices: Record<string, { price: number }>,
): Promise<TechnicalIndicators['tickDepth']> {
  const pool = poolRegistry[symbol];
  if (!pool || (pool.poolType !== 'uniswapV3' && pool.poolType !== 'aerodromeV3')) return null;
  if (currentPrice <= 0 || ethPrice <= 0) return null;

  const currentTick = lastPoolTicks[symbol];
  if (currentTick === undefined) return null;

  try {
    if (!pool.tickSpacing) {
      const tsResult = await rpcCall('eth_call', [{ to: pool.poolAddress, data: '0xd0c93a7c' }, 'latest']);
      if (tsResult && tsResult !== '0x') {
        const tsVal = parseInt(tsResult, 16);
        pool.tickSpacing = tsVal > 8388607 ? tsVal - 16777216 : tsVal;
        if (pool.tickSpacing <= 0 || pool.tickSpacing > 16384) { pool.tickSpacing = undefined; return null; }
      } else { return null; }
    }

    const spacing = pool.tickSpacing!;
    const alignedTick = Math.floor(currentTick / spacing) * spacing;

    const liqResult = await rpcCall('eth_call', [{ to: pool.poolAddress, data: '0x1a686502' }, 'latest']);
    const inRangeLiquidity = liqResult && liqResult !== '0x' ? Number(BigInt(liqResult)) : 0;

    const tickReads: Promise<{ tick: number; liquidityNet: bigint }>[] = [];
    for (let i = 1; i <= TICK_DEPTH_RANGE; i++) {
      tickReads.push(readTickLiquidityNet(pool.poolAddress, alignedTick - (i * spacing)));
      tickReads.push(readTickLiquidityNet(pool.poolAddress, alignedTick + (i * spacing)));
    }

    const tickResults = await Promise.allSettled(tickReads);
    let bidDepthRaw = 0n, askDepthRaw = 0n;

    for (let i = 0; i < TICK_DEPTH_RANGE; i++) {
      const belowResult = tickResults[i * 2];
      const aboveResult = tickResults[i * 2 + 1];
      if (belowResult.status === 'fulfilled' && belowResult.value.liquidityNet > 0n)
        bidDepthRaw += belowResult.value.liquidityNet;
      if (aboveResult.status === 'fulfilled' && aboveResult.value.liquidityNet < 0n)
        askDepthRaw += -aboveResult.value.liquidityNet;
    }

    let quotePrice = 1;
    if (pool.quoteToken === 'WETH') quotePrice = ethPrice;
    else if (pool.quoteToken === 'cbBTC') quotePrice = lastKnownPrices['cbBTC']?.price || 0;
    else if (pool.quoteToken === 'VIRTUAL') quotePrice = lastKnownPrices['VIRTUAL']?.price || 0;

    const tickRangePrice = currentPrice * (Math.pow(1.0001, spacing) - 1);
    const scaleFactor = tickRangePrice * quotePrice / (10 ** 18);
    const bidDepthUSD = Number(bidDepthRaw) * scaleFactor;
    const askDepthUSD = Number(askDepthRaw) * scaleFactor;
    const inRangeLiqUSD = inRangeLiquidity * scaleFactor;

    if (bidDepthUSD <= 0 && askDepthUSD <= 0) return null;

    const depthRatio = askDepthUSD > 0 ? bidDepthUSD / askDepthUSD : bidDepthUSD > 0 ? 10 : 1;
    let signal: 'STRONG_SUPPORT' | 'SUPPORT' | 'BALANCED' | 'RESISTANCE' | 'STRONG_RESISTANCE';
    if (depthRatio > 2.0) signal = 'STRONG_SUPPORT';
    else if (depthRatio > 1.3) signal = 'SUPPORT';
    else if (depthRatio < 0.5) signal = 'STRONG_RESISTANCE';
    else if (depthRatio < 0.77) signal = 'RESISTANCE';
    else signal = 'BALANCED';

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

export async function fetchAllOnChainIntelligence(
  ethPrice: number,
  onChainPrices: Map<string, number>,
  lastKnownPrices: Record<string, { price: number }>,
  includeTickDepth: boolean = true,
): Promise<typeof lastOnChainIntelligence> {
  const result: typeof lastOnChainIntelligence = {};
  if (ethPrice <= 0) return result;

  try {
    const blockHex = await rpcCall('eth_blockNumber', []);
    const currentBlock = blockHex ? parseInt(blockHex, 16) : 0;
    if (currentBlock <= 0) return result;

    const btcPrice = onChainPrices.get('cbBTC') || lastKnownPrices['cbBTC']?.price || 0;
    const virtualPrice = onChainPrices.get('VIRTUAL') || lastKnownPrices['VIRTUAL']?.price || 0;

    const poolSymbols = Object.entries(poolRegistry)
      .filter(([symbol, pool]) =>
        (pool.poolType === 'uniswapV3' || pool.poolType === 'aerodromeV3') &&
        symbol !== 'ETH' && symbol !== 'WETH' && symbol !== 'USDC' &&
        pool.consecutiveFailures < 3,
      )
      .map(([symbol]) => symbol);

    const promises = poolSymbols.map(async (symbol) => {
      const spotPrice = onChainPrices.get(symbol) || lastKnownPrices[symbol]?.price || 0;
      if (spotPrice <= 0) return;

      const [twap, orderFlow] = await Promise.all([
        fetchTWAPDivergence(symbol, spotPrice, ethPrice, btcPrice, virtualPrice).catch(() => null),
        fetchSwapOrderFlow(symbol, spotPrice, ethPrice, currentBlock).catch(() => null),
      ]);

      let tickDepth: TechnicalIndicators['tickDepth'] = null;
      if (includeTickDepth) {
        tickDepth = await fetchTickLiquidityDepth(symbol, spotPrice, ethPrice, lastKnownPrices).catch(() => null);
      }

      result[symbol] = { twap, orderFlow, tickDepth };
    });

    await Promise.allSettled(promises);

    const twapCount = Object.values(result).filter(r => r.twap).length;
    const flowCount = Object.values(result).filter(r => r.orderFlow).length;
    const depthCount = Object.values(result).filter(r => r.tickDepth).length;
    console.log(`  📊 On-chain intelligence: ${twapCount} TWAP, ${flowCount} flow, ${depthCount} depth signals from ${poolSymbols.length} V3 pools`);

    lastOnChainIntelligence = result;
    return result;
  } catch (e: any) {
    console.error(`  ⚠️ On-chain intelligence failed: ${e?.message || String(e)}`);
    return result;
  }
}

// ============================================================================
// VOLUME ENRICHMENT
// ============================================================================

export async function enrichVolumeData(): Promise<Map<string, number>> {
  const volumes = new Map<string, number>();
  const now = Date.now();

  if (now - lastVolumeEnrichmentTime < VOLUME_ENRICHMENT_INTERVAL_MS) return volumes;

  const tokenLengths = Object.values(priceHistoryStore.tokens)
    .filter(t => t.prices.length > 0)
    .map(t => t.prices.length);
  const minPoints = tokenLengths.length > 0 ? Math.min(...tokenLengths) : 0;
  if (minPoints >= VOLUME_SELF_SUFFICIENT_POINTS) return volumes;

  try {
    const addresses = Object.entries(TOKEN_REGISTRY)
      .filter(([s]) => s !== 'USDC' && TOKEN_REGISTRY[s].address !== 'native')
      .map(([_, t]) => t.address)
      .join(',');

    const res = await axios.get(`https://api.dexscreener.com/tokens/v1/base/${addresses}`, { timeout: 10000 });

    if (res.data && Array.isArray(res.data)) {
      const seen = new Set<string>();
      for (const pair of res.data) {
        const addr = pair.baseToken?.address?.toLowerCase();
        const entry = Object.entries(TOKEN_REGISTRY).find(([_, t]) => t.address.toLowerCase() === addr);
        if (entry && !seen.has(entry[0])) {
          seen.add(entry[0]);
          const vol = pair.volume?.h24 || 0;
          if (vol > 0) volumes.set(entry[0], vol);
        }
      }
    }

    lastVolumeEnrichmentTime = now;
    if (volumes.size > 0) {
      console.log(`  📊 Volume enrichment: ${volumes.size} tokens (fade-out: ${minPoints}/${VOLUME_SELF_SUFFICIENT_POINTS} points)`);
    }
  } catch { /* non-critical */ }

  return volumes;
}

// ============================================================================
// BASE USDC SUPPLY
// ============================================================================

export async function fetchBaseUSDCSupply(): Promise<StablecoinSupplyData | null> {
  try {
    const result = await rpcCall('eth_call', [
      { to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', data: '0x18160ddd' }, 'latest',
    ]);
    if (!result || result === '0x') return null;

    const totalSupply = Number(BigInt(result)) / 1e6;
    const now = new Date().toISOString();

    // Purge stale pre-v12 CoinGecko entries
    if (stablecoinSupplyHistory.values.length > 0) {
      const before = stablecoinSupplyHistory.values.length;
      stablecoinSupplyHistory.values = stablecoinSupplyHistory.values.filter(v => {
        if (v.totalSupply <= 0) return false;
        const ratio = totalSupply / v.totalSupply;
        return ratio >= 0.1 && ratio <= 10;
      });
      const purged = before - stablecoinSupplyHistory.values.length;
      if (purged > 0) {
        console.log(`  🔄 Stablecoin history: purged ${purged} stale entries, ${stablecoinSupplyHistory.values.length} remain`);
      }
    }

    stablecoinSupplyHistory.values.push({ timestamp: now, totalSupply });
    if (stablecoinSupplyHistory.values.length > 504) {
      stablecoinSupplyHistory.values = stablecoinSupplyHistory.values.slice(-504);
    }

    let supplyChange7d = 0;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const oldEntry = stablecoinSupplyHistory.values.find(v => new Date(v.timestamp).getTime() >= sevenDaysAgo);
    if (oldEntry && oldEntry.totalSupply > 0) {
      supplyChange7d = ((totalSupply - oldEntry.totalSupply) / oldEntry.totalSupply) * 100;
    }

    let signal: StablecoinSupplyData['signal'] = 'STABLE';
    if (supplyChange7d > STABLECOIN_SUPPLY_CHANGE_THRESHOLD) signal = 'CAPITAL_INFLOW';
    else if (supplyChange7d < -STABLECOIN_SUPPLY_CHANGE_THRESHOLD) signal = 'CAPITAL_OUTFLOW';

    console.log(`  💵 Base USDC supply: $${(totalSupply / 1e6).toFixed(1)}M (${supplyChange7d >= 0 ? '+' : ''}${supplyChange7d.toFixed(2)}% 7d) → ${signal}`);

    return {
      usdtMarketCap: 0,
      usdcMarketCap: totalSupply,
      totalStablecoinSupply: totalSupply,
      supplyChange7d,
      signal,
      lastUpdated: now,
    };
  } catch (e: any) {
    console.warn(`  ⚠️ Base USDC supply fetch failed: ${e.message?.substring(0, 100) || e}`);
    return null;
  }
}

// ============================================================================
// HARVEST RECIPIENT PARSING
// ============================================================================

export function parseHarvestRecipients(): HarvestRecipient[] {
  // TODO: Ambassador Program Integration — read feeRate from referral config
  // (see stc-website/src/lib/referrals.ts for 6-tier ambassador structure)
  const recipientStr = process.env.HARVEST_RECIPIENTS || '';
  if (recipientStr) {
    const recipients = recipientStr.split(',').map(r => {
      const parts = r.trim().split(':');
      if (parts.length >= 3) {
        const label = parts[0].trim();
        const pct = parseFloat(parts[parts.length - 1]);
        const wallet = parts.slice(1, -1).join(':').trim();
        return { label, wallet, percent: pct };
      }
      return { label: '', wallet: '', percent: 0 };
    }).filter(r => r.wallet?.length >= 42 && r.percent > 0 && r.percent <= 50);

    const totalPct = recipients.reduce((s, r) => s + r.percent, 0);
    if (totalPct > 70) {
      console.warn(`  ⚠️ HARVEST_RECIPIENTS total ${totalPct}% exceeds 70% cap — rejecting all.`);
      return [];
    }
    if (totalPct > 50) {
      console.warn(`  ⚠️ HARVEST_RECIPIENTS total ${totalPct}% — over 50% allocated to withdrawals.`);
    }
    if (recipients.length > 0) {
      console.log(`  💰 Harvest recipients: ${recipients.map(r => `${r.label} (${r.percent}%)`).join(', ')}`);
      return recipients;
    }
  }

  // Default: NVR platform fee
  const platformFeeWallet = process.env.NVR_PLATFORM_WALLET;
  if (platformFeeWallet && platformFeeWallet.length >= 42) {
    return [{ label: 'NVR Platform', wallet: platformFeeWallet, percent: 2 }];
  }

  return [];
}

// ============================================================================
// MODULE INIT — load price history on startup
// ============================================================================
loadPriceHistoryStore();
