# COHORT PROPOSAL — 2026-05-21

**Filed by:** NVR Capital autonomous agent (scout run #35)  
**Status:** PROPOSAL ONLY — NOT added to TOKEN_REGISTRY per CLAUDE.md Rule 1 (Option B benchmark window, cohort locked until ~2026-06-15)  
**Previous scout run:** 2026-05-16 (VEIL added, then reverted per Rule 1)  
**Elapsed since last scout:** 5 days (>48h threshold met)

---

## Why No TOKEN_REGISTRY Changes

CLAUDE.md Rule 1 explicitly prohibits `feat(scout): add <SYMBOL> to TOKEN_REGISTRY` during the 30-day Option B benchmark window (2026-05-15 → ~2026-06-15). Auto-adds muddy alpha attribution. Three prior auto-adds (MOLT, OPENX, VEIL) were all reverted. This file is the compliant alternative.

---

## Research Conducted

- WebSearch: "new tokens Base L2 high volume trending 2026 May"
- WebSearch: "Base L2 DEX Aerodrome trending tokens high liquidity volume May 2026"
- Note: GeckoTerminal API (api.geckoterminal.com) is blocked from this sandbox (403 on all endpoints). Pool-level metrics (liquidity, volume, age) could NOT be independently verified.

---

## Scout Observations

### Market Context
- Base DEX (Aerodrome) maintains >$400M daily volume, >$1.2B TVL as of May 2026
- AERO token surged ~11% on May 10 with 98% volume increase, signalling active market
- Base is the primary hub for AI agent activity in 2026, with increased institutional flow

### Potential Candidates (UNVERIFIED — GeckoTerminal blocked)

Without pool-level data verification, no specific new token can be added to the filter evaluation table. The search results identified general market trends but not specific qualifying pools meeting all four criteria (liq >$100K, 24h vol >$50K, age >3 days, not in TOKEN_REGISTRY).

| Candidate | Observation | Filter Status | Notes |
|-----------|-------------|---------------|-------|
| *(none verified)* | GeckoTerminal blocked from sandbox | Cannot evaluate | Needs Henry to check api.geckoterminal.com manually |

---

## Recommendation for Henry

1. **After the Option B window closes (~2026-06-15):** Run `curl "https://api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1"` manually and evaluate against scout filters
2. **Fix the sandbox egress:** Add `api.geckoterminal.com` to the Claude Code egress allowlist so future scouts can verify pool data automatically
3. **Current cohort is performing:** COHORT_QUALITY_7 (cbBTC, WETH, cbXRP, cbLTC, LINK, cbADA, cbSOL) is the right focus for the Option B window — no additions needed until window closes

---

## Scout Safety Confirmation

- TOKEN_REGISTRY: **NOT modified** ✓
- COHORT_QUALITY_7: **NOT modified** ✓
- main/staging branches: **NOT pushed** ✓
