/**
 * Never Rest Capital — Multi-Protocol Yield Optimizer
 * v21.2: Compare rates across Aave, Compound, Morpho, Moonwell on Base.
 * Move idle USDC to the highest-yielding protocol. Gas on Base is $0.01-0.05,
 * making frequent rebalancing economical.
 *
 * Architecture: Aave (via aave-yield.ts) and Morpho (via morpho-yield.ts) have
 * live deposit/withdraw wiring. Compound & Moonwell are monitored for rates.
 * The optimizer selects the best-yielding active protocol automatically.
 */

import axios from 'axios';
import { aaveYieldService } from './aave-yield.js';
// v21.18 (2026-04-17): the Railway-compat issue that forced a stub here was
// resolved alongside the MorphoYieldService un-stub in agent-v3.2.ts. Same
// singleton is now imported so the optimizer sees real Morpho deposits.
import { morphoYieldService } from './morpho-yield.js';
import {
  YIELD_CHECK_INTERVAL_CYCLES,
  YIELD_MIN_DIFFERENTIAL_PCT,
  YIELD_MIN_IDLE_USD,
  YIELD_AUTO_COMPOUND_INTERVAL_HOURS,
} from '../config/constants.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ProtocolYield {
  protocol: string;        // 'aave' | 'compound' | 'morpho' | 'moonwell'
  apy: number;             // current APY as percentage
  tvl: number;             // total value locked in USD
  deposited: number;       // how much NVR has deposited
  contractAddress: string;
  supplyToken: string;     // receipt token (aUSDC, cUSDC, etc.)
  status: 'active' | 'monitored'; // active = can deposit/withdraw, monitored = rate-watching only
  lastUpdated: string;
}

export interface YieldOptimizerState {
  currentProtocol: string;
  rates: ProtocolYield[];
  lastRateCheck: string | null;
  lastRebalance: string | null;
  rebalanceCount: number;
  checkCount: number;
  errors: string[];
}

// ============================================================================
// PROTOCOL CONTRACTS (Base Mainnet)
// ============================================================================

