/**
 * NVR-SPEC-022 — Pattern Runtime
 *
 * The thing that makes the bot "on watch": composes patterns into a
 * single tick loop. For each tick:
 *
 *   1. ATTENTION — call detect() on every active pattern, in parallel.
 *   2. JUDGMENT  — for each trigger, call confirm() (if defined) to size
 *                  conviction. Veto on null/0.
 *   3. EXECUTION — for each surviving (trigger, conviction), call enter()
 *                  to build a TradeDecision and forward it to the
 *                  execute callback.
 *   4. MONITOR   — for each open position, call the owning pattern's
 *                  monitor(). On an exit decision, forward to executor
 *                  and close in the position tracker.
 *
 * The runtime is pure orchestration. It does not execute trades itself
 * — the runtime calls `executeFn` (injected) to perform side-effects.
 * In tests/backtests `executeFn` is a stub. In live, it wires to the
 * existing `executeTrade` infrastructure in agent-v3.2.ts.
 *
 * Allocation enforcement: each pattern declares maxAllocationPct +
 * maxConcurrentPositions. The runtime applies BOTH gates when sizing.
 */

import type {
  Pattern,
  PatternStatus,
  Trigger,
  Conviction,
  Position,
  MarketSnapshot,
  PatternState,
  ConfirmContext,
  AskAIOptions,
} from "./types.js";
import type { TradeDecision } from "./trade-decision-shim.js";
import type { PatternRegistry } from "./registry.js";
import { PositionTracker } from "./position-tracker.js";

// ----------------------------------------------------------------------------
// Runtime dependencies (dependency injection — keeps this testable)
// ----------------------------------------------------------------------------

export interface RuntimeDeps {
  /** Total alpha-sleeve USD the runtime can deploy across patterns. The
   *  runtime allocates fractions of this to each pattern based on
   *  `maxAllocationPct`. */
  alphaSleeveUsd(): number;

  /** Forward a TradeDecision to the bot's execution layer. Returns the
   *  executed trade summary or throws. In tests, just records the
   *  decision and returns synthetic fill info. */
  executeFn(decision: TradeDecision): Promise<{ filledUsd: number; filledPrice: number; txHash?: string }>;

  /** Optional: the AI shim that pattern.confirm() uses. If the runtime
   *  receives a pattern with a confirm() that calls askAI but the runtime
   *  was constructed without one, it fails closed (treat as veto). */
  askAI?: (prompt: string, opts?: AskAIOptions) => Promise<string>;

  /** Persistent state per pattern. Returns the current state object the
   *  runtime can mutate; the persistence layer handles snapshotting
   *  outside the tick loop. */
  loadPatternState(patternName: string): PatternState;
}

// ----------------------------------------------------------------------------
// Runtime modes
// ----------------------------------------------------------------------------

/**
 * Which patterns the runtime drives:
 *   - 'live'   : only status='live' patterns; trades execute for real
 *   - 'paper'  : only status='paper' patterns; trades go through executeFn
 *                but executeFn is expected to be a paper-trade stub
 *   - 'all'    : both — live and paper patterns drive trades through the
 *                same executeFn. Useful when the executeFn itself routes
 *                live vs paper based on pattern attribution. Default 'live'.
 */
export type RuntimeMode = "live" | "paper" | "all";

// ----------------------------------------------------------------------------
// The runtime
// ----------------------------------------------------------------------------

export class PatternRuntime {
  readonly tracker = new PositionTracker();

  constructor(
    private readonly registry: PatternRegistry,
    private readonly deps: RuntimeDeps,
    private readonly mode: RuntimeMode = "live",
  ) {}

  /** Statuses this runtime processes given its mode. */
  private activeStatuses(): readonly PatternStatus[] {
    if (this.mode === "live") return ["live"];
    if (this.mode === "paper") return ["paper"];
    return ["live", "paper"];
  }

  /** Active records under the current mode. */
  private activePatterns(): { pattern: Pattern; state: PatternState }[] {
    const out: { pattern: Pattern; state: PatternState }[] = [];
    for (const status of this.activeStatuses()) {
      for (const r of this.registry.byStatus(status)) {
        out.push({ pattern: r.pattern, state: this.deps.loadPatternState(r.pattern.name) });
      }
    }
    return out;
  }

