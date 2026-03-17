/**
 * Never Rest Capital — Family Platform Types
 * v11.0: Multi-wallet family architecture (Path B — shared brain, individual wallets)
 */

// ============================================================================
// RISK PROFILES
// ============================================================================

export type RiskProfileName = "AGGRESSIVE" | "MODERATE" | "CONSERVATIVE";

export interface RiskProfile {
  name: RiskProfileName;
  label: string;
  description: string;

  /** Max percentage of portfolio per single trade */
  maxPositionPercent: number;
  /** Max buy size in USD per trade */
  maxBuySizeUSD: number;
  /** Max sell percentage of any position per trade */
  maxSellPercent: number;
  /** Stop-loss trigger (negative %, e.g. -15) */
  stopLossPercent: number;
  /** Trailing stop from peak (negative %, e.g. -12) */
  trailingStopPercent: number;
  /** Profit-take tiers — scale out as gains increase */
  profitTakeTiers: Array<{ gainPercent: number; sellPercent: number; label: string }>;
  /** Minimum confluence score to execute a BUY */
  minConfluenceBuy: number;
  /** Minimum (negative) confluence score to execute a SELL */
  minConfluenceSell: number;
  /** Which sectors are allowed (empty = all) */
  allowedSectors: string[];
  /** Kelly fraction multiplier (1.0 = full quarter-Kelly, 0.5 = eighth-Kelly) */
  kellyMultiplier: number;
}

// ============================================================================
// FAMILY MEMBER
// ============================================================================

export type MemberStatus = "ACTIVE" | "PAUSED" | "ONBOARDING";

export interface FamilyMember {
  /** Unique identifier (kebab-case, e.g. "henry", "mom-nz") */
  id: string;
  /** Display name */
  name: string;
  /** CDP account name (used with getOrCreateAccount) */
  cdpAccountName: string;
  /** On-chain wallet address (populated after first CDP call) */
  walletAddress: string;
  /** Risk profile key */
  riskProfile: RiskProfileName;
  /** Current status */
  status: MemberStatus;
  /** When this member was added */
  createdAt: string;
  /** Optional note (e.g. "Sister in New Zealand") */
  note?: string;
}

// ============================================================================
// PER-MEMBER STATE (runtime, not persisted in member config)
// ============================================================================

export interface MemberPortfolioState {
  memberId: string;
  /** Total portfolio value in USD */
  totalValueUSD: number;
  /** Peak portfolio value (for drawdown tracking) */
  peakValueUSD: number;
  /** Realized P&L since inception */
  realizedPnLUSD: number;
  /** Unrealized P&L on current holdings */
  unrealizedPnLUSD: number;
  /** Total deposits into this wallet */
  totalDepositsUSD: number;
  /** Number of trades executed for this member */
  totalTrades: number;
  /** Win rate (0-1) */
  winRate: number;
  /** Token balances */
  balances: MemberBalance[];
  /** Last updated timestamp */
  lastUpdated: string;
}

export interface MemberBalance {
  symbol: string;
  balance: number;
  usdValue: number;
  price?: number;
  costBasis?: number;
  unrealizedPnL?: number;
}

// ============================================================================
// TRADE EXECUTION (per-member fan-out)
// ============================================================================

export interface FamilyTradeDecision {
  /** Which member this trade is for */
  memberId: string;
  /** The base AI decision (BUY/SELL/HOLD) */
  action: "BUY" | "SELL" | "HOLD";
  fromToken: string;
  toToken: string;
  /** USD amount scaled to this member's portfolio + risk profile */
  amountUSD: number;
  /** Original AI reasoning */
  reasoning: string;
  /** Was this trade scaled down by risk profile? */
  scaledByProfile: boolean;
  /** Was this trade blocked by risk profile? */
  blockedByProfile: boolean;
  blockReason?: string;
}

export interface FamilyTradeResult {
  memberId: string;
  success: boolean;
  txHash?: string;
  error?: string;
  amountUSD: number;
  action: "BUY" | "SELL" | "HOLD";
  fromToken: string;
  toToken: string;
  timestamp: string;
}

// ============================================================================
// FAMILY CONFIG (persisted to disk)
// ============================================================================

export interface FamilyConfig {
  /** Version for migration support */
  version: number;
  /** All family members */
  members: FamilyMember[];
  /** Risk profile definitions */
  riskProfiles: Record<RiskProfileName, RiskProfile>;
  /** Global settings */
  settings: {
    /** Whether family trading is enabled */
    enabled: boolean;
    /** Whether to execute trades or just log decisions (dry run) */
    dryRun: boolean;
    /** Max concurrent member trades per cycle */
    maxConcurrentTrades: number;
    /** Delay between member trade executions (ms) */
    interMemberDelayMs: number;
  };
}

// ============================================================================
// DEFAULT RISK PROFILES
// ============================================================================

export const DEFAULT_RISK_PROFILES: Record<RiskProfileName, RiskProfile> = {
  AGGRESSIVE: {
    name: "AGGRESSIVE",
    label: "Aggressive",
    description: "Full AI autonomy, larger positions, wider stops. For experienced members.",
    maxPositionPercent: 25,
    maxBuySizeUSD: 100,
    maxSellPercent: 50,
    stopLossPercent: -15,
    trailingStopPercent: -12,
    profitTakeTiers: [
      { gainPercent: 8, sellPercent: 15, label: "EARLY_HARVEST" },
      { gainPercent: 15, sellPercent: 20, label: "MID_HARVEST" },
      { gainPercent: 25, sellPercent: 30, label: "STRONG_HARVEST" },
      { gainPercent: 40, sellPercent: 40, label: "MAJOR_HARVEST" },
    ],
    minConfluenceBuy: 25,
    minConfluenceSell: -20,
    allowedSectors: [], // all sectors
    kellyMultiplier: 1.0,
  },

  MODERATE: {
    name: "MODERATE",
    label: "Moderate",
    description: "Balanced risk/reward. Tighter stops, moderate positions.",
    maxPositionPercent: 15,
    maxBuySizeUSD: 50,
    maxSellPercent: 40,
    stopLossPercent: -10,
    trailingStopPercent: -8,
    profitTakeTiers: [
      { gainPercent: 6, sellPercent: 20, label: "EARLY_HARVEST" },
      { gainPercent: 12, sellPercent: 25, label: "MID_HARVEST" },
      { gainPercent: 20, sellPercent: 35, label: "STRONG_HARVEST" },
      { gainPercent: 30, sellPercent: 45, label: "MAJOR_HARVEST" },
    ],
    minConfluenceBuy: 30,
    minConfluenceSell: -25,
    allowedSectors: [], // all sectors
    kellyMultiplier: 0.75,
  },

  CONSERVATIVE: {
    name: "CONSERVATIVE",
    label: "Conservative",
    description: "Capital preservation first. Tight stops, small positions, blue-chip focus.",
    maxPositionPercent: 10,
    maxBuySizeUSD: 25,
    maxSellPercent: 30,
    stopLossPercent: -7,
    trailingStopPercent: -5,
    profitTakeTiers: [
      { gainPercent: 5, sellPercent: 25, label: "EARLY_HARVEST" },
      { gainPercent: 10, sellPercent: 30, label: "MID_HARVEST" },
      { gainPercent: 15, sellPercent: 40, label: "STRONG_HARVEST" },
      { gainPercent: 25, sellPercent: 50, label: "MAJOR_HARVEST" },
    ],
    minConfluenceBuy: 35,
    minConfluenceSell: -30,
    allowedSectors: ["BLUE_CHIP", "DEFI"], // no meme coins
    kellyMultiplier: 0.5,
  },
};
