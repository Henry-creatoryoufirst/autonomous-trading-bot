/**
 * Never Rest Capital — HarvestManager
 *
 * Phase 4 of the monolith refactor. Unifies `checkProfitTaking` and
 * `checkStopLoss` (which already live as functional modules in
 * src/core/exits/) behind a single class the cycle engine can consume.
 *
 * The monolith currently duplicates their logic inline in the
 * runTradingCycle() body and state mutations. This class:
 *   - Wraps both exit functions behind a clean `evaluate()` method
 *   - Routes state mutations through StateManager (Phase 2)
 *   - Returns a HarvestResult structure (Phase 1 types) so callers
 *     get decisions + pending mutations as data, not side effects
 *
 * v21.0 context: "mind-first architecture" means Claude is the primary
 * decision maker. This class is retained as a safety net and for
 * ICU (stressed position) handling — it fires conservatively and
 * doesn't compete with Claude's main decision flow.
 */

import type { StateManager } from '../state/state-manager.js';
import type { HarvestConfig, HarvestResult, HarvestDecision } from '../types/harvest.js';
import type { TechnicalIndicators } from '../../algorithm/indicators.js';
import { checkProfitTaking, type ProfitHarvesterDeps } from '../exits/profit-harvester.js';
import { checkStopLoss, type StopLossDeps } from '../exits/stop-loss-manager.js';

export interface HarvestManagerDeps {
  stateManager: StateManager;
  config: HarvestConfig;

  /** Token registry for the underlying exit functions. */
  tokenRegistry: Record<string, unknown>;

  /** Token-level block predicate used by profit-harvester + stop-loss-manager. */
  isTokenBlocked: (symbol: string) => boolean;

  /** ATR stop level computation — injected because it depends on indicator data. */
  computeAtrStopLevels: (
    symbol: string,
    sector: string | undefined,
    atrPct: number | null,
    currentPrice: number,
    cb: unknown,
  ) => unknown;
}

type BalanceEntry = {
  symbol: string;
  balance: number;
  usdValue: number;
  price?: number;
  sector?: string;
};

export class HarvestManager {
  private readonly state: StateManager;
  private readonly config: HarvestConfig;
  private readonly tokenRegistry: Record<string, unknown>;
  private readonly isTokenBlocked: (symbol: string) => boolean;
  private readonly computeAtrStopLevels: HarvestManagerDeps['computeAtrStopLevels'];

  constructor(deps: HarvestManagerDeps) {
    this.state = deps.stateManager;
    this.config = deps.config;
    this.tokenRegistry = deps.tokenRegistry;
    this.isTokenBlocked = deps.isTokenBlocked;
    this.computeAtrStopLevels = deps.computeAtrStopLevels;
  }

  // ==========================================================================
  // PUBLIC: evaluate — called once per cycle with current balances + indicators
  // ==========================================================================

  /**
   * Run both harvesters, aggregate their output into a single HarvestResult.
   *
   * Returns up to 2 decisions (one profit-take, one stop-loss) — whichever
   * the underlying modules surface. The caller converts them into TradeDecisions
   * and executes them in priority order (stop-loss first).
   */
  evaluate(
    balances: BalanceEntry[],
    indicators: Record<string, TechnicalIndicators>,
  ): HarvestResult {
    const evaluatedAt = new Date().toISOString();
    const decisions: HarvestDecision[] = [];
    const blocked: HarvestResult['blocked'] = [];

    // ── Stop-loss evaluation first (priority over profit-take) ──
    const stopDecision = this.runStopLoss(balances, indicators);
    if (stopDecision) {
      decisions.push(stopDecision);
    }

    // ── Profit-taking evaluation ──
    // Skip profit-taking on the same symbol that just triggered a stop-loss —
    // prevents a "stop-and-harvest-at-the-same-time" race.
    const profitDecision = this.runProfitTake(balances, indicators);
    if (profitDecision && (!stopDecision || profitDecision.symbol !== stopDecision.symbol)) {
      decisions.push(profitDecision);
    }

    return {
      decisions,
      blocked,
      meta: {
        symbolsEvaluated: balances.length,
        triggersFired: decisions.length,
        evaluatedAt,
      },
    };
  }

  // ==========================================================================
  // INTERNAL: profit-taking path
  // ==========================================================================

