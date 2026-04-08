/**
 * Never Rest Capital — On-Chain Pricing Engine
 * Extracted from agent-v3.2.ts (Phase 15 refactor)
 *
 * Handles:
 * - Chainlink oracle price reads (ETH, BTC, LINK)
 * - DEX pool discovery via DexScreener
 * - On-chain token price reads from V3 slot0 / V2 getReserves
 * - Pool registry persistence (load/save to disk)
 * - Chainlink vs DEX deviation detection
 */

import * as fs from 'fs';
import axios from 'axios';
import type { PoolRegistryEntry, PoolRegistryFile } from '../types/services.js';

// ============================================================================
// MODULE STATE
// ============================================================================

let poolRegistry: Record<string, PoolRegistryEntry> = {};
let lastPoolTicks: Record<string, number> = {};
let lastOnChainIntelligence: Record<string, {
  twap: any;
  orderFlow: any;
  tickDepth: any;
}> = {};
let chainlinkDeviations: { symbol: string; dexPrice: number; oraclePrice: number; deviationPct: number }[] = [];

// ============================================================================
// INJECTED DEPENDENCIES
// ============================================================================

let _rpcCall: (method: string, params: any[]) => Promise<any>;
let _decodeSqrtPriceX96: (hexData: string, token0Decimals: number, token1Decimals: number) => number;
let _TOKEN_REGISTRY: Record<string, any>;
let _CHAINLINK_FEEDS_BASE: Record<string, { feed: string; decimals: number }>;
let _CHAINLINK_ABI_FRAGMENT: string;
let _BASE_RPC_ENDPOINTS: readonly string[];
let _POOL_DISCOVERY_MAX_AGE_MS: number;
let _POOL_REDISCOVERY_FAILURE_THRESHOLD: number;
let _PRICE_SANITY_MAX_DEVIATION: number;
let _WETH_ADDRESS: string;
let _USDC_ADDRESS: string;
let _CBBTC_ADDRESS: string;
let _VIRTUAL_ADDRESS: string;
let _QUOTE_DECIMALS: Record<string, number>;
let _getLastKnownPrices: () => Record<string, { price: number; [key: string]: any }>;

// ============================================================================
// INITIALIZATION
// ============================================================================

export interface OnChainPricingDeps {
  rpcCall: (method: string, params: any[]) => Promise<any>;
  decodeSqrtPriceX96: (hexData: string, token0Decimals: number, token1Decimals: number) => number;
  TOKEN_REGISTRY: Record<string, any>;
  CHAINLINK_FEEDS_BASE: Record<string, { feed: string; decimals: number }>;
  CHAINLINK_ABI_FRAGMENT: string;
  BASE_RPC_ENDPOINTS: readonly string[];
  POOL_DISCOVERY_MAX_AGE_MS: number;
  POOL_REDISCOVERY_FAILURE_THRESHOLD: number;
  PRICE_SANITY_MAX_DEVIATION: number;
  WETH_ADDRESS: string;
  USDC_ADDRESS: string;
  CBBTC_ADDRESS: string;
  VIRTUAL_ADDRESS: string;
  QUOTE_DECIMALS: Record<string, number>;
  getLastKnownPrices: () => Record<string, { price: number; [key: string]: any }>;
}

export function initOnChainPricing(deps: OnChainPricingDeps): void {
  _rpcCall = deps.rpcCall;
  _decodeSqrtPriceX96 = deps.decodeSqrtPriceX96;
  _TOKEN_REGISTRY = deps.TOKEN_REGISTRY;
  _CHAINLINK_FEEDS_BASE = deps.CHAINLINK_FEEDS_BASE;
  _CHAINLINK_ABI_FRAGMENT = deps.CHAINLINK_ABI_FRAGMENT;
  _BASE_RPC_ENDPOINTS = deps.BASE_RPC_ENDPOINTS;
  _POOL_DISCOVERY_MAX_AGE_MS = deps.POOL_DISCOVERY_MAX_AGE_MS;
  _POOL_REDISCOVERY_FAILURE_THRESHOLD = deps.POOL_REDISCOVERY_FAILURE_THRESHOLD;
  _PRICE_SANITY_MAX_DEVIATION = deps.PRICE_SANITY_MAX_DEVIATION;
  _WETH_ADDRESS = deps.WETH_ADDRESS;
  _USDC_ADDRESS = deps.USDC_ADDRESS;
  _CBBTC_ADDRESS = deps.CBBTC_ADDRESS;
  _VIRTUAL_ADDRESS = deps.VIRTUAL_ADDRESS;
  _QUOTE_DECIMALS = deps.QUOTE_DECIMALS;
  _getLastKnownPrices = deps.getLastKnownPrices;
}

