#!/usr/bin/env npx tsx
/**
 * NVR Capital — Self-Healing Intelligence Simulation Harness
 *
 * Injects synthetic incidents of every type into a running SHI instance,
 * using mock BotInterface + mock Telegram so no real money or state is touched.
 * Produces a scorecard showing:
 *   - How many incidents were resolved vs. escalated
 *   - Which playbook actions Claude/cheap-models picked for each type
 *   - Average time-to-heal and diagnosis latency
 *   - Which model tier handled each diagnosis (Cerebras/Groq/Ollama/Claude)
 *
 * Usage:
 *   npx tsx scripts/simulate-shi.ts              # Runs 1 of each incident type
 *   npx tsx scripts/simulate-shi.ts --repeat 5   # Runs 5 of each (40 total)
 *   npx tsx scripts/simulate-shi.ts --json       # Machine-readable output
 *
 * If no model API keys are set, the diagnosis engine falls back to a safe
 * NOTIFY_ONLY response — useful for validating the pipeline without calling
 * external models.
 */

import { SelfHealingIntelligence } from '../src/core/services/self-healing/index.js';
import type {
  BotInterface,
  IncidentType,
  HealingOutcome,
} from '../src/core/services/self-healing/index.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// MOCK BOT INTERFACE — captures every healing action without touching real state
// ============================================================================

interface MockAction {
  method: string;
  args: unknown[];
  timestamp: number;
}

function createMockBot(): BotInterface & { actions: MockAction[] } {
  const actions: MockAction[] = [];
  const record = (method: string, args: unknown[]) =>
    actions.push({ method, args, timestamp: Date.now() });

  return {
    actions,
    // Read methods — return sensible fake data
    getCycleNumber:     () => 1234,
    getPortfolioValue:  () => 2500,
    getTradeHistory:    (limit) => Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
      token:     ['WETH', 'cbBTC', 'AERO', 'VIRTUAL'][i % 4],
      action:    i % 3 === 0 ? 'SELL' : 'BUY',
      success:   i % 2 === 0,
      pnlUSD:    (i % 2 === 0 ? 12.5 : -8.3) * (i + 1),
      timestamp: new Date(Date.now() - i * 600_000).toISOString(),
    })),
    getErrorLog:        () => [],
    getMarketRegime:    () => 'RANGING',
    getActivePositions: () => [
      { symbol: 'WETH', usdValue: 1200, unrealizedPct: 3.2 },
      { symbol: 'cbBTC', usdValue: 800, unrealizedPct: -1.4 },
      { symbol: 'AERO', usdValue: 500, unrealizedPct: 8.1 },
    ],
    getCircuitBreakerState: () => ({ active: false, reason: null, triggeredAt: null }),

    // Healing actions — just record the call, don't actually do anything
    addTokenCooldown:              (symbol, durationMs) => record('addTokenCooldown', [symbol, durationMs]),
    invalidatePriceCache:          (symbol) => record('invalidatePriceCache', [symbol]),
    setPositionSizeMultiplier:     (m) => record('setPositionSizeMultiplier', [m]),
    setConfluenceThresholdOverride:(d) => record('setConfluenceThresholdOverride', [d]),
    resetCircuitBreaker:           () => record('resetCircuitBreaker', []),
    extendCircuitBreaker:          (h) => record('extendCircuitBreaker', [h]),
    markStateDirty:                () => record('markStateDirty', []),
  };
}

// ============================================================================
// MOCK TELEGRAM — captures alerts + summaries without hitting the Telegram API
// ============================================================================

interface MockTelegramMessage {
  severity: string;
  title: string;
  message: string;
  timestamp: number;
}

function createMockTelegram(): { messages: MockTelegramMessage[]; sendAlert: (a: { severity: string; title: string; message: string }) => Promise<boolean> } {
  const messages: MockTelegramMessage[] = [];
  return {
    messages,
    sendAlert: async (alert) => {
      messages.push({ ...alert, timestamp: Date.now() });
      return true;
    },
  };
}

// ============================================================================
// INCIDENT SCENARIOS — one realistic example per type
// ============================================================================

interface IncidentScenario {
  type: IncidentType;
  label: string;
  context: Record<string, unknown>;
}

