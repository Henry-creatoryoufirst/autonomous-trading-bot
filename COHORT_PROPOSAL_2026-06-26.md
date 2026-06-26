# NVR Capital — Cohort Proposal 2026-06-26

**Authored by:** NVR autonomous scout (Run #35)
**Date:** 2026-06-26
**Status:** PENDING HENRY REVIEW — no TOKEN_REGISTRY changes made per CLAUDE.md Rule 1

---

## Context

The Option B benchmark window (2026-05-15 to ~2026-06-15) has completed. Cohort changes
still require explicit human PR per CLAUDE.md Rule 1. This proposal documents what the
scout found for Henry's consideration.

The last scout commit was 2026-05-25 (MOLT added, ~32 days ago). This is the first scout
research since then.

**Critical infrastructure note:** GeckoTerminal API (`api.geckoterminal.com`) is blocked
by the Claude Code execution environment's network policy, along with the bot's Railway API.
Pool-specific data (exact liquidity, 24h DEX volume, pool age) cannot be verified directly.
Candidates below are based on WebSearch research and should be manually verified on
[GeckoTerminal](https://www.geckoterminal.com/base/pools) and
[DEX Screener](https://dexscreener.com/base) before adding.

---

## Current COHORT_QUALITY_7

| Symbol | Address | Notes |
|--------|---------|-------|
| cbBTC | 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf | Tier 1 — always-on |
| WETH | 0x4200000000000000000000000000000000000006 | Tier 1 — always-on |
| cbXRP | 0xcb585250f852C6c6bf90434AB21A00f02833a4af | Tier 2 — rotational quality |
| cbLTC | 0xcb17C9Db87B595717C857a08468793f5bAb6445F | Tier 2 — HOLD_ONLY (thin liquidity) |
| LINK | 0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196 | Tier 2 — rotational quality |
| cbADA | 0xcbada732173e39521cdbe8bf59a6dc85a9fc7b8c | Tier 2 — rotational quality |
| cbSOL | 0x2f280d1b1c738d71a6e7adeb1a84c8f2f114594c | Tier 2 — rotational quality |

---

## Scout Candidates (June 2026)

### 1. HOME — DeFi.app
**Recommendation: INVESTIGATE**

- **What it is:** DeFi.app — a unified DeFi analytics and trading interface on Base. Launched Rocket Perps (perpetual trading) June 4, 2026.
- **Volume:** $18.66M 24h trading volume (across all venues as of June 7, 2026)
- **ATH:** $0.06849 on June 7, 2026
- **Circulating supply:** 4.07B HOME (of 10B max)
- **Unlock concern:** 750M HOME ($36.87M at ATH) unlocked June 10, 2026 — ~19.79% of circulating supply added in one event. Price action post-unlock should be checked.
- **Base contract:** Not confirmed via this search — MUST VERIFY on Basescan
- **Aerodrome pool:** Not confirmed — MUST VERIFY liquidity/volume on GeckoTerminal
- **Category fit:** DEFI sector
- **Scout score (provisional):** 5/10 — strong overall volume, but unlock risk + unverified Base pool
- **Action:** Henry to verify Base contract address, Aerodrome pool liquidity >$100K, 24h DEX volume >$50K, pool age >3 days before adding

### 2. AERO — Aerodrome Finance
**Recommendation: MONITOR (already in TOKEN_REGISTRY)**

- Already in TOKEN_REGISTRY as AERO (0x940181a94A35A4569E4529A3CDfB74e38FD98631)
- AERO up 44% the week of June 21, 2026; $43M 24h volume
- Aerodrome TVL ~$453.76M, $12.39B 30-day volume
- Predictive Allocation upgrade launching July 2026 (replaces weekly gauge voting)
- Aerodrome + Velodrome merging into unified "Aero" DEX (target early July 2026)
- **Implication for bot:** AERO's pricing dynamics will change post-merge. Monitor execution.

### 3. STRATO — StratoVM
**Recommendation: REJECT (not yet live)**

- Bitcoin L2 with EVM compatibility
- Community ICO June 3, 2026. TGE: Q4 2026
- Not on Base, not yet live. Fails pool age filter.

### 4. BOSON — Boson Protocol
**Recommendation: REJECT (insufficient volume)**

- 24h volume: $128,082 — well below $50K threshold on most days
- Delisted from HTX (April 2026) due to insufficient trading volume
- Market cap ~$5.9M. Fails quality filter.

### 5. Base Native Token (speculative)
**Recommendation: WATCH**

- Coinbase exploring a Base network token (Jesse Pollak confirmed September 2025)
- Polymarket: 23% odds by June 30, 2026; 69% odds by December 31, 2026
- No contract address or airdrop criteria announced
- If launched: would be a major BLUE_CHIP addition. Watch for announcement.

---

## Market Context for Cohort Strategy

**Current regime (June 2026):** Recovery/base-building after 70-day bear
- Bitcoin ~$63.4K, reclaimed bull support band in May 2026
- Altcoin season index recovering but not confirmed altcoin season yet
- "Capital concentrated into fewer higher-quality assets" — COHORT_QUALITY_7 positioning looks correct
- DeFi, infrastructure tokens outperforming memes/speculation

**Implication for cohort composition:**
- Quality-focused COHORT_QUALITY_7 (cbBTC, WETH + Coinbase-wrapped assets) is well-aligned with the current market structure
- LINK, cbSOL showing continued institutional interest
- cbLTC HOLD_ONLY status should be reviewed if Base liquidity has improved since May 2026

---

## Action Required from Henry

1. **Verify HOME (DeFi.app) Base contract** → check Basescan, GeckoTerminal pool
2. **Review cbLTC HOLD_ONLY status** → check if Aerodrome liquidity improved post-bear
3. **Option B post-mortem** → compare cohort PnL vs cbBTC/WETH 60/40 benchmark for May 15 – June 15 period
4. **Recovery parameter review** → see MEDIC_REPORT.md for full table of bear-adjusted constants that may need relaxation
5. **Restart decision** → bot is on paper mode since May 28; when to redeploy real capital?

---

*This proposal was generated by the NVR autonomous scout (Run #35, 2026-06-26). No TOKEN_REGISTRY changes were made. Cohort changes require Henry's explicit human PR.*
