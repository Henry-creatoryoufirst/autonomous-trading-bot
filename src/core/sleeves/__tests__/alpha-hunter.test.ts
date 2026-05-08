import { describe, it, expect, afterEach } from 'vitest';
import { AlphaHunterSleeve } from '../alpha-hunter.js';
import type {
  SleeveContext,
  SleevePosition,
  DiscoveryCandidate,
  WatcherDirectCandidate,
} from '../types.js';
import type { SleeveOwnership } from '../state-types.js';

function mkOwnership(): SleeveOwnership {
  return {
    positions: {},
    realizedPnLUSD: 0,
    trades: 0,
    wins: 0,
    dailyPayouts: [],
    regimeReturns: {},
    decisions: [],
    lastDecisionAt: null,
    createdAt: '2026-04-21T00:00:00.000Z',
  };
}

function mkPosition(symbol: string, costBasisUSD: number, balance: number, openedAt: string): SleevePosition {
  return {
    symbol,
    balance,
    costBasisUSD,
    valueUSD: balance,
    openedAt,
    openedInCycle: 1,
  };
}

function mkCandidate(partial: Partial<DiscoveryCandidate> & { symbol: string; convictionScore: number }): DiscoveryCandidate {
  return {
    symbol: partial.symbol,
    convictionScore: partial.convictionScore,
    sector: partial.sector ?? 'MEME',
    price: partial.price ?? 1,
    volume24h: partial.volume24h ?? 100_000,
    priceChange24h: partial.priceChange24h ?? 5,
    isRunner: partial.isRunner ?? false,
  };
}

function mkCtx(partial: {
  positions?: SleevePosition[];
  availableUSDC?: number;
  capitalBudgetUSD?: number;
  prices?: Record<string, number>;
  candidates?: DiscoveryCandidate[];
}): SleeveContext {
  return {
    capitalBudgetUSD: partial.capitalBudgetUSD ?? 1000,
    positions: partial.positions ?? [],
    availableUSDC: partial.availableUSDC ?? 1000,
    market: {
      cycleNumber: 42,
      builtAt: new Date().toISOString(),
      prices: partial.prices ?? {},
      regime: 'RANGING',
      fearGreed: 50,
      discovery: { candidates: partial.candidates ?? [] },
    },
  };
}

