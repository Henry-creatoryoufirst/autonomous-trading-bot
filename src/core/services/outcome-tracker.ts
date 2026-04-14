/**
 * Outcome Tracker — NVR Capital
 *
 * Records tokens surfaced as alpha opportunities and tracks their actual price
 * performance at 1h/4h/24h intervals. This data feeds back into signal
 * calibration — making the alpha pipeline recursive and self-improving.
 */

import fs from 'fs';
import path from 'path';
import axios from 'axios';

// ============================================================================
// TYPES
// ============================================================================

export interface DiscoveryOutcome {
  id: string;                    // `${tokenAddress}_${discoveredAt}`
  tokenAddress: string;
  symbol: string;
  discoveredAt: string;          // ISO timestamp
  entryPriceUSD: number;
  compositeScore: number;
  haikuRecommendation?: 'ENTRY_ZONE' | 'WATCH' | 'AVOID';
  smartWalletIds: string[];       // which smart wallets were active on this token
  lpLocked?: boolean;
  holderConcentration?: number;
  priceChange24hAtDiscovery: number; // what price change was at time of discovery

  // Filled in by background checker:
  priceAt1h?: number;
  priceAt4h?: number;
  priceAt24h?: number;
  returnAt1h?: number;           // percent, e.g. 15.3 = +15.3%
  returnAt4h?: number;
  returnAt24h?: number;
  checkedAt1h?: string;
  checkedAt4h?: string;
  checkedAt24h?: string;
}

export interface WalletHitRate {
  walletId: string;
  totalSignals: number;          // how many times this wallet was in a surfaced token
  hits1h: number;                // tokens that went up >10% in 1h
  hits4h: number;                // tokens that went up >10% in 4h
  hits24h: number;               // tokens that went up >15% in 24h
  hitRate4h: number;             // 0-1, primary metric
  lastUpdated: string;
}

export interface SignalAccuracy {
  metric: 'lpLocked' | 'holderConcentration' | 'haikuEntryZone' | 'smartWalletStrong';
  totalSamples: number;
  avgReturn4h: number;           // average 4h return when signal was present
  avgReturn4hBaseline: number;   // average 4h return when signal was absent
  edge: number;                  // avgReturn4h - avgReturn4hBaseline (positive = signal has edge)
  lastUpdated: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DATA_DIR = path.resolve(process.cwd(), 'data');
const OUTCOMES_FILE = path.join(DATA_DIR, 'outcomes.json');
const MAX_OUTCOMES = 500;
const MIN_SAMPLES_FOR_ACCURACY = 5;

// Hit thresholds
const HIT_THRESHOLD_1H = 10;  // +10% in 1h = hit
const HIT_THRESHOLD_4H = 10;  // +10% in 4h = hit
const HIT_THRESHOLD_24H = 15; // +15% in 24h = hit

// ============================================================================
// PRICE FETCHING
// ============================================================================

/**
 * Fetch the current USD price for a Base chain token via DexScreener.
 * Returns null on any failure — callers handle gracefully.
 */
async function fetchCurrentPrice(tokenAddress: string): Promise<number | null> {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
    const res = await axios.get(url, { timeout: 8000 });

    const pairs: any[] = res.data?.pairs || [];
    if (pairs.length === 0) return null;

    // Prefer Base chain pairs, then take the highest-liquidity pair
    const basePairs = pairs.filter((p: any) => p.chainId === 'base');
    const pool = basePairs.length > 0 ? basePairs : pairs;
    const best = pool.sort((a: any, b: any) =>
      (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
    )[0];

    const price = parseFloat(best?.priceUsd ?? '0');
    return price > 0 ? price : null;
  } catch {
    return null;
  }
}

// ============================================================================
// OUTCOME TRACKER CLASS
// ============================================================================

class OutcomeTracker {
  private outcomes: Map<string, DiscoveryOutcome> = new Map();
  private dataPath: string = OUTCOMES_FILE;

  // ——— Recording ———————————————————————————————————————————————

