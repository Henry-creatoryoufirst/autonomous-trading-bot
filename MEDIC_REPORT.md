# MEDIC REPORT — 2026-04-22T07:08 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #16)

## Environment
- Run timestamp: 2026-04-22T07:08 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-qu8O3

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `403 Forbidden`:

```
curl -s https://autonomous-trading-bot-production.up.railway.app/api/errors
→ Host not in allowlist (403)

curl -s https://autonomous-trading-bot-production.up.railway.app/api/balances
→ Host not in allowlist (403)

curl -s https://autonomous-trading-bot-production.up.railway.app/api/health
→ Host not in allowlist (403)
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
| #16 | 2026-04-22T07:08 UTC | This report (same issue) |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, the development branch is active with autonomous updates:

- `2026-04-22 (claude/cool-sagan-qu8O3)` — v21.19 regime flowing + Core drawdown inherits bot peak
- `2026-04-22 (claude/cool-sagan-qu8O3)` — v21.18 DRAWDOWN_OVERRIDE bypasses green-market loss gate
- `2026-04-22 (claude/cool-sagan-qu8O3)` — v21.17 dashboard-honesty drawdownPct + regime wired into /api/sleeves/compare
- `2026-04-22 (claude/cool-sagan-qu8O3)` — v21.16 Phase 2 paper-trade simulation + Alpha Hunter v1
- `2026-04-22 (claude/cool-sagan-qu8O3)` — v21.15 multi-sleeve orchestrator + per-sleeve write-back
- `2026-04-21 (claude/cool-sagan-qu8O3)` — v21.14 SPEC-015 asymmetric exit momentum + drawdown override
- `2026-04-20 21:09 UTC` — Scout added GHST (Aavegotchi) to TOKEN_REGISTRY
- `2026-04-20 (main)` — v21.13 Sleeves Phase 2 LIVE with SLEEVES_DRIVE_DECISIONS=true

**dev branch (claude/cool-sagan-qu8O3) is substantially ahead of main** — v21.14–v21.19 queued, not yet promoted to production.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state

## Jobs Status This Run (Run #16)

- **Medic**: PATTERN D — API unreachable (same persistent constraint). No code changes to agent-v3.2.ts.
- **Scout**: SKIPPED — last scout ran at 2026-04-20T21:09 UTC (34h ago, under 48h threshold). Next scout eligible ~2026-04-22T21:09 UTC.
- **Auditor**: SKIPPED — Medic triggered PATTERN D stop. Cannot fetch live metrics regardless (same 403 block on /api/trades, /api/portfolio, /api/patterns, /api/adaptive).

## Recommended Action for Henry

**This is the 15th consecutive run with the same network restriction. Action urgently required:**

1. **Add to Claude Code egress allowlist** (preferred — unblocks Medic + Scout + Auditor):
   - `autonomous-trading-bot-production.up.railway.app`
   - `api.geckoterminal.com`
   - `api.dexscreener.com`
2. **Or** expose a read-only status webhook via GitHub Actions or a public relay on an already-allowed domain
3. **Manually verify bot health:** https://autonomous-trading-bot-production.up.railway.app/health
4. **IMPORTANT:** Dev branch `claude/cool-sagan-qu8O3` has v21.14–v21.19 queued. Review and promote if stable.

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, persistent environmental constraint, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- Report committed to dev branch only per MEDIC SAFETY protocol
