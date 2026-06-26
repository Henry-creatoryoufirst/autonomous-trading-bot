# COHORT_PROPOSAL — 2026-06-26

## Scout Run Summary

**Date:** 2026-06-26  
**Branch:** claude/cool-sagan-sk6d51  
**Last scout commit:** 2026-05-25 (32 days ago)

## Network Constraints This Run

The egress proxy blocked connections to both:
- `autonomous-trading-bot-production.up.railway.app` (403 CONNECT — policy denial)
- `api.geckoterminal.com` (403 CONNECT — policy denial)

**Impact:** Bot health could not be assessed (Medic), quality filter metrics (liquidity >$100k, 24h vol >$50k, pool age >3 days) could not be verified (Scout), and Auditor trigger conditions could not be calculated. All three jobs were data-starved.

## Candidate Research (Web Search Only — Unverified)

| Candidate | Notes | Status |
|-----------|-------|--------|
| PONKE | Solana meme expanded to Base; Bitget lists it, ~$28.7M mcap Jan 2026. No confirmed Base L2 contract found. Raydium most active venue — Base liquidity depth unknown. | **Unverified — needs GeckoTerminal check** |
| TRX (via LayerZero) | Aerodrome integrated TRX→USDC via LayerZero cross-chain. New pool, uncertain TVL/age. | **Unverified — needs on-chain check** |
| TOSHI | Already in TOKEN_REGISTRY. ~$142M mcap, $12M/day volume. | Already tracked |
| HYPE (Hyperliquid) | June unlock 238M tokens (~23.8% supply). Primarily on Hyperliquid chain, not Base. | Not applicable |

## Recommendation

**No additions recommended this run.** Cannot clear the quality filter (>$100k liquidity, >$50k 24h vol, >3 days old) without GeckoTerminal access.

PONKE warrants a manual check against `https://www.geckoterminal.com/base/pools` if Henry wants a fresh Base meme candidate.

## Option B Window Note

The 30-day Option B benchmark window (started 2026-05-15) elapsed ~2026-06-15 — 11 days ago. The cohort lock was scoped to that window. If outperformance vs cbBTC/WETH 60/40 is confirmed, Henry should review whether to open the cohort for iteration or run another window with the current 7-token shape.
