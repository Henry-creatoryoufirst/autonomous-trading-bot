# Dashboard Accuracy Audit

**Date:** 2026-04-05
**Dashboard:** schertzingertrading.com/dashboard (served from `dashboard/index.html`)
**Bot Version:** v20.6+ (codebase as of audit date)

---

## Summary

Multiple dashboard stats are inaccurate or misleading. The root causes fall into three categories:

1. **Restart resets** -- In-memory state (like `dailyBaseline`) resets on Railway redeploy, producing fake numbers until the first full cycle runs.
2. **Wrong metric used** -- The dashboard frontend calculates Win Rate using execution success rate instead of the P&L-based win rate the API already provides.
3. **Peak/drawdown stale state** -- On restart, peakValue loads from the state file but may be stale if the bot crashed mid-cycle or Railway redeployed during a drawdown.

---

## Stat-by-Stat Audit

### 1. Portfolio Value -- CORRECT

- **What it shows:** `$2,785.76`
- **Source:** `apiPortfolio().totalValue` = `state.trading.totalPortfolioValue`
- **How it works:** Calculated from on-chain balances (sum of all token holdings in USD). Updated every cycle from real wallet data.
- **Verdict:** Accurate. This is the live on-chain portfolio value.

---

### 2. Trading P&L (formerly "Total P&L") -- CORRECT

- **What it shows:** `-$493.53 / -13.74%`
- **Source:** `apiPortfolio().truePnL` and `truePnLPercent`
- **How it works:** `truePnL = currentPortfolio + withdrawn - deposited`. Uses on-chain deposit detection (Blockscout) as source of truth, with `INITIAL_DEPOSIT_USD` env var as fallback for CDP wallets.
- **Calculation:** `$2,785.76 + $0 - $3,279.29 = -$493.53`
- **Verdict:** Accurate. The on-chain deposit tracking makes this reliable across restarts.

---

### 3. 24H P&L -- WRONG (fake spike on restart)

- **What it shows:** `+$2,225.64` (from screenshot description)
- **Source:** Drawn as an overlay box on the equity chart canvas (lines 2611-2670 of `dashboard/index.html`). Calculated client-side from trade history.
- **How it works:** Scans `trades` array in reverse to find a trade timestamped ~24h ago, then computes `currentValue - dayStartValue`.
- **Why it's wrong:**
  - On restart, `state.trading.totalPortfolioValue` initializes to $0, then the startup warmup only prices USDC (non-USDC tokens show $0). The first heavy cycle prices everything correctly.
  - If the trades array has a `portfolioValueBefore` from the warmup phase (e.g., ~$560 when only USDC was priced), and the current value is $2,785, the delta shows +$2,225 -- a phantom spike.
  - The API-side `dailyPnl` field has a fix (v21.3 `dailyBaselineValidated` flag) that returns $0 until validated. But the equity chart's 24h P&L box is calculated entirely client-side from trade `portfolioValueBefore/After` fields, bypassing this fix.
- **Fix needed:**
  - Option A: Use the API's `dailyPnl` field instead of client-side calculation from trades.
  - Option B: Filter out trades where `portfolioValueBefore` or `portfolioValueAfter` is suspiciously low (e.g., < 50% of current portfolio) -- these are warmup artifacts.
  - Option C: Add a `baselineValidated` flag to the API response and skip rendering the 24h P&L box when it's false.

---

### 4. Win Rate (KPI card) -- WRONG (shows execution success rate, not P&L win rate)

- **What it shows:** Varies, but uses wrong formula.
- **Source:** `renderOverview()` in `dashboard/index.html` line 3139:
  ```js
  const wr = p.totalTrades > 0 ? (p.successfulTrades / p.totalTrades * 100) : 0;
  ```
