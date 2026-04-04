# NVR Capital -- 5-Silo Architecture Migration Plan

> **Status:** PLANNING (do not execute until simulation-engine branch is merged)
> **Date:** 2024-04-04
> **Branches:** Execute on `silo-architecture` after `simulation-engine` merges to `main`

---

## 1. Target Architecture

```
src/
  algorithm/     -- Silo 1: Indicators, confluence, market analysis, position sizing, risk
  core/          -- Silo 2: State, execution, gas, chain, diagnostics, capital, data, reporting, portfolio
  dashboard/     -- Silo 3: Embedded HTML, exports, API routes, HTTP server
  simulation/    -- Silo 4: Backtesting, paper trading, strategy versions, simulator (built by other agent)
  fleet/         -- Silo 5: Family platform, deploy configs, CI, per-member profiles
```

---

## 2. Current File Inventory

### Root-level files (stay at root)
| File | Notes |
|------|-------|
| `agent-v3.2.ts` | Main entry -- imports rewritten, stays at root |
| `start.ts` | Bootstrap -- stays |
| `equity-integration.ts` | Moves to `src/core/` |
| `auto-harvest-patch.ts` | Moves to `src/core/` |
| `vitest.config.ts` | Stays at root |
| `Dockerfile` | Stays at root (referenced by `src/fleet/` docs) |
| `railway.toml` | Stays at root |

### config/
| File | Target Silo |
|------|-------------|
| `config/constants.ts` | `src/core/config/constants.ts` |
| `config/token-registry.ts` | `src/core/config/token-registry.ts` |
| `config/chainlink-feeds.ts` | `src/core/config/chainlink-feeds.ts` |

### types/
| File | Target Silo |
|------|-------------|
| `types/index.ts` | `src/core/types/index.ts` |
| `types/market-data.ts` | `src/core/types/market-data.ts` |
| `types/state.ts` | `src/core/types/state.ts` |
| `types/services.ts` | `src/core/types/services.ts` |
| `types/family.ts` | `src/fleet/types/family.ts` |

### services/ (the big one)
| File | Target Silo | Rationale |
|------|-------------|-----------|
| `services/cache-manager.ts` | `src/core/services/cache-manager.ts` | Core infra |
| `services/cooldown-manager.ts` | `src/core/services/cooldown-manager.ts` | Core infra |
| `services/trailing-stops.ts` | `src/core/services/trailing-stops.ts` | Core execution |
| `services/mev-protection.ts` | `src/core/services/mev-protection.ts` | Core execution |
| `services/dex-aggregator.ts` | `src/core/services/dex-aggregator.ts` | Core execution |
| `services/risk-reviewer.ts` | `src/core/services/risk-reviewer.ts` | Core risk |
| `services/aave-yield.ts` | `src/core/services/aave-yield.ts` | Core yield |
| `services/morpho-yield.ts` | `src/core/services/morpho-yield.ts` | Core yield |
| `services/yield-optimizer.ts` | `src/core/services/yield-optimizer.ts` | Core yield |
| `services/deceleration-detector.ts` | `src/core/services/deceleration-detector.ts` | Core signals |
| `services/flow-timeframes.ts` | `src/core/services/flow-timeframes.ts` | Core signals |
| `services/signal-tracker.ts` | `src/core/services/signal-tracker.ts` | Core signals |
| `services/weekly-report.ts` | `src/core/services/weekly-report.ts` | Core reporting |
| `services/gecko-terminal.ts` | `src/core/services/gecko-terminal.ts` | Core data |
| `services/startup-checks.ts` | `src/core/services/startup-checks.ts` | Core infra |
| `services/telegram.ts` | `src/core/services/telegram.ts` | Core infra |
| `services/trade-queue.ts` | `src/core/services/trade-queue.ts` | Core execution |
| `services/market-hours.ts` | `src/core/services/market-hours.ts` | Core infra |
| `services/swarm/` (entire dir) | `src/core/services/swarm/` | Core AI swarm |
| `services/testable/` (entire dir) | `src/core/services/testable/` | Core testable wrappers |
| `services/simulator.ts` | `src/simulation/simulator.ts` | Simulation silo |
| `services/paper-trader.ts` | `src/simulation/paper-trader.ts` | Simulation silo |
| `services/strategy-versions.ts` | `src/simulation/strategy-versions.ts` | Simulation silo |
| `services/version-backtester.ts` | `src/simulation/version-backtester.ts` | Simulation silo |
| `services/strategy-config.ts` | `src/simulation/strategy-config.ts` | Simulation silo (NL strategy parsing) |
| `services/adaptive-thresholds.ts` | `src/simulation/adaptive-thresholds.ts` | Simulation silo |
| `services/cash-deployment.ts` | `src/core/services/cash-deployment.ts` | Core capital |
| `services/cost-basis.ts` | Redundant -- already at `src/portfolio/` | Remove if unused |
| `services/coinbase-advanced-trade.ts` | `src/core/services/coinbase-advanced-trade.ts` | Core execution (derivatives) |
| `services/derivatives-strategy.ts` | `src/core/services/derivatives-strategy.ts` | Core execution (derivatives) |
| `services/macro-commodity-signals.ts` | `src/core/services/macro-commodity-signals.ts` | Core data |
| `services/token-discovery.ts` | `src/core/services/token-discovery.ts` | Core data |
| `services/alpaca-client.ts` | `src/core/services/alpaca-client.ts` | Core execution (stocks) |
| `services/stock-data.ts` | `src/core/services/stock-data.ts` | Core data |
| `services/polymarket.ts` | `src/core/services/polymarket.ts` | Core execution |

