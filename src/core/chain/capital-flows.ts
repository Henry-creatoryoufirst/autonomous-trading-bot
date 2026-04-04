/**
 * Never Rest Capital — On-Chain Capital Flow Detection
 * Extracted from agent-v3.2.ts (Phase 14 refactor)
 *
 * Queries Blockscout for USDC transfers, identifies deposits vs DEX swaps,
 * and pairs transfers into trade records.
 */

import axios from "axios";
import type { TradeRecord } from "../../types/index.js";
import type { OnChainCapitalFlows, BasescanTransfer } from "../../types/services.js";

const BLOCKSCOUT_API_URL = 'https://base.blockscout.com/api';

// Module-level cache
let cachedCapitalFlows: OnChainCapitalFlows | null = null;
let capitalFlowsLastFetched = 0;
const CAPITAL_FLOWS_CACHE_MS = 10 * 60 * 1000;

export async function detectOnChainCapitalFlows(
  walletAddress: string,
  usdcAddress: string,
  forceRefresh = false,
): Promise<OnChainCapitalFlows> {
  if (!forceRefresh && cachedCapitalFlows && (Date.now() - capitalFlowsLastFetched) < CAPITAL_FLOWS_CACHE_MS) {
    return cachedCapitalFlows;
  }

  const wallet = walletAddress.toLowerCase();
  const transfers = await fetchBlockscoutTransfers(walletAddress);

  const txGroups = new Map<string, BasescanTransfer[]>();
  for (const t of transfers) {
    const group = txGroups.get(t.hash) || [];
    group.push(t);
    txGroups.set(t.hash, group);
  }

  const dexRouters = new Set<string>();
  for (const [, group] of txGroups) {
    const hasIn = group.some(t => t.to.toLowerCase() === wallet);
    const hasOut = group.some(t => t.from.toLowerCase() === wallet);
    if (hasIn && hasOut) {
      for (const t of group) {
        if (t.to.toLowerCase() !== wallet) dexRouters.add(t.to.toLowerCase());
        if (t.from.toLowerCase() !== wallet) dexRouters.add(t.from.toLowerCase());
      }
    }
  }

  const deposits: OnChainCapitalFlows['deposits'] = [];
  const withdrawals: OnChainCapitalFlows['withdrawals'] = [];

  for (const t of transfers) {
    if (t.contractAddress.toLowerCase() !== usdcAddress) continue;
    const value = parseFloat(t.value) / Math.pow(10, parseInt(t.tokenDecimal));
    if (value < 1) continue;

    const txGroup = txGroups.get(t.hash) || [];
    const timestamp = new Date(parseInt(t.timeStamp) * 1000).toISOString();

    if (t.to.toLowerCase() === wallet) {
      const hasOutgoing = txGroup.some(g => g.from.toLowerCase() === wallet);
      const fromAddr = t.from.toLowerCase();
      if (!hasOutgoing && !dexRouters.has(fromAddr)) {
        deposits.push({ timestamp, amountUSD: value, from: fromAddr, txHash: t.hash });
      }
    } else if (t.from.toLowerCase() === wallet) {
      const hasIncomingNonUSDC = txGroup.some(g =>
        g.to.toLowerCase() === wallet && g.contractAddress.toLowerCase() !== usdcAddress
      );
      const toAddr = t.to.toLowerCase();
      if (!hasIncomingNonUSDC && !dexRouters.has(toAddr)) {
        withdrawals.push({ timestamp, amountUSD: value, to: toAddr, txHash: t.hash });
      }
    }
  }

  const totalDeposited = deposits.reduce((s, d) => s + d.amountUSD, 0);
  const totalWithdrawn = withdrawals.reduce((s, w) => s + w.amountUSD, 0);

  const result: OnChainCapitalFlows = {
    totalDeposited: Math.round(totalDeposited * 100) / 100,
    totalWithdrawn: Math.round(totalWithdrawn * 100) / 100,
    netCapitalIn: Math.round((totalDeposited - totalWithdrawn) * 100) / 100,
    deposits,
    withdrawals,
    lastUpdated: new Date().toISOString(),
  };

  cachedCapitalFlows = result;
  capitalFlowsLastFetched = Date.now();
  console.log(`  💰 [ON-CHAIN] Deposits: $${result.totalDeposited.toFixed(2)} (${deposits.length} txs) | Withdrawals: $${result.totalWithdrawn.toFixed(2)} (${withdrawals.length} txs) | Net: $${result.netCapitalIn.toFixed(2)}`);

  return result;
}

