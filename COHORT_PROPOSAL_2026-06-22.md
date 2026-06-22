# NVR Cohort Proposal — 2026-06-22

**Filed by:** Autonomous agent (scout run #35)
**Status:** PROPOSAL ONLY — per CLAUDE.md Rule 1, no TOKEN_REGISTRY edits were made.
**Option B window:** Closed ~2026-06-15. Cohort changes still require explicit human PR.

---

## Scout Conditions This Run

- Last scout commit with non-reverted additions: 2026-05-08 (SYRUP). Last attempted post-pivot additions (MOLT 2026-05-14, OPENX/VEIL 2026-05-16) were all reverted. 48h threshold: exceeded (38+ days).
- GeckoTerminal API (`api.geckoterminal.com`): **BLOCKED** by sandbox egress allowlist. Precise pool liquidity, 24h volume, and pool age cannot be verified for any candidate. This is a persistent constraint — the same block that prevents Medic from checking the bot API.
- WebSearch used as fallback data source. Contract addresses and exact metrics below are best-effort from web sources only; all should be confirmed on-chain before any human PR.

---

## Candidates Evaluated

### 1. cbMEGA — Coinbase Wrapped MEGA

- **Status:** Watch list carry-over from Run #27 (2026-05-04). Agent could not confirm contract address at that time due to API block.
- **What is known:** Coinbase wrapped asset (MEGA is MegaETH token). Mentioned in Coinbase wrapped assets family alongside cbBTC, cbETH, cbXRP, cbADA, cbLTC, cbDOGE, cbSOL.
- **Contract address:** UNCONFIRMED — not in TOKEN_REGISTRY; could not locate verified Base L2 address via WebSearch.
- **Liquidity/volume:** UNKNOWN — GeckoTerminal blocked.
- **Scout verdict:** CANNOT EVALUATE. Requires human to check BaseScan / Aerodrome pool list. If it exists with >$100K liquidity and >$50K 24h volume, it fits the BLUE_CHIP LOW-risk pattern alongside the other cb-wrapped assets.

### 2. AERO (Aerodrome Finance)

- **Status:** Already in TOKEN_REGISTRY (sector: DEFI, riskLevel: MEDIUM, minTradeUSD: 15).
- **Scout verdict:** SKIP — already tracked.

### 3. cbDOGE (Coinbase Wrapped DOGE)

- **Status:** Already in TOKEN_REGISTRY (sector: BLUE_CHIP, riskLevel: LOW, minTradeUSD: 15, decimals: 8).
- **Scout verdict:** SKIP — already tracked.

### 4. cbSOL (Coinbase Wrapped Solana)

- **Status:** Already in TOKEN_REGISTRY (sector: BLUE_CHIP, riskLevel: LOW, minTradeUSD: 15, decimals: 18).
- **Note:** WebSearch found no `cbSOL` in Coinbase's official wrapped asset announcements (official list mentions cbBTC, cbETH, cbXRP, cbADA, cbLTC, cbDOGE, cbMEGA but not cbSOL). Recommend confirming `0x2f280d1b1c738d71a6e7adeb1a84c8f2f114594c` is a legitimate Coinbase-wrapped SOL on Base (may be a community/third-party wrapper rather than official Coinbase product).
- **Scout verdict:** In registry. Flagging for Henry to verify official Coinbase status.

### 5. Market-wide scan result

- WebSearch for "new Base L2 tokens May-June 2026 high volume Aerodrome": No specific new token launches with verified contract addresses found. General ecosystem context: Base DeFi TVL ~$4.5B, Aerodrome 30-day volume ~$45B. Most June 2026 token activity is Hyperliquid token unlocks on Hyperliquid's own L1, not Base.

---

## Summary Table

| Token | In Registry | Contract Verified | Liq > $100K | Vol > $50K | Pool Age > 3d | Score | Action |
|-------|-------------|------------------|-------------|------------|----------------|-------|--------|
| cbMEGA | NO | ❌ UNCONFIRMED | UNKNOWN | UNKNOWN | UNKNOWN | N/A | Human check needed |
| AERO | YES | ✅ | — | — | — | — | Already tracked |
| cbDOGE | YES | ✅ | — | — | — | — | Already tracked |
| cbSOL | YES | ⚠️ verify official | — | — | — | — | Verify Coinbase status |

---

## Recommended Human Action

1. **cbMEGA**: Check BaseScan for `cbMEGA` token on Base. If found with Aerodrome pool, verify: pool liquidity >$100K, 24h volume >$50K, pool age >3 days. If passes, add to TOKEN_REGISTRY under BLUE_CHIP / LOW risk / decimals: 8 (Coinbase wraps typically use 8 decimals for coin assets, 18 for token assets).

2. **cbSOL authenticity**: Confirm `0x2f280d1b1c738d71a6e7adeb1a84c8f2f114594c` is officially Coinbase-issued. Coinbase's official wrapped asset list (May 2025 announcements) did not include cbSOL. If it's a third-party wrapper, consider reclassifying risk from LOW to MEDIUM.

3. **Egress allowlist**: The primary fix to unblock all future scout runs is adding `api.geckoterminal.com` to the Claude Code egress allowlist. Without it, the scout cannot verify any candidate's liquidity, volume, or pool age.

---

*Filed per CLAUDE.md Rule 1. TOKEN_REGISTRY unchanged. Human PR required for any additions.*
