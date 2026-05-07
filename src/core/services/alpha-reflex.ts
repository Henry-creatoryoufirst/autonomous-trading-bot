/**
 * NVR-SPEC-028 Phase 3: Alpha Reflex Execution
 *
 * The Watcher fires deterministic triggers. The Reviewer (Haiku) judges
 * BUY/WAIT/PASS. The Reflex executes BUY verdicts with hard discipline —
 * stops, targets, timers — and NO LLM in the live execution path. The
 * LLM authorized the thesis; the Reflex handles timing.
 *
 * Hard discipline (Henry's principle, verbatim 2026-05-07):
 *   "Hunts safely. Doesn't sit in losers and stay with falling knives.
 *    Gets in, gets out."
 *
 * Translates to:
 *   - Hard stop: -3% from entry → exit immediately, no review.
 *   - Hard target: +5% from entry → exit immediately, lock the win.
 *   - Hard time stop: 30 min max hold → exit at market regardless of P&L.
 *   - No averaging down: never add to a losing position.
 *   - One position per token at a time: no compounding exposure on the
 *     same name.
 *   - Total budget cap: $ALPHA_REFLEX_BUDGET_USD (default $50). Combined
 *     across all open positions.
 *
 * Modes:
 *   - dry-run (default): logs "WOULD BUY X" but doesn't call executeTrade.
 *     Lets Henry see what the Reflex would have done, see the Reviewer's
 *     accuracy on those would-be trades, before flipping live.
 *   - live: actually fires executeTrade. Capital at risk per the budget.
 *
 * Rollback: ALPHA_REFLEX_MODE=disabled stops the Reflex from doing anything
 *           (still init's, but onApprovedBuy is a no-op). =dry-run logs
 *           but doesn't trade. =live fires real trades.
 */

import type { AlphaTrigger } from './alpha-watcher.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const RESPECT_LIMITS = {
  /** Total $ across all open Reflex positions */
  MAX_BUDGET_USD: parseFloat(process.env.ALPHA_REFLEX_BUDGET_USD ?? '50') || 50,
  /** Per-trade $ size for each entry */
  PER_TRADE_USD: parseFloat(process.env.ALPHA_REFLEX_PER_TRADE_USD ?? '25') || 25,
};

const REFLEX_RULES = {
  /** Take profit at this absolute % gain from entry — no LLM review */
  TARGET_PCT: 5,
  /** Stop loss at this absolute % loss from entry — no LLM review */
  STOP_PCT: 3,
  /** Force exit if held longer than this many minutes */
  MAX_HOLD_MINUTES: 30,
  /** Minimum confidence on the Reviewer's BUY verdict to trigger a Reflex entry */
  MIN_REVIEW_CONFIDENCE: 0.6,
};

const POSITION_LOG_RING_BUFFER_SIZE = 200;

// ============================================================================
// TYPES
// ============================================================================

export type ReflexMode = 'disabled' | 'dry-run' | 'live';

export type ReflexExitReason = 'TARGET_HIT' | 'STOP_HIT' | 'TIMEOUT' | 'MANUAL';

export interface ReflexPosition {
  symbol: string;
  entryPriceUSD: number;
  entryAt: string;
  sizedUSD: number;
  /** Pre-computed target price = entry × (1 + TARGET_PCT/100) */
  targetPriceUSD: number;
  /** Pre-computed stop price = entry × (1 - STOP_PCT/100) */
  stopPriceUSD: number;
  /** Trigger that authorized the entry (kept for outcome correlation) */
  authorizingTriggerRaisedAt: string;
  authorizingTriggerType: string;
  /** Reviewer's verdict + confidence at entry */
  reviewVerdict: string;
  reviewConfidence: number;
  /** True if executed live, false if dry-run */
  executed: boolean;
  /** Tx hash if executed live */
  entryTxHash?: string;
}

export interface ReflexClosedPosition extends ReflexPosition {
  exitedAt: string;
  exitPriceUSD: number;
  exitReason: ReflexExitReason;
  realizedPnlUSD: number;
  realizedPnlPct: number;
  exitTxHash?: string;
}

