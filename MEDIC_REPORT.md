# MEDIC REPORT — 2026-04-18T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #8)

## Environment
- Run timestamp: 2026-04-18T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-7YB6a

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `403 Forbidden`:

```
curl -s https://autonomous-trading-bot-production.up.railway.app/api/errors       → 403
curl -s https://autonomous-trading-bot-production.up.railway.app/api/balances     → 403
curl -s https://autonomous-trading-bot-production.up.railway.app/api/trades       → 403
curl -s https://autonomous-trading-bot-production.up.railway.app/api/portfolio    → 403
curl -s https://autonomous-trading-bot-production.up.railway.app/api/patterns     → 403
curl -s https://autonomous-trading-bot-production.up.railway.app/api/adaptive     → 403
```

GeckoTerminal, CoinGecko, DEXScreener APIs also blocked (same egress restriction):
```
GET https://api.geckoterminal.com/api/v2/networks/base/trending_pools → 403
GET https://api.coingecko.com/api/v3/coins/markets → 403
GET https://api.dexscreener.com/latest/dex/search → 403
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
| #8 | 2026-04-18T00:00 UTC | This report |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, the bot is clearly active and evolving:

- `2026-04-17` — governance: refuse to start on non-canonical CDP project (safety feature)
- `2026-04-17` — fix(rotation): route indexer through shared multi-endpoint rpcCall
- `2026-04-17` — feat(rotation): Phase 1 indexer + event log (NVR-SPEC-011)
- `2026-04-17` — feat(sleeves): capital sleeves scaffolding (NVR-SPEC-010)
- `2026-04-17` — fix(nvr-bot): bump marketData freshness gate 10→20min
- `2026-04-17` — fix(v21.18): re-enable Morpho yield service, unlock $740 USDC
- Previous: KELLY 0.35, VOL_TARGET 1.5%, BREAKER_DD 7% (bear-market tightening from runs #3-#5)

Bot is alive with active development. Code changes are being deployed regularly.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state
- Win rate, drawdown, market regime (needed for Auditor trigger)

## Jobs Status This Run (Run #8)

- **Medic**: PATTERN D — API unreachable, updating report
- **Scout**: SKIPPED — GeckoTerminal API blocked; cannot verify quality criteria (liquidity/volume/age). Last scout commit was 2026-04-16 10:52 EDT (~37-55h ago, borderline 48h window). Without verifiable data, standards cannot be met.
- **Auditor**: SKIPPED — cannot fetch live metrics; all /api/* endpoints return 403. Trigger conditions (win_rate, drawdown, regime) cannot be calculated without live data.

## Recommended Action for Henry

**This is now the 8th consecutive run with the same network restriction. Resolution required:**

1. **Add to egress allowlist** (highest priority):
   - `autonomous-trading-bot-production.up.railway.app` — for Medic and Auditor
   - `api.geckoterminal.com` — for Scout
   - `api.coingecko.com` and `api.dexscreener.com` — fallback data sources

2. **Alternative: Push-based monitoring** — have the bot POST its health summary to a GitHub Gist or GitHub API endpoint (already in allowlist) on each cycle

3. **Alternative: Read-only status file** — have the bot write a `BOT_STATUS.json` to this repo on each cycle (bot pushes → agent reads via git pull)

4. **Manually verify bot health** at: https://autonomous-trading-bot-production.up.railway.app/health

5. **Scout workaround**: Consider committing a `SCOUT_CANDIDATES.json` to the repo with GeckoTerminal data (bot writes it; agent reads it). The Scout can then read from that file instead of calling blocked APIs.

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, persistent environmental constraint, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- Report committed to claude/cool-sagan-7YB6a (staging equivalent for this run)
