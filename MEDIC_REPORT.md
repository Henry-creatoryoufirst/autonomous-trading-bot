# MEDIC REPORT — 2026-04-26T23:07 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #19)

## Environment
- Run timestamp: 2026-04-26T23:07 UTC
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
| #18 | 2026-04-24T00:00 UTC | This report; scout added B3; auditor raised HOT_MOVER_MIN_CHANGE_H1_PCT 5→7 |
| #19 | 2026-04-26T23:07 UTC | Scout added ICNT (Impossible Cloud Network, 8/10, $7.5M vol, Coinbase-listed); auditor skipped (API unreachable) |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, staging branch is extremely active. Since Run #17:

- `2026-04-26` — Scout: ICNT (Impossible Cloud Network Token) added to TOKEN_REGISTRY — $7.5M vol, $112M+ mkt cap (this run)
- `2026-04-24` — Scout: B3 (B3 Gaming Chain) added to TOKEN_REGISTRY — $810K liq, $1.66M vol
- `2026-04-24` — Auditor: HOT_MOVER_MIN_CHANGE_H1_PCT 5→7 — bear-market signal quality
- `2026-04-23` — Scout: MOG + TYBG added to TOKEN_REGISTRY
- `2026-04-23` — Auditor: LARGE_TRADE_THRESHOLD_USD 5000→2500
- `2026-04-23` — Scout: OVPP + RAVE added to TOKEN_REGISTRY
- `2026-04-23` — merge(staging): CRITIC Day-1 stub (feat/critic-stub-spec-018)
- `2026-04-22` — fix(payout): accrue pendingFeeUSDC in CDP sell path
- `2026-04-22` — fix(trade-counter): reconcile + derive live-exec timestamp

**Staging is substantially ahead of main** — v21.20.1+ queued with NVR-CRITIC, OSS trader model, P&L sanitizer improvements.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance, P&L, or win rate

## Jobs Status This Run (Run #19)

- **Medic**: PATTERN D — API unreachable (same persistent constraint). MEDIC_REPORT updated.
- **Scout**: COMPLETED — added ICNT (Impossible Cloud Network Token, score 8/10, $7.5M 24h vol, $112M+ market cap, 8+ months on Base, Coinbase-listed March 25 2026). Evaluated 5 candidates; 4 rejected (CLAWSTR: 838% pool fee/honeypot; CLAWNCH: -95.5% from ATH, momentum 3/10; EAT/375ai: Solana not Base; STG: merged into ZRO already in registry).
- **Auditor**: Cannot verify live trigger conditions (all /api/* return 403). Skipped this run.

## Recommended Action for Henry

**This is now the 17th consecutive run with the same network restriction. Urgent:**

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
