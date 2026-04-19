# MEDIC REPORT — 2026-04-19T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #8)

## Environment
- Run timestamp: 2026-04-19T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-OOLuA

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `403 Forbidden`:

```
curl -s https://autonomous-trading-bot-production.up.railway.app/api/errors
→ 403 Forbidden

curl -s https://autonomous-trading-bot-production.up.railway.app/api/balances
→ 403 Forbidden
```

GeckoTerminal API also blocked (same egress restriction):
```
GET https://api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1
→ 403 Forbidden
```

DexScreener, CoinGecko API, and all third-party market data APIs also return 403.

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

Despite API being unreachable from medic, the bot is clearly active based on recent commits:

- `2026-04-19` — Governance: refuse to start on non-canonical CDP project (safety hardening)
- `2026-04-18` — RPC call rotation fix (multi-endpoint indexer)
- `2026-04-18` — Capital sleeves scaffolding (NVR-SPEC-010)
- `2026-04-17` — Market data freshness gate bumped 10→20min
- `2026-04-17` — Morpho yield service re-enabled ($740 USDC unlocked from vault)
- `2026-04-16` — Scout added BENJI to TOKEN_REGISTRY
- `2026-04-16` — Auditor tightened BREAKER_DAILY_DD_PCT 8→7 (bear-market)
- `2026-04-15` — Auditor lowered KELLY_FRACTION 0.5→0.35 (bear-market)
- `2026-04-15` — Auditor lowered VOL_TARGET_DAILY_PCT 2→1.5 (bear-market)

Bot is alive and actively evolving. Development velocity is high.

## Current Parameter State (from constants.ts)

All parameters already at bear-market defensive posture from previous auditor runs:
- `KELLY_FRACTION = 0.35` (was 0.5; Quarter-Kelly range)
- `VOL_TARGET_DAILY_PCT = 1.5` (was 2; tightens VAPS multiplier ~25%)
- `BREAKER_DAILY_DD_PCT = 7` (was 8; earlier circuit-breaker pause)
- `VOL_HIGH_THRESHOLD = 6` (was 8; earlier 60% size reduction trigger)
- `TRENDING_DOWN regime multiplier = 0.75` (was 0.85)
- `KELLY_POSITION_CEILING_PCT = 14` (was 18)

## Jobs Status This Run (Run #8)

### Medic
PATTERN D (API unreachable) — no code changes, no critical trade failure confirmed.

### Scout
FULL RUN — last scout commit was 2026-04-16 10:52 EDT (3 days ago, > 48h threshold).

**Candidates evaluated:**
| Token | Liquidity | 24h Vol | Verdict |
|-------|-----------|---------|---------|
| TYBG (Base God) | ~$231-570k | ~$1.1k on-chain / $85k claimed (CEX inflation) | REJECTED — on-chain pool volume below $50k threshold |
| MOCHI | ~$27k | ~$0 | REJECTED — far below both thresholds |
| GEKO | ~$55k | ~$30 | REJECTED — far below both thresholds |
| ODOS | unknown (Base-specific) | $268k claimed (all 14 chains) | REJECTED — Bybit-delisted for low liquidity; Base-specific data unverifiable |
| TRX (Base bridge) | unknown | unknown | REJECTED — Base contract address not findable from available sources |

**Result:** No qualifying tokens — standards maintained.

### Auditor
FULL RESEARCH RUN — bear market > 48h inferred from previous auditor runs (confirmed Apr-15 through Apr-16 commits).

**Research findings scored:**

| Finding | Source | Impact | Complexity | Priority | Risk | Action |
|---------|--------|--------|------------|----------|------|--------|
| Smart money wallet tracking (Nansen-style confluence) | WebSearch signal quality research | 4 | 5 | 0.8 | medium | Watch list — too complex for auto-patch |
| Aerodrome MetaDEX 03 routing (Q2 2026) | CoinMarketCap AERO updates | 2 | 5 | 0.4 | medium | Watch list — not yet released |
| Bear market Kelly: drawdown-aware floor scaling | Medium / TradingView research | 3 | 2 | 1.5 | low | Watch list — below priority ≥2.0 threshold |
| MEV protection via private RPC endpoints | QuickNode guides | 3 | 4 | 0.75 | medium | Watch list — requires infra changes |
| Raise NORMAL_CONFLUENCE_BUY for bear entry discipline | Research synthesis | 3 | 1 | 3.0 | low | **Skipped** — params already at maximum defensive posture; unsafe without fresh win_rate data |

**Implementation decision:** NO changes applied. Reasoning:
1. Only one qualifying finding (NORMAL_CONFLUENCE_BUY raise) — but raising further risks locking the bot out of all trades in a potential recovery
2. All bear-tightening parameters already at auditor-set defensive levels from Apr-15/Apr-16 runs
3. API unreachable → cannot verify current win_rate, drawdown, or market regime; implementing without these metrics violates auditor safety protocol
4. Previous auditor (Run #5 notes) explicitly flagged risk of over-tightening

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance or P&L state
- Whether market regime has shifted out of bear

## Watch List for Henry's Review

1. **Smart Money Wallet Tracking** — Track wallets of known profitable traders on Base and add their accumulation pattern as a new confluence signal. Would require Nansen API or custom indexer. High alpha edge but significant implementation work.

2. **Aerodrome MetaDEX 03** (Q2 2026) — When Aero Unification ships, review routing code to take advantage of new DEX operating system improvements. May reduce gas costs.

3. **MEV Protection** — Review if bot uses public RPCs for trade submission. Premium private endpoints (QuickNode, Alchemy) with MEV protection could reduce sandwich attack losses. Worth auditing current RPC config.

4. **NORMAL_CONFLUENCE_BUY raise (27 or 28)** — If win_rate drops below 40% or bear market is confirmed via API metrics in the next run, this would be a safe 1-line change to tighten entry discipline.

## Recommended Action for Henry

**Run #8 of the same network restriction. Priority actions:**

1. **URGENT**: Add `autonomous-trading-bot-production.up.railway.app` to the Claude Code egress allowlist — medic has been blind for 5 days
2. Add `api.geckoterminal.com`, `api.dexscreener.com`, `api.coingecko.com` to allowlist for Scout/Auditor
3. Alternatively, expose a **read-only webhook** that pushes bot health to an allow-listed domain
4. Manually verify bot health at: https://autonomous-trading-bot-production.up.railway.app/health
5. Review Watch List items above when API access is restored

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable, persistent environmental constraint, not a trade-error pattern)

## Safety
- No code changes made to agent-v3.2.ts or constants.ts
- No production changes
- Report committed to feature branch per session instructions
