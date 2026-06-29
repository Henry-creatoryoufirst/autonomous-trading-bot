# NVR Scout Cohort Proposal — 2026-06-29

**Agent run:** Hourly scout, 2026-06-29T07:xx UTC  
**Last scout commit:** 2026-05-25 (35 days ago)  
**Status:** Research-only — TOKEN_REGISTRY NOT modified (CLAUDE.md Rule 1 active)

---

## Data Source Issues This Run

The proxy network policy blocked all primary data sources:
- `api.geckoterminal.com` — 403 connect_rejected (policy denial)
- `geckoterminal.com` — 403 connect_rejected
- `defillama.com` — 403 connect_rejected
- `coingecko.com` — 403 connect_rejected
- `autonomous-trading-bot-production.up.railway.app` — 403 connect_rejected

Quality-filter metrics (pool liquidity, 24h volume, pool age) could **not** be verified programmatically. All findings below are from WebSearch only and require human verification before any TOKEN_REGISTRY changes.

---

## Candidates Evaluated

### ❌ Tokens Already in Registry (excluded)

| Symbol | Why Excluded |
|--------|-------------|
| VIRTUAL | Already in TOKEN_REGISTRY (AI_TOKENS, HIGH risk) |
| VVV | Already in TOKEN_REGISTRY (Venice Token, AI_TOKENS) |
| WIRE | Already in TOKEN_REGISTRY (717ai, AI_TOKENS, +105% in March 2026) |
| HYDX | Already in TOKEN_REGISTRY (Hydrex, DEFI) |
| AERO | Already in TOKEN_REGISTRY (Aerodrome, DEFI) |

### 🔍 Candidates Requiring Verification

#### 1. Bitte Protocol (BITTE?)
- **Category:** AI agent infrastructure — on-chain execution layer for dApps
- **Activity:** 8,000+ active agents, 700K+ conversational transactions as of Feb 2026
- **Base Address:** Unknown — could not retrieve (API blocked)
- **Liquidity:** Unknown — could not verify
- **24h Volume:** Unknown — could not verify
- **Pool Age:** Unknown
- **Score:** Cannot score — data unavailable
- **Recommendation:** Henry to check geckoterminal.com/base/pools for Bitte liquidity. If >$100k liq, >$50k 24h vol, >3 days old: viable DEFI/AI_TOKENS MEDIUM candidate.

#### 2. Aero (new unified AERO token from Aerodrome+Velodrome merger)
- **Category:** DeFi — Dromos Labs unified DEX token, Q2 2026 merger
- **Note:** Aerodrome and Velodrome merging into single "Aero" protocol in Q2 2026. The new AERO unifies VELO (~5.5%) + AERO (~94.5%). Existing AERO entry in registry may need address update when migration completes.
- **Action:** No new entry needed — existing AERO entry should be validated post-merger.
- **Recommendation:** Henry to verify AERO contract address hasn't changed post-merger.

#### 3. Hyperliquid (HYPE)
- **Category:** DeFi — perpetuals DEX, now top-10 altcoin by market cap
- **Note:** HYPE is NOT natively on Base chain — operates on its own L1. Not eligible for this registry.
- **Score:** Rejected (not Base L2)

---

## Summary Table

| Candidate | In Registry | Base L2 | Data Available | Verdict |
|-----------|-------------|---------|----------------|---------|
| VIRTUAL | Yes | Yes | N/A | Skip |
| VVV | Yes | Yes | N/A | Skip |
| WIRE | Yes | Yes | N/A | Skip |
| HYDX | Yes | Yes | N/A | Skip |
| BITTE | No | Likely | No (API blocked) | Needs Henry verification |
| Aero (new) | Partial (AERO) | Yes | Partial | Verify address post-merger |
| HYPE | No | No | N/A | Rejected (wrong chain) |

---

## Action Required from Henry

1. **Check geckoterminal.com/base/pools** for Bitte Protocol: if it clears the quality filter (>$100k liq, >$50k 24h vol, >3 days old), open a PR to add it to TOKEN_REGISTRY under AI_TOKENS, MEDIUM risk, minTradeUSD: 25.
2. **Verify AERO contract address** hasn't changed with the Aerodrome→Aero merger in Q2 2026.
3. **Consider re-enabling proxy access** to geckoterminal.com and defillama.com so the scout agent can do full programmatic filtering. Currently blocked (connect_rejected).

---

## Ecosystem Context (for Henry's situational awareness)

- Base is #1 Ethereum L2 by DeFi TVL (46.6% of all L2 DeFi liquidity)
- Base's 24h DEX volume: $931.9M as of this run (+68% vs prior day)
- Aerodrome dominates Base: >$400M daily volume, >$1.2B TVL, launching predictive allocation in July 2026
- AI agent tokens continue to outperform the broader altcoin market on Base
- Autonomous trading infrastructure trend: Intent-based execution (anti-MEV via private relay) is the 2026 frontier

---

*No TOKEN_REGISTRY changes made. This proposal awaits human review per CLAUDE.md Rule 1.*