const SCENARIOS: IncidentScenario[] = [
  {
    type:    'TRADE_FAILURE',
    label:   'Swap reverted on Aerodrome (insufficient liquidity)',
    context: { token: 'VIRTUAL', action: 'BUY', error: 'Execution reverted: INSUFFICIENT_LIQUIDITY', consecutive: 1 },
  },
  {
    type:    'API_TIMEOUT',
    label:   'GeckoTerminal timed out fetching indicators',
    context: { api: 'gecko-terminal', endpoint: '/ohlcv', timeoutMs: 10000 },
  },
  {
    type:    'CIRCUIT_BREAKER',
    label:   'Circuit breaker triggered after 3 consecutive losses',
    context: { reason: '3 consecutive losing trades', portfolioValue: 2500 },
  },
  {
    type:    'STUCK_CYCLE',
    label:   'Trading cycle hung past timeout (361s)',
    context: { stuckSec: '361', cycleNumber: 1234 },
  },
  {
    type:    'BALANCE_ANOMALY',
    label:   'Unexpected 8% balance drop with no matching trade',
    context: { symbol: 'WETH', expected: 0.42, actual: 0.386, diffPct: -8.1 },
  },
  {
    type:    'PRICE_FEED_FAILURE',
    label:   'No price data for cbBTC across 3 consecutive cycles',
    context: { token: 'cbBTC', missingFromCycles: 3, lastKnownPrice: null },
  },
  {
    type:    'CONSECUTIVE_FAILURES',
    label:   '3 failed sells for AERO in a row',
    context: { token: 'AERO', consecutiveFailures: 3, lastError: 'Pool paused', action: 'SELL' },
  },
  {
    type:    'LARGE_DRAWDOWN',
    label:   'Portfolio dropped 6.8% in one cycle (no phantom)',
    context: { dropPercent: 6.8, prevValue: 2680, newValue: 2498, cycleNumber: 1234 },
  },
];

// ============================================================================
// REPORT TYPES
// ============================================================================

interface TrialResult {
  scenario: IncidentScenario;
  outcome: HealingOutcome | null;
  actionsCaptured: MockAction[];
  telegramCaptured: MockTelegramMessage[];
  durationMs: number;
  error?: string;
}

// ============================================================================
// REPORT PRINTING
// ============================================================================

