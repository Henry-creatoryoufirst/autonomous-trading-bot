# Cohort Proposal — 2026-06-11

**Filed by:** NVR autonomous agent (Run #35)
**Status:** PENDING HUMAN REVIEW — do not act on until post-window (~2026-06-15)
**Option B window closes:** ~2026-06-15 (4 days from filing)

---

## Context

The Option B benchmark window (2026-05-15 → ~2026-06-15) requires the 7-token COHORT_QUALITY_7 to remain frozen for clean alpha attribution. Per CLAUDE.md Rule 1, this proposal documents scout findings instead of editing TOKEN_REGISTRY.

Scout trigger: last scout commit was 2026-05-14 (MOLT added), >28 days elapsed.

**Important constraint:** GeckoTerminal API is blocked from this execution environment (403 on all endpoints). On-chain metrics below are sourced from WebSearch only and require human verification before any TOKEN_REGISTRY edit.

---

## Candidates Researched

### 1. BASE (Base Network Token) — UNVERIFIED
- **What:** Base's native ecosystem token, launched May 2026
- **Why interesting:** Native token of the chain NVR trades on; strong community alignment; would capture network growth directly
- **What I could NOT verify (GeckoTerminal blocked):**
  - Contract address on Base L2
  - Pool liquidity (must be >$100K)
  - 24h volume (must be >$50K)
  - Pool age (must be >3 days)
  - FDV vs HOT_MOVER_MIN_FDV_USD threshold ($1M)
- **Suggested score if metrics pass:** 7-8/10 (network native token, strategic fit)
- **Suggested registry entry if verified:**
  ```typescript
  BASE: {
    address: "<VERIFY ON BASESCAN>",
    symbol: "BASE", name: "Base Token", coingeckoId: "base-token",
    sector: "BLUE_CHIP", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
  }
  ```
- **Action needed:** Henry to verify contract address + liquidity on GeckoTerminal / Aerodrome before adding

### 2. AERO Unified Token (July 2026) — FUTURE WATCH
- **What:** Aerodrome + Velodrome merging into unified "Aero" DEX in July 2026. AERO token already in registry. Post-merge, the unified AERO will capture fees from both Base and Optimism.
- **Why watch:** AERO position may benefit from merger-driven TVL expansion. Current registry entry is already AERO. No new token needed — existing position benefits from this catalyst.
- **Action needed:** None for TOKEN_REGISTRY. Henry to consider increasing AERO sector allocation if merger launches on schedule.

---

## Scout Evaluation Table

| Token | Source | Liq Verified | Vol Verified | Age Verified | Score | Action |
|-------|--------|-------------|-------------|-------------|-------|--------|
| BASE  | WebSearch | ❌ Blocked | ❌ Blocked | ❌ Blocked | Unscored | Verify post-window |
| AERO (unified) | WebSearch | N/A — existing | N/A | N/A | N/A | No change needed |

---

## Auditor Watch List (do not implement until Henry reviews)

From Run #35 auditor research — deferred past Option B window to preserve benchmark attribution:

### Priority 2.0 — Drawdown-Probability Constraint for Kelly Sizing
- **Source:** Atlas Peak Research (2026) — "The Kelly Criterion in Financial Markets"
- **Finding:** Practical production sequence: estimate raw edge → shrink with base rates → apply drawdown-probability constraint. A drawdown-probability cap would add an explicit guard: if current drawdown > `DRAWDOWN_GUARD_PCT`, reduce Kelly fraction by 50%.
- **Implementation:** ~5 lines in Kelly sizing function in `agent-v3.2.ts`
- **Impact:** 2/5 — protective in sustained bear, reduces over-sizing when portfolio is already stressed
- **Complexity:** 1/5 — small change, clear location
- **Risk:** Low
- **Status:** DEFERRED — implement in post-Option-B iteration (after ~2026-06-15)

### Priority 1.0 — Multi-Wallet Clustering Signal
- **Source:** WalletFinder AI (2026) — "triggering only when 2+ watched wallets buy same token within a short observation window"
- **Finding:** Multi-wallet clustering as supplemental confluence: if 2+ whale wallets (>LARGE_TRADE_THRESHOLD_USD) buy the same token within a 15-min window, add +1 confluence point
- **Implementation:** Complex — requires cross-trade correlation in gecko-terminal.ts pipeline
- **Impact:** 3/5 | **Complexity:** 3/5 | **Risk:** Medium
- **Status:** Watch list — requires careful implementation, Henry to review before spec

---

## Recommended Actions for Henry (Post-Window, ~2026-06-15)

1. **Verify BASE token** on GeckoTerminal/Aerodrome — contract address, $100K+ liquidity, $50K+ 24h vol, pool age >3 days. If passes, add to TOKEN_REGISTRY as BLUE_CHIP/MEDIUM.
2. **Implement drawdown-probability constraint** in Kelly sizing — ~5 lines, Priority 2.0.
3. **Option B window closes** — run full attribution analysis before making cohort changes.
4. **GeckoTerminal egress block** (persistent since Run #1): add `api.geckoterminal.com` to Claude Code allowlist so future scout runs can verify metrics directly.
