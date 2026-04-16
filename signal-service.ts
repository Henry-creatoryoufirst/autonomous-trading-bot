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
import axios from 'axios';
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
import { TokenDiscoveryEngine } from './src/core/services/token-discovery.js';
import { outcomeTracker } from './src/core/services/outcome-tracker.js';
import { updateWalletWeight, checkSmartWalletActivity } from './src/core/services/smart-wallet-tracker.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const PORT = parseInt(process.env.PORT || '3001');
const VERSION = '1.1.0';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;       // 5 minutes
const HISTORY_MAX = 288;                          // 24h @ 5-min cadence
const FLEET_ONLINE_WINDOW_MS = 30 * 60 * 1000;   // 30 minutes = "online"
const GAS_CHECK_INTERVAL_MS = 30 * 60 * 1000;    // 30 minutes
const GAS_ALERT_THRESHOLD_ETH = 0.002;            // below bot's self-preservation floor (0.003)
const GAS_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // re-alert after 6h max
const GAS_ACTIVE_WINDOW_MS = 2 * 60 * 60 * 1000; // only alert bots seen in last 2h
const BASE_RPC_URL = 'https://mainnet.base.org';

// Telegram config (optional — alerts fire only when configured)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// ============================================================================
// STATE
// ============================================================================

const startedAt = Date.now();
const fleet = new Map<string, BotHeartbeat>();
const history: SignalHistoryEntry[] = [];
const lastGasAlertMs = new Map<string, number>();
let refreshCount = 0;
let lastRefreshAt: string | null = null;

// Alpha discovery engine — tracks token momentum for the /alpha endpoint
const alphaDiscovery = new TokenDiscoveryEngine([
  // Static symbols the fleet already holds — passed so discovery can track their momentum
  'ETH', 'WETH', 'CBBTC', 'USDC', 'AERO', 'VIRTUAL', 'DEGEN', 'BRETT',
]);

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
// GAS MONITOR — checks ETH balances of all known bot wallets every 30 min
// ============================================================================

async function getEthBalanceRPC(address: string): Promise<number | null> {
  try {
    const res = await axios.post(
      BASE_RPC_URL,
      { jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 },
      { timeout: 5000, headers: { 'Content-Type': 'application/json' } }
    );
    const hex = res.data?.result;
    if (!hex) return null;
    return Number(BigInt(hex)) / 1e18;
  } catch {
    return null;
  }
}

function buildGasAlertMessage(botId: string, ethBalance: number, wallet: string): string {
  return [
    `⛽ <b>NVR Fleet — Gas Alert</b>`,
    '',
    `<b>${botId}</b> is critically low on ETH gas`,
    `Balance: <b>${ethBalance.toFixed(6)} ETH</b>`,
    `Threshold: ${GAS_ALERT_THRESHOLD_ETH} ETH (bot cannot self-refuel below this)`,
    `Wallet: <code>${wallet.slice(0, 10)}...${wallet.slice(-6)}</code>`,
    '',
    `Send <b>0.01 ETH</b> to the wallet to restore autonomous operation.`,
  ].join('\n');
}

