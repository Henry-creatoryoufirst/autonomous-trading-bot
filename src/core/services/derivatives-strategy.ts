/**
 * Derivatives Strategy Engine v1.0
 *
 * Translates the existing v5.x technical analysis brain into derivatives positions.
 * The same confluence scoring, RSI, MACD, Bollinger Bands, market regime detection,
 * and AI decision engine feed into this module — but instead of on-chain spot swaps,
 * it executes perpetual futures and commodity futures through Coinbase Advanced Trade.
 *
 * Architecture:
 *   Existing Brain (confluence, indicators, regime, macro)
 *       ↓
 *   Derivatives Strategy Engine (this file)
 *       ↓
 *   CoinbaseAdvancedTradeClient (services/coinbase-advanced-trade.ts)
 *       ↓
 *   Coinbase Advanced Trade API (orders, positions, margin)
 *
 * Position Types:
 *   - BTC Perpetual (BTC-PERP-INTX) — express directional conviction via long/short
 *   - ETH Perpetual (ETH-PERP-INTX) — express directional conviction via long/short
 *   - Gold Futures (GC contracts on CDE) — macro hedge, flight-to-safety
 *   - Silver Futures (SI contracts on CDE) — macro hedge, industrial demand
 *
 * Risk Controls:
 *   - Max leverage: 3x (configurable, never exceeds account max)
 *   - Max position size: 30% of derivatives buying power per position
 *   - Max total exposure: 80% of derivatives buying power
 *   - Liquidation buffer: Auto-reduce if within 20% of liquidation price
 *   - Funding rate monitor: Warn/reduce if funding costs exceed threshold
 *   - Stop-loss: Automatic close at configured loss percentage
 *   - Position cooldown: Minimum 30 minutes between trades on same product
 */

import {
  CoinbaseAdvancedTradeClient,
  DerivativesPortfolioState,
  Position,
  OrderSide,
  OrderResponse,
} from "./coinbase-advanced-trade.js";

// ============================================================================
// TYPES
// ============================================================================

export interface DerivativesConfig {
  enabled: boolean;

  // Products to trade
  products: {
    perpetuals: string[];     // e.g., ["BTC-PERP-INTX", "ETH-PERP-INTX"]
    commodityFutures: string[]; // e.g., ["GCJ6-USD", "SIH6-USD"] — updated monthly
  };

  // Risk parameters
  risk: {
    maxLeverage: number;              // Maximum leverage per position (default: 3)
    maxPositionPercent: number;       // Max % of buying power per position (default: 30)
    maxTotalExposurePercent: number;  // Max % of total buying power used (default: 80)
    stopLossPercent: number;          // Auto-close at this % loss (default: -10)
    takeProfitPercent: number;        // Auto-take-profit at this % gain (default: 15)
    liquidationBufferPercent: number; // Reduce if within this % of liquidation (default: 20)
    maxFundingRateBps: number;        // Warn if funding rate exceeds this (default: 30 = 0.3%)
    positionCooldownMinutes: number;  // Min time between trades on same product (default: 30)
    maxOpenPositions: number;         // Maximum simultaneous open positions (default: 4)
  };

  // Signal thresholds — when existing brain signals trigger derivatives actions
  signals: {
    strongBullishThreshold: number;    // Confluence >= this → open/add long (default: 45)
    bullishThreshold: number;          // Confluence >= this → open small long (default: 30)
    strongBearishThreshold: number;    // Confluence <= this → open/add short (default: -45)
    bearishThreshold: number;          // Confluence <= this → open small short (default: -30)
    neutralZone: number;               // |confluence| < this → close positions, go flat (default: 15)
    commodityBullishThreshold: number; // Macro signal strength for commodity buys (default: 0.6)
    commodityBearishThreshold: number; // Macro signal strength for commodity sells (default: -0.6)
  };

  // Position sizing
  sizing: {
    basePositionUSD: number;          // Default position size in USD (default: 50)
    minPositionUSD: number;           // Minimum trade size (default: 10)
    maxPositionUSD: number;           // Maximum single trade size (default: 200)
    confidenceMultiplier: boolean;    // Scale size by signal confidence (default: true)
  };
}

export interface DerivativesSignal {
  product: string;            // Product ID (e.g., "BTC-PERP-INTX")
  direction: "LONG" | "SHORT" | "FLAT" | "HOLD";
  confidence: number;         // 0-100
  leverage: number;           // Suggested leverage (1-maxLeverage)
  sizeUSD: number;            // Suggested position size in USD
  reasoning: string;          // Human-readable explanation
  source: "TECHNICAL" | "MACRO" | "AI" | "RISK_MANAGEMENT";
  urgency: "HIGH" | "MEDIUM" | "LOW";
}