### src/ modules (already extracted)
| Current Path | Target Silo Path | Action |
|-------------|-------------------|--------|
| `src/algorithm/` | `src/algorithm/` | **STAYS** -- already its own silo |
| `src/state/` | `src/core/state/` | Move into core |
| `src/execution/` | `src/core/execution/` | Move into core |
| `src/gas/` | `src/core/gas/` | Move into core |
| `src/chain/` | `src/core/chain/` | Move into core |
| `src/diagnostics/` | `src/core/diagnostics/` | Move into core |
| `src/capital/` | `src/core/capital/` | Move into core |
| `src/data/` | `src/core/data/` | Move into core |
| `src/reporting/` | `src/core/reporting/` | Move into core |
| `src/portfolio/` | `src/core/portfolio/` | Move into core |
| `src/self-improvement/` | `src/core/self-improvement/` | Move into core |
| `src/dashboard/` | `src/dashboard/` | **STAYS** -- absorbs `src/server/` |
| `src/server/` | `src/dashboard/server/` | Merge into dashboard silo |

### family/ (currently at repo root)
| Current Path | Target Silo Path |
|-------------|-------------------|
| `family/index.ts` | `src/fleet/family/index.ts` |
| `family/members.ts` | `src/fleet/family/members.ts` |
| `family/wallet-manager.ts` | `src/fleet/family/wallet-manager.ts` |
| `family/execution.ts` | `src/fleet/family/execution.ts` |

### .github/workflows/
| File | Target Silo Path |
|------|-------------------|
| `.github/workflows/ci.yml` | Stays, but referenced from `src/fleet/` |
| `.github/workflows/docker-publish.yml` | Stays, but referenced from `src/fleet/` |

---

## 3. Silo Index Files -- Draft Exports

### 3a. `src/algorithm/index.ts` -- NO CHANGES NEEDED

Already complete. Current exports cover:
- `indicators.ts` -- RSI, EMA, MACD, Bollinger, SMA, ATR, ADX, determineTrend, decodeSqrtPriceX96
- `confluence.ts` -- calculateConfluence
- `market-analysis.ts` -- determineMarketRegime, calculateMarketMomentum, smart/retail divergence, funding mean reversion, TVL price divergence, adjusted sector targets, altseason signal, price change
- `position-sizing.ts` -- Kelly, volatility, institutional sizing
- `risk.ts` -- ATR stop levels

