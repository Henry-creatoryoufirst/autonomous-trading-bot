/**
 * NVR-CRITIC — Day 1 stub
 *
 * The first shipped piece of NVR-SPEC-018 Brain + Hands.
 *
 * Reads the existing outcome-tracker signal-edge data, produces two artifacts:
 *   1. data/critic-reports/YYYY-MM-DD.md   — human-readable nightly audit
 *   2. data/rules-proposal.yaml            — machine-structured delta proposal
 *
 * CRITIC proposes, Henry merges. Nothing is auto-applied. The puzzle stays
 * a puzzle.
 *
 * Invoked manually (`npm run critic`) or via nightly cron once CRITIC_ENABLED=true.
 */

import fs from 'node:fs';
import path from 'node:path';

import { outcomeTracker } from '../src/core/services/outcome-tracker.js';
import type { SignalAccuracy, WalletHitRate } from '../src/core/services/outcome-tracker.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATA_DIR = path.resolve(process.cwd(), 'data');
const REPORTS_DIR = path.join(DATA_DIR, 'critic-reports');
const RULES_PROPOSAL_PATH = path.join(DATA_DIR, 'rules-proposal.yaml');

/** An edge ≥ this % triggers a "strengthen" proposal. */
const STRONG_EDGE_THRESHOLD = 5;

/** An edge ≤ this % triggers a "weaken" proposal. */
const WEAK_EDGE_THRESHOLD = -2;

/** Minimum samples on both sides before we trust an edge number. */
const MIN_SAMPLES_TO_PROPOSE = 10;

// ---------------------------------------------------------------------------
// Proposal shape
// ---------------------------------------------------------------------------

