# autonomous-trading-bot — NVR Capital Trading Engine

## ⛔ AUTOMATED-AGENT GROUND RULES — Option B window (2026-05-15+)

**If you are an automated agent (medic / scout / auditor / any scheduled job), these are HARD rules during the 30-day Option B benchmark window.**

### Rule 1 — Cohort is locked

Do NOT commit `feat(scout): add <SYMBOL> to TOKEN_REGISTRY` or any other automatic edit to the cohort under any circumstance. The cohort is the 7 quality tokens in `src/core/config/token-registry.ts` → `COHORT_QUALITY_7`. No additions, no removals, no auto-discovery. Three scout-driven auto-adds since the pivot (MOLT 2026-05-14, OPENX + VEIL 2026-05-16) all had to be reverted. Cohort changes happen only via explicit human PR after the 30-day window completes (~2026-06-15). If you have a candidate, write a `COHORT_PROPOSAL_<YYYY-MM-DD>.md` to the Cathedral vault instead.

### Rule 2 — Never auto-merge to main, staging, or any shared branch

You may EXPLORE, RESEARCH, and PROPOSE on your own feature/`claude/*` branch. You may NOT push to `main`, `staging`, or any other branch a human or deploy script reads. You may NOT open auto-merge PRs. Every automated proposal must wait for a human to review the diff, ratify the reasoning, and merge intentionally. The 2026-05-17 medic-auditor `e807de4` (VOLUME_SPIKE_THRESHOLD 2.0→2.5) is the canonical example: useful research, lived correctly on `claude/cool-sagan-1tLQa`, never auto-merged — that is the workflow.

### Why these rules exist

Option B's whole proposition is "outperform cbBTC/WETH 60/40 by ≥5% annualized over a rolling 30-day window with this specific cohort + strategy shape." Unattended automated edits to the constants the strategy runs on muddy the alpha attribution: when the window closes, we won't be able to tell whether outperformance came from the strategy or from drift. Human-reviewed PRs are different — those are intentional iteration, signed off in the strategic conversation, and the audit trail makes attribution recoverable.

Memory references: `project_nvr_option_b_pivot`, `feedback_continuous_strategy_critique`, `feedback_dual_source_of_truth_drift`.

## Overview
Claude-powered AI trading bot running 24/7 on Base (L2). Executes 15-minute cycles analyzing market conditions via technical indicators, confluence scoring, and adversarial risk review.

## Current Version: v21.13.0 (see package.json — source of truth)

## Quick Reference
- **Main file:** `agent-v3.2.ts` (~850KB)
- **Smart wallet (holds funds, signs trades):** `0xB7c51b1A8F967eF6BF906Fe4B484817Fe784a7C1`
  - Coinbase Smart Wallet (ERC-4337). This is where positions live.
  - BaseScan: basescan.org/address/0xB7c51b1A8F967eF6BF906Fe4B484817Fe784a7C1
- **Funding EOA (deposits originate here):** `0x55509AA76E2769eCCa5B4293359e3001dA16dd0F`
  - Original USDC deposits come from this EOA into the smart wallet.
  - NOT where the bot trades from — don't send to this address expecting it to trade.
- **Network:** Base Mainnet (Coinbase L2)
- **Canonical CDP project ID:** `c5774a25-3713-44c0-b090-c9a2ad69443a`
  - EVERY bot in the fleet must run against this CDP project.
  - Set in `CDP_API_KEY_ID` on each bot's Railway service.
  - Bot refuses to start if mismatched (set `NVR_ALLOW_NON_CANONICAL_CDP=true` ONLY for supervised migrations).
  - See `NVR-SPEC-012-Multi-Tenant-Smart-Account-Consolidation.md` in NVR-HQ/Specs for background.

## Deployment — STAGING REQUIRED
- **NEVER push bot code changes directly to `main`** — always go through staging first
- **Production (main):** Railway auto-deploys from `main` branch
- **Staging (staging):** Railway auto-deploys from `staging` branch (paper-trade mode)
- **Workflow:** `./scripts/deploy/stage.sh` → verify → `./scripts/deploy/promote.sh`
- **Rollback:** `./scripts/deploy/rollback.sh`
- **Project ID:** 44a17190-9c66-481d-bdaf-6ef93c3babe2
- **Service ID:** 80096f70-dc22-463f-87a2-77f6081d6781
- **URL:** autonomous-trading-bot-production.up.railway.app
- **GitHub:** Henry-creatoryoufirst/autonomous-trading-bot (private)
- **Docker:** Node 20 slim + Python

## Railway Fleet (all auto-deploy from same repo/main)
1. **efficient-peace** — Henry's main bot
2. **NVR - Signal Service** — Signal aggregation
3. **STC - Kathy&Howard** — Family bot ($500 capital)
4. **NVR - Zachary Closky** — Family bot ($1000 capital)

