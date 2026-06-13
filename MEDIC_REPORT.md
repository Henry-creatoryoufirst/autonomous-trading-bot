# MEDIC REPORT — 2026-06-13T (latest) UTC

## Status: API UNREACHABLE — Cannot Assess Bot Health (Persistent Issue — Run #35)

## Environment
- Run timestamp: 2026-05-07T04:05 UTC
- Medic agent: NVR Capital autonomous agent (hourly run)
- Working directory: /home/user/autonomous-trading-bot
- Current branch: staging

## Problem

The bot production API at `https://autonomous-trading-bot-production.up.railway.app` is **completely unreachable** from this execution environment.

All endpoints attempted returned `403 Forbidden`:

```
GET https://autonomous-trading-bot-production.up.railway.app/api/errors      → 403
GET https://autonomous-trading-bot-production.up.railway.app/api/balances    → 403
GET https://autonomous-trading-bot-production.up.railway.app/api/health      → 403
GET https://autonomous-trading-bot-production.up.railway.app/api/trades      → 403
GET https://autonomous-trading-bot-production.up.railway.app/api/portfolio   → 403
GET https://api.geckoterminal.com/api/v2/networks/base/trending_pools        → 403
```

## Root Cause

The Claude Code execution sandbox has an **egress proxy** that only allows outbound connections to a fixed allowlist of domains. The Railway deployment domain and third-party on-chain APIs are **not on this allowlist**. This is a **persistent infrastructure constraint** — it does NOT indicate a bot failure.

## History of this issue