const PROTOCOLS: Record<string, { contract: string; supplyToken: string; name: string }> = {
  aave:     { contract: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', supplyToken: 'aBasUSDC', name: 'Aave V3' },
  compound: { contract: '0xb125E6687d4313864e53df431d5425969c15Eb2F', supplyToken: 'cUSDCv3',  name: 'Compound V3' },
  morpho:   { contract: '0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2', supplyToken: 'steakUSDC', name: 'Morpho (Steakhouse)' },
  moonwell: { contract: '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22', supplyToken: 'mUSDC',    name: 'Moonwell' },
};

// ============================================================================
// RATE FETCHERS — each returns APY + TVL or null on failure
// ============================================================================

async function fetchAaveRate(): Promise<{ apy: number; tvl: number } | null> {
  try {
    const res = await axios.get('https://aave-api-v2.aave.com/data/rates-history', {
      params: { reserveId: '0x833589fcd6edb6e08f4c7c32d4f71b54bda029130xa238dd80c259a72e81d7e4664a9801593f98d1c5', from: Math.floor(Date.now() / 1000) - 3600, resolutionInHours: 1 },
      timeout: 8000,
    });
    if (res.data && Array.isArray(res.data) && res.data.length > 0) {
      const latest = res.data[res.data.length - 1];
      return { apy: Number(latest.liquidityRate_avg) * 100, tvl: 0 };
    }
  } catch { /* fallback below */ }

  // Fallback: use the existing aave-yield service's stored APY
  const state = aaveYieldService.getState();
  return { apy: state.estimatedAPY || 2.8, tvl: 0 };
}

async function fetchCompoundRate(): Promise<{ apy: number; tvl: number } | null> {
  try {
    const res = await axios.get('https://v3-api.compound.finance/market/base-usdc', { timeout: 8000 });
    if (res.data) {
      const supplyApy = Number(res.data.supply_rate || res.data.supplyApy || 0) * 100;
      const tvl = Number(res.data.total_supply_usd || res.data.tvl || 0);
      if (supplyApy > 0) return { apy: supplyApy, tvl };
    }
  } catch { /* fallback */ }
  return { apy: 3.2, tvl: 0 }; // reasonable fallback
}

async function fetchMorphoRate(): Promise<{ apy: number; tvl: number } | null> {
  try {
    const query = `{
      vaults(where: { chainId: 8453, assetSymbol: "USDC" }, first: 5, orderBy: TotalAssets, orderDirection: Desc) {
        items { address netApy totalAssetsUsd }
      }
    }`;
    const res = await axios.post('https://blue-api.morpho.org/graphql', { query }, { timeout: 8000 });
    const vaults = res.data?.data?.vaults?.items;
    if (vaults && vaults.length > 0) {
      // Pick the largest vault
      const best = vaults[0];
      return { apy: Number(best.netApy) * 100, tvl: Number(best.totalAssetsUsd || 0) };
    }
  } catch { /* fallback */ }
  return { apy: 3.5, tvl: 0 };
}

async function fetchMoonwellRate(): Promise<{ apy: number; tvl: number } | null> {
  try {
    const res = await axios.get('https://api.moonwell.fi/v1/markets', { timeout: 8000 });
    if (res.data && Array.isArray(res.data)) {
      const usdcMarket = res.data.find((m: any) =>
        m.underlyingSymbol === 'USDC' && (m.chainId === 8453 || m.chain === 'base')
      );
      if (usdcMarket) {
        return {
          apy: Number(usdcMarket.supplyApy || usdcMarket.totalSupplyApy || 0) * 100,
          tvl: Number(usdcMarket.totalSupplyUsd || 0),
        };
      }
    }
  } catch { /* fallback */ }
  return { apy: 3.0, tvl: 0 };
}

const RATE_FETCHERS: Record<string, () => Promise<{ apy: number; tvl: number } | null>> = {
  aave: fetchAaveRate,
  compound: fetchCompoundRate,
  morpho: fetchMorphoRate,
  moonwell: fetchMoonwellRate,
};

// ============================================================================
// YIELD OPTIMIZER SERVICE
// ============================================================================

export class YieldOptimizerService {
  private state: YieldOptimizerState = {
    currentProtocol: 'aave',
    rates: [],
    lastRateCheck: null,
    lastRebalance: null,
    rebalanceCount: 0,
    checkCount: 0,
    errors: [],
  };

  // --- Rate Fetching ---

  async getCurrentRates(): Promise<ProtocolYield[]> {
    const results: ProtocolYield[] = [];
    const fetchPromises = Object.entries(RATE_FETCHERS).map(async ([protocol, fetcher]) => {
      try {
        const data = await fetcher();
        if (data) {
          const info = PROTOCOLS[protocol];
          const deposited = protocol === 'aave'
            ? aaveYieldService.getState().depositedUSDC
            : protocol === 'morpho'
              ? morphoYieldService.getDepositedUSDC()
              : 0;
          const isActive = protocol === 'aave' || protocol === 'morpho';
          results.push({
            protocol,
            apy: Math.round(data.apy * 100) / 100,
            tvl: data.tvl,
            deposited,
            contractAddress: info.contract,
            supplyToken: info.supplyToken,
            status: isActive ? 'active' : 'monitored',
            lastUpdated: new Date().toISOString(),
          });
        }
      } catch (err: any) {
        this.addError(`${protocol} rate fetch failed: ${err?.message?.substring(0, 100)}`);
      }
    });

    await Promise.allSettled(fetchPromises);

    // Sort by APY descending
    results.sort((a, b) => b.apy - a.apy);
    this.state.rates = results;
    this.state.lastRateCheck = new Date().toISOString();
    this.state.checkCount++;
    return results;
  }

  async getBestProtocol(): Promise<ProtocolYield | null> {
    const rates = this.state.rates.length > 0 ? this.state.rates : await this.getCurrentRates();
    return rates.length > 0 ? rates[0] : null;
  }

  // --- Rebalance Logic ---

  shouldRebalance(
    currentProtocol: string,
    bestProtocol: ProtocolYield,
    minDifferential: number = YIELD_MIN_DIFFERENTIAL_PCT,
  ): boolean {
    if (bestProtocol.protocol === currentProtocol) return false;

    const currentRate = this.state.rates.find(r => r.protocol === currentProtocol);
    if (!currentRate) return false;

    const differential = bestProtocol.apy - currentRate.apy;
    if (differential < minDifferential) return false;

    // Only rebalance between active protocols (Aave and Morpho have live integrations)
    const activeProtocols = new Set(['aave', 'morpho']);
    if (!activeProtocols.has(bestProtocol.protocol)) {
      // Log intent for monitored-only protocols but don't block
      return true;
    }
    return true;
  }

  /**
   * Returns rebalance instructions for the agent main loop to execute.
   * The optimizer doesn't execute transactions directly — it returns calldata
   * that the agent executes via CDP account.sendTransaction().
   */
  async rebalance(
    from: string,
    to: string,
    amount: number,
  ): Promise<{ success: boolean; txHash?: string; message: string; action?: 'REBALANCE_AAVE_TO_MORPHO' | 'REBALANCE_MORPHO_TO_AAVE' }> {
    const activeProtocols = new Set(['aave', 'morpho']);
    const fromName = PROTOCOLS[from]?.name || from;
    const toName = PROTOCOLS[to]?.name || to;
    const differential = (this.getRate(to) - this.getRate(from)).toFixed(2);

    // Aave → Morpho: withdraw from Aave, deposit to Morpho
    if (from === 'aave' && to === 'morpho') {
      console.log(`  🔄 YIELD OPTIMIZER: Morpho offers +${differential}% better APY — rebalancing $${amount.toFixed(2)}`);
      this.state.currentProtocol = 'morpho';
      this.state.lastRebalance = new Date().toISOString();
      this.state.rebalanceCount++;
      return {
        success: true,
        action: 'REBALANCE_AAVE_TO_MORPHO',
        message: `Rebalance: $${amount.toFixed(2)} Aave → Morpho (+${differential}% APY)`,
      };
    }

    // Morpho → Aave: withdraw from Morpho, deposit to Aave
    if (from === 'morpho' && to === 'aave') {
      console.log(`  🔄 YIELD OPTIMIZER: Aave offers +${differential}% better APY — rebalancing $${amount.toFixed(2)}`);
      this.state.currentProtocol = 'aave';
      this.state.lastRebalance = new Date().toISOString();
      this.state.rebalanceCount++;
      return {
        success: true,
        action: 'REBALANCE_MORPHO_TO_AAVE',
        message: `Rebalance: $${amount.toFixed(2)} Morpho → Aave (+${differential}% APY)`,
      };
    }

    // Non-active protocol — log intent only
    if (!activeProtocols.has(to)) {
      console.log(`  🔄 YIELD OPTIMIZER: ${toName} offers +${differential}% better APY`);
      console.log(`  📋 Would move $${amount.toFixed(2)} from ${fromName} → ${toName} (integration pending)`);
      this.state.lastRebalance = new Date().toISOString();
      this.state.rebalanceCount++;
      return {
        success: true,
        message: `Logged rebalance intent: $${amount.toFixed(2)} ${fromName} → ${toName} (${to} integration pending)`,
      };
    }

    return { success: false, message: 'No rebalance needed (same protocol or no integration)' };
  }

  setCurrentProtocol(protocol: string): void {
    this.state.currentProtocol = protocol;
  }

  // --- Helpers ---

  private getRate(protocol: string): number {
    return this.state.rates.find(r => r.protocol === protocol)?.apy || 0;
  }

  private addError(msg: string): void {
    this.state.errors.push(`[${new Date().toISOString()}] ${msg}`);
    if (this.state.errors.length > 20) {
      this.state.errors = this.state.errors.slice(-20);
    }
    console.warn(`  ⚠️ YieldOptimizer: ${msg}`);
  }

  // --- State ---

  getCurrentProtocol(): string { return this.state.currentProtocol; }
  getRates(): ProtocolYield[] { return [...this.state.rates]; }
  getCheckCount(): number { return this.state.checkCount; }

  getState(): YieldOptimizerState { return { ...this.state }; }

  toJSON() {
    return {
      ...this.state,
      protocols: PROTOCOLS,
      config: {
        checkIntervalCycles: YIELD_CHECK_INTERVAL_CYCLES,
        minDifferentialPct: YIELD_MIN_DIFFERENTIAL_PCT,
        minIdleUsd: YIELD_MIN_IDLE_USD,
        autoCompoundIntervalHours: YIELD_AUTO_COMPOUND_INTERVAL_HOURS,
      },
    };
  }
}

// Singleton
export const yieldOptimizer = new YieldOptimizerService();
