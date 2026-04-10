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
    tokens: ["ETH", "cbBTC", "cbETH", "wstETH", "LINK", "cbLTC", "cbXRP", "ZRO"],
  },
  AI_TOKENS: {
    name: "AI & Agents",
    targetAllocation: 0.20,
    description: "AI and agent tokens - high growth potential",
    tokens: ["VIRTUAL", "AIXBT", "HIGHER", "VVV", "LUNA"],
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
    tokens: ["AERO", "MORPHO", "RSR", "AAVE", "CRV", "ENA", "ETHFI", "WELL", "AVNT"],
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
  // === INFRASTRUCTURE (cross-chain, interop) ===
  ZRO: {
    address: "0x6985884C4392D348587B19cb9eAAf157F13271cd",
    symbol: "ZRO", name: "LayerZero", coingeckoId: "layerzero",
    sector: "BLUE_CHIP", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  // === AI & AGENT TOKENS (expanded) ===
  VVV: {
    address: "0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf",
    symbol: "VVV", name: "Venice Token", coingeckoId: "venice-token",
    sector: "AI_TOKENS", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  LUNA: {
    address: "0x55cd6469f597452b5a7536e2cd98fde4c1247ee4",
    symbol: "LUNA", name: "Luna by Virtuals", coingeckoId: "luna-by-virtuals",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  // === DEFI (expanded) ===
  WELL: {
    address: "0xA88594D404727625A9437C3f886C7643872296AE",
    symbol: "WELL", name: "Moonwell", coingeckoId: "moonwell-artemis",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  AVNT: {
    address: "0x696F9436B67233384889472Cd7cD58A6fB5DF4f1",
    symbol: "AVNT", name: "Avantis", coingeckoId: "avantis",
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

// Derived addresses (lowercase for comparison) — Base defaults
export const WETH_ADDRESS = '0x4200000000000000000000000000000000000006'.toLowerCase();
export const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase();
export const CBBTC_ADDRESS = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'.toLowerCase();
export const VIRTUAL_ADDRESS = '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b'.toLowerCase();

// ============================================================================
// ETHEREUM TOKEN REGISTRY — Used when CHAIN=ethereum
// ============================================================================

export const ETHEREUM_TOKEN_REGISTRY: Record<string, {
  address: string; symbol: string; name: string; coingeckoId: string;
  sector: SectorKey; riskLevel: "LOW" | "MEDIUM" | "HIGH"; minTradeUSD: number; decimals: number;
}> = {
  USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", name: "USD Coin", coingeckoId: "usd-coin", sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 1, decimals: 6 },
  ETH: { address: "native", symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum", sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18 },
  WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", name: "Wrapped Ether", coingeckoId: "ethereum", sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18 },
  WBTC: { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", symbol: "WBTC", name: "Wrapped BTC", coingeckoId: "bitcoin", sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 8 },
  LINK: { address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", symbol: "LINK", name: "Chainlink", coingeckoId: "chainlink", sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18 },
  UNI: { address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", symbol: "UNI", name: "Uniswap", coingeckoId: "uniswap", sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  AAVE: { address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", symbol: "AAVE", name: "Aave", coingeckoId: "aave", sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  MKR: { address: "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2", symbol: "MKR", name: "Maker", coingeckoId: "maker", sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  LDO: { address: "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32", symbol: "LDO", name: "Lido DAO", coingeckoId: "lido-dao", sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  CRV: { address: "0xD533a949740bb3306d119CC777fa900bA034cd52", symbol: "CRV", name: "Curve DAO", coingeckoId: "curve-dao-token", sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  COMP: { address: "0xc00e94Cb662C3520282E6f5717214004A7f26888", symbol: "COMP", name: "Compound", coingeckoId: "compound-governance-token", sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  SNX: { address: "0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F", symbol: "SNX", name: "Synthetix", coingeckoId: "havven", sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  ENS: { address: "0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72", symbol: "ENS", name: "Ethereum Name Service", coingeckoId: "ethereum-name-service", sector: "BLUE_CHIP", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  RPL: { address: "0xD33526068D116cE69F19A9ee46F0bd304F21A51f", symbol: "RPL", name: "Rocket Pool", coingeckoId: "rocket-pool", sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  PEPE: { address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", symbol: "PEPE", name: "Pepe", coingeckoId: "pepe", sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18 },
  SHIB: { address: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", symbol: "SHIB", name: "Shiba Inu", coingeckoId: "shiba-inu", sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18 },
  ENA: { address: "0x57e114B691Db790C35207b2e685D4A43181e6061", symbol: "ENA", name: "Ethena", coingeckoId: "ethena", sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  PENDLE: { address: "0x808507121B80c02388fAd14726482e061B8da827", symbol: "PENDLE", name: "Pendle", coingeckoId: "pendle", sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
};

// ============================================================================
// ARBITRUM TOKEN REGISTRY — Used when CHAIN=arbitrum
// ============================================================================

export const ARBITRUM_TOKEN_REGISTRY: Record<string, {
  address: string; symbol: string; name: string; coingeckoId: string;
  sector: SectorKey; riskLevel: "LOW" | "MEDIUM" | "HIGH"; minTradeUSD: number; decimals: number;
}> = {
  USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", symbol: "USDC", name: "USD Coin", coingeckoId: "usd-coin", sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 1, decimals: 6 },
  ETH: { address: "native", symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum", sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18 },
  WETH: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", symbol: "WETH", name: "Wrapped Ether", coingeckoId: "ethereum", sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18 },
  WBTC: { address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", symbol: "WBTC", name: "Wrapped BTC", coingeckoId: "bitcoin", sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 8 },
  LINK: { address: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", symbol: "LINK", name: "Chainlink", coingeckoId: "chainlink", sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18 },
  ARB: { address: "0x912CE59144191C1204E64559FE8253a0e49E6548", symbol: "ARB", name: "Arbitrum", coingeckoId: "arbitrum", sector: "BLUE_CHIP", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  GMX: { address: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a", symbol: "GMX", name: "GMX", coingeckoId: "gmx", sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  GNS: { address: "0x18c11FD286C5EC11c3b683Caa813B77f5163A122", symbol: "GNS", name: "Gains Network", coingeckoId: "gains-network", sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  RDNT: { address: "0x3082CC23568eA640225c2467653dB90e9250AaA0", symbol: "RDNT", name: "Radiant Capital", coingeckoId: "radiant-capital", sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  MAGIC: { address: "0x539bdE0d7Dbd336b79148AA742883198BBF60342", symbol: "MAGIC", name: "Magic", coingeckoId: "magic", sector: "AI_TOKENS", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  PENDLE: { address: "0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8", symbol: "PENDLE", name: "Pendle", coingeckoId: "pendle", sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  UNI: { address: "0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0", symbol: "UNI", name: "Uniswap", coingeckoId: "uniswap", sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  AAVE: { address: "0xba5DdD1f9d7F570dc94a51479a000E3BCE967196", symbol: "AAVE", name: "Aave", coingeckoId: "aave", sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  CRV: { address: "0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978", symbol: "CRV", name: "Curve DAO", coingeckoId: "curve-dao-token", sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18 },
  PEPE: { address: "0x25d887Ce7a35172C62FeBFD67a1856F20FaEbB00", symbol: "PEPE", name: "Pepe", coingeckoId: "pepe", sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18 },
};

// ============================================================================
// CHAIN-AWARE REGISTRY GETTER
// ============================================================================

/**
 * Get the token registry for a given chain name.
 * Falls back to the Base registry (default) for backwards compatibility.
 * Uses chain name string instead of importing activeChain to avoid circular deps.
 */
export function getTokenRegistryForChain(chainName: string): typeof TOKEN_REGISTRY {
  switch (chainName.toLowerCase()) {
    case 'ethereum': return ETHEREUM_TOKEN_REGISTRY;
    case 'arbitrum': return ARBITRUM_TOKEN_REGISTRY;
    default: return TOKEN_REGISTRY; // Base
  }
}
