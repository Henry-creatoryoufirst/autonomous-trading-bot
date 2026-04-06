/**
 * NVR Capital — Multi-Chain Configuration (v21.3)
 *
 * Defines per-chain configuration for Base, Ethereum, and Arbitrum.
 * Selected at startup via CHAIN env var (default: "base").
 * Each bot instance runs on ONE chain — no cross-chain trading.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ChainConfig {
  /** Human-readable chain name */
  name: string;
  /** EVM chain ID */
  chainId: number;
  /** CDP SDK network identifier */
  cdpNetwork: string;
  /** RPC endpoints in priority order (first = preferred) */
  rpcEndpoints: readonly string[];
  /** Native token symbol */
  nativeToken: string;

  /** USDC contract on this chain */
  usdc: { address: string; decimals: number };
  /** Wrapped ETH contract on this chain */
  weth: { address: string };

  /** Block explorer configuration */
  explorer: {
    name: string;
    url: string;
    apiUrl: string;
    /** Some explorers (Etherscan, Arbiscan) require an API key */
    apiKeyEnvVar?: string;
  };

  /** DEX aggregator endpoints */
  dexAggregators: {
    zeroXBaseUrl: string;
    oneInchChainId: number;
  };

  /** Available DEX routers on this chain */
  dexRouters: {
    uniswapV3?: { router: string; quoter?: string };
    aerodromeSlipstream?: { router: string };
    sushiswap?: { router: string };
  };

  /** Yield protocol addresses (undefined = not available on this chain) */
  yieldProtocols: {
    aaveV3?: { pool: string; aUsdc: string };
    morpho?: { vault: string };
  };

  /** GeckoTerminal network slug for API calls */
  geckoTerminalNetwork: string;
  /** DexScreener chain identifier */
  dexScreenerChainId: string;
}

// ============================================================================
// BASE (Chain ID 8453) — Current default
// ============================================================================

const BASE_CONFIG: ChainConfig = {
  name: 'Base',
  chainId: 8453,
  cdpNetwork: 'base',
  rpcEndpoints: [
    'https://rpc.flashbots.net/fast?chainId=8453',
    'https://mainnet-sequencer.base.org',
    'https://1rpc.io/base',
    'https://mainnet.base.org',
    'https://base.meowrpc.com',
    'https://base.drpc.org',
  ],
  nativeToken: 'ETH',
  usdc: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
  weth: { address: '0x4200000000000000000000000000000000000006' },
  explorer: {
    name: 'BaseScan',
    url: 'https://basescan.org',
    apiUrl: 'https://base.blockscout.com/api',
  },
  dexAggregators: {
    zeroXBaseUrl: 'https://base.api.0x.org',
    oneInchChainId: 8453,
  },
  dexRouters: {
    uniswapV3: { router: '0x2626664c2603336E57B271c5C0b26F421741e481' },
    aerodromeSlipstream: { router: '0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5' },
  },
  yieldProtocols: {
    aaveV3: {
      pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
      aUsdc: '0x4e65fE4DBa92790696d040ac24Aa414708F5c0AB',
    },
    morpho: {
      vault: '0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca',
    },
  },
  geckoTerminalNetwork: 'base',
  dexScreenerChainId: 'base',
};

// ============================================================================
// ETHEREUM MAINNET (Chain ID 1)
// ============================================================================

const ETHEREUM_CONFIG: ChainConfig = {
  name: 'Ethereum',
  chainId: 1,
  cdpNetwork: 'ethereum',
  rpcEndpoints: [
    'https://rpc.flashbots.net/fast',
    'https://1rpc.io/eth',
    'https://eth.drpc.org',
    'https://rpc.ankr.com/eth',
    'https://ethereum-rpc.publicnode.com',
  ],
  nativeToken: 'ETH',
  usdc: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  weth: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
  explorer: {
    name: 'Etherscan',
    url: 'https://etherscan.io',
    apiUrl: 'https://api.etherscan.io/api',
    apiKeyEnvVar: 'ETHERSCAN_API_KEY',
  },
  dexAggregators: {
    zeroXBaseUrl: 'https://api.0x.org',
    oneInchChainId: 1,
  },
  dexRouters: {
    uniswapV3: { router: '0xE592427A0AEce92De3Edee1F18E0157C05861564' },
    // No Aerodrome on Ethereum
  },
  yieldProtocols: {
    aaveV3: {
      pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
      aUsdc: '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c',
    },
    // No Morpho vault configured yet for Ethereum
  },
  geckoTerminalNetwork: 'eth',
  dexScreenerChainId: 'ethereum',
};

// ============================================================================
// ARBITRUM ONE (Chain ID 42161)
// ============================================================================

const ARBITRUM_CONFIG: ChainConfig = {
  name: 'Arbitrum',
  chainId: 42161,
  cdpNetwork: 'arbitrum',
  rpcEndpoints: [
    'https://arb1.arbitrum.io/rpc',
    'https://1rpc.io/arb',
    'https://arbitrum.drpc.org',
    'https://rpc.ankr.com/arbitrum',
    'https://arbitrum-one-rpc.publicnode.com',
  ],
  nativeToken: 'ETH',
  usdc: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
  weth: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' },
  explorer: {
    name: 'Arbiscan',
    url: 'https://arbiscan.io',
    apiUrl: 'https://api.arbiscan.io/api',
    apiKeyEnvVar: 'ARBISCAN_API_KEY',
  },
  dexAggregators: {
    zeroXBaseUrl: 'https://arbitrum.api.0x.org',
    oneInchChainId: 42161,
  },
  dexRouters: {
    uniswapV3: { router: '0xE592427A0AEce92De3Edee1F18E0157C05861564' },
    sushiswap: { router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506' },
    // No Aerodrome on Arbitrum
  },
  yieldProtocols: {
    aaveV3: {
      pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
      aUsdc: '0x724dc807b04555b71ed48a6896b6F41593b8C637',
    },
  },
  geckoTerminalNetwork: 'arbitrum',
  dexScreenerChainId: 'arbitrum',
};

// ============================================================================
// CHAIN REGISTRY & ACTIVE CHAIN
// ============================================================================

const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  base: BASE_CONFIG,
  ethereum: ETHEREUM_CONFIG,
  arbitrum: ARBITRUM_CONFIG,
};

/** All supported chain names */
export const SUPPORTED_CHAINS = Object.keys(CHAIN_CONFIGS) as readonly string[];

/**
 * Get chain config by name.
 * @throws if chain name is not supported
 */
export function getChainConfig(chainName: string): ChainConfig {
  const config = CHAIN_CONFIGS[chainName.toLowerCase()];
  if (!config) {
    throw new Error(
      `Unsupported chain "${chainName}". Supported: ${SUPPORTED_CHAINS.join(', ')}`
    );
  }
  return config;
}

/**
 * Active chain configuration — resolved once at module load from CHAIN env var.
 * Defaults to "base" for full backwards compatibility.
 */
export const activeChain: ChainConfig = getChainConfig(process.env.CHAIN || 'base');

// Log which chain is active (only if not Base, to avoid noise on existing deployments)
if (activeChain.chainId !== 8453) {
  console.log(`[Chain] Active: ${activeChain.name} (chainId=${activeChain.chainId}, cdp=${activeChain.cdpNetwork})`);
}
