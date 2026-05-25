/**
 * NVR-SPEC-035 System Auditor — Phase A orchestrator.
 *
 * Runs at the end of every heavy cycle. Asserts the four SEVERE
 * invariants. Routes severity per Henry's 2026-05-19 ratifications:
 *
 *   - path-specific pause on SEVERE (per invariant.pauseScope)
 *   - log-only alert mode for the first 24h of runtime, then auto-flip to
 *     "alert" (Telegram fires on new SEVEREs)
 *   - per-invariant opt-in for auto-correction (Phase C, not in this ship)
 *   - INV-4 covers all agent emissions (Phase B, not in this ship)
 *
 * Public surface:
 *   - runSystemAuditor(deps)  → AuditReport
 *   - captureLastPrompt(...)  → stash a prompt for next cycle's INV-3
 *   - canExecuteAction(...)   → trade-execution gate consults this
 *   - getCurrentBlocker()     → current SystemHealthBlocker or null
 *   - getMonitorStats()       → cumulative + per-invariant counters
 *
 * The auditor is OFF by default (`SYSTEM_AUDITOR_ENABLED` env). When
 * disabled, runSystemAuditor() is a no-op, captureLastPrompt is a no-op,
 * and canExecuteAction always returns { allowed: true }. Importing this
 * module is safe — zero side effects until the env flag is set.
 */

import * as fs from 'fs';
import type {
  AuditReport,
  AuditorMode,
  CapturedPrompt,
  Invariant,
  InvariantContext,
  PauseScope,
  SystemHealthBlocker,
  Violation,
} from './types.js';

import { dimensionalHonesty } from './invariants/dimensional-honesty.js';
import { fictionalPnl } from './invariants/fictional-pnl.js';
import { promptCoherence } from './invariants/prompt-coherence.js';
import { auditorSelfTest } from './invariants/auditor-self-test.js';
import { chainTruthReconciliation } from './invariants/chain-truth-reconciliation.js';
import { chainDepositReconciliation } from './invariants/chain-deposit-reconciliation.js';
import { cohortCoverage } from './invariants/cohort-coverage.js';
import { reserveFloor } from './invariants/reserve-floor.js';
import { sleeveLiveness } from './invariants/sleeve-liveness.js';
import { observationConsumer } from './invariants/observation-consumer.js';
import { cycleTradeRatio } from './invariants/cycle-trade-ratio.js';
import type { LiveOnChainSnapshot } from './sources/live-onchain.js';
import type { ChainDepositHistory } from './sources/chain-deposit-history.js';
import {
  adaptAnthropicClient,
  loadFromFilesApi,
  persistToFilesApi,
  type AuditorSnapshot,
  type FilesApiClient,
} from './persistence.js';

// ============================================================================
// CONFIG
// ============================================================================

/** Module is read lazily so tests + scripts can flip the env after import. */
function isEnabled(): boolean {
  return process.env.SYSTEM_AUDITOR_ENABLED === 'true';
}

/**
 * Initial alert mode. Per Henry's ratification: `log-only` for the first
 * 24h of runtime, then auto-flips to `alert`. The env var can override
 * (`SYSTEM_AUDITOR_ALERT_MODE=alert` forces alert immediately;
 * `SYSTEM_AUDITOR_ALERT_MODE=disabled` skips all alerting).
 */
function getEnvMode(): AuditorMode | null {
  const raw = process.env.SYSTEM_AUDITOR_ALERT_MODE;
  if (raw === 'log-only' || raw === 'alert' || raw === 'disabled') return raw;
  return null;
}

const PERSIST_DIR = process.env.PERSIST_DIR || './logs';
const REPORT_FILE = `${PERSIST_DIR}/system-auditor-report.json`;
const LOG_ONLY_AUTO_FLIP_MS = 24 * 60 * 60 * 1000;

/**
 * Files-API persistence cadence. Local-fs write happens every cycle; the
 * Files-API upload happens every N cycles AND on graceful shutdown.
 *
 * Default 10 cycles ≈ 2.5h on a 15-min cycle, which is a reasonable
 * trade-off between API cost / Files-API rate-limit pressure and how
 * much history we'd lose to a Railway redeploy mid-run.
 *
 * Env override: AUDITOR_FILES_PERSIST_EVERY_N_CYCLES.
 */
function getFilesPersistEveryNCycles(): number {
  const raw = process.env.AUDITOR_FILES_PERSIST_EVERY_N_CYCLES;
  if (!raw) return 10;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return parsed;
}

/** Bot-instance identifier used to namespace Files-API snapshots. */
function resolveBotInstance(): string {
  return (
    process.env.BOT_INSTANCE_NAME ??
    process.env.RAILWAY_SERVICE_NAME ??
    'unknown'
  );
}

// ============================================================================
// PERSISTED + IN-MEMORY STATE
// ============================================================================

