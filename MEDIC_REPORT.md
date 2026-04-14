# MEDIC REPORT — 2026-04-14T19:12 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health

## Environment
- Run timestamp: 2026-04-14T19:12 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: staging

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `403 Forbidden` with `x-deny-reason: host_not_allowed`:

```
curl -sv https://autonomous-trading-bot-production.up.railway.app/health
→ HTTP/1.1 403 Forbidden
→ x-deny-reason: host_not_allowed
```

Endpoints attempted:
- `/api/errors`   → 403
- `/api/balances` → 403
- `/health`       → 403
- `/api/status`   → 403

## Root Cause

The Claude Code execution sandbox has an **egress proxy** that only allows outbound connections to a fixed allowlist of domains. The Railway deployment domain (`autonomous-trading-bot-production.up.railway.app`) is **not on this allowlist**, so all connections are blocked at the proxy layer before reaching Railway.

This is an infrastructure constraint of the medic agent's execution environment — it does NOT necessarily indicate a bot failure.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state

## What IS Known (from git history)

- Last scout commit: `2026-04-13 12:52:52 UTC` (feat(scout): add LUNA, CLANKER, VADER to TOKEN_REGISTRY)
- Last auditor commit: `improve(auditor): lower Kelly ceiling 18%→14%` — normal operation
- Most recent bot version deployed: v21.7 (Bear Mode)
- No emergency commits in the last 24h git log

## Recommended Action for Henry

1. **Manually verify** bot health at: https://autonomous-trading-bot-production.up.railway.app/health
2. **Check Railway dashboard** for service status and recent logs
3. If bot is healthy, no action needed — this is a network restriction in the medic's environment
4. If bot is down, investigate Railway logs for the actual error pattern before applying a medic fix
5. Consider adding `autonomous-trading-bot-production.up.railway.app` to the Claude Code egress allowlist to enable future automated health checks

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- Report committed to staging only per MEDIC SAFETY protocol
