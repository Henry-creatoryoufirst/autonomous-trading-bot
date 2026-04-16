/**
 * Migration v21.18 — Ground-Truth Cost Basis Rebuild
 *
 * What it does:
 *   Rebuilds state.costBasis from scratch using the trade log (optionally
 *   reconciled against on-chain transfers from the indexer). Unlike the
 *   legacy `rebuildCostBasisFromTrades`, this does NOT preserve phantom
 *   realizedPnL — it replaces corrupted values with honest ones.
 *
 * Why:
 *   Cumulative cost basis has drifted over months. TOSHI alone reports
 *   -$1,394,405 realized P&L on a $3k portfolio. Diagnostic rebuild
 *   shows the real all-time realizedPnL is +$629, not -$1.4M.
 *
 * Safety:
 *   1. Always writes a timestamped backup of state.costBasis to disk before
 *      mutating anything, so we can roll back without redeploying.
 *   2. Runs once per state — marked by `_migrationGroundTruthRebuildV2118`.
 *   3. Has a DRY-RUN mode (env flag MIGRATION_V2118_DRY_RUN=true) that logs
 *      the full diff without writing. Use this to preview before committing.
 *   4. Emits a structured summary for Telegram / the dashboard to consume.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  rebuildFromGroundTruth,
  diffAgainstExisting,
  applyRebuiltCostBasis,
  type OnChainTransfer,
  type RebuildDiff,
  type RebuildResult,
} from './rebuild.js';
import type { TokenCostBasis, TradeRecord } from '../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MigrationV2118Inputs {
  /** Agent state — we write `_migrationGroundTruthRebuildV2118` flag here and
   *  mutate `state.costBasis` if not in dry-run mode. Typed loosely since
   *  AgentState is big and we only care about two fields. */
  state: {
    costBasis: Record<string, TokenCostBasis>;
    [key: string]: unknown;
  };
  /** Trade log from the state file */
  trades: TradeRecord[];
  /** Optional on-chain transfers (populated once feat/onchain-indexer lands) */
  transfers?: OnChainTransfer[];
  /** Optional on-chain balance snapshot (used for currentHolding) */
  onchainBalances?: Record<string, number>;
  /** If true, produce the diff but don't mutate state. Default: false. */
  dryRun?: boolean;
  /** Directory where the backup file is written. Default: same dir as the log file. */
  backupDir?: string;
  /** Override the current timestamp (tests use this). */
  now?: () => Date;
}

export interface MigrationV2118Result {
  /** Did the migration actually run? False if already completed or dry-run. */
  applied: boolean;
  /** Was this a dry-run preview? */
  dryRun: boolean;
  /** Was this a no-op because the flag was already set? */
  alreadyCompleted: boolean;
  /** Path to the state backup file (only set if applied=true) */
  backupPath: string | null;
  /** Structured per-token diff — biggest corrections first */
  diffs: RebuildDiff[];
  /** Summary totals */
  summary: {
    tradesReplayed: number;
    tradesSkipped: number;
    transfersProcessed: number;
    unmatchedTransfers: number;
    symbolsTouched: number;
    phantomPnLRemoved: number;
    realizedPnLBefore: number;
    realizedPnLAfter: number;
  };
  /** The underlying rebuild (exposed for tests / debugging) */
  rebuild: RebuildResult;
}

// ---------------------------------------------------------------------------
// Migration flag + constants
// ---------------------------------------------------------------------------

export const MIGRATION_FLAG_KEY = '_migrationGroundTruthRebuildV2118';
export const MIGRATION_VERSION = 'v21.18';
export const BACKUP_FILENAME_PREFIX = 'cost-basis-backup-pre-v2118';

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Execute the v21.18 migration against the provided state + trade log.
 *
 * Behavior matrix:
 *   flag unset, dryRun=false → backup + rebuild + apply + set flag
 *   flag unset, dryRun=true  → rebuild + diff (no backup, no write, no flag)
 *   flag set,   dryRun=*     → no-op, returns alreadyCompleted=true
 */
export function runMigrationV2118(
  inputs: MigrationV2118Inputs,
): MigrationV2118Result {
  const {
    state,
    trades,
    transfers,
    onchainBalances,
    dryRun = false,
    backupDir,
  } = inputs;

  const alreadyCompleted = Boolean(
    (state as Record<string, unknown>)[MIGRATION_FLAG_KEY],
  );

  // --- Always compute the rebuild + diff so we can report either way
  const rebuild = rebuildFromGroundTruth({
    trades,
    transfers,
    onchainBalances,
  });
  const diffs = diffAgainstExisting(rebuild, state.costBasis);

  const summary = summarize(rebuild, diffs, state.costBasis);

  if (alreadyCompleted) {
    return {
      applied: false,
      dryRun,
      alreadyCompleted: true,
      backupPath: null,
      diffs,
      summary,
      rebuild,
    };
  }

  if (dryRun) {
    return {
      applied: false,
      dryRun: true,
      alreadyCompleted: false,
      backupPath: null,
      diffs,
      summary,
      rebuild,
    };
  }

  // --- Mutate: back up first, then apply, then set flag
  const now = inputs.now?.() ?? new Date();
  const backupPath = writeBackup(state.costBasis, now, backupDir);
  applyRebuiltCostBasis(rebuild, state.costBasis, onchainBalances);
  (state as Record<string, unknown>)[MIGRATION_FLAG_KEY] = true;

  return {
    applied: true,
    dryRun: false,
    alreadyCompleted: false,
    backupPath,
    diffs,
    summary,
    rebuild,
  };
}

