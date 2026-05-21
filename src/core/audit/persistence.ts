/**
 * NVR-SPEC-035 — auditor persistence (Anthropic Files API tier).
 *
 * Why: Railway wipes the container filesystem on every redeploy. The
 * auditor's persisted `_state` (cyclesRun counters, lastReport, captured
 * prompts) lives in `./logs/system-auditor-report.json` — so every
 * `railway redeploy` reset audit-of-audits state to zero. That was proven
 * on 2026-05-21 when family bots (Kathy&Howard, Zachary) were flipped to
 * `SYSTEM_AUDITOR_ENABLED=true` and their cyclesRun snapped back to 0
 * after the next deploy.
 *
 * Fix: snapshot the same `_state` shape to the Anthropic Files API every
 * N cycles + on graceful shutdown. Files API blobs survive across deploys
 * and live per-workspace, which means a fleet of bots writing to the
 * same workspace can all read each other's audit history (useful for
 * cross-bot audit triangulation later).
 *
 * Design — two-tier persistence:
 *
 *   Tier 1 (hot, every cycle):   in-memory _state — NO change.
 *   Tier 2 (warm, every N cycles + graceful shutdown):
 *                                snapshot to Anthropic Files API.
 *   Tier 3 (cold, every cycle):  local fs write to ./logs/system-auditor-report.json
 *                                (kept as belt-and-suspenders; if the Files API is
 *                                unreachable, the bot still has its prior in-memory
 *                                state on a single-container restart).
 *
 * Keying scheme:
 *   nvr-audit/${botInstance}/${YYYY-MM-DD}/${HH}.json
 *
 *   - botInstance disambiguates fleet members (efficient-peace, ryan-denome-bot, ...)
 *   - YYYY-MM-DD/HH bucketing keeps the most recent snapshot easy to find
 *     (we sort by created_at on load so the filename pattern is for
 *     human-debugging, not lookup ordering).
 *
 * Graceful degradation:
 *   If the supplied client doesn't expose Files API, every call returns
 *   structured "skipped" results and the auditor falls back to local fs.
 *   A single WARN log fires on the first skip so it's visible without
 *   spamming.
 *
 * This module is pure + free of side effects until you call into it.
 * Safe to import without any client wired.
 */

import type { AuditReport, CapturedPrompt, SystemHealthBlocker } from './types.js';

// ============================================================================
// PUBLIC SHAPES
// ============================================================================

/** Snapshot shape uploaded to the Files API. Mirrors PersistedAuditorState. */
export interface AuditorSnapshot {
  version: number;
  /** Wall-clock when the auditor process started (ISO). */
  startedAt: string;
  lastReport: AuditReport | null;
  currentBlocker: SystemHealthBlocker | null;
  capturedPrompt: CapturedPrompt | null;
  stats: {
    cyclesRun: number;
    cyclesSkipped: number;
    totalViolations: number;
    perInvariantViolations: Record<string, number>;
    lastFlipFromLogOnly: string | null;
    capturedPromptCount: number;
  };
  /**
   * Snapshot metadata — written by persistence.ts, ignored by the
   * auditor on hydrate. Useful for cross-snapshot diagnostics.
   */
  snapshotMeta: {
    /** Bot instance the snapshot was written from. */
    botInstance: string;
    /** ISO wall-clock when the snapshot was uploaded. */
    uploadedAt: string;
    /** Auditor cycle at upload time. */
    auditorCyclesAtUpload: number;
  };
}

/**
 * The minimal Files API surface we depend on. Structurally compatible
 * with `Anthropic.Beta.Files` from a future SDK version, but defined
 * locally so the bot's current pinned `@anthropic-ai/sdk@0.39.0` can
 * supply a hand-rolled REST adapter (see `adaptAnthropicClient`).
 */
export interface FilesApiClient {
  /** Upload a JSON blob and return its file id. */
  upload(args: {
    /** Raw JSON content as UTF-8 bytes. */
    content: Uint8Array;
    /** Logical filename — Anthropic stores it in metadata. */
    filename: string;
    /** MIME type. Always 'application/json' for audit snapshots. */
    mimeType: string;
  }): Promise<{ id: string; filename: string; created_at: string }>;

  /** List files in the workspace, optionally filtered by filename prefix. */
  list(args: {
    /** Filter: only return files whose stored filename starts with this. */
    filenamePrefix: string;
    /** Max records to return. Default 100 (the SDK's page size). */
    limit?: number;
  }): Promise<Array<{ id: string; filename: string; created_at: string }>>;

  /** Download a file's content. Returns the JSON-parsed body. */
  download(fileId: string): Promise<unknown>;

