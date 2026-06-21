# Cohort Proposal — 2026-06-21

**Submitted by:** NVR Capital autonomous agent (Run #35)
**Status:** AWAITING HUMAN REVIEW — Option B window ended ~2026-06-15; cohort changes now eligible via explicit human PR per CLAUDE.md Rule 1.

---

## Context

The Option B 30-day benchmark window started 2026-05-15 and ended ~2026-06-15. During this window, CLAUDE.md Rule 1 prohibited all automated additions to `TOKEN_REGISTRY` or `COHORT_QUALITY_7`. Now that the window has closed, Henry should review this proposal and create a PR intentionally.

**Last successful scout additions** (per git log):
- SYRUP (Maple Finance) — 2026-05-08
- cbSOL — 2026-05-04
- UP (Superform) — 2026-05-04
- KAITO — 2026-05-02
- MOLT — 2026-05-14 (**reverted** — CLAUDE.md Rule 1 triggered)
- OPENX/VEIL — 2026-05-16 (**reverted** — CLAUDE.md Rule 1 triggered)

~44 days have elapsed since the last un-reverted scout addition.

---

## Scouting Constraints This Run

**GeckoTerminal API (api.geckoterminal.com)** returned 403 Forbidden from the Claude Code execution sandbox — same network egress restriction that blocks the bot API. Precise liquidity/volume/pool-age metrics could not be fetched programmatically.

**Consequence:** This proposal is research-framed rather than data-confirmed. Henry should validate specific candidates against the quality filters manually before merging any PR.

---

## Quality Filter Criteria (for human validation)

Per the scout job spec, tokens must clear all of:
- Pool liquidity > $100k USD
- 24h volume > $50k USD
- Pool age > 3 days
- Not already in `TOKEN_REGISTRY` (see `src/core/config/token-registry.ts`)
- Score 6+/10 on: volume consistency, liquidity depth, momentum, category fit

---

## Research Candidates (web-search sourced — requires GeckoTerminal validation)

### 1. Aerodrome Predictive Allocation Upgrade (affects AERO weighting, not new token)
- **Finding:** Aerodrome introduced "Predictive Allocation" — a major upgrade that turns LP into a prediction market, strengthening AERO's protocol revenue and TVL position on Base.
- **AERO already in TOKEN_REGISTRY** — this suggests increasing its sector weight (DEFI, MEDIUM risk) is worth considering. Not a new token add, but a strategic emphasis point.
- **Recommendation:** Henry review AERO position sizing in the next bot cycle.

### 2. HeyElsa (ELSA) — already in TOKEN_REGISTRY
- Research confirms HeyElsa has processed $300M+ in on-chain volume and received Coinbase Ventures backing. ELSA is already tracked. Monitor for sector weight increase.

### 3. Unknown new Base tokens — GeckoTerminal validation required
- Web search for "Base L2 trending tokens June 2026" returned general L2 market overviews rather than specific token addresses.
- **Action for Henry:** Manually check `https://api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1` and `…/new_pools?page=1` against the quality filters above. The last 44 days of Base DEX activity likely surfaced 1-3 qualifying tokens not yet in the registry.

---

## Post-Option-B Cohort Review

Now that the benchmark window has closed, Henry should evaluate the full COHORT_QUALITY_7 against its original thesis:

| Symbol | Thesis | Current Status |
|--------|--------|----------------|
| cbBTC  | BTC proxy on Base | Core — maintain |
| WETH   | ETH proxy on Base | Core — maintain |
| cbXRP  | XRP proxy, Base liquidity | Tier 2 — review liquidity |
| cbLTC  | LTC proxy | HOLD_ONLY — thin liquidity; consider deprioritizing |
| LINK   | Chainlink oracle token | Tier 2 — solid |
| cbADA  | ADA proxy, Base liquidity | Tier 2 — review volume |
| cbSOL  | SOL proxy, Aerodrome-integrated | Tier 2 — review performance |

**Key question for Henry:** Did the cohort outperform cbBTC/WETH 60/40 by ≥5% annualized over the 30-day window? The answer determines whether the Option B thesis is validated.

---

## Bear-Adjusted Constants Review (Not a Token Change — For Auditor Context)

Several constants were tightened during the 46-70 day bear market in May 2026. With the bear period likely ending, these may warrant relaxation if live metrics confirm BULL/NEUTRAL regime:

| Constant | Current (Bear-Adj) | Pre-Bear | Recomm. if Bull |
|----------|-------------------|----------|-----------------|
| NORMAL_CONFLUENCE_BUY | 27 | 25 | 25 |
| VWS_MIN_LIQUIDITY_USD | 20,000 | 10,000 | 15,000 |
| HOT_MOVER_MIN_FDV_USD | 1,000,000 | 500,000 | 750,000 |
| KELLY_FRACTION | 0.25 | 0.30 | 0.28 |
| KELLY_POSITION_CEILING_PCT | 12 | 14 | 13 |
| CASH_DEPLOYMENT_CONFLUENCE_DISCOUNT | 15 | 20 | 17 |

These changes belong in a separate PR (touching `constants.ts` only, not `token-registry.ts`).

---

## Recommended Next Steps for Henry

1. Check live bot health at `autonomous-trading-bot-production.up.railway.app/health`
2. Open GeckoTerminal `base/trending_pools` + `base/new_pools` and filter against the quality criteria above
3. If 1+ tokens qualify, create a PR modifying `src/core/config/token-registry.ts` following the existing entry format
4. Assess Option B benchmark result and review COHORT_QUALITY_7 composition
5. Separately, assess market regime and consider a PR to relax bear-adjusted constants if appropriate
6. Add `autonomous-trading-bot-production.up.railway.app` and `api.geckoterminal.com` to the Claude Code egress allowlist so future scout runs can execute properly