  /**
   * One tick of the runtime. Called by the outer loop on every tick
   * interval. Returns a summary of what happened, useful for cockpit
   * telemetry + tests.
   */
  async tick(market: MarketSnapshot): Promise<TickReport> {
    const active = this.activePatterns();

    // --- LAYER 1: ATTENTION (parallel detect calls) ---
    // The runtime tags the trigger with the *registered* pattern name —
    // patterns may set patternName themselves but the registry name is
    // the source of truth (matches the comment on Trigger.patternName).
    const triggerResults = await Promise.all(
      active.map(({ pattern, state }) => {
        try {
          const t = pattern.detect(market, state);
          return t ? ({ patternName: pattern.name, trigger: t } as DetectHit) : null;
        } catch (e: unknown) {
          return { _error: e, _patternName: pattern.name } as DetectError;
        }
      }),
    );
    const triggers: Trigger[] = [];
    const detectErrors: { patternName: string; error: unknown }[] = [];
    for (const r of triggerResults) {
      if (!r) continue;
      if ("_error" in r) {
        detectErrors.push({ patternName: r._patternName, error: r._error });
        continue;
      }
      triggers.push({ ...r.trigger, patternName: r.patternName });
    }

    // --- LAYER 2: JUDGMENT (confirm conviction in parallel) ---
    const judged: { trigger: Trigger; conviction: Conviction }[] = [];
    await Promise.all(
      triggers.map(async (t) => {
        const pattern = this.registry.get(t.patternName)?.pattern;
        if (!pattern) return; // pattern was deregistered between detect and confirm; drop
        if (!pattern.confirm) {
          judged.push({ trigger: t, conviction: 100 });
          return;
        }
        try {
          const ctx: ConfirmContext = {
            trigger: t,
            market,
            askAI: this.deps.askAI,
          };
          const conv = await pattern.confirm(ctx);
          if (conv === null || conv === 0) return; // vetoed
          judged.push({ trigger: t, conviction: conv });
        } catch {
          // Any confirm-time error is a veto. The runtime favors silence
          // over guessing — if AI is offline, we don't trade.
        }
      }),
    );

    // --- LAYER 3: EXECUTION (sequential — order matters for capacity) ---
    const entered: { position: Position; decision: TradeDecision }[] = [];
    const sleeveUsd = this.deps.alphaSleeveUsd();
    for (const { trigger, conviction } of judged) {
      const rec = this.registry.get(trigger.patternName);
      if (!rec) continue;
      const pattern = rec.pattern;

      // Capacity gate: respect maxConcurrentPositions
      const openForPattern = this.tracker.openPositions(pattern.name).length;
      if (openForPattern >= pattern.maxConcurrentPositions) continue;

      // Allocation gate: maxAllocationPct of sleeve, divided across slots
      // so a single pattern doesn't spend its entire budget on one entry
      const perPositionBudget =
        (sleeveUsd * (pattern.maxAllocationPct / 100)) /
        Math.max(1, pattern.maxConcurrentPositions);

      const decision = pattern.enter(trigger, conviction, perPositionBudget);
      if (decision.amountUSD <= 0) continue;

      try {
        const fill = await this.deps.executeFn(decision);
        const pos: Position = {
          patternName: pattern.name,
          symbol: trigger.symbol,
          entryAt: market.timestamp,
          entryPrice: fill.filledPrice,
          entryUsd: fill.filledUsd,
          meta: { triggerContext: trigger.context, txHash: fill.txHash },
        };
        this.tracker.open_(pos);
        entered.push({ position: pos, decision });
      } catch {
        // Execution failed — pattern keeps its capacity slot free for
        // a retry next tick. We don't surface this as a hard error
        // because RPC blips happen.
      }
    }

    // --- LAYER 4: MONITOR (open positions → exit decisions) ---
    const exited: { closed: Position; reason: string }[] = [];
    for (const { pattern, state } of active) {
      const opens = this.tracker.openPositions(pattern.name);
      for (const pos of opens) {
        let exitDecision: ReturnType<Pattern["monitor"]> = "hold";
        try {
          exitDecision = pattern.monitor(pos, market, state);
        } catch {
          continue; // monitor errors → hold (silence > guessing)
        }
        if (exitDecision === "hold") continue;

        // Build the corresponding SELL TradeDecision
        const closePrice = market.prices.get(pos.symbol);
        if (closePrice === undefined || closePrice <= 0) continue;
        const tokenAmount = pos.entryUsd / pos.entryPrice;
        const fraction = (exitDecision.pctClose ?? 100) / 100;
        const sellUsd = tokenAmount * closePrice * fraction;
        const sellDecision: TradeDecision = {
          action: "SELL",
          fromToken: pos.symbol,
          toToken: "USDC",
          amountUSD: sellUsd,
          percent: Math.round(fraction * 100),
          reasoning: `pattern=${pattern.name}@${pattern.version} · exit_reason=${exitDecision.reason} · entry=$${pos.entryUsd.toFixed(2)}`,
          sector: pattern.name === "stablecoin_depeg" ? "STABLE" : undefined,
        };

        try {
          await this.deps.executeFn(sellDecision);
          this.tracker.close_(pattern.name, pos.symbol, pos.entryAt, {
            closeAt: market.timestamp,
            closePrice,
            reason: exitDecision.reason,
          });
          exited.push({ closed: pos, reason: exitDecision.reason });
        } catch {
          // Exit failed — leave open, retry next tick
        }
      }
    }

    return {
      timestamp: market.timestamp,
      activePatternCount: active.length,
      triggersDetected: triggers.length,
      convictionsAccepted: judged.length,
      entered: entered.length,
      exited: exited.length,
      detectErrors,
    };
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

interface DetectError {
  _error: unknown;
  _patternName: string;
}

interface DetectHit {
  patternName: string;
  trigger: Trigger;
}

export interface TickReport {
  readonly timestamp: string;
  readonly activePatternCount: number;
  readonly triggersDetected: number;
  readonly convictionsAccepted: number;
  readonly entered: number;
  readonly exited: number;
  readonly detectErrors: { patternName: string; error: unknown }[];
}
