# Scout Proposal — 2026-06-19

**Status:** Pending human review — Option B window ended ~2026-06-15.
Post-window cohort changes require explicit human PR per CLAUDE.md Rule 1.

**Note on NVR-HQ:** Cathedral vault not present in this repo checkout. Filed here
as the closest alternative. Henry: please move to NVR-HQ/Proposals when convenient.

---

## Context

- **Last scout commit:** `feat(scout): add MOLT to TOKEN_REGISTRY` — 2026-05-14 (~35 days ago)
- **Scout interval:** 48h minimum required. 35 days elapsed — scout is overdue.
- **Option B window:** Started 2026-05-15, ended ~2026-06-15. Window is now closed.
- **CLAUDE.md Rule 1:** Still prohibits automated `feat(scout): add <SYMBOL> to TOKEN_REGISTRY` commits.
  Post-window additions need explicit human PR.

---

## Infrastructure Constraint

GeckoTerminal API (`api.geckoterminal.com`) returned **403 Forbidden** from the Claude Code
execution sandbox in every attempt this run. Bash curl was blocked by network egress policy.
This is the same constraint that has blocked bot API health checks since Run #1.

**Implication:** Specific pool data (liquidity, 24h volume, pool age) could not be verified
programmatically. The candidates below are based on WebSearch market intelligence only.
**Henry must manually verify on GeckoTerminal before merging any addition.**

---

## Market Intelligence (WebSearch 2026-06-19)

### Base Ecosystem State
- Base DEX TVL: ~$4.5B (up from earlier 2026)
- Aerodrome TVL: $1.2B+, capturing 60%+ of Base DEX volume
- Top ecosystems by activity: Aerodrome Finance, Virtuals Protocol, Aave, Brett, Farcaster

### Major Upcoming Event — Aerodrome Predictive Allocation (July 2026)
Aerodrome announced on 2026-06-14 that they will replace weekly gauge voting with
"Predictive Allocation" — a mechanism that rewards participants who forecast where liquidity
demand will appear. Launch date: July 2026. AERO token +22% on announcement.

**Relevance:** AERO is already in TOKEN_REGISTRY. This upgrade could increase AERO's
revenue capture and token value materially. Bot should be watching AERO momentum closely
around the July launch. No registry change needed — AERO is already tracked.

### Meme-Fi Sector (June 2026)
The line between MEME_COINS and DEFI has blurred into "Meme-Fi" — yield-bearing memes
with gamified staking. Base continues to be the dominant chain for retail meme activity
alongside Solana. No specific new tokens identified with verified on-chain data this run.

---

## Scout Recommendation

**No auto-additions this run** due to:
1. GeckoTerminal API unreachable — cannot verify quality filters (liq > $100K, vol > $50K, age > 3 days)
2. CLAUDE.md Rule 1 — post-window additions need explicit human PR

**Henry's action items:**
1. Check GeckoTerminal trending pools on Base: https://www.geckoterminal.com/base/pools
2. Filter for: liquidity > $100K, 24h vol > $50K, pool age > 3 days, not in TOKEN_REGISTRY
3. If tokens pass, open a PR to `src/core/config/token-registry.ts` with the standard entry format
4. Note: Option B window ended June 15 — cohort additions are now permissible via human PR

---

## Watch List (for Henry's direct review)

| Item | Note |
|------|------|
| Aerodrome Predictive Allocation | July 2026 launch — monitor AERO momentum going into launch |
| Base Meme-Fi sector | New sub-sector blending memes+yield — worth checking GeckoTerminal for qualified entrants |
| GeckoTerminal API access | Sandbox egress needs this domain whitelisted for scout to function fully |

---

_Filed by NVR autonomous agent (scout job), run 2026-06-19. No TOKEN_REGISTRY changes made._
