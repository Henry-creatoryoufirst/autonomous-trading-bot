# COHORT PROPOSAL — 2026-06-28

## Context

The Option B benchmark window (2026-05-15 → ~2026-06-15) has ended. The cohort has been locked for 44 days. This proposal is written per CLAUDE.md Rule 1: the scout agent may not auto-add to TOKEN_REGISTRY; cohort changes require explicit human PR.

**Current COHORT_QUALITY_7:**
| Symbol | Tier | Notes |
|--------|------|-------|
| cbBTC  | 1 (always-on) | Coinbase wrapped BTC |
| WETH   | 1 (always-on) | Wrapped ETH |
| cbXRP  | 2 (rotational) | Coinbase wrapped XRP |
| cbLTC  | 2 (rotational) | HOLD-ONLY (thin liquidity) |
| LINK   | 2 (rotational) | Chainlink |
| cbADA  | 2 (rotational) | Coinbase wrapped ADA |
| cbSOL  | 2 (rotational) | Coinbase wrapped SOL |

## Scout Run Notes

GeckoTerminal API was blocked by the remote execution environment's egress policy this run. Full quality filter (liquidity >$100k, volume >$50k, pool age >3 days) could not be run against live pool data. The following analysis is based on WebSearch findings and local TOKEN_REGISTRY inspection.

## Candidates Already in TOKEN_REGISTRY (Not in Cohort)

Both candidates below are already tracked in TOKEN_REGISTRY and have Aerodrome pools — adding them to COHORT_QUALITY_7 would not require new registry entries, only a cohort array update.

### Candidate 1: VVV (Venice Token)
- **Address:** Already in TOKEN_REGISTRY at `src/core/config/token-registry.ts`
- **Category:** AI_TOKENS, MEDIUM risk
- **Market cap (May 2026):** ~$827M
- **24h volume (May 2026):** ~$61M
- **Tokenomics:** 33M of 100M VVV burned (42.8%); emissions stepping down 14M→8M→6M→5M→3M/yr
- **Base integration:** Launched on Aerodrome; initial public liquidity pool there
- **Quality score:** 8/10 — high volume, established Base-native AI protocol, deflationary, community launch (no VC presale)
- **Sector fit:** AI_TOKENS (20% target) — currently only VIRTUAL and AIXBT in this bucket; VVV adds a quality anchor
- **Routing:** CDP SDK support status unknown from here; may need DEX_SWAP_TOKENS classification

### Candidate 2: AERO (Aerodrome Finance)
- **Address:** Already in TOKEN_REGISTRY
- **Category:** DEFI, MEDIUM risk
- **24h volume:** ~$34M token volume; protocol processes $810M/day DEX volume
- **TVL:** ~$500–$600M on Base
- **Market position:** >60% of Base DEX volume; dominant protocol
- **Quality score:** 7/10 — extremely liquid, the bot's own router token, deep strategic alignment
- **Sector fit:** DEFI (15% target) — currently MORPHO is the main DEFI holding
- **Strategic note:** Holding AERO is a direct participation in the protocol that executes NVR's trades; upside is correlated to Base ecosystem health

## Post-Option B Recommendation

**For Henry's review:**

1. **VVV — Strong cohort candidate.** $61M/day volume, deflationary tokenomics, Base-native AI infrastructure play. Recommend testing with a small position limit (minTradeUSD: 25, sector: AI_TOKENS).

2. **AERO — Strategic add.** Deep liquidity, protocol alignment, and DeFi sector diversification. Already fully integrated as router; adding to cohort makes the portfolio structurally long on Base DEX health.

3. **cbLTC HOLD-ONLY review.** cbLTC has been HOLD-ONLY since 2026-05-22 due to thin liquidity. With 44 days elapsed, worth checking if liquidity has improved on chain — if not, consider removing from cohort and replacing with a more liquid asset.

4. **Cohort size.** 7 tokens with one HOLD-ONLY is effectively 6 active. Adding VVV + AERO and removing cbLTC would give a clean 8-token active cohort with better sector diversity.

## Action Required

This is a proposal only. Per CLAUDE.md Rule 1, no changes have been made to TOKEN_REGISTRY or COHORT_QUALITY_7. Henry should:
1. Review this proposal
2. Verify on-chain liquidity for VVV and AERO pools on Aerodrome
3. Open an explicit human PR if expanding the cohort

Scout agent: NVR Capital autonomous agent (Run #35, 2026-06-28T22:xx UTC)
