/**
 * Never Rest Capital — Prompt Formatting Functions
 * Extracted from agent-v3.2.ts (Phase 9 refactor)
 *
 * Pure formatting functions that convert market intelligence data into
 * human-readable text for Claude AI prompts.
 */

import type { DerivativesData, DefiLlamaData, SmartRetailDivergence, FundingRateMeanReversion, TVLPriceDivergence } from '../../algorithm/index.js";
import type { TechnicalIndicators } from '../../algorithm/index.js";
import type { MarketRegime } from "../../types/index.js";
import type { NewsSentimentData, MacroData, GlobalMarketData, StablecoinSupplyData, MarketData } from "../../types/market-data.js";

export function sf(val: number | null | undefined, digits: number): string {
  if (val === null || val === undefined || isNaN(val)) return "N/A";
  return val.toFixed(digits);
}

export function formatIntelligenceForPrompt(
  defi: DefiLlamaData | null,
  derivatives: DerivativesData | null,
  regime: MarketRegime,
  news: NewsSentimentData | null,
  macro: MacroData | null,
  globalMarket: GlobalMarketData | null,
  smartRetailDiv: SmartRetailDivergence | null,
  fundingMR: FundingRateMeanReversion | null,
  tvlPriceDiv: TVLPriceDivergence | null,
  stablecoinData: StablecoinSupplyData | null,
): string {
  const lines: string[] = [];

  if (defi) {
    lines.push(`═══ DEFI INTELLIGENCE (DefiLlama) ═══`);
    lines.push(`Base Chain TVL: $${sf((defi.baseTVL || 0) / 1e9, 2)}B (${(defi.baseTVLChange24h ?? 0) >= 0 ? "+" : ""}${sf(defi.baseTVLChange24h, 1)}% 24h)`);
    lines.push(`Base DEX Volume (24h): $${sf((defi.baseDEXVolume24h || 0) / 1e6, 0)}M`);

    if (defi.topProtocols.length > 0) {
      lines.push(`Top Base Protocols by TVL:`);
      for (const p of defi.topProtocols.slice(0, 8)) {
        lines.push(`  ${p.name}: $${p.tvl > 1e9 ? (p.tvl / 1e9).toFixed(2) + "B" : (p.tvl / 1e6).toFixed(0) + "M"} (${p.change24h >= 0 ? "+" : ""}${p.change24h.toFixed(1)}%)`);
      }
    }

    if (Object.keys(defi.protocolTVLByToken).length > 0) {
      lines.push(`Our DeFi token protocol TVL:`);
      for (const [symbol, data] of Object.entries(defi.protocolTVLByToken)) {
        const tvlStr = data.tvl > 1e9 ? (data.tvl / 1e9).toFixed(2) + "B" : (data.tvl / 1e6).toFixed(0) + "M";
        lines.push(`  ${symbol}: TVL $${tvlStr} (${data.change24h >= 0 ? "+" : ""}${data.change24h.toFixed(1)}% 24h)`);
      }
    }

    // Signal interpretation
    if (defi.baseTVLChange24h > 3) lines.push(`🟢 TVL SIGNAL: Capital flowing INTO Base (+${defi.baseTVLChange24h.toFixed(1)}%) — bullish for Base tokens`);
    else if (defi.baseTVLChange24h < -3) lines.push(`🔴 TVL SIGNAL: Capital flowing OUT of Base (${defi.baseTVLChange24h.toFixed(1)}%) — bearish for Base tokens`);
    lines.push("");
  }

  if (derivatives) {
    lines.push(`═══ DERIVATIVES INTELLIGENCE (Binance) ═══`);
    lines.push(`BTC Funding Rate: ${(derivatives.btcFundingRate ?? 0) >= 0 ? "+" : ""}${sf(derivatives.btcFundingRate, 4)}%/8h → ${derivatives.btcFundingSignal}`);
    lines.push(`ETH Funding Rate: ${(derivatives.ethFundingRate ?? 0) >= 0 ? "+" : ""}${sf(derivatives.ethFundingRate, 4)}%/8h → ${derivatives.ethFundingSignal}`);
    lines.push(`BTC Open Interest: ${sf(derivatives.btcOpenInterest, 0)} BTC ${derivatives.btcOIChange24h !== 0 ? `(${(derivatives.btcOIChange24h ?? 0) >= 0 ? "+" : ""}${sf(derivatives.btcOIChange24h, 1)}% change)` : ""}`);
    lines.push(`ETH Open Interest: ${sf(derivatives.ethOpenInterest, 0)} ETH ${derivatives.ethOIChange24h !== 0 ? `(${(derivatives.ethOIChange24h ?? 0) >= 0 ? "+" : ""}${sf(derivatives.ethOIChange24h, 1)}% change)` : ""}`);

    // v5.1: Long/Short Ratios — retail vs smart money positioning
    lines.push(`--- Positioning Intelligence ---`);
    if (derivatives.btcLongShortRatio !== null) {
      lines.push(`BTC Global L/S Ratio: ${sf(derivatives.btcLongShortRatio, 2)} (${(derivatives.btcLongShortRatio ?? 0) > 1 ? "retail net long" : "retail net short"})`);
    }
    if (derivatives.btcTopTraderLSRatio !== null) {
      lines.push(`BTC Top Trader L/S: ${sf(derivatives.btcTopTraderLSRatio, 2)} (${(derivatives.btcTopTraderLSRatio ?? 0) > 1 ? "smart money long" : "smart money short"})`);
    }
    if (derivatives.ethLongShortRatio !== null) {
      lines.push(`ETH Global L/S Ratio: ${sf(derivatives.ethLongShortRatio, 2)} (${(derivatives.ethLongShortRatio ?? 0) > 1 ? "retail net long" : "retail net short"})`);
    }
    if (derivatives.ethTopTraderLSRatio !== null) {
      lines.push(`ETH Top Trader L/S: ${sf(derivatives.ethTopTraderLSRatio, 2)} (${(derivatives.ethTopTraderLSRatio ?? 0) > 1 ? "smart money long" : "smart money short"})`);
    }

    // v5.1: Composite Positioning Signals
    lines.push(`BTC Positioning: ${derivatives.btcPositioningSignal}`);
    lines.push(`ETH Positioning: ${derivatives.ethPositioningSignal}`);

    // Funding rate interpretation
    if (derivatives.btcFundingSignal === "LONG_CROWDED") {
      lines.push(`⚠️ FUNDING SIGNAL: BTC longs crowded — risk of long squeeze / correction`);
    } else if (derivatives.btcFundingSignal === "SHORT_CROWDED") {
      lines.push(`🟢 FUNDING SIGNAL: BTC shorts crowded — potential short squeeze / rally`);
    }
    if (derivatives.ethFundingSignal === "LONG_CROWDED") {
      lines.push(`⚠️ FUNDING SIGNAL: ETH longs crowded — risk of long squeeze / correction`);
    } else if (derivatives.ethFundingSignal === "SHORT_CROWDED") {
      lines.push(`🟢 FUNDING SIGNAL: ETH shorts crowded — potential short squeeze / rally`);
    }

    // v5.1: Positioning signal interpretation
    const posSignals = [
      { asset: "BTC", signal: derivatives.btcPositioningSignal },
      { asset: "ETH", signal: derivatives.ethPositioningSignal },
    ];
    for (const { asset, signal } of posSignals) {
      switch (signal) {
        case "SMART_MONEY_LONG":
          lines.push(`🟢 POSITIONING: ${asset} — Top traders accumulating longs while retail is short. High-conviction BUY signal.`);
          break;
        case "SMART_MONEY_SHORT":
          lines.push(`🔴 POSITIONING: ${asset} — Top traders going short while retail is long. Distribution phase — caution.`);
          break;
        case "OVERLEVERAGED_LONG":
          lines.push(`⚠️ POSITIONING: ${asset} — Extreme long crowding across all participants. Long squeeze risk elevated.`);
          break;
        case "OVERLEVERAGED_SHORT":
          lines.push(`⚠️ POSITIONING: ${asset} — Extreme short crowding. Short squeeze potential.`);
          break;
      }
    }

    // v5.1: OI-Price Divergence interpretation
    if (derivatives.btcOIPriceDivergence !== "NEUTRAL" && derivatives.btcOIPriceDivergence !== "ALIGNED") {
      if (derivatives.btcOIPriceDivergence === "OI_UP_PRICE_DOWN") {
        lines.push(`⚡ DIVERGENCE: BTC OI rising while price falling — new shorts entering OR longs averaging down. Squeeze potential building.`);
      } else {
        lines.push(`⚡ DIVERGENCE: BTC OI falling while price rising — short squeeze in progress, shorts capitulating.`);
      }
    }
    if (derivatives.ethOIPriceDivergence !== "NEUTRAL" && derivatives.ethOIPriceDivergence !== "ALIGNED") {
      if (derivatives.ethOIPriceDivergence === "OI_UP_PRICE_DOWN") {
        lines.push(`⚡ DIVERGENCE: ETH OI rising while price falling — squeeze potential building.`);
      } else {
        lines.push(`⚡ DIVERGENCE: ETH OI falling while price rising — short squeeze in progress.`);
      }
    }
    lines.push("");
  }

  if (news) {
    lines.push(`═══ NEWS SENTIMENT (CryptoPanic) ═══`);
    lines.push(`Overall: ${news.overallSentiment} (Score: ${news.sentimentScore >= 0 ? "+" : ""}${news.sentimentScore}/100)`);
    lines.push(`Bullish headlines: ${news.bullishCount} | Bearish headlines: ${news.bearishCount} | Total: ${news.totalCount}`);

    if (news.topHeadlines.length > 0) {
      lines.push(`Key Headlines:`);
      for (const h of news.topHeadlines.slice(0, 4)) {
        lines.push(`  [${h.sentiment.toUpperCase()}] ${h.title} (${h.source})`);
      }
    }

    // Token-specific sentiment
    const tokenSentimentEntries = Object.entries(news.tokenMentions).filter(([_, v]) => v.bullish + v.bearish > 0);
    if (tokenSentimentEntries.length > 0) {
      lines.push(`Token News Sentiment:`);
      for (const [sym, counts] of tokenSentimentEntries) {
        const net = counts.bullish - counts.bearish;
        const signal = net > 0 ? "🟢 BULLISH" : net < 0 ? "🔴 BEARISH" : "⚪ NEUTRAL";
        lines.push(`  ${sym}: ${signal} (${counts.bullish} bullish, ${counts.bearish} bearish mentions)`);
      }
    }

    // Sentiment signal interpretation
    if (news.sentimentScore > 40) lines.push(`🟢 NEWS SIGNAL: Strong bullish sentiment — market optimism, watch for FOMO tops`);
    else if (news.sentimentScore < -40) lines.push(`🔴 NEWS SIGNAL: Strong bearish sentiment — market fear, contrarian buying opportunity?`);
    else if (news.overallSentiment === "MIXED") lines.push(`⚠️ NEWS SIGNAL: Mixed sentiment — conflicting narratives, use other signals for direction`);
    lines.push("");
  }

  if (macro) {
    lines.push(`═══ MACRO INTELLIGENCE (Federal Reserve / FRED) ═══`);
    if (macro.fedFundsRate) lines.push(`Fed Funds Rate: ${sf(macro.fedFundsRate.value, 2)}% (${macro.rateDirection})`);
    if (macro.treasury10Y) lines.push(`10-Year Treasury Yield: ${sf(macro.treasury10Y.value, 2)}%`);
    if (macro.yieldCurve) lines.push(`Yield Curve (10Y-2Y): ${(macro.yieldCurve.value ?? 0) >= 0 ? "+" : ""}${sf(macro.yieldCurve.value, 2)}% ${(macro.yieldCurve.value ?? 0) < 0 ? "⚠️ INVERTED" : ""}`);
    if (macro.cpi) lines.push(`CPI: ${sf(macro.cpi.value, 1)} ${macro.cpi.yoyChange !== null ? `(${(macro.cpi.yoyChange ?? 0) >= 0 ? "+" : ""}${sf(macro.cpi.yoyChange, 1)}% YoY)` : ""}`);
    if (macro.m2MoneySupply) lines.push(`M2 Money Supply: ${macro.m2MoneySupply.yoyChange !== null ? `${(macro.m2MoneySupply.yoyChange ?? 0) >= 0 ? "+" : ""}${sf(macro.m2MoneySupply.yoyChange, 1)}% YoY` : "N/A"} ${(macro.m2MoneySupply.yoyChange ?? 0) > 5 ? "🟢 LIQUIDITY EXPANDING" : (macro.m2MoneySupply.yoyChange ?? 0) < 0 ? "🔴 LIQUIDITY CONTRACTING" : ""}`);
    if (macro.dollarIndex) lines.push(`US Dollar Index: ${sf(macro.dollarIndex.value, 1)} ${(macro.dollarIndex.value ?? 0) > 110 ? "🔴 STRONG (headwind)" : (macro.dollarIndex.value ?? 0) < 100 ? "🟢 WEAK (tailwind)" : ""}`);
    lines.push(`Macro Signal: ${macro.macroSignal}`);

    // Macro signal interpretation
    if (macro.macroSignal === "RISK_ON") lines.push(`🟢 MACRO SIGNAL: Conditions favor risk assets — looser policy, expanding liquidity, or weakening dollar`);
    else if (macro.macroSignal === "RISK_OFF") lines.push(`🔴 MACRO SIGNAL: Conditions headwind for crypto — tightening policy, high yields, or strong dollar`);
    else lines.push(`→ Macro environment neutral — no strong directional bias from macro factors`);

    // v5.1: Cross-Asset Correlation Intelligence
    if (macro.crossAssets) {
      const ca = macro.crossAssets;
      lines.push("");
      lines.push(`═══ CROSS-ASSET CORRELATION (v5.1) ═══`);
      if (ca.goldPrice !== null) {
        lines.push(`Gold (XAU): $${sf(ca.goldPrice, 0)} ${ca.goldChange24h !== null ? `(${ca.goldChange24h >= 0 ? "+" : ""}${sf(ca.goldChange24h, 1)}% 24h)` : ""}`);
      }
      if (ca.oilPrice !== null) {
        lines.push(`Oil (WTI): $${sf(ca.oilPrice, 2)} ${ca.oilChange24h !== null ? `(${ca.oilChange24h >= 0 ? "+" : ""}${sf(ca.oilChange24h, 1)}% 24h)` : ""}`);
      }
      if (ca.vixLevel !== null) {
        lines.push(`VIX: ${sf(ca.vixLevel, 1)} ${ca.vixLevel > 30 ? "⚠️ HIGH FEAR" : ca.vixLevel > 20 ? "↑ Elevated" : ca.vixLevel < 15 ? "🟢 Low (complacent)" : ""}`);
      }
      if (ca.sp500Change !== null) {
        lines.push(`S&P 500: ${ca.sp500Change >= 0 ? "+" : ""}${sf(ca.sp500Change, 1)}% ${ca.sp500Change > 2 ? "🟢 Risk-On Rally" : ca.sp500Change < -2 ? "🔴 Risk-Off Selloff" : ""}`);
      }
      lines.push(`Cross-Asset Signal: ${ca.crossAssetSignal}`);

      // Interpretation for AI
      switch (ca.crossAssetSignal) {
        case "RISK_ON":
          lines.push(`🟢 CROSS-ASSET: Traditional risk assets support crypto upside — gold retreating, equities strong, VIX low`);
          break;
        case "RISK_OFF":
          lines.push(`🔴 CROSS-ASSET: Risk-off in traditional markets — crypto may face headwinds but also creates buying opportunities at lower prices`);
          break;
        case "FLIGHT_TO_SAFETY":
          lines.push(`🚨 CROSS-ASSET: Flight to safety in TradFi — gold surging, VIX spiking. Reduce position sizes but look for oversold crypto entries at panic prices.`);
          break;
        default:
          lines.push(`→ Cross-asset signals mixed — no strong directional bias from traditional markets`);
      }
    }
    lines.push("");
  }

  // ── v10.0: Global Market Intelligence ──
  if (globalMarket) {
    lines.push(`═══ GLOBAL MARKET INTELLIGENCE ═══`);
    lines.push(`BTC Dominance: ${sf(globalMarket.btcDominance, 1)}% | ETH Dominance: ${sf(globalMarket.ethDominance, 1)}%`);
    lines.push(`Total Crypto Market Cap: $${sf((globalMarket.totalMarketCap || 0) / 1e9, 1)}B | 24h Volume: $${sf((globalMarket.totalVolume24h || 0) / 1e9, 1)}B`);
    if (globalMarket.defiMarketCap) lines.push(`DeFi Market Cap: $${sf(globalMarket.defiMarketCap / 1e9, 1)}B`);
    lines.push(`BTC Dominance 7d Change: ${(globalMarket.btcDominanceChange7d ?? 0) >= 0 ? '+' : ''}${sf(globalMarket.btcDominanceChange7d, 2)}pp`);
    switch (globalMarket.altseasonSignal) {
      case 'ALTSEASON_ROTATION':
        lines.push(`🔥 ALTSEASON SIGNAL: BTC dominance dropping >2pp — capital rotating into alts. BOOST AI/Meme allocation, REDUCE Blue Chip.`);
        break;
      case 'BTC_DOMINANCE_FLIGHT':
        lines.push(`⚠️ BTC DOMINANCE FLIGHT: Capital fleeing alts back to BTC. BOOST Blue Chip allocation, REDUCE speculative alts.`);
        break;
      default:
        lines.push(`→ Dominance stable — no strong altseason or BTC flight signal`);
    }
    lines.push('');
  }

  // ── v10.0: Smart Money vs Retail Divergence ──
  if (smartRetailDiv) {
    lines.push(`═══ SMART MONEY vs RETAIL DIVERGENCE ═══`);
    if (smartRetailDiv.btcDivergence !== null) {
      lines.push(`BTC: Smart-Retail divergence = ${smartRetailDiv.btcDivergence >= 0 ? '+' : ''}${sf(smartRetailDiv.btcDivergence, 1)}pp → ${smartRetailDiv.btcSignal}`);
    }
    if (smartRetailDiv.ethDivergence !== null) {
      lines.push(`ETH: Smart-Retail divergence = ${smartRetailDiv.ethDivergence >= 0 ? '+' : ''}${sf(smartRetailDiv.ethDivergence, 1)}pp → ${smartRetailDiv.ethSignal}`);
    }
    if (smartRetailDiv.btcSignal === 'STRONG_BUY' || smartRetailDiv.ethSignal === 'STRONG_BUY') {
      lines.push(`🟢 Smart money is MORE long than retail — institutions see opportunity. High conviction BUY signal.`);
    } else if (smartRetailDiv.btcSignal === 'STRONG_SELL' || smartRetailDiv.ethSignal === 'STRONG_SELL') {
      lines.push(`🔴 Retail is MORE long than smart money — institutions are hedging. High conviction SELL/reduce signal.`);
    } else {
      lines.push(`→ Smart money and retail broadly aligned — no divergence edge`);
    }
    lines.push('');
  }

  // ── v10.0: Funding Rate Mean-Reversion ──
  if (fundingMR) {
    lines.push(`═══ FUNDING RATE MEAN-REVERSION ═══`);
    lines.push(`BTC funding: mean=${sf((fundingMR.btcMean ?? 0) * 100, 4)}% | z-score=${sf(fundingMR.btcZScore, 2)} → ${fundingMR.btcSignal}`);
    lines.push(`ETH funding: mean=${sf((fundingMR.ethMean ?? 0) * 100, 4)}% | z-score=${sf(fundingMR.ethZScore, 2)} → ${fundingMR.ethSignal}`);
    if (fundingMR.btcSignal === 'CROWDED_LONGS_REVERSAL' || fundingMR.ethSignal === 'CROWDED_LONGS_REVERSAL') {
      lines.push(`⚠️ CROWDED LONGS: Funding rates >2σ above mean — leveraged longs are overcrowded. Correction risk elevated. Consider taking profit or hedging.`);
    } else if (fundingMR.btcSignal === 'CROWDED_SHORTS_BOUNCE' || fundingMR.ethSignal === 'CROWDED_SHORTS_BOUNCE') {
      lines.push(`🟢 CROWDED SHORTS: Funding rates >2σ below mean — leveraged shorts overcrowded. Short squeeze likely. BUY opportunity.`);
    } else {
      lines.push(`→ Funding rates within normal range — no mean-reversion signal`);
    }
    lines.push('');
  }

  // ── v10.0: TVL-Price Divergence ──
  if (tvlPriceDiv && Object.keys(tvlPriceDiv.divergences).length > 0) {
    lines.push(`═══ TVL-PRICE DIVERGENCE ═══`);
    const undervalued: string[] = [];
    const overvalued: string[] = [];
    for (const [token, d] of Object.entries(tvlPriceDiv.divergences)) {
      if (d.signal === 'UNDERVALUED') undervalued.push(`${token} (TVL ${(d.tvlChange ?? 0) >= 0 ? '+' : ''}${sf(d.tvlChange, 1)}% / Price ${(d.priceChange ?? 0) >= 0 ? '+' : ''}${sf(d.priceChange, 1)}%)`);
      if (d.signal === 'OVERVALUED') overvalued.push(`${token} (TVL ${(d.tvlChange ?? 0) >= 0 ? '+' : ''}${sf(d.tvlChange, 1)}% / Price ${(d.priceChange ?? 0) >= 0 ? '+' : ''}${sf(d.priceChange, 1)}%)`);
    }
    if (undervalued.length > 0) lines.push(`🟢 UNDERVALUED (TVL up, price flat): ${undervalued.join(', ')}`);
    if (overvalued.length > 0) lines.push(`🔴 OVERVALUED (TVL down, price up): ${overvalued.join(', ')}`);
    if (undervalued.length === 0 && overvalued.length === 0) lines.push(`→ TVL and price broadly aligned — no divergence detected`);
    lines.push('');
  }

  // ── v10.0: Stablecoin Supply / Capital Flow ──
  if (stablecoinData) {
    lines.push(`═══ STABLECOIN SUPPLY / CAPITAL FLOW ═══`);
    lines.push(`Total Stablecoin Supply: $${sf((stablecoinData.totalStablecoinSupply || 0) / 1e9, 1)}B (USDT: $${sf((stablecoinData.usdtMarketCap || 0) / 1e9, 1)}B | USDC: $${sf((stablecoinData.usdcMarketCap || 0) / 1e9, 1)}B)`);
    lines.push(`7-Day Supply Change: ${(stablecoinData.supplyChange7d ?? 0) >= 0 ? '+' : ''}${sf(stablecoinData.supplyChange7d, 2)}%`);
    switch (stablecoinData.signal) {
      case 'CAPITAL_INFLOW':
        lines.push(`🟢 CAPITAL INFLOW: Stablecoin supply growing >2% — fresh capital entering crypto. Bullish for prices.`);
        break;
      case 'CAPITAL_OUTFLOW':
        lines.push(`🔴 CAPITAL OUTFLOW: Stablecoin supply shrinking >2% — capital leaving crypto. Bearish headwind.`);
        break;
      default:
        lines.push(`→ Stablecoin supply stable — no strong capital flow signal`);
    }
    lines.push('');
  }

  lines.push(`═══ MARKET REGIME ═══`);
  lines.push(`Current Regime: ${regime}`);
  switch (regime) {
    case "TRENDING_UP": lines.push(`→ Deploy capital aggressively on dips — ride momentum, let winners run`); break;
    case "TRENDING_DOWN": lines.push(`→ Hunt discounted entries — accumulate oversold tokens, trim only clear losers`); break;
    case "RANGING": lines.push(`→ Active mean-reversion — buy oversold, sell overbought, keep capital working`); break;
    case "VOLATILE": lines.push(`→ Volatility = opportunity — smaller positions, more trades, exploit dislocations`); break;
    default: lines.push(`→ Mixed signals — stay active, look for individual token setups`); break;
  }

  return lines.join("\n");
}

