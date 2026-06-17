# NVR Scout Cohort Proposal — 2026-06-17

**Status:** PROPOSAL ONLY — per CLAUDE.md Rule 1 (Option B window, cohort locked)  
**Option B window:** 2026-05-15 → 2026-06-15 (NOW CLOSED — window ended 2 days ago)  
**Last TOKEN_REGISTRY scout commit:** 2026-05-25 (23 days ago)  
**Branch:** claude/cool-sagan-err635  

> Henry: The 30-day Option B benchmark window closed on 2026-06-15. Once you've
> reviewed performance vs. the cbBTC/WETH 60/40 benchmark, you can lift the
> cohort lock and merge any of these proposals you find compelling.

---

## Scout Methodology This Run

- GeckoTerminal API blocked (403) from execution container
- Research conducted via WebSearch + public news sources
- Cannot verify exact pool liquidity/volume figures from API
- Candidates flagged where public reporting confirms activity thresholds

---

## Candidate Evaluation Table

| Token | Symbol | Sector | 24h Vol Est. | Liq Est. | Pool Age | Score | Decision |
|-------|--------|--------|-------------|----------|----------|-------|----------|
| Tea Protocol | TEA | DEFI | Unknown | Unknown | <30d | 5/10 | WATCHLIST — too new, no verified data |
| Aerodrome cross-chain | AERO | DEFI | >$50M | Deep | 2+ years | Already in registry | SKIP |
| Virtuals Protocol | VIRTUAL | AI_TOKENS | High | Deep | 2+ years | Already in registry | SKIP |
| Seamless Protocol | SEAM | DEFI | Active | Active | 2+ years | Already in registry | SKIP |
| Brett | BRETT | MEME_COINS | High | Deep | 2+ years | Already in registry | SKIP |

---

## Key Finding: No New Qualifying Tokens This Scan

All major high-volume Base tokens identified by June 2026 research are already in
TOKEN_REGISTRY. The registry is well-populated for the current Base ecosystem.

The one new launch identified (Tea Protocol / TEA, Aerodrome Ignition) cannot be
verified for pool age (>3 days), liquidity (>$100k), or volume (>$50k/24h) from
within the API-blocked container. It scores 5/10 — below the 6/10 threshold —
due to newness and unverified data.

### TEA Protocol Details (pending verification)
- Source: cryptobriefing.com (Tea Protocol unveils Token Transparency Filing ahead
  of TEA launch on Aerodrome Ignition)
- Category: DeFi / token infrastructure
- Launch venue: Aerodrome Ignition (Base native)
- Suggested address: requires on-chain verification before any registry addition
- Suggested entry if verified: `sector: "DEFI", riskLevel: "HIGH", minTradeUSD: 10`
- **Action required:** Henry to check GeckoTerminal/DexScreener for pool age,
  liquidity, and 24h volume before adding

---

## What To Do After Window Closes

1. Review Option B performance vs. cbBTC/WETH 60/40 benchmark
2. Decide whether to lift CLAUDE.md Rule 1 (cohort lock)
3. If lifting: manually verify TEA Protocol on GeckoTerminal and add if qualifying
4. Fix egress allowlist so future scouts can auto-verify via GeckoTerminal API:
   - Add `api.geckoterminal.com` to allowed hosts
   - Add `autonomous-trading-bot-production.up.railway.app` to allowed hosts
