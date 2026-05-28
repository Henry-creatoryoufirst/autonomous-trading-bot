# NVR Cohort Proposal — 2026-05-28

**Written by:** Hourly agent run (scout + auditor)  
**Status:** Proposal only — awaiting human review. No TOKEN_REGISTRY changes made (Option B cohort lock active until ~2026-06-15).  
**Branch:** claude/cool-sagan-rbefA

---

## Why this file exists

CLAUDE.md Rule 1 prohibits auto-commits of `feat(scout): add <SYMBOL> to TOKEN_REGISTRY` during the Option B benchmark window. This file captures scout research and intelligence for Henry's review.

---

## Job 1 — Medic

**Result: API UNREACHABLE — cannot assess bot health.**

The Railway production API (`autonomous-trading-bot-production.up.railway.app`) returned HTTP 403 "Host not in allowlist" from this remote execution environment. Both `/api/errors` and `/api/balances` are blocked by the environment's outbound network policy.

**No critical condition was detected** (but health cannot be confirmed). This environment cannot reach Railway endpoints. Henry should manually check the bot dashboard or Railway logs if concerned.

---

## Job 2 — Scout (48h threshold met — last scout 2026-05-25)

### Data source constraints

GeckoTerminal API (`api.geckoterminal.com`) was also blocked by the network policy. The full quality filter (liquidity >$100k, volume >$50k, pool age >3 days) could not be run against live on-chain data.

Web search was used for qualitative research only.

### No verified candidates this scan

Without GeckoTerminal data, no token passed the quantitative quality filter. Standards maintained.

### Key market intelligence (for Henry's awareness)

**1. Aerodrome MEV-resistant pool migration — HIGH RELEVANCE**  
Aerodrome completed a platform upgrade to MEV-resistant pools on May 23, 2026. All LPs are required to migrate to new pools to continue earning rewards. Since the bot routes 50%+ of its swaps through Aerodrome Slipstream, **Henry should verify the bot's routing logic is targeting the current pool contracts** — old pool addresses may have thin or no liquidity post-migration.

Reference: https://coinmarketcap.com/cmc-ai/aerodrome-finance/latest-updates/

**2. Aerodrome cross-chain "Aero" DEX — July 2026**  
Aerodrome and Velodrome (Optimism) are merging into a unified cross-chain "Aero" DEX launching July 2026. This is a future routing expansion opportunity.

**3. Base MCP (May 26, 2026)**  
Base launched a Model Context Protocol gateway connecting Uniswap, Morpho, Avantis, Bankr, Virtuals, and Aerodrome — enabling AI agents (including Claude) to execute DeFi actions via natural language. Narrative driver for AI agent tokens (VIRTUAL, AIXBT already in registry).

**4. Robinhood lists AERO (May 22, 2026)**  
AERO received Robinhood Legend listing — increased retail visibility for the protocol. AERO already in registry.

### Tokens NOT in registry that may be worth evaluating post-window

These came up in research but cannot be verified against the quality filter without GeckoTerminal access. Henry should validate before any PR:

| Candidate | Reason to evaluate | Risk |
|-----------|-------------------|------|
| AgentLayer | Listed alongside VIRTUAL/AlphaPepe in "Best AI Agent Coins on Base 2026" — no verified liquidity data | HIGH |
| AlphaPepe | Same source — AI agent narrative, but meme token risk | HIGH |

No addresses or on-chain data available from this scan — these are leads only.

---

## Job 3 — Auditor

**Result: SKIPPED — API unreachable.**

`/api/trades`, `/api/portfolio`, `/api/patterns`, and `/api/adaptive` all returned 403 from this environment. Cannot calculate win_rate, drawdown, or losing_streak to check trigger conditions.

### Strategic intelligence (no code changes)

**Most urgent finding for Henry's review:** The Aerodrome MEV-resistant pool migration (May 23) is the single most operationally relevant event this week. If the bot is routing to deprecated Aerodrome pool contracts, trades will fail or execute at significantly worse prices. Recommend verifying:

1. Does `executeDirectDexSwap()` in `agent-v3.2.ts` reference pool addresses by dynamic discovery (e.g., via Aerodrome Router) or hardcoded addresses?
2. If hardcoded — those addresses need updating.
3. If dynamic — the router should auto-discover new MEV-resistant pools. Confirm with a test trade or by reading Aerodrome's migration announcement for the new router contract address.

NVR-HQ is not present in this repo checkout — audit research report skipped per instructions.

---

## Summary

```
🏥 Medic:   ⚠️  API unreachable (network allowlist) — cannot confirm health
🔍 Scout:   ⚠️  GeckoTerminal blocked + Option B lock — no registry changes; proposal written
📊 Auditor: ⚠️  API unreachable — trigger conditions uncalculable; Aerodrome pool migration flagged
```

**Action required by Henry:**
1. Check Railway dashboard / bot logs directly for health
2. Verify Aerodrome MEV-resistant pool migration doesn't affect bot routing
3. Review this proposal — no code was changed
