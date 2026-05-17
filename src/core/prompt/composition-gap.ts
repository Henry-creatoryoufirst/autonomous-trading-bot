/**
 * Composition gap + mission framing — heavy-cycle prompt block.
 *
 * Why this block exists (2026-05-17): the COHORT PHYSICS block (PR #15-#16)
 * fixed the LLM's market-signal reading — every cycle now correctly cites
 * dispersion, leader, laggard. But trades still didn't fire. Investigation
 * showed the gap wasn't cognition, it was COMPOSITION: bot holds 77% WETH
 * and 0% cbBTC against an Option B benchmark target of 60% cbBTC + 40% WETH.
 * Any tactical timing on top of that off-shape portfolio is dominated by
 * the directional ETH-vs-BTC bet rather than the strategy's actual signal.
 *
 * The fix is the same pattern as every successful audit ship: surface the
 * structural truth, force the LLM to either close the gap or articulate
 * why the deviation is a deliberate conviction-based bet. Plus a mission
 * frame: port-value growth is the precondition for harvest sustainability;
 * harvests that come from a shrinking base destroy the thesis. Both goals
 * have to be running at once — that's the bot's actual job description.
 *
 * Inputs:
 *   - holdings: bot's actual position list with $ value and % of portfolio
 *   - totalPortfolioValue: state.trading.totalPortfolioValue
 *   - usdcBalance: raw wallet USDC (truth)
 *   - benchmark target: { cbBTC: 0.60, WETH: 0.40 } (Option B literal)
 *   - usdcReserveTarget: 0.25 (Henry's hard rule — the one hardcoded line)
 *   - mission context: total harvested, initial deposits, port-vs-initial delta
 */

export interface PositionRow {
  symbol: string;
  usdValue: number;
}

export interface CompositionMissionContext {
  totalPortfolioValue: number;
  usdcWalletBalance: number;
  totalHarvestedUsd: number;
  /** state.totalDeposited - state.onChainWithdrawn (net capital in). */
  netCapitalInUsd: number;
}

/** Option B benchmark target weights (60% cbBTC / 40% WETH). */
export const OPTION_B_BENCHMARK_TARGET: ReadonlyMap<string, number> = new Map([
  ['cbBTC', 0.60],
  ['WETH', 0.40],
]);

/** Henry's hard rule — the one hardcoded composition line. */
export const USDC_RESERVE_TARGET = 0.25;

