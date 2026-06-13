# COHORT PROPOSAL — 2026-06-13

**Filed by:** NVR autonomous agent Run #35 (scout job)
**Status:** PROPOSAL ONLY — no TOKEN_REGISTRY changes made (Option B window active through ~2026-06-15)
**For Henry to review:** After the 30-day Option B window closes

## Context

Scout ran today (2026-06-13) after a 29-day gap since last scout activity. The Option B window is in its final ~2 days. Per CLAUDE.md Rule 1, TOKEN_REGISTRY is locked. All candidates discovered this run are documented here for post-window review.

## Network Restrictions

This run operated in WebSearch-only mode. GeckoTerminal API, the bot's Railway production API, and all other external APIs returned 403 from the Anthropic egress gateway. Pool metrics (liquidity, volume, age) could only be obtained via aggregated WebSearch results — individual token verification was not possible.

## Candidates Evaluated

| Symbol | Pool Pair | Liquidity | 24h Volume | Verdict | Notes |
|--------|-----------|-----------|------------|---------|-------|
| VEIL | VEIL/WETH (Aerodrome) | ~$1.05M | ~$24K | ❌ REJECT | Volume below $50K threshold. Previously auto-discovered (2026-05-16) and reverted per Rule 1 — same low-volume problem. |
| OETHb | OETHb/WETH (Aerodrome SlipStream) | ~$6.4M | ~$24K | ❌ REJECT | Staked ETH derivative (OETH Base = yield-bearing wrapper). Not a trading token candidate — no price discovery alpha, just ETH carry. |
| AERO | AERO/USDC (Aerodrome) | $26.7M | $2.03M | ❌ ALREADY IN | Already in TOKEN_REGISTRY. |

## Post-Window Recommendation

No tokens from this scan are ready for TOKEN_REGISTRY addition. The candidates either:
1. Fail volume threshold (VEIL — only $24K/day vs. $50K minimum)
2. Are structurally inappropriate (OETHb — yield-bearing ETH derivative)
3. Are already tracked (AERO)

**Next steps (for Henry, post-June 15):**
- Re-run scout with direct GeckoTerminal API access (from a less-restricted environment) to get fresh trending/new pool data
- The Option B 30-day window closes ~June 15 — after that, the cohort can be evaluated for expansion if the benchmark was met
- Consider whether cbXRP, cbLTC, cbADA, cbSOL have meaningful enough Aerodrome liquidity for COHORT_QUALITY_7 trading — HOLD_ONLY_TOKENS flag (currently cbLTC) may need revisiting

## Aerodrome MEV-Resistant Pool Migration Note

Aerodrome launched MEV-resistant pool migration in May 2026, ahead of the July 2026 cross-chain Aero DEX launch (Aerodrome + Velodrome merger). Liquidity providers must migrate to new pools to remain eligible for emissions. The bot's current SlipStream router (`0xbe6d8f0d05cc4be24d5167a3ef062215be6d18a5`) should auto-route to highest-liquidity pools. **Henry should verify in July 2026 whether the router address changes with the cross-chain Aero launch.**