- **Why it's wrong:** `successfulTrades / totalTrades` is the **execution success rate** (did the swap transaction succeed?). This is almost always ~100% because failed swaps are rare. It does NOT measure profitability.
- **What it SHOULD show:** The API already returns `p.winRate` from `calculateTradePerformance()` which computes the correct P&L-based win rate (profitable sells / total sells). But the dashboard ignores this field for the KPI card.
- **Sub-text also wrong:** `$('kpi-winrate-sub').textContent = successfulTrades + '/' + totalTrades + ' trades'` -- this shows execution stats, not wins/losses.
- **Fix needed:** Replace the KPI Win Rate calculation:
  ```js
  // BEFORE (wrong -- execution success rate):
  const wr = p.totalTrades > 0 ? (p.successfulTrades / p.totalTrades * 100) : 0;
  // AFTER (correct -- P&L win rate from API):
  const wr = p.winRate || 0;
  ```
  And update the sub-text to show profitable/unprofitable trade counts.

---

### 5. Win Rate (Trades section) -- ALSO WRONG (same bug)

- **Source:** `renderTrades()` in `dashboard/index.html` line 3461:
  ```js
  const wr = p.totalTrades > 0 ? (p.successfulTrades / p.totalTrades * 100) : 0;
  ```
- **Same issue as #4.** Uses execution success rate instead of `p.winRate`.
- **Fix needed:** Same as #4 -- use `p.winRate || 0`.

---

### 6. Drawdown (KPI card) -- PARTIALLY WRONG (reset-dependent)

- **What it shows:** `0%` (per user report)
- **Source:** `apiPortfolio().drawdown`:
  ```js
  drawdown: peakValue > 0 ? Math.max(0, ((peakValue - totalPortfolioValue) / peakValue) * 100) : 0
  ```
- **Why it could show 0%:**
  - `peakValue` is loaded from the state file on restart (line 2630). If restored correctly, drawdown should be accurate.
  - However, after restart, the first thing that happens is the startup warmup which sets `peakValue = startupValue` (line 8895). If `startupValue` is the USDC-only balance (~$560), peak gets LOWERED to $560. The runtime sanity check (line 7247) then caps peak at `portfolio + payouts + 15%`.
  - If `peakValue` was correctly restored from the state file before the warmup override, this works. But the warmup override at line 8895 can clobber it.
  - Once the first full cycle runs and prices all tokens, `peakValue` gets set to `totalPortfolioValue` (line 7218-7219), which is the current value -- making drawdown 0% even if the bot is down from its historical peak.
- **The real issue:** `peakValue` is a running high-water mark, but it gets reset to the current portfolio value on restart (either through the warmup override or through the sanity check). If the portfolio was $3,800 last week and is now $2,785, drawdown should be ~26%, but after restart it shows 0% because peak was reset to ~$2,785.
- **Fix needed:** Never override `peakValue` with a lower value during startup. The state file already persists it correctly. Remove or guard the startup warmup line that sets `peakValue = startupValue` (line 8895). The runtime sanity check (line 7247) should only cap unreasonably HIGH peaks, not reset peak to current value.

---

### 7. Max Drawdown -- WRONG (shows +0.00%)

- **What it shows:** `+0.00%`
- **Context:** This appears in the Simulate/Lab section of the dashboard (`sim-drawdown`), which shows walk-forward simulation results.
- **Source:** `renderSimulate()` at line 4080:
  ```js
  $('sim-drawdown').textContent = fmtPct(-(Math.abs(d.maxDrawdownPct || d.maxDrawdown || 0)));
  ```
- **Why it's wrong:** If no simulation has been run since restart, `d.maxDrawdownPct` and `d.maxDrawdown` are both 0 or undefined. The simulation data comes from the `/api/walk-forward` endpoint which runs an actual backtest -- if that hasn't been triggered, the values default to 0.
- **Additional issue:** Even when simulation runs, `maxDrawdown` only reflects the simulated period, not the bot's actual lifetime max drawdown. There is no persisted "lifetime max drawdown" metric.
- **Fix needed:**
  - Add a `lifetimeMaxDrawdown` field to the persisted state that tracks the highest drawdown ever observed.
  - Update it each cycle: `lifetimeMaxDrawdown = Math.max(lifetimeMaxDrawdown, currentDrawdown)`.
  - Display it on the Overview tab (not just in the simulation section).

