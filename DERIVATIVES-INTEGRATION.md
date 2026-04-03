# Derivatives Module Integration Guide

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    TRADING AGENT v6.0                         │
├──────────────────────────────────────────────────────────────┤
│  📐 Technical Indicators Engine (unchanged)                  │
│  • RSI, MACD, Bollinger Bands, SMA, Confluence Scoring      │
├──────────────────────────────────────────────────────────────┤
│  🧠 AI Decision Engine (extended prompt)                     │
│  • Now includes derivatives positions + commodity signals    │
│  • Recommends both spot AND derivatives actions              │
├──────────────────────────────────────────────────────────────┤
│  ⚡ Execution Layer — TWO ARMS                               │
│  ┌───────────────────────┬──────────────────────────────┐   │
│  │  ON-CHAIN (existing)  │  DERIVATIVES (new)            │   │
│  │  CDP SDK account.swap │  Coinbase Advanced Trade API  │   │
│  │  Base Mainnet tokens  │  Perpetuals + Commodity Futs  │   │
│  │  Spot BUY/SELL only   │  LONG/SHORT/FLAT              │   │
│  └───────────────────────┴──────────────────────────────┘   │
├──────────────────────────────────────────────────────────────┤
│  🥇 Macro Commodity Signal Engine (new)                      │
│  • Gold/Silver signals from DXY, yields, VIX, SPX           │
│  • Consumes existing FRED + cross-asset data pipeline        │
├──────────────────────────────────────────────────────────────┤
│  📊 Data Sources (existing + new endpoints)                  │
│  • CoinGecko, Fear & Greed, DefiLlama, Binance             │
│  • FRED macro, CryptoPanic, Cross-Asset (Gold, VIX, SPX)   │
│  • NEW: Coinbase derivatives state (positions, margin, P&L) │
└──────────────────────────────────────────────────────────────┘
```

## Files Added

| File | Purpose |
|------|---------|
| `services/coinbase-advanced-trade.ts` | REST API client for Coinbase Advanced Trade (perpetuals + futures) |
| `services/derivatives-strategy.ts` | Strategy engine that translates brain signals → derivatives trades |
| `services/macro-commodity-signals.ts` | Macro signal engine for gold/silver futures |
| `services/DERIVATIVES-INTEGRATION.md` | This integration guide |

## New Environment Variables (Railway)

| Variable | Description | Default |
|----------|-------------|---------|
| `DERIVATIVES_ENABLED` | Enable derivatives module | `false` |
| `DERIVATIVES_MAX_LEVERAGE` | Maximum leverage per position | `3` |
| `DERIVATIVES_BASE_POSITION_USD` | Default position size | `50` |
| `DERIVATIVES_STOP_LOSS_PERCENT` | Auto-close at this % loss | `-10` |
| `DERIVATIVES_TAKE_PROFIT_PERCENT` | Auto-take-profit at this % gain | `15` |
| `COINBASE_ADV_API_KEY_ID` | Advanced Trade API key (can reuse CDP_API_KEY_ID) | — |
| `COINBASE_ADV_API_KEY_SECRET` | Advanced Trade API secret (can reuse CDP_API_KEY_SECRET) | — |

## Integration Points in agent-v3.2.ts

### 1. IMPORTS (top of file, after existing imports)

```typescript
import { CoinbaseAdvancedTradeClient } from "./services/coinbase-advanced-trade.js";
import { DerivativesStrategyEngine, DEFAULT_DERIVATIVES_CONFIG } from "./services/derivatives-strategy.js";
import { MacroCommoditySignalEngine, discoverCommodityContracts } from "./services/macro-commodity-signals.js";
```

### 2. CONFIG (add to CONFIG object)

```typescript
// Add to CONFIG object:
derivatives: {
  enabled: process.env.DERIVATIVES_ENABLED === 'true',
  maxLeverage: parseInt(process.env.DERIVATIVES_MAX_LEVERAGE || '3'),
  basePositionUSD: parseFloat(process.env.DERIVATIVES_BASE_POSITION_USD || '50'),
  stopLossPercent: parseFloat(process.env.DERIVATIVES_STOP_LOSS_PERCENT || '-10'),
  takeProfitPercent: parseFloat(process.env.DERIVATIVES_TAKE_PROFIT_PERCENT || '15'),
  apiKeyId: process.env.COINBASE_ADV_API_KEY_ID || process.env.CDP_API_KEY_ID || process.env.CDP_API_KEY_NAME || '',
  apiKeySecret: process.env.COINBASE_ADV_API_KEY_SECRET || process.env.CDP_API_KEY_SECRET || process.env.CDP_API_KEY_PRIVATE_KEY || '',
},
```

### 3. GLOBAL STATE (add after cdpClient declaration)

```typescript
let advancedTradeClient: CoinbaseAdvancedTradeClient | null = null;
let derivativesEngine: DerivativesStrategyEngine | null = null;
let commoditySignalEngine: MacroCommoditySignalEngine | null = null;
```

### 4. INITIALIZATION (add in main() after CDP client init)

```typescript
// === DERIVATIVES MODULE INITIALIZATION ===
if (CONFIG.derivatives.enabled) {
  console.log("\n🔧 Initializing Derivatives Module...");
  try {
    let advApiSecret = CONFIG.derivatives.apiKeySecret;
    if (advApiSecret.includes('\\n')) {
      advApiSecret = advApiSecret.replace(/\\n/g, '\n');
    }

    advancedTradeClient = new CoinbaseAdvancedTradeClient({
      apiKeyId: CONFIG.derivatives.apiKeyId,
      apiKeySecret: advApiSecret,
    });

    // Test connectivity
    const connectionTest = await advancedTradeClient.testConnection();
    console.log(`  📡 Advanced Trade: ${connectionTest.message}`);

    if (connectionTest.success) {
      // Discover available commodity contracts
      const contracts = await discoverCommodityContracts(advancedTradeClient);

      // Initialize strategy engine
      derivativesEngine = new DerivativesStrategyEngine(advancedTradeClient, {
        enabled: true,
        products: {
          perpetuals: ["BTC-PERP-INTX", "ETH-PERP-INTX"],
          commodityFutures: [...contracts.gold.slice(0, 1), ...contracts.silver.slice(0, 1)],
        },
        risk: {
          ...DEFAULT_DERIVATIVES_CONFIG.risk,
          maxLeverage: CONFIG.derivatives.maxLeverage,
          stopLossPercent: CONFIG.derivatives.stopLossPercent,
          takeProfitPercent: CONFIG.derivatives.takeProfitPercent,
        },
        sizing: {
          ...DEFAULT_DERIVATIVES_CONFIG.sizing,
          basePositionUSD: CONFIG.derivatives.basePositionUSD,
        },
      });

      // Initialize commodity signal engine
      commoditySignalEngine = new MacroCommoditySignalEngine();

      console.log("  ✅ Derivatives module fully operational");
      console.log(`     Perpetuals: BTC-PERP-INTX, ETH-PERP-INTX`);
      console.log(`     Gold Futures: ${contracts.gold[0] || "none available"}`);
      console.log(`     Silver Futures: ${contracts.silver[0] || "none available"}`);
    } else {
      console.log("  ⚠️ Derivatives module: API not accessible. Running spot-only.");
    }
  } catch (error: any) {
    console.error(`  ❌ Derivatives init failed: ${error.message}`);
    console.log("  ⚠️ Continuing in spot-only mode.");
  }
} else {
  console.log("\n📊 Derivatives module: DISABLED (set DERIVATIVES_ENABLED=true to activate)");
}
```

### 5. TRADING CYCLE (add at the end of runTradingCycle, before final state.trading.lastCheck)

```typescript
// === DERIVATIVES CYCLE ===
if (derivativesEngine?.isEnabled() && advancedTradeClient) {
  try {
    // Generate commodity signals from existing macro data
    let commoditySignal = undefined;
    if (commoditySignalEngine && marketData.macroData) {
      const silverData = await commoditySignalEngine.fetchSilverPrice();
      commoditySignal = commoditySignalEngine.generateSignal({
        fedFundsRate: marketData.macroData.fedFundsRate,
        treasury10Y: marketData.macroData.treasury10Y,
        cpi: marketData.macroData.cpi,
        m2MoneySupply: marketData.macroData.m2,
        dollarIndex: marketData.macroData.dollarIndex,
        goldPrice: marketData.crossAsset?.goldPrice,
        goldChange24h: marketData.crossAsset?.goldChange24h,
        vixLevel: marketData.crossAsset?.vixLevel,
        spxPrice: marketData.crossAsset?.spxPrice,
        spxChange24h: marketData.crossAsset?.spxChange24h,
        macroSignal: marketData.macroData.macroSignal,
      });
    }

    // Run derivatives cycle — brain signals → derivatives execution
    const derivResult = await derivativesEngine.runCycle({
      indicators: marketData.indicators,
      marketRegime: marketData.marketRegime,
      macroSignal: marketData.macroData?.macroSignal,
      derivatives: marketData.derivatives,
      fearGreed: marketData.fearGreed,
      commoditySignal,
    });

    // Log results
    if (derivResult.tradesExecuted.length > 0) {
      for (const trade of derivResult.tradesExecuted) {
        console.log(`  ${trade.success ? "✅" : "❌"} [Deriv] ${trade.action} ${trade.product} $${trade.sizeUSD.toFixed(2)} @ ${trade.leverage}x — ${trade.reasoning.substring(0, 80)}`);
      }
    }

    // Store derivatives state for dashboard
    lastDerivativesData = {
      state: derivResult.portfolioState,
      signals: derivResult.signalsGenerated,
      trades: derivResult.tradesExecuted,
      commoditySignal: commoditySignalEngine?.getLastSignal(),
    };
  } catch (derivError: any) {
    console.error(`  ❌ Derivatives cycle error: ${derivError?.message?.substring(0, 200)}`);
  }
}
```

### 6. DASHBOARD API ENDPOINT (add new endpoint)

```typescript
// Add to HTTP server switch statement:
case "/api/derivatives":
  sendJSON(res, 200, {
    enabled: derivativesEngine?.isEnabled() || false,
    state: derivativesEngine?.getState(),
    recentTrades: derivativesEngine?.getTradeHistory().slice(-20),
    config: derivativesEngine?.getConfig(),
    commoditySignal: commoditySignalEngine?.getLastSignal(),
  });
  break;
