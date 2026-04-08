/**
 * Never Rest Capital — Profit Harvester
 * Extracted from agent-v3.2.ts (Phase 2 refactor)
 *
 * Tiered profit-taking: scans all holdings, finds the best harvest
 * candidate, applies ATR-relative or flat tiers, respects cooldowns,
 * and lets winners run when momentum is strong.
 */

import { ATR_PROFIT_TIERS } from '../config/constants.js';
import type { TechnicalIndicators } from '../../algorithm/indicators.js';

// ============================================================================
// TYPES
// ============================================================================

interface BalanceEntry {
  symbol: string;
  balance: number;
  usdValue: number;
  price?: number;
  sector?: string;
}

interface ProfitTakingConfig {
  enabled: boolean;
  minHoldingUSD: number;
  cooldownHours: number;
  tiers?: Array<{ gainPercent: number; sellPercent: number; label: string }>;
}

interface TradeDecision {
  action: 'SELL';
  fromToken: string;
  toToken: string;
  amountUSD: number;
  tokenAmount?: number;
  reasoning: string;
  sector?: string;
}

export interface ProfitHarvesterDeps {
  state: {
    costBasis: Record<string, any>;
    profitTakeCooldowns: Record<string, string>;
    harvestedProfits: { totalHarvested: number; harvestCount: number; harvests: any[] };
    sanityAlerts: any[];
    trading: { totalPortfolioValue: number };
  };
  config: {
    profitTaking: ProfitTakingConfig;
    autoHarvest?: { minTradingCapitalUSD?: number };
  };
  tokenRegistry: Record<string, any>;
  isTokenBlocked: (symbol: string) => boolean;
  markStateDirty: () => void;
}

// ============================================================================
// PROFIT TAKING
// ============================================================================

