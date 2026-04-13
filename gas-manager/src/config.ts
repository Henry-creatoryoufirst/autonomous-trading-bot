/**
 * NVR Gas Manager — Configuration
 *
 * All values loaded from environment variables.
 * Set these in Railway service variables — never commit keys.
 */

// ============================================================================
// REQUIRED ENV VARS
// ============================================================================

/** Private key of the reserve wallet that sends ETH to bots */
export const RESERVE_PRIVATE_KEY = (
  process.env.GAS_RESERVE_PRIVATE_KEY ?? ''
) as `0x${string}`;

if (!RESERVE_PRIVATE_KEY || !RESERVE_PRIVATE_KEY.startsWith('0x')) {
  throw new Error('GAS_RESERVE_PRIVATE_KEY env var is required (0x-prefixed hex private key)');
}

/**
 * Comma-separated list of bot entries in format: label:address
 * Example: "STC-KathyHoward:0xabc...,NVR-Zachary:0xdef..."
 */
const BOT_WALLETS_ENV = process.env.BOT_WALLETS ?? '';
if (!BOT_WALLETS_ENV) {
  throw new Error('BOT_WALLETS env var is required (format: "label:0xaddr,label2:0xaddr2")');
}

export interface BotWallet {
  label: string;
  address: `0x${string}`;
}

export const BOT_WALLETS: BotWallet[] = BOT_WALLETS_ENV.split(',').map(entry => {
  const [label, address] = entry.trim().split(':');
  if (!label || !address?.startsWith('0x')) {
    throw new Error(`Invalid BOT_WALLETS entry: "${entry}" — expected "label:0xaddress"`);
  }
  return { label, address: address as `0x${string}` };
});

// ============================================================================
// OPTIONAL ENV VARS (with safe defaults)
// ============================================================================

/** Telegram bot token for reserve-low alerts */
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';

/** Telegram chat ID to send alerts to (Henry's) */
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '7267993651';

/** Base mainnet RPC — prefer private endpoint, fall back to public */
export const RPC_URL =
  process.env.BASE_RPC_URL ??
  process.env.GAS_MANAGER_RPC_URL ??
  'https://mainnet.base.org';

// ============================================================================
// THRESHOLDS
// ============================================================================

/** ETH balance below which we send a top-up to a bot wallet */
export const TOP_UP_THRESHOLD_ETH = Number(process.env.TOP_UP_THRESHOLD_ETH ?? '0.003');

/** Amount of ETH to send per top-up */
export const TOP_UP_AMOUNT_ETH = Number(process.env.TOP_UP_AMOUNT_ETH ?? '0.005');

/** Reserve wallet ETH balance below which we send a Telegram alert to Henry */
export const RESERVE_ALERT_THRESHOLD_ETH = Number(process.env.RESERVE_ALERT_THRESHOLD_ETH ?? '0.02');

/** Poll interval in milliseconds */
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? String(5 * 60 * 1000));

/** Minimum time between top-ups for the same bot (prevents double-send during slow RPC) */
export const TOP_UP_COOLDOWN_MS = Number(process.env.TOP_UP_COOLDOWN_MS ?? String(10 * 60 * 1000));

/** HTTP port for health check endpoint */
export const PORT = Number(process.env.PORT ?? '3001');
