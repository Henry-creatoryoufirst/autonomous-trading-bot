# Scout Cohort Proposal — 2026-06-20

**Filed by:** Automated Scout (hourly run)
**Status:** Awaiting human review — NOT added to TOKEN_REGISTRY per CLAUDE.md Rule 1
**Note:** GeckoTerminal API was blocked by network egress policy this run. Pool data below is sourced from WebSearch / CoinMarketCap; liquidity figure is circumstantial (not direct API read). Henry should verify on DexScreener before merging any change.

---

## Candidate: BASED

| Field | Value | Source |
|-------|-------|--------|
| Symbol | BASED | CoinMarketCap / Coinbase price page |
| Name | Based Coin | Multiple |
| Network | Base L2 | Confirmed |
| Pool | BASED/WETH on Aerodrome | DexScreener |
| 24h Volume | ~$143.5M | CoinMarketCap (search, not live API) |
| Market Cap | ~$28.2M | CoinMarketCap |
| V/MC Ratio | 509% | Calculated |
| 24h Price Δ | +11.3% | CoinMarketCap |
| Pool Liquidity | **UNVERIFIED** (egress blocked) | — |
| Pool Age | **UNVERIFIED** (egress blocked) | — |
| Token Address | **UNVERIFIED** — pool addr only: `0x5f45e48f9c053286ce9ca08db897f8b7eb3f7992` | DexScreener |
| Already in Registry | NO | Confirmed via full registry read |

### Quality Filter Assessment

| Filter | Threshold | Result | Confidence |
|--------|-----------|--------|------------|
| Pool liquidity > $100k | >$100k USD | Likely YES (implied by $143M volume) | LOW — not directly verified |
| 24h volume > $50k | >$50k USD | PASS — $143.5M | MEDIUM — WebSearch data, not GeckoTerminal |
| Pool age > 3 days | >3 days | Likely YES (established market cap) | LOW — not directly verified |
| Not in TOKEN_REGISTRY | N/A | PASS | HIGH — confirmed |

**Scout score (WebSearch data only): 5/10** — high volume signals real activity, but the token's V/MC ratio of 509% flags extreme speculation. Cannot verify liquidity depth without GeckoTerminal.

### Proposed Registry Entry (if Henry approves after verification)

```typescript
BASED: {
  address: "<VERIFY ON BASESCAN>",  // DO NOT use pool address above
  symbol: "BASED",
  name: "Based Coin",
  coingeckoId: "base-based-coin",   // verify: coinbase.com/price/base-based-coin
  sector: "MEME_COINS",
  riskLevel: "HIGH",
  minTradeUSD: 10,
  decimals: 18,
},
```

### Concerns / Watch Points

1. **V/MC ratio of 509% is extremely high** — this is meme/speculation territory. Could evaporate quickly.
2. **Token address unconfirmed** — the DexScreener link shows a pool address, not the ERC-20 token contract. Verify on BaseScan before adding.
3. **CoinGecko ID ambiguity** — search returned both `base-protocol` (symbol: BASE) and `base-based-coin` (symbol: BASED). These appear to be different tokens. Confirm the right one.
4. **No direct liquidity read** — GeckoTerminal blocked this run. Scout quality filter requires >$100k pool liquidity; this is inferred but not confirmed.

### Recommendation

Hold for Henry to verify:
- Token contract address on BaseScan
- Current Aerodrome pool liquidity on DexScreener
- Pool age (> 3 days requirement)
- CoinGecko ID disambiguation

If all check out: low-risk addition to MEME_COINS sector (minTradeUSD: 10, HIGH risk tier). Would not change COHORT_QUALITY_7 — TOKEN_REGISTRY only.

---

## Candidates Evaluated This Run

| Token | Status | Reason |
|-------|--------|--------|
| cbDOGE | Already in registry | Auto-discovered 2026-05-01 |
| cbSOL | Already in registry | Auto-discovered 2026-05-04 |
| BASED | Proposal filed | V/MC 509%, unverified liquidity — needs human check |
| ZORA | Already in registry | Listed |
| AERO | Already in registry | Listed |
