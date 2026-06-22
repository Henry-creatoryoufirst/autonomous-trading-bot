# Cohort Proposal — 2026-06-22

**Status**: PENDING HUMAN REVIEW — Per CLAUDE.md Rule 1, cohort changes require explicit human PR.

## Proposed Addition: cbMEGA

**Token**: Coinbase Wrapped MEGA (cbMEGA)
**Category**: Coinbase-wrapped asset (same structural tier as cbBTC, cbXRP, cbADA, cbLTC, cbSOL)
**Backing**: 1:1 backed by MEGA held in Coinbase custody (proof-of-reserves available)
**Chain**: Base L2 (ERC-20)
**Address**: UNKNOWN — not verifiable without GeckoTerminal access (blocked in this environment)

## Rationale

Coinbase has expanded its cbAsset wrapped-token program to include cbMEGA, per Coinbase's official wrapped assets page (confirmed via WebSearch June 2026). Pattern: Coinbase systematically wraps top assets and lists them on Aerodrome with high-APR incentive pools — this is exactly how cbXRP ($634% APR pools) and cbADA ($906% APR pools) were initially seeded.

**Pro**: Fits the established cohort pattern. Coinbase-backed = no rug risk. Aerodrome incentive flywheel = deep-ish liquidity. Same trust model as rest of Tier 2.

**Con**: Cannot verify Base L2 deployment, contract address, liquidity depth, or 24h volume from this environment (GeckoTerminal blocked). Age of pool unknown — may be too new.

## Data Required Before Adding

Henry (or a run with restored GeckoTerminal access) should verify:

1. **Base L2 contract address** — check Coinbase's cbMEGA proof-of-reserves page or Aerodrome pool page
2. **Pool liquidity** — must be > $100K USD
3. **24h volume** — must be > $50K USD
4. **Pool age** — must be > 3 days
5. **FDV** — must be > $1M (HOT_MOVER_MIN_FDV_USD gatekeeper)

## Suggested Registry Entry (fill in address after verification)

```typescript
cbMEGA: {
  address: "0x<VERIFY_ON_BASESCAN>",
  symbol: "cbMEGA", name: "Coinbase Wrapped MEGA", coingeckoId: "coinbase-wrapped-mega",
  sector: "BLUE_CHIP", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
},
```

## Tokens Evaluated and Rejected This Scout

| Token | Reason Rejected |
|-------|----------------|
| cbDOGE | Already in TOKEN_REGISTRY (line 492) |
| cbPEPE | Not confirmed launched on Base L2 as of June 2026 |
| General L2 tokens (ARB, OP, etc.) | Not on Base L2 as tradeable ERC-20 via Aerodrome |
| HYPE (Hyperliquid) | Not on Base L2; trades on Hyperliquid's own chain |

## Note on Scout Constraints

The Scout ran using WebSearch only (GeckoTerminal at api.geckoterminal.com is blocked by the execution environment's egress policy). Standard trending-pool data could not be fetched. The cbMEGA proposal is based on confirmed Coinbase program membership, not verified on-chain liquidity data.

This is a PROPOSAL only. Do not merge to TOKEN_REGISTRY without verifying the data points above.
