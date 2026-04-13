/**
 * NVR Capital — Gas Manager Service (v1.0)
 *
 * Centralized ETH reserve that monitors all bot wallets and pushes gas
 * to any wallet that drops below threshold. Eliminates the circular
 * dependency of per-bot USDC→ETH swaps. Scales to 100+ bots.
 *
 * Architecture: one funded reserve wallet → direct ETH transfers to bots.
 * No swaps. No circular dependency. No human intervention required.
 *
 * Deploy as a separate Railway service from the same repo.
 * Required env vars: GAS_RESERVE_PRIVATE_KEY, BOT_WALLETS
 * Optional env vars: TELEGRAM_BOT_TOKEN, BASE_RPC_URL, TOP_UP_THRESHOLD_ETH, etc.
 */

import http from 'http';
import {
  createPublicClient,
  createWalletClient,
  http as viemHttp,
  parseEther,
  formatEther,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

import {
  RESERVE_PRIVATE_KEY,
  BOT_WALLETS,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  RPC_URL,
  TOP_UP_THRESHOLD_ETH,
  TOP_UP_AMOUNT_ETH,
  RESERVE_ALERT_THRESHOLD_ETH,
  POLL_INTERVAL_MS,
  TOP_UP_COOLDOWN_MS,
  PORT,
} from './config.js';

import { recordTopUp, getSummaries, getTotalEthSpent, getAllEvents } from './ledger.js';

// ============================================================================
// VIEM CLIENTS
// ============================================================================

const transport = viemHttp(RPC_URL);

const publicClient = createPublicClient({
  chain: base,
  transport,
});

const reserveAccount = privateKeyToAccount(RESERVE_PRIVATE_KEY);

const walletClient = createWalletClient({
  account: reserveAccount,
  chain: base,
  transport,
});

// ============================================================================
// STATE
// ============================================================================

/** Tracks the last top-up time per bot address to prevent double-sends */
const lastTopUpTime = new Map<string, number>();

/** Tracks last reserve-low alert time (throttle to once per hour) */
let lastReserveAlertTime = 0;

let isRunning = false;
let pollCount = 0;
let startTime = Date.now();

// ============================================================================
// HELPERS
// ============================================================================

async function getETHBalance(address: `0x${string}`): Promise<number> {
  const wei = await publicClient.getBalance({ address });
  return Number(formatEther(wei));
}

async function sendTelegramAlert(message: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' });
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  } catch {
    // Telegram failures never block gas operations
  }
}

// ============================================================================
// CORE: TOP-UP LOGIC
// ============================================================================

async function topUpBot(label: string, address: `0x${string}`, ethBefore: number): Promise<void> {
  // Cooldown guard — prevents double-send if previous tx is still pending
  const lastTime = lastTopUpTime.get(address) ?? 0;
  if (Date.now() - lastTime < TOP_UP_COOLDOWN_MS) {
    console.log(`  ⛽ [GAS-MGR] ${label} cooldown active — skipping top-up`);
    return;
  }

  console.log(`\n  ⛽ [GAS-MGR] Topping up ${label} (${address})`);
  console.log(`     ETH before: ${ethBefore.toFixed(6)} — sending ${TOP_UP_AMOUNT_ETH} ETH`);

  const hash: Hash = await walletClient.sendTransaction({
    to: address,
    value: parseEther(TOP_UP_AMOUNT_ETH.toString()),
  });

  lastTopUpTime.set(address, Date.now());
  console.log(`     ✅ TX: ${hash}`);

  // Check reserve after send
  const reserveAfter = await getETHBalance(reserveAccount.address);
  console.log(`     Reserve remaining: ${reserveAfter.toFixed(4)} ETH`);

  recordTopUp({
    botLabel: label,
    botAddress: address,
    ethSent: TOP_UP_AMOUNT_ETH,
    ethBefore,
    reserveAfter,
    timestamp: Date.now(),
    txHash: hash,
  });

  // Reserve low alert — throttled to once per hour
  if (reserveAfter < RESERVE_ALERT_THRESHOLD_ETH && Date.now() - lastReserveAlertTime > 60 * 60 * 1000) {
    lastReserveAlertTime = Date.now();
    await sendTelegramAlert(
      `⛽ *Gas Reserve Low*\n\n` +
      `Reserve balance: \`${reserveAfter.toFixed(4)} ETH\`\n` +
      `Threshold: \`${RESERVE_ALERT_THRESHOLD_ETH} ETH\`\n\n` +
      `Reserve wallet: \`${reserveAccount.address}\`\n` +
      `Send ETH to reload. ~0.1 ETH (~$220) covers months of fleet operation.`
    );
    console.warn(`\n  🚨 [GAS-MGR] Reserve low: ${reserveAfter.toFixed(4)} ETH — Telegram alert sent to Henry`);
  }
}

// ============================================================================
// CORE: POLL LOOP
// ============================================================================

