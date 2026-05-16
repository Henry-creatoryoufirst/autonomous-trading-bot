/**
 * NVR Capital — Funding-Rate Monitor (NVR-SPEC-034 Phase 1a)
 *
 * READ-ONLY. No trade execution. No perp orders. Default-disabled.
 *
 * Phase 1a venue pivot (2026-05-16): the spec's recommended venue (Vertex on
 * Base) is no longer addressable — Vertex Protocol rebranded to Nado in
 * August 2025 and dropped Base support in July 2025 (the current SDK only
 * supports Kraken's Ink L2). Pivoted Phase 1a to multi-venue aggregator
 * data collection so the venue commitment can be made at Phase 2 with 30d
 * of real cross-venue funding-rate data in hand. Spec §4 already listed
 * CoinGlass + DefiLlama as legitimate data sources; this module talks to
 * the underlying venue REST endpoints directly (OKX, Hyperliquid, Bitfinex)
 * to keep the data path simple and avoid an aggregator middleman.
 *
 * What this module does every heavy cycle when FUNDING_ARB_MONITOR_ENABLED=true:
 *   1. Fetch funding rates for BTC-PERP and ETH-PERP from each venue.
 *   2. Fetch L2 order-book depth snapshot for BTC-PERP and ETH-PERP from
 *      OKX (deepest non-Binance public book, no auth required) every 5 min.
 *   3. Compute realized-slippage estimate at $50/$100/$300/$500 notionals
 *      from the depth snapshot — pure function, fully testable.
 *   4. Append all four data streams to ./logs/funding-rate-history.json.
 *
 * Public API:
 *   - getCurrentFundingRates(): no-op (returns []) when env var unset.
 *   - runMonitorCycle(): no-op when env var unset; otherwise fetches +
 *     persists. Safe to call every heavy cycle from agent-v3.2.ts.
 *
 * Env vars:
 *   - FUNDING_ARB_MONITOR_ENABLED  default false (no network activity)
 *   - FUNDING_ARB_DEPTH_INTERVAL_MS  default 300_000 (5 min)
 */

import axios from 'axios';
import * as fs from 'fs';

// ============================================================================
// CONFIG
// ============================================================================

/**
 * Read lazily so tests and the verification script can flip the env after
 * the module is imported. ESM hoists imports above any `process.env.X = ...`
 * statement, so a module-load-time read would always observe the unset
 * default.
 */
function isEnabled(): boolean {
  return process.env.FUNDING_ARB_MONITOR_ENABLED === 'true';
}
function depthIntervalMs(): number {
  return Number(process.env.FUNDING_ARB_DEPTH_INTERVAL_MS) || 300_000;
}

const PERSIST_DIR = process.env.PERSIST_DIR || './logs';
const HISTORY_FILE = `${PERSIST_DIR}/funding-rate-history.json`;

const MAX_HISTORY_ROWS = 2000;
const REQUEST_TIMEOUT_MS = 8000;

const PERP_ASSETS = ['BTC', 'ETH'] as const;
const NOTIONAL_LADDER = [50, 100, 300, 500] as const;

// ============================================================================
// TYPES
// ============================================================================

export type PerpAsset = (typeof PERP_ASSETS)[number];
export type VenueId = 'okx' | 'hyperliquid' | 'bitfinex';
export type BookSide = 'buy' | 'sell';

export interface FundingRateSample {
  ts: number;
  venue: VenueId;
  asset: PerpAsset;
  /** Per-period rate as a decimal (e.g. 0.000091 = 0.0091% per funding period). */
  rate: number;
  /** Length of one funding period in hours. 8 for OKX/Bitfinex, 1 for Hyperliquid. */
  periodHours: number;
  /** Annualized percentage (e.g. 9.97 = 9.97% APR). Derived from rate + periodHours. */
  annualizedPct: number;
  /** Unix ms; null if the venue does not expose next-funding time. */
  nextFundingTime: number | null;
}

