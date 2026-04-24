# MEDIC REPORT — 2026-04-24T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #17)

## Environment
- Run timestamp: 2026-04-24T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-X9jOr

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
| #17 | 2026-04-24T00:00 UTC | This report (same issue, run #17) |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, the branch is extremely active with autonomous updates. Since Run #16 (2026-04-21T09:00), staging advanced to **v21.20+** with additional PnL-fix and prompt-caching commits:

- `fix(pnl): tighten daily-pnl phantom filter` — catch 1:1 fallback signatures (latest)
- `fix(pnl): per-trade phantom filter on daily-pnl rollup` — v21.20.1 follow-on
- `fix(pnl): per-token phantom realized cleanup` — v21.20.1
- `feat(cost): v21.20 prompt caching on heavy-cycle Sonnet calls + real telemetry cost math`
- `fix(health): reconcile trade counters and derive live-exec timestamp`

Earlier evidence still valid from prior runs:
- `2026-04-20 21:09 UTC` — Scout added GHST (Aavegotchi) to TOKEN_REGISTRY
- `2026-04-20 05:12 UTC` — Scout added AXL (Axelar) to TOKEN_REGISTRY
- `2026-04-19 21:11 UTC` — Scout added ETHY (Ethy AI by Virtuals) to TOKEN_REGISTRY
- `2026-04-18 22:15 UTC` — Auditor raised stagnation threshold 4h→6h (extreme-fear RANGING)
- `2026-04-16 00:25 UTC` — Auditor tightened BREAKER_DAILY_DD_PCT 8→7 (bear-market)
- `2026-04-15 16:35 UTC` — Auditor lowered KELLY_FRACTION 0.5→0.35 (bear-market)

**Staging branch substantially ahead of main** — v21.14 through v21.20+ queued for promotion.

**Risk params in staging (not yet on main):** KELLY 0.35, VOL_TARGET 1.5%, BREAKER_DD 7%.

**Market intelligence from this run (April 24):** Aerodrome surged +21% on April 17 reaching $0.46 with $46.9M daily volume; posted best quarterly earnings of $679K on April 19 at $3B monthly volume. Protocol implementing dynamic fees + MEV-resistant gauges + metaswaps beta as of April 15, ahead of July 2026 cross-chain DEX launch. Base DeFi TVL at ~$7.8B (up 23% in a single week March 2026). Market regime appears mild recovery from prior BEAR conditions.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state

## Jobs Status This Run (Run #17)

- **Medic**: PATTERN D — API unreachable (same persistent constraint). No code changes.
- **Scout**: RAN (96h+ since last scout, past 48h threshold) — searched trending pools via WebSearch; GeckoTerminal/DexScreener/CoinGecko all return 403 from this environment. Unable to verify specific candidates against quality criteria (liquidity >$100k, vol >$50k, age >3 days). No tokens added — standards maintained.
- **Auditor**: SKIPPED — cannot fetch live metrics (/api/trades, /api/portfolio, /api/patterns, /api/adaptive all return 403); trigger conditions unverifiable.

## Recommended Action for Henry

**This is the 17th consecutive run with the same network restriction. Action urgently required:**

1. **Add to Claude Code egress allowlist:**
   - `autonomous-trading-bot-production.up.railway.app`
   - `api.geckoterminal.com`
   - `api.dexscreener.com`
2. **Or** expose a read-only status webhook on an already-allowed domain
3. **Manually verify bot health:** https://autonomous-trading-bot-production.up.railway.app/health
4. **IMPORTANT:** Staging branch has many queued improvements (PnL sanitizers, prompt caching v21.20, sleeves, risk params). Consider promoting: `./scripts/deploy/stage.sh` → verify → `./scripts/deploy/promote.sh`
5. **Scout is overdue** (last ran 2026-04-20, 96h+ ago). Scout cannot run without GeckoTerminal or DexScreener access from this environment. Recommend Henry manually checking GeckoTerminal for new Base tokens.

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, persistent environmental constraint, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- Report committed to claude/cool-sagan-X9jOr branch per session instructions