// ============================================================================
// GETTERS — expose module state to the monolith
// ============================================================================

export function getPoolRegistry(): Record<string, PoolRegistryEntry> {
  return poolRegistry;
}

export function getLastPoolTicks(): Record<string, number> {
  return lastPoolTicks;
}

export function getLastOnChainIntelligence(): typeof lastOnChainIntelligence {
  return lastOnChainIntelligence;
}

export function setLastOnChainIntelligence(value: typeof lastOnChainIntelligence): void {
  lastOnChainIntelligence = value;
}

export function getChainlinkDeviations(): typeof chainlinkDeviations {
  return chainlinkDeviations;
}

// ============================================================================
// CONSTANTS — pricing-specific
// ============================================================================

const POOL_REGISTRY_VERSION = 6; // v20.5: Bump — force re-discovery for new tokens (AAVE, CRV, ENA, ETHFI)

const POOL_REGISTRY_FILE = process.env.PERSIST_DIR ? `${process.env.PERSIST_DIR}/pool-registry.json` : "./logs/pool-registry.json";

// Known DEX IDs that we accept (allows filtering out completely unknown DEXes)
const KNOWN_DEX_IDS = new Set([
  'uniswap', 'uniswap_v3', 'uniswap-v3',
  'aerodrome', 'aerodrome_v2', 'aerodrome_slipstream', 'aerodrome-slipstream', 'slipstream',
  'pancakeswap', 'pancakeswap_v3',
  'sushiswap', 'sushiswap_v3',
  'baseswap', 'baseswap_v3',
  'quickswap', 'rocketswap',
]);

// ============================================================================
// CHAINLINK ORACLE READS
// ============================================================================

/**
 * v6.2: Fetch prices directly from Chainlink oracles on Base via eth_call.
 * These are on-chain reads — no API key needed, no rate limits possible.
 * Only covers major tokens (ETH, BTC) but provides an unbreakable price floor.
 */
export async function fetchChainlinkPrices(): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  const chainlinkRpc = _BASE_RPC_ENDPOINTS[0]; // v8.1: Use primary from fallback list

  for (const [symbol, config] of Object.entries(_CHAINLINK_FEEDS_BASE)) {
    try {
      const res = await axios.post(chainlinkRpc, {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: config.feed, data: _CHAINLINK_ABI_FRAGMENT }, "latest"],
      }, { timeout: 5000 });

      if (res.data?.result && res.data.result !== "0x") {
        const rawPrice = parseInt(res.data.result, 16);
        const price = rawPrice / Math.pow(10, config.decimals);
        if (price > 0) {
          prices.set(symbol, price);
        }
      }
    } catch {
      // Silent fail per token — other sources still available
    }
  }

  if (prices.size > 0) {
    console.log(`  🔗 Chainlink oracle: ${prices.size} prices (${[...prices.entries()].map(([s, p]) => `${s}=$${p.toFixed(2)}`).join(", ")})`);
  }

  return prices;
}

/**
 * Fetch ETH/USD price from Chainlink oracle (single RPC call).
 * Reuses existing Chainlink infrastructure.
 */
export async function fetchChainlinkETHPrice(): Promise<number> {
  try {
    const result = await _rpcCall('eth_call', [
      { to: _CHAINLINK_FEEDS_BASE.ETH.feed, data: _CHAINLINK_ABI_FRAGMENT }, 'latest'
    ]);
    if (result && result !== '0x') {
      const price = parseInt(result, 16) / Math.pow(10, _CHAINLINK_FEEDS_BASE.ETH.decimals);
      if (price > 0) return price;
    }
  } catch { /* fall through */ }
  // Fallback: use last known ETH price
  const lastKnown = _getLastKnownPrices();
  return lastKnown['ETH']?.price || lastKnown['WETH']?.price || 0;
}

/**
 * Fetch BTC/USD price from Chainlink oracle (single RPC call).
 */
export async function fetchChainlinkBTCPrice(): Promise<number> {
  try {
    const result = await _rpcCall('eth_call', [
      { to: _CHAINLINK_FEEDS_BASE.cbBTC.feed, data: _CHAINLINK_ABI_FRAGMENT }, 'latest'
    ]);
    if (result && result !== '0x') {
      const price = parseInt(result, 16) / Math.pow(10, _CHAINLINK_FEEDS_BASE.cbBTC.decimals);
      if (price > 0) return price;
    }
  } catch { /* fall through */ }
  const lastKnown = _getLastKnownPrices();
  return lastKnown['cbBTC']?.price || 0;
}

