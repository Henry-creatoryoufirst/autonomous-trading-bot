# Cohort Proposal — 2026-06-08

**Status:** PROPOSAL ONLY — awaiting human review per CLAUDE.md Rule 1  
**Window closes:** ~2026-06-15 (7 days remaining)  
**Prepared by:** Scout cron run (claude/cool-sagan-9WRJf)

---

## Candidates Evaluated

| Symbol | Pool Liquidity | 24h Volume | Pool Age | Already in Registry | Score | Decision |
|--------|---------------|------------|----------|---------------------|-------|----------|
| NOCK   | $2.15M        | $2.48M     | 6+ mo    | No                  | 6.5/10 | PROPOSE ✅ |
| TEA    | Unknown       | Unknown    | 4 days   | No                  | 3/10  | REJECT ❌ |

---

## NOCK — Nockchain (Recommended Add)

**Token address (Base):** `0x9B5E262cF9bb04869ab40b19AF91D2dc85761722`  
**Pool (Aerodrome):** NOCK/USDC — `0x85f1aa3a70fedd1c52705c15baed143e675cd626`  
**CoinGecko ID:** `nockchain`  
**Decimals:** 18  
**Proposed sector:** DEFI  
**Proposed riskLevel:** HIGH  
**Proposed minTradeUSD:** 25

### Quality Scores (1-10)

| Dimension | Score | Notes |
|-----------|-------|-------|
| Volume consistency | 6 | $2.48M 24h; single-day snapshot only |
| Liquidity depth | 7 | $2.15M — solid for MEDIUM risk tier |
| Pool age | 8 | Base bridge live since late 2025; NOCK L1 launched May 2025 |
| Momentum | 5 | +2.26% past 24h; low-volatility day |
| Category fit | 7 | zkPoW compute infrastructure — legitimate DEFI niche |
| **Overall** | **6.5** | Meets 6+ threshold |

### Project Summary

Nockchain is a zero-knowledge Proof-of-Work (zkPoW) Layer-1 designed as an infrastructure layer for compute networks. The token (NOCK) is the native asset bridged to Base as an ERC-20. It was fair-launched on May 21, 2025 with no pre-mining. The Base/Aerodrome pool has been live since late 2025.

**Strengths:**
- Fair launch, no VC allocation
- Legitimate infrastructure use-case (zkPoW compute)
- Strong liquidity for its market cap
- Pool age well above 3-day filter

**Risks:**
- L1 bridge dependency (wrapped asset, not native Base token)
- Relatively small FDV (~$6.75M)
- Single liquidity venue (Aerodrome only)

---

## TEA — Tea Protocol (Rejected)

- Launched June 4, 2026 — only 4 days old at scan time
- 80% of supply locked (unlock schedule unknown — dump risk)
- Pool age barely clears 3-day threshold; too close to TGE for reliable liquidity signals
- Score: 3/10 — REJECTED

---

## Why This Is a Proposal, Not a Commit

CLAUDE.md Rule 1 prohibits automated `feat(scout)` commits to TOKEN_REGISTRY during the Option B 30-day benchmark window (ends ~2026-06-15). Three prior auto-adds (MOLT, OPENX, VEIL) were reverted because they muddy alpha attribution.

**Henry:** If you agree NOCK merits inclusion, the TOKEN_REGISTRY entry would be:

```typescript
  NOCK: {
    address: "0x9B5E262cF9bb04869ab40b19AF91D2dc85761722",
    symbol: "NOCK", name: "Nockchain", coingeckoId: "nockchain",
    sector: "DEFI", riskLevel: "HIGH", minTradeUSD: 25, decimals: 18,
  },
```

Place under `// === AUTO-DISCOVERED (scout 2026-06-08) ===` in `src/core/config/token-registry.ts`.

---

## Scout Research Notes

**API access:** GeckoTerminal API returned 403 from this container (network allowlist); data sourced via WebSearch + DEX Screener.  
**Sources:** dexscreener.com/base, geckoterminal.com/base/pools, coinbase.com/price/nock-base-*, nockchain.org
