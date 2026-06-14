# COHORT PROPOSAL — 2026-06-14

**Status**: For Henry's review — post-Option-B-window consideration
**Option B window**: 2026-05-15 → ~2026-06-15 (closes TOMORROW)
**Prepared by**: NVR autonomous agent (Run #35)

---

## Context

The 30-day Option B benchmark window closes approximately 2026-06-15. Per CLAUDE.md Rule 1,
no automatic cohort edits were made during this window. This proposal documents candidates
identified via web research (GeckoTerminal was unreachable from this environment due to egress
restrictions) for Henry's consideration once the window closes.

---

## Current Cohort (COHORT_QUALITY_7)

| Symbol  | Tier | Note |
|---------|------|------|
| cbBTC   | 1    | Benchmark anchor — always-on |
| WETH    | 1    | Benchmark anchor — always-on |
| cbXRP   | 2    | Rotational quality |
| cbLTC   | 2    | HOLD_ONLY (thin liquidity) |
| LINK    | 2    | Rotational quality |
| cbADA   | 2    | Rotational quality |
| cbSOL   | 2    | Rotational quality |

---

## Research Notes (Scout Run #35 — 2026-06-14)

GeckoTerminal API was unreachable (403, same persistent egress restriction documented since
Run #1). No real-time pool liquidity/volume data could be retrieved for quality scoring.

**What WebSearch returned (general context, not scored):**
- Base L2 has reached ~$3B all-time high daily DEX volume (record)
- Aerodrome TVL: ~$453M, 30-day volume: ~$12.4B
- AERO token is at $0.33 (down ~30% over past month), approaching historical accumulation zone
- BTC at $61K, ETH at $1,617 — ~100-day bear market
- Base MCP launched 2026-05-26 (AI agent on-chain action framework)

**Market regime**: Extended bear (~100 days). With BTC -45% from $126K ATH and ETH at
$1,617, high-risk meme/AI additions would face significant headwinds. Any post-window
cohort expansion should prioritize assets with established liquidity and survival probability.

---

## Recommendations for Post-Window Review

When the window closes (~2026-06-15), Henry should consider:

1. **No cohort changes in the next 1-2 weeks** if benchmark results are positive — confirm
   the quality cohort strategy is working before diluting it.

2. **If cohort expansion IS authorized**, priority candidates for investigation:
   - **AERO** — Already in TOKEN_REGISTRY. Aerodrome's own token, approaching historical
     accumulation zone at $0.33. Deep liquidity. Consider adding to COHORT_QUALITY_7 if
     Aerodrome July 2026 Ethereum mainnet expansion materializes.
   - **cbDOGE** — Already in TOKEN_REGISTRY. Coinbase-wrapped. Consistent with Tier-2
     Coinbase-wrapped quality cohort pattern. Would need real pool liquidity confirmation.
   - Any **new Coinbase-wrapped assets** added post-June 2026 — cbBTC/cbETH/cbXRP/cbLTC/
     cbADA/cbSOL pattern suggests Coinbase will add more. These inherit Coinbase custody
     quality and typically have deep Aerodrome pools.

3. **cbLTC reassessment** — Currently HOLD_ONLY due to thin Base L2 liquidity. Worth
   checking if liquidity has improved (was flagged 2026-05-22). If still thin, consider
   whether it should remain in COHORT_QUALITY_7 at all.

---

## What This Proposal Is NOT

This is NOT a scout-driven TOKEN_REGISTRY commit. Per CLAUDE.md Rule 1:
> "No additions, no removals, no auto-discovery."

All cohort changes require:
1. Human review of this proposal
2. Explicit PR by Henry (not auto-merged)
3. Real pool liquidity data confirming the candidate meets quality gates

---

*Written by NVR autonomous agent Run #35 — 2026-06-14T20:00 UTC*
*Committed to: claude/cool-sagan-n36pdg (per CLAUDE.md Rule 2 — never push to main/staging)*
