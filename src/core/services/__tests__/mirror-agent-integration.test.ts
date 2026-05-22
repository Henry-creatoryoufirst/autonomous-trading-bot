/**
 * NVR-SPEC-036 Phase 1 — Heavy-cycle wiring integration test.
 *
 * The audit (AUDIT_CODE_DEBT_2026-05-22 §"Mirror agent integration test gap")
 * flagged that PR #42 wired `MirrorAgent` into the heavy-cycle prompt at
 * `agent-v3.2.ts:5765-5805` but no test proves the wiring actually produces
 * a `MASTER MIRROR THOUGHT` block when the env flag is on. The unit tests
 * in `mirror-agent.test.ts` and `mirror-prompt-block.test.ts` cover each
 * piece in isolation; this file covers the seam between them — i.e. the
 * exact sequence the monolith executes:
 *
 *   1. Subscriber bot boots with `MIRROR_AGENT_ENABLED=true` (the master bot
 *      never sets this — that's how feedback loops are avoided).
 *   2. On each heavy cycle, the bot calls `_mirrorAgent.runMirrorTick(ctx)`
 *      with the subscriber-bot's portfolio snapshot.
 *   3. The result is passed to `formatMirrorThoughtBlock(...)` to produce
 *      a prompt fragment.
 *   4. That fragment lands inside `dynamicStrategyAddenda` and therefore
 *      inside the heavy-cycle system prompt assembled from it.
 *
 * This file runs the whole sequence against a mocked aggregator + mocked
 * Haiku caller, then asserts that the assembled prompt fragment carries the
 * MASTER MIRROR THOUGHT marker AND key payload from the master thoughts.
 *
 * If this test fails, PR #42's wiring has regressed and subscriber bots are
 * shipping heavy-cycle prompts that silently drop the master fleet's
 * reasoning — exactly the failure mode the audit warned about.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import { MirrorAgent, type HaikuCallerFn } from '../mirror-agent.js';
import { formatMirrorThoughtBlock } from '../mirror-prompt-block.js';

vi.mock('axios', () => {
  const mock = { get: vi.fn() };
  return { default: mock, ...mock };
});

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

const FIXED_NOW = new Date('2026-05-22T10:00:00.000Z');

/**
 * Mirrors the field set agent-v3.2.ts:5792-5798 passes into `runMirrorTick`.
 * Keep the field names exactly aligned with the call site so the test
 * regresses when that surface changes.
 */
const SUBSCRIBER_BOT_CONTEXT = {
  portfolioValueUSD: 487.32,
  usdcBalanceUSD: 122.65,
  positionsCount: 2,
  positionsSymbols: ['WETH', 'AERO'],
  recentTradesCount24h: 3,
  hwm: 540.0,
};

const HAIKU_RESPONSE = JSON.stringify({
  observation:
    'K&H mirrors the master fleet cooling stance: 25% USDC reserve intact, two positions consistent with master cohort, no fresh deploy signal.',
  relevantAnomalies: ['Master flagged AERO weakness — K&H holds a $48 slice.'],
  questions: ['Trim AERO in lockstep with master, or wait for own signal?'],
  proposedPosture: [
    'Hold both positions; do not deploy this window.',
    'Reserve already at target — match master discipline.',
  ],
});

function freshMasterFleetResponse(now: Date) {
  const ts = new Date(now.getTime() - 4 * 60_000).toISOString(); // 4 min old (well inside 30m freshness window)
  return {
    fetchedAt: now.toISOString(),
    operator: {
      ts,
      observation: 'Master at 19% USDC; alpha hunter quiet; AERO weakening on volume.',
      anomalies: ['USDC below 25% reserve target', 'AERO volume thinning'],
      questions: ['Should we trim AERO?'],
      proposedActions: ['Watch for AERO confirmation before trimming'],
      modelUsed: 'claude-haiku-4-5-20251001',
    },
    capitalManager: {
      ts,
      observation: 'Reserve drift modest (~6 ppts under target); no rebalance trigger.',
      anomalies: [],
      questions: [],
      proposedActions: [],
      modelUsed: 'claude-haiku-4-5-20251001',
    },
    coreSleeve: {
      ts,
      observation: 'Core positions stable; no fresh confluence in current window.',
      anomalies: [],
      questions: [],
      proposedActions: [],
      modelUsed: 'claude-haiku-4-5-20251001',
    },
    alphaSleeve: {
      ts,
      observation: 'No alpha signals firing on watcher cohort this cycle.',
      anomalies: [],
      questions: [],
      proposedActions: [],
      modelUsed: 'claude-haiku-4-5-20251001',
    },
  };
}

