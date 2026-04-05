/**
 * Never Rest Capital — Market Intelligence Data Fetchers
 * Extracted from agent-v3.2.ts (Phase 6 refactor)
 *
 * News sentiment, macro data, CMC intelligence, and DeFi data fetchers.
 * Each function manages its own cache independently.
 */

import axios from 'axios';
import type { DefiLlamaData, DerivativesData } from "../../algorithm/market-analysis.js";
import type { NewsSentimentData, MacroData, CMCIntelligence } from "../types/market-data.js";

// Module-level dep
let TOKEN_REGISTRY: Record<string, any> = {};

export function initIntelligenceFetchers(deps: { TOKEN_REGISTRY: Record<string, any> }) {
  TOKEN_REGISTRY = deps.TOKEN_REGISTRY;
}

// ============================================================================
// DEFI LLAMA
// ============================================================================

export async function fetchDefiLlamaData(): Promise<DefiLlamaData | null> {
  try {
    // Fetch Base chain TVL + historical for 24h change
    const [chainRes, protocolsRes, dexVolumeRes] = await Promise.allSettled([
      axios.get("https://api.llama.fi/v2/historicalChainTvl/Base", { timeout: 10000 }),
      axios.get("https://api.llama.fi/v2/protocols", { timeout: 15000 }),
      axios.get("https://api.llama.fi/overview/dexs/base?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyVolume", { timeout: 10000 }),
    ]);

    let baseTVL = 0;
    let baseTVLChange24h = 0;

    if (chainRes.status === "fulfilled" && chainRes.value.data?.length > 1) {
      const tvlData = chainRes.value.data;
      baseTVL = tvlData[tvlData.length - 1]?.tvl || 0;
      const prevTVL = tvlData[tvlData.length - 2]?.tvl || baseTVL;
      baseTVLChange24h = prevTVL > 0 ? ((baseTVL - prevTVL) / prevTVL) * 100 : 0;
    }

    let baseDEXVolume24h = 0;
    if (dexVolumeRes.status === "fulfilled") {
      baseDEXVolume24h = dexVolumeRes.value.data?.total24h || 0;
    }

    // Map protocol names to our token symbols for matching
    const tokenProtocolMap: Record<string, string[]> = {
      AERO: ["aerodrome"],
      MORPHO: ["morpho"],
      PENDLE: ["pendle"],
      AAVE: ["aave"],
      CRV: ["curve", "curve-dex"],
      ENA: ["ethena"],
      ETHFI: ["ether.fi", "etherfi"],
      RSR: ["reserve"],
    };

    const topProtocols: { name: string; tvl: number; change24h: number }[] = [];
    const protocolTVLByToken: Record<string, { tvl: number; change24h: number }> = {};

    if (protocolsRes.status === "fulfilled") {
      const baseProtocols = protocolsRes.value.data
        .filter((p: any) => p.chains?.includes("Base") && p.tvl > 0)
        .sort((a: any, b: any) => (b.tvl || 0) - (a.tvl || 0))
        .slice(0, 15);

      for (const protocol of baseProtocols) {
        const tvl = protocol.tvl || 0;
        const change24h = protocol.change_1d || 0;
        topProtocols.push({ name: protocol.name, tvl, change24h });

        // Match to our tokens
        for (const [symbol, slugs] of Object.entries(tokenProtocolMap)) {
          if (slugs.some(slug => protocol.slug?.includes(slug) || protocol.name?.toLowerCase().includes(slug))) {
            protocolTVLByToken[symbol] = { tvl, change24h };
          }
        }
      }
    }

    console.log(`  📊 DefiLlama: Base TVL $${(baseTVL / 1e9).toFixed(2)}B (${baseTVLChange24h >= 0 ? "+" : ""}${baseTVLChange24h.toFixed(1)}%) | DEX Vol $${(baseDEXVolume24h / 1e6).toFixed(0)}M`);
    return { baseTVL, baseTVLChange24h, baseDEXVolume24h, topProtocols, protocolTVLByToken };
  } catch (error: any) {
    console.warn(`  ⚠️ DefiLlama fetch failed: ${error?.message?.substring(0, 100) || error}`);
    return null;
  }
}

/**
 * Fetch BTC/ETH funding rates and open interest from Binance (free, no API key needed)
 */
