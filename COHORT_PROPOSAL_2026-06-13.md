# Cohort Proposal — 2026-06-13

**Filed by:** NVR Capital autonomous agent (Run #35 — Scout job)  
**Status:** PROPOSAL ONLY — awaiting human review and post-window merge  
**Option B window:** Closes ~2026-06-15 (Day 29 of 30 as of this filing)

---

## Why This Proposal Exists

CLAUDE.md Rule 1 prohibits any automatic edits to `TOKEN_REGISTRY` or `COHORT_QUALITY_7` during the 30-day Option B benchmark window (2026-05-15 to ~2026-06-15). This proposal documents scout research conducted on 2026-06-13 so Henry can review and decide whether to merge any changes after the window closes.

The scout last ran on **2026-05-14** (MOLT added, 30 days ago), well past the 48-hour threshold. The scout ran this cycle per the normal schedule.

---

## Scout Execution Constraints This Run

The GeckoTerminal API (`api.geckoterminal.com`) and the production bot API (`autonomous-trading-bot-production.up.railway.app`) are both blocked by the Claude Code remote execution environment's network egress policy. This has been a persistent constraint since Run #1 (April 2026).

**Endpoints attempted:**
```
GET https://api.geckoterminal.com/api/v2/networks/base/trending_pools  → blocked (not in egress allowlist)
GET https://api.geckoterminal.com/api/v2/networks/base/new_pools       → blocked
GET https://autonomous-trading-bot-production.up.railway.app/*         → blocked
```

Web search was used as fallback, but returned only general market commentary without the specific liquidity/volume/pool-age data required by the quality filter. No candidates could be evaluated to the full standard.

**Result: No tokens qualified for proposal this scan.** The GeckoTerminal API must be accessible for a complete scout.

---

## Post-Window Scout Recommendation (for Henry)

After the Option B window closes (~June 15), conduct a full scout using the following priority searches:

### Tier 1 — Likely Qualified (Based on Web Research)

| Category | What to Look For | Why |
|----------|-----------------|-----|
| Coinbase Wrapped Assets | New `cb*` tokens (cbDOT, cbPOL, cbSUI if launched) | Established L1 assets with Coinbase backing; likely LOW risk, strong liquidity |
| Base-Native DeFi | New lending/perps protocols since May 2026 | Base TVL deepening; DeFi sector underweighted vs 15% target |
| AI/Agent tokens via Virtuals | New Virtuals Protocol graduates since May 2026 | AI sector at 20% target; MOLT, ETHY, ELSA already in registry |
| Staked/Yield Tokens | New LSTs or yield-bearing assets on Base | TOKENIZED_STOCKS sector only at deSPXA + bCOIN; expansion opportunity |

### Quality Filter (unchanged from standard)
- Pool liquidity > $100k USD
- 24h volume > $50k USD
- Pool age > 3 days
- Not already in TOKEN_REGISTRY

### Bear-Adjustment Context
The registry was locked during a 70+ day bear market. Post-window thresholds to apply:
- SCOUT_UPGRADE_BUY_RATIO = 60% (already set) — keep; don't lower even in recovery
- HOT_MOVER_MIN_FDV_USD = $1M (already set) — keep; MEV protection is regime-independent
- Consider raising KELLY_MIN_TRADES from 20 → 25 for new tokens if bull market resumes (more data before full sizing)

---

## Strategic Note for Post-Window Phase

The Option B window closes with the cohort at 7 quality tokens:
`cbBTC, WETH, cbXRP, cbLTC, LINK, cbADA, cbSOL`

Per CLAUDE.md, **cohort changes happen only via explicit human PR after the 30-day window completes.** Before adding any new token, Henry should confirm:

1. Does the new token fit the quality cohort standard (5+ year survival probability)?
2. Is the TOKEN_REGISTRY entry (broader list) sufficient, or is COHORT_QUALITY_7 expansion warranted?
3. Have the bear-adjusted position sizing constants been reviewed for bull-market recalibration?

The scout agent recommends keeping COHORT_QUALITY_7 at 7 tokens unless a genuinely distinctive asset emerges. The broad TOKEN_REGISTRY (50+ tokens) provides sufficient diversification for the bot's opportunistic trading layer.

---

*Filed: 2026-06-13 | Branch: claude/cool-sagan-gjyfrh | Next scout window: after 2026-06-15 (post-Option-B-close)*
