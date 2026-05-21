/**
 * Tests for the SystemAudit → heavy-cycle prompt block formatter
 * (NVR-SPEC-035 Phase B prompt-wiring; closes the INV-5 forcing-function
 * loop so the bot reasons about cohort gaps in-prompt rather than only in
 * Railway logs).
 */

import { describe, it, expect } from 'vitest';
import { formatSystemAuditPromptBlock } from '../prompt-block.js';
import type { AuditReport, Violation } from '../types.js';

function report(violations: Violation[]): AuditReport {
  return {
    cycle: 100,
    ranAt: new Date().toISOString(),
    durationMs: 5,
    violations,
    blockerActive: false,
    alertMode: 'alert',
  };
}

function inv5Violation(opts: {
  covered: string[];
  dust?: Array<{ symbol: string; usdValue: number }>;
  missing?: string[];
}): Violation {
  return {
    invariantId: 'INV-5',
    invariantName: 'cohort-coverage',
    severity: 'WARN',
    message: 'whatever',
    observed: {
      covered: opts.covered,
      dust: opts.dust ?? [],
      missing: opts.missing ?? [],
      coveredCount: opts.covered.length,
      cohortSize: 7,
      minPositionUsd: 50,
      portfolioValue: 3000,
    },
    expected: {},
    pauseScope: 'none',
    detectedAt: new Date().toISOString(),
  };
}

describe('formatSystemAuditPromptBlock', () => {
  it('returns empty string when report is null', () => {
    expect(formatSystemAuditPromptBlock(null)).toBe('');
  });

  it('returns empty string when there are no WARN violations', () => {
    expect(formatSystemAuditPromptBlock(report([]))).toBe('');
  });

  it('returns empty string when only SEVERE violations are present (SEVERE gates execution, not prompt)', () => {
    const severe: Violation = {
      invariantId: 'INV-1',
      invariantName: 'dimensional-honesty',
      severity: 'SEVERE',
      message: 'whatever',
      observed: {},
      expected: {},
      pauseScope: 'all-buys',
      detectedAt: new Date().toISOString(),
    };
    expect(formatSystemAuditPromptBlock(report([severe]))).toBe('');
  });
});

describe("formatSystemAuditPromptBlock — Henry's 2026-05-21 case study", () => {
  const block = formatSystemAuditPromptBlock(report([
    inv5Violation({
      covered: ['WETH', 'cbLTC'],
      dust: [
        { symbol: 'cbBTC', usdValue: 0.70 },
        { symbol: 'cbXRP', usdValue: 0.23 },
        { symbol: 'LINK',  usdValue: 0.27 },
      ],
      missing: ['cbADA', 'cbSOL'],
    }),
  ]));

  it('opens with the SYSTEM AUDIT header', () => {
    expect(block).toMatch(/═══ SYSTEM AUDIT \(WARN\) ═══/);
  });

  it('names the covered count and threshold', () => {
    expect(block).toMatch(/2\/7 cohort symbols covered/);
    expect(block).toMatch(/≥\$50/);
  });

  it('names the MISSING symbols explicitly', () => {
    expect(block).toMatch(/MISSING: cbADA, cbSOL/);
  });

  it('names dust symbols with their dollar values', () => {
    expect(block).toMatch(/dust:/);
    expect(block).toMatch(/cbBTC \$0\.70/);
    expect(block).toMatch(/cbXRP \$0\.23/);
    expect(block).toMatch(/LINK \$0\.27/);
  });

  it('reminds the model that closing the gap requires actual buys, not log scrolling', () => {
    expect(block).toMatch(/strategy proves it runs/);
  });
});

describe('formatSystemAuditPromptBlock — edge cases', () => {
  it('skips the dust line when dust list is empty', () => {
    const block = formatSystemAuditPromptBlock(report([
      inv5Violation({ covered: ['WETH'], missing: ['cbADA', 'cbSOL', 'cbBTC', 'cbXRP', 'cbLTC', 'LINK'] }),
    ]));
    expect(block).not.toMatch(/dust:/);
    expect(block).toMatch(/MISSING: cbADA, cbSOL, cbBTC, cbXRP, cbLTC, LINK/);
  });

  it('skips the MISSING line when nothing is fully missing (all dust)', () => {
    const block = formatSystemAuditPromptBlock(report([
      inv5Violation({
        covered: [],
        dust: [
          { symbol: 'WETH',  usdValue: 1 },
          { symbol: 'cbBTC', usdValue: 1 },
          { symbol: 'cbXRP', usdValue: 1 },
          { symbol: 'cbLTC', usdValue: 1 },
          { symbol: 'LINK',  usdValue: 1 },
          { symbol: 'cbADA', usdValue: 1 },
          { symbol: 'cbSOL', usdValue: 1 },
        ],
      }),
    ]));
    expect(block).not.toMatch(/MISSING:/);
    expect(block).toMatch(/0\/7 cohort symbols covered/);
    expect(block).toMatch(/dust: WETH \$1\.00/);
  });

  it('emits a generic fallback for non-INV-5 WARN violations', () => {
    const otherWarn: Violation = {
      invariantId: 'INV-6',
      invariantName: 'reserve-floor',
      severity: 'WARN',
      message: 'reserve $40 below 25% target',
      observed: {},
      expected: {},
      pauseScope: 'none',
      detectedAt: new Date().toISOString(),
    };
    const block = formatSystemAuditPromptBlock(report([otherWarn]));
    expect(block).toMatch(/INV-6 reserve-floor — reserve \$40 below 25% target/);
  });
});
