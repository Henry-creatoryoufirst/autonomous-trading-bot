/**
 * Tests for the auditor's Files API persistence layer.
 *
 * Covers:
 *   - Deterministic keying (snapshotFilename / snapshotPrefixForBot)
 *   - Bot-instance sanitization (slashes, spaces, empty fall back to 'unknown')
 *   - persistToFilesApi: upload happy path + null-client skip + upload-throws
 *   - loadFromFilesApi: empty list + sort-by-created_at + download + invalid shape
 *   - Auditor integration: N-cycle batching gate, hydration from snapshot,
 *     local-newer-than-remote conflict resolution, graceful degradation
 *     when client is unwired, graceful-shutdown flush.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadFromFilesApi,
  persistToFilesApi,
  snapshotFilename,
  snapshotPrefixForBot,
  adaptAnthropicClient,
  type AuditorSnapshot,
  type FilesApiClient,
} from '../persistence.js';
import {
  _internals,
  flushAuditorPersistenceOnShutdown,
  runSystemAuditor,
  type AuditorDeps,
} from '../system-auditor.js';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build an in-memory mock FilesApiClient backed by a Map. Captures every
 * call so tests can assert on cadence + ordering. The mock honors the
 * filename-prefix filter on list() so callers behave as production would.
 */
function makeMockFilesClient(opts: { uploadThrows?: boolean; listThrows?: boolean; downloadThrows?: boolean } = {}) {
  type Entry = { id: string; filename: string; created_at: string; body: Uint8Array };
  const store = new Map<string, Entry>();
  let counter = 0;
  const calls = {
    upload: [] as Array<{ filename: string; mimeType: string; bytes: number }>,
    list: [] as Array<{ filenamePrefix: string; limit?: number }>,
    download: [] as string[],
  };
  const client: FilesApiClient = {
    async upload({ content, filename, mimeType }) {
      calls.upload.push({ filename, mimeType, bytes: content.byteLength });
      if (opts.uploadThrows) throw new Error('synthetic upload failure');
      counter += 1;
      const id = `file_${counter}`;
      const created_at = new Date(2026, 4, 21, 12, counter, 0).toISOString();
      const entry: Entry = { id, filename, created_at, body: new Uint8Array(content) };
      store.set(id, entry);
      return { id, filename, created_at };
    },
    async list({ filenamePrefix, limit }) {
      calls.list.push({ filenamePrefix, limit });
      if (opts.listThrows) throw new Error('synthetic list failure');
      return [...store.values()]
        .filter(e => e.filename.startsWith(filenamePrefix))
        .slice(0, limit ?? 100)
        .map(({ id, filename, created_at }) => ({ id, filename, created_at }));
    },
    async download(fileId: string) {
      calls.download.push(fileId);
      if (opts.downloadThrows) throw new Error('synthetic download failure');
      const e = store.get(fileId);
      if (!e) throw new Error('file not found');
      return JSON.parse(new TextDecoder().decode(e.body));
    },
    async deleteFile(fileId: string) {
      store.delete(fileId);
    },
  };
  return { client, store, calls };
}