---

### 8. Total Trades (KPI card) -- CORRECT (with caveat)

- **What it shows:** The total trade count from `p.totalTrades`
- **Source:** `state.trading.totalTrades` -- persisted in state file, loaded on restart (line 2631-2636). Also includes lifetime counters (`lifetimeTotalTrades`) that survive trade array truncation.
- **Verdict:** Correct. Trades are persisted and restored across restarts.
- **Caveat:** The sub-text shows `successfulTrades + ' successful'` which counts execution successes, not profitable trades. This is misleading when placed next to "Total Trades".

---

### 9. Volume -- NOT SHOWN IN KPI STRIP

- **Context:** The user mentioned "VOLUME: $0.00" -- this is NOT a standalone KPI card in the current dashboard. Volume appears only in the Daily P&L Scoreboard table (per-day `volume` column) and in the DEX Volume 24h intel card (which shows Base chain DEX volume, not the bot's volume).
- **Source:** Daily volume is computed from `trade.amountUSD` summed per day in `apiDailyPnL()`.
- **Why it might show $0:** If no trades have occurred since the last restart, or if the trades loaded from the state file don't have `amountUSD` populated (older trade records may lack this field).
- **Verdict:** Volume data is computed correctly from trade history but may show $0 if trade history is empty or lacks `amountUSD` fields.

---

### 10. Profit Factor -- CORRECT (but dependent on trade data)

- **What it shows:** `0.00` (per user report)
- **Source:** `calculateRiskRewardMetrics()` in api.ts lines 124-175:
  ```js
  profitFactor = totalWins / totalLosses
  ```
- **How it works:** Iterates all SELL trades, calculates P&L per trade using cost basis, sums wins and losses separately.
- **Why it shows 0:** Two possible causes:
  1. No SELL trades in `state.tradeHistory` (they exist but might not have matching `costBasis` entries after restart).
  2. Cost basis entries were restored but `averageCostBasis` is 0 for all tokens (possible if cost basis was corrupted or not saved).
- **Verdict:** The calculation is correct, but it depends on `state.costBasis` having valid data. If cost basis was not restored properly, all trades show $0 P&L and profit factor is 0.
- **Fix needed:** Verify that `costBasis` is properly persisted and restored. Add a rebuild-from-trades fallback if cost basis is missing (the function `rebuildCostBasisFromTrades` exists but may not run on every restart).

---

### 11. Total Harvested -- LIKELY CORRECT

- **What it shows:** `$0.00`
- **Source:** `apiPortfolio().harvestedProfits` = `state.harvestedProfits.totalHarvested`
- **How it works:** Tracks profit-taking events (selling partial positions at gain thresholds). Persisted in state file.
- **Verdict:** If the bot has never hit a harvest threshold (positions haven't reached +8%, +15%, +25%, +40% from cost basis), this is legitimately $0. The data IS persisted across restarts.

---

### 12. Sector Allocation -- CORRECT (after first full cycle)

- **What it shows:** Blue Chip 29%, others near 0%
- **Source:** `calculateSectorAllocations()` in agent-v3.2.ts lines 4632-4659. Computed from actual token balances and their sector assignments in `TOKEN_REGISTRY`.
- **How it works:** Groups tokens by sector (BLUE_CHIP, AI_TOKENS, MEME_COINS, DEFI), sums USD values, calculates percentages.
- **Why some sectors show 0%:** If the bot only holds tokens in certain sectors (e.g., mostly ETH/USDC in Blue Chip), other sectors legitimately have 0% allocation.
- **Caveat on restart:** Sector allocations are computed from balances. During the startup warmup, only USDC is priced -- so sectors will briefly show 100% cash, 0% everything else. After the first full cycle, it corrects itself.
- **Verdict:** Correct after first full cycle. May briefly show wrong data during startup warmup.

---

### 13. Embedded Dashboard (embedded-html.ts) P&L Label -- WRONG (misleading label)

- **What it shows:** "Today: -$493.53"
- **Source:** `renderPortfolio()` line 280:
  ```js
  pnlEl.textContent = 'Today: ' + pnlSign(p.pnl) + fmt(p.pnl) + ...
  ```
- **Why it's wrong:** `p.pnl` is `truePnL` (total P&L since inception), NOT today's P&L. The label "Today:" is incorrect. The actual daily P&L is in `p.dailyPnl` which this code doesn't use.
- **Fix needed:** Either change the label to "Total P&L:" or change the value to use `p.dailyPnl`.

---

## Priority Fix List

| Priority | Stat | Issue | Effort |
|----------|------|-------|--------|
| P0 | 24H P&L | Phantom +$2,225 spike from restart warmup artifact | Medium |
| P0 | Win Rate (KPI) | Shows execution success rate, not P&L win rate | Easy (1-line fix) |
| P0 | Win Rate (Trades) | Same as above | Easy (1-line fix) |
| P1 | Drawdown | Resets to 0% on restart (peak clobbered by warmup) | Medium |
| P1 | Max Drawdown | No lifetime tracking; simulation-only metric shows 0 | Medium |
| P1 | Profit Factor | Shows 0 if cost basis not properly restored | Easy (verify persistence) |
| P2 | Embedded P&L label | "Today:" label on total P&L is misleading | Easy (label change) |
| P2 | Trades sub-text | Shows execution success, not profitable trade count | Easy |
| P3 | Volume | Not a KPI card; daily volume may show $0 for old trades | Low |
| P3 | Total Harvested | Likely correct ($0 if no harvests occurred) | None |

---

## Root Cause Analysis

### The Restart Problem

Railway redeploys the bot container on every git push to `main`. When the container restarts:

1. `breakerState` initializes to defaults (`dailyBaseline: { date: '', value: 0 }`)
2. State file is loaded, restoring `breakerState` including `dailyBaseline`
3. Startup warmup runs `getBalances()` -- this only prices USDC tokens (no market data fetch)
4. `peakValue` gets set to this USDC-only value (line 8895), clobbering the persisted peak
5. `dailyBaselineValidated` is set to `false` (v21.3 fix), but the equity chart 24h P&L ignores this

**The v21.3 fix (dailyBaselineValidated) partially addresses the daily P&L issue for the API response, but the equity chart's 24h P&L box is calculated client-side from trade history and bypasses this fix entirely.**

### The Win Rate Metric Mismatch

The API computes two different "win rate" metrics:

1. `perfStats.winRate` -- P&L-based (profitable sells / total sells) -- CORRECT metric, returned as `p.winRate`
2. `state.trading.successfulTrades / totalTrades` -- execution success rate -- WRONG metric for "win rate"

The dashboard KPI cards use metric #2 when they should use metric #1. The API already provides the correct metric; the dashboard just doesn't use it.

---

## Files Involved

- **API data layer:** `src/dashboard/api.ts` (lines 177-306 for portfolio endpoint)
- **Dashboard frontend (main):** `dashboard/index.html` (lines 3116-3200 for KPI rendering)
- **Dashboard frontend (embedded):** `src/dashboard/embedded-html.ts` (lines 277-310)
- **Agent state/lifecycle:** `agent-v3.2.ts` (lines 2535-2600 for state init, 2620-2860 for state load, 2867-2920 for state save, 7200-7260 for peak/baseline updates, 8960-8980 for startup warmup)
- **Trade performance:** `src/core/self-improvement/engine.ts` (lines 45-104 for calculateTradePerformance)
