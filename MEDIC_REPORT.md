# MEDIC REPORT — 2026-04-24T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #17)

## Environment
- Run timestamp: 2026-04-24T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-orMNr

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

The working branch (`claude/cool-sagan-orMNr`) is up-to-date with staging activity. Recent commits visible:

- `a54fd33` — fix(pnl): tighten daily-pnl phantom filter — catch 1:1 fallback signatures
- `69f9df3` — fix(pnl): per-trade phantom filter on daily-pnl rollup (v21.20.1 follow-on)
- `d064c8f` — fix(pnl): per-token phantom realized cleanup (v21.20.1)

Bot appears to be actively developed and deployed. Prior report (Run #16, 2026-04-21) noted staging was at v21.19; current branch is at v21.20+. No signs of bot failure based on commit activity.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state

## Jobs Status This Run (Run #17)

- **Medic**: PATTERN D — API unreachable (persistent constraint, Run #17). No code changes.
- **Scout**: EXECUTED via WebSearch (last scout was 2026-04-20 21:09 UTC, ~3.5 days ago, >48h threshold). 
  - GeckoTerminal API blocked; used WebSearch as fallback per protocol.
  - Evaluated: NORMIE, TYBG, AEROBUD, HYPER (Hyperlane), TRVL, EAT (WYDE), MOCHI, STABLE
  - Result: **No qualifying tokens** — all candidates failed one or more quality filters (liquidity >$100k, volume >$50k, pool age >3d). Standards maintained.
- **Auditor**: SKIPPED — cannot fetch live metrics (/api/trades, /api/portfolio, /api/patterns, /api/adaptive all return 403); trigger conditions unverifiable.

## Scout Candidate Summary (Run #17)

| Token | Market Cap | 24h Vol | Pool Liquidity | Pass? | Reason |
|-------|-----------|---------|----------------|-------|--------|
| NORMIE | ~$150k | ~$150 | ~$986 | ❌ | All metrics catastrophically low; contract exploit history |
| TYBG | ~$1.1M | ~$4.2k | ~$231k | ❌ | Volume too low ($4.2k < $50k) |
| AEROBUD | ~$1.3M | ~$60k | < $100k est. | ❌ | Liquidity unconfirmed, likely below $100k |
| HYPER | ~$953k | unknown | unknown | ❌ | Market cap too small, insufficient data |
| TRVL | ~$4.75M | $139 on-chain | ~$49k | ❌ | Pool liquidity ($49k < $100k) and volume both too low |
| EAT (WYDE) | ~$9.7M | ~$28k | unknown | ❌ | Volume too low ($28k < $50k) |
| MOCHI | < $100k | < $1k | ~$27k | ❌ | All metrics too low |
| STABLE | ~$655M | ~$23.5M | N/A | ❌ | Not a Base chain token; own L1 |

## Recommended Action for Henry

**This is the 16th consecutive run with the same network restriction. Action urgently required:**

1. **Add to Claude Code egress allowlist:**
   - `autonomous-trading-bot-production.up.railway.app`
   - `api.geckoterminal.com`
   - `api.dexscreener.com`
2. **Or** expose a read-only status webhook on an already-allowed domain
3. **Manually verify bot health:** https://autonomous-trading-bot-production.up.railway.app/health
4. **Token scout:** No new tokens to add this run. Registry is current at GHST (last added 2026-04-20).

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, persistent environmental constraint, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- Report committed to claude/cool-sagan-orMNr per branch assignment
