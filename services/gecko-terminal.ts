/**
 * Never Rest Capital — GeckoTerminal DEX Intelligence Service
 * v11.0: Real-time Base DEX data for the AI trading brain
 *
 * FREE API — no auth required, 30 calls/min rate limit.
 * Provides: trending pools, token DEX metrics, volume spikes, buy/sell pressure,
 *           new pool detection, and smart money flow signals.
 *
 * API Base: https://api.geckoterminal.com/api/v2
 * Docs:     https://www.geckoterminal.com/dex-api
 */

import axios from 'axios';

// ============================================================================
// CONSTANTS
// ============================================================================

const API_BASE = 'https://api.geckoterminal.com/api/v2';
const NETWORK = 'base';
const RATE_LIMIT_MS = 2100; // ~28 calls/min to stay under 30/min limit

// Token addresses we trade (lowercase for matching)
const TRACKED_TOKENS: Record<string, string> = {
  'USDC':    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'ETH':     '0x4200000000000000000000000000000000000006', // WETH on Base
  'WETH':    '0x4200000000000000000000000000000000000006',
  'cbBTC':   '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
  'cbETH':   '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
  'wstETH':  '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452',
  'LINK':    '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196',
  'VIRTUAL': '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
  'AIXBT':   '0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825',
  'HIGHER':  '0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe',
  'VVV':     '0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf',
  'BRETT':   '0x532f27101965dd16442E59d40670FaF5eBB142E4',
  'DEGEN':   '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed',
  'TOSHI':   '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4',
  'MOCHI':   '0xF6e932Ca12afa26665dC4dDE7e27be02A7c02e50',
  'NORMIE':  '0x7F12d13B34F5F4f0a9449c16Bcd42f0da47AF200',
  'AERO':    '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
  'WELL':    '0xA88594D404727625A9437C3f886C7643872296AE',
  'SEAM':    '0x1C7a460413dD4e964f96D8dFC56E7223cE88CD85',
  'EXTRA':   '0x2Dad3a13ef0C6366220f989157009e501e7938F8',
  'BAL':     '0x4158734D47Fc9692176B5085E0F52ee0Da5d47F1',
  'MORPHO':  '0xBAa5CC21fd487B8Fcc2F632f3F4E8D37262a0842',
  'PENDLE':  '0xa99F6E6785da0F5d6FB42495Fe424BCE029Eeb3E',
  'RSR':     '0xaB36452DbAC151bE02b16Ca17d8919826072f64a',
  'cbLTC':   '0xcb17C9Db87B595717C857a08468793f5bAb6445F',
  'cbXRP':   '0xcb585250f852C6c6bf90434AB21A00f02833a4af',
  'CLANKER': '0x1bc0c42215582d5A085795f4baDbaC3ff36d1Bcb',
  'KEYCAT':  '0x9a26F5433671751C3276a065f57e5a02D2817973',
};

// Reverse lookup: address (lowercase) → symbol
const ADDRESS_TO_SYMBOL: Record<string, string> = {};
for (const [sym, addr] of Object.entries(TRACKED_TOKENS)) {
  if (sym !== 'ETH') { // skip duplicate ETH/WETH
    ADDRESS_TO_SYMBOL[addr.toLowerCase()] = sym;
  }
}

// ============================================================================
// TYPES
// ============================================================================

