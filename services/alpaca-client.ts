/**
 * Schertzinger Trading Command — Alpaca Markets API Client (v6.0)
 *
 * Handles stock & ETF trading via Alpaca's REST API.
 * Supports both paper and live trading modes.
 * Designed to also support Coinbase once they open equities API.
 */

import axios, { type AxiosInstance } from 'axios';

// ============================================================================
// TYPES
// ============================================================================

export interface AlpacaConfig {
  apiKeyId: string;
  apiKeySecret: string;
  paper: boolean;
  maxTradeUSD: number;
  maxPositionPercent: number;
}

export interface AlpacaAccount {
  id: string;
  status: string;
  currency: string;
  buyingPower: number;
  portfolioValue: number;
  equity: number;
  lastEquity: number;
  cash: number;
  daytradingBuyingPower: number;
  patternDayTrader: boolean;
}

export interface AlpacaPosition {
  symbol: string;
  qty: number;
  side: 'long' | 'short';
  marketValue: number;
  costBasis: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  currentPrice: number;
  avgEntryPrice: number;
  changeToday: number;
}

export interface AlpacaOrder {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  qty: number;
  notional?: number;
  filledQty: number;
  filledAvgPrice: number;
  status: string;
  createdAt: string;
  filledAt: string | null;
}

export interface AlpacaBar {
  t: string;  // timestamp
  o: number;  // open
  h: number;  // high
  l: number;  // low
  c: number;  // close
  v: number;  // volume
}

export interface AlpacaQuote {
  symbol: string;
  bidPrice: number;
  bidSize: number;
  askPrice: number;
  askSize: number;
  lastPrice: number;
  lastSize: number;
  timestamp: string;
}

// ============================================================================
// CLIENT
// ============================================================================

export class AlpacaClient {
  private api: AxiosInstance;
  private dataApi: AxiosInstance;
  private config: AlpacaConfig;
  private initialized = false;

  constructor(config: AlpacaConfig) {
    this.config = config;

    const baseURL = config.paper
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets';

    this.api = axios.create({
      baseURL,
      timeout: 15000,
      headers: {
        'APCA-API-KEY-ID': config.apiKeyId,
        'APCA-API-SECRET-KEY': config.apiKeySecret,
      },
    });

    this.dataApi = axios.create({
      baseURL: 'https://data.alpaca.markets',
      timeout: 15000,
      headers: {
        'APCA-API-KEY-ID': config.apiKeyId,
        'APCA-API-SECRET-KEY': config.apiKeySecret,
      },
    });
  }

