/**
 * Never Rest Capital — Aave V3 Yield Service
 * v11.0: Park idle USDC in Aave V3 on Base for yield (~2-5% APY)
 *
 * When the AI brain determines markets are RANGING or FEARFUL and USDC is idle,
 * this service deposits into Aave V3. When the brain needs capital for active
 * trading, it withdraws. Yield accrues automatically via the aBasUSDC token.
 *
 * Contracts (Base Mainnet):
 *   Aave V3 Pool: 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
 *   USDC:         0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 *   aBasUSDC:     0x4e65fE4DBa92790696d040ac24Aa414708F5c0AB
 */

import axios from 'axios';
import { BASE_RPC_ENDPOINTS, BASE_USDC_ADDRESS } from '../config/constants.js';
import { activeChain } from '../config/chain-config.js';

// ============================================================================
// CONTRACT ADDRESSES — chain-aware (v21.3)
// ============================================================================

const AAVE_V3_POOL = activeChain.yieldProtocols.aaveV3?.pool ?? '';
const USDC_ADDRESS = BASE_USDC_ADDRESS;
const ABASUSDC_ADDRESS = activeChain.yieldProtocols.aaveV3?.aUsdc ?? '';
/** Whether Aave V3 is available on the active chain */
export const AAVE_AVAILABLE = !!activeChain.yieldProtocols.aaveV3;
const USDC_DECIMALS = 6;

// Function selectors (Solidity ABI)
const SUPPLY_SELECTOR = '0x617ba037';    // supply(address,uint256,address,uint16)
const WITHDRAW_SELECTOR = '0x69328dec'; // withdraw(address,uint256,address)
const APPROVE_SELECTOR = '0x095ea7b3';  // approve(address,uint256)
const ALLOWANCE_SELECTOR = '0xdd62ed3e'; // allowance(address,address)
const BALANCE_OF_SELECTOR = '0x70a08231'; // balanceOf(address)

const MAX_UINT256 = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

// ============================================================================
// YIELD STATE
// ============================================================================

export interface YieldState {
  /** Whether yield service is active */
  enabled: boolean;
  /** USDC currently deposited in Aave */
  depositedUSDC: number;
  /** Current aBasUSDC balance (includes accrued yield) */
  aTokenBalance: number;
  /** Total yield earned since tracking began */
  totalYieldEarned: number;
  /** Number of supply transactions */
  supplyCount: number;
  /** Number of withdraw transactions */
  withdrawCount: number;
  /** Last supply timestamp */
  lastSupply: string | null;
  /** Last withdraw timestamp */
  lastWithdraw: string | null;
  /** Estimated current APY */
  estimatedAPY: number;
  /** History of yield operations */
  operations: YieldOperation[];
}

export interface YieldOperation {
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
// AAVE YIELD SERVICE
// ============================================================================

export class AaveYieldService {
  private state: YieldState = {
    enabled: false,
    depositedUSDC: 0,
    aTokenBalance: 0,
    totalYieldEarned: 0,
    supplyCount: 0,
    withdrawCount: 0,
    lastSupply: null,
    lastWithdraw: null,
    estimatedAPY: 2.7, // Will be updated from on-chain data
    operations: [],
  };

  /** Minimum USDC to keep liquid for trading (never deposit this) */
  private minLiquidUSDC: number;
  /** Minimum amount to deposit (avoid dust deposits) */
  private minDepositUSDC: number;
  /** Minimum amount to withdraw */
  private minWithdrawUSDC: number;

  constructor(options?: {
    minLiquidUSDC?: number;
    minDepositUSDC?: number;
    minWithdrawUSDC?: number;
  }) {
    this.minLiquidUSDC = options?.minLiquidUSDC ?? 500;  // Keep $500 liquid
    this.minDepositUSDC = options?.minDepositUSDC ?? 50;  // Min $50 deposit
    this.minWithdrawUSDC = options?.minWithdrawUSDC ?? 25; // Min $25 withdraw
  }

  // --- Enable / Disable ---

  enable(): void { this.state.enabled = true; }
  disable(): void { this.state.enabled = false; }
  isEnabled(): boolean { return this.state.enabled; }

  // --- Balance Reads ---

  /**
   * Read the aBasUSDC balance for a wallet (shows deposited USDC + accrued yield).
   */
  async getATokenBalance(walletAddress: string): Promise<number> {
    const data = BALANCE_OF_SELECTOR + padAddress(walletAddress);
    const result = await rpcCall('eth_call', [
      { to: ABASUSDC_ADDRESS, data }, 'latest',
    ]);
    if (!result || result === '0x' || result === '0x0') return 0;
    return Number(BigInt(result)) / Math.pow(10, USDC_DECIMALS);
  }

  /**
   * Read current USDC allowance for Aave Pool.
   */
  async getAllowance(walletAddress: string): Promise<bigint> {
    const data = ALLOWANCE_SELECTOR + padAddress(walletAddress) + padAddress(AAVE_V3_POOL);
    const result = await rpcCall('eth_call', [
      { to: USDC_ADDRESS, data }, 'latest',
    ]);
    if (!result || result === '0x') return 0n;
    return BigInt(result);
  }

  // --- Supply (Deposit USDC into Aave) ---

