/**
 * NVR-SPEC-022 — Pattern P0: Stablecoin Depeg Counter-Cascade
 *
 * The highest-quality pattern in the NVR Pattern Library (5/5 on every
 * scoring axis). Not because it's clever — because the mechanism is rock
 * solid: when a fiat-backed or overcollateralized stablecoin trades on a
 * Base DEX at a meaningful discount to its issuer-redemption value, the
 * spread is a near-arbitrage with a hard floor. Issuer-redemption is the
 * structural backstop. The pattern bot's role is to be present (24/7
 * watching) and act fast (within minutes, not hours) when the spread
 * opens — both things humans physically cannot reliably do.
 *
 * Reference event: USDC March 2023 depeg ($0.87 floor → $0.99+ within ~72h
 * once FDIC announced full SVB depositor coverage). Multiple Glassnode +
 * Chainalysis post-mortems documented the recovery dynamics. Lyons &
 * Viswanath-Natraj (NBER 27136) is the canonical academic treatment of
 * stablecoin peg dynamics.
 *
 * Critical exclusion: algorithmic stables (UST/Terra-style) do NOT have
 * the structural floor and are HARD-EXCLUDED. The pattern's whitelist is
 * deliberately narrow.
 *
 * STATUS: STUB. Contract is fully wired so the runtime can register and
 * tick it; detect() returns null until we add the price-feed integration
 * and depeg threshold logic. confirm() is unimplemented (left optional).
 * monitor() returns 'hold' for now. Next ship adds detection logic +
 * paper-mode entries to gather live trigger data without trading.
 */

import type {
  Pattern,
  MarketSnapshot,
  PatternState,
  Trigger,
  Position,
  ExitDecision,
} from "./types.js";
import type { TradeDecision } from "./trade-decision-shim.js";

// ----------------------------------------------------------------------------
// Pattern config — declared up top so they're easy to find + tune
// ----------------------------------------------------------------------------

/** Stables we're willing to act on. Algorithmic stables (UST-style) and
 *  novel/unaudited stables are deliberately excluded. */
const WHITELIST: ReadonlySet<string> = new Set([
  "USDC",
  "USDT",
  "DAI",
  "USDS",
  "sUSDe",
]);

/** Minimum deviation from peg (in basis points) to consider a trigger. */
const TRIGGER_THRESHOLD_BPS = 50;

/** Maximum deviation (in basis points) — beyond this we suspect actual
 *  insolvency rather than panic, and refuse to enter. */
const MAX_DEVIATION_BPS = 500;

/** Minimum sustained duration of the deviation (in seconds) before the
 *  pattern fires. Prevents reacting to a single bad tick. */
const MIN_DEVIATION_DURATION_SEC = 300; // 5 minutes

/** How often the runtime ticks this pattern. Stables don't depeg often
 *  but when they do the window is hours, so ~30s polling is enough. */
const TICK_INTERVAL_MS = 30_000;

// ----------------------------------------------------------------------------
// Pattern state — what we remember between ticks
// ----------------------------------------------------------------------------

interface DepegState extends PatternState {
  /** First-detected-at time per stablecoin. Resets when peg recovers. */
  firstSeenBelowPeg?: Record<string, string | undefined>;
  /** Highest deviation (bps) we've seen for the current event. */
  maxDeviationBps?: Record<string, number | undefined>;
}

// ----------------------------------------------------------------------------
// Pattern implementation
// ----------------------------------------------------------------------------

