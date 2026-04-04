/**
 * Never Rest Capital — Trade Execution Queue (v7.0 / v20.0)
 *
 * Manages parallel trade EVALUATIONS vs serialized trade EXECUTIONS.
 *
 * Problem: Multiple tokens may simultaneously qualify for a trade.
 * On-chain transactions must be serialized (one at a time) to avoid:
 *   - CDP SDK nonce collisions
 *   - Insufficient gas during concurrent submissions
 *   - Race conditions on wallet balance checks
 *
 * Solution:
 *   - Evaluations run fully parallel (each token on its own watcher)
 *   - Execution requests enter a FIFO queue
 *   - Queue processor serializes on-chain txns with a small gap between each
 *   - Max 5 concurrent "in-flight" slots (prevents memory/API overload)
 *   - Emergency SELLs skip to the front of the queue
 *
 * v20.0: Added per-token locking to prevent two sells of the same token
 *        from executing concurrently (race condition on balance reads).
 */

import { MAX_CONCURRENT_TRADES, TRADE_EXECUTION_GAP_MS } from '../config/constants.js';

export interface TradeRequest {
    id: string;
    symbol: string;
    action: 'BUY' | 'SELL' | 'REBALANCE';
    amountUSD: number;
    isEmergency: boolean;
    priority: number; // lower = higher priority; emergency = 0, normal = 10
  requestedAt: number;
    execute: () => Promise<boolean>; // The actual trade execution function
  onComplete?: (success: boolean) => void;
}

export class TradeQueue {
    private queue: TradeRequest[] = [];
    private inFlight: Set<string> = new Set();
    // v20.0: Per-token lock to prevent concurrent trades on the same token
    private tokenLocks: Set<string> = new Set();
    private processing = false;
    private maxConcurrent: number;
    private gapMs: number;

  constructor(maxConcurrent = MAX_CONCURRENT_TRADES, gapMs = TRADE_EXECUTION_GAP_MS) {
        this.maxConcurrent = maxConcurrent;
        this.gapMs = gapMs;
  }

  /**
     * Add a trade request to the queue.
     * Emergency trades (isEmergency=true) are inserted at the front.
     */
  enqueue(request: TradeRequest): void {
        if (this.inFlight.size >= this.maxConcurrent) {
                console.log(` ⏳ Trade queue full (${this.inFlight.size}/${this.maxConcurrent} in-flight): ${request.symbol} ${request.action} queued`);
        }

      if (request.isEmergency) {
              // Emergency trades jump to the front
          this.queue.unshift(request);
              console.log(` 🚨 EMERGENCY queued at front: ${request.symbol} ${request.action}`);
      } else {
              this.queue.push(request);
              console.log(` 📋 Queued: ${request.symbol} ${request.action} $${request.amountUSD.toFixed(0)} (queue depth: ${this.queue.length})`);
      }

      // Kick off processing if not already running
      if (!this.processing) {
              void this.processQueue();
      }
  }

  /**
     * Get current queue status
     */
  getStatus(): { queueDepth: number; inFlight: number; maxConcurrent: number; tokenLocks: string[] } {
        return {
                queueDepth: this.queue.length,
                inFlight: this.inFlight.size,
                maxConcurrent: this.maxConcurrent,
                tokenLocks: Array.from(this.tokenLocks),
        };
  }

  /**
     * Check if a specific token has a pending or in-flight trade
     */
  hasPending(symbol: string): boolean {
        return this.queue.some(r => r.symbol === symbol) || this.inFlight.has(symbol) || this.tokenLocks.has(symbol);
  }

  /**
     * Remove any pending (not yet in-flight) trades for a symbol
     * Useful when a better opportunity overwrites a stale queued request
     */
  cancelPending(symbol: string): number {
        const before = this.queue.length;
        this.queue = this.queue.filter(r => r.symbol !== symbol);
        const removed = before - this.queue.length;
        if (removed > 0) {
                console.log(` 🗑️ Cancelled ${removed} pending trade(s) for ${symbol}`);
        }
        return removed;
  }

  // ---- Private ----

  private async processQueue(): Promise<void> {
        this.processing = true;

      while (this.queue.length > 0 || this.inFlight.size > 0) {
              // Wait if we've hit the concurrent limit
          if (this.inFlight.size >= this.maxConcurrent) {
                    await this.sleep(100); // Check again soon
                continue;
          }

          // v20.0: Find the first request whose token is NOT locked
          const requestIdx = this.queue.findIndex(r => !this.tokenLocks.has(r.symbol));
          if (requestIdx === -1) {
            if (this.queue.length > 0) {
              // All queued tokens are locked — wait for a lock to release
              await this.sleep(100);
              continue;
            }
            // Queue empty but still have in-flight — wait
            await this.sleep(100);
            continue;
          }

          const request = this.queue.splice(requestIdx, 1)[0];

          // Mark as in-flight + acquire token lock
          this.inFlight.add(request.id);
          this.tokenLocks.add(request.symbol);
              console.log(` 🔄 Executing: ${request.symbol} ${request.action} $${request.amountUSD.toFixed(0)} (${this.inFlight.size}/${this.maxConcurrent} in-flight, token locked)`);

          // Execute asynchronously — don't await, let multiple run in parallel up to maxConcurrent
          request.execute().then(success => {
                    this.inFlight.delete(request.id);
                    this.tokenLocks.delete(request.symbol);
                    if (request.onComplete) request.onComplete(success);
                    console.log(` ${success ? '✅' : '❌'} Completed: ${request.symbol} ${request.action} (${this.inFlight.size}/${this.maxConcurrent} in-flight)`);
          }).catch(err => {
                    this.inFlight.delete(request.id);
                    this.tokenLocks.delete(request.symbol);
                    if (request.onComplete) request.onComplete(false);
                    console.error(` ❌ Error executing ${request.symbol} ${request.action}:`, err);
          });

          // Gap between on-chain submissions to prevent nonce collisions
          if (this.queue.length > 0) {
                    await this.sleep(this.gapMs);
          }
      }

      this.processing = false;
  }

  private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton trade queue for the whole application
export const tradeQueue = new TradeQueue();
