/**
 * NVR Capital — Cross-Token Rotation Indexer (NVR-SPEC-011 Phase 1).
 *
 * A long-lived loop that polls Base for ERC-20 Transfer events involving our
 * tracked-wallet set, classifies each event, and writes it to:
 *   1. an in-memory ring buffer (drained by the heavy cycle, when wired), and
 *   2. a daily JSONL file `data/rotation-events-YYYY-MM-DD.jsonl`.
 *
 * PHASE 1 SCOPE: observation only. No detection, no signal emission, no
 * sleeve integration. The detector (Phase 3) will consume the buffer.
 *
 * INTENTIONAL LIMITS:
 *   - USD pricing is not computed. Every event has `amountUSD: null`. Phase 2
 *     adds pricing once we have confidence the wallet set + event capture are
 *     healthy.
 *   - The tracked wallet set is the 20 seeds from `smart-wallet-tracker.ts`.
 *     Phase 2 grows this to ~500 via a nightly performance filter.
 *   - The loop polls every `POLL_INTERVAL_MS` (default 6s). The spec names
 *     "2 Hz" aspirationally; 6s is safer against public-RPC rate limits and
 *     still well within the 15-min heavy-cycle cadence. Tunable via env var
 *     `ROTATION_INDEXER_POLL_MS`.
 *   - `stop()` must be called on shutdown for clean file handle release.
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { rpcCall } from '../execution/rpc.js';
import { getSmartWallets } from './smart-wallet-tracker.js';
import {
  TRANSFER_TOPIC,
  classifyTransfer,
  inferVenueFromTxLogs,
  normalizeAddress,
  type RawTransferLog,
} from './rotation-classify.js';
import type { WalletEvent, RotationIndexerHealth } from './rotation-types.js';

// ============================================================================
// CONFIG
// ============================================================================

const DEFAULT_POLL_INTERVAL_MS = 6_000;
/** Max events held in memory before the oldest are dropped. ~60K bytes per
 *  1000 events; 10K events ≈ 600KB — comfortable. */
const DEFAULT_BUFFER_CAPACITY = 10_000;
/** Max blocks to request in a single eth_getLogs call. Public RPCs usually
 *  cap at 500-1000; 250 is conservative + fast. */
const MAX_BLOCK_RANGE_PER_CALL = 250;
/** If the process has been offline and the chain has moved far ahead,
 *  catching up log-by-log would be slow. Cap the initial catch-up so we
 *  don't hammer RPC on cold-start. */
const MAX_COLD_START_CATCHUP_BLOCKS = 2_000;

// ============================================================================
// TOKEN DECIMALS CACHE
// ============================================================================

/**
 * Decimals lookup — seeded with common Base tokens. Unknown tokens default
 * to 18 (the ERC-20 default); decimals mismatch only affects `amountToken`
 * in JSONL, which consumers recompute if they care.
 */
const TOKEN_DECIMALS: Record<string, number> = {
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 6,  // USDC
  '0x4200000000000000000000000000000000000006': 18, // WETH
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 8,  // cbBTC
  '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b': 18, // VIRTUAL
  '0x940181a94a35a4569e4529a3cdfb74e38fd98631': 18, // AERO
};

function getTokenDecimals(tokenAddress: string): number {
  return TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
}

// ============================================================================
// RING BUFFER
// ============================================================================

/**
 * Bounded FIFO buffer for captured events. When capacity is reached, the
 * oldest events are dropped. `drop` counter tracks lifetime overflow.
 *
 * Exposed so heavy-cycle code in later phases can `drain()` without the
 * indexer knowing anything about who consumes the events.
 */
export class EventBuffer {
  private readonly data: WalletEvent[] = [];
  private _droppedTotal = 0;
  constructor(private readonly _capacity: number) {
    if (_capacity <= 0) throw new Error('EventBuffer: capacity must be > 0');
  }
  get capacity(): number { return this._capacity; }
  size(): number { return this.data.length; }
  droppedTotal(): number { return this._droppedTotal; }

  push(event: WalletEvent): void {
    this.data.push(event);
    while (this.data.length > this._capacity) {
      this.data.shift();
      this._droppedTotal++;
    }
  }

  pushAll(events: ReadonlyArray<WalletEvent>): void {
    for (const e of events) this.push(e);
  }

