# COHORT PROPOSAL — 2026-06-15 (Option B Window Close)

**Filed by:** NVR Token Scout (automated, scheduled hourly agent)  
**Date:** 2026-06-15  
**Status:** PROPOSAL ONLY — cohort is locked per CLAUDE.md Rule 1. Human PR required to act.  
**Context:** The Option B 30-day benchmark window (~2026-05-15 to ~2026-06-15) closes today.

---

## Note on Data Limitations

GeckoTerminal API (`api.geckoterminal.com`) is blocked by network egress in this execution
environment (persistent since Run #1, documented in MEDIC_REPORT.md). All token quality
metrics (pool liquidity, 24h volume, pool age) in this proposal are derived from WebSearch
results only and **have not been verified against live on-chain data**.

**Henry: Before acting on any proposal below, verify via GeckoTerminal or Basescan directly.**

---

## Ecosystem Context (June 2026)

### Base L2 Health
- Base DEX daily volume: ~$3B+ (all-time record set recently; Aerodrome ~$453M TVL)
- Aerodrome handles 50%+ of Base DEX volume — bot's primary routing is well-positioned
- 2M+ daily transactions on Base (roughly 2× Ethereum mainnet volume)

### Critical Upcoming Event: Aerodrome → "Aero" MetaDEX Migration (July 2026)
- Dromos Labs (Aerodrome + Velodrome devs) are launching a unified "Aero" cross-chain DEX
- AERO + VELO tokens consolidating into a single AERO token (no dilution for AERO holders)
- **Liquidity is migrating to new MEV-resistant pools NOW** (ahead of July launch)
- This affects the bot's primary DEX router (Aerodrome Slipstream)
- **Watch for**: temporary liquidity disruption as LPs migrate; slippage may spike mid-migration
- **Action needed**: monitor AERO pool depths in July; consider pausing TWAP on illiquid windows

### Top Base Ecosystem Tokens (verified already in TOKEN_REGISTRY)
- AERO (DEFI), VIRTUAL (AI_TOKENS), AAVE (DEFI), BRETT (MEME_COINS), SEAM (DEFI)
- cbBTC, WETH, cbXRP, cbLTC, LINK, cbADA, cbSOL (COHORT_QUALITY_7)

---

## Token Proposals

**Note:** With GeckoTerminal blocked, no new tokens can be proposed with verified quality
metrics this scan. The below are ecosystem watchlist items for Henry's next manual review.

### Watchlist (not proposals — need human verification)

| Symbol | Notes | Why Interesting | Required Check |
|--------|-------|-----------------|----------------|
| WELL | Already in registry (DEFI) | Seamless Protocol is top lending market on Base per June 2026 reports | Already tracked ✓ |
| ZORA | Already in registry (AI_TOKENS) | Active on Base | Already tracked ✓ |
| cbDOGE | Already in registry (BLUE_CHIP) | Coinbase-wrapped, established | Already tracked ✓ |
| New Aerodrome "Aero Ignition" tokens | Unknown — check Aerodrome UI | Aerodrome bootstraps new token liquidity | Verify via aerodrome.finance |

### Auto-Discovered (from prior runs, already in TOKEN_REGISTRY)
All known quality tokens from prior scout runs are already in the registry. No new additions
proposed this scan.

---

## Post-Option-B Strategy Notes for Henry

The Option B 30-day window closes today. Key observations from git history:

1. **Full liquidation occurred 2026-05-28** (13 days into the window) — bot has been 100% USDC
   for 18 days. This means the Option B benchmark window has effectively no tradable data for
   the second half of the period.

2. **The COHORT_QUALITY_7 cohort** (cbBTC, WETH, cbXRP, cbLTC, LINK, cbADA, cbSOL) remains
   unchanged since 2026-05-15. cbLTC is in HOLD_ONLY_TOKENS due to thin liquidity.

3. **Bear market adaptations** made by the auditor across Runs #17–#34 are all live in main:
   - KELLY_FRACTION=0.25 (Quarter-Kelly)
   - HOT_MOVER_MIN_BUY_RATIO=0.60 (vs 0.55 pre-bear)
   - HOT_MOVER_MIN_FDV_USD=1M (vs 500K pre-bear)
   - SCOUT_UPGRADE_BUY_RATIO=60 (vs 55 pre-bear)
   - CULL_MIN_AGE_HOURS=72 (vs 168 pre-bear)
   - STALE_POSITION_MIN_AGE_HOURS=36 (vs 48 pre-bear)

4. **Aerodrome July migration** is the most operationally significant near-term event.

---

## Recommendations for Henry's Review

1. **Re-enable trading**: If the Option B period is over, decide whether to restart bot trading
   mode and on which branch/strategy.

2. **Evaluate cohort expansion**: The 7-token quality cohort lock expires today. If NVR wants
   to add tokens for the next window, now is the time for a deliberate human PR.

3. **Monitor Aerodrome migration**: Before July launch of "Aero" MetaDEX, ensure bot handles
   potential pool depth changes gracefully.

4. **Fix network egress**: Add `autonomous-trading-bot-production.up.railway.app` and
   `api.geckoterminal.com` to the scheduled session's egress allowlist so future runs
   can actually assess bot health.

5. **Consider next strategy window**: Whether to continue Option B or pivot to a new
   strategy with an updated cohort is a human decision.
