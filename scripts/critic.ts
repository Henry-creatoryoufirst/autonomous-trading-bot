/**
 * NVR-CRITIC — v2 · Real decision-outcome audit
 *
 * The feedback loop SPEC-018 envisions. Reads the bot's actual trade decisions
 * + their realized outcomes, classifies them by pattern (trailing-stop, dry-powder
 * rebalance, emergency exit, momentum chase, etc.), and writes a human-readable
 * audit + a machine-structured rules-proposal.
 *
 * Henry reads it with coffee. Henry picks 1–2 changes. Those ship. Next CRITIC
 * measures the change. That's the loop.
 *
 * CRITIC proposes. Henry merges. Nothing auto-applies.
 *
 * Invoked manually (`npm run critic`) or via nightly cron once CRITIC_ENABLED=true.
 *
 * Env vars:
 *   BOT_URL   — base URL of the bot to audit (default: prod main bot)
 *   CRITIC_WINDOW_HOURS — analysis window (default: 168 = 7 days; nightly should be 24)
 */

import fs from 'node:fs';
import path from 'node:path';

import { TOKEN_REGISTRY } from '../src/core/config/token-registry.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATA_DIR = path.resolve(process.cwd(), 'data');
const REPORTS_DIR = path.join(DATA_DIR, 'critic-reports');
const RULES_PROPOSAL_PATH = path.join(DATA_DIR, 'rules-proposal.yaml');
/**
 * Prompt-ready summary of the latest CRITIC audit. The bot reads this at
 * cycle start (when CRITIC_MEMORY_ENABLED is true) and injects it into
 * heavy-cycle Sonnet prompts so the decision-maker reasons with its own
 * recent pattern outcomes, not blind each cycle.
 */
const MEMORY_PATH = path.join(DATA_DIR, 'critic-memory.md');

const BOT_URL = process.env.BOT_URL ?? 'https://autonomous-trading-bot-production.up.railway.app';
const WINDOW_HOURS = parseInt(process.env.CRITIC_WINDOW_HOURS ?? '168', 10);

/** Minimum sample size before a pattern gets a proposal (noise floor). */
const MIN_SAMPLES_TO_PROPOSE = 3;

/** A SELL with realized P&L in this range is "break-even" — neither a win nor a loss. */
const BREAK_EVEN_ABS_USD = 1.0;

// ---------------------------------------------------------------------------
// Types (shapes we read from the bot's JSON endpoints)
// ---------------------------------------------------------------------------

interface Trade {
  timestamp: string;
  cycle: number;
  action: 'BUY' | 'SELL' | 'HOLD';
  fromToken: string;
  toToken: string;
  amountUSD: number;
  reasoning?: string;
  realizedPnL: number;
  success: boolean;
  sector?: string;
  regime?: string;
  ownerSleeve?: string;
  portfolioValueBefore: number;
  portfolioValueAfter: number;
  signalContext?: {
    marketRegime?: string;
    confluenceScore?: number;
    rsi?: number | null;
    triggeredBy?: string;
    isForced?: boolean;
  };
  marketConditions?: {
    fearGreed?: number;
    btcPrice?: number;
    ethPrice?: number;
  };
}

interface Balance {
  symbol: string;
  balance: number;
  usdValue: number;
  costBasis?: number | null;
  unrealizedPnL?: number;
  totalInvested?: number;
  realizedPnL?: number;
}

interface Portfolio {
  version?: string;
  totalValue?: number;
  totalTrades?: number;
  drawdown?: number;
  truePnL?: number;
  realizedPnL?: number;
  unrealizedPnL?: number;
}

interface ModelTelemetry {
  totalCycles?: number;
  gemmaCycles?: number;
  claudeCycles?: number;
  currentTier?: string;
  gemmaMode?: string;
  estimatedDailyCostUSD?: number;
  cacheHitRate?: number;
  backendHealth?: Record<string, { healthy?: boolean }>;
}

// ---------------------------------------------------------------------------
// Pattern classification — each trade's reasoning gets labeled by the first match
// ---------------------------------------------------------------------------

/**
 * Ordered by specificity — more specific patterns first. First-match wins.
 * Labels are snake_case; they become the key in rules-proposal.yaml.
 */
const PATTERNS: Array<{ label: string; regex: RegExp; note?: string }> = [
  { label: 'emergency_exit',       regex: /\bEMERGENCY|drawdown.?override|crash.?protect|circuit.?break/i, note: 'critical-state forced exits' },
  { label: 'stop_loss',            regex: /stop.?loss|stop.?out|hard.?stop/i },
  { label: 'trailing_stop',        regex: /trailing.?stop|trail.?stop|ATR.?trail/i },
  { label: 'drawdown_override',    regex: /drawdown.*override|-8%.?override|🩸/i,                          note: 'SPEC-015 asymmetric exit' },
  { label: 'stale_exit',           regex: /stale|time.?in.?position|48h|hold.?too.?long|no.?progress/i,   note: 'position outlived its setup' },
  { label: 'harvest_profit',       regex: /harvest|take.?profit|lock.?in|realize.?profit/i },
  { label: 'dry_powder_rebalance', regex: /dry.?powder|restore.?capital|USDC.*target|25%/i,               note: '25% USDC reserve rule' },
  { label: 'sector_rebalance',     regex: /rebalance|sector|allocation.?drift|overweight/i },
  { label: 'confluence_strong',    regex: /STRONG_BUY|STRONG_SELL|high.?conviction|confluence/i },
  { label: 'momentum_chase',       regex: /momentum|breakout|catch.*move|trending|squeeze/i },
  { label: 'regime_shift',         regex: /regime.?shift|market.?shift|trend.?change|flip/i },
  { label: 'ai_discretionary',     regex: /.*/,                                                           note: 'catch-all — Claude/Groq free-form decision' },
];

function classifyTrade(t: Trade): string {
  const reason = t.reasoning ?? '';
  for (const p of PATTERNS) {
    if (p.regex.test(reason)) return p.label;
  }
  return 'unclassified';
}

// ---------------------------------------------------------------------------
// Data fetch
// ---------------------------------------------------------------------------

