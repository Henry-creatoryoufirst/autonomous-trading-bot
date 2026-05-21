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

describe('formatSystemAuditPromptBlock — INV-6 reserve floor specialization', () => {
  it('formats the gap-to-target line with the One Hard Rule context', () => {
    const violation: Violation = {
      invariantId: 'INV-6',
      invariantName: 'reserve-floor',
      severity: 'WARN',
      message: 'whatever (overwritten by specialization)',
      observed: {
        usdcBalance: 150,
        usdcPct: 5,
        targetPct: 25,
        warnFloorPct: 20,
        targetUsd: 750,
        gapToTargetUsd: 600,
        gapToFloorUsd: 450,
        portfolioValue: 3000,
      },
      expected: {},
      pauseScope: 'none',
      detectedAt: new Date().toISOString(),
    };
    const block = formatSystemAuditPromptBlock(report([violation]));
    expect(block).toMatch(/INV-6 reserve floor/);
    expect(block).toMatch(/USDC at 5\.0% \(\$150\)/);
    expect(block).toMatch(/target 25%/);
    expect(block).toMatch(/Gap \$600/);
    expect(block).toMatch(/ONE hardcoded strategy invariant/);
    expect(block).toMatch(/canonical restore move/);
  });
});

describe('formatSystemAuditPromptBlock — INV-7 sleeve liveness specialization', () => {
  it('names every silent sleeve with hours-since-decision', () => {
    const violation: Violation = {
      invariantId: 'INV-7',
      invariantName: 'sleeve-liveness',
      severity: 'WARN',
      message: 'whatever (overwritten)',
      observed: {
        silent: [
          { id: 'alpha-hunter', lastDecisionAt: '2026-05-19T00:00:00Z', hoursSinceDecision: 40.5, decisionsCount: 60 },
          { id: 'core',         lastDecisionAt: '2026-05-19T08:00:00Z', hoursSinceDecision: 32.0, decisionsCount: 150 },
        ],
        stalenessThresholdHours: 12,
        totalLiveSleeves: 2,
      },
      expected: {},
      pauseScope: 'none',
      detectedAt: new Date().toISOString(),
    };
    const block = formatSystemAuditPromptBlock(report([violation]));
    expect(block).toMatch(/INV-7 sleeve liveness/);
    expect(block).toMatch(/2 live sleeve\(s\) silent >12h/);
    expect(block).toMatch(/alpha-hunter 40\.5h/);
    expect(block).toMatch(/core 32\.0h/);
    expect(block).toMatch(/stranded its slice of capital/);
  });

  it('uses singular form when only one sleeve is silent', () => {
    const violation: Violation = {
      invariantId: 'INV-7',
      invariantName: 'sleeve-liveness',
      severity: 'WARN',
      message: 'whatever',
      observed: {
        silent: [{ id: 'alpha-hunter', lastDecisionAt: 'x', hoursSinceDecision: 15.2, decisionsCount: 30 }],
        stalenessThresholdHours: 12,
        totalLiveSleeves: 1,
      },
      expected: {},
      pauseScope: 'none',
      detectedAt: new Date().toISOString(),
    };
    const block = formatSystemAuditPromptBlock(report([violation]));
    expect(block).toMatch(/alpha-hunter 15\.2h/);
  });
});

describe('formatSystemAuditPromptBlock — INV-4 observation consumer specialization', () => {
  it('names the offending sources with invalid + empty counts', () => {
    const violation: Violation = {
      invariantId: 'INV-4',
      invariantName: 'observation-consumer',
      severity: 'WARN',
      message: 'whatever (overwritten by specialization)',
      observed: {
        totalObservations: 5,
        invalidCount: 2,
        emptyCount: 1,
        emptyRatio: 20,
        perSource: [
          { source: 'stc-website', total: 3, invalid: 2, empty: 1 },
          { source: 'alpha-watcher', total: 2, invalid: 0, empty: 0 },
        ],
      },
      expected: {},
      pauseScope: 'none',
      detectedAt: new Date().toISOString(),
    };
    const block = formatSystemAuditPromptBlock(report([violation]));
    expect(block).toMatch(/INV-4 observation consumer/);
    expect(block).toMatch(/2 schema-invalid \+ 1 empty of 5 observations/);
    expect(block).toMatch(/stc-website \(invalid=2, empty=1, total=3\)/);
    expect(block).toMatch(/fix the source before letting the prompt inherit garbage/);
  });

  it('omits clean sources from the offenders breakdown', () => {
    const violation: Violation = {
      invariantId: 'INV-4',
      invariantName: 'observation-consumer',
      severity: 'WARN',
      message: 'whatever',
      observed: {
        totalObservations: 4,
        invalidCount: 1,
        emptyCount: 0,
        emptyRatio: 0,
        perSource: [
          { source: 'stc-website', total: 1, invalid: 1, empty: 0 },
          { source: 'alpha-watcher', total: 3, invalid: 0, empty: 0 },
        ],
      },
      expected: {},
      pauseScope: 'none',
      detectedAt: new Date().toISOString(),
    };
    const block = formatSystemAuditPromptBlock(report([violation]));
    expect(block).toMatch(/stc-website/);
    expect(block).not.toMatch(/alpha-watcher/);
  });
});

describe('formatSystemAuditPromptBlock — INV-8 cycle-vs-trade ratio specialization', () => {
  it('names cycle count, approx hours, and trade count', () => {
    const violation: Violation = {
      invariantId: 'INV-8',
      invariantName: 'cycle-trade-ratio',
      severity: 'WARN',
      message: 'whatever (overwritten)',
      observed: {
        cycle: 24,
        tradesSinceRestart: 0,
        bootGraceCycles: 8,
        approxHoursSilent: 6,
      },
      expected: {},
      pauseScope: 'none',
      detectedAt: new Date().toISOString(),
    };
    const block = formatSystemAuditPromptBlock(report([violation]));
    expect(block).toMatch(/INV-8 cycle-vs-trade ratio/);
    expect(block).toMatch(/24 heavy cycles/);
    expect(block).toMatch(/~6\.0h/);
    expect(block).toMatch(/0 trades executed/);
    expect(block).toMatch(/permanent HOLD lock-in/);
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

  it('emits a generic fallback for future WARN invariants that lack a specialization', () => {
    const otherWarn: Violation = {
      invariantId: 'INV-99',
      invariantName: 'placeholder-future-warn',
      severity: 'WARN',
      message: 'placeholder message body',
      observed: {},
      expected: {},
      pauseScope: 'none',
      detectedAt: new Date().toISOString(),
    };
    const block = formatSystemAuditPromptBlock(report([otherWarn]));
    expect(block).toMatch(/INV-99 placeholder-future-warn — placeholder message body/);
  });
});
