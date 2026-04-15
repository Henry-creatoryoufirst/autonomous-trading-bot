/**
 * Unit tests for position-sizing pure helpers.
 *
 * These multipliers run on every BUY trade. A wrong value here changes
 * real capital deployment. Test every boundary thoroughly.
 */

import { describe, it, expect } from 'vitest';
import {
  computeVolatilityMultiplier,
  computeConfidenceMultiplier,
  combinePositionMultipliers,
  computeCatchingFireMultiplier,
  computeDeploymentFloor,
} from '../position-sizing.js';

// ─── computeVolatilityMultiplier ──────────────────────────────────────────────

describe('computeVolatilityMultiplier', () => {
  it('returns 1.0 when token ATR equals average ATR', () => {
    expect(computeVolatilityMultiplier(3.0, [3.0, 3.0, 3.0])).toBe(1.0);
  });

  it('returns > 1.0 for a calmer-than-average token', () => {
    // tokenATR=1.0, avgATR=3.0 → volRatio=3.0 → clamped to 1.5
    const result = computeVolatilityMultiplier(1.0, [3.0, 3.0, 3.0]);
    expect(result).toBe(1.5);
  });

  it('returns < 1.0 for a more-volatile-than-average token', () => {
    // tokenATR=6.0, avgATR=2.0 → volRatio=0.333 → clamped to 0.5
    const result = computeVolatilityMultiplier(6.0, [2.0, 2.0, 2.0]);
    expect(result).toBe(0.5);
  });

  it('clamps at 0.5 for extremely volatile token', () => {
    const result = computeVolatilityMultiplier(100.0, [1.0, 1.0, 1.0]);
    expect(result).toBe(0.5);
  });

  it('clamps at 1.5 for extremely calm token', () => {
    const result = computeVolatilityMultiplier(0.1, [10.0, 10.0, 10.0]);
    expect(result).toBe(1.5);
  });

  it('returns 1.0 when tokenATR is 0 (guard against division by zero)', () => {
    expect(computeVolatilityMultiplier(0, [3.0, 4.0])).toBe(1.0);
  });

  it('uses tokenATR as avgATR when allATRs is empty', () => {
    // avgATR = tokenATR → volRatio = 1.0
    expect(computeVolatilityMultiplier(5.0, [])).toBe(1.0);
  });

  it('filters out zero ATRs from the average', () => {
    // Valid ATRs: [4.0, 4.0] → avgATR = 4.0, tokenATR = 2.0 → volRatio = 2.0 → 1.5
    const result = computeVolatilityMultiplier(2.0, [0, 4.0, 0, 4.0]);
    expect(result).toBe(1.5);
  });

  it('computes correctly with mixed ATR array', () => {
    // avgATR = (2+4+6)/3 = 4.0, tokenATR = 4.0 → volRatio = 1.0
    const result = computeVolatilityMultiplier(4.0, [2.0, 4.0, 6.0]);
    expect(result).toBeCloseTo(1.0, 5);
  });

  it('result is always between 0.5 and 1.5 inclusive', () => {
    for (const tokenATR of [0.1, 1, 2, 3, 5, 10, 50]) {
      const result = computeVolatilityMultiplier(tokenATR, [1, 2, 3, 4, 5]);
      expect(result).toBeGreaterThanOrEqual(0.5);
      expect(result).toBeLessThanOrEqual(1.5);
    }
  });
});

// ─── computeConfidenceMultiplier ──────────────────────────────────────────────

describe('computeConfidenceMultiplier', () => {
  it('returns 0.6 for confluence 0 (no signal)', () => {
    expect(computeConfidenceMultiplier(0)).toBe(0.6);
  });

  it('returns 0.6 for confluence 1–19 (weak signal)', () => {
    expect(computeConfidenceMultiplier(1)).toBe(0.6);
    expect(computeConfidenceMultiplier(10)).toBe(0.6);
    expect(computeConfidenceMultiplier(19)).toBe(0.6);
  });

  it('returns 0.8 for confluence exactly 20', () => {
    expect(computeConfidenceMultiplier(20)).toBe(0.8);
  });

  it('returns 0.8 for confluence 20–39 (moderate signal)', () => {
    expect(computeConfidenceMultiplier(25)).toBe(0.8);
    expect(computeConfidenceMultiplier(39)).toBe(0.8);
  });

  it('returns 1.0 for confluence exactly 40', () => {
    expect(computeConfidenceMultiplier(40)).toBe(1.0);
  });

  it('returns 1.0 for confluence 40+ (strong signal)', () => {
    expect(computeConfidenceMultiplier(50)).toBe(1.0);
    expect(computeConfidenceMultiplier(100)).toBe(1.0);
  });

  it('uses absolute value — negative confluence gives same multiplier', () => {
    expect(computeConfidenceMultiplier(-15)).toBe(computeConfidenceMultiplier(15));
    expect(computeConfidenceMultiplier(-30)).toBe(computeConfidenceMultiplier(30));
    expect(computeConfidenceMultiplier(-50)).toBe(computeConfidenceMultiplier(50));
  });

  it('only returns 0.6, 0.8, or 1.0 — never other values', () => {
    const scores = [-100, -50, -40, -39, -20, -19, 0, 19, 20, 39, 40, 100];
    for (const s of scores) {
      const r = computeConfidenceMultiplier(s);
      expect([0.6, 0.8, 1.0]).toContain(r);
    }
  });
});

