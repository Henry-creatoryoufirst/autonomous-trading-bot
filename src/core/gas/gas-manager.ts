/**
 * Never Rest Capital — Gas Manager
 * Extracted from agent-v3.2.ts (Phase 2 refactor)
 *
 * Handles ETH gas balance monitoring, auto-refueling (USDC→WETH swap),
 * gas bootstrapping on first startup, and cross-wallet gas rescue.
 */

import { parseUnits } from 'viem';
import {
  GAS_MIN_ETH_FOR_TRADE,
  GAS_INLINE_TOP_UP_USDC,
} from '../config/constants.js';

// Gas manager constants (values mirror the v21.11 inline gas system in agent-v3.2.ts)
const GAS_REFUEL_THRESHOLD_ETH  = GAS_MIN_ETH_FOR_TRADE;         // 0.003 ETH
const GAS_REFUEL_AMOUNT_USDC    = GAS_INLINE_TOP_UP_USDC;         // $3.00
const GAS_REFUEL_MIN_USDC       = GAS_INLINE_TOP_UP_USDC + 2;    // $5.00 minimum USDC to trigger refuel
const GAS_REFUEL_COOLDOWN_MS    = 60 * 60 * 1000;                 // 1 hour between refuels
const GAS_BOOTSTRAP_MIN_ETH_USD = 5.00;                           // skip bootstrap if ETH already worth $5+
const GAS_BOOTSTRAP_SWAP_USD    = GAS_INLINE_TOP_UP_USDC;         // $3.00 USDC→ETH during bootstrap
const GAS_BOOTSTRAP_MIN_USDC    = GAS_INLINE_TOP_UP_USDC + 7;   // $10.00 minimum USDC to bootstrap

// ============================================================================
// MODULE STATE
// ============================================================================

let lastGasRefuelTime = 0;
let lastKnownETHBalance = 0;
let gasBootstrapAttempted = false;
let gasRescueAttempted = false;

// Injected dependencies
let _cdpClient: any;
let _cdpAccountName: string;
let _getETHBalance: (address: string) => Promise<number>;
let _getERC20Balance: (address: string, wallet: string, decimals: number) => Promise<number>;
let _usdcAddress: string;
let _cdpNetwork: string;
let _walletAddress: string;

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initGasManager(deps: {
  cdpClient: any;
  cdpAccountName: string;
  getETHBalance: (address: string) => Promise<number>;
  getERC20Balance: (address: string, wallet: string, decimals: number) => Promise<number>;
  usdcAddress: string;
  cdpNetwork: string;
  walletAddress: string;
}): void {
  _cdpClient = deps.cdpClient;
  _cdpAccountName = deps.cdpAccountName;
  _getETHBalance = deps.getETHBalance;
  _getERC20Balance = deps.getERC20Balance;
  _usdcAddress = deps.usdcAddress;
  _cdpNetwork = deps.cdpNetwork;
  _walletAddress = deps.walletAddress;
}

// ============================================================================
// AUTO GAS REFUEL — Swap USDC→WETH when ETH gas balance is low
// ============================================================================

export async function checkAndRefuelGas(): Promise<{ refueled: boolean; ethBalance: number; error?: string }> {
  try {
    const account = await _cdpClient.evm.getOrCreateAccount({ name: _cdpAccountName });
    const ethBalance = await _getETHBalance(account.address);
    lastKnownETHBalance = ethBalance;

    if (ethBalance >= GAS_REFUEL_THRESHOLD_ETH) {
      return { refueled: false, ethBalance };
    }

    if (Date.now() - lastGasRefuelTime < GAS_REFUEL_COOLDOWN_MS) {
      return { refueled: false, ethBalance, error: 'Gas refuel on cooldown' };
    }

    const usdcBalance = await _getERC20Balance(_usdcAddress, account.address, 6);
    if (usdcBalance < GAS_REFUEL_MIN_USDC) {
      return { refueled: false, ethBalance, error: `USDC balance ($${usdcBalance.toFixed(2)}) below minimum for gas refuel` };
    }

    console.log(`\n  ⛽ AUTO GAS REFUEL: ETH balance ${ethBalance.toFixed(6)} below threshold ${GAS_REFUEL_THRESHOLD_ETH}`);
    console.log(`     Swapping $${GAS_REFUEL_AMOUNT_USDC.toFixed(2)} USDC → WETH for gas...`);

    const fromAmount = parseUnits(GAS_REFUEL_AMOUNT_USDC.toFixed(6), 6);
    await account.swap({
      network: _cdpNetwork,
      fromToken: _usdcAddress as `0x${string}`,
      toToken: "0x4200000000000000000000000000000000000006" as `0x${string}`,
      fromAmount,
      slippageBps: 100,
    });

    lastGasRefuelTime = Date.now();
    const newEthBalance = await _getETHBalance(account.address);
    lastKnownETHBalance = newEthBalance;
    console.log(`     ✅ Gas refueled: ${ethBalance.toFixed(6)} → ${newEthBalance.toFixed(6)} ETH`);
    return { refueled: true, ethBalance: newEthBalance };
  } catch (err: any) {
    const msg = err?.message?.substring(0, 200) || 'Unknown error';
    console.warn(`  ⛽ Gas refuel failed: ${msg}`);
    return { refueled: false, ethBalance: lastKnownETHBalance, error: msg };
  }
}