/**
 * Fetch LINK/USD price from Chainlink oracle (single RPC call).
 */
export async function fetchChainlinkLINKPrice(): Promise<number> {
  try {
    const result = await _rpcCall('eth_call', [
      { to: _CHAINLINK_FEEDS_BASE.LINK.feed, data: _CHAINLINK_ABI_FRAGMENT }, 'latest'
    ]);
    if (result && result !== '0x') {
      const price = parseInt(result, 16) / Math.pow(10, _CHAINLINK_FEEDS_BASE.LINK.decimals);
      if (price > 0) return price;
    }
  } catch { /* fall through */ }
  const lastKnown = _getLastKnownPrices();
  return lastKnown['LINK']?.price || 0;
}

// ============================================================================
// POOL REGISTRY — Discovery & Persistence
// ============================================================================

/**
 * v12.0.3: Probe a pool contract on-chain to determine V2 vs V3 type.
 * DexScreener's labels field is unreliable (missing for Aerodrome, PancakeSwap, etc.).
 * Instead, we try slot0() first — if it responds, it's V3. Otherwise try getReserves() for V2.
 * This costs 1-2 free RPC view calls per pool during one-time discovery.
 */
export async function probePoolType(poolAddress: string, dexId: string): Promise<PoolRegistryEntry['poolType'] | null> {
  const id = dexId.toLowerCase();

  // Try slot0() — V3/CL pools implement this (selector 0x3850c7bd)
  try {
    const slot0Result = await _rpcCall('eth_call', [
      { to: poolAddress, data: '0x3850c7bd' }, 'latest'
    ]);
    if (slot0Result && slot0Result !== '0x' && slot0Result.length >= 66) {
      // Valid slot0 response — this is a V3/CL pool
      // Aerodrome CL (slipstream) uses same ABI as Uni V3
      return (id === 'aerodrome' || id === 'aerodrome_slipstream' || id === 'aerodrome-slipstream' || id === 'slipstream')
        ? 'aerodromeV3' : 'uniswapV3';
    }
  } catch { /* slot0 not available — not a V3 pool */ }

  // Try getReserves() — V2/constant-product pools implement this (selector 0x0902f1ac)
  try {
    const reservesResult = await _rpcCall('eth_call', [
      { to: poolAddress, data: '0x0902f1ac' }, 'latest'
    ]);
    if (reservesResult && reservesResult !== '0x' && reservesResult.length >= 130) {
      return 'aerodrome'; // V2 pool — all V2 forks use the same getReserves ABI
    }
  } catch { /* getReserves not available either */ }

  // Neither worked — skip this pool
  return null;
}

/**
 * Discover pool addresses for all tokens via DexScreener (one-time bootstrap).
 * Caches to disk — subsequent startups load from file.
 */
