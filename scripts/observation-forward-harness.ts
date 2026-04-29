/**
 * NVR-SPEC-022 — Pattern P-IntermediarySurge forward-validation harness
 *
 * Live, passive monitor for the 9 contract candidates + 1 EOA validated
 * via the 2026-04-29 specialist observation pass. Watches BUY events on
 * AERO/BRETT/DEGEN main pools, tracks how often the intermediary set
 * triggers, and measures forward returns.
 *
 * The harness does NOT trade. It produces a JSON log that the next
 * verdict pass reads to compute live hit-rate, win-rate, and
 * false-positive rate. After 14 days of run-time we compare:
 *
 *   - hit_rate     (≥ 2 intermediaries fire & price moves +3% in 60 min) — target ≥ 40%
 *   - fp_rate      (≥ 2 fire & no move ≥ 3% in 60 min)                  — target ≤ 30%
 *   - sample size                                                        — target ≥ 15 triggers
 *
 * Run:
 *   npx tsx scripts/observation-forward-harness.ts
 *
 * Environment:
 *   FORWARD_POLL_SEC          default 30 — how often to check for new logs
 *   FORWARD_CLUSTER_WINDOW    default 1800 (30 min) — trigger requires N intermediaries within
 *   FORWARD_OUTCOME_WINDOW    default 3600 (60 min) — measure price after trigger
 *   FORWARD_MIN_INTERMEDIARIES default 2 — N for the cluster trigger
 *   FORWARD_OUTPUT_DIR        default data/observation-pass/forward
 *
 * The harness writes one JSONL file per UTC day:
 *   data/observation-pass/forward/2026-04-29-events.jsonl    — every intermediary buy
 *   data/observation-pass/forward/2026-04-29-triggers.jsonl  — every cluster trigger
 *   data/observation-pass/forward/2026-04-29-outcomes.jsonl  — outcome at +60min for each trigger
 */

