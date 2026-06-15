# Cohort Proposal — 2026-06-15

**Filed by:** NVR Scout (automated, Run #35)
**Date:** 2026-06-15 (Option B benchmark window day 30 — closes today)
**Status:** FOR HENRY'S REVIEW — cohort is locked until human approval

---

## Summary

The Token Scout ran today (32 days since last scout on 2026-05-14 — MOLT added). Due to persistent
GeckoTerminal API egress block (403 from this execution environment), no pool-level data could be
verified. No changes were made to TOKEN_REGISTRY. This proposal documents the scout context for
Henry's post-window cohort review.

---

## Current Cohort (COHORT_QUALITY_7)

| # | Symbol | Address | Tier |
|---|--------|---------|------|
| 1 | cbBTC  | 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf | Tier 1 — always-on |
| 2 | WETH   | 0x4200000000000000000000000000000000000006 | Tier 1 — always-on |
| 3 | cbXRP  | 0xcb585250f852C6c6bf90434AB21A00f02833a4af | Tier 2 — rotational |
| 4 | cbLTC  | 0xcb17C9Db87B595717C857a08468793f5bAb6445F | Tier 2 — HOLD_ONLY (thin liq) |
| 5 | LINK   | 0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196 | Tier 2 — rotational |
| 6 | cbADA  | 0xcbada732173e39521cdbe8bf59a6dc85a9fc7b8c | Tier 2 — rotational |
| 7 | cbSOL  | 0x2f280d1b1c738d71a6e7adeb1a84c8f2f114594c | Tier 2 — rotational |

---

## Market Context (2026-06-15)

- **Bitcoin**: ~$69,200 (~45% off ATH)
- **Fear & Greed Index**: 23-26 (Extreme Fear)
- **Bitcoin Dominance**: 58%
- **Bear duration**: ~101 days (from ~2026-03-06 estimated onset)
- **Expected bottom**: Institutional consensus $56K-$68K — Bitcoin may be AT the top of that range
- **Altcoins**: Showing early stabilization but no confirmed recovery; not altcoin season (CMC index 46/100)
- **Base DEX volume**: All-time high ~$2.9B/day (Aerodrome hit $1.68B volume ATH) — ecosystem healthy despite token price bear

---

## Scout Data Gap

GeckoTerminal API (`api.geckoterminal.com`) returns 403 from this container. DexScreener and
on-chain APIs are similarly blocked by the egress allowlist. No verifiable pool-level data
(liquidity, 24h volume, pool age) is available from this environment.

**Qualifying filter criteria** (for Henry's manual check):
- Pool liquidity > $100K USD
- 24h volume > $50K USD
- Pool age > 3 days
- Not already in TOKEN_REGISTRY
- HOT_MOVER_MIN_FDV_USD ≥ $1M (set in constants.ts)

---

## Candidates for Henry's Manual Review

Based on WebSearch results about the Base ecosystem (cannot verify addresses/liquidity from here):

1. **AERO (Aerodrome Finance)** — Already the dominant Base DEX with $1.68B volume ATH. If not
   already in TOKEN_REGISTRY, this is a top candidate for DEFI MEDIUM. Check current liquidity
   on Aerodrome/GeckoTerminal before adding.

2. **cbETH ecosystem growth** — Already in registry. No expansion needed here.

3. **Morpho** — DEX_SWAP_TOKENS already includes MORPHO. Liquidity reportedly doubling per
   mid-2026 research. Consider checking if pool metrics now qualify for active trading
   (currently HOLD-only via DEX_SWAP_TOKENS).

---

## Recommendation

1. Once Option B window is formally closed, Henry should access GeckoTerminal directly to run
   a full scout pass with verified pool data
2. Fix egress allowlist to include `api.geckoterminal.com` for future automated scout runs
3. Consider adding AERO if pool liquidity > $100K and 24h vol > $50K (verify manually)
4. The cohort quality focus (cbBTC/WETH/LINK as core, Coinbase-wrapped assets as tier 2) appears
   validated by the Option B bear-market period — quality assets hold value better than speculative tokens

---

*Filed per CLAUDE.md Rule 1: cohort changes happen only via explicit human PR after the 30-day window completes.*
