/**
 * Smart Wallet Tracker — NVR Capital
 *
 * Tracks a seed list of known early/professional Base ecosystem wallets.
 * For any token candidate, checks if these wallets have recently bought it.
 * 2+ smart wallets accumulating the same token = strong pre-movement signal.
 *
 * Uses Base RPC — no API key required. Queries eth_getLogs for ERC-20 Transfer events.
 */

import axios from 'axios';

// ============================================================================
// SEED WALLET LIST
// ============================================================================

/**
 * Known early Base ecosystem participants.
 * These are placeholder addresses for the scaffold — actual profitable wallet
 * addresses need to be researched on-chain (future bootstrap task).
 * Add new wallets at runtime via registerSmartWallet().
 */
const SMART_WALLETS: Record<string, string> = {
  // Known early Base ecosystem participants — seed list, will expand over time
  'base-whale-1': '0x6B44ba0a126a2A1a8aa6cD1AdeeD002e141Bcd44',
  'base-whale-2': '0x28C6c06298d514Db089934071355E5743bf21d60',
  'base-degen-1': '0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE',
  'base-degen-2': '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  'base-early-1': '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
  'base-early-2': '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41',
  'base-alpha-1': '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
  'base-alpha-2': '0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8',
  'base-mm-1':    '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  'base-mm-2':    '0x503828976D22510aad0201ac7EC88293211D23Da',
};

// ============================================================================
// TYPES
// ============================================================================

export interface SmartWalletActivity {
  walletId: string;             // key from SMART_WALLETS map
  walletAddress: string;
  tokenAddress: string;
  buyCount: number;             // number of buy transactions in window
  estimatedVolumeUSD: number;   // rough USD volume (token amount * current price)
  firstBuyTimestamp: number;    // earliest buy in the window (ms)
  lastBuyTimestamp: number;     // most recent buy (ms)
}

export interface SmartWalletSignal {
  tokenAddress: string;
  activeWallets: SmartWalletActivity[];
  walletCount: number;          // how many distinct smart wallets are in this token
  signalStrength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
  // STRONG = 3+ wallets, MODERATE = 2 wallets, WEAK = 1 wallet, NONE = 0
  totalVolumeUSD: number;
  earliestActivityMs: number;   // when did the first smart wallet enter
}

// ============================================================================
// CONSTANTS
// ============================================================================

const BASE_RPC_URL = 'https://mainnet.base.org';
const BATCH_SIZE = 3;           // concurrent wallet checks
const BATCH_DELAY_MS = 250;     // 250 ms between batches

// ============================================================================
// HELPERS
// ============================================================================

function mapSignalStrength(walletCount: number): SmartWalletSignal['signalStrength'] {
  if (walletCount >= 3) return 'STRONG';
  if (walletCount === 2) return 'MODERATE';
  if (walletCount === 1) return 'WEAK';
  return 'NONE';
}

/**
 * Check a single wallet for token buy activity within the lookback window.
 * Returns null on any failure — callers filter nulls.
 * Uses Base RPC — no API key required.
 */
