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

// ============================================================================
// CONFIGURATION
// ============================================================================

export const TOKEN_DISCOVERY_CONFIG = {
  /** How often to scan for new tokens (ms) */
  scanIntervalMs: 6 * 60 * 60 * 1000, // 6 hours

  /** Minimum USD liquidity in the pool to consider */
  minLiquidityUSD: 50_000,

  /** Minimum 24h volume to consider */
  minVolume24hUSD: 10_000,

  /** Minimum age of the token pair (hours) — avoid brand-new launches */
  minPairAgeHours: 72,

  /** Maximum number of discovered tokens to track */
  maxDiscoveredTokens: 30,

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

  try {
    // DexScreener token profiles endpoint for Base chain trending
    // We use the search/pairs endpoint filtered to Base
    const url = `${cfg.baseDexScreenerUrl}/search?q=base`;
    console.log(`  🔍 Token Discovery: Scanning DexScreener...`);

    const response = await axios.get(url, { timeout: 15000 });
    const pairs: DexScreenerPair[] = response.data?.pairs || [];

    // Filter to Base chain pairs only
    const basePairs = pairs.filter(p => p.chainId === "base");
    console.log(`  📊 Found ${basePairs.length} Base chain pairs`);

    // Also try the top boosted tokens endpoint
    let boostedPairs: DexScreenerPair[] = [];
    try {
      const boostedResponse = await axios.get(
        "https://api.dexscreener.com/token-boosts/top/v1",
        { timeout: 10000 }
      );
      if (Array.isArray(boostedResponse.data)) {
        const baseBoosted = boostedResponse.data
          .filter((t: any) => t.chainId === "base")
          .map((t: any) => t.tokenAddress);
        // Fetch pair data for boosted tokens
        for (const addr of baseBoosted.slice(0, 10)) {
          try {
            const pairRes = await axios.get(
              `${cfg.baseDexScreenerUrl}/tokens/${addr}`,
              { timeout: 10000 }
            );
            const tokenPairs = (pairRes.data?.pairs || []).filter((p: DexScreenerPair) => p.chainId === "base");
            boostedPairs.push(...tokenPairs);
          } catch { /* skip */ }
        }
      }
    } catch { /* boosted endpoint optional */ }

    // Merge and deduplicate
    const allPairs = [...basePairs, ...boostedPairs];
    const seenAddresses = new Set<string>();

    for (const pair of allPairs) {
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
        decimals: 18, // Default — will be verified on first trade
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

    // Sort by volume (highest first) and cap
    discovered.sort((a, b) => b.volume24hUSD - a.volume24hUSD);
    return discovered.slice(0, cfg.maxDiscoveredTokens);

  } catch (error: any) {
    console.error(`  ❌ DexScreener scan failed:`, error.message);
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

  /** Start periodic scanning */
  start(): void {
    console.log(`  🔍 Token Discovery Engine started (scanning every ${TOKEN_DISCOVERY_CONFIG.scanIntervalMs / 3600000}h)`);
    // Run initial scan after 30 seconds (let the bot boot first)
    setTimeout(() => this.runScan(), 30_000);
    // Then run on schedule
    this.scanTimer = setInterval(
      () => this.runScan(),
      TOKEN_DISCOVERY_CONFIG.scanIntervalMs
    );
  }

  /** Stop scanning */
  stop(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  /** Run a discovery scan */
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
      t.coingeckoId !== "" && // Must have CoinGecko ID for price feeds
      t.liquidityUSD >= TOKEN_DISCOVERY_CONFIG.minLiquidityUSD &&
      t.volume24hUSD >= TOKEN_DISCOVERY_CONFIG.minVolume24hUSD
    );
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