function printReport(trials: TrialResult[], jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(
      trials.map((t) => ({
        type:            t.scenario.type,
        label:           t.scenario.label,
        resolved:        t.outcome?.resolved ?? false,
        confidence:      t.outcome?.diagnosis?.confidence ?? null,
        rootCause:       t.outcome?.diagnosis?.rootCause ?? null,
        actionsPicked:   t.outcome?.actionsExecuted.map((a) => a.action) ?? [],
        modelUsed:       t.outcome?.diagnosis?.modelUsed ?? null,
        diagnosisMs:     t.outcome?.diagnosis?.latencyMs ?? null,
        totalMs:         t.durationMs,
        notificationSent:t.outcome?.notificationSent ?? false,
        error:           t.error ?? null,
      })),
      null, 2,
    ));
    return;
  }

  console.log('\n' + '═'.repeat(78));
  console.log('  Self-Healing Intelligence — Simulation Scorecard');
  console.log('═'.repeat(78));

  // Aggregate stats
  const total = trials.length;
  const resolved = trials.filter((t) => t.outcome?.resolved).length;
  const escalated = trials.filter((t) => !t.outcome?.resolved).length;
  const avgDiagMs = Math.round(
    trials
      .filter((t) => t.outcome?.diagnosis)
      .reduce((s, t) => s + (t.outcome?.diagnosis?.latencyMs ?? 0), 0) /
    Math.max(1, trials.filter((t) => t.outcome?.diagnosis).length)
  );
  const avgTotalMs = Math.round(trials.reduce((s, t) => s + t.durationMs, 0) / total);

  console.log(`\n  Total incidents:     ${total}`);
  console.log(`  Resolved:            ${resolved} (${((resolved / total) * 100).toFixed(1)}%)`);
  console.log(`  Escalated:           ${escalated}`);
  console.log(`  Avg diagnosis time:  ${avgDiagMs}ms`);
  console.log(`  Avg total heal time: ${avgTotalMs}ms`);

  // Model tier distribution
  const modelsUsed = new Map<string, number>();
  for (const t of trials) {
    const m = t.outcome?.diagnosis?.modelUsed ?? 'fallback';
    modelsUsed.set(m, (modelsUsed.get(m) ?? 0) + 1);
  }
  console.log(`\n  Model tier distribution:`);
  for (const [model, count] of modelsUsed.entries()) {
    console.log(`    ${model.padEnd(30)} ${count}`);
  }

  // Per-scenario details
  console.log('\n' + '─'.repeat(78));
  console.log('  Per-Incident Details');
  console.log('─'.repeat(78));
  for (const t of trials) {
    const icon = t.outcome?.resolved ? '✅' : t.error ? '💥' : '⚠️';
    console.log(`\n  ${icon} ${t.scenario.type.padEnd(22)} ${t.scenario.label}`);
    if (t.error) {
      console.log(`     Error: ${t.error}`);
      continue;
    }
    const d = t.outcome?.diagnosis;
    if (d) {
      console.log(`     Diagnosed by:  ${d.modelUsed} (${d.latencyMs}ms, confidence=${d.confidence})`);
      console.log(`     Root cause:    ${d.rootCause.slice(0, 100)}`);
      console.log(`     Actions:       ${t.outcome?.actionsExecuted.map((a) => `${a.action}${a.success ? '✓' : '✗'}`).join(', ') || '(none)'}`);
    } else {
      console.log(`     (No diagnosis — fallback path)`);
    }
  }
  console.log('\n' + '═'.repeat(78));
  console.log();
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const jsonMode = argv.includes('--json');
  const repeatIdx = argv.indexOf('--repeat');
  const repeat = repeatIdx >= 0 ? parseInt(argv[repeatIdx + 1] ?? '1', 10) : 1;

  // Isolated persist dir so this doesn't pollute real logs
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shi-sim-'));

  const bot = createMockBot();
  const telegram = createMockTelegram();

  const shi = new SelfHealingIntelligence({
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    persistDir:      tmpDir,
    bot,
    telegramService: telegram,
    enabled:         true,
  });

  if (!jsonMode) {
    console.log(`\n  SHI Simulation starting...`);
    console.log(`  Persist dir: ${tmpDir}`);
    console.log(`  Scenarios: ${SCENARIOS.length} × ${repeat} = ${SCENARIOS.length * repeat}`);
    console.log(`  Model backends: Cerebras=${!!process.env.CEREBRAS_API_KEY}, Groq=${!!process.env.GROQ_API_KEY}, Ollama=${!!process.env.OLLAMA_ENABLED}, Claude=${!!process.env.ANTHROPIC_API_KEY}`);
  }

  const trials: TrialResult[] = [];

  for (let rep = 0; rep < repeat; rep++) {
    for (const scenario of SCENARIOS) {
      const actionsBefore = bot.actions.length;
      const messagesBefore = telegram.messages.length;
      const startedAt = Date.now();

      try {
        await shi.processIncident(scenario.type, scenario.context);

        // SHI dedups by type within 2min — give a small gap between runs of same type
        await new Promise((r) => setTimeout(r, 50));

        // Find the outcome for this incident (latest matching type)
        const recent = shi.getRecentOutcomes(SCENARIOS.length * repeat);
        const outcome = recent.find((o) => o.incident.type === scenario.type) ?? null;

        trials.push({
          scenario,
          outcome,
          actionsCaptured: bot.actions.slice(actionsBefore),
          telegramCaptured: telegram.messages.slice(messagesBefore),
          durationMs: Date.now() - startedAt,
        });

        if (!jsonMode) {
          const icon = outcome?.resolved ? '✅' : '⚠️';
          process.stdout.write(`  ${icon} ${scenario.type}`.padEnd(30));
          process.stdout.write(`(${Date.now() - startedAt}ms)\n`);
        }

      } catch (err: unknown) {
        trials.push({
          scenario,
          outcome: null,
          actionsCaptured: [],
          telegramCaptured: [],
          durationMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        });
        if (!jsonMode) {
          console.log(`  💥 ${scenario.type} threw: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Wait past the 2min dedup window only if we're about to re-run the same type
      if (rep < repeat - 1) {
        // Force unique by advancing time slightly — but SHI dedup is real-time based,
        // so we'd need to wait 2min. For simulation, just note that repeated runs
        // of same type will dedup. The first run per type is the meaningful one.
      }
    }
  }

  printReport(trials, jsonMode);

  // Cleanup
  try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch {}

  // Exit with non-zero if any scenario errored or resolution rate is very low
  const errorCount = trials.filter((t) => t.error).length;
  const resolvedCount = trials.filter((t) => t.outcome?.resolved).length;
  const resolutionRate = resolvedCount / trials.length;

  if (errorCount > 0 || resolutionRate < 0.5) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Simulation crashed:', err);
  process.exit(2);
});
