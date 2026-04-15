/**
 * Never Rest Capital — PreservationMode
 *
 * Phase 3 of the monolith refactor. Extracts the capital preservation
 * state machine from agent-v3.2.ts (capitalPreservationMode variable +
 * updateCapitalPreservationMode function + scattered mutations in the
 * cycle filter section).
 *
 * History:
 *   - v19.3 introduced it as a Fear & Greed-gated sizing-down overlay
 *   - v20.8 DISABLED it by default ("price physics, not sentiment surveys")
 *   - SHI can re-enable it via operator action when conditions warrant
 *
 * Even though the mode is disabled by default today, we extract the full
 * state machine so:
 *   (a) the "force-disabled" state is explicit and auditable, not hidden
 *   (b) re-enabling it becomes a config toggle rather than a code change
 *   (c) the cycle filter stage in P5 has a clean interface to consume
 */

import type { StateManager } from '../state/state-manager.js';
import type {
  PreservationMode as PreservationModeSnapshot,
  PreservationModeLabel,
  PreservationConfig,
} from '../types/risk.js';

export interface PreservationModeDeps {
  stateManager: StateManager;
  config: PreservationConfig;
}

export class PreservationMode {
  private readonly state: StateManager;
  private readonly config: PreservationConfig;

  // Internal ring buffer of F&G readings (window for "sustained fear" detection)
  private readonly fearReadings: number[] = [];

  // Current derived snapshot — rebuilt on every update() call
  private snapshot: PreservationModeSnapshot;

  constructor(deps: PreservationModeDeps) {
    this.state = deps.stateManager;
    this.config = deps.config;
    this.snapshot = this.buildSnapshot('INACTIVE', 0, null, 'startup');
  }

  // ==========================================================================
  // PUBLIC: update — call after every F&G fetch
  // ==========================================================================

  /**
   * Push a new Fear & Greed reading into the ring buffer and evaluate
   * whether the mode should change. Returns the current mode snapshot.
   *
   * Transitions:
   *   - DISABLED if config.forceDisabled (v20.8+ default)
   *   - ACTIVE if sustained fear AND not already disabled
   *   - INACTIVE if F&G recovers past the deactivation threshold
   */
  update(fearGreedValue: number, currentRegime: string = 'UNKNOWN'): PreservationModeSnapshot {
    // Push into ring buffer
    this.fearReadings.push(fearGreedValue);
    if (this.fearReadings.length > this.config.ringBufferSize) {
      this.fearReadings.shift();
    }

    // Force-disabled path (v20.8+ default)
    if (this.config.forceDisabled) {
      // If we were previously active, log the transition + persist
      if (this.snapshot.label === 'ACTIVE') {
        console.log(`\n🟢 PRESERVATION MODE DISABLED (force-disabled config) — F&G=${fearGreedValue} logged as info-only`);
      }
      this.snapshot = this.buildSnapshot('DISABLED', fearGreedValue, null, currentRegime);
      return this.snapshot;
    }

    // Active path (only reachable when forceDisabled=false)
    const shouldActivate = this.shouldActivate(fearGreedValue);
    const shouldDeactivate = this.shouldDeactivate(fearGreedValue);

    if (this.snapshot.label !== 'ACTIVE' && shouldActivate) {
      const activatedAt = new Date().toISOString();
      console.log(`\n🛡️ PRESERVATION MODE ACTIVATED — F&G=${fearGreedValue} sustained below ${this.config.activationFearGreed}`);
      this.snapshot = this.buildSnapshot('ACTIVE', fearGreedValue, activatedAt, currentRegime);
      this.state.markDirty(true);
      return this.snapshot;
    }

    if (this.snapshot.label === 'ACTIVE' && shouldDeactivate) {
      console.log(`\n🟢 PRESERVATION MODE DEACTIVATED — F&G=${fearGreedValue} recovered above ${this.config.deactivationFearGreed}`);
      this.snapshot = this.buildSnapshot('INACTIVE', fearGreedValue, null, currentRegime);
      this.state.markDirty(true);
      return this.snapshot;
    }

    // No transition — update snapshot values but keep label
    this.snapshot = this.buildSnapshot(
      this.snapshot.label,
      fearGreedValue,
      this.snapshot.activatedAt,
      this.snapshot.metrics.enteredFromRegime,
    );
    return this.snapshot;
  }