No new files need to move into this silo. It is already clean.

---

### 3b. `src/core/index.ts` -- NEW (consolidates 9 current sub-modules + services + config + types)

```typescript
/**
 * NVR Capital -- Core Silo
 * Consolidates: state, execution, gas, chain, diagnostics, capital, data,
 *               reporting, portfolio, self-improvement, config, types, services
 */

// === State ===
export {
  getState, getBreakerState, setState, setBreakerState,
  markStateDirty, isStateDirty, isCriticalPending, clearDirtyFlag,
} from './state/index.js';

// === Execution ===
export {
  initRpc, getCurrentRpc, rotateRpc, rpcCall,
  getETHBalance, getERC20Balance,
  buildAerodromeExactInputSingleCalldata,
  buildExactInputSingleCalldata, buildExactInputMultihopCalldata,
  encodeV3Path,
  initExecutionHelpers, getTokenAddress, getTokenDecimals,
} from './execution/index.js';

// === Gas & Liquidity ===
export {
  fetchPoolLiquidity, checkLiquidity, fetchGasPrice, checkGasCost,
} from './gas/index.js';

// === On-Chain Capital Flows ===
export {
  detectOnChainCapitalFlows, fetchBlockscoutTransfers, pairTransfersIntoTrades,
} from './chain/index.js';

// === Diagnostics ===
export {
  logError, recordTradeFailure, clearTradeFailures, isTokenBlocked,
  logMissedOpportunity, updateOpportunityCosts, getOpportunityCostSummary,
} from './diagnostics/index.js';
export type { OpportunityCostLog } from './diagnostics/index.js';

// === Capital Deployment ===
export {
  getPortfolioSensitivity, assessVolatility,
  checkCashDeploymentMode, checkCrashBuyingOverride,
} from './capital/index.js';

// === Data Fetchers ===
export {
  initIntelligenceFetchers,
  fetchDefiLlamaData, fetchDerivativesData, fetchNewsSentiment,
  fetchCrossAssetData, fetchCMCIntelligence, fetchMacroData,
} from './data/index.js';

// === Reporting / Formatting ===
export {
  sf, formatIntelligenceForPrompt, formatIndicatorsForPrompt,
} from './reporting/index.js';

// === Portfolio Cost Basis ===
export {
  getOrCreateCostBasis, updateCostBasisAfterBuy, updateCostBasisAfterSell,
  updateUnrealizedPnL, rebuildCostBasisFromTrades,
} from './portfolio/index.js';

// === Self-Improvement ===
export {
  initSelfImprovement, getShadowProposals, setShadowProposals,
  calculateTradePerformance, calculateWinRateTruth,
  classifyTradePattern, describePattern,
  analyzeStrategyPatterns, runPerformanceReview, adaptThresholds,
  calculatePatternConfidence, checkStagnation,
  formatSelfImprovementPrompt, formatUserDirectivesPrompt,
  getDirectiveThresholdAdjustments,
  THRESHOLD_BOUNDS, DEFAULT_ADAPTIVE_THRESHOLDS, DEFAULT_EXPLORATION_STATE,
} from './self-improvement/index.js';

// === Config ===
export * from './config/constants.js';
export { TOKEN_REGISTRY, SECTORS, CDP_UNSUPPORTED_TOKENS, DEX_SWAP_TOKENS, QUOTE_DECIMALS, WETH_ADDRESS, USDC_ADDRESS, CBBTC_ADDRESS, VIRTUAL_ADDRESS } from './config/token-registry.js';
export type { SectorKey } from './config/token-registry.js';
export { CHAINLINK_FEEDS_BASE, CHAINLINK_ABI_FRAGMENT } from './config/chainlink-feeds.js';

// === Types ===
export type * from './types/index.js';
export type * from './types/market-data.js';
export type * from './types/state.js';
export type * from './types/services.js';

// === Services (re-exported for convenience) ===
export { cacheManager, CacheKeys } from './services/cache-manager.js';
export { cooldownManager } from './services/cooldown-manager.js';
export { telegramService } from './services/telegram.js';
export { runPreFlightChecks } from './services/startup-checks.js';
export { updateTrailingStop, checkTrailingStopHit, getTrailingStopState, getTrailingStop, removeTrailingStop, resetTrailingStopTrigger, saveTrailingStops, loadTrailingStops } from './services/trailing-stops.js';
export { calculateAdaptiveSlippage, needsMevProtection } from './services/mev-protection.js';
export { getBestAggregatorQuote, shouldUseAggregator } from './services/dex-aggregator.js';
export { reviewTrade, updateDrawdownTracking, isTradeAllowedByDrawdown } from './services/risk-reviewer.js';
export type { RiskReviewInput } from './services/risk-reviewer.js';
export { aaveYieldService } from './services/aave-yield.js';
export type { YieldState } from './services/aave-yield.js';
export { yieldOptimizer } from './services/yield-optimizer.js';
export type { ProtocolYield } from './services/yield-optimizer.js';
export { createDecelState, updateBuyRatioHistory, detectDeceleration } from './services/deceleration-detector.js';
export type { DecelState } from './services/deceleration-detector.js';
export { createFlowTimeframeState, recordFlowReading, getFlowTimeframes } from './services/flow-timeframes.js';
export type { FlowTimeframeState } from './services/flow-timeframes.js';
export { recordExecuted, recordFiltered, getSignalStats } from './services/signal-tracker.js';
export { generateWeeklyReport, shouldGenerateReport, getLatestReport } from './services/weekly-report.js';
export { geckoTerminalService } from './services/gecko-terminal.js';
export type { DexIntelligence } from './services/gecko-terminal.js';
export { runSwarm, formatSwarmForPrompt, setLatestSwarmDecisions, getLatestSwarmDecisions, getLastSwarmRunTime } from './services/swarm/orchestrator.js';
export type { SwarmDecision } from './services/swarm/agent-framework.js';
export { CoinbaseAdvancedTradeClient } from './services/coinbase-advanced-trade.js';
export { DerivativesStrategyEngine, DEFAULT_DERIVATIVES_CONFIG } from './services/derivatives-strategy.js';
export type { DerivativesSignal, DerivativesTradeRecord, MacroCommoditySignal } from './services/derivatives-strategy.js';
export { MacroCommoditySignalEngine, discoverCommodityContracts } from './services/macro-commodity-signals.js';
export { TokenDiscoveryEngine } from './services/token-discovery.js';
export type { DiscoveredToken, TokenDiscoveryState } from './services/token-discovery.js';
```

