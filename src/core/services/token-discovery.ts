/**
 * Token Discovery Service — v6.1
 *
 * Dynamically discovers and ranks tradeable tokens on Base chain.
 * Uses DexScreener API (free, no auth) to find high-liquidity tokens.
 * Filters by minimum liquidity, volume, and age to avoid rugs.
 *
 * Runs on a configurable schedule (default: every 6 hours).
 * Results are cached and merged with the static TOKEN_REGISTRY.
 */

import axios from "axios";
import { activeChain } from "../config/chain-config.js";

// ============================================================================
// ON-CHAIN TOKEN DECIMALS FETCHER
// ============================================================================

const BASE_RPC = activeChain.rpcEndpoints[activeChain.rpcEndpoints.length - 1]; // v21.3: use public RPC from chain config

/**
 * Fetch token decimals from on-chain ERC-20 contract.
 * Returns null on failure (caller should use fallback).
 */
async function fetchTokenDecimals(tokenAddress: string): Promise<number | null> {
  try {
    // ERC-20 decimals() selector = 0x313ce567
    const response = await axios.post(BASE_RPC, {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: tokenAddress, data: "0x313ce567" }, "latest"],
    }, { timeout: 5000 });

    const result = response.data?.result;
    if (!result || result === "0x" || result === "0x0") return null;

    const decimals = parseInt(result, 16);
    if (isNaN(decimals) || decimals < 0 || decimals > 18) return null;

    return decimals;
  } catch {
    return null; // Fallback to default
  }
}

// ============================================================================
// CONFIGURATION
// ============================================================================

export const TOKEN_DISCOVERY_CONFIG = {
  /** How often to run a FULL scan for new tokens (ms) */
  scanIntervalMs: 2 * 60 * 60 * 1000, // 2 hours (was 6h)

  /** How often to run a QUICK momentum scan (ms) — catches fast movers */
  momentumScanIntervalMs: 15 * 60 * 1000, // 15 minutes

  /** Minimum USD liquidity in the pool to consider */
  minLiquidityUSD: 25_000, // Lowered from 50K — more aggressive discovery

  /** Minimum 24h volume to consider */
  minVolume24hUSD: 10_000,

  /** Minimum age of the token pair (hours) — avoid brand-new launches */
  minPairAgeHours: 48, // Lowered from 72h — catch newer tokens faster

  /** Maximum number of discovered tokens to track */
  maxDiscoveredTokens: 75, // Increased from 30 — wider net

  /** Sectors to scan (DexScreener doesn't have sectors, we classify ourselves) */
  baseDexScreenerUrl: "https://api.dexscreener.com/latest/dex",

  /** CoinGecko Base ecosystem tokens endpoint */
  coingeckoBaseUrl: "https://api.coingecko.com/api/v3",

  /** Tokens to always exclude (stablecoins, wrapped versions, known scams) */
  excludeSymbols: new Set([
    "USDC", "USDT", "DAI", "USDbC", "WETH", "WBTC", // stablecoins & wrapped
    "cbETH", "cbBTC", "ETH", // already in Blue Chip static pool
  ]),

  /** Known token addresses to exclude (known scams, honeypots) */
  excludeAddresses: new Set<string>([]),

  /** Minimum FDV (fully diluted valuation) to filter out micro-caps */
  minFdvUSD: 1_000_000,

  /** Minimum number of transactions in 24h */
  minTxns24h: 100,
};

// ============================================================================
// TYPES
// ============================================================================

