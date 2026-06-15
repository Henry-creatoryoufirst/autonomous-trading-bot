# NVR Capital — Cohort Proposal 2026-06-15

> Written per CLAUDE.md Rule 1: "If you have a candidate, write a COHORT_PROPOSAL to the Cathedral vault instead."
> This is a PROPOSAL only — no TOKEN_REGISTRY edits have been made. Awaits human ratification.

## Context

- **Date**: 2026-06-15 (Option B 30-day benchmark window ends today)
- **Last scout TOKEN_REGISTRY commit**: 2026-05-14 (MOLT added) → 31 days ago
- **CLAUDE.md Rule 1 status**: Active through today. No auto-adds permitted.
- **Market regime**: BEAR/VOLATILE — BTC $63K (-50% from Oct-2025 ATH of $126K); June 8 crash with $2.8B ETF outflows
- **Bot status**: Likely 100% USDC following 2026-05-28 `liquidate-all` operator action

## Data Sources This Run

| Source | Status | Note |
|--------|--------|------|
| GeckoTerminal API `/trending_pools` | 403 Forbidden | Claude Code egress policy blocks this domain |
| GeckoTerminal API `/new_pools` | 403 Forbidden | Same egress restriction |
| DexScreener | N/A | Not attempted (same restriction expected) |
| Web search (Aerodrome, Base) | Partial | Search results available, no raw pool data |

**Conclusion**: Pool-level liquidity/volume data was not obtainable this run. Specific token candidates with verified $100K+ liquidity and $50K+ 24h volume cannot be proposed without GeckoTerminal data.

## Market Assessment

- **Bitcoin**: ~$63,000 (down from Oct-2025 ATH of $126,200 — ~50% drawdown)
- **Crypto cycle**: Bear/correction phase; record $2.8B ETF outflows on June 8
- **Base ecosystem**: TVL at $4.5B (strong); Aerodrome planning cross-chain DEX expansion (July 2026)
- **Regime outlook**: "Bitcoin stabilizing in $60K-$70K range for an extended period" (analyst consensus)

## Post-Window Token Scout Priorities

Once Henry ratifies the Option B window close and Rule 1 is lifted, next scout should prioritize:

### Tier 1 — Quality Blue Chips (for TOKEN_REGISTRY review)
- **Aerodrome cross-chain expansion tokens**: When the merged Aerodrome/Velodrome DEX launches on Ethereum mainnet + Circle's Arc (July 2026), it may create new native tokens or incentive tokens worth tracking.
- **Base native token (if launched)**: Coinbase has been building token infrastructure (snapshot rules reported as "entering engineering phase" as of May 2026). A BASE token would be BLUE_CHIP tier.

### Tier 2 — DeFi Mid-Caps to Evaluate
- **Echelon Prime (PRIME)**: Gaming + Web3 on Base, mentioned in CoinBrain's "Top Base DeFi 2026" guide. Not yet in TOKEN_REGISTRY. Needs liquidity verification via GeckoTerminal when API is accessible.
- **Hyperliquid HYPE**: Listed as a top DeFi platform 2026. Check if Base-native pool exists with sufficient liquidity.

### Scout Quality Gate Reminder (as of Run #34 tightening)
These gates MUST pass before any addition:
- Pool liquidity > $100K USD
- 24h volume > $50K USD
- Pool age > 3 days
- HOT_MOVER_MIN_FDV_USD ≥ $1M (per Run #34 auditor tightening)
- Not already in TOKEN_REGISTRY

## Existing Registry Health Check

The current TOKEN_REGISTRY has 60+ tokens. Given the June 2026 bear market, some older additions may warrant review:

| Token | Concern | Recommendation |
|-------|---------|----------------|
| MOLT | Added 2026-05-14; market has since dropped 50%+ from ATH | Review liquidity post-crash |
| OVPP | OpenVPP — limited CoinGecko data at time of addition | Verify still trading |
| EDEL | Limited data at time of addition | Verify liquidity |
| ETHY | AI token, Virtuals ecosystem — sector down significantly | Verify liquidity |
| RAVE | RaveDAO meme — thin liquidity risk in bear | Verify or mark hold-only |

**Note**: These are OBSERVATIONS only. Removals from TOKEN_REGISTRY require explicit human review and PR, not automated action.

## Recommendation for Henry

1. **Lift the Scout lock** after ratifying Option B window closure (today, 2026-06-15)
2. **Fix egress allowlist** so next scout can actually access GeckoTerminal data
3. **Hold off on new additions** until market stabilizes above $70K BTC (reduces new-token risk)
4. **Registry audit**: Consider a manual sweep of tokens added in the Q1-Q2 2026 bear market to confirm they still meet liquidity thresholds