interface PersistedAuditorState {
  version: number;
  startedAt: string;
  lastReport: AuditReport | null;
  currentBlocker: SystemHealthBlocker | null;
  capturedPrompt: CapturedPrompt | null;
  stats: AuditorStats;
}

interface AuditorStats {
  cyclesRun: number;
  cyclesSkipped: number;
  totalViolations: number;
  perInvariantViolations: Record<string, number>;
  lastFlipFromLogOnly: string | null;
  capturedPromptCount: number;
}

let _state: PersistedAuditorState = loadPersistedLocal() ?? {
  version: 1,
  startedAt: new Date().toISOString(),
  lastReport: null,
  currentBlocker: null,
  capturedPrompt: null,
  stats: {
    cyclesRun: 0,
    cyclesSkipped: 0,
    totalViolations: 0,
    perInvariantViolations: {},
    lastFlipFromLogOnly: null,
    capturedPromptCount: 0,
  },
};

/**
 * Anthropic Files API client. Wired by the agent at boot via
 * `wireAnthropicClient()`. When null, the auditor degrades to local-fs-
 * only persistence (Tier 3 in the spec). Importing the auditor without
 * wiring this client is intentionally side-effect-free.
 */
let _filesClient: FilesApiClient | null = null;
/**
 * Has the auditor logged the "Files API unavailable, falling back to
 * local fs" WARN yet this process? Latch so we don't spam the log every
 * persist call.
 */
let _filesUnavailableWarned = false;
/**
 * Cycles since the last successful Files API write. When >= the
 * configured cadence, the next persist() call fires a Files API upload
 * (fire-and-forget) and resets the counter.
 */
let _cyclesSinceFilesPersist = 0;
/**
 * Has hydrateFromFilesApi attempted (and either succeeded or failed)?
 * Latch so wiring the client a second time doesn't re-hit the API.
 */
let _filesHydrationAttempted = false;