  /**
   * Delete a file. Optional — we don't delete in normal operation
   * (immutable history is a feature), but tests and the operator
   * escape hatch use it.
   */
  deleteFile?(fileId: string): Promise<void>;
}

// ============================================================================
// KEYING
// ============================================================================

/**
 * Compute the deterministic filename for a snapshot.
 *
 * The filename embeds wall-clock so a human reading file listings can
 * tell which bot + when. We DON'T rely on filename for ordering on load
 * — that's done via the `created_at` field returned by Files API,
 * which is server-side wall-clock and immune to bot clock drift.
 */
export function snapshotFilename(botInstance: string, now: Date = new Date()): string {
  const safe = sanitizeBotInstance(botInstance);
  const iso = now.toISOString(); // "2026-05-21T18:42:11.123Z"
  const date = iso.slice(0, 10);  // "2026-05-21"
  const hour = iso.slice(11, 13); // "18"
  const minute = iso.slice(14, 16); // "42"
  // We include minute in the filename so multiple snapshots per hour
  // (graceful-shutdown + N-cycle batched) don't collide on filename.
  // Files API filenames don't have to be unique, but unique filenames
  // make the listing-of-files output much easier to skim.
  return `nvr-audit/${safe}/${date}/${hour}${minute}.json`;
}

/**
 * Filename prefix for `list()` queries. Returns everything for a given
 * botInstance (across all dates/hours).
 */
export function snapshotPrefixForBot(botInstance: string): string {
  return `nvr-audit/${sanitizeBotInstance(botInstance)}/`;
}

/**
 * Bot-instance values come from env (BOT_INSTANCE_NAME or RAILWAY_SERVICE_NAME).
 * Filenames containing slashes confuse the eye when listed; everything
 * gets coerced to a safe form.
 */
function sanitizeBotInstance(raw: string): string {
  return raw
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}

// ============================================================================
// PERSIST (write)
// ============================================================================

export interface PersistResult {
  ok: boolean;
  /** Anthropic file id if the upload succeeded. */
  fileId?: string;
  /** Filename uploaded under. */
  filename?: string;
  /** Why the persist was skipped or failed. */
  reason?: string;
}

/**
 * Upload an auditor snapshot to the Files API.
 *
 * Pure async function — fire-and-forget from the auditor's perspective.
 * Never throws; returns `{ ok: false, reason }` on any error so the
 * caller can log + continue.
 */
export async function persistToFilesApi(
  state: Omit<AuditorSnapshot, 'snapshotMeta'>,
  botInstance: string,
  client: FilesApiClient | null,
  opts: { auditorCyclesRun: number; now?: Date } = { auditorCyclesRun: 0 },
): Promise<PersistResult> {
  if (!client) {
    return { ok: false, reason: 'no-client-wired' };
  }
  const now = opts.now ?? new Date();
  const filename = snapshotFilename(botInstance, now);
  const snapshot: AuditorSnapshot = {
    ...state,
    snapshotMeta: {
      botInstance,
      uploadedAt: now.toISOString(),
      auditorCyclesAtUpload: opts.auditorCyclesRun,
    },
  };
  const json = JSON.stringify(snapshot);
  const bytes = new TextEncoder().encode(json);
  try {
    const result = await client.upload({
      content: bytes,
      filename,
      mimeType: 'application/json',
    });
    return { ok: true, fileId: result.id, filename };
  } catch (err: unknown) {
    return { ok: false, filename, reason: `upload-failed: ${(err as Error).message}` };
  }
}

// ============================================================================
// LOAD (read)
// ============================================================================

export interface LoadResult {
  ok: boolean;
  snapshot: AuditorSnapshot | null;
  /** The file id that hydration sourced from, if any. */
  fileId?: string;
  /** When the sourced file was uploaded (server clock). */
  uploadedAt?: string;
  /** Why the load was skipped or failed. */
  reason?: string;
}

/**
 * Pull the most recent snapshot for `botInstance` from the Files API.
 *
 * Strategy:
 *   1. List files whose filename starts with `nvr-audit/${botInstance}/`.
 *   2. Pick the one with the highest `created_at`. Ties broken by
 *      filename desc (newer minute > older minute).
 *   3. Download + JSON-parse + validate shape.
 *
 * Returns `{ ok: false, snapshot: null }` on any failure. Caller falls
 * back to local fs. Never throws.
 */