  private runProfitTake(
    balances: BalanceEntry[],
    indicators: Record<string, TechnicalIndicators>,
  ): HarvestDecision | null {
    const agentState = this.state.getState();

    const deps: ProfitHarvesterDeps = {
      state: {
        costBasis: agentState.costBasis,
        profitTakeCooldowns: agentState.profitTakeCooldowns,
        harvestedProfits: agentState.harvestedProfits ?? {
          totalHarvested: 0,
          harvestCount: 0,
          harvests: [],
        },
        sanityAlerts: agentState.sanityAlerts ?? [],
        trading: { totalPortfolioValue: agentState.trading.totalPortfolioValue },
      },
      config: {
        profitTaking: {
          enabled: true,
          minHoldingUSD: 1, // harvester applies its own per-tier floors
          cooldownHours: this.config.profitTaking.cooldownHoursPerTier,
          tiers: this.config.profitTaking.tiers,
        },
        autoHarvest: {
          minTradingCapitalUSD: this.config.profitTaking.minTradingCapitalUSD,
        },
      },
      tokenRegistry: this.tokenRegistry,
      isTokenBlocked: this.isTokenBlocked,
      markStateDirty: () => this.state.markDirty(true),
    };

    const td = checkProfitTaking(balances, indicators, deps);
    if (!td) return null;

    // Ensure agentState.harvestedProfits / sanityAlerts were initialized by the
    // profit-harvester's mutations — preserve on state via StateManager.
    if (!agentState.harvestedProfits) {
      agentState.harvestedProfits = { totalHarvested: 0, harvestCount: 0, harvests: [] };
    }

    return this.adaptTradeDecisionToHarvestDecision(td, 'PROFIT_TAKE');
  }

  // ==========================================================================
  // INTERNAL: stop-loss path
  // ==========================================================================

  private runStopLoss(
    balances: BalanceEntry[],
    indicators: Record<string, TechnicalIndicators>,
  ): HarvestDecision | null {
    const agentState = this.state.getState();

    const deps: StopLossDeps = {
      state: {
        costBasis: agentState.costBasis,
        stopLossCooldowns: agentState.stopLossCooldowns,
        adaptiveThresholds: {
          stopLossPercent: agentState.adaptiveThresholds?.stopLossPercent
            ?? this.config.stopLoss.baseStopPercent,
          trailingStopPercent: agentState.adaptiveThresholds?.trailingStopPercent
            ?? this.config.stopLoss.trailingStopPercent,
        },
        tradeHistory: agentState.tradeHistory.map((t) => ({
          toToken: (t as unknown as { toToken?: string }).toToken,
          action: t.action,
          success: t.success,
          reasoning: (t as unknown as { reasoning?: string }).reasoning,
          timestamp: t.timestamp,
        })),
      },
      config: {
        stopLoss: {
          enabled: true,
          minHoldingUSD: 1,
          sellPercent: 100, // Full exit on stop
          trailingEnabled: true,
        },
      },
      tokenRegistry: this.tokenRegistry,
      isTokenBlocked: this.isTokenBlocked,
      computeAtrStopLevels: this.computeAtrStopLevels,
    };

    const td = checkStopLoss(balances, indicators, deps);
    if (!td) return null;

    return this.adaptTradeDecisionToHarvestDecision(td, 'STOP_LOSS');
  }

  // ==========================================================================
  // INTERNAL: adapter — TradeDecision → HarvestDecision
  // ==========================================================================

  /**
   * Convert the underlying module's TradeDecision shape into the canonical
   * HarvestDecision defined in types/harvest.ts. The underlying modules
   * already applied their state mutations; we surface a skeletal "mutations"
   * field so the callsite can verify invariants if desired.
   */
  private adaptTradeDecisionToHarvestDecision(
    td: {
      fromToken: string;
      amountUSD: number;
      reasoning: string;
      sector?: string;
    },
    kind: 'PROFIT_TAKE' | 'STOP_LOSS',
  ): HarvestDecision {
    const agentState = this.state.getState();
    const cb = agentState.costBasis[td.fromToken];
    const currentPrice =
      agentState.trading.balances.find((b) => b.symbol === td.fromToken)?.price ?? 0;
    const avgCost = cb?.averageCostBasis ?? 0;
    const gainPercent =
      avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;
    const holdingStart = cb?.firstBuyDate ? new Date(cb.firstBuyDate).getTime() : Date.now();
    const holdingDurationMs = Math.max(0, Date.now() - holdingStart);
    const positionValueUSD =
      agentState.trading.balances.find((b) => b.symbol === td.fromToken)?.usdValue ?? 0;

    return {
      kind,
      // underlying modules produce a single trigger per call; we infer best-effort
      trigger: kind === 'PROFIT_TAKE' ? 'PROFIT_TIER' : 'COST_BASIS_STOP',
      symbol: td.fromToken,
      sellPercent:
        positionValueUSD > 0 ? Math.min(100, (td.amountUSD / positionValueUSD) * 100) : 100,
      reasoning: td.reasoning,
      currentPrice,
      averageCostBasis: avgCost,
      gainPercent,
      holdingDurationMs,
      positionValueUSD,
      // Underlying modules already applied mutations via markStateDirty.
      // Phase 4.5 will invert this so the module returns the mutations and
      // the manager applies them via StateManager for auditability.
      mutations: {},
    };
  }
}
