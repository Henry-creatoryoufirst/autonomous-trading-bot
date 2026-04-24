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

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATA_DIR = path.resolve(process.cwd(), 'data');
const REPORTS_DIR = path.join(DATA_DIR, 'critic-reports');
const RULES_PROPOSAL_PATH = path.join(DATA_DIR, 'rules-proposal.yaml');

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
// Proposal synthesis — turn stats into concrete "try this" suggestions
// ---------------------------------------------------------------------------

interface Proposal {
  target: string;
  direction: 'reinforce' | 'weaken' | 'investigate' | 'hold';
  reason: string;
  evidence: { n: number; avgPnL: number; winRate: number };
}

function buildProposals(patternStats: PatternStats[], openPositions: OpenPositionAudit[]): Proposal[] {
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
}): string {
  const today = new Date().toISOString().slice(0, 10);
  const { windowHours, trades, sells, buys, failures, patternStats, openPositions, proposals, portfolio, telemetry } = ctx;

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

  // ───── Open positions ─────
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
  const proposals = buildProposals(patternStats, openPositions);

  const today = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(REPORTS_DIR, `${today}.md`);
  const markdown = renderMarkdown({ windowHours: WINDOW_HOURS, trades, sells, buys, failures, patternStats, openPositions, proposals, portfolio, telemetry });
  fs.writeFileSync(reportPath, markdown, 'utf8');

  const yaml = renderYaml(proposals);
  fs.writeFileSync(RULES_PROPOSAL_PATH, yaml, 'utf8');

  console.log(`[CRITIC] ✓ Wrote audit to ${reportPath}`);
  console.log(`[CRITIC] ✓ Wrote ${proposals.length} proposal(s) to ${RULES_PROPOSAL_PATH}`);
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
