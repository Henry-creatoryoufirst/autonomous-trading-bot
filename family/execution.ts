/**
 * Schertzinger Trading Command — Family Trade Execution Fan-Out
 * v11.0: Takes the shared brain's AI decision and executes per-member
 *
 * Flow:
 *   1. Shared brain produces ONE AI decision (BUY ETH, SELL AERO, HOLD, etc.)
 *   2. This module scales that decision per member's risk profile + portfolio size
 *   3. Executes trades on each member's CDP wallet independently
 *   4. Records results per member
 */

import { familyManager } from './members.js';
import { WalletManager } from './wallet-manager.js';
import type {
  FamilyMember,
  FamilyTradeDecision,
  FamilyTradeResult,
  RiskProfile,
} from '../types/family.js';

// ============================================================================
// DECISION SCALING
// ============================================================================

/**
 * Scale a single AI decision for a specific family member.
 * Returns a per-member trade decision with adjusted sizing.
 */
export function scaleDecisionForMember(
  aiDecision: { action: "BUY" | "SELL" | "HOLD"; fromToken: string; toToken: string; amountUSD: number; reasoning: string; confluenceScore?: number },
  member: FamilyMember,
  profile: RiskProfile,
  memberPortfolioValue: number,
  memberBalances: Array<{ symbol: string; balance: number; usdValue: number }>,
  henryPortfolioValue: number,
): FamilyTradeDecision {

  // HOLD decisions pass through unchanged
  if (aiDecision.action === "HOLD") {
    return {
      memberId: member.id,
      action: "HOLD",
      fromToken: aiDecision.fromToken,
      toToken: aiDecision.toToken,
      amountUSD: 0,
      reasoning: aiDecision.reasoning,
      scaledByProfile: false,
      blockedByProfile: false,
    };
  }

  // Check confluence thresholds
  const confluence = aiDecision.confluenceScore || 0;
  if (aiDecision.action === "BUY" && confluence < profile.minConfluenceBuy) {
    return {
      memberId: member.id,
      action: "HOLD",
      fromToken: aiDecision.fromToken,
      toToken: aiDecision.toToken,
      amountUSD: 0,
      reasoning: `Blocked by ${profile.name} profile: confluence ${confluence} < min ${profile.minConfluenceBuy}`,
      scaledByProfile: false,
      blockedByProfile: true,
      blockReason: `Confluence too low for ${profile.label} profile`,
    };
  }

  if (aiDecision.action === "SELL" && confluence > profile.minConfluenceSell) {
    return {
      memberId: member.id,
      action: "HOLD",
      fromToken: aiDecision.fromToken,
      toToken: aiDecision.toToken,
      amountUSD: 0,
      reasoning: `Blocked by ${profile.name} profile: confluence ${confluence} > min ${profile.minConfluenceSell}`,
      scaledByProfile: false,
      blockedByProfile: true,
      blockReason: `Confluence not strong enough for ${profile.label} sell`,
    };
  }

  // Check sector restrictions
  if (profile.allowedSectors.length > 0) {
    // Need to check if the target token's sector is in the allowed list
    // For now, pass through — sector check requires TOKEN_REGISTRY access
    // which will be wired in the agent integration
  }

  // Scale position size based on portfolio ratio
  // Henry's decision is sized for his portfolio. Scale proportionally for each member.
  let scaledAmount = aiDecision.amountUSD;

  if (henryPortfolioValue > 0 && memberPortfolioValue > 0) {
    // Proportional scaling: if Henry trades $100 on a $5000 portfolio (2%),
    // and mom has $2000, she trades $40 (same 2%)
    const henryPercent = aiDecision.amountUSD / henryPortfolioValue;
    scaledAmount = henryPercent * memberPortfolioValue;
  }

  // Apply risk profile caps
  if (aiDecision.action === "BUY") {
    // Cap at max buy size
    scaledAmount = Math.min(scaledAmount, profile.maxBuySizeUSD);

    // Cap at max position percent
    const maxPositionUSD = memberPortfolioValue * (profile.maxPositionPercent / 100);
    const currentPosition = memberBalances.find(b => b.symbol === aiDecision.toToken)?.usdValue || 0;
    const roomLeft = maxPositionUSD - currentPosition;
    if (roomLeft <= 0) {
      return {
        memberId: member.id,
        action: "HOLD",
        fromToken: aiDecision.fromToken,
        toToken: aiDecision.toToken,
        amountUSD: 0,
        reasoning: `Blocked: ${aiDecision.toToken} position already at ${profile.maxPositionPercent}% cap for ${profile.label}`,
        scaledByProfile: false,
        blockedByProfile: true,
        blockReason: `Position at ${profile.label} cap`,
      };
    }
    scaledAmount = Math.min(scaledAmount, roomLeft);

    // Check USDC available
    const usdcAvailable = memberBalances.find(b => b.symbol === 'USDC')?.usdValue || 0;
    scaledAmount = Math.min(scaledAmount, usdcAvailable * 0.95); // keep 5% buffer

    // Apply Kelly multiplier
    scaledAmount *= profile.kellyMultiplier;
  }

  if (aiDecision.action === "SELL") {
    // Cap at max sell percent of holding
    const holding = memberBalances.find(b => b.symbol === aiDecision.fromToken)?.usdValue || 0;
    const maxSellUSD = holding * (profile.maxSellPercent / 100);
    scaledAmount = Math.min(scaledAmount, maxSellUSD);
  }

  // Floor: don't trade dust
  if (scaledAmount < 1) {
    return {
      memberId: member.id,
      action: "HOLD",
      fromToken: aiDecision.fromToken,
      toToken: aiDecision.toToken,
      amountUSD: 0,
      reasoning: `Skipped: scaled amount $${scaledAmount.toFixed(2)} below $1 minimum`,
      scaledByProfile: true,
      blockedByProfile: false,
    };
  }

  return {
    memberId: member.id,
    action: aiDecision.action,
    fromToken: aiDecision.fromToken,
    toToken: aiDecision.toToken,
    amountUSD: Math.round(scaledAmount * 100) / 100, // round to cents
    reasoning: `[${profile.label}] ${aiDecision.reasoning} | Scaled: $${aiDecision.amountUSD.toFixed(2)} → $${scaledAmount.toFixed(2)}`,
    scaledByProfile: scaledAmount !== aiDecision.amountUSD,
    blockedByProfile: false,
  };
}

