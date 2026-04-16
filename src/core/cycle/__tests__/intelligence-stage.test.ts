/**
 * Unit tests for Phase 5c intelligence-stage pure helpers.
 *
 * Covers the three exported pure functions:
 *   computeVolumeSpikes()
 *   signalFromTxnRatios()
 *   mergeDexScreenerIntoIntel()
 *   buildDexIntelFromDexScreener()
 */

import { describe, it, expect } from 'vitest';
import {
  computeVolumeSpikes,
  signalFromTxnRatios,
  mergeDexScreenerIntoIntel,
  buildDexIntelFromDexScreener,
  type DexScreenerTxnEntry,
} from '../stages/intelligence.js';
import type { MarketData } from '../../types/market-data.js';
import type { BuySellPressure } from '../../services/gecko-terminal.js';

// ─── computeVolumeSpikes ────────────────────────────────────────────────────

function makeTokens(): MarketData['tokens'] {
  return [
    { symbol: 'ETH',  price: 3000, priceChange24h: 1, priceChange7d: 0, volume24h: 1e9, marketCap: 3e11, sector: 'BLUE_CHIP', name: 'Ethereum' },
    { symbol: 'BTC',  price: 65000, priceChange24h: 2, priceChange7d: 0, volume24h: 2e9, marketCap: 1e12, sector: 'BLUE_CHIP', name: 'Bitcoin' },
    { symbol: 'DOGE', price: 0.12, priceChange24h: 5, priceChange7d: 0, volume24h: 5e8, marketCap: 1e10, sector: 'MEME', name: 'Dogecoin' },
  ];
}

function makeIndicators(overrides: Record<string, number | null> = {}): MarketData['indicators'] {
  // volumeChange24h: percentage. threshold 2.0 means volumeMultiple = 1 + val/100 >= 2.0 → val >= 100
  return {
    ETH:  { volumeChange24h: overrides['ETH']  ?? 50,  rsi14: 55, macd: null, bollingerBands: null, trendDirection: 'UP', confluenceScore: 10, overallSignal: 'HOLD', orderFlow: null } as any,
    BTC:  { volumeChange24h: overrides['BTC']  ?? 110, rsi14: 60, macd: null, bollingerBands: null, trendDirection: 'UP', confluenceScore: 20, overallSignal: 'BUY',  orderFlow: null } as any,
    DOGE: { volumeChange24h: overrides['DOGE'] ?? null, rsi14: 40, macd: null, bollingerBands: null, trendDirection: 'DOWN', confluenceScore: -5, overallSignal: 'HOLD', orderFlow: null } as any,
  };
}

describe('computeVolumeSpikes', () => {
  it('returns tokens whose volumeMultiple >= threshold', () => {
    // threshold 2.0 → volumeChange >= 100%
    const spikes = computeVolumeSpikes(makeTokens(), makeIndicators(), 2.0);
    expect(spikes.map(s => s.symbol)).toEqual(['BTC']); // BTC has +110% → multiple = 2.1
  });

  it('excludes tokens below threshold', () => {
    const spikes = computeVolumeSpikes(makeTokens(), makeIndicators(), 2.0);
    const symbols = spikes.map(s => s.symbol);
    expect(symbols).not.toContain('ETH');  // +50% → multiple 1.5 < 2.0
  });

  it('skips tokens with null volumeChange24h', () => {
    const spikes = computeVolumeSpikes(makeTokens(), makeIndicators(), 2.0);
    const symbols = spikes.map(s => s.symbol);
    expect(symbols).not.toContain('DOGE'); // null → skipped
  });

  it('preserves volumeChange value on the spike entry', () => {
    const spikes = computeVolumeSpikes(makeTokens(), makeIndicators(), 2.0);
    expect(spikes[0].volumeChange).toBe(110);
  });

  it('returns empty array when no spikes', () => {
    const spikes = computeVolumeSpikes(makeTokens(), makeIndicators({ ETH: 10, BTC: 20 }), 2.0);
    expect(spikes).toHaveLength(0);
  });

  it('returns all qualifying tokens', () => {
    const spikes = computeVolumeSpikes(makeTokens(), makeIndicators({ ETH: 150, BTC: 200 }), 2.0);
    expect(spikes).toHaveLength(2);
  });
});