export async function fetchDerivativesData(): Promise<DerivativesData | null> {
  // v11.5: Binance derivatives DISABLED — geo-blocked on US Railway infrastructure,
  // and bot has no futures trading capability (trades Base DeFi via CDP).
  // All 10 API calls removed. Downstream code already handles null gracefully.
  return null;
}

// ============================================================================
// NEWS, MACRO, CMC CACHES + FETCHERS
// ============================================================================

// Cache for macro data (only fetch once per hour since most data is daily/monthly)
// v10.2: Track success separately — retry failures in 5min, cache success for 1hr
let macroCache: { data: MacroData | null; lastFetch: number; lastSuccess: number } = { data: null, lastFetch: 0, lastSuccess: 0 };
const MACRO_CACHE_TTL = 60 * 60 * 1000; // 1 hour (success)
const MACRO_CACHE_RETRY_TTL = 5 * 60 * 1000; // 5 min (failure retry)

// Cache for news sentiment (fetch every cycle but with fallback)
let newsCache: { data: NewsSentimentData | null; lastFetch: number } = { data: null, lastFetch: 0 };
const NEWS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch crypto news sentiment from CryptoPanic API
 * Requires CRYPTOPANIC_AUTH_TOKEN env var (free signup at cryptopanic.com/developers/api/keys)
 * Falls back to headline keyword analysis if CryptoPanic is unavailable
 */
export async function fetchNewsSentiment(): Promise<NewsSentimentData | null> {
  // Return cached data if fresh enough
  if (newsCache.data && Date.now() - newsCache.lastFetch < NEWS_CACHE_TTL) {
    return newsCache.data;
  }

  const authToken = process.env.CRYPTOPANIC_AUTH_TOKEN;
  if (!authToken) {
    console.warn("  \u26a0\ufe0f CRYPTOPANIC_AUTH_TOKEN not set \u2014 news sentiment unavailable. Get a free key at https://cryptopanic.com/developers/api/keys");
    return newsCache.data; // Return stale cache if available
  }

  try {
    // CryptoPanic API v1: auth_token is required as query param (even on free tier)
    const baseUrl = `https://cryptopanic.com/api/v1/posts/?auth_token=${authToken}&public=true&kind=news&regions=en`;

    // Fetch bullish, bearish, and rising news in parallel
    const [bullishRes, bearishRes, risingRes] = await Promise.allSettled([
      axios.get(`${baseUrl}&filter=bullish`, { timeout: 10000 }),
      axios.get(`${baseUrl}&filter=bearish`, { timeout: 10000 }),
      axios.get(`${baseUrl}&filter=rising`, { timeout: 10000 }),
    ]);

    let bullishCount = 0;
    let bearishCount = 0;
    let totalCount = 0;
    const topHeadlines: { title: string; sentiment: string; source: string }[] = [];
    const tokenMentions: Record<string, { bullish: number; bearish: number; neutral: number }> = {};

    // Our token symbols to track
    const trackedSymbols = new Set(Object.keys(TOKEN_REGISTRY));

    // Process bullish news
    if (bullishRes.status === "fulfilled" && bullishRes.value?.data?.results) {
      const results = bullishRes.value.data.results;
      bullishCount = results.length;
      for (const item of results.slice(0, 10)) {
        if (topHeadlines.length < 5) {
          topHeadlines.push({ title: item.title?.substring(0, 120) || "", sentiment: "bullish", source: item.source?.title || "unknown" });
        }
        // Track token mentions
        if (item.currencies) {
          for (const c of item.currencies) {
            const sym = c.code?.toUpperCase();
            if (sym && trackedSymbols.has(sym)) {
              if (!tokenMentions[sym]) tokenMentions[sym] = { bullish: 0, bearish: 0, neutral: 0 };
              tokenMentions[sym].bullish++;
            }
          }
        }
      }
    }

    // Process bearish news
    if (bearishRes.status === "fulfilled" && bearishRes.value?.data?.results) {
      const results = bearishRes.value.data.results;
      bearishCount = results.length;
      for (const item of results.slice(0, 10)) {
        if (topHeadlines.length < 5) {
          topHeadlines.push({ title: item.title?.substring(0, 120) || "", sentiment: "bearish", source: item.source?.title || "unknown" });
        }
        if (item.currencies) {
          for (const c of item.currencies) {
            const sym = c.code?.toUpperCase();
            if (sym && trackedSymbols.has(sym)) {
              if (!tokenMentions[sym]) tokenMentions[sym] = { bullish: 0, bearish: 0, neutral: 0 };
              tokenMentions[sym].bearish++;
            }
          }
        }
      }
    }

    // Process rising/trending news as neutral signal strength indicator
    if (risingRes.status === "fulfilled" && risingRes.value?.data?.results) {
      const results = risingRes.value.data.results;
      totalCount = bullishCount + bearishCount + results.length;
      for (const item of results.slice(0, 10)) {
        if (item.currencies) {
          for (const c of item.currencies) {
            const sym = c.code?.toUpperCase();
            if (sym && trackedSymbols.has(sym)) {
              if (!tokenMentions[sym]) tokenMentions[sym] = { bullish: 0, bearish: 0, neutral: 0 };
              tokenMentions[sym].neutral++;
            }
          }
        }
      }
    } else {
      totalCount = bullishCount + bearishCount;
    }

    // Calculate sentiment score (-100 to +100)
    const sentimentScore = totalCount > 0
      ? Math.round(((bullishCount - bearishCount) / Math.max(totalCount, 1)) * 100)
      : 0;

    // Determine overall sentiment
    let overallSentiment: "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" = "NEUTRAL";
    if (sentimentScore > 30) overallSentiment = "BULLISH";
    else if (sentimentScore < -30) overallSentiment = "BEARISH";
    else if (bullishCount > 3 && bearishCount > 3) overallSentiment = "MIXED";

    const result: NewsSentimentData = {
      overallSentiment,
      bullishCount,
      bearishCount,
      totalCount,
      sentimentScore,
      topHeadlines,
      tokenMentions,
      lastUpdated: new Date().toISOString(),
    };

    console.log(`  📰 News Sentiment: ${overallSentiment} (score: ${sentimentScore >= 0 ? "+" : ""}${sentimentScore}) | ${bullishCount} bullish, ${bearishCount} bearish`);
    newsCache = { data: result, lastFetch: Date.now() };
    return result;
  } catch (error: any) {
    console.warn(`  ⚠️ News sentiment fetch failed: ${error?.message?.substring(0, 100) || error}`);
    return newsCache.data; // Return stale cache if available
  }
}

