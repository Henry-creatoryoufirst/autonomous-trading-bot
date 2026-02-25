/**
 * Schertzinger Trading Command — Per-Token Cooldown System (v6.0)
 *
 * Prevents repeated evaluation of the same token on fast 2-minute cycles.
 * After the AI makes a decision about a token, a cooldown is set.
 * Cooldowns can be overridden by significant price movements.
 */

import { COOLDOWN_DURATIONS, COOLDOWN_OVERRIDE_THRESHOLD } from '../config/constants.js';
import type { CooldownDecision, CooldownEntry } from '../types/index.js';

export class CooldownManager {
  private cooldowns: Map<string, CooldownEntry> = new Map();
  private overrideThreshold: number;

  constructor(overrideThreshold: number = COOLDOWN_OVERRIDE_THRESHOLD) {
    this.overrideThreshold = overrideThreshold;
  }

  /**
   * Set a cooldown for a token after the AI makes a decision.
   */
  setCooldown(symbol: string, decision: CooldownDecision, priceAtDecision: number): void {
    const cooldownMs = this.getCooldownDuration(decision);

    this.cooldowns.set(symbol, {
      symbol,
      decision,
      decidedAt: Date.now(),
      cooldownMs,
      priceAtDecision,
    });

    const mins = (cooldownMs / 60000).toFixed(0);
    console.log(`  ⏱️  Cooldown set: ${symbol} → ${decision} (${mins}m cooldown)`);
  }

  /**
   * Check if a token should be evaluated this cycle.
   * Returns true if: no cooldown, cooldown expired, or price override triggered.
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
        console.log(`  ⚡ Cooldown OVERRIDE: ${symbol} moved ${(priceChange * 100).toFixed(1)}% ${direction} — re-evaluating`);
        this.cooldowns.delete(symbol);
        return true;
      }
    }

    return false; // Still in cooldown
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
