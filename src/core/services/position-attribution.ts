/**
 * NVR-SPEC-032 — Position Attribution: Phase 1 (Backfill Synthesis) +
 *                                     Phase 2 (Live entry capture)
 *
 * Pure synthesis function that reads the bot's existing state (balances,
 * costBasis, sleeveOwnership, tradeHistory, positionEntries) and emits
 * the contract shape defined in `../types/position-attribution.ts`.
 *
 * Phase 1 = best-effort backfill from history (still active for any
 *           position the bot held before Phase 2 shipped).
 * Phase 2 = inherent attribution captured at the moment of trade. The
 *           helpers `buildEntryRowFromDecision()` + `recordPositionEntry()`
 *           are called from executeTrade(); the resulting rows live on
 *           `state.trading.positionEntries[symbol]`. When the synthesizer
 *           sees a live row it prefers it (`backfilled: false`) over any
 *           trade-history match.
 *
 * Constraints (per spec):
 *   - No I/O. No LLM calls. No extra RPC.
 *   - Reads injected deps only — no module-level state access.
 *   - Cheap enough to run inside every heavy cycle.
 *
 * Consumed by:
 *   - GET /api/positions/attribution (Phase 1)
 *   - cycleCtx.positionAttribution
 *   - Phase 3 goal-state reasoner
 *   - Phase 4 stc-website cockpit
 */

import type {
  PositionAttribution,
  PositionAttributionResponse,
  PositionAttributionSummary,
  PositionEnteredBy,
  PositionEntryContext,
  PositionExitCriterion,
  PositionRole,
} from '../types/position-attribution.js';
import type { BalanceEntry, TokenCostBasis, TradeRecord } from '../types/index.js';
import type { PositionEntryRow } from '../types/state.js';
import type { SleeveOwnership } from '../sleeves/state-types.js';
import type { TradeDecision } from '../types/market-data.js';

// ============================================================================
// Static classification tables
// ============================================================================

/** Tokens treated as "asset base" — Henry's role pill = core. */
const CORE_ROLE_SYMBOLS = new Set([
  'WETH', 'ETH', 'cbBTC', 'CBBTC', 'WBTC', 'cbETH', 'CBETH', 'wstETH', 'WSTETH',
]);

/** Stable / cash equivalents — role pill = dry-powder. */
const DRY_POWDER_SYMBOLS = new Set(['USDC', 'USDT', 'DAI']);

/** WD tight-exit defaults from `src/core/sleeves/alpha-hunter.ts` (WD_*). */
const WD_DEFAULTS = {
  takeProfitPct: 8,
  trailingStopPct: 3,
  maxHoldHours: 12,
} as const;

/** How far back to scan tradeHistory for a matching entry BUY. */
const TRADE_HISTORY_LOOKBACK_DAYS = 30;

// ============================================================================
// Inputs / dependencies
// ============================================================================