export interface DerivativesTradeRecord {
  timestamp: string;
  product: string;
  action: "OPEN_LONG" | "OPEN_SHORT" | "CLOSE_LONG" | "CLOSE_SHORT" | "ADD_LONG" | "ADD_SHORT" | "REDUCE" | "STOP_LOSS" | "TAKE_PROFIT" | "FUNDING_EXIT" | "LIQUIDATION_PREVENT";
  sizeUSD: number;
  leverage: number;
  entryPrice?: number;
  exitPrice?: number;
  pnl?: number;
  orderId?: string;
  success: boolean;
  error?: string;
  reasoning: string;
  signalContext: {
    confluenceScore: number;
    marketRegime: string;
    macroSignal?: string;
    fundingRate?: number;
    rsi?: number;
  };
}

interface PositionCooldown {
  product: string;
  lastTradeTime: number;
}

// Macro signal data for commodity futures decisions
export interface MacroCommoditySignal {
  goldSignal: number;         // -1 to +1 (negative = bearish, positive = bullish)
  silverSignal: number;       // -1 to +1
  reasoning: string;
  components: {
    dollarIndex: { value: number; signal: number; direction: string };
    realYields: { value: number; signal: number; direction: string };
    vixLevel: { value: number; signal: number; riskSentiment: string };
    goldPrice: { value: number; change24h: number };
    silverPrice: { value: number; change24h: number };
    spx: { value: number; change24h: number; signal: number };
  };
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

export const DEFAULT_DERIVATIVES_CONFIG: DerivativesConfig = {
  enabled: false, // Must be explicitly enabled via env var

  products: {
    perpetuals: ["BTC-PERP-INTX", "ETH-PERP-INTX"],
    commodityFutures: [], // Populated dynamically based on available contracts
  },

  risk: {
    maxLeverage: 3,
    maxPositionPercent: 30,
    maxTotalExposurePercent: 80,
    stopLossPercent: -10,
    takeProfitPercent: 15,
    liquidationBufferPercent: 20,
    maxFundingRateBps: 30,
    positionCooldownMinutes: 30,
    maxOpenPositions: 4,
  },

  signals: {
    strongBullishThreshold: 45,
    bullishThreshold: 30,
    strongBearishThreshold: -45,
    bearishThreshold: -30,
    neutralZone: 15,
    commodityBullishThreshold: 0.6,
    commodityBearishThreshold: -0.6,
  },

  sizing: {
    basePositionUSD: 50,
    minPositionUSD: 10,
    maxPositionUSD: 200,
    confidenceMultiplier: true,
  },
};

// ============================================================================
// DERIVATIVES STRATEGY ENGINE
// ============================================================================

export class DerivativesStrategyEngine {
  private client: CoinbaseAdvancedTradeClient;
  private config: DerivativesConfig;
  private state: DerivativesPortfolioState | null = null;
  private tradeHistory: DerivativesTradeRecord[] = [];
  private cooldowns: PositionCooldown[] = [];
  private lastCycleTime: number = 0;

  constructor(client: CoinbaseAdvancedTradeClient, config?: Partial<DerivativesConfig>) {
    this.client = client;
    this.config = { ...DEFAULT_DERIVATIVES_CONFIG, ...config };
  }

  // --------------------------------------------------------------------------
  // SIGNAL GENERATION — Translates existing brain outputs to derivatives signals
  // --------------------------------------------------------------------------

