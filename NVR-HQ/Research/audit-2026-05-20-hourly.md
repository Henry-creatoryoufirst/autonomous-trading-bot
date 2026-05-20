# NVR Strategy Audit — 2026-05-20 Hourly Run

## Trigger Assessment

**Production API status:** UNREACHABLE — environment network policy blocks `autonomous-trading-bot-production.up.railway.app`

Win rate, drawdown, and losing streak could not be computed from live data. Trigger conditions cannot be formally assessed this run. Research was conducted regardless given >48h since last audit activity.

## Internal Diagnosis

- Production metrics: unavailable (API blocked by network policy)
- Last observable state: v21.13.0 on main; Option B pivot active since 2026-05-15
- Active bear-market adjustments visible in constants.ts: KELLY_FRACTION 0.30→0.25, GUARDIAN_NOVEL_TOKEN_HOURS 48→72, SCOUT_UPGRADE_BUY_RATIO 55→60, HOT_MOVER_MIN_VOLUME_H1_USD 150K→200K, HOT_MOVER_MIN_BUY_RATIO 0.55→0.60 — all bear-tightened recently

## Research Findings

### 1. Signal Quality
**Finding:** On-chain wallet flow signals (smart money tracking) achieve ~65% win rate vs 41% for pure technical indicators, per 2026 DeFi bot research (Coinrule/Tradealgo analysis). NVR already runs DEX buy/sell ratio as 35% of swarm weight (highest single signal) — this is architecturally sound.

**Gap identified:** No smart money address tracking (only DEX aggregate buy ratio). Top-performing 2026 bots monitor specific whale wallet addresses for pre-signal entry.

**Impact: 3/5 | Complexity: 4/5 | Priority: 0.75 | Risk: medium**
→ Too complex for auto-implementation (requires address whitelist management). Added to Watch List.

### 2. Execution Efficiency
**Finding:** Aerodrome Slipstream supports up to 10× volume-per-TVL vs standard AMM via concentrated liquidity. NVR already routes through Slipstream. No meaningful new gas optimization identified for ≤10-line implementation.

**Finding (Permit2):** Current 10s delay post-Permit2 approval is already a known parameter (see agent-v3.2.ts medic Pattern B guidance). No new research warranted a change.

**Impact: 2/5 | Complexity: 2/5 | Priority: 1.0 | Risk: low**
→ No actionable change; existing routing is optimal for current architecture.

### 3. Position Sizing
**Finding:** Kelly Criterion best practice in 2026 = fractional Kelly (10-25% of full Kelly), recalibrated weekly or every 20 trades, with bear-regime size reductions. NVR already at true Quarter-Kelly (KELLY_FRACTION=0.25) with 30-trade rolling window — fully aligned with current industry best practice.

**Improvement signal:** Research suggests updating Kelly calculations "after every 20 trades" — NVR uses KELLY_ROLLING_WINDOW=30 (recently tightened from 50). Could tighten to 20 to match best practice.

**Impact: 2/5 | Complexity: 1/5 | Priority: 2.0 | Risk: low**
→ Qualifies for auto-implementation (≤10 lines, constants.ts only). BUT: Option B attribution integrity rule applies — changing Kelly parameters during the 30-day window muddies alpha attribution. Deferring to Watch List.

### 4. Competitive Intelligence
**Finding:** Leading 2026 Base bots (MevX, Coinrule) emphasize: (a) MEV-resistant order routing via private relays, (b) tight slippage tolerance as primary MEV defense, (c) anti-rug FDV filters on new tokens.

NVR status:
- MEV protection: HOT_MOVER_MIN_FDV_USD=1M ✓, pool age filter 48h ✓, VWS_MIN_LIQUIDITY_USD=20K ✓
- Private relay routing: not implemented (uses public sequencer endpoint + RPC fallback)
- Slippage tolerance: TWAP_ADVERSE_MOVE_PCT=1.0% ✓

**Gap:** Private relay/Flashbots Protect for Base is available but would require >10-line change to executeSingleSwap (excluded by auditor safety rules).

**Impact: 2/5 | Complexity: 5/5 | Priority: 0.4 | Risk: medium**
→ Too complex for auto-implementation.

## Action Taken

**No code changes made this run.**

Reasons:
1. API blocked → trigger conditions unverifiable; no confirmed "fire" condition
2. Option B attribution integrity: all qualifying small-change findings (Kelly window 30→20) deferred until post-window (~2026-06-15)
3. No finding met the combined threshold of priority≥2.0, risk=low/medium, AND clear trigger signal

## Watch List (for Henry's review)

| Finding | Change | Expected Impact | Timing |
|---------|--------|----------------|--------|
| Kelly rolling window 30→20 | `KELLY_ROLLING_WINDOW = 20` in constants.ts | Faster adaptation to win-rate changes | Post Option B window (after 2026-06-15) |
| Smart money wallet tracking | New signal source in swarm agent | +15-20% signal quality based on research | Medium-complexity — needs address list |
| Private relay routing | Modify executeSingleSwap RPC selection | Reduce front-running on >$100 trades | High-complexity — touch execution path |

## API Access Issue

Production API (Railway service) is unreachable from this environment due to network policy.
This prevents: Medic health checks, Auditor trigger computation, and Scout pool verification.

**Recommendation for Henry:** Check environment network policy settings at https://code.claude.com/docs/en/claude-code-on-the-web — the Railway production URL needs to be in the allowlist for the automated agent jobs to function correctly.

---
*Scout proposal: NVR-HQ/Research/COHORT_PROPOSAL_2026-05-20.md*
*Branch: claude/cool-sagan-KfmHG*
