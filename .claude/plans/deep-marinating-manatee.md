# Silo Architecture Refactor Plan

## Status: Phase 1b COMPLETE

## Overview
Extract the 17,451-line monolith (agent-v3.2.ts) into isolated, testable modules using a silo architecture.

## Phase 1a: Type deduplication (DONE in previous session)
- Updated `types/index.ts` with complete AdaptiveThresholds (added atrStopMultiplier, atrTrailMultiplier)
- Updated `types/index.ts` with complete TokenCostBasis (added atrStopPercent, atrTrailPercent, atrAtEntry, trailActivated, lastAtrUpdate)
- Updated `types/index.ts` with complete TradeRecord (added realizedPnL, WITHDRAW action, FORCED_DEPLOY trigger, isForced)
- Updated SignalContext to match monolith (isForced, FORCED_DEPLOY trigger)

## Phase 1b: Extract algorithm functions to src/algorithm/ (DONE)
Extracted 20 functions (~909 lines removed from monolith, 1,461 lines in new modules):

### src/algorithm/indicators.ts (380 lines)
Pure math, zero state dependencies:
- calculateRSI, calculateEMA, calculateMACD, calculateBollingerBands
- calculateSMA, calculateATR, calculateADX, determineTrend
- decodeSqrtPriceX96
- TechnicalIndicators interface (canonical definition)

### src/algorithm/confluence.ts (194 lines)
Parameterized — accepts ConfluenceContext (adaptive thresholds + momentum):
- calculateConfluence

### src/algorithm/market-analysis.ts (492 lines)
Parameterized — state passed in, not read from globals:
- determineMarketRegime (accepts lastKnownPrices)
- calculateMarketMomentum (accepts lastKnownPrices, lastFearGreedValue)
- computeSmartRetailDivergence (accepts threshold)
- computeFundingMeanReversion (accepts/mutates fundingRateHistory)
- computeTVLPriceDivergence (accepts threshold)
- getAdjustedSectorTargets (accepts sectors, boosts, lastKnownPrices)
- computeLocalAltseasonSignal (accepts price histories)
- computePriceChange (accepts price history entry)
- Type exports: DerivativesData, DefiLlamaData, AltseasonSignal, etc.

### src/algorithm/position-sizing.ts (254 lines)
Parameterized — accepts state slices + constant bundles:
- getEffectiveKellyCeiling
- calculateKellyPositionSize (accepts PositionSizingState + KellyConstants)
- calculateVolatilityMultiplier (accepts PositionSizingState + VolatilityConstants)
- calculateInstitutionalPositionSize (accepts all above + momentum + breaker state)

### src/algorithm/risk.ts (73 lines)
Parameterized — accepts adaptive thresholds + AtrStopConstants:
- computeAtrStopLevels

### src/algorithm/index.ts (68 lines)
Barrel re-exports all functions + types.

### Wiring strategy
Monolith retains thin wrapper functions that pass globals to the extracted modules.
This preserves the original call signatures so no callers need changes.

## Phase 2: Extract token registry + sectors to config/ (NEXT)
- TOKEN_REGISTRY (lines 458-609) -> config/token-registry.ts
- SECTORS (lines 414-446) -> config/sectors.ts
- CHAINLINK_FEEDS_BASE (lines 617-626) -> config/chainlink-feeds.ts
- CDP_UNSUPPORTED_TOKENS, DEX_SWAP_TOKENS -> config/swap-routing.ts
- QUOTE_DECIMALS -> config/token-registry.ts

## Phase 3: Extract market intelligence types
- Create types/market-intelligence.ts
- Move GlobalMarketData, MarketData, TradingSignal, SignalPayload, etc.
- Create types/dex.ts (PoolRegistryEntry, PoolLiquidity)
- Create types/state.ts (AgentState, BreakerState, PriceHistoryStore)

## Phase 4: Extract execution engine
- Trade execution functions -> src/execution/
- DEX swap, TWAP, gas management -> src/execution/

## Phase 5: Extract self-improvement engine
- Pattern analysis, performance reviews, threshold adaptation -> src/self-improvement/

## Phase 6: Extract data fetchers
- On-chain pricing, DeFi intelligence, macro data -> src/data/

## Phase 7: Extract dashboard/API
- HTTP server, API routes, dashboard HTML -> src/dashboard/

## Critical Rules
1. NEVER push untested code to the live bot
2. Always preserve exact behavior through thin wrappers
3. Test compilation before every push
4. One phase at a time — don't mix extraction with behavior changes