function honestDeps(overrides: Partial<AuditorDeps> = {}): AuditorDeps {
  // Mirror the system-auditor.test.ts baseline so every invariant clears
  // (cohort coverage requires the full 7-token cohort held).
  const cohortTail = [
    { symbol: 'cbBTC', balance: 0.001, usdValue: 50, price: 50000 },
    { symbol: 'cbXRP', balance: 50,    usdValue: 50, price: 1 },
    { symbol: 'cbLTC', balance: 1,     usdValue: 50, price: 50 },
    { symbol: 'LINK',  balance: 5,     usdValue: 50, price: 10 },
    { symbol: 'cbADA', balance: 100,   usdValue: 50, price: 0.5 },
    { symbol: 'cbSOL', balance: 0.3,   usdValue: 50, price: 166.67 },
  ];
  const cohortCostBasis: AuditorDeps['costBasis'] = {};
  const cohortPrices: AuditorDeps['lastKnownPrices'] = {};
  for (const { symbol, balance, price } of cohortTail) {
    cohortCostBasis[symbol] = {
      symbol,
      realizedPnL: 0,
      totalInvestedUSD: balance * price,
      totalTokensAcquired: balance,
      averageCostBasis: price,
      currentHolding: balance,
    };
    cohortPrices[symbol] = { price };
  }
  return {
    balances: [
      { symbol: 'WETH', balance: 0.81, usdValue: 1700 },
      { symbol: 'USDC', balance: 1000, usdValue: 1000 },
      ...cohortTail.map(({ symbol, balance, usdValue }) => ({ symbol, balance, usdValue })),
    ],
    totalPortfolioValue: 3000,
    costBasis: {
      WETH: { symbol: 'WETH', realizedPnL: 0, totalInvestedUSD: 1705, totalTokensAcquired: 0.81, averageCostBasis: 2105, currentHolding: 0.81 },
      ...cohortCostBasis,
    },
    lastKnownPrices: { WETH: { price: 2105 }, ...cohortPrices },
    cycle: 1,
    ...overrides,
  };
}

function buildSnapshot(overrides: Partial<AuditorSnapshot> = {}): AuditorSnapshot {
  return {
    version: 1,
    startedAt: '2026-05-21T10:00:00.000Z',
    lastReport: null,
    currentBlocker: null,
    capturedPrompt: null,
    stats: {
      cyclesRun: 42,
      cyclesSkipped: 0,
      totalViolations: 7,
      perInvariantViolations: { 'INV-2': 3, 'INV-3': 4 },
      lastFlipFromLogOnly: null,
      capturedPromptCount: 12,
    },
    snapshotMeta: {
      botInstance: 'test-bot',
      uploadedAt: '2026-05-21T12:00:00.000Z',
      auditorCyclesAtUpload: 42,
    },
    ...overrides,
  };
}

// ============================================================================
// KEYING
// ============================================================================

describe('snapshotFilename / snapshotPrefixForBot', () => {
  it('produces a deterministic per-bot, per-day, per-hour-minute path', () => {
    const ts = new Date('2026-05-21T18:42:11.123Z');
    expect(snapshotFilename('efficient-peace', ts)).toBe(
      'nvr-audit/efficient-peace/2026-05-21/1842.json',
    );
  });

  it('sanitizes bot-instance values containing forbidden characters', () => {
    const ts = new Date('2026-05-21T00:00:00.000Z');
    expect(snapshotFilename('STC - Kathy&Howard', ts)).toBe(
      'nvr-audit/STC-Kathy-Howard/2026-05-21/0000.json',
    );
    expect(snapshotFilename('a/b/c', ts)).toBe('nvr-audit/a-b-c/2026-05-21/0000.json');
  });

  it('defaults empty bot-instance to "unknown"', () => {
    const ts = new Date('2026-05-21T00:00:00.000Z');
    expect(snapshotFilename('', ts)).toBe('nvr-audit/unknown/2026-05-21/0000.json');
    expect(snapshotFilename('////', ts)).toBe('nvr-audit/unknown/2026-05-21/0000.json');
  });

  it('prefix matches the per-bot folder', () => {
    expect(snapshotPrefixForBot('efficient-peace')).toBe('nvr-audit/efficient-peace/');
    expect(snapshotPrefixForBot('STC - Kathy&Howard')).toBe('nvr-audit/STC-Kathy-Howard/');
  });
});

// ============================================================================
// persistToFilesApi
// ============================================================================