// ============================================================================
// FAN-OUT EXECUTION
// ============================================================================

/**
 * Fan out an AI decision to all active family members.
 * Returns scaled decisions for each member (without executing).
 */
export function fanOutDecision(
  aiDecision: { action: "BUY" | "SELL" | "HOLD"; fromToken: string; toToken: string; amountUSD: number; reasoning: string; confluenceScore?: number },
  walletManager: WalletManager,
  henryPortfolioValue: number,
): FamilyTradeDecision[] {
  const members = familyManager.getActiveMembers();
  const decisions: FamilyTradeDecision[] = [];

  for (const member of members) {
    // Skip members without initialized wallets
    if (!walletManager.isReady(member.id)) {
      console.log(`  ⏭️ ${member.name}: wallet not initialized, skipping`);
      continue;
    }

    const profile = familyManager.getMemberRiskProfile(member.id);
    const portfolioState = walletManager.getPortfolioState(member.id);
    const memberValue = portfolioState?.totalValueUSD || 0;
    const memberBalances = portfolioState?.balances || [];

    // For Henry (founder), pass through original decision unchanged
    if (member.id === 'henry') {
      decisions.push({
        memberId: member.id,
        action: aiDecision.action,
        fromToken: aiDecision.fromToken,
        toToken: aiDecision.toToken,
        amountUSD: aiDecision.amountUSD,
        reasoning: aiDecision.reasoning,
        scaledByProfile: false,
        blockedByProfile: false,
      });
      continue;
    }

    // Scale for non-founder members
    const scaled = scaleDecisionForMember(
      aiDecision,
      member,
      profile,
      memberValue,
      memberBalances,
      henryPortfolioValue,
    );
    decisions.push(scaled);
  }

  return decisions;
}

/**
 * Execute a batch of family trade decisions sequentially.
 * Takes an executor function from the main bot (executeTrade/executeSingleSwap).
 *
 * @param decisions - Per-member trade decisions from fanOutDecision()
 * @param walletManager - For getting CDP accounts
 * @param executor - The actual trade execution function from agent-v3.2.ts
 * @param settings - Family settings (dry run, delays)
 */
export async function executeFamilyTrades(
  decisions: FamilyTradeDecision[],
  walletManager: WalletManager,
  executor: (memberId: string, decision: FamilyTradeDecision) => Promise<FamilyTradeResult>,
  settings: { dryRun: boolean; interMemberDelayMs: number },
): Promise<FamilyTradeResult[]> {
  const results: FamilyTradeResult[] = [];

  // Filter to actionable trades only
  const actionable = decisions.filter(d => d.action !== 'HOLD' && !d.blockedByProfile && d.amountUSD > 0);

  if (actionable.length === 0) {
    return results;
  }

  console.log(`\n  👨‍👩‍👧‍👦 FAMILY EXECUTION: ${actionable.length} trade(s) to execute`);

  for (const decision of actionable) {
    const member = familyManager.getMember(decision.memberId);
    const memberName = member?.name || decision.memberId;

    if (settings.dryRun) {
      console.log(`  🏷️ [DRY RUN] ${memberName}: ${decision.action} $${decision.amountUSD.toFixed(2)} ${decision.fromToken} → ${decision.toToken}`);
      results.push({
        memberId: decision.memberId,
        success: true,
        amountUSD: decision.amountUSD,
        action: decision.action,
        fromToken: decision.fromToken,
        toToken: decision.toToken,
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    try {
      console.log(`  🔄 ${memberName}: ${decision.action} $${decision.amountUSD.toFixed(2)} ${decision.fromToken} → ${decision.toToken}`);
      const result = await executor(decision.memberId, decision);
      results.push(result);

      if (result.success) {
        console.log(`  ✅ ${memberName}: Trade executed — ${result.txHash || 'ok'}`);
      } else {
        console.log(`  ❌ ${memberName}: Trade failed — ${result.error || 'unknown'}`);
      }
    } catch (err: any) {
      console.error(`  ❌ ${memberName}: Execution error — ${err.message}`);
      results.push({
        memberId: decision.memberId,
        success: false,
        error: err.message,
        amountUSD: decision.amountUSD,
        action: decision.action,
        fromToken: decision.fromToken,
        toToken: decision.toToken,
        timestamp: new Date().toISOString(),
      });
    }

    // Delay between member trades to avoid rate limits
    if (settings.interMemberDelayMs > 0) {
      await new Promise(r => setTimeout(r, settings.interMemberDelayMs));
    }
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`  👨‍👩‍👧‍👦 FAMILY EXECUTION COMPLETE: ${successCount}/${results.length} succeeded`);

  return results;
}
