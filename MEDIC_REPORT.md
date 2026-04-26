# MEDIC REPORT — 2026-04-26T04:07 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #19)

## Environment
- Run timestamp: 2026-04-26T04:07 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working branch: claude/cool-sagan-lvsfM

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `403 Forbidden`:

```
GET https://autonomous-trading-bot-production.up.railway.app/api/errors      → 403
GET https://autonomous-trading-bot-production.up.railway.app/api/balances    → 403
GET https://autonomous-trading-bot-production.up.railway.app/api/health      → 403
GET https://autonomous-trading-bot-production.up.railway.app/api/trades      → 403
GET https://autonomous-trading-bot-production.up.railway.app/api/portfolio   → 403
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
| #19 | 2026-04-26T04:07 UTC | This report; Scout skipped (RNBW added 2h ago by prior run); auditor raised MOMENTUM_EXIT_BUY_RATIO 45→47 |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, staging branch is extremely active. Since Run #18:

- `2026-04-26T02:11` — Scout: RNBW added to TOKEN_REGISTRY (prior agent run, 2h ago)
- `2026-04-24` — Scout: B3 (B3 Gaming Chain) added to TOKEN_REGISTRY
- `2026-04-24` — Auditor: HOT_MOVER_MIN_CHANGE_H1_PCT 5→7
- `2026-04-24` — v21.24: CRITIC memory injection into heavy-cycle Sonnet prompts
- `2026-04-24` — v21.23: dry-powder cost-basis gate (stop rebalancing at a loss)
- `2026-04-24` — v21.22: compact routine prompt — unlock cheap-tier routing
- `2026-04-23` — Scout: MOG + TYBG added
- `2026-04-23` — Auditor: LARGE_TRADE_THRESHOLD_USD 5000→2500
- `2026-04-23` — Scout: OVPP + RAVE added

**Staging is substantially ahead of main** — v21.24+ queued including CRITIC round-trip audit, dry-powder cost-basis gate, compact routing improvements.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance, P&L, or win rate

## Jobs Status This Run (Run #19)

- **Medic**: PATTERN D — API unreachable (same persistent constraint, 19th consecutive run). No changes to agent-v3.2.ts.
- **Scout**: SKIPPED — RNBW scout commit was 2 hours ago (2026-04-26T02:11 UTC), well within 48h window.
- **Auditor**: Cannot verify live trigger conditions (all /api/* return 403). Bear market regime inferred from 46-day bear confirmed previous run. Research ran 4 searches. TOP FINDING: MOMENTUM_EXIT_BUY_RATIO 45→47 implemented (Impact 3, Complexity 1, Risk low, Priority 3.0).

## Auditor Research Summary (Run #19)

### Signal Quality
- Layered intelligence architecture (Nansen/Arkham + execution) is emerging best practice
- Smart-money wallet tracking across 20+ chains now common in advanced bots
- NVR has on-chain flow (buy ratio) — no wallet-tracking gap is implementable in ≤10 lines → Watch List

### Execution Efficiency
- Aerodrome Slipstream V2 (March 2026): 34x capital efficiency improvement, auto multi-pool splitting
- NVR already uses Slipstream — routing improvement is in protocol, not bot config
- Flashblocks on Base: 10x faster execution → already leveraged via RPC endpoints
- No actionable ≤10-line change found here

### Position Sizing
- Kelly-VAPS (Kelly + ATR) is mainstream in 2026; professional range is Quarter–Half Kelly
- NVR at KELLY_FRACTION=0.35 (well-calibrated for bear market)
- Finding: exit triggers should be tighter in bear — waves fail faster
- **IMPLEMENTED**: MOMENTUM_EXIT_BUY_RATIO 45→47 — exit when buy-flow drops to barely net-selling (53% sellers) not deeply net-selling (55%). In 46-day bear, waves reverse in 1-2 cycles; 2pp tighter threshold catches wave deaths earlier.

### Competitive Intelligence
- MEV-protected RPCs enable tighter slippage (1-2% vs 5% on unprotected) — NVR already uses sequencer-direct RPC
- Swing bots outperform DCA bots in bear markets by design — NVR is swing-oriented ✓
- Smart-money monitoring (mempool + Discord) is growing edge; not implementable in ≤10 lines → Watch List

## Recommended Action for Henry

**This is now the 19th consecutive run with the same network restriction. Urgent:**

1. **Add to Claude Code egress allowlist:**
   - `autonomous-trading-bot-production.up.railway.app`
   - `api.geckoterminal.com`
   - `api.dexscreener.com`
2. **Or** expose a lightweight read-only status endpoint on an already-allowed domain
3. **Manually verify bot health:** https://autonomous-trading-bot-production.up.railway.app/health
4. **Review staging → promote to main:** MOMENTUM_EXIT_BUY_RATIO 45→47 is bear-market defensive; recommend reviewing alongside the v21.22–v21.24 stack already queued on staging.

## Watch List (Too Complex for Auto-Implementation)

- **Smart-money wallet tracking**: Monitor specific labeled wallets (Nansen/Arkham-style) for early entry signals. Would require new service + persistent wallet list. High impact, high complexity.
- **Aerodrome V2 multi-path routing**: Splitting NVR swaps across multiple pools for lower price impact. Requires execution-layer changes (executeSingleSwap/executeDirectDexSwap) — AUDITOR SAFETY prohibits this.

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable — persistent environmental constraint, not a trade-error pattern)

## Safety
- No changes to agent-v3.2.ts
- No production changes
- Only constants.ts modified (1 line: MOMENTUM_EXIT_BUY_RATIO 45→47)
- No TOKEN_REGISTRY modifications
