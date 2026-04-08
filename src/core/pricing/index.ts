/**
 * Never Rest Capital — On-Chain Pricing Module
 * Extracted from agent-v3.2.ts (Phase 15 refactor)
 *
 * Chainlink oracle reads, DEX pool discovery, on-chain token pricing.
 */

export {
  initOnChainPricing,
  fetchChainlinkPrices,
  fetchChainlinkETHPrice,
  fetchChainlinkBTCPrice,
  fetchChainlinkLINKPrice,
  probePoolType,
  discoverPoolAddresses,
  fetchOnChainTokenPrice,
  fetchAllOnChainPrices,
  getPoolRegistry,
  getLastPoolTicks,
  getLastOnChainIntelligence,
  setLastOnChainIntelligence,
  getChainlinkDeviations,
} from './on-chain-pricing.js';

export type { OnChainPricingDeps } from './on-chain-pricing.js';
