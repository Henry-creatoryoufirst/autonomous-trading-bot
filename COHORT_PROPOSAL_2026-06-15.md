# COHORT PROPOSAL — 2026-06-15

**Filed by:** NVR Capital autonomous agent (Run #35)
**Status:** For Henry's manual review — no TOKEN_REGISTRY changes made this run
**Context:** Option B 30-day benchmark window closes today (~2026-06-15). Per CLAUDE.md Rule 1, TOKEN_REGISTRY additions require explicit human PR after the window completes.

---

## Why No Auto-Add This Run

Two blockers:

1. **CLAUDE.md Rule 1 (hard rule):** "Cohort changes happen only via explicit human PR after the 30-day window completes (~2026-06-15)." Since today is the boundary date, auto-adding before Henry reviews the window outcome would muddy attribution. This proposal is the handoff.

2. **GeckoTerminal API blocked:** `api.geckoterminal.com` returns 403 from this execution environment (egress allowlist restriction — same constraint that blocks the bot API). The quality filter (liquidity >$100K, volume >$50K, pool age >3 days) cannot be verified programmatically. All pool metrics below are from WebSearch + CoinGecko category data — not audited on-chain.

---

## Time-Sensitive: ZRO Unlock Warning (June 20 — 5 days)

**ACTION NEEDED BEFORE JUNE 20:**

LayerZero (ZRO) has a scheduled token unlock on June 20, 2026:
- **Volume:** 25.71M ZRO tokens
- **Supply impact:** 4.83% of circulating supply
- **Effect:** Likely sell-side pressure at/after unlock date

ZRO is in the TOKEN_REGISTRY (DEFI, MEDIUM risk, `0x6985884C4392D348587B19cb9eAAf157F13271cd`). The bot can hold/trade it. Henry should review current ZRO exposure and consider whether to reduce before June 20.

---

## Scout Research Findings (2026-06-15)

### Market Context (from WebSearch)

- Base L2 TVL: ~$4.5B as of May 2026, all-time high DEX volume near $3B/day
- Top Base projects by volume/engagement: Aerodrome, Virtuals, Brett, Aave, Farcaster
- All five top projects already covered in TOKEN_REGISTRY (AERO, VIRTUAL, BRETT, AAVE)

### Infrastructure Change: Aerodrome Slipstream V2 (May 2026)

Aerodrome completed a **MEV-Resistant Pool Migration** in May 2026. LPs must move funds to new pools to continue earning rewards. The bot routes through Aerodrome Slipstream — Henry should verify:

1. The bot's DEX routing contract (`0xbe6d8f0d...5be6d18a5` on BaseScan) is still hitting active liquidity pools
2. Any Aerodrome position migration is not blocking routing on thin-liquidity tokens (cbLTC, cbXRP, cbADA)
3. Consider checking if pool age validation in scout logic accounts for migrated pools (age resets to 0 on migration)

### Candidate Tokens for Manual Review

The following appeared in search results as notable Base activity in June 2026. **Henry should manually verify all metrics before adding:**

| Token | Notes | Manual check needed |
|-------|-------|-------------------|
| HYPE (Hyperliquid) | Large unlock event June 2026 — monitor for sell pressure | Liquidity, pool age, Base address |
| Base native memes | Reddit/CT trending but no specific addresses found | Volume, FDV, pool age |
| AI agent tokens (Virtuals ecosystem) | Continued category expansion | New tokens from VIRTUAL launchpad since May |

### Search Results: No New Actionable Tokens Found

The WebSearch queries returned general market commentary but no specific new tokens with verifiable Base-native pool data. The egress restriction prevents confirming liquidity/volume/age against GeckoTerminal's API.

**Recommendation:** Henry should run a manual GeckoTerminal scan at:
- `https://api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1`
- `https://api.geckoterminal.com/api/v2/networks/base/new_pools?page=1`

Apply the standard quality filter: liquidity >$100K, 24h vol >$50K, pool age >3 days, not already in TOKEN_REGISTRY.

---

## Auditor Research Summary (Run #35)

*Research ran despite unverifiable API trigger conditions (403 on all endpoints)*

### Signal Quality
- **Finding:** 2026 best practice is multi-source signals (on-chain whale flow + technical + sentiment). NVR already implements this pattern. No new action.
- Momentum signals: "transaction count, holder growth velocity, buy-to-sell ratio from non-developer wallets" — NVR's buy-ratio metric captures this. No gap.
- Impact: 2, Complexity: 4, Priority: 0.5 → Watch list

### Execution Efficiency
- **Finding:** Aerodrome Slipstream V2 MEV-resistant migration (May 2026) auto-benefits routing at the DEX level without NVR code changes. New routing algorithm (Slipstream V2, March 2026) already live.
- Impact: 2, Complexity: 0 (auto), Priority: N/A → No action needed, but verify pools are migrated (see above)

### Position Sizing
- **Finding:** Kelly criterion best practice 2026 confirms Quarter-Kelly (0.25×) for crypto bear markets. NVR is already at KELLY_FRACTION=0.25 with KELLY_POSITION_CEILING_PCT=12. Well-calibrated. No new action.
- Impact: 0, Complexity: 1, Priority: 0 → No action

### Competitive Intelligence
- **Finding 1 (informational):** Intent-based aggregators (CoW Protocol, 1inch Fusion+) gaining share in 2026. Eliminates slippage by matching buyers/sellers before on-chain settlement. Complex integration (touches executeDirectDexSwap — off-limits). **Watch list for Henry.**
- **Finding 2 (time-sensitive):** ZRO unlock June 20 (documented above) — sell pressure watch.
- **Finding 3:** Over 80% of retail automated bots underperform buy-and-hold after fees. NVR's AI-discretionary model + adversarial risk review is differentiated.
- Impact: 3, Complexity: 4, Priority: 0.75 → Watch list (execution change, off-limits for auto-impl)

### Implementation Decision
**No code change this run.** All prior bear-market tuning (34 auditor runs) is already complete. No finding qualifies as (Priority ≥ 2.0, risk = low/med, ≤ 10 lines) without touching off-limits execution functions.

---

## Recommended Actions for Henry

**Priority 1 — Before June 20 (5 days):**
- Review ZRO exposure; consider reducing if overweight given 4.83% supply unlock

**Priority 2 — Now that Option B window closes:**
- Merge outstanding staging improvements to main (`./scripts/deploy/stage.sh && ./scripts/deploy/promote.sh`)
- Manually run GeckoTerminal scout (URLs above) — add qualifying tokens via explicit PR
- Review COHORT_QUALITY_7 performance vs cbBTC/WETH 60/40 benchmark over the 30-day window

**Priority 3 — Infrastructure:**
- Add `autonomous-trading-bot-production.up.railway.app` and `api.geckoterminal.com` to Claude Code egress allowlist to restore automated health monitoring

**Priority 4 — Future roadmap:**
- Intent-based routing (CoW Protocol / 1inch Fusion+) — touches executeDirectDexSwap, requires Henry design review
- On-chain smart money clustering (Nansen/Dune) — complex, high-impact signal upgrade
