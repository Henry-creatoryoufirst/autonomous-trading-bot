# NVR Capital — Scout Run 2026-06-10

**Run date:** 2026-06-10  
**Branch:** claude/cool-sagan-gmgc5p  
**Rule compliance:** CLAUDE.md Rule 1 active — Option B window open until ~2026-06-15.
TOKEN_REGISTRY NOT modified. Findings written here per protocol.

---

## Environment Constraints This Run

- Production API (`autonomous-trading-bot-production.up.railway.app`) not accessible from
  this execution environment (network policy blocks outbound to Railway).
- GeckoTerminal API (`api.geckoterminal.com`) also blocked by network policy.
- All market data sourced from web search (CoinGecko category pages, DeFiLlama, news).
- Consequence: cannot apply precise quality filters (liquidity > $100k, 24h vol > $50k,
  pool age > 3 days) from first-principles data. Findings are qualitative, not quantitative.
  **Next run should verify these from a network-unrestricted environment.**

---

## Scout Findings — Candidate Evaluation

### Not Qualifying This Run

| Symbol | Reason for Rejection |
|--------|----------------------|
| HYPE (Hyperliquid) | Native to Hyperliquid L1 chain, not Base. No confirmed Base liquidity pool with depth >$100k. Cross-chain bridge to Base is planned but not yet live as of June 2026. |
| Aero (new unified DEX token) | Aerodrome/Velodrome unified "Aero" MetaDEX03 launch is Q2-Q3 2026. Token not yet trading; speculative. AERO (current) already in registry. |
| BEAT, NEAR, DEXE | Mentioned in June 2026 altcoin watch lists but not Base-native with verified Base pool metrics. Require GeckoTerminal confirmation before consideration. |

**Verdict: No qualifying candidates identified this scan.** Standards maintained — no additions recommended.

---

## Market Context (June 2026)

- **Base ecosystem health**: Strong. Base holds 46.6% of all L2 DeFi TVL, #1 by DeFi TVL.
  7–10M daily transactions. Aave $44.9B deposits on Base; Morpho liquidity doubled.
- **Aerodrome**: $453M TVL, $12.4B 30-day volume, >60% Base DEX share. Migrating to
  MEV-resistant pools ahead of July 2026 unified "Aero" launch.
- **Market regime**: Bear market of ~70+ days visible in NVR's own constants. June 2026 
  remains cautious; recent HYPE token unlock ($700M) and continued macro pressure.

---

## Aerodrome Router Alert — For Henry's Review

**HIGH PRIORITY**: Aerodrome is mandatory-migrating all LPs to MEV-resistant pools with a
**July 2026 deadline**. After the July launch of unified "Aero" (MetaDEX03), old pools stop
earning AERO emissions. This could affect:

1. **Routing**: NVR's Aerodrome Slipstream router (`0xbe6d8f0d05cc4be24d5167a3ef062215be6d18a5`)
   may need updating after the July launch to hit new pool contracts.
2. **Slippage**: As LPs migrate liquidity from old pools to new, remaining old-pool depth
   thins out — NVR may see elevated slippage on tokens in old pools through June.
3. **AERO position**: If NVR holds AERO, the migration may create a tactical trading window
   (AERO reward redistribution to migrated LPs = potential price catalyst).

**Recommended action before July 2026:**
- Verify NVR's Aerodrome router address against Aerodrome's July launch docs.
- Monitor AERO pool liquidity via DeFiLlama for pre-launch depth changes.
- Consider adding Aerodrome July launch as a scheduled trading event in bot context.

This is too complex for automated implementation (> 10 lines, touches execution routing)
and is noted here for Henry to handle directly.

---

## Option B Window Status

- Window closes: ~2026-06-15 (5 days from this run)
- COHORT_QUALITY_7 unchanged: cbBTC, WETH, cbXRP, cbLTC, LINK, cbADA, cbSOL
- No TOKEN_REGISTRY additions made this run
- **Post-window**: Once Option B closes, consider running a fresh scout with unrestricted
  network access to GeckoTerminal API for a proper quality-filtered scan.

---

## Auditor Notes (supplemental — trigger conditions unverifiable)

Production API inaccessible; could not calculate win_rate, drawdown, or losing_streak.
However, from code/git context:

- The `feat(admin): /api/admin/liquidate-all` commit on 2026-05-28 (forced full-exit to USDC)
  indicates a strategic or risk-driven full liquidation event 13 days ago. Bot has been
  rebuilding since.
- NVR constants show extensive bear-market adjustments (KELLY_FRACTION 0.30→0.25,
  HOT_MOVER_MIN_POOL_AGE_HOURS 24→48, SCOUT_UPGRADE_BUY_RATIO 55→60, etc.)
  consistent with a 65–70 day bear regime.
- No code changes recommended this run. Research findings:

| Area | Finding | Impact | Complexity | Priority | Action |
|------|---------|--------|------------|----------|--------|
| Signal Quality | NVR swarm (flow 35%, momentum 20%) already aligns with 2026 research best-practice | 2 | 1 | 2.0 | None — already implemented |
| Execution | Aerodrome V2 new routing, MEV-resistant pools (July 2026) | 4 | 4 | 1.0 | Watch list — see above |
| Position Sizing | Hybrid Kelly+vol-regime scaling (NVR uses Quarter-Kelly + VAPS already) | 3 | 2 | 1.5 | Below 2.0 threshold |
| Competitive | Intent-based swaps (UniswapX-style gasless MEV protection) | 4 | 5 | 0.8 | Long-term roadmap only |

No finding clears the Priority ≥ 2.0 + Risk low/medium + ≤10 lines bar for auto-implementation.

---

*Agent run complete. Henry: review staging → no changes to deploy this cycle.*
