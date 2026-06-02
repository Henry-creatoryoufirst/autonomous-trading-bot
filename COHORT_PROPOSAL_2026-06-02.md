# Cohort Proposal — 2026-06-02

**Filed by:** NVR Capital autonomous agent (Scout Job, Run #35)
**Option B window status:** Active — closes ~2026-06-15 (13 days remaining)
**Rule 1 status:** COHORT LOCKED — no TOKEN_REGISTRY changes this scan. Proposals only.

---

## Scout Run Summary

Last successful scout: 2026-05-14 (MOLT added). This scout ran 19 days later, well past the 48h threshold.

### Why No Tokens Were Added

Two constraints prevented TOKEN_REGISTRY additions this scan:

1. **CLAUDE.md Rule 1 (hard):** The Option B cohort is locked through ~2026-06-15. All scout discoveries must go to this proposal file, not TOKEN_REGISTRY. Cohort changes require explicit human PR after the window closes.

2. **GeckoTerminal API blocked (infrastructure):** The Claude Code execution sandbox egress proxy blocks `api.geckoterminal.com` and `api.dexscreener.com` (both return 403). Real-time liquidity and 24h volume cannot be verified for any candidate. The quality filter (>$100K liquidity, >$50K 24h volume, >3 days old) cannot be applied mechanically.

### Research Methodology

Four web searches conducted using available tools:
- "Base L2 trending tokens high volume June 2026 new pools Aerodrome GeckoTerminal"
- "new Base token AI agent Virtuals protocol launch May 2026 high volume"
- "Base chain DeFi token Morpho Moonwell Aerodrome new listing May 2026"
- "Base blockchain token GeckoTerminal trending pool liquidity volume June 2026"

---

## Candidate Evaluation

| Token | Source | Est. Liquidity | Est. 24h Vol | Pool Age | Already in Registry | Score | Decision |
|-------|---------|---------------|--------------|----------|---------------------|-------|----------|
| "Aero" (cross-chain) | Dromos Labs / Aerodrome+Velodrome merger | N/A — not launched yet | N/A | N/A | No | N/A | WATCH — launching July 2026 |
| VIRTUAL | Virtuals Protocol | >$100M (ecosystem deep) | $80.3M (May 2026) | 18+ months | No (but could be added) | 8/10 | Already tracked via COHORT; consider adding to TOKEN_REGISTRY post-window |
| Various Virtuals agents | GeckoTerminal needed | UNKNOWN — API blocked | UNKNOWN | VARIES | Some (TIBBIR, LUNA, VADER, AIXBT, AXR, ETHY, ELSA, WIRE, GAME, BNKR) | N/A | Cannot evaluate without live data |
| Base MCP ecosystem protocols | Base MCP launch (2026-05-26) | HIGH | HIGH | 1-3+ years | YES (MORPHO, WELL, AVNT, AERO) | N/A | Already in registry |

---

## Priority Watch: "Aero" Cross-Chain Token (Dromos Labs)

**What it is:** The unified cross-chain DEX token from Dromos Labs, representing the merger of Aerodrome Finance (Base) and Velodrome Finance (Optimism). Expected launch: July 2026.

**Why it matters to NVR:**
- NVR already routes 100% of Base DEX volume through Aerodrome Slipstream
- The merged "Aero" protocol will be the dominant L2 DEX across Base + Optimism combined
- Governance token of the most important liquidity infrastructure NVR depends on
- Analogous to holding AERO (already in registry) but with cross-chain reach multiplier
- Expected to have deep launch liquidity (LPs actively migrating to MEV-resistant pools pre-launch)

**Projected quality filter results (post-launch):**
- Pool age: Will start at 0 — need 3+ days after launch before scout eligibility
- Liquidity: Expected >$1M at launch (Aerodrome TVL is $424M+; migration pools are pre-seeded)
- 24h volume: Expected >$500K at launch
- Sector: DEFI, riskLevel: MEDIUM, minTradeUSD: 25

**Action for Henry:** Queue "Aero" token for scout evaluation ~3 days after launch (estimated: early-to-mid July 2026). Confirm pool address from Dromos Labs official announcement before adding.

---

## Strategic Intelligence (Auditor-Relevant)

### Aerodrome MEV-Resistant Pool Migration

Aerodrome has begun migrating LPs to new MEV-resistant pool contracts ahead of the Aero cross-chain DEX launch. Key implications:
- NVR's Aerodrome routing should auto-follow new pools via Slipstream's router (no code change needed)
- If trade failure rates increase after July 2026, check if old pool addresses are being used
- Monitor `DEX_SWAP_TOKENS` set and routing for any pool-address-level changes needed

### Market Regime Signals (June 2026)

- Base daily trading volume: $1.06B (+31.57% daily change) — strongest volume surge in recent memory
- Base TVL: ~$4.5B (stable, not collapsed)
- VIRTUAL token: ~$0.739, $80.3M 24h volume (May 2026 data) — ecosystem active
- Operator action: LIQUIDATE-ALL on 2026-05-28 suggests Henry took a defensive position or strategic reset

These signals collectively suggest the ~70-day bear market (which drove all Run #17-34 auditor adjustments) may be ending or transitioning to NEUTRAL. Henry should confirm via API dashboard before deciding to relax any bear-adjusted constants.

### Constants to Relax Post-Bear (Henry's Decision — Not Auto-Implemented)

If market regime is confirmed NEUTRAL or BULL:

| Constant | Current (Bear) | Pre-Bear | Rationale for Relaxation |
|----------|---------------|---------|--------------------------|
| `HOT_MOVER_MIN_CHANGE_H1_PCT` | 7 | 5 | Bull market pumps need lower entry bar |
| `RIDE_THE_WAVE_MIN_MOVE` | 7 | 5 | Wave rides valid at smaller moves in bull |
| `SCALE_UP_MIN_GAIN_PCT` | 5 | 3 | Add to winners earlier in uptrend |
| `SURGE_MAX_CAPITAL_PER_TOKEN_PCT` | 20 | 25 | Less dead-cat-bounce risk in bull |
| `KELLY_FRACTION` | 0.25 | 0.30-0.35 | Larger position sizing appropriate in bull |
| `KELLY_POSITION_CEILING_PCT` | 12 | 14 | Tighter ceiling only needed in bear |
| `STALE_POSITION_MIN_AGE_HOURS` | 36 | 48 | Less aggressive culling in bull |

These should NOT be auto-implemented — they require Henry's confirmation that the regime has changed and the Option B window performance data is reviewed first.

---

## Next Scout Window

- After Option B window closes (~2026-06-15): Re-open TOKEN_REGISTRY for additions
- First priority: "Aero" cross-chain token (3 days after July 2026 launch)
- Second priority: Re-scan Virtuals Protocol graduates with verified GeckoTerminal data
- Third priority: Consider adding VIRTUAL itself as it has high liquidity and volume

---

*Filed to feature branch `claude/cool-sagan-faczA` per CLAUDE.md Rule 1 and Rule 2. Does not modify TOKEN_REGISTRY or any shared branch.*
