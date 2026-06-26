# NVR Cohort Proposal — 2026-06-26

**Author:** NVR Capital autonomous agent (Run #35)
**Status:** Awaiting human review — DO NOT auto-merge to TOKEN_REGISTRY
**Per:** CLAUDE.md Rule 1 — cohort changes via explicit human PR only

---

## Scout Findings (Job 2)

GeckoTerminal API was blocked (403) from this execution environment. Findings are
WebSearch-derived only — no on-chain liquidity/volume figures available for
automated quality filtering. Human verification against GeckoTerminal required
before any PR.

### Candidates Found

| Token | Category | Aerodrome Pool | Approx APY | Notes |
|-------|----------|---------------|-----------|-------|
| TOSHI | Meme (Base-native) | WETH-TOSHI | ~1,015% | Long-standing Base meme, high Aerodrome volume, community-driven |
| BRETT | Meme (Base-native) | WETH-BRETT | ~387% | Major Base meme, one of highest-liquidity meme pools on Aerodrome |
| AIXBT | AI Agent | WETH-AIXBT | ~1,280% | AI agent token, already in CDP_UNSUPPORTED_TOKENS — routes via DEX only |

### Quality Filter (requires manual verification)

Before any of these could pass the scout standard:
- [ ] Pool liquidity > $100k USD (verify on GeckoTerminal)
- [ ] 24h volume > $50k USD (verify on GeckoTerminal)
- [ ] Pool age > 3 days (verify on GeckoTerminal)
- [ ] Not already in TOKEN_REGISTRY (AIXBT IS in CDP_UNSUPPORTED_TOKENS — check if in registry)

### Sector Classification (if added)

- **TOSHI** → MEME_COINS, riskLevel: HIGH, minTradeUSD: 10
- **BRETT** → MEME_COINS, riskLevel: HIGH, minTradeUSD: 10
- **AIXBT** → AI_TOKENS, riskLevel: HIGH, minTradeUSD: 10
  (would also need to be added to DEX_SWAP_TOKENS like MORPHO/cbLTC)

### Recommendation

TOSHI and BRETT are established Base memes with durable volume — the strongest
candidates if the cohort expands post-Option-B. AIXBT is interesting but CDP
routing doesn't support it (already flagged in CDP_UNSUPPORTED_TOKENS), which
adds execution complexity.

**Scout finding: no auto-add per Rule 1. Human PR required.**

---

## Auditor Research (Job 3)

*Trigger conditions unverifiable (bot API blocked). Research runs regardless
since the last confirmed check was Run #34, 2026-05-15 — 42 days ago.*

### Signal Quality
**Finding:** Multi-signal confluence research (2026) confirms 9+ indicators
agreeing statistically collapses the probability of simultaneous error,
posting 68–72% win rates vs 55–62% at 6–7 signals. NVR's existing confluence
scoring approach is validated by this data.
- Impact: 1/5 (already implemented), Complexity: —, Risk: —
- **No action needed.**

### Execution Efficiency
**KEY FINDING: Aerodrome → Velodrome merger + "Predictive Allocation" (July 2026)**

Dromos Labs announced on 2026-06-14 that Aerodrome will replace its weekly
gauge-voting system with "Predictive Allocation" — launching July 2026. This
converts LP incentive routing from backward-looking votes to a forward-looking
prediction market. Additionally, Aerodrome is merging with Velodrome to form
"Aero" — a unified L2 liquidity layer.

- Impact: 3/5 (routing + incentives change), Complexity: 4/5 (requires monitoring
  + possible router address update), Risk: medium
- Priority score: 0.75 — **too complex for auto-implementation**
- **WATCH: If Aerodrome router address changes post-merger, the bot's hardcoded
  Slipstream router will need updating. No urgency now; monitor July 2026.**

Source: blockchainreporter.net, cryptoadventure.com, aerodrome.finance

### Position Sizing
**Finding:** 2026 research continues to confirm Quarter-Kelly (25%) as optimal
for crypto volatility profiles. Friction-adjusted Kelly (scaling by forecast
volatility) could marginally improve sizing but requires real-time vol feed.
NVR at KELLY_FRACTION=0.25 is well-calibrated.
- Impact: 1/5 (already at optimal), Complexity: —, Risk: —
- **No action needed.**

### Competitive Intelligence
**Finding:** MEV protection going mainstream on Base. QuickNode's Base DeFi
Power Bundle offers cross-DEX aggregation via OpenOcean (Uniswap + Aerodrome
+ Sushi). NVR's sequencer-direct RPC already provides partial MEV protection.
Cross-DEX aggregation for best execution is the gap — touches executeSingleSwap
(off-limits per auditor safety rules).
- Impact: 2/5, Complexity: 3/5, Risk: medium
- **Watch list — requires execution path changes.**

### Auditor Action
No implementation this run — trigger conditions unverifiable and no finding
meets (priority ≥ 2.0, risk = low/medium, ≤ 10 lines, not touching execution).

The Aerodrome merger watch item is the most important output. Henry: check
Dromos Labs announcements in July 2026 for router contract migration details.

---

## Summary

**Henry: review this proposal and merge to main to act on any item. No
auto-implementation was performed this run.**

Key actions if you agree:
1. **Scout candidates** — verify TOSHI/BRETT/AIXBT on GeckoTerminal, then
   open a PR to add qualifying tokens to TOKEN_REGISTRY (post-Option-B cohort
   expansion).
2. **Aerodrome merger** — monitor Dromos Labs for Predictive Allocation launch
   and any router address changes in July 2026.
3. **Infrastructure** — consider adding `autonomous-trading-bot-production.up.railway.app`
   and `api.geckoterminal.com` to the egress allowlist for this session type,
   so the medic can actually check bot health (42 days blind is not ideal).