// ============================================================================
// GAS RESCUE — Transfer ETH from alternate CDP account
// ============================================================================

export async function rescueGasFromNvrTrading(): Promise<void> {
  if (gasRescueAttempted) return;
  gasRescueAttempted = true;
  try {
    const mainAccount = await _cdpClient.evm.getOrCreateAccount({ name: _cdpAccountName });
    const mainETH = await _getETHBalance(mainAccount.address);

    if (mainETH >= 0.001) {
      console.log(`  [GAS RESCUE] Main wallet has ${mainETH.toFixed(6)} ETH — no rescue needed`);
      return;
    }

    const nvrAccount = await _cdpClient.evm.getOrCreateAccount({ name: "nvr-trading" });
    const nvrETH = await _getETHBalance(nvrAccount.address);

    if (nvrETH < 0.001) {
      console.log(`  [GAS RESCUE] nvr-trading (${nvrAccount.address}) has ${nvrETH.toFixed(6)} ETH — nothing to rescue`);
      return;
    }

    const transferAmount = Math.floor((nvrETH * 0.9) * 1e18);
    console.log(`\n  🚨 [GAS RESCUE] Transferring ${(transferAmount/1e18).toFixed(6)} ETH from nvr-trading → ${mainAccount.address}`);

    const tx = await nvrAccount.sendTransaction({
      network: _cdpNetwork,
      transaction: {
        to: mainAccount.address as `0x${string}`,
        value: BigInt(transferAmount),
      },
    });

    console.log(`  ✅ [GAS RESCUE] ETH transferred! TX: ${(tx as any).transactionHash || 'sent'}`);
    const newBalance = await _getETHBalance(mainAccount.address);
    console.log(`  ✅ [GAS RESCUE] Main wallet ETH: ${newBalance.toFixed(6)}`);
  } catch (err: any) {
    console.warn(`  ⚠️ [GAS RESCUE] Failed: ${err?.message?.substring(0, 200) || 'Unknown'}`);
  }
}

// ============================================================================
// GAS BOOTSTRAP — Auto-buy ETH on first startup
// ============================================================================

export async function bootstrapGas(): Promise<void> {
  try {
    const account = await _cdpClient.evm.getOrCreateAccount({ name: _cdpAccountName });
    const ethBalance = await _getETHBalance(_walletAddress);
    lastKnownETHBalance = ethBalance;

    const ethPriceEstimate = 2700;
    const ethValueUSD = ethBalance * ethPriceEstimate;

    if (ethValueUSD >= GAS_BOOTSTRAP_MIN_ETH_USD) {
      console.log(`  [GAS BOOTSTRAP] Gas OK — ETH balance ${ethBalance.toFixed(6)} (~$${ethValueUSD.toFixed(2)})`);
      gasBootstrapAttempted = true;
      return;
    }

    const usdcBalance = await _getERC20Balance(_usdcAddress, _walletAddress, 6);

    if (usdcBalance < GAS_BOOTSTRAP_MIN_USDC) {
      console.log(`  [GAS BOOTSTRAP] Insufficient USDC for gas bootstrap ($${usdcBalance.toFixed(2)} < $${GAS_BOOTSTRAP_MIN_USDC} minimum)`);
      return;
    }

    console.log(`\n  ⛽ [GAS BOOTSTRAP] ETH balance ${ethBalance.toFixed(6)} (~$${ethValueUSD.toFixed(2)}) below $${GAS_BOOTSTRAP_MIN_ETH_USD} threshold`);
    console.log(`     Swapping $${GAS_BOOTSTRAP_SWAP_USD} USDC → WETH for gas fees...`);

    const fromAmount = parseUnits(GAS_BOOTSTRAP_SWAP_USD.toFixed(6), 6);
    await account.swap({
      network: _cdpNetwork,
      fromToken: _usdcAddress as `0x${string}`,
      toToken: "0x4200000000000000000000000000000000000006" as `0x${string}`,
      fromAmount,
      slippageBps: 100,
    });

    const newEthBalance = await _getETHBalance(_walletAddress);
    lastKnownETHBalance = newEthBalance;
    gasBootstrapAttempted = true;
    lastGasRefuelTime = Date.now();

    console.log(`     ✅ [GAS BOOTSTRAP] Swapped $${GAS_BOOTSTRAP_SWAP_USD} USDC → ETH for gas fees`);
    console.log(`     ETH: ${ethBalance.toFixed(6)} → ${newEthBalance.toFixed(6)} ETH`);
  } catch (err: any) {
    const msg = err?.message?.substring(0, 200) || 'Unknown error';
    console.warn(`  ⛽ [GAS BOOTSTRAP] Failed: ${msg} — will retry next cycle`);
  }
}

// ============================================================================
// ACCESSORS
// ============================================================================

export function getLastKnownETHBalance(): number {
  return lastKnownETHBalance;
}

export function isGasBootstrapAttempted(): boolean {
  return gasBootstrapAttempted;
}