import { mkdirSync, appendFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { createPublicClient, http, parseAbiItem } from "viem";
import { activeChain } from "../src/core/config/chain-config.js";
import { GeckoTerminalHistoricalFeed } from "../src/simulation/data/price-feed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Persistence path order: FORWARD_OUTPUT_DIR > PERSIST_DIR (Railway volume) > local
const OUT_DIR =
  process.env.FORWARD_OUTPUT_DIR ??
  (process.env.PERSIST_DIR
    ? join(process.env.PERSIST_DIR, "observation-forward")
    : join(__dirname, "..", "data", "observation-pass", "forward"));
mkdirSync(OUT_DIR, { recursive: true });

const HTTP_PORT = parseInt(process.env.PORT ?? "3000", 10);

const POLL_SEC = parseInt(process.env.FORWARD_POLL_SEC ?? "30", 10);
const CLUSTER_WINDOW_SEC = parseInt(
  process.env.FORWARD_CLUSTER_WINDOW ?? "1800",
  10,
);
const OUTCOME_WINDOW_SEC = parseInt(
  process.env.FORWARD_OUTCOME_WINDOW ?? "3600",
  10,
);
const MIN_INTERMEDIARIES = parseInt(
  process.env.FORWARD_MIN_INTERMEDIARIES ?? "2",
  10,
);

// ----------------------------------------------------------------------------
// Token + pool config (same as observation-pass-base.ts)
// ----------------------------------------------------------------------------

interface TokenWatch {
  symbol: string;
  address: string;
  pools: string[];
  decimals: number;
}

const TOKEN_WATCHES: TokenWatch[] = [
  {
    symbol: "AERO",
    address: "0x940181a94a35a4569e4529a3cdfb74e38fd98631",
    pools: [
      "0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d",
      "0x82321f3beb69f503380d6b233857d5c43562e2d0",
    ],
    decimals: 18,
  },
  {
    symbol: "BRETT",
    address: "0x532f27101965dd16442e59d40670faf5ebb142e4",
    pools: [
      "0x4e829f8a5213c42535ab84aa40bd4adcce9cba02",
      "0xba3f945812a83471d709bce9c3ca699a19fb46f7",
    ],
    decimals: 18,
  },
  {
    symbol: "DEGEN",
    address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed",
    pools: ["0xc9034c3e7f58003e6ae0c8438e7c8f4598d5acaa"],
    decimals: 18,
  },
];

// ----------------------------------------------------------------------------
// Intermediary set (validated 2026-04-29 — see OBSERVATION_2026-04-29)
// ----------------------------------------------------------------------------

interface Intermediary {
  address: string;
  tier: "1" | "2" | "3";
  zScore: number;
  edge: number;
  type: "contract" | "eoa";
}

const INTERMEDIARIES: Intermediary[] = [
  { address: "0x7747f8d2a76bd6345cc29622a946a929647f2359", tier: "1", zScore: 3.8, edge: 0.394, type: "contract" },
  { address: "0xafb62448929664bfccb0aae22f232520e765ba88", tier: "2", zScore: 3.5, edge: 0.375, type: "contract" },
  { address: "0x4ae0ad0ba10dc97487cb1dd571aef20537280859", tier: "2", zScore: 2.9, edge: 0.094, type: "contract" },
  { address: "0x54d281c7cc029a9dd71f9acb7487dd95b1eecf5a", tier: "3", zScore: 2.9, edge: 0.492, type: "contract" },
  { address: "0x9bd25e67bf390437c8faf480ac735a27bcf6168c", tier: "3", zScore: 2.7, edge: 0.308, type: "contract" },
  { address: "0x63242a4ea82847b20e506b63b0e2e2eff0cc6cb0", tier: "1", zScore: 2.4, edge: 0.123, type: "contract" },
  { address: "0x31868c48d33586754a1ae04688603221e6af8557", tier: "3", zScore: 2.1, edge: 0.141, type: "contract" },
  { address: "0xa8549424b20a514eb9e7a829ec013065bef9dc1d", tier: "3", zScore: 2.1, edge: 0.392, type: "contract" },
  { address: "0xa9231b80411c0e18d27edee7786692acd2138fdf", tier: "3", zScore: 2.0, edge: 0.200, type: "eoa" },
];

const INTERMEDIARY_SET = new Set(INTERMEDIARIES.map((i) => i.address.toLowerCase()));
const INTERMEDIARY_BY_ADDR = new Map(
  INTERMEDIARIES.map((i) => [i.address.toLowerCase(), i]),
);

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

// ----------------------------------------------------------------------------
// State
// ----------------------------------------------------------------------------

interface IntermediaryBuy {
  ts: number; // unix sec
  tokenSymbol: string;
  tokenAddress: string;
  poolAddress: string;
  intermediary: string;
  tier: "1" | "2" | "3";
  amountTokens: number;
  amountUsd: number | null;
  txHash: string;
  blockNumber: number;
}

interface ClusterTrigger {
  triggerTs: number;
  tokenSymbol: string;
  intermediariesFired: Array<{ address: string; tier: string }>;
  totalAmountUsd: number;
  windowStartTs: number;
  windowEndTs: number;
  triggerPrice: number | null;
  triggerId: string;
}

interface ClusterOutcome {
  triggerId: string;
  measuredAtTs: number; // when we measured outcome (trigger + 60min)
  triggerPrice: number | null;
  outcomePrice: number | null;
  pctChange: number | null;
  hit: boolean | null; // true if pctChange >= +3% (up scenario)
  fp: boolean | null; // true if abs(pctChange) < 3%
}

// In-memory event ring per token (last CLUSTER_WINDOW_SEC of buys)
const recentByToken = new Map<string, IntermediaryBuy[]>();
for (const w of TOKEN_WATCHES) recentByToken.set(w.symbol, []);

// Pending outcome measurements
const pendingOutcomes: ClusterTrigger[] = [];

// ----------------------------------------------------------------------------
// File logging
// ----------------------------------------------------------------------------

function utcDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function logEvent(buy: IntermediaryBuy) {
  const path = join(OUT_DIR, `${utcDateStamp()}-events.jsonl`);
  appendFileSync(path, JSON.stringify(buy) + "\n");
}

function logTrigger(trigger: ClusterTrigger) {
  const path = join(OUT_DIR, `${utcDateStamp()}-triggers.jsonl`);
  appendFileSync(path, JSON.stringify(trigger) + "\n");
}

function logOutcome(outcome: ClusterOutcome) {
  const path = join(OUT_DIR, `${utcDateStamp()}-outcomes.jsonl`);
  appendFileSync(path, JSON.stringify(outcome) + "\n");
}

// ----------------------------------------------------------------------------
// RPC helpers
// ----------------------------------------------------------------------------

const ENDPOINTS = activeChain.rpcEndpoints.filter(
  (e) => !["flashbots.net", "sequencer.base.org"].some((h) => e.includes(h)),
);
let endpointCursor = 0;

function makeClient(endpoint: string) {
  return createPublicClient({
    transport: http(endpoint, { timeout: 12_000, retryCount: 0 }),
  });
}

async function tryRotating<T>(op: (ep: string) => Promise<T>): Promise<T> {
  let lastErr: Error | null = null;
  for (let i = 0; i < ENDPOINTS.length; i++) {
    const ep = ENDPOINTS[(endpointCursor + i) % ENDPOINTS.length]!;
    try {
      const r = await op(ep);
      endpointCursor = (endpointCursor + i + 1) % ENDPOINTS.length;
      return r;
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw lastErr ?? new Error("all endpoints failed");
}

// ----------------------------------------------------------------------------
// Live polling loop
// ----------------------------------------------------------------------------

let lastProcessedBlock: bigint | null = null;

async function pollOnce(priceFeed: GeckoTerminalHistoricalFeed): Promise<void> {
  const head = await tryRotating(async (ep) => {
    const c = makeClient(ep);
    return await c.getBlockNumber();
  });

  if (lastProcessedBlock === null) {
    // First call: start from head − 100 blocks (~3 min ago)
    lastProcessedBlock = head - 100n;
  }

  if (head <= lastProcessedBlock) return; // nothing new

  const fromBlock = lastProcessedBlock + 1n;
  const toBlock = head;
  // Hard cap chunk size to be safe
  const chunkSize = 5000n;

  for (const watch of TOKEN_WATCHES) {
    for (const pool of watch.pools) {
      let cursor = fromBlock;
      while (cursor <= toBlock) {
        const chunkEnd =
          cursor + chunkSize - 1n > toBlock ? toBlock : cursor + chunkSize - 1n;
        let logs: any[] = [];
        try {
          logs = await tryRotating(async (ep) => {
            const c = makeClient(ep);
            return await c.getLogs({
              address: watch.address as `0x${string}`,
              event: TRANSFER_EVENT,
              args: { from: pool as `0x${string}` },
              fromBlock: cursor,
              toBlock: chunkEnd,
            });
          });
        } catch (e) {
          console.warn(
            `  [${watch.symbol} pool ${pool.slice(0, 10)}] chunk ${cursor}..${chunkEnd} failed: ${(e as Error).message?.slice(0, 80)}`,
          );
          cursor = chunkEnd + 1n;
          continue;
        }
        for (const log of logs) {
          const toAddr = ((log.args?.to as string | undefined) ?? "").toLowerCase();
          if (!INTERMEDIARY_SET.has(toAddr)) continue;
          const tier = INTERMEDIARY_BY_ADDR.get(toAddr)!.tier;
          const value = (log.args?.value as bigint | undefined) ?? 0n;
          const tokens = Number(value) / 10 ** watch.decimals;
          // Approximate timestamp from block number (fast); we accept a few seconds of error
          const ts = Math.floor(Date.now() / 1000); // current poll moment as ts approximation
          const px = await priceFeed.getPriceAt(
            watch.symbol,
            new Date(ts * 1000).toISOString(),
          );
          const amountUsd = px && tokens > 0 ? tokens * px : null;
          const buy: IntermediaryBuy = {
            ts,
            tokenSymbol: watch.symbol,
            tokenAddress: watch.address,
            poolAddress: pool,
            intermediary: toAddr,
            tier,
            amountTokens: tokens,
            amountUsd,
            txHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
          };
          logEvent(buy);
          ingest(buy, px);
        }
        cursor = chunkEnd + 1n;
      }
    }
  }
  lastProcessedBlock = toBlock;
}

function ingest(buy: IntermediaryBuy, currentPrice: number | null) {
  const list = recentByToken.get(buy.tokenSymbol)!;
  list.push(buy);
  // Drop entries outside cluster window
  const cutoff = buy.ts - CLUSTER_WINDOW_SEC;
  while (list.length > 0 && list[0]!.ts < cutoff) list.shift();

  // Distinct intermediaries in window
  const distinct = new Set(list.map((b) => b.intermediary));
  if (distinct.size < MIN_INTERMEDIARIES) return;

  // Confirm: any Tier-1 OR total $-volume >= $50k
  const hasT1 = list.some((b) => b.tier === "1");
  const totalUsd = list.reduce((s, b) => s + (b.amountUsd ?? 0), 0);
  if (!(hasT1 || totalUsd >= 50_000)) return;

  // Trigger! Emit (deduped per cluster: only fire once per CLUSTER_WINDOW_SEC)
  const triggerId = `${buy.tokenSymbol}-${buy.ts}-${distinct.size}`;
  // Have we already fired in this window? check pendingOutcomes
  const recentTrigger = pendingOutcomes.find(
    (t) =>
      t.tokenSymbol === buy.tokenSymbol &&
      buy.ts - t.triggerTs < CLUSTER_WINDOW_SEC,
  );
  if (recentTrigger) return; // already triggered for this token in this window

  const trigger: ClusterTrigger = {
    triggerTs: buy.ts,
    tokenSymbol: buy.tokenSymbol,
    intermediariesFired: Array.from(distinct).map((addr) => ({
      address: addr,
      tier: INTERMEDIARY_BY_ADDR.get(addr)!.tier,
    })),
    totalAmountUsd: totalUsd,
    windowStartTs: buy.ts - CLUSTER_WINDOW_SEC,
    windowEndTs: buy.ts,
    triggerPrice: currentPrice,
    triggerId,
  };
  logTrigger(trigger);
  pendingOutcomes.push(trigger);
  console.log(
    `  🎯 TRIGGER ${trigger.tokenSymbol} @ ${new Date(trigger.triggerTs * 1000).toISOString()} — ` +
      `${distinct.size} intermediaries (${trigger.intermediariesFired.map((i) => `T${i.tier}`).join(",")}), ` +
      `$${totalUsd.toFixed(0)} vol, price=$${currentPrice?.toFixed(4) ?? "?"}`,
  );
}

async function checkOutcomes(priceFeed: GeckoTerminalHistoricalFeed) {
  const now = Math.floor(Date.now() / 1000);
  for (let i = pendingOutcomes.length - 1; i >= 0; i--) {
    const t = pendingOutcomes[i]!;
    if (now - t.triggerTs < OUTCOME_WINDOW_SEC) continue;
    // Measure outcome
    const watch = TOKEN_WATCHES.find((w) => w.symbol === t.tokenSymbol);
    if (!watch) continue;
    const ts = new Date(now * 1000).toISOString();
    const outcomePrice = await priceFeed.getPriceAt(watch.symbol, ts);
    let pctChange: number | null = null;
    let hit: boolean | null = null;
    let fp: boolean | null = null;
    if (t.triggerPrice && outcomePrice) {
      pctChange = (outcomePrice - t.triggerPrice) / t.triggerPrice;
      hit = pctChange >= 0.03;
      fp = Math.abs(pctChange) < 0.03;
    }
    const outcome: ClusterOutcome = {
      triggerId: t.triggerId,
      measuredAtTs: now,
      triggerPrice: t.triggerPrice,
      outcomePrice,
      pctChange,
      hit,
      fp,
    };
    logOutcome(outcome);
    console.log(
      `  📊 OUTCOME ${t.tokenSymbol} @ +${OUTCOME_WINDOW_SEC / 60}min — ` +
        `${pctChange !== null ? (pctChange * 100).toFixed(2) + "%" : "?"} ` +
        `${hit ? "HIT ✅" : fp ? "FP ❌" : "n/a"}`,
    );
    pendingOutcomes.splice(i, 1);
  }
}

// ----------------------------------------------------------------------------
// HTTP server (health + JSONL streaming + live verdict)
// ----------------------------------------------------------------------------

let bootedAt = Date.now();
let lastPollAt = 0;
let pollErrorCount = 0;
let lastPollError: string | null = null;

function readJsonl(path: string): any[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf-8");
  const out: any[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // skip
    }
  }
  return out;
}

function sendJson(res: any, code: number, body: any) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body, null, 2));
}

