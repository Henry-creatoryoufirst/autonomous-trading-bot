# MEDIC REPORT — 2026-04-22T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #16)

## Environment
- Run timestamp: 2026-04-22T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-pmDLG

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `403 Forbidden`:

```
WebFetch: https://autonomous-trading-bot-production.up.railway.app/api/errors
→ 403 Forbidden

WebFetch: https://autonomous-trading-bot-production.up.railway.app/api/balances
→ 403 Forbidden

WebFetch: https://autonomous-trading-bot-production.up.railway.app/api/health
→ 403 Forbidden
```

Root cause confirmed: `src/dashboard/api.ts:118-121` — `isAuthorized()` requires
`Authorization: Bearer ${API_AUTH_TOKEN}` header. The `API_AUTH_TOKEN` env var is
set in Railway and unavailable to this execution environment.

GeckoTerminal API also blocked (same egress restriction):
```
WebFetch: https://api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1
→ 403 Forbidden
DexScreener API also blocked (403)
DefiLlama also blocked (403)
CoinMarketCap / CoinGecko web pages also blocked (403)
```

## Root Cause

The Claude Code execution sandbox has an **egress proxy** that only allows outbound
connections to a fixed allowlist of domains. The Railway deployment domain and most
third-party crypto data APIs are **not on this allowlist**. This is a **persistent
infrastructure constraint** — it does NOT indicate a bot failure.

**WebSearch is available** (used for Scout job this run).

**History of this issue:**
| Run # | Timestamp | Action |
|-------|-----------|--------|
| #1 | 2026-04-14T19:12 UTC | First PATTERN D report filed |
| #2–9 | 2026-04-15 → 2026-04-17 | PATTERN D updates |
| #10–14 | 2026-04-19 → 2026-04-20 | PATTERN D updates |
| #15 | 2026-04-21T00:00 UTC | PATTERN D update |
| #16 | 2026-04-22T00:00 UTC | This report |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, the branch is active with code improvements:

- `2026-04-21 16:03 UTC` — v21.19: dashboard-honesty — regime flowing + Core drawdown inherits bot peak
- `2026-04-21 15:32 UTC` — v21.18: SPEC-015 unblock — DRAWDOWN_OVERRIDE bypasses green-market loss gate
- `2026-04-21 15:14 UTC` — v21.17: dashboard-honesty — drawdownPct + regime wired into /api/sleeves/compare
- `2026-04-21 14:52 UTC` — v21.16: Sleeves Phase 2 — paper-trade simulation + Alpha Hunter v1 strategy
- `2026-04-21 13:49 UTC` — v21.15: multi-sleeve orchestrator + per-sleeve write-back
- `2026-04-20 21:09 UTC` — Scout added GHST (Aavegotchi) to TOKEN_REGISTRY

**Risk params in staging (not yet on main):** KELLY 0.35, VOL_TARGET 1.5%, BREAKER_DD 7%.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state

## Jobs Status This Run (Run #16)

- **Medic**: PATTERN D — API unreachable (persistent constraint). No code changes.
- **Scout**: EXECUTED (48h+ since last scout at 2026-04-20T21:09 UTC). WebSearch used
  as GeckoTerminal/DexScreener were blocked. No qualifying tokens found (details below).
- **Auditor**: SKIPPED — cannot fetch live metrics (all /api/* endpoints return 403);
  trigger conditions unverifiable.

## Scout Run This Cycle — Evaluated Candidates

| Token | Symbol | Chain | Liquidity | 24h Volume | Pool Age | Score | Verdict |
|-------|--------|-------|-----------|------------|----------|-------|---------|
| Blue AI Network | BLAI | Base | ~$83k | $122 | 30+ days | 1/10 | ❌ Volume too low |
| BaseX | BSX | Base | Unknown | $4.42 | 16+ months | 1/10 | ❌ Volume too low |
| Grass (bridged) | GRASS | Base (bridged) | $6.16k | ~$100 | Unknown | 2/10 | ❌ Liq + Vol fail |
| YieldBasis | YB | Ethereum mainnet | Unknown | $5.6M | 6+ months | N/A | ❌ Wrong chain |
| OpenGradient | OPG | Base | TGE April 21 | Unknown | 1 day | N/A | ❌ Pool age < 3 days |

**OPG Watch List:** OpenGradient (OPG) launched on Base via Coinbase/Binance TGE on
April 21, 2026. AI/ML infrastructure play — verifiable ML inference network on Base.
Coinbase listed it natively. **Re-evaluate in next scout run (pool will be 3+ days old).**
Potential contract: check BaseScan for OPG on Base before next run.

## Recommended Action for Henry

**This is the 16th consecutive run with the same network restriction. Action urgently required:**

1. **Add to Claude Code egress allowlist:**
   - `autonomous-trading-bot-production.up.railway.app`
   - `api.geckoterminal.com`
   - `api.dexscreener.com`
   - `defillama.com`
   - `coinmarketcap.com`
   - `coingecko.com`
2. **Or** expose a read-only status webhook on an already-allowed domain (WebSearch works)
3. **Manually verify bot health:** https://autonomous-trading-bot-production.up.railway.app/health
4. **IMPORTANT:** Branch `claude/cool-sagan-pmDLG` has many queued improvements
   (v21.15–v21.19 sleeves, exit logic, drawdown tracking). Consider promoting to main.
5. **OPG (OpenGradient):** Re-check after April 24 — should pass pool age filter.
   AI infrastructure token with major exchange backing and Base deployment.

## Pattern Classification
PATTERN D — Cannot Assess (API unreachable, persistent environmental constraint)

## Safety
- No code changes made to agent-v3.2.ts
- No production changes
- Report committed to branch per MEDIC SAFETY protocol
