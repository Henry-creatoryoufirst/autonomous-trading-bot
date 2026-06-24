# Cohort Proposal — 2026-06-24

**Filed by:** NVR autonomous agent (scout run, June 24 2026)
**Status:** PENDING HUMAN REVIEW — do not auto-merge to TOKEN_REGISTRY
**CLAUDE.md compliance:** Rule 1 — writing proposal instead of auto-adding

---

## Candidate: cbMEGA (Coinbase Wrapped MEGA)

| Field | Value |
|-------|-------|
| Symbol | cbMEGA |
| Name | Coinbase Wrapped MEGA (MegaETH) |
| Contract (Base) | `0xcb111e6a2a3bde90856d299d61341ac302167d23` |
| Underlying | MEGA — native token of MegaETH L2 |
| Sector | BLUE_CHIP (Coinbase wrapped asset, cb* family) |
| Risk Level | MEDIUM (wrapped asset, but underlying is a newer L2 token) |
| min TradeUSD | 25 |
| Decimals | 18 |
| CoinGecko ID | `coinbase-wrapped-mega` |

---

## Quality Filter Assessment

| Criterion | Threshold | Observed | Pass? |
|-----------|-----------|----------|-------|
| Pool liquidity | > $100k USD | ~$1.78M onchain market cap; pool TVL unverified (GeckoTerminal blocked) | UNVERIFIED |
| 24h volume | > $50k USD | ~$791K (June 23, 2026) | ✓ YES |
| Pool age | > 3 days | MEGA TGE April 30 2026; cbMEGA on BaseScan since ≥May 23; ~55 days old | ✓ YES |
| Not in TOKEN_REGISTRY | — | Not present | ✓ YES |

**Scout score: 7/10** (volume consistency 7, liquidity depth 6, momentum 6, category fit 9)

**BLOCKER:** Pool TVL/liquidity cannot be verified from this execution environment (GeckoTerminal API is on the proxy blocklist). Before adding to TOKEN_REGISTRY, Henry should confirm Aerodrome pool liquidity exceeds $100K.

---

## Background

MegaETH is an Ethereum Layer-2 that targets <10ms block times and 100,000+ TPS. The MEGA token launched April 30, 2026 on Coinbase and Binance simultaneously (the MEXC source called it "the biggest TGE of the year so far"). Coinbase subsequently wrapped it as cbMEGA, following the same cb* program as cbBTC, cbXRP, cbSOL, cbDOGE, cbADA.

- Token page: [CoinMarketCap](https://coinmarketcap.com/currencies/coinbase-wrapped-mega/)
- BaseScan: basescan.org/token/0xcb111e6a2a3bde90856d299d61341ac302167d23
- cbMEGA was flagged as a watch-list candidate in MEDIC_REPORT Run #27 (2026-05-04) when the full contract address was not available; address now confirmed.

**Historical note:** MOLT, OPENX, and VEIL (May 14–16 2026) were auto-added to TOKEN_REGISTRY and had to be reverted due to CLAUDE.md Rule 1. The Option B benchmark window closed ~June 15 2026. This proposal was written on June 24 after the window end, but CLAUDE.md has not been explicitly updated — hence writing a proposal rather than auto-adding.

---

## Suggested TOKEN_REGISTRY entry (if Henry approves)

```typescript
cbMEGA: {
  address: "0xcb111e6a2a3bde90856d299d61341ac302167d23",
  symbol: "cbMEGA", name: "Coinbase Wrapped MEGA", coingeckoId: "coinbase-wrapped-mega",
  sector: "BLUE_CHIP", riskLevel: "MEDIUM", minTradeUSD: 25, decimals: 18,
},
```

---

## Other candidates evaluated and rejected

| Token | Reason |
|-------|--------|
| cbSUI / cbDOT / cbAVAX | No evidence of Base deployment as of this run |
| ENERGY | Referenced in one search result but no confirmed Base address or liquidity data found |
| BASE token | Coinbase has no confirmed plans for a BASE native token as of June 2026 |

---

## Action required

1. **Verify** Aerodrome pool liquidity for cbMEGA on Base exceeds $100k (check geckoterminal.com/base/pools or Aerodrome UI)
2. **Add to egress allowlist** (long-standing blocker): `autonomous-trading-bot-production.up.railway.app`, `api.geckoterminal.com`
3. **If liquidity confirmed**: add the TOKEN_REGISTRY entry above via human PR to staging, then promote
