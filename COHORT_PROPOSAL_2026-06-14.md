# COHORT PROPOSAL — 2026-06-14

**Filed by:** NVR Capital autonomous agent (hourly run #35)
**Status:** PENDING human review — Option B cohort locked until ~2026-06-15
**Filed per:** CLAUDE.md Rule 1 — no auto-adds to TOKEN_REGISTRY during Option B window

---

## Context

The Option B 30-day benchmark window (2026-05-15 → ~2026-06-15) expires **tomorrow**. The cohort has been locked at 7 quality tokens for the full window. This proposal is for post-window consideration only.

**Last scout run:** 2026-05-16 (MOLT added/reverted, <24h from that run)
**Days since last effective scout:** ~29 days (well past 48h threshold)
**GeckoTerminal API status:** BLOCKED by egress policy — all liquidity/volume data below is from WebSearch research, not direct API verification. Requires manual confirmation before adding.

---

## Why No Tokens Can Be Added Today

1. **Option B cohort lock** — Rule 1 prohibits automatic TOKEN_REGISTRY edits until ~June 15
2. **GeckoTerminal blocked** — Cannot verify pool liquidity > $100k, 24h volume > $50k, or pool age > 3 days from this execution environment
3. All quality-filter criteria (liquidity, volume, age) require API access to confirm

---

## Scout Research Findings (WebSearch — Unverified)

### Candidates Identified via WebSearch (require GeckoTerminal verification)

| Candidate | Rationale | Category | Priority |
|-----------|-----------|----------|----------|
| $BASE network token | Official Coinbase L2 network token — if/when launched (not announced as of June 2026). Jesse Pollak confirmed exploring in Sept 2025. | BLUE_CHIP | Watch — not yet live |
| MORPHO (expansion) | Already in DEX_SWAP_TOKENS; Morpho on Base has strong liquidity via Aerodrome. Consider adding as tradeable (not just DEX-swap). | DEFI | Low — already tracked |
| AERO (catalyst) | Expanding to Ethereum mainnet + Circle's Arc blockchain in July 2026. Already in TOKEN_REGISTRY. Catalyst may increase volume/liquidity. | DEFI | No action — already in |

### Tokens Already In Registry (confirmed from WebSearch to still be active)
- AERO (TVL ~$453M), WETH, cbBTC, LINK, BRETT, DEGEN, TOSHI — all showing continued activity
- No net-new tokens identified with sufficient verified data for quality filter

### General Base Ecosystem Observation
Base ecosystem is maturing rapidly (46.6% of all L2 DeFi TVL, 7-10M daily transactions). The ecosystem is dominated by established tokens rather than speculative new launches in June 2026. A post-window scout with GeckoTerminal access should look at:
1. Any new Coinbase-wrapped assets (cb* series) — LINK cbSOL cbADA proven model
2. Any new Aerodrome Ignition launches with established liquidity (>3 days, >$100k)
3. AERO ecosystem tokens that now have sufficient volume post-V2 upgrade

---

## Action Required (Post-Window, ~June 15+)

1. **Fix egress allowlist** to include `api.geckoterminal.com` so the scout can run quality filters
2. **Run scout with GeckoTerminal access** — the 29-day gap means the full `/trending_pools` and `/new_pools` scan is overdue
3. **Review MORPHO** — already in DEX_SWAP_TOKENS; assess whether it should be upgraded to full tradeable status given Base liquidity growth
4. **Monitor for $BASE token** — if Coinbase launches an official Base network token, it would be an immediate BLUE_CHIP candidate

---

## What Was NOT Done (Intentionally)

- ❌ Did not add any tokens to TOKEN_REGISTRY (Option B lock + no verified data)
- ❌ Did not remove any existing tokens
- ❌ Did not change any constants (Auditor: no trigger conditions confirmed)

---

*Filed to repo root (Claude Code sandbox; NVR-HQ Cathedral vault not in this checkout)*
