# COHORT PROPOSAL — 2026-06-24

**Filed by:** NVR autonomous agent (Run #35)
**Status:** PROPOSAL ONLY — requires human review and explicit PR to act
**Note:** CLAUDE.md Rule 1 prohibits automatic TOKEN_REGISTRY edits. This document is the correct output per Rule 1 ("write a COHORT_PROPOSAL to the Cathedral vault instead").

---

## Context

- Run #35, 2026-06-24T22:10 UTC
- Last scout run: 2026-05-14 (MOLT, later reverted per CLAUDE.md). 40 days elapsed.
- Option B window: started 2026-05-15, ended ~2026-06-15. Window has closed.
- GeckoTerminal API blocked from this execution environment (403). **All candidates below are qualitatively identified via WebSearch only — pool liquidity, 24h volume, and pool age could NOT be verified quantitatively.**
- Scout quality gate requires: >$100K liquidity, >$50K 24h volume, >3 days old, not already in TOKEN_REGISTRY.

---

## Candidates Evaluated

### ✅ CANDIDATE: ONDO (Ondo Finance)

| Field | Value |
|-------|-------|
| **Symbol** | ONDO |
| **Name** | Ondo Finance |
| **Category** | RWA / Tokenized Assets |
| **NVR Sector** | TOKENIZED_STOCKS |
| **Already in registry?** | No |
| **Qualitative Score** | 7/10 |

**Rationale:**
- Ondo Finance is the leading tokenized treasury protocol with $2.5B+ TVL as of June 2026 (Securitize/BUIDL ~$2.5B, Ondo ~$2.8B)
- Ondo Global Markets offers 100+ tokenized stocks and ETFs
- Institutional-grade with BlackRock/regulatory alignment
- TOKENIZED_STOCKS sector is currently underweight (only `deSPXA` in registry)
- Strong 5-year survival probability — direct Coinbase/institutional support

**Unverified (requires Henry or GeckoTerminal access):**
- Base L2 pool address for ONDO
- Pool liquidity > $100K
- 24h volume > $50K
- Pool age > 3 days
- Whether CDP SDK can swap ONDO or requires DEX_SWAP_TOKENS routing

**Suggested registry entry (pending verification):**
```typescript
ONDO: {
  address: "0x???",  // MUST verify Base L2 address before adding
  symbol: "ONDO", name: "Ondo Finance", coingeckoId: "ondo-finance",
  sector: "TOKENIZED_STOCKS", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
},
```

---

## Candidates Rejected (Already in TOKEN_REGISTRY)

The following tokens surfaced in WebSearch research but are already tracked:

| Token | Registry Key | Reason Already Covered |
|-------|-------------|------------------------|
| Aerodrome (AERO) | `AERO` | DEFI sector, confirmed |
| cbETH | `cbETH` | BLUE_CHIP, confirmed |
| Virtuals Protocol (VIRTUAL) | `VIRTUAL` | AI_TOKENS, confirmed |
| Morpho (MORPHO) | `MORPHO` | DEFI, confirmed |
| cbSOL | `cbSOL` | BLUE_CHIP, added Run #27 |
| LUNA by Virtuals | `LUNA` | AI_TOKENS, confirmed |
| MOONWELL (WELL) | `WELL` | DEFI, confirmed |
| Seamless (SEAM) | `SEAM` | DEFI, confirmed |
| Maple Finance (SYRUP) | `SYRUP` | auto-discovered Run #33 |

---

## Action Required

1. **Henry**: Verify ONDO's Base L2 contract address and pool metrics on GeckoTerminal or Aerodrome
2. If ONDO qualifies (>$100K liq, >$50K 24h vol, pool >3 days), open a PR to add it to TOKEN_REGISTRY
3. Consider adding to COHORT_QUALITY_7 if conviction is high enough for the Tier-2 rotation slot — but this is a post-window strategic call, not a routine scout add

## Recommended Sleuthing Queries
- GeckoTerminal: `https://app.geckoterminal.com/base/pools?q=ondo`
- Aerodrome: search ONDO on `aerodrome.finance`
- Basescan: search "Ondo" on `basescan.org/tokens`
