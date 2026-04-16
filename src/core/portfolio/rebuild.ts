/**
 * Ground-Truth Cost Basis Rebuild (v21.18)
 *
 * Unlike the legacy `rebuildCostBasisFromTrades` in cost-basis.ts, this module
 * does NOT preserve old realizedPnL — it recomputes from scratch using
 * chronological trade replay, optionally reconciled against on-chain transfers.
 *
 * Motivation:
 *   Several tokens (BRETT, WELL, TOSHI, etc.) have accumulated corrupted cost
 *   basis over months — producing cumulative realizedPnL of -$1.4M on a $3k
 *   portfolio. The legacy rebuilder restored the corrupted values at the end
 *   of its replay, defeating the reset.
 *
 * Design:
 *   - Pure function over inputs (no global state reads during replay)
 *   - Caller applies the result to `state.costBasis` if they want to commit
 *   - Supports dry-run mode via a flag — caller can diff before/after
 *   - Uses weighted-average cost basis (same formula as the live bot)
 *   - Clamps realizedPnL per-sell at `-impliedInvestment` (matches the
 *     sanity clamp shipped in v21.14's updateCostBasisAfterSell)
 */

import type { TokenCostBasis, TradeRecord } from '../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * On-chain transfer, sourced from the indexer in feat/onchain-indexer.
 * Kept deliberately loose so we can plug it in without a hard dependency yet.
 */
export interface OnChainTransfer {
  timestamp: string;
  blockNumber: bigint | number | string;
  txHash: string;
  token: {
    address: string;
    symbol: string;
    decimals: number;
  };
  direction: 'IN' | 'OUT';
  from: string;
  to: string;
  tokenAmount: number;
  rawAmount?: bigint | string;
}

export interface RebuildInputs {
  /** Chronological (any order — we sort) list of trade records from the bot log */
  trades: TradeRecord[];
  /** Optional on-chain transfers from the indexer. When provided, we reconcile. */
  transfers?: OnChainTransfer[];
  /** Optional current on-chain balances per symbol (for drift detection) */
  onchainBalances?: Record<string, number>;
}

export interface RebuiltCostBasisEntry {
  symbol: string;
  totalInvestedUSD: number;
  totalTokensAcquired: number;
  averageCostBasis: number;
  computedHolding: number;
  realizedPnL: number;
  firstBuyDate: string;
  lastTradeDate: string;
  // Diagnostics
  buyCount: number;
  sellCount: number;
  skippedMissingAmount: number;
  /** Number of on-chain transfers that had no matching trade log entry */
  unmatchedTransfers: number;
}

export interface RebuildResult {
  byToken: Record<string, RebuiltCostBasisEntry>;
  totals: {
    totalUSDSpent: number;
    totalUSDReceived: number;
    totalRealizedPnL: number;
    tradesReplayed: number;
    tradesSkipped: number;
    transfersProcessed: number;
    unmatchedTransfers: number;
  };
}

export interface RebuildDiff {
  symbol: string;
  before: {
    averageCostBasis: number;
    totalInvestedUSD: number;
    realizedPnL: number;
    currentHolding: number;
  };
  after: {
    averageCostBasis: number;
    totalInvestedUSD: number;
    realizedPnL: number;
    currentHolding: number;
  };
  delta: {
    averageCostBasis: number;
    realizedPnL: number;
    currentHolding: number;
  };
}

// ---------------------------------------------------------------------------
// Core rebuild — pure function
// ---------------------------------------------------------------------------

/**
 * Replay trades chronologically and produce a fresh cost basis map.
 *
 * Does NOT touch any global state. Caller decides what to do with the result.
 */