function loadAllJsonl(suffix: string): any[] {
  if (!existsSync(OUT_DIR)) return [];
  const files = readdirSync(OUT_DIR).filter((f) => f.endsWith(suffix));
  const out: any[] = [];
  for (const f of files.sort()) {
    out.push(...readJsonl(join(OUT_DIR, f)));
  }
  return out;
}

function computeSummary() {
  const events = loadAllJsonl("-events.jsonl");
  const triggers = loadAllJsonl("-triggers.jsonl");
  const outcomes = loadAllJsonl("-outcomes.jsonl");

  const measured = outcomes.filter((o: any) => o.pctChange !== null);
  const hits = measured.filter((o: any) => o.hit === true).length;
  const fps = measured.filter((o: any) => o.fp === true).length;

  const hitRate = measured.length > 0 ? hits / measured.length : 0;
  const fpRate = measured.length > 0 ? fps / measured.length : 0;

  let verdict: string;
  if (measured.length < 15) {
    verdict = "KEEP_WATCHING";
  } else if (hitRate >= 0.4 && fpRate <= 0.3) {
    verdict = "SHIP";
  } else if (hitRate < 0.4) {
    verdict = "KILL";
  } else {
    verdict = "MIXED";
  }

  const eventsByToken: Record<string, number> = {};
  for (const e of events) {
    eventsByToken[e.tokenSymbol] = (eventsByToken[e.tokenSymbol] ?? 0) + 1;
  }

  return {
    rawEvents: events.length,
    triggers: triggers.length,
    outcomesMeasured: measured.length,
    outcomesPending: outcomes.length - measured.length,
    hits,
    fps,
    hitRate,
    fpRate,
    verdict,
    targets: { hitRate: 0.4, fpRate: 0.3, sampleSize: 15 },
    eventsByToken,
    firstEventAt: events.length > 0 ? events[0].ts : null,
    lastEventAt: events.length > 0 ? events[events.length - 1].ts : null,
  };
}