describe('AlphaHunterSleeve v1 — entries', () => {
  it('enters a qualifying candidate above the conviction floor', async () => {
    const sleeve = new AlphaHunterSleeve({ getOwnership: mkOwnership });
    const ctx = mkCtx({
      candidates: [mkCandidate({ symbol: 'VIRTUAL', convictionScore: 80, sector: 'MEME' })],
    });
    const decisions = await sleeve.decide(ctx);

    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe('BUY');
    expect(decisions[0].fromToken).toBe('USDC');
    expect(decisions[0].toToken).toBe('VIRTUAL');
    expect(decisions[0].amountUSD).toBeGreaterThanOrEqual(10);
    expect(decisions[0].amountUSD).toBeLessThanOrEqual(100);
    expect(decisions[0].reasoning).toContain('ALPHA_HUNTER_V1');
  });

  it('skips candidates below the conviction floor (65) and surfaces reason', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      candidates: [mkCandidate({ symbol: 'LOWCONV', convictionScore: 50 })],
    });
    const decisions = await sleeve.decide(ctx);
    // v21.31: emit a synthetic HOLD with reasoning instead of returning [].
    const buysOrSells = decisions.filter((d) => d.action === 'BUY' || d.action === 'SELL');
    expect(buysOrSells).toHaveLength(0);
    const hold = decisions.find((d) => d.action === 'HOLD');
    expect(hold).toBeDefined();
    expect(hold!.reasoning).toContain('passed filters');
    expect(hold!.reasoning).toContain('LOWCONV@50');
  });

  it('prioritizes runners over higher-score non-runners', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      candidates: [
        mkCandidate({ symbol: 'HIGH', convictionScore: 90, isRunner: false }),
        mkCandidate({ symbol: 'RUNNER', convictionScore: 75, isRunner: true }),
      ],
    });
    const decisions = await sleeve.decide(ctx);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].toToken).toBe('RUNNER');
  });

  it('does not re-enter a symbol already held', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      positions: [mkPosition('VIRTUAL', 50, 50, '2026-04-21T00:00:00.000Z')],
      candidates: [mkCandidate({ symbol: 'VIRTUAL', convictionScore: 80 })],
      prices: { VIRTUAL: 1.05 }, // small gain, not exit-triggering
    });
    const decisions = await sleeve.decide(ctx);
    // No BUY decision for VIRTUAL (already held)
    expect(decisions.filter((d) => d.action === 'BUY')).toHaveLength(0);
  });

  it('refuses to buy protected base tokens (USDC, ETH, WETH, cbBTC) and surfaces reason', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      candidates: [
        mkCandidate({ symbol: 'cbBTC', convictionScore: 99 }),
        mkCandidate({ symbol: 'ETH', convictionScore: 95 }),
      ],
    });
    const decisions = await sleeve.decide(ctx);
    const buys = decisions.filter((d) => d.action === 'BUY');
    expect(buys).toHaveLength(0);
    const hold = decisions.find((d) => d.action === 'HOLD');
    expect(hold).toBeDefined();
    expect(hold!.reasoning).toContain('passed filters');
  });

  it('caps new entries at 1 per cycle even when multiple candidates qualify', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      candidates: [
        mkCandidate({ symbol: 'A', convictionScore: 90 }),
        mkCandidate({ symbol: 'B', convictionScore: 88 }),
        mkCandidate({ symbol: 'C', convictionScore: 85 }),
      ],
    });
    const decisions = await sleeve.decide(ctx);
    const buys = decisions.filter((d) => d.action === 'BUY');
    expect(buys).toHaveLength(1);
    expect(buys[0].toToken).toBe('A'); // highest conviction, no runners
  });

  it('respects max 3 open positions', async () => {
    const sleeve = new AlphaHunterSleeve();
    // Use a fresh openedAt so the stale-exit (48h+ AND <2% gain) doesn't fire
    // on the small-gain positions and free a slot. Fixed dates bit-rot here —
    // the original 2026-04-21 dates went stale relative to wall-clock.
    const fresh = new Date().toISOString();
    const ctx = mkCtx({
      positions: [
        mkPosition('X', 50, 50, fresh),
        mkPosition('Y', 50, 50, fresh),
        mkPosition('Z', 50, 50, fresh),
      ],
      candidates: [mkCandidate({ symbol: 'NEW', convictionScore: 90 })],
      prices: { X: 1.02, Y: 1.01, Z: 1.03 }, // no exits, small gains
    });
    const decisions = await sleeve.decide(ctx);
    expect(decisions.filter((d) => d.action === 'BUY')).toHaveLength(0);
  });

  it('refuses to enter when availableUSDC is below the floor and surfaces reason', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      availableUSDC: 5, // below $10 floor
      candidates: [mkCandidate({ symbol: 'VIRTUAL', convictionScore: 90 })],
    });
    const decisions = await sleeve.decide(ctx);
    const buys = decisions.filter((d) => d.action === 'BUY');
    expect(buys).toHaveLength(0);
    const hold = decisions.find((d) => d.action === 'HOLD');
    expect(hold).toBeDefined();
    expect(hold!.reasoning).toContain('below $10 floor');
  });

  it('emits HOLD with empty-discovery reason when discovery returns nothing', async () => {
    // v21.31: silent HOLD becomes informative — the operator can tell the
    // pipeline returned 0 candidates vs filtered to 0 vs USDC-starved.
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({ candidates: [] });
    const decisions = await sleeve.decide(ctx);
    const hold = decisions.find((d) => d.action === 'HOLD');
    expect(hold).toBeDefined();
    expect(hold!.reasoning).toContain('0 candidates from discovery');
  });
});

