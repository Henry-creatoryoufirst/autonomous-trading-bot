/**
 * Never Rest Capital — Cycle Integration Simulation
 *
 * Phase 7+ of the monolith refactor. Validates that the full 11-stage
 * runHeavyCycle pipeline runs end-to-end using a Bot instance and mock deps.
 *
 * This is NOT a backtester — it doesn't simulate multiple price candles or
 * measure strategy P&L. The strategy backtester lives in src/simulation/.
 *
 * Purpose:
 *   1. Prove all 11 stages complete with real types (integration, not unit tests)
 *   2. Serve as a CI gate — `npx tsx scripts/simulate-cycle.ts` must pass
 *   3. Detect regressions when new stages are extracted or wired
 *
 * Expected stages on completion:
 *   SETUP → INTELLIGENCE → METRICS → AI_DECISION →
 *   PRESERVATION → DIRECTIVES → TRADE_CAP → RISK_REWARD →
 *   EXECUTION → REPORTING → SCHEDULING
 *
 * Usage (standalone):
 *   npx tsx src/core/simulation/simulate-cycle.ts
 *
 * Or via scripts:
 *   npx tsx scripts/simulate-cycle.ts
 */

import { createBot } from '../bot/bot-factory.js';
import type { BotConfig } from '../bot/bot-config.js';
import { runHeavyCycle } from '../cycle/heavy-cycle.js';
import type { HeavyCycleDeps } from '../cycle/heavy-cycle.js';
import type { CycleContext, CycleServices } from '../types/cycle.js';
import type { MarketData } from '../types/market-data.js';
import type { SetupDeps } from '../cycle/stages/setup.js';
import type { IntelligenceDeps } from '../cycle/stages/intelligence.js';
import type { MetricsDeps } from '../cycle/stages/metrics.js';

// ============================================================================
// EXPECTED STAGES — full 8-stage pipeline
// ============================================================================

export const EXPECTED_STAGES = [
  'SETUP',
  'INTELLIGENCE',
  'METRICS',
  'AI_DECISION',
  'PRESERVATION',  // Phase 5f: filtersStage pushes 4 real stage names
  'DIRECTIVES',
  'TRADE_CAP',
  'RISK_REWARD',
  'EXECUTION',
  'REPORTING',
  'SCHEDULING',
] as const;

// ============================================================================
// MOCK MARKET DATA
// ============================================================================

export function makeMockMarketData(overrides: Partial<MarketData> = {}): MarketData {
  return {
    tokens: [
      { symbol: 'ETH',  price: 3000,  priceChange24h: 1.5, priceChange7d: 5, volume24h: 1e9, marketCap: 3e11, sector: 'BLUE_CHIP', name: 'Ethereum' },
      { symbol: 'BTC',  price: 65000, priceChange24h: 0.5, priceChange7d: 3, volume24h: 2e9, marketCap: 1e12, sector: 'BLUE_CHIP', name: 'Bitcoin' },
      { symbol: 'USDC', price: 1,     priceChange24h: 0,   priceChange7d: 0, volume24h: 5e8, marketCap: 4e10, sector: 'STABLE',    name: 'USD Coin' },
    ],
    fearGreed:      { value: 55, classification: 'Greed' },
    trendingTokens: ['ETH'],
    indicators: {
      ETH: {
        rsi14: 58, macd: { value: 10, signal: 'BUY' },
        bollingerBands: { signal: 'NEUTRAL', upper: 3200, lower: 2800, middle: 3000 },
        trendDirection: 'UP', confluenceScore: 25, overallSignal: 'BUY',
        volumeChange24h: 50, orderFlow: null,
      } as any,
      BTC: {
        rsi14: 55, macd: null, bollingerBands: null,
        trendDirection: 'UP', confluenceScore: 15, overallSignal: 'HOLD',
        volumeChange24h: 120, orderFlow: null,
      } as any,
    },
    marketRegime: 'BULL',
    timestamp:    Date.now(),
    ...overrides,
  } as MarketData;
}

