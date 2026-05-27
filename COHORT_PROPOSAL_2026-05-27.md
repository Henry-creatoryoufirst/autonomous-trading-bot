# Cohort Proposal — 2026-05-27

**Status:** Research-only. Option B window active (~2026-06-15). Do NOT merge to TOKEN_REGISTRY automatically.
**Author:** Scout agent (hourly run)
**Requires:** Human review + explicit PR merge to token-registry.ts after Option B window closes.

---

## Why this is a proposal and not a direct registry add

CLAUDE.md Rule 1 (Option B cohort lock, active through ~2026-06-15) prohibits automatic additions to `COHORT_QUALITY_7` or `TOKEN_REGISTRY` during the benchmark window. Candidates below are parked here for Henry's post-window review.

Additionally: the GeckoTerminal API and production bot API were both unreachable from this run's environment (network allowlist). The liquidity/volume figures below come from web-search snippets only and have NOT been verified against the quality filter thresholds (liquidity >$100k, 24h vol >$50k, pool age >3 days). Henry should verify via GeckoTerminal or Dune before any add.

---

## Candidates Observed (2026-05-27)

### NOCK
- **Source:** GeckoTerminal Aerodrome trending — "NOCK/USDC" pool appearing in Base Aerodrome top trending
- **Status:** Not in TOKEN_REGISTRY
- **Unverified metrics:** Pool liquidity and age unknown from this run
- **Action needed:** Verify at geckoterminal.com/base/aerodrome-base/pools — if liquidity >$100k, 24h vol >$50k, age >3d → qualifies for proposal
- **Risk estimate:** Unknown — likely MEME_COINS or DEFI; needs categorization

### XCN (Onyxcoin)
- **Source:** GeckoTerminal Uniswap V3 Base trending — "XCN/USDC" pool
- **What it is:** Native token of Onyx Protocol, a Layer-3 on Ethereum/Base. Governance + gas token for Onyx Ledger. Cross-chain via Superbridge.
- **Contract (Ethereum):** `0xA2cd3D43c775978A96BdBf12d733D5A1ED94fb18` (Base address unknown from this run — verify on Basescan)
- **Status:** Not in TOKEN_REGISTRY
- **Unverified metrics:** Pool liquidity and age unknown from this run
- **Action needed:** Find Base contract address on Basescan, check Uniswap V3 Base pool for liquidity/volume/age
- **Risk estimate:** DEFI sector, MEDIUM risk (established protocol, not brand new)

### VVV (Venice Token)
- **Source:** Aerodrome trending — "VVV/WETH" in top pools
- **Status:** ✅ Already in TOKEN_REGISTRY — skip

---

## General Base Market Context (May 2026)

- Base TVL: ~$12.8B
- Base daily transactions: ~7-10M
- Aerodrome: ~68% of Base DEX volume ($4.2B 30-day), 100% fees to veAERO
- Over 85% of new Base tokens list on Aerodrome first

---

## Next Steps for Henry

1. Check NOCK/USDC on Aerodrome: does it pass liquidity >$100k + vol >$50k + age >3d?
2. Find XCN Base contract address; check Uniswap V3 Base pool quality
3. If both pass: schedule review after 2026-06-15 Option B window closes
4. If either is urgent alpha: open explicit PR to token-registry.ts with full rationale
