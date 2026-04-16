/**
 * Never Rest Capital — Server Module
 * Barrel re-exports for HTTP server route handlers extracted from agent-v3.2.ts
 */

export type { ServerContext } from './routes.js';

export {
  // Dashboard + Health
  handleDashboard,
  handleHealth,

  // Core API endpoints
  handlePersistence,
  handlePreservation,
  handleCapitalFlows,
  handleErrors,
  handleSignals,
  handleWeeklyReport,
  handleDebug,
  handleAccounts,

  // Control endpoints
  handleKill,
  handleResume,

  // Trading data endpoints
  handleTrailingStops,
  handleRiskReview,
  handleAutoHarvest,
  handleAutoHarvestTrigger,
  handleAdaptive,
  handleDerivatives,
  handleEquity,
  handleDiscovery,
  handleCache,
  handleYield,
  handleYieldRates,
  handleDexIntelligence,

  // Family platform
  handleFamily,
  handleFamilyMembers,
  handleFamilyProfiles,
  handleFamilyWallets,

  // Admin endpoints
  handleHealthAudit,
  handleWinRateTruth,
  handleCorrectState,

  // Chat + Directives
  handleChat,
  handleDirectives,
  handleDeleteDirective,

  // Strategy Lab
  handleSimulate,
  handleStrategyVersions,
  handlePaperPortfolios,
  handlePaperPortfolioById,
  handleExportResults,
  handleVersionBacktest,

  // Signal service
  handleSwarmStatus,
  handleSignalDashboard,
  handleSignalsLatest,

  // Wallet operations
  handleWithdraw,

  // State management
  handleStateBackup,
  handleStateRestore,

  // Confidence gate
  handleConfidence,

  // Model telemetry
  handleModelTelemetry,

  // Trade ticker
  handleTicker,

  // v21.12: Price snapshot (BTC/ETH from Chainlink cache)
  handlePriceSnapshot,
} from './routes.js';
