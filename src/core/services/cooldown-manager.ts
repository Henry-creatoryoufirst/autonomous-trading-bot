/**
 * Never Rest Capital — Per-Token Cooldown System (v7.0)
 *
 * v7.0 upgrades:
 * - Signal-weighted re-entry: tokens can re-enter during cooldown if confluence score
 *   clears a HIGHER threshold (REENTRY_CONFLUENCE_BUY=40 vs normal BUY=25).
 * - Hard 5-minute minimum lock after any trade (prevents same-candle flip).
 * - Emergency SELL always bypasses cooldown entirely.
 * - Price-move override retained: 3% move fast-tracks to re-evaluation.
 */

import {
    COOLDOWN_DURATIONS,
    COOLDOWN_OVERRIDE_THRESHOLD,
    REENTRY_CONFLUENCE_BUY,
    REENTRY_CONFLUENCE_SELL,
    NORMAL_CONFLUENCE_BUY,
    NORMAL_CONFLUENCE_SELL,
    TRADE_MINIMUM_COOLDOWN_MS,
} from '../config/constants.js';
import type { CooldownDecision, CooldownEntry } from '../types/index.js';

export class CooldownManager {
    private cooldowns: Map<string, CooldownEntry> = new Map();
    private overrideThreshold: number;

  constructor(overrideThreshold: number = COOLDOWN_OVERRIDE_THRESHOLD) {
        this.overrideThreshold = overrideThreshold;
  }

  /**
     * Set a cooldown for a token after the AI makes a decision.
     * @param confluenceScore - The confluence score that triggered this decision (optional, used for re-entry logic)
     */
  setCooldown(symbol: string, decision: CooldownDecision, priceAtDecision: number, confluenceScore?: number): void {
        const cooldownMs = this.getCooldownDuration(decision);

      this.cooldowns.set(symbol, {
              symbol,
              decision,
              decidedAt: Date.now(),
              cooldownMs,
              priceAtDecision,
              confluenceAtDecision: confluenceScore,
      });

      const mins = (cooldownMs / 60000).toFixed(0);
        console.log(` ⏱️ Cooldown set: ${symbol} → ${decision} (${mins}m cooldown)`);
  }

  /**
     * Check if a token should be evaluated this cycle.
     * Returns true if: no cooldown, cooldown expired, or price override triggered.
     * NOTE: Does NOT check signal-weighted re-entry — use shouldReenter() for that.
     */
  shouldEvaluate(symbol: string, currentPrice: number): boolean {
        const entry = this.cooldowns.get(symbol);
        if (!entry) return true; // No cooldown = evaluate

      const now = Date.now();

      // Check if cooldown expired
      if (now - entry.decidedAt > entry.cooldownMs) {
              this.cooldowns.delete(symbol);
              return true;
      }

      // Check for price override (significant price move since decision)
      if (entry.priceAtDecision > 0 && currentPrice > 0) {
              const priceChange = Math.abs(currentPrice - entry.priceAtDecision) / entry.priceAtDecision;
              if (priceChange > this.overrideThreshold) {
                        const direction = currentPrice > entry.priceAtDecision ? 'UP' : 'DOWN';
                        console.log(` ⚡ Cooldown OVERRIDE: ${symbol} moved ${(priceChange * 100).toFixed(1)}% ${direction} — re-evaluating`);
                        this.cooldowns.delete(symbol);
                        return true;
              }
      }

      return false; // Still in cooldown
  }

  /**
     * v7.0: Signal-weighted re-entry check.
     * Even within a cooldown window, a token may re-enter if:
     *   1. The hard 5-minute minimum lock has passed.
     *   2. The new confluence score clears a HIGHER bar than normal entry.
     *   3. For emergency sells (decision was SELL with strongly negative confluence), always allow.
     *
     * @param symbol - Token symbol
     * @param currentPrice - Current price (used for price-move fast-track)
     * @param confluenceScore - The fresh AI confluence score (positive = bullish, negative = bearish)
     * @param isEmergency - If true, bypasses cooldown entirely (emergency SELL)
     * @returns true if the token should be re-evaluated/traded despite being in cooldown
     */
  shouldReenter(symbol: string, currentPrice: number, confluenceScore: number, isEmergency = false): boolean {
        const entry = this.cooldowns.get(symbol);
        if (!entry) return true; // No cooldown, always evaluate

      // Emergency sells always bypass cooldown
      if (isEmergency) {
              console.log(` 🚨 Emergency override: ${symbol} — cooldown bypassed`);
              this.cooldowns.delete(symbol);
              return true;
      }

      const now = Date.now();
        const elapsed = now - entry.decidedAt;

      // Hard minimum lock: no re-entry within 5 minutes of a trade, no exceptions
      if (elapsed < TRADE_MINIMUM_COOLDOWN_MS && (entry.decision === 'BUY' || entry.decision === 'SELL' || entry.decision === 'REBALANCE')) {
              return false;
      }

      // If cooldown fully expired, allow normal evaluation
      if (elapsed > entry.cooldownMs) {
              this.cooldowns.delete(symbol);
              return true;
      }

      // Price move fast-track: 3%+ move → fast-track to re-evaluation (not auto-trade)
      if (entry.priceAtDecision > 0 && currentPrice > 0) {
              const priceChange = Math.abs(currentPrice - entry.priceAtDecision) / entry.priceAtDecision;
              if (priceChange > this.overrideThreshold) {
                        const direction = currentPrice > entry.priceAtDecision ? 'UP' : 'DOWN';
                        console.log(` ⚡ Price move fast-track: ${symbol} moved ${(priceChange * 100).toFixed(1)}% ${direction} — re-evaluating`);
                        this.cooldowns.delete(symbol);
                        return true;
              }
      }

      // Signal-weighted re-entry: check if new confluence clears the higher re-entry bar
      const prevDecision = entry.decision;

      if (prevDecision === 'BUY' || prevDecision === 'HOLD' || prevDecision === 'WEAK_SIGNAL') {
              // Previously bullish/neutral — allow re-entry BUY only if confluence >= REENTRY threshold
          if (confluenceScore >= REENTRY_CONFLUENCE_BUY) {
                    console.log(` 🔁 Re-entry BUY: ${symbol} — confluence ${confluenceScore} >= ${REENTRY_CONFLUENCE_BUY} (high-conviction override)`);
                    this.cooldowns.delete(symbol);
                    return true;
          }
              // Allow fresh SELL signal even within cooldown window (requires strong negative confluence)
          if (confluenceScore <= REENTRY_CONFLUENCE_SELL) {
                    console.log(` 🔁 Re-entry SELL: ${symbol} — confluence ${confluenceScore} <= ${REENTRY_CONFLUENCE_SELL} (strong reversal)`);
                    this.cooldowns.delete(symbol);
                    return true;
          }
      } else if (prevDecision === 'SELL' || prevDecision === 'REBALANCE') {
              // Previously sold — allow re-entry BUY if confluence crosses re-entry threshold
          if (confluenceScore >= REENTRY_CONFLUENCE_BUY) {
                    console.log(` 🔁 Re-entry after SELL: ${symbol} — confluence ${confluenceScore} >= ${REENTRY_CONFLUENCE_BUY}`);
                    this.cooldowns.delete(symbol);
                    return true;
          }
      }

      return false; // Still in cooldown, insufficient confluence for re-entry
  }

