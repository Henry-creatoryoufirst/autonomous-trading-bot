/**
 * Token Discovery Service — v7.0
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
  /** Whether this token is also in the static TOKEN_REGISTRY */
  isStatic?: boolean;
  /** Whether LP tokens are locked in a known locker / burned */
  lpLocked?: boolean;
  /** Percentage of supply held by top 10 wallets (0-100) */
  holderConcentration?: number;
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
// HONEYPOT DETECTION
// ============================================================================

/**
 * Check if a token is a honeypot (buy-but-can't-sell scam) via honeypot.is API.
 * Fails open — if the API is unavailable, returns false so we don't block discovery.
 */
async function isHoneypot(tokenAddress: string): Promise<boolean> {
  try {
    const res = await axios.get(
      `https://api.honeypot.is/v2/IsHoneypot?address=${tokenAddress}&chainID=${activeChain.chainId}`,
      { timeout: 5000 }
    );
    return res.data?.isHoneypot === true;
  } catch {
    return false; // Fail open — don't block discovery on API errors
  }
}

// ============================================================================
// ON-CHAIN SAFETY HELPERS — LP Lock + Holder Concentration
// ============================================================================

/**
 * Detect whether LP tokens for a Uniswap V2-style pair are locked/burned.
 * On V2-style DEXes the pair address IS the LP token contract.
 * Checks known locker contracts + burn addresses against totalSupply.
 * Returns true if >50% of LP supply is locked/burned. Fails open (returns false on error).
 */
async function checkLpLocked(pairAddress: string): Promise<boolean> {
  const LOCKER_ADDRESSES = [
    "0x663A5C229c09b049E36dCc11a9B0d4a8Eb9db214", // Uncx V2 locker
    "0xE2fE530C047f2d85298b07D9333C05737f1435fB", // Team Finance
    "0x000000000000000000000000000000000000dEaD", // Dead address (burned)
    "0x0000000000000000000000000000000000000000", // Zero address (burned)
  ];

  try {
    // Fetch totalSupply — selector 0x18160ddd
    const supplyRes = await axios.post(BASE_RPC, {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: pairAddress, data: "0x18160ddd" }, "latest"],
    }, { timeout: 5000 });

    const supplyHex = supplyRes.data?.result;
    if (!supplyHex || supplyHex === "0x" || supplyHex === "0x0") return false;
    const totalSupply = BigInt(supplyHex);
    if (totalSupply === 0n) return false;

    // Fetch balanceOf for each locker address in parallel
    // selector 0x70a08231 + address padded to 32 bytes
    const balanceResults = await Promise.all(
      LOCKER_ADDRESSES.map(locker => {
        const paddedAddr = locker.toLowerCase().replace("0x", "").padStart(64, "0");
        return axios.post(BASE_RPC, {
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [{ to: pairAddress, data: `0x70a08231${paddedAddr}` }, "latest"],
        }, { timeout: 5000 }).then(r => r.data?.result).catch(() => "0x0");
      })
    );

    let lockedSupply = 0n;
    for (const hex of balanceResults) {
      if (!hex || hex === "0x" || hex === "0x0") continue;
      try { lockedSupply += BigInt(hex); } catch { /* skip malformed */ }
    }

    // Locked if >50% of supply is in locker/burned addresses
    return lockedSupply * 2n > totalSupply;
  } catch {
    return false; // Fail open — don't block discovery
  }
}

/**
 * Get top-10 holder concentration for a token (% of supply held by top 10 wallets).
 * Uses Basescan API if BASESCAN_API_KEY is set; otherwise returns 50 as neutral default.
 */
