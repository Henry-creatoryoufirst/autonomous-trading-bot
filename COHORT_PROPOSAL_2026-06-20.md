# COHORT PROPOSAL — 2026-06-20

**From:** NVR Autonomous Scout Agent (Run #35)
**To:** Henry (human review required before any TOKEN_REGISTRY change)
**Status:** PROPOSAL ONLY — no TOKEN_REGISTRY edits made (CLAUDE.md Rule 1: explicit human PR required for cohort changes)

---

## Context

The **Option B 30-day benchmark window** (2026-05-15 → ~2026-06-15) has ended. The cohort
was locked during this period; all three attempted auto-adds (MOLT 2026-05-14, OPENX + VEIL
2026-05-16) were reverted. The window closed cleanly with the locked 7-token cohort.

Per CLAUDE.md: *"Cohort changes happen only via explicit human PR after the 30-day window
completes (~2026-06-15)."* — that time is now. This document is your trigger to act.

---

## Market Environment (as of 2026-06-20)

Market recovery signals are strong based on available research:

- **Base DEX volume** hit an all-time high ~$3B/day total, with **Aerodrome alone at $1.68B/day**
- **Aerodrome** is the dominant DEX on Base (50%+ of Base volume) — liquidity depth much improved
- **Base** is #1 L2 by DeFi TVL, most daily active addresses, largest NFT/social ecosystem
- General market recovery: HYPE +51% monthly, broader DeFi token recovery in June 2026

This is a materially better environment for rotating into quality non-blue-chip tokens than
the 70-day bear the bot operated in through May 2026.

---

## Scout Limitations This Run

GeckoTerminal API (`api.geckoterminal.com`) returned 403 from the Claude Code egress proxy —
same persistent network allowlist issue blocking bot API health checks. As a result:

- **No on-chain liquidity/volume data could be fetched** for specific token candidates
- Quality filter (>$100k liquidity, >$50k 24h volume, >3 days pool age) could not be applied
- Specific contract addresses could not be verified

**Recommendation:** Henry should manually scan:
- `https://api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1`
- `https://api.geckoterminal.com/api/v2/networks/base/new_pools?page=1`

...applying the established quality filters before proposing any new addition as a human PR.

---

## Candidates to Research (from WebSearch — NOT verified)**

These were surfaced by market search — not yet filtered through quality criteria:

| Symbol | Basis for Interest | Action Needed |
|--------|--------------------|---------------|
| HYPE   | Hyperliquid — top performer Jun-2026, +51% monthly, $476M 24h vol | Check if Base address exists with $100k+ liq |
| ARMA   | Giza's DeFi agent — primary competitor on Base, yield-focused | Check Base L2 liquidity/contract |
| Any new Aerodrome-launched token | Aerodrome ATH volumes → new pools with genuine depth | Scan GeckoTerminal trending pools |

**Note:** None of these should be added without verifying:
1. Pool liquidity > $100k USD on Base L2
2. 24h volume > $50k USD
3. Pool age > 3 days
4. Not already in TOKEN_REGISTRY

---

## Post-Window Cohort Strategy Suggestion

The Option B result (cbBTC/WETH-dominant cohort) appears vindicated by research:
> "80%+ of retail DeFi bots underperform buy-and-hold after fees" (pumpparade.medium.com, Apr-2026)

NVR's blue-chip cohort IS aligned with the benchmark. Consider whether expanding back toward
speculative tokens (AI memes, micro-cap DeFi) is warranted, or whether the quality cohort
is the right long-term posture.

**Suggested approach for Henry:**
1. Evaluate Option B performance vs cbBTC/WETH 60/40 benchmark (the defined success metric)
2. If outperforming: consider selective expansion (1-2 quality mid-caps, not meme coins)
3. If underperforming: focus on execution/signal improvements before cohort changes

---

*Proposal auto-generated 2026-06-20 by NVR scout agent (Run #35). No TOKEN_REGISTRY edits made.
Requires explicit human review and PR to take effect.*