export interface SynthesisDeps {
  /** Current bot balances. `usdValue` must be enriched before calling. */
  balances: BalanceEntry[];
  /** Per-symbol cost basis from state.costBasis. */
  costBasis: Record<string, TokenCostBasis>;
  /** Trade history (full or sliced — we'll do our own window filter). */
  tradeHistory: TradeRecord[];
  /** Per-sleeve ownership from state.sleeveOwnership; optional. */
  sleeveOwnership?: Record<string, SleeveOwnership>;
  /**
   * Token-registry lookup for sector tagging. Pass `TOKEN_REGISTRY` from
   * `src/core/config/token-registry.ts`. Optional — we'll fall back to the
   * static sets above if absent.
   */
  tokenRegistry?: Record<string, { sector?: string }>;
  /**
   * NVR-SPEC-032 Phase 2: per-symbol entry rows captured at BUY time by
   * `recordPositionEntry()` and persisted on `state.trading.positionEntries`.
   * When present for a symbol, the synthesizer uses this row as the
   * source of truth (`backfilled: false`) instead of scanning trade history.
   * Absent symbols fall back to Phase 1 backfill.
   */
  positionEntries?: Record<string, PositionEntryRow>;
  /**
   * Override "now" for testing. Defaults to Date.now().
   */
  now?: number;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Synthesize the full PositionAttributionResponse from injected state.
 *
 * Pure function — no side effects, no I/O.
 */
export function synthesizePositionAttributions(
  deps: SynthesisDeps,
): PositionAttributionResponse {
  const now = deps.now ?? Date.now();
  const synthesizedAt = new Date(now).toISOString();

  const balances = Array.isArray(deps.balances) ? deps.balances : [];
  const costBasis = deps.costBasis ?? {};
  const tradeHistory = Array.isArray(deps.tradeHistory) ? deps.tradeHistory : [];
  const sleeveOwnership = deps.sleeveOwnership ?? {};
  const positionEntries = deps.positionEntries ?? {};

  // Pre-window trade history to keep the per-position scan O(n) cheap.
  const cutoffMs = now - TRADE_HISTORY_LOOKBACK_DAYS * 86_400_000;
  const recentTrades = tradeHistory.filter((t) => {
    if (!t || t.success !== true) return false;
    if (t.action !== 'BUY') return false;
    const ts = t.timestamp ? Date.parse(t.timestamp) : NaN;
    return Number.isFinite(ts) && ts >= cutoffMs;
  });

  // Index sleeveOwnership by symbol → sleeveId for O(1) lookup.
  const sleeveBySymbol = indexSleeveOwnership(sleeveOwnership);

  // Build one row per non-trivial balance entry.
  const positions: PositionAttribution[] = [];
  let usdcBalanceUsd = 0;

  for (const bal of balances) {
    if (!bal || !bal.symbol) continue;
    const symbolUpper = bal.symbol.toUpperCase();
    const usdValue = typeof bal.usdValue === 'number' ? bal.usdValue : 0;

    if (symbolUpper === 'USDC') {
      usdcBalanceUsd = usdValue;
      continue;
    }
    if (usdValue <= 1) continue;

    // Phase 2: prefer live entry row when present (keyed by canonical symbol
    // or its uppercase form). Falls through to backfill when undefined.
    const liveEntry = positionEntries[bal.symbol] ?? positionEntries[symbolUpper];

    positions.push(
      buildPositionAttribution({
        balance: bal,
        costBasis: costBasis[bal.symbol] ?? costBasis[symbolUpper],
        recentTrades,
        sleeveBySymbol,
        tokenRegistry: deps.tokenRegistry,
        liveEntry,
        synthesizedAt,
        now,
      }),
    );
  }

  // Sort by currentValueUsd desc.
  positions.sort((a, b) => b.currentValueUsd - a.currentValueUsd);

  const summary = computeSummary(positions, usdcBalanceUsd);

  return { synthesizedAt, positions, summary };
}

// ============================================================================
// Per-position synthesis
// ============================================================================

interface RowInputs {
  balance: BalanceEntry;
  costBasis: TokenCostBasis | undefined;
  recentTrades: TradeRecord[];
  sleeveBySymbol: Map<string, string>;
  tokenRegistry?: Record<string, { sector?: string }>;
  /** NVR-SPEC-032 Phase 2: live entry row keyed by symbol, when present. */
  liveEntry?: PositionEntryRow;
  synthesizedAt: string;
  now: number;
}

function buildPositionAttribution(args: RowInputs): PositionAttribution {
  const { balance, costBasis, recentTrades, sleeveBySymbol, tokenRegistry, liveEntry, synthesizedAt, now } = args;
  const symbol = balance.symbol;
  const symbolUpper = symbol.toUpperCase();

  const currentValueUsd = balance.usdValue ?? 0;
  const bal = balance.balance ?? 0;
  const currentPriceUsd =
    typeof balance.price === 'number' && balance.price > 0
      ? balance.price
      : bal > 0
        ? currentValueUsd / bal
        : 0;

  // --- Cost basis + P&L ---
  // 2026-05-18 bug fix: `invested` was being set to `costBasis.totalInvestedUSD`
  // which is the LIFETIME cumulative buy volume — including all buys whose
  // tokens were later sold. That made unrealizedPnL = currentValueUsd −
  // lifetimeInvested, which is mathematically meaningless for the REMAINING
  // position. E.g. cbXRP: lifetime $1,208 buys, mostly sold, 13.6 cbXRP held
  // at $1.4458 avg cost = $19.65 actual remaining cost. Old math said
  // "−98% / −$1,189". Real unrealized = $19 − $19.65 = −$0.88 (~breakeven).
  //
  // Type doc was correct ("USD invested at entry"); only implementation was
  // wrong. Fix: invested = averageCostBasis × current balance — cost of the
  // REMAINING position. The historical lifetime number is still available
  // via state.costBasis[symbol].totalInvestedUSD for callers that need it.
  let invested: number | undefined;
  let entryPriceUsd: number | undefined;
  let unrealizedPnLUsd: number | undefined;
  let unrealizedPnLPct: number | undefined;
  if (costBasis && costBasis.averageCostBasis > 0 && bal > 0) {
    entryPriceUsd = costBasis.averageCostBasis;
    invested = entryPriceUsd * bal;
    unrealizedPnLUsd = currentValueUsd - invested;
    if (invested > 0) {
      unrealizedPnLPct = (unrealizedPnLUsd / invested) * 100;
    }
  }

  // --- Sleeve attribution ---
  const sleeve = sleeveBySymbol.get(symbolUpper);

  // --- Role tag ---
  const role = classifyRole(symbolUpper, tokenRegistry);

  // ==========================================================================
  // Phase 2 path: live entry row was captured at executeTrade time.
  // Prefer it over trade-history backfill — it's the ground truth.
  // ==========================================================================
  if (liveEntry) {
    let ageHours: number | undefined;
    const t = Date.parse(liveEntry.enteredAt);
    if (Number.isFinite(t)) {
      ageHours = Math.max(0, (now - t) / 3_600_000);
    }
    return {
      symbol,
      address: '',
      currentValueUsd,
      balance: bal,
      currentPriceUsd,
      invested,
      entryPriceUsd,
      unrealizedPnLUsd,
      unrealizedPnLPct,
      enteredAt: liveEntry.enteredAt,
      ageHours,
      enteredBy: liveEntry.enteredBy,
      role,
      sleeve,
      entryContext: liveEntry.entryContext,
      exitCriterion: liveEntry.exitCriterion ?? inferExitCriterion(liveEntry.enteredBy),
      synthesizedAt,
      backfilled: false,
    };
  }

  // ==========================================================================
  // Phase 1 fallback: backfill from trade history.
  // ==========================================================================

  // --- Find the most-recent matching BUY ---
  const matchingTrade = findMostRecentBuy(recentTrades, symbol);

  // --- Classify entry path ---
  const enteredBy = classifyEnteredBy({
    matchingTrade,
    sleeve,
    symbolUpper,
    tokenRegistry,
  });

  // --- Entry timestamp + age ---
  let enteredAt: string | undefined;
  let ageHours: number | undefined;
  if (matchingTrade?.timestamp) {
    enteredAt = matchingTrade.timestamp;
    const t = Date.parse(matchingTrade.timestamp);
    if (Number.isFinite(t)) {
      ageHours = Math.max(0, (now - t) / 3_600_000);
    }
  } else if (costBasis?.firstBuyDate) {
    // Fall back to cost-basis first-buy date when trade history doesn't reach back.
    enteredAt = costBasis.firstBuyDate;
    const t = Date.parse(costBasis.firstBuyDate);
    if (Number.isFinite(t)) {
      ageHours = Math.max(0, (now - t) / 3_600_000);
    }
  }

  // --- Exit criterion (best effort, derived from enteredBy) ---
  const exitCriterion = inferExitCriterion(enteredBy);

  // --- Entry context (best effort, only when trade has obvious markers) ---
  const entryContext = buildEntryContext(matchingTrade);

  return {
    symbol,
    address: '', // Phase 1 backfill — not always present on balances; Phase 4 cockpit reads token registry directly.
    currentValueUsd,
    balance: bal,
    currentPriceUsd,
    invested,
    entryPriceUsd,
    unrealizedPnLUsd,
    unrealizedPnLPct,
    enteredAt,
    ageHours,
    enteredBy,
    role,
    sleeve,
    entryContext,
    exitCriterion,
    synthesizedAt,
    backfilled: true,
  };
}

// ============================================================================
// Classification helpers
// ============================================================================

function classifyEnteredBy(args: {
  matchingTrade: TradeRecord | undefined;
  sleeve: string | undefined;
  symbolUpper: string;
  tokenRegistry?: Record<string, { sector?: string }>;
}): PositionEnteredBy {
  const { matchingTrade, sleeve, symbolUpper, tokenRegistry } = args;
  const reasoning = (matchingTrade?.reasoning ?? '').toString();

  // Strongest signals first — explicit reasoning markers from agent-v3.2 / sleeves.
  if (reasoning.includes('ALPHA_HUNTER_WD') || /Watcher[-\s]Direct/i.test(reasoning)) {
    return 'alpha-hunter-wd';
  }
  if (reasoning.includes('ALPHA_LIBERATION') || /fast[-\s]strike/i.test(reasoning)) {
    return 'fast-strike-liberation';
  }
  if (reasoning.includes('WETH_REBALANCE')) {
    return 'weth-rebalance';
  }

  // Trade record's ownerSleeve / attribution fields (v21.15+).
  const ownerSleeve = (matchingTrade?.ownerSleeve ?? sleeve ?? '').toLowerCase();
  if (ownerSleeve === 'alpha-hunter' || ownerSleeve === 'alpha-hunter-wd') {
    return 'alpha-hunter-wd';
  }
  if (ownerSleeve === 'alpha-rotation') {
    return 'alpha-rotation';
  }
  if (ownerSleeve === 'core') {
    return 'core';
  }

  // Manual override marker (operator test trades typically include this).
  if (/\bmanual\b/i.test(reasoning) || /operator override/i.test(reasoning)) {
    return 'manual';
  }

  // Sector inference — blue-chip core tokens default to 'core' when no trade match.
  const sector = tokenRegistry?.[symbolUpper]?.sector;
  if (sector === 'BLUE_CHIP' && CORE_ROLE_SYMBOLS.has(symbolUpper)) {
    return matchingTrade ? 'core' : 'legacy-unknown';
  }

  // No matching trade history row → legacy.
  if (!matchingTrade) return 'legacy-unknown';

  // Trade exists but we couldn't classify — treat as core (the bot's default
  // decision path is the Core sleeve as of v21.13).
  return 'core';
}

function classifyRole(
  symbolUpper: string,
  tokenRegistry?: Record<string, { sector?: string }>,
): PositionRole {
  if (DRY_POWDER_SYMBOLS.has(symbolUpper)) return 'dry-powder';
  if (CORE_ROLE_SYMBOLS.has(symbolUpper)) return 'core';

  const sector = tokenRegistry?.[symbolUpper]?.sector;
  // BLUE_CHIP outside the core-role set (e.g. LINK, ZRO, AXL) lands as
  // 'core' — they are the asset-base sector by definition.
  if (sector === 'BLUE_CHIP') return 'core';

  return 'alpha';
}

function inferExitCriterion(enteredBy: PositionEnteredBy): PositionExitCriterion | undefined {
  switch (enteredBy) {
    case 'alpha-hunter-wd':
      return {
        type: 'wd-tight-exit',
        takeProfitPct: WD_DEFAULTS.takeProfitPct,
        trailingStopPct: WD_DEFAULTS.trailingStopPct,
        maxHoldHours: WD_DEFAULTS.maxHoldHours,
      };
    case 'fast-strike-liberation':
      // Fast-strike entries inherit the same WD ladder (they exist to feed WD setups).
      return {
        type: 'wd-tight-exit',
        takeProfitPct: WD_DEFAULTS.takeProfitPct,
        trailingStopPct: WD_DEFAULTS.trailingStopPct,
        maxHoldHours: WD_DEFAULTS.maxHoldHours,
      };
    case 'core':
      return { type: 'core-thesis-driven' };
    case 'alpha-rotation':
      return { type: 'alpha-rotation' };
    case 'weth-rebalance':
      return { type: 'ad-hoc' };
    case 'manual':
      return { type: 'ad-hoc' };
    case 'legacy-unknown':
      return { type: 'ad-hoc' };
    default:
      return undefined;
  }
}

function buildEntryContext(trade: TradeRecord | undefined): PositionEntryContext | undefined {
  if (!trade) return undefined;

  const ctx: PositionEntryContext = {};
  let populated = false;

  const reasoning = (trade.reasoning ?? '').toString();
  if (reasoning) {
    ctx.reasoning = reasoning.length > 200 ? reasoning.slice(0, 200) : reasoning;
    populated = true;
  }

  // Try to extract trigger type from reasoning markers.
  const triggerMatch = reasoning.match(/(WHALE_BUY|BUY_PRESSURE|MOMENTUM_BREAK|VOLUME_SPIKE)/);
  if (triggerMatch) {
    ctx.triggerType = triggerMatch[1];
    populated = true;
  }

  // Regime — trade record optionally carries `regime` (v21.15+) and signalContext.marketRegime.
  const regimeRaw = (trade.regime ?? trade.signalContext?.marketRegime ?? '').toString().toUpperCase();
  if (regimeRaw === 'BULL' || regimeRaw === 'RANGING' || regimeRaw === 'BEAR') {
    ctx.regimeAtEntry = regimeRaw;
    populated = true;
  } else if (regimeRaw === 'TRENDING_UP') {
    ctx.regimeAtEntry = 'BULL';
    populated = true;
  } else if (regimeRaw === 'TRENDING_DOWN') {
    ctx.regimeAtEntry = 'BEAR';
    populated = true;
  }

  return populated ? ctx : undefined;
}

// ============================================================================
// Trade-history search
// ============================================================================

function findMostRecentBuy(
  recentTrades: TradeRecord[],
  symbol: string,
): TradeRecord | undefined {
  if (!symbol) return undefined;
  const symbolUpper = symbol.toUpperCase();

  let best: TradeRecord | undefined;
  let bestTs = -Infinity;
  for (const t of recentTrades) {
    if (!t || t.action !== 'BUY' || t.success !== true) continue;
    // The bot logs BUYs as fromToken=USDC, toToken=<asset> (typically).
    const to = (t.toToken ?? '').toUpperCase();
    const from = (t.fromToken ?? '').toUpperCase();
    if (to !== symbolUpper && from !== symbolUpper) continue;
    // Prefer rows where the asset is the `toToken` (true BUY into the asset).
    if (to !== symbolUpper && from === symbolUpper) continue;

    const ts = t.timestamp ? Date.parse(t.timestamp) : NaN;
    if (!Number.isFinite(ts)) continue;
    if (ts > bestTs) {
      bestTs = ts;
      best = t;
    }
  }
  return best;
}

function indexSleeveOwnership(
  sleeveOwnership: Record<string, SleeveOwnership>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [sleeveId, ownership] of Object.entries(sleeveOwnership ?? {})) {
    const positions = ownership?.positions ?? {};
    for (const sym of Object.keys(positions)) {
      out.set(sym.toUpperCase(), sleeveId);
    }
  }
  return out;
}

