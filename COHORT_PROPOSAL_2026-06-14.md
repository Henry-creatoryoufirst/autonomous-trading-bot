# NVR Token Scout Proposal — 2026-06-14

**Status:** Pending Henry review — cohort lock active until ~2026-06-15 (Option B window end)

## Why this file exists

CLAUDE.md Rule 1 prohibits automatic edits to TOKEN_REGISTRY during the 30-day Option B window. This run's scout found 1 qualifying candidate. Committing a `feat(scout)` would violate the rule, so the research is preserved here for Henry to action after the window closes.

---

## Scout Run Summary (2026-06-14 00:07 UTC)

**Data sources:** GeckoTerminal trending/new pools (403d — searched via web), Aerodrome pool metrics via web search, token detail pages.

### All candidates evaluated

| Token | Symbol | Liquidity | 24h Vol | Pool Age | Score | Result |
|-------|--------|-----------|---------|----------|-------|--------|
| Nockchain | NOCK | $2.15M | $368K | ~1 day | 6.5/10 | ❌ FAIL — pool age < 3 days |
| Syndicate | SYND | $2.16M | $5.98M | 9+ months | 7.5/10 | ✅ PASS — blocked by cohort lock |
| Taix AI | TAIX | $174K | $60K | 20 days | 5.0/10 | ❌ FAIL — score < 6 |

---

## Qualifying Candidate: SYND (Syndicate)

**Contract (Base):** `0x11dc28d01984079b7efe7763b533e6ed9e3722b9`  
**Primary pool:** SYND/WETH on Aerodrome Slipstream (0.3% fee): `0xa6f77321b8726faab89b72f28c2603b667448bc2`  
**Secondary pool:** SYND/WETH on Aerodrome standard: `0x50f8f7ffbd70c6c87b1668eee4e03f5ac057de3f`

### Metrics
- **Liquidity (primary):** $2.16M — deep for a newer token
- **24h Volume (primary):** $5.98M — high and active
- **Pool age:** Token launched September 2025 (~9 months), pools well-established
- **Not in TOKEN_REGISTRY:** confirmed
- **Sector fit:** DeFi/Infrastructure — NVR carries a 15% DeFi target (AERO, AAVE, CRV, ENA, MORPHO, etc.)

### Scoring breakdown (1–10)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Volume consistency | 8 | $5.98M/day primary pool is high turnover |
| Liquidity depth | 8 | $2.16M supports meaningful trade sizes |
| Momentum | 7 | Appeared in trending pools, active Aerodrome ecosystem |
| Category fit | 7 | Syndicate L3 (settles on Base) — native gas + governance. Solid DeFi/infra |
| **Overall** | **7.5** | Passes 6+ threshold |

### What is Syndicate?
Syndicate is a Layer 3 that settles on Base, with SYND as the native gas token and governance token for both Syndicate Network and Commons Chain. Fixed supply of 1 billion tokens. Launched September 2025 with no insider pre-mine issues identified. Strong alignment with Base ecosystem.

### Proposed TOKEN_REGISTRY entry (for Henry to add after window)
```typescript
SYND: {
  address: "0x11dc28d01984079b7efe7763b533e6ed9e3722b9",
  symbol: "SYND", name: "Syndicate", coingeckoId: "syndicate",
  sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
},
```

---

## Rejected candidates

### NOCK (Nockchain)
- Pool age ~1 day on Aerodrome Base (pool was in GeckoTerminal new_pools). Fails > 3-day minimum.
- Token itself launched May 2025, but the Base pool appears newly bridged.
- Strong metrics otherwise ($2.15M liquidity, $368K daily volume). **Re-check after pool ages past 3 days.**
- Would be BLUE_CHIP / HIGH risk if added.

### TAIX (Taix AI)
- 24h volume $60K (barely passes $50K floor but no room for slippage-safe trades)
- Score 5/10 — below the 6-point minimum
- AI widget for games, thin daily flow. Pass for now.

---

## Note on run conditions

- Bot API (`autonomous-trading-bot-production.up.railway.app`) was **unreachable** in this environment — network egress policy blocks it. Medic and Auditor jobs could not execute.
- Henry: if the bot API is expected to be accessible from the scheduled agent, the egress allowlist needs to include `autonomous-trading-bot-production.up.railway.app`.
