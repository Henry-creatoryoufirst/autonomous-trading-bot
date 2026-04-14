/**
 * Never Rest Capital — Morpho Blue Yield Service
 * v21.17: Park idle USDC in Morpho MetaMorpho vaults on Base for yield (4-7% APY)
 *
 * Uses ERC-4626 standard via the Moonwell Flagship USDC vault — curated by
 * Gauntlet/Steakhouse/RE7, risk-assessed, 4-7% APY. Upgraded from Steakhouse Prime
 * (3.5-5% APY) on April 13, 2026.
 *
 * Architecture mirrors aave-yield.ts: deposit/withdraw calldata builders,
 * state tracking, and balance refresh. The yield optimizer selects between
 * Aave and Morpho based on current rates.
 *
 * Contracts (Base Mainnet):
 *   Morpho Blue Core:             0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb
 *   Moonwell Flagship USDC Vault: 0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca
 *   USDC:                         0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 *   Share token:                  = vault address (ERC-4626, vault IS the share token)
 */

import axios from 'axios';
import { BASE_RPC_ENDPOINTS, BASE_USDC_ADDRESS } from '../config/constants.js';

// ============================================================================
// CONTRACT ADDRESSES (Base Mainnet)
// ============================================================================

/** Moonwell Flagship USDC — curated by Gauntlet/Steakhouse/RE7, 4-7% APY */
const MORPHO_VAULT = '0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca';
const USDC_ADDRESS = BASE_USDC_ADDRESS;
const USDC_DECIMALS = 6;

// ERC-4626 function selectors
const DEPOSIT_SELECTOR = '0x6e553f65';     // deposit(uint256 assets, address receiver)
const WITHDRAW_SELECTOR = '0xb460af94';    // withdraw(uint256 assets, address receiver, address owner)
const REDEEM_SELECTOR = '0xba087652';      // redeem(uint256 shares, address receiver, address owner)
const BALANCE_OF_SELECTOR = '0x70a08231';  // balanceOf(address)
const CONVERT_TO_ASSETS_SELECTOR = '0x07a2d13a'; // convertToAssets(uint256 shares)
const PREVIEW_DEPOSIT_SELECTOR = '0xef8b30f7';   // previewDeposit(uint256 assets)
const TOTAL_ASSETS_SELECTOR = '0x01e1d114';       // totalAssets()
const APPROVE_SELECTOR = '0x095ea7b3';     // approve(address, uint256)
const ALLOWANCE_SELECTOR = '0xdd62ed3e';   // allowance(address, address)

const MAX_UINT256 = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

// ============================================================================
// YIELD STATE (mirrors AaveYieldService for compatibility)
// ============================================================================

export interface MorphoYieldState {
  enabled: boolean;
  depositedUSDC: number;
  shareBalance: number;       // vault shares held
  currentValueUSDC: number;   // shares converted to USDC (includes yield)
  totalYieldEarned: number;
  supplyCount: number;
  withdrawCount: number;
  lastSupply: string | null;
  lastWithdraw: string | null;
  estimatedAPY: number;
  operations: MorphoYieldOperation[];
}

export interface MorphoYieldOperation {
  type: 'SUPPLY' | 'WITHDRAW';
  amountUSDC: number;
  txHash?: string;
  timestamp: string;
  reason: string;
}

// ============================================================================
// RPC HELPER
// ============================================================================

async function rpcCall(method: string, params: any[]): Promise<any> {
  for (const rpc of BASE_RPC_ENDPOINTS) {
    try {
      const res = await axios.post(rpc, {
        jsonrpc: '2.0', id: 1, method, params,
      }, { timeout: 10000 });
      if (res.data?.result !== undefined) return res.data.result;
    } catch { /* try next */ }
  }
  throw new Error('All Base RPC endpoints failed');
}

function padAddress(addr: string): string {
  return addr.slice(2).toLowerCase().padStart(64, '0');
}

