/**
 * Cash Deployment Engine Service
 *
 * Extracted from agent-v3.2.ts — manages graduated cash deployment tiers,
 * fear gate, and deployment budget calculation.
 *
 * All functions accept state/dependencies as explicit parameters (no globals).
 *
 * v11.1/v20.2: Graduated deployment tiers (LIGHT → MODERATE → AGGRESSIVE → URGENT)
 * v20.7: Tiers shift up during fear
 * v20.8: F&G demoted to info-only (base threshold always used)
 * v21.2: F&G RESTORED as deployment gate — extreme fear suspends deployment
 */

// ============================================================================
// TYPES
// ============================================================================

export type DeploymentTierLabel = string | 'NONE';

export interface CashDeploymentResult {
  active: boolean;
  cashPercent: number;
  excessCash: number;
  deployBudget: number;
  confluenceDiscount: number;
  tier: DeploymentTierLabel;
  maxEntries: number;
}

export interface DeploymentTier {
  label: string;
  cashPct: number;
  deployPct: number;
  confluenceDiscount: number;
  maxEntries: number;
}

export interface DirectiveAdjustments {
  confluenceReduction: number;
  deploymentThresholdOverride: number | null;
  positionSizeMultiplier: number;
}

/** Mutable state tracked between cycles */
export interface CashDeploymentState {
  cashDeploymentMode: boolean;
  cashDeploymentCycles: number;
}

// ============================================================================
// DEFAULTS
// ============================================================================

export function createDefaultCashDeploymentState(): CashDeploymentState {
  return {
    cashDeploymentMode: false,
    cashDeploymentCycles: 0,
  };
}

const NO_DEPLOY_RESULT: CashDeploymentResult = {
  active: false,
  cashPercent: 0,
  excessCash: 0,
  deployBudget: 0,
  confluenceDiscount: 0,
  tier: 'NONE',
  maxEntries: 0,
};

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * v20.8: F&G demoted to info-only. Always returns the base threshold.
 * The bot follows price physics (momentum, volume, capital flows), not sentiment surveys.
 */
export function getFearAdjustedDeployThreshold(
  _fearGreedValue: number,
  cashDeploymentThresholdPct: number,
): number {
  return cashDeploymentThresholdPct; // Always base threshold — physics-based, not sentiment-based
}

/**
 * v20.2: Graduated Cash Deployment Detection
 * Replaces binary 40% threshold with 4 tiers that increase deployment pressure as cash grows.
 * Fixes the "dead zone" where 25-39% cash sat idle doing nothing.
 *
 * Tiers: LIGHT (>25%) → MODERATE (>35%) → AGGRESSIVE (>50%) → URGENT (>65%)
 * Each tier has its own deploy %, confluence discount, and max entries.
 * v20.7: Tiers shift up during fear — bot holds cash comfortably in bearish markets.
 * v21.2: F&G RESTORED as deployment gate — extreme fear suspends deployment.
 */
export function checkCashDeploymentMode(
  usdcBalance: number,
  totalPortfolioValue: number,
  _fearGreedValue: number,
  deploymentState: CashDeploymentState,
  tiers: DeploymentTier[],
  minReserveUSD: number,
  getDirectiveAdjustments: () => DirectiveAdjustments,
): CashDeploymentResult {
  const noDeployResult: CashDeploymentResult = { ...NO_DEPLOY_RESULT };
  if (totalPortfolioValue <= 0) return noDeployResult;

  const cashPercent = (usdcBalance / totalPortfolioValue) * 100;

  // v11.4.19: Directive-aware threshold — aggressive directives lower the trigger
  const directiveAdj = getDirectiveAdjustments();

  // v21.2: F&G RESTORED as deployment gate — v20.8 removed it which caused the bot to
  // force-deploy into crashing markets at F&G=8, losing hundreds in buy-sell-buy-sell churn.
  // When fear is extreme, the bot should sit in cash, not force-deploy.
  if (_fearGreedValue < 15) {
    if (deploymentState.cashDeploymentMode) {
      console.log(`  🛑 Cash deployment SUSPENDED — F&G ${_fearGreedValue} (extreme fear). Holding cash.`);
      deploymentState.cashDeploymentMode = false;
    }
    return { ...noDeployResult, cashPercent };
  }
  // F&G 15-25: Only allow URGENT tier (>65% cash) — severely limit forced buys in fear
  const fearDampened = _fearGreedValue < 25;

  // v20.2: Find highest matching tier (iterate descending)
  let matchedTier: DeploymentTier | null = null;
  for (let i = tiers.length - 1; i >= 0; i--) {
    const tier = tiers[i];
    // v21.2: In fear markets, only URGENT tier activates
    if (fearDampened && tier.label !== 'URGENT') continue;
    const effectiveThreshold = directiveAdj.deploymentThresholdOverride ?? tier.cashPct;
    if (cashPercent > effectiveThreshold) {
      matchedTier = tier;
      break;
    }
  }

  if (!matchedTier) {
    if (deploymentState.cashDeploymentMode) {
      console.log(`  ✅ Cash deployment mode OFF — USDC at ${cashPercent.toFixed(1)}% (below ${tiers[0].cashPct}% lowest tier${directiveAdj.deploymentThresholdOverride ? ' [directive override]' : ''})`);
      deploymentState.cashDeploymentMode = false;
    }
    return { ...noDeployResult, cashPercent };
  }

  // Calculate excess: how much USDC is above the matched tier's threshold
  const targetCash = totalPortfolioValue * (matchedTier.cashPct / 100);
  const excessCash = Math.max(0, usdcBalance - Math.max(targetCash, minReserveUSD));

  if (excessCash < 10) {
    return { ...noDeployResult, cashPercent };
  }

  // Deploy the tier's percentage of excess per cycle
  const deployBudget = excessCash * (matchedTier.deployPct / 100);

  deploymentState.cashDeploymentMode = true;
  deploymentState.cashDeploymentCycles++;

  // v11.4.19: Stack directive confluence reduction on top of tier's discount
  const totalConfluenceDiscount = matchedTier.confluenceDiscount + directiveAdj.confluenceReduction;

  console.log(`  💰 CASH DEPLOYMENT [${matchedTier.label}]: ${cashPercent.toFixed(1)}% cash | budget $${deployBudget.toFixed(0)} | confluence -${totalConfluenceDiscount}pts | max ${matchedTier.maxEntries} entries`);

  return {
    active: true,
    cashPercent,
    excessCash,
    deployBudget,
    confluenceDiscount: totalConfluenceDiscount,
    tier: matchedTier.label,
    maxEntries: matchedTier.maxEntries,
  };
}
