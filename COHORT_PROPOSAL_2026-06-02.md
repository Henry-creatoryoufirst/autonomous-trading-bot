# Cohort Proposal — 2026-06-02

**Status:** Pending human review  
**Window:** Option B closes ~2026-06-15 — review before that date  
**Author:** NVR Agent (Token Scout job, run 2026-06-02)

---

## Why this file exists

CLAUDE.md Rule 1 locks the 7-token quality cohort (`COHORT_QUALITY_7`) until ~2026-06-15.
Scout job ran today (17 days since last run on 2026-05-16), identified one candidate and one
structural concern. Cannot add to TOKEN_REGISTRY; writing this proposal instead per Rule 1 guidance.

---

## Candidate 1 — cbMEGA (Coinbase Wrapped MEGA)

**What it is:** Coinbase's wrapped version of MEGA (MegaETH), part of the same
`cb*` wrapped-asset family as cbBTC, cbXRP, cbSOL, cbADA, cbDOGE.

**Why it's interesting:**
- Follows the exact quality thesis that drives Option B: Coinbase-backed 1:1 wrapped asset,
  not a speculative token. Matches BLUE_CHIP risk profile of the existing cohort.
- 24h volume reported at $2.19M (CoinMarketCap, May 2026 data point) — well above the
  $50k scout filter. If sustained, this is meaningful liquidity for a new wrapped asset.
- Category fit: would slot into BLUE_CHIP alongside cbBTC, WETH, cbXRP, cbLTC, cbADA, cbSOL
  (all existing cohort members).

**What was NOT verified (network restrictions blocked all DEX APIs):**
- Base L2 contract address (CoinMarketCap page links to cbMEGA but address unconfirmed)
- Pool liquidity > $100k on Base (required scout filter)
- Pool age > 3 days on Base (required scout filter)
- Whether Aerodrome has a live cbMEGA/USDC or cbMEGA/WETH pool

**Proposed registry entry (subject to Henry verification):**
```typescript
cbMEGA: {
  address: "<<VERIFY on basescan.org>>",
  symbol: "cbMEGA", name: "Coinbase Wrapped MEGA", coingeckoId: "coinbase-wrapped-mega",
  sector: "BLUE_CHIP", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
},
```
Note: decimals likely 18 (standard ERC-20) but verify on BaseScan. Risk MEDIUM (not LOW) because
MegaETH is a newer L2 — less proven than BTC/ETH/SOL. Adjust to LOW if liquidity deepens.

**Action required:**
1. Visit basescan.org and search "cbMEGA" to confirm contract address on Base
2. Check Aerodrome / GeckoTerminal for pool liquidity and age
3. If liquidity > $100k and pool age > 3 days → approve for TOKEN_REGISTRY after June 15

---

## Structural Concern — Aerodrome → Aero Merger (Q2 2026)

**What's happening:**
Dromos Labs is merging Aerodrome (Base) and Velodrome (Optimism) into a unified DEX called
**Aero**, launching Q2 2026. Migration involves:
- LP migration to MEV-resistant "Slipstream V3" pools
- New METADEX03 operating system with embedded MEV auctions
- Expansion to Ethereum mainnet and Circle's Arc
- AERO token: holders keep 94.5% of supply (VELO holders get 5.5%)

**Impact on the bot:**
1. **Router:** `agent-v3.2.ts` uses Aerodrome Slipstream router addresses. The new Slipstream V3
   pools may have different contract addresses. Monitor for `Insufficient liquidity` or
   `Invalid pool` errors after the Aero launch — may need router address updates.
2. **AERO token:** Already in TOKEN_REGISTRY (`sector: DEFI, riskLevel: MEDIUM`). The merger
   should be AERO-positive (absorbs VELO supply, expands to ETH mainnet). No registry change needed.
3. **LP pools:** If LPs are required to migrate by the Aero launch date, some pools will
   temporarily lose liquidity during migration. Bot should handle gracefully via existing
   VWS_MIN_LIQUIDITY_USD and retry logic.

**Recommended action (before Aero launch):**
- Monitor /api/errors for router failures after Aero launches
- If routing failures spike, check Aerodrome V2 contract addresses vs new Aero addresses
- This is watch-list, not urgent. No code change needed today.

---

## Scout Session Metadata

| Item | Value |
|------|-------|
| Scan date | 2026-06-02 |
| Last scout | 2026-05-16 (17 days ago) |
| APIs available | Web search only (GeckoTerminal, DexScreener, DefiLlama all 403 from this container) |
| Tokens scanned | Registry already has 50+ tokens; focus on new/emerging |
| Quality passes (unverified) | 1 (cbMEGA) |
| Token registry unchanged | ✓ (Rule 1 compliant) |