  // ---- Account & Health ----

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.api.get('/v2/account');
      const account = res.data;
      this.initialized = true;
      return {
        success: true,
        message: `Connected to Alpaca (${this.config.paper ? 'PAPER' : 'LIVE'}) | Equity: $${parseFloat(account.equity).toFixed(2)} | Buying Power: $${parseFloat(account.buying_power).toFixed(2)}`,
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Alpaca connection failed: ${error?.response?.status || ''} ${error?.message?.substring(0, 100) || error}`,
      };
    }
  }

  async getAccount(): Promise<AlpacaAccount> {
    const res = await this.api.get('/v2/account');
    const d = res.data;
    return {
      id: d.id,
      status: d.status,
      currency: d.currency,
      buyingPower: parseFloat(d.buying_power),
      portfolioValue: parseFloat(d.portfolio_value),
      equity: parseFloat(d.equity),
      lastEquity: parseFloat(d.last_equity),
      cash: parseFloat(d.cash),
      daytradingBuyingPower: parseFloat(d.daytrading_buying_power),
      patternDayTrader: d.pattern_day_trader,
    };
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // ---- Positions ----

  async getPositions(): Promise<AlpacaPosition[]> {
    const res = await this.api.get('/v2/positions');
    return res.data.map((p: any) => ({
      symbol: p.symbol,
      qty: parseFloat(p.qty),
      side: p.side,
      marketValue: parseFloat(p.market_value),
      costBasis: parseFloat(p.cost_basis),
      unrealizedPnL: parseFloat(p.unrealized_pl),
      unrealizedPnLPercent: parseFloat(p.unrealized_plpc) * 100,
      currentPrice: parseFloat(p.current_price),
      avgEntryPrice: parseFloat(p.avg_entry_price),
      changeToday: parseFloat(p.change_today) * 100,
    }));
  }

  async getPosition(symbol: string): Promise<AlpacaPosition | null> {
    try {
      const res = await this.api.get(`/v2/positions/${symbol}`);
      const p = res.data;
      return {
        symbol: p.symbol,
        qty: parseFloat(p.qty),
        side: p.side,
        marketValue: parseFloat(p.market_value),
        costBasis: parseFloat(p.cost_basis),
        unrealizedPnL: parseFloat(p.unrealized_pl),
        unrealizedPnLPercent: parseFloat(p.unrealized_plpc) * 100,
        currentPrice: parseFloat(p.current_price),
        avgEntryPrice: parseFloat(p.avg_entry_price),
        changeToday: parseFloat(p.change_today) * 100,
      };
    } catch {
      return null; // No position
    }
  }

  // ---- Orders ----

  async submitMarketOrder(
    symbol: string,
    side: 'buy' | 'sell',
    notionalUSD: number
  ): Promise<AlpacaOrder> {
    // Enforce max trade size
    const clampedNotional = Math.min(notionalUSD, this.config.maxTradeUSD);

    const res = await this.api.post('/v2/orders', {
      symbol,
      notional: clampedNotional.toFixed(2),
      side,
      type: 'market',
      time_in_force: 'day',
    });

    const o = res.data;
    return {
      id: o.id,
      clientOrderId: o.client_order_id,
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      qty: parseFloat(o.qty || '0'),
      notional: parseFloat(o.notional || '0'),
      filledQty: parseFloat(o.filled_qty || '0'),
      filledAvgPrice: parseFloat(o.filled_avg_price || '0'),
      status: o.status,
      createdAt: o.created_at,
      filledAt: o.filled_at,
    };
  }

  async submitLimitOrder(
    symbol: string,
    side: 'buy' | 'sell',
    qty: number,
    limitPrice: number
  ): Promise<AlpacaOrder> {
    const res = await this.api.post('/v2/orders', {
      symbol,
      qty: qty.toString(),
      side,
      type: 'limit',
      time_in_force: 'gtc',
      limit_price: limitPrice.toFixed(2),
    });

    const o = res.data;
    return {
      id: o.id,
      clientOrderId: o.client_order_id,
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      qty: parseFloat(o.qty || '0'),
      filledQty: parseFloat(o.filled_qty || '0'),
      filledAvgPrice: parseFloat(o.filled_avg_price || '0'),
      status: o.status,
      createdAt: o.created_at,
      filledAt: o.filled_at,
    };
  }

  async getOrders(status: 'open' | 'closed' | 'all' = 'all', limit = 50): Promise<AlpacaOrder[]> {
    const res = await this.api.get('/v2/orders', { params: { status, limit } });
    return res.data.map((o: any) => ({
      id: o.id,
      clientOrderId: o.client_order_id,
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      qty: parseFloat(o.qty || '0'),
      notional: o.notional ? parseFloat(o.notional) : undefined,
      filledQty: parseFloat(o.filled_qty || '0'),
      filledAvgPrice: parseFloat(o.filled_avg_price || '0'),
      status: o.status,
      createdAt: o.created_at,
      filledAt: o.filled_at,
    }));
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.api.delete(`/v2/orders/${orderId}`);
  }

  // ---- Market Data ----

  async getLatestQuotes(symbols: string[]): Promise<Record<string, AlpacaQuote>> {
    const res = await this.dataApi.get('/v2/stocks/quotes/latest', {
      params: { symbols: symbols.join(',') },
    });
    const quotes: Record<string, AlpacaQuote> = {};
    for (const [symbol, data] of Object.entries(res.data.quotes || {})) {
      const q = data as any;
      quotes[symbol] = {
        symbol,
        bidPrice: q.bp,
        bidSize: q.bs,
        askPrice: q.ap,
        askSize: q.as,
        lastPrice: (q.bp + q.ap) / 2, // midpoint estimate
        lastSize: 0,
        timestamp: q.t,
      };
    }
    return quotes;
  }

  async getHistoricalBars(
    symbol: string,
    timeframe: '1Min' | '5Min' | '15Min' | '1Hour' | '1Day' = '1Hour',
    limit = 240
  ): Promise<AlpacaBar[]> {
    const res = await this.dataApi.get(`/v2/stocks/${symbol}/bars`, {
      params: { timeframe, limit, adjustment: 'split' },
    });
    return (res.data.bars || []).map((b: any) => ({
      t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
    }));
  }

  async getSnapshots(symbols: string[]): Promise<Record<string, {
    latestTrade: { price: number; size: number; timestamp: string };
    dailyBar: AlpacaBar;
    prevDailyBar: AlpacaBar;
    minuteBar: AlpacaBar;
  }>> {
    const res = await this.dataApi.get('/v2/stocks/snapshots', {
      params: { symbols: symbols.join(',') },
    });
    const snapshots: Record<string, any> = {};
    for (const [symbol, data] of Object.entries(res.data || {})) {
      const s = data as any;
      snapshots[symbol] = {
        latestTrade: { price: s.latestTrade?.p, size: s.latestTrade?.s, timestamp: s.latestTrade?.t },
        dailyBar: s.dailyBar ? { t: s.dailyBar.t, o: s.dailyBar.o, h: s.dailyBar.h, l: s.dailyBar.l, c: s.dailyBar.c, v: s.dailyBar.v } : null,
        prevDailyBar: s.prevDailyBar ? { t: s.prevDailyBar.t, o: s.prevDailyBar.o, h: s.prevDailyBar.h, l: s.prevDailyBar.l, c: s.prevDailyBar.c, v: s.prevDailyBar.v } : null,
        minuteBar: s.minuteBar ? { t: s.minuteBar.t, o: s.minuteBar.o, h: s.minuteBar.h, l: s.minuteBar.l, c: s.minuteBar.c, v: s.minuteBar.v } : null,
      };
    }
    return snapshots;
  }

  // ---- Clock & Calendar ----

  async getClock(): Promise<{ isOpen: boolean; nextOpen: string; nextClose: string; timestamp: string }> {
    const res = await this.api.get('/v2/clock');
    return {
      isOpen: res.data.is_open,
      nextOpen: res.data.next_open,
      nextClose: res.data.next_close,
      timestamp: res.data.timestamp,
    };
  }
}
