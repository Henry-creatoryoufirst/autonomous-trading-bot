# MEDIC REPORT — 2026-04-19T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #10)

## Environment
- Run timestamp: 2026-04-19T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: staging

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
| #6 | 2026-04-17T00:00 UTC | PATTERN D update |
| #7 | 2026-04-17T12:00 UTC | PATTERN D update |
| #8 | 2026-04-17T18:42 UTC | PATTERN D update |
| #9 | 2026-04-17T22:09 UTC | PATTERN D update |
| #10 | 2026-04-19T00:00 UTC | This report (same issue) |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, the staging branch is active with autonomous updates:

- `2026-04-19 00:00 UTC` — Scout (Run #10) added ETHY (Ethy AI by Virtuals) to TOKEN_REGISTRY
- `2026-04-16 05:15 UTC` — Scout added BENJI to TOKEN_REGISTRY
- `2026-04-16 00:25 UTC` — Auditor tightened BREAKER_DAILY_DD_PCT 8→7 (bear-market)
- `2026-04-16 00:21 UTC` — Scout added SPX to TOKEN_REGISTRY
- `2026-04-15 16:35 UTC` — Auditor lowered KELLY_FRACTION 0.5→0.35 (bear-market)
- `2026-04-15 12:25 UTC` — Auditor lowered VOL_TARGET_DAILY_PCT 2→1.5 (bear-market)

**Staging branch is substantially ahead of main** — many queued tokens (TIBBIR, AXR, BNKR, LBTC, ELSA, EDEL, KTA, ETHY) and tightened risk params not yet promoted to production.

**Risk params in staging (not yet on main):** KELLY 0.35, VOL_TARGET 1.5%, BREAKER_DD 7%.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state

## Jobs Status This Run (Run #10)

- **Medic**: PATTERN D — API unreachable (same persistent constraint). No code changes.
- **Scout**: RAN — last scout was 2026-04-16 (72h ago, >48h threshold). Added ETHY (Ethy AI by Virtuals). Liquidity: $393k, 24h vol: $51-90k, score: 6/10.
- **Auditor**: SKIPPED — cannot fetch /api/trades, /api/portfolio, /api/patterns, /api/adaptive. All Railway endpoints return 403.

## Recommended Action for Henry

**This is the 10th consecutive run with the same network restriction. Action required:**

1. Add `autonomous-trading-bot-production.up.railway.app` to the Claude Code egress allowlist
2. Also add `api.geckoterminal.com` and `api.dexscreener.com` to the allowlist for Scout
3. Alternatively, expose a **read-only status webhook** that pushes to a domain already in the allowlist
4. Manually verify bot health at: https://autonomous-trading-bot-production.up.railway.app/health
5. **IMPORTANT:** Staging branch has many queued improvements not on main. Consider `./scripts/deploy/stage.sh` → verify → `./scripts/deploy/promote.sh`

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, persistent environmental constraint, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- Report committed to staging only per MEDIC SAFETY protocol
