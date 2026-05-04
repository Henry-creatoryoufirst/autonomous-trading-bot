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
    tokens: ["ETH", "cbBTC", "cbETH", "wstETH", "LINK", "cbLTC", "cbXRP", "ZRO", "AXL"],
  },
  AI_TOKENS: {
    name: "AI & Agents",
    targetAllocation: 0.20,
    description: "AI and agent tokens - high growth potential",
    tokens: ["VIRTUAL", "AIXBT", "HIGHER", "VVV", "CLANKER", "WIRE", "ZORA", "TIBBIR"],
  },
  MEME_COINS: {
    name: "Meme Coins",
    targetAllocation: 0.15,
    description: "High risk/reward meme tokens",
    tokens: ["BRETT", "DEGEN", "TOSHI", "PEEZY", "DOGINME", "MIGGLES"],
  },
  DEFI: {
    name: "DeFi Protocols",
    targetAllocation: 0.15,
    description: "Base DeFi ecosystem tokens",
    tokens: ["AERO", "MORPHO", "RSR", "AAVE", "CRV", "ENA", "ETHFI", "WELL", "AVNT", "HYDX"],
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
  LBTC: {
    address: "0xecAc9C5F704e954931349Da37F60E39f515c11c1",
    symbol: "LBTC", name: "Lombard Staked BTC", coingeckoId: "lombard-staked-btc",
    sector: "BLUE_CHIP", riskLevel: "MEDIUM", minTradeUSD: 50, decimals: 18,
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
  LUNA: {
    address: "0x55cd6469f597452b5a7536e2cd98fde4c1247ee4",
    symbol: "LUNA", name: "Luna by Virtuals", coingeckoId: "luna-by-virtuals",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  CLANKER: {
    address: "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb",
    symbol: "CLANKER", name: "tokenbot", coingeckoId: "tokenbot-2",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  VADER: {
    address: "0x731814e491571a2e9ee3c5b1f7f3b962ee8f4870",
    symbol: "VADER", name: "VaderAI by Virtuals", coingeckoId: "vaderai-by-virtuals",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  TIBBIR: {
    address: "0x1b52e2eedaab38e198a349f50f74fc3d12722e4c",
    symbol: "TIBBIR", name: "Ribbita by Virtuals", coingeckoId: "ribbita-by-virtuals",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  AXR: {
    address: "0x58db197e91bc8cf1587f75850683e4bd0730e6bf",
    symbol: "AXR", name: "Axelrod by Virtuals", coingeckoId: "axelrod-by-virtuals",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
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
  PEEZY: {
    address: "0x1b6a569dd61edce3c383f6d565e2f79ec3a12980",
    symbol: "PEEZY", name: "Young Peezy AKA Pepe", coingeckoId: "young-peezy-aka-pepe",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  DOGINME: {
    address: "0x6921b130d297cc43754afba22e5eac0fbf8db75b",
    symbol: "DOGINME", name: "doginme", coingeckoId: "doginme",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  KEYCAT: {
    address: "0x9a26F5433671751C3276a065f57e5a02D2817973",
    symbol: "KEYCAT", name: "Keyboard Cat", coingeckoId: "keyboard-cat-base",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  MIGGLES: {
    address: "0xb1a03eda10342529bbf8eb700a06c60441fef25d",
    symbol: "MIGGLES", name: "Mr. Miggles", coingeckoId: "mister-miggles",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  DRB: {
    address: "0x3ec2156d4c0a9cbdab4a016633b7bcf6a8d68ea2",
    symbol: "DRB", name: "DebtReliefBot", coingeckoId: "debtreliefbot",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  SPX: {
    address: "0x50dA645f148798F68EF2d7dB7C1CB22A6819bb2C",
    symbol: "SPX", name: "SPX6900", coingeckoId: "spx6900",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
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
  AXL: {
    address: "0x23ee2343b892b1bb63503a4fabc840e0e2c6810f",
    symbol: "AXL", name: "Axelar", coingeckoId: "axelar",
    sector: "BLUE_CHIP", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  // === AI & AGENT TOKENS (expanded) ===
  VVV: {
    address: "0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf",
    symbol: "VVV", name: "Venice Token", coingeckoId: "venice-token",
    sector: "AI_TOKENS", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  WIRE: {
    address: "0x0b3ae50babe7ffa4e1a50569cee6bdefd4ccaee0",
    symbol: "WIRE", name: "717ai by Virtuals", coingeckoId: "717ai-by-virtuals",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 15, decimals: 18,
  },
  GAME: {
    address: "0x1c4cca7c5db003824208adda61bd749e55f463a3",
    symbol: "GAME", name: "GAME by Virtuals", coingeckoId: "game-by-virtuals",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  ZORA: {
    address: "0x1111111111166b7fe7bd91427724b487980afc69",
    symbol: "ZORA", name: "Zora", coingeckoId: "zora",
    sector: "AI_TOKENS", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
  },
  TIBBIR: {
    address: "0xa4a2e2ca3fbfe21aed83471d28b6f65a233c6e00",
    symbol: "TIBBIR", name: "Ribbita by Virtuals", coingeckoId: "ribbita-by-virtuals",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  BNKR: {
    address: "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b",
    symbol: "BNKR", name: "BankrCoin", coingeckoId: "bankercoin-2",
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
  SEAM: {
    address: "0x1C7a460413dD4e964f96D8dFC56E7223cE88CD85",
    symbol: "SEAM", name: "Seamless Protocol", coingeckoId: "seamless-protocol",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
  },
  HYDX: {
    address: "0x00000e7efa313f4e11bfff432471ed9423ac6b30",
    symbol: "HYDX", name: "Hydrex", coingeckoId: "hydrex",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
  },
  MEZO: {
    address: "0x8e4cbbcc33db6c0a18561fde1f6ba35906d4848b",
    symbol: "MEZO", name: "Mezo", coingeckoId: "mezo",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
  },
  RIVER: {
    address: "0xdA7AD9dea9397cffdDAE2F8a052B82f1484252B3",
    symbol: "RIVER", name: "River Protocol", coingeckoId: "river",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
  },
  // === MEME COINS (discovered) ===
  SKI: {
    address: "0x768be13e1680b5ebe0024c42c896e3db59ec0149",
    symbol: "SKI", name: "Ski Mask Dog", coingeckoId: "ski-mask-dog",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  BENJI: {
    address: "0xBC45647eA894030a4E9801Ec03479739FA2485F0",
    symbol: "BENJI", name: "Basenji", coingeckoId: "basenji",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  // === AUTO-DISCOVERED (scout) ===
  TIG: {
    address: "0x0C03Ce270B4826Ec62e7DD007f0B716068639F7B",
    symbol: "TIG", name: "The Innovation Game", coingeckoId: "the-innovation-game",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
  },
  KTA: {
    address: "0xc0634090F2Fe6c6d75e61Be2b949464aBB498973",
    symbol: "KTA", name: "Keeta", coingeckoId: "keeta",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
  },
  ELSA: {
    address: "0x29cc30f9d113b356ce408667aa6433589cecbdca",
    symbol: "ELSA", name: "HeyElsa", coingeckoId: "heyelsa",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  EDEL: {
    address: "0xfb31f85a8367210b2e4ed2360d2da9dc2d2ccc95",
    symbol: "EDEL", name: "Edel", coingeckoId: "edel",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
  },
  ETHY: {
    address: "0xc44141a684f6aa4e36cd9264ab55550b03c88643",
    symbol: "ETHY", name: "Ethy AI by Virtuals", coingeckoId: "ethy-ai",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  GHST: {
    address: "0xcD2F22236DD9Dfe2356D7C543161D4d260FD9BcB",
    symbol: "GHST", name: "Aavegotchi", coingeckoId: "aavegotchi",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
  },
  LMTS: {
    address: "0x9EadbE35F3Ee3bF3e28180070C429298a1b02F93",
    symbol: "LMTS", name: "Limitless", coingeckoId: "limitless-3",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
  },
  MFER: {
    address: "0xe3086852a4b125803c815a158249ae468a3254ca",
    symbol: "MFER", name: "mfercoin", coingeckoId: "mfercoin",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  OVPP: {
    address: "0x8c0d3adcf8ce094e1ae437557ec90a6374dc9bdd",
    symbol: "OVPP", name: "OpenVPP", coingeckoId: "openvpp",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
  },
  RAVE: {
    address: "0x1aa8fd5bcce2231c6100d55bf8b377cff33acfc3",
    symbol: "RAVE", name: "RaveDAO", coingeckoId: "ravedao",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  MOG: {
    address: "0x2Da56AcB9Ea78330f947bD57C54119Debda7AF71",
    symbol: "MOG", name: "Mog Coin", coingeckoId: "based-mog-coin",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  TYBG: {
    address: "0x0d97f261b1e88845184f678e2d1e7a98d9fd38de",
    symbol: "TYBG", name: "Base God", coingeckoId: "base-god",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  B3: {
    address: "0xb3b32f9f8827d4634fe7d973fa1034ec9fddb3b3",
    symbol: "B3", name: "B3 Gaming Chain", coingeckoId: "b3",
    sector: "DEFI", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  // === AUTO-DISCOVERED (scout 2026-04-26) ===
  RNBW: {
    address: "0xa53887f7e7c1bf5010b8627f1c1ba94fe7a5d6e0",
    symbol: "RNBW", name: "Rainbow Wallet Token", coingeckoId: "rainbow-3",
    sector: "DEFI", riskLevel: "HIGH", minTradeUSD: 25, decimals: 18,
  },
  // === AUTO-DISCOVERED (scout 2026-04-28) ===
  SPECTRA: {
    address: "0x64fcc3a02eeeba05ef701b7eed066c6ebd5d4e51",
    symbol: "SPECTRA", name: "Spectra", coingeckoId: "spectra-finance",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
  },
  FUN: {
    address: "0x16ee7ecac70d1028e7712751e2ee6ba808a7dd92",
    symbol: "FUN", name: "Sport.Fun", coingeckoId: "sport-fun",
    sector: "DEFI", riskLevel: "HIGH", minTradeUSD: 25, decimals: 18,
  },
  // === AUTO-DISCOVERED (scout 2026-05-01) ===
  cbADA: {
    address: "0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c",
    symbol: "cbADA", name: "Coinbase Wrapped ADA", coingeckoId: "coinbase-wrapped-ada",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18,
  },
  cbDOGE: {
    address: "0xcbD06E5A2B0C65597161de254AA074E489dEb510",
    symbol: "cbDOGE", name: "Coinbase Wrapped DOGE", coingeckoId: "coinbase-wrapped-doge",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18,
  },
  NOICE: {
    address: "0x9cb41fd9dc6891bae8187029461bfaadf6cc0c69",
    symbol: "NOICE", name: "noice", coingeckoId: "noice",
    sector: "MEME_COINS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  FAI: {
    address: "0xb33ff54b9f7242ef1593d2c9bcd8f9df46c77935",
    symbol: "FAI", name: "Freysa AI", coingeckoId: "freysa-ai",
    sector: "AI_TOKENS", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
  },
  GIZA: {
    address: "0x590830dfdf9a3f68afcdde2694773debdf267774",
    symbol: "GIZA", name: "Giza", coingeckoId: "giza",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
  },
  // === AUTO-DISCOVERED (scout 2026-05-02) ===
  KAITO: {
    address: "0x98d0baa52b2d063e780de12f615f963fe8537553",
    symbol: "KAITO", name: "Kaito", coingeckoId: "kaito",
    sector: "AI_TOKENS", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
  },
  // === AUTO-DISCOVERED (scout 2026-05-04) ===
  cbSOL: {
    address: "0x2f280d1b1c738d71a6e7adeb1a84c8f2f114594c",
    symbol: "cbSOL", name: "Coinbase Wrapped Solana", coingeckoId: "coinbase-wrapped-solana",
    sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18,
  },
  UP: {
    address: "0x5b2193fdc451c1f847be09ca9d13a4bf60f8c86b",
    symbol: "UP", name: "Superform", coingeckoId: "superform",
    sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
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