---

### 3c. `src/dashboard/index.ts` -- UPDATED (absorbs server/)

```typescript
/**
 * NVR Capital -- Dashboard Silo
 * Consolidated: embedded HTML, exports, API, HTTP server routes
 */

// === Embedded HTML ===
export { EMBEDDED_DASHBOARD } from './embedded-html.js';

// === Export utilities ===
export {
  escapeHtml, fmtExport, generateEquityCurveSVG,
  nvrExportBaseStyles,
  generateBacktestMultiExportHTML, generateBacktestSingleExportHTML,
  generatePaperExportHTML,
} from './exports.js';

// === Dashboard API ===
export {
  initDashboardAPI,
  sendJSON, downsample, isAuthorized,
  calculateRiskRewardMetrics,
  apiPortfolio, apiBalances, apiSectors,
  apiTrades, apiDailyPnL,
  apiIndicators, apiIntelligence,
  apiPatterns, apiReviews, apiThresholds,
  getActiveDirectives, addUserDirective,
  removeUserDirective, applyConfigChanges,
  getActiveConfigDirectives, removeConfigDirective,
  executeChatTool, handleChatRequest,
  getDashboardHTML,
} from './api.js';

// === HTTP Server Routes (merged from src/server/) ===
export type { ServerContext } from './server/routes.js';
export {
  handleDashboard, handleHealth,
  handlePersistence, handlePreservation,
  handleCapitalFlows, handleErrors, handleSignals, handleWeeklyReport,
  handleDebug, handleAccounts,
  handleKill, handleResume,
  handleTrailingStops, handleRiskReview, handleAutoHarvest, handleAutoHarvestTrigger,
  handleAdaptive, handleDerivatives, handleEquity, handleDiscovery, handleCache,
  handleYield, handleYieldRates, handleDexIntelligence,
  handleFamily, handleFamilyMembers, handleFamilyProfiles, handleFamilyWallets,
  handleHealthAudit, handleWinRateTruth, handleCorrectState,
  handleChat, handleDirectives, handleDeleteDirective,
  handleSimulate, handleStrategyVersions, handlePaperPortfolios, handlePaperPortfolioById,
  handleExportResults, handleVersionBacktest,
  handleSwarmStatus, handleSignalDashboard, handleSignalsLatest,
  handleWithdraw, handleStateBackup, handleStateRestore,
} from './server/routes.js';
```