interface Proposal {
  signal: SignalAccuracy['metric'];
  direction: 'strengthen' | 'weaken' | 'hold';
  reason: string;
  evidence: {
    edgePct: number;
    samples: number;
    avgReturnWithSignal: number;
    avgReturnWithoutSignal: number;
  };
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function analyzeSignals(accuracy: SignalAccuracy[]): Proposal[] {
  return accuracy
    .filter((sig) => sig.totalSamples >= MIN_SAMPLES_TO_PROPOSE)
    .map((sig): Proposal => {
      let direction: Proposal['direction'];
      let reason: string;

      if (sig.edge >= STRONG_EDGE_THRESHOLD) {
        direction = 'strengthen';
        reason = `${sig.metric} showed +${sig.edge.toFixed(2)}% edge over 4h (n=${sig.totalSamples}). Consider raising its weight in scoring.`;
      } else if (sig.edge <= WEAK_EDGE_THRESHOLD) {
        direction = 'weaken';
        reason = `${sig.metric} showed ${sig.edge.toFixed(2)}% anti-edge over 4h (n=${sig.totalSamples}). Consider lowering its weight or inverting interpretation.`;
      } else {
        direction = 'hold';
        reason = `${sig.metric} edge ${sig.edge >= 0 ? '+' : ''}${sig.edge.toFixed(2)}% not meaningful (n=${sig.totalSamples}). Hold current weight, keep observing.`;
      }

      return {
        signal: sig.metric,
        direction,
        reason,
        evidence: {
          edgePct: Number(sig.edge.toFixed(3)),
          samples: sig.totalSamples,
          avgReturnWithSignal: Number(sig.avgReturn4h.toFixed(3)),
          avgReturnWithoutSignal: Number(sig.avgReturn4hBaseline.toFixed(3)),
        },
      };
    });
}

function analyzeWallets(wallets: WalletHitRate[]): string[] {
  const findings: string[] = [];

  const withData = wallets.filter((w) => w.totalSignals >= 5);
  if (withData.length === 0) {
    findings.push('No smart wallets yet have ≥5 signals — wallet-level edge analysis skipped.');
    return findings;
  }

  const top = withData.slice(0, 3);
  const bottom = [...withData].sort((a, b) => a.hitRate4h - b.hitRate4h).slice(0, 3);

  findings.push(`**Top smart wallets (4h hit rate):**`);
  for (const w of top) {
    findings.push(`- \`${w.walletId}\` — ${(w.hitRate4h * 100).toFixed(1)}% (${w.hits4h}/${w.totalSignals})`);
  }

  findings.push('');
  findings.push(`**Weakest smart wallets (candidates to drop from follow-list):**`);
  for (const w of bottom) {
    findings.push(`- \`${w.walletId}\` — ${(w.hitRate4h * 100).toFixed(1)}% (${w.hits4h}/${w.totalSignals})`);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Output writers
// ---------------------------------------------------------------------------

function toYaml(proposals: Proposal[]): string {
  const header = [
    '# NVR-CRITIC — Rules Proposal',
    `# Generated: ${new Date().toISOString()}`,
    '# ',
    '# This is a PROPOSAL, not a change. CRITIC never auto-applies.',
    '# Henry reviews, cherry-picks, and merges by editing rules.yaml manually.',
    '# ',
    '# Schema:',
    '#   signal: which metric the proposal targets',
    '#   direction: strengthen | weaken | hold',
    '#   reason: one-line rationale',
    '#   evidence: the numbers behind the call',
    '',
    'proposals:',
  ];

  const body = proposals.map((p) => {
    return [
      `  - signal: ${p.signal}`,
      `    direction: ${p.direction}`,
      `    reason: >-`,
      `      ${p.reason}`,
      `    evidence:`,
      `      edgePct: ${p.evidence.edgePct}`,
      `      samples: ${p.evidence.samples}`,
      `      avgReturnWithSignal: ${p.evidence.avgReturnWithSignal}`,
      `      avgReturnWithoutSignal: ${p.evidence.avgReturnWithoutSignal}`,
    ].join('\n');
  });

  return [...header, ...body, ''].join('\n');
}

function toMarkdown(
  proposals: Proposal[],
  walletFindings: string[],
  totalTracked: number,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const strengthen = proposals.filter((p) => p.direction === 'strengthen');
  const weaken = proposals.filter((p) => p.direction === 'weaken');
  const hold = proposals.filter((p) => p.direction === 'hold');

  return [
    `# NVR-CRITIC Audit — ${today}`,
    '',
    `**Scope:** Alpha Hunter signal edge analysis.`,
    `**Tracked outcomes:** ${totalTracked}.`,
    `**Proposals:** ${strengthen.length} strengthen · ${weaken.length} weaken · ${hold.length} hold.`,
    '',
    '> CRITIC proposes.  Henry merges.  Nothing is auto-applied.',
    '',
    '## Signal-level proposals',
    '',
    ...(proposals.length === 0
      ? [
          '_No signals met the minimum sample threshold (n ≥ ' +
            MIN_SAMPLES_TO_PROPOSE +
            ') yet.  Let the outcome tracker collect more data and re-run._',
          '',
        ]
      : proposals.flatMap((p) => [
          `### ${p.signal} → **${p.direction}**`,
          '',
          p.reason,
          '',
          `- Edge: **${p.evidence.edgePct >= 0 ? '+' : ''}${p.evidence.edgePct}%** over 4h`,
          `- Samples: ${p.evidence.samples}`,
          `- Avg 4h return *with* signal: ${p.evidence.avgReturnWithSignal >= 0 ? '+' : ''}${p.evidence.avgReturnWithSignal}%`,
          `- Avg 4h return *without* signal: ${p.evidence.avgReturnWithoutSignal >= 0 ? '+' : ''}${p.evidence.avgReturnWithoutSignal}%`,
          '',
        ])),
    '## Smart-wallet findings',
    '',
    ...walletFindings,
    '',
    '## Artifacts',
    '',
    `- Machine-readable proposal: \`data/rules-proposal.yaml\``,
    `- This report: \`data/critic-reports/${today}.md\``,
    '',
    '---',
    '',
    `_Generated by \`scripts/critic.ts\` at ${new Date().toISOString()}.  Part of NVR-SPEC-018 Brain + Hands._`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function main(): Promise<void> {
  ensureDir(DATA_DIR);
  ensureDir(REPORTS_DIR);

  outcomeTracker.load();
  const totalTracked = outcomeTracker.getTotalTracked();

  const accuracy = outcomeTracker.getSignalAccuracy();
  const wallets = outcomeTracker.getWalletHitRates();

  const proposals = analyzeSignals(accuracy);
  const walletFindings = analyzeWallets(wallets);

  const today = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(REPORTS_DIR, `${today}.md`);

  fs.writeFileSync(reportPath, toMarkdown(proposals, walletFindings, totalTracked), 'utf8');
  fs.writeFileSync(RULES_PROPOSAL_PATH, toYaml(proposals), 'utf8');

  console.log(`[CRITIC] ✓ Analyzed ${totalTracked} outcomes.`);
  console.log(`[CRITIC] ✓ Wrote ${proposals.length} signal proposal(s) to ${RULES_PROPOSAL_PATH}`);
  console.log(`[CRITIC] ✓ Wrote audit report to ${reportPath}`);

  if (proposals.length === 0 && totalTracked === 0) {
    console.log('[CRITIC] ℹ  No outcomes tracked yet — report will populate as the Alpha Hunter accumulates data.');
  }
}

main().catch((err) => {
  console.error('[CRITIC] Failed:', err);
  process.exit(1);
});
