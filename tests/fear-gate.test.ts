/**
 * Fear & Greed gate tests: F&G-based cash deployment blocking.
 *
 * The fear gate prevents deploying cash during extreme fear (F&G < 15),
 * limits to URGENT-only during moderate fear (15-24), and allows
 * normal tiered deployment at F&G >= 25.
 */

import { describe, it, expect } from 'vitest';
import { checkCashDeploymentMode, DEFAULT_TIERS } from '../services/testable/cash-deployment.js';

describe('F&G = 8 (extreme fear) -> deployment BLOCKED', () => {
  it('should block all deployment at F&G=8 regardless of cash level', () => {
    // 80% cash, $10K portfolio => lots of excess, but F&G=8 blocks everything
    const result = checkCashDeploymentMode(8000, 10000, 8);
    expect(result.active).toBe(false);
    expect(result.tier).toBe('NONE');
    expect(result.deployBudget).toBe(0);
  });

  it('should block deployment at F&G=0', () => {
    const result = checkCashDeploymentMode(9000, 10000, 0);
    expect(result.active).toBe(false);
  });

  it('should block deployment at F&G=14 (just below threshold)', () => {
    const result = checkCashDeploymentMode(9000, 10000, 14);
    expect(result.active).toBe(false);
  });

  it('should still report correct cashPercent even when blocked', () => {
    const result = checkCashDeploymentMode(8000, 10000, 8);
    expect(result.cashPercent).toBe(80);
  });
});

describe('F&G = 20 (moderate fear) -> only URGENT tier', () => {
  it('should allow URGENT tier (>65% cash) at F&G=20', () => {
    // 70% cash => exceeds URGENT threshold of 65%
    const result = checkCashDeploymentMode(7000, 10000, 20);
    expect(result.active).toBe(true);
    expect(result.tier).toBe('URGENT');
  });

  it('should block AGGRESSIVE tier (50% cash) at F&G=20', () => {
    // 55% cash => would normally match AGGRESSIVE, but F&G=20 restricts to URGENT only
    const result = checkCashDeploymentMode(5500, 10000, 20);
    expect(result.active).toBe(false);
    expect(result.tier).toBe('NONE');
  });

  it('should block MODERATE tier (35% cash) at F&G=20', () => {
    const result = checkCashDeploymentMode(4000, 10000, 20);
    expect(result.active).toBe(false);
  });

  it('should block LIGHT tier (20% cash) at F&G=20', () => {
    const result = checkCashDeploymentMode(2500, 10000, 20);
    expect(result.active).toBe(false);
  });

  it('should work at F&G=15 (boundary of moderate fear)', () => {
    // F&G=15 is >= 15 so not blocked, but < 25 so only URGENT
    const result = checkCashDeploymentMode(7000, 10000, 15);
    expect(result.active).toBe(true);
    expect(result.tier).toBe('URGENT');
  });

  it('should work at F&G=24 (upper boundary of moderate fear)', () => {
    const result = checkCashDeploymentMode(7000, 10000, 24);
    expect(result.active).toBe(true);
    expect(result.tier).toBe('URGENT');
  });
});

describe('F&G = 50 (neutral) -> normal tiered deployment', () => {
  it('should activate LIGHT tier at 25% cash', () => {
    const result = checkCashDeploymentMode(2500, 10000, 50);
    expect(result.active).toBe(true);
    expect(result.tier).toBe('LIGHT');
  });

  it('should activate MODERATE tier at 40% cash', () => {
    const result = checkCashDeploymentMode(4000, 10000, 50);
    expect(result.active).toBe(true);
    expect(result.tier).toBe('MODERATE');
  });

  it('should activate AGGRESSIVE tier at 55% cash', () => {
    const result = checkCashDeploymentMode(5500, 10000, 50);
    expect(result.active).toBe(true);
    expect(result.tier).toBe('AGGRESSIVE');
  });

  it('should activate URGENT tier at 70% cash', () => {
    const result = checkCashDeploymentMode(7000, 10000, 50);
    expect(result.active).toBe(true);
    expect(result.tier).toBe('URGENT');
  });

  it('should not deploy if cash is below all thresholds', () => {
    // 15% cash => below LIGHT threshold of 20%
    const result = checkCashDeploymentMode(1500, 10000, 50);
    expect(result.active).toBe(false);
  });

  it('should respect minReserveUSD', () => {
    // $200 USDC on a $800 portfolio => 25% cash, would match LIGHT
    // But excessCash = 200 - max(160, 150) = 40 => deployBudget = 40 * 0.3 = 12
    const result = checkCashDeploymentMode(200, 800, 50);
    expect(result.active).toBe(true);
    expect(result.deployBudget).toBeGreaterThan(0);
    expect(result.deployBudget).toBeLessThan(200);
  });

  it('should return zero when excessCash is below $10 minimum', () => {
    // Just barely above LIGHT threshold but reserve eats most of the cash
    // $155 cash on $750 portfolio => cashPct=20.67% > 20%, target=150, excess=5 < 10 => inactive
    const result = checkCashDeploymentMode(155, 750, 50);
    expect(result.active).toBe(false);
  });
});

describe('edge cases', () => {
  it('should handle zero portfolio value', () => {
    const result = checkCashDeploymentMode(1000, 0, 50);
    expect(result.active).toBe(false);
  });

  it('should handle negative portfolio value', () => {
    const result = checkCashDeploymentMode(1000, -100, 50);
    expect(result.active).toBe(false);
  });

  it('should default F&G to 50 if not provided', () => {
    // 70% cash, should match URGENT at default F&G=50
    const result = checkCashDeploymentMode(7000, 10000);
    expect(result.active).toBe(true);
    expect(result.tier).toBe('URGENT');
  });
});
