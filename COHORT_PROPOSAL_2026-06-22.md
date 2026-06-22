# COHORT PROPOSAL — 2026-06-22

## Context

The 30-day Option B benchmark window (2026-05-15 → ~2026-06-15) has ended.
Per CLAUDE.md Rule 1: cohort changes post-window still require **explicit human PR only** — no auto-adds.
This file replaces what would have been a `feat(scout): add` commit in previous eras.

## Scout Run Status

- **Last successful scout commit**: MOLT added 2026-05-14 (39 days ago — well past 48h threshold)
- **GeckoTerminal API**: 403 Forbidden from this execution environment (persistent env block, see MEDIC_REPORT.md)
- **Specific pool data**: Could not be fetched to evaluate liquidity / volume / pool age
- **WebSearch results**: General Base L2 ecosystem context only — no pool-level data for scoring

## What Was Found (WebSearch)

Base chain TVL ~$2B+ in June 2026. Key protocols:
- **Aerodrome Finance (AERO)**: Already in COHORT_QUALITY_7 indirectly (primary DEX). Aerodrome/Velodrome merging to "Aero" unified Superchain liquidity layer — bullish for AERO token.
- **Moonwell (WELL)**: Already in TOKEN_REGISTRY. Prominent lending protocol on Base.
- **Avantis (AVNT)**: Already in TOKEN_REGISTRY. On-chain perps DEX on Base.
- No new Base-native tokens identified with verifiable pool data from WebSearch alone.

## COHORT_QUALITY_7 Current State (unchanged since May 2026 Option B pivot)

| Symbol | Address | Sector | Status |
|--------|---------|--------|--------|
| cbBTC  | 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf | BLUE_CHIP | Tier 1 always-on |
| WETH   | 0x4200000000000000000000000000000000000006 | BLUE_CHIP | Tier 1 always-on |
| cbXRP  | 0xcb585250f852C6c6bf90434AB21A00f02833a4af | BLUE_CHIP | Tier 2 rotational |
| cbLTC  | 0xcb17C9Db87B595717C857a08468793f5bAb6445F | BLUE_CHIP | Tier 2 — HOLD_ONLY (thin liq) |
| LINK   | 0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196 | BLUE_CHIP | Tier 2 rotational |
| cbADA  | 0xcbada732173e39521cdbe8bf59a6dc85a9fc7b8c | BLUE_CHIP | Tier 2 rotational |
| cbSOL  | 0x2f280d1b1c738d71a6e7adeb1a84c8f2f114594c | BLUE_CHIP | Tier 2 rotational |

## Recommendation for Henry

1. **Evaluate on GeckoTerminal directly**: https://www.geckoterminal.com/base/pools — filter for pools >$100K liquidity, >$50K 24h volume, pool age >3 days, not already in TOKEN_REGISTRY.

2. **Strong candidates to investigate (based on general research)**:
   - Any new Coinbase-wrapped assets (cb* family) that match cbBTC/WETH/cbSOL quality profile
   - cbDOT, cbATOM, or other Coinbase institutional wraps if launched on Base
   - Blue-chip bridged assets (similar to cbXRP profile) with Aerodrome pool liquidity

3. **Market context**: Bear regime (F&G extreme fear, BTC ~$75K). New cohort additions should clear a higher quality bar than usual. The current 7-token cohort is well-calibrated for Option B thesis.

4. **To add a token**: Open an explicit human PR targeting `staging` branch with the TOKEN_REGISTRY entry + COHORT_QUALITY_7 addition, citing pool data and quality score.

## Action Taken This Run

No TOKEN_REGISTRY changes. This proposal file is the output.