// ============================================================================
// Summary computation
// ============================================================================

function computeSummary(
  positions: PositionAttribution[],
  usdcBalanceUsd: number,
): PositionAttributionSummary {
  const byEnteredBy: Record<PositionEnteredBy, { count: number; usdValue: number }> = {
    'core':                    { count: 0, usdValue: 0 },
    'alpha-hunter-wd':         { count: 0, usdValue: 0 },
    'alpha-rotation':          { count: 0, usdValue: 0 },
    'fast-strike-liberation':  { count: 0, usdValue: 0 },
    'weth-rebalance':          { count: 0, usdValue: 0 },
    'manual':                  { count: 0, usdValue: 0 },
    'legacy-unknown':          { count: 0, usdValue: 0 },
  };
  const byRole: Record<PositionRole, { count: number; usdValue: number }> = {
    'core':       { count: 0, usdValue: 0 },
    'dry-powder': { count: 0, usdValue: 0 },
    'alpha':      { count: 0, usdValue: 0 },
  };

  let totalNonUsdcValueUsd = 0;
  let phase2AttributedCount = 0;
  let legacyUnknownCount = 0;

  for (const p of positions) {
    totalNonUsdcValueUsd += p.currentValueUsd;
    byEnteredBy[p.enteredBy].count += 1;
    byEnteredBy[p.enteredBy].usdValue += p.currentValueUsd;
    byRole[p.role].count += 1;
    byRole[p.role].usdValue += p.currentValueUsd;
    if (p.backfilled === false) phase2AttributedCount += 1;
    if (p.enteredBy === 'legacy-unknown') legacyUnknownCount += 1;
  }

  return {
    totalPositions: positions.length,
    totalNonUsdcValueUsd,
    usdcBalanceUsd,
    byEnteredBy,
    byRole,
    phase2AttributedCount,
    legacyUnknownCount,
  };
}

