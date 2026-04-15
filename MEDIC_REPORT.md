# MEDIC REPORT — 2026-04-15T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health

## Environment
- Run timestamp: 2026-04-15T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-Q2EkK

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `"Host not in allowlist"` from the Anthropic sandbox egress proxy:

```
curl https://autonomous-trading-bot-production.up.railway.app/api/errors
→ Host not in allowlist

curl https://autonomous-trading-bot-production.up.railway.app/api/balances
→ Host not in allowlist
```

Endpoints attempted:
- `/api/errors`    → Host not in allowlist
- `/api/balances`  → Host not in allowlist
- `/api/trades`    → Host not in allowlist
- `/api/portfolio` → Host not in allowlist
- `/api/patterns`  → Host not in allowlist
- `/api/adaptive`  → Host not in allowlist

## Root Cause

The Claude Code execution sandbox has an **egress proxy** that only allows outbound connections to a fixed allowlist of domains. The Railway deployment domain (`autonomous-trading-bot-production.up.railway.app`) is **not on this allowlist**, so all connections are blocked at the proxy layer before reaching Railway.

This is an infrastructure constraint of the medic agent's execution environment — it does NOT necessarily indicate a bot failure. The bot itself is likely running normally on Railway.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state
- Win rate, drawdown, losing streak (Auditor trigger thresholds)

## What IS Known (from git history)

- Last scout commit: `2026-04-13 12:52:52 UTC` (feat(scout): add LUNA, CLANKER, VADER) — 35.1h ago, Scout skipped
- Most recent bot version: v21.11 (dry powder reserve — proactive 10% USDC floor)
- Last medic report: 2026-04-14T19:12 UTC — same API unreachability issue
- No emergency commits in recent git log — bot appears to be operating normally
- External APIs (GeckoTerminal) also blocked — Scout cannot run even if due

## Consecutive Unreachable Runs

| Run Timestamp       | Status                        |
|---------------------|-------------------------------|
| 2026-04-14T19:12 UTC | API unreachable (first documented) |
| 2026-04-15T00:00 UTC | API unreachable (this run)    |

## Recommended Action for Henry

1. **Manually verify** bot health at: https://autonomous-trading-bot-production.up.railway.app/api/errors
2. **Check Railway dashboard** for service status and recent logs
3. If bot is healthy, no action needed — this is a network restriction in the medic's execution environment
4. If bot is down, investigate Railway logs for the actual error pattern before applying a medic fix
5. **To restore automated health checks**: add `autonomous-trading-bot-production.up.railway.app` and `api.geckoterminal.com` to the Claude Code sandbox egress allowlist

## Pattern Classification
PATTERN D — Cannot Assess (API unreachable from sandbox, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- Report committed to feature branch only per MEDIC SAFETY protocol