  /**
   * Generate derivatives trading signals from the existing technical analysis.
   * This is the core bridge between the spot trading brain and derivatives execution.
   *
   * @param indicators - Technical indicators from the main bot (per token)
   * @param marketRegime - Current market regime from main bot
   * @param macroData - Macro economic data from main bot
   * @param derivatives - Binance derivatives data from main bot
   * @param fearGreed - Fear & Greed index from main bot
   * @param commoditySignal - Macro commodity signal (optional, for gold/silver)
   */
  generateSignals(params: {
    indicators: Record<string, any>;  // TechnicalIndicators from main bot
    marketRegime: string;
    macroSignal?: string;             // "RISK_ON" | "RISK_OFF" | "NEUTRAL"
    derivatives?: any;                // DerivativesData from main bot (Binance funding/OI)
    fearGreed?: { value: number; classification: string };
    commoditySignal?: MacroCommoditySignal;
    aiRecommendation?: { direction: string; confidence: number; reasoning: string };
  }): DerivativesSignal[] {
    const signals: DerivativesSignal[] = [];

    // === CRYPTO PERPETUALS SIGNALS ===
    // Use BTC indicators as primary signal for BTC-PERP
    // Use ETH indicators as primary signal for ETH-PERP
    for (const perpProduct of this.config.products.perpetuals) {
      const symbol = perpProduct.startsWith("BTC") ? "ETH" : // BTC perp uses ETH as proxy if no direct cbBTC indicator
                     perpProduct.startsWith("ETH") ? "ETH" : null;

      // Try cbBTC first for BTC perp, fall back to ETH as overall market proxy
      const btcIndicator = params.indicators["cbBTC"] || params.indicators["ETH"];
      const ethIndicator = params.indicators["ETH"];
      const indicator = perpProduct.startsWith("BTC") ? btcIndicator : ethIndicator;

      if (!indicator) continue;

      const confluence = indicator.confluenceScore || 0;
      const rsi = indicator.rsi14;
      const macdSignal = indicator.macd?.signal;
      const trend = indicator.trendDirection;

      // Determine direction based on confluence + regime
      let direction: "LONG" | "SHORT" | "FLAT" | "HOLD" = "HOLD";
      let confidence = Math.abs(confluence);
      let urgency: "HIGH" | "MEDIUM" | "LOW" = "LOW";
      let reasoning: string[] = [];

      // Strong bullish
      if (confluence >= this.config.signals.strongBullishThreshold) {
        direction = "LONG";
        urgency = "HIGH";
        reasoning.push(`Strong bullish confluence (+${confluence})`);
      }
      // Moderate bullish
      else if (confluence >= this.config.signals.bullishThreshold) {
        direction = "LONG";
        urgency = "MEDIUM";
        reasoning.push(`Bullish confluence (+${confluence})`);
      }
      // Strong bearish
      else if (confluence <= this.config.signals.strongBearishThreshold) {
        direction = "SHORT";
        urgency = "HIGH";
        reasoning.push(`Strong bearish confluence (${confluence})`);
      }
      // Moderate bearish
      else if (confluence <= this.config.signals.bearishThreshold) {
        direction = "SHORT";
        urgency = "MEDIUM";
        reasoning.push(`Bearish confluence (${confluence})`);
      }
      // Neutral zone — flatten positions
      else if (Math.abs(confluence) < this.config.signals.neutralZone) {
        direction = "FLAT";
        urgency = "LOW";
        reasoning.push(`Neutral zone (confluence ${confluence}), flatten`);
      }

      // Regime adjustments
      if (params.marketRegime === "TRENDING_DOWN" && direction === "LONG") {
        confidence *= 0.7; // Reduce conviction for longs in downtrend
        reasoning.push("Downtrend regime reduces long conviction");
      }
      if (params.marketRegime === "TRENDING_UP" && direction === "SHORT") {
        confidence *= 0.7; // Reduce conviction for shorts in uptrend
        reasoning.push("Uptrend regime reduces short conviction");
      }
      if (params.marketRegime === "VOLATILE") {
        confidence *= 0.6; // Reduce all conviction in volatile regime
        reasoning.push("Volatile regime — reduced sizing");
      }

      // Macro overlay
      if (params.macroSignal === "RISK_OFF" && direction === "LONG") {
        confidence *= 0.8;
        reasoning.push("RISK_OFF macro reduces long conviction");
      }
      if (params.macroSignal === "RISK_ON" && direction === "SHORT") {
        confidence *= 0.8;
        reasoning.push("RISK_ON macro reduces short conviction");
      }
      if (params.macroSignal === "RISK_OFF" && direction === "SHORT") {
        confidence *= 1.15; // Amplify short conviction in risk-off
        reasoning.push("RISK_OFF macro amplifies short conviction");
      }

      // Funding rate check — avoid positions where funding works against you
      if (params.derivatives) {
        const fundingRate = perpProduct.startsWith("BTC")
          ? params.derivatives.btcFundingRate
          : params.derivatives.ethFundingRate;

        if (fundingRate !== null && fundingRate !== undefined) {
          const fundingBps = Math.abs(fundingRate * 10000);
          if (fundingBps > this.config.risk.maxFundingRateBps) {
            if ((fundingRate > 0 && direction === "LONG") || (fundingRate < 0 && direction === "SHORT")) {
              confidence *= 0.5;
              reasoning.push(`High funding rate against position (${(fundingRate * 100).toFixed(4)}%)`);
            } else {
              confidence *= 1.1; // Funding works in our favor
              reasoning.push(`Funding rate favors our direction (${(fundingRate * 100).toFixed(4)}%)`);
            }
          }
        }
      }

      // Fear & Greed amplifier (same logic as spot bot)
      if (params.fearGreed) {
        if (params.fearGreed.value < 25 && direction === "LONG") {
          confidence *= 1.2; // Extreme fear = contrarian buy
          reasoning.push(`Extreme fear (${params.fearGreed.value}) amplifies long`);
        }
        if (params.fearGreed.value > 75 && direction === "SHORT") {
          confidence *= 1.2; // Extreme greed = contrarian sell
          reasoning.push(`Extreme greed (${params.fearGreed.value}) amplifies short`);
        }
      }

      // AI recommendation integration
      if (params.aiRecommendation) {
        const aiDir = params.aiRecommendation.direction?.toUpperCase();
        if ((aiDir === "LONG" || aiDir === "BUY") && direction === "LONG") {
          confidence *= 1.1;
          reasoning.push("AI concurs with long");
        } else if ((aiDir === "SHORT" || aiDir === "SELL") && direction === "SHORT") {
          confidence *= 1.1;
          reasoning.push("AI concurs with short");
        } else if (aiDir && aiDir !== "HOLD" && direction !== "HOLD" && direction !== "FLAT") {
          confidence *= 0.7;
          reasoning.push(`AI disagrees (AI says ${aiDir}, signal says ${direction})`);
        }
      }

      // Calculate position size
      const sizeUSD = this.calculatePositionSize(direction, confidence);
      const leverage = this.calculateLeverage(confidence, params.marketRegime);

      if (direction !== "HOLD") {
        signals.push({
          product: perpProduct,
          direction,
          confidence: Math.min(confidence, 100),
          leverage,
          sizeUSD,
          reasoning: reasoning.join(" | "),
          source: "TECHNICAL",
          urgency,
        });
      }
    }

    // === COMMODITY FUTURES SIGNALS ===
    if (params.commoditySignal && this.config.products.commodityFutures.length > 0) {
      // Gold signal
      const goldProducts = this.config.products.commodityFutures.filter(p => p.startsWith("GC"));
      if (goldProducts.length > 0 && Math.abs(params.commoditySignal.goldSignal) >= this.config.signals.commodityBullishThreshold) {
        const goldDirection = params.commoditySignal.goldSignal > 0 ? "LONG" : "SHORT";
        const goldConfidence = Math.abs(params.commoditySignal.goldSignal) * 100;
        const goldSize = this.calculatePositionSize(goldDirection, goldConfidence);
        const goldLeverage = Math.min(2, this.config.risk.maxLeverage); // Conservative leverage for commodities

        signals.push({
          product: goldProducts[0],
          direction: goldDirection,
          confidence: goldConfidence,
          leverage: goldLeverage,
          sizeUSD: goldSize,
          reasoning: `Gold macro signal: ${params.commoditySignal.reasoning}`,
          source: "MACRO",
          urgency: goldConfidence > 70 ? "HIGH" : "MEDIUM",
        });
      }

      // Silver signal
      const silverProducts = this.config.products.commodityFutures.filter(p => p.startsWith("SI"));
      if (silverProducts.length > 0 && Math.abs(params.commoditySignal.silverSignal) >= this.config.signals.commodityBullishThreshold) {
        const silverDirection = params.commoditySignal.silverSignal > 0 ? "LONG" : "SHORT";
        const silverConfidence = Math.abs(params.commoditySignal.silverSignal) * 100;
        const silverSize = this.calculatePositionSize(silverDirection, silverConfidence);
        const silverLeverage = Math.min(2, this.config.risk.maxLeverage);

        signals.push({
          product: silverProducts[0],
          direction: silverDirection,
          confidence: silverConfidence,
          leverage: silverLeverage,
          sizeUSD: silverSize,
          reasoning: `Silver macro signal: ${params.commoditySignal.reasoning}`,
          source: "MACRO",
          urgency: silverConfidence > 70 ? "HIGH" : "MEDIUM",
        });
      }
    }

    return signals;
  }

