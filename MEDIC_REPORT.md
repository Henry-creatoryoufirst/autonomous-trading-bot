# MEDIC REPORT — 2026-04-23T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #17)

## Environment
- Run timestamp: 2026-04-23T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-LpzrJ

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
| #17 | 2026-04-23T00:00 UTC | This report (same issue, +Scout ran) |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, the staging branch is extremely active with autonomous updates. Since Run #16 (2026-04-21T09:00), local repo advanced to **v21.20.x** with multiple P&L sanitizer fixes:

- `v21.20.1+` — fix(pnl): tighten daily-pnl phantom filter — catch 1:1 fallback signatures
- `v21.20.1` — fix(pnl): per-trade phantom filter + per-token phantom realized cleanup
- `v21.20` — feat(cost): prompt caching on heavy-cycle Sonnet calls + real telemetry cost math
- `fix/realized-pnl-poison-2026-04-18` merged — two-layer realized-P&L sanitizer + startup re-sync
- `fix/payout-accrual-2026-04-22` merged — accrue pendingFeeUSDC in CDP sell path
- `fix/trade-counter-reconcile` merged — reconcile trade counters + derive live-exec timestamp

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

## Jobs Status This Run (Run #17)

- **Medic**: PATTERN D — API unreachable (same persistent constraint). No code changes.
- **Scout**: RAN — last scout was 2026-04-20T21:09 UTC (~50h ago, exceeds 48h threshold).
  Full scan completed. Candidates evaluated:
  - EDGE (edgeX, `0xED6E000dEF95780fb89734c07EE2ce9F6dcAf110`): 5/10 — REJECTED. Major airdrop transparency scandal ($195M controversy, suspected 180M team-controlled tokens), only ~1.45M tokens on exchanges. Low on-chain DEX liquidity despite $25M CEX volume.
  - TRX (TRON-bridged, `0x989cfdc3508500d0c91f22896a0d2ee1ef675870`): 4/10 — REJECTED. Only 324 holders on Base, ~$2.5M on-chain market cap on Base. Too early-stage for Base DEX pools.
  - KAITO (`0x98d0baa52b2d063e780de12f615f963fe8537553`): 5/10 — REJECTED. 87% decline from ATH ($2.92→$0.39), X/Twitter API ban of InfoFi projects destroying core use case. Platform risk too high.
  Result: 🔍 No qualifying tokens this scan — standards maintained.
- **Auditor**: SKIPPED — cannot fetch live metrics (/api/trades, /api/portfolio, /api/patterns, /api/adaptive all return 403); trigger conditions unverifiable.

## Recommended Action for Henry

**This is the 17th consecutive run with the same network restriction. Action urgently required:**

1. **Add to Claude Code egress allowlist:**
   - `autonomous-trading-bot-production.up.railway.app`
   - `api.geckoterminal.com`
   - `api.dexscreener.com`
2. **Or** expose a read-only status webhook on an already-allowed domain
3. **Manually verify bot health:** https://autonomous-trading-bot-production.up.railway.app/health
4. **IMPORTANT:** Repo has many queued improvements (v21.20.x P&L sanitizers, prompt caching, payout accrual fixes, multi-sleeve orchestrator). Consider promoting staging: `./scripts/deploy/stage.sh` → verify → `./scripts/deploy/promote.sh`
5. **Scout note:** No new tokens added this scan. Evaluated EDGE (edgeX), TRX (Base-bridged), KAITO — all rejected on quality/risk grounds. Token registry remains at current state.

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, persistent environmental constraint, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- Report committed to staging only per MEDIC SAFETY protocol
