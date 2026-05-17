/**
 * Cohort physics — the actual signal block for the heavy-cycle prompt.
 *
 * Pre-2026-05-17 the heavy-cycle prompt's MARKET SENTIMENT block summarized
 * the market with just F&G + BTC 24h + ETH 24h, and the LLM started anchoring
 * decisions on the F&G aggregate — leading to HOLD-through-recovery when
 * F&G was lagging the tape. Per Henry's 2026-05-17 strategic critique
 * ("why does one number change everything... market has opportunity to
 * trade, the bot is just not even trying"), this block REPLACES that thin
 * sentiment view with a structured dispersion-and-flow read across the
 * full 7-quality cohort. F&G is demoted to a single context line; the
 * leading signal is the per-token 24h price action, dispersion shape,
 * and an explicit reading guide that the LLM can match against.
 */

export interface CohortTokenSnapshot {
  symbol: string;
  priceChange24h: number | null;
  volume24h: number | null;
}

export interface CohortPhysicsContext {
  /** F&G index value (0-100). Lagging — kept as context only. */
  fearGreedValue: number;
  fearGreedClassification: string;
  /** Market regime classifier output (TRENDING_UP / TRENDING_DOWN / RANGING / VOLATILE / UNKNOWN). */
  regime: string;
}

function fmtPct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

function classifyDispersion(changes: number[]): {
  shape: 'all-positive' | 'all-negative' | 'mixed';
  positives: number;
  negatives: number;
  meanPct: number;
  rangePct: number;
} {
  const positives = changes.filter((c) => c > 0).length;
  const negatives = changes.filter((c) => c < 0).length;
  let shape: 'all-positive' | 'all-negative' | 'mixed';
  if (positives === changes.length) shape = 'all-positive';
  else if (negatives === changes.length) shape = 'all-negative';
  else shape = 'mixed';
  const meanPct = changes.reduce((s, c) => s + c, 0) / changes.length;
  const rangePct = Math.max(...changes) - Math.min(...changes);
  return { shape, positives, negatives, meanPct, rangePct };
}

/**
 * Format the cohort physics block. Resilient to missing/partial data:
 * symbols not in `tokens` render with "—" and don't contribute to dispersion.
 */
export function formatCohortPhysicsBlock(
  cohortSymbols: ReadonlyArray<string>,
  tokens: ReadonlyArray<CohortTokenSnapshot>,
  ctx: CohortPhysicsContext,
): string {
  const bySymbol = new Map<string, CohortTokenSnapshot>();
  for (const t of tokens) bySymbol.set(t.symbol.toUpperCase(), t);

  const rows = cohortSymbols.map((sym) => {
    const t = bySymbol.get(sym.toUpperCase()) ?? bySymbol.get(sym.replace(/^cb/, '').toUpperCase());
    return {
      symbol: sym,
      change: t?.priceChange24h ?? null,
      volume: t?.volume24h ?? null,
    };
  });

  // Sort by 24h change desc for the price line (highlights leaders + laggards visually)
  const sortedByChange = [...rows].sort((a, b) => {
    if (a.change === null && b.change === null) return 0;
    if (a.change === null) return 1;
    if (b.change === null) return -1;
    return b.change - a.change;
  });

  const priceLine = sortedByChange
    .map((r) => `${r.symbol} ${fmtPct(r.change)}`)
    .join(' · ');

  const validChanges = rows
    .map((r) => r.change)
    .filter((c): c is number => c !== null && Number.isFinite(c));

  let dispersionLine: string;
  let interpretation: string;
  if (validChanges.length === 0) {
    dispersionLine = 'Dispersion: no data';
    interpretation = 'Cohort price data unavailable — fall back to other physics blocks below.';
  } else {
    const d = classifyDispersion(validChanges);
    const leader = sortedByChange.find((r) => r.change !== null);
    const laggard = [...sortedByChange].reverse().find((r) => r.change !== null);

    dispersionLine = `Dispersion: ${d.positives}/${rows.length} positive, ${d.negatives}/${rows.length} negative · mean ${fmtPct(d.meanPct)} · range ${d.rangePct.toFixed(1)}%`;

    const leaderTxt = leader ? `${leader.symbol} ${fmtPct(leader.change)}` : 'n/a';
    const laggardTxt = laggard ? `${laggard.symbol} ${fmtPct(laggard.change)}` : 'n/a';

    if (d.shape === 'all-positive') {
      interpretation = `READ: All ${rows.length} cohort tokens positive — coordinated recovery / capital flowing back into quality. F&G ${ctx.fearGreedValue} (${ctx.fearGreedClassification}) is LAGGING the tape. This is a BUY-zone physics signature. DO NOT default to HOLD on the basis of F&G — physics overrides aggregate sentiment when the dispersion shape disagrees. If you HOLD, you must explicitly explain why the BUY zone is wrong here.`;
    } else if (d.shape === 'all-negative') {
      interpretation = `READ: All ${rows.length} cohort tokens negative — coordinated capitulation / risk-off. F&G ${ctx.fearGreedValue} (${ctx.fearGreedClassification}) agrees. HOLD existing quality positions; do not catch falling knives. Re-evaluate when dispersion turns mixed (some recovering = rotation starting).`;
    } else {
      interpretation = `READ: Mixed dispersion (${d.positives} up, ${d.negatives} down). Leader ${leaderTxt} vs laggard ${laggardTxt}. This is ROTATION shape — selective trades indicated: trim laggards if conviction degraded, add to leaders if conviction confirmed. F&G ${ctx.fearGreedValue} (${ctx.fearGreedClassification}) is too coarse to resolve which is which; reason from the per-token shape and conviction. DO NOT collapse to HOLD by averaging across the cohort — that's exactly what F&G already does and it's losing signal.`;
    }
  }

  return [
    '═══ COHORT PHYSICS — read this FIRST. The dispersion shape across the 7-quality cohort is the leading market signal; F&G is a lagging aggregate that often disagrees with the tape. ═══',
    `24h price · ${priceLine}`,
    dispersionLine,
    `Context · regime=${ctx.regime} · F&G ${ctx.fearGreedValue} (${ctx.fearGreedClassification}, lagging aggregate)`,
    interpretation,
    `REQUIRED in your decision reasoning: explicitly cite the dispersion shape (all-positive / all-negative / mixed) and either the leader OR laggard. Do not lead your reasoning with F&G or win-rate — those are diagnostics, not the signal. The cohort physics above is the signal.`,
  ].join('\n');
}
