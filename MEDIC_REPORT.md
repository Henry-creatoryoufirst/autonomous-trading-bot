# MEDIC REPORT — 2026-04-16T12:30 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #6)

## Environment
- Run timestamp: 2026-04-16T12:30 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-03MJs

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `Host not in allowlist` or `403 Forbidden`:

```
curl -s https://autonomous-trading-bot-production.up.railway.app/api/errors
→ Host not in allowlist

curl -s https://autonomous-trading-bot-production.up.railway.app/api/balances
→ Host not in allowlist
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
| #6 | 2026-04-16T12:30 UTC | This report (same issue) |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, the bot is clearly active and engineering is progressing:

- `2026-04-16 10:54 UTC` — **v21.18 landed on main**: ground-truth cost basis rebuild, eliminating $1.4M phantom P&L bug (#7)
- `2026-04-16 10:52 UTC` — On-chain Transfer event indexer added for Base mainnet (#6)
- `2026-04-16 08:59 UTC` — Staging refactor (Phases 1-8) promoted to production
- `2026-04-16 05:15 UTC` — Scout added BENJI to TOKEN_REGISTRY
- `2026-04-16 00:25 UTC` — Auditor tightened BREAKER_DAILY_DD_PCT 8→7 (bear-market)
- `2026-04-16 00:21 UTC` — Scout added SPX to TOKEN_REGISTRY
- `2026-04-15 16:35 UTC` — Auditor lowered KELLY_FRACTION 0.5→0.35 (bear-market)
- `2026-04-15 12:25 UTC` — Auditor lowered VOL_TARGET_DAILY_PCT 2→1.5 (bear-market)

Bot is alive. The v21.18 phantom P&L fix is a significant positive — cost basis tracking is now ground-truth accurate.

**Run #6 Auditor/Scout Note:**
- Scout SKIPPED — BENJI was added at 05:15 UTC today (within 48h window).
- Auditor SKIPPED — cannot fetch live metrics (API blocked); bear market params already at floor (KELLY=0.35, VOL_TARGET=1.5%, BREAKER_DD=7%). Further tightening without fresh data risks halting all trades.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state

## Recommended Action for Henry

**This is the 5th consecutive run with the same network restriction. Action required:**

1. Add `autonomous-trading-bot-production.up.railway.app` to the Claude Code egress allowlist
2. Also add `api.geckoterminal.com` to the allowlist for Scout to function
3. Alternatively, expose a **read-only status webhook** that pushes to a domain already in the allowlist
4. Manually verify bot health at: https://autonomous-trading-bot-production.up.railway.app/health

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, persistent environmental constraint, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts or token-registry.ts
- No production changes
- Report updated on claude/cool-sagan-03MJs branch per session instructions