function loadPersistedLocal(): PersistedAuditorState | null {
  try {
    if (!fs.existsSync(REPORT_FILE)) return null;
    const raw = fs.readFileSync(REPORT_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedAuditorState;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistLocal(): void {
  try {
    if (!fs.existsSync(PERSIST_DIR)) fs.mkdirSync(PERSIST_DIR, { recursive: true });
    const tmp = REPORT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(_state));
    fs.renameSync(tmp, REPORT_FILE);
  } catch (err: unknown) {
    console.warn(`  ⚠️ system-auditor: failed to persist report locally — ${(err as Error).message}`);
  }
}

/**
 * Write current `_state` to both tiers — local fs always, Files API only
 * when the batching gate has elapsed (or `force` is true, e.g. on
 * graceful shutdown).
 *
 * Files-API upload is fire-and-forget: it runs as a detached promise so
 * the per-cycle invariant loop is never blocked on network. Errors are
 * logged but not rethrown.
 */
function persist(opts: { force?: boolean } = {}): void {
  persistLocal();
  _cyclesSinceFilesPersist += 1;
  const cadence = getFilesPersistEveryNCycles();
  const shouldRemote = opts.force === true || _cyclesSinceFilesPersist >= cadence;
  if (!shouldRemote) return;
  if (!_filesClient) {
    if (!_filesUnavailableWarned) {
      console.warn(
        '  ⚠️ system-auditor: Anthropic Files API not wired — auditor persistence is local-fs only (will not survive Railway redeploys). Set ANTHROPIC_API_KEY + wire client to enable.',
      );
      _filesUnavailableWarned = true;
    }
    return;
  }
  _cyclesSinceFilesPersist = 0;
  // Snapshot the current state and fire the upload async. We capture by
  // value so a later mutation to `_state` between scheduling + send
  // doesn't change what gets uploaded.
  const snapshotState: Omit<AuditorSnapshot, 'snapshotMeta'> = JSON.parse(JSON.stringify(_state));
  const botInstance = resolveBotInstance();
  void (async () => {
    const res = await persistToFilesApi(snapshotState, botInstance, _filesClient, {
      auditorCyclesRun: snapshotState.stats.cyclesRun,
    });
    if (res.ok) {
      console.log(
        `[SystemAudit] persisted snapshot to Files API: ${res.filename} (id=${res.fileId})`,
      );
    } else {
      console.warn(
        `  ⚠️ system-auditor: Files API persist failed (${res.reason}) — local fs is still up to date.`,
      );
    }
  })();
}

/**
 * Async hydration from the Files API. Called once, the first time
 * `wireAnthropicClient()` lands a non-null client.
 *
 * Behavior:
 *   - If local fs already has fresher state (i.e. cyclesRun is higher
 *     than the remote snapshot), keep local — we don't want to clobber
 *     a still-running container with an older blob.
 *   - Otherwise, replace `_state` with the remote snapshot so the next
 *     cycle picks up cyclesRun where the prior container left off.
 *   - On any failure, leave the existing `_state` in place and log.
 *
 * Returns a promise so tests can await + observe; production callers
 * fire-and-forget it.
 */
async function hydrateFromFilesApi(): Promise<void> {
  if (_filesHydrationAttempted) return;
  _filesHydrationAttempted = true;
  if (!_filesClient) return;
  const botInstance = resolveBotInstance();
  const res = await loadFromFilesApi(botInstance, _filesClient);
  if (!res.ok || !res.snapshot) {
    if (res.reason !== 'no-snapshots') {
      console.warn(`  ⚠️ system-auditor: Files API hydrate skipped (${res.reason})`);
    } else {
      console.log('[SystemAudit] no prior Files API snapshot found — starting clean');
    }
    return;
  }
  // Conflict resolution: only adopt the remote snapshot if it has at
  // least as many cycles as our local state. This handles the case
  // where this container has been running uninterrupted (local
  // cyclesRun > remote) — in that case the remote is stale and we
  // ignore it.
  if (res.snapshot.stats.cyclesRun < _state.stats.cyclesRun) {
    console.log(
      `[SystemAudit] Files API snapshot is older than local (remote cyclesRun=${res.snapshot.stats.cyclesRun}, local=${_state.stats.cyclesRun}) — keeping local`,
    );
    return;
  }
  _state = {
    version: res.snapshot.version,
    startedAt: res.snapshot.startedAt,
    lastReport: res.snapshot.lastReport,
    currentBlocker: res.snapshot.currentBlocker,
    capturedPrompt: res.snapshot.capturedPrompt,
    stats: res.snapshot.stats,
  };
  console.log(
    `[SystemAudit] hydrated from Files API: cyclesRun=${_state.stats.cyclesRun} (file=${res.fileId}, uploadedAt=${res.uploadedAt})`,
  );
  // Mirror the hydrated state to local fs so subsequent in-container
  // restarts (e.g. process crash + Railway auto-restart) don't lose
  // ground before the next Files API write.
  persistLocal();
}

// ============================================================================
// ALERT MODE — log-only-for-24h then auto-flip to alert
// ============================================================================

function effectiveAlertMode(): AuditorMode {
  const envMode = getEnvMode();
  if (envMode) return envMode;

  // Auto-flip logic: if state has been running >24h, flip from log-only to alert.
  const startedMs = new Date(_state.startedAt).getTime();
  const ageMs = Date.now() - startedMs;
  if (ageMs > LOG_ONLY_AUTO_FLIP_MS) {
    if (_state.stats.lastFlipFromLogOnly === null) {
      _state.stats.lastFlipFromLogOnly = new Date().toISOString();
      console.log(`[SystemAudit] alert-mode auto-flipped log-only → alert (24h grace expired)`);
    }
    return 'alert';
  }
  return 'log-only';
}

// ============================================================================
// REGISTRY OF SEVERE INVARIANTS — Phase A
// ============================================================================

const PHASE_A_INVARIANTS: Array<{ id: string; fn: Invariant }> = [
  { id: 'INV-1', fn: dimensionalHonesty },
  { id: 'INV-2', fn: fictionalPnl },
  { id: 'INV-3', fn: promptCoherence },
  { id: 'INV-9', fn: auditorSelfTest },
  // Phase A.1 (2026-05-20): live on-chain reconciliation — the only source
  // with no shared blind spot vs in-state cache. Would have caught the
  // May-20 aUSDC drift on the cycle it appeared.
  { id: 'INV-10', fn: chainTruthReconciliation },
  // Phase A.1 (2026-05-20): chain-deposit reconciliation — catches Zack-
  // class wallet-rotation amnesia where the bot's totalDeposited resets
  // when the wallet rotates and loses sight of pre-rotation deposits.
  { id: 'INV-11', fn: chainDepositReconciliation },
];

/**
 * Phase B — WARN-tier invariants. Don't pause anything; surface that the
 * bot's strategy intent and its actual positions are out of alignment.
 * Run alongside Phase A every heavy cycle.
 */
const PHASE_B_INVARIANTS: Array<{ id: string; fn: Invariant }> = [
  // Phase B (2026-05-21): observation-consumer contract. WARN when the
  // external observation feed (stc-website auto-investigation, alpha-
  // watcher emissions) drifts off-shape — schema-invalid records or a
  // majority of empty/null content. Closes the loop on the stc-website
  // garbage-findings regression that polluted the bot's prompt repeatedly
  // before the consumer validator was added. Silent until Phase C wires
  // the actual observation pipeline.
  { id: 'INV-4', fn: observationConsumer },
  // Phase B (2026-05-21): cohort coverage. WARN every cycle until the
  // 7-quality Option B cohort is actually held in non-dust size. Forcing
  // function for Ship 2 (cohort completion) — bot logs name the missing
  // symbols on every cycle, so they can't get lost in the noise.
  { id: 'INV-5', fn: cohortCoverage },
  // Phase B (2026-05-21): reserve floor. WARN when USDC reserve drops
  // below the 20% warning band (25% target with 5pp tolerance). The
  // structural counterpart to "USDC-reserve is the only hard rule" —
  // until now that rule lived as documentation; now drift surfaces every
  // cycle and flows into the prompt via the WARN-injection block.
  { id: 'INV-6', fn: reserveFloor },
  // Phase B (2026-05-21): sleeve liveness. WARN when any live sleeve has
  // gone >12h without rendering a decision. Would have caught the May-19
  // Alpha Hunter 40h silence pre-PR #30. Skips paper sleeves and sleeves
  // that have never decided (warmup, not regression).
  { id: 'INV-7', fn: sleeveLiveness },
  // Phase B (2026-05-21): cycle-vs-trade ratio. WARN when heavy cycles
  // advance past the boot grace window (8 cycles ≈ 2h) without a single
  // trade since restart. Catches the "bot is running but rendering
  // decisions that never execute" failure mode — routing bugs, stale
  // gates, permanent HOLD lock-in. Measured off a boot-baseline so a
  // mid-day redeploy of a long-running bot doesn't get false silence.
  { id: 'INV-8', fn: cycleTradeRatio },
];

const ALL_INVARIANTS: Array<{ id: string; fn: Invariant }> = [
  ...PHASE_A_INVARIANTS,
  ...PHASE_B_INVARIANTS,
];

// ============================================================================
// SEVERITY ROUTING
// ============================================================================

/**
 * Given the violations from this cycle, decide the resulting blocker (if
 * any). Path-specific per Henry's ratification.
 *
 * Multiple SEVEREs with different pauseScopes merge to the most restrictive:
 *   - any `all-buys` → all-buys
 *   - else if any `per-token-buys` → per-token-buys with union of affected tokens
 *   - else if any `next-llm` → next-llm
 *   - else → none
 *
 * The blocker carries the most-recent invariantId for traceability.
 */
function deriveBlocker(violations: Violation[], prevBlocker: SystemHealthBlocker | null): SystemHealthBlocker | null {
  // Trading-tier scopes only. Display-tier scopes ('all-displays') are tracked
  // independently via isDisplayGateActive() so they don't compete with trading
  // scopes for the single blocker slot. When INV-1 (all-buys) and INV-11
  // (all-displays) are both SEVERE, the trade gate fires AND the display gate
  // fires — neither masks the other.
  const TRADING_SCOPES = new Set<PauseScope>(['all-buys', 'per-token-buys', 'next-llm']);
  const severe = violations.filter(v => v.severity === 'SEVERE' && TRADING_SCOPES.has(v.pauseScope));
  if (severe.length === 0) {
    return null;
  }

  // Pick the most restrictive scope. Order: all-buys > per-token-buys > next-llm.
  // 'none' and 'all-displays' sit at 0 so the exhaustiveness check passes; they
  // can't appear in `severe` after the TRADING_SCOPES filter above.
  const order: Record<PauseScope, number> = {
    'all-buys': 3,
    'per-token-buys': 2,
    'next-llm': 1,
    'all-displays': 0,
    'none': 0,
  };
  let winningScope: PauseScope = 'none';
  let winningInvariantId = severe[0].invariantId;
  const affectedSet = new Set<string>();

  for (const v of severe) {
    if (order[v.pauseScope] > order[winningScope]) {
      winningScope = v.pauseScope;
      winningInvariantId = v.invariantId;
    }
    if (v.pauseScope === 'per-token-buys' && v.affectedTokens) {
      for (const t of v.affectedTokens) affectedSet.add(t);
    }
  }

  const nowIso = new Date().toISOString();
  const consecutive =
    prevBlocker?.active && prevBlocker.invariantId === winningInvariantId
      ? prevBlocker.consecutiveCycles + 1
      : 1;

  return {
    active: true,
    invariantId: winningInvariantId,
    pauseScope: winningScope,
    affectedTokens: winningScope === 'per-token-buys' ? Array.from(affectedSet).sort() : undefined,
    reason: severe.find(v => v.invariantId === winningInvariantId)?.message ?? 'unknown',
    setAt: prevBlocker?.active && prevBlocker.invariantId === winningInvariantId ? prevBlocker.setAt : nowIso,
    lastObservedAt: nowIso,
    consecutiveCycles: consecutive,
  };
}

// ============================================================================
// TELEGRAM ALERTING (deferred — pluggable via setter)
//
// The bot's Telegram service is set up at startup in agent-v3.2.ts. We
// don't want to import it here (circular-import risk + the auditor must
// remain side-effect-free when disabled). Instead, the agent calls
// `wireTelegram(sendAlertFn)` once at startup. If never wired, alert mode
// degrades silently to log-only.
// ============================================================================

type TelegramSendFn = (msg: string) => Promise<void> | void;
let _telegramSend: TelegramSendFn | null = null;

export function wireTelegram(fn: TelegramSendFn): void {
  _telegramSend = fn;
}

/**
 * Wire the Anthropic SDK client at agent boot. Mirrors `wireTelegram`.
 *
 * Accepts:
 *   - A real Anthropic SDK client (`new Anthropic({ apiKey })`). We
 *     adapt it via `adaptAnthropicClient`.
 *   - A pre-adapted `FilesApiClient` (useful for tests + future migration
 *     to a different upload backend).
 *   - `null` — explicitly disable Files API persistence. Tests use this
 *     to assert local-fs-only fallback.
 *
 * After wiring, the auditor kicks off a one-shot async hydration to pull
 * the most recent snapshot for this bot instance. Hydration runs in the
 * background and does not block the caller.
 *
 * Idempotent: re-wiring later replaces the client but does NOT re-trigger
 * hydration (state is already in memory by then).
 */
export function wireAnthropicClient(clientOrAdapter: unknown | FilesApiClient | null): void {
  if (clientOrAdapter === null) {
    _filesClient = null;
    return;
  }
  // Already adapted? Use as-is. Heuristic: an adapted client has
  // `upload`, `list`, and `download` as functions but no `messages`
  // / `beta` from the Anthropic SDK.
  const c = clientOrAdapter as Partial<FilesApiClient>;
  if (
    typeof c.upload === 'function' &&
    typeof c.list === 'function' &&
    typeof c.download === 'function'
  ) {
    _filesClient = clientOrAdapter as FilesApiClient;
  } else {
    _filesClient = adaptAnthropicClient(clientOrAdapter);
  }
  if (!_filesClient) {
    if (!_filesUnavailableWarned) {
      console.warn(
        '  ⚠️ system-auditor: wireAnthropicClient called with an unrecognized client shape — Files API persistence disabled.',
      );
      _filesUnavailableWarned = true;
    }
    return;
  }
  // Fire hydration in the background; don't block the caller.
  void hydrateFromFilesApi();
}

/**
 * Graceful-shutdown handler — flush the current `_state` to the Files
 * API immediately (bypassing the N-cycle batching gate). Awaitable so
 * the agent's SIGTERM handler can wait for it before exiting.
 *
 * Safe to call when no client is wired — falls through to local-only
 * persist (already up to date).
 */
export async function flushAuditorPersistenceOnShutdown(): Promise<void> {
  persistLocal();
  if (!_filesClient) return;
  const snapshotState: Omit<AuditorSnapshot, 'snapshotMeta'> = JSON.parse(JSON.stringify(_state));
  const botInstance = resolveBotInstance();
  const res = await persistToFilesApi(snapshotState, botInstance, _filesClient, {
    auditorCyclesRun: snapshotState.stats.cyclesRun,
  });
  _cyclesSinceFilesPersist = 0;
  if (res.ok) {
    console.log(
      `[SystemAudit] shutdown snapshot persisted to Files API: ${res.filename} (id=${res.fileId})`,
    );
  } else {
    console.warn(
      `  ⚠️ system-auditor: shutdown Files API persist failed (${res.reason})`,
    );
  }
}

async function maybeAlert(violations: Violation[], mode: AuditorMode, cycle: number): Promise<void> {
  if (mode !== 'alert') return;
  if (!_telegramSend) return; // not wired — log path covers it
  const severe = violations.filter(v => v.severity === 'SEVERE');
  if (severe.length === 0) return;

  const lines = [
    `🚨 SYSTEM AUDITOR — ${severe.length} SEVERE violation(s) at cycle ${cycle}`,
    ...severe.slice(0, 5).map(v => `• ${v.invariantId} — ${v.message}`),
  ];
  try {
    await _telegramSend(lines.join('\n'));
  } catch (err: unknown) {
    console.warn(`  ⚠️ system-auditor: telegram send failed — ${(err as Error).message}`);
  }
}

// ============================================================================
// PUBLIC: prompt capture (called pre-send from agent-v3.2.ts)
// ============================================================================

/**
 * Stash the about-to-be-sent prompt so the next audit run can validate
 * its coherence. No-op when the auditor is disabled.
 */
export function captureLastPrompt(args: {
  text: string;
  portfolioValueClaimed: number;
  modelLabel: string;
  cycle: number;
}): void {
  if (!isEnabled()) return;
  const capture: CapturedPrompt = {
    capturedAt: new Date().toISOString(),
    cycle: args.cycle,
    text: args.text,
    portfolioValueClaimed: args.portfolioValueClaimed,
    modelLabel: args.modelLabel,
    approxTokens: Math.ceil(args.text.length / 4),
  };
  _state.capturedPrompt = capture;
  _state.stats.capturedPromptCount += 1;
}

// ============================================================================
// PUBLIC: trade-execution gate
// ============================================================================

/**
 * The trade-execution path consults this before any BUY (or any LLM
 * decision). When disabled, always allows. When enabled, checks the
 * current blocker against the proposed action.
 *
 * Per ratified pause semantics:
 *   - `all-buys` blocker → block any action where action === 'BUY'
 *   - `per-token-buys` blocker → block only BUYs of affected tokens
 *   - `next-llm` blocker → block ONE LLM-driven decision (consumed) and
 *     allow the rest. Deterministic gates can call this with `source: 'deterministic'`
 *     to bypass entirely.
 *   - `none` or no blocker → allow
 */
export function canExecuteAction(args: {
  action: 'BUY' | 'SELL' | 'HOLD' | 'REBALANCE';
  symbol?: string;
  /**
   * Who's asking. `llm` means the call originated from a model-generated
   * TradeDecision; `deterministic` means a force-sell, trailing-stop,
   * breaker exit, or other rule-driven path. The `next-llm` pause scope
   * only blocks `llm`-source calls.
   */
  source: 'llm' | 'deterministic';
}): { allowed: boolean; reason?: string } {
  if (!isEnabled()) return { allowed: true };
  const blocker = _state.currentBlocker;
  if (!blocker || !blocker.active) return { allowed: true };

  // SELLs and HOLDs are never blocked by any current scope — exits stay open
  if (args.action !== 'BUY' && args.action !== 'REBALANCE') return { allowed: true };

  switch (blocker.pauseScope) {
    case 'all-buys':
      // REBALANCE is treated as allowed here because rebalances are
      // capital-shape corrections, not new directional exposure. SELLs
      // would already have returned allowed above. Only fresh BUYs pause.
      if (args.action === 'BUY') {
        return {
          allowed: false,
          reason: `SystemAuditor blocker active (${blocker.invariantId}): ${blocker.reason}`,
        };
      }
      return { allowed: true };

    case 'per-token-buys': {
      if (args.action !== 'BUY') return { allowed: true };
      const isAffected = !!args.symbol && (blocker.affectedTokens ?? []).includes(args.symbol);
      if (isAffected) {
        return {
          allowed: false,
          reason: `SystemAuditor per-token blocker active for ${args.symbol} (${blocker.invariantId})`,
        };
      }
      return { allowed: true };
    }

    case 'next-llm':
      if (args.source !== 'llm') return { allowed: true };
      // Consume the blocker — next LLM call is the one we block
      const reason = `SystemAuditor next-llm blocker active (${blocker.invariantId}): ${blocker.reason}`;
      _state.currentBlocker = null;
      persist();
      return { allowed: false, reason };

    case 'all-displays':
      // Display-tier scope: signals customer-facing surfaces to refuse the
      // affected number, never gates trading. The bot trades exactly as if
      // no blocker were active; the dashboard reads the blocker via
      // /api/portfolio and renders a banner in place of PnL.
      return { allowed: true };

    case 'none':
      return { allowed: true };
  }

  return { allowed: true };
}

export function getCurrentBlocker(): SystemHealthBlocker | null {
  return _state.currentBlocker;
}

/**
 * True iff the most-recent audit report has at least one SEVERE violation
 * with pauseScope='all-displays' (currently INV-11 chain-deposit-reconciliation).
 *
 * Tracked independently of currentBlocker so a trading-tier blocker can't mask
 * the display-tier signal. The customer dashboard reads this through
 * /api/portfolio.displayGate and refuses to render PnL when true.
 *
 * Returns false on bots that haven't run an audit cycle yet (no lastReport).
 */
export function isDisplayGateActive(): boolean {
  const last = _state.lastReport;
  if (!last) return false;
  return last.violations.some(
    v => v.severity === 'SEVERE' && v.pauseScope === 'all-displays'
  );
}

export function getMonitorStats(): AuditorStats & { enabled: boolean; alertMode: AuditorMode } {
  return {
    enabled: isEnabled(),
    alertMode: effectiveAlertMode(),
    ...JSON.parse(JSON.stringify(_state.stats)),
  };
}

/**
 * Most recent AuditReport (or null if the auditor has never run).
 * Returned by deep clone so callers can't mutate persisted state.
 * Exposed via /api/system-audit so operators + the website can confirm
 * INV-10/INV-11 firing without Railway log access.
 */
export function getLastReport(): AuditReport | null {
  return _state.lastReport ? (JSON.parse(JSON.stringify(_state.lastReport)) as AuditReport) : null;
}

/**
 * Auditor's wall-clock start time (ISO) — used to compute age and
 * confirm the log-only → alert auto-flip has fired.
 */
export function getStartedAt(): string {
  return _state.startedAt;
}

/** Test/operator escape hatch — clear the active blocker manually. */
export function clearBlocker(reason: string): void {
  if (!_state.currentBlocker) return;
  console.log(`[SystemAudit] blocker cleared manually: ${reason}`);
  _state.currentBlocker = null;
  persist();
}

// ============================================================================
// MAIN ENTRY — runSystemAuditor
// ============================================================================

export interface AuditorDeps {
  /** From state.trading.balances */
  balances: Array<{ symbol: string; balance: number; usdValue: number; price?: number; sector?: string }>;
  /** From state.trading.totalPortfolioValue */
  totalPortfolioValue: number;
  /** From state.costBasis */
  costBasis: Record<string, {
    symbol: string;
    realizedPnL: number;
    totalInvestedUSD: number;
    totalTokensAcquired: number;
    averageCostBasis: number;
    currentHolding: number;
  }>;
  /** From the agent's lastKnownPrices map (used by INV-1 for the position-sum source). */
  lastKnownPrices: Record<string, { price: number }>;
  /** Current cycle counter from state.totalCycles. */
  cycle: number;
  /**
   * Phase A.1 — optional live on-chain snapshot for INV-10. The agent
   * polls this every N cycles (not every cycle — too RPC-expensive)
   * via `captureLiveOnChainSnapshot()` from `./sources/live-onchain.js`.
   * When null, INV-10 stays silent for the cycle. When set, INV-10
   * compares against in-state and fires SEVERE on >5% disagreement.
   */
  liveOnChainSnapshot?: LiveOnChainSnapshot | null;
  /**
   * Phase A.1 — optional chain-deposit history for INV-11. The agent
   * refreshes this once per day (deposits are rare events). When null,
   * INV-11 stays silent. When set, INV-11 compares against
   * botTotalDeposited and fires SEVERE if the gap exceeds tolerance.
   */
  chainDepositHistory?: ChainDepositHistory | null;
  /** Phase A.1 — INV-11 input. From state.totalDeposited. */
  botTotalDeposited?: number | null;
  /**
   * Phase B — INV-7 input. Per-sleeve liveness for the current cycle.
   * Collected by the agent at the auditor call site from
   * sleeveRegistry.sleeves() + each sleeve's getStats().lastDecisionAt.
   * Optional — when omitted, INV-7 stays silent for the cycle.
   */
  sleeveLiveness?: Array<{
    id: string;
    mode: string;
    lastDecisionAt: string | null;
    decisionsCount: number;
  }>;
  /**
   * Phase B — INV-4 input. Records ingested from external observation
   * sources this cycle. Phase B leaves this undefined (the agent call
   * site doesn't populate it yet); Phase C wires the real observation
   * pipeline. When omitted, INV-4 stays silent.
   */
  observations?: Array<{
    source: string;
    observation: string | null;
    receivedAt: string;
    schemaValid: boolean;
  }>;
  /**
   * Phase B — INV-8 input. Trades successfully executed since this
   * process booted. Computed at the agent call site as
   * `state.trading.totalTrades - (state._tradesAtBoot ?? totalTrades)`.
   * Optional — when omitted, INV-8 stays silent.
   */
  tradesSinceRestart?: number;
}

/**
 * Run the auditor on the supplied snapshot. Returns the report.
 * Called at the end of every heavy cycle. No-op when disabled.
 */
export async function runSystemAuditor(deps: AuditorDeps): Promise<AuditReport | null> {
  if (!isEnabled()) {
    _state.stats.cyclesSkipped += 1;
    return null;
  }

  const startedAt = Date.now();
  const mode = effectiveAlertMode();

  const ctx: InvariantContext = {
    balances: deps.balances,
    totalPortfolioValue: deps.totalPortfolioValue,
    costBasis: deps.costBasis,
    lastKnownPrices: deps.lastKnownPrices,
    capturedPrompt: _state.capturedPrompt,
    cycle: deps.cycle,
    previousReport: _state.lastReport,
    // Auditor's own first-run signal — independent of the bot's
    // state.totalCycles (which persists across restarts and would
    // never be 0 on a fresh Railway boot). INV-9 uses this for the
    // fresh-boot grace.
    auditorCyclesRun: _state.stats.cyclesRun,
    // Phase A.1 — chain-truth snapshot. Optional. INV-10 returns null
    // when this is null (caller didn't refresh this cycle); the absence
    // is not a failure, the noise-floor is lower.
    liveOnChainSnapshot: deps.liveOnChainSnapshot ?? null,
    // Phase A.1 — chain-deposit history. Optional. INV-11 returns null
    // when either history or botTotalDeposited is null.
    chainDepositHistory: deps.chainDepositHistory ?? null,
    botTotalDeposited: deps.botTotalDeposited ?? null,
    // Phase B — sleeve liveness for INV-7. Optional. When omitted, INV-7
    // returns null and stays silent for the cycle.
    sleeveLiveness: deps.sleeveLiveness,
    // Phase B — observation feed for INV-4. Optional. Phase B leaves
    // this unpopulated; INV-4 returns null until Phase C wires the real
    // observation pipeline.
    observations: deps.observations,
    // Phase B — trades-since-restart for INV-8. Optional. When omitted,
    // INV-8 stays silent. Measured off a process-boot baseline (see
    // agent-v3.2.ts `state._tradesAtBoot` capture) so mid-day redeploys
    // of long-running bots don't trip false silence.
    tradesSinceRestart: deps.tradesSinceRestart,
  };

  // Run every invariant; isolate failures so one buggy invariant doesn't
  // take the rest down. A thrown invariant is itself a SEVERE.
  const violations: Violation[] = [];
  for (const inv of ALL_INVARIANTS) {
    try {
      const v = inv.fn(ctx);
      if (v) violations.push(v);
    } catch (err: unknown) {
      violations.push({
        invariantId: inv.id,
        invariantName: `${inv.id}-threw`,
        severity: 'SEVERE',
        message: `invariant function threw: ${(err as Error).message}`,
        observed: { error: (err as Error).message, stack: (err as Error).stack?.slice(0, 500) },
        expected: { rule: 'invariant function returns Violation | null without throwing' },
        pauseScope: 'none',
        detectedAt: new Date().toISOString(),
      });
    }
  }

  // Update per-invariant counters
  for (const v of violations) {
    _state.stats.perInvariantViolations[v.invariantId] =
      (_state.stats.perInvariantViolations[v.invariantId] ?? 0) + 1;
  }
  _state.stats.totalViolations += violations.length;
  _state.stats.cyclesRun += 1;

  // Derive new blocker
  const newBlocker = deriveBlocker(violations, _state.currentBlocker);

  // If no SEVEREs this cycle, clear the existing blocker (only if it
  // was scoped to the invariants we just re-evaluated cleanly — which is
  // all of them in Phase A).
  if (newBlocker) {
    _state.currentBlocker = newBlocker;
  } else if (_state.currentBlocker && _state.currentBlocker.active) {
    console.log(`[SystemAudit] blocker auto-cleared (${_state.currentBlocker.invariantId} no longer violating)`);
    _state.currentBlocker = null;
  }

  const report: AuditReport = {
    cycle: deps.cycle,
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    violations,
    blockerActive: !!_state.currentBlocker?.active,
    alertMode: mode,
  };

  _state.lastReport = report;

  // Emit the one-line status that proves the auditor ran this cycle.
  // Per spec §3.9 (INV-9 auditor self-test): silence is itself detectable.
  const severeCount = violations.filter(v => v.severity === 'SEVERE').length;
  const warnCount = violations.filter(v => v.severity === 'WARN').length;
  const status = severeCount > 0 ? `severe=${severeCount}` : warnCount > 0 ? `warn=${warnCount}` : 'ok';
  console.log(`[SystemAudit] cycle=${deps.cycle} ${status} mode=${mode} blocker=${report.blockerActive ? 'ACTIVE' : 'none'} dur=${report.durationMs}ms`);

  // Detailed log lines for each violation (always — log mode never suppresses these)
  for (const v of violations) {
    console.warn(`[SystemAudit] ${v.severity} ${v.invariantId} (${v.invariantName}): ${v.message}`);
  }

  // Telegram alert path (gated by mode)
  await maybeAlert(violations, mode, deps.cycle);

  persist();
  return report;
}

// ============================================================================
// TEST HOOKS — only intended for vitest suites
// ============================================================================

export const _internals = {
  reset(): void {
    _state = {
      version: 1,
      startedAt: new Date().toISOString(),
      lastReport: null,
      currentBlocker: null,
      capturedPrompt: null,
      stats: {
        cyclesRun: 0,
        cyclesSkipped: 0,
        totalViolations: 0,
        perInvariantViolations: {},
        lastFlipFromLogOnly: null,
        capturedPromptCount: 0,
      },
    };
    _telegramSend = null;
    _filesClient = null;
    _filesUnavailableWarned = false;
    _cyclesSinceFilesPersist = 0;
    _filesHydrationAttempted = false;
  },
  setStateForTest(s: Partial<PersistedAuditorState>): void {
    _state = { ..._state, ...s };
  },
  getStateForTest(): PersistedAuditorState {
    return _state;
  },
  /**
   * Install a pre-adapted FilesApiClient for tests — skips
   * `adaptAnthropicClient` and the boot-time hydrate kick. Tests can then
   * call `hydrateFromFilesApiForTest` explicitly when they want to
   * exercise the hydration path.
   */
  setFilesClientForTest(client: FilesApiClient | null): void {
    _filesClient = client;
  },
  /** Reset the hydration latch so tests can re-trigger it. */
  resetHydrationLatchForTest(): void {
    _filesHydrationAttempted = false;
  },
  /** Run the hydration coroutine and await it (test-only convenience). */
  async hydrateFromFilesApiForTest(): Promise<void> {
    await hydrateFromFilesApi();
  },
  /** Count of cycles since the most recent successful Files-API write. */
  getCyclesSinceFilesPersistForTest(): number {
    return _cyclesSinceFilesPersist;
  },
  invariants: ALL_INVARIANTS,
  phaseAInvariants: PHASE_A_INVARIANTS,
  phaseBInvariants: PHASE_B_INVARIANTS,
  REPORT_FILE,
  LOG_ONLY_AUTO_FLIP_MS,
};
