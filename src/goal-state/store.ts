// NVR-SPEC-030 Goal-State Reasoner — v0.1
//
// Persistence layer. Vercel KV via REST API (no @vercel/kv dep — single
// HTTP client, env-configured). Two keys per agent:
//
//   goal-state:<agentId>            — current state (single document)
//   goal-state:<agentId>:history    — append-only Redis list of past states
//
// All writes use optimistic concurrency via content_sha256 — the caller
// presents the sha256 of the state it READ; if the current store's
// contentSha256 disagrees, the write fails and the caller re-reads.
// Single-writer-per-agent in v0.1, but the precondition is cheap and the
// migration to Managed Agents memory store (v0.2) reuses the primitive.
//
// Env:
//   KV_REST_API_URL    — e.g. https://<id>.kv.vercel-storage.com
//   KV_REST_API_TOKEN  — bearer token from Vercel KV → Connection → REST

import { createHash } from 'node:crypto';
import { GoalState, EVIDENCE_RING_BUFFER_SIZE } from './types.js';

const KV_REST_API_URL = process.env.KV_REST_API_URL ?? '';
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN ?? '';
const HTTP_TIMEOUT_MS = 3000;

function kvConfigured(): boolean {
  return KV_REST_API_URL.length > 0 && KV_REST_API_TOKEN.length > 0;
}

async function kvCommand<T>(body: unknown[]): Promise<T | null> {
  if (!kvConfigured()) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    const res = await fetch(KV_REST_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: T };
    return json.result ?? null;
  } catch {
    return null;
  }
}

function currentKey(agentId: string): string {
  return `goal-state:${agentId}`;
}

function historyKey(agentId: string): string {
  return `goal-state:${agentId}:history`;
}

/** Deterministic SHA-256 of the state's logical content (excluding the sha field itself). */
export function computeContentSha(state: GoalState): string {
  const { contentSha256: _ignored, ...rest } = state;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}

/** Load the current goal-state for an agent. Returns null when none exists OR KV is unconfigured (caller seeds). */
export async function loadGoalState(agentId: string): Promise<GoalState | null> {
  const raw = await kvCommand<string>(['GET', currentKey(agentId)]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GoalState;
  } catch {
    return null;
  }
}

/**
 * Save the goal-state with optimistic-concurrency check.
 *
 * `expectedSha` must match the contentSha256 the caller READ from the store
 * (or empty string for the very first write). The new state is hashed,
 * appended to history, and SET as current — in that order — so a reader
 * never sees a current state that isn't also in the history list.
 *
 * Returns the saved state (with refreshed contentSha256), or null on
 * concurrency conflict / KV failure. Callers re-read on null.
 */
export async function saveGoalState(
  state: GoalState,
  expectedSha: string,
): Promise<GoalState | null> {
  // Concurrency check: read the live state's sha.
  const live = await loadGoalState(state.agentId);
  const liveSha = live ? live.contentSha256 : '';
  if (liveSha !== expectedSha) return null;

  // Trim the evidence ring buffer.
  const trimmed: GoalState = {
    ...state,
    evidenceOfProgress: state.evidenceOfProgress.slice(-EVIDENCE_RING_BUFFER_SIZE),
    lastUpdatedAt: new Date().toISOString(),
    contentSha256: '',
  };
  trimmed.contentSha256 = computeContentSha(trimmed);

  const payload = JSON.stringify(trimmed);

  // Append to history first — never current-without-history.
  await kvCommand(['LPUSH', historyKey(state.agentId), payload]);
  // Optional ring-buffer on history to keep it bounded.
  await kvCommand(['LTRIM', historyKey(state.agentId), 0, 199]);

  // Then SET current.
  const setOk = await kvCommand<string>(['SET', currentKey(state.agentId), payload]);
  if (setOk !== 'OK') return null;
  return trimmed;
}

// ============================================================================
// Audit-log persistence — NVR-SPEC-030 Stage 3 v1 audit-window substrate
// ============================================================================
//
// Railway's log buffer retains ~500 lines per call (~2 heavy cycles of
// activity). The 7-day v1→v2 audit window we scoped cannot be reconstructed
// from Railway logs alone. Persisting each audit line to a KV ring buffer
// closes the gap with zero new infrastructure — same Upstash KV the goal-state
// reasoner already uses, same authentication, single new key family.
//
// Capacity:
//   - Heavy cycle interval: ~15 minutes
//   - Ring size: AUDIT_LOG_RING_BUFFER_SIZE (default 1000)
//   - Coverage at default: 1000 × 15 min ≈ 10.4 days
//   - Well above the 7-day audit window scope.

const AUDIT_LOG_RING_BUFFER_SIZE = 1000;

function auditLogKey(agentId: string): string {
  return `audit-log:${agentId}:tail`;
}