async function pollOnce(): Promise<void> {
  pollCount++;

  // Check reserve wallet first
  let reserveBalance: number;
  try {
    reserveBalance = await getETHBalance(reserveAccount.address);
  } catch (err: any) {
    console.warn(`  [GAS-MGR] RPC error checking reserve: ${err?.message?.slice(0, 100)}`);
    return;
  }

  if (pollCount % 12 === 1) {
    // Log reserve balance once per hour (12 × 5min polls)
    console.log(`\n⛽ [GAS-MGR] Poll #${pollCount} | Reserve: ${reserveBalance.toFixed(4)} ETH | Watching ${BOT_WALLETS.length} bots`);
  }

  // If reserve is totally empty, skip top-ups (can't send what we don't have)
  if (reserveBalance < TOP_UP_AMOUNT_ETH) {
    if (Date.now() - lastReserveAlertTime > 60 * 60 * 1000) {
      lastReserveAlertTime = Date.now();
      await sendTelegramAlert(
        `🚨 *Gas Reserve EMPTY*\n\n` +
        `Reserve: \`${reserveBalance.toFixed(6)} ETH\`\n` +
        `Cannot top up bots. Send ETH to:\n\`${reserveAccount.address}\``
      );
      console.error(`\n  🚨 [GAS-MGR] Reserve empty (${reserveBalance.toFixed(6)} ETH) — cannot top up bots!`);
    }
    return;
  }

  // Check each bot wallet in parallel
  const checks = await Promise.allSettled(
    BOT_WALLETS.map(async bot => {
      const ethBalance = await getETHBalance(bot.address);
      return { ...bot, ethBalance };
    })
  );

  for (const result of checks) {
    if (result.status === 'rejected') {
      console.warn(`  [GAS-MGR] Balance check failed: ${result.reason?.message?.slice(0, 100)}`);
      continue;
    }

    const { label, address, ethBalance } = result.value;

    if (ethBalance < TOP_UP_THRESHOLD_ETH) {
      console.log(`  ⛽ [GAS-MGR] ${label} low gas: ${ethBalance.toFixed(6)} ETH < ${TOP_UP_THRESHOLD_ETH} threshold`);
      try {
        await topUpBot(label, address, ethBalance);
      } catch (err: any) {
        console.error(`  ❌ [GAS-MGR] Top-up failed for ${label}: ${err?.message?.slice(0, 200)}`);
      }
    }
  }
}

// ============================================================================
// HEALTH CHECK SERVER
// ============================================================================

function startHealthServer(): void {
  const server = http.createServer((_req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const summaries = getSummaries();
    const totalEthSpent = getTotalEthSpent();

    const status = {
      status: 'ok',
      service: 'nvr-gas-manager',
      version: '1.0.0',
      uptime_seconds: uptime,
      poll_count: pollCount,
      poll_interval_ms: POLL_INTERVAL_MS,
      reserve_address: reserveAccount.address,
      bot_count: BOT_WALLETS.length,
      thresholds: {
        top_up_threshold_eth: TOP_UP_THRESHOLD_ETH,
        top_up_amount_eth: TOP_UP_AMOUNT_ETH,
        reserve_alert_threshold_eth: RESERVE_ALERT_THRESHOLD_ETH,
      },
      total_eth_spent: totalEthSpent.toFixed(6),
      bot_summaries: summaries,
      recent_events: getAllEvents().slice(-20),
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status, null, 2));
  });

  server.listen(PORT, () => {
    console.log(`  [GAS-MGR] Health endpoint: http://localhost:${PORT}/`);
  });
}

// ============================================================================
// STARTUP
// ============================================================================

async function main(): Promise<void> {
  console.log('');
  console.log('═'.repeat(60));
  console.log('  NVR Capital — Gas Manager v1.0');
  console.log('═'.repeat(60));
  console.log(`  Reserve wallet : ${reserveAccount.address}`);
  console.log(`  Watching ${BOT_WALLETS.length} bot wallet(s):`);
  for (const bot of BOT_WALLETS) {
    console.log(`    • ${bot.label}: ${bot.address}`);
  }
  console.log(`  Top-up threshold : ${TOP_UP_THRESHOLD_ETH} ETH`);
  console.log(`  Top-up amount    : ${TOP_UP_AMOUNT_ETH} ETH`);
  console.log(`  Reserve alert    : ${RESERVE_ALERT_THRESHOLD_ETH} ETH`);
  console.log(`  Poll interval    : ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`  RPC              : ${RPC_URL}`);
  console.log('═'.repeat(60));
  console.log('');

  // Verify reserve wallet is funded before starting
  try {
    const reserveBalance = await getETHBalance(reserveAccount.address);
    console.log(`  Reserve balance  : ${reserveBalance.toFixed(4)} ETH`);
    if (reserveBalance < TOP_UP_AMOUNT_ETH) {
      console.warn(`  ⚠️  Reserve balance (${reserveBalance.toFixed(4)} ETH) is below one top-up amount (${TOP_UP_AMOUNT_ETH} ETH).`);
      console.warn(`     Fund reserve wallet before Gas Manager can operate.`);
    }
    console.log('');
  } catch (err: any) {
    console.error(`  ❌ Cannot reach RPC: ${err?.message}`);
    process.exit(1);
  }

  isRunning = true;
  startHealthServer();

  // Run immediately on startup, then every POLL_INTERVAL_MS
  await pollOnce();
  setInterval(pollOnce, POLL_INTERVAL_MS);
}

main().catch(err => {
  console.error('Gas Manager fatal error:', err);
  process.exit(1);
});