  /** Remove and return all buffered events (FIFO order). */
  drain(): WalletEvent[] {
    const out = this.data.slice();
    this.data.length = 0;
    return out;
  }

  /** Read without removing. */
  peek(): ReadonlyArray<WalletEvent> {
    return this.data;
  }
}

// ============================================================================
// RPC HELPERS
// ============================================================================

interface RpcLog {
  address: string;
  topics: string[];
  data: string;
  transactionHash: string;
  blockNumber: string; // hex
}

/**
 * All RPC goes through the bot's shared multi-endpoint rotation in
 * src/core/execution/rpc.ts — `rpcCall` handles 429/502/503 retries and
 * automatic failover across the full BASE_RPC_ENDPOINTS list (Flashbots,
 * 1RPC, drpc, etc.) rather than hammering a single public endpoint.
 * This lets the indexer poll at 6s safely; a single-endpoint implementation
 * historically got rate-limited and had to back off to 30s.
 */
async function getLatestBlockNumber(): Promise<number> {
  const hex = await rpcCall('eth_blockNumber', []);
  return parseInt(hex as string, 16);
}

async function getBlockTimestamp(blockHex: string): Promise<number> {
  const block = await rpcCall('eth_getBlockByNumber', [blockHex, false]) as
    | { timestamp: string }
    | null;
  if (!block?.timestamp) return Math.floor(Date.now() / 1000); // fallback
  return parseInt(block.timestamp, 16);
}

/**
 * Build the topic filter for ERC-20 Transfers involving any of the tracked
 * wallets as either sender or recipient.
 *
 * Base RPC supports OR within a topic slot (array value) but NOT AND across
 * topics with disjoint sets — so we issue TWO queries and union the results:
 *   - topic2 IN walletSet (tracked wallet is sender, i.e. OUT events)
 *   - topic3 IN walletSet (tracked wallet is receiver, i.e. IN events)
 */
