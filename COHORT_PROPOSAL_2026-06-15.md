# Cohort Proposal — 2026-06-15

**Author:** NVR Autonomous Agent (claude/cool-sagan-9739lt)
**Status:** AWAITING HENRY REVIEW — do not auto-merge

---

## Option B Window Has Closed

The 30-day Option B benchmark window opened on **2026-05-15** and closes **today, 2026-06-15**.

Key facts:
- The discovery scanner in `agent-v3.2.ts` (line 5487) is explicitly frozen with `COHORT_LOCKED=true` until `~2026-06-15 Option B verdict`
- The `/api/benchmark` endpoint tracks bot returns vs cbBTC/WETH 60/40 over the rolling window
- A forced full-exit to USDC occurred on **2026-05-28** (commit: `f29798d`) — the bot may have been in USDC for ~18 days
- The API is unreachable from the medic sandbox (persistent 403), so benchmark performance is NOT assessable here

**Henry: Please review the `/api/benchmark` endpoint on the live bot to evaluate Option B performance before deciding next steps.**

---

## Scout Research — June 2026

Token registry is already comprehensive. All high-volume Base tokens are tracked. The scout found **no new tokens requiring TOKEN_REGISTRY addition**.

However, the following **COHORT_QUALITY_7 expansion candidates** are worth Henry's consideration as the window closes:

### Candidate 1 — AERO (Aerodrome Finance)
- **Already in TOKEN_REGISTRY:** Yes (sector: DEFI, riskLevel: MEDIUM)
- **Market Cap:** ~$380M
- **24h Volume:** ~$13M
- **Case for cohort inclusion:** Aerodrome is the dominant AMM on Base (~70% of all Base DEX liquidity, $12B+ 30-day volume). The bot trades through Aerodrome pools on every execution. AERO captures 100% of protocol fees for veAERO holders, creating direct alignment. Aerodrome is expanding to Ethereum mainnet and Circle's Arc (July 2026). This is effectively a Base infrastructure token — owning it is owning the platform the bot runs on.
- **Scout score:** 8/10 (volume consistency: high, liquidity depth: excellent, momentum: positive, category fit: DeFi)

### Candidate 2 — MORPHO (Morpho Protocol)
- **Already in TOKEN_REGISTRY:** Yes (sector: DEFI, in DEX_SWAP_TOKENS)
- **Market Cap:** ~$2B FDV
- **24h Volume:** ~$20M
- **Case for cohort inclusion:** $175M Paradigm/a16z raise in June 2026. TVL doubling in early 2026. Deeply integrated into Base DeFi (Moonwell routes through Morpho vaults). High volume, strong institutional backing, deep liquidity. Clear 5-year survival probability.
- **Scout score:** 8/10

### Candidate 3 — EURC (Circle Euro Stablecoin) [NEW — not in registry]
- **Already in TOKEN_REGISTRY:** NO
- **Market Cap:** ~$427M (67.9M circulating, MiCA-compliant, euro-pegged)
- **24h Volume:** High (stablecoin)
- **Case for registry addition:** EURC is Circle-backed, MiCA-compliant, and growing fastest on Base. It's NOT a speculative token but enables: (a) euro-denominated yield via EURC/USDC Aerodrome pools, (b) hedging USD devaluation risk, (c) accessing EU institutional liquidity. Could serve as an alternative "dry powder" asset alongside USDC.
- **Address:** `0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42` (verify on BaseScan before adding)
- **Scout score:** 6/10 (for yield/hedge utility, not speculative)

---

## Cohort Lock Status

Per `CLAUDE.md` Rule 1, cohort changes require explicit human PR. This proposal waits for Henry.

**Recommended next steps for Henry:**
1. Check `/api/benchmark` — did we beat cbBTC/WETH 60/40 by ≥5% annualized?
2. Set `COHORT_LOCKED=false` in Railway env vars to re-enable discovery scanner
3. Review AERO and MORPHO for COHORT_QUALITY_7 elevation (PR to `token-registry.ts`)
4. Consider adding EURC to TOKEN_REGISTRY for yield diversification (separate PR)
5. Decide whether to continue Option B with quality cohort or expand to wider universe

---

## Tokens Evaluated (Not Already in TOKEN_REGISTRY)

| Token | Reason Not Added |
|-------|-----------------|
| EURC  | New candidate — requires Henry's explicit PR per CLAUDE.md Rule 1 |

## Tokens Evaluated (Already in TOKEN_REGISTRY — no action needed)

| Token | 24h Vol | Liquidity | Scout Score | Notes |
|-------|---------|-----------|-------------|-------|
| AERO  | $13M    | Deep      | 8/10        | Cohort candidate |
| MORPHO| $20M    | Deep      | 8/10        | Cohort candidate |
| ZORA  | $15M avg| Medium    | 6/10        | Already tracked |
| WELL  | $1.6M   | $400M TVL | 5/10        | Already tracked, marginal vol |
| MFER  | $800K   | $3M pool  | 6/10        | Already tracked |
| GAME  | $4.5M*  | Small cap | 4/10        | Already tracked, volatile spike |
| SEAM  | ~$4K    | Thin      | 3/10        | Already tracked, fails vol threshold |

*GAME 24h volume was a spike (+2,442% single day); normal volume is much lower.
