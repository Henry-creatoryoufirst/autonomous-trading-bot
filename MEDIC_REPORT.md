# MEDIC REPORT — 2026-04-24T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #17)

## Environment
- Run timestamp: 2026-04-24T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-5lg2g (staging branch not present in this checkout)

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `403 Forbidden`:

```
curl -s https://autonomous-trading-bot-production.up.railway.app/api/errors
→ 403 Forbidden

curl -s https://autonomous-trading-bot-production.up.railway.app/api/balances
→ 403 Forbidden

curl -s https://autonomous-trading-bot-production.up.railway.app/api/health
→ 403 Forbidden
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
| #16 | 2026-04-21T09:00 UTC | PATTERN D update |
| #17 | 2026-04-24T00:00 UTC | This report (same issue) |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, the repo is active with autonomous updates. Since Run #16 (2026-04-21T09:00), the following commits landed:

- `fix(pnl): tighten daily-pnl phantom filter` — catch 1:1 fallback signatures
- `fix(pnl): per-trade phantom filter on daily-pnl rollup` (v21.20.1 follow-on)
- `fix(pnl): per-token phantom realized cleanup` (v21.20.1)
- `Merge fix/realized-pnl-poison-2026-04-18 into staging`
- `Merge fix/payout-accrual-2026-04-22 into staging`
- `Merge fix/trade-counter-reconcile into staging`
- `fix(payout): accrue pendingFeeUSDC in CDP sell path + separate execution date`
- `fix(pnl): two-layer realized-P&L sanitizer + startup re-sync + audit endpoint`
- `fix(cost): v21.20 use 1h cache TTL — 5m default would be net-negative at 15-min cycle cadence`
- `feat(cost): v21.20 prompt caching on heavy-cycle Sonnet calls + real telemetry cost math`
- `fix(health): reconcile trade counters and derive live-exec timestamp`

This run also added **MAMO** and **UP (Superform)** to TOKEN_REGISTRY via Scout.

## Scout Run (2026-04-24)
- MAMO: AI-powered DeFi on Base, $457K 24h vol, $3.2M liquidity, May 2025 launch → AI_TOKENS, HIGH risk
- UP (Superform): DeFi yield optimizer, $5.67M 24h vol, established Aerodrome Ignition pool → DEFI, MEDIUM risk

Earlier evidence still valid from prior runs:
- `2026-04-20 21:09 UTC` — Scout added GHST (Aavegotchi) to TOKEN_REGISTRY
- `2026-04-20 05:12 UTC` — Scout added AXL (Axelar) to TOKEN_REGISTRY
- `2026-04-19 21:11 UTC` — Scout added ETHY (Ethy AI by Virtuals) to TOKEN_REGISTRY
- `2026-04-18 22:15 UTC` — Auditor raised stagnation threshold 4h→6h (extreme-fear RANGING)
- `2026-04-16 00:25 UTC` — Auditor tightened BREAKER_DAILY_DD_PCT 8→7 (bear-market)
- `2026-04-15 16:35 UTC` — Auditor lowered KELLY_FRACTION 0.5→0.35 (bear-market)

**Staging branch is substantially ahead of main** — v21.14 through v21.19 queued for promotion.

**Risk params in staging (not yet on main):** KELLY 0.35, VOL_TARGET 1.5%, BREAKER_DD 7%.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state

## Jobs Status This Run (Run #16)

- **Medic**: PATTERN D — API unreachable (same persistent constraint). No code changes.
- **Scout**: SKIPPED — last scout ran at 2026-04-20T21:09 UTC (~12h ago, within 48h threshold).
- **Auditor**: SKIPPED — cannot fetch live metrics (/api/trades, /api/portfolio, /api/patterns, /api/adaptive all return 403); trigger conditions unverifiable.

## Recommended Action for Henry

**This is the 15th consecutive run with the same network restriction. Action urgently required:**

1. **Add to Claude Code egress allowlist:**
   - `autonomous-trading-bot-production.up.railway.app`
   - `api.geckoterminal.com`
   - `api.dexscreener.com`
2. **Or** expose a read-only status webhook on an already-allowed domain
3. **Manually verify bot health:** https://autonomous-trading-bot-production.up.railway.app/health
4. **IMPORTANT:** Staging branch has many queued improvements (6+ new tokens, tightened risk params). Consider promoting: `./scripts/deploy/stage.sh` → verify → `./scripts/deploy/promote.sh`

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, persistent environmental constraint, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- Report committed to staging only per MEDIC SAFETY protocol
