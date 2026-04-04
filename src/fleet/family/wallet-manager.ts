/**
 * Never Rest Capital — Family Wallet Manager
 * v11.0: Multi-wallet management via CDP SDK
 *
 * One CdpClient instance, multiple named accounts.
 * Each family member gets their own Smart Wallet on Base.
 * The shared brain makes decisions; this layer fans out execution.
 */

import { CdpClient } from '@coinbase/cdp-sdk';
import { familyManager } from './members.js';
import type {
  FamilyMember,
  MemberPortfolioState,
  MemberBalance,
} from '../../core/types/family.js';

// ============================================================================
// TYPES
// ============================================================================

interface ManagedWallet {
  memberId: string;
  cdpAccountName: string;
  address: string;
  account: any; // CDP EVM Account object
  initializedAt: string;
}

// ============================================================================
// WALLET MANAGER
// ============================================================================

export class WalletManager {
  private cdpClient: CdpClient;
  private wallets: Map<string, ManagedWallet> = new Map();
  private portfolioStates: Map<string, MemberPortfolioState> = new Map();

  constructor(cdpClient: CdpClient) {
    this.cdpClient = cdpClient;
  }

  // --- Initialization ---

  /**
   * Initialize wallets for all active family members.
   * Calls getOrCreateAccount() for each — idempotent, safe to call on every boot.
   */
  async initializeAll(): Promise<void> {
    const members = familyManager.getActiveMembers();
    console.log(`\n  👨‍👩‍👧‍👦 Family Wallet Manager: Initializing ${members.length} member wallet(s)...`);

    for (const member of members) {
      try {
        await this.initializeMember(member);
      } catch (err: any) {
        console.error(`  ❌ Wallet init failed for ${member.name} (${member.id}): ${err.message}`);
      }
    }

    console.log(`  ✅ Family wallets initialized: ${this.wallets.size}/${members.length} active`);
  }

  /**
   * Initialize a single member's CDP wallet.
   */
  async initializeMember(member: FamilyMember): Promise<ManagedWallet> {
    // Check if already initialized
    const existing = this.wallets.get(member.id);
    if (existing) return existing;

    const account = await this.cdpClient.evm.getOrCreateAccount({
      name: member.cdpAccountName,
    });

    const wallet: ManagedWallet = {
      memberId: member.id,
      cdpAccountName: member.cdpAccountName,
      address: account.address,
      account,
      initializedAt: new Date().toISOString(),
    };

    this.wallets.set(member.id, wallet);

    // Update stored wallet address if it changed or wasn't set
    if (member.walletAddress !== account.address) {
      familyManager.updateMemberWallet(member.id, account.address);
    }

    console.log(`  ✅ ${member.name}: ${account.address} (${member.riskProfile})`);
    return wallet;
  }

  // --- Wallet Access ---

  /**
   * Get the CDP account object for a member (for executing trades).
   */
  getAccount(memberId: string): any | null {
    return this.wallets.get(memberId)?.account || null;
  }

  /**
   * Get the wallet address for a member.
   */
  getAddress(memberId: string): string | null {
    return this.wallets.get(memberId)?.address || null;
  }

  /**
   * Get all initialized wallets.
   */
  getAll(): ManagedWallet[] {
    return Array.from(this.wallets.values());
  }

  /**
   * Check if a member's wallet is initialized and ready for trading.
   */
  isReady(memberId: string): boolean {
    return this.wallets.has(memberId);
  }

  // --- Portfolio State ---

  /**
   * Update a member's portfolio state (called after balance refresh).
   */
  setPortfolioState(memberId: string, state: MemberPortfolioState): void {
    this.portfolioStates.set(memberId, state);
  }

  /**
   * Get a member's current portfolio state.
   */
  getPortfolioState(memberId: string): MemberPortfolioState | null {
    return this.portfolioStates.get(memberId) || null;
  }

  /**
   * Get all portfolio states (for dashboard aggregation).
   */
  getAllPortfolioStates(): MemberPortfolioState[] {
    return Array.from(this.portfolioStates.values());
  }

  /**
   * Get aggregate family portfolio value.
   */
  getFamilyTotalValue(): number {
    let total = 0;
    for (const state of this.portfolioStates.values()) {
      total += state.totalValueUSD;
    }
    return total;
  }

  // --- On-chain Balance Reads ---

  /**
   * Read ERC-20 token balance for a specific member's wallet.
   * Uses the same RPC pattern as the main bot but for any wallet address.
   */
  async getMemberTokenBalance(
    memberId: string,
    tokenAddress: string,
    decimals: number,
    rpcCall: (method: string, params: any[]) => Promise<any>
  ): Promise<number> {
    const wallet = this.wallets.get(memberId);
    if (!wallet) throw new Error(`Wallet not initialized for member: ${memberId}`);

    const balanceData = '0x70a08231' + wallet.address.slice(2).padStart(64, '0');
    const result = await rpcCall('eth_call', [
      { to: tokenAddress, data: balanceData },
      'latest',
    ]);

    if (!result || result === '0x' || result === '0x0') return 0;
    const raw = BigInt(result);
    return Number(raw) / Math.pow(10, decimals);
  }

  /**
   * Read ETH balance for a member's wallet.
   */
  async getMemberETHBalance(
    memberId: string,
    rpcCall: (method: string, params: any[]) => Promise<any>
  ): Promise<number> {
    const wallet = this.wallets.get(memberId);
    if (!wallet) throw new Error(`Wallet not initialized for member: ${memberId}`);

    const result = await rpcCall('eth_getBalance', [wallet.address, 'latest']);
    if (!result || result === '0x' || result === '0x0') return 0;
    return Number(BigInt(result)) / 1e18;
  }

  // --- Dashboard / API ---

  toJSON() {
    const walletSummary: any[] = [];
    for (const [memberId, wallet] of this.wallets) {
      const member = familyManager.getMember(memberId);
      const portfolio = this.portfolioStates.get(memberId);
      walletSummary.push({
        memberId,
        name: member?.name || memberId,
        address: wallet.address,
        riskProfile: member?.riskProfile || 'UNKNOWN',
        status: member?.status || 'UNKNOWN',
        portfolioValue: portfolio?.totalValueUSD || 0,
        totalTrades: portfolio?.totalTrades || 0,
        winRate: portfolio?.winRate || 0,
        lastUpdated: portfolio?.lastUpdated || wallet.initializedAt,
      });
    }

    return {
      totalWallets: this.wallets.size,
      familyTotalValue: this.getFamilyTotalValue(),
      wallets: walletSummary,
    };
  }
}