export const stablecoinDepegPattern: Pattern = {
  name: "stablecoin_depeg",
  version: "0.1.0-stub",
  description:
    "Counter-cascade buy on major fiat-backed or overcollateralized stables when DEX price diverges >50bps from $1.00 peg, sustained for 5+ minutes. Reference event: USDC March 2023.",

  maxAllocationPct: 5, // up to 5% of alpha sleeve per pattern (conservative; raise after live evidence)
  maxConcurrentPositions: 3, // up to 3 stables at once (rare but possible during cascade)
  tickIntervalMs: TICK_INTERVAL_MS,

  detect(market: MarketSnapshot, state: PatternState): Trigger | null {
    const s = state as DepegState;
    s.firstSeenBelowPeg ??= {};
    s.maxDeviationBps ??= {};

    const nowMs = Date.parse(market.timestamp);

    for (const symbol of WHITELIST) {
      const price = market.prices.get(symbol);
      if (price === undefined || price <= 0) continue;

      // Deviation in basis points from $1.00 peg. Negative = below peg.
      // We only act on negative deviations — buying *below* peg targets
      // the redemption-arb floor. Positive deviations (premium) are
      // a different (and rarer) trade we don't take here.
      const deviationBps = Math.round((price - 1.0) * 10_000);

      if (deviationBps > -TRIGGER_THRESHOLD_BPS) {
        // Within or above peg → reset any tracking for this symbol
        s.firstSeenBelowPeg[symbol] = undefined;
        s.maxDeviationBps[symbol] = undefined;
        continue;
      }

      if (deviationBps < -MAX_DEVIATION_BPS) {
        // Too deep — likely real solvency event. Refuse to enter.
        // The structural floor only holds when the issue is panic, not
        // actual issuer impairment.
        continue;
      }

      // Track when we first saw this stable below threshold
      const firstSeen = s.firstSeenBelowPeg[symbol];
      if (!firstSeen) {
        s.firstSeenBelowPeg[symbol] = market.timestamp;
        s.maxDeviationBps[symbol] = deviationBps;
        continue; // first-tick — wait for confirmation
      }

      // Update max deviation seen so far
      const prevMax = s.maxDeviationBps[symbol] ?? 0;
      if (deviationBps < prevMax) s.maxDeviationBps[symbol] = deviationBps;

      // Check if the deviation has been sustained
      const sustainedSec = (nowMs - Date.parse(firstSeen)) / 1000;
      if (sustainedSec < MIN_DEVIATION_DURATION_SEC) {
        continue; // not yet sustained — wait
      }

      // STUB GUARD: env-controlled. Default ON (safe). Set
      // DEPEG_PATTERN_ENABLED=true to allow the pattern to fire triggers
      // — required for paper-mode runs and backtests. Live trading still
      // requires status='live' on the registry + a confidence-gate ≥ 60
      // against historical data.
      if (process.env.DEPEG_PATTERN_ENABLED !== "true") continue;

      // Live fire path
      return {
        patternName: "stablecoin_depeg",
        symbol,
        detectedAt: market.timestamp,
        context: {
          spotPrice: price,
          deviationBps,
          maxDeviationBps: s.maxDeviationBps[symbol],
          sustainedSec: Math.round(sustainedSec),
          firstSeenAt: firstSeen,
        },
        summary: `${symbol} depegged ${Math.abs(deviationBps)}bps below $1.00 for ${Math.round(sustainedSec / 60)}min — counter-cascade entry`,
      };
    }

    return null;
  },

  enter(trigger: Trigger, conviction: number, allocationUsd: number): TradeDecision {
    // Stable depeg buys are always BUY <stable> with USDC.
    // Position size is allocation × conviction%. Conviction 0–100, but
    // patterns shouldn't get here with conviction <= 0 (runtime vetoes).
    const sizeUsd = Math.max(0, allocationUsd * (conviction / 100));
    return {
      action: "BUY",
      fromToken: "USDC",
      toToken: trigger.symbol,
      amountUSD: sizeUsd,
      reasoning: `${trigger.summary} · conviction=${conviction} · pattern=stablecoin_depeg@${stablecoinDepegPattern.version}`,
      sector: "STABLE", // not in the standard sector taxonomy; flagged so it's not double-counted
    };
  },

  monitor(_position: Position, _market: MarketSnapshot, _state: PatternState): ExitDecision {
    // STUB. Real implementation will exit when:
    //   (a) price recovers within -10bps of peg (full close)
    //   (b) recovery to 0bps (hard close)
    //   (c) deviation widens beyond MAX_DEVIATION_BPS (panic-stop, suspect insolvency)
    //   (d) 7-day hold-time exceeded (timeout)
    return "hold";
  },
};

// ----------------------------------------------------------------------------
// Internal exports for tests
// ----------------------------------------------------------------------------

export const _testInternals = {
  WHITELIST,
  TRIGGER_THRESHOLD_BPS,
  MAX_DEVIATION_BPS,
  MIN_DEVIATION_DURATION_SEC,
};