  // --------------------------------------------------------------------------
  // RISK MANAGEMENT — Pre-trade and position monitoring
  // --------------------------------------------------------------------------

  /**
   * Check all open positions for risk management triggers.
   * Returns signals for positions that need to be closed/reduced.
   */
  generateRiskSignals(): DerivativesSignal[] {
    if (!this.state) return [];

    const signals: DerivativesSignal[] = [];
    const allPositions = [...this.state.cfmPositions, ...this.state.intxPositions];

    for (const position of allPositions) {
      const entryPrice = parseFloat(position.entry_vwap?.value || position.vwap?.value || "0");
      const markPrice = parseFloat(position.mark_price?.value || "0");
      const liquidationPrice = parseFloat(position.liquidation_price?.value || "0");
      const unrealizedPnl = parseFloat(position.unrealized_pnl?.value || "0");
      const positionNotional = parseFloat(position.position_notional?.value || "0");

      if (entryPrice === 0 || markPrice === 0) continue;

      const pnlPercent = positionNotional > 0 ? (unrealizedPnl / positionNotional) * 100 : 0;
      const isLong = position.position_side === "LONG";

      // === STOP LOSS ===
      if (pnlPercent <= this.config.risk.stopLossPercent) {
        signals.push({
          product: position.product_id,
          direction: "FLAT",
          confidence: 100,
          leverage: 1,
          sizeUSD: Math.abs(positionNotional),
          reasoning: `STOP LOSS: ${position.product_id} at ${pnlPercent.toFixed(1)}% loss (threshold: ${this.config.risk.stopLossPercent}%)`,
          source: "RISK_MANAGEMENT",
          urgency: "HIGH",
        });
        continue;
      }

      // === TAKE PROFIT ===
      if (pnlPercent >= this.config.risk.takeProfitPercent) {
        signals.push({
          product: position.product_id,
          direction: "FLAT",
          confidence: 80,
          leverage: 1,
          sizeUSD: Math.abs(positionNotional) * 0.5, // Take 50% off
          reasoning: `TAKE PROFIT: ${position.product_id} at +${pnlPercent.toFixed(1)}% (threshold: +${this.config.risk.takeProfitPercent}%)`,
          source: "RISK_MANAGEMENT",
          urgency: "MEDIUM",
        });
        continue;
      }

      // === LIQUIDATION BUFFER ===
      if (liquidationPrice > 0) {
        const distanceToLiquidation = isLong
          ? ((markPrice - liquidationPrice) / markPrice) * 100
          : ((liquidationPrice - markPrice) / markPrice) * 100;

        if (distanceToLiquidation < this.config.risk.liquidationBufferPercent) {
          signals.push({
            product: position.product_id,
            direction: "FLAT",
            confidence: 95,
            leverage: 1,
            sizeUSD: Math.abs(positionNotional) * 0.3, // Reduce 30%
            reasoning: `LIQUIDATION PREVENTION: ${position.product_id} only ${distanceToLiquidation.toFixed(1)}% from liquidation price $${liquidationPrice.toFixed(2)}`,
            source: "RISK_MANAGEMENT",
            urgency: "HIGH",
          });
        }
      }
    }

    return signals;
  }

