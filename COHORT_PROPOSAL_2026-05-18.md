# Cohort Proposal — 2026-05-18

**Run type:** Hourly agent — TOKEN SCOUT  
**Branch:** claude/cool-sagan-9Cu3T (per CLAUDE.md Rule 2 — not pushed to staging/main)  
**Option B window:** Active until ~2026-06-15  
**CLAUDE.md Rule 1 status:** ENFORCED — TOKEN_REGISTRY not modified. Candidates documented here for Henry's review.

---

## Scout Context

Last successful scout commit: 2026-05-16 11:08 UTC (~49 hours ago, threshold 48h).  
Scout triggered for this run.

**Network constraints in this container:** Railway bot API, GeckoTerminal API, and BaseScan are all network-blocked (host not in allowlist). Research conducted via WebSearch only. Contract addresses and exact pool metrics could not be verified on-chain from this environment — Henry should verify before merging.

---

## Candidates Evaluated

### ✅ CANDIDATE: cbMEGA (Coinbase Wrapped MEGA)

| Metric | Value | Threshold | Pass? |
|--------|-------|-----------|-------|
| 24h trading volume | ~$2.19M | >$50k | ✅ |
| Pool age | ~18 days (launched 2026-04-30) | >3 days | ✅ |
| Liquidity | ~Unknown (can't verify from container) | >$100k | ⚠️ Needs verification |
| Already in registry? | No | Not present | ✅ |

**Description:** Coinbase-wrapped MegaETH token, launched on Base on April 30, 2026 alongside MEGA's TGE on Binance/Coinbase. Follows the same Coinbase-backed wrapper pattern as cbBTC, cbXRP, cbLTC, cbADA, cbSOL, cbDOGE — all of which are in COHORT_QUALITY_7 or TOKEN_REGISTRY. 24h volume of $2.19M signals real trading activity.

**Proposed registry entry:**
```typescript
cbMEGA: {
  address: "NEEDS_VERIFICATION — check basescan.org/tokens for 'Coinbase Wrapped MEGA'",
  symbol: "cbMEGA", name: "Coinbase Wrapped MEGA", coingeckoId: "coinbase-wrapped-mega",
  sector: "BLUE_CHIP", riskLevel: "MEDIUM", minTradeUSD: 15, decimals: 18,
},
```

**Quality score: 6.5/10**  
Positives: Coinbase-backed 1:1 custody (same trust model as cbBTC), strong 24h volume, Base-native, fits existing BLUE_CHIP cb-wrapper pattern.  
Concerns: MEGA fell 38% in 72 hours post-listing (source: Bitcoin.com); price may still be in discovery; market cap ranking is low (#8469 CMC). Recommend waiting for price stabilization before adding.

**Recommended action:** Hold — revisit after 2026-06-15 Option B window closes, or if MEGA price stabilizes and liquidity deepens above $500k.

---

### ❌ REJECTED: BASE network token

Not yet launched. Polymarket assigns 69% probability of launch before Dec 2026. No tradeable pool exists yet. Skip.

---

### ❌ REJECTED: New Virtuals Protocol agents (generic)

Virtuals Protocol ecosystem still active ($80M 24h VIRTUAL volume, 18k+ agents), but the specific agent sub-tokens (e.g., TIBBIR, WIRE, GAME, ETHY, LUNA, AXR, BNKR) are already in TOKEN_REGISTRY. No specific new Virtuals agent token cleared the $100k liquidity / $50k volume / 3-day age triple filter via available WebSearch data. Skip.

---

### ❌ REJECTED: Aerodrome/Velodrome merger "Aero" token

Dromos Labs merged Aerodrome + Velodrome into a unified DEX called "Aero" expanding to Ethereum + Circle's Arc chain in Q2 2026. However, AERO is already in TOKEN_REGISTRY (0x940181a94a35a4569e4529a3cdfb74e38fd98631). No new separate token detected — appears to be a protocol merger, not a new token TGE. Skip.

---

## Full Candidate Table

| Symbol | 24h Vol | Liq | Pool Age | Score | Decision |
|--------|---------|-----|----------|-------|----------|
| cbMEGA | $2.19M | ⚠️ unverified | 18 days | 6.5/10 | PROPOSE (post-window) |
| BASE | N/A | N/A | N/A | N/A | REJECT (not launched) |
| New Virtuals agents | unclear | unclear | varies | varies | REJECT (existing coverage) |
| Aero merge token | N/A | N/A | N/A | N/A | REJECT (AERO already in registry) |

---

## Medic Status (Job 1)

Bot API unreachable from this container (Railway hostname not in network allowlist). Could not fetch `/api/errors` or `/api/balances`. No critical condition confirmed or denied. **Henry: please manually verify bot health at the Railway dashboard.**

## Auditor Status (Job 3)

Bot API unreachable — could not fetch `/api/trades`, `/api/portfolio`, `/api/patterns`, or `/api/adaptive`. Win rate, drawdown, and losing streak metrics unavailable. Audit condition check skipped. **Henry: please verify metrics manually before the next run.**

---

## Action Required from Henry

1. **Verify cbMEGA liquidity** on basescan.org or GeckoTerminal — confirm pool liquidity >$100k.
2. **Get contract address** for cbMEGA on Base (search "Coinbase Wrapped MEGA" on basescan.org/tokens).
3. **Decision:** If liquidity checks out and MEGA price stabilizes, add cbMEGA to TOKEN_REGISTRY after the Option B window (~2026-06-15) via a reviewed PR.
4. **Bot health check:** Manually verify Railway dashboard — this agent could not reach the production API.
