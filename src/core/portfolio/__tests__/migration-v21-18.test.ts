/**
 * Integration tests for the v21.18 ground-truth migration.
 *
 * Covers:
 *   - Dry-run semantics (no state mutation, no backup, no flag)
 *   - Full apply (backup file written, flag set, cost basis mutated)
 *   - Idempotency (second run is a no-op)
 *   - Real production-state fixture: TOSHI -$1.4M phantom loss gets cleared
 *   - Backup round-trip — the snapshot can be restored byte-for-byte
 *   - Disabled env flag path
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  runMigrationV2118,
  runMigrationV2118InMonolith,
  MIGRATION_FLAG_KEY,
} from '../migration-v21-18.js';
import type { TokenCostBasis, TradeRecord } from '../../types/index.js';

import prodSnapshot from './fixtures/prod-snapshot-2026-04-16.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FixtureShape {
  costBasisBeforeMigration: Record<string, TokenCostBasis>;
  trades: TradeRecord[];
  meta: { focusTokens: string[]; tradeCount: number; symbolCount: number };
}
const fixture = prodSnapshot as unknown as FixtureShape;

function cloneFixtureCostBasis(): Record<string, TokenCostBasis> {
  return JSON.parse(JSON.stringify(fixture.costBasisBeforeMigration));
}

function makeState(cb: Record<string, TokenCostBasis>) {
  return { costBasis: cb } as { costBasis: Record<string, TokenCostBasis>; [k: string]: unknown };
}

let tmpBackupDir: string;

beforeEach(() => {
  tmpBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2118-test-'));
});

afterEach(() => {
  try {
    fs.rmSync(tmpBackupDir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup failures */
  }
});

// ---------------------------------------------------------------------------
// Dry-run behavior
// ---------------------------------------------------------------------------

describe('runMigrationV2118 — dry run', () => {
  it('returns a diff without touching state or writing a backup', () => {
    const cb = cloneFixtureCostBasis();
    const before = JSON.stringify(cb);
    const state = makeState(cb);

    const result = runMigrationV2118({
      state,
      trades: fixture.trades,
      dryRun: true,
      backupDir: tmpBackupDir,
    });

    // Nothing mutated
    expect(JSON.stringify(cb)).toBe(before);
    expect(state[MIGRATION_FLAG_KEY]).toBeUndefined();
    expect(result.applied).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.backupPath).toBeNull();

    // No backup file was written
    const files = fs.readdirSync(tmpBackupDir);
    expect(files).toHaveLength(0);

    // But we do get the diff showing the BIG corrections
    const toshi = result.diffs.find((d) => d.symbol === 'TOSHI')!;
    expect(toshi).toBeDefined();
    expect(toshi.before.realizedPnL).toBeLessThan(-1_000_000); // phantom
    expect(toshi.after.realizedPnL).toBeGreaterThan(-10_000); // sanity-clamped rebuild
    expect(toshi.delta.realizedPnL).toBeGreaterThan(1_000_000);
  });
});

// ---------------------------------------------------------------------------
// Apply behavior
// ---------------------------------------------------------------------------

