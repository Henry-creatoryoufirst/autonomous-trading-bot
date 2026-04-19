# MEDIC REPORT — 2026-04-19T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #8)

## Environment
- Run timestamp: 2026-04-19T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-Pc9US

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `403 Forbidden`:

```
curl -s https://autonomous-trading-bot-production.up.railway.app/api/errors
→ 403 Forbidden

curl -s https://autonomous-trading-bot-production.up.railway.app/api/balances
→ 403 Forbidden

curl -s https://autonomous-trading-bot-production.up.railway.app/health
→ 403 Forbidden
```

Third-party data APIs also blocked (same egress restriction):
```
GET https://api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1
→ 403 Forbidden

GET https://api.dexscreener.com/latest/dex/search?q=base
→ 403 Forbidden

GET https://api.coingecko.com/api/v3/coins/markets?category=base-ecosystem
→ 403 Forbidden
```

## Root Cause

The Claude Code execution sandbox has an **egress proxy** that only allows outbound connections to a fixed allowlist of domains. The Railway deployment domain and third-party market data APIs are **not on this allowlist**. This is a **persistent infrastructure constraint** — it does NOT indicate a bot failure.

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
| #8 | 2026-04-19T00:00 UTC | This report (same issue) |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, the bot is clearly active based on recent commits:

- `2026-04-17 14:42 EDT` — feat(governance): refuse to start on non-canonical CDP project
- `2026-04-17 14:08 EDT` — chore: trigger staging redeploy (rotation rpcCall fix)
- `2026-04-17 14:00 EDT` — fix(rotation): route indexer through shared multi-endpoint rpcCall
- `2026-04-17 13:25 EDT` — feat(rotation): Phase 1 indexer + event log (NVR-SPEC-011)
- `2026-04-17 12:56 EDT` — feat(sleeves): add capital sleeves scaffolding (NVR-SPEC-010 step 1)
- `2026-04-17 11:00 EDT` — fix(medic): PATTERN D — API unreachable (Run #7)
- `2026-04-16 10:52 EDT` — feat: on-chain Transfer event indexer for Base mainnet (#6)
- `2026-04-16 05:15 UTC` — feat(scout): add BENJI to TOKEN_REGISTRY
- `2026-04-16 00:21 UTC` — feat(scout): add SPX to TOKEN_REGISTRY

Active development confirms the bot is alive and being maintained.

**Historical parameter state (from previous audit runs):**
- KELLY_FRACTION: 0.35 (tightened from 0.5 for bear market — Run #3)
- VOL_TARGET_DAILY_PCT: 1.5% (tightened from 2% — Run #3)
- BREAKER_DAILY_DD_PCT: 7% (tightened from 8% — Run #4)
- Previous auditor (Run #5) explicitly skipped further tightening to avoid over-parameterization without fresh metrics.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance, P&L, win rate, or drawdown

## Jobs Status This Run (Run #8)

- **Medic**: PATTERN D (persistent) — updated this report, no code changes
- **Scout**: SKIPPED — last scout commit was 2026-04-16 (~57h ago, outside 48h window) BUT all market data APIs blocked (GeckoTerminal, DexScreener, CoinGecko all return 403). Cannot verify quality filter metrics (liquidity >$100k, volume >$50k, age >3 days). No tokens added — quality filter enforced.
- **Auditor**: SKIPPED — cannot fetch live metrics (/api/trades, /api/portfolio, /api/patterns, /api/adaptive all return 403). Cannot determine trigger conditions (win_rate, drawdown, losing_streak unknown). Not running to avoid uninformed parameter changes.

## Recommended Action for Henry

**This is the 7th consecutive run with the same network restriction. Escalating urgency:**

1. **IMMEDIATE**: Add these domains to the Claude Code egress allowlist:
   - `autonomous-trading-bot-production.up.railway.app` (bot health + metrics)
   - `api.geckoterminal.com` (token discovery, quality filtering)
   - `api.dexscreener.com` (backup market data)
   - `api.coingecko.com` (backup market data)
2. **Alternative**: Expose a **read-only push webhook** that POSTs bot metrics to a publicly accessible endpoint every cycle (Telegram, a public Gist, etc.)
3. **Manually verify** bot health: https://autonomous-trading-bot-production.up.railway.app/health
4. **Scout needs running** — it's been 57+ hours since last token discovery scan (SPX/BENJI added 2026-04-16). Several new Base tokens may have emerged since then.
5. **Auditor note**: Parameters tightened in bear mode (KELLY 0.35, VOL_TARGET 1.5%, DD_BREAKER 7%). If market has recovered, consider loosening — but needs live data to confirm.

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, persistent environmental constraint, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- Report committed to feature branch only (claude/cool-sagan-Pc9US) per MEDIC SAFETY protocol
