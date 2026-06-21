# NVR Capital — Scout Cohort Proposal
**Date:** 2026-06-21  
**Run:** #35  
**Status:** FOR HENRY REVIEW — no auto-add per CLAUDE.md Rule 1 (cohort locked)

## Scout Findings

Last registry add: SYRUP (2026-05-08) / MOLT (2026-05-14) — well past 48h threshold.  
GeckoTerminal API was unreachable (egress blocked) so specific on-chain liquidity/volume/age metrics could NOT be verified. All findings below are research-based only and require manual verification before any TOKEN_REGISTRY addition.

## Quality Filter Reminder

Requires: liquidity > $100k USD, 24h volume > $50k USD, pool age > 3 days, not already in TOKEN_REGISTRY.

---

## Candidates Identified (UNVERIFIED — Henry must check on-chain)

### 1. tBTC (Threshold Network Wrapped Bitcoin)

| Metric | Research Finding |
|--------|-----------------|
| Network | Ethereum + Base (verify Base deployment) |
| Category | BLUE_CHIP |
| Risk Level | LOW (decentralized multi-party custody) |
| Estimated Supply Value | ~$500M+ |
| Key Strength | Decentralized alternative to cbBTC (no single custodian) |
| Key Risk | Lower liquidity than cbBTC on Base specifically |
| Sector Fit | BLUE_CHIP — complements existing cbBTC position as custody-diversified BTC exposure |
| Preliminary Score | 5/10 — strong fundamentals but Base-specific liquidity unverified |

**Verify at:** https://aerodrome.finance/pools (search tBTC) and https://defillama.com/chain/base (search tBTC TVL)

### 2. cirBTC (Circle's Institutional Wrapped Bitcoin — 2026 launch)

| Metric | Research Finding |
|--------|-----------------|
| Network | Ethereum + "Arc" (Circle's L1) — Base deployment TBD |
| Category | BLUE_CHIP |
| Risk Level | LOW (1:1 BTC backed, onchain verifiable reserves) |
| Launch | 2026 |
| Key Strength | Circle institutional backing, onchain reserve verification |
| Key Risk | Very new — Base pool age likely < 3 days at this point |
| Preliminary Score | 3/10 — too new, pool age filter likely fails |

**Not recommended for TOKEN_REGISTRY at this time.** Check again in 30 days.

### 3. Aerodrome-Adjacent Liquidity Tokens (post-merger watch)

Given Aerodrome→Aero merger targeting July 2026, any new liquidity tokens (veAERO, Aero governance tokens) may emerge on Base. These are watch-list items for after the merger settles.

---

## Decision

**No additions to TOKEN_REGISTRY or COHORT_QUALITY_7 this run.**

Reasons:
1. CLAUDE.md Rule 1: cohort is locked; auto-adds require explicit human PR
2. GeckoTerminal API blocked — cannot verify liquidity, volume, or pool age on-chain
3. COHORT_QUALITY_7 is post-Option-B window; any additions should follow Henry's benchmark review
4. tBTC is the only candidate with meaningful probability of passing the quality filter — pending manual verification

## Recommended Next Step for Henry

1. Check tBTC Base pool on Aerodrome: liquidity depth, 24h volume, pool age
2. If tBTC passes (liquidity > $100k, vol > $50k, age > 3 days), open a PR to add to TOKEN_REGISTRY (not COHORT_QUALITY_7) as:
```typescript
tBTC: {
  address: "0x...",  // verify Base L2 tBTC address
  symbol: "tBTC", name: "Threshold Bitcoin", coingeckoId: "tbtc",
  sector: "BLUE_CHIP", riskLevel: "LOW", minTradeUSD: 15, decimals: 18,
},
```
3. Do NOT add to COHORT_QUALITY_7 — that requires post-benchmark strategic review