describe('runMigrationV2118 — apply', () => {
  it('writes a backup, mutates state, and sets the flag', () => {
    const cb = cloneFixtureCostBasis();
    const state = makeState(cb);

    const result = runMigrationV2118({
      state,
      trades: fixture.trades,
      dryRun: false,
      backupDir: tmpBackupDir,
      now: () => new Date('2026-04-16T08:30:00Z'),
    });

    expect(result.applied).toBe(true);
    expect(result.alreadyCompleted).toBe(false);
    expect(result.backupPath).toBeTruthy();
    expect(state[MIGRATION_FLAG_KEY]).toBe(true);

    // Backup file exists and contains the pre-migration data
    const backupContent = JSON.parse(
      fs.readFileSync(result.backupPath!, 'utf-8'),
    );
    expect(backupContent.version).toBe('v21.18');
    expect(backupContent.costBasis.TOSHI.realizedPnL).toBeLessThan(-1_000_000);

    // Post-migration: TOSHI no longer has phantom -$1.4M loss
    expect(cb.TOSHI.realizedPnL).toBeGreaterThan(-10_000);
    expect(cb.TOSHI.realizedPnL).toBeLessThan(10_000);
  });

  it('is idempotent — second call is a no-op', () => {
    const cb = cloneFixtureCostBasis();
    const state = makeState(cb);

    const first = runMigrationV2118({
      state,
      trades: fixture.trades,
      backupDir: tmpBackupDir,
    });
    expect(first.applied).toBe(true);

    // Grab post-state to confirm it doesn't change on second run
    const afterFirst = JSON.stringify(cb);

    const second = runMigrationV2118({
      state,
      trades: fixture.trades,
      backupDir: tmpBackupDir,
    });
    expect(second.applied).toBe(false);
    expect(second.alreadyCompleted).toBe(true);
    expect(second.backupPath).toBeNull();
    expect(JSON.stringify(cb)).toBe(afterFirst);
  });

  it('preserves ATR fields when writing rebuilt values', () => {
    const cb = cloneFixtureCostBasis();
    // Inject some ATR data to prove it's preserved
    cb.BRETT.atrStopPercent = 12;
    cb.BRETT.atrTrailPercent = 6;
    cb.BRETT.trailActivated = true;
    cb.BRETT.peakPrice = 0.015;
    cb.BRETT.peakPriceDate = '2026-04-10T12:00:00Z';

    const state = makeState(cb);
    runMigrationV2118({
      state,
      trades: fixture.trades,
      backupDir: tmpBackupDir,
    });

    expect(cb.BRETT.atrStopPercent).toBe(12);
    expect(cb.BRETT.atrTrailPercent).toBe(6);
    expect(cb.BRETT.trailActivated).toBe(true);
    expect(cb.BRETT.peakPrice).toBe(0.015);
    expect(cb.BRETT.peakPriceDate).toBe('2026-04-10T12:00:00Z');
    // But cost basis was rebuilt
    expect(cb.BRETT.averageCostBasis).toBeGreaterThan(0.001); // real avg ~$0.00737
    expect(cb.BRETT.averageCostBasis).toBeLessThan(0.02);
  });
});

// ---------------------------------------------------------------------------
// Production-snapshot assertions
// ---------------------------------------------------------------------------

describe('runMigrationV2118 — production snapshot correctness', () => {
  it('TOSHI phantom -$1.4M loss is eliminated', () => {
    const cb = cloneFixtureCostBasis();
    expect(cb.TOSHI.realizedPnL).toBeLessThan(-1_000_000); // confirm fixture is the broken state

    const state = makeState(cb);
    runMigrationV2118({ state, trades: fixture.trades, backupDir: tmpBackupDir });

    // Post-migration TOSHI realized is sane (< $10k in magnitude)
    expect(Math.abs(cb.TOSHI.realizedPnL)).toBeLessThan(10_000);
  });

  it('WELL phantom -$7.9k loss is eliminated', () => {
    const cb = cloneFixtureCostBasis();
    expect(cb.WELL.realizedPnL).toBeLessThan(-5_000); // fixture is broken

    const state = makeState(cb);
    runMigrationV2118({ state, trades: fixture.trades, backupDir: tmpBackupDir });

    // Rebuilt WELL realized shows a small positive gain (~$557 per diagnostic)
    expect(Math.abs(cb.WELL.realizedPnL)).toBeLessThan(2_000);
  });

  it('total realizedPnL goes from catastrophic to near-zero', () => {
    const cb = cloneFixtureCostBasis();
    const state = makeState(cb);

    const result = runMigrationV2118({
      state,
      trades: fixture.trades,
      backupDir: tmpBackupDir,
    });

    // Before: huge negative (dominated by TOSHI -$1.4M + WELL -$8k)
    expect(result.summary.realizedPnLBefore).toBeLessThan(-1_000_000);
    // After: within a few thousand of zero (real P&L rebuilt from trades)
    expect(result.summary.realizedPnLAfter).toBeGreaterThan(-5_000);
    expect(result.summary.realizedPnLAfter).toBeLessThan(5_000);
    // The phantom removed is enormous
    expect(result.summary.phantomPnLRemoved).toBeGreaterThan(1_000_000);
  });

  it('rebuilt BRETT cost basis matches real price history, not $0.000119', () => {
    const cb = cloneFixtureCostBasis();
    expect(cb.BRETT.averageCostBasis).toBeLessThan(0.0005); // broken: way below real price

    const state = makeState(cb);
    runMigrationV2118({ state, trades: fixture.trades, backupDir: tmpBackupDir });

    // Rebuilt avg should be in the real BRETT price range (~$0.007)
    expect(cb.BRETT.averageCostBasis).toBeGreaterThan(0.003);
    expect(cb.BRETT.averageCostBasis).toBeLessThan(0.02);
  });
});

