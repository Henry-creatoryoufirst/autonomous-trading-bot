/**
 * Never Rest Capital — Token Registry & Sector Definitions
 * Extracted from agent-v3.2.ts (Phase 2 refactor)
 *
 * Static configuration for all tracked tokens, sector allocations,
 * and quote token metadata.
 */

// ============================================================================
// SECTOR DEFINITIONS — Portfolio allocation targets
// ============================================================================

export const SECTORS = {
  BLUE_CHIP: {
    name: "Blue Chip",
    targetAllocation: 0.45,
    description: "Safe, liquid assets - ETH, BTC",
    tokens: ["ETH", "cbBTC", "cbETH", "wstETH", "LINK", "cbLTC", "cbXRP"],
  },
  AI_TOKENS: {
    name: "AI & Agents",
    targetAllocation: 0.20,
    description: "AI and agent tokens - high growth potential",
    tokens: ["VIRTUAL", "AIXBT", "HIGHER"],
  },
  MEME_COINS: {
    name: "Meme Coins",
    targetAllocation: 0.15,
    description: "High risk/reward meme tokens",
    tokens: ["BRETT", "DEGEN", "TOSHI"],
  },
  DEFI: {
    name: "DeFi Protocols",
    targetAllocation: 0.15,
    description: "Base DeFi ecosystem tokens",
    tokens: ["AERO", "MORPHO", "RSR", "AAVE", "CRV", "ENA", "ETHFI"],
  },
  TOKENIZED_STOCKS: {
    name: "Tokenized RWAs",
    targetAllocation: 0.05,
    description: "Tokenized equities and RWAs — S&P 500, stocks via Centrifuge/Backed on Base",
    tokens: ["bCOIN", "deSPXA"],
  },
} as const;

export type SectorKey = keyof typeof SECTORS;

// ============================================================================
// SWAP ROUTING — Tokens requiring special handling
// ============================================================================

/** Tokens that CDP SDK's routing service cannot swap (returns "Invalid request") */
export const CDP_UNSUPPORTED_TOKENS = new Set(['AIXBT', 'DEGEN', 'VIRTUAL']);

/** Tokens that CDP SDK can't swap but CAN be traded via direct DEX swap */
export const DEX_SWAP_TOKENS = new Set(['MORPHO', 'cbLTC', 'deSPXA']);

// ============================================================================
// TOKEN REGISTRY — Complete token metadata
// ============================================================================

