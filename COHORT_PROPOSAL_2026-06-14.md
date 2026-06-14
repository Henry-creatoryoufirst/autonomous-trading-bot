# Cohort Proposal — 2026-06-14

## Context

The Option B 30-day benchmark window opened 2026-05-15 and closes approximately **2026-06-15 (tomorrow)**.
Per CLAUDE.md Rule 1, the cohort is locked until the window completes. This proposal is written
in lieu of an automatic TOKEN_REGISTRY addition, per the rule: "If you have a candidate, write a
COHORT_PROPOSAL_<YYYY-MM-DD>.md to the Cathedral vault instead."

NVR-HQ is not present in this working-directory checkout, so this file is placed at repo root.

## Current Cohort (COHORT_QUALITY_7)

| Symbol  | Role       | Type            |
|---------|------------|-----------------|
| cbBTC   | Tier 1     | Blue Chip       |
| WETH    | Tier 1     | Blue Chip       |
| cbXRP   | Tier 2     | Blue Chip       |
| cbLTC   | Tier 2     | Blue Chip (HOLD-only — thin liquidity) |
| LINK    | Tier 2     | Blue Chip       |
| cbADA   | Tier 2     | Blue Chip       |
| cbSOL   | Tier 2     | Blue Chip       |

## Scout Status

- Last qualifying scout: ~2026-05-14 (MOLT, ~30 days ago — >48h threshold long exceeded)
- GeckoTerminal API: blocked from this execution environment (no egress allowlist entry)
  — agent cannot perform the standard `trending_pools` + `new_pools` quality filter scan
- WebSearch: functional; used for directional research below

## Research Findings (from WebSearch, 2026-06-14)

### Macro Environment on Base L2

- Base L2 TVL peaked above $5.6B (Oct 2025); still dominant at ~46.6% of all L2 DeFi TVL
- Aerodrome Slipstream controls >50% of Base DEX volume ($453M TVL, $12.4B/30d volume)
- Aerodrome migrating to MEV-resistant pools ahead of July 2026 cross-chain DEX launch
- L2 networks processing ~2M daily transactions; Base near-instant settlement, fees <$0.01

### Candidate Categories to Evaluate Post-Window

Henry should run a full GeckoTerminal scan (accessible from local machine / Railway)
against these categories when the cohort lock expires ~June 15:

**1. RWA / Tokenized Stocks (underweight in current cohort)**
- Sector target: 5% — currently 0% active trading exposure
- The tokenized-real-world-asset category is "one of the dominant forces in 2026"
- Look for: Centrifuge, Backed Finance, or Ondo Finance tokens with live Base liquidity
  and >$100K pool depth

**2. cbSOL complement — other Coinbase Wrapped assets**
- cbBTC, cbXRP, cbLTC, cbADA, cbSOL all share the Coinbase wrapper quality signal
- If Coinbase adds cbDOT, cbBNB, or cbSUI to Base with Aerodrome pairs, these are
  natural Tier-2 additions (proven quality bar, lower rug risk)

**3. Aerodrome ecosystem tokens with deep liquidity**
- AERO itself already in TOKEN_REGISTRY under DEFI
- Post-July cross-chain launch may introduce new deep-liquidity pairs worth monitoring

**4. Cross-chain bridge primitives**
- As Base expands cross-chain (July Aerodrome expansion to Ethereum mainnet + Arc)
  new bridge-native tokens may emerge with strong liquidity

## Quality Filter Checklist (to apply manually post-window)

- [ ] Pool liquidity > $100K USD
- [ ] 24h volume > $50K USD
- [ ] Pool age > 3 days (not brand new)
- [ ] Not already in TOKEN_REGISTRY
- [ ] FDV > $1M USD (HOT_MOVER_MIN_FDV_USD standard)
- [ ] Aerodrome pool (preferred routing)
- [ ] Score 1-10 on: volume consistency, liquidity depth, momentum, category fit
- [ ] Minimum score 6/10 to qualify

## Recommendation

Post-window (~June 15): Henry opens `TOKEN_REGISTRY` and adds 1-3 candidates via manual PR
after reviewing GeckoTerminal trending + new pools with the checklist above. The prior
auto-adds (MOLT, OPENX, VEIL) that had to be reverted are the cautionary tale — manual
review after the window closes is the correct process.

## Egress Allowlist Gap (Action Item for Henry)

The autonomous agent has been unable to reach either the bot API or GeckoTerminal for
35 consecutive runs (~2 months). To restore scout/medic/auditor functionality:

**Add to Claude Code on-the-web network egress allowlist:**
- `autonomous-trading-bot-production.up.railway.app` (bot health API)
- `api.geckoterminal.com` (token discovery data)

This is a one-time settings change in the Claude Code environment configuration.
See: https://code.claude.com/docs/en/claude-code-on-the-web for egress configuration docs.
