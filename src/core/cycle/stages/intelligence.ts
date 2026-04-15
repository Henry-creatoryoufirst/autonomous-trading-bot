/**
 * Never Rest Capital — Cycle Stage: INTELLIGENCE
 *
 * Phase 5c extraction. Covers agent-v3.2.ts lines 6136–6362:
 * macro regime check, capital preservation update, volume spike detection,
 * DEX intelligence aggregation (GeckoTerminal + DexScreener merge),
 * on-chain flow recording, and self-improvement (performance review +
 * strategy pattern analysis + threshold adaptation).
 *
 * Design: the stage accepts an IntelligenceDeps bundle that boxes every
 * module-level read and write as typed accessors. This keeps the stage
 * fully testable — tests only need to mock the deps, never the module.
 *
 * Pure helpers exported for unit tests:
 *   computeVolumeSpikes()     — pure, given tokens + indicators + threshold
 *   mergeDexScreenerIntoIntel() — pure, given dexIntel + txn cache
 *   signalFromTxnRatios()     — pure, given buy ratios
 */

import type { CycleContext } from '../../types/cycle.js';
import type { MarketData } from '../../types/market-data.js';
import type { DexIntelligence, BuySellPressure } from '../../services/gecko-terminal.js';
import type { FlowTimeframeState } from '../../services/flow-timeframes.js';

// ============================================================================
// PUBLIC TYPES
// ============================================================================

export type BuySellSignal = 'STRONG_BUY' | 'BUY_PRESSURE' | 'NEUTRAL' | 'SELL_PRESSURE' | 'STRONG_SELL';

export interface VolumeSpike {
  symbol: string;
  volumeChange: number;
}

export type MacroRegime = 'BULL' | 'RANGING' | 'BEAR';

export interface SignalIntel {
  regime: MacroRegime;
  score: number;
  fearGreed: number;
  btcDominance: number;
  btcDominanceTrend: number | null;
  btcPrice: number;
  inBearMode: boolean;
  consecutiveBearChecks: number;
  stale: boolean;
  ageSec: number;
}

export interface PerformanceReview {
  insights: unknown[];
  recommendations: unknown[];
  [key: string]: unknown;
}

export type DexScreenerTxnEntry = {
  h1Buys: number;
  h1Sells: number;
  h24Buys: number;
  h24Sells: number;
  h1Buyers: number;
  h1Sellers: number;
  updatedAt: number;
};

// ============================================================================
// MACRO STATE — boxes the 4 module-level vars the regime section writes to
// ============================================================================

export interface IntelligenceMacroState {
  /** Read: current F&G value (from previous cycle or signal service). */
  getLastFearGreedValue(): number;
  /** Write: signal service overrides F&G with fresher value. */
  setLastFearGreedValue(v: number): void;

  /** Read: consecutive BEAR checks (0–10). */
  getConsecutiveBearChecks(): number;
  /** Write: signal service / local logic update. */
  setConsecutiveBearChecks(v: number): void;

  /** Write: store resolved macro regime for downstream stages. */
  setCurrentMacroRegime(v: { regime: MacroRegime; score: number }): void;

  /** Read: rolling BTC dominance buffer (last 1344 points ≈ 14 days at 15-min cycles). */
  getBtcDominanceBuffer(): number[];
  /** Write: push new dominance reading, trim to 1344. */
  pushBtcDominance(v: number): void;
}

// ============================================================================
// INTEL STATE — boxes module-level vars the DEX intel section writes to
// ============================================================================

export interface IntelligenceIntelState {
  /** Read: last DEX intelligence snapshot (may be null on first cycle). */
  getDexIntelligence(): DexIntelligence | null;
  /** Write: replace DEX intelligence snapshot. */
  setDexIntelligence(v: DexIntelligence | null): void;

  /** Read: how many times DEX intel has been fetched. */
  getDexIntelFetchCount(): number;
  /** Write: increment on each successful fetch. */
  incrementDexIntelFetchCount(): void;

