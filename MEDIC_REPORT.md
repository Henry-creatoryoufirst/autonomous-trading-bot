# MEDIC REPORT — 2026-04-15T(hourly run) UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health

## Environment
- Run timestamp: 2026-04-15 (hourly autonomous run)
- Medic agent: NVR Capital autonomous agent
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-aYvDV

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `403 Forbidden` with `x-deny-reason: host_not_allowed`:

Endpoints attempted:
- `/api/errors`   → 403
- `/api/balances` → 403
- `/api/trades`   → 403
- `/api/portfolio` → 403
- `/api/patterns` → 403
- `/api/adaptive` → 403
- `/health`       → 403

## Root Cause (Known — Previously Documented 2026-04-14T19:12 UTC)

The Claude Code execution sandbox has an **egress proxy** that only allows outbound connections to a fixed allowlist of domains. The Railway deployment domain (`autonomous-trading-bot-production.up.railway.app`) is **not on this allowlist**, so all connections are blocked at the proxy layer before reaching Railway.

This is a **persistent infrastructure constraint** of the medic agent's execution environment — it does NOT indicate a bot failure.

## What Is NOT Known

Because the API is unreachable, neither the Medic, Scout quality check, nor Auditor can verify live metrics:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C/D) is active in `recentFailedTrades`
- Whether circuit breakers are blocked
- Current portfolio balance, win rate, drawdown, losing streak
- Current marketRegime and how long it has been active

## What IS Known (from git history)

- Current bot version: **v21.11** — "dry powder reserve, proactive 10% USDC floor"
- Last scout run: `2026-04-15 02:13:26 UTC` (feat(scout): add SPX, MOG to TOKEN_REGISTRY) — **ran today**
- Recent deployments look healthy — no emergency commits in last 24h
- v21.8 introduced recursive learning loop + autonomous self-healing
- v21.9: capital liberation + smart wallet exit detection
- v21.10: position culling + sector rotation
- v21.11: 10% USDC dry powder floor (defensive capital management)

## Recommended Action for Henry

1. **Manually verify** bot health at: https://autonomous-trading-bot-production.up.railway.app/health
2. **Check Railway dashboard** for service status and recent logs
3. If bot is healthy, no action needed — this is a network restriction in the medic's environment
4. If bot is down, check Railway logs for the actual error pattern before applying a medic fix
5. **To fix automated health checks:** Add `autonomous-trading-bot-production.up.railway.app` to the Claude Code egress allowlist — this would unblock Medic, Auditor, and Scout quality checks going forward

## Pattern Classification
PATTERN D — Cannot Assess (persistent API egress block — not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- No pushes to main