export interface DiscoveredToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  /** CoinGecko ID if we can resolve it, empty string if not */
  coingeckoId: string;
  /** Suggested sector based on name/category heuristics */
  sector: "AI_TOKENS" | "MEME_COINS" | "DEFI" | "BLUE_CHIP" | "GAMING" | "SOCIAL" | "OTHER";
  /** Risk level based on liquidity + age */
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  /** USD liquidity in the deepest pool */
  liquidityUSD: number;
  /** 24h trading volume */
  volume24hUSD: number;
  /** Price in USD */
  priceUSD: number;
  /** Fully diluted valuation */
  fdvUSD: number;
  /** 24h price change percent */
  priceChange24h: number;
  /** Number of transactions in 24h */
  txns24h: number;
  /** When this token was first discovered by our scanner */
  discoveredAt: string;
  /** When the pool was created */
  pairCreatedAt: string;
  /** The DEX this token trades on (Aerodrome, Uniswap, etc.) */
  dexName: string;
  /** Pool address for the most liquid pair */
  pairAddress: string;
  /** Minimum trade in USD (derived from liquidity) */
  minTradeUSD: number;
}

export interface TokenDiscoveryState {
  lastScanTime: string | null;
  discoveredTokens: DiscoveredToken[];
  totalScans: number;
  tokensAdded: number;
  tokensRemoved: number;
  lastError: string | null;
}

// ============================================================================
// SECTOR CLASSIFICATION HEURISTICS
// ============================================================================

const AI_KEYWORDS = ["ai", "agent", "virtual", "gpt", "neural", "brain", "cognitive", "machine", "model", "intelligence"];
const MEME_KEYWORDS = ["doge", "pepe", "shib", "moon", "elon", "cat", "dog", "frog", "chad", "wojak", "normie", "degen", "based", "ape", "mog", "bonk"];
const DEFI_KEYWORDS = ["swap", "lend", "yield", "vault", "stake", "liquid", "aero", "finance", "protocol", "pool", "farm"];
const GAMING_KEYWORDS = ["game", "play", "nft", "metaverse", "world", "quest", "guild"];
const SOCIAL_KEYWORDS = ["social", "friend", "lens", "farcaster", "cast", "channel"];

function classifySector(symbol: string, name: string): DiscoveredToken["sector"] {
  const text = `${symbol} ${name}`.toLowerCase();
  if (AI_KEYWORDS.some(k => text.includes(k))) return "AI_TOKENS";
  if (MEME_KEYWORDS.some(k => text.includes(k))) return "MEME_COINS";
  if (DEFI_KEYWORDS.some(k => text.includes(k))) return "DEFI";
  if (GAMING_KEYWORDS.some(k => text.includes(k))) return "GAMING";
  if (SOCIAL_KEYWORDS.some(k => text.includes(k))) return "SOCIAL";
  return "OTHER";
}

function classifyRisk(liquidityUSD: number, ageHours: number, fdvUSD: number): DiscoveredToken["riskLevel"] {
  if (liquidityUSD > 500_000 && ageHours > 720 && fdvUSD > 50_000_000) return "LOW";
  if (liquidityUSD > 100_000 && ageHours > 168 && fdvUSD > 5_000_000) return "MEDIUM";
  return "HIGH";
}

// ============================================================================
// DEXSCREENER API — Primary Discovery Source
// ============================================================================

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
  };
  priceChange: {
    h24: number;
  };
  liquidity: {
    usd: number;
  };
  fdv: number;
  pairCreatedAt: number;
}

/**
 * Scan DexScreener for top Base chain tokens by volume & liquidity.
 * Uses the /search endpoint which returns tokens across all chains,
 * then filters to Base only.
 */
