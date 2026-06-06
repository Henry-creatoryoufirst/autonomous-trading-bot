# COHORT PROPOSAL — 2026-06-06

**Filed by:** NVR Capital autonomous agent (scout run #35)
**Status:** PENDING HUMAN REVIEW — Option B window active through ~2026-06-15
**Rule 1 Note:** TOKEN_REGISTRY additions are blocked until window closes. This file replaces what would otherwise be an automatic `feat(scout)` commit.

---

## Why This File Exists

Option B benchmark window started 2026-05-15, closes ~2026-06-15 (9 days remaining).
CLAUDE.md Rule 1 prohibits automatic TOKEN_REGISTRY additions during this window.
Per rule: "If you have a candidate, write a COHORT_PROPOSAL to the Cathedral vault instead."
NVR-HQ vault not present in this repo checkout — filing at repo root.

---

## Scout Run Conditions (2026-06-06)

**Data access:** BLOCKED
- `api.geckoterminal.com` → 403 (Claude Code egress allowlist excludes this host)
- `dexscreener.com` → 403
- `coingecko.com` → 403
- Bot production API → 403 (same persistent issue, Run #35)

**Data source used:** Web search only (no real-time liquidity/volume verification possible)

**Quality filter criteria (cannot be verified without API access):**
- Pool liquidity > $100k USD ← UNVERIFIABLE
- 24h volume > $50k USD ← UNVERIFIABLE
- Pool age > 3 days ← UNVERIFIABLE
- Not already in TOKEN_REGISTRY ← VERIFIED (can check locally)

---

## Candidates From Web Research

### 1. Aero (Unified Aerodrome/Velodrome Token)
- **Status:** Q2 2026 launch (Aerodrome + Velodrome merger via Dromos Labs)
- **What it is:** The merged successor token when Aerodrome and Velodrome combine into a single cross-chain DEX platform. Existing AERO holders receive 94.5% of new supply.
- **Already in registry?** AERO (Aerodrome Finance, `0x940181a94A35A4569E4529A3CDfB74e38FD98631`) is already tracked. The NEW "Aero" merger token would have a different contract address.
- **Scout recommendation:** Watch for new contract address. If Aero TGE has occurred by June 15, this is a strong candidate post-window — deep liquidity (NVR routes 60%+ of trades through Aerodrome), established protocol, MEDIUM risk, DEFI sector.
- **Verified:** Address UNKNOWN (merger may not be live yet). Cannot add.

### 2. DeFi.app
- **Status:** TGE scheduled June 2026 (Phemex June crypto events calendar)
- **What it is:** DeFi aggregator/neobank — positioned as a next-gen DeFi interface on Base
- **Scout recommendation:** Interesting post-window candidate if it launches with sufficient liquidity. No Base contract address confirmed from web search.
- **Risk:** NEW token, high risk until pool age > 3 days and liquidity > $100k verified
- **Verified:** Address UNKNOWN. Cannot add.

### 3. STRATO
- **Status:** TGE scheduled June 2026 (Phemex June crypto events calendar)
- **What it is:** L2 infrastructure / DeFi protocol, Base-native
- **Scout recommendation:** Post-window watchlist. No contract address available from web search.
- **Verified:** Address UNKNOWN. Cannot add.

---

## Tokens Considered and Rejected

| Symbol | Reason Rejected |
|--------|----------------|
| ZORA | Already in TOKEN_REGISTRY |
| CLANKER | Already in TOKEN_REGISTRY |
| BRETT | Already in TOKEN_REGISTRY |
| MOG | Already in TOKEN_REGISTRY |
| cbSOL | Already in TOKEN_REGISTRY |
| cbDOGE | Already in TOKEN_REGISTRY |
| General "Base ecosystem" | No specific candidate with verified liquidity found |

---

## Recommendation for Henry (Post-Window, ~2026-06-15+)

1. **Add `api.geckoterminal.com` and `api.dexscreener.com` to Claude Code egress allowlist** — this has been the blocker for 35 consecutive runs. Without it, scout can only do web-search-based research, which cannot verify the $100k liquidity / $50k volume / 3-day age criteria that are the foundation of the quality filter.

2. **Check Aero merger status:** If the Aerodrome/Velodrome → Aero unified token has launched by June 15, get the new Base contract address from `basescan.org` and run it through the quality filter. Given NVR's routing reliance on Aerodrome, this is the highest-priority post-window candidate.

3. **Check DeFi.app and STRATO** after their TGEs: wait at least 3 days for pool to mature, then run through GeckoTerminal quality filter.

4. **Option B window closes ~2026-06-15:** The 7-token cohort (cbBTC, WETH, cbXRP, cbLTC, LINK, cbADA, cbSOL) has been running clean for 22 days. Any additions after the window should be reviewed against the 30-day benchmark performance first to protect alpha attribution.

---

*Filed: 2026-06-06 | Agent run #35 | Branch: claude/cool-sagan-xeuvR*