describe('AlphaHunterSleeve v1 — exits', () => {
  it('exits on drawdown override (-5%)', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      positions: [mkPosition('VIRTUAL', 100, 100, '2026-04-21T00:00:00.000Z')],
      prices: { VIRTUAL: 0.92 }, // -8% from $1 → worse than -5%
    });
    const decisions = await sleeve.decide(ctx);
    const sells = decisions.filter((d) => d.action === 'SELL');
    expect(sells).toHaveLength(1);
    expect(sells[0].reasoning).toContain('ALPHA_DRAWDOWN_CUT');
    expect(sells[0].percent).toBe(100);
  });

  it('exits on take-profit (+15%)', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      positions: [mkPosition('VIRTUAL', 100, 100, '2026-04-21T00:00:00.000Z')],
      prices: { VIRTUAL: 1.18 }, // +18% from $1
    });
    const decisions = await sleeve.decide(ctx);
    const sells = decisions.filter((d) => d.action === 'SELL');
    expect(sells).toHaveLength(1);
    expect(sells[0].reasoning).toContain('ALPHA_TAKE_PROFIT');
  });

  it('exits on stale (48h+ with <2% gain)', async () => {
    const sleeve = new AlphaHunterSleeve();
    const staleDate = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(); // 50h ago
    const ctx = mkCtx({
      positions: [mkPosition('VIRTUAL', 100, 100, staleDate)],
      prices: { VIRTUAL: 1.01 }, // +1% — below stale-max-gain
    });
    const decisions = await sleeve.decide(ctx);
    const sells = decisions.filter((d) => d.action === 'SELL');
    expect(sells).toHaveLength(1);
    expect(sells[0].reasoning).toContain('ALPHA_STALE');
  });

  it('holds a position that is neither drawing down, profitable enough, nor stale', async () => {
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtx({
      positions: [mkPosition('VIRTUAL', 100, 100, new Date().toISOString())],
      prices: { VIRTUAL: 1.04 }, // +4%, fresh, no exit trigger
    });
    const decisions = await sleeve.decide(ctx);
    expect(decisions.filter((d) => d.action === 'SELL')).toHaveLength(0);
  });

  it('honors getExitOverride — harsher drawdown cut fires earlier', async () => {
    const sleeve = new AlphaHunterSleeve({
      getExitOverride: () => ({ drawdownOverridePct: -3 }),
    });
    const ctx = mkCtx({
      positions: [mkPosition('VIRTUAL', 100, 100, new Date().toISOString())],
      prices: { VIRTUAL: 0.96 }, // -4% — trips -3% override but not the -5% default
    });
    const decisions = await sleeve.decide(ctx);
    expect(decisions.filter((d) => d.action === 'SELL')).toHaveLength(1);
  });
});

// ============================================================================
// NVR-SPEC-029: Watcher-Direct candidate stream
// ============================================================================
function mkWdCandidate(partial: Partial<WatcherDirectCandidate> & { symbol: string }): WatcherDirectCandidate {
  return {
    symbol: partial.symbol,
    triggerType: partial.triggerType ?? 'WHALE_BUY',
    raisedAt: partial.raisedAt ?? new Date().toISOString(),
    reviewerConfidence: partial.reviewerConfidence ?? 0.85,
    reviewerReasoning: partial.reviewerReasoning ?? 'multiple bullish signals align',
    triggerStrength: partial.triggerStrength ?? 0.8,
    triggerReason: partial.triggerReason ?? 'whale buys avg $1500',
  };
}

function mkCtxWd(partial: {
  positions?: SleevePosition[];
  availableUSDC?: number;
  capitalBudgetUSD?: number;
  prices?: Record<string, number>;
  discoveryCandidates?: DiscoveryCandidate[];
  wdCandidates?: WatcherDirectCandidate[];
}): SleeveContext {
  return {
    capitalBudgetUSD: partial.capitalBudgetUSD ?? 1000,
    positions: partial.positions ?? [],
    availableUSDC: partial.availableUSDC ?? 1000,
    market: {
      cycleNumber: 42,
      builtAt: new Date().toISOString(),
      prices: partial.prices ?? {},
      regime: 'RANGING',
      fearGreed: 50,
      discovery: { candidates: partial.discoveryCandidates ?? [] },
      watcherDirect: partial.wdCandidates ? {
        candidates: partial.wdCandidates,
        builtAt: new Date().toISOString(),
      } : undefined,
    },
  };
}

