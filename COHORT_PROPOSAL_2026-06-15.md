# NVR Cohort Proposal — 2026-06-15

**Status:** Proposal only — awaiting Henry's review post Option B window  
**Author:** Autonomous agent (scout job, Run #35)  
**Option B window status:** 30-day window completes ~today (2026-06-15). Cohort is locked per CLAUDE.md Rule 1 until human PR after window close.

---

## Why This File Exists

Per CLAUDE.md Rule 1, the scout cannot auto-add to `TOKEN_REGISTRY` or `COHORT_QUALITY_7` during the Option B benchmark window. The last OPENX/VEIL auto-adds (2026-05-16) were reverted same-day. This proposal documents candidates found during today's scan for Henry's consideration now that the window has closed.

---

## Scout Run Summary

- **Date:** 2026-06-15
- **GeckoTerminal API:** 403 (blocked by sandbox egress policy — persistent since Run #1)
- **WebSearch:** Used as fallback; returned general Base/Aerodrome ecosystem info
- **Specific candidates with verified $100k+ liquidity / $50k+ 24h vol:** None confirmed (API blocked)

---

## Key Market Intelligence This Run

### 1. Aerodrome → "Aero" Merger (July 2026)

Aerodrome Finance is completing a mandatory LP migration to MEV-resistant pools ahead of the July 2026 launch of "Aero" — a unified cross-chain DEX merging Aerodrome (Base) and Velodrome (Optimism). Key implications:
- **June 15–July 2026:** Pool depths may be temporarily reduced as LPs migrate. Watch for elevated slippage on non-WETH/USDC/cbBTC pairs.
- **July 2026:** New AERO unified token replaces existing AERO. Bot will need token address update.
- **Auto-benefit:** Slipstream V2 dynamic fee module already deployed (lower fees at block start) — bot benefits without code change.

**Action for Henry:** When "Aero" launches in July, verify AERO token address in TOKEN_REGISTRY is updated to the new contract. The existing `AERO` entry may become stale.

### 2. Base L2 Volume Context

Base network: ~$1.19B/day DEX volume (June 2026), down from bull peaks. Aerodrome retains dominant share. Volume suppression consistent with 100+ day bear market inferred from run history.

---

## Cohort Watch List (not adding now — window still closing)

| Candidate | Rationale | Why Not Adding |
|-----------|-----------|----------------|
| **Aero (unified token)** | July 2026 launch — Aerodrome+Velodrome merger. If it captures existing AERO liquidity + Optimism TVL, it becomes a major Base DeFi token. | Token not yet launched; no address to verify |
| **cbDOGE** | Already in TOKEN_REGISTRY (scout 2026-05-01). Confirmed. | Already present |
| **Existing registry** | Registry has 60+ tokens across all sectors. | Cohort locked; addition would muddy Option B attribution |

---

## Recommendation for Henry

1. **AERO address update (July 2026):** Check that the AERO entry in TOKEN_REGISTRY matches the new unified Aero contract post-merger. This is maintenance, not a cohort change.
2. **GeckoTerminal egress:** Add `api.geckoterminal.com` to sandbox allowlist so future scouts can run properly. See MEDIC_REPORT.md for the full allowlist request.
3. **Post-Option B cohort review:** Once you've reviewed the 30-day performance vs cbBTC/WETH 60/40, consider a deliberate cohort expansion PR. The existing 60+ non-cohort tokens in TOKEN_REGISTRY are available for human-reviewed reactivation.

---

## Scout Safety

- No changes made to `TOKEN_REGISTRY` or `COHORT_QUALITY_7`
- This file is a proposal only; human PR required for any cohort change
