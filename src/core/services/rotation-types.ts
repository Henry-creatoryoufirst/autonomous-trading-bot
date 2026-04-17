/**
 * NVR Capital — Cross-Token Rotation Detector: shared types.
 *
 * Per NVR-SPEC-011. These types are shared between the indexer (Phase 1),
 * the detector (Phase 3), and any sleeve that consumes rotation signals.
 *
 * PHASE 1 STATUS: The indexer emits `WalletEvent`s into a ring buffer and a
 * daily JSONL file. Nothing consumes those events yet — observation only.
 * The detector + signal types live here for forward compatibility.
 */

/** Where the event was observed — lets us down-weight aggregator passthrough. */
export type EventVenue =
  | 'aerodrome'
  | 'uniswap-v3'
  | 'uniswap-v4'
  | '1inch'
  | 'lifi'
  | 'transfer' // plain ERC-20 transfer with no recognized router
  | 'unknown';

/** Direction from the tracked wallet's perspective. */
export type EventDirection = 'IN' | 'OUT';

/** A single token-level action by a tracked wallet. */
export interface WalletEvent {
  /** Tracked wallet address (lowercased). */
  walletAddress: string;
  /** Token contract address (lowercased). */
  tokenAddress: string;
  /** Token symbol if we know it. null when unknown (fill in later). */
  tokenSymbol: string | null;
  /** IN = wallet received (likely buy); OUT = wallet sent (likely sell). */
  direction: EventDirection;
  /** Token units at native decimals (post-decimals). Kept as number for v1;
   *  acceptable precision loss at the wallet-level trade sizes we care about. */
  amountToken: number;
  /**
   * Estimated USD value at the block timestamp. `null` in Phase 1 — pricing
   * is added in Phase 2. Consumers MUST treat null as "unknown", not zero.
   */
  amountUSD: number | null;
  txHash: string;
  blockNumber: number;
  /** Unix ms of the block timestamp. */
  timestampMs: number;
  /** Router/DEX hint, best-effort. 'unknown' when we can't identify a venue. */
  venue: EventVenue;
}

/** Health snapshot for diagnostics + dashboard. */
export interface RotationIndexerHealth {
  /** Is the loop actively polling? */
  running: boolean;
  /** Number of wallets in the tracked set. */
  trackedWallets: number;
  /** Last block we finished indexing. */
  lastIndexedBlock: number;
  /** Approx. blocks behind chain tip at last tick. */
  lagBlocks: number;
  /** Events captured in the rolling last hour (sliding window). */
  eventsIngestedLast1h: number;
  /** Events captured since process start. */
  eventsIngestedSinceStart: number;
  /** Current ring-buffer occupancy (events not yet drained). */
  bufferSize: number;
  /** Max size of the ring buffer — when full, oldest events are dropped. */
  bufferCapacity: number;
  /** Events dropped because the buffer was full. Lifetime counter. */
  eventsDroppedOverflow: number;
  /** ISO timestamp of the most recent successful tick. null if none yet. */
  lastTickAt: string | null;
  /** Path of today's event log file. null when file-logging is disabled. */
  eventLogPath: string | null;
}