export async function fetchBlockscoutTransfers(walletAddress: string): Promise<BasescanTransfer[]> {
  const allTransfers: BasescanTransfer[] = [];
  let page = 1;
  const pageSize = 100;
  const maxPages = 30;

  while (page <= maxPages) {
    try {
      const url = `${BLOCKSCOUT_API_URL}?module=account&action=tokentx&address=${walletAddress}&page=${page}&offset=${pageSize}&sort=asc`;
      const response = await axios.get(url, { timeout: 15000 });
      if (response.data.status !== '1' || !Array.isArray(response.data.result)) {
        if (response.data.message === 'No transactions found' || response.data.message === 'No token transfers found') break;
        console.log(`  ⚠️ Blockscout API page ${page}: ${response.data.message || 'Unknown error'}`);
        break;
      }
      allTransfers.push(...response.data.result);
      if (response.data.result.length < pageSize) break;
      page++;
      await new Promise(r => setTimeout(r, 200));
    } catch (err: any) {
      console.log(`  ⚠️ Blockscout fetch stopped at page ${page}: ${err.message?.substring(0, 80)}`);
      break;
    }
  }
  return allTransfers;
}

export function pairTransfersIntoTrades(
  transfers: BasescanTransfer[],
  walletAddress: string,
  usdcAddress: string,
  addressToSymbol: Record<string, string>,
  tokenRegistry: Record<string, { sector?: string; [key: string]: any }>,
): TradeRecord[] {
  const wallet = walletAddress.toLowerCase();
  const trades: TradeRecord[] = [];

  const txGroups = new Map<string, BasescanTransfer[]>();
  for (const t of transfers) {
    const group = txGroups.get(t.hash) || [];
    group.push(t);
    txGroups.set(t.hash, group);
  }

  for (const [txHash, group] of txGroups) {
    const outgoing: BasescanTransfer[] = [];
    const incoming: BasescanTransfer[] = [];
    for (const t of group) {
      if (t.from.toLowerCase() === wallet) outgoing.push(t);
      if (t.to.toLowerCase() === wallet) incoming.push(t);
    }

    if (outgoing.length === 0 || incoming.length === 0) continue;

    const timestamp = new Date(parseInt(group[0].timeStamp) * 1000).toISOString();

    const usdcOut = outgoing.find(t => t.contractAddress.toLowerCase() === usdcAddress);
    const usdcIn = incoming.find(t => t.contractAddress.toLowerCase() === usdcAddress);
    const tokenIn = incoming.find(t => t.contractAddress.toLowerCase() !== usdcAddress);
    const tokenOut = outgoing.find(t => t.contractAddress.toLowerCase() !== usdcAddress);

    const defaultContext = {
      marketRegime: 'UNKNOWN' as const, confluenceScore: 0, rsi: null, macdSignal: null,
      btcFundingRate: null, ethFundingRate: null, baseTVLChange24h: null, baseDEXVolume24h: null, triggeredBy: 'AI' as const,
    };

    if (usdcOut && tokenIn) {
      const usdcAmount = parseFloat(usdcOut.value) / Math.pow(10, parseInt(usdcOut.tokenDecimal));
      const tokenAmount = parseFloat(tokenIn.value) / Math.pow(10, parseInt(tokenIn.tokenDecimal));
      const tokenSymbol = addressToSymbol[tokenIn.contractAddress.toLowerCase()] || tokenIn.tokenSymbol;

      trades.push({
        timestamp, cycle: 0, action: 'BUY', fromToken: 'USDC', toToken: tokenSymbol,
        amountUSD: usdcAmount, tokenAmount, txHash, success: true, portfolioValueBefore: 0,
        reasoning: `On-chain recovery: bought ${tokenAmount.toFixed(6)} ${tokenSymbol} for $${usdcAmount.toFixed(2)}`,
        sector: tokenRegistry[tokenSymbol]?.sector || undefined,
        marketConditions: { fearGreed: 0, ethPrice: 0, btcPrice: 0 },
        signalContext: defaultContext,
      });
    } else if (tokenOut && usdcIn) {
      const usdcAmount = parseFloat(usdcIn.value) / Math.pow(10, parseInt(usdcIn.tokenDecimal));
      const tokenAmount = parseFloat(tokenOut.value) / Math.pow(10, parseInt(tokenOut.tokenDecimal));
      const tokenSymbol = addressToSymbol[tokenOut.contractAddress.toLowerCase()] || tokenOut.tokenSymbol;

      trades.push({
        timestamp, cycle: 0, action: 'SELL', fromToken: tokenSymbol, toToken: 'USDC',
        amountUSD: usdcAmount, tokenAmount, txHash, success: true, portfolioValueBefore: 0,
        reasoning: `On-chain recovery: sold ${tokenAmount.toFixed(6)} ${tokenSymbol} for $${usdcAmount.toFixed(2)}`,
        sector: tokenRegistry[tokenSymbol]?.sector || undefined,
        marketConditions: { fearGreed: 0, ethPrice: 0, btcPrice: 0 },
        signalContext: defaultContext,
      });
    }
  }

  return trades;
}