const httpServer = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    });
    res.end();
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method not allowed" });
    return;
  }

  const path = url.pathname;

  if (path === "/health" || path === "/") {
    const uptimeSec = Math.floor((Date.now() - bootedAt) / 1000);
    const lastPollAgeSec = lastPollAt > 0 ? Math.floor((Date.now() - lastPollAt) / 1000) : null;
    const status = lastPollAgeSec !== null && lastPollAgeSec < POLL_SEC * 4 ? "ok" : "stale";
    sendJson(res, status === "ok" ? 200 : 503, {
      status,
      uptimeSec,
      lastPollAgeSec,
      lastPollError,
      pollErrorCount,
      lastProcessedBlock: lastProcessedBlock?.toString() ?? null,
      pendingOutcomes: pendingOutcomes.length,
      intermediariesWatched: INTERMEDIARIES.length,
      tokensWatched: TOKEN_WATCHES.map((w) => w.symbol),
      outDir: OUT_DIR,
    });
    return;
  }

  if (path === "/api/summary") {
    try {
      sendJson(res, 200, computeSummary());
    } catch (e) {
      sendJson(res, 500, { error: (e as Error).message });
    }
    return;
  }

  if (path === "/api/events") {
    sendJson(res, 200, { events: loadAllJsonl("-events.jsonl") });
    return;
  }

  if (path === "/api/triggers") {
    sendJson(res, 200, { triggers: loadAllJsonl("-triggers.jsonl") });
    return;
  }

  if (path === "/api/outcomes") {
    sendJson(res, 200, { outcomes: loadAllJsonl("-outcomes.jsonl") });
    return;
  }

  if (path === "/api/intermediaries") {
    sendJson(res, 200, { intermediaries: INTERMEDIARIES });
    return;
  }

  sendJson(res, 404, { error: "not found", validPaths: ["/health", "/api/summary", "/api/events", "/api/triggers", "/api/outcomes", "/api/intermediaries"] });
});

