/**
 * Option B benchmark compute — single source of truth.
 *
 * Both the /api/benchmark route (for the website cockpit card) and the
 * heavy-cycle Sonnet prompt (so the LLM reasons against alpha-vs-benchmark
 * instead of legacy win-rate framing) call this. Before 2026-05-16 the
 * compute lived inline in agent-v3.2.ts; the prompt builder didn't have
 * access to it and was leading with `Win Rate` from `calculateTradePerformance`.
 * See feedback_dual_source_of_truth_drift.
 */
export interface BenchmarkSnapshot {
  /** ISO date "YYYY-MM-DD" UTC — idempotency key */
  date: string;
  /** cbBTC price USD at capture moment */
  btcPrice: number;
  /** WETH price USD at capture moment */
  ethPrice: number;
  /** state.trading.totalPortfolioValue at capture */
  portfolioValue: number;
  /** state.totalDeposited - state.onChainWithdrawn (or 0 fallback) */
  cumulativeNetDeposits: number;
}

export type BenchmarkTrackingState =
  | 'insufficient-data'
  | 'underperforming'
  | 'tracking'
  | 'outperforming';

export interface BenchmarkColdStart {
  kind: 'cold-start';
  snapshots: BenchmarkSnapshot[];
  count: number;
  trackingState: 'insufficient-data';
  reason: string;
}

export interface BenchmarkPopulated {
  kind: 'populated';
  windowDays: number;
  snapshotsAvailable: number;
  windowStart: string;
  windowEnd: string;
  returns: {
    bot: number;
    btc: number;
    eth: number;
    benchmark6040: number;
  };
  alphaWindow: number;
  alphaAnnualized: number;
  target: number;
  trackingState: BenchmarkTrackingState;
  netDepositDelta: number;
  windowStartSnapshot: BenchmarkSnapshot;
  windowEndSnapshot: BenchmarkSnapshot;
}

export type BenchmarkResult = BenchmarkColdStart | BenchmarkPopulated;

export const BENCHMARK_TARGET = 0.05;
export const BENCHMARK_WINDOW_DAYS = 30;

/**
 * Compute the current rolling benchmark state from a snapshot ring.
 * Pure — no I/O, no clock reads beyond Date.now() for the 30-day cutoff.
 *
 * Deposit-adjusted return: raw value-delta is distorted by deposits/payouts,
 * so we subtract the change in cumulativeNetDeposits from the bot leg.
 *   botReturn = (P_now - P_then - depositDelta) / (P_then + max(0, depositDelta))
 * BTC and ETH returns are unadjusted (passive holds have no flows).
 */
export function computeBenchmark(snapshots: BenchmarkSnapshot[]): BenchmarkResult {
  if (snapshots.length < 2) {
    return {
      kind: 'cold-start',
      snapshots,
      count: snapshots.length,
      trackingState: 'insufficient-data',
      reason: `Need at least 2 snapshots for any return calc; have ${snapshots.length}.`,
    };
  }

  const now = snapshots[snapshots.length - 1];
  const targetDate = new Date(Date.now() - BENCHMARK_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const thirtyAgoIdx = snapshots.findIndex((s) => s.date >= targetDate);
  const then = thirtyAgoIdx > 0 ? snapshots[thirtyAgoIdx - 1] : snapshots[0];

  const windowDays = Math.max(
    1,
    (new Date(now.date).getTime() - new Date(then.date).getTime()) / 86_400_000,
  );
  const btcReturn = then.btcPrice > 0 ? (now.btcPrice - then.btcPrice) / then.btcPrice : 0;
  const ethReturn = then.ethPrice > 0 ? (now.ethPrice - then.ethPrice) / then.ethPrice : 0;
  const benchmarkReturn = 0.6 * btcReturn + 0.4 * ethReturn;
  const netDepositDelta = Math.max(0, now.cumulativeNetDeposits - then.cumulativeNetDeposits);
  const botReturnDenominator = then.portfolioValue + netDepositDelta;
  const botReturn = botReturnDenominator > 0
    ? (now.portfolioValue - then.portfolioValue - netDepositDelta) / botReturnDenominator
    : 0;
  const alphaWindow = botReturn - benchmarkReturn;
  const annualizationFactor = 365 / windowDays;
  const alphaAnnualized = alphaWindow * annualizationFactor;

  let trackingState: BenchmarkTrackingState;
  if (snapshots.length < BENCHMARK_WINDOW_DAYS) trackingState = 'insufficient-data';
  else if (alphaAnnualized >= BENCHMARK_TARGET) trackingState = 'outperforming';
  else if (alphaAnnualized >= 0) trackingState = 'tracking';
  else trackingState = 'underperforming';

  return {
    kind: 'populated',
    windowDays: Math.round(windowDays * 10) / 10,
    snapshotsAvailable: snapshots.length,
    windowStart: then.date,
    windowEnd: now.date,
    returns: {
      bot: botReturn,
      btc: btcReturn,
      eth: ethReturn,
      benchmark6040: benchmarkReturn,
    },
    alphaWindow,
    alphaAnnualized,
    target: BENCHMARK_TARGET,
    trackingState,
    netDepositDelta,
    windowStartSnapshot: then,
    windowEndSnapshot: now,
  };
}

/**
 * Format the benchmark state as a prompt block for Sonnet/Haiku heavy
 * cycles. Leads with alpha-vs-benchmark (the Option B success metric); the
 * caller demotes the legacy win-rate stats to a "diagnostics only" section.
 */
export function formatBenchmarkPromptBlock(result: BenchmarkResult): string {
  if (result.kind === 'cold-start') {
    return [
      `Option B benchmark: accumulating · ${result.count}/${BENCHMARK_WINDOW_DAYS} daily snapshots captured`,
      `Goal: ≥${(BENCHMARK_TARGET * 100).toFixed(0)}% annualized alpha over cbBTC/WETH 60/40, measured over a rolling ${BENCHMARK_WINDOW_DAYS}-day window`,
      `Status: not yet measurable — second snapshot fires at next 00:00 UTC.`,
    ].join('\n');
  }
  const pct = (decimal: number, digits = 2): string => {
    if (!Number.isFinite(decimal)) return '—';
    const v = decimal * 100;
    const sign = v > 0 ? '+' : '';
    return `${sign}${v.toFixed(digits)}%`;
  };
  const coldWindow = result.windowDays < BENCHMARK_WINDOW_DAYS;
  const targetPct = (BENCHMARK_TARGET * 100).toFixed(0);
  const lines = [
    `Option B benchmark · last ${result.windowDays} day${result.windowDays === 1 ? '' : 's'}${coldWindow ? ' (COLD WINDOW — directional read only, not yet 30 days)' : ''}`,
    `Bot ${pct(result.returns.bot)} · cbBTC ${pct(result.returns.btc)} · WETH ${pct(result.returns.eth)} · 60/40 benchmark ${pct(result.returns.benchmark6040)}`,
    `Alpha (window) ${pct(result.alphaWindow)} → annualized ${pct(result.alphaAnnualized, 1)} · target +${targetPct}% annualized · state: ${result.trackingState}`,
  ];
  if (result.netDepositDelta > 0) {
    lines.push(`Net deposit flows of $${result.netDepositDelta.toFixed(0)} subtracted from bot return.`);
  }
  return lines.join('\n');
}
