# MEDIC REPORT — 2026-04-23T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #17)

## Environment
- Run timestamp: 2026-04-23T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-ZpkzL

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

DexScreener API also blocked:
```
GET https://api.dexscreener.com/latest/dex/tokens/base
→ 403 Forbidden
```

## Root Cause

The Claude Code execution sandbox has an **egress proxy** that only allows outbound connections to a fixed allowlist of domains. The Railway deployment domain and third-party APIs are **not on this allowlist**. This is a **persistent infrastructure constraint** — it does NOT indicate a bot failure.

Note: The bot API additionally requires a `Bearer <API_AUTH_TOKEN>` header, which is auto-generated at startup and not available to the medic agent. Even if the Railway domain were allowlisted, authentication would be required.

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
| #17 | 2026-04-23T00:00 UTC | This report (same issue) |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, the bot codebase continues active development. Since Run #16 (2026-04-21T09:00), the branch shows:

- `a54fd33` — fix(pnl): tighten daily-pnl phantom filter — catch 1:1 fallback signatures
- `69f9df3` — fix(pnl): per-trade phantom filter on daily-pnl rollup (v21.20.1 follow-on)
- `d064c8f` — fix(pnl): per-token phantom realized cleanup (v21.20.1)
- `2fdd016` — Merge fix/realized-pnl-poison-2026-04-18 into staging
- `9818b94` — Merge fix/payout-accrual-2026-04-22 into staging

Active P&L fixes merged into staging confirm the bot is running and development is ongoing. The phantom P&L / payout accrual fixes suggest the team is actively addressing realized P&L accuracy.

Earlier evidence still valid from prior runs:
- `2026-04-20 21:09 UTC` — Scout added GHST (Aavegotchi) to TOKEN_REGISTRY
- `2026-04-20 05:12 UTC` — Scout added AXL (Axelar) to TOKEN_REGISTRY
- `2026-04-19 21:11 UTC` — Scout added ETHY (Ethy AI by Virtuals) to TOKEN_REGISTRY
- `2026-04-18 22:15 UTC` — Auditor raised stagnation threshold 4h→6h (extreme-fear RANGING)
- `2026-04-16 00:25 UTC` — Auditor tightened BREAKER_DAILY_DD_PCT 8→7 (bear-market)
- `2026-04-15 16:35 UTC` — Auditor lowered KELLY_FRACTION 0.5→0.35 (bear-market)

## Scout Run This Cycle (Run #17)

Last scout was 2026-04-20T21:09 UTC — **>48 hours ago**, so Scout was eligible to run.

Scout attempted to fetch GeckoTerminal trending/new pools → 403 blocked. Web searches were conducted as fallback for token discovery.

**Candidates evaluated:**

| Token | 24h DEX Vol | Liquidity | Pool Age | Decision |
|-------|------------|-----------|----------|----------|
| ODOS (Base) | $0 (DEX pools dead) | $0 | 2022 | ❌ FAIL: no active DEX pool on Base |
| UP (Superform) | Unverified ($9.58M total, mostly CEX) | Unverified | Feb 2026 | ❌ FAIL: cannot verify DEX liquidity >$100k |
| A0X | $1,349 | $88k | 2024 | ❌ FAIL: volume far below $50k threshold |
| PONKE (Base bridged) | $0 on Base DEX pools | Near $0 | Q1 2025 | ❌ FAIL: Solana-native, Base pools dead |
| TYBG (Base God) | $4,216 | Unknown | 2024 | ❌ FAIL: volume below $50k threshold |
| NORMIE | $148 | Unknown | 2024 | ❌ FAIL: volume far below threshold |

**Scout verdict: No qualifying tokens this scan — standards maintained.**

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state
- win_rate, drawdown, or losing_streak for Auditor trigger conditions

## Jobs Status This Run (Run #17)

- **Medic**: PATTERN D — API unreachable (same persistent constraint). No code changes.
- **Scout**: RAN — >48h since last scout. No qualifying tokens found (6 candidates evaluated, all failed quality filters). No changes made.
- **Auditor**: SKIPPED — cannot fetch /api/trades, /api/portfolio, /api/patterns, /api/adaptive (all 403); trigger conditions unverifiable.

## Recommended Action for Henry

**This is the 17th consecutive run with the same network restriction. Action urgently required:**

1. **Add to Claude Code egress allowlist:**
   - `autonomous-trading-bot-production.up.railway.app`
   - `api.geckoterminal.com`
   - `api.dexscreener.com`

2. **Or** set `API_AUTH_TOKEN` env var in Railway to a known static value, then add the Railway URL to the allowlist

3. **Manually verify bot health:** https://autonomous-trading-bot-production.up.railway.app/health

4. **Staging branch status:** Multiple P&L fixes (phantom filter, payout accrual) have been merged — consider promoting to main: `./scripts/deploy/promote.sh`

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, persistent environmental constraint, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts or token-registry.ts
- No production changes
- Report committed per medic protocol
