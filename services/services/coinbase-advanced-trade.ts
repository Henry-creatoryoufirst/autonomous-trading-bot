/**
 * Coinbase Advanced Trade API Service
 *
 * Handles authentication, REST API calls, and WebSocket connections
 * to Coinbase Advanced Trade for perpetual futures and commodity futures trading.
 *
 * Endpoints:
 *   - Orders: POST /api/v3/brokerage/orders
 *   - Close Position: POST /api/v3/brokerage/orders/close_position
 *   - List Orders: GET /api/v3/brokerage/orders/historical/batch
 *   - Cancel Orders: POST /api/v3/brokerage/orders/batch_cancel
 *   - CFM Balance Summary: GET /api/v3/brokerage/cfm/balance_summary
 *   - CFM Positions: GET /api/v3/brokerage/cfm/positions
 *   - CFM Position: GET /api/v3/brokerage/cfm/positions/{product_id}
 *   - INTX Positions: GET /api/v3/brokerage/intx/positions/{portfolio_uuid}
 *   - INTX Portfolio: GET /api/v3/brokerage/intx/portfolio/{portfolio_uuid}
 *   - Move Funds: POST /api/v3/brokerage/portfolios/move_funds
 *   - List Products: GET /api/v3/brokerage/products
 *
 * Authentication: CDP API Key (JWT) — same keys as the on-chain bot
 */

import crypto from "crypto";
import axios, { AxiosInstance } from "axios";

// ============================================================================
// TYPES
// ============================================================================

