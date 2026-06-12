# Cohort Proposal — 2026-06-12 (Scout Run #35)

## Context
Option B benchmark window is ACTIVE (2026-05-15 → ~2026-06-15, **3 days remaining**).
Per CLAUDE.md Rule 1, TOKEN_REGISTRY and COHORT_QUALITY_7 are locked.
This proposal documents scout findings for Henry's review post-window.

GeckoTerminal API remains blocked from this execution environment (403 on all endpoints).
Research conducted via WebSearch + DEX Screener metadata.

---

## Candidates Evaluated

| Symbol | Name | Liquidity | 24h Vol | Age | Already In Registry | Score |
|--------|------|-----------|---------|-----|---------------------|-------|
| NOCK | Nockchain | $2.15M | $1.27M+ | 13 months | ❌ No | 7/10 ✅ |
| RFL | Reflect | $518K | $10.9K | Unknown | ❌ No | 3/10 ❌ |
| KTA | Keeta | ~$82M pool | Unknown | Unknown | ✅ Already in registry | — |
| AVNT | Avantis | ~$43M pool | Unknown | Unknown | ✅ Already in registry | — |

---

## Primary Candidate: NOCK (Nockchain)

**Recommended for post-Option-B addition.**

| Field | Value |
|-------|-------|
| Symbol | NOCK |
| Name | Nockchain |
| Base contract | `0x9B5E262cF9bb04869ab40b19AF91D2dc85761722` |
| Aerodrome pool | `0x85f1aa3a70fedd1c52705c15baed143e675cd626` (NOCK/USDC) |
| Pool liquidity | $2.15M ✅ (threshold: >$100K) |
| 24h volume | $1.27M–$2.48M ✅ (threshold: >$50K) |
| Pool age | 13+ months (launched May 2025) ✅ (threshold: >3 days) |
| In registry | No ✅ |
| FDV | ~$91.75M (CoinMarketCap) |

### Quality Score: 7/10
- Volume consistency: High ($1–2.5M range) +2
- Liquidity depth: Good ($2.15M) +2
- Momentum: Up (new ZK-PoW L1 gaining traction) +1
- Category fit: ZK infrastructure / DeFi +1
- Age / track record: 13 months, fair launch (no pre-mine) +1
- Risk note: Not blue chip; DEFI / MEDIUM risk appropriate

### Suggested Registry Entry (post-window):
```typescript
NOCK: {
  address: "0x9B5E262cF9bb04869ab40b19AF91D2dc85761722",
  symbol: "NOCK", name: "Nockchain", coingeckoId: "nockchain",
  sector: "DEFI", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
},
```

**Verify before merge:**
- Confirm contract address on BaseScan
- Confirm HOT_MOVER_MIN_FDV_USD gate met ($91.75M FDV >> $1M threshold ✅)
- Check HOLD_ONLY_TOKENS status (liquidity $2.15M should be fine for TWAP slicing)

---

## Rejected Candidates

**RFL (Reflect)**: 24h volume $10.9K — FAILS $50K floor. Pool $518K is marginal. Reject.

---

## Action Required (Henry)

After the Option B window closes (~2026-06-15):
1. Verify NOCK contract on BaseScan: https://basescan.org/token/0x9B5E262cF9bb04869ab40b19AF91D2dc85761722
2. If verified, add NOCK entry to `src/core/config/token-registry.ts`
3. Open a PR from `claude/cool-sagan-7m3mmn` or a new branch — human-reviewed, not auto-merged

*Filed by NVR autonomous agent — Scout Run #35, 2026-06-12T (UTC)*
