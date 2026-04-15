/**
 * Never Rest Capital — Portfolio Valuation Utilities
 *
 * Phase 4 of the monolith refactor. Extracts the pure phantom-detection
 * logic from agent-v3.2.ts lines 6359-6519. The full valuation pipeline
 * (capital flows, peak updates, Telegram alerts, SHI hooks) remains in
 * the monolith for now — Phase 4b will extract the orchestration.
 *
 * This module is deliberately dependency-free: pure functions, no I/O,
 * no side effects. Phantom detection is the highest-value piece to
 * extract first because it's pure math and easy to unit-test.
 */

export type BalanceEntry = {
  symbol: string;
  balance: number;
  usdValue: number;
  price?: number;
  sector?: string;
};

// ============================================================================
// PHANTOM MOVE DETECTION
// ============================================================================

/**
 * A "phantom drop" is a sudden >10% portfolio value decrease in one cycle
 * that is almost certainly a price feed failure, NOT a real loss. We use
 * it to protect the peak value and drawdown baselines from false inflation.
 *
 * A "phantom spike" is the inverse — a sudden >10% increase that is
 * usually a stale-price fallback overshooting. We detect suspect tokens
 * (appeared from nothing or jumped >50%) so we can log what looks fishy.
 */

const PHANTOM_THRESHOLD_PERCENT = 10;
const MIN_PORTFOLIO_FOR_PHANTOM_USD = 100;
const SUSPECT_TOKEN_NEW_USD = 50;
const SUSPECT_TOKEN_JUMP_RATIO = 0.5;

export interface PhantomDetectionInput {
  prevPortfolioValue: number;
  newPortfolioValue: number;
  prevBalances: BalanceEntry[];
  newBalances: BalanceEntry[];
}

export interface PhantomDetectionResult {
  /** Portfolio drop % in this cycle (positive = drop). 0 if no drop. */
  dropPercent: number;
  /** Portfolio spike % in this cycle (positive = gain). 0 if no spike. */
  spikePercent: number;
  /** True if the drop exceeds the phantom threshold for a large-enough portfolio. */
  isPhantomDrop: boolean;
  /** True if the spike exceeds the phantom threshold for a large-enough portfolio. */
  isPhantomSpike: boolean;
  /** Either phantom condition is true. */
  isPhantomMove: boolean;
  /** Tokens flagged as suspect — appeared new or jumped significantly. */
  suspectTokens: Array<{ symbol: string; prevUSD: number; newUSD: number; change: string }>;
  /** Tokens that now have balance but no price — indicative of a feed failure. */
  missingPriceTokens: string[];
}

/**
 * Detect phantom moves (both drops and spikes) and return structured output.
 * Pure function — no side effects, no state mutations.
 *
 * Caller (monolith or Phase 5 cycle stage) uses the output to decide:
 *   - Whether to update the peak value
 *   - Whether to update drawdown baselines
 *   - Whether to fire a LARGE_DRAWDOWN incident to SHI
 *   - Whether to suppress Telegram balance-update alerts
 */
export function detectPhantomMoves(input: PhantomDetectionInput): PhantomDetectionResult {
  const { prevPortfolioValue, newPortfolioValue, prevBalances, newBalances } = input;

  const portfolioChange = newPortfolioValue - prevPortfolioValue;
  const changeRatio = prevPortfolioValue > 0 ? portfolioChange / prevPortfolioValue : 0;

  const dropPercent = changeRatio < 0 ? Math.abs(changeRatio) * 100 : 0;
  const spikePercent = changeRatio > 0 ? changeRatio * 100 : 0;

  const portfolioBigEnough = prevPortfolioValue > MIN_PORTFOLIO_FOR_PHANTOM_USD;
  const isPhantomDrop = dropPercent > PHANTOM_THRESHOLD_PERCENT && portfolioBigEnough;
  const isPhantomSpike = spikePercent > PHANTOM_THRESHOLD_PERCENT && portfolioBigEnough;

  const suspectTokens = isPhantomSpike ? findSuspectSpikeTokens(prevBalances, newBalances) : [];
  const missingPriceTokens = isPhantomDrop ? findMissingPriceTokens(newBalances) : [];

  return {
    dropPercent,
    spikePercent,
    isPhantomDrop,
    isPhantomSpike,
    isPhantomMove: isPhantomDrop || isPhantomSpike,
    suspectTokens,
    missingPriceTokens,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Tokens that appeared out of nowhere with meaningful value OR jumped >50%
 * in a single cycle are flagged as suspects for phantom-spike debugging.
 */
function findSuspectSpikeTokens(
  prevBalances: BalanceEntry[],
  newBalances: BalanceEntry[],
): Array<{ symbol: string; prevUSD: number; newUSD: number; change: string }> {
  const result: Array<{ symbol: string; prevUSD: number; newUSD: number; change: string }> = [];

  for (const b of newBalances) {
    if (b.symbol === 'USDC') continue;
    if ((b.usdValue ?? 0) <= 0) continue;

    const prev = prevBalances.find((pb) => pb.symbol === b.symbol);

    if (!prev || !prev.usdValue) {
      // Appearing from nothing — only flag if the new value is meaningful
      if (b.usdValue > SUSPECT_TOKEN_NEW_USD) {
        result.push({
          symbol: b.symbol,
          prevUSD: 0,
          newUSD: b.usdValue,
          change: `new token $${b.usdValue.toFixed(2)}`,
        });
      }
      continue;
    }

    const prevUSD = prev.usdValue;
    const ratio = (b.usdValue - prevUSD) / prevUSD;
    if (ratio > SUSPECT_TOKEN_JUMP_RATIO) {
      result.push({
        symbol: b.symbol,
        prevUSD,
        newUSD: b.usdValue,
        change: `$${prevUSD.toFixed(2)} → $${b.usdValue.toFixed(2)} (+${(ratio * 100).toFixed(1)}%)`,
      });
    }
  }

  return result;
}

/**
 * Tokens with a positive balance but no price typically indicate a price
 * feed failure (the balance is real but we can't value it).
 */
function findMissingPriceTokens(newBalances: BalanceEntry[]): string[] {
  return newBalances
    .filter((b) => b.symbol !== 'USDC' && b.balance > 0 && !b.price)
    .map((b) => b.symbol);
}

// ============================================================================
// LARGE DRAWDOWN DETECTION
// ============================================================================

const LARGE_DRAWDOWN_THRESHOLD_PERCENT = 5;

/**
 * Determine whether a drop qualifies as a "real" LARGE_DRAWDOWN incident
 * (not a phantom feed failure). Used to gate SHI incident reporting so
 * we don't spam the self-healing system with noise from price-feed hiccups.
 */
export function isRealLargeDrawdown(
  dropPercent: number,
  prevPortfolioValue: number,
  isPhantomMove: boolean,
): boolean {
  return (
    !isPhantomMove
    && dropPercent > LARGE_DRAWDOWN_THRESHOLD_PERCENT
    && prevPortfolioValue > MIN_PORTFOLIO_FOR_PHANTOM_USD
  );
}