// ─── combinePositionMultipliers ───────────────────────────────────────────────

describe('combinePositionMultipliers', () => {
  it('multiplies the two values together', () => {
    expect(combinePositionMultipliers(1.2, 0.8)).toBeCloseTo(0.96, 5);
  });

  it('both at 1.0 → 1.0', () => {
    expect(combinePositionMultipliers(1.0, 1.0)).toBe(1.0);
  });

  it('max vol × max conf → 1.5 × 1.0 = 1.5', () => {
    expect(combinePositionMultipliers(1.5, 1.0)).toBe(1.5);
  });

  it('min vol × min conf → 0.5 × 0.6 = 0.3', () => {
    expect(combinePositionMultipliers(0.5, 0.6)).toBeCloseTo(0.3, 5);
  });

  it('weakest signal on volatile token significantly reduces trade size', () => {
    const vol  = computeVolatilityMultiplier(10.0, [2.0, 2.0, 2.0]); // → 0.5
    const conf = computeConfidenceMultiplier(5);                       // → 0.6
    const combined = combinePositionMultipliers(vol, conf);
    expect(combined).toBeCloseTo(0.3, 5);
    // A $100 base trade would become $30 — meaningful protection
  });

  it('strong signal on calm token gives near-full size', () => {
    const vol  = computeVolatilityMultiplier(1.0, [3.0, 3.0, 3.0]); // → 1.5 (capped)
    const conf = computeConfidenceMultiplier(60);                      // → 1.0
    const combined = combinePositionMultipliers(vol, conf);
    expect(combined).toBe(1.5);
  });
});

// ─── computeCatchingFireMultiplier ────────────────────────────────────────────

describe('computeCatchingFireMultiplier', () => {
  it('returns 1.5 when buy ratio > 60% AND trade count > 50', () => {
    expect(computeCatchingFireMultiplier(0.61, 51)).toBe(1.5);
    expect(computeCatchingFireMultiplier(0.80, 100)).toBe(1.5);
    expect(computeCatchingFireMultiplier(0.99, 200)).toBe(1.5);
  });

  it('returns 1.0 when buy ratio is exactly 60% (not strictly greater)', () => {
    expect(computeCatchingFireMultiplier(0.60, 100)).toBe(1.0);
  });

  it('returns 1.0 when buy ratio > 60% but trade count is exactly 50 (not strictly greater)', () => {
    expect(computeCatchingFireMultiplier(0.70, 50)).toBe(1.0);
  });

  it('returns 1.0 when buy ratio < 60%', () => {
    expect(computeCatchingFireMultiplier(0.50, 100)).toBe(1.0);
    expect(computeCatchingFireMultiplier(0.30, 200)).toBe(1.0);
  });

  it('returns 1.0 when trade count is 0 (no volume)', () => {
    expect(computeCatchingFireMultiplier(0.99, 0)).toBe(1.0);
  });

  it('returns 1.0 when neither condition met', () => {
    expect(computeCatchingFireMultiplier(0.40, 20)).toBe(1.0);
  });
});

// ─── computeDeploymentFloor ───────────────────────────────────────────────────

describe('computeDeploymentFloor', () => {
  it('uses $150 floor when 3.5% of portfolio is below $150', () => {
    // 3.5% of $3000 = $105 → floor = $150
    const result = computeDeploymentFloor(3000, 1000);
    expect(result).toBe(150);
  });

  it('uses 3.5% when it exceeds $150', () => {
    // 3.5% of $10000 = $350 → floor = $350
    const result = computeDeploymentFloor(10000, 1000);
    expect(result).toBeCloseTo(350, 2);
  });

  it('is capped by remainingUSDC', () => {
    // 3.5% of $10000 = $350, but only $200 USDC available
    const result = computeDeploymentFloor(10000, 200);
    expect(result).toBe(200);
  });

  it('returns 0 when remainingUSDC is 0', () => {
    expect(computeDeploymentFloor(10000, 0)).toBe(0);
  });

  it('floor is at least $150 for any portfolio above ~$4300', () => {
    // $4285 × 3.5% = $150 exactly
    const result = computeDeploymentFloor(5000, 1000);
    expect(result).toBeGreaterThanOrEqual(150);
  });
});
