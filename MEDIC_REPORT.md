# MEDIC REPORT — 2026-04-19T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #8)

## Environment
- Run timestamp: 2026-04-19T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-JVAXA

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `403 Forbidden`:

```
curl -s https://autonomous-trading-bot-production.up.railway.app/api/errors
→ 403 Forbidden

curl -s https://autonomous-trading-bot-production.up.railway.app/api/balances
→ 403 Forbidden

curl -s https://autonomous-trading-bot-production.up.railway.app/api/trades
→ 403 Forbidden

curl -s https://autonomous-trading-bot-production.up.railway.app/api/portfolio
→ 403 Forbidden
```

Third-party crypto APIs also blocked (same egress restriction):
```
GET https://api.geckoterminal.com/api/v2/networks/base/trending_pools
→ 403 Forbidden

GET https://api.coingecko.com/api/v3/coins/...
→ 403 Forbidden

GET https://api.dexscreener.com/...
→ 403 Forbidden
```

## Root Cause

The Claude Code execution sandbox has an **egress proxy** that only allows outbound connections to a fixed allowlist of domains. The Railway deployment domain and third-party crypto APIs are **not on this allowlist**. This is a **persistent infrastructure constraint** — it does NOT indicate a bot failure.

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

- `2026-04-16 10:52 EDT` — Scout added BENJI to TOKEN_REGISTRY
- `2026-04-16 00:25 UTC` — Auditor tightened BREAKER_DAILY_DD_PCT 8→7 (bear-market)
- `2026-04-16 00:21 UTC` — Scout added SPX to TOKEN_REGISTRY
- `2026-04-15 16:35 UTC` — Auditor lowered KELLY_FRACTION 0.5→0.35 (bear-market)
- `2026-04-15 12:25 UTC` — Auditor lowered VOL_TARGET_DAILY_PCT 2→1.5 (bear-market)

Bot is alive and making autonomous adjustments.

## Token Scout Research (Run #8)

Scout threshold exceeded (last scout: 2026-04-16, ~72h ago). Conducted WebSearch-based research as fallback. **Candidates evaluated:**

| Token | Pool Age | Est. 24h Vol | Est. Liquidity | In Registry | Decision |
|-------|----------|-------------|----------------|-------------|---------|
| MEZO | 7 days | high (recent launch) | unknown | ✅ YES | Already added |
| AVAIL | unknown | ~$533k total all exchanges | unknown | ❌ No | ❌ Reject — vol is CEX-dominated, Base pool metrics unverifiable |
| TRX (Base OFT) | ~31 days | ~$1.32B total all chains | unknown | ❌ No | ❌ Reject — Base-specific contract address unconfirmed |

**Conclusion:** Cannot verify pool-specific metrics (liquidity > $100k USD, 24h DEX volume > $50k USD) for any candidate due to API egress restrictions. Standards maintained — no tokens added.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state
- Win rate, drawdown, or losing streak for Auditor trigger assessment

## Jobs Status This Run (Run #8)

- **Medic**: PATTERN D — API unreachable (persistent infra constraint, not a bot error)
- **Scout**: COMPLETED RESEARCH — last scout >48h ago; WebSearch fallback used; no tokens qualify (pool metrics unverifiable)
- **Auditor**: SKIPPED — cannot fetch live metrics from /api/* (403)

## Recommended Action for Henry

**This is the 8th consecutive run with the same network restriction. Urgent action required:**

1. **Add to egress allowlist:** `autonomous-trading-bot-production.up.railway.app`
2. **Add to egress allowlist:** `api.geckoterminal.com`
3. **Add to egress allowlist:** `api.coingecko.com`
4. **Alternative:** Expose a read-only status webhook that pushes to an already-allowlisted domain
5. **Manually verify bot health** at: https://autonomous-trading-bot-production.up.railway.app/health

**Bear market parameters** (set by previous auditor runs, still in effect):
- `KELLY_FRACTION`: 0.35 (was 0.5)
- `VOL_TARGET_DAILY_PCT`: 1.5% (was 2%)
- `BREAKER_DAILY_DD_PCT`: 7% (was 8%)

These tightenings from April 15-16 remain in place. No further tightening without fresh API metrics.

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, persistent environmental constraint, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- No tokens added to TOKEN_REGISTRY without verified metrics
- Report committed to claude/cool-sagan-JVAXA per session branch protocol
