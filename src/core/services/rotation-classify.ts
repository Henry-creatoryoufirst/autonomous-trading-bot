/**
 * NVR Capital — Rotation Indexer: pure classification helpers.
 *
 * These functions turn raw ERC-20 Transfer logs into `WalletEvent`s. Kept
 * pure so they can be unit-tested without RPC.
 */

import type { EventDirection, EventVenue, WalletEvent } from './rotation-types.js';

/**
 * ERC-20 `Transfer(address indexed from, address indexed to, uint256 value)`
 * canonical topic0.
 */
export const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * Known DEX router / aggregator addresses on Base. When a token flows to/from
 * one of these in the same tx as our wallet, we tag the venue accordingly.
 *
 * Source: chain-config.ts `dexRouters` + canonical aggregator addresses.
 * Kept local (rather than importing) so this module stays RPC-free + easy to
 * test. If the canonical list drifts, update both.
 */
export const KNOWN_VENUES: Record<string, EventVenue> = {
  // Aerodrome Slipstream router (Base)
  '0xbe6d8f0d05cc4be24d5167a3ef062215be6d18a5': 'aerodrome',
  // Uniswap Universal Router (Base)
  '0x2626664c2603336e57b271c5c0b26f421741e481': 'uniswap-v3',
  // Uniswap Universal Router (newer variant on Base, commonly observed)
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': 'uniswap-v3',
  // 1inch Aggregation Router V6 (multichain, same address on Base)
  '0x111111125421ca6dc452d289314280a0f8842a65': '1inch',
  // LI.FI diamond (multichain)
  '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae': 'lifi',
};

/** Address-like hex validation — EVM addresses are 20 bytes = 42 chars with 0x. */
const HEX_ADDRESS_RE = /^0x[0-9a-f]{40}$/;

/**
 * Normalize a candidate address: lowercase, reject malformed input.
 * Throws on invalid input rather than silently coercing — caller decides
 * how to handle it.
 */
export function normalizeAddress(addr: string): string {
  const lower = addr.toLowerCase();
  if (!HEX_ADDRESS_RE.test(lower)) {
    throw new Error(`normalizeAddress: '${addr}' is not a 20-byte hex address.`);
  }
  return lower;
}

/**
 * Extract the 20-byte address from a 32-byte topic value. Transfer topics 1
 * and 2 are left-padded addresses. Returns lowercased 0x-prefixed address.
 */
export function topicToAddress(topic: string): string {
  if (typeof topic !== 'string' || topic.length !== 66 || !topic.startsWith('0x')) {
    throw new Error(`topicToAddress: invalid 32-byte topic '${topic}'`);
  }
  // Last 40 hex chars = 20-byte address.
  return '0x' + topic.slice(-40).toLowerCase();
}

/**
 * Parse a hex uint256 `data` field into a JS number scaled by the token's
 * decimals. Acceptable precision loss at trade sizes we care about (>$500
 * USD) — typical DEX trade raw values comfortably fit in 53-bit mantissa
 * once divided by 10^decimals.
 *
 * Still, cap at 1e18 raw-to-scaled boundary to avoid silent infinities for
 * broken inputs.
 */
export function parseAmountHex(dataHex: string, decimals: number): number {
  if (typeof dataHex !== 'string' || !dataHex.startsWith('0x')) {
    throw new Error(`parseAmountHex: invalid hex '${dataHex}'`);
  }
  // Strip the 0x and leading zeros for BigInt parsing.
  const raw = BigInt(dataHex.length === 2 ? '0x0' : dataHex);
  if (decimals < 0 || decimals > 36) {
    throw new Error(`parseAmountHex: nonsensical decimals ${decimals}`);
  }
  // For values that fit in Number safely:
  const scaled = Number(raw) / Math.pow(10, decimals);
  if (!Number.isFinite(scaled)) {
    throw new Error(`parseAmountHex: non-finite result from raw=${raw} decimals=${decimals}`);
  }
  return scaled;
}