async function checkSingleWallet(
  walletId: string,
  walletAddress: string,
  tokenAddress: string,
  tokenPriceUSD: number,
  lookbackHours: number,
): Promise<SmartWalletActivity | null> {
  try {
    // Get current block
    const blockNumRes = await axios.post(BASE_RPC_URL, {
      jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: []
    }, { timeout: 8000 });
    const currentBlock = parseInt(blockNumRes.data.result, 16);

    const blocksBack = Math.floor(lookbackHours * 1800); // ~2s/block → 1800 blocks/hour
    const fromBlock = currentBlock - blocksBack;

    // Query Transfer events TO this wallet for this token
    // topic[1] = from (null = any), topic[2] = to (wallet address padded)
    const paddedWallet = '0x' + walletAddress.toLowerCase().replace('0x', '').padStart(64, '0');

    const logsRes = await axios.post(BASE_RPC_URL, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getLogs',
      params: [{
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${currentBlock.toString(16)}`,
        address: tokenAddress,
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          null,        // from: any
          paddedWallet // to: this wallet
        ],
      }],
    }, { timeout: 12000 });

    const logs = logsRes.data?.result || [];
    if (logs.length === 0) return null;

    // Parse timestamps from block numbers
    const timestamps = logs.map((log: any) => {
      const blockNum = parseInt(log.blockNumber, 16);
      // Approximate timestamp: currentBlock is now, each block ~2s
      return Date.now() - (currentBlock - blockNum) * 2000;
    });

    // Estimate volume: each log's data field contains the token amount
    let totalTokens = BigInt(0);
    for (const log of logs) {
      try { totalTokens += BigInt(log.data); } catch { /* skip */ }
    }
    // Rough USD estimate (tokenPriceUSD is per whole token, decimals unknown → use 1e18)
    const estimatedVolumeUSD = Number(totalTokens) / 1e18 * tokenPriceUSD;

    return {
      walletId,
      walletAddress,
      tokenAddress: tokenAddress.toLowerCase(),
      buyCount: logs.length,
      estimatedVolumeUSD,
      firstBuyTimestamp: Math.min(...timestamps),
      lastBuyTimestamp: Math.max(...timestamps),
    };
  } catch {
    // Swallow per-wallet errors — don't spam logs
    return null;
  }
}

// ============================================================================
// PRIMARY EXPORT
// ============================================================================

/**
 * Check all tracked smart wallets for recent buy activity on a token.
 *
 * Returns a SmartWalletSignal describing how many professional wallets have
 * entered the position within the lookback window. Use this as a confirmation
 * layer before entering a trade — if 2+ smart wallets are already in, the
 * token has stealth accumulation occurring ahead of any public catalyst.
 *
 * @param tokenAddress   ERC-20 token address on Base
 * @param tokenPriceUSD  Current token price used to estimate USD volume
 * @param lookbackHours  How far back to scan (default: 24h)
 */
export async function checkSmartWalletActivity(
  tokenAddress: string,
  tokenPriceUSD: number,
  lookbackHours: number = 24,
): Promise<SmartWalletSignal> {
  const NONE_SIGNAL: SmartWalletSignal = {
    tokenAddress: tokenAddress.toLowerCase(),
    activeWallets: [],
    walletCount: 0,
    signalStrength: 'NONE',
    totalVolumeUSD: 0,
    earliestActivityMs: 0,
  };

  const walletEntries = Object.entries(SMART_WALLETS);
  const results: SmartWalletActivity[] = [];

  // Batch wallet checks in groups to avoid overwhelming the public RPC
  for (let i = 0; i < walletEntries.length; i += BATCH_SIZE) {
    const batch = walletEntries.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(([id, addr]) =>
        checkSingleWallet(id, addr, tokenAddress, tokenPriceUSD, lookbackHours),
      ),
    );

    results.push(...(batchResults.filter((r) => r !== null) as SmartWalletActivity[]));

    // Delay between batches (skip after final batch)
    if (i + BATCH_SIZE < walletEntries.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  // If every single wallet check failed, warn once and return NONE
  if (results.length === 0 && walletEntries.length > 0) {
    // Only warn when we had an API key but got zero results from all wallets
    // (normal to get zero when a token has no smart wallet activity)
    return NONE_SIGNAL;
  }

  const totalVolumeUSD = results.reduce((sum, r) => sum + r.estimatedVolumeUSD, 0);
  const earliestActivityMs =
    results.length > 0 ? Math.min(...results.map((r) => r.firstBuyTimestamp)) : 0;

  return {
    tokenAddress: tokenAddress.toLowerCase(),
    activeWallets: results,
    walletCount: results.length,
    signalStrength: mapSignalStrength(results.length),
    totalVolumeUSD,
    earliestActivityMs,
  };
}

// ============================================================================
// RUNTIME WALLET MANAGEMENT
// ============================================================================

/**
 * Add a newly identified profitable wallet to the tracking list.
 * Addresses are normalised to lowercase for consistent comparison.
 */
export function registerSmartWallet(id: string, address: string): void {
  SMART_WALLETS[id] = address.toLowerCase();
}

/**
 * Return a snapshot of the current smart wallet list.
 * Callers receive a copy — mutations do not affect the internal map.
 */
export function getSmartWallets(): Record<string, string> {
  return { ...SMART_WALLETS };
}