export interface DexPoolData {
  poolAddress: string;
  name: string;
  dex: string;
  baseToken: { address: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUSD: number;
  priceChange: { m5: number; h1: number; h6: number; h24: number };
  volume: { h1: number; h6: number; h24: number };
  transactions: {
    h1: { buys: number; sells: number; buyers: number; sellers: number };
    h24: { buys: number; sells: number; buyers: number; sellers: number };
  };
  liquidity: number;
  fdvUSD: number;
  poolCreatedAt: string | null;
}

export interface TokenDexMetrics {
  symbol: string;
  address: string;
  priceUSD: number;
  fdvUSD: number;
  volumeH24: number;
  marketCapUSD: number;
  topPoolAddress: string | null;
  topPoolLiquidity: number;
}

export interface VolumeSpike {
  symbol: string;
  address: string;
  poolName: string;
  h1Volume: number;
  h24Volume: number;
  spikeRatio: number; // h1 * 24 / h24 — values > 2 mean current volume >> average
  buyPressure: number; // buys / (buys + sells) in h1
  priceChangeH1: number;
}

export interface BuySellPressure {
  symbol: string;
  h1Buys: number;
  h1Sells: number;
  h1Buyers: number;
  h1Sellers: number;
  h24Buys: number;
  h24Sells: number;
  buyRatioH1: number; // 0-1, > 0.5 = more buys
  buyRatioH24: number;
  signal: 'STRONG_BUY' | 'BUY_PRESSURE' | 'NEUTRAL' | 'SELL_PRESSURE' | 'STRONG_SELL';
}

export interface DexIntelligence {
  /** Top trending pools on Base right now */
  trendingPools: DexPoolData[];
  /** DEX metrics for our tracked tokens */
  tokenMetrics: TokenDexMetrics[];
  /** Tokens with unusual volume activity */
  volumeSpikes: VolumeSpike[];
  /** Buy/sell pressure for tracked tokens */
  buySellPressure: BuySellPressure[];
  /** New pools involving our tracked tokens (last 24h) */
  newPools: DexPoolData[];
  /** AI-ready summary for the trading brain prompt */
  aiSummary: string;
  /** Timestamp of this intelligence snapshot */
  timestamp: string;
  /** Fetch errors (non-fatal) */
  errors: string[];
}

// ============================================================================
// RATE LIMITER
// ============================================================================

let lastCallTime = 0;

async function rateLimitedGet(url: string): Promise<any> {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastCallTime = Date.now();

  const res = await axios.get(url, {
    headers: { 'Accept': 'application/json' },
    timeout: 12000,
  });
  return res.data;
}

// ============================================================================
// DATA PARSERS
// ============================================================================

function parsePool(pool: any): DexPoolData {
  const a = pool.attributes || {};
  const rels = pool.relationships || {};

  // Extract token info from relationships or attributes
  const baseTokenAddr = rels?.base_token?.data?.id?.split('_')[1] || '';
  const quoteTokenAddr = rels?.quote_token?.data?.id?.split('_')[1] || '';

  const pc = a.price_change_percentage || {};
  const vol = a.volume_usd || {};
  const tx = a.transactions || {};

  return {
    poolAddress: pool.id?.split('_')[1] || pool.id || '',
    name: a.name || 'Unknown',
    dex: a.dex_id || rels?.dex?.data?.id || 'unknown',
    baseToken: {
      address: baseTokenAddr,
      symbol: ADDRESS_TO_SYMBOL[baseTokenAddr.toLowerCase()] || a.name?.split(' / ')[0] || '???',
    },
    quoteToken: {
      address: quoteTokenAddr,
      symbol: ADDRESS_TO_SYMBOL[quoteTokenAddr.toLowerCase()] || a.name?.split(' / ')[1] || '???',
    },
    priceUSD: parseFloat(a.base_token_price_usd) || 0,
    priceChange: {
      m5: parseFloat(pc.m5) || 0,
      h1: parseFloat(pc.h1) || 0,
      h6: parseFloat(pc.h6) || 0,
      h24: parseFloat(pc.h24) || 0,
    },
    volume: {
      h1: parseFloat(vol.h1) || 0,
      h6: parseFloat(vol.h6) || 0,
      h24: parseFloat(vol.h24) || 0,
    },
    transactions: {
      h1: {
        buys: tx.h1?.buys || 0,
        sells: tx.h1?.sells || 0,
        buyers: tx.h1?.buyers || 0,
        sellers: tx.h1?.sellers || 0,
      },
      h24: {
        buys: tx.h24?.buys || 0,
        sells: tx.h24?.sells || 0,
        buyers: tx.h24?.buyers || 0,
        sellers: tx.h24?.sellers || 0,
      },
    },
    liquidity: parseFloat(a.reserve_in_usd) || 0,
    fdvUSD: parseFloat(a.fdv_usd) || 0,
    poolCreatedAt: a.pool_created_at || null,
  };
}

// ============================================================================
// GECKO TERMINAL SERVICE
// ============================================================================

export class GeckoTerminalService {
  private cache: DexIntelligence | null = null;
  private cacheExpiry = 0;
  private cacheTTLMs: number;
  private fetchCount = 0;
  private errorCount = 0;