/**
 * Given a tx's full log set + one of our tracked wallets, determine which
 * venue (if any) touched the token in the same tx. Heuristic: if ANY log in
 * the same tx has a KNOWN_VENUES address in from or to, tag the event with
 * that venue. If multiple match, the first one wins (order doesn't matter
 * much — all are venues, we just need a label).
 */
export function inferVenueFromTxLogs(
  txLogs: ReadonlyArray<{ topics: string[]; address: string }>,
): EventVenue {
  for (const log of txLogs) {
    const contract = log.address.toLowerCase();
    if (KNOWN_VENUES[contract]) return KNOWN_VENUES[contract];
    // Also check Transfer-style topics: if a KNOWN_VENUES address appears
    // as from/to of another Transfer in the tx, that's a strong venue hint.
    if (log.topics?.[0] === TRANSFER_TOPIC) {
      for (const t of [log.topics[1], log.topics[2]]) {
        if (!t) continue;
        try {
          const a = topicToAddress(t);
          if (KNOWN_VENUES[a]) return KNOWN_VENUES[a];
        } catch { /* skip malformed */ }
      }
    }
  }
  return 'unknown';
}

/**
 * A raw ERC-20 Transfer log as returned by `eth_getLogs`, narrowed to the
 * fields we use. Keeping the shape small + explicit so tests can construct
 * fixtures without importing viem types.
 */
export interface RawTransferLog {
  address: string;         // token contract
  topics: string[];         // [TRANSFER_TOPIC, from-topic, to-topic]
  data: string;            // uint256 value, hex
  transactionHash: string;
  blockNumber: number;
  blockTimestamp: number;  // unix seconds
  /** Optional — all logs from the same tx, for venue inference. */
  txLogs?: ReadonlyArray<{ topics: string[]; address: string }>;
}

/**
 * Classify a single Transfer log as a `WalletEvent` from the perspective of
 * `trackedWallet`. Returns null if the log does not involve `trackedWallet`
 * as either sender or recipient.
 *
 * @param log                raw Transfer log
 * @param trackedWallet      lowercased address of the tracked wallet
 * @param tokenDecimals      decimals for the token (from our registry or
 *                           token metadata cache)
 * @param tokenSymbol        symbol if known, else null
 * @param venue              optional venue override (e.g. caller did its own
 *                           inference). If omitted, we call
 *                           inferVenueFromTxLogs on log.txLogs.
 */
export function classifyTransfer(
  log: RawTransferLog,
  trackedWallet: string,
  tokenDecimals: number,
  tokenSymbol: string | null,
  venue?: EventVenue,
): WalletEvent | null {
  if (!log.topics || log.topics[0] !== TRANSFER_TOPIC) return null;
  if (log.topics.length < 3) return null;

  const fromAddr = topicToAddress(log.topics[1]);
  const toAddr = topicToAddress(log.topics[2]);
  const wallet = trackedWallet.toLowerCase();

  let direction: EventDirection;
  if (toAddr === wallet) direction = 'IN';
  else if (fromAddr === wallet) direction = 'OUT';
  else return null; // log not relevant to this wallet

  const amountToken = parseAmountHex(log.data, tokenDecimals);
  // Filter out dust / zero transfers — they pollute the event log without
  // carrying signal. Threshold is at the raw-unit level; 0 always filters.
  if (amountToken <= 0) return null;

  const resolvedVenue =
    venue ?? (log.txLogs ? inferVenueFromTxLogs(log.txLogs) : 'unknown');

  return {
    walletAddress: wallet,
    tokenAddress: log.address.toLowerCase(),
    tokenSymbol,
    direction,
    amountToken,
    amountUSD: null, // Phase 1: pricing added in Phase 2
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    timestampMs: log.blockTimestamp * 1000,
    venue: resolvedVenue,
  };
}
