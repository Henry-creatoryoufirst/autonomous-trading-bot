/**
 * Extracted stop-loss / trailing-stop decision logic from agent-v3.2.ts
 * for unit testing. Faithfully replicates the monolith's behavior.
 */

export interface TokenCostBasis {
  symbol: string;
  totalInvestedUSD: number;
  totalTokensAcquired: number;
  averageCostBasis: number;
  currentHolding: number;
  realizedPnL: number;
  unrealizedPnL: number;
  peakPrice: number;
  peakPriceDate: string;
  firstBuyDate: string;
  lastTradeDate: string;
  atrStopPercent: number | null;
  atrTrailPercent: number | null;
  atrAtEntry: number | null;
  trailActivated: boolean;
  lastAtrUpdate: string | null;
}

export interface TradeRecord {
  action: string;
  fromToken?: string;
  toToken?: string;
  reasoning?: string;
  timestamp: string;
  success?: boolean;
  signalContext?: {
    triggeredBy?: string;
  };
}

export interface StopLossConfig {
  trailingEnabled: boolean;
  sellPercent: number;
}

/**
 * Reset peakPrice on re-entry after full/near-full exit.
 * v21.2 fix: Without this, buying cbBTC at $68K with a stale peakPrice of $69.9K
 * causes the trailing stop to fire instantly (-2.7% from "peak").
 */
export function resetPeakPriceOnReEntry(
  cb: TokenCostBasis,
  buyPrice: number,
): void {
  const wasEmpty = cb.currentHolding <= 0 || cb.totalTokensAcquired <= 0;
  if (wasEmpty && buyPrice > 0) {
    cb.peakPrice = buyPrice;
    cb.peakPriceDate = new Date().toISOString();
    cb.trailActivated = false;
  }
}

/**
 * v21.2: FORCED_DEPLOY cooldown check.
 * If the most recent buy for a token was a FORCED_DEPLOY or SCOUT,
 * trailing stop must NOT fire within 2 hours of that buy.
 * Returns true if the trailing stop should be BLOCKED (i.e., still in cooldown).
 */
export function isForcedDeployCooldownActive(
  tradeHistory: TradeRecord[],
  symbol: string,
  nowMs: number = Date.now(),
): boolean {
  // Find most recent successful buy for this symbol (same order as monolith: .find scans from end)
  const recentBuy = tradeHistory.find(
    (t) => t.toToken === symbol && t.action === 'BUY' && t.success !== false,
  );
  if (!recentBuy) return false;

  const isForcedOrScout =
    recentBuy.reasoning?.includes('FORCED_DEPLOY') ||
    recentBuy.reasoning?.includes('SCOUT');
  if (!isForcedOrScout) return false;

  const hoursSinceBuy =
    (nowMs - new Date(recentBuy.timestamp).getTime()) / (1000 * 60 * 60);
  return hoursSinceBuy < 2;
}

/**
 * Compute trailing loss percentage from peak.
 */
export function computeTrailingLoss(
  currentPrice: number,
  peakPrice: number,
): number {
  if (peakPrice <= 0) return 0;
  return ((currentPrice - peakPrice) / peakPrice) * 100;
}

/**
 * Determine if a stop-loss or trailing-stop should trigger.
 * Returns the type of trigger or null if no trigger.
 */
export function checkStopTrigger(
  currentPrice: number,
  cb: TokenCostBasis,
  effectiveSL: number,
  effectiveTrailing: number,
  cfg: StopLossConfig,
): 'STOP_LOSS' | 'TRAILING_STOP' | null {
  const lossFromCost =
    ((currentPrice - cb.averageCostBasis) / cb.averageCostBasis) * 100;

  let trailingLoss = 0;
  if (cfg.trailingEnabled && cb.peakPrice > 0) {
    trailingLoss = ((currentPrice - cb.peakPrice) / cb.peakPrice) * 100;
  }

  const costBasisTriggered = lossFromCost <= effectiveSL;
  const trailingTriggered =
    cfg.trailingEnabled && trailingLoss <= effectiveTrailing;

  if (costBasisTriggered) return 'STOP_LOSS';
  if (trailingTriggered) return 'TRAILING_STOP';
  return null;
}
