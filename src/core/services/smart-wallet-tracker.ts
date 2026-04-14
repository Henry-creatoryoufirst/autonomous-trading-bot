/**
 * Smart Wallet Tracker — NVR Capital
 *
 * Tracks a seed list of known early/professional Base ecosystem wallets.
 * For any token candidate, checks if these wallets have recently bought it.
 * 2+ smart wallets accumulating the same token = strong pre-movement signal.
 *
 * Data source: Basescan token transfer API (free tier, 5 req/sec).
 * Requires: BASESCAN_API_KEY env var. Returns NONE signal gracefully if absent.
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
// INTERNAL TYPES (Basescan API response)
// ============================================================================

interface BasescanTokenTx {
  blockNumber: string;
  timeStamp: string;    // Unix seconds as string
  hash: string;
  from: string;
  to: string;
  value: string;        // token amount in smallest unit (needs decimals)
  tokenDecimal: string;
  contractAddress: string;
}

interface BasescanResponse {
  status: string;
  message: string;
  result: BasescanTokenTx[] | string; // string on error (e.g. "No transactions found")
}

// ============================================================================
// CONSTANTS
// ============================================================================

const BASESCAN_API_BASE = 'https://api.basescan.org/api';
const BATCH_SIZE = 3;           // Basescan free tier: 5 req/sec, use 3 for headroom
const BATCH_DELAY_MS = 250;     // 250 ms between batches
const REQUEST_TIMEOUT_MS = 8000;

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
 */
async function checkSingleWallet(
  walletId: string,
  walletAddress: string,
  tokenAddress: string,
  tokenPriceUSD: number,
  lookbackHours: number,
  apiKey: string,
): Promise<SmartWalletActivity | null> {
  try {
    const url = `${BASESCAN_API_BASE}?module=account&action=tokentx` +
      `&address=${walletAddress}` +
      `&contractaddress=${tokenAddress}` +
      `&page=1&offset=20&sort=desc` +
      `&apikey=${apiKey}`;

    const response = await axios.get<BasescanResponse>(url, {
      timeout: REQUEST_TIMEOUT_MS,
    });

    const { status, result } = response.data;

    // Basescan returns status "0" with a string message when nothing is found
    if (status !== '1' || !Array.isArray(result)) {
      return null;
    }

    const cutoffMs = Date.now() - lookbackHours * 60 * 60 * 1000;
    const walletLower = walletAddress.toLowerCase();

    // Filter to buy transactions within the lookback window.
    // A buy = the wallet is the `to` address on the ERC-20 transfer.
    const buys = result.filter((tx) => {
      const txMs = parseInt(tx.timeStamp, 10) * 1000;
      return txMs >= cutoffMs && tx.to.toLowerCase() === walletLower;
    });

    if (buys.length === 0) return null;

    // Estimate USD volume: sum token amounts accounting for decimals
    let estimatedVolumeUSD = 0;
    for (const tx of buys) {
      const decimals = parseInt(tx.tokenDecimal, 10) || 18;
      const tokenAmount = Number(tx.value) / Math.pow(10, decimals);
      estimatedVolumeUSD += tokenAmount * tokenPriceUSD;
    }

    const timestamps = buys.map((tx) => parseInt(tx.timeStamp, 10) * 1000);

    return {
      walletId,
      walletAddress,
      tokenAddress: tokenAddress.toLowerCase(),
      buyCount: buys.length,
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

  // Guard: require API key — return NONE gracefully if absent
  const apiKey = process.env.BASESCAN_API_KEY;
  if (!apiKey) {
    return NONE_SIGNAL;
  }

  const walletEntries = Object.entries(SMART_WALLETS);
  const results: SmartWalletActivity[] = [];

  // Batch wallet checks in groups of 3 to respect Basescan free tier rate limits
  for (let i = 0; i < walletEntries.length; i += BATCH_SIZE) {
    const batch = walletEntries.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(([id, addr]) =>
        checkSingleWallet(id, addr, tokenAddress, tokenPriceUSD, lookbackHours, apiKey),
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