export async function loadFromFilesApi(
  botInstance: string,
  client: FilesApiClient | null,
): Promise<LoadResult> {
  if (!client) {
    return { ok: false, snapshot: null, reason: 'no-client-wired' };
  }
  let files: Array<{ id: string; filename: string; created_at: string }>;
  try {
    files = await client.list({
      filenamePrefix: snapshotPrefixForBot(botInstance),
      limit: 100,
    });
  } catch (err: unknown) {
    return { ok: false, snapshot: null, reason: `list-failed: ${(err as Error).message}` };
  }
  if (files.length === 0) {
    return { ok: false, snapshot: null, reason: 'no-snapshots' };
  }
  // Sort by created_at DESC, then filename DESC. created_at is the
  // server-side ground truth; filename is the human-readable bucket.
  const sorted = [...files].sort((a, b) => {
    if (a.created_at !== b.created_at) {
      return a.created_at < b.created_at ? 1 : -1;
    }
    return a.filename < b.filename ? 1 : -1;
  });
  const newest = sorted[0];

  let body: unknown;
  try {
    body = await client.download(newest.id);
  } catch (err: unknown) {
    return {
      ok: false,
      snapshot: null,
      fileId: newest.id,
      uploadedAt: newest.created_at,
      reason: `download-failed: ${(err as Error).message}`,
    };
  }

  const snap = validateSnapshot(body);
  if (!snap) {
    return {
      ok: false,
      snapshot: null,
      fileId: newest.id,
      uploadedAt: newest.created_at,
      reason: 'invalid-snapshot-shape',
    };
  }
  return { ok: true, snapshot: snap, fileId: newest.id, uploadedAt: newest.created_at };
}

/**
 * Defensive shape check. The Files API will return whatever we put in,
 * but on the first hydration after a schema change the snapshot may
 * have an older `version` — we reject those so the auditor starts fresh
 * rather than running with a half-populated state.
 */
function validateSnapshot(body: unknown): AuditorSnapshot | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.version !== 1) return null;
  if (typeof b.startedAt !== 'string') return null;
  if (!b.stats || typeof b.stats !== 'object') return null;
  const stats = b.stats as Record<string, unknown>;
  if (typeof stats.cyclesRun !== 'number') return null;
  // `lastReport`, `currentBlocker`, `capturedPrompt`, `snapshotMeta` are
  // optional/nullable — we accept missing snapshotMeta on very-old uploads.
  return body as AuditorSnapshot;
}

// ============================================================================
// CLIENT ADAPTER — bridges Anthropic SDK to our FilesApiClient interface
// ============================================================================

/**
 * Adapt an Anthropic SDK client to our FilesApiClient interface.
 *
 * Two paths:
 *
 *   1. SDK supplies `client.beta.files` directly (future SDK versions).
 *      We adapt the method shapes 1:1.
 *
 *   2. SDK lacks `client.beta.files` (current pinned 0.39.0). We use the
 *      lower-level `client.get`/`client.post` against `/v1/files` with the
 *      `files-api-2025-04-14` beta header — same wire protocol the
 *      future high-level method will sit on top of.
 *
 * Returns `null` if the supplied client doesn't expose either surface
 * (e.g. caller passed a stub during boot before the real client was
 * instantiated). Auditor degrades to local-fs-only in that case.
 */
export function adaptAnthropicClient(client: unknown): FilesApiClient | null {
  if (!client || typeof client !== 'object') return null;

  // Path 1: the high-level beta.files surface from a current/future SDK.
  // We feature-detect rather than type-import because the current pinned
  // SDK version doesn't ship Files API typings at all.
  const c = client as { beta?: { files?: unknown } };
  if (
    c.beta &&
    typeof c.beta === 'object' &&
    c.beta.files &&
    typeof c.beta.files === 'object'
  ) {
    const filesAny = c.beta.files as Record<string, unknown>;
    if (
      typeof filesAny.upload === 'function' &&
      typeof filesAny.list === 'function' &&
      typeof filesAny.download === 'function'
    ) {
      return wrapHighLevelBeta({
        upload: filesAny.upload as (opts: unknown) => Promise<{ id: string; filename: string; created_at: string }>,
        list: filesAny.list as (opts: unknown) => Promise<unknown>,
        download: filesAny.download as (id: string) => Promise<unknown>,
        delete: typeof filesAny.delete === 'function'
          ? (filesAny.delete as (id: string) => Promise<unknown>)
          : undefined,
      });
    }
  }

  // Path 2: hand-roll the REST calls via the SDK's low-level transport.
  const transportAny = client as Record<string, unknown>;
  if (typeof transportAny.post === 'function' && typeof transportAny.get === 'function') {
    return wrapLowLevelTransport({
      post: transportAny.post as (path: string, opts?: unknown) => Promise<unknown>,
      get: transportAny.get as (path: string, opts?: unknown) => Promise<unknown>,
      delete: typeof transportAny.delete === 'function'
        ? (transportAny.delete as (path: string, opts?: unknown) => Promise<unknown>)
        : undefined,
    });
  }
  return null;
}

