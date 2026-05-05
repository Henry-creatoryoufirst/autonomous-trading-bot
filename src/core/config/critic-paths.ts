/**
 * CRITIC data path resolution.
 *
 * Routes CRITIC artifact writes (nightly reports, rules-proposal.yaml,
 * critic-memory.md) to `$PERSIST_DIR/...` (Railway's mounted volume at
 * `/data`) when PERSIST_DIR is set, and gives readers a fallback chain:
 * persistent volume first, image-bundled `<cwd>/data` second. The bundled
 * path keeps git-committed seed reports readable until the next cron has
 * populated the volume — so the /api/critic-report-markdown endpoint never
 * goes blank right after a redeploy.
 *
 * Convention: matches the rest of the bot (trades-v3.4.json,
 * price-cache.json, trailing-stops.json) — files live directly under
 * PERSIST_DIR, not under a `data/` subdir. Local dev keeps the historical
 * `<cwd>/data/...` path so git-committed seed reports stay co-located.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const CWD_DATA = path.resolve(process.cwd(), 'data');
const PERSIST_ROOT = process.env.PERSIST_DIR ?? null;

/** Where CRITIC writes outputs. PERSIST volume preferred; cwd fallback for local dev. */
export function getCriticWriteDir(): string {
  return PERSIST_ROOT ?? CWD_DATA;
}

export function getCriticReportsWriteDir(): string {
  return path.join(getCriticWriteDir(), 'critic-reports');
}

export function getRulesProposalWritePath(): string {
  return path.join(getCriticWriteDir(), 'rules-proposal.yaml');
}

export function getCriticMemoryWritePath(): string {
  return path.join(getCriticWriteDir(), 'critic-memory.md');
}

function getCriticReadDirs(): string[] {
  const dirs: string[] = [];
  if (PERSIST_ROOT) dirs.push(PERSIST_ROOT);
  dirs.push(CWD_DATA);
  return dirs;
}

/**
 * Latest YYYY-MM-DD.md report across read directories (persistent first,
 * bundled fallback). Picks the lexicographically-newest filename, which
 * for ISO dates is also chronologically newest.
 */
export function findLatestCriticReport(): { fullPath: string; date: string } | null {
  let best: { fullPath: string; date: string } | null = null;
  for (const dir of getCriticReadDirs()) {
    try {
      const reportsDir = path.join(dir, 'critic-reports');
      if (!fs.existsSync(reportsDir)) continue;
      const files = fs.readdirSync(reportsDir)
        .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .sort();
      if (files.length === 0) continue;
      const latest = files[files.length - 1];
      const date = latest.replace('.md', '');
      if (!best || date > best.date) {
        best = { fullPath: path.join(reportsDir, latest), date };
      }
    } catch { /* skip unreadable dir */ }
  }
  return best;
}

export function findFreshestRulesProposal(): string | null {
  return findFreshestSingleFile('rules-proposal.yaml');
}

export function findFreshestCriticMemory(): string | null {
  return findFreshestSingleFile('critic-memory.md');
}

function findFreshestSingleFile(filename: string): string | null {
  let best: { path: string; mtime: number } | null = null;
  for (const dir of getCriticReadDirs()) {
    try {
      const p = path.join(dir, filename);
      if (!fs.existsSync(p)) continue;
      const mtime = fs.statSync(p).mtimeMs;
      if (!best || mtime > best.mtime) {
        best = { path: p, mtime };
      }
    } catch { /* skip */ }
  }
  return best?.path ?? null;
}