// ─── signalFromTxnRatios ────────────────────────────────────────────────────

describe('signalFromTxnRatios', () => {
  it('returns STRONG_BUY when h1 > 0.65 and h24 > 0.55', () => {
    expect(signalFromTxnRatios(0.7, 0.6)).toBe('STRONG_BUY');
  });

  it('returns BUY_PRESSURE when h1 > 0.55 but h24 not qualifying for STRONG_BUY', () => {
    expect(signalFromTxnRatios(0.6, 0.5)).toBe('BUY_PRESSURE');
  });

  it('returns STRONG_SELL when h1 < 0.35 and h24 < 0.45', () => {
    expect(signalFromTxnRatios(0.3, 0.4)).toBe('STRONG_SELL');
  });

  it('returns SELL_PRESSURE when h1 < 0.45 but not STRONG_SELL', () => {
    expect(signalFromTxnRatios(0.4, 0.5)).toBe('SELL_PRESSURE');
  });

  it('returns NEUTRAL in the middle band', () => {
    expect(signalFromTxnRatios(0.5, 0.5)).toBe('NEUTRAL');
  });

  it('STRONG_BUY requires both conditions (h24 check)', () => {
    // h1 > 0.65 but h24 not > 0.55 → falls to BUY_PRESSURE
    expect(signalFromTxnRatios(0.7, 0.5)).toBe('BUY_PRESSURE');
  });
});

// ─── mergeDexScreenerIntoIntel ──────────────────────────────────────────────

function makeExisting(): BuySellPressure[] {
  return [
    { symbol: 'ETH', h1Buys: 100, h1Sells: 50, h1Buyers: 80, h1Sellers: 40,
      h24Buys: 500, h24Sells: 200, buyRatioH1: 0.67, buyRatioH24: 0.71, signal: 'STRONG_BUY' },
  ];
}

function makeTxnCache(entries: Record<string, Partial<DexScreenerTxnEntry> & { symbol?: string }> = {}): Record<string, DexScreenerTxnEntry> {
  const cache: Record<string, DexScreenerTxnEntry> = {};
  const now = Date.now();
  for (const [sym, e] of Object.entries(entries)) {
    cache[sym] = {
      h1Buys: e.h1Buys ?? 50,
      h1Sells: e.h1Sells ?? 30,
      h24Buys: e.h24Buys ?? 200,
      h24Sells: e.h24Sells ?? 100,
      h1Buyers: e.h1Buyers ?? 40,
      h1Sellers: e.h1Sellers ?? 25,
      updatedAt: e.updatedAt ?? now,
    };
  }
  return cache;
}