export async function discoverPoolAddresses(): Promise<void> {
  // Try loading from disk first
  try {
    if (fs.existsSync(POOL_REGISTRY_FILE)) {
      const data: PoolRegistryFile = JSON.parse(fs.readFileSync(POOL_REGISTRY_FILE, 'utf-8'));
      const age = Date.now() - new Date(data.discoveredAt).getTime();
      // v12.2.1: Check if any TOKEN_REGISTRY tokens are missing from cached registry — force re-discover if so
      const registryTokens = Object.keys(_TOKEN_REGISTRY).filter(s => s !== 'USDC');
      const cachedTokens = new Set(Object.keys(data.pools));
      const missingTokens = registryTokens.filter(s => !cachedTokens.has(s) && s !== 'ETH'); // ETH aliases WETH
      if (data.version === POOL_REGISTRY_VERSION && age < _POOL_DISCOVERY_MAX_AGE_MS && Object.keys(data.pools).length > 0 && missingTokens.length === 0) {
        poolRegistry = data.pools;
        // Reset failure counts on fresh load
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
    // Batch all token addresses in one call
    const addresses = Object.entries(_TOKEN_REGISTRY)
      .filter(([s]) => s !== 'USDC' && _TOKEN_REGISTRY[s].address !== 'native')
      .map(([_, t]) => t.address)
      .join(',');

    const res = await axios.get(
      `https://api.dexscreener.com/tokens/v1/base/${addresses}`,
      { timeout: 15000 }
    );

    if (!res.data || !Array.isArray(res.data)) {
      console.warn(`  ⚠️ DexScreener pool discovery returned invalid data`);
      return;
    }

    const newRegistry: Record<string, PoolRegistryEntry> = {};

    for (const [symbol, tokenInfo] of Object.entries(_TOKEN_REGISTRY)) {
      if (symbol === 'USDC') continue;
      const tokenAddr = ((tokenInfo as any).address === 'native' ? _TOKEN_REGISTRY.WETH.address : (tokenInfo as any).address).toLowerCase();

      // Find all Base pools for this token, sorted by liquidity
      const pools = res.data
        .filter((p: any) =>
          p.chainId === 'base' &&
          (p.baseToken?.address?.toLowerCase() === tokenAddr || p.quoteToken?.address?.toLowerCase() === tokenAddr) &&
          (p.liquidity?.usd || 0) > 0
        )
        .sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));

      if (pools.length === 0) continue;

      // Pick deepest pool that we can read on-chain
      for (const pool of pools) {
        const dexId = (pool.dexId || '').toLowerCase();
        if (!KNOWN_DEX_IDS.has(dexId)) continue; // skip completely unknown DEXes

        const baseAddr = pool.baseToken?.address?.toLowerCase() || '';
        const quoteAddr = pool.quoteToken?.address?.toLowerCase() || '';

        // Determine which side is our token and what it's paired with
        const isToken0 = baseAddr === tokenAddr;
        const pairedAddr = isToken0 ? quoteAddr : baseAddr;
        let quoteToken: 'WETH' | 'USDC' | 'cbBTC' | 'VIRTUAL';
        if (pairedAddr === _WETH_ADDRESS) quoteToken = 'WETH';
        else if (pairedAddr === _USDC_ADDRESS) quoteToken = 'USDC';
        else if (pairedAddr === _CBBTC_ADDRESS) quoteToken = 'cbBTC';
        else if (pairedAddr === _VIRTUAL_ADDRESS) quoteToken = 'VIRTUAL';
        else continue; // paired with something else, skip

        // v12.0.3: Probe pool on-chain to determine V2 vs V3 (DexScreener labels are unreliable)
        const poolType = await probePoolType(pool.pairAddress, dexId);
        if (!poolType) continue; // pool didn't respond to either slot0 or getReserves

        // For slot0-based pools, token0IsBase refers to Uniswap's actual token0
        // DexScreener's baseToken is the first token in the pair display, which may differ
        // We need to determine the actual on-chain token0 ordering
        // token0 is always the address that sorts lower numerically
        const addr0 = tokenAddr < pairedAddr ? tokenAddr : pairedAddr;
        const token0IsOurToken = addr0 === tokenAddr;

        const quoteDec = _QUOTE_DECIMALS[quoteToken] || 18;
        const dec0 = token0IsOurToken ? (tokenInfo as any).decimals : quoteDec;
        const dec1 = token0IsOurToken ? quoteDec : (tokenInfo as any).decimals;

        // v20.4.2: Read tickSpacing for Aerodrome Slipstream pools
        let tickSpacing: number | undefined;
        if (poolType === 'aerodromeV3') {
          try {
            // tickSpacing() selector: 0xd0c93a7c
            const tsResult = await _rpcCall('eth_call', [{ to: pool.pairAddress, data: '0xd0c93a7c' }, 'latest']);
            if (tsResult && tsResult !== '0x' && tsResult.length >= 66) {
              const raw = parseInt(tsResult.slice(0, 66), 16);
              tickSpacing = raw > 0x7fffff ? raw - 0x1000000 : raw; // int24 decoding
              console.log(`     🔵 ${symbol}: Aerodrome Slipstream tickSpacing=${tickSpacing}`);
            }
          } catch { /* non-critical — will try all spacings during swap */ }
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
        break; // Use first viable pool (deepest liquidity)
      }
    }

    // Handle ETH as an alias for WETH
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

    // Persist to disk
    const registryData: PoolRegistryFile = { version: POOL_REGISTRY_VERSION, discoveredAt: new Date().toISOString(), pools: poolRegistry };
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

/**
 * Read a single token's price from its on-chain DEX pool.
 * Returns price in USD, or null on failure.
 */
export async function fetchOnChainTokenPrice(symbol: string, ethUsdPrice: number, btcUsdPrice: number = 0, virtualUsdPrice: number = 0): Promise<number | null> {
  const pool = poolRegistry[symbol];
  if (!pool) return null;

  try {
    let tokenPrice: number;

    if (pool.poolType === 'uniswapV3' || pool.poolType === 'aerodromeV3') {
      // slot0() → returns (uint160 sqrtPriceX96, int24 tick, ...)
      const result = await _rpcCall('eth_call', [
        { to: pool.poolAddress, data: '0x3850c7bd' }, 'latest'
      ]);
      if (!result || result === '0x' || result.length < 66) return null;

      // Strip '0x' prefix for decoding
      const rawPrice = _decodeSqrtPriceX96(result.slice(2), pool.token0Decimals, pool.token1Decimals);

      // v12.3: Parse tick from slot0 bytes 32-63 (int24 packed in int256) — free data, already fetched
      try {
        const tickHex = result.slice(2 + 64, 2 + 128); // bytes 32-63
        const tickBigInt = BigInt('0x' + tickHex);
        const tick = Number(tickBigInt > BigInt('0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')
          ? tickBigInt - BigInt('0x10000000000000000000000000000000000000000000000000000000000000000')
          : tickBigInt);
        if (tick >= -887272 && tick <= 887272) { // Valid V3 tick range
          lastPoolTicks[symbol] = tick;
        }
      } catch { /* tick parse failure is non-critical */ }
      if (rawPrice <= 0) return null;

      // rawPrice = amount of token1 per 1 token0 (price of token0 in token1 terms)
      // If our token is token0: rawPrice IS our token's price in quote (token1) terms
      // If our token is token1: our token's price = 1/rawPrice in quote (token0) terms
      if (pool.token0IsBase) {
        // Our token is token0 → rawPrice = quote_per_our_token → use directly
        tokenPrice = rawPrice;
      } else {
        // Our token is token1 → rawPrice = our_token_per_quote → invert
        tokenPrice = 1 / rawPrice;
      }
    } else {
      // Aerodrome V2: getReserves() → (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)
      const result = await _rpcCall('eth_call', [
        { to: pool.poolAddress, data: '0x0902f1ac' }, 'latest'
      ]);
      if (!result || result === '0x' || result.length < 130) return null;

      const reserve0 = BigInt('0x' + result.slice(2, 66));
      const reserve1 = BigInt('0x' + result.slice(66, 130));
      if (reserve0 === 0n || reserve1 === 0n) return null;

      // Adjust for decimals
      const r0 = Number(reserve0) / (10 ** pool.token0Decimals);
      const r1 = Number(reserve1) / (10 ** pool.token1Decimals);

      if (pool.token0IsBase) {
        // Our token is token0 → price = reserve1/reserve0 (how many quote tokens per base token)
        tokenPrice = r1 / r0;
      } else {
        // Our token is token1 → price = reserve0/reserve1
        tokenPrice = r0 / r1;
      }
    }

    // Convert to USD
    let priceUSD: number;
    if (pool.quoteToken === 'WETH') priceUSD = tokenPrice * ethUsdPrice;
    else if (pool.quoteToken === 'cbBTC') priceUSD = btcUsdPrice > 0 ? tokenPrice * btcUsdPrice : 0;
    else if (pool.quoteToken === 'VIRTUAL') priceUSD = virtualUsdPrice > 0 ? tokenPrice * virtualUsdPrice : 0;
    else priceUSD = tokenPrice; // USDC — already in USD
    if (priceUSD <= 0 || !isFinite(priceUSD)) return null;

    // Reset failure counter on success
    pool.consecutiveFailures = 0;
    return priceUSD;
  } catch (e: any) {
    pool.consecutiveFailures++;
    return null;
  }
}

// ============================================================================
// ORCHESTRATOR — Fetch all prices on-chain
// ============================================================================

/**
 * Fetch all token prices on-chain in parallel.
 * Primary: DEX pool reads. Chainlink for ETH/BTC/LINK.
 */
export async function fetchAllOnChainPrices(): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  prices.set('USDC', 1.0);
  const lastKnownPrices = _getLastKnownPrices();

  // Step 1: Get ETH, BTC, and LINK prices from Chainlink (most reliable)
  const [ethPrice, btcPrice, linkPrice] = await Promise.all([
    fetchChainlinkETHPrice(),
    fetchChainlinkBTCPrice(),
    fetchChainlinkLINKPrice(),
  ]);

  if (ethPrice > 0) {
    prices.set('ETH', ethPrice);
    prices.set('WETH', ethPrice);
  }
  if (btcPrice > 0) {
    prices.set('cbBTC', btcPrice);
  }
  if (linkPrice > 0) {
    prices.set('LINK', linkPrice);
  }

  // Step 2: Fetch tokens paired with WETH/USDC (no dependency on other token prices)
  const pass1Symbols = Object.keys(poolRegistry).filter(s =>
    !prices.has(s) && (poolRegistry[s].quoteToken === 'WETH' || poolRegistry[s].quoteToken === 'USDC')
  );
  const pass1Results = await Promise.allSettled(
    pass1Symbols.map(s => fetchOnChainTokenPrice(s, ethPrice, btcPrice))
  );

  for (let i = 0; i < pass1Symbols.length; i++) {
    const result = pass1Results[i];
    if (result.status === 'fulfilled' && result.value !== null && result.value > 0) {
      const lastPrice = lastKnownPrices[pass1Symbols[i]]?.price;
      if (lastPrice && lastPrice > 0) {
        const deviation = Math.abs(result.value - lastPrice) / lastPrice;
        if (deviation > _PRICE_SANITY_MAX_DEVIATION) {
          console.warn(`  ⚠️ Price sanity fail: ${pass1Symbols[i]} on-chain=$${result.value.toFixed(4)} vs last=$${lastPrice.toFixed(4)} (${(deviation * 100).toFixed(1)}% deviation) — skipping`);
          continue;
        }
      }
      prices.set(pass1Symbols[i], result.value);
    }
  }

  // Step 3: Fetch tokens paired with cbBTC or VIRTUAL (need pass 1 prices)
  const virtualUsdPrice = prices.get('VIRTUAL') || 0;
  const pass2Symbols = Object.keys(poolRegistry).filter(s =>
    !prices.has(s) && (poolRegistry[s].quoteToken === 'cbBTC' || poolRegistry[s].quoteToken === 'VIRTUAL')
  );
  if (pass2Symbols.length > 0) {
    const pass2Results = await Promise.allSettled(
      pass2Symbols.map(s => fetchOnChainTokenPrice(s, ethPrice, btcPrice, virtualUsdPrice))
    );

    for (let i = 0; i < pass2Symbols.length; i++) {
      const result = pass2Results[i];
      if (result.status === 'fulfilled' && result.value !== null && result.value > 0) {
        const lastPrice = lastKnownPrices[pass2Symbols[i]]?.price;
        if (lastPrice && lastPrice > 0) {
          const deviation = Math.abs(result.value - lastPrice) / lastPrice;
          if (deviation > _PRICE_SANITY_MAX_DEVIATION) {
            console.warn(`  ⚠️ Price sanity fail: ${pass2Symbols[i]} on-chain=$${result.value.toFixed(4)} vs last=$${lastPrice.toFixed(4)} (${(deviation * 100).toFixed(1)}% deviation) — skipping`);
            continue;
          }
        }
        prices.set(pass2Symbols[i], result.value);
      }
    }
  }

  // Check for tokens that need pool re-discovery
  for (const [symbol, entry] of Object.entries(poolRegistry)) {
    if (entry.consecutiveFailures >= _POOL_REDISCOVERY_FAILURE_THRESHOLD) {
      console.warn(`  🔄 ${symbol}: ${entry.consecutiveFailures} consecutive failures — will re-discover pool on next startup`);
    }
  }

  // v20.3.1: Chainlink deviation detection — compare DEX prices vs oracle reference
  // When DEX deviates >2% from Chainlink, it signals mispricing or arbitrage opportunity
  const chainlinkPricesMap = await fetchChainlinkPrices();
  const deviations: { symbol: string; dexPrice: number; oraclePrice: number; deviationPct: number }[] = [];
  for (const [symbol, oraclePrice] of chainlinkPricesMap) {
    const dexPrice = prices.get(symbol);
    if (dexPrice && oraclePrice > 0) {
      const deviation = ((dexPrice - oraclePrice) / oraclePrice) * 100;
      if (Math.abs(deviation) > 2.0) {
        deviations.push({ symbol, dexPrice, oraclePrice, deviationPct: deviation });
      }
    }
  }
  if (deviations.length > 0) {
    chainlinkDeviations = deviations;
    console.log(`  ⚡ CHAINLINK DEVIATION: ${deviations.map(d => `${d.symbol} DEX=$${d.dexPrice.toFixed(2)} vs Oracle=$${d.oraclePrice.toFixed(2)} (${d.deviationPct > 0 ? '+' : ''}${d.deviationPct.toFixed(1)}%)`).join(' | ')}`);
  } else {
    chainlinkDeviations = [];
  }

  return prices;
}