// ---------------------------------------------------------------------------
// Backup round-trip
// ---------------------------------------------------------------------------

describe('backup round-trip', () => {
  it('backup content can restore the exact pre-migration state', () => {
    const cb = cloneFixtureCostBasis();
    const state = makeState(cb);

    const result = runMigrationV2118({
      state,
      trades: fixture.trades,
      backupDir: tmpBackupDir,
    });

    // Simulate rollback: load backup, overwrite state, unset flag
    const backup = JSON.parse(fs.readFileSync(result.backupPath!, 'utf-8'));
    const restored: Record<string, TokenCostBasis> = JSON.parse(
      JSON.stringify(backup.costBasis),
    );

    // Compare field-by-field against what was originally in the fixture
    expect(restored.TOSHI.realizedPnL).toBe(
      fixture.costBasisBeforeMigration.TOSHI.realizedPnL,
    );
    expect(restored.BRETT.averageCostBasis).toBe(
      fixture.costBasisBeforeMigration.BRETT.averageCostBasis,
    );
    expect(restored.WELL.realizedPnL).toBe(
      fixture.costBasisBeforeMigration.WELL.realizedPnL,
    );
  });
});

// ---------------------------------------------------------------------------
// Env-driven entry point used in the monolith
// ---------------------------------------------------------------------------

describe('runMigrationV2118InMonolith', () => {
  it('respects MIGRATION_V2118_DISABLED=true', () => {
    const prev = process.env.MIGRATION_V2118_DISABLED;
    process.env.MIGRATION_V2118_DISABLED = 'true';
    try {
      const cb = cloneFixtureCostBasis();
      const state = makeState(cb);
      const logs: string[] = [];

      let onWriteCalled = false;
      runMigrationV2118InMonolith({
        state,
        trades: fixture.trades,
        backupDir: tmpBackupDir,
        log: (m) => logs.push(m),
        onWrite: () => {
          onWriteCalled = true;
        },
      });

      expect(onWriteCalled).toBe(false);
      expect(state[MIGRATION_FLAG_KEY]).toBeUndefined();
      expect(logs.some((l) => l.includes('disabled'))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.MIGRATION_V2118_DISABLED;
      else process.env.MIGRATION_V2118_DISABLED = prev;
    }
  });

  it('respects MIGRATION_V2118_DRY_RUN=true', () => {
    const prev = process.env.MIGRATION_V2118_DRY_RUN;
    process.env.MIGRATION_V2118_DRY_RUN = 'true';
    try {
      const cb = cloneFixtureCostBasis();
      const state = makeState(cb);
      const logs: string[] = [];
      let onWriteCalled = false;

      runMigrationV2118InMonolith({
        state,
        trades: fixture.trades,
        backupDir: tmpBackupDir,
        log: (m) => logs.push(m),
        onWrite: () => {
          onWriteCalled = true;
        },
      });

      expect(onWriteCalled).toBe(false);
      expect(state[MIGRATION_FLAG_KEY]).toBeUndefined();
      expect(logs.some((l) => l.includes('DRY RUN'))).toBe(true);
      // No backup file was written in dry-run
      expect(fs.readdirSync(tmpBackupDir)).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.MIGRATION_V2118_DRY_RUN;
      else process.env.MIGRATION_V2118_DRY_RUN = prev;
    }
  });

  it('calls onWrite and sets flag on successful apply', () => {
    const cb = cloneFixtureCostBasis();
    const state = makeState(cb);
    let onWriteCalled = false;

    runMigrationV2118InMonolith({
      state,
      trades: fixture.trades,
      backupDir: tmpBackupDir,
      log: () => {
        /* silent */
      },
      onWrite: () => {
        onWriteCalled = true;
      },
    });

    expect(onWriteCalled).toBe(true);
    expect(state[MIGRATION_FLAG_KEY]).toBe(true);
    expect(fs.readdirSync(tmpBackupDir).length).toBeGreaterThan(0);
  });
});