export interface ReflexStatus {
  mode: ReflexMode;
  budget: { maxUSD: number; deployedUSD: number; perTradeUSD: number };
  open: ReflexPosition[];
  closed24h: number;
  byOutcome24h: Record<ReflexExitReason, number>;
  realizedPnl24hUSD: number;
}

// ============================================================================
// REFLEX CLASS
// ============================================================================

/**
 * Trade execution callback. Resolves to { success, txHash, error }.
 * Mirrors the existing agent-v3.2.ts executeTrade signature without
 * importing it directly (would create a circular dep — service → monolith).
 */
export type ExecuteTradeFn = (decision: {
  action: 'BUY' | 'SELL';
  fromToken: string;
  toToken: string;
  amountUSD: number;
  reasoning: string;
}) => Promise<{ success: boolean; txHash?: string; error?: string }>;

/**
 * Live price provider. The Watcher already polls these every 30s; Reflex
 * uses the same source so we don't add API calls.
 */
export type PriceProvider = (symbol: string) => number | undefined;

export class AlphaReflex {
  private mode: ReflexMode = 'disabled';
  private executeTrade: ExecuteTradeFn | null = null;
  private priceProvider: PriceProvider | null = null;
  private positions: Map<string, ReflexPosition> = new Map();
  private closedLog: ReflexClosedPosition[] = [];

  /**
   * Initialize at startup. Once initialized, the Watcher (which has the
   * tick loop already) calls onApprovedBuy() and monitorPositions().
   */
  init(opts: {
    mode: ReflexMode;
    executeTrade: ExecuteTradeFn;
    priceProvider: PriceProvider;
  }): void {
    this.mode = opts.mode;
    this.executeTrade = opts.executeTrade;
    this.priceProvider = opts.priceProvider;
    console.log(
      `[AlphaReflex] init mode=${this.mode} budget=$${RESPECT_LIMITS.MAX_BUDGET_USD} perTrade=$${RESPECT_LIMITS.PER_TRADE_USD} target=+${REFLEX_RULES.TARGET_PCT}% stop=-${REFLEX_RULES.STOP_PCT}% maxHold=${REFLEX_RULES.MAX_HOLD_MINUTES}min`,
    );
  }

  isEnabled(): boolean {
    return this.mode !== 'disabled' && this.executeTrade !== null;
  }

  /**
   * Runtime mode change — used by the auto-Promoter (NVR-SPEC-028 Phase 5)
   * to flip dry-run → live (or back) when conditions warrant. Logs the
   * change. Does NOT close existing positions when demoting; they keep
   * their original execution status (dry-run positions stay simulated,
   * live positions still need real exit transactions).
   */
  setMode(mode: ReflexMode): void {
    if (this.mode === mode) return;
    console.log(`[AlphaReflex] mode change: ${this.mode} → ${mode}`);
    this.mode = mode;
  }

