# Cohort Proposal — 2026-06-15

**Filed by:** NVR autonomous agent (Run #35)
**CLAUDE.md Rule 1 compliance:** TOKEN_REGISTRY not modified. This file is the artifact
that replaces the auto-add. A human PR is required to act on any candidate below.

---

## Context

The Option B 30-day benchmark window ends today (~2026-06-15). Per CLAUDE.md Rule 1, the
7-token cohort (`COHORT_QUALITY_7`) is locked until Henry reviews Option B performance and
opens an explicit PR. This proposal is forward-looking for the next phase.

The current cohort is: **cbBTC, WETH, cbXRP, cbLTC, LINK, cbADA, cbSOL**

---

## Scan Results

### API Access Status
GeckoTerminal (`api.geckoterminal.com`) and DexScreener (`api.dexscreener.com`) are both
blocked from this execution environment (403 from egress proxy). Quantitative liquidity/volume
screening could not be completed. Scores below are research-quality estimates only.

### Web Research Candidates (June 2026)

#### 1. $BASE — Coinbase L2 Native Token
- **Launch**: May 2026 (Onchain Summer 2026 distribution)
- **What**: Coinbase's own network token for Base L2
- **Strength**: Direct Coinbase integration with 100M+ user base; structural advantage
- **Concern**: Very recently launched (pool age <30 days) — **FAILS 3-day minimum**,
  likely FAILS 30-day confidence window for a quality cohort
- **Score**: 4/10 — Too new. Revisit in 60 days.
- **Decision**: REJECT this cycle. Add to watch list for Q3 2026.

#### 2. cbSOL (already in cohort)
- Already added by scout on 2026-05-04. In COHORT_QUALITY_7.

#### 3. AERO — Aerodrome Finance
- Already in TOKEN_REGISTRY (DEFI sector). Not a cohort candidate (already tracked).

### Observation on Current Cohort Quality

The current 7-token cohort is well-composed for the Option B benchmark:
- 2 Blue Chips (cbBTC, WETH) — serve as the benchmark baseline
- 3 Coinbase Wrapped assets (cbXRP, cbLTC, cbADA) — structural cdp-routing advantage
- 1 Oracle (LINK) — uncorrelated to pure crypto speculation
- 1 Cross-chain (cbSOL) — highest-beta quality name

Given the bear market conditions observed throughout the 30-day window (BEAR regime inferred
from git history through May 2026), no new cohort additions appear warranted without
verifiable on-chain liquidity data.

---

## Recommendation for Henry

1. **No cohort changes recommended at this time** without real GeckoTerminal data.
2. **$BASE token** is worth monitoring for Q3 2026 once pool age >30 days and
   liquidity depth is verifiable.
3. **Fix egress access** so scouts can run properly: add `api.geckoterminal.com` and
   `api.dexscreener.com` to the Claude Code egress allowlist in the session settings.
   This has been blocking proper scout runs for 35 consecutive sessions.
4. **Review Option B results** before making any cohort changes — the benchmark window
   closes today.

---

## Watch List (for Q3 2026 review)

| Token | Category | Why Interesting | Minimum Criteria to Add |
|-------|----------|-----------------|------------------------|
| $BASE | BLUE_CHIP | Coinbase native token, structural advantage | Pool age >30d, liq >$500K, vol >$200K/day |
| cbMEGA | BLUE_CHIP | Coinbase wrapped Mega — flagged Run #27 | Confirm address, verify $500K+ liq |
| SYRUP | DEFI | Added to TOKEN_REGISTRY by Run #33 scout | Already in registry, watch performance |