/** Structured representation of a [GoalState:audit] log line. */
export interface AuditLogEntry {
  ts: string;                                       // ISO timestamp
  cycle: number;                                    // state.totalCycles
  path: 'llm' | 'deterministic' | 'subscriber-mute';
  goal: string;                                     // master goal (truncated)
  lastDecided: string;                              // previous cycle's outcome (truncated)
  lastEval: 'CLOSER' | 'noise' | 'none';            // evaluator's verdict on the previous cycle
  blockers: number;                                 // active blocker count
  botActions: string[];                             // each action as "ACTION:TOKEN@$AMT"
  // 2026-05-17 B4: Sonnet's raw proposals BEFORE downstream gates
  // (Bear Mode conversion, risk reviewer, executor) transformed them. The
  // delta between rawLlmActions and botActions reveals which gate fired
  // on which proposal. Optional for back-compat — older entries lack it.
  rawLlmActions?: string[];
  // 2026-05-17 B4 iter 2: whether main makeTradeDecision actually reached
  // the LLM call this cycle. `false` means it short-circuited (e.g., the
  // DETERMINISTIC_HOLD_GATE at line ~5108). Without this field, you can't
  // tell whether Sonnet saw the prompt at all vs. saw it and returned HOLD.
  mainCycleLlmFired?: boolean;
}

/**
 * Append an audit-log entry to the KV ring buffer.
 *
 * Fire-and-forget. Returns true on confirmed write, false on KV error or
 * unconfigured environment. Caller should NOT branch trading behavior on
 * the return — the audit log is observability, not control flow.
 */
export async function appendAuditLogEntry(
  agentId: string,
  entry: AuditLogEntry,
): Promise<boolean> {
  if (!kvConfigured()) return false;
  const payload = JSON.stringify(entry);
  // LPUSH new entry to head of list
  const pushed = await kvCommand<number>(['LPUSH', auditLogKey(agentId), payload]);
  if (pushed === null) return false;
  // LTRIM to keep at most AUDIT_LOG_RING_BUFFER_SIZE — bounded growth.
  await kvCommand(['LTRIM', auditLogKey(agentId), 0, AUDIT_LOG_RING_BUFFER_SIZE - 1]);
  return true;
}

/**
 * Read the most recent N audit-log entries (newest first). Used by the
 * /api/audit-log/recent endpoint for the v1→v2 audit-window review.
 */
export async function readRecentAuditLog(
  agentId: string,
  limit: number = 50,
): Promise<AuditLogEntry[]> {
  const n = Math.max(1, Math.min(limit, AUDIT_LOG_RING_BUFFER_SIZE));
  const raw = await kvCommand<string[]>(['LRANGE', auditLogKey(agentId), 0, n - 1]);
  if (!raw) return [];
  const out: AuditLogEntry[] = [];
  for (const s of raw) {
    try {
      out.push(JSON.parse(s) as AuditLogEntry);
    } catch {
      // skip malformed
    }
  }
  return out;
}

/**
 * NVR-SPEC-030 Stage 3 v1 — update only `lastNextStep` + `lastNextStepAt`
 * on the current goal-state, leaving all other fields untouched.
 *
 * Used by the heavy-cycle entrypoint to overwrite the pre-decision
 * placeholder with what the bot ACTUALLY decided this cycle (deterministic
 * HOLD, Sonnet HOLD/BUY/SELL, subscriber-mute, etc.). The next cycle's
 * evaluator then judges moveCloser against the real outcome instead of a
 * pre-baked input string.
 *
 * Loads fresh, mutates the two fields, writes back with the live sha. On
 * sha mismatch (another writer beat us), returns null — caller logs and
 * moves on; the field is cosmetic-only for the evaluator's prompt, so a
 * one-cycle stale value is acceptable.
 */
export async function updateGoalStateLastNextStep(
  agentId: string,
  nextStep: string,
  now: Date = new Date(),
): Promise<GoalState | null> {
  const live = await loadGoalState(agentId);
  if (!live) return null;
  const updated: GoalState = {
    ...live,
    lastNextStep: nextStep,
    lastNextStepAt: now.toISOString(),
    lastNextStepOutcome: 'pending',
    lastUpdatedAt: now.toISOString(),
    contentSha256: live.contentSha256,
  };
  return saveGoalState(updated, live.contentSha256);
}

/** Read the last N history entries for audit / cockpit timeline. */
export async function loadGoalHistory(
  agentId: string,
  limit = 20,
): Promise<GoalState[]> {
  const raw = await kvCommand<string[]>(['LRANGE', historyKey(agentId), 0, limit - 1]);
  if (!raw) return [];
  const out: GoalState[] = [];
  for (const s of raw) {
    try {
      out.push(JSON.parse(s) as GoalState);
    } catch {
      // skip malformed
    }
  }
  return out;
}

/** True when the bot's env is set up for goal-state persistence. */
export function isGoalStateConfigured(): boolean {
  return kvConfigured();
}