// ============================================================================
// NVR-SPEC-032 Phase 2 — Entry-capture helpers (called by executeTrade)
//
// `buildEntryRowFromDecision` turns a successful BUY's TradeDecision into a
// `PositionEntryRow` ready to drop onto `state.trading.positionEntries`.
// `clearPositionEntry` removes the row on a successful SELL.
// Both are pure (no module-level state) so they can be unit-tested in
// isolation — agent-v3.2.ts is the only side-effecting caller.
// ============================================================================

export interface BuildEntryRowDeps {
  decision: TradeDecision;
  /** The macro-regime singleton's current value (BULL/RANGING/BEAR). */
  macroRegime?: 'BULL' | 'RANGING' | 'BEAR';
  /**
   * Optional override of the entry timestamp. Defaults to "now" ISO.
   * Tests pass a fixed value; production callers omit it.
   */
  enteredAt?: string;
  /**
   * True when this BUY was triggered immediately after a FAST_STRIKE /
   * ALPHA_LIBERATION SELL liberated USDC in the same cycle. Promotes the
   * resulting attribution to 'alpha-hunter-wd' — that liberated capital
   * was always destined for a WD strike, even if the BUY decision's
   * reasoning doesn't mention WD explicitly.
   */
  followsFastStrikeLiberation?: boolean;
}

