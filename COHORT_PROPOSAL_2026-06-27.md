# Cohort Proposal — 2026-06-27

**Written by**: NVR Capital autonomous agent (scout job, Run #35)
**Status**: PROPOSAL ONLY — requires explicit human PR per CLAUDE.md Rule 1
**Post-Option-B-window**: The 30-day window ended ~2026-06-15. No auto-adds to TOKEN_REGISTRY.

---

## Scout Run Status

**Last successful scout**: 2026-05-14 (MOLT added, later reverted per Option B constraints)
**Elapsed**: 43+ days — well past 48h threshold, scout should run

**Data Source Problem**: `api.geckoterminal.com` is blocked by the execution sandbox egress policy (403 policy denial, confirmed via proxy status endpoint). DeFiLlama also blocked. GeckoTerminal is the primary quality-filter data source — without it, precise liquidity ($), 24h volume ($), and pool age (days) cannot be verified.

WebSearch was used as a fallback but returned only aggregated narratives, not pool-level data rows.

**Quality filter could not be run**. No additions recommended without data verification.

---

## Market Context from WebSearch (June 2026)

| Signal | Value |
|--------|-------|
| BTC price | ~$62,606 |
| BTC vs peak | -45% from Oct-2025 peak ($126,296) |
| ETH price | ~$1,681 |
| Fear & Greed | 23-26 (Extreme Fear) |
| Monthly candles | 3 consecutive red |
| Base DEX TVL | ~$424M (Aerodrome dominant) |
| Base DEX 24h vol | ~$391M (from search, L2 aggregate) |

---

## Ecosystem Signals

- **Aerodrome Finance**: Still dominant liquidity hub on Base (~$424M TVL). AERO and Aerodrome pools remain the primary venue.
- **Clanker**: 500K+ tokens launched via AI agent on Base with Uniswap liquidity seeding. High noise environment — most are low-quality.
- **RLUSD (Ripple USD)**: Now live on Base. Stablecoin, not a trading opportunity, but confirms cross-chain liquidity depth increasing.
- **AI agent tokens**: Strong continued narrative in 2026 — NVR already holds VIRTUAL, AIXBT, LUNA, CLANKER, VADER, AXR, ZORA, TIBBIR, BNKR, ELSA, ETHY, FAI categories.
- **Limitless Exchange** (LMTS): $550M trading volume on Base. Already in TOKEN_REGISTRY.
- **Hyperliquid (HYPE)**: $689.7M token unlock June 6. Not on Base L2 in registry; watch list.

---

## Candidate Watch List (Cannot Verify — Data APIs Blocked)

These tokens surfaced in WebSearch narratives as Base-active in June 2026. **Not confirmed** for liquidity > $100k, volume > $50k, or pool age > 3 days:

| Symbol | Narrative Signal | Risk | Action |
|--------|-----------------|------|--------|
| HYPE (Hyperliquid) | $689.7M unlock June 6; deep liquidity | MEDIUM | Needs GeckoTerminal verification before proposal |
| RLUSD | Ripple USD new on Base June 2026 | LOW (stablecoin) | Not a trading target |

---

## Recommendation for Henry

1. **Allow `api.geckoterminal.com` in egress policy** — scout cannot run meaningful quality filter without it. Same request as previous 34 runs.
2. **HYPE**: If you want to add Hyperliquid's HYPE token to TOKEN_REGISTRY (DEFI sector, MEDIUM risk), verify:
   - Base L2 address (confirm it's deployed on Base, not just Hyperliquid L1)
   - Aerodrome pool liquidity > $100K
   - 24h volume > $50K
   - Pool age > 3 days
3. **No auto-adds this scan** — data APIs blocked, cannot pass quality filter.
