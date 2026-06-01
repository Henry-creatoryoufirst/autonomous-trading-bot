# COHORT_PROPOSAL — 2026-06-01

**Prepared by:** NVR Capital autonomous agent (Run #35)
**Option B window:** 2026-05-15 → ~2026-06-15 (cohort locked)
**Action required:** Henry review → merge to staging → main after window closes

---

## Why This Proposal Exists

Per CLAUDE.md Rule 1, the cohort (COHORT_QUALITY_7) and TOKEN_REGISTRY are locked
during the Option B benchmark window. Scout ran (18+ days since last run on 2026-05-14),
but instead of auto-adding tokens, this proposal file captures research findings
for human review.

---

## Scout Methodology — Limitations This Run

The Claude Code execution sandbox has an egress allowlist that blocks:
- `api.geckoterminal.com` — trending/new Base pools API
- `autonomous-trading-bot-production.up.railway.app` — bot performance data
- All direct RPC / DEX API calls

This means pool-level metrics (liquidity USD, 24h volume USD, pool age, contract address)
could NOT be verified from live on-chain data. Web search was the only data source.
**Recommendation for Henry:** Add `api.geckoterminal.com` to the Claude Code egress allowlist
to enable proper scout runs.

---

## Token Candidates (Web Research — Unverified Pool Metrics)

### CANDIDATE 1: HYPE (Hyperliquid)
- **Category:** DeFi / L1 exchange token
- **Context:** Surged from $38 to $64 (May 2026), $1B+ daily trading volume on own chain
- **Concern:** Hyperliquid is its own L1; Base L2 liquidity unverified
- **Preliminary score:** 4/10 — strong token but likely insufficient Base L2 pool depth
- **Verdict:** REJECT until Base L2 pool metrics verified via GeckoTerminal

### CANDIDATE 2: STABLE (Tether-backed L1)
- **Category:** Infrastructure
- **Context:** Launched mainnet Dec 2025, pays gas in USDT
- **Concern:** Own L1, not Base L2 — liquidity on Base unverified
- **Preliminary score:** 2/10 — wrong chain focus
- **Verdict:** REJECT

### No Confirmed Qualifying Tokens This Run

Web search could not surface specific Base L2 tokens with:
- Pool liquidity > $100k USD (verified)
- 24h volume > $50k USD (verified)
- Pool age > 3 days (verified)
- Base chain contract address

---

## Auditor Proposals (Option B Lock — For Henry's Review)

These are constants-tuning proposals that cannot be auto-implemented during the
Option B window per CLAUDE.md. Henry should review after ~2026-06-15.

### PROPOSAL A: Bear-to-Bull Recalibration (post-window)
**Trigger:** Market showing bullish signals — Base DEX vol $1.06B/day (+31.57%),
HYPE at $64 ATH, ETF optimism, Option B window ends ~2026-06-15.

Several bear-adjusted constants were calibrated for the 65-85 day bear (Apr-May 2026).
With the quality cohort and improving conditions, consider reviewing:

| Constant | Current | Bear-Adjusted | Proposed Post-Window |
|----------|---------|---------------|---------------------|
| CULL_MIN_AGE_HOURS | 72h | Was 168h | 96h (blue-chip quality cohort holds longer) |
| VOL_LOW_BOOST | 1.25× | Was 1.5× | 1.4× (low-vol periods in early bull = green lights) |
| HOT_MOVER_MIN_CHANGE_H1_PCT | 7% | Was 5% | 6% (fewer false positives in turning market) |

**Risk:** Low — all reversions to mid-point between bear/bull calibrations  
**Alpha attribution:** DEFERRED to post-window to keep Option B clean

### PROPOSAL B: Aerodrome → Aero Migration Watch
**Background:** Aerodrome + Velodrome merging into unified "Aero" DEX in July 2026.
LPs must migrate to new MEV-resistant pools. Bot routes ~50%+ of trades through Aerodrome.

**Actions needed (human review required):**
1. Verify new Aero router contract address when published (likely July 2026)
2. Confirm AERO token address continuity (migration may issue new contract)
3. Check if `CDP_UNSUPPORTED_TOKENS` or `DEX_SWAP_TOKENS` sets need updating
4. Monitor Aerodrome Discord/docs for migration timeline

**Impact:** HIGH if routing breaks during merge; bot falls back to CDP SDK which
may fail on thin-liquidity tokens (Pattern A error pattern)

### PROPOSAL C: QuantHive.AI-Style Alpha Wallet Tracking
**Finding:** QuantHive.AI (multi-chain DEX aggregator) tracks profitable "Alpha Trader"
wallets on Base and computes a Trader Profitability Index (TPI). More sophisticated
than NVR's current LARGE_TRADE_THRESHOLD_USD=2500 simple whale gate.

**Proposed integration:** Add a scoring multiplier to confluence scoring that tracks
whether known profitable wallets (top-10 Base DEX traders by 30-day PnL) have
recently bought a token. Would require an on-chain lookup service.

**Impact:** 3/5 | **Complexity:** 4/5 | **Risk:** medium (new external dependency)
**Verdict:** Watch list — too complex for auto-implementation, high potential alpha

---

## Option B Status

- Window: 2026-05-15 → ~2026-06-15
- Days elapsed: ~17/30
- Cohort locked: YES (cbBTC, WETH, cbXRP, cbLTC, LINK, cbADA, cbSOL)
- Strategy changes since pivot: HOLD_ONLY_TOKENS=[cbLTC] for thin liquidity
- Next review gate: ~2026-06-15 (Henry decides on window extension or cohort updates)