export async function fetchCrossAssetData(fredKey: string | undefined): Promise<MacroData["crossAssets"]> {
  try {
    const fetches: Promise<any>[] = [];

    // FRED series for Gold (GOLDPMGBD228NLBM), Oil WTI (DCOILWTICO), VIX (VIXCLS)
    // S&P 500 daily close (SP500) — limited to 2 most recent for change calc
    if (fredKey) {
      const fredBase = "https://api.stlouisfed.org/fred/series/observations";
      const baseParams = `&api_key=${fredKey}&file_type=json&sort_order=desc&limit=3`;
      fetches.push(
        axios.get(`${fredBase}?series_id=GOLDPMGBD228NLBM${baseParams}`, { timeout: 10000 }).catch(() => null),  // Gold
        axios.get(`${fredBase}?series_id=DCOILWTICO${baseParams}`, { timeout: 10000 }).catch(() => null),         // Oil WTI
        axios.get(`${fredBase}?series_id=VIXCLS${baseParams}`, { timeout: 10000 }).catch(() => null),              // VIX
        axios.get(`${fredBase}?series_id=SP500${baseParams}`, { timeout: 10000 }).catch(() => null),               // S&P 500
      );
    } else {
      fetches.push(Promise.resolve(null), Promise.resolve(null), Promise.resolve(null), Promise.resolve(null));
    }

    // Real-time DXY proxy via Binance USDC/USDT (inverse correlation approximation)
    // Plus PAXG/USDT for real-time gold price
    fetches.push(
      axios.get("https://api.binance.com/api/v3/ticker/24hr?symbol=PAXGUSDT", { timeout: 8000 }).catch(() => null),  // Real-time gold via PAXG
    );

    const [goldRes, oilRes, vixRes, sp500Res, paxgRes] = await Promise.all(fetches);

    const parseFred = (res: any): { latest: number; prev: number } | null => {
      if (!res?.data?.observations) return null;
      const valid = res.data.observations.filter((o: any) => o.value && o.value !== ".");
      if (valid.length < 1) return null;
      return {
        latest: parseFloat(valid[0].value),
        prev: valid.length >= 2 ? parseFloat(valid[1].value) : parseFloat(valid[0].value),
      };
    };

    const gold = parseFred(goldRes);
    const oil = parseFred(oilRes);
    const vix = parseFred(vixRes);
    const sp500 = parseFred(sp500Res);

    // Real-time gold via PAXG (Pax Gold on Binance — 1 PAXG = 1 troy oz gold)
    let goldPrice = gold?.latest ?? null;
    let goldChange24h: number | null = null;
    if (paxgRes?.data) {
      goldPrice = parseFloat(paxgRes.data.lastPrice);
      goldChange24h = parseFloat(paxgRes.data.priceChangePercent);
    } else if (gold) {
      goldChange24h = gold.prev > 0 ? ((gold.latest - gold.prev) / gold.prev) * 100 : null;
    }

    const oilPrice = oil?.latest ?? null;
    const oilChange24h = oil && oil.prev > 0 ? ((oil.latest - oil.prev) / oil.prev) * 100 : null;
    const vixLevel = vix?.latest ?? null;
    const sp500Change = sp500 && sp500.prev > 0 ? ((sp500.latest - sp500.prev) / sp500.prev) * 100 : null;

    // DXY — use FRED DTWEXBGS as real-time proxy (already fetched in main macro function)
    const dxyRealtime: number | null = null;  // Will be filled from main macro's dollarIndex
    const dxyChange24h: number | null = null;

    // Cross-asset correlation signal:
    // Gold up + Dollar down + VIX low = RISK_ON for crypto
    // Gold up + Dollar up + VIX high = FLIGHT_TO_SAFETY (bad for crypto)
    // Dollar down + Oil stable + VIX low = RISK_ON
    let riskOnPts = 0;
    let riskOffPts = 0;
    let flightToSafety = false;

    if (goldChange24h !== null) {
      if (goldChange24h > 1) riskOffPts += 1;  // Gold surging = uncertainty
      if (goldChange24h < -1) riskOnPts += 1;   // Gold dropping = risk appetite
    }
    if (vixLevel !== null) {
      if (vixLevel > 25) { riskOffPts += 2; }   // High fear
      if (vixLevel > 35) { flightToSafety = true; }
      if (vixLevel < 15) riskOnPts += 1;         // Complacency/risk appetite
    }
    if (sp500Change !== null) {
      if (sp500Change > 1) riskOnPts += 1;       // Stocks rallying = risk on
      if (sp500Change < -1) riskOffPts += 1;      // Stocks selling = risk off
      if (sp500Change < -3) riskOffPts += 1;      // Big selloff = extra risk off
    }
    if (oilChange24h !== null) {
      if (oilChange24h > 5) riskOffPts += 1;     // Oil spike = inflation fear
      if (oilChange24h < -5) riskOnPts += 1;      // Oil crash = deflation/demand concerns but good for margins
    }

    let crossAssetSignal: "RISK_ON" | "RISK_OFF" | "FLIGHT_TO_SAFETY" | "NEUTRAL" = "NEUTRAL";
    if (flightToSafety && (goldChange24h ?? 0) > 1) crossAssetSignal = "FLIGHT_TO_SAFETY";
    else if (riskOnPts >= riskOffPts + 2) crossAssetSignal = "RISK_ON";
    else if (riskOffPts >= riskOnPts + 2) crossAssetSignal = "RISK_OFF";

    console.log(`  🌍 Cross-Assets: Gold $${goldPrice?.toFixed(0) ?? "N/A"} (${goldChange24h !== null ? (goldChange24h >= 0 ? "+" : "") + goldChange24h.toFixed(1) + "%" : "N/A"}) | Oil $${oilPrice?.toFixed(1) ?? "N/A"} | VIX ${vixLevel?.toFixed(1) ?? "N/A"} | S&P ${sp500Change !== null ? (sp500Change >= 0 ? "+" : "") + sp500Change.toFixed(1) + "%" : "N/A"} → ${crossAssetSignal}`);

    return {
      goldPrice, goldChange24h, oilPrice, oilChange24h,
      dxyRealtime, dxyChange24h, sp500Change, vixLevel,
      crossAssetSignal,
    };
  } catch (error: any) {
    console.warn(`  ⚠️ Cross-asset fetch failed: ${error?.message?.substring(0, 100) || error}`);
    return null;
  }
}