---

### 3d. `src/simulation/index.ts` -- SKELETON (being built by other agent)

```typescript
/**
 * NVR Capital -- Simulation Silo
 * Backtesting, paper trading, strategy versions, NL strategy config
 *
 * NOTE: The simulation-engine branch is building the core engine.
 * This index will re-export everything once that branch merges.
 */

// === Simulator ===
export { runSimulation, compareStrategies, loadPriceHistory, DEFAULT_SIM_CONFIG } from './simulator.js';
export type { SimConfig } from './simulator.js';

// === Paper Trader ===
export {
  createPaperPortfolio, getPaperPortfolio, getAllPaperPortfolios,
  evaluatePaperTrade, updatePaperPortfolio, getPaperPortfolioSummary,
  savePaperPortfolios, loadPaperPortfolios,
} from './paper-trader.js';
export type { PaperPortfolio, TokenSignal } from './paper-trader.js';

// === Strategy Versions ===
export { STRATEGY_VERSIONS, getVersion } from './strategy-versions.js';
export type { StrategyVersion } from './strategy-versions.js';

// === Version Backtester ===
export { runAllVersionBacktestsFromDisk, summarizeBacktestResults } from './version-backtester.js';

// === Natural Language Strategy Config ===
export { parseStrategyInstruction, isStrategyInstruction } from './strategy-config.js';
export type { ConfigChange, ParseResult, ConfigDirective } from './strategy-config.js';

// === Adaptive Thresholds (testable service) ===
export { /* TBD -- depends on what simulation-engine branch exports */ } from './adaptive-thresholds.js';
```

---

### 3e. `src/fleet/index.ts` -- NEW (family platform + deploy references)

```typescript
/**
 * NVR Capital -- Fleet Silo
 * Family multi-wallet platform, deploy configs, CI references
 *
 * Fleet = the set of Railway services running NVR bots for different members.
 */

// === Family Platform ===
export { familyManager, FamilyMemberManager } from './family/members.js';
export { WalletManager } from './family/wallet-manager.js';
export { scaleDecisionForMember, fanOutDecision, executeFamilyTrades } from './family/execution.js';

// === Family Types ===
export type {
  FamilyMember, FamilyConfig, RiskProfile, RiskProfileName,
  MemberStatus, MemberPortfolioState, MemberBalance,
  FamilyTradeDecision, FamilyTradeResult,
} from './types/family.js';
export { DEFAULT_RISK_PROFILES } from './types/family.js';
```

---

## 4. Import Path Rewrites in `agent-v3.2.ts`

After the file moves, every import in agent-v3.2.ts must be updated. Below is the complete mapping of old path -> new path.

### Config imports
```
OLD: "./config/constants.js"            -> NEW: "./src/core/config/constants.js"
OLD: "./config/token-registry.js"       -> NEW: "./src/core/config/token-registry.js"
OLD: "./config/chainlink-feeds.js"      -> NEW: "./src/core/config/chainlink-feeds.js"
```
**Alternative:** Import everything from `"./src/core/index.js"` barrel.