export function formatIndicatorsForPrompt(indicators: Record<string, TechnicalIndicators>, tokens: MarketData["tokens"]): string {
  const lines: string[] = [];

  for (const token of tokens) {
    if (token.symbol === "USDC") continue;
    const ind = indicators[token.symbol];
    if (!ind) continue;

    const parts: string[] = [`${token.symbol}:`];

    if (ind.rsi14 !== null) {
      const rsiLabel = ind.rsi14 < 30 ? "OVERSOLD" : ind.rsi14 > 70 ? "OVERBOUGHT" : "neutral";
      parts.push(`RSI=${ind.rsi14.toFixed(0)}(${rsiLabel})`);
    }

    if (ind.macd) {
      parts.push(`MACD=${ind.macd.signal}`);
    }

    if (ind.bollingerBands) {
      parts.push(`BB%B=${ind.bollingerBands.percentB.toFixed(2)}(${ind.bollingerBands.signal})`);
    }

    // v8.3: ATR volatility measure
    if (ind.atrPercent !== null) {
      const atrLabel = ind.atrPercent > 5 ? "HIGH_VOL" : ind.atrPercent > 3 ? "MODERATE" : ind.atrPercent > 1 ? "NORMAL" : "LOW_VOL";
      parts.push(`ATR=${ind.atrPercent.toFixed(1)}%(${atrLabel})`);
    }

    // v8.3: ADX trend strength
    if (ind.adx14) {
      const dirLabel = ind.adx14.plusDI > ind.adx14.minusDI ? "+DI>-DI" : "-DI>+DI";
      parts.push(`ADX=${ind.adx14.adx.toFixed(0)}(${ind.adx14.trend},${dirLabel})`);
    }

    parts.push(`Trend=${ind.trendDirection}`);

    if (ind.volumeChange24h !== null) {
      parts.push(`Vol=${ind.volumeChange24h > 0 ? "+" : ""}${ind.volumeChange24h.toFixed(0)}%vs7dAvg`);
    }

    // v12.3: On-chain order flow intelligence
    if (ind.twapDivergence) {
      parts.push(`TWAP=${ind.twapDivergence.divergencePct > 0 ? "+" : ""}${ind.twapDivergence.divergencePct.toFixed(1)}%(${ind.twapDivergence.signal})`);
    }
    if (ind.orderFlow) {
      const netStr = ind.orderFlow.netBuyVolumeUSD >= 0 ? `+$${(ind.orderFlow.netBuyVolumeUSD / 1000).toFixed(1)}K` : `-$${(Math.abs(ind.orderFlow.netBuyVolumeUSD) / 1000).toFixed(1)}K`;
      const buyPct = Math.round((ind.orderFlow.buyVolumeUSD / (ind.orderFlow.buyVolumeUSD + ind.orderFlow.sellVolumeUSD || 1)) * 100);
      parts.push(`Flow=${ind.orderFlow.signal}(net${netStr},${buyPct}%buy,${ind.orderFlow.largeBuyPct}%lg)`);
    }
    if (ind.tickDepth) {
      parts.push(`Depth=${ind.tickDepth.signal}(bid/ask=${ind.tickDepth.depthRatio.toFixed(1)})`);
    }

    parts.push(`Signal=${ind.overallSignal}(${ind.confluenceScore > 0 ? "+" : ""}${ind.confluenceScore})`);

    lines.push(`  ${parts.join(" | ")}`);
  }

  // v12.3: Add on-chain flow summary for tokens with strongest signals
  const flowSummary: string[] = [];
  const depthSummary: string[] = [];
  for (const token of tokens) {
    if (token.symbol === "USDC") continue;
    const ind = indicators[token.symbol];
    if (!ind) continue;
    if (ind.orderFlow && ind.orderFlow.signal !== "NEUTRAL") {
      const buyPct = Math.round((ind.orderFlow.buyVolumeUSD / (ind.orderFlow.buyVolumeUSD + ind.orderFlow.sellVolumeUSD || 1)) * 100);
      const netStr = ind.orderFlow.netBuyVolumeUSD >= 0 ? `$${(ind.orderFlow.netBuyVolumeUSD / 1000).toFixed(1)}K net` : `-$${(Math.abs(ind.orderFlow.netBuyVolumeUSD) / 1000).toFixed(1)}K net`;
      const desc = (ind.orderFlow.signal === "STRONG_BUY" || ind.orderFlow.signal === "BUY")
        ? `${token.symbol} buy pressure (${buyPct}% buys, ${netStr})`
        : `${token.symbol} selling (${buyPct}% buys, ${netStr})`;
      flowSummary.push(desc);
    }
    if (ind.tickDepth && ind.tickDepth.signal !== "BALANCED") {
      depthSummary.push(`${token.symbol} ${ind.tickDepth.signal.toLowerCase().replace('_', ' ')} (${ind.tickDepth.depthRatio.toFixed(1)}x ratio)`);
    }
  }
  if (flowSummary.length > 0) {
    lines.push(`  📊 ON-CHAIN FLOW: ${flowSummary.slice(0, 4).join(", ")}`);
  }
  if (depthSummary.length > 0) {
    lines.push(`  📊 LIQUIDITY: ${depthSummary.slice(0, 4).join(", ")}`);
  }

  return lines.join("\n");
}
