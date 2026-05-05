/**
 * NVR Capital — Capital Sleeves: Allocator
 *
 * The allocator decides what fraction of bot capital each sleeve is entitled
 * to deploy this cycle. Two allocators ship in v1:
 *
 *   - StaticAllocator: fixed weights, set once at startup. Used during the
 *     rollout phase so the bot behaves identically to the pre-sleeve
 *     version ({ core: 1.0 }).
 *
 *   - PerformanceAllocator: softmax over rolling 7d Sharpe. Ships in a later
 *     phase once at least one alpha sleeve has live P&L history.
 *
 * See NVR-SPEC-010 §"Capital allocator".
 */

import type { CapitalAllocator, Sleeve } from './types.js';

/**
 * Always returns the provided fixed weights. Any sleeves not in the weights
 * map are implicitly at 0% — they can still run in paper mode but will
 * receive `capitalBudgetUSD = 0` and should return no decisions.
 *
 * Weights should sum to ≤1.0; any shortfall is held as USDC reserve.
 */
export class StaticAllocator implements CapitalAllocator {
  constructor(private readonly weights: Record<string, number>) {
    const sum = Object.values(weights).reduce((s, w) => s + w, 0);
    if (sum > 1.0 + 1e-9) {
      throw new Error(
        `StaticAllocator: weights sum to ${sum.toFixed(4)} which exceeds 1.0. Reduce an allocation.`,
      );
    }
    for (const [id, w] of Object.entries(weights)) {
      if (w < 0) {
        throw new Error(`StaticAllocator: sleeve '${id}' has negative weight ${w}.`);
      }
    }
  }

  computeWeights(sleeves: Sleeve[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of sleeves) {
      const requested = this.weights[s.id] ?? 0;
      // Clamp to sleeve's own bounds.
      out[s.id] = Math.max(s.minCapitalPct * 0, Math.min(s.maxCapitalPct, requested));
      // Note: we intentionally do NOT enforce minCapitalPct here — a sleeve
      // not listed in the weights map is explicitly at 0, which is valid
      // for paper-mode sleeves that haven't graduated yet.
    }
    return out;
  }
}

/**
 * Default allocator. Reads `ALPHA_HUNTER_ALLOCATION_PCT` from env (e.g. 0.05
 * for 5%) and gives the remainder to Core. When unset or 0, behavior matches
 * the pre-rollout `{ core: 1.0 }` shape exactly — no change for existing
 * deployments. Pair with `ALPHA_HUNTER_LIVE=true` (registry.ts) for live
 * AlphaHunter execution; allocation alone with mode='paper' just inflates the
 * paper budget.
 *
 * Bounds: ALPHA_HUNTER_ALLOCATION_PCT is clamped to [0, 0.20]. The 20% ceiling
 * is a hard guardrail against accidental over-allocation; raise deliberately
 * if a real edge is proven.
 */
export function defaultStaticAllocator(): StaticAllocator {
  const raw = parseFloat(process.env.ALPHA_HUNTER_ALLOCATION_PCT ?? '0');
  const alphaPct = Number.isFinite(raw) ? Math.max(0, Math.min(0.20, raw)) : 0;
  const corePct = Math.max(0, 1.0 - alphaPct);
  return new StaticAllocator({ core: corePct, 'alpha-hunter': alphaPct });
}