### Types imports
```
OLD: "./types/index.js"                 -> NEW: "./src/core/types/index.js"
OLD: "./types/market-data.js"           -> NEW: "./src/core/types/market-data.js"
OLD: "./types/state.js"                 -> NEW: "./src/core/types/state.js"
OLD: "./types/services.js"             -> NEW: "./src/core/types/services.js"
OLD: "./types/family.js"               -> NEW: "./src/fleet/types/family.js"
```

### src/ module imports
```
OLD: "./src/algorithm/index.js"         -> UNCHANGED (stays)
OLD: "./src/self-improvement/index.js"  -> NEW: "./src/core/self-improvement/index.js"
OLD: "./src/dashboard/index.js"         -> UNCHANGED (stays)
OLD: "./src/dashboard/api.js"           -> UNCHANGED (stays)
OLD: "./src/server/index.js"            -> NEW: "./src/dashboard/server/index.js"
OLD: "./src/execution/index.js"         -> NEW: "./src/core/execution/index.js"
OLD: "./src/data/index.js"              -> NEW: "./src/core/data/index.js"
OLD: "./src/reporting/index.js"         -> NEW: "./src/core/reporting/index.js"
OLD: "./src/portfolio/index.js"         -> NEW: "./src/core/portfolio/index.js"
OLD: "./src/diagnostics/index.js"       -> NEW: "./src/core/diagnostics/index.js"
OLD: "./src/capital/index.js"           -> NEW: "./src/core/capital/index.js"
OLD: "./src/gas/index.js"               -> NEW: "./src/core/gas/index.js"
OLD: "./src/chain/index.js"             -> NEW: "./src/core/chain/index.js"
OLD: "./src/state/index.js"             -> NEW: "./src/core/state/index.js"
```

### services/ imports (all move to src/core/services/)
```
OLD: "./services/coinbase-advanced-trade.js"    -> NEW: "./src/core/services/coinbase-advanced-trade.js"
OLD: "./services/derivatives-strategy.js"       -> NEW: "./src/core/services/derivatives-strategy.js"
OLD: "./services/macro-commodity-signals.js"     -> NEW: "./src/core/services/macro-commodity-signals.js"
OLD: "./services/token-discovery.js"             -> NEW: "./src/core/services/token-discovery.js"
OLD: "./services/strategy-config.js"             -> NEW: "./src/simulation/strategy-config.js"
OLD: "./services/simulator.js"                   -> NEW: "./src/simulation/simulator.js"
OLD: "./services/strategy-versions.js"           -> NEW: "./src/simulation/strategy-versions.js"
OLD: "./services/paper-trader.js"                -> NEW: "./src/simulation/paper-trader.js"
OLD: "./services/version-backtester.js"          -> NEW: "./src/simulation/version-backtester.js"
OLD: "./services/startup-checks.js"              -> NEW: "./src/core/services/startup-checks.js"
OLD: "./services/telegram.js"                    -> NEW: "./src/core/services/telegram.js"
OLD: "./services/cache-manager.js"               -> NEW: "./src/core/services/cache-manager.js"
OLD: "./services/cooldown-manager.js"            -> NEW: "./src/core/services/cooldown-manager.js"
OLD: "./services/trailing-stops.js"              -> NEW: "./src/core/services/trailing-stops.js"
OLD: "./services/mev-protection.js"              -> NEW: "./src/core/services/mev-protection.js"
OLD: "./services/dex-aggregator.js"              -> NEW: "./src/core/services/dex-aggregator.js"
OLD: "./services/risk-reviewer.js"               -> NEW: "./src/core/services/risk-reviewer.js"
OLD: "./services/aave-yield.js"                  -> NEW: "./src/core/services/aave-yield.js"
OLD: "./services/morpho-yield.ts"                -> (disabled/stub -- move to src/core/services/ if re-enabled)
OLD: "./services/yield-optimizer.js"             -> NEW: "./src/core/services/yield-optimizer.js"
OLD: "./services/deceleration-detector.js"       -> NEW: "./src/core/services/deceleration-detector.js"
OLD: "./services/flow-timeframes.js"             -> NEW: "./src/core/services/flow-timeframes.js"
OLD: "./services/signal-tracker.js"              -> NEW: "./src/core/services/signal-tracker.js"
OLD: "./services/weekly-report.js"               -> NEW: "./src/core/services/weekly-report.js"
OLD: "./services/gecko-terminal.js"              -> NEW: "./src/core/services/gecko-terminal.js"
OLD: "./services/swarm/orchestrator.js"          -> NEW: "./src/core/services/swarm/orchestrator.js"
OLD: "./services/swarm/agent-framework.js"       -> NEW: "./src/core/services/swarm/agent-framework.js"
OLD: "./services/alpaca-client.js"               -> NEW: "./src/core/services/alpaca-client.js"
OLD: "./services/polymarket.js"                  -> NEW: "./src/core/services/polymarket.js"
OLD: "./services/stock-data.js"                  -> NEW: "./src/core/services/stock-data.js"
OLD: "./services/adaptive-thresholds.js"         -> NEW: "./src/simulation/adaptive-thresholds.js"
OLD: "./services/cash-deployment.js"             -> NEW: "./src/core/services/cash-deployment.js"
OLD: "./services/market-hours.js"                -> NEW: "./src/core/services/market-hours.js"
OLD: "./services/trade-queue.js"                 -> NEW: "./src/core/services/trade-queue.js"
```