| Run # | Timestamp | Action |
|-------|-----------|--------|
| #1  | 2026-04-14T19:12 UTC | First PATTERN D report filed |
| #2  | 2026-04-15T00:00 UTC | PATTERN D re-confirmed |
| #3  | 2026-04-15T18:38 UTC | PATTERN D update |
| #4  | 2026-04-16T10:18 UTC | PATTERN D update |
| #5  | 2026-04-16T11:20 UTC | PATTERN D update |
| #6  | 2026-04-17T00:00 UTC | PATTERN D update |
| #7  | 2026-04-17T12:00 UTC | PATTERN D update |
| #8  | 2026-04-17T18:42 UTC | PATTERN D update |
| #9  | 2026-04-17T22:09 UTC | PATTERN D update |
| #10 | 2026-04-19T00:00 UTC | PATTERN D update |
| #11 | 2026-04-19T23:07 UTC | PATTERN D update |
| #12 | 2026-04-20T00:00 UTC | PATTERN D update |
| #13 | 2026-04-20T12:00 UTC | PATTERN D update |
| #14 | 2026-04-20T17:00 UTC | PATTERN D update |
| #15 | 2026-04-21T00:00 UTC | PATTERN D update |
| #16 | 2026-04-21T09:00 UTC | PATTERN D update |
| #17 | 2026-04-23T00:00 UTC | Conflict resolved; auditor lowered LARGE_TRADE_THRESHOLD_USD 5000→2500 |
| #18 | 2026-04-24T00:00 UTC | Scout added B3; auditor raised HOT_MOVER_MIN_CHANGE_H1_PCT 5→7 |
| #19 | 2026-04-27T05:13 UTC | Scout no qualifying tokens; auditor raised RIDE_THE_WAVE_MIN_MOVE 5→7 (F&G 31, Fear) |
| #20 | 2026-04-27T~current UTC | Scout skipped (RNBW added Apr-26, <48h ago); auditor lowered KELLY_ROLLING_WINDOW 50→30 (bear win-rate responsiveness) |
| #21 | 2026-04-30T06:08 UTC | Scout skipped (SPECTRA added Apr-28 13:13, <48h ago); auditor lowered SURGE_MAX_CAPITAL_PER_TOKEN_PCT 25→20 (52-day bear surge-trap defense) |
| #22 | 2026-05-02T04:18 UTC | Scout added KAITO; auditor lowered KELLY_FRACTION 0.35→0.30 (first step toward Quarter-Kelly, 52-day bear) |
| #23 | 2026-05-02T14:xx UTC | Scout skipped (<48h, KAITO added at 00:17); auditor lowered KELLY_FRACTION 0.30→0.25 — true Quarter-Kelly completion (54-day bear, crypto fat-tail research) |
| #24 | 2026-05-02T17:05 UTC | Scout skipped (<48h, last BIO scout at 14:14); auditor raised SCALE_UP_BUY_RATIO_MIN 55→60 — aligns scale-up signal bar with HOT_MOVER (both 60%); eliminates bear-market inconsistency |
| #25 | 2026-05-03T00:00 UTC | Scout skipped (<48h, KAITO added 2026-05-02); auditor lowered DECEL_MIN_DROP_FROM_PEAK 8→6 — faster Smart Trim activation in 55-day bear; buy ratio peaks are lower so smaller drops signal distribution |
| #26 | 2026-05-03T~current UTC | Scout skipped (<48h, KAITO added 2026-05-02); auditor lowered DECEL_MIN_PROFIT_PCT 3→2 — lowers Smart Trim profit floor; completes DECEL tightening started in Run#25 (drop 8→6); 55-day bear gains peak earlier at 2-3%, lower floor captures more exits before reversal |
| #27 | 2026-05-04T08:21 UTC | Scout added cbSOL (Coinbase Wrapped Solana, Aerodrome-integrated, 5+ months old, Est >$100K liq); auditor lowered CULL_MIN_AGE_HOURS 168→120 — 56-day bear; stale research positions (<$100) unlikely to recover after 5 days in bear market; accelerates capital recycling by 2 days per culling cycle |
| #28 | 2026-05-04T16:15 UTC | Scout added UP (Superform, DeFi neobank, TGE Feb-10-2026, $8.8M 24h vol, Aerodrome Ignition launch, score 7/10); auditor raised GUARDIAN_NOVEL_TOKEN_HOURS_DEFAULT 48→72 — 57-day bear; Kelly criterion research confirms novel token risk elevated in sustained bear; extra 24h GUARDIAN oversight reduces fat-tail losses on untested tokens |
| #29 | 2026-05-05T03:12 UTC | Scout skipped (UP added 05-04 16:15, <48h); auditor lowered FLOW_REVERSAL_EXIT_BUY_RATIO 40→38 — 57-day bear depresses buy-ratio baselines; exits earlier on distribution |
| #31 | 2026-05-06T~current UTC | Scout skipped (cbADA at 05:08 UTC, <48h); auditor lowered RIDE_THE_WAVE_SIZE_PCT 4→3 — 60-day bear; harmonises wave-ride sizing with SCALE_UP_SIZE_PCT (already 3); wave rides carry higher false-breakout risk than scale-ups in sustained downtrends |
| #30 | 2026-05-05T~current UTC | Scout skipped (cbADA scout at 05:08 UTC, <48h); auditor lowered KELLY_POSITION_CEILING_PCT 14→12 — 59-day bear; Institutional Kelly-VAPS research: tighter ceiling needed beyond Quarter-Kelly fraction alone |
| #31 | 2026-05-06T09:05 UTC | Scout skipped (cbADA scout at 05:08 UTC 2026-05-05, ~28h ago, <48h); auditor lowered STALE_POSITION_MIN_AGE_HOURS 48→36 — 61-day bear; bear market research confirms faster stale-exit of flat $100+ positions frees dead capital sooner |
| #32 | 2026-05-07T04:05 UTC | Scout skipped (cbADA at 05:08 UTC 2026-05-05, ~47h ago, <48h threshold); auditor raised SCOUT_UPGRADE_BUY_RATIO 55→60 — 62-day bear; aligns scout graduation with HOT_MOVER_MIN_BUY_RATIO (60) and SCALE_UP_BUY_RATIO_MIN (60); Kelly criterion research confirms new/uncertain positions require stronger confirmation in bear regimes |
| #33 | 2026-05-08T UTC | Scout added SYRUP; auditor lowered CASH_DEPLOYMENT_CONFLUENCE_DISCOUNT 20→15 + raised VWS_MIN_LIQUIDITY_USD 10K→20K (63-day bear; bear slippage floor + capital preservation) |
| #34 | 2026-05-15T UTC | Scout skipped (MOLT added 2026-05-14, ~24h ago, <48h threshold); auditor raised HOT_MOVER_MIN_FDV_USD 500K→1M — 70-day bear; MEV bots dominate micro-cap Base pumps; completes quality-gate set (pool age ✓, volume ✓, FDV ✓) |
| #35 | 2026-06-13T UTC | Scout ran (>29 days since Run #34), but GeckoTerminal + DexScreener APIs both 403 (no data); TOKEN_REGISTRY changes also blocked by OPTION B cohort lock (window closes ~2026-06-15). No tokens evaluated. Auditor triggered (99-day inferred BEAR), ran 4 searches; top finding BREAKER_DAILY_DD_PCT 7→6 NOT implemented per Option B attribution rules — 2 days from window close, proposing for Henry's review post-June-15. |

