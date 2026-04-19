# MEDIC REPORT — 2026-04-19T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #8)

## Environment
- Run timestamp: 2026-04-19T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-n5zR4

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

GeckoTerminal API and DexScreener also blocked (same egress restriction):
```
GET https://api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1
→ 403 Forbidden

GET https://dexscreener.com/base
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
| #8 | 2026-04-19T00:00 UTC | This report (same issue) |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, the bot is clearly active based on git log:

- `2026-04-16 feat(governance)` — refuse to start on non-canonical CDP project
- `2026-04-16 feat(rotation)` — Phase 1 indexer + event log (NVR-SPEC-011)
- `2026-04-16 feat(sleeves)` — capital sleeves scaffolding (NVR-SPEC-010)
- `2026-04-16 fix(rotation)` — route indexer through shared multi-endpoint rpcCall
- `2026-04-16 fix(nvr-bot)` — bump marketData freshness gate 10min → 20min
- `2026-04-16 fix(v21.18)` — re-enable Morpho yield service

Bot is alive and receiving active development commits.

**Run #5 Auditor Note:** Bear market trigger confirmed by 3 auditor runs in last 22h.
Parameters already tightened (KELLY 0.35, VOL_TARGET 1.5%, BREAKER_DD 7%).
No further tightening has been applied since Run #5 to prevent over-correction.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state
- Win rate, drawdown, or losing streak for Auditor trigger assessment

## Jobs Status This Run (Run #8)

- **Medic**: PATTERN D — API unreachable (persistent environmental constraint)
- **Scout**: SKIPPED — GeckoTerminal and DexScreener blocked; cannot verify quality
  criteria (liquidity > $100k, volume > $50k). Last scout was 2026-04-16 10:52 EDT
  (~73h ago, over 48h window). WebSearch attempted but returned only general market
  overviews without verifiable on-chain metrics.
- **Auditor**: SKIPPED — cannot fetch live metrics (/api/trades, /api/portfolio,
  /api/patterns, /api/adaptive all return 403); trigger conditions cannot be assessed.

## Recommended Action for Henry

**This is the 8th consecutive run with the same network restriction. Action required:**

1. Add `autonomous-trading-bot-production.up.railway.app` to the Claude Code egress allowlist
2. Also add `api.geckoterminal.com` and `dexscreener.com` to the allowlist for Scout
3. Alternatively, expose a **read-only status webhook** that pushes to a domain already
   in the allowlist (e.g., a GitHub Gist, Pastebin, or public endpoint)
4. Manually verify bot health at: https://autonomous-trading-bot-production.up.railway.app/health
5. Consider Henry reviewing the scout manually — last token additions were 73h ago

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, persistent environmental
constraint, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- Report updated on claude/cool-sagan-n5zR4 per MEDIC SAFETY protocol
