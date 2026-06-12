# Cohort Proposal — 2026-06-12

**Scout run:** hourly agent cycle, 2026-06-12
**Trigger:** 27 days since last scout commit (2026-05-16) — exceeds 48h threshold
**Status: NO REGISTRY CHANGE** — Cohort lock active per CLAUDE.md Rule 1 until ~2026-06-15

---

## Why No Tokens Were Added

CLAUDE.md Option B ground rules prohibit any `feat(scout)` write to TOKEN_REGISTRY or
COHORT_QUALITY_7 until the 30-day benchmark window closes (~June 15, 3 days from now).
This file is the mandated alternative to an auto-add commit.

---

## Scout Execution Summary

### Data Sources Attempted

| Source | Status | Reason |
|--------|--------|--------|
| GeckoTerminal trending pools API | ❌ 403 Forbidden | WebFetch blocked; WebFetch tool returns 403 for this host |
| GeckoTerminal new pools API | ❌ 403 Forbidden | Same |
| curl to Railway bot API | ❌ Egress blocked | Host not in container allowlist |
| Web search (Base L2 trending tokens) | ✅ Partial | Returned general ecosystem info, not pool-level metrics |

### Tokens Evaluated via Web Research

| Token | Chain | Already in Registry? | Notes |
|-------|-------|---------------------|-------|
| BRETT | Base | ✅ Yes | Top Base meme; already tracked |
| TOSHI | Base | ✅ Yes | $142M mcap, $12M/day vol; already tracked |
| DEGEN | Base | ✅ Yes | Already tracked |
| MOG | Base | ✅ Yes | Already tracked |
| PONKE | Solana | N/A | Solana native — not Base |
| Clanker-launched tokens | Base | N/A | Too new/speculative; fail pool-age filter |
| AERO | Base | ✅ Yes | Already tracked |

### Conclusion

No net-new tokens with verifiable pool liquidity >$100k, 24h vol >$50k, and pool age >3 days
were identified via available research methods. The TOKEN_REGISTRY already covers the
major Base meme, DeFi, AI, and blue-chip tokens.

---

## Cohort Quality Bar (for Henry's consideration post-June 15)

COHORT_QUALITY_7 targets assets with 5+ year survival probability. Candidates for consideration
after the window closes should meet:

- Listed on Coinbase or major CEX (signal of regulatory durability)
- >$50M market cap sustained over 6+ months
- Deep Base liquidity (>$500k pool depth for slippage-safe execution)
- Preferably Coinbase-wrapped (cb*) assets — best execution via CDP SDK

**No new cb* assets were announced in the research window.** Watch for cbSUI, cbDOT if Coinbase
expands its wrapped-asset program.

---

## Action Required from Henry

- None immediate. Lock expires ~June 15.
- After June 15: review this proposal and decide whether to expand COHORT_QUALITY_7.
- If cbSUI or another new Coinbase-wrapped asset launches, it would be the strongest candidate.
