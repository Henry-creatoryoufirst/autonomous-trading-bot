# Cohort Proposal — 2026-06-11

**Prepared by:** NVR Capital Autonomous Agent (Run #35)  
**Status:** PENDING HENRY REVIEW — Do not auto-merge  
**Option B window ends:** ~2026-06-15 (~4 days from proposal date)  
**Environment constraint:** GeckoTerminal + bot API blocked in this execution environment. All liquidity/volume figures are estimates from WebSearch; Henry must verify on GeckoTerminal/Aerodrome before any addition.

---

## Context

This proposal covers the scout window from 2026-05-15 (Option B pivot / cohort lock) to 2026-06-11 (today). During this period the scout was blocked from adding tokens per CLAUDE.md Rule 1. The last TOKEN_REGISTRY addition before the lock was MOLT (2026-05-14), which itself was subsequently reverted per the CLAUDE.md notes.

Scout cadence resumes after ~2026-06-15. This document contains all candidates identified via WebSearch during the locked period for Henry's post-window review.

---

## CRITICAL: Pre-Window Action — AERO Pool Migration

**This is NOT a token addition proposal but an urgent operational note.**

Aerodrome Finance is merging with Velodrome Finance into a unified "Aero" protocol (Dromos Labs). **The old AERO liquidity pools are losing emissions as LPs migrate to new MEV-resistant pools.** Migration began May 12, 2026 with a July 2026 deadline.

**Impact on NVR:**
- `AERO` is in TOKEN_REGISTRY (sector: DEFI, address: `0x940181a94A35A4569E4529A3CDfB74e38FD98631`)
- If old AERO/USDC pool liquidity drains before July, NVR's AERO swaps may get high slippage or fail
- The AERO token itself survives (VELO holders are migrating TO AERO, not away from it)
- The contract address does NOT change — the registry entry stays correct

**Recommended action (Henry, pre-window):**
1. Check AERO pool liquidity on [aerodrome.finance](https://aerodrome.finance) for the new vs. old pools
2. If old pool TVL < $200K, consider adding AERO to `HOLD_ONLY_TOKENS` temporarily until new pool is primary
3. No code change required if liquidity stays healthy

---

## Candidate 1: BASE Native Token

**Symbol:** BASE (provisional)  
**Category:** BLUE_CHIP / infrastructure  
**Thesis:** Base (the Coinbase L2) is exploring its own native governance token. Polymarket odds: 33% launch by June 30, 2026; 69% by December 31, 2026. If/when launched, this would be the deepest-liquidity native token on Base itself — potentially the strongest BLUE_CHIP addition since cbBTC.

**Estimated quality metrics (post-launch, not verifiable yet):**
- Liquidity: Expected >$10M (Coinbase-backed)
- Volume: Expected >$1M/day (exchange listings + native utility)
- Pool age: N/A — not yet launched

**Scout score (provisional):** 9/10 (highest conviction — if launched)  
**Recommended action:** Add monitoring. When token launches, scout should run within 3 days (pool age gate) and evaluate for COHORT_QUALITY_7 addition. This may be the first COHORT_QUALITY_7 update post-window.

**Risk level:** LOW (Coinbase-issued)  
**Sector:** BLUE_CHIP  
**minTradeUSD:** 15

---

## Candidate 2: DeFi.app (HOME)

**Symbol:** HOME  
**Protocol:** DeFi.app — perpetual DEX on Base  
**Thesis:** DeFi.app reported +132.9% monthly growth as of early June 2026 and launched "Rocket Perps" (June 4, 2026). Base's perpetuals market is growing rapidly with Base TVL at $9.1B. HOME would add perps protocol exposure to the DEFI sector.

**Quality metrics (WebSearch estimates — Henry must verify):**
- Pool age: ~60+ days (protocol launched earlier 2026, token prior to Rocket Perps)
- 24h volume: Unknown — estimate >$50K given growth trajectory
- Liquidity: Unknown — must verify >$100K gate

**Scout score (conditional):** 6/10 if liquidity >$100K  
**Risk level:** MEDIUM  
**Sector:** DEFI  
**minTradeUSD:** 25

**Verification needed before adding:**
```
curl "https://api.geckoterminal.com/api/v2/networks/base/tokens/<HOME_ADDRESS>"
```
HOME contract address must be verified on BaseScan. Candidate address (unverified): search "DeFi.app HOME token Base" on GeckoTerminal.

---

## Candidate 3: TEA Protocol (TEA)

**Symbol:** TEA  
**Protocol:** Tea Protocol — open-source developer rewards  
**Thesis:** TGE occurred June 4, 2026. Protocol incentivizes open-source contributions on-chain. Novel category (developer tooling / public goods).

**Quality metrics:**
- Pool age: ~7 days as of this proposal — **FAILS** the >3 days gate but borderline. By June 15 it will be 11 days old.
- 24h volume: Unknown
- Liquidity: Unknown

**Scout score:** 4/10 — too early, insufficient data  
**Recommended action:** Re-evaluate at next scout run (after June 15). If pool age >7 days AND liquidity >$100K AND volume >$50K, elevate to 6+.

---

## Candidate 4: STRATO

**Symbol:** STRATO  
**Launch:** Community ICO June 3, 2026  
**Thesis:** New Base ecosystem token. Details sparse from WebSearch.

**Scout score:** 3/10 — insufficient data, too early  
**Recommended action:** Skip this cycle. Re-evaluate if it appears on GeckoTerminal trending pools.

---

## Post-Window Scout Checklist (Henry / First Unlocked Scout)

When Option B window closes (~2026-06-15):

1. **Run full GeckoTerminal scout** — trending pools + new pools, apply all quality gates
2. **Evaluate BASE token** — if launched, priority 1 for COHORT_QUALITY_7 addition
3. **Verify HOME/TEA liquidity** — check Candidates 2 and 3 against live GeckoTerminal data
4. **AERO pool health check** — confirm new MEV-resistant pools have absorbed liquidity before July deadline
5. **Consider cbMEGA** — Coinbase Wrapped MEGA was noted in prior scout runs as a watch-list item with truncated address; verify full contract and liquidity

---

## Current COHORT_QUALITY_7 (for reference)

| Symbol | Address | Tier |
|--------|---------|------|
| cbBTC | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` | Tier 1 always-on |
| WETH | `0x4200000000000000000000000000000000000006` | Tier 1 always-on |
| cbXRP | `0xcb585250f852C6c6bf90434AB21A00f02833a4af` | Tier 2 rotational |
| cbLTC | `0xcb17C9Db87B595717C857a08468793f5bAb6445F` | Tier 2 rotational (HOLD_ONLY) |
| LINK | `0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196` | Tier 2 rotational |
| cbADA | `0xcbada732173e39521cdbe8bf59a6dc85a9fc7b8c` | Tier 2 rotational |
| cbSOL | `0x2f280d1b1c738d71a6e7adeb1a84c8f2f114594c` | Tier 2 rotational |

Sources:
- [Aerodrome Aero Migration](https://www.ainvest.com/news/aerodrome-finance-migrates-liquidity-july-2026-aero-launch-2605/)
- [Aerodrome/Velodrome Merger Details](https://crypto.news/aerodrome-velodrome-merge-aero-dex-ethereum-2025/)
- [Base Native Token Exploration](https://ambcrypto.com/base-is-exploring-native-token-launch-is-2026-the-year/)
- [Base Token Polymarket Odds](https://www.binance.com/en/square/post/05-26-2026-the-probability-of-base-issuing-its-own-coin-by-the-end-of-this-year-is-33-327237690424865)
- [June 2026 Crypto Events (STRATO, HOME, TEA)](https://phemex.com/news/article/june-2026-packed-with-key-crypto-events-and-upgrades-87710)
- [Top Base Chain DeFi 2026](https://devel.coinbrain.com/blog/the-top-base-chain-de-fi-projects)