export interface DepthLevel {
  price: number;
  size: number;
}

export interface DepthSnapshot {
  ts: number;
  venue: VenueId;
  asset: PerpAsset;
  bids: DepthLevel[];
  asks: DepthLevel[];
  midPrice: number;
}

export interface SlippagePoint {
  notionalUsd: number;
  fillPrice: number;
  /** Basis points away from mid. Positive = unfavorable to taker. */
  slippageBps: number;
  /** True if the book did not have enough depth to fill the notional. */
  exhausted: boolean;
}

export interface SlippageCurve {
  ts: number;
  venue: VenueId;
  asset: PerpAsset;
  side: BookSide;
  midPrice: number;
  points: SlippagePoint[];
}

export interface HistoryRow {
  ts: number;
  fundingRates: FundingRateSample[];
  depthSnapshots: DepthSnapshot[];
  slippageCurves: SlippageCurve[];
}

interface MonitorStats {
  enabled: boolean;
  lastCycleAt: number | null;
  lastDepthSnapshotAt: number | null;
  cycleCount: number;
  fundingFetchErrors: number;
  depthFetchErrors: number;
  historyRowCount: number;
}

// ============================================================================
// VENUE ADAPTERS — funding rates
// ============================================================================

function annualize(rate: number, periodHours: number): number {
  const periodsPerYear = (365 * 24) / periodHours;
  return rate * periodsPerYear * 100;
}

interface VenueFundingResult {
  samples: FundingRateSample[];
  errors: string[];
}

/**
 * OKX — public, no-auth, 8h funding cadence.
 * GET /api/v5/public/funding-rate?instId=BTC-USDT-SWAP
 */
async function fetchOkxFunding(): Promise<VenueFundingResult> {
  const samples: FundingRateSample[] = [];
  const errors: string[] = [];

  for (const asset of PERP_ASSETS) {
    const instId = `${asset}-USDT-SWAP`;
    try {
      const res = await axios.get(
        `https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`,
        { timeout: REQUEST_TIMEOUT_MS },
      );
      const row = res.data?.data?.[0];
      if (!row) {
        errors.push(`okx ${asset}: empty response`);
        continue;
      }
      const rate = Number(row.fundingRate);
      if (!Number.isFinite(rate)) {
        errors.push(`okx ${asset}: non-numeric rate "${row.fundingRate}"`);
        continue;
      }
      samples.push({
        ts: Date.now(),
        venue: 'okx',
        asset,
        rate,
        periodHours: 8,
        annualizedPct: annualize(rate, 8),
        nextFundingTime: row.nextFundingTime ? Number(row.nextFundingTime) : null,
      });
    } catch (err: unknown) {
      errors.push(`okx ${asset}: ${(err as Error).message?.slice(0, 100)}`);
    }
  }

  return { samples, errors };
}

/**
 * Hyperliquid — public, no-auth, hourly funding.
 * POST /info  body { type: 'metaAndAssetCtxs' }
 *
 * Response shape: [{ universe: [{ name, ... }, ...], ... }, [{ funding, openInterest, ... }, ...]]
 * The funding array is positionally aligned with the universe array.
 */
async function fetchHyperliquidFunding(): Promise<VenueFundingResult> {
  const samples: FundingRateSample[] = [];
  const errors: string[] = [];

  try {
    const res = await axios.post(
      'https://api.hyperliquid.xyz/info',
      { type: 'metaAndAssetCtxs' },
      { timeout: REQUEST_TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } },
    );
    const [meta, ctxs] = res.data as [{ universe: Array<{ name: string }> }, Array<{ funding: string }>];
    if (!meta?.universe || !Array.isArray(ctxs)) {
      errors.push('hyperliquid: unexpected response shape');
      return { samples, errors };
    }
    for (const asset of PERP_ASSETS) {
      const idx = meta.universe.findIndex(u => u.name === asset);
      if (idx < 0) {
        errors.push(`hyperliquid ${asset}: not in universe`);
        continue;
      }
      const ctx = ctxs[idx];
      const rate = Number(ctx?.funding);
      if (!Number.isFinite(rate)) {
        errors.push(`hyperliquid ${asset}: non-numeric funding "${ctx?.funding}"`);
        continue;
      }
      samples.push({
        ts: Date.now(),
        venue: 'hyperliquid',
        asset,
        rate,
        periodHours: 1,
        annualizedPct: annualize(rate, 1),
        nextFundingTime: null,
      });
    }
  } catch (err: unknown) {
    errors.push(`hyperliquid: ${(err as Error).message?.slice(0, 100)}`);
  }

  return { samples, errors };
}