  /** Read: DexScreener per-token txn cache (background-updated every 10s). */
  getDexScreenerTxnCache(): Record<string, DexScreenerTxnEntry>;

  /** Write: update last-cycle volume snapshot for opportunity-cost tracking. */
  setLastVolumeSnapshot(v: Map<string, number>): void;

  /** Write: update global intelligence data exposed on the health API endpoint. */
  setLastIntelligenceData(v: Record<string, unknown>): void;
}

// ============================================================================
// DEPS — everything the stage needs that is NOT already on ctx
// ============================================================================

export interface IntelligenceDeps {
  // ── Macro regime ──────────────────────────────────────────────────────────
  /** Fetch centralized macro regime from the NVR Signal Service (2.5s timeout). */
  fetchSignalIntel(): Promise<SignalIntel | null>;
  /** Read cached BTC price history for the local macro regime fallback. */
  getCachedPriceHistory(symbol: string): { prices: number[] };
  /** Compute macro regime from BTC prices + dominance trend + F&G. */
  computeMacroRegime(
    btcPrices: number[],
    btcDominanceTrend: number | undefined,
    fearGreedValue: number,
  ): { regime: MacroRegime; score: number };
  /** Update capital-preservation mode based on current F&G. */
  updateCapitalPreservationMode(fearGreedValue: number): void;

  // ── Module-level state boxes ──────────────────────────────────────────────
  macroState: IntelligenceMacroState;
  intelState: IntelligenceIntelState;
  flowTimeframeState: FlowTimeframeState;
  /** Record a buy-ratio reading into the multi-timeframe flow state. */
  recordFlowReading(
    state: FlowTimeframeState,
    symbol: string,
    buyRatioPct: number,
  ): void;

  // ── DEX intelligence fetch ────────────────────────────────────────────────
  /** Fetch live DEX intelligence snapshot from GeckoTerminal. */
  fetchDexIntelligence(): Promise<DexIntelligence>;

  // ── Dust consolidation ────────────────────────────────────────────────────
  /** Consolidate dust positions every 10 heavy cycles (side-effect only). */
  consolidateDustPositions(
    balances: CycleContext['balances'],
    marketData: MarketData,
  ): Promise<void>;

  /** Returns performance metrics snapshot for the intelligence API endpoint. */
  calculateTradePerformance(): Record<string, unknown>;

  // ── Self-improvement ──────────────────────────────────────────────────────
  /** Run performance review (insights + recommendations). */
  runPerformanceReview(reason: 'TRADE_COUNT' | 'TIME_ELAPSED'): PerformanceReview;
  /** Adapt thresholds based on review findings. */
  adaptThresholds(review: PerformanceReview, regime: string): void;
  /** Analyze and persist strategy patterns. */
  analyzeStrategyPatterns(): void;

  // ── Constants ─────────────────────────────────────────────────────────────
  volumeSpikeThreshold: number;
}

// ============================================================================
// PURE HELPERS (exported for unit tests)
// ============================================================================

/**
 * Compute volume spikes from market data.
 *
 * A spike is defined as:
 *   1 + (volumeChange24h / 100) >= threshold
 *
 * Returns an array of { symbol, volumeChange } for tokens that qualify.
 */
export function computeVolumeSpikes(
  tokens: MarketData['tokens'],
  indicators: MarketData['indicators'],
  threshold: number,
): VolumeSpike[] {
  const spikes: VolumeSpike[] = [];
  for (const token of tokens) {
    const ind = indicators[token.symbol];
    if (ind?.volumeChange24h !== null && ind?.volumeChange24h !== undefined) {
      const volumeMultiple = 1 + (ind.volumeChange24h / 100);
      if (volumeMultiple >= threshold) {
        spikes.push({ symbol: token.symbol, volumeChange: ind.volumeChange24h });
      }
    }
  }
  return spikes;
}

/**
 * Derive a buy/sell signal from 1h and 24h buy ratios.
 *
 * Thresholds match agent-v3.2.ts lines 6246–6250 exactly.
 */
