# MEDIC REPORT — 2026-04-16T19:11 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #6)

## Environment
- Run timestamp: 2026-04-16T19:11 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-WkbtV

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `Host not in allowlist`:

```
curl -s https://autonomous-trading-bot-production.up.railway.app/api/errors
→ Host not in allowlist

curl -s https://autonomous-trading-bot-production.up.railway.app/api/balances
→ Host not in allowlist

curl -s https://autonomous-trading-bot-production.up.railway.app/api/trades
→ Host not in allowlist
```

## Root Cause

The Claude Code execution sandbox has an **egress proxy** that only allows outbound connections to a fixed allowlist of domains. The Railway deployment domain is **not on this allowlist**. This is a **persistent infrastructure constraint** — it does NOT indicate a bot failure.

**History of this issue:**
| Run # | Timestamp | Action |
|-------|-----------|--------|
| #1 | 2026-04-14T19:12 UTC | First PATTERN D report filed |
| #2 | 2026-04-15T00:00 UTC | PATTERN D re-confirmed |
| #3 | 2026-04-15T18:38 UTC | PATTERN D update |
| #4 | 2026-04-16T10:18 UTC | PATTERN D update |
| #5 | 2026-04-16T11:20 UTC | PATTERN D update |
| #6 | 2026-04-16T19:11 UTC | This report (same issue) |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, the bot is clearly active and improvements are shipping:

- `2026-04-16 ~19:00 UTC` — Ground-truth cost basis rebuild / $1.4M phantom P&L fix merged (#7)
- `2026-04-16 14:52 UTC` — On-chain Transfer event indexer merged (#6)
- `2026-04-16 05:15 UTC` — Scout added BENJI to TOKEN_REGISTRY
- `2026-04-16 00:25 UTC` — Auditor tightened BREAKER_DAILY_DD_PCT 8→7 (bear-market defensive)
- `2026-04-16 00:21 UTC` — Scout added SPX to TOKEN_REGISTRY
- `2026-04-15 16:35 UTC` — Auditor lowered KELLY_FRACTION 0.5→0.35 (bear-market)
- `2026-04-15 12:25 UTC` — Auditor lowered VOL_TARGET_DAILY_PCT 2→1.5 (bear-market)

## Current Parameter State (from constants.ts)

| Parameter | Current Value | Notes |
|-----------|---------------|-------|
| KELLY_FRACTION | 0.35 | Bear-adjusted (was 0.5); Quarter-Kelly range |
| VOL_TARGET_DAILY_PCT | 1.5 | Bear-adjusted (was 2.0%) |
| BREAKER_DAILY_DD_PCT | 7 | Bear-adjusted (was 8%) |
| KELLY_POSITION_CEILING_PCT | 14 | Bear-adjusted (was 18%) |
| NORMAL_CONFLUENCE_BUY | 25 | Standard |
| NORMAL_CONFLUENCE_SELL | -20 | Standard |

**Assessment:** Parameters are at bear-market defensive floor. 3 auditor runs in last 19h already tightened all key params. Further changes without confirmed live metrics risk halting all trades.

## Jobs Status This Run (Run #6)

- **Scout**: SKIPPED — last ran 2026-04-16T05:15 UTC (~14h ago, well within 48h window)
- **Auditor**: SKIPPED — `/api/trades`, `/api/portfolio`, `/api/patterns`, `/api/adaptive` all unreachable. Cannot check trigger conditions. Bear market params already at defensive floor.

## Recommended Action for Henry

**This is the 6th consecutive run with the same network restriction. Action required:**

1. **Add to Claude Code egress allowlist:** `autonomous-trading-bot-production.up.railway.app`
2. **Add to egress allowlist:** `api.geckoterminal.com` (needed for Scout)
3. **Alternative:** Push a read-only health webhook to a whitelisted domain
4. **Manual health check:** https://autonomous-trading-bot-production.up.railway.app/health

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, persistent environmental constraint, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts or any trading files
- No production changes
- Report committed to feature branch only per MEDIC SAFETY protocol
