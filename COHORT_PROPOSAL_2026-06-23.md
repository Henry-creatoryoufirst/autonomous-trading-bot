# COHORT PROPOSAL — 2026-06-23

**Submitted by:** NVR Medic/Scout automated agent (Run #35)
**Status:** PROPOSAL ONLY — requires human PR per CLAUDE.md Rule 1
**Option B window:** Closed ~2026-06-15 (30 days from 2026-05-15 pivot)

---

## Scout Run Summary

This is the first scout since Run #34 (2026-05-15, ~39 days ago). GeckoTerminal API returned 403 (blocked alongside Railway). Used WebSearch for discovery.

**Tokens already in TOKEN_REGISTRY (excluded from consideration):**
VIRTUAL, AIXBT, BRETT, AERO, DEGEN, MORPHO, AAVE, CRV, ENA, ETHFI, PENDLE, RSR, ZRO, AXL, VVV, WIRE, GAME, ZORA, BNKR, WELL, AVNT, SEAM, HYDX, MEZO, RIVER, SKI, BENJI, TIG, MOG, TYBG, B3, RNBW, SPECTRA, KAITO, cbSOL, UP, SYRUP, MOLT + all blue-chip cohort tokens.

---

## Candidate Evaluation

| Symbol | Name | Est. Liquidity | Est. 24h Vol | Pool Age | Quality Score | Action |
|--------|------|---------------|--------------|----------|--------------|--------|
| VIRTUAL | Virtuals Protocol | $9.84M (WETH pool) | $156.9M | 18+ months | N/A — ALREADY IN REGISTRY (CDP_UNSUPPORTED) | Skip |
| AERO | Aerodrome Finance | Very high | Very high | 2+ years | N/A — ALREADY IN REGISTRY | Skip |
| B20 tokens | Various (Beryl standard) | Unknown — TOO NEW | Unknown | 0-2 days | FAIL: pool age < 3 days | Watch |

### No new qualifying tokens found

Web search could not surface specific new Base pools with verifiable:
- Pool liquidity > $100k USD ✓
- 24h volume > $50k USD ✓
- Pool age > 3 days ✓
- Not already in TOKEN_REGISTRY ✓

The TOKEN_REGISTRY is already very comprehensive for the Base ecosystem.

---

## Watch List for Human Review

### 1. Base B20 Tokens (post-Beryl, June 25, 2026)

The Base Beryl upgrade activated June 25, 2026, introducing the B20 native token standard targeting stablecoin issuers and RWA/equity issuers. B20 tokens run as chain-native precompiles (cheaper, faster) with ERC-20 selector parity.

- **Recommendation:** Scout again in 7-14 days once B20 token pools have aged past the 3-day quality gate
- **Why it matters:** Could be a source of high-quality stablecoin or RWA tokens that fit the RWAs (5%) sleeve
- **Risk:** Very new; no track record yet

### 2. AERO (Aerodrome Finance) — Upgrade Catalyst

Already in registry, but surfaced a notable catalyst:
- Price +30% mid-June 2026 (above 200-day MA)
- "Predictive Allocation" system launching July 2026 (replaces weekly gauge voting, rewards AI agents for accurate forecasting)
- Vol surge +80%+ recently

**This is NOT a new token candidate** — it's an intelligence note for the trading bot's weighting decisions.

### 3. Virtuals Protocol (VIRTUAL) — CDP Unblock Candidate

VIRTUAL is in the registry but blocked in `CDP_UNSUPPORTED_TOKENS`. With $9.84M WETH pool liquidity and $156.9M/day volume (+228% recent surge), this is the highest-volume Base-native token NVR is NOT trading.

**Proposal:** Remove VIRTUAL from CDP_UNSUPPORTED_TOKENS and configure it for DEX-only execution via AERODROME path (same as MORPHO/cbLTC in DEX_SWAP_TOKENS). This is not a cohort change — it's enabling an already-registered token.
- Impact: High (massive volume = alpha opportunities)
- Complexity: Low (add to DEX_SWAP_TOKENS, keep out of CDP path)
- Risk: Medium (CDP doesn't support it for a reason — verify DEX path first)

---

## Recommendation

1. **Immediate:** Schedule scout again in 7-14 days for B20 token pipeline
2. **For human PR consideration:** Enable VIRTUAL via DEX path only (not a cohort change — just unlock the trading path)
3. **No new tokens to add** to TOKEN_REGISTRY or COHORT_QUALITY_7 from this scan

---

*Note: NVR-HQ vault not present in this repo checkout — proposal filed in repo root per fallback.*
*Per CLAUDE.md Rule 1: No changes made to token-registry.ts. This file is informational only.*
