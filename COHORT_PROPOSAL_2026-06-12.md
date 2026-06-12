# NVR Scout — Cohort Candidate Proposal — 2026-06-12

**Filed by:** NVR Capital autonomous agent, Run #35  
**For:** Henry's review after Option B window closes (~2026-06-15)  
**Note:** CLAUDE.md Rule 1 (cohort locked during Option B benchmark window) prohibits TOKEN_REGISTRY changes until the 30-day window completes. This file is the correct vehicle per Rule 1: "If you have a candidate, write a `COHORT_PROPOSAL_<YYYY-MM-DD>.md` to the Cathedral vault instead."

---

## Scout Run Context

- Last scout commit with token additions: 2026-05-16 (VEIL, reverted)
- Last scout commit matching `--grep="scout"`: 2026-05-25 (INV-11 commit, "scout guard" mention)
- Elapsed since any scout-related commit: 18 days — well beyond 48h threshold
- GeckoTerminal API: blocked (403, persistent egress constraint). WebSearch fallback used.
- Bot production API: blocked (403, same persistent constraint)

---

## Candidates Evaluated

### Token 1: TEA (Tea Protocol)

| Metric | Value | Threshold | Pass? |
|--------|-------|-----------|-------|
| Pool age | 8 days (launched June 4, 2026) | >3 days | ✅ |
| 24h volume | $678,197 | >$50k | ✅ |
| Pool liquidity (est.) | ~$370k (2B TEA seeded at $0.000093/TEA) | >$100k | ✅ |
| Not in TOKEN_REGISTRY | TEA not present | must be new | ✅ |
| Scout score | **5/10** | ≥6 | ❌ FAIL |

**Score breakdown:**
- Volume consistency: 4/10 — $678K day-8 volume looks healthy but is primarily TGE/exchange listing hype (KuCoin, Gate, MEXC all launched same day). Volume likely fading as initial liquidity mining incentives dilute.
- Liquidity depth: 6/10 — ~$370K estimated liquidity on Aerodrome TEA/USDC is adequate for a new token but thin relative to existing cohort peers.
- Momentum: 3/10 — Price down -7.5% in 24h, typical TGE dump pattern. ATH hit on June 4 launch day. Market cap only $1.86M vs 20B circulating tokens — implying severe post-TGE sell pressure.
- Category fit: 6/10 — Infrastructure DeFi (open-source developer incentive network, OP Stack L2). Interesting niche but unproven demand beyond liquidity mining.

**Overall: 5/10 — below 6 threshold. Would NOT add even if window were open.**

**About the project:** Tea Protocol is an OP Stack L2 purpose-built to reward open-source software contributors. TEA is the native gas token. The token had a transparent launch (Token Transparency Filing filed pre-TGE), $19.9M raised, and chose Aerodrome Aero Ignition as the primary DEX venue. The use-case is compelling long-term but near-term on-chain demand is unproven.

**Contract address (Base):** `0x7ea7ea50ed58bc4d0a9194bcd328e21f7be80c2b`  
**CoinGecko:** https://www.coingecko.com/en/coins/tea-protocol  
**Sector:** DEFI  
**Suggested entry (if approved post-window):** riskLevel HIGH, minTradeUSD 25, decimals 18

---

### Token 2: HYPE (Hyperliquid)

**Rejected at screening.** Hyperliquid is on HyperEVM — a separate L1/L2 ecosystem, not Base chain. Not tradeable via Aerodrome. Not eligible.

---

## Watchlist: Infrastructure Alert — Aerodrome AERO Token Migration (July 2026)

⚠️ **ACTION REQUIRED by July 2026**

Aerodrome Finance is undergoing a mandatory liquidity migration as of May 12, 2026, in preparation for the July 2026 launch of a new unified cross-chain "Aero" DEX (merger with Velodrome/Optimism).

**What this means for TOKEN_REGISTRY:**
- The current `AERO` entry (`0x940181a94A35A4569E4529A3CDfB74e38FD98631`) is the pre-migration AERO token.
- The new unified "Aero" token will replace the current VELO token but builds on top of the existing AERO contract (the "new AERO" token keeps the same ticker per current reporting).
- LP migrations are required by July deadline to continue earning emissions — the existing AERO token remains valid for now.
- **Risk:** If a new contract address is deployed for the cross-chain AERO, the TOKEN_REGISTRY AERO entry will need updating. Recommend Henry verify the contract continuity at aerodrome.finance when the July upgrade ships.

**Sources:**
- [Aerodrome Finance Migrates Liquidity Ahead of July 2026 Aero Launch](https://www.ainvest.com/news/aerodrome-finance-migrates-liquidity-july-2026-aero-launch-2605/)
- [Aerodrome Finance Upgrades for July 2026 Aero Launch | Phemex News](https://phemex.com/news/article/aerodrome-finance-prepares-for-aero-launch-with-major-platform-upgrades-84689)
- [Aerodrome upgrades platform ahead of Aero launch in July | CryptoBriefing](https://cryptobriefing.com/aerodrome-upgrades-aero-launch-july/)

---

## Scout Summary for Run #35

| Candidate | Liq | Vol | Age | Score | Decision |
|-----------|-----|-----|-----|-------|----------|
| TEA (Tea Protocol) | ~$370k ✅ | $678k ✅ | 8d ✅ | 5/10 ❌ | Rejected (below score threshold AND Rule 1 prohibits adds) |
| HYPE (Hyperliquid) | N/A | N/A | N/A | N/A | Rejected (wrong chain — HyperEVM, not Base) |

**Result: 🔍 Scout: no qualifying tokens this scan — standards maintained.**

---

## Recommendation for Henry (post-window ~2026-06-15+)

1. **TEA**: Revisit after 30 days of trading data. Score likely stays below 6 (market cap too small, TGE hype fading). Low priority.
2. **AERO migration**: Verify July 2026 contract continuity. If new contract deployed, update `TOKEN_REGISTRY.AERO` address manually.
3. **Option B window ends ~2026-06-15**: Once closed, the scout can resume normal TOKEN_REGISTRY additions on qualifying tokens (score ≥6). Current COHORT_QUALITY_7 remains correct for Option B attribution purposes.
