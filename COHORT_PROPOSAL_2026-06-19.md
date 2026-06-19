# Token Scout Proposal — 2026-06-19

**Status**: Pending Henry review  
**Scout run**: 2026-06-19T (Run #35)  
**Filed to**: Repo root (Cathedral vault not accessible in this checkout — NVR-HQ directory missing)

## Why No TOKEN_REGISTRY Commit

Per CLAUDE.md Rule 1 (still in effect — Option B window closed June 15 but Henry has not yet updated the rules), no automated TOKEN_REGISTRY writes. Additionally, GeckoTerminal API is blocked by the execution environment's network egress policy, preventing on-chain liquidity and volume verification required for safe adds.

## Candidates Researched

| Symbol | Name | Chain | Why Interesting | Blockers | Recommendation |
|--------|------|-------|----------------|---------|----------------|
| FARTCOIN | Fartcoin | **Solana** (not Base) | High meme volume globally | Wrong chain — no Base L2 pool confirmed | REJECT |
| GOAT | Goat | Multiple | AI agent memecoin flagship (Truth Terminal), high narrative | No verified Base L2 contract found | Needs manual verification on GeckoTerminal Base pools |
| AERO | Aerodrome | Base | +22% June 14 on Predictive Allocation launch; Aero merger July 2026 | Already in TOKEN_REGISTRY | SKIP |
| VIRTUAL | Virtuals Protocol | Base | AI agent ecosystem, deep liquidity on graduated tokens | Already in TOKEN_REGISTRY | SKIP |

## Key Market Context (June 2026)

- **BTC at $65K** — down 40% from $105K peak (2025). RSI approaching historically important bottom levels.
- **Aerodrome Predictive Allocation** (June 14, 2026) — shifts from weekly gauge voting to forward-looking prediction market for liquidity. AERO token +22% on announcement.
- **Aero merger** (Aerodrome + Velodrome → unified cross-chain DEX) — targeted July 2026. Base + Optimism + Ethereum mainnet liquidity consolidation.
- **Virtuals Protocol** — AI agent tokens graduate to permanent Uniswap V3 pools on Base with locked liquidity. Deep liquidity structure.
- **Market regime**: Cautiously optimistic/bear transition. Not confirmed bull run yet.

## Action Required from Henry

1. **Update CLAUDE.md**: Post-window operating rules — can Scout add to TOKEN_REGISTRY again?
2. **Verify on GeckoTerminal**: https://www.geckoterminal.com/base/pools → filter by 24h vol > $50K, liquidity > $100K, age > 3 days
3. **GOAT token**: If there's a Base L2 deployment of GOAT with confirmed Aerodrome liquidity, it may qualify (AI memecoin, high narrative fit for AI_TOKENS sector)
4. **Post-window cohort review**: Now that Option B window has closed, should COHORT_QUALITY_7 be reviewed/expanded?

## Scout Standards (for reference when Henry manually verifies)

- Pool liquidity > $100K USD ✓
- 24h volume > $50K USD ✓
- Pool age > 3 days ✓
- Not already in TOKEN_REGISTRY ✓
- Score ≥ 6/10 on: volume consistency, liquidity depth, momentum, category fit ✓