// ============================================================================
// v20.3.1: COINMARKETCAP INTELLIGENCE — trending narratives + global metrics
// Uses standard CMC API key (free tier). x402 pay-per-request ready when CDP
// wallets support x402 EIP-712 signing (tracked: github.com/coinbase/x402).
// ============================================================================

// CMCIntelligence — imported from types/market-data.ts

let cmcCache: { data: CMCIntelligence | null; lastFetch: number } = { data: null, lastFetch: 0 };
const CMC_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
let x402DailySpendUSD = 0;
let x402DailyResetDate = new Date().toISOString().split('T')[0];
const X402_DAILY_SPEND_CAP_USD = 5;

export async function fetchCMCIntelligence(): Promise<CMCIntelligence | null> {
  // Cache check
  if (cmcCache.data && Date.now() - cmcCache.lastFetch < CMC_CACHE_TTL) {
    return cmcCache.data;
  }

  // Reset daily x402 spend counter at midnight UTC
  const today = new Date().toISOString().split('T')[0];
  if (today !== x402DailyResetDate) {
    x402DailySpendUSD = 0;
    x402DailyResetDate = today;
  }

  const cmcApiKey = process.env.CMC_API_KEY;
  if (!cmcApiKey) {
    // x402 path: TODO — enable when CDP Smart Wallets support x402 EIP-712 signing
    // For now, CMC API key is required (free at coinmarketcap.com/api)
    return cmcCache.data;
  }

  // Daily spending cap check (for future x402 integration)
  if (x402DailySpendUSD >= X402_DAILY_SPEND_CAP_USD) {
    console.log(`  💰 x402 daily cap reached ($${x402DailySpendUSD.toFixed(2)}/$${X402_DAILY_SPEND_CAP_USD}) — using cached CMC data`);
    return cmcCache.data;
  }

  try {
    const headers = { 'X-CMC_PRO_API_KEY': cmcApiKey, Accept: 'application/json' };

    const [trendingRes, globalRes] = await Promise.allSettled([
      axios.get('https://pro-api.coinmarketcap.com/v1/cryptocurrency/trending/latest', {
        headers, timeout: 10000, params: { limit: 10 },
      }),
      axios.get('https://pro-api.coinmarketcap.com/v1/global-metrics/quotes/latest', {
        headers, timeout: 10000,
      }),
    ]);

    const trending: CMCIntelligence['trendingCoins'] = [];
    if (trendingRes.status === 'fulfilled' && trendingRes.value.data?.data) {
      for (const coin of trendingRes.value.data.data.slice(0, 10)) {
        trending.push({
          name: coin.name || '',
          symbol: coin.symbol || '',
          change24h: coin.quote?.USD?.percent_change_24h || 0,
        });
      }
    }

    let globalMetrics: CMCIntelligence['globalMetrics'] = {
      totalMarketCap: 0, btcDominance: 0, totalVolume24h: 0, altcoinMarketCap: 0,
    };
    if (globalRes.status === 'fulfilled' && globalRes.value.data?.data) {
      const g = globalRes.value.data.data;
      globalMetrics = {
        totalMarketCap: g.quote?.USD?.total_market_cap || 0,
        btcDominance: g.btc_dominance || 0,
        totalVolume24h: g.quote?.USD?.total_volume_24h || 0,
        altcoinMarketCap: g.quote?.USD?.altcoin_market_cap || 0,
      };
    }

    const result: CMCIntelligence = { trendingCoins: trending, globalMetrics, fetchedAt: Date.now() };
    cmcCache = { data: result, lastFetch: Date.now() };

    if (trending.length > 0) {
      console.log(`  📊 CMC Intelligence: ${trending.length} trending (${trending.slice(0, 3).map(t => t.symbol).join(', ')}...) | BTC dom: ${globalMetrics.btcDominance.toFixed(1)}%`);
    }

    return result;
  } catch (err: any) {
    console.warn(`  ⚠️ CMC Intelligence fetch failed: ${err?.message?.substring(0, 100)}`);
    return cmcCache.data;
  }
}

