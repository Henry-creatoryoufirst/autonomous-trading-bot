# COHORT_PROPOSAL — 2026-06-16

Scout Run: NVR Capital autonomous agent, hourly run #35

## Why This Is a Proposal (Not a TOKEN_REGISTRY Commit)

Per CLAUDE.md Rule 1 (Option B ground rules):
> "Do NOT commit `feat(scout): add <SYMBOL> to TOKEN_REGISTRY` or any other automatic
> edit to the cohort under any circumstance."
> "Cohort changes happen only via explicit human PR after the 30-day window completes (~2026-06-15)."

The Option B window completed ~2026-06-14. These candidates are ready for Henry's review
and intentional human PR. GeckoTerminal API is also unreachable from this execution
environment — cannot verify liquidity/volume numerically.

---

## Quality Filter Requirements (Must Verify Before Adding)

- Pool liquidity > $100K USD
- 24h volume > $50K USD
- Pool age > 3 days (not a new/rug-risk launch)
- Not already in TOKEN_REGISTRY

---

## Candidates Identified

| Candidate | Symbol | Notes | Where to Verify | Suggested Sector | Suggested Risk |
|-----------|--------|-------|----------------|-----------------|---------------|
| Coinbase Wrapped MEGA | cbMEGA | Flagged in Run #27 (2026-05-04): $2.19M 24h vol reported; address was truncated so couldn't confirm. Coinbase's wrapped-assets page lists cbMEGA as an official Coinbase-issued wrapped token. | BaseScan: search "cbMEGA" or Coinbase's wrapped-assets page for contract. GeckoTerminal: `base/cbmega` | BLUE_CHIP | LOW |
| BASE ecosystem token | BASE | "Onchain Summer 2026 Global Rewards" for $BASE token distribution noted in search results. If Coinbase has issued a tradeable ERC-20 for the Base L2 ecosystem, this would be extremely high volume. | Coinbase official announcement; BaseScan; GeckoTerminal trending. | DEFI or BLUE_CHIP | MEDIUM |

---

## Candidates Explicitly Ruled Out

| Candidate | Reason |
|-----------|--------|
| cbAVAX, cbPEPE | Not confirmed as launched by Coinbase as of June 2026 searches |
| Any meme/AI tokens | CLAUDE.md Rule 1 prohibits auto-discovery; Option B cohort is quality-focused |
| All tokens in current TOKEN_REGISTRY | Already tracked |

---

## COHORT_QUALITY_7 Status (Post Option B Window)

The Option B 30-day window completed ~2026-06-14. The 7-token cohort:

| Symbol | Role | Notes |
|--------|------|-------|
| cbBTC | Tier 1 always-on | Benchmark tier. BTC at ~$62K (down from $122K ATH). |
| WETH | Tier 1 always-on | Benchmark tier. ETH at ~$1,617. |
| cbXRP | Tier 2 rotational | Active. |
| cbLTC | Tier 2 rotational | HOLD_ONLY (thin liquidity on Base). |
| LINK | Tier 2 rotational | Active. |
| cbADA | Tier 2 rotational | Active. |
| cbSOL | Tier 2 rotational | Active. |

**No COHORT_QUALITY_7 changes are proposed.** The current 7 remain the right quality
foundation. cbLTC remains HOLD_ONLY pending liquidity improvement on Base.

If Henry wants to consider COHORT additions (e.g. cbMEGA if confirmed), that requires
a separate human PR with explicit strategic rationale.

---

## How to Action This

1. Check GeckoTerminal manually: https://app.geckoterminal.com/base (sort by volume)
2. Verify cbMEGA address on BaseScan; confirm liquidity > $100K and volume > $50K
3. Confirm BASE token tradeable ERC-20 if announced
4. If candidates pass quality filter, open explicit human PR to add to TOKEN_REGISTRY
   (not COHORT_QUALITY_7) with full rationale

---

*Written by the NVR autonomous agent on claude/cool-sagan-0ribb9.*
*GeckoTerminal blocked in this execution environment — all data via WebSearch only.*
