/**
 * NVR Capital — Self-Healing Intelligence: Shared Types
 *
 * The mission: instead of 50 Telegram texts when things go wrong,
 * the system diagnoses, heals, learns, and sends ONE message:
 * "Here's what broke, here's what I did, here's what the system learned."
 */

// ============================================================================
// INCIDENTS — what can go wrong
// ============================================================================

export type IncidentType =
  | 'TRADE_FAILURE'          // Swap failed or reverted on-chain
  | 'API_TIMEOUT'            // External API (GeckoTerminal, DexScreener, etc.) timed out
  | 'CIRCUIT_BREAKER'        // Consecutive losses triggered the trading pause
  | 'STUCK_CYCLE'            // Trading cycle hung past its timeout
  | 'BALANCE_ANOMALY'        // Unexpected balance change (large drop, missing token)
  | 'PRICE_FEED_FAILURE'     // No usable price data for critical tokens
  | 'CONSECUTIVE_FAILURES'   // Multiple API/trade failures in short succession
  | 'LARGE_DRAWDOWN';        // Portfolio value dropped significantly in one cycle

export type IncidentSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface Incident {
  id: string;                          // uuid-style: type_timestamp
  type: IncidentType;
  severity: IncidentSeverity;
  timestamp: string;                   // ISO
  context: Record<string, unknown>;   // type-specific data (token, error msg, etc.)
  cycleNumber: number;
  portfolioValue: number;
  resolved: boolean;
}

// ============================================================================
// PLAYBOOK — safe healing actions (no direct trade execution)
// ============================================================================

export type PlaybookAction =
  | 'ADD_TOKEN_COOLDOWN'          // Put offending token in cooldown
  | 'REFRESH_PRICE_CACHE'         // Invalidate stale price data for a token
  | 'REDUCE_POSITION_SIZE'        // Temporarily cut position size multiplier
  | 'RAISE_CONFLUENCE_THRESHOLD'  // Require higher conviction for buys
  | 'EXTEND_CIRCUIT_BREAKER'      // Add time to existing breaker pause
  | 'RESET_CIRCUIT_BREAKER'       // Clear breaker (only when recovery is proven)
  | 'NOTIFY_ONLY'                 // Log + Telegram only, no state change
  | 'ESCALATE_TO_HUMAN';          // Can't auto-fix — send urgent alert and stop trying

// Human-readable descriptions for Telegram reports
export const PLAYBOOK_DESCRIPTIONS: Record<PlaybookAction, string> = {
  ADD_TOKEN_COOLDOWN:         'Added token to cooldown to prevent retry spiral',
  REFRESH_PRICE_CACHE:        'Cleared stale price cache — fresh data next cycle',
  REDUCE_POSITION_SIZE:       'Reduced position size multiplier to protect capital',
  RAISE_CONFLUENCE_THRESHOLD: 'Raised conviction threshold — only high-confidence entries',
  EXTEND_CIRCUIT_BREAKER:     'Extended circuit breaker — staying cautious',
  RESET_CIRCUIT_BREAKER:      'Cleared circuit breaker — recovery evidence confirmed',
  NOTIFY_ONLY:                'Logged incident — no autonomous action taken',
  ESCALATE_TO_HUMAN:          'Escalated to human — requires manual review',
};

// ============================================================================
// DIAGNOSIS — Claude's analysis of an incident
// ============================================================================

export type DiagnosisConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Diagnosis {
  incidentId: string;
  rootCause: string;           // Human-readable explanation
  confidence: DiagnosisConfidence;
  recommendedActions: PlaybookAction[];
  reasoning: string;           // Claude's chain of thought (stored for learning)
  modelUsed: string;
  latencyMs: number;
  timestamp: string;
}

// ============================================================================
// EXECUTION — results of running a playbook action
// ============================================================================

export interface ActionResult {
  action: PlaybookAction;
  success: boolean;
  details: string;
  appliedAt: string;           // ISO
}

// ============================================================================
// OUTCOME — full incident lifecycle record (persisted for learning)
// ============================================================================

export interface HealingOutcome {
  id: string;                  // matches incident.id
  incident: Incident;
  diagnosis: Diagnosis | null; // null if diagnosis was skipped (NOTIFY_ONLY path)
  actionsExecuted: ActionResult[];
  resolved: boolean;
  resolvedAt: string | null;
  notificationSent: boolean;
  durationMs: number;
  // Learning signal: did the system improve after this incident?
  portfolioValueBefore: number;
  portfolioValueAfter: number | null;
}

// ============================================================================
// STATS — aggregate view of healing performance
// ============================================================================

export interface HealingStats {
  totalIncidents: number;
  resolvedIncidents: number;
  escalatedIncidents: number;
  resolutionRate: number;           // 0–1
  avgResolutionMs: number;
  incidentsByType: Partial<Record<IncidentType, number>>;
  actionSuccessRates: Partial<Record<PlaybookAction, { attempts: number; successes: number }>>;
  lastIncidentAt: string | null;
  lastResolvedAt: string | null;
}

// ============================================================================
// BOT INTERFACE — clean boundary between self-healing and agent internals
// ============================================================================

/**
 * The only surface the self-healing system touches in the bot.
 * Injected at startup — keeps the healing module fully decoupled from agent-v3.2.ts.
 */
export interface BotInterface {
  // Read-only context for diagnosis
  getCycleNumber(): number;
  getPortfolioValue(): number;
  getTradeHistory(limit: number): Array<{
    token: string;
    action: string;
    success: boolean;
    pnlUSD?: number;
    timestamp: string;
  }>;
  getErrorLog(limit: number): Array<{
    type: string;
    message: string;
    timestamp: string;
  }>;
  getMarketRegime(): string;
  getActivePositions(): Array<{
    symbol: string;
    usdValue: number;
    unrealizedPct: number;
  }>;
  getCircuitBreakerState(): {
    active: boolean;
    reason: string | null;
    triggeredAt: string | null;
  };

  // Healing actions — write operations (all safe, no trade execution)
  addTokenCooldown(symbol: string, durationMs: number): void;
  invalidatePriceCache(symbol?: string): void;
  setPositionSizeMultiplier(multiplier: number): void;
  setConfluenceThresholdOverride(delta: number): void;
  resetCircuitBreaker(): void;
  extendCircuitBreaker(additionalHours: number): void;
  markStateDirty(): void;
}
