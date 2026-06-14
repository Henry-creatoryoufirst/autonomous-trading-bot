# NVR Cohort Proposal — 2026-06-14

## Context

The Option B benchmark window (2026-05-15 → 2026-06-15) closes **tomorrow**.  
CLAUDE.md Rule 1 (cohort lock) lifts after Henry reviews the 30-day results and merges intentionally.

This document captures scout research findings from this run for Henry's post-window review.  
**No changes have been made to TOKEN_REGISTRY.** All additions require a human-reviewed PR per CLAUDE.md.

## Current Cohort (COHORT_QUALITY_7)

| Symbol | Address | Tier |
|--------|---------|------|
| cbBTC  | 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf | Tier 1 (always-on) |
| WETH   | 0x4200000000000000000000000000000000000006 | Tier 1 (always-on) |
| cbXRP  | 0xcb585250f852C6c6bf90434AB21A00f02833a4af | Tier 2 (rotational) |
| cbLTC  | 0xcb17C9Db87B595717C857a08468793f5bAb6445F | Tier 2 (HOLD-ONLY, thin liquidity) |
| LINK   | 0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196 | Tier 2 (rotational) |
| cbADA  | 0xcbada732173e39521cdbe8bf59a6dc85a9fc7b8c | Tier 2 (rotational) |
| cbSOL  | 0x2f280d1b1c738d71a6e7adeb1a84c8f2f114594c | Tier 2 (rotational) |

## Scout Research — This Run (2026-06-14)

### Data Access Constraints

GeckoTerminal API returned 403 (network egress policy blocks external APIs from this execution environment).  
Web search used as fallback for qualitative research.

### Base L2 Ecosystem Signals (Web Search)

- **Base DEX volume** hit $2.9B daily all-time high (ETH-USD pair $1.3B). Aerodrome recorded $1.68B single-day volume ATH.
- **Morpho TVL on Base**: Grew 1906% YTD to $966M — significant DeFi composability signal.
- Base has >1M daily active addresses and $4.7B+ TVL.
- Toshi and Brett remain the dominant Base-native meme tokens.

### Post-Window Candidates for Henry's Review

Without live GeckoTerminal data, these are *directional* proposals based on market research.  
All require liquidity/volume verification before any PR is opened.

| Symbol | Category | Rationale | Verify Before Adding |
|--------|----------|-----------|---------------------|
| MORPHO | DeFi | 1906% YTD TVL growth on Base. Established protocol, not speculative. | Pool age, liq >$100K, 24h vol >$50K |
| AERO | DeFi | Aerodrome's native token — direct exposure to Base's dominant DEX. Already in DEX_SWAP_TOKENS set. | Whether it's already in TOKEN_REGISTRY |
| TOSHI | Meme | Base-native OG meme, strong community longevity signal. High riskLevel. | Pool age >3d, liq, vol |
| BRETT | Meme | Second major Base-native meme. Similar profile to TOSHI. High riskLevel. | Pool age >3d, liq, vol |

### Tokens to Reconsider (Removals)

| Symbol | Concern | Action |
|--------|---------|--------|
| cbLTC | HOLD_ONLY since v21.30.0 — thin liquidity on Base means no active trading | Consider removing from cohort if liquidity hasn't improved |

## Scout Scoring Framework (for Henry's verification pass)

Score 1-10 on: volume consistency (3d), liquidity depth (>$100K), momentum, category fit.  
Add only if score ≥6, pool age >3 days, liq >$100K USD, 24h vol >$50K USD.

Recommended lookup: `https://api.geckoterminal.com/api/v2/networks/base/tokens/{address}`

## Post-Window Decision Checklist

- [ ] Compute final 30-day P&L vs cbBTC/WETH 60/40 benchmark
- [ ] If outperforming by ≥5% annualized → ratify current cohort, consider careful additions
- [ ] If underperforming → review which cohort tokens dragged performance before expanding
- [ ] Review cbLTC HOLD_ONLY status — remove from cohort or wait for liquidity to deepen?
- [ ] Open PRs for any approved additions (one PR per token, human-reviewed)
- [ ] Update Railway env `ALPHA_WATCHER_COHORT` to mirror new symbol list

*Filed by NVR autonomous agent — 2026-06-14 UTC*