  // ==========================================================================
  // PUBLIC: getMode — read current snapshot without updating
  // ==========================================================================

  getMode(): PreservationModeSnapshot {
    return this.snapshot;
  }

  // ==========================================================================
  // PUBLIC: metrics updates — called by the cycle filter stage when it
  // blocks or sizes-down a trade, so the snapshot carries accurate telemetry
  // ==========================================================================

  /** Increment the "trades blocked by preservation" counter. */
  recordTradeBlocked(): void {
    this.snapshot.metrics.tradesBlocked++;
  }

  /** Increment the "trades sized down by preservation" counter. */
  recordTradeSizedDown(): void {
    this.snapshot.metrics.tradesSizedDown++;
  }

  /**
   * Reset per-day metrics. Called by the cycle engine on UTC day rollover.
   */
  resetMetrics(): void {
    this.snapshot.metrics.tradesBlocked = 0;
    this.snapshot.metrics.tradesSizedDown = 0;
  }

  // ==========================================================================
  // PUBLIC: operator overrides — SHI or manual admin can force state
  // ==========================================================================

  /** Operator-initiated force-activate (SHI escalation path). */
  forceActivate(reason: string): void {
    if (this.config.forceDisabled) {
      console.warn(`[preservation] forceActivate ignored — config.forceDisabled=true (${reason})`);
      return;
    }
    console.log(`\n🛡️ PRESERVATION MODE FORCE-ACTIVATED by operator — ${reason}`);
    this.snapshot = this.buildSnapshot(
      'ACTIVE',
      this.snapshot.fearGreedValue,
      new Date().toISOString(),
      this.snapshot.metrics.enteredFromRegime,
    );
    this.state.markDirty(true);
  }

  /** Operator-initiated force-deactivate. */
  forceDeactivate(reason: string): void {
    console.log(`\n🟢 PRESERVATION MODE FORCE-DEACTIVATED by operator — ${reason}`);
    this.snapshot = this.buildSnapshot(
      'INACTIVE',
      this.snapshot.fearGreedValue,
      null,
      this.snapshot.metrics.enteredFromRegime,
    );
    this.state.markDirty(true);
  }

  // ==========================================================================
  // INTERNAL: transition logic
  // ==========================================================================

  /**
   * Activate when the last `minSustainedReadings` F&G values are all
   * at or below `activationFearGreed`.
   */
  private shouldActivate(currentFG: number): boolean {
    // Fast-path: current value not in fear zone
    if (currentFG > this.config.activationFearGreed) return false;

    // Need enough readings to prove sustained fear
    if (this.fearReadings.length < this.config.minSustainedReadings) return false;

    const window = this.fearReadings.slice(-this.config.minSustainedReadings);
    return window.every((v) => v <= this.config.activationFearGreed);
  }

  /**
   * Deactivate when F&G crosses back above the deactivation threshold.
   * Single-reading crossing is enough — we don't require sustained
   * recovery because the downside of staying cautious a bit too long
   * is cheaper than the downside of re-entering fear too fast.
   */
  private shouldDeactivate(currentFG: number): boolean {
    return currentFG > this.config.deactivationFearGreed;
  }

  // ==========================================================================
  // INTERNAL: snapshot construction
  // ==========================================================================

  private buildSnapshot(
    label: PreservationModeLabel,
    fearGreedValue: number,
    activatedAt: string | null,
    enteredFromRegime: string,
  ): PreservationModeSnapshot {
    const isActive = label === 'ACTIVE';
    return {
      label,
      activatedAt,
      fearGreedValue,
      positionSizeMultiplier: isActive ? this.config.sizeMultiplier : 1.0,
      minConfluenceForBuy: isActive ? this.config.minConfluence : 0,
      minSwarmConsensusForBuy: isActive ? this.config.minSwarmConsensus : 0,
      cycleIntervalMultiplier: isActive ? this.config.cycleIntervalMultiplier : 1.0,
      metrics: {
        tradesBlocked: this.snapshot?.metrics.tradesBlocked ?? 0,
        tradesSizedDown: this.snapshot?.metrics.tradesSizedDown ?? 0,
        enteredFromRegime,
      },
    };
  }
}
