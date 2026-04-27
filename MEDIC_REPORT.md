# MEDIC REPORT — 2026-04-27T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #19)

## Environment
- Run timestamp: 2026-04-27T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: staging

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `403 Forbidden`:

```
GET https://autonomous-trading-bot-production.up.railway.app/api/errors      → 403
GET https://autonomous-trading-bot-production.up.railway.app/api/balances    → 403
GET https://autonomous-trading-bot-production.up.railway.app/api/health      → 403
GET https://autonomous-trading-bot-production.up.railway.app/api/trades      → 403
GET https://autonomous-trading-bot-production.up.railway.app/api/portfolio   → 403
GET https://api.geckoterminal.com/api/v2/networks/base/trending_pools        → 403
```

## Root Cause

The Claude Code execution sandbox has an **egress proxy** that only allows outbound connections to a fixed allowlist of domains. The Railway deployment domain and third-party on-chain APIs are **not on this allowlist**. This is a **persistent infrastructure constraint** — it does NOT indicate a bot failure.

## History of this issue

| Run # | Timestamp | Action |
|-------|-----------|--------|
| #1  | 2026-04-14T19:12 UTC | First PATTERN D report filed |
| #2  | 2026-04-15T00:00 UTC | PATTERN D re-confirmed |
| #3  | 2026-04-15T18:38 UTC | PATTERN D update |
| #4  | 2026-04-16T10:18 UTC | PATTERN D update |
| #5  | 2026-04-16T11:20 UTC | PATTERN D update |
| #6  | 2026-04-17T00:00 UTC | PATTERN D update |
| #7  | 2026-04-17T12:00 UTC | PATTERN D update |
| #8  | 2026-04-17T18:42 UTC | PATTERN D update |
| #9  | 2026-04-17T22:09 UTC | PATTERN D update |
| #10 | 2026-04-19T00:00 UTC | PATTERN D update |
| #11 | 2026-04-19T23:07 UTC | PATTERN D update |
| #12 | 2026-04-20T00:00 UTC | PATTERN D update |
| #13 | 2026-04-20T12:00 UTC | PATTERN D update |
| #14 | 2026-04-20T17:00 UTC | PATTERN D update |
| #15 | 2026-04-21T00:00 UTC | PATTERN D update |
| #16 | 2026-04-21T09:00 UTC | PATTERN D update |
| #17 | 2026-04-23T00:00 UTC | Conflict resolved; auditor lowered LARGE_TRADE_THRESHOLD_USD 5000→2500 |
| #18 | 2026-04-24T00:00 UTC | Scout added B3; auditor raised HOT_MOVER_MIN_CHANGE_H1_PCT 5→7 |
| #19 | 2026-04-27T00:00 UTC | This report; scout added A0X; auditor lowered BREAKER_WEEKLY_DD_PCT 15→12 |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, the branch is extremely active. Since Run #18:

- `2026-04-27` — Scout: A0X (A0x AI agent platform) added to TOKEN_REGISTRY — $463K liq, $132K 24h vol (this run)
- `2026-04-27` — Auditor: BREAKER_WEEKLY_DD_PCT 15→12 — bear-market recovery asymmetry (this run)
- `2026-04-24` — CRITIC v21.24 memory injection merged (heavy-cycle Sonnet prompts now get CRITIC feedback)
- `2026-04-24` — Scout: B3 (B3 Gaming Chain) added to TOKEN_REGISTRY — $810K liq, $1.66M vol
- `2026-04-24` — Auditor: HOT_MOVER_MIN_CHANGE_H1_PCT 5→7 — bear-market signal quality
- `2026-04-23` — Scout: MOG + TYBG added to TOKEN_REGISTRY
- `2026-04-23` — Auditor: LARGE_TRADE_THRESHOLD_USD 5000→2500
- `2026-04-23` — Scout: OVPP + RAVE added to TOKEN_REGISTRY
- `2026-04-23` — merge(staging): CRITIC Day-1 stub (feat/critic-stub-spec-018)

**Branch is substantially ahead of main** — v21.24 queued with NVR-CRITIC memory injection, OSS trader model, dry-powder cost-basis gate.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance, P&L, or win rate

## Jobs Status This Run (Run #19)

- **Medic**: PATTERN D — API unreachable (same persistent constraint). MEDIC_REPORT updated.
- **Scout**: COMPLETED — added A0X (A0x AI agent platform, $463K liq, $132K 24h vol, 9-month pool, score 7/10). Evaluated 7 candidates; 6 rejected (PONKE: Solana not Base; MOCHI: $0 vol; EXTRA: $16K vol; BASED: minimal vol; W: $21K vol Base-specific; RIZ: $3K liquidity).
- **Auditor**: Cannot verify live trigger conditions (all /api/* return 403). Bear market inferred from git history (46-day bear confirmed Run #17, extended further). Research ran 4 searches; BREAKER_WEEKLY_DD_PCT 15→12 implemented (Impact 3, Complexity 1, Risk low, Priority 3.0). NVR-HQ not in checkout — no report file written.

## Recommended Action for Henry

**This is now the 18th consecutive run with the same network restriction. Urgent:**

1. **Add to Claude Code egress allowlist:**
   - `autonomous-trading-bot-production.up.railway.app`
   - `api.geckoterminal.com`
   - `api.dexscreener.com`
2. **Or** expose a lightweight read-only status endpoint on an already-allowed domain
3. **Manually verify bot health:** https://autonomous-trading-bot-production.up.railway.app/health
4. **Consider staging promotion:** `./scripts/deploy/stage.sh` → verify → `./scripts/deploy/promote.sh`

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable — persistent environmental constraint, not a trade-error pattern)

## Safety
- No changes to agent-v3.2.ts
- No production changes
- MEDIC_REPORT.md conflict resolved; committed to staging only
