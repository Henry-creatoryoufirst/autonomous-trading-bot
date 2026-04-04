/**
 * Extracted cash deployment / fear gate logic from agent-v3.2.ts
 * for unit testing. Faithfully replicates the monolith's behavior.
 */

export interface CashDeploymentTier {
  cashPct: number;
  deployPct: number;
  confluenceDiscount: number;
  maxEntries: number;
  label: 'LIGHT' | 'MODERATE' | 'AGGRESSIVE' | 'URGENT';
}

export interface CashDeploymentResult {
  active: boolean;
  cashPercent: number;
  excessCash: number;
  deployBudget: number;
  confluenceDiscount: number;
  tier: CashDeploymentTier['label'] | 'NONE';
  maxEntries: number;
}

/**
 * Default tiers from config/constants.ts
 */
export const DEFAULT_TIERS: CashDeploymentTier[] = [
  { cashPct: 20, deployPct: 30, confluenceDiscount: 0, maxEntries: 2, label: 'LIGHT' },
  { cashPct: 35, deployPct: 50, confluenceDiscount: 0, maxEntries: 3, label: 'MODERATE' },
  { cashPct: 50, deployPct: 70, confluenceDiscount: 0, maxEntries: 4, label: 'AGGRESSIVE' },
  { cashPct: 65, deployPct: 80, confluenceDiscount: 0, maxEntries: 5, label: 'URGENT' },
];

export const DEFAULT_MIN_RESERVE_USD = 150;

/**
 * Replicates checkCashDeploymentMode from agent-v3.2.ts (v21.2 with F&G restored).
 *
 * Key behaviors tested:
 * - F&G < 15: deployment completely BLOCKED (extreme fear)
 * - F&G 15-24: only URGENT tier (>65% cash) allowed
 * - F&G >= 25: all tiers active normally
 */
export function checkCashDeploymentMode(
  usdcBalance: number,
  totalPortfolioValue: number,
  fearGreedValue: number = 50,
  tiers: CashDeploymentTier[] = DEFAULT_TIERS,
  minReserveUSD: number = DEFAULT_MIN_RESERVE_USD,
  deploymentThresholdOverride: number | null = null,
  confluenceReduction: number = 0,
): CashDeploymentResult {
  const noDeployResult: CashDeploymentResult = {
    active: false,
    cashPercent: 0,
    excessCash: 0,
    deployBudget: 0,
    confluenceDiscount: 0,
    tier: 'NONE',
    maxEntries: 0,
  };

  if (totalPortfolioValue <= 0) return noDeployResult;

  const cashPercent = (usdcBalance / totalPortfolioValue) * 100;

  // v21.2: F&G RESTORED as deployment gate
  if (fearGreedValue < 15) {
    return { ...noDeployResult, cashPercent };
  }

  // F&G 15-24: only URGENT tier allowed
  const fearDampened = fearGreedValue < 25;

  // Find highest matching tier (iterate descending)
  let matchedTier: CashDeploymentTier | null = null;
  for (let i = tiers.length - 1; i >= 0; i--) {
    const tier = tiers[i];
    if (fearDampened && tier.label !== 'URGENT') continue;
    const effectiveThreshold = deploymentThresholdOverride ?? tier.cashPct;
    if (cashPercent > effectiveThreshold) {
      matchedTier = tier;
      break;
    }
  }

  if (!matchedTier) {
    return { ...noDeployResult, cashPercent };
  }

  // Calculate excess
  const targetCash = totalPortfolioValue * (matchedTier.cashPct / 100);
  const excessCash = Math.max(
    0,
    usdcBalance - Math.max(targetCash, minReserveUSD),
  );

  if (excessCash < 10) {
    return { ...noDeployResult, cashPercent };
  }

  const deployBudget = excessCash * (matchedTier.deployPct / 100);
  const totalConfluenceDiscount =
    matchedTier.confluenceDiscount + confluenceReduction;

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
