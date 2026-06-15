# NVR Capital — Cohort & Strategy Proposals for Henry's Review
## 2026-06-15 (Option B Window Close)

This file was written by the automated agent on the approximate close of the 30-day Option B benchmark window. Per CLAUDE.md Rule 1, no changes have been made to TOKEN_REGISTRY or COHORT_QUALITY_7. All items below require Henry's explicit review and human-PR merge.

---

## SCOUT CANDIDATES (2026-06-15 scan)

Last successful scout commit: ~2026-05-08 (SYRUP). Scout ran analysis this cycle (~30 days elapsed). GeckoTerminal API and bot API are blocked in the execution sandbox; data sourced from WebSearch/DexScreener results.

| Token | Symbol | 24h Vol | Liquidity | Pool Age | Notes | Scout Verdict |
|-------|--------|---------|-----------|----------|-------|---------------|
| Velvet Capital | VELVET | ~$7M | ~$2.8M (Aerodrome) | Unknown | -77.9% crash in 24h on 2026-06-15. Market cap $203M. AI DeFi platform. Contract: `0x8b194370825e37b33373e74a41009161808c1488`. | ❌ REJECT — catastrophic 24h crash is disqualifying. May revisit post-stabilization. |
| CTR | CTR | ~$5.8M | ~$571K | Unknown | Insufficient data — address and pool age unconfirmed. | ❌ INSUFFICIENT DATA — cannot verify quality filter. |

**Scout conclusion:** No qualifying tokens confirmed this scan. Standards maintained. Recommend Henry verify VELVET post-crash stabilization for potential future add if recovery is genuine.

---

## AUDITOR FINDINGS (2026-06-15 — NOT IMPLEMENTED)

Per CLAUDE.md Rule 1: making automated strategy changes on the Option B window close date would muddy alpha attribution. All findings below are for Henry's post-window decision.

### Finding 1 — KELLY_FRACTION Recovery on Regime Shift (HIGH PRIORITY)
**Trigger:** Bear-adjusted calibrations in place since Run #23 (2026-05-02): KELLY_FRACTION=0.25, KELLY_POSITION_CEILING_PCT=12, KELLY_ROLLING_WINDOW=30. BTC is ~$70-75K post-peak ($126K Oct 2025), with recovery expected H2 2026.

**Proposed change (for Henry to evaluate):** When bot's internal win_rate sustained ≥0.50 over 20+ trades AND marketRegime returns to BULL/NEUTRAL for 48h+, consider: `KELLY_FRACTION: 0.25 → 0.30` (first step of decompression back toward Half-Kelly)

**Research source:** Atlas Peak Research 2026 Kelly framework — "re-underwrite when volatility regime changes." See: https://www.atlaspeakresearch.com/report/07bf72

**Impact:** 3/5 | **Complexity:** 1/5 | **Risk:** Low | **Priority:** 3.0

---

### Finding 2 — TWAP Jitter Increase vs AI-on-AI MEV (MEDIUM PRIORITY)
**Finding:** Autonomous bots now pattern-detect 15-minute cycle timing to front-run other bots (cryptollia.com AI-on-AI MEV dark forest 2026). NVR's 15-min cycle + current TWAP jitter may be identifiable. Increasing jitter 20% → 25-30% or adding random ±2-4 min cycle offset would reduce predictability.

**Proposed change (for Henry to evaluate):** Increase TWAP slice variance from current 20% to 30%, or add `CYCLE_JITTER_SECONDS = ±120` to the main cycle timer.

**Research source:** https://cryptollia.com/articles/quantum-predators-ai-on-ai-mev-autonomous-market-warfare-2026

**Impact:** 3/5 | **Complexity:** 2/5 | **Risk:** Low | **Priority:** 1.5 | **Max 3 lines**

---

### Finding 3 — Funding Rate Signal (WATCH LIST)
**Finding:** DeFi bots in 2026 use funding rates + OI divergence as standalone buy/sell signals (rising OI with flat price = squeeze risk, precedes reversals). NVR uses Fear & Greed but not derivatives funding rates.

**Complexity:** Requires new data source (Binance/Deribit funding rate API). Medium complexity. Impact 2/Complexity 3 → Priority 0.67. **Not recommended for auto-implementation.** Worth Henry evaluating for a v22.x feature.

---

## POST-WINDOW RECOMMENDATION FOR HENRY

The Option B benchmark window runs 2026-05-15 to ~2026-06-15 (today). To evaluate:

1. **Check bot performance:** `https://autonomous-trading-bot-production.up.railway.app/api/portfolio` — compare against cbBTC/WETH 60/40 benchmark over the 30-day window.
2. **Decide on cohort expansion:** Option B cohort lock lifts. If cbBTC/WETH tracking is achieved with 7-token quality cohort, consider expanding with VELVET (post-stabilization), cbSOL (already in TOKEN_REGISTRY), and other high-quality Base-native tokens.
3. **Strategy decompression:** If win_rate is healthy and market is recovering, implement KELLY_FRACTION 0.25→0.30 as first step.
4. **Fix the egress allowlist:** This is Run #35 with the same API 403 issue. The automated agent cannot perform medic duties without API access. Add `autonomous-trading-bot-production.up.railway.app` and `api.geckoterminal.com` to Claude Code's network egress allowlist.

**PR workflow:** All of the above should be human PRs to `staging` → verified → merged to `main` per CLAUDE.md Rule 2.