  /**
   * Record a new token discovery opportunity.
   * Deduplicates within the same hour — one entry per token per 60min window.
   */
  record(token: {
    address: string;
    symbol: string;
    priceUSD: number;
    compositeScore: number;
    haikuRecommendation?: string;
    smartWalletIds?: string[];
    lpLocked?: boolean;
    holderConcentration?: number;
    priceChange24h: number;
  }): void {
    // Deduplicate: skip if this token was already recorded in the last 60 minutes
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const existing of this.outcomes.values()) {
      if (
        existing.tokenAddress.toLowerCase() === token.address.toLowerCase() &&
        new Date(existing.discoveredAt).getTime() > oneHourAgo
      ) {
        return; // already tracked recently
      }
    }

    const discoveredAt = new Date().toISOString();
    const id = `${token.address.toLowerCase()}_${discoveredAt}`;

    const rec: string = token.haikuRecommendation ?? '';
    const haikuRec: DiscoveryOutcome['haikuRecommendation'] =
      rec === 'ENTRY_ZONE' || rec === 'WATCH' || rec === 'AVOID'
        ? rec
        : undefined;

    const outcome: DiscoveryOutcome = {
      id,
      tokenAddress: token.address.toLowerCase(),
      symbol: token.symbol,
      discoveredAt,
      entryPriceUSD: token.priceUSD,
      compositeScore: token.compositeScore,
      haikuRecommendation: haikuRec,
      smartWalletIds: token.smartWalletIds ?? [],
      lpLocked: token.lpLocked,
      holderConcentration: token.holderConcentration,
      priceChange24hAtDiscovery: token.priceChange24h,
    };

    this.outcomes.set(id, outcome);

    // Prune oldest if over limit
    if (this.outcomes.size > MAX_OUTCOMES) {
      const sorted = Array.from(this.outcomes.entries()).sort(
        ([, a], [, b]) => new Date(a.discoveredAt).getTime() - new Date(b.discoveredAt).getTime()
      );
      // Remove oldest 50 entries to avoid pruning on every record
      for (const [key] of sorted.slice(0, 50)) {
        this.outcomes.delete(key);
      }
    }

    this.save();
    console.log(`[OutcomeTracker] Recorded ${token.symbol} @ $${token.priceUSD.toFixed(6)} (score: ${token.compositeScore})`);
  }

  // ——— Background price checker ——————————————————————————————

  /**
   * Check prices for all pending outcomes and compute returns.
   * Called every 30 minutes by the background job in signal-service.ts.
   */
  async checkPendingOutcomes(): Promise<void> {
    const now = Date.now();
    let updated = 0;

    for (const [id, outcome] of this.outcomes.entries()) {
      const discoveredMs = new Date(outcome.discoveredAt).getTime();
      const ageMs = now - discoveredMs;
      let changed = false;

      // Check 1h price
      if (!outcome.priceAt1h && ageMs >= 60 * 60 * 1000) {
        const price = await fetchCurrentPrice(outcome.tokenAddress);
        if (price !== null && outcome.entryPriceUSD > 0) {
          outcome.priceAt1h = price;
          outcome.returnAt1h = ((price - outcome.entryPriceUSD) / outcome.entryPriceUSD) * 100;
          outcome.checkedAt1h = new Date().toISOString();
          changed = true;
        }
      }

      // Check 4h price
      if (!outcome.priceAt4h && ageMs >= 4 * 60 * 60 * 1000) {
        const price = await fetchCurrentPrice(outcome.tokenAddress);
        if (price !== null && outcome.entryPriceUSD > 0) {
          outcome.priceAt4h = price;
          outcome.returnAt4h = ((price - outcome.entryPriceUSD) / outcome.entryPriceUSD) * 100;
          outcome.checkedAt4h = new Date().toISOString();
          changed = true;
        }
      }

      // Check 24h price
      if (!outcome.priceAt24h && ageMs >= 24 * 60 * 60 * 1000) {
        const price = await fetchCurrentPrice(outcome.tokenAddress);
        if (price !== null && outcome.entryPriceUSD > 0) {
          outcome.priceAt24h = price;
          outcome.returnAt24h = ((price - outcome.entryPriceUSD) / outcome.entryPriceUSD) * 100;
          outcome.checkedAt24h = new Date().toISOString();
          changed = true;
        }
      }

      if (changed) {
        this.outcomes.set(id, outcome);
        updated++;
      }
    }

    if (updated > 0) {
      this.save();
      console.log(`[OutcomeTracker] Updated ${updated} outcome(s) with current prices`);
    } else {
      console.log(`[OutcomeTracker] Price check complete — no pending updates (${this.outcomes.size} tracked)`);
    }
  }

