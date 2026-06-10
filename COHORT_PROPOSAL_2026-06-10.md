# COHORT PROPOSAL — 2026-06-10

**Status:** Pending human review (post Option B window ~2026-06-15)
**Proposed by:** NVR autonomous scout agent (Run #35)
**Earliest actionable merge:** 2026-06-16 (after Option B window closes)

---

## Candidate: cbDOGE (Coinbase Wrapped DOGE)

### Why This Token

Aerodrome Finance announced cbDOGE as a new **core asset** on Base alongside cbBTC, cbETH, and cbXRP:

> "cbXRP and cbDOGE have landed 🛬 A new era of DeFi is ready for takeoff. $cbXRP and $cbDOGE join $cbBTC and $cbETH as core assets, set to further fuel Base's rapidly growing onchain economy. Pools are already live with incentives."
> — @AerodromeFi, ~2026-06-05

cbXRP is already in COHORT_QUALITY_7. Adding cbDOGE would complete the Coinbase-wrapped asset family on Base.

### Scout Quality Filter Assessment (partial — GeckoTerminal blocked during this run)

| Criterion | Assessment | Source |
|-----------|-----------|--------|
| Pool liquidity > $100k | **LIKELY YES** — Aerodrome core asset with incentives + cbBTC/WETH pool anchor; cbXRP ($300M+ FDV) comparable pool already active | Aerodrome X post, DEXScreener snippet |
| 24h volume > $50k | **LIKELY YES** — Core asset with AERO emission incentives; Aerodrome $12.4M/day total volume; cbXRP comparable generates > $50K/day | Aerodrome data |
| Pool age > 3 days | **LIKELY YES** — Announcement ~2026-06-05, pool live ~5+ days as of 2026-06-10 | Aerodrome X post timestamp |
| Not already in TOKEN_REGISTRY | **YES** — cbDOGE not in current COHORT_QUALITY_7 or TOKEN_REGISTRY | src/core/config/token-registry.ts |

**Note:** GeckoTerminal is blocked from this environment. Pool liquidity and 24h volume cannot be confirmed until Henry checks directly or GeckoTerminal is added to the egress allowlist.

### Proposed TOKEN_REGISTRY Entry

```typescript
{
  address: "0x/* cbDOGE Base address — needs confirmation from Coinbase/Aerodrome */",
  symbol: "cbDOGE", name: "Coinbase Wrapped DOGE", coingeckoId: "dogecoin",
  sector: "BLUE_CHIP", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 8,
  // Note: decimals likely 8 (DOGE native precision), confirm before merging
}
```

**Coinbase Asset Hub:** https://assets.coinbase.com — search cbDOGE for canonical Base contract address.

### Risk Considerations

- DOGE is meme-origin but Coinbase-wrapped = institutional-grade bridge
- cbXRP (same wrapper family) is already in COHORT — consistent strategy
- MEDIUM risk appropriate (large-cap meme, no smart-contract exposure, Coinbase custody)
- Aerodrome core asset = deep liquidity incentivised by AERO emissions
- Pool is new (weeks old) — apply `GUARDIAN_NOVEL_TOKEN_HOURS_DEFAULT = 72h` oversight window

### Scout Score: 7/10

| Dimension | Score | Notes |
|-----------|-------|-------|
| Volume consistency | 7 | Aerodrome incentivised pools show steady volume; cbXRP comparable |
| Liquidity depth | 7 | Core asset status + AERO incentives → deep pools expected |
| Momentum | 6 | Fresh launch, upward trajectory; bear market suppresses initial volume |
| Category fit | 8 | Exactly matches BLUE_CHIP Coinbase-wrapped family already in cohort |

### Henry's Action Items

1. **Verify contract address** — check Coinbase Asset Hub or Aerodrome pools page for canonical cbDOGE Base address
2. **Confirm pool metrics** — check GeckoTerminal or DexScreener: pool liquidity > $100K, 24h vol > $50K
3. **Confirm pool age** — should be > 3 days from launch (~2026-06-05)
4. **If metrics pass:** add to TOKEN_REGISTRY in `src/core/config/token-registry.ts` via explicit PR (do NOT auto-merge)
5. **Earliest merge:** 2026-06-16 (after Option B window closes)

---

## Secondary Candidate: VIRTUAL (Virtuals Protocol)

**Brief:** AI agent ecosystem native to Base; 15,800+ AI projects, $477M aGDP, trending on GeckoTerminal. High volume but likely high FDV and volatility. Sector: AI_TOKENS. Risk: HIGH. Needs full pool metric verification before consideration.

**Scout score estimate:** 5-6/10 (AI sector fits strategy, but high volatility and crowded market)

---

## Why Not Auto-Added

Per CLAUDE.md Rule 1 (Option B window 2026-05-15 → ~2026-06-15):
> "Do NOT commit `feat(scout): add <SYMBOL> to TOKEN_REGISTRY` or any other automatic edit to the cohort under any circumstance."

Three previous auto-adds (MOLT 2026-05-14, OPENX + VEIL 2026-05-16) had to be reverted. This proposal is written for human review and intentional merge only.