async function scanDexScreener(): Promise<DiscoveredToken[]> {
  const discovered: DiscoveredToken[] = [];
  const cfg = TOKEN_DISCOVERY_CONFIG;
  const chainId = activeChain.dexScreenerChainId;
  const geckoNetwork = activeChain.geckoTerminalNetwork;

  try {
    console.log(`  🔍 Token Discovery: Scanning GeckoTerminal + DexScreener for ${chainId}...`);

    // PRIMARY SOURCE: GeckoTerminal trending pools — returns real tokens by volume
    const basePairs: DexScreenerPair[] = [];
    const seenAddresses = new Set<string>();

    for (const page of [1, 2, 3]) {
      try {
        const gtUrl = `https://api.geckoterminal.com/api/v2/networks/${geckoNetwork}/trending_pools?page=${page}`;
        const gtRes = await axios.get(gtUrl, { timeout: 10000 });
        const pools = gtRes.data?.data || [];

        for (const pool of pools) {
          const attrs = pool.attributes || {};
          const name = attrs.name || '';
          const parts = name.split(' / ');
          const symbol = parts[0]?.trim() || '';
          const address = pool.relationships?.base_token?.data?.id?.split('_')[1] || '';

          if (!address || !symbol) continue;
          if (seenAddresses.has(address.toLowerCase())) continue;
          seenAddresses.add(address.toLowerCase());

          // Convert GeckoTerminal format to DexScreenerPair shape
          const vol24h = parseFloat(attrs.volume_usd?.h24 || '0');
          const liq = parseFloat(attrs.reserve_in_usd || '0');
          const txBuys = attrs.transactions?.h24?.buys || 0;
          const txSells = attrs.transactions?.h24?.sells || 0;

          basePairs.push({
            chainId,
            dexId: attrs.dex_id || 'unknown',
            url: '',
            pairAddress: pool.attributes?.address || '',
            baseToken: { address, name: symbol, symbol },
            quoteToken: { address: '', name: '', symbol: '' },
            priceNative: '0',
            priceUsd: attrs.base_token_price_usd || '0',
            txns: { h24: { buys: txBuys, sells: txSells } },
            volume: { h24: vol24h },
            priceChange: { h24: parseFloat(attrs.price_change_percentage?.h24 || '0') },
            liquidity: { usd: liq },
            fdv: parseFloat(attrs.fdv_usd || '0'),
            pairCreatedAt: attrs.pool_created_at ? new Date(attrs.pool_created_at).getTime() : 0,
          });
        }
      } catch { /* skip page failures */ }
    }

    // SECONDARY: DexScreener boosted tokens (already existed)
    console.log(`  📊 GeckoTerminal found ${basePairs.length} unique ${chainId} tokens`);

    // Also try the top boosted tokens endpoint
    let boostedPairs: DexScreenerPair[] = [];
    try {
      const boostedResponse = await axios.get(
        "https://api.dexscreener.com/token-boosts/top/v1",
        { timeout: 10000 }
      );
      if (Array.isArray(boostedResponse.data)) {
        const baseBoosted = boostedResponse.data
          .filter((t: any) => t.chainId === activeChain.dexScreenerChainId)
          .map((t: any) => t.tokenAddress);
        // Fetch pair data for boosted tokens
        for (const addr of baseBoosted.slice(0, 10)) {
          try {
            const pairRes = await axios.get(
              `${cfg.baseDexScreenerUrl}/tokens/${addr}`,
              { timeout: 10000 }
            );
            const tokenPairs = (pairRes.data?.pairs || []).filter((p: DexScreenerPair) => p.chainId === activeChain.dexScreenerChainId);
            boostedPairs.push(...tokenPairs);
          } catch { /* skip */ }
        }
      }
    } catch { /* boosted endpoint optional */ }

    // Merge boosted pairs into the main deduplicated pool
    for (const bp of boostedPairs) {
      const addr = bp.baseToken.address.toLowerCase();
      if (!seenAddresses.has(addr)) {
        seenAddresses.add(addr);
        basePairs.push(bp);
      }
    }

    for (const pair of basePairs) {
      const token = pair.baseToken;
      const address = token.address.toLowerCase();

      // Skip if already seen
      if (seenAddresses.has(address)) continue;
      seenAddresses.add(address);

      // Skip excluded tokens
      if (cfg.excludeSymbols.has(token.symbol.toUpperCase())) continue;
      if (cfg.excludeAddresses.has(address)) continue;

      // Filter by liquidity
      const liquidity = pair.liquidity?.usd || 0;
      if (liquidity < cfg.minLiquidityUSD) continue;

      // Filter by volume
      const volume = pair.volume?.h24 || 0;
      if (volume < cfg.minVolume24hUSD) continue;

      // Filter by FDV
      const fdv = pair.fdv || 0;
      if (fdv < cfg.minFdvUSD) continue;

      // Filter by transactions
      const txns = (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);
      if (txns < cfg.minTxns24h) continue;

      // Filter by pair age
      const pairAge = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60) : 0;
      if (pairAge < cfg.minPairAgeHours) continue;

      const sector = classifySector(token.symbol, token.name);
      const riskLevel = classifyRisk(liquidity, pairAge, fdv);

      discovered.push({
        address: token.address, // Keep original checksum
        symbol: token.symbol.toUpperCase(),
        name: token.name,
        decimals: 18, // Placeholder — batch-resolved below
        coingeckoId: "", // Will be resolved separately
        sector,
        riskLevel,
        liquidityUSD: liquidity,
        volume24hUSD: volume,
        priceUSD: parseFloat(pair.priceUsd || "0"),
        fdvUSD: fdv,
        priceChange24h: pair.priceChange?.h24 || 0,
        txns24h: txns,
        discoveredAt: new Date().toISOString(),
        pairCreatedAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : "",
        dexName: pair.dexId || "unknown",
        pairAddress: pair.pairAddress,
        minTradeUSD: liquidity > 200_000 ? 5 : 3,
      });
    }

    // Batch-fetch decimals in parallel instead of serial awaits
    const decimalResults = await Promise.all(
      discovered.map(t => fetchTokenDecimals(t.address).catch(() => null))
    );
    for (let i = 0; i < discovered.length; i++) {
      discovered[i].decimals = decimalResults[i] ?? 18;
    }

    // Sort by volume (highest first) and cap
    discovered.sort((a, b) => b.volume24hUSD - a.volume24hUSD);
    return discovered.slice(0, cfg.maxDiscoveredTokens);

  } catch (error: any) {
    console.error(`  ❌ DexScreener scan failed:`, error.message);
    return [];
  }
}