function fmtPct(decimal: number, digits = 1): string {
  if (!Number.isFinite(decimal)) return '—';
  const pct = decimal * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(digits)}%`;
}

function fmtPctPlain(decimal: number, digits = 1): string {
  if (!Number.isFinite(decimal)) return '—';
  return `${(decimal * 100).toFixed(digits)}%`;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '$—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1000) return `${sign}$${abs.toFixed(0)}`;
  return `${sign}$${abs.toFixed(2)}`;
}

/**
 * Format the composition gap + mission block for prompt injection.
 * Pure — no I/O. WETH/ETH are treated as the same "ETH zone" exposure for
 * benchmark comparison purposes (the spot leg is what's tracked, not the
 * specific wrapped form).
 */
export function formatCompositionGapBlock(
  positions: ReadonlyArray<PositionRow>,
  ctx: CompositionMissionContext,
): string {
  const total = ctx.totalPortfolioValue;
  if (!Number.isFinite(total) || total <= 0) {
    return [
      '═══ COMPOSITION GAP & MISSION (read this after PORTFOLIO) ═══',
      'Composition data unavailable — totalPortfolioValue not loaded yet.',
    ].join('\n');
  }

  // Aggregate by zone: cbBTC zone (cbBTC only), WETH zone (WETH + ETH), USDC zone.
  let cbBtcUsd = 0;
  let wethZoneUsd = 0;
  let usdcUsd = ctx.usdcWalletBalance;
  let otherCohortUsd = 0;
  let nonCohortUsd = 0;
  const otherCohortSymbols = new Set(['cbXRP', 'cbLTC', 'LINK', 'cbADA', 'cbSOL']);
  for (const p of positions) {
    const symUpper = p.symbol.toUpperCase();
    if (symUpper === 'USDC') {
      // skip — USDC counted from wallet balance above
      continue;
    }
    if (symUpper === 'CBBTC') {
      cbBtcUsd += p.usdValue;
    } else if (symUpper === 'WETH' || symUpper === 'ETH') {
      wethZoneUsd += p.usdValue;
    } else if (otherCohortSymbols.has(p.symbol) || Array.from(otherCohortSymbols).some(s => s.toUpperCase() === symUpper)) {
      otherCohortUsd += p.usdValue;
    } else {
      nonCohortUsd += p.usdValue;
    }
  }

  const cbBtcPct = cbBtcUsd / total;
  const wethPct = wethZoneUsd / total;
  const usdcPct = usdcUsd / total;
  const otherCohortPct = otherCohortUsd / total;
  const nonCohortPct = nonCohortUsd / total;

  const cbBtcTarget = OPTION_B_BENCHMARK_TARGET.get('cbBTC') ?? 0.60;
  const wethTarget = OPTION_B_BENCHMARK_TARGET.get('WETH') ?? 0.40;

  const cbBtcGap = cbBtcPct - cbBtcTarget;
  const wethGap = wethPct - wethTarget;
  const usdcGap = usdcPct - USDC_RESERVE_TARGET;

  // Mission math: harvested vs port-vs-initial delta. The thesis only works
  // when port grows faster than the harvest rate.
  const portVsInitial = total - ctx.netCapitalInUsd;
  const netValueCreated = portVsInitial + ctx.totalHarvestedUsd; // total return ever
  const harvestSustainable = portVsInitial >= 0; // port at or above initial = harvest came from growth

  const lines: string[] = [];
  lines.push('═══ COMPOSITION GAP & MISSION (the structural alpha picture) ═══');
  lines.push('');
  lines.push('MISSION — Two goals running at once:');
  lines.push('  1. GROW port value over the Option B 30-day window');
  lines.push('  2. Fund passive harvests FROM that growth, not from the base');
  lines.push(`The harvest math only works when port grows FASTER than harvest rate.`);
  lines.push(`  Net capital in: ${fmtUsd(ctx.netCapitalInUsd)}  ·  Current port: ${fmtUsd(total)}  ·  Harvested to date: ${fmtUsd(ctx.totalHarvestedUsd)}`);
  lines.push(`  Port vs initial: ${fmtUsd(portVsInitial)} (${harvestSustainable ? 'sustainable — harvest came from growth' : 'NOT sustainable — harvest is eating into the base'})`);
  lines.push(`  Net value created (port + harvested − initial): ${fmtUsd(netValueCreated)}`);
  lines.push('');
  lines.push('COMPOSITION vs Option B benchmark (60% cbBTC + 40% WETH):');
  lines.push(`  cbBTC · held ${fmtPctPlain(cbBtcPct)} / target ${fmtPctPlain(cbBtcTarget)} / GAP ${fmtPct(cbBtcGap)}${Math.abs(cbBtcGap) >= 0.30 ? ' ← LARGE structural drag' : ''}`);
  lines.push(`  WETH  · held ${fmtPctPlain(wethPct)} / target ${fmtPctPlain(wethTarget)} / GAP ${fmtPct(wethGap)}${Math.abs(wethGap) >= 0.30 ? ' ← LARGE structural drag' : ''}`);
  lines.push(`  USDC  · held ${fmtPctPlain(usdcPct)} / hard rule ${fmtPctPlain(USDC_RESERVE_TARGET)} reserve / GAP ${fmtPct(usdcGap)}`);
  if (otherCohortPct >= 0.01) {
    lines.push(`  Other cohort (cbXRP/cbLTC/LINK/cbADA/cbSOL) · held ${fmtPctPlain(otherCohortPct)} (tradeable, off-benchmark — diversification only)`);
  }
  if (nonCohortPct >= 0.01) {
    lines.push(`  Non-cohort dust · held ${fmtPctPlain(nonCohortPct)} (pre-pivot leftover — candidate for liquidation)`);
  }
  lines.push('');
  lines.push(`INTERPRETATION — composition drift from benchmark is the LARGEST source of daily alpha variance, larger than any single tactical timing decision. A bot off-shape from its benchmark measures the directional bet (ETH-vs-BTC), not the strategy's actual edge. To capture tactical-timing alpha cleanly, the composition must be in the same neighborhood as the benchmark.`);
  lines.push('');
  lines.push(`ACTION FRAME — if you HOLD, you must explicitly justify the deviation as a deliberate conviction bet (e.g., "I have specific conviction that ETH outperforms BTC over the next 30 days because..."). If you cannot justify it, propose composition-closing trades:`);
  lines.push(`  • Selling WETH at unrealized gain is a LEGITIMATE strategic move when composition discipline demands it. Winners can be trimmed.`);
  lines.push(`  • Freed USDC must redeploy intelligently into the largest gap (cbBTC) and/or other cohort tokens with conviction signals. Do NOT let freed USDC sit dead — dead cash destroys port growth and the harvest rationale together.`);
  lines.push(`  • Non-cohort dust (ENA, cbDOGE, FAI, etc.) is a candidate for liquidation — it bleeds attention without contributing to the strategy.`);
  lines.push('');
  lines.push('THE EDGE — what only an AI can do at this granularity: real-time per-cycle composition tracking + dispersion reading + conviction synthesis across the 7-quality cohort, integrated into a single decision every 15 minutes. A human cannot maintain this at 24/7 fidelity. That is your job.');

  return lines.join('\n');
}