  /**
     * Get the list of tokens currently in cooldown (not expired)
     */
  getActiveCooldowns(): CooldownEntry[] {
        this.purgeExpired();
        return Array.from(this.cooldowns.values());
  }

  /**
     * Get the count of active (non-expired) cooldowns
     */
  getActiveCount(): number {
        this.purgeExpired();
        return this.cooldowns.size;
  }

  /**
     * Get cooldown info for a specific token (null if not in cooldown)
     */
  getCooldownInfo(symbol: string): { remainingMs: number; decision: CooldownDecision } | null {
        const entry = this.cooldowns.get(symbol);
        if (!entry) return null;

      const elapsed = Date.now() - entry.decidedAt;
        if (elapsed > entry.cooldownMs) {
                this.cooldowns.delete(symbol);
                return null;
        }

      return {
              remainingMs: entry.cooldownMs - elapsed,
              decision: entry.decision,
      };
  }

  /**
     * Clear cooldown for a specific token (e.g., manual override)
     */
  clearCooldown(symbol: string): boolean {
        return this.cooldowns.delete(symbol);
  }

  /**
     * Clear all cooldowns
     */
  clearAll(): void {
        this.cooldowns.clear();
  }

  /**
     * Filter a list of tokens to only those that should be evaluated this cycle.
     * Returns [tokensToEvaluate, tokensInCooldown]
     */
  filterTokensForEvaluation(
        tokens: { symbol: string; price: number }[]
      ): [{ symbol: string; price: number }[], { symbol: string; price: number }[]] {
        const evaluate: { symbol: string; price: number }[] = [];
        const cooldown: { symbol: string; price: number }[] = [];

      for (const token of tokens) {
              if (this.shouldEvaluate(token.symbol, token.price)) {
                        evaluate.push(token);
              } else {
                        cooldown.push(token);
              }
      }

      return [evaluate, cooldown];
  }

  /**
     * Get summary string for logging
     */
  getSummary(): string {
        this.purgeExpired();
        if (this.cooldowns.size === 0) return 'No active cooldowns';

      const entries = Array.from(this.cooldowns.values())
          .map(e => {
                    const remaining = Math.max(0, e.cooldownMs - (Date.now() - e.decidedAt));
                    return `${e.symbol}(${e.decision}, ${(remaining / 60000).toFixed(0)}m left)`;
          });

      return `${entries.length} cooldowns: ${entries.join(', ')}`;
  }

  /**
   * Set a cooldown with an explicit duration in milliseconds.
   * Used by the Self-Healing Intelligence to impose cooling periods
   * on tokens that are causing repeated failures, without needing a
   * specific CooldownDecision type.
   */
  setRawCooldown(symbol: string, durationMs: number): void {
    this.cooldowns.set(symbol, {
      symbol,
      decision: 'HOLD',
      decidedAt: Date.now(),
      cooldownMs: durationMs,
      priceAtDecision: 0,
    });
    const mins = (durationMs / 60000).toFixed(0);
    console.log(` ⏱️ [SHI] Healing cooldown: ${symbol} → ${mins}m`);
  }

  // ---- Private helpers ----

  private getCooldownDuration(decision: CooldownDecision): number {
        switch (decision) {
          case 'BUY':
          case 'SELL':
          case 'REBALANCE':
                    return COOLDOWN_DURATIONS.TRADE_EXECUTED;
          case 'HOLD':
                    return COOLDOWN_DURATIONS.HOLD_DECISION;
          case 'WEAK_SIGNAL':
                    return COOLDOWN_DURATIONS.WEAK_SIGNAL;
          default:
                    return COOLDOWN_DURATIONS.HOLD_DECISION;
        }
  }

  private purgeExpired(): void {
        const now = Date.now();
        for (const [key, entry] of this.cooldowns) {
                if (now - entry.decidedAt > entry.cooldownMs) {
                          this.cooldowns.delete(key);
                }
        }
  }
}

// Singleton instance for the whole application
export const cooldownManager = new CooldownManager();