export async function fetchMacroData(): Promise<MacroData | null> {
  // v10.2: Use success TTL for good data, retry TTL for failures
  if (macroCache.data && Date.now() - macroCache.lastSuccess < MACRO_CACHE_TTL) {
    return macroCache.data;
  }
  if (!macroCache.data && Date.now() - macroCache.lastFetch < MACRO_CACHE_RETRY_TTL) {
    return macroCache.data; // Don't spam retries on failure
  }

  const FRED_KEY = process.env.FRED_API_KEY;
  if (!FRED_KEY) {
    console.warn("  \u26a0\ufe0f FRED_API_KEY not set \u2014 macro data unavailable. Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html");
    return macroCache.data; // Return stale cache if available
  }

  try {
    // FRED API uses api_key query parameter for authentication
    const fredBase = "https://api.stlouisfed.org/fred/series/observations";
    const fredOpts = { timeout: 10000 };
    const baseParams = `&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=2`;

    // Fetch all series in parallel (6 requests, well within 120/min limit)
    const [dffRes, dgs10Res, t10y2yRes, cpiRes, m2Res, dollarRes] = await Promise.allSettled([
      axios.get(`${fredBase}?series_id=DFF${baseParams}`, fredOpts),
      axios.get(`${fredBase}?series_id=DGS10${baseParams}`, fredOpts),
      axios.get(`${fredBase}?series_id=T10Y2Y${baseParams}`, fredOpts),
      axios.get(`${fredBase}?series_id=CPIAUCSL${baseParams}&limit=13`, fredOpts),  // 13 months for YoY
      axios.get(`${fredBase}?series_id=M2SL${baseParams}&limit=13`, fredOpts),      // 13 months for YoY
      axios.get(`${fredBase}?series_id=DTWEXBGS${baseParams}`, fredOpts),
    ]);

    const parseLatest = (res: PromiseSettledResult<any>): { value: number; date: string } | null => {
      if (res.status !== "fulfilled") return null;
      const obs = res.value?.data?.observations;
      if (!obs || obs.length === 0) return null;
      // Find first valid (non-".") observation
      for (const o of obs) {
        if (o.value && o.value !== ".") {
          return { value: parseFloat(o.value), date: o.date };
        }
      }
      return null;
    };

    const parseYoY = (res: PromiseSettledResult<any>): { value: number; date: string; yoyChange: number | null } | null => {
      if (res.status !== "fulfilled") return null;
      const obs = res.value?.data?.observations?.filter((o: any) => o.value && o.value !== ".");
      if (!obs || obs.length === 0) return null;
      const latest = { value: parseFloat(obs[0].value), date: obs[0].date };
      // Calculate YoY change if we have 12+ months of data
      let yoyChange: number | null = null;
      if (obs.length >= 12) {
        const yearAgo = parseFloat(obs[11].value || obs[obs.length - 1].value);
        if (yearAgo > 0) {
          yoyChange = ((latest.value - yearAgo) / yearAgo) * 100;
        }
      }
      return { ...latest, yoyChange };
    };

    const fedFundsRate = parseLatest(dffRes);
    const treasury10Y = parseLatest(dgs10Res);
    const yieldCurve = parseLatest(t10y2yRes);
    const cpi = parseYoY(cpiRes);
    const m2MoneySupply = parseYoY(m2Res);
    const dollarIndex = parseLatest(dollarRes);

    // Determine rate direction from Fed Funds Rate
    let rateDirection: "HIKING" | "CUTTING" | "PAUSED" = "PAUSED";
    if (dffRes.status === "fulfilled") {
      const obs = dffRes.value?.data?.observations?.filter((o: any) => o.value && o.value !== ".");
      if (obs && obs.length >= 2) {
        const diff = parseFloat(obs[0].value) - parseFloat(obs[1].value);
        if (diff > 0.1) rateDirection = "HIKING";
        else if (diff < -0.1) rateDirection = "CUTTING";
      }
    }

    // Determine composite macro signal
    let macroSignal: "RISK_ON" | "RISK_OFF" | "NEUTRAL" = "NEUTRAL";
    let riskOnPoints = 0;
    let riskOffPoints = 0;

    // Rate cutting = risk on for crypto
    if (rateDirection === "CUTTING") riskOnPoints += 2;
    if (rateDirection === "HIKING") riskOffPoints += 2;

    // Yield curve inversion = recession risk = ultimately risk off
    if (yieldCurve && yieldCurve.value < 0) riskOffPoints += 1;
    if (yieldCurve && yieldCurve.value > 0.5) riskOnPoints += 1;

    // Rising 10Y yields = competition for risk assets = risk off
    if (treasury10Y && treasury10Y.value > 4.5) riskOffPoints += 1;
    if (treasury10Y && treasury10Y.value < 3.5) riskOnPoints += 1;

    // High CPI = Fed may tighten = risk off; falling CPI = room to cut = risk on
    if (cpi?.yoyChange !== null && cpi?.yoyChange !== undefined) {
      if (cpi.yoyChange > 4) riskOffPoints += 1;
      if (cpi.yoyChange < 2.5) riskOnPoints += 1;
    }

    // Growing M2 = more liquidity = risk on
    if (m2MoneySupply?.yoyChange !== null && m2MoneySupply?.yoyChange !== undefined) {
      if (m2MoneySupply.yoyChange > 5) riskOnPoints += 1;
      if (m2MoneySupply.yoyChange < 0) riskOffPoints += 1;
    }

    // Strong dollar = headwind for crypto
    if (dollarIndex && dollarIndex.value > 110) riskOffPoints += 1;
    if (dollarIndex && dollarIndex.value < 100) riskOnPoints += 1;

    if (riskOnPoints >= riskOffPoints + 2) macroSignal = "RISK_ON";
    else if (riskOffPoints >= riskOnPoints + 2) macroSignal = "RISK_OFF";

    // v5.1: Fetch cross-asset data in parallel with FRED processing
    const crossAssets = await fetchCrossAssetData(FRED_KEY);

    // v5.1: Feed cross-asset signals into composite macro signal
    if (crossAssets) {
      if (crossAssets.crossAssetSignal === "RISK_ON") riskOnPoints += 1;
      if (crossAssets.crossAssetSignal === "RISK_OFF") riskOffPoints += 1;
      if (crossAssets.crossAssetSignal === "FLIGHT_TO_SAFETY") riskOffPoints += 2;
      // Recalculate
      if (riskOnPoints >= riskOffPoints + 2) macroSignal = "RISK_ON";
      else if (riskOffPoints >= riskOnPoints + 2) macroSignal = "RISK_OFF";
      else macroSignal = "NEUTRAL";

      // Feed DXY back from FRED if available
      if (dollarIndex && crossAssets.dxyRealtime === null) {
        crossAssets.dxyRealtime = dollarIndex.value;
      }
    }

    const result: MacroData = {
      fedFundsRate,
      treasury10Y,
      yieldCurve,
      cpi,
      m2MoneySupply,
      dollarIndex,
      macroSignal,
      rateDirection,
      crossAssets,
    };

    console.log(`  🏦 Macro Data: ${macroSignal} | Fed: ${fedFundsRate?.value ?? "N/A"}% (${rateDirection}) | 10Y: ${treasury10Y?.value ?? "N/A"}% | Curve: ${yieldCurve?.value ?? "N/A"}`);
    if (cpi) console.log(`     CPI: ${cpi.value.toFixed(1)} (${cpi.yoyChange !== null ? `${cpi.yoyChange.toFixed(1)}% YoY` : "N/A"}) | M2: ${m2MoneySupply?.yoyChange !== null ? `${m2MoneySupply?.yoyChange?.toFixed(1)}% YoY` : "N/A"} | Dollar: ${dollarIndex?.value?.toFixed(1) ?? "N/A"}`);

    macroCache = { data: result, lastFetch: Date.now(), lastSuccess: Date.now() };
    return result;
  } catch (error: any) {
    console.warn(`  ⚠️ Macro data fetch failed: ${error?.message?.substring(0, 100) || error}`);
    macroCache.lastFetch = Date.now(); // Track failure time for retry throttle
    return macroCache.data; // Return stale cache if available
  }
}
