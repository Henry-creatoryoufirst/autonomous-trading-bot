# MEDIC REPORT — 2026-04-25T00:00 UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #19)

## Environment
- Run timestamp: 2026-04-25T00:00 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: claude/cool-sagan-cFt6f

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `403 Forbidden`:

```
GET https://autonomous-trading-bot-production.up.railway.app/api/errors      → 403
GET https://autonomous-trading-bot-production.up.railway.app/api/balances    → 403
GET https://autonomous-trading-bot-production.up.railway.app/api/health      → 403
GET https://autonomous-trading-bot-production.up.railway.app/api/trades      → 403
GET https://autonomous-trading-bot-production.up.railway.app/api/portfolio   → 403
GET https://autonomous-trading-bot-production.up.railway.app/api/patterns    → 403
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
| #19 | 2026-04-25T00:00 UTC | Scout skipped (<48h); auditor lowered KELLY_ROLLING_WINDOW 50→25 |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, staging branch is extremely active. Since Run #18:

- `2026-04-25` — Auditor: KELLY_ROLLING_WINDOW 50→25 — faster bear-market Kelly adaptation (this run)
- `2026-04-24` — merge(staging): v21.24 CRITIC memory injection
- `2026-04-24` — feat(critic): v21.24 — inject CRITIC memory into heavy-cycle Sonnet prompts
- `2026-04-24` — feat(critic): v3 — round-trip BUY→SELL audit with alpha-capture counterfactual
- `2026-04-24` — merge(staging): v21.23 dry-powder cost-basis gate
- `2026-04-24` — fix(dry-powder): v21.23 cost-basis gate — stop rebalancing at a loss

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance, P&L, or win rate

## Jobs Status This Run (Run #19)

- **Medic**: PATTERN D — API unreachable (same persistent constraint). MEDIC_REPORT updated.
- **Scout**: SKIPPED — last scout ran 2026-04-24 09:07 UTC (~24h ago, under the 48h threshold). B3 was added last run.
- **Auditor**: Cannot verify live trigger conditions (all /api/* return 403). Bear market trigger inferred from prior reports (46-day bear as of 2026-04-24). Research ran 4 searches; KELLY_ROLLING_WINDOW 50→25 implemented (Impact 3, Complexity 1, Risk low, Priority 3.0). Key reasoning: a 50-trade window spans weeks of bull-era wins, systematically inflating Kelly-derived position sizes during a prolonged bear market. Halving to 25 trades means sizing reflects recent reality.

## Research Findings (Run #19 Auditor)

### Signal Quality (Search 1)
LLM-based bots combining multi-signal confluence are becoming standard. On-chain buy/sell ratio remains the dominant alpha signal on Base (67.5% of Uniswap DEX volume now on L2, concentrated institutional traders). NVR already weights flow at 35% via SWARM_AGENT_WEIGHTS. **No change needed — NVR architecture already aligned.**

### Execution Efficiency (Search 2)
Aerodrome Slipstream V2 (March 2026): 34x capital efficiency via multi-pool route splitting. Flashblocks deliver 10x faster execution on Base. **Not implementable ≤10 lines** — requires touching executeDirectDexSwap/executeSingleSwap (off-limits).

### Position Sizing (Search 3) — **IMPLEMENTED**
Adaptive Kelly Criterion: update Kelly calculations after every 20-25 trades; 50-trade windows over-extend into stale bull-era data. **KELLY_ROLLING_WINDOW 50→25** (Impact 3, Complexity 1, Risk low, Priority 3.0).

### Competitive Intelligence (Search 4)
MEV protection via MEVX (Flashbots Protect for Base) and 1inch Fusion+ (zero-slippage auctions). **Not implementable ≤10 lines** — requires execution layer changes. Watch list for Henry.

## Watch List (for Henry's review)

1. **Slipstream V2 multi-pool routing** — Impact 4/5. Aerodrome's March 2026 upgrade enables trade splitting across pools. Would need changes to executeDirectDexSwap to pass the new router selector. Estimated 30-50 line change.
2. **MEV protection via Flashbots Protect RPC** — Impact 4/5. Replacing or supplementing the BASE_RPC_URL with Flashbots Protect would prevent sandwich attacks on NVR's larger trades. Simple RPC swap but needs validation.
3. **1inch Fusion+ aggregation for large trades** — Impact 3/5. For trades >$500, routing through 1inch could get zero-slippage market-maker fills vs current DEX exposure. Would require new service integration.

## Recommended Action for Henry

**This is now the 18th consecutive run with the same network restriction. Urgent:**

1. **Add to Claude Code egress allowlist:**
   - `autonomous-trading-bot-production.up.railway.app`
   - `api.geckoterminal.com`
   - `api.dexscreener.com`
2. **Or** expose a lightweight read-only status endpoint on an already-allowed domain
3. **Manually verify bot health:** https://autonomous-trading-bot-production.up.railway.app/health
4. **Consider staging promotion:** `./scripts/deploy/stage.sh` → verify → `./scripts/deploy/promote.sh`
5. **Review watch list above** — Slipstream V2 routing + MEV protection are high-impact improvements worth scheduling.

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable — persistent environmental constraint, not a trade-error pattern)

## Safety
- 1 line changed in `src/core/config/constants.ts` (KELLY_ROLLING_WINDOW: 50→25)
- No changes to agent-v3.2.ts
- No production changes
- Committed to claude/cool-sagan-cFt6f only
