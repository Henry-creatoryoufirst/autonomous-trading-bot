# Cohort Proposal — 2026-06-01 Scout Run

**Status:** No additions recommended. Cohort locked per Option B Rule 1 (~2026-06-15).

## Scout Run Context

- **Date:** 2026-06-01
- **Days since last scout:** 18 days (MOLT added 2026-05-14)
- **GeckoTerminal status:** 403 Forbidden — blocked by Claude Code egress allowlist
- **Research method:** WebSearch only (GeckoTerminal/DexScreener inaccessible)

## What Was Found

WebSearch for "new tokens Base L2 high volume trending June 2026 DeFi" returned general
ecosystem information. No new tokens with verifiable on-chain addresses and quality metrics
(liquidity >$100K, 24h volume >$50K, pool age >3 days) were identified.

Tokens mentioned in search results already in TOKEN_REGISTRY:
- AERO (Aerodrome Finance) ✅ already in registry
- VIRTUAL (Virtuals Protocol) ✅ already in registry
- AIXBT ✅ already in registry
- LUNA (Luna by Virtuals) ✅ already in registry

No net-new candidates emerged with verified contract addresses.

## Option B Lock Notice

Even if quality candidates were identified, CLAUDE.md Rule 1 prohibits adding to
`TOKEN_REGISTRY` or `COHORT_QUALITY_7` during the Option B benchmark window
(2026-05-15 → ~2026-06-15). Any future candidates should be queued here for
Henry to review after the window closes.

## Candidates on Watch List

None identified in this run. GeckoTerminal access is required for proper address
verification and quality metric validation. Enable egress allowlist for
`api.geckoterminal.com` to unlock full scout capability.

## Action Required (Henry)

1. If you want the scout to run properly: add `api.geckoterminal.com` to the Claude
   Code egress allowlist in your remote session configuration.
2. After Option B window closes (~2026-06-15): review cohort for Tier 2 rotation
   (cbXRP, cbLTC, LINK, cbADA, cbSOL performance vs. benchmark).
3. Consider: cbDOGE performance vs. cbBTC/WETH benchmark as potential Tier 2 swap.