/**
 * Quick momentum scan — uses DexScreener's token-boosts and gainers
 * to catch fast-moving tokens between full scans. Runs every 15 minutes.
 * Only returns tokens that meet minimum safety thresholds.
 */
async function scanMomentum(): Promise<DiscoveredToken[]> {
  const discovered: DiscoveredToken[] = [];
  const cfg = TOKEN_DISCOVERY_CONFIG;
  const chainId = activeChain.dexScreenerChainId;

  try {
    console.log(`  ⚡ Momentum scan: checking gainers & boosted tokens...`);

    // 1. Fetch boosted tokens (DexScreener promoted — high visibility)
    const endpoints = [
      { url: "https://api.dexscreener.com/token-boosts/top/v1", label: "boosted" },
    ];

    const tokenAddresses: string[] = [];

    for (const ep of endpoints) {
      try {
        const res = await axios.get(ep.url, { timeout: 10000 });
        if (Array.isArray(res.data)) {
          const chainTokens = res.data
            .filter((t: any) => t.chainId === chainId)
            .map((t: any) => t.tokenAddress)
            .filter(Boolean);
          tokenAddresses.push(...chainTokens);
        }
      } catch { /* endpoint optional */ }
    }

    // 2. Deduplicate and fetch pair data
    const uniqueAddresses = [...new Set(tokenAddresses)].slice(0, 30);

    for (const addr of uniqueAddresses) {
      try {
        const pairRes = await axios.get(
          `${cfg.baseDexScreenerUrl}/tokens/${addr}`,
          { timeout: 8000 }
        );
        const pairs = (pairRes.data?.pairs || [])
          .filter((p: DexScreenerPair) => p.chainId === chainId)
          .sort((a: DexScreenerPair, b: DexScreenerPair) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));

        const bestPair = pairs[0];
        if (!bestPair) continue;

        const token = bestPair.baseToken;
        const address = token.address.toLowerCase();
        const liquidity = bestPair.liquidity?.usd || 0;
        const volume = bestPair.volume?.h24 || 0;
        const fdv = bestPair.fdv || 0;
        const txns = (bestPair.txns?.h24?.buys || 0) + (bestPair.txns?.h24?.sells || 0);
        const priceChange = bestPair.priceChange?.h24 || 0;
        const pairAge = bestPair.pairCreatedAt ? (Date.now() - bestPair.pairCreatedAt) / (1000 * 60 * 60) : 0;

        // Safety filters (more lenient than full scan for momentum plays)
        if (cfg.excludeSymbols.has(token.symbol.toUpperCase())) continue;
        if (liquidity < 25_000) continue;   // Min $25K liquidity
        if (volume < 50_000) continue;       // Min $50K volume for momentum
        if (pairAge < 24) continue;          // At least 24h old
        if (txns < 50) continue;             // Some organic activity

        discovered.push({
          address: token.address,
          symbol: token.symbol.toUpperCase(),
          name: token.name,
          decimals: 18,
          coingeckoId: "",
          sector: classifySector(token.symbol, token.name),
          riskLevel: classifyRisk(liquidity, pairAge, fdv),
          liquidityUSD: liquidity,
          volume24hUSD: volume,
          priceUSD: parseFloat(bestPair.priceUsd || "0"),
          fdvUSD: fdv,
          priceChange24h: priceChange,
          txns24h: txns,
          discoveredAt: new Date().toISOString(),
          pairCreatedAt: bestPair.pairCreatedAt ? new Date(bestPair.pairCreatedAt).toISOString() : "",
          dexName: bestPair.dexId || "unknown",
          pairAddress: bestPair.pairAddress,
          minTradeUSD: liquidity > 200_000 ? 5 : 3,
        });
      } catch { /* skip individual token failures */ }
    }

    console.log(`  ⚡ Momentum scan found ${discovered.length} candidates`);
    return discovered;

  } catch (error: any) {
    console.warn(`  ⚠️ Momentum scan failed (non-critical):`, error.message);
    return [];
  }
}

