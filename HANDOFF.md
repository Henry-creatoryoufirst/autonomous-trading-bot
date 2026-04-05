# NVR Capital Bot -- Session Handoff

**Date:** April 5, 2026
**Repo:** `autonomous-trading-bot` at `/Users/henryschertzinger/Desktop/NVR Capital/bot/`
**Branch:** `main` (only branch -- all others merged and deleted)

---

## START HERE

1. Read `CLAUDE.md` in the repo root for bot overview, deployment, and revenue model.
2. State which silo you are working in before making changes.
3. Run `npm run confidence-gate` before and after any algorithm changes.
4. Run `npx vitest run` before pushing (221 tests, 14 files).
5. Never commit API keys or wallet private keys.

---

## What Was Completed (April 5, 2026)

### Branch Cleanup
Four stale branches were discovered and merged into main, then deleted locally and on remote:
- `claude/review-handoff-refactor-HRwth` -- 43-commit modular refactor (14-phase extraction)
- `claude/audit-trading-bot-Rgme3` -- testable services, paper trade gate, critical-path tests
- `claude/debug-hot-bot-trades-MeDfY` -- zero-trade failure fix
- `claude/coding-session-start-O1DTQ` -- security fortification

### 5-Silo Architecture
97 files reorganized with git history preserved. `agent-v3.2.ts` reduced from 17,451 to 9,890 lines. 60+ import paths updated.

```
src/
  algorithm/   -- indicators, confluence, sizing, risk
  core/        -- state, execution, services, config, types
  dashboard/   -- UI, API, server routes
  simulation/  -- replay, backtester, confidence scoring
  fleet/       -- family platform, deploy configs
```

**Silo boundary rules:**
- Each silo exposes a public API through its `index.ts` -- that is the only valid import target from outside.
- No direct cross-silo imports. Always go through `index.ts`.
- `CORE` is the shared dependency. All other silos depend on Core, never on each other.
- Working on one silo means all other silos are read-only.

Full plan documented in `SILO_MIGRATION_PLAN.md`.

### Simulation Engine (12 new files in `src/simulation/`)
- **Replay engine:** feeds historical candles through RSI/MACD/Bollinger/confluence pipeline
- **Strategy tester:** run multiple strategy variants against the same dataset
- **Parameter sweep:** grid search over threshold space (`src/simulation/backtester/parameter-sweep.ts`)
- **Confidence scorer:** 0--100 composite score with 4 components (returns, risk, consistency, robustness)
- **Market condition classifier:** BULL / BEAR / RANGING / VOLATILE
- **Enhanced paper trader** with live comparison mode
- **Historical data fetching** and synthetic data generation

### Dashboard
- Three-tab dashboard built in `dashboard-upgrade/index.html` (Wallet, Fleet Command, Simulations)
- Dark theme, responsive, SVG charts, NVR branding
- **Not yet wired** into the live embedded dashboard -- still lives in `dashboard-upgrade/`

### Dashboard Accuracy Fixes (see `DASHBOARD_AUDIT.md` for full details)
- **P0:** Win rate now uses P&L win rate, not TX success rate (6 places fixed)
- **P0:** 24H PNL guards against stale baseline with `dailyBaselineValidated` flag
- **P1:** `peakValue` preserved on restart via `Math.max`, no longer clobbered by warmup
- **P1:** Lifetime max drawdown tracked in state, persisted, returned in API
- **P1:** Profit factor fixed -- was reading `state.trading.trades` (nonexistent), now reads `state.tradeHistory`
- **P2:** "Today:" label changed to "Total P&L:"

### Paper Trade Validation
`PAPER_VALIDATE_FIRST` now defaults ON (was opt-in, now opt-out). Every trade is shadow-logged to `state.paperGateLog` before live execution. Non-blocking -- logs then proceeds.

### Confidence Gate System
- `scripts/confidence-gate.ts` -- standalone script, runs backtests, produces a 0--100 score
- `.github/workflows/ci.yml` -- blocks push/PR if confidence < 60
- `.github/workflows/docker-publish.yml` -- gates webhook before fleet redeploy
- `/api/confidence` endpoint on bot for dashboard integration
- Confidence display component on STC website (schertzingertrading.com)
- **Current algorithm scores 25/100** -- this correctly identifies real issues

### Railway Fleet Restored
Fixed 6 deploy-breaking issues (mismatched quotes, broken import paths, TDZ errors). All services redeployed and live.

### Desktop Consolidated
All NVR projects now live under `~/Desktop/NVR Capital/`:

| Directory | Contents |
|---|---|
| `bot/` | autonomous-trading-bot (this repo) |
| `website/` | stc-website (schertzingertrading.com) |
| `content-engine/` | NVR Content Engine |
| `docs/` | 13 strategy docs + handoff PDF |
| `credentials/` | CDP API keys |
| `archive/` | old versions, stale clones |

---

## Known Issues (Unresolved)

1. **"CDP client not initialized"** blocker on Henry's bot -- CDP SDK not connecting. Needs investigation.
2. **Zack's portfolio** dropped from $700 to $85 during downtime.
3. **Kathy's portfolio** is $20, below the $150 minimum required to trade.
4. **1 NVR-Dansley service** still crashed on Railway (unknown which one).
5. **Dashboard upgrade** in `dashboard-upgrade/` is not wired into the live embedded dashboard.

---

## Next Steps: Two Parallel Workstreams

### WORKSTREAM 1: Algorithm Improvement

**Goal:** Raise confidence score from 25 to 60+.

Current breakdown:

