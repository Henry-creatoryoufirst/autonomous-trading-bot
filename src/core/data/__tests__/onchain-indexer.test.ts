/**
 * Unit tests for onchain-indexer.ts
 *
 * Uses a hand-rolled mock of viem's `PublicClient` covering only the surface
 * the indexer depends on (`getBlockNumber`, `getBlock`, `getLogs`,
 * `readContract`). Keeps tests fast and hermetic — no real RPC calls.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Address, PublicClient } from 'viem';
import {
  buildChunks,
  fetchTransferLogs,
  indexBotWalletTransfers,
  normalizeTransferLogs,
  resolveBlockTimestamps,
  resolveTokenMetadata,
} from '../onchain-indexer.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WALLET = '0xB7c51b1A8F967eF6BF906Fe4B484817Fe784a7C1' as Address;
const WALLET_LOWER = WALLET.toLowerCase();
const OTHER = '0x1111111111111111111111111111111111111111' as Address;
const OTHER2 = '0x2222222222222222222222222222222222222222' as Address;

const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const WETH = '0x4200000000000000000000000000000000000006';
const MYSTERY = '0x9999999999999999999999999999999999999999';

// Shape matches viem's `Log` with `strict: true` + decoded ERC-20 Transfer event
function makeLog(opts: {
  blockNumber: bigint;
  logIndex: number;
  txHash: string;
  token: string;
  from: string;
  to: string;
  value: bigint;
}) {
  return {
    address: opts.token,
    blockNumber: opts.blockNumber,
    logIndex: opts.logIndex,
    transactionHash: opts.txHash,
    transactionIndex: 0,
    blockHash: '0x' + 'b'.repeat(64),
    data: '0x',
    topics: [],
    removed: false,
    eventName: 'Transfer' as const,
    args: { from: opts.from as Address, to: opts.to as Address, value: opts.value },
  };
}

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

interface MockArgs {
  logs?: {
    in?: ReturnType<typeof makeLog>[];
    out?: ReturnType<typeof makeLog>[];
  };
  tokenMeta?: Record<string, { symbol?: string | Error; decimals?: number | Error }>;
  blocks?: Record<string, { timestamp: bigint } | Error>;
  latestBlock?: bigint;
}

function makeMockClient(args: MockArgs = {}): PublicClient {
  const inLogs = args.logs?.in ?? [];
  const outLogs = args.logs?.out ?? [];

  const mock = {
    getBlockNumber: vi.fn(async () => args.latestBlock ?? 9999n),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => {
      const key = blockNumber.toString();
      const entry = args.blocks?.[key];
      if (entry instanceof Error) throw entry;
      if (entry) return entry;
      return { timestamp: BigInt(Number(blockNumber) * 2 + 1_700_000_000) };
    }),
    getLogs: vi.fn(async ({ args: filterArgs, fromBlock, toBlock }: any) => {
      const inRange = (l: any) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock;
      if (filterArgs?.to) return inLogs.filter(inRange);
      if (filterArgs?.from) return outLogs.filter(inRange);
      return [];
    }),
    readContract: vi.fn(async ({ address, functionName }: any) => {
      const addrLower = address.toLowerCase();
      const meta = args.tokenMeta?.[addrLower];
      if (!meta) throw new Error(`No mock metadata for ${addrLower}`);
      if (functionName === 'symbol') {
        if (meta.symbol instanceof Error) throw meta.symbol;
        return meta.symbol ?? 'TKN';
      }
      if (functionName === 'decimals') {
        if (meta.decimals instanceof Error) throw meta.decimals;
        return meta.decimals ?? 18;
      }
      throw new Error(`Unexpected readContract fn ${functionName}`);
    }),
  };
  return mock as unknown as PublicClient;
}

// ===========================================================================
// buildChunks
// ===========================================================================
describe('buildChunks', () => {
  it('returns one chunk when the range fits', () => {
    expect(buildChunks(100n, 500n, 1000n)).toEqual([{ from: 100n, to: 500n }]);
  });

  it('splits an exact-multiple range into N chunks', () => {
    expect(buildChunks(0n, 9n, 5n)).toEqual([
      { from: 0n, to: 4n },
      { from: 5n, to: 9n },
    ]);
  });

  it('caps the final chunk at toBlock', () => {
    const chunks = buildChunks(1000n, 3499n, 1000n);
    expect(chunks).toEqual([
      { from: 1000n, to: 1999n },
      { from: 2000n, to: 2999n },
      { from: 3000n, to: 3499n },
    ]);
  });

  it('returns empty array for inverted range', () => {
    expect(buildChunks(100n, 50n, 10n)).toEqual([]);
  });

  it('handles a single-block range', () => {
    expect(buildChunks(42n, 42n, 100n)).toEqual([{ from: 42n, to: 42n }]);
  });
});

// ===========================================================================
// resolveTokenMetadata
// ===========================================================================
describe('resolveTokenMetadata', () => {
  it('fetches symbol + decimals for every unique address', async () => {
    const client = makeMockClient({
      tokenMeta: {
        [USDC]: { symbol: 'USDC', decimals: 6 },
        [WETH]: { symbol: 'WETH', decimals: 18 },
      },
    });
    const cache = await resolveTokenMetadata(client, [USDC, WETH, USDC, WETH]);
    expect(cache.get(USDC)).toEqual({ address: USDC, symbol: 'USDC', decimals: 6 });
    expect(cache.get(WETH)).toEqual({ address: WETH, symbol: 'WETH', decimals: 18 });
    expect((client.readContract as any).mock.calls.length).toBe(4);
  });

  it('reuses cached entries (no duplicate RPC)', async () => {
    const client = makeMockClient({
      tokenMeta: { [USDC]: { symbol: 'USDC', decimals: 6 } },
    });
    const cache = new Map();
    await resolveTokenMetadata(client, [USDC], cache);
    await resolveTokenMetadata(client, [USDC], cache);
    expect((client.readContract as any).mock.calls.length).toBe(2);
  });

  it('falls back to UNKNOWN/18 when metadata reads fail', async () => {
    const client = makeMockClient({
      tokenMeta: {
        [MYSTERY]: { symbol: new Error('boom'), decimals: new Error('boom') },
      },
    });
    const cache = await resolveTokenMetadata(client, [MYSTERY]);
    expect(cache.get(MYSTERY)).toEqual({ address: MYSTERY, symbol: 'UNKNOWN', decimals: 18 });
  });

  it('lowercases addresses in cache keys', async () => {
    const upper = MYSTERY.toUpperCase().replace('0X', '0x');
    const client = makeMockClient({
      tokenMeta: { [MYSTERY]: { symbol: 'TKN', decimals: 9 } },
    });
    const cache = await resolveTokenMetadata(client, [upper]);
    expect(cache.get(MYSTERY)).toBeDefined();
  });
});

// ===========================================================================
// resolveBlockTimestamps
// ===========================================================================
describe('resolveBlockTimestamps', () => {
  it('fetches timestamps for every unique block and caches them', async () => {
    const client = makeMockClient({
      blocks: {
        '100': { timestamp: 1_700_000_100n },
        '200': { timestamp: 1_700_000_200n },
      },
    });
    const cache = await resolveBlockTimestamps(client, [100n, 200n, 100n]);
    expect(cache.get(100n)).toBe(1_700_000_100);
    expect(cache.get(200n)).toBe(1_700_000_200);
    expect((client.getBlock as any).mock.calls.length).toBe(2);
  });

  it('leaves a failed block uncached (caller gets fallback downstream)', async () => {
    const client = makeMockClient({
      blocks: { '100': new Error('rpc down') },
    });
    const cache = await resolveBlockTimestamps(client, [100n]);
    expect(cache.has(100n)).toBe(false);
  });
});

// ===========================================================================
// fetchTransferLogs (chunked pagination)
// ===========================================================================
describe('fetchTransferLogs', () => {
  it('splits the range into chunks and fetches IN+OUT per chunk', async () => {
    const inA = makeLog({
      blockNumber: 5n, logIndex: 0, txHash: '0xa1', token: USDC,
      from: OTHER, to: WALLET_LOWER, value: 100n,
    });
    const outB = makeLog({
      blockNumber: 15n, logIndex: 1, txHash: '0xa2', token: WETH,
      from: WALLET_LOWER, to: OTHER, value: 200n,
    });
    const client = makeMockClient({ logs: { in: [inA], out: [outB] } });

    const logs = await fetchTransferLogs(client, WALLET, 0n, 19n, 10n, 1);

    expect(logs).toHaveLength(2);
    // 2 chunks × 2 calls (in + out) = 4
    expect((client.getLogs as any).mock.calls.length).toBe(4);
  });

  it('applies the token allowlist filter', async () => {
    const logs = [
      makeLog({ blockNumber: 1n, logIndex: 0, txHash: '0x1', token: USDC, from: OTHER, to: WALLET_LOWER, value: 1n }),
      makeLog({ blockNumber: 1n, logIndex: 1, txHash: '0x2', token: WETH, from: OTHER, to: WALLET_LOWER, value: 2n }),
      makeLog({ blockNumber: 2n, logIndex: 0, txHash: '0x3', token: MYSTERY, from: OTHER, to: WALLET_LOWER, value: 3n }),
    ];
    const client = makeMockClient({ logs: { in: logs, out: [] } });

    const filtered = await fetchTransferLogs(client, WALLET, 0n, 10n, 100n, 1, [USDC, WETH]);
    const tokenAddrs = filtered.map((l) => l.address.toLowerCase());
    expect(tokenAddrs).toContain(USDC);
    expect(tokenAddrs).toContain(WETH);
    expect(tokenAddrs).not.toContain(MYSTERY);
  });

  it('reports progress after each chunk', async () => {
    const client = makeMockClient();
    const events: Array<{ scanned: bigint; total: bigint }> = [];
    await fetchTransferLogs(client, WALLET, 0n, 29n, 10n, 1, undefined, (p) => {
      events.push({ scanned: p.scannedBlocks, total: p.totalBlocks });
    });
    expect(events).toHaveLength(3);
    expect(events[events.length - 1].scanned).toBe(30n);
    expect(events[events.length - 1].total).toBe(30n);
  });
});

// ===========================================================================
// normalizeTransferLogs
// ===========================================================================
describe('normalizeTransferLogs', () => {
  it('classifies IN vs OUT direction correctly', () => {
    const logs = [
      makeLog({
        blockNumber: 10n, logIndex: 0, txHash: '0xa',
        token: USDC, from: OTHER, to: WALLET_LOWER, value: 100_000_000n,
      }),
      makeLog({
        blockNumber: 11n, logIndex: 0, txHash: '0xb',
        token: WETH, from: WALLET_LOWER, to: OTHER, value: 1_000_000_000_000_000_000n,
      }),
    ];
    const meta = new Map([
      [USDC, { address: USDC, symbol: 'USDC', decimals: 6 }],
      [WETH, { address: WETH, symbol: 'WETH', decimals: 18 }],
    ]);
    const blockTs = new Map([[10n, 1_700_000_010], [11n, 1_700_000_011]]);
    const result = normalizeTransferLogs(logs as any, WALLET, meta, blockTs);

    expect(result).toHaveLength(2);
    expect(result[0].direction).toBe('IN');
    expect(result[0].tokenAmount).toBeCloseTo(100, 6);
    expect(result[0].token.symbol).toBe('USDC');
    expect(result[1].direction).toBe('OUT');
    expect(result[1].tokenAmount).toBeCloseTo(1, 9);
  });

  it('converts raw amounts using token decimals', () => {
    const logs = [
      makeLog({
        blockNumber: 1n, logIndex: 0, txHash: '0x1',
        token: USDC, from: OTHER, to: WALLET_LOWER, value: 1_234_567_890n,
      }),
    ];
    const meta = new Map([[USDC, { address: USDC, symbol: 'USDC', decimals: 6 }]]);
    const ts = new Map([[1n, 1_700_000_001]]);
    const [t] = normalizeTransferLogs(logs as any, WALLET, meta, ts);
    expect(t.tokenAmount).toBeCloseTo(1234.56789, 4);
    expect(t.rawAmount).toBe(1_234_567_890n);
  });

  it('skips self-transfers (from == to == wallet)', () => {
    const logs = [
      makeLog({
        blockNumber: 1n, logIndex: 0, txHash: '0x1',
        token: USDC, from: WALLET_LOWER, to: WALLET_LOWER, value: 1n,
      }),
    ];
    const meta = new Map([[USDC, { address: USDC, symbol: 'USDC', decimals: 6 }]]);
    const ts = new Map([[1n, 1_700_000_001]]);
    expect(normalizeTransferLogs(logs as any, WALLET, meta, ts)).toHaveLength(0);
  });

  it('skips transfers unrelated to the wallet', () => {
    const logs = [
      makeLog({
        blockNumber: 1n, logIndex: 0, txHash: '0x1',
        token: USDC, from: OTHER, to: OTHER2, value: 1n,
      }),
    ];
    const meta = new Map([[USDC, { address: USDC, symbol: 'USDC', decimals: 6 }]]);
    const ts = new Map([[1n, 1_700_000_001]]);
    expect(normalizeTransferLogs(logs as any, WALLET, meta, ts)).toHaveLength(0);
  });

  it('falls back to UNKNOWN/18 when token metadata missing', () => {
    const logs = [
      makeLog({
        blockNumber: 1n, logIndex: 0, txHash: '0x1',
        token: MYSTERY, from: OTHER, to: WALLET_LOWER, value: 10n ** 18n,
      }),
    ];
    const ts = new Map([[1n, 1_700_000_001]]);
    const [t] = normalizeTransferLogs(logs as any, WALLET, new Map(), ts);
    expect(t.token.symbol).toBe('UNKNOWN');
    expect(t.token.decimals).toBe(18);
    expect(t.tokenAmount).toBeCloseTo(1, 9);
  });

  it('sorts output chronologically by block then log index', () => {
    const logs = [
      makeLog({ blockNumber: 50n, logIndex: 2, txHash: '0xc', token: USDC, from: OTHER, to: WALLET_LOWER, value: 1n }),
      makeLog({ blockNumber: 10n, logIndex: 0, txHash: '0xa', token: USDC, from: OTHER, to: WALLET_LOWER, value: 1n }),
      makeLog({ blockNumber: 50n, logIndex: 1, txHash: '0xb', token: USDC, from: OTHER, to: WALLET_LOWER, value: 1n }),
    ];
    const meta = new Map([[USDC, { address: USDC, symbol: 'USDC', decimals: 6 }]]);
    const ts = new Map([[10n, 1_700_000_010], [50n, 1_700_000_050]]);
    const result = normalizeTransferLogs(logs as any, WALLET, meta, ts);
    expect(result.map((t) => t.txHash)).toEqual(['0xa', '0xb', '0xc']);
  });

  it('emits ISO timestamps from the block timestamp cache', () => {
    const logs = [
      makeLog({ blockNumber: 1n, logIndex: 0, txHash: '0x1', token: USDC, from: OTHER, to: WALLET_LOWER, value: 1n }),
    ];
    const meta = new Map([[USDC, { address: USDC, symbol: 'USDC', decimals: 6 }]]);
    const ts = new Map([[1n, 1_700_000_000]]);
    const [t] = normalizeTransferLogs(logs as any, WALLET, meta, ts);
    expect(t.timestamp).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });
});

// ===========================================================================
// indexBotWalletTransfers (end-to-end with mocked client)
// ===========================================================================
describe('indexBotWalletTransfers', () => {
  it('runs the full pipeline: fetch → resolve meta → resolve timestamps → normalize', async () => {
    const inLog = makeLog({
      blockNumber: 100n, logIndex: 0, txHash: '0xaaa',
      token: USDC, from: OTHER, to: WALLET_LOWER, value: 500_000_000n,
    });
    const outLog = makeLog({
      blockNumber: 200n, logIndex: 0, txHash: '0xbbb',
      token: WETH, from: WALLET_LOWER, to: OTHER, value: 250_000_000_000_000_000n,
    });
    const client = makeMockClient({
      logs: { in: [inLog], out: [outLog] },
      tokenMeta: {
        [USDC]: { symbol: 'USDC', decimals: 6 },
        [WETH]: { symbol: 'WETH', decimals: 18 },
      },
      blocks: {
        '100': { timestamp: 1_700_000_100n },
        '200': { timestamp: 1_700_000_200n },
      },
      latestBlock: 300n,
    });

    const result = await indexBotWalletTransfers({
      wallet: WALLET,
      fromBlock: 1n,
      toBlock: 300n,
      chunkSize: 100,
      concurrency: 1,
      client,
    });

    expect(result).toHaveLength(2);
    expect(result[0].direction).toBe('IN');
    expect(result[0].token.symbol).toBe('USDC');
    expect(result[0].tokenAmount).toBeCloseTo(500, 6);
    expect(result[0].timestamp).toBe(new Date(1_700_000_100 * 1000).toISOString());
    expect(result[1].direction).toBe('OUT');
    expect(result[1].token.symbol).toBe('WETH');
    expect(result[1].tokenAmount).toBeCloseTo(0.25, 9);
  });

  it('calls getBlockNumber when toBlock is omitted', async () => {
    const client = makeMockClient({ latestBlock: 42n });
    await indexBotWalletTransfers({
      wallet: WALLET,
      fromBlock: 1n,
      chunkSize: 100,
      concurrency: 1,
      client,
    });
    expect((client.getBlockNumber as any).mock.calls.length).toBe(1);
  });
});