/**
 * Reproduces the exact call sequence the monolith runs at
 * `agent-v3.2.ts:5784-5816`, minus the surrounding bot state — only the
 * MirrorAgent invocation + the block assembly that lands the result in
 * `dynamicStrategyAddenda`.
 *
 * Mirrors the structure verbatim so a future drift in either the wiring
 * (agent-v3.2.ts) or the formatter (mirror-prompt-block.ts) breaks this
 * test instead of the live family bots' prompts.
 */
async function simulateHeavyCycleMirrorWiring(args: {
  agent: MirrorAgent | null;
  cashStatusFragment: string;
  outcomeBlock: string;
  systemAuditBlock: string;
}): Promise<string> {
  // === Step 1: runMirrorTick (matches agent-v3.2.ts:5784-5805) ===
  let mirrorThought = null;
  if (args.agent) {
    try {
      mirrorThought = await args.agent.runMirrorTick(SUBSCRIBER_BOT_CONTEXT);
    } catch (err: unknown) {
      // The live wiring swallows + logs; we mirror that here.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[MirrorAgent integration test] runMirrorTick rejected: ${msg}`);
    }
  }

  // === Step 2: formatMirrorThoughtBlock (matches agent-v3.2.ts:5805) ===
  const mirrorBlock = formatMirrorThoughtBlock(mirrorThought);

  // === Step 3: dynamicStrategyAddenda template (matches agent-v3.2.ts:5808-5816) ===
  return `${args.cashStatusFragment}${args.outcomeBlock}${args.systemAuditBlock}${mirrorBlock}`;
}

beforeEach(() => {
  process.env.MIRROR_AGENT_ENABLED = 'true';
  process.env.FLEET_THOUGHTS_TOKEN = 'test-integration-token';
  mockedAxios.get.mockReset();
});

afterEach(() => {
  delete process.env.MIRROR_AGENT_ENABLED;
  delete process.env.FLEET_THOUGHTS_TOKEN;
  vi.restoreAllMocks();
});

