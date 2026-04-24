/**
 * CRITIC Memory loader — reads the prompt-ready summary CRITIC writes at
 * `data/critic-memory.md` and exposes it as a block for cycle prompts.
 *
 * v21.24: first piece of the CRITIC → decision-maker feedback loop. Instead
 * of adding more deterministic rules, we feed the LLM its own recent pattern
 * outcomes so it reasons over them when deciding the current cycle.
 *
 * Behavior:
 *   - File missing → return null (no injection, safe default)
 *   - File older than MEMORY_MAX_AGE_HOURS (default 72h) → return null
 *     (stale memory is worse than no memory — don't mislead the LLM)
 *   - File present + fresh → return its contents, cached with a short TTL
 *   - Env `CRITIC_MEMORY_ENABLED=false` → hard disable
 *
 * Cache TTL is deliberately short (5 min) so nightly CRITIC runs surface
 * quickly without requiring a bot restart.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const MEMORY_PATH = path.resolve(process.cwd(), 'data', 'critic-memory.md');

/** Cache TTL — how long we hold a loaded memory in process memory before re-reading. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** If the file on disk is older than this, treat it as stale and don't inject. */
const DEFAULT_MEMORY_MAX_AGE_HOURS = 72;

interface CachedMemory {
  loadedAt: number;
  content: string | null;
  fileMtime: number;
}

let cache: CachedMemory | null = null;

/**
 * Check if CRITIC memory injection is enabled. Default: on when the file exists.
 * Set CRITIC_MEMORY_ENABLED=false to hard-disable without redeploy.
 */
export function isCriticMemoryEnabled(): boolean {
  const flag = (process.env.CRITIC_MEMORY_ENABLED ?? '').toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'disabled') return false;
  return true;
}

function getMaxAgeHours(): number {
  const v = Number(process.env.CRITIC_MEMORY_MAX_AGE_HOURS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MEMORY_MAX_AGE_HOURS;
}

/**
 * Load the current CRITIC memory block, honoring staleness + env kill switch.
 * Returns null when disabled, missing, or stale — callers should handle null
 * as "no memory to inject."
 */
export function loadCriticMemory(): string | null {
  if (!isCriticMemoryEnabled()) return null;

  const now = Date.now();

  // Fast path: return cached content if within TTL
  if (cache && (now - cache.loadedAt) < CACHE_TTL_MS) {
    return cache.content;
  }

  // Re-read the file
  try {
    const stat = fs.statSync(MEMORY_PATH);
    const fileAgeHours = (now - stat.mtimeMs) / (60 * 60 * 1000);

    if (fileAgeHours > getMaxAgeHours()) {
      console.warn(
        `[CriticMemory] File at ${MEMORY_PATH} is ${fileAgeHours.toFixed(1)}h old (max ${getMaxAgeHours()}h). Stale — not injecting.`,
      );
      cache = { loadedAt: now, content: null, fileMtime: stat.mtimeMs };
      return null;
    }

    const content = fs.readFileSync(MEMORY_PATH, 'utf8');
    if (!content.trim()) {
      cache = { loadedAt: now, content: null, fileMtime: stat.mtimeMs };
      return null;
    }

    // Fresh load or file changed
    if (!cache || cache.fileMtime !== stat.mtimeMs) {
      console.log(
        `[CriticMemory] Loaded ${content.length} chars (file age ${fileAgeHours.toFixed(1)}h).`,
      );
    }
    cache = { loadedAt: now, content, fileMtime: stat.mtimeMs };
    return content;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      console.warn(`[CriticMemory] read error (${code}):`, (err as Error).message);
    }
    cache = { loadedAt: now, content: null, fileMtime: 0 };
    return null;
  }
}

/**
 * Force-clear the cache — use after CRITIC runs inside the bot process so
 * the next cycle reads fresh memory without waiting for TTL.
 */
export function invalidateCriticMemoryCache(): void {
  cache = null;
}