  /**
   * Determine how much USDC should be deposited based on current conditions.
   * Returns 0 if no deposit should be made.
   */
  calculateDepositAmount(
    usdcBalance: number,
    marketRegime: string,
    fearGreedValue: number,
  ): number {
    if (!this.state.enabled) return 0;

    // Keep minimum liquid for trading
    const available = usdcBalance - this.minLiquidUSDC;
    if (available < this.minDepositUSDC) return 0;

    // Yield allocation percentage based on market conditions
    let yieldAllocationPct = 0;

    if (marketRegime === 'RANGING' || marketRegime === 'UNKNOWN') {
      // Ranging market — park 40-60% in yield
      yieldAllocationPct = fearGreedValue < 30 ? 0.60 : 0.40;
    } else if (marketRegime === 'TRENDING_DOWN') {
      // Downtrend — park 50-70% in yield (capital preservation)
      yieldAllocationPct = fearGreedValue < 25 ? 0.70 : 0.50;
    } else if (marketRegime === 'VOLATILE') {
      // Volatile — keep more liquid for opportunities, 20-30% to yield
      yieldAllocationPct = 0.25;
    } else if (marketRegime === 'TRENDING_UP') {
      // Uptrend — keep most liquid for active trading, 10-20% to yield
      yieldAllocationPct = 0.15;
    }

    const targetDeposit = available * yieldAllocationPct;

    // Account for already deposited amount
    const alreadyDeposited = this.state.depositedUSDC;
    const totalTarget = (usdcBalance * yieldAllocationPct);
    const additionalNeeded = totalTarget - alreadyDeposited;

    if (additionalNeeded < this.minDepositUSDC) return 0;

    // Cap at available balance
    return Math.min(Math.floor(additionalNeeded * 100) / 100, available);
  }

  /**
   * Determine how much to withdraw based on market conditions.
   * Returns 0 if no withdrawal needed.
   */
  calculateWithdrawAmount(
    usdcBalance: number,
    marketRegime: string,
    fearGreedValue: number,
    aiNeedsCapital: boolean,
  ): number {
    if (this.state.aTokenBalance < this.minWithdrawUSDC) return 0;

    // If AI explicitly needs capital (e.g., strong BUY signal but insufficient USDC)
    if (aiNeedsCapital && usdcBalance < this.minLiquidUSDC) {
      // Withdraw enough to meet minimum liquid + some buffer
      const needed = this.minLiquidUSDC * 1.5 - usdcBalance;
      return Math.min(needed, this.state.aTokenBalance);
    }

    // In strong uptrend, pull back from yield to deploy
    if (marketRegime === 'TRENDING_UP' && fearGreedValue > 60) {
      // Withdraw up to 50% of deposited
      const targetWithdraw = this.state.aTokenBalance * 0.5;
      return targetWithdraw >= this.minWithdrawUSDC ? targetWithdraw : 0;
    }

    return 0;
  }

  /**
   * Build the supply transaction calldata.
   * Caller (agent-v3.2.ts) executes via account.sendTransaction().
   */
  buildSupplyCalldata(amountUSDC: number, walletAddress: string): {
    to: string;
    data: string;
    approvalNeeded: boolean;
    approvalTo: string;
    approvalData: string;
  } {
    const amountRaw = BigInt(Math.floor(amountUSDC * 1e6));

    // supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)
    const supplyData = SUPPLY_SELECTOR +
      padAddress(USDC_ADDRESS) +
      encodeUint256(amountRaw) +
      padAddress(walletAddress) +
      encodeUint256(0n); // referralCode = 0

    // approve(address spender, uint256 amount) — approve Aave Pool to spend USDC
    const approveData = APPROVE_SELECTOR +
      padAddress(AAVE_V3_POOL) +
      MAX_UINT256;

    return {
      to: AAVE_V3_POOL,
      data: supplyData,
      approvalNeeded: true, // Caller should check allowance first
      approvalTo: USDC_ADDRESS,
      approvalData: approveData,
    };
  }

  /**
   * Build the withdraw transaction calldata.
   */
  buildWithdrawCalldata(amountUSDC: number, walletAddress: string): {
    to: string;
    data: string;
  } {
    // Use max uint256 to withdraw all if amount >= deposited
    const amountRaw = amountUSDC >= this.state.aTokenBalance
      ? BigInt('0x' + MAX_UINT256)
      : BigInt(Math.floor(amountUSDC * 1e6));

    // withdraw(address asset, uint256 amount, address to)
    const data = WITHDRAW_SELECTOR +
      padAddress(USDC_ADDRESS) +
      encodeUint256(amountRaw) +
      padAddress(walletAddress);

    return { to: AAVE_V3_POOL, data };
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
      reason: reason || 'Yield optimization',
    });
    // Cap operations history
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
   * Refresh aToken balance and calculate accrued yield.
   */
  async refreshBalance(walletAddress: string): Promise<void> {
    try {
      const aTokenBal = await this.getATokenBalance(walletAddress);
      const previousBalance = this.state.aTokenBalance;
      this.state.aTokenBalance = aTokenBal;

      // Yield = current aToken balance - total deposited (deposits minus withdrawals)
      const yieldAccrued = aTokenBal - this.state.depositedUSDC;
      if (yieldAccrued > 0) {
        this.state.totalYieldEarned = yieldAccrued;
      }
    } catch (err: any) {
      // Non-critical — yield tracking is supplementary
      console.warn(`  ⚠️ Aave yield balance check failed: ${err.message?.substring(0, 100)}`);
    }
  }

  // --- Persistence ---

  getState(): YieldState {
    return { ...this.state };
  }

  restoreState(saved: Partial<YieldState>): void {
    if (saved.depositedUSDC !== undefined) this.state.depositedUSDC = saved.depositedUSDC;
    if (saved.aTokenBalance !== undefined) this.state.aTokenBalance = saved.aTokenBalance;
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
        pool: AAVE_V3_POOL,
        usdc: USDC_ADDRESS,
        aBasUSDC: ABASUSDC_ADDRESS,
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
export const aaveYieldService = new AaveYieldService();