| Condition | Score | Problem |
|---|---|---|
| BULL | 12/100 | Not capturing upside |
| BEAR | 0/100 | No bear market strategy at all |
| RANGING | 0/100 | Losing money in sideways markets |
| VOLATILE | 50/100 | Only decent condition |

**How to work on this:**

1. Run the gate to get a baseline: `npm run confidence-gate` (~35 seconds)
2. Key parameters live in `src/core/config/constants.ts`:
   - `confluenceBuyThreshold` -- currently 15 (may be too high)
   - `confluenceSellThreshold` -- currently -30
   - `stopLossPercent` -- currently 15%
   - `profitTakePercent` -- currently 20%
   - `trailingStopPercent` -- currently 20%
   - `kellyFraction` -- currently 0.5
3. Use the parameter sweep tool: `src/simulation/backtester/parameter-sweep.ts`
4. Test across ALL 4 market conditions, not just bull
5. Target: overall score >= 60, each condition >= 40

### WORKSTREAM 2: Gemma 4 Local Model Integration

**Goal:** Replace high-frequency Claude API calls with locally-hosted Gemma 4 (26B-A4B) via Ollama on Mac Mini.

**Architecture:**

| Layer | Model | Responsibilities |
|---|---|---|
| LOCAL (Ollama on Mac Mini) | Gemma 4 26B | Market data parsing, signal generation, routine trades |
| API (Anthropic) | Claude | High-conviction trade validation, edge cases, unusual patterns |

**Setup steps:**

```bash
# On the Mac Mini:
curl -fsSL https://ollama.com/install.sh | sh
ollama pull gemma4:26b
ollama run gemma4:26b "Test prompt"
# Ollama API is OpenAI-compatible at http://localhost:11434/v1/
```

**Integration approach:**

1. Create `src/core/services/model-client.ts` -- model abstraction layer
2. Support backends: `ollama` (local) and `anthropic` (API)
3. Routing: routine cycles go to Gemma, high-conviction decisions go to Claude
4. Escalation: Gemma can call `escalate_to_claude()` when uncertain

**Rollout phases:**

| Phase | Behavior |
|---|---|
| 1 -- Shadow | Gemma runs alongside Claude, compare outputs, no real decisions |
| 2 -- Supervised | Gemma decides, Claude validates ALL trades |
| 3 -- Graduated | Claude only validates large trades |
| 4 -- Production | Gemma runs heartbeat, Claude on escalation only |

Full handoff PDF at: `~/Desktop/NVR Capital/docs/NVR_Bot_Gemma4_Transition_Handoff.pdf`

Hardware: Mac Mini with Apple Silicon and unified memory -- capable of running 26B Q4 quantized model.

---

## Key Commands

```bash
cd "/Users/henryschertzinger/Desktop/NVR Capital/bot"

# Confidence gate (baseline before/after algorithm work)
npm run confidence-gate

# Full test suite (221 tests)
npx vitest run

# Start bot locally
npx tsx start.ts

# Confidence gate (alternate invocation)
npx tsx scripts/confidence-gate.ts
```

---

## Railway Fleet Status

| Service | URL | Portfolio | Status |
|---|---|---|---|
| efficient-peace (Henry) | autonomous-trading-bot-production.up.railway.app | $2,790 | LIVE |
| NVR - Zachary Closky | coinbase-bot-trading-v1-bot-production.up.railway.app | $85 | LIVE |
| NVR - Signal Service | nvr-signal-service-production.up.railway.app | -- | LIVE |
| STC - Kathy & Howard | (check Railway dashboard) | $20 | LIVE (below $150 min) |

---

## Dashboard URLs

| Dashboard | URL |
|---|---|
| STC Website | schertzingertrading.com/dashboard |
| Bot Direct | autonomous-trading-bot-production.up.railway.app |
| Railway Admin | railway.com/dashboard |

---

## Critical File Map

| Path | Purpose |
|---|---|
| `agent-v3.2.ts` | Main bot file (~9,900 lines) |
| `src/algorithm/` | ALGORITHM silo -- indicators, confluence, sizing, risk |
| `src/core/` | CORE silo -- state, execution, services, config, types |
| `src/core/config/constants.ts` | Trading parameters (thresholds, stops, Kelly fraction) |
| `src/dashboard/` | DASHBOARD silo -- UI, API, server routes |
| `src/simulation/` | SIMULATION silo -- replay, backtester, confidence scoring |
| `src/simulation/backtester/parameter-sweep.ts` | Grid search over parameter space |
| `src/fleet/` | FLEET silo -- family platform, deploy configs |
| `scripts/confidence-gate.ts` | Confidence gate entry point |
| `dashboard-upgrade/index.html` | New 3-tab dashboard (not yet wired in) |
| `CLAUDE.md` | Bot overview, deployment, revenue model |
| `DASHBOARD_AUDIT.md` | Full audit of dashboard accuracy issues |
| `SILO_MIGRATION_PLAN.md` | 5-silo architecture plan (completed) |
| `.github/workflows/ci.yml` | CI: typecheck + tests + confidence gate |
| `.github/workflows/docker-publish.yml` | Docker build + gated fleet redeploy |
| `railway.toml` | Railway deploy config |
| `Dockerfile` | Docker build (Node 20, tsx start.ts) |

---

## Session Rules (Always Follow)

1. Read `CLAUDE.md` first.
2. State which silo you are working in before making changes.
3. Run `npm run confidence-gate` before and after algorithm changes.
4. Never commit API keys or wallet private keys.
5. Run `npx vitest run` before pushing.
6. `PAPER_VALIDATE_FIRST` is ON -- every trade gets shadow-logged before execution.
7. Verify that changes actually work -- do not say "should work."
