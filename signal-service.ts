/**
 * NVR Capital — Signal Service
 *
 * Centralized intelligence hub for the NVR bot fleet.
 * Runs as a standalone Railway service — always-on, independent of bots.
 *
 * Responsibilities:
 *   1. Fetch Fear & Greed, BTC dominance, BTC/ETH prices every 5 minutes
 *   2. Run computeMacroRegime() — single authoritative regime for all bots
 *   3. Serve GET /intel → bots poll this instead of fetching data independently
 *   4. Track fleet heartbeats → GET /fleet shows which bots are online
 *   5. Maintain 24h signal history → GET /history for dashboard charts
 *   6. Fire Telegram alert on meaningful regime transitions
 *
 * Bot integration:
 *   - Bots call GET /intel?botId=<name> at the start of each heavy cycle
 *   - On success: use centralized fearGreed, dominance, regime, bearChecks
 *   - On failure (timeout / 503): fall back to local computation — zero downtime risk
 *
 * Per-bot configuration:
 *   - GET /config/:botId returns strategy profile (conservative/standard/aggressive)
 *   - Driven by BOT_PROFILE_<BOT_ID_UPPERCASE> env vars (e.g. BOT_PROFILE_KATHY_HOWARD=conservative)
 *
 * Railway start command for this service:
 *   npx tsx signal-service.ts
 */

import http from 'http';
import { URL } from 'url';
import dotenv from 'dotenv';
dotenv.config();

import {
  refreshIntel,
  getLatestIntel,
  getBufferLengths,
  setRegimeChangeHandler,
} from './src/signal/intel-collector.js';
import type {
  IntelPayload,
  BotHeartbeat,
  FleetStatus,
  SignalHistoryEntry,
  BotConfig,
  BotProfile,
  ServiceHealth,
} from './src/signal/types.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const PORT = parseInt(process.env.PORT || '3001');
const VERSION = '1.0.0';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
const HISTORY_MAX = 288;                     // 24h @ 5-min cadence
const FLEET_ONLINE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes = "online"

// Telegram config (optional — alerts fire only when configured)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// ============================================================================
// STATE
// ============================================================================

const startedAt = Date.now();
const fleet = new Map<string, BotHeartbeat>();
const history: SignalHistoryEntry[] = [];
let refreshCount = 0;
let lastRefreshAt: string | null = null;

// ============================================================================
// PER-BOT CONFIG PROFILES
// ============================================================================

const PROFILES: Record<BotProfile, Omit<BotConfig, 'botId' | 'profile'>> = {
  conservative: {
    confluenceBuyThreshold: 25,
    maxPositionSizePct: 5,
    stopLossPercent: 8,
    bearModeEnabled: true,
  },
  standard: {
    confluenceBuyThreshold: 18,
    maxPositionSizePct: 12,
    stopLossPercent: 6,
    bearModeEnabled: true,
  },
  aggressive: {
    confluenceBuyThreshold: 12,
    maxPositionSizePct: 20,
    stopLossPercent: 5,
    bearModeEnabled: true,
  },
};

function getBotConfig(botId: string): BotConfig {
  // Look up profile from env: BOT_PROFILE_HENRY_MAIN=standard
  const key = `BOT_PROFILE_${botId.toUpperCase().replace(/-/g, '_')}`;
  const profile = (process.env[key] as BotProfile) || 'standard';
  const valid = ['conservative', 'standard', 'aggressive'] as BotProfile[];
  const resolved: BotProfile = valid.includes(profile) ? profile : 'standard';
  return { botId, profile: resolved, ...PROFILES[resolved] };
}

// ============================================================================
// TELEGRAM ALERT
// ============================================================================

async function sendTelegramAlert(message: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const body = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' });
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: 'api.telegram.org',
          path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        },
        (res) => { res.resume(); resolve(); }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch (err) {
    console.error('[Signal] Telegram alert failed:', err);
  }
}

