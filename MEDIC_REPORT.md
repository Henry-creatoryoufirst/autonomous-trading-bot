# MEDIC REPORT — 2026-04-24T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #17)

## Environment
- Run timestamp: 2026-04-24T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-8Lctw

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

Despite API being unreachable from medic, the working branch has advanced with P&L and cost fixes since Run #16. HEAD is at `a54fd33` (fix(pnl): tighten daily-pnl phantom filter):

- `a54fd33` — fix(pnl): tighten daily-pnl phantom filter — catch 1:1 fallback signatures
- `69f9df3` — fix(pnl): per-trade phantom filter on daily-pnl rollup (v21.20.1 follow-on)
- `d064c8f` — fix(pnl): per-token phantom realized cleanup (v21.20.1)
- Merges: fix/realized-pnl-poison-2026-04-18, fix/payout-accrual-2026-04-22, fix/trade-counter-reconcile
- `868cb9d` — feat(cost): v21.20 prompt caching on heavy-cycle Sonnet calls + real telemetry cost math

Since Run #16, the branch is substantially ahead of main with multiple P&L hardening, payout accrual, and cost optimization commits.

## Scout Run (this run — Run #17)

Last scout commit was 2026-04-20T21:09 UTC (~75h ago, threshold 48h). Scout triggered and ran web searches. **Findings:**

| Token | Symbol | Liquidity | 24h Volume | Pool Age | Pass? |
|-------|--------|-----------|------------|----------|-------|
| Mochi (catcoin) | MOCHI | unknown | ~$1.7k | established | ✗ vol<$50k |
| Base God | TYBG | ~$206k | ~$4k (CoinGecko) | established | ✗ vol<$50k |
| Athena by Virtuals | ATHENA | ~$182k | ~$116-960 | established | ✗ vol<$50k |
| PONKE (bridged) | PONKE | ~$0 | ~$0 | n/a | ✗ no Base liquidity |

GeckoTerminal API unreachable (403), so trending/new pools could not be fetched directly. WebSearch-based discovery found no token meeting all three criteria (>$100k liquidity, >$50k 24h vol, >3 days age). TOKEN_REGISTRY unchanged.

Historical evidence from prior runs (still valid):
- `2026-04-20 21:09 UTC` — Scout added GHST (Aavegotchi) to TOKEN_REGISTRY
- `2026-04-20 05:12 UTC` — Scout added AXL (Axelar) to TOKEN_REGISTRY
- `2026-04-19 21:11 UTC` — Scout added ETHY (Ethy AI by Virtuals) to TOKEN_REGISTRY
- `2026-04-18 22:15 UTC` — Auditor raised stagnation threshold 4h→6h (extreme-fear RANGING)
- `2026-04-16 00:25 UTC` — Auditor tightened BREAKER_DAILY_DD_PCT 8→7 (bear-market)
- `2026-04-15 16:35 UTC` — Auditor lowered KELLY_FRACTION 0.5→0.35 (bear-market)

**Working branch (claude/cool-sagan-8Lctw) is substantially ahead of main** — v21.20+ P&L hardening, cost optimization, payout accrual queued for promotion.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state

## Jobs Status This Run (Run #17)

- **Medic**: PATTERN D — API unreachable (persistent infrastructure constraint). No code changes.
- **Scout**: RAN — last scout was 75h ago (>48h threshold). Web searches found 4 candidates, all failed quality filters (volume <$50k 24h). TOKEN_REGISTRY unchanged. GeckoTerminal API also unreachable (403).
- **Auditor**: SKIPPED — cannot fetch live metrics (/api/trades, /api/portfolio, /api/patterns, /api/adaptive all return 403); trigger conditions unverifiable.

## Recommended Action for Henry

**This is the 17th consecutive run with the same network restriction. Action urgently required:**

1. **Add to Claude Code egress allowlist:**
   - `autonomous-trading-bot-production.up.railway.app`
   - `api.geckoterminal.com`
   - `api.dexscreener.com`
2. **Or** expose a read-only status webhook on an already-allowed domain
3. **Manually verify bot health:** https://autonomous-trading-bot-production.up.railway.app/health
4. **IMPORTANT:** Working branch has many queued improvements (P&L sanitizer, prompt caching, payout fixes). Consider promoting: `./scripts/deploy/stage.sh` → verify → `./scripts/deploy/promote.sh`

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, persistent environmental constraint, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- Report committed to claude/cool-sagan-8Lctw per session branch requirements
