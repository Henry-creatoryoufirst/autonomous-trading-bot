/**
 * Schertzinger Trading Command — Equity Strategy Engine (v6.0)
 *
 * Stock & ETF entry/exit rules using the same framework as crypto.
 * Buy/sell confluence thresholds, sector rebalancing, stop-loss, take-profit.
 * Cross-correlates with crypto Fear & Greed index.
 */

import type { StockIndicators } from '../services/stock-data.js';
import type { AlpacaPosition } from '../services/alpaca-client.js';
import type { SessionInfo } from '../services/market-hours.js';

// ============================================================================
// TYPES
// ============================================================================

export interface EquitySignal {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  amountUSD: number;
  reasoning: string;
  confluenceScore: number;
  confidence: number; // 0.0 to 1.0
  triggerType: 'CONFLUENCE' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'REBALANCE';
}

export interface EquitySectorConfig {
  name: string;
  targetPercent: number;
  symbols: string[];
}

// ============================================================================
// CONFIGURATION
// ============================================================================

export const EQUITY_SECTORS: EquitySectorConfig[] = [
  { name: 'Tech Giants', targetPercent: 40, symbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META'] },
  { name: 'Crypto-Adjacent', targetPercent: 20, symbols: ['COIN', 'BITQ', 'ARKK'] },
  { name: 'AI & Semiconductor', targetPercent: 25, symbols: ['NVDA', 'AMD', 'PLTR', 'TSLA', 'SOXX'] },
  { name: 'Broad Market ETFs', targetPercent: 15, symbols: ['SPY', 'QQQ', 'IWM', 'VTI', 'XLK'] },
];

export const ALL_EQUITY_SYMBOLS = [
  // Stocks
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'COIN', 'PLTR', 'AMD',
  // ETFs
  'SPY', 'QQQ', 'IWM', 'ARKK', 'BITQ', 'VTI', 'XLK', 'SOXX',
];

const EQUITY_CONFIG = {
  /** Minimum confluence score to trigger a BUY signal */
  buyThreshold: 25,
  /** Confluence score to trigger a SELL signal */
  sellThreshold: -25,
  /** Take profit at +12% unrealized gain */
  takeProfitPercent: 12,
  /** Stop loss at -8% unrealized loss */
  stopLossPercent: -8,
  /** Maximum single trade size (USD) */
  maxTradeUSD: 25,
  /** Maximum % of equity portfolio for any single stock */
  maxPositionPercent: 20,
  /** Maximum trades per cycle */
  maxTradesPerCycle: 3,
  /** Sector drift threshold to trigger rebalancing */
  rebalanceThresholdPercent: 10,
};

// ============================================================================
// STRATEGY ENGINE
// ============================================================================

export class EquityStrategyEngine {
  /**
   * Generate equity signals based on technical indicators and portfolio state.
   */
  generateSignals(
    indicators: Record<string, StockIndicators>,
    positions: AlpacaPosition[],
    totalEquityValue: number,
    session: SessionInfo,
    fearGreedIndex: number,
    maxTradeUSD: number = EQUITY_CONFIG.maxTradeUSD,
  ): EquitySignal[] {
    const signals: EquitySignal[] = [];

    if (!session.canTrade) return signals;

    const sessionMultiplier = session.positionSizeMultiplier;

    // 1. Stop-loss signals (highest priority)
    for (const pos of positions) {
      if (pos.unrealizedPnLPercent <= EQUITY_CONFIG.stopLossPercent) {
        signals.push({
          symbol: pos.symbol,
          action: 'SELL',
          amountUSD: pos.marketValue * 0.5, // Sell 50% of position
          reasoning: `Stop-loss: ${pos.symbol} down ${pos.unrealizedPnLPercent.toFixed(1)}% (threshold: ${EQUITY_CONFIG.stopLossPercent}%)`,
          confluenceScore: -100,
          confidence: 1.0,
          triggerType: 'STOP_LOSS',
        });
      }
    }

    // 2. Take-profit signals
    for (const pos of positions) {
      if (pos.unrealizedPnLPercent >= EQUITY_CONFIG.takeProfitPercent) {
        const sellPercent = pos.unrealizedPnLPercent >= 20 ? 0.4 : 0.25;
        signals.push({
          symbol: pos.symbol,
          action: 'SELL',
          amountUSD: pos.marketValue * sellPercent,
          reasoning: `Take-profit: ${pos.symbol} up ${pos.unrealizedPnLPercent.toFixed(1)}% (target: +${EQUITY_CONFIG.takeProfitPercent}%)`,
          confluenceScore: 50,
          confidence: 0.9,
          triggerType: 'TAKE_PROFIT',
        });
      }
    }

    // 3. Confluence-based buy/sell signals
    for (const [symbol, ind] of Object.entries(indicators)) {
      if (!ind || ind.currentPrice === 0) continue;

      // Fear & Greed cross-correlation
      let fgAdjustment = 0;
      if (fearGreedIndex < 25) fgAdjustment = 10;  // Extreme fear → contrarian buy signal
      else if (fearGreedIndex < 40) fgAdjustment = 5;
      else if (fearGreedIndex > 75) fgAdjustment = -10; // Extreme greed → contrarian sell signal
      else if (fearGreedIndex > 60) fgAdjustment = -5;

      const adjustedScore = ind.confluenceScore + fgAdjustment;

      // Check position size limit
      const existingPos = positions.find(p => p.symbol === symbol);
      const currentAllocation = existingPos && totalEquityValue > 0
        ? (existingPos.marketValue / totalEquityValue) * 100
        : 0;

      if (adjustedScore >= EQUITY_CONFIG.buyThreshold && currentAllocation < EQUITY_CONFIG.maxPositionPercent) {
        const confidence = Math.min(1, adjustedScore / 100);
        const tradeSize = Math.min(
          maxTradeUSD * confidence * sessionMultiplier,
          maxTradeUSD
        );

        if (tradeSize >= 5) {
          signals.push({
            symbol,
            action: 'BUY',
            amountUSD: tradeSize,
            reasoning: `Confluence BUY: score ${adjustedScore} (RSI=${ind.rsi14?.toFixed(0) || '?'}, trend=${ind.trendDirection}, F&G adj=${fgAdjustment > 0 ? '+' : ''}${fgAdjustment})`,
            confluenceScore: adjustedScore,
            confidence,
            triggerType: 'CONFLUENCE',
          });
        }
      }

      if (adjustedScore <= EQUITY_CONFIG.sellThreshold && existingPos && existingPos.marketValue > 5) {
        signals.push({
          symbol,
          action: 'SELL',
          amountUSD: existingPos.marketValue * 0.3, // Sell 30%
          reasoning: `Confluence SELL: score ${adjustedScore} (RSI=${ind.rsi14?.toFixed(0) || '?'}, trend=${ind.trendDirection})`,
          confluenceScore: adjustedScore,
          confidence: Math.min(1, Math.abs(adjustedScore) / 100),
          triggerType: 'CONFLUENCE',
        });
      }
    }

    // 4. Sector rebalancing (only during regular hours)
    if (session.session === 'REGULAR' && totalEquityValue > 100) {
      const rebalanceSignals = this.checkSectorRebalance(positions, totalEquityValue, indicators);
      signals.push(...rebalanceSignals);
    }

    // Sort by confidence (descending) and limit to max trades per cycle
    signals.sort((a, b) => b.confidence - a.confidence);
    return signals.slice(0, EQUITY_CONFIG.maxTradesPerCycle);
  }

  /**
   * Check if sectors have drifted and need rebalancing.
   */
  private checkSectorRebalance(
    positions: AlpacaPosition[],
    totalValue: number,
    indicators: Record<string, StockIndicators>,
  ): EquitySignal[] {
    const signals: EquitySignal[] = [];

    for (const sector of EQUITY_SECTORS) {
      const sectorValue = positions
        .filter(p => sector.symbols.includes(p.symbol))
        .reduce((sum, p) => sum + p.marketValue, 0);
      const currentPercent = totalValue > 0 ? (sectorValue / totalValue) * 100 : 0;
      const drift = currentPercent - sector.targetPercent;

      if (Math.abs(drift) > EQUITY_CONFIG.rebalanceThresholdPercent) {
        if (drift > 0) {
          // Over-allocated: sell the weakest performer in this sector
          const sectorPositions = positions
            .filter(p => sector.symbols.includes(p.symbol) && p.marketValue > 5)
            .sort((a, b) => a.unrealizedPnLPercent - b.unrealizedPnLPercent);

          if (sectorPositions.length > 0) {
            const weakest = sectorPositions[0];
            signals.push({
              symbol: weakest.symbol,
              action: 'SELL',
              amountUSD: Math.min(weakest.marketValue * 0.2, 25),
              reasoning: `Rebalance: ${sector.name} over-allocated by ${drift.toFixed(1)}%, trimming ${weakest.symbol}`,
              confluenceScore: 0,
              confidence: 0.6,
              triggerType: 'REBALANCE',
            });
          }
        }
      }
    }

    return signals;
  }

  /**
   * Build an AI prompt section describing the equity portfolio state.
   */
  buildAIPromptSection(
    positions: AlpacaPosition[],
    indicators: Record<string, StockIndicators>,
    session: SessionInfo,
    totalEquityValue: number,
  ): string {
    let prompt = `\n=== EQUITY PORTFOLIO ===\n`;
    prompt += `Session: ${session.session} | Position sizing: ${(session.positionSizeMultiplier * 100).toFixed(0)}%\n`;
    prompt += `Total equity value: $${totalEquityValue.toFixed(2)}\n`;

    if (positions.length > 0) {
      prompt += `\nHoldings:\n`;
      for (const p of positions) {
        prompt += `  ${p.symbol}: $${p.marketValue.toFixed(2)} (${p.unrealizedPnLPercent >= 0 ? '+' : ''}${p.unrealizedPnLPercent.toFixed(1)}%) @ $${p.currentPrice.toFixed(2)}\n`;
      }
    }

    // Top signals
    const buySignals = Object.entries(indicators)
      .filter(([_, ind]) => ind.confluenceScore >= 15)
      .sort((a, b) => b[1].confluenceScore - a[1].confluenceScore)
      .slice(0, 5);

    if (buySignals.length > 0) {
      prompt += `\nBuy signals:\n`;
      for (const [symbol, ind] of buySignals) {
        prompt += `  ${symbol}: score=${ind.confluenceScore}, RSI=${ind.rsi14?.toFixed(0) || '?'}, trend=${ind.trendDirection}\n`;
      }
    }

    return prompt;
  }
}