async function checkGasBalances(): Promise<void> {
  const now = Date.now();
  const activeBots = Array.from(fleet.values()).filter(
    b => b.walletAddress && now - b.lastSeenMs < GAS_ACTIVE_WINDOW_MS
  );
  if (activeBots.length === 0) return;

  console.log(`[Signal] ⛽ Checking gas for ${activeBots.length} active bot(s)...`);

  for (const bot of activeBots) {
    const eth = await getEthBalanceRPC(bot.walletAddress!);
    if (eth === null) continue;

    // Update fleet record with latest balance
    const existing = fleet.get(bot.botId);
    if (existing) {
      fleet.set(bot.botId, { ...existing, gasEth: eth, gasCheckedAt: new Date().toISOString() });
    }

    const status = eth < GAS_ALERT_THRESHOLD_ETH ? '🔴 LOW' : '✅';
    console.log(`[Signal] ⛽ ${bot.botId}: ${eth.toFixed(6)} ETH ${status}`);

    if (eth < GAS_ALERT_THRESHOLD_ETH) {
      const lastAlert = lastGasAlertMs.get(bot.botId) ?? 0;
      if (now - lastAlert > GAS_ALERT_COOLDOWN_MS) {
        lastGasAlertMs.set(bot.botId, now);
        await sendTelegramAlert(buildGasAlertMessage(bot.botId, eth, bot.walletAddress!));
      }
    }
  }
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
// ALPHA PRE-FILTER — Haiku scores each discovery candidate
// ============================================================================

interface AlphaCandidate {
  symbol: string;
  address: string;
  compositeScore: number;
  isRunner: boolean;
  priceChange24h: number;
  volume24hUSD: number;
  liquidityUSD: number;
  txns24h: number;
  lpLocked?: boolean;
  holderConcentration?: number;
  sector: string;
  haiku?: {
    accumulationScore: number;   // 0-10: pre-move setup quality
    narrativeScore: number;      // 0-10: narrative/sector fit
    riskScore: number;           // 0-10: lower = more risky
    recommendation: 'WATCH' | 'ENTRY_ZONE' | 'AVOID';
    reasoning: string;           // one sentence
    entryCondition: string;      // what to wait for before entering
  };
}

async function callCheapLLM(prompt: string): Promise<string> {
  // Priority: Groq → Cerebras → Anthropic Haiku
  const groqKey = process.env.GROQ_API_KEY;
  const cerebrasKey = process.env.CEREBRAS_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (groqKey) {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-8b-instant',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'Authorization': `Bearer ${groqKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    return response.data?.choices?.[0]?.message?.content || '';
  }

  if (cerebrasKey) {
    const response = await axios.post(
      'https://api.cerebras.ai/v1/chat/completions',
      {
        model: 'llama-3.3-70b',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'Authorization': `Bearer ${cerebrasKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    return response.data?.choices?.[0]?.message?.content || '';
  }

  // Fallback: Anthropic Haiku
  if (!anthropicKey) return '';
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 15000,
    }
  );
  return response.data?.content?.[0]?.text || '';
}

async function runHaikuPreFilter(candidates: any[]): Promise<AlphaCandidate[]> {
  if (candidates.length === 0) return [];

  // Run Haiku on each candidate in parallel (they're independent)
  const results = await Promise.all(candidates.map(async (candidate) => {
    try {
      const prompt = `You are a crypto alpha analyst scoring a Base chain token as a potential short-term trade setup.

Token: ${candidate.symbol} (${candidate.sector})
24h Price Change: ${candidate.priceChange24h.toFixed(1)}%
24h Volume: $${(candidate.volume24hUSD / 1000).toFixed(0)}K
Liquidity: $${(candidate.liquidityUSD / 1000).toFixed(0)}K
Transactions 24h: ${candidate.txns24h}
LP Locked: ${candidate.lpLocked ?? 'unknown'}
Top-10 Holder Concentration: ${candidate.holderConcentration !== undefined ? candidate.holderConcentration.toFixed(0) + '%' : 'unknown'}
Composite Discovery Score: ${candidate.compositeScore}/100

Score this token on three dimensions (0-10 each):
1. accumulationScore: Is this token in a pre-move accumulation phase (high = accumulating, low = already pumped or dead)
2. narrativeScore: Does this fit a current market narrative or hot sector? (high = strong narrative, low = no story)
3. riskScore: Safety/risk quality (high = safer, low = risky/suspicious)

Then give:
- recommendation: WATCH (interesting, wait for setup), ENTRY_ZONE (good setup right now), or AVOID (too risky or too late)
- reasoning: one sentence explaining your call
- entryCondition: what specific condition to wait for before entering (e.g. "pull back to $X support", "volume confirmation on second leg")

Respond ONLY with valid JSON:
{
  "accumulationScore": <0-10>,
  "narrativeScore": <0-10>,
  "riskScore": <0-10>,
  "recommendation": "<WATCH|ENTRY_ZONE|AVOID>",
  "reasoning": "<one sentence>",
  "entryCondition": "<specific condition>"
}`;

      const text = await callCheapLLM(prompt);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { ...candidate };
      const haiku = JSON.parse(jsonMatch[0]);
      return { ...candidate, haiku };
    } catch {
      return { ...candidate }; // Return without haiku scores on failure
    }
  }));

  return results;
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
  // Track bot heartbeat — capture wallet address for gas monitoring
  const botId = url.searchParams.get('botId');
  const wallet = url.searchParams.get('wallet');
  if (botId) {
    const existing = fleet.get(botId);
    fleet.set(botId, {
      botId,
      lastSeenAt: new Date().toISOString(),
      lastSeenMs: Date.now(),
      totalPolls: (existing?.totalPolls ?? 0) + 1,
      walletAddress: wallet || existing?.walletAddress,
      gasEth: existing?.gasEth,
      gasCheckedAt: existing?.gasCheckedAt,
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

function handleGas(res: http.ServerResponse): void {
  const now = Date.now();
  const bots = Array.from(fleet.values())
    .filter(b => b.walletAddress)
    .map(b => ({
      botId: b.botId,
      walletAddress: b.walletAddress,
      gasEth: b.gasEth ?? null,
      gasCheckedAt: b.gasCheckedAt ?? null,
      isLow: b.gasEth != null ? b.gasEth < GAS_ALERT_THRESHOLD_ETH : null,
      online: now - b.lastSeenMs < FLEET_ONLINE_WINDOW_MS,
    }));
  sendJSON(res, 200, {
    bots,
    threshold: GAS_ALERT_THRESHOLD_ETH,
    checkIntervalMin: GAS_CHECK_INTERVAL_MS / 60000,
    updatedAt: new Date().toISOString(),
  });
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

  // GET /gas
  if (path === '/gas') {
    handleGas(res);
    return;
  }

  // GET /alpha — top alpha candidates with Haiku pre-filter scores
  if (req.method === 'GET' && path === '/alpha') {
    (async () => {
      try {
        const raw = alphaDiscovery.getTopOpportunities(10);
        const candidates = await runHaikuPreFilter(raw);

        // Sort: ENTRY_ZONE first, then WATCH, then others. Within each group, by composite score.
        const ranked = [...candidates].sort((a, b) => {
          const recOrder: Record<string, number> = { ENTRY_ZONE: 0, WATCH: 1, AVOID: 2 };
          const aOrder = recOrder[a.haiku?.recommendation ?? 'WATCH'] ?? 1;
          const bOrder = recOrder[b.haiku?.recommendation ?? 'WATCH'] ?? 1;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return b.compositeScore - a.compositeScore;
        });

        // Smart wallet checks — run in parallel for top 5 candidates.
        // Each check queries eth_getLogs for both buy (incoming) and exit (outgoing)
        // transfers from our 20 tracked wallets. Fail-open: null on any RPC error.
        const top5 = ranked.slice(0, 5);
        const walletSignals = await Promise.all(
          top5.map(c =>
            checkSmartWalletActivity(c.address, c.priceUSD ?? 0, 24).catch(() => null)
          )
        );

        // Merge wallet signals into candidates and record outcomes
        const enriched = top5.map((candidate, i) => {
          const ws = walletSignals[i];
          return {
            ...candidate,
            smartWallet: ws
              ? {
                  walletCount: ws.walletCount,
                  signalStrength: ws.signalStrength,
                  totalVolumeUSD: ws.totalVolumeUSD,
                  earliestActivityMs: ws.earliestActivityMs,
                  exitingWalletCount: ws.exitingWallets.length,
                  exitSignalStrength: ws.exitSignalStrength,
                }
              : null,
          };
        });

        // Record each enriched candidate for outcome tracking
        for (let i = 0; i < top5.length; i++) {
          const candidate = top5[i];
          const ws = walletSignals[i];
          outcomeTracker.record({
            address: candidate.address,
            symbol: candidate.symbol,
            priceUSD: candidate.priceUSD ?? 0,
            compositeScore: candidate.compositeScore,
            haikuRecommendation: candidate.haiku?.recommendation,
            smartWalletIds: ws?.activeWallets.map(w => w.walletId) ?? [],
            lpLocked: candidate.lpLocked,
            holderConcentration: candidate.holderConcentration,
            priceChange24h: candidate.priceChange24h,
          });
        }

        sendJSON(res, 200, {
          candidates: enriched,
          totalScanned: alphaDiscovery.getDiscoveredTokens().length,
          lastScan: alphaDiscovery.getState().lastScanTime,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        sendJSON(res, 500, { error: err.message });
      }
    })();
    return;
  }

  // GET /outcomes — recursive learning data: recent outcomes, wallet hit rates, signal accuracy
  if (path === '/outcomes') {
    const walletHitRates = outcomeTracker.getWalletHitRates();
    // Sync learned wallet weights back into the smart-wallet tracker
    for (const whr of walletHitRates) {
      updateWalletWeight(whr.walletId, whr.hitRate4h, whr.totalSignals);
    }
    sendJSON(res, 200, {
      recentOutcomes: outcomeTracker.getRecentOutcomes(20),
      walletHitRates,
      signalAccuracy: outcomeTracker.getSignalAccuracy(),
      totalTracked: outcomeTracker.getTotalTracked(),
    });
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
  console.log('    GET /intel       — latest intel payload (add ?botId=<name>&wallet=<addr>)');
  console.log('    GET /fleet       — bot heartbeat status');
  console.log('    GET /gas         — fleet ETH gas balances (checked every 30 min)');
  console.log('    GET /history     — 24h signal history');
  console.log('    GET /config/:id  — per-bot strategy profile');
  console.log('    GET /alpha       — top alpha candidates with Haiku pre-filter scores');
  console.log('    GET /outcomes    — recursive learning: outcome history, wallet hit rates, signal accuracy');
  console.log('');
});

// Immediate first refresh, then schedule every 5 minutes
runRefreshCycle().then(() => {
  console.log('[Signal] Initial refresh complete. Scheduling every 5 minutes...\n');
  setInterval(runRefreshCycle, REFRESH_INTERVAL_MS);
}).catch((err) => {
  console.error('[Signal] Initial refresh failed:', err);
  setInterval(runRefreshCycle, REFRESH_INTERVAL_MS);
});

// Start alpha discovery engine
alphaDiscovery.start();

// Outcome tracker — restore from disk and schedule background price checks
outcomeTracker.load();
setTimeout(() => outcomeTracker.checkPendingOutcomes(), 5 * 60 * 1000);       // first check after 5 min
setInterval(() => outcomeTracker.checkPendingOutcomes(), 30 * 60 * 1000);     // then every 30 min

// Gas monitor — first check after 5 min (let bots check in first), then every 30 min
setTimeout(() => {
  checkGasBalances();
  setInterval(checkGasBalances, GAS_CHECK_INTERVAL_MS);
}, 5 * 60 * 1000);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Signal] SIGTERM received — shutting down gracefully');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('[Signal] SIGINT received — shutting down gracefully');
  server.close(() => process.exit(0));
});
