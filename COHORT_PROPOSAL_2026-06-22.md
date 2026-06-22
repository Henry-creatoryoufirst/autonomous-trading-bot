# NVR Cohort Proposal — 2026-06-22

**Filed by:** Automated scout (Run #35)
**Status:** PROPOSAL ONLY — requires Henry's live verification + explicit PR (CLAUDE.md Rule 1)
**Context:** Option B 30-day window completed 2026-06-15. Cohort changes now eligible for human-reviewed PR.

---

## Why This Proposal Exists

- Last scout ran 2026-05-14 (MOLT added) — 38 days ago, well past the 48h threshold.
- GeckoTerminal API (`api.geckoterminal.com`) is blocked by the Claude Code environment's
  egress policy, the same persistent constraint documented in MEDIC_REPORT.md since Run #1.
- Per CLAUDE.md Rule 1, automated TOKEN_REGISTRY commits are prohibited "under any circumstance."
- This document captures what the scout's research found and what Henry should check manually.

---

## Option B Window Completion Notice

The 30-day Option B benchmark window (`2026-05-15 → ~2026-06-15`) is complete.

- The alpha-attribution constraint ("don't muddy the baseline with unattended edits") no longer
  applies to the same degree.
- Cohort changes are now appropriate via explicit human PR, as the CLAUDE.md requires.
- The 7-token COHORT_QUALITY_7 (cbBTC, WETH, cbXRP, cbLTC, LINK, cbADA, cbSOL) remains unchanged
  here — any changes still need Henry's explicit approval.

---

## Market Context (from Research — June 22 2026)

| Signal | Detail |
|--------|--------|
| AERO token | +30% rally mid-June 2026 — Aerodrome/Velodrome merger announcement |
| Aerodrome → Aero | Merging with Velodrome into cross-chain DEX "Aero" — July 2026 launch |
| New pools | MEV-resistant pools (Slipstream V3) replacing current AMMs — LP migration deadline July 2026 |
| Base DEX activity | Aerodrome capturing 60%+ of Base DEX volume; $6.9M monthly fees to token holders |
| Recovery signals | Post-bear recovery indicators present; market regime may have shifted from BEAR to NEUTRAL/BULL |

**NVR implication:** AERO (already in TOKEN_REGISTRY, DEFI sector) should be actively positioned.
The hot-mover scanner should be catching the AERO rally via existing HOT_MOVER_MIN_CHANGE_H1_PCT=7%.

---

## Scout Candidates (UNVERIFIED — manual check required)

The network restriction prevented live pool data verification. These are research-based candidates
only. **Henry must verify each against the quality filter before creating a PR:**

Quality filter criteria:
- Pool liquidity > $100k USD
- 24h volume > $50k USD
- Pool age > 3 days
- Not already in TOKEN_REGISTRY

### Candidate 1: AERO (already in registry — confirm position sizing)
- Already in TOKEN_REGISTRY as DEFI / MEDIUM / $15 min trade
- With +30% rally and Aero merger news, confirm bot is actively sizing AERO appropriately
- No registry change needed; operational check only

### Candidate 2: Check DexScreener Base trending tab
The scout's WebSearch retrieved no specific token addresses with live liquidity data (DexScreener
and GeckoTerminal both blocked). Henry should check:
- https://dexscreener.com/base (Trending and New Pairs tabs)
- Filter: liquidity > $100k, 24h vol > $50k, created > 3 days ago
- Cross-reference against TOKEN_REGISTRY above to find new additions

### Candidate 3: Post-merger Aero token (new AERO)
- The Aerodrome/Velodrome merger creates a new `AERO` token (replacing both VELO and AERO)
- Distribution: 94.5% to current AERO holders, 5.5% to VELO holders
- When this launches in July 2026, the TOKEN_REGISTRY entry for AERO may need address update
- Henry should monitor and update via PR when the new AERO contract deploys

---

## Recommended Action for Henry

1. **Verify AERO position** — Bot should be sized into AERO given the +30% rally and merger catalyst.
   Check the bot's current AERO allocation at:
   `https://autonomous-trading-bot-production.up.railway.app/api/portfolio`

2. **Check DexScreener Base trending** — Live data required for any cohort expansion. Filter as above.
   If candidates pass quality filter, open a PR against `main` to add them to TOKEN_REGISTRY.

3. **Monitor Aero July launch** — New AERO contract will deploy. TOKEN_REGISTRY entry needs address
   update when confirmed. Plan a PR for early-to-mid July.

4. **Consider bear rollback PRs** — With Option B window complete, bear-time constants may warrant
   partial rollback. The auditor implemented VOL_LOW_BOOST 1.25→1.35 this run. Other candidates
   for Henry's review (currently on `claude/cool-sagan-jxzkc5`, not staging):
   - `KELLY_FRACTION = 0.25 → 0.28` (step toward pre-bear 0.35)
   - `HOT_MOVER_MIN_CHANGE_H1_PCT = 7 → 6` (pre-bear was 5; partial rollback)
   - `STALE_POSITION_MIN_AGE_HOURS = 36 → 42` (step toward pre-bear 48h)

5. **Fix egress allowlist** — Add `autonomous-trading-bot-production.up.railway.app` and
   `api.geckoterminal.com` to Claude Code's environment network policy. This will re-enable the
   Medic's live health checks and the Scout's live pool verification.

---

## Safety Notice

This file is a PROPOSAL document, not a code change. No changes were made to:
- `src/core/config/token-registry.ts` (TOKEN_REGISTRY / COHORT_QUALITY_7)
- `main` branch
- `staging` branch

The only code change this run is `VOL_LOW_BOOST 1.25→1.35` in `src/core/config/constants.ts`,
committed to `claude/cool-sagan-jxzkc5` per CLAUDE.md Rule 2.
