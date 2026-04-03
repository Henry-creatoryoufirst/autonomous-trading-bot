import { describe, it, expect } from 'vitest';
import {
  getPortfolioSensitivity,
  assessVolatility,
  checkCashDeploymentMode,
  checkCrashBuyingOverride,
} from '../deployment.js';

// ---------------------------------------------------------------------------
// Tier fixtures — mirrors production config structure
// ---------------------------------------------------------------------------
const SENSITIVITY_TIERS = [
  { minUSD: 0,    priceChangeThreshold: 0.02, label: 'MICRO' },
  { minUSD: 500,  priceChangeThreshold: 0.015, label: 'SMALL' },
  { minUSD: 5000, priceChangeThreshold: 0.01,  label: 'MEDIUM' },
] as const;

const DEPLOYMENT_TIERS = [
  { cashPct: 20, deployPct: 30, confluenceDiscount: 3, maxEntries: 2, label: 'LIGHT' },
  { cashPct: 40, deployPct: 50, confluenceDiscount: 5, maxEntries: 3, label: 'MODERATE' },
  { cashPct: 70, deployPct: 70, confluenceDiscount: 8, maxEntries: 5, label: 'URGENT' },
] as const;

const MIN_RESERVE = 50; // minimum cash floor in USD

// ===========================================================================
// getPortfolioSensitivity
// ===========================================================================
describe('getPortfolioSensitivity', () => {
  it('returns the first tier for a tiny portfolio', () => {
    const result = getPortfolioSensitivity(100, SENSITIVITY_TIERS);
    expect(result.tier).toBe('MICRO');
    expect(result.threshold).toBe(0.02);
  });

  it('returns the highest matching tier', () => {
    const result = getPortfolioSensitivity(6000, SENSITIVITY_TIERS);
    expect(result.tier).toBe('MEDIUM');
    expect(result.threshold).toBe(0.01);
  });

  it('returns MICRO for a zero-value portfolio', () => {
    const result = getPortfolioSensitivity(0, SENSITIVITY_TIERS);
    expect(result.tier).toBe('MICRO');
  });
});

// ===========================================================================
// assessVolatility
// ===========================================================================
describe('assessVolatility', () => {
  it('detects EXTREME volatility for >8% change', () => {
    const current = new Map([['ETH', 2700]]);
    const previous = new Map([['ETH', 2400]]); // 12.5% move
    const result = assessVolatility(current, previous);
    expect(result.level).toBe('EXTREME');
    expect(result.fastestMover).toBe('ETH');
    expect(result.maxChange).toBeCloseTo(0.125, 2);
  });

  it('returns DEAD for near-zero movement', () => {
    const current = new Map([['ETH', 2500]]);
    const previous = new Map([['ETH', 2500]]); // 0% change
    const result = assessVolatility(current, previous);
    expect(result.level).toBe('DEAD');
    expect(result.maxChange).toBe(0);
  });

  it('picks the fastest mover among multiple tokens', () => {
    const current = new Map([['ETH', 2550], ['BTC', 60000]]);
    const previous = new Map([['ETH', 2500], ['BTC', 50000]]); // BTC moved 20%
    const result = assessVolatility(current, previous);
    expect(result.fastestMover).toBe('BTC');
  });

  it('ignores tokens with no previous price', () => {
    const current = new Map([['ETH', 2500], ['NEW', 100]]);
    const previous = new Map([['ETH', 2500]]);
    const result = assessVolatility(current, previous);
    expect(result.level).toBe('DEAD');
    expect(result.maxChange).toBe(0);
  });
});