function encodeUint256(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

// ============================================================================
// MORPHO YIELD SERVICE
// ============================================================================

export class MorphoYieldService {
  private state: MorphoYieldState = {
    enabled: false,
    depositedUSDC: 0,
    shareBalance: 0,
    currentValueUSDC: 0,
    totalYieldEarned: 0,
    supplyCount: 0,
    withdrawCount: 0,
    lastSupply: null,
    lastWithdraw: null,
    estimatedAPY: 5.5,
    operations: [],
  };

  private minLiquidUSDC: number;
  private minDepositUSDC: number;
  private minWithdrawUSDC: number;

  constructor(options?: {
    minLiquidUSDC?: number;
    minDepositUSDC?: number;
    minWithdrawUSDC?: number;
  }) {
    this.minLiquidUSDC = options?.minLiquidUSDC ?? 500;
    this.minDepositUSDC = options?.minDepositUSDC ?? 50;
    this.minWithdrawUSDC = options?.minWithdrawUSDC ?? 25;
  }

  // --- Enable / Disable ---

  enable(): void { this.state.enabled = true; }
  disable(): void { this.state.enabled = false; }
  isEnabled(): boolean { return this.state.enabled; }

  // --- Balance Reads ---

  /**
   * Read vault share balance for a wallet.
   * Share token = vault contract (ERC-4626).
   */
  async getShareBalance(walletAddress: string): Promise<number> {
    const data = BALANCE_OF_SELECTOR + padAddress(walletAddress);
    const result = await rpcCall('eth_call', [
      { to: MORPHO_VAULT, data }, 'latest',
    ]);
    if (!result || result === '0x' || result === '0x0') return 0;
    // Vault shares use 18 decimals (standard ERC-4626 with USDC underlying)
    return Number(BigInt(result)) / 1e18;
  }

  /**
   * Convert share balance to USDC value (includes accrued yield).
   */
  async convertSharesToUSDC(shares: number): Promise<number> {
    if (shares <= 0) return 0;
    const sharesRaw = BigInt(Math.floor(shares * 1e18));
    const data = CONVERT_TO_ASSETS_SELECTOR + encodeUint256(sharesRaw);
    const result = await rpcCall('eth_call', [
      { to: MORPHO_VAULT, data }, 'latest',
    ]);
    if (!result || result === '0x' || result === '0x0') return 0;
    return Number(BigInt(result)) / Math.pow(10, USDC_DECIMALS);
  }

  /**
   * Read current USDC allowance for Morpho vault.
   */
  async getAllowance(walletAddress: string): Promise<bigint> {
    const data = ALLOWANCE_SELECTOR + padAddress(walletAddress) + padAddress(MORPHO_VAULT);
    const result = await rpcCall('eth_call', [
      { to: USDC_ADDRESS, data }, 'latest',
    ]);
    if (!result || result === '0x') return 0n;
    return BigInt(result);
  }

  // --- Deposit/Withdraw Decision Logic ---

  calculateDepositAmount(
    usdcBalance: number,
    marketRegime: string,
    fearGreedValue: number,
  ): number {
    if (!this.state.enabled) return 0;

    const available = usdcBalance - this.minLiquidUSDC;
    if (available < this.minDepositUSDC) return 0;

    let yieldAllocationPct = 0;

    if (marketRegime === 'RANGING' || marketRegime === 'UNKNOWN') {
      yieldAllocationPct = fearGreedValue < 30 ? 0.60 : 0.40;
    } else if (marketRegime === 'TRENDING_DOWN') {
      yieldAllocationPct = fearGreedValue < 25 ? 0.70 : 0.50;
    } else if (marketRegime === 'VOLATILE') {
      yieldAllocationPct = 0.25;
    } else if (marketRegime === 'TRENDING_UP') {
      yieldAllocationPct = 0.15;
    }

    const totalTarget = usdcBalance * yieldAllocationPct;
    const additionalNeeded = totalTarget - this.state.depositedUSDC;

    if (additionalNeeded < this.minDepositUSDC) return 0;

    return Math.min(Math.floor(additionalNeeded * 100) / 100, available);
  }

  calculateWithdrawAmount(
    usdcBalance: number,
    marketRegime: string,
    fearGreedValue: number,
    aiNeedsCapital: boolean,
  ): number {
    if (this.state.currentValueUSDC < this.minWithdrawUSDC) return 0;

    if (aiNeedsCapital && usdcBalance < this.minLiquidUSDC) {
      const needed = this.minLiquidUSDC * 1.5 - usdcBalance;
      return Math.min(needed, this.state.currentValueUSDC);
    }

    if (marketRegime === 'TRENDING_UP' && fearGreedValue > 60) {
      const targetWithdraw = this.state.currentValueUSDC * 0.5;
      return targetWithdraw >= this.minWithdrawUSDC ? targetWithdraw : 0;
    }

    return 0;
  }

  // --- Transaction Calldata Builders ---

  /**
   * Build ERC-4626 deposit calldata.
   * deposit(uint256 assets, address receiver) → shares minted to receiver.
   */
  buildDepositCalldata(amountUSDC: number, walletAddress: string): {
    to: string;
    data: string;
    approvalNeeded: boolean;
    approvalTo: string;
    approvalData: string;
  } {
    const amountRaw = BigInt(Math.floor(amountUSDC * 1e6));

    // deposit(uint256 assets, address receiver)
    const depositData = DEPOSIT_SELECTOR +
      encodeUint256(amountRaw) +
      padAddress(walletAddress);

    // approve(address spender, uint256 amount) — approve vault to spend USDC
    const approveData = APPROVE_SELECTOR +
      padAddress(MORPHO_VAULT) +
      MAX_UINT256;

    return {
      to: MORPHO_VAULT,
      data: depositData,
      approvalNeeded: true,
      approvalTo: USDC_ADDRESS,
      approvalData: approveData,
    };
  }

  /**
   * Build ERC-4626 withdraw calldata.
   * withdraw(uint256 assets, address receiver, address owner) → exact USDC out.
   */
  buildWithdrawCalldata(amountUSDC: number, walletAddress: string): {
    to: string;
    data: string;
  } {
    const amountRaw = BigInt(Math.floor(amountUSDC * 1e6));

    // withdraw(uint256 assets, address receiver, address owner)
    const data = WITHDRAW_SELECTOR +
      encodeUint256(amountRaw) +
      padAddress(walletAddress) +
      padAddress(walletAddress);

    return { to: MORPHO_VAULT, data };
  }

  /**
   * Build ERC-4626 redeem calldata (withdraw ALL shares).
   * redeem(uint256 shares, address receiver, address owner) → all USDC out.
   */
  buildRedeemAllCalldata(walletAddress: string): {
    to: string;
    data: string;
  } {
    // Use max uint256 to redeem all shares
    const data = REDEEM_SELECTOR +
      MAX_UINT256 +
      padAddress(walletAddress) +
      padAddress(walletAddress);

    return { to: MORPHO_VAULT, data };
  }

  // --- State Management ---

  recordSupply(amountUSDC: number, txHash?: string, reason?: string): void {
    this.state.depositedUSDC += amountUSDC;
    this.state.supplyCount++;
    this.state.lastSupply = new Date().toISOString();
    this.state.operations.push({
      type: 'SUPPLY',
      amountUSDC,
      txHash,
      timestamp: new Date().toISOString(),
      reason: reason || 'Morpho yield optimization',
    });
    if (this.state.operations.length > 100) {
      this.state.operations = this.state.operations.slice(-100);
    }
  }

  recordWithdraw(amountUSDC: number, txHash?: string, reason?: string): void {
    this.state.depositedUSDC = Math.max(0, this.state.depositedUSDC - amountUSDC);
    this.state.withdrawCount++;
    this.state.lastWithdraw = new Date().toISOString();
    this.state.operations.push({
      type: 'WITHDRAW',
      amountUSDC,
      txHash,
      timestamp: new Date().toISOString(),
      reason: reason || 'Capital deployment',
    });
    if (this.state.operations.length > 100) {
      this.state.operations = this.state.operations.slice(-100);
    }
  }

  /**
   * Refresh share balance and calculate accrued yield.
   */
  async refreshBalance(walletAddress: string): Promise<void> {
    try {
      const shares = await this.getShareBalance(walletAddress);
      this.state.shareBalance = shares;

      if (shares > 0) {
        const usdcValue = await this.convertSharesToUSDC(shares);
        this.state.currentValueUSDC = usdcValue;

        // Yield = current value - total deposited
        const yieldAccrued = usdcValue - this.state.depositedUSDC;
        if (yieldAccrued > 0) {
          this.state.totalYieldEarned = yieldAccrued;
        }
      } else {
        this.state.currentValueUSDC = 0;
      }
    } catch (err: any) {
      console.warn(`  ⚠️ Morpho yield balance check failed: ${err.message?.substring(0, 100)}`);
    }
  }

  // --- Persistence ---

  getState(): MorphoYieldState {
    return { ...this.state };
  }

  /** Compat getter for yield optimizer (same interface as Aave) */
  getDepositedUSDC(): number {
    return this.state.depositedUSDC;
  }

  restoreState(saved: Partial<MorphoYieldState>): void {
    if (saved.depositedUSDC !== undefined) this.state.depositedUSDC = saved.depositedUSDC;
    if (saved.shareBalance !== undefined) this.state.shareBalance = saved.shareBalance;
    if (saved.currentValueUSDC !== undefined) this.state.currentValueUSDC = saved.currentValueUSDC;
    if (saved.totalYieldEarned !== undefined) this.state.totalYieldEarned = saved.totalYieldEarned;
    if (saved.supplyCount !== undefined) this.state.supplyCount = saved.supplyCount;
    if (saved.withdrawCount !== undefined) this.state.withdrawCount = saved.withdrawCount;
    if (saved.lastSupply !== undefined) this.state.lastSupply = saved.lastSupply;
    if (saved.lastWithdraw !== undefined) this.state.lastWithdraw = saved.lastWithdraw;
    if (saved.operations !== undefined) this.state.operations = saved.operations;
    if (saved.enabled !== undefined) this.state.enabled = saved.enabled;
  }

  toJSON() {
    return {
      ...this.state,
      contracts: {
        vault: MORPHO_VAULT,
        usdc: USDC_ADDRESS,
        shareToken: MORPHO_VAULT, // ERC-4626: vault IS the share token
      },
      config: {
        minLiquidUSDC: this.minLiquidUSDC,
        minDepositUSDC: this.minDepositUSDC,
        minWithdrawUSDC: this.minWithdrawUSDC,
      },
    };
  }
}

// Singleton
export const morphoYieldService = new MorphoYieldService();