  /**
   * Watcher calls this when a trigger's review lands and verdict is BUY
   * with sufficient confidence. Decides whether to enter, sizes the
   * trade, and (in live mode) fires executeTrade. In dry-run mode, logs
   * the would-be trade and creates a virtual ReflexPosition so the
   * monitor loop tracks it as if it were real.
   */
  async onApprovedBuy(trigger: AlphaTrigger): Promise<void> {
    if (!this.isEnabled()) return;
    const review = trigger.review;
    if (!review || review.verdict !== 'BUY') return;
    if (review.confidence < REFLEX_RULES.MIN_REVIEW_CONFIDENCE) {
      console.log(
        `[AlphaReflex] ${trigger.symbol} BUY rejected — confidence ${review.confidence.toFixed(2)} < ${REFLEX_RULES.MIN_REVIEW_CONFIDENCE}`,
      );
      return;
    }

    // Discipline gate: one position per token
    if (this.positions.has(trigger.symbol)) {
      console.log(`[AlphaReflex] ${trigger.symbol} BUY rejected — already holding (no averaging down)`);
      return;
    }

    // Discipline gate: budget cap
    const deployed = Array.from(this.positions.values()).reduce((s, p) => s + p.sizedUSD, 0);
    if (deployed + RESPECT_LIMITS.PER_TRADE_USD > RESPECT_LIMITS.MAX_BUDGET_USD) {
      console.log(
        `[AlphaReflex] ${trigger.symbol} BUY rejected — budget cap (deployed $${deployed.toFixed(2)} + $${RESPECT_LIMITS.PER_TRADE_USD} > $${RESPECT_LIMITS.MAX_BUDGET_USD})`,
      );
      return;
    }

    const entryPrice = trigger.snapshot.priceUSD;
    const position: ReflexPosition = {
      symbol: trigger.symbol,
      entryPriceUSD: entryPrice,
      entryAt: new Date().toISOString(),
      sizedUSD: RESPECT_LIMITS.PER_TRADE_USD,
      targetPriceUSD: entryPrice * (1 + REFLEX_RULES.TARGET_PCT / 100),
      stopPriceUSD: entryPrice * (1 - REFLEX_RULES.STOP_PCT / 100),
      authorizingTriggerRaisedAt: trigger.raisedAt,
      authorizingTriggerType: trigger.type,
      reviewVerdict: review.verdict,
      reviewConfidence: review.confidence,
      executed: false,
    };

    if (this.mode === 'dry-run') {
      console.log(
        `[AlphaReflex] DRY-RUN entry: ${trigger.symbol} $${RESPECT_LIMITS.PER_TRADE_USD} @ $${entryPrice.toFixed(6)} (target $${position.targetPriceUSD.toFixed(6)}, stop $${position.stopPriceUSD.toFixed(6)}) — Reviewer: ${review.reasoning.slice(0, 80)}`,
      );
      this.positions.set(trigger.symbol, position);
      return;
    }

    // Live mode: actually execute
    if (!this.executeTrade) return;
    try {
      const result = await this.executeTrade({
        action: 'BUY',
        fromToken: 'USDC',
        toToken: trigger.symbol,
        amountUSD: RESPECT_LIMITS.PER_TRADE_USD,
        reasoning: `ALPHA_REFLEX: ${trigger.type} (review ${review.verdict} conf ${review.confidence.toFixed(2)}). Stop -${REFLEX_RULES.STOP_PCT}% / Target +${REFLEX_RULES.TARGET_PCT}% / Max ${REFLEX_RULES.MAX_HOLD_MINUTES}min.`,
      });
      if (result.success) {
        position.executed = true;
        position.entryTxHash = result.txHash;
        this.positions.set(trigger.symbol, position);
        console.log(
          `[AlphaReflex] LIVE entry: ${trigger.symbol} $${RESPECT_LIMITS.PER_TRADE_USD} @ $${entryPrice.toFixed(6)} tx=${result.txHash?.slice(0, 10) ?? '?'}`,
        );
      } else {
        console.warn(`[AlphaReflex] entry FAILED for ${trigger.symbol}: ${result.error ?? 'unknown'}`);
      }
    } catch (e: any) {
      console.warn(`[AlphaReflex] entry threw for ${trigger.symbol}: ${e?.message ?? e}`);
    }
  }

  /**
   * Watcher calls this every tick (30s) with the cohort's current prices.
   * Walks open positions and exits any that hit target/stop/timeout.
   * No LLM in this path — all reflex.
   */
  async monitorPositions(): Promise<void> {
    if (!this.isEnabled() || !this.priceProvider) return;
    const now = Date.now();
    for (const [symbol, pos] of Array.from(this.positions.entries())) {
      const currentPrice = this.priceProvider(symbol);
      if (currentPrice === undefined) continue; // No price this tick — wait
      let exitReason: ReflexExitReason | null = null;
      if (currentPrice >= pos.targetPriceUSD) exitReason = 'TARGET_HIT';
      else if (currentPrice <= pos.stopPriceUSD) exitReason = 'STOP_HIT';
      else {
        const heldMinutes = (now - new Date(pos.entryAt).getTime()) / 60_000;
        if (heldMinutes >= REFLEX_RULES.MAX_HOLD_MINUTES) exitReason = 'TIMEOUT';
      }
      if (exitReason) {
        await this.exit(symbol, currentPrice, exitReason);
      }
    }
  }

