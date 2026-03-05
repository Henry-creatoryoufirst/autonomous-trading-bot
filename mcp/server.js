#!/usr/bin/env node
// =============================================================================
// SCHERTZINGER TRADING COMMAND — MCP Server v1.0
// Exposes all STC API endpoints as MCP tools for Claude Code sessions.
// Run via stdio transport: node server.js
// =============================================================================

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const BASE_URL =
  process.env.STC_API_URL ||
  "https://autonomous-trading-bot-production.up.railway.app";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJSON(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options.headers },
    method: options.method || "GET",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`STC API ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

function jsonResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(err) {
  return {
    isError: true,
    content: [{ type: "text", text: `Error: ${err.message || err}` }],
  };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "stc-trading-bot",
  version: "1.0.0",
});

// ========================= CORE PORTFOLIO =========================

server.tool(
  "get_portfolio",
  "Get STC portfolio overview: total value, P&L, drawdown, deposits, harvest totals, and strategy allocations.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/portfolio"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.tool(
  "get_balances",
  "Get current token holdings with cost basis, unrealized P&L, and allocation percentages.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/balances"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.tool(
  "get_sectors",
  "Get sector allocation breakdown (DeFi, L1, L2, Meme, Stablecoin, etc.).",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/sectors"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

// ========================= TRADE HISTORY =========================

server.tool(
  "get_trades",
  "Get recent trade history. Returns trade log with entry/exit prices, P&L, confluence scores, and AI reasoning.",
  { limit: z.number().optional().describe("Number of trades to return (default: all)") },
  async ({ limit }) => {
    try {
      const path = limit ? `/api/trades?limit=${limit}` : "/api/trades";
      return jsonResult(await fetchJSON(path));
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.tool(
  "get_daily_pnl",
  "Get daily P&L scoreboard for the last 30 days with win/loss counts and cumulative returns.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/daily-pnl"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

// ========================= MARKET INTELLIGENCE =========================

server.tool(
  "get_indicators",
  "Get position-level indicators: RSI, MACD, Bollinger Bands, ATR-based stop-loss and take-profit levels.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/indicators"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.tool(
  "get_intelligence",
  "Get market intelligence across 11 dimensions: DeFi TVL, derivatives OI, news sentiment, macro (FRED), Fear & Greed, funding rates, whale activity, and more.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/intelligence"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

// ========================= STRATEGY & SELF-IMPROVEMENT =========================

server.tool(
  "get_patterns",
  "Get strategy pattern performance: which entry/exit patterns are winning or losing, hit rates, and average P&L.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/patterns"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.tool(
  "get_reviews",
  "Get performance reviews from the self-improvement engine: shadow proposals, promoted thresholds, review verdicts.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/reviews"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.tool(
  "get_thresholds",
  "Get adaptive trading thresholds: current buy/sell confluence thresholds, position sizing rules, and threshold history.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/thresholds"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

// ========================= AUTO-HARVEST / PAYOUTS =========================

server.tool(
  "get_auto_harvest",
  "Get auto-harvest (payout) configuration: recipients, percentages, recent payout history, thresholds, and cooldowns.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/auto-harvest"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.tool(
  "trigger_harvest",
  "Manually trigger a harvest/payout cycle. Requires the bot's bearer token for authorization.",
  { token: z.string().describe("Bearer auth token for the bot API") },
  async ({ token }) => {
    try {
      const res = await fetchJSON("/api/auto-harvest/trigger", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      return jsonResult(res);
    } catch (e) {
      return errorResult(e);
    }
  }
);

// ========================= ENGINE STATUS =========================

server.tool(
  "get_adaptive",
  "Get adaptive cycle engine status: light/heavy cycle info, circuit breaker state, position sizing, signal health, momentum indicators.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/adaptive"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.tool(
  "get_derivatives",
  "Get derivatives engine status: open interest, funding rates, basis spread, liquidation data, and position recommendations.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/derivatives"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.tool(
  "get_equity",
  "Get equity/stock trading engine dashboard: Alpaca positions, sector allocation, recent equity trades.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/equity"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.tool(
  "get_discovery",
  "Get token discovery engine status: newly discovered tokens, screening results, and pending evaluations.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/discovery"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.tool(
  "get_cache",
  "Get cache and cooldown manager status: token cooldowns, API cache hit rates, and rate limit status.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/cache"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

// ========================= HEALTH =========================

server.tool(
  "get_health",
  "Health check — confirms the bot is running and returns uptime, version, and a portfolio snapshot.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/health"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

// ========================= COMPOUND / CONVENIENCE =========================

server.tool(
  "get_morning_brief",
  "Generate a morning brief by fetching portfolio, daily P&L, signal health, and recent trades in one call. Useful for daily check-ins.",
  async () => {
    try {
      const [portfolio, dailyPnl, adaptive, trades, intelligence] =
        await Promise.all([
          fetchJSON("/api/portfolio"),
          fetchJSON("/api/daily-pnl"),
          fetchJSON("/api/adaptive"),
          fetchJSON("/api/trades?limit=10"),
          fetchJSON("/api/intelligence"),
        ]);
      return jsonResult({
        portfolio,
        dailyPnl,
        engineStatus: adaptive,
        recentTrades: trades,
        intelligence,
      });
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.tool(
  "get_risk_snapshot",
  "Get a risk-focused snapshot: circuit breaker state, signal health, position sizing, derivatives data, and max drawdown.",
  async () => {
    try {
      const [adaptive, derivatives, portfolio] = await Promise.all([
        fetchJSON("/api/adaptive"),
        fetchJSON("/api/derivatives"),
        fetchJSON("/api/portfolio"),
      ]);
      return jsonResult({
        circuitBreaker: adaptive.circuitBreaker,
        signalHealth: adaptive.signalHealth,
        positionSizing: adaptive.positionSizing,
        momentum: adaptive.momentum,
        derivatives,
        drawdown: portfolio.drawdown,
      });
    } catch (e) {
      return errorResult(e);
    }
  }
);

// ========================= v11.0: FAMILY PLATFORM =========================

server.tool(
  "get_family",
  "Get family platform overview: all members, their wallets, portfolio values, risk profiles, and recent family trades.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/family"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.tool(
  "get_family_members",
  "Get list of all family members with their IDs, names, risk profiles, wallet addresses, and status.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/family/members"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.tool(
  "get_family_profiles",
  "Get risk profile definitions: Aggressive, Moderate, Conservative — with position limits, stop-losses, and confluence thresholds.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/family/profiles"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.tool(
  "get_family_wallets",
  "Get family wallet status: CDP wallet addresses, portfolio values, trade counts, and win rates per member.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/family/wallets"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

// ---------------------------------------------------------------------------
// v11.0: Aave V3 Yield
// ---------------------------------------------------------------------------

server.tool(
  "get_yield",
  "Get Aave V3 yield status: deposited USDC, aToken balance, accrued yield, estimated APY, supply/withdraw history, and contract addresses.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/yield"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

server.tool(
  "get_dex_intelligence",
  "Get real-time Base DEX intelligence from GeckoTerminal: trending pools, token metrics (price, volume, mcap), volume spikes, buy/sell pressure signals, new pools, and AI-ready summary. Updated every heavy cycle.",
  async () => {
    try {
      return jsonResult(await fetchJSON("/api/dex-intelligence"));
    } catch (e) {
      return errorResult(e);
    }
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("STC MCP Server fatal error:", err);
  process.exit(1);
});
