/**
 * Never Rest Capital — BotConfig
 *
 * Phase 6 of the monolith refactor. Defines the per-bot configuration object
 * that isolates each Fleet member. The monolith currently reads from a single
 * global CONFIG; Phase 6 replaces that with one BotConfig per bot instance.
 *
 * Migration path:
 *   Phase 6a (this file): Define BotConfig + fromEnv() to create from env vars.
 *   Phase 6b: Bot class holds a BotConfig, all services read from it.
 *   Phase 6c: Monolith constructs CONFIG via BotConfig.fromEnv() at startup.
 */

// ============================================================================
// TRADING PARAMETERS
// ============================================================================

export interface ProfitTakingTier {
  gainPercent: number;
  sellPercent: number;
  label: string;
}

export interface TradingConfig {
  enabled: boolean;
  maxBuySize: number;
  maxSellPercent: number;
  intervalMinutes: number;
  maxPositionPercent: number;
  minPositionUSD: number;
  rebalanceThreshold: number;
  slippageBps: number;
  profitTaking: {
    enabled: boolean;
    targetPercent: number;
    sellPercent: number;
    minHoldingUSD: number;
    cooldownHours: number;
    tiers: ProfitTakingTier[];
  };
  stopLoss: {
    enabled: boolean;
    percentThreshold: number;
    sellPercent: number;
    minHoldingUSD: number;
    trailingEnabled: boolean;
    trailingPercent: number;
  };
}

// ============================================================================
// BOT CONFIG
// ============================================================================

/**
 * Per-bot configuration.
 *
 * All fields are immutable after construction — bots don't hot-reload config.
 * A bot restart is required to pick up config changes.
 */
export interface BotConfig {
  // ── Identity ──────────────────────────────────────────────────────────────
  /**
   * Stable identifier used in logs, Telegram messages, and Railway service
   * names. E.g. "henry", "ryan-denome", "kathy-howard". Used by Signal Service
   * as the botId query param.
   */
  botId: string;

  /**
   * The CoinbaseSmartWallet address this bot signs for.
   * E.g. 0x55509AA76E2769eCCa5B4293359e3001dA16dd0F
   */
  walletAddress: string;

  /**
   * Human-readable label used in Telegram + dashboard.
   * E.g. "Henry's Bot (v20.6)"
   */
  instanceName: string;

  // ── Trading ───────────────────────────────────────────────────────────────
  trading: TradingConfig;

  /**
   * Active tokens this bot trades. Subset of TOKEN_REGISTRY keys.
   * Defaults to all keys except USDC.
   */
  activeTokens: string[];

  // ── Persistence ───────────────────────────────────────────────────────────
  /**
   * Directory for state files, logs, and trade records.
   * E.g. "/data" (Railway mount) or "./logs" (local dev).
   */
  persistDir: string;

  logFile: string;

  // ── Notifications ─────────────────────────────────────────────────────────
  /** Telegram chat ID for this bot's alerts. */
  telegramChatId?: string;

  // ── Network ───────────────────────────────────────────────────────────────
  cdpAccountName?: string;
}

// ============================================================================
// FACTORY — build from environment variables (current monolith pattern)
// ============================================================================

/**
 * Build a BotConfig from the process environment.
 *
 * This mirrors the CONFIG constant in agent-v3.2.ts. Used by the monolith as
 * a migration shim, and by the test harness to create bots with known configs.
 */
export function botConfigFromEnv(
  activeTokens: string[],
  overrides: Partial<BotConfig> = {},
): BotConfig {
  const persistDir = process.env.PERSIST_DIR ?? './logs';
  const botId = process.env.BOT_INSTANCE_NAME ?? 'henry';

  const DEFAULT_TRADING_INTERVAL_MINUTES = 15;

  const base: BotConfig = {
    botId,
    walletAddress: process.env.WALLET_ADDRESS ?? '0x55509AA76E2769eCCa5B4293359e3001dA16dd0F',
    instanceName: process.env.BOT_INSTANCE_NAME ?? "Henry's Bot",
    trading: {
      enabled:            process.env.TRADING_ENABLED !== 'false',
      maxBuySize:         parseFloat(process.env.MAX_BUY_SIZE_USDC ?? '250'),
      maxSellPercent:     parseFloat(process.env.MAX_SELL_PERCENT ?? '50'),
      intervalMinutes:    parseInt(process.env.TRADING_INTERVAL_MINUTES ?? String(DEFAULT_TRADING_INTERVAL_MINUTES)),
      maxPositionPercent: 25,
      minPositionUSD:     15,
      rebalanceThreshold: 10,
      slippageBps:        100,
      profitTaking: {
        enabled:       true,
        targetPercent: 30,
        sellPercent:   30,
        minHoldingUSD: 5,
        cooldownHours: 8,
        tiers: [
          { gainPercent: 12,  sellPercent: 12, label: 'EARLY_HARVEST' },
          { gainPercent: 30,  sellPercent: 18, label: 'MID_HARVEST' },
          { gainPercent: 75,  sellPercent: 25, label: 'STRONG_HARVEST' },
          { gainPercent: 150, sellPercent: 35, label: 'MAJOR_HARVEST' },
        ],
      },
      stopLoss: {
        enabled:          true,
        percentThreshold: -15,
        sellPercent:      75,
        minHoldingUSD:    5,
        trailingEnabled:  true,
        trailingPercent:  -12,
      },
    },
    activeTokens,
    persistDir,
    logFile: process.env.PERSIST_DIR
      ? `${process.env.PERSIST_DIR}/trades-v3.4.json`
      : './logs/trades-v3.4.json',
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    cdpAccountName: process.env.CDP_ACCOUNT_NAME,
  };

  return { ...base, ...overrides };
}