function walletTopicPadded(addr: string): string {
  return '0x' + addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

// ============================================================================
// INDEXER
// ============================================================================

export interface RotationIndexerOptions {
  /** Where to write daily JSONL files. Defaults to `./data` in CWD. */
  logDir?: string;
  /** Set false to skip file-based logging (e.g., in tests). */
  fileLogging?: boolean;
  /** Override poll interval (ms). */
  pollIntervalMs?: number;
  /** Override buffer capacity. */
  bufferCapacity?: number;
  /** Override wallet set. Defaults to getSmartWallets(). Values are addresses. */
  trackedWallets?: ReadonlyArray<string>;
  /** Inject a clock for tests. Returns unix ms. */
  now?: () => number;
}

export class RotationIndexer {
  public readonly buffer: EventBuffer;

  private readonly trackedWallets: string[];
  private readonly trackedTopics: string[];
  private readonly trackedSet: Set<string>;

  private readonly pollMs: number;
  private readonly logDir: string;
  private readonly fileLogging: boolean;
  private readonly now: () => number;

  private lastIndexedBlock: number = 0;
  private lagBlocks: number = 0;
  private lastTickMs: number | null = null;
  private eventsSinceStart: number = 0;
  private recentTimestamps: number[] = []; // sliding window for "last 1h"
  private running: boolean = false;
  private tickInFlight: boolean = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: RotationIndexerOptions = {}) {
    const walletMap = opts.trackedWallets ?? Object.values(getSmartWallets());
    this.trackedWallets = [...walletMap].map((a) => normalizeAddress(a));
    this.trackedTopics = this.trackedWallets.map(walletTopicPadded);
    this.trackedSet = new Set(this.trackedWallets);

    this.pollMs = opts.pollIntervalMs
      ?? Number(process.env['ROTATION_INDEXER_POLL_MS'] ?? DEFAULT_POLL_INTERVAL_MS);
    this.logDir = opts.logDir ?? join(process.cwd(), 'data');
    this.fileLogging = opts.fileLogging ?? true;
    this.now = opts.now ?? (() => Date.now());
    this.buffer = new EventBuffer(opts.bufferCapacity ?? DEFAULT_BUFFER_CAPACITY);
  }

  // --- Lifecycle --------------------------------------------------------

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    if (this.fileLogging && !existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }

    // Cold-start: walk backward a bounded window so we have immediate data,
    // but don't drown in history.
    try {
      const tip = await getLatestBlockNumber();
      this.lastIndexedBlock = Math.max(0, tip - MAX_COLD_START_CATCHUP_BLOCKS);
    } catch (err: unknown) {
      console.warn('[rotation-indexer] cold start block fetch failed:', (err as Error).message);
      this.lastIndexedBlock = 0; // will be set on first tick
    }

    this.timer = setInterval(() => {
      void this.tickSafe();
    }, this.pollMs);

    // Fire one tick immediately so health shows life.
    void this.tickSafe();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Wait for any in-flight tick to settle so the caller knows we're quiet.
    for (let i = 0; i < 20 && this.tickInFlight; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // --- Core tick --------------------------------------------------------

  private async tickSafe(): Promise<void> {
    if (this.tickInFlight || !this.running) return;
    this.tickInFlight = true;
    try {
      await this.tick();
    } catch (err: unknown) {
      console.warn('[rotation-indexer] tick failed:', (err as Error).message);
    } finally {
      this.tickInFlight = false;
    }
  }

  /**
   * One poll cycle: fetch new blocks' transfer logs for tracked wallets,
   * classify, and push to buffer + file. Exported as a protected method so
   * tests can invoke it with injected RPC.
   */
  protected async tick(): Promise<void> {
    if (this.trackedWallets.length === 0) {
      this.lastTickMs = this.now();
      return;
    }

    const tip = await getLatestBlockNumber();
    if (this.lastIndexedBlock === 0) {
      // First real tick after cold-start miss — index just the very tip.
      this.lastIndexedBlock = Math.max(0, tip - 10);
    }
    this.lagBlocks = Math.max(0, tip - this.lastIndexedBlock);
    if (tip <= this.lastIndexedBlock) {
      this.lastTickMs = this.now();
      return;
    }

    const fromBlock = this.lastIndexedBlock + 1;
    const toBlock = Math.min(tip, fromBlock + MAX_BLOCK_RANGE_PER_CALL - 1);

    const events = await this.fetchEventsInRange(fromBlock, toBlock);
    if (events.length > 0) {
      this.buffer.pushAll(events);
      this.eventsSinceStart += events.length;
      const tsNow = this.now();
      for (let i = 0; i < events.length; i++) this.recentTimestamps.push(tsNow);
      this.trimRecent(tsNow);
      if (this.fileLogging) {
        this.appendJsonl(events);
      }
    }

    this.lastIndexedBlock = toBlock;
    this.lastTickMs = this.now();
  }

  // --- Fetch logic ------------------------------------------------------

  private async fetchEventsInRange(fromBlock: number, toBlock: number): Promise<WalletEvent[]> {
    const fromHex = '0x' + fromBlock.toString(16);
    const toHex = '0x' + toBlock.toString(16);

    // Two queries: tracked wallet in topic2 (from = OUT), and topic3 (to = IN).
    // Public RPCs support array-OR within a single topic slot.
    const fromQuery = rpcCall('eth_getLogs', [{
      fromBlock: fromHex, toBlock: toHex,
      topics: [TRANSFER_TOPIC, this.trackedTopics, null],
    }]) as Promise<RpcLog[]>;
    const toQuery = rpcCall('eth_getLogs', [{
      fromBlock: fromHex, toBlock: toHex,
      topics: [TRANSFER_TOPIC, null, this.trackedTopics],
    }]) as Promise<RpcLog[]>;

    const [outLogs, inLogs] = await Promise.all([fromQuery, toQuery]);
    // Deduplicate by (txHash, logIndex substitute = block+address+topics) — in
    // practice the two queries have disjoint topic positions so there's no
    // overlap, but de-dup defensively on txHash+topic2+topic3.
    const seen = new Set<string>();
    const combined: RpcLog[] = [];
    for (const l of [...outLogs, ...inLogs]) {
      const k = `${l.transactionHash}|${l.topics[1]}|${l.topics[2]}|${l.data}`;
      if (seen.has(k)) continue;
      seen.add(k);
      combined.push(l);
    }
    if (combined.length === 0) return [];

    // Resolve timestamps per block (cache within this range).
    const blockTimestamps = new Map<string, number>();
    const uniqBlocks = Array.from(new Set(combined.map((l) => l.blockNumber)));
    await Promise.all(uniqBlocks.map(async (blk) => {
      try {
        blockTimestamps.set(blk, await getBlockTimestamp(blk));
      } catch {
        // Fallback: don't let a single failure kill the whole range.
        blockTimestamps.set(blk, Math.floor(this.now() / 1000));
      }
    }));

    const events: WalletEvent[] = [];
    for (const log of combined) {
      const tokenAddr = log.address.toLowerCase();
      const decimals = getTokenDecimals(tokenAddr);
      const blockTs = blockTimestamps.get(log.blockNumber) ?? Math.floor(this.now() / 1000);

      // Figure out which tracked wallet this log pertains to.
      let trackedWallet: string | null = null;
      try {
        const fromA = '0x' + log.topics[1].slice(-40).toLowerCase();
        const toA = '0x' + log.topics[2].slice(-40).toLowerCase();
        if (this.trackedSet.has(fromA)) trackedWallet = fromA;
        else if (this.trackedSet.has(toA)) trackedWallet = toA;
      } catch { /* skip malformed topic */ }
      if (!trackedWallet) continue;

      const raw: RawTransferLog = {
        address: tokenAddr,
        topics: log.topics,
        data: log.data,
        transactionHash: log.transactionHash,
        blockNumber: parseInt(log.blockNumber, 16),
        blockTimestamp: blockTs,
      };

      try {
        const ev = classifyTransfer(raw, trackedWallet, decimals, null, 'unknown');
        if (ev) {
          // v1 venue inference: per-tx log bundle would require another
          // RPC call per tx. Defer to Phase 2 where we can be smarter
          // about batching. For now, stamp 'unknown'.
          events.push(ev);
        }
      } catch {
        // Bad log shape — skip silently, counted implicitly via lack of event.
      }
    }
    return events;
  }

  // --- File log ---------------------------------------------------------

  private eventLogPathForDate(tsMs: number): string {
    const d = new Date(tsMs);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return join(this.logDir, `rotation-events-${y}-${m}-${day}.jsonl`);
  }

  private appendJsonl(events: ReadonlyArray<WalletEvent>): void {
    if (events.length === 0) return;
    // Group by day so we write to the correct file for each event.
    const byDay = new Map<string, string[]>();
    for (const ev of events) {
      const path = this.eventLogPathForDate(ev.timestampMs);
      const arr = byDay.get(path) ?? [];
      arr.push(JSON.stringify(ev));
      byDay.set(path, arr);
    }
    for (const [path, lines] of byDay) {
      try {
        appendFileSync(path, lines.join('\n') + '\n', 'utf-8');
      } catch (err: unknown) {
        console.warn(`[rotation-indexer] failed to append ${path}:`, (err as Error).message);
      }
    }
  }

  // --- Health -----------------------------------------------------------

  private trimRecent(nowMs: number): void {
    const cutoff = nowMs - 60 * 60 * 1000;
    // recentTimestamps is push-only, so trim from the front.
    let i = 0;
    while (i < this.recentTimestamps.length && this.recentTimestamps[i] < cutoff) i++;
    if (i > 0) this.recentTimestamps.splice(0, i);
  }

  health(): RotationIndexerHealth {
    const nowMs = this.now();
    this.trimRecent(nowMs);
    return {
      running: this.running,
      trackedWallets: this.trackedWallets.length,
      lastIndexedBlock: this.lastIndexedBlock,
      lagBlocks: this.lagBlocks,
      eventsIngestedLast1h: this.recentTimestamps.length,
      eventsIngestedSinceStart: this.eventsSinceStart,
      bufferSize: this.buffer.size(),
      bufferCapacity: this.buffer.capacity,
      eventsDroppedOverflow: this.buffer.droppedTotal(),
      lastTickAt: this.lastTickMs ? new Date(this.lastTickMs).toISOString() : null,
      eventLogPath: this.fileLogging ? this.eventLogPathForDate(nowMs) : null,
    };
  }
}

// Make the otherwise-unused export referenced to keep the barrel import clean
// when we wire venue inference in Phase 2:
export { inferVenueFromTxLogs };

// ============================================================================
// SINGLETON HOOK
// ============================================================================

let _singleton: RotationIndexer | null = null;

/** Returns the process-wide indexer, constructing it lazily. */
export function getRotationIndexer(opts?: RotationIndexerOptions): RotationIndexer {
  if (!_singleton) _singleton = new RotationIndexer(opts);
  return _singleton;
}

/** Test-only: reset the singleton. */
export function _resetRotationIndexerSingleton(): void {
  _singleton = null;
}