  // ——— Analytics ———————————————————————————————————————————————

  /**
   * Get hit rates per smart wallet — which wallets actually predicted moves.
   * Only returns wallets with at least 1 signal.
   */
  getWalletHitRates(): WalletHitRate[] {
    // Aggregate per wallet
    const walletStats = new Map<string, {
      totalSignals: number;
      hits1h: number;
      hits4h: number;
      hits24h: number;
    }>();

    for (const outcome of this.outcomes.values()) {
      for (const walletId of outcome.smartWalletIds) {
        const stats = walletStats.get(walletId) ?? { totalSignals: 0, hits1h: 0, hits4h: 0, hits24h: 0 };
        stats.totalSignals++;
        if (outcome.returnAt1h !== undefined && outcome.returnAt1h >= HIT_THRESHOLD_1H) stats.hits1h++;
        if (outcome.returnAt4h !== undefined && outcome.returnAt4h >= HIT_THRESHOLD_4H) stats.hits4h++;
        if (outcome.returnAt24h !== undefined && outcome.returnAt24h >= HIT_THRESHOLD_24H) stats.hits24h++;
        walletStats.set(walletId, stats);
      }
    }

    const now = new Date().toISOString();
    return Array.from(walletStats.entries())
      .map(([walletId, stats]) => ({
        walletId,
        totalSignals: stats.totalSignals,
        hits1h: stats.hits1h,
        hits4h: stats.hits4h,
        hits24h: stats.hits24h,
        hitRate4h: stats.totalSignals > 0 ? stats.hits4h / stats.totalSignals : 0,
        lastUpdated: now,
      }))
      .sort((a, b) => b.hitRate4h - a.hitRate4h);
  }