  /**
   * Pre-trade risk check — validates that a trade can be safely executed.
   */
  validateTrade(signal: DerivativesSignal): { approved: boolean; reason: string } {
    if (!this.state) {
      return { approved: false, reason: "Derivatives state not loaded" };
    }

    // Check total exposure limit
    const currentExposure = this.state.totalMarginUsed;
    const totalBuyingPower = this.state.availableBuyingPower + currentExposure;
    const newExposurePercent = totalBuyingPower > 0
      ? ((currentExposure + signal.sizeUSD) / totalBuyingPower) * 100
      : 100;

    if (newExposurePercent > this.config.risk.maxTotalExposurePercent) {
      return {
        approved: false,
        reason: `Would exceed max exposure: ${newExposurePercent.toFixed(0)}% > ${this.config.risk.maxTotalExposurePercent}%`,
      };
    }

    // Check position size limit
    const positionPercent = totalBuyingPower > 0
      ? (signal.sizeUSD / totalBuyingPower) * 100
      : 100;

    if (positionPercent > this.config.risk.maxPositionPercent) {
      return {
        approved: false,
        reason: `Position too large: ${positionPercent.toFixed(0)}% > ${this.config.risk.maxPositionPercent}%`,
      };
    }

    // Check max open positions
    if (this.state.openPositionCount >= this.config.risk.maxOpenPositions) {
      // Allow if we're closing/reducing existing positions
      if (signal.direction !== "FLAT") {
        const existingPosition = [...this.state.cfmPositions, ...this.state.intxPositions]
          .find(p => p.product_id === signal.product);
        if (!existingPosition) {
          return {
            approved: false,
            reason: `Max open positions reached: ${this.state.openPositionCount}/${this.config.risk.maxOpenPositions}`,
          };
        }
      }
    }

    // Check cooldown
    const cooldown = this.cooldowns.find(c => c.product === signal.product);
    if (cooldown) {
      const minutesSinceLastTrade = (Date.now() - cooldown.lastTradeTime) / (1000 * 60);
      if (minutesSinceLastTrade < this.config.risk.positionCooldownMinutes) {
        return {
          approved: false,
          reason: `Cooldown active: ${(this.config.risk.positionCooldownMinutes - minutesSinceLastTrade).toFixed(0)} minutes remaining`,
        };
      }
    }

    // Check minimum size
    if (signal.sizeUSD < this.config.sizing.minPositionUSD && signal.direction !== "FLAT") {
      return {
        approved: false,
        reason: `Below minimum size: $${signal.sizeUSD.toFixed(2)} < $${this.config.sizing.minPositionUSD}`,
      };
    }

    // Check leverage limit
    if (signal.leverage > this.config.risk.maxLeverage) {
      return {
        approved: false,
        reason: `Leverage exceeds max: ${signal.leverage}x > ${this.config.risk.maxLeverage}x`,
      };
    }

    // Check buying power
    if (signal.direction !== "FLAT" && signal.sizeUSD > this.state.availableBuyingPower) {
      return {
        approved: false,
        reason: `Insufficient buying power: $${this.state.availableBuyingPower.toFixed(2)} < $${signal.sizeUSD.toFixed(2)}`,
      };
    }

    return { approved: true, reason: "All risk checks passed" };
  }

