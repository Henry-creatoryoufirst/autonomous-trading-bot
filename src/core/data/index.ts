/**
 * Never Rest Capital — Data Module
 * Barrel re-exports for data fetchers extracted from agent-v3.2.ts
 */

export {
  initIntelligenceFetchers,
  fetchDefiLlamaData,
  fetchDerivativesData,
  fetchNewsSentiment,
  fetchCrossAssetData,
  fetchCMCIntelligence,
  fetchMacroData,
} from './intelligence.js';

export {
  // State getters + setters
  getPoolRegistry,
  getLastPoolTicks,
  getLastOnChainIntelligence,
  getPriceHistoryStore,
  getChainlinkDeviations,
  getStablecoinSupplyHistory,
  setStablecoinSupplyHistory,
  // Chainlink
  fetchChainlinkPrices,
  fetchChainlinkETHPrice,
  fetchChainlinkBTCPrice,
  fetchChainlinkLINKPrice,
  // Pool registry
  discoverPoolAddresses,
  // Price reads
  fetchOnChainTokenPrice,
  fetchAllOnChainPrices,
  // Price history
  loadPriceHistoryStore,
  savePriceHistoryStore,
  recordPriceSnapshot,
  computePriceChange,
  computeLocalAltseasonSignal,
  // Order flow intelligence
  fetchTWAPDivergence,
  fetchSwapOrderFlow,
  fetchTickLiquidityDepth,
  fetchAllOnChainIntelligence,
  // Volume
  enrichVolumeData,
  // Stablecoin supply
  fetchBaseUSDCSupply,
  // Config
  parseHarvestRecipients,
} from './on-chain-prices.js';