describe('persistToFilesApi', () => {
  it('uploads JSON snapshot with metadata wrapper', async () => {
    const { client, calls, store } = makeMockFilesClient();
    const state = buildSnapshot();
    const res = await persistToFilesApi(state, 'efficient-peace', client, {
      auditorCyclesRun: 42,
      now: new Date('2026-05-21T18:42:11.123Z'),
    });
    expect(res.ok).toBe(true);
    expect(res.fileId).toBeDefined();
    expect(res.filename).toBe('nvr-audit/efficient-peace/2026-05-21/1842.json');
    expect(calls.upload).toHaveLength(1);
    expect(calls.upload[0].mimeType).toBe('application/json');
    // Stored body parses back to a valid snapshot including the metadata.
    const stored = [...store.values()][0];
    const parsed = JSON.parse(new TextDecoder().decode(stored.body)) as AuditorSnapshot;
    expect(parsed.version).toBe(1);
    expect(parsed.stats.cyclesRun).toBe(42);
    expect(parsed.snapshotMeta.botInstance).toBe('efficient-peace');
    expect(parsed.snapshotMeta.auditorCyclesAtUpload).toBe(42);
  });

  it('skips cleanly when client is null', async () => {
    const res = await persistToFilesApi(buildSnapshot(), 'efficient-peace', null, {
      auditorCyclesRun: 0,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('no-client-wired');
  });

  it('returns failure result (does not throw) when upload throws', async () => {
    const { client } = makeMockFilesClient({ uploadThrows: true });
    const res = await persistToFilesApi(buildSnapshot(), 'efficient-peace', client, {
      auditorCyclesRun: 0,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/upload-failed/);
  });
});

// ============================================================================
// loadFromFilesApi
// ============================================================================

describe('loadFromFilesApi', () => {
  it('returns the newest snapshot by created_at', async () => {
    const { client } = makeMockFilesClient();
    // Upload three snapshots — second is "newest" by created_at because
    // mock increments counter for each. Verify we pick the highest.
    await persistToFilesApi(buildSnapshot({ stats: { ...buildSnapshot().stats, cyclesRun: 10 } }), 'efficient-peace', client, { auditorCyclesRun: 10 });
    await persistToFilesApi(buildSnapshot({ stats: { ...buildSnapshot().stats, cyclesRun: 20 } }), 'efficient-peace', client, { auditorCyclesRun: 20 });
    await persistToFilesApi(buildSnapshot({ stats: { ...buildSnapshot().stats, cyclesRun: 30 } }), 'efficient-peace', client, { auditorCyclesRun: 30 });
    const res = await loadFromFilesApi('efficient-peace', client);
    expect(res.ok).toBe(true);
    expect(res.snapshot!.stats.cyclesRun).toBe(30);
  });

  it('returns ok=false / snapshot=null when no snapshots exist', async () => {
    const { client } = makeMockFilesClient();
    const res = await loadFromFilesApi('efficient-peace', client);
    expect(res.ok).toBe(false);
    expect(res.snapshot).toBeNull();
    expect(res.reason).toBe('no-snapshots');
  });

  it('skips cleanly when client is null', async () => {
    const res = await loadFromFilesApi('efficient-peace', null);
    expect(res.ok).toBe(false);
    expect(res.snapshot).toBeNull();
    expect(res.reason).toBe('no-client-wired');
  });

  it('filters by bot-instance prefix (does not cross-load other bots)', async () => {
    const { client } = makeMockFilesClient();
    await persistToFilesApi(buildSnapshot({ stats: { ...buildSnapshot().stats, cyclesRun: 5 } }), 'ryan-denome-bot', client, { auditorCyclesRun: 5 });
    await persistToFilesApi(buildSnapshot({ stats: { ...buildSnapshot().stats, cyclesRun: 99 } }), 'efficient-peace', client, { auditorCyclesRun: 99 });
    const res = await loadFromFilesApi('ryan-denome-bot', client);
    expect(res.ok).toBe(true);
    expect(res.snapshot!.stats.cyclesRun).toBe(5);
  });

  it('rejects invalid snapshot shape (version mismatch)', async () => {
    const { client, store } = makeMockFilesClient();
    // Hand-craft a v0 (legacy) blob.
    await client.upload({
      content: new TextEncoder().encode(JSON.stringify({ version: 0, stats: { cyclesRun: 1 } })),
      filename: 'nvr-audit/test/2026-05-21/0000.json',
      mimeType: 'application/json',
    });
    expect(store.size).toBe(1);
    const res = await loadFromFilesApi('test', client);
    expect(res.ok).toBe(false);
    expect(res.snapshot).toBeNull();
    expect(res.reason).toBe('invalid-snapshot-shape');
  });

  it('returns failure result (does not throw) when list throws', async () => {
    const { client } = makeMockFilesClient({ listThrows: true });
    const res = await loadFromFilesApi('efficient-peace', client);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/list-failed/);
  });

  it('returns failure result (does not throw) when download throws', async () => {
    const { client } = makeMockFilesClient({ downloadThrows: true });
    await persistToFilesApi(buildSnapshot(), 'efficient-peace', client, { auditorCyclesRun: 0 });
    const res = await loadFromFilesApi('efficient-peace', client);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/download-failed/);
  });
});

// ============================================================================
// adaptAnthropicClient — null/unknown shapes
// ============================================================================

describe('adaptAnthropicClient', () => {
  it('returns null for null / undefined / non-object inputs', () => {
    expect(adaptAnthropicClient(null)).toBeNull();
    expect(adaptAnthropicClient(undefined)).toBeNull();
    expect(adaptAnthropicClient('string')).toBeNull();
    expect(adaptAnthropicClient(42)).toBeNull();
  });

  it('returns null when the client has no transport surface', () => {
    expect(adaptAnthropicClient({})).toBeNull();
    expect(adaptAnthropicClient({ beta: {} })).toBeNull();
  });

  it('adapts a high-level beta.files surface', async () => {
    const inner = {
      upload: vi.fn(async () => ({ id: 'f_1', filename: 'a.json', created_at: '2026-05-21T00:00:00Z' })),
      list: vi.fn(async () => ({ data: [{ id: 'f_1', filename: 'nvr-audit/x/y.json', created_at: '2026-05-21T00:00:00Z' }] })),
      download: vi.fn(async () => ({ json: async () => ({ ok: true }) })),
    };
    const adapted = adaptAnthropicClient({ beta: { files: inner } });
    expect(adapted).not.toBeNull();
    await adapted!.upload({ content: new Uint8Array([1, 2, 3]), filename: 'a.json', mimeType: 'application/json' });
    expect(inner.upload).toHaveBeenCalledOnce();
    const listed = await adapted!.list({ filenamePrefix: 'nvr-audit/x/' });
    expect(listed).toHaveLength(1);
  });

  it('adapts a low-level transport (post/get/delete)', async () => {
    const post = vi.fn(async () => ({ id: 'f_1', filename: 'a.json', created_at: '2026-05-21T00:00:00Z' }));
    const get = vi.fn(async (path: string) => {
      if (path === '/v1/files') return { data: [{ id: 'f_1', filename: 'nvr-audit/x/y.json', created_at: '2026-05-21T00:00:00Z' }] };
      return { ok: true };
    });
    const adapted = adaptAnthropicClient({ post, get });
    expect(adapted).not.toBeNull();
    await adapted!.upload({ content: new Uint8Array([1, 2, 3]), filename: 'a.json', mimeType: 'application/json' });
    expect(post).toHaveBeenCalledOnce();
    const listed = await adapted!.list({ filenamePrefix: 'nvr-audit/x/' });
    expect(listed).toHaveLength(1);
  });
});

// ============================================================================
// Auditor integration — batching gate, hydration, graceful degradation
// ============================================================================

describe('system-auditor — Files API integration', () => {
  beforeEach(() => {
    _internals.reset();
    process.env.SYSTEM_AUDITOR_ENABLED = 'true';
    delete process.env.SYSTEM_AUDITOR_ALERT_MODE;
    process.env.BOT_INSTANCE_NAME = 'test-bot';
  });

  afterEach(() => {
    delete process.env.AUDITOR_FILES_PERSIST_EVERY_N_CYCLES;
    delete process.env.BOT_INSTANCE_NAME;
  });

  it('does not call Files API when client is unwired (local-fs-only fallback)', async () => {
    const { client, calls } = makeMockFilesClient();
    // Deliberately do NOT install the mock client.
    process.env.AUDITOR_FILES_PERSIST_EVERY_N_CYCLES = '1';
    await runSystemAuditor(honestDeps({ cycle: 1 }));
    expect(calls.upload).toHaveLength(0);
    expect(client).toBeDefined(); // mock was never used
  });

  it('batches Files-API writes to every N cycles', async () => {
    const { client, calls } = makeMockFilesClient();
    _internals.setFilesClientForTest(client);
    process.env.AUDITOR_FILES_PERSIST_EVERY_N_CYCLES = '3';

    // 1st + 2nd cycle: no upload yet (counter below cadence)
    await runSystemAuditor(honestDeps({ cycle: 1 }));
    await runSystemAuditor(honestDeps({ cycle: 2 }));
    // Allow fire-and-forget upload to flush
    await new Promise(r => setTimeout(r, 0));
    expect(calls.upload).toHaveLength(0);

    // 3rd cycle hits the cadence — upload fires
    await runSystemAuditor(honestDeps({ cycle: 3 }));
    await new Promise(r => setTimeout(r, 0));
    expect(calls.upload).toHaveLength(1);

    // 4th + 5th cycle: counter reset, below cadence again
    await runSystemAuditor(honestDeps({ cycle: 4 }));
    await runSystemAuditor(honestDeps({ cycle: 5 }));
    await new Promise(r => setTimeout(r, 0));
    expect(calls.upload).toHaveLength(1);

    // 6th cycle hits cadence again
    await runSystemAuditor(honestDeps({ cycle: 6 }));
    await new Promise(r => setTimeout(r, 0));
    expect(calls.upload).toHaveLength(2);
  });

  it('defaults batching cadence to 10 cycles when env var unset', async () => {
    const { client, calls } = makeMockFilesClient();
    _internals.setFilesClientForTest(client);
    delete process.env.AUDITOR_FILES_PERSIST_EVERY_N_CYCLES;
    for (let i = 1; i <= 9; i++) {
      await runSystemAuditor(honestDeps({ cycle: i }));
    }
    await new Promise(r => setTimeout(r, 0));
    expect(calls.upload).toHaveLength(0);
    await runSystemAuditor(honestDeps({ cycle: 10 }));
    await new Promise(r => setTimeout(r, 0));
    expect(calls.upload).toHaveLength(1);
  });

  it('hydrates _state from the most recent Files API snapshot', async () => {
    const { client } = makeMockFilesClient();
    // Seed the store with a snapshot from a prior container run.
    await persistToFilesApi(buildSnapshot({
      stats: {
        cyclesRun: 1234,
        cyclesSkipped: 0,
        totalViolations: 99,
        perInvariantViolations: { 'INV-2': 50 },
        lastFlipFromLogOnly: null,
        capturedPromptCount: 5,
      },
    }), 'test-bot', client, { auditorCyclesRun: 1234 });

    _internals.setFilesClientForTest(client);
    await _internals.hydrateFromFilesApiForTest();

    const hydrated = _internals.getStateForTest();
    expect(hydrated.stats.cyclesRun).toBe(1234);
    expect(hydrated.stats.totalViolations).toBe(99);
  });

  it('keeps local state when remote snapshot is older (no clobber)', async () => {
    const { client } = makeMockFilesClient();
    // Remote snapshot has cyclesRun=5, but local has already run more.
    await persistToFilesApi(buildSnapshot({
      stats: {
        cyclesRun: 5,
        cyclesSkipped: 0,
        totalViolations: 0,
        perInvariantViolations: {},
        lastFlipFromLogOnly: null,
        capturedPromptCount: 0,
      },
    }), 'test-bot', client, { auditorCyclesRun: 5 });

    // Pretend local is well past 5.
    _internals.setStateForTest({
      stats: {
        cyclesRun: 50,
        cyclesSkipped: 0,
        totalViolations: 0,
        perInvariantViolations: {},
        lastFlipFromLogOnly: null,
        capturedPromptCount: 0,
      },
    });
    _internals.setFilesClientForTest(client);
    await _internals.hydrateFromFilesApiForTest();

    expect(_internals.getStateForTest().stats.cyclesRun).toBe(50);
  });

  it('graceful-shutdown flush uploads regardless of cadence', async () => {
    const { client, calls } = makeMockFilesClient();
    _internals.setFilesClientForTest(client);
    process.env.AUDITOR_FILES_PERSIST_EVERY_N_CYCLES = '999';
    // One cycle, way below cadence
    await runSystemAuditor(honestDeps({ cycle: 1 }));
    await new Promise(r => setTimeout(r, 0));
    expect(calls.upload).toHaveLength(0);

    // Flush bypasses cadence
    await flushAuditorPersistenceOnShutdown();
    expect(calls.upload).toHaveLength(1);
  });

  it('graceful-shutdown flush is a no-op when no client is wired', async () => {
    // Don't wire a client — flush should complete without error.
    await expect(flushAuditorPersistenceOnShutdown()).resolves.toBeUndefined();
  });

  it('uploads under bot-instance from BOT_INSTANCE_NAME env', async () => {
    process.env.BOT_INSTANCE_NAME = 'ryan-denome-bot';
    const { client, calls } = makeMockFilesClient();
    _internals.setFilesClientForTest(client);
    process.env.AUDITOR_FILES_PERSIST_EVERY_N_CYCLES = '1';
    await runSystemAuditor(honestDeps({ cycle: 1 }));
    await new Promise(r => setTimeout(r, 0));
    expect(calls.upload).toHaveLength(1);
    expect(calls.upload[0].filename).toMatch(/^nvr-audit\/ryan-denome-bot\//);
  });

  it('falls back to RAILWAY_SERVICE_NAME when BOT_INSTANCE_NAME is unset', async () => {
    delete process.env.BOT_INSTANCE_NAME;
    process.env.RAILWAY_SERVICE_NAME = 'fallback-svc';
    try {
      const { client, calls } = makeMockFilesClient();
      _internals.setFilesClientForTest(client);
      process.env.AUDITOR_FILES_PERSIST_EVERY_N_CYCLES = '1';
      await runSystemAuditor(honestDeps({ cycle: 1 }));
      await new Promise(r => setTimeout(r, 0));
      expect(calls.upload).toHaveLength(1);
      expect(calls.upload[0].filename).toMatch(/^nvr-audit\/fallback-svc\//);
    } finally {
      delete process.env.RAILWAY_SERVICE_NAME;
    }
  });

  it('defaults bot-instance to "unknown" when neither env var is set', async () => {
    delete process.env.BOT_INSTANCE_NAME;
    delete process.env.RAILWAY_SERVICE_NAME;
    const { client, calls } = makeMockFilesClient();
    _internals.setFilesClientForTest(client);
    process.env.AUDITOR_FILES_PERSIST_EVERY_N_CYCLES = '1';
    await runSystemAuditor(honestDeps({ cycle: 1 }));
    await new Promise(r => setTimeout(r, 0));
    expect(calls.upload).toHaveLength(1);
    expect(calls.upload[0].filename).toMatch(/^nvr-audit\/unknown\//);
  });
});