  // --------------------------------------------------------------------------
  // EXECUTION — Converts signals into actual trades
  // --------------------------------------------------------------------------

  /**
   * Execute a derivatives trading signal.
   * Handles the translation from signal to API order.
   */
  async executeSignal(signal: DerivativesSignal, signalContext: {
    confluenceScore: number;
    marketRegime: string;
    macroSignal?: string;
    fundingRate?: number;
    rsi?: number;
  }): Promise<DerivativesTradeRecord> {
    const record: DerivativesTradeRecord = {
      timestamp: new Date().toISOString(),
      product: signal.product,
      action: "OPEN_LONG",
      sizeUSD: signal.sizeUSD,
      leverage: signal.leverage,
      success: false,
      reasoning: signal.reasoning,
      signalContext,
    };

    try {
      // Determine if we have an existing position
      const existingPosition = this.findExistingPosition(signal.product);
      const isExistingLong = existingPosition?.position_side === "LONG";
      const isExistingShort = existingPosition?.position_side === "SHORT";

      let orderResult: OrderResponse;

      if (signal.direction === "FLAT") {
        // Close existing position
        if (existingPosition) {
          const side = isExistingLong ? "CLOSE_LONG" : "CLOSE_SHORT";
          record.action = signal.source === "RISK_MANAGEMENT"
            ? (signal.reasoning.includes("STOP") ? "STOP_LOSS" :
               signal.reasoning.includes("TAKE") ? "TAKE_PROFIT" :
               signal.reasoning.includes("LIQUIDATION") ? "LIQUIDATION_PREVENT" :
               signal.reasoning.includes("FUNDING") ? "FUNDING_EXIT" : "REDUCE")
            : (isExistingLong ? "CLOSE_LONG" : "CLOSE_SHORT");

          console.log(`  🔄 [Derivatives] Closing ${signal.product}: ${record.action}`);
          orderResult = await this.client.closePosition(signal.product, String(Math.abs(parseFloat(existingPosition.net_size))));
        } else {
          record.success = true;
          record.reasoning = "No position to close — already flat";
          return record;
        }
      } else if (signal.direction === "LONG") {
        if (isExistingShort) {
          // Close short first, then open long
          console.log(`  🔄 [Derivatives] Flipping ${signal.product}: SHORT → LONG`);
          await this.client.closePosition(signal.product);
          record.action = "CLOSE_SHORT";
        }

        record.action = isExistingLong ? "ADD_LONG" : "OPEN_LONG";
        console.log(`  📈 [Derivatives] ${record.action} ${signal.product}: $${signal.sizeUSD.toFixed(2)} @ ${signal.leverage}x`);

        // Determine if this is a perpetual or commodity future
        const isPerpetual = signal.product.includes("PERP") || signal.product.includes("INTX");
        if (isPerpetual) {
          orderResult = await this.client.createPerpMarketOrder({
            productId: signal.product,
            side: "BUY",
            sizeUSD: signal.sizeUSD,
            leverage: signal.leverage,
          });
        } else {
          // Commodity futures — calculate contracts
          const contracts = Math.max(1, Math.floor(signal.sizeUSD / 100)); // Rough contract sizing
          orderResult = await this.client.createFuturesMarketOrder({
            productId: signal.product,
            side: "BUY",
            contracts,
          });
        }
      } else if (signal.direction === "SHORT") {
        if (isExistingLong) {
          // Close long first, then open short
          console.log(`  🔄 [Derivatives] Flipping ${signal.product}: LONG → SHORT`);
          await this.client.closePosition(signal.product);
          record.action = "CLOSE_LONG";
        }

        record.action = isExistingShort ? "ADD_SHORT" : "OPEN_SHORT";
        console.log(`  📉 [Derivatives] ${record.action} ${signal.product}: $${signal.sizeUSD.toFixed(2)} @ ${signal.leverage}x`);

        const isPerpetual = signal.product.includes("PERP") || signal.product.includes("INTX");
        if (isPerpetual) {
          orderResult = await this.client.createPerpMarketOrder({
            productId: signal.product,
            side: "SELL",
            sizeUSD: signal.sizeUSD,
            leverage: signal.leverage,
          });
        } else {
          const contracts = Math.max(1, Math.floor(signal.sizeUSD / 100));
          orderResult = await this.client.createFuturesMarketOrder({
            productId: signal.product,
            side: "SELL",
            contracts,
          });
        }
      } else {
        record.action = "OPEN_LONG"; // Placeholder
        record.reasoning = "HOLD — no derivatives action";
        record.success = true;
        return record;
      }

      // Process result
      record.orderId = orderResult!.order_id;
      record.success = orderResult!.success;
      if (!orderResult!.success) {
        record.error = orderResult!.failure_reason || orderResult!.error_response?.message || "Order failed";
        console.error(`  ❌ [Derivatives] Order failed: ${record.error}`);
      } else {
        console.log(`  ✅ [Derivatives] Order ${record.orderId} executed`);
      }

      // Update cooldown
      this.updateCooldown(signal.product);

    } catch (error: any) {
      record.success = false;
      record.error = error?.message?.substring(0, 200) || "Unknown error";
      console.error(`  ❌ [Derivatives] Execution error: ${record.error}`);
    }

    // Record trade
    this.tradeHistory.push(record);
    if (this.tradeHistory.length > 200) {
      this.tradeHistory = this.tradeHistory.slice(-200);
    }

    return record;
  }