/**
 * Resolve CoinGecko IDs for discovered tokens.
 * This enables price feeds and technical analysis.
 */
async function resolveCoinGeckoIds(tokens: DiscoveredToken[]): Promise<void> {
  try {
    // Use CoinGecko's Base token list
    const response = await axios.get(
      `${TOKEN_DISCOVERY_CONFIG.coingeckoBaseUrl}/coins/list?include_platform=true`,
      { timeout: 20000 }
    );

    const coinList = response.data || [];

    // Build address → coingecko ID map for Base tokens
    const addressMap = new Map<string, string>();
    for (const coin of coinList) {
      const baseAddress = coin.platforms?.base || coin.platforms?.["base"];
      if (baseAddress) {
        addressMap.set(baseAddress.toLowerCase(), coin.id);
      }
    }

    // Match discovered tokens
    let matched = 0;
    for (const token of tokens) {
      const id = addressMap.get(token.address.toLowerCase());
      if (id) {
        token.coingeckoId = id;
        matched++;
      }
    }
    console.log(`  🔗 Resolved CoinGecko IDs for ${matched}/${tokens.length} tokens`);

  } catch (error: any) {
    console.warn(`  ⚠️ CoinGecko ID resolution failed (non-critical):`, error.message);
  }
}

// ============================================================================
// TOKEN DISCOVERY ENGINE — Main Export
// ============================================================================

export class TokenDiscoveryEngine {
  private state: TokenDiscoveryState;
  private scanTimer: NodeJS.Timeout | null = null;
  private momentumTimer: NodeJS.Timeout | null = null;
  /** Static tokens that should never be removed by discovery */
  private staticSymbols: Set<string>;

  constructor(staticTokenSymbols: string[]) {
    this.staticSymbols = new Set(staticTokenSymbols.map(s => s.toUpperCase()));
    this.state = {
      lastScanTime: null,
      discoveredTokens: [],
      totalScans: 0,
      tokensAdded: 0,
      tokensRemoved: 0,
      lastError: null,
    };
  }

