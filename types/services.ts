/**
 * Never Rest Capital — Service & Infrastructure Types
 * Extracted from agent-v3.2.ts (Phase 3b refactor)
 */


// ============================================================================
// DEX POOL REGISTRY
// ============================================================================

export interface PoolRegistryEntry {
  poolAddress: string;
  poolType: 'uniswapV3' | 'aerodrome' | 'aerodromeV3';
  quoteToken: 'WETH' | 'USDC' | 'cbBTC' | 'VIRTUAL';
  token0IsBase: boolean;
  token0Decimals: number;
  token1Decimals: number;
  dexName: string;
  liquidityUSD: number;
  consecutiveFailures: number;
  tickSpacing?: number;
}

export interface PoolRegistryFile {
  version: number;
  discoveredAt: string;
  pools: Record<string, PoolRegistryEntry>;
}

export interface PoolLiquidity {
  liquidityUSD: number;
  pairAddress: string;
  dexName: string;
  priceUSD: number;
  fetchedAt: number;
}

// ============================================================================
// PRICE HISTORY
// ============================================================================

export interface PriceHistoryStore {
  version: 1;
  lastSaved: string;
  tokens: Record<string, {
    timestamps: number[];
    prices: number[];
    volumes: number[];
  }>;
}

// ============================================================================
// ON-CHAIN CAPITAL FLOWS
// ============================================================================

export interface OnChainCapitalFlows {
  totalDeposited: number;
  totalWithdrawn: number;
  netCapitalIn: number;
  deposits: Array<{ timestamp: string; amountUSD: number; from: string; txHash: string }>;
  withdrawals: Array<{ timestamp: string; amountUSD: number; to: string; txHash: string }>;
  lastUpdated: string;
}

export interface BasescanTransfer {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  contractAddress: string;
  value: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
}