async function fetchJSON<T>(url: string, timeoutMs = 15_000): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[CRITIC] ${url} returned ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[CRITIC] fetch ${url} failed:`, (err as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

interface PatternStats {
  label: string;
  note?: string;
  n: number;
  wins: number;
  losses: number;
  evens: number;
  totalPnL: number;
  avgPnL: number;
  winRate: number;
  examples: string[];
}

function pnl(t: Trade): number {
  return typeof t.realizedPnL === 'number' && !Number.isNaN(t.realizedPnL) ? t.realizedPnL : 0;
}

function buildPatternStats(sells: Trade[]): PatternStats[] {
  const byPattern = new Map<string, Trade[]>();
  for (const t of sells) {
    const label = classifyTrade(t);
    const arr = byPattern.get(label) ?? [];
    arr.push(t);
    byPattern.set(label, arr);
  }

  const stats: PatternStats[] = [];
  for (const [label, arr] of byPattern) {
    const wins = arr.filter((t) => pnl(t) > BREAK_EVEN_ABS_USD).length;
    const losses = arr.filter((t) => pnl(t) < -BREAK_EVEN_ABS_USD).length;
    const evens = arr.length - wins - losses;
    const totalPnL = arr.reduce((s, t) => s + pnl(t), 0);
    const example_src = [...arr].sort((a, b) => Math.abs(pnl(b)) - Math.abs(pnl(a))).slice(0, 3);
    const examples = example_src.map((t) => {
      const p = pnl(t);
      return `  - ${t.fromToken} ${p >= 0 ? '+' : ''}$${p.toFixed(2)} · ${(t.reasoning ?? '').slice(0, 110).replace(/\s+/g, ' ')}`;
    });
    const note = PATTERNS.find((p) => p.label === label)?.note;
    stats.push({
      label,
      note,
      n: arr.length,
      wins,
      losses,
      evens,
      totalPnL,
      avgPnL: totalPnL / arr.length,
      winRate: arr.length > 0 ? wins / arr.length : 0,
      examples,
    });
  }
  return stats.sort((a, b) => b.avgPnL - a.avgPnL);
}

interface OpenPositionAudit {
  symbol: string;
  sector?: string;
  usdValue: number;
  totalInvested: number;
  unrealizedPnL: number;
  unrealizedPct: number;
}

function auditOpenPositions(balances: Balance[]): OpenPositionAudit[] {
  return balances
    .filter((b) => b.symbol !== 'USDC' && (b.totalInvested ?? 0) > 0)
    .map((b) => {
      const totalInvested = b.totalInvested ?? 0;
      const unrealizedPnL = b.unrealizedPnL ?? 0;
      const unrealizedPct = totalInvested > 0 ? (unrealizedPnL / totalInvested) * 100 : 0;
      return {
        symbol: b.symbol,
        sector: undefined,
        usdValue: b.usdValue,
        totalInvested,
        unrealizedPnL,
        unrealizedPct,
      };
    })
    .sort((a, b) => b.unrealizedPnL - a.unrealizedPnL);
}

// ---------------------------------------------------------------------------
// v3: Round-trip BUY → SELL analysis (the "alpha capture" question)
// ---------------------------------------------------------------------------

interface RoundTrip {
  token: string;
  buyAt: string;
  buyCycle: number;
  buyReasoning: string;
  buyAmountUSD: number;
  buyTokenAmount: number;
  sellAt: string;
  sellCycle: number;
  sellReasoning: string;
  sellAmountUSD: number;
  sellTokenAmount: number;
  holdHours: number;
  realizedPnL: number;
  realizedPct: number;
  // Counterfactual (annotated after live-price fetch):
  currentPriceUSD?: number;
  exitPriceUSD?: number;
  sinceExitPct?: number; // + = bot bailed on a winner, - = well-timed exit
  /** Of the total move from entry to current price, what fraction did the bot capture? */
  captureRatio?: number;
}

interface OpenBuy {
  token: string;
  buyAt: string;
  buyCycle: number;
  buyReasoning: string;
  buyAmountUSD: number;
  holdHours: number;
  currentUSDValue: number;
  unrealizedPnL: number;
  unrealizedPct: number;
}

/**
 * FIFO-lite pairing: for each SELL of a non-USDC token, match against the
 * earliest unmatched BUY of the same token. Simplifications:
 *   - One SELL closes one BUY (ignores partial fills; realizedPnL from the
 *     trade is still authoritative, so the top-line $ figure is correct).
 *   - BUYs that were executed *before* the window become unmatched SELLs and
 *     are dropped — they're outside the audit scope.
 *   - BUYs that haven't sold yet become "open buys" with unrealized from
 *     /api/balances. Over-attributes gain/loss to specific BUY events when
 *     the token was bought multiple times; captures direction reliably.
 */
function buildRoundTrips(trades: Trade[], balances: Balance[]): { roundTrips: RoundTrip[]; openBuys: OpenBuy[] } {
  const ordered = [...trades].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const openByToken = new Map<string, Trade[]>();
  const roundTrips: RoundTrip[] = [];

  for (const t of ordered) {
    if (!t.success) continue;
    if (t.action === 'BUY') {
      const tok = (t.toToken || '').toUpperCase();
      if (!tok || tok === 'USDC') continue;
      const q = openByToken.get(tok) ?? [];
      q.push(t);
      openByToken.set(tok, q);
    } else if (t.action === 'SELL') {
      const tok = (t.fromToken || '').toUpperCase();
      if (!tok || tok === 'USDC') continue;
      const q = openByToken.get(tok) ?? [];
      const buy = q.shift();
      if (!buy) continue; // unmatched SELL — BUY was outside window
      const holdHours = (new Date(t.timestamp).getTime() - new Date(buy.timestamp).getTime()) / 3_600_000;
      const realizedPnL = pnl(t);
      const realizedPct = buy.amountUSD > 0 ? (realizedPnL / buy.amountUSD) * 100 : 0;
      const buyTokenAmount = (buy as Trade & { tokenAmount?: number }).tokenAmount ?? 0;
      const sellTokenAmount = (t as Trade & { tokenAmount?: number }).tokenAmount ?? 0;
      roundTrips.push({
        token: tok,
        buyAt: buy.timestamp,
        buyCycle: buy.cycle,
        buyReasoning: buy.reasoning ?? '',
        buyAmountUSD: buy.amountUSD,
        buyTokenAmount,
        sellAt: t.timestamp,
        sellCycle: t.cycle,
        sellReasoning: t.reasoning ?? '',
        sellAmountUSD: t.amountUSD,
        sellTokenAmount,
        holdHours,
        realizedPnL,
        realizedPct,
      });
      openByToken.set(tok, q);
    }
  }

  // Remaining queued BUYs → open positions
  const balByToken = new Map<string, Balance>();
  for (const b of balances) balByToken.set(b.symbol.toUpperCase(), b);

  const openBuys: OpenBuy[] = [];
  for (const [tok, queue] of openByToken) {
    for (const b of queue) {
      const bal = balByToken.get(tok);
      const currentUSDValue = bal?.usdValue ?? 0;
      const unrealizedPnL = bal?.unrealizedPnL ?? 0;
      const totalInvested = bal?.totalInvested ?? b.amountUSD;
      const unrealizedPct = totalInvested > 0 ? (unrealizedPnL / totalInvested) * 100 : 0;
      const holdHours = (Date.now() - new Date(b.timestamp).getTime()) / 3_600_000;
      openBuys.push({
        token: tok,
        buyAt: b.timestamp,
        buyCycle: b.cycle,
        buyReasoning: b.reasoning ?? '',
        buyAmountUSD: b.amountUSD,
        holdHours,
        currentUSDValue,
        unrealizedPnL,
        unrealizedPct,
      });
    }
  }

  return { roundTrips, openBuys };
}

/**
 * Fetch current USD spot prices for a list of token symbols via DexScreener,
 * using addresses resolved from TOKEN_REGISTRY. Returns a map keyed by
 * uppercase symbol. Silently skips tokens we can't resolve or that fail.
 */
async function fetchCurrentPricesForSymbols(symbols: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];

  for (const symbol of unique) {
    const entry =
      (TOKEN_REGISTRY as Record<string, { address: string; symbol: string }>)[symbol]
      ?? Object.values(TOKEN_REGISTRY).find((t) => t.symbol.toUpperCase() === symbol);
    if (!entry || !entry.address || entry.address === 'native' || !entry.address.startsWith('0x')) continue;

    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${entry.address}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) continue;
      const data = (await res.json()) as { pairs?: Array<{ chainId?: string; priceUsd?: string; liquidity?: { usd?: number } }> };
      const all = data?.pairs ?? [];
      const onBase = all.filter((p) => p.chainId === 'base');
      const pool = onBase.length > 0 ? onBase : all;
      const best = pool.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      const price = parseFloat(best?.priceUsd ?? '0');
      if (price > 0) prices.set(symbol, price);
    } catch {
      // continue
    }
  }
  return prices;
}

/**
 * For each round-trip with a valid exit price and a current-price lookup,
 * compute: exit price per token, % move since exit, and capture ratio
 * (realized move / total available move from entry to current).
 */
function annotateWithCounterfactual(roundTrips: RoundTrip[], currentPrices: Map<string, number>): void {
  for (const rt of roundTrips) {
    const current = currentPrices.get(rt.token);
    if (!current || !rt.sellTokenAmount || rt.sellTokenAmount <= 0) continue;
    const exitPrice = rt.sellAmountUSD / rt.sellTokenAmount;
    if (exitPrice <= 0) continue;
    rt.exitPriceUSD = exitPrice;
    rt.currentPriceUSD = current;
    rt.sinceExitPct = ((current - exitPrice) / exitPrice) * 100;

    // Capture ratio: what fraction of the available entry→now move did the bot capture?
    // Only meaningful when the total move was actually positive.
    if (rt.buyTokenAmount > 0 && rt.buyAmountUSD > 0) {
      const entryPrice = rt.buyAmountUSD / rt.buyTokenAmount;
      if (entryPrice > 0) {
        const totalMovePct = ((current - entryPrice) / entryPrice) * 100;
        if (totalMovePct > 0.5) {
          // Captured = our realized % return. Capped at 1.0 for display sanity.
          rt.captureRatio = Math.min(1, rt.realizedPct / totalMovePct);
        } else if (totalMovePct < -0.5) {
          // Token fell — if we realized a gain here, capture ratio is > 1 (good timing)
          rt.captureRatio = rt.realizedPct > 0 ? 1 : 0;
        }
      }
    }
  }
}

interface RoundTripSummary {
  totalRoundTrips: number;
  winners: number;
  losers: number;
  breakEvens: number;
  totalRealizedPnL: number;
  avgRealizedPnL: number;
  avgHoldHours: number;
  // Alpha-capture stats (only for trips where counterfactual resolved)
  tripsWithCounterfactual: number;
  /** Avg % move since we exited. Positive = we consistently bail on winners. */
  avgSinceExitPct: number;
  /** Avg ratio of realized/available move. < 0.3 = systematically early exits. */
  avgCaptureRatio: number | null;
  /** Round-trips where token went up > 10% after our exit. */
  bailedOnWinners: RoundTrip[];
  /** Round-trips where token went down > 5% after our exit. */
  wellTimedExits: RoundTrip[];
}

function summarizeRoundTrips(roundTrips: RoundTrip[]): RoundTripSummary {
  const winners = roundTrips.filter((r) => r.realizedPnL > BREAK_EVEN_ABS_USD);
  const losers = roundTrips.filter((r) => r.realizedPnL < -BREAK_EVEN_ABS_USD);
  const evens = roundTrips.length - winners.length - losers.length;
  const totalRealizedPnL = roundTrips.reduce((s, r) => s + r.realizedPnL, 0);

  const withCf = roundTrips.filter((r) => r.sinceExitPct !== undefined);
  const avgSinceExitPct = withCf.length > 0 ? withCf.reduce((s, r) => s + (r.sinceExitPct ?? 0), 0) / withCf.length : 0;
  const withCapture = roundTrips.filter((r) => r.captureRatio !== undefined);
  const avgCaptureRatio = withCapture.length > 0
    ? withCapture.reduce((s, r) => s + (r.captureRatio ?? 0), 0) / withCapture.length
    : null;

  const bailedOnWinners = [...withCf]
    .filter((r) => (r.sinceExitPct ?? 0) > 10)
    .sort((a, b) => (b.sinceExitPct ?? 0) - (a.sinceExitPct ?? 0))
    .slice(0, 5);
  const wellTimedExits = [...withCf]
    .filter((r) => (r.sinceExitPct ?? 0) < -5)
    .sort((a, b) => (a.sinceExitPct ?? 0) - (b.sinceExitPct ?? 0))
    .slice(0, 5);

  return {
    totalRoundTrips: roundTrips.length,
    winners: winners.length,
    losers: losers.length,
    breakEvens: evens,
    totalRealizedPnL,
    avgRealizedPnL: roundTrips.length > 0 ? totalRealizedPnL / roundTrips.length : 0,
    avgHoldHours: roundTrips.length > 0 ? roundTrips.reduce((s, r) => s + r.holdHours, 0) / roundTrips.length : 0,
    tripsWithCounterfactual: withCf.length,
    avgSinceExitPct,
    avgCaptureRatio,
    bailedOnWinners,
    wellTimedExits,
  };
}

// ---------------------------------------------------------------------------
// Proposal synthesis — turn stats into concrete "try this" suggestions
// ---------------------------------------------------------------------------

interface Proposal {
  target: string;
  direction: 'reinforce' | 'weaken' | 'investigate' | 'hold';
  reason: string;
  evidence: { n: number; avgPnL: number; winRate: number };
}

function buildProposals(patternStats: PatternStats[], openPositions: OpenPositionAudit[], rtSummary?: RoundTripSummary): Proposal[] {
  const out: Proposal[] = [];

  for (const p of patternStats) {
    if (p.n < MIN_SAMPLES_TO_PROPOSE) continue;

    // Clear winners → reinforce
    if (p.avgPnL >= 2 && p.winRate >= 0.6) {
      out.push({
        target: p.label,
        direction: 'reinforce',
        reason: `Pattern "${p.label}" averaged +$${p.avgPnL.toFixed(2)} per trade across ${p.n} fires with ${(p.winRate * 100).toFixed(0)}% win rate. Consider relaxing gates that prevent this pattern from firing.`,
        evidence: { n: p.n, avgPnL: p.avgPnL, winRate: p.winRate },
      });
      continue;
    }

    // Clear losers → weaken
    if (p.avgPnL <= -0.5 || (p.losses >= 3 && p.winRate <= 0.4)) {
      out.push({
        target: p.label,
        direction: 'weaken',
        reason: `Pattern "${p.label}" averaged ${p.avgPnL.toFixed(2)} per trade across ${p.n} fires (win rate ${(p.winRate * 100).toFixed(0)}%). Tighten the trigger threshold or add a confluence gate.`,
        evidence: { n: p.n, avgPnL: p.avgPnL, winRate: p.winRate },
      });
      continue;
    }

    // Ambiguous but high-volume → investigate
    if (p.n >= 10 && Math.abs(p.avgPnL) < 0.5) {
      out.push({
        target: p.label,
        direction: 'investigate',
        reason: `Pattern "${p.label}" fired ${p.n} times with near-zero average P&L ($${p.avgPnL.toFixed(2)}). Either low-stakes noise or a split between winning/losing subcases — worth a deeper look.`,
        evidence: { n: p.n, avgPnL: p.avgPnL, winRate: p.winRate },
      });
    }
  }

  // Open-position flags — top 3 worst unrealized
  const worstOpen = [...openPositions].sort((a, b) => a.unrealizedPct - b.unrealizedPct).slice(0, 3);
  for (const pos of worstOpen) {
    if (pos.unrealizedPct <= -10) {
      out.push({
        target: `open_position/${pos.symbol}`,
        direction: 'investigate',
        reason: `${pos.symbol} is down ${pos.unrealizedPct.toFixed(1)}% on $${pos.totalInvested.toFixed(0)} invested. Review the entry reasoning — the exit rule should have fired by now if the thesis broke.`,
        evidence: { n: 1, avgPnL: pos.unrealizedPnL, winRate: 0 },
      });
    }
  }

  // v3: alpha-capture proposals from round-trip summary
  if (rtSummary && rtSummary.tripsWithCounterfactual >= 5) {
    if (rtSummary.avgCaptureRatio !== null && rtSummary.avgCaptureRatio < 0.3) {
      out.push({
        target: 'exit_timing/systemic_early_exits',
        direction: 'weaken',
        reason: `Across ${rtSummary.tripsWithCounterfactual} round-trips with counterfactual data, the bot captured only ${(rtSummary.avgCaptureRatio * 100).toFixed(0)}% of the available entry-to-current move on average. Exit rules (trailing-stop, stale-exit, dry-powder) are firing too eagerly. Widen the trailing-stop threshold and/or raise the stale-exit minimum-gain bar.`,
        evidence: { n: rtSummary.tripsWithCounterfactual, avgPnL: rtSummary.avgRealizedPnL, winRate: rtSummary.winners / Math.max(1, rtSummary.totalRoundTrips) },
      });
    }
    if (rtSummary.avgSinceExitPct > 5) {
      out.push({
        target: 'exit_timing/bail_pattern',
        direction: 'investigate',
        reason: `Sold tokens continued running +${rtSummary.avgSinceExitPct.toFixed(1)}% on average AFTER the bot exited (across ${rtSummary.tripsWithCounterfactual} round-trips). Indicates systemic premature exit — the bot is consistently bailing before the move plays out. Inspect individual bail-on-winners examples in the report below.`,
        evidence: { n: rtSummary.tripsWithCounterfactual, avgPnL: rtSummary.avgSinceExitPct, winRate: 0 },
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function renderMarkdown(ctx: {
  windowHours: number;
  trades: Trade[];
  sells: Trade[];
  buys: Trade[];
  failures: Trade[];
  patternStats: PatternStats[];
  openPositions: OpenPositionAudit[];
  proposals: Proposal[];
  portfolio: Portfolio | null;
  telemetry: ModelTelemetry | null;
  roundTrips: RoundTrip[];
  openBuys: OpenBuy[];
  roundTripSummary: RoundTripSummary;
}): string {
  const today = new Date().toISOString().slice(0, 10);
  const { windowHours, trades, sells, buys, failures, patternStats, openPositions, proposals, portfolio, telemetry, roundTrips, openBuys, roundTripSummary } = ctx;

  const totalRealized = sells.reduce((s, t) => s + pnl(t), 0);
  const winSells = sells.filter((t) => pnl(t) > BREAK_EVEN_ABS_USD);
  const lossSells = sells.filter((t) => pnl(t) < -BREAK_EVEN_ABS_USD);

  const top3Gainers = [...openPositions].slice(0, 3);
  const top3Bleeders = [...openPositions].sort((a, b) => a.unrealizedPct - b.unrealizedPct).slice(0, 3);

  const lines: string[] = [];

  lines.push(`# NVR-CRITIC Audit — ${today}`);
  lines.push('');
  lines.push(`**Window:** last ${windowHours}h (${trades.length} trades analyzed)`);
  if (portfolio) {
    // /api/portfolio returns drawdown as a percent already (e.g. 12.36 = 12.36%)
    lines.push(`**Portfolio:** $${(portfolio.totalValue ?? 0).toFixed(2)} | truePnL ${portfolio.truePnL !== undefined ? (portfolio.truePnL >= 0 ? '+' : '') + '$' + portfolio.truePnL.toFixed(2) : '—'} | drawdown ${portfolio.drawdown !== undefined ? portfolio.drawdown.toFixed(1) + '%' : '—'}`);
  }
  if (telemetry) {
    lines.push(`**Routing:** tier=${telemetry.currentTier} | gemmaMode=${telemetry.gemmaMode} | cost ~$${(telemetry.estimatedDailyCostUSD ?? 0).toFixed(2)}/day | cache hit ${(telemetry.cacheHitRate ?? 0).toFixed(1)}%`);
  }
  lines.push('');
  lines.push('> CRITIC proposes. Henry merges. Nothing auto-applies.');
  lines.push('');

  // ───── Headline ─────
  lines.push('## Headline');
  lines.push('');
  lines.push(`- **${sells.length} SELLs** (${winSells.length}W / ${lossSells.length}L / ${sells.length - winSells.length - lossSells.length}BE) · total realized: ${totalRealized >= 0 ? '+' : ''}$${totalRealized.toFixed(2)}`);
  lines.push(`- **${buys.length} BUYs** · ${failures.length} failed executions`);
  lines.push(`- **${openPositions.length} open positions**, total unrealized: ${openPositions.reduce((s, p) => s + p.unrealizedPnL, 0) >= 0 ? '+' : ''}$${openPositions.reduce((s, p) => s + p.unrealizedPnL, 0).toFixed(2)}`);
  if (failures.length > 0) {
    const firstFailure = failures[0]!;
    lines.push(`  - Latest failure: ${firstFailure.fromToken} → ${firstFailure.toToken} ${firstFailure.amountUSD.toFixed(2)} at ${firstFailure.timestamp.slice(0, 16)}`);
  }
  lines.push('');

  // ───── SELL pattern table ─────
  lines.push('## SELL Outcomes by Pattern');
  lines.push('');
  if (patternStats.length === 0) {
    lines.push('_No SELLs in window._');
  } else {
    lines.push('| Pattern | n | W / L / BE | avg $ | win rate | note |');
    lines.push('|---|---:|---:|---:|---:|---|');
    for (const p of patternStats) {
      lines.push(
        `| \`${p.label}\` | ${p.n} | ${p.wins}/${p.losses}/${p.evens} | ${p.avgPnL >= 0 ? '+' : ''}$${p.avgPnL.toFixed(2)} | ${(p.winRate * 100).toFixed(0)}% | ${p.note ?? ''} |`,
      );
    }
    lines.push('');

    lines.push('### Example trades (strongest-magnitude per pattern)');
    lines.push('');
    for (const p of patternStats) {
      if (p.examples.length === 0) continue;
      lines.push(`**\`${p.label}\`:**`);
      lines.push('');
      for (const ex of p.examples) lines.push(ex);
      lines.push('');
    }
  }

  // ───── v3: Round-trip alpha-capture audit ─────
  lines.push('## Alpha-Capture Audit (BUY → SELL round-trips)');
  lines.push('');
  if (roundTrips.length === 0) {
    lines.push('_No paired BUY→SELL round-trips in window. All entries from this period are still open._');
  } else {
    const s = roundTripSummary;
    lines.push(`**${s.totalRoundTrips} round-trips closed in window** · ${s.winners}W / ${s.losers}L / ${s.breakEvens}BE · total realized ${s.totalRealizedPnL >= 0 ? '+' : ''}$${s.totalRealizedPnL.toFixed(2)}`);
    lines.push(`**Avg hold:** ${s.avgHoldHours.toFixed(1)}h · **Avg realized per round-trip:** ${s.avgRealizedPnL >= 0 ? '+' : ''}$${s.avgRealizedPnL.toFixed(2)}`);
    if (s.tripsWithCounterfactual > 0) {
      lines.push('');
      lines.push(`### Alpha-capture score (${s.tripsWithCounterfactual}/${s.totalRoundTrips} round-trips with current-price data)`);
      lines.push('');
      if (s.avgCaptureRatio !== null) {
        const capturePct = (s.avgCaptureRatio * 100).toFixed(0);
        const capSignal = s.avgCaptureRatio >= 0.6 ? '✅' : s.avgCaptureRatio >= 0.3 ? '🟡' : '🚨';
        lines.push(`- **${capSignal} Avg capture ratio: ${capturePct}%** — of the entry-to-current-price move available on each trade, the bot realized ${capturePct}% on average.`);
      }
      lines.push(`- **Avg since-exit move: ${s.avgSinceExitPct >= 0 ? '+' : ''}${s.avgSinceExitPct.toFixed(1)}%** — ${s.avgSinceExitPct > 5 ? 'bot is systematically bailing on winners' : s.avgSinceExitPct < -3 ? 'bot is consistently exiting ahead of downside' : 'neutral post-exit drift'}.`);
    } else {
      lines.push('');
      lines.push(`_(Counterfactual prices unresolved — DexScreener returned nothing for the sold tokens or symbols aren't in TOKEN_REGISTRY.)_`);
    }
    lines.push('');

    if (s.bailedOnWinners.length > 0) {
      lines.push('### 🚨 Bailed on winners (sold, then token ran)');
      lines.push('');
      lines.push('| token | hold | exit $/tok | now $/tok | since exit | realized | entry reasoning |');
      lines.push('|---|---:|---:|---:|---:|---:|---|');
      for (const r of s.bailedOnWinners) {
        const exit = r.exitPriceUSD ?? 0;
        const now = r.currentPriceUSD ?? 0;
        const since = r.sinceExitPct ?? 0;
        lines.push(
          `| ${r.token} | ${r.holdHours.toFixed(1)}h | $${exit.toPrecision(4)} | $${now.toPrecision(4)} | **+${since.toFixed(1)}%** | ${r.realizedPnL >= 0 ? '+' : ''}$${r.realizedPnL.toFixed(2)} | ${r.buyReasoning.slice(0, 60).replace(/\s+/g, ' ')} |`,
        );
      }
      lines.push('');
    }

    if (s.wellTimedExits.length > 0) {
      lines.push('### ✅ Well-timed exits (sold, then token fell)');
      lines.push('');
      lines.push('| token | hold | exit $/tok | now $/tok | since exit | realized | exit reasoning |');
      lines.push('|---|---:|---:|---:|---:|---:|---|');
      for (const r of s.wellTimedExits) {
        const exit = r.exitPriceUSD ?? 0;
        const now = r.currentPriceUSD ?? 0;
        const since = r.sinceExitPct ?? 0;
        lines.push(
          `| ${r.token} | ${r.holdHours.toFixed(1)}h | $${exit.toPrecision(4)} | $${now.toPrecision(4)} | **${since.toFixed(1)}%** | ${r.realizedPnL >= 0 ? '+' : ''}$${r.realizedPnL.toFixed(2)} | ${r.sellReasoning.slice(0, 60).replace(/\s+/g, ' ')} |`,
        );
      }
      lines.push('');
    }

    // Top winners + losers (by realized $) regardless of counterfactual
    const sortedByRealized = [...roundTrips].sort((a, b) => b.realizedPnL - a.realizedPnL);
    const topWinners = sortedByRealized.slice(0, 3);
    const topLosers = [...roundTrips].sort((a, b) => a.realizedPnL - b.realizedPnL).slice(0, 3);

    if (topWinners.length > 0 && topWinners[0]!.realizedPnL > BREAK_EVEN_ABS_USD) {
      lines.push('### Top realized winners');
      lines.push('');
      for (const r of topWinners) {
        if (r.realizedPnL <= BREAK_EVEN_ABS_USD) break;
        lines.push(`- **${r.token}** +$${r.realizedPnL.toFixed(2)} (${r.realizedPct >= 0 ? '+' : ''}${r.realizedPct.toFixed(1)}%) · held ${r.holdHours.toFixed(1)}h`);
        lines.push(`  - Entry: ${r.buyReasoning.slice(0, 140).replace(/\s+/g, ' ')}`);
        lines.push(`  - Exit: ${r.sellReasoning.slice(0, 140).replace(/\s+/g, ' ')}`);
      }
      lines.push('');
    }
    if (topLosers.length > 0 && topLosers[0]!.realizedPnL < -BREAK_EVEN_ABS_USD) {
      lines.push('### Top realized losers');
      lines.push('');
      for (const r of topLosers) {
        if (r.realizedPnL >= -BREAK_EVEN_ABS_USD) break;
        lines.push(`- **${r.token}** $${r.realizedPnL.toFixed(2)} (${r.realizedPct.toFixed(1)}%) · held ${r.holdHours.toFixed(1)}h`);
        lines.push(`  - Entry: ${r.buyReasoning.slice(0, 140).replace(/\s+/g, ' ')}`);
        lines.push(`  - Exit: ${r.sellReasoning.slice(0, 140).replace(/\s+/g, ' ')}`);
      }
      lines.push('');
    }
  }

  // ───── v3: Open BUYs (still holding — the "potential winners in flight") ─────
  if (openBuys.length > 0) {
    lines.push('## Open BUYs (entries still held — potential winners in flight)');
    lines.push('');
    const sortedOpen = [...openBuys].sort((a, b) => b.unrealizedPnL - a.unrealizedPnL);
    lines.push(`_${openBuys.length} BUY entries haven't triggered a SELL yet. Total unrealized across these positions: ${openBuys.reduce((s, o) => s + o.unrealizedPnL, 0) >= 0 ? '+' : ''}$${openBuys.reduce((s, o) => s + o.unrealizedPnL, 0).toFixed(2)}._`);
    lines.push('');
    const topOpen = sortedOpen.slice(0, 5);
    const bottomOpen = [...sortedOpen].reverse().slice(0, 5);
    lines.push('**Top 5 unrealized gainers (if these are real, the bot picked winners — watch the exit):**');
    for (const o of topOpen) {
      lines.push(`- **${o.token}** ${o.unrealizedPnL >= 0 ? '+' : ''}$${o.unrealizedPnL.toFixed(2)} (${o.unrealizedPct >= 0 ? '+' : ''}${o.unrealizedPct.toFixed(1)}%) · bought ${o.holdHours.toFixed(1)}h ago for $${o.buyAmountUSD.toFixed(2)}`);
      lines.push(`  - Entry reason: ${o.buyReasoning.slice(0, 140).replace(/\s+/g, ' ')}`);
    }
    lines.push('');
    lines.push('**Bottom 5 unrealized bleeders (these entries were wrong):**');
    for (const o of bottomOpen) {
      lines.push(`- **${o.token}** ${o.unrealizedPnL >= 0 ? '+' : ''}$${o.unrealizedPnL.toFixed(2)} (${o.unrealizedPct >= 0 ? '+' : ''}${o.unrealizedPct.toFixed(1)}%) · bought ${o.holdHours.toFixed(1)}h ago for $${o.buyAmountUSD.toFixed(2)}`);
      lines.push(`  - Entry reason: ${o.buyReasoning.slice(0, 140).replace(/\s+/g, ' ')}`);
    }
    lines.push('');
  }

  // ───── Open positions (per-token current snapshot — different lens than open BUYs above) ─────
  lines.push('## Open Positions');
  lines.push('');
  if (openPositions.length === 0) {
    lines.push('_All USDC._');
  } else {
    lines.push('**Gainers (top 3):**');
    for (const p of top3Gainers) {
      lines.push(`- ${p.symbol}: $${p.usdValue.toFixed(2)} · unrealized ${p.unrealizedPnL >= 0 ? '+' : ''}$${p.unrealizedPnL.toFixed(2)} (${p.unrealizedPct >= 0 ? '+' : ''}${p.unrealizedPct.toFixed(1)}% on $${p.totalInvested.toFixed(0)} invested)`);
    }
    lines.push('');
    lines.push('**Bleeders (worst 3):**');
    for (const p of top3Bleeders) {
      lines.push(`- ${p.symbol}: $${p.usdValue.toFixed(2)} · unrealized ${p.unrealizedPnL >= 0 ? '+' : ''}$${p.unrealizedPnL.toFixed(2)} (${p.unrealizedPct >= 0 ? '+' : ''}${p.unrealizedPct.toFixed(1)}% on $${p.totalInvested.toFixed(0)} invested)`);
    }
    lines.push('');
  }

  // ───── Proposals ─────
  lines.push('## Proposed Changes');
  lines.push('');
  if (proposals.length === 0) {
    lines.push('_No patterns met proposal threshold (n ≥ ' + MIN_SAMPLES_TO_PROPOSE + ')._');
  } else {
    for (const p of proposals) {
      const icon = p.direction === 'reinforce' ? '✅' : p.direction === 'weaken' ? '⚠️' : p.direction === 'investigate' ? '🔍' : '—';
      lines.push(`### ${icon} ${p.direction.toUpperCase()} — \`${p.target}\``);
      lines.push('');
      lines.push(p.reason);
      lines.push('');
      lines.push(`_Evidence: n=${p.evidence.n} · avg $${p.evidence.avgPnL.toFixed(2)} · win rate ${(p.evidence.winRate * 100).toFixed(0)}%_`);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(`_Generated by \`scripts/critic.ts\` at ${new Date().toISOString()} against \`${BOT_URL}\`._`);
  lines.push(`_Window: ${windowHours}h · sample: ${trades.length} trades · pattern min-sample: ${MIN_SAMPLES_TO_PROPOSE}_`);
  lines.push('');

  return lines.join('\n');
}

function renderYaml(proposals: Proposal[]): string {
  const header = [
    '# NVR-CRITIC — Rules Proposal (trade-outcome pass)',
    `# Generated: ${new Date().toISOString()}`,
    '# ',
    '# CRITIC never auto-applies. Henry reviews, picks 1-2 changes, merges by hand.',
    '',
    'proposals:',
  ];
  if (proposals.length === 0) {
    return [...header, '  []  # nothing meets threshold this window', ''].join('\n');
  }
  const body = proposals.map((p) =>
    [
      `  - target: ${p.target}`,
      `    direction: ${p.direction}`,
      `    reason: >-`,
      `      ${p.reason}`,
      `    evidence:`,
      `      samples: ${p.evidence.n}`,
      `      avgPnL: ${p.evidence.avgPnL.toFixed(3)}`,
      `      winRate: ${p.evidence.winRate.toFixed(3)}`,
    ].join('\n'),
  );
  return [...header, ...body, ''].join('\n');
}

/**
 * Compact, prompt-ready CRITIC memory — the bot injects this into heavy-cycle
 * Sonnet prompts. Target ~500–800 tokens. Structured as discrete findings with
 * specific numbers so the LLM can reason over them, not just echo them.
 */
function renderCriticMemory(ctx: {
  windowHours: number;
  patternStats: PatternStats[];
  roundTripSummary: RoundTripSummary;
  portfolio: Portfolio | null;
}): string {
  const { windowHours, patternStats, roundTripSummary: s, portfolio } = ctx;
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push('═══ CRITIC MEMORY — Your Recent Pattern Outcomes ═══');
  lines.push(`(audit window: last ${windowHours}h · generated ${today})`);
  lines.push('');
  if (portfolio) {
    lines.push(`Portfolio context: $${(portfolio.totalValue ?? 0).toFixed(0)} · truePnL ${portfolio.truePnL !== undefined ? (portfolio.truePnL >= 0 ? '+' : '') + '$' + portfolio.truePnL.toFixed(0) : '—'} · drawdown ${portfolio.drawdown !== undefined ? portfolio.drawdown.toFixed(1) + '%' : '—'}`);
    lines.push('');
  }

  // Round-trip capture story — the headline finding
  if (s.totalRoundTrips > 0) {
    lines.push(`CLOSED ROUND-TRIPS: ${s.totalRoundTrips} (${s.winners}W / ${s.losers}L / ${s.breakEvens}BE) · total realized ${s.totalRealizedPnL >= 0 ? '+' : ''}$${s.totalRealizedPnL.toFixed(2)} · avg hold ${s.avgHoldHours.toFixed(1)}h`);
    if (s.tripsWithCounterfactual > 0 && s.avgCaptureRatio !== null) {
      const pct = (s.avgCaptureRatio * 100).toFixed(0);
      lines.push(`ALPHA CAPTURE RATIO: ${pct}% — of each entry→current move available, you realized ${pct}% on average. ${s.avgCaptureRatio < 0 ? 'Negative = you exit LOSING POSITIONS that subsequently run.' : s.avgCaptureRatio < 0.3 ? 'Below 30% means systematic early exits.' : ''}`);
      lines.push(`POST-EXIT DRIFT: sold tokens moved ${s.avgSinceExitPct >= 0 ? '+' : ''}${s.avgSinceExitPct.toFixed(1)}% on average after you sold. ${s.avgSinceExitPct > 5 ? '⚠️ You are bailing on winners.' : s.avgSinceExitPct < -3 ? 'Good — exits generally preceded downside.' : ''}`);
    }
    lines.push('');
  }

  // Bailed-on-winners — concrete examples
  if (s.bailedOnWinners.length > 0) {
    lines.push('RECENT BAILED-ON WINNERS (you sold, token ran):');
    for (const r of s.bailedOnWinners.slice(0, 4)) {
      const since = r.sinceExitPct ?? 0;
      lines.push(`  · ${r.token}: sold ${r.holdHours.toFixed(1)}h after entry for ${r.realizedPnL >= 0 ? '+' : ''}$${r.realizedPnL.toFixed(0)}, now +${since.toFixed(0)}% since exit. Entry was: ${r.buyReasoning.slice(0, 90).replace(/\s+/g, ' ')}`);
    }
    lines.push('');
  }

  // Pattern table — compressed to just the pattern + num + avg $ + win rate
  const topFailing = [...patternStats]
    .filter((p) => p.n >= 3 && p.avgPnL < 0)
    .sort((a, b) => a.avgPnL - b.avgPnL)
    .slice(0, 4);
  if (topFailing.length > 0) {
    lines.push('PATTERNS YOUR DECISIONS CURRENTLY PRODUCE LOSSES ON:');
    for (const p of topFailing) {
      lines.push(`  · ${p.label}: ${p.n} fires, ${(p.winRate * 100).toFixed(0)}% win rate, avg ${p.avgPnL >= 0 ? '+' : ''}$${p.avgPnL.toFixed(2)}/trade${p.note ? ' — ' + p.note : ''}`);
    }
    lines.push('');
  }

  const topWorking = [...patternStats]
    .filter((p) => p.n >= 3 && p.avgPnL > 1)
    .sort((a, b) => b.avgPnL - a.avgPnL)
    .slice(0, 3);
  if (topWorking.length > 0) {
    lines.push('PATTERNS YOUR DECISIONS CURRENTLY PRODUCE WINS ON:');
    for (const p of topWorking) {
      lines.push(`  · ${p.label}: ${p.n} fires, ${(p.winRate * 100).toFixed(0)}% win rate, avg +$${p.avgPnL.toFixed(2)}/trade`);
    }
    lines.push('');
  }

  lines.push('HOW TO USE THIS MEMORY:');
  lines.push('Do not mechanically avoid a pattern just because it has been failing. Instead, when');
  lines.push('you\'re about to make a decision that matches a failing pattern here, ask yourself:');
  lines.push('"Is THIS case materially different from the prior fires?" If yes, name why in your');
  lines.push('reasoning. If you can\'t articulate a difference, reconsider. The goal is informed');
  lines.push('decisions — not rules that fire around you.');
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

interface TradesResponse {
  totalTrades?: number;
  trades?: Trade[];
}

interface BalancesResponse {
  balances?: Balance[];
}

async function main(): Promise<void> {
  ensureDir(DATA_DIR);
  ensureDir(REPORTS_DIR);

  console.log(`[CRITIC] Auditing ${BOT_URL} over last ${WINDOW_HOURS}h`);

  const [tradesRaw, balancesRaw, portfolio, telemetry] = await Promise.all([
    fetchJSON<TradesResponse>(`${BOT_URL}/api/trades?limit=500&include_failures=true`),
    fetchJSON<BalancesResponse>(`${BOT_URL}/api/balances`),
    fetchJSON<Portfolio>(`${BOT_URL}/api/portfolio`),
    fetchJSON<ModelTelemetry>(`${BOT_URL}/api/model-telemetry`),
  ]);

  const allTrades: Trade[] = tradesRaw?.trades ?? [];
  const balances: Balance[] = balancesRaw?.balances ?? [];

  const cutoff = Date.now() - WINDOW_HOURS * 60 * 60 * 1000;
  const trades = allTrades.filter((t) => new Date(t.timestamp).getTime() >= cutoff);
  const sells = trades.filter((t) => t.action === 'SELL' && t.success);
  const buys = trades.filter((t) => t.action === 'BUY' && t.success);
  const failures = trades.filter((t) => !t.success);

  console.log(`[CRITIC] Fetched ${allTrades.length} trades total; ${trades.length} in window (${sells.length} successful SELLs, ${buys.length} successful BUYs, ${failures.length} failures).`);

  const patternStats = buildPatternStats(sells);
  const openPositions = auditOpenPositions(balances);

  // v3: round-trip analysis + counterfactual
  const { roundTrips, openBuys } = buildRoundTrips(trades, balances);
  console.log(`[CRITIC] Round-trip ledger: ${roundTrips.length} paired BUY→SELL, ${openBuys.length} open BUYs (still holding).`);

  // Fetch current spot prices for tokens we've sold — counterfactual comes from here
  const soldSymbols = roundTrips.map((r) => r.token);
  const currentPrices = soldSymbols.length > 0 ? await fetchCurrentPricesForSymbols(soldSymbols) : new Map<string, number>();
  console.log(`[CRITIC] Resolved current prices for ${currentPrices.size}/${new Set(soldSymbols).size} distinct sold tokens.`);
  annotateWithCounterfactual(roundTrips, currentPrices);
  const roundTripSummary = summarizeRoundTrips(roundTrips);

  const proposals = buildProposals(patternStats, openPositions, roundTripSummary);

  const today = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(REPORTS_DIR, `${today}.md`);
  const markdown = renderMarkdown({ windowHours: WINDOW_HOURS, trades, sells, buys, failures, patternStats, openPositions, proposals, portfolio, telemetry, roundTrips, openBuys, roundTripSummary });
  fs.writeFileSync(reportPath, markdown, 'utf8');

  const yaml = renderYaml(proposals);
  fs.writeFileSync(RULES_PROPOSAL_PATH, yaml, 'utf8');

  // v21.24: prompt-ready memory the bot reads at cycle start
  const memory = renderCriticMemory({ windowHours: WINDOW_HOURS, patternStats, roundTripSummary, portfolio });
  fs.writeFileSync(MEMORY_PATH, memory, 'utf8');

  console.log(`[CRITIC] ✓ Wrote audit to ${reportPath}`);
  console.log(`[CRITIC] ✓ Wrote ${proposals.length} proposal(s) to ${RULES_PROPOSAL_PATH}`);
  console.log(`[CRITIC] ✓ Wrote prompt-memory (${memory.length} chars) to ${MEMORY_PATH}`);
  if (proposals.length > 0) {
    const reinforceCount = proposals.filter((p) => p.direction === 'reinforce').length;
    const weakenCount = proposals.filter((p) => p.direction === 'weaken').length;
    const investigateCount = proposals.filter((p) => p.direction === 'investigate').length;
    console.log(`[CRITIC]   → ${reinforceCount} reinforce · ${weakenCount} weaken · ${investigateCount} investigate`);
  }
}

main().catch((err) => {
  console.error('[CRITIC] Failed:', err);
  process.exit(1);
});
