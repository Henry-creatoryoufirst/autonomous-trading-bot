/**
 * Never Rest Capital — Capital Deployment Logic
 * Extracted from agent-v3.2.ts (Phase 12 refactor)
 */

import type { CashDeploymentResult } from "../types/state.js";

type PortfolioSensitivityTier = { minUSD: number; priceChangeThreshold: number; label: string };
type CashDeploymentTier = { cashPct: number; deployPct: number; confluenceDiscount: number; maxEntries: number; label: string };

export function getPortfolioSensitivity(
  portfolioUSD: number,
  tiers: readonly PortfolioSensitivityTier[],
): { threshold: number; tier: string } {
  let matched = tiers[0];
  for (const tier of tiers) {
    if (portfolioUSD >= tier.minUSD) matched = tier;
  }
  return { threshold: matched.priceChangeThreshold, tier: matched.label };
}

export function assessVolatility(
  currentPrices: Map<string, number>,
  previousPrices: Map<string, number>,
): { level: string; maxChange: number; fastestMover: string } {
  let maxChange = 0;
  let fastestMover = '';

  for (const [symbol, price] of currentPrices) {
    const prev = previousPrices.get(symbol);
    if (prev && prev > 0) {
      const change = Math.abs(price - prev) / prev;
      if (change > maxChange) {
        maxChange = change;
        fastestMover = symbol;
      }
    }
  }

  let level: string;
  if (maxChange > 0.08) level = 'EXTREME';
  else if (maxChange > 0.05) level = 'HIGH';
  else if (maxChange > 0.03) level = 'ELEVATED';
  else if (maxChange > 0.01) level = 'NORMAL';
  else if (maxChange > 0.003) level = 'LOW';
  else level = 'DEAD';

  return { level, maxChange, fastestMover };
}

export function checkCashDeploymentMode(
  usdcBalance: number,
  totalPortfolioValue: number,
  fearGreedValue: number,
  tiers: readonly CashDeploymentTier[],
  minReserveUSD: number,
  directiveAdj: { deploymentThresholdOverride?: number; confluenceReduction: number },
  mutableState: { cashDeploymentMode: boolean; cashDeploymentCycles: number },
): CashDeploymentResult {
  const noDeployResult: CashDeploymentResult = { active: false, cashPercent: 0, excessCash: 0, deployBudget: 0, confluenceDiscount: 0, tier: 'NONE', maxEntries: 0 };
  if (totalPortfolioValue <= 0) return noDeployResult;

  const cashPercent = (usdcBalance / totalPortfolioValue) * 100;

  // v21.2: F&G RESTORED as deployment gate
  if (fearGreedValue < 15) {
    if (mutableState.cashDeploymentMode) {
      console.log(`  🛑 Cash deployment SUSPENDED — F&G ${fearGreedValue} (extreme fear). Holding cash.`);
      mutableState.cashDeploymentMode = false;
    }
    return { ...noDeployResult, cashPercent };
  }
  const fearDampened = fearGreedValue < 25;

  let matchedTier: CashDeploymentTier | null = null;
  for (let i = tiers.length - 1; i >= 0; i--) {
    const tier = tiers[i];
    if (fearDampened && tier.label !== 'URGENT') continue;
    const effectiveThreshold = directiveAdj.deploymentThresholdOverride ?? tier.cashPct;
    if (cashPercent > effectiveThreshold) {
      matchedTier = tier;
      break;
    }
  }

  if (!matchedTier) {
    if (mutableState.cashDeploymentMode) {
      console.log(`  ✅ Cash deployment mode OFF — USDC at ${cashPercent.toFixed(1)}% (below ${tiers[0].cashPct}% lowest tier${directiveAdj.deploymentThresholdOverride ? ' [directive override]' : ''})`);
      mutableState.cashDeploymentMode = false;
    }
    return { ...noDeployResult, cashPercent };
  }

  const targetCash = totalPortfolioValue * (matchedTier.cashPct / 100);
  const excessCash = Math.max(0, usdcBalance - Math.max(targetCash, minReserveUSD));

  if (excessCash < 10) {
    return { ...noDeployResult, cashPercent };
  }

  const deployBudget = excessCash * (matchedTier.deployPct / 100);

  mutableState.cashDeploymentMode = true;
  mutableState.cashDeploymentCycles++;

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

export function checkCrashBuyingOverride(
  deploymentCheck: { active: boolean; cashPercent: number; excessCash: number; deployBudget: number; confluenceDiscount: number },
  fearGreedValue: number,
  belowCapitalFloor: boolean,
  overrideMinCashPct: number,
  overrideSizeMult: number,
  overrideMaxEntries: number,
  maxEntries: number,
  mutableState: { crashBuyingOverrideActive: boolean; crashBuyingOverrideCycles: number },
): {
  active: boolean;
  reason: string;
  sizeMultiplier: number;
  maxEntries: number;
  blueChipOnly: boolean;
  maxPositionPct: number;
  requirePositiveBuyRatio: boolean;
} {
  const inactive = { active: false, reason: '', sizeMultiplier: 1, maxEntries, blueChipOnly: false, maxPositionPct: 100, requirePositiveBuyRatio: false };

  const crashFearMult = 1.0;
  const crashBlueChipOnly = false;

  if (deploymentCheck.cashPercent < overrideMinCashPct) {
    return { ...inactive, reason: `Cash ${deploymentCheck.cashPercent.toFixed(1)}% below override threshold ${overrideMinCashPct}%` };
  }

  if (belowCapitalFloor) {
    return { ...inactive, reason: 'Capital floor active — override blocked' };
  }

  if (deploymentCheck.cashPercent < 1) {
    return { ...inactive, reason: `No USDC available for crash buying (${deploymentCheck.cashPercent.toFixed(1)}%)` };
  }

  mutableState.crashBuyingOverrideActive = true;
  mutableState.crashBuyingOverrideCycles++;

  return {
    active: true,
    reason: `Cash heavy (${deploymentCheck.cashPercent.toFixed(1)}%) + breaker active → deployment override (F&G=${fearGreedValue}, fear mult: ${(crashFearMult * 100).toFixed(0)}%)`,
    sizeMultiplier: overrideSizeMult * crashFearMult,
    maxEntries: overrideMaxEntries,
    blueChipOnly: crashBlueChipOnly,
    maxPositionPct: 5,
    requirePositiveBuyRatio: true,
  };
}