/**
 * Bitfinex — public, no-auth, 8h funding cadence on perp F0 contracts.
 * GET /v2/status/deriv?keys=tBTCF0:USTF0,tETHF0:USTF0
 *
 * Response is an array of arrays; field [11] is the current funding rate.
 * Field schema per https://docs.bitfinex.com/reference/rest-public-derivatives-status
 */
async function fetchBitfinexFunding(): Promise<VenueFundingResult> {
  const samples: FundingRateSample[] = [];
  const errors: string[] = [];
  const keys = PERP_ASSETS.map(a => `t${a}F0:USTF0`).join(',');

  try {
    const res = await axios.get(
      `https://api-pub.bitfinex.com/v2/status/deriv?keys=${keys}`,
      { timeout: REQUEST_TIMEOUT_MS },
    );
    const rows = res.data as Array<Array<number | string | null>>;
    if (!Array.isArray(rows)) {
      errors.push('bitfinex: unexpected response shape');
      return { samples, errors };
    }
    for (const row of rows) {
      const key = row[0] as string;
      const match = /^t([A-Z]+)F0:USTF0$/.exec(key);
      const assetName = match?.[1] as PerpAsset | undefined;
      if (!assetName || !PERP_ASSETS.includes(assetName)) continue;
      const rate = Number(row[11]);
      if (!Number.isFinite(rate)) {
        errors.push(`bitfinex ${assetName}: non-numeric funding`);
        continue;
      }
      samples.push({
        ts: Date.now(),
        venue: 'bitfinex',
        asset: assetName,
        rate,
        periodHours: 8,
        annualizedPct: annualize(rate, 8),
        nextFundingTime: typeof row[8] === 'number' ? (row[8] as number) : null,
      });
    }
  } catch (err: unknown) {
    errors.push(`bitfinex: ${(err as Error).message?.slice(0, 100)}`);
  }

  return { samples, errors };
}

// ============================================================================
// VENUE ADAPTERS — order-book depth (OKX only for Phase 1a)
// ============================================================================

/**
 * OKX L2 order book — public, no-auth.
 * GET /api/v5/market/books?instId=BTC-USDT-SWAP&sz=400
 *
 * Response asks/bids are arrays of [price, size, _, _] strings, sorted with
 * best price first (asks ascending, bids descending).
 */