## Trading Architecture
- **Cycle:** Every 15 minutes, 24/7
- **AI Model:** Claude Sonnet 4 (routine cycles use Haiku for cost savings)
- **Capital discipline (the ONE hardcoded rule):** ~25% of portfolio stays in
  USDC as rolling alpha-strike reserve (`MIN_DRY_POWDER_PCT = 0.25`). The
  other ~75% is bot-governed across sectors. See `project_nvr_strategy_shape`
  memory for rationale.
- **Sector targets (guidelines, not rules — bot free to follow conviction):**
  Blue Chip (45%), AI Tokens (20%), Meme (15%), DeFi (15%), RWAs (5%).
  See `src/core/config/token-registry.ts` for authoritative definitions.
- **Indicators:** RSI, MACD, Bollinger Bands, SMA, Fear & Greed Index
- **Decision flow:** Technical analysis → Confluence scoring → AI review → Adversarial risk review → Execute
- **Router:** Aerodrome Slipstream (50%+ of Base volume)

## Key Services (services/)
| Service | Purpose |
|---------|---------|
| `gecko-terminal.ts` | Technical indicators + price data |
| `risk-reviewer.ts` | Adversarial risk management |
| `telegram.ts` | Alerts + hourly reports |
| `token-discovery.ts` | Token analysis + discovery |
| `yield-optimizer.ts` | Yield strategies |
| `aave-yield.ts` | Aave V3 yield farming |
| `alpaca-client.ts` | Stock trading integration |
| `polymarket.ts` | Prediction market arbitrage |

## Telegram Integration
- **Bot:** @Neverrestcapital_bot
- **Henry's chat ID:** 7267993651
- **Hourly reports:** Portfolio, positions, market regime, flags

## Revenue Model
- 2% of daily NET realized profits (asymmetric — collected on up days only)
- Break-even: ~$2,500 portfolio in normal volatility

## Cost Structure
- Claude API: ~$7-8/mo per bot
- Railway container: ~$7-8/mo per bot
- Target at scale: $2-4/bot/month (tiered models + shared infra)

## Version History (recent — see `git log` for the full trail)
- v21.13 (main, 2026-04-20 PM): Sleeves Phase 2 LIVE ON PROD with
  SLEEVES_DRIVE_DECISIONS=true — all heavy-cycle AI decisions now route
  decisionStage → makeTradeDecisionViaSleeve → coreSleeve.decide() →
  coreDecideFn → makeTradeDecision. Single-sleeve world today (Core at
  100%). Outcome-feedback loop closed: fetchOutcomeSummary polls
  signal-service /outcomes on 30-min cache and injects "ALPHA LEDGER"
  block into heavy-cycle prompt. CoreSleeve.getStats() now computes
  real rollingSharpe7d from state.dailyPayouts (sqrt(365) annualized).
  New endpoints: /api/sleeves, /api/outcomes-summary. Prompt additions:
  "CASH DISCIPLINE (THE ONE HARD RULE)" 25% reserve section, "THESIS
  PLAYED OUT" line for the stale-exit rule. Schema alignment: SleeveDecision
  = TradeDecision alias. Feature-flag orchestrator wrap (makeTradeDecisionViaSleeve)
  keeps the old direct path as instant-rollback via env var.
- v21.12 (main, 2026-04-20 AM): Strategy shape discipline — 25% USDC
  alpha-strike reserve (hardcoded dry powder, MIN_DRY_POWDER_PCT), time-in-
  position exit for meaningful positions ($100+, 48h+, <3% gain, weak flow),
  ghost-emergency guard on price-stream (-50% sanity floor), deploy script
  staging URL fix, RPC-based capital flows (needs BASE_RPC_URL to activate),
  Sleeves Phase 1 scaffolding (read-only /api/sleeves endpoint),
  /api/price-snapshot endpoint, /api/auto-harvest double-count fix,
  cycleIntervalSec + threshold + backendHealth dashboard exposure.
- v21.11.x: Gas reservoir self-funding, prompt compression Tier 1+2 (~360K
  tokens/day saved), canonical decision feed (pub/sub Phase 1-3a)
- v21.9: Capital Liberation (capital follows conviction), Smart Wallet exit
  tracking (checkSmartWalletActivity in signal-service), Outcome Tracker
  recursive learning (outcome-tracker.ts in signal-service, records + hit
  rates — ✅ wired back into agent-v3.2.ts decisions in v21.13 via
  fetchOutcomeSummary + prompt injection),
  Alpha Hunter pipeline (signal-service /alpha endpoint + dashboard panel)
- v21.8: Force-sell + outcome tracker
- v21.3–21.7: 5-silo refactor (setup/intelligence/metrics/decision/filters
  extraction), Phase 5c execution stage promotion
- v20.x: Token pruning, tiered model routing, self-healing, Aerodrome
  Slipstream router, Chainlink oracles, walk-forward validation

For an authoritative view: `git log --oneline main` in this repo.

## Important Notes
- NEVER commit API keys or wallet private keys
- The bot's P&L uses on-chain deposit detection (Blockscout) as source of truth
- Capital deployment: LIGHT tier 20%, Kelly fallback 8%, floor $150/3.5%
- State backup/restore endpoints exist for Railway redeploy safety
