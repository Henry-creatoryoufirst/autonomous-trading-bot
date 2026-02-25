/**
 * Schertzinger Trading Command — Smart Caching System (v6.0)
 *
 * Layered cache with different TTLs per data type.
 * Prevents API rate limit exhaustion on 2-minute trading cycles.
 */

import { CACHE_TTL } from '../config/constants.js';

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  ttl: number;
  hitCount: number;
}

export class CacheManager {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private totalHits = 0;
  private totalMisses = 0;

  /**
   * Store data in cache with a specified TTL
   */
  set<T>(key: string, data: T, ttlMs: number): void {
    this.cache.set(key, {
      data,
      cachedAt: Date.now(),
      ttl: ttlMs,
      hitCount: 0,
    });
  }

  /**
   * Retrieve data from cache. Returns null if expired or not found.
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.totalMisses++;
      return null;
    }
    if (Date.now() - entry.cachedAt > entry.ttl) {
      this.cache.delete(key);
      this.totalMisses++;
      return null;
    }
    entry.hitCount++;
    this.totalHits++;
    return entry.data as T;
  }

  /**
   * Check if a key exists and is not expired (without counting as a hit)
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.cachedAt > entry.ttl) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Get data from cache, or fetch it using the provided function if not cached.
   * This is the primary method for wrapping API calls.
   */
  async getOrFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) return cached;

    const data = await fetcher();
    this.set(key, data, ttlMs);
    return data;
  }

  /**
   * Invalidate all cache entries matching a pattern (substring match)
   */
  invalidate(pattern: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Invalidate a single cache entry by exact key
   */
  invalidateKey(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Get the age of a cached entry in milliseconds (null if not cached)
   */
  getAge(key: string): number | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    return Date.now() - entry.cachedAt;
  }

  /**
   * Get cache statistics for monitoring
   */
  getStats(): {
    entries: number;
    totalHits: number;
    totalMisses: number;
    hitRate: string;
    oldestEntryAge: string;
  } {
    const total = this.totalHits + this.totalMisses;
    const hitRate = total > 0 ? ((this.totalHits / total) * 100).toFixed(1) + '%' : 'N/A';

    let oldestAge = 0;
    for (const entry of this.cache.values()) {
      const age = Date.now() - entry.cachedAt;
      if (age > oldestAge) oldestAge = age;
    }

    return {
      entries: this.cache.size,
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      hitRate,
      oldestEntryAge: oldestAge > 0 ? `${(oldestAge / 1000).toFixed(0)}s` : 'N/A',
    };
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Purge expired entries (call periodically to free memory)
   */
  purgeExpired(): number {
    let purged = 0;
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.cachedAt > entry.ttl) {
        this.cache.delete(key);
        purged++;
      }
    }
    return purged;
  }
}

// ============================================================================
// CACHE KEY BUILDERS — consistent key naming across the codebase
// ============================================================================

export const CacheKeys = {
  /** CoinGecko market data for all tokens */
  COINGECKO_PRICES: 'coingecko:prices',
  /** CoinGecko price history for a specific token */
  COINGECKO_HISTORY: (coingeckoId: string) => `coingecko:history:${coingeckoId}`,
  /** Fear & Greed Index */
  FEAR_GREED: 'feargreed:index',
  /** DefiLlama Base chain TVL */
  DEFI_LLAMA_TVL: 'defillama:base:tvl',
  /** DefiLlama protocols */
  DEFI_LLAMA_PROTOCOLS: 'defillama:base:protocols',
  /** DefiLlama DEX volumes */
  DEFI_LLAMA_DEX_VOL: 'defillama:base:dexvol',
  /** Binance funding rates */
  BINANCE_FUNDING: 'binance:funding',
  /** Binance open interest */
  BINANCE_OI: (symbol: string) => `binance:oi:${symbol}`,
  /** Binance global long/short ratio */
  BINANCE_GLOBAL_LS: (symbol: string) => `binance:globalLS:${symbol}`,
  /** Binance top trader long/short ratio */
  BINANCE_TOP_LS: (symbol: string) => `binance:topLS:${symbol}`,
  /** Binance top trader position ratio */
  BINANCE_TOP_POS: (symbol: string) => `binance:topPos:${symbol}`,
  /** Cross-asset data (Gold, Oil, VIX, S&P) */
  CROSS_ASSET: 'crossasset:all',
  /** FRED macro data */
  MACRO_DATA: 'macro:fred',
  /** CryptoPanic news */
  NEWS_SENTIMENT: 'news:cryptopanic',
} as const;

// Singleton instance for the whole application
export const cacheManager = new CacheManager();
