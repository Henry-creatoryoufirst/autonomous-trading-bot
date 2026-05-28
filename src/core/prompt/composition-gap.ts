/**
 * Deployment posture + mission framing — heavy-cycle prompt block.
 *
 * 2026-05-28 REWRITE — "yardstick, not target" (Henry's ratification).
 *
 * History: the prior version (2026-05-17) hardcoded the Option B benchmark
 * (60% cbBTC / 40% WETH) as a HOLDINGS TARGET and told the LLM to "close the
 * cbBTC −60pp gap" every cycle. That created a dead-cash ratchet that bled the
 * portfolio for ~13 days:
 *
 *   1. Frame says "cbBTC held 0% vs 60% target — LARGE structural drag; trim
 *      WETH to fund the gap; freed USDC must redeploy into cbBTC."
 *   2. LLM dutifully SELLS WETH (deep liquidity, usually at a gain — always
 *      available).
 *   3. The cbBTC BUY never fires — cbBTC is a Coinbase-wrapped asset with thin
 *      Base-DEX liquidity (same class as cbLTC, already HOLD_ONLY). It has
 *      filled at size ZERO times in the bot's history. In risk-off cycles the
 *      LLM also (correctly) won't catch the falling knife.
 *   4. Net: WETH → USDC every cycle, cbBTC never accumulates, cash ratchets up
 *      to 61% while the frame KEEPS calling WETH "overweight" and demanding
 *      more cash. The bot's real problem — being massively UNDER-deployed vs
 *      its own 25% reserve rule — was invisible because the frame pointed the
 *      opposite way.
 *
 * The fix (this file): the 60/40 cbBTC/WETH benchmark is a YARDSTICK we measure
 * alpha against — NOT a shopping list we must replicate. On Base, you beat that
 * return with assets that actually fill (WETH-led), not by forcing a weight in
 * a token that doesn't trade. The dominant directive becomes CAPITAL
 * DEPLOYMENT: when USDC is above the 25% reserve, deploy it; never raise cash
 * above reserve by trimming a liquid hold (that's the ratchet, and it's banned
 * here). cbBTC stays an opportunistic add when liquidity + conviction align.
 *
 * Inputs:
 *   - holdings: bot's actual position list with $ value
 *   - mission context: total harvested, net capital in, port-vs-initial delta
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

/**
 * Option B benchmark reference weights (60% BTC / 40% ETH). These describe the
 * YARDSTICK the bot's return is judged against — NOT a holdings target. The bot
 * is free to hold any Base-liquid mix that beats this blend's return.
 */
export const OPTION_B_BENCHMARK_REFERENCE: ReadonlyMap<string, number> = new Map([
  ['cbBTC', 0.60],
  ['WETH', 0.40],
]);

/** Henry's hard rule — the one hardcoded composition line. */
export const USDC_RESERVE_TARGET = 0.25;

/**
 * How far above the 25% reserve counts as "meaningfully under-deployed" and
 * flips the prompt into DEPLOY-NOW mode. 8pp of slack absorbs normal
 * post-trade cash + pending-fee accrual without nagging.
 */
const OVER_RESERVE_DEPLOY_THRESHOLD = 0.08;

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
 * Format the deployment-posture + mission block for prompt injection. Pure —
 * no I/O. WETH/ETH are treated as the same "ETH zone" exposure.
 */
