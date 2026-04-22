# MEDIC REPORT — 2026-04-22T03:06 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #16)

## Environment
- Run timestamp: 2026-04-22T03:06 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-7V3wA

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `403 Forbidden`:

```
curl -s https://autonomous-trading-bot-production.up.railway.app/api/errors
→ 403 Forbidden

curl -s https://autonomous-trading-bot-production.up.railway.app/api/balances
→ 403 Forbidden

curl -s https://autonomous-trading-bot-production.up.railway.app/api/health
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
| #8 | 2026-04-17T18:42 UTC | PATTERN D update |
| #9 | 2026-04-17T22:09 UTC | PATTERN D update |
| #10 | 2026-04-19T00:00 UTC | PATTERN D update |
| #11 | 2026-04-19T23:07 UTC | PATTERN D update |
| #12 | 2026-04-20T00:00 UTC | PATTERN D update |
| #13 | 2026-04-20T12:00 UTC | PATTERN D update |
| #14 | 2026-04-20T17:00 UTC | PATTERN D update |
| #15 | 2026-04-21T00:00 UTC | PATTERN D update |
| #16 | 2026-04-22T03:06 UTC | This report (same issue) |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, the repo shows active autonomous development:

- `2026-04-21 16:03 EDT` — v21.19 dashboard-honesty: regime flowing + Core drawdown inherits bot peak
- `2026-04-21 15:32 EDT` — v21.18 SPEC-015 unblock: DRAWDOWN_OVERRIDE bypasses green-market loss gate
- `2026-04-21 15:14 EDT` — v21.17 dashboard-honesty: drawdownPct + regime wired into /api/sleeves/compare
- `2026-04-21 14:52 EDT` — v21.16 Sleeves Phase 2: paper-trade simulation + Alpha Hunter v1 strategy
- `2026-04-21 13:49 EDT` — v21.15 Sleeves Phase 1.2b: multi-sleeve orchestrator + per-sleeve write-back
- `2026-04-20 21:09 UTC` — Scout added GHST (Aavegotchi) to TOKEN_REGISTRY
- `2026-04-20 05:12 UTC` — Scout added AXL (Axelar) to TOKEN_REGISTRY
- `2026-04-19 21:11 UTC` — Scout added ETHY (Ethy AI by Virtuals) to TOKEN_REGISTRY
- `2026-04-19 20:10 UTC` — Scout added LBTC to TOKEN_REGISTRY
- `2026-04-18 22:15 UTC` — Auditor raised stagnation threshold 4h→6h (extreme-fear RANGING)
- `2026-04-16 00:25 UTC` — Auditor tightened BREAKER_DAILY_DD_PCT 8→7 (bear-market)
- `2026-04-15 16:35 UTC` — Auditor lowered KELLY_FRACTION 0.5→0.35 (bear-market)

**main branch is at v21.19** with Sleeves Phase 2 fully wired. Active development continues.

**Risk params active (from constants.ts, not yet verifiable via API):** KELLY 0.35, VOL_TARGET 1.5%, BREAKER_DD 7%.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state

## Jobs Status This Run (Run #16)

- **Medic**: PATTERN D — API unreachable (same persistent constraint). No code changes to agent-v3.2.ts.
- **Scout**: SKIPPED — last scout ran at 2026-04-20T21:09 UTC (~30h ago, within 48h threshold). GHST added in that run.
- **Auditor**: SKIPPED — cannot fetch live metrics (/api/trades, /api/portfolio, /api/patterns, /api/adaptive all blocked by sandbox egress); trigger conditions unverifiable.

## Recommended Action for Henry

**This is the 15th consecutive run with the same network restriction. Action urgently required:**

1. **Add to Claude Code egress allowlist:**
   - `autonomous-trading-bot-production.up.railway.app`
   - `api.geckoterminal.com`
   - `api.dexscreener.com`
2. **Or** expose a read-only status webhook on an already-allowed domain
3. **Manually verify bot health:** https://autonomous-trading-bot-production.up.railway.app/health
4. **Note:** Next scout window opens in ~18h (48h since last GHST scout on Apr 20 21:09 UTC, expires Apr 22 ~21:09 UTC)

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, persistent environmental constraint, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- Report committed to claude/cool-sagan-7V3wA per harness branch requirements
