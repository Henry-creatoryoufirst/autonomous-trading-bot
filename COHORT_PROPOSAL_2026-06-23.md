# COHORT PROPOSAL — 2026-06-23

**Filed by:** NVR Capital autonomous agent (hourly run, Scout Job)  
**Branch:** claude/cool-sagan-e927bt  
**Status:** PROPOSAL ONLY — requires Henry review + explicit human PR per CLAUDE.md Rule 1

---

## Context

The Option B benchmark window (2026-05-15 → ~2026-06-15) has closed. This is the first
post-window scout run. Per CLAUDE.md: "Cohort changes happen only via explicit human PR
after the 30-day window completes." This file fulfills the scout's research obligation
without auto-committing TOKEN_REGISTRY changes.

GeckoTerminal was blocked by egress proxy policy (403 on all API endpoints) — full
liquidity/volume/pool-age data could not be fetched automatically. Data below is from
WebSearch + on-chain knowledge.

---

## Scout Findings (2026-06-23)

### Market Regime Signals

| Signal | Value | Source |
|--------|-------|--------|
| AERO 24h price change | +13% | CMC / MetaMask price feed |
| AERO 24h volume | ~$61M | CoinMarketCap |
| AERO market cap | ~$520M | CoinMarketCap |
| cbBTC-cbADA Slipstream pool APR | ~906% | WebSearch / Aerodrome data |
| cbBTC-cbXRP Slipstream pool APR | ~634% | WebSearch / Aerodrome data |
| Base weekly stablecoin DEX volume | $620M | WebSearch |
| Aerodrome daily trading volume | $400M+ | WebSearch |
| Aerodrome TVL | $1.2B+ | WebSearch |

### COHORT_QUALITY_7 Coverage Assessment

Current cohort is already well-positioned for the high-APR Aerodrome Slipstream pools:

| Cohort Token | Aerodrome Pool | Estimated APR | Coverage |
|-------------|----------------|---------------|----------|
| cbBTC | cbBTC-cbADA, cbBTC-cbXRP | 634-906% | ✅ IN COHORT |
| WETH | WETH-USDC, WETH-cbBTC | Active | ✅ IN COHORT |
| cbXRP | cbBTC-cbXRP | ~634% | ✅ IN COHORT |
| cbLTC | cbLTC pools (HOLD_ONLY — thin liq) | N/A | ⚠️ HOLD_ONLY |
| LINK | LINK pools | Active | ✅ IN COHORT |
| cbADA | cbBTC-cbADA | ~906% | ✅ IN COHORT |
| cbSOL | cbSOL pools | Active | ✅ IN COHORT |

**Assessment:** COHORT_QUALITY_7 already covers 6 of 7 tokens in high-APR Aerodrome pools.
The 7th (cbLTC) is on HOLD_ONLY due to thin Base L2 liquidity — may warrant replacement.

---

## Candidate Tokens Evaluated

GeckoTerminal was inaccessible; candidates derived from WebSearch. Without confirmed
liquidity/volume/age data, quality filter thresholds cannot be formally verified.
All candidates are flagged NEEDS_VERIFICATION.

### Candidate 1: AERO (Aerodrome Finance)
- **Already in TOKEN_REGISTRY as DEFI sector ✅**
- **Proposal:** Consider upgrading AERO weighting in AI prompt or increasing sector target.
  Aerodrome Predictive Allocation upgrade launching July 2026 is a major protocol catalyst.
  AERO at $0.54 with 60%+ Base DEX volume share is protocol-level infrastructure.
- **Action required:** None for TOKEN_REGISTRY (already present). Consider DEFI sector
  allocation increase from 15% target given Aerodrome's growing dominance.

### Candidate 2: cbLTC replacement
- **Current:** cbLTC is HOLD_ONLY (thin liquidity, TWAP slices failing)
- **Proposal:** After 30-day observation period, consider replacing cbLTC in COHORT_QUALITY_7
  with a more liquid cbAsset. Candidates: cbDOGE (already in TOKEN_REGISTRY, BLUE_CHIP LOW).
