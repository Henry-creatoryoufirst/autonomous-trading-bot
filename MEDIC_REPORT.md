# MEDIC REPORT — 2026-04-15T05:16 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health

## Environment
- Run timestamp: 2026-04-15T05:16 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-8JB3P (staging equivalent)

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `403 Forbidden` with `x-deny-reason: host_not_allowed`:

```
WebFetch https://autonomous-trading-bot-production.up.railway.app/api/errors
→ HTTP/1.1 403 Forbidden (Request failed with status code 403)

WebFetch https://autonomous-trading-bot-production.up.railway.app/api/balances
→ HTTP/1.1 403 Forbidden

WebFetch https://autonomous-trading-bot-production.up.railway.app/api/trades?limit=50&include_failures=true
→ HTTP/1.1 403 Forbidden

WebFetch https://autonomous-trading-bot-production.up.railway.app/api/portfolio
→ HTTP/1.1 403 Forbidden
```

## Root Cause

The Claude Code execution sandbox has an **egress proxy** that only allows outbound connections to a fixed allowlist of domains. The Railway deployment domain (`autonomous-trading-bot-production.up.railway.app`) is **not on this allowlist**, so all connections are blocked at the proxy layer before reaching Railway.

This is a **persistent infrastructure constraint** — this same issue was documented in the previous medic run on 2026-04-14T19:12 UTC.

This does NOT necessarily indicate a bot failure.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state

## What IS Known (from git history as of 2026-04-15T05:16 UTC)

- **Bot version deployed:** v21.11 (dry powder reserve — proactive 10% USDC floor), committed 2026-04-14 20:22 EDT
- **Last scout commit:** 2026-04-13 12:52:52 UTC — feat(scout): add LUNA, CLANKER, VADER (~40.4h ago, < 48h threshold)
- **Last auditor commit:** 2026-04-14 18:23:44 UTC — improve(auditor): lower VOL_HIGH_THRESHOLD 8%→6%
- **Last medic run:** 2026-04-14 19:12:51 UTC — PATTERN D (API unreachable)
- **Recent bot fixes in git:** Basescan API migration, alpha hunting pipeline, capital liberation logic — active development, no emergency patches

## Consecutive Unreachable Runs

| Run | Timestamp | Outcome |
|-----|-----------|---------|
| 1 | 2026-04-14T19:12 UTC | PATTERN D — API unreachable |
| 2 | 2026-04-15T05:16 UTC | PATTERN D — API unreachable (this report) |

## Recommended Action for Henry

1. **Manually verify** bot health at: https://autonomous-trading-bot-production.up.railway.app/health
2. **Check Railway dashboard** for service status and recent logs
3. If bot is healthy, no action needed — this is a network restriction in the medic's environment
4. If bot is down, investigate Railway logs for the actual error pattern before applying a medic fix
5. **To fix the medic permanently:** Add `autonomous-trading-bot-production.up.railway.app` to the Claude Code egress allowlist in settings (or the MCP server proxy config) — this will enable all three jobs (Medic, Scout, Auditor) to function with live data

## Jobs Status This Run

- 🏥 **Medic:** PATTERN D — API unreachable, no code change
- 🔍 **Scout:** Skipped — last run 40.4h ago (< 48h threshold)
- 📊 **Auditor:** Skipped — Medic flagged PATTERN D, also API unreachable

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- Report committed to claude/cool-sagan-8JB3P (staging equivalent) only per MEDIC SAFETY protocol