  /**
   * Exit a position. In dry-run mode, just records the close. In live
   * mode, fires a SELL via executeTrade.
   */
  async exit(symbol: string, exitPriceUSD: number, reason: ReflexExitReason): Promise<void> {
    const pos = this.positions.get(symbol);
    if (!pos) return;
    const realizedPnlPct = ((exitPriceUSD - pos.entryPriceUSD) / pos.entryPriceUSD) * 100;
    const realizedPnlUSD = pos.sizedUSD * (realizedPnlPct / 100);
    const closed: ReflexClosedPosition = {
      ...pos,
      exitedAt: new Date().toISOString(),
      exitPriceUSD,
      exitReason: reason,
      realizedPnlUSD,
      realizedPnlPct,
    };

    if (this.mode === 'live' && pos.executed && this.executeTrade) {
      try {
        const result = await this.executeTrade({
          action: 'SELL',
          fromToken: symbol,
          toToken: 'USDC',
          amountUSD: 0, // full position — caller selects amount based on holdings
          reasoning: `ALPHA_REFLEX_EXIT: ${reason} (entry $${pos.entryPriceUSD.toFixed(6)}, exit $${exitPriceUSD.toFixed(6)}, ${realizedPnlPct >= 0 ? '+' : ''}${realizedPnlPct.toFixed(2)}% in ${((Date.now() - new Date(pos.entryAt).getTime()) / 60_000).toFixed(0)}min)`,
        });
        closed.exitTxHash = result.txHash;
      } catch (e: any) {
        console.warn(`[AlphaReflex] exit threw for ${symbol}: ${e?.message ?? e}`);
      }
    }

    console.log(
      `[AlphaReflex] ${this.mode === 'dry-run' ? 'DRY-RUN' : 'LIVE'} exit: ${symbol} ${reason} ${realizedPnlPct >= 0 ? '+' : ''}${realizedPnlPct.toFixed(2)}% ($${realizedPnlUSD >= 0 ? '+' : ''}${realizedPnlUSD.toFixed(2)})`,
    );

    this.positions.delete(symbol);
    this.closedLog.push(closed);
    if (this.closedLog.length > POSITION_LOG_RING_BUFFER_SIZE) {
      this.closedLog = this.closedLog.slice(-POSITION_LOG_RING_BUFFER_SIZE);
    }
  }

  // --------------------------------------------------------------------------
  // Public read API for admin endpoints
  // --------------------------------------------------------------------------

  getStatus(): ReflexStatus {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = this.closedLog.filter((p) => new Date(p.exitedAt).getTime() >= cutoff);
    const byOutcome: Record<ReflexExitReason, number> = {
      TARGET_HIT: 0,
      STOP_HIT: 0,
      TIMEOUT: 0,
      MANUAL: 0,
    };
    let realizedPnl = 0;
    for (const p of recent) {
      byOutcome[p.exitReason]++;
      realizedPnl += p.realizedPnlUSD;
    }
    const deployed = Array.from(this.positions.values()).reduce((s, p) => s + p.sizedUSD, 0);
    return {
      mode: this.mode,
      budget: {
        maxUSD: RESPECT_LIMITS.MAX_BUDGET_USD,
        deployedUSD: deployed,
        perTradeUSD: RESPECT_LIMITS.PER_TRADE_USD,
      },
      open: Array.from(this.positions.values()),
      closed24h: recent.length,
      byOutcome24h: byOutcome,
      realizedPnl24hUSD: realizedPnl,
    };
  }

  getRecentClosed(limit = 50): ReflexClosedPosition[] {
    return this.closedLog.slice(-limit).reverse();
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

export const alphaReflex = new AlphaReflex();