// ============================================================================
// MOCK CYCLE SERVICES
// ============================================================================

export function makeMockServices(bot: ReturnType<typeof createBot>): CycleServices {
  return {
    stateManager: bot.getStateManager(),
    telegram: {
      sendAlert:                 async () => false,
      onCircuitBreakerTriggered: async () => {},
      onTradeResult:             async () => {},
    },
    cache: {
      invalidate: () => {},
      getStats:   () => ({ hits: 0, misses: 0, hitRate: 0 }),
    },
    cooldown: {
      getActiveCount: () => 0,
      setRawCooldown: () => {},
    },
  };
}

// ============================================================================
// MOCK HEAVY CYCLE DEPS
// ============================================================================

function makeMockSetupDeps(md: MarketData): SetupDeps {
  return {
    getBalances:   async () => [
      { symbol: 'USDC', balance: 500, usdValue: 500 },
      { symbol: 'ETH',  balance: 0.1, usdValue: 300, price: 3000 },
    ],
    getMarketData: async () => md,
  };
}

function makeMockIntelligenceDeps(): IntelligenceDeps {
  let _fearGreed = 55;
  let _bearChecks = 0;
  const _btcBuf: number[] = [];
  let _dexIntel: any = null;
  let _dexFetchCount = 0;

  return {
    fetchSignalIntel:          async () => null,
    getCachedPriceHistory:     () => ({ prices: [] }),
    computeMacroRegime:        () => ({ regime: 'BULL' as const, score: 60 }),
    updateCapitalPreservationMode: () => {},
    macroState: {
      getLastFearGreedValue:    () => _fearGreed,
      setLastFearGreedValue:    (v: number) => { _fearGreed = v; },
      getConsecutiveBearChecks: () => _bearChecks,
      setConsecutiveBearChecks: (v: number) => { _bearChecks = v; },
      setCurrentMacroRegime:    () => {},
      getBtcDominanceBuffer:    () => _btcBuf,
      pushBtcDominance:         (v: number) => { _btcBuf.push(v); },
    },
    intelState: {
      getDexIntelligence:          () => _dexIntel,
      setDexIntelligence:          (v: any) => { _dexIntel = v; },
      getDexIntelFetchCount:       () => _dexFetchCount,
      incrementDexIntelFetchCount: () => { _dexFetchCount++; },
      getDexScreenerTxnCache:      () => ({} as any),
      setLastVolumeSnapshot:       () => {},
      setLastIntelligenceData:     () => {},
    },
    flowTimeframeState:        { readings: {} } as any,
    recordFlowReading:         () => {},
    fetchDexIntelligence:      async () => { throw new Error('GeckoTerminal offline (sim)'); },
    consolidateDustPositions:  async () => {},
    calculateTradePerformance: () => ({}),
    runPerformanceReview:      () => ({ insights: [], recommendations: [] }),
    adaptThresholds:           () => {},
    analyzeStrategyPatterns:   () => {},
    volumeSpikeThreshold:      2.0,
  };
}

function makeMockMetricsDeps(bot: ReturnType<typeof createBot>): MetricsDeps {
  return {
    getState:       () => bot.getStateManager().getState() as any,
    getBreakerState: () => bot.getStateManager().getBreakerState() as any,
    calculateSectorAllocations: () => [],
    updateUnrealizedPnL:        () => {},
    calculateRiskRewardMetrics: () => ({
      avgWinUSD:       0,
      avgLossUSD:      0,
      riskRewardRatio: 0,
      largestWin:      0,
      largestLoss:     0,
      expectancy:      0,
      profitFactor:    0,
    }),
  };
}

