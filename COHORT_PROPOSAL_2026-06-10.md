# COHORT PROPOSAL — 2026-06-10

**Filed by:** NVR autonomous agent (Run #35)
**Target vault:** Cathedral (NVR-HQ/Research) — written to repo root because NVR-HQ not present in this checkout
**Status:** PROPOSAL ONLY — cohort locked until ~2026-06-15 per CLAUDE.md Rule 1

---

## Option B Window Status

The 30-day Option B benchmark window (2026-05-15 → ~2026-06-15) has **5 days remaining**.

The COHORT_QUALITY_7 (cbBTC, WETH, cbXRP, cbLTC, LINK, cbADA, cbSOL) has been held unchanged since pivot. Token registry additions and removals are frozen until Henry reviews and merges a human-reviewed PR after the window closes.

---

## Why This Proposal Was Filed

The Scout job triggered (last scout commit: 2026-05-25, 16 days ago, >48h threshold). However:

1. **GeckoTerminal API blocked** (403) from this sandbox — cannot verify liquidity, volume, or pool age for any candidate.
2. **CLAUDE.md Rule 1 active** — no TOKEN_REGISTRY additions during Option B window regardless.

Per the rules: "If you have a candidate, write a COHORT_PROPOSAL_<YYYY-MM-DD>.md to the Cathedral vault instead."

---

## Market Context (June 2026)

- Bitcoin: ~$69,200 (−45% from $126,296 ATH, October 2025)
- Ethereum: ~$1,700
- Fear & Greed Index: 23–26 (EXTREME FEAR)
- Base L2: 46.6% of all L2 DeFi TVL, 7–10M daily txns, $745M/day DEX volume
- Regime: 93-day bear, 3 consecutive red monthly candles, largest weekly ETF outflow of 2026

---

## Candidates Identified (Unverified — API Blocked)

### AERO — Aerodrome Finance

- **Why flagged:** Aerodrome Slipstream processes 50%+ of all Base DEX volume. NVR already routes all swaps through Aerodrome. Holding the underlying token aligns portfolio with the dominant liquidity layer.
- **Sector:** DEFI
- **Risk level:** MEDIUM (established protocol, 2+ years on Base)
- **Estimated score:** 7–8/10 (high relevance to NVR's execution layer; liquidity and volume strong by inference from dominance data)
- **What needs verification (post-window, with API access):**
  - Pool liquidity > $100k USD ✓ (almost certainly — #1 Base DEX)
  - 24h volume > $50k USD ✓ (almost certainly)
  - Pool age > 3 days ✓ (launched 2023)
  - Address: `0x940181a94A35A4569E4529A3CDfB74e38FD98631` (verify before adding)
  - Not in TOKEN_REGISTRY: confirm

### cbETH — Coinbase Staked ETH

- **Why flagged:** Already in TOKEN_REGISTRY but NOT in COHORT_QUALITY_7. If the cohort is expanded post-window, cbETH is the natural 8th member (Blue Chip, liquid, Coinbase-native, strong yield characteristics).
- **Action needed:** Not a new discovery — just noting for Henry's post-window cohort review.

---

## Recommendation for Henry (Post-Window Review)

When the Option B window closes (~2026-06-15):

1. **Evaluate AERO** as a potential DEFI sector addition. Verify address and metrics via GeckoTerminal. Aligns with NVR's execution infrastructure.
2. **Consider cbETH promotion** from TOKEN_REGISTRY to COHORT_QUALITY_7 if Blue Chip allocation needs depth (currently cbBTC + WETH dominate the tier).
3. **Do not add** any meme or speculative tokens at current market conditions (F&G extreme fear, 93-day bear). Quality additions only.

---

*This proposal does not modify any code. TOKEN_REGISTRY unchanged. All changes require human-reviewed PR per Option B ground rules.*