async function fetchOkxDepth(asset: PerpAsset): Promise<DepthSnapshot | null> {
  const instId = `${asset}-USDT-SWAP`;
  try {
    const res = await axios.get(
      `https://www.okx.com/api/v5/market/books?instId=${instId}&sz=400`,
      { timeout: REQUEST_TIMEOUT_MS },
    );
    const book = res.data?.data?.[0];
    if (!book?.asks?.length || !book?.bids?.length) return null;

    const asks: DepthLevel[] = book.asks.map((lvl: string[]) => ({
      price: Number(lvl[0]),
      size: Number(lvl[1]),
    }));
    const bids: DepthLevel[] = book.bids.map((lvl: string[]) => ({
      price: Number(lvl[0]),
      size: Number(lvl[1]),
    }));
    const midPrice = (asks[0].price + bids[0].price) / 2;

    return {
      ts: Date.now(),
      venue: 'okx',
      asset,
      bids,
      asks,
      midPrice,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// PURE SLIPPAGE MATH — fully testable
// ============================================================================

/**
 * Walk the book to fill a USD-notional taker order and report the resulting
 * volume-weighted fill price + slippage in basis points vs. mid.
 *
 * - side='buy' walks the ask ladder (taker buy hits asks).
 * - side='sell' walks the bid ladder (taker sell hits bids).
 *
 * If the book runs out of depth before the notional is filled, `exhausted`
 * is true and `fillPrice` reflects the partial fill.
 */
export function computeSlippageFromBook(
  book: { asks: DepthLevel[]; bids: DepthLevel[] },
  notionalUsd: number,
  side: BookSide,
  midPrice?: number,
): { fillPrice: number; slippageBps: number; exhausted: boolean } {
  if (notionalUsd <= 0) {
    throw new Error(`computeSlippageFromBook: notionalUsd must be > 0 (got ${notionalUsd})`);
  }

  const ladder = side === 'buy' ? book.asks : book.bids;
  if (!ladder.length) {
    return { fillPrice: 0, slippageBps: Infinity, exhausted: true };
  }

  const mid = midPrice ?? (book.asks[0] && book.bids[0]
    ? (book.asks[0].price + book.bids[0].price) / 2
    : ladder[0].price);

  let remainingUsd = notionalUsd;
  let baseFilled = 0;
  let usdSpent = 0;

  for (const level of ladder) {
    if (level.price <= 0 || level.size <= 0) continue;
    const levelNotional = level.price * level.size;
    if (levelNotional >= remainingUsd) {
      const baseAtThisLevel = remainingUsd / level.price;
      baseFilled += baseAtThisLevel;
      usdSpent += remainingUsd;
      remainingUsd = 0;
      break;
    }
    baseFilled += level.size;
    usdSpent += levelNotional;
    remainingUsd -= levelNotional;
  }

  const exhausted = remainingUsd > 0;
  const fillPrice = baseFilled > 0 ? usdSpent / baseFilled : 0;
  const slippage = side === 'buy' ? fillPrice - mid : mid - fillPrice;
  const slippageBps = mid > 0 ? (slippage / mid) * 10_000 : Infinity;

  return { fillPrice, slippageBps, exhausted };
}

export function computeSlippageCurve(snapshot: DepthSnapshot, side: BookSide): SlippageCurve {
  const points: SlippagePoint[] = NOTIONAL_LADDER.map(notional => {
    const { fillPrice, slippageBps, exhausted } = computeSlippageFromBook(
      { asks: snapshot.asks, bids: snapshot.bids },
      notional,
      side,
      snapshot.midPrice,
    );
    return { notionalUsd: notional, fillPrice, slippageBps, exhausted };
  });
  return {
    ts: snapshot.ts,
    venue: snapshot.venue,
    asset: snapshot.asset,
    side,
    midPrice: snapshot.midPrice,
    points,
  };
}

// ============================================================================
// PERSISTENCE — append-only ring file (mirrors trailing-stops.ts pattern)
// ============================================================================

interface HistoryFile {
  version: number;
  lastSaved: string;
  rows: HistoryRow[];
}

function loadHistory(): HistoryFile {
  try {
    if (!fs.existsSync(HISTORY_FILE)) {
      return { version: 1, lastSaved: new Date(0).toISOString(), rows: [] };
    }
    const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as HistoryFile;
    if (!parsed.rows || !Array.isArray(parsed.rows)) {
      return { version: 1, lastSaved: new Date(0).toISOString(), rows: [] };
    }
    return parsed;
  } catch {
    return { version: 1, lastSaved: new Date(0).toISOString(), rows: [] };
  }
}

function saveHistory(file: HistoryFile): void {
  try {
    if (!fs.existsSync(PERSIST_DIR)) fs.mkdirSync(PERSIST_DIR, { recursive: true });
    const tmp = HISTORY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(file));
    fs.renameSync(tmp, HISTORY_FILE);
  } catch (err: unknown) {
    console.warn(`  ⚠️ funding-rate-monitor: failed to persist history — ${(err as Error).message}`);
  }
}

function appendHistoryRow(row: HistoryRow): void {
  const file = loadHistory();
  file.rows.push(row);
  if (file.rows.length > MAX_HISTORY_ROWS) {
    file.rows = file.rows.slice(-MAX_HISTORY_ROWS);
  }
  file.lastSaved = new Date().toISOString();
  saveHistory(file);
}

// ============================================================================
// MONITOR LOOP — single-cycle entry point
// ============================================================================

const _stats: Omit<MonitorStats, 'enabled'> = {
  lastCycleAt: null,
  lastDepthSnapshotAt: null,
  cycleCount: 0,
  fundingFetchErrors: 0,
  depthFetchErrors: 0,
  historyRowCount: 0,
};

async function fetchAllFundingRates(): Promise<{ samples: FundingRateSample[]; errors: string[] }> {
  const [okx, hyp, btfx] = await Promise.all([
    fetchOkxFunding(),
    fetchHyperliquidFunding(),
    fetchBitfinexFunding(),
  ]);
  return {
    samples: [...okx.samples, ...hyp.samples, ...btfx.samples],
    errors: [...okx.errors, ...hyp.errors, ...btfx.errors],
  };
}

/**
 * Public read for callers that just want the latest cross-venue funding
 * snapshot. No-op (empty array) when the monitor is disabled, so importing
 * this module from agent-v3.2.ts does not trigger any network activity by
 * default.
 */
export async function getCurrentFundingRates(): Promise<FundingRateSample[]> {
  if (!isEnabled()) return [];
  const { samples } = await fetchAllFundingRates();
  return samples;
}

/**
 * Run one full Phase 1a cycle: fetch funding from all venues, fetch a depth
 * snapshot (rate-limited to DEPTH_INTERVAL_MS), compute the slippage curve,
 * and append a row to funding-rate-history.json.
 *
 * Returns the row that was written, or null if disabled.
 */
export async function runMonitorCycle(): Promise<HistoryRow | null> {
  if (!isEnabled()) return null;

  const now = Date.now();
  const { samples, errors: fundingErrors } = await fetchAllFundingRates();
  _stats.fundingFetchErrors += fundingErrors.length;

  const sinceLastDepth = _stats.lastDepthSnapshotAt
    ? now - _stats.lastDepthSnapshotAt
    : Infinity;

  let depthSnapshots: DepthSnapshot[] = [];
  const slippageCurves: SlippageCurve[] = [];

  if (sinceLastDepth >= depthIntervalMs()) {
    const snapshots = await Promise.all(PERP_ASSETS.map(a => fetchOkxDepth(a)));
    depthSnapshots = snapshots.filter((s): s is DepthSnapshot => s !== null);
    _stats.depthFetchErrors += snapshots.length - depthSnapshots.length;
    for (const snap of depthSnapshots) {
      slippageCurves.push(computeSlippageCurve(snap, 'buy'));
      slippageCurves.push(computeSlippageCurve(snap, 'sell'));
    }
    if (depthSnapshots.length > 0) {
      _stats.lastDepthSnapshotAt = now;
    }
  }

  const row: HistoryRow = {
    ts: now,
    fundingRates: samples,
    depthSnapshots,
    slippageCurves,
  };

  appendHistoryRow(row);
  _stats.cycleCount += 1;
  _stats.lastCycleAt = now;
  _stats.historyRowCount = loadHistory().rows.length;

  return row;
}

export function getMonitorStats(): MonitorStats {
  return { enabled: isEnabled(), ..._stats };
}

// Test/internal exports — not part of the runtime contract but used by the
// verification script and tests.
export const _internals = {
  fetchOkxFunding,
  fetchHyperliquidFunding,
  fetchBitfinexFunding,
  fetchOkxDepth,
  annualize,
  loadHistory,
  HISTORY_FILE,
  NOTIONAL_LADDER,
  PERP_ASSETS,
};