function wrapHighLevelBeta(files: {
  upload: (opts: unknown) => Promise<{ id: string; filename: string; created_at: string }>;
  list: (opts: unknown) => Promise<unknown>;
  download: (id: string) => Promise<unknown>;
  delete?: (id: string) => Promise<unknown>;
}): FilesApiClient {
  return {
    async upload(args) {
      // Hand off content as a Blob/File-like — both SDK shapes accept it.
      const blob = new Blob([toArrayBuffer(args.content)], { type: args.mimeType });
      // Some SDK versions use { file }, others { content }; pass both keys.
      // The receiving SDK ignores unknown keys.
      const res = await files.upload({
        file: { name: args.filename, type: args.mimeType, blob },
        content: blob,
        filename: args.filename,
      });
      return { id: res.id, filename: res.filename ?? args.filename, created_at: res.created_at };
    },
    async list(args) {
      const res = await files.list({
        limit: args.limit ?? 100,
        // Newer SDKs accept a server-side filename filter; pass it. If
        // the SDK ignores it, we still client-side filter below.
        filename_prefix: args.filenamePrefix,
      });
      const items = extractListItems(res);
      return items.filter(it => it.filename.startsWith(args.filenamePrefix));
    },
    async download(fileId) {
      const res = await files.download(fileId);
      return await readBodyAsJson(res);
    },
    deleteFile: files.delete
      ? async (fileId: string) => {
          await files.delete!(fileId);
        }
      : undefined,
  };
}

function wrapLowLevelTransport(t: {
  post: (path: string, opts?: unknown) => Promise<unknown>;
  get: (path: string, opts?: unknown) => Promise<unknown>;
  delete?: (path: string, opts?: unknown) => Promise<unknown>;
}): FilesApiClient {
  const betaHeader = { 'anthropic-beta': 'files-api-2025-04-14' };
  return {
    async upload(args) {
      const form = new FormData();
      const blob = new Blob([toArrayBuffer(args.content)], { type: args.mimeType });
      form.append('file', blob, args.filename);
      const res = (await t.post('/v1/files', {
        body: form,
        headers: betaHeader,
      })) as { id: string; filename?: string; created_at: string };
      return { id: res.id, filename: res.filename ?? args.filename, created_at: res.created_at };
    },
    async list(args) {
      // Server-side filename filter is not yet documented for the v1 Files
      // endpoint; do client-side filter.
      const res = (await t.get('/v1/files', {
        query: { limit: args.limit ?? 100 },
        headers: betaHeader,
      })) as unknown;
      const items = extractListItems(res);
      return items.filter(it => it.filename.startsWith(args.filenamePrefix));
    },
    async download(fileId) {
      const res = await t.get(`/v1/files/${encodeURIComponent(fileId)}/content`, {
        headers: betaHeader,
      });
      return await readBodyAsJson(res);
    },
    deleteFile: t.delete
      ? async (fileId: string) => {
          await t.delete!(`/v1/files/${encodeURIComponent(fileId)}`, {
            headers: betaHeader,
          });
        }
      : undefined,
  };
}

function extractListItems(res: unknown): Array<{ id: string; filename: string; created_at: string }> {
  if (!res || typeof res !== 'object') return [];
  const r = res as { data?: unknown; results?: unknown };
  const raw = Array.isArray(r.data) ? r.data : Array.isArray(r.results) ? r.results : [];
  const out: Array<{ id: string; filename: string; created_at: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const it = item as { id?: unknown; filename?: unknown; created_at?: unknown };
    if (typeof it.id === 'string' && typeof it.filename === 'string' && typeof it.created_at === 'string') {
      out.push({ id: it.id, filename: it.filename, created_at: it.created_at });
    }
  }
  return out;
}

async function readBodyAsJson(res: unknown): Promise<unknown> {
  if (res == null) return null;
  if (typeof res === 'string') return JSON.parse(res);
  if (typeof res === 'object') {
    const r = res as { json?: () => Promise<unknown>; text?: () => Promise<string>; arrayBuffer?: () => Promise<ArrayBuffer> };
    if (typeof r.json === 'function') {
      try {
        return await r.json();
      } catch {
        // Fall through to text/arrayBuffer paths.
      }
    }
    if (typeof r.text === 'function') {
      const text = await r.text();
      return JSON.parse(text);
    }
    if (typeof r.arrayBuffer === 'function') {
      const buf = await r.arrayBuffer();
      return JSON.parse(new TextDecoder().decode(buf));
    }
    // Already a parsed object — return as-is.
    return res;
  }
  return null;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // The bytes view may be over a SharedArrayBuffer or a slice; copy into
  // a fresh ArrayBuffer so the Blob constructor accepts it across runtimes.
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}