function buildRegimeAlertMessage(
  prev: string,
  next: string,
  intel: IntelPayload,
): string {
  const emoji = next === 'BEAR' ? '🐻' : next === 'BULL' ? '🐂' : '⚖️';
  const action = next === 'BEAR'
    ? '🚨 <b>BEAR MODE ACTIVATED</b> — buy gate engaged on all bots'
    : prev === 'BEAR'
    ? '✅ <b>BEAR MODE CLEARED</b> — buys resuming on all bots'
    : `${emoji} Regime shifted to <b>${next}</b>`;

  return [
    `${emoji} <b>NVR Signal Service — Regime Change</b>`,
    '',
    action,
    '',
    `Regime: <b>${prev} → ${next}</b>`,
    `Score: <b>${intel.score}</b> (conf: ${(intel.confidence * 100).toFixed(0)}%)`,
    `Signals: trend ${intel.signals.trend} | dom ${intel.signals.dominance} | sent ${intel.signals.sentiment}`,
    `Fear &amp; Greed: <b>${intel.fearGreed}</b>`,
    `BTC: <b>$${intel.btcPrice.toLocaleString()}</b>`,
    intel.btcDominanceTrend !== null
      ? `BTC Dom Trend: <b>${intel.btcDominanceTrend > 0 ? '+' : ''}${intel.btcDominanceTrend.toFixed(1)}pp</b> (7d)`
      : 'BTC Dom Trend: building history...',
    `Bear Checks: <b>${intel.consecutiveBearChecks}/3</b>`,
  ].join('\n');
}

// ============================================================================
// REFRESH LOOP
// ============================================================================

async function runRefreshCycle(): Promise<void> {
  try {
    console.log(`[Signal] Refreshing intel... (cycle #${refreshCount + 1})`);
    const intel = await refreshIntel();
    refreshCount++;
    lastRefreshAt = intel.fetchedAt;

    // Append to history ring buffer
    const entry: SignalHistoryEntry = {
      timestamp: intel.fetchedAt,
      regime: intel.regime,
      score: intel.score,
      fearGreed: intel.fearGreed,
      btcPrice: intel.btcPrice,
      btcDominance: intel.btcDominance,
      inBearMode: intel.inBearMode,
    };
    history.push(entry);
    if (history.length > HISTORY_MAX) history.shift();

    console.log(
      `[Signal] ${intel.regime} (score: ${intel.score}) | F&G: ${intel.fearGreed} | ` +
      `BTC: $${intel.btcPrice.toLocaleString()} | DOM: ${intel.btcDominance.toFixed(1)}% | ` +
      `BearChecks: ${intel.consecutiveBearChecks}/3${intel.inBearMode ? ' 🐻' : ''}`
    );
  } catch (err) {
    console.error('[Signal] Refresh cycle failed:', err);
  }
}

// ============================================================================
// HTTP HELPERS
// ============================================================================

function sendJSON(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

function send404(res: http.ServerResponse): void {
  sendJSON(res, 404, { error: 'Not found' });
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

function handleHealth(res: http.ServerResponse): void {
  const buffers = getBufferLengths();
  const intel = getLatestIntel();
  const uptimeSec = Math.round((Date.now() - startedAt) / 1000);
  const lastRefreshAgeSec = lastRefreshAt
    ? Math.round((Date.now() - new Date(lastRefreshAt).getTime()) / 1000)
    : -1;

  const health: ServiceHealth = {
    status: lastRefreshAgeSec > 600 || !lastRefreshAt ? 'degraded' : 'ok',
    uptimeSec,
    lastRefreshAt,
    lastRefreshAgeSec,
    priceHistoryLen: buffers.prices,
    dominanceHistoryLen: buffers.dominance,
    fleetSize: fleet.size,
    regime: intel?.regime ?? 'UNKNOWN',
    score: intel?.score ?? 0,
    inBearMode: intel?.inBearMode ?? false,
    version: VERSION,
  };
  sendJSON(res, health.status === 'ok' ? 200 : 503, health);
}

function handleIntel(res: http.ServerResponse, url: URL): void {
  // Track bot heartbeat
  const botId = url.searchParams.get('botId');
  if (botId) {
    const existing = fleet.get(botId);
    fleet.set(botId, {
      botId,
      lastSeenAt: new Date().toISOString(),
      lastSeenMs: Date.now(),
      totalPolls: (existing?.totalPolls ?? 0) + 1,
    });
  }

  const intel = getLatestIntel();
  if (!intel) {
    sendJSON(res, 503, { error: 'Intel not yet available — service warming up', stale: true });
    return;
  }
  sendJSON(res, 200, intel);
}

function handleFleet(res: http.ServerResponse): void {
  const now = Date.now();
  const bots = Array.from(fleet.values()).sort((a, b) => b.lastSeenMs - a.lastSeenMs);
  const onlineCount = bots.filter(b => now - b.lastSeenMs < FLEET_ONLINE_WINDOW_MS).length;

  const status: FleetStatus = {
    bots,
    onlineCount,
    totalBots: bots.length,
    updatedAt: new Date().toISOString(),
  };
  sendJSON(res, 200, status);
}

function handleHistory(res: http.ServerResponse, url: URL): void {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '288'), 288);
  const slice = history.slice(-limit);
  sendJSON(res, 200, { entries: slice, count: slice.length, maxHistory: HISTORY_MAX });
}

