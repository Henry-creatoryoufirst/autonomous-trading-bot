# Silo Architecture Refactor Plan

## Status: 14 PHASES COMPLETE (17,451 → 11,241 lines, -35.6%)

## Architecture
```
agent-v3.2.ts            (11,241 lines — monolith, down from 17,451)
src/algorithm/           (1,461 lines)  — Pure computation (20 functions)
src/self-improvement/    (960 lines)    — Pattern analysis, reviews, thresholds (12 functions)
src/dashboard/           (909 lines)    — Export generators + fallback HTML
src/reporting/           (405 lines)    — Prompt formatting (sf, formatIntelligence, formatIndicators)
src/portfolio/           (203 lines)    — Cost basis tracking (5 functions)
src/diagnostics/         (164 lines)    — Error logging, token failure breaker, opportunity tracking
src/capital/             (168 lines)    — Cash deployment, crash-buying, portfolio sensitivity
src/gas/                 (148 lines)    — Gas price checks, pool liquidity validation
src/chain/               (194 lines)    — On-chain capital flows, Blockscout integration
src/execution/           (varies)       — RPC, calldata, trade helpers
src/data/                (varies)       — DeFi, news, macro, CMC fetchers
config/                  (1,180+ lines) — Constants, token registry, Chainlink feeds
types/                   (903 lines)    — All type definitions (0 inline remaining)
```

## Commit History
| Phase | Commit | Lines | Description |
|-------|--------|-------|-------------|
| 1b | 5ccd075 | -909 | 20 algorithm functions to src/algorithm/ |
| 2 | f044362 | -217 | Token registry, sectors, Chainlink to config/ |
| 3a | 1572be2 | -292 | Delete 18 duplicate type definitions |
| 3b | 7443ca8 | -301 | Extract 25 remaining types to 3 new files |
| 7p | 1bfbc19 | -878 | Dashboard exports + embedded HTML |
| 5 | 4175aa7 | -854 | Self-improvement engine (12 functions) |
| 7r | ef23efc | -800 | Dashboard API (22 functions) |
| 4 | 2a98d2b | -172 | Execution engine (RPC, calldata, helpers) |
| 6 | c8d43a0 | -544 | Data fetchers (DeFi, news, macro, CMC) |
| 9 | 2347fae | -388 | Reporting/formatting (3 functions) |
| 10 | e15b777 | -163 | Portfolio cost basis (5 functions) |
| 11 | 200b840 | -93 | Diagnostics (error log, failure breaker, opportunity tracking) |
| 12 | 62075fa | -177 | Capital deployment (4 functions) |
| 13 | 8e3cf15 | -179 | Gas & liquidity (4 functions) |
| 14 | 9266368 | -243 | On-chain capital flows (3 functions) |

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

## Phase 2: Extract token registry + sectors to config/ (DONE)
- TOKEN_REGISTRY (lines 458-609) -> config/token-registry.ts
- SECTORS (lines 414-446) -> config/sectors.ts
- CHAINLINK_FEEDS_BASE (lines 617-626) -> config/chainlink-feeds.ts
- CDP_UNSUPPORTED_TOKENS, DEX_SWAP_TOKENS -> config/swap-routing.ts
- QUOTE_DECIMALS -> config/token-registry.ts

## Phase 3: Extract ALL inline types (DONE)
Phase 3a: Deleted 18 duplicate inline types (types already in types/index.ts or src/algorithm/)
Phase 3b: Extracted all 25 remaining inline types to 3 new files:
- types/market-data.ts (170 lines): NewsSentimentData, MacroData, GlobalMarketData, StablecoinSupplyData, MarketData, CMCIntelligence, TradingSignal, SignalPayload, TradeDecision
- types/state.ts (159 lines): AgentState, UserDirective, BreakerState, RoundTripTrade, WinRateTruthData, CashDeploymentResult, SignalHistoryEntry, OpportunityCostEntry, HarvestRecipient
- types/services.ts (77 lines): PoolRegistryEntry, PoolRegistryFile, PoolLiquidity, PriceHistoryStore, OnChainCapitalFlows, BasescanTransfer
Zero inline type definitions remain in the monolith.

## Phase 4: Extract execution engine (DONE — RPC, calldata, helpers extracted)
- Trade execution functions -> src/execution/
- DEX swap, TWAP, gas management -> src/execution/

## Phase 5: Extract self-improvement engine (DONE)
- Pattern analysis, performance reviews, threshold adaptation -> src/self-improvement/

## Phase 6: Extract data fetchers (DONE — on-chain, DeFi, news, macro, CMC extracted)
- On-chain pricing, DeFi intelligence, macro data -> src/data/

## Phase 7: Extract dashboard/API (DONE — exports + HTML + API functions extracted, HTTP routes stay)
- HTTP server, API routes, dashboard HTML -> src/dashboard/

## Critical Rules
1. NEVER push untested code to the live bot
2. Always preserve exact behavior through thin wrappers
3. Test compilation before every push
4. One phase at a time — don't mix extraction with behavior changes