async function getHolderConcentration(tokenAddress: string): Promise<number> {
  const apiKey = process.env.BASESCAN_API_KEY;
  if (!apiKey) return 50; // Neutral default — don't penalise lack of key

  try {
    // V2 multi-chain endpoint — works with Etherscan.io keys across all supported chains (chainid=8453 = Base)
    const url = `https://api.etherscan.io/v2/api?chainid=8453&module=token&action=tokenholderlist&contractaddress=${tokenAddress}&page=1&offset=10&apikey=${apiKey}`;
    const res = await axios.get(url, { timeout: 8000 });
    const holders: { TokenHolderQuantity: string }[] = res.data?.result || [];
    if (!Array.isArray(holders) || holders.length === 0) return 50;

    // totalSupply for normalisation — reuse the on-chain call
    const supplyRes = await axios.post(BASE_RPC, {
      jsonrpc: "2.0",
      id: 2,
      method: "eth_call",
      params: [{ to: tokenAddress, data: "0x18160ddd" }, "latest"],
    }, { timeout: 5000 });

    const supplyHex = supplyRes.data?.result;
    if (!supplyHex || supplyHex === "0x" || supplyHex === "0x0") return 50;
    const totalSupply = BigInt(supplyHex);
    if (totalSupply === 0n) return 50;

    const top10Sum = holders.reduce((acc, h) => {
      try { return acc + BigInt(h.TokenHolderQuantity); } catch { return acc; }
    }, 0n);

    // Convert to percentage (×100 then divide, preserving precision before narrowing to number)
    const concentration = Number((top10Sum * 10000n) / totalSupply) / 100;
    return Math.min(Math.max(concentration, 0), 100);
  } catch {
    return 50; // Fail open — neutral default
  }
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
          // GeckoTerminal IDs are formatted as "base_0xABC..." — strip the chain prefix
          const rawId = pool.relationships?.base_token?.data?.id || '';
          const address = rawId.includes('_') ? rawId.split('_').slice(1).join('_') : rawId;

          if (!address || !symbol || !address.startsWith('0x')) continue;
          if (seenAddresses.has(address.toLowerCase())) continue;
          seenAddresses.add(address.toLowerCase());

          // Convert GeckoTerminal format to DexScreenerPair shape
          // volume_usd and transactions are nested by time period
          const volObj = attrs.volume_usd || {};
          const vol24h = parseFloat(volObj.h24 || volObj.h6 || '0');
          const liq = parseFloat(attrs.reserve_in_usd || '0');
          const txObj = attrs.transactions?.h24 || {};
          const txBuys = txObj.buys || 0;
          const txSells = txObj.sells || 0;

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
            priceChange: { h24: parseFloat(attrs.price_change_percentage?.h24 || attrs.price_change_percentage?.h6 || '0') },
            liquidity: { usd: liq },
            fdv: parseFloat(String(attrs.fdv_usd ?? '0')) || 0,
            pairCreatedAt: attrs.pool_created_at ? new Date(attrs.pool_created_at).getTime() : 0,
          });
        }
      } catch { /* skip page failures */ }
    }

    // SECONDARY: GeckoTerminal gainers — tokens sorted by 24h price change.
    // This is organic alpha: real momentum, not paid promotion.
    console.log(`  📊 GeckoTerminal trending: ${basePairs.length} unique ${chainId} tokens`);

    try {
      const gainersUrl = `https://api.geckoterminal.com/api/v2/networks/${geckoNetwork}/pools?sort=h24_price_change_percentage_desc&page=1`;
      const gainersRes = await axios.get(gainersUrl, { timeout: 10000 });
      const gainerPools = gainersRes.data?.data || [];
      let gainerCount = 0;

      for (const pool of gainerPools) {
        const attrs = pool.attributes || {};
        const name = attrs.name || '';
        const parts = name.split(' / ');
        const symbol = parts[0]?.trim() || '';
        const rawId = pool.relationships?.base_token?.data?.id || '';
        const address = rawId.includes('_') ? rawId.split('_').slice(1).join('_') : rawId;

        if (!address || !symbol || !address.startsWith('0x')) continue;
        if (seenAddresses.has(address.toLowerCase())) continue;
        seenAddresses.add(address.toLowerCase());

        const volObj = attrs.volume_usd || {};
        const vol24h = parseFloat(volObj.h24 || volObj.h6 || '0');
        const liq = parseFloat(attrs.reserve_in_usd || '0');
        const txObj = attrs.transactions?.h24 || {};

        basePairs.push({
          chainId,
          dexId: attrs.dex_id || 'unknown',
          url: '',
          pairAddress: attrs.address || '',
          baseToken: { address, name: symbol, symbol },
          quoteToken: { address: '', name: '', symbol: '' },
          priceNative: '0',
          priceUsd: attrs.base_token_price_usd || '0',
          txns: { h24: { buys: txObj.buys || 0, sells: txObj.sells || 0 } },
          volume: { h24: vol24h },
          priceChange: { h24: parseFloat(attrs.price_change_percentage?.h24 || attrs.price_change_percentage?.h6 || '0') },
          liquidity: { usd: liq },
          fdv: parseFloat(String(attrs.fdv_usd ?? '0')) || 0,
          pairCreatedAt: attrs.pool_created_at ? new Date(attrs.pool_created_at).getTime() : 0,
        });
        gainerCount++;
      }
      console.log(`  📈 GeckoTerminal gainers: +${gainerCount} new tokens`);
    } catch { /* gainers endpoint optional */ }

    // TERTIARY: GeckoTerminal new pools — catch funded fresh launches before they trend.
    // Higher liquidity bar so we only surface launches with real capital behind them.
    try {
      const newPoolsUrl = `https://api.geckoterminal.com/api/v2/networks/${geckoNetwork}/new_pools?page=1`;
      const newPoolsRes = await axios.get(newPoolsUrl, { timeout: 10000 });
      const freshPools = newPoolsRes.data?.data || [];
      let newPoolCount = 0;

      for (const pool of freshPools) {
        const attrs = pool.attributes || {};
        const liq = parseFloat(attrs.reserve_in_usd || '0');
        if (liq < cfg.minLiquidityUSD * 2) continue; // 2x bar: new pools must prove capital

        const name = attrs.name || '';
        const parts = name.split(' / ');
        const symbol = parts[0]?.trim() || '';
        const rawId = pool.relationships?.base_token?.data?.id || '';
        const address = rawId.includes('_') ? rawId.split('_').slice(1).join('_') : rawId;

        if (!address || !symbol || !address.startsWith('0x')) continue;
        if (seenAddresses.has(address.toLowerCase())) continue;
        seenAddresses.add(address.toLowerCase());

        const volObj = attrs.volume_usd || {};
        const vol24h = parseFloat(volObj.h24 || volObj.h6 || '0');
        const txObj = attrs.transactions?.h24 || {};

        basePairs.push({
          chainId,
          dexId: attrs.dex_id || 'unknown',
          url: '',
          pairAddress: attrs.address || '',
          baseToken: { address, name: symbol, symbol },
          quoteToken: { address: '', name: '', symbol: '' },
          priceNative: '0',
          priceUsd: attrs.base_token_price_usd || '0',
          txns: { h24: { buys: txObj.buys || 0, sells: txObj.sells || 0 } },
          volume: { h24: vol24h },
          priceChange: { h24: parseFloat(attrs.price_change_percentage?.h24 || attrs.price_change_percentage?.h6 || '0') },
          liquidity: { usd: liq },
          fdv: parseFloat(String(attrs.fdv_usd ?? '0')) || 0,
          pairCreatedAt: attrs.pool_created_at ? new Date(attrs.pool_created_at).getTime() : 0,
        });
        newPoolCount++;
      }
      if (newPoolCount > 0) {
        console.log(`  🆕 GeckoTerminal new pools: +${newPoolCount} fresh tokens`);
      }
    } catch { /* new pools endpoint optional */ }

    for (const pair of basePairs) {
      const token = pair.baseToken;
      const address = token.address.toLowerCase();

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

    // Honeypot filter — parallel batch check against honeypot.is API.
    // Cap at 30 concurrent checks to stay within free-tier rate limits.
    // Fails open: if honeypot.is is down, we don't block discovery.
    const toCheck = discovered.slice(0, 30);
    const honeypotFlags = await Promise.all(
      toCheck.map(t => isHoneypot(t.address))
    );
    const safeDiscovered = discovered.filter((_, i) => !honeypotFlags[i]);
    const scamCount = discovered.length - safeDiscovered.length;
    if (scamCount > 0) {
      console.warn(`  🛡️ Honeypot filter blocked ${scamCount} token(s)`);
    }

    // On-chain safety layer — LP lock + holder concentration
    // Run in parallel on top candidates (capped to avoid RPC rate limits)
    const onChainChecks = await Promise.all(
      safeDiscovered.slice(0, 20).map(async (t) => {
        const [locked, concentration] = await Promise.all([
          checkLpLocked(t.pairAddress),
          getHolderConcentration(t.address),
        ]);
        return { locked, concentration };
      })
    );

    // Apply on-chain safety results
    for (let i = 0; i < onChainChecks.length; i++) {
      const { locked, concentration } = onChainChecks[i];
      safeDiscovered[i].lpLocked = locked;
      safeDiscovered[i].holderConcentration = concentration;

      if (!locked) {
        console.warn(`  ⚠️ LP not locked: ${safeDiscovered[i].symbol} (${safeDiscovered[i].pairAddress})`);
      }
    }

    // Hard filter: remove tokens where top 10 wallets hold >80% of supply (rug setup)
    const preFilterCount = safeDiscovered.length;
    const safeOnChain = safeDiscovered.filter((t, i) => {
      if (i >= onChainChecks.length) return true; // Unchecked tokens pass through
      return (t.holderConcentration ?? 0) <= 80;
    });
    const rugCount = preFilterCount - safeOnChain.length;
    if (rugCount > 0) {
      console.warn(`  🛡️ Concentration filter blocked ${rugCount} token(s) (>80% top-10 supply)`);
    }

    // Sort by volume (highest first) and cap
    safeOnChain.sort((a, b) => b.volume24hUSD - a.volume24hUSD);
    return safeOnChain.slice(0, cfg.maxDiscoveredTokens);

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
    console.log(`  ⚡ Momentum scan: GeckoTerminal gainers (organic price momentum)...`);

    // Single call to GeckoTerminal price-change-sorted pools.
    // Replaces the old 2-step pattern (boosted addresses → individual DexScreener lookups)
    // which surfaced paid promotions rather than real momentum.
    const geckoNetwork = activeChain.geckoTerminalNetwork;
    const gainersRes = await axios.get(
      `https://api.geckoterminal.com/api/v2/networks/${geckoNetwork}/pools?sort=h24_price_change_percentage_desc&page=1`,
      { timeout: 10000 }
    );
    const gainerPools = gainersRes.data?.data || [];

    for (const pool of gainerPools) {
      const attrs = pool.attributes || {};
      const name = attrs.name || '';
      const parts = name.split(' / ');
      const symbol = parts[0]?.trim() || '';
      const rawId = pool.relationships?.base_token?.data?.id || '';
      const address = rawId.includes('_') ? rawId.split('_').slice(1).join('_') : rawId;

      if (!address || !symbol || !address.startsWith('0x')) continue;

      const liquidity = parseFloat(attrs.reserve_in_usd || '0');
      const volObj = attrs.volume_usd || {};
      const vol24h = parseFloat(volObj.h24 || volObj.h6 || '0');
      const fdv = parseFloat(String(attrs.fdv_usd ?? '0')) || 0;
      const txObj = attrs.transactions?.h24 || {};
      const txns = (txObj.buys || 0) + (txObj.sells || 0);
      const priceChange = parseFloat(attrs.price_change_percentage?.h24 || attrs.price_change_percentage?.h6 || '0');
      const pairAge = attrs.pool_created_at
        ? (Date.now() - new Date(attrs.pool_created_at).getTime()) / (1000 * 60 * 60)
        : 0;

      // Safety filters — more lenient than full scan (momentum plays, not long-term holds)
      if (cfg.excludeSymbols.has(symbol.toUpperCase())) continue;
      if (liquidity < 25_000) continue;   // Min $25K liquidity
      if (vol24h < 50_000) continue;       // Min $50K volume for momentum
      if (pairAge < 24) continue;          // At least 24h old
      if (txns < 50) continue;             // Organic activity required

      discovered.push({
        address,
        symbol: symbol.toUpperCase(),
        name: symbol,
        decimals: 18,
        coingeckoId: '',
        sector: classifySector(symbol, symbol),
        riskLevel: classifyRisk(liquidity, pairAge, fdv),
        liquidityUSD: liquidity,
        volume24hUSD: vol24h,
        priceUSD: parseFloat(attrs.base_token_price_usd || '0'),
        fdvUSD: fdv,
        priceChange24h: priceChange,
        txns24h: txns,
        discoveredAt: new Date().toISOString(),
        pairCreatedAt: attrs.pool_created_at || '',
        dexName: attrs.dex_id || 'unknown',
        pairAddress: attrs.address || '',
        minTradeUSD: liquidity > 200_000 ? 5 : 3,
      });
    }

    console.log(`  ⚡ Momentum scan found ${discovered.length} gainers`);
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
        // Tag static tokens but DON'T skip them — track their momentum
        const isStatic = this.staticSymbols.has(token.symbol.toUpperCase());
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
        this.state.discoveredTokens.push({ ...token, isStatic });
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

      // Tag tokens that overlap with static registry — but keep them in the pool
      // so discovery can track their momentum, volume spikes, and price action.
      // Previously this was a hard filter that removed ALL registry tokens,
      // causing the bot to miss 30-50% runners on tokens it already knew about.
      const newTokens = discovered.map(t => ({
        ...t,
        isStatic: this.staticSymbols.has(t.symbol.toUpperCase()),
      }));

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

      const staticCount = newTokens.filter(t => t.isStatic).length;
      const freshCount = newTokens.length - staticCount;
      console.log(`   📊 Discovery pool: ${newTokens.length} tokens (${freshCount} new + ${staticCount} static) | Top by volume:`);
      for (const t of newTokens.slice(0, 5)) {
        const tag = t.isStatic ? " [STATIC]" : "";
        console.log(`      ${t.symbol}${tag}: $${(t.volume24hUSD / 1000).toFixed(0)}K vol | $${(t.liquidityUSD / 1000).toFixed(0)}K liq | ${t.sector}`);
      }

      // Log hot movers (runners the bot should pay attention to)
      const hotMovers = newTokens.filter(t => t.priceChange24h >= 20 && t.volume24hUSD >= 50_000);
      if (hotMovers.length > 0) {
        console.log(`   🔥 HOT MOVERS (20%+ in 24h):`);
        for (const t of hotMovers.sort((a, b) => b.priceChange24h - a.priceChange24h).slice(0, 5)) {
          console.log(`      ${t.symbol}: +${t.priceChange24h.toFixed(1)}% | $${(t.volume24hUSD / 1000).toFixed(0)}K vol${t.isStatic ? " [STATIC]" : ""}`);
        }
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
   * v7.0: Get top opportunities — curated shortlist for AI prompt & validation gate.
   * Uses composite scoring to surface the best 5 tokens, with runner detection
   * to ensure explosive movers always make the cut.
   *
   * Scoring weights:
   *  - Volume momentum (35%): normalized 24h volume vs discovery pool median
   *  - Liquidity depth (15%): deeper pools = safer execution
   *  - Timing score (30%): rewards moderate gains (5-25% in 24h = momentum without being
   *    overextended); penalises extreme gains (>40% = likely late entry)
   *  - Buy pressure (20%): buys/(buys+sells) ratio — strong accumulation signal
   *
   * Safety bonus: +5 pts if LP locked, +5 pts if top-10 concentration <40%
   *
   * Runner override: any token with 30%+ price change AND $100K+ volume forces into top 5.
   * Note: timing score de-weights runners so the AI knows they're late-stage entries.
   */
  getTopOpportunities(maxCount: number = 5): (DiscoveredToken & { compositeScore: number; isRunner: boolean })[] {
    const tradeable = this.getTradableTokens();
    if (tradeable.length === 0) return [];

    // Calculate normalization baselines
    const volumes = tradeable.map(t => t.volume24hUSD);
    const liquidities = tradeable.map(t => t.liquidityUSD);
    const medianVolume = [...volumes].sort((a, b) => a - b)[Math.floor(volumes.length / 2)] || 1;
    const maxLiquidity = Math.max(...liquidities) || 1;

    // Score each token
    const scored = tradeable.map(t => {
      // Volume momentum — how much above median (capped at 5x)
      const volumeScore = Math.min(t.volume24hUSD / medianVolume, 5) / 5;

      // Liquidity depth — normalized to pool max
      const liquidityScore = Math.min(t.liquidityUSD / maxLiquidity, 1);

      // Timing score — reward MODERATE gains (5-25% in 24h = momentum without being
      // overextended) and penalise extreme gains (>40% = likely late entry).
      const change = t.priceChange24h;
      const timingScore = change >= 5 && change <= 25
        ? Math.min((change - 5) / 20, 1)          // sweet spot: 5-25%
        : change > 25
        ? Math.max(1 - (change - 25) / 75, 0)      // diminishing returns above 25%
        : 0;                                         // below 5% = no momentum

      // Buy pressure — buys / (buys + sells) from txns24h
      // Derived from the raw pair data stored in the token; fall back to 0.5 if unavailable.
      // NOTE: txns24h is the SUM of buys+sells; we don't store the split separately on
      // DiscoveredToken, so we use a neutral 0.5 unless the token was freshly scanned
      // (the DexScreenerPair buys/sells are consumed during discovery but not persisted).
      // A future pass can store buys/sells separately; for now this scores neutrally.
      const buys = (t as any)._buys as number | undefined;
      const sells = (t as any)._sells as number | undefined;
      const ratio = (buys !== undefined && sells !== undefined && (buys + sells) > 0)
        ? buys / (buys + sells)
        : 0.5; // neutral if not available
      const buyPressureScore = Math.max(Math.min((ratio - 0.5) / 0.5, 1), 0);

      // Weighted composite
      let compositeScore = (
        volumeScore * 0.35 +
        liquidityScore * 0.15 +
        timingScore * 0.30 +
        buyPressureScore * 0.20
      ) * 100;

      // Safety bonus
      if (t.lpLocked === true) compositeScore += 5;
      if (t.holderConcentration !== undefined && t.holderConcentration < 40) compositeScore += 5;

      // Runner detection: 30%+ gain with meaningful volume = forced inclusion.
      // Timing score correctly de-weights these so the AI knows they're late-stage entries.
      const isRunner = t.priceChange24h >= 30 && t.volume24hUSD >= 100_000;

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

  /** Export discovered tokens in TOKEN_REGISTRY format for the agent.
   *  Only exports NON-static tokens (static ones are already in TOKEN_REGISTRY). */
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
      if (token.isStatic) continue; // Already in TOKEN_REGISTRY — don't duplicate
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

  /** Get tokens with significant momentum — includes static registry tokens.
   *  This is the key method for catching runners like PLAY +47%, EDGE +30%.
   *  Returns tokens sorted by 24h price change (highest first). */
  getHotMovers(minPriceChange: number = 10): DiscoveredToken[] {
    return this.state.discoveredTokens
      .filter(t => t.priceChange24h >= minPriceChange && t.volume24hUSD >= 50_000)
      .sort((a, b) => b.priceChange24h - a.priceChange24h);
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