export function rebuildFromGroundTruth(inputs: RebuildInputs): RebuildResult {
  const byToken: Record<string, RebuiltCostBasisEntry> = {};

  let tradesReplayed = 0;
  let tradesSkipped = 0;

  const sortedTrades = [...inputs.trades].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  for (const trade of sortedTrades) {
    if (trade.action === 'BUY') {
      const symbol = trade.toToken;
      if (!symbol || symbol === 'USDC') continue;

      const entry = getOrCreate(byToken, symbol, trade.timestamp);
      const tokenAmount = trade.tokenAmount ?? 0;
      const amountUSD = trade.amountUSD ?? 0;

      if (tokenAmount <= 0 || amountUSD <= 0) {
        entry.skippedMissingAmount++;
        tradesSkipped++;
        continue;
      }

      if (entry.totalTokensAcquired === 0) {
        entry.firstBuyDate = trade.timestamp;
      }
      entry.totalTokensAcquired += tokenAmount;
      entry.totalInvestedUSD += amountUSD;
      entry.computedHolding += tokenAmount;
      entry.averageCostBasis =
        entry.totalTokensAcquired > 0
          ? entry.totalInvestedUSD / entry.totalTokensAcquired
          : 0;
      entry.buyCount++;
      entry.lastTradeDate = trade.timestamp;
      tradesReplayed++;
    } else if (trade.action === 'SELL') {
      const symbol = trade.fromToken;
      if (!symbol || symbol === 'USDC') continue;

      const entry = getOrCreate(byToken, symbol, trade.timestamp);
      const tokenAmount = trade.tokenAmount ?? 0;
      const amountUSD = trade.amountUSD ?? 0;

      if (tokenAmount <= 0) {
        entry.skippedMissingAmount++;
        tradesSkipped++;
        continue;
      }

      // Realized P&L = (sellPrice - avgCost) * tokens sold
      const sellPricePerToken = tokenAmount > 0 ? amountUSD / tokenAmount : 0;
      const rawPnL = (sellPricePerToken - entry.averageCostBasis) * tokenAmount;

      // Sanity clamp — same as v21.14's updateCostBasisAfterSell:
      // can't lose more than the imputed capital in this tranche.
      const impliedInvestment = entry.averageCostBasis * tokenAmount;
      const realizedPnL =
        impliedInvestment > 0 ? Math.max(rawPnL, -impliedInvestment) : rawPnL;
      entry.realizedPnL += realizedPnL;

      entry.computedHolding = Math.max(0, entry.computedHolding - tokenAmount);
      entry.sellCount++;
      entry.lastTradeDate = trade.timestamp;
      tradesReplayed++;
    }
  }

  // Optional on-chain reconciliation pass
  let transfersProcessed = 0;
  let unmatchedTransfers = 0;
  if (inputs.transfers?.length) {
    const tradeTxHashes = new Set<string>(
      sortedTrades.map((t) => t.txHash).filter((h): h is string => Boolean(h)),
    );

    for (const transfer of inputs.transfers) {
      if (!transfer.token?.symbol || transfer.token.symbol === 'USDC') continue;
      const symbol = transfer.token.symbol;
      const entry = getOrCreate(byToken, symbol, transfer.timestamp);
      transfersProcessed++;

      // If this transfer was part of a logged trade, we've already counted it.
      if (transfer.txHash && tradeTxHashes.has(transfer.txHash)) continue;

      // Unmatched transfer: update holding only, don't touch P&L.
      // This handles airdrops, direct transfers, manual swaps — none of which
      // have a USD value we can trust. Keeping P&L untouched means these
      // tokens effectively have zero cost basis; the next sell will book
      // the full sale amount as revenue (bounded by our sanity clamp).
      entry.unmatchedTransfers++;
      unmatchedTransfers++;
      if (transfer.direction === 'IN') {
        entry.computedHolding += transfer.tokenAmount;
      } else {
        entry.computedHolding = Math.max(
          0,
          entry.computedHolding - transfer.tokenAmount,
        );
      }
    }
  }

  // Roll up totals
  let totalUSDSpent = 0;
  let totalUSDReceived = 0;
  let totalRealizedPnL = 0;
  for (const entry of Object.values(byToken)) {
    totalUSDSpent += entry.totalInvestedUSD;
    totalRealizedPnL += entry.realizedPnL;
  }
  // USD received can only be derived from trades (sells), not transfers.
  for (const trade of sortedTrades) {
    if (trade.action === 'SELL' && trade.fromToken !== 'USDC') {
      totalUSDReceived += trade.amountUSD ?? 0;
    }
  }

  return {
    byToken,
    totals: {
      totalUSDSpent,
      totalUSDReceived,
      totalRealizedPnL,
      tradesReplayed,
      tradesSkipped,
      transfersProcessed,
      unmatchedTransfers,
    },
  };
}

// ---------------------------------------------------------------------------
// Diff helper — compare a rebuilt map against an existing cost-basis map
// ---------------------------------------------------------------------------

