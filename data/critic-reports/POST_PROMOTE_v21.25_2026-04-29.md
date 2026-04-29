# NVR-CRITIC Post-Promotion Audit — v21.25 (48h)

**Audit date:** 2026-04-29 UTC  
**Promoted:** v21.25.0 at 2026-04-27 ~16:17 UTC  
**Auditor:** Claude Code  
**Status:** ⚠️ PARTIAL — Fresh CRITIC run blocked. Analysis uses existing reports only.

---

## Headline

**Inconclusive — audit cannot be completed as specified. Four pre-conditions failed before fresh data could be collected. The 04-27 CRITIC report (the closest proxy) contains only 33 minutes of v21.25 operation and cannot measure the fixes. A critical superseding change (v21.27: forced liquidation deleted) makes the v21.25 test obsolete anyway.**

---

## Pre-Condition Failures (Halt Criteria)

### 1. Production version mismatch
```
Expected: v21.25.0
Actual:   v21.28.0
```
Three additional versions promoted to production since v21.25:
- v21.26 (2026-04-28): CRITIC nightly cron — automated audit loop
- **v21.27 (2026-04-28): Forced liquidation DELETED entirely** — "Step 2 of the algorithm"
- v21.28 (2026-04-28): Honest all-time-high (Cockpit Mirror peak fix)

v21.27 is significant: it does not gate forced liquidation, it removes it. The v21.25 hypothesis ("winner-protection gates reduce forced liquidation frequency") is superseded. The bot no longer forces liquidation at all.

### 2. Production URL unreachable from audit environment
```
curl https://autonomous-trading-bot-production.up.railway.app/health → "Host not in allowlist"
All API endpoints → HTTP 403
```
The sandbox environment blocks egress to Railway. `npm run critic` produces 0 trades, making the fresh CRITIC run meaningless. File `data/critic-reports/2026-04-29.md` was written but contains 0 trades and no proposals.