export function makeMockHeavyCycleDeps(
  bot: ReturnType<typeof createBot>,
  md: MarketData,
): HeavyCycleDeps {
  return {
    setup:        makeMockSetupDeps(md),
    intelligence: makeMockIntelligenceDeps(),
    metrics:      makeMockMetricsDeps(bot),
  };
}

// ============================================================================
// SIMULATE ONE CYCLE
// ============================================================================

export interface CycleSimResult {
  botId:           string;
  cycleNumber:     number;
  stagesCompleted: string[];
  currentPrices:   Record<string, number>;
  marketData:      MarketData | undefined;
  halted:          boolean;
  haltReason:      string | undefined;
  durationMs:      number;
}

/**
 * Run a single simulated heavy cycle for one bot via runHeavyCycle().
 *
 * Exercises all 8 stages end-to-end with mock deps. Execution stage is a
 * safe stub — no real trades are placed. The 48h paper-trade soak gate
 * (Phase 5h) governs when real execution is wired in.
 */
export async function simulateCycle(
  bot: ReturnType<typeof createBot>,
  marketData?: MarketData,
): Promise<CycleSimResult> {
  const start = Date.now();
  const md    = marketData ?? makeMockMarketData();

  // Increment cycle counter (mirrors agent-v3.2.ts state.totalCycles++)
  const state = bot.getStateManager().getState() as any;
  state.totalCycles = (state.totalCycles || 0) + 1;

  // Build initial CycleContext
  const ctx: CycleContext = {
    cycleNumber:     state.totalCycles,
    isHeavy:         true,
    trigger:         'SCHEDULED',
    startedAt:       start,
    balances:        [],
    currentPrices:   {},
    decisions:       [],
    tradeResults:    [],
    halted:          false,
    stagesCompleted: [],
    services:        makeMockServices(bot),
  };

  // Run the full 8-stage pipeline
  const finalCtx = await runHeavyCycle(ctx, makeMockHeavyCycleDeps(bot, md));

  return {
    botId:           bot.botId,
    cycleNumber:     state.totalCycles,
    stagesCompleted: finalCtx.stagesCompleted,
    currentPrices:   finalCtx.currentPrices,
    marketData:      finalCtx.marketData,
    halted:          finalCtx.halted,
    haltReason:      finalCtx.haltReason,
    durationMs:      Date.now() - start,
  };
}

// ============================================================================
// SIMULATE FLEET
// ============================================================================

export interface FleetSimResult {
  bots:            CycleSimResult[];
  totalDurationMs: number;
  allPassed:       boolean;
  failures:        string[];
}

/**
 * Simulate one cycle for a fleet of bots in parallel.
 *
 * Verifies isolation: each bot should have its own cycle counter,
 * prices, and stage completions with no cross-contamination.
 */
export async function simulateFleet(
  configs: BotConfig[],
  marketData?: MarketData,
): Promise<FleetSimResult> {
  const start = Date.now();
  const bots  = configs.map(c => createBot(c));

  // Run all bots in parallel (mirrors fleet production behavior)
  const results = await Promise.all(bots.map(b => simulateCycle(b, marketData)));

  const failures: string[] = [];

  for (const result of results) {
    if (result.halted) {
      failures.push(`${result.botId}: halted — ${result.haltReason}`);
      continue;
    }
    // Verify every expected stage completed
    for (const stage of EXPECTED_STAGES) {
      if (!result.stagesCompleted.includes(stage)) {
        failures.push(`${result.botId}: ${stage} stage not completed`);
      }
    }
  }

  // Isolation check: no two bots should share the same state reference
  for (let i = 0; i < bots.length - 1; i++) {
    if (bots[i].getStateManager().getState() === bots[i + 1].getStateManager().getState()) {
      failures.push(`State reference shared between ${bots[i].botId} and ${bots[i + 1].botId} — isolation violated`);
    }
  }

  return {
    bots:            results,
    totalDurationMs: Date.now() - start,
    allPassed:       failures.length === 0,
    failures,
  };
}
