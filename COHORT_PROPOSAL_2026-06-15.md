# Cohort Proposal — 2026-06-15

**Filed by:** NVR autonomous agent (hourly run #35)
**Status:** PROPOSAL ONLY — awaiting Henry's review per CLAUDE.md Rule 1
**Context:** Option B 30-day window ends today (~2026-06-15). Cohort remains locked until Henry opens it via explicit PR. Candidates below are for Henry's consideration when reviewing the window outcome.

---

## Scout Summary

Last scout commit: 2026-05-14 (MOLT added). Days elapsed: ~32 days. Threshold: 48h. **Scout is overdue.**

GeckoTerminal API and DexScreener are not accessible from this execution environment (403 Forbidden on all direct API calls). Candidates sourced from web search / market news cross-referenced against TOKEN_REGISTRY.

---

## Candidates Evaluated

### VELVET ✅ Likely Qualifies

| Metric | Value | Threshold | Pass? |
|--------|-------|-----------|-------|
| 24h Volume | $55.57M | > $50k | ✅ |
| Liquidity | Unverified (egress blocked) | > $100k | ❓ |
| Pool Age | Active since before June 11 surge | > 3 days | ✅ |
| In Registry? | No | — | ✅ |

**Evidence:** "VELVET Market Brief" (interactivecrypto.com, June 2026) reports 140% price surge on June 11, 2026. Trading at ~$0.44. 24h volume $55,570,010 — 11.45x its 30-day average. Significant momentum event.

**Quality Score: 6/10** (high volume confirmed, liquidity and age unverifiable without direct API access)
- Volume consistency: strong single-event surge but unverified trend
- Liquidity depth: unknown
- Momentum: strong (140% surge, 11.45x avg volume)
- Category fit: unclear (likely DeFi or AI token based on name)

**Risk Level:** HIGH (single-day surge, unknown fundamentals)
**Suggested registry entry if approved:**
```typescript
VELVET: {
  address: "VERIFY_ON_DEXSCREENER_BEFORE_ADDING",
  symbol: "VELVET", name: "Velvet", coingeckoId: "velvet",
  sector: "DEFI", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
},
```
**⚠️ Address must be verified before adding. Do not add without on-chain confirmation.**

---

### TEA ✅ Likely Qualifies (conditional)

| Metric | Value | Threshold | Pass? |
|--------|-------|-----------|-------|
| 24h Volume | Unverified | > $50k | ❓ |
| Liquidity | Unverified | > $100k | ❓ |
| Pool Age | ~11 days (launched June 4) | > 3 days | ✅ |
| In Registry? | No | — | ✅ |

**Evidence:** TEA Protocol launched on Aerodrome Ignition on June 4, 2026 with 20% circulating supply at TGE. Aerodrome (via "Aero Ignition" program) streamed $5M+ in AERO emissions at launch. High-profile Aerodrome-backed launch suggests strong initial liquidity.

**Quality Score: 5/10** (Aerodrome Ignition launch is a positive signal, but <14 days old — elevated new-token risk)
- Pool age: 11 days (marginal)
- GUARDIAN_NOVEL_TOKEN_HOURS_DEFAULT = 72h would apply (bot would GUARDIAN-review all entries for 72h)
- Liquidity: likely >$100k given Aerodrome Ignition backing, but unverified
- Category fit: Protocol governance token — likely DEFI sector

**Risk Level:** HIGH (novel token, <14 days old)
**Suggested registry entry if approved:**
```typescript
TEA: {
  address: "VERIFY_ON_AERODROME_BEFORE_ADDING",
  symbol: "TEA", name: "Tea Protocol", coingeckoId: "tea-protocol",
  sector: "DEFI", riskLevel: "HIGH", minTradeUSD: 10, decimals: 18,
},
```
**⚠️ Address must be verified before adding. Do not add without on-chain confirmation.**

---

### IYKYK ❓ Insufficient Data

| Metric | Value | Threshold | Pass? |
|--------|-------|-----------|-------|
| 24h Volume | Unverified | > $50k | ❓ |
| Liquidity | Unverified | > $100k | ❓ |
| Pool Age | Unknown | > 3 days | ❓ |
| In Registry? | No | — | ✅ |

**Evidence:** Appeared in CoinGecko search results for Base tokens, listed on Coinbase price page. Insufficient data for quality assessment.

**Quality Score: 3/10** — REJECTED (insufficient data)

---

### XCN (Chain) — Already Established

Token appeared in weekly volume rankings (~$764M/week), but XCN is an established token not native to Base. Not a new discovery. Skipped.

---

### SPX, TOSHI, DEGEN — Already in Registry

All three appeared in trading volume data. All three are already in TOKEN_REGISTRY. No action needed.

---

## Recommendation for Henry

**Before re-opening the cohort (after Option B window review):**

1. **VELVET** — Verify the contract address on DexScreener/BaseScan, confirm liquidity >$100k, and confirm the surge was organic (not wash trading). If confirmed, reasonable addition as MEME_COINS or DEFI HIGH risk.

2. **TEA** — Check current liquidity and volume on Aerodrome. If it maintained >$100k liquidity and >$50k 24h vol after launch excitement faded, it's a legitimate DEFI candidate. The 11-day age is borderline — consider waiting until it's 30+ days old.

3. **Aerodrome → Aero migration (July 2026)**: This is more urgent than the scout candidates. The bot's Aerodrome Slipstream router address will change when Aero launches in July. Recommend reviewing the router address constant in `agent-v3.2.ts` before end of June to avoid execution failures post-migration.

---

*Written per CLAUDE.md Rule 1: cohort changes happen only via explicit human PR. This proposal requires Henry's review before any TOKEN_REGISTRY modification.*