// ---------------------------------------------------------------------------
// Convenience wrapper that agent-v3.2.ts can call in one line
// ---------------------------------------------------------------------------

export interface RunInMonolithArgs {
  /** The agent's state object (typed loosely — AgentState is huge). */
  state: {
    costBasis: Record<string, TokenCostBasis>;
    [key: string]: unknown;
  };
  /** The trades array already loaded from the state file. */
  trades: TradeRecord[];
  /** Called after the migration if something was actually written. */
  onWrite?: () => void;
  /** Optional logger, defaults to console. */
  log?: (msg: string) => void;
  /** Path hint for backup directory. Defaults to process.env.PERSIST_DIR or ./logs. */
  backupDir?: string;
}

/**
 * Wrapper designed to slot into agent-v3.2.ts's migration block cleanly.
 * Reads env flags, calls the migration, logs results, calls onWrite to
 * persist state via the bot's existing saveTradeHistory().
 */
export function runMigrationV2118InMonolith(args: RunInMonolithArgs): void {
  const log = args.log ?? ((m: string) => console.log(m));
  const dryRun = process.env.MIGRATION_V2118_DRY_RUN === 'true';
  const disabled = process.env.MIGRATION_V2118_DISABLED === 'true';

  if (disabled) {
    log(`⏭️  MIGRATION ${MIGRATION_VERSION}: disabled via MIGRATION_V2118_DISABLED=true`);
    return;
  }

  const result = runMigrationV2118({
    state: args.state,
    trades: args.trades,
    dryRun,
    backupDir: args.backupDir,
  });

  if (result.alreadyCompleted) {
    log(`⏭️  MIGRATION ${MIGRATION_VERSION}: already completed (flag set) — skipping`);
    return;
  }

  const header = result.dryRun
    ? `\n🔍 MIGRATION ${MIGRATION_VERSION} — DRY RUN (MIGRATION_V2118_DRY_RUN=true)`
    : `\n🔧 MIGRATION ${MIGRATION_VERSION} — Ground-truth cost basis rebuild`;
  log(header);
  log(`   Trades replayed:     ${result.summary.tradesReplayed}`);
  log(`   Trades skipped:      ${result.summary.tradesSkipped}`);
  log(`   Symbols touched:     ${result.summary.symbolsTouched}`);
  log(`   Realized P&L before: $${result.summary.realizedPnLBefore.toFixed(2)}`);
  log(`   Realized P&L after:  $${result.summary.realizedPnLAfter.toFixed(2)}`);
  log(`   Phantom P&L removed: $${result.summary.phantomPnLRemoved.toFixed(2)}`);
  if (result.backupPath) {
    log(`   Backup written:      ${result.backupPath}`);
  }

  // Log the top 5 corrections so we can audit from Railway logs
  const top = result.diffs.slice(0, 5);
  if (top.length > 0) {
    log('   Top corrections:');
    for (const d of top) {
      log(
        `     ${d.symbol.padEnd(8)} realizedPnL $${d.before.realizedPnL.toFixed(2).padStart(14)} → $${d.after.realizedPnL.toFixed(2).padStart(10)} (Δ ${d.delta.realizedPnL >= 0 ? '+' : ''}${d.delta.realizedPnL.toFixed(2)})`,
      );
    }
  }

  if (result.applied) {
    log(`✅ MIGRATION ${MIGRATION_VERSION} complete.\n`);
    args.onWrite?.();
  } else if (result.dryRun) {
    log(`✅ DRY RUN complete — no changes written. Re-run without MIGRATION_V2118_DRY_RUN to apply.\n`);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function summarize(
  rebuild: RebuildResult,
  diffs: RebuildDiff[],
  existing: Record<string, TokenCostBasis>,
): MigrationV2118Result['summary'] {
  const realizedPnLBefore = Object.values(existing).reduce(
    (sum, cb) => sum + (cb?.realizedPnL ?? 0),
    0,
  );
  const realizedPnLAfter = rebuild.totals.totalRealizedPnL;
  return {
    tradesReplayed: rebuild.totals.tradesReplayed,
    tradesSkipped: rebuild.totals.tradesSkipped,
    transfersProcessed: rebuild.totals.transfersProcessed,
    unmatchedTransfers: rebuild.totals.unmatchedTransfers,
    symbolsTouched: diffs.filter((d) => d.delta.realizedPnL !== 0 || d.delta.averageCostBasis !== 0).length,
    phantomPnLRemoved: realizedPnLAfter - realizedPnLBefore,
    realizedPnLBefore,
    realizedPnLAfter,
  };
}

function writeBackup(
  costBasis: Record<string, TokenCostBasis>,
  now: Date,
  backupDir?: string,
): string {
  const dir = backupDir
    ?? process.env.PERSIST_DIR
    ?? './logs';
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* directory may already exist */
  }
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const filename = `${BACKUP_FILENAME_PREFIX}-${stamp}.json`;
  const fullPath = path.join(dir, filename);
  const snapshot = {
    version: MIGRATION_VERSION,
    timestamp: now.toISOString(),
    reason:
      'Full snapshot of state.costBasis taken immediately before the v21.18 ground-truth rebuild. Restore by copying the `costBasis` object back into state and unsetting _migrationGroundTruthRebuildV2118.',
    costBasis,
  };
  fs.writeFileSync(fullPath, JSON.stringify(snapshot, null, 2));
  return fullPath;
}
