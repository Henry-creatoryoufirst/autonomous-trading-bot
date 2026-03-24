/**
 * NVR Capital — Telegram Alert Service
 * v19.6.0: Foundation for monitoring & alerting
 *
 * Sends alerts to Telegram when:
 * - 3+ consecutive trade failures (CRITICAL)
 * - Wallet balance drops >5% (HIGH)
 * - Circuit breaker triggers (CRITICAL)
 * - Daily P&L digest (7 AM EDT)
 * - Bot startup/shutdown (INFO)
 * - Kill switch activated (CRITICAL)
 *
 * Architecture: Single bot, instance-tagged messages.
 * Phase 1 = alerts only. Phase 2 = command execution.
 */

import axios from "axios";

// ============================================================================
// CONFIGURATION
// ============================================================================

const TELEGRAM_API_BASE = "https://api.telegram.org/bot";
const MAX_MESSAGE_LENGTH = 4096; // Telegram's max message length
const RATE_LIMIT_MS = 1000; // Min 1 second between messages (Telegram limit: 30/sec)

interface TelegramConfig {
  botToken: string;
  chatId: string;
  instanceName: string; // e.g., "Henry", "Zack", "Kathy" — tags every message
}

// ============================================================================
// ALERT TYPES & SEVERITY
// ============================================================================

export type AlertSeverity = "CRITICAL" | "HIGH" | "INFO";

export interface Alert {
  severity: AlertSeverity;
  title: string;
  message: string;
  data?: Record<string, string | number | boolean>;
}

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  CRITICAL: "\u{1F6A8}", // 🚨
  HIGH: "\u{26A0}\u{FE0F}", // ⚠️
  INFO: "\u{2139}\u{FE0F}", // ℹ️
};

// ============================================================================
// TELEGRAM SERVICE
// ============================================================================

export class TelegramAlertService {
  private config: TelegramConfig | null = null;
  private enabled = false;
  private lastMessageTime = 0;
  private consecutiveFailures = 0;
  private readonly MAX_SEND_FAILURES = 5; // Disable after 5 consecutive send failures

  // Consecutive trade failure tracking
  private tradeFailureCount = 0;
  private readonly FAILURE_ALERT_THRESHOLD = 3;

  // Balance drop tracking
  private lastKnownBalance = 0;
  private readonly BALANCE_DROP_ALERT_PCT = 5;

  constructor() {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (botToken && chatId) {
      this.config = {
        botToken,
        chatId,
        instanceName: process.env.BOT_INSTANCE_NAME || "NVR",
      };
      this.enabled = true;
      console.log(`  \u{1F4E1} Telegram alerts: ENABLED (instance: ${this.config.instanceName})`);
    } else {
      console.log(`  \u{1F4E1} Telegram alerts: DISABLED (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to enable)`);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ============================================================================
  // CORE: Send message to Telegram
  // ============================================================================

  private async sendMessage(text: string, parseMode: "HTML" | "Markdown" = "HTML"): Promise<boolean> {
    if (!this.enabled || !this.config) return false;

    // Rate limiting
    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageTime;
    if (timeSinceLastMessage < RATE_LIMIT_MS) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - timeSinceLastMessage));
    }