  // --------------------------------------------------------------------------
  // MAIN CYCLE — Called from the main bot's runTradingCycle()
  // --------------------------------------------------------------------------

  /**
   * Run a complete derivatives trading cycle.
   * This is the main entry point called from the spot bot's cycle.
   */
  async runCycle(params: {
    indicators: Record<string, any>;
    marketRegime: string;
    macroSignal?: string;
    derivatives?: any;
    fearGreed?: { value: number; classification: string };
    commoditySignal?: MacroCommoditySignal;
  }): Promise<{
    tradesExecuted: DerivativesTradeRecord[];
    portfolioState: DerivativesPortfolioState | null;
    signalsGenerated: DerivativesSignal[];
  }> {
    if (!this.config.enabled) {
      return { tradesExecuted: [], portfolioState: null, signalsGenerated: [] };
    }

    console.log("\n" + "─".repeat(50));
    console.log("📊 DERIVATIVES MODULE — Cycle Start");
    console.log("─".repeat(50));

    const tradesExecuted: DerivativesTradeRecord[] = [];
    let signals: DerivativesSignal[] = [];

    try {
      // 1. Refresh portfolio state
      console.log("  📦 Fetching derivatives portfolio state...");
      this.state = await this.client.getDerivativesState();
      console.log(`  💰 Buying Power: $${this.state.availableBuyingPower.toFixed(2)} | Positions: ${this.state.openPositionCount} | Unrealized P&L: $${this.state.totalUnrealizedPnl.toFixed(2)}`);

      // 2. Check risk management triggers first (highest priority)
      const riskSignals = this.generateRiskSignals();
      if (riskSignals.length > 0) {
        console.log(`  🚨 ${riskSignals.length} risk signal(s) detected — executing first`);
        for (const riskSignal of riskSignals) {
          const validation = this.validateTrade(riskSignal);
          if (validation.approved || riskSignal.source === "RISK_MANAGEMENT") {
            // Risk management signals always execute
            const result = await this.executeSignal(riskSignal, {
              confluenceScore: 0,
              marketRegime: params.marketRegime,
              macroSignal: params.macroSignal,
            });
            tradesExecuted.push(result);
            // Refresh state after risk trade
            this.state = await this.client.getDerivativesState();
          }
        }
      }

      // 3. Generate new trading signals from existing brain
      signals = this.generateSignals(params);
      console.log(`  📡 Generated ${signals.length} signal(s)`);

      for (const signal of signals) {
        console.log(`     ${signal.product}: ${signal.direction} | Confidence: ${signal.confidence.toFixed(0)} | Size: $${signal.sizeUSD.toFixed(2)} | Leverage: ${signal.leverage}x`);
        console.log(`     Reasoning: ${signal.reasoning}`);
      }

      // 4. Filter and validate signals
      const actionableSignals = signals
        .filter(s => s.direction !== "HOLD")
        .sort((a, b) => {
          // Priority: HIGH urgency first, then higher confidence
          const urgencyOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
          return (urgencyOrder[b.urgency] - urgencyOrder[a.urgency]) || (b.confidence - a.confidence);
        });

      // 5. Execute approved signals
      for (const signal of actionableSignals) {
        const validation = this.validateTrade(signal);
        if (validation.approved) {
          console.log(`  ✅ Trade approved: ${signal.product} ${signal.direction}`);
          const indicator = params.indicators["ETH"] || params.indicators["cbBTC"] || {};
          const result = await this.executeSignal(signal, {
            confluenceScore: indicator.confluenceScore || 0,
            marketRegime: params.marketRegime,
            macroSignal: params.macroSignal,
            fundingRate: params.derivatives?.btcFundingRate,
            rsi: indicator.rsi14,
          });
          tradesExecuted.push(result);

          // Refresh state after each trade
          if (tradesExecuted.length < 3) {
            this.state = await this.client.getDerivativesState();
          }
        } else {
          console.log(`  ⛔ Trade blocked: ${signal.product} — ${validation.reason}`);
        }
      }

    } catch (error: any) {
      console.error(`  ❌ [Derivatives] Cycle error: ${error?.message?.substring(0, 200)}`);
    }

    console.log(`  📊 Derivatives cycle complete: ${tradesExecuted.length} trade(s) executed`);
    console.log("─".repeat(50));

    return {
      tradesExecuted,
      portfolioState: this.state,
      signalsGenerated: signals || [],
    };
  }

