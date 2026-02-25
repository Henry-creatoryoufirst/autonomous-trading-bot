/**
 * Schertzinger Trading Command — Equity Integration Orchestrator (v6.0)
 *
 * Plugs into agent-v3.2.ts to run equity trading cycles.
 * Handles initialization, cycle execution, and dashboard data.
 *
 * Usage in agent-v3.2.ts:
 *   import { EquityIntegration } from './equity-integration.js';
 *   const equityEngine = new EquityIntegration();
 *   const equityEnabled = await equityEngine.initialize();
 *   if (equityEnabled) {
 *     const result = await equityEngine.runEquityCycle(fearGreedIndex);
 *     aiPrompt += result.aiPromptSection;
 *   }
 */

import { AlpacaClient, type AlpacaPosition } from './services/alpaca-client.js';
import { StockDataEngine, type StockIndicators } from './services/stock-data.js';
import { MarketHoursEngine, type SessionInfo } from './services/market-hours.js';
import { EquityStrategyEngine, ALL_EQUITY_SYMBOLS, type EquitySignal } from './strategies/equity-strategy.js';

// ============================================================================
// TYPES
// ============================================================================

export interface EquityCycleResult {
  enabled: boolean;
  session: SessionInfo;
  signals: EquitySignal[];
  executedTrades: EquityTradeResult[];
  aiPromptSection: string;
  totalEquityValue: number;
  positionCount: number;
}

export interface EquityTradeResult {
  symbol: string;
  action: 'BUY' | 'SELL';
  amountUSD: number;
  orderId: string | null;
  success: boolean;
  error?: string;
  reasoning: string;
}

export interface EquityDashboardData {
  enabled: boolean;
  session: string;
  totalValue: number;
  positions: AlpacaPosition[];
  recentSignals: EquitySignal[];
  indicators: Record<string, StockIndicators>;
  tradeHistory: EquityTradeResult[];
}

// ============================================================================
// CONFIGURATION FROM ENV
// ============================================================================