  /** Start periodic scanning — full scan + fast momentum scan */
  start(): void {
    const fullHours = TOKEN_DISCOVERY_CONFIG.scanIntervalMs / 3600000;
    const momentumMin = TOKEN_DISCOVERY_CONFIG.momentumScanIntervalMs / 60000;
    console.log(`  🔍 Token Discovery Engine started (full scan: ${fullHours}h, momentum: ${momentumMin}m)`);

    // Run initial full scan after 30 seconds (let the bot boot first)
    // Wrapped in try/catch to prevent unhandled promise rejection from crashing the process
    setTimeout(() => {
      this.runScan().then(results => {
        if (results.length === 0) {
          console.log(`  🔍 Initial scan found 0 tokens — retrying in 2 minutes...`);
          setTimeout(() => this.runScan().catch(e => console.warn('  ⚠️ Retry scan failed:', (e as Error).message)), 120_000);
        }
      }).catch(err => {
        console.warn(`  ⚠️ Initial discovery scan failed (non-fatal):`, (err as Error).message);
      });
    }, 30_000);

    // Full scan on schedule
    this.scanTimer = setInterval(
      () => this.runScan(),
      TOKEN_DISCOVERY_CONFIG.scanIntervalMs
    );

    // Fast momentum scan every 15 minutes (starts after first full scan)
    setTimeout(() => {
      this.momentumTimer = setInterval(
        () => this.runMomentumScan(),
        TOKEN_DISCOVERY_CONFIG.momentumScanIntervalMs
      );
    }, 60_000); // Start momentum scans after 1 minute
  }

