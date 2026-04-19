# MEDIC REPORT — 2026-04-19T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #8)

## Environment
- Run timestamp: 2026-04-19T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-sFcRy (no staging branch exists locally)

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `403 Forbidden`:

```
curl -s https://autonomous-trading-bot-production.up.railway.app/api/errors   → 403
curl -s https://autonomous-trading-bot-production.up.railway.app/api/balances  → 403
curl -s https://autonomous-trading-bot-production.up.railway.app/api/trades    → 403
curl -s https://autonomous-trading-bot-production.up.railway.app/api/portfolio → 403
```

GeckoTerminal, DexScreener, CoinGecko, and DefiLlama APIs also blocked (same egress restriction):
```
GET https://api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1 → 403
GET https://api.dexscreener.com/latest/dex/search/?q=ghst                    → 403
GET https://www.coingecko.com/en/categories/base-ecosystem                   → 403
GET https://defillama.com/protocol/aavegotchi                                → 403
```

## Root Cause

The Claude Code execution sandbox has an **egress proxy** that only allows outbound connections to a fixed allowlist of domains. The Railway deployment domain and third-party DeFi APIs are **not on this allowlist**. This is a **persistent infrastructure constraint** — it does NOT indicate a bot failure.

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

Despite API being unreachable from medic, the bot is clearly active and under development:

- `2026-04-19` — feat(governance): refuse to start on non-canonical CDP project
- `2026-04-18` — chore: trigger staging redeploy for rotation rpcCall fix
- `2026-04-18` — fix(rotation): route indexer through shared multi-endpoint rpcCall
- `2026-04-17` — feat(rotation): Phase 1 indexer + event log (NVR-SPEC-011)
- `2026-04-17` — feat(sleeves): add capital sleeves scaffolding (NVR-SPEC-010)
- `2026-04-16 05:15 UTC` — Scout added BENJI to TOKEN_REGISTRY
- `2026-04-16 00:21 UTC` — Scout added SPX to TOKEN_REGISTRY
- `2026-04-15 16:35 UTC` — Auditor lowered KELLY_FRACTION 0.5→0.35 (bear-market)

Bot is alive and under active development. Most recent commits are feature work (rotation indexer, capital sleeves, governance).

## Scout Assessment (this run — 3+ days since last scout)

Scout was attempted via WebSearch (GeckoTerminal primary sources blocked). One candidate surfaced:

| Token | Symbol | Base Address | 24h Vol | Liquidity | Pool Age | In Registry | Verdict |
|-------|--------|-------------|---------|-----------|----------|-------------|---------|
| Aavegotchi | GHST | 0xcD2F22236DD9Dfe2356D7C543161D4d260FD9BcB | ~$1.7M global (Base share unknown) | DAO proposed $500k Aerodrome (current unverifiable) | >3d (migrated 2025) | No | **REJECTED** — cannot verify Base-specific metrics |

**No tokens added.** Quality filter requires verified on-chain data (pool liquidity, 24h Base volume, pool age) which requires GeckoTerminal/DexScreener access — both blocked. Adding unverified tokens risks bot attempting trades in illiquid pools.

GHST is a strong watch-list candidate once API access is restored — migrated to Base in 2025, Aerodrome pool with DAO-funded liquidity, $1.7M global 24h volume, well-established NFT gaming project (coingeckoId: "aavegotchi").

## Auditor Assessment (this run)

**SKIPPED** — Auditor triggers require `/api/trades`, `/api/portfolio`, `/api/patterns`, `/api/adaptive` — all returning 403. Cannot compute win_rate, drawdown, or losing_streak.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state

## Recommended Action for Henry

**This is the 8th consecutive run with the same network restriction:**

1. **Priority**: Add `autonomous-trading-bot-production.up.railway.app` to the Claude Code egress allowlist in settings
2. **Also add**: `api.geckoterminal.com` and `api.dexscreener.com` for Scout to function
3. **Alternative**: Expose a read-only status webhook on a domain already in the allowlist
4. **Scout watch-list**: GHST (Aavegotchi) on Base — verify manually at basescan.org or GeckoTerminal when accessible
5. Manually verify bot health: https://autonomous-trading-bot-production.up.railway.app/health

## Pattern Classification
PATTERN D — Cannot Assess (API unreachable, persistent egress allowlist constraint, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts or token-registry.ts
- No production changes
- Report committed to claude/cool-sagan-sFcRy branch (no staging branch exists locally)