export function formatCompositionGapBlock(
  positions: ReadonlyArray<PositionRow>,
  ctx: CompositionMissionContext,
): string {
  const total = ctx.totalPortfolioValue;
  if (!Number.isFinite(total) || total <= 0) {
    return [
      '═══ DEPLOYMENT POSTURE & MISSION (read this after PORTFOLIO) ═══',
      'Composition data unavailable — totalPortfolioValue not loaded yet.',
    ].join('\n');
  }

  // Aggregate by zone.
  let cbBtcUsd = 0;
  let wethZoneUsd = 0;
  const usdcUsd = ctx.usdcWalletBalance;
  let otherCohortUsd = 0;
  let nonCohortUsd = 0;
  const otherCohortSymbols = new Set(['cbXRP', 'cbLTC', 'LINK', 'cbADA', 'cbSOL']);
  for (const p of positions) {
    const symUpper = p.symbol.toUpperCase();
    if (symUpper === 'USDC') continue; // counted from wallet balance
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
  const deployedPct = (total - usdcUsd) / total;

  const usdcGap = usdcPct - USDC_RESERVE_TARGET; // + = over reserve (under-deployed)
  const overReserve = usdcGap > OVER_RESERVE_DEPLOY_THRESHOLD;
  const underReserve = usdcGap < -0.02;
  const excessCashUsd = Math.max(0, (usdcPct - USDC_RESERVE_TARGET) * total);

  // Mission math: harvested vs port-vs-initial delta.
  const portVsInitial = total - ctx.netCapitalInUsd;
  const netValueCreated = portVsInitial + ctx.totalHarvestedUsd;
  const harvestSustainable = portVsInitial >= 0;

  const lines: string[] = [];
  lines.push('═══ DEPLOYMENT POSTURE & MISSION (the structural picture) ═══');
  lines.push('');
  lines.push('MISSION — two goals running at once:');
  lines.push('  1. GROW port value over the Option B 30-day window');
  lines.push('  2. Fund passive harvests FROM that growth, not from the base');
  lines.push('The harvest math only works when port grows FASTER than harvest rate.');
  lines.push(`  Net capital in: ${fmtUsd(ctx.netCapitalInUsd)}  ·  Current port: ${fmtUsd(total)}  ·  Harvested to date: ${fmtUsd(ctx.totalHarvestedUsd)}`);
  lines.push(`  Port vs initial: ${fmtUsd(portVsInitial)} (${harvestSustainable ? 'sustainable — harvest came from growth' : 'NOT sustainable — harvest is eating into the base'})`);
  lines.push(`  Net value created (port + harvested − initial): ${fmtUsd(netValueCreated)}`);
  lines.push('');
  lines.push('CAPITAL DEPLOYMENT — the dominant directive:');
  lines.push(`  Deployed: ${fmtPctPlain(deployedPct)}  ·  USDC: ${fmtPctPlain(usdcPct)} held / 25% reserve rule / GAP ${fmtPct(usdcGap)}`);
  if (overReserve) {
    lines.push(`  ⚠️ UNDER-DEPLOYED — you hold ${fmtUsd(excessCashUsd)} of USDC ABOVE the 25% reserve. Idle cash above reserve is the single biggest drag on port growth: it earns nothing while the majors move, and it widens the gap to the benchmark every day the market rises. DEPLOY that excess into conviction cohort positions this cycle.`);
    lines.push(`  🚫 DO NOT raise cash further. Selling a liquid hold (e.g. WETH) to ADD to USDC while already over the 25% reserve is value-destroying and is NOT a legitimate "composition" move. Trim a position ONLY to rotate directly into a higher-conviction holding — never to park the proceeds in USDC.`);
  } else if (underReserve) {
    lines.push(`  Reserve is BELOW 25% — trimming an overweight or low-conviction position to replenish USDC is appropriate this cycle.`);
  } else {
    lines.push(`  Reserve is in the healthy band (~25%). Deploy/rotate by conviction; no forced cash-raising or cash-deploying pressure.`);
  }
  lines.push('');
  lines.push('BENCHMARK — your YARDSTICK, not your shopping list:');
  lines.push(`  Success = beating a 60% BTC / 40% ETH portfolio's RETURN over the rolling 30-day window. You are MEASURED against that blend; you are NOT required to HOLD it.`);
  lines.push(`  Hold whatever trades deeply + with conviction on Base. WETH is the deepest-liquidity major on Base — a legitimate core hold, NOT "overweight." cbBTC is the benchmark's BTC leg but trades THIN on Base DEXs (it has never filled at size here) — treat it as an opportunistic add only when liquidity AND conviction align, never as a weight you must force.`);
  lines.push(`  Current exposure (reference, not targets):`);
  lines.push(`    BTC-zone (cbBTC): ${fmtPctPlain(cbBtcPct)}  ·  ETH-zone (WETH+ETH): ${fmtPctPlain(wethPct)}  ·  Other cohort (cbXRP/cbLTC/LINK/cbADA/cbSOL): ${fmtPctPlain(otherCohortPct)}  ·  USDC: ${fmtPctPlain(usdcPct)}`);
  if (nonCohortPct >= 0.01) {
    lines.push(`    Non-cohort dust: ${fmtPctPlain(nonCohortPct)} (pre-pivot leftover — liquidate into cohort or reserve, don't let it bleed attention)`);
  }
  lines.push('');
  lines.push('INTERPRETATION — your alpha comes from tactical timing within the LIQUID cohort + disciplined deployment of cash above the reserve. It does NOT come from replicating benchmark weights with assets that don\'t fill. A dollar of idle USDC above the 25% reserve loses to the benchmark every day the majors rise — that is the drag to attack first, before any fine-grained timing call.');
  lines.push('');
  lines.push('THE EDGE — what only an AI can do at this granularity: real-time per-cycle dispersion reading + conviction synthesis across the liquid cohort + disciplined cash deployment, integrated into one decision every 15 minutes. A human cannot maintain this at 24/7 fidelity. That is your job.');

  return lines.join('\n');
}
