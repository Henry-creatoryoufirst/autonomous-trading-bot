# COHORT PROPOSAL — 2026-05-23 (Scout Run #35)

> Filed per CLAUDE.md Rule 1: Option B benchmark window active (~2026-05-15 → ~2026-06-15).
> Auto-adds to TOKEN_REGISTRY are prohibited. Candidates below await Henry's review.

## Scan Summary

- **Scout last ran:** 2026-05-20 19:52:05 EDT (~72h ago — threshold met)
- **APIs available:** WebSearch only (GeckoTerminal API → 403, production API → 403)
- **Data quality:** Limited — no real-time pool liquidity/volume verifiable from sandbox

## Candidates Evaluated

| Token | Liquidity | 24h Volume | Pool Age | Gains | Quality Score | Verdict |
|-------|-----------|------------|----------|-------|---------------|---------|
| MNEME | ~$373K | ~$1.2M | Unknown | +1,339% 6h | — | ❌ REJECT — pump signal |
| Polsia | ~$406K | ~$2.5M | ~3 months | +2,862% 6h | — | ❌ REJECT — pump signal |
| VIRTUAL | Already in registry | — | — | — | — | SKIP |
| CLANKER | Already in registry | — | — | — | — | SKIP |
| DEGEN | Already in registry | — | — | — | — | SKIP |
| BNKR | Already in registry | — | — | — | — | SKIP |
| TOSHI | Already in registry | — | — | — | — | SKIP |
| AERO | Already in registry | — | — | — | — | SKIP |

## Quality Filter Applied

Tokens must pass ALL of:
1. Pool liquidity > $100k USD
2. 24h volume > $50k USD
3. Pool age > 3 days
4. Not already in TOKEN_REGISTRY
5. No extreme short-term price spikes (>200% in 6h = pump/dump disqualifier)

**Result: 0 tokens pass all filters.**

MNEME and Polsia both had 1,000%+ gains in 6 hours, which is a disqualifying pump-and-dump indicator regardless of liquidity/volume metrics.

## Watch List (for Henry's manual review)

The following categories may have qualifying tokens not discoverable from the current sandbox:

1. **Coinbase cbAssets expansion** — Coinbase continues to wrap assets on Base. cbDOGE was added 2026-05-01; check whether cbAVAX, cbMATIC, cbDOT have launched on Base with active Aerodrome pools.

2. **Aerodrome/Velodrome merger token (AERO)** — The planned Q2 2026 merger may create a new unified token. If a new contract is issued, it would be a high-quality candidate (BLUE_CHIP, LOW risk).

3. **Kaito ecosystem follow-ons** — KAITO (already in registry) has grown. Monitor whether ecosystem tokens spin out from its attention economy.

4. **Real-yield DeFi** — Base has growing stablecoin TVL ($3.9B+). Check if protocols like Usual Money, Resolv, or similar yield-focused projects launched native Base tokens with $100K+ pools on Aerodrome.

## Recommendation

No immediate additions. Recommend Henry manually verify the Watch List items above using GeckoTerminal directly (sandbox cannot access the API). Any additions should come via explicit human PR per Rule 1.

---
*Filed by autonomous agent run #35, 2026-05-23. Option B window closes ~2026-06-15.*