describe('AlphaHunterSleeve — Watcher-Direct (NVR-SPEC-029)', () => {
  afterEach(() => {
    delete process.env.ALPHA_HUNTER_WATCHER_DIRECT;
  });

  it('ignores watcher-direct stream when env flag is off (default behavior unchanged)', async () => {
    // Flag default = false. WD candidates should be ignored even when present.
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtxWd({
      wdCandidates: [mkWdCandidate({ symbol: 'AERO' })],
      // No discovery candidates — sleeve should HOLD, not buy AERO.
    });
    const decisions = await sleeve.decide(ctx);
    expect(decisions.filter((d) => d.action === 'BUY')).toHaveLength(0);
    expect(sleeve.getWatcherDirectStats().candidatesEvaluated).toBe(0);
  });

  it('buys a watcher-direct candidate when flag is on and gates pass', async () => {
    process.env.ALPHA_HUNTER_WATCHER_DIRECT = 'true';
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtxWd({
      wdCandidates: [mkWdCandidate({ symbol: 'AERO' })],
    });
    const decisions = await sleeve.decide(ctx);
    const buys = decisions.filter((d) => d.action === 'BUY');
    expect(buys).toHaveLength(1);
    expect(buys[0].toToken).toBe('AERO');
    expect(buys[0].reasoning).toContain('ALPHA_HUNTER_WD');
    expect(buys[0].reasoning).toContain('NVR-SPEC-029');
    const stats = sleeve.getWatcherDirectStats();
    expect(stats.executions).toBe(1);
    expect(stats.cyclesWithCandidates).toBe(1);
    expect(stats.lastExecutionAt).not.toBeNull();
  });

  it('falls through to discovery when watcher-direct candidate is already held', async () => {
    process.env.ALPHA_HUNTER_WATCHER_DIRECT = 'true';
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtxWd({
      positions: [mkPosition('AERO', 50, 50, new Date().toISOString())],
      prices: { AERO: 1.04 }, // no exit
      wdCandidates: [mkWdCandidate({ symbol: 'AERO' })],
      discoveryCandidates: [
        { symbol: 'VIRTUAL', convictionScore: 90, sector: 'MEME', price: 1, volume24h: 1e5, priceChange24h: 8, isRunner: false },
      ],
    });
    const decisions = await sleeve.decide(ctx);
    const buys = decisions.filter((d) => d.action === 'BUY');
    expect(buys).toHaveLength(1);
    expect(buys[0].toToken).toBe('VIRTUAL'); // discovery fallback
    expect(sleeve.getWatcherDirectStats().skippedByReason.already_held).toBe(1);
  });

  it('rejects watcher-direct candidate that is a protected base token', async () => {
    process.env.ALPHA_HUNTER_WATCHER_DIRECT = 'true';
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtxWd({
      wdCandidates: [mkWdCandidate({ symbol: 'cbBTC' })],
    });
    const decisions = await sleeve.decide(ctx);
    expect(decisions.filter((d) => d.action === 'BUY')).toHaveLength(0);
    expect(sleeve.getWatcherDirectStats().skippedByReason.protected_symbol).toBe(1);
  });

  it('rejects all watcher-direct candidates when position cap is reached', async () => {
    process.env.ALPHA_HUNTER_WATCHER_DIRECT = 'true';
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtxWd({
      positions: [
        mkPosition('A', 50, 50, new Date().toISOString()),
        mkPosition('B', 50, 50, new Date().toISOString()),
        mkPosition('C', 50, 50, new Date().toISOString()),
      ],
      prices: { A: 1.02, B: 1.03, C: 1.04 }, // no exits
      wdCandidates: [mkWdCandidate({ symbol: 'AERO' })],
    });
    const decisions = await sleeve.decide(ctx);
    expect(decisions.filter((d) => d.action === 'BUY')).toHaveLength(0);
    expect(sleeve.getWatcherDirectStats().skippedByReason.position_cap).toBe(1);
  });

  it('rejects watcher-direct candidates when USDC is below floor', async () => {
    process.env.ALPHA_HUNTER_WATCHER_DIRECT = 'true';
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtxWd({
      availableUSDC: 5,
      wdCandidates: [mkWdCandidate({ symbol: 'AERO' })],
    });
    const decisions = await sleeve.decide(ctx);
    expect(decisions.filter((d) => d.action === 'BUY')).toHaveLength(0);
    expect(sleeve.getWatcherDirectStats().skippedByReason.usdc_floor).toBe(1);
  });

  it('caps to 1 entry per cycle even with multiple watcher-direct candidates', async () => {
    process.env.ALPHA_HUNTER_WATCHER_DIRECT = 'true';
    const sleeve = new AlphaHunterSleeve();
    const ctx = mkCtxWd({
      wdCandidates: [
        mkWdCandidate({ symbol: 'AERO', reviewerConfidence: 0.95 }),
        mkWdCandidate({ symbol: 'VIRTUAL', reviewerConfidence: 0.85 }),
      ],
      discoveryCandidates: [
        { symbol: 'EXTRA', convictionScore: 99, sector: 'MEME', price: 1, volume24h: 1e5, priceChange24h: 10, isRunner: true },
      ],
    });
    const decisions = await sleeve.decide(ctx);
    const buys = decisions.filter((d) => d.action === 'BUY');
    expect(buys).toHaveLength(1);
    // First WD candidate wins (stream is pre-sorted by getWatcherDirectCandidates)
    expect(buys[0].toToken).toBe('AERO');
    // Did NOT also pull from discovery — one entry per cycle.
    expect(buys.find((b) => b.toToken === 'EXTRA')).toBeUndefined();
  });
});