/** Default WD exit ladder, mirrored from `src/core/sleeves/alpha-hunter.ts`. */
const PHASE_2_WD_DEFAULTS = {
  takeProfitPct: 8,
  trailingStopPct: 3,
  maxHoldHours: 12,
} as const;

/**
 * Build a PositionEntryRow from a successful BUY decision. The caller is
 * responsible for writing the row to state.trading.positionEntries[symbol]
 * and persisting state. Returns `null` for non-BUY decisions or when the
 * target symbol is missing/USDC (defensive — should never happen in prod).
 */
export function buildEntryRowFromDecision(deps: BuildEntryRowDeps): PositionEntryRow | null {
  const { decision } = deps;
  if (!decision || decision.action !== 'BUY') return null;
  const symbol = decision.toToken;
  if (!symbol || symbol === 'USDC') return null;

  const reasoning = (decision.reasoning ?? '').toString();
  const md = (decision.metadata ?? {}) as Record<string, unknown>;

  // --- Classify entry path ---
  // Strongest signal: the FAST_STRIKE liberation cue from the orchestrator —
  // a BUY immediately following a USDC-liberation SELL is by construction a WD entry.
  let enteredBy: PositionEnteredBy;
  if (deps.followsFastStrikeLiberation) {
    enteredBy = 'alpha-hunter-wd';
  } else if (/Watcher-Direct|ALPHA_HUNTER_WD/.test(reasoning)) {
    enteredBy = 'alpha-hunter-wd';
  } else if (/ALPHA_LIBERATION|fast[-\s]strike/i.test(reasoning)) {
    enteredBy = 'fast-strike-liberation';
  } else if (/WETH_REBALANCE/.test(reasoning)) {
    enteredBy = 'weth-rebalance';
  } else if (/\bmanual\b|operator override/i.test(reasoning)) {
    enteredBy = 'manual';
  } else if ((decision.ownerSleeve ?? '').toLowerCase() === 'alpha-rotation') {
    enteredBy = 'alpha-rotation';
  } else if ((decision.ownerSleeve ?? '').toLowerCase() === 'alpha-hunter' ||
             (decision.ownerSleeve ?? '').toLowerCase() === 'alpha-hunter-wd') {
    enteredBy = 'alpha-hunter-wd';
  } else {
    // Default: Core sleeve normal-conviction BUY.
    enteredBy = 'core';
  }

  // --- Entry context ---
  const ctx: PositionEntryContext = {};

  // Decision metadata wins when present.
  if (typeof md.triggerId === 'string') ctx.triggerId = md.triggerId;
  if (typeof md.triggerType === 'string') ctx.triggerType = md.triggerType;
  if (md.reviewerVerdict === 'BUY' || md.reviewerVerdict === 'WAIT' || md.reviewerVerdict === 'PASS') {
    ctx.reviewerVerdict = md.reviewerVerdict;
  }
  if (typeof md.reviewerConfidence === 'number' && Number.isFinite(md.reviewerConfidence)) {
    ctx.reviewerConfidence = md.reviewerConfidence;
  }

  // Reasoning-marker fallback for trigger type (matches the Phase 1 backfill set).
  if (!ctx.triggerType) {
    const tm = reasoning.match(/(WHALE_BUY|BUY_PRESSURE|MOMENTUM_BREAK|VOLUME_SPIKE)/);
    if (tm) ctx.triggerType = tm[1];
  }

  // Regime — prefer decision.signalContext.marketRegime then the macroRegime singleton.
  const sigRegime = (decision.signalContext?.marketRegime ?? '').toString().toUpperCase();
  if (sigRegime === 'BULL' || sigRegime === 'RANGING' || sigRegime === 'BEAR') {
    ctx.regimeAtEntry = sigRegime;
  } else if (sigRegime === 'TRENDING_UP') {
    ctx.regimeAtEntry = 'BULL';
  } else if (sigRegime === 'TRENDING_DOWN') {
    ctx.regimeAtEntry = 'BEAR';
  } else if (deps.macroRegime) {
    ctx.regimeAtEntry = deps.macroRegime;
  }

  // Reasoning — first 200 chars per spec.
  if (reasoning) {
    ctx.reasoning = reasoning.length > 200 ? reasoning.slice(0, 200) : reasoning;
  }

  // --- Exit criterion derived from entry path ---
  let exitCriterion: PositionExitCriterion | undefined;
  switch (enteredBy) {
    case 'alpha-hunter-wd':
    case 'fast-strike-liberation':
      exitCriterion = {
        type: 'wd-tight-exit',
        takeProfitPct: PHASE_2_WD_DEFAULTS.takeProfitPct,
        trailingStopPct: PHASE_2_WD_DEFAULTS.trailingStopPct,
        maxHoldHours: PHASE_2_WD_DEFAULTS.maxHoldHours,
      };
      break;
    case 'core':
      exitCriterion = { type: 'core-thesis-driven' };
      break;
    case 'alpha-rotation':
      exitCriterion = { type: 'alpha-rotation' };
      break;
    case 'weth-rebalance':
    case 'manual':
      exitCriterion = { type: 'ad-hoc' };
      break;
    default:
      exitCriterion = undefined;
  }

  return {
    enteredAt: deps.enteredAt ?? new Date().toISOString(),
    enteredBy,
    entryContext: ctx,
    exitCriterion,
  };
}

/**
 * Side-effecting writer. Mutates `target` (e.g. state.trading.positionEntries
 * — caller is responsible for `?? {}` defensiveness BEFORE calling).
 * Returns the row that was written, for logging.
 */
export function recordPositionEntry(
  target: Record<string, PositionEntryRow>,
  symbol: string,
  row: PositionEntryRow,
): PositionEntryRow {
  target[symbol] = row;
  return row;
}

/**
 * Side-effecting deleter. Removes the entry for a symbol on successful SELL.
 * Safe to call when the entry doesn't exist (no-op). Returns true if a row
 * was removed.
 */
export function clearPositionEntry(
  target: Record<string, PositionEntryRow> | undefined,
  symbol: string,
): boolean {
  if (!target || !symbol) return false;
  if (target[symbol] !== undefined) {
    delete target[symbol];
    return true;
  }
  const upper = symbol.toUpperCase();
  if (target[upper] !== undefined) {
    delete target[upper];
    return true;
  }
  return false;
}