  /**
   * Compute signal accuracy — which signals actually predicted 4h moves.
   * Returns only signals with >= MIN_SAMPLES_FOR_ACCURACY data points on both sides.
   */
  getSignalAccuracy(): SignalAccuracy[] {
    const now = new Date().toISOString();

    // Only use outcomes that have 4h data
    const resolved = Array.from(this.outcomes.values()).filter(
      (o) => o.returnAt4h !== undefined
    );
    if (resolved.length < MIN_SAMPLES_FOR_ACCURACY) return [];

    const results: SignalAccuracy[] = [];

    // Helper: compute average return for a group
    const avg = (arr: number[]): number =>
      arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;

    // ——— lpLocked ———————————————————————————————————————————
    const lpLockedWith = resolved.filter((o) => o.lpLocked === true).map((o) => o.returnAt4h as number);
    const lpLockedWithout = resolved.filter((o) => o.lpLocked === false || o.lpLocked === undefined).map((o) => o.returnAt4h as number);
    if (lpLockedWith.length >= MIN_SAMPLES_FOR_ACCURACY && lpLockedWithout.length >= MIN_SAMPLES_FOR_ACCURACY) {
      const avgWith = avg(lpLockedWith);
      const avgWithout = avg(lpLockedWithout);
      results.push({
        metric: 'lpLocked',
        totalSamples: lpLockedWith.length + lpLockedWithout.length,
        avgReturn4h: avgWith,
        avgReturn4hBaseline: avgWithout,
        edge: avgWith - avgWithout,
        lastUpdated: now,
      });
    }

    // ——— holderConcentration (low concentration = more distributed = better) ——
    // "signal present" = holderConcentration < 50% (healthy distribution)
    const holderGood = resolved.filter((o) => o.holderConcentration !== undefined && o.holderConcentration < 50).map((o) => o.returnAt4h as number);
    const holderBad = resolved.filter((o) => o.holderConcentration !== undefined && o.holderConcentration >= 50).map((o) => o.returnAt4h as number);
    if (holderGood.length >= MIN_SAMPLES_FOR_ACCURACY && holderBad.length >= MIN_SAMPLES_FOR_ACCURACY) {
      const avgGood = avg(holderGood);
      const avgBad = avg(holderBad);
      results.push({
        metric: 'holderConcentration',
        totalSamples: holderGood.length + holderBad.length,
        avgReturn4h: avgGood,
        avgReturn4hBaseline: avgBad,
        edge: avgGood - avgBad,
        lastUpdated: now,
      });
    }

    // ——— haikuEntryZone ————————————————————————————————————————
    const haikuEntryZone = resolved.filter((o) => o.haikuRecommendation === 'ENTRY_ZONE').map((o) => o.returnAt4h as number);
    const haikuOther = resolved.filter((o) => o.haikuRecommendation !== 'ENTRY_ZONE').map((o) => o.returnAt4h as number);
    if (haikuEntryZone.length >= MIN_SAMPLES_FOR_ACCURACY && haikuOther.length >= MIN_SAMPLES_FOR_ACCURACY) {
      const avgEntry = avg(haikuEntryZone);
      const avgOther = avg(haikuOther);
      results.push({
        metric: 'haikuEntryZone',
        totalSamples: haikuEntryZone.length + haikuOther.length,
        avgReturn4h: avgEntry,
        avgReturn4hBaseline: avgOther,
        edge: avgEntry - avgOther,
        lastUpdated: now,
      });
    }

    // ——— smartWalletStrong (3+ wallets = STRONG) ——————————————
    const swStrong = resolved.filter((o) => o.smartWalletIds.length >= 3).map((o) => o.returnAt4h as number);
    const swOther = resolved.filter((o) => o.smartWalletIds.length < 3).map((o) => o.returnAt4h as number);
    if (swStrong.length >= MIN_SAMPLES_FOR_ACCURACY && swOther.length >= MIN_SAMPLES_FOR_ACCURACY) {
      const avgStrong = avg(swStrong);
      const avgOther = avg(swOther);
      results.push({
        metric: 'smartWalletStrong',
        totalSamples: swStrong.length + swOther.length,
        avgReturn4h: avgStrong,
        avgReturn4hBaseline: avgOther,
        edge: avgStrong - avgOther,
        lastUpdated: now,
      });
    }

    return results;
  }

  /**
   * Get recent outcomes for display/logging — most recent first.
   */
  getRecentOutcomes(limit: number = 20): DiscoveryOutcome[] {
    return Array.from(this.outcomes.values())
      .sort((a, b) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime())
      .slice(0, limit);
  }

  getTotalTracked(): number {
    return this.outcomes.size;
  }

  // ——— Persistence ——————————————————————————————————————————————

  /** Persist outcomes to disk. Creates data/ directory if missing. */
  private save(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const data = Array.from(this.outcomes.values());
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('[OutcomeTracker] Failed to save outcomes:', err);
    }
  }

  /** Load outcomes from disk on startup. Safe — returns empty if file missing/corrupt. */
  load(): void {
    try {
      if (!fs.existsSync(this.dataPath)) {
        console.log('[OutcomeTracker] No existing outcomes file — starting fresh');
        return;
      }
      const raw = fs.readFileSync(this.dataPath, 'utf8');
      const data: DiscoveryOutcome[] = JSON.parse(raw);
      this.outcomes.clear();
      for (const o of data) {
        this.outcomes.set(o.id, o);
      }
      console.log(`[OutcomeTracker] Loaded ${this.outcomes.size} outcomes from disk`);
    } catch (err) {
      console.error('[OutcomeTracker] Failed to load outcomes (starting fresh):', err);
    }
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const outcomeTracker = new OutcomeTracker();