// ----------------------------------------------------------------------------
// Main loop
// ----------------------------------------------------------------------------

async function main() {
  console.log("=== NVR Pattern P-IntermediarySurge — Forward Validation Harness ===");
  console.log(
    `Watching ${INTERMEDIARIES.length} intermediaries on ${TOKEN_WATCHES.length} tokens`,
  );
  console.log(
    `Cluster window: ${CLUSTER_WINDOW_SEC / 60}min, Outcome window: ${OUTCOME_WINDOW_SEC / 60}min, ` +
      `Min N: ${MIN_INTERMEDIARIES}, Poll: ${POLL_SEC}s`,
  );
  console.log(`Output dir: ${OUT_DIR}`);
  console.log(`HTTP port: ${HTTP_PORT}`);
  console.log("");

  httpServer.listen(HTTP_PORT, () => {
    console.log(`HTTP server listening on :${HTTP_PORT}`);
    console.log(`  GET /health             — service status`);
    console.log(`  GET /api/summary        — live verdict`);
    console.log(`  GET /api/events         — all logged intermediary buys`);
    console.log(`  GET /api/triggers       — all cluster triggers`);
    console.log(`  GET /api/outcomes       — all measured outcomes`);
    console.log(`  GET /api/intermediaries — the watched address set`);
    console.log("");
  });
  bootedAt = Date.now();

  // Preload price feed for the watched tokens (recent window)
  const priceFeed = new GeckoTerminalHistoricalFeed({
    timeframe: "minute",
    aggregate: 5,
    log: (m) => console.log(`  ${m}`),
  });
  const nowIso = new Date().toISOString();
  const ago24hIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  console.log("Preloading price feed (last 24h)...");
  await priceFeed.preload(
    TOKEN_WATCHES.map((w) => w.symbol),
    ago24hIso,
    nowIso,
  );
  console.log("Ready. Polling every", POLL_SEC, "sec.\n");

  // Periodic price-feed refresh (every hour)
  let lastPriceRefresh = Date.now();
  const PRICE_REFRESH_MS = 3600 * 1000;

  while (true) {
    const startMs = Date.now();
    try {
      await pollOnce(priceFeed);
      await checkOutcomes(priceFeed);
      lastPollAt = Date.now();
      lastPollError = null;
    } catch (e) {
      const msg = (e as Error).message;
      console.warn(`  poll error: ${msg}`);
      pollErrorCount++;
      lastPollError = msg.slice(0, 200);
    }

    if (Date.now() - lastPriceRefresh > PRICE_REFRESH_MS) {
      console.log("  refreshing price feed...");
      const nowIso2 = new Date().toISOString();
      const ago24hIso2 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      try {
        await priceFeed.preload(
          TOKEN_WATCHES.map((w) => w.symbol),
          ago24hIso2,
          nowIso2,
        );
      } catch (e) {
        console.warn(`  price refresh failed: ${(e as Error).message}`);
      }
      lastPriceRefresh = Date.now();
    }

    const elapsed = Date.now() - startMs;
    const sleepMs = Math.max(0, POLL_SEC * 1000 - elapsed);
    await new Promise((r) => setTimeout(r, sleepMs));
  }
}

main().catch((e) => {
  console.error("\n[FATAL]", e);
  process.exit(1);
});