```

### 7. AI PROMPT EXTENSION (add to systemPrompt in getAIDecision)

```
═══ DERIVATIVES POSITIONS ═══
${derivativesEngine?.getState() ? `
  Buying Power: $${derivativesEngine.getState()?.availableBuyingPower.toFixed(2)}
  Open Positions: ${derivativesEngine.getState()?.openPositionCount}
  Unrealized P&L: $${derivativesEngine.getState()?.totalUnrealizedPnl.toFixed(2)}
  ${[...(derivativesEngine.getState()?.cfmPositions || []), ...(derivativesEngine.getState()?.intxPositions || [])].map(p =>
    `  ${p.product_id}: ${p.position_side} | Size: ${p.net_size} | Entry: $${p.entry_vwap?.value} | Mark: $${p.mark_price?.value} | P&L: $${p.unrealized_pnl?.value}`
  ).join('\n')}
` : 'Derivatives: Not active'}

═══ COMMODITY SIGNALS ═══
${commoditySignalEngine?.getLastSignal() ? `
  Gold Signal: ${commoditySignalEngine.getLastSignal()?.goldSignal.toFixed(3)}
  Silver Signal: ${commoditySignalEngine.getLastSignal()?.silverSignal.toFixed(3)}
  ${commoditySignalEngine.getLastSignal()?.reasoning}
` : 'No commodity signal data'}
```

## Activation Steps

1. **Deploy the new service files** to the GitHub repo
2. **Set `DERIVATIVES_ENABLED=true`** in Railway environment variables
3. **Fund the derivatives portfolio** on Coinbase Advanced Trade with USDC
4. **Complete perpetuals onboarding** in the Coinbase Advanced Trade UI (one-time)
5. **Monitor** the `/api/derivatives` endpoint on the dashboard

## Risk Profile

| Parameter | Default | Conservative | Aggressive |
|-----------|---------|-------------|------------|
| Max Leverage | 3x | 2x | 5x |
| Base Position | $50 | $25 | $100 |
| Stop Loss | -10% | -7% | -15% |
| Take Profit | +15% | +10% | +25% |
| Max Exposure | 80% | 50% | 90% |
| Max Positions | 4 | 2 | 6 |