### Root-level module imports
```
OLD: "./equity-integration.js"   -> NEW: "./src/core/equity-integration.js"
OLD: "./family/index.js"         -> NEW: "./src/fleet/family/index.js"
```

---

## 5. Internal Cross-Module Import Rewrites

When files move, their internal imports to sibling files also need updating. Key cases:

### 5a. `src/server/routes.ts` -> `src/dashboard/server/routes.ts`
This file likely imports from `../dashboard/` -- those become `../` (one level up).
It also imports from `../../services/`, `../../config/`, `../../types/` -- those all become `../../core/...`.

### 5b. `src/diagnostics/error-tracking.ts` -> `src/core/diagnostics/error-tracking.ts`
Currently imports state from `../state/store.js`. New path: `../state/store.js` (same relative, since both are under core/).

### 5c. `src/portfolio/cost-basis.ts` -> `src/core/portfolio/cost-basis.ts`
Currently imports state from `../state/store.js`. Same relative path works under core/.

### 5d. `family/*.ts` -> `src/fleet/family/*.ts`
Currently imports from `../types/family.js`. New: `../types/family.js` (since types/family.ts moves to src/fleet/types/family.ts).
Currently imports from `../services/*`. New: `../../core/services/*`.
Currently imports from `../config/*`. New: `../../core/config/*`.

### 5e. `services/*.ts` -> `src/core/services/*.ts`
Many services import from `../config/constants.js`. New: `../config/constants.js` (same relative, both under core/).
Services importing from `../types/*`. New: `../types/*` (same relative under core/).
Services importing from `../src/state/`. New: `../state/` (now sibling under core/).

### 5f. `src/dashboard/api.ts` stays at `src/dashboard/api.ts`
Currently imports from `../../services/*`, `../../config/*`, `../../types/*`. New: `../core/services/*`, `../core/config/*`, `../core/types/*`.

### 5g. `src/data/intelligence.ts` -> `src/core/data/intelligence.ts`
Currently imports from `../../services/*`. New: `../services/*` (sibling under core/).

---

## 6. Order of Operations

Execute in this exact order to avoid broken imports at any step:

### Phase A: Create directory structure
```bash
mkdir -p src/core/{state,execution,gas,chain,diagnostics,capital,data,reporting,portfolio,self-improvement,config,types,services/swarm,services/testable}
mkdir -p src/dashboard/server
mkdir -p src/simulation
mkdir -p src/fleet/{family,types}
```

