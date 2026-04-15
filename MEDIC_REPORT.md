# MEDIC REPORT — 2026-04-15T18:38 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue)

## Environment
- Run timestamp: 2026-04-15T18:38 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: staging

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints return `Host not in allowlist`:

```
curl -s https://autonomous-trading-bot-production.up.railway.app/api/errors
→ Host not in allowlist

curl -s https://autonomous-trading-bot-production.up.railway.app/api/balances
→ Host not in allowlist
```

## Root Cause

The Claude Code execution sandbox has an **egress proxy** that only allows outbound connections to a fixed allowlist of domains. The Railway deployment domain (`autonomous-trading-bot-production.up.railway.app`) is **not on this allowlist**, so all connections are blocked at the proxy layer before reaching Railway.

This is a **persistent infrastructure constraint** — documented in all prior runs today (2026-04-15T00:00, T03:06, T11:17 UTC). It does NOT indicate a bot failure.

## What IS Known (from git history as of this run)

- Current staging is **7 commits ahead of main**, all healthy changes:
  - `1509b2e` refactor(state): Phase 2 — StateManager class
  - `6fdf54c` refactor(types): Phase 1 — foundation boundary types
  - `80d242a` feat(scout): add RIVER, SKI to TOKEN_REGISTRY
  - `d2dc824` improve(auditor): KELLY_FRACTION 0.5→0.35 — bear-market recalibration
  - `ddaea1b` feat(scout): add GAME to TOKEN_REGISTRY
  - `62d13ec` test(shi): simulation harness
  - Plus prior Self-Healing Intelligence commits
- Last scout: 2026-04-15 17:20 UTC (RIVER, SKI added — 1.3h ago)
- Last auditor: 2026-04-15 (KELLY_FRACTION lowered, bear-market mode active)
- No emergency/crash fixes in recent history
- Bot appears to be in **bear market / high volatility regime** based on auditor changes

## What Is NOT Known

Because the API is unreachable:
- Exact failure rate (totalFailed / totalAttempted)
- Active error patterns in recentFailedTrades
- Circuit breaker status
- Current portfolio value and P&L

## Recommended Action for Henry

1. **Manually verify** bot health at: https://autonomous-trading-bot-production.up.railway.app/health
2. **Check Railway dashboard** for service status and recent logs
3. Staging branch has 7 productive commits ready to review and promote
4. Consider adding `autonomous-trading-bot-production.up.railway.app` to the Claude Code egress allowlist to enable automated health checks

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, persistent environmental constraint)

## Safety
- No changes made to agent-v3.2.ts
- All changes on staging branch only, never touched main