export const TOKEN_REGISTRY: Record<string, {
  address: string;
  symbol: string;
  name: string;
  coingeckoId: string;
  sector: SectorKey;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  minTradeUSD: number;
  decimals: number;
}> = {
  // === STABLECOINS ===
  USDC: {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    symbol: "USDC", name: "USD Coin", coingeckoId: "usd-coin",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 1, decimals: 6,
  },
  // === BLUE CHIP (45%) ===
  ETH: {
    address: "native",
    symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18,
  },
  WETH: {
    address: "0x4200000000000000000000000000000000000006",
    symbol: "WETH", name: "Wrapped Ethereum", coingeckoId: "ethereum",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18,
  },
  cbBTC: {
    address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    symbol: "cbBTC", name: "Coinbase Wrapped BTC", coingeckoId: "bitcoin",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 8,
  },
  cbETH: {
    address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    symbol: "cbETH", name: "Coinbase Staked ETH", coingeckoId: "coinbase-wrapped-staked-eth",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18,
  },
  wstETH: {
    address: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
    symbol: "wstETH", name: "Wrapped Lido Staked ETH", coingeckoId: "wrapped-steth",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18,
  },
  LINK: {
    address: "0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196",
    symbol: "LINK", name: "Chainlink", coingeckoId: "chainlink",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18,
  },
  cbLTC: {
    address: "0xcb17C9Db87B595717C857a08468793f5bAb6445F",
    symbol: "cbLTC", name: "Coinbase Wrapped LTC", coingeckoId: "litecoin",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 8,
  },
  cbXRP: {
    address: "0xcb585250f852C6c6bf90434AB21A00f02833a4af",
    symbol: "cbXRP", name: "Coinbase Wrapped XRP", coingeckoId: "ripple",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 6,
  },
  // === AI & AGENT TOKENS (20%) ===
  VIRTUAL: {
    address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
    symbol: "VIRTUAL", name: "Virtuals Protocol", coingeckoId: "virtual-protocol",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
  },
  AIXBT: {
    address: "0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825",
    symbol: "AIXBT", name: "aixbt by Virtuals", coingeckoId: "aixbt",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
  },
  HIGHER: {
    address: "0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe",
    symbol: "HIGHER", name: "Higher", coingeckoId: "higher",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
  },
  // === MEME COINS (15%) ===
  BRETT: {
    address: "0x532f27101965dd16442E59d40670FaF5eBB142E4",
    symbol: "BRETT", name: "Brett", coingeckoId: "brett",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
  },
  DEGEN: {
    address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
    symbol: "DEGEN", name: "Degen", coingeckoId: "degen-base",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
  },
  TOSHI: {
    address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4",
    symbol: "TOSHI", name: "Toshi", coingeckoId: "toshi",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
  },
  // === DEFI PROTOCOLS (15%) ===
  AERO: {
    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    symbol: "AERO", name: "Aerodrome Finance", coingeckoId: "aerodrome-finance",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  AAVE: {
    address: "0x63706e401c06ac8513145b7687a14804d17f814b",
    symbol: "AAVE", name: "Aave", coingeckoId: "aave",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  CRV: {
    address: "0x8Ee73c484A26e0A5df2Ee2a4960B789967dd0415",
    symbol: "CRV", name: "Curve DAO", coingeckoId: "curve-dao-token",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  ENA: {
    address: "0x58538e6A46E07434d7E7375Bc268D3cb839C0133",
    symbol: "ENA", name: "Ethena", coingeckoId: "ethena",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  ETHFI: {
    address: "0x6c240DDA6b5c336DF09A4D011139beAAA1eA2aa2",
    symbol: "ETHFI", name: "Ether.fi", coingeckoId: "ether-fi",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  MORPHO: {
    address: "0xBAa5CC21fd487B8Fcc2F632f3F4E8D37262a0842",
    symbol: "MORPHO", name: "Morpho", coingeckoId: "morpho",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  // v21.2: PENDLE kept for SELL-ONLY (removed from DEFI sector tokens list so bot won't buy)
  PENDLE: {
    address: "0xA99F6e6785Da0F5d6fB42495Fe424BCE029Eeb3E",
    symbol: "PENDLE", name: "Pendle", coingeckoId: "pendle",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  RSR: {
    address: "0xaB36452DbAC151bE02b16Ca17d8919826072f64a",
    symbol: "RSR", name: "Reserve Rights", coingeckoId: "reserve-rights-token",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  // === TOKENIZED STOCKS (5%) ===
  bCOIN: {
    address: "0xbbcb0356bb9e6b3faa5cbf9e5f36185d53403ac9",
    symbol: "bCOIN", name: "Backed Coinbase Stock", coingeckoId: "",
    sector: "TOKENIZED_STOCKS", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
  },
  deSPXA: {
    address: "0x9c5C365e764829876243d0b289733B9D2b729685",
    symbol: "deSPXA", name: "Centrifuge S&P 500", coingeckoId: "",
    sector: "TOKENIZED_STOCKS", riskLevel: "LOW", minTradeUSD: 25, decimals: 18,
  },
};

// ============================================================================
// QUOTE TOKEN DECIMALS — For DEX pool price computation
// ============================================================================

export const QUOTE_DECIMALS: Record<string, number> = {
  WETH: 18, USDC: 6, cbBTC: 8, VIRTUAL: 18,
};

// Derived addresses (lowercase for comparison)
export const WETH_ADDRESS = '0x4200000000000000000000000000000000000006'.toLowerCase();
export const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase();
export const CBBTC_ADDRESS = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'.toLowerCase();
export const VIRTUAL_ADDRESS = '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b'.toLowerCase();