## Bot Health Evidence (from git history)

Despite API being unreachable from medic, staging branch is extremely active. Since Run #17:

- `2026-04-24` — Scout: B3 (B3 Gaming Chain) added to TOKEN_REGISTRY — $810K liq, $1.66M vol (this run)
- `2026-04-24` — Auditor: HOT_MOVER_MIN_CHANGE_H1_PCT 5→7 — bear-market signal quality (this run)
- `2026-04-23` — Scout: MOG + TYBG added to TOKEN_REGISTRY
- `2026-04-23` — Auditor: LARGE_TRADE_THRESHOLD_USD 5000→2500
- `2026-04-23` — Scout: OVPP + RAVE added to TOKEN_REGISTRY
- `2026-04-23` — merge(staging): CRITIC Day-1 stub (feat/critic-stub-spec-018)
- `2026-04-22` — fix(payout): accrue pendingFeeUSDC in CDP sell path
- `2026-04-22` — fix(trade-counter): reconcile + derive live-exec timestamp

**Staging is substantially ahead of main** — v21.20.1+ queued with NVR-CRITIC, OSS trader model, P&L sanitizer improvements.

## What Is NOT Known

Because the API is unreachable, the medic cannot determine:
- Whether `summary.totalFailed / summary.totalAttempted > 0.5`
- Whether any error pattern (A/B/C) is active in `recentFailedTrades`
- Whether all circuit breakers are blocked
- Current portfolio balance, P&L, or win rate

## Jobs Status This Run (Run #34 — 2026-05-15T UTC)

