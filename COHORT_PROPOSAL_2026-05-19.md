# Cohort Proposal — 2026-05-19

**Source:** NVR Scout Agent (automated, claude/cool-sagan-iZ3Ch branch)
**Status:** PROPOSAL ONLY — cohort is locked per Option B rules. Human review required before any TOKEN_REGISTRY edit.
**Note:** NVR-HQ/Cathedral vault not present in this repo checkout; filing here as nearest alternative.

---

## Why This File Exists

CLAUDE.md Rule 1 prohibits automated edits to TOKEN_REGISTRY or COHORT_QUALITY_7 during the Option B benchmark window (2026-05-15 → ~2026-06-15). Any scout-discovered candidates must be submitted as a proposal for human review rather than auto-added.

The last scout commit was 2026-05-16 10:28 EDT (~72 hours ago, exceeding the 48h rescan threshold), triggering this run.

---

## Scan Conditions — Data Limitations

**Network policy in this execution environment blocks all outbound API calls:**
- `api.geckoterminal.com` → 403 Host not in allowlist
- `api.dexscreener.com` → 403 Host not in allowlist
- Production bot API (`/api/errors`, `/api/balances`) → 403 Host not in allowlist

All metrics below come from web search snippets only and are **unverified**. They should not be used to make a registry decision without a direct API confirmation pass.

---

## Preliminary Candidates (web-search sourced)

| Symbol | Name | Pair | Reported 24h Vol | Notes | Passes Filter? |
|--------|------|------|-----------------|-------|---------------|
| PITCH | Pitch World Cup | v4PITCH/ETH (Uniswap v4, Base) | ~$6.1M | High volume; pool may be <3 days old (v4 prefix suggests new) | UNVERIFIED — likely fails age filter |
| Whirl | Whirl | v4Whirl/WETH (Base) | unknown | No liquidity/age data | UNVERIFIED — insufficient data |
| CAPACITR | CAPACITR | v4CAPACITR/WETH (Base) | unknown | Price $0.058574; no other metrics | UNVERIFIED — insufficient data |
| rootai | Root Edge | v4rootai/WETH (Base) | unknown | AI sector fit; no metrics | UNVERIFIED — insufficient data |
| GINT | GITAGENT | v4GINT/WETH (Base) | unknown | AI sector; no metrics | UNVERIFIED — insufficient data |
| HNODE | Hermes Node | v4HNODE/WETH (Base) | unknown | No metrics | UNVERIFIED — insufficient data |

**Already in TOKEN_REGISTRY (not candidates):** AERO, BRETT, TOSHI, SEAM, cbSOL, LINK, cbBTC, WETH, VIRTUAL, AIXBT, MORPHO, and all others in token-registry.ts.

---

## Quality Filter Requirements (for Henry's verification pass)

Before any candidate can be added, manually confirm ALL of the following via GeckoTerminal or DexScreener:

- [ ] Pool liquidity > $100k USD
- [ ] 24h volume > $50k USD
- [ ] Pool age > 3 days (not brand new)
- [ ] Not already in TOKEN_REGISTRY
- [ ] Scout quality score ≥ 6/10 across: volume consistency, liquidity depth, momentum, category fit

---

## Recommendation

**None of the candidates in this scan meet the verification bar** due to data unavailability. No registry change is proposed at this time.

If PITCH ($6.1M reported volume) can be verified with >$100k liquidity and >3 day pool age, it would merit a score ≥6 and a second proposal with a full quality scorecard. Likely sector: MEME_COINS, riskLevel: HIGH, minTradeUSD: 10.

Henry: if you want to investigate PITCH or the other v4 pool tokens, run a manual GeckoTerminal check and either approve a registry add via PR or close this proposal.
