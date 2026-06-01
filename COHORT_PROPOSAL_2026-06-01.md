# COHORT PROPOSAL — 2026-06-01

**Status: Research Only — No Additions (Option B Window Active)**

## Why No Additions This Run

CLAUDE.md Rule 1 is in effect: the Option B benchmark window runs until ~2026-06-15. The
cohort (COHORT_QUALITY_7 + TOKEN_REGISTRY) is locked for automated changes. Three previous
auto-adds (MOLT 2026-05-14, OPENX 2026-05-16, VEIL 2026-05-16) were all reverted by humans.
This proposal documents research findings for Henry's review post-window.

Additionally, the GeckoTerminal API (`api.geckoterminal.com`) is returning 403 from this
execution environment, so on-chain pool data (liquidity, volume, pool age) cannot be
verified in this run. Any token added without GeckoTerminal confirmation would violate
the quality filter standards.

## Scout Cadence

- Last non-reverted scout commit: 2026-05-08 (SYRUP added, Run #33)
- Days since last qualifying addition: 24 days
- 48h threshold for scout: ✅ EXCEEDED (scout "should" run)
- CLAUDE.md Rule 1 override: ✅ PROHIBITS TOKEN_REGISTRY commit until ~2026-06-15

## Research Conducted

### Web Search Findings (2026-06-01)

**No specific new qualifying tokens surfaced** with verified on-chain data meeting all filters:
- Pool liquidity > $100k USD ✓ (unverifiable — GeckoTerminal blocked)
- 24h volume > $50k USD ✓ (unverifiable)
- Pool age > 3 days ✓ (unverifiable)
- Not already in TOKEN_REGISTRY ✓ (registry is comprehensive)

### Ecosystem Events to Monitor Post-Window

1. **Aerodrome "Aero" cross-chain DEX** — Velodrome+Aerodrome merger launching July 2026.
   New cross-chain concentrated liquidity pools will create new token liquidity venues.
   Re-run scout after July 2026 launch to evaluate new high-liquidity pools.

2. **Base native token** — Jesse Pollak confirmed exploration in Sep 2025; Polymarket odds
   23% by June 30, 69% by Dec 31. No contract address yet. If launched, evaluate as
   BLUE_CHIP candidate with likely strong liquidity at launch.

3. **Polymer (POLYM)** — Strategic investor unlock June 20, 2026 (~4.5% supply, ~45M tokens).
   Unlock pressure may create a buy-the-dip opportunity if POLYM has Base L2 liquidity.
   Verify after unlock with GeckoTerminal before adding.

4. **Slipstream V3 new pools** — Aerodrome's Nov 2025 "Aero" upgrade introduced V3
   concentrated liquidity with embedded MEV auctions. New tokens launching V3 pools may
   have better liquidity profiles than V2. Evaluate post-July 2026 Aero full launch.

## Quality Standards Reminder

For reference when running post-window:
- Liquidity floor: > $100k USD
- Volume floor: > $50k USD/24h
- Pool age: > 3 days
- Score threshold: 6/10 minimum
- Risk levels: HIGH for memes, MEDIUM for mid-caps, LOW for established
- minTradeUSD: 10 for memes, 25 for mid-caps, 50 for established
- Note HOLD_ONLY_TOKENS_DEFAULT if liquidity is thin (see cbLTC precedent)

## Recommendation

Re-run full scout after Option B window closes (~2026-06-15) with:
1. GeckoTerminal access confirmed (add to egress allowlist per MEDIC_REPORT recommendation)
2. Fresh trending pools query: `GET /api/v2/networks/base/trending_pools?page=1`
3. Fresh new pools query: `GET /api/v2/networks/base/new_pools?page=1`
4. Consider Aerodrome "Aero" V3 pools specifically as they have embedded MEV protection

## Files Modified This Run
- MEDIC_REPORT.md — updated with Run #35 status
- COHORT_PROPOSAL_2026-06-01.md — this file (new)

No changes to TOKEN_REGISTRY, agent-v3.2.ts, or constants.ts.
