# Token Registry Proposal — 2026-06-16

**Filed by:** NVR Capital autonomous agent (Run #35)  
**Date:** 2026-06-16  
**Context:** Option B 30-day window just closed (~2026-06-15). Scout last ran 2026-05-14 (MOLT). 32 days elapsed. Human review required before any merge.

---

## SCOUT FINDINGS — New Base Chain Candidates

### Candidate 1: TEA (Tea Protocol)

| Field | Value |
|-------|-------|
| Symbol | TEA |
| Name | Tea Protocol |
| Contract (Base) | `0x7ea7ea50ed58bc4d0a9194bcd328e21f7be80c2b` |
| Launch date | 2026-06-04 (12 days ago) |
| Pool | TEA/USDC on Aerodrome (Aero Ignition bootstrapped) |
| 24h volume | ~$678,197 |
| Liquidity | 2% of supply deposited into TEA/USDC pool at launch |
| Pool age | 12 days (> 3 days ✅) |
| Volume threshold | $678K > $50K ✅ |
| Not already in registry | Confirmed ✅ |

**What it is:** Open-source software reputation protocol. TEA rewards developers for open-source contributions tracked on-chain. Launched on Aerodrome via Aero Ignition program (same program that launched UP, cbSOL). Total supply: 100B tokens, ~20% circulating at TGE.

**Quality score: 6/10**
- Volume consistency: 5/10 (only 12 days of data — too early to assess consistency)
- Liquidity depth: 5/10 (bootstrapped but supply-heavy; needs time to mature)
- Momentum: 7/10 (fresh TGE with Aerodrome incentives driving volume)
- Category fit: 7/10 (fits AI/DeFi sector, Aero Ignition pedigree matches UP/cbSOL pattern)

**Recommended sector if added:** `AI_TOKENS` or `DEFI`, `riskLevel: HIGH`, `minTradeUSD: 10`, `decimals: 18`

**Concern:** 12 days is very young. GUARDIAN_NOVEL_TOKEN_HOURS_DEFAULT=72 would apply for 3 days, but the token is still early in its liquidity formation. Recommend waiting 30+ days for volume consistency data before adding.

**Verdict:** WATCHLIST. Re-evaluate at 30 days post-launch (2026-07-04). Do not add to TOKEN_REGISTRY yet.

---

### Candidate 2: VVV (Venice Token)

**Already in TOKEN_REGISTRY.** Pool data collected as part of this scan for confirmation:
- VVV/WETH pool liquidity: $10.23M ✅
- VVV/WETH 24h volume: $2.17M ✅
- VVV/DIEM 24h volume: $308K

Venice Token (VVV) is performing well with deep liquidity. Confirms the prior addition was sound.

---

### Other Base Tokens Evaluated

| Token | Status | Reason excluded |
|-------|--------|-----------------|
| VIRTUAL | Already in registry | Tracked, $390M market cap |
| BRETT | Already in registry | Tracked meme coin |
| AERO | Already in registry | Core DeFi infrastructure |
| cbETH | Already in registry | Blue chip |

No additional tokens meet all four quality filters (liquidity >$100k, 24h vol >$50k, age >3 days, not already in registry) with sufficient quality score (≥6/10) to add today.

---

## AUDITOR RESEARCH — Post-Option-B Window Review

### Context: Milestone Run

This is the first agent run since the Option B 30-day benchmark window closed (~2026-06-15). The window ran from 2026-05-15 to 2026-06-15. Key context:

- **Bear market adjustments made during window:** KELLY_FRACTION=0.25 (Quarter-Kelly), KELLY_POSITION_CEILING_PCT=12, CULL_MIN_AGE_HOURS=72, STALE_POSITION_MIN_AGE_HOURS=36, KELLY_ROLLING_WINDOW=30
- **Market signals (early June 2026):** Top L2 coins +8.14% week of June 6. Aerodrome TVL $453M (stable). Base chain approaching $3B DEX volume records.
- **API still unreachable from execution environment** — cannot confirm actual win_rate/drawdown/regime.

### Finding 1 — Aerodrome V2 Migration (July 2026 Deadline)

**Source:** Multiple sources, June 2026  
**Finding:** Aerodrome has a "mandatory upgrade" requiring LPs to migrate funds to new MEV-resistant pools before the July 2026 cross-chain Aero launch. LPs not migrated stop earning AERO emissions.  
**Impact on NVR:** The bot is a **trader, not an LP**. The Aerodrome router (`0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5`) automatically routes through optimal pools and will use new V2 MEV-resistant pools once they have deeper liquidity. **No code change needed.** However, Henry should manually verify Aerodrome V2 router compatibility before July.  
**Impact: 2 / Complexity: 1 / Risk: low / Priority: 2.0**  
**Implemented:** No (informational — execution path off-limits)

### Finding 2 — Bear Market Adjustments May Need Revisiting

**Source:** Market data, June 2026  
**Finding:** Most bear-market tightening was done in April–May 2026 (54–70 day bear). Early June 2026 shows recovery signals (+8% L2 market cap, stable TVL). If the regime has shifted to RECOVERY or BULL, several constants were tuned for conditions that may no longer apply:
- `CULL_MIN_AGE_HOURS = 72` (reduced from 168 during bear) — in recovery, 72h may prematurely cull positions with revival potential
- `STALE_POSITION_MIN_AGE_HOURS = 36` (reduced from 48) — same concern
- `KELLY_FRACTION = 0.25` (Quarter-Kelly, explicitly "bear-adjusted") — research confirms Quarter-Kelly is for sustained bear; in recovery, 0.30 recovers 75% of growth rate while still controlling drawdown  
**Cannot implement without API confirmation of marketRegime.** If bot confirms RECOVERY regime, Henry should consider reverting KELLY_FRACTION 0.25→0.30 and CULL_MIN_AGE_HOURS 72→120.  
**Impact: 3 / Complexity: 1 / Risk: medium / Priority: 3.0**  
**Implemented:** No (requires human confirmation of regime data)

### Finding 3 — Smart Money Confluence (Watch List, Run #17–35)

**Source:** Multiple research runs  
**Finding:** Nansen-style smart money wallet clustering (multiple whale wallets buying same token within 4h window) generates statistically significant confluence signal. The bot already captures whale flows via LARGE_TRADE_THRESHOLD_USD=2500 but doesn't cross-reference wallet-level patterns.  
**Impact: 4 / Complexity: 5 / Risk: medium / Priority: 0.8**  
**Implemented:** No (complexity too high for ≤10 line auto-implementation). Persistent watch list item.

### Finding 4 — Position Sizing (No Change)

Quarter-Kelly at KELLY_FRACTION=0.25 with KELLY_POSITION_CEILING_PCT=12% confirmed optimal for crypto bear markets per multiple research sources. If regime confirmation arrives (see Finding 2), gradual reversion may be warranted. No change this run.

---

## Action Required from Henry

1. **Aerodrome V2 (Urgent — before July 2026):** Verify the Aerodrome Slipstream router at `0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5` is the current V2 MEV-resistant router. Check [aerodrome.finance](https://aerodrome.finance) for updated router addresses.

2. **Option B Results:** The 30-day window closed ~2026-06-15. Review actual performance vs cbBTC/WETH 60/40 benchmark. If strategy outperformed, share signal attribution. If underperformed, the bear-adjustment constants should be reviewed.

3. **Regime Confirmation:** If bot is reporting RECOVERY or BULL regime, consider PR to revert: `KELLY_FRACTION 0.25→0.30` and `CULL_MIN_AGE_HOURS 72→120` and `STALE_POSITION_MIN_AGE_HOURS 36→48`.

4. **TEA Token:** Re-evaluate on 2026-07-04 (30 days post-launch). If 30-day volume consistency is solid, it's a solid TOKEN_REGISTRY addition candidate for the AI_TOKENS sector.

5. **Egress Fix (Persistent since Run #1):** Add `autonomous-trading-bot-production.up.railway.app` and `api.geckoterminal.com` to Claude Code egress allowlist. The medic agent has been blind to live bot health for 35 consecutive runs.

---

*Filed on branch: `claude/cool-sagan-cda5s0` — requires human review before merge to staging or main.*
