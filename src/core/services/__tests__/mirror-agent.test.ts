/**
 * MirrorAgent scaffold tests.
 *
 * Coverage targets (intentionally minimal — this is the scaffold session,
 * deeper coverage lands when the agent is wired into the heavy cycle):
 *   1. Disabled flag → null return, no Haiku call.
 *   2. Aggregator returns fresh master thoughts → mode=mirror, prompt
 *      contains master-fleet sections, parsed thought carries master meta.
 *   3. Aggregator missing token → mode=stateOnly, Haiku still called,
 *      result tagged stateOnly.
 *   4. Master thoughts older than maxStalenessMin → mode=stateOnly even
 *      though aggregator succeeded.
 *   5. Haiku returns malformed JSON → null return, never throws.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import { MirrorAgent, type HaikuCallerFn } from '../mirror-agent.js';

vi.mock('axios', () => {
  const mock = { get: vi.fn() };
  return { default: mock, ...mock };
});

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

function stubFleet(status: number, data: unknown): void {
  mockedAxios.get.mockResolvedValueOnce({ status, data });
}

const FIXED_NOW = new Date('2026-05-11T18:30:00.000Z');

const SAMPLE_BOT_CONTEXT = {
  portfolioValueUSD: 500,
  usdcBalanceUSD: 125,
  positionsCount: 2,
  positionsSymbols: ['ETH', 'AERO'],
  recentTradesCount24h: 4,
  hwm: 540,
};

function freshFleetResponse(now: Date) {
  const ts = new Date(now.getTime() - 5 * 60_000).toISOString(); // 5 min ago
  return {
    fetchedAt: now.toISOString(),
    operator: {
      ts,
      observation: 'Bot drifted to 18% USDC; alpha hunter cooling.',
      anomalies: ['USDC below 25% reserve target'],
      questions: ['Should we trim AERO?'],
      proposedActions: ['Watch for AERO weakness'],
      modelUsed: 'claude-haiku-4-5-20251001',
    },
    capitalManager: {
      ts,
      observation: 'Reserve drift modest; no rebalance needed.',
      anomalies: [],
      questions: [],
      proposedActions: [],
      modelUsed: 'claude-haiku-4-5-20251001',
    },
    coreSleeve: {
      ts,
      observation: 'Core positions stable; no edge in current window.',
      anomalies: [],
      questions: [],
      proposedActions: [],
      modelUsed: 'claude-haiku-4-5-20251001',
    },
    alphaSleeve: {
      ts,
      observation: 'No alpha signals firing on watcher cohort.',
      anomalies: [],
      questions: [],
      proposedActions: [],
      modelUsed: 'claude-haiku-4-5-20251001',
    },
  };
}

const VALID_HAIKU_RESPONSE = JSON.stringify({
  observation:
    'K&H sits at 25% USDC reserve with two positions, mirroring the master fleet posture of caution; AERO is shared with the master flag but K&H holds a smaller slice.',
  relevantAnomalies: ['AERO weakness flagged by Operator may affect K&H holding'],
  questions: ['Does the smaller AERO position warrant the same trim risk?'],
  proposedPosture: [
    'Hold positions; monitor AERO for confirmation of the master flag.',
    'Reserve already at target — no deploy in this window.',
  ],
});

beforeEach(() => {
  process.env.MIRROR_AGENT_ENABLED = 'true';
  process.env.FLEET_THOUGHTS_TOKEN = 'test-token';
  mockedAxios.get.mockReset();
});

afterEach(() => {
  delete process.env.MIRROR_AGENT_ENABLED;
  delete process.env.FLEET_THOUGHTS_TOKEN;
  vi.restoreAllMocks();
});

describe('MirrorAgent', () => {
  it('returns null and does not call Haiku when MIRROR_AGENT_ENABLED is not "true"', async () => {
    delete process.env.MIRROR_AGENT_ENABLED;
    const haikuCaller = vi.fn(async () => VALID_HAIKU_RESPONSE);
    const agent = new MirrorAgent({
      botName: 'kathy-howard',
      haikuCaller: haikuCaller as HaikuCallerFn,
      nowFn: () => FIXED_NOW,
    });

    const result = await agent.runMirrorTick(SAMPLE_BOT_CONTEXT);

    expect(result).toBeNull();
    expect(haikuCaller).not.toHaveBeenCalled();
  });

  it('produces a mirror-mode thought when aggregator returns fresh master thoughts', async () => {
    const fleet = freshFleetResponse(FIXED_NOW);
    stubFleet(200, fleet);

    const haikuCaller = vi.fn<HaikuCallerFn>(async ({ userPrompt }) => {
      // Prompt-shape assertions live here so they're visible in failures.
      expect(userPrompt).toContain('MODE: mirror');
      expect(userPrompt).toContain('OPERATOR');
      expect(userPrompt).toContain('CAPITAL MANAGER');
      expect(userPrompt).toContain('CORE SLEEVE');
      expect(userPrompt).toContain('ALPHA SLEEVE');
      expect(userPrompt).toContain('BOT NAME: kathy-howard');
      expect(userPrompt).toContain('Portfolio value: $500.00');
      return VALID_HAIKU_RESPONSE;
    });

    const agent = new MirrorAgent({
      botName: 'kathy-howard',
      haikuCaller,
      nowFn: () => FIXED_NOW,
    });

    const result = await agent.runMirrorTick(SAMPLE_BOT_CONTEXT);

    expect(result).not.toBeNull();
    expect(result!.mode).toBe('mirror');
    expect(result!.botName).toBe('kathy-howard');
    expect(result!.observation).toContain('K&H');
    expect(result!.relevantAnomalies).toHaveLength(1);
    expect(result!.proposedPosture).toHaveLength(2);
    expect(result!.master.stale).toBe(false);
    expect(result!.master.maxAgeMin).toBe(5);
    expect(result!.botContext.usdcReservePct).toBeCloseTo(0.25, 3);
    expect(result!.botContext.positionsSymbols).toEqual(['ETH', 'AERO']);
    expect(haikuCaller).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    const [, opts] = mockedAxios.get.mock.calls[0];
    expect((opts as { headers: { authorization: string } }).headers.authorization).toBe(
      'Bearer test-token',
    );
  });

  it('falls back to stateOnly mode when FLEET_THOUGHTS_TOKEN is unset', async () => {
    delete process.env.FLEET_THOUGHTS_TOKEN;
    // No axios stub — the agent should not even attempt the fetch.

    const haikuCaller = vi.fn<HaikuCallerFn>(async ({ systemPrompt, userPrompt }) => {
      expect(systemPrompt).toContain('unavailable or too stale');
      expect(userPrompt).toContain('MODE: stateOnly');
      expect(userPrompt).not.toContain('OPERATOR (');
      return VALID_HAIKU_RESPONSE;
    });

    const agent = new MirrorAgent({
      botName: 'kathy-howard',
      haikuCaller,
      nowFn: () => FIXED_NOW,
    });

    const result = await agent.runMirrorTick(SAMPLE_BOT_CONTEXT);

    expect(result).not.toBeNull();
    expect(result!.mode).toBe('stateOnly');
    expect(result!.master.stale).toBe(true);
    expect(haikuCaller).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('falls back to stateOnly when master thoughts are older than maxStalenessMin', async () => {
    const stale = freshFleetResponse(FIXED_NOW);
    // Force every agent's thought to be 45 min old (default threshold is 30).
    const staleTs = new Date(FIXED_NOW.getTime() - 45 * 60_000).toISOString();
    stale.operator!.ts = staleTs;
    stale.capitalManager!.ts = staleTs;
    stale.coreSleeve!.ts = staleTs;
    stale.alphaSleeve!.ts = staleTs;

    stubFleet(200, stale);

    const haikuCaller = vi.fn<HaikuCallerFn>(async ({ userPrompt }) => {
      expect(userPrompt).toContain('MODE: stateOnly');
      return VALID_HAIKU_RESPONSE;
    });

    const agent = new MirrorAgent({
      botName: 'kathy-howard',
      haikuCaller,
      nowFn: () => FIXED_NOW,
    });

    const result = await agent.runMirrorTick(SAMPLE_BOT_CONTEXT);

    expect(result).not.toBeNull();
    expect(result!.mode).toBe('stateOnly');
  });

  it('returns null when Haiku response is malformed (never throws)', async () => {
    stubFleet(200, freshFleetResponse(FIXED_NOW));

    const haikuCaller = vi.fn<HaikuCallerFn>(async () => {
      return 'this is not json at all';
    });

    const agent = new MirrorAgent({
      botName: 'kathy-howard',
      haikuCaller,
      nowFn: () => FIXED_NOW,
    });

    const result = await agent.runMirrorTick(SAMPLE_BOT_CONTEXT);

    expect(result).toBeNull();
  });
});
