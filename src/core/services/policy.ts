/**
 * NVR-SPEC-018 Brain+Hands — Policy layer
 *
 * Daily strategic policy produced by NVR-REGIME (Claude Sonnet, once per day)
 * and consumed by NVR-TRADER (DeepSeek V3.2, every cycle) via prompt injection.
 *
 * The policy captures Henry-facing strategy decisions that would otherwise
 * require per-cycle Sonnet intelligence:
 *   - sleeve weights (Core vs Alpha vs future sleeves)
 *   - dry-powder floor (the 25% USDC hard rule — can be tightened but not loosened)
 *   - aggression tier (AGGRESSIVE / NEUTRAL / DEFENSIVE)
 *   - max single position %
 *   - stale-exit horizon
 *   - narrative guidance (free-text one-liner, e.g. "BTC trending sideways, prefer
 *     DeFi alpha over meme hunt")
 *   - hard guards (yes/no guards injected into OSS system prompt verbatim)
 *
 * Persistence: written to `<PERSIST_DIR>/policy.json` by NVR-REGIME. If the file
 * is missing or older than MAX_POLICY_AGE_HOURS, callers fall back to the
 * built-in DEFAULT_POLICY. A stale-but-present policy still wins over the
 * default (stale file implies REGIME ran recently-ish).
 */

import * as fs from 'fs';
import * as path from 'path';

export type AggressionTier = 'AGGRESSIVE' | 'NEUTRAL' | 'DEFENSIVE';

export interface Policy {
  /** ISO timestamp when NVR-REGIME produced this policy. */
  generatedAt: string;
  /** Which agent wrote it — currently always "NVR-REGIME" but could be "manual" etc. */
  generatedBy: string;
  /** Sleeve weights. Must sum to 1.0 (bot clamps if not). */
  sleeveWeights: Record<string, number>;
  /** The 25% USDC alpha-strike reserve — can be raised, not lowered. */
  usdcFloorPct: number;
  /** Overall aggression tier shaping position-size envelopes. */
  aggressionTier: AggressionTier;
  /** Max single position as fraction of portfolio (hard cap on per-token exposure). */
  maxSinglePositionPct: number;
  /** Seconds of hold-time after which a flat/weak position is stale-exit eligible. */
  staleExitSec: number;
  /** One-liner Henry-voice guidance injected into OSS prompt. */
  narrativeGuidance: string;
  /** Hard NO/YES guards appended verbatim to OSS system prompt. */
  hardGuards: string[];
}

/**
 * Safe defaults. These mirror the current v21.12+ hardcoded behavior so the bot
 * behaves identically to today when no policy.json has been written yet. Keep
 * this block in sync with `project_nvr_strategy_shape` and SPEC-015.
 */
export const DEFAULT_POLICY: Policy = {
  generatedAt: '1970-01-01T00:00:00Z',
  generatedBy: 'default',
  sleeveWeights: { core: 1.0 },
  usdcFloorPct: 0.25,
  aggressionTier: 'NEUTRAL',
  maxSinglePositionPct: 0.15,
  staleExitSec: 172800, // 48h
  narrativeGuidance: 'No active policy from NVR-REGIME — follow baseline strategy.',
  hardGuards: [],
};

/** How stale a policy file can be before we fall back to the default. */
const MAX_POLICY_AGE_HOURS = 48;

function policyFilePath(): string {
  const dir = process.env.PERSIST_DIR || '/data';
  return path.join(dir, 'policy.json');
}

let _cache: { policy: Policy; readAt: number } | null = null;
const CACHE_TTL_MS = 60_000; // re-read at most once per minute

/**
 * Load the current policy from disk. Returns DEFAULT_POLICY if the file is
 * missing, unparseable, or older than MAX_POLICY_AGE_HOURS.
 */
export function loadPolicy(): Policy {
  if (_cache && (Date.now() - _cache.readAt) < CACHE_TTL_MS) {
    return _cache.policy;
  }

  const file = policyFilePath();
  if (!fs.existsSync(file)) {
    _cache = { policy: DEFAULT_POLICY, readAt: Date.now() };
    return DEFAULT_POLICY;
  }

  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as Policy;

    // Age check — stale beyond threshold reverts to default so a dead REGIME
    // cron doesn't leave the bot running on week-old policy.
    const ageMs = Date.now() - new Date(parsed.generatedAt).getTime();
    if (ageMs > MAX_POLICY_AGE_HOURS * 3600 * 1000) {
      console.warn(`[POLICY] policy.json is ${(ageMs / 3600000).toFixed(1)}h stale — using defaults`);
      _cache = { policy: DEFAULT_POLICY, readAt: Date.now() };
      return DEFAULT_POLICY;
    }

    _cache = { policy: parsed, readAt: Date.now() };
    return parsed;
  } catch (err: any) {
    console.warn(`[POLICY] Failed to load policy.json (${err.message}) — using defaults`);
    _cache = { policy: DEFAULT_POLICY, readAt: Date.now() };
    return DEFAULT_POLICY;
  }
}

/**
 * Write a new policy to disk. Intended for NVR-REGIME (and manual overrides).
 * Atomic write via tmp file + rename so concurrent readers never see a partial file.
 */
export function writePolicy(policy: Policy): void {
  const file = policyFilePath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(policy, null, 2));
  fs.renameSync(tmp, file);
  _cache = { policy, readAt: Date.now() };
}

/** Force a re-read on next loadPolicy() call. */
export function invalidatePolicyCache(): void {
  _cache = null;
}

/**
 * Render the policy as a compact prompt block, ready to inject into the
 * OSS trader's system prompt. Kept stable so the block can be cached across
 * consecutive cycles (policy changes at most once per day).
 */
export function renderPolicyPromptBlock(policy: Policy): string {
  const sleeves = Object.entries(policy.sleeveWeights)
    .map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`)
    .join(', ');

  const guardsBlock = policy.hardGuards.length > 0
    ? `\nHARD GUARDS (non-negotiable):\n${policy.hardGuards.map(g => `  - ${g}`).join('\n')}`
    : '';

  return `═══ TODAY'S POLICY (from NVR-REGIME, generated ${policy.generatedAt}) ═══
Sleeves: ${sleeves}
USDC floor: ${(policy.usdcFloorPct * 100).toFixed(0)}% (hard — do not breach)
Aggression: ${policy.aggressionTier}
Max single position: ${(policy.maxSinglePositionPct * 100).toFixed(0)}% of portfolio
Stale-exit horizon: ${Math.round(policy.staleExitSec / 3600)}h
Narrative: ${policy.narrativeGuidance}${guardsBlock}`;
}