export interface AdvancedTradeConfig {
  apiKeyId: string;        // CDP API Key ID (same as on-chain bot)
  apiKeySecret: string;    // CDP API Key Secret (same as on-chain bot)
  baseUrl?: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

export type OrderSide = "BUY" | "SELL";

export interface MarketOrderConfig {
  quote_size?: string;     // For BUY: amount of quote currency to spend
  base_size?: string;      // For SELL: amount of base currency to sell
}

export interface LimitOrderConfig {
  base_size: string;
  limit_price: string;
  post_only?: boolean;
  end_time?: string;
}

export interface CreateOrderRequest {
  client_order_id: string;
  product_id: string;       // e.g., "BTC-PERP-INTX", "BTC-USD", "GCZ6-USD" (Gold futures)
  side: OrderSide;
  order_configuration: {
    market_market_ioc?: MarketOrderConfig;
    limit_limit_gtc?: LimitOrderConfig;
    limit_limit_gtd?: LimitOrderConfig & { end_time: string };
  };
  leverage?: string;        // e.g., "2" for 2x leverage
  margin_type?: "CROSS" | "ISOLATED";
  retail_portfolio_id?: string;
}

export interface OrderResponse {
  success: boolean;
  order_id?: string;
  product_id?: string;
  side?: string;
  client_order_id?: string;
  failure_reason?: string;
  error_response?: {
    error: string;
    message: string;
    error_details: string;
    preview_failure_reason?: string;
  };
}

export interface Position {
  product_id: string;
  portfolio_uuid: string;
  symbol: string;
  vwap: { value: string; currency: string };
  entry_vwap: { value: string; currency: string };
  position_side: "LONG" | "SHORT" | "UNKNOWN";
  margin_type: string;
  net_size: string;
  buy_order_size: string;
  sell_order_size: string;
  im_contribution: string;
  unrealized_pnl: { value: string; currency: string };
  mark_price: { value: string; currency: string };
  liquidation_price: { value: string; currency: string };
  leverage: string;
  im_notional: { value: string; currency: string };
  mm_notional: { value: string; currency: string };
  position_notional: { value: string; currency: string };
}

export interface FuturesBalanceSummary {
  futures_buying_power: { value: string; currency: string };
  total_usd_balance: { value: string; currency: string };
  cbi_usd_balance: { value: string; currency: string };
  cfm_usd_balance: { value: string; currency: string };
  total_open_orders_hold_amount: { value: string; currency: string };
  unrealized_pnl: { value: string; currency: string };
  daily_realized_pnl: { value: string; currency: string };
  initial_margin: { value: string; currency: string };
  available_margin: { value: string; currency: string };
  liquidation_threshold: { value: string; currency: string };
  liquidation_buffer_amount: { value: string; currency: string };
  liquidation_buffer_percentage: string;
}

export interface PerpetualsPortfolioSummary {
  portfolio_uuid: string;
  collateral: string;
  position_notional: string;
  open_position_notional: string;
  pending_fees: string;
  borrow: string;
  accrued_interest: string;
  rolling_debt: string;
  portfolio_initial_margin: string;
  portfolio_im_notional: { value: string; currency: string };
  portfolio_maintenance_margin: string;
  portfolio_mm_notional: { value: string; currency: string };
  liquidation_percentage: string;
  liquidation_buffer: string;
  margin_type: string;
  margin_flags: string;
  liquidation_status: string;
  unrealized_pnl: { value: string; currency: string };
  buying_power: { value: string; currency: string };
  total_balance: { value: string; currency: string };
  max_withdrawal: { value: string; currency: string };
}

export interface ProductInfo {
  product_id: string;
  price: string;
  price_percentage_change_24h: string;
  volume_24h: string;
  product_type: string;
  quote_currency_id: string;
  base_currency_id: string;
  future_product_details?: {
    venue: string;
    contract_code: string;
    contract_expiry: string;
    contract_size: string;
    contract_root_unit: string;
    contract_expiry_type: "PERPETUAL" | "EXPIRING";
    perpetual_details?: {
      open_interest: string;
      funding_rate: string;
      funding_time: string;
    };
  };
}

export interface DerivativesPortfolioState {
  // CFM (US Derivatives — regulated futures)
  cfmBalance: FuturesBalanceSummary | null;
  cfmPositions: Position[];
  // INTX (Perpetuals — international)
  intxPortfolio: PerpetualsPortfolioSummary | null;
  intxPositions: Position[];
  // Combined view
  totalMarginUsed: number;
  totalUnrealizedPnl: number;
  availableBuyingPower: number;
  openPositionCount: number;
  lastUpdated: string;
}

// ============================================================================
// JWT AUTHENTICATION
// ============================================================================

/**
 * Generate a JWT token for Coinbase Advanced Trade API authentication.
 * Uses the same CDP API keys as the on-chain bot.
 *
 * The JWT is signed using ES256 (ECDSA with P-256 and SHA-256).
 * For Ed25519 keys, we fall back to the simpler API key header auth.
 */
function generateJWT(
  apiKeyId: string,
  apiKeySecret: string,
  requestMethod: string,
  requestPath: string,
): string {
  const uri = `${requestMethod} ${requestPath}`;

  const header = {
    alg: "ES256",
    kid: apiKeyId,
    nonce: crypto.randomBytes(16).toString("hex"),
    typ: "JWT",
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: apiKeyId,
    iss: "cdp",
    aud: ["cdp_service"],
    nbf: now,
    exp: now + 120, // 2 minutes
    uri,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const message = `${encodedHeader}.${encodedPayload}`;

  // Sign with ECDSA P-256
  let privateKey = apiKeySecret;
  if (!privateKey.includes("-----BEGIN")) {
    // If it's a raw base64 key, wrap it in PEM format
    privateKey = `-----BEGIN EC PRIVATE KEY-----\n${privateKey}\n-----END EC PRIVATE KEY-----`;
  }

  const sign = crypto.createSign("SHA256");
  sign.update(message);
  const signature = sign.sign(privateKey, "base64url");

  return `${message}.${signature}`;
}

// ============================================================================
// COINBASE ADVANCED TRADE CLIENT
// ============================================================================

export class CoinbaseAdvancedTradeClient {
  private config: Required<AdvancedTradeConfig>;
  private http: AxiosInstance;

  constructor(config: AdvancedTradeConfig) {
    this.config = {
      apiKeyId: config.apiKeyId,
      apiKeySecret: config.apiKeySecret,
      baseUrl: config.baseUrl || "https://api.coinbase.com",
      maxRetries: config.maxRetries || 3,
      retryDelayMs: config.retryDelayMs || 2000,
    };

    this.http = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  // --------------------------------------------------------------------------
  // AUTH HELPERS
  // --------------------------------------------------------------------------

  private getAuthHeaders(method: string, path: string): Record<string, string> {
    const jwt = generateJWT(
      this.config.apiKeyId,
      this.config.apiKeySecret,
      method.toUpperCase(),
      path,
    );
    return {
      Authorization: `Bearer ${jwt}`,
    };
  }

  private async request<T>(method: "GET" | "POST" | "DELETE", path: string, data?: any): Promise<T> {
    const headers = this.getAuthHeaders(method, path);

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await this.http.request({
          method,
          url: path,
          headers,
          data: method !== "GET" ? data : undefined,
          params: method === "GET" ? data : undefined,
        });
        return response.data as T;
      } catch (error: any) {
        const status = error?.response?.status;
        const msg = error?.response?.data?.message || error?.message || "Unknown error";

        if (status === 429 && attempt < this.config.maxRetries) {
          const waitMs = this.config.retryDelayMs * Math.pow(2, attempt - 1);
          console.log(`  ⏳ [AdvancedTrade] Rate limited (429). Retry ${attempt}/${this.config.maxRetries} in ${waitMs}ms...`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        if (status === 401 || status === 403) {
          console.error(`  ❌ [AdvancedTrade] Auth error (${status}): ${msg}`);
          throw new Error(`Authentication failed: ${msg}. Ensure CDP API keys have Advanced Trade permissions.`);
        }

        if (attempt < this.config.maxRetries && status && status >= 500) {
          const waitMs = this.config.retryDelayMs * Math.pow(2, attempt - 1);
          console.log(`  ⏳ [AdvancedTrade] Server error (${status}). Retry ${attempt}/${this.config.maxRetries} in ${waitMs}ms...`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        throw new Error(`[AdvancedTrade] ${method} ${path} failed (${status}): ${msg}`);
      }
    }

    throw new Error(`[AdvancedTrade] Max retries exceeded for ${method} ${path}`);
  }

  // --------------------------------------------------------------------------
  // PRODUCTS
  // --------------------------------------------------------------------------

  /**
   * List available products, optionally filtered by type.
   * Use product_type=FUTURE and contract_expiry_type=PERPETUAL for perps.
   */
  async listProducts(params?: {
    product_type?: "SPOT" | "FUTURE";
    contract_expiry_type?: "PERPETUAL" | "EXPIRING";
    product_ids?: string[];
  }): Promise<{ products: ProductInfo[] }> {
    return this.request("GET", "/api/v3/brokerage/products", params);
  }

  /**
   * Get a single product's details and current price.
   */
  async getProduct(productId: string): Promise<ProductInfo> {
    return this.request("GET", `/api/v3/brokerage/products/${productId}`);
  }

  // --------------------------------------------------------------------------
  // ORDERS
  // --------------------------------------------------------------------------

  /**
   * Create a new order (works for spot, perpetuals, and futures).
   * For perpetuals: use product_id like "BTC-PERP-INTX"
   * For US futures: use product_id like "BIT-28FEB26-CDE" or "GCJ6-USD"
   */
  async createOrder(order: CreateOrderRequest): Promise<OrderResponse> {
    const response = await this.request<{ success: boolean; success_response?: any; error_response?: any; order_configuration?: any }>(
      "POST",
      "/api/v3/brokerage/orders",
      order,
    );

    return {
      success: response.success,
      order_id: response.success_response?.order_id,
      product_id: response.success_response?.product_id,
      side: response.success_response?.side,
      client_order_id: response.success_response?.client_order_id,
      failure_reason: response.error_response?.preview_failure_reason,
      error_response: response.error_response,
    };
  }

  /**
   * Close an open position for a specific product.
   */
  async closePosition(productId: string, size?: string): Promise<OrderResponse> {
    const clientOrderId = crypto.randomUUID();
    return this.request("POST", "/api/v3/brokerage/orders/close_position", {
      client_order_id: clientOrderId,
      product_id: productId,
      size,
    });
  }

  /**
   * Cancel one or more orders by their IDs.
   */
  async cancelOrders(orderIds: string[]): Promise<{ results: { success: boolean; order_id: string }[] }> {
    return this.request("POST", "/api/v3/brokerage/orders/batch_cancel", {
      order_ids: orderIds,
    });
  }

  /**
   * List historical orders with optional filters.
   */
  async listOrders(params?: {
    product_id?: string;
    order_status?: string[];
    product_type?: "SPOT" | "FUTURE";
    limit?: number;
  }): Promise<{ orders: any[] }> {
    return this.request("GET", "/api/v3/brokerage/orders/historical/batch", params);
  }

  // --------------------------------------------------------------------------
  // US DERIVATIVES (CFM) — Regulated Futures (Gold, Silver, BTC Futures)
  // --------------------------------------------------------------------------

  /**
   * Get futures balance summary including buying power, margin, and P&L.
   */
  async getFuturesBalanceSummary(): Promise<{ balance_summary: FuturesBalanceSummary }> {
    return this.request("GET", "/api/v3/brokerage/cfm/balance_summary");
  }

  /**
   * List all open futures positions.
   */
  async listFuturesPositions(): Promise<{ positions: Position[] }> {
    return this.request("GET", "/api/v3/brokerage/cfm/positions");
  }

  /**
   * Get a specific futures position by product ID.
   */
  async getFuturesPosition(productId: string): Promise<{ position: Position }> {
    return this.request("GET", `/api/v3/brokerage/cfm/positions/${productId}`);
  }

  /**
   * Schedule a futures sweep (transfer funds between spot and futures).
   */
  async scheduleFuturesSweep(usdAmount: string): Promise<{ success: boolean }> {
    return this.request("POST", "/api/v3/brokerage/cfm/sweeps/schedule", {
      usd_amount: usdAmount,
    });
  }

  // --------------------------------------------------------------------------
  // PERPETUALS (INTX) — International Perpetual Futures (BTC-PERP, ETH-PERP)
  // --------------------------------------------------------------------------

  /**
   * Get perpetuals portfolio summary for a specific portfolio.
   */
  async getPerpetualsPortfolio(portfolioUuid: string): Promise<{ summary: PerpetualsPortfolioSummary }> {
    return this.request("GET", `/api/v3/brokerage/intx/portfolio/${portfolioUuid}`);
  }

  /**
   * List perpetuals positions for a portfolio.
   */
  async listPerpetualsPositions(portfolioUuid: string): Promise<{ positions: Position[] }> {
    return this.request("GET", `/api/v3/brokerage/intx/positions/${portfolioUuid}`);
  }

  /**
   * Get a specific perpetuals position.
   */
  async getPerpetualsPosition(portfolioUuid: string, symbol: string): Promise<{ position: Position }> {
    return this.request("GET", `/api/v3/brokerage/intx/positions/${portfolioUuid}/${symbol}`);
  }

  /**
   * Get perpetuals portfolio balances.
   */
  async getPerpetualsBalances(portfolioUuid: string): Promise<any> {
    return this.request("GET", `/api/v3/brokerage/intx/balances/${portfolioUuid}`);
  }

  /**
   * Allocate funds to perpetuals portfolio.
   */
  async allocatePortfolio(data: {
    portfolio_uuid: string;
    symbol: string;
    amount: string;
    currency: string;
  }): Promise<any> {
    return this.request("POST", "/api/v3/brokerage/intx/allocate", data);
  }

  /**
   * Opt in or out of multi-asset collateral for perpetuals.
   */
  async setMultiAssetCollateral(data: {
    portfolio_uuid: string;
    multi_asset_collateral_enabled: boolean;
  }): Promise<any> {
    return this.request("POST", "/api/v3/brokerage/intx/multi_asset_collateral", data);
  }

  // --------------------------------------------------------------------------
  // PORTFOLIOS (Fund Movement)
  // --------------------------------------------------------------------------

  /**
   * Move funds between portfolios (e.g., spot → perpetuals).
   */
  async movePortfolioFunds(data: {
    funds: { value: string; currency: string };
    source_portfolio_uuid: string;
    target_portfolio_uuid: string;
  }): Promise<any> {
    return this.request("POST", "/api/v3/brokerage/portfolios/move_funds", data);
  }

  /**
   * List all portfolios (to find portfolio UUIDs).
   */
  async listPortfolios(): Promise<{ portfolios: { uuid: string; name: string; type: string }[] }> {
    return this.request("GET", "/api/v3/brokerage/portfolios");
  }

  // --------------------------------------------------------------------------
  // HIGH-LEVEL HELPERS
  // --------------------------------------------------------------------------

  /**
   * Create a market order for perpetual futures (BUY or SELL).
   * This is the primary method the derivatives strategy engine will use.
   */
  async createPerpMarketOrder(params: {
    productId: string;      // e.g., "BTC-PERP-INTX"
    side: OrderSide;
    sizeUSD: number;        // Notional size in USD
    leverage?: number;      // e.g., 2 for 2x (default: 1)
  }): Promise<OrderResponse> {
    const clientOrderId = crypto.randomUUID();

    return this.createOrder({
      client_order_id: clientOrderId,
      product_id: params.productId,
      side: params.side,
      order_configuration: {
        market_market_ioc: {
          quote_size: params.sizeUSD.toFixed(2),
        },
      },
      leverage: params.leverage ? String(params.leverage) : undefined,
      margin_type: "CROSS",
    });
  }

  /**
   * Create a market order for commodity futures (Gold, Silver).
   * US derivatives use different product IDs and contract sizes.
   */
  async createFuturesMarketOrder(params: {
    productId: string;      // e.g., "GCJ6-USD" (Gold March 2026), "SIH6-USD" (Silver Feb 2026)
    side: OrderSide;
    contracts: number;      // Number of contracts
  }): Promise<OrderResponse> {
    const clientOrderId = crypto.randomUUID();

    return this.createOrder({
      client_order_id: clientOrderId,
      product_id: params.productId,
      side: params.side,
      order_configuration: {
        market_market_ioc: {
          base_size: String(params.contracts),
        },
      },
    });
  }

  /**
   * Get complete derivatives portfolio state — combines CFM + INTX data.
   * Called every cycle by the derivatives strategy engine.
   */
  async getDerivativesState(): Promise<DerivativesPortfolioState> {
    const state: DerivativesPortfolioState = {
      cfmBalance: null,
      cfmPositions: [],
      intxPortfolio: null,
      intxPositions: [],
      totalMarginUsed: 0,
      totalUnrealizedPnl: 0,
      availableBuyingPower: 0,
      openPositionCount: 0,
      lastUpdated: new Date().toISOString(),
    };

    // Fetch CFM (US Derivatives) state
    try {
      const [balanceSummary, cfmPositions] = await Promise.allSettled([
        this.getFuturesBalanceSummary(),
        this.listFuturesPositions(),
      ]);

      if (balanceSummary.status === "fulfilled") {
        state.cfmBalance = balanceSummary.value.balance_summary;
        state.availableBuyingPower += parseFloat(state.cfmBalance.futures_buying_power?.value || "0");
        state.totalUnrealizedPnl += parseFloat(state.cfmBalance.unrealized_pnl?.value || "0");
        state.totalMarginUsed += parseFloat(state.cfmBalance.initial_margin?.value || "0");
      }

      if (cfmPositions.status === "fulfilled") {
        state.cfmPositions = cfmPositions.value.positions || [];
        state.openPositionCount += state.cfmPositions.length;
      }
    } catch (error: any) {
      console.warn(`  ⚠️ [AdvancedTrade] CFM state fetch failed: ${error?.message?.substring(0, 150)}`);
    }

    // Fetch INTX (Perpetuals) state — need portfolio UUID first
    try {
      const portfolios = await this.listPortfolios();
      const perpPortfolio = portfolios.portfolios?.find(
        p => p.type === "PERPETUALS" || p.name?.toLowerCase().includes("perp")
      );

      if (perpPortfolio) {
        const [intxPortfolio, intxPositions] = await Promise.allSettled([
          this.getPerpetualsPortfolio(perpPortfolio.uuid),
          this.listPerpetualsPositions(perpPortfolio.uuid),
        ]);

        if (intxPortfolio.status === "fulfilled") {
          state.intxPortfolio = intxPortfolio.value.summary;
          state.availableBuyingPower += parseFloat(state.intxPortfolio.buying_power?.value || "0");
          state.totalUnrealizedPnl += parseFloat(state.intxPortfolio.unrealized_pnl?.value || "0");
        }

        if (intxPositions.status === "fulfilled") {
          state.intxPositions = intxPositions.value.positions || [];
          state.openPositionCount += state.intxPositions.length;
        }
      }
    } catch (error: any) {
      console.warn(`  ⚠️ [AdvancedTrade] INTX state fetch failed: ${error?.message?.substring(0, 150)}`);
    }

    return state;
  }

  /**
   * Test connectivity and permissions. Call this on startup.
   */
  async testConnection(): Promise<{ success: boolean; message: string; cfmEnabled: boolean; intxEnabled: boolean }> {
    let cfmEnabled = false;
    let intxEnabled = false;
    const messages: string[] = [];

    try {
      await this.getFuturesBalanceSummary();
      cfmEnabled = true;
      messages.push("CFM (US Derivatives) ✅");
    } catch (e: any) {
      messages.push(`CFM (US Derivatives) ❌ ${e.message?.substring(0, 80)}`);
    }

    try {
      const portfolios = await this.listPortfolios();
      const perpPortfolio = portfolios.portfolios?.find(
        p => p.type === "PERPETUALS" || p.name?.toLowerCase().includes("perp")
      );
      if (perpPortfolio) {
        await this.getPerpetualsPortfolio(perpPortfolio.uuid);
        intxEnabled = true;
        messages.push("INTX (Perpetuals) ✅");
      } else {
        messages.push("INTX (Perpetuals) ⚠️ No perpetuals portfolio found");
      }
    } catch (e: any) {
      messages.push(`INTX (Perpetuals) ❌ ${e.message?.substring(0, 80)}`);
    }

    return {
      success: cfmEnabled || intxEnabled,
      message: messages.join(" | "),
      cfmEnabled,
      intxEnabled,
    };
  }
}
