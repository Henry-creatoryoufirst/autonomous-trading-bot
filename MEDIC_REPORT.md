# MEDIC REPORT — 2026-04-20T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #8)

## Environment
- Run timestamp: 2026-04-20T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-Qy7bE

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `403 Forbidden`:

```
GET https://autonomous-trading-bot-production.up.railway.app/api/errors
→ 403 Forbidden

GET https://autonomous-trading-bot-production.up.railway.app/api/balances
→ 403 Forbidden

GET https://autonomous-trading-bot-production.up.railway.app/api/health
→ 403 Forbidden
```

GeckoTerminal API also blocked (same egress restriction):
```
GET https://api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1
→ 403 Forbidden
```

## Root Cause

The Claude Code execution sandbox has an **egress proxy** that only allows outbound connections to a fixed allowlist of domains. The Railway deployment domain and third-party APIs are **not on this allowlist**. This is a **persistent infrastructure constraint** — it does NOT indicate a bot failure.

**History of this issue:**
| Run # | Timestamp | Action |
|-------|-----------|--------|
| #1 | 2026-04-14T19:12 UTC | First PATTERN D report filed |
| #2 | 2026-04-15T00:00 UTC | PATTERN D re-confirmed |
| #3 | 2026-04-15T18:38 UTC | PATTERN D update |
| #4 | 2026-04-16T10:18 UTC | PATTERN D update |
| #5 | 2026-04-16T11:20 UTC | PATTERN D update |
| #6 | 2026-04-17T00:00 UTC | PATTERN D update |
| #7 | 2026-04-17T12:00 UTC | PATTERN D update |
| #8 | 2026-04-20T00:00 UTC | This report |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, the bot is clearly active:

- `2026-04-16 10:52 EDT` — on-chain Transfer event indexer for Base mainnet merged
- `2026-04-16 05:15 UTC` — Scout added BENJI to TOKEN_REGISTRY
- `2026-04-16 00:25 UTC` — Auditor tightened BREAKER_DAILY_DD_PCT 8→7 (bear-market)
- `2026-04-16 00:21 UTC` — Scout added SPX to TOKEN_REGISTRY
- `2026-04-15 16:35 UTC` — Auditor lowered KELLY_FRACTION 0.5→0.35 (bear-market)
- `2026-04-15 12:25 UTC` — Auditor lowered VOL_TARGET_DAILY_PCT 2→1.5 (bear-market)

Bot appears active and has been making autonomous bear-market adjustments.

**Note from Run #5:** Bear market trigger confirmed by 3 auditor runs in last 22h. Parameters are heavily tightened (KELLY 0.35, VOL_TARGET 1.5%, BREAKER_DD 7%). Since then (96h gap) these may need review.

## Scout Status

Last token discovery commit: `2026-04-16 05:15 UTC` (approximately **96 hours ago** — OVERDUE, threshold is 48h).

Scout **cannot run** this cycle because GeckoTerminal API also returns 403. WebSearch for token discovery would be partial and unreliable without liquidity/volume data verification from GeckoTerminal.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state
- Whether bear-market parameters set 4+ days ago are still appropriate

## Jobs Status This Run (Run #8)

- **Scout**: BLOCKED — last scout 96h ago (overdue), but GeckoTerminal unreachable
- **Auditor**: SKIPPED — cannot fetch live metrics; all /api/* endpoints return 403

## Recommended Action for Henry

**This is now the 8th consecutive run with the same network restriction. Action required:**

1. **URGENT**: Add `autonomous-trading-bot-production.up.railway.app` to the Claude Code egress allowlist
2. Also add `api.geckoterminal.com` to the allowlist for Scout to function
3. Alternatively, expose a **read-only status webhook** that pushes to a domain already in the allowlist
4. Manually verify bot health at: https://autonomous-trading-bot-production.up.railway.app/health
5. **Scout is overdue (96h)** — manually trigger or allow agent egress to GeckoTerminal

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, persistent environmental constraint, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- Report committed to feature branch per session instructions (no staging branch exists in this checkout)