  /** Stop scanning */
  stop(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.momentumTimer) {
      clearInterval(this.momentumTimer);
      this.momentumTimer = null;
    }
  }

  /** Run a fast momentum scan — merges new finds into existing pool */
  async runMomentumScan(): Promise<void> {
    try {
      const momentum = await scanMomentum();
      if (momentum.length === 0) return;

      // Merge momentum finds into existing discovered tokens
      const existingAddresses = new Set(
        this.state.discoveredTokens.map(t => t.address.toLowerCase())
      );

      let newFinds = 0;
      for (const token of momentum) {
        if (this.staticSymbols.has(token.symbol.toUpperCase())) continue;
        if (existingAddresses.has(token.address.toLowerCase())) {
          // Update existing token's price/volume data
          const existing = this.state.discoveredTokens.find(
            t => t.address.toLowerCase() === token.address.toLowerCase()
          );
          if (existing) {
            existing.priceUSD = token.priceUSD;
            existing.volume24hUSD = token.volume24hUSD;
            existing.priceChange24h = token.priceChange24h;
            existing.txns24h = token.txns24h;
            existing.liquidityUSD = token.liquidityUSD;
          }
          continue;
        }

        // New token found by momentum scan
        this.state.discoveredTokens.push(token);
        existingAddresses.add(token.address.toLowerCase());
        newFinds++;
      }

      if (newFinds > 0) {
        console.log(`  ⚡ Momentum scan added ${newFinds} new tokens (pool: ${this.state.discoveredTokens.length})`);
        this.state.tokensAdded += newFinds;

        // Cap the pool — remove lowest volume tokens if over limit
        if (this.state.discoveredTokens.length > TOKEN_DISCOVERY_CONFIG.maxDiscoveredTokens) {
          this.state.discoveredTokens.sort((a, b) => b.volume24hUSD - a.volume24hUSD);
          const removed = this.state.discoveredTokens.length - TOKEN_DISCOVERY_CONFIG.maxDiscoveredTokens;
          this.state.discoveredTokens = this.state.discoveredTokens.slice(0, TOKEN_DISCOVERY_CONFIG.maxDiscoveredTokens);
          this.state.tokensRemoved += removed;
        }
      }
    } catch (error: any) {
      console.warn(`  ⚠️ Momentum scan error:`, error.message);
    }
  }

  /** Run a full discovery scan */
  async runScan(): Promise<DiscoveredToken[]> {
    console.log(`\n🔍 TOKEN DISCOVERY SCAN #${this.state.totalScans + 1}`);
    console.log(`   Scanning Base chain for high-liquidity tradeable tokens...`);

    try {
      // Scan DexScreener
      const discovered = await scanDexScreener();

      // Filter out tokens that are already in the static registry
      const newTokens = discovered.filter(t => !this.staticSymbols.has(t.symbol.toUpperCase()));

      // Resolve CoinGecko IDs (rate-limited, so only run occasionally)
      if (this.state.totalScans % 4 === 0) { // Every 4th scan (~24h)
        await resolveCoinGeckoIds(newTokens);
      } else {
        // Carry over existing CoinGecko IDs from previous scan
        for (const token of newTokens) {
          const existing = this.state.discoveredTokens.find(
            t => t.address.toLowerCase() === token.address.toLowerCase()
          );
          if (existing?.coingeckoId) {
            token.coingeckoId = existing.coingeckoId;
          }
        }
      }

      // Track changes
      const previousSymbols = new Set(this.state.discoveredTokens.map(t => t.symbol));
      const newSymbols = new Set(newTokens.map(t => t.symbol));
      const added = [...newSymbols].filter(s => !previousSymbols.has(s));
      const removed = [...previousSymbols].filter(s => !newSymbols.has(s));

      if (added.length > 0) {
        console.log(`   ✅ New tokens discovered: ${added.join(", ")}`);
        this.state.tokensAdded += added.length;
      }
      if (removed.length > 0) {
        console.log(`   🗑️  Tokens dropped (low liquidity/volume): ${removed.join(", ")}`);
        this.state.tokensRemoved += removed.length;
      }

      this.state.discoveredTokens = newTokens;
      this.state.lastScanTime = new Date().toISOString();
      this.state.totalScans++;
      this.state.lastError = null;

      console.log(`   📊 Discovery pool: ${newTokens.length} tokens | Top by volume:`);
      for (const t of newTokens.slice(0, 5)) {
        console.log(`      ${t.symbol}: $${(t.volume24hUSD / 1000).toFixed(0)}K vol | $${(t.liquidityUSD / 1000).toFixed(0)}K liq | ${t.sector}`);
      }

      return newTokens;

    } catch (error: any) {
      this.state.lastError = error.message;
      console.error(`   ❌ Discovery scan failed:`, error.message);
      return this.state.discoveredTokens; // Return previous results on failure
    }
  }

  /** Get all discovered tokens */
  getDiscoveredTokens(): DiscoveredToken[] {
    return this.state.discoveredTokens;
  }

  /** Get tokens suitable for adding to the trading registry */
  getTradableTokens(): DiscoveredToken[] {
    return this.state.discoveredTokens.filter(t =>
      t.liquidityUSD >= TOKEN_DISCOVERY_CONFIG.minLiquidityUSD &&
      t.volume24hUSD >= TOKEN_DISCOVERY_CONFIG.minVolume24hUSD
    );
  }

  /**
   * v6.2: Get top opportunities — curated shortlist for AI prompt & validation gate.
   * Uses composite scoring to surface the best 5 tokens, with runner detection
   * to ensure explosive movers always make the cut.
   *
   * Scoring weights:
   *  - Volume momentum (40%): normalized 24h volume vs discovery pool median
   *  - Liquidity depth (20%): deeper pools = safer execution
   *  - Price action (25%): 24h price change magnitude (runners get boosted)
   *  - Transaction density (15%): more txns = more organic interest
   *
   * Runner override: any token with 50%+ price change AND $100K+ volume
   * forces into top 5 regardless of composite score.
   */
  getTopOpportunities(maxCount: number = 5): (DiscoveredToken & { compositeScore: number; isRunner: boolean })[] {
    const tradeable = this.getTradableTokens();
    if (tradeable.length === 0) return [];

    // Calculate normalization baselines
    const volumes = tradeable.map(t => t.volume24hUSD);
    const liquidities = tradeable.map(t => t.liquidityUSD);
    const txns = tradeable.map(t => t.txns24h);
    const medianVolume = volumes.sort((a, b) => a - b)[Math.floor(volumes.length / 2)] || 1;
    const maxLiquidity = Math.max(...liquidities) || 1;
    const maxTxns = Math.max(...txns) || 1;

    // Score each token
    const scored = tradeable.map(t => {
      // Volume momentum — how much above median (capped at 5x)
      const volumeScore = Math.min(t.volume24hUSD / medianVolume, 5) / 5;

      // Liquidity depth — normalized to pool max
      const liquidityScore = Math.min(t.liquidityUSD / maxLiquidity, 1);

      // Price action — absolute magnitude matters (both pumps and dips are signals)
      // But positive action weighted 2x over negative (we want runners, not dumps)
      const absChange = Math.abs(t.priceChange24h);
      const priceScore = t.priceChange24h > 0
        ? Math.min(absChange / 100, 1) // 100%+ move = max score
        : Math.min(absChange / 200, 0.5); // Negative moves score lower

      // Transaction density — organic interest signal
      const txnScore = Math.min(t.txns24h / maxTxns, 1);

      // Weighted composite
      const compositeScore = (
        volumeScore * 0.40 +
        liquidityScore * 0.20 +
        priceScore * 0.25 +
        txnScore * 0.15
      ) * 100;

      // Runner detection: 50%+ gain with meaningful volume = forced inclusion
      const isRunner = t.priceChange24h >= 50 && t.volume24hUSD >= 100_000;

      return { ...t, compositeScore: Math.round(compositeScore * 10) / 10, isRunner };
    });

    // Separate runners from regular tokens
    const runners = scored.filter(t => t.isRunner).sort((a, b) => b.priceChange24h - a.priceChange24h);
    const regular = scored.filter(t => !t.isRunner).sort((a, b) => b.compositeScore - a.compositeScore);

    // Runners get priority slots, remaining filled by top composite scores
    const result: typeof scored = [];
    for (const runner of runners.slice(0, maxCount)) {
      result.push(runner);
    }
    for (const token of regular) {
      if (result.length >= maxCount) break;
      if (!result.find(r => r.symbol === token.symbol)) {
        result.push(token);
      }
    }

    return result.slice(0, maxCount);
  }

  /** Get the full discovery state (for API/dashboard) */
  getState(): TokenDiscoveryState {
    return { ...this.state };
  }

  /** Get a specific token by address */
  getToken(address: string): DiscoveredToken | undefined {
    return this.state.discoveredTokens.find(
      t => t.address.toLowerCase() === address.toLowerCase()
    );
  }

  /** Get tokens by sector */
  getTokensBySector(sector: DiscoveredToken["sector"]): DiscoveredToken[] {
    return this.state.discoveredTokens.filter(t => t.sector === sector);
  }

  /** Export discovered tokens in TOKEN_REGISTRY format for the agent */
  toRegistryFormat(): Record<string, {
    address: string;
    symbol: string;
    name: string;
    coingeckoId: string;
    sector: string;
    riskLevel: string;
    minTradeUSD: number;
    decimals: number;
    discovered: boolean;
  }> {
    const registry: Record<string, any> = {};
    for (const token of this.getTradableTokens()) {
      registry[token.symbol] = {
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        coingeckoId: token.coingeckoId,
        sector: token.sector,
        riskLevel: token.riskLevel,
        minTradeUSD: token.minTradeUSD,
        decimals: token.decimals,
        discovered: true, // Flag so we know this came from discovery, not static
      };
    }
    return registry;
  }

  /** Restore state from persisted data */
  restoreState(saved: Partial<TokenDiscoveryState>): void {
    if (saved.discoveredTokens) this.state.discoveredTokens = saved.discoveredTokens;
    if (saved.lastScanTime) this.state.lastScanTime = saved.lastScanTime;
    if (saved.totalScans) this.state.totalScans = saved.totalScans;
    if (saved.tokensAdded) this.state.tokensAdded = saved.tokensAdded;
    if (saved.tokensRemoved) this.state.tokensRemoved = saved.tokensRemoved;
    console.log(`  🔍 Restored ${this.state.discoveredTokens.length} discovered tokens from previous session`);
  }
}