  constructor(options?: { cacheTTLSeconds?: number }) {
    // Cache for 90 seconds by default (heavy cycle runs every ~10 min)
    this.cacheTTLMs = (options?.cacheTTLSeconds ?? 90) * 1000;
  }

  // --------------------------------------------------------------------------
  // PUBLIC: Fetch full DEX intelligence snapshot
  // --------------------------------------------------------------------------

  /**
   * Fetch comprehensive DEX intelligence for the AI brain.
   * Makes 4-5 API calls, stays within 30/min rate limit.
   * Returns cached data if still fresh.
   */
  async fetchIntelligence(): Promise<DexIntelligence> {
    // Return cache if fresh
    if (this.cache && Date.now() < this.cacheExpiry) {
      return this.cache;
    }

    const errors: string[] = [];
    let trendingPools: DexPoolData[] = [];
    let topVolumePools: DexPoolData[] = [];
    let tokenMetrics: TokenDexMetrics[] = [];
    let newPools: DexPoolData[] = [];

    // --- 1. Trending pools on Base ---
    try {
      const data = await rateLimitedGet(
        `${API_BASE}/networks/${NETWORK}/trending_pools`
      );
      trendingPools = (data.data || []).map(parsePool);
    } catch (err: any) {
      errors.push(`trending_pools: ${err.message?.substring(0, 100)}`);
    }

    // --- 2. Top volume pools ---
    try {
      const data = await rateLimitedGet(
        `${API_BASE}/networks/${NETWORK}/pools?sort=h24_volume_usd_desc&page=1`
      );
      topVolumePools = (data.data || []).map(parsePool);
    } catch (err: any) {
      errors.push(`top_volume_pools: ${err.message?.substring(0, 100)}`);
    }

    // --- 3. Multi-token metrics for our portfolio ---
    try {
      // API supports up to 30 addresses per call
      const addresses = Object.values(TRACKED_TOKENS)
        .filter((v, i, a) => a.indexOf(v) === i) // dedupe
        .join('%2C');
      const data = await rateLimitedGet(
        `${API_BASE}/networks/${NETWORK}/tokens/multi/${addresses}`
      );
      tokenMetrics = (data.data || []).map((t: any) => {
        const a = t.attributes || {};
        const addr = t.id?.split('_')[1] || '';
        const topPool = a.top_pools?.[0];
        return {
          symbol: a.symbol || ADDRESS_TO_SYMBOL[addr.toLowerCase()] || '???',
          address: addr,
          priceUSD: parseFloat(a.price_usd) || 0,
          fdvUSD: parseFloat(a.fdv_usd) || 0,
          volumeH24: parseFloat(a.volume_usd?.h24) || 0,
          marketCapUSD: parseFloat(a.market_cap_usd) || 0,
          topPoolAddress: topPool?.id?.split('_')[1] || null,
          topPoolLiquidity: parseFloat(topPool?.attributes?.reserve_in_usd) || 0,
        };
      });
    } catch (err: any) {
      errors.push(`token_metrics: ${err.message?.substring(0, 100)}`);
    }

    // --- 4. New pools on Base (catch new token launches) ---
    try {
      const data = await rateLimitedGet(
        `${API_BASE}/networks/${NETWORK}/new_pools?page=1`
      );
      const allNewPools = (data.data || []).map(parsePool);
      // Filter to pools involving our tracked tokens or with meaningful liquidity
      newPools = allNewPools.filter(p => {
        const baseTracked = ADDRESS_TO_SYMBOL[p.baseToken.address.toLowerCase()];
        const quoteTracked = ADDRESS_TO_SYMBOL[p.quoteToken.address.toLowerCase()];
        return baseTracked || quoteTracked || p.liquidity > 50000;
      });
    } catch (err: any) {
      errors.push(`new_pools: ${err.message?.substring(0, 100)}`);
    }

    // --- 5. Per-token pool fetch for tokens missing from trending/top volume ---
    // Without this, most held tokens get zero flow data and flow physics is blind.
    // Rotates through 4 uncovered tokens per cycle to stay within 30/min rate limit.
    const allPoolsSoFar = [...trendingPools, ...topVolumePools];
    const coveredTokens = new Set<string>();
    for (const pool of allPoolsSoFar) {
      const baseSym = ADDRESS_TO_SYMBOL[pool.baseToken.address.toLowerCase()];
      const quoteSym = ADDRESS_TO_SYMBOL[pool.quoteToken.address.toLowerCase()];
      if (baseSym) coveredTokens.add(baseSym);
      if (quoteSym) coveredTokens.add(quoteSym);
    }

    const uncoveredTokens = Object.entries(TRACKED_TOKENS)
      .filter(([sym]) => !coveredTokens.has(sym) && sym !== 'ETH' && sym !== 'WETH' && sym !== 'USDC');

    // Rotate: pick 4 tokens per cycle based on fetch count
    const rotationOffset = (this.fetchCount * 4) % Math.max(uncoveredTokens.length, 1);
    const batchTokens = uncoveredTokens.slice(rotationOffset, rotationOffset + 4);
    // Wrap around if needed
    if (batchTokens.length < 4 && uncoveredTokens.length > 4) {
      batchTokens.push(...uncoveredTokens.slice(0, 4 - batchTokens.length));
    }

    for (const [sym, addr] of batchTokens) {
      try {
        const data = await rateLimitedGet(
          `${API_BASE}/networks/${NETWORK}/tokens/${addr}/pools?sort=h24_volume_usd_desc&page=1`
        );
        const tokenPools = (data.data || []).slice(0, 1).map(parsePool);
        allPoolsSoFar.push(...tokenPools);
      } catch (err: any) {
        errors.push(`token_pools_${sym}: ${err.message?.substring(0, 80)}`);
      }
    }

    // --- Derive signals from raw data ---
    const allPools = allPoolsSoFar;
    const volumeSpikes = this.detectVolumeSpikes(allPools);
    const buySellPressure = this.analyzeBuySellPressure(allPools);
    const aiSummary = this.buildAISummary(trendingPools, tokenMetrics, volumeSpikes, buySellPressure, newPools);

    this.fetchCount++;

    const result: DexIntelligence = {
      trendingPools: trendingPools.slice(0, 15),
      tokenMetrics,
      volumeSpikes,
      buySellPressure,
      newPools: newPools.slice(0, 10),
      aiSummary,
      timestamp: new Date().toISOString(),
      errors,
    };

    // Cache it
    this.cache = result;
    this.cacheExpiry = Date.now() + this.cacheTTLMs;

    if (errors.length > 0) {
      this.errorCount += errors.length;
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // SIGNAL DETECTION
  // --------------------------------------------------------------------------

  /**
   * Detect volume spikes: tokens where recent volume significantly exceeds average.
   */
  private detectVolumeSpikes(pools: DexPoolData[]): VolumeSpike[] {
    const spikes: VolumeSpike[] = [];
    const seen = new Set<string>();

    for (const pool of pools) {
      // Only analyze pools involving our tracked tokens
      const sym = ADDRESS_TO_SYMBOL[pool.baseToken.address.toLowerCase()]
                || ADDRESS_TO_SYMBOL[pool.quoteToken.address.toLowerCase()];
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);

      const h1Vol = pool.volume.h1;
      const h24Vol = pool.volume.h24;
      if (h24Vol < 1000) continue; // Skip dust

      // Spike ratio: if last hour volume * 24 > total 24h volume, it's spiking
      const spikeRatio = h24Vol > 0 ? (h1Vol * 24) / h24Vol : 0;

      if (spikeRatio > 1.5) { // At least 50% above average
        const h1Tx = pool.transactions.h1;
        const totalTx = h1Tx.buys + h1Tx.sells;
        const buyPressure = totalTx > 0 ? h1Tx.buys / totalTx : 0.5;

        spikes.push({
          symbol: sym,
          address: pool.baseToken.address,
          poolName: pool.name,
          h1Volume: h1Vol,
          h24Volume: h24Vol,
          spikeRatio: Math.round(spikeRatio * 100) / 100,
          buyPressure: Math.round(buyPressure * 100) / 100,
          priceChangeH1: pool.priceChange.h1,
        });
      }
    }

    // Sort by spike ratio descending
    return spikes.sort((a, b) => b.spikeRatio - a.spikeRatio).slice(0, 10);
  }

  /**
   * Analyze buy/sell pressure from transaction data across pools.
   * Aggregates across all pools for each tracked token.
   */
  private analyzeBuySellPressure(pools: DexPoolData[]): BuySellPressure[] {
    // Aggregate by token
    const agg: Record<string, {
      h1Buys: number; h1Sells: number; h1Buyers: number; h1Sellers: number;
      h24Buys: number; h24Sells: number;
    }> = {};

    for (const pool of pools) {
      let sym = ADDRESS_TO_SYMBOL[pool.baseToken.address.toLowerCase()];
      // Also check quote token — some pools list our tracked token as quote
      if (!sym) sym = ADDRESS_TO_SYMBOL[pool.quoteToken.address.toLowerCase()];
      if (!sym) continue;

      if (!agg[sym]) {
        agg[sym] = { h1Buys: 0, h1Sells: 0, h1Buyers: 0, h1Sellers: 0, h24Buys: 0, h24Sells: 0 };
      }
      agg[sym].h1Buys += pool.transactions.h1.buys;
      agg[sym].h1Sells += pool.transactions.h1.sells;
      agg[sym].h1Buyers += pool.transactions.h1.buyers;
      agg[sym].h1Sellers += pool.transactions.h1.sellers;
      agg[sym].h24Buys += pool.transactions.h24.buys;
      agg[sym].h24Sells += pool.transactions.h24.sells;
    }

    const results: BuySellPressure[] = [];
    for (const [sym, d] of Object.entries(agg)) {
      const totalH1 = d.h1Buys + d.h1Sells;
      const totalH24 = d.h24Buys + d.h24Sells;
      if (totalH1 < 5 && totalH24 < 20) continue; // Skip low-activity tokens

      const buyRatioH1 = totalH1 > 0 ? d.h1Buys / totalH1 : 0.5;
      const buyRatioH24 = totalH24 > 0 ? d.h24Buys / totalH24 : 0.5;

      let signal: BuySellPressure['signal'] = 'NEUTRAL';
      if (buyRatioH1 > 0.65 && buyRatioH24 > 0.55) signal = 'STRONG_BUY';
      else if (buyRatioH1 > 0.55) signal = 'BUY_PRESSURE';
      else if (buyRatioH1 < 0.35 && buyRatioH24 < 0.45) signal = 'STRONG_SELL';
      else if (buyRatioH1 < 0.45) signal = 'SELL_PRESSURE';

      results.push({
        symbol: sym,
        h1Buys: d.h1Buys,
        h1Sells: d.h1Sells,
        h1Buyers: d.h1Buyers,
        h1Sellers: d.h1Sellers,
        h24Buys: d.h24Buys,
        h24Sells: d.h24Sells,
        buyRatioH1: Math.round(buyRatioH1 * 100) / 100,
        buyRatioH24: Math.round(buyRatioH24 * 100) / 100,
        signal,
      });
    }

    // Sort: strongest signals first
    const signalOrder = { STRONG_BUY: 0, BUY_PRESSURE: 1, NEUTRAL: 2, SELL_PRESSURE: 3, STRONG_SELL: 4 };
    return results.sort((a, b) => signalOrder[a.signal] - signalOrder[b.signal]);
  }

  // --------------------------------------------------------------------------
  // AI SUMMARY BUILDER
  // --------------------------------------------------------------------------

  /**
   * Build a concise, AI-readable summary for the trading brain prompt.
   * This gets injected into the Claude system prompt during heavy cycles.
   */
  private buildAISummary(
    trending: DexPoolData[],
    tokens: TokenDexMetrics[],
    spikes: VolumeSpike[],
    pressure: BuySellPressure[],
    newPools: DexPoolData[],
  ): string {
    const lines: string[] = [];
    lines.push('=== DEX INTELLIGENCE (GeckoTerminal — Base) ===');

    // Trending tokens on Base
    if (trending.length > 0) {
      lines.push('\n📈 TRENDING ON BASE DEX:');
      for (const p of trending.slice(0, 8)) {
        const trackedBase = ADDRESS_TO_SYMBOL[p.baseToken.address.toLowerCase()];
        const tag = trackedBase ? ` [TRACKED: ${trackedBase}]` : '';
        lines.push(`  ${p.name}: $${p.priceUSD.toFixed(6)} | h1: ${p.priceChange.h1 > 0 ? '+' : ''}${p.priceChange.h1.toFixed(1)}% | vol24h: $${(p.volume.h24/1000).toFixed(0)}K | liq: $${(p.liquidity/1000).toFixed(0)}K${tag}`);
      }
    }

    // Portfolio token metrics
    if (tokens.length > 0) {
      lines.push('\n📊 OUR TOKEN DEX METRICS:');
      const sorted = [...tokens].sort((a, b) => b.volumeH24 - a.volumeH24);
      for (const t of sorted.slice(0, 12)) {
        if (t.symbol === 'USDC' || t.symbol === 'WETH') continue;
        const vol = t.volumeH24 > 1e6 ? `$${(t.volumeH24/1e6).toFixed(1)}M` : `$${(t.volumeH24/1000).toFixed(0)}K`;
        const mcap = t.marketCapUSD > 1e6 ? `$${(t.marketCapUSD/1e6).toFixed(0)}M` : `$${(t.marketCapUSD/1000).toFixed(0)}K`;
        lines.push(`  ${t.symbol}: $${t.priceUSD.toPrecision(4)} | vol24h: ${vol} | mcap: ${mcap}`);
      }
    }

    // Volume spikes — most actionable signal
    if (spikes.length > 0) {
      lines.push('\n🚨 VOLUME SPIKES (unusual activity):');
      for (const s of spikes.slice(0, 5)) {
        const direction = s.buyPressure > 0.55 ? '🟢 BUY-heavy' : s.buyPressure < 0.45 ? '🔴 SELL-heavy' : '⚪ balanced';
        lines.push(`  ${s.symbol}: ${s.spikeRatio.toFixed(1)}x normal volume | ${direction} (${(s.buyPressure*100).toFixed(0)}% buys) | h1: ${s.priceChangeH1 > 0 ? '+' : ''}${s.priceChangeH1.toFixed(1)}%`);
      }
    }

    // Buy/sell pressure signals
    const actionablePressure = pressure.filter(p => p.signal !== 'NEUTRAL');
    if (actionablePressure.length > 0) {
      lines.push('\n💎 BUY/SELL PRESSURE:');
      for (const p of actionablePressure.slice(0, 8)) {
        const emoji = p.signal.includes('BUY') ? '🟢' : '🔴';
        lines.push(`  ${emoji} ${p.symbol}: ${p.signal} | h1: ${p.h1Buys}B/${p.h1Sells}S (${(p.buyRatioH1*100).toFixed(0)}% buys) | h24: ${p.h24Buys}B/${p.h24Sells}S`);
      }
    }

    // New pools involving tracked tokens
    const trackedNewPools = newPools.filter(p =>
      ADDRESS_TO_SYMBOL[p.baseToken.address.toLowerCase()] ||
      ADDRESS_TO_SYMBOL[p.quoteToken.address.toLowerCase()]
    );
    if (trackedNewPools.length > 0) {
      lines.push('\n🆕 NEW POOLS (tracked tokens):');
      for (const p of trackedNewPools.slice(0, 3)) {
        lines.push(`  ${p.name} on ${p.dex} | liq: $${(p.liquidity/1000).toFixed(0)}K | created: ${p.poolCreatedAt || '?'}`);
      }
    }

    return lines.join('\n');
  }

  // --------------------------------------------------------------------------
  // INDIVIDUAL QUERIES
  // --------------------------------------------------------------------------

  /**
   * Fetch DEX data for a single token by address.
   * Used for on-demand lookups (e.g., before placing a trade).
   */
  async getTokenMetrics(tokenAddress: string): Promise<TokenDexMetrics | null> {
    try {
      const data = await rateLimitedGet(
        `${API_BASE}/networks/${NETWORK}/tokens/${tokenAddress}`
      );
      const a = data.data?.attributes;
      if (!a) return null;

      return {
        symbol: a.symbol || '???',
        address: tokenAddress,
        priceUSD: parseFloat(a.price_usd) || 0,
        fdvUSD: parseFloat(a.fdv_usd) || 0,
        volumeH24: parseFloat(a.volume_usd?.h24) || 0,
        marketCapUSD: parseFloat(a.market_cap_usd) || 0,
        topPoolAddress: a.top_pools?.[0]?.id?.split('_')[1] || null,
        topPoolLiquidity: parseFloat(a.top_pools?.[0]?.attributes?.reserve_in_usd) || 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get the top pools for a specific token (sorted by volume).
   */
  async getTokenPools(tokenAddress: string, limit = 5): Promise<DexPoolData[]> {
    try {
      const data = await rateLimitedGet(
        `${API_BASE}/networks/${NETWORK}/tokens/${tokenAddress}/pools?sort=h24_volume_usd_desc&page=1`
      );
      return (data.data || []).slice(0, limit).map(parsePool);
    } catch {
      return [];
    }
  }

  // --------------------------------------------------------------------------
  // STATS / JSON
  // --------------------------------------------------------------------------

  getStats() {
    return {
      fetchCount: this.fetchCount,
      errorCount: this.errorCount,
      cacheAge: this.cache ? Date.now() - (this.cacheExpiry - this.cacheTTLMs) : null,
      cachedTimestamp: this.cache?.timestamp || null,
      trackedTokens: Object.keys(TRACKED_TOKENS).length,
    };
  }

  invalidateCache(): void {
    this.cache = null;
    this.cacheExpiry = 0;
  }

  toJSON() {
    return {
      ...this.getStats(),
      latestIntelligence: this.cache ? {
        trendingCount: this.cache.trendingPools.length,
        tokenMetricsCount: this.cache.tokenMetrics.length,
        volumeSpikes: this.cache.volumeSpikes.length,
        pressureSignals: this.cache.buySellPressure.filter(p => p.signal !== 'NEUTRAL').length,
        newPoolsCount: this.cache.newPools.length,
        errors: this.cache.errors,
        timestamp: this.cache.timestamp,
      } : null,
    };
  }
}

// Singleton
export const geckoTerminalService = new GeckoTerminalService();
