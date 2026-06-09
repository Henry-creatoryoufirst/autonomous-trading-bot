# Cohort Proposal — 2026-06-09

**Status:** PENDING — held for post-Option-B-window review (~2026-06-15)
**Prepared by:** Scout agent (hourly run 2026-06-09)
**Rule applied:** CLAUDE.md Rule 1 — cohort locked during Option B window; proposal written instead of TOKEN_REGISTRY commit

---

## Candidate: VELVET (Velvet Capital)

### Quality Score: 7/10

| Metric | Value | Threshold | Pass |
|--------|-------|-----------|------|
| Pool liquidity | $349K–$517K | >$100K | ✅ |
| 24h volume | $2.2M–$4.9M | >$50K | ✅ |
| Pool age | ~6–9 months (TGE Jul 2025, Base Q4 2025) | >3 days | ✅ |
| Already in TOKEN_REGISTRY | No | Not present | ✅ |
| Score | 7/10 | ≥6 | ✅ |

### Metadata (proposed)
```
VELVET: {
  address: "0x...",  // verify on-chain before adding — not confirmed in this run
  symbol: "VELVET",
  name: "Velvet Capital",
  coingeckoId: "velvet",
  sector: "AI_TOKENS",
  riskLevel: "MEDIUM",
  minTradeUSD: 25,
  decimals: 18,
}
```

**Note:** Contract address on Base was not confirmed in this run — must be verified via basescan.org/token search for "Velvet Capital" before adding.

### Rationale
- DeFAI (AI-powered DeFi portfolio management) — strong category fit with NVR's AI_TOKENS sector
- Multi-chain AI trading terminal (Base, Eth, BNB, Solana, Hyperliquid, Monad, Sonic)
- Volume consistency: $2M–$5M/day across sources, sustained over multiple months since Base launch
- Market cap ~$25–60M — mid-cap with room to run, not speculative micro-cap
- Legitimate protocol with $170B+ in cumulative TVL at DeFi integrations
- Integrates Jupiter, 1inch, 0x, KyberSwap — deep routing, real utility

### Action Required (post-2026-06-15)
1. Verify VELVET Base contract address on basescan.org
2. Confirm current liquidity > $100K and 24h vol > $50K at time of merge
3. If still qualifying, open a PR adding to TOKEN_REGISTRY under `// === AI & AGENT TOKENS (expanded) ===`

---

## Candidate Evaluated but Rejected: OFC (OneFootball Club)

| Metric | Value | Threshold | Pass |
|--------|-------|-----------|------|
| Pool liquidity | $434K | >$100K | ✅ |
| 24h volume | $447K | >$50K | ✅ |
| Pool age | ~2 months (TGE Apr 9 2026) | >3 days | ✅ |
| Already in TOKEN_REGISTRY | No | Not present | ✅ |
| Score | 5/10 | ≥6 | ❌ |

**Rejection reason:** Score 5/10 — sports/football category has poor fit with NVR's sector model (no mapping to DEFI / AI / BLUE_CHIP / MEME). Volume is borderline and token is only 2 months old. Do not add.

---

## Scout Data Sources
- DEX Screener Base trending pools (June 2026)
- CoinGecko / CoinMarketCap VELVET price pages
- Velvet Capital blog (velvet.capital)
- Web search: "Base network top tokens June 2026"

## Scan Coverage
- Trending pools reviewed: 6 pools from DEX Screener snapshot
- New pools: GeckoTerminal API inaccessible (network policy); used web search fallback
- Tokens already in registry (filtered out): VIRTUAL, VVV, OVPP