    try {
      const truncatedText = text.length > MAX_MESSAGE_LENGTH
        ? text.substring(0, MAX_MESSAGE_LENGTH - 20) + "\n\n[truncated]"
        : text;

      await axios.post(
        `${TELEGRAM_API_BASE}${this.config.botToken}/sendMessage`,
        {
          chat_id: this.config.chatId,
          text: truncatedText,
          parse_mode: parseMode,
          disable_web_page_preview: true,
        },
        { timeout: 10000 }
      );

      this.lastMessageTime = Date.now();
      this.consecutiveFailures = 0;
      return true;
    } catch (error: any) {
      this.consecutiveFailures++;
      const msg = error?.response?.data?.description || error?.message || "Unknown error";
      console.warn(`  \u{1F4E1} Telegram send failed (${this.consecutiveFailures}/${this.MAX_SEND_FAILURES}): ${msg}`);

      if (this.consecutiveFailures >= this.MAX_SEND_FAILURES) {
        console.error(`  \u{1F4E1} Telegram: ${this.MAX_SEND_FAILURES} consecutive failures — disabling alerts`);
        this.enabled = false;
      }
      return false;
    }
  }

  // ============================================================================
  // PUBLIC: Send structured alert
  // ============================================================================

  async sendAlert(alert: Alert): Promise<boolean> {
    const emoji = SEVERITY_EMOJI[alert.severity];
    const tag = this.config?.instanceName || "NVR";

    let text = `${emoji} <b>[${tag}] ${alert.severity}: ${alert.title}</b>\n\n${alert.message}`;

    if (alert.data && Object.keys(alert.data).length > 0) {
      text += "\n\n<b>Details:</b>";
      for (const [key, value] of Object.entries(alert.data)) {
        text += `\n  ${key}: <code>${value}</code>`;
      }
    }

    text += `\n\n<i>${new Date().toISOString()}</i>`;

    return this.sendMessage(text);
  }

  // ============================================================================
  // TRADE FAILURE TRACKING — Alert on 3+ consecutive failures
  // ============================================================================

  async onTradeResult(success: boolean, details?: { token?: string; error?: string; action?: string }): Promise<void> {
    if (success) {
      this.tradeFailureCount = 0;
      return;
    }

    this.tradeFailureCount++;

    if (this.tradeFailureCount >= this.FAILURE_ALERT_THRESHOLD) {
      await this.sendAlert({
        severity: "CRITICAL",
        title: `${this.tradeFailureCount} Consecutive Trade Failures`,
        message: `Trading may be broken. Last ${this.tradeFailureCount} trades have ALL failed.\n\nCheck CDP key validity, wallet balance, and RPC connectivity.`,
        data: {
          consecutiveFailures: this.tradeFailureCount,
          lastToken: details?.token || "unknown",
          lastError: details?.error?.substring(0, 200) || "unknown",
          lastAction: details?.action || "unknown",
        },
      });
    }
  }

  // ============================================================================
  // BALANCE DROP TRACKING — Alert on >5% portfolio drop
  // ============================================================================

  async onBalanceUpdate(currentBalance: number): Promise<void> {
    if (this.lastKnownBalance <= 0) {
      this.lastKnownBalance = currentBalance;
      return;
    }

    const dropPct = ((this.lastKnownBalance - currentBalance) / this.lastKnownBalance) * 100;

    if (dropPct >= this.BALANCE_DROP_ALERT_PCT) {
      await this.sendAlert({
        severity: "HIGH",
        title: `Portfolio Drop: -${dropPct.toFixed(1)}%`,
        message: `Portfolio value dropped from $${this.lastKnownBalance.toFixed(2)} to $${currentBalance.toFixed(2)}`,
        data: {
          previousBalance: `$${this.lastKnownBalance.toFixed(2)}`,
          currentBalance: `$${currentBalance.toFixed(2)}`,
          dropPercent: `${dropPct.toFixed(1)}%`,
          dropUSD: `$${(this.lastKnownBalance - currentBalance).toFixed(2)}`,
        },
      });
    }

    this.lastKnownBalance = currentBalance;
  }

  // ============================================================================
  // CIRCUIT BREAKER — Alert when breaker triggers
  // ============================================================================

  async onCircuitBreakerTriggered(reason: string, portfolioValue: number): Promise<void> {
    await this.sendAlert({
      severity: "CRITICAL",
      title: "Circuit Breaker Triggered",
      message: `All trading PAUSED.\n\nReason: ${reason}`,
      data: {
        portfolioValue: `$${portfolioValue.toFixed(2)}`,
        reason,
      },
    });
  }

  // ============================================================================
  // STARTUP / SHUTDOWN
  // ============================================================================

  async onStartup(version: string, portfolioValue: number, walletAddress: string): Promise<void> {
    await this.sendAlert({
      severity: "INFO",
      title: `Bot Started — v${version}`,
      message: `Trading engine initialized and ready.`,
      data: {
        version,
        portfolioValue: `$${portfolioValue.toFixed(2)}`,
        wallet: `${walletAddress.substring(0, 10)}...${walletAddress.substring(38)}`,
      },
    });
  }

  async onShutdown(reason: string): Promise<void> {
    await this.sendAlert({
      severity: "CRITICAL",
      title: "Bot Shutting Down",
      message: reason,
    });
  }

  // ============================================================================
  // KILL SWITCH
  // ============================================================================

  async onKillSwitch(triggeredBy: string): Promise<void> {
    await this.sendAlert({
      severity: "CRITICAL",
      title: "KILL SWITCH ACTIVATED",
      message: `All trading HALTED immediately.\n\nTriggered by: ${triggeredBy}`,
    });
  }

  // ============================================================================
  // DAILY P&L DIGEST
  // ============================================================================

  async sendDailyDigest(data: {
    portfolioValue: number;
    dailyPnL: number;
    dailyPnLPct: number;
    totalTrades: number;
    winRate: number;
    topWinner?: string;
    topLoser?: string;
    fearGreedIndex?: number;
  }): Promise<void> {
    const pnlEmoji = data.dailyPnL >= 0 ? "\u{1F4C8}" : "\u{1F4C9}"; // 📈 or 📉
    const pnlSign = data.dailyPnL >= 0 ? "+" : "";

    await this.sendAlert({
      severity: "INFO",
      title: `Daily Digest ${pnlEmoji}`,
      message: [
        `<b>Portfolio:</b> $${data.portfolioValue.toFixed(2)}`,
        `<b>Daily P&L:</b> ${pnlSign}$${data.dailyPnL.toFixed(2)} (${pnlSign}${data.dailyPnLPct.toFixed(1)}%)`,
        `<b>Trades:</b> ${data.totalTrades} | <b>Win Rate:</b> ${data.winRate.toFixed(0)}%`,
        data.topWinner ? `<b>Top Winner:</b> ${data.topWinner}` : "",
        data.topLoser ? `<b>Top Loser:</b> ${data.topLoser}` : "",
        data.fearGreedIndex !== undefined ? `<b>Fear & Greed:</b> ${data.fearGreedIndex}/100` : "",
      ].filter(Boolean).join("\n"),
    });
  }
}

// Singleton instance
export const telegramService = new TelegramAlertService();