export function checkProfitTaking(
  balances: BalanceEntry[],
  indicators: Record<string, TechnicalIndicators>,
  deps: ProfitHarvesterDeps,
): TradeDecision | null {
  const { state, config, tokenRegistry, isTokenBlocked, markStateDirty } = deps;
  if (!config.profitTaking.enabled) return null;

  const cfg = config.profitTaking;
  const flatTiers = cfg.tiers || [
    { gainPercent: 10,  sellPercent: 15, label: "EARLY_HARVEST" },
    { gainPercent: 20,  sellPercent: 20, label: "MID_HARVEST" },
    { gainPercent: 40,  sellPercent: 25, label: "STRONG_HARVEST" },
    { gainPercent: 80,  sellPercent: 35, label: "MAJOR_HARVEST" },
  ];
  const now = new Date();

  let bestCandidate: {
    symbol: string;
    balance: number;
    usdValue: number;
    gainPercent: number;
    tier: { gainPercent: number; sellPercent: number; label: string };
    costBasis: number;
    currentPrice: number;
    sector?: string;
  } | null = null;

  for (const b of balances) {
    if (b.symbol === "USDC" || b.usdValue < cfg.minHoldingUSD) continue;
    if (!tokenRegistry[b.symbol]) continue;
    const cb = state.costBasis[b.symbol];
    if (!cb || cb.averageCostBasis <= 0) continue;
    if (isTokenBlocked(b.symbol)) continue;

    const currentPrice = b.price || (b.balance > 0 ? b.usdValue / b.balance : 0);
    const gainPercent = ((currentPrice - cb.averageCostBasis) / cb.averageCostBasis) * 100;

    if (gainPercent <= 0) continue;

    // Sanity check — >500% gain = stale cost basis
    if (gainPercent > 500) {
      console.warn(`\n  🚨 SANITY CHECK: ${b.symbol} shows +${gainPercent.toFixed(1)}% unrealized gain — likely stale cost basis!`);
      if (!state.sanityAlerts) state.sanityAlerts = [];
      state.sanityAlerts.push({
        timestamp: now.toISOString(), symbol: b.symbol, type: 'STALE_COST_BASIS',
        oldCostBasis: cb.averageCostBasis, currentPrice, gainPercent: Math.round(gainPercent * 10) / 10, action: 'AUTO_RESET',
      });
      if (state.sanityAlerts.length > 100) state.sanityAlerts = state.sanityAlerts.slice(-100);
      cb.averageCostBasis = currentPrice;
      cb.totalInvestedUSD = currentPrice * cb.currentHolding;
      cb.totalTokensAcquired = cb.currentHolding;
      cb.unrealizedPnL = 0;
      cb.firstBuyDate = now.toISOString();
      cb.lastTradeDate = now.toISOString();
      markStateDirty();
      continue;
    }

    // ATR-relative or flat tiers
    const ind = indicators[b.symbol];
    const atrPct = ind?.atrPercent ?? null;
    let effectiveTiers: { gainPercent: number; sellPercent: number; label: string }[];
    if (atrPct !== null && atrPct > 0) {
      effectiveTiers = ATR_PROFIT_TIERS.map(t => ({
        gainPercent: t.atrMultiple * atrPct, sellPercent: t.sellPercent, label: t.label,
      }));
    } else {
      effectiveTiers = flatTiers;
    }

    // Walk tiers highest to lowest
    const sortedTiers = [...effectiveTiers].sort((a, b) => b.gainPercent - a.gainPercent);
    for (const tier of sortedTiers) {
      if (gainPercent >= tier.gainPercent) {
        const cooldownKey = `${b.symbol}:${tier.label}`;
        const lastTrigger = state.profitTakeCooldowns[cooldownKey];
        if (lastTrigger) {
          const hoursSince = (now.getTime() - new Date(lastTrigger).getTime()) / (1000 * 60 * 60);
          if (hoursSince < cfg.cooldownHours) continue;
        }
        if (!bestCandidate || tier.gainPercent > bestCandidate.tier.gainPercent) {
          bestCandidate = {
            symbol: b.symbol, balance: b.balance, usdValue: b.usdValue, gainPercent,
            tier, costBasis: cb.averageCostBasis, currentPrice, sector: b.sector,
          };
        }
        break;
      }
    }

    // Time-based rebalancing: 72+ hours held, up 8%+
    if (!bestCandidate && gainPercent >= 8 && cb.totalInvestedUSD > 0) {
      const holdingAge = cb.firstBuyDate
        ? (now.getTime() - new Date(cb.firstBuyDate).getTime()) / (1000 * 60 * 60)
        : 0;
      if (holdingAge >= 72) {
        const timeKey = `${b.symbol}:TIME_REBALANCE`;
        const lastTimeHarvest = state.profitTakeCooldowns[timeKey];
        if (!lastTimeHarvest || (now.getTime() - new Date(lastTimeHarvest).getTime()) / (1000 * 60 * 60) >= 48) {
          bestCandidate = {
            symbol: b.symbol, balance: b.balance, usdValue: b.usdValue, gainPercent,
            tier: { gainPercent: 15, sellPercent: 10, label: "TIME_REBALANCE" },
            costBasis: cb.averageCostBasis, currentPrice, sector: b.sector,
          };
        }
      }
    }
  }

  if (!bestCandidate) return null;

  // Let winners run — skip if momentum still strong (except MAJOR)
  {
    const ind = indicators[bestCandidate.symbol];
    const orderFlow = ind?.orderFlow;
    const macd = ind?.macd;
    const buyRatio = orderFlow ? orderFlow.buyVolumeUSD / (orderFlow.buyVolumeUSD + orderFlow.sellVolumeUSD) : null;
    const macdBullish = macd?.signal === 'BULLISH';

    if (bestCandidate.tier.label !== 'MAJOR_HARVEST' && bestCandidate.tier.label !== 'ATR_MAJOR') {
      if (buyRatio !== null && buyRatio > 0.55 && macdBullish) {
        console.log(`\n  🏃 LET_IT_RUN: ${bestCandidate.symbol} +${bestCandidate.gainPercent.toFixed(1)}% but momentum still strong (buyRatio: ${(buyRatio * 100).toFixed(0)}%, MACD: BULLISH) — holding`);
        return null;
      }
    }
  }

  const { symbol, balance, usdValue, gainPercent, tier, costBasis, currentPrice, sector } = bestCandidate;
  const sellPct = tier.sellPercent;
  const sellUSD = usdValue * (sellPct / 100);
  const tokenAmount = balance * (sellPct / 100);

  if (sellUSD < 2) return null;

  // Capital floor check
  const capitalFloor = config.autoHarvest?.minTradingCapitalUSD || 500;
  if (state.trading.totalPortfolioValue < capitalFloor) {
    console.log(`  ⚠️ CAPITAL FLOOR: Portfolio $${state.trading.totalPortfolioValue.toFixed(2)} below floor $${capitalFloor} — skipping harvest`);
    return null;
  }

  const tierEmoji = tier.label === "EARLY_HARVEST" ? "🌱" :
                    tier.label === "MID_HARVEST" ? "🌿" :
                    tier.label === "STRONG_HARVEST" ? "🎯" :
                    tier.label === "MAJOR_HARVEST" ? "💰" :
                    tier.label === "TIME_REBALANCE" ? "⏰" : "📊";

  console.log(`\n  ${tierEmoji} ${tier.label}: ${symbol} is UP +${gainPercent.toFixed(1)}% (tier threshold: +${tier.gainPercent}%)`);
  console.log(`     Avg cost: $${costBasis.toFixed(6)} → Current: $${currentPrice.toFixed(6)}`);
  console.log(`     Harvesting ${sellPct}% = ~$${sellUSD.toFixed(2)} → USDC (banking profit)`);

  // Record cooldown
  state.profitTakeCooldowns[`${symbol}:${tier.label}`] = now.toISOString();

  // Track harvested profits
  if (!state.harvestedProfits) {
    state.harvestedProfits = { totalHarvested: 0, harvestCount: 0, harvests: [] };
  }
  const profitPortion = sellUSD - (sellUSD / (1 + gainPercent / 100));
  state.harvestedProfits.totalHarvested += profitPortion;
  state.harvestedProfits.harvestCount++;
  state.harvestedProfits.harvests.push({
    timestamp: now.toISOString(), symbol, tier: tier.label,
    gainPercent: Math.round(gainPercent * 10) / 10, sellPercent: sellPct,
    amountUSD: Math.round(sellUSD * 100) / 100, profitUSD: Math.round(profitPortion * 100) / 100,
  });
  if (state.harvestedProfits.harvests.length > 50) {
    state.harvestedProfits.harvests = state.harvestedProfits.harvests.slice(-50);
  }

  return {
    action: "SELL", fromToken: symbol, toToken: "USDC",
    amountUSD: sellUSD, tokenAmount,
    reasoning: `${tier.label}: ${symbol} +${gainPercent.toFixed(1)}% from avg cost $${costBasis.toFixed(4)}. Harvesting ${sellPct}% (~$${sellUSD.toFixed(2)}) to lock in profit. Remaining ${100 - sellPct}% continues to ride.`,
    sector,
  };
}