export function signalFromTxnRatios(
  buyRatioH1: number,
  buyRatioH24: number,
): BuySellSignal {
  if (buyRatioH1 > 0.65 && buyRatioH24 > 0.55) return 'STRONG_BUY';
  if (buyRatioH1 > 0.55) return 'BUY_PRESSURE';
  if (buyRatioH1 < 0.35 && buyRatioH24 < 0.45) return 'STRONG_SELL';
  if (buyRatioH1 < 0.45) return 'SELL_PRESSURE';
  return 'NEUTRAL';
}

/**
 * Merge DexScreener txn-cache entries into an existing DexIntelligence snapshot.
 *
 * GeckoTerminal covers ~7 tokens via rotation; DexScreener covers all 24 tokens
 * via background polling. This merge fills coverage gaps.
 *
 * Rules:
 *   - Skip any symbol GeckoTerminal already covered.
 *   - Skip entries > 120s stale.
 *   - Skip entries with < 5 h1 or < 20 h24 transactions (too low activity).
 *
 * Returns a NEW buySellPressure array (does not mutate the input).
 */
export function mergeDexScreenerIntoIntel(
  existing: BuySellPressure[],
  txnCache: Record<string, DexScreenerTxnEntry>,
  now: number = Date.now(),
): BuySellPressure[] {
  const geckoSymbols = new Set(existing.map(p => p.symbol));
  const merged: BuySellPressure[] = [...existing];

  for (const [sym, txn] of Object.entries(txnCache)) {
    if (geckoSymbols.has(sym)) continue;
    if (now - txn.updatedAt > 120_000) continue;

    const totalH1 = txn.h1Buys + txn.h1Sells;
    const totalH24 = txn.h24Buys + txn.h24Sells;
    if (totalH1 < 5 && totalH24 < 20) continue;

    const buyRatioH1  = totalH1  > 0 ? txn.h1Buys  / totalH1  : 0.5;
    const buyRatioH24 = totalH24 > 0 ? txn.h24Buys / totalH24 : 0.5;

    merged.push({
      symbol: sym,
      h1Buys:    txn.h1Buys,
      h1Sells:   txn.h1Sells,
      h1Buyers:  txn.h1Buyers,
      h1Sellers: txn.h1Sellers,
      h24Buys:   txn.h24Buys,
      h24Sells:  txn.h24Sells,
      buyRatioH1:  Math.round(buyRatioH1  * 100) / 100,
      buyRatioH24: Math.round(buyRatioH24 * 100) / 100,
      signal:    signalFromTxnRatios(buyRatioH1, buyRatioH24),
    });
  }

  return merged;
}

/**
 * Build a DexIntelligence snapshot entirely from the DexScreener txn cache.
 * Used when GeckoTerminal fails completely.
 *
 * Returns null if the txn cache is empty or all entries are stale.
 */