### Phase B: Move files into src/core/ (largest batch)
1. `mv config/ src/core/config/`
2. `mv types/index.ts types/market-data.ts types/state.ts types/services.ts src/core/types/`
3. `mv types/family.ts src/fleet/types/`
4. Move all services files to `src/core/services/` (except simulation ones)
5. Move simulation services: `services/simulator.ts`, `services/paper-trader.ts`, `services/strategy-versions.ts`, `services/version-backtester.ts`, `services/strategy-config.ts`, `services/adaptive-thresholds.ts` -> `src/simulation/`
6. Move src sub-modules into core:
   - `mv src/state/* src/core/state/`
   - `mv src/execution/* src/core/execution/`
   - `mv src/gas/* src/core/gas/`
   - `mv src/chain/* src/core/chain/`
   - `mv src/diagnostics/* src/core/diagnostics/`
   - `mv src/capital/* src/core/capital/`
   - `mv src/data/* src/core/data/`
   - `mv src/reporting/* src/core/reporting/`
   - `mv src/portfolio/* src/core/portfolio/`
   - `mv src/self-improvement/* src/core/self-improvement/`
7. `mv equity-integration.ts auto-harvest-patch.ts src/core/`

### Phase C: Merge server into dashboard
1. `mv src/server/routes.ts src/dashboard/server/routes.ts`
2. `mv src/server/index.ts src/dashboard/server/index.ts`
3. `rmdir src/server`

### Phase D: Move family into fleet
1. `mv family/* src/fleet/family/`
2. `rmdir family`

### Phase E: Create index files
1. Write `src/core/index.ts` (see section 3b)
2. Update `src/dashboard/index.ts` (see section 3c)
3. Write `src/simulation/index.ts` (see section 3d)
4. Write `src/fleet/index.ts` (see section 3e)

### Phase F: Rewrite imports
1. Update all imports in `agent-v3.2.ts` (see section 4)
2. Update internal imports in moved files (see section 5)
3. Update `start.ts` if it imports from affected paths

### Phase G: Clean up empty directories
```bash
rmdir src/state src/execution src/gas src/chain src/diagnostics src/capital src/data src/reporting src/portfolio src/self-improvement
rmdir config types services  # only if completely empty
```

### Phase H: Verify
```bash
npx tsc --noEmit        # type-check
npm test                 # run tests
```

---

## 7. Dependency Graph -- What Depends on What

```
algorithm/  <- pure, no deps on other silos
core/       <- depends on nothing (self-contained)
dashboard/  <- depends on core/ (for types, state, services)
simulation/ <- depends on core/ (for types, config) and algorithm/ (for indicators)
fleet/      <- depends on core/ (for execution, types, config)
```

Key constraint: `algorithm/` and `core/` MUST move first since the other three silos depend on them. Since `algorithm/` already exists and is clean, the real work is moving everything into `core/`.

---

## 8. Files That Need Zero Changes

These files stay exactly where they are:
- `agent-v3.2.ts` (root) -- only imports change
- `start.ts` (root)
- `vitest.config.ts` (root)
- `package.json`, `tsconfig.json`, `tsconfig.strict.json` (root)
- `Dockerfile`, `railway.toml` (root)
- `.github/workflows/*` (root)
- `src/algorithm/*` (entire silo stays put)

---

## 9. Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Broken test imports | Tests under `src/*/\__tests__/` move with their parent module; relative imports stay valid |
| Railway deploy failure | Deploy from `silo-architecture` branch first as preview; only merge after `tsc --noEmit` passes |
| Circular dependencies | Core silo re-exports everything; no silo imports from a "higher" silo |
| Merge conflicts with simulation-engine | Simulation files are new files not existing on main; low conflict risk |
| services/ has internal cross-imports | Move all services together in one batch (Phase B step 4-5) to avoid partial breakage |

---

## 10. Post-Migration Cleanup

After verifying everything works:
1. Remove empty `config/`, `types/`, `services/`, `family/` dirs from root
2. Update `tsconfig.json` paths if using path aliases
3. Update `.github/workflows/ci.yml` if it references specific paths
4. Update `Dockerfile` if it copies specific dirs
5. Consider adding `src/core/index.ts` as the single import point for agent-v3.2.ts to simplify the 50+ import lines down to ~5 silo imports
