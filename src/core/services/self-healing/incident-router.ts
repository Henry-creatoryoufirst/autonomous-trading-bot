/**
 * NVR Capital — Self-Healing Intelligence: Incident Router
 *
 * Converts raw signals from the trading engine into structured Incidents,
 * deduplicates noisy repeated reports, and holds a queue for the orchestrator
 * to drain each cycle. A ring buffer provides a short-term history window
 * for pattern queries (e.g. "how many TRADE_FAILUREs in the last 5 minutes?").
 */

import type {
  Incident,
  IncidentType,
  IncidentSeverity,
} from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Within this window, identical incident types are collapsed to one. */
const DEDUP_WINDOW_MS = 120_000; // 2 minutes

/** These types are never deduplicated — every occurrence is a distinct incident. */
const NO_DEDUP_TYPES: IncidentType[] = ['CIRCUIT_BREAKER', 'LARGE_DRAWDOWN'];

/** Default severity for each incident type. */
const SEVERITY_MAP: Record<IncidentType, IncidentSeverity> = {
  LARGE_DRAWDOWN:       'CRITICAL',
  CIRCUIT_BREAKER:      'CRITICAL',
  STUCK_CYCLE:          'HIGH',
  BALANCE_ANOMALY:      'HIGH',
  CONSECUTIVE_FAILURES: 'HIGH',
  TRADE_FAILURE:        'MEDIUM',
  PRICE_FEED_FAILURE:   'MEDIUM',
  API_TIMEOUT:          'LOW',
};

/** Maximum number of incidents held in the ring buffer. */
const RING_BUFFER_MAX = 100;

// ---------------------------------------------------------------------------
// IncidentRouter
// ---------------------------------------------------------------------------

export class IncidentRouter {
  /** Pending incidents waiting to be drained by the orchestrator. */
  private queue: Incident[] = [];

  /**
   * Circular history buffer — oldest entries are evicted when the buffer is
   * full. Used for pattern queries without polluting the drainable queue.
   */
  private ringBuffer: Incident[] = [];

  /**
   * Tracks the last time each incident type was created (for dedup checks).
   * Keyed by IncidentType; value is the timestamp of the last created incident.
   */
  private lastSeenAt: Map<IncidentType, number> = new Map();

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Report a new incident.
   *
   * If the type was already reported within DEDUP_WINDOW_MS and is not in
   * NO_DEDUP_TYPES, returns null (silently dropped — the existing incident
   * still covers it).
   *
   * Otherwise creates a structured Incident, adds it to both the queue and
   * the ring buffer, and returns it.
   */
  report(
    type: IncidentType,
    context: Record<string, unknown>,
    cycleNumber: number,
    portfolioValue: number,
  ): Incident | null {
    const now = Date.now();

    // Dedup check — skip for always-unique types
    if (!NO_DEDUP_TYPES.includes(type)) {
      const lastSeen = this.lastSeenAt.get(type);
      if (lastSeen !== undefined && now - lastSeen < DEDUP_WINDOW_MS) {
        return null; // absorbed into the existing incident
      }
    }

    const incident: Incident = {
      id:             `${type}_${now}`,
      type,
      severity:       SEVERITY_MAP[type],
      timestamp:      new Date(now).toISOString(),
      context,
      cycleNumber,
      portfolioValue,
      resolved:       false,
    };

    // Track last-seen for dedup (even for NO_DEDUP_TYPES — useful for queries)
    this.lastSeenAt.set(type, now);

    this.queue.push(incident);
    this._addToRingBuffer(incident);

    return incident;
  }

  /**
   * Returns all queued incidents and clears the queue.
   * Called once per orchestrator cycle.
   */
  drain(): Incident[] {
    const items = this.queue.slice();
    this.queue = [];
    return items;
  }

  /**
   * Returns all queued incidents without clearing them.
   * Useful for inspection / logging without consuming.
   */
  peek(): Incident[] {
    return this.queue.slice();
  }

  /**
   * Searches the ring buffer for incidents of a given type within a recent
   * time window. Useful for pattern detection (e.g. "is this the 3rd
   * TRADE_FAILURE in 10 minutes?").
   *
   * @param type       - The incident type to filter on.
   * @param withinMs   - How far back to look (milliseconds from now).
   */
  getRecentByType(type: IncidentType, withinMs: number): Incident[] {
    const cutoff = Date.now() - withinMs;
    return this.ringBuffer.filter(
      (i) => i.type === type && new Date(i.timestamp).getTime() >= cutoff,
    );
  }

  /** Clears all state — queue, ring buffer, and dedup timestamps. */
  clear(): void {
    this.queue = [];
    this.ringBuffer = [];
    this.lastSeenAt.clear();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Append to ring buffer, evicting the oldest entry when at capacity. */
  private _addToRingBuffer(incident: Incident): void {
    if (this.ringBuffer.length >= RING_BUFFER_MAX) {
      this.ringBuffer.shift(); // evict oldest
    }
    this.ringBuffer.push(incident);
  }
}