- **GeckoTerminal verification needed:** cbDOGE Base pool liquidity, 24h volume
- **Status:** NEEDS_HENRY_DECISION — COHORT_QUALITY_7 modification, requires human PR

### Candidate 3: OpenOcean cross-DEX aggregation (infrastructure, not a token)
- **From Auditor research:** OpenOcean API provides cross-DEX swap aggregation for Base
- **Not a token addition** — flagged for Henry as potential execution layer upgrade
- **Impact:** 2/5, Complexity: 3/5, Risk: medium (touches execution path)
- **Status:** WATCH LIST — not auto-implementable (execution path off-limits)

---

## Post-Bear-Market Constants Review (FLAGGED FOR HENRY)

The 65+ day bear market ended approximately June 2026. The following constants were
bear-adjusted and may warrant post-recovery recalibration. **Do not auto-apply —
requires confirmed market regime change from live bot data.**

| Constant | Bear Value | Pre-Bear Value | Recovery Candidate? |
|----------|-----------|----------------|---------------------|
| KELLY_FRACTION | 0.25 | 0.35 | Partial restore to 0.28-0.30 in bull regime |
| VOL_LOW_BOOST | 1.25 | 1.50 | Partial restore to 1.35-1.40 |
| HOT_MOVER_MIN_CHANGE_H1_PCT | 7% | 5% | Lower to 5-6% in recovery |
| RIDE_THE_WAVE_MIN_MOVE | 7% | 5% | Lower to 5-6% in recovery |
| SCALE_UP_SIZE_PCT | 3% | 4% | Restore to 4% if bull confirmed |
| HOT_MOVER_MIN_BUY_RATIO | 0.60 | 0.55 | Lower to 0.55-0.58 in recovery |
| SCOUT_UPGRADE_BUY_RATIO | 60 | 55 | Lower to 55-58 in recovery |
| CULL_MIN_AGE_HOURS | 72 | 168 | Partial restore to 96-120h |
| STALE_POSITION_MIN_AGE_HOURS | 36 | 48 | Restore to 42-48h |
| GUARDIAN_NOVEL_TOKEN_HOURS_DEFAULT | 72 | 48 | Partial restore to 60h |

**Recommendation:** Henry manually check live portfolio metrics. If win_rate > 0.50 and
drawdown < 5% over last 20 trades, a conservative post-recovery recalibration is warranted.
Suggest starting with KELLY_FRACTION 0.25→0.28 and VOL_LOW_BOOST 1.25→1.35 as first step.

---

## Aerodrome Predictive Allocation — Strategic Note

On June 14, 2026, Dromos Labs announced Aerodrome will replace its weekly gauge voting
system with "Predictive Allocation" launching July 2026. This rewards participants
(including AI agents) for accurately forecasting future liquidity demand.

**Implications for NVR:**
1. AERO positioning: Protocol upgrade = potential price catalyst in July 2026
2. Yield-optimizer: cbAssets Slipstream pools currently at 600-900% APR may shift as
   Predictive Allocation changes incentive distribution — monitor after July launch
3. The yield-optimizer.ts currently focuses on AAVE; cbAssets Aerodrome LP may become
   a superior yield strategy post-upgrade (requires Henry review of yield-optimizer.ts)

---

## Actions Required from Henry

1. **Add egress allowlist** for `api.geckoterminal.com` to enable automated GeckoTerminal scout
2. **Review COHORT_QUALITY_7:** Consider cbLTC → cbDOGE swap (liquidity-driven, not alpha-driven)
3. **Confirm market regime:** Check live bot metrics to determine if bear-adjusted constants
   should begin post-recovery recalibration
4. **Aerodrome Predictive Allocation:** Monitor after July 2026 launch for yield-optimizer impact
5. **Merge or close** this proposal branch after review

---

## What Was NOT Added to TOKEN_REGISTRY

Per CLAUDE.md Rule 1, no automatic TOKEN_REGISTRY additions were made this run.
GeckoTerminal pool data was inaccessible (egress policy 403). Without verified
liquidity/volume/pool-age data, auto-addition would violate quality filter standards.