export function buildDexIntelFromDexScreener(
  txnCache: Record<string, DexScreenerTxnEntry>,
  now: number = Date.now(),
): DexIntelligence | null {
  const buySellPressure: BuySellPressure[] = [];

  for (const [sym, txn] of Object.entries(txnCache)) {
    if (now - txn.updatedAt > 120_000) continue;
    const totalH1  = txn.h1Buys + txn.h1Sells;
    const totalH24 = txn.h24Buys + txn.h24Sells;
    if (totalH1 < 5 && totalH24 < 20) continue;

    const buyRatioH1  = totalH1  > 0 ? txn.h1Buys  / totalH1  : 0.5;
    const buyRatioH24 = totalH24 > 0 ? txn.h24Buys / totalH24 : 0.5;

    buySellPressure.push({
      symbol:    sym,
      h1Buys:    txn.h1Buys,
      h1Sells:   txn.h1Sells,
      h1Buyers:  txn.h1Buyers,
      h1Sellers: txn.h1Sellers,
      h24Buys:   txn.h24Buys,
      h24Sells:  txn.h24Sells,
      buyRatioH1:  Math.round(buyRatioH1  * 100) / 100,
      buyRatioH24: Math.round(buyRatioH24 * 100) / 100,
      signal:    signalFromTxnRatios(buyRatioH1, buyRatioH24),
    });
  }

  if (buySellPressure.length === 0) return null;

  return {
    trendingPools: [],
    tokenMetrics:  [],
    volumeSpikes:  [],
    buySellPressure,
    newPools:      [],
    aiSummary:     '',
    timestamp:     new Date(now).toISOString(),
    errors:        ['GeckoTerminal failed — using DexScreener txn cache'],
  };
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * INTELLIGENCE stage — market context enrichment.
 *
 * Runs after SETUP. Does NOT block on failures — every sub-section has its own
 * try/catch so a GeckoTerminal outage doesn't halt the cycle.
 *
 * On success: ctx.stagesCompleted gains 'INTELLIGENCE'; module-level state
 * updated via deps.macroState / deps.intelState / deps.flowTimeframeState.
 */
export async function intelligenceStage(
  ctx: CycleContext,
  deps: IntelligenceDeps,
): Promise<CycleContext> {
  if (!ctx.marketData) {
    // SETUP didn't populate marketData — should never happen (SETUP would have halted)
    ctx.stagesCompleted.push('INTELLIGENCE');
    return ctx;
  }

  const { marketData } = ctx;
  const { macroState, intelState } = deps;

  // ── Macro regime (mirrors L6136–6176) ─────────────────────────────────────
  {
    const signalIntel = await deps.fetchSignalIntel();

    if (signalIntel) {
      // PATH A: Signal Service — authoritative centralised data
      macroState.setLastFearGreedValue(signalIntel.fearGreed);
      macroState.setConsecutiveBearChecks(signalIntel.consecutiveBearChecks);
      macroState.setCurrentMacroRegime({ regime: signalIntel.regime, score: signalIntel.score });
      const inBearMode = signalIntel.inBearMode;
      console.log(
        `🛰️  Regime from Signal Service: ${signalIntel.regime} (score: ${signalIntel.score}, ` +
        `age: ${signalIntel.ageSec}s, bearChecks: ${signalIntel.consecutiveBearChecks}/3)` +
        `${inBearMode ? ' 🐻 BEAR MODE ACTIVE' : ''}`,
      );
    } else {
      // PATH B: Local fallback — BTC prices + dominance buffer + F&G
      const btcCurrentDominance = marketData.globalMarket?.btcDominance || 0;
      if (btcCurrentDominance > 0) {
        macroState.pushBtcDominance(btcCurrentDominance);
      }

      const buf = macroState.getBtcDominanceBuffer();
      let btcDominanceTrend: number | undefined;
      if (buf.length >= 96) {
        const lookback = Math.min(672, buf.length - 1);
        const oldDominance = buf[buf.length - 1 - lookback];
        if (oldDominance > 0) btcDominanceTrend = btcCurrentDominance - oldDominance;
      }

      const btcPrices = deps.getCachedPriceHistory('cbBTC').prices;
      if (btcPrices.length >= 50) {
        const fng = macroState.getLastFearGreedValue();
        const regimeResult = deps.computeMacroRegime(btcPrices, btcDominanceTrend, fng);
        const prevBearChecks = macroState.getConsecutiveBearChecks();
        const newBearChecks = regimeResult.regime === 'BEAR'
          ? Math.min(prevBearChecks + 1, 10)
          : 0;
        macroState.setConsecutiveBearChecks(newBearChecks);
        macroState.setCurrentMacroRegime({ regime: regimeResult.regime, score: regimeResult.score });
        const inBearMode = newBearChecks >= 3;
        const domStr = btcDominanceTrend !== undefined
          ? btcDominanceTrend.toFixed(1) + 'pp'
          : 'n/a';
        console.log(
          `🔭 Regime (local fallback): ${regimeResult.regime} (score: ${regimeResult.score}, ` +
          `F&G: ${fng}, dom: ${domStr}, bearChecks: ${newBearChecks}/3)` +
          `${inBearMode ? ' 🐻 BEAR MODE ACTIVE' : ''}`,
        );
      }
    }
  }

  // ── Capital preservation mode (mirrors L6178–6179) ─────────────────────────
  deps.updateCapitalPreservationMode(marketData.fearGreed.value);

  // ── Volume spikes (mirrors L6181–6195) ────────────────────────────────────
  const volumeSpikes = computeVolumeSpikes(
    marketData.tokens,
    marketData.indicators,
    deps.volumeSpikeThreshold,
  );
  if (volumeSpikes.length > 0) {
    console.log(
      `  📊 VOLUME SPIKES (≥${deps.volumeSpikeThreshold}x 7d avg): ` +
      volumeSpikes.map(v => `${v.symbol} +${v.volumeChange.toFixed(0)}%`).join(', '),
    );
  }
  intelState.setLastVolumeSnapshot(new Map(marketData.tokens.map(t => [t.symbol, t.volume24h])));

  // ── Dust consolidation (mirrors L6197–6200) ───────────────────────────────
  const state = ctx.services.stateManager.getState();
  if (state.totalCycles % 10 === 1) {
    await deps.consolidateDustPositions(ctx.balances, marketData);
  }

  // ── Intelligence API cache (mirrors L6202–6216) ───────────────────────────
  intelState.setLastIntelligenceData({
    defi:                  marketData.defiLlama,
    derivatives:           marketData.derivatives,
    news:                  marketData.newsSentiment,
    macro:                 marketData.macroData,
    regime:                marketData.marketRegime,
    performance:           deps.calculateTradePerformance(),
    globalMarket:          marketData.globalMarket,
    smartRetailDivergence: marketData.smartRetailDivergence,
    fundingMeanReversion:  marketData.fundingMeanReversion,
    tvlPriceDivergence:    marketData.tvlPriceDivergence,
    stablecoinSupply:      marketData.stablecoinSupply,
  });

  // ── DEX intelligence (mirrors L6218–6302) ────────────────────────────────
  let dexIntel: DexIntelligence | null = null;
  try {
    console.log('🦎 Fetching DEX intelligence (GeckoTerminal)...');
    dexIntel = await deps.fetchDexIntelligence();
    intelState.setDexIntelligence(dexIntel);
    intelState.incrementDexIntelFetchCount();
    const spikes   = dexIntel.volumeSpikes.length;
    const pressure = dexIntel.buySellPressure.filter(p => p.signal !== 'NEUTRAL').length;
    console.log(
      `  ✅ DEX intel: ${dexIntel.tokenMetrics.length} tokens | ${spikes} volume spikes | ` +
      `${pressure} pressure signals | ${dexIntel.errors.length} errors`,
    );
  } catch (dexErr: unknown) {
    const msg = dexErr instanceof Error ? dexErr.message : String(dexErr);
    console.warn(`  ⚠️ DEX intelligence fetch failed: ${msg.substring(0, 150)} — continuing without`);
  }

  // Merge DexScreener into DEX intel (covers tokens GeckoTerminal missed)
  const txnCache = intelState.getDexScreenerTxnCache();
  if (dexIntel) {
    const mergedPressure = mergeDexScreenerIntoIntel(dexIntel.buySellPressure, txnCache);
    const added = mergedPressure.length - dexIntel.buySellPressure.length;
    if (added > 0) {
      dexIntel = { ...dexIntel, buySellPressure: mergedPressure };
      intelState.setDexIntelligence(dexIntel);
      console.log(
        `  📡 Flow coverage: ${dexIntel.buySellPressure.length - added} GeckoTerminal + ` +
        `${added} DexScreener = ${dexIntel.buySellPressure.length} total tokens with flow data`,
      );
    }
  } else {
    // GeckoTerminal totally failed — try DexScreener-only fallback
    const fallback = buildDexIntelFromDexScreener(txnCache);
    if (fallback) {
      intelState.setDexIntelligence(fallback);
      dexIntel = fallback;
      console.log(
        `  📡 Flow coverage: 0 GeckoTerminal (failed) + ` +
        `${fallback.buySellPressure.length} DexScreener = ${fallback.buySellPressure.length} total`,
      );
    }
  }

  // ── Flow readings (mirrors L6304–6321) ───────────────────────────────────
  const resolvedDexIntel = intelState.getDexIntelligence();
  if (resolvedDexIntel) {
    for (const pressure of resolvedDexIntel.buySellPressure) {
      if (pressure.buyRatioH1 !== undefined) {
        deps.recordFlowReading(deps.flowTimeframeState, pressure.symbol, pressure.buyRatioH1 * 100);
      }
    }
  }
  // On-chain order flow (higher fidelity, available for some tokens)
  for (const [symbol, ind] of Object.entries(marketData.indicators)) {
    if (ind?.orderFlow) {
      const totalFlow = ind.orderFlow.buyVolumeUSD + ind.orderFlow.sellVolumeUSD;
      if (totalFlow > 0) {
        deps.recordFlowReading(
          deps.flowTimeframeState,
          symbol,
          (ind.orderFlow.buyVolumeUSD / totalFlow) * 100,
        );
      }
    }
  }

  // ── Performance review (mirrors L6323–6362) ───────────────────────────────
  const tradesSinceReview = state.tradeHistory.length - state.lastReviewTradeIndex;
  const hoursSinceReview  = state.lastReviewTimestamp
    ? (Date.now() - new Date(state.lastReviewTimestamp).getTime()) / (1000 * 60 * 60)
    : 999;

  if (tradesSinceReview >= 10 || hoursSinceReview >= 24) {
    const reason = tradesSinceReview >= 10 ? 'TRADE_COUNT' as const : 'TIME_ELAPSED' as const;
    console.log(`\n🧪 SELF-IMPROVEMENT: Running performance review (${reason})...`);
    const review = deps.runPerformanceReview(reason);
    console.log(
      `   Generated ${(review.insights as unknown[]).length} insights, ` +
      `${(review.recommendations as unknown[]).length} recommendations`,
    );

    // Write review into state via stateManager
    const mutableState = ctx.services.stateManager.getState() as any;
    mutableState.performanceReviews.push(review);
    if (mutableState.performanceReviews.length > 30) {
      mutableState.performanceReviews = mutableState.performanceReviews.slice(-30);
    }
    mutableState.lastReviewTradeIndex = state.tradeHistory.length;
    mutableState.lastReviewTimestamp  = new Date().toISOString();

    deps.adaptThresholds(review, marketData.marketRegime);
    console.log(
      `   Thresholds adapted (${mutableState.adaptiveThresholds?.adaptationCount ?? 0} total adaptations)`,
    );
    ctx.services.stateManager.markDirty();
    console.log(
      `   Review #${mutableState.performanceReviews.length} stored | ` +
      `Next review after ${mutableState.lastReviewTradeIndex + 10} trades or 24h`,
    );
  }

  // Strategy pattern rebuild (mirrors L6354–6362)
  if (state.tradeHistory.length > 0 && (state.totalCycles <= 1 || state.totalCycles % 50 === 0)) {
    console.log(
      `\n🧬 SELF-IMPROVEMENT: Building strategy pattern memory from ${state.tradeHistory.length} trades...`,
    );
    deps.analyzeStrategyPatterns();
    const mutableState = ctx.services.stateManager.getState() as any;
    const validPatterns = Object.values(mutableState.strategyPatterns ?? {}).filter(
      (p: any) => !p.patternId?.startsWith('UNKNOWN'),
    );
    console.log(
      `   Identified ${Object.keys(mutableState.strategyPatterns ?? {}).length} patterns ` +
      `(${validPatterns.length} with signal data)`,
    );
    ctx.services.stateManager.markDirty();
  }

  ctx.stagesCompleted.push('INTELLIGENCE');
  return ctx;
}