function handleConfig(res: http.ServerResponse, botId: string): void {
  if (!botId || botId.length > 64) {
    sendJSON(res, 400, { error: 'Invalid botId' });
    return;
  }
  sendJSON(res, 200, getBotConfig(botId));
}

// ============================================================================
// HTTP SERVER
// ============================================================================

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' });
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendJSON(res, 405, { error: 'Method not allowed' });
    return;
  }

  const path = url.pathname;

  // GET /health
  if (path === '/health' || path === '/') {
    handleHealth(res);
    return;
  }

  // GET /intel[?botId=<name>]
  if (path === '/intel') {
    handleIntel(res, url);
    return;
  }

  // GET /fleet
  if (path === '/fleet') {
    handleFleet(res);
    return;
  }

  // GET /history[?limit=N]
  if (path === '/history') {
    handleHistory(res, url);
    return;
  }

  // GET /config/:botId
  const configMatch = path.match(/^\/config\/(.+)$/);
  if (configMatch) {
    handleConfig(res, configMatch[1]);
    return;
  }

  send404(res);
});

// ============================================================================
// STARTUP
// ============================================================================

// Wire regime-change Telegram alerts
setRegimeChangeHandler(async (prev, next, intel) => {
  const msg = buildRegimeAlertMessage(prev, next, intel);
  console.log(`[Signal] 🔔 Regime changed: ${prev} → ${next} — sending Telegram alert`);
  await sendTelegramAlert(msg);
});

// Start HTTP server
server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     NVR Capital — Signal Service v' + VERSION + '     ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  Port:     ${PORT}`);
  console.log(`  Telegram: ${TELEGRAM_BOT_TOKEN ? 'ENABLED' : 'disabled'}`);
  console.log(`  CMC:      ${process.env.CMC_API_KEY ? 'ENABLED' : 'disabled (no dominance data)'}`);
  console.log('');
  console.log('  Routes:');
  console.log('    GET /health      — service status');
  console.log('    GET /intel       — latest intel payload (add ?botId=<name>)');
  console.log('    GET /fleet       — bot heartbeat status');
  console.log('    GET /history     — 24h signal history');
  console.log('    GET /config/:id  — per-bot strategy profile');
  console.log('');
});

// Immediate first refresh, then schedule every 5 minutes
runRefreshCycle().then(() => {
  console.log('[Signal] Initial refresh complete. Scheduling every 5 minutes...\n');
  setInterval(runRefreshCycle, REFRESH_INTERVAL_MS);
}).catch((err) => {
  console.error('[Signal] Initial refresh failed:', err);
  // Still schedule — will succeed once connectivity is available
  setInterval(runRefreshCycle, REFRESH_INTERVAL_MS);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Signal] SIGTERM received — shutting down gracefully');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('[Signal] SIGINT received — shutting down gracefully');
  server.close(() => process.exit(0));
});