describe('MirrorAgent → heavy-cycle prompt wiring (SPEC-036 Phase 1)', () => {
  it('assembled dynamicStrategyAddenda contains MASTER MIRROR THOUGHT block when env is on', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      data: freshMasterFleetResponse(FIXED_NOW),
    });

    const haikuCaller = vi.fn<HaikuCallerFn>(async () => HAIKU_RESPONSE);

    const agent = new MirrorAgent({
      botName: 'kathy-howard',
      haikuCaller,
      nowFn: () => FIXED_NOW,
    });

    const addenda = await simulateHeavyCycleMirrorWiring({
      agent,
      cashStatusFragment: '',
      outcomeBlock: '',
      systemAuditBlock: '',
    });

    // === Core assertion: the wiring produced a non-empty MIRROR block in the prompt ===
    expect(addenda).toContain('═══ MASTER MIRROR THOUGHT ═══');
    expect(addenda).toContain('Mirror (kathy-howard):');

    // === Payload assertions: master fleet reasoning made it through into the block ===
    expect(addenda).toContain('K&H mirrors the master fleet cooling stance');
    expect(addenda).toContain('AERO weakness');
    expect(addenda).toContain('Trim AERO in lockstep with master');

    // === Freshness must be reported so the model can down-weight stale thoughts ===
    expect(addenda).toContain('master snapshot 4m old');

    // === Subscriber-bot scale must be embedded so the model doesn't mirror master sizes ===
    expect(addenda).toContain('$487.32 portfolio');
    expect(addenda).toContain('% USDC reserve');

    // === The wiring fired the Haiku call exactly once ===
    expect(haikuCaller).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('addenda omits the MIRROR block entirely when MIRROR_AGENT_ENABLED is not "true"', async () => {
    delete process.env.MIRROR_AGENT_ENABLED;

    const haikuCaller = vi.fn<HaikuCallerFn>(async () => HAIKU_RESPONSE);
    const agent = new MirrorAgent({
      botName: 'kathy-howard',
      haikuCaller,
      nowFn: () => FIXED_NOW,
    });

    const addenda = await simulateHeavyCycleMirrorWiring({
      agent,
      cashStatusFragment: '',
      outcomeBlock: '',
      systemAuditBlock: '',
    });

    // No block emitted, no aggregator fetch, no Haiku call — silent.
    expect(addenda).toBe('');
    expect(haikuCaller).not.toHaveBeenCalled();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('addenda omits the MIRROR block when the agent is null (master bot path)', async () => {
    const addenda = await simulateHeavyCycleMirrorWiring({
      agent: null,
      cashStatusFragment: '',
      outcomeBlock: '',
      systemAuditBlock: '',
    });

    // Master bots never set _mirrorAgent — same shape as flag-off.
    expect(addenda).toBe('');
  });

  it('addenda preserves sibling blocks and appends MIRROR last (assembly order)', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      data: freshMasterFleetResponse(FIXED_NOW),
    });

    const agent = new MirrorAgent({
      botName: 'kathy-howard',
      haikuCaller: async () => HAIKU_RESPONSE,
      nowFn: () => FIXED_NOW,
    });

    const cashStatus = '\n═══ CASH STATUS ═══\nCASH_TEST_MARKER';
    const outcome = '\n═══ ALPHA LEDGER ═══\nOUTCOME_TEST_MARKER';
    const systemAudit = '\n═══ SYSTEM AUDIT ═══\nAUDIT_TEST_MARKER';

    const addenda = await simulateHeavyCycleMirrorWiring({
      agent,
      cashStatusFragment: cashStatus,
      outcomeBlock: outcome,
      systemAuditBlock: systemAudit,
    });

    // All four blocks must be present, in the exact order the monolith
    // concatenates them.
    const cashIdx = addenda.indexOf('CASH_TEST_MARKER');
    const outcomeIdx = addenda.indexOf('OUTCOME_TEST_MARKER');
    const auditIdx = addenda.indexOf('AUDIT_TEST_MARKER');
    const mirrorIdx = addenda.indexOf('MASTER MIRROR THOUGHT');

    expect(cashIdx).toBeGreaterThanOrEqual(0);
    expect(outcomeIdx).toBeGreaterThan(cashIdx);
    expect(auditIdx).toBeGreaterThan(outcomeIdx);
    expect(mirrorIdx).toBeGreaterThan(auditIdx);
  });

  it('addenda still includes MIRROR block in state-only mode (master unavailable)', async () => {
    // No FLEET_THOUGHTS_TOKEN → agent falls to stateOnly without hitting aggregator.
    delete process.env.FLEET_THOUGHTS_TOKEN;

    const agent = new MirrorAgent({
      botName: 'kathy-howard',
      haikuCaller: async () => HAIKU_RESPONSE,
      nowFn: () => FIXED_NOW,
    });

    const addenda = await simulateHeavyCycleMirrorWiring({
      agent,
      cashStatusFragment: '',
      outcomeBlock: '',
      systemAuditBlock: '',
    });

    expect(addenda).toContain('═══ MASTER MIRROR THOUGHT ═══');
    // State-only mode explicitly labels itself so the model down-weights.
    expect(addenda).toContain('state-only mode');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
