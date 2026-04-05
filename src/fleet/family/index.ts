/**
 * Never Rest Capital — Family Platform Module
 * v11.0: Public API for the family multi-wallet system
 *
 * Usage in agent-v3.2.ts:
 *   import { familyManager, WalletManager, fanOutDecision, executeFamilyTrades } from './family/index.js';
 */

export { familyManager, FamilyMemberManager } from './members.js';
export { WalletManager } from './wallet-manager.js';
export { scaleDecisionForMember, fanOutDecision, executeFamilyTrades } from './execution.js';

// Re-export types for convenience
export type {
  FamilyMember,
  FamilyConfig,
  RiskProfile,
  RiskProfileName,
  MemberStatus,
  MemberPortfolioState,
  MemberBalance,
  FamilyTradeDecision,
  FamilyTradeResult,
} from '../types/family.js';
export { DEFAULT_RISK_PROFILES } from '../types/family.js';