describe('mergeDexScreenerIntoIntel', () => {
  it('adds tokens not covered by GeckoTerminal', () => {
    const existing = makeExisting();
    const txnCache = makeTxnCache({ AERO: {}, VIRTUAL: {} });
    const merged = mergeDexScreenerIntoIntel(existing, txnCache);
    const symbols = merged.map(p => p.symbol);
    expect(symbols).toContain('AERO');
    expect(symbols).toContain('VIRTUAL');
  });

  it('does NOT replace existing GeckoTerminal entries', () => {
    const existing = makeExisting(); // has ETH
    const txnCache = makeTxnCache({ ETH: {} }); // ETH also in cache
    const merged = mergeDexScreenerIntoIntel(existing, txnCache);
    // ETH should appear only once and keep the original GeckoTerminal entry
    const ethEntries = merged.filter(p => p.symbol === 'ETH');
    expect(ethEntries).toHaveLength(1);
    expect(ethEntries[0].buyRatioH1).toBe(0.67); // original
  });

  it('skips stale entries (> 120s)', () => {
    const existing = makeExisting();
    const staleAt = Date.now() - 130_000;
    const txnCache = makeTxnCache({ STALE_TOKEN: { updatedAt: staleAt } });
    const merged = mergeDexScreenerIntoIntel(existing, txnCache);
    expect(merged.map(p => p.symbol)).not.toContain('STALE_TOKEN');
  });

  it('skips entries with too-low activity (< 5 h1 AND < 20 h24)', () => {
    const existing = makeExisting();
    const txnCache = makeTxnCache({ LOW_VOL: { h1Buys: 2, h1Sells: 2, h24Buys: 5, h24Sells: 5 } });
    const merged = mergeDexScreenerIntoIntel(existing, txnCache);
    expect(merged.map(p => p.symbol)).not.toContain('LOW_VOL');
  });

  it('computes buyRatioH1 correctly', () => {
    const existing = makeExisting();
    const txnCache = makeTxnCache({ NEW: { h1Buys: 80, h1Sells: 20, h24Buys: 300, h24Sells: 100 } });
    const merged = mergeDexScreenerIntoIntel(existing, txnCache);
    const newEntry = merged.find(p => p.symbol === 'NEW')!;
    expect(newEntry.buyRatioH1).toBe(0.8);
  });

  it('computes signal from ratios', () => {
    const existing = makeExisting();
    // strong buy: h1 = 0.8, h24 = 0.75
    const txnCache = makeTxnCache({ MOON: { h1Buys: 80, h1Sells: 20, h24Buys: 300, h24Sells: 100 } });
    const merged = mergeDexScreenerIntoIntel(existing, txnCache);
    const entry = merged.find(p => p.symbol === 'MOON')!;
    expect(entry.signal).toBe('STRONG_BUY');
  });

  it('does not mutate original existing array', () => {
    const existing = makeExisting();
    const originalLength = existing.length;
    const txnCache = makeTxnCache({ NEW: {} });
    mergeDexScreenerIntoIntel(existing, txnCache);
    expect(existing).toHaveLength(originalLength); // unchanged
  });
});

// ─── buildDexIntelFromDexScreener ───────────────────────────────────────────

describe('buildDexIntelFromDexScreener', () => {
  it('returns null when cache is empty', () => {
    expect(buildDexIntelFromDexScreener({})).toBeNull();
  });

  it('returns null when all entries are stale', () => {
    const cache = makeTxnCache({ TOK: { updatedAt: Date.now() - 200_000 } });
    expect(buildDexIntelFromDexScreener(cache)).toBeNull();
  });

  it('returns null when all entries are too low-activity', () => {
    const cache = makeTxnCache({ TOK: { h1Buys: 1, h1Sells: 1, h24Buys: 1, h24Sells: 1 } });
    expect(buildDexIntelFromDexScreener(cache)).toBeNull();
  });

  it('returns DexIntelligence with buySellPressure when valid entries exist', () => {
    const cache = makeTxnCache({ VALID: { h1Buys: 50, h1Sells: 30 } });
    const result = buildDexIntelFromDexScreener(cache);
    expect(result).not.toBeNull();
    expect(result!.buySellPressure).toHaveLength(1);
    expect(result!.buySellPressure[0].symbol).toBe('VALID');
  });

  it('includes error message indicating GeckoTerminal fallback', () => {
    const cache = makeTxnCache({ TOK: {} });
    const result = buildDexIntelFromDexScreener(cache);
    expect(result!.errors[0]).toContain('GeckoTerminal failed');
  });

  it('sets empty arrays for non-pressure fields', () => {
    const cache = makeTxnCache({ TOK: {} });
    const result = buildDexIntelFromDexScreener(cache);
    expect(result!.trendingPools).toHaveLength(0);
    expect(result!.tokenMetrics).toHaveLength(0);
    expect(result!.volumeSpikes).toHaveLength(0);
  });
});
