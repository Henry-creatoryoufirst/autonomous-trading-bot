# MEDIC REPORT — 2026-04-15T11:17 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health

## Environment
- Run timestamp: 2026-04-15T11:17 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-bykyo

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `403 Forbidden` with `x-deny-reason: host_not_allowed`:

```
curl -sv https://autonomous-trading-bot-production.up.railway.app/health
→ HTTP/2 403
→ x-deny-reason: host_not_allowed
→ "Host not in allowlist"
```

Endpoints attempted:
- `/api/errors`    → 403
- `/api/balances`  → 403
- `/health`        → 403
- `/api/trades`    → 403 (auditor)
- `/api/portfolio` → 403 (auditor)
- `/api/patterns`  → 403 (auditor)
- `/api/adaptive`  → 403 (auditor)

## Root Cause

The Claude Code execution sandbox has an **egress proxy** that only allows outbound connections to a fixed allowlist of domains. The Railway deployment domain (`autonomous-trading-bot-production.up.railway.app`) is **not on this allowlist**, so all connections are blocked at the proxy layer before reaching Railway.

This is an infrastructure constraint of the medic agent's execution environment — it does NOT necessarily indicate a bot failure.

This is the **second consecutive run** (yesterday 19:12 UTC and today 11:17 UTC) where the API is unreachable. The problem is persistent.

## What Is NOT Known

Because the API is unreachable, the medic/auditor cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C/D) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state
- Win rate, drawdown, or losing streak (auditor trigger conditions)

## What IS Known (from git history)

- Latest deployed version: v21.11 (dry powder reserve / proactive 10% USDC floor)
- Last scout commit: `2026-04-13 12:52:52 UTC` — 46h ago (under 48h threshold, skipped)
- No emergency commits in recent git log
- No code changes made this run (no critical condition confirmed, no auditor triggers assessed)

## Impact on This Run

| Job | Result |
|-----|--------|
| 🏥 Medic | Cannot assess — API blocked (Railway host_not_allowed) |
| 🔍 Scout | Skipped — last ran 46h 24min ago (< 48h threshold) |
| 📊 Auditor | Cannot assess — API endpoints blocked |

## Recommended Action for Henry

1. **Manually verify** bot health at: https://autonomous-trading-bot-production.up.railway.app/health
2. **Check Railway dashboard** for service status and recent logs
3. If bot is healthy, no action needed — this is a persistent network restriction in the medic's environment
4. **Fix the root cause:** Add `autonomous-trading-bot-production.up.railway.app` to the Claude Code egress allowlist to enable future automated health checks. This is blocking all three medic/scout/auditor jobs.
5. Alternatively, consider exposing a read-only `/api/status` endpoint on a public subdomain without Railway's host restriction, or use a Railway webhook to push state to a neutral location the agent can read.

## Pattern Classification
Infrastructure PATTERN D — API unreachable (Railway host allowlist blocking this agent's IP). Not a trade-error pattern — no code fix applicable.

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- Report committed to claude/cool-sagan-bykyo (development branch) per git branch requirements
