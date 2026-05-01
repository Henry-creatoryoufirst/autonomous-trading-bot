# MEDIC REPORT — 2026-05-01T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #22)

## Environment
- Run timestamp: 2026-05-01T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-69uLW

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
| #19 | 2026-04-27T05:13 UTC | Scout no qualifying tokens; auditor raised RIDE_THE_WAVE_MIN_MOVE 5→7 (F&G 31, Fear) |
| #20 | 2026-04-27T~current UTC | Scout skipped (RNBW added Apr-26, <48h ago); auditor lowered KELLY_ROLLING_WINDOW 50→30 (bear win-rate responsiveness) |
| #21 | 2026-04-30T06:08 UTC | Scout skipped (SPECTRA added Apr-28 13:13, <48h ago); auditor lowered SURGE_MAX_CAPITAL_PER_TOKEN_PCT 25→20 (52-day bear surge-trap defense) |
| –   | 2026-05-01T~02:00 UTC | Scout: cbADA + cbDOGE added to TOKEN_REGISTRY (Coinbase-wrapped assets) |
| –   | 2026-05-01T~03:00 UTC | Auditor: NORMAL_CONFLUENCE_BUY 25→27 (bear market signal discipline) |
| –   | 2026-05-01T~04:00 UTC | Scout: NOICE added to TOKEN_REGISTRY |
| –   | 2026-05-01T~04:30 UTC | Auditor: HOT_MOVER_MIN_BUY_RATIO 0.55→0.60 (bear market signal quality) |
| –   | 2026-05-01T05:14 UTC | Scout: FAI + GIZA added to TOKEN_REGISTRY |
| #22 | 2026-05-01T00:00 UTC | Scout skipped (<48h, last ran 05:14 UTC today); Auditor skipped (API blocked, 3 changes already made today, avoiding over-tuning) |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, staging branch is extremely active. Since Run #21:

- `2026-05-01` — Scout: cbADA (Coinbase-wrapped ADA) added to TOKEN_REGISTRY
- `2026-05-01` — Scout: cbDOGE (Coinbase-wrapped DOGE) added to TOKEN_REGISTRY
- `2026-05-01` — Auditor: NORMAL_CONFLUENCE_BUY 25→27 (tightening bear-market buy discipline)
- `2026-05-01` — Scout: NOICE added to TOKEN_REGISTRY
- `2026-05-01` — Auditor: HOT_MOVER_MIN_BUY_RATIO 0.55→0.60 (raising hot-mover buy quality bar)
- `2026-05-01` — Scout: FAI (Fair AI?) + GIZA added to TOKEN_REGISTRY
- `2026-04-29` — smart-wallet attribution fix (multi-RPC fallback + universe scan) merged to main

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance, P&L, or win rate

## Jobs Status This Run (Run #22 — 2026-05-01)

- **Medic**: PATTERN D — API unreachable (persistent constraint, 403 on all endpoints). MEDIC_REPORT updated (Run #22).
- **Scout**: SKIPPED — last scout ran 2026-05-01T05:14 UTC (FAI + GIZA added), well under 48h threshold.
- **Auditor**: SKIPPED — API blocked, cannot verify trigger metrics (win_rate, drawdown, streak). Three auditor changes already made today by prior runs. Skipping to avoid over-tuning without fresh data.

## Auditor Research Summary (Run #21 — 2026-04-30)
- **Signal Quality**: Whale tracking + volume confirmation already implemented (LARGE_TRADE_THRESHOLD_USD=2500, HOT_MOVER_MIN_BUY_RATIO=0.55). No new action.
- **Execution Efficiency**: Aerodrome Slipstream V2 (March 2026, 34× cap efficiency) — bot auto-benefits from DEX-level improvements without code change needed.
- **Position Sizing**: KEY FINDING — Kelly/volatility research confirms reducing max per-token allocation in sustained bear markets. SURGE events in 52-day bear are statistically likely dead-cat bounces. IMPLEMENTED: SURGE_MAX_CAPITAL_PER_TOKEN_PCT 25→20. (Impact 3, Complexity 1, Risk low, Priority 3.0)
- **Competitive Intelligence**: CoW Swap intent-based execution ($9B/mo, 34.3% DEX aggregator share). Intent routing requires touching executeDirectDexSwap (off-limits for auto-implementation). Watch list for Henry.

## Auditor Research Summary (Run #20)
- **Signal Quality**: Large-tx whale tracking already implemented (LARGE_TRADE_THRESHOLD_USD=2500). No new action.
- **Execution Efficiency**: Aerodrome Slipstream V2 routing update confirmed (March 2026) — bot auto-benefits from DEX-level improvements without code change needed.
- **Position Sizing**: KEY FINDING — Recent-window Kelly (30 trades) outperforms 50-trade window in bear markets per crypto Kelly criterion research. IMPLEMENTED: KELLY_ROLLING_WINDOW 50→30.
- **Competitive Intelligence**: Intent-based solver routing emerging. Complex (high) — watchlist for future implementation.

## Recommended Action for Henry

**This is now the 22nd run with the same network restriction. Urgent:**

1. **Add to Claude Code egress allowlist:**
   - `autonomous-trading-bot-production.up.railway.app`
   - `api.geckoterminal.com`
   - `api.dexscreener.com`
2. **Or** expose a lightweight read-only status endpoint on an already-allowed domain
3. **Manually verify bot health:** https://autonomous-trading-bot-production.up.railway.app/health
4. **Consider staging promotion:** `./scripts/deploy/stage.sh` → verify → `./scripts/deploy/promote.sh`

## Today's Token Registry Additions (2026-05-01, earlier runs)

New tokens added to staging today — pending review before staging promotion:
- **cbADA** — Coinbase-wrapped Cardano (BLUE_CHIP or similar)
- **cbDOGE** — Coinbase-wrapped Dogecoin
- **NOICE** — unknown category (meme?)
- **FAI** — unknown category (AI token?)
- **GIZA** — unknown category (DeFi?)

Henry: verify these additions in `src/core/config/token-registry.ts` on staging before promoting.

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable — persistent environmental constraint, not a trade-error pattern)

## Safety
- No changes to agent-v3.2.ts
- No production changes
- MEDIC_REPORT.md updated; committed to claude/cool-sagan-69uLW branch