function getEquityConfig() {
  return {
    enabled: process.env.STOCK_TRADING_ENABLED === 'true',
    dryRun: process.env.STOCK_DRY_RUN !== 'false', // Default: true (dry run)
    apiKeyId: process.env.ALPACA_API_KEY_ID || '',
    apiKeySecret: process.env.ALPACA_API_SECRET_KEY || '',
    paper: process.env.ALPACA_PAPER !== 'false', // Default: true (paper)
    budgetUSD: parseFloat(process.env.STOCK_EQUITY_BUDGET_USD || '200'),
    budgetPercent: parseFloat(process.env.STOCK_EQUITY_BUDGET_PCT || '40'),
    maxTradeUSD: parseFloat(process.env.STOCK_MAX_TRADE_USD || '25'),
    maxPositionPercent: parseFloat(process.env.STOCK_MAX_POSITION_PCT || '20'),
    maxTradesPerCycle: parseInt(process.env.STOCK_MAX_TRADES_PER_CYCLE || '3'),
  };
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

export class EquityIntegration {
  private client: AlpacaClient | null = null;
  private dataEngine: StockDataEngine | null = null;
  private marketHours: MarketHoursEngine = new MarketHoursEngine();
  private strategy: EquityStrategyEngine = new EquityStrategyEngine();
  private enabled = false;
  private dryRun = true;
  private maxTradeUSD = 25;
  private recentTrades: EquityTradeResult[] = [];
  private lastIndicators: Record<string, StockIndicators> = {};
  private lastSignals: EquitySignal[] = [];

  /**
   * Initialize the equity integration module.
   * Returns true if successfully configured and connected.
   */
  async initialize(): Promise<boolean> {
    const config = getEquityConfig();

    if (!config.enabled) {
      console.log('📊 Equity integration: DISABLED (set STOCK_TRADING_ENABLED=true)');
      return false;
    }

    if (!config.apiKeyId || !config.apiKeySecret) {
      console.log('📊 Equity integration: DISABLED (ALPACA_API_KEY_ID or ALPACA_API_SECRET_KEY not set)');
      return false;
    }

    this.dryRun = config.dryRun;
    this.maxTradeUSD = config.maxTradeUSD;

    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║     📈 EQUITY INTEGRATION ENGINE v6.0            ║');
    console.log('╚══════════════════════════════════════════════════╝');

    try {
      this.client = new AlpacaClient({
        apiKeyId: config.apiKeyId,
        apiKeySecret: config.apiKeySecret,
        paper: config.paper,
        maxTradeUSD: config.maxTradeUSD,
        maxPositionPercent: config.maxPositionPercent,
      });

      const connectionResult = await this.client.testConnection();
      console.log(`  📡 ${connectionResult.message}`);

      if (!connectionResult.success) {
        console.log('  ⚠️ Equity integration: API not accessible. Running crypto-only.');
        return false;
      }

      this.dataEngine = new StockDataEngine(this.client);
      this.enabled = true;

      console.log(`  ✅ Equity module operational`);
      console.log(`     Mode: ${config.paper ? 'PAPER' : 'LIVE'} | Dry run: ${this.dryRun ? 'YES' : 'NO'}`);
      console.log(`     Watchlist: ${ALL_EQUITY_SYMBOLS.length} symbols (${ALL_EQUITY_SYMBOLS.slice(0, 8).join(', ')}...)`);
      console.log(`     Max trade: $${config.maxTradeUSD} | Max position: ${config.maxPositionPercent}%`);
      console.log(`     Market: ${this.marketHours.getSessionSummary()}`);

      return true;
    } catch (error: any) {
      console.error(`  ❌ Equity init failed: ${error?.message?.substring(0, 200)}`);
      return false;
    }
  }

  /**
   * Run a single equity trading cycle.
   * Called from the main agent's heavy cycle.
   */
  async runEquityCycle(fearGreedIndex: number): Promise<EquityCycleResult> {
    if (!this.enabled || !this.client || !this.dataEngine) {
      return this.emptyResult();
    }

    const session = this.marketHours.getCurrentSession();

    // Fetch positions
    let positions: AlpacaPosition[] = [];
    try {
      positions = await this.client.getPositions();
    } catch (error: any) {
      console.warn(`  ⚠️ Equity positions fetch failed: ${error?.message?.substring(0, 100)}`);
    }

    const totalEquityValue = positions.reduce((sum, p) => sum + p.marketValue, 0);

    // Fetch indicators for all watched symbols
    const indicators = await this.dataEngine.getAllIndicators(ALL_EQUITY_SYMBOLS);
    this.lastIndicators = indicators;

    const indicatorCount = Object.values(indicators).filter(i => i.currentPrice > 0).length;
    console.log(`  📈 Equity indicators: ${indicatorCount}/${ALL_EQUITY_SYMBOLS.length} symbols loaded | Session: ${session.session}`);

    // Generate signals
    const signals = this.strategy.generateSignals(
      indicators, positions, totalEquityValue, session, fearGreedIndex, this.maxTradeUSD
    );
    this.lastSignals = signals;

    // Execute trades
    const executedTrades: EquityTradeResult[] = [];

    for (const signal of signals) {
      if (signal.action === 'HOLD') continue;

      if (this.dryRun) {
        // Dry run: log but don't execute
        const result: EquityTradeResult = {
          symbol: signal.symbol,
          action: signal.action,
          amountUSD: signal.amountUSD,
          orderId: null,
          success: true,
          reasoning: `[DRY RUN] ${signal.reasoning}`,
        };
        executedTrades.push(result);
        console.log(`  🏷️ [DRY RUN] ${signal.action} ${signal.symbol} $${signal.amountUSD.toFixed(2)} — ${signal.reasoning}`);
      } else {
        // Live execution
        try {
          const order = await this.client.submitMarketOrder(
            signal.symbol,
            signal.action.toLowerCase() as 'buy' | 'sell',
            signal.amountUSD
          );
          executedTrades.push({
            symbol: signal.symbol,
            action: signal.action,
            amountUSD: signal.amountUSD,
            orderId: order.id,
            success: true,
            reasoning: signal.reasoning,
          });
          console.log(`  ✅ ${signal.action} ${signal.symbol} $${signal.amountUSD.toFixed(2)} — Order ${order.id}`);
        } catch (error: any) {
          executedTrades.push({
            symbol: signal.symbol,
            action: signal.action,
            amountUSD: signal.amountUSD,
            orderId: null,
            success: false,
            error: error?.message?.substring(0, 200),
            reasoning: signal.reasoning,
          });
          console.error(`  ❌ ${signal.action} ${signal.symbol} failed: ${error?.message?.substring(0, 100)}`);
        }
      }
    }

    this.recentTrades.push(...executedTrades);
    // Keep last 100 trades
    if (this.recentTrades.length > 100) {
      this.recentTrades = this.recentTrades.slice(-100);
    }

    // Build AI prompt section
    const aiPromptSection = this.strategy.buildAIPromptSection(
      positions, indicators, session, totalEquityValue
    );

    return {
      enabled: true,
      session,
      signals,
      executedTrades,
      aiPromptSection,
      totalEquityValue,
      positionCount: positions.length,
    };
  }

  /**
   * Get data for the dashboard.
   */
  async getDashboardData(): Promise<EquityDashboardData> {
    if (!this.enabled || !this.client) {
      return {
        enabled: false,
        session: 'DISABLED',
        totalValue: 0,
        positions: [],
        recentSignals: [],
        indicators: {},
        tradeHistory: [],
      };
    }

    let positions: AlpacaPosition[] = [];
    try {
      positions = await this.client.getPositions();
    } catch { /* ignore */ }

    return {
      enabled: true,
      session: this.marketHours.getSessionSummary(),
      totalValue: positions.reduce((sum, p) => sum + p.marketValue, 0),
      positions,
      recentSignals: this.lastSignals,
      indicators: this.lastIndicators,
      tradeHistory: this.recentTrades.slice(-20),
    };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private emptyResult(): EquityCycleResult {
    return {
      enabled: false,
      session: this.marketHours.getCurrentSession(),
      signals: [],
      executedTrades: [],
      aiPromptSection: '',
      totalEquityValue: 0,
      positionCount: 0,
    };
  }
}