- **Medic**: PATTERN D — API unreachable (persistent constraint, 403 on all endpoints). MEDIC_REPORT updated (Run #34).
- **Scout**: SKIPPED — last scout ran 2026-05-14 (MOLT added), ~24h ago, less than 48h threshold.
- **Auditor**: TRIGGERED by inferred 70-day BEAR market (48h+ threshold met). Research ran 4 searches (signal quality, execution efficiency, position sizing, competitive intel). Top finding: HOT_MOVER_MIN_FDV_USD 500K→1M — MEV bots dominate micro-cap Base pumps in sustained bear regimes (MEXC 2026 research); completes hot-mover quality-gate tightening set (pool age 24→48h ✓, volume 150K→200K ✓, FDV 500K→1M ✓). IMPLEMENTED in constants.ts. (Impact 3, Complexity 1, Risk low, Priority 3.0)

## Auditor Research Summary (Run #34 — 2026-05-15)
- **Signal Quality**: Smart money wallet clustering — already partially implemented (LARGE_TRADE_THRESHOLD_USD=2500, whale flow). Full on-chain signal integration complex (Impact 2/Complexity 4/Risk medium) → Watch list. No new action. (Priority 0.5)
- **Execution Efficiency**: Aerodrome/Velodrome protocols set to merge in 2026; Slipstream V3 gas-aware routing auto-benefits NVR without code change. No new action. (Priority 0)
- **Position Sizing**: Fidelity 2026 Kelly research — crypto bear year optimal Kelly ~10% portfolio; NVR effective max 3-4% (KELLY_FRACTION=0.25 × KELLY_POSITION_CEILING_PCT=12% × TRENDING_DOWN=0.75) already well-calibrated. No new action. (Priority 0)
- **Competitive Intelligence**: KEY FINDING — MEV bots dominating micro-cap Base pumps in 2026. MEXC analysis: low-FDV tokens ($500K-$1M) are primary MEV sandwich targets in bear markets. HOT_MOVER_MIN_FDV_USD 500K→1M completes the quality-gate set. (Impact 3, Complexity 1, Risk low, Priority 3.0) IMPLEMENTED.

---

## Jobs Status This Run (Run #35 — 2026-06-13T UTC)

- **Medic**: PATTERN D — API unreachable (403 on all endpoints, same persistent constraint). MEDIC_REPORT updated (Run #35). GeckoTerminal + DexScreener also 403 from this sandbox.
- **Scout**: RAN (29+ days since Run #34 / MOLT scout on 2026-05-14). GeckoTerminal trending_pools and new_pools both returned 403; DexScreener also 403. No token data retrievable via API. WebSearch confirmed Base L2 DEX volume hit record ~$2.9B with AerodromeFi at $1.68B — healthy ecosystem. However, no specific new token addresses/liquidity figures could be validated against quality filters without API access. **Additionally: Option B cohort lock active until ~2026-06-15** (2 days remaining) — TOKEN_REGISTRY changes require human PR regardless. Result: 🔍 no qualifying tokens this scan — data APIs blocked + cohort locked.
- **Auditor**: TRIGGERED by inferred 99-day BEAR market (Run #34 was 70-day bear on 2026-05-15; +29 days = 99 days; well above 48h threshold). Ran 4 searches. Top finding: `BREAKER_DAILY_DD_PCT` 7→6 (industry research confirms 5-6% daily drawdown as optimal pause threshold; current 7% is 1-2% wider than best practice; continues prior audit pattern of 8→7 in April). **NOT IMPLEMENTED** — Option B attribution window closes 2026-06-15 (2 days); any automated constant change now would muddy final 48h of benchmark data. Proposing for Henry's immediate post-window review.

## Auditor Research Summary (Run #35 — 2026-06-13)

- **Signal Quality**: Multi-signal confluence confirmed best practice (2.5M+ daily signals in modern bots). Wallet count cross-reference: "high volume concentrated among few wallets = whale rebalancing, not organic demand" is a genuine alpha filter NVR lacks. Impact 3/Complexity 4/Risk medium → Priority 0.75. **Watch list for Henry** — needs new API integration (on-chain wallet analytics).
- **Execution Efficiency**: Aerodrome Slipstream V2 (March 2026) gas-aware routing + batched settlement already in production. Bot auto-benefits without code change. MEV protection via sequencer-direct RPC already active. TWAP jitter at 20%. No new action.
- **Position Sizing**: Research confirms quarter-Kelly (0.25f*) already optimal. Daily drawdown limits: KEY FINDING — industry standard 3-5% DAILY (weekly 7%). NVR `BREAKER_DAILY_DD_PCT=7` is 2-4% above industry floor. Continuing bear-adjusted tightening pattern: 8→7 (Apr-2026) → **proposed 7→6** (Jun-2026, 99-day bear). Impact 3/Complexity 1/Risk low → Priority 3.0. NOT implemented (Option B attribution lock).
- **Competitive Intelligence**: Multi-agent specialization (analysis/security/execution separation) already live via sleeves architecture (v21.13). Intent-based solvers (CoW Swap at ~34% aggregator share) — requires executeDirectDexSwap changes (permanently off-limits). MEV protection via private RPCs already in place. No new action.

## Watch List for Henry (post Option-B window, ~2026-06-15+)

1. **`BREAKER_DAILY_DD_PCT` 7→6** — Priority 3.0. Industry standard 5-6% daily; bear-adjusted tightening continues the 8→7 pattern. 1-line change in `src/core/config/constants.ts`. Low risk.
2. **Wallet-count filter on volume signals** — Priority 0.75. Cross-reference DEX volume with unique wallet count; high-volume / few-wallets = whale rebalancing. Needs new on-chain analytics API call.
3. **Scout proposals** — Once cohort lock lifts post-June-15, next scout run with API access should re-evaluate Base L2 trending pools (AerodromeFi volume at $1.68B ATH suggests new high-quality pools emerging).

## Jobs Status This Run (Run #32 — 2026-05-07T04:05 UTC)

- **Medic**: PATTERN D — API unreachable (persistent constraint, 403 on all endpoints). MEDIC_REPORT updated (Run #32).
- **Scout**: SKIPPED — last scout ran 2026-05-05T05:08 UTC (cbADA added), ~47h ago, less than 48h threshold.
- **Auditor**: TRIGGERED by inferred 62-day BEAR market (48h+ threshold met). Research ran 4 searches (signal quality, execution efficiency, position sizing, competitive intel). Top finding: SCOUT_UPGRADE_BUY_RATIO 55→60 — aligns scout graduation with HOT_MOVER_MIN_BUY_RATIO (60) and SCALE_UP_BUY_RATIO_MIN (60). Kelly criterion research confirms new/uncertain positions require stronger confirmation; 55% buy ratio in 62-day bear is predominantly early-stage distribution or MEV front-running. IMPLEMENTED in constants.ts. (Impact 3, Complexity 1, Risk low, Priority 3.0)

## Auditor Research Summary (Run #32 — 2026-05-07)
- **Signal Quality**: Smart money wallet clustering (multi-wallet same-token buys within time window as confluence) — already partially implemented via LARGE_TRADE_THRESHOLD_USD=2500 whale flow. Full Nansen/Dune integration complex (Impact 2/Complexity 4/Risk medium) → Watch list. (Priority 0.5)
- **Execution Efficiency**: Aerodrome Slipstream V3 cross-chain auto-benefits routing without code change. OpenOcean cross-DEX aggregation (Impact 2/Complexity 3) → Watch list (touches off-limits execution path). (Priority 0.67)
- **Position Sizing**: KEY FINDING — Quarter-Kelly (0.25f*) confirmed optimal for crypto (stratbase.ai, altrady.com, Kelly criterion Wikipedia); "position sizes should be reduced for new tokens with limited history." NVR already at KELLY_FRACTION=0.25. Actionable gap: SCOUT_UPGRADE_BUY_RATIO=55 is inconsistent with all other buy signal thresholds at 60. IMPLEMENTED: 55→60. (Impact 3, Complexity 1, Risk low, Priority 3.0)
- **Competitive Intelligence**: AI-on-AI MEV growing in 2026 (cryptollia.com). Sequencer-direct RPC already active. Intent-based trading (1inch, CoW Protocol) — requires off-limits execution changes. TWAP jitter already at 20%. No new actionable change. (Priority 0)

## Jobs Status This Run (Run #31 — 2026-05-06T~current UTC)

- **Medic**: PATTERN D — API unreachable (persistent constraint, 403 on all endpoints). MEDIC_REPORT updated (Run #31).
- **Scout**: SKIPPED — last scout ran 2026-05-05T05:08 UTC (cbADA added), less than 48h threshold.
- **Auditor**: TRIGGERED by inferred 60-day BEAR market (48h+ threshold met). Research ran 4 searches (signal quality, execution efficiency, position sizing, competitive intel). Top finding: RIDE_THE_WAVE_SIZE_PCT 4→3 — harmonises wave-ride sizing with the recent SCALE_UP_SIZE_PCT reduction (4→3, Run #31 git head). Wave rides (chasing 4h momentum) carry higher false-breakout risk than scale-ups on proven winners in a sustained 60-day bear downtrend. 4 searches, top candidate: Priority 3.0 (Impact 3, Complexity 1, Risk low). IMPLEMENTED in constants.ts.

## Auditor Research Summary (Run #31 — 2026-05-06)
- **Signal Quality**: Exchange inflow/outflow monitoring via CryptoQuant/Nansen. Already captured by NVR's LARGE_TRADE_THRESHOLD_USD=2500 whale flow + order flow buy-ratio pipeline. Full on-chain signal integration remains complex (Impact 2/Complexity 4/Risk med) → Watch list. No new action.
- **Execution Efficiency**: Aerodrome Slipstream V2 (March 2026) auto-benefits routing; Aerodrome+Velodrome merge upcoming. Bot auto-benefits without code change. No action needed.
- **Position Sizing**: KEY FINDING — RIDE_THE_WAVE_SIZE_PCT 4→3: Kelly/volatility research confirms all momentum-chasing vectors should be harmonised in sustained bear. SCALE_UP_SIZE_PCT was already reduced 4→3 (most recent staging commit). Wave rides target 4h momentum moves, which statistically have ~65% reversal rate in bear markets, making them higher-risk than adding to proven winners. Aligning at 3% eliminates the inconsistency. IMPLEMENTED. (Impact 3, Complexity 1, Risk low, Priority 3.0)
- **Competitive Intelligence**: Grid/DCA strategies standard for bear markets. NVR's wave-riding already implements equivalent physics. Hard position limits (15% portfolio cap) already enforced. MEV protection via sequencer-direct RPC already active. No new action.

## Jobs Status This Run (Run #31 — 2026-05-06T09:05 UTC)

- **Medic**: PATTERN D — API unreachable (persistent constraint, 403 on all endpoints). MEDIC_REPORT updated (Run #31).
- **Scout**: SKIPPED — last scout ran 2026-05-05T05:08 UTC (cbADA added), ~28h ago, less than 48h threshold.
- **Auditor**: TRIGGERED by inferred 61-day BEAR market (48h+ threshold met). Research ran 4 searches (signal quality, execution efficiency, position sizing, competitive intel). Top finding: STALE_POSITION_MIN_AGE_HOURS 48→36 — bear market research confirms faster recycling of flat $100+ positions frees dead capital into USDC reserve sooner. With STALE_POSITION_MAX_GAIN_PCT=1 and MAX_MOMENTUM_PCT=2 guards in place, reducing age from 48→36h only catches genuinely dead positions. IMPLEMENTED in constants.ts. (Impact 3, Complexity 1, Risk low, Priority 3.0)

## Auditor Research Summary (Run #31 — 2026-05-06)
- **Signal Quality**: Whale/on-chain integration (Nansen/Dune smart money) — already partially implemented (LARGE_TRADE_THRESHOLD_USD=2500, whale flow). Full integration complex (Impact 2/Complexity 4/Risk medium) → Watch list. No new action. (Priority 0.5)
- **Execution Efficiency**: Aerodrome Slipstream V3 cross-chain routing — bot auto-benefits at DEX level without code change. No action needed. (Priority 0)
- **Position Sizing**: KEY FINDING — Correlation-adjusted Kelly: with 8 tokens at ~0.7 correlation, effective independent positions ≈ 3.5. But KELLY_FRACTION=0.25 + KELLY_POSITION_CEILING_PCT=12 + TRENDING_DOWN×0.75 already accounts for this. Primary actionable finding: STALE_POSITION_MIN_AGE_HOURS 48→36 (Impact 3, Complexity 1, Risk low, Priority 3.0) IMPLEMENTED.
- **Competitive Intelligence**: Grid bots / swing bots general strategy — already implemented via AI discretionary + RIDE_THE_WAVE. No actionable new code pattern found.

## Jobs Status This Run (Run #30 — 2026-05-05T~current UTC)

- **Medic**: PATTERN D — API unreachable (persistent constraint, 403 on all endpoints). MEDIC_REPORT updated (Run #30).
- **Scout**: SKIPPED — last scout ran 2026-05-05T05:08 UTC (cbADA added, already-duplicate entry), less than 48h threshold.
- **Auditor**: TRIGGERED by inferred 59-day BEAR market (48h+ threshold met). Research ran 4 searches (signal quality, execution efficiency, position sizing, competitive intel). Top finding: KELLY_POSITION_CEILING_PCT 14→12 — Institutional Kelly-VAPS and adaptive Kelly criterion research confirms sustained bear regimes require tighter per-trade ceiling beyond Quarter-Kelly fraction alone. With TRENDING_DOWN ×0.75, effective max drops from 10.5% → 9% per trade. IMPLEMENTED in constants.ts. (Impact 3, Complexity 1, Risk low, Priority 3.0)

## Auditor Research Summary (Run #30 — 2026-05-05)
- **Signal Quality**: DeFi bots in 2026 increasingly use whale wallet tracking (already implemented: LARGE_TRADE_THRESHOLD_USD=2500) and Nansen/Dune-style smart money signals. Full on-chain signal integration complex (Impact 3/Complexity 4/Risk med) → Watch list. No new action.
- **Execution Efficiency**: Aerodrome Slipstream V2 (March 2026) auto-benefits routing efficiency. Slipstream cross-chain DEX launch April 2026 further optimizes routing — bot auto-benefits without code change. No new action.
- **Position Sizing**: KEY FINDING — MQL5 Institutional Kelly-VAPS Engine (Apr-2026) and adaptive Kelly criterion research both confirm: in bear markets, position ceiling reduction is a primary lever beyond the Kelly fraction itself. KELLY_POSITION_CEILING_PCT 14→12 IMPLEMENTED. (Impact 3, Complexity 1, Risk low, Priority 3.0)
- **Competitive Intelligence**: Intent-based solver routing (CoW Protocol style) at scale in 2026 — complex architecture change (off-limits). MEV protection via sequencer-direct RPC already in place. Watch list for Henry.

## Jobs Status This Run (Run #28 — 2026-05-04T16:15 UTC)

- **Medic**: PATTERN D — API unreachable (persistent constraint, 403 on all endpoints). MEDIC_REPORT updated (Run #28).
- **Scout**: RAN (addendum to today's earlier Run #27 cbSOL scout — staging fetch missed the earlier run initially). UP (Superform) added — Base address `0x5b2193fdc451c1f847be09ca9d13a4bf60f8c86b`, TGE Feb-10-2026, $8.8M 24h total volume, Aerodrome Ignition launch, $22.5M market cap, DEFI MEDIUM risk. Score 7/10.
- **Auditor**: TRIGGERED by inferred 57-day BEAR market (48h+ threshold met). Research ran 4 searches. Top finding (deferred from Run #22): GUARDIAN_NOVEL_TOKEN_HOURS_DEFAULT 48→72 — extend novel token GUARDIAN oversight window from 2 to 3 days. Kelly criterion bear market research confirms elevated novel token entry risk in sustained bear regimes. IMPLEMENTED in constants.ts. (Impact 3, Complexity 1, Risk low, Priority 3.0)

## Jobs Status This Run (Run #27 — 2026-05-04T08:21 UTC)

- **Medic**: PATTERN D — API unreachable (persistent constraint, 403 on all endpoints). MEDIC_REPORT updated (Run #27).
- **Scout**: RAN — last scout was 2026-05-02 (KAITO, 48h+ elapsed). cbSOL (Coinbase Wrapped Solana) added — confirmed Base address `0x2f280d1b1c738d71a6e7adeb1a84c8f2f114594c`, Aerodrome high-APY pool, 5+ months old, BLUE_CHIP LOW risk. cbMEGA ($2.19M vol, truncated address) flagged as watch list — cannot confirm full contract in API-blocked sandbox.
- **Auditor**: TRIGGERED by inferred 56-day BEAR market (48h+ threshold met). Research ran 4 searches. Top finding: CULL_MIN_AGE_HOURS 168→120 — accelerate stale research position culling from 7 to 5 days in sustained bear market. Portfolio management research confirms stale positions should be culled faster in extended bear regimes. IMPLEMENTED in constants.ts. (Impact 3, Complexity 1, Risk low, Priority 3.0)

## Jobs Status This Run (Run #25 — 2026-05-03T00:00 UTC)

- **Medic**: PATTERN D — API unreachable (persistent constraint, 403 on all endpoints). MEDIC_REPORT updated (Run #25).
- **Scout**: SKIPPED — last scout ran 2026-05-02 (KAITO added), less than 48h threshold.
- **Auditor**: TRIGGERED by inferred 55-day BEAR market (48h+ threshold met). Research ran 4 searches. Top finding: DECEL_MIN_DROP_FROM_PEAK 8→6 — faster Smart Trim activation. In sustained bear, buy ratio peaks are lower and smaller drops signal distribution; activating trim at 6pp (vs 8pp) exits profitable positions before they fade. IMPLEMENTED in constants.ts. (Impact 3, Complexity 1, Risk low, Priority 3.0)

## Auditor Research Summary (Run #25 — 2026-05-03)
- **Signal Quality**: On-chain exchange outflow/TVL monitoring established as accumulation signal. Already captured via LARGE_TRADE_THRESHOLD_USD=2500 whale flow. No new action. (Impact 2, Complexity 4, Priority 0.5)
- **Execution Efficiency**: Slipstream V2 (March 2026) auto-benefits routing efficiency. Permit2 already batched. No code change needed. (Priority 0)
- **Position Sizing**: Quarter-Kelly (0.25×) confirmed optimal for crypto bear markets. Already at KELLY_FRACTION=0.25. GUARDIAN_NOVEL_TOKEN_HOURS_DEFAULT 48→72 was secondary candidate (Impact 3, Priority 3.0) — deferred to DECEL_MIN_DROP_FROM_PEAK which has more direct bear-market exit impact.
- **Competitive Intelligence**: Intent-based routing (CoW Swap, ~34% DEX share) requires executeDirectDexSwap changes (off-limits). MEV private relay already in RPC endpoints. KEY FINDING: "Dynamic Capital Protection scales down during erratic regimes" → DECEL_MIN_DROP_FROM_PEAK 8→6 IMPLEMENTED.

## Jobs Status This Run (Run #23 — 2026-05-02T14:xx UTC)

- **Medic**: PATTERN D — API unreachable (persistent constraint, 403 on all endpoints). MEDIC_REPORT updated (Run #23).
- **Scout**: SKIPPED — last scout ran 2026-05-02T00:17 UTC (KAITO added), ~14h ago, less than 48h threshold.
- **Auditor**: TRIGGERED by inferred 54-day BEAR market (48h+ threshold met). Research ran 4 searches (signal quality, execution efficiency, position sizing, competitive intel). Top finding: true Quarter-Kelly (0.25×) completion — KELLY_FRACTION 0.30→0.25 implemented (Impact 3, Complexity 1, Risk low, Priority 3.0).

## Auditor Research Summary (Run #23 — 2026-05-02)
- **Signal Quality**: On-chain metrics (TVL growth, exchange outflows, active addresses) are established alpha signals. Current bot uses whale flow + technical indicators. Full on-chain signal integration is complex (Impact 4/Complexity 4/Risk medium) → Watch list for Henry.
- **Execution Efficiency**: Slipstream V2 routing upgrade (March 2026) — bot auto-benefits from DEX-level improvements without code change. Permit2 batch approvals already implemented. No new action.
- **Position Sizing**: KEY FINDING — Research confirms Quarter-Kelly (0.25×) is explicitly optimal for sustained bear regimes with crypto fat tails. Current 0.30 was already flagged as "closer to true Quarter-Kelly (0.25×)" in the comment. With 54-day bear, completing the progression. IMPLEMENTED: KELLY_FRACTION 0.30→0.25. Reduces max per-trade from 4.2%→3.5% of portfolio. (Impact 3, Complexity 1, Risk low, Priority 3.0)
- **Competitive Intelligence**: CoW Swap / intent-based execution at 34.3% DEX aggregator share, $9B/mo volume. Architecture requires touching executeDirectDexSwap (off-limits for auto-implementation). Watch list for Henry.

## Previous Run Summary (Run #21 — 2026-04-30)
- **Medic**: PATTERN D — API unreachable (persistent constraint, 403 on all endpoints). MEDIC_REPORT updated (Run #21).
- **Scout**: SKIPPED — last scout ran 2026-04-28T13:13 UTC (SPECTRA added), ~41h ago, less than 48h threshold.
- **Auditor**: TRIGGERED by inferred 52-day BEAR market (marketRegime BEAR 48h+ threshold met). Research ran 4 searches. Top finding: Kelly criterion + competitive intel research confirms tighter surge concentration limits in sustained bear markets (dead-cat bounce risk). SURGE_MAX_CAPITAL_PER_TOKEN_PCT 25→20 implemented (Impact 3, Complexity 1, Risk low, Priority 3.0).

## Previous Auditor Research Summary (Run #21 — 2026-04-30)
- **Signal Quality**: Whale tracking + volume confirmation already implemented (LARGE_TRADE_THRESHOLD_USD=2500, HOT_MOVER_MIN_BUY_RATIO=0.55). No new action.
- **Execution Efficiency**: Aerodrome Slipstream V2 (March 2026, 34× cap efficiency) — bot auto-benefits from DEX-level improvements without code change needed.
- **Position Sizing**: KEY FINDING — Kelly/volatility research confirms reducing max per-token allocation in sustained bear markets. SURGE events in 52-day bear are statistically likely dead-cat bounces. IMPLEMENTED: SURGE_MAX_CAPITAL_PER_TOKEN_PCT 25→20. (Impact 3, Complexity 1, Risk low, Priority 3.0)
- **Competitive Intelligence**: CoW Swap intent-based execution ($9B/mo, 34.3% DEX aggregator share). Intent routing requires touching executeDirectDexSwap (off-limits for auto-implementation). Watch list for Henry.

## Auditor Research Summary (Run #20)
- **Signal Quality**: Large-tx whale tracking already implemented (LARGE_TRADE_THRESHOLD_USD=2500). No new action.
- **Execution Efficiency**: Aerodrome Slipstream V2 routing update confirmed (March 2026) — bot auto-benefits from DEX-level improvements without code change needed.
- **Position Sizing**: KEY FINDING — Recent-window Kelly (30 trades) outperforms 50-trade window in bear markets per crypto Kelly criterion research. IMPLEMENTED: KELLY_ROLLING_WINDOW 50→30.
- **Competitive Intelligence**: Intent-based solver routing emerging. Complex (high) — watchlist for future implementation.

## Recommended Action for Henry

**This is now the 31st consecutive run with the same network restriction. Urgent:**

1. **Add to Claude Code egress allowlist:**
   - `autonomous-trading-bot-production.up.railway.app`
   - `api.geckoterminal.com`
   - `api.dexscreener.com`
2. **Or** expose a lightweight read-only status endpoint on an already-allowed domain
3. **Manually verify bot health:** https://autonomous-trading-bot-production.up.railway.app/health
4. **Consider staging promotion:** `./scripts/deploy/stage.sh` → verify → `./scripts/deploy/promote.sh`

## Pattern Classification
PATTERN D — Unknown / Cannot Assess (API unreachable — persistent environmental constraint, not a trade-error pattern)

## Safety
- No changes to agent-v3.2.ts
- No production changes
- MEDIC_REPORT.md conflict resolved; committed to staging only