/**
 * Build a per-token diff between the rebuilt values and what's currently
 * stored. Used by the migration to show a dry-run before/after.
 */
export function diffAgainstExisting(
  rebuilt: RebuildResult,
  existing: Record<string, TokenCostBasis>,
): RebuildDiff[] {
  const symbols = new Set<string>([
    ...Object.keys(rebuilt.byToken),
    ...Object.keys(existing),
  ]);

  const diffs: RebuildDiff[] = [];
  for (const symbol of symbols) {
    const r = rebuilt.byToken[symbol];
    const e = existing[symbol];

    const before = {
      averageCostBasis: e?.averageCostBasis ?? 0,
      totalInvestedUSD: e?.totalInvestedUSD ?? 0,
      realizedPnL: e?.realizedPnL ?? 0,
      currentHolding: e?.currentHolding ?? 0,
    };
    const after = {
      averageCostBasis: r?.averageCostBasis ?? 0,
      totalInvestedUSD: r?.totalInvestedUSD ?? 0,
      realizedPnL: r?.realizedPnL ?? 0,
      currentHolding: r?.computedHolding ?? 0,
    };

    diffs.push({
      symbol,
      before,
      after,
      delta: {
        averageCostBasis: after.averageCostBasis - before.averageCostBasis,
        realizedPnL: after.realizedPnL - before.realizedPnL,
        currentHolding: after.currentHolding - before.currentHolding,
      },
    });
  }

  // Sort by absolute realizedPnL delta — biggest corrections first
  diffs.sort(
    (a, b) => Math.abs(b.delta.realizedPnL) - Math.abs(a.delta.realizedPnL),
  );
  return diffs;
}

// ---------------------------------------------------------------------------
// Apply helper — commit a rebuild result into an existing cost-basis map
// ---------------------------------------------------------------------------

/**
 * Merge rebuilt values into an existing cost-basis map, preserving fields
 * the rebuilder doesn't care about (ATR, peakPrice, lastAtrUpdate, etc).
 *
 * Holding is taken from on-chain balances when provided (the only trustworthy
 * source). Otherwise we fall back to our computed holding from trade replay.
 */
export function applyRebuiltCostBasis(
  rebuilt: RebuildResult,
  existing: Record<string, TokenCostBasis>,
  onchainBalances: Record<string, number> = {},
): { symbolsWritten: number; symbolsZeroed: number } {
  let symbolsWritten = 0;
  let symbolsZeroed = 0;

  for (const [symbol, r] of Object.entries(rebuilt.byToken)) {
    const cb = existing[symbol];
    if (!cb) {
      // Token seen in trade log but not in live state — skip, we don't have
      // the auxiliary fields (ATR stops etc.) to construct a safe entry.
      continue;
    }

    cb.totalInvestedUSD = r.totalInvestedUSD;
    cb.totalTokensAcquired = r.totalTokensAcquired;
    cb.averageCostBasis = r.averageCostBasis;
    cb.realizedPnL = r.realizedPnL;
    cb.firstBuyDate = r.firstBuyDate || cb.firstBuyDate;
    cb.lastTradeDate = r.lastTradeDate || cb.lastTradeDate;

    // Prefer on-chain balance if we have it — it's the only honest number.
    if (onchainBalances[symbol] != null) {
      cb.currentHolding = onchainBalances[symbol];
    } else {
      cb.currentHolding = r.computedHolding;
    }

    symbolsWritten++;
    if (r.realizedPnL === 0) symbolsZeroed++;
  }

  return { symbolsWritten, symbolsZeroed };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getOrCreate(
  byToken: Record<string, RebuiltCostBasisEntry>,
  symbol: string,
  timestamp: string,
): RebuiltCostBasisEntry {
  if (!byToken[symbol]) {
    byToken[symbol] = {
      symbol,
      totalInvestedUSD: 0,
      totalTokensAcquired: 0,
      averageCostBasis: 0,
      computedHolding: 0,
      realizedPnL: 0,
      firstBuyDate: timestamp,
      lastTradeDate: timestamp,
      buyCount: 0,
      sellCount: 0,
      skippedMissingAmount: 0,
      unmatchedTransfers: 0,
    };
  }
  return byToken[symbol];
}
