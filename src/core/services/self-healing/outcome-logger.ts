/**
 * NVR Capital — Self-Healing Intelligence: Outcome Logger
 *
 * Persists the full lifecycle of every healing attempt so the system can
 * learn over time: which actions work, which incident types recur, and how
 * long resolution takes. Outcomes are held in a memory ring buffer (max 500)
 * and flushed to disk in a debounced batch to avoid hammering the FS on
 * rapid-fire incidents.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type {
  HealingOutcome,
  HealingStats,
  IncidentType,
  PlaybookAction,
} from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Maximum outcomes kept in memory. Oldest are evicted when full. */
const MAX_OUTCOMES = 500;

/** Debounce delay for disk writes — batches rapid `log()` calls. */
const FLUSH_DEBOUNCE_MS = 5_000;

// ---------------------------------------------------------------------------
// OutcomeLogger
// ---------------------------------------------------------------------------

export class OutcomeLogger {
  private readonly filePath: string;

  /** In-memory ring buffer of outcomes. */
  private outcomes: HealingOutcome[] = [];

  /** Pending debounce timer handle. */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(persistDir: string) {
    this.filePath = path.join(persistDir, 'healing-outcomes.json');
  }

  // -------------------------------------------------------------------------
  // Core write / read
  // -------------------------------------------------------------------------

  /**
   * Append a completed healing outcome to memory and schedule a debounced
   * disk flush (5 s). Multiple rapid calls will coalesce into one write.
   */
  log(outcome: HealingOutcome): void {
    // Evict oldest when at capacity
    if (this.outcomes.length >= MAX_OUTCOMES) {
      this.outcomes.shift();
    }
    this.outcomes.push(outcome);
    this._scheduleFlush();
  }

  /**
   * Return the most recent `n` outcomes, newest last.
   */
  getRecent(n: number): HealingOutcome[] {
    return this.outcomes.slice(-n);
  }

  /**
   * Return all outcomes whose incident matched the given type.
   */
  getByIncidentType(type: IncidentType): HealingOutcome[] {
    return this.outcomes.filter((o) => o.incident.type === type);
  }

  /**
   * Return the PlaybookActions that successfully resolved incidents of the
   * given type, ordered by success rate (highest first).
   *
   * An action "resolved" an incident if:
   *   - The outcome is marked resolved, AND
   *   - The action's own `success` flag is true.
   */
  getMostEffectiveActions(type: IncidentType): PlaybookAction[] {
    const relevant = this.getByIncidentType(type).filter((o) => o.resolved);

    // Accumulate attempts + successes per action
    const stats = new Map<PlaybookAction, { attempts: number; successes: number }>();

    for (const outcome of relevant) {
      for (const result of outcome.actionsExecuted) {
        const entry = stats.get(result.action) ?? { attempts: 0, successes: 0 };
        entry.attempts += 1;
        if (result.success) entry.successes += 1;
        stats.set(result.action, entry);
      }
    }

    // Sort by success rate descending; break ties by raw success count
    return Array.from(stats.entries())
      .sort(([, a], [, b]) => {
        const rateA = a.successes / a.attempts;
        const rateB = b.successes / b.attempts;
        if (rateB !== rateA) return rateB - rateA;
        return b.successes - a.successes;
      })
      .map(([action]) => action);
  }

  /**
   * Compute aggregate healing performance stats across all stored outcomes.
   */
  getStats(): HealingStats {
    const total = this.outcomes.length;
    const resolved = this.outcomes.filter((o) => o.resolved);
    const escalated = this.outcomes.filter((o) =>
      o.actionsExecuted.some((a) => a.action === 'ESCALATE_TO_HUMAN'),
    );

    // Average resolution duration (only resolved outcomes)
    const avgResolutionMs =
      resolved.length > 0
        ? resolved.reduce((sum, o) => sum + o.durationMs, 0) / resolved.length
        : 0;

    // Incidents by type
    const incidentsByType: Partial<Record<IncidentType, number>> = {};
    for (const o of this.outcomes) {
      incidentsByType[o.incident.type] =
        (incidentsByType[o.incident.type] ?? 0) + 1;
    }

    // Action success rates across all outcomes
    const actionSuccessRates: Partial<
      Record<PlaybookAction, { attempts: number; successes: number }>
    > = {};
    for (const o of this.outcomes) {
      for (const result of o.actionsExecuted) {
        const entry = actionSuccessRates[result.action] ?? { attempts: 0, successes: 0 };
        entry.attempts += 1;
        if (result.success) entry.successes += 1;
        actionSuccessRates[result.action] = entry;
      }
    }

    // Timestamps
    const timestamps = this.outcomes.map((o) => o.incident.timestamp).sort();
    const resolvedTimestamps = resolved
      .map((o) => o.resolvedAt)
      .filter((t): t is string => t !== null)
      .sort();

    return {
      totalIncidents:     total,
      resolvedIncidents:  resolved.length,
      escalatedIncidents: escalated.length,
      resolutionRate:     total > 0 ? resolved.length / total : 0,
      avgResolutionMs,
      incidentsByType,
      actionSuccessRates,
      lastIncidentAt:  timestamps.length > 0 ? timestamps[timestamps.length - 1]! : null,
      lastResolvedAt:  resolvedTimestamps.length > 0
        ? resolvedTimestamps[resolvedTimestamps.length - 1]!
        : null,
    };
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /**
   * Load outcomes from disk into the ring buffer.
   * Handles missing file and corrupt JSON gracefully — starts with an empty
   * buffer rather than crashing the bot on startup.
   */
  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Respect MAX_OUTCOMES — take the newest entries if the file is large
        this.outcomes = (parsed as HealingOutcome[]).slice(-MAX_OUTCOMES);
      }
    } catch (err: unknown) {
      const isNoEntry =
        typeof err === 'object' &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === 'ENOENT';

      if (!isNoEntry) {
        // Corrupt or unreadable — log and continue with empty buffer
        console.warn(
          '[OutcomeLogger] Could not load outcomes from disk, starting fresh:',
          (err as Error).message,
        );
      }
      // ENOENT is expected on first run — no warning needed
    }
  }

  /**
   * Write the current in-memory outcomes to disk.
   * Called automatically via debounce after `log()`, but can be called
   * manually for a guaranteed immediate write (e.g. on graceful shutdown).
   */
  async flush(): Promise<void> {
    // Cancel any pending debounce — this call is the flush
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    try {
      // Ensure the directory exists before writing
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(
        this.filePath,
        JSON.stringify(this.outcomes, null, 2),
        'utf-8',
      );
    } catch (err: unknown) {
      console.error(
        '[OutcomeLogger] Failed to flush outcomes to disk:',
        (err as Error).message,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Schedule a debounced flush — resets the timer if already pending. */
  private _scheduleFlush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch((err: unknown) => {
        console.error('[OutcomeLogger] Background flush error:', (err as Error).message);
      });
    }, FLUSH_DEBOUNCE_MS);
  }
}
