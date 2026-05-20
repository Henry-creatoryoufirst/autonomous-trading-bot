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
import type { LiveOnChainSnapshot } from './sources/live-onchain.js';

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

let _state: PersistedAuditorState = loadPersisted() ?? {
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

function loadPersisted(): PersistedAuditorState | null {
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

function persist(): void {
  try {
    if (!fs.existsSync(PERSIST_DIR)) fs.mkdirSync(PERSIST_DIR, { recursive: true });
    const tmp = REPORT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(_state));
    fs.renameSync(tmp, REPORT_FILE);
  } catch (err: unknown) {
    console.warn(`  ⚠️ system-auditor: failed to persist report — ${(err as Error).message}`);
  }
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
  const severe = violations.filter(v => v.severity === 'SEVERE' && v.pauseScope !== 'none');
  if (severe.length === 0) {
    return null;
  }

  // Pick the most restrictive scope. Order: all-buys > per-token-buys > next-llm.
  const order: Record<PauseScope, number> = {
    'all-buys': 3,
    'per-token-buys': 2,
    'next-llm': 1,
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

    case 'none':
      return { allowed: true };
  }

  return { allowed: true };
}

export function getCurrentBlocker(): SystemHealthBlocker | null {
  return _state.currentBlocker;
}

export function getMonitorStats(): AuditorStats & { enabled: boolean; alertMode: AuditorMode } {
  return {
    enabled: isEnabled(),
    alertMode: effectiveAlertMode(),
    ...JSON.parse(JSON.stringify(_state.stats)),
  };
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
  };

  // Run every invariant; isolate failures so one buggy invariant doesn't
  // take the rest down. A thrown invariant is itself a SEVERE.
  const violations: Violation[] = [];
  for (const inv of PHASE_A_INVARIANTS) {
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
  },
  setStateForTest(s: Partial<PersistedAuditorState>): void {
    _state = { ..._state, ...s };
  },
  getStateForTest(): PersistedAuditorState {
    return _state;
  },
  invariants: PHASE_A_INVARIANTS,
  REPORT_FILE,
  LOG_ONLY_AUTO_FLIP_MS,
};