  // --------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------

  private calculatePositionSize(direction: string, confidence: number): number {
    if (direction === "FLAT" || direction === "HOLD") return 0;

    let size = this.config.sizing.basePositionUSD;

    // Scale by confidence if enabled
    if (this.config.sizing.confidenceMultiplier) {
      const multiplier = 0.5 + (confidence / 100) * 1.0; // 0.5x at 0 confidence, 1.5x at 100
      size *= multiplier;
    }

    // Clamp to min/max
    size = Math.max(this.config.sizing.minPositionUSD, Math.min(size, this.config.sizing.maxPositionUSD));

    // Further limit by available buying power
    if (this.state) {
      const maxFromBuyingPower = this.state.availableBuyingPower * (this.config.risk.maxPositionPercent / 100);
      size = Math.min(size, maxFromBuyingPower);
    }

    return size;
  }

  private calculateLeverage(confidence: number, marketRegime: string): number {
    let leverage = 1;

    // Scale leverage with confidence (conservative)
    if (confidence >= 80) {
      leverage = Math.min(3, this.config.risk.maxLeverage);
    } else if (confidence >= 60) {
      leverage = Math.min(2, this.config.risk.maxLeverage);
    } else {
      leverage = 1; // No leverage for low confidence
    }

    // Reduce in volatile regime
    if (marketRegime === "VOLATILE") {
      leverage = Math.max(1, leverage - 1);
    }

    return leverage;
  }

  private findExistingPosition(productId: string): Position | undefined {
    if (!this.state) return undefined;
    return [...this.state.cfmPositions, ...this.state.intxPositions]
      .find(p => p.product_id === productId);
  }

  private updateCooldown(product: string): void {
    const existing = this.cooldowns.find(c => c.product === product);
    if (existing) {
      existing.lastTradeTime = Date.now();
    } else {
      this.cooldowns.push({ product, lastTradeTime: Date.now() });
    }
  }

  // --------------------------------------------------------------------------
  // STATE ACCESS (for dashboard / API)
  // --------------------------------------------------------------------------

  getState(): DerivativesPortfolioState | null {
    return this.state;
  }

  getTradeHistory(): DerivativesTradeRecord[] {
    return this.tradeHistory;
  }

  getConfig(): DerivativesConfig {
    return this.config;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }
}