### 3. `tsx` runtime not installed
```
$ npm run critic
sh: 1: tsx: not found
```
`tsx` was not in `node_modules/.bin`. Installed during this audit (`npm install tsx --save-dev`), but the URL block (failure #2) prevents productive use regardless.

### 4. CRITIC timestamp: 04-27 report is not a post-v21.25 measurement
```
v21.25 promoted:  2026-04-27T16:17 UTC (approx)
04-27 report gen: 2026-04-27T16:50:58 UTC
v21.25 in window: ~33 minutes of 10,080 minutes = 0.3% of the 168h window
```
The 04-27 report is effectively the same population as the 04-24 baseline with the window rolled forward. It is not a post-v21.25 measurement.

---

## Comparison Table (with caveats)

The two reports we have represent overlapping but different time windows. Differences are driven by window drift (older trades falling off the 168h rolling window), not by v21.25.

| Metric | Baseline 04-24 | 04-27 "proxy" | Direction | Confidence |
|---|---|---|---|---|
| Window end | 2026-04-24T20:07 | 2026-04-27T16:50 | +72h roll | — |
| Total trades in window | 274 | 211 | ↓63 | 🔴 Window drift, not signal |
| Realized P&L (all SELLs) | -$192.98 | -$29.72 | ↑$163 | 🔴 Window drift |
| Round-trips closed | 91 | 50 | ↓41 | 🔴 Window drift |
| Avg realized / round-trip | -$2.56 | -$0.46 | ↑$2.10 | 🟡 Mixed — older bad trades rolled off |
| Capture ratio | -24% | -250% | ↓ extreme | 🔴 DRB outlier + small sample |
| Since-exit move | -17.6% | -37.3% | ↑ (more negative = better timing) | 🟡 Partially regime-driven |
| `dry_powder_rebalance` n | 64 | 47 | ↓17 (27%) | 🔴 Window drift |
| `dry_powder_rebalance` win% | 27% | 30% | ↑3pp | 🟡 Noise at these n's |
| `dry_powder_rebalance` avg$ | -$3.06 | -$2.05 | ↑$1.01 | 🟡 Marginal improvement |
| `confluence_strong` n | 23 | 14 | ↓9 (39%) | 🔴 Window drift |
| `confluence_strong` win% | 0% | 0% | → | ⚫ No change |
| `confluence_strong` avg$ | -$3.08 | -$0.48 | ↑$2.60 | 🔴 cbXRP -$46 + CRV -$14 fell off window |
| `momentum_chase` n | 9 | 7 | ↓2 | 🔴 Window drift, n too small |
| `momentum_chase` win% | 0% | 0% | → | ⚫ No change |
| `momentum_chase` avg$ | -$1.53 | -$1.93 | ↓$0.40 | 🔴 Noise at n=7 |

---

## Per-Metric Interpretation

### Capture ratio: -24% → -250%

**Do not read this as a regression. It is a data artifact.**

The -250% is dominated by a single DRB round-trip: the bot sold DRB at a realized loss of -$36.43 (reported as -180.6% on a ~$20 buy) while DRB subsequently ran +102.8%. CRITIC computes `captureRatio = realizedPct / totalMovePct = -180% / +103% = -1.75`. With only 50 round-trips in the 04-27 window (vs 91 in 04-24) and fewer offsetting well-timed exits available, this outlier dominates the average.

**Separate data quality flag:** The DRB realized P&L appears unreliable. A -180.6% realized loss on a $20 BUY is numerically impossible without leverage (you cannot lose more than 100% of invested capital in a spot trade). CRITIC's FIFO pairing may be matching the DRB sell against the wrong (smaller) buy, or the `/api/trades` `realizedPnL` field for DRB has a tracking bug. This issue appeared in both reports (04-24 also showed DRB at -338.8%) and should be investigated independently. **Do not use DRB round-trip metrics for trading decisions until this is resolved.**

The -24% capture ratio from 04-24 was also primarily a DRB artifact. Neither number is reliable for DRB.

### Since-exit move: -17.6% → -37.3%

Tokens fell harder after the bot's exits in the 04-27 window than in the 04-24 window. Negative values are good — they mean the bot exited before further downside. The improvement here is partially real (the bot avoided the DRB crash, cbXRP collapse) and partially regime-driven (market was more broadly down). Cannot attribute to v21.25 with the data available.

### `dry_powder_rebalance` n: 64 → 47

The 27% count reduction is explained almost entirely by window drift. The 04-24 window captured the April 17–24 period when USDC ran dry repeatedly; those trades aged out of the 04-27 window. The per-trade P&L improved ($-3.06 → $-2.05) but the big losers (DRB $-72.27) simply rolled off. Not attributable to v21.25.

v21.27 (forced liquidation deleted) is the real fix for this pattern. Once the 04-29 nightly CRITIC report generates against a production window that is mostly post-v21.27, the n for `dry_powder_rebalance` should drop dramatically — possibly to zero or near-zero — because the mechanism that triggered it no longer exists.

### `confluence_strong` n: 23 → 14, avg: -$3.08 → -$0.48

The dramatic P&L improvement is explained by cbXRP ($-46.01) and CRV ($-14.56) falling off the window, not by any gate. Win rate is still 0% in both windows. This pattern is consistently destructive; v21.25 was supposed to gate it; we cannot confirm the gate worked without fresh data.

### `momentum_chase` n: 9 → 7, avg: -$1.53 → -$1.93 (worse)

n=7 is below the noise floor (CRITIC's own threshold is n≥3 for proposals, n<20 is noise). The slight worsening is not meaningful.

### Realized P&L: -$192.98 → -$29.72

The dramatic improvement between 04-24 and 04-27 is almost entirely window composition: the worst trades (DRB $-72.27, cbXRP $-46.01, PENDLE $-28.31) aged out. Meanwhile, positive carryovers (HIGHER +$63.26, TOSHI +$52.97) remained in both windows. This is not evidence of a better decision engine.

---

## Confidence Assessment

**Signal strength: LOW.** We have zero usable post-v21.25 data for the intended metrics. The two available reports are:

1. **04-24**: The agreed-upon baseline. Valid.
2. **04-27**: Contains 0.3% of post-v21.25 operation. Not a valid test.
3. **04-29 (fresh run)**: 0 trades — URL blocked. Useless.

For a valid measurement: the first CRITIC report generated by the nightly cron (v21.26 automates this) with a substantial post-v21.27 window will be meaningful. That means a report generated on or after **2026-05-04** (7 days post v21.27 promotion), at which point the 168h window will contain mostly post-v21.27 trades where forced liquidation no longer exists.

**Small-sample risk:** Even then, if conviction entries are rare (≤20 per pattern), the conclusions will be directional guidance, not statistical fact.

---

## Structural Issue: v21.27 Supersedes the Hypothesis

The audit was designed to test: *"Did v21.25's winner-protection gates reduce forced liquidation frequency?"*

v21.27 answered a different question: *"Why gate a broken mechanism when you can delete it?"*

Forced liquidation is gone. `dry_powder_rebalance` and `confluence_strong` should trend toward zero fires in post-v21.27 CRITIC windows. If they don't — if the patterns still appear — that means either (a) some code path survived the deletion, or (b) the pattern classifier is matching unrelated reasoning strings. Either would be a bug worth investigating.

---

## Top 3 Next Actions

### 1. Wait for the v21.27 CRITIC signal — target report 2026-05-05
The nightly cron (v21.26) will auto-generate `data/critic-reports/2026-05-05.md`. That report's 168h window will cover April 28 – May 5, which is post-v21.27 promotion for the entire window. Read it with a specific question: *Are `dry_powder_rebalance` and `confluence_strong` near-zero? If not, something survived the deletion.*

Do not run another manual CRITIC audit until then. The nightly cron is already doing the work.

### 2. Investigate DRB realizedPnL tracking bug
Two CRITIC reports in a row show DRB with mathematically impossible realized losses (>100% of invested capital in a spot trade). This is a data quality issue in `/api/trades` or in CRITIC's FIFO pairing, not a real trade outcome. While DRB appears to be closed or near-zero in current positions, the tracking bug could affect other tokens. Before v21.29: audit the `realizedPnL` calculation in `smart-wallet-tracker.ts` and confirm it correctly handles tokens bought across multiple cycles.

### 3. Fix the audit environment for future manual runs
Two of the four blockers are fixable:
- `tsx` is now installed (done during this audit — committed on this branch)
- The URL block is a sandbox policy issue, not a code issue

For future manual audits, run CRITIC from outside the sandbox (Railway CLI, local machine, or a CI job with egress). The command is now: `npx tsx scripts/critic.ts`. The nightly cron handles the automated case; manual runs are for ad-hoc investigation.

**Do not run** `npm run critic` in this sandbox environment expecting real output — it will always produce 0-trade reports.

---

## Appendix: What Would "Working" Look Like

If v21.25's gates are working (testable in the 2026-05-05 report):
- `dry_powder_rebalance` n drops by ≥50% per-week vs 04-24 baseline (64/week → ≤32/week)
- `confluence_strong` n drops by ≥50% (23/week → ≤12/week)
- Capture ratio moves toward 0% or positive territory (from -24%)
- `dry_powder_rebalance` win% climbs above 40% (winners better protected before exit)

If v21.27 (forced liquidation deleted) is working:
- `dry_powder_rebalance` drops to near-zero or changes character (should appear only for genuine rebalancing, not crisis exits)
- `confluence_strong` drops to near-zero (no more "sell winner to fund new entry" under duress)
- Total realized P&L per week should improve (fewer forced exits at bad prices)

If neither happened, the 05-05 report will show these patterns continuing at baseline rates, which means the deletion didn't fully take or a shadow code path is triggering the same behavior.

---

_Audit procedure: 2026-04-29 UTC. CRITIC run attempted but blocked (403 on all endpoints). Report based on 2026-04-24 (n=274) and 2026-04-27 (n=211) reports. Fresh data requires network access to Railway from outside this sandbox._  
_CRITIC proposes. Henry merges. Nothing auto-applies._