// ===========================================================================
// checkCashDeploymentMode
// ===========================================================================
describe('checkCashDeploymentMode', () => {
  function defaultDirective() {
    return { deploymentThresholdOverride: undefined, confluenceReduction: 0 };
  }
  function defaultMutableState() {
    return { cashDeploymentMode: false, cashDeploymentCycles: 0 };
  }

  it('returns inactive when portfolio value is zero', () => {
    const result = checkCashDeploymentMode(100, 0, 50, DEPLOYMENT_TIERS, MIN_RESERVE, defaultDirective(), defaultMutableState());
    expect(result.active).toBe(false);
  });

  it('suspends deployment when Fear & Greed < 15 (extreme fear)', () => {
    const mutable = { cashDeploymentMode: true, cashDeploymentCycles: 5 };
    const result = checkCashDeploymentMode(800, 1000, 10, DEPLOYMENT_TIERS, MIN_RESERVE, defaultDirective(), mutable);
    expect(result.active).toBe(false);
    expect(mutable.cashDeploymentMode).toBe(false);
  });

  it('activates deployment when cash exceeds the tier threshold', () => {
    // 800 USDC out of 1000 total = 80% cash -> should match URGENT tier (70%)
    const mutable = defaultMutableState();
    const result = checkCashDeploymentMode(800, 1000, 50, DEPLOYMENT_TIERS, MIN_RESERVE, defaultDirective(), mutable);
    expect(result.active).toBe(true);
    expect(result.tier).toBe('URGENT');
    expect(result.deployBudget).toBeGreaterThan(0);
    expect(mutable.cashDeploymentMode).toBe(true);
  });

  it('respects minimum reserve floor in budget calculation', () => {
    // 250 USDC out of 1000 = 25% cash -> LIGHT tier (>20%)
    // target cash = 1000 * 0.20 = 200, excess = max(0, 250 - max(200, 50)) = 50
    const result = checkCashDeploymentMode(250, 1000, 50, DEPLOYMENT_TIERS, MIN_RESERVE, defaultDirective(), defaultMutableState());
    expect(result.active).toBe(true);
    expect(result.excessCash).toBe(50);
    // deployBudget = 50 * 0.30 = 15
    expect(result.deployBudget).toBeCloseTo(15);
  });

  it('returns inactive when excess cash is too small (<$10)', () => {
    // 205 USDC out of 1000 = 20.5% cash -> barely above LIGHT tier
    // target = 200, excess = 205 - 200 = 5 < 10
    const result = checkCashDeploymentMode(205, 1000, 50, DEPLOYMENT_TIERS, MIN_RESERVE, defaultDirective(), defaultMutableState());
    expect(result.active).toBe(false);
  });

  it('returns inactive for 100% non-cash portfolio (0% USDC)', () => {
    const result = checkCashDeploymentMode(0, 5000, 50, DEPLOYMENT_TIERS, MIN_RESERVE, defaultDirective(), defaultMutableState());
    expect(result.active).toBe(false);
    expect(result.cashPercent).toBe(0);
  });
});

// ===========================================================================
// checkCrashBuyingOverride
// ===========================================================================
describe('checkCrashBuyingOverride', () => {
  const baseDeployCheck = { active: true, cashPercent: 60, excessCash: 500, deployBudget: 200, confluenceDiscount: 5 };

  it('activates override when cash is above minimum threshold', () => {
    const mutable = { crashBuyingOverrideActive: false, crashBuyingOverrideCycles: 0 };
    const result = checkCrashBuyingOverride(baseDeployCheck, 20, false, 50, 1.5, 4, 2, mutable);
    expect(result.active).toBe(true);
    expect(result.requirePositiveBuyRatio).toBe(true);
    expect(result.maxPositionPct).toBe(5);
    expect(mutable.crashBuyingOverrideActive).toBe(true);
  });

  it('blocks override when cash is below threshold', () => {
    const lowCash = { ...baseDeployCheck, cashPercent: 10 };
    const mutable = { crashBuyingOverrideActive: false, crashBuyingOverrideCycles: 0 };
    const result = checkCrashBuyingOverride(lowCash, 20, false, 50, 1.5, 4, 2, mutable);
    expect(result.active).toBe(false);
  });

  it('blocks override when capital floor is active', () => {
    const mutable = { crashBuyingOverrideActive: false, crashBuyingOverrideCycles: 0 };
    const result = checkCrashBuyingOverride(baseDeployCheck, 20, true, 50, 1.5, 4, 2, mutable);
    expect(result.active).toBe(false);
    expect(result.reason).toContain('Capital floor');
  });
});
